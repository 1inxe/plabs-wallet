import assert from 'node:assert/strict';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const profile = await mkdtemp(path.join(os.tmpdir(), 'plabs-note-recovery-'));
const extension = path.join(profile, 'extension');
await cp(path.resolve('dist'), extension, { recursive: true });
const { createRequire } = await import('node:module');
const req = createRequire(import.meta.url);
const { build } = createRequire(req.resolve('vite/package.json'))('esbuild');
await build({
  entryPoints: [path.resolve('src/privacy/note-address.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(extension, 'note-address-fixture.js'),
});
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath:
      process.env.CHROME_BIN ??
      '/Users/moli/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https?:/, (r) => r.abort());
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
  const report = await page.evaluate(async () => {
    const { canonicalOwnedNote } = await import(chrome.runtime.getURL('note-address-fixture.js'));
    const proofWorker = new Worker(chrome.runtime.getURL('dex-prover.js'), { type: 'module' });
    let next = 0;
    const pending = new Map();
    proofWorker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
    const prove = (body) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        proofWorker.postMessage({ id, method: 'prove_note', body });
      });
    const plain = (v) =>
      v instanceof Map
        ? Object.fromEntries([...v].map(([k, x]) => [k, plain(x)]))
        : Array.isArray(v)
          ? v.map(plain)
          : typeof v === 'bigint'
            ? Number(v)
            : v && typeof v === 'object'
              ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
              : v;
    const hx = (v) =>
      typeof v === 'string'
        ? v.replace(/^0x/, '')
        : Array.from(v, (x) => x.toString(16).padStart(2, '0')).join('');
    const currentManifest = await fetch(chrome.runtime.getURL('dex/wasm/asset-manifest.json')).then(
      (r) => r.json(),
    );
    const oldManifest = await fetch(chrome.runtime.getURL('wasm/asset-manifest.json')).then((r) =>
      r.json(),
    );
    const wasm = await import(chrome.runtime.getURL('dex' + currentManifest.module_url));
    await wasm.default({ module_or_path: chrome.runtime.getURL('dex' + currentManifest.wasm_url) });
    const legacy = await import(chrome.runtime.getURL(oldManifest.module_url.slice(1)));
    await legacy.default({ module_or_path: chrome.runtime.getURL(oldManifest.wasm_url.slice(1)) });
    const seed = '01'.repeat(32),
      pool = '0x59df8637654d1ecb090ab7881b703b5a856d2780';
    const keys = plain(wasm.keys({ seed_hex: seed, account_id: 0, bip44_coin_type: 60 }));
    const shield = wasm.shield_prepare({
      seed_hex: seed,
      amount_sats: 100000000,
      chain_id: 143,
      pool_address: pool,
      anchor_hex: '0x' + '00'.repeat(32),
      bip44_coin_type: 60,
    });
    const proof = plain(
      wasm.shield_finalize({
        prepared: shield.prepared,
        proof_hex: '0x' + '00'.repeat(256),
        binding_proof_hex: '0x' + '00'.repeat(256),
      }),
    );
    const initial = proof.owned_note;
    const createTree = (note) => {
      const tree = new wasm.WalletCommitmentTree();
      const leaves = Array.from({ length: 4905 }, () => ({
        cmx_be_hex: '0x' + '00'.repeat(31) + '01',
        owned: false,
      }));
      leaves.push({ cmx_be_hex: '0x' + hx(note.cmx_hex), owned: true });
      for (let i = 0; i < leaves.length; i += 256)
        tree.append_batch_json(JSON.stringify(leaves.slice(i, i + 256)), BigInt(i));
      return tree;
    };
    const initialTree = createTree(initial),
      initialPath = plain(initialTree.merkle_path(initial.cmx_hex));
    const sources = [['shield', initial, proof.bundle]];
    for (const diversified of [false, true])
      for (const customPsi of [false, true]) {
        const target = plain(
          wasm.keys({
            seed_hex: seed,
            account_id: 0,
            bip44_coin_type: 60,
            ...(diversified ? { diversifier_index_hex: '03'.repeat(11) } : {}),
          }),
        );
        const input = {
          seed_hex: seed,
          bip44_coin_type: 60,
          spend_notes: [initial],
          anchor_hex: initialTree.root_le_hex(),
          merkle_path_overrides: [
            { ...initialPath, cmx_hex: initial.cmx_hex, anchor_hex: initialTree.root_le_hex() },
          ],
          chain_id: 143,
          pool_address: pool,
          max_actions: 16,
          transfer_output: {
            value_sats: 50000000,
            recipient_raw_address_hex: target.raw_address_hex,
            ...(customPsi ? { psi_new_hex: '0x' + '00'.repeat(31) + '01' } : {}),
          },
        };
        const prep = wasm.prove_note_prepare(input);
        const finalized = plain(
          wasm.prove_note_finalize({
            prepared: prep.prepared,
            proof_hexes: prep.witness_inputs.map(() => '0x' + '00'.repeat(256)),
            binding_proof_hex: '0x' + '00'.repeat(256),
          }),
        );
        sources.push([
          `transfer${diversified ? ' diversified' : ''}${customPsi ? ' custom psi' : ''}`,
          finalized.funding_notes[0],
          finalized.bundle,
        ]);
      }
    initialTree.free();
    const outcomes = [];
    for (const [source, note, bundle] of sources) {
      const tree = createTree(note),
        path = plain(tree.merkle_path(note.cmx_hex));
      const raw = bundle.actions.map((a) => ({
        cmx_hex: hx(a.cmx),
        epk_hex: hx(a.ephemeral_key),
        enc_ciphertext_hex: hx(a.enc_ciphertext),
        nf_old_hex: hx(a.nullifier),
      }));
      const cases = [['full opening', note]];
      for (const [name, m] of [
        ['current scan', wasm],
        ['legacy scan', legacy],
      ])
        for (const own of [false, true]) {
          const scanned = plain(
            m.scan({
              bn254_ivk_hex: keys.bn254_ivk_hex,
              ...(own ? { own_raw_address_hex: keys.raw_address_hex } : {}),
              notes: raw,
            }),
          );
          cases.push([
            name + (own ? ' own address' : ''),
            scanned.owned_notes.find((n) => hx(n.cmx_hex) === hx(note.cmx_hex)),
          ]);
          if (own) {
            const n = cases[cases.length - 1][1];
            if (n) cases.push([name + ' repaired', canonicalOwnedNote(n)]);
          }
        }
      for (const [name, n] of cases) {
        if (!n) {
          outcomes.push({ source, name, found: false });
          continue;
        }
        try {
          const input = {
            seed_hex: seed,
            bip44_coin_type: 60,
            spend_notes: [n],
            anchor_hex: tree.root_le_hex(),
            merkle_path_overrides: [
              { ...path, cmx_hex: note.cmx_hex, anchor_hex: tree.root_le_hex() },
            ],
            chain_id: 143,
            pool_address: pool,
            max_actions: 16,
            transfer_output: {
              value_sats: 10000000,
              recipient_raw_address_hex: keys.raw_address_hex,
            },
          };
          const prepared = wasm.prove_note_prepare(input);
          if (source === 'transfer diversified' && name === 'legacy scan repaired') {
            const verified = plain(await prove(input));
            if (!verified.bundle?.actions?.length)
              throw new Error('Full repaired proof is missing actions');
          }
          outcomes.push({
            source,
            name,
            success: true,
            fullProof: source === 'transfer diversified' && name === 'legacy scan repaired',
            witnesses: prepared.witness_inputs.length,
          });
        } catch (e) {
          outcomes.push({
            source,
            name,
            success: false,
            error: String(e).replace(/(?:0x)?[a-fA-F0-9]{32,}/g, '[synthetic data hidden]'),
            differentFields: Object.keys(note).filter(
              (k) => JSON.stringify(note[k]) !== JSON.stringify(n[k]),
            ),
          });
        }
      }
      tree.free();
    }
    proofWorker.terminate();
    return outcomes;
  });
  console.log(
    JSON.stringify(
      report.filter((row) => row.success === false),
      null,
      2,
    ),
  );
  assert(
    report.some((r) => r.fullProof && r.success),
    'Repaired Note must complete Groth16 proving',
  );
  const ordinary = report.filter((r) => !r.source.includes('custom psi'));
  assert(ordinary.filter((r) => !r.name.endsWith('own address')).every((r) => r.success));
  assert(
    ordinary
      .filter((r) => r.source.includes('diversified') && r.name.endsWith('own address'))
      .every((r) => r.success === false && r.error.includes('cm_matches_stored=false')),
  );
  console.log(
    'Reproduced address-override failure; canonical address repair and default scanning recover the witness. Synthetic notes only.',
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
