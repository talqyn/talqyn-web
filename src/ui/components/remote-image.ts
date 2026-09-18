import { h, iconSlot } from '../support/dom.js';
import type { TalqynImageLoader } from '../support/image-loader.js';
import type { TalqynTheme } from '../theme.js';

/**
 * A product image that loads its content and stands in for itself until it does.
 *
 * Until the image is there — and when it never comes — a small placeholder stands in the middle, so a
 * card reads as a card with a missing picture rather than as a grey hole. A loaded image fades in; one the
 * browser already has does not.
 */
export class TalqynRemoteImage {
  readonly element: HTMLDivElement;
  private readonly image: HTMLImageElement;
  private readonly placeholder: HTMLSpanElement;
  private source: string | undefined;

  constructor(
    theme: TalqynTheme,
    private readonly loader: TalqynImageLoader,
    className = '',
  ) {
    this.placeholder = iconSlot(theme.icons.imagePlaceholder, 'tq-icon tq-image-placeholder');
    this.image = h('img', 'tq-image');
    this.image.alt = '';
    this.image.decoding = 'async';
    this.image.loading = 'lazy';
    this.image.draggable = false;
    this.image.addEventListener('load', () => this.showLoaded());
    this.image.addEventListener('error', () => this.showMissing());
    this.element = h('div', `tq-remote-image ${className}`.trim(), [this.placeholder, this.image]);
    this.showMissing();
  }

  /**
   * Shows the image at `url`, or the placeholder when there is none.
   *
   * @param size The size the image is drawn at, for a loader that asks its CDN for a fitting variant.
   */
  set(url: string | undefined, size: { readonly width: number; readonly height: number }): void {
    const devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const source = url === undefined ? undefined : this.loader.source(url, { ...size, devicePixelRatio });
    if (source === this.source) return;
    this.source = source;
    if (source === undefined) {
      this.image.removeAttribute('src');
      this.showMissing();
      return;
    }
    this.element.dataset['state'] = 'loading';
    this.image.hidden = false;
    this.image.src = source;
    // An image the browser already holds is complete at once, and comes up without a fade.
    if (this.image.complete && this.image.naturalWidth > 0) {
      this.element.dataset['instant'] = '';
      this.showLoaded();
    } else {
      delete this.element.dataset['instant'];
    }
  }

  private showLoaded(): void {
    if (this.source === undefined) return;
    this.element.dataset['state'] = 'loaded';
    this.placeholder.hidden = true;
  }

  private showMissing(): void {
    this.element.dataset['state'] = 'missing';
    this.image.hidden = true;
    this.placeholder.hidden = this.placeholder.dataset['icon'] === '';
  }
}

/** The styles of {@link TalqynRemoteImage}. */
export const remoteImageCss = `
.tq-remote-image {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--tq-card-radius);
  background: var(--tq-surface-secondary);
}
.tq-remote-image .tq-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.tq-remote-image[data-state="loaded"] .tq-image { opacity: 1; }
.tq-remote-image[data-instant] .tq-image { transition: none; }
.tq-image-placeholder { width: 20px; height: 20px; color: var(--tq-text-tertiary); }
@media (prefers-reduced-motion: reduce) {
  .tq-remote-image .tq-image { transition: none; }
}
`;
