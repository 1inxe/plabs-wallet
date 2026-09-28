import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { callWallet } from '../shared/runtime';
import type { WalletState } from '../shared/types';
import { Button, Status } from './primitives';
import { PageHeader, SecurityFooter } from './wallet-design';

export function WalletBackup({ accountId, onReady }: { accountId: string; onReady: (state: WalletState) => void }) {
  const [phrase, setPhrase] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    callWallet<{ phrase: string }>('GET_PENDING_WALLET_BACKUP', { accountId })
      .then(result => { if (active) setPhrase(result.phrase); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [accountId, revision]);
  const complete = async () => {
    if (!confirmed || !phrase || busy) return;
    setBusy(true); setError('');
    try {
      const state = await callWallet<WalletState>('CONFIRM_WALLET_BACKUP', { accountId, confirmed: true });
      setPhrase(''); onReady(state);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="wallet-shell"><PageHeader title="备份新钱包" subtitle="完成备份后进入钱包" />
    <main className="page-body">
      <div className="step-card"><span className="number-dot">2</span><div><strong>备份助记词</strong><small>步骤 2/2 · 离线保存恢复凭证</small></div><Status tone="warn">待确认备份</Status></div>
      <div className="intro compact-intro"><h1>备份助记词</h1><p>按顺序离线抄写这 12 个单词。助记词可以控制此钱包的公开资产，请勿截图或发送给他人。</p></div>
      {phrase ? <div className="phrase-grid">{phrase.split(' ').map((word, index) => <div key={index}><b>{index + 1}</b><span>{word}</span></div>)}</div> : !error && <p className="micro text-muted">正在读取待备份的助记词…</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {error && !phrase && <Button onClick={() => setRevision(value => value + 1)}>重新读取</Button>}
      <label className="check-row"><input type="checkbox" disabled={!phrase || busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>我已离线保存助记词，并理解丢失后无法恢复。</span></label>
      <Button variant="primary" disabled={!phrase || !confirmed || busy} onClick={complete}><Check size={18} />{busy ? '正在确认…' : '进入钱包'}</Button>
      <p className="micro text-muted">不会自动跳过此步骤。若关闭窗口，重新打开并解锁后可继续备份。</p>
      <SecurityFooter />
    </main>
  </div>;
}
