import { t } from '../i18n';
import type { AssetSyncProgress } from '../privacy/sync-progress';
export function AssetSyncProgressBar({
  value,
}: {
  value: AssetSyncProgress | null;
}) {
  const percent = Math.max(0, Math.min(99, Math.floor(value?.progress ?? 0)));
  const nft = value?.phase === 'nfts',
    detail = value?.nft;
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
  return (
    <div className="asset-sync-progress" role="status" aria-live="polite">
      <div className="asset-sync-caption">
        <span>
          {phase}
          {detail && detail.totalCollections > 0
            ? ` · ${detail.collectionIndex}/${detail.totalCollections}`
            : ''}
          <span className="asset-sync-stage">{message}</span>
        </span>
        <strong>{percent}%</strong>
      </div>
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
      {detail?.phase === 'verify' && detail.totalNotes ? (
        <small>
          {t('已核对 {0}/{1} 个 NFT', [
            detail.verifiedNotes ?? 0,
            detail.totalNotes,
          ])}
        </small>
      ) : (
        detail &&
        detail.totalBlocks > 0 && (
          <small>
            {t('已扫描 {0}/{1} 区块', [
              detail.scannedBlocks.toLocaleString(),
              detail.totalBlocks.toLocaleString(),
            ])}
          </small>
        )
      )}
    </div>
  );
}
