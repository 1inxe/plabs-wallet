import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, parseEther, type AbstractSigner, type JsonRpcProvider } from 'ethers';
import { createPublicTransfers } from './transfers';
import type { ChainId, PublicAssetBalance, PublicTransferResult } from '../shared/types';

const from = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const contract = '0x3333333333333333333333333333333333333333';
const abi = new Interface(['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)']);
let context: { address: string; chainId: ChainId; epoch: number };
let stored: PublicTransferResult | null;
let service: ReturnType<typeof createPublicTransfers>;
const provider = {
  getBalance: vi.fn(), call: vi.fn(), estimateGas: vi.fn(), getFeeData: vi.fn(),
  getTransactionReceipt: vi.fn(), broadcastTransaction: vi.fn(),
};
const signer = { populateTransaction: vi.fn(), signTransaction: vi.fn() };
const save = vi.fn();
const assets: PublicAssetBalance[] = [
  { chainId: 143, type: 'native', address: null, symbol: 'MON', decimals: 18, balanceRaw: parseEther('10').toString(), formatted: '10', manuallyAdded: false },
  { chainId: 143, type: 'erc20', address: contract, symbol: 'USDC', decimals: 6, balanceRaw: '10000000', formatted: '10', manuallyAdded: true },
];
const input = (extra = {}) => ({ chainId: 143, recipient, tokenAddress: null, amount: '1', ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  context = { address: from, chainId: 143, epoch: 1 }; stored = null;
  provider.getBalance.mockResolvedValue(parseEther('10'));
  provider.estimateGas.mockResolvedValue(21000n);
  provider.getFeeData.mockResolvedValue({ gasPrice: 1000000000n, maxFeePerGas: null });
  provider.getTransactionReceipt.mockResolvedValue(null);
  provider.broadcastTransaction.mockResolvedValue({});
  provider.call.mockImplementation(async request => request.data.startsWith(abi.getFunction('balanceOf')!.selector)
    ? abi.encodeFunctionResult('balanceOf', [10000000n]) : abi.encodeFunctionResult('transfer', [true]));
  signer.populateTransaction.mockImplementation(async request => ({ ...request, nonce: 1 }));
  signer.signTransaction.mockResolvedValue('0x1234');
  save.mockImplementation(async result => { stored = structuredClone(result); });
  let queue = Promise.resolve();
  service = createPublicTransfers({
    context: async () => ({ ...context }), provider: async () => provider as unknown as JsonRpcProvider,
    signer: () => signer as unknown as AbstractSigner, assets: async () => assets,
    load: async () => stored, save,
    queue: work => { const result = queue.then(work, work); queue = result.then(() => {}, () => {}); return result; },
  });
});

describe('public asset transfers', () => {
  it('previews without signing and broadcasts only after explicit submit', async () => {
    const review = await service.prepare(input());
    expect(review).toMatchObject({ from, recipient, amount: '1.0', symbol: 'MON', maxGasCost: '0.0000252' });
    expect(signer.signTransaction).not.toHaveBeenCalled();
    const result = await service.submit(review.id);
    expect(result.state).toBe('pending');
    expect(signer.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: recipient, value: parseEther('1'), chainId: 143, gasLimit: 25200n, gasPrice: 1000000000n }));
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(provider.broadcastTransaction.mock.invocationCallOrder[0]);
    await expect(service.submit(review.id)).rejects.toThrow('已提交');
    expect(provider.broadcastTransaction).toHaveBeenCalledTimes(1);
  });

  it('encodes ERC-20 recipient and exact units; never accepts supplied calldata', async () => {
    const review = await service.prepare(input({ tokenAddress: contract, amount: '1.234567', data: '0xbad' }));
    await service.submit(review.id);
    const request = signer.signTransaction.mock.calls[0][0];
    expect(request.to).toBe(contract); expect(request.value).toBe(0n);
    expect([...abi.decodeFunctionData('transfer', request.data)]).toEqual([recipient, 1234567n]);
  });

  it.each(['bad', '0x0000000000000000000000000000000000000000', 'perc1invalid'])(
    'rejects invalid public recipient %s', async value => {
      await expect(service.prepare(input({ recipient: value }))).rejects.toThrow();
      expect(signer.signTransaction).not.toHaveBeenCalled();
    });
  it.each(['0', '-1', '1e2', '1.0000001'])(
    'rejects invalid token amount %s', async amount => {
      await expect(service.prepare(input({ tokenAddress: contract, amount }))).rejects.toThrow();
    });
  it('rejects unknown assets and mismatched networks', async () => {
    await expect(service.prepare(input({ tokenAddress: recipient }))).rejects.toThrow('资产不可用');
    await expect(service.prepare(input({ chainId: 1 }))).rejects.toThrow('网络不一致');
  });
  it('expires reviews and clears them on session invalidation', async () => {
    const review = await service.prepare(input());
    const now = vi.spyOn(Date, 'now').mockReturnValue(review.expiresAt + 1);
    await expect(service.submit(review.id)).rejects.toThrow('过期');
    now.mockRestore();
    const next = await service.prepare(input()); service.clear();
    await expect(service.submit(next.id)).rejects.toThrow('过期');
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });
  it('does not broadcast if the transaction hash cannot be persisted', async () => {
    const review = await service.prepare(input()); save.mockRejectedValue(new Error('storage failed'));
    await expect(service.submit(review.id)).rejects.toThrow('storage failed');
    expect(provider.broadcastTransaction).not.toHaveBeenCalled();
  });
  it('rechecks token behavior and balance at submission', async () => {
    const review = await service.prepare(input({ tokenAddress: contract }));
    provider.call.mockImplementation(async request => request.data.startsWith(abi.getFunction('balanceOf')!.selector)
      ? abi.encodeFunctionResult('balanceOf', [10000000n]) : abi.encodeFunctionResult('transfer', [false]));
    await expect(service.submit(review.id)).rejects.toThrow('拒绝转账');
    expect(provider.broadcastTransaction).not.toHaveBeenCalled();
  });

  it('requires native balance for the transfer plus gas', async () => {
    provider.getBalance.mockResolvedValue(parseEther('1'));
    await expect(service.prepare(input())).rejects.toThrow('手续费');
  });
  it('requires native gas even for ERC-20 sends and rejects false-returning tokens', async () => {
    provider.getBalance.mockResolvedValue(0n);
    await expect(service.prepare(input({ tokenAddress: contract }))).rejects.toThrow('手续费');
    provider.getBalance.mockResolvedValue(parseEther('10'));
    provider.call.mockResolvedValue(abi.encodeFunctionResult('transfer', [false]));
    await expect(service.prepare(input({ tokenAddress: contract }))).rejects.toThrow('拒绝转账');
  });
  it('invalidates previews when accounts, chains or sessions change', async () => {
    const review = await service.prepare(input()); context.epoch++;
    await expect(service.submit(review.id)).rejects.toThrow('会话已变化');
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });
  it('checks authorization again after signing before broadcasting', async () => {
    const review = await service.prepare(input());
    signer.signTransaction.mockImplementation(async () => { context.epoch++; return '0x1234'; });
    await expect(service.submit(review.id)).rejects.toThrow('会话已变化');
    expect(provider.broadcastTransaction).not.toHaveBeenCalled();
  });
  it('requires a new preview when gas exceeds its cap', async () => {
    const review = await service.prepare(input()); provider.estimateGas.mockResolvedValue(30000n);
    await expect(service.submit(review.id)).rejects.toThrow('预览上限');
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });
  it('preserves the hash on ambiguous broadcast errors and prevents duplicate sends', async () => {
    const review = await service.prepare(input()); provider.broadcastTransaction.mockRejectedValue(new Error('timeout'));
    const result = await service.submit(review.id);
    expect(result).toMatchObject({ state: 'pending', txHash: stored!.txHash });
    await expect(service.prepare(input())).rejects.toThrow('仍待确认');
    provider.getTransactionReceipt.mockResolvedValue({ status: 1 });
    expect(await service.status()).toMatchObject({ state: 'confirmed' });
  });
  it('serializes submissions and reports a reverted receipt as failed', async () => {
    const review = await service.prepare(input());
    const results = await Promise.allSettled([service.submit(review.id), service.submit(review.id)]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    provider.getTransactionReceipt.mockResolvedValue({ status: 0 });
    expect(await service.status()).toMatchObject({ state: 'failed' });
  });
});
