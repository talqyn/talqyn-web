import { TalqynError } from '../networking/error.js';
import { utf8Decode } from './bytes.js';

/**
 * Tolerant reading of Talqyn's JSON.
 *
 * Keys are named explicitly at every call site rather than derived by a naming rule: this is a
 * public contract, and a field name should be readable next to the model.
 *
 * A missing key and a `null` read the same: Talqyn serializes SSE events with `exclude_none`, so a
 * field left at its default simply never arrives. A value of an unexpected type reads as absent
 * too: one odd field must not bring down the whole response.
 */
export type JsonRecord = { readonly [key: string]: unknown };

/** The value as an object, or `undefined` for anything else — an array included. */
export function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

export function decodeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A finite number. */
export function decodeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** An integer that survives a round trip through a double. */
export function decodeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

export function readString(record: JsonRecord, key: string): string | undefined {
  return decodeString(record[key]);
}

export function readNumber(record: JsonRecord, key: string): number | undefined {
  return decodeNumber(record[key]);
}

export function readInteger(record: JsonRecord, key: string): number | undefined {
  return decodeInteger(record[key]);
}

export function readBoolean(record: JsonRecord, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** An ISO-8601 timestamp, with or without fractional seconds. */
export function readDate(record: JsonRecord, key: string): Date | undefined {
  const raw = readString(record, key);
  return raw === undefined ? undefined : parseIsoDate(raw);
}

/**
 * An array that drops the elements it cannot decode. One malformed card must cost that card, not
 * the whole page it came in. Empty when the key is absent or holds no array.
 */
export function readArray<T>(record: JsonRecord, key: string, decode: (value: unknown) => T | undefined): T[] {
  return readOptionalArray(record, key, decode) ?? [];
}

/** {@link readArray} for a field whose absence is meaningful: `undefined` when there is no array. */
export function readOptionalArray<T>(
  record: JsonRecord,
  key: string,
  decode: (value: unknown) => T | undefined,
): T[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const result: T[] = [];
  for (const element of value) {
    const decoded = decode(element);
    if (decoded !== undefined) result.push(decoded);
  }
  return result;
}

/**
 * An array decoded as a unit: `undefined` when any element does not decode. For values aligned by
 * index — the ids and titles of a comparison — where dropping one element would shift the rest.
 */
export function readStrictArray<T>(
  record: JsonRecord,
  key: string,
  decode: (value: unknown) => T | undefined,
): T[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const result: T[] = [];
  for (const element of value) {
    const decoded = decode(element);
    if (decoded === undefined) return undefined;
    result.push(decoded);
  }
  return result;
}

/**
 * Puts an entry under a key that came from the server.
 *
 * `record[key] = value` would not do: a key of `__proto__` reaches the setter inherited from
 * `Object.prototype` instead of becoming an entry, so the field silently disappears and the record's own
 * prototype is rewritten to whatever was assigned. A catalog is free to name a facet group or an
 * attribute anything at all, and a dictionary on iOS and a map on Android keep such a name like any
 * other — so this must too.
 */
export function setEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
}

/** `{string: string}`, decoded as a unit. */
export function readStringRecord(record: JsonRecord, key: string): Record<string, string> | undefined {
  const value = asRecord(record[key]);
  if (!value) return undefined;
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return undefined;
    setEntry(result, name, entry);
  }
  return result;
}

/** `{string: [string]}`, decoded as a unit. */
export function readStringArrayRecord(record: JsonRecord, key: string): Record<string, string[]> | undefined {
  const value = asRecord(record[key]);
  if (!value) return undefined;
  const result: Record<string, string[]> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!Array.isArray(entry) || !entry.every((item) => typeof item === 'string')) return undefined;
    setEntry(result, name, entry as string[]);
  }
  return result;
}

/** Parses JSON bytes. Throws on anything that is not JSON. */
export function parseJson(body: Uint8Array | string): unknown {
  return JSON.parse(typeof body === 'string' ? body : utf8Decode(body));
}

/**
 * Serializes a request body.
 *
 * `JSON.stringify` writes `Infinity` and `NaN` as `null`, which would send a price bound the caller
 * did not mean; they are refused instead, before anything is sent. Keys stay in the order they were
 * written: a mint request body is signed byte for byte. Fields left `undefined` are omitted.
 */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === 'number' && !Number.isFinite(entry)) {
      throw TalqynError.encoding(new RangeError(`${entry} is not a valid JSON number`));
    }
    return entry;
  });
}

const isoPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:(Z)|([+-])(\d{2}):?(\d{2}))$/;

/**
 * An ISO-8601 internet timestamp, with or without fractional seconds: Postgres emits `created_at`
 * both ways, and a client has no business failing on that. A timezone designator is required.
 * `T` and `Z` are uppercase only and a leap second does not parse — iOS's `ISO8601DateFormatter`
 * takes neither, and a timestamp must read as present on every platform or on none.
 */
export function parseIsoDate(raw: string): Date | undefined {
  const match = isoPattern.exec(raw.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, fraction, zulu, sign, offsetHours, offsetMinutes] = match;
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const min = Number(minute);
  const s = Number(second);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 59) return undefined;
  const milliseconds = fraction ? Math.floor(Number(`0.${fraction}`) * 1000) : 0;
  let time = Date.UTC(Number(year), m - 1, d, h, min, s, milliseconds);
  if (!zulu) {
    const offset = Number(offsetHours) * 60 + Number(offsetMinutes);
    time -= (sign === '-' ? -1 : 1) * offset * 60_000;
  }
  return Number.isFinite(time) ? new Date(time) : undefined;
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const httpDatePattern = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (?:GMT|UTC)$/;

/**
 * An RFC 7231 HTTP date, `Sun, 06 Nov 1994 08:49:37 GMT` — the form of the `Date` header and the
 * second form of `Retry-After`.
 */
export function parseHttpDate(raw: string): Date | undefined {
  const match = httpDatePattern.exec(raw.trim());
  if (!match) return undefined;
  const [, day, monthName, year, hour, minute, second] = match;
  const month = months.indexOf(monthName ?? '');
  if (month < 0) return undefined;
  const time = Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isFinite(time) ? new Date(time) : undefined;
}
