/** A Note can belong to a diversified address of this account, rather than its default address. */
export function canonicalOwnedNote<T extends Record<string, unknown>>(note: T): T {
  const clean = (value: unknown) =>
    typeof value === 'string' ? value.replace(/^0x/i, '').toLowerCase() : '';
  const diversifier = clean(note.d_hex),
    receiver = clean(note.pkd_hex);
  if (!/^[0-9a-f]{22}$/.test(diversifier) || !/^[0-9a-f]{64}$/.test(receiver)) return note;
  const address = `${diversifier}${receiver}`;
  return clean(note.recipient_raw_address_hex) === address
    ? note
    : { ...note, recipient_raw_address_hex: address };
}
