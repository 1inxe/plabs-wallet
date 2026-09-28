# Shared SDK

**English** | [简体中文](README.zh-CN.md)

PLabs Network and PLabs Wallet use `plabs-js-sdk@0.2.0` from npm. Both projects pin the exact version in `package.json` and its integrity in `pnpm-lock.yaml`. SDK source is maintained in the standalone [plabs-js-sdk repository](https://github.com/1inxe/plabs-js-sdk).

## Update the dependency

Publish the new SDK version, then run `pnpm add --save-exact plabs-js-sdk@<version>` in both consumers. Build both projects and commit the dependency and lockfile updates together. Local tarballs are no longer required.

The SDK is MIT-licensed. Preserve its `LICENSE`, `LICENSE.upstream` and `NOTICE.md` when redistributing it.
