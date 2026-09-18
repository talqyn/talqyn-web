import { TalqynDeviceTokenAuthorizer } from '../../src/sdk/auth/device-token-authorizer.js';
import { TalqynDeviceTokenMinter } from '../../src/sdk/auth/device-token-minter.js';
import { TalqynRequestBuilder } from '../../src/sdk/networking/request-builder.js';
import {
  Talqyn,
  TalqynDeviceIdentity,
  TalqynDeviceTokenCredentials,
  TalqynError,
  TalqynHttpResponse,
  TalqynInMemoryUserIdStore,
  TalqynRetryPolicy,
  type TalqynHttpRequest,
  type TalqynHttpResult,
  type TalqynHttpStream,
  type TalqynHttpTransport,
  type TalqynLogEvent,
  type TalqynLogHandler,
  type TalqynUserIdStore,
} from '../../src/sdk/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A request the SDK handed its transport, with the parts tests look at. */
export class Sent {
  constructor(readonly request: TalqynHttpRequest) {}

  /** The path, trailing slash kept: it is part of the instant-search endpoint address. */
  get path(): string {
    return new URL(this.request.url).pathname;
  }

  get query(): string | undefined {
    const search = new URL(this.request.url).search;
    return search ? search.slice(1) : undefined;
  }

  get method(): string {
    return this.request.method;
  }

  get bodyText(): string {
    return this.request.body ? decoder.decode(this.request.body) : '';
  }

  get bodyJson(): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(this.bodyText);
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  header(field: string): string | undefined {
    const wanted = field.toLowerCase();
    for (const [name, value] of Object.entries(this.request.headers)) {
      if (name.toLowerCase() === wanted) return value;
    }
    return undefined;
  }
}

interface Canned {
  readonly body: string;
  readonly status: number;
  readonly headers: Record<string, string>;
}

interface CannedStream {
  readonly lines: readonly string[];
  readonly status: number;
  readonly headers: Record<string, string>;
}

type Queued<T> = { readonly value: T } | { readonly error: unknown };

/** The error a stub reports when a test did not line up enough responses. */
export class QueueEmptyError extends Error {
  constructor() {
    super('the stub transport has no response queued');
  }
}

export const TOKEN_JSON = '{"token":"tlqd_test","expires_at":"2026-08-26T12:15:00Z","expires_in":900}';

/** A stub transport: a queue of canned responses and a record of what the SDK actually sent. */
export class StubTransport implements TalqynHttpTransport {
  private responses: Queued<Canned>[] = [];
  private streams: Queued<CannedStream>[] = [];
  private recorded: Sent[] = [];

  get sent(): Sent[] {
    return [...this.recorded];
  }

  /** Forgets what was sent so far — the mint a fixture performed on the caller's behalf. */
  clearSent(): void {
    this.recorded = [];
  }

  enqueue(json: string, init: { readonly status?: number; readonly headers?: Record<string, string> } = {}): void {
    this.responses.push({ value: { body: json, status: init.status ?? 200, headers: init.headers ?? {} } });
  }

  enqueueError(error: unknown): void {
    this.responses.push({ error });
  }

  /** Puts a response **ahead** of everything queued so far: for a mint a fixture performs before the responses a test already lined up. */
  prepend(json: string, status = 200): void {
    this.responses.unshift({ value: { body: json, status, headers: {} } });
  }

  enqueueStream(lines: readonly string[], init: { readonly status?: number; readonly headers?: Record<string, string> } = {}): void {
    this.streams.push({ value: { lines, status: init.status ?? 200, headers: init.headers ?? {} } });
  }

  /** A stream that never opens: the request failed before any answer came. */
  enqueueStreamError(error: unknown): void {
    this.streams.push({ error });
  }

  enqueueDeviceToken(init: { readonly token?: string; readonly expiresIn?: number; readonly userId?: string } = {}): void {
    const user = init.userId === undefined ? '' : `"user_id":"${init.userId}",`;
    this.enqueue(
      `{"token":"${init.token ?? 'tlqd_test'}",${user}"expires_at":"2026-08-26T12:15:00Z","expires_in":${init.expiresIn ?? 900}}`,
    );
  }

  async send(request: TalqynHttpRequest): Promise<TalqynHttpResult> {
    this.recorded.push(new Sent(request));
    const next = this.responses.shift();
    if (!next) throw new QueueEmptyError();
    if ('error' in next) throw next.error;
    return { response: new TalqynHttpResponse(next.value.status, next.value.headers), body: encoder.encode(next.value.body) };
  }

  async stream(request: TalqynHttpRequest): Promise<TalqynHttpStream> {
    this.recorded.push(new Sent(request));
    const next = this.streams.shift();
    if (!next) throw new QueueEmptyError();
    if ('error' in next) throw next.error;
    return { response: new TalqynHttpResponse(next.value.status, next.value.headers), lines: linesOf(next.value.lines) };
  }
}

async function* linesOf(lines: readonly string[]): AsyncGenerator<string, void, undefined> {
  for (const line of lines) yield line;
}

/** Waits `ms`, or rejects with `cancelled` when the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(TalqynError.cancelled());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(TalqynError.cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A transport whose stream delivers lines with a delay, like a network does.
 *
 * A {@link StubTransport} yields everything at once, which hides every question about what happens
 * **during** a turn — cancellation above all.
 */
export class SlowStreamTransport implements TalqynHttpTransport {
  readonly responses = new StubTransport();
  private lines: readonly string[] = [];
  private keepsOpen = false;
  private terminated = false;
  private streamed: Sent[] = [];

  /** Whether the stream handed out was cancelled or drained. */
  get wasTerminated(): boolean {
    return this.terminated;
  }

  /** The streamed requests, in the order they were made. */
  get streamedRequests(): Sent[] {
    return [...this.streamed];
  }

  /**
   * @param lines What every stream handed out delivers.
   * @param options.keepsOpen Whether the stream stays open after its last line, the way a server or a
   *   proxy holds an idle connection: it then ends only when the SDK cancels it.
   */
  enqueueStream(lines: readonly string[], options: { readonly keepsOpen?: boolean } = {}): void {
    this.lines = lines;
    this.keepsOpen = options.keepsOpen ?? false;
    this.terminated = false;
  }

  send(request: TalqynHttpRequest): Promise<TalqynHttpResult> {
    return this.responses.send(request);
  }

  async stream(request: TalqynHttpRequest): Promise<TalqynHttpStream> {
    this.streamed.push(new Sent(request));
    const lines = this.lines;
    const keepsOpen = this.keepsOpen;
    const onEnd = (): void => {
      this.terminated = true;
    };
    async function* generate(): AsyncGenerator<string, void, undefined> {
      try {
        for (const line of lines) {
          await delay(20, request.signal);
          yield line;
        }
        // An idle connection is a stream nobody finishes: its reader waits for a next line until it cancels.
        if (keepsOpen) await delay(60_000, request.signal);
      } finally {
        onEnd();
      }
    }
    return { response: new TalqynHttpResponse(200), lines: generate() };
  }
}

/**
 * A transport that answers every request through a function of the test's, so a response can wait,
 * fail, or have something happen on its way. The mint is answered for it, and a request cancelled while
 * the function answers it is noted.
 */
export class ScriptedTransport implements TalqynHttpTransport {
  private recorded: Sent[] = [];
  private cancelled: string[] = [];

  constructor(private readonly handler: (request: TalqynHttpRequest) => Promise<{ body: string; status?: number }>) {}

  get sent(): Sent[] {
    return [...this.recorded];
  }

  /** The paths of the requests cancelled while the function answered them. */
  get cancelledPaths(): string[] {
    return [...this.cancelled];
  }

  static json(body: string, status = 200): { body: string; status: number } {
    return { body, status };
  }

  async send(request: TalqynHttpRequest): Promise<TalqynHttpResult> {
    const sent = new Sent(request);
    if (sent.path.endsWith('/consultant/token')) {
      return { response: new TalqynHttpResponse(200), body: encoder.encode(TOKEN_JSON) };
    }
    this.recorded.push(sent);
    try {
      const result = await this.handler(request);
      return { response: new TalqynHttpResponse(result.status ?? 200), body: encoder.encode(result.body) };
    } catch (error) {
      if (request.signal?.aborted) this.cancelled.push(sent.path);
      throw error;
    }
  }

  async stream(request: TalqynHttpRequest): Promise<TalqynHttpStream> {
    this.recorded.push(new Sent(request));
    throw new QueueEmptyError();
  }
}

/** A clock that moves only when told to. */
export class FakeClock {
  now = Date.now();

  advance(ms: number): void {
    this.now += ms;
  }
}

/** Collects log events from the SDK. */
export class LogCollector {
  readonly events: TalqynLogEvent[] = [];
  readonly handler: TalqynLogHandler = (event) => {
    this.events.push(event);
  };
}

export const CLIENT_SECRET = 's3cr3t-client-key-value-32-chars-long';

export const TestFixtures = {
  deviceToken(identity: TalqynDeviceIdentity = TalqynDeviceIdentity.guest): TalqynDeviceTokenCredentials {
    return new TalqynDeviceTokenCredentials({
      storefront: 'myshop',
      clientKeyId: 'ck_3f9a1c2b7d4e',
      clientSecret: CLIENT_SECRET,
      identity,
    });
  },

  /** The host the tests address: the SDK has none of its own, so every fixture names one. */
  baseUrl: 'https://api.example.com',

  client(init: {
    readonly transport: TalqynHttpTransport;
    readonly credentials?: TalqynDeviceTokenCredentials;
    readonly baseUrl?: string;
    readonly retryPolicy?: TalqynRetryPolicy;
    readonly cityId?: string;
    readonly userIdStore?: TalqynUserIdStore;
    readonly logHandler?: TalqynLogHandler;
  }): Talqyn {
    return new Talqyn({
      credentials: init.credentials ?? TestFixtures.deviceToken(),
      baseUrl: init.baseUrl ?? TestFixtures.baseUrl,
      defaultCityId: init.cityId,
      retryPolicy: init.retryPolicy ?? TalqynRetryPolicy.none,
      userIdStore: init.userIdStore ?? new TalqynInMemoryUserIdStore(),
      transport: init.transport,
      logHandler: init.logHandler,
    });
  },

  /** A client that already holds a device token, with the mint forgotten by the transport: for tests about endpoints, not about the token. */
  async preparedClient(
    transport: StubTransport,
    init: {
      readonly retryPolicy?: TalqynRetryPolicy;
      readonly cityId?: string;
      readonly logHandler?: TalqynLogHandler;
      readonly baseUrl?: string;
    } = {},
  ): Promise<Talqyn> {
    // Ahead of the queue: tests line their responses up before the client exists.
    transport.prepend(TOKEN_JSON);
    const talqyn = TestFixtures.client({ transport, ...init });
    await talqyn.prepare();
    transport.clearSent();
    return talqyn;
  },

  /** The device-token authorizer on its own, with a clock the test controls. */
  authorizer(init: {
    readonly transport: TalqynHttpTransport;
    readonly clock: FakeClock;
    readonly identity?: TalqynDeviceIdentity;
    readonly store?: TalqynUserIdStore;
    readonly logHandler?: TalqynLogHandler;
  }): TalqynDeviceTokenAuthorizer {
    const builder = new TalqynRequestBuilder(TestFixtures.baseUrl, 'v1', 30_000);
    return new TalqynDeviceTokenAuthorizer({
      credentials: TestFixtures.deviceToken(init.identity ?? TalqynDeviceIdentity.guest),
      store: init.store ?? new TalqynInMemoryUserIdStore(),
      minter: new TalqynDeviceTokenMinter({ builder, transport: init.transport, logHandler: init.logHandler }),
      logHandler: init.logHandler,
      now: () => init.clock.now,
    });
  },
} as const;

/** Polls a condition for up to `timeoutMs`: background work has no handle to await. */
export async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await condition()) return true;
    } catch {
      // A condition that throws is a condition not yet met.
    }
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Collects every event of an async iterable. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

/** The `event:`/`data:`/blank triple of one SSE event. */
export function sseEvent(name: string, data: string): string[] {
  return [`event: ${name}`, `data: ${data}`, ''];
}

/** Rejects unless the promise rejects with a `TalqynError`; resolves with that error. */
export async function talqynFailure(promise: Promise<unknown>): Promise<TalqynError> {
  try {
    await promise;
  } catch (error) {
    if (TalqynError.is(error)) return error;
    throw new Error(`expected a TalqynError, got ${String(error)}`);
  }
  throw new Error('expected a failure');
}
