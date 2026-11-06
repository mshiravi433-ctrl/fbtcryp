/**
 * FBT AI INTELLIGENCE — NARRATIVE ENGINE
 * ---------------------------------------------------------------------------
 * Writes the sentences. Every clause is assembled from numbers that were
 * already measured by marketPulse / tokenScore / portfolioAnalysis, and every
 * number in the sentence is formatted from the same value that is drawn in the
 * card next to it. That is the difference between "the AI says the market is
 * bullish" and "the market is mildly bullish because 148 of 212 tokens with a
 * 24h change are up, and the median move is +1.3%".
 *
 * ─── WHY THIS IS DETERMINISTIC, NOT A LANGUAGE MODEL ────────────────────────
 * A generative model asked to describe a payload can also invent one. For a
 * screen whose whole promise is traceable evidence, the explanation layer is
 * rule-based and reproducible: the same payload always produces the same
 * paragraph, and the test file can assert it. A model, when it is wired into
 * this screen later, belongs ABOVE this text — as a summary with these lines
 * as its only permitted source — never instead of it.
 */
import { t, fmtPct, fmtMoney } from './copy.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const pctText = (v) => fmtPct(v, { digits: 2 });
const ratioText = (v) => fmtPct(v * 100, { digits: 0, signed: false });

/** Render one scanner `reason` object as a sentence. */
export function reasonText(locale, reason) {
  if (!reason) return '';
  const params = { ...(reason.params || {}) };
  if (reason.key === 'range-position') params.value = Math.round((params.value ?? 0) * 100);
  if (reason.key === 'market-breadth') params.advRatio = Math.round((params.advRatio ?? 0) * 100);
  if (reason.key === 'change-24h' || reason.key === 'change-7d') params.value = Number(params.value).toFixed(2);
  if (reason.key === 'turnover-vs-median') params.ratio = Number(params.ratio).toFixed(1);
  return t(locale, `opp.reason.${reason.key}`, params);
}

/**
 * The market paragraph plus its driver table.
 *
 * @returns {{headline: string, lines: string[], drivers: Array, confidence: number}}
 */
export function marketNarrative(pulse, locale = 'fa') {
  if (!pulse || !isNum(pulse.regime?.score)) {
    return { headline: t(locale, 'page.insufficient'), lines: [], drivers: [], confidence: 0 };
  }
  const { breadth, performance, totals, volatility, liquidity, regime, unavailable } = pulse;
  const lines = [];

  lines.push(t(locale, 'market.sentence', {
    regime: t(locale, `regime.${regime.label}`),
    adv: breadth.advancers,
    total: breadth.counted,
    median: isNum(performance.medianChange24h) ? performance.medianChange24h.toFixed(2) : '—'
  }));

  if (isNum(totals.volume) && isNum(totals.volumeChange24h)) {
    lines.push(t(locale, 'market.sentence.volume', {
      volume: fmtMoney(totals.volume, locale),
      volumeDir: t(locale, totals.volumeChange24h >= 0 ? 'market.sentence.volumeUp' : 'market.sentence.volumeDown'),
      volumeChange: Math.abs(totals.volumeChange24h).toFixed(1)
    }));
  }

  if (isNum(totals.btcDominance)) {
    lines.push(t(locale, 'market.sentence.dom', { btc: totals.btcDominance.toFixed(1) }));
  }

  if (isNum(volatility.medianSwingPct)) {
    lines.push(t(locale, 'market.sentence.vol', {
      vol: volatility.medianSwingPct.toFixed(2),
      liq: t(locale, `liq.${liquidity.label}`)
    }));
  }

  if (Array.isArray(unavailable) && unavailable.length) {
    lines.push(t(locale, 'market.sentence.missing', {
      missing: unavailable.map((k) => t(locale, `unavailable.${k}`)).join('، ')
    }));
  }

  const drivers = (regime.drivers || []).map((d) => ({
    key: d.key,
    label: t(locale, `driver.${d.key}`),
    value: d.value,
    weight: d.weight,
    available: d.available,
    valueText: d.available ? (d.value >= 0 ? `+${(d.value * 100).toFixed(0)}` : `${(d.value * 100).toFixed(0)}`) : t(locale, 'driver.missing')
  }));

  return {
    headline: t(locale, 'market.sentence', {
      regime: t(locale, `regime.${regime.label}`),
      adv: breadth.advancers,
      total: breadth.counted,
      median: isNum(performance.medianChange24h) ? performance.medianChange24h.toFixed(2) : '—'
    }),
    lines,
    drivers,
    confidence: regime.confidence ?? 0
  };
}

/**
 * The token paragraph. Only clauses whose number exists are emitted — a token
 * with no candles produces exactly one line saying why, never a fabricated
 * "momentum looks positive".
 */
export function tokenNarrative({ coin, pack, score, locale = 'fa' } = {}) {
  if (!coin) return { lines: [], verdict: t(locale, 'page.insufficient') };
  const lines = [];
  const v = pack?.values || {};

  if (pack && pack.bars >= 20) {
    const trend = pack.values?.trend || {};
    if (trend.label && trend.label !== 'unknown') {
      lines.push(
        `${t(locale, 'token.trend')}: ${t(locale, `token.trend.${trend.label}`)}`
        + (isNum(trend.strength) ? ` · ${trend.strength}/100` : '')
      );
    }
    if (isNum(v.rsi14)) lines.push(`${t(locale, 'token.rsi')}: ${v.rsi14.toFixed(1)}`);
    if (isNum(v.macdHist)) lines.push(`${t(locale, 'token.macd')}: ${v.macdHist.toPrecision(3)}`);
    if (isNum(v.bbPercentB)) lines.push(`${t(locale, 'token.bollinger')}: ${v.bbPercentB.toFixed(2)}`);
    if (isNum(v.atrPct)) lines.push(`${t(locale, 'token.atr')}: ${v.atrPct.toFixed(2)}%`);
    if (pack.position?.aboveSma50 != null) {
      lines.push(`${t(locale, 'token.sma50')}: ${pack.position.aboveSma50 ? '▲' : '▼'}`);
    }
    if (isNum(pack.nearest?.support?.distancePct)) {
      lines.push(`${t(locale, 'token.support')}: ${pctText(pack.nearest.support.distancePct)}`);
    }
    if (isNum(pack.nearest?.resistance?.distancePct)) {
      lines.push(`${t(locale, 'token.resistance')}: ${pctText(pack.nearest.resistance.distancePct)}`);
    }
  } else {
    lines.push(t(locale, 'token.noCandles'));
  }

  const verdict = score?.composite != null
    ? `${t(locale, 'band.' + score.band)} · ${score.composite}/100`
    : t(locale, 'token.scoreMissing');

  return { lines, verdict, coverage: score?.coverage ?? 0 };
}

/** Portfolio paragraph: the risk read, in one sentence with its cause. */
export function portfolioNarrative(analysis, locale = 'fa') {
  if (!analysis?.ok) return { headline: t(locale, 'port.connect'), lines: [] };
  const lines = [];
  const band = analysis.risk.band;
  lines.push(`${t(locale, 'port.risk')}: ${t(locale, `port.risk${band === 'high' ? 'High' : band === 'medium' ? 'Medium' : 'Low'}`)} (${analysis.risk.score}/100)`);
  if (isNum(analysis.concentration.topShare)) {
    lines.push(`${t(locale, 'port.concentration')}: ${analysis.concentration.topShare.toFixed(1)}% · ${t(locale, 'port.effectiveHoldings')}: ${analysis.concentration.effectiveHoldings}`);
  }
  if (isNum(analysis.correlation.average)) {
    lines.push(t(locale, 'port.pairs', {
      count: analysis.correlation.pairs.length,
      avg: analysis.correlation.average.toFixed(2)
    }));
  }
  return { headline: lines[0], lines: lines.slice(1) };
}

/** Suggestion text from its action + measured params. */
export function suggestionText(locale, suggestion) {
  if (!suggestion) return '';
  const params = { ...(suggestion.params || {}) };
  if (params.topShare != null) params.topShare = Number(params.topShare).toFixed(1);
  if (params.weight != null) params.weight = Number(params.weight).toFixed(1);
  if (params.stablePct != null) params.stablePct = Number(params.stablePct).toFixed(1);
  if (params.avgCorrelation != null) params.avgCorrelation = Number(params.avgCorrelation).toFixed(2);
  return t(locale, `sugg.${suggestion.action}`, params);
}

export { pctText, ratioText };
