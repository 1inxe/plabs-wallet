import { AbiCoder } from 'ethers';
import { describe, expect, it } from 'vitest';
import { decodePrivacyLog, LEGACY_NOTE_ADDED_TOPIC, NOTE_ADDED_TOPIC, NOTE_CONFIRMED_TOPIC } from './events';

const cmx = `0x${'11'.repeat(32)}`;
const txHash = `0x${'22'.repeat(32)}`;

describe('PLabs event decoding', () => {
  it('decodes the current-v2 NoteAdded event exactly', () => {
    const data = AbiCoder.defaultAbiCoder().encode(
      ['bytes', 'bytes', 'bytes32', 'bytes32', 'bytes32'],
      ['0xaabb', '0xccdd', `0x${'33'.repeat(32)}`, `0x${'44'.repeat(32)}`, `0x${'55'.repeat(32)}`],
    );
    expect(
      decodePrivacyLog({
        topics: [NOTE_ADDED_TOPIC, cmx],
        data,
        blockNumber: '0x64',
        transactionHash: txHash,
        logIndex: '0x3',
      }),
    ).toMatchObject({
      block_number: 100,
      tx_hash: txHash,
      log_index: 3,
      cmx,
      enc_ciphertext: '0xaabb',
      out_ciphertext: '0xccdd',
      is_confirmed: false,
    });
  });

  it('decodes legacy NoteAdded events during historical recovery', () => {
    const epk = `0x${'33'.repeat(32)}`;
    const nf = `0x${'44'.repeat(32)}`;
    const data = AbiCoder.defaultAbiCoder().encode(['bytes', 'bytes32', 'bytes32'], ['0xaabb', epk, nf]);
    expect(decodePrivacyLog({
      topics: [LEGACY_NOTE_ADDED_TOPIC, cmx], data, blockNumber: '0x64',
      transactionHash: txHash, logIndex: '0x3',
    })).toMatchObject({ cmx, enc_ciphertext: '0xaabb', out_ciphertext: '0x', epk, nf_old: nf, is_confirmed: false });
  });

  it('decodes NoteConfirmed root and position', () => {
    const root = `0x${'66'.repeat(32)}`;
    const data = AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [root, 1589295]);
    expect(
      decodePrivacyLog({
        topics: [NOTE_CONFIRMED_TOPIC, cmx],
        data,
        blockNumber: '0x65',
        transactionHash: txHash,
        logIndex: '0x4',
      }),
    ).toMatchObject({
      block_number: 101,
      cmx,
      confirmation_root: root,
      cmx_position: 1589295,
      is_confirmed: true,
    });
  });
});
