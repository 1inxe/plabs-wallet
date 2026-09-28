import { assertKdfIterations, boundedBase64 } from '../shared/vault-limits';
import { randomBytes } from 'ethers';
import { base64ToBytes, bytesToBase64 } from '../shared/encoding';
import type {
  ChainId,
  OfficialPrivacyWalletState,
  PrivacyVault,
  PrivacyStateEncryption,
} from '../shared/types';
import { assertStrongPassword } from '../shared/vault';
import { parsePrivacyAddress } from './address';

const PROTOCOL = 'privacybtc_orchard';
const FINGERPRINT_CONTEXT = 'PrivacyBTC seed vault fingerprint v1';
const KDF_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const OFFICIAL_STATE_CONTEXT = 'PrivacyBTC wallet state key v1';

const asBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
const normalizeHex = (value: string) => value.replace(/^0x/i, '').toLowerCase();
const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const hexToBytes = (value: string) => {
  const hex = normalizeHex(value);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('隐私 seed 必须是 32 字节');
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
};

const deriveKey = async (password: string, salt: Uint8Array, iterations: number, extractable = false) => {
  assertKdfIterations(iterations);
  if (salt.length < 16 || salt.length > 64) throw new Error('Vault salt 长度无效');
  const source = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asBuffer(salt), iterations },
    source,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
};

export const privacyFingerprint = async (seedHex: string) => {
  const context = encoder.encode(FINGERPRINT_CONTEXT);
  const seed = hexToBytes(seedHex);
  const payload = new Uint8Array(context.length + seed.length);
  payload.set(context);
  payload.set(seed, context.length);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return `fp_${bytesToHex(new Uint8Array(digest)).slice(0, 32)}`;
};

export const createPrivacyVault = async ({
  password,
  walletAddress,
}: {
  password: string;
  walletAddress: string;
}) => {
  assertStrongPassword(password);
  const seedHex = bytesToHex(randomBytes(32));
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const createdAt = new Date().toISOString();
  const stateSalt = randomBytes(16);
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBuffer(nonce) },
    key,
    encoder.encode(JSON.stringify({ seed_hex: seedHex, protocol: PROTOCOL, created_at: createdAt })),
  );
  const vault: PrivacyVault = {
    version: 1,
    vault_id: `vault_${crypto.randomUUID()}`,
    account_id: `local_${walletAddress.toLowerCase()}`,
    login_wallet_type: 'evm',
    login_wallet_address: walletAddress.toLowerCase(),
    protocol: PROTOCOL,
    key_fingerprint: await privacyFingerprint(seedHex),
    derivation_path: "m/32'/60'/0'",
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    encryption: {
      algorithm: 'aes-256-gcm',
      nonce: bytesToBase64(nonce),
      kdf: 'pbkdf2',
      kdf_params: { salt: bytesToBase64(salt), iterations: KDF_ITERATIONS },
    },
    created_at: createdAt,
    updated_at: createdAt,
  };
  return { seedHex, vault, stateEncryption: { salt: bytesToBase64(stateSalt), iterations: KDF_ITERATIONS } };
};

const STATE_KEY_AAD = encoder.encode('plabs-privacy-state-key/v1');

export const derivePrivacyStateKey = async (
  password: string,
  encryption: PrivacyStateEncryption,
  extractable = false,
): Promise<CryptoKey> => {
  if (!encryption.wrappedKey) {
    return deriveKey(password, base64ToBytes(encryption.salt), encryption.iterations, extractable);
  }
  boundedBase64(encryption.wrappedKey.nonce, 12, 12, '状态密钥 nonce');
  boundedBase64(encryption.wrappedKey.ciphertext, 48, 48, '状态密钥 ciphertext');
  if (encryption.wrappedKey.version !== 1) throw new Error('隐私状态密钥版本不受支持');
  const wrappingKey = await deriveKey(password, base64ToBytes(encryption.salt), encryption.iterations);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBuffer(base64ToBytes(encryption.wrappedKey.nonce)), additionalData: STATE_KEY_AAD },
    wrappingKey,
    asBuffer(base64ToBytes(encryption.wrappedKey.ciphertext)),
  );
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt']);
  } finally { new Uint8Array(raw).fill(0); }
};

// Keep the existing notes encryption key, wrapping it under the new password.
// Vault and wrapper can then be committed together without a cross-database migration.
export const changePrivacyVaultPassword = async (
  vault: PrivacyVault, stateEncryption: PrivacyStateEncryption, currentPassword: string, newPassword: string,
) => {
  assertStrongPassword(newPassword);
  if (currentPassword === newPassword) throw new Error('新密码不能与当前隐私密码相同');
  const { payload } = await decryptPrivacyVault(vault, currentPassword);
  const stateKey = await derivePrivacyStateKey(currentPassword, stateEncryption, true);
  const rawKey = await crypto.subtle.exportKey('raw', stateKey);
  try {
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asBuffer(nonce) },
      await deriveKey(newPassword, salt, KDF_ITERATIONS),
      encoder.encode(JSON.stringify(payload)),
    );
    const stateSalt = randomBytes(16);
    const stateNonce = randomBytes(12);
    const wrappedKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asBuffer(stateNonce), additionalData: STATE_KEY_AAD },
      await deriveKey(newPassword, stateSalt, KDF_ITERATIONS),
      rawKey,
    );
    return {
      vault: { ...vault, ciphertext: bytesToBase64(new Uint8Array(ciphertext)), updated_at: new Date().toISOString(),
        encryption: { ...vault.encryption, nonce: bytesToBase64(nonce), kdf_params: { salt: bytesToBase64(salt), iterations: KDF_ITERATIONS } } },
      stateEncryption: { salt: bytesToBase64(stateSalt), iterations: KDF_ITERATIONS,
        wrappedKey: { version: 1 as const, nonce: bytesToBase64(stateNonce), ciphertext: bytesToBase64(new Uint8Array(wrappedKey)) } },
    };
  } finally { new Uint8Array(rawKey).fill(0); }
};

export const validatePrivacyVault = (value: unknown): PrivacyVault => {
  const vault = value as PrivacyVault;
  if (
    !vault ||
    vault.version !== 1 ||
    vault.protocol !== PROTOCOL ||
    vault.login_wallet_type !== 'evm' ||
    vault.encryption?.algorithm !== 'aes-256-gcm' ||
    vault.encryption?.kdf !== 'pbkdf2' ||
    !/^fp_[0-9a-f]{32}$/.test(vault.key_fingerprint) ||
    !/^0x[0-9a-f]{40}$/.test(vault.login_wallet_address) ||
    !Number.isSafeInteger(vault.encryption.kdf_params?.iterations) ||
    vault.encryption.kdf_params.iterations < 100_000
  ) {
    throw new Error('PLabs 隐私 vault 格式无效');
  }
  assertKdfIterations(vault.encryption.kdf_params.iterations);
  boundedBase64(vault.encryption.kdf_params.salt, 16, 64, 'Vault salt');
  boundedBase64(vault.encryption.nonce, 12, 12, 'Vault nonce');
  boundedBase64(vault.ciphertext, 17, 65536, 'Vault ciphertext');
  return vault;
};

export const decryptPrivacyVault = async (input: unknown, password: string) => {
  const vault = validatePrivacyVault(input);
  try {
    const key = await deriveKey(
      password,
      base64ToBytes(vault.encryption.kdf_params.salt),
      vault.encryption.kdf_params.iterations,
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBuffer(base64ToBytes(vault.encryption.nonce)) },
      key,
      asBuffer(base64ToBytes(vault.ciphertext)),
    );
    const payload = JSON.parse(decoder.decode(plaintext)) as {
      seed_hex?: string;
      protocol?: string;
      birthday_blocks?: Record<string, unknown>;
    };
    if (payload.protocol !== PROTOCOL || !payload.seed_hex) throw new Error('隐私 vault 协议不匹配');
    const seedHex = normalizeHex(payload.seed_hex);
    if ((await privacyFingerprint(seedHex)) !== vault.key_fingerprint) {
      throw new Error('隐私 vault 指纹不匹配');
    }
    const birthdayBlocks = Object.fromEntries(
      Object.entries(payload.birthday_blocks ?? {})
        .map(([chainId, block]) => [Number(chainId), Number(block)] as const)
        .filter(
          ([chainId, block]) =>
            [1, 143, 8453, 42161].includes(chainId) &&
            Number.isSafeInteger(block) &&
            block >= 0,
        )
        .map(([chainId, block]) => [chainId, { number: block, hash: '' }]),
    ) as Partial<Record<ChainId, { number: number; hash: string }>>;
    return { vault, seedHex, birthdayBlocks, payload };
  } catch (error) {
    if (error instanceof Error && /协议|指纹/.test(error.message)) throw error;
    throw new Error('隐私账户密码错误或 vault 已损坏');
  }
};

const officialStateKey = async (seedHex: string) => {
  const seed = hexToBytes(seedHex);
  const context = encoder.encode(OFFICIAL_STATE_CONTEXT);
  const material = new Uint8Array(context.length + seed.length);
  material.set(context);
  material.set(seed, context.length);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
};

export const decryptOfficialWalletState = async ({
  seedHex,
  vault,
  state,
  privacyAddress,
}: {
  seedHex: string;
  vault: PrivacyVault;
  state: OfficialPrivacyWalletState;
  privacyAddress: string;
}) => {
  if (
    !state ||
    state.vault_id !== vault.vault_id ||
    state.key_fingerprint !== vault.key_fingerprint ||
    state.encryption?.algorithm !== 'aes-256-gcm' ||
    typeof state.ciphertext !== 'string' ||
    typeof state.encryption.nonce !== 'string'
  ) {
    throw new Error('官网钱包状态与导入 vault 不匹配');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBuffer(base64ToBytes(state.encryption.nonce)) },
      await officialStateKey(seedHex),
      asBuffer(base64ToBytes(state.ciphertext)),
    );
    const envelope = JSON.parse(decoder.decode(plaintext)) as {
      version?: number;
      privacy_address?: string;
      payload?: unknown;
    };
    if (
      envelope.version !== 1 ||
      envelope.privacy_address !== state.privacy_address ||
      !envelope.payload ||
      typeof envelope.payload !== 'object'
    ) {
      throw new Error('官网钱包状态格式无效');
    }
    const expectedRaw = parsePrivacyAddress(privacyAddress);
    const stateRaw = parsePrivacyAddress(state.privacy_address);
    if (stateRaw !== expectedRaw) {
      throw new Error('官网钱包状态不属于当前隐私账户');
    }
    return envelope.payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && /格式|不匹配|不属于/.test(error.message)) throw error;
    throw new Error('官网钱包同步状态无法解密或已损坏');
  }
};
