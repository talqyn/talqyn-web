import { withSearchSubmitDefaults, withVariantDefault, type TalqynDefaults } from '../defaults.js';
import { emitLog, type TalqynLogHandler } from '../log.js';
import {
  encodeCategoryClickEvent,
  encodeProductClickEvent,
  encodeSearchSubmitEvent,
  type TalqynCategoryClickEvent,
  type TalqynProductClickEvent,
  type TalqynSearchSubmitEvent,
} from '../models/event-models.js';
import type { TalqynApiClient } from '../networking/api-client.js';
import { TalqynError } from '../networking/error.js';
import type { TalqynRequestOptions } from '../request-options.js';

/** Any storefront event. */
export type TalqynEvent = TalqynProductClickEvent | TalqynSearchSubmitEvent | TalqynCategoryClickEvent;

/**
 * Storefront events: clicks and submitted queries. Reached through `talqyn.events`.
 *
 * Requires the `events` scope. Not analytics for its own sake: the `history` block of an
 * instant-search response and the denominator of click-through are both assembled from these rows.
 * The storefront has to report them itself — by definition there is no backend of yours in the chain
 * to do it. An event is attributed to the shopper the device token names.
 *
 * Event requests are sent with `keepalive`: a click on a product card is usually followed at once by a
 * navigation, and a request the page takes away with it is a click that never counted.
 */
export class TalqynEventsApi {
  /** @internal Reached through `talqyn.events`. */
  constructor(
    private readonly client: TalqynApiClient,
    private readonly defaults: TalqynDefaults,
    private readonly logHandler: TalqynLogHandler | undefined,
  ) {}

  /** Reports a product-card tap: `POST /v1/events/product-click`. Use `track` to fire and forget. */
  async productClick(event: TalqynProductClickEvent, options: TalqynRequestOptions = {}): Promise<void> {
    await this.client.send({
      path: 'events/product-click',
      body: encodeProductClickEvent(withVariantDefault(this.defaults.current, event)),
      safety: 'onlyIfRejected',
      keepalive: true,
      signal: options.signal,
    });
  }

  /** Reports a submitted search query: `POST /v1/events/search`. Use `track` to fire and forget. */
  async searchSubmit(event: TalqynSearchSubmitEvent, options: TalqynRequestOptions = {}): Promise<void> {
    await this.client.send({
      path: 'events/search',
      body: encodeSearchSubmitEvent(withSearchSubmitDefaults(this.defaults.current, event)),
      safety: 'onlyIfRejected',
      keepalive: true,
      signal: options.signal,
    });
  }

  /** Reports a category tap in the navigation block: `POST /v1/events/category-click`. Use `track` to fire and forget. */
  async categoryClick(event: TalqynCategoryClickEvent, options: TalqynRequestOptions = {}): Promise<void> {
    await this.client.send({
      path: 'events/category-click',
      body: encodeCategoryClickEvent(withVariantDefault(this.defaults.current, event)),
      safety: 'onlyIfRejected',
      keepalive: true,
      signal: options.signal,
    });
  }

  /**
   * Reports an event without waiting for the result. The kind is told by its fields: a `talqynId`
   * makes a product click, a `categoryId` a category click, anything else a submitted query.
   *
   * Never throws: analytics must not be able to break the screen a shopper just tapped. A transient
   * failure is logged at `debug`; a permanent refusal — a key without the `events` scope, a body the
   * server rejects — at `warning`, because it means the `history` block and click-through are silently
   * not being built.
   */
  track(event: TalqynEvent): void {
    if ('talqynId' in event) {
      this.fireAndForget('product-click', () => this.productClick(event));
    } else if ('categoryId' in event) {
      this.fireAndForget('category-click', () => this.categoryClick(event));
    } else {
      this.fireAndForget('search', () => this.searchSubmit(event));
    }
  }

  private fireAndForget(name: string, send: () => Promise<void>): void {
    send().catch((error: unknown) => {
      const failure = TalqynError.wrap(error);
      if (failure.isCancellation) return;
      emitLog(
        this.logHandler,
        failure.isRetryable ? 'debug' : 'warning',
        `event ${name} was not delivered: ${failure.message}`,
        failure.requestId,
      );
    });
  }
}
