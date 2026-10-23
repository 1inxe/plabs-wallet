(self as unknown as { __plabsResolveWasmAsset: (assetPath: string) => Promise<string> })
  .__plabsResolveWasmAsset = async (assetPath: string) =>
  new URL(`.${assetPath}`, self.location.origin).href;

const queued: MessageEvent[] = [];
self.onmessage = (event) => queued.push(event);
void import(/* @vite-ignore */ new URL('./groth16-prover.bundle.js', self.location.href).href).then(() => {
  const handler = self.onmessage;
  for (const event of queued) handler?.call(self, event);
}).catch((error) => {
  const message = `隐私证明 Worker 初始化失败: ${error instanceof Error ? error.message : String(error)}`;
  const reject = (event: MessageEvent) => self.postMessage({ id: event.data?.id, ok: false, error: message });
  // Requests arriving after a failed import must fail too, rather than queue forever.
  self.onmessage = reject;
  for (const event of queued) {
    reject(event);
  }
  queued.length = 0;
});

export {};
