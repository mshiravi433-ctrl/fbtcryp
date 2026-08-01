/**
 * THE PLATFORM FEE, IN ONE PLACE
 * ---------------------------------------------------------------------------
 * This lives in its own module — not inside `chains.js` — for one concrete
 * reason: `src/i18n/index.js` needs the number, and i18n is imported on the
 * very first line of the app. If i18n pulled it from `chains.js` it would drag
 * the entire chain + token registry into the entry chunk, undoing the code
 * splitting that keeps the first paint fast.
 *
 * `chains.js` re-exports `FEE_BPS` from here, so every existing import keeps
 * working and there is still exactly ONE source of truth for the rate.
 *
 * ─── WHY 70 BPS (0.70%) ─────────────────────────────────────────────────────
 * Measured against what wallets actually charge for the same job — routing a
 * swap to somebody else's liquidity:
 *
 *   MetaMask 0.875% · Phantom 0.85% · Rainbow 0.85% · Trust 0.70%
 *   ZenGo 0.50% · Rabby 0.25%
 *
 * We are an interface, not a DEX protocol, so Uniswap's 0.25% pool fee is the
 * wrong benchmark: that is the protocol's cut, not an interface's.
 *
 * ─── THE CAP IS NOT NEGOTIABLE ──────────────────────────────────────────────
 * Hard-limited to 100 bps (1%). A misconfigured environment variable must
 * never be able to quietly take 10% of someone's swap. Out-of-range values
 * fall back to the default rather than clamping silently, because a typo'd
 * 700 meaning 7.00% should not become 1.00% without anyone noticing.
 */

const FEE_BPS_DEFAULT = 70;
const FEE_BPS_MAX = 100;

function resolveFeeBps() {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FEE_BPS : undefined;
  if (raw == null || raw === '') return FEE_BPS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > FEE_BPS_MAX) {
    // Loud, because a silently-ignored fee setting is a silently-wrong invoice.
    // eslint-disable-next-line no-console
    console.warn(
      `[fee] VITE_FEE_BPS="${raw}" is invalid (want an integer 0-${FEE_BPS_MAX}); using ${FEE_BPS_DEFAULT}`
    );
    return FEE_BPS_DEFAULT;
  }
  return n;
}

export const FEE_BPS = resolveFeeBps();
export { FEE_BPS_MAX, FEE_BPS_DEFAULT };

/**
 * The fee as a human percentage string, e.g. "0.7".
 *
 * Trailing zeros are trimmed so 70 bps reads "0.7" and not "0.70", and 50 bps
 * reads "0.5". A whole percent reads "1", not "1.0".
 *
 * This is what gets interpolated into every `{{fee}}` placeholder in the
 * locale files. Before this existed, ten locales hard-coded "0.5%" in prose
 * while the engine charged 0.70% — the app was lying about its own price in
 * the terms the user has to accept, which is both a trust problem and a
 * store-rejection reason.
 */
export function feePercentString(bps = FEE_BPS) {
  return String(Number((bps / 100).toFixed(2)));
}

/** Persian/Arabic-Indic digits, for locales that render numerals that way. */
export function toEasternDigits(value, digits = '۰۱۲۳۴۵۶۷۸۹') {
  return String(value).replace(/\d/g, (d) => digits[Number(d)]);
}
