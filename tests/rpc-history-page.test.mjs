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

const { readRpcHistoryPage } =
  await import('../src/privacy/rpc-history-page.ts');

test('50-block provider limit is learned; consecutive pages have no omissions or repeats', async () => {
  const successful = [],
    attempts = [];
  let cursor = 100,
    knownSpan;
  while (cursor < 235) {
    const page = await readRpcHistoryPage({
      afterBlock: cursor,
      targetBlock: 235,
      maxSpan: 1000,
      knownSpan,
      read: async (from, to) => {
        attempts.push([from, to]);
        if (to - from + 1 > 50)
          throw Error('eth_getLogs is limited to 0 - 50 blocks range');
        successful.push([from, to]);
        return { verifiedBlock: to, logs: [from, to] };
      },
    });
    assert.equal(
      page.toBlock,
      page.value.verifiedBlock,
      'Only the verified block becomes the checkpoint',
    );
    cursor = page.toBlock;
    knownSpan = page.span;
  }
  assert.deepEqual(successful, [
    [101, 150],
    [151, 200],
    [201, 235],
  ]);
  assert.equal(
    attempts.length,
    4,
    'Following pages reuse the accepted provider span',
  );
});
test('unspecified result caps narrow the range until the provider accepts it', async () => {
  const sizes = [];
  const page = await readRpcHistoryPage({
    afterBlock: 20,
    targetBlock: 300,
    maxSpan: 200,
    read: async (from, to) => {
      sizes.push(to - from + 1);
      if (to - from + 1 > 25)
        throw Error('query returned more than 10000 results');
      return ['verified'];
    },
  });
  assert.deepEqual(sizes, [200, 100, 50, 25]);
  assert.equal(page.toBlock, 45);
});
test('rate limits, unavailable RPCs and reorg checks fail without disguising them as range limits', async () => {
  for (const message of [
    'HTTP 429 rate limit exceeded for block range',
    'RPC offline',
    '历史区块检查失败',
  ]) {
    let calls = 0;
    await assert.rejects(
      readRpcHistoryPage({
        afterBlock: 1,
        targetBlock: 100,
        maxSpan: 50,
        read: async () => {
          calls++;
          throw Error(message);
        },
      }),
      (e) => e.message === message,
    );
    assert.equal(calls, 1);
  }
});
test('one-block failure stops; invalid cursor cannot be scanned or advanced', async () => {
  let calls = 0;
  await assert.rejects(
    readRpcHistoryPage({
      afterBlock: 1,
      targetBlock: 2,
      maxSpan: 1,
      read: async () => {
        calls++;
        throw Error('block range exceeds limit');
      },
    }),
    /range/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    readRpcHistoryPage({
      afterBlock: 2,
      targetBlock: 2,
      maxSpan: 50,
      read: async () => {
        throw Error('must not fetch');
      },
    }),
    /无效/,
  );
});

test('a genesis deployment can start at block zero',async()=>{
 const page=await readRpcHistoryPage({afterBlock:-1,targetBlock:1,maxSpan:50,read:async(from,to)=>({from,to})});
 assert.deepEqual(page.value,{from:0,to:1});
});
