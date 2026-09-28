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
    const refresh = () => callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS').then(settings => {
      if (active) { setMode(settings.privacyPaymentMode ?? 'native'); setLoaded(true); setError(''); }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    void refresh();
    const update = () => { void refresh(); };
    const storage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.transactionSettings) update();
    };
    window.addEventListener('plabs-payment-mode', update);
    chrome.storage?.onChanged?.addListener(storage);
    return () => { active = false; window.removeEventListener('plabs-payment-mode', update); chrome.storage?.onChanged?.removeListener(storage); };
  }, []);
  const change = async (value: string) => {
    if (saving || !loaded || (value !== 'native' && value !== 'private')) return;
    setSaving(true); setError('');
    try {
      const settings = await callWallet<TransactionSettings>('SET_TRANSACTION_SETTINGS', { privacyPaymentMode: value });
      setMode(settings.privacyPaymentMode); window.dispatchEvent(new Event('plabs-payment-mode'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return { mode, loaded, saving, error, change };
}

export function PaymentModeControl({ nativeSymbol, disabled = false }: { nativeSymbol: string; disabled?: boolean }) {
  const { mode, loaded, saving, error, change } = usePrivacyPaymentMode();
  return <section className="panel form-stack payment-mode-panel"><div className="row-between"><h2>手续费支付方式</h2><small>{saving ? '保存中…' : '全局设置 · 自动保存'}</small></div>
    <fieldset disabled={disabled || saving || !loaded}><Segments label="全局手续费支付方式" value={mode} onChange={value => { void change(value); }} options={[{ value: 'native', label: `${nativeSymbol} · 原生币` }, { value: 'private', label: '隐私资产支付' }]} /></fieldset>
    <p className="micro text-muted">{mode === 'native' ? `当前 EVM 账户支付 ${nativeSymbol} Gas，链上可见交易发起地址。` : 'Relayer 代付 Gas，从隐私资产扣除手续费，无需公开账户发起转账。'} Shield 存入仍需原生 Gas。</p>
    {error && <p role="alert" className="micro text-danger">{error}</p>}
  </section>;
}
