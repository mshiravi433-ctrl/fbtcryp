#!/usr/bin/env node
/**
 * Record a strict fork-probe PASS as an evidence record.
 * ---------------------------------------------------------------------------
 * The rollout gate (`scripts/farm-rollout-policy.mjs`, invoked by
 * `vite.config.js`) is fail-closed on a bare `FARM_STRICT_FORK_EVIDENCE=true`;
 * for an ENABLED protocol it requires a real evidence file that names the
 * protocol, records `result: PASS` and a non-zero number of passed assertions,
 * and is fingerprinted by the raw probe log's sha256. You cannot fake it with
 * an env-var alone. This helper writes that evidence record.
 *
 * Run this AFTER a full `--strict` probe passes, piping the probe output in:
 *
 *     node test/aave-base-fork-probe.mjs --strict \
 *       | tee /tmp/aave-base.probe.log
 *     node scripts/record-farm-fork-evidence.mjs aave-base < /tmp/aave-base.probe.log
 *
 * It writes `farm-fork-evidence/<protocol-id>.json` (override the directory
 * with FARM_FORK_EVIDENCE_DIR). Keep that file out of git (§ it is a fresh,
 * re-earned per-run record) — see .gitignore.
 *
 * The evidence file is what the build gate reads, so a canary build for a
 * protocol is only permitted when this record, with `result: PASS`, exists on
 * disk next to the build.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN = new Set(['aave-base', 'compound-base', 'aave-arbitrum', 'lido', 'morpho']);

function parseOutcome(log) {
  let total = null;
  let passed = null;
  const tail = log.split('\n').slice(-25).join('\n');
  const m = tail.match(/(\d+)\/(\d+) passed/);
  if (m) { passed = Number(m[1]); total = Number(m[2]); }
  const pass = /PASS|pass/i.test(tail) && /FAIL|fail/i.test(tail) === false;
  return { passed, total, pass };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

const id = process.argv[2];
if (!id || !KNOWN.has(id)) {
  console.error(`Usage: node scripts/record-farm-fork-evidence.mjs <protocol-id>\nValid ids: ${[...KNOWN].join(', ')}`);
  process.exit(1);
}

let log = '';
try { log = readFileSync(0, 'utf8'); } catch { /* stdin empty */ }

const { passed, total, pass } = parseOutcome(log);
if (!pass || total == null || passed == null || total <= 0 || passed < total) {
  console.error(`Evidence NOT recorded for '${id}': the probe output is not a clean full PASS.\n` +
    `${log.split('\n').filter(Boolean).slice(-8).join('\n')}`);
  process.exit(1);
}

const dir = process.env.FARM_FORK_EVIDENCE_DIR
  ? resolve(process.env.FARM_FORK_EVIDENCE_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'farm-fork-evidence');

const record = {
  protocol: id,
  result: 'PASS',
  assertionsPassed: passed,
  totalAssertions: total,
  fingerprint: {
    algo: 'sha256',
    digest: sha256(log)
  },
  recordedAt: new Date().toISOString(),
  note: 'Strict mainnet-fork probe output. A protocol whose probe passed is committed as an auditable anchor so the fail-closed staged gate is reproducible in CI; re-earned per run otherwise.'
};

mkdirSync(dir, { recursive: true });
const out = resolve(dir, `${id}.json`);
writeFileSync(out, JSON.stringify(record, null, 2) + '\n');

console.log(`Recorded fork evidence for '${id}' -> ${out}`);
console.log(`  result            = ${record.result}`);
console.log(`  assertions        = ${passed}/${total}`);
console.log(`  sha256(log)       = ${record.fingerprint.digest}`);
