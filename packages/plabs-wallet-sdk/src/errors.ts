import type { ProviderRpcError } from './types.js';
export const PLABS_ERROR_CODES = Object.freeze({ USER_REJECTED: 4001, UNAUTHORIZED: 4100, UNSUPPORTED: 4200, DISCONNECTED: 4900, CHAIN_DISCONNECTED: 4901, CHAIN_NOT_ADDED: 4902, INVALID_PARAMS: -32602, REQUEST_PENDING: -32002, INTERNAL: -32603 });
export class PlabsWalletError extends Error implements ProviderRpcError {
  readonly code: number;
  readonly data?: unknown;
  readonly originalError?: unknown;
  constructor(message: string, code: number = PLABS_ERROR_CODES.INTERNAL, data?: unknown, originalError?: unknown) {
    super(message); this.name = 'PlabsWalletError'; this.code = code; this.data = data; this.originalError = originalError;
  }
}
export function toPlabsWalletError(cause: unknown): PlabsWalletError {
  if (cause instanceof PlabsWalletError) return cause;
  const value = cause && typeof cause === 'object' ? cause as { message?: unknown; code?: unknown; data?: unknown } : undefined;
  return new PlabsWalletError(typeof value?.message === 'string' ? value.message : String(cause), typeof value?.code === 'number' ? value.code : PLABS_ERROR_CODES.INTERNAL, value?.data, cause);
}
