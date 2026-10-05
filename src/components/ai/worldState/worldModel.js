/**
 * FBT WORLD CONSOLE — pure derivation model (Phase 211 «FBT جهانی» upgrade).
 * ---------------------------------------------------------------------------
 * «هزینهٔ هاست و کرل نباید زیاد شود — آپگرید باید کمک‌کننده باشد، نه مخل.»
 *
 * Everything the new sub-tabs draw is derived IN THE CLIENT from the payload
 * the panel has ALREADY fetched in this pass:
 *
 *   · /ai/global/intelligence  → domains (smart money, whales, macro, …)
 *   · /ai/global/cross-asset   → classes, regime, macro indicators, outlook
 *   · /ai/global/briefing      → proactive items (priority/kind)
 *   · /insights/flows          → token + stablecoin capital flows
 *   · /iran/buy/rate           → the public USDT/TMN reference (fa only)
 *
 * So the world gauges, the globe, the radar, the flow map, the future tree,
 * the challenger and the DNA panels cost ZERO extra requests on refresh —
 * the upgrade adds surface, not traffic. The single exception is the causal
 * tab, which asks the server's OWN macro-graph engine once, lazily, the first
 * time it is opened (that endpoint reuses the server's cached snapshot, so it
 * does not re-dial upstream providers either) — and it falls back to a local
 * chain built from the same pass when the request fails.
 *
 * HONESTY RULES (the same ones the rest of this screen lives by):
 *   · a metric whose input was not read returns status 'unread' — never a
 *     plausible number;
 *   · weights, priors and scenario percentages are labelled as MODEL, and the
 *   rows that fed them are listed next to them;
 *   · proxy readings (e.g. copper as a growth proxy for China) say they are
 *     proxies.
 */

/* ── tiny numeric helpers (no React, no DOM — node-testable) ────────────── */
export const num = (v) => (
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
);
export const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const signOf = (v) => (num(v) === null ? 'flat' : Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : 'flat');

/* ══════════════════════════════════════════════════════════════════════════
   INPUT EXTRACTION — the one place that knows where each number lives.
   ══════════════════════════════════════════════════════════════════════════ */

/** Pull the readable rows out of a payload section (flows uses status/OK). */
const okSection = (s) => (s && s.status === 'OK' ? s : null);

/**
 * @param {object} data  the panel state: { intelligence, briefing, cross,
 *                       flows, toman, goldEtfs } where `cross` is the
 *                       crossAsset envelope itself.
 */
export function extractWorldInputs(data = {}) {
  const cross = data.cross || null;
  const domains = data.intelligence?.domains || data.domains || null;
  const classes = cross?.classes || {};

  /* Macro indicators keyed by symbol — the desk's real quotes. */
  const indicators = Array.isArray(cross?.macro?.indicators) ? cross.macro.indicators : [];
  const ind = {};
  for (const q of indicators) {
    const sym = String(q?.symbol || '').toUpperCase();
    if (sym && !ind[sym]) ind[sym] = q;
  }
  const findInd = (syms) => {
    for (const s of syms) if (ind[String(s).toUpperCase()]) return ind[String(s).toUpperCase()];
    return null;
  };

  const dxy = findInd(['DXY']);
  const gold = findInd(['GOLD', 'XAU', 'XAUUSD']);
  const wti = findInd(['WTI', 'CL']);
  const brent = findInd(['BRENT', 'BRN']);
  const spx = findInd(['SPX', 'SPY', 'QQQ', 'NDX']);
  const us10y = findInd(['US10Y']);
  const us2y = findInd(['US2Y']);
  const copper = findInd(['COPPER', 'HG', 'XCU']);
  const curve = cross?.macro?.curve && num(cross.macro.curve.spreadPct) !== null ? cross.macro.curve : null;

  const crypto = classes.crypto || null;
  const stocks = classes.stocks || null;
  const forex = classes.forex || null;
  const commodities = classes.commodities || null;
  const rwa = classes.rwa || null;

  const flows = data.flows || null;
  const tokenFlows = okSection(flows?.tokenFlows);
  const chainFlows = okSection(flows?.chainFlows);

  const sm = domains?.smart_money?.status === 'OK' ? domains.smart_money.data : null;
  const whales = domains?.whales?.status === 'OK' ? domains.whales.data : null;
  const onchain = domains?.onchain?.status === 'OK' ? domains.onchain.data : null;
  const newsDom = domains?.news?.status === 'OK' ? domains.news.data : null;
  const macroDom = domains?.macro?.status === 'OK' ? domains.macro.data : null;
  const rwaDom = domains?.rwa?.status === 'OK' ? domains.rwa.data : null;
  const forexInstruments = domains?.forex?.status === 'OK' ? (domains.forex.data?.instruments || []) : [];

  const regime = String(cross?.regime?.regime || '').toUpperCase();
  const outlook = cross?.outlook || null;
  const divergences = Array.isArray(cross?.divergences) ? cross.divergences : [];
  const briefingItems = Array.isArray(data.briefing?.items) ? data.briefing.items : [];

  return {
    cross, domains, classes, indicators, ind, findInd,
    dxy, gold, wti, brent, spx, us10y, us2y, copper, curve,
    crypto, stocks, forex, commodities, rwa,
    tokenFlows, chainFlows,
    sm, whales, onchain, newsDom, macroDom, rwaDom, forexInstruments,
    regime, outlook, divergences, briefingItems,
    toman: data.toman || null, goldEtfs: data.goldEtfs || null
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1) FBT WORLD STATE — nine live gauges
   ──────────────────────────────────────────────────────────────────────────
   The proposal asked for a GLOBAL FINANCIAL STATE board: Liquidity ↑, Risk
   MEDIUM, … Each row below is computed from observations of THIS pass; the
   `evidence` array names exactly what fed it, so the board can never show a
   direction it cannot justify.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildWorldState(data = {}) {
  const x = extractWorldInputs(data);
  const metrics = [];
  const push = (m) => metrics.push(m);

  /* 1 — Liquidity: real stablecoin net flow (mint = money in) plus the
     labelled smart-money net when either was read. */
  {
    const stableNet = num(x.chainFlows?.net24hUsd);
    const smNet = x.sm && num(x.sm.accumulationUsd) !== null && num(x.sm.distributionUsd) !== null
      ? num(x.sm.accumulationUsd) - num(x.sm.distributionUsd) : null;
    const basis = stableNet !== null ? stableNet : smNet;
    push({
      id: 'liquidity', icon: 'drop', kind: 'dir',
      status: basis === null ? 'unread' : 'ok',
      dir: basis === null ? 'flat' : signOf(basis),
      meter: basis === null ? 0 : clamp(Math.abs(basis) / 250_000_000, 0.08, 1),
      evidence: [
        stableNet !== null ? { key: 'stablecoinNet', value: stableNet } : null,
        smNet !== null ? { key: 'smartMoneyNet', value: smNet } : null
      ].filter(Boolean),
      source: stableNet !== null ? 'defillama' : (smNet !== null ? 'smartMoney:overview' : null)
    });
  }

  /* 2 — Global risk: the regime + the outlook score the engine computed. */
  {
    const score = num(x.outlook?.score);
    const label = String(x.outlook?.label || '');
    let level = null;
    if (label === 'RECESSION_WATCH') level = 'high';
    else if (label === 'GROWTH_WATCH') level = 'low';
    else if (score !== null) level = score <= -1 ? 'high' : score >= 1 ? 'low' : 'medium';
    else if (x.regime.includes('RISK_OFF')) level = 'high';
    else if (x.regime.includes('RISK_ON')) level = 'low';
    else if (x.regime === 'MIXED') level = 'medium';
    push({
      id: 'risk', icon: 'warning', kind: 'level',
      status: level === null ? 'unread' : 'ok',
      level, meter: level === 'high' ? 0.9 : level === 'medium' ? 0.55 : level === 'low' ? 0.25 : 0,
      evidence: [
        x.regime ? { key: 'regime', value: x.regime } : null,
        score !== null ? { key: 'outlookScore', value: score } : null
      ].filter(Boolean),
      source: 'cross-asset-engine'
    });
  }

  /* 3 — Energy/inflation pressure: the measured crude move (labelled as an
     energy proxy for inflation expectations, which is what it is). */
  {
    const w = num(x.wti?.change1dPct); const b = num(x.brent?.change1dPct);
    const vals = [w, b].filter((v) => v !== null);
    const avg = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
    push({
      id: 'inflation', icon: 'flame', kind: 'dir',
      status: avg === null ? 'unread' : 'ok',
      dir: avg === null ? 'flat' : signOf(avg),
      meter: avg === null ? 0 : clamp(Math.abs(avg) / 3, 0.08, 1),
      valuePct: avg, proxy: true,
      evidence: [x.wti ? { key: 'wti', value: num(x.wti.change1dPct) } : null,
        x.brent ? { key: 'brent', value: num(x.brent.change1dPct) } : null].filter(Boolean),
      source: x.wti?.source || x.brent?.source || null
    });
  }

  /* 4 — Dollar strength: DXY 24h move. */
  {
    const v = num(x.dxy?.change1dPct);
    push({
      id: 'dollar', icon: 'bank', kind: 'dir',
      status: v === null ? 'unread' : 'ok',
      dir: v === null ? 'flat' : signOf(v),
      meter: v === null ? 0 : clamp(Math.abs(v) / 1.5, 0.08, 1),
      valuePct: v,
      evidence: v !== null ? [{ key: 'dxy', value: v }] : [],
      source: x.dxy?.source || null
    });
  }

  /* 5 — Crypto flow: the measured crypto-class average + the top token flow. */
  {
    const avg = num(x.crypto?.avgChangePct);
    const top = x.tokenFlows?.topInflow || x.tokenFlows?.topOutflow || null;
    const cfOk = avg !== null || top !== null;
    push({
      id: 'cryptoFlow', icon: 'coin', kind: 'dir',
      status: cfOk ? 'ok' : 'unread',
      dir: avg !== null ? signOf(avg) : (top ? signOf(top.mcapChangePct) : 'flat'),
      meter: cfOk ? clamp(Math.abs(avg ?? num(top?.mcapChangePct) ?? 0) / 4, 0.08, 1) : 0,
      valuePct: avg,
      evidence: [
        avg !== null ? { key: 'classAvg', value: avg } : null,
        top ? { key: 'topToken', value: `${top.symbol} ${round(top.mcapChangePct)}%` } : null
      ].filter(Boolean),
      source: 'cross-asset-engine'
    });
  }

  /* 6 — Institutional flow: labelled accumulation minus distribution. */
  {
    const net = x.sm && num(x.sm.accumulationUsd) !== null && num(x.sm.distributionUsd) !== null
      ? num(x.sm.accumulationUsd) - num(x.sm.distributionUsd) : null;
    push({
      id: 'institutional', icon: 'building', kind: 'dir',
      status: net === null ? 'unread' : 'ok',
      dir: net === null ? 'flat' : signOf(net),
      meter: net === null ? 0 : clamp(Math.abs(net) / 5_000_000, 0.08, 1),
      evidence: net !== null ? [{ key: 'netUsd', value: net }] : [],
      source: 'smartMoney:overview'
    });
  }

  /* 7 — Geopolitical risk: share of classified headlines tagged GEOPOLITICS. */
  {
    const byTopic = x.macroDom?.byTopic || {};
    const total = Object.values(byTopic).reduce((a, c) => a + (num(c) || 0), 0);
    const geo = num(byTopic.GEOPOLITICS) || 0;
    const level = total === 0 ? null : (geo >= 3 || geo / total >= 0.35 ? 'high' : geo >= 1 ? 'medium' : 'low');
    push({
      id: 'geopolitics', icon: 'globe', kind: 'level',
      status: level === null ? 'unread' : 'ok',
      level, meter: level === null ? 0 : level === 'high' ? 0.9 : level === 'medium' ? 0.55 : 0.25,
      evidence: total ? [{ key: 'headlines', value: `${geo}/${total}` }] : [],
      source: 'macro:classifier'
    });
  }

  /* 8 — RWA adoption: the tokenised desk read + its measured change. */
  {
    const inst = x.rwaDom?.instruments || [];
    const ch = inst.map((i) => num(i.change24hPct)).filter((v) => v !== null);
    const avg = ch.length ? ch.reduce((a, c) => a + c, 0) / ch.length : null;
    const rwaVal = avg ?? num(x.rwa?.avgChangePct);
    const rwaOk = Boolean(x.rwaDom) || (x.rwa && num(x.rwa.avgChangePct) !== null);
    push({
      id: 'rwa', icon: 'layers', kind: 'dir',
      status: rwaOk ? 'ok' : 'unread',
      dir: signOf(rwaVal),
      meter: rwaVal !== null ? clamp(Math.abs(rwaVal) / 2, 0.08, 1) : (rwaOk ? 0.08 : 0),
      evidence: [
        inst.length ? { key: 'instruments', value: inst.length } : null,
        avg !== null ? { key: 'avgChange', value: avg } : null
      ].filter(Boolean),
      source: x.domains?.rwa?.source || null
    });
  }

  /* 9 — Global volatility: the spread of the measured per-class moves. */
  {
    const avgs = Object.values(x.classes)
      .map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
    const spread = avgs.length ? Math.max(...avgs.map(Math.abs)) : null;
    const level = spread === null ? null : (spread >= 2 ? 'high' : spread >= 0.7 ? 'medium' : 'low');
    push({
      id: 'volatility', icon: 'pulse', kind: 'level',
      status: level === null ? 'unread' : 'ok',
      level, meter: level === null ? 0 : level === 'high' ? 0.9 : level === 'medium' ? 0.55 : 0.25,
      evidence: spread !== null ? [{ key: 'maxClassMove', value: round(spread) }] : [],
      source: 'cross-asset-engine'
    });
  }

  const okCount = metrics.filter((m) => m.status === 'ok').length;
  return { metrics, okCount, total: metrics.length, generatedFrom: 'this pass' };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) FINANCIAL WEATHER — the same readings, forecast-style.
   ══════════════════════════════════════════════════════════════════════════ */
export function buildWeather(data = {}) {
  const x = extractWorldInputs(data);
  const rows = [];

  /* Liquidity sky */
  const stableNet = num(x.chainFlows?.net24hUsd);
  rows.push({
    id: 'liquidity', tone: stableNet === null ? 'na' : stableNet > 0 ? 'sun' : 'rain',
    icon: stableNet === null ? 'cloud' : stableNet > 0 ? 'sun' : 'rain',
    value: stableNet, source: 'defillama'
  });

  /* Volatility sky */
  const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
  const spread = avgs.length ? Math.max(...avgs.map(Math.abs)) : null;
  rows.push({
    id: 'volatility',
    tone: spread === null ? 'na' : spread >= 2 ? 'storm' : spread >= 0.7 ? 'partly' : 'sun',
    icon: spread === null ? 'cloud' : spread >= 2 ? 'storm' : spread >= 0.7 ? 'partly' : 'sun',
    value: spread, source: 'cross-asset-engine'
  });

  /* Whale weather */
  const wCount = num(x.whales?.count);
  const smNet = x.sm && num(x.sm.accumulationUsd) !== null && num(x.sm.distributionUsd) !== null
    ? num(x.sm.accumulationUsd) - num(x.sm.distributionUsd) : null;
  rows.push({
    id: 'whales',
    tone: wCount === null && smNet === null ? 'na' : (smNet !== null && smNet < 0 ? 'storm' : wCount !== null && wCount > 10 ? 'partly' : 'sun'),
    icon: smNet !== null && smNet < 0 ? 'storm' : 'wavesIcon',
    value: wCount, source: 'whales:scanner'
  });

  /* Macro wind */
  const outlookLabel = String(x.outlook?.label || '');
  rows.push({
    id: 'macro',
    tone: outlookLabel === 'RECESSION_WATCH' ? 'rain' : outlookLabel === 'GROWTH_WATCH' ? 'sun' : outlookLabel ? 'partly' : 'na',
    icon: outlookLabel === 'RECESSION_WATCH' ? 'rain' : outlookLabel === 'GROWTH_WATCH' ? 'sun' : 'wind',
    value: outlookLabel || null, source: 'cross-asset-engine'
  });

  /* Chain-health horizon */
  const down = num(x.onchain?.downSources); const totalSrc = (x.onchain?.sources || []).length;
  rows.push({
    id: 'chains',
    tone: !x.onchain ? 'na' : down > 0 ? 'rain' : totalSrc ? 'sun' : 'partly',
    icon: down > 0 ? 'rain' : 'sun',
    value: x.onchain ? `${x.onchain.healthySources ?? 0}/${totalSrc}` : null, source: 'chainIntel'
  });

  /* Dollar wind */
  const dxyChg = num(x.dxy?.change1dPct);
  rows.push({
    id: 'dollarWind',
    tone: dxyChg === null ? 'na' : Math.abs(dxyChg) >= 0.7 ? 'windy' : 'partly',
    icon: 'wind', value: dxyChg, source: x.dxy?.source || null
  });

  /* News temperature */
  const nCount = num(x.newsDom?.count);
  rows.push({
    id: 'news',
    tone: nCount === null ? 'na' : nCount >= 20 ? 'partly' : 'sun',
    icon: 'newsIcon', value: nCount, source: 'news-engine'
  });

  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) FBT GLOBAL RADAR — blips from what this pass actually flagged.
   Tone ladder: critical → emerging → developing → stable → opportunity.
   ══════════════════════════════════════════════════════════════════════════ */
export function buildRadar(data = {}) {
  const x = extractWorldInputs(data);
  const blips = [];
  const toneRank = { critical: 0, emerging: 1, developing: 2, opportunity: 3, stable: 4 };

  for (const item of x.briefingItems.slice(0, 24)) {
    const tone = item.priority === 'critical' ? 'critical'
      : item.priority === 'high' ? 'emerging'
      : item.priority === 'normal' ? 'developing'
      : 'stable';
    blips.push({ id: `br:${item.id}`, tone, kind: item.kind, title: item.title, titleFa: item.titleFa || null, meta: item.source || null });
  }

  /* Opportunities: the movers THIS pass measured. */
  if (x.tokenFlows?.topInflow) {
    blips.push({ id: 'op:inflow', tone: 'opportunity', kind: 'flow', title: `${x.tokenFlows.topInflow.symbol} +$${Math.round(Math.abs(x.tokenFlows.topInflow.mcapChangeUsd || 0) / 1e6)}M 24h inflow`, titleFa: null, meta: 'coingecko' });
  }
  if (x.chainFlows?.topInflowChain) {
    blips.push({ id: 'op:chain', tone: 'opportunity', kind: 'chain', title: `${x.chainFlows.topInflowChain.chain} stablecoin inflow`, titleFa: null, meta: 'defillama' });
  }
  for (const [cls, c] of Object.entries(x.classes)) {
    const avg = num(c?.avgChangePct);
    if (avg === null) continue;
    if (avg >= 1.5) blips.push({ id: `op:${cls}`, tone: 'opportunity', kind: cls, title: `${cls} class +${round(avg)}%`, titleFa: null, meta: 'cross-asset-engine' });
    else if (avg <= -1.5) blips.push({ id: `warn:${cls}`, tone: 'emerging', kind: cls, title: `${cls} class ${round(avg)}%`, titleFa: null, meta: 'cross-asset-engine' });
  }
  for (const d of x.divergences.slice(0, 3)) {
    blips.push({ id: `div:${d.classes?.join('-')}`, tone: 'developing', kind: 'divergence', title: `${d.classes?.[0]} vs ${d.classes?.[1]} gap ${d.gapPct}pp`, titleFa: null, meta: 'cross-asset-engine' });
  }

  blips.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  /* Deterministic polar placement: ring by tone, angle by index. */
  const ring = { critical: 0.3, emerging: 0.48, developing: 0.64, opportunity: 0.8, stable: 0.9 };
  const perTone = {};
  for (const b of blips) {
    perTone[b.tone] = (perTone[b.tone] || 0) + 1;
    const i = perTone[b.tone];
    b.r = ring[b.tone];
    b.angle = ((i * 137.5) % 360) * (Math.PI / 180); // golden angle — stable spread
  }
  const counts = { critical: 0, emerging: 0, developing: 0, opportunity: 0, stable: 0 };
  for (const b of blips) counts[b.tone] += 1;
  return { blips: blips.slice(0, 26), counts };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) THE GLOBE — country nodes with real economic snapshots.
   Each country links ONLY to instruments this app actually reads; whatever
   was not read this pass shows as «unread», never as a guessed number.
   ══════════════════════════════════════════════════════════════════════════ */
export const COUNTRIES = Object.freeze([
  { id: 'us', fa: 'آمریکا', en: 'United States', x: 88, y: 118, links: ['DXY', 'US10Y', 'CURVE', 'EQUITY'] },
  { id: 'eu', fa: 'منطقه یورو', en: 'Eurozone', x: 162, y: 98, links: ['EURUSD', 'GOLD', 'US10Y'] },
  { id: 'uk', fa: 'بریتانیا', en: 'United Kingdom', x: 148, y: 82, links: ['GBPUSD', 'BRENT', 'US10Y'] },
  { id: 'tr', fa: 'ترکیه', en: 'Türkiye', x: 184, y: 108, links: ['GOLD', 'DXY'], proxyNote: true },
  { id: 'ru', fa: 'روسیه', en: 'Russia', x: 205, y: 76, links: ['WTI', 'GOLD'], proxyNote: true },
  { id: 'gulf', fa: 'خلیج فارس', en: 'Gulf states', x: 199, y: 142, links: ['WTI', 'BRENT'] },
  { id: 'ir', fa: 'ایران', en: 'Iran', x: 213, y: 122, links: ['TMN', 'GOLD', 'WTI'] },
  { id: 'in', fa: 'هند', en: 'India', x: 226, y: 156, links: ['GOLD', 'WTI'], proxyNote: true },
  { id: 'cn', fa: 'چین', en: 'China', x: 251, y: 120, links: ['COPPER', 'WTI'], proxyNote: true },
  { id: 'jp', fa: 'ژاپن', en: 'Japan', x: 273, y: 106, links: ['JPYUSD', 'US10Y'] },
  { id: 'au', fa: 'استرالیا', en: 'Australia', x: 272, y: 202, links: ['COPPER', 'GOLD'], proxyNote: true },
  { id: 'br', fa: 'برزیل', en: 'Brazil', x: 121, y: 196, links: ['COPPER', 'WTI'], proxyNote: true }
]);

const FOREX_SYMS = { EURUSD: ['EURUSD', 'EUR_USD'], GBPUSD: ['GBPUSD', 'GBP_USD'], JPYUSD: ['USDJPY', 'JPYUSD', 'USD_JPY'], };

export function buildCountrySnapshot(country, data = {}, { isPersian = true } = {}) {
  const x = extractWorldInputs(data);
  const findForex = (key) => {
    const alts = FOREX_SYMS[key] || [key];
    return x.forexInstruments.find((i) => alts.some((a) => String(i?.symbol || '').toUpperCase().replace('/', '').includes(a.replace('/', ''))));
  };
  const rows = [];
  for (const link of country.links) {
    if (link === 'CURVE') {
      if (x.curve) rows.push({ sym: '2s10s', name: isPersian ? 'منحنی بازده ۲/۱۰' : '2s10s yield curve', change: null, value: `${x.curve.spreadPct}pp`, dir: signOf(x.curve.spreadPct), source: x.curve.source || null });
      continue;
    }
    if (link === 'EQUITY') {
      if (x.spx) rows.push({ sym: x.spx.symbol, name: isPersian ? 'شاخص سهام آمریکا' : 'US equity index', change: num(x.spx.change1dPct), value: num(x.spx.priceUsd) !== null ? String(round(x.spx.priceUsd, 2)) : null, dir: signOf(x.spx.change1dPct), source: x.spx.source || null });
      continue;
    }
    if (link === 'TMN') {
      if (x.toman?.status === 'fresh') rows.push({ sym: 'USDT/TMN', name: isPersian ? 'دلار (نرخ مرجع)' : 'USD reference (Wallex)', change: null, value: String(Math.round(x.toman.value)), dir: 'flat', source: x.toman.source || 'wallex' });
      continue;
    }
    if (FOREX_SYMS[link]) {
      const q = findForex(link);
      if (q) rows.push({ sym: q.symbol, name: isPersian ? 'برابری ارز' : 'FX parity', change: num(q.change24hPct), value: num(q.priceUsd) !== null ? String(round(q.priceUsd, 4)) : null, dir: signOf(q.change24hPct), source: x.domains?.forex?.source || null });
      continue;
    }
    const q = x.findInd([link]);
    if (q) rows.push({ sym: q.symbol, name: q.name || link, change: num(q.change1dPct), value: num(q.priceUsd) !== null ? String(round(q.priceUsd, q.priceUsd >= 100 ? 1 : 3)) : null, dir: signOf(q.change1dPct), source: q.source || null });
  }
  const changes = rows.map((r) => r.change).filter((v) => v !== null);
  const net = changes.length ? round(changes.reduce((a, c) => a + c, 0) / changes.length) : null;
  return {
    country, rows, net,
    status: rows.length ? (changes.length ? 'read' : 'partial') : 'unread',
    mood: net === null ? 'flat' : net >= 0.3 ? 'up' : net <= -0.3 ? 'down' : 'flat'
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) GLOBAL CAPITAL FLOW MAP — where money is moving, node by node.
   ══════════════════════════════════════════════════════════════════════════ */
export function buildFlowMap(data = {}) {
  const x = extractWorldInputs(data);
  const mk = (id, fa, en, basis) => ({ id, fa, en, ...basis });

  const nodes = [
    mk('usd', 'دلار آمریکا', 'US Dollar', num(x.dxy?.change1dPct) !== null
      ? { status: 'ok', dir: signOf(x.dxy.change1dPct), value: `${round(x.dxy.change1dPct)}%`, source: x.dxy.source }
      : { status: 'unread' }),
    mk('treasuries', 'اوراق قرضه آمریکا', 'US Treasuries', num(x.us10y?.change1dPct) !== null
      ? { status: 'ok', dir: signOf(x.us10y.change1dPct), value: `${round(x.us10y.change1dPct)}%`, source: x.us10y.source }
      : { status: 'unread' }),
    mk('gold', 'طلا', 'Gold', num(x.gold?.change1dPct) !== null
      ? { status: 'ok', dir: signOf(x.gold.change1dPct), value: `${round(x.gold.change1dPct)}%`, source: x.gold.source }
      : { status: 'unread' }),
    mk('btc', 'بیت‌کوین و رمزارزها', 'Bitcoin & crypto', num(x.crypto?.avgChangePct) !== null
      ? { status: 'ok', dir: signOf(x.crypto.avgChangePct), value: `${round(x.crypto.avgChangePct)}%`, source: 'cross-asset-engine' }
      : { status: 'unread' }),
    mk('defi', 'دیفای (استیبل‌کوین‌ها)', 'DeFi (stablecoins)', num(x.chainFlows?.net24hUsd) !== null
      ? { status: 'ok', dir: signOf(x.chainFlows.net24hUsd), value: `$${Math.round(Math.abs(x.chainFlows.net24hUsd) / 1e6)}M`, source: 'defillama' }
      : { status: 'unread' }),
    mk('rwa', 'دارایی‌های واقعی (RWA)', 'Real-world assets', (() => {
      const inst = x.rwaDom?.instruments || [];
      const ch = inst.map((i) => num(i.change24hPct)).filter((v) => v !== null);
      if (!inst.length && !x.rwa) return { status: 'unread' };
      const avg = ch.length ? round(ch.reduce((a, c) => a + c, 0) / ch.length) : num(x.rwa?.avgChangePct);
      return { status: 'ok', dir: signOf(avg), value: avg !== null ? `${avg}%` : `${inst.length}`, source: x.domains?.rwa?.source || 'cross-asset-engine' };
    })())
  ];
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id, active: nodes[i].status === 'ok' && nodes[i + 1].status === 'ok' });
  }
  return { nodes, edges };
}

/* ══════════════════════════════════════════════════════════════════════════
   6) FUTURE TREE — bull / base / stress scenarios with model weights.
   The weights are a transparent function of THIS pass's readings; every
   applied nudge is listed so the reader can audit the arithmetic.
   ══════════════════════════════════════════════════════════════════════════ */
export const FUTURE_ASSETS = Object.freeze(['btc', 'gold', 'dollar', 'equity']);

export function buildFutureTree(data = {}, asset = 'btc') {
  const x = extractWorldInputs(data);
  const nudges = [];
  let bull = 34; let base = 46; let stress = 20;
  const apply = (target, amount, key, value) => {
    if (target === 'bull') bull += amount; else if (target === 'stress') stress += amount; else base += amount;
    nudges.push({ key, value, target, amount });
  };

  const regime = x.regime;
  if (regime === 'RISK_ON' || regime === 'RISK_ON_LEANING') apply('bull', 8, 'regime', regime);
  else if (regime === 'RISK_OFF' || regime === 'RISK_OFF_LEANING') apply('stress', 8, 'regime', regime);

  const outlookLabel = String(x.outlook?.label || '');
  if (outlookLabel === 'GROWTH_WATCH') apply('bull', 6, 'outlook', outlookLabel);
  if (outlookLabel === 'RECESSION_WATCH') apply('stress', 6, 'outlook', outlookLabel);

  const stableNet = num(x.chainFlows?.net24hUsd);
  if (stableNet !== null) {
    if (stableNet > 0) apply('bull', 5, 'liquidity', `+$${Math.round(stableNet / 1e6)}M`);
    else if (stableNet < 0) apply('stress', 5, 'liquidity', `−$${Math.round(Math.abs(stableNet) / 1e6)}M`);
  }
  if (x.curve && num(x.curve.spreadPct) < 0) apply('stress', 4, 'curve', `${x.curve.spreadPct}pp`);
  const dxyChg = num(x.dxy?.change1dPct);
  if (dxyChg !== null && asset !== 'dollar') {
    if (dxyChg > 0.3) apply('stress', 3, 'dollar', `+${round(dxyChg)}%`);
    else if (dxyChg < -0.3) apply('bull', 3, 'dollar', `${round(dxyChg)}%`);
  }
  const smNet = x.sm && num(x.sm.accumulationUsd) !== null && num(x.sm.distributionUsd) !== null
    ? num(x.sm.accumulationUsd) - num(x.sm.distributionUsd) : null;
  if (smNet !== null && (asset === 'btc')) {
    if (smNet > 0) apply('bull', 4, 'smartMoney', 'accumulation'); else apply('stress', 4, 'smartMoney', 'distribution');
  }

  /* normalise */
  bull = clamp(bull, 5, 80); stress = clamp(stress, 5, 80); base = Math.max(5, 100 - bull - stress);
  const total = bull + base + stress;
  const W = (v) => Math.round((v / total) * 100);

  /* Drivers listed under each case come from the pass's own signals. */
  const drivers = {
    bull: [
      stableNet !== null && stableNet > 0 ? 'stablecoinInflow' : null,
      smNet !== null && smNet > 0 ? 'smartMoneyAccumulation' : null,
      regime.includes('RISK_ON') ? 'riskOnRegime' : null,
      x.tokenFlows?.topInflow ? `topInflow:${x.tokenFlows.topInflow.symbol}` : null
    ].filter(Boolean),
    base: ['rangeMarket', ...(x.divergences.length ? ['crossClassDivergence'] : [])],
    stress: [
      x.curve && num(x.curve.spreadPct) < 0 ? 'invertedCurve' : null,
      outlookLabel === 'RECESSION_WATCH' ? 'recessionWatch' : null,
      dxyChg !== null && dxyChg > 0 ? 'dollarStrength' : null,
      stableNet !== null && stableNet < 0 ? 'stablecoinOutflow' : null
    ].filter(Boolean)
  };

  /* The asset's measured move anchors the header. */
  const anchor = asset === 'btc' ? { change: num(x.crypto?.avgChangePct), label: 'crypto class' }
    : asset === 'gold' ? { change: num(x.gold?.change1dPct), label: x.gold?.symbol || 'GOLD' }
    : asset === 'dollar' ? { change: dxyChg, label: x.dxy?.symbol || 'DXY' }
    : { change: num(x.spx?.change1dPct), label: x.spx?.symbol || 'SPX' };

  return { asset, weights: { bull: W(bull), base: W(base), stress: W(stress) }, nudges, drivers, anchor };
}

/* ══════════════════════════════════════════════════════════════════════════
   7) ADVERSARIAL CHALLENGER — the case against the pass's top opportunity.
   Every counterargument says whether it was OBSERVED in this pass (with the
   reading behind it) or is a standing risk the model always carries.
   ══════════════════════════════════════════════════════════════════════════ */
export function buildChallenger(data = {}) {
  const x = extractWorldInputs(data);

  /* Find the strongest positive signal — that is the thesis to attack. */
  let opp = null;
  const cryptoAvg = num(x.crypto?.avgChangePct);
  if (x.tokenFlows?.topInflow && num(x.tokenFlows.topInflow.mcapChangePct) > 0) {
    opp = { id: 'tokenInflow', label: `${x.tokenFlows.topInflow.symbol}`, detail: 'top capital inflow (CoinGecko 24h market-cap delta)', value: `+${round(x.tokenFlows.topInflow.mcapChangePct)}%` };
  } else if (cryptoAvg !== null && cryptoAvg > 0) {
    opp = { id: 'cryptoClass', label: 'crypto class', detail: 'positive measured 24h class average', value: `+${round(cryptoAvg)}%` };
  } else if (x.chainFlows?.topInflowChain) {
    opp = { id: 'chainInflow', label: x.chainFlows.topInflowChain.chain, detail: 'top stablecoin inflow chain', value: `$${Math.round(Math.abs(x.chainFlows.topInflowChain.net24hUsd || 0) / 1e6)}M` };
  }
  if (!opp) return { opportunity: null, arguments: [], observed: 0 };

  const stableNet = num(x.chainFlows?.net24hUsd);
  const smNet = x.sm && num(x.sm.accumulationUsd) !== null && num(x.sm.distributionUsd) !== null
    ? num(x.sm.accumulationUsd) - num(x.sm.distributionUsd) : null;
  const dxyChg = num(x.dxy?.change1dPct);
  const inverted = x.curve && num(x.curve.spreadPct) < 0;

  const args = [
    {
      id: 'macro', key: 'macroRisk',
      observed: String(x.outlook?.label) === 'RECESSION_WATCH' || inverted,
      evidence: inverted ? `2s10s inverted at ${x.curve.spreadPct}pp` : String(x.outlook?.label || '')
    },
    {
      id: 'liquidity', key: 'liquidityRisk',
      observed: stableNet !== null && stableNet < 0,
      evidence: stableNet !== null ? `stablecoin net ${stableNet >= 0 ? '+' : '−'}$${Math.round(Math.abs(stableNet) / 1e6)}M` : null
    },
    {
      id: 'dollar', key: 'dollarHeadwind',
      observed: dxyChg !== null && dxyChg > 0,
      evidence: dxyChg !== null ? `DXY +${round(dxyChg)}%` : null
    },
    {
      id: 'whale', key: 'whaleExitRisk',
      observed: smNet !== null && smNet < 0,
      evidence: smNet !== null ? `labelled net ${smNet >= 0 ? '+' : '−'}$${Math.round(Math.abs(smNet) / 1e3)}k` : null
    },
    {
      id: 'divergence', key: 'divergenceRisk',
      observed: x.divergences.length > 0,
      evidence: x.divergences[0] ? `${x.divergences[0].classes?.join(' vs ')} gap ${x.divergences[0].gapPct}pp` : null
    },
    {
      id: 'coverage', key: 'dataGapRisk',
      observed: (data.intelligence?.missing?.length || 0) >= 2,
      evidence: `${data.intelligence?.missing?.length || 0} domains unread`
    },
    { id: 'model', key: 'modelRisk', observed: false, evidence: 'all sensitivities are first-order model terms' }
  ];
  return { opportunity: opp, arguments: args, observed: args.filter((a) => a.observed).length };
}

/* ══════════════════════════════════════════════════════════════════════════
   8) MARKET DNA — per-asset sensitivity profile (model priors + observed
   overlays from this pass). Priors are LABELLED as model assumptions.
   ══════════════════════════════════════════════════════════════════════════ */
export const DNA_ASSETS = Object.freeze(['BTC', 'ETH', 'GOLD', 'DXY', 'WTI', 'SPX']);
const DNA_PRIORS = Object.freeze({
  BTC: { liquidity: 0.9, macro: 0.8, whale: 0.8, usd: 0.7, riskOn: 0.9, etf: 0.8 },
  ETH: { liquidity: 0.85, macro: 0.75, whale: 0.7, usd: 0.65, riskOn: 0.85, etf: 0.5 },
  GOLD: { liquidity: 0.4, macro: 0.8, whale: 0.2, usd: 0.75, riskOn: 0.25, etf: 0.6 },
  DXY: { liquidity: 0.6, macro: 0.9, whale: 0.1, usd: 1, riskOn: 0.4, etf: 0 },
  WTI: { liquidity: 0.5, macro: 0.85, whale: 0.2, usd: 0.6, riskOn: 0.5, etf: 0.3 },
  SPX: { liquidity: 0.7, macro: 0.85, whale: 0.2, usd: 0.6, riskOn: 0.8, etf: 0.7 }
});

export function buildDna(data = {}, symbol = 'BTC') {
  const x = extractWorldInputs(data);
  const sym = String(symbol || 'BTC').toUpperCase();
  const priors = DNA_PRIORS[sym] || DNA_PRIORS.BTC;

  /* The asset's own reading, wherever this pass saw it. */
  const own = x.findInd([sym === 'WTI' ? 'WTI' : sym])
    || x.indicators.find((q) => String(q.symbol).toUpperCase().includes(sym))
    || (sym === 'BTC' || sym === 'ETH' ? (x.classes?.crypto?.top || []).concat(x.classes?.crypto?.bottom || []).find((t) => t.symbol === sym) : null);
  const ownChange = num(own?.change1dPct ?? own?.change24hPct ?? own?.changePct ?? (sym === 'BTC' ? x.crypto?.avgChangePct : null));
  const dxyChg = num(x.dxy?.change1dPct);
  const usdAlignment = ownChange === null || dxyChg === null || sym === 'DXY'
    ? null
    : (ownChange > 0 && dxyChg > 0) || (ownChange < 0 && dxyChg < 0) ? 'same' : 'opposite';
  const whaleTouched = [
    ...(x.whales?.events || []), ...(x.sm?.topTokens || [])
  ].some((e) => String(e?.symbol || '').toUpperCase().includes(sym));
  const etfLinked = sym === 'GOLD' ? (data.goldEtfs?.available === true) : (sym === 'BTC' || sym === 'ETH');

  return {
    symbol: sym,
    priors,
    observed: {
      change: ownChange,
      volatility: ownChange === null ? null : Math.abs(ownChange) >= 2 ? 'high' : Math.abs(ownChange) >= 0.5 ? 'medium' : 'low',
      usdAlignment, whaleTouched, etfLinked,
      source: own?.source || null
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   9) CAUSAL CHAIN (local fallback) — the oil → inflation → yields → dollar
   → pressure → crypto-liquidity transmission, each node lit only by a real
   reading; proxy / unread nodes say so. The causal tab prefers the server's
   own macro-graph engine and falls back to this when it cannot be reached.
   ══════════════════════════════════════════════════════════════════════════ */
export function buildCausalLocal(data = {}) {
  const x = extractWorldInputs(data);
  const mk = (id, fa, en, reading) => ({ id, fa, en, ...reading });
  const energyAvg = (() => {
    const vals = [num(x.wti?.change1dPct), num(x.brent?.change1dPct)].filter((v) => v !== null);
    return vals.length ? round(vals.reduce((a, c) => a + c, 0) / vals.length) : null;
  })();
  const nodes = [
    mk('oil', 'نفت', 'Oil', energyAvg !== null
      ? { state: 'read', dir: signOf(energyAvg), value: `${energyAvg}%`, source: x.wti?.source || x.brent?.source || null }
      : { state: 'unread' }),
    mk('inflation', 'انتظارات تورم', 'Inflation expectations', energyAvg !== null
      ? { state: 'proxy', dir: signOf(energyAvg), value: null }
      : { state: 'unread' }),
    mk('yields', 'بازده اوراق', 'Bond yields', num(x.us10y?.change1dPct) !== null
      ? { state: 'read', dir: signOf(x.us10y.change1dPct), value: `${round(x.us10y.change1dPct)}%`, source: x.us10y.source || null }
      : { state: 'unread' }),
    mk('usd', 'دلار', 'US Dollar', num(x.dxy?.change1dPct) !== null
      ? { state: 'read', dir: signOf(x.dxy.change1dPct), value: `${round(x.dxy.change1dPct)}%`, source: x.dxy.source || null }
      : { state: 'unread' }),
    /* A model-labelled node still needs SOME read input to exist; with the
       dollar unread there is nothing to transmit, so it stays unread too. */
    mk('em', 'فشار بازارهای نوظهور', 'Emerging-market pressure', num(x.dxy?.change1dPct) !== null
      ? { state: 'model', dir: signOf(x.dxy.change1dPct) }
      : { state: 'unread' }),
    mk('cryptoliq', 'نقدینگی رمزارز', 'Crypto liquidity', num(x.crypto?.avgChangePct) !== null
      ? { state: 'read', dir: signOf(x.crypto.avgChangePct), value: `${round(x.crypto.avgChangePct)}%`, source: 'cross-asset-engine' }
      : num(x.chainFlows?.net24hUsd) !== null
        ? { state: 'read', dir: signOf(x.chainFlows.net24hUsd), value: `$${Math.round(Math.abs(x.chainFlows.net24hUsd) / 1e6)}M`, source: 'defillama' }
        : { state: 'unread' })
  ];
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      from: nodes[i].id, to: nodes[i + 1].id,
      lit: nodes[i].state !== 'unread' && nodes[i + 1].state !== 'unread'
    });
  }
  return { nodes, edges, origin: 'local' };
}

export default buildWorldState;
