import { TalqynConsultantApi } from './api/consultant-api.js';
import { TalqynEventsApi } from './api/events-api.js';
import { TalqynSearchApi } from './api/search-api.js';
import { TalqynDeviceTokenAuthorizer } from './auth/device-token-authorizer.js';
import { TalqynDeviceTokenMinter } from './auth/device-token-minter.js';
import { TalqynLocalStorageUserIdStore } from './auth/user-id-store.js';
import { TalqynRetryPolicy, type TalqynConfiguration } from './configuration.js';
import { TalqynDeviceTokenCredentials, type TalqynDeviceIdentity } from './credentials.js';
import { TalqynDefaults } from './defaults.js';
import { abortable } from './internal/async.js';
import type { TalqynLocale } from './locale.js';
import { TalqynApiClient } from './networking/api-client.js';
import { TalqynFetchTransport } from './networking/http-transport.js';
import { TalqynRequestBuilder } from './networking/request-builder.js';
import type { TalqynRequestOptions } from './request-options.js';
import { TALQYN_CLIENT_HEADER, TALQYN_VERSION } from './version.js';

/**
 * The Talqyn client: search, consultant, events.
 *
 * Create **one instance per page** — per app, for a single-page app. It holds the issued device token
 * and the defaults shared by every request — locale, place, A/B bucket — so a second instance would
 * mint a second token and run a second reissue schedule of its own.
 *
 * ```ts
 * const talqyn = new Talqyn({
 *   credentials: new TalqynDeviceTokenCredentials({
 *     storefront: 'myshop',
 *     clientKeyId: 'ck_3f9a1c2b7d4e',
 *     clientSecret: secret,
 *   }),
 *   baseUrl: import.meta.env.VITE_TALQYN_BASE_URL,
 *   defaultLocale: 'en',
 * });
 *
 * const found = await talqyn.search.search('iphone 15');
 * for await (const event of talqyn.consultant.ask('need a laptop for school')) {
 *   // ...
 * }
 * ```
 */
export class Talqyn {
  /** The SDK's version, sent with every request as `X-Talqyn-SDK`. Quote it when contacting Talqyn support. */
  static readonly version: string = TALQYN_VERSION;

  /** The value of the `X-Talqyn-SDK` header: platform and version. */
  static readonly clientHeader: string = TALQYN_CLIENT_HEADER;

  /** Instant search, listings, and the filter panel. */
  readonly search: TalqynSearchApi;

  /** The consultant and the shopper's chat history. */
  readonly consultant: TalqynConsultantApi;

  /** Clicks and submitted queries. */
  readonly events: TalqynEventsApi;

  private readonly defaults: TalqynDefaults;
  private readonly authorizer: TalqynDeviceTokenAuthorizer;

  /**
   * Creates a client.
   *
   * Nothing is sent, and nothing is read from storage: this is safe during server-side rendering and
   * at the very start of a page. The first request mints the device token on the way; call
   * {@link prepare} early to get that out of the way ahead of time.
   */
  constructor(configuration: TalqynConfiguration) {
    const timeoutMs = configuration.timeoutMs ?? 30_000;
    const streamTimeoutMs = configuration.streamTimeoutMs ?? 60_000;
    const logHandler = configuration.logHandler;
    const transport =
      configuration.transport ??
      new TalqynFetchTransport({
        // A consultant turn outlives an ordinary request, so the ceiling is generous; the stream's own
        // timeout measures the gap between chunks and does not cut a live stream short.
        resourceTimeoutMs: Math.max(timeoutMs, streamTimeoutMs) * 10,
      });
    const builder = new TalqynRequestBuilder(configuration.baseUrl, configuration.apiVersion ?? 'v1', timeoutMs);

    this.authorizer = new TalqynDeviceTokenAuthorizer({
      credentials: TalqynDeviceTokenCredentials.from(configuration.credentials),
      store: configuration.userIdStore ?? new TalqynLocalStorageUserIdStore(),
      minter: new TalqynDeviceTokenMinter({ builder, transport, logHandler }),
      logHandler,
    });

    const client = new TalqynApiClient({
      builder,
      transport,
      authorizer: this.authorizer,
      retryPolicy: configuration.retryPolicy ?? TalqynRetryPolicy.default,
      streamTimeoutMs,
      logHandler,
    });

    this.defaults = new TalqynDefaults({
      locale: configuration.defaultLocale ?? 'en',
      cityId: configuration.defaultCityId,
      locationId: configuration.defaultLocationId,
      variant: configuration.variant,
    });
    this.search = new TalqynSearchApi(client, this.defaults);
    this.consultant = new TalqynConsultantApi(client, this.defaults, logHandler);
    this.events = new TalqynEventsApi(client, this.defaults, logHandler);
  }

  // MARK: Device token

  /**
   * Mints the device token ahead of time, typically as the page starts.
   *
   * Without it the first request pays for the mint, and the shopper waits two round trips instead of
   * one. The error is usually safe to ignore — the next request will try again — with one exception:
   * `forbidden` means device-token issuance is not enabled for the storefront, which will not start
   * working on its own. That is a conversation with Talqyn support.
   */
  async prepare(options: TalqynRequestOptions = {}): Promise<void> {
    await abortable(this.authorizer.prepare(), options.signal);
  }

  /**
   * Changes who the SDK acts as: sign-in, sign-out, "leave my history".
   *
   * The current token is discarded, because it names the previous shopper and turns taken under it
   * would land in **their** history.
   */
  setIdentity(identity: TalqynDeviceIdentity): void {
    this.authorizer.setIdentity(identity);
  }

  /**
   * The shopper the SDK currently acts as: their id, or `undefined` for a guest — the consultant works,
   * no history is recorded.
   */
  currentUserId(): string | undefined {
    return this.authorizer.currentUserId();
  }

  /**
   * The identity the SDK currently acts under, as it was set. Unlike {@link currentUserId}, this does
   * not change when a token is issued: it is the value to compare when deciding whether the shopper
   * changed.
   */
  currentIdentity(): TalqynDeviceIdentity {
    return this.authorizer.currentIdentity();
  }

  // MARK: Request defaults

  /**
   * Sets the shopper's place for every subsequent request.
   *
   * Both values are ids of options from `talqyn.search.filters` — the `city` and `location` groups —
   * that is, identifiers in **your** catalog's numbering.
   *
   * Changing the city **must** clear the store, which is why both travel in one call. A store beats a
   * city, so a new city paired with a stale store would apply the stale one: the city change would
   * appear to work while doing nothing.
   *
   * @param cityId The city, or `undefined` to search the whole country.
   * @param locationId The specific store, or `undefined` for the whole city.
   */
  setPlace(cityId: string | null | undefined, locationId?: string | null): void {
    this.defaults.update((current) => ({
      ...current,
      cityId: cityId ?? undefined,
      locationId: locationId ?? undefined,
    }));
  }

  /** Sets the locale of every subsequent request. */
  setLocale(locale: TalqynLocale): void {
    this.defaults.update((current) => ({ ...current, locale }));
  }

  /**
   * Sets the storefront's A/B bucket. Echoed into Talqyn analytics so a pilot can be compared against
   * your previous search; it has no effect on results.
   *
   * @param variant The bucket label — `[A-Za-z0-9._:-]`, at most 32 characters — or `undefined` when
   *   no experiment is running.
   */
  setVariant(variant: string | null | undefined): void {
    this.defaults.update((current) => ({ ...current, variant: variant ?? undefined }));
  }

  /** The place currently applied to requests that name none. */
  get currentPlace(): { readonly cityId: string | undefined; readonly locationId: string | undefined } {
    const { cityId, locationId } = this.defaults.current;
    return { cityId, locationId };
  }

  /** The locale currently applied to requests that name none. */
  get currentLocale(): TalqynLocale {
    return this.defaults.current.locale;
  }
}
