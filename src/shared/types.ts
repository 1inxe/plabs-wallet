export type ChainId = 1 | 143 | 8453 | 42161;

export interface NetworkConfig {
  chainId: ChainId;
  hexChainId: `0x${string}`;
  name: string;
  nativeSymbol: string;
  rpcUrls: readonly string[];
  explorerUrl: string;
  plabs: null | {
    indexerUrl: string;
    relayerUrl: string;
    feeGateway?: `0x${string}`;
    nativeRpcSync: NativeRpcSyncManifest;
    pools: readonly {
      name: string;
      symbol: string;
      address: `0x${string}`;
      underlying?: `0x${string}`;
      nativeGateway?: `0x${string}`;
      scale?: string;
      decimals: number;
    }[];
  };
}

export interface NativeRpcSyncManifest {
  schema: 'perc20-native-rpc/v2';
  chainId: number;
  genesisHash: `0x${string}`;
  headPolicy: 'finalized' | 'confirmations';
  confirmationDepth: number;
  historyTransport: 'portal-preferred' | 'rpc';
  maxGetLogsSpan: number;
  maxPagesPerPoll: number;
  logRequestIntervalMs?: number;
  maxParallelRpcRequests?: number;
  parallelRangeBlocks?: number;
  parallelPrefetchRanges?: number;
  portal?: {
    schema: 'sqd-portal/v1';
    url: string;
    minRangeBlocks: number;
    maxRequestBlocks: number;
    requestTimeoutMs: number;
    maxRetries: number;
    retryBaseMs: number;
    circuitCooldownMs: number;
  };
  pools: readonly NativeRpcPoolManifest[];
}

export interface NativeRpcPoolManifest {
  address: string;
  deployBlock: number;
  protocolVersion: number;
  abiVersions: readonly ('legacy-v1' | 'current-v2')[];
  legacyHandoff?: Record<string, string | number>;
}

export interface PrivacyVault {
  version: 1;
  vault_id: string;
  account_id: string;
  login_wallet_type: 'evm';
  login_wallet_address: string;
  protocol: 'privacybtc_orchard';
  key_fingerprint: string;
  derivation_path: "m/32'/60'/0'";
  ciphertext: string;
  encryption: {
    algorithm: 'aes-256-gcm';
    nonce: string;
    kdf: 'pbkdf2';
    kdf_params: { salt: string; iterations: number };
  };
  created_at: string;
  updated_at: string;
}

export interface OfficialPrivacyWalletState {
  state_id: string;
  vault_id: string;
  key_fingerprint: string;
  privacy_address: string;
  ciphertext: string;
  encryption: {
    algorithm: 'aes-256-gcm';
    nonce: string;
  };
  updated_at: string;
}

export interface OfficialPrivacyImport {
  schema: 'brush-plabs-official-import/v1';
  vault: PrivacyVault;
  walletState?: OfficialPrivacyWalletState;
}

export interface PrivacyStateEncryption {
  salt: string;
  iterations: number;
  wrappedKey?: { version: 1; nonce: string; ciphertext: string };
}

export interface PrivacyAccountRecord {
  version: 1;
  vault: PrivacyVault;
  privacyAddress: string;
  rawAddressHex: string;
  birthdayBlocks: Partial<Record<ChainId, { number: number; hash: string }>>;
  stateEncryption: PrivacyStateEncryption;
  recoveryMode: 'birthday' | 'legacy-import';
  createdAt: string;
}

export interface PrivacyOwnedNote {
  cmxHex: string;
  txHash: string;
  blockNumber: number;
  cmxPosition: number;
  rawNote: Record<string, unknown>;
  ownedNote: Record<string, unknown>;
  nullifierHex: string;
  valueSats: string;
  confirmed: boolean;
  spent: boolean;
}

export interface PrivacyPoolState extends PrivacyPoolSnapshot {
  notes: PrivacyOwnedNote[];
}

export interface PrivacyAccountState {
  hasAccount: boolean;
  unlocked: boolean;
  privacyAddress: string | null;
  recoveryMode: 'birthday' | 'legacy-import' | null;
  canSync: boolean;
  automaticSync: boolean;
  expiresAt?: number;
  status: 'none' | 'locked' | 'ready' | 'syncing' | 'error';
  error?: string;
}

export interface PrivacyPoolSnapshot {
  version: 1;
  chainId: ChainId;
  poolAddress: string;
  symbol: string;
  decimals: number;
  privacyAddress: string;
  cursorBlock: number;
  cursorBlockHash: string;
  targetBlock: number;
  syncState: 'partial' | 'complete' | 'error';
  totalBalanceRaw: string;
  spendableBalanceRaw: string;
  totalNotes: number;
  spendableNotes: number;
  pendingNotes: number;
  spentNotes: number;
  syncedAt: number;
  error?: string;
}

export interface PrivacySyncProgress {
  chainId: ChainId;
  status: 'idle' | 'syncing' | 'complete' | 'error';
  progress: number;
  message: string;
  startedAt?: number;
  updatedAt?: number;
  etaMs?: number;
  error?: string;
}

export interface PublicAssetBalance {
  chainId: ChainId;
  type: 'native' | 'erc20';
  address: string | null;
  symbol: string;
  decimals: number;
  balanceRaw: string;
  formatted: string;
  manuallyAdded: boolean;
}

export interface EncryptedVault {
  version: 1;
  secretType?: 'privateKey';
  address: `0x${string}`;
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
  createdAt: string;
}

export interface WalletAccountSummary {
  id: string;
  name: string;
  address: string;
  privacyAddress?: string;
}

export interface WalletAccountRecord extends WalletAccountSummary {
  backupPending?: boolean;
  vault: EncryptedVault;
  createdAt: string;
}

export interface WalletState {
  hasVault: boolean;
  unlocked: boolean;
  address: string | null;
  activeAccountId: string | null;
  accountName: string | null;
  accounts: WalletAccountSummary[];
  pendingBackupAccountId?: string | null;
  chainId: ChainId;
  networkName: string;
}

export interface LockSettings {
  walletMinutes: number;
  privacyMinutes: number;
  lockOnBrowserClose: true;
}

export type PrivacyPaymentMode = 'native' | 'private';
export interface PrivacyFeeQuote {
  paymentMode: PrivacyPaymentMode;
  feeRaw: string;
  feePool: string;
  feeSymbol: string;
  feeDecimals: number;
  feeCollector: string;
  gateway?: string;
  quotedAt: number;
  options: Array<{ poolAddress: string; symbol: string; decimals: number; feeRaw: string }>;
}
export interface TransactionSettings {
  experimentalPrivacyWrites: boolean;
  privacyPaymentMode: PrivacyPaymentMode;
  privacyMergeBatchSize: number; // 0: automatically use the allowed capacity.
}

export interface ApprovalRequest {
  id: string;
  origin: string;
  kind: 'connect' | 'personal_sign' | 'typed_data' | 'transaction' | 'switch_chain';
  title: string;
  details: Record<string, string>;
  createdAt: number;
}

export interface ProviderRequest {
  source: 'plabs-wallet-provider';
  id: string;
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

export interface ProviderResponse {
  source: 'plabs-wallet-content';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export type PrivacyNoteFilter = 'all' | 'spendable' | 'pending' | 'spent';
export interface PrivacyNoteSummary {
  id: string;
  valueRaw: string;
  confirmed: boolean;
  spent: boolean;
  txHash: string;
  blockNumber: number;
  position: number;
}
export interface PrivacyNotesPage {
  items: PrivacyNoteSummary[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  counts: { all: number; spendable: number; pending: number; spent: number };
  mergeableCount: number;
  syncedAt: number | null;
  syncState: 'partial' | 'complete' | 'error' | 'empty';
}
export interface PrivacyMergeLimits {
  configuredBatchSize: number;
  walletMaxInputs: number;
  contractMaxActions: number;
  executionMaxInputs: number;
  maxInputs: number;
  paymentMode: PrivacyPaymentMode;
}
export interface PrivacyMergeInventory {
  notes: PrivacyNoteSummary[];
  limits?: PrivacyMergeLimits;
  maxInputs: number;
  privacyAddress: string;
  syncedAt: number;
}
export interface PrivacyMergePreview {
  id: string;
  paymentMode: PrivacyPaymentMode;
  fee: string;
  feeSymbol: string;
  feePool: string;
  maxGasCost: string;
  nativeSymbol: string;
  recipient: string;
  amount: string;
  fees: PrivacyFeeQuote;
  maxGasWei: string;
}
export interface PrivacyMergePlan {
  id: string;
  walletAddress: string;
  chainId: ChainId;
  poolAddress: string;
  symbol: string;
  decimals: number;
  automatic: boolean;
  privacyAddress: string;
  targetIds: string[];
  initialCount: number;
  initialTotalRaw: string;
  maxInputs: number;
  plannedBatches: number;
  completedBatches: number;
  feeBudgetRaw: string;
  gasBudgetWei: string;
  feesCommittedRaw: string;
  gasCommittedWei: string;
  preview: PrivacyMergePreview;
  selectedIds: string[];
  operationId?: string;
  txHash?: string;
  txHashes: string[];
  authorized: boolean;
  authorizationId?: string;
  cancelRequested?: boolean;
  state: 'review' | 'preparing' | 'ready' | 'submitting' | 'waiting' | 'syncing' | 'paused' | 'complete' | 'cancelled';
  message?: string;
  createdAt: number;
}

export interface PrivacyActivityDetails {
  dappOrigin?: string;
  kind: 'send' | 'shield' | 'unshield' | 'merge' | 'unknown';
  poolAddress?: string;
  symbol: string;
  decimals: number;
  amountRaw?: string;
  receiveRaw?: string;
  recipient?: string;
  paymentMode?: PrivacyPaymentMode;
  feeRaw?: string;
  feeSymbol?: string;
  feeDecimals?: number;
  maxGasWei?: string;
  mergePlanId?: string;
  mergeBatch?: number;
  mergeBatches?: number;
  noteCount?: number;
}
export interface PrivacyActivity extends PrivacyActivityDetails {
  id: string;
  chainId: ChainId;
  status: 'pending' | 'confirmed' | 'failed' | 'review';
  stage: string;
  createdAt: number;
  updatedAt: number;
  txHashes: string[];
  mainTxHash?: string;
  requestId?: string;
  error?: string;
  refreshable: boolean;
  unreadable: boolean;
}
export interface PrivacyActivityPage {
  items: PrivacyActivity[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
}

export interface DappUiState {
  id: string;
  origin: string;
  method: string;
  phase: 'unlock-wallet' | 'unlock-privacy' | 'processing' | 'approval' | 'success' | 'error';
  requiresPrivacy: boolean;
  canCancel: boolean;
  createdAt: number;
  message?: string;
  error?: string;
  approval?: ApprovalRequest;
  privacyExists?: boolean;
  privacyUnlocked?: boolean;
}

export interface ActiveSiteConnection {
  tabId: number;
  origin: string;
  host: string;
  favicon?: string;
  address: string | null;
  accountName: string | null;
  chainId: ChainId;
  unlocked: boolean;
  pendingBackup: boolean;
}

export interface PublicTransferReview {
  id: string;
  chainId: ChainId;
  from: string;
  recipient: string;
  tokenAddress: string | null;
  symbol: string;
  amount: string;
  maxGasCost: string;
  nativeSymbol: string;
  expiresAt: number;
}
export interface PublicTransferResult {
  chainId: ChainId;
  from: string;
  recipient: string;
  symbol: string;
  amount: string;
  txHash: string;
  state: 'pending' | 'confirmed' | 'failed';
  message?: string;
}
