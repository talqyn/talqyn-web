import {
  withCriteriaDefaults,
  withFullSearchDefaults,
  withSearchDefaults,
  withStartDefaults,
  type TalqynDefaults,
} from '../defaults.js';
import { decodeFiltersResponse, type TalqynFiltersResponse } from '../models/filter-models.js';
import {
  encodeFiltersQuery,
  encodeFullSearchQuery,
  encodeSearchQuery,
  encodeStartQuery,
  TalqynFullSearchQuery,
  type TalqynFiltersQuery,
  type TalqynSearchQuery,
  type TalqynStartQuery,
} from '../models/queries.js';
import {
  decodeFullSearchResponse,
  decodeSearchResponse,
  decodeStartResponse,
  type TalqynFullSearchResponse,
  type TalqynSearchResponse,
  type TalqynStartResponse,
} from '../models/search-models.js';
import type { TalqynApiClient } from '../networking/api-client.js';
import { linkSignal } from '../internal/async.js';
import type { TalqynRequestOptions } from '../request-options.js';

/** Options of `talqyn.search.search` for a plain query string. */
export interface TalqynSearchOptions extends TalqynRequestOptions {
  /** How many products to return. 1–50. Defaults to 20. */
  readonly limit?: number | undefined;
}

/** A listing page and the filter panel counted against the same selection. */
export interface TalqynListingWithFilters {
  readonly listing: TalqynFullSearchResponse;
  readonly filters: TalqynFiltersResponse;
}

/**
 * Instant search, listings, and the filter panel. Reached through `talqyn.search`.
 *
 * Requires the `search` scope, which every device token carries. Every request inherits the client's
 * defaults — locale, place, A/B bucket — for the fields it leaves unset.
 */
export class TalqynSearchApi {
  /** @internal Reached through `talqyn.search`. */
  constructor(
    private readonly client: TalqynApiClient,
    private readonly defaults: TalqynDefaults,
  ) {}

  /**
   * Runs instant search: `POST /v1/search/`.
   *
   * Returns the top matches together with completions, facet chips, brands, and categories — everything
   * a search field with a dropdown needs from one round trip. Report the submitted query through
   * `talqyn.events`: the `history` block of later responses is assembled from those events.
   *
   * @param query What the shopper typed — 1–500 characters — or a whole request.
   * @throws {TalqynError} Commonly `validation` for an empty query or an out-of-range limit, and
   *   `rateLimited` when the search bucket is exhausted.
   */
  async search(query: string | TalqynSearchQuery, options: TalqynSearchOptions = {}): Promise<TalqynSearchResponse> {
    const request: TalqynSearchQuery = typeof query === 'string' ? { query, limit: options.limit } : query;
    const prepared = withSearchDefaults(this.defaults.current, request);
    // The trailing slash is part of the endpoint address, not a typo.
    return this.client.fetchJson(
      { path: 'search/', body: encodeSearchQuery(prepared), signal: options.signal },
      decodeSearchResponse,
    );
  }

  /**
   * Fetches the start screen of an empty search field: `POST /v1/search/start`.
   *
   * What to show when the shopper focuses the field and has typed nothing: their recent queries, what
   * the storefront searches for, the catalog's root categories, and popular products. This is not
   * `search('')` — an empty query has no vector and no prefix, so ranking, completions, and correction
   * are all off, and the answer carries popularity instead of relevance.
   *
   * Report card taps through `talqyn.events` with `source: TalqynEventSource.start` and the response's
   * `searchId`, the way you would for search results.
   *
   * Each call is billed as a search, so call it when the field takes focus rather than on every render.
   *
   * @param query How many products to return and where the shopper is. Everything is optional.
   * @throws {TalqynError} Commonly `rateLimited` when the search bucket is exhausted.
   */
  async start(query: TalqynStartQuery = {}, options: TalqynRequestOptions = {}): Promise<TalqynStartResponse> {
    const prepared = withStartDefaults(this.defaults.current, query);
    return this.client.fetchJson(
      { path: 'search/start', body: encodeStartQuery(prepared), signal: options.signal },
      decodeStartResponse,
    );
  }

  /**
   * Fetches one page of a listing: `POST /v1/search/full`.
   *
   * Advance through pages with `TalqynFullSearchQuery.nextPage`, which returns `undefined` once the
   * listing is exhausted.
   */
  async full(query: TalqynFullSearchQuery, options: TalqynRequestOptions = {}): Promise<TalqynFullSearchResponse> {
    const prepared = withFullSearchDefaults(this.defaults.current, query);
    return this.client.fetchJson(
      { path: 'search/full', body: encodeFullSearchQuery(prepared), signal: options.signal },
      decodeFullSearchResponse,
    );
  }

  /**
   * Fetches facet counts: `POST /v1/search/filters`.
   *
   * Counts are computed against the current query **and** the filters already applied, which is what
   * makes an option's count the number of products the shopper would get by tapping it.
   */
  async filters(query: TalqynFiltersQuery, options: TalqynRequestOptions = {}): Promise<TalqynFiltersResponse> {
    const prepared = withCriteriaDefaults(this.defaults.current, TalqynFullSearchQuery.filtersQuery(query));
    return this.client.fetchJson(
      { path: 'search/filters', body: encodeFiltersQuery(prepared), signal: options.signal },
      decodeFiltersResponse,
    );
  }

  /**
   * Fetches a listing page and its filter panel concurrently.
   *
   * Both endpoints take the same selection, and computing it twice by hand is how a panel ends up
   * counting against something other than what is on screen. For the same reason the client's
   * defaults are read once for the two: a place or a locale changed meanwhile reaches both requests or
   * neither.
   *
   * The first request to fail cancels the other and is thrown at once, without waiting for a page
   * nobody will show.
   */
  async listingWithFilters(
    query: TalqynFullSearchQuery,
    options: TalqynRequestOptions = {},
  ): Promise<TalqynListingWithFilters> {
    // One snapshot for the pair.
    const snapshot = this.defaults.current;
    const listingBody = encodeFullSearchQuery(withFullSearchDefaults(snapshot, query));
    const panelBody = encodeFiltersQuery(withCriteriaDefaults(snapshot, TalqynFullSearchQuery.filtersQuery(query)));

    const controller = new AbortController();
    const unlink = linkSignal(options.signal, controller);
    try {
      const [listing, filters] = await Promise.all([
        this.client.fetchJson(
          { path: 'search/full', body: listingBody, signal: controller.signal },
          decodeFullSearchResponse,
        ),
        this.client.fetchJson(
          { path: 'search/filters', body: panelBody, signal: controller.signal },
          decodeFiltersResponse,
        ),
      ]);
      return { listing, filters };
    } catch (error) {
      // The request still running is for nobody now.
      controller.abort();
      throw error;
    } finally {
      unlink();
    }
  }
}
