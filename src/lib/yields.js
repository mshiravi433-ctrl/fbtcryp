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
import { LST_ASSETS, EQUITY_ASSETS, COMMODITY_ASSETS } from './solanaAssets';
import { SOLANA_SIGNAL_ASSETS } from './solanaSignals';
import { SOL_MINT, USDC_MINT, USDT_MINT } from './solana';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

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
  if (!pool) return null;
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
  const apy = Number(pool?.apy);
  const mean = Number(pool?.apyMean30d);
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

function tokenOnChain(chainId, symbol) {
  const list = TOKENS[chainId] ?? [];
  const want = String(symbol ?? '').trim().toUpperCase();
  if (!want) return null;
  return list.find((tk) => String(tk.symbol).toUpperCase() === want) ?? null;
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
    return { kind: 'solana', from: pair[0], to: pair[1], toMint };
  }

  const chainId = llamaChainId(pool?.chain);
  if (!chainId) return null;
  if (!tokenOnChain(chainId, pair[0]) || !tokenOnChain(chainId, pair[1])) return null;
  return { chainId, from: pair[0], to: pair[1] };
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
  const apy = Number(pool?.apy);
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
 *                       emissions headline. If the feed left the split out we
 *                       use the headline discounted, because an unknown split
 *                       is more likely emissions than revenue.
 *   25%  size         — log10 of TVL with a soft cap, so $10bn cannot
 *                       auto-win: $10m→0.25, $1bn→0.75, $10bn→1.0, flat
 *                       above that.
 *   20%  real share   — `realShare`. null is NOT treated as 1; an unknown
 *                       split scores 0, not "all real".
 *   15%  stability    — penalises `rateIsUnusual` spikes. A pool spiking far
 *                       above its own 30-day mean is usually an incentive
 *                       burst about to vanish.
 *
 * Returns null for a pool we cannot score at all (no APY and no base), so the
 * UI shows nothing rather than a default "100".
 */
export function farmScore(pool) {
  if (!pool || typeof pool !== 'object') return null;
  const apy = Number(pool.apy);
  const base = pool.apyBase == null ? NaN : Number(pool.apyBase);
  const tvl = Number(pool.tvlUsd);
  if (!Number.isFinite(apy) && !Number.isFinite(base)) return null;

  const share = realShare(pool);

  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  // Base yield — prefer the real (non-emissions) part of the rate.
  const baseRate = Number.isFinite(base) ? base : apy * 0.6;
  const baseFactor = clamp01(baseRate / 30);

  // Size with a soft cap (log10 keeps a $10bn pool from auto-winning).
  const sizeFactor = Number.isFinite(tvl) && tvl > 0
    ? clamp01(Math.log10(tvl / 1_000_000) / 4)
    : 0;

  // Real share; null → 0, never a flattering "1".
  const realFactor = share == null ? 0 : share;

  // Stability: penalise a spike away from the pool's own 30-day mean.
  const unusual = rateIsUnusual(pool);
  let stability = 1;
  if (unusual) {
    if (unusual.direction === 'above') stability = Math.max(0.4, 1 - (unusual.ratio - 1) * 0.12);
    else stability = Math.max(0.5, 1 - (1 - unusual.ratio) * 0.25);
  }

  const score = 100 * (0.4 * baseFactor + 0.25 * sizeFactor + 0.2 * realFactor + 0.15 * stability);
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Fetch our filtered pool list.
 *
 * No client-side cache beyond the request itself: the server already caches
 * for an hour, and a second layer here would only make "pull to refresh" a lie.
 */
export async function getYields({ timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/yields`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.pools)) throw new Error('BAD_SHAPE');
    return data;
  } finally {
    clearTimeout(timer);
  }
}
