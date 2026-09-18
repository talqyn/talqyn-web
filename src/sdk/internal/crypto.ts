import { toHex } from './bytes.js';
import { hmacSha256, sha256 } from './sha256.js';

/** WebCrypto, where the page may use it: `crypto.subtle` is absent from insecure contexts. */
function subtle(): SubtleCrypto | undefined {
  const candidate = globalThis.crypto?.subtle;
  return candidate && typeof candidate.digest === 'function' ? candidate : undefined;
}

/** `hex(SHA-256(data))`. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const webCrypto = subtle();
  if (webCrypto) {
    try {
      return toHex(new Uint8Array(await webCrypto.digest('SHA-256', data as Uint8Array<ArrayBuffer>)));
    } catch {
      // The fallback below computes the same digest.
    }
  }
  return toHex(sha256(data));
}

/** `hex(HMAC-SHA-256(key, data))`. */
export async function hmacSha256Hex(key: Uint8Array, data: Uint8Array): Promise<string> {
  const webCrypto = subtle();
  // WebCrypto refuses an empty HMAC key; the fallback does not.
  if (webCrypto && key.length > 0) {
    try {
      const imported = await webCrypto.importKey(
        'raw',
        key as Uint8Array<ArrayBuffer>,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      return toHex(new Uint8Array(await webCrypto.sign('HMAC', imported, data as Uint8Array<ArrayBuffer>)));
    } catch {
      // The fallback below computes the same code.
    }
  }
  return toHex(hmacSha256(key, data));
}
