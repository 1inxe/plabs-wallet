import { t, dateLocale } from '../i18n';
import { MergeSettingsControl } from './merge-settings';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { formatUnits } from 'ethers';
import { NETWORKS } from '../shared/networks';
import { callWallet } from '../shared/runtime';
import type {
  ChainId,
  PrivacyMergePlan,
  PrivacyNoteFilter,
  PrivacyNoteSummary,
  PrivacyNotesPage,
  TransactionSettings,
} from '../shared/types';
import { Button, IconButton, PageView, Select } from './primitives';
import { CopyButton } from './wallet-design';
import { PaymentModeControl, usePrivacyPaymentMode } from './payment-mode';
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`;
const eligible = (note: PrivacyNoteSummary) =>
  note.confirmed && !note.spent && BigInt(note.valueRaw) > 0n;
const done = (plan: PrivacyMergePlan) =>
  ['complete', 'cancelled'].includes(plan.state);
const labels: Record<PrivacyMergePlan['state'], string> = {
  review: '确认合并计划',
  preparing: '准备下一批',
  ready: '准备就绪',
  submitting: '正在提交',
  waiting: '等待交易确认',
  syncing: '等待凭证确认',
  paused: '合并已暂停',
  complete: '合并完成',
  cancelled: '已停止合并',
};
export function PrivacyNotes({
  chainId,
  poolAddress,
  symbol,
  hidden = false,
  onChanged,
}: {
  chainId: ChainId;
  poolAddress: string;
  symbol: string;
  hidden?: boolean;
  onChanged?: () => void;
}) {
  const network = NETWORKS[chainId];
  const decimals =
    network.plabs?.pools.find(
      (pool) => pool.address.toLowerCase() === poolAddress.toLowerCase(),
    )?.decimals ?? 6;
  const [data, setData] = useState<PrivacyNotesPage | null>(null);
  const [filter, setFilter] = useState<PrivacyNoteFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Record<string, PrivacyNoteSummary>>(
    {},
  );
  const [maxInputs, setMaxInputs] = useState<number | null>(null);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparation, setPreparation] = useState<
    'automatic' | 'selected' | null
  >(null);
  const [prepareSeconds, setPrepareSeconds] = useState(0);
  const [preparePhase, setPreparePhase] = useState('idle');
  const [error, setError] = useState('');
  const [limitError, setLimitError] = useState('');
  const [revealed, setRevealed] = useState(!hidden);
  const [plan, setPlan] = useState<PrivacyMergePlan | null>(null);
  const [planPage, setPlanPage] = useState(false);
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  const sessionValid = useRef(true);
  const readRevision = useRef(0);
  const planPageOpen = useRef(false);
  const openPlan = () => {
    planPageOpen.current = true;
    setPlanPage(true);
  };
  const closePlan = () => {
    planPageOpen.current = false;
    setRunning(false);
    setPlanPage(false);
    setRevision((value) => value + 1);
  };
  const payment = usePrivacyPaymentMode();
  const activePlan = plan && !done(plan);
  const selection = Object.values(selected);
  const selectedTotal = selection.reduce(
    (sum, note) => sum + BigInt(note.valueRaw),
    0n,
  );
  const amount = (raw: string) =>
    revealed ? formatUnits(raw, decimals) : '••••••';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const onSession = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes.transactionSettings) {
        setRevision((value) => value + 1);
        return;
      }
      if (area !== 'session') return;
      if (
        changes.privacyUnlockSession?.newValue ||
        changes.walletUnlockSession?.newValue
      ) {
        sessionValid.current = true;
        readRevision.current++;
        setRevision((value) => value + 1);
      }
      if (
        (changes.privacyUnlockSession &&
          !changes.privacyUnlockSession.newValue) ||
        (changes.walletUnlockSession && !changes.walletUnlockSession.newValue)
      ) {
        sessionValid.current = false;
        readRevision.current++;
        setLoading(false);
        setBusy(false);
        setSyncing(false);
        setPreparation(null);
        setData(null);
        setSelected({});
        setRunning(false);
        setPlan(null);
        setPlanPage(false);
        planPageOpen.current = false;
        setError(t('隐私账户已锁定，请重新解锁后查看凭证'));
      }
    };
    chrome.storage?.onChanged?.addListener(onSession);
    return () => chrome.storage?.onChanged?.removeListener(onSession);
  }, []);
  useEffect(() => {
    if (!sessionValid.current) return;
    let active = true;
    const revision = ++readRevision.current;
    setLoading(true);
    setError('');
    callWallet<PrivacyNotesPage>('GET_PRIVACY_NOTES', {
      chainId,
      poolAddress,
      filter,
      page,
      pageSize,
    })
      .then((next) => {
        if (
          !active ||
          !sessionValid.current ||
          revision !== readRevision.current
        )
          return;
        setData(next);
        if (next.page !== page) setPage(next.page);
        setSelected((previous) =>
          Object.fromEntries(
            Object.entries(previous).flatMap(([id, note]) => {
              const current = next.items.find((item) => item.id === id);
              return current
                ? eligible(current)
                  ? [[id, current]]
                  : []
                : [[id, note]];
            }),
          ),
        );
      })
      .catch((cause) => {
        if (active && sessionValid.current && revision === readRevision.current)
          setError(errorText(cause));
      })
      .finally(() => {
        if (active && sessionValid.current && revision === readRevision.current)
          setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chainId, poolAddress, filter, page, pageSize, revision]);
  useEffect(() => {
    let active = true;
    setMaxInputs(null);
    setLimitError('');
    if (!payment.loaded || data?.syncState !== 'complete') return;
    callWallet<{
      maxInputs: number;
    }>('GET_PRIVACY_MERGE_LIMIT', { chainId, poolAddress })
      .then((result) => {
        if (active && sessionValid.current) setMaxInputs(result.maxInputs);
      })
      .catch((cause) => {
        if (active && sessionValid.current) setLimitError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [
    chainId,
    poolAddress,
    payment.mode,
    payment.loaded,
    data?.syncState,
    revision,
  ]);
  useEffect(() => {
    let active = true;
    callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS')
      .then((settings) => {
        if (active && sessionValid.current)
          setWritesEnabled(settings.experimentalPrivacyWrites);
      })
      .catch((cause) => {
        if (active && sessionValid.current) setError(errorText(cause));
      });
    callWallet<PrivacyMergePlan | null>('GET_PRIVACY_MERGE_PLAN')
      .then((value) => {
        if (active && sessionValid.current) setPlan(value);
      })
      .catch((cause) => {
        if (active && sessionValid.current) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [chainId]);
  useEffect(() => {
    if (!preparation) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const clock = setInterval(
      () => setPrepareSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    const progress = async () => {
      try {
        const next = await callWallet<{
          phase: string;
        }>('GET_PRIVACY_MERGE_PROGRESS', { chainId, poolAddress });
        if (active && sessionValid.current) setPreparePhase(next.phase);
      } catch {
        /* The preparation request reports the actual failure. */
      }
      if (active) timer = setTimeout(progress, 2000);
    };
    void progress();
    return () => {
      active = false;
      clearInterval(clock);
      if (timer) clearTimeout(timer);
    };
  }, [preparation, chainId, poolAddress]);
  const updatePlan = (next: PrivacyMergePlan) => {
    if (!sessionValid.current) return;
    setPlan(next);
    if (done(next)) {
      setRunning(false);
      setSelected({});
      setRevision((value) => value + 1);
      onChanged?.();
    } else if (next.state === 'paused' || next.state === 'review')
      setRunning(false);
  };
  useEffect(() => {
    if (!running || !plan?.id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      setBusy(true);
      try {
        const next = await callWallet<PrivacyMergePlan>(
          'ADVANCE_PRIVACY_MERGE',
          { id: plan.id },
        );
        if (!active || !sessionValid.current) return;
        updatePlan(next);
        if (!done(next) && next.state !== 'paused' && next.state !== 'review')
          timer = setTimeout(
            tick,
            ['ready', 'preparing'].includes(next.state)
              ? 800
              : next.state === 'syncing'
                ? 15000
                : 7000,
          );
      } catch (cause) {
        if (active && sessionValid.current) {
          setError(errorText(cause));
          setRunning(false);
        }
      } finally {
        if (mounted.current && sessionValid.current) setBusy(false);
      }
    };
    timer = setTimeout(tick, 700);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [running, plan?.id]);
  // Idle refresh never authorizes a transaction. Reopening requires Continue.
  useEffect(() => {
    if (!planPage || running || !plan?.id || done(plan)) return;
    let active = true;
    const timer = setInterval(() => {
      callWallet<PrivacyMergePlan>('GET_PRIVACY_MERGE_PLAN', { id: plan.id })
        .then((next) => {
          if (active && sessionValid.current) updatePlan(next);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [planPage, running, plan?.id, plan?.state]);
  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError('');
    try {
      await callWallet('SYNC_PRIVACY', { chainId });
      if (mounted.current && sessionValid.current)
        setRevision((value) => value + 1);
    } catch (cause) {
      if (mounted.current && sessionValid.current) setError(errorText(cause));
    } finally {
      if (mounted.current && sessionValid.current) setSyncing(false);
    }
  };
  const prepare = async (automatic: boolean) => {
    if (busy || activePlan) return;
    setBusy(true);
    setError('');
    setPreparation(automatic ? 'automatic' : 'selected');
    setPrepareSeconds(0);
    setPreparePhase('idle');
    try {
      const next = await callWallet<PrivacyMergePlan>('PREPARE_PRIVACY_MERGE', {
        chainId,
        poolAddress,
        automatic,
        noteIds: Object.keys(selected),
      });
      if (mounted.current && sessionValid.current) {
        setPlan(next);
        openPlan();
      }
    } catch (cause) {
      if (mounted.current && sessionValid.current) setError(errorText(cause));
    } finally {
      if (mounted.current && sessionValid.current) {
        setBusy(false);
        setPreparation(null);
      }
    }
  };
  const start = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await callWallet<PrivacyMergePlan>('ADVANCE_PRIVACY_MERGE', {
        id: plan.id,
        confirm: !plan.authorized,
      });
      if (mounted.current && sessionValid.current) {
        updatePlan(next);
        setRunning(
          planPageOpen.current &&
            !done(next) &&
            next.state !== 'paused' &&
            next.state !== 'review',
        );
      }
    } catch (cause) {
      if (mounted.current && sessionValid.current) setError(errorText(cause));
    } finally {
      if (mounted.current && sessionValid.current) setBusy(false);
    }
  };
  const stop = async () => {
    if (!plan || busy) return;
    setRunning(false);
    setBusy(true);
    setError('');
    try {
      const next = await callWallet<PrivacyMergePlan>('CANCEL_PRIVACY_MERGE', {
        id: plan.id,
      });
      if (mounted.current && sessionValid.current) {
        updatePlan(next);
        if (planPageOpen.current && !done(next) && next.operationId)
          setRunning(true);
      }
    } catch (cause) {
      if (mounted.current && sessionValid.current) setError(errorText(cause));
    } finally {
      if (mounted.current && sessionValid.current) setBusy(false);
    }
  };
  const toggle = (note: PrivacyNoteSummary) => {
    setSelected((previous) => {
      if (previous[note.id]) {
        const next = { ...previous };
        delete next[note.id];
        return next;
      }
      if (!maxInputs) return previous;
      return { ...previous, [note.id]: note };
    });
  };
  const canSelect =
    revealed &&
    data?.syncState === 'complete' &&
    maxInputs !== null &&
    !busy &&
    !loading &&
    !syncing &&
    !activePlan;
  const canMerge = canSelect && writesEnabled;
  const summaryRow = (label: string, value: string) => (
    <div className="note-summary-row">
      <span>{t(label)}</span>
      <strong>{value}</strong>
    </div>
  );
  return (
    <section className="notes-section">
      <div className="row-between">
        <div>
          <h2>
            <GitMerge size={17} className="text-mint" />
            {t('凭证管理')}
          </h2>
          <small>
            {t('共 ')}
            {data?.counts.all ?? '—'}
            {t(' 个 \u00B7 正余额可合并 ')}
            {data?.mergeableCount ?? '—'}
            {t(' 个')}
          </small>
        </div>
        <IconButton
          label={t('同步凭证')}
          disabled={syncing || busy}
          onClick={sync}
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
        </IconButton>
      </div>
      <div className="note-counts">
        {(
          [
            ['spendable', t('已确认可用')],
            ['pending', t('待确认')],
            ['spent', t('已花费')],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <strong>{data?.counts[key] ?? '—'}</strong>
            <small>{t(label)}</small>
          </div>
        ))}
      </div>
      {activePlan && (
        <div className="panel form-stack">
          <p className="micro">
            {plan.symbol}
            {t(' 合并计划 \u00B7 ')}
            {t(labels[plan.state])} · {plan.completedBatches}/
            {plan.plannedBatches}
            {t(' 批')}
          </p>
          <Button onClick={openPlan}>{t('查看 / 继续合并计划')}</Button>
        </div>
      )}
      {!revealed && (
        <Button onClick={() => setRevealed(true)}>
          {t('显示凭证金额以管理和合并')}
        </Button>
      )}
      <div className="notes-filters" aria-label={t('凭证状态筛选')}>
        {(
          [
            ['all', t('全部')],
            ['spendable', t('可用')],
            ['pending', t('待确认')],
            ['spent', t('已花费')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setPage(1);
            }}
          >
            {t(label)} {data?.counts[value] ?? ''}
          </button>
        ))}
      </div>
      <div className="row-between micro">
        <button
          disabled={!canSelect}
          className="text-mint"
          onClick={() =>
            setSelected((previous) => {
              const next = { ...previous };
              for (const note of data?.items ?? [])
                if (eligible(note)) next[note.id] = note;
              return next;
            })
          }
        >
          {t('选择本页可用凭证')}
        </button>
        <button
          disabled={busy}
          className="text-muted"
          onClick={() => setSelected({})}
        >
          {t('清空选择')}
        </button>
      </div>
      {loading && (
        <p role="status" className="micro text-muted">
          {t('正在读取凭证\u2026')}
        </p>
      )}
      {error && (
        <p role="alert" className="micro text-danger">
          {t(error)}
        </p>
      )}
      {data?.syncState !== 'complete' && (
        <p className="micro text-amber">
          {syncing ? t('正在同步，完成后可合并。') : t('请先完成同步再合并。')}
        </p>
      )}
      <div className="notes-list" aria-busy={loading}>
        {data?.items.map((note) => (
          <article
            key={note.id}
            className={`note-item ${selected[note.id] ? 'selected' : ''}`}
          >
            <div className="note-item-header">
              <input
                type="checkbox"
                aria-label={t('选择 Note {0}', [short(note.id)])}
                checked={Boolean(selected[note.id])}
                disabled={!canSelect || !eligible(note)}
                onChange={() => toggle(note)}
              />
              <strong className="mono">
                {amount(note.valueRaw)} <small>{symbol}</small>
              </strong>
              <span
                className={`tiny-badge ${note.spent ? 'neutral' : note.confirmed ? '' : 'public'}`}
              >
                {note.spent
                  ? t('已花费')
                  : note.confirmed
                    ? t('可用')
                    : t('待确认')}
              </span>
            </div>
            <div className="note-identity">
              <span className="mono" title={note.id}>
                {t('凭证 ')}
                {short(note.id)}
              </span>
              <CopyButton compact value={note.id} label={t('复制凭证标识')} />
            </div>

            <div className="row-between micro text-muted">
              <span>
                {t('区块 #')}
                {note.blockNumber.toLocaleString(dateLocale())}
              </span>
              {/^0x[0-9a-f]{64}$/i.test(note.txHash) && (
                <a
                  className="text-mint inline-flex items-center gap-1"
                  href={`${network.explorerUrl}/tx/${note.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('交易')}
                  <ArrowUpRight size={12} />
                </a>
              )}
            </div>
            {note.valueRaw === '0' && (
              <small>{t('零余额凭证，不参与合并')}</small>
            )}
          </article>
        ))}
      </div>
      {!loading && data?.items.length === 0 && (
        <p className="empty-state">{t('此分类暂无凭证')}</p>
      )}
      <div className="notes-pagination">
        <Select
          ariaLabel={t('每页凭证数量')}
          value={String(pageSize)}
          onValueChange={(value) => {
            setPageSize(Number(value));
            setPage(1);
          }}
          options={[10, 20, 50].map((value) => ({
            value: String(value),
            label: t('{0} 条 / 页', [value]),
          }))}
        />
        <div>
          <IconButton
            label={t('上一页凭证')}
            disabled={loading || page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <span>
            {data?.page ?? page} / {data?.pages ?? 1}
          </span>
          <IconButton
            label={t('下一页凭证')}
            disabled={loading || page >= (data?.pages ?? 1)}
            onClick={() => setPage((value) => value + 1)}
          >
            <ChevronRight size={16} />
          </IconButton>
        </div>
      </div>
      <p className="micro text-muted">
        {data?.total ?? 0}
        {t(' 条筛选结果 \u00B7 ')}
        {data?.syncedAt
          ? t('最近同步 {0}', [
              new Date(data.syncedAt).toLocaleTimeString(dateLocale()),
            ])
          : t('尚未同步')}
      </p>
      <div className="panel form-stack">
        <div className="row-between">
          <h2>{t('合并凭证')}</h2>
          <MergeSettingsControl
            compact
            chainId={chainId}
            poolAddress={poolAddress}
            onSaved={() => setRevision((value) => value + 1)}
          />
        </div>
        {!writesEnabled && (
          <p className="micro text-amber">
            {t('合并会发起隐私交易，请先在设置中开启实验性主网操作。')}
          </p>
        )}
        <p className="micro text-muted">
          {t('将可用凭证合并至自己的隐私地址。')}
        </p>
        {summaryRow(t('跨页已选'), t('{0} 个', [selection.length]))}
        {summaryRow(
          t('所选总额'),
          `${revealed ? formatUnits(selectedTotal, decimals) : '••••••'} ${symbol}`,
        )}
        <small>
          {maxInputs
            ? t(
                '当前每批最多 {0} 个输入；可跨页选择更多，超出后自动分批合并到 1 个。',
                [maxInputs],
              )
            : t('读取合并输入上限中\u2026')}
        </small>
        {limitError && <p className="micro text-danger">{t(limitError)}</p>}
        <Button
          variant="primary"
          disabled={!canMerge || selection.length < 2}
          onClick={() => prepare(false)}
        >
          <GitMerge size={16} />
          {preparation === 'selected'
            ? t('正在准备所选合并\u2026')
            : t('预览合并所选 {0} 个', [selection.length])}
        </Button>
        <Button
          disabled={!canMerge || (data?.mergeableCount ?? 0) < 2}
          onClick={() => prepare(true)}
        >
          {preparation === 'automatic' && (
            <LoaderCircle size={16} className="animate-spin" />
          )}
          {preparation === 'automatic'
            ? t('正在准备自动合并\u2026')
            : t('自动合并全部可用凭证 \u2192 1 个')}
        </Button>
        {preparation && (
          <div
            role="status"
            aria-live="polite"
            className="panel micro text-mint"
          >
            <p>
              {preparePhase === 'initializing'
                ? t('正在加载本地证明文件\u2026')
                : preparePhase === 'proving'
                  ? t('正在生成本批合并证明\u2026')
                  : t('正在检查凭证、合并上限和手续费\u2026')}
              {t(' 已等待 ')}
              {prepareSeconds}
              {t(' 秒。')}
            </p>
            <p className="text-muted">
              {t('生成证明可能需要数分钟，完成后确认费用。')}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="micro text-danger">
            {t(error)}
          </p>
        )}
        <p className="micro text-muted">
          {t('仅合并开始时的可用凭证，确认费用后执行。')}
        </p>
      </div>
      <details className="notes-payment">
        <summary>
          {t('全局支付方式 \u00B7 ')}
          {payment.mode === 'private' ? t('隐私资产') : network.nativeSymbol}
        </summary>
        <PaymentModeControl
          nativeSymbol={network.nativeSymbol}
          disabled={busy || Boolean(activePlan)}
        />
      </details>
      {planPage && plan && (
        <PageView
          open
          onOpenChange={closePlan}
          title={t(labels[plan.state])}
          description={`${plan.symbol} · ${NETWORKS[plan.chainId].name}`}
        >
          <div className="intro compact-intro">
            <span className="hero-symbol">
              {plan.state === 'complete' ? (
                <Check size={28} />
              ) : (
                <GitMerge size={28} />
              )}
            </span>
            <h1>
              {plan.initialCount}
              {t(' 个凭证 \u2192 1 个')}
            </h1>
            <p>
              {plan.automatic
                ? t('自动分批合并，后续批次不会超过已确认预算。')
                : t('仅合并所选凭证。')}
            </p>
          </div>
          <div className="panel form-stack">
            {summaryRow(t('每批最多输入'), t('{0} 个 Notes', [plan.maxInputs]))}
            {summaryRow(
              t('进度'),
              t('{0} / {1} 批', [plan.completedBatches, plan.plannedBatches]),
            )}
            {summaryRow(
              t('参与总额'),
              `${formatUnits(plan.initialTotalRaw, plan.decimals)} ${plan.symbol}`,
            )}
            {summaryRow(
              t('当前批手续费'),
              `${formatUnits(plan.preview.fees.feeRaw, plan.preview.fees.feeDecimals)} ${plan.preview.fees.feeSymbol}`,
            )}
            {summaryRow(
              t('手续费总预算'),
              `${formatUnits(plan.feeBudgetRaw, plan.preview.fees.feeDecimals)} ${plan.preview.fees.feeSymbol}`,
            )}
            {summaryRow(
              t('最大原生 Gas 总预算'),
              `${formatUnits(plan.gasBudgetWei, 18)} ${NETWORKS[plan.chainId].nativeSymbol}`,
            )}
            {summaryRow(
              t('支付方式'),
              plan.preview.paymentMode === 'private'
                ? t('隐私资产支付 \u00B7 Relayer')
                : t('原生币 Gas'),
            )}
            {summaryRow(
              t('最终余额下限'),
              `${formatUnits(BigInt(plan.initialTotalRaw) - (plan.preview.fees.feePool.toLowerCase() === plan.poolAddress.toLowerCase() ? BigInt(plan.feeBudgetRaw) : 0n), plan.decimals)} ${plan.symbol}`,
            )}
            <p className="micro text-muted">
              {t(
                '费用按批次收取；不同币种手续费额外扣除。Gas 为费用上限，实际以链上执行为准。',
              )}
            </p>
            <div>
              <small>{t('合并输出到自己的隐私地址')}</small>
              <p className="mono break-all text-xs mt-2">
                {plan.privacyAddress}
              </p>
            </div>
          </div>
          {plan.message && (
            <p
              role="status"
              className={`panel micro ${plan.state === 'paused' ? 'text-amber' : 'text-muted'}`}
            >
              {t(plan.message)}
            </p>
          )}
          {busy && (
            <p role="status" className="micro text-mint">
              {t('正在处理当前批次，请勿重复提交\u2026')}
            </p>
          )}
          {error && (
            <p role="alert" className="micro text-danger">
              {t(error)}
            </p>
          )}
          {(plan.txHash || plan.txHashes.length > 0) && (
            <div className="panel form-stack">
              {[
                ...new Set([
                  ...plan.txHashes,
                  ...(plan.txHash ? [plan.txHash] : []),
                ]),
              ].map((hash, index) => (
                <a
                  key={hash}
                  className="explorer-link"
                  href={`${NETWORKS[plan.chainId].explorerUrl}/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('第 ')}
                  {index + 1}
                  {t(' 笔 \u00B7 ')}
                  {short(hash)}
                  <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          )}
          {!done(plan) && (
            <>
              {!running ? (
                <Button
                  variant="primary"
                  disabled={busy || (!plan.authorized && !plan.preview.id)}
                  onClick={start}
                >
                  {plan.operationId
                    ? t('查询已提交批次')
                    : plan.authorized
                      ? t('继续合并 / 查询当前批次')
                      : plan.automatic || plan.plannedBatches > 1
                        ? t('确认预算并分批合并到 1 个')
                        : t('确认合并所选凭证')}
                </Button>
              ) : (
                <Button onClick={() => setRunning(false)}>
                  {t('暂停后续批次')}
                </Button>
              )}
              <Button disabled={busy} onClick={stop}>
                {plan.operationId ? t('完成当前批次后停止') : t('取消合并计划')}
              </Button>
              <p className="micro text-muted">
                {t(
                  '关闭页面会暂停后续批次，已提交交易无法撤销。费用或余额变化时将暂停。',
                )}
              </p>
            </>
          )}
          <Button onClick={closePlan}>
            {done(plan) ? t('返回凭证列表') : t('返回并暂停')}
          </Button>
        </PageView>
      )}
    </section>
  );
}
