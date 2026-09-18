import { describe, expect, it } from 'vitest';
import {
  TalqynClarifyDraft,
  TalqynConversation,
  TalqynFallbackPolicy,
  TalqynPriceFormatter,
  TalqynStore,
  TalqynUiStrings,
} from '../../src/consultant-core/index.js';
import type { TalqynClarifyQuestion } from '../../src/sdk/index.js';

const NBSP = ' ';

describe('TalqynUiStrings', () => {
  it('picks the Russian plural form for a count', () => {
    const counts = [1, 2, 4, 5, 11, 14, 21, 22, 25, 111];
    expect(counts.map((count) => TalqynUiStrings.productsCount(TalqynUiStrings.ru, count))).toEqual([
      '1 товар',
      '2 товара',
      '4 товара',
      '5 товаров',
      '11 товаров',
      '14 товаров',
      '21 товар',
      '22 товара',
      '25 товаров',
      '111 товаров',
    ]);
  });

  // English is the only two-form set: the rule has to read the second form, which the other two never
  // exercise.
  it('picks the English plural form for a count', () => {
    expect([1, 2, 5, 11, 21, 111].map((count) => TalqynUiStrings.productsCount(TalqynUiStrings.en, count))).toEqual([
      '1 product',
      '2 products',
      '5 products',
      '11 products',
      '21 products',
      '111 products',
    ]);
  });

  it('has one Kazakh form', () => {
    expect([1, 2, 5].map((count) => TalqynUiStrings.productsCount(TalqynUiStrings.kk, count))).toEqual([
      '1 тауар',
      '2 тауар',
      '5 тауар',
    ]);
  });

  it('labels every feedback reason the API accepts in every copy set', () => {
    const reasons = ['not_relevant', 'wrong_info', 'too_many_questions', 'no_answer', 'price_stock', 'other'];
    for (const strings of [TalqynUiStrings.en, TalqynUiStrings.ru, TalqynUiStrings.kk]) {
      for (const reason of reasons) {
        expect(TalqynUiStrings.feedbackReasonText(strings, reason), `${reason} has no label`).toBeDefined();
      }
    }
  });

  it('says different things for the two budget fallbacks, neither promising "today"', () => {
    for (const strings of [TalqynUiStrings.en, TalqynUiStrings.ru, TalqynUiStrings.kk]) {
      const own = TalqynUiStrings.fallbackText(strings, 'user_budget_exceeded');
      const account = TalqynUiStrings.fallbackText(strings, 'budget_exceeded');
      expect(own).not.toBe(account);
      expect(own.toLowerCase()).not.toMatch(/today|сегодня|бүгін/);
    }
    expect(
      TalqynUiStrings.fallbackText(TalqynUiStrings.ru, 'timeout:llm'),
      'a suffix after the colon is detail',
    ).toBe(TalqynUiStrings.fallbackText(TalqynUiStrings.ru, 'timeout'));
  });

  it('falls back to the generic line for a reason or a code named after a member of Object.prototype', () => {
    // These are open enumerations: the server may send a value this build has never heard of, and the
    // copy is an ordinary object, so `constructor` or `toString` would otherwise read off the prototype
    // and reach the transcript as `function Object() { [native code] }`.
    const inherited = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];
    for (const strings of [TalqynUiStrings.en, TalqynUiStrings.ru, TalqynUiStrings.kk]) {
      for (const key of inherited) {
        expect(TalqynUiStrings.errorText(strings, key), `errorText(${key})`).toBe(strings.errorGeneric);
        expect(TalqynUiStrings.fallbackText(strings, key), `fallbackText(${key})`).toBe(strings.fallbackGeneric);
        expect(TalqynUiStrings.fallbackText(strings, `${key}:detail`), `fallbackText(${key}:detail)`).toBe(
          strings.fallbackGeneric,
        );
        expect(TalqynUiStrings.feedbackReasonText(strings, key), `feedbackReasonText(${key})`).toBeUndefined();
      }
    }
  });

  it('fills a placeholder by replacement, leaving a bare percent sign alone', () => {
    expect(TalqynUiStrings.filled('10% off and %@', 'here')).toBe('10% off and here');
    expect(TalqynUiStrings.filled('no substitution', 'here')).toBe('no substitution');
  });

  it('follows the locale', () => {
    expect(TalqynUiStrings.forLocale('en')).toBe(TalqynUiStrings.en);
    expect(TalqynUiStrings.forLocale('kk')).toBe(TalqynUiStrings.kk);
    expect(TalqynUiStrings.forLocale('ru')).toBe(TalqynUiStrings.ru);
  });
});

describe('TalqynFallbackPolicy', () => {
  it('invites a retry only where it could work', () => {
    expect(TalqynFallbackPolicy.invitesRetry('user_budget_exceeded')).toBe(false);
    expect(TalqynFallbackPolicy.invitesRetry('budget_exceeded')).toBe(false);
    expect(TalqynFallbackPolicy.invitesRetry('turn_budget')).toBe(false);
    expect(TalqynFallbackPolicy.invitesRetry('refusal:policy')).toBe(false);
    expect(TalqynFallbackPolicy.invitesRetry('timeout')).toBe(true);
    expect(TalqynFallbackPolicy.invitesRetry('something_new')).toBe(true);
  });
});

describe('TalqynPriceFormatter', () => {
  it('writes tenge grouped by thousands with no-break spaces', () => {
    const tenge = TalqynPriceFormatter.tenge;
    expect(tenge.format(449_990)).toBe(`449${NBSP}990${NBSP}₸`);
    expect(tenge.format(1_000)).toBe(`1${NBSP}000${NBSP}₸`);
    expect(tenge.format(999)).toBe(`999${NBSP}₸`);
    expect(tenge.format(1_234.5)).toBe(`1${NBSP}234,5${NBSP}₸`);
    expect(tenge.format(449_990.004)).toBe(`449${NBSP}990${NBSP}₸`);
  });
});

describe('TalqynClarifyDraft', () => {
  const budget: TalqynClarifyQuestion = { id: 'budget', label: 'What is the budget?', multi: false, options: ['under 150k', 'under 300k'] };
  const use: TalqynClarifyQuestion = { id: 'use', label: 'What for? ', multi: true, options: ['school', 'games'] };

  it('replaces a single choice and accumulates a multiple one', () => {
    let draft = TalqynClarifyDraft.empty;
    draft = TalqynClarifyDraft.toggle(draft, 'under 150k', budget);
    draft = TalqynClarifyDraft.toggle(draft, 'under 300k', budget);
    expect(draft.selected['budget']).toEqual(['under 300k']);
    draft = TalqynClarifyDraft.toggle(draft, 'under 300k', budget);
    expect(draft.selected['budget'], 'toggling the selection off clears it').toBeUndefined();

    draft = TalqynClarifyDraft.toggle(draft, 'school', use);
    draft = TalqynClarifyDraft.toggle(draft, 'games', use);
    expect(draft.selected['use']).toEqual(['school', 'games']);
    draft = TalqynClarifyDraft.toggle(draft, 'school', use);
    expect(draft.selected['use']).toEqual(['games']);
    expect(TalqynClarifyDraft.isSelected(draft, 'games', use)).toBe(true);
  });

  it('restates labels without question marks', () => {
    let draft = TalqynClarifyDraft.empty;
    expect(TalqynClarifyDraft.isEmpty(draft)).toBe(true);
    expect(TalqynClarifyDraft.answer(draft, [budget, use])).toBe('');

    draft = TalqynClarifyDraft.toggle(draft, 'under 300k', budget);
    draft = TalqynClarifyDraft.toggle(draft, 'school', use);
    draft = TalqynClarifyDraft.toggle(draft, 'games', use);
    expect(TalqynClarifyDraft.answer(draft, [budget, use])).toBe('What is the budget: under 300k. What for: school, games.');

    draft = TalqynClarifyDraft.withCustom(draft, '  and it should be quiet  ');
    expect(TalqynClarifyDraft.answer(draft, [budget, use])).toBe('What is the budget: under 300k. What for: school, games. and it should be quiet');

    const onlyText: TalqynClarifyDraft = { selected: {}, custom: 'any' };
    expect(TalqynClarifyDraft.answer(onlyText, [budget])).toBe('any');
    expect(TalqynClarifyDraft.isEmpty(onlyText)).toBe(false);
  });
});

describe('follow-ups', () => {
  it('keep as many as the conversation says', () => {
    const sent = ['first', 'second', 'third', 'fourth'];
    expect(TalqynConversation.sanitizedFollowUps(sent), 'three by default').toHaveLength(3);
    expect(TalqynConversation.sanitizedFollowUps(sent, 1)).toEqual(['first']);
    expect(TalqynConversation.sanitizedFollowUps(sent, 0)).toEqual([]);
    expect(TalqynConversation.sanitizedFollowUps(sent, 10), 'no padding past what came').toHaveLength(4);
  });
});

describe('TalqynStore', () => {
  it('notifies once per burst of changes, with the latest state', async () => {
    const store = new TalqynStore(0);
    const seen: number[] = [];
    store.subscribe((value) => seen.push(value));
    store.set(1);
    store.set(2);
    store.update((value) => value + 1);
    expect(store.get()).toBe(3);
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual([3]);
  });

  it('stops notifying once unsubscribed', async () => {
    const store = new TalqynStore('a');
    const seen: string[] = [];
    const unsubscribe = store.subscribe((value) => seen.push(value));
    unsubscribe();
    store.set('b');
    await Promise.resolve();
    expect(seen).toEqual([]);
  });
});
