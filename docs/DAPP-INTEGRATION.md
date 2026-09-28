# dApp 接入与手动演示

## 打开演示

1. `pnpm run build`，在安装扩展的 Chrome 重新加载 `dist`。
2. `pnpm run dev:dapp`，打开 http://127.0.0.1:5174/dapp.html 。扩展更新后刷新此网页。
3. 先在钱包完成创建/导入、助记词备份与解锁；演示页「打开钱包 / 解锁」也可展开工具栏插件面板。
4. 点击「连接钱包」，在钱包确认页允许。
5. 点击消息签名、签名登录、拒绝请求、切换网络、断开连接等按钮，观察钱包页面和网页右侧 RPC 日志。

这是普通网站页面，完全通过注入 Provider 调用，不使用 chrome.runtime，也不内置假钱包、私钥或模拟成功结果。开发服务与扩展目录同在一个工作区，但请求来源仍是 HTTP 网站，会经过真实站点权限检查。构建后的 dapp.html 也可以随 dist 静态托管在 HTTPS 或本机 HTTP 服务上；不能直接通过 file:// 或 chrome-extension:// 使用发现钱包流程。

## 发现、连接与断开

先监听 `eip6963:announceProvider`，再发送 `eip6963:requestProvider`，让用户选择 PLabs。网站应使用被选中的 provider，而不是假定 window.ethereum 一定属于本钱包。兼容入口为 window.plabsPrivacyWallet；不会覆盖其他钱包的 window.ethereum。

```ts
window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = (event as CustomEvent).detail;
  // 在钱包选择器展示 info；让用户选择 provider。
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

const [address] = await provider.request({ method: 'eth_requestAccounts' });
const accounts = await provider.request({ method: 'eth_accounts' });
const chainId = await provider.request({ method: 'eth_chainId' });

provider.on('accountsChanged', accounts => { /* 清理旧地址的登录状态 */ });
provider.on('chainChanged', chainId => { /* 更新网络，重新获取依赖链的状态 */ });

await provider.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

`wallet_getPermissions`、`wallet_requestPermissions` 支持 eth_accounts 权限；`wallet_revokePermissions` 是本钱包实现的撤销兼容方法，不应假定所有钱包都支持。撤销仅影响当前 origin，会发出 accountsChanged([])，并取消该站点尚未确认的请求。不能撤销已经广播的链上交易。

连接权限不会自动共享隐私地址、余额或 Notes。账户事件仅转发到已授权站点，撤销事件只通知被撤销的站点。EIP-1193 的 connect/disconnect 表示网络连接状态；本钱包的站点断开以撤销权限和 accountsChanged([]) 表示。

## 消息签名与登录

```ts
import { hexlify, toUtf8Bytes, verifyMessage } from 'ethers';
const signature = await provider.request({
  method: 'personal_sign',
  params: [hexlify(toUtf8Bytes(message)), address],
});
const recoveredAddress = verifyMessage(message, signature);
```

演示登录生成 SIWE 格式消息，包含真实站点 domain、URI、账户、chainId、随机 32 位十六进制 nonce、签发时间与 5 分钟有效期；钱包将 UTF-8 消息解码供用户阅读。页面验证签名恢复地址，账户或网络变化会清理演示登录。

此演示没有服务器登录会话。生产接入必须由服务端签发并一次性消费 nonce，按 ERC-4361 校验域名、URI、chainId、时效、地址和签名，再签发安全会话（例如 HttpOnly cookie）。不能把页面内的“验证通过”状态当作服务器鉴权。EOA 验签示例不涵盖 ERC-1271 智能合约账户登录。

## dApp 发起交易时，钱包如何签名

公开 EVM 路径通常为 `eth_sendTransaction({ from, to, value, data, chainId })`：钱包校验、展示交易，用户确认后由钱包签名并广播，网站收到交易哈希。**本版本仍禁用公开交易广播与 eth_signTypedData_v4，返回 4200**，没有因演示页绕过这些限制。

`plabs_previewTransaction` 是本钱包的演示扩展：读取 Gas 估算并打开钱包确认页，但不签名、不广播，返回 `{ approved: true, broadcast: false, ... }`。不返回虚假的签名或哈希。

隐私转账不是对任意 calldata 做 personal_sign。网站通过以下 PLabs 专用接口提交操作意图：

```ts
const result = await provider.request({
  method: 'plabs_sendPrivacyTransaction',
  params: [{
    kind: 'send',               // send | shield | unshield
    chainId: '0x8f',            // Monad；必须与钱包当前网络一致
    poolAddress: '0xcb36e209ae44fafc75dc6820ae42d9400637f99e',
    amount: '1',                // 十进制代币数量字符串
    recipient: 'perc1…',        // send 必填；shield/unshield 不允许指定
  }],
});
// result: { id, state: 'pending' | 'confirmed', txHash?, message? }
```

真实处理流程：

1. 校验请求来源、连接权限、钱包/隐私会话、当前链、固定资产池与实验性开关。
2. 第一次钱包确认展示网站、操作意图、金额、收款方与当前手续费；确认后才本地选 Notes 并生成证明。
3. 第二次确认展示最终扣除、到账、手续费、Gas 支付方和授权数量。
4. 再次校验账户、网络、站点授权与费用；按钱包全局偏好使用 EVM 原生币支付 Gas 或交由 Relayer 提交。
5. 结果返回网站，操作在钱包本地历史中记录发起网站。待确认请求可查询：

```ts
const status = await provider.request({
  method: 'plabs_getTransactionStatus', params: [result.id],
});
```

查询只允许原始发起 origin 和同一 EVM 账户，关联保存在当前浏览器会话。关闭整个浏览器后请在钱包本地历史查看记录。网站拿不到 Seed、私钥、原始 Notes、证明开口，也不能跳过第二次确认直接广播。Shield/Unshield 仍遵守现有支持范围，网站不能指定不同提款地址。

读取自己的隐私收款地址需要独立的一次确认：

```ts
const { address: privacyAddress, chainId } = await provider.request({
  method: 'plabs_getPrivacyAddress',
});
```

## 错误和通知

- 4001：用户明确拒绝、取消或请求过期。收起工具栏面板会保留请求，不等于拒绝。
- 4100：站点未授权、钱包锁定、账户/权限变化。
- 4200：当前不支持的接口或操作，例如公开广播、结构化签名。
- 4901 / 4902：当前网络不匹配 / 网络未内置。
- -32602：参数错误。
- -32002：同一站点已有待处理交互请求。
- 4900：扩展连接中断，扩展重载后需刷新网站。

页面通知和浏览器通知按钮仅演示通知效果，不代表钱包授权。真实授权在工具栏插件面板内完成。断开连接不会自动退出网站服务器登录态，网站还需销毁自己的会话。

## 参考

- https://eips.ethereum.org/EIPS/eip-6963
- https://eips.ethereum.org/EIPS/eip-1193
- https://eips.ethereum.org/EIPS/eip-2255
- https://eips.ethereum.org/EIPS/eip-4361

本轮按用户要求仅构建代码与人工操作演示页，未运行自动测试，未签署消息或广播真实交易。

## 钱包弹窗与隐私 SDK 封装

连接、消息签名、共享隐私地址、交易意图与最终确认均在同一个 400px 工具栏插件面板（popup.html）展示。使用 Chrome 127+ 的 action.openPopup，不创建独立窗口或标签页；自动展开被浏览器拒绝时，可点击带待处理标记的插件图标继续。主钱包未解锁时先输入主密码；隐私请求需要独立隐私解锁，再进入原请求的确认过程，解锁本身不会自动批准交易。收起面板保留请求；明确拒绝、取消、权限撤销或超时才结束请求。

独立包位于 `packages/plabs-wallet-sdk`，拟用包名 `@plabs-wallet/sdk`；ESM、CommonJS 和类型声明已可本地打包，尚未发布 npm。原 `src/dapp/plabs-sdk.ts` 保留兼容导出：

```ts
import { getPlabsWallet } from '@plabs-wallet/sdk';
const wallet = getPlabsWallet(selectedProvider);
if (!wallet) throw new Error('请安装 PLabs Wallet');
await wallet.evm.connect();
const result = await wallet.privacy.sendTransaction({
  chainId: '0x8f',
  poolAddress: '0xcb36e209ae44fafc75dc6820ae42d9400637f99e',
  to: 'perc1…',
  amount: '1',
});
```

`privacy.sendTransaction` 底层仍调用 `plabs_sendPrivacyTransaction`，覆盖钱包授权、本地证明、最终确认与提交。它不是 EVM personal_sign，也不声称兼容其他隐私链的交易格式。`evm.signMessage` 用于公开 EVM 身份消息签名；独立隐私身份的匿名登录签名尚未实现。其他钱包方案对照见 [隐私钱包互操作说明](PRIVACY-WALLET-INTEROPERABILITY.md)。

## 独立 SDK 本地接入

仓库使用 pnpm workspace 管理 `packages/plabs-wallet-sdk`。运行 `pnpm run pack:sdk` 生成 `releases/plabs-wallet-sdk-0.1.0.tgz`，外部网站可用 `pnpm add /path/to/plabs-wallet-sdk-0.1.0.tgz` 安装，再从 `@plabs-wallet/sdk` 导入。

SDK 是 Noir Wallet SDK 0.1.9 的 Provider/链级封装结构的 PLabs 适配分支；已保留上游来源和 MIT 声明，未继承 Zcash RPC、身份签名算法或地址格式。当前代码不依赖 Noir 扩展，也不声称兼容 Zcash。详细接口、事件和发布状态见 [SDK README](../packages/plabs-wallet-sdk/README.md)。


## 面板请求生命周期

- 全局同时处理一个需要交互的网站请求，其他交互返回 -32002。
- 解锁等待与单次确认各有 10 分钟超时，扩展后台重启可能使尚未完成的请求失效。
- 页面收起不重新广播、不重新发送网站请求。已确认后的证明和提交进度在同一面板显示。
- 正在提交的交易不能通过关闭面板撤销；请求结果回传网站，并保留既有本地交易记录。
- 原生 Gas 模式预览前与每次广播前检查原生币余额；错误展示去除 RPC payload 和长原始交易串。历史旧错误也按当前安全文案展示。
- 本轮按要求未运行自动测试或真实交易，仅编译打包。

## 当前活动网站连接栏

插件底部固定显示当前活动标签页的连接状态，仅对已授权 origin 显示。包含域名、同源 favicon（或本地图标/通用占位）、当前网络和公开账户地址。钱包锁定时显示已授权/已锁定，不展示账户地址。

切换标签页、页面导航、切换账户、切换网络与撤销授权会更新连接栏。点击域名打开连接详情；点击右侧断开按钮撤销该 origin 权限，通知网站 accountsChanged([])，并取消尚可取消的同源请求。断开前再次核对活动标签页和 origin，防止切页期间误断其他网站。

通过已注入的顶层 content script 读取网站 origin，不增加 tabs/history 权限。图标仅允许同源图片，不访问第三方 favicon 服务。连接栏位于独立固定层，页面式详情切换时保留；页面底部预留空间，不覆盖交易确认按钮。

## 0.6.0：有范围的余额与历史读取

SDK 0.2.0 提供 `wallet.privacy.requestAccess(['address','balances','history'])`。这些权限不是 EVM connect 隐含授予，而是插件中的明确审批。已授权后使用 `getSession()`、`getBalances()`、`getHistory()`、`getNotes()`、`getDexOrders()`，私密历史只包含钱包可解密的实际记录。`revokeAccess()` 会通知页面清理；锁定/切链也使授权失效。

详细字段与权限生命周期见 [WEBSITE-READ-PROTOCOL.md](WEBSITE-READ-PROTOCOL.md)。同级 plabs-network 已接入此协议。SDK 0.3.0 / 插件 0.7.0 的 PEX 写接口见 [PEX-TRADING.md](PEX-TRADING.md)。导入的 display-only 旧记录仍不能用于签名或撤单。
