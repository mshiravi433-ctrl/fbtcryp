/* Units for signing, formatting, executor, engine, AI parsing, market parsing.
 * No network: every request goes through an injected fake fetch. */
import { readFileSync } from 'node:fs';
import { actionHash, signL1Action, agentAddress } from '../src/lib/hyperliquid/signing.js';
import {
  toWire, roundPrice, roundSize, orderAction, stopAction, parseOrderStatuses,
  makeNonceSource, executeIntent, HL_EXEC_CODES
} from '../src/lib/hyperliquid/exchangeOps.js';
import {
  validateProposal, normalizeRules, evaluateRules, buildPreview, createPending,
  approvePending, createLedger, recordEntry, tradesSince, lastTradeTimes, ENGINE_CODES
} from '../src/lib/hyperliquid/engine.js';
import { extractJson, parseProposals, requestProposals, buildAnalystMessages, AI_CLIENT_CODES } from '../src/lib/hyperliquid/aiClient.js';
import { parseMeta, fetchRealisedSince, fetchCandles } from '../src/lib/hyperliquid/market.js';
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
check('agent address derived from key matches SDK', agentAddress(vec.keyForVectors) === vec.address);
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
const ETH = { asset: 1, szDecimals: 4 };
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
  check('happy path: entry is IOC at mid + 0.3%', ex.calls[1].action.orders[0].p === '3009' && ex.calls[1].action.orders[0].t.limit.tif === 'Ioc');
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

const prev = buildPreview(good, { mid: 60000, state: OPEN_STATE, rules: normalizeRules({}), tradesToday: 0, lastTradeAtByCoin: {}, now: NOW });
check('preview: margin = notional / leverage', prev.marginUsd === 250);
check('preview: worst case = notional × stop', prev.worstCaseLossUsd === 10);
check('preview: estimated stop below mid for a long', prev.estimatedStopPx === 58800);
check('preview: approvable when caps and rules pass', prev.canApprove === true);
const prevBlocked = buildPreview({ ...good, notionalUsd: 20001 }, { mid: 60000, state: OPEN_STATE, rules: normalizeRules({}), tradesToday: 0, lastTradeAtByCoin: {}, now: NOW });
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
check('system prompt tells the model it cannot execute', buildAnalystMessages({ rules: normalizeRules({}), caps: HL_CAP_DEFAULTS, account: {}, mids: {}, candles: [] })[0].content.includes('You do not execute anything'));

{
  const SECRET = 'sk-test-SECRET-VALUE-123';
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"proposals":[]}' } }] }) };
  };
  const msgs = buildAnalystMessages({ rules: normalizeRules({}), caps: HL_CAP_DEFAULTS, account: {}, mids: {}, candles: [] });
  const r = await requestProposals({ apiKey: SECRET, model: 'm', messages: msgs, limits: lim, fetchImpl });
  check('AI key goes only in the Authorization header', seen.init.headers.authorization === `Bearer ${SECRET}`);
  check('AI key is absent from the body and the result', !seen.init.body.includes(SECRET) && !JSON.stringify(r).includes(SECRET));
  check('AI call succeeds with an empty proposal list', r.ok === true && r.proposals.length === 0);
  check('AI http endpoint is refused', (await requestProposals({ apiKey: SECRET, endpoint: 'http://x.example/v1', messages: msgs, limits: lim, fetchImpl })).code === AI_CLIENT_CODES.NOT_HTTPS);
  check('AI call without a key is refused', (await requestProposals({ apiKey: '', messages: msgs, limits: lim, fetchImpl })).code === AI_CLIENT_CODES.NO_KEY);
}

// ── market parsing ─────────────────────────────────────────────────────────
check('parseMeta maps name → asset index and szDecimals',
  parseMeta({ universe: [{ name: 'BTC', szDecimals: 5 }, { name: 'ETH', szDecimals: 4 }] }).markets.ETH.asset === 1);
check('parseMeta rejects a missing universe', parseMeta({}).ok === false);
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
