import { describe, expect, it, vi } from 'vitest';
import { syncPrivacyPools } from './sync-pools';

const pools = [{ symbol: 'P20' }, { symbol: 'sUSDC' }];

describe('privacy pool sync isolation', () => {
  it.each(['RPC unavailable', '单次同步达到 200 页上限，请再次继续'])(
    'still synchronizes sUSDC after P20 fails: %s', async message => {
      const sync = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce({ symbol: 'sUSDC' });
      await expect(syncPrivacyPools(pools, sync)).rejects.toThrow(`P20: ${message}`);
      expect(sync.mock.calls).toEqual([[pools[0]], [pools[1]]]);
    },
  );

  it('reports failures from all pools without declaring success', async () => {
    const sync = vi.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));
    await expect(syncPrivacyPools(pools, sync)).rejects.toThrow('P20: first；sUSDC: second');
  });

  it('returns all snapshots after successful sequential synchronization', async () => {
    const order: string[] = [];
    const result = await syncPrivacyPools(pools, async pool => {
      order.push(`start ${pool.symbol}`);
      await Promise.resolve();
      order.push(`end ${pool.symbol}`);
      return pool.symbol;
    });
    expect(result).toEqual(['P20', 'sUSDC']);
    expect(order).toEqual(['start P20', 'end P20', 'start sUSDC', 'end sUSDC']);
  });
});
