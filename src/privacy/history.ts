import { walletErrorMessage } from '../shared/errors';
import { NETWORKS, isSupportedChainId } from '../shared/networks';
import { base64ToBytes, bytesToBase64 } from '../shared/encoding';
import type { PrivacyActivity, PrivacyActivityDetails } from '../shared/types';

export interface EncryptedActivity { version: 1; nonce: string; ciphertext: string }
const encoder = new TextEncoder();
const aad = (entry: Record<string, any>) => encoder.encode(`plabs-activity/v1|${entry.walletAddress.toLowerCase()}|${entry.chainId}|${entry.id}`);
export async function encryptActivity(entry: Record<string, any>, details: PrivacyActivityDetails, key: CryptoKey): Promise<EncryptedActivity> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(entry) }, key, encoder.encode(JSON.stringify(details)));
  return { version: 1, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(data)) };
}
const hexHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
export function compactActivity(entry: Record<string, any>) {
  const operation = entry.verification ?? entry;
  const legacy = entry.activity ? undefined : {
    kind: operation.mergePlanId ? 'merge' : operation.kind,
    poolAddress: operation.transaction?.to ?? entry.poolAddress,
    amountRaw: operation.amountRaw,
    symbol: operation.symbol,
    decimals: operation.decimals,
    receiveRaw: operation.receiveRaw,
    paymentMode: operation.fees?.paymentMode,
    feeRaw: operation.fees?.feeRaw,
    feeSymbol: operation.fees?.feeSymbol,
    feeDecimals: operation.fees?.feeDecimals,
    maxGasWei: operation.estimatedMaxGasCostWei,
    recipient: operation.recipient,
    mergePlanId: operation.mergePlanId,
  };
  return {
    id: entry.id, walletAddress: entry.walletAddress, chainId: entry.chainId,
    state: entry.state, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    txHashes: [...new Set([...(Array.isArray(entry.txHashes) ? entry.txHashes : []), entry.txHash].filter(hexHash))],
    mainTxHash: hexHash(entry.mainTxHash) ? entry.mainTxHash : hexHash(entry.txHash) ? entry.txHash : undefined,
    requestId: typeof entry.requestId === 'string' ? entry.requestId : undefined,
    error: typeof entry.error === 'string' ? entry.error.slice(0, 500) : undefined,
    refreshable: Boolean(entry.recovery || entry.verification || entry.txHashes?.length),
    activity: entry.activity as EncryptedActivity | undefined,
    ...(legacy ? { legacy } : {}),
  };
}
export type StoredActivity = ReturnType<typeof compactActivity>;
export async function decodeActivity(entry: StoredActivity, key: CryptoKey): Promise<PrivacyActivity> {
  if (!isSupportedChainId(entry.chainId)) throw new Error('不支持的历史网络');
  let details: Partial<PrivacyActivityDetails> = entry.legacy ?? {};
  let unreadable = false;
  if (entry.activity) {
    try {
      if (entry.activity.version !== 1) throw new Error('历史版本不支持');
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(base64ToBytes(entry.activity.nonce)).buffer, additionalData: aad(entry) }, key, Uint8Array.from(base64ToBytes(entry.activity.ciphertext)).buffer);
      details = JSON.parse(new TextDecoder().decode(plaintext));
    } catch { details = {}; unreadable = true; }
  }
  const pool = NETWORKS[entry.chainId].plabs?.pools.find(item => item.address.toLowerCase() === details.poolAddress?.toLowerCase());
  const status = entry.state === 'confirmed' ? 'confirmed' : ['relayer-failed', 'execution-failed', 'failed-before-broadcast'].includes(entry.state) ? 'failed' : entry.state === 'requires-review' || entry.state === 'broadcast-unknown' ? 'review' : ['prepared', 'approval-submitted', 'submitted', 'relayer-submitting', 'relayer-pending'].includes(entry.state) ? 'pending' : 'review';
  const amountRaw = typeof details.amountRaw === 'string' && /^\d+$/.test(details.amountRaw) ? details.amountRaw : undefined;
  return {
    ...details,
    id: entry.id, chainId: entry.chainId, status, stage: entry.state,
    kind: ['send', 'shield', 'unshield', 'merge'].includes(String(details.kind)) ? details.kind as PrivacyActivityDetails['kind'] : 'unknown',
    symbol: details.symbol ?? pool?.symbol ?? '资产', decimals: details.decimals ?? pool?.decimals ?? 0,
    amountRaw, createdAt: entry.createdAt, updatedAt: entry.updatedAt, txHashes: entry.txHashes,
    mainTxHash: entry.mainTxHash, requestId: entry.requestId, error: entry.error ? walletErrorMessage(entry.error, NETWORKS[entry.chainId].nativeSymbol) : undefined,
    refreshable: entry.refreshable, unreadable,
  };
}
