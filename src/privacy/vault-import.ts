import type { OfficialPrivacyImport, PrivacyAccountRecord } from '../shared/types';
import { MAX_VAULT_JSON_CHARS } from '../shared/vault-limits';
import { validatePrivacyVault } from './vault';

export type VaultImportResult =
  | { status: 'already_imported' }
  | { status: 'confirmation_required'; confirmation: string; currentAddress: string; incomingAddress: string }
  | { status: 'imported'; warning?: string };

export function parseVaultImport(input: unknown, walletAddress: string): OfficialPrivacyImport {
  const encoded = typeof input === 'string' ? input : JSON.stringify(input);
  if (!encoded || encoded.length > MAX_VAULT_JSON_CHARS) throw new Error('导入文件过大（最多 1 MB），请单独导出 Vault');
  let parsed;
  try { parsed = JSON.parse(encoded); } catch { throw new Error('Vault JSON 格式无效，请选择完整的 JSON 文件'); }
  if (Array.isArray(parsed)) {
    const matches = parsed.filter(item => typeof item?.login_wallet_address === 'string' &&
      item.login_wallet_address.toLowerCase() === walletAddress.toLowerCase());
    if (!matches.length) throw new Error('文件中没有属于当前 EVM 钱包的 Vault，请切换到对应钱包');
    if (matches.length > 1) throw new Error('文件中有多个属于当前钱包的 Vault，请单独导出需要恢复的 Vault');
    parsed = matches[0];
  }
  const envelope = parsed?.schema === 'brush-plabs-official-import/v1' ? parsed : null;
  const vault = validatePrivacyVault(envelope?.vault ?? parsed);
  if (vault.login_wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error('该隐私 vault 不属于当前 EVM 钱包');
  }
  return { schema: 'brush-plabs-official-import/v1', vault, ...(envelope?.walletState ? { walletState: envelope.walletState } : {}) };
}

// Compare only after decrypting and deriving the incoming address. An untrusted
// fingerprint in JSON alone is not proof that this is the same account.
export function isSamePrivacyAccount(existing: PrivacyAccountRecord, fingerprint: string, rawAddressHex: string) {
  return existing.vault.key_fingerprint === fingerprint && existing.rawAddressHex.toLowerCase() === rawAddressHex.toLowerCase();
}

export async function vaultImportConfirmation(walletAddress: string, existing: PrivacyAccountRecord, incoming: OfficialPrivacyImport) {
  const bytes = new TextEncoder().encode(JSON.stringify([walletAddress.toLowerCase(), existing, incoming]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
