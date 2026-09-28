# @plabs-wallet/sdk

Typed SDK for websites integrating the PLabs EVM privacy wallet extension.
An adapted fork of the provider/chain-wrapper structure of Noir Wallet SDK;
PLabs transaction semantics and RPC methods are independent of Zcash.

**Status:** local package version 0.1.0; not yet published to npm. The proposed
`@plabs-wallet` npm scope must be owned/configured before registry publication.
No remote GitHub repository is implied by this local package.

## Install the local release

```sh
pnpm add ./plabs-wallet-sdk-0.1.0.tgz
# or: npm install ./plabs-wallet-sdk-0.1.0.tgz
```

After installation, imports use the normal package name:

```ts
import { getPlabsWallet } from '@plabs-wallet/sdk';

const wallet = getPlabsWallet();
if (!wallet) throw new Error('Install PLabs Wallet and refresh this page');

// Call from the website's Connect button. Only EVM account access is granted.
const { accounts, chainId } = await wallet.connect();

// A separate wallet popup authorizes disclosure of the privacy address.
const { address: privacyAddress } = await wallet.privacy.getAddress();

// Call from a deliberate transaction button. This can spend real funds/fees.
const result = await wallet.privacy.sendTransaction({
  chainId: 143, // numeric or hexadecimal ('0x8f')
  poolAddress: '0xcb36e209ae44fafc75dc6820ae42d9400637f99e',
  to: privacyAddress,
  amount: '1', // preserve precision: always a decimal string
});

if (result.state === 'pending') {
  const status = await wallet.privacy.getTransactionStatus(result.id);
  console.log(status.state, status.txHash);
}
```

The wallet controls approvals, account selection, notes, proofs, fees and
submission. The SDK does not custody keys, produce proofs or broadcast by itself.
Connection never grants blanket permission to sign or send transactions.

## Discover the selected wallet

`getPlabsWallet()` is silent and returns `null` during SSR or if the provider is
missing. It reads the PLabs injected provider, never another wallet's
`window.ethereum`. To handle late injection or show a wallet picker:

```ts
import {
  discoverPlabsWallets,
  createPlabsWallet,
  detectPlabsProvider,
} from '@plabs-wallet/sdk';

const stopDiscovery = discoverPlabsWallets(({ info, provider }) => {
  // Render info as untrusted metadata. Use an <img> for its icon, not raw SVG HTML.
  // Let the user choose a provider, then call createPlabsWallet(provider).
});

const provider = await detectPlabsProvider({ timeoutMs: 3000 });
const wallet = createPlabsWallet(provider);
stopDiscovery(); // also call the disposer when your UI unmounts
```

`detectPlabsProvider` also accepts an `AbortSignal`. Neither discovery function
opens the wallet or connects an account. Self-reported wallet metadata/flags are
not cryptographic proof of publisher identity.

## API

| Method | Behavior |
| --- | --- |
| `wallet.connect()` | Request public EVM account access; return `{ accounts, chainId }` |
| `wallet.getAccounts()` | Silent authorized public address array; `[]` when unavailable |
| `wallet.capabilities()` | Read supported chains, pools and method flags |
| `wallet.open()` | Open the extension's toolbar popup |
| `wallet.disconnect()` | Revoke this origin's wallet account permission |
| `wallet.evm.connect()` | Same account request, returning the address array directly |
| `wallet.evm.getChainId()` | Current hexadecimal chain id |
| `wallet.evm.getPermissions()` | Read current origin permissions |
| `wallet.evm.requestPermissions()` | Request `eth_accounts` permission |
| `wallet.evm.switchChain(chainId)` | Ask the wallet to switch a supported chain |
| `wallet.evm.signMessage(text, address?)` | EVM `personal_sign`; UTF-8 text, not a privacy identity signature |
| `wallet.evm.previewTransaction(tx)` | Explicit preview only; returns `broadcast: false` |
| `wallet.privacy.getAddress()` | Ask separately to share the privacy receiving address |
| `wallet.privacy.sendTransaction(params)` | Request a private transfer through wallet confirmation |
| `wallet.privacy.shield(params)` | Deposit into the current account's privacy pool |
| `wallet.privacy.unshield(params)` | Withdraw to the current account's bound public address |
| `wallet.privacy.getTransactionStatus(id)` | Query this origin/account's submitted operation |

`shield` and `unshield` take `{ chainId, poolAddress, amount, feePool? }`.
They intentionally reject a `to` field: the wallet binds their destination.
`sendTransaction` takes `{ chainId, poolAddress, to, amount, feePool? }`.
Unknown fields, numeric/floating-point amounts and Zcash-specific parameters are
rejected. Address checksums, balances and final execution limits are validated
by the wallet, not trusted to website code.

For lower-level usage, `wallet.provider.request(...)` is available. Calling a
method does not bypass the wallet's capability checks or restrictions.

## Events and disconnection

```ts
const unsubscribe = wallet.subscribe('accountsChanged', accounts => {
  // Clear old-account sessions and refetch account-specific state.
  console.log(accounts);
});
wallet.on('chainChanged', chainId => console.log(chainId));

await wallet.disconnect();
unsubscribe();
// Also destroy your site's own server login session separately.
```

`on`/`removeListener` and `subscribe` are available on `wallet`, `wallet.evm` and
`wallet.privacy`. They forward provider lifecycle events; they do not claim that
EVM `accountsChanged` provides a list of private addresses.

Revoking account permissions causes `accountsChanged([])`. EIP-1193
`disconnect` represents transport/network loss, not site permission revocation.
Already-broadcast transactions cannot be cancelled by disconnecting.

## Error handling

```ts
import { PlabsWalletError, PLABS_ERROR_CODES } from '@plabs-wallet/sdk';
try {
  await wallet.connect();
} catch (error) {
  if (error instanceof PlabsWalletError &&
      error.code === PLABS_ERROR_CODES.USER_REJECTED) {
    // User rejected/cancelled the request. Do not automatically retry it.
  } else {
    throw error;
  }
}
```

Codes preserve the wallet's errors: 4001 rejected, 4100 unauthorized/locked,
4200 unsupported, 4900 disconnected, 4901/4902 chain mismatch/unsupported,
-32602 invalid parameters, -32002 a pending request, -32603 internal error.
A broadcast/submission error is not proof that no transaction reached the chain;
inspect wallet history before retrying a funds-moving request.

## Current wallet limits

- Supported networks/pools are reported by `capabilities()`.
- Privacy operations need an unlocked privacy account, synchronized notes and
  the wallet's experimental-write setting enabled.
- The wallet chooses native Gas or private fee payment according to its global
  preference. Requests require wallet intent approval and final confirmation.
- Public `eth_sendTransaction` and typed-data signing are currently disabled.
- Independent private-identity login/signMessage, raw private transaction
  signing, balances/notes/history disclosure and WalletConnect are not added by
  this package. No Zcash compatibility is claimed.
- Operation-status bindings are scoped to the requesting origin/account in the
  current browser session. Full wallet history stays within the wallet.

## Build and packaging

This package has **no runtime dependencies**. It ships ESM, CommonJS and
TypeScript declarations, with optional `@plabs-wallet/sdk/chains/evm` and
`@plabs-wallet/sdk/chains/privacy` entry points. Browser access is deferred until
an API is called; importing the package during SSR is safe.

From the extension workspace:

```sh
pnpm run build:sdk
pnpm run pack:sdk
```

The extension's dApp playground imports this package from the workspace. Local
build/package output is not registry publication, protocol certification or an
end-to-end transaction test. No automatic tests or real transactions were run
for this adaptation at the user's request.

See [UPSTREAM.md](UPSTREAM.md), [NOTICE.md](NOTICE.md) and LICENSE.upstream for
upstream provenance. License: MIT.

The current extension uses the Chrome 127+ toolbar popup for unlock and approval. Collapsing the popup retains the pending request; explicitly reject/cancel to stop it. Unlocking alone does not authorize a signature or transaction.

## 0.2.0 scoped privacy reads

Requires extension 0.6.0 capabilities (`privacyRead`, `privacyHistory`, `privacyNotes`, `dexOrders`). EVM connection alone never grants these scopes.

```ts
await wallet.connect();
await wallet.privacy.requestAccess(['address']);
const session = await wallet.privacy.getSession(); // silent, approved address only
await wallet.privacy.requestAccess(['balances', 'history']);
const portfolio = await wallet.privacy.getBalances();
const history = await wallet.privacy.getHistory({ page: 1, pageSize: 20 });
await wallet.privacy.revokeAccess();
```

Balances retain raw decimal strings; missing scans return null. History coverage is wallet operations plus received note summaries, not a guarantee of every historical outgoing transaction. `getNotes` needs the notes scope. `getDexOrders` needs dexOrders; import references with `importOfficialDexOrders` after explicitly confirming in the wallet. This enables official Matcher status reads, not private order placement or fund recovery.
