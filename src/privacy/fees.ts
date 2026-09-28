import { Interface, JsonRpcProvider, ZeroAddress } from 'ethers';
import { NETWORKS } from '../shared/networks';
import type { ChainId, PrivacyFeeQuote, PrivacyPaymentMode } from '../shared/types';

export const feeGatewayInterface = new Interface([
  'function feeOptions(address,address[]) view returns(uint256[])',
  'function sameAssetTransferContext(address) view returns(bytes32)',
  'function transferContext(address,address,(bytes actions,uint256[8] bindingProof)) view returns(bytes32)',
]);
const poolFees = new Interface([
  'function shieldFeeUnits() view returns(uint256)',
  'function unshieldFeeUnits() view returns(uint256)',
  'function feeCollector() view returns(address)',
]);
export async function readPrivacyFees(provider: JsonRpcProvider, chainId: ChainId, poolAddress: string, kind: 'send' | 'shield' | 'unshield', paymentMode: PrivacyPaymentMode, preferredFeePool?: string): Promise<PrivacyFeeQuote> {
  const network = NETWORKS[chainId];
  const plabs = network.plabs;
  const pool = plabs?.pools.find(item => item.address.toLowerCase() === poolAddress.toLowerCase());
  if (!plabs || !pool) throw new Error('当前网络没有此隐私资产池');
  const effectiveMode = kind === 'shield' ? 'native' : paymentMode;
  const result: PrivacyFeeQuote = { paymentMode: effectiveMode, feeRaw: '0', feePool: pool.address, feeSymbol: pool.symbol, feeDecimals: pool.decimals, feeCollector: ZeroAddress, options: [], quotedAt: Date.now() };
  const readPool = async (address: string, method: string) => poolFees.decodeFunctionResult(method, await provider.call({ to: address, data: poolFees.encodeFunctionData(method) }))[0];
  if (kind === 'send' && effectiveMode === 'private') {
    if (!plabs.feeGateway) throw new Error('当前网络未配置隐私手续费网关，请选择原生币支付');
    const candidates = plabs.pools.filter(item => item.underlying);
    const [fees] = feeGatewayInterface.decodeFunctionResult('feeOptions', await provider.call({ to: plabs.feeGateway, data: feeGatewayInterface.encodeFunctionData('feeOptions', [pool.address, candidates.map(item => item.address)]) }));
    if (fees.length !== candidates.length) throw new Error('手续费网关返回了无效报价');
    result.options = candidates.flatMap((item, index) => BigInt(fees[index]) > 0n ? [{ poolAddress: item.address, symbol: item.symbol, decimals: item.decimals, feeRaw: BigInt(fees[index]).toString() }] : []);
    const chosen = preferredFeePool ? result.options.find(item => item.poolAddress.toLowerCase() === preferredFeePool.toLowerCase()) : result.options.find(item => item.poolAddress.toLowerCase() === pool.address.toLowerCase()) ?? result.options[0];
    if (!chosen) throw new Error('当前资产不支持所选隐私手续费币种');
    Object.assign(result, { gateway: plabs.feeGateway, feeRaw: chosen.feeRaw, feePool: chosen.poolAddress, feeSymbol: chosen.symbol, feeDecimals: chosen.decimals, feeCollector: String(await readPool(chosen.poolAddress, 'feeCollector')) });
  } else if (kind !== 'send') {
    if (!pool.underlying) throw new Error('此代币不支持存入或提取');
    result.feeRaw = BigInt(await readPool(pool.address, kind === 'shield' ? 'shieldFeeUnits' : 'unshieldFeeUnits')).toString();
    result.feeCollector = String(await readPool(pool.address, 'feeCollector'));
  }
  if (BigInt(result.feeRaw) > 0n && result.feeCollector === ZeroAddress) throw new Error('手续费收款地址无效');
  return result;
}

export async function relayerInputLimit(chainId: ChainId, kind: 'send' | 'unshield', maxActions: number, walletInputLimit = 9) {
  const network = NETWORKS[chainId];
  const response = await fetch(`${network.plabs!.relayerUrl}/healthz`, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!response.ok) throw new Error('Relayer 暂不可用，请稍后重试');
  const health = await response.json();
  const policy = health.gas_policy;
  const cap = policy?.[kind === 'send' ? 'transfer_cap' : 'unshield_cap'];
  if (health.ok !== true || policy?.schema !== 'perc20-relayer-gas-policy/v1' || policy.chain_id !== chainId || !Number.isSafeInteger(cap) || cap <= 0 || !Number.isSafeInteger(policy.margin_bps) || policy.margin_bps < 0 || policy.margin_bps > 1000) throw new Error('Relayer Gas 配置无效或网络不匹配');
  // Same conservative action budget used by the official client.
  const gasCap = Math.min(cap, chainId === 1 ? 16777216 : 30000000);
  const overhead = kind === 'send' ? 2400000 : 2250000;
  const actions = Math.min(maxActions, Math.floor((gasCap / (1 + policy.margin_bps / 10000) - overhead) / 537000));
  const limit = Math.min(walletInputLimit, actions - (kind === 'send' ? 3 : 1));
  if (limit < 1) throw new Error('当前 Relayer Gas 上限无法处理此操作，请使用原生币支付');
  return limit;
}
