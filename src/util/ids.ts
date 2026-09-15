import { randomUUID, randomBytes } from 'node:crypto';

/** Generate a globally-unique id (UUID v4). */
export function newId(): string {
  return randomUUID();
}

/**
 * Generate a short, url-safe id. Useful for SKUs / human-visible short refs.
 * Default length 10 characters from a base32-ish alphabet.
 */
export function shortId(length = 10): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
