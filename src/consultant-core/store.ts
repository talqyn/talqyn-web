/** Called with the state after it changed. */
export type TalqynListener<T> = (state: T) => void;

/**
 * An observable value: the state a screen renders, and the way to hear that it changed.
 *
 * Listeners are called once per burst of changes — after the current task's synchronous work and
 * before the browser renders — with the latest state, so one event from the stream that touches the
 * state three times costs one render. {@link get} is always current. The contract matches React's
 * `useSyncExternalStore`: `useSyncExternalStore(conversation.subscribe, () => conversation.state)`.
 */
export class TalqynStore<T> {
  private value: T;
  private readonly listeners = new Set<TalqynListener<T>>();
  private isNotificationScheduled = false;

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.scheduleNotification();
  }

  update(change: (current: T) => T): void {
    this.set(change(this.value));
  }

  /** @returns What stops the listening. */
  subscribe(listener: TalqynListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleNotification(): void {
    if (this.isNotificationScheduled) return;
    this.isNotificationScheduled = true;
    queueMicrotask(() => {
      this.isNotificationScheduled = false;
      const state = this.value;
      for (const listener of [...this.listeners]) {
        try {
          listener(state);
        } catch (error) {
          // One broken listener must not starve the others; the error still reaches the console.
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    });
  }
}
