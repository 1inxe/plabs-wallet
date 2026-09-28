# 权限、数据流和隐私实践填报草稿

依据 public/manifest.json 与当前代码。填报前应核对生产后端日志策略，不能仅依据客户端代码保证服务商不留存数据。

## Single purpose（可粘贴）

Provide a self-custodial EVM wallet for managing accounts and supported PLabs privacy assets, including user-approved dApp connections, message signatures and privacy operations.

## 权限用途（可粘贴）

| 权限 | 英文说明 |
|---|---|
| storage | Store encrypted wallet vaults, settings, site permissions and operation records locally. Keep unlock material in trusted extension session storage while unlocked. Sensitive note state is encrypted in extension IndexedDB; minimal recovery indexes remain unencrypted; legacy sensitive records migrate when the corresponding privacy account is unlocked. |
| alarms | Schedule main-wallet and independent privacy-session expiration and clear unlock sessions. |
| offscreen | Run the packaged privacy engine and local proof/synchronization workers in an extension offscreen document, independently of the popup's lifetime. |
| scripting | Re-inject the packaged content bridge into an already-open app.plabs.online tab when necessary for a user-initiated import of matching encrypted privacy Vault/checkpoint records. |
| HTTP(S) content scripts | Make the wallet provider discoverable to dApps and bridge their requests to the extension. Injection is restricted to top-level frames. Sensitive operations are authorized by the wallet; requests are accepted only from HTTPS sites or localhost development origins. Site origins are used for connection UI; icons shown by the connection bar are local. |
| RPC host permissions | Read public chain state, balances, contract information and receipts, estimate fees, verify network identity, and submit signed transactions after wallet confirmation. |
| app.plabs.online | User-initiated read of matching encrypted privacy Vault/checkpoint data from the official site's local IndexedDB. This is not a read of cookies or password fields. |
| PLabs Indexer hosts | Retrieve Merkle paths and frozen-leaf data for supported pools. Merkle requests include pool addresses and note commitments, which can expose correlations to the service. |
| PLabs Relayer hosts | Obtain fee policy and supported transaction data, submit approved proof/transaction material, and query operation status. Shield calldata requests include the public depositor address and amount. |
| portal.sqd.dev | Retrieve historical public chain events for local note scanning and recovery. |

没有 tabs/history/cookies/debugger 权限；使用 chrome.tabs 的部分 API 不意味着申请了 tabs 读取权限。不要因此声称完全不读取当前网站信息。

## 远程代码声明草稿

No remotely hosted JavaScript or WebAssembly is intentionally executed by the extension source reviewed here. The privacy engine, workers, WASM modules and proving artifacts are packaged with the extension. Network requests obtain chain data, Merkle paths, fee information and transaction responses. `wasm-unsafe-eval` enables packaged WebAssembly execution; it is not permission to fetch arbitrary remote JavaScript.

注意：声明须在 H-04 的预编译 bundle 及全部运行路径复核后最终确认。当前静态检查不是证明所有不透明代码无远程执行行为。

## 数据清单

| 数据 | 保存/发送地点 | 用途/边界 |
|---|---|---|
| EVM 助记词/私钥、主密码 | Vault 密文在 storage.local；解锁时材料在可信 session/内存 | 本地账户派生、签名；未在已审查的 TS 发送路径发现上传这些秘密 |
| 隐私 Seed、隐私密码 | 独立 Vault 密文；解锁材料在 session/prover | 本地解密、证明；不是由 EVM 助记词自动恢复 |
| EVM/隐私地址、账户名称 | 扩展本地元数据；授权地址给网站；公开账户用于 RPC | 账户地址元数据本地明文存储；交易中的敏感收款关联资料加密，共享隐私地址另行确认 |
| Notes、余额、消费状态 | 加密 IndexedDB；查询派生请求发往链/Indexer | Indexer 可见被查询 cmx；不等同发送整份明文 Notes 数据库 |
| 操作记录 | 本地 journal/历史 | 新 activity 和 recovery 详情加密；旧记录解锁后迁移，最小恢复索引仍明文 |
| Origin、站点标识 | 本地授权列表/连接 UI；使用本地图标 | 未使用 history API 读取完整浏览历史；所有顶层页面可检测 provider |
| 签名原文和签名结果 | 钱包 UI/内存，结果返回请求网站 | 文本可能含登录信息或用户输入，网站处理受其自身政策约束 |
| 链上交易、证明、池、金额/费率、公开存款账户 | RPC/Relayer/区块链 | 因操作不同而异；公开链数据无法通过卸载删除 |
| IP、请求时间、HTTP 元数据 | 实际连接的服务端、CDN/RPC | 客户端无法保证其日志不留存；期限、地域、控制者待确认 |

## Chrome 隐私实践勾选建议

后台标签及定义可能调整，以提交时字段解释为准。不要一键勾选“不收集任何数据”。本地处理与向服务端收集应分别说明；以下是审慎填报建议，而非已经替你认证：

- Authentication information：说明本地钱包密码/密钥处理，网站签名；核对后台是否将只在本地处理纳入其定义。
- Financial and payment information：链上账户、交易、金额与手续费确实参与网络请求，应披露。
- Web history / User activity：授权 origin、当前网站、钱包操作会被处理，不是整段历史或任意点击追踪；按后台定义核对选项并写清范围。
- Website content / User-provided content：网站提交的签名/交易内容、官网加密 Vault 导入等内容有处理，核对后台类别。
- Personally identifiable information：IP/支持联系方式可能涉及此类；先确认你控制的后端收集及保留方式。
- Health / personal communications 等：没有证据支持全面收集，不应随意声明这些类别；但自由文本签名可能包含用户自行提交的信息。

“没有广告或分析 SDK”可作为此次源代码观察；“服务端绝不记录 IP”“从不对外共享任何数据”不能由本次审查得出。

## Limited Use 承诺模板（需经营者确认实际遵守）

We follow the Chrome Web Store User Data Policy and its Limited Use rules when using or sharing information obtained through Google APIs. Data accessed by the extension is used to provide its stated wallet functionality, not for advertising, sale of personal data, or unrelated creditworthiness decisions.

这是待落实的运营承诺，不是对未经审查的后端行为的审计结论。广告/出售/用途限制要与所有服务商协议及日志用途一致。

官方依据：
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/privacy
- https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
- https://developer.chrome.com/docs/webstore/program-policies/policies
