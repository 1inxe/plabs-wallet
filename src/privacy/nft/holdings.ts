import { readRpcHistoryPage } from '../rpc-history-page';
import {
  decodePrivacyLog,
  NOTE_ADDED_TOPIC,
  LEGACY_NOTE_ADDED_TOPIC,
} from '../events';
import { reverseHexByByte } from '../operations';
import { type NftPorts } from './engine';
import { type MintJournal, type NftHolding } from './journal';
import {
  NFT,
  address,
  hash,
  integer,
  nftInterface,
  object,
  raw,
} from './protocol';

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
  transfer?: {
    id: string;
    recipient: string;
    state: string;
    txHash?: string;
    message?: string;
  };
};
export function publicNftAssets(
  journal: MintJournal,
  includeTransfers = false,
) {
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
    (record) =>
      record.note && record.mint && record.txHash && record.state !== 'failed',
  )) {
    const cmx = record.mint!.cmx;
    if (scanned.some((note) => note.pool === record.pool && note.cmx === cmx))
      continue;
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
  if (includeTransfers)
    for (const item of items) {
      const transfer = [...(journal.transfers ?? [])]
        .reverse()
        .find(
          (record) => record.assetId === item.id && record.state !== 'failed',
        );
      if (transfer && transfer.state !== 'confirmed')
        item.transfer = {
          id: transfer.id,
          recipient: transfer.recipient,
          state: transfer.state,
          txHash: transfer.txHash,
          message: transfer.message,
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
const RECENT_BLOCKS = 128;
const HISTORY_PAGES_PER_SLICE = 8;
const HISTORY_SLICE_MS = 5000;
type Pool = {
  pool: string;
  cursor: import('./journal').NftCursor;
  index: number;
  reorg: boolean;
};

export class NftAssetSync {
  constructor(private p: NftPorts) {}
  private async save(journal: MintJournal) {
    await this.p.guard();
    await this.p.save(journal);
    await this.p.guard();
  }
  private async block(number: number) {
    const block = object(
      await this.p.rpc('eth_getBlockByNumber', [
        `0x${number.toString(16)}`,
        false,
      ]),
    );
    if (Number(BigInt(String(block.number))) !== number)
      throw Error('NFT 检查点区块编号不符');
    return hash(block.hash);
  }
  private async view(
    to: string,
    method: string,
    args: unknown[],
    block: number,
  ) {
    const data = await this.p.rpc('eth_call', [
      { to, data: nftInterface.encodeFunctionData(method, args) },
      `0x${block.toString(16)}`,
    ]);
    return nftInterface.decodeFunctionResult(method, String(data));
  }
  async progress() {
    await this.p.guard();
    const value = (await this.p.load()).syncStatus ?? null;
    await this.p.guard();
    return value;
  }
  async snapshot(includeTransfers = false) {
    await this.p.guard();
    const value = publicNftAssets(await this.p.load(), includeTransfers);
    await this.p.guard();
    return value;
  }
  private async firstBlock(pool: string, target: number) {
    const code = (block: number) =>
      this.p.rpc('eth_getCode', [pool, `0x${block.toString(16)}`]);
    if ((await code(target)) === '0x')
      throw Error('NFT 合集尚未在当前确认区块部署');
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
  private async page(
    journal: MintJournal,
    entry: Pool,
    after: number,
    target: number,
    accelerated: boolean,
    spans: Map<string, number>,
    verifyAt = target,
  ) {
    let page:
      | {
          notes: import('./protocol').Json[];
          toBlock: number;
          checkpoint: string;
        }
      | undefined;
    if (accelerated && this.p.history) {
      try {
        page = await this.p.history({
          pool: entry.pool,
          firstBlock: entry.cursor.firstBlock,
          afterBlock: after,
          targetBlock: target,
        });
      } catch {
        await this.p.guard(); /* A failed accelerator never supplies a trusted cursor. */
      }
    }
    if (!page) {
      const result = await readRpcHistoryPage({
        afterBlock: after,
        targetBlock: target,
        maxSpan: 1000,
        knownSpan: spans.get(entry.pool) ?? 50,
        read: async (from, to) => {
          const checkpoint = await this.block(to);
          const logs = await this.p.rpc('eth_getLogs', [
            {
              address: entry.pool,
              fromBlock: `0x${from.toString(16)}`,
              toBlock: `0x${to.toString(16)}`,
              topics: [[NOTE_ADDED_TOPIC, LEGACY_NOTE_ADDED_TOPIC]],
            },
          ]);
          if (!Array.isArray(logs) || logs.length > 5000)
            throw Error('NFT 链上日志无效或过多');
          const notes = logs.map(object).map((log) => {
            const block = integer(Number(BigInt(String(log.blockNumber))));
            if (
              address(log.address) !== entry.pool ||
              block < from ||
              block > to ||
              log.removed === true
            )
              throw Error('NFT 日志范围或链上状态不符');
            const decoded = decodePrivacyLog(log);
            if (
              !decoded ||
              ![NOTE_ADDED_TOPIC, LEGACY_NOTE_ADDED_TOPIC].includes(
                String((log.topics as string[])[0]),
              )
            )
              throw Error('NFT 日志类型无效');
            return decoded;
          });
          return { notes, checkpoint };
        },
      });
      spans.set(entry.pool, result.span);
      page = { ...result.value, toBlock: result.toBlock };
    }
    if (
      !Number.isSafeInteger(page.toBlock) ||
      page.toBlock <= after ||
      page.toBlock > target ||
      !Array.isArray(page.notes) ||
      page.notes.length > 50000
    )
      throw Error('NFT 历史页未提供连续区块覆盖');
    const checkpoint = hash(page.checkpoint);
    const candidates = page.notes
      .map(object)
      .filter((note) => note.enc_ciphertext && note.enc_ciphertext !== '0x')
      .map((note) => {
        const block = integer(note.block_number);
        if (block <= after || block > page!.toBlock)
          throw Error('NFT 日志范围或链上状态不符');
        return {
          ...note,
          cmx: hash(note.cmx),
          tx_hash: hash(note.tx_hash),
          block_number: block,
        };
      });
    const discovered: NftHolding[] = [];
    for (let offset = 0; offset < candidates.length; offset += 128) {
      const batch = candidates.slice(offset, offset + 128),
        owned = await this.p.scan(batch);
      for (const result of owned) {
        const cmx = hash(result.note.cmx_hex),
          source = batch.find((note) => note.cmx === cmx);
        if (
          !source ||
          !/^[1-9][0-9]{0,5}$/.test(String(result.note.value_sats))
        )
          throw Error('NFT 私有 Note 与链上输出不符');
        const holding: NftHolding = {
          pool: entry.pool,
          name: entry.cursor.name,
          symbol: entry.cursor.symbol,
          tokenId: String(result.note.value_sats),
          cmx,
          nullifier: hash(result.nullifier),
          note: result.note,
          txHash: source.tx_hash,
          blockNumber: source.block_number,
          spent: false,
        };
        const [exists, valid, spent] = await Promise.all([
          this.view(entry.pool, 'exists', [holding.tokenId], verifyAt),
          this.view(entry.pool, 'cmxExists', [cmx], verifyAt),
          this.view(
            entry.pool,
            'isSpent',
            [`0x${reverseHexByByte(raw(holding.nullifier, 32))}`],
            verifyAt,
          ),
        ]);
        if (
          valid[0] !== true ||
          typeof spent[0] !== 'boolean' ||
          (exists[0] !== true && spent[0] !== true)
        )
          throw Error('NFT Note 尚未由合约确认');
        holding.spent = spent[0];
        discovered.push(holding);
      }
    }
    if ((await this.block(page.toBlock)) !== checkpoint)
      throw Error('NFT 历史区块已变化，请继续同步');
    await this.p.guard();
    const holdings = new Map(
      (journal.holdings ?? []).map((note) => [
        note.pool + ':' + note.cmx,
        note,
      ]),
    );
    for (const note of discovered)
      holdings.set(note.pool + ':' + note.cmx, note);
    if (holdings.size > 4096) throw Error('NFT 私有记录超出同步上限');
    journal.holdings = [...holdings.values()];
    return { to: page.toBlock, checkpoint, found: discovered.length };
  }
  async sync(includeTransfers = false, rescan = false, recentOnly = false) {
    await this.p.guard();
    const journal = await this.p.load();
    journal.holdings ??= [];
    journal.pools ??= {};
    const previousProgress =
      !rescan && journal.syncStatus?.phase !== 'complete'
        ? (journal.syncStatus?.progress ?? 0)
        : 0;
    journal.syncError = undefined;
    journal.syncComplete = false;
    journal.syncProgress = '正在检查近期 NFT…';
    journal.syncStatus = {
      phase: 'catalog',
      progress: previousProgress,
      collectionIndex: 0,
      totalCollections: 0,
      scannedBlocks: 0,
      totalBlocks: 0,
      updatedAt: Date.now(),
    };
    let catchingUp = false;
    await this.save(journal);
    try {
      if ((await this.p.rpc('eth_chainId', [])) !== '0x1')
        throw Error('NFT 同步网络不匹配');
      const head = object(
        await this.p.rpc('eth_getBlockByNumber', ['latest', false]),
      );
      const target = integer(Number(BigInt(String(head.number)))) - 1;
      if (target < 1) throw Error('NFT 同步区块不可用');
      const count = integer(
        (await this.view(NFT.market, 'poolCount', [], target))[0],
      );
      if (count > 1000) throw Error('NFT 目录规模超出单次同步范围');
      const pools: Pool[] = [],
        seen = new Set<string>(),
        spans = new Map<string, number>();
      const report = (
        entry: Pool,
        phase: 'discover' | 'scan' | 'verify',
        block: number,
        recent = false,
      ) => {
        const first = recent
          ? Math.max(1, target - RECENT_BLOCKS + 1)
          : (entry.cursor.scanStartBlock ?? entry.cursor.firstBlock);
        const total = Math.max(0, target - first + 1),
          scanned = Math.max(0, Math.min(total, block - first + 1));
        journal.syncStatus = {
          phase,
          progress:
            recent || phase === 'discover'
              ? Math.min(99, previousProgress)
              : Math.min(
                  99,
                  Math.floor(
                    (100 *
                      pools.reduce((sum, item) => {
                        if (item.cursor.deploymentKnown === false) return sum;
                        const first =
                          item.cursor.scanStartBlock ?? item.cursor.firstBlock;
                        return (
                          sum +
                          Math.max(
                            0,
                            Math.min(
                              1,
                              (item.cursor.cursor - first + 1) /
                                Math.max(1, target - first + 1),
                            ),
                          )
                        );
                      }, 0)) /
                      Math.max(1, count),
                  ),
                ),
          collectionIndex: entry.index + 1,
          totalCollections: count,
          name: entry.cursor.name,
          scannedBlocks: scanned,
          totalBlocks: total,
          updatedAt: Date.now(),
        };
      };
      // Discover every public collection before scanning any old history.
      for (let index = 0; index < count; index++) {
        await this.p.guard();
        const pool = address(
          (await this.view(NFT.market, 'pools', [index], target))[0],
        );
        seen.add(pool);
        const [known, minter] = await Promise.all([
          this.view(NFT.factory, 'isCollection', [pool], target),
          this.view(pool, 'minter', [], target),
        ]);
        if (known[0] !== true || address(minter[0]) !== NFT.market)
          throw Error('NFT 合集不属于已验证的发布合约');
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
            throw Error('NFT 合集名称无效');
          // Deployment lookup is deferred until after recent incoming NFTs are published.
          cursor = journal.pools[pool] = {
            firstBlock: 0,
            deploymentKnown: false,
            cursor: -1,
            name: name[0],
            symbol: symbol[0],
          };
        }
        let reorg = false;
        if (
          cursor.cursor > target ||
          (cursor.blockHash &&
            (await this.block(cursor.cursor)) !== cursor.blockHash)
        ) {
          journal.holdings = journal.holdings.filter(
            (note) => note.pool !== pool,
          );
          cursor.cursor = cursor.firstBlock - 1;
          cursor.blockHash = undefined;
          cursor.recent = undefined;
          reorg = true;
        }
        if (
          cursor.recent &&
          (cursor.recent.to > target ||
            (await this.block(cursor.recent.to)) !== cursor.recent.blockHash)
        ) {
          journal.holdings = journal.holdings.filter(
            (note) =>
              note.pool !== pool || note.blockNumber < cursor.recent!.from,
          );
          cursor.recent = undefined;
          reorg = true;
        }
        if (rescan) {
          cursor.cursor = cursor.firstBlock - 1;
          cursor.blockHash = undefined;
          cursor.scanStartBlock = cursor.firstBlock;
          cursor.recent = undefined;
        }
        const entry = { pool, cursor, index, reorg };
        pools.push(entry);
        report(entry, 'discover', cursor.cursor);
      }
      await this.save(journal);
      // Check the newest public events first. This cursor never skips a historical gap.
      for (const entry of pools) {
        const { cursor } = entry;
        const from = Math.max(
          1,
          target - RECENT_BLOCKS + 1,
          cursor.deploymentKnown === false ? 1 : cursor.firstBlock,
        );
        const previous = cursor.recent;
        const contiguous =
          previous && previous.to >= from - 1 && previous.to <= target;
        let after = contiguous
          ? previous.to
          : Math.max(from - 1, cursor.cursor);
        const recentFrom = contiguous ? previous.from : after + 1;
        while (after < target) {
          const page = await this.page(
            journal,
            entry,
            after,
            target,
            false,
            spans,
          );
          after = page.to;
          cursor.recent = {
            from: recentFrom,
            to: after,
            blockHash: page.checkpoint,
          };
          report(entry, 'scan', after, true);
          await this.save(journal); // Incoming holdings become visible before historical catch-up.
        }
      }
      let pages = 0;
      const started = performance.now();
      // Retired test collections remain recoverable, but cannot delay production history.
      const catchupOrder = [...pools].sort(
        (a, b) =>
          Number((NFT.retired as readonly string[]).includes(a.pool)) -
          Number((NFT.retired as readonly string[]).includes(b.pool)),
      );
      for (const entry of catchupOrder) {
        const { cursor } = entry;
        if (!recentOnly && cursor.deploymentKnown === false) {
          cursor.firstBlock = await this.firstBlock(entry.pool, target);
          cursor.deploymentKnown = true;
          let start = cursor.firstBlock;
          if (
            !rescan &&
            this.p.birthday &&
            this.p.birthday.number <= target &&
            (await this.block(this.p.birthday.number)) === this.p.birthday.hash
          )
            start = Math.max(start, this.p.birthday.number);
          cursor.scanStartBlock = start;
          cursor.cursor = start - 1;
        }
        const recent = cursor.recent;
        if (recent && cursor.cursor >= recent.from - 1) {
          cursor.cursor = recent.to;
          cursor.blockHash = recent.blockHash;
        }
        const historyTarget = recent
          ? Math.min(target, recent.from - 1)
          : target;
        while (!recentOnly && cursor.cursor < historyTarget) {
          if (
            pages >= HISTORY_PAGES_PER_SLICE ||
            performance.now() - started >= HISTORY_SLICE_MS
          ) {
            catchingUp = true;
            break;
          }
          report(entry, 'scan', cursor.cursor);
          const page = await this.page(
            journal,
            entry,
            cursor.cursor,
            historyTarget,
            true,
            spans,
            target,
          );
          cursor.cursor = page.to;
          cursor.blockHash = page.checkpoint;
          pages++;
          if (recent && cursor.cursor >= recent.from - 1) {
            cursor.cursor = recent.to;
            cursor.blockHash = recent.blockHash;
          }
          report(entry, 'scan', cursor.cursor);
          if (page.found || pages % 4 === 0) await this.save(journal);
        }
        if (cursor.cursor < target) catchingUp = true;
        // Recheck current unspent holdings, rather than every already-spent NFT forever.
        const owned = journal.holdings.filter(
          (note) =>
            note.pool === entry.pool && (!note.spent || rescan || entry.reorg),
        );
        report(entry, 'verify', cursor.cursor);
        journal.syncStatus!.verifiedNotes = 0;
        journal.syncStatus!.totalNotes = owned.length;
        for (let offset = 0; offset < owned.length; offset += 4) {
          await Promise.all(
            owned.slice(offset, offset + 4).map(async (note) => {
              const [exists, spent] = await Promise.all([
                this.view(entry.pool, 'cmxExists', [note.cmx], target),
                this.view(
                  entry.pool,
                  'isSpent',
                  [`0x${reverseHexByByte(raw(note.nullifier, 32))}`],
                  target,
                ),
              ]);
              if (typeof spent[0] !== 'boolean')
                throw Error('NFT 花费状态无法核对');
              if (exists[0] !== true) {
                if (!rescan && !entry.reorg)
                  throw Error('NFT Note 尚未由合约确认');
                note.spent = true;
              } else note.spent = spent[0];
              journal.syncStatus!.verifiedNotes!++;
            }),
          );
          journal.syncStatus!.updatedAt = Date.now();
        }
        // A transfer discovered during a historical slice cannot be overwritten by another journal job.
        await this.save(journal);
      }
      journal.holdings = journal.holdings.filter((note) => seen.has(note.pool));
      for (const pool of Object.keys(journal.pools))
        if (!seen.has(pool)) delete journal.pools[pool];
      for (const record of journal.records.filter(
        (record) =>
          record.state === 'confirmed' &&
          (!seen.has(record.pool) ||
            !journal.holdings!.some(
              (note) =>
                note.pool === record.pool && note.cmx === record.mint?.cmx,
            )),
      )) {
        if (
          record.mint &&
          seen.has(record.pool) &&
          (
            await this.view(record.pool, 'cmxExists', [record.mint.cmx], target)
          )[0] === true
        )
          continue;
        record.state = 'submitted';
        record.stage = 'confirming';
        record.message = 'NFT 输出尚未进入当前确认区块，请继续核对原交易';
      }
      journal.syncComplete = pools.every(
        (entry) =>
          entry.cursor.deploymentKnown !== false &&
          entry.cursor.cursor >= target,
      );
      if (journal.syncComplete) {
        journal.syncedAt = Date.now();
        journal.syncStatus = {
          phase: 'complete',
          progress: 100,
          collectionIndex: count,
          totalCollections: count,
          scannedBlocks: 0,
          totalBlocks: 0,
          updatedAt: Date.now(),
        };
      }
      journal.syncProgress = undefined;
    } catch (error) {
      catchingUp = false;
      journal.syncStatus = {
        ...journal.syncStatus!,
        phase: 'error',
        updatedAt: Date.now(),
      };
      journal.syncError =
        error instanceof Error ? error.message : 'NFT 同步失败';
      journal.syncProgress = undefined;
    }
    await this.save(journal);
    return {
      ...publicNftAssets(journal, includeTransfers),
      catchingUp: catchingUp && !journal.syncError,
    };
  }
}
