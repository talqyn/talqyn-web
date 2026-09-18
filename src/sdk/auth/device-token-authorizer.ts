import { shopperIdOf, clientSecretOf, type TalqynDeviceIdentity, type TalqynDeviceTokenCredentials } from '../credentials.js';
import { isUuid, makeUuid } from '../internal/random.js';
import { emitLog, type TalqynLogHandler } from '../log.js';
import type { TalqynDeviceToken } from '../models/device-token.js';
import { TalqynError } from '../networking/error.js';
import type { TalqynDeviceTokenMinter, TalqynMinted } from './device-token-minter.js';
import type { TalqynUserIdStore } from './user-id-store.js';

interface IssuedToken {
  readonly token: TalqynDeviceToken;
  /** When to start fetching the next token, ahead of expiry, by the local clock. */
  readonly refreshAt: number;
  /** When this token stops working, by the local clock. */
  readonly expiresAt: number;
}

/**
 * The refresh lead is a fifth of the lifetime, floored at 15 s and capped at two minutes: a bare
 * percentage would reissue on every request for a short token, and hold a long one far past its use.
 */
function issuedToken(token: TalqynDeviceToken, issuedAt: number): IssuedToken {
  const life = Math.max(token.expiresIn, 1);
  const lead = Math.min(Math.max(life * 0.2, 15), 120);
  return {
    token,
    refreshAt: issuedAt + Math.max(life - lead, 1) * 1000,
    expiresAt: issuedAt + life * 1000,
  };
}

interface InFlightMint {
  readonly promise: Promise<TalqynMinted>;
  readonly controller: AbortController;
}

function authorizationFor(token: TalqynDeviceToken): string {
  return `Bearer ${token.token}`;
}

/**
 * Mints, caches, and reissues the device token.
 *
 * A token lives for minutes. Reissuing is timed from its `expiresIn` and runs **in the background**
 * while the current token is still good: no request waits for a reissue, and a reissue that fails is a
 * log line rather than a failed search — the current token keeps working until it actually expires.
 * Timed from the **local** clock at the moment of the response: `expires_at` runs on the server's
 * clock, and device clocks drift.
 *
 * Screens race for the token — search and the consultant open at once — and that has to mint once,
 * not twice: every waiter shares the one mint in flight.
 */
export class TalqynDeviceTokenAuthorizer {
  /** Pause after an unrecoverable refusal (403 "not enabled", 501 "not configured"). Without it every screen would hammer the endpoint for the same answer. */
  private static readonly failureCooldownMs = 60_000;

  /**
   * Pause between **background** reissue attempts after a transient failure. Without it a 503 on the
   * mint endpoint would cost one mint per request — one per keystroke, for a search field — for as long
   * as the refresh window lasts. A request whose token has actually expired is not held back by this:
   * it needs a token and waits for the mint.
   */
  private static readonly reissueRetryDelayMs = 5_000;

  private readonly credentials: TalqynDeviceTokenCredentials;
  private readonly store: TalqynUserIdStore;
  private readonly minter: TalqynDeviceTokenMinter;
  private readonly logHandler: TalqynLogHandler | undefined;
  /** The clock. Injected so the lifecycle can be tested without waiting it out. */
  private readonly now: () => number;

  private identity: TalqynDeviceIdentity;
  private issued: IssuedToken | undefined;
  private inFlight: InFlightMint | undefined;
  private blocked: { readonly until: number; readonly error: TalqynError } | undefined;
  private nextBackgroundReissueAt: number | undefined;
  /** Bumped on every identity change. A mint that started under a previous value belongs to a previous shopper, however it ends. */
  private generation = 0;
  /**
   * Server clock minus device clock, learned from a rejected mint and kept in the store, so the next
   * mint — on this page or the next visit — signs with the right time from its first attempt. Read from
   * the store on first use: constructing the client reads nothing.
   */
  private clockOffsetMs: number | undefined;

  constructor(init: {
    readonly credentials: TalqynDeviceTokenCredentials;
    readonly store: TalqynUserIdStore;
    readonly minter: TalqynDeviceTokenMinter;
    readonly logHandler?: TalqynLogHandler | undefined;
    readonly now?: () => number;
  }) {
    this.credentials = init.credentials;
    this.store = init.store;
    this.minter = init.minter;
    this.logHandler = init.logHandler;
    this.now = init.now ?? Date.now;
    this.identity = init.credentials.identity;
  }

  /** The `Authorization` header for the next request, minting or reissuing the token on the way when needed. */
  async headers(): Promise<Record<string, string>> {
    const token = await this.token();
    return { Authorization: authorizationFor(token) };
  }

  /**
   * The server rejected the token (401): drops it, but only if it is the one that was rejected. Two
   * requests racing past expiry both see a 401; by the time the second one reports it, the first has
   * already minted a replacement that must survive.
   *
   * @param authorization The `Authorization` header value the rejected request carried.
   */
  invalidate(authorization: string | undefined): void {
    if (!this.issued) return;
    if (authorization !== undefined && authorization !== authorizationFor(this.issued.token)) return;
    this.issued = undefined;
  }

  /** The shopper the SDK acts as. The server's canonical form is lowercase; the local id is lowercased too, so the value does not change casing once a token exists. */
  currentUserId(): string | undefined {
    return this.issued?.token.userId ?? this.resolveUserId();
  }

  /** Who the SDK acts as, as the app set it. */
  currentIdentity(): TalqynDeviceIdentity {
    return this.identity;
  }

  /** Changes the shopper. The issued token is discarded: it names the previous one, and turns under it would land in their history. */
  setIdentity(identity: TalqynDeviceIdentity): void {
    if (identity.equals(this.identity)) return;
    this.identity = identity;
    this.generation += 1;
    this.issued = undefined;
    this.blocked = undefined;
    this.nextBackgroundReissueAt = undefined;
    this.inFlight?.controller.abort(TalqynError.cancelled());
    this.inFlight = undefined;
  }

  prepare(): Promise<TalqynDeviceToken> {
    return this.token();
  }

  private async token(): Promise<TalqynDeviceToken> {
    const now = this.now();
    const issued = this.issued;
    if (issued && now < issued.expiresAt) {
      // Past the refresh mark but still good: fetch the next one in the background and serve this one.
      // Nobody waits, and a reissue that fails costs nothing until this token runs out.
      if (now >= issued.refreshAt && !this.inFlight && !this.isBlocked(now) && !this.isBackingOff(now)) {
        const task = this.startMint();
        this.settle(task, this.generation).catch(() => undefined);
      }
      return issued.token;
    }
    if (this.blocked) {
      if (now < this.blocked.until) throw this.blocked.error;
      this.blocked = undefined;
    }
    const generation = this.generation;
    const task = this.inFlight ?? this.startMint();
    return this.settle(task, generation);
  }

  private startMint(): InFlightMint {
    const controller = new AbortController();
    const promise = this.minter.mint({
      storefront: this.credentials.storefront,
      clientKeyId: this.credentials.clientKeyId,
      clientSecret: clientSecretOf(this.credentials),
      userId: this.resolveUserId(),
      clockOffsetMs: this.loadClockOffset(),
      signal: controller.signal,
    });
    // Every waiter handles the outcome; this keeps a mint nobody ends up waiting for from reporting
    // an unhandled rejection.
    promise.catch(() => undefined);
    const task = { promise, controller };
    this.inFlight = task;
    return task;
  }

  /**
   * Waits for a mint and installs its outcome. Every waiter — a request, `prepare()`, the background
   * reissue — comes through here; the first to resume does the bookkeeping, and the rest find
   * `inFlight` already cleared.
   */
  private async settle(task: InFlightMint, generation: number): Promise<TalqynDeviceToken> {
    let minted: TalqynMinted;
    try {
      minted = await task.promise;
    } catch (error) {
      const failure = TalqynError.wrap(error);
      if (generation !== this.generation) throw TalqynError.cancelled();
      if (this.inFlight === task) {
        this.inFlight = undefined;
        const now = this.now();
        // Cancellation is not a refusal: a dismissed screen must not lock the consultant out for the next caller.
        if (failure.isCancellation) {
          // Nothing to remember.
        } else if (failure.isRetryable) {
          this.nextBackgroundReissueAt = now + TalqynDeviceTokenAuthorizer.reissueRetryDelayMs;
        } else {
          this.blocked = { until: now + TalqynDeviceTokenAuthorizer.failureCooldownMs, error: failure };
        }
        if (this.issued) {
          const left = this.issued.expiresAt - now;
          if (left > 0) {
            emitLog(
              this.logHandler,
              'warning',
              `device token reissue failed (${failure.message}); the current token is good for another ${Math.trunc(left / 1000)}s`,
              failure.requestId,
            );
          }
        }
      }
      throw failure;
    }

    // The shopper may have changed while the mint was in flight — a response already received still
    // completes. That token names the previous shopper: it must not be installed, or the next turn
    // would land in their history.
    if (generation !== this.generation) throw TalqynError.cancelled();
    if (this.inFlight === task) {
      this.inFlight = undefined;
      this.nextBackgroundReissueAt = undefined;
      if (minted.clockOffsetMs !== this.loadClockOffset()) {
        this.clockOffsetMs = minted.clockOffsetMs;
        this.store.saveClockOffsetMs?.(minted.clockOffsetMs === 0 ? undefined : minted.clockOffsetMs);
      }
      this.issued = issuedToken(minted.token, this.now());
      emitLog(
        this.logHandler,
        'debug',
        `device token issued for ${Math.trunc(minted.token.expiresIn)}s, guest=${minted.token.isGuest}`,
      );
    }
    return minted.token;
  }

  private isBlocked(now: number): boolean {
    return this.blocked !== undefined && now < this.blocked.until;
  }

  private isBackingOff(now: number): boolean {
    return this.nextBackgroundReissueAt !== undefined && now < this.nextBackgroundReissueAt;
  }

  private loadClockOffset(): number {
    if (this.clockOffsetMs === undefined) {
      const stored = this.store.loadClockOffsetMs?.();
      this.clockOffsetMs = stored !== undefined && Number.isFinite(stored) ? stored : 0;
    }
    return this.clockOffsetMs;
  }

  /** `persistentAnonymous` generates the UUID on first use and stores it: without an id that survives a reload there is no chat history. */
  private resolveUserId(): string | undefined {
    switch (this.identity.kind) {
      case 'guest':
        return undefined;
      case 'user':
        return shopperIdOf(this.identity);
      case 'persistentAnonymous': {
        const stored = this.store.loadUserId();
        if (isUuid(stored)) return stored.toLowerCase();
        const generated = makeUuid();
        this.store.saveUserId(generated);
        return generated;
      }
    }
  }
}
