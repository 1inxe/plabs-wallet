import type { PrivacyOwnedNote } from '../../shared/types';
import { NOTE_ADDED_TOPIC } from '../events';
import { reverseHexByByte } from '../operations';
import { opaqueRequestId, recordRequest, type TransferJournal, type TransferRecord } from './journal';
import { assertFundingOpen, paymentMemo, campaignIntent, fundingEnvelope, object, raw, sameIntent, units, validateProfile, verifyPayment, requestDigest, type TransferResult, type Intent, type Json, type Profile, type PublicRequest } from './protocol';

export interface Ports {
  guard(): Promise<void>;
  load(): Promise<TransferJournal>;
  save(journal: TransferJournal): Promise<void>;
  api(path: string, body?: unknown): Promise<unknown>;
  prove(method: string, body: Json): Promise<Json>;
  notes(): Promise<PrivacyOwnedNote[]>;
  paths(notes: PrivacyOwnedNote[]): Promise<Json[]>;
  view(method: string, args?: unknown[]): Promise<unknown>;
  rpc(method: string, args: unknown[]): Promise<unknown>;
  frozen(): Promise<unknown[]>;
}
export class SponsoredTransferEngine {
  constructor(private p: Ports) {}
  private async save(journal: TransferJournal) { await this.p.guard(); await this.p.save(journal); await this.p.guard(); }
  private result(id: string, record: TransferRecord, message: string): TransferResult {
    return { id, intentId: record.intent.id, state: record.state, ...(record.jobId ? { jobId: record.jobId } : {}), ...(record.txHash ? { txHash: record.txHash } : {}), message };
  }
  private statusMessage(record: TransferRecord) {
    return record.state === 'confirmed' ? '支付已获链上及服务确认' : record.state === 'failed' ? '链上交易失败；恢复记录已保留' : '支付已保存，正在等待官方赞助交易及 12 个区块确认。可恢复同一支付查询进度';
  }
  private async current(expected: Profile, approved: Intent, request: PublicRequest) {
    await this.p.guard();
    const profile = validateProfile(await this.p.api('/config'), request);
    if (profile.rulesHash !== expected.rulesHash) throw new Error('支付规则已变化，请重新确认支付');
    const me = object(await this.p.api('/me'));
    const intent = campaignIntent(me, approved.id, profile);
    verifyPayment(request, intent, profile);
    if (!sameIntent(intent, approved)) throw new Error('支付意图与钱包确认内容不符');
    await this.p.guard();
    return { me, intent, profile };
  }
  private async settledReceipt(txHash: string, profile: Profile) {
    const receiptValue = await this.p.rpc('eth_getTransactionReceipt', [`0x${raw(txHash)}`]);
    if (!receiptValue) return null;
    const receipt = object(receiptValue);
    if (!['0x0', '0x1'].includes(String(receipt.status)) || String(receipt.to).toLowerCase() !== profile.pool || !Array.isArray(receipt.logs)) throw new Error('支付交易回执与指定隐私资产合约不符');
    const block = BigInt(String(receipt.blockNumber));
    const head = BigInt(String(await this.p.rpc('eth_blockNumber', [])));
    if (head - block + 1n < BigInt(profile.confirmations)) return null;
    const canonical = object(await this.p.rpc('eth_getBlockByNumber', [receipt.blockNumber, false]));
    if (canonical.hash !== receipt.blockHash) return null;
    return receipt;
  }
  private async confirmed(record: TransferRecord, profile: Profile) {
    if (!record.txHash) return false;
    const receipt = await this.settledReceipt(record.txHash, profile);
    if (!receipt) return false;
    if (receipt.status === '0x0') { record.state = 'failed'; return false; }
    for (const output of record.envelope.outputs) {
      if (!(receipt.logs as unknown[]).map(object).some(log => String(log.address).toLowerCase() === profile.pool && Array.isArray(log.topics) && String(log.topics[0]).toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() && String(log.topics[1]).toLowerCase() === output.cmx_hex)) throw new Error('支付交易缺少已批准的收款或找零输出');
    }
    if (await this.p.view('isSpent', [`0x${reverseHexByByte(record.inputNullifier)}`]) !== true) throw new Error('支付交易未花费预期输入');
    return true;
  }
  async fund(origin: string, approved: Intent, expected: Profile, seed: string, privacy: string, request: PublicRequest): Promise<TransferResult> {
    let { me, intent, profile } = await this.current(expected, approved, request);
    if (Number(BigInt(String(await this.p.rpc('eth_chainId', [])))) !== profile.chainId || object(await this.p.rpc('eth_getBlockByNumber', ['0x0', false])).hash !== profile.genesis) throw new Error('支付 RPC 网络身份不符');
    const journal = await this.p.load();
    const sameScope = (record: TransferRecord) => recordRequest(record).apiBase === request.apiBase && record.campaignId === request.campaignId;
    let record = journal.records.find(record => sameScope(record) && record.intent.id === intent.id);
    if (record && (record.origin !== origin || record.rulesHash !== profile.rulesHash || !sameIntent(record.intent, approved) || requestDigest(recordRequest(record)) !== requestDigest(request))) throw new Error('保存的支付请求与当前来源、金额、收款方或 memo 不符');
    if (record) { record.request = request; record.requestDigest = requestDigest(request); }
    const id = opaqueRequestId(journal, origin, request);
    // The web page can observe funding before the wallet is opened again. Reconcile all
    // older records before deciding whether another top-up may reserve a fresh input.
    for (const previous of journal.records.filter(r => sameScope(r) && r.rulesHash === profile.rulesHash && r.state === 'pending')) {
      const previousJob = (me.jobs as unknown[]).map(object).find(j => j.intentId === previous.intent.id && j.purpose === 'bid');
      if (typeof previousJob?.txHash === 'string') previous.txHash = `0x${raw(previousJob.txHash)}`;
      if (typeof previousJob?.id === 'string') previous.jobId = previousJob.id;
      const funded = (me.intents as unknown[]).map(object).some(i => i.id === previous.intent.id && i.status === 'funded');
      if (funded && await this.confirmed(previous, profile)) previous.state = 'confirmed';
    }
    await this.save(journal);
    let job = (me.jobs as unknown[]).map(object).find(j => j.intentId === intent.id && j.purpose === 'bid');
    // A known server job is already funded or submitted. Never build a second payment for it.
    if (!record && (job || intent.status === 'funded')) {
      const txHash = typeof job?.txHash === 'string' ? `0x${raw(job.txHash)}` : undefined;
      const receipt = txHash ? await this.settledReceipt(txHash, profile) : null;
      if (receipt?.status === '0x1' && job?.contributionCmx && !(receipt.logs as unknown[]).map(object).some(log => String(log.address).toLowerCase() === profile.pool && Array.isArray(log.topics) && String(log.topics[0]).toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() && String(log.topics[1]).toLowerCase() === `0x${raw(job!.contributionCmx)}`)) throw new Error('已有支付交易缺少活动收款输出');
      return { id, intentId: intent.id, state: receipt?.status === '0x1' && intent.status === 'funded' ? 'confirmed' : receipt?.status === '0x0' || (job?.status === 'reverted' && !txHash) ? 'failed' : 'pending', ...(typeof job?.id === 'string' ? { jobId: job.id } : {}), ...(txHash ? { txHash } : {}), message: '活动已有此支付记录；钱包核对链上确认，未创建另一笔付款' };
    }
    if (!record) {
      assertFundingOpen(me, profile);
      if (journal.records.length >= 256 || journal.records.filter(r => sameScope(r)).length >= 64 || journal.records.some(r => sameScope(r) && r.state === 'pending')) throw new Error('请先恢复尚未确认的 支付意图，勿创建第二笔付款');
      // The official prepare endpoint is idempotent; revalidate the intent before proof work.
      const prepared = object(await this.p.api('/bids/prepare', { id: intent.id, total: intent.total, version: intent.version }));
      const repeated = campaignIntent({ ...me, intents: [prepared] }, intent.id, profile);
      if (!sameIntent(repeated, intent)) throw new Error('支付意图在准备时发生变化');
      const delta = units(intent.delta);
      const note = (await this.p.notes()).filter(n => n.confirmed && !n.spent && units(n.valueSats) >= delta)
        .sort((a, b) => units(a.valueSats) < units(b.valueSats) ? -1 : 1)[0];
      if (!note) throw new Error(`此次支付需要一张足额且已确认的 ${profile.symbol} Note。请合并或接收足额资产，完成同步后恢复原支付`);
      const paths = await this.p.paths([note]);
      const [root, frozenRoot, maxActions, frozen] = await Promise.all([this.p.view('cmxRoot'), this.p.view('cmxFrozenRoot'), this.p.view('maxActions'), this.p.frozen()]);
      await this.p.guard();
      const proof = await this.p.prove('prove_note', { seed_hex: seed, account_id: 0, bip44_coin_type: 60, chain_id: profile.chainId, pool_address: profile.pool,
        anchor_hex: `0x${reverseHexByByte(String(root))}`, spend_notes: [note.ownedNote], merkle_path_overrides: paths, max_actions: Number(maxActions),
        frozen_blacklist: frozen, expected_frozen_root: String(frozenRoot), transfer_output: { value_sats: Number(delta), recipient_raw_address_hex: profile.recipient, memo_hex: paymentMemo(request, intent.psi) } });
      const funding = fundingEnvelope(proof, delta, units(note.valueSats), privacy, profile.recipient);
      record = { request, requestDigest: requestDigest(request), intent, campaignId: profile.campaignId, rulesHash: profile.rulesHash, origin, createdAt: Date.now(), inputCmx: raw(note.cmxHex), inputNullifier: raw(note.nullifierHex), ...funding, attempted: false, state: 'pending' };
      journal.records.push(record);
      // Persist the exact proof before any network call that can spend it.
      await this.save(journal);
    }
    ({ me, intent, profile } = await this.current(expected, approved, request));
    job = (me.jobs as unknown[]).map(object).find(j => j.intentId === intent.id && j.purpose === 'bid');
    if (!job && intent.status !== 'funded' && record.state !== 'failed') {
      assertFundingOpen(me, profile);
      record.attempted = true;
      await this.save(journal);
      try {
        // Repeating this call reuses the same intent and exact encrypted journal material.
        job = object(await this.p.api('/bids/fund', { intentId: intent.id, material: record.material, envelope: record.envelope }));
        if (job.intentId !== undefined && job.intentId !== intent.id) throw new Error('赞助资金任务与支付意图不符');
      } catch {
        return this.result(id, record, '提交结果暂不确定。证明已保存在钱包，请恢复同一支付，勿再次付款');
      }
    }
    if (job) {
      if (typeof job.id !== 'string' || !job.id || job.id.length > 160) throw new Error('赞助任务标识无效');
      record.jobId = job.id;
      if (job.txHash) record.txHash = `0x${raw(job.txHash)}`;
      if (job.status === 'reverted' && !record.txHash) record.state = 'failed';
    }
    await this.save(journal);
    if (record.state === 'failed') return this.result(id, record, '活动拒绝了这笔交易；恢复资料已保留，请核对活动状态');
    if (job?.status === 'confirmed' && typeof job.error === 'string' && job.error) return this.result(id, record, `交易已确认，但活动尚未接受支付：${job.error.slice(0, 400)}`);
    if (await this.confirmed(record, profile)) {
      const refreshed = await this.current(expected, approved, request);
      if (refreshed.intent.status === 'funded') record.state = 'confirmed';
    }
    await this.save(journal);
    return this.result(id, record, this.statusMessage(record));
  }
}
