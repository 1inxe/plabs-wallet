import { gasRejectionMessage } from './failure';
import { base64ToBytes, bytesToBase64 } from '../shared/encoding';
import type { EncryptedActivity } from './history';

// Only these routing/recovery indexes may remain readable while locked.
const INDEX_FIELDS = ['id', 'walletAddress', 'chainId', 'state', 'createdAt', 'updatedAt',
  'txHashes', 'mainTxHash', 'txHash', 'requestId', 'attempts', 'submissionStarted', 'transport', 'activity', 'recovery', 'failureReason'] as const;
const encoder = new TextEncoder();
const aad = (entry: Record<string, any>) => encoder.encode(
  `plabs-operation-recovery/v1|${entry.walletAddress.toLowerCase()}|${entry.chainId}|${entry.id}`,
);
export const journalIndex = (entry: Record<string, any>): Record<string, any> => {
  const index: Record<string, any> = {};
  for (const field of INDEX_FIELDS) if (entry[field] !== undefined) index[field] = entry[field];
  // Provider errors can contain calldata, addresses or server-echoed payloads.
  if (entry.failureReason === 'insufficient-gas') index.error = ['failed-before-broadcast', 'execution-failed'].includes(entry.state) ? gasRejectionMessage : '当前发送因 Gas 不足被拒绝，但此前交易仍需核对';
  else if (entry.error) index.error = ['failed-before-broadcast', 'execution-failed', 'relayer-failed'].includes(entry.state) ? '操作失败；请核对已确认的授权及费用后重新发起' : '操作尚未完成核对，请更新链上状态，勿重复提交';
  return index;
};
export const sealJournal = async (entry: Record<string, any>, key: CryptoKey) => {
  const index = journalIndex(entry);
  const sensitive = Object.fromEntries(Object.entries(entry).filter(([name]) =>
    !INDEX_FIELDS.includes(name as typeof INDEX_FIELDS[number]),
  ));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(entry) }, key,
    encoder.encode(JSON.stringify(sensitive)),
  );
  index.recovery = { version: 1, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) } satisfies EncryptedActivity;
  return index;
};
export const openJournal = async (entry: Record<string, any>, key: CryptoKey): Promise<Record<string, any>> => {
  if (!entry.recovery) return entry; // Historical records migrate when their account is unlocked.
  if (entry.recovery.version !== 1) throw new Error('恢复记录版本不受支持');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM',
    iv: Uint8Array.from(base64ToBytes(entry.recovery.nonce)).buffer, additionalData: aad(entry),
  }, key, Uint8Array.from(base64ToBytes(entry.recovery.ciphertext)).buffer);
  // The live indexes override the immutable encrypted snapshot.
  const details = JSON.parse(new TextDecoder().decode(plaintext));
  return { ...details, ...entry, error: details.error ?? entry.error };
};
