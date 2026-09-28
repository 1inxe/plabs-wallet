import { DexEngine, type DexPorts } from '../src/privacy/dex/engine';
import { DEX, encryptMaterial, object, raw, reverse, serialize } from '../src/privacy/dex/protocol';
import { newJournal, type DexJournal } from '../src/privacy/dex/journal';
import type { PrivacyOwnedNote } from '../src/shared/types';

// Packaged only into a disposable test extension. Never included in a release.
export async function runProofFixture(
  wasm: any,
  call: (method: string, body: Record<string, unknown>) => Promise<any>,
  liveKey?: Record<string, unknown>,
  legacyCall?: (method: string, body: Record<string, unknown>) => Promise<any>,
) {
  const seed = '01'.repeat(32),
    notes = new Map<string, PrivacyOwnedNote[]>();
  const key = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const publicKey = [...new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  const main = await call('keys', { seed_hex: seed, account_id: 0, bip44_coin_type: 60 });
  for (const pool of [DEX.base, DEX.quote]) {
    const shield = wasm.shield_prepare({
      seed_hex: seed,
      amount_sats: 100000000,
      chain_id: 143,
      pool_address: pool,
      anchor_hex: '0x' + '00'.repeat(32),
      bip44_coin_type: 60,
    });
    const finalized = object(
      serialize(
        wasm.shield_finalize({
          prepared: shield.prepared,
          proof_hex: '0x' + '00'.repeat(256),
          binding_proof_hex: '0x' + '00'.repeat(256),
        }),
      ),
    );
    const owned = object(finalized.owned_note);
    const nf = await call('compute_nullifiers', { nk_hex: main.nk_hex, notes: [owned] });
    notes.set(pool, [
      {
        cmxHex: raw(owned.cmx_hex, 32),
        nullifierHex: raw(nf.nullifiers[0], 32),
        ownedNote: owned,
        valueSats: String(owned.value_sats),
        confirmed: true,
        spent: false,
        rawNote: {},
        txHash: '',
        blockNumber: 0,
        cmxPosition: 0,
      },
    ]);
    await call('tree_append', {
      treeKey: pool,
      generation: 'test',
      expectedStartPosition: 0,
      leaves: [{ cmx_be_hex: '0x' + raw(owned.cmx_hex, 32), owned: true }],
    });
  }
  let journal: DexJournal = newJournal();
  const requests: string[] = [];
  const ports: DexPorts = {
    guard() {},
    load: async () => structuredClone(journal),
    save: async (value) => {
      journal = structuredClone(value);
    },
    prove: async (method, body) => {
      console.log(`DEX proof fixture: ${method}`);
      return object(serialize(await call(method, body)));
    },
    http: async (url, body) => {
      requests.push(url);
      if (url.endsWith('/dex-matcher/healthz'))
        return {
          status: 'ok',
          chain_id: 143,
          base: DEX.base,
          quote: DEX.quote,
          settlement_addr: DEX.settlement,
          base_decimals: 6,
          quote_decimals: 6,
          price_scale: 1000000,
          verify_enabled: true,
          verify_address: DEX.verifyAddress,
          dex_settlement_version: 5,
          vnote_profile: {
            protocol_version: 5,
            terms_version: 2,
            memo_version: 2,
            profile_id: 'vnote-cross-price-cap-v2',
          },
          placement_idempotency: true,
          order_terms_durable: true,
          persistence_healthy: true,
          matches_epoch: 'fixture',
          price_tick: '100',
          lot_size: 10000,
          fee_units: 500000,
          fee_pool: DEX.quote,
          material_encryption: {
            alg: 'p256-ecdh-aes-256-gcm',
            version: 1,
            public_key_hex: '0x' + publicKey,
          },
        };
      if (url === DEX.relayer + '/healthz')
        return {
          ok: true,
          gas_policy: {
            chain_id: 143,
            schema: 'perc20-relayer-gas-policy/v1',
            transfer_cap: 24000000,
            margin_bps: 200,
          },
        };
      if (url.endsWith('/vnote/preflight')) {
        if (!object(body).encrypted) throw new Error('Missing encrypted material');
        return { ready: true, protocol_version: 5, terms_version: 2 };
      }
      throw new Error('Unexpected network call in proof-only fixture: ' + url);
    },
    view: async (_pool, method) =>
      method === 'feeAmount'
        ? 500000n
        : method === 'feeAssetPool'
          ? DEX.quote
          : method === 'maxActions'
            ? 16n
            : false,
    rpc: async (method) => (method === 'eth_chainId' ? '0x8f' : { hash: DEX.genesis }),
    notes: async (pool) => notes.get(pool) ?? [],
    paths: async (pool, owned) => {
      await call('tree_reset', { pool, generation: 'test' });
      await call('tree_append', {
        treeKey: pool,
        generation: 'test',
        expectedStartPosition: 0,
        leaves: owned.map((n) => ({ cmx_be_hex: '0x' + n.cmxHex, owned: true })),
      });
      const paths = await call('tree_paths', {
        pool,
        generation: 'test',
        cmxs: owned.map((n) => n.cmxHex),
      });
      return paths.overrides.map((path: unknown, i: number) => {
        return {
          ...object(serialize(path)),
          cmx_hex: owned[i].cmxHex,
          anchor_hex: paths.rootLeHex,
        };
      });
    },
    collectPayouts: async () => null,
  };
  const engine = new DexEngine(ports);
  const prepared = await engine.prepare(
    {
      chainId: '0x8f',
      side: 'sell',
      type: 'limit',
      quantityRaw: '10000000',
      priceTicks: '1000',
      maxFeeRaw: '500000',
    },
    'https://fixture.invalid',
    seed,
  );
  const record = journal.records[0];
  if (legacyCall) {
    const legacyKeys = await legacyCall('keys', {
      seed_hex: seed,
      account_id: 0,
      bip44_coin_type: 60,
    });
    if (legacyKeys.raw_address_hex !== main.raw_address_hex)
      throw new Error('Main address changed across prover builds');
    const bytes = (v: unknown) =>
      typeof v === 'string'
        ? v.replace(/^0x/, '')
        : Array.from(v as number[], (n) => n.toString(16).padStart(2, '0')).join('');
    for (const funding of record.funding) {
      const wire = (funding.bundle.actions as Record<string, unknown>[]).map((a) => ({
        cmx_hex: bytes(a.cmx),
        epk_hex: bytes(a.ephemeral_key),
        enc_ciphertext_hex: bytes(a.enc_ciphertext),
        nf_old_hex: bytes(a.nullifier),
        out_ciphertext_hex: bytes(a.out_ciphertext),
        cv_net_x_hex: bytes((a.pub_fields_bn254 as unknown[])[6]),
      }));
      const scanned = await legacyCall('scan', {
        bn254_ivk_hex: legacyKeys.bn254_ivk_hex,
        own_raw_address_hex: legacyKeys.raw_address_hex,
        notes: wire,
      });
      const expected = funding.pool === DEX.base ? '90000000' : '99500000';
      if (
        !scanned.owned_notes.some((n: Record<string, unknown>) => String(n.value_sats) === expected)
      )
        throw new Error('Legacy wallet could not discover DEX change');
    }
  }

  if (
    record.funding.length !== 2 ||
    record.funding[0].pool !== DEX.quote ||
    record.funding[1].pool !== DEX.base
  )
    throw new Error('Fee/principal order wrong');
  if (record.funding.some((f) => f.state !== 'prepared')) throw new Error('Unexpected funding');
  if (String(object(record.material.account_s).view_account_index) === '0')
    throw new Error('Main account delegated');
  if (reverse(record.principalNote.psi_hex) !== object(record.material.c0).psi_hex)
    throw new Error('VNote endian mismatch');
  if (JSON.stringify(prepared).includes('nk_hex')) throw new Error('Private material escaped');
  const livePreflights = liveKey
    ? [{ encrypted: await encryptMaterial(record.material, liveKey) }]
    : [];
  // Prove recovery from the exact child-owned VNote and fee note back to main account.
  const childKeys = await call('keys', {
    seed_hex: seed,
    account_id: record.account,
    bip44_coin_type: 60,
  });
  for (const [pool, note] of [
    [DEX.base, record.principalNote],
    [DEX.quote, record.feeNote],
  ] as const) {
    const nfs = await call('compute_nullifiers', { nk_hex: childKeys.nk_hex, notes: [note] });
    const owned = {
      cmxHex: raw(note.cmx_hex, 32),
      nullifierHex: raw(nfs.nullifiers[0], 32),
      ownedNote: note,
      valueSats: String(note.value_sats),
      confirmed: true,
      spent: false,
      rawNote: {},
      txHash: '',
      blockNumber: 0,
      cmxPosition: 0,
    };
    const paths = await ports.paths(pool, [owned]);
    const proof = await ports.prove('prove_note', {
      seed_hex: seed,
      account_id: record.account,
      bip44_coin_type: 60,
      spend_notes: [note],
      anchor_hex: paths[0].anchor_hex,
      merkle_path_overrides: paths,
      chain_id: 143,
      pool_address: pool,
      max_actions: 16,
      transfer_output: {
        value_sats: Number(note.value_sats),
        recipient_raw_address_hex: main.raw_address_hex,
      },
    });
    const output = object((proof.funding_notes as unknown[])[0]);
    if (
      raw(output.recipient_raw_address_hex, 43) !== raw(main.raw_address_hex, 43) ||
      String(output.value_sats) !== String(note.value_sats)
    )
      throw new Error('Recovery destination/amount mismatch');
  }
  await engine.discard(prepared.localId, 'https://fixture.invalid');
  const buy = await engine.prepare(
    {
      chainId: '0x8f',
      side: 'buy',
      type: 'market',
      quantityRaw: '10000000',
      priceTicks: '1000',
      maxFeeRaw: '500000',
    },
    'https://fixture.invalid',
    seed,
  );
  if (
    journal.records[1].funding.length !== 1 ||
    journal.records[1].funding[0].commitments.length !== 3
  )
    throw new Error('Same-pool funding shape wrong');
  if (liveKey)
    livePreflights.push({ encrypted: await encryptMaterial(journal.records[1].material, liveKey) });
  await engine.discard(buy.localId, 'https://fixture.invalid');
  return {
    livePreflights,
    proofs: 5,
    preflight: requests.filter((u) => u.endsWith('/vnote/preflight')).length,
    broadcasts: requests.filter((u) => u.includes('/submit')).length,
  };
}
