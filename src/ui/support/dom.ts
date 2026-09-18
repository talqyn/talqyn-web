import type { TalqynIcon } from '../theme.js';

type Child = Node | string | null | undefined | false;

/** An element with a class and children: the handful of shapes the screens are built from. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  append(element, children);
  return element;
}

/** Appends children, skipping the empty ones; strings become text. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Removes every child. */
export function clear(element: Node): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/** Hides or shows, touching the DOM only when something changes. */
export function setHidden(element: HTMLElement | SVGElement, hidden: boolean): void {
  if (element instanceof HTMLElement) {
    if (element.hidden !== hidden) element.hidden = hidden;
  } else if (hidden) {
    element.setAttribute('hidden', '');
  } else {
    element.removeAttribute('hidden');
  }
}

/** Sets text, touching the DOM only when it changes. */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Sets or removes an attribute. */
export function setAttribute(element: Element, name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * Puts a theme icon into a slot: SVG markup inline, so `currentColor` paints it, or an image for a URL.
 * An empty role leaves the slot empty and hidden.
 */
export function setIcon(slot: HTMLElement, icon: TalqynIcon): void {
  if (slot.dataset['icon'] === (icon ?? '')) return;
  slot.dataset['icon'] = icon ?? '';
  clear(slot);
  if (!icon) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  if (icon.trimStart().startsWith('<')) {
    slot.innerHTML = icon;
  } else {
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    image.decoding = 'async';
    slot.appendChild(image);
  }
}

/** A span holding a theme icon. */
export function iconSlot(icon: TalqynIcon, className = 'tq-icon'): HTMLSpanElement {
  const slot = h('span', className);
  slot.setAttribute('aria-hidden', 'true');
  setIcon(slot, icon);
  return slot;
}

/** A button with the SDK's defaults: `type="button"`, so it never submits a form the screen happens to sit in. */
export function button(className: string, children: readonly Child[] = [], label?: string): HTMLButtonElement {
  const element = h('button', className, children);
  element.type = 'button';
  if (label !== undefined) element.setAttribute('aria-label', label);
  return element;
}

/**
 * Keeps a list of child elements in the order given, moving only what is out of place: an element that
 * stays keeps its focus, its selection, and its scroll position.
 */
export function reorderChildren(parent: HTMLElement, children: readonly HTMLElement[]): void {
  let cursor = parent.firstElementChild;
  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      parent.insertBefore(child, cursor);
    }
  }
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }
}

const interactiveSelector =
  'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"], [data-talqyn-no-open]';

/**
 * Whether an event landed on something interactive inside `container` rather than on the container
 * itself. Follows the composed path, so an element slotted into the container from the page counts as
 * inside it.
 */
export function isInteractiveEvent(event: Event, container: HTMLElement): boolean {
  for (const node of event.composedPath()) {
    if (node === container) return false;
    if (node instanceof Element && node.matches(interactiveSelector)) return true;
  }
  return false;
}

/** Whether keys pressed in `target` belong to it — typing, a button's Space — rather than to the page around it. */
export function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

let idCounter = 0;

/** An id unique on the page, for `aria-labelledby` and friends inside a shadow root. */
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
