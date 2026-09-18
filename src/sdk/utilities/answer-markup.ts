/** A run of answer text, or a product mentioned inside it. */
export type TalqynAnswerSegment =
  /** Plain text, with no markers left in it. */
  | { readonly type: 'text'; readonly text: string }
  /** A product mention, by its `talqynId`. */
  | { readonly type: 'product'; readonly talqynId: number };

/**
 * Product markers inside consultant text.
 *
 * Text arriving in a `delta` event may contain inline markers of the form `[p:1234]`, where the number
 * is the `talqynId` of a product from a `products` event already delivered in the same turn. The
 * server strips markers pointing at products outside the turn's results before they leave, so any
 * marker reaching a client is valid and resolves to one of the turn's products.
 *
 * Render one as a link or a chip to the product — or drop it with {@link TalqynAnswerMarkup.stripped}
 * if inline mentions are not part of your design.
 *
 * ```ts
 * for (const segment of TalqynAnswerMarkup.segments(text)) {
 *   if (segment.type === 'text') appendText(segment.text);
 *   else appendChip(segment.talqynId);
 * }
 * ```
 */
export class TalqynAnswerMarkup {
  private constructor() {}

  /**
   * Splits answer text into text runs and product mentions.
   *
   * Anything that looks like a marker but does not parse — `[p:abc]`, or a number too large to be an
   * id — stays as text.
   *
   * @returns The segments in order. Empty for empty input; a single text segment when there are no markers.
   */
  static segments(text: string): TalqynAnswerSegment[] {
    if (text.length === 0) return [];
    const segments: TalqynAnswerSegment[] = [];
    // Adjacent text runs merge, so a marker kept as text does not split the sentence around it into three segments.
    const appendText = (run: string): void => {
      if (run.length === 0) return;
      const last = segments[segments.length - 1];
      if (last?.type === 'text') {
        segments[segments.length - 1] = { type: 'text', text: last.text + run };
      } else {
        segments.push({ type: 'text', text: run });
      }
    };

    let cursor = 0;
    // `[0-9]`, not a Unicode digit class: an id is ASCII, and a marker that matched and then failed to
    // parse would vanish.
    for (const match of text.matchAll(/\[p:([0-9]+)\]/g)) {
      const start = match.index;
      if (start > cursor) appendText(text.slice(cursor, start));
      const id = Number(match[1]);
      if (Number.isSafeInteger(id)) {
        segments.push({ type: 'product', talqynId: id });
      } else {
        appendText(match[0]);
      }
      cursor = start + match[0].length;
    }
    if (cursor < text.length) appendText(text.slice(cursor));
    return segments;
  }

  /**
   * Removes every product marker from answer text. Built on {@link TalqynAnswerMarkup.segments}, so the
   * two agree on what counts as a marker. Surrounding spacing is left untouched.
   */
  static stripped(text: string): string {
    return TalqynAnswerMarkup.segments(text)
      .map((segment) => (segment.type === 'text' ? segment.text : ''))
      .join('');
  }

  /** The `talqynId` values mentioned in answer text, in order of appearance, repeats included. */
  static mentionedProductIds(text: string): number[] {
    return TalqynAnswerMarkup.segments(text).flatMap((segment) => (segment.type === 'product' ? [segment.talqynId] : []));
  }
}
