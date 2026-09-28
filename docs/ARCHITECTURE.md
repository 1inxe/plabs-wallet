# 内置隐私引擎架构决策

状态：v0.4 已实现新账户两链同步、Receive，以及默认关闭的实验性 Send / ERC-20 Shield / Monad sUSDC Unshield；旧账户全历史恢复、完整树快照和 Swap 路线仍未实现。

## 产品边界

钱包分为三个模块，不能用一个全能后台对象代替：

1. `EvmKeyring`：公开账户的生成、导入、解锁、EIP-1193 授权、公开资产读写和 Gas 签名。
2. `PrivacyKeyring`：PLabs 独立 seed / 官方加密 vault、隐私地址、view/spend 权限及独立解锁。
3. `PrivacyEngine`：按链和池扫描事件、trial-decrypt、计算 nullifier、维护承诺树、生成证明、广播与恢复。它由协议适配器实现，不直接依赖页面、Helper HTTP 或任意 dApp 请求。

内置意味着 Chrome 扩展自己能够从可信链数据恢复已拥有 notes 并本地构建可验证状态；只把 Helper 的余额 JSON 拷进浏览器不算内置同步。

## 双重解锁

| 状态 | EVM 签名 | 隐私余额 | 隐私证明 / 交易 |
|---|---|---|---|
| 全锁定 | 禁止 | 不显示明文 | 禁止 |
| 仅 EVM 解锁 | 仅可执行已审核的 EVM 操作 | 不解密 notes | 禁止 |
| 隐私查看已解锁 | 不改变 EVM 权限 | 本地同步与显示 | 禁止 |
| 隐私消费已确认 | 仍须交易审批 | 可见 | 单次操作授权；用后撤销 |

- EVM 与 PLabs 的 seed 是不同凭据；不能从 EVM 助记词猜测或静默派生旧 PLabs seed。
- 已有 PLabs 用户导入官方加密 vault 时，须验证绑定 EVM 地址、vault fingerprint 与派生隐私地址；不匹配就拒绝导入，不自动新建账户覆盖旧账户。
- EVM 密码只解锁 EVM 密钥。隐私账户使用独立密码与独立 KDF salt / AEAD key；即使用户手动设成相同字符，也不共享派生密钥。
- 后台扫描只在隐私账户解锁期间运行。导入/解锁时使用 seed 派生 viewing key；隐私密码和 seed 仅在当前浏览器进程的 `chrome.storage.session` 中保留到绝对到期时间，用于 Manifest V3 service worker 恢复，不写入磁盘型 `storage.local`，也不进入 content script、注入页面或外部 RPC 请求。浏览器关闭、手动锁定或到期后立即清除。
- 需要后台扫描时，必须额外解释 view key 泄漏会暴露交易关系，并提供显式 opt-in；初版不做此选项。
- 关闭隐私页、超时、浏览器休眠或扩展更新后销毁内存中的隐私解锁会话；恢复时重新解锁并从已提交游标继续。

## 存储与跨进程通信

- `storage.local` 只保存独立加密 vault 的元数据和加密密文，访问限制为扩展可信上下文。
- 扩展私有 IndexedDB 保存按 `chainId + genesis + pool + privacyAccount` 隔离的加密 notes、链状态、树快照、扫描游标和待处理交易。
- AEAD 附加数据绑定 schema 版本、链、池和隐私账户；游标与 notes 位于同一份经认证密文中。每次写入使用新的 nonce。后续格式迁移必须保留可回滚的上一份已验证快照。
- 网络请求由不持密钥的控制器执行，同步只将公共池交易事件发送给扫描 Worker；扫描 Worker 不实现 `fetch` 等对外通信路径，并用构建检查与审计约束这一边界。普通浏览器 Worker 本身并非操作系统级网络沙箱，不能把这一约定宣传为硬隔离。明文 viewing key 不通过 `window.postMessage` 送到网页；构建证明的独立 Worker 只为经确认的单次意图取得消费材料，用后终止。JS 内存无法承诺物理清零，只能最小化存活时间并终止隔离执行环境。
- 原子提交一个区块完整扫描结果和 block hash；若区块重组或链上根不匹配，回退到最后可信检查点，不能把零散命中的 notes 提前标记为“已完成”。
- Chrome MV3 service worker 可能随时休眠，不可把它当常驻扫描进程；可见的扩展页面托管 Worker，任务暂停后按持久化游标继续。密钥会话断开时，自动任务进入“待解锁”而不是静默重试。

## 链与协议适配

- `ChainAdapter`：RPC 身份、finalized/safe 区块、原生币、ERC-20、nonce 和交易回执。首批为 Monad 143、Ethereum 1；Base 和 Arbitrum 先仅支持普通 EVM。
- `PrivacyProtocolAdapter`：池配置、事件解码、note 扫描、Merkle 树与证明。首个适配器只支持 PLabs 的已确认池；不是任意隐私协议的通用证明引擎。
- 官网当前隐私池仅确认 Monad 与 Ethereum。新增池需要固定配置、源码/链上实现身份与资产映射，不能信任远程页面动态返回的合约、spender 或 calldata。
- 公共 Indexer / portal 只能作为加速提示，不能决定最终余额；状态必须与链上 genesis、区块哈希、root/treeSize、cmx 与 isSpent 对账。旧 Helper 的 Indexer 分页接口会返回 404，不复制这条失效扫描路径。
- 首次同步必须覆盖账户可能接收 note 的完整历史；只能在有可信 birthday checkpoint 时跳过早期区块。以后增量同步、共享公共事件缓存、Worker 批量试解密与分段持久化；RPC 429 时降并发退避，不宣称内置一定比 Node Helper 更快。

## 快速交易但不跳过确认

1. 用户选网络、资产、收款地址和金额；扩展本地做精度、余额、资产归属与费额校验。
2. 构建预览：展示 EVM `chainId / to / selector / value / allowance`，或隐私池、输入 note 数、输出归属和实际手续费。
3. 交易模拟、合约实现校验、账户/链再次核验后，由用户单次确认。
4. 先持久化操作 ID、输入 note 预约、预期输出和广播状态，再本地生成证明。相同账户的 Gas nonce 队列和同池 note 预约都必须串行化。
5. 广播后保存 hash，请求中断时先查链上 receipt / nullifier / 输出 note 再决定是否续跑；不得以超时当失败立即重复签名。

“快”来自预加载验证过的树快照、并发试解密、分批证明与可靠断点，不来自隐藏交易参数、复用过期 root 或绕过用户确认。

## Helper 缓存迁移

1. 正常同步路径已经不依赖 Helper、Helper Token 或 loopback 权限。
2. 后续可选择导入旧 Helper JSON 作为候选 notes；每个候选仍需验证归属、交易区块、链上 cmx、spent 和根。不能导入旧游标就声称完成全历史扫描。
3. 用虚构 seed 的黄金样本持续对比浏览器扫描与 Helper：相同链/池/cmx/nullifier/spent 结果。

## 发布阻断项

- 当前本地 WASM 资源固定为官方 `41df...e016` 版本，JS/WASM SHA-256 分别为 `af01...dcb` / `ac3e...0fe`；其对外再分发许可证仍需 PLabs 书面确认。Chrome MV3 不远程执行官网下载的 JS。
- dApp 任意交易和 Typed Data 仍保持禁用。钱包内部隐私写操作必须经过固定配置、本地证明、模拟、费用上限、预览和实验性安全开关；独立审计前不得移除“预览版/实验性”标识。
- 测试应覆盖 3000+ notes、高延迟、RPC 429、MV3 休眠、页面关闭、锁定、切链、账户切换和重组；记录首次扫描、增量扫描与 proof 的 P50/P95 时间，实测后再设性能目标。

## 参考证据（2026-09-21）

- 官网页面：`https://app.plabs.online/`，当前主 bundle `index-C-AjaNXF.js`。
- 官网公开配置：Monad 143 与 Ethereum 1 有隐私池；Base / Arbitrum 目前只在扩展里作为普通 EVM 网络启用。
- 本地 Helper：`brush/app/brush-helper/plabs/src/engine.mjs` 依赖 Node 文件系统与 worker_threads，`src/prover.mjs` 加载 PLabs WASM。
- Chrome MV3 service worker：`https://developer.chrome.com/docs/extensions/develop/concepts/service-workers`。
- PLabs 多链隔离说明：`https://plabs.gitbook.io/plabs-docs/ecosystem/multichain.md`。
