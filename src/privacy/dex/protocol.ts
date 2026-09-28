import { concat, getBytes, hexlify, keccak256, toUtf8Bytes } from 'ethers';

export const DEX = Object.freeze({
  chainId: 143,
  base: '0x59df8637654d1ecb090ab7881b703b5a856d2780',
  quote: '0xcb36e209ae44fafc75dc6820ae42d9400637f99e',
  settlement: '0x1b9d96733a4c54d842cb1d56be051d9fc6d1de8c',
  matcher: 'https://app.plabs.online/dex-matcher',
  relayer: 'https://monad-relayer.plabs.online',
  indexer: 'https://app.plabs.online/dex-indexer',
  genesis: '0x0c47353304f22b1c15706367d739b850cda80b5c87bbc335014fef3d88deaac9',
  verifyAddress:
    '51c2ad230fff478727684ea9d60ab4d1f385c7cf2b221e1317c0dc10f44f95b8fe8d853e8c7c9f39c98318',
  scale: 1_000_000n,
});
export function dexIndexer(pool: string) {
  if (pool.toLowerCase() === DEX.base) return `${DEX.indexer}/base`;
  if (pool.toLowerCase() === DEX.quote) return `${DEX.indexer}/quote`;
  throw new Error('PEX 索引资产池无效');
}
export type DexIntent = {
  chainId: '0x8f';
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantityRaw: string;
  priceTicks: string;
  maxFeeRaw: string;
};
export type JsonRecord = Record<string, unknown>;
export function object(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PEX 响应格式无效');
  return value as JsonRecord;
}
export function raw(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || !new RegExp(`^(0x)?[a-f0-9]{${bytes * 2}}$`, 'i').test(value))
    throw new Error('PEX 数据长度无效');
  return value.replace(/^0x/i, '').toLowerCase();
}
export const hex = (value: unknown, bytes = 32) => `0x${raw(value, bytes)}`;
export const reverse = (value: unknown) => hexlify(getBytes(hex(value)).reverse());
export function integer(value: unknown, positive = false): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new Error('PEX 金额必须为整数');
  const amount = BigInt(value);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || (positive && amount === 0n))
    throw new Error('PEX 金额超出证明范围');
  return amount;
}
export function parseIntent(value: unknown): DexIntent {
  const v = object(value);
  if (
    Object.keys(v).some(
      (k) => !['chainId', 'side', 'type', 'quantityRaw', 'priceTicks', 'maxFeeRaw'].includes(k),
    ) ||
    v.chainId !== '0x8f' ||
    !['buy', 'sell'].includes(String(v.side)) ||
    !['market', 'limit'].includes(String(v.type))
  )
    throw new Error('PEX 只接受 Monad 买卖意图，不接受网站提供证明、密钥或收款地址');
  return {
    chainId: '0x8f',
    side: v.side as DexIntent['side'],
    type: v.type as DexIntent['type'],
    quantityRaw: String(integer(v.quantityRaw, true)),
    priceTicks: String(integer(v.priceTicks, true)),
    maxFeeRaw: String(integer(v.maxFeeRaw, true)),
  };
}
export function validateMarket(value: unknown, intent?: DexIntent) {
  const h = object(value),
    p = object(h.vnote_profile);
  if (
    h.status !== 'ok' ||
    h.chain_id !== DEX.chainId ||
    String(h.base).toLowerCase() !== DEX.base ||
    String(h.quote).toLowerCase() !== DEX.quote ||
    String(h.settlement_addr).toLowerCase() !== DEX.settlement ||
    h.base_decimals !== 6 ||
    h.quote_decimals !== 6 ||
    BigInt(String(h.price_scale)) !== DEX.scale ||
    h.verify_enabled !== true ||
    raw(h.verify_address, 43) !== DEX.verifyAddress ||
    h.dex_settlement_version !== 5 ||
    p.protocol_version !== 5 ||
    p.terms_version !== 2 ||
    p.memo_version !== 2 ||
    p.profile_id !== 'vnote-cross-price-cap-v2' ||
    h.placement_idempotency !== true ||
    h.order_terms_durable !== true ||
    h.persistence_healthy !== true
  )
    throw new Error('官网 PEX 协议配置已变化，请更新钱包后重试');
  if (typeof h.matches_epoch !== 'string' || !h.matches_epoch || h.matches_epoch.length > 160)
    throw new Error('PEX 轮次无效');
  const tick = integer(h.price_tick, true),
    lot = integer(h.lot_size, true),
    fee = integer(h.fee_units, true);
  if (String(h.fee_pool).toLowerCase() !== DEX.quote) throw new Error('PEX 手续费资产已变化');
  if (
    intent &&
    (BigInt(intent.priceTicks) % tick !== 0n || BigInt(intent.quantityRaw) % lot !== 0n)
  )
    throw new Error('订单价格或数量不符合官网最小单位');
  if (intent && fee > BigInt(intent.maxFeeRaw))
    throw new Error('官网手续费已高于请求上限，请刷新订单');
  return { epoch: h.matches_epoch, tick, lot, fee, key: object(h.material_encryption) };
}
export function amounts(intent: DexIntent) {
  const q = BigInt(intent.quantityRaw),
    p = BigInt(intent.priceTicks);
  const principal = intent.side === 'sell' ? q : (q * p + DEX.scale - 1n) / DEX.scale;
  integer(principal.toString(), true);
  let numerator = intent.side === 'sell' ? p : DEX.scale;
  let denominator = intent.side === 'sell' ? DEX.scale : p;
  let a = numerator,
    b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  return {
    principal,
    payPool: intent.side === 'sell' ? DEX.base : DEX.quote,
    wantPool: intent.side === 'sell' ? DEX.quote : DEX.base,
    numerator,
    denominator,
    maxWant: intent.side === 'buy' ? q : (1n << 64n) - 1n,
  };
}
export function payoutDiversifier(mainNk: string, firstNullifier: string) {
  return keccak256(
    concat([
      toUtf8Bytes('perc20.dex.vnote.payout-diversifier.v1'),
      reverse(mainNk),
      reverse(firstNullifier),
    ]),
  ).slice(2, 24);
}
export function vnoteMemo(
  want: string,
  num: bigint,
  den: bigint,
  commitment: string,
  maxWant: bigint,
  account: number,
) {
  if (!Number.isSafeInteger(account) || account < 1 || account > 0x7fffffff)
    throw new Error('禁止向主账户或无效子账户委托');
  const memo = new Uint8Array(500),
    view = new DataView(memo.buffer);
  memo.set(toUtf8Bytes('VNTE'));
  memo[4] = 2;
  memo.set(getBytes(hex(want, 20)), 6);
  view.setBigUint64(26, num);
  view.setBigUint64(34, den);
  memo.set(getBytes(hex(commitment)), 42);
  view.setBigUint64(74, maxWant);
  view.setUint32(82, account);
  return hexlify(memo);
}
export function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('证明整数超出精度范围');
    return Number(value);
  }
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([k, v]) => [String(k), serialize(v)]));
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  return value;
}
/** Same envelope/KDF as the official VNote matcher. Only child viewing material is delegated. */
export async function encryptMaterial(material: JsonRecord, key: JsonRecord) {
  if (
    key.alg !== 'p256-ecdh-aes-256-gcm' ||
    key.version !== 1 ||
    !raw(key.public_key_hex, 65).startsWith('04')
  )
    throw new Error('不支持的 Matcher 加密公钥');
  const recipient = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(getBytes(hex(key.public_key_hex, 65))),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient }, ephemeral.privateKey, 256),
  );
  const aes = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest(
      'SHA-256',
      Uint8Array.from(getBytes(concat([toUtf8Bytes('perc20-vnote-material-v1'), shared]))),
    ),
    'AES-GCM',
    false,
    ['encrypt'],
  );
  shared.fill(0);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aes,
    toUtf8Bytes(JSON.stringify(material)) as Uint8Array<ArrayBuffer>,
  );
  return {
    v: 1,
    alg: 'p256-ecdh-aes-256-gcm',
    ephemeral_public_key_hex: hexlify(
      new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey)),
    ),
    nonce_hex: hexlify(nonce),
    ciphertext_hex: hexlify(new Uint8Array(ciphertext)),
  };
}
