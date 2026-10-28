import { Transaction } from 'ethers';
import type { PrivacyActivity } from '../../shared/types';
import { formatPrivacyAddress } from '../address';
import type { MintJournal } from './journal';

/** Read existing encrypted recovery records, including transfers made before activity support. */
export function nftTransferActivities(
  journal: MintJournal,
  account: string,
): PrivacyActivity[] {
  return (journal.transfers ?? [])
    .filter(
      (transfer) =>
        !transfer.account ||
        transfer.account.toLowerCase() === account.toLowerCase(),
    )
    .map((transfer) => {
      const holding = journal.holdings?.find(
        (note) => `${note.pool}:${note.cmx}` === transfer.assetId,
      );
      const pool = journal.pools?.[transfer.pool];
      let maxGasWei: string | undefined;
      if (transfer.raw) {
        try {
          const tx = Transaction.from(transfer.raw);
          const price = tx.maxFeePerGas ?? tx.gasPrice;
          if (
            tx.hash === transfer.txHash &&
            tx.from?.toLowerCase() === account.toLowerCase() &&
            price !== null
          )
            maxGasWei = (tx.gasLimit * price).toString();
        } catch {
          /* Older recovery records can still be displayed without a fee estimate. */
        }
      }
      return {
        id: `nft-transfer:${transfer.id}`,
        nftTransferId: transfer.id,
        chainId: 1,
        kind: 'send',
        assetType: 'perc721',
        poolAddress: transfer.pool,
        collectionName: transfer.name ?? holding?.name ?? pool?.name ?? 'NFT',
        symbol: transfer.symbol ?? holding?.symbol ?? pool?.symbol ?? 'NFT',
        decimals: 0,
        tokenId: transfer.tokenId,
        recipient: formatPrivacyAddress(transfer.recipient),
        paymentMode: 'native',
        maxGasWei,
        status:
          transfer.state === 'confirmed'
            ? 'confirmed'
            : transfer.state === 'failed'
              ? 'failed'
              : transfer.state === 'submitted'
                ? 'pending'
                : 'review',
        stage: transfer.state,
        createdAt: transfer.createdAt,
        updatedAt: transfer.updatedAt ?? transfer.createdAt,
        txHashes: transfer.txHash ? [transfer.txHash] : [],
        mainTxHash: transfer.txHash,
        error: transfer.state === 'failed' ? transfer.message : undefined,
        refreshable: transfer.state === 'submitted' && Boolean(transfer.txHash),
        unreadable: false,
      };
    });
}
