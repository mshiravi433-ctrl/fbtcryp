/**
 * Wallex proxy probe — the Iranians-only buy/sell tab stands on REAL rails.
 *
 * No network: every upstream call is injected. The probe proves:
 *   1. public market routes pass the Wallex envelope through untouched
 *   2. private routes WITHOUT any key fail closed (WALLEX_KEY_REQUIRED)
 *      and never reach the upstream
 *   3. the user's x-wallex-key header wins and is forwarded as x-api-key
 *   4. the env key exists only behind the explicit WALLEX_SERVER_KEY_ALLOW
 *      opt-in, is trimmed (env-store newline trap), and the header overrides it
 *   5. order bodies are validated BEFORE the upstream (bad side/quantity/price)
 *   6. an upstream network failure becomes WALLEX_UNREACHABLE (502), not a crash
 *   7. the key is NEVER echoed back — any upstream response containing it is
 *      discarded
 *   8. markets normalize: TMN pairs first, ranked by 24h quote volume
 *   9. the order limiter bites at its budget
 *  10. the tab is gated to Persian at the source: Buy.jsx renders the third
 *      tab only for /^fa/ and WallexPanel double-locks with the same gate
 *  11. every buy.wallex.* key used by the panel exists in ALL 12 locales
 *  12. the tab has light-theme overrides (the owner's "no theme bugs" rule)
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  wallexUpstream,
  resolveWallexKey,
  validateWallexOrderBody,
  validateWallexOtcBody,
  normalizeWallexMarkets,
  createWallexOrderLimiter
} from '../server/wallex.js';

const tests = [];
async function test(name, fn) {
  try { await fn(); tests.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (e) { tests.push({ name, ok: false }); console.error(`✗ ${name}: ${e.message}`); }
}

const JSON_FETCH = (payload, status = 200) => async () => ({ status, json: async () => payload });
const SPY = (payload) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return { status: 200, json: async () => payload };
  };
  return { calls, impl };
};

await test('public markets pass the Wallex envelope through, with no auth header', async () => {
  const spy = SPY({ success: true, result: { symbols: {} } });
  const out = await wallexUpstream('markets', { fetchImpl: spy.impl });
  assert.equal(out.status, 200);
  assert.equal(out.body.success, true);
  assert.equal(spy.calls.length, 1);
  assert.ok(!spy.calls[0].init.headers['x-api-key']);
  assert.ok(String(spy.calls[0].url).startsWith('https://api.wallex.ir/v1/markets'));
});

await test('private routes without any key fail closed and never reach the upstream', async () => {
  let called = 0;
  const out = await wallexUpstream('balances', { fetchImpl: async () => { called += 1; return JSON_FETCH({}); } });
  assert.equal(out.status, 401);
  assert.equal(out.body.error, 'WALLEX_KEY_REQUIRED');
  assert.equal(called, 0);
});

await test('the user header wins and is forwarded as x-api-key', async () => {
  const spy = SPY({ success: true, result: { balances: {} } });
  const out = await wallexUpstream('balances', { headerKey: 'user-key-123', fetchImpl: spy.impl });
  assert.equal(out.status, 200);
  assert.equal(spy.calls[0].init.headers['x-api-key'], 'user-key-123');
  assert.equal(out.body.wallexKeySource, 'user');
});

await test('the env key exists only behind the explicit opt-in, is trimmed, and the header overrides it', async () => {
  assert.equal(resolveWallexKey('', { WALLEX_API_KEY: 'srv', WALLEX_SERVER_KEY_ALLOW: 'true' }).source, 'server');
  assert.equal(resolveWallexKey('', { WALLEX_API_KEY: 'srv' }).source, 'none');
  const trimmed = resolveWallexKey('', { WALLEX_API_KEY: 'srv\n', WALLEX_SERVER_KEY_ALLOW: 'true\n' });
  assert.equal(trimmed.key, 'srv');
  assert.equal(resolveWallexKey('user', { WALLEX_API_KEY: 'srv', WALLEX_SERVER_KEY_ALLOW: 'true' }).source, 'user');
  const spy = SPY({ success: true });
  await wallexUpstream('balances', { headerKey: '', env: { WALLEX_API_KEY: 'srv-key', WALLEX_SERVER_KEY_ALLOW: 'true' }, fetchImpl: spy.impl });
  assert.equal(spy.calls[0].init.headers['x-api-key'], 'srv-key');
});

await test('order bodies are validated before the upstream sees them', async () => {
  let called = 0;
  const fail = async () => { called += 1; return JSON_FETCH({}); };
  assert.equal((await wallexUpstream('placeOrder', { body: { symbol: 'BTCUSDT', type: 'LIMIT', side: 'SIDEWAYS', price: '1', quantity: '1' }, headerKey: 'k', fetchImpl: fail })).body.error, 'WALLEX_BAD_SIDE');
  assert.equal((await wallexUpstream('placeOrder', { body: { symbol: 'BTCUSDT', type: 'LIMIT', side: 'BUY', price: '-3', quantity: '1' }, headerKey: 'k', fetchImpl: fail })).body.error, 'WALLEX_BAD_PRICE');
  assert.equal((await wallexUpstream('placeOrder', { body: { symbol: 'BTCUSDT', type: 'LIMIT', side: 'BUY', quantity: '1' }, headerKey: 'k', fetchImpl: fail })).body.error, 'WALLEX_BAD_PRICE');
  assert.equal((await wallexUpstream('placeOtc', { body: { symbol: 'BTCUSDT', side: 'BUY', amount: '0' }, headerKey: 'k', fetchImpl: fail })).body.error, 'WALLEX_BAD_AMOUNT');
  assert.equal((await wallexUpstream('placeOrder', { body: { symbol: 'x!', type: 'LIMIT', side: 'BUY', price: '1', quantity: '1' }, headerKey: 'k', fetchImpl: fail })).body.error, 'WALLEX_BAD_SYMBOL');
  assert.equal(called, 0);
  const good = validateWallexOrderBody({ symbol: 'btctmn', type: 'LIMIT', side: 'buy', price: '6100000', quantity: '0.01' });
  assert.equal(good.ok, true);
  assert.equal(good.body.symbol, 'BTCTMN');
  assert.equal(validateWallexOtcBody({ symbol: 'BTCUSDT', side: 'SELL', amount: '0.2' }).ok, true);
});

await test('an upstream network failure becomes WALLEX_UNREACHABLE, not a crash', async () => {
  const out = await wallexUpstream('markets', { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(out.status, 502);
  assert.equal(out.body.error, 'WALLEX_UNREACHABLE');
});

await test('the key is never echoed back, even if upstream reflects it', async () => {
  const out = await wallexUpstream('balances', { headerKey: 'SECRET-KEY', fetchImpl: JSON_FETCH({ success: true, echo: 'your key is SECRET-KEY oops' }) });
  assert.equal(out.status, 502);
  assert.equal(out.body.error, 'WALLEX_BAD_RESPONSE');
  assert.equal(JSON.stringify(out.body).includes('SECRET-KEY'), false);
});

await test('markets normalize: TMN first by volume, then USDT', () => {
  const rows = normalizeWallexMarkets({
    ETHUSDT: { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', stats: { lastPrice: '3000', '24h_quoteVolume': '900' } },
    USDTTMN: { symbol: 'USDTTMN', baseAsset: 'USDT', quoteAsset: 'TMN', stats: { lastPrice: '58000', '24h_quoteVolume': '50' } },
    BTCTMN: { symbol: 'BTCTMN', baseAsset: 'BTC', quoteAsset: 'TMN', stats: { lastPrice: '5800000000', '24h_quoteVolume': '5000' } }
  });
  assert.deepEqual(rows.map((r) => r.symbol), ['BTCTMN', 'USDTTMN', 'ETHUSDT']);
  assert.equal(rows[0].minQty, 0);
});

await test('the order limiter bites at its budget', () => {
  const allow = createWallexOrderLimiter({ max: 3, windowMs: 60_000 });
  assert.equal(allow('caller-1'), true);
  assert.equal(allow('caller-1'), true);
  assert.equal(allow('caller-1'), true);
  assert.equal(allow('caller-1'), false);
  assert.equal(allow('caller-2'), true);
});

await test('the tab is gated to Persian at the source (Buy.jsx + double lock in the panel)', () => {
  const buy = readFileSync('src/pages/Buy.jsx', 'utf8');
  assert.ok(buy.includes("/^fa\\b/i.test(String(i18n.language"), 'Buy.jsx must test the LIVE i18n language');
  assert.ok(buy.includes("isFa ? ['internal', 'external', 'wallex'] : ['internal', 'external']"), 'third tab only for fa');
  assert.ok(buy.includes("if (key === 'wallex' && !isFa) return;"), 'setWalletTab refuses wallex for non-fa');
  assert.ok(buy.includes("walletTab === 'wallex' && isFa"), 'render branch double-checks the gate');
  const panel = readFileSync('src/components/WallexPanel.jsx', 'utf8');
  assert.ok(panel.includes("if (!isFa) return null;"), 'panel refuses to render for non-fa');
});

await test('every buy.wallex.* key used by the panel exists in ALL 12 locales', () => {
  const used = [...readFileSync('src/components/WallexPanel.jsx', 'utf8').matchAll(/t\('buy\.wallex\.([A-Za-z0-9_.]+)'/g)].map((m) => m[1]);
  const tabUsed = ['wallex'];
  assert.ok(used.length >= 30, `panel should use many keys, found ${used.length}`);
  for (const file of readdirSync('src/i18n/locales').filter((f) => f.endsWith('.json'))) {
    const locale = JSON.parse(readFileSync(`src/i18n/locales/${file}`, 'utf8'));
    for (const key of used) {
      const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), locale.buy?.wallex ?? {});
      assert.ok(value !== undefined, `${file}: missing buy.wallex.${key}`);
    }
    for (const key of tabUsed) {
      assert.ok(locale.buy?.walletTabs?.[key], `${file}: missing buy.walletTabs.${key}`);
    }
  }
});

await test('the tab carries light-theme overrides (no theme bugs)', () => {
  const css = readFileSync('src/styles/lab-modern.css', 'utf8');
  const count = (css.match(/:root\[data-theme='light'\] \.wallex-/g) || []).length;
  assert.ok(count >= 8, `expected a full light-theme block for .wallex-*, found ${count} rules`);
});

/* When imported by test/run.mjs, hand the rows over and let the runner keep
   going; process.exit here would kill the whole shared suite process. */
export default tests.map((t) => [t.name, t.ok]);

import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let failed = 0;
  for (const t of tests) if (!t.ok) failed += 1;
  console.log(`\nwallex-proxy: ${tests.length - failed}/${tests.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}
