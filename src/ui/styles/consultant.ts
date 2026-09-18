/**
 * The consultant screen: its bar, the transcript with the composer floating over it on glass, the turns
 * and their cards, the clarify card and sheet, the empty screen.
 *
 * Sizes follow the iOS screen point for point. Two custom properties of the page reach in for a screen
 * shown edge to edge on a phone: `--talqyn-safe-area-top` and `--talqyn-safe-area-bottom`, typically set to
 * `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
 */
export const consultantCss = `
.tq-consultant {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--tq-background);
  color: var(--tq-text-primary);
}
.tq-appear { animation: tq-fade-in 0.2s ease-out; }

/* The bar */
.tq-header {
  position: relative;
  z-index: 4;
  flex: none;
  padding-top: var(--talqyn-safe-area-top, 0px);
  background: var(--tq-surface);
  border-bottom: 0.5px solid var(--tq-border);
}
.tq-header-content {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr);
  align-items: center;
  column-gap: 4px;
  height: 56px;
  padding: 0 6px;
}
.tq-header-side { display: flex; align-items: center; justify-self: start; }
.tq-header-side--trailing { justify-self: end; }
.tq-header-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  color: var(--tq-text-primary);
}
.tq-header .tq-icon-button[data-role="new-chat"] { color: var(--tq-accent); }

/* Everything under the bar */
.tq-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; --tq-composer-height: 96px; }

/* The transcript runs the full height; the composer floats over its bottom */
.tq-transcript {
  position: absolute;
  inset: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  overflow-anchor: none;
  outline: none;
  scrollbar-width: thin;
  scrollbar-color: var(--tq-border) transparent;
}
.tq-column { max-width: var(--tq-max-width); margin: 0 auto; padding-top: 16px; }
.tq-rows { display: flex; flex-direction: column; gap: 20px; padding-bottom: 24px; }

/* The empty screen: a third of the free space above the content, two thirds below */
.tq-empty {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: var(--tq-composer-height);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tq-empty::before { content: ''; flex: 1 0 0; }
.tq-empty::after { content: ''; flex: 2 0 0; }
.tq-empty-content {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: var(--tq-max-width);
  margin: 0 auto;
  padding: 16px var(--tq-margin);
  text-align: center;
}
.tq-empty-icon { width: 40px; height: 40px; margin-bottom: 16px; color: var(--tq-accent); }
.tq-empty-title { margin-bottom: 16px; color: var(--tq-text-primary); }
.tq-empty-subtitle { max-width: calc(100% - 2 * var(--tq-margin)); margin-bottom: 24px; color: var(--tq-text-secondary); }
.tq-empty-examples { width: 100%; margin-bottom: 28px; }
.tq-powered-by { color: var(--tq-text-tertiary); }

/* Loading a chat from history */
.tq-restore {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: var(--tq-composer-height);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tq-background);
  color: var(--tq-text-secondary);
}
.tq-restore .tq-spinner { width: 20px; height: 20px; }

/* The glass under the composer: the last rows stay visible and go soft as they slide beneath */
.tq-glass {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  height: var(--tq-composer-height);
  pointer-events: none;
  background: color-mix(in srgb, var(--tq-background) 72%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 24px);
  mask-image: linear-gradient(to bottom, transparent, #000 24px);
}
.tq-dock {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.tq-dock-inner { position: relative; width: 100%; max-width: var(--tq-max-width); pointer-events: auto; }

/* The composer */
.tq-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px var(--tq-margin) calc(8px + var(--talqyn-safe-area-bottom, 0px));
}
.tq-composer-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 4px 6px 10px;
  border-radius: var(--tq-composer-radius);
  background: var(--tq-surface);
  box-shadow: 0 4px 24px color-mix(in srgb, var(--tq-shadow) 67%, transparent);
}
.tq-composer-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 44px;
  padding: 12px 15px;
  border: 0;
  background: transparent;
  color: var(--tq-text-primary);
  resize: none;
  overflow-y: hidden;
}
.tq-composer-input::placeholder { color: var(--tq-text-tertiary); opacity: 1; }
.tq-composer-input:focus-visible { outline: none; }
.tq-composer-counter { flex: none; color: var(--tq-text-tertiary); font-variant-numeric: tabular-nums; }
.tq-composer-counter[data-over] { color: var(--tq-error); }
.tq-send {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--tq-accent);
  transition: color 0.15s ease, opacity 0.15s ease;
}
.tq-send .tq-icon { width: 34px; height: 34px; }
.tq-send:disabled { color: var(--tq-text-tertiary); }
.tq-send[data-streaming] { color: var(--tq-error); }
.tq-send:not(:disabled):active { opacity: 0.7; }
.tq-disclaimer { color: var(--tq-text-tertiary); text-align: center; }

.tq-scroll-bottom {
  position: absolute;
  right: var(--tq-margin);
  bottom: calc(100% + 4px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: var(--tq-surface);
  color: var(--tq-text-primary);
  box-shadow: 0 2px 16px var(--tq-shadow);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0s linear 0.2s;
}
.tq-scroll-bottom[data-visible] { opacity: 1; visibility: visible; transition: opacity 0.2s ease, visibility 0s; }
.tq-scroll-bottom .tq-icon { width: 18px; height: 18px; }

/* The shopper's message */
.tq-user-row { display: flex; justify-content: flex-end; padding: 0 var(--tq-margin); }
.tq-bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: var(--tq-bubble-radius) var(--tq-bubble-radius) 0 var(--tq-bubble-radius);
  background: var(--tq-bubble);
  color: var(--tq-on-bubble);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (pointer: coarse) {
  .tq-bubble { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
}

.tq-suggestions { padding: 0 var(--tq-margin); }

/* A turn */
.tq-turn { display: flex; flex-direction: column; gap: 12px; }
.tq-turn-group { display: flex; flex-direction: column; gap: 12px; padding: 0 var(--tq-margin); }
.tq-blocks { display: flex; flex-direction: column; gap: 12px; }

.tq-status { display: flex; align-items: center; gap: 8px; color: var(--tq-text-secondary); }

.tq-typing { display: flex; align-items: center; gap: 5px; height: 14px; }
.tq-typing > span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tq-text-tertiary);
  opacity: 0.25;
  animation: tq-typing 0.9s ease-in-out infinite;
}
.tq-typing > span:nth-child(2) { animation-delay: 0.15s; }
.tq-typing > span:nth-child(3) { animation-delay: 0.3s; }
@keyframes tq-typing { 50% { opacity: 1; } }

/* The answer */
.tq-answer { color: var(--tq-text-primary); line-height: 23px; overflow-wrap: break-word; }
.tq-line { min-height: 23px; white-space: pre-wrap; }
.tq-line--heading {
  font-family: var(--tq-font-bold);
  font-weight: var(--tq-weight-bold);
  font-size: 16px;
  line-height: 25px;
}
.tq-line--heading:not(:first-child) { margin-top: 2px; }
.tq-line--bullet, .tq-line--numbered { display: flex; }
.tq-line-marker { flex: none; min-width: 16px; padding-right: 4px; }
.tq-line-content { flex: 1 1 auto; min-width: 0; }
.tq-answer strong { font-family: var(--tq-font-bold); font-weight: var(--tq-weight-bold); }
.tq-mention {
  color: var(--tq-accent);
  font-family: var(--tq-font-bold);
  font-weight: var(--tq-weight-bold);
  text-decoration: none;
  cursor: pointer;
  border-radius: 2px;
}
@media (hover: hover) and (pointer: fine) {
  .tq-mention:hover { text-decoration: underline; }
}

/* Product cards */
.tq-cited { display: flex; flex-direction: column; gap: 8px; }
.tq-cited[data-pair] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }

.tq-card {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-radius: var(--tq-card-radius);
  background: var(--tq-surface);
  color: var(--tq-text-primary);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.tq-card--row { align-items: flex-start; }
.tq-card--compact, .tq-card--tile { flex-direction: column; gap: 6px; }
.tq-card--compact { flex: none; width: var(--tq-compact-width); }
.tq-card-image { flex: none; }
.tq-card--row .tq-card-image { width: var(--tq-row-image); height: var(--tq-row-image); }
.tq-card--compact .tq-card-image { width: 100%; aspect-ratio: 1; }
.tq-card--tile .tq-card-image { width: 100%; height: 96px; }
.tq-card[data-out-of-stock] .tq-card-image { opacity: 0.45; }
.tq-card-details { display: flex; flex: 1 1 auto; flex-direction: column; gap: 6px; min-width: 0; }
.tq-card--row .tq-card-details { gap: 4px; }
.tq-card-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--tq-text-secondary);
}
.tq-card[data-out-of-stock] .tq-card-title, .tq-card[data-out-of-stock] .tq-price { color: var(--tq-text-tertiary); }
.tq-rating { display: flex; align-items: center; gap: 4px; min-height: 18px; }
.tq-rating-score { color: var(--tq-text-secondary); }
.tq-rating-stars { display: flex; gap: 1px; margin-right: 2px; color: var(--tq-rating); }
.tq-icon.tq-rating-star { width: 11px; height: 12px; }
.tq-rating-reviews { color: var(--tq-text-tertiary); }
/* A price is never cut short: in a narrow tile the old price wraps under it */
.tq-price-row { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 6px; }
.tq-price { color: var(--tq-text-primary); white-space: nowrap; }
.tq-old-price { color: var(--tq-text-tertiary); white-space: nowrap; text-decoration: line-through; }
.tq-card-stock { color: var(--tq-text-secondary); }
/* Tiles of a pair are stretched to one height; the slack goes above the stock mark */
.tq-card--tile .tq-card-stock { margin-top: auto; }

.tq-site-card { display: flex; flex-direction: column; min-width: 0; cursor: pointer; }
.tq-site-card slot::slotted(*) { flex: 1 1 auto; min-width: 0; }
.tq-site-card--compact { flex: none; }
.tq-site-card--compact slot::slotted(*) { width: var(--tq-compact-width); }

/* Carousels under a turn */
.tq-product-list { display: flex; flex-direction: column; gap: 16px; }
.tq-product-section { display: flex; flex-direction: column; gap: 8px; }
.tq-section-header { padding: 0 var(--tq-margin); color: var(--tq-text-secondary); }
.tq-carousel {
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scroll-padding-inline: var(--tq-margin);
  scrollbar-width: none;
}
.tq-carousel::-webkit-scrollbar { display: none; }
.tq-carousel-track { display: flex; align-items: flex-start; gap: 10px; width: max-content; padding: 0 var(--tq-margin); }
/* With a mouse there is no swipe: the scrollbar stays, thin */
@media (hover: hover) and (pointer: fine) {
  .tq-carousel { scrollbar-width: thin; padding-bottom: 6px; }
  .tq-carousel::-webkit-scrollbar { display: block; height: 6px; }
  .tq-carousel::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--tq-border); }
}

/* Proposed actions */
.tq-actions { display: flex; flex-direction: column; gap: 12px; }
.tq-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--tq-corner-radius);
  background: var(--tq-surface-secondary);
  text-align: left;
}
.tq-action > .tq-icon { width: 18px; height: 18px; color: var(--tq-accent); }
.tq-action-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tq-action-title { color: var(--tq-accent); }
.tq-action-summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: var(--tq-text-secondary);
}

/* The clarify card */
.tq-clarify-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-radius: var(--tq-corner-radius);
  background: var(--tq-surface-secondary);
}
.tq-clarify-card[data-inactive] { opacity: 0.5; }
.tq-clarify-message { color: var(--tq-text-primary); white-space: pre-line; }
.tq-clarify-form { display: flex; flex-direction: column; gap: 12px; }
.tq-clarify-questions { display: flex; flex-direction: column; gap: 12px; }
.tq-clarify-question { display: flex; flex-direction: column; gap: 8px; }
.tq-clarify-label { color: var(--tq-text-primary); }
.tq-clarify-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid var(--tq-border);
  border-radius: max(4px, calc(var(--tq-corner-radius) - 2px));
  background: var(--tq-surface);
  color: var(--tq-text-primary);
}
.tq-clarify-input::placeholder { color: var(--tq-text-tertiary); opacity: 1; }
.tq-clarify-input:focus-visible { outline: none; border-color: var(--tq-accent); }
.tq-clarify-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tq-clarify-skip { color: var(--tq-text-secondary); }

.tq-clarify-answered {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: var(--tq-corner-radius);
  background: var(--tq-surface-secondary);
}
.tq-clarify-answered-label { color: var(--tq-text-tertiary); }
.tq-clarify-answer { color: var(--tq-text-primary); white-space: pre-line; overflow-wrap: anywhere; }

/* The clarify sheet */
.tq-clarify-sheet { transition: transform 0.2s ease; }
.tq-clarify-sheet .tq-sheet-grabber { padding: 8px 0 6px; touch-action: none; cursor: grab; }
.tq-clarify-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 10px 20px 24px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
:host([data-layout='regular']) .tq-clarify-sheet-body { padding-top: 24px; }
.tq-clarify-sheet-title { color: var(--tq-text-primary); white-space: pre-line; }
.tq-clarify-sheet-form { display: flex; flex-direction: column; gap: 28px; }
.tq-clarify-sheet-form .tq-clarify-questions { gap: 20px; }
.tq-clarify-sheet-form .tq-clarify-question { gap: 10px; }
.tq-clarify-sheet-form .tq-clarify-label { color: var(--tq-text-secondary); }
.tq-clarify-sheet-form .tq-clarify-input {
  height: 52px;
  padding: 0 14px;
  border-color: transparent;
  border-radius: var(--tq-corner-radius);
  background: var(--tq-surface-secondary);
}
.tq-clarify-sheet-footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 20px calc(8px + var(--talqyn-safe-area-bottom, 0px));
  border-top: 0.5px solid var(--tq-border);
  background: var(--tq-surface);
}
.tq-clarify-sheet-footer .tq-pill-button { width: 100%; min-height: 52px; }
.tq-clarify-sheet-footer .tq-clarify-skip { justify-content: center; min-height: 44px; }

/* Redirect and notices */
.tq-redirect {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: var(--tq-corner-radius);
  background: var(--tq-surface-secondary);
}
.tq-redirect-text { color: var(--tq-text-secondary); }
.tq-notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-radius: var(--tq-corner-radius);
  background: var(--tq-surface-secondary);
}
.tq-notice-row { display: flex; align-items: flex-start; gap: 8px; }
.tq-notice-dot { flex: none; width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--tq-text-secondary); }
.tq-notice[data-tone="warning"] .tq-notice-dot { background: var(--tq-warning); }
.tq-notice[data-tone="error"] .tq-notice-dot { background: var(--tq-error); }
.tq-notice-text { color: var(--tq-text-secondary); }

/* Rate and copy */
.tq-toolbar { display: flex; flex-direction: column; gap: 6px; }
.tq-toolbar-row { display: flex; align-items: center; gap: 2px; }
.tq-toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 32px;
  border-radius: 8px;
  color: var(--tq-text-tertiary);
}
.tq-toolbar-button .tq-icon { width: 18px; height: 18px; }
.tq-toolbar-button[aria-pressed="true"], .tq-toolbar-button[data-copied] { color: var(--tq-accent); }
.tq-toolbar-row > :nth-child(2) { margin-right: 4px; }
.tq-toolbar-divider { flex: none; width: 1px; height: 16px; margin-right: 4px; background: var(--tq-border); }
@media (hover: hover) and (pointer: fine) {
  .tq-toolbar-button:not([aria-pressed="true"]):not([data-copied]):hover { color: var(--tq-text-secondary); }
}
.tq-reasons { display: flex; flex-direction: column; gap: 8px; }
.tq-reasons-title { color: var(--tq-text-secondary); }

@media (prefers-reduced-motion: reduce) {
  .tq-appear { animation: none; }
  .tq-typing > span { animation: none; opacity: 1; }
  .tq-scroll-bottom, .tq-clarify-sheet { transition: none; }
}
`;
