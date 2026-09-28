import { base64ToBytes, bytesToBase64 } from '../shared/encoding';
import type { PrivacyPoolState } from '../shared/types';

const DATABASE = 'brush-privacy-wallet';
const STORE = 'privacy_states';
const VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let dbPromise: Promise<IDBDatabase> | null = null;

const asBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

const db = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('无法打开隐私状态数据库'));
    });
  }
  return dbPromise;
};

const stateId = (chainId: number, poolAddress: string, privacyAddress: string) =>
  `${chainId}:${poolAddress.toLowerCase()}:${privacyAddress.toLowerCase()}`;

const aadFor = (id: string) => encoder.encode(`brush-privacy-state/v1|${id}`);

export const savePrivacyPoolState = async (state: PrivacyPoolState, key: CryptoKey) => {
  const id = stateId(state.chainId, state.poolAddress, state.privacyAddress);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aadFor(id) },
    key,
    encoder.encode(JSON.stringify(state)),
  );
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({
      id,
      schema: 'brush-privacy-state/v1',
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      nonce: bytesToBase64(nonce),
      updatedAt: Date.now(),
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('隐私状态保存失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('隐私状态保存已中止'));
  });
};

export const loadPrivacyPoolState = async ({
  chainId,
  poolAddress,
  privacyAddress,
  key,
}: {
  chainId: number;
  poolAddress: string;
  privacyAddress: string;
  key: CryptoKey;
}): Promise<PrivacyPoolState | null> => {
  const id = stateId(chainId, poolAddress, privacyAddress);
  const database = await db();
  const record = await new Promise<Record<string, string> | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('隐私状态读取失败'));
  });
  if (!record) return null;
  if (record.schema !== 'brush-privacy-state/v1') throw new Error('隐私状态版本不受支持');
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: asBuffer(base64ToBytes(record.nonce)),
        additionalData: aadFor(id),
      },
      key,
      asBuffer(base64ToBytes(record.ciphertext)),
    );
    return JSON.parse(decoder.decode(plaintext)) as PrivacyPoolState;
  } catch {
    throw new Error('隐私状态密码错误或数据已损坏');
  }
};
