# 共享 SDK

[English](README.md) | **简体中文**

PLabs Network 和 PLabs Wallet 从 npm 安装 `plabs-js-sdk@0.2.0`。两个项目的 `package.json` 固定精确版本，`pnpm-lock.yaml` 固定完整性校验值。SDK 源码仅在独立的 [plabs-js-sdk 仓库](https://github.com/1inxe/plabs-js-sdk)维护。

## 更新依赖

发布 SDK 新版本后，在两个消费项目分别执行 `pnpm add --save-exact plabs-js-sdk@<version>`。构建两个项目，将依赖与锁文件的变更一起提交。不再需要本地 tarball。

SDK 使用 MIT 许可证。再分发时保留其中的 `LICENSE`、`LICENSE.upstream` 和 `NOTICE.md`。
