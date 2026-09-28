import { bech32m } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { formatPrivacyAddress, parsePrivacyAddress } from './address';

const RAW_ADDRESS = 'ccfad8d2ec4849ec854e5af65967b7dde196633d6fc7554d3f815f32f805be676b842b97067738831ce32a';
const PERC_ADDRESS = 'perc1enad35hvfpy7ep2wttm9jeahmhsevceadlr42nfls90n97q9henkhpptjur8wwyrrn3j5r4rsgz';

describe('privacy address parsing', () => {
  it('accepts raw 43-byte addresses', () => {
    expect(parsePrivacyAddress(`0x${'12'.repeat(43)}`)).toBe('12'.repeat(43));
  });

  it('decodes perc bech32m addresses', () => {
    const bytes = Uint8Array.from({ length: 43 }, (_, index) => index + 1);
    const address = bech32m.encode('perc', bech32m.toWords(bytes), 1023);
    expect(parsePrivacyAddress(address)).toBe(
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
  });

  it('encodes the official PLabs perc1 representation', () => {
    expect(formatPrivacyAddress(`0x${RAW_ADDRESS}`)).toBe(PERC_ADDRESS);
    expect(parsePrivacyAddress(PERC_ADDRESS)).toBe(RAW_ADDRESS);
  });

  it('rejects mixed-case addresses', () => {
    expect(() => parsePrivacyAddress('PeRc1invalid')).toThrow('不能混合大小写');
  });
});
