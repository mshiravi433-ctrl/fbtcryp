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
