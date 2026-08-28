/**
 * FBT INTENT AI — ops-probe.
 *
 * Earns the four operational-drill evidence kinds by actually running them,
 * then persists whatever was genuinely earned so every serverless instance
 * reports the same snapshot.
 *
 * Same rule as intentSelfProbe.js: a process may attest only what it verified
 * in this run. Nothing here invents a digest. The four kinds are:
 *
 *   backup-restore-drill  write + restore + hash match
 *   rollback-drill        overlay a bad release, restore the previous one
 *   sandbox-operator      isolated child/vm with production credentials gone
 *   policy-contract       committed FeeRouter bytecode hash (on-chain if RPC)
 *
 * Independent security review, KMS signers, guardians, brokers and bridges
 * stay out of this file — they are stage-3 attestations.
 */

import { storeGet, storeSet } from './store.js';
import { blobConfigured } from './blobCache.js';
import {
  runAllOperationalDrills,
  OPS_DRILL_KINDS
} from './intentOperationalDrills.js';

export const OPS_PROBE_SCHEMA = 'fbt.ops-probe.v1';
export const OPS_PROBE_STORE_KEY = 'intent-evidence/v1/ops-probe.json';
export { OPS_DRILL_KINDS };

const AUDIT_TIMEOUT_MS = 8_000;
const MIN_INTERVAL_MS = 60_000;

function withDeadline(promise, ms, code) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timedOut: true, code }), ms);
      if (timer.unref) timer.unref();
    })
  ]);
}

let lastReport = null;
let lastRunAt = 0;
let inFlight = null;
let hydration = null;

async function persistEarned(records, { now }) {
  if (records.length === 0) return { persisted: false, code: 'NOTHING_EARNED' };
  try {
    const existing = await readPersisted({ now });
    const merged = new Map(existing.map((r) => [r.kind, r]));
    for (const record of records) merged.set(record.kind, record);
    const result = await withDeadline(
      storeSet(OPS_PROBE_STORE_KEY, JSON.stringify([...merged.values()])),
      AUDIT_TIMEOUT_MS,
      'PERSIST_TIMEOUT'
    );
    if (result?.__timedOut) return { persisted: false, code: result.code };
    return blobConfigured()
      ? { persisted: true, count: merged.size }
      : { persisted: false, code: 'DURABLE_STORE_NOT_CONFIGURED', count: merged.size };
  } catch (e) {
    return { persisted: false, code: 'PERSIST_FAILED', detail: e.message };
  }
}

async function readPersisted({ now }) {
  try {
    const raw = await withDeadline(storeGet(OPS_PROBE_STORE_KEY), AUDIT_TIMEOUT_MS, 'READ_TIMEOUT');
    if (!raw || raw.__timedOut || typeof raw !== 'string') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record) =>
      record
      && OPS_DRILL_KINDS.includes(record.kind)
      && /^[0-9a-f]{64}$/.test(String(record.digest || ''))
      && Number(record.expiresAt) > now
    );
  } catch {
    return [];
  }
}

export async function hydrateOpsProbeEvidence({ now = Date.now() } = {}) {
  const records = await readPersisted({ now });
  if (records.length === 0) return { hydrated: 0 };
  try {
    const { autoStoreEvidence } = await import('./intentOperatorEvidence.js');
    for (const record of records) autoStoreEvidence(record);
  } catch {
    return { hydrated: 0 };
  }
  return { hydrated: records.length, kinds: records.map((r) => r.kind) };
}

export function ensureOpsHydrated({ now = Date.now() } = {}) {
  if (!hydration) {
    hydration = hydrateOpsProbeEvidence({ now }).catch(() => ({ hydrated: 0 }));
  }
  return hydration;
}

export async function runOpsProbe({ now = Date.now(), store = true } = {}) {
  const drills = await runAllOperationalDrills({ now });
  const earned = drills.earned;

  let persistence = { persisted: false, code: 'NOT_ATTEMPTED' };
  if (store && earned.length > 0) {
    try {
      const { autoStoreEvidence } = await import('./intentOperatorEvidence.js');
      for (const record of earned) autoStoreEvidence(record);
    } catch { /* store unavailable — the report is still accurate */ }
    persistence = await persistEarned(earned, { now });
  }

  return {
    schema: OPS_PROBE_SCHEMA,
    checkedAt: now,
    stored: store,
    durable: persistence.persisted === true,
    durableDetail: persistence.persisted ? undefined : persistence.code,
    earnedCount: earned.length,
    totalKinds: OPS_DRILL_KINDS.length,
    earned: earned.map((e) => ({ kind: e.kind, providerId: e.providerId, digest: e.digest, expiresAt: e.expiresAt })),
    missing: drills.missing,
    detail: {
      backup: drills.byKind['backup-restore-drill']?.ok
        ? { rpoMs: drills.byKind['backup-restore-drill'].rpoMs, rtoMs: drills.byKind['backup-restore-drill'].rtoMs, backupHash: drills.byKind['backup-restore-drill'].backupHash }
        : { code: drills.byKind['backup-restore-drill']?.code },
      rollback: drills.byKind['rollback-drill']?.ok
        ? { restoredVersion: drills.byKind['rollback-drill'].restoredVersion }
        : { code: drills.byKind['rollback-drill']?.code },
      sandbox: drills.byKind['sandbox-operator']?.ok
        ? { runtime: drills.byKind['sandbox-operator'].runtime, mainnetAccess: false }
        : { code: drills.byKind['sandbox-operator']?.code },
      policy: drills.byKind['policy-contract']?.ok
        ? { expectedCodeHash: drills.byKind['policy-contract'].expectedCodeHash, onChainMatched: drills.byKind['policy-contract'].onChainMatched }
        : { code: drills.byKind['policy-contract']?.code }
    }
  };
}

export async function opsProbeReport({ now = Date.now(), force = false } = {}) {
  if (!force && lastReport && now - lastRunAt < MIN_INTERVAL_MS) {
    return { ...lastReport, cached: true, cachedForMs: MIN_INTERVAL_MS - (now - lastRunAt) };
  }
  if (inFlight) return { ...(await inFlight), cached: true };

  inFlight = runOpsProbe({ now })
    .then((report) => {
      lastReport = report;
      lastRunAt = Date.now();
      return report;
    })
    .finally(() => { inFlight = null; });

  return { ...(await inFlight), cached: false };
}

/** Tests only. */
export function resetOpsProbeCache() {
  lastReport = null;
  lastRunAt = 0;
  inFlight = null;
  hydration = null;
}
