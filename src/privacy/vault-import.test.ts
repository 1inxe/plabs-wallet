import { describe, expect, it } from 'vitest';
import { createPrivacyVault, decryptPrivacyVault } from './vault';
import { isSamePrivacyAccount, parseVaultImport, vaultImportConfirmation } from './vault-import';
import type { PrivacyAccountRecord } from '../shared/types';

const owner = `0x${'ab'.repeat(20)}`;
const other = `0x${'cd'.repeat(20)}`;
const password = 'private password 42!';
const fixture = async () => {
  const { vault, stateEncryption } = await createPrivacyVault({ password, walletAddress: owner });
  const existing: PrivacyAccountRecord = {
    version: 1, vault, stateEncryption, privacyAddress: `0x${'12'.repeat(43)}`,
    rawAddressHex: '12'.repeat(43), birthdayBlocks: { 1: { number: 100, hash: 'checkpoint' } },
    recoveryMode: 'birthday', createdAt: '2026-01-01',
  };
  return { vault, existing };
};

describe('official vault import', () => {
  it('selects the current wallet from an official array regardless of order or address case', async () => {
    const { vault } = await fixture();
    const unrelated = { ...vault, login_wallet_address: other };
    const result = parseVaultImport(JSON.stringify([unrelated, vault]), owner.toUpperCase());
    expect(result.vault).toEqual(vault);
    await expect(decryptPrivacyVault(result.vault, password)).resolves.toHaveProperty('seedHex');
    await expect(decryptPrivacyVault(result.vault, 'wrong')).rejects.toThrow('密码错误');
  });
  it('accepts single vaults and the existing checkpoint envelope', async () => {
    const { vault } = await fixture();
    const single = parseVaultImport(vault, owner);
    expect(parseVaultImport(single, owner)).toEqual(single);
    expect(parseVaultImport({ ...single, walletState: { ciphertext: 'state' } }, owner).walletState).toEqual({ ciphertext: 'state' });
  });
  it('rejects absent and ambiguous wallet matches without choosing the first item', async () => {
    const { vault } = await fixture();
    expect(() => parseVaultImport([vault], other)).toThrow('没有属于当前');
    expect(() => parseVaultImport(vault, other)).toThrow('不属于当前');
    expect(() => parseVaultImport([vault, { ...vault, vault_id: 'second' }], owner)).toThrow('多个');
    expect(() => parseVaultImport([], owner)).toThrow('没有属于当前');
  });
  it('reports malformed JSON, matching invalid entries, and oversized input', async () => {
    expect(() => parseVaultImport('{', owner)).toThrow('JSON 格式无效');
    expect(() => parseVaultImport(' '.repeat(1_000_001), owner)).toThrow('过大');
    expect(() => parseVaultImport([{ login_wallet_address: owner }], owner)).toThrow('格式无效');
  });
  it('requires both the verified fingerprint and derived address for duplicate detection', async () => {
    const { vault, existing } = await fixture();
    expect(isSamePrivacyAccount(existing, vault.key_fingerprint, existing.rawAddressHex)).toBe(true);
    expect(isSamePrivacyAccount(existing, vault.key_fingerprint, '34'.repeat(43))).toBe(false);
    expect(isSamePrivacyAccount(existing, `fp_${'00'.repeat(16)}`, existing.rawAddressHex)).toBe(false);
  });
  it('invalidates replacement confirmation when the target, current record, or incoming data changes', async () => {
    const { vault, existing } = await fixture();
    const incoming = parseVaultImport(vault, owner);
    const confirmation = await vaultImportConfirmation(owner, existing, incoming);
    expect(await vaultImportConfirmation(owner, existing, incoming)).toBe(confirmation);
    expect(await vaultImportConfirmation(other, existing, incoming)).not.toBe(confirmation);
    expect(await vaultImportConfirmation(owner, { ...existing, stateEncryption: { ...existing.stateEncryption, salt: 'changed' } }, incoming)).not.toBe(confirmation);
    expect(await vaultImportConfirmation(owner, existing, { ...incoming, vault: { ...vault, ciphertext: 'changed' } })).not.toBe(confirmation);
  });
});
