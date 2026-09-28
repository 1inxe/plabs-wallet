import type { PrivacyReadScope, PrivacySession, WalletPortfolio, PrivacyHistoryPage, PrivacyPageParams, PrivacyNotes, DexOrders, DexOrderIntent, DexOrderSummary } from '../../types.js';
import { BaseAPI } from '../../base-api.js';
import { invalid, privacyAddress, privacyParams } from '../../validation.js';
import type { PlabsPrivacyPoolParams, PlabsPrivacySendParams, PrivacyAddress, PrivacyTransactionResult } from '../../types.js';
export class PrivacyAPI extends BaseAPI {
  requestAccess(scopes: PrivacyReadScope[]): Promise<PrivacySession> {
    if (!Array.isArray(scopes) || !scopes.length || scopes.length > 5 || scopes.some(scope => !['address', 'balances', 'history', 'notes', 'dexOrders'].includes(scope))) invalid('Select supported privacy read scopes.');
    return this.request('plabs_requestPrivacyAccess', [{ scopes: [...new Set(scopes)] }]);
  }
  getSession(): Promise<PrivacySession> { return this.request('plabs_getPrivacySession'); }
  revokeAccess(): Promise<void> { return this.request('plabs_revokePrivacyAccess'); }
  getBalances(): Promise<WalletPortfolio> { return this.request('plabs_getBalances'); }
  getHistory(params: PrivacyPageParams = {}): Promise<PrivacyHistoryPage> { return this.request('plabs_getHistory', [readPage(params)]); }
  getNotes(params: PrivacyPageParams = {}): Promise<PrivacyNotes> { return this.request('plabs_getNotes', [readPage(params)]); }
  getDexOrders(): Promise<DexOrders> { return this.request('plabs_getDexOrders'); }
  importOfficialDexOrders(): Promise<{ imported: number }> { return this.request('plabs_importOfficialDexOrders'); }
  /** Wallet proves and funds a VNote after two independent approvals. No keys leave the extension. */
  placeDexOrder(intent: DexOrderIntent): Promise<DexOrderSummary> {
    if (!intent || typeof intent !== 'object' || Object.keys(intent).some(k => !['chainId','side','type','quantityRaw','priceTicks','maxFeeRaw'].includes(k)) || intent.chainId !== '0x8f' || !['buy','sell'].includes(intent.side) || !['limit','market'].includes(intent.type)) invalid('Invalid PEX order intent.');
    for (const v of [intent.quantityRaw,intent.priceTicks,intent.maxFeeRaw]) if (typeof v !== 'string' || !/^\d{1,16}$/.test(v) || BigInt(v) <= 0n || BigInt(v) > BigInt(Number.MAX_SAFE_INTEGER)) invalid('Invalid PEX integer amount.');
    return this.request('plabs_placeDexOrder', [intent]);
  }
  resumeDexOrder(id: string): Promise<DexOrderSummary> { return this.dexAction('plabs_resumeDexOrder', id); }
  cancelDexOrder(id: string): Promise<DexOrderSummary> { return this.dexAction('plabs_cancelDexOrder', id); }
  collectDexPayouts(id: string): Promise<DexOrderSummary> { return this.dexAction('plabs_collectDexPayouts', id); }
  private dexAction(method: string, id: string): Promise<DexOrderSummary> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) invalid('A local PEX order ID returned by this wallet is required.');
    return this.request(method, [id]);
  }

  /** Separate disclosure approval; EVM connection alone never shares this address. */
  getAddress(): Promise<PrivacyAddress> { return this.request('plabs_getPrivacyAddress'); }
  /** Requests authorization, proving, final confirmation and submission in the wallet. */
  async sendTransaction(params: PlabsPrivacySendParams): Promise<PrivacyTransactionResult> {
    const normalized = privacyParams(params, true);
    return this.request('plabs_sendPrivacyTransaction', [{ ...normalized, kind: 'send', recipient: privacyAddress(params.to) }]);
  }
  async shield(params: PlabsPrivacyPoolParams): Promise<PrivacyTransactionResult> {
    return this.request('plabs_sendPrivacyTransaction', [{ ...privacyParams(params), kind: 'shield' }]);
  }
  async unshield(params: PlabsPrivacyPoolParams): Promise<PrivacyTransactionResult> {
    return this.request('plabs_sendPrivacyTransaction', [{ ...privacyParams(params), kind: 'unshield' }]);
  }
  /** Only requests created by this origin/account in the current browser session. */
  async getTransactionStatus(id: string): Promise<PrivacyTransactionResult> {
    if (typeof id !== 'string' || !id || id.length > 256) invalid('An operation id returned by this wallet is required.');
    return this.request('plabs_getTransactionStatus', [id]);
  }
}

function readPage(params: PrivacyPageParams) {
  if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => !['page', 'pageSize', 'poolAddress'].includes(key))) invalid('Invalid read pagination.');
  const page = params.page ?? 1, pageSize = params.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || ![10,20,50].includes(pageSize)) invalid('Invalid read pagination.');
  if (params.poolAddress !== undefined && !/^0x[0-9a-f]{40}$/i.test(params.poolAddress)) invalid('Invalid pool address.');
  return { page, pageSize, ...(params.poolAddress ? { poolAddress: params.poolAddress } : {}) };
}
