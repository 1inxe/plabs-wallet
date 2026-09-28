# PLabs Privacy Wallet

**English** | [简体中文](README.zh-CN.md)

A Chrome extension for managing EVM accounts and PLabs privacy assets. It stores encrypted wallets locally and synchronizes privacy assets inside the extension.

- Manage multiple EVM accounts and send native coins or ERC-20 tokens on Monad, Ethereum, Base and Arbitrum.
- Create or import an independent privacy account for each EVM account, with a separate password.
- Synchronize PLabs privacy assets on Monad and Ethereum; receive, send, shield and merge supported assets.
- Connect to dApps, sign messages and approve access to selected privacy data.

[Web application](https://github.com/1inxe/plabs-network) · [JavaScript SDK](https://github.com/1inxe/plabs-js-sdk)

## Build and install

Requirements: Node.js 22, pnpm 9.15.4 and Chrome 127 or newer.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the generated `dist/` directory.
3. Pin PLabs Privacy Wallet to the toolbar and open it.

After changing the source, rebuild and reload the extension on `chrome://extensions`. Refresh connected websites so they load the updated provider.

## Set up your wallet

1. Create a wallet or import a mnemonic/private key.
2. Set a wallet password and back up the recovery material shown during setup.
3. Use the account menu to add, import, rename or switch EVM accounts. Accounts share the wallet password.
4. Open **Privacy assets** to create a separate privacy account or import an encrypted Vault. Set or enter its independent privacy password.

To import from the PLabs website, select **Read from PLabs website**. Once `app.plabs.online` is open, select the action again to read the encrypted Vault associated with the current EVM address. Enter the privacy password in the extension to decrypt it locally.

Unlocking privacy assets starts synchronization for the selected network. New accounts start from their saved creation block; imported accounts resume verified checkpoints or scan from pool deployment. No local helper service is needed.

## Use assets

- **Receive:** copy the public or privacy address, or display its QR code. Use the address type required by the sender.
- **Send:** open an asset, enter the recipient and amount, then review network and fees before confirming.
- **Shield:** deposit supported public ERC-20 tokens into the privacy pool. The public account needs native gas.
- **Unshield:** withdraw to the current EVM account. Currently limited to Monad sUSDC.
- **Notes:** open privacy asset details to inspect spendable/pending notes and merge selected notes in batches.
- **Activity:** view transaction status and hashes in the wallet. Local history and PEX recovery records are not included in ordinary Vault exports; retain extension storage while operations remain unresolved.

Settings provides automatic locking, privacy password changes, encrypted Vault export and a gas payment preference: native coin or supported privacy asset through the relayer. Export a new Vault after changing its password; older exports still use the old password.

Privacy writes require **experimental mainnet operations** to be enabled in settings and remain subject to supported pools and wallet confirmation. Swap and Ethereum Unshield are unavailable. Website-initiated `eth_sendTransaction` and `eth_signTypedData_v4` are disabled; sending public assets inside the wallet is supported. See [security boundaries](docs/SECURITY.md).

## Development and dApp integration

```sh
pnpm run dev        # UI development server
pnpm run dev:dapp   # dApp example at http://127.0.0.1:5174/dapp.html
pnpm run build     # TypeScript checks and production build
```

The installed extension runs from `dist/`, not the development server. The dApp example uses the real injected provider and requires the extension to be installed and unlocked. See the [integration guide](docs/DAPP-INTEGRATION.md) for connection, read permissions and transaction requests.

`src/` contains the extension and example; `public/` contains the manifest, runtime icons, fonts and proving assets. The pinned SDK archive in `vendor/` allows standalone installation without a sibling SDK checkout.

Update the English and Chinese READMEs together when changing documentation.

## License and privacy

No repository-wide license has been declared. Third-party components retain their own licenses; see [licensing](LICENSING.md) and [third-party notices](THIRD-PARTY-NOTICES.md). The [privacy policy draft](docs/privacy-policy.html) documents data handling and is not yet an effective published policy.
