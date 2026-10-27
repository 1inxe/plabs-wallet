import { AbiCoder, Interface, Transaction, ZeroHash, getBytes, hexlify, keccak256 } from 'ethers';
import type { NftMintRequest } from 'plabs-js-sdk';

export const NFT = {
  chainId: 1,
  market: '0x48269ee92a420fb1ba3db94a1593c233fa33068e',
  factory: '0x7c573e4a37ae1cd826678df732508aa6619e3196',
  api: 'https://app.plabs.online/nft-intake/v1',
  retired: ['0x9b8567c7a5ea98db6330be5945e8d14abba25758'],
} as const;
export type Json = Record<string, unknown>;
export function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('NFT 服务数据无效');
  return value as Json;
}
export function raw(value: unknown, size: number): string {
  if (typeof value !== 'string' || !new RegExp(`^(0x)?[0-9a-f]{${size * 2}}$`, 'i').test(value))
    throw new Error('NFT 字节字段无效');
  return value.replace(/^0x/i, '').toLowerCase();
}
export const address = (value: unknown) => `0x${raw(value, 20)}`;
export const hash = (value: unknown) => `0x${raw(value, 32)}`;
export const integer = (value: unknown) => {
  const n =
    typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value))
      ? Number(value)
      : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0)
    throw new Error('NFT 数量或时间无效');
  return n;
};
export function parseMintRequest(input: unknown): NftMintRequest {
  const value = object(input);
  if (
    Object.keys(value).some((key) => !['chainId', 'poolAddress'].includes(key)) ||
    ![1, '0x1'].includes(value.chainId as number | string)
  )
    throw new Error('NFT 铸造仅接受 Ethereum 合集意图');
  const pool = address(value.poolAddress);
  if ((NFT.retired as readonly string[]).includes(pool)) throw new Error('此测试合集已停用');
  return { chainId: 1 as const, poolAddress: pool };
}
export const mintTuple =
  '(uint256[8] proof,bytes32 cmx,bytes32 nf,bytes32 epk,bytes enc,bytes out)';
export const nftInterface = new Interface([
  'function isCollection(address) view returns(bool)',
  'function poolCount() view returns(uint256)',
  'function pools(uint256) view returns(address)',
  'function minter() view returns(address)',
  'function name() view returns(string)',
  'function symbol() view returns(string)',
  'function launches(address) view returns(address,uint8,uint256,uint256,uint64,uint64,uint64,address,bool,bool,uint256,uint256)',
  'function freeMintPermitSigner(address) view returns(address)',
  'function exists(uint256) view returns(bool)',
  'function cmxExists(bytes32) view returns(bool)',
  'function isSpent(bytes32) view returns(bool)',
  `function mintNoteHash(${mintTuple}) pure returns(bytes32)`,
  `function buy(address,uint256,${mintTuple},(bytes actions,uint256[8] bindingProof))`,
  `function buyWithPermit(address,uint256,${mintTuple},(bytes actions,uint256[8] bindingProof),bytes32,uint64,bytes)`,
]);
export type MintNote = {
  proof: string[];
  cmx: string;
  nf: string;
  epk: string;
  enc: string;
  out: string;
};
const abi = AbiCoder.defaultAbiCoder();
function byteField(value: unknown, size: number): string {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) throw new Error('NFT 证明字节无效');
  const list = Array.from(value as ArrayLike<unknown>);
  if (
    list.length !== size ||
    list.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw new Error('NFT 证明字节长度无效');
  return hexlify(Uint8Array.from(list as number[]));
}
export function mintEnvelope(value: unknown, privacy: string, tokenId: string) {
  const result = object(value),
    bundle = object(result.bundle),
    note = object(result.owned_note);
  if (
    !Array.isArray(bundle.actions) ||
    bundle.actions.length !== 1 ||
    !Array.isArray(bundle.mint_proof_bn254) ||
    bundle.mint_proof_bn254.length !== 8
  )
    throw new Error('NFT 证明协议不匹配');
  const action = object(bundle.actions[0]);
  const mint: MintNote = {
    proof: bundle.mint_proof_bn254.map((n) => byteField(n, 32)),
    cmx: byteField(action.cmx, 32),
    nf: byteField(action.nullifier, 32),
    epk: byteField(action.ephemeral_key, 32),
    enc: byteField(action.enc_ciphertext, 580),
    out: byteField(action.out_ciphertext, 80),
  };
  if (
    mint.proof.every((n) => BigInt(n) === 0n) ||
    hash(note.cmx_hex) !== mint.cmx ||
    raw(note.recipient_raw_address_hex, 43) !== raw(privacy, 43) ||
    String(note.value_sats) !== tokenId ||
    (bundle.nf_hex !== undefined && hash(bundle.nf_hex) !== mint.nf)
  )
    throw new Error('NFT 输出不属于当前钱包或指定编号');
  for (const key of ['rho_hex', 'psi_hex', 'rcm_hex']) raw(note[key], 32);
  return { mint, note, bundle };
}
export function mintCallHash(mint: MintNote) {
  return keccak256(
    abi.encode(
      ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
      [mint.cmx, mint.nf, mint.epk, keccak256(mint.enc), keccak256(mint.out)],
    ),
  );
}
export type Permit =
  | { required: false }
  | { required: true; reservationId: string; deadline: number; signature: string };
export function parsePermit(input: unknown): Permit {
  const value = object(input);
  if (value.required === false) return { required: false };
  if (value.required !== true) throw new Error('NFT mint 许可无效');
  const deadline = integer(value.deadline);
  if (deadline * 1000 <= Date.now()) throw new Error('NFT mint 许可已过期，请恢复原铸造');
  return {
    required: true,
    reservationId: hash(value.reservationId),
    deadline,
    signature: `0x${raw(value.signature, 65)}`,
  };
}
export function encodeMint(pool: string, tokenId: string, mint: MintNote, permit: Permit) {
  const args: unknown[] = [
    pool,
    BigInt(tokenId),
    mint,
    { actions: '0x', bindingProof: Array(8).fill(0n) },
  ];
  if (permit.required) args.push(permit.reservationId, permit.deadline, permit.signature);
  return nftInterface.encodeFunctionData(permit.required ? 'buyWithPermit' : 'buy', args);
}
export function inspectMintTransaction(input: unknown, minimumPermitMs = 0) {
  const value = object(input);
  if (
    value.to !== NFT.market ||
    value.chainId !== 1 ||
    value.value !== '0x0' ||
    typeof value.data !== 'string' ||
    !/^0x[0-9a-f]+$/i.test(value.data) ||
    value.data.length > 20_000
  )
    throw new Error('NFT 交易与指定市场不符');
  const call = nftInterface.parseTransaction({ data: value.data });
  if (!call || !['buy', 'buyWithPermit'].includes(call.name)) throw new Error('NFT 方法不允许');
  const pool = parseMintRequest({ chainId: 1, poolAddress: call.args[0] }).poolAddress;
  const tokenId = String(call.args[1]);
  if (
    BigInt(tokenId) < 1n ||
    BigInt(tokenId) > 100_000n ||
    call.args[3].actions !== '0x' ||
    call.args[3].bindingProof.some((n: bigint) => n !== 0n)
  )
    throw new Error('NFT mint 不允许附加付款');
  if (
    getBytes(call.args[2].enc).length !== 580 ||
    getBytes(call.args[2].out).length !== 80 ||
    call.args[2].cmx === ZeroHash
  )
    throw new Error('NFT mint 输出无效');
  if (call.name === 'buyWithPermit' && BigInt(call.args[5]) * 1000n <= BigInt(Date.now() + minimumPermitMs))
    throw new Error(minimumPermitMs ? 'NFT mint 许可有效期不足，请恢复原 mint 获取新许可' : 'NFT mint 许可已过期');
  return { poolAddress: pool, tokenId };
}
export function verifySignedTransaction(value: unknown, expected: Json, account: string) {
  const result = object(value);
  if (typeof result.raw !== 'string') throw new Error('NFT 签名结果无效');
  const tx = Transaction.from(result.raw);
  if (
    !tx.isSigned() ||
    tx.chainId !== 1n ||
    tx.to?.toLowerCase() !== expected.to ||
    tx.from?.toLowerCase() !== account.toLowerCase() ||
    tx.value !== 0n ||
    tx.data !== expected.data ||
    !tx.hash ||
    tx.hash !== result.hash
  )
    throw new Error('NFT 签名交易与已批准意图不符');
  return { raw: result.raw, hash: tx.hash, nonce: tx.nonce };
}
export const privacyTag = (privacy: string) => keccak256(`0x${raw(privacy, 43)}`);
export function ownershipMessage(pool: string, privacy: string, nonce: string, expires: number) {
  return [
    'PrivaSea allowlisted free mint',
    `Chain ID: 1`,
    `Market: ${NFT.market}`,
    `Pool: ${pool}`,
    `Privacy wallet: ${privacyTag(privacy)}`,
    `Raw address: ${raw(privacy, 43)}`,
    `Nonce: ${nonce}`,
    `Expires: ${expires}`,
  ].join('\n');
}
