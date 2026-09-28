import { decodePrivacyLog, NOTE_ADDED_TOPIC } from '../events';
import { DEX, dexIndexer, hex, integer, object, raw, reverse, type JsonRecord } from './protocol';
import type { DexRecord } from './journal';
import type { DexPorts } from './engine';

export interface RecoveryPorts extends Pick<DexPorts, 'guard' | 'http' | 'rpc' | 'prove' | 'view'> {
  importPayout(pool: string, note: JsonRecord, txHash: string, block: number): Promise<void>;
}
function blindHex(value: unknown) {
  if (typeof value !== 'string' || !/^(0x[0-9a-f]{1,64}|[0-9]{1,78})$/i.test(value))
    throw new Error('结算 blind 无效');
  const n = BigInt(value);
  if (n < 0n || n >= 1n << 256n) throw new Error('结算 blind 超出范围');
  return `0x${n.toString(16).padStart(64, '0')}`;
}
export function settlementSlot(pool: string, action: number, b: JsonRecord): number | null {
  if (!Number.isSafeInteger(action) || action < 0) return null;
  const x = String(b.pool_x).toLowerCase(),
    y = String(b.pool_y).toLowerCase(),
    fee = String(b.fee_pool).toLowerCase();
  if (pool === fee && action >= 2 && (pool === x || pool === y))
    return action <= 3 ? action + 2 : null;
  if (action > 1) return null;
  return pool === x ? action : pool === y ? action + 2 : pool === fee ? action + 4 : null;
}
const openedNote = (
  match: JsonRecord,
  amount: unknown,
  address: string,
  payout: boolean,
): JsonRecord => ({
  cmx_hex: raw(match.cmx_hex, 32),
  value_sats: Number(integer(amount)),
  rho_hex: raw(reverse(match.rho_hex), 32),
  rcm_hex: raw(reverse(match.rcm_hex), 32),
  psi_hex: payout ? '00'.repeat(32) : raw(reverse(match.psi_hex), 32),
  rseed_hex: '00'.repeat(32),
  recipient_raw_address_hex: raw(match.recipient_raw_address_hex ?? address, 43),
});
/** Reconstruct only this order's chain. Every output is matched against a canonical finalized receipt. */
export async function collectPayouts(
  p: RecoveryPorts,
  record: DexRecord,
  seed: string,
): Promise<JsonRecord | null> {
  const material = record.material,
    terms = object(material.terms),
    pay = String(material.pay_pool),
    want = String(terms.want_asset);
  const keys = await p.prove('keys', {
    seed_hex: seed,
    account_id: record.account,
    bip44_coin_type: 60,
  });
  const nk = reverse(keys.nk_hex),
    address = raw(keys.raw_address_hex, 43),
    payoutAddress = raw(material.payout_address_raw_hex, 43);
  let note = record.principalNote,
    received = 0n;
  const visited = new Set<string>();
  for (let hop = 0; hop < 512; hop++) {
    p.guard();
    const cmx = hex(note.cmx_hex);
    if (visited.has(cmx)) throw new Error('订单恢复链出现重复承诺');
    visited.add(cmx);
    if (integer(note.value_sats) === 0n) return null;
    if ((await p.view(pay, 'cmxExists', [cmx])) !== true) throw new Error('订单资金尚未确认');
    const nfs = await p.prove('compute_nullifiers', { nk_hex: keys.nk_hex, notes: [note] });
    const nf = reverse((nfs.nullifiers as unknown[])[0]);
    if ((await p.view(pay, 'isSpent', [nf])) === false) return note;
    const found = await p.http(
      `${dexIndexer(pay)}/note/by_nf?${new URLSearchParams({ pool: pay, nf })}`,
      undefined,
      true,
    );
    if (!found) throw new Error('订单已花费，但索引尚未跟上；保留恢复记录');
    const spend = object(found),
      tx = hex(spend.tx_hash);
    if (
      spend.canonical !== true ||
      spend.settlement_venue === 'amm' ||
      !Array.isArray(spend.outputs)
    )
      throw new Error('订单结算来源无法验证');
    const receipt = object(await p.rpc('eth_getTransactionReceipt', [tx]));
    const final = object(await p.rpc('eth_getBlockByNumber', ['finalized', false]));
    if (
      receipt.status !== '0x1' ||
      hex(receipt.transactionHash) !== tx ||
      BigInt(String(receipt.blockNumber)) > BigInt(String(final.number)) ||
      object(await p.rpc('eth_getBlockByNumber', [receipt.blockNumber, false])).hash !==
        receipt.blockHash
    )
      throw new Error('订单结算还未最终确认');
    const logs = (receipt.logs as JsonRecord[])
      .filter((l) => (l.topics as string[])?.[0]?.toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase())
      .map((l) => ({ pool: String(l.address).toLowerCase(), note: decodePrivacyLog(l)! }));
    if (!logs.some((l) => l.pool === pay && 'nf_old' in l.note && hex(l.note.nf_old) === nf))
      throw new Error('结算回执未包含订单 nullifier');
    if (spend.settlement === false) {
      // A direct reclaim must be one that this wallet explicitly journaled, not untrusted indexer prose.
      if (
        !(record.recovery ?? []).some(
          (f) =>
            f.pool === pay &&
            f.state === 'confirmed' &&
            f.txHash === tx &&
            f.inputs.includes(raw(note.cmx_hex, 32)),
        )
      )
        throw new Error('未知的订单资金花费，保留恢复记录');
      return null;
    }
    if (spend.settlement !== true || spend.settlement_venue !== 'pex')
      throw new Error('无法确认订单簿结算来源');
    const blinds = object(
      await p.http(`${dexIndexer(pay)}/settlement/blinds?${new URLSearchParams({ tx })}`),
    );
    if (!Array.isArray(blinds.blinds) || blinds.blinds.length !== 6)
      throw new Error('结算 blinds 不完整');
    if (
      !([DEX.base, DEX.quote] as string[]).includes(String(blinds.pool_x).toLowerCase()) ||
      !([DEX.base, DEX.quote] as string[]).includes(String(blinds.pool_y).toLowerCase()) ||
      String(blinds.pool_x).toLowerCase() === String(blinds.pool_y).toLowerCase() ||
      String(blinds.fee_pool).toLowerCase() !== DEX.quote
    )
      throw new Error('结算资产池不符合订单市场');
    const wantSlot = String(blinds.pool_x).toLowerCase() === want ? 1 : 3;
    const value = await p.prove('vnote_blind_value', {
      nk_hex: nk,
      nf_hex: nf,
      j: wantSlot,
      blind_hex: blindHex(blinds.blinds[wantSlot]),
    });
    const receivedThisFill = integer(value.value);
    received += receivedThisFill;
    integer(String(received));
    // Derive action indexes from on-chain NoteAdded order, not website-provided action indexes.
    const counters = new Map<string, number>();
    let successor: JsonRecord | null = null,
      payout: JsonRecord | null = null;
    for (const log of logs) {
      if (
        !['nf_old' in log.note && log.pool === pay, 'nf_old' in log.note && log.pool === want].some(
          Boolean,
        )
      )
        continue;
      const action = counters.get(log.pool) ?? 0;
      counters.set(log.pool, action + 1);
      const slot = settlementSlot(log.pool, action, blinds);
      if (slot === null || !('nf_old' in log.note)) continue;
      const common = {
        nk_hex: nk,
        nf_hex: nf,
        j: slot,
        blind_hex: blindHex(blinds.blinds[slot]),
        output_cmx_hex: hex(log.note.cmx),
        output_nf_old_hex: hex(log.note.nf_old),
      };
      if (log.pool === pay) {
        const matched = await p.prove('vnote_match_successor', {
          ...common,
          fee_paid_next: 1,
          want_asset_hex: want,
          price_num: terms.price_num,
          price_den: terms.price_den,
          payout_commit_hex: terms.payout_commit,
          max_want: terms.max_want,
          want_recv_next: String(received),
          recipient_raw_address_hex: address,
        });
        if (matched.matched === true) {
          if (successor) throw new Error('同一成交出现多个订单后继');
          successor = openedNote(matched, matched.remain, address, false);
          if (
            hex(successor.cmx_hex) !== hex(log.note.cmx) ||
            integer(successor.value_sats) > integer(note.value_sats)
          )
            throw new Error('订单后继余额无效');
        }
      }
      if (log.pool === want) {
        const matched = await p.prove('vnote_match_payout', {
          ...common,
          recipient_raw_address_hex: payoutAddress,
        });
        if (matched.matched === true) {
          if (payout) throw new Error('同一成交出现多个收款凭证');
          payout = openedNote(matched, matched.value, payoutAddress, true);
          if (
            hex(payout.cmx_hex) !== hex(log.note.cmx) ||
            integer(payout.value_sats) !== receivedThisFill
          )
            throw new Error('成交入账金额不符');
        }
      }
    }
    if (!payout || !successor) throw new Error('暂时无法验证成交收款或订单后继，保留恢复记录');
    await p.importPayout(want, payout, tx, Number(BigInt(String(receipt.blockNumber))));
    note = successor;
  }
  throw new Error('订单成交链过长，恢复记录已保留');
}
