import { paletteCss } from '../theme.js';

/**
 * The foundation every screen's stylesheet starts from: the host reset, the palette resolved for the
 * appearance, the type scale, and the controls the screens share — buttons, chips, the spinner, dialogs,
 * sheets, and full-screen layers.
 *
 * Class names carry the `tq-` prefix. Sizes are CSS pixels: a page that sets its root font size for its
 * own arithmetic must not resize the consultant.
 */
export const baseCss = `
${paletteCss()}

:host {
  all: initial;
  display: block;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
  isolation: isolate;
  font-family: var(--tq-font-regular);
  font-weight: var(--tq-weight-regular);
  font-size: 15px;
  line-height: 20px;
  color: var(--tq-text-primary);
  background: var(--tq-background);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: transparent;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
:host([hidden]) { display: none; }

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  margin: 0;
  padding: 0;
  cursor: pointer;
  touch-action: manipulation;
}
button:disabled { cursor: default; }
input, textarea { font: inherit; color: inherit; margin: 0; }
img { display: block; }
h1, h2, h3, p, ul, ol, figure { margin: 0; padding: 0; }
ul, ol { list-style: none; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--tq-accent); outline-offset: 2px; }

/* Type scale */
.tq-font-title { font-family: var(--tq-font-bold); font-weight: var(--tq-weight-bold); font-size: 18px; line-height: 24px; }
.tq-font-headline { font-family: var(--tq-font-bold); font-weight: var(--tq-weight-bold); font-size: 16px; line-height: 22px; }
.tq-font-body { font-family: var(--tq-font-regular); font-weight: var(--tq-weight-regular); font-size: 15px; line-height: 20px; }
.tq-font-body-bold { font-family: var(--tq-font-bold); font-weight: var(--tq-weight-bold); font-size: 15px; line-height: 20px; }
.tq-font-callout { font-family: var(--tq-font-regular); font-weight: var(--tq-weight-regular); font-size: 14px; line-height: 19px; }
.tq-font-label { font-family: var(--tq-font-bold); font-weight: var(--tq-weight-bold); font-size: 13px; line-height: 18px; }
.tq-font-footnote { font-family: var(--tq-font-regular); font-weight: var(--tq-weight-regular); font-size: 13px; line-height: 18px; }
.tq-font-caption-bold { font-family: var(--tq-font-bold); font-weight: var(--tq-weight-bold); font-size: 12px; line-height: 16px; }
.tq-font-caption { font-family: var(--tq-font-regular); font-weight: var(--tq-weight-regular); font-size: 12px; line-height: 16px; }
.tq-font-micro { font-family: var(--tq-font-regular); font-weight: var(--tq-weight-regular); font-size: 11px; line-height: 14px; }

.tq-text-primary { color: var(--tq-text-primary); }
.tq-text-secondary { color: var(--tq-text-secondary); }
.tq-text-tertiary { color: var(--tq-text-tertiary); }

.tq-visually-hidden {
  position: absolute !important;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* Icons: a mask the role's color paints */
.tq-icon { display: inline-flex; flex: none; width: 24px; height: 24px; align-items: center; justify-content: center; }
.tq-icon > svg, .tq-icon > img { width: 100%; height: 100%; display: block; }

/* A control drawn at its design size takes a finger-sized tap: its hit area grows to 44 × 44. */
.tq-hit { position: relative; }
.tq-hit::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: max(100%, 44px);
  height: max(100%, 44px);
  transform: translate(-50%, -50%);
}

/* Dims and shrinks while pressed, like the tappable cards and chips of the design */
.tq-pressable { transition: opacity 0.2s ease, transform 0.2s ease; }
.tq-pressable:active { opacity: 0.6; transform: scale(0.98); transition-duration: 0.08s; }

/* Buttons */
.tq-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  color: var(--tq-text-primary);
}
.tq-icon-button .tq-icon { width: 22px; height: 22px; }
.tq-icon-button:disabled { opacity: 0.4; }
@media (hover: hover) and (pointer: fine) {
  .tq-icon-button:not(:disabled):hover { background: color-mix(in srgb, var(--tq-text-primary) 7%, transparent); }
}

.tq-pill-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--tq-accent);
  background: var(--tq-accent);
  color: var(--tq-on-accent);
  font-family: var(--tq-font-bold);
  font-weight: var(--tq-weight-bold);
  font-size: 13px;
  line-height: 18px;
  text-align: center;
  transition: opacity 0.15s ease;
}
.tq-pill-button[data-style="outline"] { background: var(--tq-surface); color: var(--tq-text-primary); border-color: var(--tq-border); }
.tq-pill-button:disabled { opacity: 0.4; }
.tq-pill-button:not(:disabled):active { opacity: 0.7; }

.tq-text-button {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  color: var(--tq-accent);
  font-family: var(--tq-font-bold);
  font-weight: var(--tq-weight-bold);
  font-size: 13px;
  line-height: 18px;
}
.tq-text-button:active { opacity: 0.6; }

/* Chips */
.tq-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
.tq-chips[data-centered] { justify-content: center; }
.tq-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: var(--tq-chip-height);
  padding: 7px 16px;
  border-radius: var(--tq-chip-radius);
  border: 1px solid var(--tq-border);
  background: var(--tq-surface);
  color: var(--tq-text-primary);
  font-family: var(--tq-font-regular);
  font-weight: var(--tq-weight-regular);
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}
.tq-chip > span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.tq-chip::after { content: ''; position: absolute; left: 0; right: 0; top: -4px; bottom: -4px; }
.tq-chip[aria-pressed="true"] { background: var(--tq-accent); border-color: var(--tq-accent); color: var(--tq-on-accent); }
.tq-chip:active { opacity: 0.6; }
.tq-chip:disabled { opacity: 0.5; }

/* Spinner */
.tq-spinner {
  display: inline-block;
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  animation: tq-spin 0.8s linear infinite;
}
.tq-spinner[data-size="large"] { width: 28px; height: 28px; border-width: 3px; }
@keyframes tq-spin { to { transform: rotate(360deg); } }

/* Layers presented over a screen */
/* The layer is a container: a sheet is a sheet in a narrow screen and a dialog in a wide one, whatever the window around the page. */
.tq-layer { position: absolute; inset: 0; z-index: 20; pointer-events: none; }
.tq-layer > * { pointer-events: auto; }
.tq-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.36); animation: tq-fade-in 0.2s ease-out; }
.tq-presentation { position: absolute; inset: 0; }
/* The menu's tap catcher fills its presentation to hear a tap anywhere outside the menu. */
.tq-menu-catcher { position: absolute; inset: 0; }

.tq-fullscreen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--tq-surface);
  animation: tq-fade-in 0.2s ease-out;
}
.tq-screen-header {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 0 56px;
  background: var(--tq-surface);
  border-bottom: 0.5px solid var(--tq-border);
}
.tq-screen-header-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  color: var(--tq-text-primary);
}
.tq-screen-header-leading, .tq-screen-header-trailing {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
}
.tq-screen-header-leading { left: 6px; }
.tq-screen-header-trailing { right: 6px; }

.tq-dialog {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(320px, calc(100% - 48px));
  max-height: calc(100% - 48px);
  overflow: auto;
  transform: translate(-50%, -50%);
  padding: 20px 20px 8px;
  border-radius: 14px;
  background: var(--tq-surface);
  color: var(--tq-text-primary);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  animation: tq-pop-in 0.18s ease-out;
}
.tq-dialog-title { margin: 0 0 6px; }
.tq-dialog-message { margin: 0; color: var(--tq-text-secondary); white-space: pre-line; }
.tq-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-top: 14px; }
.tq-dialog-action {
  min-height: 44px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--tq-accent);
  font-family: var(--tq-font-bold);
  font-weight: var(--tq-weight-bold);
  font-size: 14px;
}
.tq-dialog-action[data-role="destructive"] { color: var(--tq-error); }
@media (hover: hover) and (pointer: fine) {
  .tq-dialog-action:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
}

.tq-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 24px);
  overflow: hidden;
  border-radius: 14px 14px 0 0;
  background: var(--tq-surface);
  color: var(--tq-text-primary);
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18);
  animation: tq-sheet-in 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.tq-sheet-grabber { flex: none; display: flex; justify-content: center; padding: 6px 0 2px; }
.tq-sheet-grabber::before { content: ''; width: 36px; height: 5px; border-radius: 3px; background: var(--tq-text-tertiary); }
/*
 * The roomy shape, for an element wide enough to hold a panel: history and comparison stop covering the
 * transcript and become centred panels over it, and a clarifying question becomes a dialog.
 *
 * Keyed off an attribute the screen writes from the width of its own element rather than off a container
 * query, because the threshold is the site's to set and a container query cannot take one from a custom
 * property. The widths are properties, so a site moves the threshold and the panel together.
 *
 * Only what the screen presents over itself adapts, a .tq-presentation. A comparison element on a page of
 * its own is not inside one: there the site owns the box, and a panel inside a panel is nobody's idea.
 */
:host([data-layout='regular']) .tq-sheet {
  left: 50%;
  right: auto;
  bottom: auto;
  top: 50%;
  width: min(var(--tq-dialog-width, 520px), calc(100% - var(--tq-layer-inset, 48px)));
  max-height: calc(100% - var(--tq-layer-inset, 48px));
  border-radius: 16px;
  transform: translate(-50%, -50%);
  animation: tq-pop-in 0.2s ease-out;
}
:host([data-layout='regular']) .tq-sheet-grabber { display: none; }

:host([data-layout='regular']) .tq-presentation > .tq-fullscreen {
  inset: auto;
  left: 50%;
  top: 50%;
  width: min(var(--tq-panel-width, 720px), calc(100% - var(--tq-layer-inset, 48px)));
  /*
   * As tall as what it holds, up to the room there is: a shopper with two conversations gets a panel
   * around two conversations rather than a column of empty surface. Past the cap the header stays put
   * and the body under it scrolls, the way it does when the panel fills the element.
   */
  height: auto;
  max-height: calc(100% - var(--tq-layer-inset, 48px));
  overflow: hidden;
  border-radius: 16px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
  transform: translate(-50%, -50%);
  animation: tq-pop-in 0.2s ease-out;
}

.tq-menu {
  position: absolute;
  min-width: 200px;
  padding: 6px;
  border-radius: 12px;
  background: var(--tq-surface);
  color: var(--tq-text-primary);
  border: 0.5px solid var(--tq-border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
  animation: tq-pop-in 0.14s ease-out;
}
.tq-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 8px;
  text-align: left;
}
.tq-menu-item .tq-icon { width: 18px; height: 18px; color: var(--tq-text-secondary); }
.tq-menu-item:hover, .tq-menu-item:focus-visible { background: color-mix(in srgb, var(--tq-text-primary) 7%, transparent); outline: none; }

@keyframes tq-fade-in { from { opacity: 0; } }
@keyframes tq-pop-in { from { opacity: 0; scale: 0.96; } }
@keyframes tq-sheet-in { from { transform: translateY(100%); } }

/*
 * Tap targets are sized for a finger. With a mouse or a trackpad they only add slack, so they shrink —
 * by the pointer, not by the width: a touchscreen laptop is wide and still wants a finger-sized target.
 */
@media (pointer: fine) {
  .tq-menu-item, .tq-dialog-action { min-height: 36px; }
  .tq-hit::after { width: max(100%, 32px); height: max(100%, 32px); }
}

@media (prefers-reduced-motion: reduce) {
  .tq-pressable:active { transform: none; }
  .tq-backdrop, .tq-fullscreen, .tq-dialog, .tq-sheet, .tq-menu { animation: none; }
  .tq-spinner { animation-duration: 1.6s; }
}
`;
