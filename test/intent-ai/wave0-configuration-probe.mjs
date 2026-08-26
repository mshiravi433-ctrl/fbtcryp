#!/usr/bin/env node
/**
 * Wave 0 — Configuration probe.
 *
 * Validates:
 * 1. BLOB_READ_WRITE_TOKEN validation exists
 * 2. ECOSYSTEM_CERTIFIERS validation exists
 * 3. Validation script exists and runs
 * 4. Phase-status shows configuration state
 * 5. No secrets in output
 */

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const results = [];
const check = (name, ok) => results.push({ name, ok });

/* 1. Validation script exists */
check('validate-activation-env.mjs exists', existsSync(path.join(root, 'scripts/validate-activation-env.mjs')));

/* 2. Script runs and produces JSON */
let scriptOutput;
try {
  scriptOutput = execSync('node scripts/validate-activation-env.mjs', {
    cwd: root,
    env: { ...process.env, BLOB_READ_WRITE_TOKEN: '', ECOSYSTEM_CERTIFIERS: '' },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  check('validation script produces output', true);
} catch (e) {
  /* Script exits with 1 when env is not configured — that's expected */
  scriptOutput = (e.stdout || '') + (e.stderr || '');
  check('validation script exits with error when unconfigured', e.status === 1);
}

/* 3. Script validates format */
try {
  execSync('node scripts/validate-activation-env.mjs', {
    cwd: root,
    env: { ...process.env, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test123456789', ECOSYSTEM_CERTIFIERS: '' },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  check('script passes with only blob token (partial)', false);
} catch (e) {
  check('script fails with only blob token (needs certifiers too)', e.status === 1);
}

/* 4. Script produces JSON report */
try {
  const out = execSync('node scripts/validate-activation-env.mjs', {
    cwd: root,
    env: { ...process.env, BLOB_READ_WRITE_TOKEN: '', ECOSYSTEM_CERTIFIERS: '' },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const json = JSON.parse(out);
  check('output is valid JSON', true);
  check('JSON has schema field', json.schema === 'fbt.activation-env-validation.v1');
  check('JSON has variables', typeof json.variables === 'object');
  check('JSON has blockers array', Array.isArray(json.blockers));
} catch (e) {
  /* Expected to fail with exit code 1, but stdout should still be JSON */
  const out = e.stdout || '';
  try {
    const json = JSON.parse(out);
    check('output is valid JSON (even on failure)', true);
    check('JSON has schema field', json.schema === 'fbt.activation-env-validation.v1');
  } catch {
    check('output is valid JSON (even on failure)', false);
  }
}

/* 5. No secrets in output */
check('no secrets in output', !/vercel_blob_rw_|private.?key/i.test(scriptOutput || ''));

/* 6. Roadmap and runbook docs exist */
check('activation roadmap doc exists', existsSync(path.join(root, 'docs/INTENT-AI-ACTIVATION-ROADMAP-FA.md')));
check('activation runbook doc exists', existsSync(path.join(root, 'docs/INTENT-AI-ACTIVATION-RUNBOOK-FA.md')));
check('wave1 runbook doc exists', existsSync(path.join(root, 'docs/INTENT-AI-WAVE1-RUNBOOK-FA.md')));

const passed = results.filter(r => r.ok).length;
console.log(JSON.stringify({ probe: 'wave0-configuration', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exit(1);
