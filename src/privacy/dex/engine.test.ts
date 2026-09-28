import { describe, expect, it, vi } from 'vitest';
import { DexEngine, reservedInputs, type DexPorts } from './engine';
import { NOTE_ADDED_TOPIC } from '../events';
const confirmation = { attempts: 5, intervalMs: 0, timeoutMs: 1000, sleep: async () => {} };
import {
  newJournal,
  openJournal,
  publicOrder,
  sealJournal,
  type DexJournal,
  type DexRecord,
} from './journal';
import { amounts, DEX, encryptMaterial, parseIntent, validateMarket, vnoteMemo } from './protocol';
import { getBytes, hexlify, concat, toUtf8Bytes } from 'ethers';

const intent = {
  chainId: '0x8f' as const,
  side: 'sell' as const,
  type: 'limit' as const,
  quantityRaw: '10000000',
  priceTicks: '1000',
  maxFeeRaw: '500000',
};
const health = (key: unknown) => ({
  status: 'ok',
  chain_id: 143,
  base: DEX.base,
  quote: DEX.quote,
  settlement_addr: DEX.settlement,
  base_decimals: 6,
  quote_decimals: 6,
  price_scale: 1000000,
  verify_enabled: true,
  verify_address: DEX.verifyAddress,
  dex_settlement_version: 5,
  vnote_profile: {
    protocol_version: 5,
    terms_version: 2,
    memo_version: 2,
    profile_id: 'vnote-cross-price-cap-v2',
  },
  placement_idempotency: true,
  order_terms_durable: true,
  persistence_healthy: true,
  matches_epoch: 'epoch',
  price_tick: '100',
  lot_size: 10000,
  fee_units: 500000,
  fee_pool: DEX.quote,
  material_encryption: key,
  settle_enabled: false,
});
const fixtureRecord = (): DexRecord => ({
  id: '11111111-2222-3333-4444-555555555555',
  origin: 'https://dapp.test',
  createdAt: Date.now(),
  account: 1073741825,
  intent,
  epoch: 'epoch',
  state: 'prepared',
  material: {
    fee_ticket: { value: '500000' },
    pay_pool: DEX.base,
    account_s: { nk_hex: 'secret-child-view-key' },
  },
  principalNote: {},
  feeNote: {},
  funding: [
    {
      pool: DEX.quote,
      bundle: { actions: [] },
      inputs: ['fee-input'],
      commitments: ['0x' + 'aa'.repeat(32)],
      state: 'prepared',
    },
    {
      pool: DEX.base,
      bundle: { actions: [] },
      inputs: ['base-input'],
      commitments: ['0x' + 'bb'.repeat(32)],
      state: 'prepared',
    },
  ],
});
async function fixture() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const key = {
    version: 1,
    alg: 'p256-ecdh-aes-256-gcm',
    public_key_hex: hexlify(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
  };
  let journal: DexJournal = { ...newJournal(), records: [fixtureRecord()] };
  const events: string[] = [];
  const p: DexPorts = {
    guard: vi.fn(),
    load: async () => structuredClone(journal),
    save: async (j) => {
      events.push(`save:${j.records[0].funding.map((f) => f.state).join(',')}`);
      journal = structuredClone(j);
    },
    prove: vi.fn(async () => ({})),
    http: vi.fn(async (url, body) => {
      if (url.endsWith('/healthz')) return health(key);
      if (url.endsWith('/vnote/preflight'))
        return { ready: true, protocol_version: 5, terms_version: 2 };
      if (url.endsWith('/dex/transfer/submit')) {
        events.push(`send:${(body as { contract: string }).contract}`);
        return {};
      }
      if (url.endsWith('/vnote/submit'))
        return { order_id: 'ab'.repeat(16), match_capability: 'private-capability' };
      if (url.endsWith('/orders/status'))
        return { orders: [{ order_id: 'ab'.repeat(16), pending_qty: 10000 }] };
      throw new Error('Unexpected request');
    }),
    view: vi.fn(async (_pool, method) =>
      method === 'feeAmount' ? 500000n : method === 'feeAssetPool' ? DEX.quote : false,
    ),
    rpc: async (method) => (method === 'eth_chainId' ? '0x8f' : { hash: DEX.genesis }),
    notes: async () => [],
    paths: async () => [],
    collectPayouts: vi.fn(async () => null),
  };
  const engine = new DexEngine(p, confirmation);
  return {
    p,
    engine,
    key,
    pair,
    events,
    get journal() {
      return journal;
    },
    set journal(j: DexJournal) {
      journal = j;
    },
  };
}
describe('PEX intent and disclosure boundary', () => {
  it('accepts exact order integers, rejects arbitrary recipients/proofs and unsafe amounts', () => {
    expect(parseIntent(intent)).toEqual(intent);
    expect(() => parseIntent({ ...intent, recipient: 'attacker' })).toThrow();
    expect(() => parseIntent({ ...intent, quantityRaw: '9007199254740992' })).toThrow();
    expect(() => parseIntent({ ...intent, chainId: '0x1' })).toThrow();
    expect(amounts(intent).principal).toBe(10000000n);
    expect(
      amounts({ ...intent, side: 'buy', quantityRaw: '10001', priceTicks: '1500' }).principal,
    ).toBe(16n);
  });
  it('pins protocol identity, validates fee/grid and does not infer a pause from settle_enabled', () => {
    expect(validateMarket(health({}), intent).fee).toBe(500000n);
    expect(() => validateMarket({ ...health({}), settlement_addr: DEX.base }, intent)).toThrow();
    expect(() => validateMarket(health({}), { ...intent, maxFeeRaw: '499999' })).toThrow();
    expect(() => validateMarket(health({}), { ...intent, priceTicks: '1001' })).toThrow();
  });
  it('encodes a recoverable child index and forbids root delegation', () => {
    const data = getBytes(vnoteMemo(DEX.quote, 1n, 1000n, '11'.repeat(32), 1n << 63n, 1073741825));
    expect(data.length).toBe(500);
    expect(new DataView(data.buffer).getUint32(82)).toBe(1073741825);
    expect(() => vnoteMemo(DEX.quote, 1n, 1n, '11'.repeat(32), 1n, 0)).toThrow();
  });
  it('never exposes material, order capabilities or note openings in the read model', () => {
    const record = { ...fixtureRecord(), capability: 'private-capability' };
    const serialized = JSON.stringify(publicOrder(record));
    for (const value of [
      'private-capability',
      'nk_hex',
      'secret-child',
      'principalNote',
      'feeNote',
      'bundle',
    ])
      expect(serialized).not.toContain(value);
  });
  it('uses the official ECDH + SHA256 KDF and authenticated envelope', async () => {
    const f = await fixture(),
      message = { terms: { price_num: '1' }, account_s: { view_account_index: 3 } };
    const envelope = await encryptMaterial(message, f.key);
    const ephemeral = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(getBytes(envelope.ephemeral_public_key_hex)),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const shared = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: ephemeral },
      f.pair.privateKey,
      256,
    );
    const digest = await crypto.subtle.digest(
      'SHA-256',
      Uint8Array.from(
        getBytes(concat([toUtf8Bytes('perc20-vnote-material-v1'), new Uint8Array(shared)])),
      ),
    );
    const aes = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(getBytes(envelope.nonce_hex)) },
      aes,
      Uint8Array.from(getBytes(envelope.ciphertext_hex)),
    );
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(message);
  });
  it('encrypts durable records with account-specific AAD', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const j = { ...newJournal(), records: [fixtureRecord()] };
    const box = await sealJournal(j, 'account-1', key);
    expect(JSON.stringify(box)).not.toContain('secret-child');
    expect(await openJournal(box, 'account-1', key)).toEqual(j);
    await expect(openJournal(box, 'account-2', key)).rejects.toThrow();
  });
});
// Exercise the real reconciliation path with delayed RPC/indexer responses, not a stubbed reconcile().
async function delayedFundingFixture() {
  const f = await fixture();
  const requests = new Map<string, number>();
  const indexed = new Map<string, number>();
  const originalHttp = f.p.http;
  const originalView = f.p.view;
  const hashes = ['0x' + '11'.repeat(32), '0x' + '22'.repeat(32)];
  const blockHash = '0x' + '33'.repeat(32);
  f.p.http = vi.fn(async (url, body) => {
    if (url.endsWith('/dex/transfer/submit')) {
      const index = (body as { contract: string }).contract === DEX.quote ? 0 : 1;
      await originalHttp(url, body);
      return { tx_hash: hashes[index] };
    }
    if (url.includes('/note?')) {
      const cmx = new URL(url).searchParams.get('cmx')!;
      const count = (indexed.get(cmx) ?? 0) + 1;
      indexed.set(cmx, count);
      if (count === 1) return null;
      const i = f.journal.records[0].funding.findIndex(leg => leg.commitments.includes(cmx));
      return { cmx: Array.from(getBytes(cmx)), tx_hash: hashes[i] };
    }
    return originalHttp(url, body);
  });
  f.p.view = vi.fn(async (pool, method, args) => method === 'cmxExists' ? true : originalView(pool, method, args));
  f.p.rpc = vi.fn(async (method, args) => {
    if (method === 'eth_chainId') return '0x8f';
    if (method === 'eth_getBlockByNumber') return { hash: args[0] === '0x0' ? DEX.genesis : blockHash, number: '0x20' };
    if (method === 'eth_getTransactionReceipt') {
      const tx = String(args[0]), count = (requests.get(tx) ?? 0) + 1;
      requests.set(tx, count);
      if (count === 1) return null;
      const leg = f.journal.records[0].funding[hashes.indexOf(tx)];
      return { transactionHash: tx, status: '0x1', blockNumber: '0x10', blockHash,
        logs: leg.commitments.map(cmx => ({ address: leg.pool, topics: [NOTE_ADDED_TOPIC, cmx] })) };
    }
    throw new Error('Unexpected RPC');
  });
  return { f, hashes, indexed };
}

describe('PEX funding confirmation', () => {
  it('automatically finishes fee, principal and matcher submission despite receipt and indexer lag', async () => {
    const { f, indexed } = await delayedFundingFixture();
    const result = await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(result.executionState).toBe('open');
    expect(f.events.filter(e => e.startsWith('send:'))).toEqual([`send:${DEX.quote}`, `send:${DEX.base}`]);
    expect([...indexed.values()]).toEqual([2, 2]);
    expect(result.fundingProgress).toEqual([{ asset: 'sUSDC', state: 'confirmed' }, { asset: 'P20', state: 'confirmed' }]);
    expect(vi.mocked(f.p.http).mock.calls.filter(([url]) => url.endsWith('/vnote/submit'))).toHaveLength(1);
  });
  it('resumes an old unknown fee by its original commitments and sends only the unbroadcast principal', async () => {
    const { f } = await delayedFundingFixture();
    f.journal.records[0].state = 'funding';
    f.journal.records[0].funding[0].state = 'unknown';
    const result = await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(result.executionState).toBe('open');
    expect(f.events.filter(e => e.startsWith('send:'))).toEqual([`send:${DEX.base}`]);
  });
  it('stops on a finalized revert even though no output commitments exist', async () => {
    const { f } = await delayedFundingFixture();
    const rpc = f.p.rpc;
    f.p.rpc = async (method, args) => {
      const value = await rpc(method, args);
      return method === 'eth_getTransactionReceipt' && value ? { ...value as object, status: '0x0' } : value;
    };
    f.p.view = vi.fn(async (_pool, method) => method === 'feeAmount' ? 500000n : method === 'feeAssetPool' ? DEX.quote : false);
    const result = await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(result.transactionFailed).toBe(true);
    expect(result.error).toContain('回滚');
    expect(result.fundingProgress[0].state).toBe('failed');
    expect(f.events.filter(e => e.startsWith('send:'))).toEqual([`send:${DEX.quote}`]);
    expect(vi.mocked(f.p.http).mock.calls.some(([url]) => url.endsWith('/vnote/submit'))).toBe(false);
  });
  it('keeps pending submissions separate from failures and available for read-only progress', async () => {
    const f = await fixture();
    const paused = new DexEngine(f.p, { ...confirmation, sleep: async () => {
      expect((await f.engine.list())[0]).toMatchObject({ executionState: 'funding', fundingProgress: [{ state: 'confirming' }, { state: 'prepared' }] });
    } });
    const result = await paused.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(result.executionState).toBe('funding');
    expect(result.transactionFailed).toBeUndefined();
    expect(result.error).toContain('等待已超时');
    expect(f.events.filter(e => e.startsWith('send:'))).toHaveLength(1);
  });
  it('stops the approved operation if the wallet session changes during confirmation', async () => {
    const f = await fixture();
    const stopped = new DexEngine(f.p, { ...confirmation, sleep: async () => {
      f.p.guard = () => { throw new Error('session changed'); };
    } });
    await expect(stopped.submit(f.journal.records[0].id, 'https://dapp.test')).rejects.toThrow('session changed');
    expect(f.events.filter(e => e.startsWith('send:'))).toEqual([`send:${DEX.quote}`]);
  });
  it('does not post to a new matcher epoch after confirming funding', async () => {
    const { f } = await delayedFundingFixture();
    const http = f.p.http;
    let healthReads = 0;
    f.p.http = vi.fn(async (url, body, allow404) => {
      const value = await http(url, body, allow404);
      return url.endsWith('/healthz') && ++healthReads > 1 ? { ...value as object, matches_epoch: 'new-epoch' } : value;
    });
    const result = await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(result.error).toContain('轮次已变化');
    expect(vi.mocked(f.p.http).mock.calls.some(([url]) => url.endsWith('/vnote/submit'))).toBe(false);
  });
});

describe('PEX durable transaction orchestration', () => {
  it('does not call an unmatched market response a resting order', async () => {
    const f = await fixture(),
      original = f.p.http;
    f.p.http = async (url, body) =>
      url.endsWith('/vnote/submit')
        ? { order_id: null, plans: [], match_capability: null }
        : original(url, body);
    vi.spyOn(f.engine, 'reconcile').mockImplementation(async (funding) => {
      funding.state = 'confirmed';
      return true;
    });
    const result = await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(result.executionState).toBe('funded');
    expect(result.status).toBe('pending');
    expect(result.canCancel).toBe(true);
    expect(f.journal.records[0].cancelConfirmed).toBe(true);
  });
  it('commits uncertainty before sending a fee and never broadcasts principal until fee confirms', async () => {
    const f = await fixture();
    vi.spyOn(f.engine, 'reconcile').mockResolvedValue(false);
    const result = await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(result.executionState).toBe('funding');
    expect(f.events).toContain(`send:${DEX.quote}`);
    expect(f.events).not.toContain(`send:${DEX.base}`);
    expect(f.events.indexOf('save:unknown,prepared')).toBeLessThan(
      f.events.indexOf(`send:${DEX.quote}`),
    );
    expect(reservedInputs(f.journal, DEX.base).has('base-input')).toBe(true);
  });
  it('never repeats uncertain funding after an HTTP timeout or service restart', async () => {
    const f = await fixture();
    const original = f.p.http;
    f.p.http = async (url, body) => {
      if (url.endsWith('/dex/transfer/submit')) throw new Error('timeout');
      return original(url, body);
    };
    await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(f.journal.records[0].funding[0].state).toBe('unknown');
    f.events.length = 0;
    f.p.http = original;
    const restarted = new DexEngine(f.p, confirmation);
    vi.spyOn(restarted, 'reconcile').mockResolvedValue(false);
    await restarted.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(f.events.filter((e) => e.startsWith('send:'))).toEqual([]);
  });
  it('funds fee then principal once and safely returns only the order summary', async () => {
    const f = await fixture();
    vi.spyOn(f.engine, 'reconcile').mockImplementation(async (funding) => {
      funding.state = 'confirmed';
      return true;
    });
    const result = await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(f.events.filter((e) => e.startsWith('send:'))).toEqual([
      `send:${DEX.quote}`,
      `send:${DEX.base}`,
    ]);
    expect(result.executionState).toBe('open');
    expect(JSON.stringify(result)).not.toContain('private-capability');
    await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(f.events.filter((e) => e.startsWith('send:'))).toHaveLength(2);
  });
  it('preflight failures and declined drafts broadcast nothing and do not reuse child indexes', async () => {
    const f = await fixture();
    const index = f.journal.nextAccount;
    f.p.http = async () => {
      throw new Error('preflight unavailable');
    };
    await f.engine.submit(f.journal.records[0].id, 'https://dapp.test');
    expect(f.journal.records[0].funding.every((f) => f.state === 'prepared')).toBe(true);
    await f.engine.discard(f.journal.records[0].id, 'https://dapp.test');
    expect(f.journal.nextAccount).toBe(index);
    expect(f.journal.records[0].state).toBe('discarded');
  });
  it('rejects cross-origin order operations before any network request', async () => {
    const f = await fixture();
    await expect(f.engine.submit(f.journal.records[0].id, 'https://other.test')).rejects.toThrow(
      '不属于',
    );
    expect(f.p.http).not.toHaveBeenCalled();
  });
  it('does not reclaim an order with pending fills or unknown submission result', async () => {
    const f = await fixture();
    f.journal.records[0].state = 'open';
    f.journal.records[0].orderId = 'ab'.repeat(16);
    f.journal.records[0].capability = 'cap';
    f.journal.records[0].funding[0].state = 'confirmed';
    const result = await f.engine.cancel(f.journal.records[0].id, 'https://dapp.test', 'synthetic');
    expect(result.error).toContain('在途');
    expect(f.p.prove).not.toHaveBeenCalled();
    f.journal.records[0].state = 'submitting';
    delete f.journal.records[0].orderId;
    expect(
      (await f.engine.cancel(f.journal.records[0].id, 'https://dapp.test', 'synthetic')).error,
    ).toContain('提交结果未知');
  });
});
