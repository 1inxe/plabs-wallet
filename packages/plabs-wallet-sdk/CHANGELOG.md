# 0.4.0

Add explicit combined connection/read consent via connect({ privacyScopes }), unifiedConnect capability, and remembered session metadata. Requires extension 0.8.0; plain connect() remains EVM-only.

# 0.3.0

Add intent-only PEX placement, resume, cancellation/recovery and payout collection. Managed order summaries expose execution state and follow-up actions without private proof material. Requires extension 0.7.0.

# Changelog

## 0.1.0

- Initial local PLabs adaptation of Noir Wallet SDK's provider/chain-wrapper structure.
- EIP-6963 discovery, injected-provider detection, timeout/disposal/abort support.
- Public EVM connection, account/permission reads, message signing and chain switching.
- PLabs privacy address disclosure, send, Shield, Unshield and request status wrappers.
- Typed events, request validation, normalized RPC errors and capability discovery.
- Zero-runtime-dependency ESM/CommonJS builds with TypeScript declarations.
- Workspace integration with the extension's manual dApp playground.
- No npm publication, automatic tests or real transaction execution in this change.
