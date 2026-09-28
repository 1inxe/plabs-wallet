import { base64ToBytes, bytesToBase64 } from '../shared/encoding';
import type { ReadConsent, ReadContext } from './privacy-access';

const encoder = new TextEncoder();
export async function consentStoragePrefix(origin: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(origin)));
  return `privacy-site-consent:v1:${Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('')}:`;
}
export async function consentStorageKey(
  context: Pick<ReadContext, 'origin' | 'account' | 'privacyAddress'>,
) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`${context.account.toLowerCase()}|${context.privacyAddress}`),
    ),
  );
  return `${await consentStoragePrefix(context.origin)}${Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}
export async function sealConsent(consent: ReadConsent, id: string, key: CryptoKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(id) },
    key,
    encoder.encode(JSON.stringify(consent)),
  );
  return {
    version: 1,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
  };
}
export async function openConsent(
  value: unknown,
  id: string,
  key: CryptoKey,
): Promise<ReadConsent | undefined> {
  if (!value || typeof value !== 'object') return undefined;
  const box = value as { version: number; nonce: string; ciphertext: string };
  if (box.version !== 1 || typeof box.ciphertext !== 'string' || box.ciphertext.length > 20000)
    return undefined;
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Uint8Array.from(base64ToBytes(box.nonce)),
        additionalData: encoder.encode(id),
      },
      key,
      Uint8Array.from(base64ToBytes(box.ciphertext)),
    );
    const data = JSON.parse(new TextDecoder().decode(plain));
    return Array.isArray(data.scopes) &&
      data.scopes.length <= 5 &&
      Array.isArray(data.chainIds) &&
      data.chainIds.length <= 32
      ? (data as ReadConsent)
      : undefined;
  } catch {
    return undefined;
  }
}
