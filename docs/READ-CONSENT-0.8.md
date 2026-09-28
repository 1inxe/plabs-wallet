# One connection approval and remembered read access — 0.8.0 / SDK 0.4.0

The website calls `wallet.connect({privacyScopes:['address','balances','history','notes','dexOrders']})`. The SDK sends `plabs_connect`; the extension shows one approval containing the origin, public and private identity, requested read categories, supported networks and remembered-consent lifetime. Plain `connect()` / `eth_requestAccounts` remain public-account-only APIs.

Remembered consent is encrypted with the privacy state key. Storage keys hash the origin and account/privacy identity; no privacy address or scope list is stored in plaintext. Consent is limited to the approved origin, account, privacy identity and network list. Locking stops reads and clears active grants. Once the same wallet is unlocked, consent can restore a fresh session grant without another disclosure approval. Revoking read access or disconnecting removes remembered consent; a new identity or unapproved network requires a new approval. Old session-only grants are not silently upgraded to permanent consent.

Read operations still validate the account, privacy identity, chain, permission epoch, unlock expiry and operation revision before returning data. Pending revocations block restoration. This consent never grants spending authority, raw Notes, seed/viewing keys, order capabilities or signatures. Transaction review and confirmation remain separate.

The frontend uses all read scopes at connection, avoids an extra address-only request, and coalesces concurrent session restoration calls. Unlock events resume remembered access without cancelling the currently pending read request. Older extension versions can use the public connection plus one grouped read request, but require 0.8.0 for a single combined connection approval.

Validation uses isolated generated wallets: rejection, one approval, all read endpoints, no-window repeated connect, page reload, lock/unlock, supported-network switching, encrypted storage, and explicit revocation. No user wallet data or live transactions are used.
