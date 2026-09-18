import type { TalqynPriceFormatter } from '../../consultant-core/index.js';
import type { TalqynComparisonRow, TalqynComparisonTable, TalqynProduct } from '../../sdk/index.js';

/** One column of a comparison: a compared product and what heads it. */
export interface TalqynComparisonColumn {
  /** The product, when the conversation has its card; `undefined` for an id with no card behind it. */
  readonly product: TalqynProduct | undefined;
  /** The product's title, or the table's own title for the column when the card is missing. */
  readonly title: string;
}

/** A row of a comparison, with what it is known to hold. */
export interface TalqynComparisonModelRow {
  readonly row: TalqynComparisonRow;
  /** Whether the values are the products' prices — to write them as prices rather than as the bare numbers the table carries. */
  readonly isPrice: boolean;
}

/** A comparison table as the screen draws it: the columns resolved against the conversation's cards, the rows classified. */
export interface TalqynComparisonModel {
  readonly columns: readonly TalqynComparisonColumn[];
  readonly rows: readonly TalqynComparisonModelRow[];
}

const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Spaces of any kind and tabs, but not line breaks: what may pad a number written in a cell. */
const edgeSpaces = /^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu;

/** A value that reads as a plain decimal number, spaces around it aside; `undefined` for anything else. */
function decimal(raw: string): number | undefined {
  const trimmed = raw.replace(edgeSpaces, '');
  if (!decimalPattern.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** The value of a row in a column, a value the row does not carry reading as `null`. */
function valueAt(row: TalqynComparisonRow, index: number): string | null {
  return index < row.values.length ? (row.values[index] ?? null) : null;
}

/**
 * Whether a row holds the products' prices.
 *
 * Recognized by its values, not its label: the label is the server's wording in one language, and a row
 * whose every number is the price of its column's product is a price row in any language. A column whose
 * product or price is unknown neither confirms nor refutes it; a value that is not a number refutes it.
 */
function isPriceRow(row: TalqynComparisonRow, columns: readonly TalqynComparisonColumn[]): boolean {
  let matched = 0;
  for (let index = 0; index < columns.length; index++) {
    const raw = valueAt(row, index);
    if (raw === null) continue;
    const value = decimal(raw);
    if (value === undefined) return false;
    const price = columns[index]?.product?.price;
    if (price === undefined) continue;
    if (Math.abs(value - price) >= 0.01) return false;
    matched += 1;
  }
  return matched > 0;
}

/** Whether the products say different things in a row. A value a row does not carry reads as an empty one. */
function differs(row: TalqynComparisonRow, columnCount: number): boolean {
  const values = new Set<string>();
  for (let index = 0; index < columnCount; index++) values.add(valueAt(row, index) ?? '');
  return values.size > 1;
}

export const TalqynComparisonModel = {
  /** The width of the pinned column of characteristics, in CSS pixels. */
  labelColumnWidth: 116,

  /** The narrowest a product column gets; past that the columns scroll sideways instead of squeezing. */
  minColumnWidth: 130,

  /**
   * Resolves a table against the conversation's cards.
   *
   * The columns follow the table's titles, and each takes the product of the id at its position: the
   * card's title heads the column where the card is known, the table's own title where it is not.
   */
  create(table: TalqynComparisonTable, products: ReadonlyMap<number, TalqynProduct>): TalqynComparisonModel {
    const columns = table.titles.map((title, index): TalqynComparisonColumn => {
      const id = table.talqynIds[index];
      const product = id === undefined ? undefined : products.get(id);
      return { product, title: product?.title ?? title };
    });
    return { columns, rows: table.rows.map((row) => ({ row, isPrice: isPriceRow(row, columns) })) };
  },

  /** Whether any row tells the products apart — without one, "only differences" has nothing to offer. */
  hasDifferences(model: TalqynComparisonModel): boolean {
    return model.rows.some((entry) => differs(entry.row, model.columns.length));
  },

  /** The same table without the rows where every product says the same thing. */
  keepingOnlyDifferences(model: TalqynComparisonModel): TalqynComparisonModel {
    return { columns: model.columns, rows: model.rows.filter((entry) => differs(entry.row, model.columns.length)) };
  },

  /** What a cell reads: "—" where the product lacks the characteristic, a formatted price in a price row, the value as it came otherwise. */
  cellText(entry: TalqynComparisonModelRow, columnIndex: number, price: TalqynPriceFormatter): string {
    const value = valueAt(entry.row, columnIndex);
    if (value === null || value.length === 0) return '—';
    if (!entry.isPrice) return value;
    const number = decimal(value);
    return number === undefined ? value : price.format(number);
  },

  /** A characteristic's name with its first letter capitalized: the server writes them as they would stand mid-sentence. */
  capitalized(label: string): string {
    const first = label.codePointAt(0);
    if (first === undefined) return label;
    const head = String.fromCodePoint(first);
    return head.toUpperCase() + label.slice(head.length);
  },

  /**
   * How wide a product column is: the columns share what the label column leaves of the width, but none
   * gets narrower than {@link TalqynComparisonModel.minColumnWidth}.
   */
  columnWidth(count: number, availableWidth: number): number {
    const available = availableWidth - TalqynComparisonModel.labelColumnWidth;
    if (count <= 0 || available <= 0) return TalqynComparisonModel.minColumnWidth;
    return Math.max(TalqynComparisonModel.minColumnWidth, Math.floor(available / count));
  },
} as const;
