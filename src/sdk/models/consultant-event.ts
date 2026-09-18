import { asRecord, decodeString, readArray, readString, type JsonRecord } from '../internal/json.js';
import type { TalqynSseMessage } from '../networking/sse.js';
import {
  decodeClarify,
  decodeConsultantAction,
  decodeConsultantDone,
  decodeConsultantProducts,
  type TalqynClarify,
  type TalqynConsultantAction,
  type TalqynConsultantDone,
  type TalqynConsultantProducts,
  type TalqynConsultantStage,
  type TalqynFallbackReason,
} from './consultant-models.js';

/**
 * One event from the consultant's stream.
 *
 * A turn **always** opens with `status` carrying `thinking` and **always** closes with `done` — a
 * reliable end-of-stream signal whatever the turn turned out to be. In between comes one of these
 * shapes:
 *
 * - **ordinary search**: `status` → `status(searching)` → `products` → `delta`×N → `action`×0…2 →
 *   `followUps`? → `done`;
 * - **clarification**: `status` → `clarify` → `done` — no products yet;
 * - **redirect**: `status` → `redirectToSearch` → `done` — the request was a search query, so run it
 *   through `talqyn.search.search`;
 * - **store question** (delivery, payment, returns, warranty): `status` → `delta` → `done` — short
 *   text, no products;
 * - **degradation**: `status` → `products` → `fallback` → `done` — products are there, text is not;
 * - **retrieval failure**: `status(searching)` → `error` → `done`.
 *
 * Multi-step plans may interleave several `status`, `products`, and `action` events before the
 * closing `delta` and `done`.
 *
 * An event the server adds is skipped by a shipped build, but the SDK release that learns it adds a
 * member to this union: switch with a `default` branch.
 */
export type TalqynConsultantEvent =
  /** What the consultant is doing right now. */
  | { readonly type: 'status'; readonly stage: TalqynConsultantStage }
  /** The products found for this turn. May arrive without any text at all — render results independently of `delta`. */
  | { readonly type: 'products'; readonly products: TalqynConsultantProducts }
  /** An increment of the answer text. May contain `[p:ID]` product markers; see `TalqynAnswerMarkup`. */
  | { readonly type: 'delta'; readonly text: string }
  /** The turn needs more context before it can search. */
  | { readonly type: 'clarify'; readonly clarify: TalqynClarify }
  /** The request was an ordinary search query, not a consultation: `query` is the text to search for. */
  | { readonly type: 'redirectToSearch'; readonly query: string }
  /** The turn will produce no text. Products, if any, have already arrived. */
  | { readonly type: 'fallback'; readonly reason: TalqynFallbackReason }
  /** An interface action the consultant proposes. */
  | { readonly type: 'action'; readonly action: TalqynConsultantAction }
  /**
   * Two or three ready-made follow-up prompts. Exactly one such event per turn, after the text and the
   * actions. Render them as chips and send a tap verbatim as the next question with the same session id.
   */
  | { readonly type: 'followUps'; readonly items: readonly string[] }
  /** The turn failed on Talqyn's side: `code` is `retrieval_failed`, `internal_error`, … */
  | { readonly type: 'error'; readonly code: string }
  /** The turn is over. */
  | { readonly type: 'done'; readonly done: TalqynConsultantDone };

export const TalqynConsultantEvent = {
  /**
   * Parses one stream event.
   *
   * `talqyn.consultant.ask` applies this to every message and skips what it cannot parse, so a new
   * event type on the server does not break a shipped site.
   *
   * @returns The event, or `undefined` when its name is unknown to this version of the SDK or its
   *   payload does not decode.
   */
  parse(message: TalqynSseMessage): TalqynConsultantEvent | undefined {
    let payload: JsonRecord | undefined;
    try {
      payload = asRecord(JSON.parse(message.data));
    } catch {
      return undefined;
    }
    if (!payload) return undefined;

    switch (message.name) {
      case 'status':
        return { type: 'status', stage: readString(payload, 'stage') ?? '' };
      case 'products':
        return { type: 'products', products: decodeConsultantProducts(payload) };
      case 'delta':
        return { type: 'delta', text: readString(payload, 'text') ?? '' };
      case 'clarify': {
        const clarify = decodeClarify(payload);
        return clarify ? { type: 'clarify', clarify } : undefined;
      }
      // `redirect` is the former name of the same event: a storefront that lived through the rename
      // must not lose redirects.
      case 'redirect_to_search':
      case 'redirect':
        return { type: 'redirectToSearch', query: readString(payload, 'query') ?? '' };
      case 'fallback':
        return { type: 'fallback', reason: readString(payload, 'reason') ?? '' };
      case 'action': {
        const action = decodeConsultantAction(payload);
        return action ? { type: 'action', action } : undefined;
      }
      case 'follow_ups':
        return { type: 'followUps', items: readArray(payload, 'items', decodeString) };
      case 'error':
        return { type: 'error', code: readString(payload, 'code') ?? '' };
      case 'done':
        return { type: 'done', done: decodeConsultantDone(payload) };
      default:
        return undefined;
    }
  },

  /** Whether this is `done`, after which the stream yields nothing more. */
  isTerminal(event: TalqynConsultantEvent): boolean {
    return event.type === 'done';
  },
} as const;
