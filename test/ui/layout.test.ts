import { describe, expect, it } from 'vitest';
import { TalqynAdaptiveLayout } from '../../src/ui/index.js';

describe('TalqynAdaptiveLayout', () => {
  it('becomes regular from the configured width of the element', () => {
    expect(TalqynAdaptiveLayout.resolve(639)).toBe('compact');
    expect(TalqynAdaptiveLayout.resolve(640), 'the default threshold is inclusive').toBe('regular');
    expect(TalqynAdaptiveLayout.resolve(1440)).toBe('regular');

    const sooner = { regularMinWidth: 480 };
    expect(TalqynAdaptiveLayout.resolve(500, sooner)).toBe('regular');
    expect(TalqynAdaptiveLayout.resolve(479, sooner)).toBe('compact');
  });

  it('reads an unmeasured element as compact', () => {
    // The shape that fits everywhere: a screen that has to guess must not guess a panel into a phone.
    expect(TalqynAdaptiveLayout.resolve(undefined)).toBe('compact');
    expect(TalqynAdaptiveLayout.resolve(Number.NaN)).toBe('compact');
    expect(TalqynAdaptiveLayout.resolve(0)).toBe('compact');
  });

  it('lets a site pin the shape whatever the width says', () => {
    expect(TalqynAdaptiveLayout.resolve(320, { mode: 'regular' })).toBe('regular');
    expect(TalqynAdaptiveLayout.resolve(1920, { mode: 'compact' })).toBe('compact');
    expect(TalqynAdaptiveLayout.resolve(undefined, { mode: 'regular' })).toBe('regular');
  });

  it('falls back to a default for a width that is not one', () => {
    // A threshold computed by the site can arrive as a NaN or a negative; neither is a width, and the
    // screen must keep the shape it had rather than flip on every resize.
    for (const bad of [Number.NaN, 0, -100, Number.POSITIVE_INFINITY]) {
      expect(TalqynAdaptiveLayout.resolve(700, { regularMinWidth: bad }), `regularMinWidth ${bad}`).toBe('regular');
      expect(TalqynAdaptiveLayout.resolve(500, { regularMinWidth: bad }), `regularMinWidth ${bad}`).toBe('compact');
    }
  });

  it('writes the widths as custom properties, defaults included', () => {
    expect(TalqynAdaptiveLayout.properties()).toEqual({
      '--tq-panel-width': '720px',
      '--tq-dialog-width': '520px',
      '--tq-layer-inset': '48px',
    });
    expect(TalqynAdaptiveLayout.properties({ panelWidth: 900, dialogWidth: 460, inset: 0 })).toEqual({
      '--tq-panel-width': '900px',
      '--tq-dialog-width': '460px',
      // Zero is a choice — a panel flush with the edges — not an unset value.
      '--tq-layer-inset': '0px',
    });
    expect(TalqynAdaptiveLayout.properties({ panelWidth: Number.NaN, inset: -8 })).toEqual({
      '--tq-panel-width': '720px',
      '--tq-dialog-width': '520px',
      '--tq-layer-inset': '48px',
    });
  });
});
