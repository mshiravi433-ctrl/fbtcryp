/**
 * FBT FINANCIAL INTELLIGENCE OS — Memory 2.0 (§7).
 * ---------------------------------------------------------------------------
 * Separate stores, because "the user said X" and "the AI concluded X" are
 * different facts and must never be read back as the same one:
 *
 *   conversation            the turn thread (owned by the brain — we READ it,
 *                           we do not keep a second copy)
 *   explicit_user           things the user stated ("I never use leverage")
 *   preference              declared settings (slippage 0.5%, chain: Base)
 *   behavior                patterns measured from verified history
 *   strategy_outcome        what actually happened after a strategy ran
 *   financial_state_history snapshot rows (own collection, see collections.js)
 *   intent_genome           the evolved vector (own collection)
 *
 * Provenance is a first-class field on every row:
 *   USER_SAID > USER_PREFERRED > USER_BEHAVIOR > AI_INFERRED
 * and `resolve()` returns the highest-ranked row for a key plus the rows it
 * beat, so an answer can always say WHY it believes what it believes. An
 * AI_INFERRED row can never overwrite a USER_SAID row (§7).
 *
 * Persistence uses the `preferences` collection as one row per owner, so
 * memory survives a cold start exactly as far as the rest of the store does —
 * and `durable` is reported, never assumed.
 */
import { sanitize } from '../../src/lib/central/memory.js';

export const MEMORY2_SCHEMA = 'fbt.fi.memory2.v1';

export const MEMORY_STORES = Object.freeze([
  'conversation', 'explicit_user', 'preference', 'behavior',
  'strategy_outcome', 'financial_state_history', 'intent_genome'
]);

/** §7 — the four classes the AI must be able to tell apart. */
export const MEMORY_PROVENANCE = Object.freeze(['USER_SAID', 'USER_PREFERRED', 'USER_BEHAVIOR', 'AI_INFERRED']);

const RANK = Object.freeze({ USER_SAID: 4, USER_PREFERRED: 3, USER_BEHAVIOR: 2, AI_INFERRED: 1 });
/** Which store each provenance class writes to. */
const STORE_FOR_PROVENANCE = Object.freeze({
  USER_SAID: 'explicit_user',
  USER_PREFERRED: 'preference',
  USER_BEHAVIOR: 'behavior',
  AI_INFERRED: 'behavior'
});
const MAX_ROWS_PER_STORE = 60;
const MAX_OUTCOMES = 40;
const MEMORY_ROW_ID = 'memory-v1';
const TTL_BY_PROVENANCE = Object.freeze({
  USER_SAID: 365 * 24 * 3600_000,
  USER_PREFERRED: 365 * 24 * 3600_000,
  USER_BEHAVIOR: 180 * 24 * 3600_000,
  AI_INFERRED: 30 * 24 * 3600_000
});

const emptyMemoryRow = () => ({
  schema: MEMORY2_SCHEMA,
  id: MEMORY_ROW_ID,
  explicit_user: {},
  preference: {},
  behavior: {},
  strategy_outcome: [],
  updatedAt: 0
});

export function createMemory2({ collections, observability = null, conversation = null, log = () => {}, now = () => Date.now() } = {}) {
  async function load(owner) {
    const { ok, rows, code } = await collections.read('preferences', owner);
    if (!ok) return { ok: false, code, row: emptyMemoryRow() };
    const row = rows.find((r) => r?.id === MEMORY_ROW_ID);
    return { ok: true, row: row ? { ...emptyMemoryRow(), ...row } : emptyMemoryRow() };
  }

  async function save(owner, row) {
    const next = { ...row, updatedAt: now() };
    const res = await collections.put('preferences', owner, next);
    return { ok: res.ok, durable: res.durable ?? collections.durable(), code: res.code || null };
  }

  /**
   * REMEMBER THIS (§37). `provenance` decides the store; a lower-ranked class
   * may not replace a higher-ranked row for the same key.
   */
  async function remember(owner, { key, value, provenance = 'USER_SAID', store = null, note = null, correlationId = null, evidenceIds = [] } = {}) {
    if (!MEMORY_PROVENANCE.includes(provenance)) return { ok: false, code: 'BAD_PROVENANCE', allowed: MEMORY_PROVENANCE };
    const target = store && MEMORY_STORES.includes(store) ? store : STORE_FOR_PROVENANCE[provenance];
    if (target === 'conversation') return { ok: false, code: 'CONVERSATION_IS_OWNED_BY_THE_BRAIN', detail: 'the turn thread is not a place to store facts' };
    if (!key) return { ok: false, code: 'KEY_REQUIRED' };
    const clean = sanitize(value);
    if (clean === null || clean === '[REDACTED]') return { ok: false, code: 'NOTHING_STORABLE', detail: 'empty or matched the secret filter' };

    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code };
    const row = loaded.row;
    const bucket = row[target] || (row[target] = {});
    const prev = bucket[String(key)];
    /* A stronger record anywhere for this key wins: provenance is about WHO
       asserted the fact, not about which bucket the write happens to land in.
       An inference therefore cannot displace what the user said, even though
       the two would be stored in different stores. */
    let strongest = prev || null;
    for (const store of MEMORY_STORES) {
      if (store === target) continue;
      const other = row[store]?.[String(key)];
      if (other && (RANK[other.provenance] || 0) > (RANK[strongest?.provenance] || 0)) strongest = other;
    }
    const userOriginated = provenance === 'USER_SAID' || provenance === 'USER_PREFERRED';
    if (strongest && !userOriginated && (RANK[strongest.provenance] || 0) > (RANK[provenance] || 0)) {
      return { ok: false, code: 'WOULD_DOWNGRADE_MEMORY', existing: strongest, detail: `${strongest.provenance} outranks ${provenance}; the stronger record stays` };
    }
    bucket[String(key).slice(0, 60)] = {
      value: clean,
      provenance,
      note: note ? String(note).slice(0, 200) : null,
      evidenceIds: (Array.isArray(evidenceIds) ? evidenceIds : []).slice(0, 8).map(String),
      at: now(),
      expiresAt: now() + (TTL_BY_PROVENANCE[provenance] || 30 * 24 * 3600_000),
      supersedes: prev?.at || null
    };
    pruneBucket(bucket);
    const res = await save(owner, row);
    if (observability) observability.emit({ type: 'learning.completed', owner, correlationId, payload: { memory: 'remember', store: target, key, provenance } });
    return { ok: true, store: target, key: String(key), provenance, replaced: prev ? prev.provenance : null, durable: res.durable };
  }

  /** FORGET THIS (§37). Removes the key from EVERY store — a forgotten fact
   *  must not survive in the inference bucket. */
  async function forget(owner, { key, correlationId = null } = {}) {
    if (!key) return { ok: false, code: 'KEY_REQUIRED' };
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code };
    const row = loaded.row;
    let removed = 0;
    for (const store of ['explicit_user', 'preference', 'behavior']) {
      if (row[store] && Object.prototype.hasOwnProperty.call(row[store], String(key))) { delete row[store][String(key)]; removed += 1; }
    }
    const res = await save(owner, row);
    if (observability) observability.emit({ type: 'learning.completed', owner, correlationId, payload: { memory: 'forget', key, removed } });
    return { ok: removed > 0, removed, durable: res.durable, code: removed ? null : 'NOT_FOUND' };
  }

  /** Read one key with full precedence: winner + the rows it outranked. */
  async function resolve(owner, key, { at = now() } = {}) {
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code, value: null, provenance: null, candidates: [] };
    const candidates = [];
    for (const store of ['explicit_user', 'preference', 'behavior']) {
      const rec = loaded.row[store]?.[String(key)];
      if (!rec) continue;
      if (rec.expiresAt && rec.expiresAt <= at) continue;
      candidates.push({ store, ...rec, rank: RANK[rec.provenance] || 0 });
    }
    /* User data always outranks inference. Among the user's OWN records the
       NEWEST wins, because an explicit later setting is the user changing their
       mind; rank alone would freeze the first thing they ever said. */
    const userOrigin = ['USER_SAID', 'USER_PREFERRED'];
    candidates.sort((a, b) => {
      const au = userOrigin.includes(a.provenance) ? 1 : 0;
      const bu = userOrigin.includes(b.provenance) ? 1 : 0;
      if (au !== bu) return bu - au;
      if (au === 1) return (b.at - a.at) || (b.rank - a.rank);
      return (b.rank - a.rank) || (b.at - a.at);
    });
    const winner = candidates[0] || null;
    return {
      ok: Boolean(winner),
      key: String(key),
      value: winner ? winner.value : null,
      provenance: winner ? winner.provenance : null,
      store: winner ? winner.store : null,
      at: winner ? winner.at : null,
      outranked: candidates.slice(1).map((c) => ({ provenance: c.provenance, value: c.value })),
      candidates: candidates.length,
      code: winner ? null : 'NOT_REMEMBERED'
    };
  }

  async function recall(owner, { store = null, at = now() } = {}) {
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code, rows: {} };
    const stores = store ? [store] : ['explicit_user', 'preference', 'behavior'];
    const out = {};
    for (const s of stores) {
      if (!MEMORY_STORES.includes(s)) continue;
      const bucket = loaded.row[s] || {};
      out[s] = Object.fromEntries(Object.entries(bucket).filter(([, r]) => !r.expiresAt || r.expiresAt > at));
    }
    if (!store || store === 'strategy_outcome') out.strategy_outcome = (loaded.row.strategy_outcome || []).slice(0, MAX_OUTCOMES);
    return { ok: true, rows: out, durable: collections.durable() };
  }

  /** Strategy outcome memory (§7/§31): only VERIFIED outcomes belong here. */
  async function recordOutcome(owner, outcome = {}, { correlationId = null } = {}) {
    if (!outcome?.strategyId) return { ok: false, code: 'STRATEGY_ID_REQUIRED' };
    if (outcome.verified !== true) {
      /* An unverified fill is not an outcome. Recording it would teach the
         preference model from a transaction that may never have landed. */
      return { ok: false, code: 'OUTCOME_NOT_VERIFIED', detail: 'only verified executions may enter strategy outcome memory' };
    }
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code };
    const row = loaded.row;
    const rec = {
      strategyId: String(outcome.strategyId).slice(0, 64),
      kind: String(outcome.kind || 'execution').slice(0, 40),
      expected: sanitize(outcome.expected ?? null),
      actual: sanitize(outcome.actual ?? null),
      feesUsd: Number.isFinite(Number(outcome.feesUsd)) ? Number(outcome.feesUsd) : null,
      slippagePct: Number.isFinite(Number(outcome.slippagePct)) ? Number(outcome.slippagePct) : null,
      pnlUsd: Number.isFinite(Number(outcome.pnlUsd)) ? Number(outcome.pnlUsd) : null,
      goalImpactPct: Number.isFinite(Number(outcome.goalImpactPct)) ? Number(outcome.goalImpactPct) : null,
      userFeedback: outcome.userFeedback === undefined ? null : sanitize(outcome.userFeedback),
      at: now()
    };
    row.strategy_outcome = [rec, ...(row.strategy_outcome || [])].slice(0, MAX_OUTCOMES);
    const res = await save(owner, row);
    return { ok: true, outcome: rec, durable: res.durable };
  }

  async function outcomes(owner, { limit = MAX_OUTCOMES } = {}) {
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code, rows: [] };
    return { ok: true, rows: (loaded.row.strategy_outcome || []).slice(0, limit) };
  }

  /** Financial state history lives in its own collection (capped at 60). */
  async function pushStateSnapshot(owner, snapshot) {
    if (!snapshot) return { ok: false, code: 'SNAPSHOT_REQUIRED' };
    const res = await collections.put('financial_state', owner, snapshot);
    return { ok: res.ok, durable: res.durable ?? collections.durable() };
  }

  async function stateHistory(owner, { limit = 20 } = {}) {
    const { ok, rows, code } = await collections.read('financial_state', owner);
    if (!ok) return { ok: false, code, rows: [] };
    return { ok: true, rows: rows.slice(0, Math.max(1, limit)), durable: collections.durable() };
  }

  /**
   * The bounded prompt digest. It carries the resolved values WITH their
   * provenance class, so a model can say "you told me" versus "your history
   * suggests" — and it never carries raw transcripts.
   */
  async function digest(owner, { keys = null, at = now() } = {}) {
    const { ok, rows } = await recall(owner, { at });
    if (!ok) return { available: false, reason: rows ? 'MEMORY_UNAVAILABLE' : 'MEMORY_UNAVAILABLE', facts: [] };
    const wanted = keys && Array.isArray(keys) ? keys : null;
    const facts = [];
    for (const store of ['explicit_user', 'preference', 'behavior']) {
      for (const [key, rec] of Object.entries(rows[store] || {})) {
        if (wanted && !wanted.includes(key)) continue;
        facts.push({ key, value: rec.value, provenance: rec.provenance, at: rec.at, note: rec.note || null });
      }
    }
    facts.sort((a, b) => (RANK[b.provenance] || 0) - (RANK[a.provenance] || 0));
    const conversationTurns = conversation && typeof conversation === 'function'
      ? (await Promise.resolve(conversation(owner))).conversationContext?.turnCount ?? null
      : null;
    return {
      available: true,
      facts: facts.slice(0, 40),
      outcomes: (rows.strategy_outcome || []).length,
      conversationTurns,
      note: 'provenance is authoritative: USER_SAID outranks AI_INFERRED and cannot be replaced by it'
    };
  }

  return {
    schema: MEMORY2_SCHEMA,
    stores: MEMORY_STORES,
    provenanceClasses: MEMORY_PROVENANCE,
    remember, forget, resolve, recall, recordOutcome, outcomes,
    pushStateSnapshot, stateHistory, digest,
    /** Test hook. */
    _load: load
  };
}

function pruneBucket(bucket) {
  const keys = Object.keys(bucket);
  if (keys.length <= MAX_ROWS_PER_STORE) return;
  keys
    .map((k) => [k, bucket[k]?.at || 0])
    .sort((a, b) => a[1] - b[1])
    .slice(0, keys.length - MAX_ROWS_PER_STORE)
    .forEach(([k]) => { delete bucket[k]; });
}
