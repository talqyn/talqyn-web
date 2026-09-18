import type { TalqynUserIdStore } from './auth/user-id-store.js';
import type { TalqynDeviceTokenCredentials, TalqynDeviceTokenCredentialsInit } from './credentials.js';
import type { TalqynLocale } from './locale.js';
import type { TalqynLogHandler } from './log.js';
import type { TalqynHttpTransport } from './networking/http-transport.js';

/**
 * Everything the client needs to talk to Talqyn.
 *
 * `credentials` and `baseUrl` are required; every other value has a working default.
 *
 * ```ts
 * const talqyn = new Talqyn({
 *   credentials: new TalqynDeviceTokenCredentials({
 *     storefront: 'myshop',
 *     clientKeyId: 'ck_3f9a1c2b7d4e',
 *     clientSecret: import.meta.env.VITE_TALQYN_CLIENT_SECRET,
 *   }),
 *   baseUrl: import.meta.env.VITE_TALQYN_BASE_URL,
 *   defaultLocale: 'en',
 *   defaultCityId: '10',
 * });
 * ```
 */
export interface TalqynConfiguration {
  /** The storefront's client key, which the SDK turns into a device token. */
  readonly credentials: TalqynDeviceTokenCredentials | TalqynDeviceTokenCredentialsInit;

  /**
   * The API host. The SDK ships no endpoint of its own: the host is named here like the client key
   * next to it, and it belongs in the build configuration beside that key, because the two change
   * together when a site moves between stands. A path prefix is preserved, so
   * `https://gateway.example.com/talqyn` works as-is.
   */
  readonly baseUrl: string;

  /**
   * The API version path segment. `v1` is canonical.
   *
   * Unprefixed paths remain working legacy aliases, but new integrations go through a version: a
   * breaking contract change ships as a new prefix alongside this one rather than by changing it.
   * Pass an empty string to address the unversioned aliases.
   */
  readonly apiVersion?: string;

  /** The locale applied to requests that do not name one. Defaults to `en`. */
  readonly defaultLocale?: TalqynLocale;

  /**
   * The shopper's city, applied to requests that name no place.
   *
   * The value is a `locations.external_id` **in your own catalog's numbering** — the same identifier
   * the city carries in your feed. Obtain it from the `id` of an option in the `city` group of
   * `talqyn.search.filters`.
   */
  readonly defaultCityId?: string;

  /** The shopper's specific store, applied to requests that name no place. A store beats a city. */
  readonly defaultLocationId?: string;

  /**
   * The storefront's A/B bucket: echoed into Talqyn analytics so a pilot can be compared against your
   * previous search, with no effect on results. `[A-Za-z0-9._:-]`, at most 32 characters.
   */
  readonly variant?: string;

  /** The timeout of an ordinary request, in milliseconds. Defaults to 30 000. */
  readonly timeoutMs?: number;

  /**
   * How long to wait for the **first** byte of a consultant stream, in milliseconds. Defaults to
   * 60 000. A whole turn may take longer: the wait restarts on every chunk received.
   */
  readonly streamTimeoutMs?: number;

  /** When and how often to repeat a failed request. Defaults to {@link TalqynRetryPolicy.default}. */
  readonly retryPolicy?: TalqynRetryPolicy;

  /**
   * Where the persistent anonymous shopper UUID and the device clock correction are kept. Defaults to
   * `localStorage`, with a fallback to memory where storage is blocked.
   */
  readonly userIdStore?: TalqynUserIdStore;

  /** The HTTP transport. Defaults to `fetch`. Substitute your own for a proxy or a traffic logger; tests use it to stub the network. */
  readonly transport?: TalqynHttpTransport;

  /** Where SDK diagnostics are delivered. Tokens, client secrets, and shopper ids are never passed to it. */
  readonly logHandler?: TalqynLogHandler;
}

/**
 * When and how often a failed request is repeated.
 *
 * Client errors (`4xx` other than `429`) are never repeated — a repeat produces the same answer.
 * `5xx` responses and dropped connections are repeated with exponential backoff. `429`, and a `5xx`
 * that names a wait, are repeated after `Retry-After` — but only when that wait fits under
 * `maxDelayMs`. A server asking for a minute is not answered with a five-second retry into the same
 * exhausted bucket: the error is surfaced at once, with `retryAfterMs` for the app to act on.
 *
 * The policy says how often; the request says whether at all. A request that may have been carried
 * out before its answer was lost is repeated only when the server certainly did not carry it out: an
 * event is repeated after a `429` alone, a consultant turn — an LLM call, paid for — after a refusal
 * it got before it started, never after a connection that dropped under it.
 *
 * Backoff waits carry jitter: each is drawn between half and all of its exponential step. During an
 * outage every visitor fails at the same moment, and without the spread they would all come back at
 * the same moment too.
 */
export interface TalqynRetryPolicy {
  /** How many additional attempts to make after the first one fails. */
  readonly maxRetries: number;
  /** The first backoff interval, in milliseconds. Doubles on every attempt. Defaults to 300. */
  readonly baseDelayMs?: number;
  /**
   * The ceiling on any single wait, in milliseconds. Defaults to 5 000.
   *
   * Backoff is capped here. A `Retry-After` above it is not capped but declined: the request is not
   * repeated at all. A search field must not hang for seconds on a keystroke, and a retry that comes
   * back before the server said it would only adds a request to the exhausted bucket.
   */
  readonly maxDelayMs?: number;
}

export const TalqynRetryPolicy = {
  /** Two retries with a 300 ms base delay, capped at 5 s. The default. */
  default: Object.freeze({ maxRetries: 2, baseDelayMs: 300, maxDelayMs: 5_000 }) as TalqynRetryPolicy,

  /** No retries: the first failure is the result. */
  none: Object.freeze({ maxRetries: 0, baseDelayMs: 300, maxDelayMs: 5_000 }) as TalqynRetryPolicy,

  /**
   * The wait before the next attempt, in milliseconds, or `undefined` when the policy declines to
   * repeat: the server named a wait longer than `maxDelayMs`.
   *
   * @param attempt How many retries were made before this one.
   * @param retryAfterMs The server's own wait, which is not jittered.
   * @param jitter Where between half and all of the backoff step the wait falls, from 0 to 1. Random by default.
   */
  delay(
    policy: TalqynRetryPolicy,
    attempt: number,
    retryAfterMs: number | undefined,
    jitter: number = Math.random(),
  ): number | undefined {
    const maxDelay = policy.maxDelayMs ?? 5_000;
    if (retryAfterMs !== undefined) {
      return retryAfterMs > maxDelay ? undefined : Math.max(retryAfterMs, 0);
    }
    const step = Math.min((policy.baseDelayMs ?? 300) * 2 ** attempt, maxDelay);
    return step * (0.5 + 0.5 * Math.min(Math.max(jitter, 0), 1));
  },
} as const;
