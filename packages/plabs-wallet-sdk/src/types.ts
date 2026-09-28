// Adapted from Noir Wallet SDK's typed provider surface. See NOTICE.md.
export type HexChainId = `0x${string}`;
export type ChainIdInput = HexChainId | number;
export type ProviderListener = (...args: unknown[]) => void;
export interface RequestArguments { method: string; params?: unknown[] | Record<string, unknown> }
export interface PlabsProvider {
  readonly isPlabsWallet?: boolean;
  readonly version?: string;
  request(args: RequestArguments): Promise<unknown>;
  on(event: string, listener: ProviderListener): unknown;
  removeListener(event: string, listener: ProviderListener): unknown;
}
export interface ProviderConnectInfo { chainId: HexChainId }
export interface ProviderMessage { type: string; data: unknown }
export interface ProviderRpcError extends Error { code: number; data?: unknown }
export interface PlabsEvents {
  accountsChanged: string[];
  chainChanged: HexChainId;
  connect: ProviderConnectInfo;
  disconnect: ProviderRpcError;
  message: ProviderMessage;
}
export interface PlabsWalletInfo { uuid: string; name: string; icon: string; rdns: string }
export interface DiscoveredPlabsWallet { info: PlabsWalletInfo; provider: PlabsProvider }
export interface PlabsCapabilities {
  version: 1;
  methods: { personalSign: boolean; signTypedData: boolean; evmTransactions: boolean; evmPreview: boolean; privacyTransactions: boolean; privacyRead?: boolean; privacyHistory?: boolean; privacyNotes?: boolean; dexOrders?: boolean; dexTrading?: boolean; unifiedConnect?: boolean };
  networks: Array<{ chainId: number; name: string; nativeSymbol: string; pools: Array<{ address: string; symbol: string; canShield: boolean; canUnshield: boolean; decimals?: number; underlying?: string }> }>;
}
export interface WalletConnection { accounts: string[]; chainId: HexChainId; privacy?: PrivacySession }
export interface WalletPermission { invoker: string; parentCapability: string; caveats?: Array<{ type: string; value: unknown }> }
export interface EvmTransactionRequest { from: string; to: string; value: `0x${string}`; data?: `0x${string}`; chainId?: HexChainId }
export interface EvmTransactionPreview extends EvmTransactionRequest { approved: true; broadcast: false; chainId: HexChainId }
export interface PlabsPrivacySendParams {
  chainId: ChainIdInput;
  poolAddress: string;
  to: string;
  /** Decimal token amount; never pass a JavaScript floating-point number. */
  amount: string;
  feePool?: string;
}
export type PlabsPrivacyPoolParams = Omit<PlabsPrivacySendParams, 'to'>;
export interface PrivacyAddress { address: string; chainId: HexChainId }
export interface PrivacyTransactionRequest {
  kind: 'send' | 'shield' | 'unshield';
  chainId: HexChainId;
  poolAddress: string;
  amount: string;
  recipient?: string;
  feePool?: string;
}
export interface PrivacyTransactionResult { id: string; state: 'pending' | 'confirmed' | 'failed'; txHash?: string; message?: string }

/** Each scope is approved for one site, account, network and unlocked privacy session. */
export type PrivacyReadScope = 'address' | 'balances' | 'history' | 'notes' | 'dexOrders';
export interface PrivacySession { version: 1; chainId: HexChainId; address?: string; scopes: PrivacyReadScope[]; expiresAt?: number; remembered?: boolean }
export interface PublicBalance { chainId: number; type: 'native' | 'erc20'; address: string | null; symbol: string; decimals: number; balanceRaw: string }
export interface ShieldedBalance {
  chainId: number; poolAddress: string; symbol: string; decimals: number;
  totalRaw: string | null; spendableRaw: string | null; pendingRaw: string | null;
  totalNotes: number; spendableNotes: number; syncState: 'partial' | 'complete' | 'error' | 'unavailable'; syncedAt: number | null;
}
export interface WalletPortfolio {
  chainId: HexChainId; privacyAddress: string; fetchedAt: number;
  public: { assets: PublicBalance[]; error?: string };
  private: { assets: ShieldedBalance[]; error?: string };
}
export interface PrivacyHistoryEntry {
  id: string; chainId: number; kind: 'send' | 'shield' | 'unshield' | 'merge' | 'receive' | 'unknown';
  status: 'pending' | 'confirmed' | 'failed' | 'review'; symbol: string; decimals: number;
  amountRaw?: string; recipient?: string; poolAddress?: string; txHash?: string;
  createdAt: number | null; blockNumber?: number; source: 'wallet' | 'received-note';
}
export interface PrivacyHistoryPage { items: PrivacyHistoryEntry[]; page: number; pageSize: number; total: number; pages: number; coverage: 'wallet-and-received-notes'; syncComplete: boolean }
export interface PrivacyNote { id: string; poolAddress: string; symbol: string; decimals: number; valueRaw: string; confirmed: boolean; spent: boolean; txHash?: string; blockNumber: number }
export interface PrivacyNotes { items: PrivacyNote[]; page: number; pageSize: number; total: number; pages: number }
export interface PrivacyPageParams { page?: number; pageSize?: number; poolAddress?: string }
export interface DexOrderIntent { chainId: '0x8f'; side: 'buy' | 'sell'; type: 'limit' | 'market'; quantityRaw: string; priceTicks: string; maxFeeRaw: string }
export interface DexOrderSummary { id: string; side: 'buy' | 'sell'; type: 'limit' | 'market'; quantityRaw: string; priceTicks: string; createdAt: number; epoch: string; status: 'open' | 'filled' | 'pending' | 'not-found' | 'previous-epoch' | 'unavailable' | 'recovered'; matchedRaw: string | null; pendingRaw: string | null; remainingRaw: string | null; localId?: string; managed?: boolean; executionState?: 'prepared' | 'funding' | 'funded' | 'submitting' | 'open' | 'canceling' | 'recovering' | 'recovered' | 'discarded'; canResume?: boolean; canCancel?: boolean; error?: string; executionActive?: boolean; transactionFailed?: boolean; fundingProgress?: { asset: string; state: 'prepared' | 'confirming' | 'indexing' | 'confirmed' | 'failed' }[] }
export interface DexOrders { orders: DexOrderSummary[]; source: 'official-matcher'; importedAt: number | null; fetchedAt: number; needsImport: boolean; canPlaceOrders: boolean; error?: string }
