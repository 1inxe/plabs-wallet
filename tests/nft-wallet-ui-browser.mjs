import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Interface, ZeroAddress } from 'ethers';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { browserRuntime } from './browser-runtime.mjs';

const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic private NFT assets</title><div id="root"></div><script type="module" src="/@id/virtual:nft-ui"></script>';
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite/nft-gallery-test',
  plugins: [
    react(),
    {
      name: 'nft-ui-fixture',
      resolveId(id) {
        if (id === 'virtual:nft-ui') return '\0virtual:nft-ui';
      },
      load(id) {
        if (id !== '\0virtual:nft-ui') return;
        return `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { WalletAssets } from '/src/ui/wallet-assets.tsx';
    import { PrivateNfts } from '/src/ui/private-nfts.tsx'; import '/src/ui/index.css'; import '/src/ui/wallet-theme.css';
    const confirmed={id:'synthetic-owned',chainId:1,type:'perc721',poolAddress:'0x'+'12'.repeat(20),name:'Jubjub Bird',symbol:'JUBJUB',tokenId:'7',txHash:'0x'+'34'.repeat(32),blockNumber:10,state:'confirmed',source:'chain'};
    let snapshot={chainId:1,items:[confirmed,{...confirmed,id:'synthetic-pending',tokenId:'8',state:'pending'}],syncedAt:Date.now(),syncComplete:true};
    window.__nftUi={syncs:0,sends:[],reject:true,spend(){snapshot={...snapshot,items:[]};},fail(){snapshot={...snapshot,error:'Synthetic RPC outage',syncComplete:false};}};
    window.chrome={runtime:{async sendMessage(request){if(request.action==='SYNC_PRIVATE_NFT_ASSETS')window.__nftUi.syncs++;if(request.action==='SEND_PRIVATE_NFT'){window.__nftUi.sends.push(request);if(window.__nftUi.reject)return{ok:false,error:{message:'用户取消 NFT 发送'}};return{ok:true,result:{id:'synthetic-transfer',state:'submitted',recipient:'12'.repeat(43),txHash:'0x'+'45'.repeat(32)}};}if(request.action==='GET_PRIVATE_NFT_TRANSFER')return{ok:true,result:{id:'synthetic-transfer',state:'submitted',recipient:'12'.repeat(43),txHash:'0x'+'45'.repeat(32)}};if(!['GET_PRIVATE_NFT_ASSETS','SYNC_PRIVATE_NFT_ASSETS'].includes(request.action))throw new Error('Unexpected UI request');return{ok:true,result:snapshot};}}};
    function Fixture(){const[unlocked,setUnlocked]=React.useState(true);window.__nftUi.lock=()=>setUnlocked(false);return React.createElement('div',{className:'wallet-shell'},React.createElement('main',{className:'page-body'},React.createElement(WalletAssets,{publicAssets:React.createElement('section',{className:'panel'},'公开代币 · ETH'),privateAssets:React.createElement('section',{className:'panel'},'隐私代币 · P20 / sUSDC'),nfts:React.createElement(PrivateNfts,{key:String(unlocked),chainId:1,unlocked,automaticSync:true})})));}
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/nft-ui-fixture') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml('/nft-ui-fixture', html));
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const { chromium, executablePath } = await browserRuntime();
const browser = await chromium.launch({ headless: true, executablePath });
const artifacts =
  process.env.NFT_ARTIFACT_DIR ?? join(tmpdir(), 'plabs-nft-wallet-ui');
await mkdir(artifacts, { recursive: true });
try {
  for (const width of [420, 370]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const image = readFileSync(
      new URL('../public/icons/plabs-64.png', import.meta.url),
    );
    const digest = (value) => createHash('sha256').update(value).digest('hex');
    const entry = {
      image: `https://media.plabs.online/objects/${digest(image)}.webp`,
      image_sha256: digest(image),
      thumbnail: `https://media.plabs.online/objects/${digest(image)}.webp`,
      thumbnail_sha256: digest(image),
    };
    const creator = '0x' + '56'.repeat(20);
    const manifest = Buffer.from(
      JSON.stringify({
        chainId: 1,
        creator,
        collection: { name: 'Jubjub Bird' },
        tokens: Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [String(i + 1), entry]),
        ),
      }),
    );
    const commitment = '0x' + digest(manifest);
    const abi = new Interface([
      'function isCollection(address) view returns(bool)',
      'function metadataBaseURI() view returns(string)',
      'function metadataManifestHash() view returns(bytes32)',
      'function launches(address) view returns(address,uint8,uint256,uint256,uint64,uint64,uint64,address,bool,bool,uint256,uint256)',
    ]);
    let mediaRequests = 0;
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      };
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers });
      if (url.hostname === 'media.plabs.online') {
        mediaRequests++;
        return route.fulfill({
          headers,
          contentType: url.pathname.endsWith('manifest.json')
            ? 'application/json'
            : 'image/webp',
          body: url.pathname.endsWith('manifest.json') ? manifest : image,
        });
      }
      if (route.request().method() === 'POST') {
        const req = route.request().postDataJSON();
        let result;
        if (req.method === 'eth_chainId') result = '0x1';
        else if (req.method === 'eth_blockNumber') result = '0x123';
        else {
          const call = abi.parseTransaction({ data: req.params[0].data });
          const values = {
            isCollection: [true],
            metadataBaseURI: [
              `https://media.plabs.online/collections/${commitment.slice(2)}`,
            ],
            metadataManifestHash: [commitment],
            launches: [
              creator,
              0,
              0,
              0,
              1,
              0,
              0,
              ZeroAddress,
              true,
              true,
              8,
              2,
            ],
          };
          result = abi.encodeFunctionResult(call.name, values[call.name]);
        }
        return route.fulfill({
          headers,
          contentType: 'application/json',
          body: JSON.stringify({ id: 1, result }),
        });
      }
      return route.abort();
    });
    await page.goto(`${origin}/nft-ui-fixture`);
    await page.getByRole('tab', { name: '隐私资产', exact: true }).click();
    assert.equal(
      await page.getByText('隐私代币 · P20 / sUSDC').isVisible(),
      true,
    );
    await page.getByRole('tab', { name: '公开资产', exact: true }).click();
    await page.getByText('公开代币 · ETH', { exact: true }).waitFor();
    assert.equal(mediaRequests, 0, 'Inactive NFT tab does not fetch artwork');
    await page.getByRole('tab', { name: 'NFT', exact: true }).click();
    await page
      .getByRole('button', { name: '查看 Jubjub Bird #7', exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.private-nft-art img').length === 2 &&
        [...document.querySelectorAll('.private-nft-art img')].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
    );
    assert.equal(
      await page.getByText('隐私代币 · P20 / sUSDC').isVisible(),
      false,
    );
    await page
      .getByRole('button', { name: '查看 Jubjub Bird #7', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Jubjub Bird #7', exact: true })
      .waitFor();
    await page.screenshot({
      path: join(artifacts, `nft-detail-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: '发送 NFT', exact: true }).click();
    await page
      .getByLabel('接收方隐私地址', { exact: true })
      .fill('0x' + '11'.repeat(20));
    await page
      .getByRole('button', { name: '确认发送并查看 Gas', exact: true })
      .click();
    await page.getByRole('alert').waitFor();
    assert.equal(
      await page.evaluate(() => window.__nftUi.sends.length),
      0,
      'EVM addresses cannot receive private NFTs',
    );
    await page
      .getByLabel('接收方隐私地址', { exact: true })
      .fill('12'.repeat(43));
    await page
      .getByRole('button', { name: '确认发送并查看 Gas', exact: true })
      .click();
    await page.getByRole('alert').filter({ hasText: '用户取消' }).waitFor();
    await page.evaluate(() => (window.__nftUi.reject = false));
    await page
      .getByRole('button', { name: '确认发送并查看 Gas', exact: true })
      .click();
    await page
      .getByRole('button', { name: '等待链上确认', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: '等待链上确认', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.__nftUi.sends.length),
      2,
      'Rejection can be retried, pending transfers cannot be sent again',
    );
    await page.screenshot({
      path: join(artifacts, `nft-send-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.ok(
      (await page.evaluate(() => window.__nftUi.syncs)) >= 1,
      'automatic NFT sync runs when unlocked',
    );
    await page.screenshot({
      path: join(artifacts, `nft-holdings-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => window.__nftUi.fail());
    await page
      .getByRole('button', { name: '同步隐私 NFT', exact: true })
      .click();
    await page.locator('.sync-notice').waitFor();
    assert.match(await page.locator('.sync-notice pre').textContent(),/Synthetic RPC outage/);
    assert.equal(await page.locator('.sync-notice pre').isVisible(),false);
    assert.equal(
      await page
        .getByRole('button', { name: '查看 Jubjub Bird #7', exact: true })
        .count(),
      1,
      'an outage preserves known holdings',
    );
    await page.evaluate(() => window.__nftUi.spend());
    await page
      .getByRole('button', { name: '同步隐私 NFT', exact: true })
      .click();
    await page
      .getByRole('button', { name: '查看 Jubjub Bird #7', exact: true })
      .waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__nftUi.lock());
    await page.getByText('解锁隐私钱包后查看 NFT', { exact: true }).waitFor();
    assert.equal(await page.locator('.private-nft-art img').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS private NFT holdings, automatic sync, failure retention and spent removal at ${width}px`,
    );
    await context.close();
  }
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  await server.close();
}
