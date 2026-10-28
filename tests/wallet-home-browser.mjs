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
import {marketKey} from '/src/market/prices.ts';
const event={addListener(){},removeListener(){}};
const privacyAddress=formatPrivacyAddress('12'.repeat(43));
const address='0x'+'34'.repeat(20),address2='0x'+'56'.repeat(20);
let state={hasVault:true,unlocked:true,address,activeAccountId:'one',accountName:'主账户',accounts:[{id:'one',name:'主账户',address,privacyAddress},{id:'two',name:'备用账户',address:address2,privacyAddress:formatPrivacyAddress('78'.repeat(43))}],chainId:1,networkName:'Ethereum'};
let privacy={hasAccount:true,unlocked:true,privacyAddress,recoveryMode:'birthday',canSync:true,automaticSync:false,expiresAt:Date.now()+3600000,status:'ready'};
const snapshot={version:1,chainId:1,poolAddress:'0xFC8Bf8B613cAE37db53003EC6A306a62d5A0b7C5',symbol:'sUSDC',decimals:6,privacyAddress,cursorBlock:100,targetBlock:100,syncState:'complete',totalBalanceRaw:'7000000',spendableBalanceRaw:'7000000',totalNotes:2,spendableNotes:2,pendingNotes:0,spentNotes:0,syncedAt:Date.now()};
window.__homeSync={tokens:0,nfts:0,paused:false,failNft:false,phase:'idle',progress:0};
let nftSnapshot={chainId:1,items:[],syncComplete:false,syncedAt:null};
async function syncAll(){
  const run=window.__homeSync;run.phase='tokens';
  try{const result=await syncPrivacyAssets({guard:async()=>{},phase:p=>{run.phase=p;},tokens:async()=>{run.tokens++;return[snapshot];},nfts:async()=>{run.nfts++;if(run.paused)await new Promise(resolve=>{run.release=resolve;});nftSnapshot={...nftSnapshot,syncComplete:!run.failNft,syncedAt:Date.now(),error:run.failNft?'Synthetic NFT outage':undefined};return nftSnapshot;}});run.phase='complete';return{ok:true,result};}
  catch(error){run.phase='error';return{ok:false,error:{message:error.message}};}
}
window.__homeScreen=mode=>{state={...state,hasVault:mode!=='setup',unlocked:mode==='home'};};
window.__homeWritesEnabled=false;window.__homeConnection=null;window.__homeSettingsWrites=[];window.__homeRequests=[];let task=null;window.__homeDecisions=[];
window.__homeSignature=expired=>{task={id:expired?'sign-expired':'sign-live',origin:'https://dapp.example',method:'personal_sign',phase:'approval',requiresPrivacy:false,canCancel:true,createdAt:Date.now(),approval:{id:expired?'sign-expired':'sign-live',kind:'personal_sign',title:'签名消息',origin:'https://dapp.example',createdAt:Date.now()-(expired?600001:0),details:{账户:state.address,网络:'Ethereum',消息:'发送',原始消息:'0xe58f91e98081'}}};};
window.__homeApproval=()=>{task={id:'internal-nft-task',origin:'chrome-extension://synthetic/popup.html',method:'wallet_sendPrivateNft',phase:'approval',requiresPrivacy:true,privacyExists:true,privacyUnlocked:true,canCancel:true,createdAt:Date.now(),approval:{id:'internal-nft-approval',origin:'chrome-extension://synthetic/popup.html',kind:'transaction',title:'确认发送 NFT 与 ETH Gas',createdAt:Date.now(),details:{NFT编号:'#7',收款隐私地址:privacyAddress,Gas费用上限:'0.0001 ETH'}}};};
window.chrome={runtime:{getManifest:()=>({version:'0.11.3'}),onMessage:event,async sendMessage(request){window.__homeRequests.push(request.action);let result;switch(request.action){case'GET_STATE':result=state;break;case'GET_PERMISSIONS':result={};break;case'GET_LOCK_SETTINGS':result={walletMinutes:15,privacyMinutes:15};break;case'GET_PRIVACY_STATE':result=privacy;break;case'GET_DAPP_UI_STATE':result=task;break;case'APPROVAL_DECISION':window.__homeDecisions.push(request.approved);task=null;result=true;break;case'GET_ACTIVE_SITE_CONNECTION':result=window.__homeConnection;break;case'SET_LOCK_SETTINGS':window.__homeSettingsWrites.push(request);result=request;break;case'GET_MARKET_PRICES':result={quotes:{[marketKey(1,'native')]:{usd:2400,change24h:2,updatedAt:Date.now()},[marketKey(1,'private',snapshot.poolAddress)]:{usd:1,change24h:-0.01,updatedAt:Date.now()}},fetchedAt:Date.now(),unavailable:false,source:'DefiLlama'};break;case'GET_PENDING_PRIVACY_OPERATION':result=null;break;case'GET_PUBLIC_TRANSFER_STATUS':result=null;break;case'PREPARE_PUBLIC_TRANSFER':window.__publicPreviews=(window.__publicPreviews??0)+1;result={id:'public-preview-'+window.__publicPreviews,chainId:1,from:address,recipient:request.recipient,tokenAddress:null,symbol:'ETH',amount:request.amount,maxGasCost:'0.001',nativeSymbol:'ETH',expiresAt:Date.now()+120000};break;case'GET_PRIVACY_FEE_QUOTE':result={paymentMode:'native',feeRaw:'1',feePool:request.poolAddress,feeSymbol:'sUSDC',feeDecimals:6,feeCollector:'0x'+'67'.repeat(20),options:[],quotedAt:Date.now()};break;case'GET_PUBLIC_ASSETS':result=[{chainId:1,type:'native',symbol:'ETH',balanceRaw:'1000000000000000000',formatted:'1',decimals:18,address:null}];break;case'SET_TRANSACTION_SETTINGS':window.__homeWritesEnabled=request.experimentalPrivacyWrites??window.__homeWritesEnabled;result={experimentalPrivacyWrites:window.__homeWritesEnabled,privacyPaymentMode:'native',privacyMergeBatchSize:0};break;case'GET_TRANSACTION_SETTINGS':result={experimentalPrivacyWrites:window.__homeWritesEnabled,privacyPaymentMode:'native',privacyMergeBatchSize:0};break;case'GET_VISIBLE_PRIVACY_ASSETS':result=[];break;case'GET_PRIVACY_SNAPSHOTS':result=[snapshot];break;case'SYNC_PRIVACY':return syncAll();case'GET_PRIVACY_SYNC_PROGRESS':result={chainId:1,phase:window.__homeSync.phase,nft:window.__homeSync.phase==='nfts'?{phase:'scan',progress:window.__homeSync.nftProgress??45,collectionIndex:1,totalCollections:2,name:'Jubjub Bird',scannedBlocks:(window.__homeSync.nftProgress??45)*10,totalBlocks:1000,updatedAt:Date.now()}:undefined,progress:window.__homeSync.phase==='nfts'?80+Math.floor((window.__homeSync.nftProgress??45)*0.2):window.__homeSync.phase==='complete'?100:window.__homeSync.progress,status:['complete','error'].includes(window.__homeSync.phase)?window.__homeSync.phase:'syncing',message:window.__homeSync.phase==='nfts'?'正在同步 NFT':window.__homeSync.tokenMessage??'正在同步资产'};break;case'GET_PRIVACY_ACTIVITY':result={items:[],page:1,pages:1,total:0,pageSize:20};break;case'GET_PRIVATE_NFT_ASSETS':result=nftSnapshot;break;case'SWITCH_ACCOUNT':state={...state,activeAccountId:request.accountId,address:address2,accountName:'备用账户'};privacy={...privacy,privacyAddress:state.accounts[1].privacyAddress,unlocked:false};result=state;break;default:throw Error('Unexpected wallet home request '+request.action);}return{ok:true,result};}},tabs:{query:async()=>[],onActivated:event,onUpdated:event},windows:{onFocusChanged:event},storage:{onChanged:event}};
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
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error(e.stack);
    });
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin + '/wallet-home-fixture');
    const nav = page.locator('.wallet-navigation');
    const screen = async (name) => {
      const button = nav.getByRole('button', { name, exact: true });
      await button.click();
      await page.waitForFunction(
        (node) => node.getAttribute('aria-current') === 'page',
        await button.elementHandle(),
      );
    };
    const shot = async (name) => {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      return page.screenshot({
        path: join(artifacts, `${name}-${width}.png`),
        fullPage: false,
      });
    };
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
      '$7.00',
      'Privacy portfolio is the default and uses the underlying token quote',
    );
    assert.equal(await page.locator('.address-card').count(), 0);
    assert.equal(
      await page
        .getByRole('tab', { name: '隐私资产', exact: true })
        .getAttribute('data-state'),
      'active',
    );
    assert.equal(
      await page
        .getByRole('button', { name: '提取', exact: true })
        .isDisabled(),
      false,
      'Unshield is enabled for configured Ethereum wrapped assets',
    );
    assert.equal(
      await page.locator('.asset-amount').first().innerText(),
      '$7.00',
    );
    assert.match(
      await page.locator('.wallet-market-change').innerText(),
      /^\$0\.00/,
    );
    assert.equal(
      await page.locator('.private-assets .asset-row').count(),
      3,
      'Official zero-balance pools are visible by default',
    );
    assert.equal(
      await page.locator('.network-pill .network-icon svg').count(),
      1,
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text) => {
            window.__copied = text;
          },
        },
        configurable: true,
      }),
    );
    await page
      .locator('.account-address-line')
      .getByRole('button', { name: '复制隐私地址', exact: true })
      .click();
    assert.ok((await page.evaluate(() => window.__copied)).startsWith('perc1'));
    await page.getByRole('button', { name: '选择网络', exact: true }).click();
    assert.equal(
      await page.locator('.selection-list .network-icon').count(),
      4,
    );
    await page.getByRole('button', { name: /^Ethereum/ }).click();
    assert.equal(
      await page.evaluate(() => window.__homeRequests.includes('SWITCH_CHAIN')),
      false,
      'Choosing the current network does not invalidate the wallet session',
    );
    await page.getByRole('button', { name: '提取', exact: true }).click();
    await page.getByText('将 sUSDC 提取为公开 USDC', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: '金额', exact: true }).fill('1');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page
      .getByRole('heading', { name: '隐私交易设置', exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: '开启隐私交易', exact: true })
      .click();
    await page
      .getByRole('heading', { name: '隐私交易设置', exact: true })
      .waitFor({ state: 'hidden' });
    assert.equal(
      await page
        .getByRole('textbox', { name: '金额', exact: true })
        .inputValue(),
      '1',
      'Enabling transaction permissions preserves the draft amount',
    );

    assert.equal(await page.locator('.token-options button').count(), 3);
    await page.waitForFunction(() => {
      const next = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('下一步：核对提取与费用'),
      );
      return next && !next.disabled;
    });
    await shot('unshield');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.waitForFunction(() => scrollY === 0);
    await shot('home-private-default');
    assert.equal(
      await page.locator('.asset-quantity').first().innerText(),
      '7 sUSDC',
    );
    assert.equal(
      await page.locator('.asset-price-change').first().innerText(),
      '-0.01%',
    );
    await page.getByRole('tab', { name: '公开资产', exact: true }).click();
    assert.equal(
      await page.locator('.wallet-balance-amount').innerText(),
      '$2,400.00',
    );
    assert.equal(
      await page.locator('.asset-quantity').first().innerText(),
      '1 ETH',
    );
    assert.equal(
      await page.locator('.asset-price-change').first().innerText(),
      '+2.00%',
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
    await page.locator('.send-asset-list > button').click();
    await page
      .getByRole('textbox', { name: '搜索账户或输入收款地址', exact: true })
      .fill('0x' + '56'.repeat(20));
    await page.getByRole('button', { name: '使用此地址', exact: true }).click();
    await page
      .getByRole('textbox', { name: '公开发送金额', exact: true })
      .fill('0.1');
    await page
      .getByRole('button', { name: '下一步：确认发送', exact: true })
      .click();
    await page
      .getByRole('heading', { name: '确认公开转账', exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.__originalNow = Date.now;
      Date.now = () => window.__originalNow() + 121000;
    });
    await page
      .getByText('预览已过期，请重新估算手续费', { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: '确认并发送', exact: true })
        .isDisabled(),
      true,
    );
    await shot('public-expired');
    await page
      .getByRole('button', { name: '重新估算手续费', exact: true })
      .click();
    await page.waitForFunction(() => window.__publicPreviews === 2);
    await page.evaluate(() => (Date.now = window.__originalNow));
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();

    await page.getByRole('tab', { name: '隐私资产', exact: true }).click();
    assert.equal(
      await page.locator('.wallet-balance-amount').innerText(),
      '$7.00',
    );
    await shot('home-private');
    await page.getByRole('button', { name: '隐藏余额', exact: true }).click();
    assert.equal(
      await page.locator('.wallet-balance-amount strong').innerText(),
      '••••',
    );
    assert.equal(
      await page.locator('.asset-amount').first().innerText(),
      '••••••',
    );
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
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role=progressbar]')
          ?.getAttribute('aria-valuenow') === '89',
    );
    assert.equal(
      await page
        .locator('.collectibles-sync-status .wallet-sync-heading h1')
        .innerText(),
      '藏品',
    );
    assert.equal(
      await page
        .locator('.collectibles-sync-status [role=progressbar]')
        .count(),
      1,
      'Gallery progress is part of its title section',
    );
    await shot('nft-sync-progress');
    await page.evaluate(() => (window.__homeSync.nftProgress = 65));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role=progressbar]')
          ?.getAttribute('aria-valuenow') === '93',
    );
    assert.ok(
      (await page.locator('.asset-sync-progress').innerText()).includes(
        '650/1,000',
      ),
    );

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
    assert.equal(
      await page.locator('.assets-sync-status .privacy-access').count(),
      1,
    );
    await shot('home-sync-progress');
    await page.evaluate(() => {
      window.__homeSync.phase = 'tokens';
      window.__homeSync.progress = 28;
      window.__homeSync.tokenMessage = '已扫描至区块 26063778';
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role=progressbar]')
          ?.getAttribute('aria-valuenow') === '28',
    );
    assert.equal(await page.locator('.sync-access strong').innerText(), '28%');
    await shot('home-token-sync-progress');
    await screen('藏品');
    await shot('nft-token-sync-progress');
    await screen('资产');
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
    await page
      .getByRole('tablist', { name: 'EVM 自动锁定' })
      .getByRole('tab', { name: '5m', exact: true })
      .click();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page
      .getByRole('heading', { name: '自动锁定', exact: true })
      .waitFor({ state: 'hidden' });
    assert.deepEqual(
      await page.evaluate(() =>
        window.__homeSettingsWrites.map((r) => [
          r.walletMinutes,
          r.privacyMinutes,
        ]),
      ),
      [[5, 15]],
    );
    assert.equal(
      await page.evaluate(() =>
        window.__homeRequests.includes('RENAME_ACCOUNT'),
      ),
      false,
      'Lock preferences cannot persist unrelated account edits',
    );
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
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
    // Language changes keep the wallet mounted and leave transaction payloads alone.
    await screen('设置');
    await page
      .getByRole('button', { name: '语言 简体中文', exact: true })
      .click();
    await page.getByRole('radio', { name: 'English', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Language', exact: true })
      .waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await shot('settings-en');
    await screen('Assets');
    await page.getByText('Private portfolio', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.asset-quantity').first().innerText(),
      '7 sUSDC',
    );
    await shot('home-en');
    const capture = () =>
      page.evaluate(async () => {
        const snapshots = [];
        for (let frame = 0; frame < 20; frame++) {
          await new Promise(requestAnimationFrame);
          snapshots.push(
            [
              ...document.querySelectorAll(
                '.wallet-navigation, .wallet-navigation > button, .wallet-navigation > button > svg',
              ),
            ].map((node) => {
              const r = node.getBoundingClientRect();
              return [r.x, r.y, r.width, r.height];
            }),
          );
        }
        return snapshots;
      });
    const baseline = (await capture())[0];
    for (const target of ['Collectibles', 'Activity', 'Settings', 'Assets']) {
      const frames = capture();
      await screen(target);
      assert.deepEqual(
        await frames,
        Array.from({ length: 20 }, () => baseline),
        'Navigation and icons remain fixed while selection changes: ' + target,
      );
    }
    await screen('Collectibles');
    await page
      .getByText('Synced. No NFTs at this private address.', { exact: true })
      .waitFor();
    await shot('nfts-en');
    await screen('Activity');
    await page.getByText('No local activity yet', { exact: true }).waitFor();
    await shot('activity-en');
    await page.evaluate(() => window.__homeApproval());
    await page
      .getByRole('heading', { name: 'Confirm NFT transfer & gas', exact: true })
      .waitFor();
    await page.getByText('NFT token ID', { exact: true }).waitFor();
    await shot('approval-en');
    await page
      .getByRole('button', { name: 'Cancel send', exact: true })
      .click();
    await screen('Settings');
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('textbox').fill('Locale test');
    const tokenSyncs = await page.evaluate(() => window.__homeSync.tokens);
    await page.evaluate(async () => {
      const { setLanguage } = await import('/src/i18n/index.ts');
      await setLanguage('zh-CN');
    });
    await page.getByRole('heading', { name: '账户', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('textbox').inputValue(),
      'Locale test',
      'Switching language preserves form input',
    );
    assert.equal(
      await page.evaluate(() => window.__homeSync.tokens),
      tokenSyncs,
      'Switching language never starts another asset scan',
    );
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await screen('资产');
    await page.waitForFunction(() => scrollY === 0);
    await page.evaluate(
      () =>
        (window.__homeConnection = {
          origin: 'https://app.plabs.online',
          host: 'app.plabs.online',
          tabId: 1,
          chainId: 1,
          unlocked: true,
          address: '0x' + '34'.repeat(20),
        }),
    );
    await page.locator('.connected-site-bar').waitFor();
    const strip = await page.locator('.connected-site-bar').boundingBox(),
      navigation = await nav.boundingBox();
    assert.ok(
      Math.abs(strip.y + strip.height + 12 - navigation.y) < 1,
      'Connection strip clears the floating navigation by 12px',
    );
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
      '••••',
      'Locked privacy valuation stays masked',
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
    await page.evaluate(() => window.__homeScreen('home'));
    await nav.waitFor();
    await screen('设置');
    await page
      .getByRole('button', { name: '语言 简体中文', exact: true })
      .click();
    await page.getByRole('radio', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Assets', exact: true }).waitFor();
    assert.equal(
      await page.locator('html').getAttribute('lang'),
      'en',
      'Language is retained after reopening the page',
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text) => {
            window.__copied = text;
          },
        },
        configurable: true,
      }),
    );
    await page.evaluate(() => window.__homeSignature(false));
    await page
      .getByRole('heading', { name: 'Sign message', exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.approval-message').first().innerText(),
      '发送',
      'Signing content is never translated',
    );
    await page
      .getByRole('button', { name: 'Copy signing content', exact: true })
      .first()
      .click();
    assert.equal(await page.evaluate(() => window.__copied), '发送');
    await page
      .getByRole('button', { name: 'View full content', exact: true })
      .first()
      .click();
    await page
      .getByRole('heading', { name: 'Signing content', exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.approval-full-message').innerText(),
      '发送',
    );
    await shot('signature-full');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const decisionsBefore = await page.evaluate(
      () => window.__homeDecisions.length,
    );
    await page
      .getByRole('button', { name: 'Confirm signature', exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await page
      .getByRole('heading', { name: 'Sign message', exact: true })
      .waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => window.__homeDecisions.length),
      decisionsBefore + 1,
      'A same-tick double click confirms only once',
    );
    await page.evaluate(() => window.__homeSignature(true));
    await page
      .getByText('Request expired. Start a new request.', { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Confirm signature', exact: true })
        .isDisabled(),
      true,
    );
    await shot('signature-expired');
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
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
