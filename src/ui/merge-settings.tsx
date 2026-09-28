import { useEffect, useState, type FormEvent } from 'react';
import { Settings } from 'lucide-react';
import { callWallet } from '../shared/runtime';
import { NETWORKS } from '../shared/networks';
import type { ChainId, PrivacyMergeLimits, TransactionSettings } from '../shared/types';
import { DEFAULT_MERGE_BATCH_SIZE, MERGE_WALLET_MAX_INPUTS } from '../privacy/merge-settings';
import { Button, Field, Input, PageView } from './primitives';
import { Segments } from './wallet-design';

export function MergeSettingsControl({ chainId, poolAddress, compact = false, onSaved }: {
  chainId: ChainId; poolAddress?: string; compact?: boolean; onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [custom, setCustom] = useState(String(DEFAULT_MERGE_BATCH_SIZE));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limits, setLimits] = useState<PrivacyMergeLimits | null>(null);
  const [limitError, setLimitError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true; setLoaded(false); setError(''); setLimits(null); setLimitError('');
    callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS').then(settings => {
      if (!active) return;
      const batchSize = settings.privacyMergeBatchSize ?? DEFAULT_MERGE_BATCH_SIZE;
      setAutomatic(batchSize === 0); setCustom(String(batchSize || DEFAULT_MERGE_BATCH_SIZE)); setLoaded(true);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    if (poolAddress) callWallet<PrivacyMergeLimits>('GET_PRIVACY_MERGE_LIMIT', { chainId, poolAddress }).then(result => {
      if (active) setLimits(result);
    }).catch(cause => { if (active) setLimitError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [open, chainId, poolAddress]);
  const valid = automatic || (/^\d+$/.test(custom) && Number(custom) >= 2 && Number(custom) <= MERGE_WALLET_MAX_INPUTS);
  const requested = automatic ? MERGE_WALLET_MAX_INPUTS : Number(custom);
  const effective = valid && limits ? Math.min(requested, limits.executionMaxInputs) : null;
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!valid || !loaded || busy) return;
    setBusy(true); setError('');
    try {
      await callWallet('SET_TRANSACTION_SETTINGS', { privacyMergeBatchSize: automatic ? 0 : Number(custom) });
      onSaved?.(); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const trigger = <Button size="small" onClick={() => setOpen(true)}><Settings size={14} />合并设置</Button>;
  return <>{compact ? trigger : <section className="panel"><div className="row-between"><div><h2>Notes 合并设置</h2><small>每批数量 · 自动分批 · 不限制总选择数</small></div>{trigger}</div></section>}
    <PageView open={open} busy={busy} onOpenChange={setOpen} title="Notes 合并设置" description="全局偏好 · 仅用于新合并计划">
      <div className="panel form-stack"><h2>每笔合并多少 Notes</h2><p className="micro text-muted">总选择数量与单笔输入上限分开计算。可以跨页选择更多 Notes，再按照每批数量分批合并为 1 个。</p></div>
      <form className="form-stack" onSubmit={save}>
        <fieldset disabled={!loaded || busy} className="form-stack">
          <Segments label="合并批量模式" value={automatic ? 'auto' : 'custom'} onChange={value => setAutomatic(value === 'auto')} options={[{ value: 'auto', label: '自动上限' }, { value: 'custom', label: '自定义每批数量' }]} />
          {automatic ? <p className="panel micro text-muted">按当前合约和支付方式允许的上限分批，钱包最多使用 {MERGE_WALLET_MAX_INPUTS} 个输入。原生币模式还需通过实际 Gas 预估。</p> : <><Field label="每批目标 Notes 数量" hint={`输入 2–${MERGE_WALLET_MAX_INPUTS} 的整数，默认 ${DEFAULT_MERGE_BATCH_SIZE}；数量越大，证明计算和单笔 Gas 通常越高。`} error={valid ? undefined : `请输入 2–${MERGE_WALLET_MAX_INPUTS} 的整数`}><Input type="number" inputMode="numeric" min={2} max={MERGE_WALLET_MAX_INPUTS} step={1} value={custom} onChange={event => setCustom(event.target.value)} /></Field><div className="merge-size-options">{[4, 8, 9, 16, 24, 32].map(value => <button type="button" key={value} aria-pressed={custom === String(value)} onClick={() => setCustom(String(value))}>{value}</button>)}</div></>}
        </fieldset>
        <section className="panel form-stack"><h2>{NETWORKS[chainId].name} 执行限制</h2><div className="note-summary-row"><span>钱包每笔输入上限</span><strong>{MERGE_WALLET_MAX_INPUTS}</strong></div>{limits ? <><div className="note-summary-row"><span>合约 maxActions</span><strong>{limits.contractMaxActions}（包含输出）</strong></div><div className="note-summary-row"><span>{limits.paymentMode === 'private' ? '合约 / Relayer 允许输入' : '合约允许输入（钱包范围内）'}</span><strong>{limits.executionMaxInputs}</strong></div><div className="note-summary-row"><span>新计划每批实际采用</span><strong className="text-mint">{effective ?? '—'} 个 Notes</strong></div>{effective !== null && requested > limits.executionMaxInputs && <p className="micro text-amber">目标数量高于当前执行上限，新计划会采用 {effective} 个，不会强行绕过限制。</p>}</> : <p className="micro text-muted">{poolAddress ? limitError || '正在读取当前资产池限制…' : '进入具体隐私资产的合并设置，可查看该池当前的实际输入上限。'}</p>}<p className="micro text-muted">原生币模式：节点能否执行以生成证明后的 Gas 预估为准；遇到 Gas 上限错误时可调小每批数量。隐私支付模式还受 Relayer Gas 配置约束。</p></section>
        <p className="micro text-muted">已有合并计划保留确认时的批次与费用预算。如需调整正在进行的计划，请先停止，再重新预览。</p>
        {error && <p role="alert" className="micro text-danger">{error}</p>}
        <Button type="submit" variant="primary" disabled={!loaded || !valid || busy}>{busy ? '保存中…' : '保存合并设置'}</Button>
      </form>
    </PageView>
  </>;
}
