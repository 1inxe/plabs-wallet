import { decodePrivacyLog, NOTE_ADDED_TOPIC, LEGACY_NOTE_ADDED_TOPIC } from '../events';
import { reverseHexByByte } from '../operations';
import { type NftPorts } from './engine';
import { type MintJournal, type NftHolding } from './journal';
import { NFT, address, hash, integer, nftInterface, object, raw } from './protocol';

/** NFT values are token IDs. They must never be summed into ERC20 balances. */
export type NftAssetSummary = {
  id: string;
  chainId: 1;
  type: 'perc721';
  poolAddress: string;
  name: string;
  symbol: string;
  tokenId: string;
  txHash: string;
  blockNumber: number;
  state: 'confirmed' | 'pending';
  source: 'chain' | 'mint';
  transfer?: { id: string; recipient: string; state: string; txHash?: string; message?: string };
};
export function publicNftAssets(journal: MintJournal, includeTransfers = false) {
  const scanned = journal.holdings ?? [];
  const items: NftAssetSummary[] = scanned
    .filter((note) => !note.spent)
    .map((note) => ({
      id: `${note.pool}:${note.cmx}`,
      chainId: 1 as const,
      type: 'perc721' as const,
      poolAddress: note.pool,
      name: note.name,
      symbol: note.symbol,
      tokenId: note.tokenId,
      txHash: note.txHash,
      blockNumber: note.blockNumber,
      state: 'confirmed' as const,
      source: 'chain' as const,
    }));
  for (const record of journal.records.filter(
    (record) => record.note && record.mint && record.txHash && record.state !== 'failed',
  )) {
    const cmx = record.mint!.cmx;
    if (scanned.some((note) => note.pool === record.pool && note.cmx === cmx)) continue;
    items.push({
      id: `${record.pool}:${cmx}`,
      chainId: 1,
      type: 'perc721',
      poolAddress: record.pool,
      name: record.name,
      symbol: record.symbol,
      tokenId: record.tokenId!,
      txHash: record.txHash!,
      blockNumber: 0,
      state: record.state === 'confirmed' ? 'confirmed' : 'pending',
      source: 'mint',
    });
  }
  if (includeTransfers) for (const item of items) {
    const transfer = [...(journal.transfers ?? [])].reverse().find(record => record.assetId === item.id && record.state !== 'failed');
    if (transfer && transfer.state !== 'confirmed') item.transfer = {
      id: transfer.id, recipient: transfer.recipient, state: transfer.state,
      txHash: transfer.txHash, message: transfer.message,
    };
  }
  return {
    items,
    syncedAt: journal.syncedAt ?? null,
    syncComplete: journal.syncComplete === true,
    error: journal.syncError,
    progress: journal.syncProgress,
    chainId: 1 as const,
  };
}
export class NftAssetSync {
  constructor(private p: NftPorts) {}
  private async save(journal: MintJournal) {
    await this.p.guard();
    await this.p.save(journal);
    await this.p.guard();
  }
  private async view(to: string, method: string, args: unknown[], block: number) {
    const encoded = nftInterface.encodeFunctionData(method, args);
    const data = await this.p.rpc('eth_call', [{ to, data: encoded }, `0x${block.toString(16)}`]);
    return nftInterface.decodeFunctionResult(method, String(data));
  }
  async snapshot(includeTransfers = false) {
    await this.p.guard();
    return publicNftAssets(await this.p.load(), includeTransfers);
  }
  private async firstBlock(pool: string, target: number) {
    const code = (block: number) => this.p.rpc('eth_getCode', [pool, `0x${block.toString(16)}`]);
    if ((await code(target)) === '0x') throw new Error('NFT 合集尚未在当前确认区块部署');
    let low = 0,
      high = target;
    while (low < high) {
      await this.p.guard();
      const middle = Math.floor((low + high) / 2);
      if ((await code(middle)) === '0x') low = middle + 1;
      else high = middle;
    }
    return low;
  }
  async sync(includeTransfers = false) {
    await this.p.guard();
    const journal = await this.p.load();
    journal.holdings ??= [];
    journal.pools ??= {};
    journal.syncError = undefined;
    journal.syncComplete = false;
    journal.syncProgress = '正在读取 Ethereum NFT 目录…';
    await this.save(journal);
    try {
      if ((await this.p.rpc('eth_chainId', [])) !== '0x1') throw new Error('NFT 同步网络不匹配');
      const head = object(await this.p.rpc('eth_getBlockByNumber', ['latest', false]));
      const target = integer(Number(BigInt(String(head.number)))) - 1;
      if (target < 1) throw new Error('NFT 同步区块不可用');
      const count = integer((await this.view(NFT.market, 'poolCount', [], target))[0]);
      if (count > 1000) throw new Error('NFT 目录规模超出单次同步范围');
      const seenPools = new Set<string>();
      for (let index = 0; index < count; index++) {
        await this.p.guard();
        const pool = address((await this.view(NFT.market, 'pools', [index], target))[0]);
        seenPools.add(pool);
        if (
          (await this.view(NFT.factory, 'isCollection', [pool], target))[0] !== true ||
          address((await this.view(pool, 'minter', [], target))[0]) !== NFT.market
        )
          throw new Error('NFT 合集不属于已验证的发布合约');
        let cursor = journal.pools[pool];
        if (!cursor) {
          const [name, symbol] = await Promise.all([
            this.view(pool, 'name', [], target),
            this.view(pool, 'symbol', [], target),
          ]);
          if (
            typeof name[0] !== 'string' ||
            name[0].length > 100 ||
            typeof symbol[0] !== 'string' ||
            symbol[0].length > 20
          )
            throw new Error('NFT 合集名称无效');
          const firstBlock = await this.firstBlock(pool, target);
          cursor = journal.pools[pool] = {
            firstBlock,
            cursor: firstBlock - 1,
            name: name[0],
            symbol: symbol[0],
          };
        }
        if (cursor.blockHash) {
          const canonical = object(
            await this.p.rpc('eth_getBlockByNumber', [`0x${cursor.cursor.toString(16)}`, false]),
          );
          if (canonical.hash !== cursor.blockHash) {
            journal.holdings = journal.holdings.filter((note) => note.pool !== pool);
            cursor.cursor = cursor.firstBlock - 1;
            cursor.blockHash = undefined;
          }
        }
        let pages = 0;
        while (cursor.cursor < target) {
          if (++pages > 1000) throw new Error('NFT 历史尚未同步完，请继续同步');
          journal.syncProgress = `正在同步 ${cursor.name}（${index + 1}/${count}）…`;
          const from = cursor.cursor + 1,
            to = Math.min(target, from + 999);
          const logs = await this.p.rpc('eth_getLogs', [
            {
              address: pool,
              fromBlock: `0x${from.toString(16)}`,
              toBlock: `0x${to.toString(16)}`,
              topics: [[NOTE_ADDED_TOPIC, LEGACY_NOTE_ADDED_TOPIC]],
            },
          ]);
          if (!Array.isArray(logs) || logs.length > 5000) throw new Error('NFT 链上日志无效或过多');
          const candidates = logs.map(object).map((log) => {
            const block = integer(Number(BigInt(String(log.blockNumber))));
            if (address(log.address) !== pool || block < from || block > to || log.removed === true)
              throw new Error('NFT 日志范围或链上状态不符');
            const decoded = decodePrivacyLog(log);
            if (
              !decoded ||
              ![NOTE_ADDED_TOPIC, LEGACY_NOTE_ADDED_TOPIC].includes(
                String((log.topics as string[])[0]),
              )
            )
              throw new Error('NFT 日志类型无效');
            return decoded;
          });
          for (let offset = 0; offset < candidates.length; offset += 128) {
            const batch = candidates.slice(offset, offset + 128);
            const owned = await this.p.scan(batch);
            for (const result of owned) {
              const cmx = hash(result.note.cmx_hex);
              const source = batch.find((item) => item.cmx === cmx);
              if (!source || !/^[1-9][0-9]{0,5}$/.test(String(result.note.value_sats)))
                throw new Error('NFT 私有 Note 与链上输出不符');
              const holding: NftHolding = {
                pool,
                name: cursor.name,
                symbol: cursor.symbol,
                tokenId: String(result.note.value_sats),
                cmx,
                nullifier: hash(result.nullifier),
                note: result.note,
                txHash: hash(source.tx_hash),
                blockNumber: source.block_number,
                spent: false,
              };
              const [exists, valid, spent] = await Promise.all([
                this.view(pool, 'exists', [holding.tokenId], target),
                this.view(pool, 'cmxExists', [cmx], target),
                this.view(
                  pool,
                  'isSpent',
                  [`0x${reverseHexByByte(raw(holding.nullifier, 32))}`],
                  target,
                ),
              ]);
              if (
                valid[0] !== true ||
                typeof spent[0] !== 'boolean' ||
                (exists[0] !== true && spent[0] !== true)
              )
                throw new Error('NFT Note 尚未由合约确认');
              holding.spent = spent[0];
              const previous = journal.holdings.findIndex(
                (note) => note.pool === pool && note.cmx === cmx,
              );
              if (previous >= 0) journal.holdings[previous] = holding;
              else journal.holdings.push(holding);
              if (journal.holdings.length > 4096) throw new Error('NFT 私有记录超出同步上限');
            }
          }
          const block = object(
            await this.p.rpc('eth_getBlockByNumber', [`0x${to.toString(16)}`, false]),
          );
          cursor.cursor = to;
          cursor.blockHash = hash(block.hash);
          await this.save(journal);
        }
        // The nullifier is derived locally; no note opening or viewing key leaves the extension.
        for (const note of journal.holdings.filter((note) => note.pool === pool)) {
          const spent = (
            await this.view(
              pool,
              'isSpent',
              [`0x${reverseHexByByte(raw(note.nullifier, 32))}`],
              target,
            )
          )[0];
          if (typeof spent !== 'boolean') throw new Error('NFT 花费状态无法核对');
          note.spent = spent;
        }
        for (const record of journal.records.filter(
          (record) =>
            record.pool === pool && record.mint && record.txHash && record.state === 'confirmed',
        )) {
          if (journal.holdings.some((note) => note.pool === pool && note.cmx === record.mint!.cmx))
            continue;
          const exists = (await this.view(pool, 'cmxExists', [record.mint!.cmx], target))[0];
          if (exists !== true) {
            record.state = 'submitted';
            record.stage = 'confirming';
            record.message = 'NFT 输出尚未进入当前确认区块，请继续核对原交易';
          } else throw new Error('已确认 NFT 的私有 Note 尚未完成扫描，请继续同步');
        }
        await this.save(journal);
      }
      journal.holdings = journal.holdings.filter((note) => seenPools.has(note.pool));
      for (const pool of Object.keys(journal.pools))
        if (!seenPools.has(pool)) delete journal.pools[pool];
      for (const record of journal.records.filter(
        (record) => record.state === 'confirmed' && !seenPools.has(record.pool),
      )) {
        record.state = 'submitted';
        record.stage = 'confirming';
        record.message = '合集不在当前链上目录中，等待核对原交易';
      }
      journal.syncedAt = Date.now();
      journal.syncComplete = true;
      journal.syncProgress = undefined;
    } catch (error) {
      journal.syncError = error instanceof Error ? error.message : 'NFT 同步失败';
      journal.syncProgress = undefined;
    }
    await this.save(journal);
    return publicNftAssets(journal, includeTransfers);
  }
}
