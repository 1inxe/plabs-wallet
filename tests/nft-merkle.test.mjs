import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { AbiCoder } from 'ethers';
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

const { buildNftMerklePath, nftTreeInterface } =
  await import('../src/privacy/nft/merkle.ts');
const { NOTE_CONFIRMED_TOPIC } = await import('../src/privacy/events.ts');
const { reverseHexByByte } = await import('../src/privacy/operations.ts');
const wasmUrl = new URL(
  '../public/nft/wasm/ba94adf093e933f6c44a7f3c35929f55dd46c4b91dc15b0e5662f0fa61191525/privacybtc_wasm_prover.js',
  import.meta.url,
);
const wasm = await import(wasmUrl.href);
await wasm.default({
  module_or_path: readFileSync(
    new URL('./privacybtc_wasm_prover_bg.wasm', wasmUrl),
  ),
});
const serial = (v) =>
  v instanceof Map
    ? Object.fromEntries([...v].map(([k, v]) => [k, serial(v)]))
    : Array.isArray(v)
      ? v.map(serial)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k, serial(v)]))
        : typeof v === 'bigint'
          ? v.toString()
          : v;
const pool = '0x' + '12'.repeat(20),
  cmxs = [1, 2, 3].map((n) => '0x' + n.toString(16).padStart(64, '0')),
  blockHash = '0x' + 'aa'.repeat(32),
  abi = AbiCoder.defaultAbiCoder();
function fixture() {
  const ref = new wasm.WalletCommitmentTree(),
    roots = [];
  for (const [position, cmx] of cmxs.entries()) {
    ref.append_batch_json(
      JSON.stringify([{ cmx_be_hex: cmx, owned: false }]),
      BigInt(position),
    );
    roots.push('0x' + reverseHexByByte(ref.root_le_hex()));
  }
  ref.free();
  const logs = cmxs.map((cmx, i) => ({
    address: pool,
    topics: [NOTE_CONFIRMED_TOPIC, cmx],
    blockNumber: '0x' + (i * 1000 + 10).toString(16),
    blockHash,
    transactionHash: '0x' + String(i + 1).repeat(64),
    logIndex: '0x0',
    data: abi.encode(['bytes32', 'uint256'], [roots[i], i]),
  }));
  const state = {
      omit: false,
      duplicate: false,
      alter: false,
      reorg: false,
      invalid: false,
      limited: false,
      reads: 0,
      treeCalls: 0,
    },
    calls = [];
  let tree;
  const p = {
    guard: async () => {
      if (state.invalid) throw Error('session changed');
    },
    rpc: async (method, params) => {
      calls.push({ method, params });
      if (method === 'eth_getBlockByNumber') {
        if (params[0] !== 'latest') state.reads++;
        return {
          number: params[0] === 'latest' ? '0x9c6' : params[0],
          hash:
            state.reorg && state.reads > 1 ? '0x' + 'bb'.repeat(32) : blockHash,
        };
      }
      if (method === 'eth_getCode')
        return BigInt(params[1]) >= 1n ? '0x1234' : '0x';
      if (method === 'eth_call') {
        const call = nftTreeInterface.parseTransaction({
          data: params[0].data,
        });
        return nftTreeInterface.encodeFunctionResult(call.name, [
          {
            confirmedCount: 3,
            confirmedRoot: roots[2],
            cmxFrozenRoot: '0x' + '00'.repeat(32),
            maxActions: 10,
          }[call.name],
        ]);
      }
      if (method === 'eth_getLogs') {
        if (
          state.limited &&
          BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) >= 50n
        )
          throw Error('eth_getLogs range is limited to 50 blocks');
        const rows = logs.filter(
          (l) =>
            BigInt(l.blockNumber) >= BigInt(params[0].fromBlock) &&
            BigInt(l.blockNumber) <= BigInt(params[0].toBlock),
        );
        return rows
          .filter((l) => !(state.omit && l === logs[1]))
          .flatMap((l) =>
            state.duplicate && l === logs[1]
              ? [l, l]
              : [
                  state.alter && l === logs[0]
                    ? {
                        ...l,
                        topics: [
                          NOTE_CONFIRMED_TOPIC,
                          '0x' + '04'.padStart(64, '0'),
                        ],
                      }
                    : l,
                ],
          );
      }
      throw Error(method);
    },
    prove: async (method, body) => {
      state.treeCalls++;
      if (method === 'tree_reset') {
        tree?.free();
        tree = new wasm.WalletCommitmentTree();
        return {};
      }
      if (method === 'tree_append')
        return JSON.parse(
          tree.append_batch_json(
            JSON.stringify(body.leaves),
            BigInt(body.expectedStartPosition),
          ),
        );
      if (method === 'tree_paths')
        return {
          rootLeHex: tree.root_le_hex(),
          overrides: body.cmxs.map((c) => serial(tree.merkle_path(c))),
        };
      if (method === 'merkle_root_from_path')
        return serial(wasm.merkle_root_from_path(body));
      throw Error(method);
    },
  };
  return { p, state, calls, roots, free: () => tree?.free() };
}
test('native NFT path matches a pinned on-chain confirmed root using the actual Poseidon WASM', async () => {
  const f = fixture();
  try {
    const path = await buildNftMerklePath(f.p, {
      pool,
      cmx: cmxs[1],
      seed: '11'.repeat(32),
      firstBlock: 1,
    });
    assert.equal(path.position, 1);
    assert.equal(path.siblings.length, 32);
    assert.equal(path.anchor, reverseHexByByte(f.roots[2]));
    assert.ok(
      f.calls
        .filter((c) => c.method === 'eth_call')
        .every((c) => c.params[1] === '0x9c5'),
    );
    assert.ok(
      f.calls
        .filter((c) => c.method === 'eth_getLogs')
        .every(
          (c) =>
            JSON.stringify(c.params).includes(NOTE_CONFIRMED_TOPIC) &&
            !JSON.stringify(c.params).includes(cmxs[1]),
        ),
      'RPC queries reveal no owned commitment',
    );
  } finally {
    f.free();
  }
});
test('missing, duplicate and altered confirmed commitments are rejected before signing', async () => {
  for (const flag of ['omit', 'duplicate', 'alter']) {
    const f = fixture();
    try {
      f.state[flag] = true;
      await assert.rejects(
        buildNftMerklePath(f.p, {
          pool,
          cmx: cmxs[1],
          seed: '11'.repeat(32),
          firstBlock: 1,
        }),
        /NFT/,
      );
    } finally {
      f.free();
    }
  }
});
test('a changed block checkpoint and changed privacy session invalidate the local path', async () => {
  for (const flag of ['reorg', 'invalid']) {
    const f = fixture();
    try {
      f.state[flag] = true;
      await assert.rejects(
        buildNftMerklePath(f.p, {
          pool,
          cmx: cmxs[1],
          seed: '11'.repeat(32),
          firstBlock: 1,
        }),
        /已变化|session changed/,
      );
    } finally {
      f.free();
    }
  }
});
test('RPC range limits are handled with smaller log pages', async () => {
  const f = fixture();
  try {
    f.state.limited = true;
    const path = await buildNftMerklePath(f.p, {
      pool,
      cmx: cmxs[1],
      seed: '11'.repeat(32),
      firstBlock: 1,
    });
    assert.equal(path.position, 1);
    assert.ok(f.calls.filter((c) => c.method === 'eth_getLogs').length > 3);
  } finally {
    f.free();
  }
});
test('deployment discovery works when an older NFT journal has no pool cursor', async () => {
  const f = fixture();
  try {
    const path = await buildNftMerklePath(f.p, {
      pool,
      cmx: cmxs[1],
      seed: '11'.repeat(32),
    });
    assert.equal(path.position, 1);
    assert.ok(f.calls.some((c) => c.method === 'eth_getCode'));
  } finally {
    f.free();
  }
});
