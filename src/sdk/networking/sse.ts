import { concatBytes, utf8Decode } from '../internal/bytes.js';

/** One event parsed out of a `text/event-stream` response. */
export interface TalqynSseMessage {
  /** The event name, from the `event:` field. `"message"` when the stream omitted one. */
  readonly name: string;
  /** The raw JSON payload assembled from the event's `data:` fields. */
  readonly data: string;
}

/**
 * An incremental parser for `text/event-stream` bodies.
 *
 * State lives outside the stream on purpose: the parser can then be exercised line by line in a
 * test, with no network.
 *
 * Talqyn emits `event: <name>`, one or more `data: <json>` lines, and a blank line. Comment lines (a
 * leading `:`, used by proxies for keep-alive) and the `id` and `retry` fields are skipped.
 *
 * ```ts
 * const decoder = new TalqynSseDecoder();
 * for await (const line of lines) {
 *   const message = decoder.consume(line);
 *   if (message) handle(message);
 * }
 * const tail = decoder.finish();
 * if (tail) handle(tail);
 * ```
 */
export class TalqynSseDecoder {
  private static readonly defaultEventName = 'message';

  private name = TalqynSseDecoder.defaultEventName;
  private payload: string[] = [];

  /**
   * Feeds the parser one line of the response body, its terminator already stripped.
   *
   * @returns The event this line completed, or `undefined` while the event is still being accumulated.
   */
  consume(line: string): TalqynSseMessage | undefined {
    if (line.length === 0) return this.flush();
    if (line.startsWith(':')) return undefined;
    if (line.startsWith('event:')) {
      // Flush before renaming: `event:` always opens a new event here, so a blank line dropped by a
      // proxy must not merge two into one.
      const completed = this.flush();
      this.name = fieldValue(line, 'event:');
      return completed;
    }
    if (line.startsWith('data:')) {
      this.payload.push(fieldValue(line, 'data:'));
    }
    return undefined;
  }

  /** Closes the stream, emitting an event that never got its trailing blank line. */
  finish(): TalqynSseMessage | undefined {
    return this.flush();
  }

  private flush(): TalqynSseMessage | undefined {
    const name = this.name;
    const payload = this.payload;
    this.name = TalqynSseDecoder.defaultEventName;
    this.payload = [];
    if (payload.length === 0) return undefined;
    return { name, data: payload.join('\n') };
  }
}

/** A field value: the specification strips exactly **one** space after the colon, no more. */
function fieldValue(line: string, prefix: string): string {
  const value = line.slice(prefix.length);
  return value.startsWith(' ') ? value.slice(1) : value;
}

const CR = 0x0d;
const LF = 0x0a;

/**
 * Splits a byte stream into lines the way `text/event-stream` defines them.
 *
 * CR, LF, or CR LF end a line, and nothing else does. Splitting on every Unicode line break — U+2028,
 * U+2029, NEL — would tear a `data:` line carrying one inside a JSON string, and its event would be
 * dropped. Splitting on bytes is safe: no UTF-8 continuation byte equals CR or LF.
 *
 * Public so a custom {@link TalqynHttpTransport} splits its streamed body the same way;
 * {@link TalqynLineSplitter.lines} does it over a `ReadableStream` or any async iterable of chunks.
 */
export class TalqynLineSplitter {
  private pending: Uint8Array[] = [];
  private pendingLength = 0;
  /** A CR was just seen: a following LF belongs to the same terminator, even across chunks. */
  private pendingCR = false;

  /**
   * Splits a body into a {@link TalqynLineStream}.
   *
   * Leaving the iteration early cancels the reading of `source`. When the source fails, a last line
   * that had no terminator is not delivered: it is a torn line, not a line.
   */
  static async *lines(
    source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  ): AsyncGenerator<string, void, undefined> {
    const splitter = new TalqynLineSplitter();
    if (typeof (source as ReadableStream<Uint8Array>).getReader === 'function') {
      const reader = (source as ReadableStream<Uint8Array>).getReader();
      let isDone = false;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const line of splitter.push(chunk.value)) yield line;
        }
        isDone = true;
      } finally {
        if (!isDone) await reader.cancel().catch(() => undefined);
        try {
          reader.releaseLock();
        } catch {
          // A reader with a read still pending cannot be released; it is cancelled already.
        }
      }
    } else {
      for await (const chunk of source as AsyncIterable<Uint8Array>) {
        for (const line of splitter.push(chunk)) yield line;
      }
    }
    const tail = splitter.finish();
    if (tail !== undefined) yield tail;
  }

  /**
   * Feeds one byte.
   *
   * @returns The line this byte terminated, without its terminator, or `undefined` while the line is
   *   still being accumulated.
   */
  consume(byte: number): string | undefined {
    return this.push(Uint8Array.of(byte))[0];
  }

  /** Feeds a chunk of the body. @returns The lines the chunk completed, in order. */
  push(chunk: Uint8Array): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      const byte = chunk[index];
      if (byte === CR) {
        this.append(chunk, start, index);
        lines.push(this.take());
        this.pendingCR = true;
        start = index + 1;
      } else if (byte === LF) {
        if (this.pendingCR) {
          this.pendingCR = false;
        } else {
          this.append(chunk, start, index);
          lines.push(this.take());
        }
        start = index + 1;
      } else {
        this.pendingCR = false;
      }
    }
    this.append(chunk, start, chunk.length);
    return lines;
  }

  /** Ends the stream. @returns The last line when it had no terminator, or `undefined` when nothing was buffered. */
  finish(): string | undefined {
    this.pendingCR = false;
    return this.pendingLength === 0 ? undefined : this.take();
  }

  private append(chunk: Uint8Array, start: number, end: number): void {
    if (end <= start) return;
    // Copied: a source is free to reuse the buffer of a chunk once it has handed it over.
    this.pending.push(chunk.slice(start, end));
    this.pendingLength += end - start;
  }

  private take(): string {
    const line = this.pending.length === 1 ? utf8Decode(this.pending[0]!) : utf8Decode(concatBytes(this.pending));
    this.pending = [];
    this.pendingLength = 0;
    return line;
  }
}
