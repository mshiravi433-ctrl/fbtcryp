/**
 * FBT FINANCIAL INTELLIGENCE OS — Cross-Asset Intelligence (Phase 211).
 * ---------------------------------------------------------------------------
 * The question this module answers is the one a crypto-only brain cannot:
 * «what is the REST of the world's money doing, and does it agree with
 * crypto?» It reads the asset classes the Global Intelligence Engine actually
 * observed (crypto from the world model, stocks/forex/commodities/rwa from the
 * global domains) and produces:
 *
 *   breadth      per class — instruments observed, advancing, declining,
 *                average 24h change (only real per-instrument changes)
 *   regime       risk-on / risk-off / mixed / unavailable, derived from
 *                cross-class breadth — with the classes that voted, named
 *   coMovement   how many classes agree in sign (0-1)
 *   divergences  named pairs of classes moving against each other
 *   correlations Pearson correlations over REAL paired return series —
 *                computed ONLY when a caller supplies ≥8 paired observations;
 *                with a single time slice the answer is UNAVAILABLE, never a
 *                number invented from one snapshot
 *
 * ─── THE HONESTY LINE ──────────────────────────────────────────────────────
 * Everything here is arithmetic over numbers providers actually returned. A
 * class with no 24h changes is excluded and named in `missing`; a regime needs
 * ≥2 classes; a correlation needs a real series. No interpolation, no cached
 * yesterday number presented as today's.
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

  result.id = `ca_${createHash('sha256').update(JSON.stringify({ at: now, observed, regime: result.regime?.regime || null })).digest('hex').slice(0, 18)}`;
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
    avgChangePct: Object.fromEntries(analysis.observedClasses.map((c) => [c, analysis.classes[c].avgChangePct]))
  };
}

export default analyzeCrossAsset;
