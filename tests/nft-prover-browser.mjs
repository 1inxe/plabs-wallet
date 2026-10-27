import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
registerHooks({
  resolve(s, c, n) {
    try {
      return n(s, c);
    } catch (e) {
      if (s.startsWith('.') && !/\.[a-z]+$/i.test(s)) return n(s + '.ts', c);
      throw e;
    }
  },
  load(u, c, n) {
    if (u.endsWith('.ts'))
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(new URL(u), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
        shortCircuit: true,
      };
    return n(u, c);
  },
});
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { browserRuntime } from './browser-runtime.mjs';
const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    res.setHeader(
      'Content-Security-Policy',
      "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self'",
    );
    if (req.url === '/harness') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Synthetic NFT proof test</title>');
      return;
    }
    const path = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader(
      'Content-Type',
      extname(path) === '.js'
        ? 'text/javascript'
        : extname(path) === '.wasm'
          ? 'application/wasm'
          : 'application/octet-stream',
    );
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium, executablePath } = await browserRuntime();
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage();
  const external = [];
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  page.on('console', (msg) => {
    if (['error', 'log'].includes(msg.type()))
      console.log('BROWSER', msg.text());
  });
  await page.goto(origin + '/harness');
  const result = await page.evaluate(async () => {
    function client(path) {
      const worker = new Worker(path, { type: 'module' }),
        pending = new Map();
      let id = 0;
      worker.onmessage = (event) => {
        const p = pending.get(event.data.id);
        if (!p) return;
        pending.delete(event.data.id);
        event.data.ok
          ? p.resolve(event.data.result)
          : p.reject(new Error(event.data.error));
      };
      worker.onerror = (event) => {
        for (const p of pending.values()) p.reject(new Error(event.message));
        pending.clear();
      };
      return (method, body) =>
        new Promise((resolve, reject) => {
          setTimeout(
            () => reject(new Error('Synthetic NFT proof request timed out')),
            180000,
          );
          pending.set(++id, { resolve, reject });
          worker.postMessage({ id, method, body });
        });
    }
    const nft = client('/nft-prover.js'),
      regular = client('/privacy-prover.js');
    const request = {
      seed_hex: '11'.repeat(32),
      bip44_coin_type: 60,
      account_id: 0,
    };
    const [newKeys, oldKeys] = await Promise.all([
      nft('keys', request),
      regular('keys', request),
    ]);
    const proof = await nft('nft_mint_prove', {
      ...request,
      chain_id: 1,
      pool_address: '0xd4adb555b62dd50eb74be7650129f5c7e010e83e',
      token_id: 1n,
    });
    const serial = (value) =>
      value instanceof Map
        ? Object.fromEntries([...value].map(([k, v]) => [k, serial(v)]))
        : ArrayBuffer.isView(value)
          ? Array.from(value)
          : Array.isArray(value)
            ? value.map(serial)
            : typeof value === 'bigint'
              ? value.toString()
              : value && typeof value === 'object'
                ? Object.fromEntries(
                    Object.entries(value).map(([k, v]) => [k, serial(v)]),
                  )
                : value;
    const a = proof.bundle.actions[0];
    const hex = (value) =>
      Array.from(value, (b) => Number(b).toString(16).padStart(2, '0')).join(
        '',
      );
    const scanned = await nft('scan', {
      bn254_ivk_hex: oldKeys.bn254_ivk_hex,
      notes: [
        {
          cmx_hex: hex(a.cmx),
          epk_hex: hex(a.ephemeral_key),
          enc_ciphertext_hex: hex(a.enc_ciphertext),
          out_ciphertext_hex: hex(a.out_ciphertext),
          nf_old_hex: hex(a.nullifier),
          cv_net_x_hex: '00'.repeat(32),
        },
      ],
    });
    const nullifiers = await nft('compute_nullifiers', {
      nk_hex: oldKeys.nk_hex,
      notes: scanned.owned_notes,
    });
    const pool = '0xd4adb555b62dd50eb74be7650129f5c7e010e83e';
    const receiver = await nft('keys', {
      ...request,
      seed_hex: '22'.repeat(32),
    });
    await nft('tree_append', {
      treeKey: pool,
      generation: 1,
      expectedStartPosition: 0,
      leaves: [{ cmx_be_hex: '0x' + hex(a.cmx), owned: true }],
    });
    const paths = await nft('tree_paths', {
      pool,
      generation: 1,
      cmxs: ['0x' + hex(a.cmx)],
    }).catch((e) => {
      throw new Error('tree paths: ' + e.message);
    });

    const transfer = await nft('prove_note', {
      ...request,
      chain_id: 1,
      pool_address: pool,
      anchor_hex: paths.rootLeHex,
      spend_notes: scanned.owned_notes,
      merkle_path_overrides: paths.overrides.map((path) => ({
        ...path,
        cmx_hex: hex(a.cmx),
        anchor_hex: paths.rootLeHex,
      })),
      transfer_output: {
        value_sats: 1,
        recipient_raw_address_hex: receiver.raw_address_hex,
      },
      max_actions: 32,
    }).catch((e) => {
      throw new Error('prove transfer: ' + e.message);
    });
    const received = await nft('scan', {
      bn254_ivk_hex: receiver.bn254_ivk_hex,
      notes: transfer.bundle.actions.map((action) => ({
        cmx_hex: hex(action.cmx),
        epk_hex: hex(action.ephemeral_key),
        enc_ciphertext_hex: hex(action.enc_ciphertext),
        out_ciphertext_hex: hex(action.out_ciphertext),
        nf_old_hex: hex(action.nullifier),
        cv_net_x_hex: '00'.repeat(32),
      })),
    });
    return serial({
      newKeys,
      oldKeys,
      proof,
      scanned,
      nullifiers,
      transfer,
      received,
      receiver,
    });
  });
  assert.equal(
    result.newKeys.raw_address_hex,
    result.oldKeys.raw_address_hex,
    'NFT and existing vault derive the same privacy address',
  );
  assert.equal(result.proof.bundle.mint_proof_bn254.length, 8);
  assert.equal(result.proof.bundle.actions.length, 1);
  assert.equal(result.proof.bundle.actions[0].enc_ciphertext.length, 580);
  assert.equal(result.proof.owned_note.value_sats, '1');
  assert.equal(
    result.proof.owned_note.recipient_raw_address_hex,
    result.oldKeys.raw_address_hex,
  );
  assert.equal(result.scanned.owned_notes.length, 1);
  assert.equal(result.scanned.owned_notes[0].value_sats, '1');
  assert.equal(result.nullifiers.nullifiers.length, 1);
  assert.equal(result.transfer.funding_notes.length, 1);
  assert.equal(result.transfer.funding_notes[0].value_sats, '1');
  assert.equal(
    result.transfer.funding_notes[0].recipient_raw_address_hex,
    result.receiver.raw_address_hex,
  );
  assert.equal(
    result.received.owned_notes.filter((n) => n.value_sats === '1').length,
    1,
    'Recipient decrypts the transferred NFT',
  );
  assert.equal(result.transfer.bundle.binding_proof_bn254.length, 8);
  const { encodeTransfer, reverseHexByByte } =
    await import('../src/privacy/operations.ts');
  const { inspectNftTransfer } = await import('../src/privacy/nft/transfer.ts');
  const review = inspectNftTransfer({
    chainId: 1,
    to: '0xd4adb555b62dd50eb74be7650129f5c7e010e83e',
    value: '0x0',
    data: encodeTransfer(result.transfer.bundle),
    tokenId: '1',
    recipient: result.receiver.raw_address_hex,
    nullifier: '0x' + reverseHexByByte(result.nullifiers.nullifiers[0]),
    outputCmx: result.transfer.funding_notes[0].cmx_hex,
  });
  assert.equal(review.tokenId, 1);
  assert.deepEqual(external, []);
  console.log(
    'PASS real local NFT mint, transfer Groth16 proofs and recipient decryption',
  );
  console.log(
    'SHAPE',
    JSON.stringify(Object.keys(result.proof)),
    Object.keys(result.proof.owned_note),
  );
  await import('node:fs/promises').then((fs) =>
    fs.writeFile('/tmp/plabs-synthetic-nft-proof.json', JSON.stringify(result)),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
