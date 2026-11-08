/**
 * FBT FUTURES — the venue contract, in one place (plan §12 "aggregation layer").
 * ---------------------------------------------------------------------------
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * A terminal renders what a venue can do, not what it would be nice if it
 * could. Before this file every screen answered that question by looking at
 * `providerId` inline (`supportsTpSl = route === ROUTE.OSTIUM`, `route ===
 * ROUTE.DYDX ? … : …`), which means three different components could disagree
 * about the same venue, and adding a venue meant finding every one of them.
 *
 * Here a venue is a single frozen record of FACTS the venue itself documents or
 * that our adapter provably implements:
 *
 *   · order types it accepts            · how margin/leverage actually works
 *   · whether isolated margin exists     · the liquidation model + its inputs
 *   · fee caps, settlement interval      · the wrong things it cannot read
 *
 * ─── THE RULE ───────────────────────────────────────────────────────────────
 * `false` is a promise that the UI will NOT show a control. A capability is only
 * `true` when a code path exists behind it TODAY. This file is therefore
 * deliberately smaller than the plan's wish list: Hyperliquid is fully written
 * but not mounted, so its order types are `false` here and the terminal does
 * not offer a Hyperliquid ticket. That is the honest state, and it is one edit
 * away from changing when the route is mounted.
 *
 * Pure data + pure functions: no imports, no network, no clock. Safe in the
 * browser, in Node tests and in the server BFF (server/futures/router.js imports
 * it for its own capability gate).
 */

/** Order types, with the label each one gets on a ticket. */
export const ORDER_TYPES = Object.freeze([
  { id: 'market', label: 'Market', needsPrice: false, needsStopPrice: false },
  { id: 'limit', label: 'Limit', needsPrice: true, needsStopPrice: false },
  { id: 'stopMarket', label: 'Stop Market', needsPrice: false, needsStopPrice: true },
  { id: 'stopLimit', label: 'Stop Limit', needsPrice: true, needsStopPrice: true },
  { id: 'takeProfit', label: 'Take Profit', needsPrice: false, needsStopPrice: true },
  { id: 'takeProfitLimit', label: 'Take Profit Limit', needsPrice: true, needsStopPrice: true }
]);

/** Time-in-force options a venue may accept. */
export const TIME_IN_FORCE = Object.freeze(['GTC', 'IOC', 'FOK']);

/**
 * Liquidation models a venue can be priced with — the vocabulary the risk
 * engine already speaks (src/lib/futures-engine/risk.js LIQUIDATION_MODEL).
 *   'venue-docs'      a rule documented by the venue (Ostium)
 *   'maintenance'     the exchange-leg formula; needs the venue's own MMR
 *   'upper-bound'     nothing published: 100%-loss bound, labelled as such
 */
export const LIQUIDATION_SOURCE = Object.freeze({
  VENUE_DOCS: 'venue-docs',
  MAINTENANCE: 'maintenance',
  UPPER_BOUND: 'upper-bound'
});

/**
 * THE VENUE RECORD.
 *
 * `capabilities` here is the *market-data + order* half. The execution half
 * (can this app actually sign?) stays in providers.js; the two are joined by
 * `resolveVenueContract()` below so a screen reads one object.
 */
export const VENUE_CONTRACTS = Object.freeze({
  dydx: Object.freeze({
    id: 'dydx',
    name: 'dYdX Chain',
    family: 'cosmos',
    collateral: 'USDC',
    /** Markets quoted in this pair suffix (dydx tickers are BASE-USD). */
    symbolSuffix: '-USD',
    /* ── order entry ───────────────────────────────────────────────────── */
    orderTypes: Object.freeze(['market', 'limit', 'stopMarket', 'takeProfit']),
    timeInForce: Object.freeze(['GTC', 'IOC']),
    postOnly: false,           // the SDK refuses post-only outside LIMIT+GTT
    reduceOnly: true,
    tpSl: true,
    /** native = the venue holds the trigger; 'client' would mean we watch it */
    tpSlEngine: 'native',
    /* ── margin / leverage ─────────────────────────────────────────────── */
    marginModes: Object.freeze(['cross']),
    /** dYdX has no leverage slider: leverage is notional ÷ equity, capped by
        the market's initial margin fraction. The UI shows a READ-OUT. */
    leverageMode: 'derived',
    isolatedVia: 'child-subaccount',  // subaccount ≥ 128, ≥ 20 USDC
    /** Liquidation inputs the indexer publishes per market. */
    marginFractions: 'published',     // initialMarginFraction + maintenanceMarginFraction
    fundingIntervalHours: 1,
    fundingSettlement: 'hourly',
    /* ── reads we do NOT have wired (so panels can say so) ─────────────── */
    reads: Object.freeze({ orderbook: true, trades: false, historicalFunding: false, pnlHistory: false }),
    /* ── fees ──────────────────────────────────────────────────────────── */
    takerFeeBpsDefault: 5,      // tier 0 taker, 0.05%
    fbtBuilderMaxBps: 100,      // dYdX allows up to 1000 ppm on the builder fee
    liquidationSource: LIQUIDATION_SOURCE.MAINTENANCE
  }),

  drift: Object.freeze({
    id: 'drift',
    name: 'Velocity',
    family: 'solana',
    collateral: 'USDT',
    symbolSuffix: '-PERP',
    orderTypes: Object.freeze(['market', 'limit']),
    timeInForce: Object.freeze(['GTC', 'IOC']),
    postOnly: true,             // PostOnlyParams in the Velocity SDK
    reduceOnly: true,
    tpSl: true,                 // trigger orders are built in the tab
    tpSlEngine: 'native',
    marginModes: Object.freeze(['cross']),
    leverageMode: 'selectable', // per-market maxLeverage is published
    isolatedVia: null,
    marginFractions: 'derived',  // maintenance margin is not in the stats feed
    fundingIntervalHours: 1,
    fundingSettlement: 'hourly',
    reads: Object.freeze({ orderbook: true, trades: false, historicalFunding: false, pnlHistory: false }),
    takerFeeBpsDefault: 10,
    fbtBuilderMaxBps: 50,
    liquidationSource: LIQUIDATION_SOURCE.UPPER_BOUND
  }),

  ostium: Object.freeze({
    id: 'ostium',
    name: 'Ostium',
    family: 'evm',
    collateral: 'USDC',
    symbolSuffix: '',
    orderTypes: Object.freeze(['market', 'limit']),
    timeInForce: Object.freeze(['GTC']),
    postOnly: false,
    reduceOnly: true,
    tpSl: true,
    tpSlEngine: 'native',
    marginModes: Object.freeze(['cross']),
    leverageMode: 'selectable',
    isolatedVia: null,
    marginFractions: 'documented-rule',
    fundingIntervalHours: 1,
    fundingSettlement: 'per-block',
    reads: Object.freeze({ orderbook: false, trades: false, historicalFunding: false, pnlHistory: false }),
    takerFeeBpsDefault: null,   // charged inside the oracle/venue fee, not a bps table
    fbtBuilderMaxBps: 50,
    liquidationSource: LIQUIDATION_SOURCE.VENUE_DOCS
  }),

  /* Written, tested, and NOT mounted: no route in the app sends a Hyperliquid
     order yet (see providers.js `execution: NOT_BUILT`). Every capability that
     implies order entry is therefore false, and the terminal's ticket refuses
     the venue by NAME instead of failing at the signature. */
  hyperliquid: Object.freeze({
    id: 'hyperliquid',
    name: 'Hyperliquid',
    family: 'hyperliquid',
    collateral: 'USDC',
    symbolSuffix: '',
    orderTypes: Object.freeze([]),
    timeInForce: Object.freeze([]),
    postOnly: false,
    reduceOnly: false,
    tpSl: false,
    tpSlEngine: null,
    marginModes: Object.freeze(['cross', 'isolated']),
    leverageMode: 'selectable',
    isolatedVia: 'per-asset',
    marginFractions: 'published',
    fundingIntervalHours: 1,
    fundingSettlement: 'hourly',
    reads: Object.freeze({ orderbook: true, trades: false, historicalFunding: true, pnlHistory: false }),
    takerFeeBpsDefault: 4.5,
    fbtBuilderMaxBps: 10,
    liquidationSource: LIQUIDATION_SOURCE.MAINTENANCE,
    executionMounted: false
  })
});

export const VENUE_IDS = Object.freeze(Object.keys(VENUE_CONTRACTS));

export const contractFor = (providerId) =>
  VENUE_CONTRACTS[String(providerId || '').toLowerCase()] || null;

/* Order-type ids are written camelCase ('stopMarket') because that is what the
   SDKs use, and users of this module pass anything ('STOP_MARKET',
   'stop-market', 'stopmarket'). One normaliser, used by every check below, so a
   casing difference can never look like a capability difference. */
const normType = (v) => String(v || '').toLowerCase().replace(/[_\s-]/g, '');
const typeIndex = Object.freeze(ORDER_TYPES.reduce((m, o) => { m[normType(o.id)] = o; return m; }, {}));

/** Does this venue accept this order type? Unknown types are refused. */
export function supportsOrderType(providerId, orderType) {
  const c = contractFor(providerId);
  if (!c) return false;
  const want = normType(orderType);
  return c.orderTypes.some((t) => normType(t) === want);
}

/** The order-type objects a ticket may render for a venue (empty = none). */
export function orderTypesFor(providerId) {
  const c = contractFor(providerId);
  if (!c) return [];
  return ORDER_TYPES.filter((o) => c.orderTypes.some((t) => normType(t) === normType(o.id)));
}

/**
 * Can this venue carry a TP/SL leg on the order we are about to place?
 *
 * Two conditions, and both must hold: the venue supports it, AND no adapter
 * flag forbids it. The second half is what the old inline
 * `supportsTpSl = route === ROUTE.OSTIUM` was standing in for — except that one
 * was WRONG for dYdX (the SDK ships conditional orders) and wrong for Velocity
 * (trigger orders exist). This function makes the answer per-venue and
 * testable instead of a ternary in a 1,800-line page.
 */
export function tpSlFor(providerId, { adapterSupports } = {}) {
  const c = contractFor(providerId);
  if (!c || !c.tpSl) return false;
  if (adapterSupports === false) return false;
  return true;
}

/**
 * Which liquidation model will price THIS venue, and what does it need?
 *
 * A screen uses this to decide whether it may print a price or must print the
 * "approximate" label — from the same vocabulary the risk engine returns in
 * `liquidationModel`, so the label and the number can never disagree.
 */
export function liquidationPlan(providerId, { maintenanceMarginFraction = null } = {}) {
  const c = contractFor(providerId);
  if (!c) return { source: LIQUIDATION_SOURCE.UPPER_BOUND, exact: false, needs: [] };
  if (c.liquidationSource === LIQUIDATION_SOURCE.VENUE_DOCS) {
    return { source: LIQUIDATION_SOURCE.VENUE_DOCS, exact: true, needs: ['maxLeverage'] };
  }
  if (c.liquidationSource === LIQUIDATION_SOURCE.MAINTENANCE) {
    const have = Number.isFinite(Number(maintenanceMarginFraction)) && Number(maintenanceMarginFraction) > 0;
    return {
      source: LIQUIDATION_SOURCE.MAINTENANCE,
      /* The model is exact only when the venue's own MMR arrived. Without it
         the risk engine falls back to the bound and says so — this object
         predicts that, it does not override it. */
      exact: have,
      needs: ['maintenanceMarginFraction', 'takerFeeRate'],
      maintenanceMarginFraction: have ? Number(maintenanceMarginFraction) : null
    };
  }
  return { source: LIQUIDATION_SOURCE.UPPER_BOUND, exact: false, needs: [] };
}

/**
 * One object a terminal panel renders for a venue: the join of the static
 * contract and the runtime facts (is the order path mounted? is the market
 * live?). `blocked` names the reason a ticket must refuse, or null.
 *
 * FAILS CLOSED on `marketLive`: only an explicit `true` opens the ticket. A
 * leveraged screen that treats "I did not read whether the market is open" as
 * open is the screen that lets somebody size an order against a halted market.
 * `status` is different — it is advisory (`null` = not probed yet) and only an
 * explicit non-executable word blocks, because the registry already folds
 * "no execution path" into EXECUTION_NOT_MOUNTED above.
 */
export function resolveVenueContract(providerId, { status = null, marketLive = null, executionMounted = null } = {}) {
  const c = contractFor(providerId);
  if (!c) return { ok: false, blocked: 'UNKNOWN_VENUE', venue: null };
  const mounted = executionMounted == null ? c.executionMounted !== false : Boolean(executionMounted);
  const blocked = !mounted ? 'EXECUTION_NOT_MOUNTED'
    : status && status !== 'AVAILABLE' && status !== 'DEGRADED' ? `VENUE_${status}`
      : marketLive === false ? 'MARKET_CLOSED'
        : marketLive !== true ? 'MARKET_UNKNOWN'
          : null;
  return {
    ok: blocked == null,
    blocked,
    venue: {
      ...c,
      executionMounted: mounted,
      status: status || null,
      canPlaceOrders: blocked == null && c.orderTypes.length > 0,
      orderTypes: orderTypesFor(providerId)
    }
  };
}

/**
 * Validate a ticket against its venue BEFORE anything is built or signed.
 *
 * Returns `{ ok, code, detail }` — never throws, never guesses. The codes are
 * stable strings a UI can translate; the checks are the exact list a reviewer
 * would ask about ("does your Limit button do something on this venue?").
 */
export function validateOrderForVenue({
  providerId, orderType = 'market', price = null, stopPrice = null,
  timeInForce = 'GTC', postOnly = false, reduceOnly = false, takeProfit = null, stopLoss = null
} = {}) {
  const c = contractFor(providerId);
  if (!c) return { ok: false, code: 'UNKNOWN_VENUE' };
  if (c.executionMounted === false) return { ok: false, code: 'EXECUTION_NOT_MOUNTED', detail: `${c.name} orders are not mounted in this build` };

  const meta = typeIndex[normType(orderType)];
  if (!meta) return { ok: false, code: 'BAD_ORDER_TYPE' };
  if (!c.orderTypes.some((t) => normType(t) === normType(meta.id))) return { ok: false, code: 'ORDER_TYPE_NOT_SUPPORTED', detail: `${c.name} does not accept ${meta.id}` };

  const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  if (meta.needsPrice && !(num(price) > 0)) return { ok: false, code: 'PRICE_REQUIRED' };
  if (meta.needsStopPrice && !(num(stopPrice) > 0)) return { ok: false, code: 'STOP_PRICE_REQUIRED' };

  if (postOnly && !c.postOnly) return { ok: false, code: 'POST_ONLY_NOT_SUPPORTED', detail: `${c.name} cannot rest a maker-only order here` };
  if (postOnly && normType(meta.id) !== 'limit') return { ok: false, code: 'POST_ONLY_REQUIRES_LIMIT' };

  const tif = String(timeInForce || '').toUpperCase();
  if (tif && !c.timeInForce.includes(tif)) return { ok: false, code: 'TIME_IN_FORCE_NOT_SUPPORTED', detail: `${c.name}: ${c.timeInForce.join('/')}` };
  if (postOnly && tif && tif !== 'GTC') return { ok: false, code: 'POST_ONLY_REQUIRES_GTC' };

  if (reduceOnly && !c.reduceOnly) return { ok: false, code: 'REDUCE_ONLY_NOT_SUPPORTED' };

  if ((num(takeProfit) != null || num(stopLoss) != null) && !c.tpSl) return { ok: false, code: 'TPSL_NOT_SUPPORTED' };

  return { ok: true, code: null, venue: c };
}

/**
 * The liquidation distance in a trader's units, for a ticket preview:
 * both the % and the price, from ONE model, plus the label to print.
 *
 * A thin adapter so a component never has to re-derive "$ or %".
 */
export function liquidationPreview({ providerId, side, entryPrice, leverage, maxLeverage = null, maintenanceMarginFraction = null, takerFeeRate = null }, riskFns) {
  const fn = riskFns && typeof riskFns.liquidationDistance === 'function' ? riskFns.liquidationDistance : null;
  if (!fn) return { available: false, reason: 'RISK_ENGINE_MISSING' };
  const out = fn({ providerId, side, entryPrice, leverage, maxLeverage, maintenanceMarginFraction, takerFeeRate });
  const plan = liquidationPlan(providerId, { maintenanceMarginFraction });
  return {
    available: out.distancePct != null,
    distancePct: out.distancePct,
    price: out.liquidationPrice,
    model: out.model,
    exact: plan.exact,
    label: out.model === LIQUIDATION_SOURCE.MAINTENANCE || out.model === 'maintenance-margin' ? 'maintenance-margin'
      : out.model === 'ostium-docs' ? 'venue-docs'
        : 'upper-bound'
  };
}
