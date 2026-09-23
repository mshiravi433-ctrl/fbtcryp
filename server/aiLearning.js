/**
 * FBT AI LEARNING LOOP
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Learning Loop
 *
 * Requirements:
 *   - Record intent outcomes (Intent → Strategy → Execution → Outcome → Evaluation)
 *   - NEVER store secrets, private keys, or sensitive credentials
 *   - Anonymized learning analytics used to improve:
 *       • AI Routing (which model performs best for given task)
 *       • Tool Selection & reliability
 *       • Strategy Ranking based on user approval and execution success
 *       • Error Recovery patterns
 */

import { storeGet, storeSet } from './store.js';

const LEARNING_STORE_KEY = 'fbt.ai.learning.v3';
const MAX_LEARNING_RECORDS = 500;

const SENSITIVE_PATTERNS = [
  /0x[a-fA-F0-9]{64}/i, // 32-byte hex private key
  /(?:\b(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident|account|accuse|achieve|acid|acoustic|acquire|across|act|action|actor|actress|actual|adapt|add|addict|address|adjust|admit|adult|advance|advice|aerobic|affair|afford|afraid|again|age|agent|agree|ahead|aim|air|airport|aisle|alarm|album|alcohol|alert|alien|all|alley|allow|almost|alone|alpha|already|also|alter|always|amateur|amazing|among|amount|amused|analyst|anchor|ancient|anger|angle|angry|animal|ankle|announce|annual|another|answer|antenna|antique|anxiety|any|apart|apology|appear|apple|approve|april|arch|arctic|area|arena|argue|arm|armed|armor|army|around|arrange|arrest|arrive|arrow|art|artefact|artist|artwork|ask|aspect|assault|asset|assist|assume|asthma|athlete|atom|attack|attend|attitude|attract|auction|audit|august|aunt|author|auto|autumn|average|avocado|avoid|awake|aware|away|awesome|awful|awkward|axis|baby|bachelor|bacon|badge|bag|balance|balcony|ball|bamboo|banana|banner|bar|barely|bargain|barrel|base|basic|basket|battle|beach|bean|beauty|because|become|beef|before|begin|behave|behind|believe|below|belt|bench|benefit|best|betray|better|between|beyond|bicycle|bid|bike|bind|biology|bird|birth|bitter|black|blade|blame|blanket|blast|bleak|bless|blind|blood|blossom|blouse|blue|blur|blush|board|boat|body|boil|bomb|bone|bonus|book|boost|border|boring|borrow|boss|bottom|bounce|box|boy|bracket|brain|brand|brass|brave|bread|breeze|brick|bridge|brief|bright|bring|brisk|broccoli|broken|bronze|broom|brother|brown|brush|bubble|buddy|budget|buffalo|build|bulb|bulk|bullet|bundle|bunker|burden|burger|burst|bus|business|busy|butter|buyer|buzz)\b\s*){11,24}/i,
  /bearer\s+[a-zA-Z0-9_\-\.]{20,}/i
];

export function containsSensitiveKeyOrPhrase(input) {
  if (!input) return false;
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return SENSITIVE_PATTERNS.some(pat => pat.test(str));
}

export function anonymizeFeedbackContext(context = {}) {
  if (!context) return {};
  const scrubbed = JSON.parse(JSON.stringify(context));
  
  function scrubValue(val) {
    if (typeof val === 'string') {
      if (containsSensitiveKeyOrPhrase(val)) {
        return '[REDACTED_SECRET]';
      }
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(scrubValue);
    }
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        if (/key|secret|password|seed|token|auth/i.test(k) || containsSensitiveKeyOrPhrase(v)) {
          out[k] = '[REDACTED_SECRET]';
        } else {
          out[k] = scrubValue(v);
        }
      }
      return out;
    }
    return val;
  }

  return scrubValue(scrubbed);
}

export async function recordLearningFeedback({
  intentId = null,
  intentType = 'GENERAL',
  rating = 1,
  feedbackText = '',
  context = {}
} = {}) {
  const safeContext = anonymizeFeedbackContext(context);
  const safeText = containsSensitiveKeyOrPhrase(feedbackText) ? '[REDACTED_SECRET]' : String(feedbackText || '').slice(0, 500);

  return recordIntentOutcome({
    intentId,
    intentType,
    userApproved: rating > 0,
    confidenceScore: rating > 0 ? 95 : 40,
    errorCategory: rating <= 0 ? (safeText || 'USER_NEGATIVE_FEEDBACK') : null
  });
}

// In-memory ring buffer with fallback to store
let memoryRecords = [];

/**
 * Record an anonymized intent execution outcome.
 */
export async function recordIntentOutcome({
  intentId = null,
  intentType = 'GENERAL',
  providerUsed = 'internal',
  modelsConsulted = [],
  strategyId = null,
  executionSuccess = true,
  userApproved = null,
  confidenceScore = 80,
  durationMs = 0,
  errorCategory = null,
  locale = 'fa'
} = {}) {
  const record = {
    id: `lrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    intentId: intentId ? String(intentId).slice(0, 32) : null,
    intentType: String(intentType || 'GENERAL').toUpperCase(),
    providerUsed: String(providerUsed || 'internal'),
    modelsConsulted: Array.isArray(modelsConsulted) ? modelsConsulted.slice(0, 5) : [],
    strategyId: strategyId ? String(strategyId).slice(0, 48) : null,
    executionSuccess: Boolean(executionSuccess),
    userApproved: userApproved === true ? true : userApproved === false ? false : null,
    confidenceScore: Number(confidenceScore) || 80,
    durationMs: Number(durationMs) || 0,
    errorCategory: errorCategory ? String(errorCategory).slice(0, 48) : null,
    locale: String(locale || 'fa').slice(0, 5),
    recordedAt: Date.now()
  };

  memoryRecords.unshift(record);
  if (memoryRecords.length > MAX_LEARNING_RECORDS) {
    memoryRecords.length = MAX_LEARNING_RECORDS;
  }

  // Persist asynchronously
  try {
    const existing = (await storeGet(LEARNING_STORE_KEY)) || [];
    const combined = [record, ...existing].slice(0, MAX_LEARNING_RECORDS);
    await storeSet(LEARNING_STORE_KEY, combined);
  } catch {
    // Non-fatal if storage fails
  }

  return record;
}

/**
 * Compute aggregated AI Learning Insights.
 */
export async function getLearningInsights() {
  let records = memoryRecords;
  if (!records.length) {
    try {
      records = (await storeGet(LEARNING_STORE_KEY)) || [];
      memoryRecords = records;
    } catch {
      records = [];
    }
  }

  const totalIntents = records.length;
  if (totalIntents === 0) {
    return {
      totalIntents: 0,
      successRate: 1.0,
      providerPerformance: {},
      topStrategies: [],
      commonErrors: [],
      averageLatencyMs: 0
    };
  }

  // 1. Success rate
  const successes = records.filter((r) => r.executionSuccess).length;
  const successRate = totalIntents > 0 ? Number((successes / totalIntents).toFixed(2)) : 1.0;

  // 2. Provider performance breakdown
  const providerStats = {};
  let totalLatency = 0;

  for (const r of records) {
    totalLatency += r.durationMs;
    const p = r.providerUsed || 'internal';
    if (!providerStats[p]) {
      providerStats[p] = { count: 0, successCount: 0, totalLatency: 0 };
    }
    providerStats[p].count += 1;
    if (r.executionSuccess) providerStats[p].successCount += 1;
    providerStats[p].totalLatency += r.durationMs;
  }

  const providerPerformance = {};
  for (const [p, stats] of Object.entries(providerStats)) {
    providerPerformance[p] = {
      uses: stats.count,
      successRate: stats.count > 0 ? Number((stats.successCount / stats.count).toFixed(2)) : 1.0,
      avgLatencyMs: stats.count > 0 ? Math.round(stats.totalLatency / stats.count) : 0
    };
  }

  // 3. Common Errors
  const errorCounts = {};
  for (const r of records) {
    if (r.errorCategory) {
      errorCounts[r.errorCategory] = (errorCounts[r.errorCategory] || 0) + 1;
    }
  }
  const commonErrors = Object.entries(errorCounts)
    .map(([err, count]) => ({ error: err, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalIntents,
    successRate,
    providerPerformance,
    commonErrors,
    averageLatencyMs: Math.round(totalLatency / totalIntents),
    lastUpdated: Date.now()
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * DECISION LOG + REFLECTION MEMORY
 * ---------------------------------------------------------------------------
 * Pattern from Zetryn's ReflectiveNode / DecisionLog (zetryn-ai/ai-agent,
 * MIT) and TradingAgents' decision-log memory: every AI verdict about an
 * asset is recorded with the price at the moment it was made; later, the
 * outcome is resolved against a REAL price; before the next verdict on the
 * same asset, the losses are shown to the models so a pattern that already
 * cost money is argued about instead of repeated.
 *
 * Laws:
 *   · Owner-scoped. One user's losses never colour another user's answer.
 *     The owner key is the same salted hash the rest of the AI OS uses.
 *   · An outcome is only ever computed from a price we actually fetched —
 *     never estimated, never invented. Unresolvable → stays `open`.
 *   · Point-in-time: a decision is only resolved after its horizon has
 *     elapsed, and a reflection only includes decisions RESOLVED before the
 *     moment it is built.
 *   · No secrets: the same scrubber as the learning loop runs on the thesis.
 * ─────────────────────────────────────────────────────────────────────────── */

export const DECISION_LOG_SCHEMA = 'fbt.ai-decision-log.v1';
const DECISION_STORE_PREFIX = 'fbt.ai.decisions.v1:';
const MAX_DECISIONS_PER_OWNER = 120;
const DEFAULT_HORIZON_MS = 24 * 3600_000;
/** A move smaller than this is noise, not a win or a loss. */
const FLAT_BAND_PCT = 0.5;

const decisionMem = new Map();
const keyFor = (owner) => `${DECISION_STORE_PREFIX}${String(owner || 'anon').slice(0, 96)}`;

async function readDecisions(owner) {
  const key = keyFor(owner);
  if (decisionMem.has(key)) return decisionMem.get(key);
  let rows = [];
  try { rows = (await storeGet(key)) || []; } catch { rows = []; }
  if (!Array.isArray(rows)) rows = [];
  decisionMem.set(key, rows);
  return rows;
}

async function writeDecisions(owner, rows) {
  const key = keyFor(owner);
  const trimmed = rows.slice(0, MAX_DECISIONS_PER_OWNER);
  decisionMem.set(key, trimmed);
  try { await storeSet(key, trimmed, 180 * 24 * 3600_000); } catch { /* memory copy still serves this instance */ }
  return trimmed;
}

const DIRECTION = { bull: 1, bullish: 1, buy: 1, long: 1, bear: -1, bearish: -1, sell: -1, short: -1 };

/**
 * Record one AI verdict. `direction` is what the verdict implied the price
 * would do: bull (+1), bear (-1) or balanced (0 — recorded, never scored).
 */
export async function recordDecision({
  owner,
  asset,
  verdict = 'balanced',
  confidence = null,
  thesis = '',
  priceAtDecision = null,
  horizonMs = DEFAULT_HORIZON_MS,
  source = 'debate',
  now = Date.now()
} = {}) {
  const symbol = String(asset || '').trim().toUpperCase().slice(0, 16);
  const price = Number(priceAtDecision);
  if (!owner || !symbol) return { ok: false, code: 'OWNER_AND_ASSET_REQUIRED' };
  const row = {
    schema: DECISION_LOG_SCHEMA,
    id: `dec_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    asset: symbol,
    verdict: String(verdict || 'balanced').toLowerCase().slice(0, 12),
    direction: DIRECTION[String(verdict || '').toLowerCase()] || 0,
    confidence: Number.isFinite(Number(confidence)) ? Math.round(Number(confidence)) : null,
    thesis: containsSensitiveKeyOrPhrase(thesis) ? '[REDACTED_SECRET]' : String(thesis || '').slice(0, 240),
    priceAtDecision: Number.isFinite(price) && price > 0 ? price : null,
    decidedAt: now,
    horizonMs: Math.min(30 * 24 * 3600_000, Math.max(3600_000, Number(horizonMs) || DEFAULT_HORIZON_MS)),
    source: String(source || 'debate').slice(0, 24),
    status: 'open',
    outcome: null
  };
  const rows = await readDecisions(owner);
  await writeDecisions(owner, [row, ...rows]);
  return { ok: true, decision: row };
}

/**
 * Resolve every open decision whose horizon has passed, using `priceOf`
 * (async symbol → number|null). A decision with no entry price or no exit
 * price stays open — nothing is ever guessed.
 */
export async function resolveDecisions({ owner, priceOf, now = Date.now() } = {}) {
  if (!owner || typeof priceOf !== 'function') return { ok: false, code: 'OWNER_AND_PRICE_SOURCE_REQUIRED', resolved: 0 };
  const rows = await readDecisions(owner);
  let resolved = 0;
  const cache = new Map();
  for (const row of rows) {
    if (row.status !== 'open' || row.priceAtDecision == null) continue;
    if (now < row.decidedAt + row.horizonMs) continue;
    if (!cache.has(row.asset)) {
      let p = null;
      try { p = Number(await priceOf(row.asset)); } catch { p = null; }
      cache.set(row.asset, Number.isFinite(p) && p > 0 ? p : null);
    }
    const exit = cache.get(row.asset);
    if (exit == null) continue;
    const movePct = ((exit - row.priceAtDecision) / row.priceAtDecision) * 100;
    let result = 'flat';
    if (row.direction !== 0 && Math.abs(movePct) >= FLAT_BAND_PCT) {
      result = Math.sign(movePct) === row.direction ? 'win' : 'loss';
    } else if (row.direction === 0) {
      result = 'unscored';
    }
    row.status = 'resolved';
    row.outcome = { exitPrice: exit, movePct: Math.round(movePct * 100) / 100, result, resolvedAt: now };
    resolved += 1;
  }
  if (resolved) await writeDecisions(owner, rows);
  return { ok: true, resolved };
}

/**
 * The reflection shown to models before a new verdict on `asset`.
 * Only decisions resolved before `now` count (point-in-time).
 */
export async function buildReflection({ owner, asset = null, now = Date.now(), limit = 5 } = {}) {
  if (!owner) return { schema: DECISION_LOG_SCHEMA, lines: [], lossCount: 0, winCount: 0, sample: 0 };
  const symbol = asset ? String(asset).toUpperCase() : null;
  const rows = (await readDecisions(owner))
    .filter((r) => r.status === 'resolved' && r.outcome && r.outcome.resolvedAt <= now)
    .filter((r) => !symbol || r.asset === symbol);
  const scored = rows.filter((r) => r.outcome.result === 'win' || r.outcome.result === 'loss');
  const losses = scored.filter((r) => r.outcome.result === 'loss');
  const wins = scored.filter((r) => r.outcome.result === 'win');
  /* Losses first — they are what the model must not repeat — then wins. */
  const lines = [...losses, ...wins].slice(0, limit).map((r) => {
    const when = new Date(r.decidedAt).toISOString().slice(0, 10);
    return `${when} ${r.asset}: said ${r.verdict}${r.confidence != null ? ` (${r.confidence}%)` : ''}, price moved ${r.outcome.movePct > 0 ? '+' : ''}${r.outcome.movePct}% → ${r.outcome.result.toUpperCase()}${r.thesis ? ` — thesis was: "${r.thesis.slice(0, 120)}"` : ''}`;
  });
  return {
    schema: DECISION_LOG_SCHEMA,
    asset: symbol,
    lines,
    lossCount: losses.length,
    winCount: wins.length,
    sample: scored.length,
    hitRate: scored.length ? Math.round((wins.length / scored.length) * 100) : null
  };
}

/** Aggregate stats (owner-scoped) for the transparency surface. */
export async function decisionStats({ owner } = {}) {
  const rows = owner ? await readDecisions(owner) : [];
  const scored = rows.filter((r) => r.outcome && (r.outcome.result === 'win' || r.outcome.result === 'loss'));
  const wins = scored.filter((r) => r.outcome.result === 'win').length;
  return {
    schema: DECISION_LOG_SCHEMA,
    total: rows.length,
    open: rows.filter((r) => r.status === 'open').length,
    scored: scored.length,
    wins,
    losses: scored.length - wins,
    hitRate: scored.length ? Math.round((wins / scored.length) * 100) : null,
    recent: rows.slice(0, 10).map((r) => ({
      id: r.id, asset: r.asset, verdict: r.verdict, confidence: r.confidence,
      decidedAt: r.decidedAt, status: r.status, outcome: r.outcome
    }))
  };
}

/** Test hook. */
export function _resetDecisionMemory() { decisionMem.clear(); }
