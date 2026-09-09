/**
 * FBT FINANCIAL INTELLIGENCE OS — Evidence Engine (§12).
 * ---------------------------------------------------------------------------
 * Every important decision, strategy, risk verdict and research claim is
 * attached to evidence objects that carry source, value, timestamp, freshness
 * and confidence. A claim with no evidence is not stored as a claim: the
 * decision/strategy layers refuse to rank anything whose `evidence[]` is empty
 * (that rule already lives in `src/lib/central/decision.js#scoreDecision`), and
 * this module is where the evidence those layers check comes from.
 *
 * Relationships are first-class rows, not strings buried in a payload:
 *   decision → evidence, strategy → evidence, risk → evidence, research → evidence
 * so `/api/ai/evidence/:id` can answer "what was this based on?" and
 * `/api/ai/trace/:id` can answer it for a whole operation.
 */
import { randomUUID, createHash } from 'node:crypto';
import { FRESHNESS, confidenceFor, isEnvelope } from './provenance.js';

export const EVIDENCE_SCHEMA = 'fbt.fi.evidence.v1';
export const EVIDENCE_LINK_SCHEMA = 'fbt.fi.evidence-link.v1';

export const EVIDENCE_TYPES = Object.freeze([
  'balance', 'price', 'quote', 'apy', 'tvl', 'funding', 'gas', 'spread',
  'liquidity', 'volatility', 'orderbook', 'news', 'macro', 'security',
  'onchain', 'execution', 'verification', 'simulation', 'risk', 'research',
  'protocol', 'smart_money', 'user_statement', 'behavior', 'goal', 'policy',
  /* Phase 211 — global intelligence evidence types (additive). */
  'whale', 'stock', 'forex', 'commodity', 'rwa'
]);

export const EVIDENCE_TARGETS = Object.freeze(['decision', 'strategy', 'risk', 'research', 'simulation', 'execution', 'goal', 'world_state']);

const idFor = (input) => `ev_${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 20)}`;

/**
 * Build one evidence object. Accepts either a provenance envelope or a plain
 * `{ type, source, value, at }`. An envelope keeps its own freshness and
 * confidence; a plain row gets them derived the same way.
 */
export function createEvidence(input = {}, { now = Date.now() } = {}) {
  const type = String(input.type || '').toLowerCase();
  if (!EVIDENCE_TYPES.includes(type)) return { ok: false, code: 'UNKNOWN_EVIDENCE_TYPE', detail: `type must be one of ${EVIDENCE_TYPES.join(', ')}` };
  const source = String(input.source || '').slice(0, 120);
  if (!source) return { ok: false, code: 'EVIDENCE_SOURCE_REQUIRED' };

  const env = isEnvelope(input.envelope) ? input.envelope : null;
  const value = env ? env.value : (input.value === undefined ? null : input.value);
  if (value === null || value === undefined) return { ok: false, code: 'EVIDENCE_VALUE_REQUIRED', detail: 'evidence without a value is an absence, record it as a gap in `missing[]` instead' };

  const at = Number(env?.at || input.at || now);
  const ttlMs = Number(env?.ttlMs || input.ttlMs || 0);
  const ageMs = Math.max(0, now - at);
  const freshness = env ? env.freshness
    : ttlMs > 0 && ageMs > ttlMs ? FRESHNESS.STALE : FRESHNESS.LIVE;
  const confidence = env ? env.confidence : confidenceFor(freshness, { ageMs, ttlMs });

  const core = {
    type, source, value: clampValue(value), at, ttlMs, freshness, confidence,
    refs: Array.isArray(input.refs) ? input.refs.slice(0, 12).map((r) => String(r).slice(0, 80)) : [],
    note: input.note ? String(input.note).slice(0, 240) : null,
    untrusted: input.untrusted === true
  };
  return {
    ok: true,
    evidence: {
      schema: EVIDENCE_SCHEMA,
      id: idFor(core),
      ...core,
      timestamp: at,
      createdAt: now
    }
  };
}

/** Long strings (news bodies, metadata) are stored as a digest + excerpt:
 *  evidence is for verification, not for shipping 40 KB into a prompt. */
function clampValue(value) {
  if (typeof value !== 'string') return value;
  if (value.length <= 500) return value;
  return { excerpt: value.slice(0, 500), digest: createHash('sha256').update(value).digest('hex').slice(0, 16), chars: value.length };
}

export function createEvidenceStore({ collections, observability = null, log = () => {} } = {}) {
  async function record(owner, inputs = [], { correlationId = null } = {}) {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const stored = [];
    const rejected = [];
    for (const input of list) {
      const out = createEvidence(input);
      if (!out.ok) { rejected.push({ code: out.code, type: input?.type || null }); continue; }
      const res = await collections.put('evidence', owner, out.evidence);
      if (!res.ok) log(`evidence:store-failed:${res.code}`);
      stored.push(out.evidence);
    }
    if (stored.length && observability) {
      observability.emit({ type: 'evidence.recorded', owner, correlationId, payload: { count: stored.length, types: [...new Set(stored.map((e) => e.type))] } });
    }
    return { ok: stored.length > 0 || list.length === 0, evidence: stored, rejected, durable: collections.durable() };
  }

  async function recordFromEnvelope(owner, { type, source, envelope, refs = [], note = null }, opts = {}) {
    return record(owner, [{ type, source, envelope, refs, note }], opts);
  }

  async function get(owner, id) {
    return collections.get('evidence', owner, id);
  }

  async function forIds(owner, ids = []) {
    const { rows } = await collections.read('evidence', owner);
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    return rows.filter((r) => wanted.has(String(r?.id)));
  }

  async function recent(owner, { limit = 40, type = null } = {}) {
    const { rows } = await collections.read('evidence', owner);
    return rows.filter((r) => !type || r.type === type).slice(0, Math.max(1, limit));
  }

  /** Attach evidence to a target. Idempotent per (target, evidenceId). */
  async function link(owner, { targetType, targetId, evidenceIds = [], correlationId = null } = {}) {
    if (!EVIDENCE_TARGETS.includes(String(targetType))) return { ok: false, code: 'UNKNOWN_EVIDENCE_TARGET' };
    if (!targetId) return { ok: false, code: 'TARGET_ID_REQUIRED' };
    const ids = [...new Set((Array.isArray(evidenceIds) ? evidenceIds : []).map(String))];
    if (!ids.length) return { ok: false, code: 'NO_EVIDENCE_TO_LINK' };
    const existing = await forIds(owner, ids);
    if (existing.length !== ids.length) {
      const missing = ids.filter((id) => !existing.some((e) => e.id === id));
      return { ok: false, code: 'EVIDENCE_NOT_FOUND', missing };
    }
    const row = {
      schema: EVIDENCE_LINK_SCHEMA,
      id: `lnk_${String(targetType)}_${String(targetId)}`,
      targetType: String(targetType),
      targetId: String(targetId).slice(0, 80),
      evidenceIds: ids.slice(0, 40),
      correlationId,
      at: Date.now()
    };
    const res = await collections.put('evidence', owner, row);
    return { ok: res.ok, link: row, durable: res.durable };
  }

  async function linksFor(owner, targetType, targetId) {
    const { rows } = await collections.read('evidence', owner);
    const row = rows.find((r) => r?.schema === EVIDENCE_LINK_SCHEMA && r.targetType === String(targetType) && r.targetId === String(targetId));
    if (!row) return { ok: false, code: 'NO_LINKS', evidence: [] };
    return { ok: true, link: row, evidence: await forIds(owner, row.evidenceIds) };
  }

  /** Evidence bundle for a target: rows + aggregate quality. */
  async function bundle(owner, targetType, targetId) {
    const out = await linksFor(owner, targetType, targetId);
    if (!out.ok) return { ok: false, code: out.code, targetType, targetId, evidence: [], quality: { count: 0, meanConfidence: 0, stale: 0, untrusted: 0 } };
    const ev = out.evidence;
    return {
      ok: true, targetType, targetId, evidence: ev,
      quality: {
        count: ev.length,
        meanConfidence: ev.length ? Number((ev.reduce((a, e) => a + (e.confidence || 0), 0) / ev.length).toFixed(3)) : 0,
        stale: ev.filter((e) => e.freshness === FRESHNESS.STALE).length,
        untrusted: ev.filter((e) => e.untrusted === true).length,
        types: [...new Set(ev.map((e) => e.type))]
      }
    };
  }

  return { schema: EVIDENCE_SCHEMA, record, recordFromEnvelope, get, forIds, recent, link, linksFor, bundle, EVIDENCE_TYPES, EVIDENCE_TARGETS };
}

/** Evidence quality → a confidence number, so "how sure are we" is always
 *  a function of what we actually read. */
export function confidenceFromEvidence(evidence = []) {
  const rows = (Array.isArray(evidence) ? evidence : []).filter(Boolean);
  if (!rows.length) return 0;
  const base = rows.reduce((a, e) => a + (Number(e.confidence) || 0), 0) / rows.length;
  const stalePenalty = rows.filter((e) => e.freshness === FRESHNESS.STALE).length * 0.05;
  const untrustedPenalty = rows.filter((e) => e.untrusted === true).length * 0.12;
  return Number(Math.max(0, Math.min(0.95, base - stalePenalty - untrustedPenalty)).toFixed(3));
}

export const evidenceId = idFor;
export const newEvidenceId = () => `ev_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
