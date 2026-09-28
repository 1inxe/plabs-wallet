import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Globe, Unplug } from 'lucide-react';
import { callWallet } from '../shared/runtime';
import { walletErrorMessage } from '../shared/errors';
import type { ActiveSiteConnection } from '../shared/types';
import { NETWORKS } from '../shared/networks';
import { Button, PageView } from './primitives';
import { CopyButton } from './wallet-design';

export function ConnectedSiteBar() {
  const [site, setSite] = useState<ActiveSiteConnection | null>(null);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedIcon, setFailedIcon] = useState(false);
  const alive = useRef(false);
  const activeTabId = useRef<number | undefined>();
  const activeWindowId = useRef<number | undefined>();
  const currentSite = useRef(site); currentSite.current = site;
  const requestId = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const needsRefresh = useRef(false);
  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) { needsRefresh.current = true; return inFlight.current; }
    const run = async () => {
      do {
        needsRefresh.current = false; const current = ++requestId.current;
        try {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (alive.current && current === requestId.current) { activeTabId.current = tab?.id; activeWindowId.current = tab?.windowId; }
          const next = await callWallet<ActiveSiteConnection | null>('GET_ACTIVE_SITE_CONNECTION');
          if (alive.current && current === requestId.current) setSite(next);
        } catch { if (alive.current && current === requestId.current) setSite(null); }
      } while (needsRefresh.current && alive.current);
    };
    inFlight.current = run();
    try { await inFlight.current; } finally { inFlight.current = null; }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    const invalidate = () => { requestId.current++; setSite(null); setDetails(false); setError(''); void refresh(); };
    const activated = (info: chrome.tabs.TabActiveInfo) => { if (activeWindowId.current !== undefined && info.windowId !== activeWindowId.current) return; activeTabId.current = info.tabId; invalidate(); };
    const updated = (id: number, change: chrome.tabs.TabChangeInfo) => { if (id !== activeTabId.current) return; if (change.status === 'loading' || change.url) invalidate(); else if (change.status === 'complete' || change.favIconUrl) void refresh(); };
    const focused = () => invalidate();
    const storage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.sitePermissions && currentSite.current && !changes.sitePermissions.newValue?.[currentSite.current.origin]) invalidate();
      else if ((area === 'local' && ['sitePermissions', 'activeWalletAccountId', 'walletAccounts', 'selectedChainId'].some(key => changes[key])) || (area === 'session' && changes.walletUnlockSession)) void refresh();
    };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.windows.onFocusChanged.addListener(focused);
    chrome.storage.onChanged.addListener(storage);
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => {
      alive.current = false; requestId.current++; clearInterval(timer);
      chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(updated);
      chrome.windows.onFocusChanged.removeListener(focused); chrome.storage.onChanged.removeListener(storage);
    };
  }, [refresh]);
  useEffect(() => { setFailedIcon(false); setDetails(false); setError(''); }, [site?.origin, site?.tabId]);
  useEffect(() => { setFailedIcon(false); }, [site?.favicon]);
  const disconnect = async () => {
    if (!site || busy) return;
    const target = { origin: site.origin, tabId: site.tabId };
    setBusy(true); setError('');
    try {
      await callWallet('DISCONNECT_ACTIVE_SITE', target);
      if (alive.current) { requestId.current++; setSite(null); setDetails(false); }
    } catch (cause) { if (alive.current) setError(walletErrorMessage(cause)); }
    finally { if (alive.current) { setBusy(false); await refresh(); } }
  };
  if (!site || !site.unlocked || site.pendingBackup) return null;
  const network = NETWORKS[site.chainId];
  const address = site.address ? `${site.address.slice(0, 7)}…${site.address.slice(-5)}` : site.pendingBackup ? '待完成备份' : '钱包已锁定';
  const icon = site.origin === 'https://app.plabs.online' ? '/icons/plabs-64.png' : undefined;
  return <><aside className="connected-site-bar" aria-label="当前活动网站连接">
    {error && <p role="alert" className="connected-site-error">{error}</p>}
    <button className="connected-site-info" onClick={() => setDetails(true)} aria-label={`查看 ${site.host} 的连接信息`}>
      <span className="connected-site-icon">{icon && !failedIcon ? <img src={icon} alt="" referrerPolicy="no-referrer" onError={() => setFailedIcon(true)} /> : <Globe size={17} />}</span>
      <span className="connected-site-text"><strong title={site.origin}>{site.host}</strong><span className="connected-site-account"><span className="connected-site-status"><i aria-hidden="true" />已连接</span><span className="connected-site-divider" aria-hidden="true">·</span><span className="mono" title={`${network.name} · ${site.address ?? address}`}>{address}</span><ChevronRight size={12} /></span></span>
    </button>
    <button className="connected-site-disconnect" disabled={busy} aria-label={`断开 ${site.host} 的连接`} title="断开连接" onClick={disconnect}><Unplug size={16} /></button>
  </aside>
    {details && <PageView open onOpenChange={setDetails} title="网站连接" description={site.host}>
      <section className="panel form-stack"><h2><Globe size={17} className="text-mint" />当前活动网站</h2><p className="mono break-all text-xs">{site.origin}</p><div className="note-summary-row"><span>网络</span><strong>{network.name}</strong></div><div className="note-summary-row"><span>账户</span><strong>{site.accountName ?? '当前账户'}</strong></div>{site.address ? <><p className="mono break-all text-xs">{site.address}</p><CopyButton value={site.address} label="复制连接账户地址" /></> : <p className="micro text-muted">{address}</p>}</section>
      <p className="panel micro text-muted">此网站可查看已授权的公开 EVM 地址并发起请求。消息签名、共享隐私地址和交易仍需在钱包中单独确认。</p>
      <Button variant="danger" disabled={busy} onClick={disconnect}><Unplug size={16} />{busy ? '正在断开…' : '断开当前网站'}</Button>
      <p className="micro text-muted">断开会撤销此网站的连接权限。已经广播的交易不会因此撤销。</p>
    </PageView>}
  </>;
}
