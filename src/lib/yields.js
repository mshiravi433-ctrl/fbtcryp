/**
 * YIELD DATA — client side.
 * ---------------------------------------------------------------------------
 * Thin. All the filtering happens in `server/yields.js`, because the upstream
 * response is 20,000+ pools and several megabytes and must never reach a
 * phone. This module fetches our filtered slice, degrades honestly when the
 * backend is unreachable, and holds the maths the UI needs.
 *
 * ─── WHY THERE IS NO OFFLINE FALLBACK LIST ──────────────────────────────────
 * Every other data module in this app falls back to a bundled snapshot so the
 * UI is never blank. This one deliberately does not.
 *
 * A stale price is a small lie that corrects itself on the next refresh. A
 * stale APY is a different thing: yields move on the scale of days, a pool can
 * be paused or drained, and someone deciding where to put money based on a
 * number baked into an APK three months ago is exactly the harm this screen
 * exists to prevent. When we cannot fetch live rates, the correct output is
 * "we cannot show you rates right now", not a plausible-looking table.
 */

import { TOKENS } from './chains';
import { getTokensSync } from './tokenLists';
import { LST_ASSETS, EQUITY_ASSETS, COMMODITY_ASSETS } from './solanaAssets';
import { SOLANA_SIGNAL_ASSETS } from './solanaSignals';
import { SOL_MINT, USDC_MINT, USDT_MINT } from './solana';

import { apiBase } from './apiBase.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

/** Risk bands, ordered least to most. Exported so the filter UI cannot drift. */
export const RISK_BANDS = ['low', 'medium', 'high'];

/**
 * How much of the headline yield is real revenue rather than token emissions.
 *
 * ─── WHY THIS IS THE MOST IMPORTANT NUMBER ON THE SCREEN ────────────────────
 * `apyBase` is interest actually paid by borrowers and fees actually paid by
 * traders. `apyReward` is governance tokens minted and handed out. The second
 * kind stops the day the incentive programme ends, and those tokens are
 * usually falling in price the entire time they are being earned.
 *
 * Every yield aggregator shows the combined number and buries the split. A
 * "24% APY" that is 22% emissions is a countdown, not an income, and the user
 * has no way to tell the two apart from the headline.
 *
 * Returns null rather than a guess when the feed did not break the yield down
 * — an unknown split must not be rendered as "100% real".
 */
export function realShare(pool) {
  if (
    !pool || pool.apyBase == null || pool.apyBase === '' || typeof pool.apyBase === 'boolean' ||
    pool.apy == null || pool.apy === '' || typeof pool.apy === 'boolean'
  ) return null;
  const apy = Number(pool.apy);
  const base = Number(pool.apyBase);
  if (!Number.isFinite(apy) || apy <= 0 || !Number.isFinite(base)) return null;
  return Math.max(0, Math.min(1, base / apy));
}

/**
 * Is today's rate unusual for this pool?
 *
 * A pool showing 40% today with a 30-day mean of 6% is not a 40% pool, and
 * somebody deciding on the strength of the headline is deciding on a spike
 * that will be gone by the time their deposit confirms.
 *
 * The threshold is a ratio rather than a fixed gap so it works the same on a
 * 3% pool and a 30% one. Returns null when there is no mean to compare
 * against, which the UI renders as nothing rather than as "normal".
 */
export function rateIsUnusual(pool, factor = 1.6) {
  if (
    pool?.apy == null || pool?.apy === '' || typeof pool?.apy === 'boolean' ||
    pool?.apyMean30d == null || pool?.apyMean30d === '' || typeof pool?.apyMean30d === 'boolean'
  ) return null;
  const apy = Number(pool.apy);
  const mean = Number(pool.apyMean30d);
  if (!Number.isFinite(apy) || !Number.isFinite(mean) || mean <= 0) return null;
  const ratio = apy / mean;
  if (ratio >= factor) return { direction: 'above', ratio: Math.round(ratio * 10) / 10, mean };
  if (ratio <= 1 / factor) return { direction: 'below', ratio: Math.round(ratio * 10) / 10, mean };
  return null;
}

/**
 * What two tokens does an LP pair need?
 *
 * DefiLlama's `symbol` is "CAKE-BNB" for a pair and "STETH" for a single
 * asset. Splitting on the hyphen is what lets the UI offer "get the tokens" —
 * you cannot enter a CAKE-BNB pool without holding both.
 *
 * Returns an empty array for single-asset pools, which is correct: there is
 * nothing to pair up.
 */
export function pairTokens(pool) {
  const sym = String(pool?.symbol ?? '').trim();
  if (!sym || pool?.exposure === 'single') return [];
  const parts = sym.split(/[-/]/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2) : [];
}

/**
 * DefiLlama chain labels → our EVM chain ids. Unknown chains stay null so
 * Farm never invents a swap the registry cannot fill.
 *
 * Solana is NOT an EVM chain, so it maps to 0 — a sentinel meaning "a chain
 * this app supports that is not in the EVM registry". `pairSwapRoute` handles
 * it in its own branch and never feeds 0 to the registry; and the EVM path's
 * `!chainId` guard treats 0 as "not an EVM id", so no code can accidentally
 * build a `/swap?chain=0` route. (The old value was null, which made Solana
 * pools look like unknown chains even though the server's ALLOWED_CHAINS
 * already lists them.)
 */
const LLAMA_CHAIN_IDS = {
  ethereum: 1,
  eth: 1,
  bsc: 56,
  binance: 56,
  'binance smart chain': 56,
  polygon: 137,
  matic: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  avax: 43114,
  linea: 59144,
  sonic: 146,
  solana: 0
};

export function llamaChainId(chain) {
  const key = String(chain ?? '').trim().toLowerCase();
  return key in LLAMA_CHAIN_IDS ? LLAMA_CHAIN_IDS[key] : null;
}

/**
 * symbol → mint, from the mint-VERIFIED lists only.
 *
 * ─── WHY THIS UNION AND NOTHING ELSE ────────────────────────────────────────
 * A "get the pair" button that lands on a mint we did not verify is a
 * dead swap with extra steps — on Solana, a plausible-looking base58 string
 * is a stranger's token. So the only symbols that can ever resolve are the
 * ones with a mint verified by hand against the issuer's own authority:
 *
 *   • lib/solanaAssets.js — LSTs, xStocks, tokenized gold (issuer-checked)
 *   • lib/solanaSignals.js — the seven signal mints (authority-checked)
 *   • lib/solana.js — the three base mints every Solana flow is built on
 *
 * `WSOL` is an alias, not a guess: it is the on-chain symbol of the wrapped
 * SOL mint that SolanaSwap and Jupiter use everywhere in this codebase.
 * Anything not in these lists (e.g. "WSOL" of some bridge, "USDC.e", a
 * pump.fun clone) resolves to null, and the pool keeps its honest external
 * link instead of getting a button that cannot be trusted.
 */
const SOLANA_SYMBOL_MINTS = (() => {
  const m = new Map();
  const add = (symbol, mint) => {
    const k = String(symbol ?? '').trim().toUpperCase();
    if (k && !m.has(k)) m.set(k, mint);
  };
  for (const a of [...LST_ASSETS, ...EQUITY_ASSETS, ...COMMODITY_ASSETS]) add(a.symbol, a.mint);
  for (const a of SOLANA_SIGNAL_ASSETS) add(a.symbol, a.mint);
  add('SOL', SOL_MINT);
  add('WSOL', SOL_MINT);
  add('USDC', USDC_MINT);
  add('USDT', USDT_MINT);
  return m;
})();

function solanaMintFor(symbol) {
  return SOLANA_SYMBOL_MINTS.get(String(symbol ?? '').trim().toUpperCase()) ?? null;
}

/**
 * Symbols the feed spells differently from our registry, for the SAME asset.
 *
 * ─── WHY THIS MAP IS SHORT ON PURPOSE ───────────────────────────────────────
 * Every entry here must be the same underlying asset under a different
 * spelling: a wrapped↔native pair (the router wraps automatically, so ETH and
 * WETH are the same liquidity) or a rename (MATIC became POL). Anything else
 * is a DIFFERENT token and must stay unresolved:
 *
 *   • USDC.e / USDbC are NOT USDC — different contracts, different issuers.
 *   • BTCB (Binance-pegged) is NOT WBTC — different custodians.
 *   • wstETH is NOT stETH — different contracts, different mechanics.
 *
 * Aliasing any of those would prefill a swap into the wrong token, which is
 * worse than no button at all. When in doubt this map says nothing and the
 * pool keeps its honest pool-page link.
 */
const EQUIVALENT_SYMBOLS = {
  ETH: ['WETH'],
  WETH: ['ETH'],
  BNB: ['WBNB'],
  WBNB: ['BNB'],
  AVAX: ['WAVAX'],
  WAVAX: ['AVAX'],
  MATIC: ['WMATIC', 'POL', 'WPOL'],
  WMATIC: ['MATIC', 'POL', 'WPOL'],
  POL: ['WPOL', 'MATIC', 'WMATIC'],
  WPOL: ['POL', 'MATIC', 'WMATIC'],
  S: ['WS'],
  WS: ['S']
};

/**
 * Verified tokens already understood by the Swap screen.
 *
 * Farm previously looked only at the small `TOKENS` registry even though the
 * app ships a much larger, hand-checked baseline in tokenLists. That made a
 * large number of legitimate pairs look action-less. Remote list entries are
 * deliberately excluded here: an automatic handoff must never choose one of
 * two same-symbol, unverified contracts by ticker alone.
 */
const ROUTE_TOKEN_LOOKUPS = new WeakMap();

function routeTokenData(chainId) {
  const source = getTokensSync(chainId) ?? [];
  const cached = ROUTE_TOKEN_LOOKUPS.get(source);
  if (cached) return cached;
  const verified = source.filter((token) => token?.verified);
  const list = verified.length ? verified : (TOKENS[chainId] ?? []);
  const bySymbol = new Map();
  let native = null;
  for (const token of list) {
    const key = String(token?.symbol ?? '').trim().toUpperCase();
    if (key && !bySymbol.has(key)) bySymbol.set(key, token);
    if (!native && token?.native) native = token;
  }
  const data = { list, bySymbol, native };
  ROUTE_TOKEN_LOOKUPS.set(source, data);
  return data;
}

function tokenOnChain(chainId, symbol) {
  const { bySymbol } = routeTokenData(chainId);
  const want = String(symbol ?? '').trim().toUpperCase();
  if (!want || bySymbol.size === 0) return null;
  const exact = bySymbol.get(want);
  if (exact) return exact;
  /* Same asset, different spelling — wrapped/native pairs and renames only. */
  for (const alt of EQUIVALENT_SYMBOLS[want] ?? []) {
    const hit = bySymbol.get(alt);
    if (hit) return hit;
  }
  return null;
}

function paymentTokenFor(chainId, target) {
  const { list, bySymbol, native } = routeTokenData(chainId);
  const targetUp = String(target?.symbol ?? '').toUpperCase();
  for (const stable of ['USDC', 'USDT', 'DAI']) {
    const hit = bySymbol.get(stable);
    if (hit && String(hit.symbol).toUpperCase() !== targetUp) return hit;
  }
  if (native && String(native.symbol).toUpperCase() !== targetUp) return native;
  return list.find((token) => String(token.symbol).toUpperCase() !== targetUp) ?? null;
}

/* Symbols are safe only for the small curated registry consumed by Swap's
   symbol-prefill path. A bundled-baseline token travels by its verified
   contract address instead, which is precisely what Swap's address handoff
   is for and avoids a same-ticker clone being selected. */
function isCoreSwapToken(chainId, token) {
  const core = TOKENS[chainId] ?? [];
  return core.some((entry) => token?.native
    ? entry.native && entry.symbol === token.symbol
    : String(entry.address ?? '').toLowerCase() === String(token?.address ?? '').toLowerCase());
}

function evmAcquisitionRoute(chainId, target) {
  const payment = paymentTokenFor(chainId, target);
  if (!payment || !target) return null;
  return {
    chainId,
    from: payment.symbol,
    to: target.symbol,
    fromAddress: !payment.native && !isCoreSwapToken(chainId, payment) ? payment.address : undefined,
    toAddress: !target.native && !isCoreSwapToken(chainId, target) ? target.address : undefined,
    single: true
  };
}

/**
 * Where "get the pair" leads, or null.
 *
 * EVM: both legs must exist in OUR token registry on that chain — a button
 * that lands on a missing ticker is a dead swap.
 *
 * Solana: the registry is meaningless there, so both legs must instead
 * resolve against the mint-verified lists (see SOLANA_SYMBOL_MINTS). The
 * route goes to /solana — never /swap — with `toMint` set to the leg the
 * user does NOT already hold in the base asset: SolanaSwap's `?toMint=`
 * honours exactly one verified mint and pre-fills the order, and the swap
 * screen remains fully interactive from there. When EITHER leg is
 * unresolvable the answer is null, and the pool keeps its external
 * DefiLlama link — the same honest behaviour as an unresolvable EVM pair.
 */
export function pairSwapRoute(pool) {
  const pair = pairTokens(pool);
  if (pair.length !== 2) return null;

  if (String(pool?.chain ?? '').trim().toLowerCase() === 'solana') {
    const mintA = solanaMintFor(pair[0]);
    const mintB = solanaMintFor(pair[1]);
    if (!mintA || !mintB) return null;
    const isBase = (mint) => mint === SOL_MINT || mint === USDC_MINT || mint === USDT_MINT;
    /* The non-base leg is the one to swap INTO. When both legs are base
       (e.g. a SOL-USDC pool) there is nothing interesting to target, so the
       second leg is the honest default. */
    const toMint = !isBase(mintA) && isBase(mintB) ? mintA : mintB;
    const legRoute = (symbol, mint, pairLeg) => {
      const fromMint = mint === USDC_MINT ? SOL_MINT : USDC_MINT;
      return {
        kind: 'solana',
        from: fromMint === SOL_MINT ? 'SOL' : 'USDC',
        to: symbol,
        fromMint,
        toMint: mint,
        single: true,
        pairLeg
      };
    };
    return {
      kind: 'solana', from: pair[0], to: pair[1], toMint,
      legRoutes: [legRoute(pair[0], mintA, 0), legRoute(pair[1], mintB, 1)]
    };
  }

  const chainId = llamaChainId(pool?.chain);
  if (!chainId) return null;
  const legA = tokenOnChain(chainId, pair[0]);
  const legB = tokenOnChain(chainId, pair[1]);
  if (!legA || !legB) return null;
  const legRoutes = [evmAcquisitionRoute(chainId, legA), evmAcquisitionRoute(chainId, legB)];
  if (legRoutes.some((route) => !route)) return null;
  /*
   * Registry symbols, not feed spellings. The swap screen resolves `from`/`to`
   * against its curated list case-sensitively, so a feed spelling of "WETH"
   * resolving to our "ETH" entry must travel as "ETH" — echoing the feed
   * string would prefill a leg the swap screen cannot select.
   */
  return { chainId, from: legA.symbol, to: legB.symbol, legRoutes };
}

/**
 * The ONE token a single-asset pool needs, or null.
 *
 * Most of the Farm screen is single-asset pools — Aave USDC, Lido stETH,
 * Marinade mSOL — and for every one of them `pairTokens` correctly returns
 * nothing. But "no pair" is not "no investment path": the depositor still
 * needs exactly one token, and when our swap lists it the honest UI is a
 * button that prefills that purchase. A pair symbol is never a single token,
 * even when the feed forgot to set `exposure`.
 */
export function singleToken(pool) {
  if (!pool || pairTokens(pool).length > 0) return null;
  const sym = String(pool?.symbol ?? '').trim();
  return sym || null;
}

/**
 * Where "get the token" leads for a single-asset pool, or null.
 *
 * EVM: the token must exist in OUR registry on that chain (aliases included),
 * and the payment leg is picked for the user — a stablecoin first, the native
 * coin as fallback, never the token itself (a USDC pool prefills USDT→USDC,
 * not USDC→USDC).
 *
 * Solana: the symbol must resolve against the mint-verified lists, exactly
 * like a pair leg. The one exception is USDC itself: the Solana swap pays
 * with USDC by default, so a USDC-single pool would prefill USDC→USDC — a
 * form that looks broken. It returns null and keeps the pool-page link; SOL
 * and USDT singles still route, because USDC→SOL and USDC→USDT are real.
 */
export function singleSwapRoute(pool) {
  const sym = singleToken(pool);
  if (!sym) return null;

  if (String(pool?.chain ?? '').trim().toLowerCase() === 'solana') {
    const mint = solanaMintFor(sym);
    if (!mint || mint === USDC_MINT) return null;
    return { kind: 'solana', from: sym, to: sym, toMint: mint, single: true };
  }

  const chainId = llamaChainId(pool?.chain);
  if (!chainId) return null;
  const entry = tokenOnChain(chainId, sym);
  if (!entry) return null;
  return evmAcquisitionRoute(chainId, entry);
}

/**
 * The in-app investment path for ANY pool: the pair route for LP pools, the
 * single-token route for staking/lending pools, null when neither leg is
 * something our swap can actually buy. One function so the card, the details
 * panel and the availability flags can never disagree.
 */
export function investRoute(pool) {
  return pairSwapRoute(pool) ?? singleSwapRoute(pool);
}

/**
 * What this pool would pay on a given deposit, for one year, at today's rate.
 *
 * ─── WHY A CALCULATOR AND WHY IT IS PHRASED THIS WAY ────────────────────────
 * "12.4% APY" means nothing to most people. "$1,000 would earn about $124 a
 * year, if the rate never changed" means something immediately, and the
 * conditional is the honest half of the sentence — variable rates never stay
 * still, and this is the number people quietly assume is guaranteed.
 *
 * Simple interest, not compounded. APY is already the compounded figure, so
 * compounding it again would overstate the result — a mistake that is easy to
 * make and always errs in the flattering direction.
 */
export function projectEarnings(pool, amountUsd) {
  if (pool?.apy == null || pool.apy === '' || typeof pool.apy === 'boolean') return null;
  const apy = Number(pool.apy);
  const amt = Number(amountUsd);
  if (!Number.isFinite(apy) || !Number.isFinite(amt) || amt <= 0) return null;

  const year = (amt * apy) / 100;
  const real = realShare(pool);

  return {
    year,
    month: year / 12,
    week: year / 52,
    day: year / 365,
    /*
     * The part of the projection backed by actual revenue. Shown beside the
     * headline so "you would earn $124" is immediately qualified by "of which
     * about $40 is real and the rest depends on a token price".
     */
    fromRealYield: real == null ? null : year * real
  };
}

const COMPOUND_PERIODS = Object.freeze({ daily: 365, weekly: 52, monthly: 12, yearly: 1 });

/**
 * Pure earnings projection for the Farm calculator. APY is expressed as a
 * percentage (5 means 5%), amount is USD, and the return is profit only — the
 * principal is deliberately not included in the chart or earnings rows.
 *
 * `simple` applies the annual rate linearly. For compound scenarios, the
 * reported annual rate is treated as a nominal scenario input and compounded
 * at the user-selected frequency using P × (1 + r/n)^(n×t). This is an
 * illustration, not a forecast or an assertion about a protocol's cadence.
 * Unsupported or unsafe inputs return null rather than a plausible-looking zero.
 */
export function projectCompoundedEarnings({ amount, apy, frequency, years } = {}) {
  const toInputNumber = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const principal = toInputNumber(amount);
  const rate = toInputNumber(apy);
  const duration = toInputNumber(years);
  if (
    principal == null || principal <= 0 ||
    rate == null || rate < 0 || rate > 10_000 ||
    duration == null || duration < 0 || duration > 100 ||
    !(frequency === 'simple' || Object.hasOwn(COMPOUND_PERIODS, frequency))
  ) return null;

  const annualRate = rate / 100;
  const endingBalance = frequency === 'simple'
    ? principal * (1 + annualRate * duration)
    : principal * (1 + annualRate / COMPOUND_PERIODS[frequency]) ** (COMPOUND_PERIODS[frequency] * duration);
  if (!Number.isFinite(endingBalance) || endingBalance < principal) return null;
  return endingBalance - principal;
}

export const YIELD_HISTORY_RANGES = Object.freeze(['7d', '30d', '90d']);

/**
 * What a 50/50 LP position loses (as a fraction, negative) when the two legs'
 * price ratio moves by `ratio` (1 = no move, 1.5 = one leg is worth 50% more
 * relative to the other). Classic impermanent loss for a 50/50 pair:
 *
 *   IL = 2·√k / (1 + k) − 1
 *
 * This is PRICE-MOVE IL only. It deliberately says nothing about what the pool
 * actually pays in swap fees — we do not have that number unless the feed sent
 * it, and inventing it would be exactly the kind of flattering guess the rest
 * of this module refuses to make. Returns null for a missing or non-positive
 * ratio rather than pretending the loss is zero.
 */
export function impermanentLoss(ratio) {
  const k = Number(ratio);
  if (!Number.isFinite(k) || k <= 0) return null;
  return (2 * Math.sqrt(k)) / (1 + k) - 1;
}

/**
 * A 0–100 quality score for one market row, computed entirely from data the
 * feed already sent (never from a black-box forecast, never an audit/trust
 * score we do not have).
 *
 * Weights (each factor is normalised to 0–1):
 *
 *   40%  base yield   — `apyBase` (interest/fees actually paid), NOT the
 *                       emissions headline. Missing base yield scores 0.
 *   25%  size         — log10 of TVL with a soft cap, so $10bn cannot
 *                       auto-win: $10m→0.25, $1bn→0.75, $10bn→1.0, flat
 *                       above that. Missing TVL scores 0.
 *   20%  real share   — `realShare`. An unknown split scores 0, not "all real".
 *   15%  stability    — penalises `rateIsUnusual` spikes, but scores 0 until a
 *                       real 30-day mean exists; missing history is not treated
 *                       as evidence of stability.
 *
 * Returns null for a pool we cannot score at all (no APY and no base), so the
 * UI shows nothing rather than a default "100".
 */
export const FARM_SCORE_WEIGHTS = Object.freeze({
  baseYield: 40,
  tvl: 25,
  realYield: 20,
  stability: 15
});

/** The normalized factors and weighted points shown in the analysis sheet. */
export function farmScoreBreakdown(pool) {
  if (!pool || typeof pool !== 'object') return null;
  const read = (value) => value == null || value === '' || typeof value === 'boolean' ? NaN : Number(value);
  const apy = read(pool.apy);
  const base = read(pool.apyBase);
  const tvl = read(pool.tvlUsd);
  if (!Number.isFinite(apy) && !Number.isFinite(base)) return null;

  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const share = realShare(pool);
  const mean = read(pool.apyMean30d);
  const hasBase = Number.isFinite(base);
  const hasTvl = Number.isFinite(tvl) && tvl > 0;
  const hasRealShare = share != null;
  const hasStability = Number.isFinite(apy) && Number.isFinite(mean) && mean > 0;

  // Missing inputs contribute zero; the score never fills a gap with a guess.
  const baseFactor = hasBase ? clamp01(base / 30) : 0;
  const sizeFactor = hasTvl ? clamp01(Math.log10(tvl / 1_000_000) / 4) : 0;
  const realFactor = hasRealShare ? share : 0;

  // Stability only scores when a real 30-day comparison exists.
  const unusual = hasStability ? rateIsUnusual(pool) : null;
  let stabilityFactor = hasStability ? 1 : 0;
  if (unusual) {
    if (unusual.direction === 'above') stabilityFactor = Math.max(0.4, 1 - (unusual.ratio - 1) * 0.12);
    else stabilityFactor = Math.max(0.5, 1 - (1 - unusual.ratio) * 0.25);
  }

  const components = {
    baseYield: { factor: baseFactor, points: FARM_SCORE_WEIGHTS.baseYield * baseFactor, weight: FARM_SCORE_WEIGHTS.baseYield, known: hasBase, raw: hasBase ? base : null },
    tvl: { factor: sizeFactor, points: FARM_SCORE_WEIGHTS.tvl * sizeFactor, weight: FARM_SCORE_WEIGHTS.tvl, known: hasTvl, raw: hasTvl ? tvl : null },
    realYield: { factor: realFactor, points: FARM_SCORE_WEIGHTS.realYield * realFactor, weight: FARM_SCORE_WEIGHTS.realYield, known: hasRealShare, raw: share },
    stability: { factor: stabilityFactor, points: FARM_SCORE_WEIGHTS.stability * stabilityFactor, weight: FARM_SCORE_WEIGHTS.stability, known: hasStability, raw: hasStability ? mean : null }
  };
  const total = Object.values(components).reduce((sum, component) => sum + component.points, 0);
  return {
    score: Math.round(Math.max(0, Math.min(100, total))),
    weights: FARM_SCORE_WEIGHTS,
    components,
    unusual
  };
}

export function farmScore(pool) {
  return farmScoreBreakdown(pool)?.score ?? null;
}

/**
 * Fetch our filtered pool list.
 *
 * No client-side cache beyond the request itself: the server already caches
 * for an hour, and a second layer here would only make "pull to refresh" a lie.
 */
async function fetchYieldData(url, { timeout = 15000, signal } = {}) {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, cache: 'no-store',
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (res.headers.get('x-data-stale') === '1') data.freshness = 'STALE';
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function getYields(options = {}) {
  const data = await fetchYieldData(`${API_BASE}/yields`, { timeout: 35_000, ...options });
  if (!Array.isArray(data?.pools) || !Number.isFinite(data.at) || data.at <= 0 || data.at > Date.now() + 60_000) throw new Error('BAD_SHAPE');
  // Never display an expired observation, even if an intermediary returns it.
  if (Date.now() - data.at >= 2 * 60 * 60_000) throw new Error('YIELDS_EXPIRED');
  return data;
}

const LLAMA_HISTORY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KAMINO_HISTORY_ID_RE = /^kamino-[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function getYieldHistory(id, options = {}) {
  if (!LLAMA_HISTORY_UUID_RE.test(id || '') && !KAMINO_HISTORY_ID_RE.test(id || '')) throw new Error('INVALID_POOL_ID');
  const { range = '30d', ...fetchOptions } = options ?? {};
  if (!YIELD_HISTORY_RANGES.includes(range)) throw new Error('INVALID_HISTORY_RANGE');
  const data = await fetchYieldData(`${API_BASE}/yields/${encodeURIComponent(id)}/history?range=${encodeURIComponent(range)}`, { timeout: 65_000, ...fetchOptions });
  if (data?.pool !== id || !Array.isArray(data.points) || (data.range != null && data.range !== range)) throw new Error('BAD_SHAPE');
  return data;
}
