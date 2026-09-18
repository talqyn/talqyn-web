import { describe, expect, it } from 'vitest';
import {
  TalqynDeviceIdentity,
  TalqynInMemoryUserIdStore,
  TalqynLocalStorageUserIdStore,
  type TalqynStorageLike,
} from '../../src/sdk/index.js';
import { StubTransport, TestFixtures } from '../support/stub-transport.js';

class MemoryStorage implements TalqynStorageLike {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** Storage the browser refuses: a sandboxed iframe, blocked site data. */
class BlockedStorage implements TalqynStorageLike {
  getItem(): string | null {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }

  setItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }

  removeItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
}

const shopper = '6F1C2B9A-3E47-4B8F-9A10-2C5D8E7F4A01';

describe('TalqynLocalStorageUserIdStore', () => {
  it('keeps the id under its key for the next visit', () => {
    const storage = new MemoryStorage();
    new TalqynLocalStorageUserIdStore({ storage }).saveUserId(shopper);
    expect(storage.items.get('talqyn.user_id')).toBe(shopper);

    // The next visit reads it back, in its canonical lowercase form.
    expect(new TalqynLocalStorageUserIdStore({ storage }).loadUserId()).toBe(shopper.toLowerCase());
  });

  it('adopts an id the site already generated under a key of its own', () => {
    const storage = new MemoryStorage();
    storage.setItem('consultant_anonymous_id', shopper);
    expect(new TalqynLocalStorageUserIdStore({ storage, key: 'consultant_anonymous_id' }).loadUserId()).toBe(
      shopper.toLowerCase(),
    );
    expect(new TalqynLocalStorageUserIdStore({ storage }).loadUserId()).toBeUndefined();
  });

  it('reads a value that is not a UUID as no id', () => {
    const storage = new MemoryStorage();
    storage.setItem('talqyn.user_id', 'crm-42');
    expect(new TalqynLocalStorageUserIdStore({ storage }).loadUserId()).toBeUndefined();
  });

  it('forgets the id', () => {
    const storage = new MemoryStorage();
    const store = new TalqynLocalStorageUserIdStore({ storage });
    store.saveUserId(shopper);
    store.saveUserId(undefined);
    expect(storage.items.has('talqyn.user_id')).toBe(false);
    expect(store.loadUserId()).toBeUndefined();
  });

  it('keeps the clock correction under a key of its own', () => {
    const storage = new MemoryStorage();
    const store = new TalqynLocalStorageUserIdStore({ storage, key: 'shop.user' });
    expect(store.loadClockOffsetMs()).toBeUndefined();

    store.saveClockOffsetMs(-900_000);
    expect(storage.items.get('shop.user.clock_offset')).toBe('-900000');
    expect(new TalqynLocalStorageUserIdStore({ storage, key: 'shop.user' }).loadClockOffsetMs()).toBe(-900_000);
    // Another storefront's store does not share it.
    expect(new TalqynLocalStorageUserIdStore({ storage }).loadClockOffsetMs()).toBeUndefined();

    store.saveClockOffsetMs(undefined);
    expect(storage.items.has('shop.user.clock_offset')).toBe(false);
    expect(store.loadClockOffsetMs()).toBeUndefined();

    storage.setItem('shop.user.clock_offset', 'soon');
    expect(store.loadClockOffsetMs()).toBeUndefined();
    storage.setItem('shop.user.clock_offset', ' ');
    expect(store.loadClockOffsetMs(), 'an empty value is no correction, not a zero one').toBeUndefined();
  });

  /** With a working storage an absent key is an answer, not an outage: the memory shadow must not undo it. */
  it('does not resurrect an id the shopper cleared from a working storage', () => {
    const storage = new MemoryStorage();
    const store = new TalqynLocalStorageUserIdStore({ storage });
    store.saveUserId(shopper);
    store.saveClockOffsetMs(1_000);
    // The shopper clears the site's data mid-session, outside the SDK.
    storage.items.clear();
    expect(store.loadUserId()).toBeUndefined();
    expect(store.loadClockOffsetMs()).toBeUndefined();
  });

  /** Blocked storage must not fail every request: the values last as long as the page. */
  it('keeps the values in memory for the page when storage is blocked', () => {
    const store = new TalqynLocalStorageUserIdStore({ storage: new BlockedStorage() });
    expect(store.loadUserId()).toBeUndefined();
    store.saveUserId(shopper);
    expect(store.loadUserId()).toBe(shopper.toLowerCase());
    store.saveClockOffsetMs(1_000);
    expect(store.loadClockOffsetMs()).toBe(1_000);
  });

  it('works where there is no localStorage at all', () => {
    const store = new TalqynLocalStorageUserIdStore();
    store.saveUserId(shopper);
    expect(store.loadUserId()).toBe(shopper.toLowerCase());
  });

  it('gives a persistent anonymous shopper one id for the page when storage is blocked', () => {
    const talqyn = TestFixtures.client({
      transport: new StubTransport(),
      credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.persistentAnonymous),
      userIdStore: new TalqynLocalStorageUserIdStore({ storage: new BlockedStorage() }),
    });
    const first = talqyn.currentUserId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(talqyn.currentUserId()).toBe(first);
  });
});

describe('TalqynInMemoryUserIdStore', () => {
  it('keeps the values for the lifetime of the page', () => {
    const store = new TalqynInMemoryUserIdStore(shopper);
    expect(store.loadUserId()).toBe(shopper.toLowerCase());
    store.saveUserId(undefined);
    expect(store.loadUserId()).toBeUndefined();
    store.saveClockOffsetMs(5);
    expect(store.loadClockOffsetMs()).toBe(5);
  });

  it('names nobody when the site names nobody', () => {
    const talqyn = TestFixtures.client({
      transport: new StubTransport(),
      credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.guest),
    });
    expect(talqyn.currentUserId()).toBeUndefined();
  });
});
