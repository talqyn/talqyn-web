import { throwIfAborted } from '../internal/async.js';
import { utf8Encode } from '../internal/bytes.js';
import { encodeJson, parseHttpDate, parseJson } from '../internal/json.js';
import { makeUuid } from '../internal/random.js';
import { emitLog, type TalqynLogHandler } from '../log.js';
import { TalqynDeviceToken } from '../models/device-token.js';
import { TalqynError } from '../networking/error.js';
import { errorFromResponse, parseErrorEnvelope } from '../networking/error-mapping.js';
import type { TalqynHttpResponse, TalqynHttpResult, TalqynHttpTransport } from '../networking/http-transport.js';
import type { TalqynRequestBuilder } from '../networking/request-builder.js';
import { TalqynClientSignature } from './client-signature.js';

/** A minted token and the clock correction it was minted with. */
export interface TalqynMinted {
  readonly token: TalqynDeviceToken;
  /** Server clock minus device clock, in milliseconds. Carried forward so the next mint signs with the right time from the first attempt. */
  readonly clockOffsetMs: number;
}

/** What {@link TalqynDeviceTokenMinter.mint} mints for. */
export interface TalqynMintRequest {
  readonly storefront: string;
  readonly clientKeyId: string;
  readonly clientSecret: string;
  /** The shopper to name, or `undefined` for a guest token. */
  readonly userId: string | undefined;
  /** The correction learned by a previous mint. */
  readonly clockOffsetMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Mints a device token: `POST /v1/consultant/token`.
 *
 * The endpoint is guarded by the storefront's client **signature**, not by a tenant key, so this does
 * not go through the shared authorization pipeline — there would be nothing to authorize it with.
 */
export class TalqynDeviceTokenMinter {
  /**
   * How far the device clock must be off before a `401` is read as a clock problem rather than a key
   * problem. A clock inside the acceptance window does not cause a `401`, so a small measured skew
   * leaves the refusal as it is.
   */
  static readonly clockToleranceMs = 60_000;

  private readonly builder: TalqynRequestBuilder;
  private readonly transport: TalqynHttpTransport;
  private readonly logHandler: TalqynLogHandler | undefined;

  constructor(init: {
    readonly builder: TalqynRequestBuilder;
    readonly transport: TalqynHttpTransport;
    readonly logHandler?: TalqynLogHandler | undefined;
  }) {
    this.builder = init.builder;
    this.transport = init.transport;
    this.logHandler = init.logHandler;
  }

  /**
   * Mints a token.
   *
   * A `401` is re-examined before it is surfaced: the response's `Date` header says what time the
   * server thinks it is, and if the device clock disagrees by more than
   * {@link TalqynDeviceTokenMinter.clockToleranceMs} the request is signed once more with the server's
   * time. A computer with a clock set by hand is otherwise locked out of search entirely — under a
   * device token, search depends on the mint too. (In a browser the header is readable only when the
   * API lists `Date` in `Access-Control-Expose-Headers`.)
   */
  async mint(request: TalqynMintRequest): Promise<TalqynMinted> {
    if (!request.clientKeyId || !request.clientSecret) {
      throw TalqynError.invalidConfiguration('storefront client key is empty');
    }
    if (!request.storefront) {
      throw TalqynError.invalidConfiguration('storefront slug is empty');
    }

    // Serialized exactly once: the signature must cover the bytes that go on the wire. Re-encoding
    // could reorder keys and break it.
    const body = utf8Encode(encodeJson({ storefront: request.storefront, user_id: request.userId }));

    let offset = request.clockOffsetMs ?? 0;
    let didCorrectClock = false;

    for (;;) {
      throwIfAborted(request.signal);
      const requestId = makeUuid();
      // A fresh nonce every time: the server rejects a repeat.
      const signature = await TalqynClientSignature.headers({
        keyId: request.clientKeyId,
        secret: request.clientSecret,
        body,
        timestamp: Date.now() + offset,
      });
      const httpRequest = this.builder.request({
        method: 'POST',
        path: 'consultant/token',
        body,
        headers: { ...signature, 'X-Request-ID': requestId },
        signal: request.signal,
      });

      let result: TalqynHttpResult;
      try {
        result = await this.transport.send(httpRequest);
      } catch (error) {
        throw TalqynError.wrap(error);
      }
      const received = Date.now();
      const { response } = result;

      if (response.isSuccess) {
        let token: TalqynDeviceToken | undefined;
        let cause: unknown;
        try {
          token = TalqynDeviceToken.decode(parseJson(result.body));
        } catch (error) {
          cause = error;
        }
        if (!token) throw TalqynError.decoding(cause ?? new Error('the mint response carries no token'), requestId);
        return { token, clockOffsetMs: offset };
      }

      if (response.statusCode === 401 && !didCorrectClock) {
        const date = response.header('Date');
        const serverTime = date === undefined ? undefined : parseHttpDate(date);
        if (serverTime) {
          const skew = serverTime.getTime() - received;
          if (Math.abs(skew - offset) > TalqynDeviceTokenMinter.clockToleranceMs) {
            didCorrectClock = true;
            // A skew inside the tolerance is a clock that is fine — the previous correction was the
            // problem — and the Date header's one-second precision is not worth keeping.
            offset = Math.abs(skew) <= TalqynDeviceTokenMinter.clockToleranceMs ? 0 : skew;
            emitLog(
              this.logHandler,
              'info',
              `device clock is off by ${Math.trunc(skew / 1000)}s; signing the mint with the server's time`,
              requestId,
            );
            continue;
          }
        }
      }

      const error = describeMintFailure(response, result.body, requestId);
      emitLog(this.logHandler, 'warning', `device token mint rejected: ${error.message}`, error.requestId);
      throw error;
    }
  }
}

/**
 * Minting has its own status codes, and they mean different things: 403 — not enabled for the
 * storefront, 501 — not configured on the installation, 503 — no live anchor key. The last two are
 * support conversations rather than "try later", hence their own error kinds.
 *
 * The storefront-level refusal arrives in the auth envelope, `{"detail": …}`. A `503` in the platform
 * envelope — `{"error": "overloaded", …}` — or a bare `503` from a proxy is an ordinary server failure
 * and must not read as "call support".
 */
function describeMintFailure(response: TalqynHttpResponse, body: Uint8Array, requestId: string): TalqynError {
  const envelope = parseErrorEnvelope(body);
  if (response.statusCode === 501) {
    return TalqynError.deviceTokensNotConfigured({ requestId: envelope?.requestId ?? requestId });
  }
  if (response.statusCode === 503 && envelope !== undefined && envelope.error === undefined && envelope.detail !== undefined) {
    return TalqynError.deviceTokensUnavailable({ requestId: envelope.requestId ?? requestId });
  }
  return errorFromResponse(response, body, requestId);
}
