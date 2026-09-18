import type { TalqynLocale } from './locale.js';
import type { TalqynSearchSubmitEvent } from './models/event-models.js';
import type {
  TalqynConsultantQuery,
  TalqynFilterCriteria,
  TalqynFullSearchQuery,
  TalqynSearchQuery,
} from './models/queries.js';

/** Request defaults as of one moment: locale, the shopper's place, the A/B bucket. */
export interface TalqynDefaultsSnapshot {
  readonly locale: TalqynLocale;
  readonly cityId: string | undefined;
  readonly locationId: string | undefined;
  readonly variant: string | undefined;
}

/**
 * Request defaults. They change at runtime, so they live in one place instead of being copied into
 * every API surface.
 */
export class TalqynDefaults {
  private snapshot: TalqynDefaultsSnapshot;

  constructor(initial: TalqynDefaultsSnapshot) {
    this.snapshot = Object.freeze({ ...initial });
  }

  get current(): TalqynDefaultsSnapshot {
    return this.snapshot;
  }

  update(change: (current: TalqynDefaultsSnapshot) => TalqynDefaultsSnapshot): void {
    this.snapshot = Object.freeze({ ...change(this.snapshot) });
  }
}

interface Place {
  readonly cityId?: string | null | undefined;
  readonly locationId?: string | null | undefined;
}

/**
 * The place a request goes out with. Place is applied as a unit or not at all: a store beats a city,
 * so adding a default store to an explicitly named city would silently override the caller's choice.
 */
function placeOf(snapshot: TalqynDefaultsSnapshot, value: Place): { cityId: string | undefined; locationId: string | undefined } {
  if (value.cityId == null && value.locationId == null) {
    return { cityId: snapshot.cityId, locationId: snapshot.locationId };
  }
  return { cityId: value.cityId ?? undefined, locationId: value.locationId ?? undefined };
}

export function withSearchDefaults(snapshot: TalqynDefaultsSnapshot, query: TalqynSearchQuery): TalqynSearchQuery {
  return {
    ...query,
    locale: query.locale ?? snapshot.locale,
    variant: query.variant ?? snapshot.variant,
    ...placeOf(snapshot, query),
  };
}

export function withCriteriaDefaults<T extends TalqynFilterCriteria>(snapshot: TalqynDefaultsSnapshot, criteria: T): T {
  return { ...criteria, locale: criteria.locale ?? snapshot.locale, ...placeOf(snapshot, criteria) };
}

/** The criteria and the variant from one snapshot: read apart, the defaults could change in between. */
export function withFullSearchDefaults(snapshot: TalqynDefaultsSnapshot, query: TalqynFullSearchQuery): TalqynFullSearchQuery {
  return { ...withCriteriaDefaults(snapshot, query), variant: query.variant ?? snapshot.variant };
}

/** Place and locale travel on every consultant turn: a session keeps neither. */
export function withConsultantDefaults(snapshot: TalqynDefaultsSnapshot, query: TalqynConsultantQuery): TalqynConsultantQuery {
  return {
    ...query,
    locale: query.locale ?? snapshot.locale,
    variant: query.variant ?? snapshot.variant,
    ...placeOf(snapshot, query),
  };
}

export function withSearchSubmitDefaults(
  snapshot: TalqynDefaultsSnapshot,
  event: TalqynSearchSubmitEvent,
): TalqynSearchSubmitEvent {
  return { ...event, locale: event.locale ?? snapshot.locale, variant: event.variant ?? snapshot.variant };
}

export function withVariantDefault<T extends { readonly variant?: string | undefined }>(
  snapshot: TalqynDefaultsSnapshot,
  value: T,
): T {
  return { ...value, variant: value.variant ?? snapshot.variant };
}
