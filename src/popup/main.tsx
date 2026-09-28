import type { VaultImportResult } from '../privacy/vault-import';
import { MAX_VAULT_JSON_CHARS } from '../shared/vault-limits';
import { PublicSend } from '../ui/public-send';
import { RecipientPicker } from '../ui/recipient-picker';
import { ConnectedSiteBar } from '../ui/connected-site';
import { DappRequestNotice, DappRequestView, useDappRequest } from '../ui/dapp-request';
import { walletErrorMessage } from '../shared/errors';
import { ActivitySection } from '../ui/activity-history';
import { MergeSettingsControl } from '../ui/merge-settings';
import { PrivacyNotes } from '../ui/privacy-notes';
import { WalletBackup } from '../ui/wallet-backup';
import { PaymentModeControl, usePrivacyPaymentMode } from '../ui/payment-mode';
import { ChangePrivacyPasswordPage } from '../ui/change-privacy-password';
import { ArrowLeft, ChevronDown, KeyRound, Clock, Globe, Download, FileKey, ArrowRight, CircleHelp } from 'lucide-react';
import { Brand, PageHeader, PasswordInput, CopyButton, SecurityFooter, SecurityCard, Segments, EmptyState, SubmitButton, DesignIcon } from '../ui/wallet-design';
import { parsePrivacyAddress } from '../privacy/address';
import { isAddress, parseUnits } from 'ethers';
import * as Tabs from '@radix-ui/react-tabs';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { NETWORKS } from '../shared/networks';
import { callWallet } from '../shared/runtime';
import type {
  ChainId,
  LockSettings,
  PrivacyAccountState,
  PrivacyPoolSnapshot,
  PrivacySyncProgress,
  PrivacyFeeQuote,
  PublicAssetBalance,
  TransactionSettings,
  WalletState,
  WalletAccountSummary,
} from '../shared/types';
import { Button, PageView, Field, IconButton, Input, Select, Status, Switch, Textarea } from '../ui/primitives';
import '../ui/index.css';

type MainTab = 'wallet' | 'settings';
type PrivacyAction = 'send' | 'receive' | 'shield' | 'unshield' | 'swap' | null;

const shortAddress = (address: string, front = 8, back = 6) =>
  `${address.slice(0, front)}…${address.slice(-back)}`;

const trimBalance = (value: string, decimals = 6) => {
  const [whole, fraction = ''] = value.split('.');
  return fraction
    ? `${whole}.${fraction.slice(0, decimals).replace(/0+$/, '')}`.replace(/\.$/, '')
    : whole;
};

const formatRaw = (value: string, decimals: number) => {
  if (decimals === 0) return value;
  const padded = value.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

const errorText = (cause: unknown) => walletErrorMessage(cause);


function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="rounded-lg border border-[#563037] bg-[#24161a] px-3 py-2.5 text-xs leading-5 text-[#ffabb3]">{children}</div>;
}

function Notice({ children, good = false }: { children: React.ReactNode; good?: boolean }) {
  return <div className={`rounded-lg border px-3 py-2.5 text-xs leading-5 ${good ? 'border-[#285242] bg-[#12251e] text-[#9fe4cb]' : 'border-[#544927] bg-[#242014] text-[#e7d39b]'}`}>{children}</div>;
}

function WalletSetup({ onReady, onCancel }: { onReady: (state: WalletState) => void; onCancel?: () => void }) {
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [phrase, setPhrase] = useState('');
  const [importType, setImportType] = useState('mnemonic');
  const [privateKey, setPrivateKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setError('');
    if (password !== confirm) return setError('两次密码不一致');
    setBusy(true);
    try {
      if (mode === 'create') {
        const result = await callWallet<{ state: WalletState }>('CREATE_WALLET', { password });
        onReady(result.state);
      } else {
        const result = await callWallet<{ state: WalletState }>('IMPORT_WALLET', { phrase, password, secretType: importType, privateKey });
        onReady(result.state);
      }
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  return <div className="wallet-shell"><PageHeader title="PLabs Wallet" onBack={onCancel} /><main className="page-body"><Segments value={mode} onChange={value => { setMode(value as 'create' | 'import'); setError(''); }} label="账户操作" options={[{ value: 'create', label: '创建钱包' }, { value: 'import', label: '导入钱包' }]} />{mode === 'create' ? <><div className="step-card"><span className="number-dot">1</span><div><strong>{onCancel ? '添加账户' : '创建新钱包'}</strong><small>步骤 1/2 · 生成加密助记词</small></div><span className="step-track" /></div><div className="intro"><Brand orbit /><h1>生成去中心化助记词</h1><p>即将在本地端侧隔离沙盒中生成 12 个助记词。助记词是恢复您钱包与资产的唯一所有权凭证。</p></div><div className="feature-list"><div><Lock /><span><strong>端侧离线派生</strong><small>完全在本地沙盒运算，无任何网络传输</small></span></div><div><KeyRound /><span><strong>唯一所有权</strong><small>助记词完全由您个人自托管</small></span></div></div></> : <><div className="intro compact-intro"><h1>导入钱包</h1><p>{importType === 'mnemonic' ? '输入 12 或 24 个英文助记词，单词间以空格分隔。' : '输入 64 位十六进制私钥，仅在本地加密保存。'}</p></div></>}<form onSubmit={submit} className="form-stack">{mode === 'import' && <><Segments label="导入凭证类型" value={importType} onChange={value => { setImportType(value); setError(''); }} options={[{ value: 'mnemonic', label: '助记词导入' }, { value: 'privateKey', label: '私钥导入' }]} />{importType === 'privateKey' ? <div className="panel"><Field label="Private Key"><PasswordInput value={privateKey} onChange={setPrivateKey} placeholder="输入私钥 (0x…)" /></Field></div> : <div className="panel"><Field label="Secret Recovery Phrase"><Textarea aria-label="助记词" value={phrase} onChange={event => setPhrase(event.target.value)} placeholder="例如: apple banana…" autoComplete="off" spellCheck={false} /></Field><div className="row-between micro mt-2"><span>已输入 {phrase.trim() ? phrase.trim().split(/\s+/).length : 0} 个单词</span><button type="button" onClick={() => setPhrase('')}>清空重填</button></div></div>}</>}{!onCancel && <><Field label="钱包主密码" hint="至少 10 位，包含字母、数字、符号中的至少两类"><PasswordInput value={password} onChange={setPassword} placeholder="设置钱包主密码" /></Field><Field label="确认密码"><PasswordInput value={confirm} onChange={setConfirm} placeholder="再次输入钱包主密码" /></Field></>}{mode === 'create' && <label className="check-row"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>我已知晓并理解：PLabs 无法代为找回助记词，助记词丢失将无法恢复资产。</span></label>}{error && <ErrorBox>{error}</ErrorBox>}<SubmitButton busy={busy} disabled={(mode === 'create' && !acknowledged) || (mode === 'import' && !(importType === 'mnemonic' ? phrase.trim() : privateKey.trim())) || (!onCancel && (!password || !confirm))}>{mode === 'create' ? '立即生成并备份助记词' : '导入并进入钱包'}<ArrowUpRight size={18} /></SubmitButton></form><SecurityFooter /></main></div>;
}

function Unlock({ state, onReady }: { state: WalletState; onReady: (state: WalletState) => void }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [help, setHelp] = useState(false);
  const unlock = async (event: React.FormEvent) => { event.preventDefault(); if (busy || !password) return; setBusy(true); setError(''); try { onReady(await callWallet('UNLOCK', { password })); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <div className="wallet-shell unlock-page"><div className="version-pill"><ShieldCheck size={12} />v{chrome.runtime.getManifest().version} ZK</div><div className="unlock-hero"><Brand orbit /><h1>Plabs Privacy Wallet</h1><span className="unlock-badge"><Shield size={12} />{state.accounts.length} 个 EVM 账户 · ZK 隐私双重保护</span></div><form className="unlock-form" onSubmit={unlock}><div className="row-between micro mono"><label htmlFor="unlock-password">主密码 / MASTER KEY</label><span className="text-mint">AES-256 GCM</span></div><PasswordInput value={password} onChange={setPassword} placeholder="请输入钱包主密码" autoFocus />{error && <ErrorBox>{error}</ErrorBox>}<Button variant="primary" className="w-full" type="submit" disabled={busy || !password}><Lock size={19} />{busy ? '正在解锁…' : '解锁钱包'}</Button></form><button className="recovery-link" onClick={() => setHelp(true)}><KeyRound size={14} />忘记密码？助记词恢复</button><SecurityCard />{help && <PageView open onOpenChange={setHelp} title="恢复钱包" description="钱包主密码无法找回"><p className="text-sm leading-6 text-muted">请在新的浏览器配置中安装钱包，并使用已备份的助记词导入。当前账户与隐私 Vault 不会被删除；隐私账户需使用独立的 Vault 备份和隐私密码恢复。</p><Button className="mt-4 w-full" onClick={() => setHelp(false)}>我知道了</Button></PageView>}</div>;
}

function AccountContext({ state, onState, onAdd, onSettings }: { state: WalletState; onState: (state: WalletState) => void; onAdd: () => void; onSettings: () => void }) {
  const [accountsOpen, setAccountsOpen] = useState(false); const [error, setError] = useState(''); const [switching, setSwitching] = useState(false);
  const openAccounts = async () => { setAccountsOpen(true); setError(''); try { onState(await callWallet<WalletState>('GET_STATE')); } catch (cause) { setError(errorText(cause)); } };
  const changeAccount = async (accountId: string) => { if (switching) return; if (accountId === state.activeAccountId) { setAccountsOpen(false); return; } setSwitching(true); setError(''); try { onState(await callWallet('SWITCH_ACCOUNT', { accountId })); setAccountsOpen(false); } catch (cause) { setError(errorText(cause)); } finally { setSwitching(false); } };
  return <><header className="account-header"><button className="account-pill" aria-label="选择账户" onClick={openAccounts}><span className="number-dot">{Math.max(1, state.accounts.findIndex(a => a.id === state.activeAccountId) + 1)}</span><span><strong>{state.accountName}<ChevronDown size={12} /></strong><small>{shortAddress(state.address ?? '', 6, 4)}</small></span></button><div className="network-pill"><span className="status-dot amber" /><Select ariaLabel="选择网络" value={String(state.chainId)} onValueChange={async value => { try { onState(await callWallet('SWITCH_CHAIN', { chainId: Number(value) })); } catch (cause) { setError(errorText(cause)); } }} options={Object.values(NETWORKS).map(n => ({ value: String(n.chainId), label: n.name, description: n.plabs ? 'EVM 公开资产 · 支持隐私池' : '仅支持 EVM 公开资产' }))} /></div><div className="flex"><IconButton label="设置" onClick={onSettings}><DesignIcon name="imgContainer23" /></IconButton></div></header>{error && <ErrorBox>{error}</ErrorBox>}{accountsOpen && <PageView open busy={switching} onOpenChange={setAccountsOpen} title="账户管理" description="一个主密码管理全部 EVM 账户"><div className="wallet-account-list">{state.accounts.map((account, index) => <article className={`account-list-item ${account.id === state.activeAccountId ? 'is-active' : ''}`} key={account.id}>
    <button className="account-option" disabled={switching} aria-label={`切换到 ${account.name}`} onClick={() => changeAccount(account.id)}><span className="number-dot">{index + 1}</span><span className="account-list-name" title={account.name}>{account.name}</span>{account.id === state.activeAccountId ? <span className="account-current"><Check size={12} />当前</span> : <ArrowRight size={14} className="text-muted" />}</button>
    <div className="account-list-address"><span className="address-tag public">EVM</span><span className="mono" title={account.address}>{shortAddress(account.address, 9, 7)}</span><CopyButton compact value={account.address} label={`复制 ${account.name} EVM 地址`} /></div>
    {account.privacyAddress && <div className="account-list-address"><span className="address-tag">ZK</span><span className="mono text-mint" title={account.privacyAddress}>{shortAddress(account.privacyAddress, 12, 8)}</span><CopyButton compact value={account.privacyAddress} label={`复制 ${account.name} 隐私地址`} /></div>}
  </article>)}</div>{error && <ErrorBox>{error}</ErrorBox>}<Button disabled={switching} className="w-full" variant="primary" onClick={() => { setAccountsOpen(false); onAdd(); }}><Plus size={18} />添加账户</Button></PageView>}</>;
}

function AddressCard({ state, privacy }: { state: WalletState; privacy: PrivacyAccountState | null }) {
  const [qr, setQr] = useState<'public' | 'privacy' | null>(null);
  const value = qr === 'public' ? state.address ?? '' : privacy?.privacyAddress ?? '';
  return <><section className="panel address-card"><div className="address-row"><span className="address-tag public">EVM</span><div><div className="flex items-center gap-1"><span className="mono micro address-line">{shortAddress(state.address ?? '', 6, 4)}</span><span className="tiny-badge">已解锁</span></div><small>公开透明地址 ({state.networkName} / EVM)</small></div><div className="address-actions"><CopyButton compact value={state.address ?? ''} label="复制 EVM 地址" /><IconButton label="EVM 地址二维码" onClick={() => setQr('public')}><DesignIcon name="imgContainer1" size={14} /></IconButton></div></div><div className="address-row"><span className="address-tag">ZK</span><div className="min-w-0"><div className="flex items-center gap-1"><span className="mono micro text-mint">{privacy?.privacyAddress ? shortAddress(privacy.privacyAddress, 10, 5) : '隐私地址 (perc1)'}</span>{privacy?.hasAccount && <span className="tiny-badge">{privacy.unlocked ? '已解密' : '已锁定'}</span>}</div><small>{privacy?.hasAccount ? '零知识隐私地址 (Shielded)' : '暂未创建独立隐私账户'}</small></div>{privacy?.privacyAddress && <div className="address-actions"><CopyButton compact value={privacy.privacyAddress} label="复制隐私地址" /><IconButton label="隐私地址二维码" onClick={() => setQr('privacy')}><DesignIcon name="imgContainer3" size={14} /></IconButton></div>}</div></section>{qr && <PageView open onOpenChange={() => setQr(null)} title={qr === 'public' ? 'EVM 公开地址' : '接收隐私资产'} description={qr === 'public' ? state.networkName : '仅接收同协议的隐私资产'}><div className="qr-view"><div className="qr-code"><QRCodeSVG value={value} size={210} /></div><p className="mono break-all text-xs">{value}</p><CopyButton value={value} label="复制完整地址" /></div><Notice>{qr === 'public' ? `仅接收 ${state.networkName} 网络的公开资产，请核对网络后转入。` : '这是隐私地址，不能用于普通 EVM 转账。请使用同协议的隐私钱包发送。'}</Notice></PageView>}</>;
}

function AssetRow({ symbol, balance, privacy = false, detail, hidden = false, contract, chainId, onChanged, publicAsset, walletState }: { publicAsset?: PublicAssetBalance; walletState?: WalletState; symbol: string; balance: string; privacy?: boolean; detail: string; hidden?: boolean; contract?: string; chainId: ChainId; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [detailTab, setDetailTab] = useState('notes');
  const [sending, setSending] = useState(false);
  const quantity = hidden ? '••••••' : Number(balance) > 0 && Number(balance) < 0.000001 ? '<0.000001' : trimBalance(balance);
  return <><button type="button" className="asset-row asset-button" aria-label={`查看 ${symbol} 资产详情`} onClick={() => setOpen(true)}><span className={`asset-symbol ${privacy ? 'private' : 'public'} ${symbol.includes('USD') ? 'cyan' : ''}`}>{privacy ? <DesignIcon name={symbol.includes('USD') ? 'imgContainer6' : 'imgContainer5'} size={20} /> : symbol.slice(0, 1)}</span><div className="asset-meta"><div className="flex items-center gap-1.5"><strong>{symbol}</strong><span className={`tiny-badge ${privacy ? '' : 'public'}`}>{privacy ? '隐私资产' : contract ? 'ERC-20' : 'Gas 币'}</span></div><small>{detail}</small></div><div className="asset-value"><strong className="asset-amount mono" title={hidden ? undefined : balance}>{quantity}</strong><small>{privacy ? '总数量' : '代币数量'} · 详情</small></div></button><PageView open={open} onOpenChange={setOpen} title={`${symbol} 资产详情`} description={NETWORKS[chainId].name}><section className="panel asset-detail"><span className="tiny-badge">{privacy ? '隐私资产 · 本地解密' : '公开链上资产'}</span><p className="detail-quantity mono">{hidden ? '••••••' : balance}</p><strong>{symbol}</strong><p className="micro text-muted mt-3">{detail}</p></section>{!privacy && publicAsset && walletState && <Button variant="primary" className="w-full" onClick={() => setSending(true)}>Send<ArrowUpRight size={16} /></Button>}<Notice>价格预言机尚未接入，不显示美元估值。代币名称不代表固定价格或兑换比例。</Notice>{open && privacy && contract && <><Segments label="隐私资产详情内容" value={detailTab} onChange={setDetailTab} options={[{ value: 'notes', label: 'Notes 管理' }, { value: 'activity', label: '操作记录' }]} />{detailTab === 'notes' ? <PrivacyNotes chainId={chainId} poolAddress={contract} symbol={symbol} hidden={hidden} onChanged={onChanged} /> : <ActivitySection chainId={chainId} poolAddress={contract} symbol={symbol} hidden={hidden} />}</>}{contract && <section className="panel form-stack"><h2>{privacy ? '隐私池合约' : '代币合约'}</h2><p className="mono break-all text-xs">{contract}</p><CopyButton value={contract} label="复制合约地址" /><a className="explorer-link" href={`${NETWORKS[chainId].explorerUrl}/address/${contract}`} target="_blank" rel="noreferrer">在区块浏览器查看合约<ArrowUpRight size={14} /></a></section>}<Button onClick={() => setOpen(false)}>返回资产列表</Button></PageView>{sending && publicAsset && walletState && <PublicSend key={`${walletState.activeAccountId}:${chainId}:${publicAsset.address}`} asset={publicAsset} state={walletState} onClose={() => setSending(false)} onCompleted={() => onChanged?.()} />}</>;
}

function AddAssetPage({ chainId, privacyEnabled, initialMode = 'public', onClose, onAdded }: { chainId: ChainId; privacyEnabled: boolean; initialMode?: 'public' | 'privacy'; onClose: () => void; onAdded: () => void }) {
  const network = NETWORKS[chainId];
  const [mode, setMode] = useState<'public' | 'privacy'>(initialMode);
  const [address, setAddress] = useState('');
  const [poolAddress, setPoolAddress] = useState(network.plabs?.pools[0]?.address ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async () => { if (busy) return; setBusy(true); setError(''); try { if (mode === 'public') await callWallet('ADD_PUBLIC_ASSET', { address: address.trim() }); else await callWallet('ADD_VISIBLE_PRIVACY_ASSET', { chainId, poolAddress }); onAdded(); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return <PageView open busy={busy} onOpenChange={(open) => !open && onClose()} title="添加资产" description={network.name} footer={<Button className="w-full" variant="primary" disabled={busy || (mode === 'public' ? !isAddress(address.trim()) : !poolAddress)} onClick={add}>{busy ? '读取资产…' : '添加'}</Button>}><Tabs.Root value={mode} onValueChange={(value) => setMode(value as 'public' | 'privacy')}><Tabs.List className="mb-4 grid grid-cols-2 rounded-lg bg-surface p-1"><Tabs.Trigger value="public" className="h-10 rounded-md text-sm text-muted data-[state=active]:bg-raised data-[state=active]:font-semibold data-[state=active]:text-ink">公开资产</Tabs.Trigger><Tabs.Trigger value="privacy" disabled={!privacyEnabled || !network.plabs} className="h-10 rounded-md text-sm text-muted data-[state=active]:bg-raised data-[state=active]:font-semibold data-[state=active]:text-ink disabled:opacity-40">隐私资产</Tabs.Trigger></Tabs.List></Tabs.Root>{mode === 'public' ? <Field label="ERC-20 合约地址" hint="从当前网络读取代币信息；不代表已接入价格报价。" error={address && !isAddress(address.trim()) ? '请输入有效的 EVM 合约地址' : undefined}><Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" spellCheck={false} /></Field> : <Field label="已审核隐私资产"><Select ariaLabel="选择隐私资产" className="w-full" value={poolAddress} onValueChange={setPoolAddress} options={(network.plabs?.pools ?? []).map((pool) => ({ value: pool.address, label: `${pool.symbol} · ${shortAddress(pool.address)}` }))} /></Field>}{error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}</PageView>;
}

function AssetHome({ state, privacy, onPrivacyChange, onSettings }: { state: WalletState; privacy: PrivacyAccountState | null; onPrivacyChange: (privacy: PrivacyAccountState) => void; onSettings: () => void }) {
  const network = NETWORKS[state.chainId];
  const [assets, setAssets] = useState<PublicAssetBalance[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [adding, setAdding] = useState<'public' | 'privacy' | null>(null); const [assetRevision, setAssetRevision] = useState(0);
  const refresh = async () => { setLoading(true); setError(''); try { setAssets(await callWallet<PublicAssetBalance[]>('GET_PUBLIC_ASSETS')); } catch (cause) { setError(errorText(cause)); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, [state.chainId, state.activeAccountId]);
  const visible = assets.filter(asset => BigInt(asset.balanceRaw) > 0n || asset.manuallyAdded || asset.type === 'native');
  return <main className="page-body dashboard-body"><PrivacyHome key={`${state.activeAccountId}:${state.chainId}`} state={state} privacyState={privacy} onPrivacyChange={onPrivacyChange} onAddAsset={() => setAdding('privacy')} assetRevision={assetRevision} onSettings={onSettings} /><section className="panel public-assets"><div className="row-between"><div><h2><Globe size={17} className="text-amber" />公开资产 ({network.name})<span className="tiny-badge public">L1 Public</span></h2><small>链上公开余额 · 与隐私资产分开显示</small></div><div className="flex"><IconButton label="刷新资产" disabled={loading} onClick={refresh}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></IconButton><IconButton label="添加资产" onClick={() => setAdding('public')}><Plus size={16} /></IconButton></div></div>{loading && assets.length === 0 ? <EmptyState>正在读取公开资产…</EmptyState> : visible.length === 0 ? <EmptyState>当前链暂无公开资产</EmptyState> : visible.map(asset => <AssetRow key={`${state.activeAccountId}:${state.chainId}:${asset.address ?? 'native'}`} publicAsset={asset} walletState={state} onChanged={() => void refresh()} symbol={asset.symbol} balance={asset.formatted} chainId={state.chainId} contract={asset.address ?? undefined} detail={asset.type === 'native' ? `${network.name} 原生 Gas 资产` : shortAddress(asset.address ?? '')} />)}{error && <ErrorBox>{error}</ErrorBox>}<p className="public-hint"><ShieldCheck size={12} />点击公开资产详情中的 Send 发送</p></section><SecurityFooter />{adding && <AddAssetPage initialMode={adding} chainId={state.chainId} privacyEnabled={Boolean(privacy?.unlocked)} onClose={() => setAdding(null)} onAdded={() => { void refresh(); setAssetRevision(value => value + 1); }} />}</main>;
}

function PrivacySetup({ onChange, onClose, initialMode = 'create' }: { onChange: () => void; onClose: () => void; initialMode?: 'create' | 'import' }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [mode, setMode] = useState<'create' | 'import'>(initialMode); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [vaultText, setVaultText] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const readOfficial = async () => { setBusy(true); setError(''); setMessage(''); try { const result = await callWallet<{ status: 'opened' | 'not_found' | 'found'; vault?: object }>('READ_OFFICIAL_PRIVACY_VAULT'); if (result.status === 'found' && result.vault) { setVaultText(JSON.stringify(result.vault, null, 2)); setMessage('已读取官网 vault 和可用的加密同步状态'); } else if (result.status === 'opened') setMessage('已打开 PLabs 官网。连接当前钱包并解锁隐私账户后，再回来读取。'); else setMessage('官网未找到当前账户的 Vault，请先在官网完成连接和解锁。'); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const [replacement, setReplacement] = useState<(Extract<VaultImportResult, { status: 'confirmation_required' }> & { vault: string; password: string }) | null>(null);
  const [finished, setFinished] = useState(false);
  const importVault = async (vault: string, secret: string, confirmation?: string) => {
    const result = await callWallet<VaultImportResult>('IMPORT_PRIVACY_VAULT', { password: secret, vault, confirmation });
    if (result.status === 'confirmation_required') {
      setReplacement({ ...result, vault, password: secret });
      return;
    }
    setReplacement(null); setPassword(''); setConfirm(''); setVaultText(''); setFinished(true);
    setMessage(result.status === 'already_imported'
      ? '该隐私账户已导入，无需重复导入。现有密码、余额、凭证及同步进度均已保留。'
      : result.warning ?? 'Vault 已导入，可以返回查看并同步隐私资产。');
    onChange();
  };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (busy) return; setError(''); if (password !== confirm) return setError('两次隐私密码不一致'); setBusy(true); try {
    if (mode === 'import') await importVault(vaultText, password);
    else { await callWallet('CREATE_PRIVACY_ACCOUNT', { password }); onChange(); onClose(); }
  } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  if (finished) return <div className="flow-page"><PageHeader title="Vault 导入结果" onBack={onClose} /><main className="page-body form-stack"><Notice>{message}</Notice><Button onClick={onClose}>完成</Button></main></div>;
  if (replacement) return <div className="flow-page"><PageHeader title="确认替换隐私账户" onBack={busy ? undefined : () => setReplacement(null)} /><main className="page-body form-stack"><Notice>当前钱包已绑定不同的隐私账户。替换后将显示新账户的资产，旧账户资产不会转移。旧账户的本地加密记录会保留，请先确保已备份旧 Vault 和对应密码。</Notice><Field label="当前隐私地址"><p className="mono break-all text-xs">{replacement.currentAddress}</p></Field><Field label="导入后的隐私地址"><p className="mono break-all text-xs">{replacement.incomingAddress}</p></Field>{error && <ErrorBox>{error}</ErrorBox>}<Button variant="danger" disabled={busy} onClick={async () => { if (busy) return; setBusy(true); setError(''); try { await importVault(replacement.vault, replacement.password, replacement.confirmation); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }}>{busy ? '正在导入…' : '确认替换并导入'}</Button><Button disabled={busy} onClick={() => { setReplacement(null); setError(''); }}>取消，保留当前账户</Button></main></div>;
  return <div className="flow-page"><PageHeader title={mode === 'create' ? '创建隐私账户' : '导入官网 Vault'} onBack={busy ? undefined : onClose} subtitle="独立密钥 · 本地加密" /><main className="page-body"><Segments label="隐私账户操作" value={mode} onChange={value => { if (!busy) { setMode(value as 'create' | 'import'); setError(''); } }} options={[{ value: 'create', label: '创建全新账户' }, { value: 'import', label: '导入官网 Vault' }]} /><div className="intro compact-intro"><span className="hero-symbol"><ShieldCheck size={32} /></span><h1>{mode === 'create' ? '创建全新隐私账户' : '恢复您的隐私资产'}</h1><p>{mode === 'create' ? '为当前 EVM 账户生成独立的 perc1 隐私地址及加密密钥' : '导入 PLabs 官网加密 JSON，恢复隐私账户与同步状态'}</p></div><form onSubmit={submit} className="form-stack">{mode === 'import' && <><div className="panel"><h2><FileKey size={17} />加密 Vault JSON</h2><Textarea className="mt-3 mono" aria-label="加密 vault JSON" value={vaultText} onChange={event => setVaultText(event.target.value)} placeholder="粘贴加密 JSON 密文，或从官网读取" /><div className="row-between mt-3"><Button type="button" size="small" disabled={busy} onClick={readOfficial}>从 PLabs 官网读取</Button><label className="file-import">导入文件<input type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > MAX_VAULT_JSON_CHARS) return setError('Vault 文件不能超过 1 MB'); try { setVaultText(await file.text()); } catch { setError('无法读取文件'); } }} /></label></div></div>{message && <Notice good>{message}</Notice>}</>}<Field label="独立隐私密码" hint={mode === 'create' ? '请使用独立于 EVM 钱包的密码，至少 10 位' : '请输入该 Vault 原有的隐私密码'}><PasswordInput value={password} onChange={setPassword} placeholder="输入独立隐私密码" /></Field><Field label="确认隐私密码"><PasswordInput value={confirm} onChange={setConfirm} placeholder="再次输入隐私密码" /></Field><Notice>隐私账户与 EVM 账户使用独立密钥。请同时备份加密 Vault 和隐私密码，钱包主助记词无法恢复隐私资产。</Notice>{error && <ErrorBox>{error}</ErrorBox>}<SubmitButton busy={busy} disabled={!password || !confirm || (mode === 'import' && !vaultText.trim())}><ShieldCheck size={18} />{mode === 'create' ? '创建隐私账户' : '导入加密 Vault'}</SubmitButton></form><SecurityFooter /></main></div>;
}

function PrivacyUnlock({ privacy, onChange, onClose, onImport }: { privacy: PrivacyAccountState; onChange: () => void; onClose: () => void; onImport: () => void }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const unlock = async (event: React.FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await callWallet('UNLOCK_PRIVACY', { password }); onChange(); onClose(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <div className="flow-page privacy-unlock-page"><PageHeader title="隐私安全" subtitle="独立会话 · 端到端保护" onBack={busy ? undefined : onClose} /><main className="page-body"><div className="intro compact-intro"><Brand /><h1>解锁隐私资产</h1><p>验证独立隐私密码以解密当前绑定的隐私账户</p></div><div className="panel"><div className="row-between"><span className="micro mono text-mint">隐私账户 (PERC-20)</span><span className="tiny-badge">已安全绑定</span></div><div className="address-display"><span className="mono">{shortAddress(privacy.privacyAddress ?? '', 14, 6)}</span><CopyButton compact value={privacy.privacyAddress ?? ''} /></div></div><form className="form-stack" onSubmit={unlock}><Field label="独立隐私密码" hint="此密码用于本地解密 ZK 证明私钥与票据池 (UTXO Notes)"><PasswordInput value={password} onChange={setPassword} placeholder="输入独立隐私密码" autoFocus /></Field><p className="micro text-muted flex gap-2"><Clock size={15} className="shrink-0" />解锁后将维持隐私会话有效，直至达到您设置的自动锁定时长或关闭浏览器。</p>{error && <ErrorBox>{error}</ErrorBox>}<SubmitButton busy={busy} disabled={!password}>立即解锁隐私资产<ArrowRight size={18} /></SubmitButton><div className="row-between"><button type="button" className="text-muted" onClick={onClose}>取消</button><button type="button" className="text-cyan" onClick={onImport}>忘记密码？重新导入 Vault</button></div></form><SecurityFooter /></main></div>;
}

interface OperationReview {
  id: string;
  kind: 'send' | 'shield' | 'unshield';
  network: string;
  symbol: string;
  amount: string;
  fee: string;
  receive: string;
  approvalCount: number;
  estimatedGas: string;
  maxGasCost: string;
  nativeSymbol: string;
  recipient: string;
  feeSymbol: string;
  receiveSymbol: string;
  feePool: string;
  paymentMode: 'native' | 'private';
  totalDebit: string;
  feeIncluded: boolean;
}

type OperationResult = { id: string; state: 'pending' | 'confirmed' | 'failed' | 'not-submitted'; txHash?: string; message?: string };

function ActionPage({ action, onActionChange, onClose, privacyAddress, publicAddress, snapshots, chainId, onCompleted, writesEnabled, onSettings, accounts }: { accounts: WalletAccountSummary[]; action: PrivacyAction; onActionChange: (action: PrivacyAction) => void; onClose: () => void; privacyAddress: string; publicAddress: string; snapshots: PrivacyPoolSnapshot[]; chainId: ChainId; onCompleted: () => void; writesEnabled: boolean; onSettings: () => void }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const network = NETWORKS[chainId];
  const kind = action;
  const availableSnapshots = kind === 'shield' ? snapshots.filter(snapshot => { const config = network.plabs?.pools.find(item => item.address.toLowerCase() === snapshot.poolAddress.toLowerCase()); return Boolean(config?.underlying && !config.nativeGateway); }) : kind === 'unshield' ? snapshots.filter(snapshot => chainId === 143 && snapshot.poolAddress.toLowerCase() === '0xcb36e209ae44fafc75dc6820ae42d9400637f99e') : snapshots;
  const [asset, setAsset] = useState(availableSnapshots[0]?.poolAddress ?? '');
  const [sendStep, setSendStep] = useState<'asset' | 'recipient' | 'amount'>(action === 'send' ? 'asset' : 'amount');
  useEffect(() => { window.scrollTo(0, 0); }, [sendStep]);
  const [amount, setAmount] = useState(''); const [recipient, setRecipient] = useState('');
  const [review, setReview] = useState<OperationReview | null>(null); const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const current = availableSnapshots.find(item => item.poolAddress === asset);
  const payment = usePrivacyPaymentMode();
  const [fees, setFees] = useState<PrivacyFeeQuote | null>(null);
  const [feePool, setFeePool] = useState('');
  const [feeError, setFeeError] = useState('');
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeRevision, setFeeRevision] = useState(0);
  const [pending, setPending] = useState<OperationResult | null>(null);
  const [existingPending, setExistingPending] = useState<{ id: string } | null>(null);
  const [pendingChecked, setPendingChecked] = useState(action === 'receive');
  const [pendingCheckError, setPendingCheckError] = useState('');
  const [pendingCheckRevision, setPendingCheckRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (action === 'receive') return;
    setPendingChecked(false); setPendingCheckError('');
    callWallet<{ id: string } | null>('GET_PENDING_PRIVACY_OPERATION')
      .then(result => { if (active) { setExistingPending(result); setPendingChecked(true); } })
      .catch(cause => { if (active) setPendingCheckError(errorText(cause)); });
    return () => { active = false; };
  }, [action, chainId, pendingCheckRevision]);
  useEffect(() => {
    if (!pending?.id) return;
    let active = true; let polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try {
        const result = await callWallet<OperationResult>('GET_PRIVACY_OPERATION_RESULT', { id: pending.id });
        if (!active) return;
        if (result.state === 'confirmed' && result.txHash) { setPending(null); setExistingPending(null); setTxHash(result.txHash); onCompleted(); }
        else if (result.state === 'failed' || result.state === 'not-submitted') { setPending(null); setExistingPending(null); setReview(null); setPendingChecked(false); setPendingCheckRevision(value => value + 1); setError(result.message ?? '操作已停止，请核对后重新填写'); }
        else setPending(result);
      } catch (cause) { if (active) setError(errorText(cause)); }
      finally { polling = false; }
    };
    void poll(); const timer = window.setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [pending?.id]);
  useEffect(() => { setFeePool(''); }, [kind, asset]);
  useEffect(() => {
    if (!asset || !payment.loaded || kind === 'receive' || review || txHash || pending) return;
    let active = true; setFeeLoading(true); setFeeError(''); setFees(null);
    callWallet<PrivacyFeeQuote>('GET_PRIVACY_FEE_QUOTE', { chainId, kind, poolAddress: asset, feePool: feePool || undefined }).then(value => { if (active) setFees(value); }).catch(cause => { if (active) setFeeError(errorText(cause)); }).finally(() => { if (active) setFeeLoading(false); });
    return () => { active = false; };
  }, [asset, kind, chainId, payment.mode, payment.loaded, feePool, feeRevision, Boolean(review), Boolean(pending), txHash]);
  const isPool = kind === 'shield' || kind === 'unshield';
  const title = kind === 'receive' ? '接收隐私资产' : kind === 'unshield' ? '提取隐私资产' : kind === 'shield' ? '存入隐私资产' : '发送隐私资产';
  const switchKind = (next: string) => { if (!busy && next !== kind && (next === 'shield' || next === 'unshield')) onActionChange(next); };
  useEffect(() => { if (!availableSnapshots.some(item => item.poolAddress === asset)) setAsset(availableSnapshots[0]?.poolAddress ?? ''); }, [kind, asset, availableSnapshots.map(item => item.poolAddress).join(',')]);
  let recipientValid = kind !== 'send';
  if (kind === 'send' && recipient) { try { parsePrivacyAddress(recipient); recipientValid = true; } catch { recipientValid = false; } }
  let amountError = '';
  if (amount) { try { if (!/^\d+(\.\d*)?$/.test(amount)) throw new Error('请输入有效金额'); const raw = parseUnits(amount, current?.decimals ?? 18); if (raw <= 0n) amountError = '金额必须大于 0'; else if (kind !== 'shield' && current && raw > BigInt(current.spendableBalanceRaw)) amountError = '金额超过可用余额'; } catch { amountError = '金额格式或小数精度无效'; } }
  const effectiveMode = kind === 'shield' ? 'native' : payment.mode;
  const quoteReady = fees && fees.paymentMode === effectiveMode && !feeLoading && !feeError;
  const feeBalance = fees ? snapshots.find(item => item.poolAddress.toLowerCase() === fees.feePool.toLowerCase()) : undefined;
  if (!amountError && amount && current && fees) {
    try {
      const raw = parseUnits(amount, current.decimals);
      if (kind === 'send' && fees.paymentMode === 'private' && fees.feePool.toLowerCase() === asset.toLowerCase() && raw + BigInt(fees.feeRaw) > BigInt(current.spendableBalanceRaw)) amountError = '余额不足以支付转账金额和隐私手续费';
      else if (kind === 'send' && fees.paymentMode === 'private' && fees.feePool.toLowerCase() !== asset.toLowerCase() && BigInt(feeBalance?.spendableBalanceRaw ?? '0') < BigInt(fees.feeRaw)) amountError = `${fees.feeSymbol} 隐私余额不足以支付手续费`;
      else if ((kind === 'unshield' || kind === 'shield') && raw <= BigInt(fees.feeRaw)) amountError = '操作金额必须大于手续费';
    } catch {}
  }
  const canPrepare = Boolean(quoteReady && pendingChecked && !existingPending && !pending && writesEnabled && current && amount && !amountError && recipientValid && kind !== 'receive' && kind !== 'swap');
  const setPercent = (percent: number) => { if (!current) return; const fee = kind === 'send' && fees?.paymentMode === 'private' && fees.feePool.toLowerCase() === asset.toLowerCase() ? BigInt(fees.feeRaw) : 0n; const available = BigInt(current.spendableBalanceRaw) - fee; setAmount(formatRaw(((available > 0n ? available : 0n) * BigInt(percent) / 100n).toString(), current.decimals)); };
  const prepare = async () => { if (!canPrepare || busy) return; setBusy(true); setError(''); try { setReview(await callWallet<OperationReview>('PREPARE_PRIVACY_OPERATION', { kind, chainId, poolAddress: asset, amount, recipient, feePool: fees?.feePool, expectedFeeRaw: fees?.feeRaw, expectedFeePool: fees?.feePool, paymentMode: fees?.paymentMode })); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const submit = async () => { if (!review || busy) return; setBusy(true); setError(''); try { const result = await callWallet<OperationResult>('SUBMIT_PRIVACY_OPERATION', { id: review.id }); if (result.state === 'pending') { setExistingPending({ id: result.id }); setPending(result); setReview(null); } else if (result.state === 'failed' || result.state === 'not-submitted') { setReview(null); setError(result.message ?? '操作未提交，请重新准备'); } else if (result.txHash) { setTxHash(result.txHash); onCompleted(); } } catch (cause) { setReview(null); setPendingChecked(false); setPendingCheckRevision(value => value + 1); setError(errorText(cause)); } finally { setBusy(false); } };
  if (kind === 'send' && !review && !pending && !txHash && sendStep === 'asset') return <PageView open onOpenChange={onClose} title="选择发送的隐私资产" description={`${network.name} · 步骤 1/3`}>
    <div className="selection-list">{availableSnapshots.map(item => <button type="button" className="selection-option" key={item.poolAddress} onClick={() => { setAsset(item.poolAddress); setAmount(''); setSendStep('recipient'); }}><span><strong>{item.symbol}</strong><small>可花费 {formatRaw(item.spendableBalanceRaw, item.decimals)} · {item.spendableNotes} Notes</small></span><ArrowRight size={16} /></button>)}</div>
    {!availableSnapshots.length && <EmptyState>暂无隐私资产，请先同步资产。</EmptyState>}
  </PageView>;
  if (kind === 'send' && !review && !pending && !txHash && sendStep === 'recipient') return <RecipientPicker privacy accounts={accounts} initialValue={recipient} networkName={`${network.name} · ${current?.symbol ?? ''}`} onSelect={value => { setRecipient(value); setSendStep('amount'); }} onBack={() => setSendStep('asset')} />;
  return <div className="flow-page"><PageHeader title={pending ? '隐私交易处理中' : txHash ? '交易已确认' : review ? review.kind === 'shield' ? '确认存入隐私池' : review.kind === 'unshield' ? '确认提取资产' : '确认隐私转账' : title} subtitle={isPool ? 'ZK CIPHER GATEWAY' : '零知识隐私通道'} onBack={busy ? undefined : pending ? () => setPending(null) : review && !txHash ? () => setReview(null) : kind === 'send' && !txHash ? () => setSendStep('recipient') : onClose} right={<span className="chain-label"><span className="status-dot amber" />{network.name}</span>} /><main className="page-body transaction-body">{pending ? <><div className="intro compact-intro"><span className="hero-symbol"><Clock size={28} /></span><h1>等待链上确认</h1><p>{pending.message ?? '正在查询隐私支付交易状态…'}</p></div><Notice>请勿重复发送。关闭页面后，可以再次进入隐私操作页面查看此请求。</Notice>{pending.txHash && <a className="explorer-link" href={`${network.explorerUrl}/tx/${pending.txHash}`} target="_blank" rel="noreferrer">查看链上交易<ArrowUpRight size={16} /></a>}{error && <ErrorBox>{error}</ErrorBox>}<Button onClick={onClose}>返回钱包</Button></> : kind === 'receive' ? <><div className="intro compact-intro"><h1>接收隐私资产</h1><p>将隐私地址分享给发送方</p></div><div className="panel qr-view"><div className="qr-code"><QRCodeSVG value={privacyAddress} size={220} level="M" /></div><span className="tiny-badge">PERC-20 · Shielded</span><p className="mono break-all text-xs">{privacyAddress}</p><CopyButton value={privacyAddress} label="复制隐私地址" /></div><Notice>仅接收同一 PLabs 协议的隐私资产。发送方必须选择正确的链和资产池。</Notice><Button variant="primary" onClick={onClose}>完成</Button></> : txHash ? <><div className="intro"><span className="hero-symbol"><Check size={32} /></span><h1>交易已确认</h1><p>交易已在 {network.name} 网络完成确认。</p></div><div className="panel"><p className="mono break-all text-xs">{txHash}</p><CopyButton value={txHash} label="复制交易哈希" /></div><a className="explorer-link" href={`${network.explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">在区块浏览器查看<ArrowUpRight size={16} /></a><Button variant="primary" onClick={onClose}>完成</Button></> : review ? <><div className="panel review-panel"><ReviewRow label="网络" value={review.network} /><ReviewRow label="操作" value={review.kind.toUpperCase()} /><ReviewRow label="资产" value={review.symbol} /><ReviewRow label="支付方式" value={review.paymentMode === 'private' ? '隐私资产支付 · Relayer 代付 Gas' : `${review.nativeSymbol} 原生币支付`} /><ReviewRow label="操作金额" value={`${review.amount} ${review.symbol}`} /><ReviewRow label={review.paymentMode === 'private' ? '隐私手续费' : '协议手续费'} value={`${review.fee} ${review.feeSymbol}${review.feeIncluded ? '（已含在操作金额内）' : ''}`} /><ReviewRow label="代币总扣除" value={`${review.totalDebit} ${review.symbol}${!review.feeIncluded && review.feeSymbol !== review.symbol && review.fee !== '0' ? ` + ${review.fee} ${review.feeSymbol}` : ''}`} /><ReviewRow label="预计到账" value={`${review.receive} ${review.receiveSymbol}`} /><ReviewRow label="收款方" value={review.recipient} /><ReviewRow label="Token 授权" value={review.approvalCount ? `${review.approvalCount} 笔精确授权` : '无需授权'} /><ReviewRow label="Gas 支付方" value={review.paymentMode === 'private' ? 'Relayer（费用已含在隐私手续费内）' : '当前 EVM 账户'} />{review.paymentMode === 'native' && <><ReviewRow label="预估 Gas" value={review.estimatedGas} /><ReviewRow label="最大 Gas 成本" value={`${review.maxGasCost} ${review.nativeSymbol}`} /></>}</div><Notice good>证明已在本地生成。{review.paymentMode === 'private' ? '确认后交由 Relayer 提交，从隐私资产中支付手续费。' : `确认后由当前 EVM 账户支付 ${review.nativeSymbol} Gas 并广播交易。`}</Notice>{error && <ErrorBox>{error}</ErrorBox>}<Button variant="primary" disabled={busy} onClick={submit}>{busy ? '广播并等待确认…' : review.paymentMode === 'private' ? '确认并提交 Relayer' : '确认并广播'}</Button></> : <>{!pendingChecked && !pendingCheckError && <p className="micro text-muted" role="status">正在检查是否有未完成的交易…</p>}{pendingCheckError && <div className="form-stack"><ErrorBox>{pendingCheckError}</ErrorBox><Button disabled={busy} onClick={() => setPendingCheckRevision(value => value + 1)}>重新检查交易状态</Button></div>}{existingPending && <section className="panel form-stack"><Notice>此账户在当前网络有一笔交易尚待核对。你可以填写参数，但需先确认上一笔结果才能生成新的交易。</Notice><Button disabled={busy} onClick={() => { setError(''); setPending({ id: existingPending.id, state: 'pending' }); }}>查看待确认操作<ArrowRight size={14} /></Button></section>}{isPool && <fieldset disabled={busy}><Segments value={kind!} label="隐私池操作" onChange={switchKind} options={[{ value: 'unshield', label: 'Unshield（提取资产）' }, { value: 'shield', label: 'Shield（存入隐私池）' }]} /></fieldset>}<div className="panel transfer-context"><div className="row-between"><h2><ShieldCheck size={22} className="text-mint" />{isPool ? kind === 'shield' ? '公开 EVM 账户' : '零知识隐私账户' : '主隐私账户'}</h2><span className="tiny-badge">ZK 会话有效</span></div><p className="mono micro text-muted mt-2">{shortAddress(kind === 'shield' ? publicAddress : privacyAddress, 17, 8)}</p>{isPool && <div className="transfer-destination"><ArrowDownToLine size={16} className="text-mint" /><span>{kind === 'shield' ? '存入当前隐私账户' : '提取至绑定 EVM 账户'}</span><Lock size={13} /></div>}</div>{kind !== 'send' && <><div><div className="row-between micro mb-2"><span>选择{kind === 'shield' ? '存入' : '隐私'}资产</span><span className="text-muted">{kind === 'shield' ? 'Wrapped ERC-20' : '可用余额'}</span></div>{availableSnapshots.length ? <div className="token-options">{availableSnapshots.map(item => <button disabled={busy} key={item.poolAddress} className={asset === item.poolAddress ? 'selected' : ''} onClick={() => { setAsset(item.poolAddress); setAmount(''); }}><span className={`asset-symbol private ${item.symbol.includes('USD') ? 'cyan' : ''}`}>{item.symbol.slice(0, 3)}</span><span><strong>{item.symbol}</strong><small>{kind === 'shield' ? '公开资产存入' : `${trimBalance(formatRaw(item.spendableBalanceRaw, item.decimals))} · ${item.spendableNotes} Notes`}</small></span></button>)}</div> : <Notice>当前网络暂无支持此操作的资产池。</Notice>}</div></>}{kind === 'send' && <section className="panel form-stack"><ReviewRow label="发送资产" value={current?.symbol ?? '—'} /><ReviewRow label="隐私收款地址" value={recipient} /><div className="flex gap-2"><Button size="small" disabled={busy} onClick={() => setSendStep('asset')}>更换资产</Button><Button size="small" disabled={busy} onClick={() => setSendStep('recipient')}>更换收款地址</Button></div></section>}<section className="panel amount-panel"><div className="row-between micro"><label htmlFor="transaction-amount">{kind === 'shield' ? '公开资产存入金额' : '转账金额'}</label>{kind !== 'shield' && <span className="mono text-muted">可用: {current ? trimBalance(formatRaw(current.spendableBalanceRaw, current.decimals)) : '—'}</span>}</div><div className="amount-input"><input id="transaction-amount" disabled={busy} aria-label="金额" inputMode="decimal" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /><strong>{current?.symbol ?? '—'}</strong></div>{amountError && <p className="text-danger micro">{amountError}</p>}{kind !== 'shield' && <div className="percentage-row">{[25, 50, 75, 100].map(percent => <button disabled={!current || busy || !quoteReady} key={percent} onClick={() => setPercent(percent)}>{percent === 100 ? 'MAX' : `${percent}%`}</button>)}</div>}<div className="amount-hint"><ShieldCheck size={14} />{kind === 'shield' ? '仅授权本次存入金额' : '自动选择可花费 Notes，生成本地零知识证明'}</div></section><PaymentModeControl nativeSymbol={network.nativeSymbol} disabled={busy} /><section className="panel form-stack"><div className="row-between"><h2>手续费明细</h2><IconButton label="刷新手续费" disabled={busy || feeLoading} onClick={() => setFeeRevision(value => value + 1)}><RefreshCw size={15} className={feeLoading ? 'animate-spin' : ''} /></IconButton></div>{kind === 'shield' && <p className="micro text-muted">Shield 涉及公开资产授权，本次使用原生币支付 Gas。</p>}{feeLoading ? <p className="micro text-muted">正在读取链上手续费…</p> : feeError ? <ErrorBox>{feeError}</ErrorBox> : fees ? <><ReviewRow label={fees.paymentMode === 'private' ? '隐私手续费' : '协议手续费'} value={`${formatRaw(fees.feeRaw, fees.feeDecimals)} ${fees.feeSymbol}`} /><ReviewRow label="网络 Gas" value={fees.paymentMode === 'private' ? '由 Relayer 支付，无需额外原生币' : `${network.nativeSymbol} · 生成证明后实时估算`} />{fees.options.length > 1 && <Field label="支付手续费的隐私资产"><Select ariaLabel="选择手续费代币" value={fees.feePool} onValueChange={setFeePool} options={fees.options.map(option => ({ value: option.poolAddress, label: `${option.symbol} · ${formatRaw(option.feeRaw, option.decimals)}` }))} /></Field>}<p className="micro text-muted">{kind === 'send' ? '手续费额外扣除，接收方收到输入的完整转账金额。' : '协议手续费从操作金额内扣除，预览中显示实际到账。'} 最终以确认页为准。</p></> : null}</section><div className="panel proof-panel"><h2><ShieldCheck size={15} className="text-mint" />零知识证明与执行指标</h2><div className="proof-grid"><div><small>证明计算</small><strong>Groth16 · 本地生成</strong></div><div><small>Gas 费用</small><strong>{effectiveMode === 'private' ? 'Relayer 代付' : '预览时获取实时估算'}</strong></div></div></div><Notice>{kind === 'unshield' ? 'Unshield 仅允许提取至当前绑定的 EVM 地址。提取后资产将重新进入公开透明链上账本。' : kind === 'shield' ? '将公开 ERC-20 资产存入隐私池。生成证明后请核对授权额度、费用与资产池。' : '请核准接收方 perc1 地址。链上交易一旦确认不可撤销。'}</Notice>{error && <ErrorBox>{error}</ErrorBox>}<p className="micro text-muted">{writesEnabled ? '实验性操作已开启 · 最终确认前不会广播交易' : <>实验性交易尚未开启。<button className="text-mint underline" onClick={onSettings}>前往设置</button>，了解支持范围后再开启。</>}</p><Button variant="primary" className="w-full" disabled={!canPrepare || busy} onClick={prepare}><Lock size={18} />{busy ? '正在本地生成 ZK 证明…' : kind === 'shield' ? '下一步：核对存入与费用' : kind === 'unshield' ? '下一步：核对提取与费用' : '生成证明并预览隐私转账'}</Button><SecurityFooter /></>}</main></div>;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-line py-2.5"><span className="text-xs text-muted">{label}</span><strong className="max-w-[250px] break-all text-right text-xs font-semibold text-ink">{value}</strong></div>;
}

const formatEta = (etaMs?: number) => {
  if (!etaMs || etaMs <= 0) return '';
  const minutes = Math.ceil(etaMs / 60_000);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `约 ${hours} 小时${remainder ? ` ${remainder} 分钟` : ''}`;
};

function PrivacyHome({ state, privacyState, onPrivacyChange, onAddAsset, assetRevision, onSettings }: { state: WalletState; privacyState: PrivacyAccountState | null; onPrivacyChange: (privacy: PrivacyAccountState) => void; onAddAsset: () => void; assetRevision: number; onSettings: () => void }) {
  const chainId = state.chainId;
  const [privacy, setPrivacy] = useState<PrivacyAccountState | null>(privacyState);
  const [snapshots, setSnapshots] = useState<PrivacyPoolSnapshot[]>([]);
  const [action, setAction] = useState<PrivacyAction>(null);
  const [actionVisit, setActionVisit] = useState(0);
  const openAction = (next: PrivacyAction) => { setActionVisit(visit => visit + 1); setAction(next); };
  const [setup, setSetup] = useState<'create' | 'import' | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [balancesHidden, setBalancesHidden] = useState(false);
  const [writesEnabled, setWritesEnabled] = useState(false);
  useEffect(() => { let active = true; callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS').then(settings => { if (active) setWritesEnabled(settings.experimentalPrivacyWrites); }).catch(cause => { if (active) setError(errorText(cause)); }); return () => { active = false; }; }, []);
  const [showZero, setShowZero] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState<PrivacySyncProgress | null>(null);
  const [visiblePools, setVisiblePools] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const automaticSyncKey = useRef(''); const mounted = useRef(true);
  const network = NETWORKS[chainId];
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = async () => { const next = await callWallet<PrivacyAccountState>('GET_PRIVACY_STATE'); if (!mounted.current) return; setPrivacy(next); onPrivacyChange(next); const values = next.unlocked ? await callWallet<PrivacyPoolSnapshot[]>('GET_PRIVACY_SNAPSHOTS') : []; if (mounted.current) setSnapshots(values); };
  const safeRefresh = () => { void refresh().catch(cause => mounted.current && setError(errorText(cause))); };
  useEffect(() => { setPrivacy(privacyState); }, [privacyState]);
  useEffect(() => { safeRefresh(); callWallet<string[]>('GET_VISIBLE_PRIVACY_ASSETS', { chainId }).then(value => mounted.current && setVisiblePools(value)).catch(cause => setError(errorText(cause))); }, [chainId, assetRevision]);
  const sync = async (rescan = false) => {
    if (busy) return;
    setBusy(true); setError('');
    let syncError = '';
    try {
      await callWallet<PrivacyPoolSnapshot[]>('SYNC_PRIVACY', { chainId, rescan });
    } catch (cause) {
      syncError = errorText(cause);
    } finally {
      // Other pools and completed pages may have been saved even on failure.
      try { if (mounted.current) await refresh(); }
      catch (cause) { syncError ||= errorText(cause); }
      if (mounted.current) { setError(syncError); setBusy(false); }
    }
  };
  useEffect(() => {
    if (!busy) return;
    const update = () => callWallet<PrivacySyncProgress>('GET_PRIVACY_SYNC_PROGRESS', { chainId }).then(value => mounted.current && setSyncStatus(value)).catch(() => {});
    void update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [busy, chainId]);
  useEffect(() => {
    if (!privacy?.unlocked || !privacy.canSync || !network.plabs || !privacy.privacyAddress) return;
    const key = `${privacy.privacyAddress}:${chainId}`; if (automaticSyncKey.current === key) return;
    automaticSyncKey.current = key; void sync();
  }, [privacy?.unlocked, privacy?.privacyAddress, privacy?.canSync, chainId]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (privacy?.unlocked && privacy.expiresAt && now >= privacy.expiresAt) { setAction(null); safeRefresh(); } }, [now, privacy?.expiresAt, privacy?.unlocked]);
  const lock = async () => { try { await callWallet('LOCK_PRIVACY'); setAction(null); setKeysOpen(false); automaticSyncKey.current = ''; await refresh(); } catch (cause) { setError(errorText(cause)); } };
  const current = snapshots.filter(snapshot => snapshot.chainId === chainId);
  const visible = current.filter(snapshot => showZero || BigInt(snapshot.totalBalanceRaw) > 0n || visiblePools.includes(snapshot.poolAddress.toLowerCase()));
  const spendableNotes = current.reduce((sum, item) => sum + item.spendableNotes, 0);
  const pendingNotes = current.reduce((sum, item) => sum + item.pendingNotes, 0);
  const remaining = Math.max(0, Math.ceil(((privacy?.expiresAt ?? now) - now) / 1000));
  const countdown = `${Math.floor(remaining / 3600) ? Math.floor(remaining / 3600) + ':' : ''}${String(Math.floor(remaining / 60) % 60).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const complete = current.length > 0 && current.every(item => item.syncState === 'complete');
  return <>{privacy?.unlocked && <div className="session-banner"><span className="session-icon"><Lock size={15} /><i /></span><div className="flex-1"><strong>隐私会话有效 <span className="tiny-badge">已解密</span></strong><small>自动锁定倒计时 <b className="mono text-amber">{privacy.expiresAt ? countdown : '—'}</b></small></div><button className="lock-private" onClick={lock}><Lock size={12} />单独锁定隐私</button></div>}{!privacy ? <EmptyState>正在读取隐私账户…</EmptyState> : !privacy.unlocked ? <><div className="net-worth"><span>你的隐私资产</span><strong>{privacy.hasAccount ? '••••••' : '—'}</strong><span className="muted-pill">{privacy.hasAccount ? '隐私余额已隐藏 · 解锁后查看' : '尚未创建隐私账户 · 暂无资产估值'}</span></div><section className="panel privacy-welcome"><div className="row-between"><h2><span className="hero-symbol small"><ShieldCheck size={19} /></span><span>隐私资产<small>ZK-Shield Protocol</small></span></h2><span className="tiny-badge">{privacy.hasAccount ? '已锁定' : '待开通'}</span></div><p>{privacy.hasAccount ? '您的隐私账户已安全绑定。输入独立隐私密码，解锁资产余额与零知识转账。' : <>当前 EVM 账户尚未绑定 <span className="mono text-mint">perc1</span> 隐私账户。基于零知识证明加密保护，开启后可在链上实现隐私转账与机密余额。</>}</p>{privacy.hasAccount ? <><button className="route-card primary-route" onClick={() => setUnlockOpen(true)}><span className="route-icon"><Lock size={22} /></span><span><strong>解锁隐私资产</strong><small>输入独立隐私密码 · 本地解密</small></span><ArrowRight size={19} /></button><div className="action-grid locked-actions">{['Receive', 'Send', 'Unshield', 'Swap'].map(label => <button disabled key={label}><Lock size={18} /><span>{label}</span></button>)}</div></> : <><button className="route-card primary-route" onClick={() => setSetup('create')}><span className="route-icon"><ShieldCheck size={23} /></span><span><strong>创建全新隐私账户 <i>推荐</i></strong><small>设置专属独立密码，本地安全派生</small></span><ArrowRight size={20} /></button><button className="route-card" onClick={() => setSetup('import')}><span className="route-icon cyan"><Download size={23} /></span><span><strong>导入官网 Vault</strong><small>粘贴加密 JSON 密文</small></span><ArrowRight size={20} /></button></>}<p className="micro text-center"><Lock size={12} className="inline mr-1" />已有备份文件？<button className="text-mint" onClick={() => setSetup('import')}>随时导入恢复</button></p></section></> : <><section className="panel vault-card"><div className="row-between"><h2><ShieldCheck className="text-mint" size={19} />隐私资产 <span className="tiny-badge vault-badge">ZK-Shielded Vault</span></h2><button className="key-button" onClick={() => setKeysOpen(true)}><KeyRound size={13} />密钥管理</button></div><div className="balance-overview"><div className="row-between"><span className="eyebrow">PRIVATE ASSETS · {network.name}</span><IconButton label={balancesHidden ? '显示隐私余额' : '隐藏隐私余额'} onClick={() => setBalancesHidden(value => !value)}>{balancesHidden ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div><div className="balance-number">{balancesHidden ? '••' : current.filter(item => BigInt(item.totalBalanceRaw) > 0n).length}<small> 种隐私资产</small></div><p className="balance-caption">资产由你掌控，余额仅在本地解密。</p><div className="valuation-status"><Clock size={14} /><span>价格预言机待接入<small>当前仅展示代币数量，不计算法币总值</small></span><span className="tiny-badge neutral">未报价</span></div><div className="note-stats"><span><Check size={13} />可花费凭证 <b>{balancesHidden ? '••' : spendableNotes}</b></span><span><Clock size={13} />待确认凭证 <b>{balancesHidden ? '••' : pendingNotes}</b></span></div></div><div className="action-grid">{([['receive', 'Receive', 'imgContainer17'], ['send', 'Send', 'imgContainer18'], ['unshield', 'Unshield', 'imgContainer19'], ['swap', 'Swap', 'imgContainer20']] as const).map(([value, label, icon]) => <button key={value} className={value === 'receive' ? 'receive-action' : ''} disabled={value === 'swap' || (!network.plabs && value !== 'receive')} title={value === 'swap' ? '当前网络暂无可用兑换路线' : label} onClick={() => openAction(value)}><span><DesignIcon name={icon} size={20} /></span><strong>{label}</strong></button>)}</div><p className="capability-note">Swap 暂未开放 · 当前网络尚无可用兑换路线</p><button className="shield-entry" disabled={!network.plabs} onClick={() => openAction('shield')}><Shield size={14} />Shield · 存入隐私池<ArrowRight size={14} /></button></section><section className="panel private-assets"><div className="row-between"><h2><DesignIcon name="imgContainer4" size={17} />隐私代币资产</h2><button className="text-toggle" aria-pressed={showZero} onClick={() => setShowZero(value => !value)}>{showZero ? '隐藏零余额' : '显示全部'}</button></div>{visible.length ? visible.map(snapshot => <AssetRow onChanged={safeRefresh} key={snapshot.poolAddress} symbol={snapshot.symbol} chainId={chainId} contract={snapshot.poolAddress} balance={formatRaw(snapshot.totalBalanceRaw, snapshot.decimals)} hidden={balancesHidden} privacy detail={balancesHidden ? '余额与凭证数量已隐藏' : `可花费 ${formatRaw(snapshot.spendableBalanceRaw, snapshot.decimals)} · 待确认 ${formatRaw((BigInt(snapshot.totalBalanceRaw) - BigInt(snapshot.spendableBalanceRaw)).toString(), snapshot.decimals)}`} />) : <EmptyState>{busy ? '正在查找隐私资产…' : '当前链暂无非零隐私资产'}</EmptyState>}<button className="add-asset" onClick={onAddAsset}><Plus size={14} />添加隐私代币（仅限固定审核池）</button></section><ActivitySection chainId={chainId} hidden={balancesHidden} /><section className="sync-card"><div className="row-between"><span className="flex gap-2 items-center mono micro"><span className="status-dot" />Groth16 · 本地隐私引擎</span><IconButton label="同步隐私资产" disabled={busy || !network.plabs} onClick={() => void sync()}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /></IconButton></div><div className="row-between micro"><span>{busy ? syncStatus?.message ?? '正在同步' : complete ? '已同步至目标区块' : '等待同步'}</span><span className="text-mint">{busy ? `${syncStatus?.progress ?? 0}%` : complete ? '100%' : '—'} {busy && formatEta(syncStatus?.etaMs)}</span></div>{busy && <div className="sync-progress"><span style={{ width: `${syncStatus?.progress ?? 0}%` }} /></div>}<div className="sync-details"><span>可信游标高度: <b className="mono">{current.length ? `#${Math.min(...current.map(item => item.cursorBlock)).toLocaleString()}` : '—'}</b></span><span>{complete ? '区块检查点已验证' : '等待验证'}</span></div><p className="micro text-muted">余额含待确认凭证；可花费金额见资产明细。</p><button className="text-toggle" disabled={busy || !network.plabs} onClick={() => void sync(true)}>余额不一致？重新扫描历史</button></section>{!network.plabs && <Notice>{network.name} 当前仅支持公开资产。</Notice>}</>}{error && <ErrorBox>{error}</ErrorBox>}<AddressCard state={state} privacy={privacy} />{setup && <PrivacySetup initialMode={setup} onClose={() => setSetup(null)} onChange={safeRefresh} />}{unlockOpen && privacy && <PrivacyUnlock privacy={privacy} onChange={safeRefresh} onClose={() => setUnlockOpen(false)} onImport={() => { setUnlockOpen(false); setSetup('import'); }} />}{action && privacy?.unlocked && <ActionPage accounts={state.accounts} key={`${actionVisit}:${action}:${chainId}`} action={action} onActionChange={openAction} onClose={() => setAction(null)} privacyAddress={privacy.privacyAddress ?? ''} publicAddress={state.address ?? ''} writesEnabled={writesEnabled} onSettings={() => { setAction(null); onSettings(); }} snapshots={current} chainId={chainId} onCompleted={() => { safeRefresh(); void sync(); }} />}{keysOpen && <PageView open onOpenChange={setKeysOpen} title="隐私密钥管理" description="本地解密 · 独立会话"><div className="form-stack"><Notice good>隐私密钥仅在本地隐私引擎中使用。当前版本提供加密 Vault 导出，不展示或复制原始密钥。</Notice><Button onClick={() => { setKeysOpen(false); onSettings(); }}><FileKey size={16} />前往凭证备份与导出</Button><Button onClick={lock}><Lock size={16} />立即锁定隐私</Button></div></PageView>}</>;
}

function SettingsHome({ state, onState, onBack }: { state: WalletState; onState: (state: WalletState) => void; onBack: () => void }) {
  const [accountName, setAccountName] = useState(state.accountName ?? ''); const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [walletMinutes, setWalletMinutes] = useState('15'); const [privacyMinutes, setPrivacyMinutes] = useState('15'); const [experimentalWrites, setExperimentalWrites] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyAccountState | null>(null); const [password, setPassword] = useState(''); const [revealedPhrase, setRevealedPhrase] = useState(''); const [secretType, setSecretType] = useState<'mnemonic' | 'privateKey'>('mnemonic');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  useEffect(() => { Promise.all([callWallet<Record<string, boolean>>('GET_PERMISSIONS'), callWallet<LockSettings>('GET_LOCK_SETTINGS'), callWallet<TransactionSettings>('GET_TRANSACTION_SETTINGS'), callWallet<PrivacyAccountState>('GET_PRIVACY_STATE')]).then(([p, locks, tx, privacyState]) => { setPermissions(p); setWalletMinutes(String(locks.walletMinutes)); setPrivacyMinutes(String(locks.privacyMinutes)); setExperimentalWrites(tx.experimentalPrivacyWrites); setPrivacy(privacyState); setLoaded(true); }).catch(cause => setError(errorText(cause))); }, []);
  const options = [{ value: '5', label: '5m' }, { value: '15', label: '15m' }, { value: '60', label: '1h' }, { value: '240', label: '4h' }, { value: '720', label: '12h' }, { value: '1440', label: '24h' }];
  const save = async () => { setBusy(true); setError(''); setMessage(''); try { onState(await callWallet('RENAME_ACCOUNT', { accountId: state.activeAccountId, name: accountName })); await callWallet('SET_LOCK_SETTINGS', { walletMinutes: Number(walletMinutes), privacyMinutes: Number(privacyMinutes) }); await callWallet('SET_TRANSACTION_SETTINGS', { experimentalPrivacyWrites: experimentalWrites }); setMessage('设置已保存'); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const reveal = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { const result = await callWallet<{ secret: string; type: 'mnemonic' | 'privateKey' }>('REVEAL_WALLET_SECRET', { password }); setRevealedPhrase(result.secret); setSecretType(result.type); setPassword(''); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const exportPrivacy = async () => { setError(''); try { const vault = await callWallet<object>('EXPORT_PRIVACY_VAULT'); const url = URL.createObjectURL(new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `plabs-vault-${state.address?.slice(0, 8)}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('加密隐私 Vault 已导出'); } catch (cause) { setError(errorText(cause)); } };
  if (!loaded) return <div className="wallet-shell"><PageHeader title="设置与安全" onBack={onBack} /><main className="page-body">{error ? <ErrorBox>{error}</ErrorBox> : <EmptyState>正在读取设置…</EmptyState>}</main></div>;
  return <div className="wallet-shell"><PageHeader title="设置与安全" subtitle={`${state.networkName} · ${shortAddress(state.address ?? '', 6, 4)}`} onBack={onBack} right={<span className="page-header-spacer" />} /><main className="page-body settings-body"><section><h2 className="section-title"><Settings size={14} />当前账户设置</h2><div className="panel form-stack"><Field label="账户名称" hint="支持中文、数字，长度限制 1–32 字符"><Input value={accountName} maxLength={32} onChange={event => setAccountName(event.target.value)} /></Field><div className="nested-panel"><div className="row-between micro"><span><ShieldCheck className="inline mr-1 text-mint" size={13} />绑定的独立隐私账户 (perc1)</span><span className="tiny-badge">{privacy?.hasAccount ? privacy.unlocked ? '已安全解密' : '已锁定' : '未创建'}</span></div><div className="address-display"><span className="mono break-all micro">{privacy?.privacyAddress ?? '尚未绑定隐私账户'}</span>{privacy?.privacyAddress && <CopyButton compact value={privacy.privacyAddress} />}</div></div></div></section><section><h2 className="section-title"><KeyRound size={14} />隐私密码</h2><div className="panel form-stack"><div className="row-between"><div><strong>修改隐私密码</strong><small>{privacy?.hasAccount ? '验证当前密码 · 保留地址与资产' : '创建或导入隐私账户后可修改'}</small></div><Button size="small" disabled={!privacy?.hasAccount || busy} onClick={() => setChangePasswordOpen(true)}>修改密码</Button></div><p className="micro text-muted">独立于 EVM 钱包主密码，仅修改当前账户的本地隐私 Vault。</p></div></section><section><h2 className="section-title cyan"><Clock size={14} />双独立自动锁定设置</h2><div className="panel form-stack"><div><label className="setting-label"><Lock size={13} />EVM 插件独立自动锁定</label><Segments label="EVM 自动锁定" value={walletMinutes} onChange={setWalletMinutes} options={options} /></div><div><label className="setting-label"><ShieldCheck size={13} />独立隐私账户 (perc1) 自动锁定</label><Segments label="隐私自动锁定" value={privacyMinutes} onChange={setPrivacyMinutes} options={options} /></div><p className="micro text-muted">关闭浏览器将立即锁定全部账户。主钱包与隐私账户按各自解锁会话时长自动锁定。</p></div></section><PaymentModeControl nativeSymbol={NETWORKS[state.chainId].nativeSymbol} /><MergeSettingsControl chainId={state.chainId} /><section><h2 className="section-title amber"><Shield size={14} />实验性主网操作</h2><div className="panel experimental-panel"><Switch checked={experimentalWrites} onCheckedChange={setExperimentalWrites} label="实验性主网操作" /><p>开启后允许 Send、ERC-20 Shield、Monad sUSDC Unshield。</p><ErrorBox>Swap、Ethereum Unshield、原生 ETH Shield 仍未开放。每笔交易仍需预览与最终确认。</ErrorBox></div></section><section><h2 className="section-title"><ShieldCheck size={14} />凭证备份与导出</h2><div className="panel form-stack"><div className="row-between"><div><strong>备份 EVM 恢复凭证</strong><small>需重新验证主钱包密码</small></div><Button size="small" onClick={() => { setError(''); setBackupOpen(true); }}><KeyRound size={13} />备份凭证</Button></div><div className="row-between"><div><strong>加密隐私 Vault</strong><small>导出当前账户的加密 JSON</small></div><Button size="small" disabled={!privacy?.hasAccount} onClick={exportPrivacy}><Download size={13} />导出 JSON</Button></div><p className="nested-panel micro text-muted">导出文件不包含明文隐私 Seed。请另行安全保存隐私密码。</p></div></section><section><h2 className="section-title neutral"><Globe size={14} />已授权网站与权限管理</h2><div className="panel">{Object.keys(permissions).length ? Object.keys(permissions).map(origin => <div className="permission-row" key={origin}><Globe size={18} /><span title={origin}>{origin}<small>连接与已批准的数据读取权限</small></span><Button size="small" variant="danger" onClick={async () => { try { setPermissions(await callWallet('REVOKE_PERMISSION', { origin })); } catch (cause) { setError(errorText(cause)); } }}>撤销</Button></div>) : <p className="micro text-muted">暂无已授权网站</p>}</div></section><section><h2 className="section-title neutral"><Globe size={14} />内置支持网络状态</h2><div className="panel network-list">{Object.values(NETWORKS).map(network => <div key={network.chainId}><span className={`status-dot ${network.chainId === 143 ? 'amber' : ''}`} /><span><strong>{network.name}{network.chainId === state.chainId ? '（当前）' : ''}</strong><small>{network.plabs ? '支持公开与隐私资产' : '公开资产 · 不支持隐私池'}</small></span><span className={`tiny-badge ${network.plabs ? '' : 'neutral'}`}>{network.plabs ? '隐私池已配置' : '仅公开资产'}</span></div>)}</div></section>{message && <Notice good>{message}</Notice>}{error && !backupOpen && <ErrorBox>{error}</ErrorBox>}<Button variant="primary" className="w-full" disabled={busy || !accountName.trim()} onClick={save}>{busy ? '保存中…' : '保存设置'}</Button><SecurityFooter /></main>{changePasswordOpen && <ChangePrivacyPasswordPage walletAddress={state.address ?? ''} onClose={() => setChangePasswordOpen(false)} onChanged={() => { setPrivacy(previous => previous ? { ...previous, unlocked: false, canSync: false, status: 'locked', expiresAt: undefined } : previous); setMessage('隐私密码已修改，请使用新密码解锁，并重新导出 Vault 备份'); }} />}{backupOpen && <PageView open onOpenChange={open => { setBackupOpen(open); if (!open) { setRevealedPhrase(''); setPassword(''); setError(''); } }} title="备份 EVM 恢复凭证" description="请确认周围无人，并离线保存">{revealedPhrase ? <>{secretType === 'privateKey' ? <div className="panel mono break-all text-xs">{revealedPhrase}</div> : <div className="phrase-grid">{revealedPhrase.split(' ').map((word, index) => <div key={index}><b>{index + 1}</b><span>{word}</span></div>)}</div>}<Button className="w-full mt-4" onClick={() => { setRevealedPhrase(''); setPassword(''); setError(''); setBackupOpen(false); }}>隐藏并关闭</Button></> : <form className="form-stack" onSubmit={reveal}><Field label="钱包主密码"><PasswordInput value={password} onChange={setPassword} autoFocus /></Field>{error && <ErrorBox>{error}</ErrorBox>}<SubmitButton busy={busy} disabled={!password}>验证并显示凭证</SubmitButton></form>}</PageView>}</div>;
}

function Dashboard({ state, onState }: { state: WalletState; onState: (state: WalletState) => void }) {
  const [tab, setTab] = useState<MainTab>('wallet'); const [adding, setAdding] = useState(false); const [privacy, setPrivacy] = useState<PrivacyAccountState | null>(null); const [error, setError] = useState('');
  useEffect(() => { setPrivacy(null); callWallet<PrivacyAccountState>('GET_PRIVACY_STATE').then(setPrivacy).catch(cause => setError(errorText(cause))); }, [state.chainId, state.activeAccountId]);
  if (adding) return <WalletSetup onReady={next => { onState(next); setAdding(false); }} onCancel={() => setAdding(false)} />;
  if (tab === 'settings') return <SettingsHome state={state} onState={onState} onBack={() => setTab('wallet')} />;
  return <div className="wallet-shell"><AccountContext state={state} onState={onState} onAdd={() => setAdding(true)} onSettings={() => setTab('settings')} />{error && <ErrorBox>{error}</ErrorBox>}<AssetHome key={`${state.activeAccountId}:${state.chainId}`} state={state} privacy={privacy} onPrivacyChange={setPrivacy} onSettings={() => setTab('settings')} /><ConnectedSiteBar /></div>;
}

function App() {
  const dapp = useDappRequest();
  const [dappPrivacySetup, setDappPrivacySetup] = useState(false);
  useEffect(() => { setDappPrivacySetup(false); }, [dapp.task?.id]);
  const [state, setState] = useState<WalletState | null>(null);
  const [error, setError] = useState('');
  const stateRevision = useRef(0);
  const applyState = (next: WalletState) => { stateRevision.current++; setState(next); };
  useEffect(() => {
    const refresh = () => { const revision = stateRevision.current; return callWallet<WalletState>('GET_STATE').then(next => { if (revision !== stateRevision.current) return; setError(''); setState(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); }).catch(cause => { if (revision === stateRevision.current) setError(errorText(cause)); }); };
    void refresh(); const timer = window.setInterval(refresh, 5000); return () => clearInterval(timer);
  }, []);
  if (error && !state) return <div className="min-h-[600px] w-full bg-canvas"><div className="p-5"><ErrorBox>{error}</ErrorBox></div></div>;
  if (!state || dapp.loading) return <div className="grid min-h-[600px] w-full place-items-center bg-canvas text-sm text-muted">正在读取钱包…</div>;
  const pendingNotice = dapp.task && !['success', 'error'].includes(dapp.task.phase) ? <DappRequestNotice task={dapp.task} refresh={dapp.refresh} /> : null;
  if (!state.hasVault) return <>{pendingNotice}<WalletSetup onReady={applyState} /></>;
  if (!state.unlocked) return <>{pendingNotice}<Unlock state={state} onReady={applyState} /></>;
  if (state.pendingBackupAccountId) return <>{pendingNotice}<WalletBackup key={state.pendingBackupAccountId} accountId={state.pendingBackupAccountId} onReady={applyState} /></>;
  if (dapp.task) {
    if (dappPrivacySetup && dapp.task.phase === 'unlock-privacy') return <PrivacySetup onChange={() => { void dapp.refresh(); }} onClose={() => { setDappPrivacySetup(false); void dapp.refresh(); }} />;
    return <DappRequestView key={dapp.task.id} task={dapp.task} refresh={dapp.refresh} onSetupPrivacy={() => setDappPrivacySetup(true)} />;
  }
  return <Dashboard key={`${state.activeAccountId}:${state.chainId}`} state={state} onState={applyState} />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
