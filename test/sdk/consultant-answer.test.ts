import { describe, expect, it } from 'vitest';
import type { Talqyn } from '../../src/sdk/index.js';

describe('consultant.answer', () => {
  it('takes a session only next to a plain question: a query names its own', () => {
    // Checked by the compiler (`npm run typecheck`) and never run: a session passed next to a query was
    // once accepted and silently dropped.
    const calls = (talqyn: Talqyn): void => {
      void talqyn.consultant.answer('hi', { sessionId: 'sess-1' });
      void talqyn.consultant.answer({ question: 'hi', sessionId: 'sess-1' });
      // @ts-expect-error A query carries its session itself.
      void talqyn.consultant.answer({ question: 'hi' }, { sessionId: 'sess-1' });
    };
    expect(calls).toBeTypeOf('function');
  });
});
