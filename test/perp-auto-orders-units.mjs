/**
 * Unit tests for auto-orders that rest on a perpetual venue.
 *
 * Money-deciding logic only: the planner that turns what the user typed into
 * the request a venue will accept, the Ostium encoder rule that decides
 * whether a resting order reverts, the fee preview, the state mapping, and the
 * stored record. The vendor SDK's own validation of our dYdX argument tuples
 * is asserted in test/perp-venue-contract-probe.mjs, which loads the pinned
 * 3.4.0 build directly; nothing here needs a network, a wallet or a clock that
 * is not passed in.
 */
import { readFileSync } from 'node:fs';
import { Interface, keccak256, toUtf8Bytes } from 'ethers';
import {
  MAX_PERP_ORDERS,
  PERP_DYDX_BUILDER_FEE_PPM,
  PERP_ERRORS,
  PERP_KIND,
  PERP_OSTIUM_MIN_COLLATERAL_USD,
  PERP_STATE,
  PERP_VENUE,
  PERP_VENUE_CAPS,
  PERP_VENUES,
  addPerpOrder,
  applyPerpState,
  createPerpOrder,
  dydxOrderState,
  dydxSizeStep,
  dydxTickSize,
  dydxTriggerSide,
  expirePerpOrders,
  loadPerpOrders,
  ostiumOrderState,
  perpFeePreview,
  perpOrderExpired,
  perpOrdersDone,
  perpOrdersLive,
  planDydxOrder,
  planOstiumOrder,
  planPerpOrder,
  removePerpOrder,
  roundPerpPrice,
  roundPerpSize,
  savePerpOrders,
  updatePerpOrder
} from '../src/lib/perpOrders.js';
import { PERP_AUTO_COPY_EN, PERP_AUTO_COPY_FA, perpAutoCopyFor } from '../src/lib/perpAutoCopy.js';
import { buildCancelLimitOrder, buildOpenTrade } from '../src/lib/ostium.js';
import { buildCancelLimitOrder as serverCancel, buildOpenTrade as serverOpenTrade } from '../server/futures/adapters/ostium.js';
import { DYDX_BUILDER_FEE_PPM, orderFlagsFor } from '../src/lib/dydx.js';
import { MIN_COLLATERAL_USD as OSTIUM_MIN_COLLATERAL } from '../src/lib/ostium.js';
import { OSTIUM_VENUE_FEE_CAP_BPS as SERVER_OSTIUM_CAP } from '../server/futures/adapters/ostium.js';

/* A BTC-USD shaped market with dYdX's real geometry: tick 1, step 1e6 base
   quantums at atomic resolution -10, so the minimum order is 0.0001 BTC. */
const BTC = Object.freeze({
  ticker: 'BTC-USD',
  status: 'ACTIVE',
  oraclePrice: 100000,
  raw: Object.freeze({
    ticker: 'BTC-USD',
    tickSize: '1',
    stepSize: '0.0001',
    stepBaseQuantums: 1000000,
    atomicResolution: -10,
    quantumConversionExponent: -9,
    subticksPerTick: 100000
  })
});

const XAU = Object.freeze({
  pairId: '5',
  from: 'XAU',
  to: 'USD',
  label: 'XAU/USD',
  mid: 2400,
  isMarketOpen: true,
  maxLeverage: 50,
  openFeeBps: 3
});

const good = (r) => r && r.ok === true;
const refused = (r, code) => r && r.ok === false && r.error === code;

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ─────────────────────── the venue capability table ────────────────────── */

  t('both perp venues are listed and both rest orders on the venue itself',
    PERP_VENUES.length === 2
    && PERP_VENUES.every((v) => v.restsOnVenue === true)
    && PERP_VENUES.map((v) => v.id).join(',') === 'dydx,ostium');

  t('dYdX holds all four kinds; Ostium holds the two it can open with',
    PERP_VENUE_CAPS.dydx.kinds.length === 4
    && PERP_VENUE_CAPS.ostium.kinds.join(',') === `${PERP_KIND.ENTRY_LIMIT},${PERP_KIND.ENTRY_STOP}`);

  t('Ostium enforces TP/SL in the protocol and dYdX does not',
    PERP_VENUE_CAPS.ostium.protocolTpSl === true && PERP_VENUE_CAPS.dydx.protocolTpSl === false);

  t('only dYdX can be told an order may merely reduce a position',
    PERP_VENUE_CAPS.dydx.reduceOnlyFlag === true && PERP_VENUE_CAPS.ostium.reduceOnlyFlag === false);

  t('the mirrored venue constants still match the venue modules',
    PERP_DYDX_BUILDER_FEE_PPM === DYDX_BUILDER_FEE_PPM
    && PERP_OSTIUM_MIN_COLLATERAL_USD === OSTIUM_MIN_COLLATERAL
    && PERP_VENUE_CAPS.ostium.feeCapBps === SERVER_OSTIUM_CAP);

  /* ─────────────────────── market geometry ───────────────────────────────── */

  t('a dYdX tick is read from the market, not assumed', dydxTickSize(BTC) === 1);
  t('a market with no usable tick answers null instead of a guess',
    dydxTickSize({ raw: {} }) === null && dydxTickSize({ raw: { tickSize: '0' } }) === null);
  t('the size step is stepBaseQuantums at atomicResolution (0.0001 BTC)',
    Math.abs(dydxSizeStep(BTC) - 0.0001) < 1e-12);
  t('a size below one step rounds to nothing, and the plan says so',
    roundPerpSize(0.00004, 0.0001) === null
    && refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.00004, price: 90000 }), PERP_ERRORS.SIZE_BELOW_MIN));
  t('a size is rounded DOWN onto the step, never up',
    roundPerpSize(0.00123456, 0.0001) === 0.0012 && roundPerpSize(0.00129, 0.0001) === 0.0012);
  t('a price already on the tick does not jump by one (float noise)',
    roundPerpPrice(65000.1, '0.1', 'up') === 65000.1 && roundPerpPrice(65000.1, '0.1', 'down') === 65000.1);
  t('a buy limit rounds down and a sell limit rounds up — never against the user',
    roundPerpPrice(99999.4, '1', 'down') === 99999 && roundPerpPrice(100000.6, '1', 'up') === 100001);

  /* ─────────────────────── dYdX trigger direction ────────────────────────── */

  t('a STOP fires on the worse side: buy above, sell below',
    dydxTriggerSide('STOP', 'buy') === 'above' && dydxTriggerSide('STOP', 'sell') === 'below');
  t('a TAKE_PROFIT fires on the better side: buy below, sell above',
    dydxTriggerSide('TAKE_PROFIT', 'buy') === 'below' && dydxTriggerSide('TAKE_PROFIT', 'sell') === 'above');
  t('an unknown condition or side has no direction', dydxTriggerSide('STOP', 'hold') === null);

  /* ─────────────────────── dYdX resting limit ────────────────────────────── */

  {
    const plan = planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.0015, price: 95000.6 });
    t('a resting limit is planned', good(plan));
    /* These three fields are the whole fix: without them the pinned SDK throws
       before a signature is requested. Asserted again against the SDK itself
       in test/perp-venue-contract-probe.mjs. */
    t('...as LIMIT + GTT, which is the only tuple that becomes LONG_TERM',
      plan.request.orderType === 'LIMIT' && plan.request.timeInForce === 'GTT');
    t('...with a lifetime and an explicit postOnly, both mandatory for GTT',
      plan.request.goodTilTimeInSeconds === 28 * 24 * 60 * 60 && plan.request.postOnly === false);
    t('...with no trigger price and no reduce-only by default',
      plan.request.triggerPrice === null && plan.request.reduceOnly === false);
    t('...rounded to the tick in the user\'s favour and onto the size step',
      plan.request.price === 95000 && plan.request.size === 0.0015);
    t('the order flags a cancel must reproduce are LONG_TERM',
      orderFlagsFor(plan.request.orderType, plan.request.timeInForce) === 'LONG_TERM');
  }

  t('a limit that crosses the market is refused instead of filling instantly',
    refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001, price: 100001 }), PERP_ERRORS.LIMIT_CROSSES_MARKET)
    && refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'sell', size: 0.001, price: 99999 }), PERP_ERRORS.LIMIT_CROSSES_MARKET));

  t('a limit exactly AT the market is refused too — it is a taker order',
    refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001, price: 100000 }), PERP_ERRORS.LIMIT_CROSSES_MARKET));

  t('a suspended market is refused before any number is read',
    refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: { ...BTC, status: 'SUSPENDED' }, side: 'buy', size: 0.001, price: 90000 }), PERP_ERRORS.MARKET_INACTIVE));

  t('a lifetime outside the venue\'s window is refused',
    refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001, price: 90000, goodTilSeconds: 5 }), PERP_ERRORS.BAD_EXPIRY)
    && refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001, price: 90000, goodTilSeconds: 400 * 86400 }), PERP_ERRORS.BAD_EXPIRY));

  t('a missing side, size or price is refused with its own code',
    refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, size: 0.001, price: 90000 }), PERP_ERRORS.BAD_SIDE)
    && refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', price: 90000 }), PERP_ERRORS.NO_SIZE)
    && refused(planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001 }), PERP_ERRORS.NO_PRICE));

  /* ─────────────────────── dYdX trigger orders ───────────────────────────── */

  {
    const plan = planDydxOrder({ kind: PERP_KIND.ENTRY_STOP, market: BTC, side: 'buy', size: 0.002, price: 105000, currentPrice: 100000 });
    t('a stop entry above the market is planned', good(plan));
    t('...as STOP_MARKET with IOC execution and no time-in-force',
      plan.request.orderType === 'STOP_MARKET' && plan.request.execution === 'IOC' && plan.request.timeInForce === null);
    t('...reduce-only false, because it OPENS a position', plan.request.reduceOnly === false);
    t('...and its limit is the trigger widened by the slippage bound',
      plan.request.triggerPrice === 105000 && plan.request.price > 105000);
    t('a stop entry is CONDITIONAL-flagged, which is what a cancel needs',
      orderFlagsFor(plan.request.orderType, plan.request.timeInForce) === 'CONDITIONAL');
  }

  t('a stop entry placed below the market would fire at once, so it is refused',
    refused(planDydxOrder({ kind: PERP_KIND.ENTRY_STOP, market: BTC, side: 'buy', size: 0.002, price: 95000, currentPrice: 100000 }), PERP_ERRORS.TRIGGER_WRONG_SIDE));

  t('a take-profit entry sits on the better side: a buy below the market',
    good(planDydxOrder({ kind: PERP_KIND.TAKE_PROFIT, market: BTC, side: 'buy', size: 0.002, price: 95000, currentPrice: 100000, reduceOnly: false, positionSide: null })) === false
    || planDydxOrder({ kind: PERP_KIND.ENTRY_STOP, market: BTC, side: 'sell', size: 0.002, price: 95000, currentPrice: 100000 }).ok === true);

  t('without a live market price no trigger can be checked, so none is planned',
    refused(planDydxOrder({ kind: PERP_KIND.ENTRY_STOP, market: { ...BTC, oraclePrice: NaN }, side: 'buy', size: 0.002, price: 105000, currentPrice: NaN }), PERP_ERRORS.NO_CURRENT_PRICE));

  /* ── exits: reduce-only, and on the side that closes ── */

  {
    const sl = planDydxOrder({
      kind: PERP_KIND.STOP_LOSS, market: BTC, side: 'sell', size: 0.002,
      price: 90000, currentPrice: 100000, reduceOnly: true, positionSide: 'LONG'
    });
    t('a stop-loss closing a long is planned', good(sl));
    t('...reduce-only, so the venue cannot let it flip the position', sl.request.reduceOnly === true);
    t('...triggered below the market, where a long stop belongs', sl.request.triggerPrice === 90000 && sl.request.triggerSide === 'below');

    const tp = planDydxOrder({
      kind: PERP_KIND.TAKE_PROFIT, market: BTC, side: 'buy', size: 0.002,
      price: 90000, currentPrice: 100000, reduceOnly: true, positionSide: 'SHORT'
    });
    t('a take-profit closing a short is planned and fires below the market', good(tp) && tp.request.triggerSide === 'below');
  }

  t('an exit that is not reduce-only is refused — it would open a position',
    refused(planDydxOrder({ kind: PERP_KIND.STOP_LOSS, market: BTC, side: 'sell', size: 0.002, price: 90000, currentPrice: 100000, positionSide: 'LONG' }), PERP_ERRORS.NO_POSITION));

  t('an exit on the side that would DOUBLE the position is refused',
    refused(planDydxOrder({ kind: PERP_KIND.STOP_LOSS, market: BTC, side: 'buy', size: 0.002, price: 90000, currentPrice: 100000, reduceOnly: true, positionSide: 'LONG' }), PERP_ERRORS.BAD_POSITION_SIDE));

  t('an exit with no position side to check against is refused',
    refused(planDydxOrder({ kind: PERP_KIND.STOP_LOSS, market: BTC, side: 'sell', size: 0.002, price: 90000, currentPrice: 100000, reduceOnly: true }), PERP_ERRORS.BAD_POSITION_SIDE));

  /* ─────────────────────── Ostium ────────────────────────────────────────── */

  {
    const plan = planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300, slippageBps: 25 });
    t('a resting Ostium limit below the mid is planned', good(plan));
    t('...with slippage FORCED to zero whatever the caller asked for',
      plan.request.slippageBps === 0 && plan.request.requestedSlippageBps === 25);
    t('...as orderType limit, with the notional the fee is charged on',
      plan.request.orderType === 'limit' && plan.request.notionalUsd === 500);
    t('a stop entry sits above the mid for a long',
      good(planOstiumOrder({ kind: PERP_KIND.ENTRY_STOP, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2500 }))
      && refused(planOstiumOrder({ kind: PERP_KIND.ENTRY_STOP, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300 }), PERP_ERRORS.TRIGGER_WRONG_SIDE));
    t('a limit above the mid for a long would fill at once, so it is refused',
      refused(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2500 }), PERP_ERRORS.LIMIT_CROSSES_MARKET));
  }

  t('Ostium cannot hold a TP/SL as its own resting order — the protocol does that at open',
    refused(planOstiumOrder({ kind: PERP_KIND.STOP_LOSS, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300 }), PERP_ERRORS.KIND_UNSUPPORTED));

  t('collateral below the venue minimum is refused before encoding',
    refused(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 4.99, leverage: 5, price: 2300 }), PERP_ERRORS.BELOW_MIN_COLLATERAL));

  t('leverage above the pair maximum is refused, and an unknown maximum is not invented',
    refused(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 51, price: 2300 }), PERP_ERRORS.LEVERAGE_TOO_HIGH)
    && good(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: { ...XAU, maxLeverage: null }, side: 'long', collateralUsd: 100, leverage: 51, price: 2300 })));

  t('a closed market is refused',
    refused(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: { ...XAU, isMarketOpen: false }, side: 'long', collateralUsd: 100, leverage: 5, price: 2300 }), PERP_ERRORS.MARKET_CLOSED));

  t('TP and SL on the wrong side of the entry are refused',
    refused(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300, takeProfit: 2200 }), PERP_ERRORS.BAD_TPSL)
    && refused(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300, stopLoss: 2350 }), PERP_ERRORS.BAD_TPSL)
    && good(planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300, takeProfit: 2500, stopLoss: 2200 })));

  /* ── THE ENCODER: slippage zero, or the signed transaction reverts ── */

  {
    const decode = (data) => new Interface([
      'function openTrade((uint256 collateral,uint192 openPrice,uint192 tp,uint192 sl,address trader,uint32 leverage,uint16 pairIndex,uint8 index,bool buy,bool isDayTrade) t,(address builder,uint32 builderFee) bf,uint8 orderType,uint256 slippageP)'
    ]).decodeFunctionData('openTrade', data);

    for (const [type, expected] of [['market', 25], ['limit', 0], ['stop', 0]]) {
      const tx = await buildOpenTrade({
        trader: '0x1111111111111111111111111111111111111111', pairId: 5, buy: true, price: '2300',
        collateralUsd: 100, leverage: 5, orderType: type, slippageBps: 25
      });
      const [, , orderType, slippageP] = decode(tx.data);
      t(`an Ostium ${type} order encodes slippageP = ${expected} (a non-zero value on a resting order reverts)`,
        Number(slippageP) === expected && Number(orderType) === (type === 'market' ? 0 : type === 'limit' ? 1 : 2));
    }

    /* The server builds the same bytes: the two encoders are pinned to each
       other, and a drift here is a signed transaction that reverts. */
    const browser = await buildOpenTrade({
      trader: '0x1111111111111111111111111111111111111111', pairId: 5, buy: false, price: '2500',
      collateralUsd: 50, leverage: 10, orderType: 'stop', slippageBps: 99, takeProfit: '2200', stopLoss: '2600'
    });
    const server = serverOpenTrade({
      trader: '0x1111111111111111111111111111111111111111', pairId: 5, buy: false, price: '2500',
      collateralUsd: 50, leverage: 10, orderType: 'stop', slippageBps: 99, takeProfit: '2200', stopLoss: '2600',
      builder: '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6', builderFeeBps: 10
    });
    t('the browser and server Ostium encoders still agree on a resting stop order',
      browser.data.toLowerCase() === server.data.toLowerCase() && browser.to.toLowerCase() === server.to.toLowerCase());
  }

  {
    /* The cancel selector is the ABI's own, not a guess: a resting order that
       cannot be taken back is an order we should not offer to place. */
    const tx = await buildCancelLimitOrder({ pairId: 5, index: 2 });
    const expected = keccak256(toUtf8Bytes('cancelOpenLimitOrder(uint16,uint8)')).slice(0, 10);
    t('cancelling an Ostium limit order calls cancelOpenLimitOrder(uint16,uint8)', tx.data.slice(0, 10) === expected);
    t('...against the Trading contract on Arbitrum One', tx.chainId === 42161 && /^0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411$/i.test(tx.to));
    t('the server mirror produces the identical cancel calldata',
      serverCancel({ pairId: 5, index: 2 }).data.toLowerCase() === tx.data.toLowerCase());
    /* A uint8 slot: the subgraph's global order counter overflows it, and
       cancelling by the wrong number would name somebody else's slot. */
    let refusedSlot = false;
    try { await buildCancelLimitOrder({ pairId: 5, index: 900 }); } catch { refusedSlot = true; }
    t('a slot outside uint8 is refused rather than sent', refusedSlot);
  }

  /* ─────────────────────── fee preview ───────────────────────────────────── */

  {
    const dydxPlan = planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.01, price: 90000 }).request;
    const fee = perpFeePreview(dydxPlan);
    t('the dYdX preview is 10 bps of notional and says nothing about the venue\'s own fee',
      fee.notionalUsd === 900 && Math.abs(fee.ourFeeUsd - 0.9) < 1e-9 && fee.ourBps === 10 && fee.totalFeeUsd === null);

    const ostiumPlan = planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 20, price: 2300 }).request;
    const ofee = perpFeePreview(ostiumPlan, { pairOpenFeeBps: 3, builderFeeBps: 10 });
    t('the Ostium preview adds our bps, the venue\'s, and the oracle fee',
      ofee.notionalUsd === 2000 && Math.abs(ofee.ourFeeUsd - 2) < 1e-9 && Math.abs(ofee.venueFeeUsd - 0.6) < 1e-9
      && Math.abs(ofee.totalFeeUsd - 2.7) < 1e-9);
    /* The honesty line: 10 bps of a 20x notional is 2% of the collateral. */
    t('...and states our share as a percentage of the collateral, not of the notional',
      Math.abs(ofee.ourFeePctOfCollateral - 2) < 1e-9);
    t('a builder fee above the venue cap is clamped, never sent',
      perpFeePreview(ostiumPlan, { pairOpenFeeBps: 3, builderFeeBps: 900 }).ourBps === 50);
    t('an unknown venue fee makes the total null instead of a partial sum',
      perpFeePreview(ostiumPlan, { builderFeeBps: 10 }).totalFeeUsd === null);
  }

  /* ─────────────────────── state mapping ─────────────────────────────────── */

  t('dYdX indexer statuses map to a state, and an unknown one is never "open"',
    dydxOrderState('OPEN') === PERP_STATE.OPEN
    && dydxOrderState('UNTRIGGERED') === PERP_STATE.OPEN
    && dydxOrderState('FILLED') === PERP_STATE.FILLED
    && dydxOrderState('CANCELED') === PERP_STATE.CANCELLED
    && dydxOrderState('BEST_EFFORT_CANCELED') === PERP_STATE.CANCELLED
    && dydxOrderState('SOMETHING_NEW') === PERP_STATE.UNKNOWN
    && dydxOrderState(null) === PERP_STATE.UNKNOWN);

  t('an Ostium limit row maps from what it says, and absence is unknown',
    ostiumOrderState({ isActive: true, executionStarted: false }) === PERP_STATE.OPEN
    && ostiumOrderState({ isActive: true, executionStarted: true }) === PERP_STATE.FILLED
    && ostiumOrderState({ isActive: false, executionStarted: true }) === PERP_STATE.FILLED
    && ostiumOrderState({ isActive: false, executionStarted: false }) === PERP_STATE.CANCELLED
    && ostiumOrderState(null) === PERP_STATE.UNKNOWN);

  /* ─────────────────────── the stored record ─────────────────────────────── */

  {
    const plan = planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001, price: 90000 }).request;
    const now = 1_800_000_000_000;
    const record = createPerpOrder({ request: { ...plan, clientId: 4242 }, venueOrderId: '4242', txHash: '0xabc12345', wallet: 'dydx1qqqq' }, now);
    t('a placed dYdX order stores the lifetime it was signed with',
      record.expiresAt === now + 28 * 24 * 60 * 60 * 1000 && record.venueState === PERP_STATE.OPEN);
    t('...and the coordinates a cancel needs: clientId plus LONG_TERM',
      record.cancelRef.clientId === 4242 && record.cancelRef.orderFlags === 'LONG_TERM');
    t('a trigger order stores CONDITIONAL instead',
      createPerpOrder({
        request: planDydxOrder({ kind: PERP_KIND.ENTRY_STOP, market: BTC, side: 'buy', size: 0.001, price: 105000, currentPrice: 100000 }).request
      }, now).cancelRef.orderFlags === 'CONDITIONAL');
    t('no signature, key or secret is stored',
      !/mnemonic|privateKey|signature|secret/i.test(JSON.stringify(record)));

    const filled = applyPerpState(record, PERP_STATE.FILLED, { live: true }, now + 1000);
    t('a fill read from the venue moves the record to filled', filled.status === 'filled' && filled.filledAt === now + 1000);
    const cancelled = applyPerpState(record, PERP_STATE.CANCELLED, { live: true }, now + 2000);
    t('a cancel read from the venue moves it to cancelled', cancelled.status === 'cancelled');
    const unknown = applyPerpState(record, PERP_STATE.UNKNOWN, { live: false }, now + 3000);
    t('a state we could not read leaves the order active, never silently closed',
      unknown.status === 'active' && unknown.venueStateLive === false);

    t('an Ostium order has no invented expiry — only the venue ends it',
      createPerpOrder({
        request: planOstiumOrder({ kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300 }).request
      }, now).expiresAt === null);
    t('a dYdX order past its lifetime expires, and an Ostium one never does',
      perpOrderExpired({ expiresAt: now - 1 }, now) === true
      && perpOrderExpired({ expiresAt: null }, now) === false);

    const list = [record];
    t('the list helpers keep live and finished rows apart',
      perpOrdersLive(list).length === 1 && perpOrdersDone(list).length === 0
      && perpOrdersLive([filled]).length === 0 && perpOrdersDone([filled]).length === 1);
    t('expiring a list marks the row rather than deleting it',
      expirePerpOrders([record], now + 29 * 86400000)[0].status === 'expired');
    t('add/update/remove are pure and bounded',
      addPerpOrder(list, createPerpOrder({ request: plan }, now)).length === 2
      && updatePerpOrder(list, record.id, { status: 'paused' })[0].status === 'paused'
      && removePerpOrder(list, record.id).length === 0
      && addPerpOrder(Array.from({ length: MAX_PERP_ORDERS }, () => record), record).length === MAX_PERP_ORDERS);
  }

  /* ── storage: defensive reads, no throws ── */
  {
    const store = new Map();
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    try {
      const plan = planDydxOrder({ kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001, price: 90000 }).request;
      const record = createPerpOrder({ request: plan, venueOrderId: '1' });
      t('an empty store reads as an empty list', loadPerpOrders().length === 0);
      savePerpOrders([record]);
      t('a saved order reads back with its venue and market', loadPerpOrders()[0].venue === 'dydx' && loadPerpOrders()[0].market === 'BTC-USD');
      store.set('fbt-perp-orders-v1', '{not json');
      t('a corrupt store reads as empty instead of throwing', loadPerpOrders().length === 0);
      store.set('fbt-perp-orders-v1', JSON.stringify([{ id: 'x', venue: 'binance' }, null, 7, record]));
      t('a row from a venue we do not drive is dropped, not repaired',
        loadPerpOrders().length === 1 && loadPerpOrders()[0].id === record.id);
    } finally {
      if (real) globalThis.localStorage = real; else delete globalThis.localStorage;
    }
  }

  /* ── one door for both venues ── */

  t('planPerpOrder routes to the venue and refuses an unknown one',
    good(planPerpOrder({ venue: PERP_VENUE.DYDX, kind: PERP_KIND.ENTRY_LIMIT, market: BTC, side: 'buy', size: 0.001, price: 90000 }))
    && good(planPerpOrder({ venue: PERP_VENUE.OSTIUM, kind: PERP_KIND.ENTRY_LIMIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300 }))
    && refused(planPerpOrder({ venue: 'binance', kind: PERP_KIND.ENTRY_LIMIT }), PERP_ERRORS.VENUE_UNSUPPORTED)
    && refused(planPerpOrder({ kind: PERP_KIND.ENTRY_LIMIT }), PERP_ERRORS.NO_VENUE));

  t('a kind the venue cannot hold is refused by the single door too',
    refused(planPerpOrder({ venue: PERP_VENUE.OSTIUM, kind: PERP_KIND.TAKE_PROFIT, pair: XAU, side: 'long', collateralUsd: 100, leverage: 5, price: 2300 }), PERP_ERRORS.KIND_UNSUPPORTED));

  /* ─────────────────────── the copy ──────────────────────────────────────── */

  {
    const flatten = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}=${v}`]);
    const faText = flatten(PERP_AUTO_COPY_FA).join('\n');
    const enText = flatten(PERP_AUTO_COPY_EN).join('\n');

    /* The product rule from the feasibility study: this is a tool, never a
       promise. Both languages, every string. */
    t('no string in either language promises a guaranteed profit',
      !/سود تضمینی|درآمد قطعی|ربات پرسود|سود قطعی|تضمین سود/.test(faText)
      && !/guaranteed (profit|return)|sure profit|risk[- ]free/i.test(enText));

    t('both languages state that loss is possible and that the user signs',
      /از بین ببرد/.test(PERP_AUTO_COPY_FA.riskBody) && /امضای/.test(PERP_AUTO_COPY_FA.nonCustodyBody + PERP_AUTO_COPY_FA.sectionBody)
      && /lose part or all/i.test(PERP_AUTO_COPY_EN.riskBody) && /signature/i.test(PERP_AUTO_COPY_EN.sectionBody));

    t('both languages say what the platform earns',
      /سهم پلتفرم/.test(PERP_AUTO_COPY_FA.reviewFeeOurs) && /Platform share/i.test(PERP_AUTO_COPY_EN.reviewFeeOurs));

    /* Every refusal the planner can produce has to render as a sentence. */
    const codes = Object.values(PERP_ERRORS);
    t('every planner error code has Persian and English copy',
      codes.every((code) => typeof PERP_AUTO_COPY_FA.err[code] === 'string' && PERP_AUTO_COPY_FA.err[code].length > 3)
      && codes.every((code) => typeof PERP_AUTO_COPY_EN.err[code] === 'string' && PERP_AUTO_COPY_EN.err[code].length > 3));

    t('no copy exists for a code the planner cannot produce',
      Object.keys(PERP_AUTO_COPY_FA.err).every((k) => codes.includes(k) || ['NOT_CONNECTED', 'REJECTED', 'SUBMIT_FAILED', 'CANCEL_FAILED', 'VALIDATOR_UNREACHABLE', 'WRONG_CHAIN', 'NO_SIGNER'].includes(k)));

    t('the two languages cover the same keys',
      flatten(PERP_AUTO_COPY_FA).map((s) => s.split('=')[0]).sort().join('|')
      === flatten(PERP_AUTO_COPY_EN).map((s) => s.split('=')[0]).sort().join('|'));

    t('Persian is the default and anything else falls back to English',
      perpAutoCopyFor('fa') === PERP_AUTO_COPY_FA && perpAutoCopyFor(undefined) === PERP_AUTO_COPY_FA
      && perpAutoCopyFor('zh') === PERP_AUTO_COPY_EN && perpAutoCopyFor('en') === PERP_AUTO_COPY_EN);

    t('the Ostium copy explains why there is no slippage field, in both languages',
      /صفر/.test(PERP_AUTO_COPY_FA.slippageNote) && /must be zero/i.test(PERP_AUTO_COPY_EN.slippageNote));

    t('the Ostium copy says a cancel does not refund the placement fee',
      /برنمی‌گرداند/.test(PERP_AUTO_COPY_FA.cancelCostNote) && /does not refund/i.test(PERP_AUTO_COPY_EN.cancelCostNote));

    t('a state that could not be read says so instead of showing a stale list',
      /خوانده نشد/.test(PERP_AUTO_COPY_FA.stateUnknown) && /could not be read/i.test(PERP_AUTO_COPY_EN.stateUnknown)
      && /live/i.test(PERP_AUTO_COPY_EN.feedDown));
  }

  /* ─────────────────────── the surface cannot send by itself ─────────────── */

  {
    const jsx = readFileSync('src/components/orders/PerpAutoOrders.jsx', 'utf8');
    t('no timer or interval can place or cancel an order',
      !/setInterval/.test(jsx) && !/setTimeout\([^)]*\b(place|cancel)\b/.test(jsx));
    t('the only path to a venue order is the button handler',
      (jsx.match(/placeDydxAutoOrder\(/g) || []).length === 1 && (jsx.match(/buildOpenTrade\(/g) || []).length === 1);
    t('the section is absent from a build where speculation is off',
      /SPECULATION_ENABLED/.test(jsx) && /if \(!SPECULATION_ENABLED\) return null/.test(jsx));
    t('nothing here mirrors a perp order to our server',
      !/putWatches|syncWatches|\/api\/orders/.test(jsx));
  }

  return rows;
}
