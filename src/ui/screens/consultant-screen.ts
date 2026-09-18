import {
  TalqynClarifyDraft,
  type TalqynAssistantTurn,
  type TalqynConversation,
  type TalqynConversationState,
  type TalqynPriceFormatter,
  type TalqynUiStrings,
} from '../../consultant-core/index.js';
import { TalqynActionFilters, type TalqynClarify, type TalqynComparisonTable } from '../../sdk/index.js';
import { TalqynComposerView } from '../components/composer.js';
import { chip } from '../components/controls.js';
import { emptyStateView } from '../components/empty-state.js';
import { TalqynHeaderView } from '../components/header.js';
import { presentDialog, presentMenu, type TalqynMenuItem, type TalqynPresentation } from '../components/overlay.js';
import { sweepSiteCards, type TalqynCardContext } from '../components/product-card.js';
import { TalqynTurnView, type TalqynTurnActions } from '../components/turn-view.js';
import { TalqynUserBubbleView, type TalqynClientPoint } from '../components/user-bubble.js';
import type { TalqynConsultantCallbacks } from '../consultant-options.js';
import { TalqynAdaptiveLayout, type TalqynLayoutMode } from '../layout.js';
import { button, h, iconSlot } from '../support/dom.js';
import type { TalqynScreenHost } from '../support/host.js';
import type { TalqynImageLoader } from '../support/image-loader.js';
import { copyText, prefersReducedMotion } from '../support/platform.js';
import type { TalqynTheme } from '../theme.js';
import { TalqynClarifyPresentation } from '../transcript/clarify-presentation.js';
import { TalqynTranscriptRowBuilder, type TalqynTranscriptAnchor, type TalqynTranscriptRow } from '../transcript/rows.js';
import { TalqynTranscriptView } from '../transcript/transcript-view.js';
import { TalqynChatHistoryScreen } from './chat-history-screen.js';
import { TalqynClarifySheet } from './clarify-sheet.js';
import { TalqynComparisonScreen } from './comparison-screen.js';

/** What {@link TalqynConsultantScreen} is built from. */
export interface TalqynConsultantScreenConfig {
  readonly conversation: TalqynConversation;
  readonly theme: TalqynTheme;
  readonly strings: TalqynUiStrings;
  readonly priceFormatter: TalqynPriceFormatter;
  readonly imageLoader: TalqynImageLoader;
  readonly showsHeader: boolean;
  readonly showsPoweredBy: boolean;
  /** How the screen adapts to the box the site gave it. */
  readonly layout: TalqynAdaptiveLayout;
  /** The site's callbacks as of now: they can be swapped after the screen is built. */
  readonly callbacks: () => TalqynConsultantCallbacks;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * The consultant screen, drawn into a screen host: the bar, the empty screen or the transcript, the
 * composer on glass, and the sheets, dialogs, and screens it presents over itself.
 *
 * It renders the conversation: every change of the state is one pass that works out what changed — the
 * turns themselves, a streaming answer, a settled one — and touches only that. It asks a turn's clarifying
 * question once the answer has settled, reports product clicks, and hands the site what only the site can
 * do.
 */
export class TalqynConsultantScreen {
  private readonly conversation: TalqynConversation;
  private readonly theme: TalqynTheme;
  private readonly strings: TalqynUiStrings;
  private readonly rowBuilder: TalqynTranscriptRowBuilder;
  private readonly clarifyPresentation = new TalqynClarifyPresentation();
  private readonly header: TalqynHeaderView;
  private readonly stage: HTMLDivElement;
  private readonly emptyState: HTMLDivElement;
  private readonly transcript: TalqynTranscriptView;
  private readonly restoreOverlay: HTMLDivElement;
  private readonly dock: HTMLDivElement;
  private readonly composer: TalqynComposerView;
  private readonly scrollButton: HTMLButtonElement;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver | undefined;
  /** Closes what the screen presented and must be disposed of: comparisons, history. */
  private readonly closers = new Set<() => void>();
  private clarifySheet: TalqynPresentation | undefined;
  /** A clarifying question settled while the screen was out of sight; it is asked when the screen shows. */
  private isClarifyWaitingForAppearance = false;
  private renderedTurnIds: readonly string[] = [];
  private renderedAssistantTurns = new Map<string, TalqynAssistantTurn>();
  private renderedDrafts: TalqynConversationState['clarifyDrafts'] | undefined;
  private renderedCatalogCount = 0;
  private wasStreaming = false;
  private wasRestoring = false;
  private hasRendered = false;
  private hostWidth = -1;
  private layoutMode: TalqynLayoutMode | undefined;
  private isDisposed = false;

  constructor(
    private readonly host: TalqynScreenHost,
    private readonly config: TalqynConsultantScreenConfig,
  ) {
    const { conversation, theme, strings } = config;
    this.conversation = conversation;
    this.theme = theme;
    this.strings = strings;
    this.rowBuilder = new TalqynTranscriptRowBuilder(strings, config.priceFormatter);

    const cards: TalqynCardContext = {
      theme,
      strings,
      price: config.priceFormatter,
      imageLoader: config.imageLoader,
      slotHost: host.host,
      renderer: () => this.config.callbacks().renderProductCard,
    };
    const turnActions = this.turnActions();

    this.header = new TalqynHeaderView(theme, strings, {
      onNewChat: () => this.confirmReset(),
      onHistory: () => this.openHistory(),
      onLeave: () => this.leave(),
    });
    this.header.element.hidden = !config.showsHeader;

    this.emptyState = emptyStateView(theme, strings, config.showsPoweredBy, (question) => this.conversation.send(question));

    this.transcript = new TalqynTranscriptView({
      user: () =>
        new TalqynUserBubbleView(theme, strings, {
          onCopy: (text) => void copyText(text, this.host.root),
          onEdit: (text) => this.editQuestion(text),
          onMenu: (point, items) => this.showQuestionMenu(point, items),
        }),
      assistant: () => new TalqynTurnView(cards, turnActions),
      suggestions: () => this.suggestionsView(),
    });
    this.transcript.element.hidden = true;
    this.transcript.onPinnedToBottomChange = () => this.updateScrollToBottomVisibility();

    const spinner = h('span', 'tq-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    this.restoreOverlay = h('div', 'tq-restore', [spinner]);
    this.restoreOverlay.hidden = true;

    this.composer = new TalqynComposerView(theme, strings);
    this.composer.onSend = () => this.conversation.send(this.composer.text);
    this.composer.onStop = () => this.conversation.stop();
    this.composer.onTextChange = (text) => this.conversation.setDraft(text);

    this.scrollButton = button('tq-scroll-bottom', [iconSlot(theme.icons.scrollToBottom)], strings.scrollToBottom);
    this.scrollButton.title = strings.scrollToBottom;
    this.scrollButton.addEventListener('click', () => this.transcript.scrollToBottom(true));

    this.dock = h('div', 'tq-dock', [h('div', 'tq-dock-inner', [this.scrollButton, this.composer.element])]);
    this.stage = h('div', 'tq-stage', [
      this.transcript.element,
      this.emptyState,
      this.restoreOverlay,
      h('div', 'tq-glass'),
      this.dock,
    ]);

    host.root.classList.add('tq-consultant');
    host.root.lang = strings.locale;
    host.layer.lang = strings.locale;
    host.root.append(this.header.element, this.stage);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => this.onResize(entries));
      this.resizeObserver.observe(this.dock);
      this.resizeObserver.observe(host.host);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.host.root.addEventListener('keydown', this.onRootKeyDown);

    this.applyNavigation();
    this.applyLayout();
    this.unsubscribe = conversation.subscribe(() => this.render());
    this.render();
  }

  /** The screen came onto the page, or back into view. */
  appeared(): void {
    if (this.isDisposed) return;
    this.applyNavigation();
    this.applyLayout();
    this.conversation.refreshIdentity();
    this.updateComposerReserve();
    this.onPossiblyAppeared();
  }

  /** The site swapped its callbacks. */
  callbacksChanged(): void {
    if (!this.isDisposed) this.applyNavigation();
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribe();
    this.host.root.removeEventListener('keydown', this.onRootKeyDown);
    this.resizeObserver?.disconnect();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
    for (const close of [...this.closers]) close();
    this.clarifySheet = undefined;
    this.host.overlay.dismissAll();
    this.transcript.dispose();
    sweepSiteCards(this.host.host, true);
  }

  // MARK: Rendering

  private render(): void {
    if (this.isDisposed) return;
    const state = this.conversation.state;
    const turnIds = state.turns.map((turn) => turn.id);
    const structural = !sameIds(turnIds, this.renderedTurnIds);
    const streamingEnded = this.wasStreaming && !state.isStreaming;
    const restoreEnded = this.wasRestoring && !state.isRestoring;
    const isEmpty = state.turns.length === 0;

    this.setEmptyStateVisible(isEmpty);
    this.header.setActionsEnabled(!state.isStreaming && !state.isRestoring);
    this.composer.setStreaming(state.isStreaming);
    if (this.composer.text !== state.draft) this.composer.setText(state.draft);
    this.restoreOverlay.hidden = !state.isRestoring;

    if (structural) {
      const current = new Set(turnIds);
      const removed = this.renderedTurnIds.filter((id) => !current.has(id));
      this.rowBuilder.forget(removed);
      this.clarifyPresentation.forget(removed);
      const rendered = new Set(this.renderedTurnIds);
      const hasNewQuestion = state.turns.some((turn) => turn.type === 'user' && !rendered.has(turn.id));
      if (hasNewQuestion) this.clarifyPresentation.beginRequest();
      const anchor: TalqynTranscriptAnchor = restoreEnded ? 'bottom' : hasNewQuestion ? 'newestTurn' : 'keep';
      if (restoreEnded || isEmpty) {
        this.rowBuilder.forgetAll();
        this.clarifyPresentation.forgetAll();
      }
      this.transcript.reload(this.rows(state), anchor);
    } else if (streamingEnded) {
      // Suggestions appear under the answer once it is complete.
      this.transcript.reload(this.rows(state), 'keep');
    } else {
      // Whatever turn changed is redrawn — the streaming one many times a second, an older one when its
      // rating lands or is put back. The drafts and the catalog feed the latest turn only.
      const feedsLatest = state.clarifyDrafts !== this.renderedDrafts || state.productsById.size !== this.renderedCatalogCount;
      const latestId = turnIds[turnIds.length - 1];
      for (const turn of state.turns) {
        if (turn.type !== 'assistant') continue;
        if (turn === this.renderedAssistantTurns.get(turn.id) && !(feedsLatest && turn.id === latestId)) continue;
        this.transcript.updateRow(this.rowBuilder.turnRow(turn, state, this.clarifyPresentation.inlineTurns));
      }
    }

    if (streamingEnded) {
      this.presentClarifyIfNeeded(false);
      this.host.announce(this.strings.answerReady);
    }
    const failure = state.restoreFailure;
    if (failure) {
      this.conversation.clearRestoreFailure();
      this.showMessage(failure.kind === 'notFound' ? this.strings.historyGone : this.strings.historyError);
    }

    this.renderedTurnIds = turnIds;
    this.renderedAssistantTurns = new Map();
    for (const turn of state.turns) {
      if (turn.type === 'assistant') this.renderedAssistantTurns.set(turn.id, turn);
    }
    this.renderedDrafts = state.clarifyDrafts;
    this.renderedCatalogCount = state.productsById.size;
    this.wasStreaming = state.isStreaming;
    this.wasRestoring = state.isRestoring;
    this.hasRendered = true;
    this.afterTranscriptChange();
  }

  private rows(state: TalqynConversationState): TalqynTranscriptRow[] {
    return this.rowBuilder.rows(state, this.clarifyPresentation.inlineTurns);
  }

  private afterTranscriptChange(): void {
    this.updateScrollToBottomVisibility();
    sweepSiteCards(this.host.host);
  }

  private setEmptyStateVisible(visible: boolean): void {
    this.header.setNewChatVisible(!visible);
    if (this.emptyState.hidden !== visible) return;
    const appearing = visible ? this.emptyState : this.transcript.element;
    const disappearing = visible ? this.transcript.element : this.emptyState;
    disappearing.hidden = true;
    appearing.hidden = false;
    if (!this.hasRendered || prefersReducedMotion()) return;
    appearing.classList.remove('tq-appear');
    void appearing.offsetWidth;
    appearing.classList.add('tq-appear');
  }

  private updateScrollToBottomVisibility(): void {
    const visible = !this.transcript.element.hidden && !this.transcript.isPinnedToBottom && !this.conversation.state.isRestoring;
    if (visible) this.scrollButton.dataset['visible'] = '';
    else delete this.scrollButton.dataset['visible'];
  }

  /** The prompts under an answer, as chips. */
  private suggestionsView(): { readonly element: HTMLElement; update(questions: readonly string[]): void } {
    const element = h('div', 'tq-chips tq-suggestions');
    let shown: readonly string[] = [];
    return {
      element,
      update: (questions) => {
        if (questions.length === shown.length && questions.every((question, index) => question === shown[index])) return;
        shown = questions;
        element.replaceChildren(
          ...questions.map((question) => chip(this.theme, question, { onTap: () => this.conversation.send(question) })),
        );
      },
    };
  }

  // MARK: Layout

  private onResize(entries: readonly ResizeObserverEntry[]): void {
    for (const entry of entries) {
      if (entry.target === this.dock) {
        this.updateComposerReserve();
        continue;
      }
      const width = entry.contentRect.width;
      if (width !== this.hostWidth) {
        this.hostWidth = width;
        this.applyLayout();
        this.composer.refreshHeight();
      }
      this.onPossiblyAppeared();
    }
  }

  /**
   * Settles which of the two shapes the screen is in and puts it on the host.
   *
   * Only on a change: the attribute is what the stylesheet keys off, and rewriting it on every resize
   * frame would restart the animations of whatever is presented.
   *
   * The element is measured here rather than taken from the `ResizeObserver` entry, so that the shape
   * decided before the first callback and the shape decided after it come from the same box. A site that
   * pads its container would otherwise get a flip on load: a border box over the threshold, a content box
   * under it. An element not laid out yet measures zero and keeps the shape it had.
   */
  private applyLayout(): void {
    const measured = this.host.host.getBoundingClientRect().width;
    const mode = TalqynAdaptiveLayout.resolve(measured > 0 ? measured : undefined, this.config.layout);
    if (mode === this.layoutMode) return;
    this.layoutMode = mode;
    this.host.applyLayout(mode, this.config.layout);
  }

  /** How much of the transcript the composer covers: the transcript runs under it, and the last row must clear it. */
  private updateComposerReserve(): void {
    const height = this.dock.offsetHeight;
    if (height === 0) return;
    this.stage.style.setProperty('--tq-composer-height', `${height}px`);
    this.transcript.bottomReserve = height;
  }

  // MARK: Appearance

  /**
   * Escape stops the answer.
   *
   * A keyboard idiom, so it costs nothing where there is no keyboard. The listener sits on the
   * transcript's own root, not on the layer the sheets and dialogs live in: those are siblings, so
   * Escape with a dialog up closes the dialog and never reaches this.
   */
  private readonly onRootKeyDown = (event: KeyboardEvent): void => {
    if (this.isDisposed || event.key !== 'Escape' || !this.conversation.state.isStreaming) return;
    event.preventDefault();
    this.conversation.stop();
  };

  private readonly onVisibilityChange = (): void => {
    if (this.isDisposed || document.visibilityState !== 'visible') return;
    this.conversation.refreshIdentity();
    this.onPossiblyAppeared();
  };

  private onPossiblyAppeared(): void {
    if (this.isClarifyWaitingForAppearance && !this.conversation.state.isStreaming && this.isOnScreen()) {
      this.presentClarifyIfNeeded(true);
    }
  }

  /** Whether the shopper can see the screen: on the page, in a tab in front, and laid out at a size. */
  private isOnScreen(): boolean {
    const element = this.host.host;
    if (!element.isConnected) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  // MARK: Clarify

  /**
   * Asks the latest turn's clarifying question once its answer has settled.
   *
   * Only a screen the shopper sees can ask: a sheet that comes up in a background tab, or in a panel the
   * site has hidden, is a question nobody sees coming. So the decision waits for the screen to show. A
   * screen on show that has presented something is another matter: the question goes into the transcript
   * as a card, and waits there under what is presented.
   *
   * @param hasAppeared Whether the screen has just come into view.
   */
  private presentClarifyIfNeeded(hasAppeared: boolean): void {
    this.isClarifyWaitingForAppearance = false;
    const state = this.conversation.state;
    const turn = state.turns[state.turns.length - 1];
    if (turn?.type !== 'assistant' || turn.clarify === undefined) return;
    const isPresenting = this.host.overlay.isPresenting;
    if (!(hasAppeared || isPresenting || this.isOnScreen())) {
      this.isClarifyWaitingForAppearance = true;
      return;
    }
    switch (this.clarifyPresentation.decide(turn, !isPresenting)) {
      case 'none':
        return;
      case 'inline':
        this.transcript.reload(this.rows(this.conversation.state), 'keep');
        this.afterTranscriptChange();
        return;
      case 'sheet':
        this.presentClarifySheet(turn.id, turn.clarify);
        return;
    }
  }

  private presentClarifySheet(turnId: string, clarify: TalqynClarify): void {
    let presentation: TalqynPresentation | undefined;
    const dismissedByShopper = (): void => {
      if (!presentation || this.clarifySheet !== presentation) return;
      this.clarifySheet = undefined;
      presentation.dismiss();
      this.clarifyPresentation.sheetDismissed(turnId);
      this.transcript.reload(this.rows(this.conversation.state), 'keep');
      this.afterTranscriptChange();
    };
    const sheet = new TalqynClarifySheet(this.theme, this.strings, {
      clarify,
      draft: this.conversation.state.clarifyDrafts.get(turnId) ?? TalqynClarifyDraft.empty,
      onDraftChange: (draft) => this.conversation.setClarifyDraft(turnId, draft),
      onSubmit: (answer) => {
        this.clarifySheet = undefined;
        presentation?.dismiss();
        this.conversation.submitClarify(turnId, answer);
      },
      onDismiss: dismissedByShopper,
    });
    presentation = this.host.overlay.present(sheet.element, { backdrop: true, onDismissRequest: dismissedByShopper });
    this.clarifySheet = presentation;
  }

  // MARK: Actions

  private turnActions(): TalqynTurnActions {
    return {
      onTapProduct: (product, turnId) => {
        const turn = this.conversation.assistantTurn(turnId);
        if (turn) this.conversation.trackProductTap(product, turn);
        this.config.callbacks().onOpenProduct?.(product);
      },
      onRetry: (turnId) => this.conversation.retry(turnId),
      onRedirect: (query) => this.config.callbacks().onOpenSearch?.(query),
      onFilters: (filters, question) =>
        this.config.callbacks().onApplyFilters?.(TalqynActionFilters.criteria(filters, { query: question })),
      onComparison: (table) => this.openComparison(table),
      onSubmitClarify: (answer, turnId) => this.conversation.submitClarify(turnId, answer),
      onClarifyDraft: (draft, turnId) => this.conversation.setClarifyDraft(turnId, draft),
      onRate: (rating, reasons, turnId) => {
        // The turn is redrawn by the render pass the change triggers — and again if Talqyn does not take
        // the rating and it is put back.
        this.conversation.rate(turnId, rating, reasons);
        const turn = this.conversation.assistantTurn(turnId);
        if (turn) this.config.callbacks().onRate?.(rating, reasons, turn);
      },
      onCopy: (text) => copyText(text, this.host.root),
      announce: (text) => this.host.announce(text),
    };
  }

  private applyNavigation(): void {
    this.header.setNavigation(this.config.callbacks().navigation?.kind);
  }

  private leave(): void {
    this.composer.blur();
    this.config.callbacks().navigation?.handler();
  }

  private editQuestion(text: string): void {
    this.conversation.setDraft(text);
    this.composer.setText(text);
    this.composer.focus();
  }

  private showQuestionMenu(point: TalqynClientPoint, items: readonly TalqynMenuItem[]): void {
    const bounds = this.host.layer.getBoundingClientRect();
    presentMenu(this.host.overlay, this.host.layer, { x: point.clientX - bounds.left, y: point.clientY - bounds.top }, items);
  }

  private confirmReset(): void {
    presentDialog(this.host.overlay, {
      title: this.strings.newChat,
      message: this.strings.newChatConfirm,
      actions: [
        { label: this.strings.cancel, role: 'cancel' },
        {
          label: this.strings.newChat,
          handler: () => {
            this.composer.blur();
            this.conversation.reset();
          },
        },
      ],
    });
  }

  private showMessage(text: string): void {
    presentDialog(this.host.overlay, { message: text, actions: [{ label: this.strings.ok }] });
  }

  private openHistory(): void {
    if (this.conversation.state.isStreaming) return;
    this.composer.blur();
    let presentation: TalqynPresentation | undefined;
    const close = (): void => {
      this.closers.delete(close);
      presentation?.dismiss();
      screen.dispose();
    };
    const screen = new TalqynChatHistoryScreen({
      talqyn: this.conversation.talqyn,
      theme: this.theme,
      strings: this.strings,
      overlay: this.host.overlay,
      onSelect: (sessionId) => {
        close();
        this.conversation.restore(sessionId);
      },
      onDelete: (sessionId) => this.conversation.discardIfOpen(sessionId),
      onClose: close,
    });
    this.closers.add(close);
    presentation = this.host.overlay.present(screen.element, { backdrop: true, onDismissRequest: close });
  }

  private openComparison(table: TalqynComparisonTable): void {
    let presentation: TalqynPresentation | undefined;
    const close = (): void => {
      this.closers.delete(close);
      presentation?.dismiss();
      screen.dispose();
    };
    const screen = new TalqynComparisonScreen({
      table,
      products: this.conversation.state.productsById,
      theme: this.theme,
      strings: this.strings,
      priceFormatter: this.config.priceFormatter,
      imageLoader: this.config.imageLoader,
      onOpenProduct: (product) => {
        close();
        this.config.callbacks().onOpenProduct?.(product);
      },
      onClose: close,
    });
    this.closers.add(close);
    presentation = this.host.overlay.present(screen.element, { backdrop: true, onDismissRequest: close });
  }
}
