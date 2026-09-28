// Selection size is independent of per-transaction input capacity.
export const MERGE_WALLET_MAX_INPUTS = 32;
export const DEFAULT_MERGE_BATCH_SIZE = 9;
export const validMergeBatchSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) &&
  (value === 0 || (value >= 2 && value <= MERGE_WALLET_MAX_INPUTS));
