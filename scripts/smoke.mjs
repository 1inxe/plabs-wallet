import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { verifyMessage, Wallet } from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'dist');
const artifacts = path.join(root, 'artifacts', 'extension');
const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'plabs-wallet-test-'));
await mkdir(artifacts, { recursive: true });
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    executablePath: process.env.CHROME_BIN ?? '/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 400, height: 700 },
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  const pageErrors = []; popup.on('pageerror', error => pageErrors.push(error.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('heading', { name: '生成去中心化助记词' }).waitFor();
  await popup.getByPlaceholder('设置钱包主密码').fill('smoke test password 42!');
  await popup.getByPlaceholder('再次输入钱包主密码').fill('smoke test password 42!');
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: '立即生成并备份助记词' }).click();
  await popup.getByRole('heading', { name: '备份助记词' }).waitFor();
  assert.equal(await popup.locator('.phrase-grid>div').count(), 12);
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: '进入钱包' }).click();
  await popup.getByRole('button', { name: '创建全新隐私账户' }).waitFor();
  await popup.screenshot({ path: path.join(artifacts, 'new-wallet.png'), fullPage: true });
  const runtime = async (action, payload = {}) => popup.evaluate(async ({ action, payload }) => {
    const response = await chrome.runtime.sendMessage({ action, ...payload });
    if (!response.ok) throw new Error(response.error?.message);
    return response.result;
  }, { action, payload });
  const firstState = await runtime('GET_STATE');
  assert.equal(firstState.accounts.length, 1);
  assert(firstState.unlocked);
  await popup.getByRole('button', { name: '选择账户' }).click();
  await popup.getByRole('button', { name: '添加账户' }).click();
  await popup.getByRole('tab', { name: '导入钱包' }).click();
  assert.equal(await popup.locator('input[type=password]').count(), 0, 'Added accounts reuse the session password');
  await popup.getByLabel('助记词', { exact: true }).fill('test test test test test test test test test test test junk');
  await popup.getByRole('button', { name: '导入并进入钱包' }).click();
  await popup.getByRole('button', { name: '创建全新隐私账户' }).waitFor();
  const secondState = await runtime('GET_STATE');
  assert.equal(secondState.accounts.length, 2);
  assert.notEqual(secondState.address, firstState.address);
  await popup.getByRole('button', { name: '选择账户' }).click();
  await popup.locator('.account-option').first().click();
  await popup.getByRole('heading', { name: '账户管理' }).waitFor({ state: 'hidden' });
  assert.equal((await runtime('GET_STATE')).address, firstState.address);
  assert.equal((await runtime('GET_STATE')).unlocked, true);

  const site = await context.newPage();
  await site.route('https://wallet-smoke.local/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Local wallet test</body></html>' }));
  await site.goto('https://wallet-smoke.local/');
  await site.waitForFunction(() => Boolean(window.plabsPrivacyWallet));
  assert.deepEqual(await site.evaluate(() => window.plabsPrivacyWallet.request({ method: 'eth_accounts' })), []);
  const connectPage = context.waitForEvent('page');
  const connect = site.evaluate(() => window.plabsPrivacyWallet.request({ method: 'eth_requestAccounts' })).catch(error => ({ error: error.message }));
  const approval = await connectPage;
  await approval.waitForURL('**/approval.html?*');
  const approvalWindow = await approval.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); return (await chrome.windows.get(tab.windowId)).type; });
  assert.equal(approvalWindow, 'popup', 'Approval must use a wallet extension popup window');
  await approval.getByRole('button', { name: '确认', exact: true }).click();
  assert.deepEqual(await connect, [firstState.address]);
  const messageHex = `0x${Buffer.from('plabs UI regression').toString('hex')}`;
  const signingPage = context.waitForEvent('page');
  const signing = site.evaluate(({ from, message }) => window.plabsPrivacyWallet.request({ method: 'personal_sign', params: [message, from] }), { from: firstState.address, message: messageHex });
  const signApproval = await signingPage;
  await signApproval.getByRole('button', { name: '确认', exact: true }).click();
  assert.equal(verifyMessage('plabs UI regression', await signing), firstState.address);
  const cancelledPage = context.waitForEvent('page');
  const cancelled = site.evaluate(async ({ from, message }) => {
    try { await window.plabsPrivacyWallet.request({ method: 'personal_sign', params: [message, from] }); return null; }
    catch (error) { return error.code; }
  }, { from: firstState.address, message: messageHex });
  const cancelApproval = await cancelledPage;
  await cancelApproval.getByRole('button', { name: '确认', exact: true }).waitFor();
  await cancelApproval.close();
  assert.equal(await cancelled, 4001, 'Closing an approval tab must reject its pending request');
  const denied = await site.evaluate(async from => { try { await window.plabsPrivacyWallet.request({ method: 'eth_sendTransaction', params: [{ from, to: from, value: '0x0' }] }); return null; } catch (error) { return error.code; } }, firstState.address);
  assert.equal(denied, 4200);
  await popup.getByRole('button', { name: '选择网络' }).click();
  await popup.getByRole('button', { name: 'Ethereum EVM 公开资产 · 支持隐私池' }).click();
  await popup.getByRole('button', { name: '选择网络' }).filter({ hasText: 'Ethereum' }).waitFor();
  assert.equal(await site.evaluate(() => window.plabsPrivacyWallet.request({ method: 'eth_chainId' })), '0x1');
  await popup.getByRole('button', { name: '设置', exact: true }).click();
  await popup.getByRole('tablist', { name: 'EVM 自动锁定', exact: true }).getByRole('tab', { name: '1h', exact: true }).click();
  await popup.getByRole('tablist', { name: '隐私自动锁定', exact: true }).getByRole('tab', { name: '4h', exact: true }).click();
  await popup.getByRole('button', { name: '保存设置' }).click();
  await popup.getByText('设置已保存').waitFor();
  assert.deepEqual(await runtime('GET_LOCK_SETTINGS'), { walletMinutes: 60, privacyMinutes: 240, lockOnBrowserClose: true });
  assert.equal((await runtime('GET_TRANSACTION_SETTINGS')).experimentalPrivacyWrites, false);
  await popup.getByRole('button', { name: '备份凭证', exact: true }).click();
  await popup.getByPlaceholder('请输入密码', { exact: true }).fill('smoke test password 42!');
  await popup.getByRole('button', { name: '验证并显示凭证' }).click();
  await popup.getByRole('button', { name: '隐藏并关闭' }).waitFor();
  assert.equal(await popup.locator('.phrase-grid>div').count(), 12);
  await popup.getByRole('button', { name: '隐藏并关闭' }).click();
  await popup.getByRole('button', { name: '撤销', exact: true }).click();
  await popup.getByText('暂无已授权网站').waitFor();
  assert.deepEqual(await site.evaluate(() => window.plabsPrivacyWallet.request({ method: 'eth_accounts' })), []);
  await popup.getByRole('button', { name: '锁定钱包', exact: true }).click();
  await popup.getByRole('heading', { name: 'Plabs Privacy Wallet' }).waitFor();
  assert.deepEqual(await popup.evaluate(() => chrome.storage.session.get(['walletUnlockSession', 'privacyUnlockSession'])), {});
  await popup.getByPlaceholder('请输入钱包主密码').fill('wrong password');
  await popup.getByRole('button', { name: '解锁钱包', exact: true }).click();
  await popup.getByText('钱包密码错误，或存在尚未统一密码的历史账户').waitFor();
  await popup.getByPlaceholder('请输入钱包主密码').fill('smoke test password 42!');
  await popup.getByRole('button', { name: '解锁钱包', exact: true }).click();
  await popup.getByRole('button', { name: '创建全新隐私账户' }).waitFor();
  assert.equal((await runtime('GET_STATE')).accounts.length, 2);
  // Private-key import must survive lock/unlock and retain its signing identity.
  const privateKey = '0x' + '02'.repeat(32);
  await popup.getByRole('button', { name: '选择账户' }).click();
  await popup.getByRole('button', { name: '添加账户' }).click();
  await popup.getByRole('tab', { name: '导入钱包', exact: true }).click();
  await popup.getByRole('tab', { name: '私钥导入', exact: true }).click();
  await popup.getByPlaceholder('输入私钥 (0x…)').fill(privateKey);
  await popup.getByRole('button', { name: '导入并进入钱包' }).click();
  await popup.getByRole('button', { name: '创建全新隐私账户' }).waitFor();
  assert.equal((await runtime('GET_STATE')).address, new Wallet(privateKey).address);
  await runtime('LOCK');
  await runtime('UNLOCK', { password: 'smoke test password 42!' });
  assert.equal((await runtime('GET_STATE')).address, new Wallet(privateKey).address);
  assert.deepEqual(await runtime('REVEAL_WALLET_SECRET', { password: 'smoke test password 42!' }), { secret: privateKey, type: 'privateKey' });
  const persisted = await popup.evaluate(() => chrome.storage.local.get(null));
  assert(!JSON.stringify(persisted).includes(privateKey), 'Private key must never be stored unencrypted');
  assert.deepEqual(pageErrors, []);
  console.log('Extension smoke passed: create/backup/import, shared password, account switching, popup connection, signing, popup-close rejection, disabled transaction RPC, network, backup authentication, permissions, auto-lock settings, lock/unlock. No transactions broadcast.');
} catch (error) { console.error(error); throw error; } finally { await context?.close(); await rm(userDataDir, { recursive: true, force: true }); }
