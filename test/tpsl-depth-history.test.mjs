/**
 * Pure logic + security mocks for the three new surfaces:
 *   · dYdX TP/SL planning and the signing wrappers (src/lib/dydxTpsl.js, dydx.js)
 *   · futures history normalisation, direction and paging (src/lib/futuresHistory.js)
 *   · spot depth curve, quote fan-out and cache (src/lib/spotDepth.js)
 *   · the same-origin indexer proxy helpers (server/dydx.js)
 *
 * No network: `fetch` is replaced with a counter wherever a helper could reach it.
 * Run with: node --test test/tpsl-depth-history.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const tpsl = await import('../src/lib/dydxTpsl.js');
const depth = await import('../src/lib/spotDepth.js');
const hist = await import('../src/lib/futuresHistory.js');
const dydx = await import('../src/lib/dydx.js');
const serverDydx = await import('../server/dydx.js');

const LONG = { positionSide: 'LONG', size: 1, entryPrice: 100, currentPrice: 100, tickSize: '0.1' };
const SHORT = { positionSide: 'SHORT', size: 2, entryPrice: 100, currentPrice: 100, tickSize: '0.1' };
const VALID_ADDR = `dydx1${'a'.repeat(38)}`;

/* ───────────────────────────── dYdX TP/SL plan ───────────────────────────── */

test('TP/SL: the SDK conditional types are pinned to the four expected names', () => {
  assert.deepEqual(tpsl.TPSL_SDK_TYPE, {
    tp: { market: 'TAKE_PROFIT_MARKET', limit: 'TAKE_PROFIT_LIMIT' },
    sl: { market: 'STOP_MARKET', limit: 'STOP_LIMIT' }
  });
  assert.equal(tpsl.TPSL_GOOD_TIL_SECONDS, 28 * 24 * 60 * 60);
});

test('TP/SL: a long with TP above and SL below is valid; both legs sell and reduce only', () => {
  const plan = tpsl.validateTpSl({ ...LONG, tp: 110, sl: 95, execution: 'market' });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.legs.length, 2);
  for (const leg of plan.legs) {
    assert.equal(leg.side, 'SELL');
    assert.equal(leg.reduceOnly, true);
    assert.equal(leg.size, 1);
  }
  assert.equal(plan.legs.find((l) => l.kind === 'tp').sdkType, 'TAKE_PROFIT_MARKET');
  assert.equal(plan.legs.find((l) => l.kind === 'sl').sdkType, 'STOP_MARKET');
});

test('TP/SL: a short with TP below and SL above is valid; both legs buy and reduce only', () => {
  const plan = tpsl.validateTpSl({ ...SHORT, tp: 90, sl: 105, execution: 'market' });
  assert.equal(plan.ok, true);
  for (const leg of plan.legs) {
    assert.equal(leg.side, 'BUY');
    assert.equal(leg.reduceOnly, true);
  }
});

test('TP/SL: a trigger on the wrong side of the market is refused as TRIGGER_PASSED', () => {
  // long TP below the market would fire at once
  const longTp = tpsl.validateTpSl({ ...LONG, tp: 99, execution: 'market' });
  assert.equal(longTp.ok, false);
  assert.ok(longTp.errors.includes('TRIGGER_PASSED'));
  assert.deepEqual(longTp.legs, []);
  // short SL below the market would fire at once
  const shortSl = tpsl.validateTpSl({ ...SHORT, sl: 95, execution: 'market' });
  assert.equal(shortSl.ok, false);
  assert.ok(shortSl.errors.includes('TRIGGER_PASSED'));
});

test('TP/SL: an empty plan, a zero size and a missing tick are each refused with their own code', () => {
  assert.ok(tpsl.validateTpSl({ ...LONG, execution: 'market' }).errors.includes('NO_LEG'));
  assert.ok(tpsl.validateTpSl({ ...LONG, size: 0, tp: 110 }).errors.includes('BAD_SIZE'));
  assert.ok(tpsl.validateTpSl({ ...LONG, tickSize: null, tp: 110 }).errors.includes('TICK_UNKNOWN'));
  assert.ok(tpsl.validateTpSl({ ...LONG, currentPrice: null, tp: 110 }).errors.includes('NO_CURRENT_PRICE'));
  assert.ok(tpsl.validateTpSl({ positionSide: null, size: 1, currentPrice: 100, tickSize: '0.1', tp: 110 }).errors.includes('BAD_POSITION_SIDE'));
});

test('TP/SL: a non-finite or non-positive price is BAD_PRICE, never NaN in the plan', () => {
  const plan = tpsl.validateTpSl({ ...LONG, tp: 'abc' });
  assert.equal(plan.ok, false);
  assert.ok(plan.errors.includes('BAD_PRICE'));
  assert.equal(JSON.stringify(plan).includes('NaN'), false);
});

test('TP/SL: a limit leg needs its own limit price on the correct side', () => {
  const missing = tpsl.validateTpSl({ ...SHORT, tp: 90, sl: 105, execution: 'limit' });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.includes('LIMIT_PRICE_INVALID'));

  const ok = tpsl.validateTpSl({ ...SHORT, tp: 90, sl: 105, execution: 'limit', tpLimit: 91, slLimit: 106 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.legs.map((l) => l.sdkType), ['TAKE_PROFIT_LIMIT', 'STOP_LIMIT']);
});

test('TP/SL: a trigger that is not on the tick is rounded AWAY from the market and says so', () => {
  const plan = tpsl.validateTpSl({ ...LONG, sl: 99.95, execution: 'market' });
  assert.equal(plan.ok, true);
  const leg = plan.legs[0];
  assert.equal(leg.requestedTrigger, 99.95);
  assert.equal(leg.triggerPrice, 99.9);
  assert.ok(leg.roundedBy < 0);
});

test('TP/SL: estimates are signed, labelled per leg, and never include NaN', () => {
  const plan = tpsl.validateTpSl({ ...SHORT, tp: 90, sl: 105, execution: 'market' });
  const tp = plan.estimates.find((e) => e.kind === 'tp');
  const sl = plan.estimates.find((e) => e.kind === 'sl');
  assert.equal(tp.pnlUsd, 20);   // (100 - 90) * 2
  assert.equal(sl.pnlUsd, -10);  // (100 - 105) * 2
  assert.equal(JSON.stringify(plan).includes('NaN'), false);
});

/* ───────────────────────────── dYdX signing guard ───────────────────────── */

test('security: placing or cancelling a conditional order without a session is refused before any SDK or network call', async () => {
  let fetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches += 1; throw new Error('network must not be used'); };
  try {
    assert.equal(dydx.dydxSessionAddress(), null);
    await assert.rejects(
      () => dydx.placeDydxConditionalOrder({ market: { ticker: 'BTC-USD', raw: {} }, leg: { sdkType: 'STOP_MARKET', reduceOnly: true, size: 1, triggerPrice: 95, limitPrice: 94, side: 'SELL' } }),
      /NOT_CONNECTED/
    );
    await assert.rejects(
      () => dydx.cancelDydxConditionalOrder({ market: { ticker: 'BTC-USD', raw: {} }, clientId: 7 }),
      /NOT_CONNECTED/
    );
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('security: a leg that is not reduce-only is refused as BAD_LEG (checked after the session guard, so it never signs)', async () => {
  // The session guard runs first, so without a session this is NOT_CONNECTED.
  // The shape check is verified in source: the refusal must be present.
  const src = read('src/lib/dydx.js');
  assert.match(src, /if \(!leg \|\| !leg\.sdkType \|\| leg\.reduceOnly !== true\) throw new Error\('BAD_LEG'\);/);
});

test('security: the dYdX session is never written to web storage', () => {
  const src = read('src/lib/dydx.js');
  const storageWrites = src.split('\n').filter((l) => /(localStorage|sessionStorage)\s*\.\s*setItem/.test(l));
  for (const line of storageWrites) {
    assert.doesNotMatch(line, /session|mnemonic|seed|key|secret/i, `storage write touches session data: ${line.trim()}`);
  }
});

test('security: the TP/SL signing wrappers are only reachable from the card click handlers', () => {
  const card = read('src/components/futures/DydxTpSlCard.jsx');
  const occurrences = card.split('\n').filter((l) => /placeDydxConditionalOrder\(|cancelDydxConditionalOrder\(/.test(l));
  assert.equal(occurrences.length, 2, 'exactly one place-call and one cancel-call in the card');
  // no timers, effects or schedulers may send an order
  assert.doesNotMatch(card, /setInterval|setTimeout\([^)]*place/);
});

test('security: reads of open orders and fills use an empty result for an invalid address and never fetch', async () => {
  let fetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches += 1; return { ok: true, json: async () => ({}) }; };
  try {
    const bad = await dydx.getDydxOrders({ address: 'not-an-address' });
    assert.deepEqual(bad.orders, []);
    assert.equal(bad.live, false);
    assert.equal(bad.reason, 'BAD_ADDRESS');
    const badStatus = await dydx.getDydxOrders({ address: VALID_ADDR, status: 'DROP TABLE' });
    assert.equal(badStatus.reason, 'BAD_STATUS');
    const badFills = await dydx.getDydxFills({ address: '' });
    assert.equal(badFills.reason, 'BAD_ADDRESS');
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('security: the new server routes are GET-only and send no-store', () => {
  const app = read('server/app.js');
  const fillsIdx = app.indexOf("app.get('/api/dydx/fills/:address/:number'");
  const ordersIdx = app.indexOf("app.get('/api/dydx/orders/:address/:number'");
  assert.ok(fillsIdx > 0 && ordersIdx > 0, 'both routes exist');
  for (const idx of [fillsIdx, ordersIdx]) {
    const block = app.slice(idx, idx + 900);
    assert.match(block, /res\.set\('cache-control', 'no-store'\)/);
    assert.doesNotMatch(block, /console\./, 'no logging of address or body');
  }
  assert.equal(/app\.(post|put|patch|delete)\('\/api\/dydx\/(fills|orders)/.test(app), false);
});

/* ───────────────────────────── server proxy helpers ─────────────────────── */

test('server: the orders body is accepted as a bare array and as { orders }, and capped', () => {
  assert.equal(serverDydx.normaliseOrdersBody([{ id: 1 }, { id: 2 }]).length, 2);
  assert.equal(serverDydx.normaliseOrdersBody({ orders: [{ id: 1 }] }).length, 1);
  assert.deepEqual(serverDydx.normaliseOrdersBody(null), []);
  assert.deepEqual(serverDydx.normaliseOrdersBody({ other: 1 }), []);
  const many = Array.from({ length: 250 }, (_, i) => ({ id: i }));
  assert.equal(serverDydx.normaliseOrdersBody(many).length, serverDydx.DYDX_FILLS_LIMIT_MAX);
});

test('server: the fills body is read from { fills } only', () => {
  assert.equal(serverDydx.normaliseFillsBody({ fills: [{ id: 'a' }] }).length, 1);
  assert.deepEqual(serverDydx.normaliseFillsBody([{ id: 'a' }]), []);
});

test('server: an invalid address, subaccount or status is a 400 before any upstream fetch', () => {
  const err = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  assert.equal(err(() => serverDydx.fetchDydxOrders('nope', 0, 'OPEN')).status, 400);
  assert.equal(err(() => serverDydx.fetchDydxOrders(VALID_ADDR, 99, 'OPEN')).status, 400);
  assert.equal(err(() => serverDydx.fetchDydxOrders(VALID_ADDR, 0, 'ANYTHING')).status, 400);
  assert.equal(err(() => serverDydx.fetchDydxFills(VALID_ADDR, -1)).status, 400);
  assert.equal(err(() => serverDydx.fetchDydxFills(VALID_ADDR, 0, { before: 'not a date' })).status, 400);
});

/* ───────────────────────────── futures history ──────────────────────────── */

const fill = (over = {}) => ({
  id: 'f1', createdAt: '2026-10-15T10:00:00.000Z', market: 'BTC-USD', side: 'BUY',
  size: '0.5', price: '60000', fee: '-1.2', orderId: 'o1', liquidity: 'TAKER', ...over
});

test('history: a fill with a bad time, size or price is dropped, not shown as zero', () => {
  assert.equal(hist.normaliseDydxFill(fill({ createdAt: 'x' })), null);
  assert.equal(hist.normaliseDydxFill(fill({ size: '0' })), null);
  assert.equal(hist.normaliseDydxFill(fill({ price: 'NaN' })), null);
  assert.equal(hist.normaliseDydxFill(null), null);
});

test('history: a valid fill is normalised; realised PnL is null (shown as a dash), never zero', () => {
  const row = hist.normaliseDydxFill(fill());
  assert.equal(row.venue, 'dydx');
  assert.equal(row.side, 'BUY');
  assert.equal(row.size, 0.5);
  assert.equal(row.price, 60000);
  assert.equal(row.fee, -1.2);
  assert.equal(row.realizedPnl ?? null, null);
  assert.equal(typeof row.time, 'number');
  assert.equal(JSON.stringify(row).includes('NaN'), false);
});

test('history: direction is derived from the joined order; a reduce-only SELL closes a LONG', () => {
  const rows = [
    hist.normaliseDydxFill(fill({ id: 'a', side: 'SELL', orderId: 'o2' })),
    hist.normaliseDydxFill(fill({ id: 'b', side: 'BUY', orderId: 'o3' })),
    hist.normaliseDydxFill(fill({ id: 'c', side: 'BUY', orderId: 'missing' }))
  ];
  const orders = [{ id: 'o2', reduceOnly: true, type: 'STOP_MARKET' }, { id: 'o3', reduceOnly: false, type: 'MARKET' }];
  const out = hist.annotateFills(rows, orders);
  assert.equal(out[0].direction, 'LONG');
  assert.equal(out[0].closing, true);
  assert.equal(out[0].orderType, 'STOP_MARKET');
  assert.equal(out[1].direction, 'LONG');
  assert.equal(out[1].closing, false);
  // no matching order: no direction is invented
  assert.equal(out[2].direction ?? null, null);
});

test('history: a filled order outside the joined window yields Unknown, not a guessed direction', () => {
  const out = hist.annotateFills([hist.normaliseDydxFill(fill({ side: 'SELL', orderId: 'gone' }))], []);
  assert.equal(out[0].direction ?? null, null);
});

test('history: filter by market and range; the cut-off is injectable', () => {
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  const rows = hist.sortNewestFirst([
    { id: '1', market: 'BTC-USD', time: now - 1 * 3600e3 },
    { id: '2', market: 'ETH-USD', time: now - 2 * 86400e3 },
    { id: '3', market: 'BTC-USD', time: now - 40 * 86400e3 }
  ]);
  assert.deepEqual(hist.filterHistory(rows, { market: 'all', range: 'all', now }).map((r) => r.id), ['1', '2', '3']);
  assert.deepEqual(hist.filterHistory(rows, { market: 'BTC-USD', range: '24h', now }).map((r) => r.id), ['1']);
  assert.deepEqual(hist.filterHistory(rows, { market: 'all', range: '7d', now }).map((r) => r.id), ['1', '2']);
  assert.deepEqual(hist.marketsIn(rows), ['BTC-USD', 'ETH-USD']);
});

test('history: paging is by offset, reports hasMore, and never re-returns earlier rows', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: String(i) }));
  const p1 = hist.paginate(rows, { offset: 0, pageSize: 25 });
  assert.equal(p1.items.length, 25);
  assert.equal(p1.hasMore, true);
  const p2 = hist.paginate(rows, { offset: p1.nextOffset, pageSize: 25 });
  assert.equal(p2.items.length, 5);
  assert.equal(p2.hasMore, false);
  assert.equal(p2.items[0].id, '25');
});

test('history: Ostium and Velocity are labelled unavailable with a reason key, and are not guessed', () => {
  const venues = Object.fromEntries(hist.HISTORY_VENUES.map((v) => [v.id, v]));
  assert.equal(venues.dydx.available, true);
  assert.equal(venues.ostium.available, false);
  assert.equal(venues.ostium.reasonKey, 'futures.history.venue.ostiumUnavailable');
  assert.equal(venues.velocity.available, false);
  assert.equal(venues.velocity.reasonKey, 'futures.history.venue.velocityUnavailable');
});

test('history: the history panel has no send, cancel or edit control', () => {
  const src = read('src/components/futures/FuturesHistory.jsx');
  assert.doesNotMatch(src, /placeDydx|cancelDydx|buildModify|setVelocityTpSl|sendTransaction|eth_sendTransaction/);
  const buttonLabels = [...src.matchAll(/t\(['"`](futures\.history\.[a-zA-Z.]+)['"`]\)/g)].map((m) => m[1]);
  assert.equal(buttonLabels.some((k) => /cancel|send|edit|confirm/i.test(k)), false);
});

/* ───────────────────────────── spot depth curve ─────────────────────────── */

test('depth: the curve is sorted, carries a band per point, and marks a failed point unavailable', () => {
  const quotes = [
    { sizeUsd: 2000, rate: 0.97, outAmount: 1940 },
    { sizeUsd: 100, rate: 1.0, outAmount: 100 },
    { sizeUsd: 500, rate: 0.99, outAmount: 495 },
    { sizeUsd: 10000, error: 'QUOTE_FAILED' }
  ];
  const ref = depth.referenceRateFrom(quotes);
  assert.equal(ref, 1.0);
  const curve = depth.buildDepthCurve({ quotes, referenceRate: ref });
  assert.deepEqual(curve.map((p) => p.sizeUsd), [100, 500, 2000, 10000]);
  assert.equal(curve[0].status, 'ok');
  assert.equal(curve[0].impactPct, 0);
  assert.equal(curve[0].band, 'low');
  assert.equal(curve[1].band, 'medium');  // 1% impact: at or above the 0.5% medium threshold
  assert.equal(curve[2].band, 'high');    // 3% impact: at or above the 2% high threshold
  assert.equal(curve[3].status, 'unavailable');
  assert.equal(curve[3].rate, null);
  assert.equal(curve[3].impactPct, null);
  assert.equal(curve[3].sizeUsd, 10000);
  assert.equal(JSON.stringify(curve).includes('NaN'), false);
});

test('depth: impact bands are low below 0.5%, medium from 0.5%, high from 2%', () => {
  assert.equal(depth.impactBand(0.49), 'low');
  assert.equal(depth.impactBand(0.5), 'medium');
  assert.equal(depth.impactBand(1.99), 'medium');
  assert.equal(depth.impactBand(2), 'high');
  assert.equal(depth.impactBand(Number.NaN), null);
  assert.equal(depth.impactBand(-1), null);
});

test('depth: with no usable reference every point is unavailable; nothing is guessed', () => {
  const curve = depth.buildDepthCurve({ quotes: [{ sizeUsd: 100, rate: 1 }, { sizeUsd: 500, rate: 0.9 }], referenceRate: null });
  assert.ok(curve.every((p) => p.status === 'unavailable' && p.impactPct === null));
  assert.equal(depth.referenceRateFrom([{ sizeUsd: 100, error: 'NO_QUOTE' }]), null);
});

test('depth: a zero, negative or NaN rate never becomes a point', () => {
  const curve = depth.buildDepthCurve({
    quotes: [{ sizeUsd: 100, rate: 0 }, { sizeUsd: 500, rate: -1 }, { sizeUsd: 2000, rate: Number.NaN }, { sizeUsd: 'x', rate: 1 }],
    referenceRate: 1
  });
  assert.deepEqual(curve.map((p) => p.status), ['unavailable', 'unavailable', 'unavailable']);
  assert.equal(JSON.stringify(curve).includes('NaN'), false);
});

test('depth: fetchDepthQuotes turns a failed size into an error row and keeps the others', async () => {
  const out = await depth.fetchDepthQuotes({
    sizes: [100, 500, 2000],
    gapMs: 0,
    quoteFn: async (s) => {
      if (s === 500) throw new Error('boom');
      return { rate: 1 - s / 1e6, outAmount: s };
    }
  });
  assert.equal(out.length, 3);
  assert.equal(out.find((q) => q.sizeUsd === 500).error, 'QUOTE_FAILED');
  assert.equal(out.find((q) => q.sizeUsd === 100).rate, 1 - 100 / 1e6);
});

test('depth: fetchDepthQuotes never has more than the concurrency limit in flight', async () => {
  let inFlight = 0;
  let peak = 0;
  await depth.fetchDepthQuotes({
    sizes: [100, 500, 2000, 10000],
    concurrency: depth.SPOT_DEPTH_CONCURRENCY,
    gapMs: 0,
    quoteFn: async (s) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { rate: 1, outAmount: s };
    }
  });
  assert.equal(peak <= depth.SPOT_DEPTH_CONCURRENCY, true);
  assert.equal(depth.SPOT_DEPTH_CONCURRENCY, 2);
});

test('depth: an aborted fan-out rethrows AbortError and does not return partial data', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => depth.fetchDepthQuotes({ sizes: [100, 500], signal: ac.signal, gapMs: 0, quoteFn: async () => ({ rate: 1 }) }),
    (e) => e.name === 'AbortError'
  );
});

test('depth: the cache is short-lived, pair-scoped and can be cleared or deleted', () => {
  let now = 1_000;
  const cache = depth.createDepthCache({ ttlMs: 20_000, now: () => now });
  cache.set('eth|usdc', { curve: [1] });
  assert.equal(cache.get('eth|usdc').fresh, true);
  now += 19_999;
  assert.equal(cache.get('eth|usdc').fresh, true);
  now += 2;
  assert.equal(cache.get('eth|usdc').fresh, false);     // stale but still readable for the stale label
  assert.equal(cache.get('eth|usdc2'), null);           // different pair never leaks
  cache.del('eth|usdc');
  assert.equal(cache.get('eth|usdc'), null);
  cache.set('a', 1);
  cache.clear();
  assert.equal(cache.get('a'), null);
  assert.equal(depth.SPOT_DEPTH_TTL_MS, 20_000);
});

test('depth: the USD price is looked up by CoinGecko id only, never by symbol', () => {
  const coins = [{ id: 'ethereum', symbol: 'eth', price: 3000 }];
  assert.equal(depth.usdPriceFor(coins, 'ethereum'), 3000);
  assert.equal(depth.usdPriceFor(coins, null), null);
  assert.equal(depth.usdPriceFor(coins, 'ETH'), null);
});

test('depth: amountForUsd gives a decimal string, or null when it cannot be computed', () => {
  assert.equal(typeof depth.amountForUsd(100, 2000), 'string');
  assert.equal(depth.amountForUsd(100, 0), null);
  assert.equal(depth.amountForUsd(Number.NaN, 2000), null);
  assert.equal(depth.amountForUsd(100, Number.NaN), null);
});

/* ───────────────────────────── static honesty checks ────────────────────── */

test('honesty: no guaranteed-profit or real-depth wording in the new UI or lib sources', () => {
  const files = [
    'src/components/spot/SpotDepth.jsx',
    'src/components/futures/DydxTpSlCard.jsx',
    'src/components/futures/FuturesHistory.jsx',
    'src/lib/dydxTpsl.js',
    'src/lib/spotDepth.js',
    'src/lib/futuresHistory.js'
  ];
  const banned = ['تضمین', 'بدون ریسک', 'سود قطعی', 'عمق واقعی', 'بهترین قیمت تضمین'];
  for (const f of files) {
    const src = read(f);
    for (const word of banned) assert.equal(src.includes(word), false, `${f} contains «${word}»`);
  }
});

test('honesty: the depth disclaimer and caveat keys say quotes are non-binding', () => {
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  assert.match(en.spot.depth.disclaimer, /not binding/i);
  assert.match(en.spot.depth.caveat, /Indicative/i);
  const fa = JSON.parse(read('src/i18n/locales/fa.json'));
  assert.match(fa.spot.depth.disclaimer, /الزام‌آور نیستند/);
});

/* ───────────────────────────── feature flags ────────────────────────────── */

test('flags: the three new flags are read exactly as =\'true\' and are off in a plain import', async () => {
  const src = read('src/lib/features.js');
  assert.match(src, /export const DYDX_TPSL_ENABLED = envFlag\('VITE_ENABLE_DYDX_TPSL'\) === 'true';/);
  assert.match(src, /export const FUTURES_HISTORY_ENABLED = envFlag\('VITE_ENABLE_FUTURES_HISTORY'\) === 'true';/);
  assert.match(src, /export const SPOT_DEPTH_ENABLED = envFlag\('VITE_ENABLE_SPOT_DEPTH'\) === 'true';/);
  const features = await import('../src/lib/features.js');
  assert.equal(features.DYDX_TPSL_ENABLED, false);
  assert.equal(features.FUTURES_HISTORY_ENABLED, false);
  assert.equal(features.SPOT_DEPTH_ENABLED, false);
});

test('flags: the Android sync script keeps all three new flags explicitly off', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = pkg.scripts['android:sync'];
  assert.match(script, /VITE_ENABLE_DYDX_TPSL=false/);
  assert.match(script, /VITE_ENABLE_FUTURES_HISTORY=false/);
  assert.match(script, /VITE_ENABLE_SPOT_DEPTH=false/);
  for (const flag of ['VITE_ENABLE_DYDX_TPSL', 'VITE_ENABLE_FUTURES_HISTORY', 'VITE_ENABLE_SPOT_DEPTH']) {
    assert.doesNotMatch(script, new RegExp(`${flag}=true`));
  }
});
