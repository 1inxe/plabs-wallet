import type { ProviderRequest } from './types';

export class BoundaryError extends Error { constructor(public code: number, message: string) { super(message); } }
const origins = new Map<string, { since: number; count: number; active: number }>();
let totalActive = 0;
let globalWindow = { since: 0, count: 0 };
// Admission runs before expensive session restoration or network/proof work.
export function admitDappRequest(sender: chrome.runtime.MessageSender, request: ProviderRequest) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !sender.url)
    throw new BoundaryError(4100, '只接受当前顶层网页的钱包请求');
  const origin = new URL(sender.url).origin;
  if (!/^https:\/\//.test(origin) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))
    throw new BoundaryError(4100, '只允许 HTTPS 或本机开发站点');
  if (!request || request.source !== 'plabs-wallet-provider' || typeof request.id !== 'string' || request.id.length > 160 ||
      typeof request.method !== 'string' || !request.method || request.method.length > 80)
    throw new BoundaryError(-32602, '无效的网站请求');
  if (JSON.stringify(request).length > 100_000) throw new BoundaryError(-32602, '网站请求过大');
  const now = Date.now();
  for (const [key, row] of origins) if (!row.active && now - row.since >= 60_000) origins.delete(key);
  if (now - globalWindow.since >= 60_000) globalWindow = { since: now, count: 0 };
  let row = origins.get(origin);
  if (!row) {
    if (origins.size >= 128) throw new BoundaryError(-32005, '钱包请求来源过多，请稍后重试');
    row = { since: now, count: 0, active: 0 }; origins.set(origin, row);
  }
  if (now - row.since >= 60_000) { row.since = now; row.count = 0; }
  if (row.count >= 120 || globalWindow.count >= 600 || row.active >= 4 || totalActive >= 16)
    throw new BoundaryError(-32005, '钱包请求过于频繁，请稍后重试');
  row.count++; globalWindow.count++; row.active++; totalActive++;
  let released = false;
  return () => { if (!released) { released = true; row!.active--; totalActive--; } };
}

export function validateReadRpc(method: string, params: unknown[] | Record<string, unknown>) {
  if (!Array.isArray(params) || params.length > 5) throw new BoundaryError(-32602, 'RPC 参数必须为有界数组');
  if (method === 'eth_getLogs') {
    const filter = params[0] as Record<string, unknown> | undefined;
    if (!filter || typeof filter !== 'object' || Array.isArray(filter) || !filter.address)
      throw new BoundaryError(-32602, '日志查询需要指定合约');
    if (Array.isArray(filter.address) && filter.address.length > 10) throw new BoundaryError(-32602, '一次最多查询 10 个合约');
    if (!filter.blockHash) {
      if (typeof filter.fromBlock !== 'string' || typeof filter.toBlock !== 'string' ||
          !/^0x[0-9a-f]{1,16}$/i.test(filter.fromBlock) || !/^0x[0-9a-f]{1,16}$/i.test(filter.toBlock))
        throw new BoundaryError(-32602, '日志查询须使用明确的十六进制区块范围');
      const from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
      if (to < from || to - from > 2000n) throw new BoundaryError(-32602, '一次最多查询 2,001 个区块');
    }
  }
  if (method === 'eth_feeHistory') {
    const count = params[0];
    if (typeof count !== 'string' || !/^0x[0-9a-f]{1,4}$/i.test(count) || BigInt(count) > 1024n)
      throw new BoundaryError(-32602, '费用历史查询最多 1,024 个区块');
  }
}
