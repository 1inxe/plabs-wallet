# Reviewer instructions — draft for Chrome Web Store

This document describes how a reviewer can inspect the extension. It does not record tests already performed. The developer has not run automatic unit/UI/extension regression or real transactions for this preparation task.

## Environment and access

Chrome 127 or newer. No hosted login is required to create a local EVM wallet. Do not use a funded personal wallet or production recovery phrase. The extension does not require reviewers to provide private credentials to the developer.

1. Open PLabs Privacy Wallet from the toolbar. Create a disposable account with a new local password. Follow the backup step before reaching the dashboard. Keep any temporary recovery material private.
2. Inspect the account selector, network selector, public address copy action and settings. Four EVM networks are configured; privacy pools are limited to Monad and Ethereum.
3. A privacy account is separate from the EVM account. Create a disposable privacy account with its own password. Confirm its encrypted Vault export is separate from EVM recovery material. An empty account may have no Notes or balance.
4. Main-wallet and privacy locks are independent. After locking, reopen and unlock through the extension toolbar popup. There is no hosted password verification service.
5. For dApp connection and signature-review screens, use the publisher's review site: **PENDING — provide a stable public HTTPS URL before submission.** The current local playground at 127.0.0.1:5174/dapp.html is a development address and is not available to a remote reviewer. It is intentionally excluded from the store ZIP.
6. On that site, request connection, inspect the actual origin in the extension, and approve or reject. Review a message request and reject it if signing is unnecessary. Check disconnect/revoke from the unlocked dashboard footer or settings. This does not require funds.
7. Public transaction requests are not enabled. The playground's public preview is a non-broadcast confirmation demo; it must not be presented as a successful real transfer. Typed-data and eth_sign are unsupported.
8. Privacy writes require a private account, usable assets/Notes, synchronization and the experimental setting. Their final confirmation is separate from unlock and intent approval. Do not require reviewers to transfer personal funds. Any funded demonstration environment, limited-purpose accounts, video evidence or test-network instructions must be supplied and described honestly before submission. None is supplied in this draft.

## Expected limitations

Swap is unavailable. Fiat pricing for private assets is not connected. Shield is limited to configured ERC-20 pools; Unshield currently supports Monad sUSDC only. Supported actions and exact fees are shown by the wallet. No generic WalletConnect or independent private-identity message-signing standard is claimed.

## Architecture for reviewers

Manifest V3 background service worker mediates requests. Top-frame content scripts expose a provider. Internal popup pages authorize messages and transactions. A packaged offscreen engine runs local WASM/proof workers and local scanning. Packaged code accesses fixed RPC, Indexer, Relayer and SQD endpoints for data. Imports from app.plabs.online read matching encrypted records from that site's IndexedDB at the user's request.

`wasm-unsafe-eval` is required for local WASM. The ZIP includes no remote script tags and excludes the dApp playground. The publisher should supply upstream source/notice/build information for the precompiled privacy engine during review; the current source tree does not establish a complete reproducible build of those upstream binaries.

## Submission prerequisites still missing

Final public support email, privacy-policy URL, reviewer-site URL, actual current screenshots and resolution of the security report's release blockers. Do not submit this text with the PENDING fields unchanged.
