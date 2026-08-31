/**
 * SMART MONEY — DETECTION & SCORING ENGINES
 * ---------------------------------------------------------------------------
 * Pure functions over observed on-chain data. Nothing here invents data:
 * every factor is a normalisation of something the indexer actually saw, and
 * any factor with no evidence is skipped (its weight redistributes), with the
 * resulting `coverage` reported alongside every score so the UI can say
 * "based on 6 of 9 factors".
 *
 * Critical product rule: scores describe BEHAVIOUR. They are not buy signals,
 * not profit guarantees and never a claim of insider information. A wallet
 * that merely resembles an insider is labelled "insider-like behaviour".
 */

import {
  ACCUMULATION,
  DISTRIBUTION,
  SMART_MONEY_SCORE,
  REPUTATION,
  WALLET_RISK,
  CLASSIFY,
  clampScore,
  weighted
} from './config.js';

const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);

/* ═══════════════════════ Smart Money Score ═════════════════════════════ */
/*
 * data: { profitability, consistency, earlyEntries, riskAdjustedReturn,
 *         liquidityAwareness, holdingQuality }  — each 0..1 or null.
 */
export function calculateSmartMoneyScore(data = {}) {
  const parts = {
    profitability: clamp01(data.profitability),
    consistency: clamp01(data.consistency),
    earlyEntries: clamp01(data.earlyEntries),
    riskAdjustedReturn: clamp01(data.riskAdjustedReturn),
    liquidityAwareness: clamp01(data.liquidityAwareness),
    holdingQuality: clamp01(data.holdingQuality)
  };
  const { score, coverage } = weighted(parts, SMART_MONEY_SCORE.weights);
  return { score: clampScore(score), coverage: Math.round(coverage * 100) / 100, factors: parts };
}

/* ═══════════════════════ Reputation ════════════════════════════════════ */

export function calculateReputation(data = {}) {
  const parts = {
    historicalPerformance: clamp01(data.historicalPerformance),
    tradingConsistency: clamp01(data.tradingConsistency),
    realizedPnl: clamp01(data.realizedPnl),
    winRate: clamp01(data.winRate),
    holdingDuration: clamp01(data.holdingDuration),
    liquidityAwareness: clamp01(data.liquidityAwareness),
    tokenSelection: clamp01(data.tokenSelection),
    counterpartyRisk: data.counterpartyRisk == null ? null : 1 - clamp01(data.counterpartyRisk),
    scamExposure: data.scamExposure == null ? null : 1 - clamp01(data.scamExposure)
  };
  const { score, coverage } = weighted(parts, REPUTATION.weights);
  return { score: clampScore(score), coverage: Math.round(coverage * 100) / 100, factors: parts };
}

/* ═══════════════════════ Risk ══════════════════════════════════════════ */
/*
 * Higher score = RISKIER. Each factor is "how bad" on 0..1. Returns both the
 * numeric score and human-readable +/- reasons (the "Why?" panel), generated
 * from the same evidence the score used.
 */
export function calculateWalletRisk(data = {}) {
  const parts = {
    scamInteraction: clamp01(data.scamInteraction),
    suspiciousContracts: clamp01(data.suspiciousContracts),
    extremeConcentration: clamp01(data.extremeConcentration),
    bridgeExposure: clamp01(data.bridgeExposure),
    cexExposure: clamp01(data.cexExposure),
    highLeverage: clamp01(data.highLeverage),
    lowLiquidityTokens: clamp01(data.lowLiquidityTokens)
  };
  const { score, coverage } = weighted(parts, WALLET_RISK.weights);
  const num = clampScore(score);
  const band = num < 34 ? 'LOW' : num < 67 ? 'MEDIUM' : 'HIGH';
  return { score: num, band, coverage: Math.round(coverage * 100) / 100, factors: parts, reasons: riskReasons(parts, data) };
}

function riskReasons(parts, raw = {}) {
  const plus = []; // risk-reducing
  const minus = []; // risk-adding
  if (parts.scamInteraction != null) {
    (parts.scamInteraction < 0.1 ? plus : minus).push(
      parts.scamInteraction < 0.1 ? 'No interaction with known scam contracts' : 'Interacted with flagged scam contracts'
    );
  }
  if (parts.extremeConcentration != null) {
    (parts.extremeConcentration < 0.5 ? plus : minus).push(
      parts.extremeConcentration < 0.5 ? 'Diversified portfolio' : 'Extreme concentration in one asset'
    );
  }
  if (parts.lowLiquidityTokens != null) {
    (parts.lowLiquidityTokens < 0.3 ? plus : minus).push(
      parts.lowLiquidityTokens < 0.3 ? 'Holds mostly liquid assets' : 'High exposure to low-liquidity tokens'
    );
  }
  if (parts.cexExposure != null) {
    (parts.cexExposure < 0.5 ? plus : minus).push(
      parts.cexExposure < 0.5 ? 'Low dependence on exchange custody' : 'Heavy exchange-custody exposure'
    );
  }
  if (parts.bridgeExposure != null && parts.bridgeExposure > 0.5) {
    minus.push('Significant cross-chain bridge exposure');
  }
  if (parts.highLeverage != null && parts.highLeverage > 0.5) {
    minus.push('History of high-leverage positions');
  }
  if (parts.suspiciousContracts != null && parts.suspiciousContracts > 0.3) {
    minus.push('Interactions with unverified/suspicious contracts');
  }
  if (raw.longTermHolding) plus.push('Long-term holding history');
  return { plus, minus };
}

/* ═════════════════════ Accumulation / Distribution ═════════════════════ */
/*
 * Each detector is a weighted score of INDEPENDENT observed signals, all
 * pre-normalised to 0..1 by the caller. Thresholds live in config.
 */
export function detectAccumulation(signals = {}) {
  const parts = {
    netBuying: clamp01(signals.netBuying),
    holderGrowth: clamp01(signals.holderGrowth),
    smartMoneyBuying: clamp01(signals.smartMoneyBuying),
    exchangeOutflow: clamp01(signals.exchangeOutflow),
    liquidityGrowth: clamp01(signals.liquidityGrowth)
  };
  const { score, coverage } = weighted(parts, ACCUMULATION.weights);
  const num = clampScore(score);
  return {
    detected: num >= ACCUMULATION.threshold,
    confidence: num,
    coverage: Math.round(coverage * 100) / 100,
    threshold: ACCUMULATION.threshold,
    signals: parts
  };
}

export function detectDistribution(signals = {}) {
  const parts = {
    netSelling: clamp01(signals.netSelling),
    holderDecline: clamp01(signals.holderDecline),
    smartMoneySelling: clamp01(signals.smartMoneySelling),
    exchangeInflow: clamp01(signals.exchangeInflow),
    topHolderReduction: clamp01(signals.topHolderReduction)
  };
  const { score, coverage } = weighted(parts, DISTRIBUTION.weights);
  const num = clampScore(score);
  return {
    detected: num >= DISTRIBUTION.threshold,
    confidence: num,
    coverage: Math.round(coverage * 100) / 100,
    threshold: DISTRIBUTION.threshold,
    signals: parts
  };
}

/* ═════════════════════ Behaviour classification ════════════════════════ */
/*
 * Tags are descriptive behaviour labels. "insider-like behaviour" is used
 * instead of "insider" — we can observe early profitable entries, we cannot
 * prove non-public information, and must never claim it.
 */
export function classifyWallet(stats = {}) {
  const tags = [];
  const {
    portfolioUsd = 0,
    realizedPnlUsd = null,
    winRate = null,
    trades = 0,
    earlyEntries = 0,
    medianHoldingDays = null,
    volume30dUsd = 0,
    dexTradeShare = null,
    firstEntryBeforeAgeDays = null
  } = stats;

  if (portfolioUsd >= 5_000_000 || volume30dUsd >= CLASSIFY.highVolume30dUsd) tags.push('WHALE');
  if (
    winRate != null &&
    winRate >= CLASSIFY.profitableWinRate &&
    trades >= CLASSIFY.profitableMinTrades &&
    realizedPnlUsd != null &&
    realizedPnlUsd > 0
  ) {
    tags.push('PROFITABLE_TRADER');
  }
  if (earlyEntries >= CLASSIFY.earlyBuyerMinTrades || (firstEntryBeforeAgeDays != null && firstEntryBeforeAgeDays <= CLASSIFY.earlyBuyerMaxAgeDays)) {
    tags.push('EARLY_BUYER');
  }
  if (medianHoldingDays != null && medianHoldingDays >= CLASSIFY.longTermHolderDays) tags.push('LONG_TERM_HOLDER');
  if (volume30dUsd >= CLASSIFY.highVolume30dUsd) tags.push('HIGH_VOLUME');
  if (dexTradeShare != null && dexTradeShare >= CLASSIFY.dexTraderShare) tags.push('DEX_TRADER');

  // Smart Money = profitable AND early AND reasonably active.
  const profitable = tags.includes('PROFITABLE_TRADER');
  const early = tags.includes('EARLY_BUYER');
  if (profitable && early) tags.unshift('SMART_MONEY');
  else if (profitable || early) tags.unshift('SMART_MONEY');

  // Insider-LIKE behaviour (never "insider"): early entries that then
  // materially outperformed. Behavioural resemblance only.
  if (early && profitable && earlyEntries >= 3) tags.push('INSIDER_LIKE_BEHAVIOR');

  return [...new Set(tags)];
}

/* ═════════════════════ Period change helper ═══════════════════════════ */

export function pctChange(now, prev) {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((now - prev) / Math.abs(prev)) * 1000) / 10;
}
