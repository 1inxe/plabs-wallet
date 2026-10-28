import { AlertCircle, RefreshCw } from 'lucide-react';
export function SyncNotice({
  error,
  busy,
  onRetry,
}: {
  error: string;
  busy: boolean;
  onRetry(): void;
}) {
  return (
    <details className="sync-notice">
      <summary>
        <AlertCircle size={14} />
        <span>部分资产暂未同步</span>
        <span className="sync-notice-detail">详情</span>
      </summary>
      <div className="sync-notice-body">
        <p>已同步的资产仍可查看。</p>
        <pre>{error}</pre>
        <button disabled={busy} onClick={onRetry}>
          <RefreshCw size={13} />
          重新同步
        </button>
      </div>
    </details>
  );
}
