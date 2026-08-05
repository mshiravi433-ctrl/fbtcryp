/**
 * NATIVE-COIN SWAPS — ChangeNOW quotes, read-only and keyless.
 * ---------------------------------------------------------------------------
 * ─── THE HOLE THIS FILLS ────────────────────────────────────────────────────
 * This app is EVM + Solana. The bridge covers seven EVM chains and
 * stablecoins. There is no native Bitcoin anywhere in it — the "BTC" a user
 * sees is BTCB, WBTC or cbBTC, all of them WRAPPED tokens living on an EVM
 * chain.
 *
 * So somebody holding real bitcoin, on the Bitcoin network, can do nothing
 * here at all. Same for Litecoin, Dogecoin, XRP, Monero. That is a large
 * category of user who opens the app, finds their coin is not really
 * supported, and leaves. ChangeNOW is genuinely the right shape for that gap:
 * 1,500+ assets, non-custodial, cross-chain, and — verified live — 0.5 BTC
 * quotes to 31,866 USDT on BNB Chain in a single keyless call.
 *
 * ─── WHY THIS MODULE IS DELIBERATELY READ-ONLY ──────────────────────────────
 * This is the part that matters and it is not a technical limitation, it is a
 * decision made after reading their Terms of Service (last updated
 * 2026-07-28). Two clauses decide it.
 *
 * §11.1 — a user must not be "located in, or ... a citizen or resident of the
 *   United Kingdom, the United States of America, or a country subject to
 *   United Nations Sanctions Lists AND THEIR EQUIVALENT". OFAC is the
 *   standard "equivalent", and Iran is on it — which is most of this app's
 *   users and its owner.
 *
 * §11.4 — verbatim: "ChangeNOW may seize any funds from the Users in these
 *   jurisdictions and donate them to a charity at ChangeNOW's sole
 *   discretion."
 *
 * §11.6 — they read the IP address and may refuse service on it.
 *
 * An affiliate integration means an accruing balance held by them, in the
 * owner's name, from a jurisdiction their own terms exclude. §11.4 says
 * plainly what can happen to it. So this module NEVER creates an exchange,
 * never handles an address, never moves a coin and never accrues anything.
 * It asks three public questions — what coins exist, what is the minimum,
 * what would I get — and shows the answer.
 *
 * There is nothing here to seize, and a user who is refused finds out from a
 * quote screen rather than from a transaction that already left their wallet.
 *
 * ─── THE API KEY IS OPTIONAL AND CHANGES NOTHING HERE ───────────────────────
 * These three endpoints are public. A key raises rate limits and is what
 * attributes commission on exchanges we do not create. It is read from the
 * environment if present, and its absence is a supported, tested state —
 * exactly like the Jupiter referral and the GMX code.
 */

const CN_BASE = 'https://api.changenow.io/v1';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/**
 * Optional. Never required by anything in this file.
 *
 * NOT a `VITE_` variable: unlike the GMX referral code, this one is a real
 * credential — it identifies the account and raises rate limits, so it must
 * stay server-side.
 */
const apiKey = () => process.env.CHANGENOW_API_KEY || '';

export const changenowConfigured = () => Boolean(apiKey());

/**
 * OUR COMMISSION RATE ON CHANGENOW. ZERO, AND THAT IS THE POINT.
 *
 * ─── WHY WE GIVE UP THE 0.4% ────────────────────────────────────────────────
 * The owner's condition, after speaking to their support, was exactly right:
 * build it with a warning, but **no money of ours may sit with them**.
 *
 * That condition cannot be met by taking the commission, and the arithmetic
 * is why. Their affiliate balance has a MINIMUM WITHDRAWAL — their own pages
 * quote it inconsistently as "approximately $100", "about $100 in crypto",
 * 0.002 BTC and 0.01 BTC depending on which page you read. Every one of those
 * is far above zero, and there is no per-swap payout setting.
 *
 * At 0.4%, reaching even the smallest of those thresholds needs roughly
 * $25,000 of user volume. So a balance would NECESSARILY sit in their account
 * for months — in the owner's name, from a jurisdiction their §11.1 excludes,
 * under a §11.4 that lets them seize it. "Nothing stays with them" and "take
 * the commission" are mutually exclusive here.
 *
 * So the fee is zero. Nothing accrues, so there is nothing to seize, and the
 * user gets a better rate than going to ChangeNOW directly.
 *
 * ─── WHERE THE REVENUE ACTUALLY COMES FROM ──────────────────────────────────
 * This screen exists to move someone from a chain we cannot touch onto one we
 * can. Once their USDT lands on BNB Chain, every swap they make is ours at
 * 0.70% — on-chain, in their own wallet, where nobody can freeze it. We earn
 * from the second step, not the first, and the second step is the safe one.
 *
 * Changing this to a non-zero value re-creates the seizable balance. Do not,
 * unless the withdrawal threshold has genuinely gone to zero.
 */
export const OUR_FEE_PERCENT = 0;

/**
 * Coins we offer, and only these.
 *
 * ─── AN ALLOW-LIST, FOR THE SAME REASON AS EVERYWHERE ELSE ──────────────────
 * ChangeNOW lists 1,500+ assets. Exposing all of them would put obscure and
 * abandoned tokens in front of users with no way to judge them, and their own
 * terms (§6.13) warn that fake tokens mimicking real projects are common
 * enough to need a policy.
 *
 * These are the ones that answer the actual question — "my coin is not an
 * EVM token, can I use this app?" — and every one is a top-tier asset on its
 * own native chain that this app otherwise cannot touch at all.
 *
 * `ticker` values are ChangeNOW's, taken from a live /currencies response
 * rather than guessed. `usdtbsc` is not a typo and neither is `usdterc20`:
 * the same asset on different chains is a different ticker, and getting one
 * wrong produces a quote for the wrong network — money sent to a chain the
 * user cannot reach.
 */
export const NATIVE_COINS = [
  { ticker: 'btc', name: 'Bitcoin', symbol: 'BTC', coingeckoId: 'bitcoin' },
  { ticker: 'ltc', name: 'Litecoin', symbol: 'LTC', coingeckoId: 'litecoin' },
  { ticker: 'doge', name: 'Dogecoin', symbol: 'DOGE', coingeckoId: 'dogecoin' },
  { ticker: 'xrp', name: 'XRP', symbol: 'XRP', coingeckoId: 'ripple' },
  { ticker: 'trx', name: 'Tron', symbol: 'TRX', coingeckoId: 'tron' },
  { ticker: 'ada', name: 'Cardano', symbol: 'ADA', coingeckoId: 'cardano' },
  { ticker: 'dot', name: 'Polkadot', symbol: 'DOT', coingeckoId: 'polkadot' },
  { ticker: 'atom', name: 'Cosmos', symbol: 'ATOM', coingeckoId: 'cosmos' }
];

/**
 * Where those coins can land: assets this app can actually use afterwards.
 *
 * The whole point is to get someone OUT of a chain we do not support and INTO
 * one we do. Offering an arbitrary destination would defeat that — a user
 * swapping BTC for ADA is no better off here than before.
 */
export const DESTINATIONS = [
  { ticker: 'usdtbsc', name: 'USDT (BNB Chain)', symbol: 'USDT', chainId: 56 },
  { ticker: 'usdterc20', name: 'USDT (Ethereum)', symbol: 'USDT', chainId: 1 },
  { ticker: 'usdtarb', name: 'USDT (Arbitrum)', symbol: 'USDT', chainId: 42161 },
  { ticker: 'usdtsol', name: 'USDT (Solana)', symbol: 'USDT', chainId: null },
  { ticker: 'bnbbsc', name: 'BNB', symbol: 'BNB', chainId: 56 },
  { ticker: 'eth', name: 'Ethereum', symbol: 'ETH', chainId: 1 },
  { ticker: 'sol', name: 'Solana', symbol: 'SOL', chainId: null }
];

const TICKERS = new Set([...NATIVE_COINS, ...DESTINATIONS].map((c) => c.ticker));

/** Is this a pair we are willing to quote? */
export function isAllowedPair(from, to) {
  if (!TICKERS.has(from) || !TICKERS.has(to)) return false;
  if (from === to) return false;
  /*
   * The FROM side must be a native coin. This endpoint exists to solve
   * "my coin is not on an EVM chain"; quoting EVM→EVM would route a swap we
   * already do ourselves at 0.70%, through a third party, for less.
   */
  return NATIVE_COINS.some((c) => c.ticker === from);
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
 * GET /api/crosschain/quote
 *
 * Two upstream calls: the minimum for the pair, and the estimate for the
 * amount. Both are public.
 *
 * ─── WHY THE MINIMUM IS FETCHED EVEN WHEN THE AMOUNT IS FINE ────────────────
 * Sending below the minimum is the single most common way to lose money on a
 * service like this: the deposit arrives, cannot be processed, and recovering
 * it costs a $50 fee under their §6.16. Showing the minimum BEFORE anyone
 * moves anything is the most useful thing this screen does, so it is never
 * skipped as an optimisation.
 */
export async function crosschainQuote({ from, to, amount }) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();

  if (!isAllowedPair(f, t)) return { ok: false, status: 400, body: { error: 'BAD_PAIR' } };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }

  const pair = `${f}_${t}`;
  const [minRes, estRes] = await Promise.all([
    cnFetch(`/min-amount/${pair}`),
    cnFetch(`/exchange-amount/${encodeURIComponent(amt)}/${pair}`)
  ]);

  const minAmount = Number(minRes.body?.minAmount);
  const estimated = Number(estRes.body?.estimatedAmount);

  /*
   * A pair can be listed and still be temporarily unquotable. Returning null
   * rather than 0 keeps "we do not know" distinct from "you would get
   * nothing" — the same rule the funding and yield modules follow, and the
   * one place a zero would be read as a real number.
   */
  return {
    ok: true,
    status: 200,
    body: {
      from: f,
      to: t,
      amount: amt,
      estimatedAmount: Number.isFinite(estimated) ? estimated : null,
      minAmount: Number.isFinite(minAmount) ? minAmount : null,
      belowMinimum: Number.isFinite(minAmount) ? amt < minAmount : null,
      /* Their own forecast, in minutes, as a string like "10-60". */
      etaMinutes: estRes.body?.transactionSpeedForecast ?? null,
      warning: estRes.body?.warningMessage ?? null,
      /*
       * Reported so the UI can be honest about what this screen is. We do not
       * create the exchange; the user finishes it on ChangeNOW's own site,
       * where their jurisdiction rules apply.
       */
      quoteOnly: true
    }
  };
}

/** GET /api/crosschain/status — what this integration can and cannot do. */
export function crosschainStatus() {
  return {
    /* Quotes work with no key at all; this only reports whether one is set. */
    keySet: changenowConfigured(),
    quoteOnly: true,
    /*
     * Reported so the UI can state it and a test can assert it. Zero means no
     * balance ever accrues in a ChangeNOW account, which is the owner's
     * explicit condition — see OUR_FEE_PERCENT for why taking the 0.4% would
     * break it.
     */
    ourFeePercent: OUR_FEE_PERCENT,
    noBalanceHeld: OUR_FEE_PERCENT === 0,
    coins: NATIVE_COINS.length,
    destinations: DESTINATIONS.length
  };
}
