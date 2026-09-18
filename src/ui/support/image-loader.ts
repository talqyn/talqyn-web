/** Where a product image is shown, so a loader can ask for a size that fits. */
export interface TalqynImageRequest {
  /** The width the image is drawn at, in CSS pixels. */
  readonly width: number;
  /** The height the image is drawn at, in CSS pixels. */
  readonly height: number;
  /** The device pixel ratio of the screen: a sharp image is `width × devicePixelRatio` wide. */
  readonly devicePixelRatio: number;
}

/**
 * Decides which address a product image is loaded from.
 *
 * The browser already loads, decodes, and caches images, and every screen shares its cache: a card seen in
 * the consultant comes up at once in the comparison opened from it. What a site may still want is its own
 * image CDN — a resized variant, a different host — and this is where to ask for it.
 *
 * ```ts
 * const imageLoader: TalqynImageLoader = {
 *   source: (url, { width, devicePixelRatio }) => `${url}?w=${Math.ceil(width * devicePixelRatio)}`,
 * };
 * ```
 */
export interface TalqynImageLoader {
  /** The address to load for a catalog image, or `undefined` to show the placeholder instead. */
  source(url: string, request: TalqynImageRequest): string | undefined;
}

export const TalqynImageLoader = {
  /** Loads catalog images from the addresses the catalog gave. */
  default: Object.freeze({ source: (url: string) => url }) as TalqynImageLoader,
} as const;
