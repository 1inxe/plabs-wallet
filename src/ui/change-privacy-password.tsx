import { t } from '../i18n';
import { useState, type FormEvent } from 'react';
import { Check, Download, KeyRound } from 'lucide-react';
import { callWallet } from '../shared/runtime';
import { assertStrongPassword } from '../shared/vault';
import { Button, Field, PageView } from './primitives';
import { PasswordInput, SubmitButton } from './wallet-design';
export function ChangePrivacyPasswordPage({
  walletAddress,
  onClose,
  onChanged,
}: {
  walletAddress: string;
  onClose: () => void;
  onChanged: () => void;
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
    try {
      assertStrongPassword(newPassword);
    } catch (cause) {
      passwordError = cause instanceof Error ? cause.message : String(cause);
    }
    if (newPassword === currentPassword)
      passwordError = t('新密码不能与当前隐私密码相同');
  }
  const mismatch = Boolean(confirmPassword && confirmPassword !== newPassword);
  const canSubmit = Boolean(
    currentPassword &&
    newPassword &&
    confirmPassword &&
    !passwordError &&
    !mismatch,
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await callWallet('CHANGE_PRIVACY_PASSWORD', {
        walletAddress,
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setChanged(true);
      onChanged();
      window.scrollTo(0, 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const exportBackup = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const vault = await callWallet<object>('EXPORT_PRIVACY_VAULT', {
        walletAddress,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(vault, null, 2)], {
          type: 'application/json',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `plabs-vault-${walletAddress.slice(0, 8)}-${Date.now()}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExported(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageView
      open
      busy={busy}
      onOpenChange={onClose}
      title={changed ? t('隐私密码已修改') : t('修改隐私密码')}
      description={t('当前账户 \u00B7 独立隐私密码')}
    >
      {changed ? (
        <>
          <div className="intro compact-intro">
            <span className="hero-symbol">
              <Check size={28} />
            </span>
            <h1>{t('密码修改成功')}</h1>
            <p>
              {t(
                '隐私账户已锁定，请使用新密码重新解锁。隐私地址、资产和同步记录保持不变。',
              )}
            </p>
          </div>
          <div className="panel text-xs leading-6 text-muted">
            {t('请导出新备份并保存新密码。旧备份仍使用旧密码，且依然有效。')}
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {t(error)}
            </p>
          )}
          {exported && (
            <p role="status" className="text-xs text-mint">
              {t('新备份已导出，请与新密码妥善保存。')}
            </p>
          )}
          <Button variant="primary" disabled={busy} onClick={exportBackup}>
            <Download size={17} />
            {busy
              ? t('正在导出\u2026')
              : exported
                ? t('再次导出新备份')
                : t('导出新备份')}
          </Button>
          <Button disabled={busy} onClick={onClose}>
            {t('完成')}
          </Button>
        </>
      ) : (
        <>
          <div className="panel form-stack">
            <h2>
              <KeyRound size={18} className="text-mint" />
              {t('更新隐私账户密码')}
            </h2>
            <p className="text-xs leading-6 text-muted">
              {t('修改后需重新解锁，钱包主密码不变。')}
            </p>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <fieldset disabled={busy} className="form-stack">
              <Field label={t('当前隐私密码')}>
                <PasswordInput
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  placeholder={t('输入当前隐私密码')}
                  autoFocus
                />
              </Field>
              <Field
                label={t('新隐私密码')}
                hint={t('至少 10 位，包含字母、数字、符号中的至少两类')}
                error={passwordError || undefined}
              >
                <PasswordInput
                  value={newPassword}
                  onChange={setNewPassword}
                  placeholder={t('设置新的隐私密码')}
                />
              </Field>
              <Field
                label={t('确认新隐私密码')}
                error={mismatch ? t('两次输入的新密码不一致') : undefined}
              >
                <PasswordInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder={t('再次输入新隐私密码')}
                />
              </Field>
            </fieldset>
            {error && (
              <p role="alert" className="text-xs text-danger">
                {t(error)}
              </p>
            )}
            <SubmitButton busy={busy} disabled={!canSubmit}>
              <KeyRound size={17} />
              {t('确认修改隐私密码')}
            </SubmitButton>
          </form>
          <p className="micro text-muted">
            {t('隐私密码无法通过主密码重置。修改后请重新导出备份。')}
          </p>
        </>
      )}
    </PageView>
  );
}
