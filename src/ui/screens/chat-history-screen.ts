import { TalqynChatHistory, type TalqynChatHistoryState, type TalqynUiStrings } from '../../consultant-core/index.js';
import type { Talqyn, TalqynChatSummary } from '../../sdk/index.js';
import { iconButton, textButton } from '../components/controls.js';
import { presentDialog, type TalqynOverlay } from '../components/overlay.js';
import { button, h, reorderChildren, setAttribute, setHidden, setText, uniqueId } from '../support/dom.js';
import type { TalqynTheme } from '../theme.js';

/** What {@link TalqynChatHistoryScreen} is built from. */
export interface TalqynChatHistoryScreenOptions {
  /** The client to load through. */
  readonly talqyn: Talqyn;
  readonly theme: TalqynTheme;
  readonly strings: TalqynUiStrings;
  /** Where the screen asks whether to delete a conversation. */
  readonly overlay: TalqynOverlay;
  /** A conversation was chosen. Whoever presented the screen closes it. */
  readonly onSelect: (sessionId: string) => void;
  /** A conversation was deleted — the one open behind the screen may have to go too. */
  readonly onDelete: (sessionId: string) => void;
  /** The shopper closed the screen. */
  readonly onClose: () => void;
  /** How many conversations a page brings. Defaults to 20. */
  readonly pageSize?: number;
}

/**
 * The shopper's conversations, newest first: tap to reopen, delete with a confirmation, more pages as the
 * list is scrolled.
 *
 * A screen of its own, with its own header and close button — it replaces the consultant rather than
 * sliding a card over it, since a drag that dismisses a sheet would fight the scroll of the list.
 */
export class TalqynChatHistoryScreen {
  readonly element: HTMLDivElement;

  private readonly history: TalqynChatHistory;
  private readonly body: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly more: HTMLDivElement;
  private readonly loading: HTMLDivElement;
  private readonly placeholder: HTMLDivElement;
  private readonly placeholderText: HTMLParagraphElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly rows = new Map<string, TalqynChatHistoryRow>();
  private readonly visibility: IntersectionObserver | undefined;
  private readonly unsubscribe: () => void;
  private chats: readonly TalqynChatSummary[] = [];
  private isDisposed = false;

  constructor(private readonly options: TalqynChatHistoryScreenOptions) {
    const { strings, theme } = options;
    this.history = new TalqynChatHistory(options.talqyn, { pageSize: options.pageSize });

    const header = h('div', 'tq-screen-header', [
      h('h2', 'tq-screen-header-title tq-font-headline', [strings.historyTitle]),
      h('div', 'tq-screen-header-trailing', [iconButton(theme.icons.close, strings.close, () => this.options.onClose())]),
    ]);

    this.list = h('ul', 'tq-history-list');
    const spinner = h('span', 'tq-spinner');
    spinner.dataset['size'] = 'large';
    this.loading = h('div', 'tq-history-loading', [spinner]);
    this.loading.hidden = true;
    this.more = h('div', 'tq-history-more', [h('span', 'tq-spinner')]);
    this.more.hidden = true;
    this.placeholderText = h('p', 'tq-history-placeholder-text tq-font-callout');
    this.retryButton = textButton(strings.retry, () => this.history.load());
    this.placeholder = h('div', 'tq-history-placeholder', [this.placeholderText, this.retryButton]);
    this.placeholder.hidden = true;
    this.body = h('div', 'tq-history-body', [this.list, this.more, this.loading, this.placeholder]);

    this.element = h('div', 'tq-fullscreen tq-history', [header, this.body]);
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', strings.historyTitle);

    // The next page is asked for as the rows near the end come into view, the way a table asks as its
    // cells are displayed; where the browser has no IntersectionObserver the scroll position says so.
    if (typeof IntersectionObserver === 'undefined') {
      this.visibility = undefined;
      this.body.addEventListener('scroll', this.onScroll, { passive: true });
    } else {
      this.visibility = new IntersectionObserver(this.onRowsVisible, { root: this.body, rootMargin: '0px 0px 200px 0px' });
    }

    this.unsubscribe = this.history.subscribe((state) => this.render(state));
    this.history.load();
    this.render(this.history.state);
  }

  /** Stops listening and stops a page on its way: the screen is no longer shown. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribe();
    this.history.cancel();
    this.visibility?.disconnect();
    this.body.removeEventListener('scroll', this.onScroll);
  }

  private render(state: TalqynChatHistoryState): void {
    if (this.isDisposed) return;
    const { strings } = this.options;
    switch (state.type) {
      case 'loading':
        this.setRows([]);
        setHidden(this.more, true);
        setHidden(this.placeholder, true);
        setHidden(this.loading, false);
        break;
      case 'empty':
        this.setRows([]);
        setHidden(this.loading, true);
        this.showPlaceholder(strings.historyEmpty, false);
        break;
      case 'failed':
        this.setRows([]);
        setHidden(this.loading, true);
        // A token that names no shopper cannot have a history: that is not a failure a retry fixes by
        // itself, and it must not read as one.
        this.showPlaceholder(state.error.kind === 'forbidden' ? strings.historyUnavailable : strings.historyError, true);
        break;
      case 'loaded':
        setHidden(this.loading, true);
        setHidden(this.placeholder, true);
        this.setRows(state.chats);
        setHidden(this.more, !state.isLoadingMore);
        break;
    }
    const isBusy = state.type === 'loading' || (state.type === 'loaded' && state.isLoadingMore);
    setAttribute(this.body, 'aria-busy', isBusy ? 'true' : null);
    if (!this.visibility) this.onScroll();
  }

  private showPlaceholder(text: string, showsRetry: boolean): void {
    setText(this.placeholderText, text);
    setHidden(this.retryButton, !showsRetry);
    setHidden(this.placeholder, false);
    setHidden(this.more, true);
  }

  /** Keeps a row element per conversation, so a page that arrives or a row that goes moves nothing else. */
  private setRows(chats: readonly TalqynChatSummary[]): void {
    this.chats = chats;
    const shown = new Set<string>();
    const elements: HTMLElement[] = [];
    for (const chat of chats) {
      shown.add(chat.sessionId);
      let row = this.rows.get(chat.sessionId);
      if (!row) {
        row = new TalqynChatHistoryRow(this.options.theme, this.options.strings, {
          onSelect: (sessionId) => this.options.onSelect(sessionId),
          onDelete: (summary) => this.confirmDelete(summary),
        });
        this.rows.set(chat.sessionId, row);
        this.visibility?.observe(row.element);
      }
      row.update(chat);
      elements.push(row.element);
    }
    for (const [sessionId, row] of this.rows) {
      if (shown.has(sessionId)) continue;
      this.visibility?.unobserve(row.element);
      this.rows.delete(sessionId);
    }
    reorderChildren(this.list, elements);
  }

  private confirmDelete(chat: TalqynChatSummary): void {
    const { strings } = this.options;
    presentDialog(this.options.overlay, {
      title: strings.historyDeleteTitle,
      message: strings.historyDeleteConfirm,
      actions: [
        { label: strings.cancel, role: 'cancel' },
        {
          label: strings.historyDelete,
          role: 'destructive',
          handler: () => {
            this.history.delete(chat.sessionId);
            this.options.onDelete(chat.sessionId);
          },
        },
      ],
    });
  }

  private readonly onRowsVisible = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const sessionId = (entry.target as HTMLElement).dataset['sessionId'];
      const chat = this.chats.find((candidate) => candidate.sessionId === sessionId);
      if (chat) this.history.loadMoreIfNeeded(chat);
    }
  };

  private readonly onScroll = (): void => {
    const last = this.chats[this.chats.length - 1];
    if (!last || this.isDisposed) return;
    if (this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 200) {
      this.history.loadMoreIfNeeded(last);
    }
  };
}

/** One conversation in the list: the row that reopens it, and the button that deletes it. */
class TalqynChatHistoryRow {
  readonly element: HTMLLIElement;
  private readonly title: HTMLSpanElement;
  private readonly subtitle: HTMLSpanElement;
  private readonly open: HTMLButtonElement;
  private chat: TalqynChatSummary | undefined;

  constructor(
    theme: TalqynTheme,
    private readonly strings: TalqynUiStrings,
    handlers: { readonly onSelect: (sessionId: string) => void; readonly onDelete: (chat: TalqynChatSummary) => void },
  ) {
    this.title = h('span', 'tq-history-title tq-font-body');
    this.title.id = uniqueId('tq-history-title');
    this.subtitle = h('span', 'tq-history-subtitle tq-font-footnote');
    this.open = button('tq-history-open', [h('span', 'tq-history-text', [this.title, this.subtitle])]);
    this.open.addEventListener('click', () => {
      if (this.chat) handlers.onSelect(this.chat.sessionId);
    });
    const remove = iconButton(theme.icons.deleteChat, strings.historyDelete, () => {
      if (this.chat) handlers.onDelete(this.chat);
    });
    remove.classList.add('tq-history-delete');
    // Every row's button says "delete"; the title says which conversation.
    remove.setAttribute('aria-describedby', this.title.id);
    this.element = h('li', 'tq-history-row', [this.open, remove]);
  }

  update(chat: TalqynChatSummary): void {
    this.chat = chat;
    this.element.dataset['sessionId'] = chat.sessionId;
    const trimmed = chat.title?.trim() ?? '';
    const title = trimmed.length === 0 ? this.strings.historyUntitled : trimmed;
    const subtitle = TalqynChatHistory.subtitle(chat.lastMessageAt, this.strings);
    setText(this.title, title);
    setText(this.subtitle, subtitle);
    setHidden(this.subtitle, subtitle.length === 0);
    setAttribute(this.open, 'aria-label', subtitle.length === 0 ? title : `${title}, ${subtitle}`);
  }
}
