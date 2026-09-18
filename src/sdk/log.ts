/** The severity of a {@link TalqynLogEvent}. */
export type TalqynLogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * A diagnostic message emitted by the SDK.
 *
 * Carries no secrets, tokens, or shopper identifiers.
 */
export interface TalqynLogEvent {
  /** How severe the event is. */
  readonly level: TalqynLogLevel;
  /** A human-readable description of what happened. */
  readonly message: string;
  /** The `X-Request-ID` of the request involved, when there is one: the value to quote to Talqyn support. */
  readonly requestId?: string;
}

/** Where SDK diagnostics are delivered. */
export type TalqynLogHandler = (event: TalqynLogEvent) => void;

/**
 * Hands an event to the app's handler.
 *
 * A handler that throws costs the log line, not the request: diagnostics must not be able to break
 * what they describe.
 */
export function emitLog(
  handler: TalqynLogHandler | undefined,
  level: TalqynLogLevel,
  message: string,
  requestId?: string,
): void {
  if (!handler) return;
  try {
    handler(requestId === undefined ? { level, message } : { level, message, requestId });
  } catch {
    // Swallowed on purpose; see above.
  }
}
