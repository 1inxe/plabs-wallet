import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { t } from '../i18n';
import type { AssetSyncProgress } from '../privacy/sync-progress';

export function AssetSyncStatus({
  value,
  busy,
  disabled,
  error,
  complete,
  onSync,
  children,
  variant = 'assets',
}: {
  value: AssetSyncProgress | null;
  busy: boolean;
  disabled: boolean;
  error: boolean;
  complete: boolean;
  onSync(): void;
  children: ReactNode;
  variant?: 'assets' | 'collectibles';
}) {
  const percent = Math.max(0, Math.min(99, Math.floor(value?.progress ?? 0)));
  const nft = value?.phase === 'nfts',
    detail = nft ? value.nft : undefined;
  const phase = nft ? t('NFT') : t('代币');
  const message = nft
    ? detail?.phase === 'catalog'
      ? t('读取 NFT 目录')
      : detail?.phase === 'discover'
        ? t('发现 NFT 合集')
        : detail?.phase === 'verify'
          ? t('核对 NFT 状态')
          : detail?.name || t('扫描 NFT')
    : t(value?.message || '正在同步资产');
  const counts =
    detail?.phase === 'verify' && detail.totalNotes
      ? t('已核对 {0}/{1} 个 NFT', [
          detail.verifiedNotes ?? 0,
          detail.totalNotes,
        ])
      : detail && detail.totalBlocks > 0
        ? t('已扫描 {0}/{1} 区块', [
            detail.scannedBlocks.toLocaleString(),
            detail.totalBlocks.toLocaleString(),
          ])
        : '';
  const description = [
    message,
    detail && detail.totalCollections > 0
      ? `${detail.collectionIndex}/${detail.totalCollections}`
      : '',
    counts,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section
      className={`wallet-sync-status ${variant === 'collectibles' ? 'collectibles-sync-status' : 'assets-sync-status'} ${busy ? 'is-syncing' : ''}`}
    >
      <div className="wallet-sync-heading">
        {children}
        <button
          type="button"
          className={`sync-access ${error && !busy ? 'has-issue' : ''}`}
          aria-label={t('同步隐私资产')}
          title={busy ? `${phase} · ${percent}% · ${description}` : undefined}
          disabled={busy || disabled}
          onClick={onSync}
        >
          <RefreshCw size={13} />
          {busy ? (
            <>
              <span>{phase}</span>
              <strong>{percent}%</strong>
            </>
          ) : (
            <span>
              {error ? t('同步未完成') : complete ? t('已同步') : t('同步')}
            </span>
          )}
        </button>
      </div>
      {busy && (
        <div className="asset-sync-progress" role="status" aria-live="polite">
          <div
            className="asset-sync-track"
            role="progressbar"
            aria-label={t('同步进度')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="asset-sync-caption" title={description}>
            <span>{message}</span>
            {detail && detail.totalCollections > 0 && (
              <small>{`${detail.collectionIndex}/${detail.totalCollections}`}</small>
            )}
          </div>
          {counts && <small className="asset-sync-counts">{counts}</small>}
        </div>
      )}
    </section>
  );
}
