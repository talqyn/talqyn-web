/**
 * What a {@link TalqynError} is about.
 *
 * The kinds follow the contract, and a minor release may add one when the contract does. Branch on
 * the kinds you react to and give the rest a `default` — or branch on
 * {@link TalqynError.isRetryable} and {@link TalqynError.statusCode} — so that a new kind does not
 * fall through a switch that thought it was exhaustive.
 */
export type TalqynErrorKind =
  /** `401` — the credentials were rejected even after the SDK reissued the device token once. */
  | 'unauthorized'
  /** `403` — issuance not enabled for the storefront, or chats read under a guest token. */
  | 'forbidden'
  /** `404` — nothing there; for a chat, also "not yours". */
  | 'notFound'
  /** `422` — the request body failed validation; see {@link TalqynError.fields}. */
  | 'validation'
  /** `429` — a rate-limit bucket is exhausted; see {@link TalqynError.retryAfterMs}. */
  | 'rateLimited'
  /** A `5xx`, or any other status the SDK maps to no other kind. */
  | 'server'
  /** `501` from the mint — device tokens are not configured on the installation. */
  | 'deviceTokensNotConfigured'
  /** `503` in the auth envelope from the mint — the storefront has no live anchor key. */
  | 'deviceTokensUnavailable'
  /** The request never completed; see {@link TalqynError.transportFailure}. */
  | 'transport'
  /** The response could not be decoded. */
  | 'decoding'
  /** The request body could not be encoded — nothing was sent. */
  | 'encoding'
  /** The SDK was configured in a way that cannot produce a request. */
  | 'invalidConfiguration'
  /** The request was cancelled through its `AbortSignal`, or superseded. */
  | 'cancelled';

/**
 * Why a request never completed.
 *
 * - `connectionLost` — the connection dropped mid-response, or a consultant stream ended before
 *   its `done`;
 * - `timedOut` — no byte arrived within the timeout, or the request outlived its ceiling;
 * - `offline` — the browser reports no network;
 * - `network` — `fetch` itself failed: DNS, TLS, a refused connection, or a CORS refusal, which a
 *   page is not allowed to tell apart;
 * - `unknown` — anything else, the original kept as `cause`.
 */
export type TalqynTransportFailure = 'connectionLost' | 'timedOut' | 'offline' | 'network' | 'unknown';

const brand = Symbol.for('com.talqyn.TalqynError');

interface TalqynErrorDetails {
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly retryAfterMs?: number | undefined;
  readonly statusCode?: number | undefined;
  readonly code?: string | undefined;
  readonly transportFailure?: TalqynTransportFailure | undefined;
  readonly reason?: string | undefined;
  readonly cause?: unknown;
}

/**
 * A failure returned by Talqyn or by the SDK on its way there.
 *
 * Every SDK call rejects with this type. It decodes both envelopes the contract defines —
 * `{"detail": …}` for authentication and rate limiting, `{"error": …, "request_id": …}` for
 * everything else — so a caller branches on {@link kind} rather than on a status code.
 *
 * Use {@link isRetryable} to tell a transient failure from a permanent one, and {@link requestId}
 * to quote a request when contacting Talqyn support.
 */
export class TalqynError extends Error {
  /** What the failure is about. */
  readonly kind: TalqynErrorKind;

  /** The server's explanation, when it sent one: `unauthorized`, `forbidden`, `validation`, `rateLimited`, `server`. */
  readonly detail: string | undefined;

  /** The `X-Request-ID` of the failed request, when the failure carries one: what Talqyn support needs. */
  readonly requestId: string | undefined;

  /**
   * For `validation`: dotted paths of the offending fields, for example `body.filters.0`. The
   * server never echoes the raw values. Empty for every other kind.
   */
  readonly fields: readonly string[];

  /**
   * How long to wait before repeating, in milliseconds, as the server instructed through
   * `Retry-After`. Only on `rateLimited` and `server`.
   */
  readonly retryAfterMs: number | undefined;

  /** The HTTP status behind the failure, or `undefined` when it never reached the server. */
  readonly statusCode: number | undefined;

  /**
   * For `server`: the `error` field of the envelope — `upstream_unavailable`,
   * `database_unavailable`, `overloaded`, or `internal_error`.
   */
  readonly code: string | undefined;

  /** For `transport`: why the request never completed. */
  readonly transportFailure: TalqynTransportFailure | undefined;

  /** For `invalidConfiguration`: what is wrong with the configuration. */
  readonly reason: string | undefined;

  private constructor(kind: TalqynErrorKind, details: TalqynErrorDetails) {
    super(describe(kind, details), details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'TalqynError';
    this.kind = kind;
    this.detail = details.detail;
    this.requestId = details.requestId;
    this.fields = details.fields ?? [];
    this.retryAfterMs = details.retryAfterMs;
    this.statusCode = details.statusCode;
    this.code = details.code;
    this.transportFailure = details.transportFailure;
    this.reason = details.reason;
    Object.defineProperty(this, brand, { value: true });
  }

  /**
   * The credentials were rejected (`401`).
   *
   * The SDK already reissued the device token and retried once before surfacing this, so reaching
   * it means reissuing did not help: the client key itself is invalid or revoked.
   */
  static unauthorized(init: { readonly detail?: string; readonly requestId?: string } = {}): TalqynError {
    return new TalqynError('unauthorized', { ...init, statusCode: 401 });
  }

  /**
   * The credentials are valid but not sufficient (`403`): device-token issuance is not enabled for
   * the storefront, or `/v1/consultant/chats` was read under a guest token, which names no shopper.
   */
  static forbidden(init: { readonly detail?: string; readonly requestId?: string } = {}): TalqynError {
    return new TalqynError('forbidden', { ...init, statusCode: 403 });
  }

  /**
   * Nothing was found at that address (`404`).
   *
   * For a chat this also means "not yours": an unknown session id and somebody else's answer
   * identically, on purpose — a `403` would confirm that the conversation exists.
   */
  static notFound(init: { readonly requestId?: string } = {}): TalqynError {
    return new TalqynError('notFound', { ...init, statusCode: 404 });
  }

  /** The request body failed validation (`422`). */
  static validation(
    init: { readonly fields?: readonly string[]; readonly detail?: string; readonly requestId?: string } = {},
  ): TalqynError {
    return new TalqynError('validation', { ...init, statusCode: 422 });
  }

  /** A rate-limit bucket is exhausted (`429`). */
  static rateLimited(
    init: { readonly retryAfterMs?: number; readonly detail?: string; readonly requestId?: string } = {},
  ): TalqynError {
    return new TalqynError('rateLimited', { ...init, statusCode: 429 });
  }

  /**
   * The server failed, or answered in a way the SDK maps to no other kind.
   *
   * A `5xx` is the server's own failure and is retried; any other status that lands here — a
   * `400`, a `405`, a redirect that was not followed — is a fixed answer to a fixed request and is
   * not.
   */
  static server(init: {
    readonly status: number;
    readonly code?: string;
    readonly detail?: string;
    readonly retryAfterMs?: number;
    readonly requestId?: string;
  }): TalqynError {
    const { status, ...rest } = init;
    return new TalqynError('server', { ...rest, statusCode: status });
  }

  /** Device tokens are not configured on this Talqyn installation (`501`): a support conversation, not "try later". */
  static deviceTokensNotConfigured(init: { readonly requestId?: string } = {}): TalqynError {
    return new TalqynError('deviceTokensNotConfigured', { ...init, statusCode: 501 });
  }

  /**
   * The storefront has no live anchor key to issue device tokens against (`503`). Also a support
   * conversation, though the SDK keeps retrying since the condition can clear on its own.
   */
  static deviceTokensUnavailable(init: { readonly requestId?: string } = {}): TalqynError {
    return new TalqynError('deviceTokensUnavailable', { ...init, statusCode: 503 });
  }

  /** The request never completed. */
  static transport(failure: TalqynTransportFailure, cause?: unknown): TalqynError {
    return new TalqynError('transport', { transportFailure: failure, cause });
  }

  /** The response could not be decoded into the expected model. */
  static decoding(cause: unknown, requestId?: string): TalqynError {
    return new TalqynError('decoding', { cause, requestId });
  }

  /**
   * The request body could not be encoded — a non-finite number in a price bound, for instance.
   * Nothing was sent: this is a programming error on the calling side, not an answer from the server.
   */
  static encoding(cause: unknown): TalqynError {
    return new TalqynError('encoding', { cause });
  }

  /** The SDK was configured in a way that cannot produce a request — an empty key, a base URL that does not parse. */
  static invalidConfiguration(reason: string): TalqynError {
    return new TalqynError('invalidConfiguration', { reason });
  }

  /** The request was cancelled. Nothing to show a shopper. */
  static cancelled(): TalqynError {
    return new TalqynError('cancelled', {});
  }

  /**
   * Whether repeating the request could plausibly succeed.
   *
   * `true` for rate limiting, `5xx` server failures, transport failures, and a storefront
   * temporarily without an anchor key; `false` for client errors, which would produce the same
   * answer again. The SDK already applies this through its retry policy; the property is public so
   * a screen can decide whether to offer "try again".
   */
  get isRetryable(): boolean {
    switch (this.kind) {
      case 'rateLimited':
      case 'transport':
      case 'deviceTokensUnavailable':
        return true;
      case 'server':
        return (this.statusCode ?? 0) >= 500;
      default:
        return false;
    }
  }

  /** Whether the failure is a cancellation — the request was superseded or its screen went away. */
  get isCancellation(): boolean {
    return this.kind === 'cancelled';
  }

  /**
   * Whether two failures are the same failure: the same kind with the same values. An underlying
   * cause has no equality of its own and is compared by its description — which is what a screen
   * that re-renders on a change needs: the same failure twice is no change.
   */
  equals(other: TalqynError | undefined): boolean {
    if (!other) return false;
    return (
      this.kind === other.kind &&
      this.detail === other.detail &&
      this.requestId === other.requestId &&
      this.retryAfterMs === other.retryAfterMs &&
      this.statusCode === other.statusCode &&
      this.code === other.code &&
      this.transportFailure === other.transportFailure &&
      this.reason === other.reason &&
      this.fields.length === other.fields.length &&
      this.fields.every((field, index) => field === other.fields[index]) &&
      String(this.cause) === String(other.cause)
    );
  }

  /**
   * Whether a value is a `TalqynError` — also one from another copy of the SDK on the same page,
   * which `instanceof` does not recognize.
   */
  static is(value: unknown): value is TalqynError {
    return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[brand] === true;
  }

  /**
   * Normalizes any caught value into a `TalqynError`.
   *
   * Every SDK call rejects with this type already, so a `catch` around one does not need this. A
   * `catch` around your own code does: an `AbortError` from your own signal arrives as itself, and
   * so does a failure of a transport of your own. Public so a storefront drawing its own screen does
   * not write this mapping a second time.
   *
   * @returns `error` itself when it already is a `TalqynError`, `cancelled` for an abort, a
   *   `transport` with `timedOut` for a `TimeoutError`, and a `transport` with `unknown` for
   *   anything else — the original kept as `cause`, so a failure of your own can still be told
   *   from any other.
   */
  static wrap(error: unknown): TalqynError {
    if (TalqynError.is(error)) return error;
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    if (name === 'AbortError') return TalqynError.cancelled();
    if (name === 'TimeoutError') return TalqynError.transport('timedOut', error);
    return TalqynError.transport('unknown', error);
  }
}

function describe(kind: TalqynErrorKind, details: TalqynErrorDetails): string {
  switch (kind) {
    case 'unauthorized':
      return details.detail ?? 'Talqyn: request is not authorized';
    case 'forbidden':
      return details.detail ?? 'Talqyn: access denied';
    case 'notFound':
      return 'Talqyn: not found';
    case 'validation': {
      const fields = details.fields ?? [];
      const where = fields.length === 0 ? '' : ` (${fields.join(', ')})`;
      return (details.detail ?? 'Talqyn: request failed validation') + where;
    }
    case 'rateLimited':
      return 'Talqyn: rate limit exceeded';
    case 'server':
      return details.detail ?? `Talqyn: server error ${details.statusCode ?? 0}${details.code ? ` (${details.code})` : ''}`;
    case 'deviceTokensNotConfigured':
      return 'Talqyn: device token issuance is not configured';
    case 'deviceTokensUnavailable':
      return 'Talqyn: device token issuance is temporarily unavailable';
    case 'transport':
      switch (details.transportFailure) {
        case 'connectionLost':
          return 'Talqyn: the connection was lost';
        case 'timedOut':
          return 'Talqyn: the request timed out';
        case 'offline':
          return 'Talqyn: the device is offline';
        case 'network':
          return 'Talqyn: the network request failed';
        default:
          // A failure that says nothing by its code says what it was.
          return details.cause === undefined ? 'Talqyn: request failed' : `Talqyn: request failed (${String(details.cause)})`;
      }
    case 'decoding':
      return `Talqyn: could not decode the response (${String(details.cause)})`;
    case 'encoding':
      return `Talqyn: could not encode the request (${String(details.cause)})`;
    case 'invalidConfiguration':
      return `Talqyn: invalid configuration — ${details.reason ?? ''}`;
    case 'cancelled':
      return 'Talqyn: request was cancelled';
  }
}
