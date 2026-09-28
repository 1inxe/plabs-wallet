# PLabs Privacy Wallet

[English](README.md) | **简体中文**

用于管理 EVM 账户和 PLabs 隐私资产的 Chrome 扩展。钱包在本地加密保存，隐私资产同步直接在扩展内完成。

- 管理多个 EVM 账户，在 Monad、Ethereum、Base 和 Arbitrum 上发送原生币或 ERC-20 代币。
- 为每个 EVM 账户创建或导入使用独立密码的隐私账户。
- 同步 Monad 和 Ethereum 上的 PLabs 隐私资产，接收、发送、存入和合并支持的资产。
- 连接 dApp、签署消息，并批准对选定隐私数据的访问。

[Web 应用](https://github.com/1inxe/plabs-network) · [JavaScript SDK](https://github.com/1inxe/plabs-js-sdk)

## 构建与安装

环境要求：Node.js 22、pnpm 9.15.4，以及 Chrome 127 或更新版本。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

1. 打开 `chrome://extensions`，启用“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择生成的 `dist/` 目录。
3. 将 PLabs Privacy Wallet 固定到工具栏并打开。

修改源码后重新构建，并在 `chrome://extensions` 重新加载扩展。刷新已连接的网站，使其加载更新后的 provider。

## 设置钱包

1. 创建钱包，或导入助记词/私钥。
2. 设置钱包密码，备份设置过程中展示的恢复材料。
3. 使用账户菜单添加、导入、重命名或切换 EVM 账户。各账户共用钱包密码。
4. 打开 **Privacy assets**，创建独立隐私账户或导入加密 Vault，并设置或输入独立的隐私密码。

从 PLabs 官网导入时，选择“从 PLabs 官网读取”。打开 `app.plabs.online` 后，再次选择该操作，读取与当前 EVM 地址关联的加密 Vault。在扩展中输入隐私密码以在本地解密。

解锁隐私资产后开始同步所选网络。新账户从保存的创建区块开始；导入账户从已验证检查点继续，或从池部署区块扫描。无需本地 Helper 服务。

## 使用资产

- **Receive：**复制公开或隐私地址，或展示二维码。使用发送方所需的地址类型。
- **Send：**打开资产，输入收款方和金额，复核网络与费用后确认。
- **Shield：**将支持的公开 ERC-20 代币存入隐私池。公开账户需要原生 Gas。
- **Unshield：**提取到当前 EVM 账户。目前仅支持 Monad sUSDC。
- **Notes：**打开隐私资产详情，查看可花费/待确认 Notes，并分批合并选中的 Notes。
- **Activity：**在钱包中查看交易状态和哈希。普通 Vault 导出不包含本地历史与 PEX 恢复记录；存在未完成操作时，请保留扩展存储。

设置中提供自动锁定、隐私密码修改、加密 Vault 导出及 Gas 支付偏好：原生币，或通过 Relayer 使用支持的隐私资产。修改密码后请导出新 Vault；旧导出文件仍使用旧密码。

隐私写操作需要在设置中启用“实验性主网操作”，并仍受支持池和钱包确认限制。Swap 和 Ethereum Unshield 尚不可用。网站发起的 `eth_sendTransaction` 与 `eth_signTypedData_v4` 被禁用；钱包内部支持发送公开资产。参见[安全边界](docs/SECURITY.md)。

## 开发与 dApp 接入

```sh
pnpm run dev        # UI 开发服务器
pnpm run dev:dapp   # dApp 示例：http://127.0.0.1:5174/dapp.html
pnpm run build     # TypeScript 检查与生产构建
```

安装的扩展从 `dist/` 运行，不从开发服务器运行。dApp 示例使用真实注入的 provider，需要安装并解锁扩展。连接、读取权限与交易请求见[接入指南](docs/DAPP-INTEGRATION.md)。

`src/` 包含扩展与示例；`public/` 包含 manifest、运行时图标、字体和证明资源。`vendor/` 中固定的 SDK 包支持独立安装，无需在同级检出 SDK 仓库。

修改 README 时请同步更新英文和中文版本。

## 许可与隐私

本仓库尚未声明仓库级许可证。第三方组件保留各自许可证，见[许可说明](LICENSING.md)和[第三方声明](THIRD-PARTY-NOTICES.md)。[隐私政策草稿](docs/privacy-policy.html)说明数据处理方式，目前尚非已生效的公开政策。
