/**
 * FBT INTENT AI — PHASE 74: LIVE SPECIALIST MARKETPLACE
 * ---------------------------------------------------------------------------
 * A market is not a shop window. `specialistMarket.js` can list agents;
 * phase 74 makes listing conditional on real, observed supply and demand — and
 * makes "we suggest this agent" a claim we can defend.
 *
 *   · an agent with no PROVEN skill in the requested capability is never
 *     suggested. Not ranked low — absent.
 *   · proof means: enough completed jobs, observed by someone other than the
 *     agent, recent enough to still mean something
 *   · capacity is real: an agent at its concurrency limit is unavailable, and
 *     an unavailable agent is not offered
 *   · the market reports honest emptiness rather than padding the list
 */

import { classifyFailure } from './failureModes.js';
import { MIN_OBSERVED_SAMPLE_SIZE } from './agentScore.js';

export const MARKETPLACE_SCHEMA = 'fbt.live-marketplace.v1';
export const MIN_PROVEN_JOBS = MIN_OBSERVED_SAMPLE_SIZE;
export const PROOF_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const MIN_SUCCESS_RATE = 0.7;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Has this agent actually done this kind of work, provably and recently? */
export function proveSkill({ agent = null, capability = null, now = Date.now() } = {}) {
  const reasons = [];
  if (!agent || typeof agent !== 'object') reasons.push('NO_AGENT');
  if (!capability) reasons.push('NO_CAPABILITY');
  const jobs = (Array.isArray(agent?.completedJobs) ? agent.completedJobs : []).filter((j) => {
    if (j?.capability !== capability) return false;
    // A job the agent attested to itself is not evidence.
    if (j?.verified !== true) return false;
    if (typeof j?.attestedBy !== 'string' || j.attestedBy === agent.id) return false;
    const at = num(j?.at);
    if (at === null || now - at > PROOF_MAX_AGE_MS) return false;
    return true;
  });
  const successes = jobs.filter((j) => j.outcome === 'success').length;
  const rate = jobs.length ? successes / jobs.length : null;
  if (!reasons.length) {
    if (jobs.length < MIN_PROVEN_JOBS) reasons.push('NOT_ENOUGH_PROVEN_JOBS');
    else if (rate === null || rate < MIN_SUCCESS_RATE) reasons.push('SUCCESS_RATE_TOO_LOW');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, proven: false, capability, sampleSize: jobs.length, successRate: rate, reasons: unique, i18nKey: 'intentAI.market.unproven' }
    : { ok: true, proven: true, capability, sampleSize: jobs.length, successRate: Math.round(rate * 100) / 100 };
}

/** Real supply: who can actually take work right now. */
export function computeSupply({ agents = [], capability = null, now = Date.now() } = {}) {
  const list = Array.isArray(agents) ? agents : [];
  const available = [];
  const withheld = [];
  for (const a of list) {
    const skill = proveSkill({ agent: a, capability, now });
    if (!skill.proven) { withheld.push({ id: a?.id ?? null, reason: skill.reasons[0] }); continue; }
    if (a.suspended === true) { withheld.push({ id: a.id, reason: 'SUSPENDED' }); continue; }
    const active = num(a.activeJobs) ?? 0;
    const capacity = num(a.maxConcurrentJobs);
    if (capacity !== null && active >= capacity) { withheld.push({ id: a.id, reason: 'AT_CAPACITY' }); continue; }
    available.push({ id: a.id, skill, freeSlots: capacity === null ? null : capacity - active, priceUsd: num(a.priceUsd) });
  }
  return {
    ok: true, schema: MARKETPLACE_SCHEMA, capability,
    supply: available.length, available, withheld, at: now
  };
}

/** Real demand: open requests that are still open. */
export function computeDemand({ requests = [], capability = null, now = Date.now() } = {}) {
  const open = (Array.isArray(requests) ? requests : []).filter((r) => {
    if (r?.capability !== capability) return false;
    if (r?.state !== 'open') return false;
    const expires = num(r?.expiresAt);
    return expires === null || expires > now;
  });
  return { ok: true, schema: MARKETPLACE_SCHEMA, capability, demand: open.length, requests: open, at: now };
}

/** Supply vs demand, stated as a fact rather than a vibe. */
export function marketConditions({ supply = null, demand = null, now = Date.now() } = {}) {
  const s = num(supply?.supply);
  const d = num(demand?.demand);
  if (s === null || d === null) {
    return { ok: false, state: 'unknown', i18nKey: 'intentAI.market.unknown', error: classifyFailure('MISSING_DATA', { detail: 'NO_MARKET_DATA' }) };
  }
  const ratio = d === 0 ? null : Math.round((s / d) * 100) / 100;
  const state = s === 0 ? 'no-supply' : (d === 0 ? 'no-demand' : (ratio <= 0.5 ? 'tight' : (ratio >= 2 ? 'ample' : 'balanced')));
  return {
    ok: true, schema: MARKETPLACE_SCHEMA, state, supply: s, demand: d, ratio,
    i18nKey: `intentAI.market.${state === 'no-supply' ? 'noSupply' : (state === 'no-demand' ? 'noDemand' : state)}`,
    at: now
  };
}

/** The suggestion. Empty is a valid, honest answer. */
export function suggestSpecialists({ agents = [], capability = null, requestSizeUsd = null, limit = 5, now = Date.now() } = {}) {
  if (!capability) {
    return { ok: false, suggestions: [], i18nKey: 'intentAI.market.unknown', error: classifyFailure('MISSING_DATA', { detail: 'NO_CAPABILITY' }) };
  }
  const supply = computeSupply({ agents, capability, now });
  const size = num(requestSizeUsd);
  const affordable = supply.available.filter((a) => size === null || a.priceUsd === null || a.priceUsd <= size);
  const ranked = [...affordable].sort((a, b) => (b.skill.successRate - a.skill.successRate) || (b.skill.sampleSize - a.skill.sampleSize));
  const suggestions = ranked.slice(0, Math.max(1, num(limit) ?? 5)).map((a) => ({
    agentId: a.id,
    capability,
    // Every suggestion carries the evidence behind it.
    provenJobs: a.skill.sampleSize,
    successRate: a.skill.successRate,
    priceUsd: a.priceUsd,
    freeSlots: a.freeSlots,
    executionAuthorized: false,
    requiresConfirmationGate: true
  }));
  return {
    ok: true,
    schema: MARKETPLACE_SCHEMA,
    capability,
    suggestions,
    withheld: supply.withheld,
    empty: suggestions.length === 0,
    i18nKey: suggestions.length ? 'intentAI.market.suggestions' : 'intentAI.market.noneQualified',
    i18nParams: { count: suggestions.length },
    at: now
  };
}

/** Nothing unproven may ever be suggested. */
export function assertOnlyProvenSuggested(result, { agents = [], now = Date.now() } = {}) {
  const reasons = [];
  if (!result || result.schema !== MARKETPLACE_SCHEMA) reasons.push('NOT_A_MARKET_RESULT');
  const byId = new Map((Array.isArray(agents) ? agents : []).map((a) => [a?.id, a]));
  for (const s of Array.isArray(result?.suggestions) ? result.suggestions : []) {
    const agent = byId.get(s.agentId);
    const skill = proveSkill({ agent, capability: s.capability ?? result.capability, now });
    if (!skill.proven) reasons.push(`UNPROVEN:${s.agentId}`);
    if (agent?.suspended === true) reasons.push(`SUSPENDED:${s.agentId}`);
    if ((num(s.provenJobs) ?? 0) < MIN_PROVEN_JOBS) reasons.push(`UNDER_SAMPLED:${s.agentId}`);
    if (s.executionAuthorized === true) reasons.push(`CLAIMS_AUTHORITY:${s.agentId}`);
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true, suggested: (result?.suggestions || []).length };
}
