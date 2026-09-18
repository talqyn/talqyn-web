import type { TalqynProduct } from '../sdk/index.js';

/** A run of answer text: bold or not, and either prose or the name of a product the consultant cited. */
export interface TalqynTextRun {
  readonly text: string;
  readonly isBold: boolean;
  /** The `talqynId` of the product this run names, when the run stands where a `[p:ID]` marker was. `undefined` for prose. */
  readonly productId: number | undefined;
}

/** How a line of an answer is set. */
export type TalqynAnswerLineKind = 'plain' | 'heading' | 'bullet' | 'numbered';

/** One line of an answer paragraph. */
export interface TalqynAnswerLine {
  readonly id: number;
  readonly kind: TalqynAnswerLineKind;
  /** For a `numbered` line, its number as written. */
  readonly number: string | undefined;
  readonly runs: readonly TalqynTextRun[];
}

export const TalqynAnswerLine = {
  /** The line as plain text, for accessibility and tests. */
  plainText(line: TalqynAnswerLine): string {
    return line.runs.map((run) => run.text).join('');
  },
} as const;

/** A piece of a rendered answer: a paragraph, or the product cards cited by the sentence just before them. */
export type TalqynAnswerBlock =
  | { readonly type: 'paragraph'; readonly id: number; readonly lines: readonly TalqynAnswerLine[] }
  | { readonly type: 'products'; readonly id: number; readonly items: readonly TalqynProduct[] };

// The trailing-marker pattern catches "[", "[p", "[p:", "[p:12" at the end of a stream chunk: the rest of
// the marker is still on its way.
const trailingPartialMarker = /\[(?:p(?::\d*)?)?$/;
const markerSource = String.raw`[ \t]*\[p:(\d+)\]`;
// The same marker without the whitespace before it: a marker that turns into a name keeps the space that
// separated it from the word before.
const bareMarkerSource = String.raw`\[p:(\d+)\]`;
const boldSource = String.raw`\*\*(.+?)\*\*`;
// Compiled once, as the iOS renderer keeps static NSRegularExpressions. Sharing a global regex is safe
// here: `replace` resets `lastIndex` itself and `matchAll` iterates over a clone.
const markerPattern = new RegExp(markerSource, 'g');
const bareMarkerPattern = new RegExp(bareMarkerSource, 'g');
const boldPattern = new RegExp(boldSource, 'g');
const headingPattern = /^[ \t]{0,3}#{1,6}[ \t]+/;
const bulletPattern = /^[ \t]{0,3}[-*•][ \t]+/;
const numberedPattern = /^[ \t]{0,3}(\d{1,2})[.)][ \t]+/;
const sentenceEndSource = String.raw`[.!?…;]+[")»”’\]]*(?=\s|$)`;
/** The horizontal whitespace a blank line is made of: tab and the Unicode space separators. */
const blankLinePattern = /^[\t \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]*$/;

interface CitationSegment {
  readonly text: string;
  readonly citedIds: readonly number[];
}

/**
 * Turns answer text into blocks a view can lay out.
 *
 * The consultant writes light Markdown — `**bold**`, `# headings`, `-` bullets, `1.` lists — and cites
 * products inline as `[p:ID]`. The marker stands where the product's name would be, so it is replaced by
 * the title (as a run carrying the product id) and the product card is pulled out of the text and placed
 * right after the sentence that mentioned it, so the card sits next to the claim rather than in a pile at
 * the end. Markers for products the turn does not have are dropped silently, and a marker still being
 * typed (`[p:12`) is hidden until it completes.
 *
 * Public so a storefront with its own screen renders answers the same way.
 */
export class TalqynAnswerRenderer {
  private constructor() {}

  /**
   * Renders answer text.
   *
   * @param text The answer so far, markers included.
   * @param products The products the markers may refer to, by Talqyn id.
   * @returns Paragraphs and product blocks in reading order. Block ids are stable across re-renders of a
   *   growing answer, so a view can diff them.
   */
  static blocks(text: string, products: ReadonlyMap<number, TalqynProduct>): TalqynAnswerBlock[] {
    const blocks: TalqynAnswerBlock[] = [];
    let pendingLines: string[] = [];
    const shownIds = new Set<number>();
    let slot = 0;

    const flushText = (): void => {
      const joined = pendingLines.join('\n').trim();
      pendingLines = [];
      if (joined.length === 0) return;
      blocks.push({ type: 'paragraph', id: slot * 2, lines: renderLines(joined, products) });
    };

    // A CRLF ends a line the way an LF does. Split on LF alone, a CRLF answer keeps a "\r" at the end of
    // every line, and the blank line between two paragraphs is a lone "\r" — not the whitespace a blank
    // line is made of — so the two run into one with a stray line inside.
    const lfText = text.split('\r\n').join('\n');
    for (const line of stripTrailingPartialMarker(lfText).split('\n')) {
      if (blankLinePattern.test(line)) {
        if (pendingLines.length > 0) {
          flushText();
          slot += 1;
        }
        continue;
      }

      let buffer = '';
      for (const segment of splitByCitations(line, products)) {
        buffer = [buffer, segment.text].filter((part) => part.length > 0).join(' ');
        const items = segment.citedIds
          .filter((id) => !shownIds.has(id))
          .flatMap((id) => {
            const product = products.get(id);
            return product ? [product] : [];
          });
        if (items.length === 0) continue;
        for (const item of items) shownIds.add(item.talqynId);
        pendingLines.push(buffer);
        buffer = '';
        flushText();
        blocks.push({ type: 'products', id: slot * 2 + 1, items });
        slot += 1;
      }
      if (buffer.length > 0) pendingLines.push(buffer);
    }

    flushText();
    return blocks;
  }

  /** Removes every `[p:ID]` marker and the whitespace before it, keeping the text. */
  static stripped(text: string): string {
    const result = stripTrailingPartialMarker(text).replace(markerPattern, '');
    return result.replace(/[ \t]+$/, '');
  }

  /**
   * The answer as plain text, with product names in place of the markers and lists written out — for the
   * clipboard, or a share sheet.
   *
   * @returns Paragraphs separated by blank lines, bullets as `• `, numbered items as `1. `. The product
   *   cards are not written out: the sentences that cited them already name them.
   */
  static plainText(text: string, products: ReadonlyMap<number, TalqynProduct>): string {
    return TalqynAnswerRenderer.plainTextOf(TalqynAnswerRenderer.blocks(text, products));
  }

  /** The paragraphs of rendered blocks as plain text; see {@link TalqynAnswerRenderer.plainText}. */
  static plainTextOf(blocks: readonly TalqynAnswerBlock[]): string {
    return blocks
      .flatMap((block) => {
        if (block.type !== 'paragraph') return [];
        return [
          block.lines
            .map((line) => {
              const plain = TalqynAnswerLine.plainText(line);
              switch (line.kind) {
                case 'bullet':
                  return `• ${plain}`;
                case 'numbered':
                  return `${line.number ?? ''}. ${plain}`;
                default:
                  return plain;
              }
            })
            .join('\n'),
        ];
      })
      .join('\n\n');
  }
}

/** What a marker turns into: the product's title, or its brand when the title is empty. `undefined` when there is nothing to show. */
function nameOf(product: TalqynProduct | undefined): string | undefined {
  if (!product) return undefined;
  for (const candidate of [product.title, product.brandName ?? '']) {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function markerId(raw: string | undefined): number | undefined {
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

/**
 * Splits a line at the end of every sentence that cites a product, so the cards can be placed right after it.
 *
 * A marker that resolves to a product stays in the segment's text, to be replaced by the product's name
 * when the runs are built; one that does not is dropped together with the whitespace before it.
 */
function splitByCitations(line: string, products: ReadonlyMap<number, TalqynProduct>): CitationSegment[] {
  const matches = [...line.matchAll(markerPattern)];
  if (matches.length === 0) return [{ text: line, citedIds: [] }];

  // A list item is one unit: its cards go after the whole item, not after the first period inside it.
  const splitsBySentence = parseLine(line).kind === 'plain';

  const segments: CitationSegment[] = [];
  let cleaned = '';
  let citedIds: number[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const start = match.index;
    cleaned += line.slice(cursor, start);
    cursor = start + match[0].length;

    const id = markerId(match[1]);
    if (id !== undefined && nameOf(products.get(id)) !== undefined) cleaned += match[0];
    if (id !== undefined && products.has(id) && !citedIds.includes(id)) citedIds.push(id);
    if (citedIds.length === 0) return;

    const sentenceEnd = splitsBySentence ? sentenceEndLocation(line, cursor) : line.length;
    const nextMarker = index + 1 < matches.length ? matches[index + 1]!.index : line.length;
    if (nextMarker < sentenceEnd) return;

    cleaned += line.slice(cursor, sentenceEnd);
    cursor = sentenceEnd;
    segments.push({ text: trimmed(cleaned, segments.length === 0), citedIds });
    cleaned = '';
    citedIds = [];
  });

  cleaned += line.slice(cursor);
  const tail = trimmed(cleaned, segments.length === 0);
  if (tail.length > 0 || citedIds.length > 0) segments.push({ text: tail, citedIds });
  return segments;
}

function sentenceEndLocation(line: string, from: number): number {
  const pattern = new RegExp(sentenceEndSource, 'g');
  pattern.lastIndex = from;
  const match = pattern.exec(line);
  return match ? match.index + match[0].length : line.length;
}

function trimmed(text: string, keepingIndent: boolean): string {
  const value = text.replace(/\s+$/u, '');
  return keepingIndent ? value : value.replace(/^\s+/u, '');
}

function parseLine(line: string): { kind: TalqynAnswerLineKind; number: string | undefined; content: string } {
  let match = headingPattern.exec(line);
  if (match) return { kind: 'heading', number: undefined, content: line.slice(match[0].length) };
  match = bulletPattern.exec(line);
  if (match) return { kind: 'bullet', number: undefined, content: line.slice(match[0].length) };
  match = numberedPattern.exec(line);
  if (match) return { kind: 'numbered', number: match[1], content: line.slice(match[0].length) };
  return { kind: 'plain', number: undefined, content: line };
}

function renderLines(text: string, products: ReadonlyMap<number, TalqynProduct>): TalqynAnswerLine[] {
  return text.split('\n').map((line, index) => {
    const { kind, number, content } = parseLine(line);
    return { id: index, kind, number, runs: runs(content, products) };
  });
}

/** `**bold**` becomes a bold run and a `[p:ID]` marker becomes the product's name; everything else stays regular. */
function runs(text: string, products: ReadonlyMap<number, TalqynProduct>): TalqynTextRun[] {
  const result: TalqynTextRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(boldPattern)) {
    if (match.index > cursor) result.push(...namedRuns(text.slice(cursor, match.index), false, products));
    result.push(...namedRuns(match[1] ?? '', true, products));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) result.push(...namedRuns(text.slice(cursor), false, products));
  return result;
}

/** Splits a run at its markers, putting the product's name where each marker was. A marker with no name to show is dropped. */
function namedRuns(text: string, isBold: boolean, products: ReadonlyMap<number, TalqynProduct>): TalqynTextRun[] {
  const result: TalqynTextRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(bareMarkerPattern)) {
    if (match.index > cursor) {
      result.push({ text: text.slice(cursor, match.index), isBold, productId: undefined });
    }
    const id = markerId(match[1]);
    const name = id === undefined ? undefined : nameOf(products.get(id));
    if (id !== undefined && name !== undefined) result.push({ text: name, isBold, productId: id });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), isBold, productId: undefined });
  return result;
}

function stripTrailingPartialMarker(text: string): string {
  const match = trailingPartialMarker.exec(text);
  return match ? text.slice(0, match.index) : text;
}
