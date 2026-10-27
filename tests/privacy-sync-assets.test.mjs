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

const { syncPrivacyAssets } = await import('../src/privacy/sync-assets.ts');
test('unified sync waits for NFT completion and returns only fungible balances', async () => {
  const steps = [];
  let finish;
  const blocked = new Promise((r) => {
    finish = r;
  });
  let done = false;
  const job = syncPrivacyAssets({
    guard: async () => {},
    phase: (p) => steps.push(p),
    tokens: async () => ['token-balance'],
    nfts: async () => {
      await blocked;
      return { syncComplete: true };
    },
  }).then((r) => {
    done = true;
    return r;
  });
  await new Promise(setImmediate);
  assert.equal(done, false);
  assert.deepEqual(steps, ['tokens', 'nfts']);
  finish();
  assert.deepEqual(await job, ['token-balance']);
});
test('a failed token pool does not starve NFT synchronization', async () => {
  let nfts = 0;
  await assert.rejects(
    syncPrivacyAssets({
      guard: async () => {},
      phase: () => {},
      tokens: async () => {
        throw Error('token RPC down');
      },
      nfts: async () => {
        nfts++;
        return { syncComplete: true };
      },
    }),
    /token RPC down/,
  );
  assert.equal(nfts, 1);
});
test('partial NFT snapshots do not report a completed asset sync', async () => {
  for (const result of [
    { syncComplete: false },
    { syncComplete: false, error: 'NFT RPC down' },
  ])
    await assert.rejects(
      syncPrivacyAssets({
        guard: async () => {},
        phase: () => {},
        tokens: async () => ['retained-token'],
        nfts: async () => result,
      }),
      /NFT/,
    );
});
test('session changes stop NFT reads before another account is scanned', async () => {
  let active = true,
    nfts = 0;
  await assert.rejects(
    syncPrivacyAssets({
      guard: async () => {
        if (!active) throw Error('session changed');
      },
      phase: () => {},
      tokens: async () => {
        active = false;
        return [];
      },
      nfts: async () => {
        nfts++;
        return { syncComplete: true };
      },
    }),
    /session changed/,
  );
  assert.equal(nfts, 0);
});
test('chains without NFT pools synchronize fungible assets alone', async () => {
  const phases = [];
  assert.deepEqual(
    await syncPrivacyAssets({
      guard: async () => {},
      phase: (p) => phases.push(p),
      tokens: async () => ['Monad asset'],
    }),
    ['Monad asset'],
  );
  assert.deepEqual(phases, ['tokens']);
});
