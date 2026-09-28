import plabsIcon from './assets/plabs-icon-data';

type Listener = (...args: unknown[]) => void;
let nextRequestId = 0;

class PlabsProvider {
  readonly isPlabsWallet = true;
  private listeners = new Map<string, Set<Listener>>();
  #networkConnected = false;

  request({ method, params }: { method: string; params?: unknown[] | Record<string, unknown> }) {
    if (typeof method !== 'string' || !method || (params !== undefined && (params === null || typeof params !== 'object'))) return Promise.reject(Object.assign(new Error('无效的 Provider 请求参数'), { code: -32602 }));
    const id = `plabs-${++nextRequestId}-${Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    return new Promise<unknown>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'plabs-wallet-content' || event.data?.id !== id) {
          return;
        }
        window.removeEventListener('message', handler);
        if (event.data.error) {
          const error = Object.assign(new Error(event.data.error.message), { code: event.data.error.code });
          if (error.code === 4900 && this.#networkConnected) { this.#networkConnected = false; this.emit('disconnect', error); }
          reject(error);
        } else {
          if (method === 'eth_chainId' && !this.#networkConnected) { this.#networkConnected = true; this.emit('connect', { chainId: event.data.result }); }
          resolve(event.data.result);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ source: 'plabs-wallet-provider', id, method, params }, window.location.origin);
    });
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload: unknown) {
    for (const listener of this.listeners.get(event) ?? []) { try { listener(payload); } catch (error) { console.error('PLabs provider event listener failed', error); } }
  }
}

const provider = Object.freeze(new PlabsProvider());
const info = Object.freeze({
  uuid: crypto.randomUUID(),
  name: 'PLabs Privacy Wallet',
  icon: plabsIcon,
  rdns: 'local.plabs.privacywallet',
});

Object.defineProperty(window, 'brushPrivacyWallet', { value: provider, configurable: false });
Object.defineProperty(window, 'plabsPrivacyWallet', { value: provider, configurable: false });

const announce = () =>
  window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }),
  );

window.addEventListener('eip6963:requestProvider', announce);
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'plabs-wallet-content' || !event.data?.event) return;
  provider.emit(event.data.event, event.data.payload);
});
announce();

declare global {
  interface Window {
    brushPrivacyWallet: PlabsProvider;
    plabsPrivacyWallet: PlabsProvider;
  }
}

export {};
