# Upstream notice

This is a PLabs adaptation of the typed provider/chain-wrapper structure in
Noir Wallet SDK (`@noir-wallet/sdk`), authored by Noir Finance.

- Repository: https://github.com/NoirWallet/noir-wallet-sdk
- Version inspected: 0.1.9
- Commit: 19e0aec93187e1679e1cbb44b2cd825a8c0a1662
- Upstream package.json license declaration: MIT
- Upstream LICENSE file at this commit contains the single line `MIT`;
  its exact contents are retained as LICENSE.upstream.

Adaptation areas: provider getter/installation detection, chain API wrappers,
provider event forwarding, and typed exports. PLabs-specific RPC mappings,
validation, discovery, packaging and documentation are maintained here.

Noir's Zcash transaction types, identity signature verification, Base58 address
utilities, branding and browser-provider namespace are not offered by this
package. This package is not a Noir Wallet product or a claim of Zcash protocol
compatibility.
