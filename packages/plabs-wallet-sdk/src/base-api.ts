// Chain API wrapper pattern adapted from Noir Wallet SDK; no Zcash RPC is retained.
import { toPlabsWalletError } from './errors.js';
import type { PlabsEvents, PlabsProvider, ProviderListener } from './types.js';
export class BaseAPI {
  constructor(public readonly provider: PlabsProvider) {}
  protected async request<T>(method: string, params?: unknown[]): Promise<T> {
    try { return await this.provider.request({ method, ...(params ? { params } : {}) }) as T; }
    catch (cause) { throw toPlabsWalletError(cause); }
  }
  on<K extends keyof PlabsEvents>(event: K, handler: (payload: PlabsEvents[K]) => void): this {
    this.provider.on(event, handler as ProviderListener); return this;
  }
  removeListener<K extends keyof PlabsEvents>(event: K, handler: (payload: PlabsEvents[K]) => void): this {
    this.provider.removeListener(event, handler as ProviderListener); return this;
  }
  subscribe<K extends keyof PlabsEvents>(event: K, handler: (payload: PlabsEvents[K]) => void): () => void {
    this.on(event, handler); return () => { this.removeListener(event, handler); };
  }
}
