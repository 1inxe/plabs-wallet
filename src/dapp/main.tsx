import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Bell, Check, Code2, Copy, ExternalLink, Fingerprint, Link2, LockKeyhole, RefreshCw, ShieldCheck, Unplug, Wallet } from 'lucide-react';
import { getAddress, hexlify, parseEther, toUtf8Bytes, verifyMessage } from 'ethers';
import { discoverPlabs, type DiscoveredWallet } from './provider';
import { createPlabsWallet } from 'plabs-js-sdk';
import type { DappCapabilities, DappPrivacyResult } from '../shared/dapp';
import '../ui/fonts.css';
import './style.css';

type Log = { id: number; time: string; type: 'request' | 'success' | 'error' | 'event' | 'info'; title: string; body: string };
const serialize = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null';
const short = (value: string) => value.length > 25 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
function Playground() {
  const [wallet, setWallet] = useState<DiscoveredWallet | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [chain, setChain] = useState('');
  const [capabilities, setCapabilities] = useState<DappCapabilities | null>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [logs, setLogs] = useState<Log[]>([]);
  const [message, setMessage] = useState('Hello PLabs!\n这是一条 dApp 消息签名演示，不会发起链上交易。');
  const [signature, setSignature] = useState('');
  const [siwe, setSiwe] = useState('');
  const [login, setLogin] = useState<{ address: string; expiresAt: number } | null>(null);
  const [publicTo, setPublicTo] = useState('');
  const [publicAmount, setPublicAmount] = useState('0');
  const [privateAddress, setPrivateAddress] = useState('');
  const [privateTo, setPrivateTo] = useState('');
  const [privateAmount, setPrivateAmount] = useState('');
  const [privateKind, setPrivateKind] = useState<'send' | 'shield' | 'unshield'>('send');
  const [pool, setPool] = useState('');
  const [allowReal, setAllowReal] = useState(false);
  const [privateResult, setPrivateResult] = useState<DappPrivacyResult | null>(null);
  const [activeCode, setActiveCode] = useState('connect');
  const logId = useRef(0);
  const contextVersion = useRef(0);
  const currentWallet = useRef(wallet); currentWallet.current = wallet;
  const network = capabilities?.networks.find(item => item.chainId === Number(chain));
  const connected = accounts.length > 0;
  const availablePools = network?.pools.filter(item => privateKind === 'shield' ? item.canShield : privateKind === 'unshield' ? item.canUnshield : true) ?? [];
  const addLog = (type: Log['type'], title: string, value?: unknown) => setLogs(previous => [{ id: ++logId.current, time: new Date().toLocaleTimeString(), type, title, body: value === undefined ? '' : serialize(value) }, ...previous].slice(0, 80));
  const resetLogin = () => { contextVersion.current++; setLogin(null); setSiwe(''); setSignature(''); setPrivateAddress(''); setPrivateTo(''); setAllowReal(false); setPrivateResult(null); };
  useEffect(() => discoverPlabs(next => setWallet(previous => previous?.provider === next.provider ? previous : next)), []);
  useEffect(() => {
    if (!wallet) return;
    let active = true;
    addLog('info', '已发现 PLabs Provider', { name: wallet.info.name, rdns: wallet.info.rdns });
    const onAccounts = (value: unknown) => { if (!active) return; const next = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; setAccounts(next); resetLogin(); addLog('event', 'accountsChanged', next); };
    const onChain = (value: unknown) => { if (!active) return; setChain(String(value)); resetLogin(); addLog('event', 'chainChanged', value); };
    const onConnect = (value: unknown) => addLog('event', 'connect（RPC 网络可用）', value);
    const onDisconnect = (value: unknown) => { setAccounts([]); resetLogin(); addLog('event', 'disconnect', value); };
    wallet.provider.on('accountsChanged', onAccounts); wallet.provider.on('chainChanged', onChain); wallet.provider.on('connect', onConnect); wallet.provider.on('disconnect', onDisconnect);
    Promise.all([wallet.provider.request({ method: 'eth_accounts' }), wallet.provider.request({ method: 'eth_chainId' }), wallet.provider.request({ method: 'plabs_getCapabilities' })]).then(([accountList, chainId, caps]) => {
      if (!active) return; setAccounts(accountList as string[]); setChain(String(chainId)); setCapabilities(caps as DappCapabilities);
    }).catch(cause => { if (active) addLog('error', '读取钱包状态失败', String(cause)); });
    return () => { active = false; wallet.provider.removeListener('accountsChanged', onAccounts); wallet.provider.removeListener('chainChanged', onChain); wallet.provider.removeListener('connect', onConnect); wallet.provider.removeListener('disconnect', onDisconnect); };
  }, [wallet?.provider]);
  useEffect(() => { if (!availablePools.some(item => item.address === pool)) setPool(availablePools[0]?.address ?? ''); }, [network?.chainId, privateKind, capabilities]);
  useEffect(() => { if (accounts[0]) setPublicTo(accounts[0]); }, [accounts[0]]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!login) return;
    const timer = setTimeout(() => { setLogin(null); addLog('info', '本地演示登录已过期'); }, Math.max(0, login.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [login]);
  const request = async (method: string, params?: unknown[]) => {
    if (!wallet) throw new Error('未发现钱包，请加载扩展并刷新本页');
    addLog('request', method, params ?? []);
    const result = await wallet.provider.request({ method, ...(params ? { params } : {}) });
    addLog('success', method, result); return result;
  };
  const fail = (label: string, cause: unknown) => {
    const error = cause as { message?: string; code?: number };
    const details = { code: error.code ?? 'CLIENT', message: error.message ?? String(cause) };
    addLog('error', label, details); setToast(`${details.code}: ${details.message}`);
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try { await action(); } catch (cause) { fail(label, cause); } finally { setBusy(''); }
  };
  const connect = () => run('等待连接授权', async () => { const result = await request('eth_requestAccounts') as string[]; setAccounts(result); setToast('钱包已连接。连接不等于登录，也不自动授权交易。'); });
  const disconnect = async () => {
    try { await request('wallet_revokePermissions', [{ eth_accounts: {} }]); setAccounts([]); resetLogin(); setToast('已撤销此站点连接权限'); }
    catch (cause) { fail('断开连接', cause); }
  };
  const signMessage = (cancelDemo = false) => run('等待消息签名', async () => {
    const signer = accounts[0]; const version = contextVersion.current;
    if (!signer) throw new Error('请先连接钱包');
    const content = cancelDemo ? '拒绝流程演示：请在钱包确认页点击“拒绝”。' : message;
    const signed = await request('personal_sign', [hexlify(toUtf8Bytes(content)), signer]) as string;
    if (version !== contextVersion.current) throw new Error('账户或网络已变化，丢弃旧签名结果');
    const recovered = verifyMessage(content, signed);
    if (getAddress(recovered) !== getAddress(signer)) throw new Error('签名恢复地址不匹配');
    setSignature(signed); addLog('success', '消息签名验证通过', { recovered }); setToast('签名验证通过，没有广播交易');
  });
  const signIn = () => run('等待登录签名', async () => {
    const signer = accounts[0]; if (!signer || !chain) throw new Error('请先连接钱包');
    const version = contextVersion.current;
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const issuedAt = new Date(); const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
    const content = `${location.host} wants you to sign in with your Ethereum account:\n${getAddress(signer)}\n\nSign in to the PLabs dApp playground. This does not authorize a transaction.\n\nURI: ${location.origin}\nVersion: 1\nChain ID: ${Number(chain)}\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
    setSiwe(content);
    const signed = await request('personal_sign', [hexlify(toUtf8Bytes(content)), signer]) as string;
    if (version !== contextVersion.current || Date.now() >= expiresAt.getTime()) throw new Error('登录挑战已过期或账户/网络已变化');
    if (getAddress(verifyMessage(content, signed)) !== getAddress(signer)) throw new Error('登录签名无效');
    setLogin({ address: signer, expiresAt: expiresAt.getTime() }); setSignature(signed);
    addLog('success', 'SIWE 格式签名本地验证通过', { address: signer, nonce, expiresAt: expiresAt.toISOString(), serverSession: false });
    setToast('已通过本地登录演示；未创建服务器会话');
  });
  const publicParams = () => ({ from: accounts[0], to: getAddress(publicTo), value: `0x${parseEther(publicAmount || '0').toString(16)}`, data: '0x', chainId: chain });
  const sharePrivacyAddress = () => run('等待隐私地址授权', async () => {
    const version = contextVersion.current;
    const result = await request('plabs_getPrivacyAddress') as { address: string };
    if (version !== contextVersion.current) throw new Error('账户或网络已变化，请重新授权隐私地址');
    setPrivateAddress(result.address); setPrivateTo(result.address); setToast('隐私地址已授权共享，可用来演示转回自己');
  });
  const sendPrivacy = () => run('等待隐私交易两步确认', async () => {
    if (!allowReal) throw new Error('请先确认这是会产生费用的真实交易请求');
    const version = contextVersion.current;
    if (!wallet) throw new Error('请先连接钱包');
    const sdk = createPlabsWallet({ isPlabsWallet: true, request: ({ method, params }) => request(method, params as unknown[]), on: wallet.provider.on.bind(wallet.provider), removeListener: wallet.provider.removeListener.bind(wallet.provider) });
    const params = { chainId: chain as `0x${string}`, poolAddress: pool, amount: privateAmount };
    const result = privateKind === 'send' ? await sdk.privacy.sendTransaction({ ...params, to: privateTo.trim() }) : privateKind === 'shield' ? await sdk.privacy.shield(params) : await sdk.privacy.unshield(params);
    if (version !== contextVersion.current) { setToast('请求结果已记录在 RPC 日志；账户或网络已变化'); return; }
    setPrivateResult(result); setAllowReal(false); setToast(result.state === 'confirmed' ? '隐私交易已确认' : '请求已提交，点击查询状态继续查看');
  });
  const browserNotice = () => run('请求通知权限', async () => {
    if (!('Notification' in window)) throw new Error('此浏览器不支持通知');
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') throw new Error('浏览器通知权限未允许');
    new Notification('PLabs dApp 演示通知', { body: '这是演示网站发出的本地通知，不是钱包授权，也不会签名或转账。' });
    addLog('info', '已发送本地浏览器通知');
  });
  const snippets: Record<string, string> = {
    connect: `// 先通过 EIP-6963 获取选中的 provider\nconst accounts = await provider.request({\n  method: 'eth_requestAccounts'\n});`,
    sign: `const signature = await provider.request({\n  method: 'personal_sign',\n  params: [hexlify(toUtf8Bytes(message)), accounts[0]]\n});\nconst signer = verifyMessage(message, signature);`,
    disconnect: `await provider.request({\n  method: 'wallet_revokePermissions',\n  params: [{ eth_accounts: {} }]\n});\n// 清理网站自己的登录会话与 UI 状态`,
    privacy: `import { getPlabsWallet } from 'plabs-js-sdk';\n\nconst wallet = getPlabsWallet(provider);
await wallet.evm.connect();

const result = await wallet.privacy.sendTransaction({
  chainId: '0x8f',
  poolAddress: '<已支持的资产池>',
  to: 'perc1…',
  amount: '1'
});
// 钱包弹窗确认 → 本地证明 → 最终确认 → 提交
// PLabs 协议专用接口，不是 EVM personal_sign`,
  };
  return <div className="lab-shell">
    <header className="lab-header"><a className="lab-brand" href="#"><span><img src="/icons/plabs-64.png" width="40" height="40" alt="" /></span><strong>PLabs <small>DEVELOPER LAB</small></strong></a><span className="lab-env">本机接入演示 <span className="lab-dot" /></span></header>
    <section className="lab-hero"><div><p className="lab-eyebrow">WALLET × DAPP</p><h1>让网站与隐私钱包<br /><em>真正连接起来。</em></h1><p>从连接、签名登录到交易请求。每个按钮调用真实 Provider，授权由钱包扩展弹窗确认，右侧可查看请求与返回。</p></div><div className="lab-status"><span className={`lab-status-pill ${connected ? 'good' : ''}`}>{connected ? '已连接' : wallet ? '钱包已发现 · 未连接' : '未发现钱包'}</span><h3>{wallet?.info.name ?? '等待 PLabs 扩展'}</h3><p className="lab-mono">{accounts[0] ? short(accounts[0]) : '请在安装扩展的 Chrome 中打开此页'}</p><small>{network?.name ?? '网络待连接'} {chain && `· ${chain}`}</small><div className="lab-button-row"><button className="lab-primary" disabled={!wallet || Boolean(busy)} onClick={connect}><Wallet size={16} />{connected ? '检查连接' : '连接钱包'}</button><button disabled={!wallet} onClick={disconnect}><Unplug size={15} />断开连接</button></div></div></section>
    {!wallet && <div className="lab-notice">先重新加载扩展的 dist，再刷新本页。在钱包内完成创建、助记词备份和解锁。请勿用 file:// 或扩展内部地址打开演示页。<button onClick={() => window.dispatchEvent(new Event('eip6963:requestProvider'))}><RefreshCw size={14} />重新发现</button></div>}
    {busy && <div className="lab-notice active" role="status"><span className="lab-pulse" />{busy} · 请在工具栏 PLabs 插件面板中处理；未解锁会先提示解锁。点击“拒绝 / 取消”才能取消请求。</div>}
    <div className="lab-layout"><main className="lab-main">
      <section className="lab-card"><div className="lab-card-heading"><span className="lab-step">01</span><div><h2>连接与站点权限</h2><p>连接只公开 EVM 地址，隐私地址需单独授权。</p></div><Link2 size={21} /></div><div className="lab-info"><span>当前站点</span><code>{location.origin}</code></div><div className="lab-info"><span>EVM 地址</span><code>{accounts[0] ?? '尚未连接'}</code></div><div className="lab-button-row"><button disabled={!wallet || Boolean(busy)} onClick={() => run('打开钱包', async () => { await request('plabs_openWallet'); })}>打开钱包 / 解锁</button><button disabled={!wallet || Boolean(busy)} onClick={() => run('读取账户', async () => { setAccounts(await request('eth_accounts') as string[]); })}>读取已授权账户</button><button disabled={!wallet || Boolean(busy)} onClick={() => run('查看权限', async () => { await request('wallet_getPermissions'); })}>查看站点权限</button><button disabled={!wallet || Boolean(busy)} onClick={() => run('请求连接权限', async () => { await request('wallet_requestPermissions', [{ eth_accounts: {} }]); })}>请求连接权限</button></div><label className="lab-field"><span>切换网络</span><select disabled={!connected || Boolean(busy)} value={chain} onChange={event => { const value = event.target.value; void run('等待切换网络', async () => { await request('wallet_switchEthereumChain', [{ chainId: value }]); }); }}><option value="" disabled>选择网络</option>{capabilities?.networks.map(item => <option key={item.chainId} value={`0x${item.chainId.toString(16)}`}>{item.name}</option>)}</select></label></section>
      <section className="lab-card"><div className="lab-card-heading"><span className="lab-step">02</span><div><h2>签名与登录</h2><p>验证地址所有权，不广播交易。</p></div><Fingerprint size={22} /></div><div className="lab-login"><span className={`lab-status-pill ${login ? 'good' : ''}`}>{login ? '本地登录验证通过' : '尚未登录'}</span><small>{login ? `有效至 ${timeLabel(login.expiresAt)}` : '连接钱包与登录网站是两个独立步骤'}</small></div><div className="lab-button-row"><button className="lab-primary" disabled={!connected || Boolean(busy)} onClick={signIn}><LockKeyhole size={16} />签名登录</button><button disabled={!login} onClick={() => { setLogin(null); setSiwe(''); addLog('info', '已退出本地演示登录'); }}>退出演示登录</button></div><p className="lab-caption">使用 SIWE 格式消息、随机 Nonce 和 5 分钟有效期。本页只演示浏览器内验证；正式接入需服务端校验 Nonce、域名、时效并创建登录会话。</p>{siwe && <details><summary>本次登录消息</summary><pre>{siwe}</pre></details>}<label className="lab-field"><span>普通签名消息</span><textarea value={message} disabled={Boolean(busy)} onChange={event => setMessage(event.target.value)} rows={3} /></label><div className="lab-button-row"><button disabled={!connected || Boolean(busy) || !message} onClick={() => signMessage()}>发起消息签名</button><button disabled={!connected || Boolean(busy)} onClick={() => signMessage(true)}>体验拒绝请求</button></div>{signature && <details><summary><Check size={13} />签名结果与验证已完成</summary><pre>{signature}</pre></details>}</section>
      <section className="lab-card"><div className="lab-card-heading"><span className="lab-step">03</span><div><h2>公开 EVM 交易请求</h2><p>用零金额转给自己，查看钱包如何展示交易。</p></div><ArrowRight size={21} /></div><label className="lab-field"><span>接收 EVM 地址</span><input value={publicTo} onChange={event => setPublicTo(event.target.value)} placeholder="0x…" /></label><label className="lab-field"><span>原生币数量 · {network?.nativeSymbol ?? 'MON'}</span><input value={publicAmount} inputMode="decimal" onChange={event => setPublicAmount(event.target.value)} /></label><div className="lab-button-row"><button className="lab-primary" disabled={!connected || Boolean(busy)} onClick={() => run('等待交易预览确认', async () => { await request('plabs_previewTransaction', [publicParams()]); setToast('预览已确认，没有签名或广播交易'); })}>打开交易确认预览</button><button disabled={!connected || Boolean(busy)} onClick={() => run('验证公开广播限制', async () => { await request('eth_sendTransaction', [publicParams()]); })}>请求 eth_sendTransaction</button></div><p className="lab-caption">公开交易广播在当前版本禁用，标准请求会返回 4200。预览接口仅展示交易确认效果，不返回伪造的交易哈希。</p></section>
      <section className="lab-card private"><div className="lab-card-heading"><span className="lab-step">04</span><div><h2>隐私资产交易请求</h2><p>网站提交意图，钱包负责选 Notes、生成证明和提交。</p></div><ShieldCheck size={22} /></div><button disabled={!connected || Boolean(busy)} onClick={sharePrivacyAddress}>单独请求隐私地址授权</button>{privateAddress && <p className="lab-address">{privateAddress}</p>}<div className="lab-form-grid"><label className="lab-field"><span>操作</span><select value={privateKind} disabled={Boolean(busy)} onChange={event => { setPrivateKind(event.target.value as typeof privateKind); setAllowReal(false); }}><option value="send">隐私发送</option><option value="shield">Shield 存入</option><option value="unshield">Unshield 提取</option></select></label><label className="lab-field"><span>资产池</span><select disabled={Boolean(busy)} value={pool} onChange={event => setPool(event.target.value)}>{availablePools.length ? availablePools.map(item => <option key={item.address} value={item.address}>{item.symbol}</option>) : <option value="">当前链不支持此操作</option>}</select></label></div>{privateKind === 'send' && <label className="lab-field"><span>隐私接收地址（可用上方授权后的自身地址）</span><input value={privateTo} onChange={event => setPrivateTo(event.target.value)} placeholder="perc1…" /></label>}<label className="lab-field"><span>代币数量</span><input value={privateAmount} inputMode="decimal" onChange={event => setPrivateAmount(event.target.value)} placeholder="请输入数量" /></label><p className="lab-caption">插件会先引导解锁主钱包和独立隐私账户；交易前仍需完成 Notes 同步并开启实验性操作。沿用钱包全局手续费设置，真实费用由钱包确认页展示。</p><label className="lab-check"><input type="checkbox" checked={allowReal} onChange={event => setAllowReal(event.target.checked)} /><span>我理解下面会请求真实交易并产生费用；钱包仍会先后确认操作意图和最终交易。</span></label><button className="lab-primary" disabled={!connected || Boolean(busy) || !allowReal || !pool || !privateAmount || (privateKind === 'send' && !privateTo.trim())} onClick={sendPrivacy}>发起隐私交易请求<ArrowRight size={16} /></button>{privateResult && <div className="lab-result"><strong>{privateResult.state === 'confirmed' ? '已确认' : privateResult.state === 'failed' ? '交易失败' : '已提交 · 等待确认'}</strong><code>{privateResult.txHash ?? privateResult.id}</code><button disabled={Boolean(busy)} onClick={() => run('查询交易状态', async () => { const result = await request('plabs_getTransactionStatus', [privateResult.id]) as DappPrivacyResult; setPrivateResult({ ...result, id: privateResult.id }); })}>查询此网站提交的交易</button></div>}</section>
      <section className="lab-card"><div className="lab-card-heading"><span className="lab-step">05</span><div><h2>通知效果</h2><p>区分网站通知与钱包授权。</p></div><Bell size={20} /></div><div className="lab-button-row"><button onClick={() => { setToast('页面通知演示：真实签名仍需在钱包确认页授权'); addLog('info', '页面通知预览'); }}>页面通知</button><button disabled={Boolean(busy)} onClick={browserNotice}>浏览器通知</button></div></section>
    </main><aside className="lab-sidebar"><section className="lab-card lab-console"><div className="lab-card-heading"><div><p className="lab-eyebrow">LIVE RPC CONSOLE</p><h2>请求与事件</h2></div><button className="lab-link-button" onClick={() => setLogs([])}>清空</button></div><p className="lab-caption">记录本页内存中的请求、返回、错误码和账户/网络变化。</p><div className="lab-logs" aria-live="polite">{logs.length ? logs.map(log => <details key={log.id} className={`lab-log ${log.type}`} open={log.type === 'error'}><summary><span className="lab-log-dot" /><strong>{log.title}</strong><time>{log.time}</time></summary>{log.body && <pre>{log.body}</pre>}</details>) : <div className="lab-log-empty"><Code2 size={24} /><p>点击左侧按钮，查看真实交互</p></div>}</div></section><section className="lab-card"><div className="lab-card-heading"><div><p className="lab-eyebrow">QUICK START</p><h2>接入代码</h2></div><button className="lab-link-button" onClick={async () => { try { await navigator.clipboard.writeText(snippets[activeCode]); setToast('接入代码已复制'); } catch { setToast('无法复制，请手动选择代码'); } }}><Copy size={14} /></button></div><div className="lab-code-tabs">{[['connect', '连接'], ['sign', '签名'], ['disconnect', '断开'], ['privacy', '隐私交易']].map(([value, label]) => <button key={value} aria-pressed={activeCode === value} onClick={() => setActiveCode(value)}>{label}</button>)}</div><pre className="lab-code">{snippets[activeCode]}</pre><a href="https://eips.ethereum.org/EIPS/eip-6963" target="_blank" rel="noreferrer">EIP-6963 钱包发现规范<ExternalLink size={12} /></a></section></aside></div>
    <footer className="lab-footer"><ShieldCheck size={14} />PLabs · 无私钥输入 · 不使用模拟钱包 · 交易由用户在钱包中确认</footer>
    {toast && <div className="lab-toast" role="status"><Bell size={17} /><span>{toast}</span><button aria-label="关闭通知" onClick={() => setToast('')}>×</button></div>}
  </div>;
}
const timeLabel = (timestamp: number) => new Date(timestamp).toLocaleTimeString();
createRoot(document.getElementById('root')!).render(<React.StrictMode><Playground /></React.StrictMode>);
