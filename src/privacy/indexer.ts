import { NETWORKS } from '../shared/networks';
import { readJsonResponse } from '../shared/network-response';
import type { ChainId } from '../shared/types';

// Proof inputs can be served by a different indexer for each pool on a chain.
const poolIndexer = (chainId: ChainId, poolAddress: string) => {
  const plabs = NETWORKS[chainId].plabs;
  const pool = plabs?.pools.find(item => item.address.toLowerCase() === poolAddress.toLowerCase());
  if (!plabs || !pool) throw new Error('资产池不在当前审核配置中');
  return { url: pool.indexerUrl ?? plabs.indexerUrl, pool };
};

const request = async (chainId: ChainId, poolAddress: string, path: string, params: Record<string, string> = {}) => {
  const { url, pool } = poolIndexer(chainId, poolAddress);
  const query = new URLSearchParams({ pool: pool.address.toLowerCase(), ...params });
  const response = await fetch(`${url}${path}?${query}`, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (path === '/merkle_path' && (response.status === 404 || response.status === 409)) {
    await response.body?.cancel();
    throw new Error(`${pool.symbol} 凭证的证明路径尚未被索引服务确认，请同步隐私资产后稍后重试（HTTP ${response.status}）`);
  }
  return readJsonResponse(response, 8_000_000);
};

export const fetchMerklePath = (chainId: ChainId, poolAddress: string, cmxHex: string) =>
  request(chainId, poolAddress, '/merkle_path', { cmx: cmxHex });

export const fetchFrozenLeaves = (chainId: ChainId, poolAddress: string) =>
  request(chainId, poolAddress, '/frozen_leaves');
