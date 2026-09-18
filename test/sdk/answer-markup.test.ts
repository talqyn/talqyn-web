import { describe, expect, it } from 'vitest';
import { TalqynAnswerMarkup } from '../../src/sdk/index.js';

describe('TalqynAnswerMarkup', () => {
  it('splits text and products', () => {
    expect(TalqynAnswerMarkup.segments('Take [p:1234] — it is quieter than [p:99].')).toEqual([
      { type: 'text', text: 'Take ' },
      { type: 'product', talqynId: 1234 },
      { type: 'text', text: ' — it is quieter than ' },
      { type: 'product', talqynId: 99 },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps text without markers as one segment', () => {
    expect(TalqynAnswerMarkup.segments('plain text')).toEqual([{ type: 'text', text: 'plain text' }]);
    expect(TalqynAnswerMarkup.segments('')).toEqual([]);
  });

  it('handles markers at both ends', () => {
    expect(TalqynAnswerMarkup.segments('[p:1] and [p:2]')).toEqual([
      { type: 'product', talqynId: 1 },
      { type: 'text', text: ' and ' },
      { type: 'product', talqynId: 2 },
    ]);
  });

  it('strips markers', () => {
    expect(TalqynAnswerMarkup.stripped('Take [p:1234].')).toBe('Take .');
  });

  it('lists the mentioned ids in order, repeats included', () => {
    expect(TalqynAnswerMarkup.mentionedProductIds('[p:3] [p:1] [p:3]')).toEqual([3, 1, 3]);
  });

  it('keeps a malformed marker as text', () => {
    expect(TalqynAnswerMarkup.segments('[p:abc]')).toEqual([{ type: 'text', text: '[p:abc]' }]);
  });

  /** A marker that does not parse stays inside the text around it rather than splitting it into three runs. */
  it('merges a marker too large for an id into the text around it', () => {
    expect(TalqynAnswerMarkup.segments('a [p:99999999999999999999] b')).toEqual([
      { type: 'text', text: 'a [p:99999999999999999999] b' },
    ]);
  });

  it('does not take non-ASCII digits for an id', () => {
    expect(TalqynAnswerMarkup.segments('[p:١٢]')).toEqual([{ type: 'text', text: '[p:١٢]' }]);
  });
});
