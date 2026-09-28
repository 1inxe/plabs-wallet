import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Clock, GitMerge, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatUnits } from 'ethers';
import { callWallet } from '../shared/runtime';
import { NETWORKS } from '../shared/networks';
import type { ChainId, PrivacyActivity, PrivacyActivityPage } from '../shared/types';
import { Button, IconButton, PageView, Select } from './primitives';
import { CopyButton } from './wallet-design';

const kinds = { send: '隐私发送', shield: '存入隐私池', unshield: '提取到公开账户', merge: '合并 Notes', unknown: '资产操作' };
const statuses = { pending: '处理中', confirmed: '已确认', failed: '失败', review: '需核对' };
const short = (text: string) => `${text.slice(0, 10)}…${text.slice(-8)}`;
const quantity = (raw?: string, decimals?: number) => {
  try { return raw === undefined || decimals === undefined ? '未记录' : formatUnits(raw, decimals).replace(/\.0$/, ''); }
  catch { return '未记录'; }
};
const day = (timestamp: number) => {
  const date = new Date(timestamp); const today = new Date();
  if (date.toDateString() === today.toDateString()) return '今天';
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? '昨天' : date.toLocaleDateString();
};
const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
interface Query { chainId: ChainId; poolAddress?: string; id?: string; kind?: string; status?: string; page?: number; pageSize?: number }
function useActivity(query: Query) {
  const [data, setData] = useState<PrivacyActivityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const invalidated = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && (changes.privacyActivityHistory || changes.privacyOperationJournal)) setRevision(value => value + 1);
      if (area === 'session' && ((changes.privacyUnlockSession && !changes.privacyUnlockSession.newValue) || (changes.walletUnlockSession && !changes.walletUnlockSession.newValue))) {
        invalidated.current = true; generation.current++; setData(null); setLoading(false); setError('隐私账户已锁定，请重新解锁后查看记录');
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (invalidated.current) return;
    let active = true; const current = ++generation.current; setLoading(true); setError('');
    callWallet<PrivacyActivityPage>('GET_PRIVACY_ACTIVITY', JSON.parse(queryKey)).then(result => {
      if (active && !invalidated.current && current === generation.current) setData(result);
    }).catch(cause => { if (active && current === generation.current) { setData(null); setError(cause instanceof Error ? cause.message : String(cause)); } })
      .finally(() => { if (active && current === generation.current) setLoading(false); });
    return () => { active = false; };
  }, [queryKey, revision]);
  return { data, loading, error, refresh: () => setRevision(value => value + 1) };
}
function ActivityIcon({ kind }: { kind: PrivacyActivity['kind'] }) {
  return kind === 'send' ? <ArrowUpRight size={17} /> : kind === 'shield' ? <ShieldCheck size={17} /> : kind === 'unshield' ? <ArrowDownToLine size={17} /> : kind === 'merge' ? <GitMerge size={17} /> : <History size={17} />;
}
function ActivityRows({ items, hidden, onSelect, grouped = false }: { items: PrivacyActivity[]; hidden: boolean; onSelect: (id: string) => void; grouped?: boolean }) {
  return <div className="activity-list">{items.map((item, index) => <div key={item.id}>
    {grouped && (index === 0 || day(items[index - 1].createdAt) !== day(item.createdAt)) && <p className="activity-day">{day(item.createdAt)}</p>}
    <button className="activity-row" onClick={() => onSelect(item.id)}>
      <span className={`activity-icon ${item.kind}`}><ActivityIcon kind={item.kind} /></span>
      <span className="activity-description"><strong>{kinds[item.kind]}{item.mergeBatch && <small>第 {item.mergeBatch}/{item.mergeBatches} 批</small>}</strong><small>{grouped ? time(item.createdAt) : `${day(item.createdAt)} ${time(item.createdAt)}`} · {item.paymentMode === 'private' ? '隐私支付' : item.paymentMode === 'native' ? `${NETWORKS[item.chainId].nativeSymbol} Gas` : '本地记录'}</small></span>
      <span className="activity-quantity"><strong className="mono">{hidden ? '••••••' : quantity(item.amountRaw, item.decimals)} <small>{item.symbol}</small></strong><span className={`activity-status ${item.status}`}>{statuses[item.status]}</span></span>
    </button>
  </div>)}</div>;
}
function ActivityDetail({ id, chainId, hidden, onBack }: { id: string; chainId: ChainId; hidden: boolean; onBack: () => void }) {
  const { data, loading, error, refresh } = useActivity({ chainId, id, pageSize: 3 });
  const entry = data?.items[0];
  const [revealed, setRevealed] = useState(!hidden);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState('');
  const refreshStatus = async () => {
    if (!entry || refreshing) return;
    setRefreshing(true); setStatusError('');
    try { await callWallet('GET_PRIVACY_OPERATION_RESULT', { id: entry.id }); refresh(); }
    catch (cause) { setStatusError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRefreshing(false); }
  };
  const row = (label: string, value: string) => <div className="note-summary-row"><span>{label}</span><strong>{value}</strong></div>;
  return <PageView open onOpenChange={onBack} title="操作详情" description={`${NETWORKS[chainId].name} · 本地记录`}>
    {error && <p role="alert" className="micro text-danger">{error}</p>}
    {!entry ? <p className="empty-state">{loading ? '正在读取记录…' : error ? '解锁后重新打开历史记录' : '此记录不存在或不属于当前账户'}</p> : <>
      <div className="activity-detail-hero"><span className={`activity-icon ${entry.kind}`}><ActivityIcon kind={entry.kind} /></span><h1>{kinds[entry.kind]}</h1><strong className="detail-quantity mono">{revealed ? quantity(entry.amountRaw, entry.decimals) : '••••••'} <small>{entry.symbol}</small></strong><span className={`activity-status ${entry.status}`}>{statuses[entry.status]}</span><small>{new Date(entry.createdAt).toLocaleString()}</small></div>
      {!revealed && <Button onClick={() => setRevealed(true)}>显示此操作的金额与费用</Button>}
      {entry.unreadable && <p className="panel micro text-amber">此记录的加密详情无法读取，仍可查看已保存的状态和交易哈希。</p>}
      {entry.kind === 'merge' && <p className="panel micro text-muted">这是转回自己隐私地址的 Notes 整理，不是对外支出。{entry.noteCount ? `本批合并 ${entry.noteCount} 个 Notes。` : ''}</p>}
      <section className="panel form-stack">{row('网络', NETWORKS[chainId].name)}{entry.dappOrigin && row('发起网站', entry.dappOrigin)}{row('支付方式', entry.paymentMode === 'private' ? '隐私资产支付 · Relayer' : entry.paymentMode === 'native' ? `${NETWORKS[chainId].nativeSymbol} 原生币` : '旧记录未保存')}{row('操作手续费', revealed ? `${quantity(entry.feeRaw, entry.feeDecimals)}${entry.feeSymbol ? ` ${entry.feeSymbol}` : ''}` : '••••••')}{entry.paymentMode === 'native' && row('确认时 Gas 上限', revealed ? `${quantity(entry.maxGasWei, 18)} ${NETWORKS[chainId].nativeSymbol}` : '••••••')}{entry.paymentMode === 'private' && row('Gas 支付方', 'Relayer（包含在隐私手续费中）')}{entry.receiveRaw !== undefined && row(entry.kind === 'merge' ? '本批合并输出' : '预览到账数量', revealed ? `${quantity(entry.receiveRaw, entry.decimals)} ${entry.kind === 'unshield' && entry.symbol === 'sUSDC' ? 'USDC' : entry.symbol}` : '••••••')}{entry.mergeBatch && row('合并批次', `${entry.mergeBatch} / ${entry.mergeBatches}`)}{row('最近更新', new Date(entry.updatedAt).toLocaleString())}</section>
      {entry.recipient && <section className="panel form-stack"><h2>{entry.kind === 'merge' ? '自己的隐私地址' : '接收地址'}</h2><p className="mono break-all text-xs">{entry.recipient}</p><CopyButton value={entry.recipient} label="复制接收地址" /></section>}
      {entry.txHashes.length > 0 && <section className="panel form-stack"><h2>链上交易</h2>{entry.txHashes.map((hash, index) => <div className="activity-hash" key={hash}><small>{entry.mainTxHash === hash ? '主交易' : entry.mainTxHash ? `授权交易 ${index + 1}` : `关联交易 ${index + 1}`}</small><p className="mono break-all text-xs">{hash}</p><div className="row-between"><CopyButton value={hash} label="复制哈希" /><a className="explorer-link" href={`${NETWORKS[chainId].explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">查看交易<ArrowUpRight size={13} /></a></div></div>)}</section>}
      {entry.requestId && <section className="panel"><small>Relayer 请求编号</small><p className="mono break-all text-xs mt-2">{entry.requestId}</p><CopyButton value={entry.requestId} label="复制请求编号" /></section>}
      {entry.status === 'review' && <p className="panel micro text-amber">当前结果需要核对，不代表交易已经失败。请查看链上记录，避免重复发送。</p>}
      {(entry.error || statusError) && <p role="alert" className="panel micro text-danger">{statusError || entry.error}</p>}
      {entry.refreshable && ['pending', 'review'].includes(entry.status) && <Button disabled={refreshing} onClick={refreshStatus}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />更新链上状态</Button>}
      <p className="micro text-muted">此页展示本地保存的操作与确认信息。手续费与到账数量来自当时的预览，未记录的旧字段不会补成 0。</p>
    </>}
  </PageView>;
}
function HistoryPage({ chainId, poolAddress, symbol, hidden, onClose }: { chainId: ChainId; poolAddress?: string; symbol?: string; hidden: boolean; onClose: () => void }) {
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, refresh } = useActivity({ chainId, poolAddress, kind, status, page, pageSize: 20 });
  useEffect(() => { if (data && data.page !== page) setPage(data.page); }, [data?.page]);
  return <PageView open onOpenChange={onClose} title={symbol ? `${symbol} 操作记录` : '操作历史'} description={`${NETWORKS[chainId].name} · 当前账户 · 本机发起`}>
    <div className="activity-toolbar"><Select ariaLabel="筛选操作类型" value={kind} onValueChange={value => { setKind(value); setPage(1); }} options={[{ value: 'all', label: '全部操作' }, ...(['send', 'shield', 'unshield', 'merge'] as const).map(value => ({ value, label: kinds[value] }))]} /><IconButton label="刷新历史记录" disabled={loading} onClick={refresh}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></IconButton></div>
    <div className="activity-filters" aria-label="筛选操作状态">{([['all', '全部'], ['pending', '处理中'], ['confirmed', '已确认'], ['failed', '失败'], ['review', '需核对']] as const).map(([value, label]) => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div>
    {error && <p role="alert" className="micro text-danger">{error}</p>}
    {loading && !data ? <p className="empty-state">正在读取本地记录…</p> : data?.items.length ? <ActivityRows items={data.items} grouped hidden={hidden} onSelect={setSelected} /> : <div className="empty-state"><History size={28} /><p>暂无符合条件的操作记录</p><small>本机发起操作后会自动记录，不包含全部链上收款。</small></div>}
    <div className="notes-pagination"><small>共 {data?.total ?? 0} 条 · 每页 20 条</small><div><IconButton label="上一页历史" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></IconButton><span>{data?.page ?? page} / {data?.pages ?? 1}</span><IconButton label="下一页历史" disabled={loading || page >= (data?.pages ?? 1)} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></IconButton></div></div>
    <p className="micro text-muted">本机保留最近 1,000 条已结束操作，进行中记录保留。新操作详情本地加密，不随 Vault 备份自动迁移。</p>
    {selected && <ActivityDetail id={selected} chainId={chainId} hidden={hidden} onBack={() => setSelected(null)} />}
  </PageView>;
}
export function ActivitySection({ chainId, poolAddress, symbol, hidden = false }: { chainId: ChainId; poolAddress?: string; symbol?: string; hidden?: boolean }) {
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error } = useActivity({ chainId, poolAddress, pageSize: 3 });
  return <section className="panel activity-section"><div className="row-between"><h2><History size={16} className="text-mint" />{symbol ? '资产操作记录' : '最近活动'}</h2><button className="activity-view-all" onClick={() => setAll(true)}>查看全部<ArrowRight size={13} /></button></div>
    {error ? <p className="micro text-danger">{error}</p> : loading && !data ? <p className="micro text-muted">读取本地记录…</p> : data?.items.length ? <ActivityRows items={data.items} hidden={hidden} onSelect={setSelected} /> : <div className="activity-empty"><Clock size={19} /><span>暂无本机操作记录<small>发送、存入、提取与合并后会显示在这里</small></span></div>}
    <small className="activity-local-label">本地记录 · 当前网络 · 隐私锁定后隐藏</small>
    {all && <HistoryPage chainId={chainId} poolAddress={poolAddress} symbol={symbol} hidden={hidden} onClose={() => setAll(false)} />}
    {selected && <ActivityDetail id={selected} chainId={chainId} hidden={hidden} onBack={() => setSelected(null)} />}
  </section>;
}
