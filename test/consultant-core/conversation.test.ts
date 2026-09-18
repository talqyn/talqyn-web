import { describe, expect, it } from 'vitest';
import {
  TalqynAssistantTurn,
  TalqynClarifyDraft,
  TalqynConversation,
} from '../../src/consultant-core/index.js';
import { TalqynDeviceIdentity } from '../../src/sdk/index.js';
import {
  SlowStreamTransport,
  StubTransport,
  TestFixtures,
  sseEvent as event,
  waitUntil,
} from '../support/stub-transport.js';

const turnId = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const shopper = '6f1c2b9a-3e47-4b8f-9a10-2c5d8e7f4a01';

function fullTurn(init: { sessionId?: string; turnId?: string } = {}): string[] {
  const turn = init.turnId === undefined ? '' : `,"turn_id":"${init.turnId}"`;
  return [
    ...event('status', '{"stage":"thinking"}'),
    ...event('status', '{"stage":"searching"}'),
    ...event('products', '{"items":[{"talqyn_id":1,"title":"Acer"},{"talqyn_id":2,"title":"Lenovo"}],"search_id":"srch-1"}'),
    ...event('delta', '{"text":"Take "}'),
    ...event('delta', '{"text":"[p:1]."}'),
    ...event('action', '{"type":"apply_filters","filters":{"price_max":300000}}'),
    ...event('follow_ups', '{"items":[" Quieter? ","quieter?","","Cheaper","More","Extra"]}'),
    ...event('done', `{"session_id":"${init.sessionId ?? 'sess-1'}"${turn},"ttft_ms":300,"total_ms":900}`),
  ];
}

async function makeConversation(transport: StubTransport): Promise<TalqynConversation> {
  return new TalqynConversation(await TestFixtures.preparedClient(transport));
}

async function settle(conversation: TalqynConversation): Promise<void> {
  expect(await waitUntil(() => !conversation.state.isStreaming), 'the turn never settled').toBe(true);
}

function lastAssistant(conversation: TalqynConversation): TalqynAssistantTurn {
  const last = conversation.state.turns.at(-1);
  if (last?.type !== 'assistant') throw new Error('expected an assistant turn last');
  return last;
}

function feedbackRequests(transport: StubTransport) {
  return transport.sent.filter((sent) => sent.path.includes('/consultant/feedback'));
}

describe('TalqynConversation', () => {
  it('streams a turn into an assistant turn', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn());
    const conversation = await makeConversation(transport);

    conversation.setDraft('  need a laptop  ');
    conversation.send(conversation.state.draft);
    expect(conversation.state.isStreaming).toBe(true);
    expect(conversation.state.draft, 'the composer empties on send').toBe('');
    await settle(conversation);

    expect(conversation.state.turns).toHaveLength(2);
    expect(conversation.state.turns[0], 'trimmed').toMatchObject({ type: 'user', text: 'need a laptop' });
    const turn = lastAssistant(conversation);
    expect(turn.question).toBe('need a laptop');
    expect(turn.text).toBe('Take [p:1].');
    expect(turn.products.map((product) => product.talqynId)).toEqual([1, 2]);
    expect(turn.searchId).toBe('srch-1');
    expect(turn.stage, 'settled').toBeUndefined();
    expect(turn.actions).toHaveLength(1);
    expect(turn.followUps, 'trimmed, deduplicated, capped at three').toEqual(['Quieter?', 'Cheaper', 'More']);
    expect(turn.timeToFirstTokenMs).toBe(300);
    expect(conversation.state.sessionId).toBe('sess-1');
    expect([...conversation.state.productsById.keys()].sort()).toEqual([1, 2]);
    expect(TalqynAssistantTurn.isAnswer(turn)).toBe(true);
    expect(transport.sent.at(-1)?.bodyJson['question']).toBe('need a laptop');
  });

  it('carries the session into the second turn', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn({ sessionId: 'sess-1' }));
    transport.enqueueStream(fullTurn({ sessionId: 'sess-1' }));
    const conversation = await makeConversation(transport);

    conversation.send('first');
    await settle(conversation);
    conversation.send('second');
    await settle(conversation);

    expect(transport.sent.at(-1)?.bodyJson['session_id']).toBe('sess-1');
    expect(conversation.state.turns).toHaveLength(4);
  });

  it('keeps the objects of turns that did not change, so a screen redraws only what did', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn());
    transport.enqueueStream(fullTurn());
    const conversation = await makeConversation(transport);

    conversation.send('first');
    await settle(conversation);
    const first = conversation.state.turns[1];
    conversation.send('second');
    await settle(conversation);
    expect(conversation.state.turns[1]).toBe(first);
  });

  it('ignores a send while streaming or empty', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream(fullTurn());
    const conversation = new TalqynConversation(TestFixtures.client({ transport }));

    conversation.send('   ');
    expect(conversation.state.turns).toHaveLength(0);
    conversation.send('question');
    conversation.send('another question');
    expect(conversation.state.turns, 'a second send during a stream is dropped').toHaveLength(2);
    await settle(conversation);
  });

  it('marks a stopped turn stopped and keeps what arrived', async () => {
    const transport = new SlowStreamTransport();
    transport.responses.enqueueDeviceToken();
    transport.enqueueStream(fullTurn());
    const conversation = new TalqynConversation(TestFixtures.client({ transport }));

    conversation.send('question');
    // Let the products through, then stop before the text.
    await waitUntil(() => lastAssistant(conversation).products.length > 0);
    conversation.stop();
    await settle(conversation);

    const turn = lastAssistant(conversation);
    expect(turn.wasStopped).toBe(true);
    expect(TalqynAssistantTurn.didFail(turn)).toBe(true);
    expect(turn.products.length, 'what arrived stays').toBeGreaterThan(0);
    expect(turn.stage).toBeUndefined();
    expect(transport.wasTerminated, 'stopping cancels the request').toBe(true);
  });

  it('records a server error event and a transport failure', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([
      ...event('status', '{"stage":"searching"}'),
      ...event('error', '{"code":"retrieval_failed"}'),
      ...event('done', '{"session_id":"s"}'),
    ]);
    transport.enqueueStream(['{"detail":"Rate limit exceeded"}'], { status: 429 });
    const conversation = await makeConversation(transport);

    conversation.send('one');
    await settle(conversation);
    expect(lastAssistant(conversation).errorCode).toBe('retrieval_failed');

    conversation.send('two');
    await settle(conversation);
    const failed = lastAssistant(conversation);
    expect(failed.failure?.kind, 'the transport failure lands on the turn').toBe('rateLimited');
    expect(TalqynAssistantTurn.didFail(failed)).toBe(true);
    expect(TalqynAssistantTurn.isAnswer(failed)).toBe(false);
  });

  it('replaces a retried turn without a new bubble', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(['{"detail":"boom"}'], { status: 500 });
    transport.enqueueStream(fullTurn());
    const conversation = await makeConversation(transport);

    conversation.send('question');
    await settle(conversation);
    expect(lastAssistant(conversation).failure).toBeDefined();
    const failedId = lastAssistant(conversation).id;

    conversation.retry(failedId);
    await settle(conversation);

    expect(conversation.state.turns, 'the failed turn is replaced, not appended').toHaveLength(2);
    expect(lastAssistant(conversation).id).not.toBe(failedId);
    expect(lastAssistant(conversation).question).toBe('question');
    expect(lastAssistant(conversation).failure).toBeUndefined();
    expect(transport.sent.at(-1)?.bodyJson['question']).toBe('question');
  });

  it('records a clarify answer and sends it as the next question', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([
      ...event('status', '{"stage":"thinking"}'),
      ...event(
        'clarify',
        '{"message":"clarify","questions":[{"id":"budget","label":"Budget?","multi":false,"options":["under 300k"]}]}',
      ),
      ...event('done', '{"session_id":"sess-1"}'),
    ]);
    transport.enqueueStream(fullTurn());
    const conversation = await makeConversation(transport);

    conversation.send('recommend something');
    await settle(conversation);
    const asking = lastAssistant(conversation);
    expect(asking.clarify).toBeDefined();
    expect(conversation.isClarifyInteractive(asking)).toBe(true);
    expect(conversation.suggestedQuestions(['example']), 'no prompts under a question').toEqual([]);

    const questions = asking.clarify!.questions;
    const draft = TalqynClarifyDraft.toggle(TalqynClarifyDraft.empty, 'under 300k', questions[0]!);
    conversation.submitClarify(asking.id, TalqynClarifyDraft.answer(draft, questions));
    await settle(conversation);

    expect(conversation.state.turns, 'no user bubble for a clarify answer').toHaveLength(3);
    const answered = conversation.state.turns[1];
    expect(answered?.type === 'assistant' ? answered.clarifyAnswer : undefined).toBe('Budget: under 300k.');
    if (answered?.type === 'assistant') {
      expect(conversation.isClarifyInteractive(answered), 'not the latest turn any more').toBe(false);
    }
    expect(transport.sent.at(-1)?.bodyJson['question']).toBe('Budget: under 300k.');
    expect(transport.sent.at(-1)?.bodyJson['session_id']).toBe('sess-1');
  });

  it('suggests questions', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([...event('delta', '{"text":"ok"}'), ...event('done', '{"session_id":"s"}')]);
    transport.enqueueStream(fullTurn());
    const conversation = await makeConversation(transport);
    const examples = ['Pick a smartphone', 'Which fridge?', 'A laptop under 300k'];

    expect(conversation.suggestedQuestions(examples), 'nothing before the first answer').toEqual([]);
    conversation.send('pick a smartphone');
    await settle(conversation);
    expect(
      conversation.suggestedQuestions(examples),
      'after the first answer: the examples not yet asked, case-insensitively',
    ).toEqual(['Which fridge?', 'A laptop under 300k']);

    conversation.send('more');
    expect(conversation.suggestedQuestions(examples), 'nothing while streaming').toEqual([]);
    await settle(conversation);
    expect(conversation.suggestedQuestions(examples), "the turn's follow-ups win").toEqual(['Quieter?', 'Cheaper', 'More']);
  });

  it('keeps a rating on the turn and takes it back with undefined', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn());
    const conversation = await makeConversation(transport);
    conversation.send('need a laptop');
    await settle(conversation);
    const id = lastAssistant(conversation).id;
    expect(lastAssistant(conversation).rating).toBeUndefined();
    const requestsBefore = transport.sent.length;

    conversation.rate(id, 'helpful');
    expect(lastAssistant(conversation).rating).toBe('helpful');
    conversation.rate(id, 'not_helpful');
    expect(lastAssistant(conversation).rating).toBe('not_helpful');
    conversation.rate(id, undefined);
    expect(lastAssistant(conversation).rating).toBeUndefined();

    conversation.rate('unknown', 'helpful');
    expect(lastAssistant(conversation).rating, 'an unknown turn changes nothing').toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(transport.sent.length, 'a turn from a server without turn ids is rated on the device only').toBe(requestsBefore);
  });

  it('saves a rating with Talqyn', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn({ turnId }));
    transport.enqueue('', { status: 204 });
    transport.enqueue('', { status: 204 });
    transport.enqueue('', { status: 204 });
    const conversation = await makeConversation(transport);
    conversation.send('need a laptop');
    await settle(conversation);
    const turn = lastAssistant(conversation);
    expect(turn.talqynTurnId).toBe(turnId);
    expect(turn.sessionId).toBe('sess-1');
    expect(TalqynAssistantTurn.isRatedRemotely(turn)).toBe(true);

    conversation.rate(turn.id, 'not_helpful');
    expect(await waitUntil(() => feedbackRequests(transport).length === 1), 'the dislike was never sent').toBe(true);
    conversation.rate(turn.id, 'not_helpful', ['not_relevant', 'not_relevant']);
    expect(await waitUntil(() => feedbackRequests(transport).length === 2), 'the reason was never sent').toBe(true);
    expect(lastAssistant(conversation).feedbackReasons, 'a reason counts once').toEqual(['not_relevant']);
    conversation.rate(turn.id, undefined);
    expect(await waitUntil(() => feedbackRequests(transport).length === 3), 'the withdrawal was never sent').toBe(true);

    const sent = feedbackRequests(transport);
    expect(sent[0]?.bodyJson['verdict']).toBe('down');
    expect(sent[0]?.bodyJson['turn_id']).toBe(turnId);
    expect(sent[0]?.bodyJson['session_id']).toBe('sess-1');
    expect(sent[0]?.bodyJson['reasons']).toBeUndefined();
    expect(sent[1]?.bodyJson['reasons']).toEqual(['not_relevant']);
    expect(sent[2]?.method).toBe('DELETE');
    expect(lastAssistant(conversation).rating).toBeUndefined();
    expect(conversation.state.feedbackFailure).toBeUndefined();
  });

  it('sends nothing for taps that end where they started', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn({ turnId }));
    const conversation = await makeConversation(transport);
    conversation.send('need a laptop');
    await settle(conversation);
    const id = lastAssistant(conversation).id;

    conversation.rate(id, 'helpful');
    conversation.rate(id, 'not_helpful');
    conversation.rate(id, undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(feedbackRequests(transport)).toHaveLength(0);
  });

  it('puts back a rating Talqyn refuses', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn({ turnId }));
    transport.enqueue('{"error":"internal_error"}', { status: 500 });
    const conversation = await makeConversation(transport);
    conversation.send('need a laptop');
    await settle(conversation);
    const id = lastAssistant(conversation).id;

    conversation.rate(id, 'helpful');
    expect(lastAssistant(conversation).rating, 'shown at once').toBe('helpful');
    expect(await waitUntil(() => conversation.state.feedbackFailure !== undefined), 'the refusal never came back').toBe(true);
    expect(lastAssistant(conversation).rating).toBeUndefined();
    expect(conversation.state.feedbackFailure?.statusCode).toBe(500);
  });

  it('treats withdrawing a rating that is already gone as done', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn({ turnId }));
    transport.enqueue('', { status: 204 });
    transport.enqueue('{"detail":"feedback not found"}', { status: 404 });
    const conversation = await makeConversation(transport);
    conversation.send('need a laptop');
    await settle(conversation);
    const id = lastAssistant(conversation).id;

    conversation.rate(id, 'helpful');
    expect(await waitUntil(() => feedbackRequests(transport).length === 1)).toBe(true);
    conversation.rate(id, undefined);
    expect(await waitUntil(() => feedbackRequests(transport).length === 2)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(lastAssistant(conversation).rating).toBeUndefined();
    expect(conversation.state.feedbackFailure).toBeUndefined();
  });

  it('holds a restored rating as the one Talqyn has', async () => {
    const transport = new StubTransport();
    transport.enqueue(`{"session_id":"s1","messages":[
      {"role":"user","text":"laptop","talqyn_ids":[],"turn_id":"${turnId}","feedback":"down"},
      {"role":"assistant","text":"here","talqyn_ids":[],"turn_id":"${turnId}","feedback":"down"}],
     "products":[]}`);
    transport.enqueue('', { status: 204 });
    const conversation = await makeConversation(transport);
    conversation.restore('s1');
    expect(await waitUntil(() => !conversation.state.isRestoring), 'the chat never opened').toBe(true);

    const turn = lastAssistant(conversation);
    expect(turn.rating).toBe('not_helpful');
    expect(turn.talqynTurnId).toBe(turnId);
    expect(turn.sessionId).toBe('s1');

    conversation.rate(turn.id, undefined);
    expect(await waitUntil(() => feedbackRequests(transport).length === 1), 'the withdrawal was never sent').toBe(true);
    expect(feedbackRequests(transport)[0]?.method).toBe('DELETE');
  });

  it('reports a product tap with the search id and the position', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn());
    transport.enqueue('', { status: 204 });
    const conversation = await makeConversation(transport);

    conversation.send('question');
    await settle(conversation);
    const turn = lastAssistant(conversation);
    conversation.trackProductTap(turn.products[1]!, turn);

    expect(await waitUntil(() => transport.sent.some((sent) => sent.path.endsWith('/events/product-click')))).toBe(true);
    const click = transport.sent.find((sent) => sent.path.endsWith('/events/product-click'))!;
    expect(click.bodyJson['search_id']).toBe('srch-1');
    expect(click.bodyJson['talqyn_id']).toBe(2);
    expect(click.bodyJson['position']).toBe(1);
    expect(click.bodyJson['source']).toBe('cip');
    expect(click.request.keepalive, 'a click outlives the page it navigates away from').toBe(true);
  });

  it('resets, and discards the open chat when it was deleted', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn({ sessionId: 'sess-1' }));
    const conversation = await makeConversation(transport);

    conversation.send('question');
    await settle(conversation);
    conversation.discardIfOpen('other');
    expect(conversation.state.turns, "another chat's deletion changes nothing").toHaveLength(2);

    conversation.discardIfOpen('sess-1');
    expect(conversation.state.turns).toHaveLength(0);
    expect(conversation.state.sessionId).toBeUndefined();
    expect(conversation.state.productsById.size).toBe(0);
  });

  it('restores a transcript', async () => {
    const transport = new StubTransport();
    transport.enqueue(`{"session_id":"s1","messages":[
      {"role":"user","text":"iphone","talqyn_ids":[],"route":"redirect"},
      {"role":"assistant","text":"iphone 15","talqyn_ids":[]},
      {"role":"user","text":"laptop","talqyn_ids":[]},
      {"role":"assistant","text":"here [p:1]","talqyn_ids":[1,9]},
      {"role":"assistant","text":"and more","talqyn_ids":[]}],
     "products":[{"talqyn_id":1,"title":"Acer"}]}`);
    const conversation = await makeConversation(transport);

    conversation.restore('s1');
    expect(conversation.state.isRestoring).toBe(true);
    expect(await waitUntil(() => !conversation.state.isRestoring)).toBe(true);

    const turns = conversation.state.turns;
    expect(conversation.state.restoreFailure).toBeUndefined();
    expect(conversation.state.sessionId).toBe('s1');
    expect(turns).toHaveLength(5);
    const redirect = turns[1];
    const answer = turns[3];
    const orphan = turns[4];
    if (redirect?.type !== 'assistant' || answer?.type !== 'assistant' || orphan?.type !== 'assistant') {
      throw new Error('expected assistant turns');
    }
    expect(redirect.redirectQuery, 'a redirect row is a query, not prose').toBe('iphone 15');
    expect(redirect.text).toBe('');
    expect(answer.text).toBe('here [p:1]');
    expect(answer.products.map((product) => product.talqynId), 'an id with no card behind it is skipped').toEqual([1]);
    expect(orphan.question, 'an orphan assistant row keeps its place').toBe('');
    expect(answer.stage).toBeUndefined();
    expect(transport.sent.at(-1)?.query).toBe('locale=en');
  });

  it('keeps a product repeated in a payload once', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([
      ...event('products', '{"items":[{"talqyn_id":1,"title":"Acer"},{"talqyn_id":2,"title":"Lenovo"},{"talqyn_id":1,"title":"Acer"}]}'),
      ...event('products', '{"items":[{"talqyn_id":2,"title":"Lenovo"},{"talqyn_id":3,"title":"Asus"},{"talqyn_id":3,"title":"Asus"}]}'),
      ...event('done', '{"session_id":"sess-1"}'),
    ]);
    const conversation = await makeConversation(transport);

    conversation.send('laptop');
    await settle(conversation);

    expect(lastAssistant(conversation).products.map((product) => product.talqynId)).toEqual([1, 2, 3]);
  });

  it('lists each product of a restored turn once', async () => {
    const transport = new StubTransport();
    transport.enqueue(`{"session_id":"s1","messages":[
      {"role":"user","text":"laptop","talqyn_ids":[]},
      {"role":"assistant","text":"here","talqyn_ids":[2,1,2,9,1]}],
     "products":[{"talqyn_id":1,"title":"Acer"},{"talqyn_id":2,"title":"Lenovo"}]}`);
    const conversation = await makeConversation(transport);

    conversation.restore('s1');
    expect(await waitUntil(() => !conversation.state.isRestoring)).toBe(true);

    expect(lastAssistant(conversation).products.map((product) => product.talqynId)).toEqual([2, 1]);
  });

  it('surfaces a restore failure', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"chat not found"}', { status: 404 });
    const conversation = await makeConversation(transport);

    conversation.restore('gone');
    expect(await waitUntil(() => !conversation.state.isRestoring)).toBe(true);
    expect(conversation.state.restoreFailure?.kind).toBe('notFound');
    expect(conversation.state.turns).toHaveLength(0);
  });

  it('does not take token issuance for an identity change', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ userId: shopper }); // not the local UUID
    transport.enqueueStream(fullTurn());
    const talqyn = TestFixtures.client({
      transport,
      credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.persistentAnonymous),
    });
    const conversation = new TalqynConversation(talqyn);

    conversation.refreshIdentity();
    conversation.send('question');
    await settle(conversation);
    expect(conversation.state.turns).toHaveLength(2);

    conversation.refreshIdentity();
    expect(conversation.state.turns, 'the token names the same shopper the site did').toHaveLength(2);
  });

  it('drops the transcript when the shopper changes', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn());
    const talqyn = await TestFixtures.preparedClient(transport);
    const conversation = new TalqynConversation(talqyn);

    conversation.refreshIdentity();
    conversation.send('question');
    await settle(conversation);
    conversation.refreshIdentity();
    expect(conversation.state.turns, 'same shopper, same transcript').toHaveLength(2);

    transport.enqueueDeviceToken({ token: 'tlqd_named', userId: shopper });
    talqyn.setIdentity(TalqynDeviceIdentity.user(shopper));
    conversation.refreshIdentity();
    expect(conversation.state.turns, 'a new shopper starts clean').toHaveLength(0);
  });

  it('notifies subscribers with the settled state', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(fullTurn());
    const conversation = await makeConversation(transport);
    const states: boolean[] = [];
    conversation.subscribe((state) => states.push(state.isStreaming));

    conversation.send('question');
    await settle(conversation);
    await Promise.resolve();
    expect(states[0]).toBe(true);
    expect(states.at(-1)).toBe(false);
  });
});
