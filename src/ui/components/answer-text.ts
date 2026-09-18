import type { TalqynAnswerLine } from '../../consultant-core/index.js';
import { h } from '../support/dom.js';

/**
 * A paragraph of an answer: headings, bullets and numbered items with a hanging indent, bold runs, and
 * product names that open the product.
 *
 * A product name is set in the bold face — it stands where the consultant put a marker, and the weight
 * tells it apart from the prose around it — and in the accent, as a link: the card may be a paragraph
 * away, the name is right under the pointer. The text stays selectable, so a shopper can copy a model name.
 */
export class TalqynAnswerParagraphView {
  readonly element: HTMLDivElement;
  private key = '';
  onProduct: ((productId: number) => void) | undefined;

  constructor() {
    this.element = h('div', 'tq-answer tq-font-body');
    this.element.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.tq-mention') : null;
      if (!target) return;
      event.preventDefault();
      const id = Number(target.dataset['productId']);
      if (Number.isSafeInteger(id)) this.onProduct?.(id);
    });
    this.element.addEventListener('keydown', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key !== 'Enter' || !target?.classList.contains('tq-mention')) return;
      event.preventDefault();
      const id = Number(target.dataset['productId']);
      if (Number.isSafeInteger(id)) this.onProduct?.(id);
    });
  }

  /** Writes the lines, touching the DOM only when they changed: a paragraph that did not change keeps the shopper's selection. */
  update(lines: readonly TalqynAnswerLine[]): void {
    const key = JSON.stringify(lines.map((line) => [line.kind, line.number, line.runs]));
    if (key === this.key) return;
    this.key = key;
    this.element.replaceChildren(...lines.map(renderLine));
  }
}

function renderLine(line: TalqynAnswerLine): HTMLElement {
  const element = h('div', `tq-line tq-line--${line.kind}`);
  if (line.kind === 'heading') element.classList.add('tq-font-headline');
  if (line.kind === 'bullet') element.appendChild(h('span', 'tq-line-marker', ['•']));
  if (line.kind === 'numbered') element.appendChild(h('span', 'tq-line-marker', [`${line.number ?? ''}.`]));
  const content = h('span', 'tq-line-content');
  for (const run of line.runs) {
    if (run.productId !== undefined) {
      // A link with no address: the product opens through the site's own router, and a middle click has
      // nowhere wrong to go.
      const mention = h('a', 'tq-mention', [run.text]);
      mention.setAttribute('role', 'link');
      mention.tabIndex = 0;
      mention.dataset['productId'] = String(run.productId);
      content.appendChild(mention);
    } else if (run.isBold) {
      content.appendChild(h('strong', null, [run.text]));
    } else {
      content.appendChild(document.createTextNode(run.text));
    }
  }
  element.appendChild(content);
  return element;
}
