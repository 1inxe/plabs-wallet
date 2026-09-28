// Provider detection adapted from Noir Wallet SDK; EIP-6963 replaces its Zcash event.
import { getPlabsProvider, isPlabsProvider } from './provider.js';
import { PLABS_ERROR_CODES, PlabsWalletError } from './errors.js';
import type { DiscoveredPlabsWallet, PlabsProvider } from './types.js';

/** Observe discovery without connecting, requesting signatures or opening the wallet. */
export function discoverPlabsWallets(onWallet: (wallet: DiscoveredPlabsWallet) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const seen = new Set<PlabsProvider>();
  const deliver = (wallet: DiscoveredPlabsWallet) => {
    if (seen.has(wallet.provider)) return;
    seen.add(wallet.provider); onWallet(wallet);
  };
  const handler = (event: Event) => {
    const wallet = (event as CustomEvent<DiscoveredPlabsWallet>).detail;
    if (!wallet || !isPlabsProvider(wallet.provider) || !wallet.info) return;
    if (![wallet.info.uuid, wallet.info.name, wallet.info.icon, wallet.info.rdns].every(value => typeof value === 'string')) return;
    deliver(wallet);
  };
  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const provider = getPlabsProvider();
  if (provider) deliver({ provider, info: { uuid: 'plabs-injected-fallback', name: 'PLabs Privacy Wallet', icon: '', rdns: 'local.plabs.privacywallet' } });
  return () => window.removeEventListener('eip6963:announceProvider', handler);
}
export interface DetectProviderOptions { timeoutMs?: number; signal?: AbortSignal }
export function detectPlabsProvider(options: DetectProviderOptions = {}): Promise<PlabsProvider> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new PlabsWalletError('Wallet discovery is only available in a browser.', PLABS_ERROR_CODES.DISCONNECTED)); return; }
    const timeoutMs = options.timeoutMs ?? 3000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000) { reject(new PlabsWalletError('timeoutMs must be an integer from 0 to 60000.', PLABS_ERROR_CODES.INVALID_PARAMS)); return; }
    if (options.signal?.aborted) { reject(new PlabsWalletError('Wallet discovery was aborted.', PLABS_ERROR_CODES.DISCONNECTED)); return; }
    let settled = false;
    let stop = () => {};
    const finish = (provider?: PlabsProvider, message = 'PLabs Wallet was not detected. Install or unlock the extension, then refresh the page.') => {
      if (settled) return; settled = true;
      clearTimeout(timer); stop(); options.signal?.removeEventListener('abort', abort);
      provider ? resolve(provider) : reject(new PlabsWalletError(message, PLABS_ERROR_CODES.DISCONNECTED));
    };
    const abort = () => finish(undefined, 'Wallet discovery was aborted.');
    const timer = setTimeout(() => finish(), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    stop = discoverPlabsWallets(wallet => finish(wallet.provider));
    // Discovery may complete synchronously before the disposer is assigned.
    if (settled) stop();
  });
}
