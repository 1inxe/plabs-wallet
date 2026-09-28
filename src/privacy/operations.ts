import { AbiCoder, Interface, ZeroAddress, ZeroHash, hexlify, keccak256 } from 'ethers';

const transferInterface = new Interface([
  'function transfer((bytes actions,uint256[8] bindingProof))',
]);
const unshieldInterface = new Interface([
  'function unshield(uint256 amountUnits,address recipient,bytes32 context,address executor,(bytes actions,uint256[8] bindingProof) call)',
]);
const shieldInterface = new Interface([
  'function shield(uint256 amountUnits,(bytes actions,uint256[8] bindingProof) call)',
]);
const ACTION_TYPE =
  'tuple(bytes32 cmx,bytes encCiphertext,bytes outCiphertext,bytes32 ephemeralKey,bytes32 nullifier,bytes32 anchor,bytes proof,uint256[8] pubFields)[]';

const toBytes = (value: unknown): string | Uint8Array => {
  if (typeof value === 'string') return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value, Number);
  throw new Error('证明返回了无法编码的字节字段');
};

const bytes32 = (value: unknown) => {
  const result = hexlify(toBytes(value));
  if (!/^0x[0-9a-f]{64}$/i.test(result)) throw new Error('证明返回了无效 bytes32');
  return result;
};

const word = (value: unknown) => BigInt(bytes32(value));

export const encodePrivacyCall = (bundle: Record<string, any>) => {
  if (!Array.isArray(bundle?.actions) || bundle.actions.length === 0) {
    throw new Error('证明没有 actions');
  }
  if (!Array.isArray(bundle?.binding_proof_bn254) || bundle.binding_proof_bn254.length !== 8) {
    throw new Error('证明没有 binding proof');
  }
  const actions = bundle.actions.map((action: Record<string, any>) => {
    if (!Array.isArray(action.pub_fields_bn254) || action.pub_fields_bn254.length !== 8) {
      throw new Error('action public fields 无效');
    }
    return {
      cmx: bytes32(action.cmx),
      encCiphertext: hexlify(toBytes(action.enc_ciphertext)),
      outCiphertext: hexlify(toBytes(action.out_ciphertext)),
      ephemeralKey: bytes32(action.ephemeral_key),
      nullifier: bytes32(action.nullifier),
      anchor: bytes32(action.pub_fields_bn254[0] ?? bundle.anchor_orchard),
      proof: hexlify(toBytes(action.proof_bn254)),
      pubFields: action.pub_fields_bn254.map(word),
    };
  });
  return {
    actions: AbiCoder.defaultAbiCoder().encode([ACTION_TYPE], [actions]),
    bindingProof: bundle.binding_proof_bn254.map(word),
  };
};

export const encodeTransfer = (bundle: Record<string, any>) => {
  const data = transferInterface.encodeFunctionData('transfer', [encodePrivacyCall(bundle)]);
  if (!data.startsWith('0xb2d4797b')) throw new Error('Transfer selector 与审核 ABI 不一致');
  return data;
};

export const encodeShield = (amount: bigint, bundle: Record<string, any>) => {
  const data = shieldInterface.encodeFunctionData('shield', [amount, encodePrivacyCall(bundle)]);
  return data;
};

export const unshieldRecipientMeta = (recipient: string, fee: bigint, context = ZeroHash) =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'bytes32'], [recipient, fee, context]),
  );

export const encodeUnshield = (
  amount: bigint,
  recipient: string,
  bundle: Record<string, any>,
) => {
  const data = unshieldInterface.encodeFunctionData('unshield', [
    amount,
    recipient,
    ZeroHash,
    ZeroAddress,
    encodePrivacyCall(bundle),
  ]);
  if (!data.startsWith('0x73a93e1b')) throw new Error('Unshield selector 与审核 ABI 不一致');
  return data;
};

export const reverseHexByByte = (value: string) =>
  value.replace(/^0x/i, '').match(/.{2}/g)?.reverse().join('') ?? '';
