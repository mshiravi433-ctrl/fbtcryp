/**
 * FIAT BUY & SELL — ChangeNOW's on-ramp, and ONLY the on-ramp.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS WHEN THE SWAP INTEGRATION WAS DELETED ──────────────────
 * A previous version of this integration quoted ChangeNOW's CRYPTO-TO-CRYPTO
 * swap. That was a mistake and the owner caught it: «ما خودمون صرافی هستیم
 * نیاز به سواپ کسی نداریم». We run a swap. Advertising a competitor's swap on
 * our own screens hands over a user who has already arrived and already
 * trusts us, and it earned nothing.
 *
 * Fiat is the opposite case, and the distinction is the whole reason this
 * file exists:
 *
 *   SWAP (crypto → crypto)  — we do this ourselves, at 0.70%, on-chain.
 *                             Never route it elsewhere.
 *   FIAT (money → crypto)   — we do NOT do this and cannot: it needs a
 *                             licensed payment institution, card acquiring,
 *                             and a compliance stack. Sending a user to a
 *                             partner here competes with nothing of ours.
 *
 * So this module is deliberately incapable of quoting a crypto-to-crypto
 * pair. `assertFiatLeg` below enforces that, and a test asserts it, because
 * the easy mistake is to "just add" a crypto pair later and quietly re-create
 * the thing that was deleted.
 *
 * ─── OUR COMMISSION IS REAL HERE ────────────────────────────────────────────
 * Unlike the swap integration — where the fee was set to zero to avoid a
 * seizable balance — this one is meant to earn. The owner spoke to ChangeNOW
 * and confirmed the arrangement. `FIAT_FEE_PERCENT` is the rate, read from
 * the environment so it can be changed without a redeploy, clamped hard so a
 * misplaced digit cannot take 25% of somebody's purchase.
 *
 * ─── AND WHY IT IS OFF UNTIL THEY SWITCH IT ON ──────────────────────────────
 * From ChangeNOW's own partner FAQ, verbatim:
 *
 *   "Fiat buy and sell functionality is available upon request. For these
 *    operations, ChangeNOW works with Guardarian... The setup depends on your
 *    integration model, target regions, payment methods, and compliance
 *    requirements, so the exact flow is discussed individually with the
 *    ChangeNOW team before launch."
 *
 * Fiat is NOT part of the standard API key. It is enabled per-partner by
 * their team after a compliance conversation. So `fiatEnabled()` is a
 * separate switch from `fiatConfigured()`: having a key does not mean fiat
 * works, and reporting otherwise would produce a screen that looks live and
 * fails on every request.
 */

const CN_BASE = 'https://api.changenow.io/v2';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/**
 * The partner key. Server-side only.
 *
 * NOT `VITE_`: unlike a public referral code, this authenticates the account
 * and carries our commission settings. In a client bundle it could be lifted
 * and used to attribute someone else's volume, or exhausted against our rate
 * limit.
 */
const apiKey = () => process.env.CHANGENOW_API_KEY || '';

/** True when a key exists. Necessary for fiat, not sufficient — see below. */
export const fiatConfigured = () => Boolean(apiKey());

/**
 * True only when ChangeNOW have actually enabled fiat on the account.
 *
 * A deliberate second switch. Their fiat product is granted per-partner after
 * a compliance review, so a valid API key with fiat disabled returns errors on
 * every fiat call. Without this flag the screen would render, look ready, and
 * fail for every user — the "wired to nothing" failure this project has
 * already shipped twice.
 *
 * The owner sets `CHANGENOW_FIAT_ENABLED=true` only after their team confirms
 * it, and `/api/fiat/status` reports the truth either way.
 */
export const fiatEnabled = () =>
  Boolean(apiKey()) && process.env.CHANGENOW_FIAT_ENABLED === 'true';

/**
 * Our commission on fiat purchases, in percent.
 *
 * ─── CLAMPED, NOT TRUSTED ───────────────────────────────────────────────────
 * Read from the environment so the rate can be tuned without a deploy, but
 * hard-limited to 0–5%. A typo of `25` meaning "0.25" would otherwise take a
 * quarter of somebody's money, and on a fiat purchase that is a real bank
 * transaction that cannot be reversed. Out-of-range values fall back to the
 * default rather than clamping silently, so a mistake is visible in the logs
 * instead of quietly becoming 5%.
 */
const FIAT_FEE_DEFAULT = 1;
const FIAT_FEE_MAX = 5;

export function fiatFeePercent() {
  const raw = process.env.CHANGENOW_FIAT_FEE;
  if (raw == null || raw === '') return FIAT_FEE_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > FIAT_FEE_MAX) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fiat] CHANGENOW_FIAT_FEE="${raw}" is invalid (want 0-${FIAT_FEE_MAX}); using ${FIAT_FEE_DEFAULT}`
    );
    return FIAT_FEE_DEFAULT;
  }
  return n;
}

/**
 * Fiat currencies we offer.
 *
 * ─── WHY THE RIAL IS NOT HERE, AND CANNOT BE ────────────────────────────────
 * IRR is absent because no international payment processor settles it. Visa,
 * Mastercard and Amex have been severed from Iran's banking system at the
 * network level since 2012 and OFAC's Iran program (reviewed January 2026)
 * shows no change. An Iranian bank card cannot authorise a foreign crypto
 * purchase — that is a property of the card networks, not a setting.
 *
 * Listing IRR would produce a button that fails for every user who taps it,
 * which is exactly the class of dead button the Buy screen was rebuilt to
 * remove. The screen says this plainly instead of pretending.
 */
export const FIAT_CURRENCIES = [
  { code: 'usd', symbol: '$', name: 'US Dollar' },
  { code: 'eur', symbol: '€', name: 'Euro' },
  { code: 'gbp', symbol: '£', name: 'British Pound' },
  { code: 'try', symbol: '₺', name: 'Turkish Lira' },
  { code: 'aed', symbol: 'AED', name: 'UAE Dirham' }
];

/**
 * Crypto the user can buy or sell, keyed by ChangeNOW's ticker.
 *
 * Small on purpose. These are the assets our own app can then do something
 * useful with — the point of the on-ramp is to get somebody INTO the app with
 * something swappable, not to be a shop window for a thousand tokens.
 */
export const FIAT_CRYPTO = [
  { ticker: 'btc', symbol: 'BTC', name: 'Bitcoin' },
  { ticker: 'eth', symbol: 'ETH', name: 'Ethereum' },
  { ticker: 'usdttrc20', symbol: 'USDT', name: 'Tether (TRON)' },
  { ticker: 'usdtbsc', symbol: 'USDT', name: 'Tether (BNB Chain)' },
  { ticker: 'usdcbsc', symbol: 'USDC', name: 'USD Coin (BNB Chain)' },
  { ticker: 'bnbbsc', symbol: 'BNB', name: 'BNB' },
  { ticker: 'sol', symbol: 'SOL', name: 'Solana' }
];

const FIATS = new Set(FIAT_CURRENCIES.map((c) => c.code));
const CRYPTOS = new Set(FIAT_CRYPTO.map((c) => c.ticker));

/**
 * Exactly one side must be fiat. This is the guard that keeps the module
 * honest.
 *
 * ─── THE MISTAKE THIS PREVENTS ──────────────────────────────────────────────
 * Without it, `btc → eth` would be a valid request and this file would
 * silently become the crypto-swap integration that was deleted for competing
 * with our own product. The check is cheap; the mistake is expensive and easy
 * to make by "just adding one pair".
 */
export function assertFiatLeg(from, to) {
  const fromFiat = FIATS.has(from);
  const toFiat = FIATS.has(to);
  const fromCrypto = CRYPTOS.has(from);
  const toCrypto = CRYPTOS.has(to);

  /* Buy: fiat → crypto. Sell: crypto → fiat. Nothing else. */
  if (fromFiat && toCrypto) return 'buy';
  if (fromCrypto && toFiat) return 'sell';
  return null;
}

async function cnFetch(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { accept: 'application/json' };
    const k = apiKey();
    if (k) headers['x-changenow-api-key'] = k;

    const res = await fetch(`${CN_BASE}${path}`, { headers, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/fiat/quote — what would this money buy?
 *
 * Returns null for the estimate rather than 0 when the pair cannot be priced.
 * Zero would render as a real answer meaning "you get nothing", and on a
 * purchase screen that is the difference between a user waiting and a user
 * concluding the app is broken.
 */
export async function fiatQuote({ from, to, amount }) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();

  const direction = assertFiatLeg(f, t);
  if (!direction) return { ok: false, status: 400, body: { error: 'NOT_A_FIAT_PAIR' } };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }

  if (!fiatEnabled()) {
    /*
     * Named, not a bare 401 passed through. "FIAT_NOT_ENABLED" tells the UI
     * to show a specific explanation; a raw upstream error would look like a
     * bug in our app rather than a setting on their side.
     */
    return { ok: false, status: 503, body: { error: 'FIAT_NOT_ENABLED' } };
  }

  const qs = new URLSearchParams({
    fromCurrency: f,
    toCurrency: t,
    fromAmount: String(amt),
    flow: 'standard',
    type: 'direct'
  });

  const res = await cnFetch(`/exchange/estimated-amount?${qs}`);
  if (!res.ok) {
    return { ok: false, status: res.status, body: { error: 'QUOTE_FAILED', detail: res.body?.message ?? null } };
  }

  const estimated = Number(res.body?.toAmount);
  const fee = fiatFeePercent();

  return {
    ok: true,
    status: 200,
    body: {
      direction,
      from: f,
      to: t,
      amount: amt,
      estimatedAmount: Number.isFinite(estimated) ? estimated : null,
      /*
       * Our cut, stated as a number rather than buried in the rate. A fee the
       * user discovers afterwards is the kind that makes them distrust every
       * other figure on the screen — the same rule the swap screen follows.
       */
      ourFeePercent: fee,
      /* Their own minimum, when the API reports one. */
      minAmount: Number.isFinite(Number(res.body?.minAmount)) ? Number(res.body.minAmount) : null
    }
  };
}

/** GET /api/fiat/status — what this integration can actually do today. */
export function fiatStatus() {
  return {
    keySet: fiatConfigured(),
    /*
     * The honest signal. A key alone does not make fiat work: ChangeNOW
     * enable it per-partner after a compliance review, so this stays false
     * until the owner confirms they have switched it on.
     */
    enabled: fiatEnabled(),
    ourFeePercent: fiatFeePercent(),
    /* Stated so the UI can never imply we route crypto-to-crypto here. */
    fiatOnly: true,
    currencies: FIAT_CURRENCIES.length,
    assets: FIAT_CRYPTO.length
  };
}
