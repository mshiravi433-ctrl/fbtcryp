/**
 * FBT FINANCIAL INTELLIGENCE OS — migrations (batch 7).
 * ---------------------------------------------------------------------------
 * The store is key-value (`server/store.js`), and a KV store CANNOT ENUMERATE
 * OWNERS. So migrations here are:
 *
 *   per-owner   applied lazily the first time that owner touches the API —
 *               the same owner that paid for the rows pays for the migration
 *   versioned   one integer per owner, persisted at fi:migrations:v1:<owner>
 *   idempotent  every block checks before it mutates, so a retry after a
 *               failed version-write is a no-op, never a double migration
 *
 * A migration block only ADDS missing fields; it never deletes a row. A
 * migration that destroys data on a retry is not a migration, it is a bug.
 *
 * The applied version is surfaced on /api/ai/health so an operator can see,
 * per deployment, that a long-lived user's rows were actually brought forward
 * instead of merely being assumed to be.
 */
import { storeGet, storeSet, storeDurable } from '../store.js';
import { computeAgentTrustScore } from './agents.js';

export const MIGRATIONS_SCHEMA = 'fbt.fi.migrations.v1';

export const CURRENT_MIGRATION_VERSION = 2;

const dayKeyOf = (at) => new Date(at).toISOString().slice(0, 10);

/**
 * v2: normalise the row shapes the batch 5–6 engines read. Rows written by
 * early builds may be missing fields a later reader assumes:
 *   policies          — the spend ledgers + attempt ledger
 *   agent_trust       — the live trust score (recomputed, never invented)
 *   learning_outcomes — grantsExecution: false (authority is never a row field)
 *   decision_traces   — the links + history the trace machine walks
 */
async function runV2(owner, { collections, now }) {
  let changes = 0;

  const pol = await collections.read('policies', owner);
  if (pol.ok && pol.rows.length) {
    let touched = 0;
    const next = pol.rows.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const fixed = { ...p };
      if (!fixed.spend || typeof fixed.spend !== 'object') {
        fixed.spend = { dayKey: dayKeyOf(now()), dayUsd: 0, dayCount: 0, totalUsd: 0, totalCount: 0, pendingUsd: 0 };
        touched += 1;
      }
      if (!Array.isArray(fixed.ledger)) { fixed.ledger = []; touched += 1; }
      if (!Array.isArray(fixed.history)) { fixed.history = []; touched += 1; }
      return fixed;
    });
    if (touched) { await collections.write('policies', owner, next); changes += touched; }
  }

  const ag = await collections.read('agent_trust', owner);
  if (ag.ok && ag.rows.length) {
    let touched = 0;
    const next = ag.rows.map((a) => {
      if (!a || typeof a !== 'object') return a;
      if (a.trust && typeof a.trust.score === 'number' && Array.isArray(a.trust.basis)) return a;
      const fixed = { ...a };
      fixed.trust = computeAgentTrustScore({ passport: fixed.passport || null, security: fixed.security || null, interactions: fixed.interactions || null, now: now() });
      fixed.expired = fixed.trust.tier === 'EXPIRED';
      touched += 1;
      return fixed;
    });
    if (touched) { await collections.write('agent_trust', owner, next); changes += touched; }
  }

  const lo = await collections.read('learning_outcomes', owner);
  if (lo.ok && lo.rows.length) {
    let touched = 0;
    const next = lo.rows.map((r) => {
      if (!r || typeof r !== 'object') return r;
      if (r.grantsExecution === false) return r;
      touched += 1;
      return { ...r, grantsExecution: false };
    });
    if (touched) { await collections.write('learning_outcomes', owner, next); changes += touched; }
  }

  const tr = await collections.read('decision_traces', owner);
  if (tr.ok && tr.rows.length) {
    let touched = 0;
    const next = tr.rows.map((t) => {
      if (!t || typeof t !== 'object') return t;
      const fixed = { ...t };
      if (!fixed.links || typeof fixed.links !== 'object') { fixed.links = {}; touched += 1; }
      if (!Array.isArray(fixed.history)) { fixed.history = [{ state: t.state || 'IDLE', at: t.createdAt || now() }]; touched += 1; }
      return fixed;
    });
    if (touched) { await collections.write('decision_traces', owner, next); changes += touched; }
  }

  return { version: 2, changes };
}

/** The ordered step list. A step's `version` is the version it PRODUCES. */
const STEPS = [
  { version: 2, name: 'v2-row-shape-normalisation', run: runV2 }
];

export function createMigrations({ collections, log = () => {}, now = () => Date.now() } = {}) {
  const keyFor = (owner) => `fi:migrations:v1:${String(owner || 'anon').slice(0, 80)}`;

  async function readState(owner) {
    try {
      const stored = await storeGet(keyFor(owner), null);
      if (stored && typeof stored === 'object' && Number.isFinite(Number(stored.version))) {
        return { ok: true, version: Number(stored.version), history: Array.isArray(stored.history) ? stored.history : [] };
      }
    } catch (err) {
      log(`migrations:read-failed:${String(err?.message || err).slice(0, 80)}`);
    }
    return { ok: true, version: 1, history: [] }; /* v1 = "the rows as first written" */
  }

  async function writeState(owner, version, history) {
    const res = await storeSet(keyFor(owner), { schema: MIGRATIONS_SCHEMA, owner: null, version, history, migratedAt: now() });
    return { ok: res?.ok !== false, durable: storeDurable() };
  }

  /**
   * Apply every pending step for one owner. Safe to call on every request:
   * already-applied steps are skipped, and a step that ran but failed to
   * record its version re-runs next time and finds nothing left to do.
   */
  async function migrateOwner(owner) {
    const started = now();
    const { version: applied, history } = await readState(owner);
    const appliedSteps = [];
    let changes = 0;

    for (const step of STEPS) {
      if (step.version <= applied) continue;
      let out;
      try {
        out = await step.run(owner, { collections, now });
      } catch (err) {
        return { ok: false, code: 'MIGRATION_STEP_FAILED', step: step.name, detail: String(err?.message || err).slice(0, 160) };
      }
      if (!out || typeof out !== 'object') {
        return { ok: false, code: 'MIGRATION_STEP_FAILED', step: step.name, detail: 'the step returned nothing; nothing was committed' };
      }
      const write = await writeState(owner, step.version, [...history, { version: step.version, name: step.name, at: now(), changes: out.changes || 0 }]);
      if (!write.ok) {
        return { ok: false, code: 'MIGRATION_VERSION_WRITE_FAILED', step: step.name, detail: 'the step ran idempotently but its version was not recorded; it will re-run' };
      }
      appliedSteps.push({ version: step.version, name: step.name, changes: out.changes || 0 });
      changes += out.changes || 0;
    }

    return { ok: true, from: applied, to: CURRENT_MIGRATION_VERSION, applied: appliedSteps, changes, ms: now() - started, durable: storeDurable() };
  }

  async function status(owner) {
    const { version } = await readState(owner);
    return {
      ok: true,
      schema: MIGRATIONS_SCHEMA,
      applied: version,
      current: CURRENT_MIGRATION_VERSION,
      pending: Math.max(0, CURRENT_MIGRATION_VERSION - version),
      durable: storeDurable()
    };
  }

  return { schema: MIGRATIONS_SCHEMA, CURRENT_MIGRATION_VERSION, migrateOwner, status };
}
