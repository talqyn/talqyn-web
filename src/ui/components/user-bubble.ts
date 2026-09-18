import type { TalqynUiStrings } from '../../consultant-core/index.js';
import { h, setText } from '../support/dom.js';
import type { TalqynTheme } from '../theme.js';
import type { TalqynMenuItem } from './overlay.js';

/** How long a finger rests on the bubble before the menu comes up. */
const LONG_PRESS_MS = 500;

/** A point on the screen, in client coordinates. */
export interface TalqynClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * The shopper's message, right-aligned in the bubble color with a square bottom-right corner.
 *
 * A right click, a long press, or the keyboard's context-menu key brings up "copy" and "change the
 * question" — the text goes back into the composer to be asked differently.
 */
export class TalqynUserBubbleView {
  readonly element: HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private suppressClick = false;
  private menuOpenedAt = 0;

  constructor(
    private readonly theme: TalqynTheme,
    private readonly strings: TalqynUiStrings,
    private readonly handlers: {
      readonly onCopy: (text: string) => void;
      readonly onEdit: (text: string) => void;
      readonly onMenu: (point: TalqynClientPoint, items: readonly TalqynMenuItem[]) => void;
    },
  ) {
    this.bubble = h('div', 'tq-bubble tq-font-body');
    this.bubble.tabIndex = 0;
    this.element = h('div', 'tq-user-row', [this.bubble]);

    this.bubble.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.cancelPress();
      const fromKeyboard = event.clientX === 0 && event.clientY === 0;
      if (!fromKeyboard) {
        this.openMenu(event);
        return;
      }
      const rect = this.bubble.getBoundingClientRect();
      this.openMenu({ clientX: rect.left, clientY: rect.bottom + 4 });
    });
    // Safari on iOS has no context menu for a long press on plain text; the timer brings the menu up there.
    this.bubble.addEventListener(
      'touchstart',
      (event) => {
        const touch = event.touches[0];
        if (!touch || event.touches.length > 1) return;
        this.cancelPress();
        const point = { clientX: touch.clientX, clientY: touch.clientY };
        this.pressTimer = setTimeout(() => {
          this.pressTimer = undefined;
          this.suppressClick = true;
          this.openMenu(point);
        }, LONG_PRESS_MS);
      },
      { passive: true },
    );
    for (const type of ['touchend', 'touchmove', 'touchcancel'] as const) {
      this.bubble.addEventListener(type, () => this.cancelPress(), { passive: true });
    }
    this.bubble.addEventListener(
      'click',
      (event) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }

  update(text: string): void {
    setText(this.bubble, text);
  }

  private cancelPress(): void {
    clearTimeout(this.pressTimer);
    this.pressTimer = undefined;
  }

  private openMenu(point: TalqynClientPoint): void {
    const text = this.bubble.textContent ?? '';
    // Chrome on Android answers a long press with a context menu of its own as well: one menu per press.
    const now = Date.now();
    if (text.length === 0 || now - this.menuOpenedAt < 800) return;
    this.menuOpenedAt = now;
    const icons = this.theme.icons;
    this.handlers.onMenu(point, [
      { label: this.strings.copyQuestion, icon: icons.copyAnswer, handler: () => this.handlers.onCopy(text) },
      { label: this.strings.editQuestion, icon: icons.editQuestion, handler: () => this.handlers.onEdit(text) },
    ]);
  }
}
