import { encodeJson } from '../internal/json.js';
import type { TalqynLocale } from '../locale.js';

/** Where a shopper's action took place. */
export type TalqynEventSource = 'instant' | 'full' | 'cip' | 'start';

export const TalqynEventSource = {
  /** The search field's dropdown. */
  instant: 'instant',
  /** A listing page. */
  full: 'full',
  /** The consultant's results. Not valid for a search-submit event. */
  consultant: 'cip',
  /**
   * The start screen of an empty search field — `talqyn.search.start`. Not valid for a search-submit
   * event: the screen has no query to submit.
   *
   * A tap here is counted apart from the rest on purpose. The screen's own products come from the
   * most-clicked list, so feeding these clicks back would let it rank itself; they stay out of search
   * ranking entirely.
   */
  start: 'start',
} as const;

/** A shopper tapped a product card. */
export interface TalqynProductClickEvent {
  /**
   * The impression the click belongs to — the `searchId` of the search response, the listing page, the
   * start screen, or the consultant's products. Without it a click has no denominator and click-through
   * cannot be computed. A click from deep pagination legitimately arrives without one, since only the
   * first page carries an id.
   */
  readonly searchId?: string | undefined;
  /** Talqyn's internal product id — `talqynId`, not your SKU. */
  readonly talqynId: number;
  /** The zero-based position in the results. For the consultant, the index in the turn's flattened product list, exactly as rendered. */
  readonly position: number;
  /** Where the click happened. */
  readonly source: TalqynEventSource;
  /** The storefront's A/B bucket. Filled from the client default when unset. */
  readonly variant?: string | undefined;
}

/**
 * A shopper submitted a search query.
 *
 * Not optional analytics: the `history` blocks of instant search and of the start screen are assembled
 * from these rows. A storefront running on a device token has to report them itself — by definition
 * there is no backend of yours in the chain to do it.
 */
export interface TalqynSearchSubmitEvent {
  /** The query as submitted. 1–500 characters. */
  readonly query: string;
  /**
   * Where it was submitted from. Only `instant` and `full` are accepted: a query picked on the start
   * screen takes the source of the results it opens.
   */
  readonly source: TalqynEventSource;
  /** The language searched in. Filled from the client default when unset. */
  readonly locale?: TalqynLocale | undefined;
  /** How many results came back, if known. */
  readonly resultsCount?: number | undefined;
  /** The storefront's A/B bucket. Filled from the client default when unset. */
  readonly variant?: string | undefined;
}

/** A shopper tapped a category — in a search response's navigation block or on the start screen. */
export interface TalqynCategoryClickEvent {
  /** The category tapped — `TalqynCategory.id`. */
  readonly categoryId: number;
  /** The query whose results the category appeared in. Unset on the start screen, which has no query. */
  readonly query?: string | undefined;
  /** The storefront's A/B bucket. Filled from the client default when unset. */
  readonly variant?: string | undefined;
}

export function encodeProductClickEvent(event: TalqynProductClickEvent): string {
  return encodeJson({
    search_id: event.searchId ?? undefined,
    talqyn_id: event.talqynId,
    position: event.position,
    source: event.source,
    variant: event.variant ?? undefined,
  });
}

export function encodeSearchSubmitEvent(event: TalqynSearchSubmitEvent): string {
  return encodeJson({
    query: event.query,
    source: event.source,
    locale: event.locale ?? undefined,
    results_count: event.resultsCount ?? undefined,
    variant: event.variant ?? undefined,
  });
}

export function encodeCategoryClickEvent(event: TalqynCategoryClickEvent): string {
  return encodeJson({
    category_id: event.categoryId,
    query: event.query ?? undefined,
    variant: event.variant ?? undefined,
  });
}
