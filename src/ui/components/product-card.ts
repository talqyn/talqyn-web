import type { TalqynPriceFormatter, TalqynUiStrings } from '../../consultant-core/index.js';
import { TalqynProduct } from '../../sdk/index.js';
import { h, iconSlot, isInteractiveEvent, setHidden, setIcon, setText, uniqueId } from '../support/dom.js';
import type { TalqynImageLoader } from '../support/image-loader.js';
import { tapFeedback } from '../support/platform.js';
import type { TalqynTheme } from '../theme.js';
import { TalqynRemoteImage } from './remote-image.js';

/** How a product card is laid out where it is shown — what the site is told when it draws the card itself. */
export type TalqynProductCardLayout =
  /** Image on the left, details on the right, the full width of the transcript: a product cited in the text. */
  | 'horizontal'
  /** Image over the details: a tile in the carousel under the answer, or one of a pair cited by one sentence. */
  | 'vertical';

/**
 * The site's own product card: an element for the product in the layout, or `null` / `undefined` for the
 * SDK's card — the choice may differ by product or by layout.
 *
 * Called when a card comes up, and again only when the product under it changes: an update of the turn
 * around it — a rating, a new paragraph — keeps the element, so state of its own, a product just added to
 * the cart, survives. Return a new element on every call; one element can stand in one place only.
 *
 * The element is put into the page's own DOM, as a child of the screen's element projected through a
 * `<slot>`, so the site's stylesheets reach it the way they reach anything else on the page. The SDK sets
 * the width — the transcript's for a horizontal card, the tile's for a vertical one unless the element's
 * own CSS fixes another — and takes the height from the element; the two cards of a pair are stretched to
 * one height.
 *
 * The SDK handles a click on the card: it reports the click to Talqyn and calls `onOpenProduct`, so the
 * element must not open the product itself. Buttons, links, and inputs inside it keep working as usual —
 * a click on them does not open the product; mark any other element that must not open it with
 * `data-talqyn-no-open`.
 */
export type TalqynProductCardRenderer = (
  product: TalqynProduct,
  layout: TalqynProductCardLayout,
) => HTMLElement | null | undefined;

/** Where the SDK places a card: a row in the text, a tile in the carousel, a tile of a pair. */
export type TalqynCardPlacement = 'row' | 'compact' | 'tile';

/** What every card of a screen is drawn with. */
export interface TalqynCardContext {
  readonly theme: TalqynTheme;
  readonly strings: TalqynUiStrings;
  readonly price: TalqynPriceFormatter;
  readonly imageLoader: TalqynImageLoader;
  /** The element of the screen: the site's cards are its children, slotted into the shadow tree. */
  readonly slotHost: HTMLElement;
  /** The site's renderer as of now: callbacks can be swapped after the screen is built. */
  readonly renderer: () => TalqynProductCardRenderer | undefined;
}

/** A product's card in the transcript, whichever side drew it. */
export interface TalqynProductCard {
  readonly element: HTMLElement;
  readonly placement: TalqynCardPlacement;
  readonly product: TalqynProduct;
  onTap: (() => void) | undefined;
}

/** Marks the site's card elements among the children of the screen's element. */
const SITE_CARD_ATTRIBUTE = 'data-talqyn-card';

/** The score, the stars, and the review count — or "no reviews". */
class TalqynRatingView {
  readonly element: HTMLDivElement;
  private readonly score = h('span', 'tq-rating-score tq-font-caption-bold');
  private readonly stars: HTMLSpanElement[];
  private readonly starsGroup: HTMLSpanElement;
  private readonly reviews = h('span', 'tq-rating-reviews tq-font-caption');
  private readonly formatter: Intl.NumberFormat;

  constructor(
    private readonly theme: TalqynTheme,
    private readonly strings: TalqynUiStrings,
  ) {
    // The score is written the way the copy's language writes a number: `4,8` on a Russian screen,
    // whatever the browser is set to. A browser without data for the copy's locale — Chrome ships none
    // for Kazakh — would write it the English way; Kazakhstan's Russian writes it as Kazakh does.
    this.formatter = new Intl.NumberFormat([strings.locale, 'ru-KZ'], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    this.stars = Array.from({ length: 5 }, () => iconSlot(theme.icons.ratingStar, 'tq-icon tq-rating-star'));
    this.starsGroup = h('span', 'tq-rating-stars', this.stars);
    this.element = h('div', 'tq-rating', [this.score, this.starsGroup, this.reviews]);
  }

  update(rating: number | undefined, reviews: number): void {
    const hasRating = (rating ?? 0) > 0 && reviews > 0;
    setText(this.score, this.formatter.format(rating ?? 0));
    setHidden(this.score, !hasRating);
    setHidden(this.starsGroup, !hasRating);
    const filled = Math.round(rating ?? 0);
    this.stars.forEach((star, index) => {
      setIcon(star, index < filled ? this.theme.icons.ratingStarFilled : this.theme.icons.ratingStar);
    });
    setText(this.reviews, hasRating ? `(${reviews})` : this.strings.noReviews);
  }
}

/** The size an image is drawn at, for a loader that asks its CDN for a fitting variant. */
function imageSize(context: TalqynCardContext, placement: TalqynCardPlacement): { width: number; height: number } {
  const metrics = context.theme.metrics;
  switch (placement) {
    case 'row':
      return { width: metrics.rowCardImageSize, height: metrics.rowCardImageSize };
    case 'compact':
      return { width: metrics.compactCardWidth - 20, height: metrics.compactCardWidth - 20 };
    case 'tile':
      return { width: metrics.compactCardWidth, height: 96 };
  }
}

/**
 * The SDK's card: a horizontal row for a citation, a compact tile for the carousel under a turn, a
 * flexible tile for a pair of cited products side by side.
 *
 * A product the response marked as out of stock is dimmed and says so under the price; a product the
 * response said nothing about is shown as usual.
 */
class TalqynSdkProductCard implements TalqynProductCard {
  readonly element: HTMLDivElement;
  onTap: (() => void) | undefined;
  private current: TalqynProduct | undefined;
  private readonly image: TalqynRemoteImage;
  private readonly title = h('div', 'tq-card-title');
  private readonly rating: TalqynRatingView;
  private readonly price = h('span', 'tq-price');
  private readonly oldPrice = h('s', 'tq-old-price');
  private readonly stock = h('div', 'tq-card-stock tq-font-caption-bold');

  constructor(
    private readonly context: TalqynCardContext,
    readonly placement: TalqynCardPlacement,
  ) {
    const { theme, strings } = context;
    const isRow = placement === 'row';
    this.image = new TalqynRemoteImage(theme, context.imageLoader, 'tq-card-image');
    this.rating = new TalqynRatingView(theme, strings);
    this.title.classList.add(isRow ? 'tq-font-callout' : 'tq-font-caption');
    this.price.classList.add(isRow ? 'tq-font-headline' : 'tq-font-label');
    this.oldPrice.classList.add(isRow ? 'tq-font-footnote' : 'tq-font-caption');
    this.stock.textContent = strings.outOfStock;
    this.stock.hidden = true;
    const details = h('div', 'tq-card-details', [
      this.title,
      this.rating.element,
      h('div', 'tq-price-row', [this.price, this.oldPrice]),
      this.stock,
    ]);
    this.element = h('div', `tq-card tq-card--${placement} tq-pressable`, [this.image.element, details]);
    this.element.setAttribute('role', 'button');
    this.element.tabIndex = 0;
    this.element.addEventListener('click', () => {
      tapFeedback(theme);
      this.onTap?.();
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.onTap?.();
    });
  }

  get product(): TalqynProduct {
    return this.current!;
  }

  set(product: TalqynProduct): void {
    if (product === this.current) return;
    this.current = product;
    const { price, strings } = this.context;
    this.image.set(product.imageUrl, imageSize(this.context, this.placement));
    setText(this.title, product.title);
    this.rating.update(product.rating, product.reviewsCount);

    const hasPrice = (product.price ?? 0) > 0;
    setHidden(this.price, !hasPrice);
    setText(this.price, product.price === undefined ? '' : price.format(product.price));
    const hasOldPrice = TalqynProduct.hasDiscount(product) && product.priceBefore !== undefined;
    setHidden(this.oldPrice, !hasOldPrice);
    setText(this.oldPrice, hasOldPrice && product.priceBefore !== undefined ? price.format(product.priceBefore) : '');

    const isOutOfStock = product.inStock === false;
    setHidden(this.stock, !isOutOfStock);
    if (isOutOfStock) this.element.dataset['outOfStock'] = '';
    else delete this.element.dataset['outOfStock'];

    const parts = [product.title];
    if (hasPrice && product.price !== undefined) parts.push(price.format(product.price));
    if (isOutOfStock) parts.push(strings.outOfStock);
    this.element.setAttribute('aria-label', parts.join(', '));
  }
}

/**
 * The site's card in the SDK's frame. Clickable like the SDK's own card, so the click is reported and the
 * product opened the same way; sized by the transcript, so the site's element only has to fill it.
 *
 * The frame draws nothing — no background, no rounding, no clipping — so the element's own corners and
 * shadow are what the shopper sees, and it is the element that screen readers and the keyboard meet. The
 * element itself lives in the page's DOM, next to the other cards of the screen, and shows through the
 * frame's slot.
 */
class TalqynSiteProductCard implements TalqynProductCard {
  readonly element: HTMLDivElement;
  onTap: (() => void) | undefined;
  private current: TalqynProduct | undefined;
  private view: HTMLElement | undefined;
  private readonly slotName = uniqueId('tq-card');

  constructor(
    private readonly context: TalqynCardContext,
    readonly placement: TalqynCardPlacement,
  ) {
    const slot = h('slot');
    slot.name = this.slotName;
    this.element = h('div', `tq-site-card tq-site-card--${placement}`, [slot]);
    this.element.addEventListener('click', (event) => {
      if (isInteractiveEvent(event, this.element)) return;
      tapFeedback(context.theme);
      this.onTap?.();
    });
  }

  get product(): TalqynProduct {
    return this.current!;
  }

  set(product: TalqynProduct, view: HTMLElement): void {
    this.current = product;
    if (view === this.view && view.slot === this.slotName && view.parentNode === this.context.slotHost) return;
    if (this.view && this.view !== view && this.view.slot === this.slotName) this.view.remove();
    this.view = view;
    view.slot = this.slotName;
    view.setAttribute(SITE_CARD_ATTRIBUTE, '');
    if (view.parentNode !== this.context.slotHost) this.context.slotHost.appendChild(view);
  }
}

/** The site's element for a product, or `undefined` for the SDK's card. A renderer that throws gets the SDK's card: one broken card must not take the transcript down with it. */
function siteView(context: TalqynCardContext, product: TalqynProduct, placement: TalqynCardPlacement): HTMLElement | undefined {
  const renderer = context.renderer();
  if (!renderer) return undefined;
  try {
    return renderer(product, placement === 'row' ? 'horizontal' : 'vertical') ?? undefined;
  } catch (error) {
    reportSiteError(error);
    return undefined;
  }
}

/** Reports an exception from the site's code without throwing it into the SDK's own. */
export function reportSiteError(error: unknown): void {
  const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (typeof report === 'function') report(error);
  else console.error(error);
}

/**
 * A product's card: the site's, when its renderer draws one for the product, otherwise the SDK's. A
 * product's previous card is reused when it is of the same kind and placement.
 *
 * @param previous The card the product had, if any; reused when it fits.
 */
export function productCard(
  context: TalqynCardContext,
  product: TalqynProduct,
  placement: TalqynCardPlacement,
  previous: TalqynProductCard | undefined,
): TalqynProductCard {
  const reusable = previous?.placement === placement ? previous : undefined;
  const view = siteView(context, product, placement);
  if (view) {
    const card = reusable instanceof TalqynSiteProductCard ? reusable : new TalqynSiteProductCard(context, placement);
    card.set(product, view);
    return card;
  }
  const card = reusable instanceof TalqynSdkProductCard ? reusable : new TalqynSdkProductCard(context, placement);
  card.set(product);
  return card;
}

/**
 * Takes the site's card elements whose frame is gone out of the page: a card dropped from the transcript
 * leaves its element behind among the children of the screen's element, with no slot to show through.
 *
 * @param all Whether to take every card element, framed or not: the screen is going away.
 */
export function sweepSiteCards(host: HTMLElement, all = false): void {
  const root = host.shadowRoot;
  for (const child of Array.from(host.children)) {
    if (!child.hasAttribute(SITE_CARD_ATTRIBUTE)) continue;
    // The frame's slot is looked up rather than `assignedSlot` read: a frame dropped from the shadow tree
    // takes its slot with it either way, and the lookup needs nothing of the browser's slotting.
    const isFramed = !all && root !== null && child.slot !== '' && root.querySelector(`slot[name="${child.slot}"]`) !== null;
    if (!isFramed) child.remove();
  }
}
