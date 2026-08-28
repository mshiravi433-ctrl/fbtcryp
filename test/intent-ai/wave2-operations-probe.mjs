#!/usr/bin/env node
/**
 * Wave 2 — Operations and provability probe.
 *
 * Validates:
 * 1. Simulator service exists and produces digests
 * 2. Monitor heartbeat works
 * 3. Scheduler enforces authorization
 * 4. Audit log exists
 * 5. Drill services exist
 */

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const results = [];
const check = (name, ok) => results.push({ name, ok });

/* 1. Service modules exist */
check('simulator service exists', existsSync(path.join(root, 'server/intentSimulator.js')));
check('monitor service exists', existsSync(path.join(root, 'server/intentMonitor.js')));
check('scheduler service exists', existsSync(path.join(root, 'server/intentScheduler.js')));
check('audit log exists', existsSync(path.join(root, 'server/intentAuditLog.js')));
check('drill service exists', existsSync(path.join(root, 'server/intentDrill.js')));

/* 2. Test services directly */
const { simulateIntent, simulatorEvidence } = await import('../../server/intentSimulator.js');
const simResult = simulateIntent({ kind: 'swap', chainId: 421614, amount: '1000000' });
check('simulator produces requestDigest', typeof simResult.requestDigest === 'string' && simResult.requestDigest.length === 64);
check('simulator produces resultDigest', typeof simResult.resultDigest === 'string' && simResult.resultDigest.length === 64);
check('simulator does not sign', simResult.signs === false);
check('simulator does not submit', simResult.submits === false);

const simEvidence = simulatorEvidence();
check('simulator evidence ok', simEvidence.ok === true);

/* 3. Monitor */
const { recordHeartbeat, monitorEvidence, monitorHealth } = await import('../../server/intentMonitor.js');
const hb = recordHeartbeat('test', { now: Date.now() });
check('monitor records heartbeat', hb.ok === true);

const monEvidence = monitorEvidence();
check('monitor evidence ok', monEvidence.ok === true);

const monHealth = monitorHealth();
check('monitor is healthy after heartbeat', monHealth.ok === true);

/* 4. Scheduler */
const { schedulerEvidence, checkScheduleAuthorization } = await import('../../server/intentScheduler.js');
const schedEvidence = schedulerEvidence();
check('scheduler evidence ok', schedEvidence.ok === true);
check('scheduler does not sign', schedEvidence.signs === false);
check('scheduler does not submit', schedEvidence.submits === false);

const unauthorized = checkScheduleAuthorization({
  userAuthorization: false,
  guardianApproved: true,
  policyRechecked: true
});
check('scheduler rejects unauthorized', unauthorized.ok === false);

/* 5. Audit */
const { auditStatus } = await import('../../server/intentAuditLog.js');
const auditSt = await auditStatus();
check('audit status has schema', auditSt.schema === 'fbt.intent-audit.v1');

/* 6. Drills */
const { backupRestoreDrill, reproducibleBuildCheck, rollbackDrill, sloMeasurement } = await import('../../server/intentDrill.js');
check('backup/restore drill passes', backupRestoreDrill().ok === true);
check('reproducible build passes', reproducibleBuildCheck().ok === true);
check('rollback drill passes', rollbackDrill().ok === true);
/* SLO is a measurement, not a constant: with no traffic it must refuse to
   report, and it may only pass once real samples exist. */
const { recordSloSample, resetSloMeter } = await import('../../server/intentSloMeter.js');
resetSloMeter();
const coldSlo = sloMeasurement();
check('SLO refuses to report without samples', coldSlo.ok === false && coldSlo.measurement.measured === false);
for (let i = 0; i < 25; i += 1) recordSloSample({ durationMs: 30 + i, ok: true });
const warmSlo = sloMeasurement();
check('SLO measurement passes on real samples', warmSlo.ok === true && warmSlo.measurement.samples >= 20);
check('SLO uptime is computed, not defaulted', warmSlo.measurement.uptime === 1 && warmSlo.measurement.p95LatencyMs !== null);
resetSloMeter();

const passed = results.filter(r => r.ok).length;
console.log(JSON.stringify({ probe: 'wave2-operations', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exit(1);
