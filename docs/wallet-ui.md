# Wallet interface

PLabs is primarily a privacy wallet. Default to private assets and their total USD estimate (displayed in U); public ERC-20 assets belong in a secondary tab. Keep private transfers, receiving, shielding and NFT ownership prominent. Use restrained mint accents, clear hierarchy and concise copy.

Show both token quantity with its unit and the estimated U value, plus 24-hour price changes. Aggregate portfolio changes using the current quantities at current and previous prices; this is a market-value comparison, not realized profit. Missing quotes default to 0 U and 0.00%, with a compact indication of incomplete pricing. Locked or explicitly hidden balances remain masked.

Prices come from DefiLlama's current-price and percentage APIs. Canonical contracts, never token symbols, determine identity. Private assets inherit their configured underlying asset's quote with the pool's scale/decimal conversion. P20 has no assumed dollar peg. Pricing requests contain only public token identifiers, with no account addresses, balances or private notes. Quote fetching belongs in the trusted extension background, with bounded responses, timeouts and caching.

Chrome toolbar popups choose their own initial viewport. Use the preferred 370px width consistently for the wallet, bottom navigation and approval windows. Set an explicit 370px width for `html.wallet-popup`; do not constrain that width with `100vw`, which can trap the popup at its tiny initial width. Verify a real toolbar popup with `viewport: null` in addition to regular browser fixtures.
