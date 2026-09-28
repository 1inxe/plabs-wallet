# Security Model

> 2026-09-22 更新：0.5.1 的问题保留在 [原始审查](release-prep/SECURITY-REVIEW.md)，0.5.2 的已实现修复、迁移方式与剩余边界见 [修复记录](release-prep/REMEDIATION-0.5.2.md)。以下包含历史设计说明，不作为独立安全审计通过的证明。

## 当前边界

- EVM 助记词使用 PBKDF2-SHA256 600,000 次派生的 AES-256-GCM 密钥加密，密文保存于扩展 `storage.local`。
- EVM 助记词、统一钱包密码和隐私解锁材料仅在解锁期间保存在 `chrome.storage.session` 的浏览器内存区域，并限制为扩展可信上下文；Manifest V3 service worker 被回收后可恢复，内容脚本无法读取。
- EVM 与隐私账户默认在解锁 15 分钟后自动锁定（保留已保存的用户设置），可分别设置为 5 分钟至 24 小时；浏览器完全关闭时 `storage.session` 被清空。手动锁定会清除全部会话；切换 EVM 账户保持插件解锁，但会清除上一账户的独立隐私会话。
- 不使用 `storage.sync` 保存密钥或钱包状态。
- `storage.local` 限制为扩展可信上下文，内容脚本不能读取加密 vault。
- 内置隐私引擎不使用 Helper Token 或 loopback HTTP；新账户同步只访问固定 RPC，密钥不随请求发送。
- 官网导入仅在 `https://app.plabs.online` 内容脚本中只读访问 `privacybtc_wallet/seed_vaults` 与 `wallet_states`。后台只接受与当前 EVM 地址匹配的 vault；同步状态还必须匹配 `vault_id`、`key_fingerprint`、派生隐私地址、固定链 genesis 和固定池地址。扩展不读取密码输入、Cookie、认证 token 或明文 seed。
- 官网 `wallet_states` 只作为加密恢复检查点。它由本地 seed 派生密钥解密，迁移后复查游标区块哈希和每个 note 的链上 spent 状态，再写入扩展独立的 AES-GCM IndexedDB 缓存。
- 无官网检查点的旧账户从固定池部署区块恢复；历史日志优先使用固定 SQD Portal 数据集并由固定 RPC 验证链身份和区块检查点，每页完成后立即加密落盘。
- 隐私同步缓存包含 owned notes、nullifier、确认状态和可信区块游标。这些数据可揭示持仓与交易关联，因此使用独立隐私密码派生的 AES-GCM 密钥加密；其用途是保护本地隐私并允许长同步断点续跑，不是对公开链数据的额外可信来源。
- 自定义公开资产只接受当前链上可读取 `symbol`、`decimals`、`balanceOf` 的 ERC-20 合约；添加资产不产生授权、签名或交易。可添加的隐私资产始终限制在发布时固定审核的池列表内。
- Provider 注入页面只持有请求代理，不包含账户私钥或解密能力。
- dApp 的 `eth_sign`、`eth_sendTransaction`、`eth_signTypedData_v4`、`eth_sendRawTransaction`、网站添加自定义网络和未知写 RPC 默认拒绝。钱包内部隐私写操作使用独立的准备/预览/广播入口，默认安全开关关闭。

## 当前隐私写操作边界

- Send：固定当前链和已知池；输入 note 所有权、Merkle 路径、anchor、cmx、spent 全部核验，本地生成证明。
- Shield：仅固定 ERC-20 wrapped pools；授权恰好为所需额度，USDT 非零旧授权先归零；Relayer calldata 必须逐字节等于本地编码。
- Unshield：仅 Monad sUSDC；recipient 固定当前 EVM 地址，协议费、fee collector、实际 USDC 到账和输入 nullifier 全部复查。
- 隐私账户解锁后，Send / Shield / Unshield 复用当前 `storage.session` 中的解锁会话生成证明，不重复索要密码；会话锁定或到期后，准备和提交都会被后台拒绝。
- 所有操作广播前落盘 journal、串行化 EVM nonce，并设置 1 个原生币最大 Gas 成本上限。
- Swap：当前 Monad/Ethereum 配置无可核验 privacy swap allowlist，保持不可提交。
- 实验性主网操作默认关闭，且尚未用真实资产回归。

## 发布前必须完成

- 为 PLabs 隐私 seed 建立与 EVM vault 独立的加密、密码、解锁会话和访问控制；扫描 Worker 只接收 viewing key，不接收 seed / spend key，消费密钥只在单次授权的独立证明流程中可用。
- 浏览器内置同步使用链身份、已确认 root、Merkle 路径、cmx / nullifier / spent 等事实独立核验；Helper 历史 JSON 不能作为可花费判据。
- WASM 与证明电路的来源、许可证、固定版本和哈希审计；Chrome MV3 不能远程执行官网下载的 JS。

- 第三方依赖锁定、SBOM、许可证和供应链扫描。
- 可复现构建与发布包 SHA-256。
- CSP、host permissions、消息来源、origin 和 iframe 边界审计。
- Vault、签名、Typed Data、交易编码和 nonce 并发测试。
- 独立安全审计和主网灰度限额。
- 自动锁定、审批过期、service worker 终止后的请求恢复。
- 防钓鱼域名提示、地址簿污染防护和交易模拟。

## PLabs 写操作启用门槛

每条链必须固定并验证：

- chain ID、genesis 与 RPC 身份；
- pool、underlying、gateway、relayer 和实现代码；
- selector、calldata 结构、recipient、value 和费用上限；
- note 所有权、Merkle anchor、nullifier 未花费状态和输出归属；
- 广播前操作日志与广播后 receipt/post-state。

任一项无法确认时只允许只读显示，不得提供签名按钮。

## 2026-09-21 只读取证

- PLabs 官网：`https://app.plabs.online/`
- 主 bundle：`/assets/index-C-AjaNXF.js`
- bundle SHA-256：`07cbb7234909f2a7856ae378f421055160a73e5a717c9fe0dad6ef22aea11e71`
- Native RPC / SQD Portal worker SHA-256：`4ca104efbcb67cb445d548e26e67094aeb2dbabb373a957db7070c4682503f54`
- 当前公开配置仅确认 Monad 143 和 Ethereum 1 的 PLabs 池；Base、Arbitrum 只作为普通 EVM 网络启用。
- 官网连接器仍通过 EIP-1193 `window.ethereum` 完成公开钱包连接与 `personal_sign`。
- 本预览版的 Shield 准备阶段调用固定 PLabs Relayer 获取 calldata，但必须与本地编码完全一致；隐私 seed、EVM 私钥和密码不会发送给 Relayer、Indexer 或 RPC。

该结论只覆盖上述版本及当前预览版的只读 PLabs 功能。官网资源或扩展权限变化后必须重新审计。
