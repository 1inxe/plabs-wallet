# 网站隐私数据授权协议（扩展 0.6.0 / SDK 0.2.0）

> 以下是旧版会话授权协议。0.8.0 的统一连接及加密记住授权见 [READ-CONSENT-0.8.md](READ-CONSENT-0.8.md)。

本站连接仍先走 EIP-1193 公网账户授权，再明确请求隐私地址。余额/历史/Notes/订单需要独立读权限，资金写操作维持原有两次确认。

| RPC | 行为 |
| --- | --- |
| plabs_requestPrivacyAccess [{scopes}] | 在插件显示网站、隐私地址、网络与数据范围；增量授权 |
| plabs_getPrivacySession | 无弹窗读取已授权的地址与 scopes；未授权不返回地址 |
| plabs_revokePrivacyAccess | 撤销并触发 privacySessionChanged，取消该来源待审批请求 |
| plabs_getBalances | 当前链公网资产 + 钱包已有同步快照；未扫描为 null |
| plabs_getHistory [{page,pageSize,poolAddress?}] | 钱包操作日志 + 收到的 note 输出摘要；有完整性标记 |
| plabs_getNotes [{page,pageSize,poolAddress?}] | 只读 note 金额/状态/交易引用，永不返回 opening/nullifier/view key |
| plabs_getDexOrders | 由扩展使用导入的订单 ID 读取官网 Matcher 状态 |
| plabs_importOfficialDexOrders | 用户确认后，从原官网当前账户的 localStorage 读取 display-only 订单引用 |

scope 为 address / balances / history / notes / dexOrders。授权绑定 origin、EVM 账户、privacy address、chain ID、站点 permission epoch 和隐私解锁到期时间。锁定、切链、撤销或切换隐私身份使授权失效。异步返回前复验上下文。

授权仅意味着该网站可以看到所选数据，并不意味着这些数据仍对该网站隐藏。地址+余额+交易记录会形成身份关联，审批文案必须明确；网页不读取 seed、IVK/NK/OVK、原始 notes、资金签名或订单 capability。

隐私状态是已扫描数据，不是按地址向远端查一个余额。前端显示 total/spendable/pending 与 syncedAt；未同步返回 null，不伪装为 0。历史无法凭空重建旧版未保存的 outgoing metadata；收到的 notes 可能包含找零，页面明确标注。

PEX 引用保存在扩展本地 AES-GCM 密文里。导入仅复制 ID、方向、数量、价格、时间及 matches epoch，不复制原官网的 account_S、match_capability、vnote/feeTicket。后端状态通过固定 https://app.plabs.online/dex-matcher/healthz 和 POST /orders/status 查询。非当前 epoch 的订单标注 previous-epoch；不把失踪订单判定为完成/取消。

该版本仍不具备 DEX 下单、match settlement、撤单后的私密资金回收能力。新协议没有伪造这些能力。新版 UI 必须读取 capabilities，而不是只检查版本号。

测试：权限隔离/撤销/竞态、DTO 白名单、订单引用校验；真实扩展独立测试 profile 通过导入临时测试 Vault 检查 SDK bridge，未签名或广播资金交易。

## 0.6.1 授权窗口修复

浏览器拒绝 chrome.action.openPopup 时，改用扩展自身 popup.html 的独立确认窗口。通过 runtime.getContexts 识别自己创建的窗口，不申请读取用户所有标签页的 tabs 权限；待处理请求可以重新聚焦该窗口，避免重复创建。

网页在按钮旁显示检查版本、等待确认、拒绝/不支持等反馈；等待授权不再阻止重新打开钱包。扩展重载导致 content-script runtime.sendMessage 同步报错时，返回断线错误，不让网页 Promise 永远等待。

开发验证：先启动同级 plabs-network 的 pnpm dev，然后运行 pnpm test:privacy-approval-ui。此脚本使用临时独立浏览器 profile 和生成的测试 Vault，强制模拟工具栏弹窗失败，通过实际插件确认 UI 检查拒绝、重试、解锁和授权读取。不会读取用户现有钱包或执行资金交易。
