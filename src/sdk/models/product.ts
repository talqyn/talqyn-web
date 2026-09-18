import { utf8Encode } from '../internal/bytes.js';
import {
  asRecord,
  decodeString,
  readArray,
  readBoolean,
  readInteger,
  readNumber,
  readString,
} from '../internal/json.js';

/**
 * A product card.
 *
 * The same shape everywhere Talqyn returns products: instant search, listings, the consultant's
 * results, and chat transcripts.
 */
export interface TalqynProduct {
  /**
   * Talqyn's internal product id.
   *
   * It does not exist in your catalog. Its only purpose is to tie Talqyn's own responses together:
   * the `[p:ID]` markers in consultant text, click events, comparison tables, and transcript
   * hydration. To act on a product in **your** world, use {@link externalId}.
   */
  readonly talqynId: number;

  /**
   * The product id in **your** system — the offer id or SKU you supplied in the feed or push.
   * Everything you do on your side keys off this: opening a product page, adding to a cart.
   *
   * Optional by contract. A card without an external id is possible, and the SDK does not hide it:
   * whether to display such a product is the site's decision, not the SDK's.
   */
  readonly externalId: string | undefined;

  /** The product title in the requested locale. */
  readonly title: string;

  /** The product slug, when the catalog carries one. */
  readonly slug: string | undefined;

  /** The brand's display name. */
  readonly brandName: string | undefined;

  /** The brand in the form the `brandId` request parameter accepts. */
  readonly brandId: number | undefined;

  /** The brand in the form `filters.brand` accepts on a listing request. */
  readonly brandSlug: string | undefined;

  /** The brand's logo, or `undefined` when the brand has none. */
  readonly brandLogoUrl: string | undefined;

  /** The category path from root to leaf, in the requested locale. */
  readonly categoryPath: readonly string[];

  /** The current price. */
  readonly price: number | undefined;

  /** The price before the discount, or `undefined` when there is no discount. */
  readonly priceBefore: number | undefined;

  /**
   * Whether the product is in stock for the place the request named. `undefined` when the response
   * did not say: only an explicit `false` means the product cannot be bought.
   */
  readonly inStock: boolean | undefined;

  /** The average review score. */
  readonly rating: number | undefined;

  /** How many reviews the score is based on. */
  readonly reviewsCount: number;

  /** The product image. */
  readonly imageUrl: string | undefined;

  /**
   * The product page on your storefront, as the catalog gave it.
   *
   * A string out of a feed, not a checked address: the scheme is whatever was written there, so a
   * mistaken or poisoned feed can put a `javascript:` URL in this field. It is inert in an `<img>`, and
   * the SDK never navigates to it — but on the web, unlike on iOS and Android, assigning one to
   * `location.href` or to an `<a href>` runs it. Open the product by {@link externalId} through your own
   * router, which is what the screen's `onOpenProduct` is shaped for; if you must follow this address,
   * check its scheme first.
   */
  readonly productUrl: string | undefined;

  /**
   * The relevance score. `undefined` indicates degraded results — the reranker was unavailable and
   * the order comes from RRF instead. Scores are not comparable across responses.
   */
  readonly score: number | undefined;
}

/** What {@link TalqynProduct.create} takes: an id and a title, the rest optional. */
export type TalqynProductInit = Pick<TalqynProduct, 'talqynId' | 'title'> &
  Partial<Omit<TalqynProduct, 'talqynId' | 'title'>>;

export const TalqynProduct = {
  /**
   * A product card from its fields. Cards normally arrive decoded from a response; this exists for
   * previews, fixtures, and tests.
   */
  create(init: TalqynProductInit): TalqynProduct {
    return {
      talqynId: init.talqynId,
      externalId: init.externalId,
      title: init.title,
      slug: init.slug,
      brandName: init.brandName,
      brandId: init.brandId,
      brandSlug: init.brandSlug,
      brandLogoUrl: init.brandLogoUrl,
      categoryPath: init.categoryPath ?? [],
      price: init.price,
      priceBefore: init.priceBefore,
      inStock: init.inStock,
      rating: init.rating,
      reviewsCount: init.reviewsCount ?? 0,
      imageUrl: init.imageUrl,
      productUrl: init.productUrl,
      score: init.score,
    };
  },

  /** Whether there is a struck-through price to show. */
  hasDiscount(product: TalqynProduct): boolean {
    return product.price !== undefined && product.priceBefore !== undefined && product.priceBefore > product.price;
  },
} as const;

/**
 * Decodes a product card. Every field except the identifier tolerates being absent or null.
 *
 * @returns `undefined` when the card carries neither `talqyn_id` nor its legacy alias `product_id`.
 */
export function decodeProduct(value: unknown): TalqynProduct | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  // `product_id` is the legacy name of the same field. The server still accepts both, so a response
  // carrying the old one must not break.
  const talqynId = readInteger(record, 'talqyn_id') ?? readInteger(record, 'product_id');
  if (talqynId === undefined) return undefined;
  return {
    talqynId,
    externalId: readString(record, 'external_id'),
    title: readString(record, 'title') ?? '',
    slug: readString(record, 'slug'),
    brandName: readString(record, 'brand_name'),
    brandId: readInteger(record, 'brand_id'),
    brandSlug: readString(record, 'brand_slug'),
    brandLogoUrl: lenientUrl(readString(record, 'brand_logo_url')),
    categoryPath: readArray(record, 'category_path', decodeString),
    price: readNumber(record, 'price'),
    priceBefore: readNumber(record, 'price_before'),
    inStock: readBoolean(record, 'in_stock'),
    rating: readNumber(record, 'rating'),
    reviewsCount: readInteger(record, 'reviews_count') ?? 0,
    imageUrl: lenientUrl(readString(record, 'image_url')),
    productUrl: lenientUrl(readString(record, 'url')),
    score: readNumber(record, 'score'),
  };
}

/** What a URL carries as it is, besides ASCII letters and digits. `%` and `#` have rules of their own; `[` and `]` belong to IPv6 hosts only. */
const keptPunctuation = new Set(Array.from("-._~:/?@!$&'()*+,;=", (character) => character.charCodeAt(0)));
const hexDigits = '0123456789ABCDEF';

function isAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isHexDigit(code: number | undefined): boolean {
  return (
    code !== undefined &&
    ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66))
  );
}

/**
 * A URL from a catalog string, parsed leniently: real feeds contain spaces and non-ASCII characters
 * in paths, where a strict parser gives up — an image must not vanish over that.
 *
 * A string that is a valid URL as written is taken as written. Otherwise what a URL may not carry is
 * percent-encoded and what it may is kept. An escape already in place stays as it is — encoding its
 * `%` again would ask for another file — while a stray `%` is encoded. The first `#` starts the
 * fragment; a later one is part of it. The iOS and Android SDKs walk the same bytes the same way, so a
 * product shows the same image on every platform.
 *
 * Escaping only: the scheme is not judged, so that a storefront's own deep link survives and so that
 * the three SDKs keep decoding a response into the same bytes. What that means for
 * {@link TalqynProduct.productUrl} is written on the field.
 */
export function lenientUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  if (isValidAsWritten(raw)) return raw;
  const encoded = percentEncoded(raw);
  return isValidAsWritten(encoded) ? encoded : undefined;
}

/**
 * Whether a string is a URL exactly as written: only characters a URL may carry, each escape
 * complete, one fragment, and an authority shaped `[userinfo@]host[:port]`.
 *
 * The authority rules mirror what Foundation's parser accepts on iOS, measured case by case, so that
 * a malformed feed address still comes out byte for byte the same on both platforms: one `@` at
 * most, everything after the host's first `:` a digit (an empty port passes, an escape does not),
 * and brackets only when they wrap the whole host — inside them a `%` may only start the `%25` zone
 * delimiter of an IPv6 scope, after which complete escapes pass, while `@` and nested brackets do
 * not parse.
 */
function isValidAsWritten(value: string): boolean {
  const authorityStart = value.indexOf('//');
  let authorityEnd = -1;
  let userinfoEnd = -1;
  let hostStart = -1;
  if (authorityStart >= 0) {
    authorityEnd = value.length;
    for (let index = authorityStart + 2; index < value.length; index++) {
      const character = value[index];
      if (character === '/' || character === '?' || character === '#') {
        authorityEnd = index;
        break;
      }
    }
    hostStart = authorityStart + 2;
    const at = value.indexOf('@', hostStart);
    if (at >= 0 && at < authorityEnd) {
      userinfoEnd = at;
      hostStart = at + 1;
    }
  }
  let literalStart = -1;
  let literalEnd = -1;
  if (hostStart >= 0 && value.charCodeAt(hostStart) === 0x5b) {
    const close = value.indexOf(']', hostStart);
    if (close >= 0 && close < authorityEnd && isPortOrNothing(value, close + 1, authorityEnd)) {
      literalStart = hostStart;
      literalEnd = close;
    }
  }
  if (hostStart >= 0 && literalStart < 0) {
    const colon = value.indexOf(':', hostStart);
    if (colon >= 0 && colon < authorityEnd && !isPortOrNothing(value, colon, authorityEnd)) return false;
  }
  let hasFragment = false;
  let hasZone = false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (literalStart >= 0 && index > literalStart && index < literalEnd) {
      if (code === 0x25) {
        if (value.startsWith('25', index + 1)) {
          hasZone = true;
          continue;
        }
        if (hasZone && isHexDigit(value.charCodeAt(index + 1)) && isHexDigit(value.charCodeAt(index + 2))) continue;
        return false;
      }
      if (code === 0x40 || code === 0x5b || code === 0x5d) return false;
      if (isAlphanumeric(code) || keptPunctuation.has(code)) continue;
      return false;
    }
    if (code === 0x5b || code === 0x5d) {
      if (index === literalStart || index === literalEnd) continue;
      return false;
    }
    if (code === 0x40 && index >= authorityStart + 2 && index < authorityEnd && index !== userinfoEnd) return false;
    if (code === 0x25) {
      if (!isHexDigit(value.charCodeAt(index + 1)) || !isHexDigit(value.charCodeAt(index + 2))) return false;
      continue;
    }
    if (code === 0x23) {
      if (hasFragment) return false;
      hasFragment = true;
      continue;
    }
    if (isAlphanumeric(code) || keptPunctuation.has(code)) continue;
    return false;
  }
  return true;
}

/** Whether `[start, end)` is empty or a `:` followed by digits only — the port an IP-literal may carry. */
function isPortOrNothing(value: string, start: number, end: number): boolean {
  if (start === end) return true;
  if (value.charCodeAt(start) !== 0x3a) return false;
  for (let index = start + 1; index < end; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x30 || code > 0x39) return false;
  }
  return true;
}

/** The string's UTF-8 bytes with everything a URL may not carry percent-encoded, in uppercase hex. */
function percentEncoded(raw: string): string {
  const bytes = utf8Encode(raw);
  let encoded = '';
  let hasFragment = false;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    let keeps: boolean;
    if (byte === 0x25) {
      keeps = index + 2 < bytes.length && isHexDigit(bytes[index + 1]) && isHexDigit(bytes[index + 2]);
    } else if (byte === 0x23) {
      keeps = !hasFragment;
      hasFragment = true;
    } else {
      keeps = isAlphanumeric(byte) || keptPunctuation.has(byte);
    }
    encoded += keeps ? String.fromCharCode(byte) : `%${hexDigits[byte >> 4]}${hexDigits[byte & 0x0f]}`;
  }
  return encoded;
}
