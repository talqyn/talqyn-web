import type { TalqynFallbackReason, TalqynFeedbackReason, TalqynLocale } from '../sdk/index.js';
import { TalqynFallbackPolicy } from './client-stages.js';

/**
 * Every piece of copy the consultant screens show.
 *
 * Ships in English, Russian, and Kazakh — the locales the API serves — as plain values rather than a
 * strings table, so a site can replace a single line without shipping a bundle:
 * `{ ...TalqynUiStrings.en, placeholder: '…' }`.
 */
export interface TalqynUiStrings {
  /**
   * The locale numbers and dates are written in, as a BCP 47 tag: a rating score, a date in the
   * history. Follows the copy, not the browser — a Russian screen in an English browser still writes `4,8`.
   *
   * English uses `en-US` rather than an `en-KZ` matching the other two: the platforms disagree on what
   * `en-KZ` means — one reads it as a comma decimal separator and a 24-hour clock, the other as a dot
   * and a 12-hour clock — and the three SDKs have to write a score the same way.
   */
  readonly locale: string;
  readonly title: string;
  readonly introSubtitle: string;
  readonly placeholder: string;
  readonly thinking: string;
  readonly searching: string;
  readonly composing: string;
  readonly retry: string;
  readonly aborted: string;
  readonly redirectNotice: string;
  readonly openSearch: string;
  readonly applyFilters: string;
  readonly productsHeader: string;
  /**
   * The header over the products of a turn the consultant gave up on. They are not a recommendation on
   * top of an answer — they are all the turn has — so they do not get the ordinary header.
   */
  readonly fallbackProductsHeader: string;
  readonly comparisonTitle: string;
  readonly comparisonOnlyDifferences: string;
  readonly comparisonNoDifferences: string;
  readonly openComparison: string;
  readonly newChat: string;
  readonly newChatConfirm: string;
  readonly cancel: string;
  readonly ok: string;
  readonly close: string;
  /** The label of the button that goes back to the page the consultant was opened from. */
  readonly back: string;
  /** The prompts offered on an empty screen and after the first answer. */
  readonly exampleQuestions: readonly string[];
  readonly clarifySubmit: string;
  readonly clarifySkip: string;
  /** What is sent when the shopper skips a clarification. */
  readonly clarifySkipValue: string;
  readonly clarifyAnsweredLabel: string;
  readonly clarifyCustomPlaceholder: string;
  readonly fallbackGeneric: string;
  /**
   * Fallback copy by reason, keyed by the wire value before any `:` suffix. Each line says only what
   * went wrong; what the turn still has to offer is {@link fallbackWithProducts}, added when there is
   * something to show.
   */
  readonly fallbackByReason: Readonly<Record<string, string>>;
  /**
   * The fallback line when the turn found products anyway: `%@` is the reason. A turn that found none
   * shows the reason alone — the copy must not point at products that are not there.
   */
  readonly fallbackWithProducts: string;
  readonly errorGeneric: string;
  /** Error copy by code. */
  readonly errorByCode: Readonly<Record<string, string>>;
  /** `%@` is the formatted price. */
  readonly filterFrom: string;
  /** `%@` is the formatted price. */
  readonly filterUpTo: string;
  readonly filterDiscount: string;
  readonly scrollToBottom: string;
  readonly send: string;
  readonly stop: string;
  readonly answerReady: string;
  readonly noReviews: string;
  readonly historyTitle: string;
  readonly historyEmpty: string;
  readonly historyUntitled: string;
  readonly historyYesterday: string;
  readonly historyError: string;
  readonly historyUnavailable: string;
  readonly historyGone: string;
  readonly historyDelete: string;
  readonly historyDeleteTitle: string;
  readonly historyDeleteConfirm: string;
  /** The mark on a product card that cannot be bought right now. */
  readonly outOfStock: string;
  /**
   * "N products", one form per CLDR plural category the locale needs: `[one, few, many]` for Russian,
   * `[one, other]` for English, a single form for Kazakh. `%d` is the count. See
   * {@link TalqynUiStrings.productsCount}.
   */
  readonly productsCountForms: readonly string[];
  /** The label of the copy button under an answer. */
  readonly copyAnswer: string;
  /** What the copy button says once the answer is on the clipboard. */
  readonly copied: string;
  /** The label of the "helpful" button under an answer. */
  readonly rateHelpful: string;
  /** The label of the "not helpful" button under an answer. */
  readonly rateNotHelpful: string;
  /** The line over the reasons offered once an answer is rated unhelpful. */
  readonly feedbackReasonsTitle: string;
  /** The reasons' labels, keyed by wire value. A reason with no label here is not offered. */
  readonly feedbackReasons: Readonly<Record<string, string>>;
  /** The shopper's own message: copy it. */
  readonly copyQuestion: string;
  /** The shopper's own message: put it back into the composer to change it. */
  readonly editQuestion: string;
  /**
   * The line under the composer: the consultant can be wrong, so check its answers. `%@` is
   * {@link title}, so the line follows a screen the site renamed. Empty hides the line.
   */
  readonly disclaimer: string;
}

const en: TalqynUiStrings = Object.freeze({
  locale: 'en-US',
  title: 'AI consultant',
  introSubtitle: 'I will find products for your request and explain the choice',
  placeholder: 'Ask about products…',
  thinking: 'Thinking it over…',
  searching: 'Looking through the options…',
  composing: 'Writing the answer…',
  retry: 'Try again',
  aborted: 'Answer stopped',
  redirectNotice: 'This looks like a search query — results come up faster that way',
  openSearch: 'Open results',
  applyFilters: 'Show in search',
  productsHeader: 'Also worth a look',
  fallbackProductsHeader: 'What turned up for your request',
  comparisonTitle: 'Comparison',
  comparisonOnlyDifferences: 'Differences only',
  comparisonNoDifferences: 'Every specification matches',
  openComparison: 'Open comparison',
  newChat: 'New chat',
  newChatConfirm: 'Start a new chat? The current one stays in your history.',
  cancel: 'Cancel',
  ok: 'OK',
  close: 'Close',
  back: 'Back',
  exampleQuestions: Object.freeze([
    'Find me an affordable smartphone',
    'Which fridge should I pick for a family?',
    'A laptop for studying under 300,000 ₸',
  ]),
  clarifySubmit: 'Continue',
  clarifySkip: 'No preference',
  clarifySkipValue: 'no preference',
  clarifyAnsweredLabel: 'Your choice',
  clarifyCustomPlaceholder: 'Something else…',
  fallbackGeneric: 'Could not explain the choice',
  fallbackByReason: Object.freeze({
    // The shopper's own limit clears in hours; the account's is not theirs to wait out, and not theirs
    // to be told about.
    user_budget_exceeded: 'You have used up your questions for the next few hours',
    budget_exceeded: 'The consultant is unavailable right now',
    turn_budget: 'This chat has run too long',
    empty_answer: 'Could not put an answer together',
    timeout: 'The answer took too long',
    ttft_timeout: 'The service is answering slower than usual',
    tool_deadline: 'Could not look up the details in time',
    circuit_open: 'The consultant is temporarily unavailable',
    refusal: 'Could not answer this request',
  }),
  fallbackWithProducts: '%@, but here is what matches',
  errorGeneric: 'Could not get an answer, please try again',
  errorByCode: Object.freeze({
    retrieval_failed: 'Could not find any products, please try again',
  }),
  filterFrom: 'from %@',
  filterUpTo: 'up to %@',
  filterDiscount: 'on sale',
  scrollToBottom: 'To the latest message',
  send: 'Send',
  stop: 'Stop the answer',
  answerReady: 'Answer ready',
  noReviews: 'No reviews',
  historyTitle: 'Chat history',
  historyEmpty: 'Your chats with the AI consultant will show up here',
  historyUntitled: 'Untitled chat',
  historyYesterday: 'Yesterday',
  historyError: 'Could not load the history, please try again',
  historyUnavailable: 'Chat history is not available yet',
  historyGone: 'This chat has been deleted',
  historyDelete: 'Delete',
  historyDeleteTitle: 'Delete this chat?',
  historyDeleteConfirm: 'The conversation will be gone for good.',
  outOfStock: 'Out of stock',
  productsCountForms: Object.freeze(['%d product', '%d products']),
  copyAnswer: 'Copy the answer',
  copied: 'Copied',
  rateHelpful: 'Helpful answer',
  rateNotHelpful: 'Unhelpful answer',
  feedbackReasonsTitle: 'What went wrong?',
  feedbackReasons: Object.freeze({
    not_relevant: 'Not what I was looking for',
    wrong_info: 'Something in the answer is wrong',
    too_many_questions: 'Too many questions',
    no_answer: 'No answer',
    price_stock: 'Price or availability',
    other: 'Other',
  }),
  copyQuestion: 'Copy',
  editQuestion: 'Edit the question',
  disclaimer: '%@ can be wrong. Double-check its answers.',
});

const ru: TalqynUiStrings = Object.freeze({
  locale: 'ru-KZ',
  title: 'AI-консультант',
  introSubtitle: 'Подберу товары под ваш запрос и объясню выбор',
  placeholder: 'Спросите про товары…',
  thinking: 'Думаю над запросом…',
  searching: 'Подбираю варианты…',
  composing: 'Формулирую ответ…',
  retry: 'Повторить',
  aborted: 'Ответ остановлен',
  redirectNotice: 'Похоже на поисковый запрос — так выдача найдётся быстрее',
  openSearch: 'Открыть результаты',
  applyFilters: 'Показать в поиске',
  productsHeader: 'Также рекомендуем посмотреть',
  fallbackProductsHeader: 'Что нашлось по запросу',
  comparisonTitle: 'Сравнение',
  comparisonOnlyDifferences: 'Только отличия',
  comparisonNoDifferences: 'Все характеристики совпадают',
  openComparison: 'Открыть сравнение',
  newChat: 'Новый диалог',
  newChatConfirm: 'Начать новый диалог? Текущий сохранится в истории.',
  cancel: 'Отмена',
  ok: 'Ок',
  close: 'Закрыть',
  back: 'Назад',
  exampleQuestions: Object.freeze([
    'Подбери недорогой смартфон',
    'Какой холодильник выбрать для семьи?',
    'Ноутбук для учёбы до 300 000 ₸',
  ]),
  clarifySubmit: 'Продолжить',
  clarifySkip: 'Не важно',
  clarifySkipValue: 'не важно',
  clarifyAnsweredLabel: 'Ваш выбор',
  clarifyCustomPlaceholder: 'Свой вариант…',
  fallbackGeneric: 'Не получилось объяснить выбор',
  fallbackByReason: Object.freeze({
    // The shopper's own limit clears in hours; the account's is not theirs to wait out, and not theirs
    // to be told about.
    user_budget_exceeded: 'Лимит вопросов на ближайшие часы исчерпан',
    budget_exceeded: 'Консультант сейчас недоступен',
    turn_budget: 'Диалог получился слишком длинным',
    empty_answer: 'Не получилось сформировать ответ',
    timeout: 'Ответ занял слишком много времени',
    ttft_timeout: 'Сервис отвечает медленнее обычного',
    tool_deadline: 'Не успел уточнить детали',
    circuit_open: 'Консультант временно недоступен',
    refusal: 'Не получилось ответить на этот запрос',
  }),
  fallbackWithProducts: '%@, но вот подходящие товары',
  errorGeneric: 'Не получилось получить ответ, попробуйте ещё раз',
  errorByCode: Object.freeze({
    retrieval_failed: 'Не получилось найти товары, попробуйте ещё раз',
  }),
  filterFrom: 'от %@',
  filterUpTo: 'до %@',
  filterDiscount: 'со скидкой',
  scrollToBottom: 'К последнему сообщению',
  send: 'Отправить',
  stop: 'Остановить ответ',
  answerReady: 'Ответ готов',
  noReviews: 'Нет отзывов',
  historyTitle: 'История диалогов',
  historyEmpty: 'Здесь появятся ваши диалоги с AI-консультантом',
  historyUntitled: 'Диалог без названия',
  historyYesterday: 'Вчера',
  historyError: 'Не получилось загрузить историю, попробуйте ещё раз',
  historyUnavailable: 'История диалогов пока недоступна',
  historyGone: 'Этот диалог удалён',
  historyDelete: 'Удалить',
  historyDeleteTitle: 'Удалить диалог?',
  historyDeleteConfirm: 'Переписка удалится безвозвратно.',
  outOfStock: 'Нет в наличии',
  productsCountForms: Object.freeze(['%d товар', '%d товара', '%d товаров']),
  copyAnswer: 'Скопировать ответ',
  copied: 'Скопировано',
  rateHelpful: 'Полезный ответ',
  rateNotHelpful: 'Бесполезный ответ',
  feedbackReasonsTitle: 'Что не так?',
  feedbackReasons: Object.freeze({
    not_relevant: 'Не то, что искал',
    wrong_info: 'Ошибка в ответе',
    too_many_questions: 'Слишком много вопросов',
    no_answer: 'Нет ответа',
    price_stock: 'Цена или наличие',
    other: 'Другое',
  }),
  copyQuestion: 'Скопировать',
  editQuestion: 'Изменить вопрос',
  disclaimer: '%@ может ошибаться. Перепроверяйте ответы.',
});

const kk: TalqynUiStrings = Object.freeze({
  locale: 'kk-KZ',
  title: 'AI-кеңесші',
  introSubtitle: 'Сұранысыңызға сай тауарларды таңдап, таңдауымды түсіндіремін',
  placeholder: 'Тауарлар туралы сұраңыз…',
  thinking: 'Сұранысты ойлануда…',
  searching: 'Нұсқаларды таңдауда…',
  composing: 'Жауапты құрастыруда…',
  retry: 'Қайталау',
  aborted: 'Жауап тоқтатылды',
  redirectNotice: 'Іздеу сұранысына ұқсайды — нәтиже жылдамырақ табылады',
  openSearch: 'Нәтижелерді ашу',
  applyFilters: 'Іздеуден көрсету',
  productsHeader: 'Мынаны да қарауды ұсынамыз',
  fallbackProductsHeader: 'Сұраныс бойынша табылғаны',
  comparisonTitle: 'Салыстыру',
  comparisonOnlyDifferences: 'Тек айырмашылықтар',
  comparisonNoDifferences: 'Барлық сипаттамалар бірдей',
  openComparison: 'Салыстыруды ашу',
  newChat: 'Жаңа диалог',
  newChatConfirm: 'Жаңа диалог бастау керек пе? Ағымдағысы тарихта сақталады.',
  cancel: 'Бас тарту',
  ok: 'Жарайды',
  close: 'Жабу',
  back: 'Артқа',
  exampleQuestions: Object.freeze([
    'Арзан смартфон таңда',
    'Отбасыға қандай тоңазытқыш таңдауға болады?',
    'Оқуға арналған ноутбук, 300 000 ₸ дейін',
  ]),
  clarifySubmit: 'Жалғастыру',
  clarifySkip: 'Маңызды емес',
  clarifySkipValue: 'маңызды емес',
  clarifyAnsweredLabel: 'Сіздің таңдауыңыз',
  clarifyCustomPlaceholder: 'Өз нұсқаңыз…',
  fallbackGeneric: 'Таңдауды түсіндіру мүмкін болмады',
  fallbackByReason: Object.freeze({
    user_budget_exceeded: 'Жақын сағаттарға сұрақ лимиті таусылды',
    budget_exceeded: 'Кеңесші қазір қолжетімсіз',
    turn_budget: 'Диалог тым ұзақ болды',
    empty_answer: 'Жауап қалыптаспады',
    timeout: 'Жауап тым ұзаққа созылды',
    ttft_timeout: 'Қызмет әдеттегіден баяу жауап беруде',
    tool_deadline: 'Толық ақпаратты нақтылауға үлгермедім',
    circuit_open: 'Кеңесші уақытша қолжетімсіз',
    refusal: 'Бұл сұранысқа жауап беру мүмкін болмады',
  }),
  fallbackWithProducts: '%@, бірақ сәйкес тауарлар осында',
  errorGeneric: 'Жауап алу мүмкін болмады, қайталап көріңіз',
  errorByCode: Object.freeze({
    retrieval_failed: 'Тауарларды табу мүмкін болмады, қайталап көріңіз',
  }),
  filterFrom: '%@ бастап',
  filterUpTo: '%@ дейін',
  filterDiscount: 'жеңілдікпен',
  scrollToBottom: 'Соңғы хабарламаға',
  send: 'Жіберу',
  stop: 'Жауапты тоқтату',
  answerReady: 'Жауап дайын',
  noReviews: 'Пікірлер жоқ',
  historyTitle: 'Диалогтар тарихы',
  historyEmpty: 'Мұнда AI-кеңесшімен диалогтарыңыз шығады',
  historyUntitled: 'Атауы жоқ диалог',
  historyYesterday: 'Кеше',
  historyError: 'Тарихты жүктеу мүмкін болмады, қайталап көріңіз',
  historyUnavailable: 'Диалогтар тарихы әзірге қолжетімсіз',
  historyGone: 'Бұл диалог жойылған',
  historyDelete: 'Жою',
  historyDeleteTitle: 'Диалогты жою керек пе?',
  historyDeleteConfirm: 'Жазысу қайтарымсыз жойылады.',
  outOfStock: 'Қоймада жоқ',
  productsCountForms: Object.freeze(['%d тауар']),
  copyAnswer: 'Жауапты көшіру',
  copied: 'Көшірілді',
  rateHelpful: 'Пайдалы жауап',
  rateNotHelpful: 'Пайдасыз жауап',
  feedbackReasonsTitle: 'Не ұнамады?',
  feedbackReasons: Object.freeze({
    not_relevant: 'Іздегенім емес',
    wrong_info: 'Жауапта қате бар',
    too_many_questions: 'Сұрақ тым көп',
    no_answer: 'Жауап жоқ',
    price_stock: 'Баға не қолда бары',
    other: 'Басқа',
  }),
  copyQuestion: 'Көшіру',
  editQuestion: 'Сұрақты өзгерту',
  disclaimer: '%@ қателесуі мүмкін. Жауаптарды қайта тексеріңіз.',
});

/**
 * A line of copy under a key the server chose.
 *
 * The key is looked up among the table's own entries rather than read off it: the copy is an ordinary
 * object, so a reason or a code that happens to name a member of `Object.prototype` — `constructor`,
 * `toString`, `__proto__` — would come back as that member and be drawn into the transcript as
 * `function Object() { [native code] }`. Reasons and codes are open enumerations the server may add to
 * at any time, and a value this build does not know means "there is no copy for it", not a broken
 * screen. The iOS and Android SDKs read a dictionary, which carries no inherited keys to begin with.
 */
function copyFor(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

// A lookup keyed by the whole union rather than a chain of comparisons: a locale added to
// `TalqynLocale` without a copy set here is a compile error, the way the twin SDKs' exhaustive
// switches are, instead of a screen silently falling back to another language.
const tables: Readonly<Record<TalqynLocale, TalqynUiStrings>> = Object.freeze({ en, ru, kk });

export const TalqynUiStrings = {
  /** English. The default. */
  en,
  /** Russian. */
  ru,
  /** Kazakh. */
  kk,

  /** The strings for the locale the consultant answers in. */
  forLocale(locale: TalqynLocale): TalqynUiStrings {
    return tables[locale];
  },

  /**
   * A line with its `%@` filled in.
   *
   * Substitution is a plain replacement rather than a format: copy a site replaced may carry a bare `%`
   * — a price, a percentage — and that must not be read as a placeholder.
   */
  filled(template: string, value: string): string {
    return template.split('%@').join(value);
  },

  /** The copy for a fallback reason, generic when the reason is unknown. */
  fallbackText(strings: TalqynUiStrings, reason: TalqynFallbackReason): string {
    return copyFor(strings.fallbackByReason, TalqynFallbackPolicy.base(reason)) ?? strings.fallbackGeneric;
  },

  /** The copy for an error code, generic when the code is unknown. */
  errorText(strings: TalqynUiStrings, code: string): string {
    return copyFor(strings.errorByCode, code) ?? strings.errorGeneric;
  },

  /** The label of a feedback reason, or `undefined` when the copy has none. */
  feedbackReasonText(strings: TalqynUiStrings, reason: TalqynFeedbackReason): string | undefined {
    return copyFor(strings.feedbackReasons, reason);
  },

  /**
   * "N products" in the plural form the count calls for: one, few, or many in Russian, one or other in
   * English, the single form in Kazakh.
   */
  productsCount(strings: TalqynUiStrings, count: number): string {
    const forms = strings.productsCountForms;
    let form = forms[0];
    if (form === undefined) return String(count);
    if (forms.length >= 3) {
      // Russian: one for 1, 21, 31…; few for 2–4, 22–24…; many for the rest, 11–14 included.
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) form = forms[0]!;
      else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) form = forms[1]!;
      else form = forms[2]!;
    } else if (forms.length === 2) {
      // English: one for 1, other for everything else.
      form = count === 1 ? forms[0]! : forms[1]!;
    }
    return form.split('%d').join(String(count));
  },
} as const;
