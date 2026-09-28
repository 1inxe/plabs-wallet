# Chrome Web Store 图片

- `icon-128.png`：128×128 RGBA PNG，96×96 圆角主体，四边各 16px 透明留白；与 manifest 的 128px 图标一致。
- `icon-512.png`：同一标志的大尺寸备用图片，不是商店必需项。
- `promo-440x280.png`：440×280 品牌宣传图，全画幅、无透明边缘；不是产品截图。
- `../../artifacts/branding/icons-preview.png`：浅色/深色背景及 16/24/32/48px 实际大小预览。

使用现有金色眼形标志，保持原品牌内容；调整深色圆角底板、透明外边距和小尺寸笔画。

上传扩展包：`../plabs-wallet-extension-0.5.4-store.zip`。包内根目录为 manifest.json，不包含 dApp 演示页面；源代码、开发脚本和本地截图不在包内。

商店还需真实产品截图（1280×800 或 640×400，方角、无额外透明留白），并在发布控制台填写相应商品信息。此处未生成或伪造产品截图，也未执行市场提交或功能测试。

官方参考：
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/extensions/develop/ui/configure-icons

重新生成图标：用装有 Pillow 的 Python 执行 `scripts/generate-icons.py`。
重新生成包：`pnpm run build` 后执行 `python3 scripts/package-store.py`。
