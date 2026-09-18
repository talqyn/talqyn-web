import { TalqynError, type Talqyn, type TalqynChatSummary } from '../sdk/index.js';
import { TalqynStore, type TalqynListener } from './store.js';
import type { TalqynUiStrings } from './ui-strings.js';

/** What the history list shows. */
export type TalqynChatHistoryState =
  | { readonly type: 'loading' }
  | { readonly type: 'empty' }
  | { readonly type: 'failed'; readonly error: TalqynError }
  | { readonly type: 'loaded'; readonly chats: readonly TalqynChatSummary[]; readonly isLoadingMore: boolean };

/** Options of {@link TalqynChatHistory}. */
export interface TalqynChatHistoryOptions {
  /** How many chats per page. Defaults to 20. */
  readonly pageSize?: number;
}

/**
 * The shopper's list of conversations: paged loading, refresh, deletion.
 *
 * Backs the history screen of `@talqyn/web/ui`; public for a storefront that lists chats in its own screen.
 */
export class TalqynChatHistory {
  /** The client the list loads through. */
  readonly talqyn: Talqyn;

  private readonly pageSize: number;
  private readonly store = new TalqynStore<TalqynChatHistoryState>({ type: 'loading' });
  private chats: TalqynChatSummary[] = [];
  private isLoadingPage = false;
  private hasMore = true;
  private loadController: AbortController | undefined;

  constructor(talqyn: Talqyn, options: TalqynChatHistoryOptions = {}) {
    this.talqyn = talqyn;
    this.pageSize = options.pageSize ?? 20;
  }

  /** What the list shows now. */
  get state(): TalqynChatHistoryState {
    return this.store.get();
  }

  /** Listens for changes of {@link state}. @returns What stops the listening. */
  readonly subscribe = (listener: TalqynListener<TalqynChatHistoryState>): (() => void) => this.store.subscribe(listener);

  /** Loads the first page, replacing what is shown. */
  load(): void {
    this.loadPage(true);
  }

  /** Loads the next page once the shopper is near the end of the list. @param chat The chat that just became visible. */
  loadMoreIfNeeded(chat: TalqynChatSummary): void {
    const index = this.chats.findIndex((candidate) => candidate.sessionId === chat.sessionId);
    if (index < 0 || index < this.chats.length - 5) return;
    this.loadPage(false);
  }

  /** Deletes a conversation. The row goes at once; a failed deletion reloads the list so the row comes back. */
  delete(sessionId: string): void {
    this.chats = this.chats.filter((chat) => chat.sessionId !== sessionId);
    this.render();
    this.talqyn.consultant.deleteChat(sessionId).catch(() => {
      this.loadPage(true);
    });
  }

  /** Stops a page on its way: the list is no longer shown. */
  cancel(): void {
    this.loadController?.abort();
    this.loadController = undefined;
    this.isLoadingPage = false;
  }

  private loadPage(reset: boolean): void {
    if (reset) {
      this.loadController?.abort();
      this.isLoadingPage = false;
      this.hasMore = true;
    }
    if (this.isLoadingPage || !(reset || this.hasMore)) return;
    this.isLoadingPage = true;
    this.render();

    const offset = reset ? 0 : this.chats.length;
    const controller = new AbortController();
    this.loadController = controller;
    this.talqyn.consultant.chats({ limit: this.pageSize, offset, signal: controller.signal }).then(
      (page) => {
        if (controller.signal.aborted) return;
        this.isLoadingPage = false;
        this.hasMore = page.length === this.pageSize;
        this.chats = reset ? page : appending(page, this.chats);
        this.render();
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        this.isLoadingPage = false;
        if (this.chats.length === 0) {
          this.store.set({ type: 'failed', error: TalqynError.wrap(error) });
        } else {
          this.render();
        }
      },
    );
  }

  private render(): void {
    if (this.chats.length === 0) {
      this.store.set(this.isLoadingPage ? { type: 'loading' } : { type: 'empty' });
      return;
    }
    this.store.set({ type: 'loaded', chats: [...this.chats], isLoadingMore: this.isLoadingPage });
  }

  /**
   * The subtitle of a row: the time for today, "yesterday", otherwise the date, with the year only when it
   * is not this one. The shapes are the locale's own: the order, the separators, and whether the time has
   * a 12-hour clock come from the copy's locale, not from the browser.
   *
   * @param date When the last message was written.
   * @param strings For the word "yesterday" and the locale to write the date in.
   * @param now The current moment; injectable for tests.
   */
  static subtitle(date: Date | undefined, strings: TalqynUiStrings, now: Date = new Date()): string {
    if (!date) return '';
    // A browser without data for the copy's locale — Chrome ships none for Kazakh — would write the date the
    // English way. Kazakhstan's Russian writes the time as Kazakh does; the date then goes out in digits,
    // which read the same in either language, rather than with a month name in the wrong one.
    //
    // `Intl` throws on a structurally invalid tag where iOS's `Locale(identifier:)` never does — and
    // "ru_KZ", the spelling the iOS documentation uses, is exactly such a tag. The underscore is
    // mended; a tag broken beyond that falls back to digits rather than take the history screen down.
    const tag = strings.locale.replaceAll('_', '-');
    let hasLocaleData = false;
    let locales: readonly string[] = ['ru-KZ'];
    try {
      hasLocaleData = Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0;
      locales = [tag, 'ru-KZ'];
    } catch {
      // The malformed tag stays out of the list; the shared ru-KZ shapes carry the row.
    }
    if (isSameDay(date, now)) {
      return new Intl.DateTimeFormat(locales, { hour: 'numeric', minute: '2-digit' }).format(date);
    }
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (isSameDay(date, yesterday)) return strings.historyYesterday;
    const day: Intl.DateTimeFormatOptions = hasLocaleData ? { day: 'numeric', month: 'short' } : { day: '2-digit', month: '2-digit' };
    const sameYear = date.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(locales, sameYear ? day : { ...day, year: 'numeric' }).format(date);
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function appending(page: readonly TalqynChatSummary[], chats: readonly TalqynChatSummary[]): TalqynChatSummary[] {
  const known = new Set(chats.map((chat) => chat.sessionId));
  return [...chats, ...page.filter((chat) => !known.has(chat.sessionId))];
}
