import { AbiCoder, Interface } from 'ethers';
import { encodeTransfer, reverseHexByByte } from '../operations';
import { buildNftMerklePath } from './merkle';
import { parsePrivacyAddress } from '../address';
import type { NftPorts } from './engine';
import type { MintJournal } from './journal';
import {
  NFT,
  address,
  hash,
  integer,
  nftInterface,
  object,
  raw,
  verifySignedTransaction,
  type Json,
} from './protocol';

export type NftTransfer = {
  id: string;
  assetId: string;
  pool: string;
  tokenId: string;
  recipient: string;
  createdAt: number;
  state: 'ready' | 'submitted' | 'confirmed' | 'failed';
  transaction: Json;
  output: Json;
  txHash?: string;
  raw?: string;
  message?: string;
};
export const publicTransfer = (t: NftTransfer) => ({
  id: t.id,
  assetId: t.assetId,
  tokenId: t.tokenId,
  recipient: t.recipient,
  state: t.state,
  txHash: t.txHash,
  message: t.message,
});
const poolAbi = new Interface([
  'function cmxRoot() view returns(bytes32)',
  'function cmxFrozenRoot() view returns(bytes32)',
  'function isValidAnchor(bytes32) view returns(bool)',
  'function maxActions() view returns(uint256)',
]);
const transferAbi = new Interface([
  'function transfer((bytes actions,uint256[8] bindingProof))',
]);
const actionType =
  'tuple(bytes32 cmx,bytes encCiphertext,bytes outCiphertext,bytes32 ephemeralKey,bytes32 nullifier,bytes32 anchor,bytes proof,uint256[8] pubFields)[]';

/** Inspect locally produced calldata again at the signing boundary. */
export function inspectNftTransfer(input: unknown) {
  const tx = object(input),
    pool = address(tx.to),
    recipient = parsePrivacyAddress(String(tx.recipient));
  const tokenId = integer(tx.tokenId);
  if (
    tx.chainId !== 1 ||
    tx.value !== '0x0' ||
    !tokenId ||
    tokenId > 100_000 ||
    typeof tx.data !== 'string' ||
    tx.data.length > 200_000
  )
    throw new Error('NFT 转移交易无效');
  const call = transferAbi.parseTransaction({ data: tx.data });
  if (
    !call ||
    call.name !== 'transfer' ||
    call.args[0].bindingProof.every((n: bigint) => n === 0n)
  )
    throw new Error('NFT 转移证明无效');
  const [actions] = AbiCoder.defaultAbiCoder().decode(
    [actionType],
    call.args[0].actions,
  );
  if (
    actions.length < 1 ||
    actions.length > 32 ||
    !actions.some(
      (a: { nullifier: string }) => a.nullifier === hash(tx.nullifier),
    ) ||
    !actions.some((a: { cmx: string }) => a.cmx === hash(tx.outputCmx))
  )
    throw new Error('NFT 转移与原凭证不符');
  return { pool, recipient, tokenId };
}

export class NftTransferEngine {
  constructor(
    private p: NftPorts,
    private account: string,
  ) {}
  private async save(j: MintJournal) {
    await this.p.guard();
    await this.p.save(j);
    await this.p.guard();
  }
  private async view(pool: string, method: string, args: unknown[] = []) {
    const abi = poolAbi.hasFunction(method) ? poolAbi : nftInterface;
    const result = await this.p.rpc('eth_call', [
      { to: pool, data: abi.encodeFunctionData(method, args) },
      'latest',
    ]);
    return abi.decodeFunctionResult(method, String(result))[0];
  }
  async send(assetId: unknown, recipientInput: unknown, seed: string) {
    if (typeof assetId !== 'string') throw new Error('NFT 标识无效');
    const recipient = parsePrivacyAddress(String(recipientInput));
    const j = await this.p.load();
    j.transfers ??= [];
    const pending = j.transfers.find(
      (t) => t.assetId === assetId && ['ready', 'submitted'].includes(t.state),
    );
    if (pending) {
      if (pending.recipient !== recipient)
        throw new Error('此 NFT 已有待处理的发送，请先核对原交易');
      return this.submit(j, pending);
    }
    const note = j.holdings?.find(
      (h) => `${h.pool}:${h.cmx}` === assetId && !h.spent,
    );
    if (!note) throw new Error('请先同步 NFT，只有已确认的持有凭证可以发送');
    const pool = address(note.pool),
      tokenId = integer(note.tokenId);
    if (
      !tokenId ||
      tokenId > 100_000 ||
      String(note.note.value_sats) !== note.tokenId
    )
      throw new Error('NFT 编号与持有凭证不符');
    if (
      (await this.p.rpc('eth_chainId', [])) !== '0x1' ||
      (await this.view(NFT.factory, 'isCollection', [pool])) !== true
    )
      throw new Error('NFT 合集或网络无法核对');
    if (
      (await this.view(pool, 'cmxExists', [hash(note.cmx)])) !== true ||
      (await this.view(pool, 'isSpent', [
        `0x${reverseHexByByte(note.nullifier)}`,
      ])) !== false
    )
      throw new Error('NFT 已转出或凭证尚未确认');
    const path = await buildNftMerklePath(this.p, {
      pool,
      cmx: note.cmx,
      seed,
      firstBlock: j.pools?.[pool]?.firstBlock,
    });
    const { position, anchor, frozenRoot, maxActions } = path;
    if (
      (await this.view(pool, 'isValidAnchor', [
        `0x${reverseHexByByte(anchor)}`,
      ])) !== true
    )
      throw new Error('NFT 确认根已更新，请重新发送');
    let frozenUnavailable = false;
    const frozen = await this.indexer(`/frozen_leaves?pool=${pool}`).catch(
      async () => {
        await this.p.guard();
        frozenUnavailable = true;
        return { leaves: [] };
      },
    );
    const blacklist = object(frozen).leaves;
    if (!Array.isArray(blacklist)) throw new Error('NFT 冻结记录无效');
    const proof = object(
      await this.p
        .prove('prove_note', {
          seed_hex: seed,
          bip44_coin_type: 60,
          account_id: 0,
          chain_id: 1,
          pool_address: pool,
          anchor_hex: `0x${anchor}`,
          spend_notes: [note.note],
          merkle_path_overrides: [
            {
              cmx_hex: raw(note.cmx, 32),
              position,
              siblings: path.siblings,
              anchor_hex: `0x${anchor}`,
            },
          ],
          transfer_output: {
            value_sats: tokenId,
            recipient_raw_address_hex: recipient,
          },
          max_actions: maxActions,
          frozen_blacklist: blacklist,
          expected_frozen_root: String(frozenRoot),
        })
        .catch((cause) => {
          if (
            frozenUnavailable &&
            /frozen.*root|frozen_blacklist/i.test(String(cause))
          )
            throw new Error('NFT 冻结状态暂不可验证，请稍后重试');
          throw cause;
        }),
    );
    // The ID is the note value; sending must preserve the entire ID, without a fee/change output.
    const funding = proof.funding_notes;
    if (
      !Array.isArray(funding) ||
      funding.length !== 1 ||
      (proof.output_note &&
        String(object(proof.output_note).value_sats) !== '0')
    )
      throw new Error('NFT 转移必须只有一个完整编号输出');
    const output = object(funding[0]);
    if (
      String(output.value_sats) !== note.tokenId ||
      raw(output.recipient_raw_address_hex, 43) !== recipient
    )
      throw new Error('NFT 发送输出与收款人或编号不符');
    const data = encodeTransfer(object(proof.bundle));
    const transaction = {
      to: pool,
      data,
      value: '0x0',
      chainId: 1,
      recipient,
      tokenId: note.tokenId,
      nullifier: `0x${reverseHexByByte(note.nullifier)}`,
      outputCmx: hash(output.cmx_hex),
    };
    inspectNftTransfer(transaction);
    const t: NftTransfer = {
      id: crypto.randomUUID(),
      assetId,
      pool,
      tokenId: note.tokenId,
      recipient,
      createdAt: Date.now(),
      state: 'ready',
      transaction,
      output,
    };
    if (j.transfers.length >= 4096) throw new Error('NFT 发送记录已满');
    j.transfers.push(t);
    await this.save(j);
    return this.submit(j, t);
  }
  private async indexer(path: string) {
    // Proof paths are public; seeds, note openings and viewing keys remain inside the extension.
    await this.p.guard();
    if (!this.p.indexer) throw new Error('NFT 证明路径服务不可用');
    const result = await this.p.indexer(path);
    await this.p.guard();
    return result;
  }
  private async submit(j: MintJournal, t: NftTransfer) {
    if (t.txHash) return this.status(t.id);
    await this.p.guard();
    let signed;
    try {
      signed = verifySignedTransaction(
        await this.p.sign(t.transaction),
        t.transaction,
        this.account,
      );
    } catch (error) {
      t.state = 'failed';
      t.message = '发送未签署或已取消';
      await this.save(j);
      throw error;
    }
    // Save the exact hash/raw before broadcasting: an ambiguous response never permits another signature.
    t.txHash = signed.hash;
    t.raw = signed.raw;
    t.state = 'submitted';
    await this.save(j);
    try {
      if (hash(await this.p.broadcast(signed.raw)) !== signed.hash)
        throw new Error('NFT 广播哈希不符');
    } catch {
      t.message = '广播结果待核对，请更新原交易状态；不会重复签署';
      await this.save(j);
    }
    return publicTransfer(t);
  }
  async status(id: unknown) {
    const j = await this.p.load(),
      t = j.transfers?.find((t) => t.id === id);
    if (!t) throw new Error('NFT 发送记录不存在');
    if (t.txHash && t.state === 'submitted') {
      const receipt = await this.p.rpc('eth_getTransactionReceipt', [t.txHash]);
      if (receipt) {
        const r = object(receipt);
        if (hash(r.transactionHash) !== t.txHash || address(r.to) !== t.pool)
          throw new Error('NFT 回执与原交易不符');
        if (r.status === '0x0') {
          t.state = 'failed';
          t.message = '链上交易失败，NFT 仍保留，请同步后重试';
        } else if (r.status === '0x1') {
          const latest = object(
            await this.p.rpc('eth_getBlockByNumber', ['latest', false]),
          );
          if (
            BigInt(String(latest.number)) - BigInt(String(r.blockNumber)) >=
            11n
          ) {
            t.state = 'confirmed';
            t.message = undefined;
            const note = j.holdings?.find(
              (n) => `${n.pool}:${n.cmx}` === t.assetId,
            );
            if (note) note.spent = true;
          }
        }
      } else if (t.raw) {
        // Retry only the same signed transaction. Never allocate a new nonce or sign again.
        try {
          await this.p.broadcast(t.raw);
        } catch {
          /* An unavailable RPC cannot prove failure. */
        }
      }
      await this.save(j);
    }
    return publicTransfer(t);
  }
}
