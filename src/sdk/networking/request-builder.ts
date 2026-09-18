import { utf8Encode } from '../internal/bytes.js';
import { TALQYN_CLIENT_HEADER } from '../version.js';
import { TalqynError } from './error.js';
import type { TalqynHttpRequest } from './http-transport.js';

/** A query item: a name and its value, both unescaped. */
export type TalqynQueryItem = readonly [name: string, value: string];

function allowedBytes(punctuation: string): Set<number> {
  const allowed = new Set<number>();
  const ranges: readonly (readonly [string, string])[] = [
    ['A', 'Z'],
    ['a', 'z'],
    ['0', '9'],
  ];
  for (const [from, to] of ranges) {
    for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code++) allowed.add(code);
  }
  for (const character of punctuation) allowed.add(character.charCodeAt(0));
  return allowed;
}

/** What may stand unescaped inside one path segment: the path charset minus the separator itself. */
const segmentAllowed = allowedBytes("-._~!$&'()*+,;=:@");

/** The same, plus `%`, so that a path assembled from segments already escaped with `segment` is not escaped a second time. */
const pathAllowed = allowedBytes("-._~!$&'()*+,;=:@%");

function percentEncode(raw: string, allowed: Set<number>): string {
  let encoded = '';
  for (const byte of utf8Encode(raw)) {
    encoded += allowed.has(byte) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return encoded;
}

function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start++;
  while (end > start && value[end - 1] === '/') end--;
  return value.slice(start, end);
}

/** What {@link TalqynRequestBuilder.request} is asked to build. */
export interface TalqynRequestInit {
  readonly method: string;
  readonly path: string;
  readonly query?: readonly TalqynQueryItem[] | undefined;
  readonly body?: Uint8Array | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly accept?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly keepalive?: boolean | undefined;
}

/**
 * Builds URLs and requests.
 *
 * A separate type because the path is significant: instant search carries a trailing slash
 * (`/v1/search/`) and the rest do not, and joining must not lose it.
 */
export class TalqynRequestBuilder {
  constructor(
    readonly baseUrl: string,
    readonly apiVersion: string,
    readonly timeoutMs: number,
  ) {}

  /**
   * Escapes a value for use as one segment of a path.
   *
   * A `/` inside it becomes `%2F` rather than a separator: a session id is a value, not a route, and
   * `chats/../../admin` must reach the server as exactly that string under `chats/`.
   */
  static segment(raw: string): string {
    return percentEncode(raw, segmentAllowed);
  }

  /**
   * Joins the base, the version, and `path` into a URL.
   *
   * `path` is a `/`-separated route whose segments are escaped one by one; values that may themselves
   * contain a `/` go through {@link TalqynRequestBuilder.segment} first and pass through untouched. A
   * path prefix on the base — a gateway — is preserved, and a query on the base — a gateway key, say —
   * is kept in front of the request's own items.
   */
  url(path: string, query: readonly TalqynQueryItem[] = []): string {
    let base: URL;
    try {
      base = new URL(this.baseUrl);
    } catch {
      throw TalqynError.invalidConfiguration(`could not parse baseUrl: ${this.baseUrl}`);
    }
    let prefix = base.pathname;
    while (prefix.endsWith('/')) prefix = prefix.slice(0, -1);
    const version = percentEncode(trimSlashes(this.apiVersion), pathAllowed);
    let tail = path;
    while (tail.startsWith('/')) tail = tail.slice(1);
    const route = tail
      .split('/')
      .map((part) => percentEncode(part, pathAllowed))
      .join('/');

    const items: string[] = [];
    const baseQuery = base.search.startsWith('?') ? base.search.slice(1) : base.search;
    if (baseQuery) items.push(baseQuery);
    for (const [name, value] of query) items.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);

    return `${base.protocol}//${base.host}${prefix}${version ? `/${version}` : ''}/${route}${
      items.length === 0 ? '' : `?${items.join('&')}`
    }`;
  }

  request(init: TalqynRequestInit): TalqynHttpRequest {
    const headers: Record<string, string> = {
      Accept: init.accept ?? 'application/json',
      // Set before the caller's own headers, which may override it.
      'X-Talqyn-SDK': TALQYN_CLIENT_HEADER,
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    for (const [field, value] of Object.entries(init.headers ?? {})) headers[field] = value;
    return {
      method: init.method,
      url: this.url(init.path, init.query),
      headers,
      body: init.body,
      timeoutMs: init.timeoutMs ?? this.timeoutMs,
      signal: init.signal,
      keepalive: init.keepalive ?? false,
    };
  }
}
