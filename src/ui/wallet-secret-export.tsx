import { useEffect, useRef, useState, type FormEvent } from 'react';
import { callWallet } from '../shared/runtime';
import { Button, Field, PageView } from './primitives';
import { PasswordInput, SubmitButton } from './wallet-design';

export function WalletSecretExport({ accountId, accountName, address, type, onClose }: {
  accountId: string; accountName: string; address: string;
  type: 'mnemonic' | 'privateKey'; onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const request = useRef(0);
  const label = type === 'privateKey' ? '私钥' : '助记词';
  useEffect(() => {
    const hide = () => {
      request.current++;
      setSecret(''); setPassword(''); setBusy(false); setCopied(false); setError('');
    };
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      request.current++;
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!secret) return;
    const timer = window.setTimeout(() => { setSecret(''); setCopied(false); }, 60_000);
    return () => window.clearTimeout(timer);
  }, [secret]);
  const reveal = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password || !acknowledged) return;
    const revision = ++request.current;
    setBusy(true); setError('');
    try {
      const result = await callWallet<{ secret: string }>('EXPORT_WALLET_SECRET', { accountId, type, password });
      if (request.current === revision) setSecret(result.secret);
    } catch (cause) {
      if (request.current === revision) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === revision) { setPassword(''); setBusy(false); }
    }
  };
  const copy = async () => {
    const revision = request.current;
    try {
      await navigator.clipboard.writeText(secret);
      if (request.current === revision) { setCopied(true); setError(''); }
    } catch {
      if (request.current === revision) setError('复制失败，请手动抄写凭证');
    }
  };
  return <PageView open onOpenChange={onClose} title={`导出${label}`} description="当前 EVM 账户 · 验证主密码">
    <div className="panel form-stack"><strong>{accountName}</strong><p className="mono break-all text-xs">{address}</p><p className="text-xs leading-6 text-muted">获得{label}的人可以控制此账户的公开资产。请离线妥善保存，勿截图或发送给他人。隐私资产仍需单独备份加密 Vault 和隐私密码。</p></div>
    {secret ? <>
      {type === 'mnemonic' ? <div className="phrase-grid">{secret.split(' ').map((word, index) => <div key={index}><b>{index + 1}</b><span>{word}</span></div>)}</div> : <div className="panel mono break-all text-xs" aria-label="当前账户私钥">{secret}</div>}
      <p className="micro text-muted">60 秒后或离开窗口时自动隐藏。复制会将明文写入系统剪贴板，请使用后及时清理。</p>
      <Button onClick={copy}>{copied ? '已复制' : `复制${label}`}</Button>
      <Button onClick={onClose}>隐藏并关闭</Button>
    </> : <form className="form-stack" onSubmit={reveal}>
      <Field label="钱包主密码"><PasswordInput value={password} onChange={setPassword} autoFocus /></Field>
      <label className="check-row"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>我理解泄露{label}的风险，并确认在安全环境中导出。</span></label>
      <SubmitButton busy={busy} disabled={!password || !acknowledged}>验证并显示{label}</SubmitButton>
    </form>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </PageView>;
}
