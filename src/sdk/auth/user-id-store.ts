import { isUuid } from '../internal/random.js';

/**
 * Storage for what the SDK has to remember between visits: the persistent anonymous shopper UUID
 * and the device clock correction.
 *
 * The id **must** survive a page reload and the next visit: it is the only thing that reopens a
 * shopper's conversations. It should **not** outlive the shopper clearing the site's data — a new id
 * simply has no history, which is preferable to handing one person the conversations of another.
 *
 * The clock correction is a convenience: without it a device with a skewed clock pays one rejected
 * mint per visit to learn the skew again. The two clock methods are optional, so a store written for
 * the id alone keeps working.
 *
 * Implement this to keep the values somewhere of your own; the SDK ships
 * {@link TalqynLocalStorageUserIdStore} and {@link TalqynInMemoryUserIdStore}.
 */
export interface TalqynUserIdStore {
  /** The stored shopper UUID, or `undefined` if none has been stored yet. */
  loadUserId(): string | undefined;

  /** Stores the shopper UUID, replacing any previous value; `undefined` forgets it. */
  saveUserId(id: string | undefined): void;

  /** The stored clock correction — server clock minus device clock — in milliseconds. */
  loadClockOffsetMs?(): number | undefined;

  /** Stores the clock correction, in milliseconds; `undefined` forgets it. */
  saveClockOffsetMs?(offsetMs: number | undefined): void;
}

/** The part of `Storage` the store uses. */
export type TalqynStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Options of {@link TalqynLocalStorageUserIdStore}. */
export interface TalqynLocalStorageUserIdStoreOptions {
  /**
   * The storage key. Point it at an existing key to adopt an id your site already generated. The
   * clock correction lives under the same key with a `.clock_offset` suffix. Defaults to
   * `talqyn.user_id`.
   */
  readonly key?: string;
  /** The storage to use. Defaults to `localStorage`. */
  readonly storage?: TalqynStorageLike;
}

/**
 * A {@link TalqynUserIdStore} backed by `localStorage`. The default store.
 *
 * Not a cookie: the shopper id is not a secret — it is asserted by the device and verified by
 * nobody — and it has no business travelling to your servers with every request. If history has to
 * follow a shopper across devices, issue the UUID from your backend and pass it through
 * `TalqynDeviceIdentity.user`.
 *
 * Storage can be unavailable — a sandboxed iframe, a browser that blocks site data, server-side
 * rendering. The store then keeps the values in memory for the page's lifetime rather than failing
 * every request: the consultant works, and history lasts as long as the page.
 */
export class TalqynLocalStorageUserIdStore implements TalqynUserIdStore {
  private readonly key: string;
  private readonly explicitStorage: TalqynStorageLike | undefined;
  private memoryUserId: string | undefined;
  private memoryClockOffsetMs: number | undefined;

  constructor(options: TalqynLocalStorageUserIdStoreOptions = {}) {
    this.key = options.key ?? 'talqyn.user_id';
    this.explicitStorage = options.storage;
  }

  /** The stored shopper UUID in its lowercase form, or `undefined` if the key is absent or holds no UUID. */
  loadUserId(): string | undefined {
    const value = this.read(this.key, this.memoryUserId);
    return isUuid(value) ? value.toLowerCase() : undefined;
  }

  saveUserId(id: string | undefined): void {
    this.memoryUserId = id;
    if (id === undefined) this.remove(this.key);
    else this.write(this.key, id);
  }

  loadClockOffsetMs(): number | undefined {
    const memory = this.memoryClockOffsetMs === undefined ? undefined : String(this.memoryClockOffsetMs);
    const raw = this.read(this.clockOffsetKey, memory);
    // An empty value is no correction, not a zero one: `Number('')` would read it as zero.
    const value = raw === undefined || raw.trim() === '' ? undefined : Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  saveClockOffsetMs(offsetMs: number | undefined): void {
    this.memoryClockOffsetMs = offsetMs;
    if (offsetMs === undefined) this.remove(this.clockOffsetKey);
    else this.write(this.clockOffsetKey, String(offsetMs));
  }

  /** Derived from the key, so two stores with different keys — two storefronts on one site — do not share a correction. */
  private get clockOffsetKey(): string {
    return `${this.key}.clock_offset`;
  }

  private storage(): TalqynStorageLike | undefined {
    if (this.explicitStorage) return this.explicitStorage;
    try {
      // Reading `localStorage` itself throws where site data is blocked.
      return typeof localStorage === 'undefined' ? undefined : localStorage;
    } catch {
      return undefined;
    }
  }

  /**
   * The stored value, or the memory shadow only where storage cannot be reached at all. With a
   * working storage an absent key is an answer — the shopper cleared the site's data — and the
   * shadow must not undo it by resurrecting the value for the rest of the page's life.
   */
  private read(key: string, memory: string | undefined): string | undefined {
    const storage = this.storage();
    if (!storage) return memory;
    try {
      return storage.getItem(key) ?? undefined;
    } catch {
      return memory;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage()?.setItem(key, value);
    } catch {
      // A full or blocked storage: the value stays in memory.
    }
  }

  private remove(key: string): void {
    try {
      this.storage()?.removeItem(key);
    } catch {
      // Nothing to remove from a storage that cannot be reached.
    }
  }
}

/**
 * A {@link TalqynUserIdStore} that keeps its values in memory only.
 *
 * For tests, and for storefronts that manage the shopper id themselves and only need the SDK to hold
 * it for the lifetime of the page.
 */
export class TalqynInMemoryUserIdStore implements TalqynUserIdStore {
  private userId: string | undefined;
  private clockOffsetMs: number | undefined;

  /** @param id The initial shopper UUID, if any. */
  constructor(id?: string) {
    this.userId = id;
  }

  loadUserId(): string | undefined {
    return isUuid(this.userId) ? this.userId.toLowerCase() : undefined;
  }

  saveUserId(id: string | undefined): void {
    this.userId = id;
  }

  loadClockOffsetMs(): number | undefined {
    return this.clockOffsetMs;
  }

  saveClockOffsetMs(offsetMs: number | undefined): void {
    this.clockOffsetMs = offsetMs;
  }
}
