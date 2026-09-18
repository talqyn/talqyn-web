import { describe, expect, it } from 'vitest';
import { TalqynLineSplitter } from '../../src/sdk/index.js';

const encoder = new TextEncoder();

/**
 * The one piece of SSE parsing written by hand: splitting on every Unicode line break would tear a
 * `data:` line carrying U+2028, U+2029, or NEL, which are legal inside a JSON string.
 */
function split(text: string): string[] {
  const splitter = new TalqynLineSplitter();
  const lines: string[] = [];
  for (const byte of encoder.encode(text)) {
    const line = splitter.consume(byte);
    if (line !== undefined) lines.push(line);
  }
  const tail = splitter.finish();
  if (tail !== undefined) lines.push(tail);
  return lines;
}

function splitChunks(chunks: readonly string[]): string[] {
  const splitter = new TalqynLineSplitter();
  const lines = chunks.flatMap((chunk) => splitter.push(encoder.encode(chunk)));
  const tail = splitter.finish();
  if (tail !== undefined) lines.push(tail);
  return lines;
}

async function* chunksOf(chunks: readonly string[]): AsyncGenerator<Uint8Array, void, undefined> {
  for (const chunk of chunks) yield encoder.encode(chunk);
}

describe('TalqynLineSplitter', () => {
  it('splits on every terminator the specification allows', () => {
    expect(split('a\nb\n')).toEqual(['a', 'b']);
    expect(split('a\rb\r')).toEqual(['a', 'b']);
    expect(split('a\r\nb\r\n')).toEqual(['a', 'b']);
    // CR LF is one terminator; the blank line survives.
    expect(split('a\r\n\r\nb\n')).toEqual(['a', '', 'b']);
    // LF CR is two terminators.
    expect(split('a\n\rb')).toEqual(['a', '', 'b']);
  });

  it('emits a tail without a terminator on finish', () => {
    expect(split('event: done\ndata: {}')).toEqual(['event: done', 'data: {}']);
    expect(split('')).toEqual([]);
    expect(split('\n')).toEqual(['']);
  });

  it('keeps Unicode line separators inside the line', () => {
    const delta = 'data: {"text":"line more andend"}';
    expect(split(`${delta}\n\n`)).toEqual([delta, '']);
  });

  it('splits chunks the way it splits bytes', () => {
    const text = 'event: status\r\ndata: {"stage":"thinking"}\r\n\r\nevent: delta\ndata: {"text":"world"}\n\n';
    expect(splitChunks([text])).toEqual(split(text));
    // A multi-byte character torn across two chunks is put back together.
    const torn = encoder.encode('data: world\n');
    const splitter = new TalqynLineSplitter();
    expect(splitter.push(torn.slice(0, 8))).toEqual([]);
    expect(splitter.push(torn.slice(8))).toEqual(['data: world']);
  });

  it('reads a terminator split across chunks as one terminator', async () => {
    // The CR ends one chunk and the LF opens the next.
    const lines: string[] = [];
    for await (const line of TalqynLineSplitter.lines(chunksOf(['event: delta\r', '\ndata: {}\r\n\r\n']))) lines.push(line);
    expect(lines).toEqual(['event: delta', 'data: {}', '']);
  });

  it('reads a ReadableStream', async () => {
    const chunks = ['event: delta\r', '\ndata: {}\r\n\r\n', 'event: done'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of TalqynLineSplitter.lines(stream)) lines.push(line);
    expect(lines).toEqual(['event: delta', 'data: {}', '', 'event: done']);
  });

  it('cancels a ReadableStream it stops reading', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('data: {}\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const line of TalqynLineSplitter.lines(stream)) {
      expect(line).toBe('data: {}');
      break;
    }
    expect(cancelled).toBe(true);
  });

  it('reports the underlying failure and drops the torn line', async () => {
    class Dropped extends Error {}
    async function* failing(): AsyncGenerator<Uint8Array, void, undefined> {
      yield encoder.encode('data: {');
      throw new Dropped();
    }
    const lines: string[] = [];
    await expect(
      (async () => {
        for await (const line of TalqynLineSplitter.lines(failing())) lines.push(line);
      })(),
    ).rejects.toBeInstanceOf(Dropped);
    // An unterminated line is not delivered on failure.
    expect(lines).toEqual([]);
  });
});
