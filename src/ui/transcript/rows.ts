import {
  TalqynAnswerRenderer,
  TalqynAssistantTurn,
  TalqynClarifyDraft,
  TalqynConversationState,
  TalqynFallbackPolicy,
  TalqynUiStrings,
  type TalqynAnswerBlock,
  type TalqynAnswerRating,
  type TalqynPriceFormatter,
} from '../../consultant-core/index.js';
import type {
  TalqynActionFilters,
  TalqynClarify,
  TalqynComparisonTable,
  TalqynConsultantAction,
  TalqynConsultantStage,
  TalqynFeedbackReason,
  TalqynProduct,
} from '../../sdk/index.js';

/** What a row of the transcript shows. */
export type TalqynTranscriptRow =
  | { readonly type: 'user'; readonly id: string; readonly text: string }
  | { readonly type: 'assistant'; readonly row: TalqynTurnRow }
  | { readonly type: 'suggestions'; readonly questions: readonly string[] };

/** How the transcript should scroll after a reload. */
export type TalqynTranscriptAnchor =
  /** Keep the current position, and the pinned question, if any. */
  | 'keep'
  /** Pin the newest question to the top. */
  | 'newestTurn'
  /** Go to the end. */
  | 'bottom';

/** A titled carousel of products. */
export interface TalqynProductSection {
  readonly title: string;
  readonly products: readonly TalqynProduct[];
}

/** A proposed action with its one-line summary already written. */
export type TalqynTurnAction =
  | { readonly type: 'filters'; readonly filters: TalqynActionFilters; readonly summary: string }
  | { readonly type: 'comparison'; readonly table: TalqynComparisonTable; readonly summary: string };

/** A turn's clarifying question as the transcript shows it. */
export type TalqynTurnClarify =
  | {
      readonly type: 'pending';
      readonly clarify: TalqynClarify;
      readonly draft: TalqynClarifyDraft;
      readonly isInteractive: boolean;
    }
  | { readonly type: 'answered'; readonly answer: string };

/** The controls under a settled turn: its rating, the reasons a thumb down offers, and the text to copy. */
export interface TalqynTurnToolbar {
  readonly rating: TalqynAnswerRating | undefined;
  readonly offeredReasons: readonly TalqynFeedbackReason[];
  readonly selectedReasons: readonly TalqynFeedbackReason[];
  /** `undefined` when the turn has no text worth copying — a fallback. */
  readonly copyText: string | undefined;
}

/** A notice under a turn: stopped, failed, or degraded. */
export interface TalqynTurnNotice {
  readonly tone: 'warning' | 'error' | 'neutral';
  readonly text: string;
  readonly showsRetry: boolean;
}

/** Everything one assistant turn shows. */
export interface TalqynTurnRow {
  readonly turnId: string;
  readonly question: string;
  readonly stage: TalqynConsultantStage | undefined;
  readonly isStreaming: boolean;
  readonly blocks: readonly TalqynAnswerBlock[];
  /** The products a name in the text can open, by Talqyn id. */
  readonly catalog: ReadonlyMap<number, TalqynProduct>;
  readonly productSections: readonly TalqynProductSection[];
  readonly actions: readonly TalqynTurnAction[];
  readonly clarify: TalqynTurnClarify | undefined;
  readonly redirectQuery: string | undefined;
  readonly notice: TalqynTurnNotice | undefined;
  readonly toolbar: TalqynTurnToolbar | undefined;
}

/** What a thumb down offers under an answer: the parts of an answer that can be wrong. */
const answerReasons: readonly TalqynFeedbackReason[] = ['not_relevant', 'wrong_info', 'price_stock', 'other'];

/** What it offers under a turn that gave up: the missing answer comes first, and the products that did come can still miss. */
const fallbackReasons: readonly TalqynFeedbackReason[] = ['no_answer', 'not_relevant', 'other'];

interface CacheEntry {
  readonly text: string;
  readonly productsCount: number;
  readonly catalogSize: number;
  readonly blocks: readonly TalqynAnswerBlock[];
  readonly copyText: string;
}

/**
 * Turns the conversation into rows, with the rendered answer cached per turn: the pass over a long
 * answer is not free, and a streaming turn re-renders many times a second.
 */
export class TalqynTranscriptRowBuilder {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly strings: TalqynUiStrings,
    private readonly price: TalqynPriceFormatter,
  ) {}

  forget(turnIds: Iterable<string>): void {
    for (const id of turnIds) this.cache.delete(id);
  }

  forgetAll(): void {
    this.cache.clear();
  }

  /** @param dismissedClarifyTurns Turns whose clarify sheet the shopper dismissed, so the card shows inline instead. */
  rows(state: TalqynConversationState, dismissedClarifyTurns: ReadonlySet<string>): TalqynTranscriptRow[] {
    const rows: TalqynTranscriptRow[] = state.turns.map((turn) =>
      turn.type === 'user'
        ? { type: 'user', id: turn.id, text: turn.text }
        : { type: 'assistant', row: this.turnRow(turn, state, dismissedClarifyTurns) },
    );
    const questions = TalqynConversationState.suggestedQuestions(state, this.strings.exampleQuestions);
    if (questions.length > 0) rows.push({ type: 'suggestions', questions });
    return rows;
  }

  turnRow(
    turn: TalqynAssistantTurn,
    state: TalqynConversationState,
    dismissedClarifyTurns: ReadonlySet<string>,
  ): TalqynTurnRow {
    const isLast = TalqynConversationState.isLast(state, turn);
    const isActive = isLast && state.isStreaming;
    // Cards cited by the text render as the text streams — a card takes its place the moment its marker
    // is complete, the way the words do. Only the carousel of the remaining products waits for the end:
    // its contents depend on which products the text ends up citing.
    const rendered = this.renderedBlocks(turn, state.productsById);
    const citedIds = new Set(
      rendered.blocks.flatMap((block) => (block.type === 'products' ? block.items.map((item) => item.talqynId) : [])),
    );

    return {
      turnId: turn.id,
      question: turn.question,
      stage: isActive ? turn.stage : undefined,
      isStreaming: isActive,
      blocks: rendered.blocks,
      catalog: state.productsById,
      productSections: isActive ? [] : this.productSections(turn, citedIds),
      actions: turn.actions.flatMap((action) => this.action(action, state.productsById)),
      clarify: this.clarifyRow(turn, state, isLast, dismissedClarifyTurns),
      redirectQuery: turn.redirectQuery,
      notice: this.notice(turn, isLast),
      toolbar: isActive ? undefined : this.toolbar(turn, rendered.copyText),
    };
  }

  /**
   * Rating waits for the turn to settle: a half-written answer is neither judged nor copied. An answer is
   * rated and copied; a turn that gave up is rated only — "no answer" is exactly what a shopper may want
   * to say about it.
   */
  private toolbar(turn: TalqynAssistantTurn, copyText: string): TalqynTurnToolbar | undefined {
    if (!TalqynAssistantTurn.isAnswer(turn)) return undefined;
    const isFallback = turn.fallbackReason !== undefined;
    if (!isFallback && copyText.length === 0) return undefined;
    return {
      rating: turn.rating,
      offeredReasons: isFallback ? fallbackReasons : answerReasons,
      selectedReasons: turn.feedbackReasons,
      copyText: copyText.length === 0 ? undefined : copyText,
    };
  }

  private renderedBlocks(
    turn: TalqynAssistantTurn,
    catalog: ReadonlyMap<number, TalqynProduct>,
  ): { blocks: readonly TalqynAnswerBlock[]; copyText: string } {
    const entry = this.cache.get(turn.id);
    if (
      entry &&
      entry.text === turn.text &&
      entry.productsCount === turn.products.length &&
      entry.catalogSize === catalog.size
    ) {
      return entry;
    }
    const blocks = TalqynAnswerRenderer.blocks(turn.text, catalog);
    const copyText = TalqynAnswerRenderer.plainTextOf(blocks);
    this.cache.set(turn.id, {
      text: turn.text,
      productsCount: turn.products.length,
      catalogSize: catalog.size,
      blocks,
      copyText,
    });
    return { blocks, copyText };
  }

  private productSections(turn: TalqynAssistantTurn, citedIds: ReadonlySet<number>): TalqynProductSection[] {
    // On a turn the consultant gave up on, these products are not an afterthought under an answer — they
    // are the answer.
    const header = turn.fallbackReason === undefined ? this.strings.productsHeader : this.strings.fallbackProductsHeader;
    if (turn.groups && turn.groups.length > 0) {
      return turn.groups.flatMap((group) => {
        // One card per product in a section: a group may list a product twice. The first occurrence stays.
        const seen = new Set(citedIds);
        const items = group.items.filter((item) => {
          if (seen.has(item.talqynId)) return false;
          seen.add(item.talqynId);
          return true;
        });
        if (items.length === 0) return [];
        const label = group.role.charAt(0).toUpperCase() + group.role.slice(1);
        return [{ title: `${label} · ${items.length}`, products: items }];
      });
    }
    const items = turn.products.filter((product) => !citedIds.has(product.talqynId));
    return items.length === 0 ? [] : [{ title: header, products: items }];
  }

  private action(action: TalqynConsultantAction, catalog: ReadonlyMap<number, TalqynProduct>): TalqynTurnAction[] {
    switch (action.type) {
      case 'applyFilters':
        return [{ type: 'filters', filters: action.filters, summary: actionFiltersSummary(action.filters, this.strings, this.price) }];
      case 'showComparison':
        if (!isRenderableComparison(action.table)) return [];
        return [{ type: 'comparison', table: action.table, summary: this.comparisonSummary(action.table, catalog) }];
      default:
        return [];
    }
  }

  /**
   * What is being compared, in a line: the brands when they tell the products apart, otherwise how many.
   * The full titles are on the cards right above the chip.
   */
  private comparisonSummary(table: TalqynComparisonTable, catalog: ReadonlyMap<number, TalqynProduct>): string {
    const brands = table.talqynIds.map((id) => catalog.get(id)?.brandName?.trim() ?? '');
    if (brands.every((brand) => brand.length > 0) && new Set(brands).size === brands.length) {
      return brands.join(' · ');
    }
    return TalqynUiStrings.productsCount(this.strings, table.talqynIds.length);
  }

  private clarifyRow(
    turn: TalqynAssistantTurn,
    state: TalqynConversationState,
    isLast: boolean,
    dismissed: ReadonlySet<string>,
  ): TalqynTurnClarify | undefined {
    if (!turn.clarify) return undefined;
    if (turn.clarifyAnswer !== undefined) return { type: 'answered', answer: turn.clarifyAnswer };
    // While the turn that asks is still streaming there is nothing to answer yet: the question comes up —
    // as a sheet or as a card — once the turn is done, not as a greyed-out card first.
    if (isLast && state.isStreaming) return undefined;
    const isInteractive = isLast;
    // The latest question is asked in a sheet first; the inline card takes over once the sheet was
    // dismissed, or when the turn is no longer the latest.
    if (isInteractive && !dismissed.has(turn.id)) return undefined;
    return {
      type: 'pending',
      clarify: turn.clarify,
      draft: state.clarifyDrafts.get(turn.id) ?? TalqynClarifyDraft.empty,
      isInteractive,
    };
  }

  private notice(turn: TalqynAssistantTurn, isLast: boolean): TalqynTurnNotice | undefined {
    if (turn.wasStopped) return { tone: 'neutral', text: this.strings.aborted, showsRetry: isLast };
    if (turn.errorCode !== undefined) {
      return { tone: 'error', text: TalqynUiStrings.errorText(this.strings, turn.errorCode), showsRetry: isLast };
    }
    if (turn.failure !== undefined) return { tone: 'error', text: this.strings.errorGeneric, showsRetry: isLast };
    if (turn.fallbackReason !== undefined) {
      // The line points at the products only when the turn found some: a fallback with nothing to show must
      // not promise a carousel.
      const cause = TalqynUiStrings.fallbackText(this.strings, turn.fallbackReason);
      const hasProducts = turn.products.length > 0 || (turn.groups?.length ?? 0) > 0;
      return {
        tone: 'warning',
        text: hasProducts ? TalqynUiStrings.filled(this.strings.fallbackWithProducts, cause) : cause,
        showsRetry: isLast && TalqynFallbackPolicy.invitesRetry(turn.fallbackReason),
      };
    }
    return undefined;
  }
}

/** A table needs two columns and a row to be worth a screen. */
export function isRenderableComparison(table: TalqynComparisonTable): boolean {
  return table.talqynIds.length >= 2 && table.rows.length > 0;
}

/**
 * The filters in a line, in the screen's copy: the price bound, "with a discount", the values —
 * `from 100 000 ₸ · on sale · Apple`. The bounds are filled by replacement: the copy is the site's to
 * change, and a bare `%` in it must stay a percent sign.
 */
export function actionFiltersSummary(
  filters: TalqynActionFilters,
  strings: TalqynUiStrings,
  price: TalqynPriceFormatter,
): string {
  const parts: string[] = [];
  if (filters.priceMin !== undefined && filters.priceMax !== undefined) {
    parts.push(`${price.format(filters.priceMin)} – ${price.format(filters.priceMax)}`);
  } else if (filters.priceMax !== undefined) {
    parts.push(TalqynUiStrings.filled(strings.filterUpTo, price.format(filters.priceMax)));
  } else if (filters.priceMin !== undefined) {
    parts.push(TalqynUiStrings.filled(strings.filterFrom, price.format(filters.priceMin)));
  }
  if (filters.hasDiscount) parts.push(strings.filterDiscount);
  // The structured form first; the flat legacy form for turns that carry only it.
  const values =
    Object.keys(filters.filters).length === 0 ? Object.values(filters.attributes) : Object.values(filters.filters).flat();
  parts.push(...[...values].sort());
  return parts.join(' · ');
}
