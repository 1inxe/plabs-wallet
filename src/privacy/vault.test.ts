import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../shared/encoding';
import type { OfficialPrivacyWalletState } from '../shared/types';
import {
  createPrivacyVault,
  decryptOfficialWalletState,
  decryptPrivacyVault,
  validatePrivacyVault,
} from './vault';

const WALLET = '0x000000000000000000000000000000000000dEaD';

describe('privacy vault', () => {
  it('uses an independent encrypted seed and verifies its fingerprint', async () => {
    const { seedHex, vault, stateEncryption } = await createPrivacyVault({
      password: 'privacy password 73!',
      walletAddress: WALLET,
    });
    expect(seedHex).toMatch(/^[0-9a-f]{64}$/);
    expect(vault.ciphertext).not.toContain(seedHex);
    expect(vault.login_wallet_address).toBe(WALLET.toLowerCase());
    expect(stateEncryption.salt).not.toBe(vault.encryption.kdf_params.salt);
    await expect(decryptPrivacyVault(vault, 'privacy password 73!')).resolves.toMatchObject({
      seedHex,
    });
  });

  it('does not unlock with the EVM wallet password', async () => {
    const { vault } = await createPrivacyVault({
      password: 'privacy password 73!',
      walletAddress: WALLET,
    });
    await expect(decryptPrivacyVault(vault, 'evm wallet password 42!')).rejects.toThrow(
      '隐私账户密码错误',
    );
  });

  it('rejects a malformed imported vault before decryption', () => {
    expect(() => validatePrivacyVault({ version: 1, protocol: 'privacybtc_orchard' })).toThrow(
      'vault 格式无效',
    );
  });

  it('accepts an official checkpoint only for its matching vault and privacy address', async () => {
    const { seedHex, vault } = await createPrivacyVault({
      password: 'privacy password 73!',
      walletAddress: WALLET,
    });
    const privacyAddress = `0x${'12'.repeat(43)}`;
    const encoder = new TextEncoder();
    const context = encoder.encode('PrivacyBTC wallet state key v1');
    const seed = Uint8Array.from(seedHex.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16));
    const material = new Uint8Array(context.length + seed.length);
    material.set(context);
    material.set(seed, context.length);
    const key = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.digest('SHA-256', material),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const payload = { scan_version: 2, owned_notes: [], sync_state: {} };
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      encoder.encode(JSON.stringify({ version: 1, privacy_address: privacyAddress, payload })),
    );
    const state: OfficialPrivacyWalletState = {
      state_id: `${vault.vault_id}:${privacyAddress}`,
      vault_id: vault.vault_id,
      key_fingerprint: vault.key_fingerprint,
      privacy_address: privacyAddress,
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      encryption: { algorithm: 'aes-256-gcm', nonce: bytesToBase64(nonce) },
      updated_at: new Date().toISOString(),
    };

    await expect(
      decryptOfficialWalletState({ seedHex, vault, state, privacyAddress }),
    ).resolves.toEqual(payload);
    await expect(
      decryptOfficialWalletState({
        seedHex,
        vault,
        state: { ...state, vault_id: 'vault_other' },
        privacyAddress,
      }),
    ).rejects.toThrow('不匹配');
  });
});
