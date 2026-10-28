import { NETWORKS, isSupportedChainId } from '../shared/networks';
import type { ChainId } from '../shared/types';
import { readJsonResponse } from '../shared/network-response';

export interface MarketQuote {
  usd: number;
  change24h: number | null;
  updatedAt: number;
  stale?: boolean;
}
export interface MarketPrices {
  quotes: Record<string, MarketQuote>;
  fetchedAt: number;
  unavailable: boolean;
  source: 'DefiLlama';
}
export const marketKey = (
  chainId: number,
  kind: 'native' | 'erc20' | 'private',
  address = '',
) => `${chainId}:${kind}${address ? ':' + address.toLowerCase() : ''}`;
const chains: Record<ChainId, string> = {
  1: 'ethereum',
  143: 'monad',
  8453: 'base',
  42161: 'arbitrum',
};
// Canonical contracts only; a token calling itself USDC/ETH never inherits a quote.
const canonical: Record<string, { id: string; decimals: number }> = {
  '1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
    id: 'usd-coin',
    decimals: 6,
  },
  '1:0xdac17f958d2ee523a2206206994597c13d831ec7': { id: 'tether', decimals: 6 },
  '1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
    id: 'ethereum',
    decimals: 18,
  },
  '143:0x754704bc059f8c67012fed69bc8a327a5aafb603': {
    id: 'usd-coin',
    decimals: 6,
  },
};
interface Binding {
  key: string;
  id: string;
  decimals?: number;
  scale?: string;
  poolDecimals?: number;
}
export function priceBindings(chainId: number, contracts: unknown): Binding[] {
  if (
    !isSupportedChainId(chainId) ||
    !Array.isArray(contracts) ||
    contracts.length > 150 ||
    contracts.some((a) => typeof a !== 'string' || !/^0x[0-9a-f]{40}$/i.test(a))
  )
    throw Error('无效的价格查询');
  const token = (address: string) => {
    const known = canonical[`${chainId}:${address.toLowerCase()}`];
    return {
      id: known
        ? 'coingecko:' + known.id
        : `${chains[chainId]}:${address.toLowerCase()}`,
      decimals: known?.decimals,
    };
  };
  const pools = NETWORKS[chainId].plabs?.pools ?? [];
  return [
    {
      key: marketKey(chainId, 'native'),
      id: 'coingecko:' + (chainId === 143 ? 'monad' : 'ethereum'),
    },
    ...[
      ...new Set(
        [
          ...contracts,
          ...pools.flatMap((p) => (p.underlying ? [p.underlying] : [])),
        ].map((a) => a.toLowerCase()),
      ),
    ].map((address) => ({
      key: marketKey(chainId, 'erc20', address),
      ...token(address),
    })),
    ...pools
      .filter((p) => p.underlying)
      .map((p) => ({
        key: marketKey(chainId, 'private', p.address),
        ...token(p.underlying!),
        scale: p.scale ?? '1',
        poolDecimals: p.decimals,
      })),
  ];
}
export function createMarketPrices({
  fetcher = fetch,
  now = Date.now,
}: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const cache = new Map<string, MarketQuote>(),
    pending = new Map<string, Promise<void>>(),
    attempted = new Map<string, number>(),
    decimals = new Map<string, number>();
  const ttl = 60_000,
    maxAge = 30 * 60_000;
  async function load(ids: string[]) {
    const key = ids.join(',');
    for (const id of ids) attempted.set(id, now());
    const job = (async () => {
      const request = async (path: string) =>
        readJsonResponse(
          await fetcher('https://coins.llama.fi' + path, {
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: AbortSignal.timeout(10_000),
          }),
          300_000,
        );
      const [prices, changes] = await Promise.allSettled([
        request('/prices/current/' + key),
        request('/percentage/' + key + '?period=24h'),
      ]);
      if (prices.status !== 'fulfilled') throw prices.reason;
      const values = prices.value?.coins;
      if (!values || typeof values !== 'object') throw Error('价格数据不可用');
      for (const id of ids) {
        const value = values[id];
        if (
          !value ||
          typeof value.price !== 'number' ||
          !Number.isFinite(value.price) ||
          value.price < 0 ||
          typeof value.timestamp !== 'number' ||
          !Number.isFinite(value.timestamp) ||
          value.timestamp * 1000 > now() + 120_000 ||
          now() - value.timestamp * 1000 > maxAge ||
          (value.confidence !== undefined &&
            (!Number.isFinite(value.confidence) || value.confidence < 0.5))
        )
          continue;
        const change =
          changes.status === 'fulfilled' ? changes.value?.coins?.[id] : null;
        if (
          Number.isInteger(value.decimals) &&
          value.decimals >= 0 &&
          value.decimals <= 36
        )
          decimals.set(id, value.decimals);
        cache.set(id, {
          usd: value.price,
          change24h:
            typeof change === 'number' &&
            Number.isFinite(change) &&
            change > -100
              ? change
              : null,
          updatedAt: value.timestamp * 1000,
        });
      }
    })();
    for (const id of ids) pending.set(id, job);
    try {
      await job;
    } finally {
      for (const id of ids) pending.delete(id);
    }
  }
  return async (
    chainId: number,
    contracts: unknown = [],
  ): Promise<MarketPrices> => {
    const bindings = priceBindings(chainId, contracts);
    const ids = [...new Set(bindings.map((b) => b.id))].sort();
    const waits = [
      ...new Set(
        ids.flatMap((id) => (pending.has(id) ? [pending.get(id)!] : [])),
      ),
    ];
    const missing = ids.filter(
      (id) =>
        !pending.has(id) &&
        (!attempted.has(id) || now() - attempted.get(id)! >= ttl),
    );
    let failed = false;
    if (missing.length) {
      try {
        await load(missing);
      } catch {
        failed = true;
      }
    }
    if (waits.length) {
      const results = await Promise.allSettled(waits);
      failed ||= results.some((r) => r.status === 'rejected');
    }
    const quotes: Record<string, MarketQuote> = {};
    for (const b of bindings) {
      const quote = cache.get(b.id);
      if (!quote || now() - quote.updatedAt > maxAge) continue;
      let multiplier = 1;
      if (b.poolDecimals !== undefined) {
        const underlyingDecimals = b.decimals ?? decimals.get(b.id);
        if (underlyingDecimals === undefined) continue;
        multiplier =
          Number(b.scale) * 10 ** (b.poolDecimals - underlyingDecimals);
        if (!Number.isFinite(multiplier) || multiplier <= 0) continue;
      }
      quotes[b.key] = {
        ...quote,
        usd: quote.usd * multiplier,
        stale: failed || now() - quote.updatedAt > 5 * ttl,
      };
    }
    return {
      quotes,
      fetchedAt: now(),
      unavailable: failed || !quotes[marketKey(chainId, 'native')],
      source: 'DefiLlama',
    };
  };
}
