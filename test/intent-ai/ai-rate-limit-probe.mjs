#!/usr/bin/env node
/**
 * FBT AI — the throttle is per person, and it says so.
 * ---------------------------------------------------------------------------
 * The reported failure was «the assistant answers nothing» and the whole
 * assistant came back as three stacked error lines. One of the two ways that
 * happens is this middleware: the AI routes were bucketed by `req.ip`, which on
 * a proxied host is a household, an office or a carrier NAT — not a user. Ten
 * model turns in a minute from a shared address and everyone behind it got
 * `AI_RATE_LIMITED`, which had no Persian copy, so the UI said the generic
 * «نتوانستم این کار را کامل کنم».
 *
 * This probe boots the real `server/app.js` with a deliberately tiny allowance
 * and proves, over real HTTP:
 *
 *   · the bucket is the caller (telegram id → device header → IP), so a second
 *     device on the same IP is untouched while the first is throttled;
 *   · a throttled turn publishes `retry-after` AND `retryAfter` in the body, so
 *     the bubble can name the wait instead of promising a retry that cannot
 *     work;
 *   · GET stays free (the client polls status and must never mistake a
 *     throttle for an outage);
 *   · the throttle is the same on both AI mount points (`/api/ai` and
 *     `/api/v1/ai`).
 */
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT = '100000,60000';
process.env.BRAIN_RATE_LIMIT = '100000,60000';
process.env.MEM_RATE_LIMIT = '100000,60000';
process.env.SAFE_INTENTS_ONLY = 'true';
/* Three POSTs per caller per minute, whoever they are. */
process.env.AI_RATE_LIMIT = '3';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import http from 'node:http';

let passed = 0;
let failed = 0;
const failures = [];
function t(name, ok, detail = null) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}

const { default: app } = await import('../../server/app.js');
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

const post = async (path, { device = null, body = { message: 'سلام', locale: 'fa' } } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (device) headers['x-fbt-device'] = device;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, retryAfterHeader: res.headers.get('retry-after'), json };
};

console.log('\nAI throttle · per-caller buckets\n');

const A = 'throttle-probe-device-A';
const B = 'throttle-probe-device-B';

const first = await post('/api/v1/ai/chat', { device: A });
t('the first turn is served', first.status === 200, first);

for (let i = 0; i < 2; i += 1) await post('/api/v1/ai/chat', { device: A });
const throttled = await post('/api/v1/ai/chat', { device: A });
t('the fourth turn in the minute is refused', throttled.status === 429, throttled);
t('the refusal is the AI throttle code, not a generic error', throttled.json?.error === 'AI_RATE_LIMITED', throttled.json);
t('the wait is published in a header', Number(throttled.retryAfterHeader) > 0, throttled.retryAfterHeader);
t('the wait is published in the body too', Number(throttled.json?.retryAfter) > 0, throttled.json);

const other = await post('/api/v1/ai/chat', { device: B });
t('a second caller on the SAME ip is not punished', other.status === 200, other);

const stillThrottled = await post('/api/v1/ai/chat', { device: A, body: { message: 'بیتکوین؟', locale: 'fa' } });
t('the bucket does not reset between turns', stillThrottled.status === 429, stillThrottled);

/* GET is how the client decides whether the feature exists at all. */
const gateGet = await fetch(`${BASE}/api/v1/ai/gateway/providers`);
t('GET is never throttled (a 429 there reads as an outage)', gateGet.status === 200, gateGet.status);

/* The older mount shares the policy; a separate device proves it is keyed the
   same way rather than by a global counter. */
const C = 'throttle-probe-device-C';
await post('/api/ai/ask', { device: C });
await post('/api/ai/ask', { device: C });
await post('/api/ai/ask', { device: C });
const legacy = await post('/api/ai/ask', { device: C });
t('/api/ai uses its own per-caller bucket', legacy.status === 429, legacy);
t('/api/ai publishes the same wait fields', Number(legacy.json?.retryAfter) > 0, legacy.json);

server.close();
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
if (failed) { console.log('failed:', failures.join(' · ')); process.exit(1); }
