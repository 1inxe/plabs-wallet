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

const { createPublicTransfers } = await import('../src/public/transfers.ts');
const { Wallet, Interface } = await import('ethers');
const wallet = new Wallet('0x' + '11'.repeat(32)),
  recipient = '0x' + '22'.repeat(20),
  tokenAddress = '0x' + '33'.repeat(20);
const abi = new Interface([
  'function transfer(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
function fixture(isToken = false) {
  let state = { address: wallet.address, chainId: 1, epoch: 1 },
    saved = null,
    receipt = null,
    tail = Promise.resolve();
  const events = [];
  let unknown = false;
  const asset = {
    chainId: 1,
    type: isToken ? 'erc20' : 'native',
    address: isToken ? tokenAddress : null,
    symbol: isToken ? 'USDC' : 'ETH',
    decimals: isToken ? 6 : 18,
    balanceRaw: isToken ? '100000000' : '100000000000000000000',
    formatted: '100',
  };
  const provider = {
    getBalance: async () => 10n ** 24n,
    getFeeData: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => 21000n,
    call: async (input) => {
      const parsed = abi.parseTransaction({ data: input.data });
      return abi.encodeFunctionResult(parsed.name, [
        parsed.name === 'transfer' ? true : 100000000n,
      ]);
    },
    getTransactionReceipt: async () => receipt,
    broadcastTransaction: async () => {
      events.push('broadcast');
      if (unknown) throw Error('unknown broadcast');
      return {};
    },
  };
  const service = createPublicTransfers({
    context: async () => ({ ...state }),
    provider: async () => provider,
    assets: async () => [asset],
    queue: (work) => {
      const job = tail.then(work, work);
      tail = job.catch(() => {});
      return job;
    },
    signer: () => ({
      populateTransaction: async (req) => ({ ...req, nonce: 0 }),
      signTransaction: async (req) => {
        events.push('sign');
        return wallet.signTransaction(req);
      },
    }),
    load: async () => saved,
    save: async (result) => {
      events.push('save');
      saved = structuredClone(result);
    },
  });
  return {
    service,
    asset,
    events,
    change: () => state.epoch++,
    unknown: () => (unknown = true),
    receipt: (raw) => (receipt = raw),
    get saved() {
      return saved;
    },
  };
}
test('public transfers persist their hash before broadcast and cannot submit a preview twice', async () => {
  const f = fixture();
  const review = await f.service.prepare({
    chainId: 1,
    tokenAddress: null,
    recipient,
    amount: '1',
  });
  const results = await Promise.allSettled([
    f.service.submit(review.id),
    f.service.submit(review.id),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.deepEqual(f.events, ['sign', 'save', 'broadcast']);
  assert.equal(f.saved.state, 'pending');
});
test('an uncertain public broadcast cannot become a second payment', async () => {
  const f = fixture();
  f.unknown();
  const review = await f.service.prepare({
    chainId: 1,
    recipient,
    amount: '1',
  });
  const pending = await f.service.submit(review.id);
  assert.equal(pending.state, 'pending');
  assert.match(pending.message, /勿重复发送/);
  await assert.rejects(
    f.service.prepare({ chainId: 1, recipient, amount: '1' }),
    /待确认/,
  );
  assert.equal(f.events.filter((e) => e === 'sign').length, 1);
});
test('changing account context cancels a preview before any signature', async () => {
  const f = fixture();
  const review = await f.service.prepare({
    chainId: 1,
    recipient,
    amount: '1',
  });
  f.change();
  await assert.rejects(f.service.submit(review.id), /已变化/);
  assert.deepEqual(f.events, []);
});
test('a successful ERC20 receipt checks actual token outputs and highlights discrepancies', async () => {
  for (const received of [1000000n, 900000n, 0n]) {
    const f = fixture(true),
      review = await f.service.prepare({
        chainId: 1,
        tokenAddress,
        recipient,
        amount: '1',
      });
    await f.service.submit(review.id);
    const log = abi.encodeEventLog('Transfer', [
      wallet.address,
      recipient,
      received,
    ]);
    f.receipt({
      status: 1,
      logs: received
        ? [{ address: tokenAddress, topics: log.topics, data: log.data }]
        : [],
    });
    const result = await f.service.status();
    assert.equal(result.state, 'confirmed');
    if (received === 1000000n) assert.equal(result.message, undefined);
    else assert.match(result.message, /到账回执与发送金额不一致/);
  }
});
