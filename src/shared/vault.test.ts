import { describe, expect, it } from 'vitest';
import { decryptMnemonic, encryptMnemonic, walletFromMnemonic } from './vault';

const PHRASE = 'test test test test test test test test test test test junk';

describe('encrypted wallet vault', () => {
  it('round-trips a mnemonic without storing plaintext', async () => {
    const vault = await encryptMnemonic(PHRASE, 'correct horse 42!');
    expect(vault.ciphertext).not.toContain('test');
    expect(vault.address).toBe(walletFromMnemonic(PHRASE).address);
    await expect(decryptMnemonic(vault, 'correct horse 42!')).resolves.toBe(PHRASE);
  });

  it('rejects an incorrect password', async () => {
    const vault = await encryptMnemonic(PHRASE, 'correct horse 42!');
    await expect(decryptMnemonic(vault, 'incorrect horse 42!')).rejects.toThrow('密码错误');
  });
});

describe('private-key wallet vault', () => {
  it('encrypts private keys and preserves the signing identity after reload', async () => {
    const { Wallet, verifyMessage } = await import('ethers');
    const { encryptPrivateKey, decryptWalletSecret, walletFromSecret } = await import('./vault');
    const privateKey = '0x' + '01'.repeat(32);
    const vault = await encryptPrivateKey(privateKey, 'correct horse 42!');
    expect(vault.secretType).toBe('privateKey');
    expect(JSON.stringify(vault)).not.toContain(privateKey);
    const secret = await decryptWalletSecret(vault, 'correct horse 42!');
    const wallet = walletFromSecret(secret);
    expect(wallet.address).toBe(new Wallet(privateKey).address);
    expect(verifyMessage('round trip', await wallet.signMessage('round trip'))).toBe(wallet.address);
    await expect(decryptWalletSecret(vault, 'wrong password')).rejects.toThrow('密码错误');
    await expect(decryptMnemonic(vault, 'correct horse 42!')).rejects.toThrow('没有助记词');
    await expect(decryptWalletSecret({ ...vault, address: '0x0000000000000000000000000000000000000001' }, 'correct horse 42!')).rejects.toThrow();
  });
  it('rejects malformed and out-of-range private keys', async () => {
    const { encryptPrivateKey } = await import('./vault');
    expect(() => encryptPrivateKey('abc', 'correct horse 42!')).toThrow('私钥');
    await expect(encryptPrivateKey('0'.repeat(64), 'correct horse 42!')).rejects.toThrow();
  });
});
