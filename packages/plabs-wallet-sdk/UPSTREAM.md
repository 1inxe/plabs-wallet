# Fork record

Upstream: https://github.com/NoirWallet/noir-wallet-sdk
Pinned commit: 19e0aec93187e1679e1cbb44b2cd825a8c0a1662
Upstream package version: 0.1.9
PLabs package version: 0.1.0

This is a local source adaptation. No remote GitHub repository has been created
and no package has been published to npm by this change.

## Deliberate differences

- `window.noirwallet.zcash` becomes the injected `window.plabsPrivacyWallet`
  provider, optionally selected via EIP-6963.
- `zcash.*` becomes separate `evm.*` and `privacy.*` APIs.
- `zcash_sendTransaction` becomes `plabs_sendPrivacyTransaction`, with an EVM
  chain id, audited pool address, decimal amount and perc1 recipient.
- The SDK does not handle private keys, build proofs, choose notes, send HTTP
  requests to relayers, or broadcast by itself. Those are wallet operations.
- No Zcash signing/key derivation utilities or runtime crypto dependencies are
  copied. EVM message signing uses UTF-8 encoding and the injected provider.
- Provider discovery is SSR-safe and supports EIP-6963 disposal, timeout and
  cancellation. Event listeners remain scoped to the selected provider.
- Build outputs are ESM, CommonJS and declarations using TypeScript; no upstream
  install hooks or publishing workflows are inherited.

Review future upstream changes selectively. Zcash feature additions should not
be copied as PLabs capabilities without corresponding wallet implementation.
