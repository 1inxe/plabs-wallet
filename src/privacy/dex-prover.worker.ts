// DEX uses its own pinned WASM build; existing transfer/shield proving remains unchanged.
const assetUrl = (path: string) =>
  new URL(path.startsWith('/wasm/') ? `/dex${path}` : path, self.location.origin).href;
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
self.onmessage = (event) => waiting.push(event);
void import(/* @vite-ignore */ new URL('./dex/groth16-prover.bundle.js', self.location.href).href)
  .then(() => {
    const handler = self.onmessage;
    for (const event of waiting) handler?.call(self, event);
    waiting.length = 0;
  })
  .catch((error) => {
    for (const event of waiting)
      self.postMessage({
        id: event.data.id,
        ok: false,
        error: `DEX prover could not initialize: ${error instanceof Error ? error.message : String(error)}`,
      });
    waiting.length = 0;
  });
export {};
