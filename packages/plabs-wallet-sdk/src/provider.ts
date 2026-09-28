// Adapted from @noir-wallet/sdk src/provider.ts (MIT). See NOTICE.md.
import { BaseAPI } from './base-api.js';
import { EvmAPI } from './chains/evm/api.js';
import { PrivacyAPI } from './chains/privacy/api.js';
import { PlabsWalletError, PLABS_ERROR_CODES } from './errors.js';
import type { PlabsCapabilities, PlabsProvider, WalletConnection, PrivacyReadScope } from './types.js';

export class PlabsWallet extends BaseAPI {
  readonly isPlabsWallet = true;
  readonly version?: string;
  readonly evm: EvmAPI;
  readonly privacy: PrivacyAPI;
  constructor(provider: PlabsProvider) {
    super(provider);
    this.version = provider.version;
    this.evm = new EvmAPI(provider);
    this.privacy = new PrivacyAPI(provider);
  }
  /** With privacyScopes, request one explicit connection/read approval. Without options, EVM only. */
  async connect(options?: { privacyScopes: PrivacyReadScope[] }): Promise<WalletConnection> {
    if (options !== undefined) {
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'privacyScopes') || !Array.isArray(options.privacyScopes) || !options.privacyScopes.length || options.privacyScopes.length > 5 || options.privacyScopes.some(scope => !['address','balances','history','notes','dexOrders'].includes(scope))) throw new PlabsWalletError('Invalid privacy connection scopes.', -32602);
      return this.request('plabs_connect', [{ scopes: [...new Set(options.privacyScopes)] }]);
    }
    const accounts = await this.evm.connect();
    return { accounts, chainId: await this.evm.getChainId() };
  }
  getAccounts(): Promise<string[]> { return this.evm.getAccounts(); }
  capabilities(): Promise<PlabsCapabilities> { return this.request('plabs_getCapabilities'); }
  open(): Promise<{ opened: boolean }> { return this.request('plabs_openWallet'); }
  disconnect(): Promise<void> { return this.evm.disconnect(); }
}

export function isPlabsProvider(value: unknown): value is PlabsProvider {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const provider = value as Partial<PlabsProvider>;
  return provider.isPlabsWallet === true && typeof provider.request === 'function' && typeof provider.on === 'function' && typeof provider.removeListener === 'function';
}
export function getPlabsProvider(): PlabsProvider | null {
  if (typeof window === 'undefined') return null;
  const provider = (window as unknown as { plabsPrivacyWallet?: unknown }).plabsPrivacyWallet;
  return isPlabsProvider(provider) ? provider : null;
}
export function createPlabsWallet(provider: PlabsProvider): PlabsWallet {
  if (!provider || typeof provider.request !== 'function' || typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') {
    throw new PlabsWalletError('A compatible PLabs provider is required.', PLABS_ERROR_CODES.DISCONNECTED);
  }
  return new PlabsWallet(provider);
}
export function getPlabsWallet(selectedProvider?: PlabsProvider): PlabsWallet | null {
  const provider = selectedProvider ?? getPlabsProvider();
  return provider && isPlabsProvider(provider) ? createPlabsWallet(provider) : null;
}
export function isPlabsWalletInstalled(): boolean { return getPlabsProvider() !== null; }
