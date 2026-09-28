# 隐私钱包 dApp 接入方案对照

核对日期：2026-09-22。这里的 Noir Wallet 指 Zcash 钱包产品，而不是 Noir 编程语言。

## Noir Wallet

Noir 官方公开 `@noir-wallet/sdk`，是注入 Provider 的 TypeScript 包装。`wallet.zcash.connect()` 获取用户授权的账户，`wallet.zcash.sendTransaction({ to, amount, fundingSource: 'shielded' })` 请求隐私资金转账并在钱包中确认。其地址、金额、交易构建及签名语义属于 Zcash，无法直接代替 PLabs EVM 隐私池的证明和交易构建。

其身份消息签名是独立能力：文档区分 current、derived 和 legacy_index0 身份。这不意味着任意隐私协议共用一套匿名登录或隐私交易签名格式。

来源：
- https://docs.zknoir.com/noir-sdk-integration/
- https://docs.zknoir.com/developers/provider-api/
- https://docs.zknoir.com/wallet-guide/dapps/

## 可复用的通用层

- EIP-6963 / EIP-1193：钱包发现、request API 和事件；不能替代私有资产协议的证明、授权和交易语义。
- WalletConnect：会话、传输、链/方法/事件授权协商。可以承载钱包支持的自定义请求，但双方仍需实现并同意具体方法。接入 WalletConnect 不会自动让任意 EVM dApp 支持 PLabs 隐私交易。
- Aztec Wallet SDK：Aztec 生态的钱包发现、加密信道、能力权限与交易接口。依赖 Aztec 执行和证明模型，不是现有 Monad/Ethereum PERC-20 的直接替换件。

来源：
- https://eips.ethereum.org/EIPS/eip-6963
- https://eips.ethereum.org/EIPS/eip-1193
- https://github.com/WalletConnect/walletconnect-specs/blob/main/docs/specs/clients/sign/namespaces.md
- https://docs.aztec.network/developers/docs/tutorials/js_tutorials/webapp/wallet-sdk

## 当前实现与建议

保留 EVM 的标准发现/连接和消息签名；通过 `wallet.privacy.*` 暴露 PLabs 自有的隐私能力，并发布明确的请求/结果与错误类型。网站只提交意图，由扩展弹窗批准，钱包内部选 Notes、生成证明并按指定支付路径提交。禁止把隐私发送伪装为 personal_sign 或使用 eth_sendTransaction 自动解释为匿名交易。

当前已实现 PLabs 自定义隐私发送/Shield/Unshield 请求及查询、两步确认和本地 SDK 包装。当前未接入 WalletConnect、Noir Wallet SDK 或 Aztec Wallet SDK，也没有实现独立隐私身份登录、通用隐私合约调用或仅返回签名不提交的 signPrivacyTransaction。

本轮仅修改弹窗与 SDK 代码并编译打包，未运行自动测试，未签名或提交真实链上交易。

## 本地 SDK 适配包

现已将 Provider/链级封装独立为 `packages/plabs-wallet-sdk`（`@plabs-wallet/sdk` 0.1.0），来源固定为 Noir Wallet SDK 0.1.9 的提交 `19e0aec93187e1679e1cbb44b2cd825a8c0a1662`。这是源代码结构的本地适配，不是调用 Noir 的运行时 SDK。上游 MIT 声明及来源保存在包内，Zcash 相关请求替换为 PLabs 实际支持的请求。尚未创建远端仓库或发布 npm。
