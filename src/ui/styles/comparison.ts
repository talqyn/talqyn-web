/**
 * The comparison screen: product headers across the top, characteristics down the side, values in
 * between. One scroll container holds one table, so the pinned header row and the pinned label column
 * scroll together with the values by construction rather than by mirroring two scroll views.
 */
export const comparisonCss = `
.tq-screen-header.tq-comparison-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
  padding: 0 6px 0 var(--tq-margin);
}
.tq-comparison-header .tq-screen-header-leading,
.tq-comparison-header .tq-screen-header-trailing {
  position: static;
  transform: none;
  min-width: 0;
}
.tq-comparison-header .tq-screen-header-leading { justify-self: start; }
.tq-comparison-header .tq-screen-header-trailing { justify-self: end; }
.tq-comparison-header .tq-screen-header-title { max-width: 160px; margin: 0; }

.tq-comparison-differences { max-width: 100%; }
.tq-comparison-differences-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tq-comparison-differences[aria-pressed="false"] { color: var(--tq-text-secondary); }
.tq-comparison-differences[aria-pressed="true"] { color: var(--tq-accent); }

.tq-comparison-scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--tq-surface);
}

.tq-comparison-table {
  --tq-comparison-column: 130px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  width: calc(116px + var(--tq-comparison-columns, 2) * var(--tq-comparison-column));
}
.tq-comparison-table th,
.tq-comparison-table td {
  padding: 0;
  text-align: left;
  vertical-align: middle;
}
.tq-comparison-value-column { width: var(--tq-comparison-column); }

/* Separate borders travel with the sticky cells; collapsed ones would stay behind. */
.tq-comparison-table .tq-comparison-corner,
.tq-comparison-table .tq-comparison-product {
  position: sticky;
  top: 0;
  z-index: 2;
  vertical-align: top;
  background: var(--tq-surface);
  border-bottom: 0.5px solid var(--tq-border);
}
.tq-comparison-table .tq-comparison-corner { left: 0; z-index: 3; }

.tq-comparison-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 12px;
  text-align: left;
  color: var(--tq-text-primary);
}
.tq-comparison-image { flex: none; width: 64px; height: 64px; }
.tq-comparison-card-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
  overflow-wrap: anywhere;
}
button.tq-comparison-card:focus-visible { outline-offset: -2px; }
@media (hover: hover) and (pointer: fine) {
  button.tq-comparison-card:hover { background: color-mix(in srgb, var(--tq-text-primary) 5%, transparent); }
}

/* A row's height is its minimum: a value that wraps makes the whole row taller, label included. */
.tq-comparison-table tbody tr { height: 40px; }
.tq-comparison-table .tq-comparison-label {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 10px 8px 10px var(--tq-margin);
  color: var(--tq-text-secondary);
  border-right: 0.5px solid var(--tq-border);
  overflow-wrap: anywhere;
}
.tq-comparison-table .tq-comparison-value {
  padding: 10px 12px;
  color: var(--tq-text-primary);
  overflow-wrap: anywhere;
}
/* Every cell paints its row's stripe: the pinned label cell must hide the values scrolling under it. */
.tq-comparison-table tbody tr:nth-child(odd) > * { background: var(--tq-surface); }
.tq-comparison-table tbody tr:nth-child(even) > * { background: var(--tq-surface-secondary); }

.tq-comparison-empty {
  position: sticky;
  left: 0;
  width: 100%;
  margin: 40px 0 0;
  padding: 0 calc(var(--tq-margin) * 2);
  text-align: center;
  color: var(--tq-text-secondary);
}
`;
