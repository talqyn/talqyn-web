import type {
  TalqynClarify,
  TalqynClarifyQuestion,
  TalqynConsultantAction,
  TalqynConsultantStage,
  TalqynError,
  TalqynFallbackReason,
  TalqynFeedbackReason,
  TalqynFeedbackVerdict,
  TalqynProduct,
  TalqynProductGroup,
} from '../sdk/index.js';
import { makeUuid } from '../sdk/internal/random.js';

/** What the shopper sent. */
export interface TalqynUserTurn {
  readonly type: 'user';
  /** The stable identity of the turn, kept across every update to it. */
  readonly id: string;
  readonly text: string;
}

export const TalqynUserTurn = {
  create(text: string, id: string = makeUuid()): TalqynUserTurn {
    return { type: 'user', id, text };
  },
} as const;

/** The shopper's verdict on an answer. */
export type TalqynAnswerRating = 'helpful' | 'not_helpful';

export const TalqynAnswerRating = {
  helpful: 'helpful',
  notHelpful: 'not_helpful',

  /** The verdict the API takes for this rating. */
  verdict(rating: TalqynAnswerRating): TalqynFeedbackVerdict {
    return rating === 'helpful' ? 'up' : 'down';
  },

  /** The rating a verdict stands for — for a turn reopened from history. */
  fromVerdict(verdict: TalqynFeedbackVerdict): TalqynAnswerRating {
    return verdict === 'up' ? 'helpful' : 'not_helpful';
  },
} as const;

/**
 * The consultant's answer to one question, filled in as the stream arrives.
 *
 * Read it as a snapshot: while the conversation is streaming, the last assistant turn is replaced by
 * a new object on every change. A screen compares turns by reference — a changed turn is a new object —
 * so a property added here redraws the turn without anyone having to remember to compare it.
 */
export interface TalqynAssistantTurn {
  readonly type: 'assistant';
  /** The stable identity of the turn, kept across every update to it. */
  readonly id: string;
  /** The question this turn answers — the shopper's text, or a clarify answer, or the question repeated on retry. */
  readonly question: string;
  /** The answer text so far, markers included; see `TalqynAnswerRenderer`. */
  readonly text: string;
  /** Every product the turn found, deduplicated, in order of arrival. */
  readonly products: readonly TalqynProduct[];
  /** The products split by role, for a multi-step plan. */
  readonly groups: readonly TalqynProductGroup[] | undefined;
  /** The impression id of the turn's products, for click events. */
  readonly searchId: string | undefined;
  /** What the consultant is doing right now; `undefined` once the turn settled. */
  readonly stage: TalqynConsultantStage | undefined;
  /** The actions proposed so far. */
  readonly actions: readonly TalqynConsultantAction[];
  /** Follow-up prompts, sanitized: trimmed, deduplicated, and no more than the conversation's `maxFollowUps`. */
  readonly followUps: readonly string[];
  /** The clarifying questions, when the turn asked instead of answering. */
  readonly clarify: TalqynClarify | undefined;
  /** What the shopper answered to {@link clarify}, once they did. */
  readonly clarifyAnswer: string | undefined;
  /** The search query, when the request turned out to be a search. */
  readonly redirectQuery: string | undefined;
  /** Why the turn produced no text, when it produced none. */
  readonly fallbackReason: TalqynFallbackReason | undefined;
  /** The server's failure code, from an `error` event. */
  readonly errorCode: string | undefined;
  /** The client-side failure that ended the stream, if one did. */
  readonly failure: TalqynError | undefined;
  /** Whether the shopper stopped the answer. */
  readonly wasStopped: boolean;
  /**
   * The turn's id on Talqyn's side, from its `done` event: what a rating is saved under. `undefined`
   * until the turn is done, and for a turn from a server that predates ratings — such a turn is rated
   * on the device only.
   */
  readonly talqynTurnId: string | undefined;
  /** The conversation the turn was taken in, from its `done` event. */
  readonly sessionId: string | undefined;
  /** How the shopper rated the answer, once they did. */
  readonly rating: TalqynAnswerRating | undefined;
  /** Why the shopper found the answer unhelpful, most important first. Empty unless {@link rating} is `not_helpful`. */
  readonly feedbackReasons: readonly TalqynFeedbackReason[];
  readonly timeToFirstTokenMs: number | undefined;
  readonly totalMs: number | undefined;
}

export const TalqynAssistantTurn = {
  /** A turn that has just been asked: thinking, with nothing in it yet. */
  create(question: string, id: string = makeUuid()): TalqynAssistantTurn {
    return {
      type: 'assistant',
      id,
      question,
      text: '',
      products: [],
      groups: undefined,
      searchId: undefined,
      stage: 'thinking',
      actions: [],
      followUps: [],
      clarify: undefined,
      clarifyAnswer: undefined,
      redirectQuery: undefined,
      fallbackReason: undefined,
      errorCode: undefined,
      failure: undefined,
      wasStopped: false,
      talqynTurnId: undefined,
      sessionId: undefined,
      rating: undefined,
      feedbackReasons: [],
      timeToFirstTokenMs: undefined,
      totalMs: undefined,
    };
  },

  /** Whether the turn ended in a failure of any kind: a server error, a dropped stream, or the shopper stopping it. */
  didFail(turn: TalqynAssistantTurn): boolean {
    return turn.errorCode !== undefined || turn.failure !== undefined || turn.wasStopped;
  },

  /** Whether the turn answered with products or text, rather than a question, a redirect, or a failure. */
  isAnswer(turn: TalqynAssistantTurn): boolean {
    return turn.clarify === undefined && turn.redirectQuery === undefined && !TalqynAssistantTurn.didFail(turn);
  },

  /** Whether a rating of the turn reaches Talqyn, rather than staying on the device. */
  isRatedRemotely(turn: TalqynAssistantTurn): boolean {
    return turn.talqynTurnId !== undefined && turn.sessionId !== undefined;
  },
} as const;

/** One entry of a conversation: what the shopper said, or what the consultant answered. */
export type TalqynTurn = TalqynUserTurn | TalqynAssistantTurn;

/** The shopper's in-progress answer to a clarifying question. */
export interface TalqynClarifyDraft {
  /** Selected options by question id. */
  readonly selected: Readonly<Record<string, readonly string[]>>;
  /** Free text typed instead of, or in addition to, the options. */
  readonly custom: string;
}

export const TalqynClarifyDraft = {
  /** Nothing chosen, nothing typed. */
  empty: Object.freeze({ selected: Object.freeze({}), custom: '' }) as TalqynClarifyDraft,

  /** Whether anything has been chosen or typed. */
  isEmpty(draft: TalqynClarifyDraft): boolean {
    return Object.values(draft.selected).every((values) => values.length === 0) && draft.custom.trim().length === 0;
  },

  /** Toggles an option. A single-choice question replaces its selection; a multiple-choice one adds and removes. */
  toggle(draft: TalqynClarifyDraft, option: string, question: TalqynClarifyQuestion): TalqynClarifyDraft {
    let current = [...(draft.selected[question.id] ?? [])];
    if (question.multi) {
      const index = current.indexOf(option);
      if (index >= 0) current.splice(index, 1);
      else current.push(option);
    } else {
      current = current.length === 1 && current[0] === option ? [] : [option];
    }
    const selected: Record<string, readonly string[]> = { ...draft.selected };
    if (current.length === 0) delete selected[question.id];
    else selected[question.id] = current;
    return { ...draft, selected };
  },

  /** The draft with its free text replaced. */
  withCustom(draft: TalqynClarifyDraft, custom: string): TalqynClarifyDraft {
    return { ...draft, custom };
  },

  /** Whether an option is selected. */
  isSelected(draft: TalqynClarifyDraft, option: string, question: TalqynClarifyQuestion): boolean {
    return draft.selected[question.id]?.includes(option) ?? false;
  },

  /**
   * The answer to send: `Budget: up to 300k. Screen: 15". <free text>`, with the labels and options as
   * the questions carried them. The label loses its question mark: it is restated, not asked back.
   */
  answer(draft: TalqynClarifyDraft, questions: readonly TalqynClarifyQuestion[]): string {
    const parts = questions.flatMap((question) => {
      const values = draft.selected[question.id];
      if (!values || values.length === 0) return [];
      return [`${trimCharacters(question.label, '? \t')}: ${values.join(', ')}`];
    });
    const base = parts.length === 0 ? '' : `${parts.join('. ')}.`;
    const extra = draft.custom.trim();
    if (extra.length === 0) return base;
    return base.length === 0 ? extra : `${base} ${extra}`;
  },
} as const;

function trimCharacters(value: string, characters: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && characters.includes(value[start]!)) start++;
  while (end > start && characters.includes(value[end - 1]!)) end--;
  return value.slice(start, end);
}

/** The contract's input limits. */
export const TalqynConversationLimits = {
  /** The longest question the API accepts. */
  maxInputLength: 2000,
  /** The longest free-text clarify answer. */
  maxClarifyCustomLength: 500,
  /** How many follow-up prompts to show, unless a conversation is built with its own `maxFollowUps`. */
  maxFollowUps: 3,
} as const;
