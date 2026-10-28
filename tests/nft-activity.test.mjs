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
const { nftTransferActivities } =
  await import('../src/privacy/nft/activity.ts');
const { journalId, seal, open } = await import('../src/privacy/nft/journal.ts');
const { formatPrivacyAddress, parsePrivacyAddress } =
  await import('../src/privacy/address.ts');
const { compactActivity, decodeActivity } =
  await import('../src/privacy/history.ts');
const account = '0x' + '11'.repeat(20),
  other = '0x' + '22'.repeat(20),
  pool = '0x' + '33'.repeat(20),
  cmx = '0x' + '44'.repeat(32),
  txHash = '0x' + '55'.repeat(32),
  rawPrivacy = '66'.repeat(43);
const key = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt'],
);
function legacyJournal() {
  return {
    schema: 1,
    records: [],
    pools: {
      [pool]: {
        name: 'Jubjub Bird',
        symbol: 'JUBJUB',
        firstBlock: 1,
        cursor: 9,
      },
    },
    transfers: [
      {
        id: 'old-transfer',
        assetId: `${pool}:${cmx}`,
        pool,
        tokenId: '302',
        recipient: rawPrivacy,
        createdAt: 5000,
        state: 'confirmed',
        txHash,
        transaction: { privatePayload: 'do-not-expose' },
        output: { privateNote: 'do-not-expose' },
      },
    ],
  };
}
test('old encrypted NFT sends remain visible after the holding is spent, without treating the token ID as an amount', async () => {
  const journal = legacyJournal(),
    id = journalId('0x' + rawPrivacy),
    box = await seal(journal, id, key);
  const [entry] = nftTransferActivities(await open(box, id, key), account);
  assert.equal(entry.id, 'nft-transfer:old-transfer');
  assert.equal(entry.nftTransferId, 'old-transfer');
  assert.equal(entry.assetType, 'perc721');
  assert.equal(entry.tokenId, '302');
  assert.equal(entry.amountRaw, undefined);
  assert.equal(entry.collectionName, 'Jubjub Bird');
  assert.equal(entry.symbol, 'JUBJUB');
  assert.equal(entry.recipient, formatPrivacyAddress(rawPrivacy));
  assert.equal(entry.createdAt, 5000);
  assert.equal(entry.updatedAt, 5000);
  assert.deepEqual(entry.txHashes, [txHash]);
  assert.equal(entry.status, 'confirmed');
  for (const secret of [
    'privatePayload',
    'privateNote',
    'do-not-expose',
    'transaction',
    'output',
  ])
    assert.equal(JSON.stringify(entry).includes(secret), false);
  assert.deepEqual(
    nftTransferActivities({ schema: 1, records: [] }, account),
    [],
  );
});
test('NFT activities preserve status, stable identity and account ownership across refreshes', () => {
  const journal = legacyJournal();
  journal.transfers[0] = {
    ...journal.transfers[0],
    account,
    name: 'Saved collection',
    symbol: 'SAVED',
    state: 'submitted',
  };
  const pending = nftTransferActivities(journal, account)[0];
  assert.equal(pending.status, 'pending');
  assert.equal(pending.refreshable, true);
  assert.equal(pending.collectionName, 'Saved collection');
  assert.deepEqual(nftTransferActivities(journal, other), []);
  journal.transfers[0].state = 'confirmed';
  journal.transfers[0].updatedAt = 8000;
  const confirmed = nftTransferActivities(journal, account)[0];
  assert.equal(confirmed.id, pending.id);
  assert.equal(confirmed.updatedAt, 8000);
  assert.equal(confirmed.refreshable, false);
  journal.transfers[0].state = 'failed';
  journal.transfers[0].message = 'reverted';
  assert.equal(nftTransferActivities(journal, account)[0].error, 'reverted');
});
const source = readFileSync(
  new URL('../src/background.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(
  source.slice(
    source.indexOf('const activityHistory ='),
    source.indexOf('let journalWriteQueue ='),
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
async function queryFixture(change) {
  let chainId = 1;
  let locked = false;
  const id = journalId('0x' + rawPrivacy),
    store = {
      [id]: await seal(legacyJournal(), id, key),
      archive: [
        {
          id: 'token-send',
          walletAddress: account,
          chainId: 1,
          state: 'confirmed',
          kind: 'send',
          symbol: 'sUSDC',
          decimals: 6,
          amountRaw: '7000000',
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: 'other-wallet',
          walletAddress: other,
          chainId: 1,
          state: 'confirmed',
          createdAt: 9000,
        },
      ],
      journal: [],
    };
  const scope = {
    operationEpoch: 1,
    ACTIVITY_HISTORY_KEY: 'archive',
    OPERATION_JOURNAL_KEY: 'journal',
    requireUnlocked: () => ({ address: account }),
    activityKey: async () => key,
    selectedChainId: async () => chainId,
    isSupportedChainId: (c) => [1, 143, 8453, 42161].includes(c),
    localGet: async (k) => store[k],
    compactActivity,
    decodeActivity,
    privacyAccountState: async () => ({
      privacyAddress: formatPrivacyAddress(rawPrivacy),
    }),
    parsePrivacyAddress,
    nftJournalId: journalId,
    openNftJournal: async (...args) => {
      const value = await open(...args);
      if (change === 'account') scope.operationEpoch++;
      if (change === 'chain') chainId = 143;
      if (change === 'lock') locked = true;
      return value;
    },
    nftTransferActivities,
    requirePrivacyUnlocked: async () => {
      if (locked) throw Error('隐私账户已锁定');
    },
  };
  // Archive entries use the same compact form produced by live operation writes.
  store.archive = store.archive.map(compactActivity);
  const { activityHistory } = new Function(
    'scope',
    `with(scope){${compiled};return{activityHistory};}`,
  )(scope);
  return { query: activityHistory, store, setChain: (id) => (chainId = id) };
}
test('the real history query merges old NFT sends with tokens before sorting, filtering and pagination', async () => {
  const f = await queryFixture();
  const all = await f.query({ chainId: 1 }, true);
  assert.deepEqual(
    all.items.map((i) => i.id),
    ['nft-transfer:old-transfer', 'token-send'],
  );
  assert.equal(all.total, 2);
  assert.deepEqual(
    (await f.query({ chainId: 1, id: 'nft-transfer:old-transfer' })).items.map(
      (i) => i.tokenId,
    ),
    ['302'],
  );
  assert.equal((await f.query({ chainId: 1, poolAddress: pool })).total, 1);
  assert.equal((await f.query({ chainId: 1, status: 'pending' })).total, 0);
  assert.deepEqual(
    (await f.query({ chainId: 1 }, true, false)).items.map((i) => i.id),
    ['token-send'],
    'The existing fungible SDK history remains compatible',
  );
  f.setChain(143);
  assert.equal((await f.query({ chainId: 143 }, true)).total, 0);
});
test('a lock or account/network change cannot return decrypted NFT history to the old view', async () => {
  for (const change of ['account', 'chain', 'lock']) {
    const f = await queryFixture(change);
    await assert.rejects(
      f.query({ chainId: 1 }, true),
      /重新打开历史记录|隐私账户已锁定/,
    );
  }
});
