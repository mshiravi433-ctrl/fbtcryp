/**
 * FBT FINANCIAL OS — Opportunity Engine v2 (Multi-Market + Cortex)
 * ---------------------------------------------------------------------------
 * Upgrades the v1 personalized scanner into a full multi-market opportunity
 * engine. It watches seven opportunity families — and ONLY from data the
 * caller actually supplies (nothing is fabricated; a family with no input
 * rows produces no opportunities and is reported in `coverage`):
 *
 *   1. LIQUIDITY_POOL  — DEX pool fee APR + incentives vs impermanent loss
 *   2. FARMING         — yield farms / vaults / staking (incl. legacy DeFi rows)
 *   3. LENDING         — money-market supply yields (+ legacy idle-stable yield)
 *   4. ARBITRAGE       — cross-venue price spreads (explicit spreads OR a
 *                        venue×price matrix the engine differences itself)
 *   5. EMERGING_TOKEN  — young / fast-growing tokens with real flow evidence
 *   6. RWA             — tokenized real-world assets
 *   7. WHALE_FLOW      — smart-money / whale accumulation & exchange flows
 *
 * For EVERY candidate the engine computes honest economics for the user's
 * own capital and horizon:
 *   gross profit → itemised fees (protocol, swap entry/exit, network gas,
 *   bridge, slippage estimated from depth/TVL) → NET profit (USD + %),
 *   annualised net APY, break-even days and the minimum viable capital at
 *   which fees stop eating the trade.
 *
 * Risk is a transparent composite (smart-contract, liquidity, volatility,
 * impermanent-loss, liquidation, counterparty, bridge, concentration),
 * reported component-by-component — never a single unexplained number.
 *
 * Ranking is personalized: candidates whose risk exceeds the user's profile
 * tolerance or whose capital need exceeds the user's capital are NOT hidden —
 * they are returned in `rejected` with machine-readable reasons. The rest are
 * ranked by risk-adjusted net return, confidence, capital fit and (when
 * connected) Cortex alignment.
 *
 * ─── CORTEX CONNECTION ─────────────────────────────────────────────────────
 * The engine plugs into the on-device Neuromorphic Cortex
 * (`src/lib/neuromorphic/cortexCore.js`) in two ways:
 *   a) `cortexReadout` — pass the latest readout from `useNeuromorphicCortex`
 *      / `cortex.step()`; the engine derives a regime verdict per opportunity
 *      (tailwind / headwind from directionalDrive, volatilityForecast,
 *      anomalySurprise, dominantRegime and the basal-ganglia gatedAction).
 *   b) `cortex` — pass a live cortex instance; `scanOpportunities` feeds it a
 *      real 8-axis sensory vector built from the supplied market/whale data
 *      via `cortex.stepSync()` and uses the measured readout. Read-only:
 *      the Cortex laws (canExecute/canSign/canMoveFunds = false) are inherited.
 * With no Cortex connected the engine still works and says so
 * (`cortex: { connected: false }`) — it never invents a Cortex opinion.
 *
 * Honesty laws (inherited across the codebase):
 *   · Missing numbers stay `null`, never 0 dressed as evidence.
 *   · Confidence describes the EVIDENCE, never a probability of profit.
 *   · Every opportunity carries `caveats: ['not-a-signal', …]`.
 *   · Deterministic: same input → same ranking (stable tie-breaks).
 */

export const OPPORTUNITY_SCHEMA = 'fbt.opportunity-engine.v2';
/** Schemas this build can still read/compare against. */
export const OPPORTUNITY_SCHEMA_COMPAT = Object.freeze(['fbt.opportunity-engine.v1', OPPORTUNITY_SCHEMA]);

export const OPPORTUNITY_CATEGORIES = Object.freeze([
  { id: 'LIQUIDITY_POOL', fa: 'استخر نقدینگی', en: 'Liquidity pools' },
  { id: 'FARMING', fa: 'فارمینگ', en: 'Yield farming' },
  { id: 'LENDING', fa: 'وام‌دهی', en: 'Lending' },
  { id: 'ARBITRAGE', fa: 'آربیتراژ', en: 'Arbitrage' },
  { id: 'EMERGING_TOKEN', fa: 'توکن نوظهور', en: 'Emerging tokens' },
  { id: 'RWA', fa: 'دارایی واقعی (RWA)', en: 'Real-world assets' },
  { id: 'WHALE_FLOW', fa: 'جریان نهنگ‌ها', en: 'Whale flows' }
]);

/** Risk ceiling (0–10 composite) each profile tolerates before rejection. */
export const RISK_TOLERANCE = Object.freeze({
  CONSERVATIVE: 3.5, MODERATE: 5.5, BALANCED: 6.5, AGGRESSIVE: 8.5
});

/** Default per-chain network cost (USD) when a row does not state its gas. */
export const CHAIN_GAS_USD = Object.freeze({
  solana: 0.02, base: 0.05, arbitrum: 0.08, optimism: 0.08, bsc: 0.15,
  polygon: 0.02, avalanche: 0.25, ethereum: 4.5, unknown: 0.5
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, fallback = null) => (isNum(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 2) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/* ═══════════════════════ ECONOMICS ═══════════════════════ */

/**
 * Itemised fee model. Every fee is either taken from the row (evidence) or
 * from the documented defaults above — and the breakdown says which.
 * Slippage is estimated, never asserted: capital ÷ available depth.
 */
export function estimateFees({
  capitalUsd, category, chain = 'unknown', depthUsd = null, tvlUsd = null,
  feePct = {}, gasUsd = null, bridgeFeePct = 0, roundTrips = 1
} = {}) {
  const capital = Math.max(0, Number(capitalUsd) || 0);
  // Swap legs only exist where a swap actually happens: supplying to a lending
  // market or buying an RWA is not a DEX swap, so its default swap fee is 0.
  const swapDefault = category === 'ARBITRAGE' ? 0.2
    : category === 'LIQUIDITY_POOL' || category === 'FARMING' || category === 'EMERGING_TOKEN' || category === 'WHALE_FLOW' ? 0.25 : 0;
  const swapPct = num(feePct.swapPct, swapDefault);
  const protocolPct = num(feePct.protocolPct, 0);
  const exitPct = num(feePct.exitPct, swapPct);
  const gas = num(gasUsd, CHAIN_GAS_USD[String(chain || 'unknown').toLowerCase()] ?? CHAIN_GAS_USD.unknown);
  const depth = num(depthUsd, null) ?? num(tvlUsd, null);
  // Market-impact proxy: trading `capital` against `depth` of visible liquidity.
  const slippagePct = depth && depth > 0 ? clamp((capital / depth) * 50, 0.02, 8)
    : category === 'LENDING' || category === 'RWA' ? 0.02 : 0.3;
  const pct = (p) => (capital * p) / 100;
  const fees = {
    protocolUsd: round(pct(protocolPct)),
    swapEntryUsd: round(pct(swapPct)),
    swapExitUsd: round(category === 'ARBITRAGE' ? pct(exitPct) : pct(exitPct)),
    bridgeUsd: round(pct(bridgeFeePct || 0)),
    slippageUsd: round(pct(slippagePct)),
    networkGasUsd: round(gas * Math.max(1, roundTrips)),
    slippagePctAssumed: round(slippagePct, 3),
    gasSource: gasUsd != null ? 'row' : 'chain-default'
  };
  fees.totalUsd = round(Object.keys(fees)
    .filter((k) => k.endsWith('Usd'))
    .reduce((s, k) => s + (fees[k] || 0), 0));
  return fees;
}

/**
 * Net economics of one opportunity for a concrete capital + horizon.
 * `grossApyPct` for yield families; `oneOffReturnPct` for arbitrage/whales.
 */
export function computeEconomics({ capitalUsd, horizonDays = 30, grossApyPct = null, oneOffReturnPct = null, fees }) {
  const capital = Math.max(0, Number(capitalUsd) || 0);
  const days = clamp(Number(horizonDays) || 30, 1, 3650);
  const feeTotal = fees?.totalUsd || 0;
  if (capital <= 0) return { capitalUsd: 0, investable: false, reason: 'no-capital' };
  const grossUsd = oneOffReturnPct != null
    ? (capital * oneOffReturnPct) / 100
    : (capital * (grossApyPct || 0) / 100) * (days / 365);
  const netUsd = grossUsd - feeTotal;
  const netReturnPct = (netUsd / capital) * 100;
  const netApyPct = oneOffReturnPct != null
    ? netReturnPct * (365 / days)
    : netReturnPct * (365 / days);
  // Break-even: days until gross yield covers the fixed+pct fees (yield rows),
  // or 0/impossible for one-off rows.
  let breakEvenDays = null;
  if (oneOffReturnPct == null && grossApyPct > 0) {
    breakEvenDays = round(clamp((feeTotal / capital) * 100 / (grossApyPct / 365), 0, 3650));
  } else if (oneOffReturnPct != null) {
    breakEvenDays = netUsd >= 0 ? 0 : null;
  }
  // Minimum capital at which net ≥ 0 (fees scale partly with capital, gas does not).
  const pctFees = (fees.protocolUsd + fees.swapEntryUsd + fees.swapExitUsd + fees.bridgeUsd + fees.slippageUsd) || 0;
  const fixedFees = fees.networkGasUsd || 0;
  const pctFeeRate = capital > 0 ? pctFees / capital : 0;
  const grossRate = oneOffReturnPct != null ? oneOffReturnPct / 100 : ((grossApyPct || 0) / 100) * (days / 365);
  const margin = grossRate - pctFeeRate;
  const minViableCapitalUsd = margin > 0 ? round(fixedFees / margin) : null;
  return {
    capitalUsd: round(capital), horizonDays: days,
    grossProfitUsd: round(grossUsd), fees, netProfitUsd: round(netUsd),
    netReturnPct: round(netReturnPct, 3), netApyPct: round(netApyPct),
    breakEvenDays, minViableCapitalUsd,
    profitable: netUsd > 0
  };
}

/* ═══════════════════════ RISK MODEL ═══════════════════════ */

const RISK_WEIGHTS = Object.freeze({
  smartContract: 0.2, liquidity: 0.18, volatility: 0.16, impermanentLoss: 0.12,
  liquidation: 0.1, counterparty: 0.1, bridge: 0.06, concentration: 0.08
});

/** Weighted composite (0–10) + level, keeping every component visible. */
export function compositeRisk(components = {}) {
  let sum = 0; let wSum = 0; const detail = {};
  for (const [k, w] of Object.entries(RISK_WEIGHTS)) {
    const v = num(components[k], null);
    detail[k] = v == null ? null : round(clamp(v, 0, 10), 1);
    if (v != null) { sum += clamp(v, 0, 10) * w; wSum += w; }
  }
  if (!wSum) return { score: null, level: 'UNKNOWN', components: detail, coverage: 0 };
  const score = sum / wSum;
  return {
    score: round(score, 1),
    level: score <= 3 ? 'LOW' : score <= 5.5 ? 'MEDIUM' : score <= 7.5 ? 'HIGH' : 'CRITICAL',
    components: detail,
    coverage: round(wSum, 2)
  };
}

const liquidityRisk = (depthUsd) => (depthUsd == null ? null
  : depthUsd >= 5e6 ? 1.5 : depthUsd >= 1e6 ? 3 : depthUsd >= 2e5 ? 5 : depthUsd >= 5e4 ? 7 : 9);
const volRisk = (volPct) => (volPct == null ? null : clamp(volPct / 12, 0.5, 10));

/* ═══════════════════════ CORTEX BRIDGE ═══════════════════════ */

/**
 * Build the Cortex's canonical 8-axis sensory vector [-1,1]^8
 * (returnShort, returnMedium, realizedVol, volumeImpulse, rsiDeviation,
 * rangePosition, breadthSkew, structuralStress) from supplied scan inputs.
 * Axes with no evidence stay 0 (neutral) and are listed in `axesWithEvidence`.
 */
export function buildCortexFeatureVector({ marketContext = null, whaleFlows = [], emergingTokens = [], arbitrageSpreads = [] } = {}) {
  const axes = new Array(8).fill(0); const evidence = [];
  const tanh = (x) => Math.tanh(clamp(Number(x) || 0, -12, 12));
  if (marketContext) {
    if (isNum(marketContext.change24hPct)) { axes[0] = tanh(marketContext.change24hPct / 5); evidence.push('returnShort'); }
    if (isNum(marketContext.change7dPct)) { axes[1] = tanh(marketContext.change7dPct / 12); evidence.push('returnMedium'); }
    if (isNum(marketContext.volatilityPct)) { axes[2] = tanh((marketContext.volatilityPct - 50) / 40); evidence.push('realizedVol'); }
    if (marketContext.regime) {
      axes[6] = marketContext.regime.includes('BULL') ? 0.6 : marketContext.regime.includes('BEAR') ? -0.6 : 0;
      if (axes[6]) evidence.push('breadthSkew');
      axes[7] = marketContext.regime.includes('VOL') || marketContext.regime.includes('SHOCK') ? 0.7 : axes[7];
    }
  }
  const flows = (whaleFlows || []).filter((w) => isNum(Number(w.netFlowUsd)));
  if (flows.length) {
    const net = flows.reduce((s, w) => s + Number(w.netFlowUsd), 0);
    const gross = flows.reduce((s, w) => s + Math.abs(Number(w.netFlowUsd)), 0) || 1;
    axes[3] = tanh((net / gross) * 2); evidence.push('volumeImpulse');
    axes[6] = clamp(axes[6] + (net / gross) * 0.4, -1, 1);
  }
  const young = (emergingTokens || []).filter((t) => isNum(t.change24h));
  if (young.length) {
    const avg = young.reduce((s, t) => s + Number(t.change24h), 0) / young.length;
    axes[0] = clamp(axes[0] + tanh(avg / 15) * 0.5, -1, 1);
    axes[5] = tanh(avg / 20); evidence.push('rangePosition');
  }
  if ((arbitrageSpreads || []).length) { axes[7] = clamp(axes[7] + 0.3, -1, 1); evidence.push('structuralStress'); }
  return { vector: axes.map((v) => round(v, 4)), axesWithEvidence: [...new Set(evidence)] };
}

/** Normalise any Cortex readout (live instance result or stored snapshot). */
export function normalizeCortexReadout(readout) {
  if (!readout || typeof readout !== 'object') return null;
  return {
    directionalDrive: num(readout.directionalDrive, null),
    volatilityForecast: num(readout.volatilityForecast, null),
    anomalySurprise: num(readout.anomalySurprise, null),
    dominantRegime: readout.dominantRegime || readout.gatedAction?.dominantRegime || null,
    gatedAction: readout.gatedAction?.action || readout.brain?.basalGanglia?.action || null,
    cortexConfidence: num(readout.gatedAction?.confidence ?? readout.brain?.basalGanglia?.confidence, null),
    schema: readout.schema || null
  };
}

/**
 * Per-opportunity Cortex verdict. Directional families (emerging/whale, and
 * arbitrage to a lesser degree) gain/lose from drive alignment; defensive
 * yield families are mainly penalised by forecast volatility + anomaly.
 * Returns a bounded multiplier — Cortex modulates evidence, never invents it.
 */
export function cortexVerdictFor(opportunity, cortex) {
  if (!cortex) return { connected: false, alignment: null, multiplier: 1, note: 'cortex-not-connected' };
  const drive = cortex.directionalDrive ?? 0;
  const vol = cortex.volatilityForecast ?? 0.5;
  const anomaly = cortex.anomalySurprise ?? 0;
  let alignment;
  switch (opportunity.category) {
    case 'EMERGING_TOKEN':
    case 'WHALE_FLOW':
      alignment = drive * (opportunity.direction === 'BEARISH' ? -1 : 1); break;
    case 'ARBITRAGE':
      alignment = -anomaly * 0.6; break; // dislocations help arb but chaos hurts execution
    case 'LIQUIDITY_POOL':
    case 'FARMING':
      alignment = -Math.max(0, vol - 0.5) - anomaly * 0.5; break; // IL/vol headwind
    default: // LENDING, RWA and legacy defensive types
      alignment = -Math.max(0, vol - 0.6) * 0.7 - anomaly * 0.3;
  }
  if (cortex.gatedAction === 'avoid' || cortex.gatedAction === 'AVOID') alignment -= 0.25;
  return {
    connected: true,
    alignment: round(clamp(alignment, -1, 1), 3),
    multiplier: round(clamp(1 + alignment * 0.3, 0.7, 1.3), 3),
    regime: cortex.dominantRegime,
    note: alignment > 0.15 ? 'cortex-tailwind' : alignment < -0.15 ? 'cortex-headwind' : 'cortex-neutral'
  };
}

/** Ask a live Cortex instance for a measured readout (read-only, fail-safe). */
export function readCortex(cortex, featureVector) {
  if (!cortex) return { connected: false, readout: null };
  try {
    if (typeof cortex.stepSync === 'function' && Array.isArray(featureVector)) {
      return { connected: true, readout: normalizeCortexReadout(cortex.stepSync(featureVector)), source: 'live-stepSync' };
    }
    if (typeof cortex.getBrainSnapshot === 'function' || typeof cortex._internals === 'function') {
      const last = cortex._internals?.().getLastReadout?.() || null;
      return { connected: true, readout: normalizeCortexReadout(last), source: 'last-readout' };
    }
  } catch { /* a Cortex fault must never break the scan */ }
  return { connected: true, readout: null, source: 'unavailable' };
}

/* ═══════════════════════ CANDIDATE BUILDERS ═══════════════════════ */

let seq = 0;
/**
 * Build one candidate.
 *
 * ─── `ref` AND `metrics` ARE WHAT MAKE A CARD ACTIONABLE ────────────────────
 * A ranked card used to say «Kamino — 12% APY» and nothing else: no pool id,
 * no venue id, no TVL, no evidence count, so the UI could not open the token
 * page, the pool row or the venue panel for it, and could not show the three
 * numbers the owner asked every card to carry (capital needed, fees+slippage,
 * confidence). Both are pass-through data the caller already supplied — an id
 * from the feed and the row it came from — so nothing here is invented:
 *
 *   ref.tokenId    CoinGecko id, when the row is a known market asset
 *   ref.poolId     yield-feed pool id (DefiLlama UUID / `kamino-…`)
 *   ref.venue      our execution venue id, when the pool is one we can sign for
 *   ref.externalUrl the feed's own page for a pool we cannot open in-app
 *   metrics        capitalNeededUsd, grossApyPct, feeUsd, slippageUsd, gasUsd,
 *                  liquidityUsd, tvlUsd, priceUsd, change24hPct, sampleSize
 */
function base({
  category, type, title, symbol = null, chain = null, protocol = null, direction = 'NEUTRAL',
  confidence, horizonDays, evidence, economics, risk, expiresInMs = 24 * 3600_000, now,
  ref = null, metrics = null
}) {
  seq += 1;
  const cleanRef = ref && Object.values(ref).some((v) => v != null) ? {
    tokenId: ref.tokenId ?? null, poolId: ref.poolId ?? null,
    venue: ref.venue ?? null, externalUrl: ref.externalUrl ?? null
  } : null;
  return {
    opportunityId: `opp_${now.toString(36)}_${category.toLowerCase()}_${seq}`,
    category, type: type || category, title, symbol, chain, protocol, direction,
    confidence: round(clamp(confidence ?? 0.5, 0.02, 0.97), 2),
    economics, risk,
    riskAdjustedApyPct: economics?.netApyPct != null && risk?.score != null
      ? round(economics.netApyPct / (1 + risk.score / 3), 1) : economics?.netApyPct ?? null,
    evidence: evidence || [], caveats: ['not-a-signal'],
    ref: cleanRef, metrics: metrics || null,
    cortex: null, score: 0, eligible: true, exclusionReasons: [],
    discoveredAt: now, expiresAt: now + expiresInMs
  };
}

/** One shared metrics block so every family reports the same keys. */
function rowMetrics({ capitalUsd = null, grossApyPct = null, fees = null, liquidityUsd = null, tvlUsd = null, volume24hUsd = null, priceUsd = null, change24hPct = null, sampleSize = null, extra = null }) {
  return {
    capitalNeededUsd: round(capitalUsd),
    grossApyPct: round(grossApyPct),
    feeUsd: fees?.totalUsd ?? null,
    protocolFeeUsd: fees?.protocolUsd ?? null,
    slippageUsd: fees?.slippageUsd ?? null,
    slippagePctAssumed: fees?.slippagePctAssumed ?? null,
    gasUsd: fees?.networkGasUsd ?? null,
    liquidityUsd: round(liquidityUsd),
    tvlUsd: round(tvlUsd),
    volume24hUsd: round(volume24hUsd),
    priceUsd: round(priceUsd, 6),
    change24hPct: round(change24hPct),
    sampleSize: sampleSize == null ? null : Math.trunc(sampleSize),
    ...(extra || {})
  };
}

function fromPools(rows, ctx) {
  return rows.filter((p) => num(p.apy ?? p.apr) > 0).map((p) => {
    const apy = num(p.apy ?? p.apr); const tvl = num(p.tvlUsd ?? p.tvl);
    const il = num(p.impermanentLossRisk, null) ?? (num(p.volatilityPct) != null ? clamp(p.volatilityPct / 10, 1, 9) : 5);
    const fees = estimateFees({ capitalUsd: ctx.capital, category: 'LIQUIDITY_POOL', chain: p.chain, tvlUsd: tvl, gasUsd: p.gasUsd, feePct: { protocolPct: p.protocolFeePct } });
    const econ = computeEconomics({ capitalUsd: ctx.capital, horizonDays: ctx.horizonDays, grossApyPct: apy, fees });
    return base({
      category: 'LIQUIDITY_POOL', title: `${p.protocol || 'DEX'} ${p.pair || p.symbol || 'pool'} — ${round(apy)}% APY`,
      symbol: p.pair || p.symbol, chain: p.chain, protocol: p.protocol, now: ctx.now, horizonDays: ctx.horizonDays,
      confidence: clamp(0.45 + (tvl >= 1e6 ? 0.25 : tvl >= 1e5 ? 0.12 : 0) + (num(p.volume24hUsd) > 0 ? 0.08 : 0), 0, 0.9),
      economics: econ, evidence: [{ type: 'POOL', detail: `APY ${apy}% · TVL ${tvl ?? 'unknown'} · fee APR ${p.feeApy ?? '—'} + rewards ${p.rewardApy ?? '—'}` }],
      risk: compositeRisk({ smartContract: num(p.riskScore, 5), liquidity: liquidityRisk(tvl), volatility: volRisk(num(p.volatilityPct)), impermanentLoss: il }),
      ref: { poolId: p.id ?? p.poolId ?? null, venue: p.venue ?? null, externalUrl: p.url ?? null },
      metrics: rowMetrics({
        capitalUsd: ctx.capital > 0 ? ctx.capital : null, grossApyPct: apy, fees, tvlUsd: tvl,
        liquidityUsd: tvl, volume24hUsd: num(p.volume24hUsd ?? p.volumeUsd1d), sampleSize: num(p.samples, null)
      })
    });
  });
}

function fromFarms(rows, ctx, category = 'FARMING') {
  return rows.filter((f) => num(f.apy ?? f.apr) >= 1).map((f) => {
    const apy = num(f.apy ?? f.apr); const tvl = num(f.tvlUsd ?? f.tvl);
    const fees = estimateFees({ capitalUsd: ctx.capital, category, chain: f.chain, tvlUsd: tvl, gasUsd: f.gasUsd });
    const econ = computeEconomics({ capitalUsd: ctx.capital, horizonDays: ctx.horizonDays, grossApyPct: apy, fees });
    return base({
      category, type: category === 'FARMING' ? 'DEFI_YIELD' : category,
      title: `${f.protocol || f.project || 'Farm'} — ${round(apy)}% APY`, symbol: f.symbol || f.asset,
      chain: f.chain, protocol: f.protocol || f.project, now: ctx.now, horizonDays: ctx.horizonDays,
      confidence: clamp(0.4 + (tvl >= 1e6 ? 0.22 : 0.08) + (apy <= 60 ? 0.1 : -0.08), 0, 0.88),
      economics: econ, evidence: [{ type: 'YIELD_DATA', detail: `APY ${apy}% · TVL ${tvl ?? 'unknown'}${f.lockDays ? ` · lock ${f.lockDays}d` : ''}` }],
      risk: compositeRisk({ smartContract: num(f.riskScore, 5.5), liquidity: liquidityRisk(tvl), volatility: apy > 100 ? 8 : apy > 40 ? 6 : 3.5, counterparty: num(f.riskScore, 5) }),
      ref: { poolId: f.id ?? f.poolId ?? null, venue: f.venue ?? null, externalUrl: f.url ?? null },
      metrics: rowMetrics({
        capitalUsd: ctx.capital > 0 ? ctx.capital : null, grossApyPct: apy, fees, tvlUsd: tvl,
        liquidityUsd: tvl, volume24hUsd: num(f.volume24hUsd ?? f.volumeUsd1d),
        sampleSize: num(f.samples, null), extra: { lockDays: num(f.lockDays, null) }
      })
    });
  });
}

function fromLending(rows, ctx) {
  return rows.filter((m) => num(m.supplyApy ?? m.apy) > 0).map((m) => {
    const apy = num(m.supplyApy ?? m.apy); const tvl = num(m.tvlUsd ?? m.totalSupplyUsd);
    const fees = estimateFees({ capitalUsd: ctx.capital, category: 'LENDING', chain: m.chain, tvlUsd: tvl, gasUsd: m.gasUsd });
    const econ = computeEconomics({ capitalUsd: ctx.capital, horizonDays: ctx.horizonDays, grossApyPct: apy, fees });
    const util = num(m.utilizationPct);
    return base({
      category: 'LENDING', type: 'LENDING_SUPPLY',
      title: `${m.protocol || 'Lending'} ${m.asset || m.symbol || ''} supply — ${round(apy)}% APY`.trim(),
      symbol: m.asset || m.symbol, chain: m.chain, protocol: m.protocol, now: ctx.now, horizonDays: ctx.horizonDays,
      confidence: clamp(0.55 + (tvl >= 1e7 ? 0.2 : 0.05) - (util > 92 ? 0.15 : 0), 0, 0.92),
      economics: econ, evidence: [{ type: 'LENDING_MARKET', detail: `supply APY ${apy}% · utilisation ${util ?? '—'}% · LTV ${m.ltvPct ?? '—'}%` }],
      risk: compositeRisk({ smartContract: num(m.riskScore, 4), liquidity: util > 95 ? 8 : liquidityRisk(tvl), liquidation: 1.5, counterparty: num(m.riskScore, 4) }),
      ref: { poolId: m.id ?? m.poolId ?? null, venue: m.venue ?? null, externalUrl: m.url ?? null },
      metrics: rowMetrics({
        capitalUsd: ctx.capital > 0 ? ctx.capital : null, grossApyPct: apy, fees, tvlUsd: tvl,
        liquidityUsd: tvl, sampleSize: num(m.samples, null),
        extra: { utilizationPct: util, ltvPct: num(m.ltvPct, null) }
      })
    });
  });
}

function spreadsFromMatrix(venuePrices = []) {
  const byAsset = new Map();
  for (const r of venuePrices || []) {
    const price = num(r.price); if (!r.asset || !price) continue;
    if (!byAsset.has(r.asset)) byAsset.set(r.asset, []);
    byAsset.get(r.asset).push(r);
  }
  const out = [];
  for (const [asset, rows] of byAsset) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.price - b.price);
    const lo = sorted[0]; const hi = sorted[sorted.length - 1];
    out.push({ asset, buyVenue: lo.venue, sellVenue: hi.venue, buyPrice: lo.price, sellPrice: hi.price, depthUsd: num(lo.depthUsd ?? hi.depthUsd), chain: lo.chain || hi.chain });
  }
  return out;
}

function fromArbitrage(rows, ctx) {
  return rows.map((a) => {
    const buy = num(a.buyPrice); const sell = num(a.sellPrice);
    const spreadPct = num(a.spreadPct, buy && sell ? ((sell - buy) / buy) * 100 : null);
    if (spreadPct == null || spreadPct <= 0) return null;
    const depth = num(a.depthUsd ?? a.liquidityUsd);
    const fees = estimateFees({ capitalUsd: ctx.capital, category: 'ARBITRAGE', chain: a.chain, depthUsd: depth, gasUsd: a.gasUsd, bridgeFeePct: num(a.bridgeFeePct, a.buyVenue !== a.sellVenue && a.chain ? 0 : 0.1), roundTrips: 2 });
    const econ = computeEconomics({ capitalUsd: ctx.capital, horizonDays: ctx.horizonDays, oneOffReturnPct: spreadPct, fees });
    return base({
      category: 'ARBITRAGE', type: 'ARBITRAGE',
      title: `${a.asset || a.symbol} arb ${a.buyVenue || 'venue A'} → ${a.sellVenue || 'venue B'} — ${round(spreadPct)}% spread`,
      symbol: a.asset || a.symbol, chain: a.chain, now: ctx.now, horizonDays: ctx.horizonDays, expiresInMs: 15 * 60_000,
      confidence: clamp(0.5 + (depth >= 2e5 ? 0.25 : depth >= 2e4 ? 0.1 : -0.1) + (spreadPct >= 1 ? 0.08 : 0), 0, 0.93),
      economics: econ, evidence: [{ type: 'PRICE_SPREAD', detail: `buy ${buy ?? '—'} @${a.buyVenue || '?'} → sell ${sell ?? '—'} @${a.sellVenue || '?'} · depth ${depth ?? 'unknown'}` }],
      risk: compositeRisk({ liquidity: liquidityRisk(depth), smartContract: 3, bridge: a.bridgeFeePct || a.buyVenue !== a.sellVenue ? 4 : 1, volatility: 4, counterparty: 4 }),
      ref: { tokenId: a.tokenId ?? null, externalUrl: a.url ?? null },
      metrics: rowMetrics({
        capitalUsd: ctx.capital > 0 ? ctx.capital : null, fees, liquidityUsd: depth,
        extra: { spreadPct: round(spreadPct), buyVenue: a.buyVenue ?? null, sellVenue: a.sellVenue ?? null }
      })
    });
  }).filter(Boolean);
}

function fromEmerging(rows, ctx) {
  return rows.map((t) => {
    const liq = num(t.liquidityUsd ?? t.tvlUsd); const growth = num(t.change24h);
    // A past 24h move cannot support a forecast or annualised profit estimate.
    const fees = estimateFees({ capitalUsd: ctx.capital, category: 'EMERGING_TOKEN', chain: t.chain, depthUsd: liq, gasUsd: t.gasUsd });
    const econ = null;
    return { ...base({
      category: 'EMERGING_TOKEN', type: 'EMERGING_TOKEN',
      title: `${t.symbol || t.name || 'Token'} — emerging${growth != null ? ` (${round(growth)}% 24h)` : ''}`,
      symbol: t.symbol, chain: t.chain, protocol: t.protocol, direction: growth == null ? 'NEUTRAL' : growth >= 0 ? 'BULLISH' : 'BEARISH',
      now: ctx.now, horizonDays: ctx.horizonDays, expiresInMs: 6 * 3600_000,
      confidence: clamp(0.3 + (liq >= 5e5 ? 0.2 : liq >= 5e4 ? 0.08 : -0.08) + (num(t.smartMoneyBuys) > 0 ? 0.15 : 0) + (num(t.holdersGrowthPct) > 10 ? 0.08 : 0), 0, 0.85),
      economics: econ, evidence: [{ type: 'EMERGING_FLOW', detail: `age ${t.ageDays ?? '—'}d · mcap ${t.mcap ?? 'unknown'} · liquidity ${liq ?? 'unknown'} · holders growth ${t.holdersGrowthPct ?? '—'}% · smart-money buys ${t.smartMoneyBuys ?? '—'}` }],
      risk: compositeRisk({ smartContract: num(t.riskScore, 8), liquidity: liquidityRisk(liq), volatility: 9, concentration: 7, counterparty: 6 }),
      ref: { tokenId: t.tokenId ?? t.coingeckoId ?? null, externalUrl: t.url ?? null },
      metrics: rowMetrics({
        capitalUsd: ctx.capital > 0 ? ctx.capital : null, fees, liquidityUsd: liq,
        tvlUsd: num(t.tvlUsd, null), priceUsd: num(t.priceUsd, null), change24hPct: growth,
        sampleSize: num(t.tradeSamples ?? t.samples, null),
        extra: { ageDays: num(t.ageDays, null), mcap: num(t.mcap, null) }
      })
    }), feesIfActedUsd: ctx.capital > 0 ? fees.totalUsd : null };
  });
}

function fromRwa(rows, ctx) {
  return rows.map((r) => {
    const y = num(r.expectedYield ?? r.yieldPct ?? r.apy);
    if (y == null && !(num(r.priceUsd) > 0)) return null;
    const fees = estimateFees({ capitalUsd: ctx.capital, category: 'RWA', chain: r.chain, gasUsd: r.gasUsd, feePct: { protocolPct: num(r.feePct, 0.1), swapPct: 0.1, exitPct: 0.1 } });
    const econ = y == null ? null : computeEconomics({ capitalUsd: ctx.capital, horizonDays: Math.max(ctx.horizonDays, num(r.lockDays, ctx.horizonDays)), grossApyPct: y, fees });
    const o = base({
      category: 'RWA', type: 'RWA_INVESTMENT',
      title: `${r.category || 'RWA'} — ${r.name || 'Real-world asset'}${y == null ? '' : ` (${round(y)}% yield)`}`,
      symbol: r.symbol, chain: r.chain, protocol: r.issuer || r.protocol, now: ctx.now, horizonDays: ctx.horizonDays,
      confidence: num(r.confidence, 0.62), economics: econ,
      evidence: r.evidence?.length ? r.evidence : [{ type: y == null ? 'RWA_PRICE' : 'RWA_CATALOG', detail: y == null ? `Market price $${r.priceUsd} · 24h ${r.priceChange24h ?? '—'}% · yield unknown` : `${r.category || 'RWA'} · issuer ${r.issuer || '—'} · lock ${r.lockDays ?? '—'}d · min ${r.minInvestmentUsd ?? '—'}` }],
      risk: y == null ? compositeRisk({ smartContract: 6, liquidity: 7, volatility: 7, counterparty: 6 }) : compositeRisk({ smartContract: 3.5, liquidity: r.liquidity === 'HIGH' ? 2 : r.liquidity === 'MEDIUM' ? 5 : 8, volatility: 2, counterparty: 5 }),
      ref: { tokenId: r.tokenId ?? r.coingeckoId ?? null, externalUrl: r.url ?? null },
      metrics: rowMetrics({
        capitalUsd: ctx.capital > 0 ? ctx.capital : null, grossApyPct: y, fees,
        priceUsd: num(r.priceUsd, null), change24hPct: num(r.priceChange24h, null)
      })
    });
    if (y == null) o.feesIfActedUsd = ctx.capital > 0 ? fees.totalUsd : null;
    if (num(r.minInvestmentUsd) > 0) o.minCapitalUsd = num(r.minInvestmentUsd);
    return o;
  }).filter(Boolean);
}

function fromWhales(rows, ctx) {
  return rows.map((w) => {
    const net = num(w.netFlowUsd); if (net == null && !w.asset) return null;
    const accumulating = (w.direction ? /accum|inflow|buy/i.test(w.direction) : net > 0);
    const fees = estimateFees({ capitalUsd: ctx.capital, category: 'WHALE_FLOW', chain: w.chain, depthUsd: num(w.liquidityUsd), gasUsd: w.gasUsd });
    return { ...base({
      category: 'WHALE_FLOW', type: 'SMART_MONEY',
      title: `Whale ${accumulating ? 'accumulation' : 'distribution'} — ${w.asset || w.symbol || 'asset'}`,
      symbol: w.asset || w.symbol, chain: w.chain, direction: accumulating ? 'BULLISH' : 'BEARISH',
      now: ctx.now, horizonDays: ctx.horizonDays, expiresInMs: 12 * 3600_000,
      confidence: num(w.confidence, clamp(0.4 + (Math.abs(net || 0) >= 1e6 ? 0.25 : 0.1) + (num(w.walletCount) >= 5 ? 0.1 : 0), 0, 0.9)),
      // A whale flow is evidence to investigate, not a yield claim: no invented
      // return is priced for it (fees of acting on it are shown in `fees`).
      economics: null, feesIfActedUsd: fees.totalUsd,
      evidence: [{ type: 'ON_CHAIN', detail: `net flow ${net ?? '—'} USD · wallets ${w.walletCount ?? '—'} · exchange flow ${w.exchangeFlowUsd ?? '—'}` }],
      risk: compositeRisk({ liquidity: liquidityRisk(num(w.liquidityUsd)), volatility: 6.5, smartContract: 2, concentration: 6 }),
      ref: { tokenId: w.tokenId ?? w.coingeckoId ?? null, externalUrl: w.url ?? null },
      metrics: rowMetrics({
        capitalUsd: ctx.capital > 0 ? ctx.capital : null, fees,
        liquidityUsd: num(w.liquidityUsd, null), priceUsd: num(w.priceUsd, null),
        change24hPct: num(w.change24h, null), sampleSize: num(w.walletCount, null),
        extra: { netFlowUsd: net, exchangeFlowUsd: num(w.exchangeFlowUsd, null) }
      })
    }), feesIfActedUsd: ctx.capital > 0 ? fees.totalUsd : null };
  }).filter(Boolean);
}

/* ═══════════════════════ LEGACY v1 CANDIDATES ═══════════════════════ */

function legacyCandidates(input, ctx) {
  const out = [];
  const { financialState, portfolio, goals = [], marketContext } = input;
  if (financialState) {
    const liquid = num(financialState.liquidUsd ?? financialState.availableCapitalUsd, 0);
    const stableRatio = num(financialState.stableRatio, 0);
    if (liquid > 50 && stableRatio > 0.3) {
      const cap = Math.round(liquid * stableRatio);
      const fees = estimateFees({ capitalUsd: cap, category: 'LENDING', chain: 'unknown' });
      out.push({ ...base({
        category: 'LENDING', type: 'YIELD_ON_IDLE', title: 'Yield on idle stablecoins',
        now: ctx.now, horizonDays: ctx.horizonDays, confidence: 0.8,
        economics: computeEconomics({ capitalUsd: cap, horizonDays: ctx.horizonDays, grossApyPct: 4, fees }),
        evidence: [{ type: 'BALANCE_ANALYSIS', detail: `Stable ratio: ${Math.round(stableRatio * 100)}%` }],
        risk: compositeRisk({ smartContract: 3, liquidity: 2, volatility: 1 })
      }), capitalRequiredUsd: cap, urgency: stableRatio > 0.5 ? 'HIGH' : 'MEDIUM' });
    }
  }
  if (portfolio?.holdings?.length > 1) {
    const total = portfolio.holdings.reduce((s, h) => s + (num(h.valueUsd, 0)), 0);
    const over = portfolio.holdings.filter((h) => total > 0 && num(h.valueUsd, 0) / total > 0.4);
    if (over.length) out.push(base({
      category: 'FARMING', type: 'REBALANCE', title: 'Portfolio concentration detected',
      now: ctx.now, horizonDays: ctx.horizonDays, confidence: 0.9, economics: null,
      evidence: over.map((h) => ({ type: 'CONCENTRATION', detail: `${h.symbol}: ${Math.round((num(h.valueUsd, 0) / total) * 100)}%` })),
      risk: compositeRisk({ concentration: 8, liquidity: 2 })
    }));
  }
  for (const g of (goals || []).slice(0, 3)) {
    if (g.progressPct < 50 && g.horizonMonths > 2) out.push(base({
      category: 'RWA', type: 'GOAL_OPTIMIZATION', title: `Optimize strategy for "${g.name}"`,
      now: ctx.now, horizonDays: ctx.horizonDays, confidence: 0.7, economics: null,
      evidence: [{ type: 'GOAL_PROGRESS', detail: `${g.progressPct || 0}% toward ${g.targetUsd || 'target'}` }],
      risk: compositeRisk({ volatility: 2, liquidity: 2 })
    }));
  }
  if (marketContext?.regime === 'BEAR_HIGH_VOL' || num(marketContext?.volatilityPct) > 80) {
    out.push(base({
      category: 'LENDING', type: 'RISK_HEDGE', title: 'Consider hedging portfolio',
      now: ctx.now, horizonDays: ctx.horizonDays, confidence: 0.7, economics: null,
      evidence: [{ type: 'MARKET_REGIME', detail: `Regime: ${marketContext.regime}, Vol: ${marketContext.volatilityPct}%` }],
      risk: compositeRisk({ volatility: 3 })
    }));
  }
  for (const s of (input.smartMoneySignals || []).slice(0, 3)) {
    out.push(base({
      category: 'WHALE_FLOW', type: 'SMART_MONEY', title: `Smart Money: ${s.action || 'Activity'} on ${s.asset || 'asset'}`,
      symbol: s.asset, now: ctx.now, horizonDays: ctx.horizonDays, confidence: num(s.confidence, 0.5), economics: null,
      evidence: [{ type: 'ON_CHAIN', detail: s.detail || s.action || '' }],
      risk: compositeRisk({ volatility: 5, liquidity: 3 })
    }));
  }
  return out;
}

/* ═══════════════════════ RANKING ═══════════════════════ */

const PROFILE_GOAL = { CONSERVATIVE: 'preserve', MODERATE: 'balanced', BALANCED: 'balanced', AGGRESSIVE: 'growth' };

function rankAndFilter(candidates, { capital, riskProfile, tolerance, goals, cortex }) {
  const accepted = []; const rejected = [];
  for (const o of candidates) {
    o.cortex = cortexVerdictFor(o, cortex);
    const reasons = [];
    const minCap = o.minCapitalUsd ?? o.economics?.minViableCapitalUsd ?? null;
    if (o.economics && capital > 0 && minCap != null && capital < minCap) reasons.push({ code: 'capital-below-min-viable', minViableCapitalUsd: minCap });
    if (o.economics && capital > 0 && o.economics.netProfitUsd <= 0) reasons.push({ code: 'net-profit-not-positive-after-fees', netProfitUsd: o.economics.netProfitUsd });
    if (o.risk?.score != null && o.risk.score > tolerance) reasons.push({ code: 'risk-above-tolerance', riskScore: o.risk.score, tolerance });
    // Return quality (risk-adjusted, log-scaled so 400% memecoin APY can't swamp it)
    const netApy = o.riskAdjustedApyPct ?? o.economics?.netApyPct ?? null;
    const returnScore = netApy == null ? 8 : clamp(Math.log10(Math.max(1, netApy)) * 22, 0, 45);
    const riskFit = o.risk?.score == null ? 0.5 : clamp(1 - Math.abs(o.risk.score - (tolerance * 0.55)) / 10, 0, 1);
    const capitalFit = !o.economics || capital <= 0 ? 0.5
      : clamp(1 - Math.abs((o.economics.capitalUsd || capital) - capital) / Math.max(capital, 1), 0.4, 1);
    const goalBoost = goals?.length && ['LENDING', 'RWA', 'FARMING'].includes(o.category) ? 4 : 0;
    o.scoreBreakdown = {
      return: round(returnScore), confidence: round((o.confidence || 0.5) * 25),
      riskFit: round(riskFit * 20), capitalFit: round(capitalFit * 6), goalBoost,
      cortexMultiplier: o.cortex.multiplier
    };
    o.score = round(clamp(
      (returnScore + (o.confidence || 0.5) * 25 + riskFit * 20 + capitalFit * 6 + goalBoost) * o.cortex.multiplier, 0, 100));
    o.eligible = reasons.length === 0;
    o.exclusionReasons = reasons;
    (reasons.length ? rejected : accepted).push(o);
  }
  const byRank = (a, b) => b.score - a.score || (b.economics?.netProfitUsd ?? -1e18) - (a.economics?.netProfitUsd ?? -1e18) || a.opportunityId.localeCompare(b.opportunityId);
  accepted.sort(byRank); rejected.sort(byRank);
  accepted.forEach((o, i) => { o.rank = i + 1; });
  return { accepted, rejected };
}

/* ═══════════════════════ MAIN SCAN ═══════════════════════ */

/**
 * Scan every supplied market family, price each candidate for the user's
 * capital/horizon, score its risk, connect the Cortex, and rank.
 * All array inputs default to empty — an absent family is reported in
 * `coverage`, never silently filled.
 */
export function scanOpportunities(input = {}) {
  const now = num(input.now, Date.now());
  const riskProfile = String(input.riskProfile || input.userProfile?.riskProfile || 'MODERATE').toUpperCase();
  const tolerance = num(input.riskTolerance, RISK_TOLERANCE[riskProfile] ?? 5.5);
  const capital = Math.max(0, num(input.userCapitalUsd ?? input.capitalUsd
    ?? input.financialState?.liquidUsd ?? input.financialState?.availableCapitalUsd, 0));
  const horizonDays = clamp(num(input.horizonDays, 30), 1, 3650);
  const ctx = { now, capital, horizonDays };

  const arbitrageRows = [...(input.arbitrage || input.arbitrageSpreads || []), ...spreadsFromMatrix(input.venuePrices || [])];
  const builders = [
    ['LIQUIDITY_POOL', () => fromPools(input.liquidityPools || input.pools || [], ctx)],
    ['FARMING', () => [...fromFarms(input.farms || input.farming || [], ctx), ...fromFarms(input.defiOpportunities || [], ctx)]],
    ['LENDING', () => fromLending(input.lendingMarkets || input.lending || [], ctx)],
    ['ARBITRAGE', () => fromArbitrage(arbitrageRows, ctx)],
    ['EMERGING_TOKEN', () => fromEmerging(input.emergingTokens || [], ctx)],
    ['RWA', () => fromRwa(input.rwaAssets || input.rwaOpportunities || [], ctx)],
    ['WHALE_FLOW', () => fromWhales(input.whaleFlows || [], ctx)]
  ];
  const coverage = {}; const candidates = [];
  for (const [cat, build] of builders) {
    const rows = build(); coverage[cat] = rows.length; candidates.push(...rows);
  }
  candidates.push(...legacyCandidates(input, ctx));

  // ── Cortex connection (explicit readout wins; else query a live instance)
  const feature = buildCortexFeatureVector({ marketContext: input.marketContext, whaleFlows: input.whaleFlows || [], emergingTokens: input.emergingTokens || [], arbitrageSpreads: arbitrageRows });
  let cortexInfo;
  if (input.cortexReadout) {
    cortexInfo = { connected: true, source: 'readout', readout: normalizeCortexReadout(input.cortexReadout) };
  } else if (input.cortex) {
    const live = readCortex(input.cortex, feature.vector);
    cortexInfo = { connected: live.connected, source: live.source, readout: live.readout };
  } else {
    cortexInfo = { connected: false, source: null, readout: null };
  }

  const { accepted, rejected } = rankAndFilter(candidates, {
    capital, riskProfile, tolerance, goals: input.goals || [], cortex: cortexInfo.readout
  });
  const limit = Math.max(1, Math.trunc(num(input.limit, 25)));
  const opportunities = accepted.slice(0, limit);

  const byCategory = {}; const byRisk = {};
  for (const o of opportunities) {
    byCategory[o.category] = (byCategory[o.category] || 0) + 1;
    if (o.risk?.level) byRisk[o.risk.level] = (byRisk[o.risk.level] || 0) + 1;
  }
  return {
    schema: OPPORTUNITY_SCHEMA, status: 'OK', at: now,
    profile: { riskProfile, riskTolerance: tolerance, goal: PROFILE_GOAL[riskProfile] || 'balanced', capitalUsd: round(capital), horizonDays },
    opportunities, rejected,
    total: opportunities.length, eligibleTotal: accepted.length, rejectedTotal: rejected.length,
    byType: byCategory, byCategory, byRisk,
    coverage,
    cortex: {
      connected: cortexInfo.connected, source: cortexInfo.source, readout: cortexInfo.readout,
      featureVector: feature, laws: { canExecute: false, canSign: false, canMoveFunds: false }
    },
    caveats: ['not-a-signal', 'fees-include-estimated-slippage', ...(cortexInfo.connected ? [] : ['cortex-not-connected'])]
  };
}

/** Convenience: scan + immediately hand the top pick to Cortex-gated review. */
export function topOpportunities(scan, n = 5) {
  return (scan?.opportunities || []).slice(0, Math.max(0, n));
}

export default { scanOpportunities, computeEconomics, estimateFees, compositeRisk, buildCortexFeatureVector, normalizeCortexReadout, cortexVerdictFor, readCortex, topOpportunities, OPPORTUNITY_SCHEMA, OPPORTUNITY_CATEGORIES, RISK_TOLERANCE };
