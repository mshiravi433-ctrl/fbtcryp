/**
 * FBT INTENT AI — PERMISSION MODEL (Mode A: Human ↔ AI)
 * ---------------------------------------------------------------------------
 * Three explicit permission levels. No level can escalate silently, and
 * LEVEL 3 (Controlled Autonomous) requires a fully-specified policy that
 * Guardian must approve on every single action.
 *
 *   LEVEL 1 — ANALYSIS      : analysis & suggestions only; no orders, no drafts.
 *   LEVEL 2 — PREPARE       : builds quotes, draft orders, transaction plans.
 *                             No signature. No submission.
 *   LEVEL 3 — CONTROLLED    : autonomous execution inside an explicit policy.
 *                             Guardian gate fires on every action.
 *
 * Permission is per-session. Persisting a level requires explicit opt-in and
 * is capped by the global hard limits in DEFAULT_POLICY_CAPS.
 */

export const PERMISSION_LEVELS = Object.freeze({
  LEVEL_1_ANALYSIS: 1,
  LEVEL_2_PREPARE: 2,
  LEVEL_3_CONTROLLED: 3
});

export const PERMISSION_LEVEL_NAMES = Object.freeze({
  1: 'ANALYSIS',
  2: 'PREPARE',
  3: 'CONTROLLED_AUTONOMOUS'
});

/**
 * Hard caps — a session can never request more than these, even at L3.
 * The financial ceilings mirror the user-facing product limits in
 * intentLimits.js (single source of truth for what a user may ask for).
 */
export const DEFAULT_POLICY_CAPS = Object.freeze({
  maxCapitalUsd: 400_000,
  maxTransactionUsd: 5_000,
  maxLossUsd: 1_000,
  maxLeverage: 5,
  maxSlippagePct: 3,
  maxFeeBps: 500,        // 5%
  maxDurationMs: 24 * 60 * 60 * 1000, // 24h session bound; goals may run 30 days
  maxChains: 8,
  maxProtocols: 16,
  maxAssets: 32
});

const ALLOWED_CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144, 8757, 501, 195, 196]);
const ALLOWED_PROTOCOLS = new Set([
  'swap', 'bridge', 'defi', 'farm', 'futures', 'dydx', 'cex',
  'stablecoin', 'lending', 'liquidity', 'staking', 'rwa', 'investment',
  'dex_aggregator', 'bridge_router', 'lending_market'
]);
const FORBIDDEN_DESTINATION_PATTERNS = [
  /^0x0+$/i,                                  // zero address
  /withdraw|transfer-out|external-send/i       // unguarded outbound flagged
];

const isFiniteNonNeg = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;

function sanitizeStringSet(list, max, allowed = null) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (out.length >= max) break;
    const s = String(raw ?? '').trim();
    if (!s || seen.has(s)) continue;
    if (allowed && !allowed.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function sanitizeChainSet(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (out.length >= max) break;
    const id = Number(raw);
    if (!Number.isInteger(id) || !ALLOWED_CHAINS.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Validate & normalise a LEVEL-3 policy request. Returns { ok, policy, errors }.
 * The returned policy is always clamped to DEFAULT_POLICY_CAPS; errors lists
 * any requested value that was refused or reduced.
 */
export function sanitizePolicy(input = {}, level = 1) {
  const errors = [];
  const caps = DEFAULT_POLICY_CAPS;

  if (![1, 2, 3].includes(Number(level))) {
    errors.push('INVALID_LEVEL');
    level = 1;
  }

  // L1/L2 policies do not carry execution authority.
  if (level < 3) {
    return {
      ok: errors.length === 0,
      errors,
      policy: Object.freeze({
        level,
        autonomousExecution: false,
        confirmationRequired: true,
        maxCapitalUsd: 0,
        maxTransactionUsd: 0,
        maxLossUsd: 0,
        maxLeverage: 1,
        allowedChains: [],
        allowedProtocols: [],
        allowedAssets: [],
        maxSlippagePct: 0,
        maxFeeBps: 0,
        durationMs: 0,
        emergencyExit: true,
        createdAt: Date.now()
      })
    };
  }

  const rawCap = Number(input.maxCapitalUsd);
  const rawTx  = Number(input.maxTransactionUsd);
  const rawLoss = Number(input.maxLossUsd);
  const maxCapitalUsd = Number.isFinite(rawCap) && rawCap > 0 ? Math.min(rawCap, caps.maxCapitalUsd) : 0;
  const maxTransactionUsd = Number.isFinite(rawTx) && rawTx > 0
    ? Math.min(rawTx, caps.maxTransactionUsd, maxCapitalUsd || caps.maxTransactionUsd) : 0;
  const maxLossUsd = Number.isFinite(rawLoss) && rawLoss > 0
    ? Math.min(rawLoss, caps.maxLossUsd, maxCapitalUsd || caps.maxLossUsd) : 0;
  const maxLeverage = Math.max(1, Math.min(Number(input.maxLeverage) || 1, caps.maxLeverage));
  const maxSlippagePct = Math.min(
    Math.max(Number.isFinite(Number(input.maxSlippagePct)) ? Number(input.maxSlippagePct) : 1, 0.05),
    caps.maxSlippagePct
  );
  const maxFeeBps = Math.min(Math.max(Number(input.maxFeeBps) || 100, 1), caps.maxFeeBps);
  const durationMs = Math.min(
    Math.max(Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : 60 * 60 * 1000, 5 * 60 * 1000),
    caps.maxDurationMs
  );

  if (Number(input.maxCapitalUsd) > caps.maxCapitalUsd) errors.push('CAPITAL_CLAMPED_TO_CAP');
  if (Number(input.maxTransactionUsd) > caps.maxTransactionUsd) errors.push('TX_CLAMPED_TO_CAP');
  if (Number(input.maxLeverage) > caps.maxLeverage) errors.push('LEVERAGE_CLAMPED_TO_CAP');

  const allowedChains = sanitizeChainSet(input.allowedChains, caps.maxChains);
  const allowedProtocols = sanitizeStringSet(input.allowedProtocols, caps.maxProtocols, ALLOWED_PROTOCOLS);
  const allowedAssets = sanitizeStringSet(input.allowedAssets, caps.maxAssets, null).map((s) => s.toUpperCase());

  if (Array.isArray(input.allowedChains) && allowedChains.length < input.allowedChains.length) {
    errors.push('SOME_CHAINS_NOT_ALLOWED');
  }
  if (Array.isArray(input.allowedProtocols) && allowedProtocols.length < input.allowedProtocols.length) {
    errors.push('SOME_PROTOCOLS_NOT_ALLOWED');
  }

  if (!isFiniteNonNeg(maxCapitalUsd) || maxCapitalUsd <= 0) errors.push('MISSING_CAPITAL_LIMIT');
  if (!isFiniteNonNeg(maxTransactionUsd) || maxTransactionUsd <= 0) errors.push('MISSING_TX_LIMIT');
  if (maxTransactionUsd > maxCapitalUsd) errors.push('TX_LIMIT_EXCEEDS_CAPITAL');

  // Destinations are an ALLOWLIST; absence means the policy cannot send to any
  // new recipient — only swaps and contract interactions within listed protocols.
  const allowedDestinations = sanitizeStringSet(input.allowedDestinations || [], 16, null)
    .filter((d) => !FORBIDDEN_DESTINATION_PATTERNS.some((rx) => rx.test(d)));

  const ok = errors.filter((e) => !e.endsWith('_CLAMPED_TO_CAP') && !e.startsWith('SOME_')).length === 0
    && isFiniteNonNeg(maxCapitalUsd) && maxCapitalUsd > 0
    && isFiniteNonNeg(maxTransactionUsd) && maxTransactionUsd > 0
    && allowedChains.length > 0
    && allowedProtocols.length > 0;

  return {
    ok,
    errors,
    policy: Object.freeze({
      level: 3,
      autonomousExecution: true,
      confirmationRequired: true, // per-action Guardian check still required
      maxCapitalUsd,
      maxTransactionUsd,
      maxLossUsd,
      maxLeverage,
      allowedChains,
      allowedProtocols,
      allowedAssets,
      allowedDestinations,
      maxSlippagePct,
      maxFeeBps,
      durationMs,
      emergencyExit: input.emergencyExit !== false,
      performanceFeeBps: Math.min(Math.max(Number(input.performanceFeeBps) || 0, 0), 2000), // cap 20%
      feePolicy: String(input.feePolicy || 'all-inclusive').slice(0, 32),
      exitPolicy: String(input.exitPolicy || 'stop-loss-and-take-profit').slice(0, 48),
      createdAt: Date.now()
    })
  };
}

/** Can this level create draft orders / quotes? */
export function canPrepare(level) {
  return Number(level) >= 2;
}

/** Can this level submit actions for execution? */
export function canExecute(level) {
  return Number(level) >= 3;
}

/** Describe a level for the UI. */
export function describeLevel(level) {
  switch (Number(level)) {
    case 1:
      return {
        level: 1,
        name: 'ANALYSIS',
        canAnalyze: true,
        canPrepare: false,
        canExecute: false,
        summary: 'analysis-only; suggestions never move funds'
      };
    case 2:
      return {
        level: 2,
        name: 'PREPARE',
        canAnalyze: true,
        canPrepare: true,
        canExecute: false,
        summary: 'quotes and draft orders built; you review and sign every action'
      };
    case 3:
      return {
        level: 3,
        name: 'CONTROLLED_AUTONOMOUS',
        canAnalyze: true,
        canPrepare: true,
        canExecute: true,
        summary: 'execution inside an explicit, bounded policy; Guardian approves each action'
      };
    default:
      return describeLevel(1);
  }
}

export { ALLOWED_CHAINS, ALLOWED_PROTOCOLS };
