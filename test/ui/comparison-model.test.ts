import { describe, expect, it } from 'vitest';
import { TalqynPriceFormatter } from '../../src/consultant-core/index.js';
import { TalqynProduct, type TalqynComparisonTable } from '../../src/sdk/index.js';
import { TalqynComparisonModel } from '../../src/ui/screens/comparison-model.js';

const NBSP = ' ';

const products = new Map([
  [101, TalqynProduct.create({ talqynId: 101, title: 'Bosch SMS4HVI33E', price: 239_990 })],
  [102, TalqynProduct.create({ talqynId: 102, title: 'Electrolux EEM48321L', price: 219_990 })],
]);

const table: TalqynComparisonTable = {
  talqynIds: [101, 102],
  titles: ['Bosch', 'Electrolux'],
  rows: [
    { label: 'price', values: ['239990', '219990'] },
    { label: 'brand', values: ['Bosch', 'Electrolux'] },
    { label: 'width', values: ['60 cm', '60 cm'] },
    { label: 'dryer', values: ['Zeolith', null] },
  ],
};

describe('TalqynComparisonModel', () => {
  it('heads a column with its card, or with the table title when the card is missing', () => {
    const model = TalqynComparisonModel.create({ ...table, talqynIds: [101, 999] }, products);
    expect(model.columns.map((column) => column.title)).toEqual(['Bosch SMS4HVI33E', 'Electrolux']);
    expect(model.columns[0]?.product?.talqynId).toBe(101);
    expect(model.columns[1]?.product).toBeUndefined();
  });

  it('follows the titles for the columns, even past the ids', () => {
    const model = TalqynComparisonModel.create({ ...table, talqynIds: [101] }, products);
    expect(model.columns.map((column) => column.title)).toEqual(['Bosch SMS4HVI33E', 'Electrolux']);
  });

  it('recognizes a price row by its values, not its label', () => {
    const model = TalqynComparisonModel.create(table, products);
    expect(model.rows.map((row) => row.isPrice)).toEqual([true, false, false, false]);
  });

  it('refuses a price row whose number is not the price, or whose value is not a number', () => {
    const wrongNumber = TalqynComparisonModel.create({ ...table, rows: [{ label: 'x', values: ['239990', '1'] }] }, products);
    expect(wrongNumber.rows[0]?.isPrice).toBe(false);
    const notANumber = TalqynComparisonModel.create({ ...table, rows: [{ label: 'x', values: ['239990', '219 990 ₸'] }] }, products);
    expect(notANumber.rows[0]?.isPrice).toBe(false);
  });

  it('lets an unknown product or price neither confirm nor refute a price row', () => {
    const unknown = TalqynComparisonModel.create(
      { talqynIds: [101, 999], titles: ['A', 'B'], rows: [{ label: 'price', values: ['239990', '12345'] }] },
      products,
    );
    expect(unknown.rows[0]?.isPrice, 'one match, one column that cannot say').toBe(true);

    const noPrices = TalqynComparisonModel.create(
      { talqynIds: [1, 2], titles: ['A', 'B'], rows: [{ label: 'price', values: ['100', '200'] }] },
      new Map([
        [1, TalqynProduct.create({ talqynId: 1, title: 'A' })],
        [2, TalqynProduct.create({ talqynId: 2, title: 'B' })],
      ]),
    );
    expect(noPrices.rows[0]?.isPrice, 'numbers alone confirm nothing').toBe(false);

    const missingValue = TalqynComparisonModel.create({ ...table, rows: [{ label: 'price', values: ['239990', null] }] }, products);
    expect(missingValue.rows[0]?.isPrice, 'a value the product lacks is skipped').toBe(true);
  });

  it('keeps only the rows where the products differ, a missing value reading as an empty one', () => {
    const model = TalqynComparisonModel.create(table, products);
    expect(TalqynComparisonModel.hasDifferences(model)).toBe(true);
    const differences = TalqynComparisonModel.keepingOnlyDifferences(model);
    expect(differences.rows.map((row) => row.row.label)).toEqual(['price', 'brand', 'dryer']);
    expect(differences.columns).toBe(model.columns);

    const short = TalqynComparisonModel.create({ ...table, rows: [{ label: 'x', values: ['a'] }] }, products);
    expect(TalqynComparisonModel.keepingOnlyDifferences(short).rows, 'a row shorter than the columns differs').toHaveLength(1);

    const same = TalqynComparisonModel.create({ ...table, rows: [{ label: 'x', values: ['60 cm', '60 cm'] }] }, products);
    expect(TalqynComparisonModel.hasDifferences(same)).toBe(false);
    expect(TalqynComparisonModel.keepingOnlyDifferences(same).rows).toEqual([]);
  });

  it('writes a cell as a price, as it came, or as a dash', () => {
    const model = TalqynComparisonModel.create(table, products);
    const price = TalqynPriceFormatter.tenge;
    const [priceRow, brandRow, , dryingRow] = model.rows;
    expect(TalqynComparisonModel.cellText(priceRow!, 0, price)).toBe(`239${NBSP}990${NBSP}₸`);
    expect(TalqynComparisonModel.cellText(brandRow!, 1, price)).toBe('Electrolux');
    expect(TalqynComparisonModel.cellText(dryingRow!, 1, price), 'a characteristic the product lacks').toBe('—');
    expect(TalqynComparisonModel.cellText(brandRow!, 5, price), 'a column past the values').toBe('—');
    const empty = TalqynComparisonModel.create({ ...table, rows: [{ label: 'x', values: ['', 'b'] }] }, products);
    expect(TalqynComparisonModel.cellText(empty.rows[0]!, 0, price)).toBe('—');
  });

  it('capitalizes a label by its first letter', () => {
    expect(TalqynComparisonModel.capitalized('screen')).toBe('Screen');
    expect(TalqynComparisonModel.capitalized('noise level')).toBe('Noise level');
    expect(TalqynComparisonModel.capitalized('')).toBe('');
    expect(TalqynComparisonModel.capitalized('😀 emoji')).toBe('😀 emoji');
  });

  it('shares the width between the columns, but never below the minimum', () => {
    expect(TalqynComparisonModel.columnWidth(2, 390)).toBe(137);
    expect(TalqynComparisonModel.columnWidth(3, 390), 'three columns on a phone scroll sideways').toBe(130);
    expect(TalqynComparisonModel.columnWidth(2, 1_000)).toBe(442);
    expect(TalqynComparisonModel.columnWidth(0, 390)).toBe(130);
    expect(TalqynComparisonModel.columnWidth(2, 100)).toBe(130);
  });
});
