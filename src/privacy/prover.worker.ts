(self as unknown as { __plabsResolveWasmAsset: (assetPath: string) => Promise<string> })
  .__plabsResolveWasmAsset = async (assetPath: string) =>
  new URL(`.${assetPath}`, self.location.origin).href;

const queued: MessageEvent[] = [];
self.onmessage = (event) => queued.push(event);
void import(/* @vite-ignore */ new URL('./groth16-prover.bundle.js', self.location.href).href).then(() => {
  const handler = self.onmessage;
  for (const event of queued) handler?.call(self, event);
}).catch((error) => {
  for (const event of queued) {
    self.postMessage({
      id: event.data?.id,
      ok: false,
      error: `隐私证明 Worker 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

export {};
