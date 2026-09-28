import { bech32m } from '@scure/base';

const rawBytes = (value: string) => {
  const raw = value.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{86}$/.test(raw)) throw new Error('隐私地址必须是 43 字节');
  return Uint8Array.from(raw.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
};

export const formatPrivacyAddress = (value: string) =>
  bech32m.encode('perc', bech32m.toWords(rawBytes(value)), 1023);

export const parsePrivacyAddress = (value: string) => {
  const trimmed = value.trim();
  const raw = trimmed.replace(/^0x/i, '').toLowerCase();
  if (/^[0-9a-f]{86}$/.test(raw)) return raw;
  if (!/^perc1/i.test(trimmed)) throw new Error('隐私地址必须是 perc1… 或 43 字节 0x 地址');
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    throw new Error('隐私地址不能混合大小写');
  }
  try {
    const decoded = bech32m.decode(trimmed.toLowerCase() as `${string}1${string}`, 1023);
    if (decoded.prefix !== 'perc') throw new Error('隐私地址前缀必须是 perc');
    const bytes = bech32m.fromWords(decoded.words);
    if (bytes.length !== 43) throw new Error('隐私地址长度无效');
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    throw error instanceof Error ? error : new Error('隐私地址格式无效');
  }
};
