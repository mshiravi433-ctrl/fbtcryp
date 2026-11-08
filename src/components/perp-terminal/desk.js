/**
 * FUTURES TERMINAL — the desk's arithmetic, with no React in it.
 * ---------------------------------------------------------------------------
 * Everything the terminal decides that is NOT layout lives here, so it can be
 * tested against numbers a reviewer can check by hand:
 *
 *   topBar(quote)          the five figures across the top of a desk
 *   ticketMath(...)        size, notional, fee, funding, liquidation, margin
 *   orderTypeOptions(...)  which order-type chips a venue may render
 *   depthLevels(...)       the ladder the chart draws, in USD and in %
 *   tapeRows(...)          the tape, with the size bar normalised
 *   fundingTable(...)      what holding has cost, realised
 *   portfolioFor(...)      the account panel, from the risk engine
 *   riskVocabulary(...)    ONE risk scale for the whole product
 *
 * ─── TWO RULES, APPLIED EVERYWHERE ──────────────────────────────────────────
 * 1. NO FABRICATED NUMBER. When an input is missing the answer is `null`, and
 *    `null` is what makes the UI print «—». There is no `|| 0` in this file
 *    that stands in for an unknown; the ones that exist are for REAL zeroes
 *    (a fee of zero is a fact when the venue charges none).
 * 2. ONE FORMULA PER NUMBER. The liquidation preview calls the risk engine;
 *    the fee calls the venue's cap check; the funding calls `fundingCost`.
 *    Nothing here re-derives a number a module already owns.
 */

import {
  liquidationDistance, fundingCost, accountMargin, portfolioExposure,
  scenarioShock, assessPortfolioRisk, RISK_LEVEL
} from '../../lib/futures-engine/risk.js';
import {
  orderTypesFor, validateOrderForVenue, liquidationPlan, contractFor, LIQUIDATION_SOURCE
} from '../../lib/futures-engine/venueContract.js';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pos = (v) => (num(v) > 0 ? num(v) : null);

/* ── the top bar ──────────────────────────────────────────────────────────── */

/**
 * The five figures a desk puts above the chart, from whatever the venue sent.
 *
 * `change24hPct` is deliberately NOT recomputed from the range: a 24h change is
 * measured against the price 24 hours ago, and inferring it from a high/low
 * window is a different number that happens to look similar. If the venue omits
 * it, the cell shows «—» and `dataStatus` says why.
 *
 * `markSource` records WHICH price this is (venue's oracle, BFF mid, last
 * trade), because on a terminal "the price" is three different numbers.
 */
export function topBar(quote = {}) {
  const mark = pos(quote.mark) ?? pos(quote.oraclePrice) ?? pos(quote.price);
  const high = pos(quote.high24h);
  const low = pos(quote.low24h);
  /* Where the mark sits inside its own 24h range: 0% = at the low, 100% = at
     the high. The thin bar under the price in every desk terminal. */
  const rangePositionPct = mark != null && high != null && low != null && high > low
    ? Math.min(100, Math.max(0, ((mark - low) / (high - low)) * 100))
    : null;
  return {
    mark,
    markSource: pos(quote.mark) != null ? 'venue-mid' : pos(quote.oraclePrice) != null ? 'venue-oracle' : pos(quote.price) != null ? 'feed-price' : null,
    change24hPct: num(quote.change24hPct ?? quote.priceChange24H ?? quote.priceChange24hPct),
    high24h: high,
    low24h: low,
    rangePositionPct,
    volume24hUsd: pos(quote.volume24hUsd ?? quote.volume24H),
    openInterestUsd: pos(quote.openInterestUsd ?? quote.openInterest),
    fundingAprPct: num(quote.fundingAprPct ?? (num(quote.nextFundingRate) != null ? num(quote.nextFundingRate) * 100 * 24 * 365 : null)),
    nextFundingAtMs: num(quote.nextFundingAtMs),
    /* Hours to the next settlement, which is what a funding cell means. */
    fundingInHours: (() => {
      const at = num(quote.nextFundingAtMs);
      if (at == null) return null;
      const h = (at - Date.now()) / 3_600_000;
      return h > 0 ? h : 0;
    })(),
    maxLeverage: pos(quote.maxLeverage),
    spreadBps: num(quote.spreadBps),
    dataStatus: mark == null ? 'unavailable' : (high == null || low == null) ? 'partial' : 'live'
  };
}

/* ── the ticket ───────────────────────────────────────────────────────────── */

/**
 * Everything a ticket shows before the order exists — computed once, from the
 * same engine the confirmation will use.
 *
 * Order of operations, because it matters:
 *   notional = collateral × leverage          (what the position controls)
 *   fee      = notional × takerBps / 10 000   (what it costs to open)
 *   margin ratio = (initial margin + maintenance) / equity, from the engine
 *   liquidation  = engine, with the venue's OWN maintenance fraction
 *
 * `blocked` is the first reason this ticket cannot be sent, in the order a
 * trader hits the constraints. A blocked ticket still SHOWS its numbers: the
 * honest answer to "why not" is the number that failed, not an empty panel.
 */
export function ticketMath({
  providerId, side = 'long', collateralUsd, leverage, entryPrice,
  maxLeverage = null, maintenanceMarginFraction = null, takerFeeRate = null,
  takerFeeBps = null, fundingAprPct = null, orderType = 'market', price = null, stopPrice = null,
  timeInForce = 'GTC', postOnly = false, reduceOnly = false, takeProfit = null, stopLoss = null,
  availableBalanceUsd = null, equityUsd = null, minNotionalUsd = null
} = {}) {
  const collateral = pos(collateralUsd);
  const lev = pos(leverage);
  const entry = pos(entryPrice) ?? pos(price);
  const venue = contractFor(providerId);

  const feeRate = pos(takerFeeRate) ?? (pos(takerFeeBps) != null ? pos(takerFeeBps) / 10_000 : null);
  const notionalUsd = collateral != null && lev != null ? collateral * lev : null;
  const size = notionalUsd != null && entry != null ? notionalUsd / entry : null;
  const openFeeUsd = notionalUsd != null && feeRate != null ? notionalUsd * feeRate : null;

  /* The engine's own preview, so the ticket and the position card can never
     print two different liquidation prices for the same order. */
  const liq = notionalUsd != null && entry != null
    ? liquidationDistance({
      providerId, side, entryPrice: entry, leverage: lev, maxLeverage,
      maintenanceMarginFraction, takerFeeRate: feeRate
    })
    : null;

  const plan = liquidationPlan(providerId, { maintenanceMarginFraction });
  const validation = validateOrderForVenue({
    providerId, orderType, price, stopPrice, timeInForce, postOnly, reduceOnly, takeProfit, stopLoss
  });

  const maintenanceUsd = notionalUsd != null && pos(maintenanceMarginFraction) != null
    ? notionalUsd * pos(maintenanceMarginFraction)
    : null;
  /* Initial margin is the collateral the position locks at this leverage —
     by definition notional / leverage — so the margin block is exact even on a
     venue that publishes no fractions. */
  const initialMarginUsd = collateral;
  const margin = accountMargin({
    equityUsd: pos(equityUsd) ?? pos(availableBalanceUsd),
    maintenanceMarginUsd: maintenanceUsd,
    initialMarginUsd,
    availableBalanceUsd: pos(availableBalanceUsd)
  });

  const funding = fundingCost({ notionalUsd, fundingAprPct, hours: 8 });

  const blocked = !venue ? 'UNKNOWN_VENUE'
    : venue.executionMounted === false ? 'EXECUTION_NOT_MOUNTED'
      : !(notionalUsd > 0) ? 'NO_SIZE'
        : entry == null ? 'NO_PRICE'
          : !validation.ok ? validation.code
            : maxLeverage != null && lev > maxLeverage ? 'LEVERAGE_ABOVE_VENUE_MAX'
              : minNotionalUsd != null && notionalUsd < minNotionalUsd ? 'BELOW_MIN_NOTIONAL'
                : null;

  return {
    side,
    collateralUsd: collateral,
    leverage: lev,
    /* A notional with no price behind it is arithmetic, not a tradeable size:
       the ticket hides it and the block explains why. */
    notionalUsd: blocked === 'NO_PRICE' ? null : notionalUsd,
    rawNotionalUsd: notionalUsd,
    size: blocked === 'NO_PRICE' ? null : size,
    entryPrice: entry,
    openFeeUsd,
    openFeeBps: feeRate != null ? feeRate * 10_000 : null,
    fundingUsd8h: funding.usd,
    fundingAprPct: num(fundingAprPct),
    liquidation: liq ? {
      price: liq.liquidationPrice,
      distancePct: liq.distancePct,
      movePct: liq.movePct,
      model: liq.model,
      exact: plan.exact,
      /* What the label under the number says: an exact venue number, or a
         bound that must be named as one. Never a bare price. */
      provenance: plan.exact ? 'venue-maintenance-margin' : (liq.model === 'ostium-docs' ? 'venue-rule' : 'upper-bound')
    } : { price: null, distancePct: null, movePct: null, model: null, exact: false, provenance: 'unavailable' },
    margin: {
      ratioPct: margin.marginRatioPct,
      level: margin.marginRatioLevel,
      bufferUsd: margin.bufferUsd
    },
    orderType: String(orderType || 'market').toLowerCase(),
    validation,
    blocked,
    warnings: [
      ...(liq && liq.model && liq.model !== 'ostium-docs' && !plan.exact ? ['LIQUIDATION_IS_AN_UPPER_BOUND'] : []),
      ...(feeRate == null ? ['FEE_UNKNOWN'] : []),
      ...(fundingAprPct == null ? ['FUNDING_UNKNOWN'] : []),
      ...(maintenanceUsd == null && providerId === 'dydx' ? ['MMR_MISSING_FROM_MARKET'] : [])
    ]
  };
}

/** The order-type chips a ticket renders for a venue, plus why the rest are absent. */
export function orderTypeOptions(providerId) {
  const types = orderTypesFor(providerId);
  const venue = contractFor(providerId);
  return {
    options: types,
    unavailable: [
      ...(venue && !venue.postOnly ? ['postOnly'] : []),
      ...(venue && !venue.reduceOnly ? ['reduceOnly'] : []),
      ...(venue && !venue.tpSl ? ['tpSl'] : []),
      ...(!venue || !venue.orderTypes.includes('stopLimit') ? ['stopLimit'] : []),
      ...(!venue || !venue.orderTypes.includes('takeProfitLimit') ? ['takeProfitLimit'] : [])
    ]
  };
}

/* ── the order book ───────────────────────────────────────────────────────── */

/**
 * The ladder, grouped to `rows` levels per side and expressed in USD.
 *
 * `cumulativeUsd` is recomputed here rather than trusted from the client, so a
 * book that arrives without the field still draws the right curve — and a book
 * that arrives WITH it cannot disagree with what is on screen. `imbalancePct`
 * is the share of the visible book that is bids.
 */
export function depthLevels({ bids = [], asks = [], rows = 12 } = {}) {
  const take = (list, dir) => {
    const clean = (Array.isArray(list) ? list : [])
      .filter((r) => pos(r?.price) != null && pos(r?.size) != null)
      .slice(0, Math.max(1, rows));
    if (!clean.length) return [];
    /* Distance from the TOUCH of this side (best bid / best ask), not from the
       mid: a trader reads a ladder as "how far from the best price", and the
       two sides have different touches. */
    const touch = pos(clean[0].price);
    let run = 0;
    return clean.map((r) => {
      const price = pos(r.price);
      const size = pos(r.size);
      const usd = price * size;
      run += usd;
      return {
        price,
        size,
        usd,
        offsetFromTouchPct: touch ? ((price - touch) / touch) * 100 : null,
        cumulativeUsd: run,
        dir
      };
    });
  };
  const bidRows = take(bids, 'bid');
  const askRows = take(asks, 'ask');
  const bidUsd = bidRows.reduce((n, r) => n + r.usd, 0);
  const askUsd = askRows.reduce((n, r) => n + r.usd, 0);
  return {
    bids: bidRows,
    asks: askRows,
    bidUsd,
    askUsd,
    imbalancePct: bidUsd + askUsd > 0 ? (bidUsd / (bidUsd + askUsd)) * 100 : null,
    /* The deepest visible level's distance: how far the drawn book reaches. */
    reachPct: Math.max(
      ...bidRows.map((r) => Math.abs(r.offsetFromTouchPct || 0)),
      ...askRows.map((r) => Math.abs(r.offsetFromTouchPct || 0)),
      0
    ) || null,
    empty: bidRows.length === 0 && askRows.length === 0
  };
}

/* ── the tape ─────────────────────────────────────────────────────────────── */

/**
 * Tape rows with a normalised size bar.
 *
 * `barPct` is the print's notional as a share of the biggest print in the
 * window — a visual weight, not a market statistic. `side` is the TAKER side,
 * which is the only honest colour for a print (see lib/dydx.js).
 */
export function tapeRows(trades = [], { rows = 30 } = {}) {
  const list = (Array.isArray(trades) ? trades : [])
    .filter((t) => pos(t?.price) != null && pos(t?.size) != null)
    .slice(0, Math.max(1, rows));
  const peak = list.reduce((m, t) => Math.max(m, pos(t.usd) ?? 0), 0);
  const buyUsd = list.filter((t) => t.side === 'buy').reduce((n, t) => n + (pos(t.usd) ?? 0), 0);
  const sellUsd = list.filter((t) => t.side === 'sell').reduce((n, t) => n + (pos(t.usd) ?? 0), 0);
  return {
    rows: list.map((t) => ({
      id: t.id,
      price: pos(t.price),
      size: pos(t.size),
      usd: pos(t.usd),
      side: t.side === 'buy' || t.side === 'sell' ? t.side : 'unknown',
      atMs: num(t.atMs),
      barPct: peak > 0 ? ((pos(t.usd) ?? 0) / peak) * 100 : null
    })),
    buyUsd,
    sellUsd,
    /* Aggressor split: above 50% the buyers are lifting offers. */
    buySharePct: buyUsd + sellUsd > 0 ? (buyUsd / (buyUsd + sellUsd)) * 100 : null,
    empty: list.length === 0
  };
}

/* ── funding history ──────────────────────────────────────────────────────── */

/**
 * The realised funding table: each settlement as a cost on a given notional,
 * plus the running total. `hours` is derived from the timestamps, not assumed
 * to be 1, because a missed settlement upstream must not be costed as zero.
 */
export function fundingTable(rows = [], { notionalUsd = null, rows: max = 24 } = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((r) => num(r?.rateHourlyPct) != null && num(r?.atMs) != null)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(-Math.max(1, max));
  let runPct = 0;
  const out = list.map((r, i) => {
    runPct += r.rateHourlyPct;
    const prev = list[i - 1];
    const gapHours = prev ? Math.max(0, (r.atMs - prev.atMs) / 3_600_000) : null;
    return {
      atMs: r.atMs,
      rateHourlyPct: r.rateHourlyPct,
      aprPct: num(r.aprPct),
      longPays: r.rateHourlyPct > 0,
      usd: notionalUsd != null ? (notionalUsd * r.rateHourlyPct) / 100 : null,
      cumulativePct: runPct,
      cumulativeUsd: notionalUsd != null ? (notionalUsd * runPct) / 100 : null,
      gapHours
    };
  });
  return {
    rows: out,
    settlements: out.length,
    cumulativePct: out.length ? runPct : null,
    /* The same total in money, so a panel never multiplies it again. */
    cumulativeUsd: notionalUsd != null && out.length ? (notionalUsd * runPct) / 100 : null,
    /* Annualised over the window actually covered, so a 6-hour window does not
       masquerade as a yearly average. */
    windowAprPct: (() => {
      if (out.length < 2) return null;
      const hours = (out[out.length - 1].atMs - out[0].atMs) / 3_600_000;
      return hours > 0 ? ((runPct / hours) * 24 * 365) : null;
    })(),
    empty: out.length === 0
  };
}

/* ── the account panel ────────────────────────────────────────────────────── */

/**
 * The portfolio block: margin, exposure, shocks and warnings from ONE call to
 * the engine, mapped into the shape the panel renders.
 *
 * `positions` take the shape the BFF already returns from
 * `/api/v1/futures/positions/:wallet` — `{ symbol, side, notionalUsd }` at
 * minimum, with `leverage`, `entryPrice` and `markPrice` when the venue gives
 * them. A position with no notional is dropped rather than counted as zero:
 * a zero-size position is not a position.
 */
export function portfolioFor({ positions = [], equityUsd = null, maintenanceMarginUsd = null, initialMarginUsd = null, availableBalanceUsd = null, fundingAprPct = null, movesPct } = {}) {
  const clean = (Array.isArray(positions) ? positions : []).filter((p) => pos(p?.notionalUsd) != null);
  if (!clean.length && pos(equityUsd) == null) {
    return {
      available: false,
      reason: 'NO_ACCOUNT_DATA',
      exposure: portfolioExposure([], { equityUsd: null }),
      margin: accountMargin({}),
      shocks: { rows: [], liquidationScenario: null, worstPnlUsd: null },
      funding: [],
      warnings: [],
      riskLevel: null,
      riskScore: null
    };
  }
  const assessed = assessPortfolioRisk({
    equityUsd: pos(equityUsd),
    maintenanceMarginUsd: pos(maintenanceMarginUsd),
    initialMarginUsd: pos(initialMarginUsd),
    availableBalanceUsd: pos(availableBalanceUsd),
    positions: clean.map((p) => ({ symbol: p.symbol, side: p.side, notionalUsd: pos(p.notionalUsd) })),
    fundingAprPct: num(fundingAprPct),
    movesPct
  });
  return { available: true, ...assessed };
}

/* ── risk vocabulary ──────────────────────────────────────────────────────── */

/**
 * ONE SCALE, TWO VOCABULARIES.
 *
 * The futures engine speaks LOW / MEDIUM / HIGH / EXTREME. The Intent OS risk
 * module (src/lib/central/risk.js) speaks LOW / MODERATE / ELEVATED / HIGH /
 * CRITICAL. Both are in the product; neither may be rewritten (the second one
 * is consumed by the opportunity feed and the trading brain). So the mapping is
 * explicit, total, and tested — a badge cannot say one word while the engine
 * that produced it said another.
 *
 * The mapping is not a synonym list; it is a position on a five-band scale:
 *
 *   EXTREME (engine)  →  CRITICAL (intent)
 *   HIGH              →  HIGH
 *   MEDIUM            →  ELEVATED
 *   (—)               →  MODERATE   ← only the intent scale has this band
 *   LOW               →  LOW
 *
 * The asymmetry is real and stated: the futures engine has four bands and the
 * intent scale has five, so translating futures→intent never produces MODERATE.
 * Going the other way, MODERATE maps to MEDIUM. Neither direction is lossy in a
 * way that changes a decision, and both are pinned in the tests.
 */
export const RISK_VOCABULARY = Object.freeze({
  futuresToIntent: Object.freeze({
    [RISK_LEVEL.LOW]: 'LOW',
    [RISK_LEVEL.MEDIUM]: 'ELEVATED',
    [RISK_LEVEL.HIGH]: 'HIGH',
    [RISK_LEVEL.EXTREME]: 'CRITICAL'
  }),
  intentToFutures: Object.freeze({
    LOW: RISK_LEVEL.LOW,
    MODERATE: RISK_LEVEL.MEDIUM,
    ELEVATED: RISK_LEVEL.MEDIUM,
    HIGH: RISK_LEVEL.HIGH,
    CRITICAL: RISK_LEVEL.EXTREME
  })
});

/** Translate an engine level into the Intent OS word. Unknown → null, never a guess. */
export const toIntentRiskWord = (level) => RISK_VOCABULARY.futuresToIntent[String(level || '').toUpperCase()] ?? null;
/** Translate an Intent OS word into the engine's level. */
export const toFuturesRiskLevel = (word) => RISK_VOCABULARY.intentToFutures[String(word || '').toUpperCase()] ?? null;

/**
 * The same translation for a NUMBER, which is how the two modules will meet in
 * practice: `futuresRisk()` and `assessRisk()` both produce a 0–100 score, and
 * a panel that shows a badge from one and a score from the other must use one
 * band table. The bands are the engine's (`RISK_POLICY_DEFAULTS.riskBands`) so
 * the badge is derived, not decided twice.
 */
export const riskLevelFromScore = (score) => {
  const n = num(score);
  if (n == null) return null;
  if (n >= 85) return RISK_LEVEL.EXTREME;
  if (n >= 60) return RISK_LEVEL.HIGH;
  if (n >= 35) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
};

/** One label for the liquidation provenance, so every panel says the same words. */
export const LIQUIDATION_PROVENANCE_LABEL = Object.freeze({
  'venue-maintenance-margin': 'exact · venue maintenance margin',
  'venue-rule': 'exact · venue documented rule',
  'upper-bound': 'approximate · 100% loss bound',
  unavailable: '—'
});

export const liquidationModelName = (model) => (
  model === 'maintenance-margin' ? LIQUIDATION_SOURCE.MAINTENANCE
    : model === 'ostium-docs' ? LIQUIDATION_SOURCE.VENUE_DOCS
      : LIQUIDATION_SOURCE.UPPER_BOUND
);
