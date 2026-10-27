export const NFT_TRANSPORT_RULE_ID = 721;

/** The intake service accepts native clients without webpage origin metadata. */
export function nftTransportRule(extensionId: string): chrome.declarativeNetRequest.Rule {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('NFT 扩展标识无效');
  return {
    id: NFT_TRANSPORT_RULE_ID,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      requestHeaders: [
        { header: 'origin', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
        { header: 'referer', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
      ],
    },
    condition: {
      initiatorDomains: [extensionId],
      regexFilter:
        '^https://app[.]plabs[.]online/nft-intake/v1/(reserve|whitelist/check|jobs/[a-zA-Z0-9_-]+/permit)$',
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
      requestMethods: [chrome.declarativeNetRequest.RequestMethod.POST],
    },
  };
}
let ready: Promise<void> | undefined;
export function ensureNftTransport(): Promise<void> {
  ready ??= chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [NFT_TRANSPORT_RULE_ID],
      addRules: [nftTransportRule(chrome.runtime.id)],
    })
    .catch(() => {
      ready = undefined;
      throw new Error('NFT 连接规则初始化失败，请重新加载新版钱包后重试');
    });
  return ready;
}
