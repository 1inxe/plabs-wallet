# Shared SDK

**English** | [简体中文](README.zh-CN.md)

`plabs-js-sdk-0.2.0.tgz` is built with `npm pack` from the standalone
[plabs-js-sdk repository](https://github.com/1inxe/plabs-js-sdk), checked out as
`../plabs-js-sdk` beside the consumer repositories.

PLabs Network and PLabs Wallet use the identical artifact. `pnpm-lock.yaml`
pins its integrity; SDK source is maintained only in the standalone repository.

## Update the dependency

1. Run `npm ci` and `npm pack` in the SDK repository.
2. Copy the resulting tarball into both consumers' `vendor/` directories.
3. Update each consumer's `package.json` dependency when the filename changes,
   then run `pnpm install` in each consumer to refresh its lockfile.
4. Build both consumers and include the tarball and lockfile updates together.

The SDK is MIT-licensed. Preserve its `LICENSE`, `LICENSE.upstream` and
`NOTICE.md` when redistributing it.
