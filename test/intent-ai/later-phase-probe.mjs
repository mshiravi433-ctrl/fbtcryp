#!/usr/bin/env node
/**
 * Later-phase probe (31–100).
 *
 * Proves in-process work actually ran, operate*() planes stay unsigned for
 * go-live, and third-party kinds are never self-issued.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.LEARNING_EVENT_RATE_LIMIT = process.env.LEARNING_EVENT_RATE_LIMIT || '100';
process.env.INTENT_SETTLEMENT_RATE_LIMIT = process.env.INTENT_SETTLEMENT_RATE_LIMIT || '100';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '0000000000:test-only-token';
process.env.ECOSYSTEM_WRITE_RATE_LIMIT = process.env.ECOSYSTEM_WRITE_RATE_LIMIT || '25';
process.env.INTENT_ACCOUNTABLE_OWNER = process.env.INTENT_ACCOUNTABLE_OWNER || 'owner-later-phase';
process.env.INTENT_INCIDENT_COMMANDER = process.env.INTENT_INCIDENT_COMMANDER || 'commander-later-phase';

import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SELF_VERIFIABLE_KINDS } from '../../server/intentAutoEvidence.js';
import { STAGE3_KINDS } from '../../server/intentStage3Probe.js';
import { stubSignerAllowed } from '../../src/lib/intent-ai/walletRuntime.js';
import { operateProgramControl } from '../../src/lib/intent-ai/phase50ProgramControl.js';
import { operateReleaseTrain } from '../../src/lib/intent-ai/phase41ReleaseTrain.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const {
  runLaterPhaseProbe,
  laterPhaseProbeReport,
  resetLaterPhaseCache,
  LATER_PHASE_SCHEMA,
  THIRD_PARTY_PROVIDERS
} = await import('../../server/intentLaterPhaseProbe.js');

resetLaterPhaseCache();
const report = await runLaterPhaseProbe({});

check('schema is the later-phase probe schema', report.schema === LATER_PHASE_SCHEMA);
check('launchAllowed stays false', report.launchAllowed === false && report.goLive === false);
check('live and operational stay false', report.live === false && report.operational === false);
check('no check claims live or launchAllowed', report.claimedLive === false);
check('selfIssuedReview is false', report.selfIssuedReview === false);
check('no evidence kinds were added to the 21', report.evidenceKindsAdded === 0);
check('provenCount is a real number of in-process checks', report.provenCount >= 15);
check('every check has launchAllowed false', report.checks.every((row) => row.launchAllowed === false));
check('no check flips operational/live true', report.checks.every((row) => row.operational !== true && row.live !== true));

const byId = Object.fromEntries(report.checks.map((row) => [row.id, row]));
check('production stub is forbidden in NODE_ENV=production', byId['production-stub-forbidden']?.ok === true);
check('stubSignerAllowed refuses production even with allowStub', stubSignerAllowed({ NODE_ENV: 'production', allowStub: true }) === false);
check('change freeze blocks deploy', byId['change-freeze-blocks-deploy']?.ok === true);
check('gameday actually executed backup+rollback', byId['gameday-rehearsal']?.ok === true);
check('chaos drill covers every fault', byId['chaos-drill']?.ok === true);
check('data lifecycle erasure is proven', byId['data-lifecycle']?.ok === true);
check('public API never delegates execution', byId['public-api-no-execute']?.ok === true);
check('fee line is disclosed arithmetic', byId['fee-integrity']?.ok === true);
check('material terms force reconfirmation', byId['terms-diff-material']?.ok === true);
check('missing simulator blocks sign', byId['simulation-blocks-sign']?.ok === true);
check('adverse quote recheck is REAUTHORIZE', byId['live-quote-recheck']?.ok === true);
check('STOPPED session survives restore', byId['session-stop-survives']?.ok === true);
check('backtest stays a SIMULATION', byId['honest-backtest']?.ok === true);
check('receipt batch without submit stays unanchored', byId['receipt-anchor-unanchored']?.ok === true);
check('program control does not go live', byId['program-control']?.ok === true);
check('green public status is refused', byId['public-disclosure-honest']?.ok === true);
check('legal hold export is blocked', byId['residency-legal-hold']?.ok === true);
check('rate limit cannot be marked bypassable', byId['abuse-rate-limits']?.ok === true);
check('client outcomes cannot train', byId['telemetry-integrity']?.ok === true);
check('local key rotation proves the old key', byId['local-key-rotation']?.ok === true);
check('incident assumed-resolved is refused', byId['incident-assumed-refused']?.ok === true);

check('SSO stays missing', report.missing.some((m) => m.id === 'workforce-sso' && m.code === 'WORKFORCE_SSO_UNATTESTED'));
check('counsel stays missing', report.missing.some((m) => m.id === 'regulatory-counsel'));
check('SBOM attestation stays missing', report.missing.some((m) => m.id === 'dependency-sbom' && m.code === 'SBOM_ATTESTATION_MISSING'));
check('secondary region stays missing', report.missing.some((m) => m.id === 'failover-secondary' && m.code === 'SECONDARY_REGION_UNREADY'));
check('browser wallet E2E stays a third-party gap', report.missing.some((m) => m.id === 'browser-wallet-e2e' && m.thirdParty === true));

check('third-party catalog does not claim presence', THIRD_PARTY_PROVIDERS.length >= 8);
check('third-party status rows are all absent', report.thirdParty.every((row) => row.present === false));

check('SELF_VERIFIABLE_KINDS is still 7', SELF_VERIFIABLE_KINDS.length === 7);
check('later-phase is not a stage-3 kind', !STAGE3_KINDS.includes('later-phase'));

const freeze = operateReleaseTrain({
  train: { attested: true },
  change: { wouldDeploy: true, reviewed: true, rollbackReady: true },
  freeze: true
});
check('operateReleaseTrain still fails closed on freeze', freeze.code === 'CHANGE_FREEZE_ACTIVE');

const program = operateProgramControl({ evidence: [], freeze: true, programComplete: true });
check('completing the program does not auto-go-live', program.launchAllowed === false && program.goLive === false);

const src = readFileSync(new URL('../../server/intentLaterPhaseProbe.js', import.meta.url), 'utf8');
check('later-phase never imports auto-evidence kinds', !src.includes('SELF_VERIFIABLE_KINDS') && !src.includes('autoStoreEvidence'));
check('later-phase never self-issues a review', !src.includes('independent-security-review') || src.includes('never'));

const app = (await import('../../server/app.js')).default;
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  const dry = await fetch(`${base}/api/intents/v1/later-phase-probe?dry=1`).then((r) => r.json());
  check('later-phase-probe route returns the schema', dry.schema === LATER_PHASE_SCHEMA);
  check('later-phase-probe dry run does not go live', dry.launchAllowed === false && dry.live === false);
  check('later-phase-probe dry run still proves in-process work', dry.provenCount >= 15);

  const providers = await fetch(`${base}/api/intents/v1/external-providers`).then((r) => r.json());
  check('external-providers route is honest', providers.schema === 'fbt.external-provider-digest.v1');
  check('external-providers never self-issue a review', providers.selfIssuedReview === false);
  check('external-providers list at least one missing IdP', providers.missing.some((m) => m.id === 'workforce-sso'));
} finally {
  server.close();
}

const dir = mkdtempSync(path.join(tmpdir(), 'later-phase-cli-'));
try {
  const outJson = path.join(dir, 'drill.json');
  const outMd = path.join(dir, 'drill.md');
  const drill = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/run-ops-drills.mjs'),
    '--out', outJson,
    '--md', outMd
  ], { encoding: 'utf8', timeout: 60_000 });
  check('ops:drill --out/--md exits 0 when drills pass', drill.status === 0);
  const written = JSON.parse(readFileSync(outJson, 'utf8'));
  check('ops:drill JSON has the digest schema', written.schema === 'fbt.operational-drill-digest.v1');
  check('ops:drill JSON keeps later-phase launchAllowed false', written.laterPhase.launchAllowed === false);
  check('ops:drill markdown was written', readFileSync(outMd, 'utf8').includes('digest دریل عملیاتی'));

  const extJson = path.join(dir, 'ext.json');
  const extMd = path.join(dir, 'ext.md');
  const ext = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/run-external-providers.mjs'),
    '--require-all',
    '--out', extJson,
    '--md', extMd
  ], { encoding: 'utf8', timeout: 60_000 });
  check('ops:external-providers --require-all exits 1 while providers are missing', ext.status === 1);
  const extBody = JSON.parse(readFileSync(extJson, 'utf8'));
  check('external-provider digest schema', extBody.schema === 'fbt.external-provider-digest.v1');
  check('external-provider digest does not self-issue review', extBody.selfIssuedReview === false);
  check('external-provider markdown was written', readFileSync(extMd, 'utf8').includes('ارائه‌دهندگان خارجی'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

resetLaterPhaseCache();
const cached = await laterPhaseProbeReport({ force: true });
check('report helper returns the same schema', cached.schema === LATER_PHASE_SCHEMA);

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'later-phase', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
export default results;
