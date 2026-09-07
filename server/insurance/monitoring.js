/**
 * FBT Insurance OS — Claim monitoring / incident detection (§22, §26).
 *
 * Detection NEVER declares a claim valid. It records a PotentialIncident, finds
 * owners with matching active coverage, checks eligibility, and notifies them
 * so THEY can decide to file a claim. Sources today are reported (webhook/manual)
 * incidents; oracle/bridge/depeg scanners can call registerIncident later.
 */
import * as store from './store.js';
import { emit } from './events.js';
import { getCoverage } from './coverage.js';
import { newId, sha256 } from './quote-engine.js';
import { COVERAGE_STATUS, INCIDENT_SEVERITY } from './constants.js';

/**
 * registerIncident({ protectionType, protocol?, chainId?, asset?, severity,
 *   source, description, references?, txHash? })
 * Returns { incident, matched: [coverage...] }. Matched active coverages are
 * listed (they are NOT auto-claimed).
 */
export async function registerIncident(input) {
  const incidentId = newId('inc');
  const incident = {
    incidentId,
    protectionType: input.protectionType || 'smart-contract',
    protocol: input.protocol || null,
    chainId: input.chainId ? Number(input.chainId) : null,
    asset: input.asset || null,
    severity: INCIDENT_SEVERITY[input.severity] || INCIDENT_SEVERITY.MEDIUM,
    source: input.source || 'manual',
    description: String(input.description || '').slice(0, 2000),
    references: Array.isArray(input.references) ? input.references : [],
    txHash: input.txHash || null,
    integrityHash: sha256({ protectionType: input.protectionType, protocol: input.protocol, chainId: input.chainId, asset: input.asset, description: input.description, references: input.references }),
    declaredAt: Date.now(),
    status: 'POTENTIAL'
  };
  await store.set('incidents', incidentId, incident);
  const incIds = (await store.get('incident-ids', 'all')) || [];
  incIds.push(incidentId);
  await store.set('incident-ids', 'all', incIds.slice(-500));

  // find matching active coverages (same kind; protocol/chain match when present)
  const all = await allActiveCoverages();
  const matched = all.filter((c) => c.protectionType === incident.protectionType
    && (!incident.chainId || !c.chainId || c.chainId === incident.chainId)
    && (!incident.protocol || !c.protocol || c.protocol === incident.protocol));

  await emit({
    type: 'IncidentDetected',
    payload: { incidentId, protectionType: incident.protectionType, protocol: incident.protocol, severity: incident.severity, matchedOwners: matched.length }
  });
  return { incident, matched: matched.map((c) => ({ owner: c.owner, coverageId: c.coverageId })) };
}

async function allActiveCoverages() {
  // scan owner indexes is not feasible on KV; instead keep a global active set.
  const ids = (await store.get('active-coverage-ids', 'all')) || [];
  const out = [];
  for (const id of ids) {
    const c = await store.get('coverage', id);
    if (c && c.status === COVERAGE_STATUS.ACTIVE) out.push(c);
    else {
      const next = ids.filter((x) => x !== id);
      await store.set('active-coverage-ids', 'all', next);
    }
  }
  return out;
}

export async function trackCoverageForIncidents(coverageId) {
  const ids = (await store.get('active-coverage-ids', 'all')) || [];
  if (!ids.includes(coverageId)) { ids.push(coverageId); await store.set('active-coverage-ids', 'all', ids); }
}

export async function listIncidents(limit = 50) {
  const ids = (await store.get('incident-ids', 'all')) || [];
  const rows = [];
  for (const id of ids.slice(-limit)) {
    const inc = await store.get('incidents', id);
    if (inc) rows.push(inc);
  }
  return rows.reverse();
}
