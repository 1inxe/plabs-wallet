import { base64ToBytes, bytesToBase64 } from '../../shared/encoding';
import { type Intent, type Json } from './protocol';

export type BidRecord = {
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
};
export type BidJournal = { schema: 1; records: BidRecord[] };
export const journalId = (privacy: string) => `jubjub-bids:v1:143:${privacy.toLowerCase()}`;
export const reservedInputs = (journal: BidJournal) => new Set(journal.records.map(r => r.inputCmx));
export async function seal(journal: BidJournal, id: string, key: CryptoKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(id) }, key, new TextEncoder().encode(JSON.stringify(journal)));
  return { schema: 1, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}
export async function open(value: unknown, id: string, key: CryptoKey): Promise<BidJournal> {
  if (value == null) return { schema: 1, records: [] };
  const box = value as { schema: number; nonce: string; ciphertext: string };
  if (box.schema !== 1) throw new Error('JubJub 恢复记录版本无效');
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(base64ToBytes(box.nonce)), additionalData: new TextEncoder().encode(id) }, key, Uint8Array.from(base64ToBytes(box.ciphertext)));
  const journal = JSON.parse(new TextDecoder().decode(data)) as BidJournal;
  if (journal.schema !== 1 || !Array.isArray(journal.records) || journal.records.length > 256) throw new Error('JubJub 恢复记录损坏');
  return journal;
}
