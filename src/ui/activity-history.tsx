import { unshieldAsset } from '../privacy/unshield';
import { t, dateLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Clock,
  GitMerge,
  History,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { formatUnits } from 'ethers';
import { callWallet } from '../shared/runtime';
import { NETWORKS } from '../shared/networks';
import type {
  ChainId,
  PrivacyActivity,
  PrivacyActivityPage,
} from '../shared/types';
import { Button, IconButton, PageView } from './primitives';
import { ActivityTimeline } from './activity-timeline';
import { CopyButton } from './wallet-design';
const kinds = {
  send: '隐私发送',
  shield: '存入隐私池',
  unshield: '提取到公开账户',
  merge: '合并凭证',
  unknown: '资产操作',
};
const statuses = {
  pending: '处理中',
  confirmed: '已确认',
  failed: '失败',
  review: '需核对',
};
const short = (text: string) => `${text.slice(0, 10)}…${text.slice(-8)}`;
const quantity = (raw?: string, decimals?: number) => {
  try {
    return raw === undefined || decimals === undefined
      ? t('未记录')
      : formatUnits(raw, decimals).replace(/\.0$/, '');
  } catch {
    return t('未记录');
  }
};
const day = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return t('今天');
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString()
    ? t('昨天')
    : date.toLocaleDateString(dateLocale());
};
const time = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
interface Query {
  chainId: ChainId;
  poolAddress?: string;
  id?: string;
  kind?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  all?: boolean;
}
function useActivity(query: Query) {
  const [data, setData] = useState<PrivacyActivityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const invalidated = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (
        area === 'local' &&
        (changes.privacyActivityHistory || changes.privacyOperationJournal)
      )
        setRevision((value) => value + 1);
      if (
        area === 'session' &&
        (changes.privacyUnlockSession?.newValue ||
          changes.walletUnlockSession?.newValue)
      ) {
        invalidated.current = false;
        generation.current++;
        setRevision((value) => value + 1);
      }
      if (
        area === 'session' &&
        ((changes.privacyUnlockSession &&
          !changes.privacyUnlockSession.newValue) ||
          (changes.walletUnlockSession &&
            !changes.walletUnlockSession.newValue))
      ) {
        invalidated.current = true;
        generation.current++;
        setData(null);
        setLoading(false);
        setError(t('隐私账户已锁定，请重新解锁后查看记录'));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (invalidated.current) return;
    let active = true;
    const current = ++generation.current;
    setLoading(true);
    setError('');
    callWallet<PrivacyActivityPage>(
      'GET_PRIVACY_ACTIVITY',
      JSON.parse(queryKey),
    )
      .then((result) => {
        if (active && !invalidated.current && current === generation.current)
          setData(result);
      })
      .catch((cause) => {
        if (active && current === generation.current) {
          setData(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (active && current === generation.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryKey, revision]);
  return {
    data,
    loading,
    error,
    refresh: () => setRevision((value) => value + 1),
  };
}
function ActivityIcon({ kind }: { kind: PrivacyActivity['kind'] }) {
  return kind === 'send' ? (
    <ArrowUpRight size={17} />
  ) : kind === 'shield' ? (
    <ShieldCheck size={17} />
  ) : kind === 'unshield' ? (
    <ArrowDownToLine size={17} />
  ) : kind === 'merge' ? (
    <GitMerge size={17} />
  ) : (
    <History size={17} />
  );
}
function ActivityRow({
  item,
  hidden,
  onSelect,
}: {
  item: PrivacyActivity;
  hidden: boolean;
  onSelect: (id: string) => void;
}) {
  const amount = hidden ? '••••••' : quantity(item.amountRaw, item.decimals);
  return (
    <button
      className="activity-row"
      onClick={() => onSelect(item.id)}
      data-created-at={item.createdAt}
    >
      <span className={`activity-icon ${item.kind}`}>
        <ActivityIcon kind={item.kind} />
      </span>
      <span className="activity-description">
        <strong>{t(kinds[item.kind])}</strong>
        <small>
          {day(item.createdAt)} {time(item.createdAt)}
          {item.mergeBatch
            ? t(' \u00B7 {0}/{1} 批', [item.mergeBatch, item.mergeBatches])
            : ''}
        </small>
      </span>
      <span className="activity-quantity">
        <strong
          className="mono"
          title={hidden ? undefined : `${amount} ${item.symbol}`}
        >
          {amount} <small>{item.symbol}</small>
        </strong>
        <span className={`activity-status ${item.status}`}>
          {t(statuses[item.status])}
        </span>
      </span>
    </button>
  );
}
function ActivityRows({
  items,
  hidden,
  onSelect,
}: {
  items: PrivacyActivity[];
  hidden: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="activity-list">
      {items.map((item) => (
        <div key={item.id}>
          <ActivityRow item={item} hidden={hidden} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
function ActivityDetail({
  id,
  chainId,
  hidden,
  onBack,
}: {
  id: string;
  chainId: ChainId;
  hidden: boolean;
  onBack: () => void;
}) {
  const { data, loading, error, refresh } = useActivity({
    chainId,
    id,
    pageSize: 3,
  });
  const entry = data?.items[0];
  const [revealed, setRevealed] = useState(!hidden);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState('');
  const refreshStatus = async () => {
    if (!entry || refreshing) return;
    setRefreshing(true);
    setStatusError('');
    try {
      await callWallet('GET_PRIVACY_OPERATION_RESULT', { id: entry.id });
      refresh();
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };
  const row = (label: string, value: string) => (
    <div className="note-summary-row">
      <span>{t(label)}</span>
      <strong>{value}</strong>
    </div>
  );
  return (
    <PageView
      open
      onOpenChange={onBack}
      title={t('操作详情')}
      description={t('{0} \u00B7 本地记录', [NETWORKS[chainId].name])}
    >
      {error && (
        <p role="alert" className="micro text-danger">
          {t(error)}
        </p>
      )}
      {!entry ? (
        <p className="empty-state">
          {loading
            ? t('正在读取记录\u2026')
            : error
              ? t('解锁后重新打开历史记录')
              : t('此记录不存在或不属于当前账户')}
        </p>
      ) : (
        <>
          <div className="activity-detail-hero">
            <span className={`activity-icon ${entry.kind}`}>
              <ActivityIcon kind={entry.kind} />
            </span>
            <h1>{t(kinds[entry.kind])}</h1>
            <strong className="detail-quantity mono">
              {revealed ? quantity(entry.amountRaw, entry.decimals) : '••••••'}{' '}
              <small>{entry.symbol}</small>
            </strong>
            <span className={`activity-status ${entry.status}`}>
              {t(statuses[entry.status])}
            </span>
            <small>
              {new Date(entry.createdAt).toLocaleString(dateLocale())}
            </small>
          </div>
          {!revealed && (
            <Button onClick={() => setRevealed(true)}>
              {t('显示此操作的金额与费用')}
            </Button>
          )}
          {entry.unreadable && (
            <p className="panel micro text-amber">
              {t('详情无法解密，仍可查看状态和交易哈希。')}
            </p>
          )}
          {entry.kind === 'merge' && (
            <p className="panel micro text-muted">
              {t('合并至自己的隐私地址。')}
              {entry.noteCount
                ? t('本批合并 {0} 个 Notes。', [entry.noteCount])
                : ''}
            </p>
          )}
          <section className="panel form-stack">
            {row(t('网络'), NETWORKS[chainId].name)}
            {entry.dappOrigin && row(t('发起网站'), entry.dappOrigin)}
            {row(
              t('支付方式'),
              entry.paymentMode === 'private'
                ? t('隐私资产支付 \u00B7 Relayer')
                : entry.paymentMode === 'native'
                  ? t('{0} 原生币', [NETWORKS[chainId].nativeSymbol])
                  : t('旧记录未保存'),
            )}
            {row(
              t('操作手续费'),
              revealed
                ? `${quantity(entry.feeRaw, entry.feeDecimals)}${entry.feeSymbol ? ` ${entry.feeSymbol}` : ''}`
                : '••••••',
            )}
            {entry.paymentMode === 'native' &&
              row(
                t('确认时 Gas 上限'),
                revealed
                  ? `${quantity(entry.maxGasWei, 18)} ${NETWORKS[chainId].nativeSymbol}`
                  : '••••••',
              )}
            {entry.paymentMode === 'private' &&
              row(t('Gas 支付方'), t('Relayer（包含在隐私手续费中）'))}
            {entry.receiveRaw !== undefined &&
              row(
                entry.kind === 'merge' ? t('本批合并输出') : t('预览到账数量'),
                revealed
                  ? `${quantity(entry.receiveRaw, entry.decimals)} ${entry.kind === 'unshield' ? (unshieldAsset(chainId, entry.poolAddress ?? '')?.symbol ?? entry.symbol) : entry.symbol}`
                  : '••••••',
              )}
            {entry.mergeBatch &&
              row(t('合并批次'), `${entry.mergeBatch} / ${entry.mergeBatches}`)}
            {row(
              t('最近更新'),
              new Date(entry.updatedAt).toLocaleString(dateLocale()),
            )}
          </section>
          {entry.recipient && (
            <section className="panel form-stack">
              <h2>
                {entry.kind === 'merge' ? t('自己的隐私地址') : t('接收地址')}
              </h2>
              <p className="mono break-all text-xs">{entry.recipient}</p>
              <CopyButton value={entry.recipient} label={t('复制接收地址')} />
            </section>
          )}
          {entry.txHashes.length > 0 && (
            <section className="panel form-stack">
              <h2>{t('链上交易')}</h2>
              {entry.txHashes.map((hash, index) => (
                <div className="activity-hash" key={hash}>
                  <small>
                    {entry.mainTxHash === hash
                      ? t('主交易')
                      : entry.mainTxHash
                        ? t('授权交易 {0}', [index + 1])
                        : t('关联交易 {0}', [index + 1])}
                  </small>
                  <p className="mono break-all text-xs">{hash}</p>
                  <div className="row-between">
                    <CopyButton value={hash} label={t('复制哈希')} />
                    <a
                      className="explorer-link"
                      href={`${NETWORKS[chainId].explorerUrl}/tx/${hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('查看交易')}
                      <ArrowUpRight size={13} />
                    </a>
                  </div>
                </div>
              ))}
            </section>
          )}
          {entry.requestId && (
            <section className="panel">
              <small>{t('Relayer 请求编号')}</small>
              <p className="mono break-all text-xs mt-2">{entry.requestId}</p>
              <CopyButton value={entry.requestId} label={t('复制请求编号')} />
            </section>
          )}
          {entry.status === 'review' && (
            <p className="panel micro text-amber">
              {t('结果待核对，请查看原交易，勿重复发送。')}
            </p>
          )}
          {(entry.error || statusError) && (
            <p role="alert" className="panel micro text-danger">
              {statusError || entry.error}
            </p>
          )}
          {entry.refreshable &&
            ['pending', 'review'].includes(entry.status) && (
              <Button disabled={refreshing} onClick={refreshStatus}>
                <RefreshCw
                  size={15}
                  className={refreshing ? 'animate-spin' : ''}
                />
                {t('更新链上状态')}
              </Button>
            )}
        </>
      )}
    </PageView>
  );
}
export function ActivityHistoryContent({
  chainId,
  poolAddress,
  hidden = false,
}: {
  chainId: ChainId;
  poolAddress?: string;
  hidden?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, refresh } = useActivity({
    chainId,
    poolAddress,
    all: true,
  });
  return (
    <>
      <div className="activity-history-view">
        <div className="activity-toolbar">
          <small>
            {data ? t('{0} 条记录', [data.total]) : t('按时间排序')}
          </small>
          <IconButton
            label={t('刷新历史记录')}
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </IconButton>
        </div>
        {error && (
          <p role="alert" className="micro text-danger">
            {t(error)}
          </p>
        )}
        {loading && !data ? (
          <p className="empty-state">{t('正在读取记录\u2026')}</p>
        ) : data?.items.length ? (
          <ActivityTimeline
            items={data.items}
            renderRow={(item) => (
              <ActivityRow item={item} hidden={hidden} onSelect={setSelected} />
            )}
          />
        ) : (
          <div className="empty-state">
            <History size={28} />
            <p>{t('暂无本机操作记录')}</p>
          </div>
        )}
      </div>
      {selected && (
        <ActivityDetail
          id={selected}
          chainId={chainId}
          hidden={hidden}
          onBack={() => setSelected(null)}
        />
      )}
    </>
  );
}
function HistoryPage({
  chainId,
  poolAddress,
  symbol,
  hidden,
  onClose,
}: {
  chainId: ChainId;
  poolAddress?: string;
  symbol?: string;
  hidden: boolean;
  onClose: () => void;
}) {
  return (
    <PageView
      open
      onOpenChange={onClose}
      title={symbol ? t('{0} 操作记录', [symbol]) : t('操作历史')}
      description={t('{0} \u00B7 本机记录', [NETWORKS[chainId].name])}
    >
      <ActivityHistoryContent
        chainId={chainId}
        poolAddress={poolAddress}
        hidden={hidden}
      />
    </PageView>
  );
}
export function ActivitySection({
  chainId,
  poolAddress,
  symbol,
  hidden = false,
}: {
  chainId: ChainId;
  poolAddress?: string;
  symbol?: string;
  hidden?: boolean;
}) {
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error } = useActivity({
    chainId,
    poolAddress,
    pageSize: 3,
  });
  return (
    <section className="panel activity-section">
      <div className="row-between">
        <h2>
          <History size={16} className="text-mint" />
          {symbol ? t('资产操作记录') : t('最近活动')}
        </h2>
        <button className="activity-view-all" onClick={() => setAll(true)}>
          {t('查看全部')}
          <ArrowRight size={13} />
        </button>
      </div>
      {error ? (
        <p className="micro text-danger">{t(error)}</p>
      ) : loading && !data ? (
        <p className="micro text-muted">{t('读取本地记录\u2026')}</p>
      ) : data?.items.length ? (
        <ActivityRows
          items={data.items}
          hidden={hidden}
          onSelect={setSelected}
        />
      ) : (
        <div className="activity-empty">
          <Clock size={19} />
          <span>{t('暂无本机操作记录')}</span>
        </div>
      )}

      {all && (
        <HistoryPage
          chainId={chainId}
          poolAddress={poolAddress}
          symbol={symbol}
          hidden={hidden}
          onClose={() => setAll(false)}
        />
      )}
      {selected && (
        <ActivityDetail
          id={selected}
          chainId={chainId}
          hidden={hidden}
          onBack={() => setSelected(null)}
        />
      )}
    </section>
  );
}
export function ActivityHistoryButton({
  chainId,
  hidden = false,
}: {
  chainId: ChainId;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="activity-history-button" onClick={() => setOpen(true)}>
        <History size={14} />
        {t('最近活动')}
        <ArrowRight size={13} />
      </button>
      {open && (
        <HistoryPage
          chainId={chainId}
          hidden={hidden}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
