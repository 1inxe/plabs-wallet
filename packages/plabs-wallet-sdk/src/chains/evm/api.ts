import { BaseAPI } from '../../base-api.js';
import { PlabsWalletError, PLABS_ERROR_CODES } from '../../errors.js';
import { evmAddress, invalid, toChainHex, utf8Hex } from '../../validation.js';
import type { ChainIdInput, EvmTransactionPreview, EvmTransactionRequest, HexChainId, WalletPermission } from '../../types.js';
export class EvmAPI extends BaseAPI {
  /** Opens the wallet approval popup. Call from a deliberate user action. */
  connect(): Promise<string[]> { return this.request('eth_requestAccounts'); }
  /** Silent: does not open the wallet; returns [] when unauthorized or locked. */
  getAccounts(): Promise<string[]> { return this.request('eth_accounts'); }
  getChainId(): Promise<HexChainId> { return this.request('eth_chainId'); }
  getPermissions(): Promise<WalletPermission[]> { return this.request('wallet_getPermissions'); }
  requestPermissions(): Promise<WalletPermission[]> { return this.request('wallet_requestPermissions', [{ eth_accounts: {} }]); }
  async disconnect(): Promise<void> { await this.request('wallet_revokePermissions', [{ eth_accounts: {} }]); }
  async switchChain(chainId: ChainIdInput): Promise<void> { await this.request('wallet_switchEthereumChain', [{ chainId: toChainHex(chainId) }]); }
  /** EVM personal_sign, not a privacy-identity or privacy-spending signature. */
  async signMessage(message: string, address?: string): Promise<string> {
    const encoded = utf8Hex(message);
    const signer = address ?? (await this.getAccounts())[0];
    if (!signer) throw new PlabsWalletError('Connect an EVM account before signing.', PLABS_ERROR_CODES.UNAUTHORIZED);
    return this.request('personal_sign', [encoded, evmAddress(signer)]);
  }
  /** Explicitly a preview: no transaction signature or broadcast is produced. */
  async previewTransaction(tx: EvmTransactionRequest): Promise<EvmTransactionPreview> {
    if (!tx || typeof tx !== 'object' || Array.isArray(tx)) invalid('A transaction preview object is required.');
    if (Object.keys(tx).some(key => !['from', 'to', 'value', 'data', 'chainId'].includes(key))) invalid('Unsupported transaction preview fields.');
    evmAddress(tx.from, 'from'); evmAddress(tx.to, 'to');
    if (typeof tx.value !== 'string' || !/^0x[0-9a-f]+$/i.test(tx.value) || tx.value.length > 66) invalid('value must be a hexadecimal uint256 quantity.');
    if (tx.data !== undefined && (typeof tx.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(tx.data) || tx.data.length > 32770)) invalid('data must be a bounded hexadecimal byte string.');
    return this.request('plabs_previewTransaction', [{ ...tx, ...(tx.chainId === undefined ? {} : { chainId: toChainHex(tx.chainId) }) }]);
  }
}
