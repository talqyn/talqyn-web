import { TalqynConversation, TalqynPriceFormatter, TalqynUiStrings } from '../consultant-core/index.js';
import { TalqynError, type Talqyn } from '../sdk/index.js';
import { remoteImageCss } from './components/remote-image.js';
import type { TalqynConsultantCallbacks, TalqynConsultantOptions } from './consultant-options.js';
import { TalqynConsultantScreen } from './screens/consultant-screen.js';
import { baseCss } from './styles/base.js';
import { chatHistoryCss } from './styles/chat-history.js';
import { comparisonCss } from './styles/comparison.js';
import { consultantCss } from './styles/consultant.js';
import { defineElement, TalqynElementBase, TalqynScreenHost } from './support/host.js';
import { TalqynImageLoader } from './support/image-loader.js';
import { TalqynTheme } from './theme.js';

/** The tag of the consultant element. */
export const TALQYN_CONSULTANT_TAG = 'talqyn-consultant';

/** The screen presents comparisons and history over itself, so their styles travel with it. */
const css = baseCss + remoteImageCss + consultantCss + comparisonCss + chatHistoryCss;

/** A consultant put on a page by {@link mountTalqynConsultant}. */
export interface TalqynConsultantHandle {
  /** The element, already in the container. */
  readonly element: TalqynConsultantElement;
  /** The conversation behind the screen: prefill the composer with `setDraft`, send a question with `send`. */
  readonly conversation: TalqynConversation;
  /**
   * Swaps callbacks. Only the keys passed change: `{ onOpenProduct }` keeps the rest, and a key passed as
   * `undefined` removes that callback. A framework that builds new closures on every render passes them here.
   */
  update(callbacks: TalqynConsultantCallbacks): void;
  /** Takes the screen off the page for good: an answer still streaming is stopped. */
  destroy(): void;
}

const callbackKeys = ['onOpenProduct', 'onOpenSearch', 'onApplyFilters', 'onRate', 'renderProductCard', 'navigation'] as const;

function callbacksOf(source: TalqynConsultantCallbacks): TalqynConsultantCallbacks {
  const callbacks: Record<string, unknown> = {};
  for (const key of callbackKeys) {
    if (key in source) callbacks[key] = source[key];
  }
  return callbacks as TalqynConsultantCallbacks;
}

/** The copy of the screen: the strings for the locale, with a name and examples given in the options put over them. */
function screenStrings(options: TalqynConsultantOptions, conversation: TalqynConversation): TalqynUiStrings {
  const base = options.strings ?? TalqynUiStrings.forLocale(conversation.talqyn.currentLocale);
  // A name and a set of examples given here beat the ones in the copy, so a site can change either without
  // carrying a whole string set.
  return Object.freeze({
    ...base,
    title: options.title ?? base.title,
    exampleQuestions: options.exampleQuestions ? Object.freeze([...options.exampleQuestions]) : base.exampleQuestions,
  });
}

interface OwnedConversation {
  readonly conversation: TalqynConversation;
  readonly talqyn: Talqyn;
  readonly maxFollowUps: number | undefined;
}

/**
 * The consultant screen as a custom element, `<talqyn-consultant>`.
 *
 * Give it a client, a theme, and callbacks for the things only the site can do — open a product, open
 * search results, open a filtered listing — and it handles the rest: the conversation, streaming,
 * clarifications, product cards and comparison, ratings, chat history, click events.
 *
 * The element fills the box the site gives it: give it a height — the height of a dialog, of a panel, or
 * `100dvh` for a page of its own. It draws inside a shadow root, so the page's CSS does not reach in and
 * its own does not leak out; the theme is the one way in.
 *
 * Taken off the page for good, it stops an answer still streaming: every turn is an LLM call, and one
 * nobody will read is still being paid for. Moved within the page — a framework reparenting it — it keeps
 * going; hidden with `display: none`, it keeps going too, and asks a clarifying question that settled
 * meanwhile once it shows again.
 */
export class TalqynConsultantElement extends TalqynElementBase {
  private options: TalqynConsultantOptions | undefined;
  private callbacks: TalqynConsultantCallbacks = {};
  private owned: OwnedConversation | undefined;
  private current: TalqynConversation | undefined;
  private screenHost: TalqynScreenHost | undefined;
  private screen: TalqynConsultantScreen | undefined;
  private removalCheck = 0;

  /** The conversation behind the screen, once configured. */
  get conversation(): TalqynConversation | undefined {
    return this.current;
  }

  /**
   * Sets what the screen is built from, drawing it again when it is on the page. A second call with the same
   * client keeps the conversation the element created; one with another client starts a new conversation
   * and stops the old one.
   *
   * @returns The conversation behind the screen.
   */
  configure(options: TalqynConsultantOptions): TalqynConversation {
    const conversation = this.adopt(options);
    this.options = options;
    this.callbacks = callbacksOf(options);
    if (this.isConnected) {
      this.build();
      this.screen?.appeared();
    }
    return conversation;
  }

  /** Swaps callbacks; see {@link TalqynConsultantHandle.update}. */
  update(callbacks: TalqynConsultantCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacksOf(callbacks) };
    this.screen?.callbacksChanged();
  }

  /** Takes the screen off the page for good; see {@link TalqynConsultantHandle.destroy}. */
  dispose(): void {
    this.removalCheck += 1;
    this.takeDown();
    this.remove();
  }

  connectedCallback(): void {
    this.removalCheck += 1;
    if (!this.screen) this.build();
    this.screen?.appeared();
  }

  disconnectedCallback(): void {
    if (!this.screen) return;
    const check = ++this.removalCheck;
    // A move is a disconnect and a connect in one task: only a removal that is still a removal once the
    // task is over takes the screen down.
    queueMicrotask(() => {
      if (check !== this.removalCheck || this.isConnected) return;
      this.takeDown();
    });
  }

  private adopt(options: TalqynConsultantOptions): TalqynConversation {
    if (options.conversation) {
      this.owned?.conversation.stop();
      this.owned = undefined;
      this.current = options.conversation;
      return options.conversation;
    }
    const talqyn = options.talqyn;
    if (!talqyn) {
      throw TalqynError.invalidConfiguration('The consultant screen needs a `talqyn` client or a `conversation`.');
    }
    const maxFollowUps = options.maxFollowUps;
    if (this.owned && this.owned.talqyn === talqyn && this.owned.maxFollowUps === maxFollowUps) {
      this.current = this.owned.conversation;
      return this.owned.conversation;
    }
    this.owned?.conversation.stop();
    const conversation = new TalqynConversation(talqyn, maxFollowUps === undefined ? {} : { maxFollowUps });
    this.owned = { conversation, talqyn, maxFollowUps };
    this.current = conversation;
    return conversation;
  }

  private build(): void {
    this.teardown();
    const options = this.options;
    const conversation = this.current;
    if (!options || !conversation) return;
    const theme = options.theme ?? TalqynTheme.default;
    const host = new TalqynScreenHost(this, css);
    host.applyTheme(theme);
    this.screenHost = host;
    this.screen = new TalqynConsultantScreen(host, {
      conversation,
      theme,
      strings: screenStrings(options, conversation),
      priceFormatter: options.priceFormatter ?? TalqynPriceFormatter.tenge,
      imageLoader: options.imageLoader ?? TalqynImageLoader.default,
      showsHeader: options.showsHeader ?? true,
      showsPoweredBy: options.showsPoweredBy ?? true,
      layout: options.layout ?? {},
      callbacks: () => this.callbacks,
    });
  }

  /** Going away for good, as opposed to being hidden or moved: an answer nobody will come back to is stopped. */
  private takeDown(): void {
    this.current?.stop();
    this.teardown();
  }

  private teardown(): void {
    this.screen?.dispose();
    this.screen = undefined;
    this.screenHost?.dispose();
    this.screenHost = undefined;
  }
}

/** Registers `<talqyn-consultant>`. Safe to call more than once. */
export function defineTalqynConsultantElement(): void {
  defineElement(TALQYN_CONSULTANT_TAG, TalqynConsultantElement);
}

/**
 * Draws the consultant inside `container`.
 *
 * ```ts
 * const consultant = mountTalqynConsultant(document.querySelector('#consultant')!, {
 *   talqyn,
 *   theme: TalqynTheme.create({ colors: { ...brand } }),
 *   navigation: TalqynNavigation.close(() => dialog.close()),
 *   onOpenProduct: (product) => router.push(`/p/${product.externalId}`),
 *   onOpenSearch: (query) => router.push(`/search?q=${encodeURIComponent(query)}`),
 *   onApplyFilters: (criteria) => router.push(listingUrl(criteria)),
 * });
 * consultant.conversation.send('need a laptop for school');
 * ```
 */
export function mountTalqynConsultant(container: Element, options: TalqynConsultantOptions): TalqynConsultantHandle {
  defineTalqynConsultantElement();
  const element = document.createElement(TALQYN_CONSULTANT_TAG) as TalqynConsultantElement;
  const conversation = element.configure(options);
  container.appendChild(element);
  return {
    element,
    conversation,
    update: (callbacks) => element.update(callbacks),
    destroy: () => element.dispose(),
  };
}
