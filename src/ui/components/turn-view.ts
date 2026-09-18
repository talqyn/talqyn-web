import {
  TalqynClarifyDraft,
  TalqynClientStage,
  TalqynConversationLimits,
  TalqynUiStrings,
  type TalqynAnswerRating,
} from '../../consultant-core/index.js';
import type {
  TalqynActionFilters,
  TalqynClarify,
  TalqynClarifyQuestion,
  TalqynComparisonTable,
  TalqynConsultantStage,
  TalqynFeedbackReason,
  TalqynProduct,
} from '../../sdk/index.js';
import { button, h, iconSlot, reorderChildren, setHidden, setIcon, setText } from '../support/dom.js';
import { tapFeedback } from '../support/platform.js';
import type { TalqynTheme } from '../theme.js';
import type {
  TalqynTurnAction,
  TalqynTurnClarify,
  TalqynTurnNotice,
  TalqynTurnRow,
  TalqynTurnToolbar,
} from '../transcript/rows.js';
import { TalqynAnswerParagraphView } from './answer-text.js';
import { chip, chipFlow, pillButton, textButton } from './controls.js';
import { productCard, type TalqynCardContext, type TalqynProductCard } from './product-card.js';
import { TalqynProductListView } from './product-list.js';

/** What a turn's views report back to the screen. */
export interface TalqynTurnActions {
  onTapProduct(product: TalqynProduct, turnId: string): void;
  onRetry(turnId: string): void;
  onRedirect(query: string): void;
  onFilters(filters: TalqynActionFilters, question: string): void;
  onComparison(table: TalqynComparisonTable): void;
  onSubmitClarify(answer: string, turnId: string): void;
  onClarifyDraft(draft: TalqynClarifyDraft, turnId: string): void;
  onRate(rating: TalqynAnswerRating | undefined, reasons: readonly TalqynFeedbackReason[], turnId: string): void;
  /** Puts text on the clipboard and says whether it worked. */
  onCopy(text: string): Promise<boolean>;
  /** Tells screen readers something. */
  announce(text: string): void;
}

/** Whether an element is hidden. `hidden` may also read `"until-found"`, which hides as well. */
function isHidden(element: HTMLElement): boolean {
  return element.hidden !== false;
}

/** A spinner and what the consultant is doing. */
class TalqynStatusLineView {
  readonly element: HTMLDivElement;
  private readonly label = h('span', 'tq-font-callout');

  constructor(private readonly strings: TalqynUiStrings) {
    const spinner = h('span', 'tq-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    this.element = h('div', 'tq-status', [spinner, this.label]);
    this.element.setAttribute('role', 'status');
  }

  update(stage: TalqynConsultantStage): void {
    switch (stage) {
      case 'searching':
        setText(this.label, this.strings.searching);
        break;
      case TalqynClientStage.composing:
        setText(this.label, this.strings.composing);
        break;
      default:
        setText(this.label, this.strings.thinking);
    }
  }
}

/** Three dots that pulse in turn while text is arriving. Under reduced motion they stay lit rather than stop existing: they are the only thing saying the answer is coming. */
function typingIndicator(): HTMLDivElement {
  const element = h('div', 'tq-typing', [h('span'), h('span'), h('span')]);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

/**
 * The product cards cited by one sentence. Two products — a comparison, most of the time — sit side by
 * side as tiles, so the paragraph is not split by a column of rows; one, or three and more, stack as rows.
 */
class TalqynCitedCardsView {
  readonly element = h('div', 'tq-cited');
  private cards: TalqynProductCard[] = [];
  private products: readonly TalqynProduct[] = [];

  constructor(private readonly context: TalqynCardContext) {}

  update(items: readonly TalqynProduct[], onTap: (product: TalqynProduct) => void): void {
    const isSame = items.length === this.products.length && items.every((item, index) => item === this.products[index]);
    if (!isSame) {
      const placement = items.length === 2 ? 'tile' : 'row';
      const previous = new Map(this.cards.map((card) => [card.product.talqynId, card]));
      this.cards = items.map((item) => productCard(this.context, item, placement, previous.get(item.talqynId)));
      this.products = items;
      if (placement === 'tile') this.element.dataset['pair'] = '';
      else delete this.element.dataset['pair'];
      reorderChildren(this.element, this.cards.map((card) => card.element));
    }
    for (const card of this.cards) {
      const product = card.product;
      card.onTap = () => onTap(product);
    }
  }
}

type BlockView =
  | { readonly type: 'paragraph'; readonly view: TalqynAnswerParagraphView }
  | { readonly type: 'products'; readonly view: TalqynCitedCardsView };

/**
 * The clarifying questions as chips, a free-text field, skip and submit — the card in the transcript and
 * the sheet share it; each places the buttons where its layout wants them.
 *
 * Chips are built once per question set and only their state changes as options are picked, so a chip
 * reached with the keyboard keeps focus through its own toggle.
 */
export class TalqynClarifyFormView {
  readonly element: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly submit: HTMLButtonElement;
  readonly skip: HTMLButtonElement;
  private readonly questions = h('div', 'tq-clarify-questions');
  private clarify: TalqynClarify | undefined;
  private renderedClarify: TalqynClarify | undefined;
  private draft: TalqynClarifyDraft = TalqynClarifyDraft.empty;
  private chips: { readonly element: HTMLButtonElement; readonly option: string; readonly question: TalqynClarifyQuestion }[] = [];
  onDraftChange: ((draft: TalqynClarifyDraft) => void) | undefined;
  onSubmit: ((answer: string) => void) | undefined;

  constructor(
    private readonly theme: TalqynTheme,
    strings: TalqynUiStrings,
    className: string,
  ) {
    this.input = h('input', 'tq-clarify-input tq-font-callout');
    this.input.type = 'text';
    this.input.placeholder = strings.clarifyCustomPlaceholder;
    this.input.maxLength = TalqynConversationLimits.maxClarifyCustomLength;
    this.input.enterKeyHint = 'done';
    this.input.setAttribute('aria-label', strings.clarifyCustomPlaceholder);
    this.input.addEventListener('input', () => {
      const text = this.input.value.slice(0, TalqynConversationLimits.maxClarifyCustomLength);
      if (text !== this.input.value) this.input.value = text;
      this.draft = TalqynClarifyDraft.withCustom(this.draft, text);
      this.onDraftChange?.(this.draft);
      this.updateSubmit();
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      if (!this.submit.disabled) this.submitDraft();
    });
    this.skip = textButton(strings.clarifySkip, () => this.onSubmit?.(strings.clarifySkipValue));
    this.skip.classList.add('tq-clarify-skip');
    this.submit = pillButton(strings.clarifySubmit, () => this.submitDraft());
    this.submit.disabled = true;
    this.element = h('div', className, [this.questions, this.input]);
  }

  update(clarify: TalqynClarify, draft: TalqynClarifyDraft): void {
    this.clarify = clarify;
    this.draft = draft;
    if (this.input.value !== draft.custom) this.input.value = draft.custom;
    if (clarify !== this.renderedClarify) this.renderQuestions(clarify);
    this.applySelection();
    this.updateSubmit();
  }

  private renderQuestions(clarify: TalqynClarify): void {
    this.renderedClarify = clarify;
    this.chips = [];
    this.questions.replaceChildren(
      ...clarify.questions.map((question) => {
        const chips = question.options.map((option) => {
          const element = chip(this.theme, option, { selected: false, onTap: () => this.toggle(option, question) });
          this.chips.push({ element, option, question });
          return element;
        });
        return h('div', 'tq-clarify-question', [h('div', 'tq-clarify-label tq-font-label', [question.label]), chipFlow(chips)]);
      }),
    );
  }

  private applySelection(): void {
    for (const { element, option, question } of this.chips) {
      element.setAttribute('aria-pressed', String(TalqynClarifyDraft.isSelected(this.draft, option, question)));
    }
  }

  private toggle(option: string, question: TalqynClarifyQuestion): void {
    this.draft = TalqynClarifyDraft.toggle(this.draft, option, question);
    this.onDraftChange?.(this.draft);
    this.applySelection();
    this.updateSubmit();
  }

  private submitDraft(): void {
    if (!this.clarify) return;
    tapFeedback(this.theme);
    this.onSubmit?.(TalqynClarifyDraft.answer(this.draft, this.clarify.questions));
  }

  private updateSubmit(): void {
    this.submit.disabled = !this.clarify || TalqynClarifyDraft.answer(this.draft, this.clarify.questions).length === 0;
  }
}

/**
 * Under a settled turn: was it helpful, why not, and a button that copies the answer.
 *
 * The verdict is a toggle — clicking the chosen thumb again takes it back. A thumb down opens the reasons
 * as chips: picking one is the cheapest way for a shopper to say what to fix, and each pick is saved as it
 * is made. Copying swaps the icon for a checkmark for a moment and says so to screen readers.
 */
class TalqynAnswerToolbarView {
  readonly element: HTMLDivElement;
  private readonly helpful: HTMLButtonElement;
  private readonly notHelpful: HTMLButtonElement;
  private readonly copy: HTMLButtonElement;
  private readonly divider = h('span', 'tq-toolbar-divider');
  private readonly reasonsChips = h('div', 'tq-chips');
  private readonly reasons: HTMLDivElement;
  private rating: TalqynAnswerRating | undefined;
  private offered: readonly TalqynFeedbackReason[] = [];
  private selected: readonly TalqynFeedbackReason[] = [];
  private reasonChips: { readonly element: HTMLButtonElement; readonly reason: TalqynFeedbackReason }[] = [];
  private reasonsKey = '';
  private copyText: string | undefined;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onRate: ((rating: TalqynAnswerRating | undefined, reasons: readonly TalqynFeedbackReason[]) => void) | undefined;
  onCopy: ((text: string) => Promise<boolean>) | undefined;
  announce: ((text: string) => void) | undefined;

  constructor(
    private readonly theme: TalqynTheme,
    private readonly strings: TalqynUiStrings,
  ) {
    this.helpful = this.toolbarButton(strings.rateHelpful, () => this.toggle('helpful'));
    this.notHelpful = this.toolbarButton(strings.rateNotHelpful, () => this.toggle('not_helpful'));
    this.copy = this.toolbarButton(strings.copyAnswer, () => void this.copyAnswer());
    this.copy.removeAttribute('aria-pressed');
    this.reasons = h('div', 'tq-reasons', [
      h('div', 'tq-reasons-title tq-font-caption-bold', [strings.feedbackReasonsTitle]),
      this.reasonsChips,
    ]);
    this.reasons.hidden = true;
    this.element = h('div', 'tq-toolbar', [
      h('div', 'tq-toolbar-row', [this.helpful, this.notHelpful, this.divider, this.copy]),
      this.reasons,
    ]);
    this.applyRating();
    this.resetCopy();
  }

  update(toolbar: TalqynTurnToolbar): void {
    this.rating = toolbar.rating;
    this.offered = toolbar.offeredReasons;
    this.selected = toolbar.selectedReasons;
    setHidden(this.copy, toolbar.copyText === undefined);
    setHidden(this.divider, toolbar.copyText === undefined);
    // An update — the rating landed, a reason was saved — must not cut short the checkmark of a copy that just happened.
    if (toolbar.copyText !== this.copyText) {
      this.copyText = toolbar.copyText;
      this.resetCopy();
    }
    this.applyRating();
    this.applyReasons();
  }

  dispose(): void {
    clearTimeout(this.copiedTimer);
  }

  private toolbarButton(label: string, onTap: () => void): HTMLButtonElement {
    const element = button('tq-toolbar-button tq-hit', [iconSlot(null)], label);
    element.title = label;
    element.setAttribute('aria-pressed', 'false');
    element.addEventListener('click', onTap);
    return element;
  }

  private iconOf(element: HTMLButtonElement): HTMLElement {
    return element.firstElementChild as HTMLElement;
  }

  private applyRating(): void {
    const icons = this.theme.icons;
    const isHelpful = this.rating === 'helpful';
    const isNotHelpful = this.rating === 'not_helpful';
    setIcon(this.iconOf(this.helpful), isHelpful ? icons.rateHelpfulOn : icons.rateHelpful);
    setIcon(this.iconOf(this.notHelpful), isNotHelpful ? icons.rateNotHelpfulOn : icons.rateNotHelpful);
    this.helpful.setAttribute('aria-pressed', String(isHelpful));
    this.notHelpful.setAttribute('aria-pressed', String(isNotHelpful));
  }

  private applyReasons(): void {
    const reasons = this.offered.flatMap((reason) => {
      const label = TalqynUiStrings.feedbackReasonText(this.strings, reason);
      return label === undefined ? [] : [[reason, label] as const];
    });
    setHidden(this.reasons, !(this.rating === 'not_helpful' && reasons.length > 0));
    const key = JSON.stringify(reasons);
    if (key !== this.reasonsKey) {
      this.reasonsKey = key;
      this.reasonChips = reasons.map(([reason, label]) => ({
        reason,
        element: chip(this.theme, label, { selected: false, onTap: () => this.toggleReason(reason) }),
      }));
      this.reasonsChips.replaceChildren(...this.reasonChips.map((entry) => entry.element));
    }
    for (const { element, reason } of this.reasonChips) {
      element.setAttribute('aria-pressed', String(this.selected.includes(reason)));
    }
  }

  private toggle(value: TalqynAnswerRating): void {
    tapFeedback(this.theme);
    this.rating = this.rating === value ? undefined : value;
    this.selected = [];
    this.applyRating();
    this.applyReasons();
    this.onRate?.(this.rating, []);
  }

  private toggleReason(reason: TalqynFeedbackReason): void {
    this.selected = this.selected.includes(reason)
      ? this.selected.filter((candidate) => candidate !== reason)
      : [...this.selected, reason];
    this.applyReasons();
    this.onRate?.('not_helpful', this.selected);
  }

  private async copyAnswer(): Promise<void> {
    const text = this.copyText;
    if (!text) return;
    const copied = (await this.onCopy?.(text)) ?? false;
    if (!copied) return;
    tapFeedback(this.theme);
    setIcon(this.iconOf(this.copy), this.theme.icons.checkmark);
    this.copy.dataset['copied'] = '';
    this.copy.setAttribute('aria-label', this.strings.copied);
    this.announce?.(this.strings.copied);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.resetCopy(), 1500);
  }

  private resetCopy(): void {
    clearTimeout(this.copiedTimer);
    this.copiedTimer = undefined;
    setIcon(this.iconOf(this.copy), this.theme.icons.copyAnswer);
    delete this.copy.dataset['copied'];
    this.copy.setAttribute('aria-label', this.strings.copyAnswer);
  }
}

/**
 * One assistant turn: status, the answer with inline product cards, the products carousel, proposed
 * actions, the clarify card, notices, and the rate-and-copy toolbar once the turn has settled.
 *
 * Updated in place while streaming: paragraphs keep their elements and only what changed is written, so
 * the shopper's selection and the scroll position hold.
 */
export class TalqynTurnView {
  readonly element: HTMLDivElement;
  private row: TalqynTurnRow | undefined;
  private readonly status: TalqynStatusLineView;
  private readonly blocks = h('div', 'tq-blocks');
  private readonly typing = typingIndicator();
  private readonly answerGroup: HTMLDivElement;
  private readonly productList: TalqynProductListView;
  private readonly actions = h('div', 'tq-actions');
  private actionsKey = '';
  private readonly clarifyCard: HTMLDivElement;
  private readonly clarifyForm: TalqynClarifyFormView;
  private readonly clarifyMessage = h('div', 'tq-clarify-message tq-font-callout');
  private readonly clarifyAnswered: HTMLDivElement;
  private readonly clarifyAnswer = h('div', 'tq-clarify-answer tq-font-callout');
  private readonly redirect: HTMLDivElement;
  private readonly notice: HTMLDivElement;
  private readonly noticeText = h('div', 'tq-notice-text tq-font-footnote');
  private readonly noticeRetry: HTMLButtonElement;
  private readonly toolbar: TalqynAnswerToolbarView;
  private readonly followGroup: HTMLDivElement;
  private readonly blockViews = new Map<number, BlockView>();

  constructor(
    private readonly context: TalqynCardContext,
    private readonly handlers: TalqynTurnActions,
  ) {
    const { theme, strings } = context;
    this.status = new TalqynStatusLineView(strings);
    this.productList = new TalqynProductListView(context);

    this.clarifyForm = new TalqynClarifyFormView(theme, strings, 'tq-clarify-form');
    this.clarifyCard = h('div', 'tq-clarify-card', [
      this.clarifyMessage,
      this.clarifyForm.element,
      h('div', 'tq-clarify-footer', [this.clarifyForm.skip, this.clarifyForm.submit]),
    ]);
    this.clarifyAnswered = h('div', 'tq-clarify-answered', [
      h('div', 'tq-clarify-answered-label tq-font-caption-bold', [strings.clarifyAnsweredLabel]),
      this.clarifyAnswer,
    ]);

    this.redirect = h('div', 'tq-redirect', [
      h('div', 'tq-redirect-text tq-font-footnote', [strings.redirectNotice]),
      pillButton(strings.openSearch, () => {
        const query = this.row?.redirectQuery;
        if (query !== undefined) this.handlers.onRedirect(query);
      }),
    ]);

    this.noticeRetry = textButton(strings.retry, () => {
      if (this.row) this.handlers.onRetry(this.row.turnId);
    });
    this.notice = h('div', 'tq-notice', [
      h('div', 'tq-notice-row', [h('span', 'tq-notice-dot'), this.noticeText]),
      this.noticeRetry,
    ]);

    this.toolbar = new TalqynAnswerToolbarView(theme, strings);
    this.toolbar.onRate = (rating, reasons) => {
      if (this.row) this.handlers.onRate(rating, reasons, this.row.turnId);
    };
    this.toolbar.onCopy = (text) => this.handlers.onCopy(text);
    this.toolbar.announce = (text) => this.handlers.announce(text);

    this.answerGroup = h('div', 'tq-turn-group', [this.status.element, this.blocks, this.typing]);
    this.followGroup = h('div', 'tq-turn-group', [
      this.actions,
      this.clarifyCard,
      this.clarifyAnswered,
      this.redirect,
      this.notice,
      this.toolbar.element,
    ]);
    this.element = h('div', 'tq-turn', [this.answerGroup, this.productList.element, this.followGroup]);

    for (const element of [
      this.status.element,
      this.typing,
      this.productList.element,
      this.actions,
      this.clarifyCard,
      this.clarifyAnswered,
      this.redirect,
      this.notice,
      this.toolbar.element,
    ]) {
      element.hidden = true;
    }
  }

  update(row: TalqynTurnRow): void {
    this.row = row;

    setHidden(this.status.element, row.stage === undefined);
    if (row.stage !== undefined) this.status.update(row.stage);

    this.reconcileBlocks(row);
    setHidden(this.blocks, row.blocks.length === 0);
    setHidden(this.typing, !(row.isStreaming && row.blocks.length > 0));

    this.productList.update(row.productSections, (product) => this.handlers.onTapProduct(product, row.turnId));
    this.updateActions(row.actions, row.question);
    this.updateClarify(row.clarify, row.turnId);
    setHidden(this.redirect, row.redirectQuery === undefined);
    this.updateNotice(row.notice);
    setHidden(this.toolbar.element, row.toolbar === undefined);
    if (row.toolbar) this.toolbar.update(row.toolbar);

    setHidden(this.answerGroup, isHidden(this.status.element) && isHidden(this.blocks) && isHidden(this.typing));
    setHidden(
      this.followGroup,
      isHidden(this.actions) &&
        isHidden(this.clarifyCard) &&
        isHidden(this.clarifyAnswered) &&
        isHidden(this.redirect) &&
        isHidden(this.notice) &&
        isHidden(this.toolbar.element),
    );
  }

  dispose(): void {
    this.toolbar.dispose();
  }

  /** Merges the new blocks into the existing views by id: a paragraph that did not change is left alone, a new block goes where it belongs, a vanished one is removed. */
  private reconcileBlocks(row: TalqynTurnRow): void {
    const seen = new Set<number>();
    const elements: HTMLElement[] = [];
    for (const block of row.blocks) {
      seen.add(block.id);
      let entry = this.blockViews.get(block.id);
      if (!entry || entry.type !== block.type) {
        entry =
          block.type === 'paragraph'
            ? { type: 'paragraph', view: new TalqynAnswerParagraphView() }
            : { type: 'products', view: new TalqynCitedCardsView(this.context) };
        this.blockViews.set(block.id, entry);
      }
      if (block.type === 'paragraph' && entry.type === 'paragraph') {
        entry.view.onProduct = (id) => this.openMention(id);
        entry.view.update(block.lines);
      } else if (block.type === 'products' && entry.type === 'products') {
        entry.view.update(block.items, (product) => this.handlers.onTapProduct(product, row.turnId));
      }
      elements.push(entry.view.element);
    }
    for (const id of [...this.blockViews.keys()]) {
      if (!seen.has(id)) this.blockViews.delete(id);
    }
    reorderChildren(this.blocks, elements);
  }

  /** A product's name in the text opens the product, the way its card does — and the click is reported the same way. */
  private openMention(productId: number): void {
    const row = this.row;
    const product = row?.catalog.get(productId);
    if (!row || !product) return;
    tapFeedback(this.context.theme);
    this.handlers.onTapProduct(product, row.turnId);
  }

  private updateActions(actions: readonly TalqynTurnAction[], question: string): void {
    setHidden(this.actions, actions.length === 0);
    const key = JSON.stringify([question, actions.map((action) => [action.type, action.summary])]);
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    const { theme, strings } = this.context;
    this.actions.replaceChildren(
      ...actions.map((action) => {
        const isFilters = action.type === 'filters';
        const title = isFilters ? strings.applyFilters : strings.openComparison;
        const summary = h('span', 'tq-action-summary tq-font-caption', [action.summary]);
        summary.hidden = action.summary.length === 0;
        const element = button(
          'tq-action tq-pressable',
          [
            iconSlot(isFilters ? theme.icons.filters : theme.icons.comparison),
            h('span', 'tq-action-text', [h('span', 'tq-action-title tq-font-label', [title]), summary]),
          ],
          action.summary.length === 0 ? title : `${title}, ${action.summary}`,
        );
        element.addEventListener('click', () => {
          tapFeedback(theme);
          if (action.type === 'filters') this.handlers.onFilters(action.filters, question);
          else this.handlers.onComparison(action.table);
        });
        return element;
      }),
    );
  }

  private updateClarify(clarify: TalqynTurnClarify | undefined, turnId: string): void {
    if (clarify?.type === 'pending') {
      setHidden(this.clarifyCard, false);
      setHidden(this.clarifyAnswered, true);
      setText(this.clarifyMessage, clarify.clarify.message);
      setHidden(this.clarifyMessage, clarify.clarify.message.length === 0);
      this.clarifyForm.onDraftChange = (draft) => this.handlers.onClarifyDraft(draft, turnId);
      this.clarifyForm.onSubmit = (answer) => this.handlers.onSubmitClarify(answer, turnId);
      this.clarifyForm.update(clarify.clarify, clarify.draft);
      this.clarifyCard.inert = !clarify.isInteractive;
      if (clarify.isInteractive) delete this.clarifyCard.dataset['inactive'];
      else this.clarifyCard.dataset['inactive'] = '';
    } else if (clarify?.type === 'answered') {
      setHidden(this.clarifyCard, true);
      setHidden(this.clarifyAnswered, false);
      setText(this.clarifyAnswer, clarify.answer);
    } else {
      setHidden(this.clarifyCard, true);
      setHidden(this.clarifyAnswered, true);
    }
  }

  private updateNotice(notice: TalqynTurnNotice | undefined): void {
    setHidden(this.notice, notice === undefined);
    if (!notice) return;
    this.notice.dataset['tone'] = notice.tone;
    setText(this.noticeText, notice.text);
    setHidden(this.noticeRetry, !notice.showsRetry);
  }
}
