import { encodeJson } from '../internal/json.js';

/**
 * A shopper's verdict on one consultant turn.
 *
 * Closed on purpose: the contract has exactly two values, and a third would not be a new verdict but a
 * different feature.
 */
export type TalqynFeedbackVerdict = 'up' | 'down';

export const TalqynFeedbackVerdict = {
  /** The answer helped. */
  up: 'up',
  /** The answer did not. */
  down: 'down',
} as const;

/**
 * Why a turn did not help.
 *
 * A dislike without a reason says only "bad". The reasons exist to say **what** to fix, and each points
 * at a different part of the consultant — a reason is worth more than the thumb it comes with.
 *
 * Open like the other wire values the contract may grow; the server rejects a value it does not know
 * with `422`, so send the ones declared here.
 */
export type TalqynFeedbackReason =
  | 'not_relevant'
  | 'wrong_info'
  | 'too_many_questions'
  | 'no_answer'
  | 'price_stock'
  | 'other'
  | (string & {});

export const TalqynFeedbackReason = {
  /** The products are not what was asked for. */
  notRelevant: 'not_relevant',
  /** The answer states something that is not true. */
  wrongInfo: 'wrong_info',
  /** The consultant asked too many clarifying questions. */
  tooManyQuestions: 'too_many_questions',
  /** There was no answer — the turn fell back or failed. */
  noAnswer: 'no_answer',
  /** A price or the availability is wrong. */
  priceStock: 'price_stock',
  /** Something else; say what in the comment. */
  other: 'other',
} as const;

/**
 * A shopper's rating of one consultant turn: `POST /v1/consultant/feedback`.
 *
 * A turn is named by {@link turnId}, which arrives in `done.turnId` — or in the answer of
 * `consultant.answer`, or in a transcript message for a turn reopened from history. Knowing the id is
 * what entitles a storefront to rate the turn: it was shown to this client and no other.
 *
 * Rating the same turn again replaces the previous rating — the shopper changed their mind, they did
 * not rate twice.
 */
export interface TalqynFeedback {
  /** The turn, from its `done` event. */
  readonly turnId: string;
  /** The conversation the turn belongs to — the session id from the same `done` event. A turn from another conversation is `404`. */
  readonly sessionId: string;
  /** Up or down. */
  readonly verdict: TalqynFeedbackVerdict;
  /** Why the turn did not help, most important first. Down only: the server drops reasons sent with `up`. Up to six. */
  readonly reasons?: readonly TalqynFeedbackReason[] | undefined;
  /** The shopper's own words. Down only, up to 500 characters. */
  readonly comment?: string | undefined;
  /** The cards the shopper called out as wrong, by `talqynId`. Down only, up to 20. */
  readonly talqynIds?: readonly number[] | undefined;
  /** The storefront's A/B bucket. Filled from the client default when unset. */
  readonly variant?: string | undefined;
}

/** The rating body. The down-only fields are left out of an up rating rather than sent for the server to drop. */
export function encodeFeedback(feedback: TalqynFeedback): string {
  const isDown = feedback.verdict === 'down';
  const reasons = feedback.reasons ?? [];
  const talqynIds = feedback.talqynIds ?? [];
  return encodeJson({
    turn_id: feedback.turnId,
    session_id: feedback.sessionId,
    verdict: feedback.verdict,
    reasons: isDown && reasons.length > 0 ? reasons : undefined,
    comment: isDown ? (feedback.comment ?? undefined) : undefined,
    talqyn_ids: isDown && talqynIds.length > 0 ? talqynIds : undefined,
    variant: feedback.variant ?? undefined,
  });
}
