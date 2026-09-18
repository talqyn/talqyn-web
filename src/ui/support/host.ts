import { TalqynOverlay } from '../components/overlay.js';
import { TalqynAdaptiveLayout, type TalqynLayoutMode } from '../layout.js';
import { applyTheme, type TalqynTheme } from '../theme.js';
import { h } from './dom.js';

/**
 * `HTMLElement` where there is one, a stand-in where there is not: importing the UI during server-side
 * rendering must not throw, even though nothing can be drawn there.
 */
export const TalqynElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

const sheets = new Map<string, CSSStyleSheet>();

function canAdoptSheets(root: ShadowRoot): boolean {
  return (
    typeof CSSStyleSheet !== 'undefined' &&
    'adoptedStyleSheets' in root &&
    typeof (CSSStyleSheet.prototype as { replaceSync?: unknown }).replaceSync === 'function'
  );
}

/** Puts a stylesheet into a shadow root — one shared constructable sheet per stylesheet where the browser has them. */
function adoptStyles(root: ShadowRoot, css: string): void {
  if (canAdoptSheets(root)) {
    try {
      let sheet = sheets.get(css);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        sheets.set(css, sheet);
      }
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // Fall back to a style element.
    }
  }
  const style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);
}

/**
 * The frame every SDK screen is drawn in: a shadow root on its host element, the stylesheet, the theme's
 * custom properties on the host, and a layer for what the screen presents over itself.
 *
 * ```
 * <host> #shadow-root
 *   div.tq-root          ← `content` goes in here; inert while a layer is up
 *   div.tq-layer         ← sheets, dialogs, menus, full-screen views
 *   div.tq-live          ← polite announcements for screen readers
 * ```
 */
export class TalqynScreenHost {
  readonly shadow: ShadowRoot;
  readonly root: HTMLDivElement;
  readonly layer: HTMLDivElement;
  readonly overlay: TalqynOverlay;
  private readonly live: HTMLDivElement;

  constructor(
    readonly host: HTMLElement,
    css: string,
  ) {
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
    adoptStyles(this.shadow, css);
    this.root = h('div', 'tq-root');
    this.layer = h('div', 'tq-layer');
    this.live = h('div', 'tq-visually-hidden');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.shadow.append(this.root, this.layer, this.live);
    this.overlay = new TalqynOverlay(this.layer, this.root);
  }

  applyTheme(theme: TalqynTheme): void {
    applyTheme(this.host, theme);
  }

  /**
   * Puts the shape and its widths on the host element, where the stylesheet reads them through
   * `:host([data-layout='regular'])`.
   *
   * On the host rather than on a layer: a layer is built long after the screen, and the attribute has to
   * be in place before anything is presented. It is also the one place a site can read the shape back
   * from, or watch with a `MutationObserver`.
   */
  applyLayout(mode: TalqynLayoutMode, layout: TalqynAdaptiveLayout): void {
    this.host.dataset['layout'] = mode;
    for (const [property, value] of Object.entries(TalqynAdaptiveLayout.properties(layout))) {
      this.host.style.setProperty(property, value);
    }
  }

  /** Says something to screen readers without moving focus. The same words twice are announced twice. */
  announce(text: string): void {
    this.live.textContent = this.live.textContent === text ? `${text} ` : text;
  }

  /** Empties the shadow root. */
  dispose(): void {
    this.overlay.dismissAll();
    while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
  }
}

/** Defines a custom element once: a second copy of the SDK on a page must not throw on the name. */
export function defineElement(name: string, constructor: CustomElementConstructor): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(name)) customElements.define(name, constructor);
}
