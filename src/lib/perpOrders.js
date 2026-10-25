/**
 * PERPETUAL AUTO-ORDERS — PURE planning, validation and status mapping.
 * ============================================================================
 *
 * ─── WHAT THIS MODULE IS FOR ─────────────────────────────────────────────────
 * «سفارش خودکار» could already do two things: hand an order to a solver
 * network (CoW / Jupiter Trigger) or watch a price and ask the user to sign.
 * Neither covers perpetuals, and perpetuals are where this app earns a builder
 * fee on every fill. Both perp venues we support can hold a RESTING order —
 * an order that lives on the venue and fills while the app is closed, with no
 * server of ours in the path and no key of the user's in our hands:
 *
 *   · dYdX Chain  — LONG_TERM limit orders and CONDITIONAL trigger orders,
 *                   signed with a key derived in memory from the user's own
 *                   wallet signature (src/lib/dydx.js). Builder fee 1000 ppm.
 *   · Ostium      — on-chain limit / stop open orders with protocol-enforced
 *                   TP and SL, signed by the user's wallet on Arbitrum One
 *                   (src/lib/ostium.js). Builder fee up to 50 bps.
 *
 * This file is the money-deciding layer for both: it turns what the user typed
 * into the EXACT request the venue will accept, and it refuses — with a named
 * code — every combination the venue would reject, revert on, or fill in a way
 * the user did not mean. It touches no network, no wallet and no storage read
 * of anybody else's data, so every rule here is testable offline
 * (test/perp-auto-orders-units.mjs).
 *
 * ─── WHY THE RULES LIVE HERE AND NOT IN THE VENUE MODULES ────────────────────
 * src/lib/dydx.js and src/lib/ostium.js are transport: they sign and send. If
 * a rule about trigger direction or slippage lived there, it would be checked
 * AFTER the user had already been shown a preview promising something else.
 * Planning first means the preview and the signed request are the same object.
 *
 * ─── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * Not a strategy engine, not a signal, and not a promise of profit. Nothing
 * here decides WHEN to trade; the user does. Every fee figure is a preview of
 * what the venue and we charge, and every PnL figure the UI shows next to a
 * plan is an estimate at the trigger price — no fees, no funding, no slippage
 * beyond the limit the plan carries.
 */

/*
 * ─── CONSTANTS MIRRORED FROM THE VENUE MODULES ───────────────────────────────
 * src/lib/dydx.js and src/lib/ostium.js both read `import.meta.env` (Vite) and
 * hold transport state, so this pure module redeclares the four numbers it
 * needs instead of importing them. That is only safe because a mirror-sync
 * test pins them to the source modules — the same arrangement the server's
 * Ostium adapter uses (server/futures/adapters/ostium.js). Change one, change
 * both, or the test fails.
 */
export const PERP_DYDX_BUILDER_FEE_PPM = 1000; // 10 bps, dYdX allows up to 10 000
export const PERP_OSTIUM_MIN_COLLATERAL_USD = 5;
export const PERP_OSTIUM_VENUE_FEE_CAP_BPS = 50;
export const PERP_OSTIUM_ORACLE_FEE_USD = 0.1; // charged when a limit/stop is PLACED

export const PERP_VENUE = Object.freeze({ DYDX: 'dydx', OSTIUM: 'ostium' });

/**
 * The four things a resting perp order can be.
 *
 * `entry-limit` and `entry-stop` OPEN a position. `take-profit` and
 * `stop-loss` CLOSE one and are reduce-only wherever the venue supports the
 * flag — reduce-only is enforced by the venue, not by us, so a TP/SL can never
 * accidentally flip a position into one on the other side.
 */
export const PERP_KIND = Object.freeze({
  ENTRY_LIMIT: 'entry-limit',
  ENTRY_STOP: 'entry-stop',
  TAKE_PROFIT: 'take-profit',
  STOP_LOSS: 'stop-loss'
});

/**
 * What each venue can actually hold. Derived from the venue's own documented
 * order types and from the SDK code this repo pins, not from what would be
 * nice to offer.
 *
 *   restsOnVenue     the order survives the app being closed
 *   protocolTpSl     TP/SL are enforced by the venue itself, at open
 *   reduceOnlyFlag   the venue can be told an order may only shrink a position
 *   statusSource     where the truth about the order is read from
 *   cancelCost       what cancelling costs the user, in plain terms
 */
export const PERP_VENUE_CAPS = Object.freeze({
  dydx: Object.freeze({
    id: 'dydx',
    label: 'dYdX Chain',
    kinds: Object.freeze([PERP_KIND.ENTRY_LIMIT, PERP_KIND.ENTRY_STOP, PERP_KIND.TAKE_PROFIT, PERP_KIND.STOP_LOSS]),
    restsOnVenue: true,
    protocolTpSl: false,
    reduceOnlyFlag: true,
    statusSource: 'indexer',
    cancelCost: 'free',
    feeModel: 'ppm-of-notional',
    feePpm: PERP_DYDX_BUILDER_FEE_PPM,
    /* A LONG_TERM order carries an absolute expiry in seconds. dYdX rejects a
       goodTilBlockTime in the past and treats an absurd one as a mistake; the
       bounds below are what the TP/SL card already ships (28 days) widened to
       90, which is inside the venue's own limit for stateful orders. */
    minGoodTilSeconds: 60,
    maxGoodTilSeconds: 90 * 24 * 60 * 60
  }),
  ostium: Object.freeze({
    id: 'ostium',
    label: 'Ostium',
    /* Ostium attaches TP and SL to the opening order, so an exit is expressed
       as part of an entry rather than as its own resting order. A TP/SL on a
       position that is already open goes through buildModifyPosition, which is
       a management action on the Ostium screen, not an auto-order. */
    kinds: Object.freeze([PERP_KIND.ENTRY_LIMIT, PERP_KIND.ENTRY_STOP]),
    restsOnVenue: true,
    protocolTpSl: true,
    reduceOnlyFlag: false,
    statusSource: 'subgraph',
    /* Placing a limit/stop costs the oracle fee up front and cancelling does
       NOT refund it. Saying so before the signature is the whole point. */
    cancelCost: 'placement-fee-not-refunded',
    feeModel: 'bps-of-notional',
    feeCapBps: PERP_OSTIUM_VENUE_FEE_CAP_BPS,
    minCollateralUsd: PERP_OSTIUM_MIN_COLLATERAL_USD,
    oracleFeeUsd: PERP_OSTIUM_ORACLE_FEE_USD
  })
});

export const PERP_VENUES = Object.freeze([PERP_VENUE_CAPS.dydx, PERP_VENUE_CAPS.ostium]);

export const perpVenueCaps = (venue) => PERP_VENUE_CAPS[String(venue || '').toLowerCase()] || null;

/**
 * Error codes. Never sentences: the copy module owns the wording in Persian
 * and English, and a hard-coded English string here would ship inside the
 * Persian build.
 */
export const PERP_ERRORS = Object.freeze({
  NO_VENUE: 'NO_VENUE',
  VENUE_UNSUPPORTED: 'VENUE_UNSUPPORTED',
  KIND_UNSUPPORTED: 'KIND_UNSUPPORTED',
  NO_MARKET: 'NO_MARKET',
  MARKET_INACTIVE: 'MARKET_INACTIVE',
  MARKET_CLOSED: 'MARKET_CLOSED',
  BAD_SIDE: 'BAD_SIDE',
  NO_SIZE: 'NO_SIZE',
  SIZE_BELOW_MIN: 'SIZE_BELOW_MIN',
  NO_PRICE: 'NO_PRICE',
  BAD_PRICE: 'BAD_PRICE',
  TICK_UNKNOWN: 'TICK_UNKNOWN',
  NO_CURRENT_PRICE: 'NO_CURRENT_PRICE',
  LIMIT_CROSSES_MARKET: 'LIMIT_CROSSES_MARKET',
  TRIGGER_WRONG_SIDE: 'TRIGGER_WRONG_SIDE',
  NO_COLLATERAL: 'NO_COLLATERAL',
  BELOW_MIN_COLLATERAL: 'BELOW_MIN_COLLATERAL',
  NO_LEVERAGE: 'NO_LEVERAGE',
  LEVERAGE_TOO_HIGH: 'LEVERAGE_TOO_HIGH',
  BAD_EXPIRY: 'BAD_EXPIRY',
  NO_POSITION: 'NO_POSITION',
  BAD_POSITION_SIDE: 'BAD_POSITION_SIDE',
  BAD_TPSL: 'BAD_TPSL'
});

const num = (v) => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'string' && v.trim() === '') return NaN;
  return Number(v);
};
const isPos = (n) => Number.isFinite(n) && n > 0;
const fail = (error, extra = null) => ({ ok: false, error, ...(extra || {}) });

/* ────────────────────────────────────────────────────────────────────────────
 * dYdX — market geometry
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Tick size for a dYdX market.
 *
 * The indexer publishes `tickSize` as a decimal string ("0.1", "1"). When it
 * is missing we do NOT guess: a price rounded to an invented tick is an order
 * the venue rejects after the user has signed, so the plan refuses instead and
 * the caller says «اندازهٔ تیک بازار در دسترس نیست».
 */
export function dydxTickSize(market) {
  const raw = market?.raw?.tickSize ?? market?.tickSize ?? null;
  const text = String(raw ?? '').trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const tick = Number(text);
  return isPos(tick) ? tick : null;
}

/**
 * Minimum order size and the size step, in base units.
 *
 * dYdX quantises size to `stepBaseQuantums` at `atomicResolution`, and the
 * step IS the minimum: one step is the smallest order the venue accepts. This
 * is the same arithmetic the SDK's own `calculateQuantums` performs, derived
 * here so the plan can refuse a too-small size before a signature is asked
 * for, rather than letting the chain say no.
 */
export function dydxSizeStep(market) {
  const step = num(market?.raw?.stepBaseQuantums ?? market?.stepBaseQuantums);
  const atomic = num(market?.raw?.atomicResolution ?? market?.atomicResolution);
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(atomic)) return null;
  return step * Math.pow(10, atomic);
}

/**
 * Round a price onto the tick, in the direction that keeps the order honest.
 *
 *   · a LIMIT that buys  rounds DOWN (never pay more than typed)
 *   · a LIMIT that sells rounds UP   (never receive less than typed)
 *   · a trigger rounds AWAY from the market, so the rounded trigger is never
 *     closer to the current price than the one the user typed — the same rule
 *     src/lib/dydxTpsl.js already enforces for TP/SL legs.
 *
 * The division is nudged by 1e-6 ticks before ceil/floor so a price already on
 * the tick does not jump by one because of binary floating-point noise.
 */
export function roundPerpPrice(price, tickSize, mode) {
  const tick = num(tickSize);
  const p = num(price);
  if (!isPos(tick) || !isPos(p) || (mode !== 'up' && mode !== 'down')) return null;
  const text = String(tickSize).trim();
  const dot = text.indexOf('.');
  const decimals = dot === -1 ? 0 : text.length - dot - 1;
  const steps = Math.round((p / tick) * 1e6) / 1e6;
  const index = mode === 'up' ? Math.ceil(steps) : Math.floor(steps);
  return Number((index * tick).toFixed(decimals));
}

/** Round a size DOWN onto the venue's step. Returns null when it rounds to 0. */
export function roundPerpSize(size, step) {
  const s = num(size);
  const st = num(step);
  if (!isPos(s) || !isPos(st)) return null;
  const steps = Math.floor(Math.round((s / st) * 1e6) / 1e6);
  if (steps < 1) return null;
  /* Rebuild from the step count instead of multiplying back a float: 0.001 *
     1000 is 1 in decimal but not always in binary, and a size that prints as
     0.0030000000000000005 is a size the venue may reject. */
  const decimals = Math.max(0, Math.min(18, -Math.floor(Math.log10(st)) + (Number.isInteger(st) ? 0 : 0)));
  const value = steps * st;
  return Number.isFinite(decimals) ? Number(value.toFixed(Math.min(18, Math.max(decimals, 0)))) : value;
}

/**
 * Which side of the market a dYdX trigger must sit on.
 *
 * dYdX defines the two condition types by whether the trigger price is WORSE
 * or BETTER than the market for the order's side, and that single rule covers
 * entries and exits alike:
 *
 *   STOP          buy  fires when oracle ≥ trigger → trigger ABOVE the market
 *                 sell fires when oracle ≤ trigger → trigger BELOW the market
 *   TAKE_PROFIT   buy  fires when oracle ≤ trigger → trigger BELOW the market
 *                 sell fires when oracle ≥ trigger → trigger ABOVE the market
 *
 * Checked against the exit cases src/lib/dydxTpsl.js already ships: a stop-loss
 * SELL closing a long sits below the market, a take-profit SELL closing a long
 * sits above it, and both are what this returns. One rule, two directions, no
 * second table to drift out of sync.
 */
export function dydxTriggerSide(condition, side) {
  const buy = String(side).toLowerCase() === 'buy';
  const stop = String(condition).toUpperCase() === 'STOP';
  if (!buy && String(side).toLowerCase() !== 'sell') return null;
  if (!stop && String(condition).toUpperCase() !== 'TAKE_PROFIT') return null;
  if (stop) return buy ? 'above' : 'below';
  return buy ? 'below' : 'above';
}

/* ────────────────────────────────────────────────────────────────────────────
 * dYdX — the plan
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Plan one resting dYdX order.
 *
 * @param {object} input
 * @param {'entry-limit'|'entry-stop'|'take-profit'|'stop-loss'} input.kind
 * @param {object} input.market       a normalised market from getDydxMarkets()
 * @param {'buy'|'sell'} input.side
 * @param {number|string} input.size  base units, before step rounding
 * @param {number|string} [input.price]        limit price (entry-limit) or the
 *                                             limit a trigger order executes at
 * @param {number|string} [input.triggerPrice] entry-stop / take-profit / stop-loss
 * @param {number} [input.currentPrice]        oracle price, for trigger checks
 * @param {number} [input.goodTilSeconds]      lifetime of the resting order
 * @param {boolean} [input.reduceOnly]         required true for TP/SL
 * @param {'LONG'|'SHORT'} [input.positionSide] for TP/SL only
 * @param {number|string} [input.slippagePct]  market-execution trigger orders
 * @returns {{ok:true, request:object}|{ok:false, error:string}}
 *
 * The returned `request` is exactly what `placeDydxAutoOrder` sends, including
 * the three fields whose absence is the bug this module exists to prevent:
 * `timeInForce`, `goodTilTimeInSeconds` and `postOnly`. The pinned SDK throws
 * `timeInForce must be set if orderType is LIMIT` without the first, throws
 * `goodTilTimeInSeconds must be set for LONG_TERM or CONDITIONAL order` without
 * the second, and throws `postOnly must be set if order type is LIMIT and
 * timeInForce is GTT` without the third.
 */
export function planDydxOrder(input = {}) {
  const caps = PERP_VENUE_CAPS.dydx;
  const kind = String(input.kind || '');
  if (!caps.kinds.includes(kind)) return fail(PERP_ERRORS.KIND_UNSUPPORTED);

  const market = input.market;
  const ticker = String(market?.ticker || '').trim();
  if (!ticker) return fail(PERP_ERRORS.NO_MARKET);
  if (market?.status && String(market.status).toUpperCase() !== 'ACTIVE') {
    return fail(PERP_ERRORS.MARKET_INACTIVE);
  }

  const side = String(input.side || '').toLowerCase();
  if (side !== 'buy' && side !== 'sell') return fail(PERP_ERRORS.BAD_SIDE);

  /* ── SIZE ─────────────────────────────────────────────────────────────── */
  const rawSize = num(input.size);
  if (!isPos(rawSize)) return fail(PERP_ERRORS.NO_SIZE);
  const step = dydxSizeStep(market);
  if (!isPos(step)) return fail(PERP_ERRORS.NO_MARKET);
  const size = roundPerpSize(rawSize, step);
  if (size == null) return fail(PERP_ERRORS.SIZE_BELOW_MIN, { minSize: step });

  /* ── LIFETIME ─────────────────────────────────────────────────────────── */
  const goodTil = input.goodTilSeconds == null
    ? 28 * 24 * 60 * 60
    : Math.round(num(input.goodTilSeconds));
  if (!Number.isFinite(goodTil) || goodTil < caps.minGoodTilSeconds || goodTil > caps.maxGoodTilSeconds) {
    return fail(PERP_ERRORS.BAD_EXPIRY, { min: caps.minGoodTilSeconds, max: caps.maxGoodTilSeconds });
  }

  const tick = dydxTickSize(market);
  const current = num(input.currentPrice ?? market?.oraclePrice);

  /* ── A RESTING LIMIT ──────────────────────────────────────────────────── */
  if (kind === PERP_KIND.ENTRY_LIMIT) {
    if (tick == null) return fail(PERP_ERRORS.TICK_UNKNOWN);
    const rawPrice = num(input.price);
    if (!isPos(rawPrice)) return fail(PERP_ERRORS.NO_PRICE);
    /* Rounded so the user never pays more (buy) or receives less (sell) than
       the number they typed. */
    const price = roundPerpPrice(rawPrice, tick, side === 'buy' ? 'down' : 'up');
    if (!isPos(price)) return fail(PERP_ERRORS.BAD_PRICE);
    if (isPos(current) && ((side === 'buy' && price >= current) || (side === 'sell' && price <= current))) {
      /* A limit that crosses the market is a market order with extra steps:
         it fills immediately at the book, not at the price shown. The user
         meant to rest an order, so the plan says what is wrong instead. */
      return fail(PERP_ERRORS.LIMIT_CROSSES_MARKET, { currentPrice: current });
    }
    return {
      ok: true,
      request: {
        venue: PERP_VENUE.DYDX,
        kind,
        ticker,
        side,
        size,
        /* LIMIT + GTT is the only combination that produces a LONG_TERM order,
           which is the one that rests on the book instead of expiring twenty
           blocks later. IOC/FOK limits are SHORT_TERM and cannot rest. */
        orderType: 'LIMIT',
        timeInForce: 'GTT',
        execution: null,
        postOnly: false,
        reduceOnly: Boolean(input.reduceOnly),
        price,
        triggerPrice: null,
        goodTilTimeInSeconds: goodTil,
        tickSize: tick,
        sizeStep: step,
        currentPrice: isPos(current) ? current : null
      }
    };
  }

  /* ── A TRIGGER ORDER (entry stop, take-profit, stop-loss) ─────────────── */
  const isExit = kind === PERP_KIND.TAKE_PROFIT || kind === PERP_KIND.STOP_LOSS;
  const condition = kind === PERP_KIND.STOP_LOSS || kind === PERP_KIND.ENTRY_STOP ? 'STOP' : 'TAKE_PROFIT';

  if (isExit) {
    /* An exit has to be reduce-only, and it has to be on the side that closes
       the position: a long is closed by SELL, a short by BUY. Refusing here is
       what stops a "stop-loss" from opening a second position in the opposite
       direction when the trigger fires. */
    if (input.reduceOnly !== true) return fail(PERP_ERRORS.NO_POSITION);
    const pos = String(input.positionSide || '').toUpperCase();
    if (pos !== 'LONG' && pos !== 'SHORT') return fail(PERP_ERRORS.BAD_POSITION_SIDE);
    if ((pos === 'LONG' && side !== 'sell') || (pos === 'SHORT' && side !== 'buy')) {
      return fail(PERP_ERRORS.BAD_POSITION_SIDE, { positionSide: pos });
    }
  }

  if (tick == null) return fail(PERP_ERRORS.TICK_UNKNOWN);
  if (!isPos(current)) return fail(PERP_ERRORS.NO_CURRENT_PRICE);

  /*
   * ONE TYPED NUMBER, TWO MEANINGS.
   *
   * The form has a single price field: for a resting limit it is the price the
   * order sits at, and for a trigger it is the price that fires the order. So
   * `triggerPrice` wins when a caller names it explicitly, and `price` is
   * accepted as the same number — refusing the second spelling would mean a
   * correct order rejected over a field name, which is not a safety property.
   */
  const rawTrigger = num(input.triggerPrice ?? input.price);
  if (!isPos(rawTrigger)) return fail(PERP_ERRORS.NO_PRICE);

  const want = dydxTriggerSide(condition, side);
  if (want == null) return fail(PERP_ERRORS.BAD_SIDE);
  /*
   * One check, not two. `want` says which side of the market the trigger has
   * to be on; being on the wrong side and having already been crossed are the
   * same fact seen from two directions, and reporting them separately would
   * mean two codes for one mistake. The message names the market price so the
   * user can see how far to move the number.
   */
  const alreadyCrossed = want === 'above' ? current >= rawTrigger : current <= rawTrigger;
  if (alreadyCrossed) {
    /* The trigger has already been crossed: the venue would fire this the
       moment it lands, at market, which is never what «when the price
       reaches X» meant. */
    return fail(PERP_ERRORS.TRIGGER_WRONG_SIDE, { currentPrice: current, triggerSide: want });
  }

  /* A trigger rounds AWAY from the market so the rounded value is never closer
     to the current price than the typed one. */
  const triggerPrice = roundPerpPrice(rawTrigger, tick, want === 'above' ? 'up' : 'down');
  if (!isPos(triggerPrice)) return fail(PERP_ERRORS.BAD_PRICE);

  /*
   * STOP_MARKET and TAKE_PROFIT_MARKET are what the venue executes as a market
   * order once triggered. The SDK refuses `execution: DEFAULT` and
   * `POST_ONLY` for these two types (`calculateTimeInForce` throws), and IOC is
   * what the shipped TP/SL card already uses, so IOC is the only choice here.
   * The limit price is the trigger moved by the user's slippage bound: it is
   * the worst price the triggered market order may pay, not a resting price.
   */
  const slip = num(input.slippagePct);
  const slippagePct = Number.isFinite(slip) && slip > 0 && slip <= 10 ? slip : 0.5;
  const price = roundPerpPrice(
    triggerPrice * (side === 'sell' ? 1 - slippagePct / 100 : 1 + slippagePct / 100),
    tick,
    side === 'sell' ? 'down' : 'up'
  );
  if (!isPos(price)) return fail(PERP_ERRORS.BAD_PRICE);

  return {
    ok: true,
    request: {
      venue: PERP_VENUE.DYDX,
      kind,
      ticker,
      side,
      size,
      orderType: condition === 'STOP' ? 'STOP_MARKET' : 'TAKE_PROFIT_MARKET',
      /* A conditional order is CONDITIONAL-flagged; timeInForce is not part of
         its flag computation and must stay null, while execution must be IOC
         or FOK. goodTilTimeInSeconds is still mandatory. */
      timeInForce: null,
      execution: 'IOC',
      postOnly: false,
      reduceOnly: isExit ? true : Boolean(input.reduceOnly),
      price,
      triggerPrice,
      goodTilTimeInSeconds: goodTil,
      slippagePct,
      triggerSide: want,
      tickSize: tick,
      sizeStep: step,
      currentPrice: current
    }
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ostium — the plan
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Plan one resting Ostium order.
 *
 * Ostium's opening order carries its own TP and SL, enforced by the protocol,
 * so an entry can be a complete bracket in one signature. Two rules here are
 * not stylistic:
 *
 *   · `slippageP` MUST be 0 for a limit or stop order. Ostium changed this in
 *     February 2026 and a non-zero value now reverts; the vendor SDK forces 0
 *     for every non-market order type, and this plan does the same rather than
 *     forwarding whatever the caller passed.
 *   · the limit/stop price must sit on the correct side of the live mid, for
 *     the same reason as dYdX: an order that would fire immediately is not the
 *     order the user described.
 *
 * @param {object} input
 * @param {object} input.pair   a row from getOstiumMarkets() (pairId, mid,
 *                              isMarketOpen, maxLeverage, takerFeeP)
 * @param {'entry-limit'|'entry-stop'} input.kind
 * @param {'long'|'short'} input.side
 * @param {number|string} input.collateralUsd
 * @param {number|string} input.leverage
 * @param {number|string} input.price
 * @param {number|string} [input.takeProfit]
 * @param {number|string} [input.stopLoss]
 * @param {number} [input.builderFeeBps]
 */
export function planOstiumOrder(input = {}) {
  const caps = PERP_VENUE_CAPS.ostium;
  const kind = String(input.kind || '');
  if (!caps.kinds.includes(kind)) return fail(PERP_ERRORS.KIND_UNSUPPORTED);

  const pair = input.pair;
  const pairId = num(pair?.pairId);
  if (!Number.isFinite(pairId) || pairId < 0) return fail(PERP_ERRORS.NO_MARKET);
  if (pair && pair.isMarketOpen === false) return fail(PERP_ERRORS.MARKET_CLOSED);

  const side = String(input.side || '').toLowerCase();
  if (side !== 'long' && side !== 'short') return fail(PERP_ERRORS.BAD_SIDE);
  const buy = side === 'long';

  const collateral = num(input.collateralUsd);
  if (!Number.isFinite(collateral) || collateral <= 0) return fail(PERP_ERRORS.NO_COLLATERAL);
  if (collateral < caps.minCollateralUsd) {
    return fail(PERP_ERRORS.BELOW_MIN_COLLATERAL, { min: caps.minCollateralUsd });
  }

  const leverage = num(input.leverage);
  if (!isPos(leverage)) return fail(PERP_ERRORS.NO_LEVERAGE);
  /* `maxLeverage` comes from the live pair and differs per pair (and again
     overnight). Null means we have not loaded it; the contract is then
     authoritative and we do not invent a ceiling. */
  const maxLev = num(pair?.maxLeverage);
  if (Number.isFinite(maxLev) && maxLev > 0 && leverage > maxLev) {
    return fail(PERP_ERRORS.LEVERAGE_TOO_HIGH, { maxLeverage: maxLev });
  }

  const mid = num(input.currentPrice ?? pair?.mid);
  if (!isPos(mid)) return fail(PERP_ERRORS.NO_CURRENT_PRICE);

  const rawPrice = num(input.price);
  if (!isPos(rawPrice)) return fail(PERP_ERRORS.NO_PRICE);

  /*
   * Which side of the mid a resting order must be on.
   *
   * A LIMIT buys below the market and sells above it — that is the whole point
   * of resting it. A STOP is the mirror: it triggers when the price crosses
   * OUT through the trigger, so a long stop-entry sits ABOVE the mid (a
   * breakout) and a short stop-entry BELOW it (a breakdown). Getting this the
   * wrong way round is not a validation nit: Ostium executes a triggered stop
   * as a market order, so a stop placed on the near side of the mid fills the
   * instant it lands.
   */
  const want = kind === PERP_KIND.ENTRY_LIMIT
    ? (buy ? 'below' : 'above')
    : (buy ? 'above' : 'below');
  /* One code for both venues' versions of the same mistake: the price is on the
     side of the market where the order would execute the instant it landed. A
     limit that crosses is a market order the user did not ask for; a stop on
     the near side fires immediately at market. */
  const wouldFillNow = want === 'below' ? rawPrice >= mid : rawPrice <= mid;
  if (wouldFillNow) {
    return fail(
      kind === PERP_KIND.ENTRY_LIMIT ? PERP_ERRORS.LIMIT_CROSSES_MARKET : PERP_ERRORS.TRIGGER_WRONG_SIDE,
      { triggerSide: want, currentPrice: mid }
    );
  }

  /* TP and SL are optional but, when present, must be on the side that makes
     them an exit rather than an immediate market close. */
  const tp = num(input.takeProfit);
  const sl = num(input.stopLoss);
  if (Number.isFinite(tp) && tp > 0 && (buy ? tp <= rawPrice : tp >= rawPrice)) {
    return fail(PERP_ERRORS.BAD_TPSL, { field: 'takeProfit' });
  }
  if (Number.isFinite(sl) && sl > 0 && (buy ? sl >= rawPrice : sl <= rawPrice)) {
    return fail(PERP_ERRORS.BAD_TPSL, { field: 'stopLoss' });
  }

  const bps = num(input.builderFeeBps);
  const builderFeeBps = Number.isFinite(bps) && bps >= 0
    ? Math.min(bps, caps.feeCapBps)
    : null;

  return {
    ok: true,
    request: {
      venue: PERP_VENUE.OSTIUM,
      kind,
      pairId: Math.trunc(pairId),
      pairLabel: pair?.label || (pair?.from && pair?.to ? `${pair.from}/${pair.to}` : String(Math.trunc(pairId))),
      side,
      buy,
      orderType: kind === PERP_KIND.ENTRY_LIMIT ? 'limit' : 'stop',
      /* FORCED. See the header: a non-zero slippage on a non-market Ostium
         order reverts. Whatever the caller passed is dropped here, and the
         dropped value is reported so the UI can say why slippage is not a
         field on this form. */
      slippageBps: 0,
      requestedSlippageBps: num(input.slippageBps) || null,
      price: String(rawPrice),
      collateralUsd: collateral,
      leverage,
      notionalUsd: collateral * leverage,
      takeProfit: Number.isFinite(tp) && tp > 0 ? String(tp) : '0',
      stopLoss: Number.isFinite(sl) && sl > 0 ? String(sl) : '0',
      triggerSide: want,
      currentPrice: mid,
      ...(builderFeeBps == null ? {} : { builderFeeBps }),
      isDayTrade: false
    }
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * One door for both venues
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Plan an auto-order on whichever venue the user picked.
 * Returns `{ ok, request }` or `{ ok:false, error }` with a code from
 * PERP_ERRORS. Nothing here signs, sends or stores.
 */
export function planPerpOrder(input = {}) {
  const venue = String(input.venue || '').toLowerCase();
  if (!venue) return fail(PERP_ERRORS.NO_VENUE);
  const caps = perpVenueCaps(venue);
  if (!caps) return fail(PERP_ERRORS.VENUE_UNSUPPORTED);
  if (!caps.kinds.includes(String(input.kind || ''))) return fail(PERP_ERRORS.KIND_UNSUPPORTED);
  return venue === PERP_VENUE.DYDX ? planDydxOrder(input) : planOstiumOrder(input);
}

/**
 * What the user pays, and what we earn, before anything is signed.
 *
 * Returns null rather than a partial number when the venue's own fee is
 * unknown: a total that silently omits the venue's slice makes the trade look
 * cheaper than it is, and that is the one fee bug worth refusing to ship.
 *
 * @param {object} request a plan from planPerpOrder()
 * @param {object} [opts]  { pairOpenFeeBps, builderFeeBps }
 */
export function perpFeePreview(request, opts = {}) {
  if (!request?.venue) return null;

  if (request.venue === PERP_VENUE.DYDX) {
    const notional = num(request.price) * num(request.size);
    if (!isPos(notional)) return null;
    const ourFee = (notional * PERP_DYDX_BUILDER_FEE_PPM) / 1_000_000;
    return {
      venue: 'dydx',
      notionalUsd: notional,
      ourBps: PERP_DYDX_BUILDER_FEE_PPM / 100,
      ourFeeUsd: ourFee,
      /* dYdX's own trading fee is per-market and tiered by volume; we do not
         guess it, so the total is null and the UI shows our slice plus a line
         saying the venue's fee is charged separately. */
      venueFeeUsd: null,
      oracleFeeUsd: 0,
      totalFeeUsd: null
    };
  }

  const notional = num(request.notionalUsd);
  const collateral = num(request.collateralUsd);
  if (!isPos(notional) || !isPos(collateral)) return null;
  const ourBps = num(opts.builderFeeBps ?? request.builderFeeBps);
  const bps = Number.isFinite(ourBps) && ourBps >= 0
    ? Math.min(ourBps, PERP_OSTIUM_VENUE_FEE_CAP_BPS)
    : 0;
  const ourFee = (notional * bps) / 10_000;
  const venueBps = num(opts.pairOpenFeeBps);
  const venueFee = Number.isFinite(venueBps) && venueBps >= 0 ? (notional * venueBps) / 10_000 : null;
  return {
    venue: 'ostium',
    notionalUsd: notional,
    ourBps: bps,
    ourFeeUsd: ourFee,
    venueBps: Number.isFinite(venueBps) ? venueBps : null,
    venueFeeUsd: venueFee,
    oracleFeeUsd: PERP_OSTIUM_ORACLE_FEE_USD,
    totalFeeUsd: venueFee == null ? null : ourFee + venueFee + PERP_OSTIUM_ORACLE_FEE_USD,
    /* The honesty line: our bps of NOTIONAL at 20x is twenty times that
       percentage of what the trader actually put up. */
    ourFeePctOfCollateral: (ourFee / collateral) * 100
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Status — read from the venue, never guessed
 * ──────────────────────────────────────────────────────────────────────────── */

export const PERP_STATE = Object.freeze({
  OPEN: 'open',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown'
});

/**
 * dYdX indexer status → our state.
 *
 * `BEST_EFFORT_CANCELED` is the venue's word for a cancel that was accepted but
 * may have raced a fill; it is reported as cancelled because that is what the
 * order list must show, and the fill history remains the authority on whether
 * anything executed. An unrecognised status is UNKNOWN, never OPEN: a state we
 * cannot read must not be presented as a live order.
 */
export function dydxOrderState(indexerStatus) {
  switch (String(indexerStatus || '').toUpperCase()) {
    case 'OPEN':
    case 'UNTRIGGERED':
    case 'BEST_EFFORT_CANCELED':
      /* Best-effort cancelled still appears in the OPEN/UNTRIGGERED reads until
         the next block; treat it as cancelled so the row does not offer to
         cancel an order that is already gone. */
      return String(indexerStatus).toUpperCase() === 'BEST_EFFORT_CANCELED' ? PERP_STATE.CANCELLED : PERP_STATE.OPEN;
    case 'FILLED':
      return PERP_STATE.FILLED;
    case 'CANCELED':
      return PERP_STATE.CANCELLED;
    case 'EXPIRED':
      return PERP_STATE.EXPIRED;
    default:
      return PERP_STATE.UNKNOWN;
  }
}

/**
 * Ostium subgraph `limits` row → our state.
 *
 * The subgraph only indexes what happened; a row that is still `isActive` is
 * resting, one that started execution has filled or is filling, and a row that
 * vanished from the active set without executing was cancelled. Because a
 * cancelled limit leaves no order row at all, ABSENCE from the active set is
 * answered by the caller against the event feed, and this function only maps
 * what a row says.
 */
export function ostiumOrderState(limitRow) {
  if (!limitRow) return PERP_STATE.UNKNOWN;
  if (limitRow.isActive === true) {
    return limitRow.executionStarted === true ? PERP_STATE.FILLED : PERP_STATE.OPEN;
  }
  if (limitRow.executionStarted === true) return PERP_STATE.FILLED;
  return PERP_STATE.CANCELLED;
}

/**
 * Is a stored auto-order past the lifetime it was placed with?
 *
 * dYdX expires a LONG_TERM order at its `goodTilBlockTime`; Ostium has no
 * order expiry, so only a locally recorded deadline can expire there and we do
 * not invent one. An order whose expiry we cannot read stays OPEN — the venue
 * is the authority, and marking a live order expired locally would hide it.
 */
export function perpOrderExpired(order, now = Date.now()) {
  const until = num(order?.expiresAt);
  if (!Number.isFinite(until) || until <= 0) return false;
  return now > until;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The stored record
 * ──────────────────────────────────────────────────────────────────────────── */

export const PERP_ORDERS_STORAGE_KEY = 'fbt-perp-orders-v1';
export const MAX_PERP_ORDERS = 50;

const makeId = () =>
  `po_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Build the record that goes into local storage after a signature succeeds.
 *
 * Deliberately narrow: the venue, the market, the plan that was signed, the
 * venue's own identifier for the order, and the state we last READ. No
 * signature, no key material, no private key, and no copy of anything the
 * venue can answer better than we can. Nothing here is sent to our server —
 * the venue holds the trigger, so our watcher has nothing to watch, and
 * mirroring these rows to the server would only create a second source of
 * truth that can disagree with the first.
 */
export function createPerpOrder({ request, venueOrderId = null, txHash = null, wallet = null, fee = null }, now = Date.now()) {
  if (!request?.venue) return null;
  const isDydx = request.venue === PERP_VENUE.DYDX;
  const expiresAt = isDydx && Number.isFinite(num(request.goodTilTimeInSeconds))
    ? now + Math.round(num(request.goodTilTimeInSeconds)) * 1000
    : null;
  return {
    id: makeId(),
    venue: request.venue,
    kind: request.kind,
    /* What the user sees in the list. For dYdX the ticker; for Ostium the
       pair label, which is why the plan carries it. */
    market: isDydx ? request.ticker : request.pairLabel,
    marketId: isDydx ? request.ticker : String(request.pairId),
    side: request.side,
    size: isDydx ? request.size : null,
    collateralUsd: isDydx ? null : request.collateralUsd,
    leverage: isDydx ? null : request.leverage,
    notionalUsd: isDydx ? num(request.price) * num(request.size) : request.notionalUsd,
    price: isDydx ? request.price : num(request.price),
    triggerPrice: isDydx ? request.triggerPrice : (request.orderType === 'stop' ? num(request.price) : null),
    takeProfit: isDydx ? null : (request.takeProfit !== '0' ? num(request.takeProfit) : null),
    stopLoss: isDydx ? null : (request.stopLoss !== '0' ? num(request.stopLoss) : null),
    reduceOnly: isDydx ? Boolean(request.reduceOnly) : false,
    status: 'active',
    venueState: PERP_STATE.OPEN,
    venueStateReadAt: now,
    venueStateLive: false,
    venueOrderId: venueOrderId == null ? null : String(venueOrderId),
    txHash: typeof txHash === 'string' && txHash.length >= 8 ? txHash : null,
    wallet: typeof wallet === 'string' && wallet.length > 0 ? wallet : null,
    fee: fee && typeof fee === 'object' ? fee : null,
    createdAt: now,
    placedAt: now,
    expiresAt,
    /* Kept so the cancel path can rebuild the venue's own identifier without
       re-reading the plan: a dYdX cancel needs the clientId AND the order
       flags, and an Ostium cancel needs the pair index and the on-chain slot. */
    cancelRef: isDydx
      ? { clientId: request.clientId ?? null, orderFlags: request.orderType === 'LIMIT' ? 'LONG_TERM' : 'CONDITIONAL', goodTilBlockTime: null }
      : { pairId: request.pairId, index: null }
  };
}

/** Apply a state read from the venue. Pure: returns the next record. */
export function applyPerpState(order, state, { live = true, venueOrderId = null } = {}, now = Date.now()) {
  if (!order) return order;
  const next = { ...order, venueState: state, venueStateReadAt: now, venueStateLive: Boolean(live) };
  if (venueOrderId != null && !next.venueOrderId) next.venueOrderId = String(venueOrderId);
  if (state === PERP_STATE.FILLED) return { ...next, status: 'filled', filledAt: now };
  if (state === PERP_STATE.CANCELLED) return { ...next, status: 'cancelled', cancelledAt: now };
  if (state === PERP_STATE.EXPIRED) return { ...next, status: 'expired', expiredAt: now };
  if (state === PERP_STATE.UNKNOWN && !live) return next;
  return { ...next, status: 'active' };
}

/** Orders whose lifetime has passed, marked expired rather than deleted. */
export function expirePerpOrders(orders, now = Date.now()) {
  if (!Array.isArray(orders)) return [];
  return orders.map((o) =>
    o.status === 'active' && perpOrderExpired(o, now)
      ? { ...o, status: 'expired', expiredAt: now, venueState: PERP_STATE.EXPIRED }
      : o
  );
}

/* ─── local storage ──────────────────────────────────────────────────────────
 * Same shape discipline as src/lib/orders.js: read defensively, write the whole
 * array, and never throw out of a getter. A corrupt row is dropped, not
 * repaired, because a repaired row is a guess about somebody's money. */

export function loadPerpOrders() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PERP_ORDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o) => o && typeof o === 'object' && PERP_VENUES.some((v) => v.id === o.venue) && o.id)
      .slice(0, MAX_PERP_ORDERS);
  } catch {
    return [];
  }
}

export function savePerpOrders(orders) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(PERP_ORDERS_STORAGE_KEY, JSON.stringify(Array.isArray(orders) ? orders.slice(0, MAX_PERP_ORDERS) : []));
    return true;
  } catch {
    return false;
  }
}

export function addPerpOrder(orders, order) {
  if (!order) return Array.isArray(orders) ? orders : [];
  const list = Array.isArray(orders) ? orders : [];
  return [order, ...list].slice(0, MAX_PERP_ORDERS);
}

export function updatePerpOrder(orders, id, patch) {
  if (!Array.isArray(orders)) return [];
  return orders.map((o) => (o.id === id ? { ...o, ...(patch || {}) } : o));
}

export function removePerpOrder(orders, id) {
  if (!Array.isArray(orders)) return [];
  return orders.filter((o) => o.id !== id);
}

/** Live (still resting) rows, newest first — what the list shows at the top. */
export function perpOrdersLive(orders) {
  return (Array.isArray(orders) ? orders : []).filter((o) => o.status === 'active');
}

/** Rows that finished, for the history fold. */
export function perpOrdersDone(orders) {
  return (Array.isArray(orders) ? orders : []).filter((o) => o.status !== 'active');
}
