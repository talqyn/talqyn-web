import { describe, expect, it } from 'vitest';
import {
  TalqynActionFilters,
  TalqynChatMessage,
  TalqynChatTranscript,
  TalqynConsultantAnswer,
  TalqynDeviceToken,
  TalqynFallbackReason,
  TalqynFilterOption,
  TalqynFiltersResponse,
  TalqynProduct,
} from '../../src/sdk/index.js';
import { decodeChatSummaries, decodeChatTranscript } from '../../src/sdk/models/chat-models.js';
import { decodeConsultantAnswer } from '../../src/sdk/models/consultant-models.js';
import { decodeFiltersResponse } from '../../src/sdk/models/filter-models.js';
import { decodeProduct, lenientUrl } from '../../src/sdk/models/product.js';
import { decodeSearchResponse } from '../../src/sdk/models/search-models.js';

function decode<T>(decoder: (value: unknown) => T | undefined, body: string): T {
  const decoded = decoder(JSON.parse(body));
  if (decoded === undefined) throw new Error('did not decode');
  return decoded;
}

/** Responses are taken from the contract (`docs/public_api.md`): these tests pin the models to it. */
describe('decoding', () => {
  it('decodes an instant-search response', () => {
    const response = decode(
      decodeSearchResponse,
      `{
        "search_id": "6c5f2e8a-0000-4000-8000-000000000000",
        "query": "iphone 15", "locale": "ru", "total": 8,
        "results": [{
          "talqyn_id": 1234, "external_id": "256073",
          "title": "Apple iPhone 15 128GB",
          "slug": "apple-iphone-15-128gb", "brand_name": "Apple",
          "brand_id": 7, "brand_slug": "apple", "brand_logo_url": null,
          "category_path": ["Phones and gadgets", "Phones"],
          "price": 449990, "price_before": 479990, "in_stock": true,
          "rating": 4.8, "reviews_count": 213,
          "image_url": "https://cdn.example.com/1.jpg", "url": "https://mechta.kz/p/1",
          "score": 0.87
        }],
        "suggestions": [{"text": "iphone 15 pro", "weight": 12, "highlight_from": 8}],
        "chips": [{"text": "Apple", "weight": 5}],
        "showcase": [{"text": "headphones", "weight": 3, "highlight_from": 0}],
        "categories": [{"id": 42, "name": "Phones", "slug": "smartfony", "path": "1.42", "parent_name": "Phones and gadgets"}],
        "brands": [{"id": 7, "name": "Apple", "slug": "apple", "logo_url": null}],
        "history": ["headphones"],
        "corrected_from": "iphone15"
      }`,
    );

    expect(response.searchId).toBe('6c5f2e8a-0000-4000-8000-000000000000');
    expect(response.total).toBe(8);
    expect(response.correctedFrom).toBe('iphone15');
    expect(response.history).toEqual(['headphones']);
    // showcase carries suggestions, not products.
    expect(response.showcase[0]?.text).toBe('headphones');
    expect(response.suggestions[0]?.highlightFrom).toBe(8);
    expect(response.chips[0]).toEqual({ text: 'Apple', weight: 5 });
    expect(response.categories[0]?.parentName).toBe('Phones and gadgets');
    expect(response.brands[0]?.logoUrl).toBeUndefined();

    const product = response.results[0];
    if (!product) throw new Error('expected a product');
    expect(product.talqynId).toBe(1234);
    expect(product.externalId).toBe('256073');
    expect(product.brandSlug).toBe('apple');
    expect(product.categoryPath).toHaveLength(2);
    expect(product.price).toBe(449_990);
    expect(product.inStock).toBe(true);
    expect(TalqynProduct.hasDiscount(product)).toBe(true);
    expect(product.imageUrl).toBe('https://cdn.example.com/1.jpg');
    expect(product.productUrl).toBe('https://mechta.kz/p/1');
    expect(product.brandLogoUrl).toBeUndefined();
  });

  it('accepts the legacy product_id alias', () => {
    const product = decode(decodeProduct, '{"product_id": 55, "title": "x"}');
    expect(product.talqynId).toBe(55);
    // A card that does not mention stock is not out of stock.
    expect(product.inStock).toBeUndefined();
    expect(product.reviewsCount).toBe(0);
    expect(product.price).toBeUndefined();
    expect(TalqynProduct.hasDiscount(product)).toBe(false);
  });

  it('rejects a product without an identifier', () => {
    expect(decodeProduct(JSON.parse('{"title": "x"}'))).toBeUndefined();
    expect(decodeProduct(JSON.parse('{"talqyn_id": "12", "title": "x"}'))).toBeUndefined();
  });

  /** One malformed card costs that card, not the page it came in. */
  it('drops a malformed card, not the page', () => {
    const response = decode(
      decodeSearchResponse,
      `{"search_id": "s", "query": "x", "locale": "ru", "total": 4,
        "results": [
          {"talqyn_id": 1, "title": "a"},
          {"title": "no identifier"},
          null,
          "not even an object",
          {"talqyn_id": 2, "title": "b"}
        ]}`,
    );
    expect(response.results.map((product) => product.talqynId)).toEqual([1, 2]);
    expect(response.total).toBe(4);
  });

  it('tolerates a missing or odd field', () => {
    const response = decode(decodeSearchResponse, '{"total": "many", "results": {}}');
    expect(response.total).toBe(0);
    expect(response.results).toEqual([]);
    expect(response.locale).toBe('en');
    expect(decodeSearchResponse(JSON.parse('[]'))).toBeUndefined();
  });

  it('takes a product URL with a Cyrillic path', () => {
    const product = decode(decodeProduct, '{"talqyn_id":1,"title":"x","url":"https://shop.kz/товар/1"}');
    expect(product.productUrl).toBeDefined();
  });

  /**
   * Catalog URLs are taken leniently, byte for byte the way the iOS and Android SDKs take them: what a
   * URL may not carry is percent-encoded, an escape already in place is kept rather than encoded again,
   * a second `#` is part of the fragment, and a URL that is valid as written comes back as written.
   */
  it('encodes catalog URLs once and the same on every platform', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['https://x.kz/img 50%.jpg', 'https://x.kz/img%2050%25.jpg'],
      ['https://cdn.kz/img[1].jpg', 'https://cdn.kz/img%5B1%5D.jpg'],
      ['https://x/a#b#c', 'https://x/a#b%23c'],
      ['https://x/a%20b c.jpg', 'https://x/a%20b%20c.jpg'],
      ['https://x.kz/фото 1.jpg', 'https://x.kz/%D1%84%D0%BE%D1%82%D0%BE%201.jpg'],
      ['https://cdn.example.com/a%20b.jpg?w=200&h=100#top', 'https://cdn.example.com/a%20b.jpg?w=200&h=100#top'],
    ];
    for (const [raw, expected] of cases) {
      expect(lenientUrl(raw), raw).toBe(expected);
    }
    expect(lenientUrl('')).toBeUndefined();
    expect(lenientUrl(undefined)).toBeUndefined();
    expect(lenientUrl('http://[::1]:8080/a.jpg')).toBe('http://[::1]:8080/a.jpg');
  });

  /**
   * Brackets and the authority shape follow Foundation's parser, which is the reference: every
   * expected value below is pinned to what `URL(string:encodingInvalidCharacters:false)` produced on
   * iOS for the same input, so a malformed feed address degrades identically on both platforms.
   */
  it('treats brackets and the authority the way iOS does', () => {
    const kept: readonly string[] = [
      'http://[abc]/x', // Foundation does not validate the literal's content
      'http://user@[::1]/x',
      'http://x@[abc]:99/x',
      'http://[::1%25en0]/x', // an IPv6 zone: the one % an IP-literal may carry
      'http://u:p:q@x/', // colons are free in userinfo, constrained to the port in the host
      'http://x:/a', // an empty port parses
    ];
    for (const raw of kept) {
      expect(lenientUrl(raw), raw).toBe(raw);
    }
    const encoded: readonly (readonly [string, string])[] = [
      ['http://a[b]c/x', 'http://a%5Bb%5Dc/x'],
      ['http://x/a?b[0]=1', 'http://x/a?b%5B0%5D=1'],
      ['http://[a]b@c/x', 'http://%5Ba%5Db@c/x'], // brackets in userinfo are not an IP-literal
      ['http://[a%25%2]/x', 'http://%5Ba%25%252%5D/x'], // a broken zone escape falls out of the literal
    ];
    for (const [raw, expected] of encoded) {
      expect(lenientUrl(raw), raw).toBe(expected);
    }
    const refused: readonly string[] = [
      'http://[::1]junk/x', // junk between the literal and the port re-encodes into a non-digit port
      'http://[fe80::1%en0]/x', // a raw zone delimiter re-encodes into a non-digit port
      'http://x:abc/', // a non-digit port stays a non-digit port
      'http://a@b@c/x', // a second @ cannot be encoded away: @ is kept as written
    ];
    for (const raw of refused) {
      expect(lenientUrl(raw), raw).toBeUndefined();
    }
  });

  it('decodes the filter groups and the place helpers', () => {
    const response = decode(
      decodeFiltersResponse,
      `{"groups": [
        {"slug": "brand", "label": "Brand", "type": "list",
         "options": [
           {"slug": "apple", "label": "Apple", "count": 42, "state": "active"},
           {"slug": "samsung", "label": "Samsung", "count": 0, "state": "disabled"}
         ]},
        {"slug": "price", "label": "Price", "type": "range",
         "options": [], "min": 15000, "max": 890000, "selected_min": null, "selected_max": null},
        {"slug": "city", "label": "City", "type": "list",
         "options": [{"slug": "almaty", "label": "Almaty", "id": "10", "count": 297, "state": "enabled"}]},
        {"slug": "location", "label": "Store", "type": "list",
         "options": [{"slug": "5", "label": "Mega Mall", "id": "2f5f", "city_slug": "almaty", "count": 12, "state": "enabled"}]}
      ]}`,
    );

    expect(response.groups).toHaveLength(4);
    expect(TalqynFiltersResponse.panelGroups(response).map((group) => group.slug)).toEqual(['brand', 'price']);
    expect(TalqynFiltersResponse.priceGroup(response)?.min).toBe(15000);
    expect(TalqynFiltersResponse.priceGroup(response)?.type).toBe('range');
    expect(TalqynFiltersResponse.cityGroup(response)?.options[0]?.id).toBe('10');
    expect(TalqynFiltersResponse.locationGroup(response)?.options[0]?.citySlug).toBe('almaty');
    expect(TalqynFiltersResponse.selectedFilters(response)).toEqual({ brand: ['apple'] });

    const samsung = TalqynFiltersResponse.group(response, 'brand')?.options[1];
    if (!samsung) throw new Error('expected an option');
    expect(TalqynFilterOption.isDisabled(samsung)).toBe(true);
    expect(TalqynFilterOption.isSelected(samsung)).toBe(false);
  });

  it('finds stores under their former group name', () => {
    const response = decode(decodeFiltersResponse, '{"groups":[{"slug":"store","options":[{"slug":"5","id":"77"}]}]}');
    expect(TalqynFiltersResponse.locationGroup(response)?.options[0]?.id).toBe('77');
    expect(TalqynFiltersResponse.panelGroups(response)).toEqual([]);
  });

  it('keeps a catalog key of __proto__ as an entry rather than as a prototype', () => {
    // A plain `record[key] = value` would hand `__proto__` to the setter inherited from
    // `Object.prototype`: the entry would vanish and the record's own prototype would be rewritten. A
    // dictionary on iOS and a map on Android take such a key like any other.
    const action = decode(
      decodeConsultantAnswer,
      `{"answer": "", "session_id": "s", "actions": [
        {"type": "apply_filters", "filters": {"filters": {"__proto__": ["a"], "ram": ["16"]}, "attrs": {"__proto__": "a"}}}
      ]}`,
    ).actions[0];
    if (action?.type !== 'applyFilters') throw new Error('expected an apply_filters action');
    expect(Object.keys(action.filters.filters)).toEqual(['__proto__', 'ram']);
    expect(Object.getPrototypeOf(action.filters.filters)).toBe(Object.prototype);
    expect(Object.keys(action.filters.attributes)).toEqual(['__proto__']);

    const response = decode(
      decodeFiltersResponse,
      '{"groups":[{"slug":"__proto__","options":[{"slug":"x","state":"active"}]}]}',
    );
    const selected = TalqynFiltersResponse.selectedFilters(response);
    expect(Object.keys(selected)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(selected)).toBe(Object.prototype);
  });

  it('keeps an unknown filter kind and state', () => {
    const response = decode(
      decodeFiltersResponse,
      '{"groups": [{"slug": "x", "type": "colorpicker", "options": [{"slug": "a", "state": "highlighted"}]}]}',
    );
    expect(response.groups[0]?.type).toBe('colorpicker');
    expect(response.groups[0]?.options[0]?.state).toBe('highlighted');
  });

  it('decodes a consultant JSON answer', () => {
    const answer = decode(
      decodeConsultantAnswer,
      `{"tenant_id": "3f2a", "answer": "Here are the options [p:1]", "session_id": "a1b2c3d4",
        "products": [{"talqyn_id": 1, "title": "Laptop"}],
        "fallback_reason": null, "clarify": null, "groups": null,
        "redirect_query": null, "actions": [
          {"type": "apply_filters", "filters": {"category_id": 5, "filters": {"ram": ["16"]}, "attrs": {"ram": "16"}}}
        ],
        "follow_ups": ["show cheaper ones"], "search_id": "s1"}`,
    );
    expect(answer.sessionId).toBe('a1b2c3d4');
    expect(answer.products).toHaveLength(1);
    expect(answer.followUps).toEqual(['show cheaper ones']);
    expect(answer.clarify).toBeUndefined();
    expect(answer.groups).toBeUndefined();
    expect(TalqynConsultantAnswer.isFallback(answer)).toBe(false);

    const action = answer.actions[0];
    if (action?.type !== 'applyFilters') throw new Error('expected an apply_filters action');
    expect(action.filters.categoryId).toBe(5);
    expect(action.filters.filters['ram']).toEqual(['16']);
    expect(action.filters.attributes['ram']).toBe('16');

    const criteria = TalqynActionFilters.criteria(action.filters, { query: 'laptop', cityId: '10' });
    expect(criteria.query).toBe('laptop');
    expect(criteria.categoryId).toBe(5);
    expect(criteria.cityId).toBe('10');
    expect(criteria.filters).toEqual({ ram: ['16'] });
  });

  it('carries the fallback reason of an answer', () => {
    const answer = decode(
      decodeConsultantAnswer,
      '{"tenant_id": "3f2a", "answer": "", "products": [], "fallback_reason": "user_budget_exceeded"}',
    );
    expect(TalqynConsultantAnswer.isFallback(answer)).toBe(true);
    expect(answer.fallbackReason).toBe(TalqynFallbackReason.userBudgetExceeded);
    expect(TalqynFallbackReason.isBudgetExhausted(answer.fallbackReason ?? '')).toBe(true);
  });

  it('hydrates the products of each transcript message', () => {
    const transcript = decode(
      decodeChatTranscript,
      `{"session_id": "s1", "title": "laptop for school",
        "messages": [
          {"role": "user", "text": "need a laptop", "talqyn_ids": [], "route": "consult", "created_at": "2026-08-26T12:00:00Z"},
          {"role": "assistant", "text": "here", "talqyn_ids": [2, 1], "created_at": "2026-08-26T12:00:03.512Z"},
          {"text": "nobody wrote this"}
        ],
        "products": [{"talqyn_id": 1, "title": "A"}, {"talqyn_id": 2, "title": "B"}]}`,
    );
    // A message with no role is dropped on its own.
    expect(transcript.messages).toHaveLength(2);
    const [question, reply] = transcript.messages;
    if (!question || !reply) throw new Error('expected two messages');
    expect(question.route).toBe('consult');
    expect(TalqynChatMessage.isRedirect(question)).toBe(false);
    expect(question.createdAt?.toISOString()).toBe('2026-08-26T12:00:00.000Z');
    // Postgres fractional seconds parse too.
    expect(reply.createdAt?.toISOString()).toBe('2026-08-26T12:00:03.512Z');
    expect(TalqynChatTranscript.productsFor(transcript, reply).map((product) => product.title)).toEqual(['B', 'A']);
  });

  it('parses timestamps with microseconds and an offset', () => {
    const transcript = decode(
      decodeChatTranscript,
      '{"session_id":"s","messages":[{"role":"user","text":"q","created_at":"2026-08-26T17:00:03.512345+05:00"},{"role":"user","text":"q","created_at":"yesterday"}]}',
    );
    expect(transcript.messages[0]?.createdAt?.toISOString()).toBe('2026-08-26T12:00:03.512Z');
    expect(transcript.messages[1]?.createdAt).toBeUndefined();
  });

  // iOS's ISO8601DateFormatter reads neither, and a timestamp is present on every platform or on none.
  it('rejects a lowercase designator and a leap second the way iOS does', () => {
    const transcript = decode(
      decodeChatTranscript,
      '{"session_id":"s","messages":[{"role":"user","text":"q","created_at":"2026-08-26t12:00:00z"},{"role":"user","text":"q","created_at":"2026-08-26T12:00:60Z"}]}',
    );
    expect(transcript.messages[0]?.createdAt).toBeUndefined();
    expect(transcript.messages[1]?.createdAt).toBeUndefined();
  });

  it('decodes the list of conversations', () => {
    const chats = decode(
      decodeChatSummaries,
      `[{"session_id": "s1", "title": null, "message_count": 4,
         "created_at": "2026-08-26T12:00:00Z", "last_message_at": "2026-08-26T12:10:00Z"}]`,
    );
    expect(chats[0]?.messageCount).toBe(4);
    expect(chats[0]?.title).toBeUndefined();
    expect(chats[0]?.lastMessageAt).toBeInstanceOf(Date);
    expect(decodeChatSummaries(JSON.parse('{"session_id":"s1"}'))).toBeUndefined();
  });

  it('decodes a device token response', () => {
    const token = TalqynDeviceToken.decode(
      JSON.parse(
        '{"token": "tlqd_eyJ", "expires_at": "2026-08-26T12:15:00Z", "expires_in": 900, "user_id": "6f1c2b9a-3e47-4b8f-9a10-2c5d8e7f4a01"}',
      ),
    );
    expect(token?.token).toBe('tlqd_eyJ');
    expect(token?.expiresIn).toBe(900);
    expect(token?.expiresAt).toBeInstanceOf(Date);
    expect(token?.userId).toBe('6f1c2b9a-3e47-4b8f-9a10-2c5d8e7f4a01');
    expect(token?.isGuest).toBe(false);
    expect(TalqynDeviceToken.decode(JSON.parse('{"expires_in": 900}'))).toBeUndefined();
    expect(TalqynDeviceToken.decode(JSON.parse('{"token": "t"}'))?.expiresIn).toBe(900);
  });
});
