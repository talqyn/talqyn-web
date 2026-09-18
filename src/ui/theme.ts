import { TalqynVectors } from './icons.js';

/**
 * The palette. Named by role, not by shade, so a site maps its own tokens onto it without guessing what
 * "grey 65" is for.
 *
 * Every value is a CSS color — a hex, `rgb()`, `oklch()`, or a `var(--your-token)`: custom properties of
 * the page reach the screen, so a design system's tokens can be handed over as they are.
 */
export interface TalqynThemeColors {
  /** Buttons, links, the shopper's bubble, the active state of a chip. */
  readonly accent: string;
  /** Text on {@link accent}. */
  readonly onAccent: string;
  /** The screen background. */
  readonly background: string;
  /** Cards, the composer, the header. */
  readonly surface: string;
  /** Notices, chips, the clarify card — one step off the surface. */
  readonly surfaceSecondary: string;
  /** Dividers and chip outlines. */
  readonly border: string;
  /** Body text, prices, titles. */
  readonly textPrimary: string;
  /** Secondary text: status lines, labels, product titles. */
  readonly textSecondary: string;
  /** Placeholders, struck-through prices, disabled controls. */
  readonly textTertiary: string;
  /** The shopper's own message. Defaults to {@link accent}; set it when the brand's bubble is not the brand's button. */
  readonly bubble: string;
  /** Text on {@link bubble}. Defaults to {@link onAccent}. */
  readonly onBubble: string;
  /** A turn that degraded: products are there, the text is not. */
  readonly warning: string;
  /** A turn that failed. */
  readonly error: string;
  /** The stars of a product's rating. Its own role rather than {@link warning}: a brand whose warning is orange does not necessarily want orange stars. */
  readonly rating: string;
  /**
   * What falls under the composer and the scroll-to-bottom button. Carry the strength in the alpha —
   * `rgba(0, 0, 0, 0.12)` is the default — and use `transparent` for a flat design with no shadows at all.
   */
  readonly shadow: string;
}

/** What {@link TalqynThemeColors.create} takes: the eight roles every palette names, the rest optional. */
export type TalqynThemeColorsInit = Pick<
  TalqynThemeColors,
  'accent' | 'background' | 'surface' | 'surfaceSecondary' | 'border' | 'textPrimary' | 'textSecondary' | 'textTertiary'
> &
  Partial<Pick<TalqynThemeColors, 'onAccent' | 'bubble' | 'onBubble' | 'warning' | 'error' | 'rating' | 'shadow'>>;

function createColors(init: TalqynThemeColorsInit): TalqynThemeColors {
  const onAccent = init.onAccent ?? '#FFFFFF';
  return Object.freeze({
    accent: init.accent,
    onAccent,
    background: init.background,
    surface: init.surface,
    surfaceSecondary: init.surfaceSecondary,
    border: init.border,
    textPrimary: init.textPrimary,
    textSecondary: init.textSecondary,
    textTertiary: init.textTertiary,
    bubble: init.bubble ?? init.accent,
    onBubble: init.onBubble ?? onAccent,
    warning: init.warning ?? '#FFCC00',
    error: init.error ?? '#FF3B30',
    rating: init.rating ?? '#FFCC00',
    shadow: init.shadow ?? 'rgba(0, 0, 0, 0.12)',
  });
}

export const TalqynThemeColors = {
  /** A palette from its roles; the optional ones take their defaults. */
  create: createColors,

  /** A neutral light palette that looks like nobody's brand, which is the point of a default. */
  light: createColors({
    accent: '#007AFF',
    background: '#F2F2F7',
    surface: '#FFFFFF',
    // A step off both the surface and the background: a notice or an action chip sits on the screen
    // itself, and must not vanish into it.
    surfaceSecondary: '#E9E9EF',
    border: 'rgba(60, 60, 67, 0.29)',
    textPrimary: '#000000',
    textSecondary: 'rgba(60, 60, 67, 0.6)',
    textTertiary: 'rgba(60, 60, 67, 0.3)',
  }),

  /** The dark twin of {@link TalqynThemeColors.light}. The surfaces stay apart from the background: cards drawn on a surface as black as the screen vanish into it. */
  dark: createColors({
    accent: '#0A84FF',
    background: '#000000',
    surface: '#1C1C1E',
    surfaceSecondary: '#2C2C2E',
    border: 'rgba(84, 84, 88, 0.65)',
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(235, 235, 245, 0.6)',
    textTertiary: 'rgba(235, 235, 245, 0.3)',
    warning: '#FFD60A',
    error: '#FF453A',
    rating: '#FFD60A',
    shadow: 'rgba(0, 0, 0, 0.5)',
  }),
} as const;

/** The system font stack: Cyrillic and Kazakh letters render in every browser's UI font. */
const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

/**
 * The type. The sizes follow the original design of the screen — title 18, headline 16, body 15,
 * callout 14, label and footnote 13, caption 12, micro 11 — and the site supplies the families.
 *
 * Sizes are in CSS pixels, not `rem`: a page that sets its root font size to 10px for easy arithmetic
 * must not shrink the consultant. The screen grows with the browser's zoom like the rest of the page.
 */
export interface TalqynThemeFonts {
  /** The family of regular text, as a CSS `font-family` list. */
  readonly regular: string;
  /** The family of bold text. The same as {@link regular} for a family that carries both weights. */
  readonly bold: string;
  /** The weight regular text is set in. */
  readonly regularWeight: number;
  /** The weight bold text is set in. */
  readonly boldWeight: number;
}

export const TalqynThemeFonts = {
  /** The system font at the screen's sizes. */
  system: Object.freeze({
    regular: SYSTEM_FONT_STACK,
    bold: SYSTEM_FONT_STACK,
    regularWeight: 400,
    boldWeight: 700,
  }) as TalqynThemeFonts,

  /**
   * The screen's sizes on the site's own typefaces. The faces must already be loaded by the page
   * (`@font-face`); the system stack stands behind them, so a face that fails to load falls back to the
   * system font rather than to a serif.
   *
   * @param init.regular The family of regular text, for example `"Museo Sans Cyrl"`.
   * @param init.bold The family of bold text. Defaults to the regular one.
   */
  custom(init: {
    readonly regular: string;
    readonly bold?: string;
    readonly regularWeight?: number;
    readonly boldWeight?: number;
  }): TalqynThemeFonts {
    return Object.freeze({
      regular: `${init.regular}, ${SYSTEM_FONT_STACK}`,
      bold: `${init.bold ?? init.regular}, ${SYSTEM_FONT_STACK}`,
      regularWeight: init.regularWeight ?? 400,
      boldWeight: init.boldWeight ?? 700,
    });
  },
} as const;

/**
 * An icon of the theme: SVG markup — painted with `currentColor`, so the role's color reaches it — or
 * the URL of an image, drawn as it is. `null` draws nothing.
 */
export type TalqynIcon = string | null;

/** The icons the screens draw. Named by role, like the palette. */
export interface TalqynThemeIcons {
  /** Over the title on an empty screen. */
  readonly emptyState: TalqynIcon;
  /** Opens the chat history. */
  readonly history: TalqynIcon;
  /** Starts a new chat. */
  readonly newChat: TalqynIcon;
  /** Sends the question. */
  readonly send: TalqynIcon;
  /** Stops an answer while it streams. */
  readonly stop: TalqynIcon;
  /** Jumps to the end of the transcript. */
  readonly scrollToBottom: TalqynIcon;
  /** Closes a screen the SDK opened — and the consultant itself, with the `close` navigation. */
  readonly close: TalqynIcon;
  /** Goes back from the consultant, with the `back` navigation. */
  readonly back: TalqynIcon;
  /** Confirms a copy. */
  readonly checkmark: TalqynIcon;
  /** Rates an answer up. */
  readonly rateHelpful: TalqynIcon;
  /** The same, once the shopper has. Custom art needs its own twin, or it repeats the unrated one and the tint does the talking. */
  readonly rateHelpfulOn: TalqynIcon;
  /** Rates an answer down. */
  readonly rateNotHelpful: TalqynIcon;
  /** The same, once the shopper has. */
  readonly rateNotHelpfulOn: TalqynIcon;
  /** Copies an answer. */
  readonly copyAnswer: TalqynIcon;
  /** Deletes a conversation from the history. */
  readonly deleteChat: TalqynIcon;
  /** The chip that opens a filtered listing. */
  readonly filters: TalqynIcon;
  /** The chip that opens the comparison table. */
  readonly comparison: TalqynIcon;
  /** Puts the shopper's own question back into the composer. */
  readonly editQuestion: TalqynIcon;
  /** Stands where a product image is missing or still on its way. */
  readonly imagePlaceholder: TalqynIcon;
  /** An empty star of a product's rating. */
  readonly ratingStar: TalqynIcon;
  /** A filled star of a product's rating. */
  readonly ratingStarFilled: TalqynIcon;
}

export const TalqynThemeIcons = {
  /** The icons the screens were designed on. */
  default: Object.freeze({
    emptyState: TalqynVectors.sparkles,
    history: TalqynVectors.history,
    newChat: TalqynVectors.newChat,
    send: TalqynVectors.send,
    stop: TalqynVectors.stop,
    scrollToBottom: TalqynVectors.arrowDown,
    close: TalqynVectors.close,
    back: TalqynVectors.back,
    checkmark: TalqynVectors.check,
    rateHelpful: TalqynVectors.thumbUp,
    rateHelpfulOn: TalqynVectors.thumbUpFilled,
    rateNotHelpful: TalqynVectors.thumbDown,
    rateNotHelpfulOn: TalqynVectors.thumbDownFilled,
    copyAnswer: TalqynVectors.copy,
    deleteChat: TalqynVectors.delete,
    filters: TalqynVectors.search,
    comparison: TalqynVectors.compare,
    editQuestion: TalqynVectors.edit,
    imagePlaceholder: TalqynVectors.image,
    ratingStar: TalqynVectors.starOutline,
    ratingStarFilled: TalqynVectors.star,
  }) as TalqynThemeIcons,
} as const;

/**
 * The shapes and the rhythm: what is round by how much, and how wide the margins are, in CSS pixels.
 *
 * The sizes are the screen's design; a site whose language is squarer — or rounder — moves them all from
 * one place rather than living with a consultant that rounds differently from the rest of it.
 */
export interface TalqynThemeMetrics {
  /** Cards, notices, the clarify card. Defaults to 12. */
  readonly cornerRadius: number;
  /** The composer's pill. Defaults to 28; drop it for a squarer input. */
  readonly composerRadius: number;
  /** A chip's height. Defaults to 36. */
  readonly chipHeight: number;
  /** A chip's radius. `null` — the default — keeps it a pill, whatever its height. */
  readonly chipRadius: number | null;
  /** The margin down both sides of the transcript: text, carousel, bubble, and composer line up on it. Defaults to 16. */
  readonly horizontalMargin: number;
  /** The image of a card that stands at the full width. Defaults to 84. */
  readonly rowCardImageSize: number;
  /** The width of a tile in the carousel. Defaults to 175. */
  readonly compactCardWidth: number;
  /** Product cards and the images inside them. Defaults to 8. */
  readonly cardRadius: number;
  /** The shopper's message bubble; its bottom-right corner stays square. Defaults to 16. */
  readonly bubbleRadius: number;
  /**
   * The widest the conversation column grows. On a phone the screen is narrower and this changes
   * nothing; on a wide screen a line of the answer would otherwise run the width of the display.
   * Defaults to 720.
   */
  readonly maxContentWidth: number;
}

export const TalqynThemeMetrics = {
  /** The sizes the screens were designed at. */
  default: Object.freeze({
    cornerRadius: 12,
    composerRadius: 28,
    chipHeight: 36,
    chipRadius: null,
    horizontalMargin: 16,
    rowCardImageSize: 84,
    compactCardWidth: 175,
    cardRadius: 8,
    bubbleRadius: 16,
    maxContentWidth: 720,
  }) as TalqynThemeMetrics,
} as const;

/** Which appearance the screens are drawn in: which of the two palettes is used. */
export type TalqynAppearance = 'system' | 'light' | 'dark';

/**
 * What the consultant screens look like: the site's colors, type, icons, and shapes.
 *
 * The SDK draws every element itself; the site registers the palette and the type once and every screen
 * follows it. The screens live in a shadow root: the page's own CSS does not reach inside and the SDK's
 * does not leak out, so the theme is the one way in.
 */
export interface TalqynTheme {
  /** The palette for a light appearance — or for every appearance, when {@link darkColors} is `null`. */
  readonly colors: TalqynThemeColors;
  /** The palette for a dark appearance. `null` draws {@link colors} whatever the browser is set to. */
  readonly darkColors: TalqynThemeColors | null;
  /** The type. */
  readonly fonts: TalqynThemeFonts;
  /** The icons. */
  readonly icons: TalqynThemeIcons;
  /** The shapes and margins. */
  readonly metrics: TalqynThemeMetrics;
  /** Light, dark, or whatever the browser says (`prefers-color-scheme`). */
  readonly appearance: TalqynAppearance;
  /** Whether a tap on a chip, a card, or the send button answers with a light vibration where the device has one. Off for a site with its own policy — or none. */
  readonly hapticsEnabled: boolean;
}

/** What {@link TalqynTheme.create} takes: whatever differs from the default. */
export interface TalqynThemeInit {
  readonly colors?: TalqynThemeColors | TalqynThemeColorsInit;
  /**
   * The dark palette. Left out, it is the default dark palette when {@link colors} is left out too, and
   * `null` — the one palette always — when the site gave its own colors: a brand's light palette paired
   * with somebody else's dark one would be nobody's design.
   */
  readonly darkColors?: TalqynThemeColors | TalqynThemeColorsInit | null;
  readonly fonts?: TalqynThemeFonts;
  readonly icons?: Partial<TalqynThemeIcons>;
  readonly metrics?: Partial<TalqynThemeMetrics>;
  readonly appearance?: TalqynAppearance;
  readonly hapticsEnabled?: boolean;
}

function createTheme(init: TalqynThemeInit = {}): TalqynTheme {
  const darkColors =
    init.darkColors === undefined
      ? init.colors === undefined
        ? TalqynThemeColors.dark
        : null
      : init.darkColors === null
        ? null
        : createColors(init.darkColors);
  return Object.freeze({
    colors: init.colors ? createColors(init.colors) : TalqynThemeColors.light,
    darkColors,
    fonts: init.fonts ?? TalqynThemeFonts.system,
    icons: Object.freeze({ ...TalqynThemeIcons.default, ...init.icons }),
    metrics: Object.freeze({ ...TalqynThemeMetrics.default, ...init.metrics }),
    appearance: init.appearance ?? 'system',
    hapticsEnabled: init.hapticsEnabled ?? true,
  });
}

export const TalqynTheme = {
  /** A theme from what differs from the default. */
  create: createTheme,
  /** The neutral palettes, the system font, the SDK's icons. */
  default: createTheme(),
} as const;

const colorRoles: readonly (keyof TalqynThemeColors)[] = [
  'accent',
  'onAccent',
  'background',
  'surface',
  'surfaceSecondary',
  'border',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'bubble',
  'onBubble',
  'warning',
  'error',
  'rating',
  'shadow',
];

function kebab(role: string): string {
  return role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The custom property a color role is read from inside the screens: `--tq-text-primary`. */
export function colorVariable(role: keyof TalqynThemeColors): string {
  return `--tq-${kebab(role)}`;
}

/** The CSS that resolves each role to the palette the appearance calls for. */
export function paletteCss(): string {
  const light = colorRoles.map((role) => `${colorVariable(role)}: var(--tq-light-${kebab(role)});`).join(' ');
  const dark = colorRoles.map((role) => `${colorVariable(role)}: var(--tq-dark-${kebab(role)});`).join(' ');
  return `
:host { ${light} color-scheme: light; }
:host([data-appearance="dark"]) { ${dark} color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :host([data-appearance="system"]) { ${dark} color-scheme: dark; }
}
:host([data-palette="single"]) { ${light} color-scheme: normal; }
`;
}

/**
 * The custom properties a theme puts on the host of a screen: both palettes, the type, the metrics. The
 * stylesheet reads them; changing the theme is changing these.
 */
export function themeProperties(theme: TalqynTheme): Record<string, string> {
  const properties: Record<string, string> = {};
  const dark = theme.darkColors ?? theme.colors;
  for (const role of colorRoles) {
    properties[`--tq-light-${kebab(role)}`] = theme.colors[role];
    properties[`--tq-dark-${kebab(role)}`] = dark[role];
  }
  properties['--tq-font-regular'] = theme.fonts.regular;
  properties['--tq-font-bold'] = theme.fonts.bold;
  properties['--tq-weight-regular'] = String(theme.fonts.regularWeight);
  properties['--tq-weight-bold'] = String(theme.fonts.boldWeight);
  const metrics = theme.metrics;
  properties['--tq-corner-radius'] = `${metrics.cornerRadius}px`;
  properties['--tq-composer-radius'] = `${metrics.composerRadius}px`;
  properties['--tq-chip-height'] = `${metrics.chipHeight}px`;
  properties['--tq-chip-radius'] = metrics.chipRadius === null ? '999px' : `${metrics.chipRadius}px`;
  properties['--tq-margin'] = `${metrics.horizontalMargin}px`;
  properties['--tq-row-image'] = `${metrics.rowCardImageSize}px`;
  properties['--tq-compact-width'] = `${metrics.compactCardWidth}px`;
  properties['--tq-card-radius'] = `${metrics.cardRadius}px`;
  properties['--tq-bubble-radius'] = `${metrics.bubbleRadius}px`;
  properties['--tq-max-width'] = `${metrics.maxContentWidth}px`;
  return properties;
}

/** Puts a theme on the host of a screen. */
export function applyTheme(host: HTMLElement, theme: TalqynTheme): void {
  for (const [name, value] of Object.entries(themeProperties(theme))) host.style.setProperty(name, value);
  host.dataset['appearance'] = theme.appearance;
  if (theme.darkColors === null) host.dataset['palette'] = 'single';
  else delete host.dataset['palette'];
}
