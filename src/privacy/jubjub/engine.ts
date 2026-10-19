import type { PrivacyOwnedNote } from '../../shared/types';
import { NOTE_ADDED_TOPIC } from '../events';
import { reverseHexByByte } from '../operations';
import type { BidJournal, BidRecord } from './journal';
import { assertBidding, bidMemo, campaignIntent, fundingEnvelope, JUBJUB, object, raw, sameIntent, units, validateProfile, type BidResult, type Intent, type Json, type Profile } from './protocol';

export interface Ports {
  guard(): Promise<void>;
  load(): Promise<BidJournal>;
  save(journal: BidJournal): Promise<void>;
  api(path: string, body?: unknown): Promise<unknown>;
  prove(method: string, body: Json): Promise<Json>;
  notes(): Promise<PrivacyOwnedNote[]>;
  paths(notes: PrivacyOwnedNote[]): Promise<Json[]>;
  view(method: string, args?: unknown[]): Promise<unknown>;
  rpc(method: string, args: unknown[]): Promise<unknown>;
  frozen(): Promise<unknown[]>;
}
export class JubjubEngine {
  constructor(private p: Ports) {}
  private async save(journal: BidJournal) { await this.p.guard(); await this.p.save(journal); await this.p.guard(); }
  private result(record: BidRecord, message: string): BidResult {
    return { intentId: record.intent.id, state: record.state, ...(record.jobId ? { jobId: record.jobId } : {}), ...(record.txHash ? { txHash: record.txHash } : {}), message };
  }
  private statusMessage(record: BidRecord) {
    return record.state === 'confirmed' ? 'JubJub 出价已获链上及活动确认' : record.state === 'failed' ? '链上交易失败；恢复记录已保留' : '出价已保存，正在等待官方赞助交易及 12 个区块确认。可恢复同一出价查询进度';
  }
  private async current(expected: Profile, approved: Intent) {
    await this.p.guard();
    const profile = validateProfile(await this.p.api('/config'));
    if (profile.rulesHash !== expected.rulesHash) throw new Error('JubJub 规则已变化，请重新确认出价');
    const me = object(await this.p.api('/me'));
    const intent = campaignIntent(me, approved.id, profile);
    if (!sameIntent(intent, approved)) throw new Error('JubJub 出价与钱包确认内容不符');
    await this.p.guard();
    return { me, intent, profile };
  }
  private async settledReceipt(txHash: string) {
    const receiptValue = await this.p.rpc('eth_getTransactionReceipt', [`0x${raw(txHash)}`]);
    if (!receiptValue) return null;
    const receipt = object(receiptValue);
    if (!['0x0', '0x1'].includes(String(receipt.status)) || String(receipt.to).toLowerCase() !== JUBJUB.pool || !Array.isArray(receipt.logs)) throw new Error('JubJub 交易回执与官方 P20 合约不符');
    const block = BigInt(String(receipt.blockNumber));
    const head = BigInt(String(await this.p.rpc('eth_blockNumber', [])));
    if (head - block + 1n < BigInt(JUBJUB.confirmations)) return null;
    const canonical = object(await this.p.rpc('eth_getBlockByNumber', [receipt.blockNumber, false]));
    if (canonical.hash !== receipt.blockHash) return null;
    return receipt;
  }
  private async confirmed(record: BidRecord) {
    if (!record.txHash) return false;
    const receipt = await this.settledReceipt(record.txHash);
    if (!receipt) return false;
    if (receipt.status === '0x0') { record.state = 'failed'; return false; }
    for (const output of record.envelope.outputs) {
      if (!(receipt.logs as unknown[]).map(object).some(log => String(log.address).toLowerCase() === JUBJUB.pool && Array.isArray(log.topics) && String(log.topics[0]).toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() && String(log.topics[1]).toLowerCase() === output.cmx_hex)) throw new Error('JubJub 交易缺少已批准的收款或找零输出');
    }
    if (await this.p.view('isSpent', [`0x${reverseHexByByte(record.inputNullifier)}`]) !== true) throw new Error('JubJub 交易未花费预期输入');
    return true;
  }
  async fund(origin: string, approved: Intent, expected: Profile, seed: string, privacy: string): Promise<BidResult> {
    let { me, intent, profile } = await this.current(expected, approved);
    if (Number(BigInt(String(await this.p.rpc('eth_chainId', [])))) !== JUBJUB.chainId || object(await this.p.rpc('eth_getBlockByNumber', ['0x0', false])).hash !== JUBJUB.genesis) throw new Error('JubJub RPC 网络身份不符');
    const journal = await this.p.load();
    // The web page can observe funding before the wallet is opened again. Reconcile all
    // older records before deciding whether another top-up may reserve a fresh input.
    for (const previous of journal.records.filter(r => r.rulesHash === profile.rulesHash && r.state === 'pending')) {
      const previousJob = (me.jobs as unknown[]).map(object).find(j => j.intentId === previous.intent.id && j.purpose === 'bid');
      if (typeof previousJob?.txHash === 'string') previous.txHash = `0x${raw(previousJob.txHash)}`;
      if (typeof previousJob?.id === 'string') previous.jobId = previousJob.id;
      const funded = (me.intents as unknown[]).map(object).some(i => i.id === previous.intent.id && i.status === 'funded');
      if (funded && await this.confirmed(previous)) previous.state = 'confirmed';
    }
    await this.save(journal);
    let record = journal.records.find(r => r.intent.id === intent.id && r.rulesHash === profile.rulesHash);
    if (record && (record.origin !== origin || !sameIntent(record.intent, approved))) throw new Error('JubJub 恢复记录不属于当前网站或出价');
    let job = (me.jobs as unknown[]).map(object).find(j => j.intentId === intent.id && j.purpose === 'bid');
    // A known server job is already funded or submitted. Never build a second payment for it.
    if (!record && (job || intent.status === 'funded')) {
      const txHash = typeof job?.txHash === 'string' ? `0x${raw(job.txHash)}` : undefined;
      const receipt = txHash ? await this.settledReceipt(txHash) : null;
      if (receipt?.status === '0x1' && job?.contributionCmx && !(receipt.logs as unknown[]).map(object).some(log => String(log.address).toLowerCase() === JUBJUB.pool && Array.isArray(log.topics) && String(log.topics[0]).toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() && String(log.topics[1]).toLowerCase() === `0x${raw(job!.contributionCmx)}`)) throw new Error('JubJub 已有交易缺少活动收款输出');
      return { intentId: intent.id, state: receipt?.status === '0x1' && intent.status === 'funded' ? 'confirmed' : receipt?.status === '0x0' || (job?.status === 'reverted' && !txHash) ? 'failed' : 'pending', ...(typeof job?.id === 'string' ? { jobId: job.id } : {}), ...(txHash ? { txHash } : {}), message: '活动已有此出价记录；钱包核对链上确认，未创建另一笔付款' };
    }
    if (!record) {
      assertBidding(me, profile);
      if (journal.records.length >= 256 || journal.records.filter(r => r.rulesHash === profile.rulesHash).length >= 64 || journal.records.some(r => r.rulesHash === profile.rulesHash && r.state === 'pending')) throw new Error('请先恢复尚未确认的 JubJub 出价，勿创建第二笔付款');
      // The official prepare endpoint is idempotent; revalidate the intent before proof work.
      const prepared = object(await this.p.api('/bids/prepare', { id: intent.id, total: intent.total, version: intent.version }));
      const repeated = campaignIntent({ ...me, intents: [prepared] }, intent.id, profile);
      if (!sameIntent(repeated, intent)) throw new Error('JubJub 出价在准备时发生变化');
      const delta = units(intent.delta);
      const note = (await this.p.notes()).filter(n => n.confirmed && !n.spent && units(n.valueSats) >= delta)
        .sort((a, b) => units(a.valueSats) < units(b.valueSats) ? -1 : 1)[0];
      if (!note) throw new Error('此次加注需要一张足额且已确认的 P20 Note。请在钱包合并或接收足额 P20，完成同步后恢复同一出价');
      const paths = await this.p.paths([note]);
      const [root, frozenRoot, maxActions, frozen] = await Promise.all([this.p.view('cmxRoot'), this.p.view('cmxFrozenRoot'), this.p.view('maxActions'), this.p.frozen()]);
      await this.p.guard();
      const proof = await this.p.prove('prove_note', { seed_hex: seed, account_id: 0, bip44_coin_type: 60, chain_id: 143, pool_address: JUBJUB.pool,
        anchor_hex: `0x${reverseHexByByte(String(root))}`, spend_notes: [note.ownedNote], merkle_path_overrides: paths, max_actions: Number(maxActions),
        frozen_blacklist: frozen, expected_frozen_root: String(frozenRoot), transfer_output: { value_sats: Number(delta), recipient_raw_address_hex: profile.recipient, memo_hex: bidMemo(intent.psi) } });
      const funding = fundingEnvelope(proof, delta, units(note.valueSats), privacy);
      record = { intent, campaignId: profile.campaignId, rulesHash: profile.rulesHash, origin, createdAt: Date.now(), inputCmx: raw(note.cmxHex), inputNullifier: raw(note.nullifierHex), ...funding, attempted: false, state: 'pending' };
      journal.records.push(record);
      // Persist the exact proof before any network call that can spend it.
      await this.save(journal);
    }
    ({ me, intent, profile } = await this.current(expected, approved));
    job = (me.jobs as unknown[]).map(object).find(j => j.intentId === intent.id && j.purpose === 'bid');
    if (!job && intent.status !== 'funded' && record.state !== 'failed') {
      assertBidding(me, profile);
      record.attempted = true;
      await this.save(journal);
      try {
        // Repeating this call reuses the same intent and exact encrypted journal material.
        job = object(await this.p.api('/bids/fund', { intentId: intent.id, material: record.material, envelope: record.envelope }));
        if (job.intentId !== undefined && job.intentId !== intent.id) throw new Error('JubJub 资金任务与出价不符');
      } catch {
        return this.result(record, '提交结果暂不确定。证明已保存在钱包，请恢复同一出价，勿再次付款');
      }
    }
    if (job) {
      if (typeof job.id !== 'string' || !job.id || job.id.length > 160) throw new Error('JubJub 任务标识无效');
      record.jobId = job.id;
      if (job.txHash) record.txHash = `0x${raw(job.txHash)}`;
      if (job.status === 'reverted' && !record.txHash) record.state = 'failed';
    }
    await this.save(journal);
    if (record.state === 'failed') return this.result(record, '活动拒绝了这笔交易；恢复资料已保留，请核对活动状态');
    if (job?.status === 'confirmed' && typeof job.error === 'string' && job.error) return this.result(record, `交易已确认，但活动尚未接受出价：${job.error.slice(0, 400)}`);
    if (await this.confirmed(record)) {
      const refreshed = await this.current(expected, approved);
      if (refreshed.intent.status === 'funded') record.state = 'confirmed';
    }
    await this.save(journal);
    return this.result(record, this.statusMessage(record));
  }
}
