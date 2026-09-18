import type { TalqynDeviceTokenAuthorizer } from '../auth/device-token-authorizer.js';
import { TalqynRetryPolicy } from '../configuration.js';
import { abortable, sleep, throwIfAborted } from '../internal/async.js';
import { utf8Encode } from '../internal/bytes.js';
import { parseJson } from '../internal/json.js';
import { makeUuid } from '../internal/random.js';
import { emitLog, type TalqynLogHandler } from '../log.js';
import { TalqynError } from './error.js';
import { errorFromResponse } from './error-mapping.js';
import type { TalqynHttpTransport, TalqynLineStream } from './http-transport.js';
import type { TalqynQueryItem, TalqynRequestBuilder } from './request-builder.js';
import { TalqynSseDecoder, type TalqynSseMessage } from './sse.js';

/**
 * Whether a failed request may be sent again.
 *
 * The retry policy decides how often; this decides whether at all, from what a repeat would cost if
 * the first attempt had in fact gone through.
 *
 * - `idempotent` — repeating is harmless: a read, or a write that overwrites itself;
 * - `untilAccepted` — the server starts the work only once it has accepted the request. A refusal that
 *   came back as a status — a `429`, a `5xx` from before the stream opened — means nothing was done,
 *   and is repeated. A connection that dropped is not: the work may already be running on the other
 *   end. A consultant turn is an LLM call, and running it twice is paying twice and recording it twice;
 * - `onlyIfRejected` — repeated only after a `429`: an exhausted bucket is the one refusal that says the
 *   request was certainly not carried out. A `5xx` or a lost connection may have come after the work
 *   was done.
 */
export type TalqynRetrySafety = 'idempotent' | 'untilAccepted' | 'onlyIfRejected';

/** A request as an API surface describes it: a path and a body, and nothing of the transport. */
export interface TalqynApiRequest {
  readonly method?: string;
  readonly path: string;
  readonly query?: readonly TalqynQueryItem[];
  /** The JSON body. */
  readonly body?: string;
  readonly safety?: TalqynRetrySafety;
  /** Overrides the configured timeout — for a request that sends nothing back until a long piece of work is done. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal | undefined;
  readonly keepalive?: boolean;
}

/**
 * The SDK's transport core: authorization, retries, error mapping, SSE.
 *
 * The API surfaces describe a path and a body and see none of this, so search, the consultant, and
 * events cannot drift apart in how they behave.
 */
export class TalqynApiClient {
  readonly streamTimeoutMs: number;
  private readonly builder: TalqynRequestBuilder;
  private readonly transport: TalqynHttpTransport;
  private readonly authorizer: TalqynDeviceTokenAuthorizer;
  private readonly retryPolicy: TalqynRetryPolicy;
  private readonly logHandler: TalqynLogHandler | undefined;

  constructor(init: {
    readonly builder: TalqynRequestBuilder;
    readonly transport: TalqynHttpTransport;
    readonly authorizer: TalqynDeviceTokenAuthorizer;
    readonly retryPolicy: TalqynRetryPolicy;
    readonly streamTimeoutMs: number;
    readonly logHandler?: TalqynLogHandler | undefined;
  }) {
    this.builder = init.builder;
    this.transport = init.transport;
    this.authorizer = init.authorizer;
    this.retryPolicy = init.retryPolicy;
    this.streamTimeoutMs = init.streamTimeoutMs;
    this.logHandler = init.logHandler;
  }

  // MARK: Unary requests

  /** Sends a request and decodes its body. */
  async fetchJson<T>(request: TalqynApiRequest, decode: (value: unknown) => T | undefined): Promise<T> {
    const { body, requestId } = await this.perform(request);
    let value: T | undefined;
    let cause: unknown;
    try {
      value = decode(parseJson(body));
    } catch (error) {
      cause = error;
    }
    if (value === undefined) {
      emitLog(this.logHandler, 'error', `could not decode the response from ${request.path}`, requestId);
      throw TalqynError.decoding(cause ?? new Error('the response does not have the expected shape'), requestId);
    }
    return value;
  }

  /** Sends a request whose response carries nothing to read (`204`). */
  async send(request: TalqynApiRequest): Promise<void> {
    await this.perform(request);
  }

  private async perform(request: TalqynApiRequest): Promise<{ body: Uint8Array; requestId: string }> {
    // Encoded before the loop and outside it: a body that cannot be encoded was never sent.
    const payload = request.body === undefined ? undefined : utf8Encode(request.body);
    const safety = request.safety ?? 'idempotent';
    let attempt = 0;
    let didRefreshAuthorization = false;

    for (;;) {
      const requestId = makeUuid();
      // Everything before the transport is local — the token included — and a failure there sent
      // nothing that could be carried out twice.
      let didSend = false;
      try {
        throwIfAborted(request.signal);
        const authorization = await abortable(this.authorizer.headers(), request.signal);
        const httpRequest = this.builder.request({
          method: request.method ?? 'POST',
          path: request.path,
          query: request.query,
          body: payload,
          headers: { ...authorization, 'X-Request-ID': requestId },
          timeoutMs: request.timeoutMs,
          signal: request.signal,
          keepalive: request.keepalive,
        });
        didSend = true;
        const { response, body } = await this.transport.send(httpRequest);

        if (response.isSuccess) return { body, requestId };
        // A device token expiring is routine, and reissuing is the only cure. One attempt, not a loop:
        // a second 401 means the cause is not expiry.
        if (response.statusCode === 401 && !didRefreshAuthorization) {
          didRefreshAuthorization = true;
          this.authorizer.invalidate(authorization['Authorization']);
          continue;
        }
        throw errorFromResponse(response, body, requestId);
      } catch (error) {
        const failure = TalqynError.wrap(error);
        const delay = this.retryDelay(failure, safety, didSend, attempt);
        if (delay === undefined) throw failure;
        await this.wait(delay, request.signal);
        attempt += 1;
      }
    }
  }

  /**
   * Whether a failure may be answered by repeating the request.
   *
   * @param didSend Whether the request reached the transport. A failure before it — a token that could
   *   not be minted — is repeated under any safety: nothing was sent to be carried out twice.
   */
  static canRetry(error: TalqynError, safety: TalqynRetrySafety, didSend: boolean): boolean {
    if (!error.isRetryable) return false;
    if (!didSend) return true;
    switch (safety) {
      case 'idempotent':
        return true;
      case 'untilAccepted':
        // A status is an answer, and an answer before the work started means the work did not start. A
        // transport failure has none.
        return error.statusCode !== undefined;
      case 'onlyIfRejected':
        return error.statusCode === 429;
    }
  }

  private retryDelay(failure: TalqynError, safety: TalqynRetrySafety, didSend: boolean, attempt: number): number | undefined {
    if (!TalqynApiClient.canRetry(failure, safety, didSend) || attempt >= this.retryPolicy.maxRetries) return undefined;
    return TalqynRetryPolicy.delay(this.retryPolicy, attempt, failure.retryAfterMs);
  }

  private async wait(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
    if (delayMs > 0) await sleep(delayMs, signal);
    else throwIfAborted(signal);
  }

  // MARK: Server-sent events

  /**
   * A `text/event-stream` of events.
   *
   * Response headers are read **before** the first line: a failing status is an error in full and must
   * be parsed as an ordinary body, not as a stream. Leaving the iteration early closes the request.
   */
  async *stream(request: {
    readonly path: string;
    readonly query?: readonly TalqynQueryItem[];
    readonly body: string;
    readonly signal?: AbortSignal | undefined;
  }): AsyncGenerator<TalqynSseMessage, void, undefined> {
    try {
      const lines = await this.openStream(request);
      const decoder = new TalqynSseDecoder();
      for await (const line of lines) {
        throwIfAborted(request.signal);
        const message = decoder.consume(line);
        if (message) yield message;
      }
      throwIfAborted(request.signal);
      const tail = decoder.finish();
      if (tail) yield tail;
    } catch (error) {
      throw TalqynError.wrap(error);
    }
  }

  /**
   * Opens the stream. Repeated under `untilAccepted`: the turn behind a stream starts once the server
   * answers `200`, so a refusal before it is safe to repeat and a dropped connection is not.
   */
  private async openStream(request: {
    readonly path: string;
    readonly query?: readonly TalqynQueryItem[];
    readonly body: string;
    readonly signal?: AbortSignal | undefined;
  }): Promise<TalqynLineStream> {
    const payload = utf8Encode(request.body);
    let attempt = 0;
    let didRefreshAuthorization = false;

    for (;;) {
      const requestId = makeUuid();
      let didSend = false;
      try {
        throwIfAborted(request.signal);
        const authorization = await abortable(this.authorizer.headers(), request.signal);
        const httpRequest = this.builder.request({
          method: 'POST',
          path: request.path,
          query: request.query,
          body: payload,
          headers: { ...authorization, 'X-Request-ID': requestId },
          accept: 'text/event-stream',
          timeoutMs: this.streamTimeoutMs,
          signal: request.signal,
        });
        didSend = true;
        const { response, lines } = await this.transport.stream(httpRequest);

        if (response.isSuccess) return lines;
        const body = await collectErrorBody(lines);
        if (response.statusCode === 401 && !didRefreshAuthorization) {
          didRefreshAuthorization = true;
          this.authorizer.invalidate(authorization['Authorization']);
          continue;
        }
        throw errorFromResponse(response, body, requestId);
      } catch (error) {
        const failure = TalqynError.wrap(error);
        const delay = this.retryDelay(failure, 'untilAccepted', didSend, attempt);
        if (delay === undefined) throw failure;
        await this.wait(delay, request.signal);
        attempt += 1;
      }
    }
  }
}

/** A failing streamed request delivers its error body as the same lines. Read a bounded amount: this is a small envelope, not a stream. */
async function collectErrorBody(lines: TalqynLineStream): Promise<string> {
  let text = '';
  let bytes = 0;
  const iterator = lines[Symbol.asyncIterator]();
  try {
    // The bound counts UTF-8 bytes, as iOS does: a Cyrillic envelope must cut off at the same point.
    while (bytes < 8 * 1024) {
      const next = await iterator.next();
      if (next.done) break;
      text += next.value;
      bytes += utf8Encode(next.value).length;
    }
  } catch {
    // A read failure means there is no more body to read.
  } finally {
    try {
      await iterator.return?.();
    } catch {
      // Closing a body that already failed has nothing left to report.
    }
  }
  return text;
}
