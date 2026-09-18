const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The UTF-8 bytes of a string. */
export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** A string from UTF-8 bytes; malformed sequences are repaired rather than rejected. */
export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Lowercase hexadecimal, two characters a byte. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** One array from several, in order. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
