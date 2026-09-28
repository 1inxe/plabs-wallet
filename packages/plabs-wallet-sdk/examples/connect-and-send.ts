import { getPlabsWallet, type PlabsPrivacySendParams } from '@plabs-wallet/sdk';

// Wire these functions to explicit UI buttons. No connection or transaction
// is initiated at module import time.
export async function connectWallet() {
  const wallet = getPlabsWallet();
  if (!wallet) throw new Error('Install PLabs Wallet and refresh the page.');
  const connection = await wallet.connect();
  return { wallet, connection };
}

export async function requestPrivateTransfer(params: PlabsPrivacySendParams) {
  const wallet = getPlabsWallet();
  if (!wallet) throw new Error('PLabs Wallet is unavailable.');
  return wallet.privacy.sendTransaction(params);
}

export async function disconnectWallet() {
  const wallet = getPlabsWallet();
  if (wallet) await wallet.disconnect();
}
