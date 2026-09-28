import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const profile=await mkdtemp(path.join(os.tmpdir(),'plabs-privacy-read-'));
const executable=process.env.CHROME_BIN??'/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,args:[`--disable-extensions-except=${path.resolve('dist')}`,`--load-extension=${path.resolve('dist')}`]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const extensionId=new URL(worker.url()).hostname;
 // Stub chain reads only inside this disposable extension test process. No live transactions or accounts.
 await worker.evaluate(()=>{globalThis.fetch=async(_url,init)=>{if(String(_url).includes('/dex-matcher/')){const result=String(_url).endsWith('/healthz')?{chain_id:143,matches_epoch:'epoch-1'}:{orders:[{order_id:'a'.repeat(32),matched_qty:0,pending_qty:0,remaining_qty:10000000}]};return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});}const body=JSON.parse(typeof init?.body==='string'?init.body:init?.body?new TextDecoder().decode(init.body):'{}');const one=request=>({jsonrpc:'2.0',id:request.id,result:request.method==='eth_chainId'?'0x8f':request.method==='eth_getBalance'?'0x1bc16d674ec80000':request.method==='eth_getCode'?'0x':request.method==='eth_blockNumber'?'0x1':'0x'});return new Response(JSON.stringify(Array.isArray(body)?body.map(one):one(body)),{headers:{'content-type':'application/json'}});};});
 const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
 const raw=(action,args={})=>popup.evaluate(message=>chrome.runtime.sendMessage(message),{action,...args});
 const call=async(action,args)=>{const response=await raw(action,args);assert(response.ok,response.error?.message);return response.result;};
 const password='temporary read smoke 42!';
 const created=await call('CREATE_WALLET',{password});await call('CONFIRM_WALLET_BACKUP',{accountId:created.state.activeAccountId,confirmed:true});
 const {build}=await import('vite').then(async()=>{const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);return createRequire(require.resolve('vite/package.json'))('esbuild');});
 const helper=path.join(profile,'vault-helper.mjs');await build({entryPoints:[path.resolve('src/privacy/vault.ts')],bundle:true,platform:'node',format:'esm',outfile:helper});
 const {createPrivacyVault}=await import(new URL(`file://${helper}`).href);
 const privacyPassword='temporary privacy read 42!';
 const {vault}=await createPrivacyVault({password:privacyPassword,walletAddress:created.state.address});
 await call('IMPORT_PRIVACY_VAULT',{vault,password:privacyPassword});
 const site=await context.newPage();await site.route('https://app.plabs.online/**',route=>route.fulfill({contentType:'text/html',body:'<html><body>PLabs read protocol smoke</body></html>'}));await site.goto('https://app.plabs.online/');await site.waitForFunction(()=>window.plabsPrivacyWallet);
 const request=(method,params)=>site.evaluate(async({method,params})=>{try{return {ok:true,result:await window.plabsPrivacyWallet.request({method,params})};}catch(error){return {ok:false,code:error.code,message:error.message};}},{method,params});
 const pending=request('eth_requestAccounts');
 let approval;
 for(let i=0;i<60;i++){const state=await call('GET_DAPP_UI_STATE');if(state?.approval){approval=state.approval;break;}await new Promise(r=>setTimeout(r,100));}
 assert(approval);await call('APPROVAL_DECISION',{id:approval.id,approved:true});assert((await pending).ok);
 const capabilities=(await request('plabs_getCapabilities')).result;assert.equal(capabilities.methods.privacyRead,true);assert.equal(capabilities.methods.dexTrading,true);
 const session=await request('plabs_getPrivacySession');assert.deepEqual(session.result.scopes,[]);assert.equal(session.result.address,undefined);
 for(const method of ['plabs_getBalances','plabs_getHistory','plabs_getNotes','plabs_getDexOrders'])assert.equal((await request(method)).ok,false,`${method} must reject without unlocked privacy and disclosure approval`);
 const authorize=request('plabs_requestPrivacyAccess',[{scopes:['balances','history','notes','dexOrders']}]);
 approval=undefined;
 for(let i=0;i<60;i++){const state=await call('GET_DAPP_UI_STATE');if(state?.approval){approval=state.approval;break;}await new Promise(r=>setTimeout(r,100));}
 assert(approval);assert.equal(approval.title,'授权网站读取钱包数据');await call('APPROVAL_DECISION',{id:approval.id,approved:true});
 const granted=await authorize;assert(granted.ok,granted.message);assert.match(granted.result.address,/^perc1/);
 const portfolio=await request('plabs_getBalances');assert(portfolio.ok,portfolio.message);assert.equal(portfolio.result.public.assets[0].balanceRaw,'2000000000000000000');assert.equal(portfolio.result.private.assets[0].totalRaw,null,'Unscanned pools must not be called zero');
 assert((await request('plabs_getHistory',[{page:1,pageSize:20}])).ok);assert((await request('plabs_getNotes',[{page:1,pageSize:20}])).ok);
 const orders=await request('plabs_getDexOrders');assert(orders.ok,orders.message);assert.equal(orders.result.needsImport,true);
 await site.evaluate(address=>localStorage.setItem(`perc20.dex.orders.${address.toLowerCase()}`,JSON.stringify({1:{orderId:'a'.repeat(32),side:'sell',type:'limit',qty:10000000,price:1400,ts:1,epoch:'epoch-1',vnote:{seed:'do-not-copy'},matchSubscriptions:[{capability:'do-not-copy'}]}})),granted.result.address);
 const importing=request('plabs_importOfficialDexOrders');approval=undefined;
 for(let i=0;i<60;i++){const state=await call('GET_DAPP_UI_STATE');if(state?.approval){approval=state.approval;break;}await new Promise(r=>setTimeout(r,100));}
 assert(approval);await call('APPROVAL_DECISION',{id:approval.id,approved:true});const imported=await importing;assert(imported.ok,imported.message);assert.equal(imported.result.imported,1);
 const orderRead=await request('plabs_getDexOrders');assert(orderRead.ok,orderRead.message);assert.equal(orderRead.result.orders[0].status,'open');assert(!JSON.stringify(orderRead).includes('do-not-copy'));
 const serialized=JSON.stringify(portfolio.result);for(const name of ['seed','ivk','nullifier','rawNote'])assert(!serialized.includes(name));
 await request('plabs_revokePrivacyAccess');assert.equal((await request('plabs_getBalances')).code,4100);
 await call('LOCK_PRIVACY');assert.deepEqual((await request('plabs_getPrivacySession')).result.scopes,[]);

 console.log('Real extension bridge passed: EVM connection, explicit privacy scopes, balances/history/notes, empty-order migration state, revocation and privacy lock. Disposable test vault only; no signatures or transactions.');
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
