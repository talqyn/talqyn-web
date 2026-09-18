import { describe, expect, it } from 'vitest';
import { TalqynChatHistory, TalqynUiStrings } from '../../src/consultant-core/index.js';
import { StubTransport, TestFixtures, waitUntil } from '../support/stub-transport.js';

function chats(ids: string[]): string {
  return `[${ids
    .map((id) => `{"session_id":"${id}","title":"chat ${id}","message_count":2,"last_message_at":"2026-08-26T12:00:00Z"}`)
    .join(',')}]`;
}

async function settled(history: TalqynChatHistory): Promise<void> {
  await waitUntil(() => {
    const state = history.state;
    return state.type !== 'loading' && !(state.type === 'loaded' && state.isLoadingMore);
  });
}

function loadedIds(history: TalqynChatHistory): string[] {
  const state = history.state;
  if (state.type !== 'loaded') throw new Error(`expected a loaded list, got ${state.type}`);
  return state.chats.map((chat) => chat.sessionId);
}

describe('TalqynChatHistory', () => {
  it('loads pages until a short page', async () => {
    const transport = new StubTransport();
    transport.enqueue(chats(['a', 'b']));
    transport.enqueue(chats(['b', 'c']));
    transport.enqueue(chats(['d']));
    const history = new TalqynChatHistory(await TestFixtures.preparedClient(transport), { pageSize: 2 });

    history.load();
    expect(history.state).toEqual({ type: 'loading' });
    await settled(history);
    expect(loadedIds(history)).toEqual(['a', 'b']);
    expect(transport.sent.at(-1)?.query).toBe('limit=2&offset=0');

    const first = history.state.type === 'loaded' ? history.state.chats : [];
    history.loadMoreIfNeeded(first[1]!);
    await settled(history);
    expect(loadedIds(history), 'an overlap is not shown twice').toEqual(['a', 'b', 'c']);
    expect(transport.sent.at(-1)?.query).toBe('limit=2&offset=2');

    const second = history.state.type === 'loaded' ? history.state.chats : [];
    history.loadMoreIfNeeded(second[2]!);
    await settled(history);
    expect(loadedIds(history)).toEqual(['a', 'b', 'c', 'd']);

    const third = history.state.type === 'loaded' ? history.state.chats : [];
    history.loadMoreIfNeeded(third[3]!);
    await settled(history);
    expect(transport.sent, 'a short page ends the list: no request after it').toHaveLength(3);
  });

  it('shows the empty and failed states', async () => {
    const transport = new StubTransport();
    transport.enqueue('[]');
    transport.enqueue('{"detail":"no shopper"}', { status: 403 });
    const history = new TalqynChatHistory(await TestFixtures.preparedClient(transport));

    history.load();
    await settled(history);
    expect(history.state).toEqual({ type: 'empty' });

    history.load();
    await settled(history);
    const state = history.state;
    expect(state.type).toBe('failed');
    if (state.type === 'failed') expect(state.error.kind).toBe('forbidden');
  });

  it('removes a deleted row at once and reloads when the deletion fails', async () => {
    const transport = new StubTransport();
    transport.enqueue(chats(['a', 'b']));
    transport.enqueue('', { status: 204 });
    const history = new TalqynChatHistory(await TestFixtures.preparedClient(transport), { pageSize: 20 });
    history.load();
    await settled(history);

    history.delete('a');
    expect(loadedIds(history), 'gone before the server answers').toEqual(['b']);
    await waitUntil(() => transport.sent.at(-1)?.method === 'DELETE');
    expect(transport.sent.at(-1)?.path).toBe('/v1/consultant/chats/a');

    transport.enqueue('{"error":"internal_error"}', { status: 500 });
    transport.enqueue(chats(['b']));
    history.delete('b');
    await waitUntil(() => transport.sent.filter((sent) => sent.path.endsWith('/consultant/chats')).length === 2);
    await settled(history);
    expect(loadedIds(history), 'a failed deletion brings the row back').toEqual(['b']);
  });

  it('writes the subtitle the way the copy locale writes dates', () => {
    const now = new Date(2026, 8, 10, 15, 30);
    const subtitle = (date: Date | undefined): string => TalqynChatHistory.subtitle(date, TalqynUiStrings.ru, now);
    expect(subtitle(undefined)).toBe('');
    expect(subtitle(new Date(2026, 8, 10, 13, 30))).toBe('13:30');
    expect(subtitle(new Date(2026, 8, 9, 15, 30))).toBe('Вчера');
    expect(subtitle(new Date(2026, 7, 1, 15, 30))).toBe('1 авг.');
    expect(subtitle(new Date(2025, 8, 10, 15, 30)), 'the year is written the way the locale writes it').toMatch(
      /^10 сент\. 2025\s?г\.$/u,
    );
  });
});
