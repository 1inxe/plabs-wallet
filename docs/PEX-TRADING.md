# PEX VNote integration — extension 0.7.0 / SDK 0.3.0

The page submits an intent; the extension owns proofs, escrow records, order capabilities and recovery. Read permission does not authorize a trade. This implementation follows the official VNote v5 / terms v2 flow observed on 2026-09-28. It does not use the older personal-sign/order-sign flow.

## Requests

- `plabs_placeDexOrder [{chainId:'0x8f',side,type,quantityRaw,priceTicks,maxFeeRaw}]`: two wallet approvals. The price is an integer limit or market protection bound. Amounts use six decimals.
- `plabs_resumeDexOrder [localId]`: explicitly approve continuing the saved order. Reconcile uncertain funding without a new funding proof. Submission uses the same material and official idempotency.
- `plabs_cancelDexOrder [localId]`: remove the resting order where possible, check pending matches again, recover remaining principal/unused fee to the main privacy account and verify final receipts.
- `plabs_collectDexPayouts [localId]`: verify finalized settlement receipts, walk VNote successors and import owned payouts. No transaction is broadcast by this method.
- `plabs_getDexOrders`: scoped read of managed orders plus optional legacy display references. Raw notes, order capabilities and child viewing keys never appear in these responses.

## Modules and transport

`src/privacy/dex/protocol.ts` pins market identity, integer constraints, memo layout, endian conversions and P-256/AES-GCM material encryption. `engine.ts` manages preparing/funding/submission/recovery. `journal.ts` encrypts the account journal with the existing wrapped privacy state key. `recovery.ts` verifies canonical finalized receipts and matches successor/payout commitments with the official WASM. The offscreen adapter owns secrets; the background owns origin/account/chain/session validation, encrypted storage IPC and approvals. Chrome offscreen documents only use runtime messaging, never chrome.storage directly.

Official endpoints:

| Purpose | Service |
| --- | --- |
| Health, encrypted preflight/submission, order status, matches, cancel | `https://app.plabs.online/dex-matcher` |
| Escrow/reclaim relay and asynchronous transaction status | `https://monad-relayer.plabs.online` |
| Base Note/path/spend/blind lookup | `https://app.plabs.online/dex-indexer/base` |
| Quote Note/path/spend/blind lookup | `https://app.plabs.online/dex-indexer/quote` |
| Authoritative chain/receipt/anchor/spent verification | pinned Monad RPCs |

The ordinary Monad indexer currently returns 404 for `/note` and `/tx`; PEX must use the dedicated endpoints above. `settle_enabled` alone is not treated as a placement gate, matching the official frontend. Placement does not imply execution or settlement.

## Durability and limitations

The encrypted journal is committed before the first network funding request. Separate fee funding must confirm before principal funding. A timeout leaves a recoverable, reserved record, not an automatic retry with new inputs. Main-wallet spend selection and spendable balances exclude reserved inputs. Child account indices use a persisted monotonic sequence with a randomized start in the upper account range to reduce collisions with legacy browser wallets; the exact index is also encoded in the recovery memo.

Resting orders, partial fills and wallet-generated reclaim receipts have distinct states. A successful `/cancel` response is not presented as funds recovered. Unknown funding, missing settlement provenance and unmatched successor data retain the journal. If the matcher changes epoch and in-flight fills cannot be verified, automatic reclamation stops.

Recovery is for orders created in this extension profile. Legacy imports remain display references and cannot grant control over old escrow. The encrypted journal currently remains in extension storage; ordinary seed/Vault export does not include it. Do not remove the profile or its storage while orders need recovery. Cross-device journal backup/import and a reproducible upstream prover build are not implemented here.

## Validation

- Real packaged WASM, an unfunded test seed, synthetic Notes: sell principal + separate fee proofs, buy principal + fee proof, both child-account reclaim proofs, and legacy-scanner change detection complete in an isolated extension browser.
- The live official matcher accepted both encrypted synthetic order preflights (`ready:true`, protocol 5, terms 2). No live funding or `/vnote/submit` was performed.
- Unit tests exercise intent constraints, ciphertext compatibility/account binding, durable-before-send ordering, timeout/restart behavior, fee-before-principal sequencing, reserved balances, cross-origin rejection and recovery failures.
- Isolated real provider/background bridge verifies both approvals and rejection cleanup, with engine IO mocked. Frontend desktop/mobile tests verify the bounded intent and order follow-up actions.

This is not evidence of a completed real-money fill/reclaim cycle or an independent cryptographic audit. The versioned proof assets and their provenance are recorded in [DEX-ASSETS.md](DEX-ASSETS.md).
