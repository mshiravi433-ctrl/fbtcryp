/**
 * FBT FINANCIAL INTELLIGENCE OS — Decision Trace + AI State Machine (§32, §33).
 * ---------------------------------------------------------------------------
 * One queryable record per operation, linking every stage:
 *
 *   intentId · worldStateId · researchId · strategyId · simulationId
 *   riskCheckId · policyId · executionId · verificationId · resultId
 *
 * THE STATE MACHINE IS ENFORCED, NOT DOCUMENTED
 * `transition()` refuses an edge that is not in AI_STATE_TRANSITIONS, and it
 * refuses COMPLETED unless a verificationId is attached — §33's "do not mark an
 * operation COMPLETED before actual verification" is a code path, not a
 * comment. Terminal states cannot be left, so a FAILED operation can never be
 * quietly retried into COMPLETED.
 */

export const TRACE_SCHEMA = 'fbt.fi.decision-trace.v1';

export const AI_STATES = Object.freeze([
  'IDLE', 'UNDERSTANDING', 'COLLECTING_DATA', 'RESEARCHING', 'BUILDING_STATE',
  'GENERATING_STRATEGIES', 'SIMULATING', 'RISK_REVIEW', 'WAITING_FOR_CONFIRMATION',
  'AUTHORIZED', 'EXECUTING', 'VERIFYING', 'MONITORING', 'REPLANNING',
  'COMPLETED', 'FAILED', 'BLOCKED', 'UNCERTAIN'
]);

export const AI_STATE_TRANSITIONS = Object.freeze({
  IDLE: ['UNDERSTANDING'],
  UNDERSTANDING: ['COLLECTING_DATA', 'UNCERTAIN', 'FAILED'],
  COLLECTING_DATA: ['BUILDING_STATE', 'RESEARCHING', 'UNCERTAIN', 'FAILED', 'BLOCKED'],
  BUILDING_STATE: ['RESEARCHING', 'GENERATING_STRATEGIES', 'RISK_REVIEW', 'FAILED', 'BLOCKED'],
  RESEARCHING: ['BUILDING_STATE', 'GENERATING_STRATEGIES', 'UNCERTAIN', 'FAILED'],
  GENERATING_STRATEGIES: ['SIMULATING', 'RISK_REVIEW', 'UNCERTAIN', 'FAILED'],
  SIMULATING: ['RISK_REVIEW', 'WAITING_FOR_CONFIRMATION', 'FAILED', 'UNCERTAIN'],
  RISK_REVIEW: ['WAITING_FOR_CONFIRMATION', 'BLOCKED', 'FAILED', 'GENERATING_STRATEGIES'],
  WAITING_FOR_CONFIRMATION: ['AUTHORIZED', 'BLOCKED', 'FAILED', 'IDLE'],
  AUTHORIZED: ['EXECUTING', 'BLOCKED', 'FAILED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'BLOCKED'],
  VERIFYING: ['COMPLETED', 'MONITORING', 'FAILED'],
  MONITORING: ['REPLANNING', 'COMPLETED', 'FAILED'],
  REPLANNING: ['GENERATING_STRATEGIES', 'COLLECTING_DATA', 'COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  BLOCKED: ['IDLE', 'FAILED'],
  UNCERTAIN: ['COLLECTING_DATA', 'UNDERSTANDING', 'FAILED', 'BLOCKED']
});

export const TERMINAL_STATES = Object.freeze(['COMPLETED', 'FAILED']);

const LINK_FIELDS = Object.freeze([
  'intentId', 'worldStateId', 'financialStateId', 'researchId', 'strategyId',
  'comparisonId', 'simulationId', 'riskCheckId', 'policyId', 'executionId',
  'verificationId', 'resultId'
]);

export function createTrace({ owner, correlationId = null, intentId = null, now = Date.now() } = {}) {
  return {
    schema: TRACE_SCHEMA,
    id: `trc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    owner: owner ? String(owner).slice(0, 80) : null,
    correlationId: correlationId ? String(correlationId).slice(0, 64) : null,
    state: 'IDLE',
    links: { ...Object.fromEntries(LINK_FIELDS.map((f) => [f, null])), ...(intentId ? { intentId: String(intentId).slice(0, 64) } : {}) },
    history: [{ state: 'IDLE', at: now }],
    evidenceIds: [],
    error: null,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Move the trace to the next state. Returns `{ ok:false, code }` for an illegal
 * edge, an unknown state, a move out of a terminal state, or COMPLETED without
 * verification.
 */
export function transition(trace, next, { at = Date.now(), note = null, evidenceIds = [] } = {}) {
  if (!trace) return { ok: false, code: 'NO_TRACE' };
  const target = String(next || '').toUpperCase();
  if (!AI_STATES.includes(target)) return { ok: false, code: 'UNKNOWN_STATE', state: target, allowed: AI_STATES };
  const current = trace.state;
  if (TERMINAL_STATES.includes(current)) return { ok: false, code: 'TRACE_IS_TERMINAL', state: current };
  const allowed = AI_STATE_TRANSITIONS[current] || [];
  if (!allowed.includes(target)) return { ok: false, code: 'ILLEGAL_TRANSITION', from: current, to: target, allowed };
  if (target === 'COMPLETED' && !trace.links.verificationId) {
    return { ok: false, code: 'COMPLETED_REQUIRES_VERIFICATION', detail: 'an operation is COMPLETED only after its execution was verified on the venue/chain' };
  }
  trace.state = target;
  trace.updatedAt = at;
  trace.history.push({ state: target, at, note: note ? String(note).slice(0, 200) : null });
  if (Array.isArray(evidenceIds) && evidenceIds.length) {
    trace.evidenceIds = [...new Set([...(trace.evidenceIds || []), ...evidenceIds.map(String)])].slice(0, 60);
  }
  return { ok: true, state: target };
}

/** Attach a stage id. Unknown fields are refused so a trace cannot silently
 *  lose a link because of a typo. */
export function link(trace, field, value) {
  if (!trace) return { ok: false, code: 'NO_TRACE' };
  if (!LINK_FIELDS.includes(field)) return { ok: false, code: 'UNKNOWN_TRACE_FIELD', field, allowed: LINK_FIELDS };
  if (value === null || value === undefined) return { ok: false, code: 'VALUE_REQUIRED', field };
  trace.links[field] = String(value).slice(0, 64);
  trace.updatedAt = Date.now();
  return { ok: true, field, value: trace.links[field] };
}

export function fail(trace, error, { at = Date.now() } = {}) {
  if (!trace) return { ok: false, code: 'NO_TRACE' };
  if (TERMINAL_STATES.includes(trace.state)) return { ok: false, code: 'TRACE_IS_TERMINAL', state: trace.state };
  trace.error = { code: String(error?.code || error || 'FAILED').slice(0, 80), detail: String(error?.detail || error?.message || '').slice(0, 240), at };
  trace.state = 'FAILED';
  trace.updatedAt = at;
  trace.history.push({ state: 'FAILED', at, note: trace.error.code });
  return { ok: true, state: 'FAILED' };
}

export function block(trace, reason, { at = Date.now() } = {}) {
  if (!trace) return { ok: false, code: 'NO_TRACE' };
  const allowed = AI_STATE_TRANSITIONS[trace.state] || [];
  if (!allowed.includes('BLOCKED')) return { ok: false, code: 'CANNOT_BLOCK_FROM', state: trace.state };
  trace.state = 'BLOCKED';
  trace.error = { code: 'BLOCKED', detail: String(reason || '').slice(0, 240), at };
  trace.updatedAt = at;
  trace.history.push({ state: 'BLOCKED', at, note: trace.error.detail });
  return { ok: true, state: 'BLOCKED' };
}

export function traceSummary(trace) {
  if (!trace) return null;
  return {
    id: trace.id,
    owner: trace.owner,
    correlationId: trace.correlationId,
    state: trace.state,
    links: { ...trace.links },
    steps: trace.history.length,
    evidence: (trace.evidenceIds || []).length,
    error: trace.error,
    durationMs: trace.updatedAt - trace.createdAt,
    completed: trace.state === 'COMPLETED' && Boolean(trace.links.verificationId)
  };
}

export function createTraceStore({ collections, observability = null, log = () => {} } = {}) {
  const live = new Map(); // traceId -> trace (hot path; persisted on every write)

  async function open({ owner, correlationId = null, intentId = null } = {}) {
    const trace = createTrace({ owner, correlationId, intentId });
    live.set(trace.id, trace);
    await collections.put('decision_traces', owner, trace);
    return trace;
  }

  async function save(owner, trace) {
    await collections.put('decision_traces', owner, trace);
    return trace;
  }

  async function move(owner, trace, next, opts = {}) {
    const out = transition(trace, next, opts);
    if (!out.ok) {
      log(`trace:refused:${out.code}:${trace.state}->${next}`);
      return out;
    }
    await save(owner, trace);
    const eventFor = {
      EXECUTING: 'execution.started', VERIFYING: 'execution.submitted', COMPLETED: 'execution.confirmed',
      FAILED: 'execution.failed', MONITORING: 'monitor.triggered', REPLANNING: 'replan.started',
      RISK_REVIEW: 'risk.passed', WAITING_FOR_CONFIRMATION: 'decision.completed'
    }[out.state];
    if (observability && eventFor) {
      observability.emit({ type: eventFor, owner, correlationId: trace.correlationId, payload: { traceId: trace.id, state: out.state, ...(opts.note ? { note: opts.note } : {}) } });
    }
    return out;
  }

  async function get(owner, id) {
    const hot = live.get(String(id));
    if (hot) return { ok: true, trace: hot };
    return collections.get('decision_traces', owner, id);
  }

  async function list(owner, { limit = 20 } = {}) {
    const { rows } = await collections.read('decision_traces', owner);
    return rows.slice(0, Math.max(1, limit)).map(traceSummary);
  }

  return { schema: TRACE_SCHEMA, open, save, move, get, list, link, fail, block, transition, summary: traceSummary, LINK_FIELDS, AI_STATES };
}
