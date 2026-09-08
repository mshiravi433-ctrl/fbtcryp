/**
 * FBT FINANCIAL INTELLIGENCE OS — structured observability (§34).
 * ---------------------------------------------------------------------------
 * The §34 vocabulary, emitted as data with a correlation id so one user
 * sentence can be followed all the way to its execution result.
 *
 * Events are mirrored onto the brain's own bus (`server/ci/eventBus.js`) when
 * one is supplied, so the existing SSE stream and the Operations surface see
 * financial-intelligence activity without a second transport. They are also
 * kept in a bounded in-process ring for `/api/ai/trace/:id`.
 */
import { randomUUID } from 'node:crypto';

export const OBSERVABILITY_SCHEMA = 'fbt.fi.observability.v1';

export const FI_EVENTS = Object.freeze([
  'intent.started', 'intent.understood',
  'state.built', 'world.built',
  'research.started', 'research.completed',
  'strategy.generated', 'strategy.selected',
  'simulation.completed',
  'risk.passed', 'risk.failed',
  'policy.passed', 'policy.failed',
  'execution.started', 'execution.submitted', 'execution.confirmed', 'execution.failed',
  'verification.completed',
  'monitor.triggered', 'replan.started', 'replan.completed',
  'learning.completed',
  'guardian.alerted', 'decision.completed', 'evidence.recorded'
]);

const FI_EVENT_SET = new Set(FI_EVENTS);
/* The brain's bus has a fixed EVENT_TYPES vocabulary; anything outside it is
   published as a typed payload under a bus event it does understand, so we
   never teach the existing bus a new enum it was not written for. */
const BUS_TYPE_FOR = {
  'execution.failed': 'TRANSACTION_FAILED',
  'risk.failed': 'RISK_CHANGED',
  'policy.failed': 'POLICY_BLOCKED',
  'guardian.alerted': 'ALERT_FIRED',
  'monitor.triggered': 'RISK_CHANGED',
  'replan.completed': 'GOAL_PROGRESS_CHANGED',
  'execution.confirmed': 'TRANSACTION_CONFIRMED'
};

export function createObservability({ events = null, capacity = 1000, log = () => {} } = {}) {
  const ring = [];

  function emit({ type, owner = null, correlationId = null, payload = {}, severity = 'info', at = Date.now() } = {}) {
    const name = String(type || '');
    if (!FI_EVENT_SET.has(name)) {
      /* An unknown event name is a bug in OUR code, not a reason to invent one:
         log it loudly and refuse rather than polluting the vocabulary. */
      log(`observability:refused-unknown-event:${name.slice(0, 40)}`);
      return null;
    }
    const row = {
      schema: OBSERVABILITY_SCHEMA,
      type: name,
      owner: owner ? String(owner).slice(0, 80) : null,
      correlationId: correlationId ? String(correlationId).slice(0, 64) : null,
      severity,
      payload: sanitizePayload(payload),
      at
    };
    ring.push(row);
    if (ring.length > capacity) ring.splice(0, ring.length - capacity);
    if (events && typeof events.publish === 'function') {
      try {
        events.publish({
          type: BUS_TYPE_FOR[name] || 'CAPABILITY_CHANGED',
          owner: row.owner,
          payload: { fi: name, correlationId: row.correlationId, ...(row.payload || {}) },
          source: 'fios'
        });
      } catch (err) {
        log(`observability:bus-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    return row;
  }

  function recent({ owner = null, correlationId = null, type = null, limit = 100 } = {}) {
    return ring
      .filter((r) => (!owner || r.owner === owner) && (!correlationId || r.correlationId === correlationId) && (!type || r.type === type))
      .slice(-Math.min(500, Math.max(1, Number(limit) || 100)))
      .reverse();
  }

  return {
    schema: OBSERVABILITY_SCHEMA,
    emit,
    recent,
    correlationId: (prefix = 'fi') => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    stats: () => {
      const byType = {};
      for (const r of ring) byType[r.type] = (byType[r.type] || 0) + 1;
      return { buffered: ring.length, capacity, byType, vocabulary: FI_EVENTS.length };
    },
    clear: () => { ring.length = 0; }
  };
}

const KEYISH = /(?:private[ _-]?key|secret|mnemonic|seed[ _-]?phrase|passphrase|signature|token)/i;

/** Never let a key-shaped field reach a log line, a bus payload or the API. */
function sanitizePayload(payload, depth = 0) {
  if (payload === null || payload === undefined) return null;
  if (depth > 4) return '[truncated]';
  if (typeof payload !== 'object') return typeof payload === 'string' ? payload.slice(0, 240) : payload;
  if (Array.isArray(payload)) return payload.slice(0, 20).map((v) => sanitizePayload(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(payload).slice(0, 40)) {
    if (KEYISH.test(k)) { out[k] = '[REDACTED]'; continue; }
    out[k] = sanitizePayload(v, depth + 1);
  }
  return out;
}
