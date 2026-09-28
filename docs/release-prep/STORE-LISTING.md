# Chrome Web Store 商品资料草稿

以 0.5.2 的代码能力为依据。安全审查未放行，以下是准备材料，不表示可以直接提交正式发布。

## 后台基本字段

- 名称：PLabs Privacy Wallet
- 发布者：待定（用户尚未指定个人/公司）
- 支持邮箱：待定
- 支持网址：待定
- 隐私政策 HTTPS 地址：待定；本目录 privacy-policy.html 是尚未部署的草稿
- 官网：待定；代码依赖 app.plabs.online 不代表发布者已证明其所有权
- 商店主要语言：建议按实际支持能力选择，当前 UI 主要为简体中文
- 费用：扩展下载价格待确认；链上 Gas 与协议/Relayer 费用应单独说明
- 分发地区/Trader 身份：待运营主体确定后填写，不默认勾选全球

## 简短描述

中文：管理 EVM 账户与 PLabs 隐私资产，在钱包内确认网站连接、消息签名和支持的隐私操作。

English: Manage EVM accounts and PLabs privacy assets, with wallet approvals for dApp connections, signatures and supported operations.

## 中文详细介绍

PLabs Privacy Wallet 是一款自托管 EVM 浏览器钱包，可管理公开账户以及 PLabs 协议支持的隐私资产。钱包在本地处理密钥，并通过独立确认页面处理网站请求。

主要功能：

- 创建或导入 EVM 账户，使用主密码加密本地钱包；新建账户完成助记词备份步骤后进入首页。
- 多账户切换，展示公开地址及已创建的隐私地址，支持复制。
- 使用独立隐私密码创建、导入、解锁隐私账户，并导出加密 Vault 备份。
- 查看隐私代币数量、Notes 确认/已花费状态，分页选择 Notes；支持的合并操作受网络、费用和输入数量限制。
- 通过 EIP-1193 / EIP-6963 连接网站，确认 EVM 消息签名，查看和撤销网站权限。
- 在支持的隐私操作中选择原生币 Gas 或隐私资产手续费；是否可用取决于操作、网络和资产池。
- 查看本地操作记录和待核对状态。

当前范围：Monad 与 Ethereum 配置了 PLabs 隐私资产池；Base、Arbitrum 仅提供公开资产相关功能。网站发起隐私交易需要兼容 PLabs 的接入方式，可使用 plabs-wallet-sdk。并非任意 EVM dApp 都能自动执行隐私交易。

请了解当前限制：隐私写操作为实验功能，默认关闭。Swap、网站公开交易广播和结构化签名暂不支持；部分 Shield/Unshield 仅在指定网络/资产可用。价格预言机尚未接入，隐私资产展示代币数量，不提供法币总估值。

密码、助记词和隐私 Vault 备份由用户自行保管。隐私账户具有独立的随机 Seed，仅备份 EVM 助记词不等于已经备份隐私账户。RPC、Indexer 和 Relayer 会接收完成相应功能所需的数据；隐私交易不等于 IP 匿名或不可关联。链上操作可能产生费用且不可撤回。具体数据处理方式见隐私政策。

## English listing

PLabs Privacy Wallet is a self-custodial browser wallet for EVM accounts and privacy assets supported by the PLabs protocol. Keys are handled locally, with separate wallet confirmations for website requests.

Create or import EVM accounts, complete the recovery-phrase backup step, switch accounts, and copy public or private receiving addresses. Create or import a separate password-protected privacy vault, view token quantities and note status, and manage supported note merges within network and fee limits. Connect compatible dApps through EIP-1193/EIP-6963, approve EVM message signatures, revoke permissions, and inspect local operation history.

PLabs privacy pools are configured for Monad and Ethereum. Base and Arbitrum currently provide public-asset functionality only. Privacy requests require a compatible PLabs integration, such as plabs-wallet-sdk. They are not universally supported by EVM dApps.

Privacy writes are experimental and disabled by default. Swap, public dApp transaction broadcasting and typed-data signing are not available. Shield/Unshield support is limited by network and pool. Private-asset fiat valuations are not available. Native Gas or private-asset fee payment is offered only where supported.

Back up your EVM recovery material and your independent encrypted privacy Vault. An EVM recovery phrase alone does not restore the independently generated privacy Seed. Network services receive data needed to perform requests, and privacy transfers do not guarantee network anonymity or unlinkability. Transactions may incur fees and cannot be reversed. See the privacy policy for details.

## 文案禁用项

不要写：已通过独立安全审计、100% 安全、绝对匿名、零数据传输、谷歌认证钱包、支持全部 EVM 隐私 dApps、保证收益、Swap 已上线。当前代码里的“审核配置/固定池”不应在商品介绍中升级为“第三方审计通过”。

## 图片交付与缺口

已存在：`releases/store-assets/icon-128.png`、`promo-440x280.png`、备用 icon-512.png。

新版真实截图仍待补充。现有 artifacts/ui 与用户之前的截图未证明对应当前 370px 版本，不作为新版商店截图交付。也不把宣传设计图伪装成真实运行截图。

建议取得以下真实画面，使用专门演示账户并隐藏余额，不展示助记词、私钥、密码、Vault JSON 或真实客户网站记录：

1. 已解锁首页（展示新底部连接栏；仅连接自有演示网站）。
2. 账户/网络选择页面（公开地址可用演示账户，显示隐私地址时亦如此）。
3. Notes 管理（如无演示数据就不编造余额或确认状态）。
4. dApp 消息确认（停留在确认页，可拒绝，不需实际签名/广播）。
5. 设置与安全（显示独立锁定及隐私 Vault 备份入口）。

商店图片为 1280×800 或 640×400；窗口当前 370×600，保留真实比例放在 1280×800 实色画布上，配简短说明，不拉宽 UI、不拼造交易结果。至少一张截图；需要额外真实运行画面才能完成这项。用户禁止的自动 UI 回归未执行。

来源：
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
