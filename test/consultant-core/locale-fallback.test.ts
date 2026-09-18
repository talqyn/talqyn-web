import { describe, expect, it } from 'vitest';
import { TalqynChatHistory, TalqynUiStrings } from '../../src/consultant-core/index.js';

describe('dates in a locale the browser has no data for', () => {
  // Chrome ships no ICU data for Kazakh: `kk-KZ` there behaves like this unknown tag does everywhere.
  const strings: TalqynUiStrings = { ...TalqynUiStrings.kk, locale: 'xx-XX' };
  const now = new Date(2026, 8, 10, 15, 30);
  const subtitle = (date: Date): string => TalqynChatHistory.subtitle(date, strings, now);

  it('is the premise: the tag has no data', () => {
    expect(Intl.DateTimeFormat.supportedLocalesOf([strings.locale])).toEqual([]);
  });

  it('writes the time the way Kazakhstan writes it, not the English way', () => {
    expect(subtitle(new Date(2026, 8, 10, 13, 30))).toBe('13:30');
  });

  it('keeps the copy’s own word for yesterday', () => {
    expect(subtitle(new Date(2026, 8, 9, 15, 30))).toBe('Кеше');
  });

  it('writes a date in digits rather than with a month name in another language', () => {
    expect(subtitle(new Date(2026, 7, 1, 15, 30))).toBe('01.08');
    expect(subtitle(new Date(2025, 8, 10, 15, 30))).toBe('10.09.2025');
  });
});

describe('dates in a locale tag Intl would refuse', () => {
  const now = new Date(2026, 8, 10, 15, 30);

  // The iOS documentation writes locales as `Locale(identifier: "ru_KZ")`, and `Locale` takes the
  // underscore in stride; a storefront copying that spelling must not lose the history screen to it.
  it('mends the underscore spelling the iOS documentation uses', () => {
    const strings: TalqynUiStrings = { ...TalqynUiStrings.ru, locale: 'ru_KZ' };
    expect(TalqynChatHistory.subtitle(new Date(2026, 7, 1, 15, 30), strings, now)).toBe('1 авг.');
  });

  it('falls back to digits on a tag broken beyond mending, rather than throw', () => {
    const strings: TalqynUiStrings = { ...TalqynUiStrings.ru, locale: '!!' };
    expect(TalqynChatHistory.subtitle(new Date(2026, 7, 1, 15, 30), strings, now)).toBe('01.08');
    expect(TalqynChatHistory.subtitle(new Date(2026, 8, 10, 13, 30), strings, now)).toBe('13:30');
  });
});
