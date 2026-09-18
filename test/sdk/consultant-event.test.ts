import { describe, expect, it } from 'vitest';
import { TalqynConsultantEvent, TalqynFallbackReason } from '../../src/sdk/index.js';

function event(name: string, data: string): TalqynConsultantEvent | undefined {
  return TalqynConsultantEvent.parse({ name, data });
}

describe('TalqynConsultantEvent', () => {
  it('parses status, products, delta, and done', () => {
    expect(event('status', '{"stage":"thinking"}')).toEqual({ type: 'status', stage: 'thinking' });
    expect(event('delta', '{"text":"hi"}')).toEqual({ type: 'delta', text: 'hi' });

    const products = event('products', '{"items":[{"talqyn_id":1,"title":"A"}],"search_id":"s1"}');
    if (products?.type !== 'products') throw new Error('expected a products event');
    expect(products.products.items).toHaveLength(1);
    expect(products.products.searchId).toBe('s1');
    expect(products.products.groups).toBeUndefined();

    const done = event('done', '{"session_id":"abc","ttft_ms":320,"total_ms":1800}');
    if (done?.type !== 'done') throw new Error('expected a done event');
    expect(done.done.sessionId).toBe('abc');
    expect(done.done.timeToFirstTokenMs).toBe(320);
    expect(done.done.totalMs).toBe(1800);
    expect(done.done.turnId).toBeUndefined();
    expect(TalqynConsultantEvent.isTerminal(done)).toBe(true);
    expect(TalqynConsultantEvent.isTerminal({ type: 'delta', text: '' })).toBe(false);
  });

  it('carries the groups of a multi-step plan', () => {
    const products = event(
      'products',
      '{"items":[{"talqyn_id":1,"title":"A"}],"groups":[{"role":"sofa","items":[{"talqyn_id":1,"title":"A"}]}]}',
    );
    if (products?.type !== 'products') throw new Error('expected a products event');
    expect(products.products.groups?.[0]?.role).toBe('sofa');
  });

  it('parses a clarification', () => {
    const clarify = event(
      'clarify',
      '{"message":"clarify","questions":[{"id":"budget","label":"Budget","multi":false,"options":["under 300k"]}]}',
    );
    if (clarify?.type !== 'clarify') throw new Error('expected a clarify event');
    expect(clarify.clarify.message).toBe('clarify');
    expect(clarify.clarify.questions[0]).toEqual({ id: 'budget', label: 'Budget', multi: false, options: ['under 300k'] });
  });

  it('accepts both names of the redirect', () => {
    expect(event('redirect_to_search', '{"query":"iphone"}')).toEqual({ type: 'redirectToSearch', query: 'iphone' });
    expect(event('redirect', '{"query":"iphone"}')).toEqual({ type: 'redirectToSearch', query: 'iphone' });
  });

  it('keeps the fallback reasons an open set', () => {
    expect(event('fallback', '{"reason":"budget_exceeded"}')).toEqual({ type: 'fallback', reason: 'budget_exceeded' });
    const unknown = event('fallback', '{"reason":"provider_meltdown"}');
    // An unknown reason must arrive, not be dropped.
    if (unknown?.type !== 'fallback') throw new Error('expected a fallback event');
    expect(unknown.reason).toBe('provider_meltdown');
    expect(TalqynFallbackReason.isBudgetExhausted(unknown.reason)).toBe(false);
  });

  it('parses a comparison action', () => {
    const action = event(
      'action',
      '{"type":"show_comparison","table":{"talqyn_ids":[1,2],"titles":["A","B"],"rows":[{"label":"Screen","values":["15\\"",null]}]}}',
    );
    if (action?.type !== 'action' || action.action.type !== 'showComparison') throw new Error('expected a comparison');
    expect(action.action.table.talqynIds).toEqual([1, 2]);
    const values = action.action.table.rows[0]?.values;
    expect(values).toHaveLength(2);
    expect(values?.[0]).toBe('15"');
    // A missing characteristic is null, not an empty string.
    expect(values?.[1]).toBeNull();
  });

  it('decodes misaligned comparison ids and titles as nothing rather than shifted', () => {
    const action = event(
      'action',
      '{"type":"show_comparison","table":{"talqyn_ids":[1,"x",2],"titles":["A",3],"rows":[{"label":"a","values":["1",2]},"junk"]}}',
    );
    if (action?.type !== 'action' || action.action.type !== 'showComparison') throw new Error('expected a comparison');
    expect(action.action.table.talqynIds).toEqual([]);
    expect(action.action.table.titles).toEqual([]);
    expect(action.action.table.rows).toEqual([{ label: 'a', values: [] }]);
  });

  it('parses a filters action with its defaults', () => {
    const action = event('action', '{"type":"apply_filters","filters":{"price_max":300000}}');
    if (action?.type !== 'action' || action.action.type !== 'applyFilters') throw new Error('expected filters');
    expect(action.action.filters.priceMax).toBe(300_000);
    expect(action.action.filters.hasDiscount).toBe(false);
    expect(action.action.filters.filters).toEqual({});
    expect(action.action.filters.attributes).toEqual({});
  });

  it('does not break a turn on an unknown action type', () => {
    expect(event('action', '{"type":"open_cart"}')).toEqual({ type: 'action', action: { type: 'unknown', rawType: 'open_cart' } });
  });

  it('parses follow-ups and errors', () => {
    expect(event('follow_ups', '{"items":["which one is quieter?"]}')).toEqual({ type: 'followUps', items: ['which one is quieter?'] });
    expect(event('error', '{"code":"retrieval_failed"}')).toEqual({ type: 'error', code: 'retrieval_failed' });
  });

  /** A new server-side event type must not break a shipped site. */
  it('skips an unknown event', () => {
    expect(event('telemetry', '{}')).toBeUndefined();
  });

  it('skips a payload that is not an object', () => {
    expect(event('delta', 'not json')).toBeUndefined();
    expect(event('delta', '[]')).toBeUndefined();
    expect(event('done', '"done"')).toBeUndefined();
  });

  it('keeps an unknown stage', () => {
    expect(event('status', '{"stage":"composing"}')).toEqual({ type: 'status', stage: 'composing' });
  });
});
