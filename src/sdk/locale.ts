/**
 * The language a request is served in.
 *
 * The contract accepts exactly three values, `en`, `ru`, and `kk`; anything else is rejected with
 * `422`. That is why this is a closed union rather than an open string: an unknown locale is a
 * programming error, not a value to pass through.
 */
export type TalqynLocale = 'en' | 'ru' | 'kk';

export const TalqynLocale = {
  /** English. The default. */
  en: 'en',
  /** Russian. */
  ru: 'ru',
  /** Kazakh. */
  kk: 'kk',

  /**
   * Maps a browser language onto a supported locale.
   *
   * Anything that is neither Kazakh nor Russian resolves to `en`: a tenant catalog is translated into
   * these three languages only, so falling back to the default locale is the only meaningful answer
   * for the rest.
   *
   * @param languageCode A language tag such as `"kk"`, `"kk-KZ"`, or `navigator.language`.
   */
  matching(languageCode: string | null | undefined): TalqynLocale {
    const code = languageCode?.trim().slice(0, 2).toLowerCase();
    if (code === 'kk') return 'kk';
    if (code === 'ru') return 'ru';
    return 'en';
  },
} as const;

/**
 * The ordering applied to a listing request. Values map one-to-one onto the `sort` field of
 * `POST /v1/search/full`.
 */
export type TalqynSort = 'relevance' | 'price_asc' | 'price_desc' | 'discount_desc';

export const TalqynSort = {
  /** Server-side relevance ranking. The default. */
  relevance: 'relevance',
  /** Cheapest first. */
  priceAscending: 'price_asc',
  /** Most expensive first. */
  priceDescending: 'price_desc',
  /** Deepest discount first. */
  discountDescending: 'discount_desc',
} as const;
