import type { TalqynProduct } from '../../sdk/index.js';
import { h, reorderChildren, setText } from '../support/dom.js';
import type { TalqynProductSection } from '../transcript/rows.js';
import { productCard, type TalqynCardContext, type TalqynProductCard } from './product-card.js';

interface SectionView {
  readonly element: HTMLDivElement;
  readonly header: HTMLDivElement;
  readonly track: HTMLDivElement;
  cards: TalqynProductCard[];
  products: readonly TalqynProduct[];
}

/**
 * Titled carousels: the products a turn found beyond the ones cited inline, one carousel per group of a
 * multi-step plan. A carousel starts at the transcript's margin, so the first card lines up with the text
 * above it.
 */
export class TalqynProductListView {
  readonly element = h('div', 'tq-product-list');
  private sections: SectionView[] = [];

  constructor(private readonly context: TalqynCardContext) {}

  update(sections: readonly TalqynProductSection[], onTap: (product: TalqynProduct) => void): void {
    this.element.hidden = sections.length === 0;
    while (this.sections.length > sections.length) this.sections.pop();
    sections.forEach((section, index) => {
      let view = this.sections[index];
      if (!view) {
        const header = h('div', 'tq-section-header tq-font-caption-bold');
        const track = h('div', 'tq-carousel-track');
        const scroller = h('div', 'tq-carousel', [track]);
        view = { element: h('div', 'tq-product-section', [header, scroller]), header, track, cards: [], products: [] };
        this.sections[index] = view;
      }
      setText(view.header, section.title);
      // Cards are rebuilt only when the products themselves change: a site's card keeps its own state — a
      // product just added to the cart — across the updates a turn goes through after it settled.
      if (!sameProducts(view.products, section.products)) {
        const previous = new Map(view.cards.map((card) => [card.product.talqynId, card]));
        view.cards = section.products.map((product) =>
          productCard(this.context, product, 'compact', previous.get(product.talqynId)),
        );
        view.products = section.products;
        reorderChildren(view.track, view.cards.map((card) => card.element));
      }
      view.cards.forEach((card) => {
        const product = card.product;
        card.onTap = () => onTap(product);
      });
    });
    reorderChildren(this.element, this.sections.map((view) => view.element));
  }
}

function sameProducts(a: readonly TalqynProduct[], b: readonly TalqynProduct[]): boolean {
  return a.length === b.length && a.every((product, index) => product === b[index]);
}
