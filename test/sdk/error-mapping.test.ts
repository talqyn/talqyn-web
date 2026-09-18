import { describe, expect, it } from 'vitest';
import { TalqynHttpResponse, TalqynRetryPolicy, type TalqynError } from '../../src/sdk/index.js';
import { parseHttpDate } from '../../src/sdk/internal/json.js';
import { responseRetryAfterMs } from '../../src/sdk/networking/http-transport.js';
import { StubTransport, TestFixtures, talqynFailure } from '../support/stub-transport.js';

const emptySearch = '{"search_id":"s","query":"x","locale":"ru","total":0,"results":[]}';
const eager: TalqynRetryPolicy = { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0 };
const twice: TalqynRetryPolicy = { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 };

async function failingSearch(
  json: string,
  status: number,
  headers: Record<string, string> = {},
  retryPolicy: TalqynRetryPolicy = TalqynRetryPolicy.none,
): Promise<TalqynError> {
  const transport = new StubTransport();
  transport.enqueue(json, { status, headers });
  const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy });
  return talqynFailure(talqyn.search.search('iphone'));
}

describe('error mapping', () => {
  it('carries Retry-After on a rate limit', async () => {
    const error = await failingSearch('{"detail":"Rate limit exceeded"}', 429, { 'Retry-After': '60' });
    expect(error.kind).toBe('rateLimited');
    expect(error.retryAfterMs).toBe(60_000);
    expect(error.detail).toBe('Rate limit exceeded');
    expect(error.statusCode).toBe(429);
    expect(error.isRetryable).toBe(true);
  });

  /** HTTP headers are case-insensitive: the server may use any casing. */
  it('reads Retry-After in any casing', async () => {
    const error = await failingSearch('{}', 429, { 'retry-after': '5' });
    expect(error.retryAfterMs).toBe(5_000);
  });

  it('names the fields of a validation failure', async () => {
    const error = await failingSearch(
      '{"error":"validation_error","request_id":"req-1","detail":[{"loc":["body","filters",0],"msg":"too many keys","type":"value_error"}]}',
      422,
    );
    expect(error.kind).toBe('validation');
    expect(error.fields).toEqual(['body.filters.0']);
    expect(error.detail).toBe('too many keys');
    expect(error.requestId).toBe('req-1');
    expect(error.isRetryable).toBe(false);
    expect(error.message).toBe('too many keys (body.filters.0)');
  });

  it('keeps the server detail of a refusal', async () => {
    const error = await failingSearch('{"detail":"API key is missing the \'search\' scope"}', 403);
    expect(error.kind).toBe('forbidden');
    expect(error.detail).toBe("API key is missing the 'search' scope");
  });

  it('maps a 404', async () => {
    const error = await failingSearch('{"detail":"chat not found"}', 404);
    expect(error.kind).toBe('notFound');
    expect(error.statusCode).toBe(404);
  });

  it('carries the code and request id of the platform envelope', async () => {
    const error = await failingSearch('{"error":"database_unavailable","request_id":"a1b2c3"}', 503);
    expect(error.kind).toBe('server');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('database_unavailable');
    expect(error.requestId).toBe('a1b2c3');
    expect(error.isRetryable).toBe(true);
  });

  it('falls back to the X-Request-ID header for the request id', async () => {
    const error = await failingSearch('', 502, { 'X-Request-ID': 'from-header' });
    expect(error.requestId).toBe('from-header');
  });

  /** A 503 during a deploy names its own wait; the policy should see it. */
  it('carries Retry-After on a server failure', async () => {
    const error = await failingSearch('{"error":"overloaded"}', 503, { 'Retry-After': '2' });
    expect(error.retryAfterMs).toBe(2_000);
  });

  /** Only a 5xx is the server's own failure. A 400 or a 405 is a fixed answer to a fixed request. */
  it('does not repeat a client error outside the known set', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"bad request"}', { status: 400 });
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: eager });
    const error = await talqynFailure(talqyn.search.search('iphone'));
    expect(error.kind).toBe('server');
    expect(error.statusCode).toBe(400);
    expect(error.isRetryable).toBe(false);
    expect(transport.sent).toHaveLength(1);
  });

  it('maps an empty body by its status', async () => {
    const error = await failingSearch('', 502);
    expect(error.kind).toBe('server');
    expect(error.statusCode).toBe(502);
    expect(error.code).toBeUndefined();
  });

  it('repeats server errors under the retry policy', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"error":"overloaded"}', { status: 503 });
    transport.enqueue('{"error":"overloaded"}', { status: 503 });
    transport.enqueue(emptySearch);
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: twice });
    await talqyn.search.search('iphone');
    expect(transport.sent).toHaveLength(3);
  });

  it('gives up once the retries are spent', async () => {
    const transport = new StubTransport();
    for (let index = 0; index < 3; index++) transport.enqueue('{"error":"overloaded"}', { status: 503 });
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: twice });
    const error = await talqynFailure(talqyn.search.search('iphone'));
    expect(error.statusCode).toBe(503);
    expect(transport.sent).toHaveLength(3);
  });

  /** A 5xx may arrive after the event was already recorded, and these rows are the denominator of click-through: a duplicate is worse than a miss. */
  it('does not repeat an event after a server error', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"error":"internal_error"}', { status: 500 });
    transport.enqueue('', { status: 204 });
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: twice });
    const error = await talqynFailure(
      talqyn.events.productClick({ searchId: 's1', talqynId: 1, position: 0, source: 'instant' }),
    );
    expect(error.statusCode).toBe(500);
    expect(transport.sent).toHaveLength(1);
  });

  /** A 429 is the one refusal that says the event was certainly not recorded, so it is the one worth repeating. */
  it('repeats an event after a rate limit', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"Rate limit exceeded"}', { status: 429 });
    transport.enqueue('', { status: 204 });
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: twice });
    await talqyn.events.searchSubmit({ query: 'iphone', source: 'instant', resultsCount: 8 });
    expect(transport.sent).toHaveLength(2);
  });

  it('does not repeat a client error', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"nope"}', { status: 403 });
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: eager });
    await talqynFailure(talqyn.search.search('iphone'));
    expect(transport.sent).toHaveLength(1);
  });

  it('reports a response that does not decode', async () => {
    const error = await failingSearch('not json', 200);
    expect(error.kind).toBe('decoding');
    expect(error.requestId).toBeDefined();
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  /** Retry-After comes in two forms; a date in the past is "now", not a negative wait. */
  it('reads Retry-After in both forms', () => {
    const now = parseHttpDate('Tue, 26 Aug 2025 12:15:00 GMT')?.getTime();
    expect(now).toBeDefined();
    const retryAfter = (value?: string): number | undefined =>
      responseRetryAfterMs(new TalqynHttpResponse(429, value === undefined ? {} : { 'Retry-After': value }), now);

    expect(retryAfter('7')).toBe(7_000);
    expect(retryAfter(' 7 ')).toBe(7_000);
    expect(retryAfter('1.5')).toBe(1_500);
    expect(retryAfter('-3')).toBe(0);
    expect(retryAfter('Tue, 26 Aug 2025 12:15:30 GMT')).toBe(30_000);
    expect(retryAfter('Tue, 26 Aug 2025 12:00:00 GMT')).toBe(0);
    expect(retryAfter('soon')).toBeUndefined();
    expect(retryAfter()).toBeUndefined();
  });

  /** NaN is no wait: it reads as a header that cannot be read, and the error carries no retryAfter at all. */
  it('reads a NaN Retry-After as unreadable', async () => {
    for (const raw of ['NaN', 'nan', ' -nan ']) {
      expect(responseRetryAfterMs(new TalqynHttpResponse(429, { 'Retry-After': raw })), raw).toBeUndefined();
    }
    const error = await failingSearch('{"detail":"Rate limit exceeded"}', 429, { 'Retry-After': 'NaN' });
    expect(error.kind).toBe('rateLimited');
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('honours the cap of the retry policy', () => {
    const policy: TalqynRetryPolicy = { maxRetries: 2, baseDelayMs: 300, maxDelayMs: 5_000 };
    expect(TalqynRetryPolicy.delay(policy, 0, undefined, 1)).toBe(300);
    expect(TalqynRetryPolicy.delay(policy, 1, undefined, 1)).toBe(600);
    // Backoff is capped.
    expect(TalqynRetryPolicy.delay(policy, 10, undefined, 1)).toBe(5_000);
    // A short Retry-After is honoured as-is.
    expect(TalqynRetryPolicy.delay(policy, 0, 2_000, 0)).toBe(2_000);
    // A Retry-After beyond the cap declines the retry: a shorter wait would land in the same exhausted bucket.
    expect(TalqynRetryPolicy.delay(policy, 0, 60_000)).toBeUndefined();
    expect(TalqynRetryPolicy.default).toEqual({ maxRetries: 2, baseDelayMs: 300, maxDelayMs: 5_000 });
    expect(TalqynRetryPolicy.none.maxRetries).toBe(0);
  });

  /** Every visitor fails at the same moment of an outage; the waits spread between half and all of each step. */
  it('jitters the backoff within its step', () => {
    const policy: TalqynRetryPolicy = { maxRetries: 2, baseDelayMs: 400, maxDelayMs: 5_000 };
    // Half of the 800 ms step.
    expect(TalqynRetryPolicy.delay(policy, 1, undefined, 0)).toBeCloseTo(400, 9);
    expect(TalqynRetryPolicy.delay(policy, 1, undefined, 0.5)).toBeCloseTo(600, 9);
    // Half of the capped step.
    expect(TalqynRetryPolicy.delay(policy, 10, undefined, 0)).toBeCloseTo(2_500, 9);
    for (let index = 0; index < 50; index++) {
      const wait = TalqynRetryPolicy.delay(policy, 0, undefined) ?? -1;
      expect(wait).toBeGreaterThanOrEqual(200);
      expect(wait).toBeLessThanOrEqual(400);
    }
  });

  /** A per-minute bucket answers Retry-After: 60. Waiting the cap and asking again is seconds of a hung search field, then the same 429. */
  it('surfaces a rate limit beyond the cap at once', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"Rate limit exceeded"}', { status: 429, headers: { 'Retry-After': '60' } });
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: TalqynRetryPolicy.default });
    const started = Date.now();
    const error = await talqynFailure(talqyn.search.search('iphone'));
    // The site gets the server's wait to act on.
    expect(error.retryAfterMs).toBe(60_000);
    expect(transport.sent).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('repeats a rate limit within the cap', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"Rate limit exceeded"}', { status: 429, headers: { 'Retry-After': '0' } });
    transport.enqueue(emptySearch);
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: TalqynRetryPolicy.default });
    await talqyn.search.search('iphone');
    expect(transport.sent).toHaveLength(2);
  });

  /** Every failure an SDK call surfaces is a TalqynError — including one the caller produced before anything was sent. */
  it('reports an encoding failure as a TalqynError and sends nothing', async () => {
    const transport = new StubTransport();
    const talqyn = await TestFixtures.preparedClient(transport);
    const error = await talqynFailure(talqyn.search.search({ query: 'iphone', priceMin: Number.POSITIVE_INFINITY }));
    expect(error.kind).toBe('encoding');
    expect(error.isRetryable).toBe(false);
    expect(transport.sent).toEqual([]);
  });

  it('surfaces a transport failure as a TalqynError', async () => {
    const transport = new StubTransport();
    transport.enqueueError(new TypeError('Failed to fetch'));
    const talqyn = await TestFixtures.preparedClient(transport);
    const error = await talqynFailure(talqyn.search.search('iphone'));
    expect(error.kind).toBe('transport');
    expect(error.transportFailure).toBe('unknown');
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.isRetryable).toBe(true);
  });
});
