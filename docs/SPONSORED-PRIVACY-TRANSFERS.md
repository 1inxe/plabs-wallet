# Sponsored private transfers

`plabs_getCapabilities().methods.sponsoredPrivacyTransfers === true` advertises the protocol-level payment RPC. The supported protocol is `plabs-custody-v1`, currently on Monad mainnet with the wallet's configured P20 and sUSDC pools.

```ts
await provider.request({
  method: 'plabs_sendSponsoredPrivacyTransaction',
  params: [{
    protocol: 'plabs-custody-v1',
    apiBase: 'https://app.plabs.online/nft-jubjub/v1',
    campaignId: config.rules.id,
    rulesHash: config.rulesHash,
    intentId: preparedIntent.id,
    token: campaignSession.token,
    payment: {
      chainId: 143,
      poolAddress: config.rules.paymentPool,
      recipientRaw: config.rules.custody.recipientRaw,
      amountRaw: preparedIntent.delta,
      memoPrefixHex: '0x5045524332302d4a55424a55422d5032302d763100',
    },
  }],
});
// { id, intentId, state: 'pending' | 'confirmed' | 'failed', jobId?, txHash?, message? }
```

Amounts are canonical positive integer strings in the asset's base units, capped at `Number.MAX_SAFE_INTEGER` by the bundled prover. `amountRaw` is the payment increment, not the application's cumulative total. The application prepares its own intent and renders its auction, eligibility, settlement, and refund rules. The wallet does not enforce JubJub's 100 P20 reserve, 50 P20 increments, seat count, title, recipient, or memo prefix in the generic path.

The private result contains only an opaque, wallet-generated request ID, the application's already-known intent ID, and public transaction/status information. It never returns a proof bundle, note opening, input commitment, nullifier, change-note secret, viewing key, bearer token, or seed to the page. Repeating the same approved request resumes the original payment and returns the same opaque ID. There is no separate opaque-ID-only resume RPC in this version: callers repeat the original request with a fresh session token if necessary, and the wallet independently reauthenticates and checks the immutable payment details.

## Protocol and trust boundary

This version accepts only `https://app.plabs.online/nft-<name>/v1`, with a lowercase alphanumeric name optionally separated by single hyphens. The URL is at most 200 characters and must be the exact canonical string: no query, fragment, user information, port, dot segments, percent encoding, backslash, trailing slash, or redirects. The wallet only calls these fixed protocol suffixes:

- `GET /config` and authenticated `GET /me`.
- `POST /auth/challenge` with current EVM and raw privacy addresses.
- `POST /auth/session` with an EVM signature and public privacy ownership proof.
- Idempotent `POST /bids/prepare` with the original intent ID, total, and version.
- `POST /bids/fund` with the original intent ID and wallet-generated payment material.

The official profile must identify the requested API scope, campaign, committed rules hash, supported Monad pool, correct asset symbol/decimals, exact privacy recipient, and a sponsored zero-fee policy. The wallet computes the rules commitment itself. RPC URLs, indexer URL, network genesis, and minimum 12-confirmation requirement come from the wallet configuration, not the caller.

The site-supplied bearer token is **only a preview**. After the user approves the displayed asset, amount, receiver, campaign, service, and memo prefix, the wallet creates its own independent session using the currently unlocked EVM/privacy identity. The original intent must exist in that independently authenticated account and have exactly the approved increment, total, version, and psi. This prevents an untrusted website from assigning the wallet's payment to another account by supplying a foreign token.

`memoPrefixHex` is a public, declarative application tag of 1–128 bytes. The wallet appends the **independently fetched intent psi** as a 32-byte big-endian word. The caller cannot supply psi, an executable adapter, script, JSON evaluator, arbitrary request body template, signing method, or submission URL. The prefix is included in the user's approval and immutable request digest. The currently deployed JubJub prefix was observed in its official client; another campaign's prefix and backend acceptance must be supplied by that campaign's integration. Unknown tags are not silently retried with a different proof.

The protocol can support another campaign on the reviewed origin with a different API scope, campaign ID, receiver, reserve/step rules, memo prefix, and supported pool without a wallet update. It is not a claim of arbitrary sponsor, origin, network, contract, authentication scheme, or proof-format support. A backend using different endpoint semantics or noncustodial funding is outside this version.

## Funding and recovery

The wallet selects one confirmed spendable note covering the increment, verifies its Merkle path and on-chain state, creates the transfer proof, validates the receiver/change outputs, and saves the exact proof under AES-GCM before submission. Note inputs are reserved across sponsored payments, ordinary transfers, DEX operations, and merges. Network uncertainty preserves the original proof and intent; it never generates another payment to compensate for a lost response.

Successful confirmation requires the intended pool's canonical transaction receipt, at least 12 confirmations, the expected recipient/change commitments, the expected spent input, and the official intent's accepted/funded state. Reverted receipts also wait for confirmation depth and canonical block checks. Imported server-side jobs are checked against the chain before returning `confirmed`.

`plabs_fundJubjubBid({intentId, token})` remains as a compatibility adapter. Both methods use the same engine and existing encrypted journal storage key/AAD. Old records without generic request metadata are interpreted only as their original reviewed JubJub deployment, and their exact material and envelope are retained. A new request matching an old intent must have the same origin, scope, rules, amount, recipient, and memo before it can reuse the old proof. Token rotation does not change the immutable request digest. A different service/pool cannot reinterpret an old record or release its reserved input.

## Verification

`node --test tests/jubjub.test.mjs` covers the generic and legacy paths, independent authentication, malformed request/URL rejection, a second campaign using 3.125 sUSDC and a different receiver/API/memo, cross-scope isolation, pre-upgrade record recovery, legacy/generic interoperability, no duplicate funding after lost responses, session cancellation, receipt confirmation, output validation, and encrypted storage.

All test keys, accounts, server jobs, and payment responses are synthetic. This implementation has not used a real wallet to sign, send, or refund funds during development. Real sponsor acceptance of additional campaign deployments remains an integration verification step.
