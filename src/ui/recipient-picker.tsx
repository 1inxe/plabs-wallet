import { useState } from 'react';
import { ArrowRight, Check, Search } from 'lucide-react';
import { normalizeRecipient } from '../shared/recipients';
import type { WalletAccountSummary } from '../shared/types';
import { Button, Field, Input, PageView } from './primitives';

export function RecipientPicker({ privacy = false, accounts, initialValue = '', onSelect, onBack, networkName }: {
  privacy?: boolean; accounts: WalletAccountSummary[]; initialValue?: string;
  onSelect: (address: string) => void; onBack: () => void; networkName: string;
}) {
  const [query, setQuery] = useState(initialValue);
  let address = ''; let invalid = '';
  if (query.trim()) {
    try { address = normalizeRecipient(query, privacy); }
    catch { invalid = privacy ? '请输入有效的 perc1 隐私地址，或从下方选择账户' : '请输入有效的 EVM 地址（0x…），或从下方选择账户'; }
  }
  const choices = accounts.flatMap(account => {
    const value = privacy ? account.privacyAddress : account.address;
    if (!value) return [];
    try { return [{ ...account, recipient: normalizeRecipient(value, privacy) }]; } catch { return []; }
  }).filter(account => !query.trim() || account.name.toLowerCase().includes(query.trim().toLowerCase()) || account.recipient.toLowerCase().includes(query.trim().toLowerCase()));
  const select = (value: string) => onSelect(normalizeRecipient(value, privacy));
  return <PageView open onOpenChange={onBack} title={privacy ? '选择隐私收款地址' : '选择收款地址'} description={`${networkName} · ${privacy ? '隐私资产' : '公开资产'}`}>
    <div className="form-stack">
      <Field label={privacy ? '搜索账户或输入隐私地址' : '搜索账户或输入 EVM 地址'} error={query && !address && choices.length === 0 ? invalid : undefined}>
        <div className="recipient-search"><Search size={17} /><Input aria-label="搜索账户或输入收款地址" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={privacy ? '账户名称 / perc1…' : '账户名称 / 0x…'} autoComplete="off" spellCheck={false} /></div>
      </Field>
      {address && <section className="panel form-stack"><span className="validation-good"><Check size={14} />地址校验通过</span><p className="mono micro break-all">{address}</p><Button variant="primary" onClick={() => select(address)}>使用此地址<ArrowRight size={16} /></Button></section>}
      <h2 className="section-title">我的账户</h2>
      <div className="selection-list">{choices.map(account => <button type="button" className="selection-option recipient-option" key={account.id} onClick={() => select(account.recipient)} aria-label={`发送给 ${account.name}`}><span><strong>{account.name}</strong><small className="mono">{account.recipient}</small></span><ArrowRight size={16} /></button>)}</div>
      {!choices.length && <p className="empty-state">{privacy ? '没有匹配的已绑定隐私地址，可直接输入收款地址。' : '没有匹配的账户，可直接输入收款地址。'}</p>}
      <p className="micro text-muted">{privacy ? '仅支持 PLabs 隐私地址，不能使用普通 EVM 地址。' : `请确认接收方使用 ${networkName} 网络。`}</p>
    </div>
  </PageView>;
}
