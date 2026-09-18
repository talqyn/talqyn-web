import { TalqynPriceFormatter, TalqynUiStrings } from '../consultant-core/index.js';
import type { TalqynComparisonTable, TalqynProduct } from '../sdk/index.js';
import { remoteImageCss } from './components/remote-image.js';
import { TalqynComparisonScreen } from './screens/comparison-screen.js';
import { baseCss } from './styles/base.js';
import { comparisonCss } from './styles/comparison.js';
import { defineElement, TalqynElementBase, TalqynScreenHost } from './support/host.js';
import { TalqynImageLoader } from './support/image-loader.js';
import { TalqynTheme } from './theme.js';

/** The tag of the comparison element. */
export const TALQYN_COMPARISON_TAG = 'talqyn-comparison';

const css = baseCss + remoteImageCss + comparisonCss;

/** What a comparison drawn on its own is built from. */
export interface TalqynComparisonMountOptions {
  /** The table the consultant proposed. */
  readonly table: TalqynComparisonTable;
  /** The products by Talqyn id, for the headers — `conversation.state.productsById`. */
  readonly products: ReadonlyMap<number, TalqynProduct>;
  /** Colors, type, icons, and shapes. Defaults to the SDK's neutral theme. */
  readonly theme?: TalqynTheme;
  /** Copy. Defaults to Russian; the consultant screen passes its own. */
  readonly strings?: TalqynUiStrings;
  /** How prices are written. Defaults to tenge. */
  readonly priceFormatter?: TalqynPriceFormatter;
  /** Where product images load from. Defaults to the catalog's addresses. */
  readonly imageLoader?: TalqynImageLoader;
  /** A product header was tapped. */
  readonly onOpenProduct: (product: TalqynProduct) => void;
  /** The shopper closed the comparison. */
  readonly onClose: () => void;
}

/** A comparison put on a page. */
export interface TalqynComparisonHandle {
  readonly element: TalqynComparisonElement;
  /** Takes the comparison off the page. */
  destroy(): void;
}

/**
 * The comparison screen as a custom element, `<talqyn-comparison>`, for a site that shows a comparison
 * the consultant proposed somewhere of its own. The consultant screen opens its comparisons by itself.
 *
 * Configure it before or after it is connected; it draws itself inside a shadow root while it is on the
 * page.
 */
export class TalqynComparisonElement extends TalqynElementBase {
  private options: TalqynComparisonMountOptions | undefined;
  private screenHost: TalqynScreenHost | undefined;
  private screen: TalqynComparisonScreen | undefined;
  private removalCheck = 0;

  /** Sets what the element shows, drawing it again when it is on the page. */
  configure(options: TalqynComparisonMountOptions): void {
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
    // task is over takes the table down — a framework reparenting the element must not rebuild it.
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
    const screen = new TalqynComparisonScreen({
      table: options.table,
      products: options.products,
      theme,
      strings: options.strings ?? TalqynUiStrings.en,
      priceFormatter: options.priceFormatter ?? TalqynPriceFormatter.tenge,
      imageLoader: options.imageLoader ?? TalqynImageLoader.default,
      onOpenProduct: (product) => this.options?.onOpenProduct(product),
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

/** Registers `<talqyn-comparison>`. Safe to call more than once. */
export function defineTalqynComparisonElement(): void {
  defineElement(TALQYN_COMPARISON_TAG, TalqynComparisonElement);
}

/**
 * Draws a comparison inside `container`.
 *
 * ```ts
 * const handle = mountTalqynComparison(panel, {
 *   table,
 *   products: conversation.state.productsById,
 *   onOpenProduct: (product) => router.openProduct(product.externalId),
 *   onClose: () => handle.destroy(),
 * });
 * ```
 */
export function mountTalqynComparison(container: Element, options: TalqynComparisonMountOptions): TalqynComparisonHandle {
  defineTalqynComparisonElement();
  const element = document.createElement(TALQYN_COMPARISON_TAG) as TalqynComparisonElement;
  element.configure(options);
  container.appendChild(element);
  return { element, destroy: () => element.remove() };
}
