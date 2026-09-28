import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { encodeShield, encodeTransfer, encodeUnshield, unshieldRecipientMeta } from './operations';

const bytes = (value: number, size = 32) => Array.from({ length: size }, () => value);
const bundle = {
  anchor_orchard: bytes(1),
  actions: [{
    cmx: bytes(2),
    enc_ciphertext: bytes(3, 580),
    out_ciphertext: bytes(4, 80),
    ephemeral_key: bytes(5),
    nullifier: bytes(6),
    proof_bn254: bytes(7, 256),
    pub_fields_bn254: Array.from({ length: 8 }, (_, index) => bytes(index + 8)),
  }],
  binding_proof_bn254: Array.from({ length: 8 }, (_, index) => bytes(index + 16)),
};

describe('privacy transaction encoding', () => {
  it('pins the audited transfer selector', () => {
    expect(encodeTransfer(bundle)).toMatch(/^0xb2d4797b/);
  });

  it('round-trips shield amount through the audited ABI', () => {
    const data = encodeShield(500_000n, bundle);
    const contract = new Interface(['function shield(uint256,(bytes,uint256[8]))']);
    expect(contract.decodeFunctionData('shield', data)[0]).toBe(500_000n);
  });

  it('pins recipient, amount, context and executor for unshield', () => {
    const recipient = '0x000000000000000000000000000000000000dEaD';
    const data = encodeUnshield(2_000_000n, recipient, bundle);
    expect(data).toMatch(/^0x73a93e1b/);
    const contract = new Interface([
      'function unshield(uint256,address,bytes32,address,(bytes,uint256[8]))',
    ]);
    const decoded = contract.decodeFunctionData('unshield', data);
    expect(decoded[0]).toBe(2_000_000n);
    expect(decoded[1].toLowerCase()).toBe(recipient.toLowerCase());
    expect(decoded[2]).toBe(`0x${'00'.repeat(32)}`);
    expect(decoded[3]).toBe('0x0000000000000000000000000000000000000000');
    expect(unshieldRecipientMeta(recipient, 500_000n)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
