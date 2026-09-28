// Only deterministic admission failures are terminal. Never classify transport
// errors, nonce errors or "already known" as proof that nothing was accepted.
export function isInsufficientGasRejection(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 20000) return false;
  if (/timeout|timed out|network error|already known|nonce too low|replacement/i.test(value)) return false;
  return /^(?:signer had insufficient balance|insufficient funds(?: for gas \* price \+ value| for intrinsic transaction cost)?)[.!]?$/i.test(value.trim());
}
export function legacyGasFailure(entry: Record<string, any>): boolean {
  if (!['requires-review', 'broadcast-unknown', 'prepared'].includes(entry.state) ||
      entry.transport === 'relayer' || entry.verification?.relayer || entry.requestId ||
      entry.txHash || entry.mainTxHash || entry.txHashes?.length || entry.attempts?.length || entry.submissionStarted) return false;
  const error = entry.error;
  if (typeof error !== 'string') return false;
  // The older wallet normalized this specific balance error before storing it.
  if (/^公开账户的 (?:MON|ETH|原生币) 余额不足以支付 Gas。请补充 (?:MON|ETH|原生币)，或在手续费设置中选择“隐私资产支付”。$/.test(error)) return true;
  if (isInsufficientGasRejection(error)) return true;
  // Older ethers coalescing errors carry the actual node rejection as JSON.
  // Inspect only its message, not echoed transaction data or arbitrary substrings.
  const match = /error=(\{[\s\S]*?\}),\s*payload=/.exec(error);
  if (!match || !/"method"\s*:\s*"eth_sendRawTransaction"/.test(error)) return false;
  try {
    const rpc = JSON.parse(match[1]);
    return Number.isInteger(rpc.code) && rpc.code < 0 && isInsufficientGasRejection(rpc.message);
  } catch { return false; }
}
export const gasRejectionMessage = '原生币余额不足，交易未被节点接受；已标记失败，可补充 Gas 或调整支付方式后重新发起。';
