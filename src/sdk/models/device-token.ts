import { asRecord, readDate, readNumber, readString } from '../internal/json.js';

const inspectCustom = Symbol.for('nodejs.util.inspect.custom');

/** The token string and the shopper it names, kept off the object so that printing it cannot show them. */
const secrets = new WeakMap<TalqynDeviceToken, { readonly token: string; readonly userId: string | undefined }>();

/**
 * A device token issued by `POST /v1/consultant/token`.
 *
 * The SDK mints, caches, and reissues these on its own; the type is public so a site can inspect what
 * it is running under.
 *
 * Whoever reads the token can act as its shopper until it expires, and the shopper id is what a history
 * is read under: `String(token)`, `JSON.stringify`, and `console.log` show only when it expires and
 * whether it names a shopper.
 */
export class TalqynDeviceToken {
  /** When the token expires, by the **server's** clock. The SDK counts from local time at the moment the response arrived instead: device clocks drift. */
  readonly expiresAt: Date | undefined;

  /** How many seconds the token lives from the moment it was issued. */
  readonly expiresIn: number;

  private constructor(token: string, expiresAt: Date | undefined, expiresIn: number, userId: string | undefined) {
    this.expiresAt = expiresAt;
    this.expiresIn = expiresIn;
    secrets.set(this, { token, userId });
  }

  /** Decodes a mint response. @returns `undefined` when the response carries no `token`. */
  static decode(value: unknown): TalqynDeviceToken | undefined {
    const record = asRecord(value);
    const token = record ? readString(record, 'token') : undefined;
    if (!record || token === undefined) return undefined;
    return new TalqynDeviceToken(
      token,
      readDate(record, 'expires_at'),
      readNumber(record, 'expires_in') ?? 900,
      readString(record, 'user_id'),
    );
  }

  /** The token string, sent as `Authorization: Bearer tlqd_…`. */
  get token(): string {
    return secrets.get(this)?.token ?? '';
  }

  /** The shopper the token is bound to, in canonical form. `undefined` means a guest token: the consultant works, no history is recorded. */
  get userId(): string | undefined {
    return secrets.get(this)?.userId;
  }

  /** Whether the token names no shopper. */
  get isGuest(): boolean {
    return this.userId === undefined;
  }

  /** The token without its secrets: `TalqynDeviceToken(expiresAt: 2026-08-26T12:15:00.000Z, expiresIn: 900, guest: false)`. */
  toString(): string {
    return `TalqynDeviceToken(expiresAt: ${this.expiresAt?.toISOString() ?? 'nil'}, expiresIn: ${this.expiresIn}, guest: ${this.isGuest})`;
  }

  toJSON(): Record<string, unknown> {
    return { expiresAt: this.expiresAt?.toISOString(), expiresIn: this.expiresIn, guest: this.isGuest };
  }
}

Object.defineProperty(TalqynDeviceToken.prototype, inspectCustom, {
  value(this: TalqynDeviceToken): string {
    return this.toString();
  },
});
