import { asRecord, decodeString, readArray, readInteger, readString } from '../internal/json.js';
import { decodeProduct, lenientUrl, type TalqynProduct } from './product.js';

/** A query completion offered under the search field. */
export interface TalqynSuggestion {
  /** The suggested query text. */
  readonly text: string;
  /** How heavily the suggestion is weighted in the corpus. Ordering is already applied by the server. */
  readonly weight: number;
  /**
   * The character offset at which the suggestion diverges from what the shopper typed: everything
   * before it is their input, everything after is the completion.
   */
  readonly highlightFrom: number;
}

/** A facet chip offered under the search field. */
export interface TalqynChip {
  /** The chip label, also the text to search for when it is tapped. */
  readonly text: string;
  /** How heavily the chip is weighted. Ordering is already applied by the server. */
  readonly weight: number;
}

/** A category in the navigation block of a search response. */
export interface TalqynCategory {
  /** The category id, as accepted by the `categoryId` request parameter. */
  readonly id: number;
  /** The category name in the requested locale. */
  readonly name: string;
  /** The category slug, when the catalog carries one. */
  readonly slug: string | undefined;
  /** The materialized tree path, for example `"1.42"`. */
  readonly path: string | undefined;
  /** The parent category's name, for disambiguating same-named leaves. */
  readonly parentName: string | undefined;
}

/** A brand in the navigation block of a search response. */
export interface TalqynBrand {
  /** The brand id, as accepted by the `brandId` request parameter. */
  readonly id: number;
  /** The brand's display name. */
  readonly name: string;
  /** The brand slug, as accepted by `filters.brand` on a listing request. */
  readonly slug: string | undefined;
  /** The brand logo, or `undefined` when the brand has none. */
  readonly logoUrl: string | undefined;
}

/** The result of `POST /v1/search/` — instant search for a search field with a dropdown. */
export interface TalqynSearchResponse {
  /**
   * The impression id for this response. Send it back in a product-click event: without it a click
   * has no denominator and search click-through cannot be computed.
   */
  readonly searchId: string;
  /** The query the results were produced for. Differs from what was sent when {@link correctedFrom} is set. */
  readonly query: string;
  /** The locale the results were produced in, as its wire value. */
  readonly locale: string;
  /** How many products matched in total, beyond the ones returned. */
  readonly total: number;
  /** The top matches, already ranked. */
  readonly results: readonly TalqynProduct[];
  /** Query completions for the search field. */
  readonly suggestions: readonly TalqynSuggestion[];
  /** Facet chips for the search field. */
  readonly chips: readonly TalqynChip[];
  /** Editorial queries shown for an empty search field. These are **suggestions**, not products. */
  readonly showcase: readonly TalqynSuggestion[];
  /** Categories worth navigating to for this query. */
  readonly categories: readonly TalqynCategory[];
  /** Brands worth navigating to for this query. */
  readonly brands: readonly TalqynBrand[];
  /**
   * This shopper's earlier queries. Empty until the token names a shopper — not a guest — and the
   * storefront reports submitted queries through `talqyn.events`: the block is assembled from those
   * very events.
   */
  readonly history: readonly string[];
  /**
   * The original text, when the server quietly searched for the top suggestion instead — a short or
   * misspelled query. {@link results} already reflect the corrected text; show this to offer
   * "search for … instead".
   */
  readonly correctedFrom: string | undefined;
}

/** The result of `POST /v1/search/full` — one page of a listing. */
export interface TalqynFullSearchResponse {
  /**
   * The impression id, present on the **first** page only (`offset == 0`). Later pages of the same
   * search continue that impression, so a click from any page reports this same id.
   */
  readonly searchId: string | undefined;
  /** The query the page was produced for. */
  readonly query: string;
  /** The locale the page was produced in. */
  readonly locale: string;
  /** The offset this page starts at. */
  readonly offset: number;
  /** The page size that was requested. */
  readonly limit: number;
  /** The ordering that was applied, as its wire value. */
  readonly sort: string;
  /** How many products match the criteria in total. */
  readonly total: number;
  /** The products on this page. */
  readonly results: readonly TalqynProduct[];
}

export const TalqynFullSearchResponse = {
  /**
   * Whether another page can be requested. An empty page ends the listing even when `total` promises
   * more: otherwise pagination would loop on the same offset for ever.
   */
  hasMore(page: TalqynFullSearchResponse): boolean {
    return page.results.length > 0 && page.offset + page.results.length < page.total;
  },

  /** The offset of the next page, or `undefined` when the listing is exhausted. */
  nextOffset(page: TalqynFullSearchResponse): number | undefined {
    return TalqynFullSearchResponse.hasMore(page) ? page.offset + page.results.length : undefined;
  },
} as const;

export function decodeSuggestion(value: unknown): TalqynSuggestion | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    text: readString(record, 'text') ?? '',
    weight: readInteger(record, 'weight') ?? 0,
    highlightFrom: readInteger(record, 'highlight_from') ?? 0,
  };
}

function decodeChip(value: unknown): TalqynChip | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return { text: readString(record, 'text') ?? '', weight: readInteger(record, 'weight') ?? 0 };
}

function decodeCategory(value: unknown): TalqynCategory | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    id: readInteger(record, 'id') ?? 0,
    name: readString(record, 'name') ?? '',
    slug: readString(record, 'slug'),
    path: readString(record, 'path'),
    parentName: readString(record, 'parent_name'),
  };
}

function decodeBrand(value: unknown): TalqynBrand | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    id: readInteger(record, 'id') ?? 0,
    name: readString(record, 'name') ?? '',
    slug: readString(record, 'slug'),
    logoUrl: lenientUrl(readString(record, 'logo_url')),
  };
}

/** Decodes an instant-search response. A card that does not decode is dropped on its own; the rest of the list stays. */
export function decodeSearchResponse(value: unknown): TalqynSearchResponse | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    searchId: readString(record, 'search_id') ?? '',
    query: readString(record, 'query') ?? '',
    locale: readString(record, 'locale') ?? 'en',
    total: readInteger(record, 'total') ?? 0,
    results: readArray(record, 'results', decodeProduct),
    suggestions: readArray(record, 'suggestions', decodeSuggestion),
    chips: readArray(record, 'chips', decodeChip),
    showcase: readArray(record, 'showcase', decodeSuggestion),
    categories: readArray(record, 'categories', decodeCategory),
    brands: readArray(record, 'brands', decodeBrand),
    history: readArray(record, 'history', decodeString),
    correctedFrom: readString(record, 'corrected_from'),
  };
}

/** Decodes a listing page. A card that does not decode is dropped on its own; the rest of the page stays. */
export function decodeFullSearchResponse(value: unknown): TalqynFullSearchResponse | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    searchId: readString(record, 'search_id'),
    query: readString(record, 'query') ?? '',
    locale: readString(record, 'locale') ?? 'en',
    offset: readInteger(record, 'offset') ?? 0,
    limit: readInteger(record, 'limit') ?? 0,
    sort: readString(record, 'sort') ?? 'relevance',
    total: readInteger(record, 'total') ?? 0,
    results: readArray(record, 'results', decodeProduct),
  };
}
