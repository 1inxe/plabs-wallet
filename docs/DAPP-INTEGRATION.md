# dApp 接入

## 运行示例

```sh
pnpm run build
pnpm run dev:dapp
```

在 Chrome 加载 `dist/` 扩展，创建或导入钱包并解锁，然后打开 `http://127.0.0.1:5174/dapp.html`。示例提供连接、消息签名、网络切换和隐私请求；所有授权在钱包中完成。重新加载扩展后也要刷新网页。

## 发现与连接

推荐通过 EIP-6963 展示钱包选择器，使用用户选择的 Provider；不要假定 `window.ethereum` 属于 PLabs。兼容入口为 `window.plabsPrivacyWallet`。

```ts
import { getPlabsWallet } from 'plabs-js-sdk';

window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = (event as CustomEvent).detail;
  // 在钱包选择器展示 info，并保存对应 provider。
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

// selectedProvider 是用户在选择器中选择的钱包。
const wallet = getPlabsWallet(selectedProvider);
if (!wallet) throw new Error('请安装 PLabs Wallet');
await wallet.connect({ privacyScopes: ['address', 'balances', 'history'] });
```

`wallet.connect()` 仅请求公开账户；传入 `privacyScopes` 可在同一次确认中请求隐私读权限。支持的范围为 `address`、`balances`、`history`、`notes`、`dexOrders`。只请求业务需要的范围。

隐私授权绑定网站 origin、账户、隐私身份和批准的网络。锁定后停止读取；再次解锁时可从加密保存的授权恢复会话。撤销读取权限或断开连接会删除记住的授权。读取权限不包含交易、签名、私钥、原始 Notes 或订单控制凭证。

通过 `wallet.privacy.getSession()`、`getBalances()`、`getHistory()`、`getNotes()` 和 `getDexOrders()` 读取已授权数据。未同步的余额可能为 `null`，不要显示为零。接口参数和返回类型以 [SDK 文档](https://github.com/1inxe/plabs-js-sdk#readme)为准。

## 消息签名与事件

```ts
const signature = await wallet.evm.signMessage('Sign in to this application');

selectedProvider.on('accountsChanged', () => {
  // 清理旧账户的登录状态并重新读取账户。
});
selectedProvider.on('chainChanged', () => {
  // 更新网络并重新读取依赖当前链的数据。
});

await selectedProvider.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

示例中的 SIWE 登录仅演示消息与验签。生产登录应由服务端签发并一次性消费 nonce，核验域名、URI、网络、时效、地址及签名，再建立服务器会话。断开钱包连接不会自动销毁网站的服务器会话。

## 隐私交易

```ts
const result = await wallet.privacy.sendTransaction({
  chainId: '0x8f',
  poolAddress: '0xcb36e209ae44fafc75dc6820ae42d9400637f99e',
  to: 'perc1…', // 替换为真实的隐私收款地址。
  amount: '1',
});
```

底层使用 `plabs_sendPrivacyTransaction` 提交意图。钱包先校验网站、账户、网络、资产池及实验性开关；用户批准意图后本地生成证明，再展示费用和最终确认。网站无法跳过确认或读取证明密钥。

通过 `plabs_getTransactionStatus` 查询返回的操作 ID；查询限原始网站和同一账户，关联仅在当前浏览器会话保留。浏览器重启后可从钱包本地历史查看操作结果。

公开 EVM 广播 `eth_sendTransaction` 和结构化签名 `eth_signTypedData_v4` 当前禁用。`plabs_previewTransaction` 只提供估费和确认预览，不签名、不广播。

## PEX 订单

| RPC | 用途 |
| --- | --- |
| `plabs_placeDexOrder` | 提交订单意图，需两次钱包确认 |
| `plabs_resumeDexOrder` | 用户批准后继续已保存的订单 |
| `plabs_cancelDexOrder` | 撤销可撤订单并核验剩余资金回收 |
| `plabs_collectDexPayouts` | 核验结算凭证并导入属于本账户的输出 |
| `plabs_getDexOrders` | 读取已授权的订单摘要 |

下单意图包含 `chainId`、`side`、`type`、`quantityRaw`、`priceTicks`、`maxFeeRaw`，金额使用六位小数的原始整数，价格为整数限价或市价保护边界。使用 SDK 类型校验输入，并依据钱包返回的能力决定是否展示操作。

撤单响应不等于资金已回收；应展示真实订单及回收状态。官网导入的旧订单仅可展示，不能据此取得控制权。普通 Vault 导出不包含扩展的订单恢复日志，未完成订单依赖当前扩展存储。

## 请求与错误

钱包全局同时处理一个交互请求。收起面板会保留请求；用户拒绝、撤销权限或超时才结束。若浏览器没有自动打开面板，点击工具栏扩展图标继续。

| 错误码 | 含义 |
| --- | --- |
| `4001` | 用户拒绝、取消或请求过期 |
| `4100` | 未授权、钱包锁定或账户权限变化 |
| `4200` | 不支持的接口或操作 |
| `4901` / `4902` | 网络不匹配 / 网络未内置 |
| `-32602` | 参数错误 |
| `-32002` | 已有待处理交互请求 |
| `4900` | 扩展连接中断，需刷新网页 |

## Privacy ownership proof

`plabs_getCapabilities` advertises `methods.privacyOwnership`. `plabs_getPrivacyAddress` also returns `rawAddress` (43-byte, `0x`-prefixed) after address disclosure approval.

Call `plabs_provePrivacyOwnership` with `[{ message, privacyAddress }]` for a separate approval. `message` must be non-empty and at most 8192 characters; `privacyAddress` must match the unlocked privacy account. The result contains only `{ version: 'bjj-schnorr-v1', r_x_hex, r_y_hex, s_hex }`. Keys remain in the extension. Rejection, cancellation, permission changes and wallet/session changes prevent proof disclosure.

PLabs Network uses this proof for `/privasea/whitelist/qualification/challenge` and `/privasea/whitelist/qualification/check`, following EVM `/auth/challenge` and `/auth/login`. These operations do not broadcast transactions.

Run `node --experimental-transform-types --test tests/privacy-ownership.test.mjs` to test the approval boundary and the bundled WASM with synthetic keys.
