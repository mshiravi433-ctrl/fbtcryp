/**
 * FBT CENTRAL INTELLIGENCE OS — Central Tool Router (§9).
 * ---------------------------------------------------------------------------
 *   Intent → Tool Router → Capability Check → Health Check → Dependency
 *   Check → Policy Check → Execute → Verify
 *
 * The AI NEVER calls provider APIs directly — every tool invocation passes
 * through here, so capability gating, dependency ordering, policy checks,
 * error classification, recovery/fallback and observability are enforced in
 * ONE place.
 */
import { getModule } from './registry.js';
import { capabilityOf, noteModuleError, noteModuleSuccess } from './capabilities.js';
import { classifyError, withRetryFallback, withTimeout } from './errorEngine.js';
import { publish } from './eventBus.js';
import { PERMISSION_LEVELS } from './constants.js';

const OP_TIMEOUT_MS = 12_000;
const OP_ORDER = ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'];

const levelOf = (op) => (op === 'read' ? 'READ' : op === 'execute' ? 'EXECUTE' : 'PREPARE');

/** Dependency check: every dependsOn module must not be UNAVAILABLE. */
export async function checkDependencies(adapter, ctx) {
  const problems = [];
  for (const dep of adapter.dependsOn || []) {
    const depAdapter = getModule(dep);
    if (!depAdapter) { problems.push({ dep, status: 'NOT_REGISTERED' }); continue; }
    const cap = await capabilityOf(dep, ctx);
    if (cap.status === 'UNAVAILABLE') problems.push({ dep, status: 'UNAVAILABLE', reason: cap.reason });
  }
  return problems;
}

/**
 * Run one tool through the full gate chain. Returns a structured
 * ToolResult — the response engine builds user-facing answers ONLY from
 * these (§19), never from LLM guesses.
 */
export async function runTool({ module, operation, input = {}, ctx = null, permissionGranted = 'EXECUTE', trace = null }) {
  const startedAt = Date.now();
  const op = String(operation || '').toLowerCase();
  const gate = { module, operation: op, checks: {} };
  const finish = (result) => {
    const out = { ...result, module, operation: op, durationMs: Date.now() - startedAt };
    publish(result.ok ? 'TOOL_EXECUTED' : 'TOOL_FAILED', { module, operation: op, status: result.status, error: result.error || null }, { source: 'tool-router' });
    if (Array.isArray(trace)) trace.push({ stage: 'TOOL', at: Date.now(), module, operation: op, ok: Boolean(result.ok), status: result.status || null, durationMs: out.durationMs });
    return out;
  };

  /* ── capability check ─────────────────────────────────────────────────── */
  const adapter = getModule(module);
  if (!adapter) return finish({ ok: false, status: 'MODULE_NOT_REGISTERED', error: 'MODULE_NOT_REGISTERED', checks: gate.checks });
  const cap = await capabilityOf(adapter.id, ctx);
  gate.checks.capability = cap.status;
  if (cap.status === 'UNAVAILABLE') {
    noteModuleError(adapter.id, 'CAPABILITY');
    return finish({ ok: false, status: 'CAPABILITY_UNAVAILABLE', error: cap.reason || 'MODULE_UNAVAILABLE', checks: gate.checks });
  }

  /* ── permission gate (§33): caller cannot exceed its granted level ────── */
  const needed = levelOf(op);
  if (PERMISSION_LEVELS.indexOf(needed) > PERMISSION_LEVELS.indexOf(permissionGranted)) {
    return finish({ ok: false, status: 'PERMISSION_DENIED', error: `operation ${op} requires ${needed}; granted ${permissionGranted}`, checks: gate.checks });
  }
  if (needed === 'EXECUTE' && adapter.permissionLevel === 'READ') {
    return finish({ ok: false, status: 'PERMISSION_DENIED', error: `${adapter.id} is READ-only`, checks: gate.checks });
  }
  gate.checks.permission = 'OK';

  /* ── health check ─────────────────────────────────────────────────────── */
  gate.checks.health = cap.ok ? 'OK' : `DEGRADED:${cap.reason || 'unknown'}`;

  /* ── dependency check ─────────────────────────────────────────────────── */
  const depProblems = await checkDependencies(adapter, ctx);
  gate.checks.dependencies = depProblems.length ? depProblems : 'OK';
  if (depProblems.length && op !== 'read') {
    return finish({ ok: false, status: 'DEPENDENCY_UNAVAILABLE', error: depProblems, checks: gate.checks });
  }

  /* ── operation existence ──────────────────────────────────────────────── */
  if (!OP_ORDER.includes(op)) return finish({ ok: false, status: 'UNKNOWN_OPERATION', error: op, checks: gate.checks });
  gate.checks.policy = 'OK';

  /* ── execute with timeout + retry/fallback + error intelligence ───────── */
  const recoveries = [];
  try {
    const { value } = await withRetryFallback(
      () => withTimeout(adapter[op](input, ctx || {}), OP_TIMEOUT_MS, `${module}.${op}`),
      {
        retries: op === 'read' ? 2 : 1,
        backoffMs: 150,
        label: `${module}.${op}`,
        fallbacks: typeof adapter.fallback === 'function' ? [() => adapter.fallback(op, input, ctx)] : [],
        onRecover: (info) => recoveries.push(info)
      }
    );
    noteModuleSuccess(module);
    if (value && value.ok === false) {
      // Adapter answered a STRUCTURED refusal (policy/provider) — classify it.
      const c = classifyError(value);
      if (c.securityStop) return finish({ ok: false, status: 'SAFE_STOP', securityStop: true, error: value.error || c.category, detail: value.detail || null, checks: gate.checks });
      noteModuleError(module, c.category);
      return finish({ ok: false, status: value.status || 'TOOL_REFUSED', error: value.error || value.reason || 'TOOL_REFUSED', detail: value.detail || value.reason || null, category: c.category, checks: gate.checks });
    }
    return finish({ ok: true, status: 'OK', result: value ?? null, recoveries, checks: gate.checks });
  } catch (err) {
    const c = classifyError(err);
    noteModuleError(module, c.category);
    const rec = await Promise.resolve(adapter.recover(err)).catch(() => ({ recovered: false, strategy: 'NONE' }));
    if (err.securityStop || c.securityStop) {
      return finish({ ok: false, status: 'SAFE_STOP', securityStop: true, error: c.category, raw: c.raw, recovery: rec, checks: gate.checks });
    }
    return finish({ ok: false, status: 'TOOL_ERROR', error: String(err?.message || 'TOOL_ERROR').slice(0, 200), category: c.category, attempts: err.attempts || null, recovery: rec, checks: gate.checks });
  }
}
