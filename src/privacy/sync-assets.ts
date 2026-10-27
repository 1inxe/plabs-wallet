/** Both asset types finish before the wallet reports a completed synchronization. */
export async function syncPrivacyAssets<T>(ports: {
  tokens(): Promise<T>;
  nfts?: () => Promise<{ syncComplete: boolean; error?: string }>;
  guard(): Promise<void>;
  phase(value: 'tokens' | 'nfts'): void;
}): Promise<T> {
  const failures: string[] = [];
  let snapshots: T | undefined;
  await ports.guard();
  ports.phase('tokens');
  try {
    snapshots = await ports.tokens();
  } catch (cause) {
    failures.push(
      `代币：${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  await ports.guard();
  if (ports.nfts) {
    ports.phase('nfts');
    try {
      const result = await ports.nfts();
      if (result.error || !result.syncComplete)
        throw new Error(result.error || 'NFT 尚未同步完成，请继续同步');
    } catch (cause) {
      failures.push(
        `NFT：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  await ports.guard();
  if (failures.length)
    throw new Error(`部分隐私资产同步未完成：${failures.join('；')}`);
  return snapshots!;
}
