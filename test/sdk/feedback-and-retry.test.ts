import { describe, expect, it } from 'vitest';
import { TalqynError, type TalqynConsultantEvent, type TalqynRetryPolicy } from '../../src/sdk/index.js';
import { TalqynApiClient } from '../../src/sdk/networking/api-client.js';
import { decodeChatTranscript } from '../../src/sdk/models/chat-models.js';
import { decodeConsultantAnswer, decodeConsultantDone } from '../../src/sdk/models/consultant-models.js';
import { StubTransport, TestFixtures, collect, sseEvent, talqynFailure } from '../support/stub-transport.js';

const turnId = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const twice: TalqynRetryPolicy = { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 };

/** Ratings of consultant turns, and which failed requests may be sent again. */
describe('feedback', () => {
  it('posts a rating with reasons only for a dislike', async () => {
    const transport = new StubTransport();
    transport.enqueue('', { status: 204 });
    transport.enqueue('', { status: 204 });
    transport.enqueue('', { status: 204 });
    const talqyn = await TestFixtures.preparedClient(transport);
    talqyn.setVariant('exp-b');

    await talqyn.consultant.submitFeedback({
      turnId,
      sessionId: 'sess-0001',
      verdict: 'down',
      reasons: ['not_relevant', 'price_stock'],
      comment: 'wrong ones',
      talqynIds: [7],
    });
    await talqyn.consultant.submitFeedback({ turnId, sessionId: 'sess-0001', verdict: 'up', reasons: ['other'], comment: 'extra' });
    await talqyn.consultant.withdrawFeedback(turnId);

    const down = transport.sent[0];
    expect(down?.path).toBe('/v1/consultant/feedback');
    expect(down?.method).toBe('POST');
    expect(down?.bodyJson).toEqual({
      turn_id: turnId,
      session_id: 'sess-0001',
      verdict: 'down',
      reasons: ['not_relevant', 'price_stock'],
      comment: 'wrong ones',
      talqyn_ids: [7],
      // The client's bucket is filled in.
      variant: 'exp-b',
    });

    const up = transport.sent[1]?.bodyJson;
    expect(up?.['verdict']).toBe('up');
    // An up rating carries no reasons for the server to drop.
    expect(up).not.toHaveProperty('reasons');
    expect(up).not.toHaveProperty('comment');
    expect(up).not.toHaveProperty('talqyn_ids');

    expect(transport.sent[2]?.method).toBe('DELETE');
    expect(transport.sent[2]?.path).toBe(`/v1/consultant/feedback/${turnId}`);
  });

  /** A rating replaces itself, so a repeat is harmless and a failure is retried like a read. */
  it('repeats a rating after a server error', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"error":"database_unavailable"}', { status: 503 });
    transport.enqueue('', { status: 204 });
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: twice });
    await talqyn.consultant.submitFeedback({ turnId, sessionId: 'sess-0001', verdict: 'up' });
    expect(transport.sent).toHaveLength(2);
  });

  it('reports a rating of an unknown turn as not found', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"turn not found"}', { status: 404 });
    const talqyn = await TestFixtures.preparedClient(transport);
    const error = await talqynFailure(talqyn.consultant.withdrawFeedback(turnId));
    expect(error.kind).toBe('notFound');
  });

  it('delivers the turn id on done, the answer, and the transcript', () => {
    const done = decodeConsultantDone(JSON.parse(`{"session_id":"s1","turn_id":"${turnId}","total_ms":10}`));
    expect(done.turnId).toBe(turnId);

    const answer = decodeConsultantAnswer(JSON.parse(`{"answer":"","products":[],"turn_id":"${turnId}"}`));
    expect(answer?.turnId).toBe(turnId);

    const transcript = decodeChatTranscript(
      JSON.parse(`{"session_id":"s1","messages":[
        {"role":"user","text":"q","turn_id":"${turnId}","feedback":"down"},
        {"role":"assistant","text":"a","turn_id":"${turnId}","feedback":"down"},
        {"role":"user","text":"old"},
        {"role":"user","text":"odd","feedback":"sideways"}
      ],"products":[]}`),
    );
    expect(transcript?.messages[1]?.turnId).toBe(turnId);
    expect(transcript?.messages[1]?.feedback).toBe('down');
    // A turn from before ratings has no id.
    expect(transcript?.messages[2]?.turnId).toBeUndefined();
    expect(transcript?.messages[2]?.feedback).toBeUndefined();
    expect(transcript?.messages[3]?.feedback).toBeUndefined();
  });
});

describe('retry safety', () => {
  /**
   * A consultant turn starts once the server accepts the stream. A refusal before that is safe to
   * repeat; a connection that dropped may have left a paid turn running on the other end, and is not
   * repeated.
   */
  it('repeats a stream after a refusal but not after a dropped connection', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(['{"error":"overloaded"}'], { status: 503 });
    transport.enqueueStream(sseEvent('done', '{"session_id":"s"}'));
    transport.enqueueStreamError(TalqynError.transport('connectionLost'));
    transport.enqueueStream(sseEvent('done', '{"session_id":"s"}'));
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: twice });

    await collect(talqyn.consultant.ask('question'));
    // The 503 was repeated.
    expect(transport.sent).toHaveLength(2);

    const error = await talqynFailure(collect(talqyn.consultant.ask('another question')));
    expect(error.kind).toBe('transport');
    expect(error.transportFailure).toBe('connectionLost');
    // A dropped connection is not repeated.
    expect(transport.sent).toHaveLength(3);
  });

  /** Nothing comes back from `stream=false` until the turn is written, so a 5xx may follow a turn that ran. Only a 429 says it did not. */
  it('repeats the JSON answer only after a rate limit', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"Rate limit exceeded"}', { status: 429 });
    transport.enqueue('{"answer":"ok","products":[]}');
    transport.enqueue('{"error":"internal_error"}', { status: 500 });
    transport.enqueue('{"answer":"ok","products":[]}');
    const talqyn = await TestFixtures.preparedClient(transport, { retryPolicy: twice });

    await talqyn.consultant.answer({ question: 'hi' });
    expect(transport.sent).toHaveLength(2);

    const error = await talqynFailure(talqyn.consultant.answer('hi'));
    expect(error.statusCode).toBe(500);
    expect(transport.sent).toHaveLength(3);
    // The whole turn is waited for as long as a stream waits for its first byte.
    expect(transport.sent[0]?.request.timeoutMs).toBe(60_000);
  });

  /** A token that could not be minted means the request itself was never sent: even an event, otherwise repeated only after a 429, is safe to try again. */
  it('repeats a failed mint even for an event', async () => {
    const transport = new StubTransport();
    transport.enqueueError(TalqynError.transport('offline'));
    transport.enqueueDeviceToken();
    transport.enqueue('', { status: 204 });
    const talqyn = TestFixtures.client({ transport, retryPolicy: twice });

    await talqyn.events.productClick({ searchId: 's1', talqynId: 1, position: 0, source: 'instant' });
    expect(transport.sent.map((sent) => sent.path)).toEqual([
      '/v1/consultant/token',
      '/v1/consultant/token',
      '/v1/events/product-click',
    ]);
  });

  it('follows the safety rules', () => {
    const overloaded = TalqynError.server({ status: 503, code: 'overloaded' });
    const limited = TalqynError.rateLimited();
    const dropped = TalqynError.transport('connectionLost');
    const refused = TalqynError.forbidden();

    for (const error of [overloaded, limited, dropped]) {
      expect(TalqynApiClient.canRetry(error, 'idempotent', true)).toBe(true);
    }
    expect(TalqynApiClient.canRetry(overloaded, 'untilAccepted', true)).toBe(true);
    expect(TalqynApiClient.canRetry(limited, 'untilAccepted', true)).toBe(true);
    expect(TalqynApiClient.canRetry(dropped, 'untilAccepted', true)).toBe(false);
    expect(TalqynApiClient.canRetry(limited, 'onlyIfRejected', true)).toBe(true);
    expect(TalqynApiClient.canRetry(overloaded, 'onlyIfRejected', true)).toBe(false);
    expect(TalqynApiClient.canRetry(dropped, 'onlyIfRejected', true)).toBe(false);
    // Nothing was sent.
    expect(TalqynApiClient.canRetry(dropped, 'onlyIfRejected', false)).toBe(true);
    // A refusal stays a refusal.
    expect(TalqynApiClient.canRetry(refused, 'idempotent', false)).toBe(false);
    expect(TalqynApiClient.canRetry(TalqynError.cancelled(), 'idempotent', false)).toBe(false);
  });
});

describe('errors', () => {
  /** A transport of your own may fail with an error of its own; the SDK reports it as a transport failure without losing what it was. */
  it('keeps a foreign error underneath', () => {
    class PinningFailed extends Error {
      constructor() {
        super('certificate pin mismatch');
        this.name = 'PinningFailed';
      }
    }
    const cause = new PinningFailed();
    const wrapped = TalqynError.wrap(cause);
    expect(wrapped.kind).toBe('transport');
    expect(wrapped.transportFailure).toBe('unknown');
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.message).toContain('pin');
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.name).toBe('TalqynError');

    expect(TalqynError.wrap(wrapped)).toBe(wrapped);
    expect(TalqynError.wrap(new DOMException('The operation was aborted.', 'AbortError')).kind).toBe('cancelled');
    const timeout = TalqynError.wrap(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(timeout.kind).toBe('transport');
    expect(timeout.transportFailure).toBe('timedOut');
    expect(TalqynError.wrap('odd').kind).toBe('transport');
  });

  it('compares errors by value', () => {
    expect(TalqynError.notFound({ requestId: 'a' }).equals(TalqynError.notFound({ requestId: 'a' }))).toBe(true);
    expect(TalqynError.notFound({ requestId: 'a' }).equals(TalqynError.notFound({ requestId: 'b' }))).toBe(false);
    expect(TalqynError.notFound().equals(TalqynError.forbidden())).toBe(false);
    expect(TalqynError.transport('timedOut').equals(TalqynError.transport('timedOut'))).toBe(true);
    expect(TalqynError.transport('timedOut').equals(TalqynError.transport('connectionLost'))).toBe(false);
    expect(TalqynError.validation({ fields: ['a'] }).equals(TalqynError.validation({ fields: ['b'] }))).toBe(false);
    expect(TalqynError.cancelled().equals(TalqynError.cancelled())).toBe(true);
    expect(TalqynError.cancelled().equals(undefined)).toBe(false);
  });

  it('recognizes its own errors without instanceof', () => {
    expect(TalqynError.is(TalqynError.cancelled())).toBe(true);
    expect(TalqynError.is(new Error('x'))).toBe(false);
    expect(TalqynError.is(undefined)).toBe(false);
    expect(TalqynError.is({ kind: 'cancelled' })).toBe(false);
  });

  it('reports the status behind each kind', () => {
    expect(TalqynError.unauthorized().statusCode).toBe(401);
    expect(TalqynError.forbidden().statusCode).toBe(403);
    expect(TalqynError.notFound().statusCode).toBe(404);
    expect(TalqynError.validation().statusCode).toBe(422);
    expect(TalqynError.rateLimited().statusCode).toBe(429);
    expect(TalqynError.deviceTokensNotConfigured().statusCode).toBe(501);
    expect(TalqynError.deviceTokensUnavailable().statusCode).toBe(503);
    expect(TalqynError.server({ status: 418 }).statusCode).toBe(418);
    expect(TalqynError.transport('network').statusCode).toBeUndefined();
    expect(TalqynError.decoding(new Error('x')).statusCode).toBeUndefined();
    expect(TalqynError.invalidConfiguration('x').statusCode).toBeUndefined();
  });

  /** The advice given for switches must hold: a switch with a default keeps compiling when a kind or an event is added. */
  it('switches over every event with a default', () => {
    const name = (event: TalqynConsultantEvent): string => {
      switch (event.type) {
        case 'status':
          return 'status';
        case 'products':
          return 'products';
        case 'delta':
          return 'delta';
        case 'clarify':
          return 'clarify';
        case 'redirectToSearch':
          return 'redirect';
        case 'fallback':
          return 'fallback';
        case 'action':
          return 'action';
        case 'followUps':
          return 'followUps';
        case 'error':
          return 'error';
        case 'done':
          return 'done';
        default:
          return 'unknown';
      }
    };
    expect(name({ type: 'status', stage: 'thinking' })).toBe('status');
  });
});
