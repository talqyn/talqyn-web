import { asRecord, readString } from '../internal/json.js';
import { utf8Decode } from '../internal/bytes.js';
import { TalqynError } from './error.js';
import { responseRetryAfterMs, type TalqynHttpResponse } from './http-transport.js';

/** An error body in both shapes the contract defines. Everything is optional: a 502 from a proxy may carry no body at all. */
export interface TalqynErrorEnvelope {
  readonly error: string | undefined;
  readonly detail: string | undefined;
  readonly fields: readonly string[];
  readonly requestId: string | undefined;
}

/**
 * Parses an error body. `detail` is a string for auth and rate limits and a list of objects for
 * `422` — one field, two shapes, decided here.
 */
export function parseErrorEnvelope(body: Uint8Array | string): TalqynErrorEnvelope | undefined {
  const text = typeof body === 'string' ? body : utf8Decode(body);
  if (text.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  if (!record) return undefined;

  let detail: string | undefined;
  let fields: string[] = [];
  const rawDetail = record['detail'];
  if (typeof rawDetail === 'string') {
    detail = rawDetail;
  } else if (Array.isArray(rawDetail)) {
    const items = rawDetail.map(validationDetail);
    if (items.every((item) => item !== undefined)) {
      const decoded = items as ValidationDetail[];
      fields = decoded.flatMap((item) => (item.loc ? [item.loc.join('.')] : []));
      detail = decoded.map((item) => item.msg ?? item.type).find((text) => text !== undefined);
    }
  }
  return { error: readString(record, 'error'), detail, fields, requestId: readString(record, 'request_id') };
}

interface ValidationDetail {
  readonly loc: string[] | undefined;
  readonly msg: string | undefined;
  readonly type: string | undefined;
}

/** One entry of a `422` detail. `loc` mixes strings and indices: `["body", "filters", 0]`. */
function validationDetail(value: unknown): ValidationDetail | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  let loc: string[] | undefined;
  const rawLoc = record['loc'];
  if (Array.isArray(rawLoc)) {
    const path: string[] = [];
    for (const part of rawLoc) {
      if (typeof part === 'string') path.push(part);
      else if (typeof part === 'number' && Number.isSafeInteger(part)) path.push(String(part));
    }
    loc = path.length === 0 ? undefined : path;
  }
  return { loc, msg: readString(record, 'msg'), type: readString(record, 'type') };
}

/**
 * Maps a server response onto an error. One mapping for every endpoint: they share status codes and
 * envelopes and must not diverge. The mint endpoint's own codes (`501`, `503`) are handled by the
 * minter before falling back to this.
 */
export function errorFromResponse(
  response: TalqynHttpResponse,
  body: Uint8Array | string,
  requestId: string | undefined,
): TalqynError {
  const envelope = parseErrorEnvelope(body);
  const id = envelope?.requestId ?? response.header('X-Request-ID') ?? requestId;
  const detail = envelope?.detail;
  const retryAfterMs = responseRetryAfterMs(response);

  switch (response.statusCode) {
    case 401:
      return TalqynError.unauthorized(clean({ detail, requestId: id }));
    case 403:
      return TalqynError.forbidden(clean({ detail, requestId: id }));
    case 404:
      return TalqynError.notFound(clean({ requestId: id }));
    case 422:
      return TalqynError.validation(clean({ fields: envelope?.fields ?? [], detail, requestId: id }));
    case 429:
      return TalqynError.rateLimited(clean({ retryAfterMs, detail, requestId: id }));
    default:
      return TalqynError.server({
        status: response.statusCode,
        ...clean({ code: envelope?.error, detail, retryAfterMs, requestId: id }),
      });
  }
}

/** Drops the keys whose value is `undefined`. */
function clean<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as { [K in keyof T]: Exclude<T[K], undefined> };
}
