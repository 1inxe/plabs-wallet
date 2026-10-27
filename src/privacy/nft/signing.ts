import { formatEther, keccak256, type JsonRpcProvider, type Signer } from 'ethers';
import { inspectMintTransaction, NFT, object } from './protocol';

/** Only the NFT engine calls this signer. It never enables arbitrary dApp EVM writes. */
export async function signNftTransaction(
  input: unknown,
  ports: {
    account: string;
    signer: Signer;
    provider: JsonRpcProvider;
    guard(): Promise<void>;
    approve(details: Record<string, string>): Promise<void>;
  },
) {
  const review = inspectMintTransaction(input, 30_000),
    transaction = object(input);
  await ports.guard();
  const request = {
    from: ports.account,
    to: NFT.market,
    data: String(transaction.data),
    value: 0n,
  };
  const gasLimit = ((await ports.provider.estimateGas(request)) * 120n) / 100n;
  const fee = await ports.provider.getFeeData();
  const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice;
  if (!maxFeePerGas || maxFeePerGas <= 0n || gasLimit <= 0n || gasLimit > 5_000_000n)
    throw new Error('NFT Gas 估算不可用，请稍后恢复原 mint');
  const maxGas = gasLimit * maxFeePerGas;
  if ((await ports.provider.getBalance(ports.account)) < maxGas)
    throw new Error('Ethereum 公开账户的 ETH 不足以支付 NFT 铸造 Gas，请补充 ETH 后恢复原 mint');
  const nonce = await ports.provider.getTransactionCount(ports.account, 'pending');
  const pricing =
    fee.maxFeePerGas != null
      ? {
          maxFeePerGas,
          maxPriorityFeePerGas:
            fee.maxPriorityFeePerGas != null && fee.maxPriorityFeePerGas < maxFeePerGas
              ? fee.maxPriorityFeePerGas
              : maxFeePerGas,
          type: 2,
        }
      : { gasPrice: maxFeePerGas, type: 0 };
  await ports.guard();
  await ports.approve({
    网络: 'Ethereum mainnet (1)',
    合集: review.poolAddress,
    NFT编号: `#${review.tokenId}`,
    铸造价格: '0（免费 mint）',
    Gas费用上限: `${formatEther(maxGas)} ETH`,
    付款账户: ports.account,
    收款: '当前已解锁隐私钱包，私有 Note 只保存在扩展内',
    操作: '签署并广播此 NFT 铸造交易；不是普通转账或 ERC20 授权',
  });
  await ports.guard();
  inspectMintTransaction(transaction, 30_000);
  // No provider-controlled population after approval; all fee/nonce bounds are fixed.
  const raw = await ports.signer.signTransaction({
    to: NFT.market,
    data: String(transaction.data),
    value: 0n,
    chainId: 1,
    gasLimit,
    nonce,
    ...pricing,
  });
  await ports.guard();
  return { raw, hash: keccak256(raw) };
}
