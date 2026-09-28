/** Open one trusted approval surface, including browsers where action.openPopup is unavailable. */
export function createWalletWindow(deps: {
  runtime: Pick<typeof chrome.runtime, 'getContexts' | 'getURL'>;
  action: Pick<typeof chrome.action, 'openPopup'>;
  windows: Pick<typeof chrome.windows, 'create' | 'get' | 'update'>;
  tabs: Pick<typeof chrome.tabs, 'update'>;
}) {
  let fallbackId: number | undefined;
  let fallbackTabId: number | undefined;
  let opening: Promise<boolean> | undefined;
  const url = deps.runtime.getURL('popup.html');
  async function focusFallback() {
    if (fallbackId === undefined) return false;
    try {
      // Tab URLs may be omitted without the broad tabs permission. Runtime contexts can
      // identify our own packaged page without granting access to the user's tabs.
      const contexts = await deps.runtime.getContexts({ documentUrls: [url], windowIds: [fallbackId] });
      const ownContext = contexts.find(context => context.documentUrl === url && context.tabId >= 0);
      if (ownContext) fallbackTabId = ownContext.tabId;
      else {
        const window = await deps.windows.get(fallbackId, { populate: true });
        const ownTab = window.tabs?.find(tab => tab.url === url || tab.pendingUrl === url);
        if (!ownTab?.id) throw new Error('Wallet window was replaced');
        fallbackTabId = ownTab.id;
      }
      await deps.windows.update(fallbackId, { focused: true });
      await deps.tabs.update(fallbackTabId, { active: true });
      return true;
    } catch { fallbackId = undefined; fallbackTabId = undefined; return false; }
  }
  async function open() {
    if (await focusFallback()) return true;
    try {
      const contexts = await deps.runtime.getContexts({ contextTypes: ['POPUP' as chrome.runtime.ContextType] });
      if (contexts.some(context => context.documentUrl?.startsWith(url))) return true;
      await deps.action.openPopup();
      return true;
    } catch {
      // Only our packaged wallet page is allowed. No dApp-supplied URL is ever opened.
      try {
        const window = await deps.windows.create({ url, type: 'popup', width: 420, height: 720, focused: true });
        if (window?.id === undefined) return false;
        fallbackId = window.id; fallbackTabId = window.tabs?.[0]?.id;
        return true;
      } catch { return false; }
    }
  }
  return { open: () => {
    if (!opening) opening = open().finally(() => { opening = undefined; });
    return opening;
  } };
}
