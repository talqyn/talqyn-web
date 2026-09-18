import { asRecord, decodeInteger, readArray, readDate, readInteger, readString } from '../internal/json.js';
import type { TalqynFeedbackVerdict } from './feedback-models.js';
import { decodeProduct, type TalqynProduct } from './product.js';

/** Who wrote a message. Open: a role this version of the SDK has not seen must not cost the message, let alone the transcript. */
export type TalqynChatRole = 'user' | 'assistant' | (string & {});

export const TalqynChatRole = {
  /** The shopper. */
  user: 'user',
  /** The consultant. */
  assistant: 'assistant',
} as const;

/**
 * Which way a turn was routed.
 *
 * Open. A storefront needs this for one reason: so that a redirect turn is not rendered as a consultant
 * reply — its text is the search query the shopper was sent to, not prose written for them.
 */
export type TalqynChatRoute = 'consult' | 'clarify' | 'redirect' | (string & {});

export const TalqynChatRoute = {
  /** The turn was answered by the consultant. */
  consult: 'consult',
  /** The turn asked a clarifying question. */
  clarify: 'clarify',
  /** The turn redirected to ordinary search. */
  redirect: 'redirect',
} as const;

/** One row in the shopper's list of conversations. */
export interface TalqynChatSummary {
  /** The conversation id: read it with `consultant.chat`, or continue it by passing it as the session id. */
  readonly sessionId: string;
  /** The shopper's first message, truncated. `undefined` for conversations started before history existed. */
  readonly title: string | undefined;
  /** The transcript length in **messages**, not turns: one turn writes two rows. */
  readonly messageCount: number;
  /** When the conversation started. */
  readonly createdAt: Date | undefined;
  /** When the last message was written. This is what the list is sorted by, newest first. */
  readonly lastMessageAt: Date | undefined;
}

/** One message in a transcript. */
export interface TalqynChatMessage {
  /** Who wrote the message. */
  readonly role: TalqynChatRole;
  /** The message text. */
  readonly text: string;
  /**
   * The products shown in this turn, as Talqyn's internal ids. The cards themselves live in the
   * transcript's `products`; resolve them with {@link TalqynChatTranscript.productsFor}.
   */
  readonly talqynIds: readonly number[];
  /** How the turn was routed. `undefined` for assistant messages and for rows written before routing was recorded. */
  readonly route: TalqynChatRoute | undefined;
  /**
   * The id of the turn this message belongs to — the same on the shopper's message and on the answer.
   * The key to rate the turn with. `undefined` for turns written before ratings existed.
   */
  readonly turnId: string | undefined;
  /** The rating the shopper already gave the turn, so a reopened chat shows the thumb that is down instead of inviting a second tap. */
  readonly feedback: TalqynFeedbackVerdict | undefined;
  /** When the message was written. */
  readonly createdAt: Date | undefined;
}

export const TalqynChatMessage = {
  /** Whether the turn redirected to ordinary search, making the text a search query rather than a reply. */
  isRedirect(message: TalqynChatMessage): boolean {
    return message.route === TalqynChatRoute.redirect;
  },
} as const;

/** A full conversation transcript. */
export interface TalqynChatTranscript {
  /** The conversation id. */
  readonly sessionId: string;
  /** The shopper's first message, truncated. */
  readonly title: string | undefined;
  /** Every message, oldest first. */
  readonly messages: readonly TalqynChatMessage[];
  /**
   * Every product mentioned anywhere in the transcript, deduplicated.
   *
   * Prices and availability are **current**, not what they were during the conversation: showing last
   * year's price as if it still stood is worse than showing one that changed. Products deleted from the
   * catalog since the conversation are simply absent — the id remains in the message with no card
   * behind it.
   */
  readonly products: readonly TalqynProduct[];
}

export const TalqynChatTranscript = {
  /**
   * The products shown in one message, in the order they were shown. Ids with no card behind them are
   * skipped.
   */
  productsFor(transcript: TalqynChatTranscript, message: TalqynChatMessage): TalqynProduct[] {
    const index = new Map<number, TalqynProduct>();
    for (const product of transcript.products) {
      if (!index.has(product.talqynId)) index.set(product.talqynId, product);
    }
    return message.talqynIds.flatMap((id) => {
      const product = index.get(id);
      return product ? [product] : [];
    });
  },
} as const;

function decodeChatSummary(value: unknown): TalqynChatSummary | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    sessionId: readString(record, 'session_id') ?? '',
    title: readString(record, 'title'),
    messageCount: readInteger(record, 'message_count') ?? 0,
    createdAt: readDate(record, 'created_at'),
    lastMessageAt: readDate(record, 'last_message_at'),
  };
}

/** Decodes the list of conversations. A list with an element that is not an object does not decode. */
export function decodeChatSummaries(value: unknown): TalqynChatSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const summaries: TalqynChatSummary[] = [];
  for (const element of value) {
    const summary = decodeChatSummary(element);
    if (!summary) return undefined;
    summaries.push(summary);
  }
  return summaries;
}

/** Decodes a transcript message. A message with no role — one nobody wrote — cannot be rendered, and is dropped. */
function decodeChatMessage(value: unknown): TalqynChatMessage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const role = readString(record, 'role');
  if (!role) return undefined;
  const feedback = readString(record, 'feedback');
  return {
    role,
    text: readString(record, 'text') ?? '',
    talqynIds: readArray(record, 'talqyn_ids', decodeInteger),
    route: readString(record, 'route'),
    turnId: readString(record, 'turn_id'),
    feedback: feedback === 'up' || feedback === 'down' ? feedback : undefined,
    createdAt: readDate(record, 'created_at'),
  };
}

/** Decodes a transcript. A message or a card that does not decode is dropped on its own; the rest stays. */
export function decodeChatTranscript(value: unknown): TalqynChatTranscript | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    sessionId: readString(record, 'session_id') ?? '',
    title: readString(record, 'title'),
    messages: readArray(record, 'messages', decodeChatMessage),
    products: readArray(record, 'products', decodeProduct),
  };
}
