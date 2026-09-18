import { utf8Encode } from '../internal/bytes.js';
import { hmacSha256Hex, sha256Hex } from '../internal/crypto.js';
import { randomHex } from '../internal/random.js';

/**
 * Signs a device-token mint request with the storefront's client key.
 *
 * `POST /v1/consultant/token` is guarded by this signature rather than by a tenant key, because there
 * is no tenant key on a page to guard it with. The secret itself never travels: a request carries the
 * key id, a timestamp, a nonce, and an HMAC over the exact bytes of the body.
 *
 * ```
 * signing_input = "talqyn-device-mint-v1" + "\n"
 *               + key_id + "\n"
 *               + timestamp + "\n"
 *               + nonce + "\n"
 *               + hex(SHA256(body_bytes))
 * X-Client-Sig  = hex(HMAC-SHA256(secret, signing_input))
 * ```
 *
 * `body_bytes` must be **exactly** the bytes that go on the wire: serialize the body once and sign
 * what you send. Re-serializing can reorder keys or change whitespace, and the signature will not
 * match.
 *
 * The SDK performs this for you; the type is public so a storefront that mints tokens through its own
 * transport can reuse the same algorithm.
 */
export class TalqynClientSignature {
  /**
   * The context label baked into every signing input. Changing it invalidates every shipped build at
   * once, which is why the version lives inside the string itself.
   */
  static readonly context = 'talqyn-device-mint-v1';

  /**
   * The acceptance window: the server accepts a timestamp within ±300 s of its own clock. A timestamp
   * outside it means either a badly skewed device clock or a replayed request.
   */
  static readonly maxSkewMs = 300_000;

  private constructor() {}

  /**
   * Builds the four signature headers for a mint request body.
   *
   * @returns `X-Client-Key`, `X-Client-Timestamp`, `X-Client-Nonce`, and `X-Client-Sig`, ready to be
   *   merged into the request headers.
   */
  static async headers(init: {
    /** The client key id. */
    readonly keyId: string;
    /** The client key secret. Used to sign; never sent. */
    readonly secret: string;
    /** The exact request body that will be transmitted. */
    readonly body: Uint8Array | string;
    /** The moment to stamp the request with, as a `Date` or epoch milliseconds. Defaults to now. */
    readonly timestamp?: Date | number;
    /** The single-use request nonce. Defaults to a fresh random value. */
    readonly nonce?: string;
  }): Promise<Record<string, string>> {
    const moment = init.timestamp instanceof Date ? init.timestamp.getTime() : (init.timestamp ?? Date.now());
    const stamp = String(Math.trunc(moment / 1000));
    const nonce = init.nonce ?? TalqynClientSignature.makeNonce();
    const signature = await TalqynClientSignature.sign({
      secret: init.secret,
      keyId: init.keyId,
      timestamp: stamp,
      nonce,
      body: init.body,
    });
    return {
      'X-Client-Key': init.keyId,
      'X-Client-Timestamp': stamp,
      'X-Client-Nonce': nonce,
      'X-Client-Sig': signature,
    };
  }

  /**
   * Computes the `X-Client-Sig` value for a mint request.
   *
   * @returns `hex(HMAC-SHA256(secret, signingInput))`: 64 lowercase hexadecimal characters.
   */
  static async sign(init: {
    readonly secret: string;
    readonly keyId: string;
    /** Unix time in seconds, as a decimal string. */
    readonly timestamp: string;
    readonly nonce: string;
    readonly body: Uint8Array | string;
  }): Promise<string> {
    const input = await TalqynClientSignature.signingInput(init);
    return hmacSha256Hex(utf8Encode(init.secret), input);
  }

  /**
   * Assembles the bytes that get signed: the five newline-separated fields, UTF-8 encoded.
   *
   * The body enters as a digest rather than verbatim: the signature has to cover the exact bytes
   * sent, without depending on how they would be encoded inside a header.
   */
  static async signingInput(init: {
    readonly keyId: string;
    readonly timestamp: string;
    readonly nonce: string;
    readonly body: Uint8Array | string;
  }): Promise<Uint8Array> {
    const body = typeof init.body === 'string' ? utf8Encode(init.body) : init.body;
    const digest = await sha256Hex(body);
    return utf8Encode([TalqynClientSignature.context, init.keyId, init.timestamp, init.nonce, digest].join('\n'));
  }

  /**
   * Generates a single-use request nonce.
   *
   * The server remembers a nonce for the length of the acceptance window and rejects a repeat, so a
   * fresh value is required for **every** mint request.
   *
   * @returns 24 hexadecimal characters, within the contract's 16–64 character `[A-Za-z0-9_-]` range.
   */
  static makeNonce(): string {
    return randomHex(12);
  }
}
