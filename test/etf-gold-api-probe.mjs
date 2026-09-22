#!/usr/bin/env node
/**
 * ETF/Gold HTTP API contract + regression on /api/health, /api/news, /api/markets.
 * Boots the real Express app with a mocked Alpha Vantage upstream.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT = '100000';
process.env.AI_RATE_LIMIT = '100000';
process.env.BRAIN_RATE_LIMIT = '100000';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.ALPHA_VANTAGE_API_KEY;

const rows = [];
const t = (name, ok, detail = '') => rows.push([name, Boolean(ok), ok ? '' : String(detail).slice(0, 200)]);

const originalFetch = globalThis.fetch;
const sampleQuote = (sym) => ({
  'Global Quote': {
    '01. symbol': sym,
    '02. open': '10',
    '03. high': '11',
    '04. low': '9',
    '05. price': '10.5',
    '06. volume': '1000',
    '07. latest trading day': '2026-03-20',
    '08. previous close': '10',
    '09. change': '0.5',
    '10. change percent': '5.0000%'
  }
});

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('alphavantage.co')) {
    if (u.includes('apikey=') && process.env.ALPHA_VANTAGE_API_KEY && u.includes(process.env.ALPHA_VANTAGE_API_KEY)) {
      /* outbound only */
    }
    if (u.includes('GLOBAL_QUOTE')) {
      const sym = new URL(u).searchParams.get('symbol') || 'IBIT';
      return new Response(JSON.stringify(sampleQuote(sym)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('ETF_PROFILE')) {
      const sym = new URL(u).searchParams.get('symbol') || 'IBIT';
      return new Response(JSON.stringify({ symbol: sym, name: `${sym} Fund`, net_assets: '1000', expense_ratio: '0.2' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('GOLD_SILVER_SPOT')) {
      return new Response(JSON.stringify({ price: 2650.25, unit: 'USD per troy ounce' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('GOLD_SILVER_HISTORY')) {
      return new Response(JSON.stringify({ 'Time Series (Daily)': { '2026-03-20': { '4. close': '2650.25' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ 'Error Message': 'bad' }), { status: 200 });
  }
  /* Pass through other hosts? For app boot we mostly avoid them; return empty. */
  if (typeof originalFetch === 'function') {
    try { return await originalFetch(url, opts); } catch { /* fall through */ }
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { createServer } = await import('node:http');
const appModule = await import('../server/app.js');
const app = appModule.default;
const server = createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function req(path) {
  const res = await fetch(`${origin}${path}`, { headers: { accept: 'application/json' } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 120) }; }
  return { status: res.status, json, text, headers: res.headers };
}

/* ── regression: existing healthy endpoints ─────────────────────────────── */
const health = await req('/api/health');
t('/api/health still 200', health.status === 200 && health.json?.ok === true, JSON.stringify(health.json).slice(0, 100));

const news = await req('/api/news');
t('/api/news responds (200 or cached shape)', news.status === 200 || news.status === 502, `status=${news.status}`);

const markets = await req('/api/markets?per_page=5');
t('/api/markets responds', markets.status === 200 || markets.status === 502, `status=${markets.status}`);

/* ── unconfigured ETF/Gold ──────────────────────────────────────────────── */
const etfOff = await req('/api/etf');
t('GET /api/etf without key → 503 PROVIDER_NOT_CONFIGURED', etfOff.status === 503 && etfOff.json?.error === 'PROVIDER_NOT_CONFIGURED');
t('unconfigured body has no fake rows', !Array.isArray(etfOff.json?.rows) || etfOff.json.rows.length === 0 || etfOff.json.ok === false);
t('unconfigured message is clear', /تنظیم نشده|not configured|PROVIDER_NOT_CONFIGURED/i.test(JSON.stringify(etfOff.json)));

const goldOff = await req('/api/gold/spot');
t('GET /api/gold/spot without key → 503', goldOff.status === 503 && goldOff.json?.error === 'PROVIDER_NOT_CONFIGURED');

const statusOff = await req('/api/etf/status');
t('GET /api/etf/status reports UNAVAILABLE without key', statusOff.status === 200 && statusOff.json?.status === 'UNAVAILABLE');

/* ── configure key and exercise happy path ──────────────────────────────── */
process.env.ALPHA_VANTAGE_API_KEY = 'probe-api-key-do-not-leak-xyz';
const { _resetAlphaVantageForTests } = await import('../server/providers/alphaVantage.js');
_resetAlphaVantageForTests();

const etfOn = await req('/api/etf?category=bitcoin');
t('GET /api/etf with key returns ok rows', etfOn.status === 200 && etfOn.json?.ok === true && Array.isArray(etfOn.json.rows) && etfOn.json.rows.length > 0, JSON.stringify({ status: etfOn.status, err: etfOn.json?.error, n: etfOn.json?.rows?.length }).slice(0, 120));
t('etf response meta has provider+schema+fetchedAt', etfOn.json?.meta?.provider === 'alpha-vantage' && etfOn.json?.meta?.schema && etfOn.json?.meta?.fetchedAt);
t('etf response never contains the API key', !etfOn.text.includes('probe-api-key-do-not-leak-xyz'));
t('etf rows are readOnly executes false', etfOn.json.rows.every((r) => r.executes === false && r.readOnly === true));
t('bitcoin category has no ethereum symbols', etfOn.json.rows.every((r) => r.category === 'bitcoin'));

const one = await req('/api/etf/IBIT');
t('GET /api/etf/IBIT returns quote', one.status === 200 && one.json?.quote?.symbol === 'IBIT' && one.json?.quote?.priceUsd === 10.5);

const prof = await req('/api/etf/IBIT/profile');
t('GET /api/etf/IBIT/profile returns profile', prof.status === 200 && prof.json?.profile?.symbol === 'IBIT');

const bad = await req('/api/etf/AAPL');
t('GET /api/etf/AAPL (not allowlisted) fails closed', bad.status === 400 || bad.json?.error === 'SYMBOL_NOT_ALLOWLISTED' || bad.json?.ok === false);

const goldOn = await req('/api/gold/spot');
t('GET /api/gold/spot returns XAU USD/oz', goldOn.status === 200 && goldOn.json?.spot?.symbol === 'XAU' && goldOn.json?.spot?.priceUsd === 2650.25 && /troy/i.test(goldOn.json?.spot?.unitLabel || goldOn.json?.spot?.unit || ''));

const hist = await req('/api/gold/history?interval=daily');
t('GET /api/gold/history returns points', hist.status === 200 && hist.json?.history?.count >= 1);

const statusOn = await req('/api/etf/status');
t('status after probe is not UNAVAILABLE', statusOn.json?.status !== 'UNAVAILABLE' && statusOn.json?.configured === true, JSON.stringify(statusOn.json).slice(0, 120));

/* second list call should be cache hit (no key leak still) */
const etf2 = await req('/api/etf?category=bitcoin');
t('second /api/etf still ok (cache path)', etf2.status === 200 && etf2.json?.ok === true);
t('cached response meta.cached or fresh still has schema', Boolean(etf2.json?.meta?.schema));

/* cleanup */
server.close();
globalThis.fetch = originalFetch;
_resetAlphaVantageForTests();
delete process.env.ALPHA_VANTAGE_API_KEY;

const failed = rows.filter((r) => !r[1]);
for (const [name, ok, detail] of rows) {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) process.exit(1);
