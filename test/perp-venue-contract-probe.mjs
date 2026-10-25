#!/usr/bin/env node
/**
 * The dYdX argument contract, checked against the vendor's OWN code.
 * ============================================================================
 *
 * ─── THE BUG THIS PROBE EXISTS BECAUSE OF ────────────────────────────────────
 *   «سفارش لیمیت dYdX → هیچ اتفاقی نمی‌افتد»
 *
 * `placeDydxOrder({ orderType: 'limit' })` passed `undefined` for the eighth
 * positional argument of `CompositeClient.placeOrder` (`timeInForce`). The
 * pinned SDK refuses that combination before anything is signed:
 *
 *   calculateOrderFlags(OrderType.LIMIT, undefined)
 *     → throws 'timeInForce must be set if orderType is LIMIT'
 *
 * MARKET orders were unaffected — `calculateOrderFlags(MARKET, undefined)`
 * returns SHORT_TERM without reading the time-in-force — which is why the
 * screen passed every test that traded and failed every one that rested an
 * order. Two more arguments are mandatory for a resting limit and were also
 * missing: `goodTilTimeInSeconds` (LONG_TERM orders carry an absolute expiry)
 * and `postOnly` (which must be a BOOLEAN, not undefined, for LIMIT + GTT).
 *
 * The stateful cancel had the mirror-image bug: `cancelOrder` requires
 * `goodTilBlock` to be EXACTLY 0 for a LONG_TERM or CONDITIONAL order, and we
 * passed `undefined`, so cancelling a TP/SL order threw
 * 'goodTilBlock should be zero since LONG_TERM or CONDITIONAL orders use
 * goodTilTimeInSeconds instead of goodTilBlock.'
 *
 * ─── WHY THE VENDOR'S CODE IS THE ORACLE HERE ────────────────────────────────
 * These are not our rules. Asserting them against a paraphrase would prove
 * only that we agree with ourselves, so this probe calls the pinned 3.4.0
 * build's own helpers — the functions that actually throw in production — with
 * the exact tuples src/lib/dydx.js now produces. The package is pinned with no
 * caret (3.4.1, 1.22.1, 1.15.2 and 1.0.31 were compromised in the January 2026
 * npm supply-chain attack), so the build under test is the build that ships.
 *
 * No network, no wallet, no signature.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { orderFlagsFor } from '../src/lib/dydx.js';
import { PERP_KIND, planDydxOrder } from '../src/lib/perpOrders.js';

const require = createRequire('/home/user/fbtcryp/node_modules/@dydxprotocol/v4-client-js/');
const { OrderType, OrderTimeInForce, OrderExecution, OrderFlags } = require('./build/cjs/src/index.js');
const helpers = require('./build/cjs/src/clients/helpers/chain-helpers.js');
const validation = require('./build/cjs/src/lib/validation.js');

const pkg = JSON.parse(readFileSync('/home/user/fbtcryp/node_modules/@dydxprotocol/v4-client-js/package.json', 'utf8'));
const src = readFileSync('/home/user/fbtcryp/src/lib/dydx.js', 'utf8');

const MARKET = {
  ticker: 'BTC-USD',
  status: 'ACTIVE',
  oraclePrice: 100000,
  raw: { ticker: 'BTC-USD', tickSize: '1', stepBaseQuantums: 1000000, atomicResolution: -10 }
};

const throws = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };

/* ── 0. the pinned version is the one this contract was read from ─────────── */
assert.equal(pkg.version, '3.4.0', 'the SDK is pinned exactly; this probe reads that build');

/* ── 1. the bug, reproduced against the vendor's own helper ───────────────── */
{
  const before = throws(() => helpers.calculateOrderFlags(OrderType.LIMIT, undefined));
  assert.match(before || '', /timeInForce must be set if orderType is LIMIT/,
    'LIMIT without a time-in-force throws — this is the bug the fix exists for');

  /* MARKET is why it went unnoticed: the same missing argument is legal. */
  assert.equal(helpers.calculateOrderFlags(OrderType.MARKET, undefined), OrderFlags.SHORT_TERM);
}

/* ── 2. the tuple our lib now sends is accepted, and means what we say ────── */
{
  const plan = planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: MARKET, side: 'buy', size: 0.001, price: 90000 });
  assert.equal(plan.ok, true);
  const r = plan.request;

  const flags = helpers.calculateOrderFlags(OrderType[r.orderType], OrderTimeInForce[r.timeInForce]);
  assert.equal(flags, OrderFlags.LONG_TERM, 'LIMIT + GTT is a LONG_TERM order — the one that rests on the book');

  /* postOnly must be a boolean; undefined throws for exactly this pair. */
  assert.match(throws(() => helpers.calculateTimeInForce(OrderType.LIMIT, OrderTimeInForce.GTT, OrderExecution[r.execution], undefined)) || '',
    /postOnly must be set if order type is LIMIT and timeInForce is GTT/);
  const tif = helpers.calculateTimeInForce(OrderType.LIMIT, OrderTimeInForce.GTT, OrderExecution[r.execution], r.postOnly);
  assert.equal(typeof tif, 'number', 'the accepted tuple produces a time-in-force instead of throwing');

  /* A stateful order must carry an absolute lifetime; the SDK throws without
     it, and the plan is where that number comes from. */
  assert.equal(validation.isStatefulOrder(flags), true);
  assert.ok(Number.isFinite(r.goodTilTimeInSeconds) && r.goodTilTimeInSeconds >= 60,
    'the plan carries the lifetime a LONG_TERM order requires');

  /* Our stored record has to know how to cancel itself. */
  assert.equal(orderFlagsFor(r.orderType, r.timeInForce), 'LONG_TERM');
}

/* ── 3. the trigger tuple: CONDITIONAL, IOC, and no time-in-force ─────────── */
{
  const plan = planDydxOrder({ kind: PERP_KIND.ENTRY_STOP, market: MARKET, side: 'buy', size: 0.002, price: 105000, currentPrice: 100000 });
  assert.equal(plan.ok, true);
  const r = plan.request;

  const flags = helpers.calculateOrderFlags(OrderType[r.orderType], undefined);
  assert.equal(flags, OrderFlags.CONDITIONAL, 'a stop entry is a CONDITIONAL order');
  assert.equal(r.timeInForce, null, 'a conditional order carries no time-in-force');
  /* Order_TimeInForce.TIME_IN_FORCE_IOC === 1 in the proto the SDK ships. */
  assert.equal(helpers.calculateTimeInForce(OrderType[r.orderType], undefined, OrderExecution[r.execution], false), 1,
    'IOC execution is what a triggered market order is sent with');

  /* DEFAULT and POST_ONLY are refused for the market-trigger types, which is
     why IOC is not a stylistic choice. */
  for (const bad of ['DEFAULT', 'POST_ONLY']) {
    assert.match(throws(() => helpers.calculateTimeInForce(OrderType.STOP_MARKET, undefined, OrderExecution[bad], false)) || '',
      /not supported for STOP_MARKET or TAKE_PROFIT_MARKET/, `${bad} is not a valid execution for STOP_MARKET`);
  }
  assert.equal(orderFlagsFor(r.orderType, r.timeInForce), 'CONDITIONAL');
  assert.equal(helpers.calculateConditionType(OrderType.STOP_MARKET), 1, 'STOP condition type');
}

/* ── 4. orderFlagsFor agrees with the SDK for every type we can produce ───── */
{
  const cases = [
    ['LIMIT', 'GTT', OrderFlags.LONG_TERM],
    ['LIMIT', 'IOC', OrderFlags.SHORT_TERM],
    ['LIMIT', 'FOK', OrderFlags.SHORT_TERM],
    ['MARKET', null, OrderFlags.SHORT_TERM],
    ['STOP_MARKET', null, OrderFlags.CONDITIONAL],
    ['STOP_LIMIT', null, OrderFlags.CONDITIONAL],
    ['TAKE_PROFIT_MARKET', null, OrderFlags.CONDITIONAL],
    ['TAKE_PROFIT_LIMIT', null, OrderFlags.CONDITIONAL]
  ];
  for (const [type, tif, expected] of cases) {
    const sdkType = OrderType[type === 'TAKE_PROFIT_LIMIT' ? 'TAKE_PROFIT_LIMIT' : type];
    const sdkTif = tif == null ? undefined : OrderTimeInForce[tif];
    /* The SDK throws for LIMIT with no time-in-force, which is the case we do
       not produce; skip only that one rather than weakening the assertion. */
    if (type === 'LIMIT' && tif == null) continue;
    assert.equal(helpers.calculateOrderFlags(sdkType, sdkTif), expected, `SDK flags for ${type}/${tif}`);
    assert.equal(orderFlagsFor(type, tif), expected === OrderFlags.LONG_TERM ? 'LONG_TERM'
      : expected === OrderFlags.CONDITIONAL ? 'CONDITIONAL' : 'SHORT_TERM', `our map for ${type}/${tif}`);
  }
}

/* ── 5. the cancel rule, in the vendor's own words ────────────────────────── */
{
  const composite = readFileSync(
    '/home/user/fbtcryp/node_modules/@dydxprotocol/v4-client-js/build/cjs/src/clients/composite-client.js', 'utf8');
  assert.match(composite, /goodTilBlock should be zero since LONG_TERM or CONDITIONAL orders/,
    'the SDK still requires an exact zero goodTilBlock for a stateful cancel');

  /* And we now send it. `stateful ? 0 : undefined` is the line that makes a
     cancel of a resting limit or a trigger order possible at all. */
  assert.match(src, /stateful \? 0 : undefined/, 'cancelDydxOrder passes exactly 0 for a stateful order');
  assert.match(src, /stateful \? seconds : 0/, '...and no lifetime for a short-term one');
  assert.match(src, /if \(flags !== 'CONDITIONAL' && flags !== 'LONG_TERM' && flags !== 'SHORT_TERM'\)/,
    'an unknown flag name is refused before the SDK is loaded');

  /* The placement side of the same contract. */
  assert.match(src, /timeInForce: isLimit \? 'GTT' : null/, 'an auto limit order is sent as GTT');
  assert.match(src, /goodTilTimeInSeconds: seconds/, '...with the lifetime it requires');
  /* `postOnly` is argument 11, and LIMIT + GTT throws unless it is a boolean —
     which is why every call site passes the literal, never undefined and never
     a ternary whose branches could disagree. */
  const postOnly = [...src.matchAll(/postOnly: ([^,\n]+)/g)].map((m) => m[1].trim());
  assert.ok(postOnly.length >= 4, `every order path sets postOnly explicitly (${postOnly.length} found)`);
  assert.ok(postOnly.every((v) => v === 'false'),
    `postOnly is always the boolean false, got: ${JSON.stringify(postOnly)}`);
}

/* ── 6. the builder fee still rides inside the signed order ───────────────── */
{
  /* The fee rides inside the signed order, and the twenty-two positional
     arguments — including that one — are written down in exactly ONE place.
     Three call sites used to spell them out, which is how argument 8 came to
     be wrong in one of them and right in the others. */
  const feeArg = (src.match(/\{ builderAddress: DYDX_BUILDER_ADDRESS, feePpm: DYDX_BUILDER_FEE_PPM \}/g) || []).length;
  assert.equal(feeArg, 1, 'the builder-fee argument is passed at one call site only');
  const sends = (src.match(/client\.placeOrder\(/g) || []).length;
  assert.equal(sends, 1, 'and there is exactly one placeOrder call in the module');
  assert.equal((src.match(/client\.cancelOrder\(/g) || []).length, 1, '...and one cancelOrder call');
}

console.log('perp venue contract probe: ok');
export default [];
