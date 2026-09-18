import { TalqynUiStrings } from '../consultant-core/index.js';
import type { Talqyn } from '../sdk/index.js';
import { TalqynChatHistoryScreen } from './screens/chat-history-screen.js';
import { baseCss } from './styles/base.js';
import { chatHistoryCss } from './styles/chat-history.js';
import { defineElement, TalqynElementBase, TalqynScreenHost } from './support/host.js';
import { TalqynTheme } from './theme.js';

/** The tag of the chat history element. */
export const TALQYN_CHAT_HISTORY_TAG = 'talqyn-chat-history';

const css = baseCss + chatHistoryCss;

/** What a chat history drawn on its own is built from. */
export interface TalqynChatHistoryMountOptions {
  /** The client to load through. Its token must name the shopper: under a guest token the list is unavailable. */
  readonly talqyn: Talqyn;
  /** Colors, type, icons, and shapes. Defaults to the SDK's neutral theme. */
  readonly theme?: TalqynTheme;
  /** Copy. Defaults to the client's locale, as the consultant screen does. */
  readonly strings?: TalqynUiStrings;
  /** How many conversations a page brings. Defaults to 20. */
  readonly pageSize?: number;
  /** A conversation was chosen: `conversation.restore(sessionId)`, as a rule, after closing the list. */
  readonly onSelect: (sessionId: string) => void;
  /** A conversation was deleted: `conversation.discardIfOpen(sessionId)`, as a rule. */
  readonly onDelete: (sessionId: string) => void;
  /** The shopper closed the list. */
  readonly onClose: () => void;
}

/** A chat history put on a page. */
export interface TalqynChatHistoryHandle {
  readonly element: TalqynChatHistoryElement;
  /** Takes the list off the page. */
  destroy(): void;
}

/**
 * The shopper's conversations as a custom element, `<talqyn-chat-history>` — for a site that draws its own
 * header over the consultant (`showsHeader: false`) and opens the history from it. The consultant screen's
 * own header opens this list by itself.
 *
 * Configure it before or after it is connected; it loads and draws itself inside a shadow root while it is
 * on the page, and stops loading when it is taken off.
 */
export class TalqynChatHistoryElement extends TalqynElementBase {
  private options: TalqynChatHistoryMountOptions | undefined;
  private screenHost: TalqynScreenHost | undefined;
  private screen: TalqynChatHistoryScreen | undefined;
  private removalCheck = 0;

  /** Sets what the element shows, loading it again when it is on the page. */
  configure(options: TalqynChatHistoryMountOptions): void {
    this.options = options;
    if (this.isConnected) this.build();
  }

  connectedCallback(): void {
    this.removalCheck += 1;
    if (!this.screen) this.build();
  }

  disconnectedCallback(): void {
    if (!this.screen) return;
    const check = ++this.removalCheck;
    // A move is a disconnect and a connect in one task: only a removal that is still a removal once the
    // task is over takes the list down — a framework reparenting the element must not cancel its page.
    queueMicrotask(() => {
      if (check !== this.removalCheck || this.isConnected) return;
      this.teardown();
    });
  }

  private build(): void {
    this.teardown();
    const options = this.options;
    if (!options) return;
    const theme = options.theme ?? TalqynTheme.default;
    const host = new TalqynScreenHost(this, css);
    host.applyTheme(theme);
    const screen = new TalqynChatHistoryScreen({
      talqyn: options.talqyn,
      theme,
      strings: options.strings ?? TalqynUiStrings.forLocale(options.talqyn.currentLocale),
      overlay: host.overlay,
      pageSize: options.pageSize,
      onSelect: (sessionId) => this.options?.onSelect(sessionId),
      onDelete: (sessionId) => this.options?.onDelete(sessionId),
      onClose: () => this.options?.onClose(),
    });
    host.root.appendChild(screen.element);
    this.screenHost = host;
    this.screen = screen;
  }

  private teardown(): void {
    this.screen?.dispose();
    this.screen = undefined;
    this.screenHost?.dispose();
    this.screenHost = undefined;
  }
}

/** Registers `<talqyn-chat-history>`. Safe to call more than once. */
export function defineTalqynChatHistoryElement(): void {
  defineElement(TALQYN_CHAT_HISTORY_TAG, TalqynChatHistoryElement);
}

/**
 * Draws the shopper's conversations inside `container`.
 *
 * ```ts
 * const handle = mountTalqynChatHistory(panel, {
 *   talqyn,
 *   onSelect: (sessionId) => { handle.destroy(); conversation.restore(sessionId); },
 *   onDelete: (sessionId) => conversation.discardIfOpen(sessionId),
 *   onClose: () => handle.destroy(),
 * });
 * ```
 */
export function mountTalqynChatHistory(container: Element, options: TalqynChatHistoryMountOptions): TalqynChatHistoryHandle {
  defineTalqynChatHistoryElement();
  const element = document.createElement(TALQYN_CHAT_HISTORY_TAG) as TalqynChatHistoryElement;
  element.configure(options);
  container.appendChild(element);
  return { element, destroy: () => element.remove() };
}
