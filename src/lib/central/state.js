/**
 * FBT CENTRAL INTELLIGENCE OS — Unified System State (spec §4, §16, §17).
 * ---------------------------------------------------------------------------
 * The single object the whole app agrees on. Three properties make it a
 * "source of truth" rather than a cache with a nicer name:
 *
 * 1. EVERY VALUE CARRIES ITS PROVENANCE. A section is `{ data, source, status,
 *    updatedAt, revision }`. A number without a `source` cannot be written, so
 *    "the model thought the balance was about 4 ETH" is not expressible here.
 *
 * 2. FRESHNESS IS PART OF THE VALUE, NOT A SEPARATE METRIC. `freshness()`
 *    answers LIVE / STALE / UNAVAILABLE / MISSING against the section's own
 *    budget in schema.js. Policy refuses to execute on STALE, which is why the
 *    "AI quoted a balance from before the swap" class of bug cannot come back.
 *
 * 3. STATE CHANGES ARE DERIVED, NOT DECLARED. `diffSections()` compares two
 *    snapshots and emits the events (BALANCE_CHANGED, PRICE_CHANGED,
 *    POSITION_CHANGED…) for the cascade to consume. A module cannot forget to
 *    announce its own update, because it is not the one announcing it.
 *
 * Pure and functional: every writer returns a NEW state. The server holds one
 * per owner; the browser holds a projection. No mutation means an in-flight
 * refresh can never half-write the object a reply is being composed from.
 */
import {
  CI_SCHEMA,
  STATE_SECTIONS,
  STATE_SECTION_IDS,
  REFRESH_CASCADE,
  hashString,
  round,
  usableNumber
} from './schema.js';

export const STATE_SCHEMA = 'fbt.central-state.v1';

/* -------------------------------------------------------------------------- */
/* creation                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An empty section is `MISSING`, not `{}`. The difference is the whole point:
 * `{}` is the shape of "we looked and found nothing", MISSING is "we have not
 * looked", and the brain plans differently for each (refresh vs. read).
 */
function emptySection(key) {
  const meta = STATE_SECTIONS[key] || { ttlMs: 0, authoritative: false };
  return {
    key,
    data: null,
    source: null,
    status: 'MISSING',
    reason: null,
    updatedAt: 0,
    revision: 0,
    ttlMs: meta.ttlMs ?? 0,
    authoritative: meta.authoritative !== false,
    dirty: false
  };
}

export function createSystemState(seed = {}) {
  const sections = {};
  for (const key of STATE_SECTION_IDS) sections[key] = emptySection(key);
  const now = Number(seed.now) || 0;
  const state = {
    schema: STATE_SCHEMA,
    brain: CI_SCHEMA,
    owner: typeof seed.owner === 'string' ? seed.owner.slice(0, 80) : null,
    sessionId: typeof seed.sessionId === 'string' ? seed.sessionId.slice(0, 80) : null,
    sections,
    revision: 0,
    createdAt: now,
    lastUpdated: now,
    /** Sections invalidated by an event and not yet re-read (§16). */
    dirty: [],
    /** Consecutive refresh failures — the trip that marks a module DEGRADED. */
    failures: {}
  };
  return state;
}

/* -------------------------------------------------------------------------- */
/* writing                                                                     */
/* -------------------------------------------------------------------------- */

const UNAVAILABLE_STATUSES = new Set(['UNAVAILABLE', 'ERROR', 'FAILED']);
const PARTIAL_STATUSES = new Set(['PARTIAL']);

/**
 * Write one section. Returns `{ state, changed, previous }`.
 *
 * `changed` is computed by value comparison, not by "a writer called us", so a
 * refresh that re-reads the same numbers marks nothing dirty and produces no
 * event — that is what keeps the event bus a signal rather than a heartbeat.
 */
export function writeSection(state, key, patch = {}) {
  if (!STATE_SECTIONS[key]) return { state, changed: false, error: 'UNKNOWN_SECTION' };
  const prev = state.sections[key];
  const now = Number(patch.now) || prev.updatedAt || 0;
  const status = UNAVAILABLE_STATUSES.has(String(patch.status || '').toUpperCase())
    ? 'UNAVAILABLE'
    : PARTIAL_STATUSES.has(String(patch.status || '').toUpperCase())
      ? 'PARTIAL'
      : patch.data === null || patch.data === undefined ? 'UNAVAILABLE' : 'OK';
  const next = {
    ...prev,
    data: status === 'UNAVAILABLE' ? prev.data : patch.data,
    source: status === 'UNAVAILABLE' ? prev.source : (patch.source || prev.source || null),
    status,
    reason: status === 'UNAVAILABLE' ? String(patch.reason || 'SOURCE_UNAVAILABLE').slice(0, 160) : null,
    updatedAt: status === 'UNAVAILABLE' && patch.preserveTimestamp !== true ? prev.updatedAt : now,
    revision: status === 'UNAVAILABLE' ? prev.revision : prev.revision + 1,
    ttlMs: STATE_SECTIONS[key].ttlMs,
    authoritative: STATE_SECTIONS[key].authoritative !== false,
    dirty: false
  };
  const changed = status !== 'UNAVAILABLE' && !sameValue(prev.data, next.data);
  const dirty = changed
    ? Array.from(new Set([...(state.dirty || []), key]))
    : (state.dirty || []);
  return {
    state: {
      ...state,
      sections: { ...state.sections, [key]: next },
      revision: state.revision + 1,
      lastUpdated: now || state.lastUpdated,
      dirty
    },
    changed,
    previous: prev
  };
}

/**
 * Record a read failure WITHOUT discarding what we knew.
 *
 * Serving an old number while clearly labelling it stale beats erasing the
 * user's portfolio because one RPC hiccuped — but only if the label survives.
 * That is why the failure path keeps `data` and moves `status` to UNAVAILABLE
 * only when nothing was ever read; otherwise the section keeps its data and
 * the freshness gate in policy decides whether it may still be quoted.
 */
export function markSectionFailure(state, key, reason, now = Date.now()) {
  const prev = state.sections[key] || emptySection(key);
  const failures = { ...(state.failures || {}) };
  failures[key] = (failures[key] || 0) + 1;
  const next = {
    ...prev,
    status: prev.data == null ? 'UNAVAILABLE' : 'STALE',
    reason: String(reason || 'SOURCE_UNAVAILABLE').slice(0, 160),
    failures: failures[key]
  };
  return { ...state, sections: { ...state.sections, [key]: next }, failures, lastUpdated: now };
}

/* -------------------------------------------------------------------------- */
/* reading                                                                      */
/* -------------------------------------------------------------------------- */

export function getSection(state, key) {
  return state?.sections?.[key] || emptySection(key);
}

/**
 * The freshness verdict for one section.
 *
 * `MISSING`  — never read; the planner must schedule a read.
 * `UNAVAILABLE` — read attempted, source refused; the answer must say so.
 * `STALE`    — usable for orientation, NOT for execution or quoting a number
 *              as current (policy enforces this).
 * `LIVE`     — inside the section's own budget.
 */
export function freshness(state, key, now = Date.now()) {
  const section = getSection(state, key);
  if (section.status === 'UNAVAILABLE') {
    return { status: 'UNAVAILABLE', ageMs: 0, withinBudget: false, reason: section.reason, hasData: false };
  }
  if (!section.data) {
    return { status: 'MISSING', ageMs: 0, withinBudget: false, reason: 'NEVER_READ', hasData: false };
  }
  const ageMs = Math.max(0, now - (section.updatedAt || 0));
  const budget = section.ttlMs || 0;
  if (section.status === 'STALE') {
    return { status: 'STALE', ageMs, withinBudget: false, reason: section.reason || 'SOURCE_FAILED', hasData: true };
  }
  if (budget > 0 && ageMs > budget) {
    return { status: 'STALE', ageMs, withinBudget: false, reason: 'AGE_OVER_BUDGET', hasData: true };
  }
  return {
    status: section.status === 'PARTIAL' ? 'PARTIAL' : 'LIVE',
    ageMs,
    withinBudget: true,
    reason: null,
    hasData: true,
    partial: section.status === 'PARTIAL'
  };
}

/** Which of `keys` are not currently LIVE — the refresh set for a turn (§16). */
export function neededReads(state, keys = [], now = Date.now()) {
  return keys.filter((key) => {
    const f = freshness(state, key, now);
    return f.status === 'MISSING' || f.status === 'STALE' || f.status === 'UNAVAILABLE';
  });
}

/** Sections marked dirty by an event, i.e. the post-transaction cascade list. */
export function pendingRefreshes(state) {
  return (state.dirty || []).slice();
}

export function clearRefresh(state, keys, now = Date.now()) {
  const set = new Set(keys || []);
  return {
    ...state,
    dirty: (state.dirty || []).filter((k) => !set.has(k)),
    lastUpdated: now
  };
}

/* -------------------------------------------------------------------------- */
/* events → state invalidation (§15/§16)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Apply an event's invalidation to the state, returning the sections to re-read.
 *
 * Unknown event types invalidate nothing. That is deliberate: silently
 * refreshing everything on every event is how a "real-time" layer turns into a
 * rate-limit magnet, and the cascade map is a reviewable list, not a guess.
 */
export function applyEventToState(state, event, now = Date.now()) {
  const rule = REFRESH_CASCADE[event?.type];
  if (!rule) return { state, invalidate: [], cascade: false };
  const sections = { ...state.sections };
  const invalidate = [];
  for (const key of rule.invalidate) {
    if (!sections[key]) continue;
    sections[key] = { ...sections[key], dirty: true };
    invalidate.push(key);
  }
  const merged = Array.from(new Set([...(state.dirty || []), ...invalidate]));
  return {
    state: { ...state, sections, dirty: merged, lastUpdated: now, eventSeq: (state.eventSeq || 0) + 1 },
    invalidate,
    cascade: rule.cascade === true
  };
}

/* -------------------------------------------------------------------------- */
/* diffing → events                                                            */
/* -------------------------------------------------------------------------- */

const pct = (a, b) => {
  const x = usableNumber(a);
  const y = usableNumber(b);
  if (x === null || y === null) return null;
  if (x === 0) return y === 0 ? 0 : Infinity;
  return Math.abs(y - x) / Math.abs(x);
};

/**
 * Compare two snapshots and derive the events reality just produced.
 *
 * Thresholds exist because price feeds move constantly; an event per tick
 * would make the bus noise and every dependent module refresh on a timer.
 * 0.25% of portfolio value and 2% on a single asset are the points where a
 * number on the user's screen actually changes.
 */
export function diffSections(before, after, { priceMovePct = 0.02, valueMovePct = 0.0025, now = Date.now() } = {}) {
  const events = [];
  const read = (state, key) => getSection(state, key).data;

  const bw = read(before, 'wallet');
  const aw = read(after, 'wallet');
  if (Boolean(aw?.connected) !== Boolean(bw?.connected)) {
    events.push({ type: aw?.connected ? 'WALLET_CONNECTED' : 'WALLET_DISCONNECTED', at: now });
  }
  const bTotals = walletTotals(bw);
  const aTotals = walletTotals(aw);
  const dWallet = pct(bTotals.usd, aTotals.usd);
  if (dWallet !== null && (dWallet > valueMovePct || bTotals.count !== aTotals.count)) {
    events.push({
      type: 'BALANCE_CHANGED',
      at: now,
      payload: { usdBefore: round(bTotals.usd, 2), usdAfter: round(aTotals.usd, 2), deltaPct: round(dWallet * 100, 3) }
    });
  }

  const bp = read(before, 'portfolio');
  const ap = read(after, 'portfolio');
  const dPortfolio = pct(bp?.totalValueUsd, ap?.totalValueUsd);
  if (dPortfolio !== null && dPortfolio > valueMovePct) {
    events.push({ type: 'POSITION_CHANGED', at: now, payload: { totalValueUsd: usableNumber(ap?.totalValueUsd), deltaPct: round(dPortfolio * 100, 3) } });
  }

  const bRisk = read(before, 'risk');
  const aRisk = read(after, 'risk');
  if (bRisk?.level && aRisk?.level && bRisk.level !== aRisk.level) {
    events.push({ type: 'RISK_CHANGED', at: now, payload: { from: bRisk.level, to: aRisk.level } });
  }

  const bMark = read(before, 'markets');
  const aMark = read(after, 'markets');
  for (const symbol of Object.keys(aMark?.prices || {})) {
    const d = pct(bMark?.prices?.[symbol], aMark?.prices?.[symbol]);
    if (d !== null && d > priceMovePct) {
      events.push({ type: 'PRICE_CHANGED', at: now, payload: { symbol, from: bMark?.prices?.[symbol], to: aMark.prices[symbol], deltaPct: round(d * 100, 3) } });
    }
  }
  return events;
}

function walletTotals(wallet) {
  const balances = Array.isArray(wallet?.balances) ? wallet.balances : [];
  const usd = balances.reduce((sum, b) => sum + (usableNumber(b?.valueUsd) ?? 0), 0);
  return { usd, count: balances.length };
}

/* -------------------------------------------------------------------------- */
/* projections                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The compact projection handed to the model (and to the UI). Numbers only from
 * sections with a real source, and every unavailable section listed by name so
 * the reply can say what it could NOT see instead of quietly omitting it.
 */
export function stateSnapshot(state, now = Date.now()) {
  const sections = {};
  const unavailable = [];
  const stale = [];
  for (const key of STATE_SECTION_IDS) {
    const s = getSection(state, key);
    const f = freshness(state, key, now);
    if (s.data != null) {
      sections[key] = {
        data: s.data,
        source: s.source,
        updatedAt: s.updatedAt,
        ageMs: f.ageMs,
        freshness: f.status,
        revision: s.revision
      };
    }
    if (f.status === 'UNAVAILABLE' || f.status === 'MISSING') unavailable.push({ key, status: f.status, reason: s.reason || f.reason });
    if (f.status === 'STALE' || f.status === 'PARTIAL') stale.push({ key, ageMs: f.ageMs, reason: s.reason || f.reason });
  }
  return {
    schema: STATE_SCHEMA,
    owner: state.owner || null,
    revision: state.revision,
    lastUpdated: state.lastUpdated || null,
    pendingRefreshes: (state.dirty || []).slice(),
    sections,
    stale,
    unavailable
  };
}

/** A stable digest of the sections a reply is built from (anti-duplicate, §34). */
export function stateDigest(state, keys = STATE_SECTION_IDS, now = Date.now()) {
  const parts = [];
  for (const key of keys.sort()) {
    const s = getSection(state, key);
    parts.push(`${key}:${s.revision}:${fingerprint(s.data)}`);
  }
  return hashString(parts.join('|'));
}

/**
 * Deep value equality for the change detector in `writeSection`.
 *
 * This has to be exact, not approximate: `changed` is what decides whether an
 * event is published and whether a section is queued for the refresh cascade.
 * A comparison that only looks at the first few array items (as `fingerprint`
 * does, which is fine for a digest) would let the eighth balance change with no
 * event at all, and "the UI did not update" is the precise bug §16 exists to
 * kill. So: primitives by identity, objects by recursively sorted keys, with a
 * depth floor that falls back to the digest for pathological nesting.
 */
const VOLATILE_KEYS = new Set(['at', 'updatedAt', 'checkedAt', 'fetchedAt', 'observedAt', 'latencyMs', 'attempts', 'tookMs']);

export function sameValue(a, b, depth = 0) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (ta === 'number') return Number.isNaN(a) && Number.isNaN(b) ? true : a === b;
  if (ta !== 'object') return false;
  if (depth > 8) return fingerprint(a) === fingerprint(b);
  const aa = Array.isArray(a);
  const ab = Array.isArray(b);
  if (aa !== ab) return false;
  if (aa) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameValue(a[i], b[i], depth + 1)) return false;
    return true;
  }
  /* Fetch bookkeeping is not data. Every source stamps its reply with `at`, so
     comparing it would report "the portfolio changed" on every poll and publish
     an event for a number that is identical — exactly the noise this check
     exists to suppress. */
  const volatile = VOLATILE_KEYS;
  const ka = Object.keys(a).filter((k) => !volatile.has(k));
  const kb = Object.keys(b).filter((k) => !volatile.has(k));
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameValue(a[k], b[k], depth + 1)) return false;
  }
  return true;
}

function fingerprint(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 1e6)) : 'nan';
  if (typeof value === 'string') return value.length > 24 ? hashString(value) : value;
  if (Array.isArray(value)) return `[${value.length}:${value.slice(0, 6).map(fingerprint).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort().slice(0, 24);
    return `{${keys.map((k) => `${k}=${fingerprint(value[k])}`).join(',')}}`;
  }
  return String(value);
}

/* `hashString` is imported from schema.js: the browser recomputes the same
   digest for anti-duplicate replies, so a second copy could only drift. */
export { hashString };
