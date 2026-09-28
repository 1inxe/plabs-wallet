import { expect, it, vi } from 'vitest';
import { collectPayouts, settlementSlot, type RecoveryPorts } from './recovery';
import { DEX } from './protocol';
import type { DexRecord } from './journal';

it('maps pool-local actions to the protocol global blind slots, including a shared fee pool', () => {
  const roles = { pool_x: DEX.base, pool_y: DEX.quote, fee_pool: DEX.quote };
  expect([0, 1, 2, 3].map((i) => settlementSlot(DEX.quote, i, roles))).toEqual([2, 3, 4, 5]);
  expect([0, 1, 2].map((i) => settlementSlot(DEX.base, i, roles))).toEqual([0, 1, null]);
  expect(settlementSlot(DEX.base, -1, roles)).toBeNull();
});

it('keeps order material when an on-chain spent note has no indexed successor', async () => {
  const record = {
    account: 1073741825,
    material: {
      pay_pool: DEX.base,
      terms: { want_asset: DEX.quote },
      payout_address_raw_hex: '33'.repeat(43),
    },
    principalNote: { cmx_hex: '11'.repeat(32), value_sats: 10000 },
  } as unknown as DexRecord;
  const p: RecoveryPorts = {
    guard() {},
    prove: vi.fn(async (method) =>
      method === 'keys'
        ? { nk_hex: '22'.repeat(32), raw_address_hex: '33'.repeat(43) }
        : { nullifiers: ['44'.repeat(32)] },
    ),
    view: async () => true,
    http: async () => null,
    rpc: vi.fn(),
    importPayout: vi.fn(),
  };
  await expect(collectPayouts(p, record, 'unfunded-test-seed')).rejects.toThrow('索引尚未跟上');
  expect(p.importPayout).not.toHaveBeenCalled();
  expect(record.principalNote.value_sats).toBe(10000);
});

it('never credits payouts from a reverted or non-finalized settlement', async () => {
  const record = {
    account: 1073741825,
    material: {
      pay_pool: DEX.base,
      terms: { want_asset: DEX.quote },
      payout_address_raw_hex: '33'.repeat(43),
    },
    principalNote: { cmx_hex: '11'.repeat(32), value_sats: 10000 },
  } as unknown as DexRecord;
  const tx = `0x${'55'.repeat(32)}`;
  const p: RecoveryPorts = {
    guard() {},
    prove: vi.fn(async (method) =>
      method === 'keys'
        ? { nk_hex: '22'.repeat(32), raw_address_hex: '33'.repeat(43) }
        : { nullifiers: ['44'.repeat(32)] },
    ),
    view: async () => true,
    http: async () => ({
      tx_hash: tx,
      canonical: true,
      settlement: true,
      settlement_venue: 'pex',
      outputs: [],
    }),
    rpc: async (method) =>
      method === 'eth_getTransactionReceipt'
        ? { status: '0x0', transactionHash: tx, blockNumber: '0x5' }
        : { number: '0x4' },
    importPayout: vi.fn(),
  };
  await expect(collectPayouts(p, record, 'unfunded-test-seed')).rejects.toThrow('最终确认');
  expect(p.importPayout).not.toHaveBeenCalled();
});
