import { assertKdfIterations, boundedBase64 } from './vault-limits';
import { HDNodeWallet, Mnemonic, Wallet, randomBytes } from 'ethers';
import { base64ToBytes, bytesToBase64 } from './encoding';
import type { EncryptedVault } from './types';

const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const asBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

const deriveKey = async (password: string, salt: Uint8Array, iterations = ITERATIONS) => {
  assertKdfIterations(iterations);
  if (salt.length < 16 || salt.length > 64) throw new Error('Vault salt 长度无效');
  const source = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asBuffer(salt), iterations },
    source,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

export const assertStrongPassword = (password: string) => {
  if (password.length < 10) throw new Error('密码至少需要 10 个字符');
  const groups = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((rule) => rule.test(password));
  if (groups.length < 2) throw new Error('密码需包含字母、数字、符号中的至少两类');
};

export const createMnemonic = (): string => HDNodeWallet.createRandom().mnemonic?.phrase ?? '';

export const walletFromMnemonic = (phrase: string): HDNodeWallet => {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!Mnemonic.isValidMnemonic(normalized)) throw new Error('助记词无效');
  return HDNodeWallet.fromPhrase(normalized);
};

const encryptSecret = async (secret: string, password: string, secretType: 'mnemonic' | 'privateKey'): Promise<EncryptedVault> => {
  assertStrongPassword(password);
  const wallet = secretType === 'privateKey' ? new Wallet(secret) : walletFromMnemonic(secret);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBuffer(iv) },
    key,
    encoder.encode(secretType === 'privateKey' ? wallet.privateKey : walletFromMnemonic(secret).mnemonic!.phrase),
  );
  return {
    version: 1,
    ...(secretType === 'privateKey' ? { secretType } : {}),
    address: wallet.address as `0x${string}`,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: ITERATIONS,
    createdAt: new Date().toISOString(),
  };
};

export const decryptWalletSecret = async (vault: EncryptedVault, password: string): Promise<string> => {
  try {
    boundedBase64(vault.iv, 12, 12, 'Vault nonce');
    boundedBase64(vault.ciphertext, 17, 65536, 'Vault ciphertext');
    const key = await deriveKey(password, boundedBase64(vault.salt, 16, 64, 'Vault salt'), vault.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBuffer(base64ToBytes(vault.iv)) },
      key,
      asBuffer(base64ToBytes(vault.ciphertext)),
    );
    const phrase = decoder.decode(plaintext);
    const wallet = vault.secretType === 'privateKey' ? new Wallet(phrase) : walletFromMnemonic(phrase);
    if (wallet.address.toLowerCase() !== vault.address.toLowerCase()) {
      throw new Error('地址校验失败');
    }
    return phrase;
  } catch {
    throw new Error('密码错误或钱包数据已损坏');
  }
};

export const encryptMnemonic = (phrase: string, password: string) => encryptSecret(phrase, password, 'mnemonic');
export const encryptPrivateKey = (privateKey: string, password: string) => {
  const normalized = privateKey.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) throw new Error('私钥必须是 64 位十六进制字符');
  return encryptSecret(`0x${normalized}`, password, 'privateKey');
};
export const walletFromSecret = (secret: string): HDNodeWallet | Wallet => /^0x[0-9a-fA-F]{64}$/.test(secret) ? new Wallet(secret) : walletFromMnemonic(secret);
export const decryptMnemonic = async (vault: EncryptedVault, password: string) => {
  if (vault.secretType === 'privateKey') throw new Error('该账户由私钥导入，没有助记词');
  return decryptWalletSecret(vault, password);
};
