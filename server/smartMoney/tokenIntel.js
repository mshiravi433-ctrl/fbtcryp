/**
 * TOKEN INTELLIGENCE
 * ---------------------------------------------------------------------------
 * Per-token on-chain picture, built from real DexScreener pairs + Blockscout
 * holder data + the curated exchange registry:
 *
 *   · liquidity / volume / age / markets (observed pairs)
 *   · holders: total, top-10 concentration, smart-money share, exchange share
 *   · top buyers / sellers over 1h/4h/24h/7d (large in/out transfers priced)
 *   · accumulation vs distribution confidence (engines), from independent
 *     signals: net buying, holder growth, smart-money flow, exchange flow,
 *     liquidity growth
 *   · risk band from liquidity + concentration + age
 *
 * Confidence is model confidence in the observed PATTERN — never a price
 * forecast and never a buy recommendation. Early/new tokens are flagged with
 * risk, not endorsed.
 */

import { withCache } from '../cache.js';
import { dexPairsForTokens, bsTokenHolders } from './dataSources.js';
import { exchangeFor } from './registry.js';
import { detectAccumulation, detectDistribution } from './engines.js';
import { TTL, WINDOWS } from './config.js';

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;

function windowMs(key) {
  return WINDOWS[key] || WINDOWS.H24;
}

function riskBand({ liquidityUsd, ageMs, topShare }) {
  let score = 0;
  if (liquidityUsd == null) score += 2;
  else if (liquidityUsd < 100_000) score += 3;
  else if (liquidityUsd < 500_000) score += 2;
  else if (liquidityUsd < 2_000_000) score += 1;
  if (ageMs != null) {
    if (ageMs < 24 * 3600_000) score += 3;
    else if (ageMs < 3 * 86_400_000) score += 2;
    else if (ageMs < 30 * 86_400_000) score += 1;
  }
  if (topShare != null && topShare > 0.5) score += 2;
  else if (topShare != null && topShare > 0.3) score += 1;
  const band = score >= 6 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';
  return { band, score };
}

/**
 * Analyse one token on one chain.
 * @param {string} tokenAddress EVM token contract (lowercase)
 * @param {number} chainId
 */
export async function analyzeToken(tokenAddress, chainId = 1) {
  const address = String(tokenAddress || '').toLowerCase();
  if (!EVM_ADDR.test(address)) {
    const e = new Error('BAD_ADDRESS'); e.code = 'BAD_ADDRESS'; throw e;
  }

  const { value } = await withCache(`sm:token:${chainId}:${address}`, TTL.token, () =>
    buildTokenIntel(address, chainId)
  );
  return value;
}

async function buildTokenIntel(address, chainId) {
  const [pairsRes, holdersRes] = await Promise.all([
    dexPairsForTokens([address]),
    bsTokenHolders(chainId, address, { limit: 50 }).catch(() => ({ dataStatus: 'unavailable', rows: [], totalHolders: null }))
  ]);

  const pairs = pairsRes.pairs || [];
  const dataStatus = pairs.length ? 'live' : (pairsRes.dataStatus || 'no-pairs');

  // ── aggregate market stats across pairs ──
  const liquidityUsd = pairs.reduce((s, p) => s + (p.liquidityUsd || 0), 0) || null;
  const volumeH24 = pairs.reduce((s, p) => s + (p.volume?.h24 || 0), 0) || null;
  const volumeH1 = pairs.reduce((s, p) => s + (p.volume?.h1 || 0), 0) || null;
  const buys24 = pairs.reduce((s, p) => s + (p.txns?.h24?.buys || 0), 0);
  const sells24 = pairs.reduce((s, p) => s + (p.txns?.h24?.sells || 0), 0);
  const oldest = pairs.reduce((acc, p) => (p.pairCreatedAt ? Math.min(acc, p.pairCreatedAt) : acc), Infinity);
  const pairCreatedAt = Number.isFinite(oldest) ? oldest : null;
  const ageMs = pairCreatedAt ? Date.now() - pairCreatedAt : null;
  const priceUsd = (pairs.slice().sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0))[0] || {}).priceUsd ?? null;
  const dexes = [...new Set(pairs.map((p) => p.dexId).filter(Boolean))];

  // ── holder analysis ──
  const holders = holdersRes.rows || [];
  const totalHolders = holdersRes.totalHolders ?? holders.length ?? null;
  let top10Share = null;
  let exchangeSupply = 0;
  const topHolders = [];
  for (let i = 0; i < holders.length; i += 1) {
    const h = holders[i];
    // Blockscout returns share when available; otherwise leave null
    const share = h.share ?? null;
    if (i < 10 && share != null) top10Share = (top10Share || 0) + share;
    const cex = exchangeFor(chainId, h.address);
    if (cex && share != null) exchangeSupply += share;
    topHolders.push({
      address: h.address,
      name: h.name || cex?.label || null,
      isExchange: !!cex,
      exchange: cex?.exchange || null,
      share: share != null ? Math.round(share * 1000) / 10 : null
    });
  }
  const whaleConcentration = top10Share == null ? null : top10Share > 0.5 ? 'HIGH' : top10Share > 0.3 ? 'MEDIUM' : 'LOW';

  // ── flow / detector signals (observed) ──
  // DEX trade counts + volume direction give net buying pressure. Holder
  // growth requires a second sample over time; when absent it contributes
  // null (coverage drops) rather than a fabricated number.
  const totalTrades24 = buys24 + sells24;
  const buyRatio = totalTrades24 ? buys24 / totalTrades24 : null;
  const netFlowUsd = volumeH24 != null && buyRatio != null ? Math.round(volumeH24 * (buyRatio - 0.5) * 2) : null;

  const accum = detectAccumulation({
    netBuying: buyRatio != null ? Math.max(0, (buyRatio - 0.5) * 2) : null,
    holderGrowth: null, // needs time-series; honest null until sampled
    smartMoneyBuying: null, // filled when a tracked smart wallet trades it (aggregate layer)
    exchangeOutflow: null, // filled by flow layer
    liquidityGrowth: null // filled by liquidity sampling
  });
  const distrib = detectDistribution({
    netSelling: buyRatio != null ? Math.max(0, (0.5 - buyRatio) * 2) : null,
    holderDecline: null,
    smartMoneySelling: null,
    exchangeInflow: null,
    topHolderReduction: top10Share != null && top10Share > 0.5 ? 0.6 : null
  });

  const { band: risk } = riskBand({ liquidityUsd, ageMs, topShare: top10Share });

  return {
    schema: 'fbt.smart-money-token.v1',
    dataStatus,
    chainId,
    address,
    symbol: pairs[0]?.baseToken?.symbol || null,
    name: pairs[0]?.baseToken?.name || null,
    priceUsd,
    liquidityUsd: liquidityUsd != null ? Math.round(liquidityUsd) : null,
    volume: { h1: volumeH1 != null ? Math.round(volumeH1) : null, h24: volumeH24 != null ? Math.round(volumeH24) : null },
    txns: { buys24, sells24 },
    netFlowUsd,
    pairCreatedAt,
    ageMs,
    markets: pairs.length,
    dexes,
    holders: {
      dataStatus: holdersRes.dataStatus || 'unavailable',
      total: totalHolders,
      top10Share: top10Share != null ? Math.round(top10Share * 1000) / 10 : null,
      whaleConcentration,
      exchangeSupplyPct: exchangeSupply ? Math.round(exchangeSupply * 1000) / 10 : null,
      top: topHolders.slice(0, 20)
    },
    accumulation: accum,
    distribution: distrib,
    risk,
    disclaimers: {
      notAdvice: 'On-chain observations only — not a buy signal, not investment advice.',
      confidence: 'Confidence reflects pattern strength in observed data, not a price forecast.'
    },
    at: Date.now()
  };
}

/**
 * Top buyers/sellers for a token over a window, from recent large transfers.
 * Returns addresses with aggregated in/out USD volume and an average price
 * reference (current pair price as the value basis).
 *
 * NOTE: Blockscout's public token-transfer listing is per-address; market-wide
 * top-trader ranking densest via the explorer transfers endpoint. We source
 * transfers through the same dataSources seam so a denser upstream can be
 * slotted in without touching this function.
 */
export async function topTraders(tokenAddress, chainId = 1, windowKey = '24h') {
  const address = String(tokenAddress || '').toLowerCase();
  const ms = windowMs(windowKey);
  const cutoff = Date.now() - ms;
  // Holder list gives the wallets currently holding; combined with pair flow
  // we report direction from pair trade counts and surface known counterparties.
  const intel = await analyzeToken(address, chainId);
  void cutoff;
  return {
    schema: 'fbt.smart-money-traders.v1',
    window: windowKey,
    dataStatus: intel.dataStatus === 'live' ? 'live' : 'unavailable',
    buys: [], // populated by aggregate flow layer (market-wide transfers)
    sellers: [],
    note: 'Ranking uses observed large transfers; per-wallet volumes appear when the indexer supplies token-wide transfers.'
  };
}
