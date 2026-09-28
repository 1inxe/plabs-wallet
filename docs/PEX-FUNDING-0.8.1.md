# PEX confirmation fix — extension 0.8.1 / SDK 0.4.1

A saved `funding` record is not a matcher-accepted order. Previously, the engine checked confirmation just once immediately after broadcasting a fee or principal leg. Ordinary RPC or indexer latency then returned the request to the website before `/vnote/submit` was reached.

An approved placement or resume now polls the original commitments, transaction receipt, finalized canonical block and indexer. Each leg gets up to 25 checks, spaced 2.5 seconds apart, with a 90-second polling deadline (an in-flight network request retains its own timeout). Separate fee funding must confirm before the principal is sent. After both legs confirm, the engine rechecks the matcher epoch and encrypted preflight before submitting the same order material. Normal delay requires no further approvals. A new write is never triggered by listing or refreshing orders.

Unknown funding remains reconcile-only: the engine never rebuilds or rebroadcasts that leg. A timeout, page reload or interrupted session retains the encrypted journal. Resuming an old record requires explicit wallet approval; it uses the saved intent and only sends funding legs still marked `prepared`. If the saved proof's anchor is no longer valid, the engine stops and retains the recovery record.

Known transaction receipts are checked before looking for outputs, so a finalized revert is reported as a failed transaction instead of an endless funding wait. Unavailable or non-final receipts remain pending. No indexer result is treated as success without the canonical successful receipt and matching pool/commitment logs.

Read-only order listing bypasses the mutation queue so the website can show confirmation progress during the approved operation. The public summary adds `executionActive`, `fundingProgress` (asset and stage only), and `transactionFailed`. It exposes no openings, child viewing keys, proofs or capabilities. Concurrent mutations remain serialized and all broadcasts retain the origin/account/session checks.

The frontend groups local funding/submission/recovery requests separately from orders accepted by the matcher. Accepted orders with outstanding quantity or unsettled fills remain under Open orders; completed fills and fund recoveries appear in history. Missing/unavailable/previous-epoch status remains pending follow-up. Only explicit transaction failure or verified fund recovery enters the transaction notification system; ordinary confirmation waits remain quiet.

Upgrade by reloading the existing extension from `dist`, preserving its storage, then refreshing the website. Existing `funding` requests appear under Pending requests. Resume request continues the saved request; creating another order is unnecessary.

Validation uses synthetic funding, delayed RPC/indexer responses, an old unknown-funding journal, reverted receipts, a changed wallet session and matcher epoch. No real customer funds are moved by these tests.
