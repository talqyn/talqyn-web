import { parseHttpDate } from '../internal/json.js';
import { TalqynError, type TalqynTransportFailure } from './error.js';
import { TalqynLineSplitter } from './sse.js';

/** Headers in any of the shapes a transport has at hand. */
export type TalqynHeadersInit =
  | Readonly<Record<string, string>>
  | { forEach(callback: (value: string, key: string) => void): void };

/** The status line and headers of an HTTP response, without its body. */
export class TalqynHttpResponse {
  /** The HTTP status code. */
  readonly statusCode: number;

  /**
   * The response headers, keyed by **lowercased** field name.
   *
   * Header names are case-insensitive, and servers and proxies use whatever casing they like.
   * Prefer {@link header} over reading this directly.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * @param statusCode The HTTP status code.
   * @param headers The response headers in any casing — a plain object or a `Headers`; they are lowercased.
   */
  constructor(statusCode: number, headers: TalqynHeadersInit = {}) {
    this.statusCode = statusCode;
    const lowered: Record<string, string> = {};
    if (typeof (headers as { forEach?: unknown }).forEach === 'function') {
      (headers as { forEach(callback: (value: string, key: string) => void): void }).forEach((value, key) => {
        lowered[key.toLowerCase()] = value;
      });
    } else {
      for (const [key, value] of Object.entries(headers as Readonly<Record<string, string>>)) {
        lowered[key.toLowerCase()] = value;
      }
    }
    this.headers = Object.freeze(lowered);
  }

  /** A header value, matching the field name case-insensitively. */
  header(field: string): string | undefined {
    return this.headers[field.toLowerCase()];
  }

  /** Whether the status code is in the `2xx` range. */
  get isSuccess(): boolean {
    return this.statusCode >= 200 && this.statusCode < 300;
  }
}

const secondsPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * The `Retry-After` header as milliseconds from `now`, in either form the header allows: a delay in
 * seconds, or an HTTP date. A date already in the past reads as zero — "now" — rather than as a
 * negative wait. A value that reads as neither — `NaN` included — is no wait at all: `undefined`.
 *
 * In a browser the header reaches the SDK only when the API exposes it to the page
 * (`Access-Control-Expose-Headers`).
 */
export function responseRetryAfterMs(response: TalqynHttpResponse, now: number = Date.now()): number | undefined {
  const raw = response.header('Retry-After')?.trim();
  if (!raw) return undefined;
  if (secondsPattern.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? Math.max(seconds, 0) * 1000 : undefined;
  }
  const date = parseHttpDate(raw);
  return date ? Math.max(date.getTime() - now, 0) : undefined;
}

/**
 * A request the SDK hands its transport.
 *
 * Built by the SDK, fully formed: the URL is joined and escaped, the headers carry the token, the
 * request id, and `X-Talqyn-SDK`, and the body is the exact bytes to send.
 */
export interface TalqynHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The exact bytes to send. A mint request is signed over them, so they must go out unchanged. */
  readonly body?: Uint8Array | undefined;
  /**
   * How long to wait for the response and then for every next chunk of its body. The wait starts
   * over whenever a byte arrives — iOS's `URLSession` measures its request timeout the same way, and
   * a large body arriving slowly but steadily must not be cut short on one platform and land on the
   * other. A consultant turn may run far longer than one gap between its chunks.
   */
  readonly timeoutMs: number;
  /** Aborts when the caller cancels. A transport must stop the request and reject with `cancelled`. */
  readonly signal?: AbortSignal | undefined;
  /**
   * Whether the request must outlive the page — `fetch`'s `keepalive`. Set on events: a click on a
   * product card is usually followed at once by a navigation, and a request the page takes with it
   * is a click that never counted.
   */
  readonly keepalive: boolean;
}

/** A completed response: its status line, headers, and whole body. */
export interface TalqynHttpResult {
  readonly response: TalqynHttpResponse;
  readonly body: Uint8Array;
}

/** The body of a response, line by line, as it arrives. */
export type TalqynLineStream = AsyncIterable<string>;

/** A streamed response: its status line and headers, then its body as lines. */
export interface TalqynHttpStream {
  readonly response: TalqynHttpResponse;
  readonly lines: TalqynLineStream;
}

/**
 * The HTTP layer the SDK sends requests through.
 *
 * Implement this to route Talqyn traffic through a client of your own — a proxy, a traffic logger —
 * or to stub the network in tests. Pass it as `transport` in the configuration; the default is
 * {@link TalqynFetchTransport}.
 */
export interface TalqynHttpTransport {
  /**
   * Performs a request and returns the whole body.
   *
   * Must **not** reject on a non-`2xx` status: the SDK inspects the status itself and decodes the
   * error envelope from the body. Reject only when the request could not be completed — with a
   * `TalqynError` of kind `transport`, or `cancelled` once `request.signal` aborts; anything else is
   * wrapped as a `transport` failure.
   */
  send(request: TalqynHttpRequest): Promise<TalqynHttpResult>;

  /**
   * Performs a request and returns its body line by line, as it arrives.
   *
   * Used for the consultant's `text/event-stream` responses. The status line and headers must come
   * back **before** the first body line: the SDK decides from the status whether this is a stream to
   * parse or an error envelope to read. On a failing status the lines still carry the error body.
   * Split the body with {@link TalqynLineSplitter} — by the rules of SSE, not by every Unicode line
   * break, several of which are legal inside a JSON string.
   *
   * Leaving the iteration early — `break`, `return()` — and aborting `request.signal` must both
   * stop the request.
   */
  stream(request: TalqynHttpRequest): Promise<TalqynHttpStream>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Options of {@link TalqynFetchTransport}. */
export interface TalqynFetchTransportOptions {
  /** The `fetch` to send through. Defaults to the global one. */
  readonly fetch?: FetchLike;
  /**
   * The ceiling on a whole request, in milliseconds. The per-request timeout measures the gap
   * between chunks, and keep-alive comments from a proxy would reset it for ever. Defaults to
   * ten minutes.
   */
  readonly resourceTimeoutMs?: number;
}

/**
 * The default {@link TalqynHttpTransport}, backed by `fetch`.
 *
 * Requests carry no cookies (`credentials: "omit"`) and bypass the HTTP cache (`cache: "no-store"`):
 * results are per-tenant and personal, and no intermediary is allowed to store them. The server says
 * so in a header; the client does not rely on that alone.
 */
export class TalqynFetchTransport implements TalqynHttpTransport {
  private readonly fetchImpl: FetchLike | undefined;
  private readonly resourceTimeoutMs: number;

  constructor(options: TalqynFetchTransportOptions = {}) {
    this.fetchImpl = options.fetch;
    this.resourceTimeoutMs = options.resourceTimeoutMs ?? 600_000;
  }

  async send(request: TalqynHttpRequest): Promise<TalqynHttpResult> {
    const scope = new TalqynRequestScope(request.signal);
    try {
      // A request cancelled before it went out is not sent at all.
      if (scope.signal.aborted) throw scope.failure(undefined, 'network');
      scope.armIdle(request.timeoutMs);
      scope.armDeadline(this.resourceTimeoutMs);
      let response: Response;
      try {
        response = await this.fetch(request, scope.signal);
      } catch (error) {
        throw scope.failure(error, 'network');
      }
      scope.touch();
      try {
        const body = await collectBody(response, scope);
        return { response: new TalqynHttpResponse(response.status, response.headers), body };
      } catch (error) {
        throw scope.failure(error, 'connectionLost');
      }
    } finally {
      scope.dispose();
    }
  }

  async stream(request: TalqynHttpRequest): Promise<TalqynHttpStream> {
    const scope = new TalqynRequestScope(request.signal);
    if (scope.signal.aborted) {
      scope.dispose();
      throw scope.failure(undefined, 'network');
    }
    scope.armIdle(request.timeoutMs);
    scope.armDeadline(this.resourceTimeoutMs);
    let response: Response;
    try {
      response = await this.fetch(request, scope.signal);
    } catch (error) {
      scope.dispose();
      throw scope.failure(error, 'network');
    }
    scope.touch();
    return {
      response: new TalqynHttpResponse(response.status, response.headers),
      lines: readLines(response, scope),
    };
  }

  private fetch(request: TalqynHttpRequest, signal: AbortSignal): Promise<Response> {
    const init: RequestInit = {
      method: request.method,
      headers: request.headers as Record<string, string>,
      signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
    };
    if (request.body !== undefined) init.body = request.body as Uint8Array<ArrayBuffer>;
    if (request.keepalive) init.keepalive = true;
    const fetchImpl: FetchLike = this.fetchImpl ?? ((input, options) => globalThis.fetch(input, options));
    return fetchImpl(request.url, init);
  }
}

/**
 * The whole body of a unary response, read chunk by chunk so that every arriving byte restarts the
 * idle timer: `response.arrayBuffer()` would leave the timer running across the entire download.
 */
async function collectBody(response: Response, scope: TalqynRequestScope): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    scope.touch();
    chunks.push(chunk.value);
    total += chunk.value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function* readLines(response: Response, scope: TalqynRequestScope): AsyncGenerator<string, void, undefined> {
  const body = response.body;
  if (!body) {
    scope.dispose();
    return;
  }
  const reader = body.getReader();
  const splitter = new TalqynLineSplitter();
  let isSettled = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        isSettled = true;
        throw scope.failure(error, 'connectionLost');
      }
      if (chunk.done) break;
      scope.touch();
      for (const line of splitter.push(chunk.value)) yield line;
    }
    isSettled = true;
    const tail = splitter.finish();
    if (tail !== undefined) yield tail;
  } finally {
    if (!isSettled) {
      // Left before the end: a reader that stopped listening must not leave the request open.
      scope.release();
      reader.cancel().catch(() => undefined);
    }
    scope.dispose();
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** One request's cancellation and timers: the caller's signal, the gap between chunks, and the ceiling. */
class TalqynRequestScope {
  private readonly controller = new AbortController();
  private idleMs = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private timedOut = false;
  private cancelled = false;

  constructor(private readonly callerSignal: AbortSignal | undefined) {
    if (callerSignal?.aborted) {
      this.onCallerAbort();
    } else {
      callerSignal?.addEventListener('abort', this.onCallerAbort, { once: true });
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Times out when no byte arrives for `ms`; every {@link touch} starts the wait over. */
  armIdle(ms: number): void {
    this.idleMs = ms;
    this.touch();
  }

  touch(): void {
    if (this.idleMs <= 0) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(this.onTimeout, this.idleMs);
  }

  /** Times out `ms` from now, however the bytes flow. */
  armDeadline(ms: number): void {
    if (ms <= 0) return;
    this.deadlineTimer = setTimeout(this.onTimeout, ms);
  }

  /** Stops the request for nobody in particular: the reader left. */
  release(): void {
    if (!this.controller.signal.aborted) this.controller.abort(TalqynError.cancelled());
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    clearTimeout(this.deadlineTimer);
    this.callerSignal?.removeEventListener('abort', this.onCallerAbort);
  }

  /** What a failure of this request means, from what the scope knows about how it ended. */
  failure(error: unknown, fallback: TalqynTransportFailure): TalqynError {
    if (this.cancelled) return TalqynError.cancelled();
    if (this.timedOut) return TalqynError.transport('timedOut', error);
    if (TalqynError.is(error)) return error;
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    if (name === 'AbortError') return TalqynError.cancelled();
    return TalqynError.transport(fallback === 'network' && isOffline() ? 'offline' : fallback, error);
  }

  private readonly onCallerAbort = (): void => {
    this.cancelled = true;
    if (!this.controller.signal.aborted) this.controller.abort(TalqynError.cancelled());
  };

  private readonly onTimeout = (): void => {
    if (this.controller.signal.aborted) return;
    this.timedOut = true;
    this.controller.abort(TalqynError.transport('timedOut'));
  };
}
