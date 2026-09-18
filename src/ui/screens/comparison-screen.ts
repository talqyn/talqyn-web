import type { TalqynPriceFormatter, TalqynUiStrings } from '../../consultant-core/index.js';
import type { TalqynComparisonTable, TalqynProduct } from '../../sdk/index.js';
import { iconButton } from '../components/controls.js';
import { TalqynRemoteImage } from '../components/remote-image.js';
import { button, clear, h, setHidden } from '../support/dom.js';
import type { TalqynImageLoader } from '../support/image-loader.js';
import type { TalqynTheme } from '../theme.js';
import { TalqynComparisonModel, type TalqynComparisonColumn } from './comparison-model.js';

/** What {@link TalqynComparisonScreen} is built from. */
export interface TalqynComparisonScreenOptions {
  /** The table the consultant proposed. */
  readonly table: TalqynComparisonTable;
  /** The conversation's products by Talqyn id, for the headers. */
  readonly products: ReadonlyMap<number, TalqynProduct>;
  readonly theme: TalqynTheme;
  readonly strings: TalqynUiStrings;
  readonly priceFormatter: TalqynPriceFormatter;
  readonly imageLoader: TalqynImageLoader;
  /** A product header was tapped. Whoever presented the screen closes it. */
  readonly onOpenProduct: (product: TalqynProduct) => void;
  /** The shopper closed the screen. */
  readonly onClose: () => void;
}

/**
 * A comparison table: product headers across the top, characteristics down the side, values in between.
 *
 * The characteristic column stays put while the values scroll sideways, and the headers stay put while
 * they scroll down — one table in one scroll container, with the header row and the label column sticky,
 * so the three can never drift apart. "Only differences" hides the rows where every product says the same
 * thing.
 */
export class TalqynComparisonScreen {
  readonly element: HTMLDivElement;

  private readonly model: TalqynComparisonModel;
  private readonly scroller: HTMLDivElement;
  private readonly table: HTMLTableElement;
  private readonly body: HTMLTableSectionElement;
  private readonly empty: HTMLParagraphElement;
  private readonly differencesButton: HTMLButtonElement;
  private readonly resizeObserver: ResizeObserver | undefined;
  private showsOnlyDifferences = false;
  private columnWidth = 0;
  private isDisposed = false;

  constructor(private readonly options: TalqynComparisonScreenOptions) {
    const { strings, theme } = options;
    this.model = TalqynComparisonModel.create(options.table, options.products);

    this.differencesButton = button('tq-text-button tq-hit tq-comparison-differences', [
      h('span', 'tq-comparison-differences-label', [strings.comparisonOnlyDifferences]),
    ]);
    this.differencesButton.setAttribute('aria-pressed', 'false');
    this.differencesButton.addEventListener('click', () => this.toggleDifferences());
    // Nothing to narrow down when every row already says the same thing for every product.
    setHidden(this.differencesButton, !TalqynComparisonModel.hasDifferences(this.model));

    const header = h('div', 'tq-screen-header tq-comparison-header', [
      h('div', 'tq-screen-header-leading', [this.differencesButton]),
      h('h2', 'tq-screen-header-title tq-font-headline', [strings.comparisonTitle]),
      h('div', 'tq-screen-header-trailing', [iconButton(theme.icons.close, strings.close, () => this.options.onClose())]),
    ]);

    const columns = this.model.columns;
    const labelColumn = h('col');
    labelColumn.style.width = `${TalqynComparisonModel.labelColumnWidth}px`;
    const colgroup = h('colgroup', null, [labelColumn, ...columns.map(() => h('col', 'tq-comparison-value-column'))]);
    const headerRow = h('tr', null, [h('td', 'tq-comparison-corner'), ...columns.map((column) => this.productHeader(column))]);
    this.body = h('tbody');
    this.table = h('table', 'tq-comparison-table', [colgroup, h('thead', null, [headerRow]), this.body]);
    this.table.setAttribute('aria-label', strings.comparisonTitle);
    this.table.style.setProperty('--tq-comparison-columns', String(columns.length));
    this.applyColumnWidth(TalqynComparisonModel.minColumnWidth);

    this.empty = h('p', 'tq-comparison-empty tq-font-callout', [strings.comparisonNoDifferences]);
    this.empty.hidden = true;
    this.scroller = h('div', 'tq-comparison-scroll', [this.table, this.empty]);

    this.element = h('div', 'tq-fullscreen tq-comparison', [header, this.scroller]);
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', strings.comparisonTitle);

    this.reloadRows();

    // The columns share the width, so they are laid out again whenever it changes: a rotation, a window
    // resized, a panel the site opened next to the screen.
    if (typeof ResizeObserver === 'undefined') {
      this.resizeObserver = undefined;
      window.addEventListener('resize', this.layoutColumns);
      requestAnimationFrame(this.layoutColumns);
    } else {
      this.resizeObserver = new ResizeObserver(this.layoutColumns);
      this.resizeObserver.observe(this.scroller);
    }
  }

  /** Stops following the screen's width. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.resizeObserver?.disconnect();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.layoutColumns);
  }

  private productHeader(column: TalqynComparisonColumn): HTMLTableCellElement {
    const image = new TalqynRemoteImage(this.options.theme, this.options.imageLoader, 'tq-comparison-image');
    image.set(column.product?.imageUrl, { width: 64, height: 64 });
    const title = h('span', 'tq-comparison-card-title tq-font-caption-bold', [column.title]);

    const product = column.product;
    let card: HTMLElement;
    if (product) {
      const tappable = button('tq-comparison-card tq-pressable', [image.element, title], column.title);
      tappable.addEventListener('click', () => this.options.onOpenProduct(product));
      card = tappable;
    } else {
      // An id with no card behind it has nothing to open: the column is headed, not tappable.
      card = h('div', 'tq-comparison-card', [image.element, title]);
    }

    const cell = h('th', 'tq-comparison-product', [card]);
    cell.setAttribute('scope', 'col');
    return cell;
  }

  private reloadRows(): void {
    const shown = this.showsOnlyDifferences ? TalqynComparisonModel.keepingOnlyDifferences(this.model) : this.model;
    clear(this.body);
    // A table needs two columns to compare anything.
    if (shown.columns.length >= 2) {
      for (const entry of shown.rows) {
        const label = h('th', 'tq-comparison-label tq-font-caption-bold', [TalqynComparisonModel.capitalized(entry.row.label)]);
        label.setAttribute('scope', 'row');
        const cells = shown.columns.map((_, index) =>
          h('td', `tq-comparison-value ${entry.isPrice ? 'tq-font-caption-bold' : 'tq-font-caption'}`, [
            TalqynComparisonModel.cellText(entry, index, this.options.priceFormatter),
          ]),
        );
        this.body.appendChild(h('tr', null, [label, ...cells]));
      }
    }
    setHidden(this.body, shown.rows.length === 0);
    setHidden(this.empty, shown.rows.length > 0);
    this.differencesButton.setAttribute('aria-pressed', String(this.showsOnlyDifferences));
  }

  private toggleDifferences(): void {
    this.showsOnlyDifferences = !this.showsOnlyDifferences;
    this.scroller.scrollTop = 0;
    this.reloadRows();
  }

  private readonly layoutColumns = (): void => {
    if (this.isDisposed) return;
    const width = this.scroller.clientWidth;
    if (width <= 0) return;
    this.applyColumnWidth(TalqynComparisonModel.columnWidth(this.model.columns.length, width));
  };

  private applyColumnWidth(width: number): void {
    if (width === this.columnWidth) return;
    this.columnWidth = width;
    this.table.style.setProperty('--tq-comparison-column', `${width}px`);
  }
}
