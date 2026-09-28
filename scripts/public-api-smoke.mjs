import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'plabs-public-api-'));
const extension = path.resolve('dist');
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    executablePath: process.env.CHROME_BIN ?? '/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const raw = (action, args = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { action, ...args });
  const call = async (action, args) => {
    const result = await raw(action, args);
    assert(result.ok, result.error?.message);
    return result.result;
  };
  const password = 'public API smoke 42!';
  const created = await call('CREATE_WALLET', { password });
  assert.equal((await raw('GET_PUBLIC_TRANSFER_STATUS')).ok, false, 'Unbacked new account cannot transfer');
  await call('CONFIRM_WALLET_BACKUP', { accountId: created.state.activeAccountId, confirmed: true });
  assert.equal(await call('GET_PUBLIC_TRANSFER_STATUS'), null);
  for (const recipient of ['invalid', '0x' + '00'.repeat(20), 'perc1invalid']) {
    assert.equal((await raw('PREPARE_PUBLIC_TRANSFER', { chainId: 143, recipient, tokenAddress: null, amount: '1' })).ok, false);
  }
  assert.equal((await raw('SUBMIT_PUBLIC_TRANSFER', { id: 'unprepared' })).ok, false);
  const site = await context.newPage();
  await site.route('https://app.plabs.online/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Internal message boundary test</body></html>' }));
  await site.goto('https://app.plabs.online/');
  const denied = await popup.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://app.plabs.online/*' });
    const results = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: async () => {
      const responses = [];
      for (const action of ['GET_PUBLIC_TRANSFER_STATUS', 'PREPARE_PUBLIC_TRANSFER', 'SUBMIT_PUBLIC_TRANSFER']) {
        responses.push(await chrome.runtime.sendMessage({ action, id: 'fake', chainId: 143, recipient: '0x' + '11'.repeat(20), amount: '1' }));
      }
      return responses;
    } });
    return results[0].result;
  });
  assert(denied.every(result => !result.ok && result.error.message.includes('非法消息来源')));
  await call('LOCK');
  assert.equal((await raw('GET_PUBLIC_TRANSFER_STATUS')).ok, false);
  await call('UNLOCK', { password });
  assert.equal(await call('GET_PUBLIC_TRANSFER_STATUS'), null);
  console.log('Public transfer extension API passed: backup/lock gating, invalid recipients, unprepared submit rejection, website/content-script boundary, unlock recovery. No transactions signed or broadcast.');
} finally { await context?.close(); await rm(userDataDir, { recursive: true, force: true }); }
