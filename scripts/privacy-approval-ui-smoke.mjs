import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const profile=await mkdtemp(path.join(os.tmpdir(),'plabs-privacy-approval-ui-'));
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

 await worker.evaluate(()=>{chrome.action.openPopup=async()=>{throw new Error('Forced toolbar popup rejection for regression test');};});
 const site=await context.newPage();site.on('pageerror',error=>console.log('Page error:',error.message));await site.goto('http://127.0.0.1:5180/pex');
 async function approvalSurface(){
  for(let i=0;i<100;i++){const page=context.pages().find(page=>page!==popup&&page.url().startsWith(`chrome-extension://${extensionId}/popup.html`));if(page)return page;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('No fallback approval window opened');
 }
 await site.getByRole('button',{name:'Connect wallet',exact:true}).first().click();
 const connectButton=site.getByRole('dialog').getByRole('button',{name:'Connect PLabs Wallet',exact:true});
 await connectButton.click();
 const approval=await approvalSurface();await approval.getByText('连接网站并授权读取钱包数据',{exact:true}).waitFor();
 await approval.getByRole('button',{name:'拒绝',exact:true}).click();
 await connectButton.waitFor();await connectButton.click();await approval.getByText('连接网站并授权读取钱包数据',{exact:true}).waitFor();await approval.getByRole('button',{name:'确认',exact:true}).click();
 await site.getByRole('dialog').waitFor({state:'hidden'});await site.locator('.wallet-button').click();
 await site.getByRole('dialog').getByRole('region',{name:'Public assets',exact:true}).getByText('MON',{exact:true}).waitFor();
 assert.equal((await call('GET_DAPP_UI_STATE')).approval,undefined,'No second read approval should follow connection');
 const scopes=await site.evaluate(()=>window.plabsPrivacyWallet.request({method:'plabs_getPrivacySession'}));assert.equal(scopes.scopes.length,5);
 await call('LOCK_PRIVACY');const authorize=site.getByRole('dialog').getByRole('button',{name:'Authorize balances & history',exact:true});await authorize.waitFor();await authorize.click();
 await approval.getByPlaceholder('输入独立隐私密码').fill(privacyPassword);await approval.getByRole('button',{name:'解锁并继续',exact:true}).click();
 await site.getByRole('dialog').getByRole('region',{name:'Public assets',exact:true}).getByText('MON',{exact:true}).waitFor();
 assert.equal((await call('GET_DAPP_UI_STATE')).approval,undefined,'Unlock should restore remembered read access without approval');
 assert.equal(context.pages().filter(page=>page!==popup&&page.url().startsWith(`chrome-extension://${extensionId}/popup.html`)).length,1,'Reuse the fallback wallet window');
 console.log('Real frontend + extension: one combined approval, rejection/retry, all read views available, wallet unlock restores consent without another approval. Isolated wallet; no live transactions.');

}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
