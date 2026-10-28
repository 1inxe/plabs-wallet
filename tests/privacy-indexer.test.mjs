import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
const { NETWORKS } = await import('../src/shared/networks.ts');
const { fetchMerklePath, fetchFrozenLeaves } = await import('../src/privacy/indexer.ts');
const [p20, susdc] = NETWORKS[143].plabs.pools;
const cmx = '12'.repeat(32), root = `0x${'34'.repeat(32)}`;
const path = { frozen: true, position: 0, anchor_root: root, siblings: Array(32).fill(root) };

test('proof inputs use the pool indexer for both paths and frozen leaves', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json({ leaves: [] });
  });
  const cases = [
    [143, susdc.address.toUpperCase(), 'https://app.plabs.online/dex-indexer/quote'],
    [143, p20.address, 'https://monad-indexer.plabs.online'],
    ...NETWORKS[1].plabs.pools.map(pool => [1, pool.address, 'https://eth-indexer.plabs.online']),
  ];
  for (const [chain, pool, base] of cases) {
    await fetchMerklePath(chain, pool, cmx);
    await fetchFrozenLeaves(chain, pool);
    const [merkle, frozen] = calls.slice(-2);
    assert.equal(`${merkle.url.origin}${merkle.url.pathname}`, `${base}/merkle_path`);
    assert.equal(`${frozen.url.origin}${frozen.url.pathname}`, `${base}/frozen_leaves`);
    assert.equal(merkle.url.searchParams.get('pool'), pool.toLowerCase());
    assert.equal(merkle.url.searchParams.get('cmx'), cmx);
    assert.equal(frozen.init.credentials, 'omit');
    assert.equal(frozen.init.redirect, 'error');
    assert.equal(frozen.init.cache, 'no-store');
  }
});

test('unknown pools and unsupported networks fail before any request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected request'); });
  await assert.rejects(fetchFrozenLeaves(143, `0x${'ff'.repeat(20)}`), /审核配置/);
  await assert.rejects(fetchFrozenLeaves(8453, susdc.address), /审核配置/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('missing or pending paths give a retryable message and other errors remain failures', async t => {
  let status = 404;
  t.mock.method(globalThis, 'fetch', async () => new Response('upstream details', { status }));
  for (status of [404, 409]) {
    await assert.rejects(fetchMerklePath(143, susdc.address, cmx), error => {
      assert.match(error.message, /sUSDC.*证明路径.*同步隐私资产/);
      assert.ok(error.message.includes(String(status)));
      assert.ok(!error.message.includes(cmx));
      return true;
    });
  }
  status = 503;
  await assert.rejects(fetchMerklePath(143, susdc.address, cmx), /HTTP 503/);
  status = 404;
  await assert.rejects(fetchFrozenLeaves(143, susdc.address), /HTTP 404/);
});

const offscreen = readFileSync(new URL('../src/privacy/offscreen.ts', import.meta.url), 'utf8');
const operationSource = offscreen.slice(offscreen.indexOf('const verifiedSpendInputs ='), offscreen.indexOf('const verifiedBlock ='));
const compiled = ts.transpileModule(operationSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const checks = { rootMatches: true, validAnchor: true, exists: true, spent: false, proofs: [] };
  const note = { cmxHex: cmx, nullifierHex: '56'.repeat(32), confirmed: true, spent: false, valueSats: '1000000', ownedNote: {} };
  const scope = {
    NETWORKS, fetchMerklePath, fetchFrozenLeaves,
    session: {}, normalizeHex: value => String(value).replace(/^0x/i, '').toLowerCase(),
    addHexPrefix: value => `0x${value.replace(/^0x/i, '')}`,
    reverseHexByByte: value => value.replace(/^0x/i, '').match(/../g).reverse().join(''),
    callProver: async (method, body) => {
      if (method === 'merkle_root_from_path') return { root_le_hex: checks.rootMatches ? root : '00'.repeat(32) };
      if (method === 'init') return {};
      assert.equal(method, 'prove_note'); checks.proofs.push(body);
      return { bundle: { actions: [{ cmx }] } };
    },
    viewCall: async (_urls, _pool, method) => [{ cmxRoot: root, cmxFrozenRoot: '0x' + '00'.repeat(32), maxActions: 10n, isValidAnchor: checks.validAnchor, cmxExists: checks.exists, isSpent: checks.spent }[method]],
    loadPoolState: async () => ({ notes: [note] }),
    selectSpendNotes: state => ({ selected: state.notes }),
    ensureSafeNumber: value => Number(value), relayerInputLimit: async () => 4,
    feeGatewayInterface: { encodeFunctionData: () => '0x', decodeFunctionResult: () => ['context'] },
    rpc: async () => '0x', encodePrivacyCall: () => '0x', encodeTransfer: () => '0x',
    unshieldRecipientMeta: () => 'meta', jsonSafe: value => value,
  };
  return { checks, note, ...new Function('scope', `with (scope) { ${compiled}; return { verifiedSpendInputs, preparePrivacyOperation }; }`)(scope) };
}

test('transfer preparation routes the sUSDC fee proof independently of the sent asset', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url); urls.push(parsed);
    // Reproduce the production endpoint that does not serve sUSDC frozen leaves.
    if (parsed.hostname === 'monad-indexer.plabs.online' && parsed.pathname === '/frozen_leaves' && parsed.searchParams.get('pool') === susdc.address.toLowerCase()) return new Response('Not found', { status: 404 });
    return Response.json(parsed.pathname.endsWith('/merkle_path') ? path : { leaves: [] });
  });
  for (const asset of [p20, susdc]) {
    const h = harness();
    const preview = await h.preparePrivacyOperation({ kind: 'send', chainId: 143, poolAddress: asset.address, amountRaw: '100', recipientRawAddressHex: '78'.repeat(43), seedHex: 'synthetic', fees: { paymentMode: 'private', feePool: susdc.address, feeRaw: '1', feeCollector: '0x' + '90'.repeat(20) } });
    assert.equal(preview.relayer.path, '/transfer/submit');
    assert.equal(h.checks.proofs.length, asset === p20 ? 2 : 1);
    assert.ok(urls.some(url => url.pathname === '/dex-indexer/quote/frozen_leaves'));
  }
});

test('routed paths still require local root validation and all on-chain spend checks', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(path));
  const good = harness();
  assert.equal((await good.verifiedSpendInputs({ chainId: 143, poolAddress: susdc.address, notes: [good.note] })).length, 1);
  for (const key of ['rootMatches', 'validAnchor', 'exists', 'spent']) {
    const h = harness(); h.checks[key] = key === 'spent';
    await assert.rejects(h.verifiedSpendInputs({ chainId: 143, poolAddress: susdc.address, notes: [h.note] }));
    assert.equal(h.checks.proofs.length, 0);
  }
});
