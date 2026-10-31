import { fmtPrice } from './format.js';
import { currencyOf } from './currency.js';

/** Public market prices are never masked by the private-balance toggle. */
export function marketPrice(value, currency = 'usd') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const symbol = currencyOf(currency).symbol;
  if (n < 0.0001) {
    const decimals = Math.min(9, Math.max(4, -Math.floor(Math.log10(n)) + 2));
    return `${symbol}${n.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')}`;
  }
  return `${symbol}${fmtPrice(n)}`;
}

export function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function positiveOrNull(value) {
  const n = finiteOrNull(value);
  return n != null && n > 0 ? n : null;
}
