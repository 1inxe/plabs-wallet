import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { browserRuntime } from './browser-runtime.mjs';
const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic wallet activity</title><div id="root"></div><script type="module" src="/@id/virtual:activity-timeline"></script>';
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite/activity-timeline-test',
  plugins: [
    react(),
    {
      name: 'activity-timeline-fixture',
      resolveId: (id) =>
        id === 'virtual:activity-timeline'
          ? '\0virtual:activity-timeline'
          : undefined,
      load(id) {
        if (id !== '\0virtual:activity-timeline') return;
        return `
import React from 'react';import{createRoot}from'react-dom/client';import{ActivityHistoryButton}from'/src/ui/activity-history.tsx';import'/src/ui/index.css';import'/src/ui/wallet-theme.css';
const listeners=new Set(),now=Date.now(),kinds=['send','shield','unshield','merge'],statuses=['confirmed','pending','failed','review'];
let items=Array.from({length:1000},(_,i)=>({id:'activity-'+i,chainId:1,kind:kinds[i%4],status:statuses[i%4],stage:'synthetic',createdAt:now-i*3600000,updatedAt:now-i*3600000,symbol:'P20',decimals:8,amountRaw:String((i+1)*100000000),txHashes:[],refreshable:false,unreadable:false}));
const notify=()=>listeners.forEach(fn=>fn({privacyActivityHistory:{newValue:[]}},'local'));
window.__activities={requests:[],unlock(){listeners.forEach(fn=>fn({privacyUnlockSession:{newValue:{}}},'session'));},insert(){items=[{...items[0],id:'new-activity',createdAt:now+1000},...items];notify();},lock(){listeners.forEach(fn=>fn({privacyUnlockSession:{newValue:undefined}},'session'));}};
window.chrome={storage:{onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}},runtime:{async sendMessage(request){window.__activities.requests.push(request);if(request.action!=='GET_PRIVACY_ACTIVITY')throw Error('Unexpected request');const selected=request.id?items.filter(item=>item.id===request.id):items;return{ok:true,result:{items:request.all||request.id?selected:selected.slice(0,request.pageSize??20),total:selected.length,page:1,pages:1,pageSize:request.pageSize??20}};}}};
function Fixture(){const[hidden,setHidden]=React.useState(false);window.__activities.hide=()=>setHidden(true);return React.createElement('div',{className:'wallet-shell'},React.createElement(ActivityHistoryButton,{chainId:1,hidden}));}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/activity-timeline-fixture') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(
            await vite.transformIndexHtml('/activity-timeline-fixture', html),
          );
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
const artifacts = join(tmpdir(), 'plabs-activity-timeline');
await mkdir(artifacts, { recursive: true });
try {
  for (const width of [370, 420]) {
    const page = await browser.newPage({ viewport: { width, height: 600 } }),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin + '/activity-timeline-fixture');
    await page.getByRole('button', { name: '最近活动', exact: true }).click();
    await page
      .getByRole('heading', { name: '操作历史', exact: true })
      .waitFor();
    const list = page.getByRole('list', { name: '最近活动列表', exact: true });
    await list.waitFor();
    assert.equal(await page.getByRole('tablist').count(), 0);
    assert.equal(await page.locator('.activity-filters').count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: '筛选操作类型', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole('button', { name: '下一页历史', exact: true })
        .count(),
      0,
    );
    assert.ok(
      (await page.getByRole('listitem').count()) < 30,
      'Only the visible rows and overscan are mounted',
    );
    for (const label of [
      '隐私发送',
      '存入隐私池',
      '提取到公开账户',
      '合并凭证',
    ])
      assert.equal(
        await list.getByText(label, { exact: true }).first().isVisible(),
        true,
      );
    const times = await list
      .locator('.activity-row')
      .evaluateAll((rows) => rows.map((row) => Number(row.dataset.createdAt)));
    assert.ok(times.every((time, i) => i === 0 || time <= times[i - 1]));
    assert.equal(
      await page.evaluate(
        () => window.__activities.requests.filter((r) => r.all === true).length,
      ),
      1,
      'Local history is read once, without requesting each page',
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: join(artifacts, `history-top-${width}.png`),
      fullPage: true,
    });
    await list.evaluate((element) => {
      element.scrollTop = 300 * 84 + 12;
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-activity-id="activity-300"]'),
    );
    const before = await list.evaluate((element) => element.scrollTop);
    await page.evaluate(() => window.__activities.insert());
    await page.waitForFunction(
      () =>
        document.querySelector('[role="list"]')?.scrollTop === 301 * 84 + 12,
    );
    assert.equal(
      await list.evaluate((element) => element.scrollTop),
      before + 84,
      'New records preserve the older item being read',
    );
    const selected = list.locator('[data-activity-id="activity-302"] button');
    await selected.click();
    await page
      .getByRole('heading', { name: '操作详情', exact: true })
      .waitFor();
    await page.evaluate(() => window.__activities.insert());
    await page.waitForFunction(
      () =>
        document.querySelector('.activity-virtual-space')?.style.height ===
        String(1002 * 84) + 'px',
    );
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[role="list"]')?.scrollTop === 302 * 84 + 12,
    );
    assert.equal(
      await list.evaluate((element) => element.scrollTop),
      before + 168,
      'Returning from detail retains the older item even when a new record arrived',
    );
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-activity-id="activity-999"]'),
    );
    assert.ok((await page.getByRole('listitem').count()) < 30);
    assert.equal(
      await list.locator('[data-activity-id="activity-0"]').count(),
      0,
      'Old DOM rows are recycled',
    );
    await page.screenshot({
      path: join(artifacts, `history-bottom-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => window.__activities.hide());
    assert.equal(
      await list.locator('.activity-quantity strong').first().innerText(),
      '•••••• P20',
    );
    await page.evaluate(() => window.__activities.lock());
    await list.waitFor({ state: 'hidden' });
    await page
      .getByRole('alert')
      .filter({ hasText: '隐私账户已锁定' })
      .waitFor();
    assert.equal(
      await page.getByRole('listitem').count(),
      0,
      'Locking removes decrypted history',
    );
    await page.evaluate(() => window.__activities.unlock());
    await page.getByRole('listitem').first().waitFor();
    assert.ok(
      (await page.getByRole('listitem').count()) < 30,
      'Unlocking restores the virtual timeline without leaving the page',
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS chronological mixed activity, virtual rows, scroll anchoring/detail return and privacy lock at ' +
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
