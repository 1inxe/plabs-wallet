import type { NftTransfer } from './transfer';
import type { NftMintResult } from 'plabs-js-sdk';
import { base64ToBytes, bytesToBase64 } from '../../shared/encoding';
import type { Json, MintNote } from './protocol';

export type MintState =
  'reserved' | 'proving' | 'ready' | 'submitted' | 'confirmed' | 'failed' | 'review';
export type MintRecord = {
  id: string;
  origin: string;
  account: string;
  pool: string;
  name: string;
  symbol: string;
  createdAt: number;
  state: MintState;
  stage: string;
  reservationAttempted?: boolean;
  jobId?: string;
  tokenId?: string;
  mint?: MintNote;
  note?: Json;
  bundle?: Json;
  txHash?: string;
  nonce?: number;
  message?: string;
};
export type NftHolding = {
  pool: string;
  name: string;
  symbol: string;
  tokenId: string;
  cmx: string;
  nullifier: string;
  note: Json;
  txHash: string;
  blockNumber: number;
  spent: boolean;
};
export type NftCursor = {
  firstBlock: number;
  cursor: number;
  blockHash?: string;
  name: string;
  symbol: string;
};
export type MintJournal = {
  schema: 1;
  records: MintRecord[];
  holdings?: NftHolding[];
  transfers?: NftTransfer[];
  pools?: Record<string, NftCursor>;
  syncedAt?: number;
  syncComplete?: boolean;
  syncError?: string;
  syncProgress?: string;
};
export const journalId = (privacy: string) => `nft-mints:v1:1:${privacy.toLowerCase()}`;
export async function seal(journal: MintJournal, id: string, key: CryptoKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(id) },
    key,
    new TextEncoder().encode(JSON.stringify(journal)),
  );
  return {
    schema: 1,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}
export async function open(value: unknown, id: string, key: CryptoKey): Promise<MintJournal> {
  if (value == null) return { schema: 1, records: [] };
  const box = value as { schema: number; nonce: string; ciphertext: string };
  if (box.schema !== 1) throw new Error('NFT 恢复记录版本无效');
  const data = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: Uint8Array.from(base64ToBytes(box.nonce)),
      additionalData: new TextEncoder().encode(id),
    },
    key,
    Uint8Array.from(base64ToBytes(box.ciphertext)),
  );
  const journal = JSON.parse(new TextDecoder().decode(data)) as MintJournal;
  if (journal.schema !== 1 || !Array.isArray(journal.records) || journal.records.length > 4096)
    throw new Error('NFT 恢复记录损坏');
  if (journal.holdings && (!Array.isArray(journal.holdings) || journal.holdings.length > 4096))
    throw new Error('NFT 资产记录损坏');
  if (journal.transfers && (!Array.isArray(journal.transfers) || journal.transfers.length > 4096))
    throw new Error('NFT 发送记录损坏');
  return journal;
}
export function publicMint(record: MintRecord): NftMintResult {
  return {
    id: record.id,
    chainId: 1 as const,
    poolAddress: record.pool,
    name: record.name,
    symbol: record.symbol,
    tokenId: record.tokenId,
    state:
      record.state === 'confirmed'
        ? ('confirmed' as const)
        : record.state === 'failed'
          ? ('failed' as const)
          : ('pending' as const),
    stage: record.stage,
    createdAt: record.createdAt,
    txHash: record.txHash,
    canResume: !['confirmed', 'failed'].includes(record.state),
    message: record.message,
  };
}
