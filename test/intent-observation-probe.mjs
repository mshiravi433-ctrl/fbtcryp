/**
 * INTENT EXECUTION OBSERVATION PROBE — client builder + real HTTP ingest.
 * ---------------------------------------------------------------------------
 * The observation payload is the ONLY thing this phase sends to a server about
 * a real execution, so the test surface is deliberately hostile:
 *
 *   · opt-in is required (401 without a consent token, however valid the body)
 *   · every field is bounded and enumerated; unknown fields are rejected
 *   · an address, tx hash, calldata, free text or note is rejected
 *   · the payload is rejected — never trimmed into acceptance
 *   · with no durable storage the endpoint fails CLOSED (503 NOT_CONFIGURED)
 *   · the endpoint has its own rate-limit budget
 *   · a telemetry failure cannot break an execution
 */

process.env.INTENT_OBSERVATION_RATE_LIMIT = process.env.INTENT_OBSERVATION_RATE_LIMIT || '8';
delete process.env.BLOB_READ_WRITE_TOKEN; // force the fail-closed path

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const obs = await import('../src/lib/intentObservation.js');
const serverObs = await import('../server/intentObservation.js');

const consent = { 'x-telemetry-consent': 'ct1:' + '0123456789abcdef'.repeat(2) };

/* ------------------------- 1. the client builder --------------------------- */
const good = obs.buildIntentObservation({
  intentKind: 'swap',
  chainId: 42161,
  routePolicy: 'MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1',
  solver: 'kyberswap',
  quoteCount: 3,
  hopCount: 2,
  simulationStatus: 'passed',
  gasEstimate: 210_000,
  gasErrorBps: 120,
  outputErrorBps: -8,
  confirmationLatencyMs: 9_000,
  failureCode: 'NONE',
  outcome: 'completed',
  policyVersion: 'fbt.intent-lifecycle-policy.v1'
});

t('the builder produces the v1 observation schema', good?.schema === obs.INTENT_OBSERVATION_SCHEMA);
t('the payload has exactly the declared fields',
  Object.keys(good).length === obs.OBSERVATION_FIELDS.length
  && Object.keys(good).every((k) => obs.OBSERVATION_FIELDS.includes(k)));
t('gas is bucketed, not exact', good.gasEstimateBucket === '100k-250k' && !('gasEstimate' in good));
t('gas error is bucketed', good.gasErrorBpsBucket === '50-200');
t('output error is bucketed by magnitude', good.outputErrorBpsBucket === 'lte10');
t('confirmation latency is bucketed', good.confirmationLatencyBucket === '5-15s');
t('the timestamp is a day bucket, not a clock reading',
  Number.isInteger(good.dayBucket) && String(good.dayBucket).length <= 6);

t('an unsupported chain is refused', obs.buildIntentObservation({ ...good, chainId: 999999 }) === null);
t('an unknown intent kind is refused', obs.buildIntentObservation({ ...good, intentKind: 'wire-transfer' }) === null);
t('an unknown outcome is refused', obs.buildIntentObservation({ ...good, outcome: 'maybe' }) === null);
t('an unknown solver degrades to "unknown" rather than leaking a name',
  obs.buildIntentObservation({ ...good, solver: 'my-private-solver-name' }).solver === 'unknown');
t('an out-of-range quote count is clamped', obs.buildIntentObservation({ ...good, quoteCount: 900 }).quoteCount === 8);
t('an unknown failure code becomes UNKNOWN_FAILURE',
  obs.buildIntentObservation({ ...good, failureCode: 'MY_CUSTOM_THING' }).failureCode === 'UNKNOWN_FAILURE');

/* ---------------------- 2. sensitive values are refused -------------------- */
const sensitiveCases = [
  ['a wallet address', { policyVersion: '0x1111111111111111111111111111111111111111' }],
  ['a transaction hash', { policyVersion: '0x' + 'ab'.repeat(32) }],
  ['calldata', { policyVersion: '0x' + 'ee'.repeat(64) }]
];
for (const [label, patch] of sensitiveCases) {
  const built = obs.buildIntentObservation({ ...good, ...patch });
  t(`${label} never reaches the payload`,
    built === null || built.policyVersion === 'unversioned');
}
t('containsSensitiveValue spots an address',
  obs.containsSensitiveValue({ a: '0x1111111111111111111111111111111111111111' }) === true);
t('containsSensitiveValue spots a tx hash',
  obs.containsSensitiveValue({ a: '0x' + 'ab'.repeat(32) }) === true);
t('containsSensitiveValue spots free text',
  obs.containsSensitiveValue({ note: 'please buy me some ETH before the weekend party' }) === true);
t('containsSensitiveValue accepts a bounded payload', obs.containsSensitiveValue(good) === false);

t('validateObservationShape accepts the built payload', obs.validateObservationShape(good).ok === true);
t('validateObservationShape rejects an extra field',
  obs.validateObservationShape({ ...good, walletAddress: '0x1' }).code === 'UNKNOWN_FIELD');

/* ---------------------- 3. the submit path needs consent ------------------- */
{
  let called = false;
  const res = await obs.submitIntentObservation(good, {
    consentToken: '',
    fetchImpl: async () => { called = true; return { ok: true, status: 202 }; }
  });
  t('without consent nothing is even attempted', res.code === 'OPT_IN_REQUIRED' && called === false);
}
{
  let sentBody = null;
  const res = await obs.submitIntentObservation(good, {
    consentToken: consent['x-telemetry-consent'],
    fetchImpl: async (_url, init) => { sentBody = JSON.parse(init.body); return { ok: true, status: 202 }; }
  });
  t('with consent the observation is posted', res.ok === true);
  t('the posted body is exactly the observation', JSON.stringify(sentBody) === JSON.stringify(good));
}
{
  const res = await obs.submitIntentObservation(good, {
    consentToken: consent['x-telemetry-consent'],
    fetchImpl: async () => { throw new Error('network down'); }
  });
  t('a transport failure is swallowed, never thrown', res.ok === false && res.code === 'TRANSPORT_FAILED');
}

/* ---------------------- 4. server-side strict validation ------------------- */
const now = Date.now();
t('the server accepts the client payload', serverObs.validateObservation(good, now).ok === true);
t('the server rejects an unknown field',
  serverObs.validateObservation({ ...good, ip: '1.2.3.4' }, now).code === 'BAD_FIELDS');
t('the server rejects a missing field',
  serverObs.validateObservation({ ...good, outcome: undefined }, now).ok === false);
t('the server rejects a wallet address in any field',
  serverObs.validateObservation({ ...good, policyVersion: '0x1111111111111111111111111111111111111111' }, now)
    .code === 'SENSITIVE_VALUE');
t('the server rejects free text',
  serverObs.validateObservation({ ...good, policyVersion: 'buy me eth before the weekend please thanks' }, now)
    .ok === false);
t('the server rejects a bad enum',
  serverObs.validateObservation({ ...good, simulationStatus: 'looked-fine' }, now).code === 'BAD_SIMULATION_STATUS');
t('the server rejects a fabricated future day bucket',
  serverObs.validateObservation({ ...good, dayBucket: good.dayBucket + 400 }, now).code === 'BAD_DAY_BUCKET');
t('the server rejects a non-integer chain',
  serverObs.validateObservation({ ...good, chainId: 42161.5 }, now).code === 'BAD_CHAIN');
t('the validated value is rebuilt field by field',
  Object.keys(serverObs.validateObservation(good, now).value).length === obs.OBSERVATION_FIELDS.length);

/* -------------------------- 5. storage fails closed ------------------------ */
{
  const stored = await serverObs.storeObservation(serverObs.validateObservation(good, now).value);
  t('with no durable store configured the write fails closed',
    stored.ok === false && stored.code === 'NOT_CONFIGURED');

  const memory = new Map();
  const io = {
    configured: () => true,
    get: async (key) => memory.get(key) ?? null,
    set: async (key, value) => { memory.set(key, value); return true; }
  };
  const okStore = await serverObs.storeObservation(serverObs.validateObservation(good, now).value, { io });
  t('with a store configured the observation is appended', okStore.ok === true && okStore.stored === 1);

  const failing = { configured: () => true, get: async () => [], set: async () => false };
  const failed = await serverObs.storeObservation(serverObs.validateObservation(good, now).value, { io: failing });
  t('a failed write is reported, not swallowed as success', failed.ok === false && failed.code === 'WRITE_FAILED');
}

/* ------------------------------ 6. real HTTP ------------------------------- */
const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;
const post = (body, headers = {}) =>
  fetch(`${base}/api/intents/v1/observations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

{
  const res = await post(good);
  t('the ingest endpoint refuses without opt-in (401)', res.status === 401);
}
{
  const res = await post(good, { 'x-telemetry-consent': 'ct1:not-a-real-token' });
  t('a malformed consent token is refused too', res.status === 401);
}
{
  const res = await post({ ...good, walletAddress: '0x1111111111111111111111111111111111111111' }, consent);
  const body = await res.json();
  t('an unknown field is rejected 400', res.status === 400 && body.error === 'BAD_FIELDS');
}
{
  const res = await post({ ...good, policyVersion: '0x' + 'ab'.repeat(32) }, consent);
  t('a tx-hash-shaped value is rejected 400', res.status === 400);
}
{
  const res = await post(good, consent);
  const body = await res.json();
  t('with no durable storage the endpoint answers 503 NOT_CONFIGURED',
    res.status === 503 && body.error === 'NOT_CONFIGURED');
}
{
  /* Budget is small in this probe; the loop proves a cap exists either way. */
  let limited = false;
  for (let i = 0; i < 40; i += 1) {
    const res = await post(good, consent);
    if (res.status === 429) { limited = true; break; }
  }
  t('the observation endpoint has its own rate-limit budget', limited);
}
{
  const res = await fetch(`${base}/api/intents/v1/capabilities`);
  const body = await res.json();
  t('capabilities declares the execution core block',
    body.executionCore?.lifecycleSchema === 'fbt.intent-lifecycle.v1'
    && body.executionCore?.simulationSchema === 'fbt.intent-simulation.v1'
    && body.executionCore?.recoverySchema === 'fbt.intent-recovery.v1'
    && body.executionCore?.observationSchema === 'fbt.intent-execution-observation.v1');
  t('capabilities keeps the honest negatives',
    body.executionCore?.serverExecutesTransactions === false
    && body.executionCore?.autonomousSpending === false
    && body.executionCore?.stateDiffSimulation === false
    && body.executionCore?.privateRelayAttested === false
    && body.executionCore?.userSignatureRequired === true);
  t('capabilities lists exactly the two route policies',
    Array.isArray(body.executionCore?.routePolicies)
    && body.executionCore.routePolicies.length === 2
    && body.executionCore.routePolicies.includes('MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1')
    && body.executionCore.routePolicies.includes('MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2'));
  t('capabilities says the exact preflight code path exists',
    body.executionCore?.exactClientRpcPreflightSupported === true);
  t('capabilities reports observation storage honestly',
    body.executionObservations?.durableStorageConfigured === false
    && body.executionObservations?.modelTrained === false
    && body.executionObservations?.acceptsWalletAddress === false);
  t('the observations endpoint is published',
    body.endpoints?.executionObservations === '/api/intents/v1/observations');
  t('the execution-observation model endpoint is published',
    body.endpoints?.executionObservationModel === '/api/intents/v1/execution-observation-model'
    && body.executionObservations?.modelEndpoint === '/api/intents/v1/execution-observation-model'
    && body.executionObservations?.modelSchema === 'fbt.intent-execution-model.v1'
    && body.executionObservations?.mlOptimizationClaimed === false);
}
{
  /* No dataset yet → the learning surface must still say model:false. */
  const res = await fetch(`${base}/api/learning/params`);
  const body = await res.json();
  t('with no trained model /api/learning/params still reports model:false', body.model === false);
}
{
  const res = await fetch(`${base}/api/intents/v1/execution-observation-model`);
  const body = await res.json();
  t('without observations the empirical model endpoint reports modelTrained:false',
    res.status === 200
    && body.schema === 'fbt.intent-execution-model.v1'
    && body.modelTrained === false
    && /s-maxage=3600/.test(res.headers.get('cache-control') ?? ''));
}

server.close();

export default rows;
