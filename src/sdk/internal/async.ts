import { TalqynError } from '../networking/error.js';

/**
 * Waits `ms` milliseconds, or rejects with `cancelled` as soon as `signal` aborts.
 *
 * A backoff runs inside a retry loop, and a screen that went away must not wait it out.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(TalqynError.cancelled());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(TalqynError.cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Waits for `promise`, or rejects with `cancelled` as soon as `signal` aborts.
 *
 * For work shared between callers — the device-token mint — which one caller's cancellation must
 * not stop for the others: that caller stops waiting, and the work goes on.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(TalqynError.cancelled());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(TalqynError.cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Makes `controller` abort when `parent` does. Returns what unlinks the two, so a finished request
 * does not keep a listener on a long-lived signal.
 */
export function linkSignal(parent: AbortSignal | undefined, controller: AbortController): () => void {
  if (!parent) return () => undefined;
  if (parent.aborted) {
    controller.abort(TalqynError.cancelled());
    return () => undefined;
  }
  const onAbort = (): void => controller.abort(TalqynError.cancelled());
  parent.addEventListener('abort', onAbort, { once: true });
  return () => parent.removeEventListener('abort', onAbort);
}

/** Rejects with `cancelled` when the signal has already aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw TalqynError.cancelled();
}
