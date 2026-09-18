import { encodeJson } from '../internal/json.js';
import type { TalqynLocale, TalqynSort } from '../locale.js';
import { TalqynFullSearchResponse } from './search-models.js';

/**
 * A request for instant search (`POST /v1/search/`).
 *
 * Fields left unset are filled from the client's defaults — locale, place, and A/B bucket. A value
 * set here always wins.
 */
export interface TalqynSearchQuery {
  /** What the shopper typed. 1–500 characters, non-empty after trimming. */
  readonly query: string;
  /** The language to search in. Unset uses the client default. */
  readonly locale?: TalqynLocale | undefined;
  /** How many products to return. 1–50. Defaults to 20. */
  readonly limit?: number | undefined;
  /** Restricts results to one category. */
  readonly categoryId?: number | undefined;
  /** Restricts results to one brand. */
  readonly brandId?: number | undefined;
  /** The lower price bound. Must not exceed {@link priceMax}. */
  readonly priceMin?: number | undefined;
  /** The upper price bound. */
  readonly priceMax?: number | undefined;
  /** Whether to drop out-of-stock products. Defaults to `false`. */
  readonly inStockOnly?: boolean | undefined;
  /**
   * The shopper's city — the `id` of an option in the `city` group of `talqyn.search.filters`. An
   * unknown id is not an error: results quietly narrow to "available everywhere".
   */
  readonly cityId?: string | undefined;
  /** The shopper's store — the `id` of an option in the `location` group. Takes precedence over {@link cityId}. */
  readonly locationId?: string | undefined;
  /** The storefront's A/B bucket: echoed into analytics, no effect on results. */
  readonly variant?: string | undefined;
}

/**
 * The selection criteria shared by a listing and its filter panel.
 *
 * They are shared on the server too: `/v1/search/full` and `/v1/search/filters` accept one body, and
 * the two must not drift — a panel has to count against the same selection the listing displays.
 */
export interface TalqynFilterCriteria {
  /** What the shopper typed. 1–500 characters. */
  readonly query: string;
  /** The language to search in. Unset uses the client default. */
  readonly locale?: TalqynLocale | undefined;
  /** Restricts results to one category. */
  readonly categoryId?: number | undefined;
  /** Restricts results to one brand. */
  readonly brandId?: number | undefined;
  /** The lower price bound. */
  readonly priceMin?: number | undefined;
  /** The upper price bound. */
  readonly priceMax?: number | undefined;
  /** Whether to drop out-of-stock products. Defaults to `false`. */
  readonly inStockOnly?: boolean | undefined;
  /** Whether to keep only discounted products. Defaults to `false`. */
  readonly hasDiscount?: boolean | undefined;
  /**
   * Structural filters: `{group slug: [value slugs]}`. OR within a group, AND across groups. Slugs
   * come from `talqyn.search.filters`. The contract caps this at 20 keys, 50 values per key, and 100
   * characters per value.
   */
  readonly filters?: Readonly<Record<string, readonly string[]>> | undefined;
  /** The shopper's city, in your catalog's numbering. */
  readonly cityId?: string | undefined;
  /** The shopper's store, in your catalog's numbering. Beats {@link cityId}. */
  readonly locationId?: string | undefined;
}

/** A request for one page of a listing (`POST /v1/search/full`). */
export interface TalqynFullSearchQuery extends TalqynFilterCriteria {
  /** The page size. 1–100. Defaults to 20. */
  readonly limit?: number | undefined;
  /** Where the page starts. 0–10000. Defaults to 0. */
  readonly offset?: number | undefined;
  /** How to order the page. Defaults to `relevance`. */
  readonly sort?: TalqynSort | undefined;
  /** The storefront's A/B bucket. */
  readonly variant?: string | undefined;
}

/**
 * A request for facet counts (`POST /v1/search/filters`): the same body as a listing request, minus
 * paging and ordering — the panel counts across the whole selection, not one page of it.
 */
export type TalqynFiltersQuery = TalqynFilterCriteria;

export const TalqynFullSearchQuery = {
  /**
   * The same selection, shaped as a filter-panel request. Recomputing the criteria by hand for the
   * second call is how a panel ends up counting against a different selection than the one on screen.
   */
  filtersQuery(query: TalqynFullSearchQuery): TalqynFiltersQuery {
    return criteriaOf(query);
  },

  /**
   * This request advanced to the next page.
   *
   * @param response The page that just came back.
   * @returns A copy positioned at the next offset, or `undefined` when the listing is exhausted.
   */
  nextPage(query: TalqynFullSearchQuery, response: TalqynFullSearchResponse): TalqynFullSearchQuery | undefined {
    const offset = TalqynFullSearchResponse.nextOffset(response);
    return offset === undefined ? undefined : { ...query, offset };
  },
} as const;

/** A question for the consultant (`POST /v1/consultant/ask`). */
export interface TalqynConsultantQuery {
  /** The shopper's question. 1–2000 characters. */
  readonly question: string;
  /** The language to answer in. Unset uses the client default. */
  readonly locale?: TalqynLocale | undefined;
  /** The session of the previous turn, from its `done` event. Omit it to start a new conversation. */
  readonly sessionId?: string | undefined;
  /**
   * The shopper's city. Send it on **every** turn: a session does not remember a place, because a
   * shopper may change cities mid-conversation. The SDK fills this from the client default when unset.
   */
  readonly cityId?: string | undefined;
  /** The shopper's store. Sent per turn like {@link cityId}, and takes precedence over it. */
  readonly locationId?: string | undefined;
  /** The storefront's A/B bucket. */
  readonly variant?: string | undefined;
}

/** The criteria fields of a listing request, and nothing else. */
export function criteriaOf(query: TalqynFilterCriteria): TalqynFilterCriteria {
  return {
    query: query.query,
    locale: query.locale,
    categoryId: query.categoryId,
    brandId: query.brandId,
    priceMin: query.priceMin,
    priceMax: query.priceMax,
    inStockOnly: query.inStockOnly,
    hasDiscount: query.hasDiscount,
    filters: query.filters,
    cityId: query.cityId,
    locationId: query.locationId,
  };
}

/** `null` from a caller without types reads as unset, the way `undefined` does. */
function present<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function criteriaBody(criteria: TalqynFilterCriteria): Record<string, unknown> {
  const filters = criteria.filters && Object.keys(criteria.filters).length > 0 ? criteria.filters : undefined;
  return {
    query: criteria.query,
    locale: present(criteria.locale),
    category_id: present(criteria.categoryId),
    brand_id: present(criteria.brandId),
    price_min: present(criteria.priceMin),
    price_max: present(criteria.priceMax),
    in_stock_only: criteria.inStockOnly ?? false,
    has_discount: criteria.hasDiscount ?? false,
    filters,
    city_id: present(criteria.cityId),
    location_id: present(criteria.locationId),
  };
}

/** The instant-search body, omitting every field left unset. */
export function encodeSearchQuery(query: TalqynSearchQuery): string {
  return encodeJson({
    query: query.query,
    locale: present(query.locale),
    limit: query.limit ?? 20,
    category_id: present(query.categoryId),
    brand_id: present(query.brandId),
    price_min: present(query.priceMin),
    price_max: present(query.priceMax),
    in_stock_only: query.inStockOnly ?? false,
    city_id: present(query.cityId),
    location_id: present(query.locationId),
    variant: present(query.variant),
  });
}

/** The listing body, omitting unset fields and an empty `filters`. */
export function encodeFullSearchQuery(query: TalqynFullSearchQuery): string {
  return encodeJson({
    ...criteriaBody(query),
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
    sort: query.sort ?? 'relevance',
    variant: present(query.variant),
  });
}

/** The facet body, omitting unset fields and an empty `filters`. */
export function encodeFiltersQuery(query: TalqynFiltersQuery): string {
  return encodeJson(criteriaBody(query));
}

/** The consultant body, omitting every field left unset. */
export function encodeConsultantQuery(query: TalqynConsultantQuery): string {
  return encodeJson({
    question: query.question,
    locale: present(query.locale),
    session_id: present(query.sessionId),
    city_id: present(query.cityId),
    location_id: present(query.locationId),
    variant: present(query.variant),
  });
}
