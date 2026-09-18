import {
  asRecord,
  decodeInteger,
  decodeString,
  readArray,
  readBoolean,
  readInteger,
  readNumber,
  readOptionalArray,
  readStrictArray,
  readString,
  readStringArrayRecord,
  readStringRecord,
  type JsonRecord,
} from '../internal/json.js';
import type { TalqynLocale } from '../locale.js';
import { decodeProduct, type TalqynProduct } from './product.js';
import type { TalqynFilterCriteria } from './queries.js';

/**
 * What the consultant is doing at this point in a turn.
 *
 * Open: a turn has more than one shape, and a new stage must not break stream parsing on a live site.
 */
export type TalqynConsultantStage = 'thinking' | 'searching' | (string & {});

export const TalqynConsultantStage = {
  /** The turn has opened; the model is working out what was asked. */
  thinking: 'thinking',
  /** The catalog is being searched. */
  searching: 'searching',
} as const;

/**
 * Why a turn produced no text.
 *
 * The set is **open**: treat an unknown value as "no text, products are still there" rather than as
 * an error.
 */
export type TalqynFallbackReason =
  | 'user_budget_exceeded'
  | 'budget_exceeded'
  | 'turn_budget'
  | 'timeout'
  | 'circuit_open'
  | 'refusal'
  | (string & {});

export const TalqynFallbackReason = {
  /**
   * This shopper — or this device, or this network address — has spent their consultant budget for
   * the next few hours. Under a device token this also covers the per-address ceiling shared by
   * everyone behind one NAT, so a shopper can hit it without a single extra turn of their own. Tell
   * them the consultant will be back later and show what was found; search keeps working normally.
   */
  userBudgetExceeded: 'user_budget_exceeded',
  /** The account's monthly budget is spent. The ceiling is raised on Talqyn's side. */
  budgetExceeded: 'budget_exceeded',
  /** The token budget for this single turn ran out. */
  turnBudget: 'turn_budget',
  /** The model did not answer in time. */
  timeout: 'timeout',
  /** The model provider is circuit-broken after repeated failures. */
  circuitOpen: 'circuit_open',
  /** The model declined to answer. */
  refusal: 'refusal',

  /**
   * Whether the reason is an exhausted budget. The two budget reasons call for different wording to
   * the shopper — one clears by itself, the other needs a plan change — but both mean "not now".
   */
  isBudgetExhausted(reason: TalqynFallbackReason): boolean {
    return reason === 'user_budget_exceeded' || reason === 'budget_exceeded';
  },
} as const;

/** The products found during a turn. */
export interface TalqynConsultantProducts {
  /** Every product across all steps of the plan, flattened and deduplicated. */
  readonly items: readonly TalqynProduct[];
  /** The same products split by role. Present only for a multi-step plan such as a bundle or a comparison. */
  readonly groups: readonly TalqynProductGroup[] | undefined;
  /**
   * The impression id for this turn. Report clicks with it and the `cip` source. One id per turn, so a
   * click's position is its index in the flattened {@link items}.
   */
  readonly searchId: string | undefined;
}

/** One step of a multi-step retrieval plan. */
export interface TalqynProductGroup {
  /** What this group is for, in the requested locale — "sofa", "matching table". */
  readonly role: string;
  /** The products found for this step. */
  readonly items: readonly TalqynProduct[];
}

/** One clarifying question. */
export interface TalqynClarifyQuestion {
  /** The question id. */
  readonly id: string;
  /** The prompt to display. */
  readonly label: string;
  /** Whether more than one option may be picked. */
  readonly multi: boolean;
  /** The answers to offer. */
  readonly options: readonly string[];
}

/**
 * A follow-up question asked before searching, when the request lacked context.
 *
 * There are no products in such a turn. Send the shopper's answer as an ordinary question on the next
 * request, carrying the same session id.
 */
export interface TalqynClarify {
  /** The lead-in to show above the questions. */
  readonly message: string;
  /** The questions to render, usually as chips. */
  readonly questions: readonly TalqynClarifyQuestion[];
}

/**
 * The filters carried by an `applyFilters` action.
 *
 * The fields mirror a listing request, so the payload can be moved into one unchanged once a query
 * string is added — see {@link TalqynActionFilters.criteria}.
 */
export interface TalqynActionFilters {
  /** The category to narrow to. */
  readonly categoryId: number | undefined;
  /** The brand to narrow to. */
  readonly brandId: number | undefined;
  /** The lower price bound. */
  readonly priceMin: number | undefined;
  /** The upper price bound. */
  readonly priceMax: number | undefined;
  /** Whether to keep only discounted products. */
  readonly hasDiscount: boolean;
  /** Structural filters in the form `POST /v1/search/full` accepts. */
  readonly filters: Readonly<Record<string, readonly string[]>>;
  /**
   * The same selection in the earlier flat form, one value per slug. Kept for compatibility only; a
   * listing request ignores it, and it cannot express a multi-value selection. Send {@link filters}.
   */
  readonly attributes: Readonly<Record<string, string>>;
}

export const TalqynActionFilters = {
  /**
   * A payload with nothing in it. Frozen through: it is one shared instance, handed out for every
   * `apply_filters` action whose payload does not decode, and a caller writing into it from plain
   * JavaScript would poison every one that follows.
   */
  empty: Object.freeze({
    categoryId: undefined,
    brandId: undefined,
    priceMin: undefined,
    priceMax: undefined,
    hasDiscount: false,
    filters: Object.freeze({}),
    attributes: Object.freeze({}),
  }) as TalqynActionFilters,

  /**
   * Turns the payload into listing criteria, ready for `talqyn.search.full` or `talqyn.search.filters`.
   *
   * @param init.query The text to search for — usually the question that produced the action.
   * @param init.locale The language to search in. Unset uses the client default.
   * @param init.cityId The shopper's city, in your catalog's numbering.
   * @param init.locationId The shopper's store, in your catalog's numbering.
   */
  criteria(
    filters: TalqynActionFilters,
    init: {
      readonly query: string;
      readonly locale?: TalqynLocale | undefined;
      readonly cityId?: string | undefined;
      readonly locationId?: string | undefined;
    },
  ): TalqynFilterCriteria {
    return {
      query: init.query,
      locale: init.locale,
      categoryId: filters.categoryId,
      brandId: filters.brandId,
      priceMin: filters.priceMin,
      priceMax: filters.priceMax,
      hasDiscount: filters.hasDiscount,
      filters: filters.filters,
      cityId: init.cityId,
      locationId: init.locationId,
    };
  },
} as const;

/** One characteristic across every compared product. */
export interface TalqynComparisonRow {
  /** The characteristic name. */
  readonly label: string;
  /** One value per column, aligned with the table's `talqynIds`. `null` means the product does not have this characteristic. */
  readonly values: readonly (string | null)[];
}

/** A product comparison table built by the server from catalog attributes, not invented by the model — safe to render directly. */
export interface TalqynComparisonTable {
  /** The compared products, as Talqyn's internal ids. Resolve them against the turn's products to render cards. */
  readonly talqynIds: readonly number[];
  /** The column headers, aligned with {@link talqynIds}. */
  readonly titles: readonly string[];
  /** The comparison rows. */
  readonly rows: readonly TalqynComparisonRow[];
}

/** An interface action the consultant proposes. */
export type TalqynConsultantAction =
  /** Apply a set of filters. The payload transfers into a listing request as-is. */
  | { readonly type: 'applyFilters'; readonly filters: TalqynActionFilters }
  /** Show a comparison table. */
  | { readonly type: 'showComparison'; readonly table: TalqynComparisonTable }
  /** An action this version of the SDK does not know; `rawType` is its wire value. */
  | { readonly type: 'unknown'; readonly rawType: string };

/** The end of a turn. */
export interface TalqynConsultantDone {
  /** The conversation id. Pass it on the next question to continue the dialogue. */
  readonly sessionId: string;
  /**
   * This turn's id: the key to rate it with. Every turn has one — a clarification and a fallback too,
   * which is exactly where products, and a search id, are missing. `undefined` only from a server
   * that predates ratings.
   */
  readonly turnId: string | undefined;
  /** Time to the first token of the answer, in milliseconds. `undefined` for turns that produced no streamed text. */
  readonly timeToFirstTokenMs: number | undefined;
  /** How long the whole turn took, in milliseconds. */
  readonly totalMs: number | undefined;
}

/** A whole consultant turn delivered as one object, from `talqyn.consultant.answer`. */
export interface TalqynConsultantAnswer {
  /** The answer text, with `[p:ID]` markers left in place. Empty on a clarify, redirect, or fallback turn. */
  readonly answer: string;
  /** The conversation id. Pass it on the next question to continue. */
  readonly sessionId: string | undefined;
  /** The products found, flattened and deduplicated. */
  readonly products: readonly TalqynProduct[];
  /** The clarifying questions, when the turn asked for context instead of answering. */
  readonly clarify: TalqynClarify | undefined;
  /** The products split by role for a multi-step plan. `undefined` for a single search. */
  readonly groups: readonly TalqynProductGroup[] | undefined;
  /** The query to run through ordinary search, when the consultant decided the request was a search. */
  readonly redirectQuery: string | undefined;
  /** Why the turn produced no text, when it produced none. */
  readonly fallbackReason: TalqynFallbackReason | undefined;
  /** The interface actions proposed by the turn. */
  readonly actions: readonly TalqynConsultantAction[];
  /** Ready-made follow-up prompts, to be sent verbatim as the next question. */
  readonly followUps: readonly string[];
  /** The impression id for the products of this turn. */
  readonly searchId: string | undefined;
  /** The turn's id, to rate it with. The same value as `done.turnId` on a stream. */
  readonly turnId: string | undefined;
  /** The tenant the answer was produced for. */
  readonly tenantId: string | undefined;
}

export const TalqynConsultantAnswer = {
  /** Whether the turn degraded: products are present, text is not. */
  isFallback(answer: TalqynConsultantAnswer): boolean {
    return answer.fallbackReason !== undefined;
  },
} as const;

export function decodeProductGroup(value: unknown): TalqynProductGroup | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return { role: readString(record, 'role') ?? '', items: readArray(record, 'items', decodeProduct) };
}

export function decodeConsultantProducts(record: JsonRecord): TalqynConsultantProducts {
  return {
    items: readArray(record, 'items', decodeProduct),
    groups: readOptionalArray(record, 'groups', decodeProductGroup),
    searchId: readString(record, 'search_id'),
  };
}

function decodeClarifyQuestion(value: unknown): TalqynClarifyQuestion | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    id: readString(record, 'id') ?? '',
    label: readString(record, 'label') ?? '',
    multi: readBoolean(record, 'multi') ?? false,
    options: readArray(record, 'options', decodeString),
  };
}

export function decodeClarify(value: unknown): TalqynClarify | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return { message: readString(record, 'message') ?? '', questions: readArray(record, 'questions', decodeClarifyQuestion) };
}

function decodeActionFilters(value: unknown): TalqynActionFilters | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    categoryId: readInteger(record, 'category_id'),
    brandId: readInteger(record, 'brand_id'),
    priceMin: readNumber(record, 'price_min'),
    priceMax: readNumber(record, 'price_max'),
    hasDiscount: readBoolean(record, 'has_discount') ?? false,
    filters: readStringArrayRecord(record, 'filters') ?? {},
    attributes: readStringRecord(record, 'attrs') ?? {},
  };
}

function decodeNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function decodeComparisonRow(value: unknown): TalqynComparisonRow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    label: readString(record, 'label') ?? '',
    values: readStrictArray(record, 'values', decodeNullableString) ?? [],
  };
}

function decodeComparisonTable(value: unknown): TalqynComparisonTable | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    // Ids and titles are aligned by index, so each decodes as a unit; a row that does not decode is
    // dropped on its own.
    talqynIds: readStrictArray(record, 'talqyn_ids', decodeInteger) ?? [],
    titles: readStrictArray(record, 'titles', decodeString) ?? [],
    rows: readArray(record, 'rows', decodeComparisonRow),
  };
}

export function decodeConsultantAction(value: unknown): TalqynConsultantAction | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const type = readString(record, 'type') ?? '';
  switch (type) {
    case 'apply_filters':
      return { type: 'applyFilters', filters: decodeActionFilters(record['filters']) ?? TalqynActionFilters.empty };
    case 'show_comparison':
      return {
        type: 'showComparison',
        table: decodeComparisonTable(record['table']) ?? { talqynIds: [], titles: [], rows: [] },
      };
    default:
      return { type: 'unknown', rawType: type };
  }
}

export function decodeConsultantDone(record: JsonRecord): TalqynConsultantDone {
  return {
    sessionId: readString(record, 'session_id') ?? '',
    turnId: readString(record, 'turn_id'),
    timeToFirstTokenMs: readInteger(record, 'ttft_ms'),
    totalMs: readInteger(record, 'total_ms'),
  };
}

/** Decodes a non-streaming consultant answer, tolerating absent fields. */
export function decodeConsultantAnswer(value: unknown): TalqynConsultantAnswer | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    answer: readString(record, 'answer') ?? '',
    sessionId: readString(record, 'session_id'),
    products: readArray(record, 'products', decodeProduct),
    clarify: decodeClarify(record['clarify']),
    groups: readOptionalArray(record, 'groups', decodeProductGroup),
    redirectQuery: readString(record, 'redirect_query'),
    fallbackReason: readString(record, 'fallback_reason'),
    actions: readArray(record, 'actions', decodeConsultantAction),
    followUps: readArray(record, 'follow_ups', decodeString),
    searchId: readString(record, 'search_id'),
    turnId: readString(record, 'turn_id'),
    tenantId: readString(record, 'tenant_id'),
  };
}
