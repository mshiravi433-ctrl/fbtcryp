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
