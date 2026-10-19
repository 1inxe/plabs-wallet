import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { keccak256, toUtf8Bytes } from 'ethers';

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
const { JubjubEngine } = await import('../src/privacy/jubjub/engine.ts');
const { JUBJUB, canonical, validateProfile, campaignIntent, fundingEnvelope, parseRequest, sameIntent, object, wire } = await import('../src/privacy/jubjub/protocol.ts');
const { open, seal, journalId, reservedInputs } = await import('../src/privacy/jubjub/journal.ts');
const { NOTE_ADDED_TOPIC } = await import('../src/privacy/events.ts');
const rawPrivacy = '12'.repeat(43), scalar = '01'.repeat(32), inputCmx = '23'.repeat(32), targetCmx = '34'.repeat(32), changeCmx = '45'.repeat(32);
const txHash = `0x${'67'.repeat(32)}`;
const id = `0x${'89'.repeat(32)}`;
function profile() {
  const rules = { auctionOnly: true, auctionSeats: 1623, chainId: 143, custody: { asset: 'P20', bidStepUnits: '50000000', decimals: 6, recipientRaw: JUBJUB.recipient, settlement: 'pay-as-bid' }, enabled: true, endsAt: 2000, id: 'jubjub-p20-mainnet-test', market: JUBJUB.pool, paymentPool: JUBJUB.pool, reserveUnits: '100000000', staged: true, startsAt: 1, title: 'JubJub' };
  return { rules, rulesHash: keccak256(toUtf8Bytes(canonical(rules))), apiBase: '/nft-jubjub/v1', testnet: false, secondaryEnabled: false, indexerUrl: JUBJUB.indexer, collectorRaw: JUBJUB.recipient, feeSymbol: 'P20', feePolicy: { priceMode: 'sponsored', fixedUnits: '0', marginBps: 0 } };
}
const note = (cmx, amount, recipient) => ({ cmx_hex: cmx, value_sats: amount, recipient_raw_address_hex: recipient, rho_hex: scalar, psi_hex: '02'.repeat(32), rcm_hex: '03'.repeat(32) });
const action = cmx => ({ cmx: `0x${cmx}`, enc_ciphertext: '0x0102', out_ciphertext: '0x0304', ephemeral_key: `0x${scalar}`, nullifier: `0x${scalar}`, proof_bn254: '0x0102', pub_fields_bn254: Array(8).fill(`0x${scalar}`) });
function harness() {
  const config = profile(), expected = validateProfile(config);
  const intent = { id, status: 'prepared', total: '100000000', delta: '100000000', version: 0, psi: '0x10' };
  const me = { summary: { campaignId: config.rules.id, rulesHash: config.rulesHash, phase: 'bidding', bidPaused: false, serverTime: 1000 }, intents: [intent], jobs: [] };
  const approved = campaignIntent(me, id, expected);
  let journal = { schema: 1, records: [] };
  const state = { prove: 0, funds: 0, paths: 0, authorized: true, head: 110n, accept: false, unknown: false, receiptBad: false, notes: [{ cmxHex: inputCmx, nullifierHex: scalar, valueSats: '150000000', confirmed: true, spent: false, ownedNote: {} }], afterProve: null };
  const proof = { funding_notes: [note(targetCmx, 100000000, JUBJUB.recipient)], output_note: note(changeCmx, 50000000, rawPrivacy), bundle: { actions: [action(targetCmx), action(changeCmx)], binding_proof_bn254: Array(8).fill(`0x${scalar}`) } };
  const ports = {
    guard: async () => { if (!state.authorized) throw new Error('context changed'); },
    load: async () => structuredClone(journal),
    save: async value => { journal = structuredClone(value); },
    api: async (path, body) => {
      if (path === '/config') return structuredClone(config);
      if (path === '/me') return structuredClone(me);
      if (path === '/bids/prepare') return structuredClone(me.intents.find(i => i.id === body.id));
      if (path === '/bids/fund') {
        state.funds++;
        assert.equal(journal.records.at(-1).attempted, true, 'proof is durable before submit');
        assert.deepEqual(body, { intentId: me.intents.at(-1).id, material: journal.records.at(-1).material, envelope: journal.records.at(-1).envelope });
        const job = { id: `job-${state.funds}`, purpose: 'bid', intentId: body.intentId, status: 'submitted', txHash };
        me.jobs.push(job);
        if (state.accept) me.intents.find(i => i.id === body.intentId).status = 'funded';
        if (state.unknown) throw new Error('timeout after accepted');
        return job;
      }
      throw new Error(`Unexpected ${path}`);
    },
    prove: async (method, body) => {
      state.prove++;
      assert.equal(method, 'prove_note');
      assert.equal(body.spend_notes.length, 1);
      assert.equal(body.transfer_output.memo_hex, `0x5045524332302d4a55424a55422d5032302d763100${approved.psi}`);
      assert.equal(body.transfer_output.recipient_raw_address_hex, JUBJUB.recipient);
      assert.equal(body.transfer_output.value_sats, Number(me.intents.at(-1).delta));
      state.afterProve?.();
      return structuredClone(proof);
    },
    notes: async () => state.notes,
    paths: async () => { state.paths++; return [{ anchor_hex: `0x${scalar}`, position: 0, siblings: Array(32).fill(scalar) }]; },
    view: async method => method === 'isSpent' ? true : method === 'maxActions' ? 4n : `0x${scalar}`,
    frozen: async () => [],
    rpc: async (method, args) => {
      if (method === 'eth_chainId') return '0x8f';
      if (method === 'eth_getBlockByNumber') return { hash: args[0] === '0x0' ? JUBJUB.genesis : 'canonical' };
      if (method === 'eth_blockNumber') return `0x${state.head.toString(16)}`;
      if (method === 'eth_getTransactionReceipt') return { status: '0x1', to: JUBJUB.pool, blockNumber: '0x64', blockHash: 'canonical', logs: (state.receiptBad ? [targetCmx] : [targetCmx, changeCmx]).map(cmx => ({ address: JUBJUB.pool, topics: [NOTE_ADDED_TOPIC, `0x${cmx}`] })) };
      throw new Error('unexpected RPC');
    },
  };
  const engine = new JubjubEngine(ports);
  return { config, expected, me, approved, proof, state, engine, ports, journal: () => journal, run: () => engine.fund('https://local.example', approved, expected, 'synthetic-seed', rawPrivacy) };
}

test('validates canonical official custody rules, request shape and precision', () => {
  const c = profile();
  assert.equal(validateProfile(c).recipient, JUBJUB.recipient);
  for (const change of [v => { v.rules.custody.recipientRaw = rawPrivacy; }, v => { v.feePolicy.fixedUnits = '1'; }, v => { v.rulesHash = `0x${scalar}`; }]) {
    const bad = structuredClone(c); change(bad); assert.throws(() => validateProfile(bad));
  }
  assert.deepEqual(parseRequest({ intentId: id, token: 'synthetic-token' }), { intentId: id, token: 'synthetic-token' });
  assert.throws(() => parseRequest({ intentId: id, token: 't', recipient: rawPrivacy }));
  assert.deepEqual(wire({ x: new Uint8Array([1, 2]), y: 1n }), { x: [1, 2], y: 1 });
  assert.throws(() => wire(9007199254740992n));
});
test('single-input memo proof is saved before sponsored funding and discloses only public result', async () => {
  const h = harness(), result = await h.run();
  assert.equal(result.state, 'pending');
  assert.equal(h.state.prove, 1); assert.equal(h.state.funds, 1);
  assert.ok(Object.keys(result).every(k => ['intentId', 'state', 'jobId', 'txHash', 'message'].includes(k)));
  assert.ok(!JSON.stringify(h.journal()).includes('synthetic-seed'));
  assert.deepEqual([...reservedInputs(h.journal())], [inputCmx]);
});
test('unknown HTTP outcome resumes the server job without proving or paying again', async () => {
  const h = harness(); h.state.unknown = true;
  assert.equal((await h.run()).state, 'pending');
  h.state.unknown = false; h.state.head = 111n; h.me.intents[0].status = 'funded';
  assert.equal((await h.run()).state, 'confirmed');
  assert.equal(h.state.prove, 1); assert.equal(h.state.funds, 1);
});
test('a bid funded outside this wallet still needs 12 canonical confirmations', async () => {
  const h = harness(); h.me.intents[0].status = 'funded';
  h.me.jobs.push({ id: 'imported-job', purpose: 'bid', intentId: id, status: 'confirmed', txHash });
  assert.equal((await h.run()).state, 'pending');
  h.state.head = 111n;
  assert.equal((await h.run()).state, 'confirmed');
  assert.equal(h.state.prove, 0); assert.equal(h.state.funds, 0);
});
test('a saved proof with no known job can only resubmit the exact same envelope', async () => {
  const h = harness(); const original = h.ports.api;
  h.ports.api = async (path, body) => { if (path === '/bids/fund') { h.state.funds++; throw new Error('network unavailable'); } return original(path, body); };
  await h.run(); const saved = JSON.stringify(h.journal().records[0].envelope);
  h.ports.api = original; await h.run();
  assert.equal(h.state.prove, 1); assert.equal(h.state.funds, 2);
  assert.equal(JSON.stringify(h.journal().records[0].envelope), saved);
});
test('chain depth, expected outputs and campaign acceptance are all required', async () => {
  const h = harness(); h.state.accept = true;
  assert.equal((await h.run()).state, 'pending');
  h.state.head = 111n; h.state.receiptBad = true;
  await assert.rejects(h.run(), /输出/);
  h.state.receiptBad = false;
  assert.equal((await h.run()).state, 'confirmed');
});
test('an unconfirmed reverted receipt cannot permanently fail a reorged transaction', async () => {
  const h = harness(), original = h.ports.rpc;
  h.ports.rpc = async (method, args) => { const value = await original(method, args); return method === 'eth_getTransactionReceipt' ? { ...value, status: '0x0' } : value; };
  assert.equal((await h.run()).state, 'pending');
  h.ports.rpc = original; h.state.head = 111n; h.me.intents[0].status = 'funded';
  assert.equal((await h.run()).state, 'confirmed');
});
test('old funded record reconciles before another top-up, without unlocking an unconfirmed record', async () => {
  const h = harness(); await h.run();
  h.me.intents[0].status = 'funded';
  const next = { ...h.me.intents[0], id: `0x${'90'.repeat(32)}`, status: 'prepared', version: 1, total: '200000000' };
  h.me.intents.push(next);
  const approved = campaignIntent(h.me, next.id, h.expected);
  await assert.rejects(h.engine.fund('https://local.example', approved, h.expected, 'synthetic-seed', rawPrivacy), /未确认/);
  h.state.head = 111n;
  h.state.notes[0].cmxHex = '24'.repeat(32);
  await h.engine.fund('https://local.example', approved, h.expected, 'synthetic-seed', rawPrivacy);
  assert.equal(h.journal().records[0].state, 'confirmed');
  assert.equal(h.journal().records.length, 2);
});
test('changed intent, insufficient note and cancelled context never fund', async () => {
  const changed = harness(); changed.me.intents[0].psi = '0x99';
  await assert.rejects(changed.run(), /确认内容/); assert.equal(changed.state.prove, 0);
  const short = harness(); short.state.notes[0].valueSats = '99999999';
  await assert.rejects(short.run(), /足额/); assert.equal(short.state.prove, 0);
  const cancelled = harness(); cancelled.state.afterProve = () => { cancelled.state.authorized = false; };
  await assert.rejects(cancelled.run(), /context changed/); assert.equal(cancelled.state.funds, 0);
});
test('output amount, recipient and commitment mismatches stop funding', async () => {
  for (const change of [p => { p.output_note.value_sats++; }, p => { p.output_note.recipient_raw_address_hex = JUBJUB.recipient; }, p => { p.funding_notes[0].cmx_hex = '99'.repeat(32); }]) {
    const h = harness(); change(h.proof);
    await assert.rejects(h.run()); assert.equal(h.state.funds, 0);
  }
  const h = harness();
  h.proof.funding_notes[0].rho_hex = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
  const wireNote = fundingEnvelope(h.proof, 100000000n, 150000000n, rawPrivacy).material.note;
  assert.equal(wireNote.rho_hex, `0x${Array.from({ length: 32 }, (_, i) => (31 - i).toString(16).padStart(2, '0')).join('')}`);
  assert.equal(wireNote.cmx_hex, `0x${targetCmx}`);
});
test('server confirms transaction with campaign error: return actionable status without another payment', async () => {
  const h = harness(); await h.run();
  Object.assign(h.me.jobs[0], { status: 'confirmed', error: 'Campaign settlement needs review' });
  const result = await h.run();
  assert.match(result.message, /Campaign settlement needs review/);
  assert.equal(result.state, 'pending'); assert.equal(h.state.funds, 1);
});
test('journal is encrypted with privacy-address-bound authenticated data', async () => {
  const h = harness(); await h.run();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const keyId = journalId(rawPrivacy);
  const box = await seal(h.journal(), keyId, key);
  assert.ok(!JSON.stringify(box).includes(targetCmx));
  assert.deepEqual(await open(box, keyId, key), h.journal());
  await assert.rejects(open(box, journalId(JUBJUB.recipient), key));
});

const background = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
const handlerSource = background.slice(background.indexOf('const fundJubjubBid ='), background.indexOf('const dexRequest ='));
const handlerCompiled = ts.transpileModule(handlerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function approvalHarness() {
  const h = harness();
  const state = { allowed: true, changed: false, signatures: 0, proofs: 0, funding: 0, foreign: false, mismatch: false, afterSignature: false };
  const scope = {
    parseJubjubRequest: parseRequest,
    queueTransaction: f => f(),
    requireApprovedOrigin: async () => {},
    requireUnlocked: () => ({ address: '0xevm', signMessage: async message => { assert.equal(message, 'official authentication challenge'); state.signatures++; if (state.afterSignature) state.changed = true; return 'synthetic-signature'; } }),
    requirePrivacyUnlocked: async () => {},
    selectedChainId: async () => 143,
    transactionSettings: async () => ({ experimentalPrivacyWrites: true }),
    privacyAccountState: async () => ({ privacyAddress: rawPrivacy }),
    privacyAccountFor: async () => ({ rawAddressHex: rawPrivacy }),
    privacySessionSecret: { seedHex: 'synthetic-seed' },
    parsePrivacyAddress: value => value,
    permissionEpoch: new Map(), operationEpoch: 1, pendingAuthorizationChanges: false,
    assertDappNotCancelled: () => { if (state.changed) throw new Error('context changed'); },
    checkDappContext: async () => { if (state.changed) throw new Error('context changed'); },
    validateJubjubProfile: validateProfile, campaignIntent, sameJubjubIntent: sameIntent, jubjubObject: object,
    jubjubApi: async (path, token, body) => {
      if (path === '/config') return h.config;
      if (path === '/me') {
        if (token === 'web-token') return h.me;
        assert.equal(token, 'wallet-token');
        if (state.foreign) return { ...h.me, intents: [] };
        if (state.mismatch) return { ...h.me, intents: [{ ...h.me.intents[0], delta: '50000000' }] };
        return h.me;
      }
      if (path === '/auth/challenge') { assert.deepEqual(body, { evm: '0xevm', raw: rawPrivacy }); return { id: 'auth-id', message: 'official authentication challenge' }; }
      if (path === '/auth/session') { assert.deepEqual(body, { id: 'auth-id', signature: 'synthetic-signature', proof: { version: 'bjj-schnorr-v1' } }); return { token: 'wallet-token', expires: Date.now() / 1000 + 600 }; }
      throw new Error(`unexpected ${path}`);
    },
    requestApproval: async review => { assert.match(review.details.本次加注, /100000000/); return state.allowed; },
    formatUnits: value => value,
    callPrivacyEngine: async (action, params) => {
      if (action === 'PRIVACY_PROVE_OWNERSHIP') { state.proofs++; assert.equal(params.rawAddress, rawPrivacy); return { version: 'bjj-schnorr-v1' }; }
      assert.equal(action, 'PRIVACY_JUBJUB_FUND'); assert.equal(params.token, 'wallet-token'); state.funding++;
      return { intentId: id, state: 'pending' };
    },
    privacyMerges: { activeFor: async () => false }, activeDappUi: null, syncForMerge: async () => {},
    RpcError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
  };
  const run = new Function('scope', `with (scope) { ${handlerCompiled}; return fundJubjubBid; }`)(scope);
  return { state, run: () => run('https://local.example', { intentId: id, token: 'web-token' }) };
}
test('wallet authenticates independently and sends only its own token to the fund engine', async () => {
  const h = approvalHarness(); assert.equal((await h.run()).state, 'pending');
  assert.equal(h.state.signatures, 1); assert.equal(h.state.proofs, 1); assert.equal(h.state.funding, 1);
});
test('approval denial, a foreign token, changed intent and context changes cannot fund', async () => {
  const denied = approvalHarness(); denied.state.allowed = false; await assert.rejects(denied.run()); assert.equal(denied.state.signatures, 0);
  for (const mode of ['foreign', 'mismatch', 'afterSignature']) {
    const h = approvalHarness(); h.state[mode] = true;
    await assert.rejects(h.run()); assert.equal(h.state.funding, 0);
  }
});
