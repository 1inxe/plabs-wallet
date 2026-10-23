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
const { createProverClient } = await import('../src/privacy/prover-client.ts');
const { createPrivacyMergeService } = await import('../src/privacy/merge.ts');
class WorkerStub {
  messages = [];
  terminated = false;
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(index, result, ok = true) {
    this.onmessage?.({ data: { id: this.messages[index].id, ok, result, error: ok ? undefined : result } });
  }
}
function workers(timeout) {
  const instances = [];
  return { instances, client: createProverClient(() => {
    const worker = new WorkerStub(); instances.push(worker); return worker;
  }, timeout) };
}

test('a crashed worker rejects every waiter and retries start a fresh worker', async () => {
  const { client, instances } = workers();
  const first = client.call('prove_note', {}), second = client.call('init', {});
  const rejected = [assert.rejects(first, /异常退出/), assert.rejects(second, /异常退出/)];
  assert.equal(client.progress().phase, 'proving');
  instances[0].onerror({ preventDefault() {} });
  await Promise.all(rejected);
  assert.equal(instances[0].terminated, true);
  assert.equal(client.progress().phase, 'idle');
  const retry = client.call('init', {});
  assert.equal(instances.length, 2);
  assert.equal(client.progress().phase, 'initializing');
  instances[1].reply(0, { status: 'ready' });
  assert.deepEqual(await retry, { status: 'ready' });
  assert.equal(client.progress().phase, 'idle');
});

test('an unresponsive prover times out, releases callers and ignores stale replies', async () => {
  const { client, instances } = workers(() => 15);
  const pending = client.call('init', {});
  const staleHandler = instances[0].onmessage;
  await assert.rejects(pending, /文件加载超时/);
  assert.equal(instances[0].terminated, true);
  const retry = client.call('prove_note', {});
  staleHandler({ data: { id: instances[0].messages[0].id, ok: true, result: 'stale' } });
  instances[1].reply(0, 'fresh');
  assert.equal(await retry, 'fresh');
});

test('message deserialization and postMessage failures both release the proof queue', async () => {
  const { client, instances } = workers();
  const pending = client.call('prove_note', {});
  const rejected = assert.rejects(pending, /无法读取/);
  instances[0].onmessageerror({});
  await rejected;
  const retry = client.call('keys', {});
  instances[1].reply(0, 'bad proof input', false);
  await assert.rejects(retry, /bad proof input/);
  instances[1].postMessage = () => { throw new Error('clone failed'); };
  await assert.rejects(client.call('init', {}), /发送失败/);
  assert.equal(instances[1].terminated, true);
});

test('failed worker bootstrap rejects requests queued before and arriving after the import failure', async () => {
  const source = readFileSync(new URL('../src/privacy/prover.worker.ts', import.meta.url), 'utf8')
    .replace("import(/* @vite-ignore */ new URL('./groth16-prover.bundle.js', self.location.href).href)", 'load()')
    .replace('export {};', '');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let rejectImport;
  const responses = [];
  const worker = { location: { origin: 'chrome-extension://test' }, postMessage: data => responses.push(data) };
  new Function('self', 'load', compiled)(worker, () => new Promise((_, reject) => { rejectImport = reject; }));
  worker.onmessage({ data: { id: 1 } });
  rejectImport(new Error('missing bundle'));
  await new Promise(resolve => setImmediate(resolve));
  worker.onmessage({ data: { id: 2 } });
  assert.deepEqual(responses.map(row => [row.id, row.ok]), [[1, false], [2, false]]);
  assert(responses.every(row => row.error.includes('missing bundle')));
});

function mergeHarness() {
  let plans = [];
  globalThis.chrome = { storage: { session: {
    get: async () => ({ privacyMergePlans: structuredClone(plans) }),
    set: async value => { plans = structuredClone(value.privacyMergePlans); },
  } } };
  const pool = '0x1234';
  let notes = Array.from({ length: 7 }, (_, i) => ({ id: `note-${i}`, confirmed: true, spent: false, valueRaw: '1000000', txHash: '' }));
  const fees = { paymentMode: 'native', feeRaw: '0', feePool: pool, feeSymbol: 'P20', feeDecimals: 6 };
  const prepared = [], submitted = [];
  const deps = {
    authorization: () => 'test-session',
    context: async () => ({ walletAddress: 'test-wallet', privacyAddress: 'test-private', symbol: 'P20', decimals: 6 }),
    mode: async () => 'native',
    inventory: async () => ({ notes: structuredClone(notes), maxInputs: 4 }),
    quote: async () => fees,
    prepare: async (plan, selected) => {
      const raw = selected.reduce((sum, note) => sum + BigInt(note.valueRaw), 0n);
      const preview = { id: `preview-${prepared.length}`, paymentMode: 'native', amount: String(Number(raw) / 1e6), maxGasWei: '20', fees };
      prepared.push({ preview, selected: structuredClone(selected) }); return preview;
    },
    hasPrepared: () => true,
    submit: async id => { submitted.push(id); return { state: 'pending', txHash: `tx-${id}` }; },
    result: async id => ({ state: 'confirmed', txHash: `tx-${id}` }),
    sync: async () => {
      const current = prepared.find(row => row.preview.id === submitted.at(-1));
      for (const note of notes) if (current.selected.some(item => item.id === note.id)) note.spent = true;
      notes.push({ id: `output-${submitted.length}`, confirmed: true, spent: false, valueRaw: String(Math.round(Number(current.preview.amount) * 1e6)), txHash: `tx-${current.preview.id}` });
    },
  };
  return { deps, prepared, submitted, input: { chainId: 143, poolAddress: pool, automatic: true, noteIds: [] },
    plans: () => plans, setPlans: value => { plans = value; } };
}

test('automatic merge previews all seven notes, then confirms two batches into one without early submission', async () => {
  const h = mergeHarness(), service = createPrivacyMergeService(h.deps);
  const plan = await service.create(h.input);
  assert.equal(plan.state, 'review');
  assert.equal(plan.initialCount, 7);
  assert.equal(plan.plannedBatches, 2);
  assert.equal(plan.gasBudgetWei, '40');
  assert.equal(h.submitted.length, 0);
  await assert.rejects(service.advance(plan.id, false), /先确认/);
  assert.equal((await service.advance(plan.id, true)).state, 'waiting');
  assert.equal((await service.advance(plan.id, false)).state, 'preparing');
  assert.equal((await service.advance(plan.id, false)).state, 'waiting');
  const final = await service.advance(plan.id, false);
  assert.equal(final.state, 'complete');
  assert.equal(final.completedBatches, 2);
  assert.equal(final.targetIds.length, 1);
  assert.equal(h.submitted.length, 2);
  assert(h.prepared.every(row => row.selected.length <= 4));
});

test('failed proof preparation cancels the initial reservation and a second click can prepare again', async () => {
  const h = mergeHarness(), normal = h.deps.prepare;
  h.deps.prepare = async () => { throw new Error('proof worker stopped'); };
  const service = createPrivacyMergeService(h.deps);
  await assert.rejects(service.create(h.input), /proof worker stopped/);
  assert.equal(h.plans()[0].state, 'cancelled');
  assert.equal(await service.activeFor('test-wallet', 143), undefined);
  h.deps.prepare = normal;
  assert.equal((await service.create(h.input)).state, 'review');
  assert.equal(h.submitted.length, 0);
});

test('worker restart clears only an interrupted initial preview, preserving submitted and valid prepared plans', async () => {
  const h = mergeHarness(), service = createPrivacyMergeService(h.deps);
  const plan = await service.create(h.input);
  h.setPlans([{ ...plan, state: 'preparing', preview: { fees: plan.preview.fees, paymentMode: 'native' } }]);
  const restarted = createPrivacyMergeService(h.deps);
  assert.equal(await restarted.activeFor('test-wallet', 143), undefined);
  assert.equal(h.plans()[0].state, 'cancelled');
  h.setPlans([{ ...plan, state: 'preparing' }]);
  assert.equal((await restarted.activeFor('test-wallet', 143)).state, 'preparing');
  h.setPlans([{ ...plan, state: 'waiting', operationId: 'already-broadcast' }]);
  assert.equal((await restarted.activeFor('test-wallet', 143)).operationId, 'already-broadcast');
});

test('a preview currently generating a proof is not mistaken for an abandoned reservation', async () => {
  const h = mergeHarness(), normal = h.deps.prepare;
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  h.deps.prepare = async (...args) => { started(); await wait; return normal(...args); };
  const service = createPrivacyMergeService(h.deps);
  const creating = service.create(h.input);
  await entered;
  assert.equal((await service.activeFor('test-wallet', 143)).state, 'preparing');
  release();
  assert.equal((await creating).state, 'review');
});
