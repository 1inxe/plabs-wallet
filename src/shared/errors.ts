export function walletErrorMessage(cause: unknown, nativeSymbol?: string): string {
  const raw = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : String(cause);
  if (/INSUFFICIENT_FUNDS|insufficient funds|signer had insufficient balance/i.test(raw)) {
    const coin = nativeSymbol ?? '原生币';
    return `公开账户的 ${coin} 余额不足以支付 Gas。请补充 ${coin}，或在手续费设置中选择“隐私资产支付”。`;
  }
  const short = cause && typeof cause === 'object' && 'shortMessage' in cause && typeof cause.shortMessage === 'string' ? cause.shortMessage : raw;
  if (/user rejected|user denied/i.test(short)) return '已取消签名或交易请求。';
  const safe = short.replace(/0x[0-9a-f]{64,}/gi, '[交易数据已隐藏]').split(/,?\s*payload=/)[0].split(/\s*\(error=/)[0];
  if (/^could not coalesce error$/i.test(safe.trim())) return '节点拒绝了请求，请核对余额、网络和交易状态后重试。';
  return safe.length > 240 ? `${safe.slice(0, 240)}…` : safe;
}
