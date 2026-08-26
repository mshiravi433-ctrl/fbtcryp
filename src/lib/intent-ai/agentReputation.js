/**
 * FBT INTENT AI — Spec 65 items 43–45: Agent Reputation, Leaderboard and
 * Agent-to-Agent Appreciation.
 *
 * Reputation has five categories — Performance, Reliability, Risk,
 * Communication, Accuracy — computed ONLY from observed samples. Fewer than
 * the minimum sample size per category means `insufficient_data`; no
 * percentage is invented. The leaderboard is risk-adjusted and observed-only;
 * badges without samples are impossible by construction. Appreciation is
 * bidirectional, bounded, carries a short reason, and NEVER affects Guardian
 * or Risk decisions.
 */

import { bounded, containsRawSecret, fail, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const AGENT_REPUTATION_SCHEMA = 'fbt.intent-agent-reputation.v1';
export const AGENT_LEADERBOARD_SCHEMA = 'fbt.intent-agent-leaderboard.v1';
export const AGENT_APPRECIATION_SCHEMA = 'fbt.intent-agent-appreciation.v1';

export const REPUTATION_CATEGORIES = Object.freeze([
  'performance', 'reliability', 'risk', 'communication', 'accuracy'
]);

export const MIN_REPUTATION_SAMPLE_SIZE = 5;

const CATEGORY_SAMPLE_KEYS = Object.freeze({
  performance: 'outcome',
  reliability: 'deliveredOnTime',
  risk: 'withinRiskPolicy',
  communication: 'communicationRating',
  accuracy: 'accuracyRating'
});

function categoryScore(samples, category) {
  const key = CATEGORY_SAMPLE_KEYS[category];
  const valid = samples.filter((sample) => {
    if (!sample || typeof sample !== 'object') return false;
    const value = sample[key];
    if (category === 'performance') {
      if (sample.outcome === 'success' && sample.confirmed !== true) return false;
      return sample.outcome === 'success' || sample.outcome === 'failure';
    }
    if (key === 'communicationRating' || key === 'accuracyRating') {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
    }
    return value === true || value === false;
  });
  if (valid.length < MIN_REPUTATION_SAMPLE_SIZE) {
    return { category, status: 'insufficient_data', sampleSize: valid.length, score: null };
  }
  let score;
  if (key === 'communicationRating' || key === 'accuracyRating') {
    score = Math.round(valid.reduce((sum, sample) => sum + sample[key], 0) / valid.length);
  } else {
    const positives = valid.filter((sample) => (category === 'performance' ? sample.outcome === 'success' : sample[key] === true)).length;
    score = Math.round((positives / valid.length) * 100);
  }
  // Risk category: a HIGH within-risk-policy rate is good; the raw score is
  // reported as observed either way.
  return { category, status: 'observed', sampleSize: valid.length, score };
}

/**
 * Build an agent reputation from observed samples. Categories without enough
 * samples are honestly `insufficient_data` and the composite stays null.
 */
export function buildAgentReputation({ agentId = null, samples = [], now = Date.now() } = {}) {
  if (containsRawSecret({ agentId, samples })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const id = safeId(agentId) || safeString(String(agentId || ''), 80);
  if (!id) return fail('AGENT_ID_REQUIRED');
  if (!Array.isArray(samples)) return fail('SAMPLES_LIST_REQUIRED');
  const categories = REPUTATION_CATEGORIES.map((category) => categoryScore(samples, category));
  const observed = categories.filter((row) => row.status === 'observed');
  const composite = observed.length === REPUTATION_CATEGORIES.length
    ? Math.round(observed.reduce((sum, row) => sum + row.score, 0) / observed.length)
    : null;
  return noExecutionPermission({
    ok: true,
    schema: AGENT_REPUTATION_SCHEMA,
    agentId: id,
    categories,
    compositeScore: composite,
    compositeStatus: composite === null ? 'insufficient_data' : 'observed',
    sampleSize: samples.length,
    observedOnly: true,
    scoreNeverVerifies: true,
    scoreNeverReplacesGuardian: true,
    builtAt: now
  });
}

/**
 * Spec 65 item 44 — leaderboard. Risk-adjusted: agents whose observed risk
 * compliance is lower get scaled down. Entries without enough samples rank as
 * unrated, never with a fabricated score. Public sharing stays an explicit,
 * honest opt-in.
 */
export function agentLeaderboard({ reputations = [], limit = 20, publicSharing = false, now = Date.now() } = {}) {
  if (containsRawSecret(reputations)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const rows = (Array.isArray(reputations) ? reputations : [])
    .filter((row) => row && typeof row === 'object' && row.schema === AGENT_REPUTATION_SCHEMA)
    .map((row) => {
      const rated = row.compositeStatus === 'observed' && row.compositeScore !== null;
      const riskRow = (row.categories || []).find((category) => category.category === 'risk');
      const riskAdjustment = rated && riskRow?.status === 'observed' ? riskRow.score / 100 : null;
      const adjusted = rated && riskAdjustment !== null ? Math.round(row.compositeScore * riskAdjustment) : null;
      return {
        agentId: row.agentId,
        status: rated ? 'rated' : 'insufficient_data',
        compositeScore: rated ? row.compositeScore : null,
        riskAdjustedScore: adjusted,
        riskAdjustment,
        sampleSize: row.sampleSize || 0,
        badge: rated ? 'observed-rated' : null
      };
    })
    .sort((a, b) => (b.riskAdjustedScore ?? -Infinity) - (a.riskAdjustedScore ?? -Infinity) || (b.sampleSize - a.sampleSize) || String(a.agentId).localeCompare(String(b.agentId)))
    .slice(0, Math.max(1, Math.min(limit, 100)));
  return noExecutionPermission({
    ok: true,
    schema: AGENT_LEADERBOARD_SCHEMA,
    entries: rows,
    rankedOn: 'risk-adjusted-observed-only',
    fabricatedBadges: 0,
    publicSharing: publicSharing === true,
    publicSharingNote: publicSharing === true
      ? 'Shared rows contain only observed, bounded scores; unrated agents are listed as unrated or omitted.'
      : 'Leaderboard is local until the user explicitly chooses to share it.',
    builtAt: now
  });
}

/**
 * Spec 65 item 45 — bidirectional appreciation with a short reason. Ratings
 * are bounded 0–100, the reason is required and bounded, and the result never
 * influences Guardian, Risk or STOP.
 */
export function createAgentAppreciation({ fromAgentId = null, toAgentId = null, rating = null, reason = null, now = Date.now() } = {}) {
  if (containsRawSecret({ fromAgentId, toAgentId, reason })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const from = safeId(fromAgentId) || safeString(String(fromAgentId || ''), 80);
  const to = safeId(toAgentId) || safeString(String(toAgentId || ''), 80);
  const value = bounded(rating);
  const why = safeString(reason, 240);
  if (!from || !to || value === null || !why) return fail('APPRECIATION_INCOMPLETE', 'from, to, bounded rating and a short reason are required.');
  if (from === to) return fail('SELF_APPRECIATION_FORBIDDEN');
  return noExecutionPermission({
    ok: true,
    schema: AGENT_APPRECIATION_SCHEMA,
    fromAgentId: from,
    toAgentId: to,
    rating: value,
    reason: why,
    bidirectional: true,
    affectsGuardian: false,
    affectsRiskPolicy: false,
    affectsStop: false,
    recordedAt: now
  });
}
