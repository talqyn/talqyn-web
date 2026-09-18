/** How prices are written on cards and in filter summaries. */
export interface TalqynPriceFormatter {
  readonly format: (value: number) => string;
}

const NO_BREAK_SPACE = ' ';

/**
 * The number grouped by thousands with a no-break space, and a fraction of up to two digits only when the
 * price has one. Written by hand rather than through `Intl`: whether a locale groups a four-digit number,
 * and with which space, differs between browsers' locale data, and a price must read the same everywhere.
 */
function grouped(value: number): string {
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  let digits = Number.isInteger(magnitude) ? magnitude.toFixed(0) : magnitude.toFixed(2);
  if (digits.includes('.')) digits = digits.replace(/0+$/, '').replace(/\.$/, '');
  const [whole = '0', fraction] = digits.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NO_BREAK_SPACE);
  return `${sign}${groupedWhole}${fraction ? `,${fraction}` : ''}`;
}

export const TalqynPriceFormatter = {
  /** A formatter from a function. */
  create(format: (value: number) => string): TalqynPriceFormatter {
    return { format };
  },

  /** `449 990 ₸`: grouped by thousands with a no-break space, no fraction unless the price has one. */
  tenge: Object.freeze({ format: (value: number) => `${grouped(value)}${NO_BREAK_SPACE}₸` }) as TalqynPriceFormatter,
} as const;
