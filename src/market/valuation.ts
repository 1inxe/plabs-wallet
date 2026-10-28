import type { MarketQuote } from './prices';
export function assetValuation(quantity: string, quote?: MarketQuote) {
  const count = Number(quantity),
    usd = Number.isFinite(count) && count >= 0 && quote ? count * quote.usd : 0;
  const value = Number.isFinite(usd) ? usd : 0;
  const previous =
    quote?.change24h !== null &&
    quote?.change24h !== undefined &&
    quote.change24h > -100
      ? value / (1 + quote.change24h / 100)
      : value;
  return {
    usd: value,
    previous,
    change: value - previous,
    priced: Boolean(quote),
  };
}
export function portfolioValuation(
  items: { quantity: string; quote?: MarketQuote }[],
) {
  const values = items.map((item) => assetValuation(item.quantity, item.quote));
  const usd = values.reduce((sum, v) => sum + v.usd, 0),
    previous = values.reduce((sum, v) => sum + v.previous, 0);
  return {
    usd,
    change: usd - previous,
    percent: previous ? (usd / previous - 1) * 100 : 0,
    unpriced: values.filter(
      (v, i) => !v.priced && Number(items[i].quantity) > 0,
    ).length,
  };
}
const usdNumber = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const money = (value: number) => {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = usdNumber.format(Math.abs(amount));
  return `${amount < 0 && formatted !== '0.00' ? '-' : ''}$${formatted}`;
};
export const percentage = (value: number | null | undefined) =>
  `${value && value > 0 ? '+' : ''}${(value ?? 0).toFixed(2)}%`;

export const signedMoney = (value: number) => {
  const formatted = money(Math.abs(value));
  const sign =
    formatted === '$0.00' ? '' : value < 0 ? '-' : value > 0 ? '+' : '';
  return `${sign}${formatted}`;
};
