import { Interface, formatEther, formatUnits, getAddress, keccak256, parseUnits, type AbstractSigner, type JsonRpcProvider, type TransactionRequest } from 'ethers';
import { NETWORKS } from '../shared/networks';
import { normalizeRecipient } from '../shared/recipients';
import type { ChainId, PublicAssetBalance, PublicTransferResult, PublicTransferReview } from '../shared/types';

const token = new Interface(['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)']);
interface Context { address: string; chainId: ChainId; epoch: number }
interface Dependencies {
  context(): Promise<Context>;
  provider(chainId: ChainId): Promise<JsonRpcProvider>;
  signer(provider: JsonRpcProvider): AbstractSigner;
  assets(): Promise<PublicAssetBalance[]>;
  queue<T>(work: () => Promise<T>): Promise<T>;
  load(context: Context): Promise<PublicTransferResult | null>;
  save(result: PublicTransferResult): Promise<void>;
}
interface Prepared { context: Context; review: PublicTransferReview; request: TransactionRequest; amount: bigint; gasLimit: bigint; gasCost: bigint }

export const createPublicTransfers = (deps: Dependencies) => {
  const prepared = new Map<string, Prepared>();
  const assertContext = async (expected: Context) => {
    const current = await deps.context();
    if (current.address !== expected.address || current.chainId !== expected.chainId || current.epoch !== expected.epoch) throw new Error('账户、网络或解锁会话已变化，请重新预览');
  };
  const resultFor = async (context: Context) => {
    const result = await deps.load(context);
    if (!result || result.state !== 'pending') return result;
    const receipt = await (await deps.provider(context.chainId)).getTransactionReceipt(result.txHash);
    if (!receipt) return result;
    const updated: PublicTransferResult = { ...result, state: receipt.status === 1 ? 'confirmed' : 'failed', message: undefined };
    await deps.save(updated);
    return updated;
  };
  const checkBalance = async (provider: JsonRpcProvider, item: Prepared) => {
    const { review, context, amount, gasCost } = item;
    const balance = await provider.getBalance(context.address, 'pending');
    if (balance < gasCost + (review.tokenAddress ? 0n : amount)) throw new Error(`${review.nativeSymbol} 余额不足以支付金额和网络手续费`);
    if (review.tokenAddress) {
      const raw = await provider.call({ to: review.tokenAddress, data: token.encodeFunctionData('balanceOf', [context.address]) });
      if (BigInt(token.decodeFunctionResult('balanceOf', raw)[0]) < amount) throw new Error(`${review.symbol} 余额不足`);
    }
  };
  return {
    clear: () => prepared.clear(),
    status: async () => {
      const context = await deps.context();
      const result = await resultFor(context);
      await assertContext(context);
      return result;
    },
    prepare: async (input: Record<string, unknown>): Promise<PublicTransferReview> => {
      const context = await deps.context();
      if (Number(input.chainId) !== context.chainId) throw new Error('发送网络与当前网络不一致');
      const recipient = normalizeRecipient(String(input.recipient ?? ''), false);
      const tokenAddress = input.tokenAddress == null ? null : getAddress(String(input.tokenAddress));
      if ((await resultFor(context))?.state === 'pending') throw new Error('上一笔公开转账仍待确认，请先查看交易状态');
      const asset = (await deps.assets()).find(item => item.chainId === context.chainId && (item.address?.toLowerCase() ?? null) === (tokenAddress?.toLowerCase() ?? null));
      if (!asset) throw new Error('资产不可用，请刷新资产列表');
      const value = String(input.amount ?? '').trim();
      if (!/^\d+(\.\d*)?$/.test(value)) throw new Error('请输入有效金额');
      const amount = parseUnits(value, asset.decimals);
      if (amount <= 0n || amount > BigInt(asset.balanceRaw)) throw new Error('金额必须大于 0 且不能超过余额');
      const provider = await deps.provider(context.chainId);
      const request: TransactionRequest = { from: context.address, to: tokenAddress ?? recipient, chainId: context.chainId,
        value: tokenAddress ? 0n : amount, data: tokenAddress ? token.encodeFunctionData('transfer', [recipient, amount]) : '0x' };
      // Simulate ERC-20 transfer as well: some tokens return false without reverting.
      if (tokenAddress) {
        const returned = await provider.call(request);
        if (returned !== '0x' && !token.decodeFunctionResult('transfer', returned)[0]) throw new Error('代币合约拒绝转账');
      }
      const gasLimit = (await provider.estimateGas(request)) * 120n / 100n;
      const fees = await provider.getFeeData();
      const price = fees.maxFeePerGas ?? fees.gasPrice;
      if (price == null || price <= 0n) throw new Error('无法获取网络手续费');
      const gasCost = gasLimit * price;
      if (gasCost > 10n ** 18n) throw new Error('网络手续费超过单笔上限');
      Object.assign(request, { gasLimit }, fees.maxFeePerGas != null
        ? { maxFeePerGas: price, maxPriorityFeePerGas: fees.maxPriorityFeePerGas != null && fees.maxPriorityFeePerGas < price ? fees.maxPriorityFeePerGas : price }
        : { gasPrice: price });
      const review: PublicTransferReview = { id: crypto.randomUUID(), chainId: context.chainId, from: context.address, recipient, tokenAddress,
        symbol: asset.symbol, amount: formatUnits(amount, asset.decimals), maxGasCost: formatEther(gasCost), nativeSymbol: NETWORKS[context.chainId].nativeSymbol, expiresAt: Date.now() + 120_000 };
      const item = { context, review, request, amount, gasLimit, gasCost };
      await checkBalance(provider, item);
      await assertContext(context);
      for (const [id, old] of prepared) if (old.review.expiresAt <= Date.now()) prepared.delete(id);
      prepared.set(review.id, item);
      return review;
    },
    submit: (id: string) => deps.queue(async (): Promise<PublicTransferResult> => {
      const item = prepared.get(id);
      if (!item || item.review.expiresAt <= Date.now()) throw new Error('发送预览已过期或已提交，请重新预览');
      prepared.delete(id);
      const { context, review, request } = item;
      await assertContext(context);
      if ((await resultFor(context))?.state === 'pending') throw new Error('上一笔公开转账仍待确认');
      const provider = await deps.provider(context.chainId);
      await checkBalance(provider, item);
      if (await provider.estimateGas(request) > item.gasLimit) throw new Error('Gas 用量已超过预览上限，请重新预览');
      if (review.tokenAddress) {
        const returned = await provider.call(request);
        if (returned !== '0x' && !token.decodeFunctionResult('transfer', returned)[0]) throw new Error('代币合约拒绝转账，请重新预览');
      }
      const signer = deps.signer(provider);
      const populated = await signer.populateTransaction(request);
      await assertContext(context);
      const raw = await signer.signTransaction(populated);
      await assertContext(context);
      const result: PublicTransferResult = { chainId: context.chainId, from: context.address, recipient: review.recipient,
        symbol: review.symbol, amount: review.amount, txHash: keccak256(raw), state: 'pending' };
      // Persist the locally computed hash before sending. A lost RPC response must
      // not turn a possibly broadcast transaction into a retryable new transfer.
      await deps.save(result);
      try { await assertContext(context); } catch (error) { await deps.save({ ...result, state: 'failed' }); throw error; }
      try { await provider.broadcastTransaction(raw); }
      catch { return { ...result, message: '广播结果暂未确认，请通过交易哈希核对，勿重复发送。' }; }
      return result;
    }),
  };
};
