/**
 * SMART MONEY — central configuration.
 * ---------------------------------------------------------------------------
 * Every threshold, weight and time window used by the detection/scoring
 * engines lives here so nothing is hard-coded inside an algorithm. Override
 * any value through SM_* environment variables (ops-tuning without a deploy)
 * or by editing this one file.
 *
 * The scorer is deliberately transparent: a wallet's Smart Money Score is a
 * documented weighted sum of behavioural sub-scores. The numbers are NOT
 * investment advice and NOT a prediction — they describe observed behaviour.
 */

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const env = process.env;

/* ── Time windows (milliseconds) ───────────────────────────────────────── */

export const WINDOWS = {
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  H24: 24 * 60 * 60_000,
  D7: 7 * 24 * 60 * 60_000,
  D30: 30 * 24 * 60 * 60_000
};

export const WINDOW_KEYS = {
  '1h': WINDOWS.H1,
  '4h': WINDOWS.H4,
  '24h': WINDOWS.H24,
  '7d': WINDOWS.D7,
  '30d': WINDOWS.D30
};

/* ── Value floors (USD) ────────────────────────────────────────────────── */

export const FLOORS = {
  /** A transfer has to be at least this large to count as a "whale" event. */
  whaleUsd: num(env.SM_WHALE_USD, 250_000),
  /** A DEX trade this large counts toward top buyers/sellers. */
  bigTradeUsd: num(env.SM_BIG_TRADE_USD, 100_000),
  /** Wallet must control at least this much to enter the whale board. */
  whalePortfolioUsd: num(env.SM_WHALE_PORTFOLIO_USD, 5_000_000),
  /** A liquidity event this large is surfaced in the feed. */
  liquidityEventUsd: num(env.SM_LP_EVENT_USD, 200_000)
};

/* ── Accumulation / Distribution detector ──────────────────────────────── */
/*
 * Weighted scoring of independent on-chain observations. Each component is
 * normalised to [0,1] by the engine, then combined. A score at/over the
 * detection threshold raises the signal; confidence is the score itself —
 * it expresses how strong the observed pattern is, never a probability of
 * a price move.
 */

export const ACCUMULATION = {
  threshold: num(env.SM_ACCUMULATION_THRESHOLD, 70),
  weights: {
    netBuying: 0.28,
    holderGrowth: 0.18,
    smartMoneyBuying: 0.24,
    exchangeOutflow: 0.16,
    liquidityGrowth: 0.14
  }
};

export const DISTRIBUTION = {
  threshold: num(env.SM_DISTRIBUTION_THRESHOLD, 70),
  weights: {
    netSelling: 0.28,
    holderDecline: 0.14,
    smartMoneySelling: 0.24,
    exchangeInflow: 0.18,
    topHolderReduction: 0.16
  }
};

/* ── Smart Money Score (wallet-level, 0–100) ───────────────────────────── */

export const SMART_MONEY_SCORE = {
  weights: {
    profitability: 0.26,
    consistency: 0.18,
    earlyEntries: 0.16,
    riskAdjustedReturn: 0.16,
    liquidityAwareness: 0.12,
    holdingQuality: 0.12
  }
};

/* ── Reputation Score (wallet-level, 0–100) ────────────────────────────── */

export const REPUTATION = {
  weights: {
    historicalPerformance: 0.20,
    tradingConsistency: 0.16,
    realizedPnl: 0.16,
    winRate: 0.16,
    holdingDuration: 0.10,
    liquidityAwareness: 0.08,
    tokenSelection: 0.08,
    counterpartyRisk: 0.03,
    scamExposure: 0.03
  }
};

/* ── Risk Score (wallet-level, 0–100, higher = riskier) ────────────────── */

export const WALLET_RISK = {
  /* Each component contributes its weight when fully "bad" (0..1). */
  weights: {
    scamInteraction: 0.30,
    suspiciousContracts: 0.20,
    extremeConcentration: 0.14,
    bridgeExposure: 0.10,
    cexExposure: 0.06,
    highLeverage: 0.10,
    lowLiquidityTokens: 0.10
  }
};

/* ── Wallet behaviour classification thresholds ────────────────────────── */

export const CLASSIFY = {
  /** Minimum realised win rate to be tagged a profitable trader. */
  profitableWinRate: 0.55,
  profitableMinTrades: 5,
  /** Buying within the first N days of a token's first observed DEX pool. */
  earlyBuyerMaxAgeDays: 7,
  earlyBuyerMinTrades: 2,
  /** Median holding duration (days) that separates holders from traders. */
  longTermHolderDays: 90,
  /** USD volume over the lookback window for HIGH VOLUME. */
  highVolume30dUsd: num(env.SM_HIGH_VOLUME_USD, 25_000_000),
  /** DEX trade share of activity for DEX TRADER. */
  dexTraderShare: 0.7,
  /** A wallet this age (ms) with real capital is "fresh and interesting". */
  freshWalletMaxAgeMs: WINDOWS.H24
};

/* ── Fresh wallet detection ───────────────────────────────────────────── */

export const FRESH = {
  maxAgeMs: WINDOWS.H24,
  minCapitalUsd: num(env.SM_FRESH_MIN_CAPITAL, 100_000),
  interestingMinUsd: num(env.SM_FRESH_INTERESTING_USD, 500_000)
};

/* ── Early token detection ────────────────────────────────────────────── */

export const EARLY_TOKEN = {
  maxAgeHours: num(env.SM_EARLY_MAX_AGE_HRS, 72),
  minLiquidityUsd: num(env.SM_EARLY_MIN_LIQUIDITY, 50_000),
  minHolders: num(env.SM_EARLY_MIN_HOLDERS, 100),
  minSmartWallets: 2,
  minVolumeH24Usd: num(env.SM_EARLY_MIN_VOLUME, 100_000)
};

/* ── Alerts ───────────────────────────────────────────────────────────── */

export const ALERTS = {
  /** Per-wallet/event cooldown so one wallet cannot spam. */
  cooldownMs: num(env.SM_ALERT_COOLDOWN_MS, 6 * 3600_000),
  /** How long a watch row lives without being touched (90 days). */
  maxAgeMs: 90 * WINDOWS.H24,
  maxPerIdentity: 100,
  types: Object.freeze([
    'LARGE_BUY',
    'LARGE_SELL',
    'TRANSFER',
    'EXCHANGE_DEPOSIT',
    'EXCHANGE_WITHDRAWAL',
    'NEW_TOKEN',
    'LIQUIDITY_MOVEMENT',
    'ACCUMULATION',
    'DISTRIBUTION'
  ])
};

/* ── Cache TTLs (ms) ──────────────────────────────────────────────────── */

export const TTL = {
  overview: 60_000,
  flows: 60_000,
  whales: 60_000,
  liquidity: 90_000,
  earlyTokens: 120_000,
  freshWallets: 120_000,
  wallet: 120_000,
  token: 90_000,
  registry: 6 * 3600_000
};

/** Clamp a weighted score into [0, 100] and round to an integer. */
export function clampScore(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Weighted sum: parts = {key: value01}, weights = {key: weight}. */
export function weighted(parts, weights) {
  let sum = 0;
  let wsum = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = parts[k];
    if (v == null || !Number.isFinite(v)) continue; // missing data is skipped
    const vv = Math.max(0, Math.min(1, v));
    sum += vv * w;
    wsum += w;
  }
  // Normalise by the weight we actually had evidence for, so a wallet with
  // partial data is not punished to zero — but its score is labelled with
  // `coverage` so the UI can say "based on 6 of 9 factors".
  return wsum > 0 ? { score: (sum / wsum) * 100, coverage: wsum / Object.values(weights).reduce((a, b) => a + b, 0) }
                  : { score: 0, coverage: 0 };
}
