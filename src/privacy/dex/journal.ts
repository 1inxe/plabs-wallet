import { base64ToBytes, bytesToBase64 } from '../../shared/encoding';
import { DEX, type DexIntent, type JsonRecord } from './protocol';

export type Funding = {
  pool: string;
  bundle: JsonRecord;
  commitments: string[];
  inputs: string[];
  state: 'prepared' | 'unknown' | 'confirmed';
  requestId?: string;
  txHash?: string;
  stage?: 'confirming' | 'indexing' | 'failed';
};
export type DexRecord = {
  id: string;
  origin: string;
  createdAt: number;
  account: number;
  intent: DexIntent;
  epoch: string;
  state:
    | 'prepared'
    | 'funding'
    | 'funded'
    | 'submitting'
    | 'open'
    | 'canceling'
    | 'recovering'
    | 'recovered'
    | 'discarded';
  material: JsonRecord;
  principalNote: JsonRecord;
  feeNote: JsonRecord;
  funding: Funding[];
  submissionAttempted?: boolean;
  orderId?: string;
  capability?: string;
  cancelConfirmed?: boolean;
  error?: string;
  recovery?: Funding[];
  recoveredRaw?: Record<string, string>;
};
export type DexJournal = { schema: 1; nextAccount: number; records: DexRecord[] };
// Random per-install starting point in the upper half of BIP44's unhardened account space.
// Legacy web wallet starts at 1. Persist before deriving; never decrement/reuse an index.
export const newJournal = (): DexJournal => ({
  schema: 1,
  nextAccount: 0x40000000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 0x20000000),
  records: [],
});
export const journalId = (privacyAddress: string) =>
  `pex-vnote-journal:v1:143:${privacyAddress.toLowerCase()}`;
const aad = (id: string) => new TextEncoder().encode(id);
export async function sealJournal(journal: DexJournal, id: string, key: CryptoKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(id) },
    key,
    new TextEncoder().encode(JSON.stringify(journal)),
  );
  return {
    schema: 1,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}
export async function openJournal(value: unknown, id: string, key: CryptoKey): Promise<DexJournal> {
  if (value === undefined) return newJournal();
  const box = value as { schema: number; nonce: string; ciphertext: string };
  if (box.schema !== 1) throw new Error('PEX 恢复记录版本不支持');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(base64ToBytes(box.nonce)), additionalData: aad(id) },
    key,
    Uint8Array.from(base64ToBytes(box.ciphertext)),
  );
  const journal = JSON.parse(new TextDecoder().decode(plaintext)) as DexJournal;
  if (
    journal.schema !== 1 ||
    !Array.isArray(journal.records) ||
    !Number.isSafeInteger(journal.nextAccount) ||
    journal.nextAccount < 1 ||
    journal.nextAccount > 0x7fffffff
  )
    throw new Error('PEX 恢复记录损坏');
  return journal;
}
export function publicOrder(record: DexRecord) {
  return {
    id: record.orderId ?? record.id,
    localId: record.id,
    managed: true,
    side: record.intent.side,
    type: record.intent.type,
    quantityRaw: record.intent.quantityRaw,
    priceTicks: record.intent.priceTicks,
    createdAt: record.createdAt,
    epoch: record.epoch,
    status:
      record.state === 'recovered'
        ? ('recovered' as const)
        : record.state === 'open'
          ? ('open' as const)
          : ('pending' as const),
    executionState: record.state,
    matchedRaw: null,
    pendingRaw: null,
    remainingRaw: null,
    canResume: !record.cancelConfirmed && !['recovered', 'discarded'].includes(record.state),
    canCancel: !['recovered', 'discarded'].includes(record.state),
    fundingProgress: (record.state === 'recovering' ? record.recovery ?? [] : record.funding).map((f) => ({
      asset: f.pool.toLowerCase() === DEX.base ? 'P20' : 'sUSDC',
      state: f.state === 'confirmed' ? 'confirmed' as const : f.state === 'prepared' ? 'prepared' as const : f.stage ?? 'confirming',
    })),
    ...(record.funding.some((f) => f.stage === 'failed') || record.recovery?.some((f) => f.stage === 'failed') ? { transactionFailed: true } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}
