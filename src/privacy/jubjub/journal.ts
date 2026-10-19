// The legacy and generic RPCs intentionally share one encrypted journal.
export { journalId, reservedInputs, seal, open } from '../sponsored/journal';
export type { TransferRecord as BidRecord, TransferJournal as BidJournal } from '../sponsored/journal';
