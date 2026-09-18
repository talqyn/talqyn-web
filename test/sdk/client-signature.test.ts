import { afterEach, describe, expect, it, vi } from 'vitest';
import { TalqynClientSignature } from '../../src/sdk/index.js';
import { toHex } from '../../src/sdk/internal/bytes.js';
import { hmacSha256, sha256 } from '../../src/sdk/internal/sha256.js';

/**
 * The reference values come from the server's own algorithm
 * (`app/services/cip/device_token.sign_mint_request`): signing has to match it byte for byte, or
 * minting answers 401.
 */
const keyId = 'ck_3f9a1c2b7d4e';
const secret = 's3cr3t-client-key-value-32-chars-long';
const timestamp = '1756208100';
const nonce = '8c1d0b6e2f4a9b3c7d5e1f0a';
const encoder = new TextEncoder();

const namedBody = '{"storefront":"myshop","user_id":"6f1c2b9a-3e47-4b8f-9a10-2c5d8e7f4a01"}';
const namedSignature = 'ec3c1408b51f7abe58002c92db2d8d45411312188f3b81da618f83607140e92b';
const guestBody = '{"storefront":"myshop"}';
const guestSignature = 'cb146efcb273072c067e6753eb782d317004c9657c1e5e7d3fbe6a7515973afe';

describe('TalqynClientSignature', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('matches the server reference', async () => {
    const signature = await TalqynClientSignature.sign({ secret, keyId, timestamp, nonce, body: encoder.encode(namedBody) });
    expect(signature).toBe(namedSignature);
  });

  it('matches the server reference for a guest body', async () => {
    const signature = await TalqynClientSignature.sign({ secret, keyId, timestamp, nonce, body: encoder.encode(guestBody) });
    expect(signature).toBe(guestSignature);
  });

  it('signs a string body the same as its UTF-8 bytes', async () => {
    expect(await TalqynClientSignature.sign({ secret, keyId, timestamp, nonce, body: guestBody })).toBe(guestSignature);
  });

  /** Where WebCrypto is withheld — an insecure context — the fallback must produce the same bytes. */
  it('matches the server reference without WebCrypto', async () => {
    const webCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: webCrypto.getRandomValues.bind(webCrypto) });
    expect(globalThis.crypto.subtle).toBeUndefined();

    expect(await TalqynClientSignature.sign({ secret, keyId, timestamp, nonce, body: namedBody })).toBe(namedSignature);
    expect(await TalqynClientSignature.sign({ secret, keyId, timestamp, nonce, body: guestBody })).toBe(guestSignature);
  });

  it('assembles the signing input from five lines', async () => {
    const input = await TalqynClientSignature.signingInput({ keyId, timestamp, nonce, body: encoder.encode(guestBody) });
    const lines = new TextDecoder().decode(input).split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('talqyn-device-mint-v1');
    expect(lines[1]).toBe(keyId);
    expect(lines[2]).toBe(timestamp);
    expect(lines[3]).toBe(nonce);
    expect(lines[4]).toHaveLength(64);
  });

  it('builds the headers the server requires', async () => {
    const headers = await TalqynClientSignature.headers({ keyId, secret, body: encoder.encode('{}') });
    expect(headers['X-Client-Key']).toBe(keyId);
    expect(headers['X-Client-Timestamp']).toMatch(/^\d+$/);
    expect(headers['X-Client-Sig']).toHaveLength(64);

    const requestNonce = headers['X-Client-Nonce'] ?? '';
    // Server contract: 16-64 characters of [A-Za-z0-9_-].
    expect(requestNonce.length).toBeGreaterThanOrEqual(16);
    expect(requestNonce.length).toBeLessThanOrEqual(64);
    expect(requestNonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('stamps the timestamp in whole seconds', async () => {
    const headers = await TalqynClientSignature.headers({ keyId, secret, body: '{}', timestamp: 1_756_208_100_999, nonce });
    expect(headers['X-Client-Timestamp']).toBe('1756208100');
    const fromDate = await TalqynClientSignature.headers({ keyId, secret, body: '{}', timestamp: new Date(1_756_208_100_000), nonce });
    expect(fromDate['X-Client-Timestamp']).toBe('1756208100');
    expect(fromDate['X-Client-Sig']).toBe(headers['X-Client-Sig']);
  });

  it('generates a fresh nonce every time', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => TalqynClientSignature.makeNonce()));
    // A repeated nonce would be rejected by the server as a replayed request.
    expect(nonces.size).toBe(200);
  });
});

describe('the SHA-256 fallback', () => {
  const subtle = globalThis.crypto.subtle;

  function bytes(length: number, seed: number): Uint8Array {
    const result = new Uint8Array(length);
    for (let index = 0; index < length; index++) result[index] = (index * 31 + seed * 7 + 13) & 0xff;
    return result;
  }

  it('digests like WebCrypto at every block boundary', async () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = bytes(length, length);
      const expected = toHex(new Uint8Array(await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)));
      expect(toHex(sha256(data)), `${length} bytes`).toBe(expected);
    }
  });

  it('computes HMAC like WebCrypto for short, block-sized, and long keys', async () => {
    for (const keyLength of [1, 32, 63, 64, 65, 100, 200]) {
      for (const dataLength of [0, 1, 64, 1000]) {
        const key = bytes(keyLength, keyLength + 1);
        const data = bytes(dataLength, dataLength + 3);
        const imported = await subtle.importKey(
          'raw',
          key as Uint8Array<ArrayBuffer>,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const expected = toHex(new Uint8Array(await subtle.sign('HMAC', imported, data as Uint8Array<ArrayBuffer>)));
        expect(toHex(hmacSha256(key, data)), `key ${keyLength}, data ${dataLength}`).toBe(expected);
      }
    }
  });

  it('computes HMAC under an empty key', () => {
    // The known HMAC-SHA-256 of an empty message under an empty key.
    expect(toHex(hmacSha256(new Uint8Array(0), new Uint8Array(0)))).toBe(
      'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad',
    );
  });
});
