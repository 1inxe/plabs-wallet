import { useEffect, useRef, useState } from 'react';
import { parseUnits } from 'ethers';
import { ArrowUpRight, Check, Clock } from 'lucide-react';
import { NETWORKS } from '../shared/networks';
import { callWallet } from '../shared/runtime';
import { walletErrorMessage } from '../shared/errors';
import type { PublicAssetBalance, PublicTransferResult, PublicTransferReview, WalletState } from '../shared/types';
import { Button, Field, Input, PageView } from './primitives';
import { RecipientPicker } from './recipient-picker';

export function PublicSend({ asset, state, onClose, onCompleted }: {
  asset: PublicAssetBalance; state: WalletState; onClose: () => void; onCompleted: () => void;
}) {
  const network = NETWORKS[asset.chainId];
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<PublicTransferReview | null>(null);
  const [result, setResult] = useState<PublicTransferResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const completed = useRef(onCompleted); completed.current = onCompleted;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setError('');
    callWallet<PublicTransferResult | null>('GET_PUBLIC_TRANSFER_STATUS').then(value => {
      if (active) { if (value?.state === 'pending') setResult(value); setChecked(true); }
    }).catch(cause => { if (active) setError(walletErrorMessage(cause)); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    if (result?.state !== 'pending') return;
    let active = true; let polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try {
        const next = await callWallet<PublicTransferResult | null>('GET_PUBLIC_TRANSFER_STATUS');
        if (!active || !next || next.txHash !== result.txHash) return;
        setResult(next); setError('');
        if (next.state === 'confirmed') completed.current();
      } catch (cause) { if (active) setError(walletErrorMessage(cause)); }
      finally { polling = false; }
    };
    void poll(); const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [result?.txHash, result?.state]);
  let amountError = '';
  if (amount) {
    try {
      if (!/^\d+(\.\d*)?$/.test(amount)) throw new Error();
      const raw = parseUnits(amount, asset.decimals);
      if (raw <= 0n) amountError = '金额必须大于 0';
      else if (raw > BigInt(asset.balanceRaw)) amountError = '金额超过可用余额';
    } catch { amountError = '金额格式或小数精度无效'; }
  }
  const prepare = async () => {
    if (busy || !checked || !amount || amountError) return;
    setBusy(true); setError('');
    try {
      const value = await callWallet<PublicTransferReview>('PREPARE_PUBLIC_TRANSFER', { chainId: asset.chainId, tokenAddress: asset.address, recipient, amount });
      if (alive.current) setReview(value);
    } catch (cause) { if (alive.current) setError(walletErrorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const submit = async () => {
    if (busy || !review) return;
    setBusy(true); setError('');
    try {
      const value = await callWallet<PublicTransferResult>('SUBMIT_PUBLIC_TRANSFER', { id: review.id });
      if (alive.current) { setResult(value); setReview(null); }
    } catch (cause) {
      // Re-read persisted status before allowing another preview if the response
      // was lost after the background worker signed/broadcast the transaction.
      if (alive.current) { setReview(null); setChecked(false); setRevision(value => value + 1); setError(walletErrorMessage(cause)); }
    } finally { if (alive.current) setBusy(false); }
  };
  const row = (label: string, value: string) => <div className="send-review-row"><span>{label}</span><strong>{value}</strong></div>;
  if (checked && !recipient && !result) return <RecipientPicker accounts={state.accounts} networkName={network.name} onSelect={setRecipient} onBack={onClose} />;
  return <PageView open busy={busy} onOpenChange={onClose} back={busy ? undefined : result || !recipient ? onClose : review ? () => setReview(null) : () => setRecipient('')}
    title={result ? result.state === 'confirmed' ? '交易已确认' : result.state === 'failed' ? '交易失败' : '交易已提交' : review ? '确认公开转账' : `发送 ${asset.symbol}`} description={`${network.name} · 公开转账`}>
    <div className="form-stack">
      {result ? <><div className="intro compact-intro">{result.state === 'confirmed' ? <Check size={32} /> : <Clock size={32} />}<h2>{result.amount} {result.symbol}</h2><p>{result.state === 'pending' ? '等待链上确认，请勿重复发送。' : result.state === 'confirmed' ? '交易已在链上确认。' : '链上执行失败，网络手续费仍可能已扣除。'}</p></div><section className="panel">{row('收款地址', result.recipient)}{row('交易哈希', result.txHash)}</section>{result.message && <p className="micro text-muted">{result.message}</p>}<a className="explorer-link" href={`${network.explorerUrl}/tx/${result.txHash}`} target="_blank" rel="noreferrer">查看链上交易<ArrowUpRight size={15} /></a><Button onClick={onClose}>返回资产详情</Button></>
      : !checked ? <><p role="status">正在检查交易状态…</p>{error && <Button onClick={() => setRevision(value => value + 1)}>重新检查</Button>}</>
      : review ? <><section className="panel">{row('网络', network.name)}{row('发送账户', review.from)}{row('收款地址', review.recipient)}{row('发送金额', `${review.amount} ${review.symbol}`)}{review.tokenAddress && row('代币合约', review.tokenAddress)}{row('最大网络手续费', `${review.maxGasCost} ${review.nativeSymbol}`)}</section><p className="micro text-muted">确认后签名并广播交易。预览有效期为两分钟，实际手续费以链上执行为准。</p><Button variant="primary" disabled={busy} onClick={submit}>{busy ? '正在提交…' : '确认并发送'}</Button></>
      : <><section className="panel">{row('发送账户', state.address ?? '')}{row('收款地址', recipient)}<Button size="small" disabled={busy} onClick={() => setRecipient('')}>更换收款地址</Button></section><Field label={`发送金额 (${asset.symbol})`} error={amountError} hint={`可用 ${asset.formatted} ${asset.symbol}`}><Input aria-label="公开发送金额" inputMode="decimal" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></Field><p className="micro text-muted">网络手续费使用 {network.nativeSymbol} 支付{asset.type === 'native' ? '，请为手续费预留余额' : ''}。</p><Button variant="primary" disabled={busy || !amount || Boolean(amountError)} onClick={prepare}>{busy ? '正在估算手续费…' : '下一步：确认发送'}</Button></>}
      {error && <p role="alert" className="micro text-danger">{error}</p>}
    </div>
  </PageView>;
}
