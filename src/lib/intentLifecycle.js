/**
 * INTENT LIFECYCLE STATE MACHINE — fbt.intent-lifecycle.v1
 * ---------------------------------------------------------------------------
 * One pure, versioned, fail-closed state machine for the whole execution path:
 *
 *   CREATED → VALIDATING → VALIDATED → QUOTING → OPTIMIZING → SIMULATING
 *           → AWAITING_APPROVAL/AWAITING_SIGNATURE → SUBMITTED → CONFIRMING
 *           → COMPLETED | RECOVERABLE | FAILED | EXPIRED | CANCELLED
 *
 * ─── WHAT THIS MODULE IS ALLOWED TO KNOW ────────────────────────────────────
 * Nothing that can move money and nothing that identifies the user. No signer,
 * no provider, no calldata, no wallet address, no secret ever enters a record.
 * Route/quote/term changes are tracked as FINGERPRINTS, so the machine can
 * prove "this is not what you approved" without storing what was approved.
 *
 * ─── WHY FAIL-CLOSED ────────────────────────────────────────────────────────
 * An unknown or illegal transition is refused, never coerced into the nearest
 * legal one. The dangerous version of this bug is silent: a FAILED intent that
 * quietly becomes COMPLETED, or an expired intent that still reaches a signer.
 * Both are structurally impossible here — terminal states have no outgoing
 * edges, and every transition re-checks the deadline first.
 *
 * React must never be imported here: the UI renders this, it does not own it.
 */

export const INTENT_LIFECYCLE_SCHEMA = 'fbt.intent-lifecycle.v1';
export const LIFECYCLE_POLICY_VERSION = 'fbt.intent-lifecycle-policy.v1';

const STORAGE_KEY = 'fbt-intent-lifecycle-v1';
const MAX_RECORDS = 30;
/** Bounded history: the first event and the most recent ones are kept. */
export const MAX_LIFECYCLE_EVENTS = 40;

export const LIFECYCLE_STATUSES = Object.freeze([
  'CREATED',
  'VALIDATING',
  'VALIDATED',
  'QUOTING',
  'OPTIMIZING',
  'SIMULATING',
  'AWAITING_APPROVAL',
  'AWAITING_SIGNATURE',
  'SUBMITTED',
  'CONFIRMING',
  'COMPLETED',
  'RECOVERABLE',
  'FAILED',
  'EXPIRED',
  'CANCELLED'
]);

export const TERMINAL_STATUSES = Object.freeze(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']);

/** Statuses from which a signature request is legitimate. */
const SIGNABLE_STATUSES = new Set(['AWAITING_SIGNATURE']);

/*
 * Explicit transition table. Every status lists its complete set of legal
 * successors; anything absent is refused. `CANCELLED` is reachable only while
 * the user still controls the outcome — once a transaction is SUBMITTED the
 * user cannot "cancel" it locally, they can only observe or replace it.
 */
export const LIFECYCLE_TRANSITIONS = Object.freeze({
  CREATED: ['VALIDATING', 'CANCELLED', 'EXPIRED', 'FAILED'],
  VALIDATING: ['VALIDATED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  VALIDATED: ['QUOTING', 'CANCELLED', 'EXPIRED', 'FAILED'],
  QUOTING: ['OPTIMIZING', 'RECOVERABLE', 'FAILED', 'CANCELLED', 'EXPIRED'],
  OPTIMIZING: ['SIMULATING', 'QUOTING', 'RECOVERABLE', 'FAILED', 'CANCELLED', 'EXPIRED'],
  SIMULATING: [
    'AWAITING_APPROVAL',
    'AWAITING_SIGNATURE',
    'OPTIMIZING',
    'QUOTING',
    'RECOVERABLE',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
  ],
  AWAITING_APPROVAL: [
    'SIMULATING',
    'QUOTING',
    'OPTIMIZING',
    'RECOVERABLE',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
  ],
  AWAITING_SIGNATURE: [
    'SUBMITTED',
    'SIMULATING',
    'QUOTING',
    'OPTIMIZING',
    'AWAITING_APPROVAL',
    'RECOVERABLE',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
  ],
  SUBMITTED: ['CONFIRMING', 'RECOVERABLE', 'FAILED', 'EXPIRED'],
  CONFIRMING: ['COMPLETED', 'RECOVERABLE', 'FAILED'],
  RECOVERABLE: [
    'QUOTING',
    'OPTIMIZING',
    'SIMULATING',
    'AWAITING_APPROVAL',
    'AWAITING_SIGNATURE',
    'CONFIRMING',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
  ],
  /* Terminal: no outgoing edges at all. This is what makes
     FAILED → COMPLETED and CANCELLED → COMPLETED impossible by construction. */
  COMPLETED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: []
});

/** Material terms whose change invalidates a review the user already gave. */
export const MATERIAL_TERM_FIELDS = Object.freeze([
  'chainId',
  'amountIn',
  'fromSymbol',
  'toSymbol',
  'recipientRef',
  'slippagePct',
  'minOut',
  'routeFingerprint'
]);

export const isTerminalStatus = (status) => TERMINAL_STATUSES.includes(status);

export function canTransition(from, to) {
  if (!LIFECYCLE_STATUSES.includes(from) || !LIFECYCLE_STATUSES.includes(to)) return false;
  return (LIFECYCLE_TRANSITIONS[from] || []).includes(to);
}

/* --------------------------- local fingerprints --------------------------- */

/**
 * Deterministic, NON-reversible 16-hex digest of a small term set.
 *
 * It is deliberately not a wallet-grade hash: it exists to answer "is this the
 * same thing the user approved?" without ever writing an address, an amount
 * owner or a recipient into local storage. Two different terms colliding is a
 * conservative failure — it can only cause an extra review, never skip one,
 * because any real change also changes the route/quote fingerprints checked
 * alongside it.
 */
export function termsFingerprint(terms = {}) {
  const canonical = MATERIAL_TERM_FIELDS
    .map((key) => `${key}=${terms?.[key] == null ? '' : String(terms[key])}`)
    .join('|');
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

const cleanCode = (value, fallback = 'UNSPECIFIED') => {
  const code = String(value ?? fallback).toUpperCase().replace(/[^A-Z0-9_.-]/g, '').slice(0, 48);
  return code || fallback;
};

const cleanId = (value) => String(value ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);

/* `Number(null)` is 0 and 0 is finite — the null test must come FIRST, or a
   record with no deadline silently gains a deadline of 1970 and expires. */
const numberOrNull = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------ construction ------------------------------ */

export function createLifecycle({
  intentId,
  deadlineAt = null,
  origin = 'intent-os',
  now = Date.now()
} = {}) {
  const id = cleanId(intentId) || `lc_${now.toString(36)}`;
  return {
    schema: INTENT_LIFECYCLE_SCHEMA,
    policyVersion: LIFECYCLE_POLICY_VERSION,
    intentId: id,
    origin: cleanCode(origin, 'INTENT-OS').toLowerCase().slice(0, 24),
    status: 'CREATED',
    sequence: 0,
    createdAt: now,
    updatedAt: now,
    deadlineAt: numberOrNull(deadlineAt),
    approvedTermsHash: null,
    approvedAt: null,
    reauthorisationRequired: false,
    changedTerms: [],
    events: [
      {
        schema: INTENT_LIFECYCLE_SCHEMA,
        intentId: id,
        sequence: 0,
        from: null,
        to: 'CREATED',
        timestamp: now,
        reasonCode: 'INTENT_CREATED',
        policyVersion: LIFECYCLE_POLICY_VERSION
      }
    ]
  };
}

function appendEvent(record, event) {
  const events = [...record.events, event];
  if (events.length <= MAX_LIFECYCLE_EVENTS) return events;
  /* Keep the origin event so a record never loses where it came from, then the
     most recent tail. A trimmed middle is explicit, not silent. */
  return [events[0], ...events.slice(events.length - (MAX_LIFECYCLE_EVENTS - 1))];
}

/**
 * Attempt a transition.
 *
 * @returns {{ ok:boolean, code:string, record:object, idempotent?:boolean }}
 *   `record` is ALWAYS a usable record: on refusal it is the unchanged input
 *   (or the expired record, when the deadline forced expiry).
 */
export function transition(record, to, { reasonCode = 'UNSPECIFIED', now = Date.now(), detail = null } = {}) {
  const current = sanitizeLifecycle(record);
  if (!current) return { ok: false, code: 'BAD_RECORD', record: null };
  if (!LIFECYCLE_STATUSES.includes(to)) return { ok: false, code: 'UNKNOWN_STATUS', record: current };

  /* Idempotency: replaying the same transition is a normal consequence of a
     retried effect or a double render, not an error. It must not bump the
     sequence, because a monotonic sequence is what makes the trace auditable. */
  if (current.status === to) {
    return { ok: true, code: 'IDEMPOTENT', idempotent: true, record: current };
  }

  if (isTerminalStatus(current.status)) {
    return { ok: false, code: 'TERMINAL_STATE', record: current };
  }

  /* Deadline first: an expired intent may only be expired, cancelled or
     failed. Nothing else — least of all SUBMITTED. */
  const expired = current.deadlineAt != null && now > current.deadlineAt;
  if (expired && !['EXPIRED', 'CANCELLED', 'FAILED'].includes(to)) {
    const forced = forceExpire(current, now);
    return { ok: false, code: 'DEADLINE_PASSED', record: forced };
  }

  if (!canTransition(current.status, to)) {
    return { ok: false, code: 'INVALID_TRANSITION', record: current };
  }

  const sequence = current.sequence + 1;
  const event = {
    schema: INTENT_LIFECYCLE_SCHEMA,
    intentId: current.intentId,
    sequence,
    from: current.status,
    to,
    timestamp: now,
    reasonCode: cleanCode(reasonCode),
    policyVersion: LIFECYCLE_POLICY_VERSION,
    ...(detail && typeof detail === 'object' ? { detail: boundedDetail(detail) } : {})
  };

  const next = {
    ...current,
    status: to,
    sequence,
    updatedAt: now,
    events: appendEvent(current, event)
  };
  if (to === 'AWAITING_SIGNATURE') next.reauthorisationRequired = false;
  return { ok: true, code: 'OK', record: next };
}

function forceExpire(record, now) {
  const sequence = record.sequence + 1;
  return {
    ...record,
    status: 'EXPIRED',
    sequence,
    updatedAt: now,
    events: appendEvent(record, {
      schema: INTENT_LIFECYCLE_SCHEMA,
      intentId: record.intentId,
      sequence,
      from: record.status,
      to: 'EXPIRED',
      timestamp: now,
      reasonCode: 'DEADLINE_PASSED',
      policyVersion: LIFECYCLE_POLICY_VERSION
    })
  };
}

/** Move a past-deadline record to EXPIRED. Terminal records are untouched. */
export function expireIfDue(record, now = Date.now()) {
  const current = sanitizeLifecycle(record);
  if (!current) return null;
  if (isTerminalStatus(current.status)) return current;
  if (current.deadlineAt == null || now <= current.deadlineAt) return current;
  return forceExpire(current, now);
}

/** Only a bounded, code-shaped detail object is ever attached to an event. */
function boundedDetail(detail) {
  const out = {};
  for (const [key, value] of Object.entries(detail).slice(0, 8)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    if (value == null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 8).map((v) => String(v).slice(0, 40));
    else out[key] = String(value).slice(0, 64);
  }
  return out;
}

/* ------------------------------- review gate ------------------------------ */

/**
 * Bind the record to exactly the terms the user reviewed. The terms themselves
 * are NOT stored — only their fingerprint.
 */
export function recordReview(record, terms, { now = Date.now() } = {}) {
  const current = sanitizeLifecycle(record);
  if (!current) return null;
  return {
    ...current,
    approvedTermsHash: termsFingerprint(terms),
    approvedAt: now,
    reauthorisationRequired: false,
    changedTerms: [],
    updatedAt: now
  };
}

/**
 * Did anything the user consented to change? Returns the changed field names
 * so the UI can say WHAT changed rather than "something changed".
 */
export function reviewDelta(record, terms) {
  const current = sanitizeLifecycle(record);
  if (!current || !current.approvedTermsHash) {
    return { required: true, changed: ['NOT_REVIEWED'] };
  }
  const nextHash = termsFingerprint(terms);
  if (nextHash === current.approvedTermsHash) return { required: false, changed: [] };
  return { required: true, changed: changedFields(current.lastTerms, terms) };
}

/*
 * `lastTerms` is intentionally undefined in a persisted record (nothing
 * money-relevant is stored). Callers that still hold the previous terms in
 * memory can pass them to `diffTerms` directly for a precise field list.
 */
function changedFields(previous, next) {
  if (!previous || !next) return ['TERMS'];
  return diffTerms(previous, next);
}

/** Pure field-by-field diff of two material term sets. */
export function diffTerms(previous = {}, next = {}) {
  return MATERIAL_TERM_FIELDS.filter((key) => {
    const a = previous?.[key];
    const b = next?.[key];
    if (a == null && b == null) return false;
    return String(a ?? '') !== String(b ?? '');
  });
}

/**
 * Apply a material change discovered after review (new route, new amount, new
 * chain, …). The record is pushed back to OPTIMIZING and marked as needing a
 * fresh review + signature. It can never stay AWAITING_SIGNATURE.
 */
export function applyMaterialChange(record, changed, { now = Date.now(), reasonCode = 'TERMS_CHANGED' } = {}) {
  const current = sanitizeLifecycle(record);
  if (!current) return { ok: false, code: 'BAD_RECORD', record: null };
  const fields = (Array.isArray(changed) ? changed : [changed]).filter(Boolean).slice(0, 8).map(String);
  const moved = transition(current, 'OPTIMIZING', { reasonCode, now, detail: { changed: fields } });
  if (!moved.ok) {
    return {
      ...moved,
      record: { ...moved.record, reauthorisationRequired: true, changedTerms: fields, approvedTermsHash: null }
    };
  }
  return {
    ok: true,
    code: 'REAUTHORISATION_REQUIRED',
    record: {
      ...moved.record,
      approvedTermsHash: null,
      approvedAt: null,
      reauthorisationRequired: true,
      changedTerms: fields
    }
  };
}

/**
 * The single gate every submission path must pass. Signing is allowed only
 * when: the record is AWAITING_SIGNATURE, the deadline has not passed, no
 * reauthorisation is pending, and the terms still hash to what was approved.
 */
export function canRequestSignature(record, terms, { now = Date.now() } = {}) {
  const current = sanitizeLifecycle(record);
  if (!current) return { ok: false, code: 'BAD_RECORD' };
  if (current.deadlineAt != null && now > current.deadlineAt) return { ok: false, code: 'EXPIRED' };
  if (!SIGNABLE_STATUSES.has(current.status)) return { ok: false, code: 'NOT_AWAITING_SIGNATURE' };
  if (current.reauthorisationRequired) return { ok: false, code: 'REAUTHORISATION_REQUIRED' };
  if (!current.approvedTermsHash) return { ok: false, code: 'NOT_REVIEWED' };
  if (termsFingerprint(terms) !== current.approvedTermsHash) return { ok: false, code: 'TERMS_CHANGED' };
  return { ok: true, code: 'OK' };
}

/* ------------------------------- persistence ------------------------------ */

/** Keys that must never appear in a persisted lifecycle record. */
const FORBIDDEN_KEYS = new Set([
  'signer',
  'provider',
  'calldata',
  'data',
  'privatekey',
  'private_key',
  'mnemonic',
  'seed',
  'seedphrase',
  'secret',
  'signature',
  'address',
  'account',
  'from',
  'to',
  'recipient',
  'wallet',
  'walletaddress',
  'sessionkey',
  'topic'
]);

const ALLOWED_RECORD_KEYS = new Set([
  'schema',
  'policyVersion',
  'intentId',
  'origin',
  'status',
  'sequence',
  'createdAt',
  'updatedAt',
  'deadlineAt',
  'approvedTermsHash',
  'approvedAt',
  'reauthorisationRequired',
  'changedTerms',
  'events'
]);

const ALLOWED_EVENT_KEYS = new Set([
  'schema',
  'intentId',
  'sequence',
  'from',
  'to',
  'timestamp',
  'reasonCode',
  'policyVersion',
  'detail'
]);

/**
 * Strip a record down to the allowlist. Anything not explicitly permitted is
 * dropped rather than trusted — the storage layer is the last place a signer,
 * a provider handle or a piece of calldata could leak in from a caller that
 * spread an object it should not have.
 */
export function sanitizeLifecycle(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (record.schema !== INTENT_LIFECYCLE_SCHEMA) return null;
  if (!LIFECYCLE_STATUSES.includes(record.status)) return null;

  const out = {};
  for (const key of Object.keys(record)) {
    if (!ALLOWED_RECORD_KEYS.has(key)) continue;
    out[key] = record[key];
  }
  out.intentId = cleanId(out.intentId);
  out.sequence = Number.isFinite(Number(out.sequence)) ? Number(out.sequence) : 0;
  out.createdAt = Number(out.createdAt) || Date.now();
  out.updatedAt = Number(out.updatedAt) || out.createdAt;
  out.deadlineAt = numberOrNull(out.deadlineAt);
  out.approvedTermsHash = typeof out.approvedTermsHash === 'string'
    ? out.approvedTermsHash.replace(/[^0-9a-f]/g, '').slice(0, 32) || null
    : null;
  out.approvedAt = numberOrNull(out.approvedAt);
  out.reauthorisationRequired = Boolean(out.reauthorisationRequired);
  out.changedTerms = Array.isArray(out.changedTerms)
    ? out.changedTerms.slice(0, 8).map((v) => String(v).slice(0, 32))
    : [];
  out.origin = typeof out.origin === 'string' ? out.origin.slice(0, 24) : 'intent-os';
  out.policyVersion = LIFECYCLE_POLICY_VERSION;

  const events = Array.isArray(out.events) ? out.events : [];
  out.events = events
    .filter((event) => event && typeof event === 'object')
    .map((event) => {
      const clean = {};
      for (const key of Object.keys(event)) {
        if (!ALLOWED_EVENT_KEYS.has(key)) continue;
        clean[key] = event[key];
      }
      clean.schema = INTENT_LIFECYCLE_SCHEMA;
      clean.policyVersion = LIFECYCLE_POLICY_VERSION;
      clean.intentId = out.intentId;
      clean.sequence = Number(clean.sequence) || 0;
      clean.timestamp = Number(clean.timestamp) || out.createdAt;
      clean.reasonCode = cleanCode(clean.reasonCode);
      if (clean.detail) clean.detail = boundedDetail(clean.detail);
      return clean;
    })
    .slice(-MAX_LIFECYCLE_EVENTS);

  if (!out.events.length) {
    out.events = [{
      schema: INTENT_LIFECYCLE_SCHEMA,
      intentId: out.intentId,
      sequence: out.sequence,
      from: null,
      to: out.status,
      timestamp: out.updatedAt,
      reasonCode: 'MIGRATED',
      policyVersion: LIFECYCLE_POLICY_VERSION
    }];
  }
  return out;
}

/** True when nothing forbidden is reachable anywhere inside the record. */
export function lifecycleIsClean(record) {
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return true;
    if (seen.has(value)) return true;
    seen.add(value);
    if (Array.isArray(value)) return value.every(walk);
    return Object.entries(value).every(([key, item]) => {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) return false;
      if (typeof item === 'string' && /^0x[0-9a-fA-F]{40}$/.test(item)) return false; // address
      if (typeof item === 'string' && item.length > 128) return false;                // calldata-sized
      return walk(item);
    });
  };
  /* `from`/`to` are status names on an event, never addresses — check them
     explicitly before the generic walk rejects the key name. */
  const events = Array.isArray(record?.events) ? record.events : [];
  const statusesOk = events.every(
    (e) => (e.from == null || LIFECYCLE_STATUSES.includes(e.from)) && LIFECYCLE_STATUSES.includes(e.to)
  );
  const withoutEvents = { ...record };
  delete withoutEvents.events;
  const detailsOk = events.every((e) => walk(e.detail ?? {}));
  return statusesOk && detailsOk && walk(withoutEvents);
}

function safeRead(key, fallback) {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadLifecycles() {
  const rows = safeRead(STORAGE_KEY, []);
  if (!Array.isArray(rows)) return [];
  return rows.map(sanitizeLifecycle).filter(Boolean).slice(0, MAX_RECORDS);
}

export function getLifecycle(intentId) {
  const id = cleanId(intentId);
  return loadLifecycles().find((row) => row.intentId === id) ?? null;
}

export function saveLifecycle(record) {
  const clean = sanitizeLifecycle(record);
  if (!clean) return null;
  const rows = [clean, ...loadLifecycles().filter((row) => row.intentId !== clean.intentId)].slice(0, MAX_RECORDS);
  safeWrite(STORAGE_KEY, rows);
  return clean;
}

export function removeLifecycle(intentId) {
  const id = cleanId(intentId);
  const rows = loadLifecycles().filter((row) => row.intentId !== id);
  safeWrite(STORAGE_KEY, rows);
  return rows;
}

/* -------------------------------- migration ------------------------------- */

const LEGACY_STATUS_MAP = {
  'ready-for-review': 'VALIDATED',
  'ready-for-client-review': 'VALIDATED',
  'draft-only': 'CREATED',
  blocked: 'CREATED'
};

/**
 * Read an intent saved BEFORE lifecycles existed (`fbt.intent.v1` record from
 * intentOS.js) and give it a valid, non-executable starting lifecycle.
 *
 * Migration never invents progress: an old record becomes CREATED or
 * VALIDATED, never AWAITING_SIGNATURE, and an old record whose deadline has
 * passed becomes EXPIRED immediately.
 */
export function migrateLegacyIntent(row, { now = Date.now() } = {}) {
  const intent = row?.intent ?? row;
  if (!intent || typeof intent !== 'object') return null;
  if (intent.schema && intent.schema !== 'fbt.intent.v1') return null;
  const id = cleanId(intent.id);
  if (!id) return null;

  const base = createLifecycle({
    intentId: id,
    deadlineAt: Number(intent.deadlineAt) || null,
    origin: 'migrated',
    now: Number(row?.savedAt) || Number(intent.createdAt) || now
  });
  const target = LEGACY_STATUS_MAP[row?.status] ?? 'CREATED';

  let record = base;
  if (target === 'VALIDATED') {
    const validating = transition(record, 'VALIDATING', { reasonCode: 'MIGRATED', now: base.createdAt });
    if (validating.ok) {
      const validated = transition(validating.record, 'VALIDATED', { reasonCode: 'MIGRATED', now: base.createdAt });
      record = validated.ok ? validated.record : validating.record;
    }
  }
  return expireIfDue(record, now);
}

/** Load a lifecycle, creating or migrating one when the record predates v1. */
export function ensureLifecycle({ intentId, legacyRow = null, deadlineAt = null, origin = 'swap', now = Date.now() }) {
  const existing = getLifecycle(intentId);
  if (existing) return expireIfDue(existing, now);
  const migrated = legacyRow ? migrateLegacyIntent(legacyRow, { now }) : null;
  return migrated ?? createLifecycle({ intentId, deadlineAt, origin, now });
}

/** Compact, translation-friendly view for the UI timeline. */
export function lifecycleTimeline(record) {
  const clean = sanitizeLifecycle(record);
  if (!clean) return [];
  const reached = new Map();
  for (const event of clean.events) {
    if (!reached.has(event.to)) reached.set(event.to, event.timestamp);
  }
  return LIFECYCLE_STATUSES.filter((status) => !['CANCELLED', 'EXPIRED'].includes(status) || reached.has(status))
    .map((status) => ({
      status,
      reached: reached.has(status),
      at: reached.get(status) ?? null,
      current: clean.status === status
    }));
}
