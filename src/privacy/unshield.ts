import { Interface } from 'ethers';
import { NETWORKS } from '../shared/networks';
import type { ChainId } from '../shared/types';

export function unshieldAsset(chainId: ChainId, poolAddress: string) {
  const pool = NETWORKS[chainId].plabs?.pools.find(
    (p) => p.address.toLowerCase() === poolAddress.toLowerCase(),
  );
  if (!pool?.underlying || !pool.scale || !/^[1-9][0-9]*$/.test(pool.scale))
    return null;
  return {
    underlying: pool.underlying,
    scale: BigInt(pool.scale),
    symbol: pool.nativeGateway
      ? 'WETH'
      : pool.symbol.replace(/^s(?=[A-Z])/, ''),
  };
}
const transfers = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
/** Verify public ERC-20 outputs in underlying units, including scaled sETH → WETH. */
export function verifyUnshieldReceipt(
  operation: {
    chainId: ChainId;
    poolAddress?: string;
    underlying?: string;
    recipient?: string;
    receiveRaw?: string;
    feeRaw?: string;
    feeCollector?: string;
    transaction: { to: string };
  },
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
) {
  const poolAddress = operation.poolAddress ?? operation.transaction.to;
  const asset = unshieldAsset(operation.chainId, poolAddress);
  if (
    !asset ||
    !operation.underlying ||
    asset.underlying.toLowerCase() !== operation.underlying.toLowerCase() ||
    operation.transaction.to.toLowerCase() !== poolAddress.toLowerCase() ||
    !operation.recipient ||
    operation.receiveRaw === undefined ||
    operation.feeRaw === undefined
  )
    throw Error('Unshield 缺少到账回执约束');
  const expected = new Map<string, bigint>();
  const add = (address: string, amount: bigint) =>
    expected.set(
      address.toLowerCase(),
      (expected.get(address.toLowerCase()) ?? 0n) + amount,
    );
  add(operation.recipient, BigInt(operation.receiveRaw) * asset.scale);
  const fee = BigInt(operation.feeRaw) * asset.scale;
  if (fee > 0n && !operation.feeCollector)
    throw Error('Unshield 手续费收款方缺失');
  if (operation.feeCollector) add(operation.feeCollector, fee);
  const actual = new Map<string, bigint>();
  for (const log of logs) {
    if (log.address.toLowerCase() !== asset.underlying.toLowerCase()) continue;
    let decoded;
    try {
      decoded = transfers.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (
      !decoded ||
      String(decoded.args.from).toLowerCase() !== poolAddress.toLowerCase()
    )
      continue;
    const target = String(decoded.args.to).toLowerCase(),
      value = BigInt(decoded.args.value);
    if (!expected.has(target)) throw Error('Unshield 回执包含未知收款方');
    actual.set(target, (actual.get(target) ?? 0n) + value);
  }
  for (const [target, amount] of expected)
    if ((actual.get(target) ?? 0n) !== amount)
      throw Error('Unshield 实际到账或协议费与准备结果不一致');
}
