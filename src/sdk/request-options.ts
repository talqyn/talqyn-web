/** What every SDK call accepts besides its own parameters. */
export interface TalqynRequestOptions {
  /**
   * Cancels the call. A cancelled call rejects with a `TalqynError` of kind `cancelled`, and the
   * request behind it — the connection included — is stopped.
   *
   * The SDK does not cancel a previous request by itself: it does not know that two calls are one
   * search field. Abort the previous call before starting the next one.
   */
  readonly signal?: AbortSignal | undefined;
}
