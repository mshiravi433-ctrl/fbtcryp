/**
 * SIGNAL CONSENSUS — «موتور یکسان‌ساز نتایج»
 * ===========================================================================
 * The Signals page already holds four independent observations about the same
 * asset, from four different places, updated on four different clocks:
 *
 *   technical   the price series (RSI, MACD, MAs, Bollinger, backtest edge)
 *   behavior    HOW the token traded (participation, tape pressure, relative
 *               strength, volume agreement, anomaly, pattern repeat)
 *   smart money what large labelled wallets actually did (verified swaps,
 *               accumulation / distribution, exchange net flow)
 *   market      FBT Global: is the whole market leaning the same way
 *               (cap change, breadth, BTC dominance) plus the AI candle
 *               forecast's own direction for this asset
 *
 * Until now each of those spoke into `buildEvidence()` as one more vote of
 * weight 1, which meant a loud single observation could out-shout three quiet
 * agreeing ones — and two planes that were secretly the same number could be
 * counted twice. This module is the READER of those four planes: it decides
 * which of them actually said something, whether they say the SAME thing, and
 * how much the agreement is worth.
 *
 * ─── THE RULE THE USER ASKED FOR, IN ONE LINE ─────────────────────────────
 * «در اسمارت مانی فروش بیت‌کوین زیاد بوده، پس احتمال سیگنال فروش و کاهش قیمت
 *  هست» — heavy smart-money SELLING of BTC is bearish, and it must be able to
 * move the call. Here it does, and it agrees or disagrees EXPLICITLY with the
 * rest instead of being silently diluted.
 *
 * ─── WHAT THIS MODULE REFUSES TO DO ───────────────────────────────────────
 * • It never invents a plane. A plane that was not measured is `null` and is
 *   excluded from the count entirely — not counted as neutral, not as 0.
 * • It never lets one plane carry the verdict. Two independent planes must
 *   agree before consensus is > 0; one loud plane alone is «mixed», which is
 *   the honest answer.
 * • It never reports a magnitude it cannot justify. The multiplier is bounded
 *   (0.8 … 1.25) and so is the final score, so this can sharpen a call but can
 *   never manufacture a STRONG_BUY out of a WATCH.
 * • It never costs a request. Every input arrives from a computation the page
 *   (or the engine) has already done. There is no fetch, no timer, no storage
 *   in this file.
 *
 * Pure, deterministic, dependency-free — so it can be asserted directly.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Plane identifiers, in the order they are reported. */
export const PLANES = Object.freeze(['technical', 'behavior', 'smartMoney', 'market']);

/** How far one plane may lean. Kept small: agreement is the signal, not size. */
const MAX_LEAN = 3;

/**
 * Turn one already-computed read into a lean of −3 … +3, or `null`.
 *
 * `null` means «not measured» and is the ONLY way a plane abstains. Returning
 * 0 for a missing input would quietly count silence as a neutral vote, which
 * is how a single loud plane ends up looking like a consensus of four.
 */
function lean(net, state = 1) {
  const n = num(net);
  if (n === null) return null;
  if (Math.abs(n) < 1e-9) return 0;
  return clampf(Math.sign(n) * Math.round(Math.min(MAX_LEAN, 1 + Math.abs(n) * state)), -MAX_LEAN, MAX_LEAN);
}

/**
 * Build the consensus from the four planes.
 *
 * @param {object}   input
 * @param {number}   input.technical   signed technical read: analysis.score, or
 *                                     (behaviourless) the weighted evidence score
 * @param {object}   input.behavior    `readTokenBehavior()` output, or null
 * @param {object}   input.smartMoney  `{ signal:'ACCUMULATION'|'DISTRIBUTION',
 *                                       netUsd, confidence }` for THIS token,
 *                                     or the market-wide net flow, or null
 * @param {object}   input.market      `{ mcapChange, avgChange, breadth,
 *                                       btcDominance, forecast }` — any subset
 * @param {number=}  input.strength    |evidence score| 0…100, used only to
 *                                     decide whether the planes are loud enough
 *                                     to be worth sharpening
 *
 * @returns {{
 *   score:number, signals:Array<{plane:string, dir:-1|0|1, lean:number, key:string}>,
 *   agreement:number, disagreement:number, measured:number,
 *   bias:'up'|'down'|'flat', confidence:number, multiplier:number,
 *   conflict:{ up:string[], down:string[] }|null,
 *   detail:{ behavior:number|null, smartMoney:number|null, market:number|null }
 * }}
 */
export function readConsensus({
  technical = null,
  behavior = null,
  smartMoney = null,
  market = null,
  strength = 0
} = {}) {
  /* ── plane 1 · technical ────────────────────────────────────────────────
     Already the master blend of six indicators; used here as one voice among
     four, not as the ruler. */
  const techScore = num(technical);
  const techLean = lean(techScore === null ? null : techScore / 20);

  /* ── plane 2 · behaviour ────────────────────────────────────────────────
     The engine's own composite, which is itself an average of measured parts;
     `parts` tells us whether anything was measurable at all. */
  const behScore = behavior && num(behavior.score) !== null && (behavior.parts ?? 0) > 0
    ? num(behavior.score)
    : null;
  const behLean = lean(behScore === null ? null : behScore / 25);

  /* ── plane 3 · smart money ──────────────────────────────────────────────
     Two shapes are accepted, because the page legitimately has both:
       • a per-token verified row  { signal, netUsd, confidence }
       • the market-wide overview  { netFlowUsd }  (verified swaps only)
     A row's stated signal and the SIGN of its measured flow must agree; if
     they contradict each other, the row is treated as unmeasured rather than
     as a vote in either direction. */
  let smLean = null;
  if (smartMoney && typeof smartMoney === 'object') {
    const signal = String(smartMoney.signal || '').toUpperCase();
    const flow = num(smartMoney.netUsd) ?? num(smartMoney.netFlowUsd);
    const conf = num(smartMoney.confidence);
    const stated = signal === 'ACCUMULATION' ? 1 : signal === 'DISTRIBUTION' ? -1 : 0;
    const measuredDir = flow === null ? 0 : Math.sign(flow);
    if (flow !== null && stated !== 0 && measuredDir !== 0 && stated !== measuredDir) {
      smLean = null; // contradictory row — abstain, never guess
    } else if (flow !== null) {
      /* Size matters here in a way it does not for the other planes: a $40M
         distribution is a different fact from a $400 one. Log-scaled so the
         top of the scale does not flatten everything below it. */
      const scale = clampf(Math.log10(1 + Math.abs(flow) / 10_000) / 3, 0, 1);
      smLean = clampf(Math.sign(flow) * Math.round(1 + scale * (MAX_LEAN - 1)), -MAX_LEAN, MAX_LEAN);
    } else if (stated !== 0) {
      /* No USD figure but a stated, verified direction (the client gate only
         lets rows through with ≥3 independent voters): still a real vote. */
      const weight = conf !== null ? clampf(conf / 100, 0, 1) : 0.6;
      smLean = clampf(stated * Math.round(1 + weight * (MAX_LEAN - 1)), -MAX_LEAN, MAX_LEAN);
    }
  }

  /* ── plane 4 · market ───────────────────────────────────────────────────
     FBT Global answers «is the tide coming in?», and the candle forecast (when
     the device has already run one) answers «which way is this asset leaning»
     — they are the same question at two scales, so they are averaged rather
     than double-counted. Both are optional. */
  let marketLean = null;
  if (market && typeof market === 'object') {
    const parts = [];
    const mcap = num(market.mcapChange);
    if (mcap !== null) parts.push(clampf(mcap / 3, -1, 1));
    const avg = num(market.avgChange);
    if (avg !== null) parts.push(clampf(avg / 4, -1, 1));
    const breadth = num(market.breadth); // share of assets up, 0…1
    if (breadth !== null) parts.push(clampf((breadth - 0.5) * 2, -1, 1));
    /* BTC dominance rising while the cap falls is risk-off: bearish for alts,
       slightly bullish for BTC itself. It is only ever a tilt. */
    const dom = num(market.btcDominance);
    if (dom !== null && mcap !== null) parts.push(clampf((dom - 50) / 100, -0.5, 0.5) * Math.sign(mcap || 1));
    const forecast = num(market.forecast); // signed % move implied by the candle forecast
    if (forecast !== null) parts.push(clampf(forecast / 3, -1, 1));
    if (parts.length) {
      const avgLean = parts.reduce((a, b) => a + b, 0) / parts.length;
      marketLean = lean(avgLean * 2);
    }
  }

  const detail = { behavior: behLean, smartMoney: smLean, market: marketLean };
  const rows = [
    { plane: 'technical', lean: techLean },
    { plane: 'behavior', lean: behLean },
    { plane: 'smartMoney', lean: smLean },
    { plane: 'market', lean: marketLean }
  ];
  const measured = rows.filter((r) => r.lean !== null);
  const up = measured.filter((r) => r.lean > 0);
  const down = measured.filter((r) => r.lean < 0);
  const flat = measured.filter((r) => r.lean === 0);

  /* Net lean, weighted by how loudly each plane spoke — but capped at one per
     plane, so a single plane at maximum lean can never exceed the room left by
     an opposing plane. */
  const net = measured.reduce((s, r) => s + Math.sign(r.lean), 0);

  /*
   * Two independent planes must point the same way before this counts as
   * consensus. ONE loud plane and three quiet ones is «mixed» — and the caller
   * is told so, so the card can say «mixed» rather than imply agreement.
   */
  const decided = up.length >= 2 && down.length === 0 ? 'up'
    : down.length >= 2 && up.length === 0 ? 'down'
      : up.length > down.length && up.length >= 2 ? (net > 0 ? 'up' : 'flat')
        : down.length > up.length && down.length >= 2 ? (net < 0 ? 'down' : 'flat')
          : 'flat';

  const agreement = measured.length ? Math.max(up.length, down.length) / measured.length : 0;
  const disagreement = measured.length ? Math.min(up.length, down.length) / measured.length : 0;

  /* Confidence in the consensus itself: how many planes spoke, how much they
     agreed, and whether anything is loud enough to be worth acting on. */
  const strengthNum = clampf(Math.abs(num(strength) ?? 0) / 40, 0, 1);
  const consensusConfidence = measured.length
    ? clampf(Math.round(agreement * 55 + (measured.length / PLANES.length) * 25 + strengthNum * 20), 10, 95)
    : 0;

  /*
   * THE MULTIPLIER. This is the whole point of the module: when the planes
   * agree, the same evidence should count for more; when they conflict, the
   * card should be softer, not louder. Bounded so it sharpens without
   * inventing, and centred on 1.0 so a neutral/mixed reading changes nothing.
   */
  let multiplier = 1;
  if (decided !== 'flat') {
    const agree = decided === 'up' ? agreement : agreement;
    multiplier = clampf(1 + (agree - 0.5) * 0.5, 0.8, 1.25);
    /* A plane that opposes a decided consensus takes the edge off. */
    multiplier = clampf(multiplier - disagreement * 0.25, 0.8, 1.25);
    multiplier = Math.round(multiplier * 1000) / 1000;
  } else if (disagreement > 0) {
    /* Real, measured disagreement: soften the call rather than pretend. */
    multiplier = Math.round(clampf(1 - Math.min(0.15, disagreement * 0.3), 0.8, 1.25) * 1000) / 1000;
  }

  const conflict = up.length && down.length
    ? {
      up: up.map((r) => r.plane),
      down: down.map((r) => r.plane)
    }
    : null;

  return {
    /* The same scale as `evidenceScore`, so callers can add it up. */
    score: measured.length ? Math.round(clampf((net / Math.max(1, measured.length * 1.5)) * 100, -100, 100)) : 0,
    signals: rows.map((r) => ({
      plane: r.plane,
      dir: r.lean === null ? 0 : Math.sign(r.lean),
      lean: r.lean,
      measured: r.lean !== null
    })),
    agreement: Math.round(agreement * 100) / 100,
    disagreement: Math.round(disagreement * 100) / 100,
    measured: measured.length,
    flat: flat.length,
    bias: decided,
    confidence: consensusConfidence,
    multiplier,
    conflict,
    detail
  };
}

export default readConsensus;
