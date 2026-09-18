import { describe, expect, it } from 'vitest';
import { Talqyn } from '../../src/sdk/index.js';
import {
  ScriptedTransport,
  StubTransport,
  TestFixtures,
  delay,
  talqynFailure,
  waitUntil,
} from '../support/stub-transport.js';

const emptySearch = '{"search_id":"s","query":"x","locale":"ru","total":0,"results":[]}';
const emptyListing = '{"query":"x","locale":"ru","offset":0,"limit":20,"sort":"relevance","total":0,"results":[]}';

/** Endpoints: path, body, headers, and how defaults are filled in. */
describe('API requests', () => {
  it('carries the token and a request id on every request', async () => {
    const transport = new StubTransport();
    const talqyn = await TestFixtures.preparedClient(transport);
    transport.enqueue(emptySearch);
    await talqyn.search.search('iphone');

    const sent = transport.sent[0];
    expect(sent?.header('Authorization')).toBe('Bearer tlqd_test');
    expect(sent?.header('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent?.header('Accept')).toBe('application/json');
    expect(sent?.header('Content-Type')).toBe('application/json');
    expect(sent?.header('X-Talqyn-SDK')).toBe(Talqyn.clientHeader);
    expect(sent?.request.keepalive).toBe(false);
  });

  /** Support cannot narrow a report to a build without this, so it travels on the mint too — the one request sent before there is any token. */
  it('carries the SDK version on the mint', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    const talqyn = TestFixtures.client({ transport });
    await talqyn.prepare();

    const header = transport.sent[0]?.header('X-Talqyn-SDK');
    expect(header).toBe(Talqyn.clientHeader);
    expect(header?.endsWith(`/${Talqyn.version}`)).toBe(true);
    expect(header?.startsWith('web/')).toBe(true);
  });

  it('addresses the search endpoints', async () => {
    const transport = new StubTransport();
    transport.enqueue(emptySearch);
    transport.enqueue(emptyListing);
    transport.enqueue('{"groups":[]}');

    const talqyn = await TestFixtures.preparedClient(transport);
    await talqyn.search.search('iphone');
    await talqyn.search.full({ query: 'smartphone', sort: 'price_asc' });
    await talqyn.search.filters({ query: 'smartphone' });

    expect(transport.sent.map((sent) => sent.path)).toEqual(['/v1/search/', '/v1/search/full', '/v1/search/filters']);
    expect(transport.sent.map((sent) => sent.method)).toEqual(['POST', 'POST', 'POST']);
    expect(transport.sent[0]?.bodyJson['query']).toBe('iphone');
    expect(transport.sent[1]?.bodyJson['sort']).toBe('price_asc');
  });

  it('takes the limit of a plain query string', async () => {
    const transport = new StubTransport();
    transport.enqueue(emptySearch);
    const talqyn = await TestFixtures.preparedClient(transport);
    await talqyn.search.search('iphone', { limit: 5 });
    expect(transport.sent[0]?.bodyJson['limit']).toBe(5);
  });

  it('sends the same criteria to the listing and its panel', async () => {
    const transport = new ScriptedTransport(async (request) =>
      ScriptedTransport.json(new URL(request.url).pathname.endsWith('/filters') ? '{"groups":[]}' : emptyListing),
    );
    const talqyn = TestFixtures.client({ transport });
    await talqyn.search.listingWithFilters({ query: 'smartphone', limit: 24, filters: { brand: ['apple'] }, categoryId: 7 });

    expect(transport.sent).toHaveLength(2);
    for (const sent of transport.sent) {
      expect(sent.bodyJson['query']).toBe('smartphone');
      expect(sent.bodyJson['category_id']).toBe(7);
      expect(sent.bodyJson['filters']).toEqual({ brand: ['apple'] });
    }
    const panel = transport.sent.find((sent) => sent.path.endsWith('/filters'));
    expect(panel?.bodyJson).not.toHaveProperty('limit');
  });

  /** The listing and its panel count against one place: the defaults are read once for the two. */
  it('counts the listing and its panel against one place', async () => {
    const transport = new ScriptedTransport(async (request) =>
      ScriptedTransport.json(new URL(request.url).pathname.endsWith('/filters') ? '{"groups":[]}' : emptyListing),
    );
    const talqyn = TestFixtures.client({ transport, cityId: '10' });

    for (const city of ['47', '10', '47']) {
      talqyn.setPlace(city);
      await talqyn.search.listingWithFilters({ query: 'smartphone' });
    }

    const cities = transport.sent.map((sent) => sent.bodyJson['city_id']);
    expect(cities).toEqual(['47', '47', '10', '10', '47', '47']);
  });

  /**
   * A panel that fails is reported at once, not once the listing has come back — and the listing,
   * which nobody will show without its panel, is cancelled rather than fetched to the end.
   */
  it('fails at once when the panel fails, and stops the listing', async () => {
    const transport = new ScriptedTransport(async (request) => {
      if (new URL(request.url).pathname.endsWith('/filters')) {
        return ScriptedTransport.json('{"error":"internal_error"}', 500);
      }
      await delay(3_000, request.signal);
      return ScriptedTransport.json(emptyListing);
    });
    const talqyn = TestFixtures.client({ transport });

    const started = Date.now();
    const error = await talqynFailure(talqyn.search.listingWithFilters({ query: 'smartphone' }));
    // Not the failure that came second.
    expect(error.statusCode).toBe(500);
    // The failure did not wait for the listing.
    expect(Date.now() - started).toBeLessThan(1_500);
    await waitUntil(() => transport.cancelledPaths.length > 0);
    // The listing was not fetched for nobody.
    expect(transport.cancelledPaths).toEqual(['/v1/search/full']);
  });

  it('cancels a request through its signal', async () => {
    const transport = new ScriptedTransport(async (request) => {
      await delay(5_000, request.signal);
      return ScriptedTransport.json(emptySearch);
    });
    const talqyn = TestFixtures.client({ transport });
    await talqyn.prepare();

    const controller = new AbortController();
    const pending = talqyn.search.search('iphone', { signal: controller.signal });
    await waitUntil(() => transport.sent.length === 1);
    controller.abort();

    const error = await talqynFailure(pending);
    expect(error.kind).toBe('cancelled');
    expect(error.isCancellation).toBe(true);
    await waitUntil(() => transport.cancelledPaths.length === 1);
    expect(transport.cancelledPaths).toEqual(['/v1/search/']);
  });

  it('sends nothing for a signal that already aborted', async () => {
    const transport = new StubTransport();
    const talqyn = await TestFixtures.preparedClient(transport);
    const error = await talqynFailure(talqyn.search.search('iphone', { signal: AbortSignal.abort() }));
    expect(error.kind).toBe('cancelled');
    expect(transport.sent).toEqual([]);
  });

  it('adds stream=false to the consultant JSON mode', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"tenant_id":"t","answer":"answer","products":[]}');

    const talqyn = await TestFixtures.preparedClient(transport);
    const answer = await talqyn.consultant.answer({ question: 'hi' });

    expect(answer.answer).toBe('answer');
    expect(answer.tenantId).toBe('t');
    expect(transport.sent[0]?.path).toBe('/v1/consultant/ask');
    expect(transport.sent[0]?.query).toBe('stream=false');
    expect(transport.sent[0]?.bodyJson['question']).toBe('hi');
  });

  it('addresses the chat endpoints', async () => {
    const transport = new StubTransport();
    transport.enqueue('[]');
    transport.enqueue('{"session_id":"s1","messages":[],"products":[]}');
    transport.enqueue('');

    const talqyn = await TestFixtures.preparedClient(transport);
    await talqyn.consultant.chats({ limit: 5, offset: 10 });
    await talqyn.consultant.chat('s1', { locale: 'kk' });
    await talqyn.consultant.deleteChat('s1');

    const [list, read, remove] = transport.sent;
    expect(list?.path).toBe('/v1/consultant/chats');
    expect(list?.query).toBe('limit=5&offset=10');
    expect(list?.method).toBe('GET');
    expect(list?.request.body).toBeUndefined();
    expect(read?.path).toBe('/v1/consultant/chats/s1');
    expect(read?.query).toBe('locale=kk');
    expect(read?.method).toBe('GET');
    expect(remove?.method).toBe('DELETE');
    expect(remove?.path).toBe('/v1/consultant/chats/s1');
  });

  it('pages the chat list from the start by default and reads in the client locale', async () => {
    const transport = new StubTransport();
    transport.enqueue('[]');
    transport.enqueue('{"session_id":"s1","messages":[],"products":[]}');
    const talqyn = await TestFixtures.preparedClient(transport);
    await talqyn.consultant.chats();
    await talqyn.consultant.chat('a/b');
    expect(transport.sent[0]?.query).toBe('limit=20&offset=0');
    expect(transport.sent[1]?.request.url).toBe('https://api.example.com/v1/consultant/chats/a%2Fb?locale=en');
  });

  it('addresses the event endpoints and keeps their requests alive past the page', async () => {
    const transport = new StubTransport();
    transport.enqueue('', { status: 204 });
    transport.enqueue('', { status: 204 });
    transport.enqueue('', { status: 204 });

    const talqyn = await TestFixtures.preparedClient(transport);
    await talqyn.events.productClick({ searchId: 's1', talqynId: 1, position: 0, source: 'instant' });
    await talqyn.events.searchSubmit({ query: 'iphone', source: 'instant', resultsCount: 8 });
    await talqyn.events.categoryClick({ categoryId: 42 });

    expect(transport.sent.map((sent) => sent.path)).toEqual([
      '/v1/events/product-click',
      '/v1/events/search',
      '/v1/events/category-click',
    ]);
    expect(transport.sent[1]?.bodyJson['locale']).toBe('en');
    expect(transport.sent.every((sent) => sent.request.keepalive)).toBe(true);
  });

  it('tells the kind of a tracked event by its fields', async () => {
    const transport = new StubTransport();
    for (let index = 0; index < 3; index++) transport.enqueue('', { status: 204 });
    const talqyn = await TestFixtures.preparedClient(transport);

    talqyn.events.track({ searchId: 's1', talqynId: 1, position: 0, source: 'instant' });
    talqyn.events.track({ categoryId: 42, query: 'iphone' });
    talqyn.events.track({ query: 'iphone', source: 'full' });

    expect(await waitUntil(() => transport.sent.length === 3)).toBe(true);
    expect(transport.sent.map((sent) => sent.path).sort()).toEqual([
      '/v1/events/category-click',
      '/v1/events/product-click',
      '/v1/events/search',
    ]);
  });

  it('fills in the default city', async () => {
    const transport = new StubTransport();
    transport.enqueue(emptySearch);

    const talqyn = await TestFixtures.preparedClient(transport, { cityId: '10' });
    await talqyn.search.search('iphone');

    expect(transport.sent[0]?.bodyJson['city_id']).toBe('10');
  });

  /** A store beats a city: pairing a default city with an explicitly named store (or the reverse) would override the shopper's choice. */
  it('lets an explicit place suppress the defaults', async () => {
    const transport = new StubTransport();
    transport.enqueue(emptySearch);

    const talqyn = await TestFixtures.preparedClient(transport, { cityId: '10' });
    talqyn.setPlace('10', '5');
    await talqyn.search.search({ query: 'iphone', cityId: '47' });

    expect(transport.sent[0]?.bodyJson['city_id']).toBe('47');
    expect(transport.sent[0]?.bodyJson).not.toHaveProperty('location_id');
  });

  it('applies place, locale, and variant to later requests', async () => {
    const transport = new StubTransport();
    transport.enqueue(emptySearch);
    transport.enqueue('{"tenant_id":"t","answer":"","products":[]}');

    const talqyn = await TestFixtures.preparedClient(transport);
    talqyn.setPlace('10', '5');
    talqyn.setLocale('kk');
    talqyn.setVariant('exp-b');

    await talqyn.search.search('iphone');
    await talqyn.consultant.answer({ question: 'hi' });

    const search = transport.sent[0]?.bodyJson;
    expect(search?.['city_id']).toBe('10');
    expect(search?.['location_id']).toBe('5');
    expect(search?.['locale']).toBe('kk');
    expect(search?.['variant']).toBe('exp-b');

    // Place and locale travel on every consultant turn: a session keeps neither.
    const ask = transport.sent[1]?.bodyJson;
    expect(ask?.['city_id']).toBe('10');
    expect(ask?.['locale']).toBe('kk');

    expect(talqyn.currentLocale).toBe('kk');
    expect(talqyn.currentPlace).toEqual({ cityId: '10', locationId: '5' });

    // Changing the city clears the store.
    talqyn.setPlace('47');
    expect(talqyn.currentPlace).toEqual({ cityId: '47', locationId: undefined });
    talqyn.setVariant(null);
    talqyn.setPlace(null);
    expect(talqyn.currentPlace).toEqual({ cityId: undefined, locationId: undefined });
  });
});
