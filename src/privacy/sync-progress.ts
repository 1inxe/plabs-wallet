import type { PrivacySyncProgress } from '../shared/types';
export interface NftSyncProgress {
  phase: 'catalog' | 'discover' | 'scan' | 'verify' | 'complete' | 'error';
  progress: number;
  collectionIndex: number;
  totalCollections: number;
  name?: string;
  scannedBlocks: number;
  totalBlocks: number;
  verifiedNotes?: number;
  totalNotes?: number;
  updatedAt: number;
}
export type AssetSyncProgress = PrivacySyncProgress & {
  phase?: 'tokens' | 'nfts' | 'complete' | 'error';
  nft?: NftSyncProgress;
};
