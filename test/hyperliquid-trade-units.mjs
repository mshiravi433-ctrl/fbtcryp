/* Units for signing, formatting, executor, engine, AI parsing, market parsing.
 * No network: every request goes through an injected fake fetch. */
import { readFileSync } from 'node:fs';
import { actionHash, signL1Action, agentAddressAsync } from '../src/lib/hyperliquid/signing.js';
import {
  toWire, roundPrice, roundSize, orderAction, stopAction, parseOrderStatuses,
  makeNonceSource, executeIntent, HL_EXEC_CODES
} from '../src/lib/hyperliquid/exchangeOps.js';
import {
  validateProposal, normalizeRules, evaluateRules, buildPreview, createPending,
  approvePending, createLedger, recordEntry, tradesSince, lastTradeTimes, ENGINE_CODES
} from '../src/lib/hyperliquid/engine.js';
import { extractJson, parseProposals, requestProposals, buildAnalystMessages, AI_CLIENT_CODES } from '../src/lib/hyperliquid/aiClient.js';
import { parseMarkets, eligibleMarkets, fetchRealisedSince, fetchCandles } from '../src/lib/hyperliquid/market.js';
import { verifyTypedData } from 'ethers';
import { MIN_MARKET_VOLUME_USD, MAX_ORDER_SHARE_OF_VOLUME, marketVerdict } from '../src/lib/hyperliquid/engine.js';
import { HL_CAP_DEFAULTS } from '../src/lib/hyperliquid/caps.js';

let pass = 0; let fail = 0;
const check = (name, cond) => { if (cond) { pass += 1; console.log(`✓ ${name}`); } else { fail += 1; console.log(`FAIL ${name}`); } };

// ── signing: byte-for-byte against the official SDK ───────────────────────
const vec = JSON.parse(readFileSync(new URL('./fixtures/hyperliquid/signing-vectors.json', import.meta.url), 'utf8'));
for (const [name, c] of Object.entries(vec.cases)) {
  const s = await signL1Action(vec.keyForVectors, c.action, c.nonce, { isMainnet: true });
  check(`sdk vector ${name}: hash, r, s, v match`,
    actionHash(c.action, c.nonce) === c.hash && s.r === c.signature.r && s.s === c.signature.s && s.v === c.signature.v);
}
check('agent address derived from key matches SDK', (await agentAddressAsync(vec.keyForVectors)) === vec.address);
check('testnet signature differs from mainnet (source a vs b)',
  (await signL1Action(vec.keyForVectors, vec.cases.update_leverage.action, vec.cases.update_leverage.nonce, { isMainnet: false })).r
  !== vec.cases.update_leverage.signature.r);

// ── formatting ─────────────────────────────────────────────────────────────
check('toWire 30000 → "30000"', toWire(30000) === '30000');
check('toWire 0.0100 → "0.01"', toWire(0.01) === '0.01');
check('toWire 100 → "100" (no lost zeros)', toWire(100) === '100');
check('roundPrice keeps 5 significant figures', roundPrice(2850.123456, 4) === 2850.1);
check('roundPrice respects 6 - szDecimals decimals', roundPrice(1.23456789, 2) === 1.2346);
check('roundSize rounds to szDecimals', roundSize(0.0123456, 5) === 0.01235);
check('orderAction key order matches SDK wire format',
  JSON.stringify(orderAction({ asset: 0, isBuy: true, px: 30000, sz: 0.01 })) ===
  '{"type":"order","orders":[{"a":0,"b":true,"p":"30000","s":"0.01","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"}');
check('stopAction is reduce-only sl trigger',
  stopAction({ asset: 1, isBuy: false, triggerPx: 2850, sz: 0.5 }).orders[0].t.trigger.tpsl === 'sl'
  && stopAction({ asset: 1, isBuy: false, triggerPx: 2850, sz: 0.5 }).orders[0].r === true);

// ── statuses and nonces ────────────────────────────────────────────────────
check('parse filled', parseOrderStatuses({ status: 'ok', response: { data: { statuses: [{ filled: { totalSz: '0.01', avgPx: '30010', oid: 7 } }] } } })[0].kind === 'filled');
check('parse resting', parseOrderStatuses({ status: 'ok', response: { data: { statuses: [{ resting: { oid: 9 } }] } } })[0].kind === 'resting');
check('parse per-order error', parseOrderStatuses({ status: 'ok', response: { data: { statuses: [{ error: 'Insufficient margin' }] } } })[0].error === 'Insufficient margin');
check('parse non-ok response is an error', parseOrderStatuses({ status: 'err', response: 'bad' })[0].kind === 'error');
const nonce = makeNonceSource(() => 1000);
const n1 = nonce(); const n2 = nonce(); const n3 = nonce();
check('nonces strictly increase even when the clock does not move', n1 < n2 && n2 < n3);

// ── executor against a fake exchange ───────────────────────────────────────
const KEY = vec.keyForVectors;
const ETH = { asset: 1, szDecimals: 4, maxLeverage: 25, onlyIsolated: false, dayNtlVlm: 800000000, midPx: 3000, markPx: 3000 };
const BTC_MKT = { asset: 0, szDecimals: 5, maxLeverage: 40, onlyIsolated: false, dayNtlVlm: 2000000000, midPx: 60000, markPx: 60000 };
const OPEN_STATE = { currentExposureUsd: 0, dailyRealisedPnlUsd: 0, dailyUnrealisedPnlUsd: 0 };
const intent = { coin: 'ETH', side: 'long', notionalUsd: 1000, leverage: 2, stopLossPct: 0.02 };

function fakeExchange(opts = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const a = body.action;
    const order = a.orders?.[0];
    let data;
    if (a.type === 'updateLeverage') data = opts.leverageOk === false ? { status: 'err', response: 'nope' } : { status: 'ok', response: { type: 'default' } };
    else if (order?.t?.trigger) data = opts.stopOk === false ? { status: 'ok', response: { data: { statuses: [{ error: 'trigger rejected' }] } } } : { status: 'ok', response: { data: { statuses: [{ resting: { oid: 55 } }] } } };
    else if (order?.r === true) data = opts.closeOk === false ? { status: 'ok', response: { data: { statuses: [{ error: 'no' }] } } } : { status: 'ok', response: { data: { statuses: [{ filled: { totalSz: '0.3', avgPx: '2990', oid: 77 } }] } } };
    else data = opts.entryFill === false ? { status: 'ok', response: { data: { statuses: [{ error: 'no liquidity' }] } } } : { status: 'ok', response: { data: { statuses: [{ filled: { totalSz: '0.3', avgPx: '3000', oid: 66 } }] } } };
    if (opts.networkFail && order && !order.r && !order.t?.trigger) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => data };
  };
  return { fetchImpl, calls };
}
const baseArgs = (ex, extra = {}) => ({
  privateKey: KEY, intent, market: ETH, mid: 3000, caps: HL_CAP_DEFAULTS, state: OPEN_STATE,
  nextNonce: makeNonceSource(() => 2000), fetchImpl: ex.fetchImpl, ...extra
});

{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex));
  check('happy path: ok, entry filled, stop placed', r.ok === true && r.entry?.avgPx === 3000 && r.stop?.oid === 55);
  check('happy path: order of calls is leverage → entry → stop',
    ex.calls.length === 3 && ex.calls[0].action.type === 'updateLeverage'
    && ex.calls[1].action.orders[0].b === true && ex.calls[1].action.orders[0].r === false
    && ex.calls[2].action.orders[0].b === false && ex.calls[2].action.orders[0].r === true);
  check('happy path: entry is IOC at mid + 0.5%', ex.calls[1].action.orders[0].p === '3015' && ex.calls[1].action.orders[0].t.limit.tif === 'Ioc');
  check('happy path: stop trigger at fill − 2%', r.stop.triggerPx === 2940 && ex.calls[2].action.orders[0].t.trigger.triggerPx === '2940');
  check('happy path: every request carries signature r/s/v and vaultAddress null',
    ex.calls.every((c) => c.signature && /^0x[0-9a-f]{64}$/.test(c.signature.r) && c.vaultAddress === null));
  check('happy path: nonces strictly increase across requests', ex.calls[0].nonce < ex.calls[1].nonce && ex.calls[1].nonce < ex.calls[2].nonce);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { intent: { ...intent, side: 'short' } }));
  check('short: entry sell, stop buy', r.ok && ex.calls[1].action.orders[0].b === false && ex.calls[2].action.orders[0].b === true);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { state: { currentExposureUsd: 0, dailyRealisedPnlUsd: -1000, dailyUnrealisedPnlUsd: 0 } }));
  check('caps refusal makes ZERO network calls', r.code === HL_EXEC_CODES.CAPS_REFUSED && ex.calls.length === 0);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { state: null }));
  check('missing state fails closed with no network call', r.code === HL_EXEC_CODES.CAPS_REFUSED && ex.calls.length === 0);
}
{
  const ex = fakeExchange({ leverageOk: false });
  const r = await executeIntent(baseArgs(ex));
  check('leverage failure stops before any entry', r.code === HL_EXEC_CODES.LEVERAGE_FAILED && ex.calls.length === 1);
}
{
  const ex = fakeExchange({ entryFill: false });
  const r = await executeIntent(baseArgs(ex));
  check('entry not filled: no stop is placed', r.code === HL_EXEC_CODES.NOT_FILLED && ex.calls.length === 2);
}
{
  const ex = fakeExchange({ networkFail: true });
  const r = await executeIntent(baseArgs(ex));
  check('network failure on entry is reported, not thrown', r.ok === false && r.code === HL_EXEC_CODES.NETWORK);
}
{
  const ex = fakeExchange({ stopOk: false });
  const r = await executeIntent(baseArgs(ex));
  check('stop fails → position is closed at once (reduce-only IOC)',
    r.code === HL_EXEC_CODES.STOP_FAILED_CLOSED && r.closed === true && ex.calls[3].action.orders[0].r === true && ex.calls[3].action.orders[0].b === false);
}
{
  const ex = fakeExchange({ stopOk: false, closeOk: false });
  const r = await executeIntent(baseArgs(ex));
  check('stop and close both fail → loudly reported as OPEN', r.code === HL_EXEC_CODES.STOP_FAILED_OPEN && r.closed === false);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { intent: { ...intent, notionalUsd: 5 } }));
  check('below minimum order value: refused, no calls', r.code === HL_EXEC_CODES.TOO_SMALL && ex.calls.length === 0);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { mid: 0 }));
  check('no price: refused, no calls', r.code === HL_EXEC_CODES.NO_PRICE && ex.calls.length === 0);
}

// ── engine ─────────────────────────────────────────────────────────────────
const lim = { allowedCoins: ['BTC', 'ETH'], maxLeverage: 2, maxStopLossPct: 0.05 };
const good = { coin: 'BTC', side: 'long', notionalUsd: 500, leverage: 2, stopLossPct: 0.02, rationale: 'x' };
check('valid proposal accepted', validateProposal(good, lim).ok === true);
check('DOGE refused', validateProposal({ ...good, coin: 'DOGE' }, lim).code === ENGINE_CODES.COIN_NOT_ALLOWED);
check('side "buy" refused', validateProposal({ ...good, side: 'buy' }, lim).code === ENGINE_CODES.SIDE_INVALID);
check('notional string "abc" refused', validateProposal({ ...good, notionalUsd: 'abc' }, lim).code === ENGINE_CODES.NOTIONAL_INVALID);
check('leverage 3 refused when max is 2', validateProposal({ ...good, leverage: 3 }, lim).code === ENGINE_CODES.LEVERAGE_INVALID);
check('leverage 1.5 refused (integers only)', validateProposal({ ...good, leverage: 1.5 }, lim).code === ENGINE_CODES.LEVERAGE_INVALID);
check('stop 0 refused', validateProposal({ ...good, stopLossPct: 0 }, lim).code === ENGINE_CODES.STOP_INVALID);
check('stop 0.06 refused when max is 5%', validateProposal({ ...good, stopLossPct: 0.06 }, lim).code === ENGINE_CODES.STOP_INVALID);
check('rationale is cut to 280 characters', validateProposal({ ...good, rationale: 'ا'.repeat(400) }, lim).intent.rationale.length === 280);

const rules = normalizeRules({ strategy: 'trend', maxTradesPerDay: 99, cooldownMinutes: -5, notes: 'n' });
check('rules clamp: trades ≤ 10, cooldown ≥ 0', rules.maxTradesPerDay === 10 && rules.cooldownMinutes === 0);
check('rules: unknown strategy falls back to manual', normalizeRules({ strategy: 'moon' }).strategy === 'manual');
check('rules: defaults are 3 trades and 60 minutes', normalizeRules({}).maxTradesPerDay === 3 && normalizeRules({}).cooldownMinutes === 60);
const NOW = 1_700_000_000_000;
check('daily trade limit enforced', evaluateRules(normalizeRules({ maxTradesPerDay: 2 }), { tradesToday: 2, coin: 'BTC', now: NOW }).code === ENGINE_CODES.RULE_DAILY_LIMIT);
check('cooldown enforced per coin', evaluateRules(normalizeRules({ cooldownMinutes: 60 }), { tradesToday: 0, lastTradeAtByCoin: { BTC: NOW - 10 * 60000 }, coin: 'BTC', now: NOW }).code === ENGINE_CODES.RULE_COOLDOWN);
check('cooldown on BTC does not block ETH', evaluateRules(normalizeRules({ cooldownMinutes: 60 }), { tradesToday: 0, lastTradeAtByCoin: { BTC: NOW - 10 * 60000 }, coin: 'ETH', now: NOW }).ok === true);

const prev = buildPreview(good, { mid: 60000, state: OPEN_STATE, rules: normalizeRules({}), tradesToday: 0, lastTradeAtByCoin: {}, now: NOW, market: BTC_MKT });
check('preview: margin = notional / leverage', prev.marginUsd === 250);
check('preview: worst case = notional × stop', prev.worstCaseLossUsd === 10);
check('preview: estimated stop below mid for a long', prev.estimatedStopPx === 58800);
check('preview: approvable when caps and rules pass', prev.canApprove === true);
const prevBlocked = buildPreview({ ...good, notionalUsd: 20001 }, { mid: 60000, state: OPEN_STATE, rules: normalizeRules({}), tradesToday: 0, lastTradeAtByCoin: {}, now: NOW, market: BTC_MKT });
check('preview: over the per-order cap is not approvable', prevBlocked.canApprove === false && prevBlocked.capsOk === false);

const p = createPending(good, prev, { id: 'a1', now: NOW });
check('approval within 60 s succeeds', approvePending(p, { now: NOW + 30000 }).ok === true);
check('approval after 60 s is refused', approvePending(p, { now: NOW + 61000 }).code === ENGINE_CODES.EXPIRED);
check('the same pending item cannot be approved twice',
  approvePending(approvePending(p, { now: NOW }).pending, { now: NOW }).code === ENGINE_CODES.NOT_PENDING);

let ledger = createLedger();
ledger = recordEntry(ledger, { status: 'executed', coin: 'BTC', at: NOW - 1000 });
ledger = recordEntry(ledger, { status: 'rejected', coin: 'ETH', at: NOW - 500 });
check('ledger counts executed only', tradesSince(ledger, NOW - 5000) === 1);
check('ledger last trade time per coin, executed only', lastTradeTimes(ledger).BTC === NOW - 1000 && lastTradeTimes(ledger).ETH === undefined);

// ── AI parsing and the BYOK call ───────────────────────────────────────────
check('extractJson handles code fences', extractJson('```json\n{"proposals":[]}\n```')?.proposals.length === 0);
check('extractJson returns null for prose', extractJson('I think you should buy') === null);
const parsed = parseProposals('{"proposals":[{"coin":"BTC","side":"long","notionalUsd":100,"leverage":2,"stopLossPct":0.02,"rationale":"ok"},{"coin":"SOL","side":"long","notionalUsd":100,"leverage":2,"stopLossPct":0.02}]}', lim);
check('parseProposals keeps the valid one and reports the dropped one',
  parsed.ok && parsed.proposals.length === 1 && parsed.dropped[0] === ENGINE_CODES.COIN_NOT_ALLOWED);
check('parseProposals rejects a non-JSON reply as BAD_OUTPUT', parseProposals('buy now!!', lim).code === AI_CLIENT_CODES.BAD_OUTPUT);

{
  const SECRET = 'sk-test-SECRET-VALUE-123';
  let seen = null;
  let requests = 0;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    requests += 1;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"proposals":[]}' } }] }) };
  };
  const msgs = buildAnalystMessages({ rules: normalizeRules({}), caps: HL_CAP_DEFAULTS, account: {}, mids: {}, candles: [] });
  const r = await requestProposals({ apiKey: SECRET, model: 'm', messages: msgs, limits: lim, fetchImpl });
  check('AI key goes only in the Authorization header', seen.init.headers.authorization === `Bearer ${SECRET}`);
  check('AI key is absent from the body and the result', !seen.init.body.includes(SECRET) && !JSON.stringify(r).includes(SECRET));
  check('AI call succeeds with an empty proposal list', r.ok === true && r.proposals.length === 0);
  check('AI makes exactly one request, to the AI endpoint, never to Hyperliquid', requests === 1 && !String(seen.url).includes('hyperliquid'));
  check('AI result carries no order, action or signature payload', !/signature|"action"|orders|"nonce"/.test(JSON.stringify(r)));
  check('AI http endpoint is refused', (await requestProposals({ apiKey: SECRET, endpoint: 'http://x.example/v1', messages: msgs, limits: lim, fetchImpl })).code === AI_CLIENT_CODES.NOT_HTTPS);
  check('AI call without a key is refused', (await requestProposals({ apiKey: '', messages: msgs, limits: lim, fetchImpl })).code === AI_CLIENT_CODES.NO_KEY);
}

// ── market parsing ─────────────────────────────────────────────────────────
check('parseMarkets joins universe and contexts by index',
  parseMarkets({ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }, { name: 'ETH', szDecimals: 4, maxLeverage: 25 }] },
    [{ dayNtlVlm: '2000000000', markPx: '60000', midPx: '60001' }, { dayNtlVlm: '800000000', markPx: '3000', midPx: '3000.5' }]).markets.ETH
    .midPx === 3000.5);
check('parseMarkets rejects a missing universe', parseMarkets({}).ok === false);
{
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [
    { closedPnl: '12.5', fee: '0.4' }, { closedPnl: '-3', fee: '0.1' }, { closedPnl: '0', fee: '0.2' }
  ] });
  const r = await fetchRealisedSince('0x2c7536E3605D9C16a7a3D7b1898e529396a65c23', NOW, { fetchImpl });
  check('realised PnL = sum(closedPnl) − sum(fee)', r.ok && Math.abs(r.realisedPnlUsd - 8.8) < 1e-9 && r.fillCount === 3);
  const bad = await fetchRealisedSince('0x2c7536E3605D9C16a7a3D7b1898e529396a65c23', NOW, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => [{ closedPnl: null, fee: '1' }] }) });
  check('a fill with a missing PnL makes the total unknown', bad.ok === false);
}
{
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [{ t: 1, o: '1', h: '2', l: '0.5', c: '1.5', v: '3' }, { t: 2, c: null }] });
  const r = await fetchCandles('BTC', { now: NOW }, { fetchImpl });
  check('candles drop rows without a close price', r.ok && r.candles.length === 1 && r.candles[0].c === 1.5);
}

// ── many markets: varied decimals, leverage ceilings, isolated-only, thin books ──
const NAMES = ['BTC', 'ETH', 'SOL', 'kPEPE', 'DOGE', 'HYPE', 'ARB', 'WIF', 'SUI', 'AVAX', 'LINK', 'OP', 'APT', 'TIA', 'SEI',
  'INJ', 'RUNE', 'ATOM', 'NEAR', 'FTM', 'BONK', 'PENDLE', 'TON', 'ADA', 'XRP', 'LTC', 'BCH', 'ONDO', 'JUP', 'ENA'];
const universe = NAMES.map((name, i) => ({ name, szDecimals: i % 6, maxLeverage: [3, 5, 10, 20, 40, 50][i % 6], onlyIsolated: i % 4 === 3 }));
const price = (i) => [95000, 3500, 0.42, 0.0123, 0.0000523, 25][i % 6] * (1 + (i % 3) * 0.1);
const ctxs = NAMES.map((_, i) => {
  const vol = i % 5 === 4 ? 1000000 : 40000000 + i * 9000000; // every 5th market is thin
  return { dayNtlVlm: String(vol), markPx: String(price(i)), midPx: String(price(i)), openInterest: '1' };
});
const manyParsed = parseMarkets({ universe }, ctxs);
check("many markets: all 30 names parsed, lowercase k-prefixed names kept", manyParsed.ok && Object.keys(manyParsed.markets).length === 30 && manyParsed.markets.kPEPE !== undefined);
const live = eligibleMarkets(manyParsed.markets, { minVolumeUsd: MIN_MARKET_VOLUME_USD });
check('many markets: thin books (under the floor) are not offered', live.length === 24 && live.every((m) => m.dayNtlVlm >= MIN_MARKET_VOLUME_USD));
check('many markets: busiest first', live.every((m, i) => i === 0 || live[i - 1].dayNtlVlm >= m.dayNtlVlm));

const wireDecimals = (x) => (String(x).split('.')[1] || '').length;
let manySigned = 0;
let manyWireOk = 0;
const manyFailures = [];
for (const m of live) {
  const mid = m.midPx;
  const notional = Math.min(2000, m.dayNtlVlm * 0.005);
  const lev = Math.min(2, m.maxLeverage);
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const a = body.action;
    const o = a.orders?.[0];
    let data;
    if (a.type === 'updateLeverage') data = { status: 'ok', response: { type: 'default' } };
    else if (o?.t?.trigger) data = { status: 'ok', response: { data: { statuses: [{ resting: { oid: 2 } }] } } };
    else data = { status: 'ok', response: { data: { statuses: [{ filled: { totalSz: String(o.s), avgPx: String(mid), oid: 1 } }] } } };
    return { ok: true, status: 200, json: async () => data };
  };
  const r = await executeIntent({
    privateKey: KEY, intent: { coin: m.coin, side: 'long', notionalUsd: notional, leverage: lev, stopLossPct: 0.02 },
    market: m, mid, caps: { ...HL_CAP_DEFAULTS, allowedCoins: NAMES }, state: OPEN_STATE, nextNonce: makeNonceSource(() => 5000 + manySigned), fetchImpl
  });
  if (!r.ok) { manyFailures.push(`${m.coin}:${r.code}`); continue; }
  let good = true;
  for (const c of calls) {
    const sig = await verifyTypedData(
      { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
      { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
      { source: 'a', connectionId: actionHash(c.action, c.nonce) }, c.signature
    );
    if (sig.toLowerCase() !== (await agentAddressAsync(KEY)).toLowerCase()) good = false;
    manySigned += 1;
  }
  for (const order of calls.filter((c) => c.action.type === 'order').flatMap((c) => c.action.orders)) {
    if (wireDecimals(order.s) > m.szDecimals) good = false;
    if (wireDecimals(order.p) > Math.max(0, 6 - m.szDecimals)) good = false;
  }
  const lv = calls.find((c) => c.action.type === 'updateLeverage');
  if (lv.action.isCross !== !m.onlyIsolated || lv.action.leverage !== lev) good = false;
  if (good) manyWireOk += 1; else manyFailures.push(`${m.coin}:shape`);
}
// Acceptable refusals, both before anything is sent: the order rounds to zero size, or the price has no valid tick under the
// venue's 6 − szDecimals rule (the synthetic set pairs some tiny prices with 5 size decimals, which real listings do not do).
const acceptableRefusal = (f) => f.endsWith('HL_EXEC_TOO_SMALL') || f.endsWith('HL_EXEC_BAD_PRICE');
check(`many markets: every executed order signs to the agent address and has valid wire shape (${manyWireOk}/${live.length})`,
  manyFailures.every(acceptableRefusal) && manyWireOk >= live.length - manyFailures.length && manyWireOk >= live.length * 0.6 && manySigned >= manyWireOk * 3);
check('many markets: isolated-only markets get isolated leverage', live.some((m) => m.onlyIsolated));

{
  const m = manyParsed.markets.BTC;
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { intent: { ...intent, coin: 'BTC', leverage: 2 }, market: { ...m, maxLeverage: 1 } }));
  check('leverage above THIS market’s ceiling refused, nothing sent', r.code === HL_EXEC_CODES.LEVERAGE_OVER_MARKET && ex.calls.length === 0);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { intent: { ...intent, notionalUsd: 9000 }, market: { ...ETH, dayNtlVlm: 500000 } }));
  check('order over 1% of the market’s 24h volume refused, nothing sent', r.code === HL_EXEC_CODES.THIN_MARKET && ex.calls.length === 0);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { market: { ...ETH, dayNtlVlm: null } }));
  check('unknown volume refused (fail closed)', r.code === HL_EXEC_CODES.THIN_MARKET && ex.calls.length === 0);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { market: { ...ETH, maxLeverage: null } }));
  check('unknown leverage ceiling refused (fail closed)', r.code === HL_EXEC_CODES.UNKNOWN_MARKET && ex.calls.length === 0);
}
{
  const ex = fakeExchange();
  const tiny = { asset: 9, szDecimals: 5, maxLeverage: 5, onlyIsolated: false, dayNtlVlm: 50000000, midPx: 0.0000523 };
  const r = await executeIntent(baseArgs(ex, { market: tiny, mid: 0.0000523, intent: { ...intent, notionalUsd: 1000 } }));
  check('a price that rounds to zero is refused BEFORE the leverage change is sent',
    r.code === HL_EXEC_CODES.BAD_PRICE && ex.calls.length === 0);
}
{
  const ex = fakeExchange();
  const r = await executeIntent(baseArgs(ex, { market: { ...ETH, onlyIsolated: true } }));
  check('isolated-only market: leverage is set isolated', ex.calls[0].action.isCross === false && r.ok === true);
}
check('engine: market verdict flags leverage above the market ceiling',
  marketVerdict({ notionalUsd: 100, leverage: 9 }, { asset: 1, dayNtlVlm: 1e9, maxLeverage: 5 }).code === 'ENG_LEVERAGE_OVER_MARKET');

// ── architecture: only the executor can sign or send; the brain cannot ───────
const srcOf = (f) => readFileSync(new URL(`../src/lib/hyperliquid/${f}`, import.meta.url), 'utf8');
for (const brain of ['aiClient.js', 'engine.js', 'market.js', 'intents.js']) {
  let text = '';
  try { text = srcOf(brain); } catch { text = ''; }
  if (!text) continue;
  check(`${brain} cannot sign`, !/signL1Action|signTypedData|new Wallet\(|from 'ethers'|from '\.\/signing/.test(text));
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(`${brain} cannot send to /exchange or call the executor`,
    !/['"`]\/exchange|HL_EXCHANGE_URL|executeIntent\(|postL1Action\(|from '\.\/exchangeOps/.test(code));
}
check('aiClient posts only to the user-supplied endpoint', /fetchImpl\(url\.toString\(\)/.test(srcOf('aiClient.js')));
check('only exchangeOps.js holds /exchange', srcOf('exchangeOps.js').includes('/exchange') || srcOf('exchangeOps.js').includes('HL_EXCHANGE_URL'));
check('the executor refuses without re-checking caps', /checkOrderAgainstCaps\(/.test(srcOf('exchangeOps.js')));

console.log(`hyperliquid-trade-units: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
