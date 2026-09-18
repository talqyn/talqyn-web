import { describe, expect, it } from 'vitest';
import { TalqynError, TalqynFullSearchQuery, TalqynLocale } from '../../src/sdk/index.js';
import {
  encodeConsultantQuery,
  encodeFiltersQuery,
  encodeFullSearchQuery,
  encodeSearchQuery,
} from '../../src/sdk/models/queries.js';
import {
  encodeCategoryClickEvent,
  encodeProductClickEvent,
  encodeSearchSubmitEvent,
} from '../../src/sdk/models/event-models.js';
import { decodeFullSearchResponse, type TalqynFullSearchResponse } from '../../src/sdk/models/search-models.js';

function json(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

function page(body: string): TalqynFullSearchResponse {
  const decoded = decodeFullSearchResponse(JSON.parse(body));
  if (!decoded) throw new Error('the page did not decode');
  return decoded;
}

describe('query encoding', () => {
  it('uses the contract field names for instant search', () => {
    const body = json(
      encodeSearchQuery({ query: 'iphone 15', locale: 'ru', limit: 10, categoryId: 42, priceMin: 1000, cityId: '10', variant: 'b' }),
    );
    expect(body['query']).toBe('iphone 15');
    expect(body['locale']).toBe('ru');
    expect(body['limit']).toBe(10);
    expect(body['category_id']).toBe(42);
    expect(body['price_min']).toBe(1000);
    expect(body['city_id']).toBe('10');
    expect(body['in_stock_only']).toBe(false);
    expect(body['variant']).toBe('b');
    expect(body).not.toHaveProperty('brand_id');
    expect(body).not.toHaveProperty('location_id');
    expect(body).not.toHaveProperty('price_max');
  });

  it('defaults the instant-search limit and reads null as unset', () => {
    const body = json(encodeSearchQuery({ query: 'x', cityId: null as unknown as undefined }));
    expect(body['limit']).toBe(20);
    expect(body).not.toHaveProperty('city_id');
  });

  it('omits empty filters from a listing request', () => {
    const bare = json(encodeFullSearchQuery({ query: 'smartphone' }));
    expect(bare).not.toHaveProperty('filters');
    expect(bare['sort']).toBe('relevance');
    expect(bare['offset']).toBe(0);
    expect(bare['limit']).toBe(20);
    expect(bare['has_discount']).toBe(false);

    const empty = json(encodeFullSearchQuery({ query: 'smartphone', filters: {} }));
    expect(empty).not.toHaveProperty('filters');

    const filtered = json(
      encodeFullSearchQuery({ query: 'smartphone', limit: 24, sort: 'price_asc', filters: { brand: ['apple', 'samsung'] } }),
    );
    expect(filtered['sort']).toBe('price_asc');
    expect(filtered['limit']).toBe(24);
    expect(filtered['filters']).toEqual({ brand: ['apple', 'samsung'] });
  });

  /** The filter panel counts against the same selection as the listing. */
  it('derives a panel request that keeps the criteria', () => {
    const listing: TalqynFullSearchQuery = {
      query: 'smartphone',
      limit: 24,
      offset: 48,
      sort: 'price_desc',
      filters: { brand: ['apple'] },
      categoryId: 7,
      cityId: '10',
      variant: 'b',
    };
    const body = json(encodeFiltersQuery(TalqynFullSearchQuery.filtersQuery(listing)));
    expect(body['query']).toBe('smartphone');
    expect(body['category_id']).toBe(7);
    expect(body['city_id']).toBe('10');
    expect(body['filters']).toEqual({ brand: ['apple'] });
    // The facet panel has no limit, offset, sort, or variant: it counts the whole selection.
    expect(body).not.toHaveProperty('limit');
    expect(body).not.toHaveProperty('offset');
    expect(body).not.toHaveProperty('sort');
    expect(body).not.toHaveProperty('variant');
  });

  it('uses the contract field names for a consultant question', () => {
    const body = json(encodeConsultantQuery({ question: 'need a laptop', locale: 'kk', sessionId: 'abc12345', locationId: '77' }));
    expect(body['question']).toBe('need a laptop');
    expect(body['locale']).toBe('kk');
    expect(body['session_id']).toBe('abc12345');
    expect(body['location_id']).toBe('77');
    expect(body).not.toHaveProperty('city_id');
  });

  it('encodes events', () => {
    const click = json(encodeProductClickEvent({ searchId: '6c5f2e8a', talqynId: 1234, position: 3, source: 'cip' }));
    expect(click).toEqual({ search_id: '6c5f2e8a', talqyn_id: 1234, position: 3, source: 'cip' });

    const submit = json(encodeSearchSubmitEvent({ query: 'iphone', source: 'instant', locale: 'ru', resultsCount: 8 }));
    expect(submit['results_count']).toBe(8);
    expect(submit['source']).toBe('instant');

    const category = json(encodeCategoryClickEvent({ categoryId: 42, query: 'iphone' }));
    expect(category).toEqual({ category_id: 42, query: 'iphone' });
  });

  it('advances to the next page', () => {
    const query: TalqynFullSearchQuery = { query: 'smartphone', limit: 24 };
    const emptyPage = page('{"query":"smartphone","locale":"ru","offset":0,"limit":24,"sort":"relevance","total":50,"results":[]}');
    // An empty page ends the listing, or pagination loops.
    expect(TalqynFullSearchQuery.nextPage(query, emptyPage)).toBeUndefined();

    const withItems = page(
      '{"query":"s","locale":"ru","offset":0,"limit":2,"sort":"relevance","total":5,"results":[{"talqyn_id":1,"title":"a"},{"talqyn_id":2,"title":"b"}]}',
    );
    const next = TalqynFullSearchQuery.nextPage(query, withItems);
    expect(next?.offset).toBe(2);
    expect(next?.limit).toBe(24);

    const lastPage = page(
      '{"query":"s","locale":"ru","offset":4,"limit":2,"sort":"relevance","total":5,"results":[{"talqyn_id":5,"title":"e"}]}',
    );
    expect(TalqynFullSearchQuery.nextPage(query, lastPage)).toBeUndefined();
  });

  /** `JSON.stringify` writes a non-finite number as `null`; the SDK refuses it instead. */
  it('refuses a non-finite number', () => {
    for (const encode of [
      () => encodeSearchQuery({ query: 'x', priceMin: Number.POSITIVE_INFINITY }),
      () => encodeFullSearchQuery({ query: 'x', priceMax: Number.NaN }),
    ]) {
      try {
        encode();
        expect.unreachable('expected an encoding failure');
      } catch (error) {
        expect(TalqynError.is(error) && error.kind).toBe('encoding');
      }
    }
  });

  it('maps a browser language onto a supported locale', () => {
    expect(TalqynLocale.matching('kk')).toBe('kk');
    expect(TalqynLocale.matching('kk-KZ')).toBe('kk');
    expect(TalqynLocale.matching('KK')).toBe('kk');
    expect(TalqynLocale.matching('ru-RU')).toBe('ru');
    expect(TalqynLocale.matching('en-US')).toBe('en');
    expect(TalqynLocale.matching('de')).toBe('en');
    expect(TalqynLocale.matching(undefined)).toBe('en');
  });
});
