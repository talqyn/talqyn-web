import { tapFeedback } from '../support/platform.js';
import { button, h, iconSlot, setIcon } from '../support/dom.js';
import type { TalqynIcon, TalqynTheme } from '../theme.js';

/**
 * A pill-shaped chip: suggestions, clarify options, examples, feedback reasons.
 *
 * Drawn at the theme's chip height and wrapping onto up to three lines inside the row it sits in; its hit
 * area reaches 4px above and below, so a 36-pixel chip still takes a 44-pixel tap and rows 8px apart never
 * overlap.
 */
export function chip(
  theme: TalqynTheme,
  title: string,
  options: { readonly selected?: boolean; readonly onTap?: () => void } = {},
): HTMLButtonElement {
  const element = button('tq-chip', [h('span', null, [title])]);
  if (options.selected !== undefined) element.setAttribute('aria-pressed', String(options.selected));
  element.addEventListener('click', () => {
    tapFeedback(theme);
    options.onTap?.();
  });
  return element;
}

/** Lays chips out left to right, wrapping onto new rows, optionally centered. */
export function chipFlow(chips: readonly HTMLElement[], options: { readonly centered?: boolean } = {}): HTMLDivElement {
  const flow = h('div', 'tq-chips', chips);
  if (options.centered) flow.dataset['centered'] = '';
  return flow;
}

/** A filled or outlined pill: "continue", "open results". */
export function pillButton(
  title: string,
  onTap: () => void,
  options: { readonly style?: 'accent' | 'outline'; readonly height?: number } = {},
): HTMLButtonElement {
  const element = button('tq-pill-button', [title]);
  if (options.style === 'outline') element.dataset['style'] = 'outline';
  if (options.height !== undefined) element.style.minHeight = `${options.height}px`;
  element.addEventListener('click', onTap);
  return element;
}

/** A button that is only its label, in the accent. */
export function textButton(title: string, onTap: () => void): HTMLButtonElement {
  const element = button('tq-text-button tq-hit', [title]);
  element.addEventListener('click', onTap);
  return element;
}

/** A round 44-pixel button with a theme icon and a spoken label. */
export function iconButton(icon: TalqynIcon, label: string, onTap: () => void): HTMLButtonElement {
  const element = button('tq-icon-button', [iconSlot(icon)], label);
  element.title = label;
  element.addEventListener('click', onTap);
  return element;
}

/** Changes the icon of a button made by {@link iconButton}. */
export function setButtonIcon(element: HTMLButtonElement, icon: TalqynIcon): void {
  const slot = element.querySelector<HTMLElement>('.tq-icon');
  if (slot) setIcon(slot, icon);
}
