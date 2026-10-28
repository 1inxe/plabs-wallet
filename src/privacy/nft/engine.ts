import { ZeroAddress, ZeroHash } from 'ethers';
import { NOTE_ADDED_TOPIC } from '../events';
import { walletErrorMessage } from '../../shared/errors';
import { publicMint, type MintJournal, type MintRecord } from './journal';
import {
  NFT,
  address,
  encodeMint,
  hash,
  integer,
  mintCallHash,
  mintEnvelope,
  nftInterface,
  object,
  ownershipMessage,
  parseMintRequest,
  parsePermit,
  privacyTag,
  raw,
  verifySignedTransaction,
  type Json,
  type MintNote,
} from './protocol';

export interface NftPorts {
  guard(): Promise<void>;
  load(): Promise<MintJournal>;
  save(journal: MintJournal): Promise<void>;
  api(path: string, body?: unknown): Promise<unknown>;
  prove(method: string, body: Json): Promise<unknown>;
  ownership(message: string): Promise<unknown>;
  rpc(method: string, params: unknown[]): Promise<unknown>;
  sign(transaction: Json): Promise<unknown>;
  broadcast(raw: string): Promise<unknown>;
  indexer?(path: string): Promise<unknown>;
  scan(notes: Json[]): Promise<Array<{ note: Json; nullifier: string }>>;
  birthday?: { number: number; hash: string };
  history?(input: { pool: string; firstBlock: number; afterBlock: number; targetBlock: number }): Promise<{
    notes: Json[]; toBlock: number; checkpoint: string;
  }>;
}
export class NftMintEngine {
  constructor(
    private p: NftPorts,
    private account: string,
    private privacy: string,
  ) {}
  private async save(journal: MintJournal) {
    await this.p.guard();
    await this.p.save(journal);
    await this.p.guard();
  }
  private async view(to: string, method: string, args: unknown[] = [], block = 'latest') {
    await this.p.guard();
    const data = await this.p.rpc('eth_call', [
      { to, data: nftInterface.encodeFunctionData(method, args) },
      block,
    ]);
    const result = nftInterface.decodeFunctionResult(method, String(data));
    await this.p.guard();
    return result;
  }
  async review(pool: string) {
    parseMintRequest({ chainId: 1, poolAddress: pool });
    if ((await this.p.rpc('eth_chainId', [])) !== '0x1') throw new Error('NFT RPC 网络不匹配');
    const [known, minter, launch, name, symbol] = await Promise.all([
      this.view(NFT.factory, 'isCollection', [pool]),
      this.view(pool, 'minter'),
      this.view(NFT.market, 'launches', [pool]),
      this.view(pool, 'name'),
      this.view(pool, 'symbol'),
    ]);
    if (
      known[0] !== true ||
      address(minter[0]) !== NFT.market ||
      launch[9] !== true ||
      launch[1] !== 0n ||
      launch[2] !== 0n ||
      launch[3] !== 0n
    )
      throw new Error('钱包当前仅支持已验证市场的免费 NFT mint');
    if (
      launch[8] !== true ||
      integer(launch[10]) < 1 ||
      integer(launch[11]) >= integer(launch[10]) ||
      Number(launch[4]) * 1000 > Date.now()
    )
      throw new Error('此 NFT 铸造尚未开始或已关闭');
    if (
      typeof name[0] !== 'string' ||
      !name[0].trim() ||
      name[0].length > 100 ||
      typeof symbol[0] !== 'string' ||
      symbol[0].length > 20
    )
      throw new Error('NFT 合集身份无效');
    const dummy: MintNote = {
      proof: Array(8).fill(`0x${'01'.repeat(32)}`),
      cmx: ZeroHash,
      nf: ZeroHash,
      epk: ZeroHash,
      enc: `0x${'00'.repeat(580)}`,
      out: `0x${'00'.repeat(80)}`,
    };
    if ((await this.view(NFT.market, 'mintNoteHash', [dummy]))[0] !== mintCallHash(dummy))
      throw new Error('NFT mint 证明协议不匹配');
    return { pool, name: name[0], symbol: symbol[0], supply: integer(launch[10]) };
  }
  private job(input: unknown, record: MintRecord) {
    const job = object(input);
    const tokenId = String(job.tokenId);
    if (
      typeof job.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(job.id) ||
      address(job.pool) !== record.pool ||
      hash(job.wallet) !== privacyTag(this.privacy) ||
      job.action !== 'mint' ||
      !/^[1-9][0-9]{0,5}$/.test(tokenId) ||
      BigInt(tokenId) > 100_000n
    )
      throw new Error('NFT 预留不属于当前钱包或合集');
    if (record.jobId && (job.id !== record.jobId || tokenId !== record.tokenId))
      throw new Error('NFT 预留编号已变化，请核对原记录');
    if (job.txHash) {
      const txHash = hash(job.txHash);
      if (record.txHash && txHash !== record.txHash) throw new Error('NFT 服务交易哈希与钱包不符');
      // Service-provided hashes alone never authorize another submission.
      record.txHash = txHash;
      record.state = 'submitted';
      record.stage = 'confirming';
    }
    if (
      !record.txHash &&
      (!['queued', 'executing'].includes(String(job.status)) ||
        job.reservationActive === false ||
        (job.expiresAt !== undefined && integer(job.expiresAt) <= Date.now()))
    ) {
      record.state = 'failed';
      record.stage = 'expired';
      throw new Error('NFT 预留已过期或关闭，原证明仍保存在钱包');
    }
    record.jobId = job.id;
    record.tokenId = tokenId;
    return job;
  }
  private async refresh(record: MintRecord) {
    if (!record.txHash) return;
    record.state = 'submitted';
    record.stage = 'confirming';
    const receiptValue = await this.p.rpc('eth_getTransactionReceipt', [record.txHash]);
    if (!receiptValue) return;
    const receipt = object(receiptValue);
    if (
      hash(receipt.transactionHash) !== record.txHash ||
      address(receipt.to) !== NFT.market ||
      address(receipt.from) !== this.account.toLowerCase() ||
      !['0x0', '0x1'].includes(String(receipt.status))
    )
      throw new Error('NFT 交易回执与已批准意图不符');
    const block = object(await this.p.rpc('eth_getBlockByNumber', [receipt.blockNumber, false]));
    if (block.hash !== receipt.blockHash) return;
    if (receipt.status === '0x0') {
      record.state = 'failed';
      record.stage = 'reverted';
      record.message = 'NFT 铸造交易执行失败；恢复记录已保留';
      return;
    }
    if (!record.mint || !record.tokenId) throw new Error('NFT 原始证明不可用，无法核实持有权');
    if (
      !Array.isArray(receipt.logs) ||
      !receipt.logs.map(object).some((log) => {
        const topics = log.topics;
        return (
          String(log.address).toLowerCase() === record.pool &&
          Array.isArray(topics) &&
          topics[0]?.toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() &&
          topics[1]?.toLowerCase() === record.mint?.cmx
        );
      })
    )
      throw new Error('NFT 铸造回执缺少原始私有 Note 输出');
    const [exists, cmx] = await Promise.all([
      this.view(record.pool, 'exists', [record.tokenId], String(receipt.blockNumber)),
      this.view(record.pool, 'cmxExists', [record.mint.cmx], String(receipt.blockNumber)),
    ]);
    if (exists[0] !== true || cmx[0] !== true) throw new Error('NFT 输出尚未在链上确认');
    record.state = 'confirmed';
    record.stage = 'confirmed';
    record.message = `NFT #${record.tokenId} 已铸造，私有持有记录已保存在钱包`;
  }
  async list(origin: string, refresh = true) {
    await this.p.guard();
    const journal = await this.p.load();
    const records = journal.records.filter(
      (record) => record.origin === origin && record.account === this.account.toLowerCase(),
    );
    if (refresh) {
      for (const record of records.filter((record) => record.txHash && record.state !== 'failed')) {
        try {
          await this.refresh(record);
        } catch {
          if (record.state !== 'confirmed')
            record.message = '暂时无法核对链上状态，请刷新原铸造，勿重复领取';
        }
      }
      await this.save(journal);
    }
    return records.map(publicMint);
  }
  async mint(origin: string, pool: string, seed: string, id?: string) {
    await this.p.guard();
    const journal = await this.p.load();
    let record = id
      ? journal.records.find(
          (r) => r.id === id && r.origin === origin && r.account === this.account.toLowerCase(),
        )
      : journal.records.find(
          (r) =>
            r.pool === pool &&
            r.origin === origin &&
            r.account === this.account.toLowerCase() &&
            !['confirmed', 'failed'].includes(r.state),
        );
    if (id && !record) throw new Error('原 NFT mint 记录不存在或不属于此网站');
    if (record && record.pool !== pool) throw new Error('恢复请求与原 NFT 合集不符');
    try {
      if (record?.txHash) {
        await this.refresh(record);
        await this.save(journal);
        return publicMint(record);
      }
      const review = await this.review(pool);
      if (!record) {
        if (journal.records.length >= 4096) throw new Error('NFT 恢复记录已达上限，请先备份钱包');
        record = {
          id: crypto.randomUUID(),
          origin,
          account: this.account.toLowerCase(),
          pool,
          name: review.name,
          symbol: review.symbol,
          createdAt: Date.now(),
          state: 'reserved',
          stage: 'reserving',
        };
        journal.records.push(record);
        await this.save(journal);
      }
      if (record.name !== review.name || record.symbol !== review.symbol)
        throw new Error('NFT 合集身份已变化，请重新核对');
      if (!record.jobId) {
        const prior = object(await this.p.api(`/pool/${pool}?wallet=${privacyTag(this.privacy)}`));
        if (prior.pool !== pool) throw new Error('NFT 服务状态尚未更新，请稍后恢复原铸造');
        if (prior.job) this.job(prior.job, record);
        else if (record.reservationAttempted) {
          record.state = 'review';
          record.stage = 'reserving';
          record.message = '预留提交结果不确定，请刷新原铸造，勿再次领取';
          await this.save(journal);
          return publicMint(record);
        } else {
          const nonce = crypto.randomUUID(),
            expires = Date.now() + 5 * 60_000;
          record.stage = 'authorizing';
          await this.save(journal);
          const proof = await this.p.ownership(
            ownershipMessage(pool, this.privacy, nonce, expires),
          );
          await this.p.guard();
          if (Date.now() >= expires) throw new Error('NFT mint 授权已过期，请恢复原记录');
          record.reservationAttempted = true;
          record.stage = 'reserving';
          await this.save(journal);
          const reserved = object(
            await this.p.api('/reserve', {
              pool,
              action: 'mint',
              wallet: privacyTag(this.privacy),
              authorization: { rawAddressHex: raw(this.privacy, 43), nonce, expires, proof },
            }),
          );
          if (reserved.ok !== true) {
            record.state = 'failed';
            record.stage = 'rejected';
            throw new Error(
              reserved.reason === 'limit_reached'
                ? '当前隐私地址的 NFT mint 额度已用完'
                : reserved.reason === 'not_eligible'
                  ? '当前隐私地址没有此合集的 mint 额度'
                  : 'NFT 服务拒绝了此次预留',
            );
          }
          this.job(reserved.job, record);
        }
        await this.save(journal);
      }
      if (record.txHash) {
        await this.refresh(record);
        await this.save(journal);
        return publicMint(record);
      }
      this.job(await this.p.api(`/jobs/${encodeURIComponent(record.jobId!)}`), record);
      if (!record.tokenId || BigInt(record.tokenId) > BigInt(review.supply))
        throw new Error('NFT 预留编号超出合集供应量');
      if (record.txHash) {
        await this.refresh(record);
        await this.save(journal);
        return publicMint(record);
      }
      if (!record.mint) {
        if ((await this.view(pool, 'exists', [record.tokenId]))[0] === true)
          throw new Error('预留的 NFT 已铸造，请核对原始交易');
        record.state = 'proving';
        record.stage = 'proving';
        await this.save(journal);
        const result = mintEnvelope(
          await this.p.prove('nft_mint_prove', {
            seed_hex: raw(seed, 32),
            account_id: 0,
            bip44_coin_type: 60,
            chain_id: 1,
            pool_address: pool,
            token_id: BigInt(record.tokenId),
          }),
          this.privacy,
          record.tokenId,
        );
        await this.p.guard();
        Object.assign(record, result, { state: 'ready', stage: 'permit' });
        await this.save(journal);
      }
      if (
        record.note?.recipient_raw_address_hex &&
        raw(record.note.recipient_raw_address_hex, 43) !== raw(this.privacy, 43)
      )
        throw new Error('原 NFT Note 不属于当前隐私地址');
      this.job(await this.p.api(`/jobs/${encodeURIComponent(record.jobId!)}`), record);
      if (record.txHash) {
        await this.refresh(record);
        await this.save(journal);
        return publicMint(record);
      }
      // Complete contract reads before requesting a short-lived permit.
      await this.review(pool);
      const permit = parsePermit(
        await this.p.api(`/jobs/${encodeURIComponent(record.jobId!)}/permit`, {
          tokenId: record.tokenId,
          mintCallHash: mintCallHash(record.mint!),
          payer: this.account.toLowerCase(),
        }),
      );
      const transaction = {
        chainId: 1,
        to: NFT.market,
        value: '0x0',
        data: encodeMint(pool, record.tokenId, record.mint!, permit),
      };
      record.stage = 'approval';
      await this.save(journal);
      const signed = verifySignedTransaction(
        await this.p.sign(transaction),
        transaction,
        this.account,
      );
      await this.p.guard();
      record.txHash = signed.hash;
      record.nonce = signed.nonce;
      record.state = 'submitted';
      record.stage = 'confirming';
      record.message = 'NFT 铸造已提交，等待链上确认';
      // Persist the deterministic transaction hash and private Note before broadcasting.
      await this.save(journal);
      try {
        const result = await this.p.broadcast(signed.raw);
        if (hash(result) !== signed.hash) throw new Error('RPC 交易哈希不匹配');
      } catch {
        record.message = '广播结果暂不确定，原交易哈希已保存；请刷新此 mint，勿再次领取';
      }
      await this.save(journal);
      return publicMint(record);
    } catch (error) {
      if (!record) throw error;
      if (!record.txHash && /NFT mint 许可(?:已过期|有效期不足)/.test(walletErrorMessage(error, 'ETH'))) {
        record.state = record.mint ? 'ready' : 'review';
        record.stage = 'permit-expired';
        record.message = 'NFT mint 许可已过期；原预留、编号与证明已保存。恢复会重新获取许可，再确认 Gas。';
        await this.save(journal);
        return publicMint(record);
      }
      record.message = record.txHash
        ? '链上状态暂不确定，请刷新原 mint'
        : walletErrorMessage(error, 'ETH').replace(/\b[0-9a-f]{64,}\b/gi, '[数据已隐藏]');
      // The durable journal retains the reservation, proof and note after failure.
      await this.save(journal);
      return publicMint(record);
    }
  }
}
