// Isolate the reviewed NFT proving build from the existing fungible-asset engines.
// The extension CSP forbids blob workers. Make snarkjs use its in-worker
// single-thread path instead of waiting forever for a blocked nested worker.
Object.defineProperty(self, 'Worker', { value: undefined, configurable: false, writable: false });
const assetUrl = (path: string) =>
  new URL(path.startsWith('/wasm/') ? `/nft${path}` : path, self.location.origin).href;
const originalFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url =
    typeof input === 'string'
      ? new URL(input, self.location.href)
      : input instanceof URL
        ? input
        : new URL(input.url);
  return originalFetch(
    url.origin === self.location.origin && url.pathname.startsWith('/wasm/')
      ? assetUrl(url.pathname)
      : input,
    init,
  );
};
(
  self as unknown as { __plabsResolveWasmAsset: (path: string) => Promise<string> }
).__plabsResolveWasmAsset = async (path) => assetUrl(path);
const waiting: MessageEvent[] = [];
self.onmessage = (event) => {
  waiting.push(event);
};
void import(/* @vite-ignore */ new URL('./nft/groth16-prover.bundle.js', self.location.href).href)
  .then(() => {
    const handler = self.onmessage;
    for (const event of waiting) handler?.call(self, event);
    waiting.length = 0;
  })
  .catch((error) => {
    const fail = (event: MessageEvent) =>
      self.postMessage({
        id: event.data?.id,
        ok: false,
        error: `NFT prover initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    self.onmessage = fail;
    for (const event of waiting) fail(event);
    waiting.length = 0;
  });
export {};
