import assert from 'node:assert/strict';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

// A throwaway browser and deterministic, unfunded test seed. Network writes are blocked.
const profile = await mkdtemp(path.join(os.tmpdir(), 'plabs-dex-prover-'));
let context;
const extension = path.join(profile, 'extension');
await cp(path.resolve('dist'), extension, { recursive: true });
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
await build({
  entryPoints: [path.resolve('scripts/dex-proof-fixture.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(extension, 'dex-proof-fixture.js'),
});
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath:
      process.env.CHROME_BIN ??
      '/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https?:/, (route) => route.abort());
  const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.text().startsWith('DEX proof fixture:')) console.log(message.text());
  });
  await page.goto(`chrome-extension://${new URL(background.url()).hostname}/popup.html`);
  const liveHealth =
    process.env.DEX_LIVE_PREFLIGHT === '1'
      ? await fetch('https://app.plabs.online/dex-matcher/healthz').then((r) => r.json())
      : null;
  const result = await page.evaluate(async (liveKey) => {
    const worker = new Worker(chrome.runtime.getURL('dex-prover.js'), { type: 'module' });
    const legacyWorker = new Worker(chrome.runtime.getURL('privacy-prover.js'), { type: 'module' });
    let legacyNext = 0;
    const legacyPending = new Map();
    legacyWorker.onmessage = (event) => {
      const p = legacyPending.get(event.data.id);
      if (!p) return;
      legacyPending.delete(event.data.id);
      event.data.ok ? p.resolve(event.data.result) : p.reject(new Error(event.data.error));
    };
    const legacyCall = (method, body) =>
      new Promise((resolve, reject) => {
        const id = ++legacyNext;
        legacyPending.set(id, { resolve, reject });
        legacyWorker.postMessage({ id, method, body });
      });
    let next = 0;
    const pending = new Map();
    worker.onmessage = (event) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      pending.delete(event.data.id);
      event.data.ok ? p.resolve(event.data.result) : p.reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      for (const p of pending.values()) p.reject(new Error(event.message));
      pending.clear();
    };
    const call = (method, body) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, method, body });
      });
    try {
      const seed = '01'.repeat(32);
      const main = await call('keys', { seed_hex: seed, account_id: 0, bip44_coin_type: 60 });
      const child = await call('keys', {
        seed_hex: seed,
        account_id: 1073741825,
        bip44_coin_type: 60,
      });
      const encoded = await call('vnote_encode', {
        want_asset_hex: '0xcb36e209ae44fafc75dc6820ae42d9400637f99e',
        price_num: '1',
        price_den: '1000',
        payout_address_raw_hex: main.raw_address_hex,
        max_want: '18446744073709551615',
        fee_paid: 0,
        want_recv: 0,
      });
      const version = 'aaeba55a93a41b4221ffd0f7b6f41c83e077c331da9deb945e18e006373c6a78';
      const wasm = await import(
        chrome.runtime.getURL(`dex/wasm/${version}/privacybtc_wasm_prover.js`)
      );
      await wasm.default({
        module_or_path: chrome.runtime.getURL(`dex/wasm/${version}/privacybtc_wasm_prover_bg.wasm`),
      });
      const { runProofFixture } = await import(chrome.runtime.getURL('dex-proof-fixture.js'));
      const proofResult = await runProofFixture(wasm, call, liveKey, legacyCall);
      return {
        distinct: main.raw_address_hex !== child.raw_address_hex,
        childFields: Object.keys(child),
        encoded,
        proofResult,
      };
    } finally {
      worker.terminate();
      legacyWorker.terminate();
    }
  }, liveHealth?.material_encryption);
  const { livePreflights, ...counts } = result.proofResult;
  assert.deepEqual(counts, { proofs: 5, preflight: 2, broadcasts: 0 });
  for (const body of livePreflights) {
    const response = await fetch('https://app.plabs.online/dex-matcher/vnote/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const answer = await response.json();
    assert.equal(response.status, 200, JSON.stringify(answer));
    assert.equal(answer.ready, true, JSON.stringify(answer));
    assert.equal(answer.protocol_version, 5);
    assert.equal(answer.terms_version, 2);
  }
  if (livePreflights.length)
    console.log(
      'Official matcher accepted both synthetic encrypted order preflights. No funding or order submission performed.',
    );
  assert.equal(result.distinct, true);
  for (const field of ['bn254_ivk_hex', 'nk_hex', 'rivk_hex', 'ak_x_hex', 'ak_y_hex'])
    assert(result.childFields.includes(field));
  assert.match(result.encoded.psi_hex, /^(0x)?[0-9a-f]{64}$/i);
  assert.match(result.encoded.payout_commit_hex, /^(0x)?[0-9a-f]{64}$/i);
  console.log(
    'Packaged DEX WASM: isolated derivation, VNote v2, buy/sell funding, principal/fee recovery Groth16 proofs and encrypted preflight passed. No network or user wallet used.',
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
