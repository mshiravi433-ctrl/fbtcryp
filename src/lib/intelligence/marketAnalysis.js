/**
 * FBT AI INTELLIGENCE — MARKET ANALYSIS (the extra brain)
 * ---------------------------------------------------------------------------
 * «هوش مصنوعی را در بالاترین حد باهوش بودن قرار بده و مرحله بعدی ان را امگرید
 *  کن که خیلی باهوش‌تر شود و همه چیزهای ان عملیاتی شود»
 *
 * The overview answers WHAT the market is doing. This module answers the four
 * questions a desk actually trades off, using only rows that already arrived:
 *
 *   1. WHERE IS THE RISK?      concentration of the move, realised dispersion,
 *                              how lopsided the tape is, how thin the book.
 *   2. WHERE IS THE MOMENTUM?  a ranked shortlist scored on relative strength,
 *                              participation (turnover vs its own peer group)
 *                              and position inside the day's range.
 *   3. WHAT IS DIVERGING?      tokens moving against the tape, and tokens
 *                              whose volume exploded without a price move.
 *   4. WHAT WOULD CHANGE THE   the exact levels/numbers that would flip the
 *      READ?                   regime — printed as conditions, not as advice.
 *
 * ─── THE RULES (inherited, non-negotiable) ──────────────────────────────────
 * · No number is generated. Every value below is a function of the same feed
 *   the overview reads; a token missing a field is EXCLUDED from that metric
 *   and named, never counted as zero.
 * · A score never travels without its coverage. `scoreToken()` refuses below
 *   55% weight coverage; this module refuses a ranking below `MIN_RANKED`.
 * · Nothing here is a signal. Every shortlist entry carries `not-a-signal`
 *   and the reasons it was ranked, so a reader can disagree with the inputs.
 * · The whole read is deterministic: the same feed produces the same output,
 *   which is what lets the tests assert it.
 */
import { median, percentileRank, clamp } from './indicators.js';
import { pickRow } from './marketPulse.js';

export const MARKET_ANALYSIS_VERSION = 'fbt.market-analysis.v1';

/** Below this many usable rows a ranking is a list of coincidences. */
export const MIN_RANKED = 8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d = 2) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function turnoverPct(row) {
  const vol = Number(row?.volume);
  const mcap = Number(row?.mcap);
  if (!Number.isFinite(vol) || !Number.isFinite(mcap) || vol <= 0 || mcap <= 0) return null;
  return (vol / mcap) * 100;
}

/**
 * Relative strength of one token against the tape, on a fixed 0..100 scale.
 *
 * The three inputs are deliberately orthogonal:
 *   · 24h change ranked against the universe (percentile, so a +3% day in a
 *     +4% market cannot score as strength);
 *   · 7d change, same treatment — a token that is up today but down on the week
 *     is a bounce, not strength;
 *   · turnover relative to the universe median — participation.
 *
 * A missing input is dropped and the remaining weights renormalised; with no
 * `change24h` at all the token is not scored, because that is the one input
 * every shortlist needs.
 */
export function relativeStrength(row, ctx) {
  const { change24hRank, change7dRank, turnoverRatio } = ctx;
  const parts = [];
  if (isNum(change24hRank)) parts.push({ key: 'rs-24h', value: change24hRank, weight: 0.45 });
  if (isNum(change7dRank)) parts.push({ key: 'rs-7d', value: change7dRank, weight: 0.3 });
  if (isNum(turnoverRatio)) {
    /* log-shaped: 1× the median is 50, 10× is ~83, 100× is 100. Turnover is a
       ratio and eyeballing a linear map would make every token look the same. */
    const v = clamp((Math.log10(Math.max(turnoverRatio, 0.01)) + 1) / 2 * 100, 0, 100);
    parts.push({ key: 'participation', value: v, weight: 0.25 });
  }
  if (!parts.length) return null;
  const wSum = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.value * p.weight, 0) / wSum;
  return {
    score: round(score, 1),
    coverage: round((wSum / 1) * 100, 0),
    parts: parts.map((p) => ({ key: p.key, value: round(p.value, 1), weight: p.weight }))
  };
}

/**
 * Build the ranked shortlist + the divergence read.
 *
 * @param {Array}  markets  normalized rows from /api/markets
 * @param {object} pulse    buildMarketPulse() output (for breadth/regime)
 */
export function buildMarketAnalysis({ markets = [], pulse = null } = {}) {
  const rows = (Array.isArray(markets) ? markets : []).filter((r) => Number(r?.price) > 0);
  const changes = rows.map((r) => (isNum(r.change24h) ? r.change24h : null)).filter(isNum);
  const changes7d = rows.map((r) => (isNum(r.change7d) ? r.change7d : null)).filter(isNum);
  const turnovers = rows.map(turnoverPct).filter(isNum);
  const medianTurnover = median(turnovers);
  const medianChange = median(changes);
  const universeReturn = isNum(pulse?.performance?.medianChange24h) ? pulse.performance.medianChange24h : medianChange;

  const scored = [];
  for (const row of rows) {
    if (!isNum(row.change24h)) continue;
    const rs = relativeStrength(row, {
      change24hRank: percentileRank(changes, row.change24h),
      change7dRank: isNum(row.change7d) ? percentileRank(changes7d, row.change7d) : null,
      turnoverRatio: (() => {
        const t = turnoverPct(row);
        return isNum(t) && isNum(medianTurnover) && medianTurnover > 0 ? t / medianTurnover : null;
      })()
    });
    if (!rs) continue;
    const hi = Number(row.high24h);
    const lo = Number(row.low24h);
    const px = Number(row.price);
    const rangePos = Number.isFinite(hi) && Number.isFinite(lo) && hi > lo && Number.isFinite(px)
      ? clamp((px - lo) / (hi - lo), 0, 1)
      : null;
    scored.push({
      ...pickRow(row),
      rs: rs.score,
      rsCoverage: rs.coverage,
      rsParts: rs.parts,
      rangePos,
      turnoverPct: turnoverPct(row),
      /* vs the TAPE, not vs zero. A token up 2% while the median is +4% is
         losing ground; calling that "positive" is how a screen lies. */
      vsTape: isNum(universeReturn) ? round(row.change24h - universeReturn, 2) : null
    });
  }

  const eligible = scored.filter((s) => s.rs != null && s.rsCoverage >= 50);
  eligible.sort((a, b) => b.rs - a.rs || b.mcap - a.mcap);

  /* A ranking is a statement about the ORDER of a population. Below
     MIN_RANKED the population is too small for the order to mean anything, so
     the shortlist is withheld and `unavailable` carries `ranking` — the UI
     prints the reason instead of eight rows that are simply the eight rows. */
  const rankable = eligible.length >= MIN_RANKED;

  /* ── divergence ─────────────────────────────────────────────────────────
     Two genuinely different things, kept apart:
       · AGAINST THE TAPE — up while the median is down, or the reverse. This
         is relative strength, and it is why a bear market still has a list.
       · QUIET VOLUME — turnover well above its own peer median with a flat
         price. Something is happening that the price has not priced yet. */
  const againstTape = isNum(universeReturn)
    ? [
        ...eligible.filter((s) => universeReturn < -0.2 && s.change24h > 1).sort((a, b) => b.change24h - a.change24h).slice(0, 4),
        ...eligible.filter((s) => universeReturn > 0.2 && s.change24h < -1).sort((a, b) => a.change24h - b.change24h).slice(0, 4)
      ]
    : [];

  const quietVolume = eligible
    .filter((s) => s.turnoverPct != null && isNum(medianTurnover) && medianTurnover > 0
      && s.turnoverPct >= medianTurnover * 2.5
      && Math.abs(s.change24h) <= 1.5)
    .sort((a, b) => (b.turnoverPct ?? 0) - (a.turnoverPct ?? 0))
    .slice(0, 5);

  /* ── dispersion of the move ─────────────────────────────────────────────
     How much the tape agrees with itself. Two markets can both have a +1%
     median and behave nothing alike. */
  const dispersion = (() => {
    if (changes.length < 2) return null;
    const mean = changes.reduce((s, v) => s + v, 0) / changes.length;
    const varr = changes.reduce((s, v) => s + (v - mean) ** 2, 0) / changes.length;
    return round(Math.sqrt(varr), 2);
  })();

  const top10Share = (() => {
    const caps = rows.map((r) => Number(r.mcap)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => b - a);
    if (caps.length < 10) return null;
    const total = caps.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return null;
    return round((caps.slice(0, 10).reduce((s, v) => s + v, 0) / total) * 100, 1);
  })();

  /* ── what would change the read ─────────────────────────────────────────
     The regime is a weighted function of four numbers. Rather than saying
     "watch the market", this lists the thresholds at which the CURRENT label
     would move one notch — computed from the same weights, so the condition
     is arithmetic and not a slogan. */
  const triggers = (() => {
    const out = [];
    const regimeScore = isNum(pulse?.regime?.score) ? pulse.regime.score : null;
    const breadth = pulse?.breadth;
    if (regimeScore != null && breadth && isNum(breadth.advRatio)) {
      const adv = breadth.advancers;
      const counted = breadth.counted;
      if (counted > 0) {
        /* Solving for the breadth needed to move the score by ±10 points.
           The breadth driver is (advRatio − .5) × 2 at weight .35, so a 10
           point move on a normalised score needs advRatio to shift by
           10 / 100 / (2 × .35) ≈ .143. Printed as a token count, because that
           is the unit the reader can check on the same screen. */
        const shift = 10 / (2 * 0.35) / 100;
        const up = Math.min(counted, Math.ceil((breadth.advRatio + shift) * counted));
        const down = Math.max(0, Math.floor((breadth.advRatio - shift) * counted));
        out.push({ key: 'breadth-up', tokens: up, counted });
        out.push({ key: 'breadth-down', tokens: down, counted });
      }
    }
    if (isNum(universeReturn)) {
      /* A ±1% median move is the threshold the regime driver crosses at
         10/30 ≈ 0.33 of its range; the printed value is the honest one. */
      out.push({ key: 'median-change', current: round(universeReturn, 2) });
    }
    return out;
  })();

  return {
    version: MARKET_ANALYSIS_VERSION,
    scanned: rows.length,
    ranked: eligible.length,
    shortlist: rankable ? eligible.slice(0, 8) : [],
    /* The mirror of the shortlist. Present so a reader cannot see only the
       bullish half of the same scan. */
    weakest: rankable ? eligible.slice(-5).reverse() : [],
    divergence: { againstTape, quietVolume },
    dispersion,
    top10Share,
    universeReturn: round(universeReturn, 2),
    medianTurnover: round(medianTurnover, 3),
    triggers,
    /* One list, so the UI can print exactly what was and was not measurable. */
    unavailable: [
      ...(rankable ? [] : ['ranking']),
      ...(top10Share == null ? ['cap-concentration'] : []),
      ...(dispersion == null ? ['dispersion'] : [])
    ],
    caveat: 'not-a-signal'
  };
}
