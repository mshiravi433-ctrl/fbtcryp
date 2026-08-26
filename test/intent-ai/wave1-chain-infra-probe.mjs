#!/usr/bin/env node
/**
 * Wave 1 — Chain infrastructure probe.
 *
 * Validates:
 * 1. deploy-all.mjs exists
 * 2. KMS adapter exists
 * 3. Compile scripts include deployedBytecode
 * 4. Venue health adapter exists
 * 5. Bridge quote adapter exists
 * 6. Server routes exist
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const results = [];
const check = (name, ok) => results.push({ name, ok });

/* 1. deploy-all exists */
check('deploy-all.mjs exists', existsSync(path.join(root, 'scripts/deploy-all.mjs')));

/* 2. KMS adapter exists */
check('KMS adapter exists', existsSync(path.join(root, 'scripts/lib/kmsAdapter.mjs')));

/* 3. Compile scripts include deployedBytecode */
const compileMjs = readFileSync(path.join(root, 'scripts/compile.mjs'), 'utf8');
check('FeeRouter compile includes deployedBytecode', compileMjs.includes('deployedBytecode'));

const compileWorkflow = readFileSync(path.join(root, 'scripts/compile-workflow.mjs'), 'utf8');
check('Workflow compile includes deployedBytecode', compileWorkflow.includes('deployedBytecode'));

/* 4. Venue health adapter */
check('venue health adapter exists', existsSync(path.join(root, 'server/intentVenueHealth.js')));

/* 5. Bridge quote adapter */
check('bridge quote adapter exists', existsSync(path.join(root, 'server/intentBridgeQuote.js')));

/* 6. Server routes */
const appJs = readFileSync(path.join(root, 'server/app.js'), 'utf8');
check('venue-health route exists', appJs.includes('/api/intents/v1/venue-health'));
check('bridge-quote route exists', appJs.includes('/api/intents/v1/bridge-quote'));
check('operator-evidence route exists', appJs.includes('/api/intents/v1/operator-evidence'));
check('freeze-status route exists', appJs.includes('/api/intents/v1/freeze-status'));

/* 7. Test API routes */
process.env.RATE_LIMIT = '100000';
process.env.LEARNING_EVENT_RATE_LIMIT = '100';
process.env.INTENT_SETTLEMENT_RATE_LIMIT = '100';
process.env.TELEGRAM_BOT_TOKEN = '0000000000:test-only-token';
process.env.ECOSYSTEM_WRITE_RATE_LIMIT = '25';

const app = (await import('../../server/app.js')).default;
const http = await import('node:http');

const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

try {
  const venueHealth = await get('/api/intents/v1/venue-health');
  check('venue-health route returns 200', venueHealth.status === 200);
  check('venue-health has schema', venueHealth.body.schema === 'fbt.venue-health.v1');

  const bridgeStatus = await get('/api/intents/v1/bridge-status');
  check('bridge-status route returns 200', bridgeStatus.status === 200);

  const freezeStatus = await get('/api/intents/v1/freeze-status');
  check('freeze-status route returns 200', freezeStatus.status === 200);
  check('system starts frozen', freezeStatus.body.frozen === true);

  const evidenceStatus = await get('/api/intents/v1/evidence-status');
  check('evidence-status route returns 200', evidenceStatus.status === 200);
  check('evidence-status has required kinds count', evidenceStatus.body.totalKindsRequired === 21);

  const drillStatus = await get('/api/intents/v1/drill-status');
  check('drill-status route returns 200', drillStatus.status === 200);
  check('backup drill passes', drillStatus.body.backupRestore?.ok === true);
  check('reproducible build passes', drillStatus.body.reproducibleBuild?.ok === true);
  check('rollback drill passes', drillStatus.body.rollbackDrill?.ok === true);
  check('SLO measurement passes', drillStatus.body.sloMeasurement?.ok === true);
} finally {
  server.close();
}

const passed = results.filter(r => r.ok).length;
console.log(JSON.stringify({ probe: 'wave1-chain-infra', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exit(1);
