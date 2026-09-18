import { button, h, iconSlot } from '../support/dom.js';
import type { TalqynIcon } from '../theme.js';

/** A layer presented over a screen. */
export interface TalqynPresentation {
  readonly element: HTMLElement;
  /** Takes the layer away. Safe to call more than once. */
  dismiss(): void;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The layers a screen presents over itself — sheets, dialogs, menus, full-screen views — in a stack.
 *
 * While anything is up, what is behind it is `inert`: out of reach of the pointer, of the keyboard's
 * focus, and of screen readers, which would otherwise read the transcript behind a table. Focus stays
 * inside the top layer, Escape asks it to close, and closing hands focus back to where it was.
 */
export class TalqynOverlay {
  private readonly stack: {
    readonly element: HTMLElement;
    readonly onDismissRequest: (() => void) | undefined;
    readonly returnFocus: HTMLElement | null;
  }[] = [];

  /**
   * @param layer Where layers are put, over the screen.
   * @param background What the layers cover, made inert while any is up.
   */
  constructor(
    private readonly layer: HTMLElement,
    private readonly background: HTMLElement,
  ) {
    layer.addEventListener('keydown', this.onKeyDown);
  }

  /** Whether anything is presented. */
  get isPresenting(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Presents a layer.
   *
   * @param options.onDismissRequest Called for Escape and for a tap on the backdrop — the layer decides
   *   whether that closes it. Without it neither does anything.
   * @param options.backdrop Whether a dimming backdrop goes under the layer.
   */
  present(
    content: HTMLElement,
    options: { readonly onDismissRequest?: () => void; readonly backdrop?: boolean; readonly focus?: HTMLElement } = {},
  ): TalqynPresentation {
    const root = this.stack.length === 0 ? this.background.getRootNode() : this.layer.getRootNode();
    const active = root instanceof ShadowRoot || root instanceof Document ? root.activeElement : null;
    const wrapper = h('div', 'tq-presentation');
    if (options.backdrop) {
      const backdrop = h('div', 'tq-backdrop');
      backdrop.addEventListener('click', () => options.onDismissRequest?.());
      wrapper.appendChild(backdrop);
    }
    wrapper.appendChild(content);

    // Layers under the new one go inert too: only the top one takes input.
    for (const entry of this.stack) entry.element.inert = true;
    this.background.inert = true;
    this.layer.appendChild(wrapper);
    this.stack.push({ element: wrapper, onDismissRequest: options.onDismissRequest, returnFocus: active instanceof HTMLElement ? active : null });

    const target = options.focus ?? content.querySelector<HTMLElement>(focusableSelector) ?? content;
    if (target === content && !content.hasAttribute('tabindex')) content.tabIndex = -1;
    queueMicrotask(() => target.focus({ preventScroll: true }));

    let isDismissed = false;
    return {
      element: content,
      dismiss: () => {
        if (isDismissed) return;
        isDismissed = true;
        this.remove(wrapper);
      },
    };
  }

  /** Takes every layer away. */
  dismissAll(): void {
    while (this.stack.length > 0) this.remove(this.stack[this.stack.length - 1]!.element);
  }

  private remove(wrapper: HTMLElement): void {
    const index = this.stack.findIndex((entry) => entry.element === wrapper);
    if (index < 0) return;
    const [entry] = this.stack.splice(index, 1);
    wrapper.remove();
    const top = this.stack[this.stack.length - 1];
    if (top) {
      top.element.inert = false;
    } else {
      this.background.inert = false;
    }
    if (index === this.stack.length && entry?.returnFocus?.isConnected) {
      entry.returnFocus.focus({ preventScroll: true });
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      top.onDismissRequest?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...top.element.querySelectorAll<HTMLElement>(focusableSelector)].filter(
      (element) => !element.closest('[hidden]') && !element.closest('[inert]'),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const root = top.element.getRootNode();
    const active = root instanceof ShadowRoot || root instanceof Document ? root.activeElement : null;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && (active === first || !top.element.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !top.element.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
}

/** One action of a dialog. */
export interface TalqynDialogAction {
  readonly label: string;
  /** `cancel` is what Escape and the backdrop do; `destructive` is drawn in the error color. */
  readonly role?: 'default' | 'cancel' | 'destructive';
  readonly handler?: () => void;
}

/** Presents an alert: a title, a message, and actions. Every action closes it. */
export function presentDialog(
  overlay: TalqynOverlay,
  init: { readonly title?: string; readonly message: string; readonly actions: readonly TalqynDialogAction[] },
): TalqynPresentation {
  const dialog = h('div', 'tq-dialog');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  if (init.title) {
    const title = h('h2', 'tq-dialog-title tq-font-headline', [init.title]);
    dialog.appendChild(title);
    dialog.setAttribute('aria-label', init.title);
  }
  const message = h('p', 'tq-dialog-message tq-font-body', [init.message]);
  dialog.appendChild(message);
  if (!init.title) dialog.setAttribute('aria-label', init.message);

  let presentation: TalqynPresentation | undefined;
  const run = (action: TalqynDialogAction | undefined): void => {
    presentation?.dismiss();
    action?.handler?.();
  };
  const actions = h('div', 'tq-dialog-actions');
  let focus: HTMLElement | undefined;
  for (const action of init.actions) {
    const element = button('tq-dialog-action', [action.label]);
    if (action.role) element.dataset['role'] = action.role;
    element.addEventListener('click', () => run(action));
    actions.appendChild(element);
    if (action.role !== 'cancel' && !focus) focus = element;
  }
  dialog.appendChild(actions);

  const cancel = init.actions.find((action) => action.role === 'cancel');
  presentation = overlay.present(dialog, {
    backdrop: true,
    focus: focus ?? (actions.firstElementChild as HTMLElement | null) ?? undefined,
    onDismissRequest: () => run(cancel),
  });
  return presentation;
}

/** One item of a menu. */
export interface TalqynMenuItem {
  readonly label: string;
  readonly icon?: TalqynIcon;
  readonly handler: () => void;
}

/**
 * Presents a small menu next to a point of the layer — what a long press or a right click on the shopper's
 * own message brings up. Choosing an item, Escape, or a tap anywhere else closes it.
 *
 * @param at The point to open at, in the layer's coordinates.
 */
export function presentMenu(
  overlay: TalqynOverlay,
  layer: HTMLElement,
  at: { readonly x: number; readonly y: number },
  items: readonly TalqynMenuItem[],
): TalqynPresentation {
  const menu = h('div', 'tq-menu');
  menu.setAttribute('role', 'menu');
  let presentation: TalqynPresentation | undefined;
  for (const item of items) {
    const element = button('tq-menu-item tq-font-body', [item.icon ? iconSlot(item.icon) : null, h('span', null, [item.label])]);
    element.setAttribute('role', 'menuitem');
    element.addEventListener('click', () => {
      presentation?.dismiss();
      item.handler();
    });
    menu.appendChild(element);
  }

  // Fills the layer to catch a tap outside the menu; `present` adds the `tq-presentation` wrapper itself.
  const catcher = h('div', 'tq-menu-catcher');
  catcher.appendChild(menu);
  catcher.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target as Node)) presentation?.dismiss();
  });
  presentation = overlay.present(catcher, { onDismissRequest: () => presentation?.dismiss() });

  // Placed after layout: the menu keeps inside the layer, flipping above or to the left near an edge.
  const bounds = layer.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const x = Math.max(8, Math.min(at.x, bounds.width - width - 8));
  const y = at.y + height + 8 > bounds.height ? Math.max(8, at.y - height) : at.y;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  return { element: menu, dismiss: () => presentation?.dismiss() };
}
