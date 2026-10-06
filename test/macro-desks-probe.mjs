/**
 * Macro desks probe — the independent desks behind «قیمت دلار، طلا و اوراق خوانده نشد».
 *
 * Production answered `macro.quotes: []` because the whole domain hung on one
 * sequential chain. This probe pins the replacement, with FIXTURES COPIED FROM
 * REAL RESPONSES captured on 2026-10-06 (ECB/Frankfurter rates, the U.S.
 * Treasury par-yield feed) and a mocked Ostium `/v1/ohlc`:
 *
 *   A. the ECB desk: the dollar index is COMPUTED from the official basket;
 *   B. the Treasury desk: 2Y / 10Y / 30Y and the 2s10s spread;
 *   C. the Ostium daily desk: gold, silver, crude, copper, S&P, TLT;
 *   D. the orchestrator: with every legacy desk dark the three independent
 *      desks still deliver, inside one deadline, each quote keeping its source;
 *   E. a hung legacy desk costs only itself;
 *   F. the last good read is served flagged `stale`, then expires honestly.
 *
 * No network: every upstream is a mocked fetch.
 */
process.env.MACRO_GLOBAL_DEADLINE_MS = '700';
process.env.MACRO_EXTRA_TIMEOUT_MS = '600';

const rows = [];
const t = (name, ok, detail = '') => rows.push([name, Boolean(ok), ok ? '' : String(detail).slice(0, 260)]);

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const seen = [];
function mockFetch(handler) {
  seen.length = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    seen.push(`${opts?.method || 'GET'} ${u}`);
    return handler(u, opts);
  };
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

const {
  fetchMacroQuotes, parseFrankfurterSeries, dxySeriesFrom, fxRowsFrom, parseTreasuryXml,
  mergeDeskItems, DXY_WEIGHTS, DXY_CONSTANT, _resetMacroDataForTests
} = await import('../server/macroData.js');
const {
  parseOstiumCandles, changesFromCandles, readOstiumDailyChanges, _resetOstiumDailyForTests
} = await import('../server/ostiumDaily.js');

/* ── fixtures ─────────────────────────────────────────────────────────────
   Frankfurter, 2026-09-25 → 2026-10-06, base USD (copied from the live read). */
const ECB = {
  amount: 1.0, base: 'USD', start_date: '2026-09-25', end_date: '2026-10-06',
  rates: {
    '2026-09-25': { CAD: 1.4143, CHF: 0.82829, CNY: 6.7132, EUR: 0.87696, GBP: 0.75458, INR: 95.82, JPY: 157.59, SEK: 9.9009, TRY: 48.933 },
    '2026-09-28': { CAD: 1.4166, CHF: 0.83178, CNY: 6.7105, EUR: 0.87889, GBP: 0.75396, INR: 95.98, JPY: 156.88, SEK: 9.9495, TRY: 48.982 },
    '2026-09-29': { CAD: 1.418, CHF: 0.8332, CNY: 6.7034, EUR: 0.88067, GBP: 0.75489, INR: 95.98, JPY: 157.12, SEK: 9.9701, TRY: 49.0 },
    '2026-09-30': { CAD: 1.4183, CHF: 0.8347, CNY: 6.7045, EUR: 0.88067, GBP: 0.75265, INR: 95.83, JPY: 157.0, SEK: 9.9789, TRY: 49.018 },
    '2026-10-01': { CAD: 1.4246, CHF: 0.83528, CNY: 6.7045, EUR: 0.88511, GBP: 0.75565, INR: 96.33, JPY: 157.98, SEK: 10.0292, TRY: 49.034 },
    '2026-10-02': { CAD: 1.424, CHF: 0.82664, CNY: 6.7046, EUR: 0.89087, GBP: 0.75753, INR: 96.32, JPY: 157.67, SEK: 10.0579, TRY: 49.145 },
    '2026-10-05': { CAD: 1.4253, CHF: 0.83104, CNY: 6.7046, EUR: 0.89254, GBP: 0.75616, INR: 96.3, JPY: 158.23, SEK: 10.0433, TRY: 49.157 },
    '2026-10-06': { CAD: 1.425, CHF: 0.83051, CNY: 6.7046, EUR: 0.88739, GBP: 0.75322, INR: 96.42, JPY: 158.09, SEK: 9.9765, TRY: 49.179 }
  }
};

/* U.S. Treasury daily par yield curve — the three most recent sessions of the
   live feed, in the feed's own element names (`d:` namespace, OData types). */
const treasuryEntry = (date, v) => `<entry><id>x</id><content type="application/xml"><m:properties>`
  + `<d:Id m:type="Edm.Int32">1</d:Id><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>`
  + `<d:BC_1MONTH m:type="Edm.Double">${v.m1}</d:BC_1MONTH><d:BC_2YEAR m:type="Edm.Double">${v.y2}</d:BC_2YEAR>`
  + `<d:BC_10YEAR m:type="Edm.Double">${v.y10}</d:BC_10YEAR><d:BC_20YEAR m:type="Edm.Double">${v.y20}</d:BC_20YEAR>`
  + `<d:BC_30YEAR m:type="Edm.Double">${v.y30}</d:BC_30YEAR><d:BC_30YEARDISPLAY m:type="Edm.Double">${v.y30}</d:BC_30YEARDISPLAY>`
  + `</m:properties></content></entry>`;
const TREASURY_XML = `<?xml version="1.0"?><feed xmlns:d="x" xmlns:m="y">`
  + treasuryEntry('2026-10-01', { m1: 4.06, y2: 4.78, y10: 5.24, y20: 5.64, y30: 5.61 })
  + treasuryEntry('2026-10-02', { m1: 4.04, y2: 4.83, y10: 5.28, y20: 5.67, y30: 5.63 })
  + treasuryEntry('2026-10-05', { m1: 4.05, y2: 4.84, y10: 5.31, y20: 5.70, y30: 5.66 })
  + '</feed>';

/* A daily Ostium candle set that ends "today" so the 7d reference exists. */
const DAY_S = 86_400;
function candlesFor(base, drift) {
  const now = Math.floor(originalNow() / 1000);
  const start = now - 9 * DAY_S;
  return Array.from({ length: 10 }, (_, i) => {
    const close = Number((base * (1 + drift * i)).toFixed(4));
    return { time: start + i * DAY_S, open: close, high: close, low: close, close };
  });
}
const OSTIUM_BASE = { 'XAU-USD': 4000, 'XAG-USD': 60, 'WTI-USD': 88, 'BRENT-USD': 100, 'XCU-USD': 6.5, 'US500-USD': 7800, 'TLT-USD': 77 };

function darkLegacy(u) {
  if (u.includes('stooq.com')) return text('Internal Server Error', 500);
  if (u.includes('query1.finance.yahoo.com')) return text('Too Many Requests', 429);
  if (u.includes('fredgraph.csv') || u.includes('api.stlouisfed.org')) return text('down', 503);
  if (u.includes('alphavantage.co')) return json({ Note: 'limit' });
  return null;
}
function independentDesks(u, opts, { ostium = true, ecb = true, treasury = true } = {}) {
  if (u.includes('builder.prod.bedrock.ostium.io/v1/ohlc')) {
    if (!ostium) return text('down', 503);
    const body = JSON.parse(opts?.body || '{}');
    const base = OSTIUM_BASE[body.pair];
    if (!base) return json({ data: [] });
    const drift = body.pair === 'XAU-USD' ? 0.002 : body.pair === 'WTI-USD' ? -0.003 : 0.001;
    return json({ data: candlesFor(base, drift) });
  }
  if (u.includes('api.frankfurter.dev')) return ecb ? json(ECB) : text('down', 503);
  if (u.includes('home.treasury.gov')) return treasury ? text(TREASURY_XML) : text('down', 503);
  return null;
}

/* ═══ A. ECB desk ═══════════════════════════════════════════════════════════ */
const series = parseFrankfurterSeries(ECB);
t('A1 the ECB series parses per currency, ascending', series.EUR?.length === 8 && series.EUR[0].ts < series.EUR[7].ts, JSON.stringify(series.EUR?.slice(0, 2)));
t('A2 the basket weights sum to exactly 1', Math.abs(Object.values(DXY_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
const parity = dxySeriesFrom(Object.fromEntries(Object.keys(DXY_WEIGHTS).map((c) => [c, [{ ts: 1, price: 1 }]])));
t('A3 at parity the index equals the official constant', parity.length === 1 && Math.abs(parity[0].price - DXY_CONSTANT) < 0.01, JSON.stringify(parity));
const dxy = dxySeriesFrom(series);
const dxyLast = dxy[dxy.length - 1];
const expectedDxy = DXY_CONSTANT * (0.88739 ** 0.576) * (158.09 ** 0.136) * (0.75322 ** 0.119) * (1.425 ** 0.091) * (9.9765 ** 0.042) * (0.83051 ** 0.036);
t('A4 the 2026-10-06 dollar index matches the independent formula', dxyLast && Math.abs(dxyLast.price - expectedDxy) < 0.01, `${dxyLast?.price} vs ${expectedDxy}`);
t('A5 the index is in the plausible band for that day (101–103)', dxyLast.price > 101 && dxyLast.price < 103, dxyLast.price);
t('A6 only days with all six currencies produce an index', dxy.length === 8);
const fx = fxRowsFrom(series);
const eur = fx.find((r) => r.ccy === 'EUR');
t('A7 a currency that GAINED on the dollar reads positive (EUR 0.89254→0.88739 per USD)', eur && eur.change1dPct > 0.5 && eur.change1dPct < 0.7, JSON.stringify(eur));
const tryRow = fx.find((r) => r.ccy === 'TRY');
t('A8 a currency that LOST on the dollar reads negative (TRY 49.157→49.179)', tryRow && tryRow.change1dPct < 0, JSON.stringify(tryRow));
t('A9 every fx row names its source and observation time', fx.every((r) => r.source === 'ecb:reference-rates' && Number.isFinite(r.at)));

/* ═══ B. Treasury desk ══════════════════════════════════════════════════════ */
const ty = parseTreasuryXml(TREASURY_XML);
t('B1 the par-yield XML yields the 2Y/10Y/30Y series', ty['2Y'].length === 3 && ty['10Y'].length === 3 && ty['30Y'].length === 3);
t('B2 the 10-year read matches the published 5.31 (2026-10-05)', ty['10Y'][2].price === 5.31 && ty['10Y'][1].price === 5.28, JSON.stringify(ty['10Y']));
t('B3 the XML parser ignores the namespace prefix', parseTreasuryXml(TREASURY_XML.replace(/d:/g, ''))['10Y']?.length === 3);
t('B4 garbage XML yields empty series, never a throw', parseTreasuryXml('<html>nope</html>')['10Y'].length === 0);

/* ═══ C. Ostium daily candles ═══════════════════════════════════════════════ */
t('C1 candle `time` may be seconds or milliseconds',
  parseOstiumCandles({ data: [{ time: 1_790_000_000, close: 10 }, { time: 1_790_086_400_000, close: 11 }] }).map((c) => c.ts).join()
  === `${1_790_000_000_000},${1_790_086_400_000}`);
t('C2 a non-positive or missing close is skipped', parseOstiumCandles({ data: [{ time: 1, close: 0 }, { time: 2 }, { time: 3, close: 5 }] }).length === 1);
const ch = changesFromCandles(parseOstiumCandles({ data: candlesFor(100, 0.01) }));
t('C3 the 1d change is last close vs the previous close', ch && Math.abs(ch.change1dPct - ((1.09 / 1.08) - 1) * 100) < 0.02, JSON.stringify(ch));
t('C4 the 7d reference is read from the series, not guessed', ch && ch.change7dPct !== null && ch.change7dPct > 5, JSON.stringify(ch));
t('C5 one candle is not enough to know a change', changesFromCandles([{ ts: 1, close: 5 }]) === null);

_resetOstiumDailyForTests();
mockFetch((u, opts) => independentDesks(u, opts));
const read = await readOstiumDailyChanges(['XAU-USD', 'US500-USD', 'not a pair']);
t('C6 the desk reads valid pairs and ignores malformed ones', read.size === 2 && read.has('XAU-USD') && !read.has('NOT A PAIR'), [...read.keys()].join());
const callsAfterFirst = seen.length;
await readOstiumDailyChanges(['XAU-USD', 'US500-USD']);
t('C7 a pair read inside 30 minutes costs no second request', seen.length === callsAfterFirst, `${callsAfterFirst}→${seen.length}`);
_resetOstiumDailyForTests();
mockFetch(() => text('down', 503));
const dead = await readOstiumDailyChanges(['XAU-USD']);
t('C8 a dead venue resolves empty — never a throw, never a guess', dead.size === 0);
const deadCalls = seen.length;
await readOstiumDailyChanges(['XAU-USD']);
t('C9 a failed pair is not retried for five minutes (no request storm)', seen.length === deadCalls, `${deadCalls}→${seen.length}`);

/* ═══ D. the orchestrator with every legacy desk dark ══════════════════════ */
_resetMacroDataForTests();
mockFetch((u, opts) => darkLegacy(u) || independentDesks(u, opts) || text('unexpected', 404));
const started = originalNow();
const d = await fetchMacroQuotes();
const elapsed = originalNow() - started;
const by = new Map(d.items.map((q) => [q.symbol, q]));
t('D1 with stooq/yahoo/FRED dark the macro desk still answers', d.items.length >= 9, `${d.items.length}: ${d.items.map((q) => q.symbol).join()}`);
t('D2 gold, oil and the S&P come from Ostium with a real 1d change',
  ['GOLD', 'WTI', 'SPX'].every((s) => by.get(s)?.source?.startsWith('ostium:') && Number.isFinite(by.get(s).change1dPct)), JSON.stringify(['GOLD', 'WTI', 'SPX'].map((s) => by.get(s))));
t('D3 the dollar index comes from the ECB basket and is labelled so', by.get('DXY')?.source === 'ecb:DXY-basket' && Number.isFinite(by.get('DXY').change1dPct));
t('D4 the yields and the 2s10s spread come from the Treasury feed',
  by.get('US10Y')?.source === 'treasury:BC_10YEAR' && by.get('US2Y')?.source === 'treasury:BC_2YEAR' && by.get('US2S10S')?.source?.startsWith('treasury:'));
t('D5 the spread is 10Y minus 2Y on the same day (5.31 − 4.84 = 0.47)', Math.abs(by.get('US2S10S').priceUsd - 0.47) < 1e-9, by.get('US2S10S')?.priceUsd);
t('D6 TLT is exposed as a bond PROXY, never as the yield itself', by.get('TLT')?.kind === 'rate_proxy' && /proxy/i.test(by.get('TLT').name));
t('D7 the envelope names the independent desks that contributed', d.source === 'macroData:ostium+treasury+ecb', d.source);
t('D8 the desk diagnostics are exposed, one row per desk', Array.isArray(d.desks) && ['ostium', 'treasury', 'ecb'].every((id) => d.desks.some((r) => r.desk === id && r.ok)), JSON.stringify(d.desks));
t('D9 the currency-vs-USD table rides along for the globe', Array.isArray(d.fx) && d.fx.some((r) => r.ccy === 'JPY') && d.fx.some((r) => r.ccy === 'TRY'));
t('D10 a fresh read is not flagged stale', d.stale === false);
t('D11 the whole pass stays inside the deadline', elapsed < 2500, `${elapsed}ms`);
const callsD = seen.length;
await fetchMacroQuotes();
t('D12 an accepted pass is cached — the next read costs no request', seen.length === callsD, `${callsD}→${seen.length}`);

/* one independent desk failing must not hide the others */
_resetMacroDataForTests();
mockFetch((u, opts) => darkLegacy(u) || independentDesks(u, opts, { ecb: false }) || text('unexpected', 404));
const partial = await fetchMacroQuotes();
const byP = new Map(partial.items.map((q) => [q.symbol, q]));
t('D13 with the ECB desk down, gold and the yields are still read', byP.has('GOLD') && byP.has('US10Y'));
t('D14 …and the dollar index is honestly absent, not guessed', !byP.has('DXY'));
t('D15 the diagnostics say which desk failed and why', partial.desks.some((r) => r.desk === 'ecb' && r.ok === false && r.error));

/* ═══ E. a hung legacy desk costs only itself ═════════════════════════════ */
_resetMacroDataForTests();
mockFetch((u, opts) => {
  if (u.includes('stooq.com') || u.includes('query1.finance.yahoo.com') || u.includes('fredgraph.csv')) {
    return new Promise(() => {}); // never answers
  }
  return independentDesks(u, opts) || text('unexpected', 404);
});
const hungStart = originalNow();
const hung = await fetchMacroQuotes();
const hungElapsed = originalNow() - hungStart;
t('E1 a legacy chain that never answers does not block the independent desks', hung.items.some((q) => q.symbol === 'GOLD') && hung.items.some((q) => q.symbol === 'DXY'));
t('E2 the pass returns at the global deadline, not after the hung desk', hungElapsed < 1800, `${hungElapsed}ms`);
t('E3 the hung desk is reported as a deadline, not hidden', hung.desks.some((r) => r.desk === 'legacy' && r.error && /DEADLINE/.test(r.error)), JSON.stringify(hung.desks));

/* ═══ F. last good, stale-flagged ══════════════════════════════════════════ */
_resetMacroDataForTests();
mockFetch((u, opts) => darkLegacy(u) || independentDesks(u, opts) || text('unexpected', 404));
const fresh = await fetchMacroQuotes();
t('F0 a fresh read succeeds first', fresh.items.length >= 9 && fresh.stale === false);
let clock = originalNow() + 31 * 60_000; // past the 10-minute pass cache AND the 30-minute Ostium pair cache
Date.now = () => clock;
mockFetch(() => text('everything is down', 503));
const stale = await fetchMacroQuotes();
t('F1 with every desk dark the last good read is served', stale.items.length === fresh.items.length);
t('F2 …flagged stale, with its age, and the source says so', stale.stale === true && stale.staleAgeMs >= 30 * 60_000 && /\(stale\)$/.test(stale.source), `${stale.stale}/${stale.staleAgeMs}/${stale.source}`);
t('F3 …and each quote keeps its own original source', stale.items.every((q) => typeof q.source === 'string' && q.source.length > 0));
const staleCalls = seen.length;
const again = await fetchMacroQuotes();
t('F4 after a total failure the next minute makes no request (backoff)', again.stale === true && seen.length === staleCalls, `${staleCalls}→${seen.length}`);
clock += 37 * 3600_000; // past the 36h limit and the backoff
Date.now = () => clock;
let threw = null;
try { await fetchMacroQuotes(); } catch (e) { threw = e; }
t('F5 a read older than 36 hours is not served — the desk fails honestly', threw && /NO_MACRO_DATA_SOURCE/.test(threw.message), threw?.message);
Date.now = originalNow;

/* ═══ merge rule ══════════════════════════════════════════════════════════ */
const merged = mergeDeskItems({
  legacy: [{ symbol: 'GOLD', priceUsd: 4000, change1dPct: null, source: 'fredcsv:X' }, { symbol: 'WTI', priceUsd: 88, change1dPct: 1, source: 'stooq:CL.F' }],
  ostium: [{ symbol: 'GOLD', priceUsd: 4001, change1dPct: 0.4, source: 'ostium:XAU-USD' }, { symbol: 'WTI', priceUsd: 89, change1dPct: -2, source: 'ostium:WTI-USD' }]
});
const mg = new Map(merged.map((q) => [q.symbol, q]));
t('M1 a reading WITH a change beats one without', mg.get('GOLD').source === 'ostium:XAU-USD');
t('M2 on a tie the older desk wins', mg.get('WTI').source === 'stooq:CL.F');

globalThis.fetch = originalFetch;
Date.now = originalNow;
_resetMacroDataForTests();

const failed = rows.filter((r) => !r[1]);
for (const [name, ok, detail] of rows) console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);
