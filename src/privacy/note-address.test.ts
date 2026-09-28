import { expect, it } from 'vitest';
import { canonicalOwnedNote } from './note-address';
it('restores the recipient from the Note diversifier and receiver, preserving openings', () => {
  const note = {
    d_hex: 'ab'.repeat(11),
    pkd_hex: 'cd'.repeat(32),
    recipient_raw_address_hex: '00'.repeat(43),
    cmx_hex: '11'.repeat(32),
    rho_hex: '22'.repeat(32),
    rcm_hex: '33'.repeat(32),
    psi_hex: '44'.repeat(32),
  };
  expect(canonicalOwnedNote(note)).toEqual({
    ...note,
    recipient_raw_address_hex: note.d_hex + note.pkd_hex,
  });
  expect(note.recipient_raw_address_hex).toBe('00'.repeat(43));
});
it('does not invent a recipient when matched VNote openings have no separate address components', () => {
  const note = { recipient_raw_address_hex: 'ab'.repeat(43), rcm_hex: 'cd'.repeat(32) };
  expect(canonicalOwnedNote(note)).toBe(note);
});
