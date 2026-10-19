import { hexlify, keccak256, toUtf8Bytes } from 'ethers';
import { readJsonResponse } from '../../shared/network-response';
import { encodePrivacyCall, reverseHexByByte } from '../operations';

export const JUBJUB = Object.freeze({
  api: 'https://app.plabs.online/nft-jubjub/v1',
  chainId: 143,
  pool: '0x59df8637654d1ecb090ab7881b703b5a856d2780',
  indexer: 'https://monad-indexer.plabs.online',
  recipient: '4449ad291565b82847b77c7d1358898a4094cacef26e518867d1485ef4f8b6656e64b12827bbaa7d357a0d',
  genesis: '0x0c47353304f22b1c15706367d739b850cda80b5c87bbc335014fef3d88deaac9',
  confirmations: 12,
});
export type Json = Record<string, unknown>;
export const object = (v: unknown): Json => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('JubJub 响应格式无效');
  return v as Json;
};
export const raw = (v: unknown, bytes = 32): string => {
  if (typeof v !== 'string' || !new RegExp(`^(0x)?[0-9a-f]{${bytes * 2}}$`, 'i').test(v)) throw new Error('JubJub 数据长度无效');
  return v.replace(/^0x/i, '').toLowerCase();
};
export const units = (v: unknown): bigint => {
  if (typeof v === 'number' && Number.isSafeInteger(v)) v = String(v);
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(v) || BigInt(v) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('JubJub 金额超出证明精度范围');
  return BigInt(v);
};
export function canonical(v: unknown): string {
  if (v === undefined) throw new Error('JubJub 配置含有未定义字段');
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(',')}}`;
}
export type Profile = { rules: Json; rulesHash: string; campaignId: string; recipient: string };
export function validateProfile(value: unknown): Profile {
  const p = object(value), r = object(p.rules), c = object(r.custody), fee = object(p.feePolicy);
  if (p.apiBase !== '/nft-jubjub/v1' || p.testnet !== false || p.secondaryEnabled !== false ||
      p.indexerUrl !== JUBJUB.indexer || p.feeSymbol !== 'P20' || fee.priceMode !== 'sponsored' || fee.fixedUnits !== '0' || fee.marginBps !== 0 ||
      r.chainId !== JUBJUB.chainId || r.market !== JUBJUB.pool || r.paymentPool !== JUBJUB.pool || r.auctionOnly !== true || r.staged !== true ||
      r.reserveUnits !== '100000000' || c.asset !== 'P20' || c.decimals !== 6 || c.bidStepUnits !== '50000000' || c.settlement !== 'pay-as-bid' ||
      raw(c.recipientRaw, 43) !== JUBJUB.recipient || p.collectorRaw !== JUBJUB.recipient ||
      c.testRecycling !== undefined || r.openTest !== undefined ||
      typeof r.id !== 'string' || !/^jubjub-p20-mainnet-[a-z0-9-]{1,45}$/.test(r.id) ||
      !Number.isSafeInteger(r.startsAt) || !Number.isSafeInteger(r.endsAt) || Number(r.endsAt) <= Number(r.startsAt) ||
      !Number.isSafeInteger(r.auctionSeats) || Number(r.auctionSeats) < 1 || Number(r.auctionSeats) > 100000 ||
      p.rulesHash !== keccak256(toUtf8Bytes(canonical(r)))) throw new Error('JubJub 官方部署或拍卖规则已变化，请更新钱包');
  return { rules: r, rulesHash: String(p.rulesHash), campaignId: r.id, recipient: JUBJUB.recipient };
}
export type Intent = { id: string; total: string; delta: string; version: number; psi: string; status: string };
export function campaignIntent(meValue: unknown, id: string, profile: Profile): Intent {
  const me = object(meValue), summary = object(me.summary);
  if (summary.rulesHash !== profile.rulesHash || summary.campaignId !== profile.campaignId || !Array.isArray(me.intents) || !Array.isArray(me.jobs)) throw new Error('JubJub 账户响应与当前活动不符');
  const matches = me.intents.map(object).filter(i => i.id === id);
  if (matches.length !== 1) throw new Error('当前钱包身份没有这个 JubJub 出价，请重新登录活动');
  const i = matches[0], total = units(i.total), delta = units(i.delta);
  const psi = typeof i.psi === 'string' && /^0x[0-9a-f]{1,64}$/i.test(i.psi)
    ? BigInt(i.psi).toString(16).padStart(64, '0')
    : typeof i.psi === 'string' && /^\d{1,78}$/.test(i.psi)
      ? BigInt(i.psi).toString(16).padStart(64, '0') : '';
  if (total < 100000000n || total % 50000000n || delta < 50000000n || delta % 50000000n || delta > total ||
      !Number.isSafeInteger(i.version) || Number(i.version) < 0 || !/^[0-9a-f]{64}$/.test(psi) || !['prepared', 'funded'].includes(String(i.status))) throw new Error('JubJub 出价金额或绑定信息无效');
  return { id, total: total.toString(), delta: delta.toString(), version: Number(i.version), psi, status: String(i.status) };
}
export function sameIntent(a: Intent, b: Intent) {
  return a.id === b.id && a.total === b.total && a.delta === b.delta && a.version === b.version && a.psi === b.psi;
}
export function assertBidding(me: unknown, profile: Profile) {
  const summary = object(object(me).summary);
  if (profile.rules.enabled !== true || summary.unavailable === true || summary.bidPaused !== false || summary.phase !== 'bidding' ||
      !Number.isSafeInteger(summary.serverTime) || Number(summary.serverTime) < Number(profile.rules.startsAt) || Number(summary.serverTime) >= Number(profile.rules.endsAt)) throw new Error('JubJub 当前未开放出价；已提交交易仍可继续查询');
}
export function parseRequest(value: unknown) {
  const p = object(value);
  if (Object.keys(p).some(k => !['intentId', 'token'].includes(k)) || typeof p.intentId !== 'string' || !/^0x[0-9a-f]{64}$/i.test(p.intentId) || typeof p.token !== 'string' || !p.token || p.token.length > 8192 || /[\r\n]/.test(p.token)) throw new Error('JubJub 只接受出价标识和临时登录凭证');
  return { intentId: p.intentId.toLowerCase(), token: p.token };
}
export async function api(path: string, token?: string, body?: unknown): Promise<unknown> {
  if (!['/config', '/me', '/auth/challenge', '/auth/session', '/bids/prepare', '/bids/fund'].includes(path)) throw new Error('JubJub API 路径不允许');
  const response = await fetch(`${JUBJUB.api}${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(response.status === 401 ? 'JubJub 登录已过期，请重新连接活动' : `JubJub 请求失败 (HTTP ${response.status})；请恢复同一出价，勿重复付款`);
  return readJsonResponse(response, 8_000_000);
}
export function wire(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('JubJub 证明整数超出安全范围');
    return Number(value);
  }
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), wire(v)]));
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]));
  return value;
}
export function opening(value: unknown, amount: bigint, recipient: string) {
  const note = object(value);
  if (units(note.value_sats) !== amount || raw(note.recipient_raw_address_hex, 43) !== raw(recipient, 43)) throw new Error('JubJub 证明的金额或收款地址不符');
  return { cmx_hex: `0x${raw(note.cmx_hex)}`, value: amount.toString(), rho_hex: `0x${reverseHexByByte(raw(note.rho_hex))}`, psi_hex: `0x${reverseHexByByte(raw(note.psi_hex))}`, rcm_hex: `0x${reverseHexByByte(raw(note.rcm_hex))}`, address_raw_hex: raw(recipient, 43) };
}
export function fundingEnvelope(proof: Json, delta: bigint, selectedValue: bigint, privacy: string) {
  const notes = proof.funding_notes;
  if (!Array.isArray(notes) || notes.length !== 1) throw new Error('JubJub 证明缺少唯一托管收款输出');
  const note = opening(notes[0], delta, JUBJUB.recipient);
  const change = selectedValue - delta;
  if (change > 0n && !proof.output_note) throw new Error('JubJub 证明缺少找零输出');
  const outputs = [note, ...(proof.output_note ? [opening(proof.output_note, change, privacy)] : [])];
  const bundle = object(wire(proof.bundle));
  encodePrivacyCall(bundle);
  const commitments = (bundle.actions as Json[]).map(a => typeof a.cmx === 'string' ? `0x${raw(a.cmx)}` : hexlify(Uint8Array.from(a.cmx as number[])));
  if (outputs.some(o => !commitments.includes(o.cmx_hex))) throw new Error('JubJub 证明承诺与输出不一致');
  return { material: { note }, envelope: { bundle, outputs } };
}
export const bidMemo = (psi: string) => `0x5045524332302d4a55424a55422d5032302d763100${raw(psi)}`;
export type BidResult = { intentId: string; state: 'pending' | 'confirmed' | 'failed'; jobId?: string; txHash?: string; message?: string };
