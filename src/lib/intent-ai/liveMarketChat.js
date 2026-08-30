/**
 * FBT INTENT AI — DEEP MARKET ANALYSIS FOR THE CHAT
 * ---------------------------------------------------------------------------
 * chatTurn() is deliberately synchronous (parse → strategy → reply, no I/O),
 * so its analysis replies ship with `marketAnalysis.dataStatus: 'pending'`.
 * The panel then calls buildChatMarketAnalysis() and swaps the pending block
 * for the real one. Every number in the result comes from the app's market
 * feed (getMarkets / getChart in src/lib/api.js, INJECTED by the caller —
 * this module never imports the fetch layer, exactly as liveMarketRegime.js
 * keeps its price source injected, so Node test harnesses can load
 * intent-ai/index.js without a network stack) or from the live regime
 * detector (liveMarketRegime.js → marketRegime.js):
 *
 *   · price, 24h change, 7d trend and volume come from the markets snapshot —
 *     and when that snapshot is the OFFLINE fallback, the block says
 *     `dataStatus: 'offline'` instead of dressing a cached number up as live
 *   · the regime strip only speaks when the live detector found fresh price
 *     evidence; otherwise it is `unavailable`, with the reason — a guessed
 *     regime is worse than none
 *   · a symbol the feed cannot price is still listed, marked `unavailable`,
 *     so the user sees their request was heard rather than silently filtered
 *   · signal/risk are transparent heuristics over the SAME sourced numbers
 *     (documented below), never a hidden model's advice — `notAdvice: true`
 *     is part of the payload and the UI prints the disclaimer
 *
 * Nothing here authorizes anything: this module reads public prices and
 * returns display data. No keys, no signing, no routing.
 */

import { detectLiveMarketRegime, describeLiveRegime } from './liveMarketRegime.js';

export const MARKET_CHAT_SCHEMA = 'fbt.intent-market-chat.v1';
/** Never display more symbols than this in one brief — readability is a cap. */
export const MARKET_CHAT_MAX_ASSETS = 6;
/** The default "market brief" basket when the user named no assets. */
export const BRIEF_DEFAULT_SYMBOLS = Object.freeze(['BTC', 'ETH', 'BNB', 'SOL', 'XRP']);

/**
 * Symbol → CoinGecko id for the majors. A symbol missing here is NOT an
 * error: it renders as `unavailable` on its own row, next to the ones that
 * resolved — the user asked about it and deserves an explicit answer, even
 * when the answer is "we could not price this one".
 */
export const SYMBOL_TO_COINGECKO = Object.freeze({
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', TRX: 'tron',
  TON: 'the-open-network', LINK: 'chainlink', AVAX: 'avalanche-2',
  DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
  LTC: 'litecoin', BCH: 'bitcoin-cash', ATOM: 'cosmos', NEAR: 'near',
  UNI: 'uniswap', ARB: 'arbitrum', OP: 'optimism', APT: 'aptos',
  SUI: 'sui', INJ: 'injective-protocol', FIL: 'filecoin', HBAR: 'hedera-hashgraph',
  XLM: 'stellar', USDT: 'tether', USDC: 'usd-coin', DAI: 'dai'
});

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

/** Realised volatility of a sparkline: σ of point-to-point returns, in %. */
function sparklineVolatilityPct(prices) {
  const rows = (Array.isArray(prices) ? prices : []).map(num).filter((p) => p !== null && p > 0);
  if (rows.length < 8) return null;
  const returns = [];
  for (let i = 1; i < rows.length; i += 1) returns.push((rows[i] - rows[i - 1]) / rows[i - 1]);
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100 * Math.sqrt(returns.length);
}

/*
 * Signal & risk, said out loud:
 *   signal.up   — 24h change ≥ +2%   ·   down — ≤ −2%   ·   flat — in between
 *   risk.high   — realised 7d volatility ≥ 8%   ·   medium — ≥ 4%   ·   low — below
 * Thresholds are arbitrary, so they are written here where anyone can audit
 * them, and the UI shows the underlying numbers right next to the badge.
 */
function signalOf(change24hPct) {
  const c = num(change24hPct);
  if (c === null) return 'unknown';
  if (c >= 2) return 'up';
  if (c <= -2) return 'down';
  return 'flat';
}
function riskOf(volatilityPct) {
  const v = num(volatilityPct);
  if (v === null) return 'unknown';
  if (v >= 8) return 'high';
  if (v >= 4) return 'medium';
  return 'low';
}

function unavailable(symbols, reason, extra = {}) {
  return {
    ok: false,
    schema: MARKET_CHAT_SCHEMA,
    dataStatus: 'unavailable',
    reason,
    requestedAssets: symbols,
    assets: symbols.map((symbol) => ({ symbol, dataStatus: 'unavailable' })),
    regime: { available: false, i18nKey: 'intentAI.regime.unavailable', params: {}, sources: [] },
    notAdvice: true,
    executionAuthorized: false,
    observedAt: Date.now(),
    ...extra
  };
}

/**
 * Build the structured market block for an analysis reply.
 *
 * @param {string[]} symbols  requested symbols, order preserved
 * @param {object}   deps     { marketsSource, priceSource } — injectable so
 *                            tests and offline runs stay deterministic
 */
export async function buildChatMarketAnalysis({
  symbols = [],
  marketsSource = null,
  priceSource = null,
  withRegime = true,
  now = Date.now()
} = {}) {
  /*
   * Which markets to show. An explicit list ("analyze BTC SOL") is honoured;
   * a bare "market brief" gets the majors basket — which IS what a market
   * brief means — and the payload says so (`briefBasket: true`).
   */
  const requested = (Array.isArray(symbols) ? symbols : [])
    .map((s) => String(s || '').toUpperCase())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, MARKET_CHAT_MAX_ASSETS);
  const briefBasket = requested.length === 0;
  const wanted = (briefBasket ? [...BRIEF_DEFAULT_SYMBOLS] : requested);

  if (typeof marketsSource !== 'function') return unavailable(wanted, 'NO_MARKET_SOURCE', { briefBasket });

  let rows = null;
  try {
    rows = await marketsSource();
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows) || !rows.length) return unavailable(wanted, 'MARKET_FEED_FAILED', { briefBasket });

  const byId = new Map();
  for (const row of rows) if (row?.id) byId.set(String(row.id), row);

  const assets = wanted.map((symbol) => {
    const cgId = SYMBOL_TO_COINGECKO[symbol] || null;
    const row = cgId ? byId.get(cgId) : null;
    if (!row) {
      return { symbol, coingeckoId: cgId, dataStatus: 'unavailable', signal: 'unknown', risk: 'unknown' };
    }
    const change24hPct = round2(num(row.change24h));
    const trend7dPct = round2(num(row.change7d));
    const volatilityPct = round2(sparklineVolatilityPct(row.sparkline));
    return {
      symbol,
      name: typeof row.name === 'string' ? row.name.slice(0, 40) : null,
      coingeckoId: cgId,
      dataStatus: row.dataProvenance === 'live' ? 'live' : 'offline',
      priceUsd: num(row.price),
      change24hPct,
      trend7dPct,
      volume24hUsd: num(row.volume),
      marketCapUsd: num(row.mcap),
      volatilityPct,
      signal: signalOf(change24hPct),
      risk: riskOf(volatilityPct)
    };
  });

  /*
   * Regime: only over assets that really priced (the detector refuses a dead
   * feed itself, but skipping known-duds saves the requests). The detector's
   * own staleness/minimum-point rules apply — unavailable stays unavailable.
   */
  let regime = { available: false, i18nKey: 'intentAI.regime.unavailable', params: {}, sources: [] };
  let regimeDetail = null;
  if (withRegime && typeof priceSource === 'function') {
    const regimeAssets = assets.filter((a) => a.dataStatus === 'live').slice(0, 3).map((a) => a.coingeckoId);
    if (regimeAssets.length) {
      try {
        /*
         * NO `now` override here on purpose: a live priceSource stamps its
         * newest point with the CURRENT wall clock, and freezing an earlier
         * `now` would make that fresh point look like it comes from the
         * future (negative evidence age), breaking the detector's freshness
         * check. The detector's own default now is the truth for freshness.
         */
        const detected = await detectLiveMarketRegime({
          assets: regimeAssets,
          priceSource,
          days: 7,
          vs: 'usd'
        });
        regime = describeLiveRegime(detected);
        regimeDetail = {
          regime: detected.regime,
          status: detected.status,
          metrics: detected.metrics || null,
          dataStatus: detected.dataStatus
        };
      } catch {
        regime = { available: false, i18nKey: 'intentAI.regime.unavailable', params: {}, sources: [] };
      }
    }
  }

  const pricedLive = assets.filter((a) => a.dataStatus === 'live').length;
  const pricedOffline = assets.filter((a) => a.dataStatus === 'offline').length;
  const dataStatus = pricedLive > 0 ? 'live' : pricedOffline > 0 ? 'offline' : 'unavailable';

  return {
    ok: dataStatus !== 'unavailable',
    schema: MARKET_CHAT_SCHEMA,
    dataStatus,
    briefBasket,
    requestedAssets: requested,
    assets,
    regime,
    regimeDetail,
    sources: [{ source: 'coingecko:markets', observedAt: now }],
    notAdvice: true,
    executionAuthorized: false,
    observedAt: now
  };
}
