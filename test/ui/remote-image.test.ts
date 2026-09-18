// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TalqynRemoteImage } from '../../src/ui/components/remote-image.js';
import { TalqynImageLoader } from '../../src/ui/support/image-loader.js';
import { TalqynTheme } from '../../src/ui/theme.js';

const size = { width: 96, height: 96 };

function makeImage(theme = TalqynTheme.default, loader: TalqynImageLoader = TalqynImageLoader.default) {
  const remote = new TalqynRemoteImage(theme, loader);
  const img = remote.element.querySelector('img') as HTMLImageElement;
  const placeholder = remote.element.querySelector('.tq-image-placeholder') as HTMLSpanElement;
  return { remote, img, placeholder };
}

describe('TalqynRemoteImage', () => {
  it('stands in with the placeholder until the image is there', () => {
    const { remote, img, placeholder } = makeImage();
    expect(remote.element.dataset['state']).toBe('missing');
    expect(img.hidden).toBe(true);
    expect(placeholder.hidden).toBe(false);

    remote.set('https://cdn.example/a.jpg', size);
    expect(remote.element.dataset['state']).toBe('loading');
    expect(img.hidden).toBe(false);
    expect(placeholder.hidden, 'the placeholder holds the spot while the bytes come').toBe(false);

    img.dispatchEvent(new Event('load'));
    expect(remote.element.dataset['state']).toBe('loaded');
    expect(placeholder.hidden).toBe(true);
    expect(remote.element.dataset['instant'], 'a fetched image fades in').toBeUndefined();
  });

  it('reads as a card with a missing picture when the load fails', () => {
    const { remote, img, placeholder } = makeImage();
    remote.set('https://cdn.example/a.jpg', size);
    img.dispatchEvent(new Event('error'));
    expect(remote.element.dataset['state']).toBe('missing');
    expect(img.hidden).toBe(true);
    expect(placeholder.hidden).toBe(false);
  });

  it('shows the placeholder for no URL at all and forgets the previous source', () => {
    const { remote, img } = makeImage();
    remote.set('https://cdn.example/a.jpg', size);
    remote.set(undefined, size);
    expect(remote.element.dataset['state']).toBe('missing');
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('shows the placeholder when the loader withholds the address', () => {
    const loader: TalqynImageLoader = { source: () => undefined };
    const { remote, img } = makeImage(TalqynTheme.default, loader);
    remote.set('https://cdn.example/a.jpg', size);
    expect(remote.element.dataset['state']).toBe('missing');
    expect(img.hidden).toBe(true);
  });

  it('comes up without a fade when the browser already holds the image', () => {
    const { remote, img } = makeImage();
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 42 });
    remote.set('https://cdn.example/cached.jpg', size);
    expect(remote.element.dataset['state']).toBe('loaded');
    expect(remote.element.dataset['instant']).toBe('');
  });

  it('takes the same source again as a no-op', () => {
    const { remote, img } = makeImage();
    remote.set('https://cdn.example/a.jpg', size);
    img.dispatchEvent(new Event('load'));
    remote.set('https://cdn.example/a.jpg', size);
    expect(remote.element.dataset['state'], 'a re-render must not restart a finished load').toBe('loaded');
  });

  it('keeps the placeholder away when the theme carries no icon for it', () => {
    const theme: TalqynTheme = {
      ...TalqynTheme.default,
      icons: { ...TalqynTheme.default.icons, imagePlaceholder: '' },
    };
    const { remote, placeholder } = makeImage(theme);
    expect(remote.element.dataset['state']).toBe('missing');
    expect(placeholder.hidden, 'an empty icon role means no stand-in at all').toBe(true);
  });
});
