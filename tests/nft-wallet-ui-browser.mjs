import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { browserRuntime } from './browser-runtime.mjs';

const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic private NFT assets</title><div id="root"></div><script type="module" src="/@id/virtual:nft-ui"></script>';
const server = await createServer({
  configFile: false,
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
    import { PrivateNfts } from '/src/ui/private-nfts.tsx'; import '/src/ui/index.css';
    const confirmed={id:'synthetic-owned',chainId:1,type:'perc721',poolAddress:'0x'+'12'.repeat(20),name:'Jubjub Bird',symbol:'JUBJUB',tokenId:'7',txHash:'0x'+'34'.repeat(32),blockNumber:10,state:'confirmed',source:'chain'};
    let snapshot={chainId:1,items:[confirmed],syncedAt:Date.now(),syncComplete:true};
    window.__nftUi={syncs:0,spend(){snapshot={...snapshot,items:[]};},fail(){snapshot={...snapshot,error:'Synthetic RPC outage',syncComplete:false};}};
    window.chrome={runtime:{async sendMessage(request){if(request.action==='SYNC_PRIVATE_NFT_ASSETS')window.__nftUi.syncs++;if(!['GET_PRIVATE_NFT_ASSETS','SYNC_PRIVATE_NFT_ASSETS'].includes(request.action))throw new Error('Unexpected UI request');return{ok:true,result:snapshot};}}};
    createRoot(document.getElementById('root')).render(React.createElement('div',{className:'wallet-shell'},React.createElement('main',{className:'page-body'},React.createElement(PrivateNfts,{chainId:1,unlocked:true,automaticSync:true}))));
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
const artifacts = process.env.NFT_ARTIFACT_DIR ?? join(tmpdir(), 'plabs-nft-wallet-ui');
await mkdir(artifacts, { recursive: true });
try {
  for (const width of [420, 370]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await page.goto(`${origin}/nft-ui-fixture`);
    await page.getByText('Jubjub Bird #7', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.ok(
      (await page.evaluate(() => window.__nftUi.syncs)) >= 1,
      'automatic NFT sync runs when unlocked',
    );
    await page.screenshot({ path: join(artifacts, `nft-holdings-${width}.png`), fullPage: true });
    await page.evaluate(() => window.__nftUi.fail());
    await page.getByRole('button', { name: '同步隐私 NFT', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic RPC outage' }).waitFor();
    assert.equal(
      await page.getByText('Jubjub Bird #7', { exact: true }).count(),
      1,
      'an outage preserves known holdings',
    );
    await page.evaluate(() => window.__nftUi.spend());
    await page.getByRole('button', { name: '同步隐私 NFT', exact: true }).click();
    await page.getByText('Jubjub Bird #7', { exact: true }).waitFor({ state: 'hidden' });
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
