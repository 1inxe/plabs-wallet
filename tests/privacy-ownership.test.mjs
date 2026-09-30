import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const background = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
const source = background.slice(background.indexOf('const proveDappPrivacyOwnership ='), background.indexOf('const DAPP_OPERATIONS_KEY'));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const address = '12'.repeat(43);
function harness() {
  const state = { approved: true, changed: false, cancelled: false, calls: 0, approvals: 0, afterProof: false };
  const scope = {
    RpcError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
    parsePrivacyAddress: value => { if (!/^(0x)?[0-9a-f]{86}$/i.test(value)) throw new Error('invalid address'); return value.replace(/^0x/, '').toLowerCase(); },
    readContext: async () => ({ account: 'evm-account', privacyAddress: `0x${address}` }),
    assertReadContext: async () => { if (state.changed) throw new Error('context changed'); },
    assertDappNotCancelled: () => { if (state.cancelled) throw new Error('cancelled'); },
    requestApproval: async review => { state.approvals++; assert.equal(review.origin, 'https://example.com'); assert.ok(review.details.消息); return state.approved; },
    callPrivacyEngine: async (action, params) => { state.calls++; assert.equal(action, 'PRIVACY_PROVE_OWNERSHIP'); assert.equal(params.rawAddress, address); if (state.afterProof) state.changed = true; return { version: 'bjj-schnorr-v1' }; },
  };
  return { state, run: new Function('scope', `with (scope) { ${compiled}; return proveDappPrivacyOwnership; }`)(scope), input: [{ message: 'test challenge', privacyAddress: `0x${address}` }] };
}
test('ownership proof requires a separate approval and binds the expected address', async () => {
  const h = harness(); assert.deepEqual(await h.run('https://example.com', h.input), { version: 'bjj-schnorr-v1' }); assert.equal(h.state.calls, 1); assert.equal(h.state.approvals, 1);
});
test('rejects malformed and mismatched requests before approval or proving', async () => {
  for (const input of [[], [{ message: '', privacyAddress: address }], [{ message: 'a'.repeat(8193), privacyAddress: address }], [{ message: 'test', privacyAddress: '34'.repeat(43) }], [{ message: 'test', privacyAddress: address, seed: 'forbidden' }]]) {
    const h = harness(); await assert.rejects(h.run('https://example.com', input)); assert.equal(h.state.calls, 0); assert.equal(h.state.approvals, 0);
  }
});
test('denial, cancellation and context changes prevent proof generation or disclosure', async () => {
  for (const mode of ['approved', 'cancelled', 'changed', 'afterProof']) {
    const h = harness(); h.state[mode] = mode !== 'approved';
    await assert.rejects(h.run('https://example.com', h.input)); assert.equal(h.state.calls, mode === 'afterProof' ? 1 : 0);
  }
});
test('bundled official WASM generates the expected public proof with synthetic keys', async () => {
  const root = new URL('../public', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL(`${root}/wasm/asset-manifest.json`), 'utf8'));
  const wasm = await import(`${root}${manifest.module_url}`);
  wasm.initSync({ module: readFileSync(new URL(`${root}${manifest.wasm_url}`)) });
  const keys = wasm.keys({ seed_hex: '11'.repeat(32), account_id: 0, bip44_coin_type: 60 });
  const proof = wasm.privacy_address_ownership_sign_wasm({ bn254_ivk_hex: keys.bn254_ivk_hex, raw_address_hex: keys.raw_address_hex, message: 'Synthetic qualification challenge' });
  assert.equal(proof.version, 'bjj-schnorr-v1');
  assert.deepEqual(Object.keys(proof).sort(), ['r_x_hex', 'r_y_hex', 's_hex', 'version']);
  for (const field of ['r_x_hex', 'r_y_hex', 's_hex']) assert.match(proof[field], /^[0-9a-f]{64}$/i);
});
