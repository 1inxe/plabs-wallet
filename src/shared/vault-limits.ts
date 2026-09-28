import { base64ToBytes } from './encoding';

export const MAX_VAULT_JSON_CHARS = 1_000_000;
export const assertKdfIterations = (iterations: number) => {
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000)
    throw new Error('Vault KDF 次数超出支持范围（100,000–2,000,000），请使用可信来源重新导出');
};
export const boundedBase64 = (value: unknown, minBytes: number, maxBytes: number, label: string) => {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(maxBytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error(`${label} 编码或大小无效`);
  const bytes = base64ToBytes(value);
  if (bytes.length < minBytes || bytes.length > maxBytes) throw new Error(`${label} 长度无效`);
  return bytes;
};
