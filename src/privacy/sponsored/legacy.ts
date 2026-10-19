// Compatibility metadata for records created before the protocol-level API.
// New activity profiles and the transfer engine do not use these constants.
export const LEGACY = Object.freeze({
  api: 'https://app.plabs.online/nft-jubjub/v1',
  chainId: 143,
  pool: '0x59df8637654d1ecb090ab7881b703b5a856d2780',
  indexer: 'https://monad-indexer.plabs.online',
  recipient: '4449ad291565b82847b77c7d1358898a4094cacef26e518867d1485ef4f8b6656e64b12827bbaa7d357a0d',
  genesis: '0x0c47353304f22b1c15706367d739b850cda80b5c87bbc335014fef3d88deaac9',
  confirmations: 12,
  memoPrefixHex: '0x5045524332302d4a55424a55422d5032302d763100',
});
