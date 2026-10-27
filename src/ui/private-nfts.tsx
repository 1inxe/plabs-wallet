import { ExternalLink, Gem, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NftAssetSummary } from '../privacy/nft/holdings';
import { callWallet } from '../shared/runtime';
import { walletErrorMessage } from '../shared/errors';
import { IconButton } from './primitives';
import { EmptyState } from './wallet-design';

type Snapshot = {
  chainId: 1;
  items: NftAssetSummary[];
  syncedAt: number | null;
  syncComplete: boolean;
  error?: string;
  progress?: string;
};
export function PrivateNfts({
  chainId,
  unlocked,
  automaticSync,
}: {
  chainId: number;
  unlocked: boolean;
  automaticSync: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const active = useRef(true),
    running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const read = async () => {
    try {
      const value = await callWallet<Snapshot>('GET_PRIVATE_NFT_ASSETS');
      if (active.current) setSnapshot(value);
    } catch (cause) {
      if (active.current) setError(walletErrorMessage(cause));
    }
  };
  const sync = async () => {
    if (running.current || !unlocked || chainId !== 1) return;
    running.current = true;
    setSyncing(true);
    setError('');
    try {
      const value = await callWallet<Snapshot>('SYNC_PRIVATE_NFT_ASSETS');
      if (active.current) setSnapshot(value);
    } catch (cause) {
      if (active.current) setError(walletErrorMessage(cause));
    } finally {
      running.current = false;
      if (active.current) setSyncing(false);
    }
  };
  useEffect(() => {
    if (!unlocked || chainId !== 1) return;
    void read();
    if (automaticSync) void sync();
    const timer = window.setInterval(() => {
      if (automaticSync && !running.current) void sync();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [chainId, unlocked, automaticSync]);
  useEffect(() => {
    if (!unlocked || chainId !== 1) return;
    const timer = window.setInterval(
      () => {
        void read();
      },
      syncing ? 2000 : 6000,
    );
    return () => window.clearInterval(timer);
  }, [syncing, unlocked, chainId]);
  return (
    <section className="panel private-nft-assets">
      <div className="row-between">
        <div>
          <h2>
            <Gem size={17} className="text-green" />
            隐私 NFT <span className="tiny-badge">pERC721</span>
          </h2>
          <small>独立的 NFT 资产 · 不计入代币余额</small>
        </div>
        <IconButton
          label="同步隐私 NFT"
          disabled={!unlocked || chainId !== 1 || syncing}
          onClick={() => void sync()}
        >
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
        </IconButton>
      </div>
      {!unlocked ? (
        <EmptyState>解锁隐私钱包后查看 NFT</EmptyState>
      ) : chainId !== 1 ? (
        <EmptyState>切换至 Ethereum 查看及同步隐私 NFT</EmptyState>
      ) : (
        <>
          {snapshot?.items.map((asset) => (
            <div className="private-nft-row" key={asset.id}>
              <span className="private-nft-icon">
                <Gem size={23} />
              </span>
              <div>
                <strong>
                  {asset.name} #{asset.tokenId}
                </strong>
                <small>
                  {asset.symbol} · {asset.state === 'pending' ? '铸造确认中' : '私有持有'} ·
                  Ethereum
                </small>
              </div>
              <a
                href={`https://etherscan.io/tx/${asset.txHash}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`查看 ${asset.name} #${asset.tokenId} 交易`}
              >
                <ExternalLink size={15} />
              </a>
            </div>
          ))}
          {!snapshot?.items.length && (
            <EmptyState>
              {syncing
                ? '正在扫描当前隐私账户的 NFT…'
                : snapshot?.syncComplete
                  ? '已同步，当前隐私地址暂无 NFT'
                  : 'NFT 尚未完成同步，点击右上角同步'}
            </EmptyState>
          )}
          {syncing && (
            <p className="micro text-muted" role="status">
              {snapshot?.progress ?? '正在核对 NFT 链上记录…'}
            </p>
          )}
          {(snapshot?.error || error) && (
            <p className="private-nft-error" role="alert">
              {error || snapshot?.error}；已有资产和恢复资料已保留。
            </p>
          )}
          {snapshot?.syncedAt && (
            <p className="micro text-muted">
              上次完整同步 {new Date(snapshot.syncedAt).toLocaleString()}
            </p>
          )}
          <p className="micro text-muted">
            自动识别 mint 和转入的 NFT；已转出的 Note 会在同步后移出持有列表。
          </p>
        </>
      )}
    </section>
  );
}
