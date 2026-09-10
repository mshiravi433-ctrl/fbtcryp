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
  const rows = (instruments || []).map((i) => ({
    symbol: String(i?.symbol || '').toUpperCase().slice(0, 20),
    name: i?.name ? String(i.name).slice(0, 80) : null,
    country: i?.country ? String(i.country).slice(0, 8) : null,
    logoURI: /^https:\/\//i.test(String(i?.logoURI || '')) ? String(i.logoURI).slice(0, 300) : null,
    changePct: num(i?.change24hPct ?? i?.changePct)
  })).filter((r) => r.symbol);
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
    top: withChange.slice().sort((x, y) => y.changePct - x.changePct).slice(0, 3).map((r) => ({ symbol: r.symbol, name: r.name, country: r.country, logoURI: r.logoURI, changePct: r.changePct })),
    bottom: withChange.slice().sort((x, y) => x.changePct - y.changePct).slice(0, 3).map((r) => ({ symbol: r.symbol, name: r.name, country: r.country, logoURI: r.logoURI, changePct: r.changePct }))
  };
}

/* ── Phase 211.2 — the crypto rows, in EVERY shape the brain produces ──────
 * The real `marketSnapshot` source (server/ci/sources.js) answers MAPS —
 * `prices: { BTC: 70000 }`, `changes24hPct: { BTC: -1.2 }` — not a `symbols`
 * array (only the test fixtures do). Reading only the array shapes left the
 * crypto class permanently «unread» on production data even while the market
 * feed was healthy. All four shapes are real reads now: coins/symbols arrays
 * first (fixture + world model), then the changes map, then prices-only rows
 * (instruments without a 24h change are counted, they just do not vote). */
function cryptoRowsFrom(marketData) {
  const rows = []
    .concat(Array.isArray(marketData?.coins) ? marketData.coins : [])
    .concat(Array.isArray(marketData?.symbols) ? marketData.symbols : [])
    .concat(Array.isArray(marketData?.rows?.coins) ? marketData.rows.coins : [])
    .concat(Array.isArray(marketData?.rows?.symbols) ? marketData.rows.symbols : [])
    .map((c) => ({ symbol: c?.symbol, changePct: num(c?.change24hPct ?? c?.change24h ?? c?.changePct) }));
  const seen = new Set(rows.map((r) => String(r.symbol || '').toUpperCase()));
  const changes = marketData?.changes24hPct && typeof marketData.changes24hPct === 'object' ? marketData.changes24hPct : {};
  for (const [symbol, change] of Object.entries(changes).slice(0, 40)) {
    const key = String(symbol || '').toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ symbol: key, changePct: num(change) });
  }
  const prices = marketData?.prices && typeof marketData.prices === 'object' ? marketData.prices : {};
  for (const [symbol, price] of Object.entries(prices).slice(0, 40)) {
    const key = String(symbol || '').toUpperCase();
    if (!key || seen.has(key) || !Number.isFinite(Number(price))) continue;
    seen.add(key);
    rows.push({ symbol: key, changePct: null });
  }
  return rows;
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
 * @param {Array}  [p.cryptoInstruments] Phase 211.2 — real crypto instrument
 *                                    rows read THROUGH the brain when the
 *                                    state store had no market section yet
 *                                    ({ symbol, change24hPct } shaped)
 * @param {object} [p.fallbacks]      Phase 211.2 — per-class REAL fallback
 *                                    instruments for the four global classes,
 *                                    used only when that class's brain domain
 *                                    was UNAVAILABLE:
 *                                    { stocks: { source, instruments }, … }
 * @param {object} [p.history]        optional REAL paired series —
 *                                    { cryptoVsStocks: { a: [], b: [] }, … }
 *                                    from a provider with history access
 * @param {number} [p.now]
 */
export function analyzeCrossAsset({ world = null, globalIntel = null, cryptoInstruments = null, fallbacks = null, history = null, now = Date.now() } = {}) {
  const classes = {};
  const missing = [];
  const missingReasons = {};
  const fallbackClasses = {};

  /* crypto: the world model's market rows — prices object, coins or the
     brain's crypto.symbols array, each carrying a 24h change when it has one. */
  const marketValue = world?.domains?.market || world?.market || {};
  const marketData = marketValue?.schema === 'fbt.fi.provenance.v1' ? marketValue.value : marketValue;
  classes.crypto = breadthOf(cryptoRowsFrom(marketData));
  /* Phase 211.2 — the brain's crypto.read (module `crypto`) as the active
     fallback: a caller that just read the market hands the rows in here and
     the class stops being «unread» the moment a real source answers. */
  if (!classes.crypto && Array.isArray(cryptoInstruments) && cryptoInstruments.length) {
    classes.crypto = breadthOf(cryptoInstruments);
    if (classes.crypto) fallbackClasses.crypto = { source: 'brain:crypto', reason: 'STATE_STORE_EMPTY' };
  }
  if (!classes.crypto) missing.push('crypto');

  /* the global classes: from the snapshot's domains, with the per-domain
     failure reason kept (the UI and the narrative name WHY a class is
     unread instead of a bare missing[] row). */
  const domains = globalIntel?.domains || {};
  for (const cls of ['stocks', 'forex', 'commodities', 'rwa']) {
    classes[cls] = breadthOf(instrumentsOf(domains[cls]));
    if (!classes[cls]) {
      if (domains[cls] && domains[cls].status !== 'OK' && domains[cls].reason) missingReasons[cls] = String(domains[cls].reason).slice(0, 120);
      /* Phase 211.2 — a REAL fallback read (macro desk: stooq/yahoo daily
         series) stands in ONLY when the primary brain feed answered nothing.
         The substitution is named on the class itself: `fallbackSource`. */
      const fb = fallbacks?.[cls];
      if (fb && Array.isArray(fb.instruments) && fb.instruments.length) {
        classes[cls] = breadthOf(fb.instruments);
        if (classes[cls]) {
          classes[cls].fallbackSource = String(fb.source || 'fallback').slice(0, 40);
          classes[cls].degraded = true;
          fallbackClasses[cls] = { source: classes[cls].fallbackSource, reason: missingReasons[cls] || 'PRIMARY_FEED_UNAVAILABLE' };
        }
      }
    }
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
    missingReasons,
    fallbackClasses,
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

  /* ── Phase 211.2: the comprehensive local analysis ──────────────────────
     A deterministic, language-paired narrative built ONLY from the numbers
     this pass actually read — the screen's «تحلیل جامع» paragraph. It works
     with zero AI providers configured; the LLM commentary (crossNarrative.js)
     rides ON TOP of it and is a separate, labelled field. */
  result.narrative = crossNarrative(result);

  result.id = `ca_${createHash('sha256').update(JSON.stringify({ at: now, observed, regime: result.regime?.regime || null, outlook: result.outlook?.label || null })).digest('hex').slice(0, 18)}`;
  return result;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* The comprehensive local narrative (Phase 211.2) — pure, honest, bilingual */
/* ═════════════════════════════════════════════════════════════════════════ */

const NARRATIVE_CLASS_FA = { crypto: 'رمزارز', stocks: 'سهام', forex: 'فارکس', commodities: 'کالاها', rwa: 'دارایی واقعی' };
const NARRATIVE_REGIME_FA = {
  RISK_ON: 'ریسک‌پذیر', RISK_ON_LEANING: 'متمایل به ریسک‌پذیری', MIXED: 'ترکیبی',
  RISK_OFF_LEANING: 'متمایل به احتیاط', RISK_OFF: 'ریسک‌گریز'
};
const NARRATIVE_OUTLOOK_FA = {
  GROWTH_WATCH: 'چشم‌انداز رشد', RECESSION_WATCH: 'هشدار رکود',
  MIXED_SIGNALS: 'سیگنال‌های مختلط', UNAVAILABLE: 'دادهٔ کافی نیست'
};
const NARRATIVE_REASON_FA = {
  NO_INSTRUMENTS_IN_CATEGORY: 'ابزاری در این دسته خوانده نشد',
  NO_EQUITIES_READ: 'فید سهام پاسخ نداد', NO_EQUITY_INSTRUMENTS: 'ابزار سهامی خوانده نشد',
  NO_FOREX_READ: 'فید فارکس پاسخ نداد', NO_FOREX_INSTRUMENTS: 'ابزار فارکس خوانده نشد',
  NO_COMMODITIES_READ: 'فید کالا پاسخ نداد', NO_COMMODITIES_INSTRUMENTS: 'ابزار کالا خوانده نشد',
  NO_RWA_READ: 'فید دارایی واقعی پاسخ نداد', NO_RWA_INSTRUMENTS: 'ابزار دارایی واقعی خوانده نشد',
  RWA_FEED_UNAVAILABLE: 'فید اوستیوم در دسترس نیست', RWA_SHAPE_UNUSABLE: 'قالب فید تغییر کرده است',
  BRAIN_NOT_WIRED: 'مغز مرکزی وصل نیست', BRAIN_READ_REFUSED: 'خوانش مغز رد شد',
  PROVIDER_DOWN: 'منبع بالادستی از دسترس خارج است', UNCLASSIFIED_ERROR: 'منبع بالادستی خطای نامشخص داد',
  PROVIDER_TIMEOUT: 'زمان خواندن منبع تمام شد', RPC_TIMEOUT: 'زمان خواندن منبع تمام شد',
  NETWORK_UNAVAILABLE: 'شبکه در دسترس نیست', SOURCE_NOT_WIRED: 'منبع در این استقرار وصل نیست',
  SOURCE_REJECTED: 'منبع درخواست را رد کرد', NO_MACRO_DATA_SOURCE: 'هیچ منبع داده کلانی پاسخ نداد',
  NO_FEEDS_REACHABLE: 'هیچ فید خبری در دسترس نبود'
};
const faReason = (reason) => {
  if (!reason) return null;
  const raw = String(reason);
  if (NARRATIVE_REASON_FA[raw]) return NARRATIVE_REASON_FA[raw];
  const head = raw.split(':')[0];
  if (NARRATIVE_REASON_FA[head]) return NARRATIVE_REASON_FA[head];
  if (/TIMEOUT/.test(raw)) return 'زمان خواندن منبع تمام شد';
  return 'منبع پاسخ نداد';
};
const pctFa = (v) => (v === null || !Number.isFinite(v) ? null : faD(`${v > 0 ? '+' : ''}${Number(v).toFixed(2)}٪`));
const pctEn = (v) => (v === null || !Number.isFinite(v) ? null : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
/* Persian digits for the numbers the narrative formats itself (counts, gaps,
   scores) — NOT a blanket conversion, which would mangle English words inside
   quoted evidence like «US 10Y yield». */
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const faD = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);

/**
 * The comprehensive analysis paragraph, deterministic from the analysis
 * itself. Sentences exist only for what was read; a missing class is named
 * WITH its reason, never glossed over. Exported for the probe + the LLM
 * commentary (which must stay consistent with the same numbers).
 *
 * @param {object} analysis the analyzeCrossAsset() result
 * @returns {{ fa: string, en: string }} the two language renderings
 */
export function crossNarrative(analysis) {
  if (!analysis) return { fa: '', en: '' };
  const observed = Array.isArray(analysis.observedClasses) ? analysis.observedClasses : [];
  const classes = analysis.classes || {};
  const fa = [];
  const en = [];

  if (!observed.length) {
    const miss = Array.isArray(analysis.missing) ? analysis.missing : [];
    const faMiss = miss.map((c) => `${NARRATIVE_CLASS_FA[c] || c}${analysis.missingReasons?.[c] ? ` (${faReason(analysis.missingReasons[c])})` : ''}`).join('، ');
    return {
      fa: `هیچ کلاسی از بازار جهانی در این دور خوانده نشد${faMiss ? `: ${faMiss}` : ''}. تا وقتی یک منبع واقعی پاسخ ندهد، تحلیل کراس-است عمداً خالی می‌ماند — هیچ عددی حدس زده نمی‌شود.`,
      en: `No global asset class was read in this pass${miss.length ? `: ${miss.join(', ')}` : ''}. Until a real source answers, the cross-asset analysis stays deliberately empty — no number is guessed.`
    };
  }

  /* 1 · the classes that voted, with their real averages. */
  const faParts = [];
  const enParts = [];
  for (const cls of observed) {
    const c = classes[cls];
    if (!c) continue;
    const faLabel = NARRATIVE_CLASS_FA[cls] || cls;
    const fb = c.fallbackSource ? ' (از میز داده کلان)' : '';
    const fbEn = c.fallbackSource ? ' (from the macro desk)' : '';
    faParts.push(`${faLabel} با میانگین ${pctFa(c.avgChangePct)}${c.withChange ? ` (${faD(c.advancing)} از ${faD(c.withChange)} ابزار سبز)` : ''}${fb}`);
    enParts.push(`${cls} averaging ${pctEn(c.avgChangePct)}${c.withChange ? ` (${c.advancing}/${c.withChange} instruments green)` : ''}${fbEn}`);
  }
  fa.push(`در ۲۴ ساعت گذشته ${faD(observed.length)} کلاس دارایی واقعاً خوانده شد — ${faParts.join('؛ ')}.`);
  en.push(`${observed.length} asset class${observed.length > 1 ? 'es were' : ' was'} actually read over the last 24h — ${enParts.join('; ')}.`);

  /* 2 · the regime, with its real co-movement. */
  if (analysis.regime?.regime) {
    const regimeFa = NARRATIVE_REGIME_FA[analysis.regime.regime] || String(analysis.regime.regime).replace(/_/g, ' ').toLowerCase();
    const co = Math.round((Number(analysis.regime.coMovement) || 0) * 100);
    fa.push(`رژیم کلی بازار ${regimeFa} است (هم‌حرکتی ${faD(co)}٪ بر پایهٔ میانگین واقعی همین کلاس‌ها).`);
    en.push(`The overall regime reads ${String(analysis.regime.regime).replace(/_/g, ' ').toLowerCase()} (${co}% co-movement on these classes' real averages).`);
  }

  /* 3 · leaders and laggards across the read classes. */
  const movers = observed
    .flatMap((cls) => [
      ...(classes[cls]?.top || []).slice(0, 1).map((r) => ({ ...r, cls })),
      ...(classes[cls]?.bottom || []).slice(0, 1).map((r) => ({ ...r, cls }))
    ])
    .sort((a, b) => b.changePct - a.changePct);
  const leader = movers[0];
  const laggard = movers[movers.length - 1];
  if (leader && laggard && leader.symbol !== laggard.symbol) {
    fa.push(`قوی‌ترین ${leader.symbol} (${NARRATIVE_CLASS_FA[leader.cls] || leader.cls}) با ${pctFa(leader.changePct)} و ضعیف‌ترین ${laggard.symbol} (${NARRATIVE_CLASS_FA[laggard.cls] || laggard.cls}) با ${pctFa(laggard.changePct)} است.`);
    en.push(`Strongest is ${leader.symbol} (${leader.cls}) at ${pctEn(leader.changePct)}; weakest is ${laggard.symbol} (${laggard.cls}) at ${pctEn(laggard.changePct)}.`);
  }

  /* 4 · divergences — the cross-class disagreement a single-asset view misses. */
  const divs = Array.isArray(analysis.divergences) ? analysis.divergences.slice(0, 2) : [];
  for (const d of divs) {
    const [a, b] = d.classes;
    fa.push(`واگرایی: ${NARRATIVE_CLASS_FA[a] || a} ${pctFa(d.avgChangePct[a])} در برابر ${NARRATIVE_CLASS_FA[b] || b} ${pctFa(d.avgChangePct[b])} (شکاف ${faD(d.gapPct)} واحد درصد).`);
    en.push(`Divergence: ${a} ${pctEn(d.avgChangePct[a])} against ${b} ${pctEn(d.avgChangePct[b])} (${d.gapPct}pp gap).`);
  }

  /* 5 · the macro layer — the biggest real quote move + the curve. */
  const quotes = Array.isArray(analysis.macro?.indicators) ? analysis.macro.indicators.filter((q) => q.change1dPct !== null) : [];
  const mover = quotes.slice().sort((x, y) => Math.abs(y.change1dPct) - Math.abs(x.change1dPct))[0];
  if (mover) {
    fa.push(`در میز کلان، بیشترین حرکت ۲۴س را ${mover.symbol} با ${pctFa(mover.change1dPct)} دارد.`);
    en.push(`On the macro desk the biggest 1d move is ${mover.symbol} at ${pctEn(mover.change1dPct)}.`);
  }
  const curve = analysis.macro?.curve;
  if (curve && Number.isFinite(Number(curve.spreadPct))) {
    fa.push(curve.spreadPct < 0
      ? `منحنی بهره ۲/۱۰ با ${curve.spreadPct} واحد درصد وارونه است — نشانهٔ کلاسیک فشار رکودی.`
      : `منحنی بهره ۲/۱۰ با ${curve.spreadPct} واحد درصد طبیعی است.`);
    en.push(curve.spreadPct < 0
      ? `The 2s10s curve is inverted at ${curve.spreadPct}pp — the classic recession-pressure signal.`
      : `The 2s10s curve is positive at ${curve.spreadPct}pp.`);
  }

  /* 6 · the economic outlook — the direction, with its strongest signal. */
  const outlook = analysis.outlook;
  if (outlook && outlook.label && outlook.label !== 'UNAVAILABLE') {
    const labelFa = NARRATIVE_OUTLOOK_FA[outlook.label] || String(outlook.label).replace(/_/g, ' ').toLowerCase();
    const top = (outlook.signals || []).slice().sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))[0];
    fa.push(`چشم‌انداز اقتصادی: ${labelFa} با امتیاز ${faD(`${outlook.score > 0 ? '+' : ''}${outlook.score}`)}${top ? `؛ قوی‌ترین سیگنال: ${top.name} (${top.evidence})` : ''}.`);
    en.push(`Economic outlook: ${String(outlook.label).replace(/_/g, ' ').toLowerCase()} at ${outlook.score > 0 ? '+' : ''}${outlook.score}${top ? `; strongest signal: ${top.name} (${top.evidence})` : ''}.`);
  }

  /* 7 · what was NOT read — named with its reason, never hidden. */
  const miss = Array.isArray(analysis.missing) ? analysis.missing : [];
  if (miss.length) {
    const faMiss = miss.map((c) => `${NARRATIVE_CLASS_FA[c] || c}${analysis.missingReasons?.[c] ? ` (${faReason(analysis.missingReasons[c])})` : ''}`).join('، ');
    fa.push(`${faMiss} در این دور خوانده نشد و در تحلیل وارد نشده است.`);
    en.push(`${miss.join(', ')} ${miss.length > 1 ? 'were' : 'was'} not read this pass and ${miss.length > 1 ? 'are' : 'is'} excluded from the analysis.`);
  }
  fa.push('این تحلیل فقط از اعداد همین دور خوانده‌شده ساخته شده — داده است، نه توصیهٔ معامله.');
  en.push('This analysis is built only from this pass\u2019s read numbers — data, not trading advice.');

  return { fa: fa.join(' '), en: en.join(' ') };
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
