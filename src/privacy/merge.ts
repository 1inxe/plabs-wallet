import { parseUnits } from 'ethers';
import type { ChainId, PrivacyFeeQuote, PrivacyMergeInventory, PrivacyMergePlan, PrivacyMergePreview, PrivacyNoteSummary, PrivacyPaymentMode } from '../shared/types';

const STORAGE_KEY = 'privacyMergePlans';
const terminal = (plan: PrivacyMergePlan) => plan.state === 'complete' || plan.state === 'cancelled';
const available = (note: PrivacyNoteSummary) => note.confirmed && !note.spent && BigInt(note.valueRaw) > 0n;
interface Dependencies {
  authorization(): string;
  context(chainId: ChainId, pool: string): Promise<{ walletAddress: string; privacyAddress: string; symbol: string; decimals: number }>;
  mode(): Promise<PrivacyPaymentMode>;
  inventory(chainId: ChainId, pool: string, mode: PrivacyPaymentMode, statusOnly?: boolean, batchSize?: number): Promise<PrivacyMergeInventory>;
  quote(chainId: ChainId, pool: string, feePool?: string): Promise<PrivacyFeeQuote>;
  prepare(plan: PrivacyMergePlan, notes: PrivacyNoteSummary[]): Promise<PrivacyMergePreview>;
  hasPrepared(id: string): boolean;
  submit(id: string, planId: string): Promise<{ state: string; txHash?: string; id?: string }>;
  result(id: string): Promise<{ state: string; txHash?: string; message?: string }>;
  sync(chainId: ChainId): Promise<void>;
}
export function createPrivacyMergeService(deps: Dependencies) {
  let queue = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>) => {
    const result = queue.then(work, work);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const all = async (): Promise<PrivacyMergePlan[]> => (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY] ?? [];
  const save = async (plan: PrivacyMergePlan) => {
    const others = (await all()).filter(item => item.id !== plan.id);
    await chrome.storage.session.set({ [STORAGE_KEY]: [...others.filter(item => !terminal(item)), ...others.filter(terminal).slice(-9), plan] });
  };
  const authorizationView = (plan: PrivacyMergePlan) => {
    if (plan.authorized && plan.authorizationId !== deps.authorization()) {
      plan.authorized = false;
      if (!plan.operationId) plan.state = 'review';
      plan.message = '会话已变化，下一批发送前需要重新确认剩余预算';
    }
    return plan;
  };
  const activeFor = async (walletAddress: string, chainId: ChainId) => {
    const plan = (await all()).find(item => item.walletAddress === walletAddress && item.chainId === chainId && !terminal(item));
    return plan ? authorizationView(plan) : undefined;
  };
  const owned = async (id: string) => {
    const plan = (await all()).find(item => item.id === id);
    if (!plan) throw new Error('合并计划已失效，请重新选择 Notes');
    const context = await deps.context(plan.chainId, plan.poolAddress);
    if (context.walletAddress !== plan.walletAddress || context.privacyAddress !== plan.privacyAddress) throw new Error('合并计划不属于当前隐私账户');
    return authorizationView(plan);
  };
  const pick = (plan: PrivacyMergePlan, inventory: PrivacyMergeInventory) => {
    const target = new Set(plan.targetIds);
    const notes = inventory.notes.filter(note => target.has(note.id));
    if (notes.length !== target.size || notes.some(note => note.spent)) throw new Error('计划中的 Note 已被其他操作花费或不可见，请停止后重新规划');
    if (notes.some(note => !note.confirmed)) throw new Error('正在等待合并输出 Confirmed，暂不可进行下一批');
    return notes.filter(available).sort((a, b) => BigInt(a.valueRaw) > BigInt(b.valueRaw) ? -1 : 1).slice(0, plan.maxInputs);
  };
  const prepareBatch = async (plan: PrivacyMergePlan) => {
    if (await deps.mode() !== plan.preview.paymentMode) throw new Error('全局支付方式已变化，请恢复原方式继续，或停止后重新规划');
    const inventory = await deps.inventory(plan.chainId, plan.poolAddress, plan.preview.paymentMode, false, plan.maxInputs);
    if (inventory.maxInputs < plan.maxInputs) throw new Error('单笔输入上限已下降，请停止后重新规划费用');
    const notes = pick(plan, inventory);
    if (notes.length < 2) throw new Error('合并需要至少两个可用 Notes');
    const preview = await deps.prepare(plan, notes);
    if (preview.fees.feePool.toLowerCase() !== plan.preview.fees.feePool.toLowerCase() || preview.paymentMode !== plan.preview.paymentMode) throw new Error('手续费币种或支付方式变化，需要重新确认');
    if (BigInt(preview.fees.feeRaw) > BigInt(plan.preview.fees.feeRaw)) throw new Error('单笔手续费上涨，请停止后重新确认预算');
    if (BigInt(plan.feesCommittedRaw) + BigInt(preview.fees.feeRaw) > BigInt(plan.feeBudgetRaw) || BigInt(plan.gasCommittedWei) + BigInt(preview.maxGasWei) > BigInt(plan.gasBudgetWei)) throw new Error('下一批费用超过已确认总预算，请停止后重新规划');
    plan.preview = preview; plan.selectedIds = notes.map(note => note.id); plan.state = 'ready'; plan.message = undefined;
    await save(plan);
  };
  return {
    activeFor,
    get: owned,
    create: (input: { chainId: ChainId; poolAddress: string; automatic: boolean; noteIds: string[]; feePool?: string }) => exclusive(async () => {
      const context = await deps.context(input.chainId, input.poolAddress);
      if (await activeFor(context.walletAddress, input.chainId)) throw new Error('此网络已有合并计划，请先继续或停止该计划');
      const mode = await deps.mode();
      const inventory = await deps.inventory(input.chainId, input.poolAddress, mode);
      const ids = new Set(input.noteIds);
      const notes = inventory.notes.filter(note => available(note) && (input.automatic || ids.has(note.id)));
      if (!input.automatic && (ids.size !== input.noteIds.length || notes.length !== ids.size)) throw new Error('所选 Notes 已变化，请刷新列表');
      if (notes.length < 2) throw new Error('至少需要两个已确认、未花费的正余额 Notes');
      const fees = await deps.quote(input.chainId, input.poolAddress, input.feePool);
      const batches = Math.ceil((notes.length - 1) / (inventory.maxInputs - 1));
      const total = notes.reduce((sum, note) => sum + BigInt(note.valueRaw), 0n);
      const feeBudget = BigInt(fees.feeRaw) * BigInt(batches);
      if (fees.feePool.toLowerCase() === input.poolAddress.toLowerCase() && total <= feeBudget) throw new Error('Notes 总额不足以覆盖全部合并手续费');
      const plan: PrivacyMergePlan = {
        ...context, id: crypto.randomUUID(), chainId: input.chainId, poolAddress: input.poolAddress,
        automatic: input.automatic, targetIds: notes.map(note => note.id), initialCount: notes.length,
        initialTotalRaw: total.toString(), maxInputs: inventory.maxInputs, plannedBatches: batches,
        completedBatches: 0, feeBudgetRaw: feeBudget.toString(), gasBudgetWei: '0', feesCommittedRaw: '0', gasCommittedWei: '0',
        // Only the fee choice is consumed by the first prepare call.
        preview: { fees, paymentMode: mode } as PrivacyMergePreview,
        selectedIds: [], txHashes: [], authorized: false, state: 'preparing', createdAt: Date.now(),
      };
      await save(plan);
      try {
        const selected = pick(plan, inventory);
        plan.preview = await deps.prepare(plan, selected);
        plan.feeBudgetRaw = (BigInt(plan.preview.fees.feeRaw) * BigInt(batches)).toString();
        plan.gasBudgetWei = (BigInt(plan.preview.maxGasWei) * BigInt(batches)).toString();
        if (plan.preview.fees.feePool.toLowerCase() === plan.poolAddress.toLowerCase() && total <= BigInt(plan.feeBudgetRaw)) throw new Error('全部合并费用超过 Notes 总余额');
        if (mode === 'private' && plan.preview.fees.feePool.toLowerCase() !== plan.poolAddress.toLowerCase()) {
          const feeInventory = await deps.inventory(plan.chainId, plan.preview.fees.feePool, mode, true);
          const feeBalance = feeInventory.notes.filter(available).reduce((sum, note) => sum + BigInt(note.valueRaw), 0n);
          if (feeBalance < BigInt(plan.feeBudgetRaw)) throw new Error('手续费资产余额不足以覆盖全部批次，请减少合并范围');
        }
        plan.selectedIds = selected.map(note => note.id); plan.state = 'review';
        await save(plan); return plan;
      } catch (error) { plan.state = 'cancelled'; await save(plan); throw error; }
    }),
    cancel: (id: string) => exclusive(async () => {
      const plan = await owned(id);
      if (terminal(plan)) return plan;
      if (plan.operationId) {
        const result = await deps.result(plan.operationId);
        if (result.state === 'failed' || result.state === 'not-submitted') { plan.operationId = undefined; plan.state = 'cancelled'; plan.message = '已停止合并'; await save(plan); return plan; }
        plan.cancelRequested = true; plan.message = '已停止后续批次，当前已提交交易仍会完成';
      } else { plan.state = 'cancelled'; plan.message = '合并已停止，已完成的交易不会撤销'; }
      await save(plan); return plan;
    }),
    advance: (id: string, confirm: boolean) => exclusive(async () => {
      const plan = await owned(id);
      if (terminal(plan)) return plan;
      if (!plan.authorized && !plan.operationId) {
        if (!confirm || plan.state !== 'review') throw new Error('请先确认合并范围和总费用预算');
        plan.authorized = true; plan.authorizationId = deps.authorization(); plan.state = 'ready'; await save(plan);
      }
      try {
        if (plan.operationId) {
          const result = await deps.result(plan.operationId);
          if (result.state === 'not-submitted') {
            plan.operationId = undefined;
            plan.feesCommittedRaw = (BigInt(plan.feesCommittedRaw) - BigInt(plan.preview.fees.feeRaw)).toString();
            plan.gasCommittedWei = (BigInt(plan.gasCommittedWei) - BigInt(plan.preview.maxGasWei)).toString();
            throw new Error('上次未广播。可继续重新准备当前批次，或停止计划');
          }
          if (result.state === 'failed') throw new Error(result.message ?? '合并交易失败，请停止后重新规划');
          if (result.state !== 'confirmed' || !result.txHash) {
            plan.state = 'waiting'; plan.message = result.message ?? '等待当前合并交易确认，请勿重复提交';
            if (result.txHash) plan.txHash = result.txHash;
            await save(plan); return plan;
          }
          plan.txHash = result.txHash; plan.state = 'syncing'; await save(plan);
          await deps.sync(plan.chainId);
          const inventory = await deps.inventory(plan.chainId, plan.poolAddress, plan.preview.paymentMode, true);
          const outputs = inventory.notes.filter(note => note.txHash.toLowerCase() === result.txHash!.toLowerCase() && !note.spent && BigInt(note.valueRaw) > 0n);
          if (outputs.length === 0 || outputs.some(note => !note.confirmed)) {
            plan.message = '交易已上链，等待新 Note 的 Confirmed 检查点后继续'; await save(plan); return plan;
          }
          if (outputs.length !== 1) throw new Error('当前批次未产生唯一正余额输出，已暂停自动合并');
          if (BigInt(outputs[0].valueRaw) !== parseUnits(plan.preview.amount, plan.decimals)) throw new Error('合并输出金额与已确认预览不一致，已暂停');
          const consumed = new Set(plan.selectedIds);
          plan.targetIds = [...plan.targetIds.filter(noteId => !consumed.has(noteId)), outputs[0].id];
          plan.completedBatches++; plan.txHashes.push(result.txHash);
          plan.operationId = undefined; plan.txHash = undefined;
          if (plan.cancelRequested) { plan.state = 'cancelled'; plan.message = '已完成当前批次，后续合并已停止'; }
          else if (plan.targetIds.length === 1) { plan.state = 'complete'; plan.message = '已合并为一个已确认的正余额 Note'; }
          else { plan.state = plan.authorized ? 'preparing' : 'review'; plan.message = plan.authorized ? '上一批已确认，可以继续合并' : '上一批已核对，请重新确认剩余合并预算'; }
          await save(plan); return plan;
        }
        if (plan.cancelRequested) { plan.state = 'cancelled'; await save(plan); return plan; }
        if (plan.state !== 'ready' || !deps.hasPrepared(plan.preview.id)) await prepareBatch(plan);
        if (!plan.authorized || plan.authorizationId !== deps.authorization()) throw new Error('合并授权已失效，请重新确认');
        // Reserve the exact reviewed batch before any broadcast. Unknown outcomes
        // retain this operation id; retries only query status and never resubmit it.
        plan.operationId = plan.preview.id; plan.state = 'submitting';
        plan.feesCommittedRaw = (BigInt(plan.feesCommittedRaw) + BigInt(plan.preview.fees.feeRaw)).toString();
        plan.gasCommittedWei = (BigInt(plan.gasCommittedWei) + BigInt(plan.preview.maxGasWei)).toString();
        await save(plan);
        if (plan.authorizationId !== deps.authorization()) throw new Error('合并会话已变化，本批未提交');
        const result = await deps.submit(plan.preview.id, plan.id);
        plan.state = 'waiting'; plan.txHash = result.txHash; plan.message = '当前批次已提交，等待确认';
        await save(plan); return plan;
      } catch (cause) {
        plan.state = 'paused'; plan.message = cause instanceof Error ? cause.message : String(cause);
        await save(plan); return plan;
      }
    }),
  };
}
