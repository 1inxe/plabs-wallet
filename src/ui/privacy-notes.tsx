import { MergeSettingsControl } from './merge-settings';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, GitMerge, RefreshCw } from 'lucide-react';
import { formatUnits } from 'ethers';
import { NETWORKS } from '../shared/networks';
import { callWallet } from '../shared/runtime';
import type { ChainId, PrivacyMergePlan, PrivacyNoteFilter, PrivacyNoteSummary, PrivacyNotesPage, TransactionSettings } from '../shared/types';
import { Button, IconButton, PageView, Select } from './primitives';
import { CopyButton } from './wallet-design';
import { PaymentModeControl, usePrivacyPaymentMode } from './payment-mode';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`;
const eligible = (note: PrivacyNoteSummary) => note.confirmed && !note.spent && BigInt(note.valueRaw) > 0n;
const done = (plan: PrivacyMergePlan) => ['complete', 'cancelled'].includes(plan.state);
const labels: Record<PrivacyMergePlan['state'], string> = { review: '确认合并计划', preparing: '准备下一批', ready: '准备就绪', submitting: '正在提交', waiting: '等待交易确认', syncing: '等待 Note 确认', paused: '合并已暂停', complete: '合并完成', cancelled: '已停止合并' };

export function PrivacyNotes({ chainId, poolAddress, symbol, hidden = false, onChanged }: { chainId: ChainId; poolAddress: string; symbol: string; hidden?: boolean; onChanged?: () => void }) {
  const network = NETWORKS[chainId];
  const decimals = network.plabs?.pools.find(pool => pool.address.toLowerCase() === poolAddress.toLowerCase())?.decimals ?? 6;
  const [data, setData] = useState<PrivacyNotesPage | null>(null);
  const [filter, setFilter] = useState<PrivacyNoteFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Record<string, PrivacyNoteSummary>>({});
  const [maxInputs, setMaxInputs] = useState<number | null>(null);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limitError, setLimitError] = useState('');
  const [revealed, setRevealed] = useState(!hidden);
  const [plan, setPlan] = useState<PrivacyMergePlan | null>(null);
  const [planPage, setPlanPage] = useState(false);
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  const sessionValid = useRef(true);
  const planPageOpen = useRef(false);
  const openPlan = () => { planPageOpen.current = true; setPlanPage(true); };
  const closePlan = () => { planPageOpen.current = false; setRunning(false); setPlanPage(false); setRevision(value => value + 1); };
  const payment = usePrivacyPaymentMode();
  const activePlan = plan && !done(plan);
  const selection = Object.values(selected);
  const selectedTotal = selection.reduce((sum, note) => sum + BigInt(note.valueRaw), 0n);
  const amount = (raw: string) => revealed ? formatUnits(raw, decimals) : '••••••';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const onSession = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.transactionSettings) { setRevision(value => value + 1); return; }
      if (area !== 'session') return;
      if ((changes.privacyUnlockSession && !changes.privacyUnlockSession.newValue) || (changes.walletUnlockSession && !changes.walletUnlockSession.newValue)) {
        sessionValid.current = false; setLoading(false); setBusy(false); setSyncing(false);
        setData(null); setSelected({}); setRunning(false); setPlan(null); setPlanPage(false); planPageOpen.current = false;
        setError('隐私账户已锁定，请重新解锁后查看 Notes');
      }
    };
    chrome.storage?.onChanged?.addListener(onSession);
    return () => chrome.storage?.onChanged?.removeListener(onSession);
  }, []);

  useEffect(() => {
    if (!sessionValid.current) return;
    let active = true; setLoading(true); setError('');
    callWallet<PrivacyNotesPage>('GET_PRIVACY_NOTES', { chainId, poolAddress, filter, page, pageSize }).then(next => {
      if (!active || !sessionValid.current) return; setData(next); if (next.page !== page) setPage(next.page);
      setSelected(previous => Object.fromEntries(Object.entries(previous).flatMap(([id, note]) => {
        const current = next.items.find(item => item.id === id);
        return current ? eligible(current) ? [[id, current]] : [] : [[id, note]];
      })));
    }).catch(cause => { if (active && sessionValid.current) setError(errorText(cause)); }).finally(() => { if (active && sessionValid.current) setLoading(false); });
    return () => { active = false; };
  }, [chainId, poolAddress, filter, page, pageSize, revision]);
  useEffect(() => {
    let active = true; setMaxInputs(null); setLimitError('');
    if (!payment.loaded || data?.syncState !== 'complete') return;
    callWallet<{ maxInputs: number }>('GET_PRIVACY_MERGE_LIMIT', { chainId, poolAddress }).then(result => { if (active && sessionValid.current) setMaxInputs(result.maxInputs); }).catch(cause => { if (active && sessionValid.current) setLimitError(errorText(cause)); });
    return () => { active = false; };
  }, [chainId, poolAddress, payment.mode, payment.loaded, data?.syncState, revision]);
  useEffect(() => {
    let active = true;
    callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS').then(settings => { if (active && sessionValid.current) setWritesEnabled(settings.experimentalPrivacyWrites); }).catch(cause => { if (active && sessionValid.current) setError(errorText(cause)); });
    callWallet<PrivacyMergePlan | null>('GET_PRIVACY_MERGE_PLAN').then(value => { if (active && sessionValid.current) setPlan(value); }).catch(cause => { if (active && sessionValid.current) setError(errorText(cause)); });
    return () => { active = false; };
  }, [chainId]);
  const updatePlan = (next: PrivacyMergePlan) => {
    if (!sessionValid.current) return;
    setPlan(next);
    if (done(next)) { setRunning(false); setSelected({}); setRevision(value => value + 1); onChanged?.(); }
    else if (next.state === 'paused' || next.state === 'review') setRunning(false);
  };
  useEffect(() => {
    if (!running || !plan?.id) return;
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      setBusy(true);
      try {
        const next = await callWallet<PrivacyMergePlan>('ADVANCE_PRIVACY_MERGE', { id: plan.id });
        if (!active || !sessionValid.current) return;
        updatePlan(next);
        if (!done(next) && next.state !== 'paused' && next.state !== 'review') timer = setTimeout(tick, ['ready', 'preparing'].includes(next.state) ? 800 : next.state === 'syncing' ? 15000 : 7000);
      } catch (cause) { if (active && sessionValid.current) { setError(errorText(cause)); setRunning(false); } }
      finally { if (mounted.current && sessionValid.current) setBusy(false); }
    };
    timer = setTimeout(tick, 700);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [running, plan?.id]);
  // Idle refresh never authorizes a transaction. Reopening requires Continue.
  useEffect(() => {
    if (!planPage || running || !plan?.id || done(plan)) return;
    let active = true;
    const timer = setInterval(() => {
      callWallet<PrivacyMergePlan>('GET_PRIVACY_MERGE_PLAN', { id: plan.id }).then(next => { if (active && sessionValid.current) updatePlan(next); }).catch(() => {});
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [planPage, running, plan?.id, plan?.state]);
  const sync = async () => {
    if (syncing) return; setSyncing(true); setError('');
    try { await callWallet('SYNC_PRIVACY', { chainId }); if (mounted.current && sessionValid.current) setRevision(value => value + 1); }
    catch (cause) { if (mounted.current && sessionValid.current) setError(errorText(cause)); }
    finally { if (mounted.current && sessionValid.current) setSyncing(false); }
  };
  const prepare = async (automatic: boolean) => {
    if (busy || activePlan) return; setBusy(true); setError('');
    try {
      const next = await callWallet<PrivacyMergePlan>('PREPARE_PRIVACY_MERGE', { chainId, poolAddress, automatic, noteIds: Object.keys(selected) });
      if (mounted.current && sessionValid.current) { setPlan(next); openPlan(); }
    } catch (cause) { if (mounted.current && sessionValid.current) setError(errorText(cause)); }
    finally { if (mounted.current && sessionValid.current) setBusy(false); }
  };
  const start = async () => {
    if (!plan || busy) return; setBusy(true); setError('');
    try {
      const next = await callWallet<PrivacyMergePlan>('ADVANCE_PRIVACY_MERGE', { id: plan.id, confirm: !plan.authorized });
      if (mounted.current && sessionValid.current) { updatePlan(next); setRunning(planPageOpen.current && !done(next) && next.state !== 'paused' && next.state !== 'review'); }
    } catch (cause) { if (mounted.current && sessionValid.current) setError(errorText(cause)); }
    finally { if (mounted.current && sessionValid.current) setBusy(false); }
  };
  const stop = async () => {
    if (!plan || busy) return; setRunning(false); setBusy(true); setError('');
    try {
      const next = await callWallet<PrivacyMergePlan>('CANCEL_PRIVACY_MERGE', { id: plan.id });
      if (mounted.current && sessionValid.current) { updatePlan(next); if (planPageOpen.current && !done(next) && next.operationId) setRunning(true); }
    } catch (cause) { if (mounted.current && sessionValid.current) setError(errorText(cause)); }
    finally { if (mounted.current && sessionValid.current) setBusy(false); }
  };
  const toggle = (note: PrivacyNoteSummary) => {
    setSelected(previous => {
      if (previous[note.id]) { const next = { ...previous }; delete next[note.id]; return next; }
      if (!maxInputs) return previous;
      return { ...previous, [note.id]: note };
    });
  };
  const canSelect = revealed && data?.syncState === 'complete' && maxInputs !== null && !busy && !loading && !syncing && !activePlan;
  const canMerge = canSelect && writesEnabled;
  const summaryRow = (label: string, value: string) => <div className="note-summary-row"><span>{label}</span><strong>{value}</strong></div>;
  return <section className="notes-section">
    <div className="row-between"><div><h2><GitMerge size={17} className="text-mint" />Notes 管理</h2><small>共 {data?.counts.all ?? '—'} 个 · 正余额可合并 {data?.mergeableCount ?? '—'} 个</small></div><IconButton label="同步 Notes" disabled={syncing || busy} onClick={sync}><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /></IconButton></div>
    <div className="note-counts">{([['spendable', '已确认可用'], ['pending', '待确认'], ['spent', '已花费']] as const).map(([key, label]) => <div key={key}><strong>{data?.counts[key] ?? '—'}</strong><small>{label}</small></div>)}</div>
    {activePlan && <div className="panel form-stack"><p className="micro">{plan.symbol} 合并计划 · {labels[plan.state]} · {plan.completedBatches}/{plan.plannedBatches} 批</p><Button onClick={openPlan}>查看 / 继续合并计划</Button></div>}
    {!revealed && <Button onClick={() => setRevealed(true)}>显示 Note 金额以管理和合并</Button>}
    <div className="notes-filters" aria-label="Note 状态筛选">{([['all', '全部'], ['spendable', '可用'], ['pending', '待确认'], ['spent', '已花费']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{label} {data?.counts[value] ?? ''}</button>)}</div>
    <div className="row-between micro"><button disabled={!canSelect} className="text-mint" onClick={() => setSelected(previous => {
      const next = { ...previous };
      for (const note of data?.items ?? []) if (eligible(note)) next[note.id] = note;
      return next;
    })}>选择本页可用 Notes</button><button disabled={busy} className="text-muted" onClick={() => setSelected({})}>清空选择</button></div>
    {loading && <p role="status" className="micro text-muted">正在读取 Notes…</p>}
    {error && <p role="alert" className="micro text-danger">{error}</p>}
    {data?.syncState !== 'complete' && <p className="micro text-amber">{syncing ? '正在同步，完成后可合并。' : '当前同步尚未完成，可查看已有记录；请先同步再合并。'}</p>}
    <div className="notes-list" aria-busy={loading}>{data?.items.map(note => <article key={note.id} className={`note-item ${selected[note.id] ? 'selected' : ''}`}>
      <div className="note-item-header"><input type="checkbox" aria-label={`选择 Note ${short(note.id)}`} checked={Boolean(selected[note.id])} disabled={!canSelect || !eligible(note)} onChange={() => toggle(note)} /><strong className="mono">{amount(note.valueRaw)} <small>{symbol}</small></strong><span className={`tiny-badge ${note.spent ? 'neutral' : note.confirmed ? '' : 'public'}`}>{note.spent ? '已花费' : note.confirmed ? '可用' : '待确认'}</span></div>
      <div className="note-identity"><span className="mono" title={note.id}>Note {short(note.id)}</span><CopyButton compact value={note.id} label="复制 Note 标识" /></div>
      <div className="note-flags"><span>Confirmed <b>{note.confirmed ? '是 ✓' : '否'}</b></span><span>Spent <b>{note.spent ? '是' : '否'}</b></span><span>位置 <b>{note.position >= 0 ? note.position : '待写入'}</b></span></div>
      <div className="row-between micro text-muted"><span>区块 #{note.blockNumber.toLocaleString()}</span>{/^0x[0-9a-f]{64}$/i.test(note.txHash) && <a className="text-mint inline-flex items-center gap-1" href={`${network.explorerUrl}/tx/${note.txHash}`} target="_blank" rel="noreferrer">交易<ArrowUpRight size={12} /></a>}</div>
      {note.valueRaw === '0' && <small>零余额 Note，不参与合并</small>}
    </article>)}</div>
    {!loading && data?.items.length === 0 && <p className="empty-state">此分类暂无 Notes</p>}
    <div className="notes-pagination"><Select ariaLabel="每页 Notes 数量" value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }} options={[10, 20, 50].map(value => ({ value: String(value), label: `${value} 条 / 页` }))} /><div><IconButton label="上一页 Notes" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></IconButton><span>{data?.page ?? page} / {data?.pages ?? 1}</span><IconButton label="下一页 Notes" disabled={loading || page >= (data?.pages ?? 1)} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></IconButton></div></div>
    <p className="micro text-muted">{data?.total ?? 0} 条筛选结果 · {data?.syncedAt ? `最近同步 ${new Date(data.syncedAt).toLocaleTimeString()}` : '尚未同步'}</p>
    <div className="panel form-stack"><div className="row-between"><h2>合并 Notes</h2><MergeSettingsControl compact chainId={chainId} poolAddress={poolAddress} onSaved={() => setRevision(value => value + 1)} /></div>{!writesEnabled && <p className="micro text-amber">合并会发起隐私交易，请先在设置中开启实验性主网操作。</p>}<p className="micro text-muted">将多个可用 Notes 汇总回当前隐私地址，不是转给其他人。待确认、已花费和零余额 Notes 不参与。</p>{summaryRow('跨页已选', `${selection.length} 个`)}{summaryRow('所选总额', `${revealed ? formatUnits(selectedTotal, decimals) : '••••••'} ${symbol}`)}<small>{maxInputs ? `当前每批最多 ${maxInputs} 个输入；可跨页选择更多，超出后自动分批合并到 1 个。` : '读取合并输入上限中…'}</small>{limitError && <p className="micro text-danger">{limitError}</p>}<Button variant="primary" disabled={!canMerge || selection.length < 2} onClick={() => prepare(false)}><GitMerge size={16} />{busy ? '准备中…' : `预览合并所选 ${selection.length} 个`}</Button><Button disabled={!canMerge || (data?.mergeableCount ?? 0) < 2} onClick={() => prepare(true)}>自动合并全部可用 Notes → 1 个</Button><p className="micro text-muted">先预览范围与费用，再确认执行。自动合并仅处理开始时已确认的 Notes，不包含后续新入账。已花费的历史 Notes 会保留，不计入最终的 1 个可用 Note。</p></div>
    <details className="notes-payment"><summary>全局支付方式 · {payment.mode === 'private' ? '隐私资产' : network.nativeSymbol}</summary><PaymentModeControl nativeSymbol={network.nativeSymbol} disabled={busy || Boolean(activePlan)} /></details>
    {planPage && plan && <PageView open onOpenChange={closePlan} title={labels[plan.state]} description={`${plan.symbol} · ${NETWORKS[plan.chainId].name}`}>
      <div className="intro compact-intro"><span className="hero-symbol">{plan.state === 'complete' ? <Check size={28} /> : <GitMerge size={28} />}</span><h1>{plan.initialCount} 个 Notes → 1 个</h1><p>{plan.automatic ? '自动分批合并，后续批次不会超过已确认预算。' : '仅合并选中的 Notes，按每批上限分批处理；未选择的保持不变。'}</p></div>
      <div className="panel form-stack">{summaryRow('每批最多输入', `${plan.maxInputs} 个 Notes`)}{summaryRow('进度', `${plan.completedBatches} / ${plan.plannedBatches} 批`)}{summaryRow('参与总额', `${formatUnits(plan.initialTotalRaw, plan.decimals)} ${plan.symbol}`)}{summaryRow('当前批手续费', `${formatUnits(plan.preview.fees.feeRaw, plan.preview.fees.feeDecimals)} ${plan.preview.fees.feeSymbol}`)}{summaryRow('手续费总预算', `${formatUnits(plan.feeBudgetRaw, plan.preview.fees.feeDecimals)} ${plan.preview.fees.feeSymbol}`)}{summaryRow('最大原生 Gas 总预算', `${formatUnits(plan.gasBudgetWei, 18)} ${NETWORKS[plan.chainId].nativeSymbol}`)}{summaryRow('支付方式', plan.preview.paymentMode === 'private' ? '隐私资产支付 · Relayer' : '原生币 Gas')}{summaryRow('最终余额下限', `${formatUnits(BigInt(plan.initialTotalRaw) - (plan.preview.fees.feePool.toLowerCase() === plan.poolAddress.toLowerCase() ? BigInt(plan.feeBudgetRaw) : 0n), plan.decimals)} ${plan.symbol}`)}<p className="micro text-muted">费用按批次收取；不同币种手续费额外扣除。Gas 为费用上限，实际以链上执行为准。</p><div><small>合并输出到自己的隐私地址</small><p className="mono break-all text-xs mt-2">{plan.privacyAddress}</p></div></div>
      {plan.message && <p role="status" className={`panel micro ${plan.state === 'paused' ? 'text-amber' : 'text-muted'}`}>{plan.message}</p>}
      {busy && <p role="status" className="micro text-mint">正在处理当前批次，请勿重复提交…</p>}
      {error && <p role="alert" className="micro text-danger">{error}</p>}
      {(plan.txHash || plan.txHashes.length > 0) && <div className="panel form-stack">{[...new Set([...plan.txHashes, ...(plan.txHash ? [plan.txHash] : [])])].map((hash, index) => <a key={hash} className="explorer-link" href={`${NETWORKS[plan.chainId].explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">第 {index + 1} 笔 · {short(hash)}<ArrowUpRight size={13} /></a>)}</div>}
      {!done(plan) && <>{!running ? <Button variant="primary" disabled={busy || (!plan.authorized && !plan.preview.id)} onClick={start}>{plan.operationId ? '查询已提交批次' : plan.authorized ? '继续合并 / 查询当前批次' : plan.automatic || plan.plannedBatches > 1 ? '确认预算并分批合并到 1 个' : '确认合并所选 Notes'}</Button> : <Button onClick={() => setRunning(false)}>暂停后续批次</Button>}<Button disabled={busy} onClick={stop}>{plan.operationId ? '完成当前批次后停止' : '取消合并计划'}</Button><p className="micro text-muted">关闭此页面会暂停后续批次，已提交交易不撤销。新 Note 需 Confirmed 后才会继续；费用上涨、余额变化或会话锁定时会暂停。</p></>}
      <Button onClick={closePlan}>{done(plan) ? '返回 Notes 列表' : '返回并暂停'}</Button>
    </PageView>}
  </section>;
}
