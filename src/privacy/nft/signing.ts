import {
  formatEther,
  keccak256,
  type JsonRpcProvider,
  type Signer,
} from 'ethers';
import { formatPrivacyAddress } from '../address';
import { inspectNftTransfer } from './transfer';
import { inspectMintTransaction, nftInterface, NFT, object } from './protocol';

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
  transfer = false,
) {
  const transferReview = transfer ? inspectNftTransfer(input) : null;
  const review = transferReview
      ? {
          poolAddress: transferReview.pool,
          tokenId: String(transferReview.tokenId),
        }
      : inspectMintTransaction(input, 30_000),
    transaction = object(input);
  await ports.guard();
  if (transferReview) {
    const result = await ports.provider.call({
      to: NFT.factory,
      data: nftInterface.encodeFunctionData('isCollection', [
        transferReview.pool,
      ]),
    });
    if (nftInterface.decodeFunctionResult('isCollection', result)[0] !== true)
      throw new Error('NFT 合集未通过核对');
  }
  const target = transferReview?.pool ?? NFT.market;
  const request = {
    from: ports.account,
    to: target,
    data: String(transaction.data),
    value: 0n,
  };
  const gasLimit = ((await ports.provider.estimateGas(request)) * 120n) / 100n;
  const fee = await ports.provider.getFeeData();
  const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice;
  if (
    !maxFeePerGas ||
    maxFeePerGas <= 0n ||
    gasLimit <= 0n ||
    gasLimit > 5_000_000n
  )
    throw new Error(
      transfer
        ? 'NFT Gas 估算不可用，请稍后重试发送'
        : 'NFT Gas 估算不可用，请稍后恢复原 mint',
    );
  const maxGas = gasLimit * maxFeePerGas;
  if (maxGas > 10n ** 18n)
    throw new Error('NFT 网络手续费超过单笔上限，请稍后重新估算');
  if ((await ports.provider.getBalance(ports.account)) < maxGas)
    throw new Error(
      transfer
        ? 'Ethereum 公开账户的 ETH 不足以支付发送 Gas，请补充 ETH 后重试'
        : 'Ethereum 公开账户的 ETH 不足以支付 NFT 铸造 Gas，请补充 ETH 后恢复原 mint',
    );
  const nonce = await ports.provider.getTransactionCount(
    ports.account,
    'pending',
  );
  const pricing =
    fee.maxFeePerGas != null
      ? {
          maxFeePerGas,
          maxPriorityFeePerGas:
            fee.maxPriorityFeePerGas != null &&
            fee.maxPriorityFeePerGas < maxFeePerGas
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
    ...(transferReview
      ? { 收款隐私地址: formatPrivacyAddress(transferReview.recipient) }
      : { 铸造价格: '0（免费 mint）' }),
    Gas费用上限: `${formatEther(maxGas)} ETH`,
    付款账户: ports.account,
    '交易序号 (Nonce)': String(nonce),
    收款: transferReview
      ? '上方指定的隐私地址'
      : '当前已解锁隐私钱包，私有 Note 只保存在扩展内',
    操作: transferReview
      ? '发送此枚 NFT，接收方获得隐私持有凭证'
      : '签署并广播此 NFT 铸造交易；不是普通转账或 ERC20 授权',
  });
  await ports.guard();
  if (transfer) inspectNftTransfer(transaction);
  else inspectMintTransaction(transaction, 30_000);
  const [currentNonce, currentBalance, currentGas] = await Promise.all([
    ports.provider.getTransactionCount(ports.account, 'pending'),
    ports.provider.getBalance(ports.account, 'pending'),
    ports.provider.estimateGas({
      ...request,
      ...pricing,
      nonce,
      gasLimit,
      chainId: 1,
    }),
  ]);
  await ports.guard();
  if (currentNonce !== nonce)
    throw new Error('账户 nonce 已变化，请重新确认 NFT 交易');
  if (currentBalance < maxGas)
    throw new Error('ETH 余额已变化，不足以支付确认的 Gas，请重新确认');
  if (currentGas > gasLimit)
    throw new Error('Gas 用量已超过确认上限，请重新确认 NFT 交易');
  if (transfer) inspectNftTransfer(transaction);
  else inspectMintTransaction(transaction, 30_000);
  // No provider-controlled population after approval; all fee/nonce bounds are fixed.
  const raw = await ports.signer.signTransaction({
    to: target,
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

export const signNftTransferTransaction = (
  input: unknown,
  ports: Parameters<typeof signNftTransaction>[1],
) => signNftTransaction(input, ports, true);
