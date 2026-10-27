import { ExternalLink, Gem, RefreshCw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NftAssetSummary } from '../privacy/nft/holdings';
import { callWallet } from '../shared/runtime';
import { walletErrorMessage } from '../shared/errors';
import { Button, IconButton, PageView } from './primitives';
import { CopyButton } from './wallet-design';
import { NftArtwork } from './nft-artwork';
import { parsePrivacyAddress, formatPrivacyAddress } from '../privacy/address';
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
  managedSync,
}: {
  chainId: number;
  unlocked: boolean;
  automaticSync: boolean;
  managedSync?: { busy: boolean; revision: number };
}) {
  const managed = Boolean(managedSync);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (
      !unlocked ||
      chainId !== 1 ||
      (selected &&
        snapshot &&
        !snapshot.items.some((asset) => asset.id === selected))
    ) {
      setSelected(null);
      setSending(false);
    }
  }, [unlocked, chainId, selected, snapshot]);
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
    if (managed) return;
    if (automaticSync) void sync();
    const timer = window.setInterval(() => {
      if (automaticSync && !running.current) void sync();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [chainId, unlocked, automaticSync, managed, managedSync?.revision]);
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
  const isSyncing = managedSync?.busy ?? syncing;
  const selectedAsset = snapshot?.items.find((asset) => asset.id === selected);
  return (
    <section className="panel private-nft-assets">
      <div className="row-between">
        <div>
          <h2>
            <Gem size={17} className="text-green" />
            隐私 NFT <span className="tiny-badge">pERC721</span>
          </h2>
          <small>私有持有 · Ethereum</small>
        </div>
        {!managed && (
          <IconButton
            label="同步隐私 NFT"
            disabled={!unlocked || chainId !== 1 || syncing}
            onClick={() => void sync()}
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          </IconButton>
        )}
      </div>
      {!unlocked ? (
        <EmptyState>解锁隐私钱包后查看 NFT</EmptyState>
      ) : chainId !== 1 ? (
        <EmptyState>切换至 Ethereum 查看及同步隐私 NFT</EmptyState>
      ) : (
        <>
          <div className="private-nft-grid">
            {snapshot?.items.map((asset) => (
              <article className="private-nft-card" key={asset.id}>
                <div className="private-nft-art">
                  <NftArtwork
                    pool={asset.poolAddress}
                    tokenId={asset.tokenId}
                    name={asset.name}
                  />
                  <button
                    type="button"
                    className="nft-art-open"
                    aria-label={`查看 ${asset.name} #${asset.tokenId}`}
                    onClick={() => setSelected(asset.id)}
                  />
                  {asset.state === 'pending' && (
                    <span className="nft-pending-badge">确认中</span>
                  )}
                </div>
                <button
                  type="button"
                  className="private-nft-copy"
                  onClick={() => setSelected(asset.id)}
                >
                  <strong>{asset.name}</strong>
                  <span>
                    #{asset.tokenId}
                    <small>
                      {asset.state === 'pending' ? '铸造确认中' : '私有持有'}
                    </small>
                  </span>
                </button>
              </article>
            ))}
          </div>
          {!snapshot?.items.length && (
            <EmptyState>
              {isSyncing
                ? '正在扫描当前隐私账户的 NFT…'
                : snapshot?.syncComplete
                  ? '已同步，当前隐私地址暂无 NFT'
                  : managed
                    ? 'NFT 尚未完成同步，点击上方同步隐私资产'
                    : 'NFT 尚未完成同步，点击右上角同步'}
            </EmptyState>
          )}
          {!managed && syncing && (
            <p className="micro text-muted" role="status">
              正在同步…
            </p>
          )}
          {(snapshot?.error || error) && (
            <p className="private-nft-error" role="alert">
              {error || snapshot?.error}；已有资产和恢复资料已保留。
            </p>
          )}
        </>
      )}
      {selectedAsset && unlocked && chainId === 1 && (
        <PageView
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
              setSending(false);
            }
          }}
          title={`${selectedAsset.name} #${selectedAsset.tokenId}`}
          description="Ethereum · pERC721 隐私 NFT"
        >
          <div className="nft-detail-art">
            <NftArtwork
              pool={selectedAsset.poolAddress}
              tokenId={selectedAsset.tokenId}
              name={selectedAsset.name}
              full
            />
          </div>
          <div className="panel form-stack">
            <div className="row-between">
              <span>持有状态</span>
              <strong>
                {selectedAsset.state === 'pending'
                  ? '等待链上确认'
                  : '私有持有'}
              </strong>
            </div>
            <div className="row-between">
              <span>编号</span>
              <strong>#{selectedAsset.tokenId}</strong>
            </div>
            <div>
              <small>合集地址</small>
              <p className="mono break-all">{selectedAsset.poolAddress}</p>
              <CopyButton
                compact
                value={selectedAsset.poolAddress}
                label="复制 NFT 合集地址"
              />
            </div>
          </div>
          <Button
            variant="primary"
            className="w-full"
            disabled={selectedAsset.state !== 'confirmed'}
            onClick={() => setSending(true)}
          >
            <Send size={16} />
            {selectedAsset.transfer?.state === 'submitted'
              ? '查看发送进度'
              : '发送 NFT'}
          </Button>
          {sending && (
            <NftSend
              asset={selectedAsset}
              onClose={() => setSending(false)}
              onChanged={() => void read()}
            />
          )}
          <a
            className="explorer-link"
            href={`https://etherscan.io/tx/${selectedAsset.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            查看链上交易 <ExternalLink size={14} />
          </a>
        </PageView>
      )}
    </section>
  );
}

type TransferStatus = {
  id: string;
  state: string;
  recipient: string;
  txHash?: string;
  message?: string;
};
function NftSend({
  asset,
  onClose,
  onChanged,
}: {
  asset: NftAssetSummary;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [recipient, setRecipient] = useState(
    asset.transfer?.recipient
      ? formatPrivacyAddress(asset.transfer.recipient)
      : '',
  );
  const [transfer, setTransfer] = useState<TransferStatus | null>(
    asset.transfer ?? null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = async () => {
    if (!transfer?.id) return;
    try {
      const result = await callWallet<TransferStatus>(
        'GET_PRIVATE_NFT_TRANSFER',
        { id: transfer.id },
      );
      if (alive.current) {
        setTransfer(result);
        onChanged();
      }
    } catch (cause) {
      if (alive.current) setError(walletErrorMessage(cause));
    }
  };
  useEffect(() => {
    if (transfer?.state !== 'submitted') return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 6000);
    return () => window.clearInterval(timer);
  }, [transfer?.id, transfer?.state]);
  const send = async () => {
    if (busy) return;
    setError('');
    try {
      parsePrivacyAddress(recipient);
    } catch (cause) {
      setError(walletErrorMessage(cause));
      return;
    }
    setBusy(true);
    try {
      const result = await callWallet<TransferStatus>('SEND_PRIVATE_NFT', {
        assetId: asset.id,
        recipient,
      });
      if (alive.current) {
        setTransfer(result);
        onChanged();
      }
    } catch (cause) {
      if (alive.current) setError(walletErrorMessage(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const pending = transfer?.state === 'submitted',
    done = transfer?.state === 'confirmed';
  return (
    <PageView
      open
      busy={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="发送 NFT"
      description={`${asset.name} #${asset.tokenId}`}
    >
      <div className="panel nft-send-form">
        <label htmlFor="nft-recipient">接收方隐私地址</label>
        <textarea
          id="nft-recipient"
          value={recipient}
          disabled={busy || pending || done}
          placeholder="perc1…"
          onChange={(event) => setRecipient(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <small>
          请填写接收方的 PLabs 隐私地址。Gas 使用 Ethereum 公开账户的 ETH 支付。
        </small>
        <Button
          variant="primary"
          disabled={busy || pending || done || !recipient.trim()}
          onClick={() => void send()}
        >
          {busy
            ? '正在生成证明，请稍候…'
            : done
              ? '已发送'
              : pending
                ? '等待链上确认'
                : '确认发送并查看 Gas'}
        </Button>
      </div>
      {pending && (
        <p role="status" className="panel text-mint micro">
          已提交，等待确认。可以关闭此页，发送记录会保留。
        </p>
      )}
      {done && (
        <p role="status" className="panel text-mint micro">
          NFT 已发送至接收方隐私地址。
        </p>
      )}
      {transfer?.txHash && (
        <a
          className="explorer-link"
          href={`https://etherscan.io/tx/${transfer.txHash}`}
          target="_blank"
          rel="noreferrer"
        >
          查看发送交易
          <ExternalLink size={14} />
        </a>
      )}
      {transfer?.message && (
        <p className="micro text-muted">{transfer.message}</p>
      )}
      {error && (
        <p role="alert" className="private-nft-error">
          {error}
        </p>
      )}
    </PageView>
  );
}

// Keep the NFT detail/send pages mounted while the signer requests final approval.
export function NftTransferApproval({
  task,
  refresh,
}: {
  task: import('../shared/types').DappUiState;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const decide = async (approved: boolean) => {
    if (!task.approval || busy) return;
    setBusy(true);
    setError('');
    try {
      await callWallet('APPROVAL_DECISION', { id: task.approval.id, approved });
      await refresh();
    } catch (cause) {
      setError(walletErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageView
      open
      busy
      onOpenChange={() => {}}
      title={task.approval?.title ?? '正在发送 NFT'}
      description="PLabs Wallet · Ethereum"
    >
      {task.approval ? (
        <>
          <div className="panel approval-fields">
            {Object.entries(task.approval.details).map(([label, value]) => (
              <div className="approval-field" key={label}>
                <small>{label}</small>
                <p>{value}</p>
              </div>
            ))}
          </div>
          <div className="approval-actions">
            <Button disabled={busy} onClick={() => void decide(false)}>
              取消发送
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void decide(true)}
            >
              确认发送
            </Button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <RefreshCw size={25} className="animate-spin text-mint" />
          <p>{task.message ?? '正在核对并提交已确认的交易…'}</p>
        </div>
      )}
      {error && (
        <p className="private-nft-error" role="alert">
          {error}
        </p>
      )}
    </PageView>
  );
}
