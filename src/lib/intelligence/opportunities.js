/**
 * FBT AI INTELLIGENCE — OPPORTUNITY SCANNER
 * ---------------------------------------------------------------------------
 * Scans every row the market feed gave us (up to 250) for six shapes that can
 * be described from a market SNAPSHOT alone. Nothing here needs a candle
 * history, so the scanner can honestly say what it looked at; anything that
 * needs indicators (RSI oversold, MACD cross) is deliberately absent and is
 * handled per-token on the Token tab, where candles are actually downloaded.
 *
 * ─── WHAT AN "OPPORTUNITY" IS HERE ──────────────────────────────────────────
 * A candidate worth a closer look, with the arithmetic that put it on the list.
 * The confidence is a number about the EVIDENCE (how strong the trigger is, how
 * liquid the pair is, how fresh the data is), never a probability of profit.
 * Every result carries `not-a-signal` in `caveats` and the UI prints it.
 *
 * Ranking is deterministic: same input, same list, every time.
 */
import { clamp, percentileRank, rangePosition } from './indicators.js';
import { pickRow } from './marketPulse.js';

export const SCANNER_VERSION = 'fbt.opportunity-scan.1';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const PROVENANCE_FACTOR = { live: 1, stale: 0.78, offline: 0.35, unknown: 0.6 };

export const OPPORTUNITY_KINDS = Object.freeze([
  { id: 'breakout', fa: 'شکست سقف روزانه', en: 'Daily breakout', tone: 'up' },
  { id: 'momentum', fa: 'مومنتوم قوی', en: 'Momentum', tone: 'up' },
  { id: 'volume-spike', fa: 'جهش حجم', en: 'Volume spike', tone: 'watch' },
  { id: 'recovery', fa: 'بازگشت از افت هفتگی', en: 'Weekly recovery', tone: 'watch' },
  { id: 'distribution', fa: 'فشار فروش', en: 'Distribution', tone: 'down' },
  { id: 'relative-strength', fa: 'قدرت نسبی', en: 'Relative strength', tone: 'up' }
]);

/** Liquidity gate — an illiquid trigger is a trap, so it lowers confidence hard. */
function liquidityFactor(row) {
  const vol = Number(row?.volume);
  const mcap = Number(row?.mcap);
  if (!isNum(vol) || vol <= 0) return { factor: 0.4, turnover: null };
  const turnover = isNum(mcap) && mcap > 0 ? (vol / mcap) * 100 : null;
  if (!isNum(turnover)) return { factor: 0.6, turnover: null };
  if (turnover >= 8) return { factor: 1, turnover };
  if (turnover >= 2) return { factor: 0.85, turnover };
  if (turnover >= 0.5) return { factor: 0.65, turnover };
  return { factor: 0.45, turnover };
}

/**
 * @param {object} input
 * @param {Array}  input.markets    normalized market rows (with dataProvenance)
 * @param {object} input.pulse      buildMarketPulse() output (for context)
 * @param {number} input.limit      max results
 */
export function scanOpportunities({ markets = [], pulse = null, limit = 24, now = Date.now() } = {}) {
  const rows = (Array.isArray(markets) ? markets : []).filter(
    (r) => isNum(r?.change24h) && Number(r?.price) > 0
  );
  if (!rows.length) {
    return { version: SCANNER_VERSION, generatedAt: now, scanned: 0, opportunities: [], counts: {}, caveats: ['no-market-data'] };
  }

  const turns = rows
    .map((r) => (Number(r.mcap) > 0 && Number(r.volume) > 0 ? (Number(r.volume) / Number(r.mcap)) * 100 : null))
    .filter(isNum);
  const medianTurnover = turns.length
    ? [...turns].sort((a, b) => a - b)[Math.floor(turns.length / 2)]
    : null;
  const changes7 = rows.map((r) => r.change7d).filter(isNum);
  const median7 = changes7.length
    ? [...changes7].sort((a, b) => a - b)[Math.floor(changes7.length / 2)]
    : null;

  const out = [];
  for (const row of rows) {
    const base = pickRow(row);
    const liq = liquidityFactor(row);
    const prov = PROVENANCE_FACTOR[row?.dataProvenance] ?? PROVENANCE_FACTOR.unknown;
    const rp = rangePosition(row.low24h, row.high24h, row.price);
    const ch24 = row.change24h;
    const ch7 = isNum(row.change7d) ? row.change7d : null;
    const turnover = liq.turnover;

    const candidates = [];

    /* 1 — Breakout: price in the top 3% of the day's range AND up strongly.
       "Near the high" alone is noise on a flat day, so the move is required. */
    if (isNum(rp) && rp >= 0.97 && ch24 >= 3) {
      candidates.push({
        kind: 'breakout',
        strength: clamp((rp - 0.9) * 500, 0, 100) * clamp(ch24 / 12, 0.3, 1),
        reasons: [
          { key: 'range-position', params: { value: rp } },
          { key: 'change-24h', params: { value: ch24 } }
        ],
        metrics: { rangePosition: rp, change24h: ch24, turnoverPct: turnover }
      });
    }

    /* 2 — Momentum: up on both the day and the week, and ahead of the median
       week. Requires the 7d number to exist; a 1-day pop is not momentum. */
    if (ch24 >= 5 && isNum(ch7) && ch7 >= 8 && (median7 == null || ch7 > median7)) {
      candidates.push({
        kind: 'momentum',
        strength: clamp(ch24 / 15, 0, 1) * 60 + clamp(ch7 / 40, 0, 1) * 40,
        reasons: [
          { key: 'change-24h', params: { value: ch24 } },
          { key: 'change-7d', params: { value: ch7 } }
        ],
        metrics: { change24h: ch24, change7d: ch7, turnoverPct: turnover }
      });
    }

    /* 3 — Volume spike: turnover at 2.5× the universe median. */
    if (isNum(turnover) && isNum(medianTurnover) && medianTurnover > 0 && turnover >= medianTurnover * 2.5) {
      candidates.push({
        kind: 'volume-spike',
        strength: clamp((turnover / medianTurnover - 1) * 22, 0, 100),
        reasons: [
          { key: 'turnover-vs-median', params: { ratio: turnover / medianTurnover } }
        ],
        metrics: { turnoverPct: turnover, medianTurnoverPct: medianTurnover, change24h: ch24 }
      });
    }

    /* 4 — Recovery: the week is deeply negative but the day has turned up.
       This is a candidate for review, not a reversal call — the candle-level
       confirmation lives on the Token tab. */
    if (isNum(ch7) && ch7 <= -10 && ch24 >= 2) {
      candidates.push({
        kind: 'recovery',
        strength: clamp(Math.abs(ch7) / 25, 0, 1) * 55 + clamp(ch24 / 10, 0, 1) * 45,
        reasons: [
          { key: 'change-7d', params: { value: ch7 } },
          { key: 'change-24h', params: { value: ch24 } }
        ],
        metrics: { change7d: ch7, change24h: ch24 }
      });
    }

    /* 5 — Distribution: the day is clearly red while the week is still green.
       Not an opportunity to buy — a warning that the move is being sold. */
    if (ch24 <= -5 && isNum(ch7) && ch7 > 0) {
      candidates.push({
        kind: 'distribution',
        strength: clamp(Math.abs(ch24) / 12, 0, 1) * 100,
        reasons: [
          { key: 'change-24h', params: { value: ch24 } },
          { key: 'change-7d', params: { value: ch7 } }
        ],
        metrics: { change24h: ch24, change7d: ch7 }
      });
    }

    /* 6 — Relative strength: up today while most of the market is down. */
    const breadthDown = pulse?.breadth?.advRatio;
    if (ch24 >= 2 && isNum(breadthDown) && breadthDown < 0.4) {
      candidates.push({
        kind: 'relative-strength',
        strength: clamp((0.4 - breadthDown) * 250, 0, 100) * clamp(ch24 / 10, 0.3, 1),
        reasons: [
          { key: 'change-24h', params: { value: ch24 } },
          { key: 'market-breadth', params: { advRatio: breadthDown } }
        ],
        metrics: { change24h: ch24, marketAdvRatio: breadthDown }
      });
    }

    for (const c of candidates) {
      const confidence = Math.round(clamp(c.strength * liq.factor * prov, 1, 95));
      out.push({
        kind: c.kind,
        coin: base,
        confidence,
        reasons: c.reasons,
        metrics: c.metrics,
        liquidity: liq.factor,
        provenance: row?.dataProvenance ?? 'unknown',
        caveats: ['not-a-signal', ...(row?.dataProvenance === 'offline' ? ['offline-data'] : [])]
      });
    }
  }

  /* One card per token per kind; if a token qualifies twice for the same kind
     (it cannot by construction) the stronger one wins. Deterministic order:
     confidence, then 24h volume, then id. */
  const seen = new Set();
  const deduped = out
    .sort((a, b) => b.confidence - a.confidence || (b.coin.volume || 0) - (a.coin.volume || 0) || String(a.coin.id).localeCompare(String(b.coin.id)))
    .filter((o) => {
      const key = `${o.kind}:${o.coin.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.trunc(limit)));

  const counts = {};
  for (const o of deduped) counts[o.kind] = (counts[o.kind] || 0) + 1;

  return {
    version: SCANNER_VERSION,
    generatedAt: now,
    scanned: rows.length,
    medianTurnoverPct: medianTurnover,
    opportunities: deduped,
    counts,
    caveats: ['snapshot-only', 'not-a-signal']
  };
}

/** Format-ready helper used by both the scanner UI and the daily report. */
export function topOpportunityPerKind(results = [], kinds = OPPORTUNITY_KINDS) {
  return kinds
    .map((k) => {
      const hit = (results || []).find((r) => r.kind === k.id);
      return hit ? { ...k, hit } : null;
    })
    .filter(Boolean);
}

/** Percentile of a token's 24h change inside the scanned universe. */
export function changePercentile(markets = [], id) {
  const rows = (Array.isArray(markets) ? markets : []).filter((r) => isNum(r?.change24h));
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  return percentileRank(rows.map((r) => r.change24h), row.change24h);
}
