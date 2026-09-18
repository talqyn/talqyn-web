import type {
  TalqynAnswerRating,
  TalqynAssistantTurn,
  TalqynConversation,
  TalqynPriceFormatter,
  TalqynUiStrings,
} from '../consultant-core/index.js';
import type { Talqyn, TalqynFeedbackReason, TalqynFilterCriteria, TalqynProduct } from '../sdk/index.js';
import type { TalqynNavigationKind } from './components/header.js';
import type { TalqynProductCardRenderer } from './components/product-card.js';
import type { TalqynAdaptiveLayout } from './layout.js';
import type { TalqynImageLoader } from './support/image-loader.js';
import type { TalqynTheme } from './theme.js';

export type { TalqynNavigationKind } from './components/header.js';

/**
 * The way out of the consultant, drawn at the left of its bar.
 *
 * A page cannot tell how it was shown — a route of its own, a dialog over the catalog, a panel — so the
 * site names it: a back arrow that goes back, or a cross that closes. Left out, the bar has no way out,
 * which is right for a consultant that is a page of its own.
 */
export interface TalqynNavigation {
  /** What the button looks like. */
  readonly kind: TalqynNavigationKind;
  /** What leaving does: the router going back, the dialog closing. */
  readonly handler: () => void;
}

export const TalqynNavigation = {
  /** A back arrow: the consultant was opened on top of a page and goes back to it. */
  back(handler: () => void): TalqynNavigation {
    return Object.freeze({ kind: 'back', handler });
  },

  /** A cross: the consultant was opened over the page, as a dialog or a panel, and closes. */
  close(handler: () => void): TalqynNavigation {
    return Object.freeze({ kind: 'close', handler });
  },
} as const;

/**
 * What the consultant screen hands back to the site: the navigation it cannot perform itself and the
 * product cards it does not own.
 *
 * Every screen the SDK can draw on its own — comparison, history, clarify — it draws. What leads out of the
 * consultant — a product page, the search results — belongs to the site. Every callback can be swapped
 * after the screen is up, with `update`.
 */
export interface TalqynConsultantCallbacks {
  /** A product card or a product's name was clicked. The click is already reported to Talqyn. */
  readonly onOpenProduct?: ((product: TalqynProduct) => void) | undefined;
  /** The consultant decided the request was a search: open results for the query. */
  readonly onOpenSearch?: ((query: string) => void) | undefined;
  /** The consultant proposed filters: open a listing for the criteria, already combined with the question that produced them. */
  readonly onApplyFilters?: ((criteria: TalqynFilterCriteria) => void) | undefined;
  /**
   * The shopper rated a turn, or picked a reason under a thumb down. The rating is already on its way to
   * Talqyn; this is for the site's own analytics.
   *
   * @param rating The verdict, or `undefined` when it was taken back.
   * @param reasons Why the answer did not help, as picked so far.
   */
  readonly onRate?:
    | ((rating: TalqynAnswerRating | undefined, reasons: readonly TalqynFeedbackReason[], turn: TalqynAssistantTurn) => void)
    | undefined;
  /** The site's own product card; see {@link TalqynProductCardRenderer}. */
  readonly renderProductCard?: TalqynProductCardRenderer | undefined;
  /** The way out of the screen; see {@link TalqynNavigation}. */
  readonly navigation?: TalqynNavigation | undefined;
}

/** What the consultant screen looks like and says, apart from the conversation behind it. */
export interface TalqynConsultantAppearanceOptions extends TalqynConsultantCallbacks {
  /** Colors, type, icons, and shapes. Defaults to the SDK's neutral theme. */
  readonly theme?: TalqynTheme;
  /**
   * How the screen adapts to the box it is given: where the roomy shape starts and how wide it draws
   * what it presents over itself. Defaults to becoming `regular` from 640 pixels of element width.
   */
  readonly layout?: TalqynAdaptiveLayout;
  /** What the screen calls itself, in its bar and over the examples on an empty screen. Defaults to the copy's own name. */
  readonly title?: string;
  /**
   * The questions offered as chips on an empty screen, and again under the first answer where the shopper
   * has not asked them yet. Defaults to the copy's own; an empty array shows none.
   */
  readonly exampleQuestions?: readonly string[];
  /** Copy. Defaults to the client's locale. */
  readonly strings?: TalqynUiStrings;
  /** How prices are written. Defaults to tenge. */
  readonly priceFormatter?: TalqynPriceFormatter;
  /** Where product images load from. Defaults to the catalog's own addresses. */
  readonly imageLoader?: TalqynImageLoader;
  /** Whether the screen draws its own bar. Defaults to `true`; without it, wire history and a new chat into the site's own bar. */
  readonly showsHeader?: boolean;
  /** Whether the empty screen carries "Powered by Talqyn" under the examples. The wording is fixed in every locale; this is the switch. Defaults to `true`. */
  readonly showsPoweredBy?: boolean;
}

/**
 * What the consultant screen is built from: a client — the screen then owns its conversation — or a
 * conversation the site keeps, to survive the screen being taken off the page.
 */
export type TalqynConsultantOptions = TalqynConsultantAppearanceOptions &
  (
    | {
        /** The client to talk through. The screen creates its conversation over it. */
        readonly talqyn: Talqyn;
        /** How many follow-up prompts to offer under an answer. Defaults to three; `0` shows none. */
        readonly maxFollowUps?: number;
        readonly conversation?: never;
      }
    | {
        /** The conversation to show. Keep it to show the same transcript again after the screen was taken down. */
        readonly conversation: TalqynConversation;
        readonly talqyn?: never;
        readonly maxFollowUps?: never;
      }
  );
