import { NETWORKS } from '../shared/networks';
import type { ChainId, PrivacyPoolSnapshot } from '../shared/types';
/** Keep every configured pool visible, including zero balances and not-yet-scanned pools. */
export function officialAssets(
  chainId: ChainId,
  snapshots: PrivacyPoolSnapshot[],
  privacyAddress: string,
): PrivacyPoolSnapshot[] {
  const network = NETWORKS[chainId],
    current = snapshots.filter((s) => s.chainId === chainId);
  const pools = network.plabs?.pools ?? [];
  return [
    ...pools.map(
      (pool) =>
        current.find(
          (s) => s.poolAddress.toLowerCase() === pool.address.toLowerCase(),
        ) ?? {
          version: 1 as const,
          chainId,
          poolAddress: pool.address.toLowerCase(),
          symbol: pool.symbol,
          decimals: pool.decimals,
          privacyAddress,
          cursorBlock: 0,
          cursorBlockHash: '',
          targetBlock: 0,
          syncState: 'partial' as const,
          totalBalanceRaw: '0',
          spendableBalanceRaw: '0',
          totalNotes: 0,
          spendableNotes: 0,
          pendingNotes: 0,
          spentNotes: 0,
          syncedAt: 0,
        },
    ),
    ...current.filter(
      (s) =>
        !pools.some(
          (p) => p.address.toLowerCase() === s.poolAddress.toLowerCase(),
        ),
    ),
  ];
}
