# PLabs Privacy Wallet

面向 EVM 与 PLabs 隐私资产的 Chrome Manifest V3 钱包原型。

目标架构见 [内置隐私引擎设计](docs/ARCHITECTURE.md)。当前仍是预览版：已实现独立隐私账户、Monad / Ethereum 同步、旧账户恢复，以及受安全开关保护的隐私资产操作。

## 当前能力

- 创建 12 词 EVM 助记词，支持导入有效助记词或 64 位十六进制私钥，本地密码加密保存。
- 支持连续创建或导入多个 EVM 账户、账户切换和重命名；重复地址会拒绝导入。
- PLabs 钱包密码一次解锁全部 EVM 账户；新增账户统一复用该密码，解锁后的账户切换不会再次要求密码。历史上使用不同密码加密的账户需要先重新导入到统一密码模型。
- 每个 EVM 账户绑定独立的 PLabs 隐私 vault、密码和按链同步状态；切换 EVM 账户只会锁定上一账户的隐私会话，不会锁定整个插件。
- 支持 Monad、Ethereum、Base、Arbitrum 的原生余额与切链。
- 通过 EIP-6963 暴露 `PLabs Privacy Wallet`，并提供 `window.plabsPrivacyWallet`；保留 `window.brushPrivacyWallet` 作为兼容别名。
- 支持按站点授权、`personal_sign` 和经确认的切链。
- 主网 `eth_signTypedData_v4`、`eth_sendTransaction` 尚未通过安全验收，当前直接拒绝。
- 创建独立 PLabs 隐私账户，使用不同于 EVM 钱包的密码、seed 和自动锁定会话。
- 在扩展内直接同步 Monad P20 / sUSDC 和 Ethereum sUSDC / sUSDT / sETH，无需本机 Helper。
- 导入官网 vault 时优先读取同一 vault 的加密 `wallet_states`，本地解密和身份校验后迁移 notes 与可信区块游标；没有官网状态时从固定池部署区块恢复。
- 打开并解锁隐私页后自动同步当前网络。同步结果按链和池逐页加密保存，区分可花费、待确认和已花费 notes；中断后从最后一个已验证游标继续。
- 钱包页统一显示公开与隐私资产，默认隐藏零余额资产；支持添加当前链 ERC-20，以及从固定审核列表添加隐私资产。同步期间显示总体进度和基于实际吞吐动态计算的 ETA。
- 隐私 Receive 提供二维码与复制地址。
- 公开资产详情支持 Send：搜索本地 EVM 账户或输入校验后的地址，填写金额、预览 Gas 后最终确认；支持原生币和 ERC-20 转账。公开交易哈希在广播前保存，关闭页面后可重新进入查看待确认状态。
- 隐私 Send 先选择资产，再搜索已绑定隐私地址或输入 perc1 地址，随后填写金额并确认。在本地校验 note/Merkle path/spent 状态并生成 Groth16 证明。
- ERC-20 Shield 使用精确额度授权，Relayer 返回的 calldata 必须与本地证明编码完全一致。
- Unshield 当前仅开放完成固定合约、费用、收款与回执核验的 Monad sUSDC。
- 广播前展示网络、金额、费用、收款方、授权数量和最大 Gas 成本；单次最大 Gas 成本限制为 1 个原生币。
- 解锁会话默认持续 15 分钟（保留已保存的用户设置），可分别配置 EVM 与隐私账户；Chrome 回收 Manifest V3 后台时会从内存型 `storage.session` 恢复，浏览器完全关闭或手动锁定时立即清除。
- 主界面使用 Tailwind CSS，交互控件使用封装后的 Radix UI primitives。

## 暂未开放

- 完整本地 Merkle Tree 快照；当前消费前按 note 从固定 Indexer 获取并验证 frozen path。
- Ethereum Unshield、原生 ETH Gateway Shield。
- Swap：当前 Monad/Ethereum 官网配置没有发布 privacy swap allowlist，不能安全开放动态路线。
- 自定义网络及任意 RPC 写方法。
- 网站发起的主网 Typed Data 签名与公开 EVM 交易广播（钱包内公开资产 Send 已开放）。

隐私 Send / Shield / Unshield 默认由后台安全开关禁止。需要在设置中显式启用“实验性主网操作”；这不等于完成独立安全审计。

## 运行

```bash
pnpm install
pnpm run build
```

在 Chrome 打开 `chrome://extensions`：

1. 打开“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择本项目的 `dist/` 目录。

隐私同步已内置，不需要启动 `brush-helper/plabs`。第一次新建隐私账户时会保存 Monad 和 Ethereum 的可信生日区块，此后从断点继续。旧 vault 优先复用官网加密检查点，没有可用检查点才从池部署区块恢复，不会把导入时间误当成生日区块。

导入官网隐私账户时可点击“从 PLabs 官网读取”。扩展会打开或查找 `app.plabs.online`；再次点击后，扩展只读取当前 EVM 地址对应的加密 vault 和加密钱包状态。隐私密码不会被自动读取，仍需在扩展中输入验证、解密和迁移。

点击钱包页左上账户名称打开账户管理，可切换、添加或导入账户。新账户使用当前钱包密码；隐私资产仍使用独立隐私密码，并在独立解锁后显示和启用操作。

## 开发

```bash
pnpm run dev
pnpm run test
```

当前是预览版，不应存入计划长期持有大量资产的钱包。`pnpm run smoke` 使用全新临时 Chrome 配置验证账户、权限与测试消息签名，不广播交易。`pnpm run test:ui` 在开发服务器上使用独立模拟数据验证 UI，不连接真实钱包。

## 新版界面（Stitch / Figma）

默认扩展宽度为 400px，支持 380–420px 视口；采用设计稿的深灰、翡翠绿、青色与琥珀色层级。字体和 Figma 导出素材均已本地化，无运行时字体 CDN 依赖。

- 完整页面流程：主钱包解锁、创建与备份、助记词/私钥导入、隐私账户创建/Vault 导入、独立隐私解锁、发送、收款、Shield/Unshield、交易预览与结果、设置与凭证备份。
- 真实会话倒计时、公开与隐私地址二维码、复制反馈、金额比例/MAX、地址与余额校验、加密 Vault 文件导入/下载。
- 交易操作始终经过准备证明、预览和最终确认。原有实验性写入开关和资产池限制继续生效。
- 没有可靠价格源时净值显示 `—`，不使用设计稿示例美元金额；同步高度与进度读取实际结果。
- 设计稿中的原始 Viewing Key 导出、钱包数据重置、硬件加速开关尚无完整后端流程，本次未提供这些操作；密钥管理入口通向现有加密 Vault 备份。Swap 保持禁用。

检查方式：`pnpm run build`、`pnpm run test`、`pnpm run smoke`；先运行 `pnpm run dev` 后可执行 `pnpm run test:ui`。浏览器截图保存在 `artifacts/ui/` 与 `artifacts/extension/`。测试用余额只存在于测试脚本中。

## 页面式交互与无报价资产展示

- 账户管理、网络/资产选择、二维码、添加资产、密钥管理、恢复说明和 EVM 凭证备份改为完整页面。返回时恢复上一页的状态、滚动位置和焦点；嵌套选择页不显示底层页面，也不使用遮罩或底部弹窗。
- dApp 连接、签名及隐私交易确认统一在工具栏插件面板内处理，不创建独立窗口或普通标签页。面板固定 400px 宽、600px 高并纵向滚动；主钱包与隐私账户按请求需求依次解锁，解锁后继续原请求。收起面板保留请求，点击拒绝/取消或超时才终止。Chrome 最低版本为 127。
- 隐私首页以实际资产种类、可用代币数量和同步结果为核心，不再使用美元净值占位作为主视觉。价格预言机明确标注待接入，没有假定稳定币价格或模拟收益。
- 支持隐私余额隐藏、零余额筛选，以及资产详情页的完整数量、合约复制和区块浏览器跳转。极小非零余额不会截断成零。
- 添加 ERC-20 前校验 EVM 合约地址；交易准备按钮读取实际实验性操作设置。未开启时提供设置入口，Swap 继续说明未开放原因。
- UI 回归覆盖页面切换、嵌套返回、余额隐藏、无报价展示、实验性操作开关、交易预览与确认分离。扩展回归脚本用于检查钱包弹窗授权、签名和本地凭证备份；不会广播真实交易。

## 修改隐私密码

在「设置与安全 → 隐私密码 → 修改密码」输入当前隐私密码与两次新密码。新密码至少 10 位，包含字母、数字、符号中的至少两类。修改仅针对当前 EVM 账户绑定的本地隐私 Vault，不修改 EVM 主密码或官网密码。

修改会重新加密原 Vault，并用新密码封装原同步数据密钥；两者一起保存，保留原隐私身份、恢复信息与已同步的 Notes。修改成功后清除隐私会话，需用新密码重新解锁。同步或其他钱包操作进行期间不可修改密码。

成功页可直接导出新 Vault。旧导出文件仍由旧密码解密，不会因本地修改密码而失效。忘记当前隐私密码不能通过此功能重置。

## 全局手续费支付方式

「设置与安全」和隐私交易页均可切换「原生币支付 / 隐私资产支付」，立即保存为全局偏好。在 Monad 上原生币为 MON；隐私模式由官网 Relayer 代付 Gas，从支持的隐私代币中支付手续费。Shield 仍需公开账户支付原生 Gas，Unshield 仍限定现有支持的 Monad sUSDC。

手续费读取实际链上池/网关，转账可按网关支持范围选择手续费币种。表单显示费用，最终预览列出总扣除、到账、Gas 支付方及原生 Gas 上限；同币支付的 MAX 预留手续费。Relayer 请求支持持久化、重新进入页面继续查询，不会在结果未知时自动重新发送。

官网接口来源、费用计算与确认约束详见 [支付方式实现说明](docs/PAYMENT-MODES.md)。本轮按要求未运行测试或广播真实交易。

## 隐私 Notes 与合并

点击隐私资产详情可查看 Notes：支持状态筛选、10/20/50 条分页、Confirmed / Spent、数量、树位置及交易链接。支持跨页选择合并，以及将开始时全部已确认的正余额 Notes 自动分批合并到 1 个。

合并输出固定返回自己的隐私地址，沿用全局 Gas 支付方式。执行前显示总费用预算；每批等待交易与新 Note 确认后再继续。可暂停、恢复或停止后续批次，历史已花费 Notes 不删除。详见 [Notes 管理与合并](docs/NOTES-MERGE.md)。

合并设置入口位于 Notes 管理和「设置与安全」。每批可选自动或自定义 2–32 个（默认 9），总选择数量不限于每批大小；超出后分批处理。实际每批数量受钱包、合约与 Relayer 限制，原生模式还需通过实际 Gas 估算。设置修改只作用于新计划。

## 本地操作历史

首页隐私资产列表下展示最近 3 条活动，「查看全部」进入可筛选、分页的历史页面；资产详情通过「操作记录」页签查看该资产历史。记录发送、存入、提取、合并及处理中/确认/失败/需核对状态，详情可复制地址、交易哈希并打开区块浏览器。

本机保留最近 1,000 条已结束操作，未结束操作保留。新活动详情本地加密，查看需独立隐私解锁；未记录的旧字段不伪造。这里仅覆盖本机发起的操作，不包含所有链上收款，也不随 Vault 备份迁移。详见 [本地操作历史](docs/ACTIVITY-HISTORY.md)。

## dApp 接入演示

运行 `pnpm run dev:dapp`，在安装扩展的 Chrome 打开 `http://127.0.0.1:5174/dapp.html`。提供钱包发现、连接/撤销权限、消息签名、SIWE 格式登录演示、网络切换、通知按钮和实时 RPC 日志。

公开交易提供不广播的确认预览；标准 `eth_sendTransaction` 继续返回禁用错误。隐私交易可通过 `plabs_sendPrivacyTransaction` 提交意图，经过钱包两步确认后使用原生 Gas 或 Relayer。详情与接入代码见 [dApp 接入文档](docs/DAPP-INTEGRATION.md)。演示页加载后不会自动签名或发交易。

## 发布图标与上传包

统一使用现有金色 PLabs 标志的圆角版本。工具栏提供 16/24/32/48px PNG；商店图标为 128px RGBA PNG，主体 96px、每边 16px 透明留白。钱包页面、标签页 favicon 与 EIP-6963 识别图标同步更新；EIP-6963 图标直接嵌入 PNG data URI，不依赖 dApp 网站的资源路径。

`pnpm run build` 后运行 `python3 scripts/package-store.py`，生成 `releases/plabs-wallet-extension-<version>-store.zip` 及 SHA-256 文件。上传包排除独立 dApp 演示页。商店图标与宣传图在 `releases/store-assets/`；真实界面截图需另行准备。

### GitHub Actions 与 Release

推送 `main`、提交 PR 或手动运行 **Build and release extension**，会安装锁定依赖、运行单元测试、构建扩展、校验 vendor 文件并上传 ZIP 与 SHA-256 文件为 Actions artifact（保留 14 天）。

发布新版本时，同步更新 `package.json` 和 `public/manifest.json` 的版本号，提交后推送对应标签：

```bash
git push origin main
git tag -a v0.8.1 -m "Release v0.8.1"
git push origin v0.8.1
```

将示例中的版本替换为待发布版本。标签必须与两个文件的版本一致。标签构建通过后，workflow 自动创建 GitHub Release，上传插件 ZIP 和校验文件后发布，无需额外配置 token。已发布版本不会被覆盖；构建失败可修复后发布新版本，临时失败可重新运行对应标签的 workflow。

从 [Releases](https://github.com/1inxe/plabs-wallet/releases) 下载插件 ZIP（不是 GitHub 自动提供的源码压缩包），解压后在 `chrome://extensions` 或 `edge://extensions` 打开开发者模式，选择“加载已解压的扩展程序”，指向包含 `manifest.json` 的目录。此流程发布可安装包，不会自动提交 Chrome/Edge 商店。

## 独立 dApp SDK

`packages/plabs-wallet-sdk` 为本地独立包 `@plabs-wallet/sdk`（0.1.0），基于 Noir Wallet SDK 的 Provider/链级封装结构适配，保留上游来源与 MIT 声明。网站使用 `wallet.connect()`、`wallet.evm.*`、`wallet.privacy.*` 接入。支持 EIP-6963 发现、类型化事件、错误码和参数校验，SDK 无运行时依赖，输出 ESM / CommonJS / TypeScript 声明。

- `pnpm run build:sdk`：编译 SDK。
- `pnpm run pack:sdk`：生成可供外部项目本地安装的 `.tgz`。
- `pnpm run build`：先编译 SDK，再构建扩展和演示页。

演示页已通过 workspace 消费该独立包。SDK 目前未发布 npm，也未创建远端 GitHub 仓库；包名为拟用 scope。详见 [SDK 接入说明](packages/plabs-wallet-sdk/README.md)。

当前活动标签页如果是已授权网站，插件底部会固定展示连接栏（网站图标、域名、网络及账户地址）。可点击查看连接详情、复制地址或一键断开。未连接网站不显示；切换标签页和账户后自动更新，不新增 tabs/history 权限。


## 0.5.2 安全修复

会话撤销、原生交易防重/恢复、journal 加密迁移及请求限额的行为变化见 [修复记录](docs/release-prep/REMEDIATION-0.5.2.md)。新版本仍不是独立审计认证；预编译证明引擎/合约审计和实际场景验证尚未完成。不要将存在未决新格式 journal 的浏览器配置直接降级到旧版。

0.8.0 修复多样化 Note 收款地址恢复，并提供一次连接、记住网站读取授权。见 [Note 修复](docs/NOTE-RECOVERY-0.8.md) 与 [统一授权](docs/READ-CONSENT-0.8.md)。升级时重新加载原扩展目录即可，保留现有钱包和订单恢复记录。

0.8.1 修复 PEX 资金确认后未自动继续挂单的问题；待提交请求与已挂单分开显示。升级说明见 [PEX 资金确认修复](docs/PEX-FUNDING-0.8.1.md)。
