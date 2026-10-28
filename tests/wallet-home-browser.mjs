import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { browserRuntime } from './browser-runtime.mjs';
const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic wallet home</title><div id="root"></div><script type="module" src="/@id/virtual:wallet-home"></script>';
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite/wallet-home-test',
  plugins: [
    react(),
    {
      name: 'wallet-home-fixture',
      resolveId: (id) =>
        id === 'virtual:wallet-home' ? '\0virtual:wallet-home' : undefined,
      load(id) {
        if (id !== '\0virtual:wallet-home') return;
        return `
import {formatPrivacyAddress} from '/src/privacy/address.ts';
import {syncPrivacyAssets} from '/src/privacy/sync-assets.ts';
const event={addListener(){},removeListener(){}};
const privacyAddress=formatPrivacyAddress('12'.repeat(43));
const address='0x'+'34'.repeat(20),address2='0x'+'56'.repeat(20);
let state={hasVault:true,unlocked:true,address,activeAccountId:'one',accountName:'主账户',accounts:[{id:'one',name:'主账户',address,privacyAddress},{id:'two',name:'备用账户',address:address2,privacyAddress:formatPrivacyAddress('78'.repeat(43))}],chainId:1,networkName:'Ethereum'};
let privacy={hasAccount:true,unlocked:true,privacyAddress,recoveryMode:'birthday',canSync:true,automaticSync:false,expiresAt:Date.now()+3600000,status:'ready'};
const snapshot={version:1,chainId:1,poolAddress:'0x'+'90'.repeat(20),symbol:'P20',decimals:8,privacyAddress,cursorBlock:100,targetBlock:100,syncState:'complete',totalBalanceRaw:'700000000',spendableBalanceRaw:'700000000',totalNotes:2,spendableNotes:2,pendingNotes:0,spentNotes:0,syncedAt:Date.now()};
window.__homeSync={tokens:0,nfts:0,paused:false,failNft:false,phase:'idle',progress:0};
let nftSnapshot={chainId:1,items:[],syncComplete:false,syncedAt:null};
async function syncAll(){
  const run=window.__homeSync;run.phase='tokens';
  try{const result=await syncPrivacyAssets({guard:async()=>{},phase:p=>{run.phase=p;},tokens:async()=>{run.tokens++;return[snapshot];},nfts:async()=>{run.nfts++;if(run.paused)await new Promise(resolve=>{run.release=resolve;});nftSnapshot={...nftSnapshot,syncComplete:!run.failNft,syncedAt:Date.now(),error:run.failNft?'Synthetic NFT outage':undefined};return nftSnapshot;}});run.phase='complete';return{ok:true,result};}
  catch(error){run.phase='error';return{ok:false,error:{message:error.message}};}
}
window.__homeScreen=mode=>{state={...state,hasVault:mode!=='setup',unlocked:mode==='home'};};
window.__homeConnection=null;window.__homeSettingsWrites=[];window.__homeRequests=[];let task=null;window.__homeDecisions=[];
window.__homeApproval=()=>{task={id:'internal-nft-task',origin:'chrome-extension://synthetic/popup.html',method:'wallet_sendPrivateNft',phase:'approval',requiresPrivacy:true,privacyExists:true,privacyUnlocked:true,canCancel:true,createdAt:Date.now(),approval:{id:'internal-nft-approval',origin:'chrome-extension://synthetic/popup.html',kind:'transaction',title:'确认发送 NFT 与 ETH Gas',createdAt:Date.now(),details:{NFT编号:'#7',收款隐私地址:privacyAddress,Gas费用上限:'0.0001 ETH'}}};};
window.chrome={runtime:{getManifest:()=>({version:'0.9.0'}),onMessage:event,async sendMessage(request){window.__homeRequests.push(request.action);let result;switch(request.action){case'GET_STATE':result=state;break;case'GET_PERMISSIONS':result={};break;case'GET_LOCK_SETTINGS':result={walletMinutes:15,privacyMinutes:15};break;case'GET_PRIVACY_STATE':result=privacy;break;case'GET_DAPP_UI_STATE':result=task;break;case'APPROVAL_DECISION':window.__homeDecisions.push(request.approved);task=null;result=true;break;case'GET_ACTIVE_SITE_CONNECTION':result=window.__homeConnection;break;case'SET_LOCK_SETTINGS':window.__homeSettingsWrites.push(request);result=request;break;case'GET_PUBLIC_ASSETS':result=[{type:'native',symbol:'ETH',balanceRaw:'1000000000000000000',formatted:'1',decimals:18,address:null}];break;case'GET_TRANSACTION_SETTINGS':result={experimentalPrivacyWrites:true,privacyPaymentMode:'native',privacyMergeBatchSize:0};break;case'GET_VISIBLE_PRIVACY_ASSETS':result=[];break;case'GET_PRIVACY_SNAPSHOTS':result=[snapshot];break;case'SYNC_PRIVACY':return syncAll();case'GET_PRIVACY_SYNC_PROGRESS':result={chainId:1,progress:window.__homeSync.phase==='nfts'?80:window.__homeSync.phase==='complete'?100:0,status:['complete','error'].includes(window.__homeSync.phase)?window.__homeSync.phase:'syncing',message:window.__homeSync.phase==='nfts'?'正在同步 NFT':'正在同步资产'};break;case'GET_PRIVACY_ACTIVITY':result={items:[],page:1,pages:1,total:0,pageSize:20};break;case'GET_PRIVATE_NFT_ASSETS':result=nftSnapshot;break;case'SWITCH_ACCOUNT':state={...state,activeAccountId:request.accountId,address:address2,accountName:'备用账户'};privacy={...privacy,privacyAddress:state.accounts[1].privacyAddress,unlocked:false};result=state;break;default:throw Error('Unexpected wallet home request '+request.action);}return{ok:true,result};}},tabs:{query:async()=>[],onActivated:event,onUpdated:event},windows:{onFocusChanged:event},storage:{onChanged:event}};
await import('/src/popup/main.tsx');
`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/wallet-home-fixture') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml('/wallet-home-fixture', html));
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const { chromium, executablePath } = await browserRuntime(),
  browser = await chromium.launch({ headless: true, executablePath });
const artifacts = join(tmpdir(), 'plabs-wallet-home-ui');
await mkdir(artifacts, { recursive: true });
try {
  for (const width of [420, 370]) {
    const page = await browser.newPage({ viewport: { width, height: 600 } }),
      errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => {errors.push(e.message);console.error(e.stack);});
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin + '/wallet-home-fixture');
    const nav = page.getByRole('navigation', { name: '钱包导航' });
    const screen = async (name) =>
      nav.getByRole('button', { name, exact: true }).click();
    const shot = async (name) =>
      page.screenshot({
        path: join(artifacts, `${name}-${width}.png`),
        fullPage: true,
      });
    await nav.waitFor();
    await page.waitForFunction(() => window.__homeSync.phase === 'complete');
    assert.equal(
      await page.evaluate(() => window.__homeSync.nfts),
      1,
      'Unlock syncs NFTs without opening the gallery',
    );
    assert.equal(
      await page.evaluate(() =>
        window.__homeRequests.includes('SYNC_PRIVATE_NFT_ASSETS'),
      ),
      false,
    );
    assert.equal(
      await page.locator('.wallet-balance-amount').innerText(),
      '1\nETH',
      'Actual native balance, no invented USD',
    );
    assert.equal(await page.locator('.address-card').count(), 0);
    assert.equal(
      await page
        .getByRole('tab', { name: '公开资产', exact: true })
        .getAttribute('data-state'),
      'active',
    );
    assert.equal(
      await page
        .getByRole('button', { name: '提取', exact: true })
        .isDisabled(),
      true,
      'Ethereum withdrawal remains unavailable',
    );
    await shot('home-public');
    await page.getByRole('button', { name: '接收', exact: true }).click();
    await page.getByRole('heading', { name: '接收', exact: true }).waitFor();
    assert.equal(
      await nav.isVisible(),
      false,
      'Navigation hides during a QR flow',
    );
    assert.equal(await page.locator('.qr-code svg').count(), 1);
    await shot('receive-public');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('heading', { name: '发送', exact: true }).waitFor();
    assert.equal(await page.locator('.send-asset-list button').count(), 1);
    await shot('send-picker');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('tab', { name: '隐私资产', exact: true }).click();
    assert.equal(
      await page.locator('.wallet-balance-amount').innerText(),
      '7\nP20',
    );
    await shot('home-private');
    await page.getByRole('button', { name: '隐藏余额', exact: true }).click();
    assert.equal(
      await page.locator('.wallet-balance-amount strong').innerText(),
      '••••',
    );
    assert.equal(await page.locator('.asset-amount').innerText(), '••••••');
    await page.getByRole('button', { name: '显示余额', exact: true }).click();
    await page.getByRole('button', { name: '接收', exact: true }).click();
    await page
      .getByRole('heading', { name: '接收隐私资产', exact: true })
      .first()
      .waitFor();
    await shot('receive');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await screen('藏品');
    await page
      .getByText('已同步，当前隐私地址暂无 NFT', { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.__homeSync.nfts),
      1,
      'Changing navigation does not rescan',
    );
    await shot('nfts-empty');
    await page.evaluate(() => (window.__homeSync.paused = true));
    await page
      .getByRole('button', { name: '同步隐私资产', exact: true })
      .click();
    await page.waitForFunction(() => window.__homeSync.phase === 'nfts');
    assert.equal(
      await page
        .getByRole('button', { name: '同步隐私资产', exact: true })
        .isDisabled(),
      true,
    );
    await screen('资产');
    assert.equal(
      await page
        .getByRole('button', { name: '同步隐私资产', exact: true })
        .isDisabled(),
      true,
      'In-flight unified scan survives navigation',
    );
    await page.evaluate(() => {
      window.__homeSync.paused = false;
      window.__homeSync.release();
    });
    await page.waitForFunction(
      () =>
        !document.querySelector('button[aria-label="同步隐私资产"]').disabled,
    );
    await page.evaluate(() => (window.__homeSync.failNft = true));
    await page
      .getByRole('button', { name: '同步隐私资产', exact: true })
      .click();
    await page.locator('.sync-notice').waitFor();
    assert.equal(await page.locator('.sync-notice').getAttribute('open'), null);
    assert.equal(
      await page.locator('.sync-notice pre').isVisible(),
      false,
      'Technical errors are collapsed',
    );
    await shot('sync-issue');
    await page.locator('.sync-notice summary').click();
    assert.match(await page.locator('.sync-notice pre').innerText(), /NFT/);
    await page.evaluate(() => (window.__homeSync.failNft = false));
    await page
      .getByRole('button', { name: '同步隐私资产', exact: true })
      .click();
    await page.locator('.sync-notice').waitFor({ state: 'detached' });
    await screen('活动');
    await page.getByText('暂无本机操作记录', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('tab').count(),
      0,
      'History is a single chronological view',
    );
    await shot('activity');
    await screen('设置');
    await page.getByRole('button', { name: '账户', exact: true }).waitFor();
    await shot('settings');
    await page.getByRole('button', { name: '自动锁定', exact: true }).click();
    await page.getByRole('button', { name: '保存设置', exact: true }).waitFor();
    await shot('settings-lock');
    await page.getByRole('tablist',{name:'EVM 自动锁定'}).getByRole('tab',{name:'5m',exact:true}).click();
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByRole('heading',{name:'自动锁定',exact:true}).waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(()=>window.__homeSettingsWrites.map(r=>[r.walletMinutes,r.privacyMinutes])),[[5,15]]);
    assert.equal(await page.evaluate(()=>window.__homeRequests.includes('RENAME_ACCOUNT')),false,'Lock preferences cannot persist unrelated account edits');
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    await screen('藏品');
    for (const decision of [false, true]) {
      await page.evaluate(() => window.__homeApproval());
      await page
        .getByRole('heading', { name: '确认发送 NFT 与 ETH Gas', exact: true })
        .waitFor();
      assert.equal(await nav.isVisible(), false);
      await page
        .getByRole('button', {
          name: decision ? '确认发送' : '取消发送',
          exact: true,
        })
        .click();
      await page
        .getByRole('heading', { name: '确认发送 NFT 与 ETH Gas', exact: true })
        .waitFor({ state: 'hidden' });
      assert.equal(
        await nav
          .getByRole('button', { name: '藏品', exact: true })
          .getAttribute('aria-current'),
        'page',
      );
    }
    assert.deepEqual(await page.evaluate(() => window.__homeDecisions), [
      false,
      true,
    ]);
    await screen('资产');
    await page.waitForFunction(()=>scrollY===0);
    await page.evaluate(()=>window.__homeConnection={origin:'https://app.plabs.online',host:'app.plabs.online',tabId:1,chainId:1,unlocked:true,address:'0x'+'34'.repeat(20)});
    await page.locator('.connected-site-bar').waitFor();
    const strip=await page.locator('.connected-site-bar').boundingBox(),navigation=await nav.boundingBox();
    assert.ok(Math.abs(strip.y+strip.height-navigation.y)<1,'Connection strip sits above navigation without overlapping');
    await shot('home-connected');
    await page.getByRole('button', { name: '选择账户', exact: true }).click();
    await page
      .getByRole('heading', { name: '账户管理', exact: true })
      .waitFor();
    assert.equal(await page.locator('.compact-address-card').count(), 2);
    await shot('accounts');
    await page
      .getByRole('button', { name: '隐私地址二维码', exact: true })
      .first()
      .click();
    await page
      .getByRole('heading', { name: '接收隐私资产', exact: true })
      .waitFor();
    assert.equal(await page.locator('.qr-code svg').count(), 1);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page
      .getByRole('button', { name: '切换到 备用账户', exact: true })
      .click();
    await page.getByRole('tab', { name: '隐私资产', exact: true }).click();
    await page
      .getByRole('button', { name: '解锁隐私资产', exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.wallet-balance-amount strong').innerText(),
      '—',
      'Locked balance is unknown, never a fake zero',
    );
    await shot('privacy-locked');
    await page
      .getByRole('button', { name: '解锁隐私资产', exact: true })
      .click();
    await page
      .locator('.privacy-unlock-page .page-heading strong')
      .filter({ hasText: '解锁隐私账户' })
      .waitFor();
    await shot('privacy-unlock');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.evaluate(() => window.__homeScreen('locked'));
    await page.getByPlaceholder('请输入钱包主密码', { exact: true }).waitFor();
    await shot('unlock');
    await page.evaluate(() => window.__homeScreen('setup'));
    await page
      .getByRole('heading', { name: '创建钱包', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: '创建并备份', exact: true })
        .isDisabled(),
      true,
    );
    await shot('setup');
    assert.deepEqual(errors, []);
    console.log(
      'PASS wallet navigation, balances, unified sync, account isolation, approvals, forms and backup at ' +
        width +
        'px',
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log('Screenshots: ' + artifacts);
