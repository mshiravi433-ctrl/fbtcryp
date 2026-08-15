/**
 * LEARNING API PROBE — real HTTP against the real server/app.js.
 *
 * What only an HTTP test can pin:
 *   · a telemetry payload without the opt-in consent token is rejected 401
 *     no matter how well-formed it is;
 *   · the /api/learning/event endpoint is rate-limited independently of the
 *     broad API budget (1 Hz sustained; this probe shrinks the window budget
 *     via env to keep the test fast);
 *   · /api/learning/params on a warm cache is an in-memory read — the
 *     serving function itself answers in well under a millisecond;
 *   · /api/health carries the learning block with the honest fallback shape
 *     when Blob is not configured;
 *   · with no BLOB_READ_WRITE_TOKEN the learning routes answer their
 *     "not configured" shapes and nothing crashes — the module is no-ops,
 *     exactly like blobCache.js's configured() pattern.
 */

// Env BEFORE the app import: the learning limiter reads its budget at load.
// When another probe already imported app.js (module cache), the default
// budget of 60/min applies instead — the rate-limit loop below covers both.
process.env.LEARNING_EVENT_RATE_LIMIT = '3';
delete process.env.BLOB_READ_WRITE_TOKEN; // force the not-configured path

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { default: app } = await import('../server/app.js');

const server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

const goodEvent = {
  coinId: 'bitcoin',
  horizon: 'short',
  predictedStance: 'mildUp',
  predictedConfidence: 55,
  predictedRaw: 12,
  regime: 'riskOn',
  layersHash: 'hc',
  clientTs: Date.now()
};
const consent = { 'x-telemetry-consent': 'ct1:' + '0123456789abcdef'.repeat(2) };

/* 1. opt-in enforcement: no consent token → 401, well-formed or not. */
{
  const res = await post('/api/learning/event', goodEvent);
  t('a telemetry payload without the opt-in token is rejected 401', res.status === 401);
  const bad = await post('/api/learning/event', goodEvent, { 'x-telemetry-consent': 'ct1:not-hex' });
  t('a malformed consent token is rejected 401 too', bad.status === 401);
}

/* 2. with consent but Blob off: honest 503 NOT_CONFIGURED, no crash. */
{
  const res = await post('/api/learning/event', goodEvent, consent);
  const body = await res.json();
  t('with Blob unconfigured the event endpoint answers 503 NOT_CONFIGURED',
    res.status === 503 && body.error === 'NOT_CONFIGURED');
}

/* 3. rate limit: the endpoint has its own 1 Hz budget. 70 requests covers
   both the env-shrunk budget (3) and the default (60/min = 1 Hz). The
   learning limiter is checked BEFORE the module guard, so the 429 fires
   even with Blob off — a flood cannot reach the ingest path at all. */
{
  let limited = false;
  for (let i = 0; i < 70 && !limited; i += 1) {
    const res = await post('/api/learning/event', goodEvent, consent);
    if (res.status === 429) {
      const body = await res.json();
      limited = body.error === 'LEARNING_RATE_LIMITED' && res.headers.get('retry-after') != null;
    }
  }
  t('the event endpoint rate-limits at its own 1 Hz budget with retry-after', limited);
}

/* 4. params endpoint: correct shape + edge cache header + warm-path speed. */
{
  const first = await fetch(base + '/api/learning/params');
  const body = await first.json();
  t('params endpoint answers the model:false shape when nothing is published',
    first.status === 200 && body.model === false && body.params === null);
  t('params endpoint sets s-maxage for the edge',
    /s-maxage=3600/.test(first.headers.get('cache-control') ?? ''));

  // The serving read itself (what every request after the first hits) must
  // be an in-memory lookup: <1 ms averaged over a hundred calls.
  const { getServingParams } = await import('../server/learning/params.js');
  await getServingParams(); // warm (resolves the cached no-blob snapshot)
  const started = performance.now();
  for (let i = 0; i < 100; i += 1) await getServingParams();
  const perCall = (performance.now() - started) / 100;
  t(`a warm params read is an in-memory hit under 1 ms (${perCall.toFixed(3)} ms)`, perCall < 1);
}

/* 5. health: the learning block rides the existing endpoint. */
{
  const res = await fetch(base + '/api/health');
  const body = await res.json();
  t('health exposes the learning block with the honest fallback shape',
    body.ok === true
      && body.learning
      && body.learning.enabled === false
      && body.learning.fallback === true
      && body.learning.optInCount === 0
      && body.learning.recordCount === 0);
}

/* 6. telemetry v1 endpoints also refuse without consent (regression). */
{
  const res = await post('/api/telemetry/signal', { t: 's' });
  t('the v1 signal endpoint still refuses without consent', res.status === 401);
}

server.close();

export default rows;
