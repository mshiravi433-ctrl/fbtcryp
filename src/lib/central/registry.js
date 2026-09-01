/**
 * FBT CENTRAL INTELLIGENCE OS — Module Registry + Definition of Done (§10, §11, §40).
 * ---------------------------------------------------------------------------
 * §11 says the Central AI knows exactly one interface. §40 says a feature that
 * does not declare the full contract is INCOMPLETE — and that is the clause this
 * file exists to make enforceable rather than aspirational.
 *
 * THE TRICK THAT MAKES §40 WORK
 * A module may declare `execute: null` — but it must DECLARE it. Declaring
 * "read-only, no execute, and here is why" is complete; silently omitting the
 * field is not. That distinction is the whole design: it is impossible to force a
 * stocks page to implement a trade route, but it is possible to make omitting one
 * a visible, test failure rather than a runtime surprise.
 *
 * `auditRegistry()` runs at server boot (loudly, in the log) and in CI (hard, via
 * the probe), so a new page added without brain integration fails a test rather
 * than shipping and re-creating the "modules don't talk to each other" report.
 */
import { classifyError } from './errors.js';
import {
  CAPABILITY, CI_SCHEMA, MODULE_IDS, MODULE_OPERATIONS,
  PERMISSION, RISK_CONTEXT, EVENT_TYPES, STATE_SECTION_IDS, round
} from './schema.js';

export const REGISTRY_SCHEMA = 'fbt.module-registry.v1';

/** §40, verbatim in field order, so a reviewer can diff it against the spec. */
export const DEFINITION_OF_DONE = Object.freeze([
  { field: 'capability', kind: 'string', note: 'one of CAPABILITY.* — what the brain may assume right now' },
  { field: 'tools', kind: 'array', note: 'tool ids this module exposes to the router' },
  { field: 'state', kind: 'array', note: 'state sections it owns or fills' },
  { field: 'health', kind: 'function', note: 'healthCheck() → status + providers' },
  { field: 'read', kind: 'function', note: 'read() → real data, never cached-as-current' },
  { field: 'quote', kind: 'value', note: 'function | NOT_APPLICABLE (with a reason)' },
  { field: 'prepare', kind: 'value', note: 'function | NOT_APPLICABLE' },
  { field: 'simulate', kind: 'value', note: 'function | NOT_APPLICABLE' },
  { field: 'execute', kind: 'value', note: 'function | NOT_APPLICABLE — read-only modules MUST say why' },
  { field: 'verify', kind: 'value', note: 'function | NOT_APPLICABLE; anything that mutates must verify' },
  { field: 'errors', kind: 'array', note: 'error codes this module can produce' },
  { field: 'recovery', kind: 'value', note: 'function | NONE (with a reason)' },
  { field: 'fallback', kind: 'value', note: 'alternate route | NONE; security codes never have one (§23)' },
  { field: 'events', kind: 'array', note: 'event types it may cause (validated against EVENT_TYPES)' },
  { field: 'permissions', kind: 'object', note: 'highest tier it accepts: READ | PREPARE | EXECUTE' },
  { field: 'riskContext', kind: 'value', note: 'RISK_CONTEXT key | NONE — an action module without it cannot execute (§24)' }
]);

const NOT_APPLICABLE = 'NOT_APPLICABLE';
const NONE = 'NONE';

export function isNotApplicable(value) {
  return value === NOT_APPLICABLE || value === null || value === undefined || value === false;
}

/** A declared-NOT_APPLICABLE must carry a reason; a bare null is an omission. */
function declaresNA(value) {
  if (value === NOT_APPLICABLE || value === NONE) return { ok: true, reason: null };
  if (value && typeof value === 'object' && value.na === true) {
    return value.reason ? { ok: true, reason: String(value.reason).slice(0, 200) } : { ok: false, reason: 'NA_WITHOUT_REASON' };
  }
  return { ok: false, reason: 'UNDECLARED' };
}

/**
 * Audit ONE module against the DoD. Returns the missing list rather than
 * throwing, so `/api/system/capabilities` can show an operator exactly what a
 * feature owner has to add — the point of §40 is a checklist, not a punishment.
 */
export function auditModule(definition = {}) {
  const missing = [];
  const warnings = [];
  const notes = [];
  const id = String(definition.id || '').trim();
  if (!id) missing.push({ field: 'id', reason: 'MODULE_ID_REQUIRED' });
  if (!MODULE_IDS.includes(id)) warnings.push({ code: 'NOT_IN_SPEC_MODULE_LIST', id });
  if (!definition.name) missing.push({ field: 'name', reason: 'DISPLAY_NAME_REQUIRED' });

  const cap = definition.capability;
  if (!Object.values(CAPABILITY).includes(cap)) missing.push({ field: 'capability', reason: `STATUS_NOT_IN_${'CAPABILITY'}` });

  const requiresFn = (field) => {
    if (typeof definition[field] !== 'function') {
      const na = declaresNA(definition[field]);
      if (!na.ok) missing.push({ field, reason: na.reason });
      else if (na.reason) notes.push({ field, note: na.reason });
      return false;
    }
    return true;
  };

  const hasRead = requiresFn('read');
  if (!hasRead) missing.push({ field: 'read', reason: 'READ_IS_MANDATORY' });
  requiresFn('healthCheck');
  requiresFn('capabilities');
  requiresFn('getState');
  ['quote', 'prepare', 'simulate', 'execute', 'verify', 'recover'].forEach(requiresFn);

  if (!Array.isArray(definition.tools) || !definition.tools.length) missing.push({ field: 'tools', reason: 'NO_TOOLS_PUBLISHED' });
  if (!Array.isArray(definition.state) || !definition.state.length) missing.push({ field: 'state', reason: 'NO_STATE_SECTION' });
  else {
    for (const key of definition.state) {
      if (!STATE_SECTION_IDS.includes(key)) missing.push({ field: 'state', reason: `UNKNOWN_SECTION:${key}` });
    }
  }
  if (!Array.isArray(definition.errors) || !definition.errors.length) missing.push({ field: 'errors', reason: 'ERROR_TAXONOMY_UNDECLARED' });
  if (!Array.isArray(definition.fallback)) missing.push({ field: 'fallback', reason: 'FALLBACK_UNDECLARED (use [] to say none)' });
  if (!Array.isArray(definition.events)) missing.push({ field: 'events', reason: 'EVENTS_UNDECLARED' });
  else {
    for (const e of definition.events) if (!EVENT_TYPES.includes(e)) missing.push({ field: 'events', reason: `UNKNOWN_EVENT:${e}` });
  }
  const perms = definition.permissions?.max || definition.permissions;
  if (![PERMISSION.READ, PERMISSION.PREPARE, PERMISSION.EXECUTE].includes(perms)) missing.push({ field: 'permissions', reason: 'MAX_TIER_REQUIRED' });

  /* An execute-capable module must verify and must be in the risk map (§24). */
  if (perms === PERMISSION.EXECUTE) {
    if (typeof definition.execute !== 'function') missing.push({ field: 'execute', reason: 'EXECUTE_TIER_WITHOUT_EXECUTE' });
    if (typeof definition.verify !== 'function') missing.push({ field: 'verify', reason: 'MUTATING_MODULE_MUST_VERIFY' });
    if (!definition.riskContext || !RISK_CONTEXT[definition.riskContext]) missing.push({ field: 'riskContext', reason: 'EXECUTE_TIER_NEEDS_SHARED_RISK_CONTEXT' });
  }
  /* Quote-capable modules must expire their quotes or say how (§39 QUOTE_EXPIRED). */
  if (typeof definition.quote === 'function' && !definition.quoteTtlMs && !definition.errors?.includes('QUOTE_EXPIRED')) {
    warnings.push({ code: 'QUOTE_WITHOUT_TTL', id, note: 'a quote that never expires is how a stale price gets executed' });
  }
  if (!definition.fallback?.length && definition.errors?.some((c) => ['RPC_TIMEOUT', 'PROVIDER_DOWN', 'RATE_LIMITED'].includes(c))) {
    warnings.push({ code: 'TRANSIENT_ERRORS_WITHOUT_FALLBACK', id, note: 'declare an alternate route or mark the module DEGRADED on failure' });
  }
  return {
    id,
    complete: missing.length === 0,
    missing,
    warnings,
    notes,
    capability: cap || CAPABILITY.INCOMPLETE,
    score: round(Math.max(0, 1 - missing.length / DEFINITION_OF_DONE.length), 3)
  };
}

/**
 * Register a module, producing the object the brain calls. `defineModule` does
 * NOT reject an incomplete module — it marks it `INCOMPLETE`, which the router
 * then refuses for anything above READ. A half-built feature stays visible (so it
 * can be finished) but unusable (so it cannot mislead). That asymmetry is the
 * design answer to "features keep getting added without the brain knowing".
 */
export function defineModule(definition = {}) {
  const audit = auditModule(definition);
  const capability = audit.complete ? (definition.capability || CAPABILITY.AVAILABLE) : CAPABILITY.INCOMPLETE;
  const bound = {};
  for (const op of MODULE_OPERATIONS) {
    const impl = definition[op];
    bound[op] = typeof impl === 'function'
      ? async (input = {}, ctx = {}) => {
        try {
          const out = await impl(input, ctx);
          return normalizeOperationResult(op, out);
        } catch (error) {
          /* A thrown provider error becomes the SAME shape as a refused read: an
             error object that only some callers understand is how one module's
             exception becomes another module's confident answer. The classification
             also decides `safeStop`, which is the difference between a retry and a
             stop that must not be retried (§23). */
          const classified = classifyError(error, { module: definition.id, operation: op });
          return {
            status: 'UNAVAILABLE', operation: op, module: definition.id,
            /* `code` and `class` are repeated as FIELDS, not only inside the prose
               `reason`: the brain, the ledger and the client all key off them, and a
               consumer that has to re-derive a code from a sentence gets a different
               answer than the one that decided the recovery path. */
            code: classified.code, reason: classified.code, class: classified.class,
            detail: classified.technical.slice(0, 200),
            safeStop: classified.safeStop === true, recovery: { actions: classified.ladder },
            at: Date.now(), data: null
          };
        }
      }
      : async () => ({ status: 'NOT_APPLICABLE', operation: op, module: definition.id, reason: typeof impl === 'object' && impl?.reason ? String(impl.reason).slice(0, 160) : 'not declared by this module' });
  }
  return {
    ...bound,
    id: definition.id,
    name: definition.name || definition.id,
    capability,
    audit,
    tools: definition.tools || [],
    state: definition.state || [],
    events: definition.events || [],
    errors: definition.errors || [],
    fallback: definition.fallback || [],
    permissions: { max: definition.permissions?.max || PERMISSION.READ },
    riskContext: definition.riskContext || null,
    quoteTtlMs: definition.quoteTtlMs || null,
    meta: definition.meta || {},
    definition
  };
}

/**
 * Every operation returns the same envelope so the router, the policy engine and
 * the reply composer never have to special-case a module. A module that returns
 * a bare array is still usable — it gets wrapped and flagged `loose`, so the
 * looseness is visible instead of silently tolerated.
 */
export function normalizeOperationResult(operation, out) {
  if (out && typeof out === 'object' && out.status) {
    return {
      ...out,
      operation,
      status: String(out.status).toUpperCase(),
      source: out.source || out.data?.source || null,
      at: Number(out.at) || Number(out.dataAt) || Date.now(),
      data: out.data ?? (out.value !== undefined ? { value: out.value } : out)
    };
  }
  if (out === null || out === undefined) {
    return { status: 'UNAVAILABLE', operation, reason: 'EMPTY_RESULT', at: Date.now(), data: null };
  }
  return { status: 'OK', operation, source: null, at: Date.now(), loose: true, data: Array.isArray(out) ? { items: out } : out };
}

/** Aggregate view: the capability matrix (§8) the whole system reads from. */
export function buildCapabilityMatrix(modules = [], health = {}) {
  const capabilities = {};
  const detail = {};
  for (const m of modules) {
    const h = health?.[m.id];
    let cap = m.capability;
    /* Health overrides intent: a module that declared AVAILABLE but whose probe
       just failed is DEGRADED whether it likes it or not. */
    /* 'UNKNOWN' means "we have not probed this yet", which is not evidence of a
       problem — downgrading on it would make a cold server look broken and would
       block plans for modules that are fine. Only a real failed probe demotes. */
    if (cap === CAPABILITY.AVAILABLE && h && ['DEGRADED', 'DOWN'].includes(String(h.status).toUpperCase())) {
      cap = h.status === 'DOWN' ? CAPABILITY.UNAVAILABLE : CAPABILITY.DEGRADED;
    }
    if (cap === CAPABILITY.INCOMPLETE && !m.audit?.complete) cap = CAPABILITY.INCOMPLETE;
    capabilities[m.id] = cap;
    detail[m.id] = {
      capability: cap,
      complete: m.audit?.complete === true,
      score: m.audit?.score ?? 0,
      missing: (m.audit?.missing || []).map((x) => x.field),
      permissions: m.permissions.max,
      tools: m.tools.length,
      health: h?.status || 'UNKNOWN',
      note: cap === CAPABILITY.INCOMPLETE ? 'this feature is not wired into the brain end to end (§40)' : null
    };
  }
  const counts = Object.values(capabilities).reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  return {
    schema: 'fbt.capability-matrix.v1',
    brain: CI_SCHEMA,
    capabilities,
    detail,
    counts,
    coverage: round(Object.keys(detail).length ? (Object.values(detail).filter((d) => d.complete).length / Object.keys(detail).length) : 0, 3),
    at: Date.now()
  };
}

/** The DoD roll-up for `/api/system/capabilities` and the §41 checklist. */
export function auditRegistry(modules = []) {
  const rows = modules.map((m) => ({ id: m.id, complete: m.audit?.complete === true, missing: m.audit?.missing || [], warnings: m.audit?.warnings || [], score: m.audit?.score ?? 0 }));
  const incomplete = rows.filter((r) => !r.complete);
  return {
    schema: REGISTRY_SCHEMA,
    brain: CI_SCHEMA,
    modules: rows.length,
    specModules: MODULE_IDS.length,
    unregisteredSpecModules: MODULE_IDS.filter((id) => !rows.some((r) => r.id === id)),
    complete: rows.length - incomplete.length,
    incomplete: incomplete.map((r) => r.id),
    rows,
    coveragePct: round(rows.length ? ((rows.length - incomplete.length) / rows.length) * 100 : 0, 1),
    verdict: incomplete.length ? 'FEATURE_INCOMPLETE' : 'COMPLETE'
  };
}

export { NOT_APPLICABLE, NONE, MODULE_OPERATIONS, CAPABILITY };
