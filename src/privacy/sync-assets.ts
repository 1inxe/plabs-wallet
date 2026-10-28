/** Start NFT discovery immediately while fungible history catches up independently. */
export async function syncPrivacyAssets<T>(ports: {
  tokens(): Promise<T>;
  nfts?: () => Promise<{ syncComplete: boolean; error?: string }>;
  guard(): Promise<void>;
  phase(value: 'tokens' | 'nfts'): void;
}): Promise<T> {
  const failures: string[] = [];
  let snapshots: T | undefined;
  let tokensDone = false;
  await ports.guard();
  ports.phase(ports.nfts ? 'nfts' : 'tokens');
  const nftJob = ports.nfts
    ? (async () => {
        try {
          await ports.guard();
          const result = await ports.nfts!();
          if (result.error || !result.syncComplete)
            throw new Error(result.error || 'NFT 尚未同步完成，请继续同步');
        } catch (cause) {
          failures.push(
            `NFT：${cause instanceof Error ? cause.message : String(cause)}`,
          );
        } finally {
          if (!tokensDone) ports.phase('tokens');
        }
      })()
    : Promise.resolve();
  const tokenJob = (async () => {
    try {
      await ports.guard();
      snapshots = await ports.tokens();
    } catch (cause) {
      failures.push(
        `代币：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      tokensDone = true;
    }
  })();
  await Promise.all([nftJob, tokenJob]);
  await ports.guard();
  if (failures.length)
    throw new Error(`部分隐私资产同步未完成：${failures.join('；')}`);
  return snapshots!;
}
