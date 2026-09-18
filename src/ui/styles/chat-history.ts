/**
 * The history screen: the shopper's conversations, newest first, each with a way to reopen it and a way
 * to delete it.
 */
export const chatHistoryCss = `
.tq-history .tq-screen-header-title { margin: 0; max-width: 100%; }

.tq-history-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  background: var(--tq-surface);
}

.tq-history-list { list-style: none; margin: 0; padding: 0; }

.tq-history-row {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 64px;
  padding-right: 6px;
}
.tq-history-row + .tq-history-row::before {
  content: '';
  position: absolute;
  top: 0;
  left: var(--tq-margin);
  right: var(--tq-margin);
  border-top: 0.5px solid var(--tq-border);
  pointer-events: none;
}

.tq-history-open {
  flex: 1 1 auto;
  align-self: stretch;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 12px 8px 12px var(--tq-margin);
  text-align: left;
  transition: background-color 0.15s ease;
}
.tq-history-open:focus-visible { outline-offset: -2px; }
.tq-history-open:active { background: color-mix(in srgb, var(--tq-text-primary) 8%, transparent); }
@media (hover: hover) and (pointer: fine) {
  .tq-history-open:hover { background: color-mix(in srgb, var(--tq-text-primary) 4%, transparent); }
}

.tq-history-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tq-history-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--tq-text-primary);
}
.tq-history-subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tq-text-secondary);
}

.tq-history-delete { color: var(--tq-text-tertiary); }
.tq-history-delete .tq-icon { width: 20px; height: 20px; }

.tq-history-more {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  color: var(--tq-text-secondary);
}

.tq-history-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tq-text-secondary);
}

.tq-history-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 32px;
  text-align: center;
}
.tq-history-placeholder-text { margin: 0; color: var(--tq-text-secondary); }

@media (prefers-reduced-motion: reduce) {
  .tq-history-open { transition: none; }
}
`;
