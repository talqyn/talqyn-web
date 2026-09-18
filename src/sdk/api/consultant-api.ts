import { withConsultantDefaults, withVariantDefault, type TalqynDefaults } from '../defaults.js';
import { throwIfAborted } from '../internal/async.js';
import type { TalqynLocale } from '../locale.js';
import { emitLog, type TalqynLogHandler } from '../log.js';
import { decodeChatSummaries, decodeChatTranscript, type TalqynChatSummary, type TalqynChatTranscript } from '../models/chat-models.js';
import { TalqynConsultantEvent } from '../models/consultant-event.js';
import { decodeConsultantAnswer, type TalqynConsultantAnswer } from '../models/consultant-models.js';
import { encodeFeedback, type TalqynFeedback } from '../models/feedback-models.js';
import { encodeConsultantQuery, type TalqynConsultantQuery } from '../models/queries.js';
import type { TalqynApiClient } from '../networking/api-client.js';
import { TalqynError } from '../networking/error.js';
import { TalqynRequestBuilder } from '../networking/request-builder.js';
import type { TalqynRequestOptions } from '../request-options.js';

/** Options of `talqyn.consultant.ask` and `answer` for a plain question. */
export interface TalqynAskOptions extends TalqynRequestOptions {
  /** The session of the previous turn, when continuing a conversation. */
  readonly sessionId?: string | undefined;
}

/** Options of `talqyn.consultant.chats`. */
export interface TalqynChatsOptions extends TalqynRequestOptions {
  /** How many rows to return. Defaults to 20. */
  readonly limit?: number | undefined;
  /** How many rows to skip. Defaults to 0. */
  readonly offset?: number | undefined;
}

/** Options of `talqyn.consultant.chat`. */
export interface TalqynChatOptions extends TalqynRequestOptions {
  /** The language to hydrate product cards in. Unset uses the client default. */
  readonly locale?: TalqynLocale | undefined;
}

/**
 * The CIP consultant: a conversation turn and the shopper's chat history. Reached through
 * `talqyn.consultant`.
 *
 * Requires the `consultant` scope. This is the one part of the API with direct money behind it —
 * every turn is an LLM call — so it has its own rate-limit bucket, separate from search.
 */
export class TalqynConsultantApi {
  /** @internal Reached through `talqyn.consultant`. */
  constructor(
    private readonly client: TalqynApiClient,
    private readonly defaults: TalqynDefaults,
    private readonly logHandler: TalqynLogHandler | undefined,
  ) {}

  /**
   * Asks the consultant and streams the turn: `POST /v1/consultant/ask`.
   *
   * ```ts
   * for await (const event of talqyn.consultant.ask('need a laptop for school', { sessionId })) {
   *   if (event.type === 'delta') transcript.append(event.text);
   *   if (event.type === 'done') sessionId = event.done.sessionId;
   * }
   * ```
   *
   * The stream always ends with `done`; carry its session id into the next question to continue the
   * conversation. Nothing is read after it: iteration ends at `done` and the request is closed, even if
   * the server or a proxy would keep the connection open. Events this version of the SDK does not
   * recognize are skipped rather than surfaced, so a new event type on the server cannot break a
   * shipped site.
   *
   * The request goes out when the iteration begins, with the client's defaults as they were when this
   * method was called. Iterate the stream **once**. Leaving the iteration early — `break`, a thrown
   * error — or aborting `signal` stops the request, so a turn nobody reads does not keep running.
   *
   * @throws {TalqynError} From the iteration — commonly `rateLimited` when the consultant bucket is
   *   exhausted. A stream that ends **before** `done` was cut short somewhere between Talqyn and the
   *   browser and throws `transport` with `connectionLost`, after the events that did arrive. A turn
   *   that degrades on Talqyn's side does **not** throw: it arrives as a `fallback` event with the
   *   products intact.
   */
  ask(question: string, options?: TalqynAskOptions): AsyncGenerator<TalqynConsultantEvent, void, undefined>;
  ask(query: TalqynConsultantQuery, options?: TalqynRequestOptions): AsyncGenerator<TalqynConsultantEvent, void, undefined>;
  ask(input: string | TalqynConsultantQuery, options: TalqynAskOptions = {}): AsyncGenerator<TalqynConsultantEvent, void, undefined> {
    const query = withConsultantDefaults(
      this.defaults.current,
      typeof input === 'string' ? { question: input, sessionId: options.sessionId } : input,
    );
    return this.turn(query, options.signal);
  }

  private async *turn(
    query: TalqynConsultantQuery,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<TalqynConsultantEvent, void, undefined> {
    let isComplete = false;
    try {
      for await (const message of this.client.stream({ path: 'consultant/ask', body: encodeConsultantQuery(query), signal })) {
        const event = TalqynConsultantEvent.parse(message);
        if (!event) {
          // Skipped by design, but silently is how a renamed event goes unnoticed until a shopper complains.
          emitLog(this.logHandler, 'debug', `consultant event '${message.name}' skipped: unknown or undecodable`);
          continue;
        }
        yield event;
        // `done` closes the turn, whatever the connection does next. Reading on would wait for the
        // server — or a proxy holding an idle connection open — to end the body, and fail a finished
        // turn with a transport error when it gives up. Leaving the loop closes the request.
        if (event.type === 'done') {
          isComplete = true;
          break;
        }
      }
    } catch (error) {
      throw TalqynError.wrap(error);
    }
    // A reader that stopped listening — a closed screen — is not a cut stream.
    throwIfAborted(signal);
    // The contract closes every turn with `done`. Without it the stream was cut short — a proxy, an
    // idle timeout, a dropped connection — and the site must not take a turn that merely stopped for
    // one that finished.
    if (!isComplete) {
      emitLog(this.logHandler, 'warning', 'consultant stream ended without a done event');
      throw TalqynError.transport('connectionLost');
    }
  }

  /**
   * Asks the consultant and waits for the whole turn: `POST /v1/consultant/ask?stream=false`.
   *
   * The answer arrives complete, and therefore later: the shopper waits in silence instead of reading
   * the text as it is generated. Use `ask` for a conversation screen; this is for places with no room
   * for a stream — a widget, or an answer prepared in the background.
   *
   * The request waits as long as a stream waits for its first byte (`streamTimeoutMs`): nothing comes
   * back until the whole turn is written, and the ordinary timeout would cut a long one. A failure is
   * repeated only after a `429`: a turn is an LLM call that may have run before its answer was lost, and
   * a repeat would pay for it twice and write it into the history twice.
   */
  answer(question: string, options?: TalqynAskOptions): Promise<TalqynConsultantAnswer>;
  answer(query: TalqynConsultantQuery, options?: TalqynRequestOptions): Promise<TalqynConsultantAnswer>;
  async answer(input: string | TalqynConsultantQuery, options: TalqynAskOptions = {}): Promise<TalqynConsultantAnswer> {
    const query = withConsultantDefaults(
      this.defaults.current,
      typeof input === 'string' ? { question: input, sessionId: options.sessionId } : input,
    );
    return this.client.fetchJson(
      {
        path: 'consultant/ask',
        query: [['stream', 'false']],
        body: encodeConsultantQuery(query),
        safety: 'onlyIfRejected',
        timeoutMs: this.client.streamTimeoutMs,
        signal: options.signal,
      },
      decodeConsultantAnswer,
    );
  }

  /**
   * Rates a turn: `POST /v1/consultant/feedback`.
   *
   * Rating a turn again replaces its rating. Any turn can be rated — a clarification or a fallback as
   * well as an answer — as long as it has a turn id. Unlike events, a rating is written before the call
   * returns: the thumb has a visible state, and the answer says whether it holds. A failure is repeated
   * like a read — a repeat of the same rating replaces it with itself.
   *
   * @throws {TalqynError} `notFound` when there is no such turn in that conversation, `validation` for a
   *   turn id that is not a UUID or a reason the server does not know.
   */
  async submitFeedback(feedback: TalqynFeedback, options: TalqynRequestOptions = {}): Promise<void> {
    const body = encodeFeedback(withVariantDefault(this.defaults.current, feedback));
    await this.client.send({ path: 'consultant/feedback', body, safety: 'idempotent', signal: options.signal });
  }

  /**
   * Takes a rating back: `DELETE /v1/consultant/feedback/{turn_id}`.
   *
   * @throws {TalqynError} `notFound` when the turn had no rating. That is also what a repeat of a
   *   deletion that did go through answers, so a caller that only wants the rating gone may treat it
   *   as done.
   */
  async withdrawFeedback(turnId: string, options: TalqynRequestOptions = {}): Promise<void> {
    await this.client.send({
      method: 'DELETE',
      path: `consultant/feedback/${TalqynRequestBuilder.segment(turnId)}`,
      safety: 'idempotent',
      signal: options.signal,
    });
  }

  /**
   * Lists the shopper's conversations, newest first: `GET /v1/consultant/chats`.
   *
   * The token must name the shopper — any identity but a guest. Under a guest token the server answers
   * `403` rather than an empty list — deliberately, so that a storefront that forgot to name its
   * shopper cannot ship a silently empty screen.
   */
  async chats(options: TalqynChatsOptions = {}): Promise<TalqynChatSummary[]> {
    return this.client.fetchJson(
      {
        method: 'GET',
        path: 'consultant/chats',
        query: [
          ['limit', String(options.limit ?? 20)],
          ['offset', String(options.offset ?? 0)],
        ],
        signal: options.signal,
      },
      decodeChatSummaries,
    );
  }

  /**
   * Reads one conversation: `GET /v1/consultant/chats/{session_id}`.
   *
   * The transcript arrives with the product cards hydrated, so a conversation can be redrawn with its
   * results rather than as bare text.
   *
   * @throws {TalqynError} `notFound` both for a conversation that does not exist and for one belonging
   *   to somebody else; the two are indistinguishable on purpose.
   */
  async chat(sessionId: string, options: TalqynChatOptions = {}): Promise<TalqynChatTranscript> {
    return this.client.fetchJson(
      {
        method: 'GET',
        path: `consultant/chats/${TalqynRequestBuilder.segment(sessionId)}`,
        query: [['locale', options.locale ?? this.defaults.current.locale]],
        signal: options.signal,
      },
      decodeChatTranscript,
    );
  }

  /**
   * Deletes one of the shopper's conversations: `DELETE /v1/consultant/chats/{session_id}`.
   *
   * Removes both the journal rows and the working memory of the session. This is the shopper clearing
   * one conversation from their own storefront, not an operator erasing a data subject.
   */
  async deleteChat(sessionId: string, options: TalqynRequestOptions = {}): Promise<void> {
    await this.client.send({
      method: 'DELETE',
      path: `consultant/chats/${TalqynRequestBuilder.segment(sessionId)}`,
      signal: options.signal,
    });
  }
}
