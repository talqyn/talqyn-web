import {
  TalqynChatMessage,
  TalqynError,
  type Talqyn,
  type TalqynChatTranscript,
  type TalqynConsultantEvent,
  type TalqynConsultantQuery,
  type TalqynDeviceIdentity,
  type TalqynFeedbackReason,
  type TalqynProduct,
} from '../sdk/index.js';
import { TalqynClientStage } from './client-stages.js';
import { TalqynStore, type TalqynListener } from './store.js';
import {
  TalqynAnswerRating,
  TalqynAssistantTurn,
  TalqynConversationLimits,
  TalqynUserTurn,
  type TalqynClarifyDraft,
  type TalqynTurn,
} from './turn.js';

/** Everything the consultant screen shows, as one snapshot. */
export interface TalqynConversationState {
  /** The turns in order. The last assistant turn changes while {@link isStreaming} is `true`. */
  readonly turns: readonly TalqynTurn[];
  /** Whether an answer is being streamed right now. */
  readonly isStreaming: boolean;
  /** Whether a chat from history is being loaded. */
  readonly isRestoring: boolean;
  /** The conversation id, once the first turn is done. */
  readonly sessionId: string | undefined;
  /** The composer text. */
  readonly draft: string;
  /** In-progress clarify answers by turn id, so a draft survives a re-render. */
  readonly clarifyDrafts: ReadonlyMap<string, TalqynClarifyDraft>;
  /** Every product seen in this conversation, by Talqyn id: what `[p:ID]` markers and comparison tables resolve against. */
  readonly productsById: ReadonlyMap<number, TalqynProduct>;
  /** The last failure to load a chat from history, for an alert. Cleared by the next attempt. */
  readonly restoreFailure: TalqynError | undefined;
  /**
   * The last rating Talqyn did not save. The turn's rating is already put back to what Talqyn holds; this
   * is for a screen that also wants to say so. Cleared by the next rating.
   */
  readonly feedbackFailure: TalqynError | undefined;
}

function normalized(text: string): string {
  return text.toLowerCase().trim();
}

export const TalqynConversationState = {
  /**
   * A conversation with nothing in it. Built afresh on every read: `Object.freeze` cannot reach
   * inside a `Map`, and a shared instance would let one conversation's in-place write leak into
   * every other.
   */
  get initial(): TalqynConversationState {
    return Object.freeze({
      turns: Object.freeze([]),
      isStreaming: false,
      isRestoring: false,
      sessionId: undefined,
      draft: '',
      clarifyDrafts: new Map(),
      productsById: new Map(),
      restoreFailure: undefined,
      feedbackFailure: undefined,
    }) as TalqynConversationState;
  },

  /** Whether the screen has nothing to show yet. */
  isEmpty(state: TalqynConversationState): boolean {
    return state.turns.length === 0;
  },

  /**
   * The prompts to offer under the transcript: the last turn's follow-ups, or — after the very first
   * answer — the example questions not yet asked.
   *
   * A turn the consultant gave up on offers none: whatever stopped it — a spent budget, a timeout — would
   * stop the next question too, so inviting one would only walk the shopper into the same wall.
   *
   * @param examples The example questions, from the copy.
   */
  suggestedQuestions(state: TalqynConversationState, examples: readonly string[]): string[] {
    const last = state.turns[state.turns.length - 1];
    if (state.isStreaming || last?.type !== 'assistant') return [];
    if (last.fallbackReason !== undefined) return [];
    if (last.followUps.length > 0) return [...last.followUps];
    const assistantCount = state.turns.reduce((count, turn) => count + (turn.type === 'assistant' ? 1 : 0), 0);
    if (!TalqynAssistantTurn.isAnswer(last) || assistantCount !== 1) return [];
    const asked = new Set(state.turns.flatMap((turn) => (turn.type === 'assistant' ? [normalized(turn.question)] : [])));
    return examples.filter((example) => !asked.has(normalized(example)));
  },

  /** Whether the clarify card of a turn takes input: only the latest turn, and only when nothing is streaming. */
  isClarifyInteractive(state: TalqynConversationState, turn: TalqynAssistantTurn): boolean {
    return !state.isStreaming && state.turns[state.turns.length - 1]?.id === turn.id;
  },

  /** Whether a turn is the latest one, which is where a retry makes sense. */
  isLast(state: TalqynConversationState, turn: TalqynAssistantTurn): boolean {
    return state.turns[state.turns.length - 1]?.id === turn.id;
  },

  /** The assistant turn with this id, if the conversation still has it. */
  assistantTurn(state: TalqynConversationState, id: string): TalqynAssistantTurn | undefined {
    const turn = state.turns.find((candidate) => candidate.id === id);
    return turn?.type === 'assistant' ? turn : undefined;
  },
} as const;

/** Options of {@link TalqynConversation}. */
export interface TalqynConversationOptions {
  /**
   * How many follow-up prompts to keep from a turn. `0` shows none. How many questions to put in front of
   * the shopper is the storefront's call, not the SDK's; the server may send more than are worth showing.
   * Defaults to three.
   */
  readonly maxFollowUps?: number;
}

/** A rating as Talqyn holds it. */
interface FeedbackState {
  readonly rating: TalqynAnswerRating | undefined;
  readonly reasons: readonly TalqynFeedbackReason[];
}

const unrated: FeedbackState = Object.freeze({ rating: undefined, reasons: Object.freeze([]) });

function sameFeedback(a: FeedbackState, b: FeedbackState): boolean {
  return a.rating === b.rating && a.reasons.length === b.reasons.length && a.reasons.every((reason, index) => reason === b.reasons[index]);
}

/** How long deltas are batched before they reach the view. Rendering on every token is wasted work: text arrives faster than it is read. */
const DELTA_FLUSH_INTERVAL_MS = 80;

/**
 * The consultant conversation: turns, streaming, clarifications, ratings, history.
 *
 * This is the logic of the consultant screen with no view attached. It backs the screen in
 * `@talqyn/web/ui`, and it is public so a storefront that draws its own screen — in React, Vue, or
 * anything else — gets the same behavior — delta batching, retry, clarify answers, ratings, restoring a
 * chat, click events — by observing {@link state} instead of reimplementing it over `talqyn.consultant`.
 *
 * ```ts
 * const conversation = new TalqynConversation(talqyn);
 * conversation.subscribe((state) => render(state.turns));
 * conversation.send('need a laptop for school');
 *
 * // React
 * const state = useSyncExternalStore(conversation.subscribe, () => conversation.state);
 * ```
 *
 * Every turn is an LLM call, and one nobody will read is still being paid for: call {@link stop} when the
 * screen goes away for good. The screen of `@talqyn/web/ui` does it itself when it is taken off the page.
 */
export class TalqynConversation {
  /** The client the conversation talks through. */
  readonly talqyn: Talqyn;

  /** How many follow-up prompts the screen offers under an answer. */
  readonly maxFollowUps: number;

  private readonly store = new TalqynStore<TalqynConversationState>(TalqynConversationState.initial);
  private streamController: AbortController | undefined;
  private restoreController: AbortController | undefined;
  private pendingDelta = '';
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private identitySnapshot: TalqynDeviceIdentity | undefined;

  /** What Talqyn last confirmed for each turn: what a failed update falls back to, and what the next one is compared against. */
  private readonly confirmedFeedback = new Map<string, FeedbackState>();

  /**
   * One sync per turn. Taps arriving while one runs are not queued: the sync sends the latest state when
   * its request returns, so three quick taps cost two requests, not three, and the last one always wins.
   */
  private readonly feedbackTasks = new Map<string, Promise<void>>();

  constructor(talqyn: Talqyn, options: TalqynConversationOptions = {}) {
    this.talqyn = talqyn;
    this.maxFollowUps = Math.max(0, options.maxFollowUps ?? TalqynConversationLimits.maxFollowUps);
  }

  // MARK: State

  /** Everything the screen shows, as of now. A new object on every change. */
  get state(): TalqynConversationState {
    return this.store.get();
  }

  /** Listens for changes of {@link state}. Bound, so it can be handed over as it is. @returns What stops the listening. */
  readonly subscribe = (listener: TalqynListener<TalqynConversationState>): (() => void) => this.store.subscribe(listener);

  /** Whether the screen has nothing to show yet. */
  get isEmpty(): boolean {
    return TalqynConversationState.isEmpty(this.state);
  }

  /** See {@link TalqynConversationState.suggestedQuestions}. */
  suggestedQuestions(examples: readonly string[]): string[] {
    return TalqynConversationState.suggestedQuestions(this.state, examples);
  }

  /** Whether the clarify card of a turn takes input: only the latest turn, and only when nothing is streaming. */
  isClarifyInteractive(turn: TalqynAssistantTurn): boolean {
    return TalqynConversationState.isClarifyInteractive(this.state, turn);
  }

  /** Whether a turn is the latest one, which is where a retry makes sense. */
  isLast(turn: TalqynAssistantTurn): boolean {
    return TalqynConversationState.isLast(this.state, turn);
  }

  /** The assistant turn with this id, if the conversation still has it. */
  assistantTurn(id: string): TalqynAssistantTurn | undefined {
    return TalqynConversationState.assistantTurn(this.state, id);
  }

  // MARK: Composer and clarify drafts

  /** Sets the composer text — to prefill a question, or as the shopper types. */
  setDraft(text: string): void {
    if (this.state.draft === text) return;
    this.store.update((state) => ({ ...state, draft: text }));
  }

  /** Keeps an in-progress clarify answer for a turn. */
  setClarifyDraft(turnId: string, draft: TalqynClarifyDraft): void {
    this.store.update((state) => {
      const drafts = new Map(state.clarifyDrafts);
      drafts.set(turnId, draft);
      return { ...state, clarifyDrafts: drafts };
    });
  }

  /** Clears {@link TalqynConversationState.restoreFailure} once it has been shown. */
  clearRestoreFailure(): void {
    if (this.state.restoreFailure === undefined) return;
    this.store.update((state) => ({ ...state, restoreFailure: undefined }));
  }

  /** Clears {@link TalqynConversationState.feedbackFailure} once it has been shown. */
  clearFeedbackFailure(): void {
    if (this.state.feedbackFailure === undefined) return;
    this.store.update((state) => ({ ...state, feedbackFailure: undefined }));
  }

  // MARK: Sending

  /** Sends a question. Empty text, a stream in progress, or a restore in progress make this a no-op. */
  send(text: string): void {
    this.sendQuestion(text, true, undefined);
  }

  /**
   * Stops the current answer. What arrived stays; the turn is marked as stopped and can be retried.
   *
   * Call it when the screen goes away for good: every turn is an LLM call, and one nobody will read is
   * still being paid for.
   */
  stop(): void {
    this.streamController?.abort();
  }

  /** Starts over: a new session with an empty transcript. Ignored while an answer is streaming. */
  reset(): void {
    if (this.state.isStreaming) return;
    this.restoreController?.abort();
    this.restoreController = undefined;
    this.confirmedFeedback.clear();
    this.cancelPendingDelta();
    this.store.update((state) => ({
      ...state,
      turns: [],
      isRestoring: false,
      productsById: new Map(),
      clarifyDrafts: new Map(),
      sessionId: undefined,
    }));
  }

  /** Asks the same question again, dropping that turn and everything after it. */
  retry(turnId: string): void {
    const turns = this.state.turns;
    const index = turns.findIndex((turn) => turn.id === turnId);
    const turn = turns[index];
    if (turn?.type !== 'assistant') return;
    this.sendQuestion(turn.question, false, index);
  }

  /**
   * Answers a clarifying question. The answer is recorded on that turn and sent as the next question in
   * the same session.
   *
   * @param answer The composed answer; see `TalqynClarifyDraft.answer`.
   */
  submitClarify(turnId: string, answer: string): void {
    if (!this.assistantTurn(turnId)) return;
    this.replaceAssistant(turnId, (turn) => ({ ...turn, clarifyAnswer: answer }));
    this.store.update((state) => {
      if (!state.clarifyDrafts.has(turnId)) return state;
      const drafts = new Map(state.clarifyDrafts);
      drafts.delete(turnId);
      return { ...state, clarifyDrafts: drafts };
    });
    this.sendQuestion(answer, false, undefined);
  }

  private sendQuestion(raw: string, showsBubble: boolean, replaceIndex: number | undefined): void {
    const question = raw.trim();
    const current = this.state;
    if (question.length === 0 || current.isStreaming || current.isRestoring) return;

    let turns = [...current.turns];
    let drafts = current.clarifyDrafts;
    let products = current.productsById;
    if (replaceIndex !== undefined) {
      const dropped = turns.slice(replaceIndex).map((turn) => turn.id);
      turns = turns.slice(0, replaceIndex);
      const remaining = new Map(drafts);
      for (const id of dropped) {
        remaining.delete(id);
        this.confirmedFeedback.delete(id);
      }
      drafts = remaining;
      products = productIndex(turns);
    }
    if (showsBubble) turns.push(TalqynUserTurn.create(question));
    turns.push(TalqynAssistantTurn.create(question));
    this.store.set({
      ...current,
      turns,
      clarifyDrafts: drafts,
      productsById: products,
      draft: '',
      isStreaming: true,
    });

    const controller = new AbortController();
    this.streamController = controller;
    void this.runTurn({ question, sessionId: current.sessionId }, controller);
  }

  private async runTurn(query: TalqynConsultantQuery, controller: AbortController): Promise<void> {
    try {
      for await (const event of this.talqyn.consultant.ask(query, { signal: controller.signal })) {
        this.apply(event);
      }
    } catch (error) {
      const failure = TalqynError.wrap(error);
      this.flushPendingDelta();
      this.mutateLastAssistant((turn) => {
        // Stopped — by the shopper, or by a closed screen. What arrived stays, and the turn must not read
        // as finished.
        if (failure.isCancellation) return { ...turn, wasStopped: true };
        return turn.errorCode === undefined ? { ...turn, failure } : turn;
      });
    }
    if (this.streamController === controller) this.streamController = undefined;
    this.flushPendingDelta();
    this.mutateLastAssistant((turn) => (turn.stage === undefined ? turn : { ...turn, stage: undefined }));
    this.store.update((state) => ({ ...state, isStreaming: false }));
  }

  private apply(event: TalqynConsultantEvent): void {
    if (event.type === 'delta') {
      this.pendingDelta += event.text;
      this.scheduleDeltaFlush();
      return;
    }
    this.flushPendingDelta();
    switch (event.type) {
      case 'status':
        this.mutateLastAssistant((turn) => ({ ...turn, stage: event.stage }));
        break;
      case 'products': {
        const payload = event.products;
        this.mutateLastAssistant((turn) => {
          // One card per product in a turn. A payload may repeat an item — one the turn already has, or
          // one of its own — and a product listed twice is drawn twice. The first occurrence stays, in its place.
          const seen = new Set(turn.products.map((product) => product.talqynId));
          const added = payload.items.filter((item) => {
            if (seen.has(item.talqynId)) return false;
            seen.add(item.talqynId);
            return true;
          });
          return {
            ...turn,
            products: [...turn.products, ...added],
            groups: payload.groups ?? turn.groups,
            searchId: payload.searchId ?? turn.searchId,
            // Products are in; the text is what remains to wait for.
            stage: turn.text.length === 0 ? TalqynClientStage.composing : undefined,
          };
        });
        this.store.update((state) => {
          const productsById = new Map(state.productsById);
          for (const item of payload.items) productsById.set(item.talqynId, item);
          return { ...state, productsById };
        });
        break;
      }
      case 'clarify':
        this.mutateLastAssistant((turn) => ({ ...turn, clarify: event.clarify, stage: undefined }));
        break;
      case 'redirectToSearch':
        this.mutateLastAssistant((turn) => ({ ...turn, redirectQuery: event.query, stage: undefined }));
        break;
      case 'fallback':
        this.mutateLastAssistant((turn) => ({ ...turn, fallbackReason: event.reason, stage: undefined }));
        break;
      case 'action':
        this.mutateLastAssistant((turn) => ({ ...turn, actions: [...turn.actions, event.action] }));
        break;
      case 'followUps':
        this.mutateLastAssistant((turn) => ({
          ...turn,
          followUps: TalqynConversation.sanitizedFollowUps(event.items, this.maxFollowUps),
        }));
        break;
      case 'error':
        this.mutateLastAssistant((turn) => ({ ...turn, errorCode: event.code, stage: undefined }));
        break;
      case 'done': {
        const done = event.done;
        const session = done.sessionId.length === 0 ? undefined : done.sessionId;
        this.store.update((state) => ({ ...state, sessionId: session ?? state.sessionId }));
        this.mutateLastAssistant((turn) => ({
          ...turn,
          talqynTurnId: done.turnId,
          sessionId: session,
          timeToFirstTokenMs: done.timeToFirstTokenMs,
          totalMs: done.totalMs,
        }));
        break;
      }
    }
  }

  private scheduleDeltaFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushPendingDelta();
    }, DELTA_FLUSH_INTERVAL_MS);
  }

  private flushPendingDelta(): void {
    if (this.pendingDelta.length === 0) return;
    const text = this.pendingDelta;
    this.pendingDelta = '';
    this.mutateLastAssistant((turn) => ({ ...turn, text: turn.text + text, stage: undefined }));
  }

  private cancelPendingDelta(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.pendingDelta = '';
  }

  private mutateLastAssistant(change: (turn: TalqynAssistantTurn) => TalqynAssistantTurn): void {
    this.store.update((state) => {
      const last = state.turns[state.turns.length - 1];
      if (last?.type !== 'assistant') return state;
      const next = change(last);
      if (next === last) return state;
      return { ...state, turns: [...state.turns.slice(0, -1), next] };
    });
  }

  private replaceAssistant(turnId: string, change: (turn: TalqynAssistantTurn) => TalqynAssistantTurn): void {
    this.store.update((state) => ({
      ...state,
      turns: state.turns.map((turn) => (turn.id === turnId && turn.type === 'assistant' ? change(turn) : turn)),
    }));
  }

  /** Trimmed, deduplicated case-insensitively, at most `limit` of them. */
  static sanitizedFollowUps(items: readonly string[], limit: number = TalqynConversationLimits.maxFollowUps): string[] {
    if (limit <= 0) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      const question = item.trim();
      const key = question.toLowerCase();
      if (question.length === 0 || seen.has(key)) continue;
      seen.add(key);
      result.push(question);
      if (result.length === limit) break;
    }
    return result;
  }

  // MARK: Ratings

  /**
   * Records the shopper's verdict on a turn and saves it with Talqyn.
   *
   * The turn shows the new rating at once. Saving follows in the background; if Talqyn does not take it,
   * the turn goes back to the rating Talqyn holds and `feedbackFailure` says why — a thumb that looks
   * pressed must be pressed. Taps faster than the network are coalesced: the last one is what is saved,
   * and taps that end where they started send nothing.
   *
   * A turn with no `talqynTurnId` — one from a server that predates ratings — keeps its rating on the device.
   *
   * @param rating The verdict, or `undefined` to take it back.
   * @param reasons Why the answer did not help, most important first. Kept only with `not_helpful`.
   */
  rate(turnId: string, rating: TalqynAnswerRating | undefined, reasons: readonly TalqynFeedbackReason[] = []): void {
    const turn = this.assistantTurn(turnId);
    if (!turn) return;
    const unique = rating === TalqynAnswerRating.notHelpful ? [...new Set(reasons)] : [];
    if (sameFeedback({ rating: turn.rating, reasons: turn.feedbackReasons }, { rating, reasons: unique })) return;
    this.replaceAssistant(turnId, (current) => ({ ...current, rating, feedbackReasons: unique }));
    this.store.update((state) => (state.feedbackFailure === undefined ? state : { ...state, feedbackFailure: undefined }));
    if (!TalqynAssistantTurn.isRatedRemotely(turn) || this.feedbackTasks.has(turnId)) return;
    this.feedbackTasks.set(turnId, this.syncFeedback(turnId));
  }

  /** Sends the turn's rating until what Talqyn holds is what the turn shows, or until Talqyn refuses. */
  private async syncFeedback(turnId: string): Promise<void> {
    try {
      // Taps of one moment settle before anything is sent: the sync starts after the tap that started it.
      await Promise.resolve();
      const consultant = this.talqyn.consultant;
      for (;;) {
        const turn = this.assistantTurn(turnId);
        if (!turn || turn.talqynTurnId === undefined || turn.sessionId === undefined) return;
        const wanted: FeedbackState = { rating: turn.rating, reasons: turn.feedbackReasons };
        const confirmed = this.confirmedFeedback.get(turnId) ?? unrated;
        if (sameFeedback(wanted, confirmed)) return;
        try {
          if (wanted.rating !== undefined) {
            await consultant.submitFeedback({
              turnId: turn.talqynTurnId,
              sessionId: turn.sessionId,
              verdict: TalqynAnswerRating.verdict(wanted.rating),
              reasons: wanted.reasons,
            });
          } else {
            try {
              await consultant.withdrawFeedback(turn.talqynTurnId);
            } catch (error) {
              // No rating on Talqyn's side is what taking it back asked for — a repeat of a withdrawal
              // that did go through answers exactly this.
              if (!(TalqynError.is(error) && error.kind === 'notFound')) throw error;
            }
          }
          this.confirmedFeedback.set(turnId, wanted);
        } catch (error) {
          const failure = TalqynError.wrap(error);
          // A turn dropped meanwhile — a reset, a retry — has nothing left to put back.
          if (!this.assistantTurn(turnId)) return;
          this.replaceAssistant(turnId, (current) => ({
            ...current,
            rating: confirmed.rating,
            feedbackReasons: confirmed.reasons,
          }));
          if (!failure.isCancellation) this.store.update((state) => ({ ...state, feedbackFailure: failure }));
          return;
        }
      }
    } finally {
      this.feedbackTasks.delete(turnId);
    }
  }

  // MARK: Events

  /**
   * Reports a tap on a product card of a turn, so the click has a denominator. Fire and forget.
   *
   * @param product The card tapped.
   * @param turn The turn it was shown in.
   */
  trackProductTap(product: TalqynProduct, turn: TalqynAssistantTurn): void {
    const position = turn.products.findIndex((candidate) => candidate.talqynId === product.talqynId);
    this.talqyn.events.track({
      searchId: turn.searchId,
      talqynId: product.talqynId,
      position: Math.max(position, 0),
      source: 'cip',
    });
  }

  // MARK: History

  /**
   * Loads a conversation from history in place of the current one.
   *
   * Ignored while an answer is streaming. A failure lands in `restoreFailure` — `notFound` when the chat
   * was deleted meanwhile.
   */
  restore(sessionId: string): void {
    if (this.state.isStreaming) return;
    this.restoreController?.abort();
    const controller = new AbortController();
    this.restoreController = controller;
    this.store.update((state) => ({ ...state, restoreFailure: undefined, isRestoring: true }));

    this.talqyn.consultant.chat(sessionId, { signal: controller.signal }).then(
      (transcript) => {
        if (controller.signal.aborted) return;
        this.restoreController = undefined;
        this.applyTranscript(transcript);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        this.restoreController = undefined;
        this.store.update((state) => ({ ...state, isRestoring: false, restoreFailure: TalqynError.wrap(error) }));
      },
    );
  }

  /** Clears the transcript if it is the conversation that was just deleted from history. */
  discardIfOpen(sessionId: string): void {
    if (this.state.sessionId === sessionId) this.reset();
  }

  private applyTranscript(transcript: TalqynChatTranscript): void {
    const products = new Map<number, TalqynProduct>();
    for (const product of transcript.products) {
      if (!products.has(product.talqynId)) products.set(product.talqynId, product);
    }
    const turns = TalqynConversation.turns(transcript.messages, products, transcript.sessionId);
    // A rating reopened from history is one Talqyn holds: changing it is an update, taking it back a
    // withdrawal. The reasons are not sent back with a transcript, so a reason picked now is new to Talqyn.
    this.confirmedFeedback.clear();
    for (const turn of turns) {
      if (turn.type === 'assistant' && turn.rating !== undefined) {
        this.confirmedFeedback.set(turn.id, { rating: turn.rating, reasons: [] });
      }
    }
    this.cancelPendingDelta();
    this.store.update((state) => ({
      ...state,
      turns,
      isRestoring: false,
      productsById: products,
      clarifyDrafts: new Map(),
      sessionId: transcript.sessionId,
    }));
  }

  /**
   * Pairs each shopper message with the assistant message that follows it. An assistant message on its
   * own — the first row of a chat that started mid-way — becomes a turn with an empty question.
   */
  static turns(
    messages: readonly TalqynChatMessage[],
    products: ReadonlyMap<number, TalqynProduct>,
    sessionId?: string,
  ): TalqynTurn[] {
    const turns: TalqynTurn[] = [];
    let index = 0;
    while (index < messages.length) {
      const message = messages[index]!;
      index += 1;
      if (message.role !== 'user') {
        turns.push(restoredTurn(undefined, message, products, sessionId));
        continue;
      }
      turns.push(TalqynUserTurn.create(message.text));
      let answer: TalqynChatMessage | undefined;
      if (index < messages.length && messages[index]!.role === 'assistant') {
        answer = messages[index];
        index += 1;
      }
      turns.push(restoredTurn(message, answer, products, sessionId));
    }
    return turns;
  }

  // MARK: Identity

  /**
   * Drops the transcript if the shopper changed since the screen last appeared: their conversation must
   * not continue under someone else's history. Call it when the screen appears.
   *
   * Compares the identity as the site set it, not the shopper id: the id reads as a local UUID before the
   * first token and as the server's form after it, and a screen coming back must not mistake that for a
   * different shopper.
   */
  refreshIdentity(): void {
    const current = this.talqyn.currentIdentity();
    const previous = this.identitySnapshot;
    if (!previous) {
      this.identitySnapshot = current;
      return;
    }
    if (previous.equals(current) || this.state.isStreaming) return;
    this.identitySnapshot = current;
    this.reset();
  }
}

function productIndex(turns: readonly TalqynTurn[]): Map<number, TalqynProduct> {
  const index = new Map<number, TalqynProduct>();
  for (const turn of turns) {
    if (turn.type !== 'assistant') continue;
    for (const product of turn.products) index.set(product.talqynId, product);
  }
  return index;
}

function restoredTurn(
  question: TalqynChatMessage | undefined,
  answer: TalqynChatMessage | undefined,
  products: ReadonlyMap<number, TalqynProduct>,
  sessionId: string | undefined,
): TalqynAssistantTurn {
  const isRedirect = question !== undefined && TalqynChatMessage.isRedirect(question);
  // Each product once, where it was first shown: an id repeated in the row would draw its card twice.
  const seen = new Set<number>();
  const turnProducts = (answer?.talqynIds ?? [])
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .flatMap((id) => {
      const product = products.get(id);
      return product ? [product] : [];
    });
  // Both rows of a turn carry its id and its rating; either will do when the other is missing.
  const talqynTurnId = answer?.turnId ?? question?.turnId;
  const verdict = answer?.feedback ?? question?.feedback;
  return {
    ...TalqynAssistantTurn.create(question?.text ?? ''),
    stage: undefined,
    redirectQuery: isRedirect ? answer?.text : undefined,
    text: isRedirect ? '' : (answer?.text ?? ''),
    products: turnProducts,
    talqynTurnId,
    sessionId: talqynTurnId === undefined ? undefined : sessionId,
    rating: verdict === undefined ? undefined : TalqynAnswerRating.fromVerdict(verdict),
  };
}
