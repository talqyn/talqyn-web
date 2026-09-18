// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TalqynUiStrings } from '../../src/consultant-core/index.js';
import { TalqynOverlay } from '../../src/ui/components/overlay.js';
import { TalqynChatHistoryScreen } from '../../src/ui/screens/chat-history-screen.js';
import { TalqynTheme } from '../../src/ui/theme.js';
import { StubTransport, TestFixtures, waitUntil } from '../support/stub-transport.js';

const strings = TalqynUiStrings.en;

function chats(entries: readonly (readonly [id: string, title: string | null])[]): string {
  return `[${entries
    .map(
      ([id, title]) =>
        `{"session_id":"${id}","title":${title === null ? 'null' : `"${title}"`},"message_count":2,"last_message_at":"2026-08-26T12:00:00Z"}`,
    )
    .join(',')}]`;
}

const screens: TalqynChatHistoryScreen[] = [];

afterEach(() => {
  for (const screen of screens.splice(0)) screen.dispose();
  document.body.innerHTML = '';
});

async function makeScreen(transport: StubTransport) {
  const talqyn = await TestFixtures.preparedClient(transport);
  const background = document.createElement('div');
  const layer = document.createElement('div');
  document.body.append(background, layer);
  const overlay = new TalqynOverlay(layer, background);
  const onSelect = vi.fn<(sessionId: string) => void>();
  const onDelete = vi.fn<(sessionId: string) => void>();
  const onClose = vi.fn<() => void>();
  const screen = new TalqynChatHistoryScreen({
    talqyn,
    theme: TalqynTheme.default,
    strings,
    overlay,
    onSelect,
    onDelete,
    onClose,
  });
  screens.push(screen);
  background.appendChild(screen.element);
  return { screen, layer, onSelect, onDelete, onClose };
}

function titles(screen: TalqynChatHistoryScreen): string[] {
  return [...screen.element.querySelectorAll('.tq-history-title')].map((element) => element.textContent ?? '');
}

function row(screen: TalqynChatHistoryScreen, sessionId: string): HTMLElement {
  const element = screen.element.querySelector<HTMLElement>(`.tq-history-row[data-session-id="${sessionId}"]`);
  if (!element) throw new Error(`no row for ${sessionId}`);
  return element;
}

function isShown(element: Element | null): boolean {
  let node = element;
  while (node) {
    if (node instanceof HTMLElement && node.hidden) return false;
    node = node.parentElement;
  }
  return element !== null;
}

describe('TalqynChatHistoryScreen', () => {
  it('shows a spinner while the first page loads, then the rows', async () => {
    const transport = new StubTransport();
    transport.enqueue(chats([['a', 'chat a'], ['b', '  ']]));
    const { screen } = await makeScreen(transport);

    expect(isShown(screen.element.querySelector('.tq-history-loading')), 'loading at once').toBe(true);
    expect(await waitUntil(() => titles(screen).length === 2)).toBe(true);
    expect(titles(screen), 'a blank title reads as an untitled conversation').toEqual(['chat a', strings.historyUntitled]);
    expect(isShown(screen.element.querySelector('.tq-history-loading'))).toBe(false);
    expect(transport.sent.at(-1)?.query).toBe('limit=20&offset=0');
    expect(screen.element.getAttribute('aria-label')).toBe(strings.historyTitle);
  });

  it('reopens a conversation when its row is tapped, and closes on the close button', async () => {
    const transport = new StubTransport();
    transport.enqueue(chats([['a', 'chat a'], ['b', 'chat b']]));
    const { screen, onSelect, onClose } = await makeScreen(transport);
    expect(await waitUntil(() => titles(screen).length === 2)).toBe(true);

    row(screen, 'b').querySelector<HTMLButtonElement>('.tq-history-open')!.click();
    expect(onSelect).toHaveBeenCalledWith('b');

    screen.element.querySelector<HTMLButtonElement>('.tq-screen-header-trailing .tq-icon-button')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('deletes a conversation after the shopper confirms', async () => {
    const transport = new StubTransport();
    transport.enqueue(chats([['a', 'chat a'], ['b', 'chat b']]));
    transport.enqueue('', { status: 204 });
    const { screen, layer, onDelete } = await makeScreen(transport);
    expect(await waitUntil(() => titles(screen).length === 2)).toBe(true);

    row(screen, 'a').querySelector<HTMLButtonElement>('.tq-history-delete')!.click();
    const dialog = layer.querySelector('.tq-dialog');
    expect(dialog?.textContent).toContain(strings.historyDeleteTitle);
    expect(dialog?.textContent).toContain(strings.historyDeleteConfirm);
    expect(onDelete).not.toHaveBeenCalled();

    layer.querySelector<HTMLButtonElement>('.tq-dialog-action[data-role="destructive"]')!.click();
    expect(onDelete).toHaveBeenCalledWith('a');
    expect(layer.querySelector('.tq-dialog'), 'the dialog closes').toBeNull();
    expect(await waitUntil(() => titles(screen).join('|') === 'chat b'), 'the row goes at once').toBe(true);
    expect(await waitUntil(() => transport.sent.at(-1)?.method === 'DELETE')).toBe(true);
    expect(transport.sent.at(-1)?.path).toBe('/v1/consultant/chats/a');
  });

  it('keeps a conversation the shopper decided not to delete', async () => {
    const transport = new StubTransport();
    transport.enqueue(chats([['a', 'chat a']]));
    const { screen, layer, onDelete } = await makeScreen(transport);
    expect(await waitUntil(() => titles(screen).length === 1)).toBe(true);

    row(screen, 'a').querySelector<HTMLButtonElement>('.tq-history-delete')!.click();
    layer.querySelector<HTMLButtonElement>('.tq-dialog-action[data-role="cancel"]')!.click();

    expect(onDelete).not.toHaveBeenCalled();
    expect(layer.querySelector('.tq-dialog')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titles(screen)).toEqual(['chat a']);
    expect(transport.sent.some((sent) => sent.method === 'DELETE')).toBe(false);
  });

  it('says the history is unavailable under a token that names no shopper, and retries on request', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"no shopper"}', { status: 403 });
    transport.enqueue(chats([['a', 'chat a']]));
    const { screen } = await makeScreen(transport);

    const text = screen.element.querySelector('.tq-history-placeholder-text');
    expect(await waitUntil(() => isShown(text) && text?.textContent === strings.historyUnavailable)).toBe(true);
    const retry = screen.element.querySelector<HTMLButtonElement>('.tq-history-placeholder .tq-text-button')!;
    expect(isShown(retry)).toBe(true);
    expect(retry.textContent).toBe(strings.retry);

    retry.click();
    expect(await waitUntil(() => titles(screen).join('|') === 'chat a')).toBe(true);
    expect(isShown(screen.element.querySelector('.tq-history-placeholder'))).toBe(false);
  });

  it('says loading failed for any other failure', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"error":"internal_error"}', { status: 500 });
    const { screen } = await makeScreen(transport);

    const text = screen.element.querySelector('.tq-history-placeholder-text');
    expect(await waitUntil(() => isShown(text) && text?.textContent === strings.historyError)).toBe(true);
    expect(isShown(screen.element.querySelector('.tq-history-placeholder .tq-text-button'))).toBe(true);
  });

  it('says there is nothing yet for an empty list, without a retry', async () => {
    const transport = new StubTransport();
    transport.enqueue('[]');
    const { screen } = await makeScreen(transport);

    const text = screen.element.querySelector('.tq-history-placeholder-text');
    expect(await waitUntil(() => isShown(text) && text?.textContent === strings.historyEmpty)).toBe(true);
    expect(isShown(screen.element.querySelector('.tq-history-placeholder .tq-text-button'))).toBe(false);
    expect(titles(screen)).toEqual([]);
  });
});
