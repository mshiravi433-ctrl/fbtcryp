/**
 * EXECUTION-OBSERVATION MODEL PROBE — pure trainer + injectable I/O.
 * ---------------------------------------------------------------------------
 * The durable `intent-observations:*` dataset is now written; this is the
 * trainer that actually consumes it. The suite is hostile on purpose:
 *
 *   · no data / thin data → modelTrained stays false (fail closed)
 *   · ≥50 records AND one route with ≥5 samples is the only way it flips
 *   · rates are empirical counts, never a classifier or an LLM
 *   · injected `io` never writes the shared memoryStore (no leak into the
 *     later HTTP probes that assert modelTrained:false)
 */

import { memoryStore } from '../server/cache.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const {
  EXEC_MODEL_SCHEMA,
  EXEC_MODEL_STORE_KEY,
  EXEC_OBS_CACHE_KEY,
  MIN_EXEC_TRAIN,
  MIN_EXEC_ROUTE_SAMPLES,
  buildExecObservationModel,
  clearExecServingCache,
  emptyExecModel,
  getExecServingParams,
  isTrainableObservation,
  runExecObservationTraining,
  sanitizeExecModel
} = await import('../server/learning/execObservation.js');
const { storeObservation, validateObservation } = await import('../server/intentObservation.js');

clearExecServingCache();

const DAY_MS = 24 * 3600 * 1000;
const now = Date.now();
const today = Math.floor(now / DAY_MS);

const CHAINS = [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144];
const SOLVERS = ['kyberswap', 'openocean', 'velora', 'direct-router', 'unknown'];
const POLICIES = [
  'MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1',
  'MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2'
];

function makeObs(overrides = {}) {
  return {
    schema: 'fbt.intent-execution-observation.v1',
    intentKind: 'swap',
    chainId: 42161,
    routePolicy: POLICIES[0],
    solver: 'kyberswap',
    quoteCount: 3,
    hopCount: 2,
    simulationStatus: 'passed',
    gasEstimateBucket: '100k-250k',
    gasErrorBpsBucket: '50-200',
    outputErrorBpsBucket: 'lte10',
    confirmationLatencyBucket: '5-15s',
    failureCode: 'NONE',
    outcome: 'completed',
    policyVersion: 'fbt.intent-lifecycle-policy.v1',
    dayBucket: today,
    ...overrides
  };
}

function fakeIo() {
  const memory = new Map();
  return {
    memory,
    configured: () => true,
    get: async (key) => memory.get(key) ?? null,
    set: async (key, value) => { memory.set(key, value); return true; }
  };
}

/* 1–2. empty / below the record floor ------------------------------------ */
{
  const empty = buildExecObservationModel([], { now });
  t('empty dataset publishes modelTrained:false', empty.modelTrained === false);
  t('empty dataset names NOT_ENOUGH_DATA', empty.reason === 'NOT_ENOUGH_DATA' && empty.records === 0);

  const thin = buildExecObservationModel(
    Array.from({ length: MIN_EXEC_TRAIN - 1 }, () => makeObs()),
    { now }
  );
  t(`${MIN_EXEC_TRAIN - 1} records (same route) still fail closed`,
    thin.modelTrained === false && thin.records === MIN_EXEC_TRAIN - 1);
}

/* 3. enough records, every route unique (n=1) — still untrained ---------- */
{
  const unique = Array.from({ length: MIN_EXEC_TRAIN }, (_, i) => makeObs({
    chainId: CHAINS[i % CHAINS.length],
    solver: SOLVERS[Math.floor(i / CHAINS.length) % SOLVERS.length],
    routePolicy: POLICIES[Math.floor(i / (CHAINS.length * SOLVERS.length)) % POLICIES.length],
    outcome: i % 3 === 0 ? 'failed' : 'completed'
  }));
  /* Force uniqueness even if the combinatorics wrap: bump hopCount is illegal
     for identity, so we also vary quoteCount which is not part of the route key.
     Route identity is chain×policy×solver — 9×5×2 = 90 slots, so 50 is unique. */
  const model = buildExecObservationModel(unique, { now });
  t('50 unique n=1 routes do not train (need a path with ≥5 samples)',
    model.records === MIN_EXEC_TRAIN
      && model.routes.every((r) => r.n < MIN_EXEC_ROUTE_SAMPLES)
      && model.modelTrained === false);
}

/* 4–6. enough records AND one fat route → trained, honest rates ---------- */
{
  const fat = Array.from({ length: MIN_EXEC_TRAIN }, (_, i) => makeObs({
    outcome: i < 40 ? 'completed' : 'failed',
    failureCode: i < 40 ? 'NONE' : 'QUOTE_EXPIRED',
    gasEstimateBucket: i < 10 ? 'lt100k' : '100k-250k',
    outputErrorBpsBucket: i < 5 ? '50-200' : 'lte10',
    confirmationLatencyBucket: i < 8 ? 'lt5s' : '5-15s'
  }));
  const model = buildExecObservationModel(fat, { now });
  t('50 records on one route with ≥5 samples trains the model',
    model.modelTrained === true && model.reason === 'OK' && model.schema === EXEC_MODEL_SCHEMA);
  t('completionRate is completed/records (40/50 = 0.8)',
    model.completionRate === 0.8
      && model.outcomes.completed === 40
      && model.outcomes.failed === 10);
  t('the fat route carries n, completionRate and the three outcomes',
    model.routes.length === 1
      && model.routes[0].n === MIN_EXEC_TRAIN
      && model.routes[0].chainId === 42161
      && model.routes[0].solver === 'kyberswap'
      && model.routes[0].completed === 40
      && model.routes[0].failed === 10
      && model.routes[0].completionRate === 0.8);
}

/* 7–10. frequencies follow the buckets we fed ----------------------------- */
{
  const fat = Array.from({ length: MIN_EXEC_TRAIN }, (_, i) => makeObs({
    outcome: i < 40 ? 'completed' : 'failed',
    failureCode: i < 40 ? 'NONE' : 'QUOTE_EXPIRED',
    gasEstimateBucket: i < 10 ? 'lt100k' : '100k-250k',
    outputErrorBpsBucket: i < 5 ? '50-200' : 'lte10',
    confirmationLatencyBucket: i < 8 ? 'lt5s' : '5-15s'
  }));
  const model = buildExecObservationModel(fat, { now });
  t('failureCodes count NONE and QUOTE_EXPIRED',
    model.failureCodes.NONE === 40 && model.failureCodes.QUOTE_EXPIRED === 10);
  t('gasEstimate buckets are counted, not averaged',
    model.gasEstimate.lt100k === 10 && model.gasEstimate['100k-250k'] === 40);
  t('outputErrorBps buckets are counted',
    model.outputErrorBps['50-200'] === 5 && model.outputErrorBps.lte10 === 45);
  t('confirmationLatency buckets are counted',
    model.confirmationLatency.lt5s === 8 && model.confirmationLatency['5-15s'] === 42);
}

/* 11. honesty claims stay false — this is a description, not a optimiser -- */
{
  const model = buildExecObservationModel(
    Array.from({ length: MIN_EXEC_TRAIN }, () => makeObs()),
    { now }
  );
  t('the published model claims neither classifier, LLM, MEV, atomicity nor escrow',
    model.claims.classifier === false
      && model.claims.llm === false
      && model.claims.mevProtection === false
      && model.claims.atomicCrossChain === false
      && model.claims.escrow === false
      && model.claims.routeOptimization === false);
}

/* 12. malformed / extra-field / address-shaped rows are skipped ----------- */
{
  const good = Array.from({ length: 10 }, () => makeObs());
  const junk = [
    { ...makeObs(), walletAddress: '0x1111111111111111111111111111111111111111' },
    { ...makeObs(), extra: true },
    { schema: 'nope' },
    null,
    'not-an-object',
    makeObs({ policyVersion: '0x' + 'ab'.repeat(32) })
  ];
  const model = buildExecObservationModel([...good, ...junk], { now });
  t('malformed and sensitive rows are skipped, never counted',
    model.records === 10
      && !JSON.stringify(model).includes('0x1111')
      && !JSON.stringify(model).includes('walletAddress'));
}

/* 13. no store → skipped, never throws ----------------------------------- */
{
  const io = { configured: () => false, get: async () => { throw new Error('should not read'); }, set: async () => { throw new Error('should not write'); } };
  const out = await runExecObservationTraining({ now, io });
  t('with no store the trainer skips closed (NO_STORE)',
    out.skipped === 'NO_STORE' && out.modelTrained === false);
}

/* 14. end-to-end: storeObservation → trainer → published model ------------ */
{
  const io = fakeIo();
  for (let i = 0; i < MIN_EXEC_TRAIN; i += 1) {
    const checked = validateObservation(makeObs({ outcome: i < 45 ? 'completed' : 'cancelled' }), now);
    const stored = await storeObservation(checked.value, { io });
    if (!stored.ok) throw new Error(`store failed: ${stored.code}`);
  }
  const beforeCache = memoryStore.get(EXEC_OBS_CACHE_KEY);
  const out = await runExecObservationTraining({ now, io });
  t('training against the real day-bucket store publishes a trained model',
    out.ok === true && out.modelTrained === true && out.records === MIN_EXEC_TRAIN);
  const published = await io.get(EXEC_MODEL_STORE_KEY);
  t('the published blob is the v1 schema with sample counts',
    published?.schema === EXEC_MODEL_SCHEMA
      && published.modelTrained === true
      && published.routes[0]?.n === MIN_EXEC_TRAIN
      && published.outcomes.cancelled === 5);
  t('injected io never writes the shared memoryStore (no leak into later HTTP probes)',
    memoryStore.get(EXEC_OBS_CACHE_KEY) === beforeCache);
}

/* 15–16. serving path with injected io, still no cache leak --------------- */
{
  const io = fakeIo();
  const trained = buildExecObservationModel(
    Array.from({ length: MIN_EXEC_TRAIN }, () => makeObs()),
    { now }
  );
  await io.set(EXEC_MODEL_STORE_KEY, trained);
  const before = memoryStore.get(EXEC_OBS_CACHE_KEY);
  const snap = await getExecServingParams({ io });
  t('getExecServingParams reads the published model through injected io',
    snap.model?.modelTrained === true
      && snap.model?.schema === EXEC_MODEL_SCHEMA
      && snap.model?.records === MIN_EXEC_TRAIN);
  t('serving through injected io still leaves the shared cache untouched',
    memoryStore.get(EXEC_OBS_CACHE_KEY) === before);
}

/* 17. emptyExecModel / trainable helper ---------------------------------- */
{
  t('emptyExecModel is untrained with zero records',
    emptyExecModel({ now }).modelTrained === false
      && emptyExecModel({ now }).records === 0
      && emptyExecModel({ now }).schema === EXEC_MODEL_SCHEMA);
  t('isTrainableObservation accepts a client-shaped row and rejects junk',
    isTrainableObservation(makeObs()) === true
      && isTrainableObservation({ ...makeObs(), chainId: 999 }) === false);
}

/* 18. thin sibling routes stay listed (honesty about the sample) ---------- */
{
  const fat = Array.from({ length: MIN_EXEC_TRAIN }, () => makeObs());
  const thin = Array.from({ length: 2 }, () => makeObs({ solver: 'openocean', outcome: 'failed' }));
  const model = buildExecObservationModel([...fat, ...thin], { now });
  const oo = model.routes.find((r) => r.solver === 'openocean');
  t('a 2-sample sibling route is listed with its n rather than dropped',
    model.modelTrained === true
      && oo?.n === 2
      && oo.failed === 2
      && oo.completionRate === 0);
}

/* 19. the floors themselves are the documented 50 and 5 ------------------- */
t('training floors are 50 records and 5 samples on a route',
  MIN_EXEC_TRAIN === 50 && MIN_EXEC_ROUTE_SAMPLES === 5);

/* 20. a poisoned Blob cannot smuggle identifiers through serving ---------- */
{
  const trained = buildExecObservationModel(
    Array.from({ length: MIN_EXEC_TRAIN }, () => makeObs()),
    { now }
  );
  const poisoned = {
    ...trained,
    walletAddress: '0x1111111111111111111111111111111111111111',
    note: 'please-optimise-my-route',
    claims: { ...trained.claims, routeOptimization: true, mevProtection: true }
  };
  const cleaned = sanitizeExecModel(poisoned, { now });
  t('sanitizeExecModel drops unknown keys and restores honest claims',
    cleaned.modelTrained === true
      && cleaned.records === MIN_EXEC_TRAIN
      && !('walletAddress' in cleaned)
      && !('note' in cleaned)
      && cleaned.claims.routeOptimization === false
      && cleaned.claims.mevProtection === false
      && !JSON.stringify(cleaned).includes('0x1111'));

  const io = fakeIo();
  await io.set(EXEC_MODEL_STORE_KEY, poisoned);
  const snap = await getExecServingParams({ io });
  t('serving a poisoned blob still cannot smuggle identifiers or flip claims',
    snap.model?.modelTrained === true
      && !('walletAddress' in (snap.model ?? {}))
      && snap.model?.claims?.routeOptimization === false
      && !JSON.stringify(snap.model).includes('0x1111'));
}

clearExecServingCache();

export default rows;
