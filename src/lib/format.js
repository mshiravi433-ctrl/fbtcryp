/** Number / date formatting helpers shared by every screen. */

const nf = (opts) => new Intl.NumberFormat('en-US', opts);

/*
 * ─── EVERY FORMATTER COERCES FIRST, AND FAILS CLOSED TO '—' ─────────────────
 * These used to guard with `Number.isNaN(v)`, which is FALSE for a string:
 * `Number.isNaN('N/A')` is false, so the guard waved through anything that was
 * not literally the NaN value, and the next line called a Number METHOD on it.
 *
 * That is a crash, not a cosmetic one. `fmtPct('3.2')` throws
 * `TypeError: v.toFixed is not a function` during render, which on a routed
 * screen means RouteBoundary and the «مشکلی پیش اومده» card — the whole Signals
 * page gone because one upstream field arrived quoted. And the failure is not
 * hypothetical: providers disagree about types. CoinGecko sends numbers,
 * CoinLore sends `"percent_change_24h": "1.4"` as a string, DexScreener sends
 * strings for every numeric field, which is exactly why server/providers.js
 * wraps those in `Number(...)` while `normalizeCoin` passes CoinGecko's fields
 * through untouched. One un-normalized provider, or one proxy that quotes
 * numbers, and every screen showing that field dies.
 *
 * `'N/A'` and `''` are just as real: a feed that cannot measure a value often
 * sends a placeholder rather than null.
 *
 * So: coerce once, and a value that is not a finite number renders as '—'.
 * That is the same fail-closed rule the data layer follows — an unavailable
 * number is shown as unavailable, never as NaN, "$NaN", or an exception.
 */
function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtPrice(v) {
  const n = toNum(v);
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs < 0.00001) return n.toExponential(3);
  if (abs < 0.01) return nf({ maximumFractionDigits: 8 }).format(n);
  if (abs < 1) return nf({ maximumFractionDigits: 5 }).format(n);
  if (abs < 1000) return nf({ maximumFractionDigits: 2 }).format(n);
  return nf({ maximumFractionDigits: 0 }).format(n);
}

/*
 * ACTIVE DISPLAY SYMBOL.
 *
 * fmtUsd hardcoded `$`, so the currency selector in Settings changed a stored
 * value and nothing else - a user who picked EUR still read dollar signs over
 * dollar numbers.
 *
 * Formatting reads this module-level symbol rather than taking a prop, because
 * fmtUsd is called from ~40 call sites across pages, sheets and charts and
 * threading a currency argument through all of them would guarantee some get
 * missed - and a screen where SOME prices are converted is worse than one
 * where none are.
 *
 * The upstream feed does the actual conversion (`vs_currency`), so the number
 * is already in the chosen currency by the time it reaches here. This only
 * supplies the symbol; it never multiplies by a rate of its own, which would
 * silently drift out of date.
 */
let activeSymbol = '$';

export function setDisplaySymbol(symbol) {
  activeSymbol = symbol || '$';
}

/*
 * HIDE BALANCES.
 *
 * REAL BUG, and the same shape as the currency selector above: the Settings
 * toggle wrote `hideBalances`, Settings read it back to draw its own switch,
 * and NOTHING ELSE EVER LOOKED. Every balance, portfolio total and holding
 * stayed on screen. A user who flipped it before handing someone their phone
 * was told their figures were hidden when they were not — a privacy control
 * that lies is worse than no control, because it is relied upon.
 *
 * Masking lives here, at the formatter, for the same reason the currency
 * symbol does: these helpers are called from ~40 places, and a screen where
 * SOME numbers are masked leaks exactly the ones that were missed.
 *
 * ─── WHAT IS AND IS NOT MASKED ──────────────────────────────────────────────
 * Masked: money — fmtUsd, fmtCompact, fmtQty. These are "how much you have".
 *
 * NOT masked: fmtPrice and fmtPct. A market price is public information and
 * says nothing about the holder, and hiding percentages would make the charts
 * and the market list unreadable while protecting nothing. Hiding public data
 * would also train the user to switch the feature off.
 */
let hideAmounts = false;
const MASK = '•••';

export function setHideBalances(on) {
  hideAmounts = Boolean(on);
}

export function balancesHidden() {
  return hideAmounts;
}

/*
 * ─── WHY THERE IS A HOOK AS WELL AS A FLAG ──────────────────────────────────
 * Setting the module-level flag changes what fmtUsd RETURNS, but it does not
 * make React re-render anything. Wallet, Header and Market call the formatters
 * without subscribing to the settings store at all, so flipping the toggle
 * would have left the visible figures untouched until the user navigated away
 * and back.
 *
 * That is the same "looks wired, is not" failure the toggle already had, just
 * one layer deeper — and it is the version that is easy to ship because it
 * works when you test it by switching screens.
 *
 * `useHideBalances()` subscribes to the store so any screen showing money
 * re-renders the instant the switch moves. Screens call it for the
 * subscription; the formatters still read the flag.
 */

export function fmtUsd(v, opts = {}) {
  const n = toNum(v);
  if (n == null) return '—';
  if (hideAmounts) return MASK;
  return `${activeSymbol}${fmtPrice(n, opts)}`;
}

export function fmtCompact(v) {
  const n = toNum(v);
  if (n == null) return '—';
  if (hideAmounts) return MASK;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${activeSymbol}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${activeSymbol}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${activeSymbol}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${activeSymbol}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${activeSymbol}${abs.toFixed(2)}`;
}

export function fmtNum(v, digits = 0) {
  const n = toNum(v);
  if (n == null) return '—';
  return nf({ maximumFractionDigits: digits }).format(n);
}

export function fmtPct(v, digits = 2) {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function fmtQty(v) {
  const n = toNum(v);
  if (n == null) return '—';
  // A token quantity is a holding, so it is covered by the same promise the
  // fiat total makes. Leaving "12.4 BNB" visible next to a masked fiat value
  // would defeat the point.
  if (hideAmounts) return MASK;
  const abs = Math.abs(n);
  if (abs >= 1000) return nf({ maximumFractionDigits: 2 }).format(n);
  if (abs >= 1) return nf({ maximumFractionDigits: 4 }).format(n);
  return nf({ maximumFractionDigits: 8 }).format(n);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function timeAgo(ts, lang = 'en') {
  const s = Math.floor((Date.now() - ts) / 1000);
  const units = [
    [60, 's'],
    [3600, 'm'],
    [86400, 'h'],
    [Infinity, 'd']
  ];
  if (s < 60) return lang === 'fa' ? 'همین حالا' : 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
  void units;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
