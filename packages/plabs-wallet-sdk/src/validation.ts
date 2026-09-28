import { PlabsWalletError, PLABS_ERROR_CODES } from './errors.js';
import type { ChainIdInput, HexChainId, PlabsPrivacyPoolParams } from './types.js';
export function invalid(message: string): never { throw new PlabsWalletError(message, PLABS_ERROR_CODES.INVALID_PARAMS); }
export function toChainHex(chainId: ChainIdInput): HexChainId {
  if (typeof chainId === 'number') {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) invalid('chainId must be a positive safe integer.');
    return `0x${chainId.toString(16)}`;
  }
  if (typeof chainId !== 'string' || !/^0x[0-9a-f]+$/i.test(chainId)) invalid('chainId must be a hexadecimal string or number.');
  const value = BigInt(chainId);
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) invalid('chainId is outside the supported range.');
  return `0x${value.toString(16)}`;
}
export function evmAddress(value: string, name = 'address'): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)) invalid(`${name} must be a 20-byte EVM address.`);
  return value;
}
export function privacyParams(params: PlabsPrivacyPoolParams, allowTo = false) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) invalid('Privacy transaction parameters are required.');
  const allowed = ['chainId', 'poolAddress', 'amount', 'feePool', ...(allowTo ? ['to'] : [])];
  if (Object.keys(params).some(key => !allowed.includes(key))) invalid('Unsupported transaction fields; PLabs does not accept Zcash parameters, proofs or calldata.');
  if (typeof params.amount !== 'string' || params.amount.length > 80 || !/^\d+(\.\d+)?$/.test(params.amount) || !/[1-9]/.test(params.amount)) invalid('amount must be a positive decimal string, not a number.');
  return { chainId: toChainHex(params.chainId), poolAddress: evmAddress(params.poolAddress, 'poolAddress'), amount: params.amount, ...(params.feePool === undefined ? {} : { feePool: evmAddress(params.feePool, 'feePool') }) };
}
export function privacyAddress(value: string): string {
  if (typeof value !== 'string' || value.length > 1024) invalid('A valid privacy recipient is required.');
  const trimmed = value.trim();
  if (!/^perc1[0-9a-z]+$/i.test(trimmed) && !/^(0x)?[0-9a-f]{86}$/i.test(trimmed)) invalid('Recipient must be a perc1 address or a 43-byte raw privacy address.');
  // The wallet validates the address checksum and protocol before approval.
  return trimmed;
}
export function utf8Hex(message: string): `0x${string}` {
  if (typeof message !== 'string' || !message) invalid('A non-empty message is required.');
  for (const character of message) { const point = character.codePointAt(0)!; if (point >= 0xd800 && point <= 0xdfff) invalid('Message contains an unpaired UTF-16 surrogate.'); }
  const bytes = new TextEncoder().encode(message);
  if (bytes.length > 32767) invalid('Message is too large for the wallet.');
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
