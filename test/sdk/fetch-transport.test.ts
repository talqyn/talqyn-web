import { describe, expect, it } from 'vitest';
import {
  TalqynDeviceIdentity,
  TalqynFetchTransport,
  type TalqynConsultantEvent,
  type TalqynHttpRequest,
} from '../../src/sdk/index.js';
import { TestFixtures, collect, delay, talqynFailure } from '../support/stub-transport.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A `fetch` that answers through a function of the test's and remembers what it was handed. */
function recordingFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>): {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    },
  };
}

/**
 * A response body delivered chunk by chunk, the way a network delivers it. Like a real `fetch`, an
 * aborted request errors the body.
 */
function chunked(
  chunks: readonly string[],
  init: RequestInit,
  options: { readonly then?: 'close' | 'stall' | 'fail'; readonly gapMs?: number } = {},
): ReadableStream<Uint8Array> {
  let index = 0;
  const signal = init.signal ?? undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        'abort',
        () => {
          try {
            controller.error(signal.reason);
          } catch {
            // Already closed.
          }
        },
        { once: true },
      );
    },
    async pull(controller) {
      const chunk = chunks[index];
      if (chunk !== undefined) {
        if (options.gapMs) await delay(options.gapMs);
        index += 1;
        controller.enqueue(encoder.encode(chunk));
        return;
      }
      switch (options.then ?? 'close') {
        case 'close':
          controller.close();
          return;
        case 'fail':
          controller.error(new TypeError('terminated'));
          return;
        case 'stall':
          await new Promise<void>(() => undefined);
      }
    },
  });
}

function request(overrides: Partial<TalqynHttpRequest> = {}): TalqynHttpRequest {
  return {
    method: 'POST',
    url: 'https://stub.talqyn.test/v1/consultant/ask',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', 'X-Talqyn-SDK': 'web/1.0.0' },
    body: encoder.encode('{"question":"q"}'),
    timeoutMs: 30_000,
    keepalive: false,
    ...overrides,
  };
}

/** Never answers, until the request is aborted. */
function silentFetch(): ReturnType<typeof recordingFetch> {
  return recordingFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
  );
}

/** The default transport end to end, over a stubbed `fetch`: headers come back before the body, and the body is split into lines the way the SDK expects. */
describe('TalqynFetchTransport', () => {
  it('returns the body, the status, and lowercased headers', async () => {
    const { fetch } = recordingFetch(
      (_url, init) =>
        new Response(chunked(['{"detail":"Rate limit exceeded"}'], init), {
          status: 429,
          headers: { 'Retry-After': '7', 'X-Request-ID': 'req-1' },
        }),
    );
    const { response, body } = await new TalqynFetchTransport({ fetch }).send(request());
    expect(response.statusCode).toBe(429);
    expect(response.isSuccess).toBe(false);
    expect(response.header('retry-after')).toBe('7');
    expect(response.header('X-REQUEST-ID')).toBe('req-1');
    expect(response.headers['x-request-id']).toBe('req-1');
    expect(decoder.decode(body)).toBe('{"detail":"Rate limit exceeded"}');
  });

  it('hands fetch the request as built, without cookies or the HTTP cache', async () => {
    const { fetch, calls } = recordingFetch((_url, init) => new Response(chunked(['{}'], init), { status: 200 }));
    const transport = new TalqynFetchTransport({ fetch });
    await transport.send(request());
    await transport.send(request({ method: 'GET', body: undefined, keepalive: true, url: 'https://stub.talqyn.test/v1/events/search' }));

    const [post, beacon] = calls;
    expect(post?.url).toBe('https://stub.talqyn.test/v1/consultant/ask');
    expect(post?.init.method).toBe('POST');
    expect(post?.init.headers).toMatchObject({ Accept: 'text/event-stream', 'X-Talqyn-SDK': 'web/1.0.0' });
    expect(decoder.decode(post?.init.body as Uint8Array)).toBe('{"question":"q"}');
    expect(post?.init.credentials).toBe('omit');
    expect(post?.init.cache).toBe('no-store');
    expect(post?.init.redirect).toBe('follow');
    expect(post?.init.keepalive).toBeUndefined();
    expect(post?.init.signal).toBeInstanceOf(AbortSignal);

    expect(beacon?.init.method).toBe('GET');
    expect(beacon?.init.body).toBeUndefined();
    expect(beacon?.init.keepalive).toBe(true);
  });

  it('splits a stream into lines across chunks', async () => {
    const { fetch } = recordingFetch(
      (_url, init) =>
        new Response(
          chunked(
            [
              'event: status\r',
              '\ndata: {"stage":"thinking"}\r\n\r\nevent: delta\ndata: {"text":"a b"}\n\n',
              'event: done\ndata: {"session_id":"s"}',
            ],
            init,
          ),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    const { response, lines } = await new TalqynFetchTransport({ fetch }).stream(request());
    expect(response.statusCode).toBe(200);
    expect(await collect(lines)).toEqual([
      'event: status',
      'data: {"stage":"thinking"}',
      '',
      'event: delta',
      'data: {"text":"a b"}',
      '',
      'event: done',
      'data: {"session_id":"s"}',
    ]);
  });

  it('reads a streamed error body as lines', async () => {
    const { fetch } = recordingFetch(
      (_url, init) => new Response(chunked(['{"detail":"Invalid device token"}'], init), { status: 401 }),
    );
    const { response, lines } = await new TalqynFetchTransport({ fetch }).stream(request());
    expect(response.statusCode).toBe(401);
    expect(await collect(lines)).toEqual(['{"detail":"Invalid device token"}']);
  });

  it('streams nothing from a response without a body', async () => {
    const { fetch } = recordingFetch(() => new Response(null, { status: 200 }));
    const { lines } = await new TalqynFetchTransport({ fetch }).stream(request());
    expect(await collect(lines)).toEqual([]);
  });

  it('stops the request when the reader leaves early', async () => {
    const { fetch, calls } = recordingFetch(
      (_url, init) => new Response(chunked(['data: 1\n', 'data: 2\n'], init, { then: 'stall' }), { status: 200 }),
    );
    const { lines } = await new TalqynFetchTransport({ fetch }).stream(request());
    for await (const line of lines) {
      expect(line).toBe('data: 1');
      break;
    }
    expect(calls[0]?.init.signal?.aborted).toBe(true);
  });

  it('rejects with cancelled when the caller aborts before the response', async () => {
    const silent = silentFetch();
    const transport = new TalqynFetchTransport({ fetch: silent.fetch });

    const sending = new AbortController();
    const pendingSend = transport.send(request({ signal: sending.signal }));
    sending.abort();
    expect((await talqynFailure(pendingSend)).kind).toBe('cancelled');

    const streaming = new AbortController();
    const pendingStream = transport.stream(request({ signal: streaming.signal }));
    streaming.abort();
    expect((await talqynFailure(pendingStream)).kind).toBe('cancelled');
    expect(silent.calls).toHaveLength(2);
  });

  /** A request cancelled before it went out is not sent at all — not handed to `fetch` to be refused there. */
  it('does not send a request whose signal already aborted', async () => {
    const silent = silentFetch();
    const transport = new TalqynFetchTransport({ fetch: silent.fetch });

    expect((await talqynFailure(transport.send(request({ signal: AbortSignal.abort() })))).kind).toBe('cancelled');
    expect((await talqynFailure(transport.stream(request({ signal: AbortSignal.abort() })))).kind).toBe('cancelled');
    expect(silent.calls).toEqual([]);
  });

  it('rejects with cancelled when the caller aborts mid-stream', async () => {
    const { fetch } = recordingFetch(
      (_url, init) => new Response(chunked(['data: 1\n'], init, { then: 'stall' }), { status: 200 }),
    );
    const controller = new AbortController();
    const { lines } = await new TalqynFetchTransport({ fetch }).stream(request({ signal: controller.signal }));
    const seen: string[] = [];
    const error = await talqynFailure(
      (async () => {
        for await (const line of lines) {
          seen.push(line);
          controller.abort();
        }
      })(),
    );
    expect(seen).toEqual(['data: 1']);
    expect(error.kind).toBe('cancelled');
  });

  it('times out a request that sends nothing back', async () => {
    const transport = new TalqynFetchTransport({ fetch: silentFetch().fetch });
    const error = await talqynFailure(transport.send(request({ timeoutMs: 30 })));
    expect(error.kind).toBe('transport');
    expect(error.transportFailure).toBe('timedOut');
  });

  it('times out a stream whose response never comes', async () => {
    const transport = new TalqynFetchTransport({ fetch: silentFetch().fetch });
    const error = await talqynFailure(transport.stream(request({ timeoutMs: 30 })));
    expect(error.transportFailure).toBe('timedOut');
  });

  it('times out a stream that goes quiet', async () => {
    const { fetch } = recordingFetch(
      (_url, init) => new Response(chunked(['data: 1\n'], init, { then: 'stall' }), { status: 200 }),
    );
    const { lines } = await new TalqynFetchTransport({ fetch }).stream(request({ timeoutMs: 50 }));
    const seen: string[] = [];
    const error = await talqynFailure(
      (async () => {
        for await (const line of lines) seen.push(line);
      })(),
    );
    expect(seen).toEqual(['data: 1']);
    expect(error.kind).toBe('transport');
    expect(error.transportFailure).toBe('timedOut');
  });

  /** The stream's timeout is the gap between chunks: a turn longer than it that keeps talking is not cut short. */
  it('does not time out a stream that keeps talking', async () => {
    const { fetch } = recordingFetch(
      (_url, init) =>
        new Response(chunked(['data: 1\n', 'data: 2\n', 'data: 3\n', 'data: 4\n', 'data: 5\n'], init, { gapMs: 25 }), {
          status: 200,
        }),
    );
    const { lines } = await new TalqynFetchTransport({ fetch }).stream(request({ timeoutMs: 80 }));
    expect(await collect(lines)).toEqual(['data: 1', 'data: 2', 'data: 3', 'data: 4', 'data: 5']);
  });

  it('cuts a stream that outlives its ceiling however it talks', async () => {
    const { fetch } = recordingFetch(
      (_url, init) =>
        new Response(chunked(Array.from({ length: 40 }, (_, index) => `data: ${index}\n`), init, { gapMs: 10 }), {
          status: 200,
        }),
    );
    const { lines } = await new TalqynFetchTransport({ fetch, resourceTimeoutMs: 60 }).stream(request({ timeoutMs: 1_000 }));
    const error = await talqynFailure(collect(lines));
    expect(error.transportFailure).toBe('timedOut');
  });

  it('reports a failed fetch as a network failure', async () => {
    const { fetch } = recordingFetch(() => Promise.reject(new TypeError('fetch failed')));
    const error = await talqynFailure(new TalqynFetchTransport({ fetch }).send(request()));
    expect(error.kind).toBe('transport');
    expect(error.transportFailure).toBe('network');
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.isRetryable).toBe(true);
  });

  it('reports a body that breaks mid-stream as a lost connection', async () => {
    const { fetch } = recordingFetch(
      (_url, init) => new Response(chunked(['data: 1\n'], init, { then: 'fail' }), { status: 200 }),
    );
    const { lines } = await new TalqynFetchTransport({ fetch }).stream(request());
    const error = await talqynFailure(collect(lines));
    expect(error.kind).toBe('transport');
    expect(error.transportFailure).toBe('connectionLost');
  });

  it('carries a consultant turn and an event end to end', async () => {
    const turn = [
      'event: status\ndata: {"stage":"thinking"}\n\n',
      'event: delta\ndata: {"text":"Hi"}\n\n: keep-alive\n\n',
      'event: done\ndata: {"session_id":"s1"}\n\n',
    ];
    const { fetch, calls } = recordingFetch((url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/consultant/token')) {
        return new Response('{"token":"tlqd_live","expires_in":900}', { status: 200 });
      }
      if (path.endsWith('/consultant/ask')) {
        return new Response(chunked(turn, init), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response('', { status: 202 });
    });
    const talqyn = TestFixtures.client({
      transport: new TalqynFetchTransport({ fetch }),
      credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.guest),
    });

    const events: TalqynConsultantEvent[] = await collect(talqyn.consultant.ask('hi'));
    expect(events.map((event) => event.type)).toEqual(['status', 'delta', 'done']);
    await talqyn.events.productClick({ talqynId: 1, position: 0, source: 'cip' });

    const [mint, ask, click] = calls;
    expect(mint?.url).toBe('https://api.example.com/v1/consultant/token');
    expect((ask?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer tlqd_live');
    expect((ask?.init.headers as Record<string, string>)['Accept']).toBe('text/event-stream');
    expect(click?.url).toBe('https://api.example.com/v1/events/product-click');
    expect(click?.init.keepalive).toBe(true);
  });
});
