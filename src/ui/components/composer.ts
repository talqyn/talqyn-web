import { TalqynConversationLimits, TalqynUiStrings } from '../../consultant-core/index.js';
import { button, h, iconSlot, setHidden, setIcon, setText } from '../support/dom.js';
import { hasFinePointer, tapFeedback } from '../support/platform.js';
import type { TalqynTheme } from '../theme.js';

/** How close to the limit the counter appears. */
const COUNTER_THRESHOLD = 100;

/**
 * The input pill: a growing text field, a counter near the limit, and a button that sends — or stops the
 * answer while one is streaming. Under the pill, a line that the consultant can be wrong.
 *
 * With a mouse and a keyboard, Enter sends and Shift+Enter starts a new line; on a touch screen the return
 * key starts a new line and the button sends, the way a phone's messenger does. A composition in progress
 * — a Kazakh or a Chinese input method — never sends.
 */
export class TalqynComposerView {
  /** The gap above the pill, inside the composer's own bounds. The transcript counts on it when it measures its distance to the pill. */
  static readonly topInset = 8;

  readonly element: HTMLDivElement;
  readonly input: HTMLTextAreaElement;
  private readonly counter = h('span', 'tq-composer-counter tq-font-micro');
  private readonly send: HTMLButtonElement;
  private isStreaming = false;
  onSend: (() => void) | undefined;
  onStop: (() => void) | undefined;
  onTextChange: ((text: string) => void) | undefined;
  onFocusChange: ((focused: boolean) => void) | undefined;

  constructor(
    private readonly theme: TalqynTheme,
    private readonly strings: TalqynUiStrings,
  ) {
    this.input = h('textarea', 'tq-composer-input tq-font-body');
    this.input.rows = 1;
    this.input.placeholder = strings.placeholder;
    this.input.maxLength = TalqynConversationLimits.maxInputLength;
    this.input.setAttribute('aria-label', strings.placeholder);
    this.input.autocomplete = 'off';
    this.input.addEventListener('input', () => {
      this.refreshHeight();
      this.updateSendButton();
      this.onTextChange?.(this.input.value);
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (!hasFinePointer()) return;
      event.preventDefault();
      if (!this.isStreaming && this.input.value.trim().length > 0) this.onSend?.();
    });
    this.input.addEventListener('focus', () => this.onFocusChange?.(true));
    this.input.addEventListener('blur', () => this.onFocusChange?.(false));

    this.send = button('tq-send tq-hit', [iconSlot(theme.icons.send)], strings.send);
    this.send.addEventListener('click', () => {
      tapFeedback(theme);
      if (this.isStreaming) this.onStop?.();
      else if (this.input.value.trim().length > 0) this.onSend?.();
    });
    this.counter.hidden = true;
    this.counter.setAttribute('aria-live', 'polite');

    const pill = h('div', 'tq-composer-pill', [this.input, this.counter, this.send]);
    // The answers are a model's: say so where every answer is read from, in the shopper's language, small
    // and out of the way. A site that says it elsewhere blanks the string.
    const disclaimer = h('div', 'tq-disclaimer tq-font-micro', [TalqynUiStrings.filled(strings.disclaimer, strings.title)]);
    disclaimer.hidden = strings.disclaimer.length === 0;
    this.element = h('div', 'tq-composer', [pill, disclaimer]);
    this.updateSendButton();
  }

  get text(): string {
    return this.input.value;
  }

  get isFocused(): boolean {
    const root = this.input.getRootNode();
    return (root instanceof ShadowRoot || root instanceof Document) && root.activeElement === this.input;
  }

  setText(text: string): void {
    const value = text.slice(0, TalqynConversationLimits.maxInputLength);
    if (this.input.value === value) return;
    this.input.value = value;
    this.refreshHeight();
    this.updateSendButton();
  }

  setStreaming(streaming: boolean): void {
    if (this.isStreaming === streaming) return;
    this.isStreaming = streaming;
    this.updateSendButton();
  }

  /** Puts the cursor in the field, at the end of what is there. */
  focus(): void {
    this.input.focus({ preventScroll: true });
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  blur(): void {
    this.input.blur();
  }

  /**
   * One line of the body with its insets, never under the 44 pixels of the design; four lines before the
   * text starts to scroll. The screen calls it again when its width changes: the same text wraps differently.
   */
  refreshHeight(): void {
    const style = this.input.style;
    style.height = 'auto';
    const minimum = 44;
    const maximum = 104;
    const content = this.input.scrollHeight;
    style.height = `${Math.min(Math.max(content, minimum), maximum)}px`;
    style.overflowY = content > maximum ? 'auto' : 'hidden';
  }

  private updateSendButton(): void {
    const isBlank = this.input.value.trim().length === 0;
    const slot = this.send.firstElementChild as HTMLElement;
    if (this.isStreaming) {
      setIcon(slot, this.theme.icons.stop);
      this.send.dataset['streaming'] = '';
      this.send.disabled = false;
      this.send.setAttribute('aria-label', this.strings.stop);
      this.send.title = this.strings.stop;
    } else {
      setIcon(slot, this.theme.icons.send);
      delete this.send.dataset['streaming'];
      this.send.disabled = isBlank;
      this.send.setAttribute('aria-label', this.strings.send);
      this.send.title = this.strings.send;
    }
    const count = this.input.value.length;
    const limit = TalqynConversationLimits.maxInputLength;
    const isNearLimit = count >= limit - COUNTER_THRESHOLD;
    setHidden(this.counter, !isNearLimit);
    if (isNearLimit) {
      setText(this.counter, `${count}/${limit}`);
      if (count >= limit) this.counter.dataset['over'] = '';
      else delete this.counter.dataset['over'];
    }
  }
}
