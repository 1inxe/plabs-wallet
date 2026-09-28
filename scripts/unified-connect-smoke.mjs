import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const profile = await mkdtemp(path.join(os.tmpdir(), 'plabs-unified-connect-'));
const executable =
  process.env.CHROME_BIN ??
  '/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: executable,
    args: [
      `--disable-extensions-except=${path.resolve('dist')}`,
      `--load-extension=${path.resolve('dist')}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).hostname;
  // Stub chain reads only inside this disposable extension test process. No live transactions or accounts.
  await worker.evaluate(() => {
    globalThis.fetch = async (_url, init) => {
      if (String(_url).includes('/dex-matcher/')) {
        const result = String(_url).endsWith('/healthz')
          ? { chain_id: 143, matches_epoch: 'epoch-1' }
          : {
              orders: [
                {
                  order_id: 'a'.repeat(32),
                  matched_qty: 0,
                  pending_qty: 0,
                  remaining_qty: 10000000,
                },
              ],
            };
        return new Response(JSON.stringify(result), {
          headers: { 'content-type': 'application/json' },
        });
      }
      const body = JSON.parse(
        typeof init?.body === 'string'
          ? init.body
          : init?.body
            ? new TextDecoder().decode(init.body)
            : '{}',
      );
      const one = (request) => ({
        jsonrpc: '2.0',
        id: request.id,
        result:
          request.method === 'eth_chainId'
            ? '0x8f'
            : request.method === 'eth_getBalance'
              ? '0x1bc16d674ec80000'
              : request.method === 'eth_getCode'
                ? '0x'
                : request.method === 'eth_blockNumber'
                  ? '0x1'
                  : '0x',
      });
      return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), {
        headers: { 'content-type': 'application/json' },
      });
    };
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const raw = (action, args = {}) =>
    popup.evaluate((message) => chrome.runtime.sendMessage(message), { action, ...args });
  const call = async (action, args) => {
    const response = await raw(action, args);
    assert(response.ok, response.error?.message);
    return response.result;
  };
  const password = 'temporary read smoke 42!';
  const created = await call('CREATE_WALLET', { password });
  await call('CONFIRM_WALLET_BACKUP', {
    accountId: created.state.activeAccountId,
    confirmed: true,
  });
  const { build } = await import('vite').then(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    return createRequire(require.resolve('vite/package.json'))('esbuild');
  });
  const helper = path.join(profile, 'vault-helper.mjs');
  await build({
    entryPoints: [path.resolve('src/privacy/vault.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: helper,
  });
  const { createPrivacyVault } = await import(new URL(`file://${helper}`).href);
  const privacyPassword = 'temporary privacy read 42!';
  const { vault } = await createPrivacyVault({
    password: privacyPassword,
    walletAddress: created.state.address,
  });
  await call('IMPORT_PRIVACY_VAULT', { vault, password: privacyPassword });
  const site = await context.newPage();
  await site.route('https://app.plabs.online/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body>PLabs read protocol smoke</body></html>',
    }),
  );
  await site.goto('https://app.plabs.online/');
  await site.waitForFunction(() => window.plabsPrivacyWallet);
  const request = (method, params) =>
    site.evaluate(
      async ({ method, params }) => {
        try {
          return { ok: true, result: await window.plabsPrivacyWallet.request({ method, params }) };
        } catch (error) {
          return { ok: false, code: error.code, message: error.message };
        }
      },
      { method, params },
    );
  const scopes = ['address', 'balances', 'history', 'notes', 'dexOrders'];
  const nextApproval = async () => {
    for (let i = 0; i < 150; i++) {
      const task = await call('GET_DAPP_UI_STATE');
      if (task?.approval) return task.approval;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Approval not shown');
  };
  const rejected = request('plabs_connect', [{ scopes }]);
  let approval = await nextApproval();
  assert.equal(approval.title, '连接网站并授权读取钱包数据');
  await call('APPROVAL_DECISION', { id: approval.id, approved: false });
  assert.equal((await rejected).code, 4001);
  assert.deepEqual((await request('eth_accounts')).result, []);
  const connecting = request('plabs_connect', [{ scopes }]);
  approval = await nextApproval();
  assert(approval.details['有效期'].includes('直到你撤销'));
  await call('APPROVAL_DECISION', { id: approval.id, approved: true });
  const connected = await connecting;
  assert(connected.ok, connected.message);
  assert.deepEqual(connected.result.privacy.scopes, scopes);
  const taskId = (await call('GET_DAPP_UI_STATE')).id;
  for (const method of [
    'plabs_getBalances',
    'plabs_getHistory',
    'plabs_getNotes',
    'plabs_getDexOrders',
  ])
    assert((await request(method)).ok, method);
  const again = await request('plabs_connect', [{ scopes }]);
  assert(again.ok, again.message);
  assert.equal(
    (await call('GET_DAPP_UI_STATE')).id,
    taskId,
    'Cached consent must not reopen the wallet UI',
  );
  await site.reload();
  await site.waitForFunction(() => window.plabsPrivacyWallet);
  assert.equal((await request('plabs_getPrivacySession')).result.scopes.length, 5);
  const stored = await worker.evaluate(async () =>
    Object.entries(await chrome.storage.local.get(null))
      .filter(([key]) => key.startsWith('privacy-site-consent:'))
      .map(([, value]) => value),
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].version, 1);
  assert(!JSON.stringify(stored).includes(connected.result.privacy.address));
  await call('LOCK_PRIVACY');
  assert.equal((await request('plabs_getBalances')).ok, false);
  assert.deepEqual((await request('plabs_getPrivacySession')).result.scopes, []);
  await call('UNLOCK_PRIVACY', { password: privacyPassword });
  const restored = await request('plabs_getPrivacySession');
  assert(restored.ok, restored.message);
  assert.equal(restored.result.scopes.length, 5);
  assert.equal(
    (await call('GET_DAPP_UI_STATE')).id,
    taskId,
    'Unlock must reuse consent without another approval',
  );
  await call('SWITCH_CHAIN', { chainId: 1 });
  assert.equal((await request('plabs_getPrivacySession')).result.scopes.length, 5);
  await call('SWITCH_CHAIN', { chainId: 143 });
  await request('plabs_revokePrivacyAccess');
  assert.equal((await request('plabs_getBalances')).ok, false);
  const needsApproval = request('plabs_connect', [{ scopes }]);
  approval = await nextApproval();
  assert.equal(approval.title, '连接网站并授权读取钱包数据');
  await call('APPROVAL_DECISION', { id: approval.id, approved: false });
  assert.equal((await needsApproval).code, 4001);
  console.log(
    'Unified connection passed: one explicit approval, all read scopes, reload/unlock/network reuse, encrypted consent, revocation and rejection. Synthetic wallet, no transactions.',
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
