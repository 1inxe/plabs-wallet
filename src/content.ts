import type { ProviderRequest, ProviderResponse } from './shared/types';

let requestsThisMinute = 0;
let requestWindowStarted = Date.now();

const postProviderResponse = (payload: ProviderResponse) => window.postMessage(payload, window.location.origin);
window.addEventListener('message', (event) => {
  const request = event.data as ProviderRequest;
  if (event.source !== window || event.origin !== window.location.origin || request?.source !== 'plabs-wallet-provider' || typeof request.id !== 'string' || typeof request.method !== 'string') return;
  if (Date.now() - requestWindowStarted >= 60_000) { requestWindowStarted = Date.now(); requestsThisMinute = 0; }
  if (++requestsThisMinute > 120) {
    postProviderResponse({ source: 'plabs-wallet-content', id: request.id, error: { code: -32005, message: '请求过于频繁，请稍后重试' } }); return;
  }
  try {
    if (request.id.length > 160 || request.method.length > 80 || JSON.stringify(request).length > 100_000) throw new Error();
  } catch {
    postProviderResponse({ source: 'plabs-wallet-content', id: request.id.slice(0, 160), error: { code: -32602, message: '请求过大或格式无效' } }); return;
  }
  Promise.resolve().then(()=>chrome.runtime.sendMessage({ action: 'DAPP_REQUEST', request })).then(
    (response: { ok: boolean; result?: unknown; error?: { code: number; message: string } }) => {
      postProviderResponse(response?.ok
        ? { source: 'plabs-wallet-content', id: request.id, result: response.result }
        : { source: 'plabs-wallet-content', id: request.id, error: response?.error ?? { code: -32603, message: 'Wallet request failed' } });
    },
  ).catch(() => postProviderResponse({ source: 'plabs-wallet-content', id: request.id, error: { code: 4900, message: '钱包连接已中断；重新加载扩展后请刷新此网站' } }));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'PROVIDER_EVENT' || !Array.isArray(message.allowedOrigins) || !message.allowedOrigins.includes(location.origin)) return;
  window.postMessage({ source: 'plabs-wallet-content', event: message.event, payload: message.payload }, window.location.origin);
});

// Read the top-frame origin from the isolated content script; no tabs/history
// permission is needed just to identify the active connected website.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'GET_ACTIVE_SITE_METADATA' || sender.id !== chrome.runtime.id) return;
  let favicon: string | undefined;
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (icon?.href) {
    try { const url = new URL(icon.href, location.href); if (url.origin === location.origin && /^https?:$/.test(url.protocol)) favicon = url.href; } catch {}
  }
  sendResponse({ origin: location.origin, favicon });
});

const idbResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('官网钱包数据库读取失败'));
  });

const readOfficialPrivacyVaults = async (walletAddress: string) => {
  if (location.origin !== 'https://app.plabs.online') {
    throw new Error('只允许从 PLabs 官网读取 vault');
  }
  if (!/^0x[0-9a-f]{40}$/i.test(walletAddress)) throw new Error('EVM 钱包地址无效');
  if ('databases' in indexedDB) {
    const databases = await indexedDB.databases();
    if (!databases.some((item) => item.name === 'privacybtc_wallet')) {
      return { vaults: [], walletStates: [] };
    }
  }
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('privacybtc_wallet');
    request.onerror = () => reject(request.error ?? new Error('无法打开官网钱包数据库'));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    if (!database.objectStoreNames.contains('seed_vaults')) {
      return { vaults: [], walletStates: [] };
    }
    const vaultStore = database.transaction('seed_vaults', 'readonly').objectStore('seed_vaults');
    const vaults = vaultStore.indexNames.contains('login_wallet_address')
      ? await idbResult(vaultStore.index('login_wallet_address').getAll(walletAddress.toLowerCase()))
      : (await idbResult(vaultStore.getAll())).filter(
          (item: any) => item?.login_wallet_address?.toLowerCase() === walletAddress.toLowerCase(),
        );
    if (!database.objectStoreNames.contains('wallet_states') || vaults.length === 0) {
      return { vaults, walletStates: [] };
    }
    const vaultIds = new Set(vaults.map((item: any) => item?.vault_id).filter(Boolean));
    const stateStore = database.transaction('wallet_states', 'readonly').objectStore('wallet_states');
    const walletStates = (await idbResult(stateStore.getAll())).filter((item: any) =>
      vaultIds.has(item?.vault_id),
    );
    return { vaults, walletStates };
  } finally {
    database.close();
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.action !== 'READ_OFFICIAL_PRIVACY_VAULTS') return false;
  readOfficialPrivacyVaults(String(message.walletAddress ?? ''))
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  return true;
});

// Explicit, one-time migration of display-only order references; never export order capabilities.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.action !== 'READ_OFFICIAL_DEX_REFERENCES') return false;
  try {
    if (location.origin !== 'https://app.plabs.online' || typeof message.rawAddress !== 'string' || !/^[0-9a-f]{86}$/i.test(message.rawAddress) || typeof message.privacyAddress !== 'string' || !/^perc1[0-9a-z]+$/i.test(message.privacyAddress)) throw new Error('只允许从官网读取当前隐私账户的订单引用');
    const source=localStorage.getItem(`perc20.dex.orders.${message.privacyAddress.toLowerCase()}`) ?? localStorage.getItem(`perc20.dex.orders.${message.rawAddress.toLowerCase()}`);
    if(!source){sendResponse({ok:true,records:[]});return false;}
    if(source.length>2_000_000)throw new Error('官网订单恢复记录过大');
    const parsed=JSON.parse(source);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length>200)throw new Error('官网订单恢复记录格式无效');
    const records=Object.values(parsed).flatMap((value:any)=>{
      const orderId=value?.orderId??value?.matchSubscriptions?.[0]?.orderId;
      if(!orderId)return [];
      return [{orderId,side:value.side,type:value.type,qty:value.qty,price:value.price,ts:value.ts,epoch:value.epoch}];
    });
    sendResponse({ok:true,records});
  }catch(error){sendResponse({ok:false,error:error instanceof Error?error.message:'读取失败'});}
  return false;
});
