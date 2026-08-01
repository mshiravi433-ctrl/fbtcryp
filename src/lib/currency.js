/**
 * DISPLAY CURRENCY.
 *
 * ─── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 * Settings had a currency selector offering USD / EUR / IRT / AED. It wrote
 * `currency` into the store and **nothing ever read it**. Every price in the
 * app was formatted by `fmtUsd`, which hardcodes a `$`. So the control looked
 * live, persisted a value, and changed absolutely nothing on screen.
 *
 * That is the same class as the biometric toggle that locked people out: a
 * setting wired to nothing. On a money screen it is worse than cosmetic — a
 * user who selects EUR and then reads "$1,240" has been told their portfolio
 * is worth something it is not.
 *
 * ─── WHY IRT (IRANIAN RIAL) IS GONE ─────────────────────────────────────────
 * Removed at the owner's request, and it was the right call technically too:
 * no price feed we use quotes IRT, so it could only ever have been a label
 * over a USD number. A currency symbol that lies about the unit is the single
 * most dangerous kind of wrong on a financial screen.
 *
 * ─── WHY THESE CURRENCIES ───────────────────────────────────────────────────
 * Every code here is one CoinGecko actually quotes, so the conversion is a
 * real upstream price rather than a client-side multiplication against a
 * stale hardcoded rate. If the feed cannot price it, we do not offer it.
 */

/** Supported display currencies. `id` is the CoinGecko `vs_currency` code. */
export const CURRENCIES = [
  { id: 'usd', code: 'USD', symbol: '$', name: 'US Dollar' },
  { id: 'eur', code: 'EUR', symbol: '€', name: 'Euro' },
  { id: 'aed', code: 'AED', symbol: 'AED ', name: 'UAE Dirham' },
  { id: 'gbp', code: 'GBP', symbol: '£', name: 'British Pound' },
  { id: 'try', code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
  { id: 'cny', code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { id: 'inr', code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { id: 'rub', code: 'RUB', symbol: '₽', name: 'Russian Ruble' }
];

const DEFAULT = CURRENCIES[0];

/**
 * Resolve a stored code to a currency.
 *
 * Falls back to USD for anything unknown — which includes the legacy 'IRT'
 * value still sitting in the store of every existing install. Without this
 * they would render `undefined` beside every price after the upgrade.
 */
export function currencyOf(code) {
  if (!code) return DEFAULT;
  const want = String(code).toUpperCase();
  return CURRENCIES.find((c) => c.code === want) ?? DEFAULT;
}

/** The `vs_currency` value to send upstream. */
export const vsOf = (code) => currencyOf(code).id;

/** True when a stored preference is no longer supported (e.g. the old IRT). */
export const isLegacyCurrency = (code) =>
  Boolean(code) && !CURRENCIES.some((c) => c.code === String(code).toUpperCase());
