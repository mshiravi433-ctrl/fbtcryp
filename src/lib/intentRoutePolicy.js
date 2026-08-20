/**
 * DETERMINISTIC ROUTE SCORING v2 — fbt.intent-route-policy.v1
 * ---------------------------------------------------------------------------
 * Two explicit, versioned policies and nothing in between:
 *
 *   1. MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1
 *      Allowed ONLY when every eligible route carries a valid amountOutUsd, a
 *      valid gasUsd, the SAME price source, comparable freshness, the same fee
 *      bps, the same slippage, the same chain and the same token pair.
 *      Ranking value: netOutputUsd = amountOutUsd - gasUsd.
 *
 *   2. MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2
 *      The honest fallback. Ranking value: raw output among routes that share
 *      identical assumptions. Its claim is exactly:
 *      "best executable output among comparable responses observed in this
 *       quote round" — not "the best route in the world".
 *
 * ─── WHY NOT A WEIGHTED SCORE ───────────────────────────────────────────────
 * Adding output, gas and "risk" into one number requires exchange rates
 * between incomparable units, and those weights are always invented. Worse, it
 * lets a critical safety failure be out-voted by a few extra basis points of
 * output. So this module does eligibility FIRST (a bad route is removed, not
 * penalised) and ranking SECOND, on one unit at a time.
 *
 * Pure and React-free: same input → same output, in any input order.
 */

export const ROUTE_POLICY_SCHEMA = 'fbt.intent-route-policy.v1';

export const ROUTE_POLICIES = Object.freeze({
  NET_USD: 'MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1',
  SAME_ASSUMPTIONS: 'MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2'
});

export const ROUTE_POLICY_CLAIMS = Object.freeze({
  [ROUTE_POLICIES.NET_USD]:
    'highest output value minus gas cost among comparable responses observed in this quote round',
  [ROUTE_POLICIES.SAME_ASSUMPTIONS]:
    'best executable output among comparable responses observed in this quote round'
});

/** Why a candidate never reached the ranking stage. */
export const REJECTION_CODES = Object.freeze([
  'NOT_EXECUTABLE',
  'NO_OUTPUT',
  'QUOTE_ERROR',
  'QUOTE_EXPIRED',
  'FEE_MISMATCH',
  'SLIPPAGE_MISMATCH',
  'CHAIN_MISMATCH',
  'PAIR_MISMATCH',
  'INTEGRITY_FAILED',
  'CRITICAL_RISK'
]);

const DEFAULT_MAX_QUOTE_AGE_MS = 60_000;

/* `Number(null)` is 0 and 0 is finite. Treating a MISSING gas figure as a
   zero-cost route would silently promote the fallback policy into the
   net-USD one and rank on a number nobody measured. */
const num = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const big = (value) => {
  if (typeof value === 'bigint') return value;
  try {
    if (value == null || value === '') return null;
    return BigInt(String(value));
  } catch {
    return null;
  }
};

const solverId = (candidate, index) =>
  String(candidate?.solver || candidate?.source || `solver-${index + 1}`).slice(0, 40);

/** The assumption set two quotes must share before any comparison is honest. */
function assumptionKey(candidate) {
  return [
    Number(candidate?.chainId ?? 0),
    String(candidate?.fromSymbol ?? '').toUpperCase(),
    String(candidate?.toSymbol ?? '').toUpperCase(),
    num(candidate?.feeBps) ?? 'na',
    num(candidate?.slippagePct ?? candidate?.slippage) ?? 'na'
  ].join('|');
}

function mismatchCode(reference, candidate) {
  if (Number(candidate?.chainId ?? 0) !== Number(reference?.chainId ?? 0)) return 'CHAIN_MISMATCH';
  const pairA = `${String(reference?.fromSymbol ?? '').toUpperCase()}>${String(reference?.toSymbol ?? '').toUpperCase()}`;
  const pairB = `${String(candidate?.fromSymbol ?? '').toUpperCase()}>${String(candidate?.toSymbol ?? '').toUpperCase()}`;
  if (pairA !== pairB) return 'PAIR_MISMATCH';
  if ((num(candidate?.feeBps) ?? -1) !== (num(reference?.feeBps) ?? -1)) return 'FEE_MISMATCH';
  return 'SLIPPAGE_MISMATCH';
}

/**
 * Rank routes deterministically.
 *
 * @param {Array} candidates  normalised quote rows. Recognised fields:
 *   solver, chainId, fromSymbol, toSymbol, amountOutWei, amountOutUsd, gasUsd,
 *   priceSource, observedAt, feeBps, slippagePct, hops, latencyMs, executable,
 *   integrityOk, riskLevel, error
 * @returns {{
 *   schema:string, policy:string, claim:string, selected:object|null,
 *   ranked:Array, rejected:Array, missingFields:Array, assumptions:object|null,
 *   evaluatedAt:number
 * }}
 */
export function scoreRoutes(candidates, {
  now = Date.now(),
  maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS
} = {}) {
  const rows = (Array.isArray(candidates) ? candidates : [])
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => ({ ...row, solver: solverId(row, index) }));

  const rejected = [];
  const reject = (row, code, detail = null) => {
    rejected.push({ solver: row.solver, code, ...(detail ? { detail } : {}) });
  };

  /* ---- stage 1: hard eligibility. A failure here REMOVES a route. -------- */
  const usable = [];
  for (const row of rows) {
    if (row.error) { reject(row, 'QUOTE_ERROR', String(row.error).slice(0, 40)); continue; }
    if (row.executable === false) { reject(row, 'NOT_EXECUTABLE'); continue; }
    if (row.integrityOk === false) { reject(row, 'INTEGRITY_FAILED'); continue; }
    if (row.riskLevel === 'critical') { reject(row, 'CRITICAL_RISK'); continue; }
    const out = big(row.amountOutWei);
    if (out == null || out <= 0n) { reject(row, 'NO_OUTPUT'); continue; }
    const observedAt = num(row.observedAt);
    const expiresAt = num(row.expiresAt);
    const expired = (expiresAt != null && now > expiresAt)
      || (observedAt != null && now - observedAt > maxQuoteAgeMs);
    if (expired) { reject(row, 'QUOTE_EXPIRED'); continue; }
    usable.push({ ...row, amountOutWei: out });
  }

  if (!usable.length) {
    return {
      schema: ROUTE_POLICY_SCHEMA,
      policy: ROUTE_POLICIES.SAME_ASSUMPTIONS,
      claim: ROUTE_POLICY_CLAIMS[ROUTE_POLICIES.SAME_ASSUMPTIONS],
      selected: null,
      ranked: [],
      rejected,
      missingFields: [],
      assumptions: null,
      evaluatedAt: now
    };
  }

  /* ---- stage 2: one assumption set wins; the rest are rejected. ---------- */
  const groups = new Map();
  for (const row of usable) {
    const key = assumptionKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  /* Deterministic reference choice: the largest group, ties broken by the
     lexically smallest assumption key. Input ORDER never decides. */
  const referenceKey = [...groups.keys()].sort((a, b) => {
    const sizeDelta = groups.get(b).length - groups.get(a).length;
    return sizeDelta !== 0 ? sizeDelta : (a < b ? -1 : a > b ? 1 : 0);
  })[0];
  const eligible = groups.get(referenceKey);
  const reference = eligible[0];
  for (const [key, group] of groups) {
    if (key === referenceKey) continue;
    for (const row of group) reject(row, mismatchCode(reference, row));
  }

  /* ---- stage 3: which policy may we honestly use? ------------------------ */
  const missingFields = [];
  const priceSources = new Set();
  let comparableUsd = true;
  for (const row of eligible) {
    const outUsd = num(row.amountOutUsd);
    const gasUsd = num(row.gasUsd);
    if (outUsd == null || outUsd <= 0) { missingFields.push(`${row.solver}:amountOutUsd`); comparableUsd = false; }
    if (gasUsd == null || gasUsd < 0) { missingFields.push(`${row.solver}:gasUsd`); comparableUsd = false; }
    if (row.observedAt == null) { missingFields.push(`${row.solver}:observedAt`); comparableUsd = false; }
    priceSources.add(String(row.priceSource ?? ''));
  }
  if (priceSources.size > 1) {
    missingFields.push('priceSource:mixed');
    comparableUsd = false;
  }
  if (priceSources.size === 1 && [...priceSources][0] === '') {
    missingFields.push('priceSource:unknown');
    comparableUsd = false;
  }
  /* Freshness has to be comparable too: a 5-second-old USD valuation and a
     55-second-old one are not the same measurement. */
  if (comparableUsd && eligible.length > 1) {
    const stamps = eligible.map((row) => num(row.observedAt));
    const spread = Math.max(...stamps) - Math.min(...stamps);
    if (spread > maxQuoteAgeMs / 2) {
      missingFields.push('observedAt:spread');
      comparableUsd = false;
    }
  }

  const policy = comparableUsd ? ROUTE_POLICIES.NET_USD : ROUTE_POLICIES.SAME_ASSUMPTIONS;

  /* ---- stage 4: total, deterministic ordering. --------------------------- */
  const scored = eligible.map((row) => ({
    solver: row.solver,
    amountOutWei: row.amountOutWei,
    amountOutUsd: num(row.amountOutUsd),
    gasUsd: num(row.gasUsd),
    netOutputUsd: comparableUsd ? Number(num(row.amountOutUsd)) - Number(num(row.gasUsd)) : null,
    slippagePct: num(row.slippagePct ?? row.slippage),
    latencyMs: num(row.latencyMs),
    hops: num(row.hops),
    feeBps: num(row.feeBps),
    chainId: Number(row.chainId ?? 0),
    priceSource: row.priceSource ?? null,
    observedAt: num(row.observedAt),
    quoteRef: row.quoteFingerprint ? String(row.quoteFingerprint).slice(0, 64) : null
  }));

  const cmpNum = (a, b, dir = 1) => {
    const av = a == null ? null : Number(a);
    const bv = b == null ? null : Number(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;   // a missing value never wins a tie-break
    if (bv == null) return -1;
    if (av === bv) return 0;
    return av < bv ? -dir : dir;
  };

  const ranked = [...scored].sort((a, b) => {
    // 1. more output (net USD when comparable, raw output otherwise)
    if (policy === ROUTE_POLICIES.NET_USD) {
      const byNet = cmpNum(b.netOutputUsd, a.netOutputUsd);
      if (byNet !== 0) return byNet;
    }
    if (a.amountOutWei !== b.amountOutWei) return a.amountOutWei > b.amountOutWei ? -1 : 1;
    // 2. lower gas — only when gas is comparable at all
    if (comparableUsd) {
      const byGas = cmpNum(a.gasUsd, b.gasUsd);
      if (byGas !== 0) return byGas;
    }
    // 3. lower slippage, 4. lower latency, 5. fewer hops
    const bySlip = cmpNum(a.slippagePct, b.slippagePct);
    if (bySlip !== 0) return bySlip;
    const byLatency = cmpNum(a.latencyMs, b.latencyMs);
    if (byLatency !== 0) return byLatency;
    const byHops = cmpNum(a.hops, b.hops);
    if (byHops !== 0) return byHops;
    // 6. solver id, lexically — the final, always-decisive tie-break
    return a.solver < b.solver ? -1 : a.solver > b.solver ? 1 : 0;
  });

  return {
    schema: ROUTE_POLICY_SCHEMA,
    policy,
    claim: ROUTE_POLICY_CLAIMS[policy],
    selected: ranked[0] ? { ...ranked[0], amountOutWei: ranked[0].amountOutWei.toString() } : null,
    ranked: ranked.map((row, index) => ({ ...row, amountOutWei: row.amountOutWei.toString(), rank: index + 1 })),
    rejected,
    missingFields: [...new Set(missingFields)].slice(0, 24),
    assumptions: {
      chainId: Number(reference.chainId ?? 0),
      fromSymbol: String(reference.fromSymbol ?? '').toUpperCase() || null,
      toSymbol: String(reference.toSymbol ?? '').toUpperCase() || null,
      feeBps: num(reference.feeBps),
      slippagePct: num(reference.slippagePct ?? reference.slippage),
      priceSource: comparableUsd ? (reference.priceSource ?? null) : null,
      maxQuoteAgeMs
    },
    evaluatedAt: now
  };
}

/**
 * Adapt the existing quote-trace rows (lib/bestQuote.js) to the scoring input.
 * Kept here so the trace format stays the single source of truth and the
 * policy module never has to know about aggregator-specific shapes.
 */
export function candidatesFromQuoteTrace(trace, { chainId, fromSymbol, toSymbol, observedAt = null, priceSource = null } = {}) {
  const rows = Array.isArray(trace) ? trace : Array.isArray(trace?.candidates) ? trace.candidates : [];
  return rows.map((row) => ({
    solver: row.solver,
    chainId: Number(chainId ?? 0),
    fromSymbol,
    toSymbol,
    amountOutWei: row.amountOutWei,
    amountOutUsd: row.amountOutUsd,
    gasUsd: row.gasUsd,
    feeBps: row.feeBps,
    slippagePct: row.slippage ?? row.slippagePct,
    hops: row.hops,
    latencyMs: row.latencyMs,
    executable: row.executable !== false && row.status === 'quoted',
    error: row.status === 'rejected' ? (row.error || 'REJECTED') : row.error || null,
    observedAt,
    priceSource
  }));
}
