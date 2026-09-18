import { asRecord, readArray, readInteger, readNumber, readString, setEntry } from '../internal/json.js';

/**
 * Whether an option is selected, selectable, or empty at the current selection.
 *
 * Open rather than closed: a value the SDK has not seen must not break the whole filter panel.
 */
export type TalqynFilterOptionState = 'active' | 'enabled' | 'disabled' | (string & {});

export const TalqynFilterOptionState = {
  /** Currently selected. */
  active: 'active',
  /** Available to select. */
  enabled: 'enabled',
  /** Zero products at the current selection. Do not hide it — render it inactive: options that vanish read as a filter that disappeared. */
  disabled: 'disabled',
} as const;

/** One selectable value inside a facet group. */
export interface TalqynFilterOption {
  /** The value to send back in `filters[<group slug>]`. */
  readonly slug: string;
  /** The label to display, in the requested locale. */
  readonly label: string | undefined;
  /** How many products carry this value at the current selection. */
  readonly count: number;
  /** Whether the option is selected, selectable, or empty. */
  readonly state: TalqynFilterOptionState;
  /**
   * For the `city` and `location` groups only: the place id **in your catalog's numbering** — the
   * value to pass as `cityId` (from the `city` group) or `locationId` (from the `location` group) on
   * the next request. Every other group filters through the structural {@link slug} and reports
   * `undefined` here.
   *
   * An `undefined` on a `city` option happens in exactly one case: the currently selected city
   * disappeared from the directory between requests. The option stays so the selection remains
   * visible and removable, but there is nothing left to send it back with — clear the filter.
   */
  readonly id: string | undefined;
  /** For the `location` group only: the slug of the store's city, to group stores under the `city` group's options. */
  readonly citySlug: string | undefined;
}

export const TalqynFilterOption = {
  /** Whether the option is currently applied. */
  isSelected(option: TalqynFilterOption): boolean {
    return option.state === TalqynFilterOptionState.active;
  },

  /** Whether the option should be shown but not tappable. */
  isDisabled(option: TalqynFilterOption): boolean {
    return option.state === TalqynFilterOptionState.disabled;
  },
} as const;

/** How a group is meant to be rendered. Open, for the same reason as {@link TalqynFilterOptionState}. */
export type TalqynFilterGroupKind = 'list' | 'range' | 'bool' | (string & {});

export const TalqynFilterGroupKind = {
  /** A list of values. */
  list: 'list',
  /** A numeric range, bounded by `min` and `max`. */
  range: 'range',
  /** A yes/no toggle. */
  bool: 'bool',
} as const;

/** One group of the filter panel. */
export interface TalqynFilterGroup {
  /** The group key. Also the key to use in `filters` on the next request. */
  readonly slug: string;
  /** The group label to display, in the requested locale. */
  readonly label: string | undefined;
  /** How the group is meant to be rendered. */
  readonly type: TalqynFilterGroupKind;
  /** The values in the group. */
  readonly options: readonly TalqynFilterOption[];
  /** The lower bound of a `range` group. */
  readonly min: number | undefined;
  /** The upper bound of a `range` group. */
  readonly max: number | undefined;
  /** The lower bound currently selected in a `range` group. */
  readonly selectedMin: number | undefined;
  /** The upper bound currently selected in a `range` group. */
  readonly selectedMax: number | undefined;
}

export const TalqynFilterGroup = {
  /** The category group. */
  categorySlug: 'category',
  /** The brand group. */
  brandSlug: 'brand',
  /** The price range group. */
  priceSlug: 'price',
  /** The in-stock group. */
  stockSlug: 'stock',
  /** The discount group. */
  discountSlug: 'discount',
  /** The city group. Its options carry `id`. */
  citySlug: 'city',
  /** The store group. Its options carry `id`. */
  locationSlug: 'location',
  /** The former name of the store group, kept so a storefront that lived through the rename does not render stores twice. */
  legacyLocationSlug: 'store',

  /**
   * The groups that select a place. They do not belong in the general filter panel: a city and a
   * store travel as the separate `cityId` and `locationId` parameters, not as structural `filters`.
   */
  placeSlugs: new Set(['city', 'location', 'store']) as ReadonlySet<string>,

  /** The slugs currently selected — what to send back in `filters`. */
  selectedSlugs(group: TalqynFilterGroup): string[] {
    return group.options.filter(TalqynFilterOption.isSelected).map((option) => option.slug);
  },
} as const;

/** The result of `POST /v1/search/filters` — facet counts for the current query and the filters already applied. */
export interface TalqynFiltersResponse {
  /** Every group the server returned, in display order. */
  readonly groups: readonly TalqynFilterGroup[];
}

export const TalqynFiltersResponse = {
  /** A group by slug, or `undefined` when the response has none with that slug. */
  group(response: TalqynFiltersResponse, slug: string): TalqynFilterGroup | undefined {
    return response.groups.find((group) => group.slug === slug);
  },

  /** The groups to render in the filter panel: everything except the city and store pickers. */
  panelGroups(response: TalqynFiltersResponse): TalqynFilterGroup[] {
    return response.groups.filter((group) => !TalqynFilterGroup.placeSlugs.has(group.slug));
  },

  /** The city directory. An option's `id` is what goes into `cityId`. */
  cityGroup(response: TalqynFiltersResponse): TalqynFilterGroup | undefined {
    return TalqynFiltersResponse.group(response, TalqynFilterGroup.citySlug);
  },

  /**
   * The store directory, scoped to the selected city when there is one. May be absent entirely — for
   * instance when a chain has one store per city and "pick a store" would duplicate "pick a city".
   * Absence is not an error: simply do not render the picker.
   */
  locationGroup(response: TalqynFiltersResponse): TalqynFilterGroup | undefined {
    return (
      TalqynFiltersResponse.group(response, TalqynFilterGroup.locationSlug) ??
      TalqynFiltersResponse.group(response, TalqynFilterGroup.legacyLocationSlug)
    );
  },

  /** The price range group. */
  priceGroup(response: TalqynFiltersResponse): TalqynFilterGroup | undefined {
    return TalqynFiltersResponse.group(response, TalqynFilterGroup.priceSlug);
  },

  /** Everything currently selected, shaped as the `filters` parameter of the next request. */
  selectedFilters(response: TalqynFiltersResponse): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const group of TalqynFiltersResponse.panelGroups(response)) {
      const selected = TalqynFilterGroup.selectedSlugs(group);
      // The slug is the catalog's, and `__proto__` is a slug like any other; see `setEntry`.
      if (selected.length > 0) setEntry(result, group.slug, selected);
    }
    return result;
  },
} as const;

function decodeFilterOption(value: unknown): TalqynFilterOption | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    slug: readString(record, 'slug') ?? '',
    label: readString(record, 'label'),
    count: readInteger(record, 'count') ?? 0,
    state: readString(record, 'state') ?? TalqynFilterOptionState.enabled,
    id: readString(record, 'id'),
    citySlug: readString(record, 'city_slug'),
  };
}

function decodeFilterGroup(value: unknown): TalqynFilterGroup | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    slug: readString(record, 'slug') ?? '',
    label: readString(record, 'label'),
    type: readString(record, 'type') ?? TalqynFilterGroupKind.list,
    options: readArray(record, 'options', decodeFilterOption),
    min: readNumber(record, 'min'),
    max: readNumber(record, 'max'),
    selectedMin: readNumber(record, 'selected_min'),
    selectedMax: readNumber(record, 'selected_max'),
  };
}

/** Decodes a facet response, tolerating an absent `groups` field. */
export function decodeFiltersResponse(value: unknown): TalqynFiltersResponse | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return { groups: readArray(record, 'groups', decodeFilterGroup) };
}
