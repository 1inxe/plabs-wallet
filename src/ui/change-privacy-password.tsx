import { useState, type FormEvent } from 'react';
import { Check, Download, KeyRound } from 'lucide-react';
import { callWallet } from '../shared/runtime';
import { assertStrongPassword } from '../shared/vault';
import { Button, Field, PageView } from './primitives';
import { PasswordInput, SubmitButton } from './wallet-design';

export function ChangePrivacyPasswordPage({ walletAddress, onClose, onChanged }: {
  walletAddress: string; onClose: () => void; onChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState('');
  let passwordError = '';
  if (newPassword) {
    try { assertStrongPassword(newPassword); }
    catch (cause) { passwordError = cause instanceof Error ? cause.message : String(cause); }
    if (newPassword === currentPassword) passwordError = '新密码不能与当前隐私密码相同';
  }
  const mismatch = Boolean(confirmPassword && confirmPassword !== newPassword);
  const canSubmit = Boolean(currentPassword && newPassword && confirmPassword && !passwordError && !mismatch);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true); setError('');
    try {
      await callWallet('CHANGE_PRIVACY_PASSWORD', { walletAddress, currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setChanged(true); onChanged(); window.scrollTo(0, 0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const exportBackup = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const vault = await callWallet<object>('EXPORT_PRIVACY_VAULT', { walletAddress });
      const url = URL.createObjectURL(new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `plabs-vault-${walletAddress.slice(0, 8)}-${Date.now()}.json`;
      anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setExported(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <PageView open busy={busy} onOpenChange={onClose} title={changed ? '隐私密码已修改' : '修改隐私密码'} description="当前账户 · 独立隐私密码">
    {changed ? <>
      <div className="intro compact-intro"><span className="hero-symbol"><Check size={28} /></span><h1>密码修改成功</h1><p>隐私账户已锁定，请使用新密码重新解锁。隐私地址、资产和同步记录保持不变。</p></div>
      <div className="panel text-xs leading-6 text-muted">请重新导出加密 Vault 并保存新密码。旧备份仍使用旧密码，修改本地密码不会使旧备份失效，也不会修改官网的密码。</div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {exported && <p role="status" className="text-xs text-mint">新 Vault 已导出，请与新密码妥善保存。</p>}
      <Button variant="primary" disabled={busy} onClick={exportBackup}><Download size={17} />{busy ? '正在导出…' : exported ? '再次导出新 Vault' : '导出新 Vault 备份'}</Button>
      <Button disabled={busy} onClick={onClose}>完成</Button>
    </> : <>
      <div className="panel form-stack"><h2><KeyRound size={18} className="text-mint" />更新隐私账户密码</h2><p className="text-xs leading-6 text-muted">验证当前隐私密码后，为此账户设置新的独立密码。修改成功后需重新解锁隐私账户，EVM 钱包主密码不受影响。</p></div>
      <form className="form-stack" onSubmit={submit}>
        <fieldset disabled={busy} className="form-stack">
          <Field label="当前隐私密码"><PasswordInput value={currentPassword} onChange={setCurrentPassword} placeholder="输入当前隐私密码" autoFocus /></Field>
          <Field label="新隐私密码" hint="至少 10 位，包含字母、数字、符号中的至少两类" error={passwordError || undefined}><PasswordInput value={newPassword} onChange={setNewPassword} placeholder="设置新的隐私密码" /></Field>
          <Field label="确认新隐私密码" error={mismatch ? '两次输入的新密码不一致' : undefined}><PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="再次输入新隐私密码" /></Field>
        </fieldset>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <SubmitButton busy={busy} disabled={!canSubmit}><KeyRound size={17} />确认修改隐私密码</SubmitButton>
      </form>
      <p className="micro text-muted">需要当前隐私密码才能修改，无法通过 EVM 主密码重置。修改成功后请重新导出 Vault 备份。</p>
    </>}
  </PageView>;
}
