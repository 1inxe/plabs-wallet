import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const profile = await mkdtemp(path.join(os.tmpdir(), 'plabs-pex-approval-'));
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
  const pending = request('eth_requestAccounts');
  let approval;
  for (let i = 0; i < 60; i++) {
    const state = await call('GET_DAPP_UI_STATE');
    if (state?.approval) {
      approval = state.approval;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(approval);
  await call('APPROVAL_DECISION', { id: approval.id, approved: true });
  assert((await pending).ok);
  const capabilities = (await request('plabs_getCapabilities')).result;
  assert.equal(capabilities.methods.dexTrading, true);
  const intent = {
    chainId: '0x8f',
    side: 'sell',
    type: 'limit',
    quantityRaw: '10000000',
    priceTicks: '1000',
    maxFeeRaw: '500000',
  };
  const nextApproval = async () => {
    for (let i = 0; i < 120; i++) {
      const state = await call('GET_DAPP_UI_STATE');
      if (state?.approval) return state.approval;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Approval did not open');
  };
  const invalid = await request('plabs_placeDexOrder', [{ ...intent, recipient: 'malicious' }]);
  assert(!invalid.ok);
  const denied = request('plabs_placeDexOrder', [intent]);
  let review = await nextApproval();
  assert(review.title.includes('第 1/2'));
  await call('APPROVAL_DECISION', { id: review.id, approved: false });
  assert.equal((await denied).code, 4001);
  // Keep the real provider/background/approvals. Replace engine IO only in this disposable profile.
  await worker.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    globalThis.pexCalls = [];
    chrome.runtime.sendMessage = async (message) => {
      if (message.target !== 'privacy-offscreen') return original(message);
      if (message.action === 'PRIVACY_SYNC_POOL') return { ok: true, result: {} };
      if (message.action.startsWith('PRIVACY_DEX_')) {
        globalThis.pexCalls.push({ action: message.action, bound: !!message.binding });
        if (message.action === 'PRIVACY_DEX_PREPARE')
          return {
            ok: true,
            result: {
              id: 'test-order',
              localId: '11111111-2222-3333-4444-555555555555',
              side: 'sell',
              type: 'limit',
              quantityRaw: '10000000',
              priceTicks: '1000',
              principalRaw: '10000000',
              feeRaw: '500000',
              executionState: 'prepared',
            },
          };
        if (message.action === 'PRIVACY_DEX_SUBMIT')
          return {
            ok: true,
            result: { id: 'ab'.repeat(16), localId: message.id, executionState: 'open' },
          };
        return { ok: true, result: null };
      }
      return original(message);
    };
  });
  const finalDenied = request('plabs_placeDexOrder', [intent]);
  review = await nextApproval();
  await call('APPROVAL_DECISION', { id: review.id, approved: true });
  review = await nextApproval();
  assert(review.title.includes('第 2/2'));
  assert.equal(review.details['独立手续费'], '0.5 sUSDC');
  await call('APPROVAL_DECISION', { id: review.id, approved: false });
  assert.equal((await finalDenied).code, 4001);
  let calls = await worker.evaluate(() => globalThis.pexCalls);
  assert.deepEqual(
    calls.map((c) => c.action),
    ['PRIVACY_DEX_PREPARE', 'PRIVACY_DEX_DISCARD'],
  );
  const accepted = request('plabs_placeDexOrder', [intent]);
  review = await nextApproval();
  await call('APPROVAL_DECISION', { id: review.id, approved: true });
  review = await nextApproval();
  await call('APPROVAL_DECISION', { id: review.id, approved: true });
  const result = await accepted;
  assert(result.ok, result.message);
  assert.equal(result.result.executionState, 'open');
  calls = await worker.evaluate(() => globalThis.pexCalls);
  assert.equal(calls.filter((c) => c.action === 'PRIVACY_DEX_SUBMIT').length, 1);
  assert(calls.every((c) => c.bound));
  for (const key of ['seed', 'nk_hex', 'capability', 'funding_notes'])
    assert(!JSON.stringify(result).includes(key));
  console.log(
    'PEX real extension bridge: rejects malicious intents, two distinct approvals, rejection discards drafts, final acceptance calls bound engine exactly once. Engine IO mocked; no live trading.',
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
