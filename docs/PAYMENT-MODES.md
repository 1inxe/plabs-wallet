# 隐私操作支付方式

## 官网参考

2026-09-22 对照 https://app.plabs.online/ 发布客户端 `/assets/index-C-AjaNXF.js`：

- `feeOptions(address,address[])` 读取 V2 网关支持的手续费资产和数量。
- 同资产转账：使用 `sameAssetTransferContext(address)`，将转账数量与手续费一起选入 Notes，手续费输出绑定 collector 和 gateway executor。
- 跨资产转账：单独选择一张足额手续费 Note，以 `transferContext(address,address,(bytes,uint256[8]))` 绑定主交易证明。
- 隐私转账提交 `/transfer/submit`；跨币种携带 `fee_pool` 和 `fee_bundle`。
- ERC-20 Unshield 提交 `/wrapped/unshield/submit`；费用读取池的 `unshieldFeeUnits()`。
- Shield 需要公开账户授权与原生 Gas，费用读取 `shieldFeeUnits()`，证明的到账数量扣除协议费。
- `GET /healthz` 的 `perc20-relayer-gas-policy/v1` 提供 gas cap 和 margin；Notes 上限使用官网的保守预算方式。
- 异步请求通过 `/tx/requests/{request_id}` 查询，成功与否最终由链上回执决定。

固定 V2 网关：Monad `0x8c9f00be66a87c51f7c88166dabe71d987c64117`，Ethereum `0x1a0bf9beff0ddf40b86f29f3154aa2b385e9434c`。地址来自官网发布配置，运行时不采纳 Relayer 返回的任意目标合约。

## 实现行为

`transactionSettings.privacyPaymentMode` 为全局 `native` / `private` 偏好，默认保留原生币模式。设置与交易页共用同一偏好，修改立即保存；不覆盖实验性写操作开关。Shield 明确使用原生币，其他已支持的隐私操作按所选模式提交。

表单在证明生成前展示协议/隐私手续费及币种。确认页显示支付方、总扣除、预计到账，以及原生模式下的 Gas 估算与上限。转账手续费额外扣除；Shield/Unshield 手续费包含在操作金额内。未接入价格预言机，不折算法币。

准备与提交分别重新读取费用。报价变化后要求重新预览，不静默增加手续费。Relayer 模式不使用 EVM signer 广播，不自动回退为原生币模式。实验性写操作限制和现有资产支持范围保留。

Relayer 提交前持久化公开验证材料，不保存 seed、密码或 owned output note。保存请求编号与交易哈希；关闭页面后再次进入操作页恢复查询。未知提交结果不自动重新广播，未解决请求会阻止同账户、同网络继续提交，避免重复支付。

Relayer 确认校验包括固定目标、消费的 nullifiers、证明输出 commitments、手续费资产与 collector 实际收款。不会仅凭 Relayer 返回的 `confirmed` 文本宣告成功。

本次按用户要求未运行单元测试、UI 回归、扩展回归，也未提交真实交易；只做编译打包。链上真实交易与 Relayer 端到端路径尚未经本次实测。
