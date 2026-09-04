/**
 * FBT SMART INTENT OS — AI UPGRADE 5: CUSTOMER QUESTION INTELLIGENCE (SERVER)
 * ---------------------------------------------------------------------------
 * Owns storage and analytics for the question-intelligence core
 * (src/lib/intent-ai/os/questionIntel.js). It answers (§30, §62-64):
 *
 *   Top Questions · Emerging Questions · Unanswered Questions · Confusing
 *   Questions · High-Risk Questions · Questions Needing Web Research ·
 *   Questions Needing New Tools · High-Correction Questions
 *
 *   + Knowledge Gap detection (§31)
 *   + FAQ candidate generation (§32 — DRAFT ONLY, human review required)
 *   + Answer feedback (§64) feeding the existing learning loop
 *   + AI quality dashboard aggregation (§63)
 *
 * Privacy (§28, §44): every record passes the secret guard before storage;
 * stored samples are redacted and capped. Nothing here ever stores keys,
 * seed phrases or credentials.
 *
 * Endpoints backed by this module are admin-gated (CRON_SECRET) in
 * server/aiIntentOS.js — this analytics is never exposed to normal users.
 */

import { storeGet, storeSet } from './store.js';
import {
  clusterQuestion,
  containsSecretMaterial,
  redactForStorage,
  detectKnowledgeGaps as computeKnowledgeGaps,
  buildFaqCandidates as computeFaqCandidates,
  classifyFeedbackReason,
  FEEDBACK_REASONS
} from '../src/lib/intent-ai/os/questionIntel.js';
import { getLearningInsights } from './aiLearning.js';
import { getProviderHealth } from './aiCollaboration.js';

export const QUESTION_INTEL_STORE_KEY = 'fbt.ai.question-intel.v1';
export const FEEDBACK_STORE_KEY = 'fbt.ai.answer-feedback.v1';
const MAX_RECORDS = 800;
const MAX_FEEDBACK = 500;
const GROWTH_WINDOW_MS = 24 * 3600_000;

let memoryRecords = null;
let memoryFeedback = null;

async function loadRecords() {
  if (memoryRecords) return memoryRecords;
  try {
    memoryRecords = (await storeGet(QUESTION_INTEL_STORE_KEY)) || [];
  } catch {
    memoryRecords = [];
  }
  return memoryRecords;
}

async function persistRecords(records) {
  try { await storeSet(QUESTION_INTEL_STORE_KEY, records); } catch { /* non-fatal */ }
}

async function loadFeedback() {
  if (memoryFeedback) return memoryFeedback;
  try {
    memoryFeedback = (await storeGet(FEEDBACK_STORE_KEY)) || [];
  } catch {
    memoryFeedback = [];
  }
  return memoryFeedback;
}

/* -------------------------------------------------------------------------- */
/*  RECORDING (§28, §33)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record one anonymized question observation. Called fire-and-forget from the
 * chat pipeline. Rejects anything that looks like secret material instead of
 * storing a redacted copy of it — safer than trusting the redactor.
 */
export async function recordQuestion({
  message = '',
  intentType = 'GENERAL',
  conversationKind = 'QUESTION',
  freshness = 'RECENT',
  level = 1,
  resolved = true,
  clarificationAsked = false,
  confidenceScore = 80,
  correctionDetected = false,
  webUsed = false,
  multiAiUsed = false,
  toolUsed = false,
  locale = 'fa',
  cluster = null
} = {}) {
  const raw = String(message || '');
  if (containsSecretMaterial(raw)) {
    return { ok: false, rejected: 'SECRET_MATERIAL_DETECTED' };
  }

  const clustered = cluster || clusterQuestion(raw);
  const record = {
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    /* Only a short redacted sample is kept, for humans reviewing gaps — the
       cluster counters are the real signal. */
    sample: redactForStorage(raw, 80),
    intentType: String(intentType || 'GENERAL').toUpperCase().slice(0, 32),
    conversationKind: String(conversationKind || 'QUESTION').slice(0, 16),
    clusterId: clustered.clusterId,
    category: clustered.category,
    risk: clustered.risk,
    freshness: String(freshness || 'RECENT').slice(0, 10),
    level: Math.min(5, Math.max(1, Number(level) || 1)),
    resolved: Boolean(resolved),
    clarificationAsked: Boolean(clarificationAsked),
    confidenceScore: Math.min(100, Math.max(0, Number(confidenceScore) || 0)),
    correctionDetected: Boolean(correctionDetected),
    webUsed: Boolean(webUsed),
    multiAiUsed: Boolean(multiAiUsed),
    toolUsed: Boolean(toolUsed),
    locale: String(locale || 'fa').slice(0, 5),
    at: Date.now()
  };

  const records = await loadRecords();
  records.unshift(record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  memoryRecords = records;
  persistRecords(records).catch(() => {});
  return { ok: true, record: { ...record, sample: undefined }, clusterId: record.clusterId };
}

/**
 * Record 👍/👎 feedback with an optional reason (§64). Negative feedback with
 * reason "incorrect"/"outdated" is counted as a hallucination report (§63).
 */
export async function recordAnswerFeedback({ intentId = null, rating = 1, reason = '', comment = '', locale = 'fa' } = {}) {
  const classified = classifyFeedbackReason(reason || comment);
  const record = {
    id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    intentId: intentId ? String(intentId).slice(0, 64) : null,
    rating: rating > 0 ? 1 : -1,
    reason: rating > 0 ? null : (classified || 'technical_issue'),
    comment: containsSecretMaterial(comment) ? '[REDACTED_SECRET]' : redactForStorage(comment, 200),
    locale: String(locale || 'fa').slice(0, 5),
    at: Date.now()
  };

  const rows = await loadFeedback();
  rows.unshift(record);
  if (rows.length > MAX_FEEDBACK) rows.length = MAX_FEEDBACK;
  memoryFeedback = rows;
  try { await storeSet(FEEDBACK_STORE_KEY, rows); } catch { /* non-fatal */ }
  return { ok: true, record };
}

/* -------------------------------------------------------------------------- */
/*  ANALYTICS (§30, §62)                                                       */
/* -------------------------------------------------------------------------- */

function clusterStats(records) {
  const byCluster = new Map();
  for (const r of records) {
    let s = byCluster.get(r.clusterId);
    if (!s) {
      s = {
        clusterId: r.clusterId,
        category: r.category,
        risk: r.risk,
        count: 0,
        resolved: 0,
        clarifications: 0,
        corrections: 0,
        webUsed: 0,
        toolUsed: 0,
        multiAiUsed: 0,
        confidenceSum: 0,
        languages: {},
        recent: 0,
        prior: 0,
        samples: []
      };
      byCluster.set(r.clusterId, s);
    }
    s.count += 1;
    if (r.resolved) s.resolved += 1;
    if (r.clarificationAsked) s.clarifications += 1;
    if (r.correctionDetected) s.corrections += 1;
    if (r.webUsed) s.webUsed += 1;
    if (r.toolUsed) s.toolUsed += 1;
    if (r.multiAiUsed) s.multiAiUsed += 1;
    s.confidenceSum += r.confidenceScore || 0;
    s.languages[r.locale] = (s.languages[r.locale] || 0) + 1;
    if (Date.now() - (r.at || 0) < GROWTH_WINDOW_MS) s.recent += 1;
    else s.prior += 1;
    if (s.samples.length < 3 && r.sample) s.samples.push(r.sample);
  }

  return [...byCluster.values()].map((s) => ({
    clusterId: s.clusterId,
    category: s.category,
    risk: s.risk,
    count: s.count,
    growthRate: s.prior > 0 ? Number(((s.recent - s.prior / 7) / (s.prior / 7)).toFixed(2)) : (s.recent > 0 ? 1 : 0),
    resolutionRate: s.count ? Number((s.resolved / s.count).toFixed(2)) : 0,
    clarificationRate: s.count ? Number((s.clarifications / s.count).toFixed(2)) : 0,
    correctionRate: s.count ? Number((s.corrections / s.count).toFixed(2)) : 0,
    avgConfidence: s.count ? Math.round(s.confidenceSum / s.count) : 0,
    webUsageRate: s.count ? Number((s.webUsed / s.count).toFixed(2)) : 0,
    toolUsageRate: s.count ? Number((s.toolUsed / s.count).toFixed(2)) : 0,
    language: Object.keys(s.languages).sort((a, b) => s.languages[b] - s.languages[a])[0] || 'fa',
    samples: s.samples
  })).sort((a, b) => b.count - a.count);
}

export async function getQuestionAnalytics({ limit = 20 } = {}) {
  const records = await loadRecords();
  const stats = clusterStats(records);
  const n = Math.max(1, Number(limit) || 20);

  const topQuestions = stats.slice(0, n).map(({ samples, ...s }) => s);
  const emergingQuestions = [...stats]
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.growthRate - a.growthRate)
    .slice(0, 10)
    .map(({ samples, ...s }) => s);
  const unansweredQuestions = stats
    .filter((s) => s.resolutionRate < 0.5)
    .slice(0, 10)
    .map(({ samples, ...s }) => s);
  const confusingQuestions = stats
    .filter((s) => s.clarificationRate > 0.35)
    .slice(0, 10)
    .map(({ samples, ...s }) => s);
  const highRiskQuestions = stats
    .filter((s) => s.risk === 'high')
    .map(({ samples, ...s }) => s);
  const needingWebResearch = stats
    .filter((s) => s.webUsageRate > 0.4)
    .map(({ samples, ...s }) => s);
  const needingNewTools = stats
    .filter((s) => s.count >= 3 && s.toolUsageRate < 0.2 && s.resolutionRate < 0.7)
    .map(({ samples, ...s }) => s);
  const highCorrectionQuestions = stats
    .filter((s) => s.correctionRate > 0.2)
    .map(({ samples, ...s }) => s);

  return {
    ok: true,
    schema: 'fbt.question-analytics.v1',
    totalQuestions: records.length,
    window: { records: records.length, cap: MAX_RECORDS },
    topQuestions,
    emergingQuestions,
    unansweredQuestions,
    confusingQuestions,
    highRiskQuestions,
    needingWebResearch,
    needingNewTools,
    highCorrectionQuestions,
    statsWithSamples: stats.slice(0, n),
    at: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/*  KNOWLEDGE GAPS + FAQ CANDIDATES (§31-32)                                   */
/* -------------------------------------------------------------------------- */

export async function getKnowledgeGaps() {
  const records = await loadRecords();
  const stats = clusterStats(records);
  const gaps = computeKnowledgeGaps(stats);
  return {
    ok: true,
    schema: 'fbt.knowledge-gaps.v1',
    gaps,
    note: 'A gap means real demand meets weak answers. Recommendations are for the product team, not auto-applied.',
    at: Date.now()
  };
}

export async function getFaqCandidates() {
  const records = await loadRecords();
  const stats = clusterStats(records);
  const candidates = computeFaqCandidates(stats, { minCount: 3 });
  return {
    ok: true,
    schema: 'fbt.faq-candidates.v1',
    candidates,
    reviewRequired: true,
    note: 'DRAFT ONLY. Generated from anonymized question clusters. Nothing here is publishable product copy until a human reviews it (§32).',
    at: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/*  AI QUALITY DASHBOARD (§63)                                                 */
/* -------------------------------------------------------------------------- */

export async function getQualityDashboard() {
  const records = await loadRecords();
  const feedback = await loadFeedback();
  const learning = await getLearningInsights().catch(() => ({}));

  const total = records.length || 0;
  const resolved = records.filter((r) => r.resolved).length;
  const clarifications = records.filter((r) => r.clarificationAsked).length;
  const corrections = records.filter((r) => r.correctionDetected).length;
  const webUsed = records.filter((r) => r.webUsed).length;
  const multiAiUsed = records.filter((r) => r.multiAiUsed).length;

  const up = feedback.filter((f) => f.rating > 0).length;
  const down = feedback.filter((f) => f.rating < 0).length;
  const reasonCounts = {};
  for (const f of feedback) {
    if (f.reason) reasonCounts[f.reason] = (reasonCounts[f.reason] || 0) + 1;
  }
  /* Hallucination reports = feedback explicitly saying the answer was wrong
     or stale. This feeds evaluation (§35), never uncontrolled self-learning. */
  const hallucinationReports = (reasonCounts.incorrect || 0) + (reasonCounts.outdated || 0);

  return {
    ok: true,
    schema: 'fbt.ai-quality-dashboard.v1',
    questions: {
      total,
      answerSuccessRate: total ? Number((resolved / total).toFixed(2)) : null,
      clarificationRate: total ? Number((clarifications / total).toFixed(2)) : null,
      correctionRate: total ? Number((corrections / total).toFixed(2)) : null,
      webResearchUsageRate: total ? Number((webUsed / total).toFixed(2)) : null,
      multiAiUsageRate: total ? Number((multiAiUsed / total).toFixed(2)) : null
    },
    feedback: {
      total: feedback.length,
      thumbsUp: up,
      thumbsDown: down,
      positiveRate: feedback.length ? Number((up / feedback.length).toFixed(2)) : null,
      reasonCounts,
      hallucinationReports,
      taxonomy: FEEDBACK_REASONS
    },
    learning: {
      totalIntents: learning.totalIntents || 0,
      successRate: learning.successRate ?? null,
      providerPerformance: learning.providerPerformance || {},
      commonErrors: learning.commonErrors || [],
      averageLatencyMs: learning.averageLatencyMs || 0
    },
    providerHealth: getProviderHealth(),
    at: Date.now()
  };
}

/** Test/diagnostic helper: drop the in-memory caches (storage untouched). */
export function _resetQuestionIntelMemory() {
  memoryRecords = null;
  memoryFeedback = null;
}
