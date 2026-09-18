// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { iconSlot, setIcon } from '../../src/ui/support/dom.js';
import { tapFeedback } from '../../src/ui/support/platform.js';
import {
  applyTheme,
  paletteCss,
  TalqynTheme,
  TalqynThemeColors,
  TalqynThemeFonts,
  TalqynThemeIcons,
  TalqynThemeMetrics,
  themeProperties,
  type TalqynThemeColorsInit,
} from '../../src/ui/theme.js';

const light: TalqynThemeColorsInit = {
  accent: 'red',
  background: 'white',
  surface: 'white',
  surfaceSecondary: 'lightgray',
  border: 'gray',
  textPrimary: 'black',
  textSecondary: 'darkgray',
  textTertiary: 'gray',
};

const dark: TalqynThemeColorsInit = {
  accent: 'orange',
  background: 'black',
  surface: 'darkgray',
  surfaceSecondary: 'black',
  border: 'darkgray',
  textPrimary: 'white',
  textSecondary: 'lightgray',
  textTertiary: 'gray',
};

function kebab(role: string): string {
  return role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

describe('TalqynTheme', () => {
  it('pairs the two palettes, one per appearance', () => {
    const properties = themeProperties(TalqynTheme.create({ colors: light, darkColors: dark }));
    expect(properties['--tq-light-accent']).toBe('red');
    expect(properties['--tq-dark-accent']).toBe('orange');
    expect(properties['--tq-light-background']).toBe('white');
    expect(properties['--tq-dark-background']).toBe('black');
    expect(properties['--tq-dark-text-primary']).toBe('white');
  });

  it('pairs every role, not just the ones a screen happens to use first', () => {
    const lightColors = TalqynThemeColors.create(light);
    const darkColors = TalqynThemeColors.create(dark);
    const properties = themeProperties(TalqynTheme.create({ colors: lightColors, darkColors }));
    const roles = Object.keys(lightColors) as (keyof TalqynThemeColors)[];
    expect(roles).toHaveLength(15);
    for (const role of roles) {
      expect(properties[`--tq-light-${kebab(role)}`], `${role} does not follow the light palette`).toBe(lightColors[role]);
      expect(properties[`--tq-dark-${kebab(role)}`], `${role} does not follow the dark palette`).toBe(darkColors[role]);
    }
  });

  it('draws a brand palette in every appearance unless the site gives a dark one too', () => {
    expect(TalqynTheme.default.darkColors).toBe(TalqynThemeColors.dark);
    const branded = TalqynTheme.create({ colors: light });
    expect(branded.darkColors, 'a brand palette paired with somebody else’s dark one is nobody’s design').toBeNull();
    expect(themeProperties(branded)['--tq-dark-accent']).toBe('red');
    expect(TalqynTheme.create({ darkColors: null }).darkColors).toBeNull();

    const host = document.createElement('div');
    applyTheme(host, branded);
    expect(host.dataset['palette']).toBe('single');
    applyTheme(host, TalqynTheme.create({ colors: light, darkColors: dark }));
    expect(host.dataset['palette']).toBeUndefined();
  });

  it('keeps the default secondary surface off the background in both appearances', () => {
    for (const colors of [TalqynThemeColors.light, TalqynThemeColors.dark]) {
      expect(colors.surfaceSecondary).not.toBe(colors.background);
    }
    expect(TalqynThemeColors.light.surfaceSecondary).toBe('#E9E9EF');
  });

  it('falls the shopper’s bubble back to the accent', () => {
    const colors = TalqynThemeColors.create(light);
    expect(colors.bubble).toBe(colors.accent);
    expect(colors.onBubble).toBe(colors.onAccent);
    const own = TalqynThemeColors.create({ ...light, bubble: 'blue', onBubble: 'yellow' });
    expect(own.bubble).toBe('blue');
    expect(own.onBubble).toBe('yellow');
  });

  it('defaults every icon and takes replacements; a role set to null draws nothing', () => {
    expect(TalqynThemeIcons.default.emptyState).not.toBeNull();
    expect(TalqynThemeIcons.default.send).not.toBeNull();
    expect(TalqynThemeIcons.default.rateHelpfulOn).not.toBeNull();

    const own = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    const icons = TalqynTheme.create({ icons: { newChat: own, emptyState: null } }).icons;
    expect(icons.newChat).toBe(own);
    expect(icons.emptyState).toBeNull();
    expect(icons.history, 'replacing one role must not disturb the others').toBe(TalqynThemeIcons.default.history);

    const slot = iconSlot(own);
    expect(slot.querySelector('svg')).not.toBeNull();
    setIcon(slot, null);
    expect(slot.hidden).toBe(true);
    expect(slot.childElementCount).toBe(0);
    setIcon(slot, 'https://cdn.example/icon.png');
    expect(slot.hidden).toBe(false);
    expect(slot.querySelector('img')?.getAttribute('src'), 'a URL is drawn as an image').toBe('https://cdn.example/icon.png');
  });

  it('carries the design in the metrics until a site moves them', () => {
    const metrics = TalqynThemeMetrics.default;
    expect([
      metrics.cornerRadius,
      metrics.composerRadius,
      metrics.chipHeight,
      metrics.cardRadius,
      metrics.bubbleRadius,
      metrics.maxContentWidth,
    ]).toEqual([12, 28, 36, 8, 16, 720]);

    const square = TalqynTheme.create({ metrics: { cornerRadius: 4, composerRadius: 8, chipHeight: 28 } });
    expect(square.metrics.cardRadius, 'what the site did not move stays').toBe(8);
    const properties = themeProperties(square);
    expect(properties['--tq-corner-radius']).toBe('4px');
    expect(properties['--tq-composer-radius']).toBe('8px');
    expect(properties['--tq-chip-height']).toBe('28px');
    expect(properties['--tq-chip-radius'], 'no radius keeps a chip a pill').toBe('999px');
    expect(themeProperties(TalqynTheme.create({ metrics: { chipRadius: 6 } }))['--tq-chip-radius']).toBe('6px');
  });

  it('sets the site’s typefaces over the system stack', () => {
    const fonts = TalqynThemeFonts.custom({ regular: '"Museo Sans Cyrl"' });
    expect(fonts.regular.startsWith('"Museo Sans Cyrl", ')).toBe(true);
    expect(fonts.bold, 'bold falls back to the regular family').toBe(fonts.regular);
    expect(themeProperties(TalqynTheme.create({ fonts }))['--tq-font-regular']).toBe(fonts.regular);
  });

  it('follows the browser’s appearance by default and pins one when asked', () => {
    const host = document.createElement('div');
    applyTheme(host, TalqynTheme.default);
    expect(host.dataset['appearance']).toBe('system');
    applyTheme(host, TalqynTheme.create({ appearance: 'dark' }));
    expect(host.dataset['appearance']).toBe('dark');

    const css = paletteCss();
    expect(css).toContain(':host([data-appearance="dark"])');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':host([data-palette="single"])');
  });

  it('knocks on a tap only when the theme allows it', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      expect(TalqynTheme.default.hapticsEnabled).toBe(true);
      tapFeedback(TalqynTheme.default);
      expect(vibrate).toHaveBeenCalledTimes(1);
      tapFeedback(TalqynTheme.create({ hapticsEnabled: false }));
      expect(vibrate).toHaveBeenCalledTimes(1);
    } finally {
      delete (navigator as { vibrate?: unknown }).vibrate;
    }
  });
});
