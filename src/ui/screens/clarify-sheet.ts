import type { TalqynClarifyDraft, TalqynUiStrings } from '../../consultant-core/index.js';
import type { TalqynClarify } from '../../sdk/index.js';
import { TalqynClarifyFormView } from '../components/turn-view.js';
import { h, uniqueId } from '../support/dom.js';
import type { TalqynTheme } from '../theme.js';

/** How far the sheet is dragged down by its grabber before letting go closes it. */
const DISMISS_DISTANCE = 96;

/**
 * The clarifying questions as a sheet: the first time a turn asks, the questions come up over the
 * transcript; dismissed, they stay as a card in it. A sheet from the bottom on a narrow screen — dragged
 * down by its grabber, it closes — and a dialog in the middle of a wide one.
 */
export class TalqynClarifySheet {
  readonly element: HTMLDivElement;

  constructor(
    theme: TalqynTheme,
    strings: TalqynUiStrings,
    init: {
      readonly clarify: TalqynClarify;
      readonly draft: TalqynClarifyDraft;
      readonly onDraftChange: (draft: TalqynClarifyDraft) => void;
      readonly onSubmit: (answer: string) => void;
      /** The shopper dragged the sheet away. */
      readonly onDismiss: () => void;
    },
  ) {
    const form = new TalqynClarifyFormView(theme, strings, 'tq-clarify-sheet-form');
    form.onDraftChange = init.onDraftChange;
    form.onSubmit = init.onSubmit;
    form.update(init.clarify, init.draft);

    const title = h('h2', 'tq-clarify-sheet-title tq-font-title', [init.clarify.message]);
    title.id = uniqueId('tq-clarify-title');
    title.hidden = init.clarify.message.length === 0;

    const grabber = h('div', 'tq-sheet-grabber');
    const body = h('div', 'tq-clarify-sheet-body', [title, form.element]);
    const footer = h('div', 'tq-clarify-sheet-footer', [form.submit, form.skip]);
    this.element = h('div', 'tq-sheet tq-clarify-sheet', [grabber, body, footer]);
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    if (title.hidden) this.element.setAttribute('aria-label', strings.clarifySubmit);
    else this.element.setAttribute('aria-labelledby', title.id);
    this.followDrag(grabber, init.onDismiss);
  }

  /** The sheet follows a drag of its grabber down, and closes past {@link DISMISS_DISTANCE}; short of it, it springs back. */
  private followDrag(handle: HTMLElement, onDismiss: () => void): void {
    let start: { readonly pointerId: number; readonly y: number } | undefined;
    const distance = (event: PointerEvent): number => (start ? Math.max(0, event.clientY - start.y) : 0);

    handle.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      start = { pointerId: event.pointerId, y: event.clientY };
      handle.setPointerCapture(event.pointerId);
      this.element.style.animation = 'none';
      this.element.style.transition = 'none';
    });
    handle.addEventListener('pointermove', (event) => {
      if (start?.pointerId !== event.pointerId) return;
      this.element.style.transform = `translateY(${distance(event)}px)`;
    });
    const release = (event: PointerEvent): void => {
      if (start?.pointerId !== event.pointerId) return;
      const dragged = distance(event);
      start = undefined;
      this.element.style.transition = '';
      if (event.type === 'pointerup' && dragged >= DISMISS_DISTANCE) {
        onDismiss();
        return;
      }
      this.element.style.transform = '';
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
  }
}
