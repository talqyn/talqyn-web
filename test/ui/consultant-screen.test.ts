// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TalqynConversation, TalqynUiStrings, type TalqynAssistantTurn } from '../../src/consultant-core/index.js';
import type { TalqynProduct } from '../../src/sdk/index.js';
import { isInteractiveEvent } from '../../src/ui/support/dom.js';
import {
  defineTalqynConsultantElement,
  mountTalqynConsultant,
  TALQYN_CONSULTANT_TAG,
  TalqynNavigation,
  type TalqynConsultantElement,
  type TalqynConsultantHandle,
  type TalqynConsultantOptions,
} from '../../src/ui/index.js';
import { SlowStreamTransport, sseEvent, StubTransport, TestFixtures, waitUntil } from '../support/stub-transport.js';

const strings = TalqynUiStrings.en;

const answerLines = [
  ...sseEvent('status', '{"stage":"thinking"}'),
  ...sseEvent('delta', '{"text":"Taking"}'),
  ...sseEvent('delta', '{"text":" a laptop"}'),
  ...sseEvent('done', '{"session_id":"sess-1"}'),
];

const askingLines = [
  ...sseEvent('status', '{"stage":"thinking"}'),
  ...sseEvent('clarify', '{"message":"clarify","questions":[{"id":"budget","label":"Budget?","multi":false,"options":["under 300k"]}]}'),
  ...sseEvent('done', '{"session_id":"sess-1"}'),
];

const handles: TalqynConsultantHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.innerHTML = '';
});

function mount(options: TalqynConsultantOptions): { handle: TalqynConsultantHandle; shadow: ShadowRoot } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const handle = mountTalqynConsultant(container, options);
  handles.push(handle);
  const shadow = handle.element.shadowRoot;
  if (!shadow) throw new Error('the consultant drew no shadow root');
  return { handle, shadow };
}

function lastAssistant(conversation: TalqynConversation): TalqynAssistantTurn | undefined {
  const turn = conversation.state.turns.at(-1);
  return turn?.type === 'assistant' ? turn : undefined;
}

function isShown(element: Element | null): boolean {
  for (let node = element; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.hidden) return false;
  }
  return element !== null;
}

function visibleButton(shadow: ShadowRoot, label: string): HTMLButtonElement | undefined {
  return [...shadow.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label && isShown(candidate),
  );
}

function streamingConversation(lines: readonly string[], options: { readonly keepsOpen?: boolean } = {}) {
  const transport = new SlowStreamTransport();
  transport.responses.enqueueDeviceToken();
  transport.enqueueStream(lines, options);
  return { transport, conversation: new TalqynConversation(TestFixtures.client({ transport })) };
}

describe('consultant screen: who owns a turn', () => {
  it('stops an answer nobody will read once the screen is taken off the page', async () => {
    const { transport, conversation } = streamingConversation(answerLines.slice(0, 6), { keepsOpen: true });
    const { handle } = mount({ conversation });

    conversation.send('need a laptop for school');
    expect(await waitUntil(() => (lastAssistant(conversation)?.text.length ?? 0) > 0), 'the answer never started').toBe(true);

    handle.element.remove();
    expect(await waitUntil(() => !conversation.state.isStreaming), 'the turn never settled').toBe(true);
    expect(lastAssistant(conversation)?.wasStopped).toBe(true);
    expect(transport.wasTerminated, 'the request behind the stream is still open').toBe(true);
  });

  it('keeps the answer going when the element is only moved on the page', async () => {
    const { conversation } = streamingConversation(answerLines);
    const { handle } = mount({ conversation });

    conversation.send('need a laptop for school');
    const elsewhere = document.createElement('section');
    document.body.appendChild(elsewhere);
    elsewhere.appendChild(handle.element);

    expect(await waitUntil(() => !conversation.state.isStreaming), 'the turn never settled').toBe(true);
    const turn = lastAssistant(conversation);
    expect(turn?.wasStopped).toBe(false);
    expect(turn?.text).toBe('Taking a laptop');
    expect(conversation.state.sessionId).toBe('sess-1');
    expect(handle.element.shadowRoot?.querySelector('.tq-turn'), 'the moved screen still draws the conversation').not.toBeNull();
  });

  it('stops the answer and leaves the page on destroy', async () => {
    const { conversation } = streamingConversation(answerLines.slice(0, 6), { keepsOpen: true });
    const { handle } = mount({ conversation });

    conversation.send('need a laptop for school');
    expect(await waitUntil(() => (lastAssistant(conversation)?.text.length ?? 0) > 0)).toBe(true);
    handle.destroy();

    expect(handle.element.isConnected).toBe(false);
    expect(await waitUntil(() => !conversation.state.isStreaming)).toBe(true);
    expect(lastAssistant(conversation)?.wasStopped).toBe(true);
  });
});

describe('consultant screen: the bar', () => {
  it('offers the way out the site names, and swaps it with the callbacks', () => {
    const back = vi.fn();
    const { handle, shadow } = mount({ talqyn: TestFixtures.client({ transport: new StubTransport() }), navigation: TalqynNavigation.back(back) });

    const leave = visibleButton(shadow, strings.back);
    expect(leave, 'no way back').toBeDefined();
    leave?.click();
    expect(back).toHaveBeenCalledTimes(1);
    expect(visibleButton(shadow, strings.close)).toBeUndefined();
    expect(
      visibleButton(shadow, strings.historyTitle)?.closest('.tq-header-side--trailing'),
      'with a way out, history moves next to a new chat',
    ).not.toBeNull();

    const close = vi.fn();
    handle.update({ navigation: TalqynNavigation.close(close) });
    visibleButton(shadow, strings.close)?.click();
    expect(close).toHaveBeenCalledTimes(1);
    expect(visibleButton(shadow, strings.back)).toBeUndefined();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('has no way out on a page of its own: history takes the leading slot', () => {
    const { shadow } = mount({ talqyn: TestFixtures.client({ transport: new StubTransport() }) });

    expect(visibleButton(shadow, strings.back)).toBeUndefined();
    expect(visibleButton(shadow, strings.close)).toBeUndefined();
    const history = visibleButton(shadow, strings.historyTitle);
    expect(history, 'history is always there').toBeDefined();
    expect(history?.closest('.tq-header-side--trailing')).toBeNull();
    expect(visibleButton(shadow, strings.newChat), 'nothing to start over on an empty screen').toBeUndefined();
  });

  it('draws no bar of its own when the site keeps its own', () => {
    const { shadow } = mount({ talqyn: TestFixtures.client({ transport: new StubTransport() }), showsHeader: false });
    expect(isShown(shadow.querySelector('.tq-header'))).toBe(false);
  });
});

describe('consultant screen: the conversation', () => {
  it('introduces itself with the site’s name and examples, and asks an example on a tap', async () => {
    const transport = new StubTransport();
    transport.enqueueStream(answerLines);
    const talqyn = await TestFixtures.preparedClient(transport);
    const { handle, shadow } = mount({ talqyn, title: 'Assistant', exampleQuestions: ['First question'], showsPoweredBy: false });

    expect(shadow.querySelector('.tq-empty-title')?.textContent).toBe('Assistant');
    expect(shadow.querySelector('.tq-header-title')?.textContent).toBe('Assistant');
    expect(shadow.querySelector('.tq-disclaimer')?.textContent, 'the disclaimer follows the name').toBe(
      'Assistant can be wrong. Double-check its answers.',
    );
    expect(isShown(shadow.querySelector('.tq-powered-by'))).toBe(false);
    const examples = [...shadow.querySelectorAll<HTMLElement>('.tq-empty-examples .tq-chip')];
    expect(examples.map((chip) => chip.textContent)).toEqual(['First question']);

    examples[0]?.click();
    expect(handle.conversation.state.turns.map((turn) => turn.type)).toEqual(['user', 'assistant']);
    expect(await waitUntil(() => !handle.conversation.state.isStreaming)).toBe(true);
    expect(await waitUntil(() => shadow.querySelector('.tq-bubble')?.textContent === 'First question')).toBe(true);
    expect(isShown(shadow.querySelector('.tq-transcript'))).toBe(true);
    expect(isShown(shadow.querySelector('.tq-empty'))).toBe(false);
    expect(shadow.querySelector('.tq-answer')?.textContent).toBe('Taking a laptop');
    expect(visibleButton(shadow, strings.newChat), 'a conversation can be started over').toBeDefined();
  });

  it('reports a click on a card or on a product’s name, and hands the product to the site', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([
      ...sseEvent('products', '{"items":[{"talqyn_id":7,"external_id":"SKU-7","title":"Laptop","price":300000}],"search_id":"srch-1"}'),
      ...sseEvent('delta', '{"text":"Take [p:7]."}'),
      ...sseEvent('done', '{"session_id":"sess-1"}'),
    ]);
    transport.enqueue('{}');
    transport.enqueue('{}');
    const talqyn = await TestFixtures.preparedClient(transport);
    const onOpenProduct = vi.fn<(product: TalqynProduct) => void>();
    const { handle, shadow } = mount({ talqyn, onOpenProduct });

    handle.conversation.send('laptop');
    expect(await waitUntil(() => !handle.conversation.state.isStreaming)).toBe(true);
    expect(await waitUntil(() => shadow.querySelector('.tq-card') !== null), 'no card for the cited product').toBe(true);

    shadow.querySelector<HTMLElement>('.tq-card')?.click();
    expect(onOpenProduct).toHaveBeenCalledTimes(1);
    expect(onOpenProduct.mock.calls[0]?.[0].talqynId).toBe(7);

    const mention = shadow.querySelector<HTMLElement>('.tq-mention');
    expect(mention?.textContent).toBe('Laptop');
    mention?.click();
    expect(onOpenProduct).toHaveBeenCalledTimes(2);

    const clicks = () => transport.sent.filter((sent) => sent.path.endsWith('/events/product-click'));
    expect(await waitUntil(() => clicks().length === 2), 'the clicks were not reported').toBe(true);
    expect(clicks()[0]?.bodyText).toContain('7');
  });

  it('asks a question that settled out of sight once the screen shows, and keeps a dismissed one in the transcript', async () => {
    const { conversation } = streamingConversation(askingLines);
    const { handle, shadow } = mount({ conversation });
    // Laid out at no size: the site has hidden the panel the consultant lives in.
    let bounds = new DOMRect(0, 0, 0, 0);
    handle.element.getBoundingClientRect = () => bounds;

    conversation.send('recommend something');
    expect(await waitUntil(() => !conversation.state.isStreaming), 'the turn never settled').toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shadow.querySelector('.tq-clarify-sheet'), 'the question came up out of sight').toBeNull();
    expect(isShown(shadow.querySelector('.tq-clarify-card')), 'nor as a card, before it was asked').toBe(false);

    bounds = new DOMRect(0, 0, 390, 844);
    document.dispatchEvent(new Event('visibilitychange'));
    const sheet = shadow.querySelector('.tq-clarify-sheet');
    expect(sheet, 'the question was lost').not.toBeNull();

    sheet?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shadow.querySelector('.tq-clarify-sheet')).toBeNull();
    expect(isShown(shadow.querySelector('.tq-clarify-card')), 'a dismissed sheet leaves its question in the transcript').toBe(true);
  });
});

describe('consultant screen: the site’s cards', () => {
  it('puts the site’s card into the page’s DOM through a slot, and takes it away with its turn', async () => {
    const transport = new StubTransport();
    transport.enqueueStream([
      ...sseEvent('products', '{"items":[{"talqyn_id":7,"title":"Laptop"}],"search_id":"srch-1"}'),
      ...sseEvent('done', '{"session_id":"sess-1"}'),
    ]);
    const talqyn = await TestFixtures.preparedClient(transport);
    const layouts: string[] = [];
    const { handle, shadow } = mount({
      talqyn,
      renderProductCard: (product, layout) => {
        layouts.push(layout);
        const card = document.createElement('article');
        card.className = 'shop-card';
        card.textContent = product.title;
        return card;
      },
    });

    handle.conversation.send('laptop');
    expect(await waitUntil(() => handle.element.querySelector('.shop-card') !== null), 'the site’s card never came').toBe(true);
    const card = handle.element.querySelector<HTMLElement>('.shop-card');
    expect(card?.parentElement, 'the site’s card lives in the page’s DOM, where its stylesheets reach').toBe(handle.element);
    expect(shadow.querySelector(`slot[name="${card?.slot ?? ''}"]`), 'and shows through a slot of the screen').not.toBeNull();
    expect(layouts, 'a carousel tile is vertical').toEqual(['vertical']);
    expect(shadow.querySelector('.tq-card'), 'no SDK card next to the site’s').toBeNull();

    handle.conversation.reset();
    expect(await waitUntil(() => handle.element.querySelector('.shop-card') === null), 'the card of a dropped turn stayed').toBe(true);
  });

  it('leaves a click on the card’s own controls to them', () => {
    const container = document.createElement('div');
    container.innerHTML = '<article><span class="name">Laptop</span><button type="button">Add to cart</button><div data-talqyn-no-open><i>♥</i></div></article>';
    document.body.appendChild(container);
    const verdicts: boolean[] = [];
    container.addEventListener('click', (event) => verdicts.push(isInteractiveEvent(event, container)));

    container.querySelector<HTMLElement>('.name')?.click();
    container.querySelector<HTMLElement>('button')?.click();
    container.querySelector<HTMLElement>('i')?.click();
    expect(verdicts).toEqual([false, true, true]);
  });
});

describe('consultant screen: adapting to the box the site gives it', () => {
  function elementWidth(element: HTMLElement, width: number): void {
    // happy-dom lays nothing out, and there is no ResizeObserver behind it either: the width the screen
    // measures for itself is stubbed, which is the same number a real one would read.
    element.getBoundingClientRect = () => ({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  function mountMeasured(options: TalqynConsultantOptions, width: number): { element: TalqynConsultantElement; shadow: ShadowRoot } {
    defineTalqynConsultantElement();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const element = document.createElement(TALQYN_CONSULTANT_TAG) as TalqynConsultantElement;
    elementWidth(element, width);
    element.configure(options);
    container.appendChild(element);
    const shadow = element.shadowRoot;
    if (!shadow) throw new Error('the consultant drew no shadow root');
    handles.push({ element, conversation: element.conversation!, update: () => undefined, destroy: () => element.dispose() });
    return { element, shadow };
  }

  it('stays compact until the element is wide enough, then lays out as a panel', () => {
    const narrow = mountMeasured({ conversation: streamingConversation(answerLines).conversation }, 420);
    expect(narrow.element.dataset['layout'], 'a panel-width element is a phone, whatever the window is').toBe('compact');

    const wide = mountMeasured({ conversation: streamingConversation(answerLines).conversation }, 900);
    expect(wide.element.dataset['layout']).toBe('regular');
    expect(wide.element.style.getPropertyValue('--tq-panel-width'), 'the widths travel as properties').toBe('720px');
    expect(wide.element.style.getPropertyValue('--tq-layer-inset')).toBe('48px');
  });

  it('takes the site’s threshold and widths', () => {
    const { element } = mountMeasured(
      {
        conversation: streamingConversation(answerLines).conversation,
        layout: { regularMinWidth: 400, panelWidth: 900, dialogWidth: 460, inset: 24 },
      },
      420,
    );
    expect(element.dataset['layout'], 'roomy from 400 because the site said so').toBe('regular');
    expect(element.style.getPropertyValue('--tq-panel-width')).toBe('900px');
    expect(element.style.getPropertyValue('--tq-dialog-width')).toBe('460px');
    expect(element.style.getPropertyValue('--tq-layer-inset')).toBe('24px');
  });

  it('keeps a pinned shape however wide the element turns out to be', () => {
    const pinned = mountMeasured({ conversation: streamingConversation(answerLines).conversation, layout: { mode: 'compact' } }, 1600);
    expect(pinned.element.dataset['layout']).toBe('compact');
  });

  it('opens history over a backdrop that closes it', async () => {
    const transport = new StubTransport();
    transport.enqueue('[]');
    const talqyn = await TestFixtures.preparedClient(transport);
    const { shadow } = mount({ talqyn });

    visibleButton(shadow, strings.historyTitle)?.click();
    const presentation = shadow.querySelector('.tq-layer .tq-presentation');
    expect(presentation?.querySelector('.tq-fullscreen'), 'history never came up').not.toBeNull();
    const backdrop = presentation?.querySelector<HTMLElement>('.tq-backdrop');
    // In the compact shape the opaque full screen hides it; in the roomy one it dims the transcript the
    // panel sits over, and a click outside the panel is the way out of it.
    expect(backdrop, 'a panel over a transcript needs something between the two').not.toBeNull();

    backdrop?.click();
    expect(await waitUntil(() => shadow.querySelector('.tq-layer .tq-fullscreen') === null), 'the backdrop did not close it').toBe(true);
  });

  it('stops a streaming answer on Escape', async () => {
    const { conversation } = streamingConversation(answerLines.slice(0, 6), { keepsOpen: true });
    const { shadow } = mount({ conversation });

    conversation.send('need a laptop for school');
    expect(await waitUntil(() => (lastAssistant(conversation)?.text.length ?? 0) > 0), 'the answer never started').toBe(true);

    shadow.querySelector('.tq-root')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await waitUntil(() => !conversation.state.isStreaming), 'Escape did not stop the answer').toBe(true);
    expect(lastAssistant(conversation)?.wasStopped).toBe(true);
  });
});
