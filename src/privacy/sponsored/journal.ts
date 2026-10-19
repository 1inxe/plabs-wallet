import { base64ToBytes, bytesToBase64 } from '../../shared/encoding';
import { LEGACY } from './legacy';
import { PROTOCOL, requestDigest, type Intent, type Json, type PublicRequest } from './protocol';

export type TransferRecord = {
  intent: Intent;
  campaignId: string;
  rulesHash: string;
  origin: string;
  createdAt: number;
  inputCmx: string;
  inputNullifier: string;
  material: Json;
  envelope: { bundle: Json; outputs: Array<{ cmx_hex: string }> };
  attempted: boolean;
  state: 'pending' | 'confirmed' | 'failed';
  jobId?: string;
  txHash?: string;
  request?: PublicRequest;
  requestDigest?: string;
};
export type TransferJournal = { schema: 1; records: TransferRecord[]; requestIds?: Array<{ key: string; id: string }> };
// Keep the existing encrypted store and AAD: both RPCs must see the same
// reservations and original proof, including after an extension upgrade.
export const journalId = (privacy: string) => `jubjub-bids:v1:143:${privacy.toLowerCase()}`;
export function recordRequest(record: TransferRecord): PublicRequest {
  return record.request ?? { protocol: PROTOCOL, apiBase: LEGACY.api, campaignId: record.campaignId, rulesHash: record.rulesHash, intentId: record.intent.id,
    payment: { chainId: 143, poolAddress: LEGACY.pool, recipientRaw: LEGACY.recipient, amountRaw: record.intent.delta, memoPrefixHex: LEGACY.memoPrefixHex } };
}
export const reservedInputs = (journal: TransferJournal, pool?: string) => new Set(journal.records.filter(record => !pool || recordRequest(record).payment.poolAddress === pool.toLowerCase()).map(record => record.inputCmx));
export function opaqueRequestId(journal: TransferJournal, origin: string, request: PublicRequest) {
  const key = `${origin}:${requestDigest(request)}`;
  const ids = journal.requestIds ??= [];
  const existing = ids.find(item => item.key === key);
  if (existing) return existing.id;
  if (ids.length >= 1024) throw new Error('赞助支付恢复标识已达上限');
  const id = crypto.randomUUID(); ids.push({ key, id }); return id;
}
export async function seal(journal: TransferJournal, id: string, key: CryptoKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(id) }, key, new TextEncoder().encode(JSON.stringify(journal)));
  return { schema: 1, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}
export async function open(value: unknown, id: string, key: CryptoKey): Promise<TransferJournal> {
  if (value == null) return { schema: 1, records: [] };
  const box = value as { schema: number; nonce: string; ciphertext: string };
  if (box.schema !== 1) throw new Error('支付恢复记录版本无效');
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(base64ToBytes(box.nonce)), additionalData: new TextEncoder().encode(id) }, key, Uint8Array.from(base64ToBytes(box.ciphertext)));
  const journal = JSON.parse(new TextDecoder().decode(data)) as TransferJournal;
  if (journal.schema !== 1 || !Array.isArray(journal.records) || journal.records.length > 256 || (journal.requestIds && (!Array.isArray(journal.requestIds) || journal.requestIds.length > 1024))) throw new Error('支付恢复记录损坏');
  return journal;
}
