/**
 * FBT CENTRAL INTELLIGENCE OS — Central Capability Manager (§8).
 * ---------------------------------------------------------------------------
 * The brain must ALWAYS know what is actually available:
 *   AVAILABLE / DEGRADED / READ_ONLY / UNAVAILABLE
 * and it must never claim a capability that does not exist. Statuses come
 * from live health checks of the real adapters (with a short cache so a
 * chatty client cannot DDoS upstream providers through us), plus the error
 * ledger: repeated recent failures downgrade a module until it recovers.
 */
import { getModule, listModules, registeredModuleIds } from './registry.js';
import { withTimeout } from './errorEngine.js';

const HEALTH_CACHE_MS = 30_000;
const healthCache = new Map(); // module -> { result, at }
const errorLedger = new Map(); // module -> [{at, category}]

export function noteModuleError(moduleId, category = 'UNKNOWN') {
  const now = Date.now();
  const rows = (errorLedger.get(moduleId) || []).filter((r) => now - r.at < 10 * 60_000);
  rows.push({ at: now, category });
  errorLedger.set(moduleId, rows);
}

export function noteModuleSuccess(moduleId) {
  errorLedger.delete(moduleId);
  healthCache.delete(moduleId);
}

async function probeModule(adapter, ctx) {
  const cached = healthCache.get(adapter.id);
  if (cached && Date.now() - cached.at < HEALTH_CACHE_MS) return cached.result;
  let result;
  try {
    const h = await withTimeout(adapter.healthCheck({}, ctx || {}), 9000, `health:${adapter.id}`);
    result = { status: h?.status || (h?.ok ? 'AVAILABLE' : 'DEGRADED'), ok: h?.ok !== false, reason: h?.reason || null, at: Date.now() };
  } catch (err) {
    result = { status: 'DEGRADED', ok: false, reason: String(err?.message || 'HEALTH_TIMEOUT').slice(0, 120), at: Date.now() };
  }
  healthCache.set(adapter.id, { result, at: Date.now() });
  return result;
}

function downgradeByErrors(status, moduleId) {
  const recent = (errorLedger.get(moduleId) || []).length;
  if (recent >= 5) return { status: 'UNAVAILABLE', reason: `${recent} errors in 10m`, downgraded: true };
  if (recent >= 2 && status === 'AVAILABLE') return { status: 'DEGRADED', reason: `${recent} recent errors`, downgraded: true };
  return null;
}

/** Full capability map for every registered module. */
export async function capabilityReport(ctx = null) {
  const ids = registeredModuleIds();
  const entries = await Promise.all(ids.map(async (id) => {
    const adapter = getModule(id);
    const probe = await probeModule(adapter, ctx);
    const downgrade = downgradeByErrors(probe.status, id);
    const status = downgrade ? downgrade.status : probe.status;
    return [id, {
      status,
      reason: downgrade ? downgrade.reason : probe.reason,
      permissionLevel: adapter.permissionLevel,
      operations: adapter.capabilities?.()?.operations || [],
      dependsOn: adapter.dependsOn
    }];
  }));
  return Object.fromEntries(entries);
}

/** Single-module status, synchronous-ish path for the hot router loop. */
export async function capabilityOf(moduleId, ctx = null) {
  const adapter = getModule(moduleId);
  if (!adapter) return { status: 'UNAVAILABLE', reason: 'MODULE_NOT_REGISTERED' };
  const probe = await probeModule(adapter, ctx);
  const downgrade = downgradeByErrors(probe.status, adapter.id);
  return downgrade ? { ...probe, ...downgrade } : probe;
}

export function testResetCapabilities() { healthCache.clear(); errorLedger.clear(); }
