# PLabs Privacy Wallet 发布前安全审查

> 此文保留 0.5.1 审查基线。后续状态请看 [0.5.2 修复记录](REMEDIATION-0.5.2.md)，不能将本文原始 OPEN 列表当成新版本未做任何修复。

日期：2026-09-22。对象：本地扩展 0.5.1，370px UI 版本。

**结论：不建议将当前包作为正式资金钱包公开发布。** 可以准备商店草稿，但下列高优先级交易、隐私与供应链问题尚未解决。“实验性操作默认关闭”不是消除风险：用户可以开启它。

这是一轮第一方静态代码审查、依赖公告扫描和归档清点，不是独立第三方审计或安全认证。未运行单元测试、UI 回归、真实扩展回归、漏洞利用、签名或交易；未读取用户钱包存储。代码路径推导出的触发条件未被动态复现。本轮不修改交易实现，避免把未经验证的修补误报为已解决。

## 固定审查对象

- ZIP：`releases/plabs-wallet-extension-0.5.1-store.zip`，84 个文件。
- SHA-256：`151bb5b97d5f4dbd386321fef66de5a9c3ab1eaa9a7ac65a36879cab47778df5`。
- `evidence/source-snapshot.json`：src、public、锁文件和构建配置的逐文件 SHA-256；后续更改使对应结论需要复核。
- `evidence/release-inventory.json`：ZIP 文件清单、哈希和 manifest；未发现 .env、.npmrc、node_modules、私钥文件扩展名或 source map 等可疑文件名。**这是文件清点，不等于所有文件内容均完成秘密扫描。**
- ZIP 未包含 dapp.html；不应上传带有源码的其他 ZIP。

## 发现与处理顺序

| 编号 | 优先级 | 结论 | 对用户及发布者的影响 |
|---|---|---|---|
| H-01 | 高 | 多步骤原生支付在下一次签名前未完整重查会话 | 锁定、切账户或关闭实验开关后，已开始流程仍可能继续，违背用户预期 |
| H-02 | 高 | 普通原生支付未统一进入持久化未决交易恢复/阻塞机制 | 广播结果不明时重试、消耗重复 Gas、Shield 重复存入风险 |
| H-03 | 高（隐私） | journal 保存明文敏感关联字段 | 获取本地扩展数据的攻击者可关联公开账户、隐私收款人、金额、nullifier；不能宣称全量隐私数据加密 |
| H-04 | 发布阻塞 | 预编译证明引擎、电路、字体/设计资源来源与许可链不完整 | 密钥进入未经独立审查的代码；无法证明可重建、安全和完整再分发权利 |
| M-01 | 中 | 明文解锁材料存在可信扩展 session，默认 24 小时 | 扩展上下文或设备失陷时暴露窗口长；不代表任意网站可读取 |
| M-02 | 中 | 不需连接即可代理只读 RPC，缺少限流与超时 | 恶意网页可占用连接、RPC 配额和浏览器资源 |
| M-03 | 中 | 导入隐私 Vault 的 KDF 次数仅有下限 | 恶意导入文件可要求极高 PBKDF2 工作量，卡住解锁 |
| M-04 | 中 | 合约固定地址不等于固定实现/独立合约审计 | 合约漏洞、管理员变更、代理升级及 RPC 信任仍可能影响资金 |
| M-05 | 中 | 默认注入暴露钱包安装特征；链上/服务商元数据可关联 | “隐私付款”不是 IP 匿名，也不是无法追踪的承诺 |
| D-01 | 开发环境 | 工具链 7 条漏洞记录，含 critical/high | 在相关服务器启动条件下影响开发机，进而影响发布供应链；不是 7 个钱包资金漏洞 |

### H-01：最终发送前的会话检查不完整

证据：`src/background.ts:1532` 的 `submitPreparedOperation` 在队列入口检查解锁和网络；`sendWithinReviewedBudget`（约 1579）捕获先前建立的 `signer`，执行估算、余额查询、日志写入后调用 `signer.sendTransaction`。调用的 `authorizeDappOperation`（约 1867）只检查网站权限及 epoch，对钱包内操作直接 return，没有检查主钱包/隐私会话、当前账户、网络或实验开关。

触发推导：Shield 先广播 ERC-20 approval，在 `sent.wait(1)` 等待时锁定钱包；批准确认后继续发送主交易。普通 Send 在异步 RPC 等待期间也有类似窗口。已经广播的交易本来无法被锁定撤回，这里关注的是**后续尚未签名的交易**。Relayer 路径在入口检查后也存在异步落盘/请求前的最终校验缺口。

建议：所有签名和 Relayer 提交入口统一绑定 wallet/account/chain/privacy session epoch；手动锁定、切账户、隐私密码变更时失效；每个等待结束后、签名及广播边界重查。队列中的操作不能保留可绕过撤销的旧 signer。采用可取消的操作状态机明确“已签名”和“已广播”界线。修复后需验证“approval 等待中锁定”和“RPC 等待中锁定”等具体时序；本轮未执行。

### H-02：普通原生交易恢复和防重逻辑不完整

证据：`isUnresolvedPrivacyOperation` 要求 `entry.verification`；普通原生支付 journal 仅在 mergePlanId 存在时写 verification（约 1608）。`pendingRelayerOperation` 使用此谓词，不能覆盖普通 native 操作。`readPrivacyOperationResult` 将非合并条目交给需要 verification 的 `readRelayerResult`。native `preparedOperations` 直到成功才删除；失败 catch 保存状态，但不统一消费准备 ID。dApp 外层 finally 删除 ID 只能缩小同 ID 重试，不能修复新请求或 worker 重启后的恢复。

触发推导：RPC 接收签名交易后断线、回执超时或 worker 重启；界面显示“需核对”，但后台允许新意图。若重试取得后续 nonce，可能重复授权/存款；对相同 nullifier 的隐私花费通常会由合约阻止再次消费，但仍可能损失 Gas。不能直接断言所有转账都会双花。

建议：统一 native/relayer journal 状态机；广播前持久化 nonce、已签交易 hash、不可复用操作标识及加密核验资料。结果未知时阻塞同账户/链的新写入，提供链上核对/替换/明确恢复入口。避免仅靠 UI 提醒防止重复。

### H-03：历史加密未覆盖恢复 journal

证据：`publicOperationVerification`（约 1493）包含 walletAddress、recipient、amountRaw、spentNullifiers、fees、expectedOutputs 和 calldata；`submitRelayerOperation` 将其写入 `chrome.storage.local`。native journal 自身保存 amountRaw。`saveOperationJournal` 保留所有未决条目以及约 100 条近期非未决条目；不只短暂存于内存。`src/privacy/history.ts` 中加密 activity 并不会加密这些平行字段。旧版本 legacy 记录也可保留明文。

攻击前提：本地配置文件、备份泄露，或扩展可信上下文已被攻破；正常 dApp 不能直接读取 storage.local。此问题本身不等于私钥泄露或直接盗币。

建议：加密 verification/金额/收款方，仅保留最小恢复索引。锁定时如需核验，可只查询公开 hash，将需要解密的核对延迟到解锁后。制定旧数据迁移和终态清理规则，明确 metadata 保留。新密码不能让已泄露的旧 Vault 副本失效。

### H-04：证明引擎与再分发证据缺口

包内有预编译 `groth16-prover.bundle.js`、`native-rpc-sync.worker.js`、Rust/WASM glue、WASM、电路 .zkey、7 个字体及设计资源。当前工程不能从上游源码完整重建这些对象；未见完整源码提交、构建参数、可信设置仪式证明、全部许可证与独立审计报告的闭环。

`evidence/binary-assets.json` 记录哈希。已打包的主 WASM/glue、action/binding WASM 与 zkey 均与随附清单匹配。电路清单中的 WASM 上游路径被扁平化，已按实际路径核对；generate_witness/witness_calculator 上游条目未打包，不因此判为哈希篡改。**与同包清单一致只证明一致性，不证明来源可信或电路正确。**

隐私 seed 会传入 prover 作 keys/prove，native scan 路径使用查看材料；不能把整个引擎描述为从不接触消费密钥。压缩 bundle 静态筛查不足以排除隐藏逻辑。CSP 对 Worker/blob 的兼容性、所有证明路径仍未真实扩展验证。

建议：索取准确源码提交、LICENSE/NOTICE、依赖清单、构建配方、制品签名及电路/可信设置资料；建立独立重建或可信来源核验；外部审计覆盖签名边界、证明见证和链上 verifier。`THIRD-PARTY-NOTICES.draft.md` 只收集 npm 生产依赖，不能替代这些材料。

### M-01 至 M-05

- **M-01**：`DEFAULT_LOCK_MINUTES = 24 * 60`；`startWalletUnlockSession` 保存所有已解锁账户 secret 和主密码；隐私 session 保存 seedHex/password。local/session 已限制 TRUSTED_CONTEXTS，这比暴露给 content script 更好，但扩展代码失陷或设备恶意软件仍能获取。建议默认缩至 5–15 分钟、减少原始密码驻留；硬件钱包/隔离签名是后续架构项。保持用户现有设置的兼容迁移。未擅自更改默认值。
- **M-02**：`dispatchDappRequest` 的 READ_ONLY_RPC_METHODS 分支不检查授权，`rpcRequest` 的 fetch 没有 AbortSignal，消息参数整体长度和并发无上限。只读不代表零成本。建议每 origin 配额/并发、总超时、参数大小、日志范围限制，必要时连接后提供高成本 RPC。用户确认弹窗同样要防刷屏。
- **M-03**：`src/privacy/vault.ts:validatePrivacyVault` 对 iterations 只检查 safe integer 与 >=100000；未限制 ciphertext/salt 文件大小。建议兼容官方有效 KDF 范围同时设置上限、导入体积上限和错误提示。仅静态确认缺少上限，未提供或运行恶意样本。
- **M-04**：固定链 ID、池地址、genesis、Merkle path 与 receipt 校验提供部分防护，但未见交易前固定池/网关实现 bytecode hash 或代理升级审核机制。没有链上治理和合约独立审计证据；不能称这些地址为“已独立安全审计”。RPC 链身份也不是 RPC 返回数据完全可信的证明。
- **M-05**：inpage 在匹配的 HTTP(S) 顶层页面宣布 EIP-6963 provider，可检测钱包安装。Indexer 的 merkle_path 请求包含 pool、cmx；RPC 查询/原生 Gas 暴露 EVM 账户及链上行为；Relayer 可观察提交时间、IP 和交易材料。主动授权地址披露仍不能消除这些关联。站点图标也可能发起同源图片请求。建议写入隐私政策并考虑图标代理/本地图标、元数据最小化等后续设计。

### D-01：依赖公告结果

`pnpm audit --prod --json`：73 个依赖计数，0 条已知漏洞报告。
`pnpm audit --json`：280 个依赖计数，critical 1 / high 1 / moderate 5，共 7 条记录；其中同一 advisory 可对应多个包，并非 7 个互不相关 CVE。

- Vitest 2.1.9：UI server 任意文件读取/执行公告 GHSA-5xrq-8626-4rwp，以及 mocker 路径穿越公告 GHSA-82fw-gwwq-j7x9。
- Vite 5.4.21：优化依赖 sourcemap 路径穿越；Windows 路径 deny 绕过、UNC/NTLM 问题。Windows 特定条件不应套用为本 macOS 已被利用。
- esbuild 0.21.5：开发服务器跨站访问响应公告。

证据附完整公告 URL、依赖路径、修复版本。建议成组升级兼容的 Vite/plugin-react/Vitest/esbuild 并重新构建，避免只强制覆盖内部传递依赖。本轮未升级，也未启动 Vitest UI；现有本机 dApp 开发服务器不等于 Vitest UI。扫描会向 npm 审计服务发送依赖元数据，不发送钱包存储。0 prod 公告不覆盖供应链后门、预编译资源和逻辑漏洞。

## 已观察到的保护

PBKDF2-SHA256 600000 次、AES-GCM、随机盐/nonce；公开与隐私 Vault 独立；网页地址源自 Chrome sender 而非网页自报；仅 HTTPS/本机站点可发起请求；manifest 不注入 iframe；签名与隐私地址共享独立审批；链/账户/授权 epoch 在多个关键入口检查；禁用 eth_sign、网站原始广播、typed-data、公开交易发送；固定池、Merkle/已花费状态/费用及回执核验；异常不伪造成功 hash；JS/WASM 主要按扩展本地 URL 加载。上述是局部防护，不覆盖前述缺口。

## 发布门槛（建议）

1. 优先完成 H-01/H-02 的后台撤销与幂等设计，确认恢复流程；H-03 完成加密迁移。
2. H-04 取得供应链及再分发材料，合约/证明引擎独立审计范围明确。
3. 修复导入 DoS、RPC 限流及开发工具漏洞，评估会话默认时长。
4. 填实发布主体、邮箱、地域、服务端日志保存策略；上线与行为一致的隐私政策。
5. 新制品使用新版本和哈希重新登记；先受限分发/小范围试用，不能以“上架成功”宣称资金安全审计通过。
6. 用户当前不要求运行的安全场景验证保持“未验证”；不得把文档中的验证建议写成已通过。

所有发现目前均为 OPEN；没有把建议当作已经修复。
