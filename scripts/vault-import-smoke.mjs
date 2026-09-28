import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { Wallet } from 'ethers';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({ entryPoints: ['src/privacy/vault.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createPrivacyVault } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const phrase = 'test test test test test test test test test test test junk';
const owner = Wallet.fromPhrase(phrase).address;
const password = 'privacy password 42!';
const first = (await createPrivacyVault({ password, walletAddress: owner })).vault;
const second = (await createPrivacyVault({ password, walletAddress: owner })).vault;
const other = (await createPrivacyVault({ password, walletAddress: Wallet.createRandom().address })).vault;
const profile = await mkdtemp(path.join(os.tmpdir(), 'vault-import-test-'));
let browser;
try {
  const extension = path.resolve('dist');
  browser = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.CHROME_BIN ?? '/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 400, height: 700 },
  });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  const url = `chrome-extension://${new URL(worker.url()).hostname}/popup.html`;
  await page.goto(url);
  const runtime = (action, args = {}) => { console.log('Testing', action); return page.evaluate(async ({ action, args }) => {
    const result = await chrome.runtime.sendMessage({ action, ...args });
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  }, { action, args }); };
  const account = () => page.evaluate(async owner => (await chrome.storage.local.get('privacyAccounts')).privacyAccounts[owner.toLowerCase()], owner);
  await runtime('IMPORT_WALLET', { phrase, password: 'main password 42!' });
  await assert.rejects(runtime('IMPORT_PRIVACY_VAULT', { vault: [other, first], password: 'wrong' }), /密码错误/);
  assert.equal((await runtime('IMPORT_PRIVACY_VAULT', { vault: [other, first], password })).status, 'imported');
  const original = await account();
  // A real encrypted IndexedDB state must remain byte-for-byte intact on repeats.
  const marker = await page.evaluate(async original => {
    const source = await crypto.subtle.importKey('raw', new TextEncoder().encode('privacy password 42!'), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(original.stateEncryption.salt), c => c.charCodeAt(0)), iterations: original.stateEncryption.iterations }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = Array.from(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode('synced notes and cursor'))));
    const record = { id: 'import-regression-marker', ciphertext, nonce: Array.from(nonce) };
    const request = indexedDB.open('brush-privacy-wallet', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('privacy_states', { keyPath: 'id' });
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('privacy_states', 'readwrite'); tx.objectStore('privacy_states').put(record); tx.oncomplete = resolve; tx.onerror = reject; });
    db.close(); return record;
  }, original);
  const historyMarker = { id: 'old-history', walletAddress: owner, chainId: 143, state: 'confirmed', createdAt: 1, updatedAt: 1, txHashes: [] };
  await page.evaluate(async row => chrome.storage.local.set({ privacyActivityHistory: [row] }), historyMarker);
  assert.equal((await runtime('IMPORT_PRIVACY_VAULT', { vault: [other, first], password })).status, 'already_imported');
  assert.deepEqual(await account(), original);
  await assert.rejects(runtime('IMPORT_PRIVACY_VAULT', { vault: first, password: 'wrong' }), /密码错误/);
  await page.evaluate(async owner => chrome.storage.local.set({ privacyOperationJournal: [{ id: 'pending', walletAddress: owner, state: 'submitted' }] }), owner);
  await assert.rejects(runtime('IMPORT_PRIVACY_VAULT', { vault: second, password }), /待确认交易/);
  assert.deepEqual(await account(), original);
  await page.evaluate(async () => chrome.storage.local.set({ privacyOperationJournal: [] }));
  const preview = await runtime('IMPORT_PRIVACY_VAULT', { vault: second, password });
  assert.equal(preview.status, 'confirmation_required');
  assert.deepEqual(await account(), original);
  assert.equal((await runtime('IMPORT_PRIVACY_VAULT', { vault: second, password, confirmation: 'stale' })).status, 'confirmation_required');
  assert.deepEqual(await account(), original);
  assert.equal((await runtime('IMPORT_PRIVACY_VAULT', { vault: second, password, confirmation: preview.confirmation })).status, 'imported');
  assert.notEqual((await account()).rawAddressHex, original.rawAddressHex);
  assert.deepEqual(await page.evaluate(async () => (await chrome.storage.local.get('privacyActivityHistory')).privacyActivityHistory), []);
  const restore = await runtime('IMPORT_PRIVACY_VAULT', { vault: first, password });
  await runtime('IMPORT_PRIVACY_VAULT', { vault: first, password, confirmation: restore.confirmation });
  assert.deepEqual(await account(), original);
  assert.deepEqual(await page.evaluate(async () => (await chrome.storage.local.get('privacyActivityHistory')).privacyActivityHistory), [historyMarker]);
  const recovered = await page.evaluate(async () => {
    const request = indexedDB.open('brush-privacy-wallet', 1);
    const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    const data = await new Promise(resolve => { const query = db.transaction('privacy_states').objectStore('privacy_states').get('import-regression-marker'); query.onsuccess = () => resolve(query.result); });
    db.close(); return data;
  });
  assert.deepEqual(recovered, marker);
  await runtime('LOCK_PRIVACY');
  await page.reload();
  await page.getByRole('button', { name: '随时导入恢复' }).click();
  await page.getByLabel('加密 vault JSON').fill(JSON.stringify(second));
  await page.getByPlaceholder('输入独立隐私密码', { exact: true }).fill(password);
  await page.getByPlaceholder('再次输入隐私密码').fill(password);
  await page.getByRole('button', { name: '导入加密 Vault', exact: true }).click();
  await page.getByText('确认替换隐私账户', { exact: true }).waitFor();
  await mkdir('artifacts/ui', { recursive: true });
  await page.screenshot({ path: 'artifacts/ui/vault-replacement-confirmation.png', fullPage: true });
  await page.getByRole('button', { name: '取消，保留当前账户' }).click();
  assert.deepEqual(await account(), original);
  await page.getByLabel('加密 vault JSON').fill(JSON.stringify([other, first]));
  await page.getByRole('button', { name: '导入加密 Vault', exact: true }).click();
  await page.getByText('该隐私账户已导入，无需重复导入。现有密码、余额、凭证及同步进度均已保留。', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/ui/vault-already-imported.png', fullPage: true });
  assert.deepEqual(await account(), original);
  console.log('Vault import smoke passed: array selection, password validation, duplicate preservation, confirmation, stale confirmation, replacement, restore, IndexedDB preservation, UI cancellation and duplicate result.');
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
