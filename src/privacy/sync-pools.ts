// Keep pools sequential to avoid overloading the shared workers/RPC, but do
// not let a failed or page-limited pool starve the remaining assets.
export async function syncPrivacyPools<P extends { symbol: string }, T>(
  pools: readonly P[],
  sync: (pool: P) => Promise<T>,
): Promise<T[]> {
  const snapshots: T[] = [];
  const failures: string[] = [];
  for (const pool of pools) {
    try {
      snapshots.push(await sync(pool));
    } catch (cause) {
      failures.push(`${pool.symbol}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (failures.length) throw new Error(`部分隐私资产同步失败（其他资产已继续同步）：${failures.join('；')}`);
  return snapshots;
}
