import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { AbiCoder, Interface, Wallet, keccak256 } from 'ethers';
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
const { NftTransferEngine, inspectNftTransfer } =
  await import('../src/privacy/nft/transfer.ts');
const { signNftTransferTransaction } =
  await import('../src/privacy/nft/signing.ts');
const { nftInterface } = await import('../src/privacy/nft/protocol.ts');
const { NOTE_CONFIRMED_TOPIC } = await import('../src/privacy/events.ts');
const { reverseHexByByte } = await import('../src/privacy/operations.ts');
const { nftTransferActivities } =
  await import('../src/privacy/nft/activity.ts');
const wallet = new Wallet('0x' + '11'.repeat(32)),
  pool = '0x' + '12'.repeat(20),
  recipient = '34'.repeat(43),
  cmx = '0x' + '56'.repeat(32),
  out = '0x' + '78'.repeat(32),
  nf =
    '0x' +
    Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(
      '',
    ),
  root = '0x' + 'ab'.repeat(32);
const poolAbi = new Interface([
  'function cmxRoot() view returns(bytes32)',
  'function confirmedRoot() view returns(bytes32)',
  'function confirmedCount() view returns(uint256)',
  'function cmxFrozenRoot() view returns(bytes32)',
  'function isValidAnchor(bytes32) view returns(bool)',
  'function maxActions() view returns(uint256)',
]);
const word = (n) => Array(32).fill(n);
function fixture() {
  const holding = {
    pool,
    name: 'Synthetic NFT',
    symbol: 'NFT',
    tokenId: '7',
    cmx,
    nullifier: nf,
    note: { value_sats: 7, cmx_hex: cmx },
    txHash: '0x' + 'cd'.repeat(32),
    blockNumber: 10,
    spent: false,
  };
  let journal = {
    schema: 1,
    records: [],
    holdings: [holding],
    pools: {
      [pool]: {
        firstBlock: 1,
        cursor: 31,
        name: 'Synthetic NFT',
        symbol: 'NFT',
      },
    },
  };
  const state = {
    signatures: 0,
    broadcasts: [],
    known: true,
    spent: false,
    badPath: false,
    indexerDown: false,
    frozenMismatch: false,
    badOutput: false,
    badRecipient: false,
    reject: false,
    failBroadcast: false,
    receipt: null,
    invalid: false,
    transaction: null,
  };
  const ports = {
    guard: async () => {
      if (state.invalid) throw Error('context changed');
    },
    load: async () => structuredClone(journal),
    save: async (j) => {
      journal = structuredClone(j);
    },
    rpc: async (method, params) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getTransactionReceipt') return state.receipt;
      if (method === 'eth_getBlockByNumber')
        return {
          number: params[0] === 'latest' ? '0x20' : params[0],
          hash: '0x' + 'aa'.repeat(32),
        };
      if (method === 'eth_getLogs')
        return [
          {
            address: pool,
            topics: [NOTE_CONFIRMED_TOPIC, cmx],
            data: AbiCoder.defaultAbiCoder().encode(
              ['bytes32', 'uint256'],
              [root, 0],
            ),
            blockNumber: '0xa',
            blockHash: '0x' + 'aa'.repeat(32),
            transactionHash: '0x' + 'bb'.repeat(32),
            logIndex: '0x0',
          },
        ];
      const abi = poolAbi.parseTransaction({ data: params[0].data })
        ? poolAbi
        : nftInterface;
      const call = abi.parseTransaction({ data: params[0].data });
      const values = {
        isCollection: state.known,
        cmxExists: true,
        isSpent: state.spent,
        cmxRoot: root,
        confirmedRoot: root,
        confirmedCount: 1,
        cmxFrozenRoot: root,
        isValidAnchor: true,
        maxActions: 32,
      };
      return abi.encodeFunctionResult(call.name, [values[call.name]]);
    },
    indexer: async (path) => {
      assert.ok(path.startsWith('/frozen_leaves'));
      if (state.indexerDown) throw Error('HTTP 404');
      return { leaves: [] };
    },
    prove: async (method, body) => {
      if (method === 'tree_reset') return {};
      if (method === 'tree_append') return { size: 1 };
      if (method === 'tree_paths')
        return {
          rootLeHex: root,
          overrides: [{ position: 0, siblings: Array(32).fill(root) }],
        };
      if (method === 'merkle_root_from_path')
        return { root_le_hex: state.badPath ? '00'.repeat(32) : root };
      if (state.frozenMismatch) throw Error('frozen_blacklist root mismatch');
      assert.equal(body.spend_notes.length, 1);
      assert.equal(body.transfer_output.value_sats, 7);
      assert.equal(body.transfer_output.recipient_raw_address_hex, recipient);
      return {
        funding_notes: [
          {
            cmx_hex: out,
            value_sats: state.badOutput ? 8 : 7,
            recipient_raw_address_hex: state.badRecipient
              ? '90'.repeat(43)
              : recipient,
          },
        ],
        bundle: {
          actions: [
            {
              cmx: Array(32).fill(0x78),
              nullifier: Array.from(Buffer.from(reverseHexByByte(nf), 'hex')),
              ephemeral_key: word(3),
              enc_ciphertext: Array(580).fill(4),
              out_ciphertext: Array(80).fill(5),
              proof_bn254: Array(256).fill(6),
              pub_fields_bn254: Array.from({ length: 8 }, () => word(7)),
            },
          ],
          binding_proof_bn254: Array.from({ length: 8 }, () => word(8)),
        },
      };
    },
    sign: async (transaction) => {
      state.signatures++;
      if (state.reject) throw Error('user rejected');
      state.transaction = transaction;
      const raw = await wallet.signTransaction({
        chainId: 1,
        to: pool,
        data: transaction.data,
        value: 0,
        gasLimit: 500000,
        gasPrice: 10,
        nonce: 0,
      });
      return { raw, hash: keccak256(raw) };
    },
    broadcast: async (raw) => {
      assert.ok(
        journal.transfers[0].txHash,
        'Hash persisted before broadcasting',
      );
      state.broadcasts.push(raw);
      if (state.failBroadcast) throw Error('timeout');
      return keccak256(raw);
    },
  };
  return {
    state,
    ports,
    engine: new NftTransferEngine(ports, wallet.address),
    journal: () => journal,
    assetId: `${pool}:${cmx}`,
  };
}
test('NFT transfer preserves the full token ID, verifies proof inputs, and saves its hash before broadcast', async () => {
  const f = fixture(),
    r = await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  assert.equal(r.state, 'submitted');
  assert.equal(f.state.signatures, 1);
  assert.equal(f.state.broadcasts.length, 1);
  assert.deepEqual(inspectNftTransfer(f.state.transaction), {
    pool,
    recipient,
    tokenId: 7,
  });
  assert.equal(JSON.stringify(r).includes('note'), false);
  assert.equal(JSON.stringify(r).includes('raw'), false);
  const [activity] = nftTransferActivities(f.journal(), wallet.address);
  assert.equal(activity.status, 'pending');
  assert.equal(activity.collectionName, 'Synthetic NFT');
  assert.equal(activity.tokenId, '7');
  assert.equal(activity.maxGasWei, '5000000');
  assert.equal(activity.mainTxHash, r.txHash);
});
test('invalid addresses, unregistered collections, spent notes, wrong paths and altered outputs cannot be signed', async () => {
  for (const flag of [
    'known',
    'spent',
    'badPath',
    'badOutput',
    'badRecipient',
    'invalid',
  ]) {
    const f = fixture();
    f.state[flag] = flag === 'known' ? false : true;
    await assert.rejects(f.engine.send(f.assetId, recipient, '11'.repeat(32)));
    assert.equal(f.state.signatures, 0, flag);
  }
  const f = fixture();
  await assert.rejects(f.engine.send(f.assetId, pool, '11'.repeat(32)));
  assert.equal(f.state.signatures, 0);
});
test('ambiguous broadcasts and repeated send calls retain the original signature and hash', async () => {
  const f = fixture();
  f.state.failBroadcast = true;
  const first = await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  const resumed = await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  assert.equal(first.txHash, resumed.txHash);
  assert.equal(f.state.signatures, 1);
  assert.equal(new Set(f.state.broadcasts).size, 1);
  await assert.rejects(
    f.engine.send(f.assetId, '90'.repeat(43), '11'.repeat(32)),
    /原交易/,
  );
});
test('rejected signing can be retried, and confirmed sends remove the spent holding', async () => {
  const f = fixture();
  f.state.reject = true;
  await assert.rejects(
    f.engine.send(f.assetId, recipient, '11'.repeat(32)),
    /rejected/,
  );
  f.state.reject = false;
  const sent = await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  f.state.receipt = {
    transactionHash: sent.txHash,
    to: pool,
    status: '0x1',
    blockNumber: '0x10',
  };
  assert.equal((await f.engine.status(sent.id)).state, 'confirmed');
  assert.equal(f.journal().holdings[0].spent, true);
});
test('reverted sends retain NFT ownership and permit a fresh proof', async () => {
  const f = fixture(),
    sent = await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  f.state.receipt = {
    transactionHash: sent.txHash,
    to: pool,
    status: '0x0',
    blockNumber: '0x10',
  };
  assert.equal((await f.engine.status(sent.id)).state, 'failed');
  assert.equal(f.journal().holdings[0].spent, false);
  f.state.receipt = null;
  await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  assert.equal(f.state.signatures, 2);
});
test('activity status refresh never signs or rebroadcasts a pending NFT send', async () => {
  const f = fixture();
  const sent = await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  const before = structuredClone(f.journal());
  await f.engine.status(sent.id, true);
  assert.equal(f.state.signatures, 1);
  assert.equal(f.state.broadcasts.length, 1);
  assert.deepEqual(
    f.journal(),
    before,
    'A read with no status change does not rewrite the encrypted journal',
  );
  f.state.receipt = {
    transactionHash: sent.txHash,
    to: pool,
    status: '0x1',
    blockNumber: '0x10',
  };
  assert.equal((await f.engine.status(sent.id, true)).state, 'confirmed');
  assert.equal(f.state.signatures, 1);
  assert.equal(f.state.broadcasts.length, 1);
  assert.equal(f.journal().holdings[0].spent, true);
});
test('the signing boundary approves the NFT recipient and ETH Gas, and signs only the collection transfer', async () => {
  const f = fixture();
  await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  let approved;
  const provider = {
    call: async () => nftInterface.encodeFunctionResult('isCollection', [true]),
    estimateGas: async () => 100000n,
    getFeeData: async () => ({ gasPrice: 10n }),
    getBalance: async () => 999999999n,
    getTransactionCount: async () => 0,
  };
  await signNftTransferTransaction(f.state.transaction, {
    account: wallet.address,
    signer: wallet,
    provider,
    guard: async () => {},
    approve: async (details) => {
      approved = details;
    },
  });
  assert.ok(approved.收款隐私地址.startsWith('perc1'));
  assert.equal(approved.NFT编号, '#7');
  assert.ok(approved.Gas费用上限.includes('ETH'));
  await assert.rejects(
    signNftTransferTransaction(
      { ...f.state.transaction, value: '0x1' },
      {
        account: wallet.address,
        signer: wallet,
        provider,
        guard: async () => {},
        approve: async () => {
          throw Error('must not approve');
        },
      },
    ),
  );
});

test('NFT read consent does not expose local transfer recipients or recovery records', async () => {
  const f = fixture();
  await f.engine.send(f.assetId, recipient, '11'.repeat(32));
  const { publicNftAssets } = await import('../src/privacy/nft/holdings.ts');
  assert.equal('transfer' in publicNftAssets(f.journal()).items[0], false);
  assert.equal(
    publicNftAssets(f.journal(), true).items[0].transfer.recipient,
    recipient,
  );
});

test('NFT sends work when the legacy indexer returns 404, while frozen-root verification remains mandatory', async () => {
  const f = fixture();
  f.state.indexerDown = true;
  assert.equal(
    (await f.engine.send(f.assetId, recipient, '11'.repeat(32))).state,
    'submitted',
  );
  const blocked = fixture();
  blocked.state.indexerDown = true;
  blocked.state.frozenMismatch = true;
  await assert.rejects(
    blocked.engine.send(blocked.assetId, recipient, '11'.repeat(32)),
    /冻结状态/,
  );
  assert.equal(blocked.state.signatures, 0);
});
