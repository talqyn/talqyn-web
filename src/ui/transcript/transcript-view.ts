import { h, isEditingTarget, reorderChildren } from '../support/dom.js';
import { prefersReducedMotion } from '../support/platform.js';
import type { TalqynTranscriptAnchor, TalqynTranscriptRow, TalqynTurnRow } from './rows.js';

/** The keys that scroll a focused scroller. */
const scrollKeys: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** What the transcript asks the screen to build for a row. */
export interface TalqynRowViews {
  user(): { readonly element: HTMLElement; update(text: string): void };
  assistant(): { readonly element: HTMLElement; update(row: TalqynTurnRow): void; dispose(): void };
  suggestions(): { readonly element: HTMLElement; update(questions: readonly string[]): void };
}

type RowView =
  | { readonly kind: 'user'; readonly view: ReturnType<TalqynRowViews['user']> }
  | { readonly kind: 'assistant'; readonly view: ReturnType<TalqynRowViews['assistant']> };

/** How far from the end still counts as "at the end". */
const BOTTOM_PROXIMITY = 32;

/** The gap between the top of the viewport and a pinned question. */
const ANCHOR_TOP_GAP = 8;

/**
 * The scrolling conversation.
 *
 * A new question is pinned to the top of the viewport and stays there while the answer grows underneath —
 * the shopper reads from the start of the answer, not from its end. Room is reserved below the last row
 * so the pin holds even while the answer is short. The pin lets go the moment the shopper scrolls — a
 * wheel, a touch, a key — and the room shrinks to what the current position still needs, never less, so
 * nothing moves under the pointer.
 *
 * The scroller spans the screen, so it scrolls from anywhere; its content is one column, no wider than the
 * theme's `maxContentWidth` and centered in it. Scroll anchoring is off: the pin decides where the content
 * sits, and the browser's own anchoring would fight it.
 */
export class TalqynTranscriptView {
  readonly element: HTMLDivElement;
  private readonly column: HTMLDivElement;
  private readonly rowsContainer = h('div', 'tq-rows');
  private readonly reserve = h('div', 'tq-reserve');
  private readonly views = new Map<string, RowView>();
  private suggestions: ReturnType<TalqynRowViews['suggestions']> | undefined;
  private turnRows: TalqynTranscriptRow[] = [];
  private anchoredId: string | undefined;
  private reserveHeight = 0;
  private bottomReserveValue = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private isUserScrolling = false;
  private readonly resizeObserver: ResizeObserver | undefined;

  /** Whether the end of the transcript is in view. */
  isPinnedToBottom = true;
  onPinnedToBottomChange: ((pinned: boolean) => void) | undefined;

  constructor(private readonly factory: TalqynRowViews) {
    this.column = h('div', 'tq-column', [this.rowsContainer, this.reserve]);
    // Not a live region: a screen reader reading every chunk of a streaming answer aloud is noise. The
    // screen announces the answer once it is ready.
    this.element = h('div', 'tq-transcript', [this.column]);
    this.element.addEventListener('scroll', this.onScroll, { passive: true });
    // A wheel, or a finger that moves, is the shopper scrolling; a tap on a chip is not.
    for (const type of ['wheel', 'touchmove'] as const) {
      this.element.addEventListener(type, this.onUserScroll, { passive: true });
    }
    this.element.addEventListener('keydown', (event) => {
      if (!scrollKeys.has(event.key) || isEditingTarget(event.target)) return;
      // Space on a button presses the button.
      if (event.key === ' ' && event.target instanceof Element && event.target.closest('button, [role="button"], a[href]')) return;
      this.onUserScroll();
    });
    // A drag of the scrollbar: a press on the scroller itself rather than on its content.
    this.element.addEventListener('pointerdown', (event) => {
      if (event.target === this.element) this.onUserScroll();
    });
    this.element.addEventListener('scrollend', () => this.onScrollEnd());
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.relayout());
      this.resizeObserver.observe(this.element);
      this.resizeObserver.observe(this.rowsContainer);
    }
  }

  /**
   * How much of the transcript's bottom is covered by the composer floating over it. The transcript runs
   * the full height of the screen — content passes under the glass — so the last row needs this much room
   * below it to be readable, and the pin's reserve never falls under it.
   */
  set bottomReserve(value: number) {
    if (Math.abs(value - this.bottomReserveValue) < 0.5) return;
    this.bottomReserveValue = value;
    this.setReserve(Math.max(this.reserveHeight, value));
    this.applyAnchor();
    this.trimReserveIfPossible();
    this.refreshPinnedState();
  }

  get bottomReserve(): number {
    return this.bottomReserveValue;
  }

  reload(rows: readonly TalqynTranscriptRow[], anchor: TalqynTranscriptAnchor): void {
    const keep = new Set<string>();
    const elements: HTMLElement[] = [];
    const turnRows: TalqynTranscriptRow[] = [];
    let suggestions: readonly string[] | undefined;

    for (const row of rows) {
      if (row.type === 'suggestions') {
        suggestions = row.questions;
        continue;
      }
      turnRows.push(row);
      const id = row.type === 'user' ? row.id : row.row.turnId;
      keep.add(id);
      let entry = this.views.get(id);
      if (!entry || entry.kind !== row.type) {
        if (entry?.kind === 'assistant') entry.view.dispose();
        entry = row.type === 'user' ? { kind: 'user', view: this.factory.user() } : { kind: 'assistant', view: this.factory.assistant() };
        entry.view.element.dataset['rowId'] = id;
        this.views.set(id, entry);
      }
      if (row.type === 'user' && entry.kind === 'user') entry.view.update(row.text);
      else if (row.type === 'assistant' && entry.kind === 'assistant') entry.view.update(row.row);
      elements.push(entry.view.element);
    }
    for (const [id, entry] of [...this.views]) {
      if (keep.has(id)) continue;
      if (entry.kind === 'assistant') entry.view.dispose();
      this.views.delete(id);
    }
    if (suggestions) {
      this.suggestions ??= this.factory.suggestions();
      this.suggestions.update(suggestions);
      elements.push(this.suggestions.element);
    }
    reorderChildren(this.rowsContainer, elements);
    this.turnRows = turnRows;

    if (turnRows.length === 0) {
      this.anchoredId = undefined;
      this.setReserve(this.bottomReserveValue);
    } else if (anchor === 'newestTurn') {
      this.anchorNewestTurn();
    } else if (anchor === 'bottom') {
      this.anchoredId = undefined;
      this.setReserve(this.bottomReserveValue);
      this.scrollToBottom(false);
    } else {
      this.applyAnchor();
      this.trimReserveIfPossible();
    }
    this.refreshPinnedState();
  }

  /** Updates one turn in place — the streaming one, many times a second. */
  updateRow(row: TalqynTurnRow): void {
    const entry = this.views.get(row.turnId);
    if (entry?.kind !== 'assistant') return;
    entry.view.update(row);
    this.applyAnchor();
    this.trimReserveIfPossible();
    this.refreshPinnedState();
  }

  scrollToBottom(animated: boolean): void {
    this.anchoredId = undefined;
    const target = this.contentBottomOffset();
    if (Math.abs(this.element.scrollTop - target) <= 0.5) return;
    this.element.scrollTo({ top: target, behavior: animated && !prefersReducedMotion() ? 'smooth' : 'auto' });
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    clearTimeout(this.settleTimer);
    for (const entry of this.views.values()) {
      if (entry.kind === 'assistant') entry.view.dispose();
    }
    this.views.clear();
  }

  private anchorNewestTurn(): void {
    let index = this.turnRows.length - 1;
    if (index < 0) return;
    if (index > 0 && this.turnRows[index - 1]?.type === 'user') index -= 1;
    const row = this.turnRows[index]!;
    this.anchoredId = row.type === 'user' ? row.id : row.type === 'assistant' ? row.row.turnId : undefined;
    this.applyAnchor();
  }

  private applyAnchor(): void {
    if (this.anchoredId === undefined) return;
    const entry = this.views.get(this.anchoredId);
    if (!entry) {
      this.anchoredId = undefined;
      return;
    }
    const anchorTop = entry.view.element.offsetTop;
    const tail = this.reserve.offsetTop - anchorTop + ANCHOR_TOP_GAP;
    this.setReserve(Math.max(this.bottomReserveValue, this.element.clientHeight - tail));
    const target = Math.max(0, Math.min(anchorTop - ANCHOR_TOP_GAP, this.maxScrollTop()));
    if (Math.abs(this.element.scrollTop - target) > 0.5) this.element.scrollTop = target;
  }

  /**
   * The reserve exists for the pin. Once the pin is gone it must not outlive it as empty space under the
   * transcript: it shrinks to what the current position still needs — never less, so nothing moves under
   * the shopper — and reaches the composer's own reserve as they scroll back up.
   */
  private trimReserveIfPossible(): void {
    if (this.anchoredId !== undefined || this.reserveHeight <= this.bottomReserveValue) return;
    const needed = Math.max(
      this.bottomReserveValue,
      this.element.scrollTop - this.contentBottomOffset() + this.bottomReserveValue,
    );
    if (this.reserveHeight > needed) this.setReserve(needed);
  }

  /**
   * Once the pin is gone and the shopper has come to rest inside the reserve, it is just a hole over the
   * composer: the transcript settles onto its last row instead. Only at rest — the space must not move under
   * a finger.
   */
  private settleAtBottomIfNeeded(): void {
    if (this.anchoredId !== undefined || this.reserveHeight <= this.bottomReserveValue) return;
    const bottom = this.contentBottomOffset();
    if (this.element.scrollTop <= bottom - BOTTOM_PROXIMITY) return;
    if (this.element.scrollTop <= bottom + 0.5 || prefersReducedMotion()) {
      this.setReserve(this.bottomReserveValue);
      return;
    }
    this.element.scrollTo({ top: bottom, behavior: 'smooth' });
  }

  private refreshPinnedState(): void {
    const pinned = this.contentBottomOffset() - this.element.scrollTop <= BOTTOM_PROXIMITY;
    if (pinned === this.isPinnedToBottom) return;
    this.isPinnedToBottom = pinned;
    this.onPinnedToBottomChange?.(pinned);
  }

  /** The scroll position at which the last row sits right above the composer. */
  private contentBottomOffset(): number {
    return Math.max(0, this.reserve.offsetTop + this.bottomReserveValue - this.element.clientHeight);
  }

  private maxScrollTop(): number {
    return Math.max(0, this.element.scrollHeight - this.element.clientHeight);
  }

  private setReserve(height: number): void {
    const value = Math.max(0, height);
    if (Math.abs(value - this.reserveHeight) < 0.5) return;
    this.reserveHeight = value;
    this.reserve.style.height = `${value}px`;
  }

  private relayout(): void {
    this.applyAnchor();
    this.trimReserveIfPossible();
    this.refreshPinnedState();
  }

  private readonly onUserScroll = (): void => {
    this.isUserScrolling = true;
    this.anchoredId = undefined;
    if (this.element.scrollTop <= this.contentBottomOffset()) this.setReserve(this.bottomReserveValue);
  };

  private readonly onScroll = (): void => {
    this.trimReserveIfPossible();
    this.refreshPinnedState();
    // Where `scrollend` is missing, a pause in scroll events stands for it.
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.onScrollEnd(), 160);
  };

  private onScrollEnd(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    if (this.isUserScrolling) {
      this.isUserScrolling = false;
      this.settleAtBottomIfNeeded();
    } else if (this.anchoredId === undefined && this.reserveHeight > this.bottomReserveValue) {
      const bottom = this.contentBottomOffset();
      if (Math.abs(this.element.scrollTop - bottom) <= 1) this.setReserve(this.bottomReserveValue);
    }
    this.trimReserveIfPossible();
    this.refreshPinnedState();
  }
}
