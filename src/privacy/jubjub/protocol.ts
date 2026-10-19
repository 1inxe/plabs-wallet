// Backwards-compatible adapter for the original website RPC. All payment
// execution is implemented by the shared sponsored-transfer protocol.
import { LEGACY } from '../sponsored/legacy';
import { api as protocolApi, object, raw, validateProfile as protocolProfile, parseRequest as parseSponsoredRequest, fundingEnvelope as protocolEnvelope, type Profile, type Intent, type Json, type PublicRequest } from '../sponsored/protocol';
export { canonical, campaignIntent, sameIntent, object, raw, units, wire, opening } from '../sponsored/protocol';
export type { Profile, Intent, Json } from '../sponsored/protocol';
export const JUBJUB = LEGACY;
export const api = (path: string, token?: string, body?: unknown) => protocolApi(LEGACY.api, path, token, body);
export function parseRequest(value: unknown) {
  const request = object(value);
  if (Object.keys(request).some(k => !['intentId', 'token'].includes(k)) || typeof request.token !== 'string' || !request.token || request.token.length > 16384 || /\s/.test(request.token)) throw new Error('JubJub 只接受支付意图和临时凭证');
  return { intentId: `0x${raw(request.intentId)}`, token: request.token };
}
export function legacyRequest(profile: Pick<Profile, 'campaignId' | 'rulesHash'>, intent: Pick<Intent, 'id' | 'delta'>, token = 'legacy-internal') {
  return parseSponsoredRequest({ protocol: 'plabs-custody-v1', apiBase: LEGACY.api, campaignId: profile.campaignId, rulesHash: profile.rulesHash, intentId: intent.id, token,
    payment: { chainId: 143, poolAddress: LEGACY.pool, recipientRaw: LEGACY.recipient, amountRaw: intent.delta, memoPrefixHex: LEGACY.memoPrefixHex } });
}
export function validateProfile(value: unknown): Profile {
  const config = object(value), rules = object(config.rules);
  const request = legacyRequest({ campaignId: String(rules.id), rulesHash: String(config.rulesHash) }, { id: `0x${'00'.repeat(32)}`, delta: '1' });
  return protocolProfile(config, request);
}
export function fundingEnvelope(proof: Json, delta: bigint, selectedValue: bigint, privacy: string) {
  return protocolEnvelope(proof, delta, selectedValue, privacy, LEGACY.recipient);
}
export const bidMemo = (psi: string) => `${LEGACY.memoPrefixHex}${raw(psi)}`;
export type BidResult = { id?: string; intentId: string; state: 'pending' | 'confirmed' | 'failed'; jobId?: string; txHash?: string; message?: string };
export type { PublicRequest };
