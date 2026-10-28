import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { callWallet } from '../shared/runtime';
import type { PrivacyPaymentMode, TransactionSettings } from '../shared/types';
import { Segments } from './wallet-design';
export function usePrivacyPaymentMode() {
  const [mode, setMode] = useState<PrivacyPaymentMode>('native');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () =>
      callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS')
        .then((settings) => {
          if (active) {
            setMode(settings.privacyPaymentMode ?? 'native');
            setLoaded(true);
            setError('');
          }
        })
        .catch((cause) => {
          if (active)
            setError(cause instanceof Error ? cause.message : String(cause));
        });
    void refresh();
    const update = () => {
      void refresh();
    };
    const storage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes.transactionSettings) update();
    };
    window.addEventListener('plabs-payment-mode', update);
    chrome.storage?.onChanged?.addListener(storage);
    return () => {
      active = false;
      window.removeEventListener('plabs-payment-mode', update);
      chrome.storage?.onChanged?.removeListener(storage);
    };
  }, []);
  const change = async (value: string) => {
    if (
      saving ||
      value === mode ||
      !loaded ||
      (value !== 'native' && value !== 'private')
    )
      return;
    setSaving(true);
    setError('');
    try {
      const settings = await callWallet<TransactionSettings>(
        'SET_TRANSACTION_SETTINGS',
        { privacyPaymentMode: value },
      );
      setMode(settings.privacyPaymentMode);
      window.dispatchEvent(new Event('plabs-payment-mode'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return { mode, loaded, saving, error, change };
}
export function PaymentModeControl({
  nativeSymbol,
  disabled = false,
}: {
  nativeSymbol: string;
  disabled?: boolean;
}) {
  const { mode, loaded, saving, error, change } = usePrivacyPaymentMode();
  return (
    <section className="panel form-stack payment-mode-panel">
      <div className="row-between">
        <h2>{t('手续费支付方式')}</h2>
        <small>{saving ? t('保存中\u2026') : t('自动保存')}</small>
      </div>
      <fieldset disabled={disabled || saving || !loaded}>
        <Segments
          label={t('全局手续费支付方式')}
          value={mode}
          onChange={(value) => {
            void change(value);
          }}
          options={[
            { value: 'native', label: t('{0} \u00B7 原生币', [nativeSymbol]) },
            { value: 'private', label: t('隐私资产支付') },
          ]}
        />
      </fieldset>
      <p className="micro text-muted">
        {mode === 'native'
          ? t('公开账户支付 {0} Gas，发起地址可见。', [nativeSymbol])
          : t('使用隐私资产支付手续费，由 Relayer 代付 Gas。')}
        {t(' 存入仍需支付原生 Gas。')}
      </p>
      {error && (
        <p role="alert" className="micro text-danger">
          {t(error)}
        </p>
      )}
    </section>
  );
}
