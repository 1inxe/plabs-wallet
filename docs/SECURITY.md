# Security boundaries

## Keys and sessions

EVM recovery material is encrypted locally with a password-derived AES-256-GCM key. Privacy accounts have independent encrypted Vaults and passwords. Privacy synchronization state and sensitive recovery records are encrypted in local storage; operational metadata such as transaction hashes, timestamps and status may remain readable.

Unlocked secrets are used in trusted extension memory and `chrome.storage.session`. Content scripts cannot read extension Vault storage. Sessions expire according to the configured auto-lock timeout and are cleared on manual locking or full browser shutdown. Switching EVM accounts locks the previous privacy session.

Website Vault import reads only the encrypted account Vault and recovery state associated with the selected EVM address. The extension validates identity and checkpoints locally. It does not import website passwords, cookies or plaintext seeds.

## Website permissions

The injected Provider proxies requests without exposing wallet keys. Requests are bound to the website origin, active account, chain and current permissions. Privacy read consent is separate from spending approval; remembered consent is encrypted and stops granting reads while the wallet is locked.

Website-initiated `eth_sendTransaction`, `eth_signTypedData_v4`, arbitrary write RPCs and custom networks are disabled. Message signing and supported privacy intents require wallet approval. Read responses omit raw Notes, secret keys and order capabilities.

## Transactions and recovery

Privacy writes are disabled until the user enables experimental mainnet operations. Supported operations validate the fixed chain and pool, note ownership, Merkle path, spent state, recipient and fees before submission. Shield approval uses the required amount; relayer calldata must match local encoding. Unshield is limited to Monad sUSDC and the current EVM recipient. Swap is disabled.

Recovery records are persisted before broadcasting, and unresolved outcomes must be reconciled before retrying. PEX orders retain encrypted funding and recovery material in extension storage. A cancel response alone does not prove funds were recovered. Ordinary Vault exports do not include these recovery journals; removing extension storage while operations are pending can remove information needed for recovery.

RPCs, indexers and relayers receive the queries and transaction material needed for their functions. Local encryption and privacy transactions do not guarantee network anonymity. See the [privacy policy draft](privacy-policy.html) for data handling details.

## Bundled proving assets

The extension bundles proving code and WASM rather than loading remote executable code. Asset hashes are recorded in `scripts/vendor-assets.lock.json` and verified by the packaging script.

PEX assets originate from the PLabs distribution at `https://app.plabs.online/assets/groth16Prover.worker-BEe_5aQ4.js` and `https://app.plabs.online/wasm/asset-manifest.json`, with version `aaeba55a93a41b4221ffd0f7b6f41c83e077c331da9deb945e18e006373c6a78`. The root WASM alias and the `dex/wasm/` files are both required by the worker's import paths.

Integrity checks are not an independent security or cryptographic audit. Bundled binary provenance and redistribution rights are not fully established by the dependency notices; see [third-party notices](../THIRD-PARTY-NOTICES.md).
