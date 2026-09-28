# 共享 SDK

[English](README.md) | **简体中文**

`plabs-js-sdk-0.2.0.tgz` 由独立的 [plabs-js-sdk 仓库](https://github.com/1inxe/plabs-js-sdk)通过 `npm pack` 构建；本地可将 SDK 检出到两个消费项目的同级目录 `../plabs-js-sdk`。

PLabs Network 和 PLabs Wallet 使用完全相同的制品。`pnpm-lock.yaml` 固定其完整性校验值，SDK 源码仅在独立仓库维护。

## 更新依赖

1. 在 SDK 仓库运行 `npm ci` 和 `npm pack`。
2. 将生成的 tarball 复制到两个消费项目的 `vendor/` 目录。
3. 文件名变更时更新各项目 `package.json` 的依赖路径，再分别运行 `pnpm install` 更新锁文件。
4. 构建两个消费项目，将 tarball 与锁文件的变更一起提交。

SDK 使用 MIT 许可证。再分发时保留其中的 `LICENSE`、`LICENSE.upstream` 和 `NOTICE.md`。
