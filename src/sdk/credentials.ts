import { isUuid } from './internal/random.js';
import { TalqynError } from './networking/error.js';

const inspectCustom = Symbol.for('nodejs.util.inspect.custom');

/** The UUID of a named shopper, kept off the object so that printing it cannot show it. */
const shopperIds = new WeakMap<TalqynDeviceIdentity, string>();

/** Which kind of {@link TalqynDeviceIdentity} a value is. */
export type TalqynDeviceIdentityKind = 'guest' | 'persistentAnonymous' | 'user';

/**
 * Who a device token names as the shopper.
 *
 * Exactly one thing depends on this, and it is a significant one: chat history. A guest has none —
 * conversations stay anonymous for ever — whereas a named shopper gets a history that reopens under
 * the same id on the next visit. This is why the id **must survive a reload**.
 *
 * The server accepts UUIDs only. The id is asserted by the device and confirmed by nobody, so being
 * unguessable is the only thing protecting somebody else's conversations: an enumerable id such as a
 * CRM row number would expose other shoppers' history by iteration. A CRM identifier therefore does
 * not belong here — if history has to follow a shopper across devices, map your own id to a stable
 * UUID on your backend and pass it through {@link TalqynDeviceIdentity.user}.
 *
 * A shopper's UUID is what their history is read under, so it stays out of print the way the client
 * secret does: a named identity prints as `user(***)`.
 */
export class TalqynDeviceIdentity {
  /** A guest token: no `user_id` is sent. The consultant works, no history is recorded. */
  static readonly guest: TalqynDeviceIdentity = new TalqynDeviceIdentity('guest');

  /** A persistent anonymous UUID, generated on first use and kept in the configured user-id store. */
  static readonly persistentAnonymous: TalqynDeviceIdentity = new TalqynDeviceIdentity('persistentAnonymous');

  private constructor(
    /** Which kind of identity this is. */
    readonly kind: TalqynDeviceIdentityKind,
  ) {}

  /**
   * An explicit shopper UUID, for example one handed out by your backend after sign-in.
   *
   * @throws {TalqynError} `invalidConfiguration` when `id` is not a UUID.
   */
  static user(id: string): TalqynDeviceIdentity {
    if (!isUuid(id)) throw TalqynError.invalidConfiguration('a shopper id must be a UUID');
    const identity = new TalqynDeviceIdentity('user');
    shopperIds.set(identity, id.toLowerCase());
    return identity;
  }

  /** Whether two identities name the same shopper the same way. */
  equals(other: TalqynDeviceIdentity | undefined): boolean {
    if (!other || other.kind !== this.kind) return false;
    return this.kind !== 'user' || shopperIds.get(this) === shopperIds.get(other);
  }

  /** `guest`, `persistentAnonymous`, or `user(***)`. */
  toString(): string {
    return this.kind === 'user' ? 'user(***)' : this.kind;
  }

  toJSON(): string {
    return this.toString();
  }
}

Object.defineProperty(TalqynDeviceIdentity.prototype, inspectCustom, {
  value(this: TalqynDeviceIdentity): string {
    return this.toString();
  },
});

/** The UUID a `user` identity names. Internal: the one place the UUID is read back. */
export function shopperIdOf(identity: TalqynDeviceIdentity): string | undefined {
  return shopperIds.get(identity);
}

/** The client secret, kept off the object so that printing it cannot show it. */
const clientSecrets = new WeakMap<TalqynDeviceTokenCredentials, string>();

/** What {@link TalqynDeviceTokenCredentials} is built from. */
export interface TalqynDeviceTokenCredentialsInit {
  /** The storefront slug issued during onboarding. Addressing, not a secret. */
  readonly storefront: string;
  /** The client key id. Sent in the `X-Client-Key` header. */
  readonly clientKeyId: string;
  /** The client key secret. Never transmitted; used only to sign mint requests. */
  readonly clientSecret: string;
  /** Who the issued token names as the shopper. Defaults to {@link TalqynDeviceIdentity.persistentAnonymous}. */
  readonly identity?: TalqynDeviceIdentity;
}

/**
 * The storefront client key shipped inside the site's bundle.
 *
 * The SDK authenticates one way: a client key (`id` + `secret`) signs a call to
 * `POST /v1/consultant/token`, and every subsequent request travels under the short-lived `tlqd_`
 * token it returns. The token lives for minutes, grants exactly three scopes (consultant, search, and
 * the events of its own shopper), has its own rate-limit bucket, and names the shopper it belongs to —
 * which is what makes per-shopper chat history possible at all.
 *
 * The tenant's `tlq_` key has no place on a page and is deliberately not accepted: whatever ships to
 * a browser is readable by anyone who opens the page's sources, a `tlq_` key can only be revoked by
 * rotating it on your backend, and it shares one per-minute bucket across every visitor. It stays a
 * backend credential. The client key is public by design in the same sense — it is visible in the
 * bundle — and the design around it is what protects the storefront: the secret never travels, a
 * mint is signed per request, tokens live for minutes, and rotation is scoped to one storefront.
 *
 * The secret stays out of logs and the console: `String(credentials)`, `JSON.stringify`, and
 * `console.log` show `clientSecret: ***`.
 */
export class TalqynDeviceTokenCredentials {
  /** The storefront slug issued during onboarding. */
  readonly storefront: string;
  /** The client key id, sent as `X-Client-Key`. */
  readonly clientKeyId: string;
  /** Who the issued token names as the shopper. */
  readonly identity: TalqynDeviceIdentity;

  constructor(init: TalqynDeviceTokenCredentialsInit) {
    this.storefront = init.storefront;
    this.clientKeyId = init.clientKeyId;
    this.identity = init.identity ?? TalqynDeviceIdentity.persistentAnonymous;
    clientSecrets.set(this, init.clientSecret);
  }

  /** The credentials themselves, or credentials built from a plain object. */
  static from(value: TalqynDeviceTokenCredentials | TalqynDeviceTokenCredentialsInit): TalqynDeviceTokenCredentials {
    return value instanceof TalqynDeviceTokenCredentials ? value : new TalqynDeviceTokenCredentials(value);
  }

  /**
   * The credentials with the secret masked:
   * `TalqynDeviceTokenCredentials(storefront: myshop, clientKeyId: ck_3f9a1c2b7d4e, clientSecret: ***, identity: guest)`.
   */
  toString(): string {
    return `TalqynDeviceTokenCredentials(storefront: ${this.storefront}, clientKeyId: ${this.clientKeyId}, clientSecret: ***, identity: ${this.identity.toString()})`;
  }

  toJSON(): Record<string, string> {
    return {
      storefront: this.storefront,
      clientKeyId: this.clientKeyId,
      clientSecret: '***',
      identity: this.identity.toString(),
    };
  }
}

Object.defineProperty(TalqynDeviceTokenCredentials.prototype, inspectCustom, {
  value(this: TalqynDeviceTokenCredentials): string {
    return this.toString();
  },
});

/** The client secret. Internal: the one place it is read back, to sign a mint. */
export function clientSecretOf(credentials: TalqynDeviceTokenCredentials): string {
  return clientSecrets.get(credentials) ?? '';
}
