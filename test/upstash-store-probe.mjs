import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalEnv = {
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  blob: process.env.BLOB_READ_WRITE_TOKEN
};

const values = new Map();
const calls = [];
process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test_token_that_is_long_enough_for_validation';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_old_paused_token_value';

globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), command: JSON.parse(options.body || '[]') });
  assert.equal(url, 'https://example.upstash.io');
  assert.match(options.headers.authorization, /^Bearer /);
  const [command, key, value] = JSON.parse(options.body);
  if (command === 'SET') {
    values.set(key, value);
    return { ok: true, json: async () => ({ result: 'OK' }) };
  }
  if (command === 'GET') {
    return { ok: true, json: async () => ({ result: values.get(key) ?? null }) };
  }
  return { ok: true, json: async () => ({ result: null }) };
};

const results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? '✓' : '✗'} ${name}`); };

try {
  const store = await import(`../server/blobCache.js?upstash-probe=${Date.now()}`);
  const status = store.durableBackendStatus();
  check('Upstash configuration makes the store durable', store.blobConfigured() && store.upstashConfigured());
  check('Upstash is preferred even while the paused Blob token remains', status.preferred === 'upstash-redis' && status.vercelBlob === true);
  check('public status contains no REST token or URL', !JSON.stringify(status).includes(process.env.UPSTASH_REDIS_REST_TOKEN) && !JSON.stringify(status).includes('example.upstash.io'));

  const written = await store.blobSet('probe:key', { working: true }, 60_000);
  const read = await store.blobGet('probe:key');
  check('a value round-trips through Upstash REST', written === true && read?.working === true);
  check('SET uses an expiry rather than leaving permanent cache data', calls[0]?.command?.[3] === 'EX' && Number(calls[0]?.command?.[4]) >= 60);
  check('no Vercel Blob request occurs when Upstash is configured', calls.every((row) => row.url === 'https://example.upstash.io'));
  check('one SET and one GET are sufficient', calls.length === 2 && calls[0].command[0] === 'SET' && calls[1].command[0] === 'GET');
} catch (error) {
  check(`unexpected error: ${error.message}`, false);
} finally {
  globalThis.fetch = originalFetch;
  if (originalEnv.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = originalEnv.url;
  if (originalEnv.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = originalEnv.token;
  if (originalEnv.blob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = originalEnv.blob;
}

const failed = results.filter((row) => !row.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
export default results;
