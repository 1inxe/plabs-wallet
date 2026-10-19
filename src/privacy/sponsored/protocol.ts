import { hexlify, keccak256, toUtf8Bytes } from 'ethers';
import { NETWORKS } from '../../shared/networks';
import { readJsonResponse } from '../../shared/network-response';
import { encodePrivacyCall, reverseHexByByte } from '../operations';

export const PROTOCOL = 'plabs-custody-v1' as const;
export const CONFIRMATIONS = 12;
export type Json = Record<string, unknown>;
export const object = (value: unknown): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('赞助支付响应格式无效');
  return value as Json;
};
export const raw = (value: unknown, bytes = 32): string => {
  if (typeof value !== 'string' || value.trim() !== value || !new RegExp(`^(0x)?[0-9a-f]{${bytes * 2}}$`, 'i').test(value)) throw new Error('赞助支付数据长度无效');
  return value.replace(/^0x/i, '').toLowerCase();
};
export const units = (value: unknown): bigint => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || value.trim() !== value || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('支付金额超出证明精度范围');
  return BigInt(value);
};
export function canonical(value: unknown): string {
  if (value === undefined) throw new Error('支付配置含未定义字段');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export function apiBase(value: unknown): string {
  // Fixed reviewed HTTPS origin and a normalized protocol namespace. No URL
  // normalization, redirects, arbitrary endpoints, headers or executable templates.
  if (typeof value !== 'string' || value.trim() !== value || !/^https:\/\/app\.plabs\.online\/nft-[a-z0-9]+(?:-[a-z0-9]+)*\/v1$/.test(value) || value.length > 200) throw new Error('赞助服务地址不受支持');
  return value;
}
export function supportedPool(address: unknown) {
  const normalized = `0x${raw(address, 20)}`;
  const pool = NETWORKS[143].plabs!.pools.find(item => item.address.toLowerCase() === normalized);
  if (!pool) throw new Error('钱包不支持此 Monad 隐私资产');
  return { ...pool, address: normalized };
}
export type Payment = { chainId: 143; poolAddress: string; recipientRaw: string; amountRaw: string; memoPrefixHex: string };
export type Request = { protocol: typeof PROTOCOL; apiBase: string; campaignId: string; rulesHash: string; intentId: string; token: string; payment: Payment };
export type PublicRequest = Omit<Request, 'token'>;
export function parseRequest(value: unknown): Request {
  const request = object(value), payment = object(request.payment);
  if (Object.keys(request).some(k => !['protocol', 'apiBase', 'campaignId', 'rulesHash', 'intentId', 'token', 'payment'].includes(k)) ||
      Object.keys(payment).some(k => !['chainId', 'poolAddress', 'recipientRaw', 'amountRaw', 'memoPrefixHex'].includes(k)) ||
      request.protocol !== PROTOCOL || typeof request.campaignId !== 'string' || request.campaignId.trim() !== request.campaignId || !/^[a-z0-9-]{1,64}$/.test(request.campaignId) ||
      payment.chainId !== 143 || typeof request.token !== 'string' || !request.token || request.token.length > 16384 || /\s/.test(request.token) ||
      typeof payment.amountRaw !== 'string' || units(payment.amountRaw) <= 0n ||
      typeof payment.memoPrefixHex !== 'string' || payment.memoPrefixHex.trim() !== payment.memoPrefixHex || !/^0x(?:[0-9a-f]{2}){1,128}$/i.test(payment.memoPrefixHex)) throw new Error('赞助支付请求字段无效');
  return { protocol: PROTOCOL, apiBase: apiBase(request.apiBase), campaignId: request.campaignId, rulesHash: `0x${raw(request.rulesHash)}`, intentId: `0x${raw(request.intentId)}`, token: request.token,
    payment: { chainId: 143, poolAddress: supportedPool(payment.poolAddress).address, recipientRaw: raw(payment.recipientRaw, 43), amountRaw: String(units(payment.amountRaw)), memoPrefixHex: payment.memoPrefixHex.toLowerCase() } };
}
export const publicRequest = ({ token: _token, ...request }: Request): PublicRequest => request;
export const requestDigest = (request: Request | PublicRequest) => {
  const { token: _token, ...publicFields } = request as Request;
  return keccak256(toUtf8Bytes(canonical(publicFields)));
};
export type Profile = { rules: Json; rulesHash: string; campaignId: string; recipient: string; apiBase: string; chainId: 143; pool: string; symbol: string; decimals: number; indexer: string; genesis: string; confirmations: number; title: string };
export function validateProfile(value: unknown, request: PublicRequest): Profile {
  const p = object(value), rules = object(p.rules), custody = object(rules.custody), fee = object(p.feePolicy), pool = supportedPool(request.payment.poolAddress);
  const network = NETWORKS[143].plabs!;
  if (p.apiBase !== new URL(apiBase(request.apiBase)).pathname || p.testnet !== false || p.secondaryEnabled !== false ||
      p.indexerUrl !== network.indexerUrl || p.feeSymbol !== pool.symbol || fee.priceMode !== 'sponsored' || fee.fixedUnits !== '0' || fee.marginBps !== 0 ||
      rules.chainId !== 143 || `0x${raw(rules.paymentPool, 20)}` !== pool.address || `0x${raw(rules.market, 20)}` !== pool.address ||
      rules.auctionOnly !== true || rules.staged !== true || custody.asset !== pool.symbol || custody.decimals !== pool.decimals ||
      raw(custody.recipientRaw, 43) !== request.payment.recipientRaw || raw(p.collectorRaw, 43) !== request.payment.recipientRaw ||
      custody.testRecycling !== undefined || rules.openTest !== undefined || rules.id !== request.campaignId ||
      p.rulesHash !== request.rulesHash || p.rulesHash !== keccak256(toUtf8Bytes(canonical(rules))) ||
      typeof rules.title !== 'string' || !rules.title || rules.title.length > 150 ||
      !Number.isSafeInteger(rules.startsAt) || !Number.isSafeInteger(rules.endsAt) || Number(rules.endsAt) <= Number(rules.startsAt)) throw new Error('官方支付配置与已批准的资产、收款方或活动不符');
  return { rules, rulesHash: request.rulesHash, campaignId: request.campaignId, recipient: request.payment.recipientRaw, apiBase: request.apiBase, chainId: 143, pool: pool.address, symbol: pool.symbol, decimals: pool.decimals, indexer: network.indexerUrl, genesis: network.nativeRpcSync!.genesisHash, confirmations: CONFIRMATIONS, title: rules.title };
}
export type Intent = { id: string; total: string; delta: string; version: number; psi: string; status: string };
export function campaignIntent(value: unknown, id: string, profile: Profile): Intent {
  const me = object(value), summary = object(me.summary);
  if (summary.rulesHash !== profile.rulesHash || summary.campaignId !== profile.campaignId || !Array.isArray(me.intents) || !Array.isArray(me.jobs)) throw new Error('账户支付响应与当前活动不符');
  const matches = me.intents.map(object).filter(intent => intent.id === id);
  if (matches.length !== 1) throw new Error('当前钱包身份没有这个支付意图，请重新登录活动');
  const intent = matches[0], total = units(intent.total), delta = units(intent.delta);
  const psi = typeof intent.psi === 'string' && /^(0x[0-9a-f]{1,64}|[0-9]{1,78})$/i.test(intent.psi) ? BigInt(intent.psi).toString(16).padStart(64, '0') : '';
  if (total <= 0n || delta <= 0n || delta > total || !Number.isSafeInteger(intent.version) || Number(intent.version) < 0 || !/^[0-9a-f]{64}$/.test(psi) || !['prepared', 'funded'].includes(String(intent.status))) throw new Error('支付意图金额或绑定信息无效');
  return { id, total: total.toString(), delta: delta.toString(), version: Number(intent.version), psi, status: String(intent.status) };
}
export function verifyPayment(request: PublicRequest, intent: Intent, profile: Profile) {
  if (request.intentId !== intent.id || request.payment.amountRaw !== intent.delta || request.campaignId !== profile.campaignId || request.rulesHash !== profile.rulesHash || request.apiBase !== profile.apiBase || request.payment.poolAddress !== profile.pool || request.payment.recipientRaw !== profile.recipient) throw new Error('支付金额、收款方或意图与批准内容不符');
}
export const sameIntent = (a: Intent, b: Intent) => a.id === b.id && a.total === b.total && a.delta === b.delta && a.version === b.version && a.psi === b.psi;
export function assertFundingOpen(value: unknown, profile: Profile) {
  const summary = object(object(value).summary);
  if (profile.rules.enabled !== true || summary.unavailable === true || summary.bidPaused !== false || summary.phase !== 'bidding' || !Number.isSafeInteger(summary.serverTime) || Number(summary.serverTime) < Number(profile.rules.startsAt) || Number(summary.serverTime) >= Number(profile.rules.endsAt)) throw new Error('活动当前未接受新支付，已提交交易仍可查询');
}
export async function api(base: string, path: string, token?: string, body?: unknown): Promise<unknown> {
  if (!['/config', '/me', '/auth/challenge', '/auth/session', '/bids/prepare', '/bids/fund'].includes(path)) throw new Error('赞助协议不支持此 API');
  const response = await fetch(`${apiBase(base)}${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(response.status === 401 ? '活动登录已过期，请重新连接' : `赞助请求失败 (HTTP ${response.status})；请恢复原支付，勿重复付款`);
  return readJsonResponse(response, 8_000_000);
}
export function wire(value: unknown): unknown {
  if (typeof value === 'bigint') { if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('证明整数超出安全范围'); return Number(value); }
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, v]) => [String(key), wire(v)]));
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, wire(v)]));
  return value;
}
export function opening(value: unknown, amount: bigint, recipient: string) {
  const note = object(value);
  if (units(note.value_sats) !== amount || raw(note.recipient_raw_address_hex, 43) !== raw(recipient, 43)) throw new Error('证明金额或收款地址不符');
  return { cmx_hex: `0x${raw(note.cmx_hex)}`, value: amount.toString(), rho_hex: `0x${reverseHexByByte(raw(note.rho_hex))}`, psi_hex: `0x${reverseHexByByte(raw(note.psi_hex))}`, rcm_hex: `0x${reverseHexByByte(raw(note.rcm_hex))}`, address_raw_hex: raw(recipient, 43) };
}
export function fundingEnvelope(proof: Json, delta: bigint, selectedValue: bigint, privacy: string, recipient: string) {
  if (!Array.isArray(proof.funding_notes) || proof.funding_notes.length !== 1) throw new Error('证明缺少唯一收款输出');
  const note = opening(proof.funding_notes[0], delta, recipient), change = selectedValue - delta;
  if (change < 0n || (change > 0n && !proof.output_note)) throw new Error('证明缺少正确找零输出');
  const outputs = [note, ...(proof.output_note ? [opening(proof.output_note, change, privacy)] : [])];
  const bundle = object(wire(proof.bundle)); encodePrivacyCall(bundle);
  const commitments = (bundle.actions as Json[]).map(action => typeof action.cmx === 'string' ? `0x${raw(action.cmx)}` : hexlify(Uint8Array.from(action.cmx as number[])));
  if (outputs.some(output => !commitments.includes(output.cmx_hex))) throw new Error('证明承诺与输出不一致');
  return { material: { note }, envelope: { bundle, outputs } };
}
export const paymentMemo = (request: PublicRequest, psi: string) => `${request.payment.memoPrefixHex}${raw(psi)}`;
export type TransferResult = { id: string; intentId: string; state: 'pending' | 'confirmed' | 'failed'; jobId?: string; txHash?: string; message?: string };
