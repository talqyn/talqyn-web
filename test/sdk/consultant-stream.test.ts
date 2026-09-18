import { describe, expect, it } from 'vitest';
import { TalqynAnswerMarkup, TalqynConsultantEvent } from '../../src/sdk/index.js';
import {
  LogCollector,
  SlowStreamTransport,
  StubTransport,
  TestFixtures,
  collect,
  delay,
  sseEvent,
  talqynFailure,
  waitUntil,
} from '../support/stub-transport.js';

describe('the consultant stream', () => {
  it('parses a turn into events', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream([
      ...sseEvent('status', '{"stage":"thinking"}'),
      ...sseEvent('status', '{"stage":"searching"}'),
      ...sseEvent('products', '{"items":[{"talqyn_id":1,"title":"Laptop"}],"search_id":"s1"}'),
      ...sseEvent('delta', '{"text":"Here "}'),
      ...sseEvent('delta', '{"text":"[p:1]"}'),
      ...sseEvent('follow_ups', '{"items":["cheaper"]}'),
      ...sseEvent('done', '{"session_id":"sess-1","ttft_ms":300,"total_ms":1500}'),
    ]);

    const talqyn = TestFixtures.client({ transport });
    const events = await collect(talqyn.consultant.ask('need a laptop'));

    expect(events).toHaveLength(7);
    expect(events[0]).toEqual({ type: 'status', stage: 'thinking' });
    const last = events[events.length - 1];
    expect(last && TalqynConsultantEvent.isTerminal(last)).toBe(true);

    const text = events.flatMap((event) => (event.type === 'delta' ? [event.text] : [])).join('');
    expect(TalqynAnswerMarkup.mentionedProductIds(text)).toEqual([1]);

    const ask = transport.sent[1];
    expect(ask?.path).toBe('/v1/consultant/ask');
    expect(ask?.method).toBe('POST');
    expect(ask?.header('Accept')).toBe('text/event-stream');
    expect(ask?.header('Authorization')).toBe('Bearer tlqd_test');
    expect(ask?.request.timeoutMs).toBe(60_000);
    expect(ask?.bodyJson['question']).toBe('need a laptop');
    expect(ask?.bodyJson['locale']).toBe('en');
  });

  /** A generator does its work as it is read: nothing goes out for a stream nobody iterates. */
  it('does not send anything before the iteration begins', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream(sseEvent('done', '{"session_id":"s"}'));
    const talqyn = TestFixtures.client({ transport });

    const stream = talqyn.consultant.ask('question');
    await delay(20);
    expect(transport.sent).toEqual([]);
    expect(await collect(stream)).toHaveLength(1);
  });

  /** The defaults a turn goes out with are the ones in force when it was asked. */
  it('takes the client defaults as of the question', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream(sseEvent('done', '{"session_id":"s"}'));
    const talqyn = TestFixtures.client({ transport, cityId: '10' });

    const stream = talqyn.consultant.ask('question');
    talqyn.setLocale('kk');
    talqyn.setPlace('47');
    await collect(stream);

    expect(transport.sent[1]?.bodyJson['locale']).toBe('en');
    expect(transport.sent[1]?.bodyJson['city_id']).toBe('10');
  });

  it('carries the session into the next turn', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream(sseEvent('done', '{"session_id":"sess-1","total_ms":10}'));
    transport.enqueueStream(sseEvent('done', '{"session_id":"sess-1","total_ms":10}'));

    const talqyn = TestFixtures.client({ transport });
    const first = await collect(talqyn.consultant.ask('question'));
    const done = first[first.length - 1];
    if (done?.type !== 'done') throw new Error('expected done');

    await collect(talqyn.consultant.ask('second question', { sessionId: done.done.sessionId }));
    expect(transport.sent[2]?.bodyJson['session_id']).toBe('sess-1');

    transport.enqueueStream(sseEvent('done', '{"session_id":"sess-1"}'));
    await collect(talqyn.consultant.ask({ question: 'third', sessionId: 'sess-1', locationId: '5' }));
    expect(transport.sent[3]?.bodyJson).toMatchObject({ question: 'third', session_id: 'sess-1', location_id: '5' });
  });

  it('has no products in a clarify turn', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream([
      ...sseEvent('status', '{"stage":"thinking"}'),
      ...sseEvent('clarify', '{"message":"clarify","questions":[{"id":"budget","label":"Budget","options":["under 300k"]}]}'),
      ...sseEvent('done', '{"session_id":"s","total_ms":5}'),
    ]);

    const talqyn = TestFixtures.client({ transport });
    const events = await collect(talqyn.consultant.ask('recommend something'));

    const clarify = events[1];
    if (clarify?.type !== 'clarify') throw new Error('expected clarify');
    expect(clarify.clarify.questions[0]?.label).toBe('Budget');
    expect(events.some((event) => event.type === 'products')).toBe(false);
  });

  it('surfaces a failing status', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream(['{"detail":"Rate limit exceeded"}'], { status: 429, headers: { 'Retry-After': '60' } });

    const talqyn = TestFixtures.client({ transport });
    const error = await talqynFailure(collect(talqyn.consultant.ask('question')));
    expect(error.kind).toBe('rateLimited');
    expect(error.retryAfterMs).toBe(60_000);
    expect(error.detail).toBe('Rate limit exceeded');
  });

  it('reissues the token on a 401', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_old' });
    transport.enqueueStream(['{"detail":"Invalid device token"}'], { status: 401 });
    transport.enqueueDeviceToken({ token: 'tlqd_new' });
    transport.enqueueStream(sseEvent('done', '{"session_id":"s","total_ms":1}'));

    const talqyn = TestFixtures.client({ transport });
    const events = await collect(talqyn.consultant.ask('question'));

    expect(events).toHaveLength(1);
    expect(transport.sent).toHaveLength(4);
    expect(transport.sent[3]?.header('Authorization')).toBe('Bearer tlqd_new');
  });

  it('keeps the products of a fallback turn', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream([
      ...sseEvent('products', '{"items":[{"talqyn_id":7,"title":"A"}]}'),
      ...sseEvent('fallback', '{"reason":"user_budget_exceeded"}'),
      ...sseEvent('done', '{"session_id":"s","total_ms":9}'),
    ]);

    const talqyn = TestFixtures.client({ transport });
    const events = await collect(talqyn.consultant.ask('question'));

    const products = events[0];
    if (products?.type !== 'products') throw new Error('expected products');
    expect(products.products.items).toHaveLength(1);
    expect(events[1]).toEqual({ type: 'fallback', reason: 'user_budget_exceeded' });
  });

  it('skips an event it does not know, with a debug line', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream([
      ...sseEvent('telemetry', '{"cpu":1}'),
      ...sseEvent('delta', 'not json'),
      ...sseEvent('done', '{"session_id":"s"}'),
    ]);
    const logs = new LogCollector();
    const talqyn = TestFixtures.client({ transport, logHandler: logs.handler });

    const events = await collect(talqyn.consultant.ask('question'));
    expect(events.map((event) => event.type)).toEqual(['done']);
    expect(logs.events.some((event) => event.level === 'debug' && event.message.includes("'telemetry' skipped"))).toBe(true);
  });

  /**
   * The contract closes every turn with `done`. A stream that ends without it was cut somewhere between
   * Talqyn and the browser, and the site must not take a turn that merely stopped for one that finished.
   */
  it('throws after the delivered events when the stream is cut before done', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueueStream([...sseEvent('status', '{"stage":"thinking"}'), ...sseEvent('delta', '{"text":"Here"}')]);
    const logs = new LogCollector();
    const talqyn = TestFixtures.client({ transport, logHandler: logs.handler });

    const events: TalqynConsultantEvent[] = [];
    const error = await talqynFailure(
      (async () => {
        for await (const event of talqyn.consultant.ask('question')) events.push(event);
      })(),
    );
    expect(error.kind).toBe('transport');
    expect(error.transportFailure).toBe('connectionLost');
    // What arrived before the cut is delivered first.
    expect(events).toHaveLength(2);
    expect(logs.events.some((event) => event.level === 'warning' && event.message.includes('without a done'))).toBe(true);
  });

  /** A closed screen stops reading. That stops the request behind the stream, and it is not a cut stream: nothing to warn about. */
  it('stops the request quietly when the reader leaves mid-turn', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream([
      ...sseEvent('status', '{"stage":"thinking"}'),
      ...sseEvent('delta', '{"text":"a"}'),
      ...sseEvent('delta', '{"text":"b"}'),
      ...sseEvent('done', '{"session_id":"s"}'),
    ]);
    const logs = new LogCollector();
    const talqyn = TestFixtures.client({ transport, logHandler: logs.handler });

    let seen = 0;
    for await (const event of talqyn.consultant.ask('question')) {
      seen += 1;
      expect(event.type).toBe('status');
      if (seen === 1) break;
    }

    // Leaving the stream must stop the request.
    expect(await waitUntil(() => transport.wasTerminated)).toBe(true);
    await delay(100);
    expect(logs.events.filter((event) => event.level === 'warning')).toEqual([]);
  });

  it('stops the turn when its signal aborts', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream([
      ...sseEvent('status', '{"stage":"thinking"}'),
      ...sseEvent('delta', '{"text":"a"}'),
      ...sseEvent('delta', '{"text":"b"}'),
      ...sseEvent('done', '{"session_id":"s"}'),
    ]);
    const logs = new LogCollector();
    const talqyn = TestFixtures.client({ transport, logHandler: logs.handler });

    const controller = new AbortController();
    const events: TalqynConsultantEvent[] = [];
    const error = await talqynFailure(
      (async () => {
        for await (const event of talqyn.consultant.ask('question', { signal: controller.signal })) {
          events.push(event);
          controller.abort();
        }
      })(),
    );

    expect(error.kind).toBe('cancelled');
    expect(events).toHaveLength(1);
    expect(await waitUntil(() => transport.wasTerminated)).toBe(true);
    expect(logs.events.filter((event) => event.level === 'warning')).toEqual([]);
  });

  /**
   * `done` is the end of the turn, whatever the connection does next. A server — or a proxy — holding
   * the connection open after it must not keep the iteration waiting, nor fail a finished turn with a
   * transport error once the idle connection drops; and the request behind the turn is closed.
   */
  it('ends the iteration at done and closes the connection', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream([...sseEvent('delta', '{"text":"ok"}'), ...sseEvent('done', '{"session_id":"s"}')], {
      keepsOpen: true,
    });
    const talqyn = TestFixtures.client({ transport });

    // Without it, an iteration that reads past `done` waits here for good.
    const watchdog = new AbortController();
    const timer = setTimeout(() => watchdog.abort(), 2_000);
    const events = await collect(talqyn.consultant.ask('question', { signal: watchdog.signal }));
    clearTimeout(timer);

    // The iteration did not read past done until the watchdog stopped it.
    expect(watchdog.signal.aborted).toBe(false);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe('done');
    // The request behind a finished turn is not left open.
    expect(await waitUntil(() => transport.wasTerminated)).toBe(true);
  });
});
