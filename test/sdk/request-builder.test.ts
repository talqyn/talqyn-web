import { describe, expect, it } from 'vitest';
import { Talqyn, TalqynError } from '../../src/sdk/index.js';
import { StubTransport, TestFixtures } from '../support/stub-transport.js';
import { TalqynRequestBuilder } from '../../src/sdk/networking/request-builder.js';

function builder(base: string, version = 'v1'): TalqynRequestBuilder {
  return new TalqynRequestBuilder(base, version, 30_000);
}

describe('the API host', () => {
  /**
   * The SDK carries no endpoint of its own: the host of the configuration is the only one there is,
   * and the token mint goes there too — the minter and the API calls share one builder.
   */
  it('sends every request, the mint included, to the configured host', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    const talqyn = TestFixtures.client({ transport, baseUrl: 'https://gateway.example.com/talqyn' });
    transport.enqueue('{"search_id":"s","query":"x","locale":"ru","total":0,"results":[]}');
    await talqyn.search.search('iphone');

    expect(transport.sent.map((sent) => sent.request.url)).toEqual([
      'https://gateway.example.com/talqyn/v1/consultant/token',
      'https://gateway.example.com/talqyn/v1/search/',
    ]);
  });

  /** A stand is addressed by its own URL, and every request goes there. */
  it('sends requests to a given host', async () => {
    const transport = new StubTransport();
    const talqyn = await TestFixtures.preparedClient(transport, { baseUrl: 'https://gateway.example.com/talqyn' });
    transport.enqueue('{"search_id":"s","query":"x","locale":"ru","total":0,"results":[]}');
    await talqyn.search.search('iphone');

    expect(transport.sent[0]?.request.url).toBe('https://gateway.example.com/talqyn/v1/search/');
  });
});

describe('TalqynRequestBuilder', () => {
  /** The trailing slash of instant search is part of the endpoint address. */
  it('keeps the trailing slash of instant search', () => {
    expect(builder('https://api.example.com').url('search/')).toBe('https://api.example.com/v1/search/');
  });

  it('does not double a trailing slash of the base', () => {
    expect(builder('https://api.example.com/').url('search/full')).toBe('https://api.example.com/v1/search/full');
  });

  it('preserves a path prefix of the base', () => {
    expect(builder('https://gateway.example.com/talqyn').url('consultant/ask')).toBe(
      'https://gateway.example.com/talqyn/v1/consultant/ask',
    );
  });

  it('skips an empty version segment', () => {
    expect(builder('https://api.example.com', '').url('search/')).toBe('https://api.example.com/search/');
    expect(builder('https://api.example.com', '/v2/').url('search/')).toBe('https://api.example.com/v2/search/');
  });

  it('encodes query items', () => {
    expect(builder('https://api.example.com').url('consultant/chats', [['limit', '20']])).toBe(
      'https://api.example.com/v1/consultant/chats?limit=20',
    );
  });

  /** A gateway may be addressed with a query of its own; it must survive. */
  it('keeps a query of the base ahead of the request items', () => {
    expect(builder('https://gw.example.com/talqyn?key=abc').url('consultant/chats', [['limit', '20']])).toBe(
      'https://gw.example.com/talqyn/v1/consultant/chats?key=abc&limit=20',
    );
    expect(builder('https://gw.example.com/talqyn?key=abc').url('search/')).toBe(
      'https://gw.example.com/talqyn/v1/search/?key=abc',
    );
  });

  it('keeps the port of the base', () => {
    expect(builder('http://localhost:8080').url('search/')).toBe('http://localhost:8080/v1/search/');
  });

  it('escapes a session id into the path', () => {
    expect(builder('https://api.example.com').url('consultant/chats/a b?c')).toBe(
      'https://api.example.com/v1/consultant/chats/a%20b%3Fc',
    );
  });

  /** A session id is a value, not a route: `chats/../../admin` reaches the server as that string. */
  it('escapes a separator inside a segment and does not escape it twice', () => {
    expect(TalqynRequestBuilder.segment('../../admin')).toBe('..%2F..%2Fadmin');
    expect(builder('https://api.example.com').url(`consultant/chats/${TalqynRequestBuilder.segment('a/b c')}`)).toBe(
      'https://api.example.com/v1/consultant/chats/a%2Fb%20c',
    );
    expect(TalqynRequestBuilder.segment('мир')).toBe('%D0%BC%D0%B8%D1%80');
  });

  it('carries a JSON content type only with a body', () => {
    const withBody = builder('https://api.example.com').request({
      method: 'POST',
      path: 'search/',
      body: new TextEncoder().encode('{}'),
    });
    expect(withBody.headers['Content-Type']).toBe('application/json');
    expect(withBody.headers['Accept']).toBe('application/json');
    expect(withBody.headers['X-Talqyn-SDK']).toBe(Talqyn.clientHeader);

    const withoutBody = builder('https://api.example.com').request({ method: 'GET', path: 'consultant/chats' });
    expect(withoutBody.headers['Content-Type']).toBeUndefined();
    expect(withoutBody.timeoutMs).toBe(30_000);
    expect(withoutBody.keepalive).toBe(false);
  });

  it('lets the caller override a header and the timeout', () => {
    const request = builder('https://api.example.com').request({
      method: 'POST',
      path: 'consultant/ask',
      accept: 'text/event-stream',
      headers: { 'X-Request-ID': 'r1' },
      timeoutMs: 60_000,
      keepalive: true,
    });
    expect(request.headers['Accept']).toBe('text/event-stream');
    expect(request.headers['X-Request-ID']).toBe('r1');
    expect(request.timeoutMs).toBe(60_000);
    expect(request.keepalive).toBe(true);
  });

  it('reports a base URL that does not parse as a configuration error', () => {
    try {
      builder('not a url').url('search/');
      expect.unreachable('expected a configuration error');
    } catch (error) {
      expect(TalqynError.is(error) && error.kind).toBe('invalidConfiguration');
    }
  });
});
