import { AbiCoder, id } from 'ethers';

export const NOTE_ADDED_TOPIC = id('NoteAdded(bytes32,bytes,bytes,bytes32,bytes32,bytes32)');
export const LEGACY_NOTE_ADDED_TOPIC = id('NoteAdded(bytes32,bytes,bytes32,bytes32)');
export const NOTE_CONFIRMED_TOPIC = id('NoteConfirmed(bytes32,bytes32,uint256)');
const abi = AbiCoder.defaultAbiCoder();

export const decodePrivacyLog = (log: Record<string, unknown>) => {
  const topics = log.topics as string[];
  const topic = topics?.[0]?.toLowerCase();
  const blockNumber = Number(BigInt(String(log.blockNumber)));
  const base = {
    block_number: blockNumber,
    tx_hash: String(log.transactionHash).toLowerCase(),
    log_index: Number(BigInt(String(log.logIndex))),
    cmx: topics?.[1]?.toLowerCase(),
  };
  if (topic === NOTE_ADDED_TOPIC.toLowerCase()) {
    const decoded = abi.decode(['bytes', 'bytes', 'bytes32', 'bytes32', 'bytes32'], String(log.data));
    return {
      ...base,
      enc_ciphertext: decoded[0],
      out_ciphertext: decoded[1],
      epk: decoded[2],
      nf_old: decoded[3],
      cv_net_x: decoded[4],
      cmx_position: -1,
      is_confirmed: false,
    };
  }
  if (topic === NOTE_CONFIRMED_TOPIC.toLowerCase()) {
    const decoded = abi.decode(['bytes32', 'uint256'], String(log.data));
    return {
      ...base,
      confirmation_root: decoded[0],
      cmx_position: Number(decoded[1]),
      is_confirmed: true,
      enc_ciphertext: '0x',
    };
  }
  if (topic === LEGACY_NOTE_ADDED_TOPIC.toLowerCase()) {
    const decoded = abi.decode(['bytes', 'bytes32', 'bytes32'], String(log.data));
    return {
      ...base,
      enc_ciphertext: decoded[0],
      out_ciphertext: '0x',
      epk: decoded[1],
      nf_old: decoded[2],
      cmx_position: -1,
      is_confirmed: false,
    };
  }
  return null;
};
