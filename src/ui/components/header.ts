import type { TalqynUiStrings } from '../../consultant-core/index.js';
import { h, setHidden } from '../support/dom.js';
import type { TalqynTheme } from '../theme.js';
import { iconButton, setButtonIcon } from './controls.js';

/** How the consultant is left: back to the page it was opened from, or closed over it. */
export type TalqynNavigationKind = 'back' | 'close';

/**
 * The screen's own bar: the way out of the consultant on the left, the title, then history and a new chat.
 *
 * The way out is the site's to name, since a page cannot tell how it was shown: a back arrow, a cross, or
 * nothing when the consultant is a page of its own. History stands in the leading slot when there is no
 * way out to put there, and moves next to the new chat when there is.
 */
export class TalqynHeaderView {
  readonly element: HTMLDivElement;
  private readonly leading: HTMLDivElement;
  private readonly trailing: HTMLDivElement;
  private readonly leave: HTMLButtonElement;
  private readonly history: HTMLButtonElement;
  private readonly newChat: HTMLButtonElement;
  private navigation: TalqynNavigationKind | undefined;

  constructor(
    private readonly theme: TalqynTheme,
    private readonly strings: TalqynUiStrings,
    handlers: { readonly onNewChat: () => void; readonly onHistory: () => void; readonly onLeave: () => void },
  ) {
    this.leave = iconButton(theme.icons.back, strings.back, handlers.onLeave);
    this.leave.hidden = true;
    this.history = iconButton(theme.icons.history, strings.historyTitle, handlers.onHistory);
    this.newChat = iconButton(theme.icons.newChat, strings.newChat, handlers.onNewChat);
    this.newChat.dataset['role'] = 'new-chat';
    this.newChat.hidden = true;
    this.leading = h('div', 'tq-header-side', [this.leave, this.history]);
    this.trailing = h('div', 'tq-header-side tq-header-side--trailing', [this.newChat]);
    const title = h('h1', 'tq-header-title tq-font-headline', [strings.title]);
    this.element = h('div', 'tq-header', [h('div', 'tq-header-content', [this.leading, title, this.trailing])]);
  }

  /** Shows the way out of the screen, or none. */
  setNavigation(kind: TalqynNavigationKind | undefined): void {
    if (kind === this.navigation && this.leave.hidden === (kind === undefined)) return;
    this.navigation = kind;
    if (kind === 'back') {
      setButtonIcon(this.leave, this.theme.icons.back);
      this.leave.setAttribute('aria-label', this.strings.back);
      this.leave.title = this.strings.back;
    } else if (kind === 'close') {
      setButtonIcon(this.leave, this.theme.icons.close);
      this.leave.setAttribute('aria-label', this.strings.close);
      this.leave.title = this.strings.close;
    }
    setHidden(this.leave, kind === undefined);
    if (kind === undefined) this.leading.appendChild(this.history);
    else this.trailing.insertBefore(this.history, this.newChat);
  }

  setNewChatVisible(visible: boolean): void {
    setHidden(this.newChat, !visible);
  }

  setActionsEnabled(enabled: boolean): void {
    this.newChat.disabled = !enabled;
    this.history.disabled = !enabled;
  }
}
