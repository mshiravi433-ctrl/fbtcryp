/**
 * FBT INTENT AI — Phase 11: strategy generation, competition and simulation.
 *
 * This module is a proposal plane. It can compare evidence-backed plans and
 * ask a real simulator for a route result, but it can never create an
 * execution grant. A missing simulator is `unavailable`, not a successful
 * zero/slippage quote. An optional capability decline produces a safe replan.
 */

import {
  bounded,
  containsRawSecret,
  finite,
  noExecutionPermission,
  safeId,
  safeList,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const STRATEGY_PROPOSAL_SCHEMA = 'fbt.intent-strategy-proposal.v1';
export const STRATEGY_SIMULATION_SCHEMA = 'fbt.intent-route-simulation.v1';
export const STRATEGY_COMPETITION_SCHEMA = 'fbt.intent-strategy-competition.v1';
export const STRATEGY_MONITOR_SCHEMA = 'fbt.intent-strategy-monitor.v1';
export const STRATEGY_SWITCH_SCHEMA = 'fbt.intent-strategy-switch.v1';

export const STRATEGY_EVIDENCE_FIELDS = Object.freeze([
  'source',
  'observedAt',
  'sampleSize',
  'quality',
  'assumptions'
]);

const STATUS = new Set(['draft', 'proposed', 'simulated', 'replanning', 'unavailable', 'rejected']);
const safeNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const number = finite(value);
  return number !== null && number >= min && number <= max ? number : null;
};

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence.slice(0, 16).map((item) => {
    if (!item || typeof item !== 'object' || containsRawSecret(item)) return null;
    const source = safeString(item.source || item.type, 80);
    const observedAt = safeNumber(item.observedAt, 0);
    const sampleSize = safeNumber(item.sampleSize, 0, 1_000_000);
    const quality = bounded(item.quality);
    const assumptions = safeList(item.assumptions, (value) => safeString(value, 80), 8);
    if (!source && observedAt === null && sampleSize === null && quality === null && !assumptions.length) return null;
    return { source: source || 'unspecified', observedAt, sampleSize, quality, assumptions };
  }).filter(Boolean);
}

function evidenceQuality(evidence) {
  const rows = normalizeEvidence(evidence);
  if (!rows.length) return { status: 'insufficient-evidence', score: null, sampleSize: null };
  const quality = rows.map((row) => row.quality).filter((value) => value !== null);
  const samples = rows.map((row) => row.sampleSize).filter((value) => value !== null);
  if (!quality.length || !samples.length || Math.max(...samples) < 5) {
    return { status: 'insufficient-evidence', score: null, sampleSize: samples.length ? Math.max(...samples) : null };
  }
  return {
    status: 'observed',
    score: Math.round((quality.reduce((sum, value) => sum + value, 0) / quality.length) * 100) / 100,
    sampleSize: Math.max(...samples)
  };
}

function proposalFrom(input = {}, index = 0, now = Date.now()) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const id = safeId(input.id || `strategy-${index + 1}`);
  if (!id) return null;
  const evidence = normalizeEvidence(input.evidence);
  const quality = evidenceQuality(evidence);
  const risk = bounded(input.riskPct);
  const expectedReturn = bounded(input.expectedReturnPct, -100, 1000);
  const potentialLoss = bounded(input.potentialLossPct, -100, 1000);
  return noExecutionPermission({
    schema: STRATEGY_PROPOSAL_SCHEMA,
    id,
    name: safeString(input.name || `Strategy ${index + 1}`, 100) || `Strategy ${index + 1}`,
    objective: safeString(input.objective || 'Meet the stated intent under bounded risk.', 240) || 'Meet the stated intent under bounded risk.',
    route: safeList(input.route, (value) => safeString(String(value), 80), 12),
    uses: safeList(input.uses || input.capabilities, (value) => safeString(String(value).toLowerCase(), 64), 16),
    assumptions: safeList(input.assumptions, (value) => safeString(value, 120), 12),
    evidence,
    evidenceQuality: quality,
    riskPct: risk,
    expectedReturnPct: expectedReturn,
    potentialLossPct: potentialLoss,
    maximumDrawdownPct: bounded(input.maximumDrawdownPct, 0, 1000),
    confidencePct: bounded(input.confidencePct),
    guaranteed: false,
    promise: false,
    status: STATUS.has(input.status) ? input.status : 'proposed',
    generatedAt: now,
    intentId: safeId(input.intentId) || null,
    rationale: safeString(input.rationale || 'Proposal only; assumptions and evidence require user review.', 300) || 'Proposal only; assumptions and evidence require user review.'
  });
}

/** Generate multiple bounded proposals; no proposal is a winner by default. */
export function generateStrategies({ intent = {}, candidates = [], evidence = [], now = Date.now() } = {}) {
  if (containsRawSecret(intent) || containsRawSecret(candidates) || containsRawSecret(evidence)) {
    return { ok: false, schema: STRATEGY_PROPOSAL_SCHEMA, code: 'RAW_CREDENTIAL_FORBIDDEN' };
  }
  const source = Array.isArray(candidates) && candidates.length
    ? candidates
    : [
      { id: 'conservative', name: 'Conservative route', riskPct: 20, uses: ['quote'], objective: 'Prefer bounded downside and visible fees.' },
      { id: 'balanced', name: 'Balanced route', riskPct: 45, uses: ['quote', 'simulation'], objective: 'Balance expected output with execution risk.' },
      { id: 'alternative', name: 'Alternative route', riskPct: 65, uses: ['quote', 'alternative-route'], objective: 'Explore a different route without promising a result.' }
    ];
  const inherited = Array.isArray(evidence) ? evidence : [];
  const strategies = source.slice(0, 12).map((candidate, index) => proposalFrom({ ...candidate, intentId: intent.id, evidence: [...inherited, ...(candidate?.evidence || [])] }, index, now)).filter(Boolean);
  return {
    ok: true,
    schema: STRATEGY_COMPETITION_SCHEMA,
    intentId: safeId(intent.id) || null,
    strategies,
    count: strategies.length,
    proposalOnly: true,
    financialExecutionAuthorized: false,
    guaranteed: false,
    disclaimer: 'NOT_GUARANTEED'
  };
}

/**
 * Compare only supplied proposals. A deterministic ordering is useful for UI,
 * but `winnerId` remains null unless evidence is sufficient for every compared
 * material choice. This prevents a low-evidence proposal from being displayed
 * as a certain winner.
 */
export function compareStrategies(strategies = [], { objective = 'risk-adjusted', now = Date.now() } = {}) {
  if (!Array.isArray(strategies)) return { ok: false, schema: STRATEGY_COMPETITION_SCHEMA, code: 'STRATEGIES_REQUIRED' };
  const rows = strategies.filter((row) => row?.schema === STRATEGY_PROPOSAL_SCHEMA).slice(0, 12);
  const ranked = rows.map((row) => {
    const quality = row.evidenceQuality || evidenceQuality(row.evidence);
    const expected = row.expectedReturnPct;
    const risk = row.riskPct;
    const score = quality.status === 'observed' && expected !== null && risk !== null
      ? Math.round((expected - risk * 0.5) * 100) / 100
      : null;
    return { id: row.id, score, evidenceStatus: quality.status, sampleSize: quality.sampleSize, riskPct: risk, expectedReturnPct: expected };
  }).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || (a.id || '').localeCompare(b.id || ''));
  const enough = ranked.length > 0 && ranked.every((row) => row.score !== null);
  return noExecutionPermission({
    ok: true,
    schema: STRATEGY_COMPETITION_SCHEMA,
    objective: safeString(objective, 80) || 'risk-adjusted',
    ranked,
    winnerId: enough ? ranked[0].id : null,
    winnerStatus: enough ? 'evidence-backed-provisional' : 'no-winner-without-evidence',
    generatedAt: now,
    requiresUserChoice: true,
    recalculationRequiredOnSwitch: true
  });
}

/** Run a supplied simulator. No simulator/provider means unavailable. */
export async function simulateRoute(strategy, { simulator = null, context = {}, now = Date.now() } = {}) {
  if (!strategy || strategy.schema !== STRATEGY_PROPOSAL_SCHEMA) return { ok: false, schema: STRATEGY_SIMULATION_SCHEMA, code: 'STRATEGY_REQUIRED', status: 'unavailable' };
  if (containsRawSecret(context)) return { ok: false, schema: STRATEGY_SIMULATION_SCHEMA, code: 'RAW_CREDENTIAL_FORBIDDEN', status: 'unavailable' };
  if (typeof simulator !== 'function') return unavailable('SIMULATOR_UNAVAILABLE', 'No route simulation provider is connected.', { schema: STRATEGY_SIMULATION_SCHEMA, strategyId: strategy.id });
  try {
    const result = await simulator({ strategyId: strategy.id, route: strategy.route, context: { ...context } });
    if (!result || result.ok !== true || result.status !== 'passed') {
      return unavailable('SIMULATION_NOT_PASSED', 'Simulation did not produce a passing runtime result.', { schema: STRATEGY_SIMULATION_SCHEMA, strategyId: strategy.id, result: publicSimulationResult(result), checkedAt: now });
    }
    return {
      ok: true,
      schema: STRATEGY_SIMULATION_SCHEMA,
      status: 'passed',
      strategyId: strategy.id,
      route: strategy.route,
      output: safeNumber(result.output, 0) === null ? null : safeNumber(result.output, 0),
      fee: safeNumber(result.fee, 0),
      slippagePct: bounded(result.slippagePct, 0, 100),
      providerId: safeId(result.providerId) || null,
      evidence: normalizeEvidence(result.evidence),
      checkedAt: now,
      executionPermission: false
    };
  } catch {
    return unavailable('SIMULATION_PROVIDER_ERROR', 'The simulation provider failed; no execution permission was created.', { schema: STRATEGY_SIMULATION_SCHEMA, strategyId: strategy.id });
  }
}

function publicSimulationResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    status: safeString(result.status, 32) || 'failed',
    providerId: safeId(result.providerId) || null,
    reason: safeString(result.reason, 160) || null
  };
}

/** Compare simulation outputs and mark only a provisional plan. */
export function competeStrategies({ strategies = [], simulations = [], now = Date.now() } = {}) {
  const byId = new Map((Array.isArray(simulations) ? simulations : []).filter((row) => row && typeof row === 'object').map((row) => [row.strategyId, row]));
  const ranked = (Array.isArray(strategies) ? strategies : [])
    .filter((strategy) => strategy && typeof strategy === 'object' && safeId(strategy.id))
    .map((strategy) => {
      const simulation = byId.get(strategy.id);
      const output = simulation?.status === 'passed' ? finite(simulation.output) : null;
      const fee = simulation?.status === 'passed' ? finite(simulation.fee) : null;
      const quality = simulation?.status === 'passed' ? evidenceQuality(simulation.evidence) : { status: 'insufficient-evidence', score: null, sampleSize: null };
      const net = output !== null && fee !== null ? output - fee : null;
      return { strategyId: strategy.id, simulationStatus: simulation?.status || 'unavailable', netOutput: net, evidenceStatus: quality.status, sampleSize: quality.sampleSize, evidenceBacked: net !== null && quality.status === 'observed' };
    }).sort((a, b) => (b.netOutput ?? -Infinity) - (a.netOutput ?? -Infinity) || a.strategyId.localeCompare(b.strategyId));
  const winner = ranked[0]?.evidenceBacked ? ranked[0].strategyId : null;
  return noExecutionPermission({
    ok: true,
    schema: STRATEGY_COMPETITION_SCHEMA,
    ranked,
    winnerId: winner,
    winnerStatus: winner ? 'provisional' : 'no-winner-without-passing-evidence',
    strategySelection: winner ? 'PROVISIONAL_ONLY' : 'NONE',
    generatedAt: now,
    userChoiceRequired: true,
    noExecutionPermission: true
  });
}

/** Explain why a comparison is provisional without turning it into a promise. */
export function explainStrategyComparison({ strategies = [], competition = null, now = Date.now() } = {}) {
  const rows = Array.isArray(strategies) ? strategies : [];
  const ranked = Array.isArray(competition?.ranked) ? competition.ranked : [];
  const explanations = ranked.map((row) => {
    const strategy = rows.find((candidate) => candidate?.id === row.strategyId);
    return {
      strategyId: row.strategyId,
      rank: ranked.indexOf(row) + 1,
      evidenceStatus: row.evidenceStatus || strategy?.evidenceQuality?.status || 'insufficient-evidence',
      sampleSize: row.sampleSize ?? strategy?.evidenceQuality?.sampleSize ?? null,
      riskPct: strategy?.riskPct ?? null,
      expectedReturnPct: strategy?.expectedReturnPct ?? null,
      potentialLossPct: strategy?.potentialLossPct ?? null,
      assumptions: safeList(strategy?.assumptions, (value) => safeString(value, 120), 12),
      reason: row.evidenceBacked ? 'Observed evidence supports a provisional comparison; user choice remains required.' : 'Evidence is insufficient or simulation did not pass; no winner is claimed.'
    };
  });
  return noExecutionPermission({
    ok: true,
    schema: STRATEGY_COMPETITION_SCHEMA,
    explanations,
    winnerId: competition?.winnerId || null,
    provisional: true,
    userChoiceRequired: true,
    generatedAt: now
  });
}

export const explainStrategy = explainStrategyComparison;

/** Switch to a user-selected or available alternative and force recalculation. */
export function switchStrategy({ currentStrategyId = null, selectedStrategyId = null, strategies = [], reason = 'user-choice', now = Date.now() } = {}) {
  const row = (Array.isArray(strategies) ? strategies : []).find((item) => item?.id === selectedStrategyId);
  if (!row) return { ok: false, schema: STRATEGY_SWITCH_SCHEMA, code: 'STRATEGY_NOT_FOUND', recalculationRequired: true };
  if (row.id === currentStrategyId) return { ok: false, schema: STRATEGY_SWITCH_SCHEMA, code: 'SAME_STRATEGY', recalculationRequired: false };
  return noExecutionPermission({
    ok: true,
    schema: STRATEGY_SWITCH_SCHEMA,
    from: safeId(currentStrategyId),
    to: row.id,
    reason: safeString(reason, 120) || 'user-choice',
    status: 'replanning',
    recalculationRequired: true,
    selected: false,
    generatedAt: now
  });
}

/** Monitoring is read-only and requires a connected monitor provider. */
export async function monitorStrategy(strategyId, { monitor = null, now = Date.now() } = {}) {
  const id = safeId(strategyId);
  if (!id) return { ok: false, schema: STRATEGY_MONITOR_SCHEMA, code: 'STRATEGY_ID_REQUIRED', status: 'unavailable' };
  if (typeof monitor !== 'function') return unavailable('MONITOR_UNAVAILABLE', 'No strategy monitoring runtime is connected.', { schema: STRATEGY_MONITOR_SCHEMA, strategyId: id });
  try {
    const result = await monitor(id);
    if (!result || result.ok !== true) return unavailable('MONITOR_RESULT_UNAVAILABLE', 'Monitoring did not return a verified state.', { schema: STRATEGY_MONITOR_SCHEMA, strategyId: id });
    return noExecutionPermission({ ok: true, schema: STRATEGY_MONITOR_SCHEMA, strategyId: id, status: 'monitoring', state: safeString(result.state, 48) || 'unknown', checkedAt: now, evidence: normalizeEvidence(result.evidence) });
  } catch {
    return unavailable('MONITOR_PROVIDER_ERROR', 'Monitoring provider failed.', { schema: STRATEGY_MONITOR_SCHEMA, strategyId: id });
  }
}

/** Declining an optional capability must produce a safe alternative/replan. */
export function replanAfterCapabilityDecline({ strategy, declinedCapability, alternatives = [], now = Date.now() } = {}) {
  if (!strategy || typeof strategy !== 'object') return { ok: false, schema: STRATEGY_SWITCH_SCHEMA, code: 'STRATEGY_REQUIRED' };
  const capability = safeString(String(declinedCapability || '').toLowerCase(), 64);
  const safeAlternatives = (Array.isArray(alternatives) ? alternatives : []).filter((row) => !row?.uses?.includes(capability)).slice(0, 8);
  return noExecutionPermission({
    ok: true,
    schema: STRATEGY_SWITCH_SCHEMA,
    fromStrategyId: safeId(strategy.id),
    declinedCapability: capability,
    alternatives: safeAlternatives.map((row) => safeId(row.id)).filter(Boolean),
    selectedStrategyId: null,
    status: safeAlternatives.length ? 'replanned' : 'no-safe-alternative',
    strategyContinues: safeAlternatives.length > 0,
    recalculationRequired: true,
    userChoiceRequired: true,
    generatedAt: now
  });
}
