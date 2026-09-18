import { toHex } from './bytes.js';

/**
 * Cryptographically random bytes.
 *
 * `crypto.getRandomValues` is available in every browser and in insecure contexts too, unlike
 * `crypto.randomUUID`. There is no fallback to `Math.random`: a shopper id is protected only by
 * being unguessable.
 */
export function randomBytes(count: number): Uint8Array {
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is unavailable in this environment');
  }
  const bytes = new Uint8Array(count);
  source.getRandomValues(bytes);
  return bytes;
}

/** `byteCount` random bytes as lowercase hexadecimal. */
export function randomHex(byteCount: number): string {
  return toHex(randomBytes(byteCount));
}

/** A random version 4 UUID in its canonical lowercase form. */
export function makeUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a UUID in the textual form, of any version, in any case. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}
