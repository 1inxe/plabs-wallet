import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
        return next(specifier + '.ts', context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('.ts'))
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
        shortCircuit: true,
      };
    return next(url, context);
  },
});

const { Interface } = await import('ethers');
const { NETWORKS } = await import('../src/shared/networks.ts');
const { unshieldAsset, verifyUnshieldReceipt } =
  await import('../src/privacy/unshield.ts');
const token = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const recipient = '0x' + '12'.repeat(20),
  collector = '0x' + '34'.repeat(20);
function receipt(pool, to, value, underlying) {
  const log = token.encodeEventLog('Transfer', [pool, to, value]);
  return { address: underlying, topics: log.topics, data: log.data };
}
test('official wrapped pools support unshielding; P20 and unknown pools do not', () => {
  for (const chainId of [1, 143])
    for (const pool of NETWORKS[chainId].plabs.pools)
      assert.equal(
        Boolean(unshieldAsset(chainId, pool.address)),
        Boolean(pool.underlying),
      );
  assert.equal(unshieldAsset(8453, recipient), null);
  assert.equal(unshieldAsset(1, recipient), null);
  assert.equal(
    unshieldAsset(1, NETWORKS[1].plabs.pools[2].address).symbol,
    'WETH',
  );
});
test('unshield verifies actual public outputs for USDC, USDT and scaled WETH', () => {
  for (const chainId of [1, 143])
    for (const pool of NETWORKS[chainId].plabs.pools.filter(
      (p) => p.underlying,
    )) {
      const scale = BigInt(pool.scale),
        op = {
          chainId,
          poolAddress: pool.address,
          underlying: pool.underlying,
          recipient,
          feeCollector: collector,
          receiveRaw: '990',
          feeRaw: '10',
          transaction: { to: pool.address },
        };
      const logs = [
        receipt(pool.address, recipient, 990n * scale, pool.underlying),
        receipt(pool.address, collector, 10n * scale, pool.underlying),
      ];
      verifyUnshieldReceipt(op, logs);
      assert.throws(() => verifyUnshieldReceipt(op, [logs[0]]), /实际到账/);
      assert.throws(
        () =>
          verifyUnshieldReceipt(op, [
            ...logs,
            receipt(pool.address, '0x' + '56'.repeat(20), 1n, pool.underlying),
          ]),
        /未知收款方/,
      );
      assert.throws(
        () =>
          verifyUnshieldReceipt(op, [
            receipt(pool.address, recipient, 991n * scale, pool.underlying),
            logs[1],
          ]),
        /实际到账/,
      );
      assert.throws(
        () => verifyUnshieldReceipt({ ...op, underlying: recipient }, logs),
        /回执约束/,
      );
      if (scale > 1n)
        assert.throws(
          () =>
            verifyUnshieldReceipt(op, [
              receipt(pool.address, recipient, 990n, pool.underlying),
              receipt(pool.address, collector, 10n, pool.underlying),
            ]),
          /实际到账/,
        );
    }
});
test('a collector receiving its own withdrawal is checked against the combined amount', () => {
  const pool = NETWORKS[143].plabs.pools[1],
    op = {
      chainId: 143,
      poolAddress: pool.address,
      underlying: pool.underlying,
      recipient,
      feeCollector: recipient,
      receiveRaw: '990',
      feeRaw: '10',
      transaction: { to: pool.address },
    };
  verifyUnshieldReceipt(op, [
    receipt(pool.address, recipient, 1000n, pool.underlying),
  ]);
  assert.throws(
    () =>
      verifyUnshieldReceipt(op, [
        receipt(pool.address, recipient, 990n, pool.underlying),
      ]),
    /实际到账/,
  );
});
