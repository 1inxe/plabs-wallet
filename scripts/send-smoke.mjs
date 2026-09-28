import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { bech32m } from '@scure/base';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? '/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage({ viewport: { width: 400, height: 740 } });
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const ownPrivacy = bech32m.encode('perc', bech32m.toWords(new Uint8Array(43).fill(7)), 1023);
const otherPrivacy = bech32m.encode('perc', bech32m.toWords(new Uint8Array(43).fill(8)), 1023);
await mkdir('artifacts/send', { recursive: true });
await page.addInitScript(({ ownPrivacy, otherPrivacy }) => {
  const address = '0x1111111111111111111111111111111111111111';
  const second = '0x2222222222222222222222222222222222222222';
  const tokenAddress = '0x3333333333333333333333333333333333333333';
  const state = { hasVault: true, unlocked: true, address, activeAccountId: 'one', accountName: '主账户', chainId: 143, networkName: 'Monad', accounts: [
    { id: 'one', name: '主账户', address, privacyAddress: ownPrivacy },
    { id: 'two', name: '备用账户', address: second, privacyAddress: otherPrivacy },
    { id: 'invalid', name: '损坏账户', address: 'invalid', privacyAddress: 'perc1invalid' },
  ] };
  const privacy = { hasAccount: true, unlocked: true, privacyAddress: ownPrivacy, recoveryMode: 'birthday', canSync: true, automaticSync: true, status: 'ready', expiresAt: Date.now() + 900000 };
  const snapshots = [{ symbol: 'P20', poolAddress: '0x59df8637654d1ecb090ab7881b703b5a856d2780', spendableBalanceRaw: '7800000' }, { symbol: 'sUSDC', poolAddress: '0xcb36e209ae44fafc75dc6820ae42d9400637f99e', spendableBalanceRaw: '34756000' }].map(item => ({ version: 1, chainId: 143, privacyAddress: ownPrivacy, decimals: 6, cursorBlock: 107286148, targetBlock: 107286148, cursorBlockHash: '0x1', syncState: 'complete', totalBalanceRaw: item.spendableBalanceRaw, totalNotes: 3, spendableNotes: 3, pendingNotes: 0, spentNotes: 0, syncedAt: Date.now(), ...item }));
  let latestPublic = null; let preparedPublic = null;
  const event = { addListener() {}, removeListener() {} };
  window.__calls = [];
  window.chrome = { tabs: { query: async () => [], onActivated: event, onUpdated: event }, windows: { onFocusChanged: event }, storage: { onChanged: event }, runtime: { getManifest: () => ({ version: '0.5.4' }), onMessage: event,
    sendMessage: async message => {
      window.__calls.push(message);
      const ok = result => ({ ok: true, result });
      switch (message.action) {
        case 'GET_STATE': return ok(state);
        case 'GET_PRIVACY_STATE': return ok(privacy);
        case 'GET_DAPP_UI_STATE': case 'GET_ACTIVE_SITE_CONNECTION': case 'GET_PENDING_PRIVACY_OPERATION': return ok(null);
        case 'GET_PUBLIC_ASSETS': return ok([
          { chainId: 143, type: 'native', address: null, symbol: 'MON', decimals: 18, balanceRaw: '10000000000000000000', formatted: '10', manuallyAdded: false },
          { chainId: 143, type: 'erc20', address: tokenAddress, symbol: 'USDC', decimals: 6, balanceRaw: '20000000', formatted: '20', manuallyAdded: true },
        ]);
        case 'GET_PRIVACY_SNAPSHOTS': case 'SYNC_PRIVACY': return ok(snapshots);
        case 'GET_VISIBLE_PRIVACY_ASSETS': return ok([]);
        case 'GET_PRIVACY_ACTIVITY': return ok({ items: [], total: 0, page: 1, pages: 1, pageSize: 20 });
        case 'GET_PRIVACY_SYNC_PROGRESS': return ok({ status: 'complete', progress: 100, message: '同步完成' });
        case 'GET_TRANSACTION_SETTINGS': return ok({ experimentalPrivacyWrites: true, privacyPaymentMode: 'native' });
        case 'GET_PUBLIC_TRANSFER_STATUS': return ok(latestPublic ? { ...latestPublic, state: 'confirmed' } : null);
        case 'PREPARE_PUBLIC_TRANSFER': {
          preparedPublic = { id: 'public-review', chainId: 143, from: address, recipient: message.recipient, tokenAddress: message.tokenAddress, symbol: message.tokenAddress ? 'USDC' : 'MON', amount: message.amount, maxGasCost: '0.0000252', nativeSymbol: 'MON', expiresAt: Date.now() + 120000 };
          return ok(preparedPublic);
        }
        case 'SUBMIT_PUBLIC_TRANSFER': latestPublic = { ...preparedPublic, state: 'pending', txHash: '0x' + 'ab'.repeat(32) }; return ok(latestPublic);
        case 'GET_PRIVACY_FEE_QUOTE': return ok({ kind: 'send', chainId: 143, paymentMode: 'native', feePool: message.poolAddress, feeRaw: '0', feeDecimals: 6, feeSymbol: snapshots.find(item => item.poolAddress === message.poolAddress)?.symbol ?? 'P20', feeCollector: address, options: [] });
        case 'PREPARE_PRIVACY_OPERATION': return ok({ id: 'privacy-review', kind: 'send', network: 'Monad', symbol: 'sUSDC', amount: message.amount, fee: '0', receive: message.amount, recipient: message.recipient, paymentMode: 'native', nativeSymbol: 'MON', feeSymbol: 'sUSDC', receiveSymbol: 'sUSDC', totalDebit: message.amount, approvalCount: 0, estimatedGas: '21000', maxGasCost: '0.0000252', feeIncluded: false });
        case 'SUBMIT_PRIVACY_OPERATION': return ok({ id: message.id, state: 'confirmed', txHash: '0x' + 'cd'.repeat(32) });
        default: return { ok: false, error: { message: `Unmocked action: ${message.action}` } };
      }
    },
  } };
}, { ownPrivacy, otherPrivacy });
const calls = action => page.evaluate(action => window.__calls.filter(item => item.action === action), action);
const snap = async name => { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `artifacts/send/${name}.png`, fullPage: true }); };
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
try {
  await page.goto(process.env.UI_URL ?? 'http://127.0.0.1:5173/popup.html');
  await page.getByRole('button', { name: '查看 MON 资产详情', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('heading', { name: '选择收款地址', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '发送给 损坏账户' }).count(), 0);
  const search = page.getByLabel('搜索账户或输入收款地址');
  await search.fill('0x0000000000000000000000000000000000000000');
  assert.equal(await page.getByRole('button', { name: '使用此地址' }).count(), 0);
  await search.fill('备用');
  await snap('public-recipient');
  await page.getByRole('button', { name: '发送给 备用账户', exact: true }).click();
  await page.getByRole('heading', { name: '发送 MON', exact: true }).waitFor();
  assert.equal((await calls('PREPARE_PUBLIC_TRANSFER')).length, 0);
  await page.getByLabel('公开发送金额').fill('11');
  assert(await page.getByRole('button', { name: '下一步：确认发送' }).isDisabled());
  await page.getByLabel('公开发送金额').fill('1');
  await snap('public-amount');
  await page.getByRole('button', { name: '下一步：确认发送' }).click();
  await page.getByRole('heading', { name: '确认公开转账' }).waitFor();
  const first = (await calls('PREPARE_PUBLIC_TRANSFER'))[0];
  assert.equal(first.recipient, '0x2222222222222222222222222222222222222222');
  assert.equal(first.tokenAddress, null);
  assert.equal((await calls('SUBMIT_PUBLIC_TRANSFER')).length, 0);
  await snap('public-review');
  await page.getByRole('button', { name: '确认并发送' }).click();
  await page.getByRole('heading', { name: '交易已确认' }).waitFor();
  assert.equal((await calls('SUBMIT_PUBLIC_TRANSFER')).length, 1);
  await page.getByRole('button', { name: '返回资产详情' }).click();
  await page.getByRole('button', { name: '返回资产列表' }).click();

  await page.getByRole('button', { name: '查看 USDC 资产详情', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await search.fill('0x4444444444444444444444444444444444444444');
  await page.getByRole('button', { name: '使用此地址' }).click();
  await page.getByLabel('公开发送金额').fill('0.0000001');
  assert(await page.getByRole('button', { name: '下一步：确认发送' }).isDisabled());
  await page.getByLabel('公开发送金额').fill('1.25');
  await page.getByRole('button', { name: '下一步：确认发送' }).click();
  await page.getByRole('heading', { name: '确认公开转账' }).waitFor();
  assert.equal((await calls('PREPARE_PUBLIC_TRANSFER'))[1].tokenAddress, '0x3333333333333333333333333333333333333333');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回资产列表' }).click();

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('heading', { name: '选择发送的隐私资产' }).waitFor();
  await snap('privacy-asset');
  await page.getByRole('button', { name: /sUSDC.*可花费/ }).click();
  await page.getByRole('heading', { name: '选择隐私收款地址' }).waitFor();
  await search.fill('0x2222222222222222222222222222222222222222');
  assert.equal(await page.getByRole('button', { name: '使用此地址' }).count(), 0);
  await search.fill(otherPrivacy.slice(0, -1) + (otherPrivacy.endsWith('q') ? 'p' : 'q'));
  assert.equal(await page.getByRole('button', { name: '使用此地址' }).count(), 0);
  await search.fill('备用');
  await snap('privacy-recipient');
  await page.getByRole('button', { name: '发送给 备用账户', exact: true }).click();
  await page.getByLabel('金额', { exact: true }).waitFor();
  assert.equal((await calls('PREPARE_PRIVACY_OPERATION')).length, 0);
  await page.getByRole('button', { name: '更换收款地址' }).click();
  await search.fill(otherPrivacy);
  await page.getByRole('button', { name: '使用此地址' }).click();
  await page.getByLabel('金额', { exact: true }).fill('1.5');
  for (const width of [380, 400, 420]) { await page.setViewportSize({ width, height: 740 }); await noOverflow(); }
  await page.setViewportSize({ width: 400, height: 740 });
  await snap('privacy-amount');
  await page.getByRole('button', { name: '生成证明并预览隐私转账' }).click();
  await page.getByRole('button', { name: '确认并广播', exact: true }).waitFor();
  assert.equal((await calls('PREPARE_PRIVACY_OPERATION'))[0].recipient, otherPrivacy);
  assert.equal((await calls('PREPARE_PRIVACY_OPERATION'))[0].poolAddress, '0xcb36e209ae44fafc75dc6820ae42d9400637f99e');
  assert.equal((await calls('SUBMIT_PRIVACY_OPERATION')).length, 0);
  await snap('privacy-review');
  await page.getByRole('button', { name: '确认并广播', exact: true }).click();
  await page.getByRole('heading', { name: '交易已确认', exact: true }).first().waitFor();
  assert.equal((await calls('SUBMIT_PRIVACY_OPERATION')).length, 1);
  assert.deepEqual(errors, []);
  console.log('Send UI passed: native/ERC-20, account search, custom recipients, address validation, privacy asset/address steps, back navigation, amount validation and explicit final submission. All transactions mocked.');
} catch (error) {
  await snap('failure');
  console.error(errors, await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
