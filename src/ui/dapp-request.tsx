import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Lock, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { callWallet } from '../shared/runtime';
import type { DappUiState } from '../shared/types';
import { walletErrorMessage } from '../shared/errors';
import { Button, Field } from './primitives';
import { PageHeader, PasswordInput } from './wallet-design';

export function useDappRequest() {
  const [task, setTask] = useState<DappUiState | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) { queued.current = true; return inFlight.current; }
    const fetch = async () => {
      do {
        queued.current = false;
        try { const next = await callWallet<DappUiState | null>('GET_DAPP_UI_STATE'); if (alive.current) setTask(next?.phase === 'success' ? null : next); }
        catch { /* Keep the last state during transient service-worker wakeups. */ }
        finally { if (alive.current) setLoading(false); }
      } while (queued.current && alive.current);
    };
    inFlight.current = fetch();
    try { await inFlight.current; } finally { inFlight.current = null; }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    const message = (value: { target?: string; action?: string }) => { if (value.target === 'popup-ui' && value.action === 'DAPP_STATE_CHANGED') void refresh(); };
    chrome.runtime.onMessage.addListener(message);
    return () => { alive.current = false; clearInterval(timer); chrome.runtime.onMessage.removeListener(message); };
  }, [refresh]);
  return { task, loading, refresh };
}
export function DappRequestNotice({ task, refresh }: { task: DappUiState; refresh: () => Promise<void> }) {
  return <div className="dapp-unlock-notice"><Globe size={15} /><div><strong>网站请求等待处理</strong><span title={task.origin}>{task.origin}</span></div>{task.canCancel && <button aria-label="取消网站请求" onClick={async () => { await callWallet('CANCEL_DAPP_REQUEST', { id: task.id }).catch(() => {}); await refresh(); }}><X size={17} /></button>}</div>;
}
export function DappRequestView({ task, refresh, onSetupPrivacy }: { task: DappUiState; refresh: () => Promise<void>; onSetupPrivacy: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const terminal = task.phase === 'error';
  const needsPrivacy = !terminal && task.requiresPrivacy && task.privacyUnlocked === false;
  const action = async (work: () => Promise<unknown>) => {
    if (busy) return; setBusy(true); setError('');
    try { await work(); await refresh(); }
    catch (cause) { setError(walletErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const unlock = async (event: React.FormEvent) => {
    event.preventDefault(); if (!password) return;
    await action(async () => { await callWallet('UNLOCK_PRIVACY', { password }); setPassword(''); await callWallet('RESUME_DAPP_REQUEST', { id: task.id }); });
  };
  const title = terminal ? '请求未完成' : needsPrivacy ? '先解锁隐私账户' : task.approval?.title ?? '正在处理网站请求';
  const confirmLabel = task.approval?.kind === 'personal_sign' ? '确认签名' : task.approval?.title.includes('不广播') ? '确认预览' : task.approval?.title.includes('第 1/2') ? '生成证明并继续' : '确认';
  return <div className="wallet-shell dapp-request-page"><PageHeader title={title} subtitle="在 PLabs 插件内安全处理" /><main className="page-body dapp-request-body">
    <div className="dapp-origin"><Globe size={17} /><span>{task.origin}</span></div>
    {terminal ? <><div className="intro compact-intro"><span className="hero-symbol"><X size={28} /></span><p>{task.error ?? task.message}</p></div><Button variant="primary" disabled={busy} onClick={() => action(() => callWallet('DISMISS_DAPP_REQUEST', { id: task.id }))}>返回钱包</Button></> : needsPrivacy ? <>
      <div className="panel form-stack"><h2><ShieldCheck size={18} className="text-mint" />独立隐私账户</h2><p className="micro text-muted">{task.privacyExists ? '主钱包已解锁。请输入独立隐私密码，成功后自动继续原来的请求；解锁不会自动授权交易。' : '此 EVM 账户尚未绑定隐私账户。请先创建或导入，完成后继续原请求。'}</p></div>
      {task.privacyExists ? <form className="form-stack" onSubmit={unlock}><Field label="独立隐私密码"><PasswordInput value={password} onChange={setPassword} placeholder="输入独立隐私密码" autoFocus /></Field><Button variant="primary" type="submit" disabled={busy || !password}><Lock size={16} />{busy ? '正在解锁…' : '解锁并继续'}</Button></form> : <Button variant="primary" onClick={onSetupPrivacy}>创建 / 导入隐私账户</Button>}
      {task.canCancel && <Button disabled={busy} onClick={() => action(() => callWallet('CANCEL_DAPP_REQUEST', { id: task.id }))}>取消请求</Button>}
    </> : task.approval ? <>
      <div className="panel approval-fields">{Object.entries(task.approval.details).map(([label, value]) => <div className="approval-field" key={label}><small>{label}</small><p className={label === '消息' ? 'approval-message' : ''}>{value}</p></div>)}</div>
      <div className="approval-actions"><Button disabled={busy} onClick={() => action(() => callWallet('APPROVAL_DECISION', { id: task.approval!.id, approved: false }))}>拒绝</Button><Button variant="primary" disabled={busy} onClick={() => action(() => callWallet('APPROVAL_DECISION', { id: task.approval!.id, approved: true }))}>{busy ? '处理中…' : confirmLabel}</Button></div>
    </> : <><div className="intro compact-intro"><RefreshCw size={28} className="animate-spin text-mint" /><p>{task.message ?? '正在准备确认内容…'}</p></div><p className="micro text-muted">请求会在当前插件面板继续。关闭面板不会重复提交，可点击插件图标重新查看。</p>{task.canCancel && <Button disabled={busy} onClick={() => action(() => callWallet('CANCEL_DAPP_REQUEST', { id: task.id }))}>取消请求</Button>}</>}
    {error && <p role="alert" className="micro text-danger wallet-error">{error}</p>}
  </main></div>;
}
