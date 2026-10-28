import { AbiCoder, Interface } from 'ethers';
import { NOTE_CONFIRMED_TOPIC } from '../events';
import { reverseHexByByte } from '../operations';
import type { NftPorts } from './engine';
import { address, hash, integer, object, raw, type Json } from './protocol';

export const nftTreeInterface = new Interface([
  'function confirmedCount() view returns(uint256)',
  'function confirmedRoot() view returns(bytes32)',
  'function cmxFrozenRoot() view returns(bytes32)',
  'function maxActions() view returns(uint256)',
]);
const abi = AbiCoder.defaultAbiCoder();
const blockNumber = (value: unknown) => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error('NFT 区块编号无效');
  return integer(BigInt(value));
};

/** Rebuild only public confirmed commitments; the RPC never receives the owned cmx or Note. */
export async function buildNftMerklePath(
  p: NftPorts,
  input: {
    pool: string;
    cmx: string;
    seed: string;
    firstBlock?: number;
  },
) {
  const pool = address(input.pool),
    cmx = hash(input.cmx);
  await p.guard();
  const head = object(await p.rpc('eth_getBlockByNumber', ['latest', false]));
  const target = blockNumber(head.number) - 1;
  if (target < 1) throw new Error('NFT 确认区块尚不可用');
  const tag = `0x${target.toString(16)}`;
  const checkpoint = object(await p.rpc('eth_getBlockByNumber', [tag, false]));
  const checkpointHash = hash(checkpoint.hash);
  if (blockNumber(checkpoint.number) !== target)
    throw new Error('NFT 确认区块不匹配');
  const view = async (name: string) =>
    nftTreeInterface.decodeFunctionResult(
      name,
      String(
        await p.rpc('eth_call', [
          { to: pool, data: nftTreeInterface.encodeFunctionData(name) },
          tag,
        ]),
      ),
    )[0];
  const [countValue, rootValue, frozenRootValue, maxActionsValue] =
    await Promise.all([
      view('confirmedCount'),
      view('confirmedRoot'),
      view('cmxFrozenRoot'),
      view('maxActions'),
    ]);
  const count = integer(countValue),
    root = hash(rootValue),
    frozenRoot = hash(frozenRootValue),
    maxActions = integer(maxActionsValue);
  if (count < 1 || count > 1_000_000 || maxActions < 1 || maxActions > 32)
    throw new Error('NFT 确认树规模超出钱包支持范围');
  let first = input.firstBlock;
  if (first === undefined) {
    if ((await p.rpc('eth_getCode', [pool, tag])) === '0x')
      throw new Error('NFT 合集尚未部署');
    let low = 0,
      high = target;
    while (low < high) {
      await p.guard();
      const middle = Math.floor((low + high) / 2);
      if (
        (await p.rpc('eth_getCode', [pool, `0x${middle.toString(16)}`])) ===
        '0x'
      )
        low = middle + 1;
      else high = middle;
    }
    first = low;
  }
  if (!Number.isSafeInteger(first) || first < 0 || first > target)
    throw new Error('NFT 历史起点无效');
  const leaves = new Map<number, { cmx: string; root: string }>();
  let from = first,
    span = 1000,
    pages = 0;
  while (from <= target && leaves.size < count) {
    if (++pages > 4000) throw new Error('NFT 历史较长，请稍后继续同步');
    await p.guard();
    const to = Math.min(target, from + span - 1);
    let response: unknown;
    try {
      response = await p.rpc('eth_getLogs', [
        {
          address: pool,
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          topics: [NOTE_CONFIRMED_TOPIC],
        },
      ]);
    } catch (cause) {
      if (
        span > 50 &&
        /range|limit|too (?:many|large)|exceed|archive/i.test(String(cause))
      ) {
        span = Math.max(50, Math.floor(span / 2));
        continue;
      }
      throw cause;
    }
    if (!Array.isArray(response) || response.length > 5000)
      throw new Error('NFT 确认日志无效或过多');
    for (const entry of response) {
      const log = object(entry),
        topics = log.topics;
      const block = blockNumber(log.blockNumber);
      if (
        address(log.address) !== pool ||
        log.removed === true ||
        block < from ||
        block > to ||
        !Array.isArray(topics) ||
        topics.length !== 2 ||
        topics[0] !== NOTE_CONFIRMED_TOPIC ||
        typeof log.data !== 'string' ||
        !/^0x[0-9a-f]{128}$/i.test(log.data)
      )
        throw new Error('NFT 确认日志与请求范围不符');
      hash(log.blockHash);
      hash(log.transactionHash);
      blockNumber(log.logIndex);
      const [confirmedRoot, positionValue] = abi.decode(
        ['bytes32', 'uint256'],
        log.data,
      );
      const position = integer(positionValue);
      if (position >= count || leaves.has(position))
        throw new Error('NFT 确认日志位置重复或越界');
      leaves.set(position, { cmx: hash(topics[1]), root: hash(confirmedRoot) });
    }
    from = to + 1;
  }
  if (leaves.size !== count || leaves.get(count - 1)?.root !== root)
    throw new Error('NFT 确认记录不完整，请稍后重试');
  const ordered = Array.from({ length: count }, (_, position) => {
    const leaf = leaves.get(position);
    if (!leaf) throw new Error('NFT 确认记录缺少位置');
    return leaf.cmx;
  });
  if (!ordered.includes(cmx))
    throw new Error('此 NFT 尚未进入确认树，请同步后重试');
  const generation = crypto.randomUUID();
  const tree = (method: string, body: Json) =>
    p.prove(method, { ...body, seed_hex: input.seed });
  await tree('tree_reset', { pool, generation });
  try {
    for (let offset = 0; offset < ordered.length; offset += 256) {
      await p.guard();
      const batch = ordered.slice(offset, offset + 256);
      const result = object(
        await tree('tree_append', {
          treeKey: pool,
          generation,
          expectedStartPosition: offset,
          leaves: batch.map((value) => ({
            cmx_be_hex: value,
            owned: value === cmx,
          })),
        }),
      );
      if (integer(result.size) !== offset + batch.length)
        throw new Error('NFT 本地确认树大小不一致');
    }
    const paths = object(
      await tree('tree_paths', { pool, generation, cmxs: [cmx] }),
    );
    const expectedAnchor = reverseHexByByte(root);
    if (
      raw(paths.rootLeHex, 32) !== expectedAnchor ||
      !Array.isArray(paths.overrides) ||
      paths.overrides.length !== 1
    )
      throw new Error('NFT 本地确认树与链上根不一致');
    const path = object(paths.overrides[0]);
    if (
      integer(path.position) !== ordered.indexOf(cmx) ||
      !Array.isArray(path.siblings) ||
      path.siblings.length !== 32
    )
      throw new Error('NFT 本地证明路径不完整');
    path.siblings.forEach((value) => raw(value, 32));
    const calculated = object(
      await tree('merkle_root_from_path', {
        cmx_be_hex: cmx,
        position: path.position,
        siblings: path.siblings,
      }),
    );
    if (raw(calculated.root_le_hex, 32) !== expectedAnchor)
      throw new Error('NFT 证明路径本地校验失败');
    const canonical = object(await p.rpc('eth_getBlockByNumber', [tag, false]));
    if (
      blockNumber(canonical.number) !== target ||
      hash(canonical.hash) !== checkpointHash
    )
      throw new Error('NFT 确认区块已变化，请重新同步');
    await p.guard();
    return {
      position: integer(path.position),
      siblings: path.siblings as string[],
      anchor: expectedAnchor,
      frozenRoot,
      maxActions,
    };
  } finally {
    // No owned-witness cache is shared with another transfer or privacy session.
    await tree('tree_reset', { pool, generation }).catch(() => {});
  }
}
