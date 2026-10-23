type Pending = {
  method: string;
  startedAt: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** A dead proof worker must release its callers, including the merge queue. */
export function createProverClient(createWorker: () => Worker, timeoutFor = (method: string) =>
  ['prove', 'prove_note', 'shield_prove'].includes(method) ? 600_000 : method === 'init' ? 120_000 : 60_000) {
  let worker: Worker | undefined;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  const fail = (message: string) => {
    const failed = worker;
    worker = undefined;
    if (failed) {
      failed.onmessage = null; failed.onerror = null; failed.onmessageerror = null;
      failed.terminate();
    }
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  };
  const connect = () => {
    if (worker) return worker;
    const current = createWorker();
    worker = current;
    current.onmessage = event => {
      if (worker !== current) return;
      const request = pending.get(event.data?.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(event.data.id);
      if (event.data.ok) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error || '隐私证明生成失败'));
    };
    current.onerror = event => {
      event.preventDefault();
      if (worker === current) fail('隐私证明线程异常退出，准备已停止，请重试；若再次失败，请减少每批合并数量');
    };
    current.onmessageerror = () => {
      if (worker === current) fail('隐私证明线程响应无法读取，准备已停止，请重试');
    };
    return current;
  };
  return {
    progress() {
      const requests = [...pending.values()];
      const request = requests.find(item => ['prove', 'prove_note', 'shield_prove'].includes(item.method))
        ?? requests.find(item => item.method === 'init') ?? requests[0];
      return { phase: !request ? 'idle' : request.method === 'init' ? 'initializing'
        : ['prove', 'prove_note', 'shield_prove'].includes(request.method) ? 'proving' : 'checking',
      startedAt: request?.startedAt ?? null };
    },
    call(method: string, body: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        let current: Worker;
        try { current = connect(); } catch { reject(new Error('隐私证明线程无法启动，请重新加载插件后重试')); return; }
        const id = ++nextId;
        const timer = setTimeout(() => fail(method === 'init'
          ? '隐私证明文件加载超时，准备已停止，请重新加载插件后重试'
          : '隐私证明处理超时，准备已停止，请减少每批合并数量后重试'), timeoutFor(method));
        pending.set(id, { method, startedAt: Date.now(), resolve, reject, timer });
        try { current.postMessage({ id, method, body }); }
        catch { fail('隐私证明请求发送失败，准备已停止，请重试'); }
      });
    },
  };
}
