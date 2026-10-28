import { ApprovalDetails } from './approval-details';
import { useDeadline } from './use-deadline';
import { t } from '../i18n';
import { ExternalLink, RefreshCw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NftAssetSummary } from '../privacy/nft/holdings';
import { callWallet } from '../shared/runtime';
import { walletErrorMessage } from '../shared/errors';
import { Button, IconButton, PageView } from './primitives';
import { CopyButton } from './wallet-design';
import { NftArtwork } from './nft-artwork';
import { parsePrivacyAddress, formatPrivacyAddress } from '../privacy/address';
import { SyncNotice } from './sync-notice';
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
  managedSync?: {
    busy: boolean;
    revision: number;
  };
}) {
  const managed = Boolean(managedSync);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const isSyncing = managedSync?.busy ?? syncing;
  const readRunning = useRef(false),
    recentRunning = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    generation.current++;
    if (!unlocked || chainId !== 1) setSnapshot(null);
    return () => {
      generation.current++;
    };
  }, [chainId, unlocked]);
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
    if (readRunning.current || !unlocked || chainId !== 1) return;
    readRunning.current = true;
    const revision = generation.current;
    try {
      const value = await callWallet<Snapshot>('GET_PRIVATE_NFT_ASSETS');
      if (active.current && revision === generation.current) {
        setSnapshot(value);
        setError('');
      }
    } catch (cause) {
      if (active.current && revision === generation.current)
        setError(walletErrorMessage(cause));
    } finally {
      readRunning.current = false;
    }
  };
  useEffect(() => {
    if (!managed || !automaticSync || !unlocked || chainId !== 1) return;
    let enabled = true;
    const recent = async () => {
      if (!enabled || recentRunning.current) return;
      recentRunning.current = true;
      const revision = generation.current;
      try {
        const value = await callWallet<Snapshot>('SYNC_PRIVATE_NFT_ASSETS', {
          recentOnly: true,
        });
        if (enabled && active.current && revision === generation.current)
          setSnapshot(value);
      } catch {
        /* The full sync and manual retry retain their visible error state. */
      } finally {
        recentRunning.current = false;
      }
    };
    void recent();
    const timer = window.setInterval(() => void recent(), 15000);
    return () => {
      enabled = false;
      window.clearInterval(timer);
    };
  }, [managed, automaticSync, unlocked, chainId]);
  const sync = async () => {
    if (running.current || !unlocked || chainId !== 1) return;
    running.current = true;
    const revision = generation.current;
    setSyncing(true);
    setError('');
    try {
      const value = await callWallet<Snapshot>('SYNC_PRIVATE_NFT_ASSETS', {
        recentOnly: true,
      });
      if (active.current && revision === generation.current) setSnapshot(value);
    } catch (cause) {
      if (active.current && revision === generation.current)
        setError(walletErrorMessage(cause));
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
    }, 120000);
    return () => window.clearInterval(timer);
  }, [chainId, unlocked, automaticSync, managed, managedSync?.revision]);
  useEffect(() => {
    if (!unlocked || chainId !== 1) return;
    const timer = window.setInterval(
      () => {
        void read();
      },
      isSyncing ? 2000 : 6000,
    );
    return () => window.clearInterval(timer);
  }, [isSyncing, unlocked, chainId]);
  const selectedAsset = snapshot?.items.find((asset) => asset.id === selected);
  return (
    <section className="panel private-nft-assets">
      {!managed && (
        <div className="row-between">
          <h2>NFT</h2>
          <IconButton
            label={t('同步隐私 NFT')}
            disabled={!unlocked || chainId !== 1 || syncing}
            onClick={() => void sync()}
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      )}
      {!unlocked ? (
        <EmptyState>{t('解锁隐私钱包后查看 NFT')}</EmptyState>
      ) : chainId !== 1 ? (
        <EmptyState>{t('切换至 Ethereum 查看及同步隐私 NFT')}</EmptyState>
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
                    aria-label={t('查看 {0} #{1}', [asset.name, asset.tokenId])}
                    onClick={() => setSelected(asset.id)}
                  />
                  {asset.state === 'pending' && (
                    <span className="nft-pending-badge">{t('确认中')}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="private-nft-copy"
                  onClick={() => setSelected(asset.id)}
                >
                  <strong>{asset.name}</strong>
                  <span>#{asset.tokenId}</span>
                </button>
              </article>
            ))}
          </div>
          {!snapshot?.items.length && (
            <EmptyState>
              {isSyncing
                ? t('正在扫描当前隐私账户的 NFT\u2026')
                : snapshot?.syncComplete
                  ? t('已同步，当前隐私地址暂无 NFT')
                  : managed
                    ? t('NFT 尚未完成同步，点击上方同步隐私资产')
                    : t('NFT 尚未完成同步，点击右上角同步')}
            </EmptyState>
          )}
          {!managed && syncing && (
            <p className="micro text-muted" role="status">
              {t(' 正在同步\u2026 ')}
            </p>
          )}
          {(error || (!managed && snapshot?.error)) && (
            <SyncNotice
              error={error || snapshot!.error!}
              busy={isSyncing}
              onRetry={() => void (managed ? read() : sync())}
            />
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
          description="Ethereum"
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
              <span>{t('持有状态')}</span>
              <strong>
                {selectedAsset.state === 'pending'
                  ? t('等待链上确认')
                  : t('已持有')}
              </strong>
            </div>
            <div className="row-between">
              <span>{t('编号')}</span>
              <strong>#{selectedAsset.tokenId}</strong>
            </div>
            <div>
              <small>{t('合集地址')}</small>
              <p className="mono break-all">{selectedAsset.poolAddress}</p>
              <CopyButton
                compact
                value={selectedAsset.poolAddress}
                label={t('复制 NFT 合集地址')}
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
              ? t('查看发送进度')
              : t('发送 NFT')}
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
            {t(' 查看链上交易 ')}
            <ExternalLink size={14} />
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
  const refreshInFlight = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = async () => {
    if (!transfer?.id || refreshInFlight.current) return;
    refreshInFlight.current = true;
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
    } finally {
      refreshInFlight.current = false;
    }
  };
  useEffect(() => {
    if (transfer?.state !== 'submitted') return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 6000);
    return () => window.clearInterval(timer);
  }, [transfer?.id, transfer?.state]);
  const send = async () => {
    if (busy || inFlight.current) return;
    setError('');
    try {
      parsePrivacyAddress(recipient);
    } catch (cause) {
      setError(walletErrorMessage(cause));
      return;
    }
    inFlight.current = true;
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
      inFlight.current = false;
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
      title={t('发送 NFT')}
      description={`${asset.name} #${asset.tokenId}`}
    >
      <div className="panel nft-send-form">
        <label htmlFor="nft-recipient">{t('接收方隐私地址')}</label>
        <textarea
          id="nft-recipient"
          value={recipient}
          disabled={busy || pending || done}
          placeholder="perc1…"
          onChange={(event) => setRecipient(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <small>{t('仅支持 PLabs 隐私地址，Gas 使用 ETH 支付。')}</small>
        <Button
          variant="primary"
          disabled={busy || pending || done || !recipient.trim()}
          onClick={() => void send()}
        >
          {busy
            ? t('正在生成证明，请稍候\u2026')
            : done
              ? t('已发送')
              : pending
                ? t('等待链上确认')
                : t('确认发送并查看 Gas')}
        </Button>
      </div>
      {pending && (
        <p role="status" className="panel text-mint micro">
          {t(' 已提交，等待链上确认。 ')}
        </p>
      )}
      {done && (
        <p role="status" className="panel text-mint micro">
          {t(' NFT 已发送。 ')}
        </p>
      )}
      {transfer?.txHash && (
        <a
          className="explorer-link"
          href={`https://etherscan.io/tx/${transfer.txHash}`}
          target="_blank"
          rel="noreferrer"
        >
          {t(' 查看发送交易 ')}
          <ExternalLink size={14} />
        </a>
      )}
      {transfer?.message && (
        <p className="micro text-muted">{t(transfer.message)}</p>
      )}
      {error && (
        <p role="alert" className="private-nft-error">
          {t(error)}
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
  const inFlight = useRef(false);
  const deadline = useDeadline(
    task.approval ? task.approval.createdAt + 600_000 : undefined,
  );
  const decide = async (approved: boolean) => {
    if (
      !task.approval ||
      busy ||
      inFlight.current ||
      (approved && Date.now() >= task.approval.createdAt + 600_000)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await callWallet('APPROVAL_DECISION', { id: task.approval.id, approved });
      await refresh();
    } catch (cause) {
      setError(walletErrorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <PageView
      open
      busy
      onOpenChange={() => {}}
      title={task.approval?.title ?? t('正在发送 NFT')}
      description="PLabs Wallet · Ethereum"
    >
      {task.approval ? (
        <>
          <ApprovalDetails details={task.approval.details} />
          <p
            className={`approval-deadline micro ${deadline.expired ? 'text-danger' : 'text-muted'}`}
          >
            {deadline.expired
              ? t('请求已过期，请重新发起')
              : t('确认有效期 {0}', [deadline.text])}
          </p>
          <div className="approval-actions">
            <Button disabled={busy} onClick={() => void decide(false)}>
              {t(' 取消发送 ')}
            </Button>
            <Button
              variant="primary"
              disabled={busy || deadline.expired}
              onClick={() => void decide(true)}
            >
              {t(' 确认发送 ')}
            </Button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <RefreshCw size={25} className="animate-spin text-mint" />
          <p>{t(task.message) || t('正在核对并提交已确认的交易\u2026')}</p>
        </div>
      )}
      {error && (
        <p className="private-nft-error" role="alert">
          {t(error)}
        </p>
      )}
    </PageView>
  );
}
