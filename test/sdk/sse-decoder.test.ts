import { describe, expect, it } from 'vitest';
import { TalqynSseDecoder, type TalqynSseMessage } from '../../src/sdk/index.js';

function messages(lines: readonly string[]): TalqynSseMessage[] {
  const decoder = new TalqynSseDecoder();
  const result: TalqynSseMessage[] = [];
  for (const line of lines) {
    const message = decoder.consume(line);
    if (message) result.push(message);
  }
  const tail = decoder.finish();
  if (tail) result.push(tail);
  return result;
}

describe('TalqynSseDecoder', () => {
  it('dispatches an event and its data on a blank line', () => {
    const parsed = messages(['event: delta', 'data: {"text":"hi"}', '']);
    expect(parsed).toEqual([{ name: 'delta', data: '{"text":"hi"}' }]);
  });

  it('joins multiline data with a newline', () => {
    const parsed = messages(['event: delta', 'data: {', 'data: "text": "a"}', '']);
    expect(parsed[0]?.data).toBe('{\n"text": "a"}');
  });

  it('ignores comments and unknown fields', () => {
    const parsed = messages([': keep-alive', 'id: 42', 'retry: 1000', 'event: done', 'data: {}', '']);
    expect(parsed.map((message) => message.name)).toEqual(['done']);
  });

  /** A proxy may swallow the blank line between events; they must not merge. */
  it('flushes a pending event on the next event line', () => {
    const parsed = messages(['event: status', 'data: {"stage":"thinking"}', 'event: done', 'data: {}', '']);
    expect(parsed.map((message) => message.name)).toEqual(['status', 'done']);
  });

  it('emits an event without a trailing blank line on finish', () => {
    const parsed = messages(['event: done', 'data: {"session_id":"abc"}']);
    expect(parsed.map((message) => message.name)).toEqual(['done']);
  });

  it('strips only one leading space', () => {
    const parsed = messages(['event: delta', 'data:  {"text":"x"}', '']);
    expect(parsed[0]?.data).toBe(' {"text":"x"}');
  });

  it('names data without an event "message"', () => {
    expect(messages(['data: {}', ''])[0]?.name).toBe('message');
  });

  it('emits nothing for an event without data', () => {
    expect(messages(['event: status', '', ''])).toEqual([]);
  });
});
