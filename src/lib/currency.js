/**
 * DISPLAY CURRENCY.
 *
 * ─── USD-ONLY ON PURPOSE ────────────────────────────────────────────────────
 * Settings used to expose a multi-currency picker (USD / EUR / IRT / AED /
 * GBP / TRY / CNY / INR / RUB). The picker looked live but did nothing on
 * most screens: every price was formatted by `fmtUsd`, which hardcoded `$`,
 * and only the chain-aware portfolio hook (which sends `vs_currency` to
 * CoinGecko) actually converted upstream.
 *
 * The owner asked us to drop the picker entirely and keep USD as the only
 * display currency. That removes the implicit lie — a euro/aed label sitting
 * over a dollar number — and makes every screen agree with every other.
 *
 * If we ever re-add a multi-currency picker, the upstream conversion has to
 * be wired through `fmtUsd` / `fmtCompact` / `fmtPrice` first, otherwise we
 * are back to the same bug.
 */

const USD = Object.freeze({
  id: 'usd',
  code: 'USD',
  symbol: '$',
  name: 'US Dollar'
});

/** Supported display currencies. USD only, by owner decision. */
export const CURRENCIES = Object.freeze([USD]);

const DEFAULT = USD;

/**
 * Resolve a stored code to a currency.
 *
 * Falls back to USD for anything unknown — including the legacy `IRT` /
 * `EUR` / `AED` / … values still sitting in the store of installs that
 * picked them before the picker was removed. Without this they would render
 * `undefined` beside every price after the upgrade.
 */
export function currencyOf(code) {
  if (!code) return DEFAULT;
  const want = String(code).toUpperCase();
  if (want === USD.code) return USD;
  return DEFAULT;
}

/** The `vs_currency` value to send upstream. Always `usd`. */
export const vsOf = (_code) => USD.id;

/** True when a stored preference is no longer supported. */
export const isLegacyCurrency = (code) =>
  Boolean(code) && String(code).toUpperCase() !== USD.code;
