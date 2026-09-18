import { describe, expect, it } from 'vitest';
import {
  TalqynConversation,
  TalqynPriceFormatter,
  TalqynUiStrings,
  type TalqynAssistantTurn,
} from '../../src/consultant-core/index.js';
import { TalqynTranscriptRowBuilder, type TalqynTurnRow } from '../../src/ui/transcript/rows.js';
import { SlowStreamTransport, sseEvent, StubTransport, TestFixtures, waitUntil } from '../support/stub-transport.js';

/** A turn that asks instead of answering, up to its `done`. */
const asking = [
  ...sseEvent('status', '{"stage":"thinking"}'),
  ...sseEvent('clarify', '{"message":"clarify","questions":[{"id":"budget","label":"Budget?","multi":false,"options":["under 300k"]}]}'),
];

function lastAssistant(conversation: TalqynConversation): TalqynAssistantTurn {
  const turn = conversation.state.turns.at(-1);
  if (turn?.type !== 'assistant') throw new Error('the last turn is not the consultant’s');
  return turn;
}

function row(
  turn: TalqynAssistantTurn,
  conversation: TalqynConversation,
  dismissed: ReadonlySet<string> = new Set(),
): TalqynTurnRow {
  return new TalqynTranscriptRowBuilder(TalqynUiStrings.en, TalqynPriceFormatter.tenge).turnRow(turn, conversation.state, dismissed);
}

async function settle(conversation: TalqynConversation): Promise<void> {
  expect(await waitUntil(() => !conversation.state.isStreaming), 'the turn never settled').toBe(true);
}

describe('transcript rows: clarify', () => {
  it('shows no card while the turn that asks still streams: the question comes up once the turn is done', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream(asking, { keepsOpen: true });
    const conversation = new TalqynConversation(TestFixtures.client({ transport }));

    conversation.send('recommend something');
    expect(await waitUntil(() => lastAssistant(conversation).clarify !== undefined), 'the question never arrived').toBe(true);
    expect(conversation.state.isStreaming).toBe(true);
    expect(row(lastAssistant(conversation), conversation).clarify).toBeUndefined();

    conversation.stop();
    await settle(conversation);
  });

  it('leaves a settled question to the sheet until the sheet is dismissed', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([...asking, ...sseEvent('done', '{"session_id":"sess-1"}')]);
    const conversation = new TalqynConversation(await TestFixtures.preparedClient(transport));

    conversation.send('recommend something');
    await settle(conversation);

    const turn = lastAssistant(conversation);
    expect(row(turn, conversation).clarify, 'the sheet asks first').toBeUndefined();
    const card = row(turn, conversation, new Set([turn.id])).clarify;
    expect(card?.type, 'a dismissed sheet must leave its question in the transcript').toBe('pending');
    expect(card?.type === 'pending' && card.isInteractive).toBe(true);
  });

  it('keeps an earlier unanswered question greyed while a newer turn streams', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream([...asking, ...sseEvent('done', '{"session_id":"sess-1"}')]);
    const conversation = new TalqynConversation(TestFixtures.client({ transport }));
    conversation.send('recommend something');
    await settle(conversation);
    const earlier = lastAssistant(conversation);

    transport.enqueueStream(sseEvent('status', '{"stage":"thinking"}'), { keepsOpen: true });
    conversation.send('actually — a laptop');
    expect(conversation.state.isStreaming).toBe(true);
    const card = row(earlier, conversation).clarify;
    expect(card?.type, 'the earlier question left the transcript').toBe('pending');
    expect(card?.type === 'pending' && card.isInteractive).toBe(false);

    conversation.stop();
    await settle(conversation);
  });
});

describe('transcript rows: products', () => {
  it('shows each product of a group once, and counts what it shows', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([
      ...sseEvent(
        'products',
        '{"items":[{"talqyn_id":1,"title":"Sofa"},{"talqyn_id":2,"title":"Table"}],"groups":[{"role":"sofa","items":[{"talqyn_id":1,"title":"Sofa"},{"talqyn_id":1,"title":"Sofa"}]},{"role":"table","items":[{"talqyn_id":2,"title":"Table"},{"talqyn_id":1,"title":"Sofa"},{"talqyn_id":2,"title":"Table"}]}]}',
      ),
      ...sseEvent('done', '{"session_id":"sess-1"}'),
    ]);
    const conversation = new TalqynConversation(await TestFixtures.preparedClient(transport));

    conversation.send('a sofa and a table to match');
    await settle(conversation);

    const sections = row(lastAssistant(conversation), conversation).productSections;
    expect(sections.map((section) => section.products.map((product) => product.talqynId))).toEqual([[1], [2, 1]]);
    expect(sections.map((section) => section.title)).toEqual(['Sofa · 1', 'Table · 2']);
  });

  it('leaves the products cited in the text out of the carousel, and holds the carousel back while the text streams', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream(
      [
        ...sseEvent('products', '{"items":[{"talqyn_id":1,"title":"Acer"},{"talqyn_id":2,"title":"Asus"}],"search_id":"srch-1"}'),
        ...sseEvent('delta', '{"text":"Take [p:1]."}'),
      ],
      { keepsOpen: true },
    );
    const conversation = new TalqynConversation(TestFixtures.client({ transport }));

    conversation.send('laptop');
    expect(await waitUntil(() => lastAssistant(conversation).text.length > 0)).toBe(true);
    const streaming = row(lastAssistant(conversation), conversation);
    expect(streaming.productSections, 'the carousel waits for the text to settle').toEqual([]);
    expect(streaming.blocks.some((block) => block.type === 'products'), 'a cited card renders as the text streams').toBe(true);

    conversation.stop();
    await settle(conversation);
    const settled = row(lastAssistant(conversation), conversation);
    expect(settled.productSections.map((section) => section.products.map((product) => product.talqynId))).toEqual([[2]]);
    expect(settled.productSections[0]?.title).toBe(TalqynUiStrings.en.productsHeader);
  });
});

describe('fallback notice', () => {
  /** A turn the consultant gave up on, with or without the products it found before giving up. */
  function fallbackLines(withProducts: boolean, reason: string): string[] {
    return [
      ...sseEvent('status', '{"stage":"thinking"}'),
      ...(withProducts ? sseEvent('products', '{"items":[{"talqyn_id":1,"title":"Acer"}],"search_id":"srch-1"}') : []),
      ...sseEvent('fallback', `{"reason":"${reason}"}`),
      ...sseEvent('follow_ups', '{"items":["anything cheaper?","compare them"]}'),
      ...sseEvent('done', '{"session_id":"sess-1"}'),
    ];
  }

  async function fallbackRow(withProducts: boolean, reason = 'budget_exceeded') {
    const transport = new StubTransport();
    transport.enqueueStream(fallbackLines(withProducts, reason));
    const conversation = new TalqynConversation(await TestFixtures.preparedClient(transport));
    conversation.send('what to give as a housewarming gift?');
    await settle(conversation);
    const turn = lastAssistant(conversation);
    expect(turn.fallbackReason).toBe(reason);
    return { row: row(turn, conversation), conversation };
  }

  it('does not promise products a fallback has none of', async () => {
    expect((await fallbackRow(false)).row.notice?.text).toBe('The consultant is unavailable right now');
  });

  it('points at the products a fallback did find', async () => {
    expect((await fallbackRow(true)).row.notice?.text).toBe('The consultant is unavailable right now, but here is what matches');
  });

  it('heads the products of a fallback as all the turn has, not as an extra', async () => {
    expect((await fallbackRow(true)).row.productSections.map((section) => section.title)).toEqual(['What turned up for your request']);
  });

  it('offers no follow-ups under a fallback: whatever stopped the turn would stop the next question too', async () => {
    const { conversation } = await fallbackRow(true);
    expect(lastAssistant(conversation).followUps).toEqual(['anything cheaper?', 'compare them']);
    expect(conversation.suggestedQuestions(['Example'])).toEqual([]);
  });

  it('offers a retry only where one could work', async () => {
    const spent = (await fallbackRow(true, 'user_budget_exceeded')).row.notice;
    expect(spent?.showsRetry).toBe(false);
    expect(spent?.text).toBe('You have used up your questions for the next few hours, but here is what matches');
    expect((await fallbackRow(true, 'timeout')).row.notice?.showsRetry).toBe(true);
  });

  it('lets a fallback be rated, with its own reasons, but not copied', async () => {
    const toolbar = (await fallbackRow(true)).row.toolbar;
    expect(toolbar).toBeDefined();
    expect(toolbar?.copyText).toBeUndefined();
    expect(toolbar?.offeredReasons[0]).toBe('no_answer');
  });

  it('keeps as many follow-ups as the conversation is told to', () => {
    const sent = ['first', 'second', 'third', 'fourth'];
    expect(TalqynConversation.sanitizedFollowUps(sent), 'three by default').toHaveLength(3);
    expect(TalqynConversation.sanitizedFollowUps(sent, 1)).toEqual(['first']);
    expect(TalqynConversation.sanitizedFollowUps(sent, 0)).toEqual([]);
    expect(TalqynConversation.sanitizedFollowUps(sent, 10), 'no padding past what came').toHaveLength(4);
  });
});
