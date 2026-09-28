import { hexlify } from 'ethers';
import { encodePrivacyCall } from '../operations';
import { NOTE_ADDED_TOPIC } from '../events';
import type { PrivacyOwnedNote } from '../../shared/types';
import {
  amounts,
  DEX,
  dexIndexer,
  encryptMaterial,
  hex,
  integer,
  object,
  parseIntent,
  payoutDiversifier,
  raw,
  reverse,
  serialize,
  validateMarket,
  vnoteMemo,
  type JsonRecord,
} from './protocol';
import { publicOrder, type DexJournal, type DexRecord, type Funding } from './journal';

export interface DexPorts {
  guard(): void;
  load(): Promise<DexJournal>;
  save(journal: DexJournal): Promise<void>;
  prove(method: string, body: JsonRecord): Promise<JsonRecord>;
  http(url: string, body?: unknown, allow404?: boolean): Promise<unknown>;
  view(pool: string, method: string, args?: unknown[]): Promise<unknown>;
  rpc(method: string, args: unknown[]): Promise<unknown>;
  notes(pool: string): Promise<PrivacyOwnedNote[]>;
  paths(pool: string, notes: PrivacyOwnedNote[]): Promise<JsonRecord[]>;
  collectPayouts(record: DexRecord, seed: string): Promise<JsonRecord | null>;
}
export function reservedInputs(journal: DexJournal, pool: string) {
  return new Set(
    journal.records
      .filter((r) => !['discarded', 'recovered'].includes(r.state))
      .flatMap((r) =>
        r.funding
          .filter((f) => f.pool.toLowerCase() === pool.toLowerCase())
          .flatMap((f) => f.inputs),
      ),
  );
}
export function chooseNotes(
  notes: PrivacyOwnedNote[],
  amount: bigint,
  maxActions: number,
  outputs: number,
  delegation: number,
) {
  const limit = Math.min(32, maxActions - 1 - delegation - Math.max(0, outputs - 1));
  const seen = new Set<string>();
  const available = notes
    .filter((n) => {
      const cmx = raw(n.cmxHex, 32);
      if (!n.confirmed || n.spent || BigInt(n.valueSats) <= 0n || seen.has(cmx)) return false;
      seen.add(cmx);
      return true;
    })
    .sort((a, b) => (BigInt(a.valueSats) > BigInt(b.valueSats) ? -1 : 1));
  const selected: PrivacyOwnedNote[] = [];
  let total = 0n;
  for (const note of available.slice(0, Math.max(0, limit))) {
    if (total >= amount) break;
    selected.push(note);
    total += BigInt(note.valueSats);
  }
  if (total < amount)
    throw new Error('隐私可花费余额不足，或 Notes 过于零碎；请在钱包同步资产或合并 Notes 后重试');
  return selected;
}
const noteOpening = (
  value: unknown,
  expectedCmx: string,
  expectedValue: bigint,
  address: string,
) => {
  const n = object(serialize(value));
  if (
    hex(n.cmx_hex) !== hex(expectedCmx) ||
    integer(n.value_sats) !== expectedValue ||
    raw(n.recipient_raw_address_hex, 43) !== raw(address, 43)
  )
    throw new Error('资金证明的收款地址、金额或承诺不一致');
  for (const key of ['rho_hex', 'rcm_hex', 'psi_hex']) raw(n[key], 32);
  return n;
};
function funding(
  proof: JsonRecord,
  pool: string,
  notes: PrivacyOwnedNote[],
  commitments: string[],
): Funding {
  const bundle = object(serialize(proof.bundle));
  encodePrivacyCall(bundle);
  const actions = bundle.actions as JsonRecord[];
  const cmxs = actions.map((a) =>
    typeof a.cmx === 'string' ? hex(a.cmx) : hexlify(Uint8Array.from(a.cmx as number[])),
  );
  if (commitments.some((c) => !cmxs.includes(hex(c)))) throw new Error('资金证明缺少预期承诺');
  return {
    pool,
    bundle,
    commitments: commitments.map((c) => hex(c)),
    inputs: notes.map((n) => raw(n.cmxHex, 32)),
    state: 'prepared',
  };
}
export class DexEngine {
  constructor(private p: DexPorts, private confirmation = {
    attempts: 25,
    intervalMs: 2500,
    timeoutMs: 90_000,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }) {}
  private async save(journal: DexJournal) {
    this.p.guard();
    await this.p.save(journal);
    this.p.guard();
  }
  private async health(intent?: Parameters<typeof amounts>[0]) {
    return validateMarket(await this.p.http(`${DEX.matcher}/healthz`), intent);
  }
  private async identity() {
    if (
      Number(BigInt(String(await this.p.rpc('eth_chainId', [])))) !== DEX.chainId ||
      object(await this.p.rpc('eth_getBlockByNumber', ['0x0', false])).hash !== DEX.genesis
    )
      throw new Error('PEX RPC 网络身份不符');
  }
  async prepare(value: unknown, origin: string, seed: string) {
    const intent = parseIntent(value),
      a = amounts(intent),
      journal = await this.p.load();
    if (journal.records.filter((r) => !['recovered', 'discarded'].includes(r.state)).length >= 64)
      throw new Error('请先处理未完成的 PEX 订单');
    await this.identity();
    const market = await this.health(intent);
    const fee = integer(String(await this.p.view(DEX.settlement, 'feeAmount')), true);
    if (
      String(await this.p.view(DEX.settlement, 'feeAssetPool')).toLowerCase() !== DEX.quote ||
      fee !== market.fee
    )
      throw new Error('链上 PEX 费用与官网配置不符');
    const relayer = object(await this.p.http(`${DEX.relayer}/healthz`)),
      gas = object(relayer.gas_policy);
    if (
      relayer.ok !== true ||
      gas.chain_id !== 143 ||
      gas.schema !== 'perc20-relayer-gas-policy/v1'
    )
      throw new Error('PEX Relayer 不可用');
    const gasCap = integer(gas.transfer_cap, true),
      margin = integer(gas.margin_bps);
    const safeActions = Number(((gasCap * 10000n) / (10000n + margin) - 2035000n) / 537000n);
    const budget = async (pool: string) =>
      Math.min(Number(await this.p.view(pool, 'maxActions')), safeActions);
    const sameFee = a.payPool === DEX.quote,
      principalBudget = await budget(a.payPool),
      feeBudget = sameFee ? principalBudget : await budget(DEX.quote);
    const available = async (pool: string) => {
      const reserved = reservedInputs(journal, pool);
      return (await this.p.notes(pool)).filter((n) => !reserved.has(raw(n.cmxHex, 32)));
    };
    const selected = chooseNotes(
      await available(a.payPool),
      a.principal + (sameFee ? fee : 0n),
      principalBudget,
      sameFee ? 2 : 1,
      1,
    );
    const selectedFee = sameFee
      ? []
      : chooseNotes(await available(DEX.quote), fee, feeBudget, 1, 0);
    if (journal.nextAccount >= 0x7fffffff) throw new Error('PEX 恢复账户索引已耗尽');
    const account = journal.nextAccount++;
    await this.save(journal);
    const keys = await this.p.prove('keys', {
      seed_hex: seed,
      account_id: account,
      bip44_coin_type: 60,
    });
    const main = await this.p.prove('keys', { seed_hex: seed, account_id: 0, bip44_coin_type: 60 });
    const child = raw(keys.raw_address_hex, 43);
    if (child === raw(main.raw_address_hex, 43)) throw new Error('不能委托主隐私账户');
    for (const k of ['bn254_ivk_hex', 'nk_hex', 'rivk_hex', 'ak_x_hex', 'ak_y_hex'])
      raw(keys[k], 32);
    const nullifiers = await this.p.prove('compute_nullifiers', {
      nk_hex: main.nk_hex,
      notes: [selected[0].ownedNote],
    });
    const firstNf = raw((nullifiers.nullifiers as unknown[])?.[0], 32);
    const payout = await this.p.prove('keys', {
      seed_hex: seed,
      account_id: 0,
      bip44_coin_type: 60,
      diversifier_index_hex: payoutDiversifier(String(main.nk_hex), firstNf),
    });
    const payoutAddress = raw(payout.raw_address_hex, 43);
    const terms = {
      want_asset: a.wantPool,
      price_num: String(a.numerator),
      price_den: String(a.denominator),
      max_want: String(a.maxWant),
    };
    const encoded = await this.p.prove('vnote_encode', {
      want_asset_hex: a.wantPool,
      price_num: terms.price_num,
      price_den: terms.price_den,
      payout_address_raw_hex: payoutAddress,
      max_want: terms.max_want,
      fee_paid: 0,
      want_recv: 0,
    });
    const psi = hex(encoded.psi_hex),
      payoutCommit = hex(encoded.payout_commit_hex);
    const paths = await this.p.paths(a.payPool, selected);
    const output = {
      value_sats: Number(a.principal),
      recipient_raw_address_hex: child,
      psi_new_hex: psi,
      memo_hex: vnoteMemo(a.wantPool, a.numerator, a.denominator, payoutCommit, a.maxWant, account),
    };
    const principalProof = await this.p.prove('prove_note', {
      seed_hex: seed,
      bip44_coin_type: 60,
      spend_notes: selected.map((n) => n.ownedNote),
      anchor_hex: paths[0].anchor_hex,
      merkle_path_overrides: paths,
      chain_id: 143,
      pool_address: a.payPool,
      max_actions: principalBudget,
      ...(sameFee
        ? {
            transfer_outputs: [
              output,
              { value_sats: Number(fee), recipient_raw_address_hex: child },
            ],
          }
        : { transfer_output: output }),
      delivery: {
        recipient_raw_address_hex: DEX.verifyAddress,
        view_delegation: {
          account_s_index: account,
          initial_amount_sats: Number(a.principal),
          funding_output_indices: [0],
        },
      },
    });
    const cmxs = principalProof.funding_cmx_hex as string[];
    if (cmxs?.length !== (sameFee ? 2 : 1)) throw new Error('PEX 证明缺少资金承诺');
    const principalNote = noteOpening(
      (principalProof.funding_notes as unknown[])?.[0],
      cmxs[0],
      a.principal,
      child,
    );
    if (raw(principalNote.rho_hex, 32) !== firstNf || reverse(principalNote.psi_hex) !== psi)
      throw new Error('PEX 本金开口与支付承诺不符');
    const principalFunding = funding(principalProof, a.payPool, selected, [
      ...cmxs,
      hex(principalProof.delegation_cmx_hex),
    ]);
    let feeNote: JsonRecord;
    const submissions: Funding[] = [];
    if (sameFee)
      feeNote = noteOpening((principalProof.funding_notes as unknown[])?.[1], cmxs[1], fee, child);
    else {
      const feePaths = await this.p.paths(DEX.quote, selectedFee);
      const feeProof = await this.p.prove('prove_note', {
        seed_hex: seed,
        bip44_coin_type: 60,
        spend_notes: selectedFee.map((n) => n.ownedNote),
        anchor_hex: feePaths[0].anchor_hex,
        merkle_path_overrides: feePaths,
        chain_id: 143,
        pool_address: DEX.quote,
        max_actions: feeBudget,
        transfer_output: {
          value_sats: Number(fee),
          recipient_raw_address_hex: child,
          memo_hex: `0x5058464501${account.toString(16).padStart(8, '0')}`,
        },
      });
      const feeCmxs = feeProof.funding_cmx_hex as string[];
      if (feeCmxs?.length !== 1) throw new Error('手续费证明缺少承诺');
      feeNote = noteOpening((feeProof.funding_notes as unknown[])?.[0], feeCmxs[0], fee, child);
      submissions.push(funding(feeProof, DEX.quote, selectedFee, feeCmxs));
    }
    submissions.push(principalFunding);
    const wireNote = (n: JsonRecord) => ({
      cmx_hex: hex(n.cmx_hex),
      value: String(n.value_sats),
      rho_hex: reverse(n.rho_hex),
      rcm_hex: reverse(n.rcm_hex),
      psi_hex: reverse(n.psi_hex),
      address_raw_hex: child,
    });
    const material = {
      terms: { ...terms, payout_commit: payoutCommit },
      c0: { ...wireNote(principalNote), psi_hex: psi },
      fee_ticket: { ...wireNote(feeNote), pool: DEX.quote },
      account_s: {
        view_account_index: account,
        ivk_hex: reverse(keys.bn254_ivk_hex),
        nk_hex: reverse(keys.nk_hex),
        rivk_hex: reverse(keys.rivk_hex),
        ak_x_hex: keys.ak_x_hex,
        ak_y_hex: keys.ak_y_hex,
      },
      payout_address_raw_hex: payoutAddress,
      pay_pool: a.payPool,
      chain_id: 143,
      side: intent.side,
      qty: Number(intent.quantityRaw),
      book_price_ticks: Number(intent.priceTicks),
      order_type: intent.type,
    };
    await this.preflight(material, market.key);
    const record: DexRecord = {
      id: crypto.randomUUID(),
      origin,
      account,
      createdAt: Date.now(),
      intent,
      epoch: market.epoch,
      state: 'prepared',
      material,
      principalNote,
      feeNote,
      funding: submissions,
    };
    journal.records.push(record);
    await this.save(journal);
    return {
      ...publicOrder(record),
      principalRaw: String(a.principal),
      feeRaw: String(fee),
      payPool: a.payPool,
      feePool: DEX.quote,
    };
  }
  private async preflight(material: JsonRecord, key: JsonRecord) {
    const encrypted = await encryptMaterial(material, key);
    const response = object(await this.p.http(`${DEX.matcher}/vnote/preflight`, { encrypted }));
    if (response.ready !== true || response.protocol_version !== 5 || response.terms_version !== 2)
      throw new Error('官网下单预检未通过，未提交资金');
    return encrypted;
  }
  private find(journal: DexJournal, id: string, origin: string) {
    const r = journal.records.find((r) => r.id === id);
    if (!r || r.origin !== origin) throw new Error('订单不属于当前网站或隐私账户');
    return r;
  }
  async discard(id: string, origin: string) {
    const j = await this.p.load(),
      r = this.find(j, id, origin);
    if (
      ['prepared', 'funding'].includes(r.state) &&
      r.funding.every((f) => f.state === 'prepared')
    ) {
      r.state = 'discarded';
      r.funding = [];
      r.material = {};
      r.principalNote = {};
      r.feeNote = {};
      r.error = undefined;
      await this.save(j);
    }
  }
  async list() {
    return (await this.p.load()).records.filter((r) => r.state !== 'discarded').map(publicOrder);
  }
  async get(id: string, origin: string) {
    return publicOrder(this.find(await this.p.load(), id, origin));
  }
  /** A timeout never creates or broadcasts another funding proof. Only known commitments are reconciled. */
  async reconcile(f: Funding): Promise<boolean> {
    if (f.state === 'prepared') return false;
    f.stage = 'confirming';
    if (!f.txHash && f.requestId) {
      const state = object(
        await this.p.http(`${DEX.relayer}/tx/requests/${encodeURIComponent(f.requestId)}`),
      );
      if (state.request_id !== f.requestId) throw new Error('Relayer 请求 ID 不一致');
      if (state.tx_hash) f.txHash = hex(state.tx_hash);
      if (!f.txHash && ['failed', 'reverted', 'expired'].includes(String(state.status))) {
        f.stage = 'failed';
        throw new Error('资金提交已被 Relayer 终止；未继续提交本金或订单，请检查并恢复已确认的资金');
      }
    }
    // Inspect known receipts BEFORE looking for outputs: a reverted transaction never emits them.
    const receiptFor = async (tx: string) => {
      const receipt = await this.p.rpc('eth_getTransactionReceipt', [tx]);
      if (!receipt) return null;
      const r = object(receipt);
      if (hex(r.transactionHash) !== tx) throw new Error('资金回执交易不一致');
      const final = object(await this.p.rpc('eth_getBlockByNumber', ['finalized', false]));
      if (BigInt(String(r.blockNumber)) > BigInt(String(final.number))) return null;
      if (object(await this.p.rpc('eth_getBlockByNumber', [r.blockNumber, false])).hash !== r.blockHash) return null;
      if (r.status === '0x0') {
        f.stage = 'failed';
        throw new Error('资金交易已在链上回滚；未继续提交本金或订单，请检查并恢复已确认的资金');
      }
      if (r.status !== '0x1') throw new Error('资金回执状态无效');
      return r;
    };
    let receipt = f.txHash ? await receiptFor(f.txHash) : null;
    if (f.txHash && !receipt) return false;
    if (receipt) f.stage = 'indexing';
    for (const cmx of f.commitments) {
      if ((await this.p.view(f.pool, 'cmxExists', [cmx])) !== true) return false;
      const indexed = await this.p.http(
        `${dexIndexer(f.pool)}/note?${new URLSearchParams({ pool: f.pool, cmx })}`,
        undefined,
        true,
      );
      if (!indexed) return false;
      const n = object(indexed);
      const indexedCmx =
        typeof n.cmx === 'string'
          ? hex(n.cmx)
          : Array.isArray(n.cmx)
            ? hexlify(Uint8Array.from(n.cmx as number[]))
            : '';
      if (indexedCmx !== cmx) throw new Error('资金索引承诺不一致');
      const tx = hex(n.tx_hash);
      if (f.txHash && tx !== f.txHash) throw new Error('资金索引交易不一致');
      f.txHash = tx;
      receipt ??= await receiptFor(tx);
      if (!receipt) return false;
      if (
        !(receipt.logs as JsonRecord[]).some(
          (l) =>
            String(l.address).toLowerCase() === f.pool &&
            (l.topics as string[])?.[0]?.toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() &&
            (l.topics as string[])?.[1]?.toLowerCase() === cmx,
        )
      )
        throw new Error('资金承诺未出现在链上回执');
    }
    f.state = 'confirmed';
    return true;
  }
  private async sendFunding(j: DexJournal, f: Funding) {
    if (f.state === 'confirmed') return true;
    if (f.state === 'prepared') {
      this.p.guard();
      const wire = (v: unknown) =>
        typeof v === 'string' ? hex(v) : hexlify(Uint8Array.from(v as number[]));
      if (!Array.isArray(f.bundle.actions)) throw new Error('已保存资金证明无效');
      for (const action of (f.bundle.actions as unknown[]).map(object)) {
        const anchor = wire((action.pub_fields_bn254 as unknown[])[0]),
          nf = wire(action.nullifier);
        if (
          BigInt(anchor) !== 0n &&
          (await this.p.view(f.pool, 'isValidAnchor', [anchor])) !== true
        )
          throw new Error('原证明锚点已失效，请取消并恢复已锁定资金后重新下单');
        if (BigInt(nf) !== 0n && (await this.p.view(f.pool, 'isSpent', [nf])) !== false)
          throw new Error('原证明输入已经被花费，请检查资金记录');
      }
      // Commit unknown BEFORE crossing the network boundary, including HTTP errors/worker termination.
      f.state = 'unknown';
      await this.save(j);
      const result = object(
        await this.p.http(`${DEX.relayer}/dex/transfer/submit`, {
          contract: f.pool,
          bundle: f.bundle,
        }),
      );
      if (result.tx_hash) f.txHash = hex(result.tx_hash);
      if (result.request_id) {
        if (
          typeof result.request_id !== 'string' ||
          !/^txreq_[0-9a-f]{64}$/.test(result.request_id)
        )
          throw new Error('Relayer 请求标识无效');
        f.requestId = result.request_id;
      }
      await this.save(j);
    }
    const deadline = Date.now() + this.confirmation.timeoutMs;
    for (let attempt = 0; attempt < this.confirmation.attempts; attempt++) {
      this.p.guard();
      const confirmed = await this.reconcile(f);
      await this.save(j);
      if (confirmed) return true;
      if (attempt + 1 >= this.confirmation.attempts || Date.now() >= deadline) break;
      await this.confirmation.sleep(Math.min(this.confirmation.intervalMs, deadline - Date.now()));
    }
    return false;
  }
  async submit(id: string, origin: string) {
    const j = await this.p.load(),
      r = this.find(j, id, origin);
    if (['discarded', 'recovered', 'canceling', 'recovering'].includes(r.state))
      throw new Error('订单已经取消或处于资金恢复流程');
    if (r.state === 'open') return publicOrder(r);
    if (r.cancelConfirmed) throw new Error('原订单未挂出或已取消，请恢复资金后重新下单');
    try {
      await this.identity();
      const h = await this.health(r.intent);
      if (h.epoch !== r.epoch) throw new Error('官网 Matcher 轮次已变化，请取消并恢复原订单资金');
      if (r.state === 'prepared' && Date.now() - r.createdAt > 10 * 60_000)
        throw new Error('订单确认已过期，请取消后重新报价');
      await this.preflight(r.material, h.key);
      const fee = await this.p.view(DEX.settlement, 'feeAmount');
      if (
        String(fee) !== String(object(r.material.fee_ticket).value) ||
        String(await this.p.view(DEX.settlement, 'feeAssetPool')).toLowerCase() !== DEX.quote
      )
        throw new Error('链上手续费已变化，请恢复资金后重新报价');
      if (!r.submissionAttempted) r.state = 'funding';
      r.error = undefined;
      await this.save(j);
      for (const f of r.funding) {
        if (!(await this.sendFunding(j, f))) {
          r.error = '确认等待已超时，订单尚未提交撮合。继续原订单会核对已广播的资金，不会重复锁定资金。';
          await this.save(j);
          return publicOrder(r);
        }
      }
      // Confirmation may take time; revalidate the matcher epoch and encryption key before submission.
      const current = await this.health(r.intent);
      if (current.epoch !== r.epoch) throw new Error('官网 Matcher 轮次已变化，请取消并恢复原订单资金');
      const encrypted = await this.preflight(r.material, current.key);
      r.state = 'submitting';
      r.submissionAttempted = true;
      r.error = undefined;
      await this.save(j);
      this.p.guard();
      const result = object(await this.p.http(`${DEX.matcher}/vnote/submit`, { encrypted }));
      const plans = Array.isArray(result.plans) ? result.plans : [];
      const orderId = result.order_id ?? (plans[0] && object(plans[0]).taker_order);
      if (
        result.order_id === null &&
        Array.isArray(result.plans) &&
        result.plans.length === 0 &&
        result.match_capability == null
      ) {
        r.state = 'funded';
        r.cancelConfirmed = true;
        r.error = '官网未匹配或挂出订单；请选择取消并恢复资金';
        await this.save(j);
        return publicOrder(r);
      }
      if (
        typeof orderId !== 'string' ||
        !/^(0x)?[0-9a-f]{32}$/i.test(orderId) ||
        typeof result.match_capability !== 'string' ||
        !result.match_capability ||
        result.match_capability.length > 4096
      )
        throw new Error('官网未返回可恢复的订单标识；保留资金记录，继续检查原订单');
      r.orderId = orderId.replace(/^0x/, '');
      r.capability = result.match_capability;
      r.state = 'open';
      await this.save(j);
      return publicOrder(r);
    } catch (e) {
      r.error = e instanceof Error ? e.message : 'PEX 提交失败';
      await this.save(j);
      return publicOrder(r);
    }
  }
  async refreshPayouts(id: string, origin: string, seed: string) {
    const j = await this.p.load(),
      r = this.find(j, id, origin);
    await this.p.collectPayouts(r, seed);
    return publicOrder(r);
  }
  async cancel(id: string, origin: string, seed: string) {
    const j = await this.p.load(),
      r = this.find(j, id, origin);
    if (r.state === 'recovered') return publicOrder(r);
    if (r.funding.every((f) => f.state === 'prepared')) {
      await this.discard(id, origin);
      return this.get(id, origin);
    }
    try {
      await this.identity();
      const h = await this.health();
      // An unknown submit must be resolved idempotently first to obtain its cancellation capability.
      if ((r.submissionAttempted || r.state === 'submitting') && !r.orderId && !r.cancelConfirmed)
        throw new Error('订单提交结果未知，请先继续检查，取得订单 ID 后再撤单');
      if (r.orderId && h.epoch !== r.epoch && !r.cancelConfirmed)
        throw new Error(
          'Matcher 轮次已变化，无法确认旧订单的在途成交；恢复记录已保留，暂不自动花费订单资金',
        );
      const idle = async () => {
        if (!r.orderId || h.epoch !== r.epoch) return;
        const result = object(
          await this.p.http(`${DEX.matcher}/orders/status`, { order_ids: [r.orderId] }),
        );
        const rows = result.orders;
        if (!Array.isArray(rows)) throw new Error('无法核对在途成交，暂不回收资金');
        const row = rows
          .map(object)
          .find((v) => String(v.order_id).replace(/^0x/, '') === r.orderId);
        if (!row || integer(row.pending_qty) > 0n)
          throw new Error('订单存在在途成交或状态未知，等待结算后再恢复资金');
        if (!r.capability) throw new Error('缺少成交状态查询凭证');
        const matches = object(
          await this.p.http(`${DEX.matcher}/matches`, {
            subscriptions: [{ capability: r.capability.replace(/^0x/, ''), after: 0 }],
          }),
        );
        if (
          !Array.isArray(matches.matches) ||
          (matches.matches_epoch !== undefined && matches.matches_epoch !== h.epoch)
        )
          throw new Error('无法确认完整成交状态，暂不回收资金');
        if (
          matches.matches
            .map(object)
            .some((m) => !['completed', 'cancelled', 'expired'].includes(String(m.status)))
        )
          throw new Error('仍有在途成交，等待结算后再恢复资金');
      };
      await idle();
      if (r.orderId && h.epoch === r.epoch && !r.cancelConfirmed) {
        if (!r.capability) throw new Error('缺少该订单撤单凭证');
        r.state = 'canceling';
        await this.save(j);
        this.p.guard();
        const result = object(
          await this.p.http(`${DEX.matcher}/cancel`, {
            order_id: r.orderId,
            match_capability: r.capability,
          }),
        );
        if (typeof result.canceled !== 'boolean') throw new Error('撤单响应无效，暂不回收资金');
        r.cancelConfirmed = true;
        await this.save(j);
      }
      await idle();
      r.state = 'recovering';
      await this.save(j);
      // First finish known recovery broadcasts. Never build a replacement for an uncertain transaction.
      for (const f of r.recovery ?? [])
        if (!(await this.sendFunding(j, f))) {
          r.error = '恢复交易待链上确认，请继续检查';
          await this.save(j);
          return publicOrder(r);
        }
      for (const f of r.funding)
        if (f.state === 'unknown' && !(await this.reconcile(f)))
          throw new Error('原资金交易结果仍未知，请等待确认后恢复；不会重复扣款');
      const principal = r.funding.some(
        (f) => f.pool === String(r.material.pay_pool) && f.state === 'confirmed',
      )
        ? await this.p.collectPayouts(r, seed)
        : null;
      const candidates = new Map<string, JsonRecord[]>();
      if (principal && integer(principal.value_sats) > 0n)
        candidates.set(String(r.material.pay_pool), [principal]);
      const childKeys = await this.p.prove('keys', {
        seed_hex: seed,
        account_id: r.account,
        bip44_coin_type: 60,
      });
      const feeNfs = await this.p.prove('compute_nullifiers', {
        nk_hex: childKeys.nk_hex,
        notes: [r.feeNote],
      });
      const feeSpent = await this.p.view(DEX.quote, 'isSpent', [
        reverse((feeNfs.nullifiers as unknown[])[0]),
      ]);
      if (
        r.funding.some((f) => f.pool === DEX.quote && f.state === 'confirmed') &&
        feeSpent === false
      )
        candidates.set(DEX.quote, [...(candidates.get(DEX.quote) ?? []), r.feeNote]);
      const main = await this.p.prove('keys', {
        seed_hex: seed,
        account_id: 0,
        bip44_coin_type: 60,
      });
      for (const [pool, owned] of candidates) {
        const nfs = (
          await this.p.prove('compute_nullifiers', { nk_hex: childKeys.nk_hex, notes: owned })
        ).nullifiers as string[];
        const notes = owned.map((n, i) => ({
          cmxHex: raw(n.cmx_hex, 32),
          valueSats: String(n.value_sats),
          ownedNote: n,
          nullifierHex: raw(nfs[i], 32),
          confirmed: true,
          spent: false,
          rawNote: {},
          cmxPosition: -1,
          blockNumber: 0,
          txHash: '',
        }));
        const paths = await this.p.paths(pool, notes),
          total = owned.reduce((sum, n) => sum + integer(n.value_sats), 0n);
        const proof = await this.p.prove('prove_note', {
          seed_hex: seed,
          account_id: r.account,
          bip44_coin_type: 60,
          spend_notes: owned,
          anchor_hex: paths[0].anchor_hex,
          merkle_path_overrides: paths,
          chain_id: 143,
          pool_address: pool,
          max_actions: Number(await this.p.view(pool, 'maxActions')),
          transfer_output: {
            value_sats: Number(total),
            recipient_raw_address_hex: raw(main.raw_address_hex, 43),
          },
        });
        const cmxs = proof.funding_cmx_hex as string[];
        if (cmxs?.length !== 1) throw new Error('恢复证明缺少主账户输出');
        noteOpening(
          (proof.funding_notes as unknown[])[0],
          cmxs[0],
          total,
          String(main.raw_address_hex),
        );
        const f = funding(proof, pool, notes, cmxs);
        (r.recovery ??= []).push(f);
        await this.save(j);
        if (!(await this.sendFunding(j, f))) {
          r.error = '恢复交易已提交，等待链上确认';
          await this.save(j);
          return publicOrder(r);
        }
      }
      // Recheck the escrow after all confirmations; a successful cancel alone is never called recovered.
      const remainder = r.funding.some(
        (f) => f.pool === String(r.material.pay_pool) && f.state === 'confirmed',
      )
        ? await this.p.collectPayouts(r, seed)
        : null;
      if (remainder && integer(remainder.value_sats) > 0n)
        throw new Error('仍有订单本金未恢复，请继续检查');
      if (
        r.funding.some((f) => f.pool === DEX.quote && f.state === 'confirmed') &&
        (await this.p.view(DEX.quote, 'isSpent', [
          reverse((feeNfs.nullifiers as unknown[])[0]),
        ])) !== true
      )
        throw new Error('仍有手续费凭证未恢复');
      r.state = 'recovered';
      r.error = undefined;
      await this.save(j);
      return publicOrder(r);
    } catch (e) {
      r.error = e instanceof Error ? e.message : '恢复失败';
      await this.save(j);
      return publicOrder(r);
    }
  }
}
