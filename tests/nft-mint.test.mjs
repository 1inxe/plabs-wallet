import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { Wallet, Transaction, AbiCoder, ZeroAddress, ZeroHash, keccak256 } from 'ethers';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
        return next(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('.ts'))
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const { NftMintEngine } = await import('../src/privacy/nft/engine.ts');
const protocol = await import('../src/privacy/nft/protocol.ts');
const { open, seal, journalId } = await import('../src/privacy/nft/journal.ts');
const { NftAssetSync, publicNftAssets } = await import('../src/privacy/nft/holdings.ts');
const { signNftTransaction } = await import('../src/privacy/nft/signing.ts');
const { NOTE_ADDED_TOPIC } = await import('../src/privacy/events.ts');
const { NFT, nftInterface, mintCallHash, privacyTag } = protocol;
const wallet = new Wallet('0x' + '11'.repeat(32)),
  account = wallet.address.toLowerCase();
const pool = '0xd4adb555b62dd50eb74be7650129f5c7e010e83e',
  privacy = '12'.repeat(43),
  origin = 'http://localhost:5180';
const cmx = '0x' + '23'.repeat(32),
  nf = '0x' + '34'.repeat(32),
  blockHash = '0x' + '45'.repeat(32);
const word = (n) => Array(32).fill(n);
function fixture() {
  let journal = { schema: 1, records: [] };
  const state = {
    proofs: 0,
    reserves: 0,
    signs: 0,
    broadcasts: 0,
    valid: true,
    confirmed: false,
    unknown: false,
    permitBad: false,
    permitExpired: false,
    permits: 0,
    chain: '0x1',
    reorg: false,
    signatureReject: false,
  };
  const job = {
    id: 'synthetic-job',
    pool,
    wallet: privacyTag(privacy),
    action: 'mint',
    tokenId: '7',
    status: 'queued',
    reservationActive: true,
    expiresAt: Date.now() + 600000,
  };
  const note = {
    cmx_hex: cmx,
    value_sats: 7,
    recipient_raw_address_hex: privacy,
    rho_hex: '01'.repeat(32),
    psi_hex: '02'.repeat(32),
    rcm_hex: '03'.repeat(32),
  };
  const proof = {
    owned_note: note,
    bundle: {
      nf_hex: nf,
      mint_proof_bn254: Array.from({ length: 8 }, () => word(1)),
      actions: [
        {
          cmx: word(0x23),
          nullifier: word(0x34),
          ephemeral_key: word(0x56),
          enc_ciphertext: Array(580).fill(1),
          out_ciphertext: Array(80).fill(2),
        },
      ],
    },
  };
  const abi = AbiCoder.defaultAbiCoder();
  const ports = {
    guard: async () => {
      if (!state.valid) throw new Error('context changed');
    },
    load: async () => structuredClone(journal),
    save: async (value) => {
      journal = structuredClone(value);
    },
    api: async (path, body) => {
      if (path.startsWith('/pool/')) return { pool, stale: false };
      if (path === '/reserve') {
        state.reserves++;
        assert.equal(journal.records[0].reservationAttempted, true);
        assert.equal(body.wallet, privacyTag(privacy));
        assert.equal(body.authorization.rawAddressHex, privacy);
        return { ok: true, job };
      }
      if (path === '/jobs/synthetic-job') return structuredClone(job);
      if (path === '/jobs/synthetic-job/permit') {
        state.permits++;
        assert.equal(body.mintCallHash, mintCallHash(journal.records[0].mint));
        assert.equal(body.tokenId, '7');
        assert.equal(body.payer, account);
        return {
          required: true,
          reservationId: state.permitBad ? 'bad' : '0x' + '67'.repeat(32),
          deadline: Math.floor(Date.now() / 1000) + (state.permitExpired ? -1 : 120),
          signature: '0x' + '89'.repeat(65),
        };
      }
      throw new Error('unexpected NFT path ' + path);
    },
    ownership: async (message) => {
      assert.ok(
        message.startsWith('PrivaSea allowlisted free mint\nChain ID: 1\nMarket: ' + NFT.market),
      );
      return { synthetic: true };
    },
    prove: async (method, body) => {
      state.proofs++;
      assert.equal(method, 'nft_mint_prove');
      assert.equal(body.token_id, 7n);
      state.afterProof?.();
      return structuredClone(proof);
    },
    rpc: async (method, params) => {
      if (method === 'eth_chainId') return state.chain;
      if (method === 'eth_getTransactionReceipt')
        return !state.confirmed
          ? null
          : {
              transactionHash: journal.records[0].txHash,
              to: NFT.market,
              from: account,
              status: '0x1',
              blockNumber: '0x20',
              blockHash,
              logs: [{ address: pool, topics: [NOTE_ADDED_TOPIC, cmx] }],
            };
      if (method === 'eth_getBlockByNumber')
        return { number: '0x21', hash: state.reorg ? '0x' + '90'.repeat(32) : blockHash };
      if (method === 'eth_call') {
        const call = nftInterface.parseTransaction({ data: params[0].data });
        const answers = {
          isCollection: [true],
          minter: [NFT.market],
          launches: [
            account,
            0,
            0,
            0,
            1,
            0,
            0,
            ZeroAddress,
            true,
            true,
            2100,
            state.confirmed ? 1 : 0,
          ],
          name: ['Synthetic Jubjub'],
          symbol: ['BIRD'],
          exists: [state.confirmed],
          cmxExists: [state.confirmed],
          mintNoteHash: [
            call.name === 'mintNoteHash'
              ? keccak256(
                  abi.encode(
                    ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
                    [
                      call.args[0].cmx,
                      call.args[0].nf,
                      call.args[0].epk,
                      keccak256(call.args[0].enc),
                      keccak256(call.args[0].out),
                    ],
                  ),
                )
              : '0x' + '00'.repeat(32),
          ],
        };
        return nftInterface.encodeFunctionResult(call.name, answers[call.name]);
      }
      throw new Error('Unexpected RPC ' + method);
    },
    sign: async (transaction) => {
      state.signs++;
      assert.ok(journal.records[0].note, 'private note is durable before signing');
      if (state.signatureReject) throw new Error('User rejected');
      const raw = await wallet.signTransaction({
        ...transaction,
        nonce: 1,
        gasLimit: 500000,
        gasPrice: 2,
        chainId: 1,
      });
      return { raw, hash: keccak256(raw) };
    },
    broadcast: async (signed) => {
      state.broadcasts++;
      const tx = Transaction.from(signed);
      assert.equal(journal.records[0].txHash, tx.hash, 'hash durable before any dispatch');
      assert.equal(tx.to.toLowerCase(), NFT.market);
      if (state.unknown) throw new Error('timeout after acceptance');
      return tx.hash;
    },
    scan: async () => [],
  };
  return {
    state,
    job,
    proof,
    ports,
    engine: new NftMintEngine(ports, account, privacy),
    journal: () => journal,
  };
}
test('native NFT mint reserves once, persists proof/note before signing and hash before broadcast', async () => {
  const f = fixture();
  const result = await f.engine.mint(origin, pool, '11'.repeat(32));
  assert.equal(result.state, 'pending');
  assert.equal(result.tokenId, '7');
  assert.ok(result.txHash);
  assert.deepEqual(
    [f.state.reserves, f.state.proofs, f.state.signs, f.state.broadcasts],
    [1, 1, 1, 1],
  );
  for (const privateKey of ['note', 'bundle', 'mint', 'privacy', 'seed', 'raw'])
    assert.equal(privateKey in result, false);
  f.state.confirmed = true;
  const resumed = await new NftMintEngine(f.ports, account, privacy).mint(
    origin,
    pool,
    '11'.repeat(32),
    result.id,
  );
  assert.equal(resumed.state, 'confirmed');
  assert.deepEqual([f.state.proofs, f.state.signs, f.state.broadcasts], [1, 1, 1]);
});
test('an uncertain broadcast can only resume the saved hash, never produce another signature', async () => {
  const f = fixture();
  f.state.unknown = true;
  const first = await f.engine.mint(origin, pool, '11'.repeat(32));
  assert.match(first.message, /不确定/);
  assert.ok(first.txHash);
  const second = await f.engine.mint(origin, pool, '11'.repeat(32), first.id);
  assert.equal(second.txHash, first.txHash);
  assert.deepEqual(
    [f.state.reserves, f.state.proofs, f.state.signs, f.state.broadcasts],
    [1, 1, 1, 1],
  );
});
test('rejected final approval reuses the original reservation and proof on explicit resume', async () => {
  const f = fixture();
  f.state.signatureReject = true;
  const first = await f.engine.mint(origin, pool, '11'.repeat(32));
  assert.equal(first.txHash, undefined);
  assert.equal(first.canResume, true);
  assert.equal(f.state.broadcasts, 0);
  f.state.signatureReject = false;
  const result = await f.engine.mint(origin, pool, '11'.repeat(32), first.id);
  assert.ok(result.txHash);
  assert.equal(f.state.proofs, 1);
  assert.equal(f.state.reserves, 1);
});
test('expired permits resume the original job and proof with a new permit', async () => {
  const f=fixture();f.state.permitExpired=true;
  const first=await f.engine.mint(origin,pool,'11'.repeat(32));
  assert.equal(first.stage,'permit-expired');assert.equal(first.canResume,true);assert.equal(first.txHash,undefined);
  assert.equal(f.state.signs,0);assert.equal(f.state.broadcasts,0);
  f.state.permitExpired=false;
  const resumed=await f.engine.mint(origin,pool,'11'.repeat(32),first.id);
  assert.ok(resumed.txHash);assert.equal(resumed.id,first.id);assert.equal(resumed.tokenId,first.tokenId);
  assert.deepEqual([f.state.reserves,f.state.proofs,f.state.permits],[1,1,2]);
});
test('wallet changes while proving cannot persist a new proof or broadcast', async () => {
  const f = fixture();
  f.state.afterProof = () => {
    f.state.valid = false;
  };
  await assert.rejects(f.engine.mint(origin, pool, '11'.repeat(32)), /context changed/);
  assert.equal(f.state.signs, 0);
  assert.equal(f.state.broadcasts, 0);
  assert.equal(f.journal().records[0].note, undefined);
});
test('wrong recipient, mismatched reservations, invalid permits and wrong chains cannot sign a mint', async () => {
  for (const kind of ['recipient', 'job', 'permit', 'chain']) {
    const f = fixture();
    if (kind === 'recipient') f.proof.owned_note.recipient_raw_address_hex = '90'.repeat(43);
    if (kind === 'job') f.job.wallet = '0x' + '00'.repeat(32);
    if (kind === 'permit') f.state.permitBad = true;
    if (kind === 'chain') f.state.chain = '0x8f';
    try {
      await f.engine.mint(origin, pool, '11'.repeat(32));
    } catch {
      /* invalid review has no durable record */
    }
    assert.equal(f.state.signs, 0, kind);
    assert.equal(f.state.broadcasts, 0, kind);
  }
});
test('a server-provided foreign transaction cannot confirm an unrelated private NFT', async () => {
  const f = fixture();
  const result = await f.engine.mint(origin, pool, '11'.repeat(32));
  f.state.confirmed = true;
  f.state.reorg = true;
  assert.equal((await f.engine.mint(origin, pool, '11'.repeat(32), result.id)).state, 'pending');
  await assert.rejects(
    new NftMintEngine(f.ports, account, privacy).mint(
      'https://other.invalid',
      pool,
      '11'.repeat(32),
      result.id,
    ),
    /不属于/,
  );
});
test('mint recovery and asset notes use authenticated encryption bound to the privacy wallet', async () => {
  const f = fixture();
  await f.engine.mint(origin, pool, '11'.repeat(32));
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const id = journalId(privacy);
  const box = await seal(f.journal(), id, key);
  assert.equal(JSON.stringify(box).includes('cmx_hex'), false);
  assert.deepEqual(await open(box, id, key), f.journal());
  await assert.rejects(open(box, journalId('90'.repeat(43)), key));
});
test('native signer fixes the reviewed fee cap and nonce before approval and does not broadcast', async () => {
  const f = fixture();
  const first = await f.engine.mint(origin, pool, '11'.repeat(32));
  const record = f.journal().records[0];
  const transaction = {
    chainId: 1,
    to: NFT.market,
    value: '0x0',
    data: protocol.encodeMint(pool, '7', record.mint, { required: false }),
  };
  let approved = false,
    valid = true;
  const provider = {
    estimateGas: async () => 100000n,
    getFeeData: async () => ({ maxFeePerGas: 10n, maxPriorityFeePerGas: 2n }),
    getBalance: async () => 10000000n,
    getTransactionCount: async () => 4,
  };
  const signed = await signNftTransaction(transaction, {
    account,
    signer: wallet,
    provider,
    guard: async () => {
      if (!valid) throw new Error('changed');
    },
    approve: async (details) => {
      approved = true;
      assert.match(details.Gas费用上限, /ETH/);
    },
  });
  assert.equal(approved, true);
  const tx = Transaction.from(signed.raw);
  assert.equal(tx.gasLimit, 120000n);
  assert.equal(tx.nonce, 4);
  assert.equal(tx.maxFeePerGas, 10n);
  await assert.rejects(
    signNftTransaction(
      { ...transaction, to: account },
      { account, signer: wallet, provider, guard: async () => {}, approve: async () => {} },
    ),
  );
  await assert.rejects(
    signNftTransaction(transaction, {
      account,
      signer: wallet,
      provider,
      guard: async () => {
        if (!valid) throw new Error('changed');
      },
      approve: async () => {
        valid = false;
      },
    }),
    /changed/,
  );
  assert.ok(first.txHash);
});
function syncFixture() {
  let journal = { schema: 1, records: [] };
  let spent = false,
    fail = false,
    removed = false;
  const calls = [];
  const note = { cmx_hex: cmx, value_sats: 55, recipient_raw_address_hex: privacy };
  const abi = AbiCoder.defaultAbiCoder();
  const log = {
    address: pool,
    blockNumber: '0xb',
    blockHash,
    transactionHash: '0x' + 'ab'.repeat(32),
    logIndex: '0x0',
    topics: [NOTE_ADDED_TOPIC, cmx],
    data: abi.encode(
      ['bytes', 'bytes', 'bytes32', 'bytes32', 'bytes32'],
      ['0x01', '0x02', '0x' + '56'.repeat(32), nf, ZeroHash],
    ),
  };
  const ports = {
    guard: async () => {},
    load: async () => structuredClone(journal),
    save: async (j) => {
      journal = structuredClone(j);
    },
    scan: async () => [{ note, nullifier: nf }],
    rpc: async (method, params) => {
      calls.push({ method, params });
      if (fail) throw new Error('synthetic RPC outage');
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getCode') return BigInt(params[1]) >= 10n ? '0x1234' : '0x';
      if (method === 'eth_getBlockByNumber')
        return { number: params[0] === 'latest' ? '0x14' : params[0], hash: blockHash };
      if (method === 'eth_getLogs')
        return BigInt(params[0].fromBlock) <= 11n && BigInt(params[0].toBlock) >= 11n ? [log] : [];
      if (method === 'eth_call') {
        const call = nftInterface.parseTransaction({ data: params[0].data });
        const values = {
          poolCount: [removed ? 0 : 1],
          pools: [pool],
          isCollection: [true],
          minter: [NFT.market],
          name: ['Received collection'],
          symbol: ['IN'],
          exists: [!spent],
          cmxExists: [true],
          isSpent: [spent],
        };
        return nftInterface.encodeFunctionResult(call.name, values[call.name]);
      }
      throw new Error('Unexpected ' + method);
    },
  };
  return {
    engine: new NftAssetSync(ports),
    calls,
    ports,
    journal: () => journal,
    spend: () => {
      spent = true;
    },
    fail: () => {
      fail = true;
    },
    removeCollection: () => {
      removed = true;
    },
  };
}
test('NFT sync discovers received assets without any mint history and excludes spent notes', async () => {
  const f = syncFixture();
  const first = await f.engine.sync();
  assert.equal(first.syncComplete, true);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].tokenId, '55');
  assert.equal(first.items[0].type, 'perc721');
  assert.equal(f.journal().records.length, 0);
  assert.equal('note' in first.items[0], false);
  assert.equal('nullifier' in first.items[0], false);
  const scans = f.calls.filter((c) => c.method === 'eth_getLogs').length;
  f.spend();
  const second = await f.engine.sync();
  assert.equal(second.items.length, 0);
  assert.equal(
    f.calls.filter((c) => c.method === 'eth_getLogs').length,
    scans,
    'incremental cursor is reused',
  );
});
test('a failed NFT sync retains known assets and reports incomplete coverage', async () => {
  const f = syncFixture();
  await f.engine.sync();
  f.fail();
  const next = await f.engine.sync();
  assert.equal(next.items.length, 1);
  assert.equal(next.syncComplete, false);
  assert.match(next.error, /outage/);
});

test('collections removed by a chain reorg cannot remain as confirmed NFT holdings', async () => {
  const f = syncFixture();
  assert.equal((await f.engine.sync()).items.length, 1);
  f.removeCollection();
  const current = await f.engine.sync();
  assert.equal(current.syncComplete, true);
  assert.equal(current.items.length, 0);
});

test('NFT transport rule only strips page metadata from this extension’s fixed NFT POST endpoints', async () => {
  const calls = [];
  let reject = true;
  globalThis.chrome = {
    runtime: { id: 'a'.repeat(32) },
    declarativeNetRequest: {
      RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { REMOVE: 'remove' },
      ResourceType: { XMLHTTPREQUEST: 'xmlhttprequest' },
      RequestMethod: { POST: 'post' },
      async updateDynamicRules(input) {
        calls.push(input);
        if (reject) throw new Error('synthetic rule failure');
      },
    },
  };
  const { nftTransportRule, ensureNftTransport } = await import('../src/privacy/nft/transport.ts');
  const rule = nftTransportRule(chrome.runtime.id);
  assert.deepEqual(rule.condition.initiatorDomains, ['a'.repeat(32)]);
  assert.deepEqual(rule.condition.requestMethods, ['post']);
  assert.deepEqual(rule.action.requestHeaders, [
    { header: 'origin', operation: 'remove' },
    { header: 'referer', operation: 'remove' },
  ]);
  const allowed = new RegExp(rule.condition.regexFilter);
  assert.ok(allowed.test('https://app.plabs.online/nft-intake/v1/reserve'));
  assert.ok(allowed.test('https://app.plabs.online/nft-intake/v1/jobs/abc/permit'));
  for (const url of [
    'https://other.invalid/nft-intake/v1/reserve',
    'https://app.plabs.online/nft-intake/v1/bids',
    'https://app.plabs.online/nft-intake/v1/reserve?url=elsewhere',
  ])
    assert.equal(allowed.test(url), false);
  assert.throws(() => nftTransportRule('https://other.invalid'));
  await assert.rejects(ensureNftTransport());
  reject = false;
  await Promise.all([ensureNftTransport(), ensureNftTransport()]);
  assert.equal(calls.length, 2, 'failed initialization can retry; successful setup is coalesced');
  delete globalThis.chrome;
});

test('a permit expiring while the gas approval is open cannot be signed',async()=>{
 const f=fixture();await f.engine.mint(origin,pool,'11'.repeat(32));
 const record=f.journal().records[0],now=Date.now,deadline=Math.floor(now()/1000)+120;
 const transaction={chainId:1,to:NFT.market,value:'0x0',data:protocol.encodeMint(pool,'7',record.mint,{required:true,reservationId:'0x'+'67'.repeat(32),deadline,signature:'0x'+'89'.repeat(65)})};
 let signatures=0;
 try{
  await assert.rejects(signNftTransaction(transaction,{account,signer:{signTransaction:async()=>{signatures++;throw Error('must not sign');}},provider:{estimateGas:async()=>100000n,getFeeData:async()=>({maxFeePerGas:10n,maxPriorityFeePerGas:2n}),getBalance:async()=>10000000n,getTransactionCount:async()=>1},guard:async()=>{},approve:async()=>{Date.now=()=>now()+180000;}}),/许可(?:已过期|有效期不足)/);
 }finally{Date.now=now;}
 assert.equal(signatures,0);
});
