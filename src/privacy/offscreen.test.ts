import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORKS } from '../shared/networks';
import type { PrivacyPoolState } from '../shared/types';
import { journalId, sealJournal, type DexRecord } from './dex/journal';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), save: vi.fn(), derive: vi.fn(),
}));
vi.mock('./state-store', () => ({ loadPrivacyPoolState: mocks.load, savePrivacyPoolState: mocks.save }));
vi.mock('./vault', () => ({ derivePrivacyStateKey: mocks.derive }));
const hash = `0x${'aa'.repeat(32)}`;
const cmx = '11'.repeat(32);
const pool = NETWORKS[143].plabs!.pools[1];
const deploy = NETWORKS[143].plabs!.nativeRpcSync.pools[1].deployBlock;
let listener: (message: any, sender: any, callback: (result: any) => void) => void;
let requests: any[];
let logs: any[];
let spentFails: boolean;
let stored: PrivacyPoolState;
let savedStatuses: string[];
let localRecords: Record<string, unknown>;
let stateKey: CryptoKey;

class FakeWorker {
  onmessage?: (event: any) => void;
  constructor(private url: string) {}
  postMessage(message: any) {
    let result: any;
    if (this.url.includes('native-rpc')) {
      requests.push(message.input);
      result = { envelopes: [{ batch: { abi_notes: logs } }], scanned_to_seq: deploy + 1, scanned_to_hash: hash };
    } else if (message.method === 'keys') {
      result = { raw_address_hex: '22'.repeat(43), bn254_ivk_hex: '33'.repeat(32), nk_hex: '44'.repeat(32) };
    } else if (message.method === 'scan') {
      result = { owned_notes: [{ cmx_hex: cmx, value_sats: '26956000' }] };
    } else if (message.method === 'compute_nullifiers') {
      result = { nullifiers: ['55'.repeat(32)] };
    }
    queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true, result, page: result } }));
  }
}
const call = (action: string, args = {}) => new Promise<any>((resolve) =>
  listener({ target: 'privacy-offscreen', action, ...args }, { id: 'test' }, resolve));

beforeEach(async () => {
  vi.resetModules();
  requests = []; logs = []; spentFails = false; savedStatuses = [];
  stored = {
    version: 1, chainId: 143, poolAddress: pool.address, symbol: pool.symbol, decimals: 6,
    privacyAddress: `0x${'22'.repeat(43)}`, cursorBlock: deploy, cursorBlockHash: hash,
    targetBlock: deploy, syncState: 'complete', totalBalanceRaw: '7800000', spendableBalanceRaw: '7800000',
    totalNotes: 1, spendableNotes: 1, pendingNotes: 0, spentNotes: 0, syncedAt: 1,
    notes: [{ cmxHex: '66'.repeat(32), txHash: hash, blockNumber: deploy, cmxPosition: 1,
      rawNote: {}, ownedNote: {}, nullifierHex: '77'.repeat(32), valueSats: '7800000', confirmed: true, spent: false }],
  };
  mocks.load.mockImplementation(async () => structuredClone(stored));
  mocks.save.mockImplementation(async (state) => { stored = structuredClone(state); savedStatuses.push(state.syncState); });
  stateKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  mocks.derive.mockResolvedValue(stateKey);
  localRecords = {};
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('chrome', { storage: { local: { get: async () => localRecords, set: async (value: Record<string, unknown>) => Object.assign(localRecords, value) } }, runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`,
    sendMessage: async (message: Record<string, any>) => {
      const id = journalId(message.privacyAddress);
      if (message.action === 'SAVE_DEX_JOURNAL') localRecords[id] = message.box;
      return { ok: true, result: localRecords[id] ?? null };
    },
    onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    if (method === 'eth_call') {
      if (spentFails) throw new Error('spent check unavailable');
      return { ok: true, json: async () => ({ result: '0x0' }) };
    }
    return { ok: true, json: async () => ({ result: params[0] === '0x0'
      ? { hash: NETWORKS[143].plabs!.nativeRpcSync.genesisHash }
      : { hash, number: `0x${(deploy + 1).toString(16)}` } }) };
  }));
  await import('./offscreen');
  expect((await call('PRIVACY_ENGINE_UNLOCK', { seedHex: '', password: '', birthdayBlocks: {}, recoveryMode: 'legacy-import' })).ok).toBe(true);
});

const added = () => ({ cmx: `0x${cmx}`, enc_ciphertext: '0xaabb', epk: hash, nf_old: hash, block_number: deploy + 1, tx_hash: hash });

describe('privacy balance synchronization', () => {
  it('repairs cached diversified recipients even when no new blocks need scanning', async () => {
    stored.cursorBlock = deploy + 1;
    stored.notes[0].ownedNote = { d_hex: 'ab'.repeat(11), pkd_hex: 'cd'.repeat(32), recipient_raw_address_hex: '22'.repeat(43) };
    const response = await call('PRIVACY_SYNC_POOL', { chainId: 143, poolAddress: pool.address });
    expect(response.ok).toBe(true);
    expect(requests).toHaveLength(0);
    expect(stored.notes[0].ownedNote.recipient_raw_address_hex).toBe('ab'.repeat(11)+'cd'.repeat(32));
    expect(stored.notes[0].nullifierHex).toBe('55'.repeat(32));
    expect(stored.syncState).toBe('complete');
  });
  it('keeps PEX-reserved inputs out of spendable balances while preserving total funds', async () => {
    const id = journalId(stored.privacyAddress);
    localRecords[id] = await sealJournal({ schema: 1, nextAccount: 1073741825, records: [{ state: 'funding', funding: [{ pool: pool.address, state: 'unknown', inputs: ['66'.repeat(32)] }] } as DexRecord] }, id, stateKey);
    const response = await call('PRIVACY_GET_SNAPSHOTS');
    expect(response.ok).toBe(true);
    const snapshot = response.result.find((item: PrivacyPoolState) => item.poolAddress === pool.address);
    expect(snapshot).toMatchObject({ totalBalanceRaw: '7800000', spendableBalanceRaw: '0', spendableNotes: 0 });
  });
  it('accounts for newly received pending notes separately from spendable funds', async () => {
    logs = [added()];
    const response = await call('PRIVACY_SYNC_POOL', { chainId: 143, poolAddress: pool.address });
    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ totalBalanceRaw: '34756000', spendableBalanceRaw: '7800000', pendingNotes: 1, syncState: 'complete' });
  });

  it('includes newly confirmed funds in the spendable balance', async () => {
    logs = [added(), { cmx: `0x${cmx}`, enc_ciphertext: '0x', is_confirmed: true, cmx_position: 2 }];
    const response = await call('PRIVACY_SYNC_POOL', { chainId: 143, poolAddress: pool.address });
    expect(response.result).toMatchObject({ totalBalanceRaw: '34756000', spendableBalanceRaw: '34756000', pendingNotes: 0 });
  });

  it('rescans from deployment even when a cached cursor is already at the head', async () => {
    stored.cursorBlock = deploy + 1;
    stored.notes.push({ ...stored.notes[0], cmxHex: cmx, valueSats: '26956000', cmxPosition: 2 });
    logs = [added()];
    const response = await call('PRIVACY_SYNC_POOL', { chainId: 143, poolAddress: pool.address, rescan: true });
    expect(requests[0].afterBlock).toBe(deploy - 1);
    expect(response.result).toMatchObject({ totalNotes: 2, spendableBalanceRaw: '34756000', pendingNotes: 0 });
  });

  it('never persists completion before spent-note verification succeeds', async () => {
    mocks.save.mockClear();
    logs = [added()]; spentFails = true;
    const response = await call('PRIVACY_SYNC_POOL', { chainId: 143, poolAddress: pool.address });
    expect(response.ok).toBe(false);
    expect(stored.syncState).toBe('error');
    expect(savedStatuses).toEqual(['partial', 'error']);
  });
});
