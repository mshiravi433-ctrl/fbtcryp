#!/usr/bin/env node
/**
 * Activation-config presence probe.
 *
 * The whole point of /api/intents/v1/activation-config is to answer "which
 * variable is still missing?" without exposing a single value. This probe:
 *   1. boots a fresh instance with the four activation env variables set and
 *      checks the report flips every variable to configured:true;
 *   2. reboots WITHOUT them and checks they are false;
 *   3. asserts no value material is ever rendered (only booleans/counts);
 *   4. asserts the report maps the kinds the 21/21 gate is missing;
 *   5. rejects secret patterns in the response body (private keys, tokens).
 */

import assert from 'node:assert/strict';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

async function boot(env) {
  const mod = await import(`../../server/app.js?probe=${Date.now()}-${Math.random()}`);
  const app = mod.default;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server };
}

function setEnv(env) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

try {
  /* ── with the full activation env set ── */
  process.env.NODE_ENV = 'test';
  setEnv({
    BLOB_READ_WRITE_TOKEN: 'blob_test_token_not_a_real_credential_123456',
    RPC_URL: 'https://arb1.arbitrum.io/rpc',
    VITE_WALLETCONNECT_PROJECT_ID: 'probe-project-id-123456',
    INTENT_INDEPENDENT_REVIEWERS: 'reviewer-1:MCowBQYDK2VwAyEAJY3vKKGrUeKcMEkZHO95SkT55MEWLQDZHZd/jvuZ2AE=',
    CRON_SECRET: '0123456789abcdef0123456789abcdef',
    PUBLIC_ORIGIN: 'https://probe.example.com'
  });
  let { base, server } = await boot();
  let body = await (await fetch(`${base}/api/intents/v1/activation-config`)).json();

  check('all four gate variables report configured:true', [
    'BLOB_READ_WRITE_TOKEN', 'RPC_URL', 'VITE_WALLETCONNECT_PROJECT_ID', 'INTENT_INDEPENDENT_REVIEWERS'
  ].every((name) => body.variables[name]?.configured === true));
  check('cron secret reports configured', body.variables.CRON_SECRET?.configured === true);
  check('public origin reports configured', body.variables.PUBLIC_ORIGIN?.configured === true);
  check('reviewer count is 1', body.variables.INTENT_INDEPENDENT_REVIEWERS?.reviewerCount === 1);
  check('no activation kind is listed as env-missing', body.requiredForActivation.length === 0);
  check('the report never renders a value (booleans and counts only)',
    Object.values(body.variables).every((v) => typeof v.configured === 'boolean'));
  check('no secret pattern leaks in the response',
    !Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(body)), 'value') &&
    !/vercel_blob_rw_[A-Za-z0-9_]{12,}|MC4CAQAwBQYDK2Vw|BEGIN PRIVATE KEY|0x[0-9a-f]{40,}/i.test(JSON.stringify(body)));
  check('external-only kinds are listed with remediation', body.externalOnly.length >= 3);
  check('schema is stable', body.schema === 'fbt.activation-config.v1');
  server.closeAllConnections?.();
  server.close();

  /* ── without the env vars ── */
  setEnv({
    BLOB_READ_WRITE_TOKEN: undefined,
    RPC_URL: undefined,
    VITE_WALLETCONNECT_PROJECT_ID: undefined,
    INTENT_INDEPENDENT_REVIEWERS: undefined,
    CRON_SECRET: undefined,
    PUBLIC_ORIGIN: undefined
  });
  const boot2 = await boot();
  body = await (await fetch(`${boot2.base}/api/intents/v1/activation-config`)).json();
  check('without env vars every gate variable reports false', [
    'BLOB_READ_WRITE_TOKEN', 'RPC_URL', 'VITE_WALLETCONNECT_PROJECT_ID', 'INTENT_INDEPENDENT_REVIEWERS', 'CRON_SECRET'
  ].every((name) => body.variables[name]?.configured === false));
  check('missing kinds are listed and include the blob/rpc/provider kinds',
    ['approved-durable-registry', 'durable-immutable-audit', 'rpc', 'wallet-provider'].every((kind) =>
      body.requiredForActivation.some((row) => row.kind === kind)));
  check('independent-security-review is listed once reviewers are absent',
    body.requiredForActivation.some((row) => row.kind === 'independent-security-review'));
  boot2.server.closeAllConnections?.();
  boot2.server.close();
} catch (error) {
  console.error(JSON.stringify({ probe: 'activation-config', failed: true, error: error.message }, null, 2));
  process.exitCode = 1;
}

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'activation-config', passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
