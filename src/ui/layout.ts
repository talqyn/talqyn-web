/**
 * Which of the two shapes the screen lays itself out in.
 *
 * The names are UIKit's size classes, because the screen is a port of the iOS one and these are the same
 * two shapes it has there:
 *
 * - `compact` — a phone, or a narrow panel on a site. What the screen presents over itself fills it edge
 *   to edge, and a clarifying question rises from the bottom as a sheet;
 * - `regular` — a wide container. History and comparison become centered panels over a dimmed
 *   transcript, and the clarifying question becomes a centered dialog.
 *
 * Which one is in force is decided by the width of the **element**, not of the window: the consultant may
 * occupy a 380-pixel panel on a 1600-pixel page, and a panel is not a desktop.
 */
export type TalqynLayoutMode = 'compact' | 'regular';

/**
 * How the screen adapts to the box the site gives it.
 *
 * Pass it as `layout` in the consultant's options. Every field is optional, and the defaults reproduce
 * what the screen did before the option existed.
 *
 * ```ts
 * mountTalqynConsultant(container, {
 *   talqyn,
 *   // A site whose consultant lives in a wide drawer, and which wants the roomier shape sooner.
 *   layout: { regularMinWidth: 560, panelWidth: 640 },
 * });
 * ```
 */
export interface TalqynAdaptiveLayout {
  /**
   * Pins the screen to one shape whatever its container measures.
   *
   * For a site that has already decided — a consultant that is only ever a phone-width drawer, or one
   * that is only ever a desktop dialog — and does not want the shape to change under a resize.
   */
  readonly mode?: TalqynLayoutMode | undefined;

  /**
   * The element width, in CSS pixels, from which the screen lays out as `regular`. Defaults to 640.
   *
   * Measured on the element the screen was mounted into, so a site can keep the compact shape in a narrow
   * panel and get the roomy one on a full page without knowing anything about the browser window.
   */
  readonly regularMinWidth?: number | undefined;

  /** How wide history and comparison are as centered panels in `regular`. Defaults to 720. */
  readonly panelWidth?: number | undefined;

  /** How wide a clarifying question is as a centered dialog in `regular`. Defaults to 520. */
  readonly dialogWidth?: number | undefined;

  /**
   * The gap kept between a centered panel or dialog and the edges of the element, in CSS pixels.
   * Defaults to 48. A panel never grows past the element minus twice this.
   */
  readonly inset?: number | undefined;
}

/** A value that can be used as a width: a real, positive number. A `NaN` from a caller's arithmetic is not one. */
function size(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The same for a gap, where zero is a choice — a panel flush with the edges — rather than an unset value. */
function gap(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const TalqynAdaptiveLayout = {
  /** What the screen uses for whatever the site left unset. */
  defaults: Object.freeze({
    regularMinWidth: 640,
    panelWidth: 720,
    dialogWidth: 520,
    inset: 48,
  }) as Required<Omit<TalqynAdaptiveLayout, 'mode'>>,

  /**
   * The shape for a container of this width.
   *
   * A pinned `mode` wins outright. A width that has not been measured yet — an element not laid out, a
   * browser with no `ResizeObserver` — reads as `compact`: it is the shape that fits everywhere, so a
   * screen that guesses does not guess a panel into a phone.
   *
   * @param containerWidth The element's own width in CSS pixels, or `undefined` when it is not known yet.
   */
  resolve(containerWidth: number | undefined, layout: TalqynAdaptiveLayout = {}): TalqynLayoutMode {
    if (layout.mode !== undefined) return layout.mode;
    if (containerWidth === undefined || !Number.isFinite(containerWidth)) return 'compact';
    return containerWidth >= size(layout.regularMinWidth, TalqynAdaptiveLayout.defaults.regularMinWidth)
      ? 'regular'
      : 'compact';
  },

  /**
   * The widths as custom properties, for the host element.
   *
   * They travel through CSS rather than through inline styles on each layer because a layer is built long
   * after the screen: a panel presented an hour into a conversation must come up at the width the site
   * asked for at mount.
   */
  properties(layout: TalqynAdaptiveLayout = {}): Readonly<Record<string, string>> {
    const { panelWidth, dialogWidth, inset } = TalqynAdaptiveLayout.defaults;
    return {
      '--tq-panel-width': `${size(layout.panelWidth, panelWidth)}px`,
      '--tq-dialog-width': `${size(layout.dialogWidth, dialogWidth)}px`,
      '--tq-layer-inset': `${gap(layout.inset, inset)}px`,
    };
  },
} as const;
