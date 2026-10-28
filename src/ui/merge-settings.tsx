import { t } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, GitMerge, Settings } from 'lucide-react';
import { callWallet } from '../shared/runtime';
import { NETWORKS } from '../shared/networks';
import type {
  ChainId,
  PrivacyMergeLimits,
  TransactionSettings,
} from '../shared/types';
import {
  DEFAULT_MERGE_BATCH_SIZE,
  MERGE_WALLET_MAX_INPUTS,
} from '../privacy/merge-settings';
import { Button, Field, Input, PageView } from './primitives';
import { Segments } from './wallet-design';
export function MergeSettingsControl({
  chainId,
  poolAddress,
  compact = false,
  menu = false,
  onSaved,
}: {
  chainId: ChainId;
  poolAddress?: string;
  compact?: boolean;
  menu?: boolean;
  onSaved?: () => void;
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
    let active = true;
    setLoaded(false);
    setError('');
    setLimits(null);
    setLimitError('');
    callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS')
      .then((settings) => {
        if (!active) return;
        const batchSize =
          settings.privacyMergeBatchSize ?? DEFAULT_MERGE_BATCH_SIZE;
        setAutomatic(batchSize === 0);
        setCustom(String(batchSize || DEFAULT_MERGE_BATCH_SIZE));
        setLoaded(true);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    if (poolAddress)
      callWallet<PrivacyMergeLimits>('GET_PRIVACY_MERGE_LIMIT', {
        chainId,
        poolAddress,
      })
        .then((result) => {
          if (active) setLimits(result);
        })
        .catch((cause) => {
          if (active)
            setLimitError(
              cause instanceof Error ? cause.message : String(cause),
            );
        });
    return () => {
      active = false;
    };
  }, [open, chainId, poolAddress]);
  const valid =
    automatic ||
    (/^\d+$/.test(custom) &&
      Number(custom) >= 2 &&
      Number(custom) <= MERGE_WALLET_MAX_INPUTS);
  const requested = automatic ? MERGE_WALLET_MAX_INPUTS : Number(custom);
  const effective =
    valid && limits ? Math.min(requested, limits.executionMaxInputs) : null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !loaded || busy) return;
    setBusy(true);
    setError('');
    try {
      await callWallet('SET_TRANSACTION_SETTINGS', {
        privacyMergeBatchSize: automatic ? 0 : Number(custom),
      });
      onSaved?.();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const trigger = menu ? (
    <button className="settings-menu-item" onClick={() => setOpen(true)}>
      <GitMerge size={18} />
      <span>{t('凭证合并')}</span>
      <ChevronRight size={16} />
    </button>
  ) : (
    <Button size="small" onClick={() => setOpen(true)}>
      <Settings size={14} />
      {t('合并设置')}
    </Button>
  );
  return (
    <>
      {compact || menu ? (
        trigger
      ) : (
        <section className="panel">
          <div className="row-between">
            <div>
              <h2>{t('凭证合并设置')}</h2>
              <small>{t('设置每批合并数量')}</small>
            </div>
            {trigger}
          </div>
        </section>
      )}
      <PageView
        open={open}
        busy={busy}
        onOpenChange={setOpen}
        title={t('凭证合并设置')}
        description={t('全局偏好 \u00B7 仅用于新合并计划')}
      >
        <div className="panel form-stack">
          <h2>{t('每笔合并多少凭证')}</h2>
          <p className="micro text-muted">
            {t('可跨页选择，按每批数量合并。')}
          </p>
        </div>
        <form className="form-stack" onSubmit={save}>
          <fieldset disabled={!loaded || busy} className="form-stack">
            <Segments
              label={t('合并批量模式')}
              value={automatic ? 'auto' : 'custom'}
              onChange={(value) => setAutomatic(value === 'auto')}
              options={[
                { value: 'auto', label: t('自动上限') },
                { value: 'custom', label: t('自定义每批数量') },
              ]}
            />
            {automatic ? (
              <p className="panel micro text-muted">
                {t('按当前合约和支付方式允许的上限分批，钱包最多使用 ')}
                {MERGE_WALLET_MAX_INPUTS}
                {t(' 个输入。原生币模式还需通过实际 Gas 预估。')}
              </p>
            ) : (
              <>
                <Field
                  label={t('每批目标凭证数量')}
                  hint={t(
                    '输入 2\u2013{0} 的整数，默认 {1}；数量越大，证明计算和单笔 Gas 通常越高。',
                    [MERGE_WALLET_MAX_INPUTS, DEFAULT_MERGE_BATCH_SIZE],
                  )}
                  error={
                    valid
                      ? undefined
                      : t('请输入 2\u2013{0} 的整数', [MERGE_WALLET_MAX_INPUTS])
                  }
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={2}
                    max={MERGE_WALLET_MAX_INPUTS}
                    step={1}
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                  />
                </Field>
                <div className="merge-size-options">
                  {[4, 8, 9, 16, 24, 32].map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={custom === String(value)}
                      onClick={() => setCustom(String(value))}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </>
            )}
          </fieldset>
          <section className="panel form-stack">
            <h2>
              {NETWORKS[chainId].name}
              {t(' 执行限制')}
            </h2>
            <div className="note-summary-row">
              <span>{t('钱包每笔输入上限')}</span>
              <strong>{MERGE_WALLET_MAX_INPUTS}</strong>
            </div>
            {limits ? (
              <>
                <div className="note-summary-row">
                  <span>{t('合约 maxActions')}</span>
                  <strong>
                    {limits.contractMaxActions}
                    {t('（包含输出）')}
                  </strong>
                </div>
                <div className="note-summary-row">
                  <span>
                    {limits.paymentMode === 'private'
                      ? t('合约 / Relayer 允许输入')
                      : t('合约允许输入（钱包范围内）')}
                  </span>
                  <strong>{limits.executionMaxInputs}</strong>
                </div>
                <div className="note-summary-row">
                  <span>{t('新计划每批实际采用')}</span>
                  <strong className="text-mint">
                    {effective ?? '—'}
                    {t(' 个凭证')}
                  </strong>
                </div>
                {effective !== null &&
                  requested > limits.executionMaxInputs && (
                    <p className="micro text-amber">
                      {t('超过当前上限，将采用 ')}
                      {effective}
                      {t(' 个。')}
                    </p>
                  )}
              </>
            ) : (
              <p className="micro text-muted">
                {poolAddress
                  ? limitError || t('正在读取当前资产池限制\u2026')
                  : t('在资产详情中查看该资产的合并上限。')}
              </p>
            )}
            <p className="micro text-muted">
              {t('如超出 Gas 限制，请调小每批数量。')}
            </p>
          </section>
          <p className="micro text-muted">
            {t('修改数量前，请先停止当前计划并重新预览。')}
          </p>
          {error && (
            <p role="alert" className="micro text-danger">
              {t(error)}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={!loaded || !valid || busy}
          >
            {busy ? t('保存中\u2026') : t('保存合并设置')}
          </Button>
        </form>
      </PageView>
    </>
  );
}
