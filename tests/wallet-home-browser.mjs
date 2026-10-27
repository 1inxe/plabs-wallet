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
window.__homeRequests=[];let task=null;window.__homeDecisions=[];
window.__homeApproval=()=>{task={id:'internal-nft-task',origin:'chrome-extension://synthetic/popup.html',method:'wallet_sendPrivateNft',phase:'approval',requiresPrivacy:true,privacyExists:true,privacyUnlocked:true,canCancel:true,createdAt:Date.now(),approval:{id:'internal-nft-approval',origin:'chrome-extension://synthetic/popup.html',kind:'transaction',title:'确认发送 NFT 与 ETH Gas',createdAt:Date.now(),details:{NFT编号:'#7',收款隐私地址:privacyAddress,Gas费用上限:'0.0001 ETH'}}};};
window.chrome={runtime:{getManifest:()=>({version:'0.8.6'}),onMessage:event,async sendMessage(request){window.__homeRequests.push(request.action);let result;switch(request.action){case'GET_STATE':result=state;break;case'GET_PERMISSIONS':result={};break;case'GET_LOCK_SETTINGS':result={walletMinutes:15,privacyMinutes:15};break;case'GET_PRIVACY_STATE':result=privacy;break;case'GET_DAPP_UI_STATE':result=task;break;case'APPROVAL_DECISION':window.__homeDecisions.push(request.approved);task=null;result=true;break;case'GET_ACTIVE_SITE_CONNECTION':result=null;break;case'GET_PUBLIC_ASSETS':result=[{type:'native',symbol:'ETH',balanceRaw:'1000000000000000000',formatted:'1',decimals:18,address:null}];break;case'GET_TRANSACTION_SETTINGS':result={experimentalPrivacyWrites:true,privacyPaymentMode:'native',privacyMergeBatchSize:0};break;case'GET_VISIBLE_PRIVACY_ASSETS':result=[];break;case'GET_PRIVACY_SNAPSHOTS':result=[snapshot];break;case'SYNC_PRIVACY':return syncAll();case'GET_PRIVACY_SYNC_PROGRESS':result={chainId:1,progress:window.__homeSync.phase==='nfts'?80:window.__homeSync.phase==='complete'?100:0,status:['complete','error'].includes(window.__homeSync.phase)?window.__homeSync.phase:'syncing',message:window.__homeSync.phase==='nfts'?'正在同步 NFT':'正在同步资产'};break;case'GET_PRIVACY_ACTIVITY':result={items:[],page:1,pages:1,total:0,pageSize:20};break;case'GET_PRIVATE_NFT_ASSETS':result=nftSnapshot;break;case'SWITCH_ACCOUNT':state={...state,activeAccountId:request.accountId,address:address2,accountName:'备用账户'};privacy={...privacy,privacyAddress:state.accounts[1].privacyAddress,unlocked:false};result=state;break;default:throw Error('Unexpected wallet home request '+request.action);}return{ok:true,result};}},tabs:{query:async()=>[],onActivated:event,onUpdated:event},windows:{onFocusChanged:event},storage:{onChanged:event}};
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
    const page = await browser.newPage({ viewport: { width, height: 900 } }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin + '/wallet-home-fixture');
    await page.getByRole('tab', { name: '隐私资产', exact: true }).waitFor();
    await page.getByRole('button', { name: '最近活动', exact: true }).waitFor();
    await page.waitForFunction(() => window.__homeSync.phase === 'complete');
    assert.equal(
      await page.evaluate(() => window.__homeSync.nfts),
      1,
      'Unlock synchronizes NFTs without opening their tab',
    );
    assert.equal(
      await page.evaluate(() =>
        window.__homeRequests.includes('SYNC_PRIVATE_NFT_ASSETS'),
      ),
      false,
    );

    assert.equal(
      await page.locator('.activity-section').count(),
      0,
      'History is a button, with no standalone home module',
    );
    assert.equal(
      await page.locator('.address-card').count(),
      0,
      'Address details are removed from home',
    );
    assert.equal(await page.locator('.sync-details').count(), 0);
    assert.equal(
      await page.getByText('Groth16 · 本地隐私引擎', { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator('.sync-summary').isVisible(), true);
    assert.equal(
      await page.locator('.vault-card .activity-history-button').count(),
      1,
    );
    assert.equal(
      await page.locator('.dashboard-body > .wallet-assets').count(),
      1,
    );
    await page.screenshot({
      path: join(artifacts, `home-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: '最近活动', exact: true }).click();
    await page
      .getByRole('heading', { name: '操作历史', exact: true })
      .waitFor();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('tab', { name: '公开资产', exact: true }).click();
    await page.locator('.public-assets').waitFor();
    assert.equal(await page.locator('.private-assets').count(), 0);
    await page.getByRole('tab', { name: 'NFT', exact: true }).click();
    await page
      .getByText('已同步，当前隐私地址暂无 NFT', { exact: true })
      .waitFor();

    assert.equal(
      await page
        .getByRole('button', { name: '同步隐私 NFT', exact: true })
        .count(),
      0,
      'Home exposes one shared sync button',
    );
    assert.equal(
      await page.evaluate(() => window.__homeSync.nfts),
      1,
      'Switching tabs does not run a second NFT scan',
    );
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
    assert.equal(
      await page
        .locator('.sync-summary')
        .getByText('已同步', { exact: true })
        .count(),
      0,
      'Token completion cannot finish the shared indicator',
    );
    await page.evaluate(() => {
      window.__homeSync.paused = false;
      window.__homeSync.release();
    });
    await page
      .getByRole('button', { name: '同步隐私资产', exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('button[aria-label="同步隐私资产"]').disabled,
    );
    await page
      .getByText('已同步，当前隐私地址暂无 NFT', { exact: true })
      .waitFor();
    await page.evaluate(() => (window.__homeSync.failNft = true));
    await page
      .getByRole('button', { name: '同步隐私资产', exact: true })
      .click();
    await page
      .locator('.sync-summary')
      .getByText('同步未完成', { exact: true })
      .waitFor();
    await page.evaluate(() => (window.__homeSync.failNft = false));
    await page
      .getByRole('button', { name: '同步隐私资产', exact: true })
      .click();
    await page
      .locator('.sync-summary')
      .getByText('已同步', { exact: true })
      .waitFor();
    for (const decision of [false, true]) {
      await page.evaluate(() => window.__homeApproval());
      await page
        .getByRole('heading', { name: '确认发送 NFT 与 ETH Gas', exact: true })
        .waitFor();
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
        await page
          .getByRole('tab', { name: 'NFT', exact: true })
          .getAttribute('data-state'),
        'active',
        'NFT tab stays mounted through final gas approval',
      );
    }
    assert.deepEqual(await page.evaluate(() => window.__homeDecisions), [
      false,
      true,
    ]);
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.locator('.page-header .page-heading strong').filter({hasText:'设置'}).waitFor();
    await page.getByRole('button',{name:'保存设置',exact:true}).waitFor();
    await page.screenshot({path:join(artifacts,`settings-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'返回',exact:true}).click();
    await page.getByRole('button',{name:'接收',exact:true}).click();
    await page.getByRole('heading',{name:'接收隐私资产',exact:true}).first().waitFor();
    assert.equal(await page.locator('.qr-code svg').count(),1);
    await page.screenshot({path:join(artifacts,`receive-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'返回',exact:true}).click();
    await page.getByRole('button', { name: '选择账户', exact: true }).click();
    await page
      .getByRole('heading', { name: '账户管理', exact: true })
      .waitFor();
    assert.equal(await page.locator('.compact-address-card').count(), 2);
    assert.equal(
      await page
        .getByRole('button', { name: 'EVM 地址二维码', exact: true })
        .count(),
      2,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: join(artifacts, `accounts-${width}.png`),
      fullPage: true,
    });
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
    await page.getByRole('button', { name: '解锁隐私资产' }).waitFor();
    assert.equal(await page.locator('.address-card').count(), 0);
    assert.equal(
      await page
        .getByRole('tab', { name: '隐私资产', exact: true })
        .getAttribute('data-state'),
      'active',
    );
    await page.getByRole('button',{name:'解锁隐私资产',exact:true}).click();
    await page.locator('.privacy-unlock-page .page-heading strong').filter({hasText:'解锁隐私账户'}).waitFor();
    await page.screenshot({path:join(artifacts,`privacy-unlock-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'返回',exact:true}).click();
    await page.evaluate(()=>window.__homeScreen('locked'));
    await page.getByPlaceholder('请输入钱包主密码',{exact:true}).waitFor();
    await page.screenshot({path:join(artifacts,`unlock-${width}.png`),fullPage:true});
    await page.evaluate(()=>window.__homeScreen('setup'));
    await page.getByRole('heading',{name:'创建钱包',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'创建并备份',exact:true}).isDisabled(),true,'Backup acknowledgement is still required');
    await page.screenshot({path:join(artifacts,`setup-${width}.png`),fullPage:true});
    assert.deepEqual(errors, []);
    console.log(
      'PASS unified wallet home, compact account addresses/QR, history button and account switching at ' +
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
