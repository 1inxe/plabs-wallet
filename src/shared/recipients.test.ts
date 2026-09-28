import { describe, expect, it } from 'vitest';
import { normalizeRecipient } from './recipients';
import { formatPrivacyAddress } from '../privacy/address';

describe('recipient validation', () => {
  const privacy = formatPrivacyAddress('12'.repeat(43));
  it('normalizes valid EVM and privacy addresses', () => {
    expect(normalizeRecipient(' 0x1111111111111111111111111111111111111111 ', false)).toBe('0x1111111111111111111111111111111111111111');
    expect(normalizeRecipient(privacy.toUpperCase(), true)).toBe(privacy);
    expect(normalizeRecipient('0x' + '12'.repeat(43), true)).toBe(privacy);
  });
  it('rejects the wrong address type, broken checksum, and zero address', () => {
    expect(() => normalizeRecipient(privacy, false)).toThrow();
    expect(() => normalizeRecipient('0x' + '11'.repeat(20), true)).toThrow();
    expect(() => normalizeRecipient(privacy.slice(0, -1) + (privacy.endsWith('q') ? 'p' : 'q'), true)).toThrow();
    expect(() => normalizeRecipient('0x' + '00'.repeat(20), false)).toThrow();
    expect(() => normalizeRecipient('0x52908400098527886e0F7030069857D2E4169EE7', false)).toThrow();
  });
});
