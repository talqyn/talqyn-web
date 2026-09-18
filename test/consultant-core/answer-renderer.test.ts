import { describe, expect, it } from 'vitest';
import {
  TalqynAnswerLine,
  TalqynAnswerRenderer,
  type TalqynAnswerBlock,
} from '../../src/consultant-core/index.js';
import { TalqynProduct } from '../../src/sdk/index.js';

const products = new Map([
  [1, TalqynProduct.create({ talqynId: 1, title: 'Acer' })],
  [2, TalqynProduct.create({ talqynId: 2, title: 'Lenovo' })],
]);

function paragraphs(blocks: readonly TalqynAnswerBlock[]): string[][] {
  return blocks.flatMap((block) => (block.type === 'paragraph' ? [block.lines.map(TalqynAnswerLine.plainText)] : []));
}

function run(text: string, init: { isBold?: boolean; productId?: number } = {}) {
  return { text, isBold: init.isBold ?? false, productId: init.productId };
}

describe('TalqynAnswerRenderer', () => {
  it('places citation cards after the sentence that cites them', () => {
    const blocks = TalqynAnswerRenderer.blocks('Take [p:1]. It is quieter. Or [p:2] — pricier.', products);
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'products', 'paragraph', 'products']);
    expect(paragraphs(blocks)).toEqual([['Take Acer.'], ['It is quieter. Or Lenovo — pricier.']]);
    const cited = blocks.flatMap((block) => (block.type === 'products' ? [block.items.map((item) => item.talqynId)] : []));
    expect(cited).toEqual([[1], [2]]);
  });

  it('turns a marker into the product name in its own run', () => {
    const [block] = TalqynAnswerRenderer.blocks('The [p:2] has a quieter fan than the [p:1].', products);
    expect(block?.type).toBe('paragraph');
    if (block?.type !== 'paragraph') return;
    expect(block.lines[0]?.runs).toEqual([
      run('The '),
      run('Lenovo', { productId: 2 }),
      run(' has a quieter fan than the '),
      run('Acer', { productId: 1 }),
      run('.'),
    ]);
  });

  it('keeps a name inside bold bold', () => {
    const [block] = TalqynAnswerRenderer.blocks('**Pick: [p:1]** — and that is that.', products);
    if (block?.type !== 'paragraph') throw new Error('expected a paragraph');
    expect(block.lines[0]?.runs).toEqual([
      run('Pick: ', { isBold: true }),
      run('Acer', { isBold: true, productId: 1 }),
      run(' — and that is that.'),
    ]);
  });

  it('falls back to the brand for a nameless product', () => {
    const catalog = new Map([
      [7, TalqynProduct.create({ talqynId: 7, title: '  ', brandName: 'Asus' })],
      [8, TalqynProduct.create({ talqynId: 8, title: '' })],
    ]);
    const blocks = TalqynAnswerRenderer.blocks('Compare [p:7] and [p:8].', catalog);
    expect(paragraphs(blocks), 'no title, no brand: the marker is dropped').toEqual([['Compare Asus and.']]);
    const last = blocks.at(-1);
    expect(last?.type).toBe('products');
    if (last?.type === 'products') {
      expect(last.items.map((item) => item.talqynId), 'a product with nothing to call it still gets its card').toEqual([7, 8]);
    }
  });

  it('cites a list item as a whole', () => {
    const blocks = TalqynAnswerRenderer.blocks('1. Pick [p:1]. Fast SSD.\n2. Or [p:2].', products);
    const [first, second] = blocks;
    if (first?.type !== 'paragraph' || second?.type !== 'products') throw new Error('expected a paragraph and cards');
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]?.kind).toBe('numbered');
    expect(first.lines[0]?.number).toBe('1');
    expect(TalqynAnswerLine.plainText(first.lines[0]!), 'the whole item stays together above its card').toBe(
      'Pick Acer. Fast SSD.',
    );
    expect(second.items.map((item) => item.talqynId)).toEqual([1]);
  });

  it('reads markdown line kinds and bold runs', () => {
    const blocks = TalqynAnswerRenderer.blocks('# Summary\nPlain **bold** line\n- item\n* another item\n3) third', new Map());
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    if (block?.type !== 'paragraph') throw new Error('expected one paragraph');
    expect(block.lines.map((line) => line.kind)).toEqual(['heading', 'plain', 'bullet', 'bullet', 'numbered']);
    expect(block.lines[4]?.number).toBe('3');
    expect(TalqynAnswerLine.plainText(block.lines[0]!)).toBe('Summary');
    expect(block.lines[1]?.runs).toEqual([run('Plain '), run('bold', { isBold: true }), run(' line')]);
    expect(TalqynAnswerLine.plainText(block.lines[4]!)).toBe('third');
  });

  it('splits paragraphs on blank lines with stable ids', () => {
    const blocks = TalqynAnswerRenderer.blocks('First paragraph.\n\nSecond paragraph.', new Map());
    expect(blocks.map((block) => block.id)).toEqual([0, 2]);
    expect(paragraphs(blocks)).toEqual([['First paragraph.'], ['Second paragraph.']]);
  });

  it('reads CRLF line endings like LF', () => {
    const blocks = TalqynAnswerRenderer.blocks('a\r\n\r\nb', new Map());
    expect(blocks.map((block) => block.id)).toEqual([0, 2]);
    expect(paragraphs(blocks)).toEqual([['a'], ['b']]);

    const text = '# Summary\nTake [p:1].\n\n- quieter\n- cheaper [p:2]\n1. first';
    expect(TalqynAnswerRenderer.blocks(text.split('\n').join('\r\n'), products)).toEqual(
      TalqynAnswerRenderer.blocks(text, products),
    );
    expect(TalqynAnswerRenderer.plainText('a\r\nb\r\n\r\n- c', new Map())).not.toContain('\r');
  });

  it('drops unknown markers and names repeated ones again', () => {
    const blocks = TalqynAnswerRenderer.blocks('See [p:42] and [p:1], then again [p:1].', products);
    const cards = blocks.flatMap((block) => (block.type === 'products' ? [block.items.map((item) => item.talqynId)] : []));
    expect(cards, 'an unknown product vanishes, a repeat is shown once').toEqual([[1]]);
    expect(paragraphs(blocks).flat().join('|')).toBe('See and Acer, then again Acer.');
  });

  it('hides a marker still being typed', () => {
    for (const partial of ['Take [', 'Take [p', 'Take [p:', 'Take [p:12']) {
      expect(paragraphs(TalqynAnswerRenderer.blocks(partial, products)), partial).toEqual([['Take']]);
    }
  });

  it('strips markers', () => {
    expect(TalqynAnswerRenderer.stripped('Take [p:1] or [p:2]. More [p:')).toBe('Take or. More');
  });

  it('writes plain text with product names and lists written out', () => {
    const text = '# Summary\nTake [p:1].\n\n- quieter\n- cheaper [p:2]\n1. first\n2) second';
    expect(TalqynAnswerRenderer.plainText(text, products), 'a blank line stands where the cited cards were').toBe(
      'Summary\nTake Acer.\n\n• quieter\n• cheaper Lenovo\n\n1. first\n2. second',
    );
    expect(TalqynAnswerRenderer.plainText('', products)).toBe('');
  });

  it('renders nothing for empty text', () => {
    expect(TalqynAnswerRenderer.blocks('', products)).toEqual([]);
    expect(TalqynAnswerRenderer.blocks('\n\n  \n', products)).toEqual([]);
  });
});
