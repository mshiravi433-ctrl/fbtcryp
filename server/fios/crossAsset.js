/**
 * FBT FINANCIAL INTELLIGENCE OS — Cross-Asset Intelligence (Phase 211).
 * ---------------------------------------------------------------------------
 * The question this module answers is the one a crypto-only brain cannot:
 * «what is the REST of the world's money doing, does it agree with crypto,
 * and where is the economy heading?» It reads the asset classes the Global
 * Intelligence Engine actually observed (crypto from the world model,
 * stocks/forex/commodities/rwa from the global domains, and the macro quotes
 * — dollar, gold, crude, equity index, 10y yield, 2s10s curve — from the
 * macro domain) and produces:
 *
 *   breadth      per class — instruments observed, advancing, declining,
 *                average 24h change (only real per-instrument changes)
 *   regime       risk-on / risk-off / mixed / unavailable, derived from
 *                cross-class breadth — with the classes that voted, named
 *   coMovement   how many classes agree in sign (0-1)
 *   divergences  named pairs of classes moving against each other
 *   macro        the macro indicator layer — the real quotes with their 1d
 *                and 7d changes (the politics/economy side of the world)
 *   outlook      THE ECONOMIC OUTLOOK: the current state (regime + breadth)
 *                and the DIRECTION (growth vs recession watch) — a weighted
 *                composite of named signals, each citing the real read it
 *                came from. Phase 211.1: this is the answer to «حال و آینده
 *                و رشد یا رکود» — the now, and where it points.
 *   correlations Pearson correlations over REAL paired return series —
 *                computed ONLY when a caller supplies ≥8 paired observations;
 *                with a single time slice the answer is UNAVAILABLE, never a
 *                number invented from one snapshot
 *
 * ─── THE HONESTY LINE ──────────────────────────────────────────────────────
 * Everything here is arithmetic over numbers providers actually returned. A
 * class with no 24h changes is excluded and named in `missing`; a regime needs
 * ≥2 classes; a correlation needs a real series; an outlook signal is present
 * only when its input was actually read, and the outlook is `untrusted`
 * (data, not authority — it is a reading of this pass, never a forecast). No
 * interpolation, no cached yesterday number presented as today's.
 */
import { createHash } from 'node:crypto';
import { round } from '../../src/lib/central/schema.js';

export const CROSS_ASSET_SCHEMA = 'fbt.fi.cross-asset.v1';

/** The asset classes cross-asset reasoning knows about. `crypto` comes from
 *  the world model's market domain; the rest from the global intel domains. */
export const ASSET_CLASSES = Object.freeze(['crypto', 'stocks', 'forex', 'commodities', 'rwa']);

/** Classes whose instruments are read-only synthetic exposures on external
 *  venues — the AI may ANALYSE them, it may not claim it can buy them. */
export const READ_ONLY_CLASSES = Object.freeze(['stocks', 'forex', 'commodities', 'rwa']);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const MIN_CLASSES_FOR_REGIME = 2;
const DIVERGENCE_THRESHOLD_PCT = 1.0;

/** Pearson correlation over paired returns. Pure; requires ≥8 pairs — a
 *  correlation from three points is noise wearing a suit. */
export function correlate(a = [], b = []) {
  const pairs = a.map((x, i) => [num(x), num(b[i])]).filter(([x, y]) => x !== null && y !== null);
  if (pairs.length < 8) return { ok: false, reason: 'NEEDS_8_PAIRED_OBSERVATIONS', n: pairs.length };
  const n = pairs.length;
  const meanA = pairs.reduce((s, [x]) => s + x, 0) / n;
  const meanB = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (const [x, y] of pairs) {
    cov += (x - meanA) * (y - meanB);
    varA += (x - meanA) ** 2;
    varB += (y - meanB) ** 2;
  }
  if (varA === 0 || varB === 0) return { ok: false, reason: 'ZERO_VARIANCE', n };
  return { ok: true, n, r: round(cov / Math.sqrt(varA * varB), 3) };
}

/** Class breadth from real per-instrument 24h changes. */
function breadthOf(instruments) {
  const rows = (instruments || []).map((i) => ({ symbol: String(i?.symbol || '').toUpperCase().slice(0, 20), changePct: num(i?.change24hPct ?? i?.changePct) })).filter((r) => r.symbol);
  const withChange = rows.filter((r) => r.changePct !== null);
  if (!withChange.length) return null;
  const advancing = withChange.filter((r) => r.changePct > 0).length;
  const avg = withChange.reduce((s, r) => s + r.changePct, 0) / withChange.length;
  return {
    instruments: rows.length,
    withChange: withChange.length,
    advancing,
    declining: withChange.filter((r) => r.changePct < 0).length,
    avgChangePct: round(avg, 2),
    top: withChange.slice().sort((x, y) => y.changePct - x.changePct).slice(0, 3).map((r) => ({ symbol: r.symbol, changePct: r.changePct })),
    bottom: withChange.slice().sort((x, y) => x.changePct - y.changePct).slice(0, 3).map((r) => ({ symbol: r.symbol, changePct: r.changePct }))
  };
}

/** Instruments from a global-intel domain envelope (unwrapped if the caller
 *  passed the provenance-wrapped value). */
const instrumentsOf = (domain) => {
  const value = domain && typeof domain === 'object' && domain.schema === 'fbt.fi.provenance.v1' ? domain.value : domain;
  const data = value && typeof value === 'object' ? value.data : null;
  return Array.isArray(data?.instruments) ? data.instruments : (Array.isArray(data?.rows) ? data.rows : []);
};
const dataOf = (domain) => {
  const value = domain && typeof domain === 'object' && domain.schema === 'fbt.fi.provenance.v1' ? domain.value : domain;
  return value && typeof value === 'object' ? value.data : null;
};

/* ── The economic outlook (Phase 211.1) ────────────────────────────────────
 * «حال و آینده و رشد یا رکود» — the current state AND the direction.
 *
 * The outlook is a WEIGHTED COMPOSITE of named signals. Each signal:
 *   · exists only when its input was actually read this pass,
 *   · carries `evidence` — the real number (or the real headline counts) it
 *     is computed from, and the source that returned it,
 *   · is bounded to [-1, +1] (supportive … cautionary) with a weight.
 *
 * The sign convention is the owner's: POSITIVE = growth-friendly (risk
 * appetite, easing, expansion), NEGATIVE = recession-risk (hedge bid,
 * tightening, contraction). The label is a reading of this pass — the module
 * says so on the object itself (`untrusted`, `note`). It is never a forecast
 * and never an instruction (§49/§50).
 */
const clamp1 = (v) => (v === null || !Number.isFinite(v) ? null : Math.max(-1, Math.min(1, v)));
const span = (v, s) => (v === null || !Number.isFinite(v) || !s ? null : clamp1(v / s));
const directionOf = (v) => (v === null ? 'neutral' : v > 0.05 ? 'supportive' : v < -0.05 ? 'cautionary' : 'neutral');

const OUTLOOK_SUPPORTIVE = /\b(rate cut|cuts? rates|cut rates|easing|dovish|stimulus|soft landing|rate reduction)\b/i;
const OUTLOOK_RESTRICTIVE = /\b(rate hike|hikes? rates|hawkish|tighten\w*|stagflation|recession risk)\b/i;
const OUTLOOK_GROWTH = /\b(growth|expansion|soft landing|booming)\b/i;
const OUTLOOK_CONTRACTION = /\b(recession|slowdown|contraction|hard landing|unemployment rises)\b/i;

/**
 * The weighted economic outlook. Pure — driven only by what the caller read.
 *
 * @param {object} p
 * @param {object} [p.classes]         the per-class breadth map (result.classes)
 * @param {string[]} [p.observed]      the observed class names
 * @param {object} [p.regime]          the computed regime (or null)
 * @param {object} [p.macroDomain]     the macro domain envelope (quotes/items)
 */
export function economicOutlook({ classes = {}, observed = [], regime = null, macroDomain = null } = {}) {
  const signals = [];
  const quote = (kind) => {
    const data = dataOf(macroDomain);
    const rows = Array.isArray(data?.instruments) ? data.instruments : [];
    return rows.find((q) => q?.kind === kind) || null;
  };

  /* 1 · the cross-class mood: the regime's own vote, as a magnitude. */
  if (regime && Array.isArray(regime.votes) && regime.votes.length) {
    const up = regime.votes.filter((v) => v.avg > 0).length;
    const down = regime.votes.filter((v) => v.avg < 0).length;
    const value = clamp1((up - down) / regime.votes.length);
    signals.push({
      id: 'risk_mood',
      name: 'cross-class mood',
      value,
      weight: 1.5,
      direction: directionOf(value),
      evidence: `${up} of ${regime.votes.length} asset classes up over 24h — regime ${String(regime.regime || 'MIXED').toLowerCase().replace(/_/g, ' ')}`,
      source: 'cross-asset-engine'
    });
  }

  /* 2 · the dollar: a stronger dollar usually pressures risk assets. */
  const dxy = quote('currency');
  if (dxy && num(dxy.change1dPct) !== null) {
    const value = span(dxy.change1dPct, 1.5) * -1;
    signals.push({
      id: 'dollar_pressure',
      name: 'dollar pressure',
      value,
      weight: 1.0,
      direction: directionOf(value),
      evidence: `US Dollar Index ${dxy.priceUsd} (${dxy.change1dPct > 0 ? '+' : ''}${dxy.change1dPct}% over 1d) — dollar strength typically pressures risk assets`,
      source: dxy.source || 'macroData'
    });
  }

  /* 3 · the safe-haven bid: gold rising on the week is hedging, not growth. */
  const gold = quote('safe_haven');
  if (gold && num(gold.change7dPct) !== null) {
    const value = span(gold.change7dPct, 3) * -1;
    signals.push({
      id: 'safe_haven_bid',
      name: 'safe-haven bid',
      value,
      weight: 0.8,
      direction: directionOf(value),
      evidence: `gold ${gold.priceUsd} (${gold.change7dPct > 0 ? '+' : ''}${gold.change7dPct}% over 7d) — a rising gold bid is hedging demand`,
      source: gold.source || 'macroData'
    });
  }

  /* 4 · energy: crude rising on the week feeds inflation pressure. */
  const wti = quote('energy');
  if (wti && num(wti.change7dPct) !== null) {
    const value = span(wti.change7dPct, 4) * -1;
    signals.push({
      id: 'energy_inflation',
      name: 'energy inflation',
      value,
      weight: 0.8,
      direction: directionOf(value),
      evidence: `WTI crude ${wti.priceUsd} (${wti.change7dPct > 0 ? '+' : ''}${wti.change7dPct}% over 7d) — rising energy feeds inflation pressure`,
      source: wti.source || 'macroData'
    });
  }

  /* 5 · the long rate: a rising 10y level tightens conditions. */
  const teny = quote('rate');
  if (teny && num(teny.change7dPct) !== null) {
    const value = span(teny.change7dPct, 2) * -1;
    signals.push({
      id: 'long_rate',
      name: 'long rate',
      value,
      weight: 1.2,
      direction: directionOf(value),
      evidence: `US 10Y yield at ${teny.priceUsd}% (level ${teny.change7dPct > 0 ? '+' : ''}${teny.change7dPct}% over 7d) — a rising long rate tightens conditions`,
      source: teny.source || 'macroData'
    });
  }

  /* 6 · the curve: an inverted 2s10s has historically preceded recessions —
     the single strongest named cycle gauge, present only when read. */
  const curve = dataOf(macroDomain)?.curve;
  if (curve && num(curve.spreadPct) !== null) {
    const inverted = curve.spreadPct < 0;
    const value = inverted ? -1 : clamp1(curve.spreadPct / 0.5);
    signals.push({
      id: 'yield_curve',
      name: 'yield curve',
      value,
      weight: 1.5,
      direction: directionOf(value),
      evidence: inverted
        ? `2s10s spread INVERTED at ${curve.spreadPct}pp — inversions have historically preceded US recessions`
        : `2s10s spread positive at ${curve.spreadPct}pp`,
      source: curve.source || 'macroData'
    });
  }

  /* 7 · the macro headlines: real classified counts, never invented. */
  const items = Array.isArray(dataOf(macroDomain)?.items) ? dataOf(macroDomain).items : [];
  if (items.length) {
    let supportive = 0, restrictive = 0, growth = 0, contraction = 0;
    for (const it of items) {
      const t = String(it?.title || '');
      if (OUTLOOK_SUPPORTIVE.test(t)) supportive += 1;
      if (OUTLOOK_RESTRICTIVE.test(t)) restrictive += 1;
      if (OUTLOOK_GROWTH.test(t)) growth += 1;
      if (OUTLOOK_CONTRACTION.test(t)) contraction += 1;
    }
    const value = clamp1((supportive + growth - restrictive - contraction) / Math.max(1, items.length));
    signals.push({
      id: 'macro_headlines',
      name: 'macro headlines',
      value,
      weight: 1.0,
      direction: directionOf(value),
      evidence: `${supportive} supportive / ${restrictive} restrictive / ${growth} growth / ${contraction} contraction of ${items.length} classified macro headlines`,
      source: 'macro:classifier'
    });
  }

  for (const s of signals) s.value = round(s.value, 3);
  const weightSum = signals.reduce((s, x) => s + x.weight, 0);
  const score = weightSum > 0 ? signals.reduce((s, x) => s + x.value * x.weight, 0) / weightSum : null;
  const label = signals.length === 0
    ? 'UNAVAILABLE'
    : score >= 0.2 ? 'GROWTH_WATCH' : score <= -0.2 ? 'RECESSION_WATCH' : 'MIXED_SIGNALS';

  /* The CURRENT state: what the pass actually saw (regime + breadth). */
  const currentState = {
    regime: regime?.regime || null,
    observedClasses: observed.slice(),
    avgChangePct: Object.fromEntries(observed.map((c) => [c, classes[c]?.avgChangePct ?? null]))
  };

  return {
    label,
    score: score === null ? null : round(score, 2),
    currentState,
    signals,
    reason: signals.length === 0 ? 'NO_MARKET_OR_MACRO_READ' : null,
    untrusted: true,
    note: 'a weighted reading of this pass\u2019s real reads — data, not authority; not a forecast'
  };
}

/**
 * @param {object} p
 * @param {object} [p.world]          world model (market domain: prices/coins)
 * @param {object} [p.globalIntel]    global intelligence snapshot (domains)
 * @param {object} [p.history]        optional REAL paired series —
 *                                    { cryptoVsStocks: { a: [], b: [] }, … }
 *                                    from a provider with history access
 * @param {number} [p.now]
 */
export function analyzeCrossAsset({ world = null, globalIntel = null, history = null, now = Date.now() } = {}) {
  const classes = {};
  const missing = [];

  /* crypto: the world model's market rows — prices object, coins or the
     brain's crypto.symbols array, each carrying a 24h change when it has one. */
  const marketValue = world?.domains?.market || world?.market || {};
  const marketData = marketValue?.schema === 'fbt.fi.provenance.v1' ? marketValue.value : marketValue;
  const marketRows = marketValue?.rows?.schema === 'fbt.fi.provenance.v1' ? marketValue.rows.value : marketData?.rows;
  const cryptoRows = []
    .concat(Array.isArray(marketData?.coins) ? marketData.coins : [])
    .concat(Array.isArray(marketData?.symbols) ? marketData.symbols : [])
    .concat(Array.isArray(marketRows?.coins) ? marketRows.coins : [])
    .concat(Array.isArray(marketRows?.symbols) ? marketRows.symbols : [])
    .map((c) => ({ symbol: c?.symbol, changePct: num(c?.change24hPct ?? c?.change24h ?? c?.changePct) }));
  classes.crypto = breadthOf(cryptoRows);
  if (!classes.crypto) missing.push('crypto');

  /* the global classes: from the snapshot's domains. */
  const domains = globalIntel?.domains || {};
  for (const cls of ['stocks', 'forex', 'commodities', 'rwa']) {
    classes[cls] = breadthOf(instrumentsOf(domains[cls]));
    if (!classes[cls]) missing.push(cls);
  }

  const observed = ASSET_CLASSES.filter((c) => classes[c]);
  const result = {
    schema: CROSS_ASSET_SCHEMA,
    at: now,
    status: observed.length === 0 ? 'UNAVAILABLE' : observed.length < MIN_CLASSES_FOR_REGIME ? 'PARTIAL' : 'OK',
    classes: Object.fromEntries(ASSET_CLASSES.map((c) => [c, classes[c] || null])),
    observedClasses: observed,
    missing,
    readOnlyClasses: READ_ONLY_CLASSES.filter((c) => observed.includes(c))
  };

  if (observed.length >= MIN_CLASSES_FOR_REGIME) {
    /* Regime: the sign of each class's average change is its vote. */
    const votes = observed.map((c) => ({ cls: c, avg: classes[c].avgChangePct }));
    const up = votes.filter((v) => v.avg > 0);
    const down = votes.filter((v) => v.avg < 0);
    const coMovement = round(observed.length ? Math.max(up.length, down.length) / observed.length : 0, 2);
    let regime = 'MIXED';
    if (up.length === observed.length) regime = 'RISK_ON';
    else if (down.length === observed.length) regime = 'RISK_OFF';
    else if (down.length >= Math.ceil(observed.length / 2) && up.length <= Math.floor(observed.length / 2)) regime = 'RISK_OFF_LEANING';
    else if (up.length >= Math.ceil(observed.length / 2)) regime = 'RISK_ON_LEANING';
    result.regime = {
      regime,
      votes,
      coMovement,
      basis: `average 24h change of ${observed.length} observed asset classes (real per-instrument changes only)`
    };

    /* Divergences: classes at least 2 percentage points apart in opposite
       directions — the pairs a one-track crypto view would miss. */
    result.divergences = [];
    for (let i = 0; i < observed.length; i += 1) {
      for (let j = i + 1; j < observed.length; j += 1) {
        const a = classes[observed[i]];
        const b = classes[observed[j]];
        if (a.avgChangePct * b.avgChangePct < 0 && Math.abs(a.avgChangePct - b.avgChangePct) >= DIVERGENCE_THRESHOLD_PCT) {
          result.divergences.push({
            classes: [observed[i], observed[j]],
            avgChangePct: { [observed[i]]: a.avgChangePct, [observed[j]]: b.avgChangePct },
            gapPct: round(Math.abs(a.avgChangePct - b.avgChangePct), 2)
          });
        }
      }
    }
  } else {
    result.regime = null;
    result.divergences = [];
  }

  /* Correlations: only from REAL paired history the caller supplied. One
     snapshot cannot produce a correlation, and this module will not pretend. */
  result.correlations = {};
  if (history && typeof history === 'object') {
    for (const [pair, series] of Object.entries(history)) {
      if (!series || !Array.isArray(series.a) || !Array.isArray(series.b)) continue;
      result.correlations[pair] = correlate(series.a, series.b);
    }
  }
  const correlationPairs = Object.keys(result.correlations);
  if (!correlationPairs.length) {
    result.correlations.UNAVAILABLE = { ok: false, reason: 'NO_PAIRED_HISTORY_SUPPLIED', note: 'a single time slice cannot produce a correlation; supply real paired return series to enable this' };
  }

  /* ── Phase 211.1: the macro indicator layer + the economic outlook ──────
     The macro quotes (dollar/gold/crude/equity/rates/curve) come from the
     macro domain of the SAME pass; the outlook is the weighted composite
     over the regime + the quotes + the classified headlines. When the macro
     domain did not read, both say so — no invented indicator, no outlook
     without a signal. */
  const macroData = dataOf(domains.macro);
  const macroInstruments = Array.isArray(macroData?.instruments) ? macroData.instruments : [];
  result.macro = {
    status: macroInstruments.length ? 'OK' : 'UNAVAILABLE',
    indicators: macroInstruments.map((q) => ({
      symbol: String(q?.symbol || '').slice(0, 12),
      name: String(q?.name || '').slice(0, 60),
      kind: String(q?.kind || '').slice(0, 16),
      priceUsd: num(q?.priceUsd),
      change1dPct: num(q?.change1dPct ?? q?.change24hPct),
      change7dPct: num(q?.change7dPct),
      source: String(q?.source || 'macroData').slice(0, 40)
    })).filter((q) => q.symbol && q.priceUsd !== null),
    curve: macroData?.curve && typeof macroData.curve === 'object' ? { ...macroData.curve } : null,
    untrusted: true
  };
  result.outlook = economicOutlook({
    classes,
    observed,
    regime: result.regime,
    macroDomain: domains.macro
  });

  result.id = `ca_${createHash('sha256').update(JSON.stringify({ at: now, observed, regime: result.regime?.regime || null, outlook: result.outlook?.label || null })).digest('hex').slice(0, 18)}`;
  return result;
}

/** The bounded, model-safe digest for chat/decision contexts. */
export function crossAssetDigest(analysis) {
  if (!analysis || analysis.status === 'UNAVAILABLE') {
    return { available: false, reason: analysis?.missing?.length ? `missing: ${analysis.missing.join(', ')}` : 'NO_CROSS_ASSET_DATA' };
  }
  return {
    available: true,
    status: analysis.status,
    regime: analysis.regime?.regime || null,
    coMovement: analysis.regime?.coMovement ?? null,
    observedClasses: analysis.observedClasses,
    divergences: (analysis.divergences || []).map((d) => `${d.classes[0]} ${d.avgChangePct[d.classes[0]]}% vs ${d.classes[1]} ${d.avgChangePct[d.classes[1]]}%`),
    avgChangePct: Object.fromEntries(analysis.observedClasses.map((c) => [c, analysis.classes[c].avgChangePct])),
    /* Phase 211.1 — the economic outlook, bounded: label + score + the two
       strongest named signals (with their evidence). */
    outlook: analysis.outlook
      ? {
          label: analysis.outlook.label,
          score: analysis.outlook.score,
          signals: (analysis.outlook.signals || [])
            .slice()
            .sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))
            .slice(0, 2)
            .map((s) => `${s.name}: ${s.evidence}`)
        }
      : null,
    macroIndicators: analysis.macro?.indicators?.length ?? 0
  };
}

export default analyzeCrossAsset;
