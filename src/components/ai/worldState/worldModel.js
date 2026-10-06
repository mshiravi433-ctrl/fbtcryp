/**
 * FBT WORLD CONSOLE — pure derivation model (Phase 211 «FBT جهانی» upgrade).
 * ---------------------------------------------------------------------------
 * «هزینهٔ هاست و کرل نباید زیاد شود — آپگرید باید کمک‌کننده باشد، نه مخل.»
 *
 * Everything the World Console draws is derived IN THE CLIENT from the payload
 * the panel has ALREADY fetched in this pass:
 *
 *   · /ai/global/intelligence  → domains (smart money, whales, macro, …)
 *   · /ai/global/cross-asset   → classes, regime, macro indicators, outlook
 *   · /ai/global/briefing      → proactive items (priority/kind)
 *   · /insights/flows          → token + stablecoin capital flows
 *   · /iran/buy/rate           → the public USDT/TMN reference (fa only)
 *
 * So the world gauges, the weather stations, the 3-D globe, the radar, the
 * flow map, the future tree, the challenger and the DNA panels cost ZERO extra
 * requests on refresh — the upgrade adds surface, not traffic. The single
 * exception is the causal tab, which asks the server's OWN macro-graph engine
 * once, lazily, the first time it is opened (that endpoint reuses the server's
 * cached snapshot, so it does not re-dial upstream providers either) — and it
 * falls back to a local chain built from the same pass when the request fails.
 *
 * HONESTY RULES (the same ones the rest of this screen lives by):
 *   · a metric whose input was not read returns status 'unread' — never a
 *     plausible number;
 *   · weights, priors and scenario percentages are labelled as MODEL, and the
 *     rows that fed them are listed next to them;
 *   · proxy readings (e.g. copper as a growth proxy for China) say they are
 *     proxies;
 *   · a Persian label never wraps an English sentence when a Persian pair
 *     exists in the payload (nameFa / evidenceFa / titleFa).
 *
 * ─── WHAT THE 2026-10 UPGRADE ADDED ────────────────────────────────────────
 * The model grew a second layer on the SAME inputs:
 *   WEATHER_STATIONS   financial weather stations with animated glyphs
 *   buildClimate       the pass's overall climate index + its components
 *   buildGlobeModel    3-D globe data: 40+ economies, mechanisms, arcs
 *   buildRadarV2       (buildRadar) sector + severity radar with full tape
 *   buildTransmission  the macro transmission chain with real readings
 *   buildCapitalFlow   the capital route + measured flow leaders
 *   buildOutlookReading server outlook + a labelled LOCAL complement
 *   buildDomainsView   every field each domain actually returned
 *   buildProvidersView provider readiness rows for the providers tab
 */

import { resolveMarkets, bondReading, describeSource, QUALITY } from './resolve.js';
import { BENCH, BAND_WORD, QUALITY_META, LIQUIDITY_SCALE_USD, zOf, bandOf, toneFor, severityFor, summariseStations } from './calibration.js';
export { BENCH, BAND_WORD, QUALITY_META, summariseStations };
export { resolveMarkets, bondReading, describeSource, QUALITY };

/* ── tiny numeric helpers (no React, no DOM — node-testable) ────────────── */
export const num = (v) => (
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
);
export const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const signOf = (v) => (num(v) === null ? 'flat' : Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : 'flat');

/* ── Persian number shaping (pure: the same glyphs the screen prints) ───── */
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
export const faNum = (v) => String(v)
  .replace(/([0-9])\.([0-9])/g, '$1\u066b$2')
  .replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)])
  .replace(/-/g, '\u2212');
export const pctFa = (v, d = 2) => (num(v) === null ? '—' : `${Number(v) > 0 ? '+' : ''}${faNum(Number(v).toFixed(d))}\u066a`);
export const pctEn = (v, d = 2) => (num(v) === null ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);
/** $12.4M / −$840k — always with an explicit sign for direction reads. */
export const usdCompact = (v) => {
  const n = num(v);
  if (n === null) return '—';
  const sign = n < 0 ? '\u2212' : '+';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
};

/** «۱۱۵ میلیون دلار» — the Persian reader's money, signed with a true minus. */
export const usdFaCompact = (v, { signed = true } = {}) => {
  const n = num(v);
  if (n === null) return '—';
  const sign = n < 0 ? '\u2212' : (signed && n > 0 ? '+' : '');
  const a = Math.abs(n);
  const one = (x) => faNum(Number(x.toFixed(1)).toString());
  if (a >= 1e12) return `${sign}${one(a / 1e12)} تریلیون دلار`;
  if (a >= 1e9) return `${sign}${one(a / 1e9)} میلیارد دلار`;
  if (a >= 1e6) return `${sign}${one(a / 1e6)} میلیون دلار`;
  if (a >= 1e3) return `${sign}${faNum(Math.round(a / 1e3))} هزار دلار`;
  return `${sign}${faNum(Math.round(a))} دلار`;
};

/** Chain names the Persian reader knows by their Persian spelling. */
const CHAIN_FA = {
  ethereum: 'اتریوم', tron: 'ترون', solana: 'سولانا', bsc: 'بایننس اسمارت‌چین', 'binance': 'بایننس اسمارت‌چین',
  arbitrum: 'آربیتروم', base: 'بیس', polygon: 'پالیگان', avalanche: 'آوالانچ', optimism: 'آپتیمیسم',
  bitcoin: 'بیت‌کوین', ton: 'تون', sui: 'سویی', aptos: 'آپتوس', near: 'نیر', cardano: 'کاردانو',
  mantle: 'مانتل', linea: 'لینیا', scroll: 'اسکرول', zksync: 'زی‌کی‌سینک', blast: 'بلست', fantom: 'فانتوم'
};
export const chainFa = (name) => {
  const k = String(name || '').trim().toLowerCase();
  return CHAIN_FA[k] || String(name || '').trim();
};

/* ══════════════════════════════════════════════════════════════════════════
   INPUT EXTRACTION — the one place that knows where each number lives.
   ══════════════════════════════════════════════════════════════════════════ */

/** Pull the readable rows out of a payload section (flows uses status/OK). */
const okSection = (s) => (s && s.status === 'OK' ? s : null);
const okDomain = (d) => (d && d.status === 'OK' ? d : null);
const domainData = (d) => (d && typeof d === 'object' && d.status === 'OK' ? d.data : null);
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * @param {object} data  the panel state: { intelligence, briefing, cross,
 *                       flows, toman, goldEtfs } where `cross` is the
 *                       crossAsset envelope itself.
 */
export function extractWorldInputs(data = {}) {
  const cross = data.cross || null;
  const domains = data.intelligence?.domains || data.domains || null;
  const classes = cross?.classes || {};

  /* Macro indicators keyed by symbol — the desk's real quotes. They live in TWO
     places of the same pass (the cross-asset envelope and the macro domain);
     either one alone used to be enough to blank a concept when the other was
     missing, so both are read and the first reading of a symbol wins. */
  const macroDomForQuotes = domainData(domains?.macro);
  const indicators = arr(cross?.macro?.indicators)
    .concat(arr(macroDomForQuotes?.instruments).length ? arr(macroDomForQuotes.instruments) : arr(macroDomForQuotes?.quotes));
  const ind = {};
  for (const q of indicators) {
    const sym = String(q?.symbol || '').toUpperCase();
    if (!sym) continue;
    const have = ind[sym];
    const hasChange = (v) => num(v?.change1dPct ?? v?.change24hPct) !== null;
    if (!have || (!hasChange(have) && hasChange(q))) {
      ind[sym] = { ...q, change1dPct: num(q.change1dPct ?? q.change24hPct) };
    }
  }
  const curve = (cross?.macro?.curve && num(cross.macro.curve.spreadPct) !== null ? cross.macro.curve : null)
    || (macroDomForQuotes?.curve && num(macroDomForQuotes.curve.spreadPct) !== null ? macroDomForQuotes.curve : null);

  const crypto = classes.crypto || null;
  const stocks = classes.stocks || null;
  const forex = classes.forex || null;
  const commodities = classes.commodities || null;
  const rwa = classes.rwa || null;

  const flows = data.flows || null;
  const tokenFlows = okSection(flows?.tokenFlows);
  const chainFlows = okSection(flows?.chainFlows);
  const profitLeaders = okSection(flows?.profitLeaders);

  const smEnvelope = domains?.smart_money || null;
  const whalesEnvelope = domains?.whales || null;
  const onchainEnvelope = domains?.onchain || null;
  const newsEnvelope = domains?.news || null;
  const macroEnvelope = domains?.macro || null;
  const rwaEnvelope = domains?.rwa || null;

  const sm = domainData(smEnvelope);
  const whales = domainData(whalesEnvelope);
  const onchain = domainData(onchainEnvelope);
  const newsDom = domainData(newsEnvelope);
  const macroDom = domainData(macroEnvelope);
  const rwaDom = domainData(rwaEnvelope);

  const stocksInstruments = arr(domainData(domains?.stocks)?.instruments);
  const forexInstruments = arr(domainData(domains?.forex)?.instruments);
  const commoditiesInstruments = arr(domainData(domains?.commodities)?.instruments);
  const rwaInstruments = arr(rwaDom?.instruments);
  const macroQuotes = arr(macroDom?.instruments).length ? arr(macroDom.instruments) : arr(macroDom?.quotes);

  const regime = String(cross?.regime?.regime || '').toUpperCase();
  const outlook = cross?.outlook || null;
  const divergences = arr(cross?.divergences);
  const briefingItems = arr(data.briefing?.items);

  /* ─── RESOLVE EVERY CONCEPT FROM EVERY PLACE THAT CARRIES IT ────────────
     Gold, the dollar, the bonds, crude, copper and the equity index each get
     an ordered list of places to look (see resolve.js). The result keeps the
     quote shape every panel already reads, plus `quality` — measured / proxy /
     level / stale — so no panel can print a proxy as if it were the thing. */
  const macroStale = macroDom?.stale === true || cross?.macro?.stale === true;
  const macroStaleAgeMs = num(macroDom?.staleAgeMs) ?? num(cross?.macro?.staleAgeMs);
  const raw = {
    ind, cross, macroDom, tokenFlows, goldEtfs: data.goldEtfs || null,
    forexInstruments, commoditiesInstruments, rwaInstruments, stocksInstruments,
    macroStale, macroStaleAgeMs
  };
  const resolved = resolveMarkets(raw);
  const bySymbol = {
    DXY: resolved.dxy, GOLD: resolved.gold, XAU: resolved.gold, XAUUSD: resolved.gold,
    SILVER: resolved.silver, XAG: resolved.silver, WTI: resolved.wti, CL: resolved.wti,
    BRENT: resolved.brent, BRN: resolved.brent, COPPER: resolved.copper, HG: resolved.copper, XCU: resolved.copper,
    SPX: resolved.spx, SPY: resolved.spx, QQQ: resolved.spx, NDX: resolved.spx,
    US10Y: resolved.us10y, US2Y: resolved.us2y, US30Y: resolved.us30y, TLT: resolved.tlt
  };
  const findInd = (syms) => {
    for (const s of syms) {
      const k = String(s).toUpperCase();
      if (bySymbol[k]) return bySymbol[k];
      if (ind[k]) return ind[k];
    }
    return null;
  };
  const { dxy, gold, wti, brent, spx, us10y, us2y, copper } = resolved;
  const bond = bondReading(resolved, curve);

  return {
    cross, domains, classes, indicators, ind, findInd,
    dxy, gold, wti, brent, spx, us10y, us2y, copper, curve,
    silver: resolved.silver, us30y: resolved.us30y, tlt: resolved.tlt,
    btc: resolved.btc, eth: resolved.eth, fx: resolved.fx, resolved, bond,
    macroStale, macroStaleAgeMs,
    crypto, stocks, forex, commodities, rwa,
    tokenFlows, chainFlows, profitLeaders,
    sm, whales, onchain, newsDom, macroDom, rwaDom,
    stocksInstruments, forexInstruments, commoditiesInstruments, rwaInstruments, macroQuotes,
    /* envelope-level honesty fields (status + reason + freshness) */
    envel: {
      smart_money: smEnvelope, whales: whalesEnvelope, onchain: onchainEnvelope,
      news: newsEnvelope, macro: macroEnvelope, rwa: rwaEnvelope,
      stocks: domains?.stocks || null, forex: domains?.forex || null, commodities: domains?.commodities || null
    },
    regime, outlook, divergences, briefingItems,
    missingDomains: arr(data.intelligence?.missing),
    available: num(data.intelligence?.available),
    coverage: num(data.intelligence?.coverage),
    providers: data.providers || data.intelligence?.providers || null,
    toman: data.toman || null, goldEtfs: data.goldEtfs || null
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1) FBT WORLD STATE — nine live gauges
   ──────────────────────────────────────────────────────────────────────────
   A GLOBAL FINANCIAL STATE board: Liquidity ↑, Risk MEDIUM, … Each row is
   computed from observations of THIS pass; the `evidence` array names exactly
   what fed it, so the board can never show a direction it cannot justify.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildWorldState(data = {}) {
  const x = extractWorldInputs(data);
  const metrics = [];
  const push = (m) => metrics.push(m);

  /* 1 — Liquidity: real stablecoin net flow (mint = money in) plus the
     labelled smart-money net when either was read. */
  {
    const stableNet = num(x.chainFlows?.net24hUsd);
    const smNet = smartMoneyNet(x);
    const basis = stableNet !== null ? stableNet : smNet;
    push({
      id: 'liquidity', icon: 'drop', kind: 'dir',
      status: basis === null ? 'unread' : 'ok',
      dir: basis === null ? 'flat' : signOf(basis),
      meter: basis === null ? 0 : clamp(Math.abs(basis) / 250_000_000, 0.08, 1),
      valueUsd: basis,
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
    const net = smartMoneyNet(x);
    push({
      id: 'institutional', icon: 'building', kind: 'dir',
      status: net === null ? 'unread' : 'ok',
      dir: net === null ? 'flat' : signOf(net),
      meter: net === null ? 0 : clamp(Math.abs(net) / 5_000_000, 0.08, 1),
      valueUsd: net,
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
    const inst = x.rwaInstruments;
    const ch = inst.map((i) => num(i.change24hPct)).filter((v) => v !== null);
    const avg = ch.length ? ch.reduce((a, c) => a + c, 0) / ch.length : null;
    const rwaVal = avg ?? num(x.rwa?.avgChangePct);
    const rwaOk = Boolean(x.rwaDom) || (x.rwa && num(x.rwa.avgChangePct) !== null);
    push({
      id: 'rwa', icon: 'layers', kind: 'dir',
      status: rwaOk ? 'ok' : 'unread',
      dir: signOf(rwaVal),
      meter: rwaVal !== null ? clamp(Math.abs(rwaVal) / 2, 0.08, 1) : (rwaOk ? 0.08 : 0),
      valuePct: rwaVal,
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

/**
 * Labelled smart-money net, or null.
 * The server's own `netFlowUsd` wins when present — it is the scanner's
 * headline number and re-deriving it from accumulation − distribution can
 * disagree (different windows). Only when the explicit net is absent is the
 * difference computed, and only when BOTH sides were read.
 */
export function smartMoneyNet(x) {
  if (!x?.sm) return null;
  const explicit = num(x.sm.netFlowUsd);
  if (explicit !== null) return round(explicit);
  const a = num(x.sm.accumulationUsd); const d = num(x.sm.distributionUsd);
  if (a === null || d === null) return null;
  return round(a - d);
}

/* ══════════════════════════════════════════════════════════════════════════
   2) FINANCIAL WEATHER — the same readings, forecast-style.
   ══════════════════════════════════════════════════════════════════════════ */

/** Legacy hourly strip (kept: other surfaces and tests read these ids). */
export function buildWeather(data = {}) {
  const x = extractWorldInputs(data);
  const rows = [];

  const stableNet = num(x.chainFlows?.net24hUsd);
  rows.push({
    id: 'liquidity', tone: stableNet === null ? 'na' : stableNet > 0 ? 'sun' : 'rain',
    icon: stableNet === null ? 'cloud' : stableNet > 0 ? 'sun' : 'rain',
    value: stableNet, source: 'defillama'
  });

  const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
  const spread = avgs.length ? Math.max(...avgs.map(Math.abs)) : null;
  rows.push({
    id: 'volatility',
    tone: spread === null ? 'na' : spread >= 2 ? 'storm' : spread >= 0.7 ? 'partly' : 'sun',
    icon: spread === null ? 'cloud' : spread >= 2 ? 'storm' : spread >= 0.7 ? 'partly' : 'sun',
    value: spread, source: 'cross-asset-engine'
  });

  const wCount = num(x.whales?.count);
  const smNet = smartMoneyNet(x);
  rows.push({
    id: 'whales',
    tone: wCount === null && smNet === null ? 'na' : (smNet !== null && smNet < 0 ? 'storm' : wCount !== null && wCount > 10 ? 'partly' : 'sun'),
    icon: smNet !== null && smNet < 0 ? 'storm' : 'wavesIcon',
    value: wCount, source: 'whales:scanner'
  });

  const outlookLabel = String(x.outlook?.label || '');
  rows.push({
    id: 'macro',
    tone: outlookLabel === 'RECESSION_WATCH' ? 'rain' : outlookLabel === 'GROWTH_WATCH' ? 'sun' : outlookLabel ? 'partly' : 'na',
    icon: outlookLabel === 'RECESSION_WATCH' ? 'rain' : outlookLabel === 'GROWTH_WATCH' ? 'sun' : 'wind',
    value: outlookLabel || null, source: 'cross-asset-engine'
  });

  const down = num(x.onchain?.downSources); const totalSrc = arr(x.onchain?.sources).length;
  rows.push({
    id: 'chains',
    tone: !x.onchain ? 'na' : down > 0 ? 'rain' : totalSrc ? 'sun' : 'partly',
    icon: down > 0 ? 'rain' : 'sun',
    value: x.onchain ? `${x.onchain.healthySources ?? 0}/${totalSrc}` : null, source: 'chainIntel'
  });

  const dxyChg = num(x.dxy?.change1dPct);
  rows.push({
    id: 'dollarWind',
    tone: dxyChg === null ? 'na' : Math.abs(dxyChg) >= 0.7 ? 'windy' : 'partly',
    icon: 'wind', value: dxyChg, source: x.dxy?.source || null
  });

  const nCount = num(x.newsDom?.count);
  rows.push({
    id: 'news',
    tone: nCount === null ? 'na' : nCount >= 20 ? 'partly' : 'sun',
    icon: 'newsIcon', value: nCount, source: 'news-engine'
  });

  return rows;
}

/* ── the WEATHER STATION model (the animated forecast board) ───────────────
   Every station states its own reading, its unit, its evidence rows and the
   provider that answered. `tone` drives the animated glyph; `severity` (0-1)
   drives the dial needle; `na` means the pass did not read it. */

/** tone ladder for the animated glyphs */
export const WEATHER_TONES = Object.freeze(['sun', 'partly', 'cloud', 'rain', 'storm', 'windy', 'na']);

export const STATION_META = Object.freeze({
  climate: { fa: 'اقلیم کلان', en: 'Macro climate' },
  institutional: { fa: 'جریان نهادی', en: 'Institutional flow' },
  dollar: { fa: 'قدرت دلار', en: 'Dollar strength' },
  inflation: { fa: 'فشار تورم (انرژی)', en: 'Inflation pressure (energy)' },
  risk: { fa: 'ریسک جهانی', en: 'Global risk' },
  gold: { fa: 'طلا (پناهگاه امن)', en: 'Gold (safe haven)' },
  bonds: { fa: 'اوراق خزانه', en: 'Treasury bonds' },
  equity: { fa: 'سهام آمریکا', en: 'US equities' },
  liquidity: { fa: 'نقدینگی استیبل‌کوین', en: 'Stablecoin liquidity' },
  volatility: { fa: 'تلاطم', en: 'Volatility' },
  whales: { fa: 'فعالیت نهنگ‌ها', en: 'Whale activity' },
  chains: { fa: 'جریان بین زنجیره‌ها', en: 'Chain flows' },
  news: { fa: 'دمای خبر', en: 'News temperature' },
  rwa: { fa: 'پذیرش RWA', en: 'RWA adoption' },
  crypto: { fa: 'گستردگی رمزارز', en: 'Crypto breadth' }
});

/** Readable condition words per tone, both languages. */
export const TONE_WORD = Object.freeze({
  sun: { fa: 'صاف', en: 'clear' },
  partly: { fa: 'نیمه‌ابری', en: 'partly cloudy' },
  cloud: { fa: 'ابری', en: 'cloudy' },
  rain: { fa: 'بارانی', en: 'rain' },
  storm: { fa: 'طوفانی', en: 'storm' },
  windy: { fa: 'تندباد', en: 'windy' },
  na: { fa: 'خوانده نشد', en: 'unread' }
});

function station(o) {
  const tone = o.tone || 'na';
  return {
    id: o.id, icon: o.icon, tone,
    severity: tone === 'na' ? null : clamp(o.severity ?? 0.5, 0, 1),
    valueText: o.valueText ?? null, valueTextFa: o.valueTextFa ?? null,
    evidence: (o.evidence || []).filter(Boolean),
    source: o.source || null,
    noteFa: o.noteFa || null, noteEn: o.noteEn || null,
    /* calibration + provenance (see calibration.js / resolve.js) */
    quality: o.quality || (tone === 'na' ? null : QUALITY.MEASURED),
    unitFa: o.unitFa || null, unitEn: o.unitEn || null,
    basisFa: o.basisFa || null, basisEn: o.basisEn || null,
    z: o.z ?? null, sigma: o.sigma ?? null, band: o.band || null,
    readFa: o.readFa || null, readEn: o.readEn || null
  };
}

const fmtLevel = (v, fa = false) => {
  const n = num(v);
  if (n === null) return null;
  const text = n >= 1000 ? Math.round(n).toLocaleString('en-US') : n >= 100 ? n.toFixed(1) : n.toFixed(2);
  return fa ? faNum(text).replace(/,/g, '\u066c') : text;
};

/** one market station, read against its own benchmark */
function marketStation({ id, icon, kind, bench, q, note, sourceOf }) {
  const B = BENCH[bench];
  const move = num(q?.change1dPct);
  const quality = q?.quality || null;
  if (!q || (move === null && num(q?.priceUsd) === null)) {
    return station({ id, icon, tone: 'na', evidence: [] });
  }
  if (move === null) {
    /* a price with no move: shown, never coloured, never counted as valid */
    return station({
      id, icon, tone: 'na', quality: QUALITY.LEVEL,
      valueText: fmtLevel(q.priceUsd), valueTextFa: fmtLevel(q.priceUsd, true),
      evidence: [{ key: `${id}Price`, value: round(q.priceUsd, 2) }],
      source: sourceOf ? sourceOf(q) : q.source,
      noteFa: 'فقط قیمت خوانده شد؛ تغییر روزانه در این دور نرسید.', noteEn: 'only the level was read; no daily move this pass.'
    });
  }
  const z = zOf(move, B.sigma);
  const band = bandOf(z);
  const tone = toneFor(kind, z);
  return station({
    id, icon, tone, severity: severityFor(z),
    valueText: pctEn(move), valueTextFa: pctFa(move),
    evidence: [
      { key: `${id}1d`, value: move },
      num(q.change7dPct) !== null ? { key: `${id}7d`, value: q.change7dPct } : null,
      num(q.priceUsd) !== null ? { key: `${id}Price`, value: round(q.priceUsd, 2) } : null
    ],
    source: sourceOf ? sourceOf(q) : q.source,
    noteFa: note?.fa?.(move) || null, noteEn: note?.en?.(move) || null,
    quality, basisFa: q.basisFa, basisEn: q.basisEn,
    z: round(z, 2), sigma: B.sigma, band,
    readFa: `${faNum(Math.abs(z).toFixed(1))} برابر نوسان معمول · ${BAND_WORD[band].fa}`,
    readEn: `${Math.abs(z).toFixed(1)}× a normal day · ${BAND_WORD[band].en}`
  });
}

/**
 * The station board, CALIBRATED. Order = importance: the headline measures
 * first (institutional flow, dollar, gold, bonds, energy, risk), then the
 * markets and the on-chain / news stations. Every market station carries the
 * z-score of its own move against its own typical day.
 */
export function buildWeatherStations(data = {}) {
  const x = extractWorldInputs(data);
  const out = [];

  /* institutional flow — labelled smart money, or the whale-transfer proxy */
  {
    const net = smartMoneyNet(x);
    const acc = num(x.sm?.accumulationUsd); const dist = num(x.sm?.distributionUsd);
    const proxy = x.sm?.whaleTransferProxy || null;
    const pAcc = num(proxy?.accumulationUsd); const pDist = num(proxy?.distributionUsd);
    const pNet = pAcc !== null && pDist !== null ? pAcc - pDist : null;
    if (net !== null) {
      const tone = net > 0 ? 'sun' : net < -1_000_000 ? 'storm' : 'rain';
      out.push(station({
        id: 'institutional', icon: net > 0 ? 'sun' : 'rain', tone,
        severity: clamp(Math.abs(net) / 8_000_000, 0.15, 1),
        valueText: usdCompact(net), valueTextFa: usdFaCompact(net),
        evidence: [acc !== null ? { key: 'smartMoneyAcc', value: acc } : null, dist !== null ? { key: 'smartMoneyDist', value: dist } : null,
          x.sm?.window ? { key: 'window', value: x.sm.window } : null],
        source: x.envel.smart_money?.source || 'smartMoney:overview', quality: QUALITY.MEASURED,
        noteFa: net > 0 ? 'انباشت برچسب‌دار بیشتر از توزیع است.' : 'توزیع برچسب‌دار بیشتر از انباشت است.',
        noteEn: net > 0 ? 'labelled accumulation exceeds distribution.' : 'labelled distribution exceeds accumulation.'
      }));
    } else if (pNet !== null) {
      /* the verified index had too little evidence; the descriptive transfer
         overview is shown AS a proxy — never coloured as a vote */
      out.push(station({
        id: 'institutional', icon: 'cloud', tone: 'cloud', severity: clamp(Math.abs(pNet) / 300_000_000, 0.15, 1),
        valueText: usdCompact(pNet), valueTextFa: usdFaCompact(pNet),
        evidence: [{ key: 'smartMoneyAcc', value: pAcc }, { key: 'smartMoneyDist', value: pDist }, x.sm?.window ? { key: 'window', value: x.sm.window } : null],
        source: x.envel.smart_money?.source || 'smartMoney:overview', quality: QUALITY.PROXY,
        basisFa: 'تراز انتقال نهنگ‌ها؛ توصیفی است، نه معاملهٔ تأییدشده', basisEn: 'whale-transfer balance; descriptive, not verified trades',
        noteFa: 'شاخص تأییدشده شواهد کافی نداشت؛ این عدد فقط توصیف انتقال‌هاست و در جمع‌بندی اقلیم رأی نمی‌دهد.',
        noteEn: 'the verified index had too little evidence; this is descriptive transfer flow and does not vote in the climate.'
      }));
    } else {
      out.push(station({ id: 'institutional', icon: 'bank', tone: 'na' }));
    }
  }

  /* dollar */
  out.push(marketStation({
    id: 'dollar', icon: 'wind', kind: 'headwind-up', bench: 'dollar', q: x.dxy,
    note: {
      fa: (v) => (v > 0 ? 'دلار قوی معمولاً به دارایی‌های پرریسک فشار می‌آورد.' : 'دلار ضعیف معمولاً نقدینگی ریسک را آزاد می‌کند.'),
      en: (v) => (v > 0 ? 'a firm dollar usually pressures risk assets.' : 'a softer dollar usually frees risk liquidity.')
    }
  }));

  /* gold */
  out.push(marketStation({
    id: 'gold', icon: 'shield', kind: 'haven', bench: 'gold', q: x.gold,
    note: {
      fa: (v) => (v > 0 ? 'طلای بالارونده یعنی تقاضای پناهگاه امن.' : 'طلای پایین‌رونده یعنی فشار پناهگاه امن کم شده.'),
      en: (v) => (v > 0 ? 'rising gold means safe-haven demand.' : 'falling gold means the haven bid is easing.')
    }
  }));

  /* bonds */
  {
    const b = x.bond;
    if (!b) {
      out.push(station({ id: 'bonds', icon: 'bank', tone: 'na' }));
    } else if (b.yieldBp === null) {
      out.push(station({
        id: 'bonds', icon: 'bank', tone: 'na', quality: QUALITY.LEVEL,
        valueText: `${b.level}%`, valueTextFa: `${faNum(b.level)}\u066a`,
        evidence: [{ key: 'yieldLevel', value: b.level }], source: b.source,
        noteFa: 'فقط سطح بازده خوانده شد؛ تغییر روزانه نرسید.', noteEn: 'only the yield level was read; no daily change.'
      }));
    } else {
      const B = BENCH.bonds;
      const z = zOf(b.yieldBp, B.sigma);
      const band = bandOf(z);
      const sign = b.yieldBp > 0 ? '+' : b.yieldBp < 0 ? '\u2212' : '';
      const abs = Math.abs(b.yieldBp).toFixed(1);
      const isYield = b.kind === 'yield';
      out.push(station({
        id: 'bonds', icon: 'bank', tone: toneFor('headwind-up', z), severity: severityFor(z),
        valueText: isYield ? `${b.yieldBp > 0 ? '+' : b.yieldBp < 0 ? '-' : ''}${abs}bp` : `\u2248 ${b.yieldBp > 0 ? '+' : b.yieldBp < 0 ? '-' : ''}${abs}bp`,
        valueTextFa: isYield ? `${sign}${faNum(abs)} bp` : `\u2248 ${sign}${faNum(abs)} bp`,
        evidence: [
          isYield && b.level !== null ? { key: 'yieldLevel', value: b.level } : null,
          !isYield ? { key: 'tlt1d', value: b.movePct } : null,
          x.curve ? { key: 'curve2s10s', value: x.curve.spreadPct } : null,
          num(x.us10y?.change7dPct) !== null ? { key: 'bonds7d', value: x.us10y.change7dPct } : null
        ],
        source: b.source, quality: b.quality,
        basisFa: isYield ? null : 'صندوق اوراق بلندمدت TLT؛ بازده تقریباً با دیرش ۱۶٫۵ سال تخمین زده می‌شود',
        basisEn: isYield ? null : 'long-bond ETF TLT; the yield move is estimated with a ~16.5y duration',
        noteFa: b.dir === 'up' ? 'بازده بالارونده یعنی انقباض مالی و فشار روی دارایی‌های پرریسک.' : b.dir === 'down' ? 'بازده پایین‌رونده یعنی شرایط مالی آسان‌تر.' : null,
        noteEn: b.dir === 'up' ? 'rising yields tighten financial conditions.' : b.dir === 'down' ? 'falling yields ease financial conditions.' : null,
        z: round(z, 2), sigma: B.sigma, band,
        readFa: `${faNum(Math.abs(z).toFixed(1))} برابر نوسان معمول · ${BAND_WORD[band].fa}${isYield ? '' : ' (تخمینی)'}`,
        readEn: `${Math.abs(z).toFixed(1)}× a normal day · ${BAND_WORD[band].en}${isYield ? '' : ' (estimated)'}`
      }));
    }
  }

  /* energy / inflation pressure */
  {
    const parts = [x.wti, x.brent].filter((q) => q && num(q.change1dPct) !== null);
    const levelOnly = [x.wti, x.brent].find((q) => q && num(q.priceUsd) !== null);
    if (!parts.length) {
      out.push(levelOnly
        ? marketStation({ id: 'inflation', icon: 'flame', kind: 'headwind-up', bench: 'oil', q: levelOnly })
        : station({ id: 'inflation', icon: 'flame', tone: 'na' }));
    } else {
      const avg = parts.reduce((a, q) => a + q.change1dPct, 0) / parts.length;
      const worst = parts.some((q) => q.quality === QUALITY.STALE) ? QUALITY.STALE : parts.every((q) => q.quality === QUALITY.MEASURED) ? QUALITY.MEASURED : QUALITY.PROXY;
      const synth = { ...parts[0], change1dPct: round(avg), quality: worst, change7dPct: num(x.wti?.change7dPct), priceUsd: num(x.wti?.priceUsd) ?? num(x.brent?.priceUsd), source: parts.map((q) => q.source).filter(Boolean)[0] };
      const st = marketStation({
        id: 'inflation', icon: 'flame', kind: 'headwind-up', bench: 'oil', q: synth,
        note: { fa: () => 'پروکسی انرژی برای انتظارات تورمی — نه خود شاخص تورم.', en: () => 'energy is a proxy for inflation expectations — not the CPI itself.' }
      });
      st.evidence = [
        num(x.wti?.change1dPct) !== null ? { key: 'wti1d', value: num(x.wti.change1dPct) } : null,
        num(x.brent?.change1dPct) !== null ? { key: 'brent1d', value: num(x.brent.change1dPct) } : null,
        num(x.wti?.change7dPct) !== null ? { key: 'wti7d', value: num(x.wti.change7dPct) } : null
      ].filter(Boolean);
      out.push(st);
    }
  }

  /* global risk */
  {
    const score = num(x.outlook?.score);
    const label = String(x.outlook?.label || '');
    const level = label === 'RECESSION_WATCH' ? 'storm' : label === 'GROWTH_WATCH' ? 'sun'
      : x.regime.includes('RISK_OFF') ? 'rain' : x.regime.includes('RISK_ON') ? 'sun' : label ? 'cloud' : x.regime ? 'cloud' : 'na';
    const sev = level === 'storm' ? 0.9 : level === 'rain' ? 0.68 : level === 'cloud' ? 0.5 : level === 'sun' ? 0.22 : null;
    out.push(station({
      id: 'risk', icon: level === 'na' ? 'shield' : level === 'storm' ? 'storm' : level === 'rain' ? 'rain' : level === 'sun' ? 'sun' : 'cloud',
      tone: level, severity: sev,
      valueText: label || (x.regime || null),
      valueTextFa: label ? OUTLOOK_LABEL_FA[label] || label : (x.regime ? (REGIME_FA[x.regime] || null) : null),
      evidence: [x.regime ? { key: 'regime', value: REGIME_FA[x.regime] || x.regime } : null, score !== null ? { key: 'outlookScore', value: score } : null,
        x.curve ? { key: 'curve2s10s', value: x.curve.spreadPct } : null],
      source: 'cross-asset-engine',
      noteFa: label === 'RECESSION_WATCH' ? 'مدل، هشدار رکود می‌خواند.' : label === 'GROWTH_WATCH' ? 'مدل، رشد را می‌خواند.' : null,
      noteEn: label === 'RECESSION_WATCH' ? 'the model reads a recession watch.' : label === 'GROWTH_WATCH' ? 'the model reads a growth watch.' : null
    }));
  }

  /* equities */
  out.push(marketStation({
    id: 'equity', icon: 'thermometer', kind: 'tailwind-up', bench: 'equity', q: x.spx,
    note: {
      fa: (v) => (v > 0 ? 'سهام صعودی یعنی اشتهای ریسک سالم است.' : 'سهام نزولی یعنی اشتهای ریسک کم شده.'),
      en: (v) => (v > 0 ? 'rising equities mean healthy risk appetite.' : 'falling equities mean risk appetite is fading.')
    }
  }));

  /* crypto: the class average, the BTC anchor as its fallback, and the
     breadth of the whole top-250 as the temperature reading */
  {
    const avg = num(x.crypto?.avgChangePct);
    const btc = x.btc;
    const q = avg !== null
      ? { symbol: 'CRYPTO', change1dPct: avg, quality: QUALITY.MEASURED, source: 'cross-asset-engine', priceUsd: null }
      : (btc && num(btc.change1dPct) !== null
        ? { symbol: 'BTC', change1dPct: btc.change1dPct, change7dPct: btc.change7dPct, priceUsd: btc.priceUsd, quality: QUALITY.PROXY, source: 'coingecko', basisFa: 'بیت‌کوین به‌جای میانگین کلاس رمزارز', basisEn: 'bitcoin stands in for the crypto-class average' }
        : null);
    const st = marketStation({
      id: 'crypto', icon: 'coin', kind: 'tailwind-up', bench: 'crypto', q,
      note: { fa: (v) => (v > 0 ? 'بازار رمزارز صعودی است.' : 'بازار رمزارز نزولی است.'), en: (v) => (v > 0 ? 'the crypto market is rising.' : 'the crypto market is falling.') }
    });
    const br = x.tokenFlows?.breadth || null;
    const cl = x.crypto || null;
    st.evidence = [
      avg !== null ? { key: 'classAvg', value: avg } : null,
      br ? { key: 'breadthShare', value: `${br.advancing}/${br.count}` } : (cl?.advancing !== undefined ? { key: 'advancing', value: `${cl.advancing}/${cl.withChange ?? cl.instruments ?? ''}` } : null),
      btc && num(btc.change1dPct) !== null ? { key: 'btc1d', value: btc.change1dPct } : null,
      x.eth && num(x.eth.change1dPct) !== null ? { key: 'eth1d', value: x.eth.change1dPct } : null
    ].filter(Boolean);
    out.push(st);
  }

  /* stablecoin liquidity */
  {
    const stableNet = num(x.chainFlows?.net24hUsd);
    const pctv = num(x.chainFlows?.net24hPct);
    out.push(station({
      id: 'liquidity', icon: stableNet === null ? 'drop' : stableNet > 0 ? 'sun' : 'rain',
      tone: stableNet === null ? 'na' : stableNet > 0 ? 'sun' : stableNet < -50_000_000 ? 'storm' : 'rain',
      severity: stableNet === null ? null : clamp(Math.abs(stableNet) / 300_000_000, 0.12, 1),
      valueText: stableNet === null ? null : usdCompact(stableNet).replace('+', ''),
      valueTextFa: stableNet === null ? null : usdFaCompact(stableNet, { signed: false }),
      evidence: [stableNet !== null ? { key: 'stablecoinNet', value: stableNet } : null, pctv !== null ? { key: 'stablecoinNetPct', value: pctv } : null],
      source: 'defillama',
      noteFa: stableNet === null ? null : 'تغییر عرضهٔ استیبل‌کوین = ورود/خروج دلار به زنجیره‌ها.',
      noteEn: stableNet === null ? null : 'stablecoin supply delta = dollars entering/leaving chains.'
    }));
  }

  /* volatility: how violent the markets above were, in units of a normal day */
  {
    const zs = out.filter((st) => st.z !== null && st.z !== undefined).map((st) => Math.abs(st.z));
    if (zs.length >= 3) {
      const mean = zs.reduce((a, c) => a + c, 0) / zs.length;
      const tone = mean < 0.7 ? 'sun' : mean < 1.3 ? 'partly' : mean < 2 ? 'cloud' : mean < 2.7 ? 'rain' : 'storm';
      const band = bandOf(mean);
      out.push(station({
        id: 'volatility', icon: tone === 'storm' || tone === 'rain' ? 'storm' : tone === 'sun' ? 'sun' : 'pulse', tone,
        severity: severityFor(mean),
        valueText: `×${mean.toFixed(1)}`, valueTextFa: `\u00d7${faNum(mean.toFixed(1))}`,
        evidence: [{ key: 'marketsRead', value: zs.length }, { key: 'maxZ', value: round(Math.max(...zs), 1) }],
        source: 'calibration',
        readFa: `میانگین حرکت ${faNum(zs.length)} بازار نسبت به نوسان معمول · ${BAND_WORD[band].fa}`,
        readEn: `average move of ${zs.length} markets vs a normal day · ${BAND_WORD[band].en}`,
        z: round(mean, 2), band, quality: QUALITY.MEASURED,
        noteFa: 'میانگین قدر مطلق z-score بازارهای بالا؛ نه شاخص VIX.', noteEn: 'mean absolute z-score of the markets above; not the VIX.'
      }));
    } else {
      out.push(station({ id: 'volatility', icon: 'pulse', tone: 'na' }));
    }
  }

  /* whales */
  {
    const count = num(x.whales?.count);
    const smNet = smartMoneyNet(x);
    const tone = count === null && smNet === null ? 'na' : (smNet !== null && smNet < 0) ? 'storm' : count !== null && count > 10 ? 'partly' : 'sun';
    const top = arr(x.whales?.events).slice().sort((a, b) => (num(b.valueUsd) || 0) - (num(a.valueUsd) || 0))[0];
    out.push(station({
      id: 'whales', icon: tone === 'storm' ? 'storm' : 'waves', tone,
      severity: count === null ? null : clamp(count / 25, 0.15, 1),
      valueText: count === null ? null : String(count),
      valueTextFa: count === null ? null : faNum(count), unitFa: 'رویداد', unitEn: 'events',
      evidence: [count !== null ? { key: 'whaleEvents', value: count } : null,
        top ? { key: 'topWhale', value: `${top.symbol} ${usdCompact(top.valueUsd).replace('+', '')}`, valueFa: `${top.symbol} ${usdFaCompact(top.valueUsd, { signed: false })}` } : null,
        smNet !== null ? { key: 'smartMoneyNet', value: smNet } : null],
      source: 'whales:scanner'
    }));
  }

  /* chains: stablecoin movement BETWEEN chains (DefiLlama), or the health
     ledger when it carries rows — never «۰/۰» */
  {
    const healthy = num(x.onchain?.healthySources); const totalSrc = arr(x.onchain?.sources).length;
    const down = num(x.onchain?.downSources) || 0;
    const cf = x.chainFlows;
    const topIn = cf?.topInflowChain || arr(cf?.chainInflows)[0] || null;
    const topOut = arr(cf?.chainOutflows)[0] || null;
    if (topIn && num(topIn.net24hUsd) !== null) {
      const inV = usdCompact(topIn.net24hUsd).replace('+', '');
      out.push(station({
        id: 'chains', icon: 'cloud', tone: down > 0 ? 'rain' : 'sun', severity: clamp(Math.abs(topIn.net24hUsd) / 700_000_000, 0.15, 1),
        valueText: `${topIn.chain} ${inV}`, valueTextFa: `${chainFa(topIn.chain)} ${usdFaCompact(topIn.net24hUsd, { signed: false })}`,
        evidence: [{ key: 'topInflowChain', value: `${topIn.chain} ${inV}`, valueFa: `${chainFa(topIn.chain)} ${usdFaCompact(topIn.net24hUsd, { signed: false })}` },
          topOut && num(topOut.net24hUsd) !== null ? { key: 'topOutflowChain', value: `${topOut.chain} ${usdCompact(topOut.net24hUsd).replace('+', '')}`, valueFa: `${chainFa(topOut.chain)} ${usdFaCompact(topOut.net24hUsd, { signed: false })}` } : null,
          totalSrc ? { key: 'healthySources', value: `${healthy ?? 0}/${totalSrc}` } : null],
        source: 'defillama',
        noteFa: 'بزرگ‌ترین ورود و خروج استیبل‌کوین بین زنجیره‌ها در ۲۴ ساعت.', noteEn: 'largest 24h stablecoin inflow and outflow between chains.'
      }));
    } else if (x.onchain && totalSrc) {
      out.push(station({
        id: 'chains', icon: down > 0 ? 'rain' : 'sun', tone: down > 0 ? 'rain' : 'sun', severity: clamp((healthy ?? 0) / totalSrc, 0.15, 1),
        valueText: `${healthy ?? 0}/${totalSrc}`, valueTextFa: `${faNum(healthy ?? 0)}/${faNum(totalSrc)}`,
        evidence: [{ key: 'healthySources', value: `${healthy}/${totalSrc}` }, down ? { key: 'downSources', value: down } : null],
        source: 'chainIntel'
      }));
    } else {
      out.push(station({ id: 'chains', icon: 'cloud', tone: 'na' }));
    }
  }

  /* news temperature */
  {
    const count = num(x.newsDom?.count);
    const classified = num(x.macroDom?.attention);
    const geo = num(x.macroDom?.byTopic?.GEOPOLITICS);
    const share = count && classified !== null ? classified / count : null;
    const tone = count === null ? 'na' : (geo !== null && geo >= 3) || (share !== null && share >= 0.2) ? 'partly' : 'sun';
    out.push(station({
      id: 'news', icon: 'news', tone, severity: count === null ? null : clamp(count / 40, 0.12, 1),
      valueText: count === null ? null : String(count), valueTextFa: count === null ? null : faNum(count), unitFa: 'خبر', unitEn: 'headlines',
      evidence: [count !== null ? { key: 'headlines', value: count } : null,
        classified !== null ? { key: 'macroHeadlines', value: classified } : null,
        geo !== null ? { key: 'geopoliticsTopic', value: geo } : null],
      source: 'news-engine'
    }));
  }

  /* real-world assets: the class average of the venue's own daily moves */
  {
    const inst = x.rwaInstruments;
    const ch = inst.map((i) => num(i.change24hPct)).filter((v) => v !== null);
    const avg = ch.length ? ch.reduce((a, c) => a + c, 0) / ch.length : null;
    if (avg !== null) {
      out.push(marketStation({
        id: 'rwa', icon: 'building', kind: 'tailwind-up', bench: 'rwa',
        q: { symbol: 'RWA', change1dPct: round(avg), quality: QUALITY.MEASURED, source: x.envel.rwa?.source || null, priceUsd: null },
        note: { fa: () => `میانگین ${faNum(ch.length)} ابزار از ${faNum(inst.length)}؛ تغییر هر ابزار از کندل روزانهٔ خود Ostium.`, en: () => `average of ${ch.length} of ${inst.length} instruments; each move from Ostium's own daily candle.` }
      }));
      out[out.length - 1].evidence = [{ key: 'avgChange', value: round(avg) }, { key: 'instruments', value: `${ch.length}/${inst.length}` }];
    } else {
      out.push(station({
        id: 'rwa', icon: 'building', tone: !x.rwaDom && !x.rwa ? 'na' : 'na', quality: inst.length ? QUALITY.LEVEL : null,
        valueText: inst.length ? String(inst.length) : null, valueTextFa: inst.length ? faNum(inst.length) : null,
        evidence: inst.length ? [{ key: 'instruments', value: inst.length }] : [], source: x.envel.rwa?.source || null,
        noteFa: inst.length ? 'قیمت‌ها خوانده شد؛ تغییر روزانه نرسید.' : null, noteEn: inst.length ? 'prices were read; no daily move this pass.' : null
      }));
    }
  }

  return out;
}

/** Climate-index component labels (the chips under the hero). */
export const CLIMATE_PART_META = Object.freeze({
  regime: { fa: 'حال‌وهوای کلاس‌ها', en: 'cross-class mood' },
  outlook: { fa: 'چشم‌انداز موتور', en: 'engine outlook' },
  dollar: { fa: 'فشار دلار', en: 'dollar pressure' },
  energy: { fa: 'انرژی/تورم', en: 'energy & inflation' },
  bonds: { fa: 'بازده اوراق', en: 'bond yields' },
  equity: { fa: 'سهام آمریکا', en: 'US equities' },
  volatility: { fa: 'تلاطم', en: 'volatility' },
  liquidity: { fa: 'نقدینگی استیبل‌کوین', en: 'stablecoin liquidity' },
  smartMoney: { fa: 'جریان نهادی', en: 'institutional flow' },
  curve: { fa: 'شیب منحنی', en: 'curve slope' },
  geopolitics: { fa: 'ژئوپلیتیک', en: 'geopolitics' }
});

/** the sum of every weight buildClimate can add — the denominator of «coverage» */
const CLIMATE_MAX_WEIGHT = 2.0 + 1.6 + 1.2 + 1.0 + 1.0 + 0.8 + 1.2 + 1.4 + 1.0 + 1.0 + 0.8;

export const REGIME_FA = Object.freeze({
  RISK_ON: 'ریسک‌پذیری', RISK_ON_LEANING: 'متمایل به ریسک‌پذیری', RISK_OFF: 'ریسک‌گریزی',
  RISK_OFF_LEANING: 'متمایل به ریسک‌گریزی', MIXED: 'ترکیبی'
});

export const OUTLOOK_LABEL_FA = {
  GROWTH_WATCH: 'هشدار رشد',
  RECESSION_WATCH: 'هشدار رکود',
  MIXED_SIGNALS: 'سیگنال‌های مختلط',
  UNAVAILABLE: 'دادهٔ کافی نیست'
};

/* ══════════════════════════════════════════════════════════════════════════
   3) THE CLIMATE INDEX — one honest number for the whole board.
   ──────────────────────────────────────────────────────────────────────────
   A weighted composite of THIS pass's readings. POSITIVE = risk-friendly.
   Every component is named with the real value behind it; the coverage row
   says how much of the possible weight was actually read, and when too little
   was read the label is null (the screen prints «خوانده نشد») instead of a
   confident sentence built on one number.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildClimate(data = {}) {
  const x = extractWorldInputs(data);
  const components = [];
  const add = (id, value, weight, evidence, evidenceFa) => {
    if (value === null) return;
    components.push({
      id, value: clamp(value, -1, 1), weight,
      contribution: round(clamp(value, -1, 1) * weight, 2), evidence: evidence || null, evidenceFa: evidenceFa || null
    });
  };

  /* regime vote */
  {
    const votes = arr(x.cross?.regime?.votes).filter((v) => num(v?.avg) !== null);
    if (votes.length) {
      const up = votes.filter((v) => num(v.avg) > 0).length;
      add('regime', (up - (votes.length - up)) / votes.length, 2.0,
        `${up} of ${votes.length} classes up · ${x.regime || 'MIXED'}`,
        `${faNum(up)} از ${faNum(votes.length)} کلاس صعودی · ${x.regime || 'ترکیبی'}`);
    } else {
      const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
      if (avgs.length) {
        const up = avgs.filter((v) => v > 0).length;
        add('regime', (up - (avgs.length - up)) / avgs.length, 2.0,
          `${up} of ${avgs.length} observed classes up over 24h`,
          `${faNum(up)} از ${faNum(avgs.length)} کلاس خوانده‌شده در ۲۴س صعودی`);
      }
    }
  }
  {
    const score = num(x.outlook?.score);
    if (score !== null) add('outlook', clamp(score / 1.5, -1, 1), 1.6,
      `engine outlook ${String(x.outlook.label || '')} at ${score}`,
      `چشم‌انداز موتور ${OUTLOOK_LABEL_FA[String(x.outlook.label)] || ''} با امتیاز ${faNum(score)}`);
  }
  /* every market part is scored in units of ITS OWN normal day (z = move / σ,
     see calibration.js) and saturates at 2.5σ — so a dollar tick and an oil
     swing weigh what they weigh, not what a shared divisor happens to give */
  {
    const dxyChg = num(x.dxy?.change1dPct);
    if (dxyChg !== null) add('dollar', -clamp(zOf(dxyChg, BENCH.dollar.sigma) / 2.5, -1, 1), 1.2,
      `DXY ${pctEn(dxyChg)} 1d${x.dxy.quality === QUALITY.PROXY ? ' (basket proxy)' : ''}`,
      `شاخص دلار ${pctFa(dxyChg)} در ۱ روز${x.dxy.quality === QUALITY.PROXY ? ' (پروکسی سبد ارزها)' : ''}`);
  }
  {
    const moves = [num(x.wti?.change1dPct), num(x.brent?.change1dPct)].filter((v) => v !== null);
    if (moves.length) {
      const avg = moves.reduce((a, c) => a + c, 0) / moves.length;
      add('energy', -clamp(zOf(avg, BENCH.oil.sigma) / 2.5, -1, 1), 1.0, `crude ${pctEn(avg)} 1d (energy proxy)`, `نفت ${pctFa(avg)} در ۱ روز (پروکسی انرژی)`);
    }
  }
  {
    const yb = x.bond && x.bond.yieldBp !== null ? x.bond.yieldBp : null;
    if (yb !== null) add('bonds', -clamp(zOf(yb, BENCH.bonds.sigma) / 2.5, -1, 1), 1.0,
      `10y yield ${yb > 0 ? '+' : ''}${yb}bp${x.bond.estimate ? ' (estimated from TLT)' : ''}`,
      `بازده ۱۰ ساله ${yb > 0 ? '+' : yb < 0 ? '\u2212' : ''}${faNum(Math.abs(yb))} bp${x.bond.estimate ? ' (تخمین از TLT)' : ''}`);
  }
  {
    const eq = num(x.spx?.change1dPct);
    if (eq !== null) add('equity', clamp(zOf(eq, BENCH.equity.sigma) / 2.5, -1, 1), 0.8,
      `equities ${pctEn(eq)} 1d`, `سهام آمریکا ${pctFa(eq)} در ۱ روز`);
  }
  {
    let best = null;
    for (const [cls, c] of Object.entries(x.classes || {})) {
      const avg = num(c?.avgChangePct);
      if (avg === null || !CLASS_SIGMA[cls]) continue;
      const z = Math.abs(avg / CLASS_SIGMA[cls]);
      if (best === null || z > best.z) best = { cls, avg, z };
    }
    if (best !== null) add('volatility', -clamp(best.z / 3, -1, 1), 1.2,
      `widest class move ${pctEn(best.avg)} (${best.z.toFixed(1)}x a normal day)`,
      `بیشترین حرکت کلاس ${pctFa(best.avg)} (${faNum(best.z.toFixed(1))} برابر روز معمول)`);
  }
  {
    const stableNet = num(x.chainFlows?.net24hUsd);
    if (stableNet !== null) add('liquidity', clamp(stableNet / LIQUIDITY_SCALE_USD, -1, 1), 1.4,
      `stablecoin net ${usdCompact(stableNet)}`, `جریان خالص استیبل‌کوین ${usdFaCompact(stableNet, { signed: false })}`);
  }
  {
    const smNet = smartMoneyNet(x);
    if (smNet !== null) add('smartMoney', clamp(smNet / 5_000_000, -1, 1), 1.0,
      `labelled net ${usdCompact(smNet)}`, `جریان برچسب‌دار ${usdFaCompact(smNet, { signed: false })}`);
  }
  {
    const spread = num(x.curve?.spreadPct);
    if (spread !== null) add('curve', clamp(spread / 1, -1, 1), 1.0, `2s10s ${spread}pp`, `شیب ۲/۱۰ ${faNum(spread)} واحد`);
  }
  {
    const byTopic = x.macroDom?.byTopic || {};
    const total = Object.values(byTopic).reduce((a, c) => a + (num(c) || 0), 0);
    const geo = num(byTopic.GEOPOLITICS);
    if (total && geo !== null) add('geopolitics', -clamp(geo / total / 0.35, -1, 1), 0.8,
      `${geo}/${total} headlines geopolitical`, `${faNum(geo)}/${faNum(total)} سرفصل ژئوپلیتیک`);
  }

  const weight = components.reduce((s, c) => s + c.weight, 0);
  const weighted = components.reduce((s, c) => s + c.contribution, 0);
  const score = weight > 0 ? clamp(weighted / weight, -1, 1) : null;
  const coverage = round(Math.min(1, weight / CLIMATE_MAX_WEIGHT), 3);
  const label = score === null || coverage < 0.3 ? null
    : score >= 0.25 ? 'sun' : score >= 0.05 ? 'partly' : score > -0.25 ? 'cloud' : score > -0.6 ? 'rain' : 'storm';

  return {
    label,
    index: score === null ? null : Math.round((score + 1) * 50),
    score: score === null ? null : round(score, 3),
    components,
    coverage,
    readCount: components.length,
    total: Object.keys(CLIMATE_PART_META).length,
    note: 'weighted composite of this pass\u2019s real readings — model, not a forecast'
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) FBT GLOBAL RADAR — every signal this pass actually produced.
   Position is meaningful: the SECTOR is the domain, the RING is severity
   (closer to the centre = more severe), the COLOUR is the tone ladder
   critical → emerging → developing → stable → opportunity.
   ══════════════════════════════════════════════════════════════════════════ */

export const RADAR_SECTORS = Object.freeze([
  { id: 'policy', fa: 'سیاست و فدرال', en: 'Policy' },
  { id: 'rates', fa: 'نرخ و منحنی', en: 'Rates & curve' },
  { id: 'dollar', fa: 'دلار و ارز', en: 'Dollar & FX' },
  { id: 'energy', fa: 'انرژی و کالا', en: 'Energy & commodities' },
  { id: 'equity', fa: 'سهام', en: 'Equities' },
  { id: 'crypto', fa: 'رمزارز و جریان', en: 'Crypto & flows' },
  { id: 'chain', fa: 'روی زنجیره و نهنگ', en: 'On-chain & whales' },
  { id: 'news', fa: 'اخبار و ژئوپلیتیک', en: 'News & geopolitics' },
  { id: 'opportunity', fa: 'فرصت', en: 'Opportunity' }
]);

const CLASS_FA = { crypto: 'رمزارز', stocks: 'سهام', forex: 'ارز', commodities: 'کالا', rwa: 'دارایی واقعی' };
const CLASS_EN = { crypto: 'crypto', stocks: 'stocks', forex: 'forex', commodities: 'commodities', rwa: 'RWA' };

/** Which radar sector a macro symbol belongs to. */
function macroSector(sym) {
  const s = String(sym || '').toUpperCase();
  if (s === 'DXY' || s.includes('USD') || s.includes('EUR') || s.includes('GBP') || s.includes('JPY')) return 'dollar';
  if (s.includes('Y') && s.length <= 6) return 'rates';
  if (s === 'GOLD' || s === 'XAU' || s === 'WTI' || s === 'BRENT' || s === 'COPPER' || s === 'SILVER') return 'energy';
  if (s === 'SPX' || s === 'SPY' || s === 'QQQ') return 'equity';
  if (s === 'BTC' || s === 'ETH') return 'crypto';
  return 'policy';
}

export function buildRadar(data = {}) {
  const x = extractWorldInputs(data);
  const blips = [];
  const seen = new Set();
  const pushBlip = (b) => {
    if (!b || seen.has(b.id)) return;
    seen.add(b.id);
    blips.push(b);
  };

  /* 1 · briefing items — the brain's own flags */
  for (const item of x.briefingItems.slice(0, 30)) {
    const tone = item.priority === 'critical' ? 'critical'
      : item.priority === 'high' ? 'emerging'
      : item.priority === 'normal' ? 'developing'
      : 'stable';
    pushBlip({
      id: `br:${item.id}`, tone, kind: item.kind || 'briefing', sector: 'policy',
      title: item.title, titleFa: item.titleFa || null,
      value: null, severity: tone === 'critical' ? 0.92 : tone === 'emerging' ? 0.68 : tone === 'developing' ? 0.44 : 0.22,
      meta: item.source || null, at: num(item.at)
    });
  }

  /* 2 · class moves measured this pass */
  for (const [cls, c] of Object.entries(x.classes)) {
    const avg = num(c?.avgChangePct);
    if (avg === null) continue;
    const abs = Math.abs(avg);
    if (abs < 0.6) continue;
    const tone = avg >= 1.5 ? 'opportunity' : avg <= -1.5 ? 'emerging' : 'developing';
    pushBlip({
      id: `class:${cls}`, tone, kind: 'class', sector: cls === 'crypto' ? 'crypto' : cls === 'stocks' ? 'equity' : cls === 'commodities' ? 'energy' : cls === 'forex' ? 'dollar' : 'opportunity',
      title: `${cls} class ${pctEn(avg)} (24h avg)`, titleFa: `${CLASS_FA[cls] || cls} ${pctFa(avg)} (میانگین ۲۴س)`,
      value: avg, severity: clamp(abs / 3, 0.2, 0.95), meta: 'cross-asset-engine',
      detail: c?.advancing !== undefined ? `${c.advancing}▲ / ${c.declining ?? 0}▼ of ${c.withChange ?? c.instruments ?? '?'}` : null
    });
  }

  /* 3 · macro quotes with real moves */
  for (const q of x.indicators) {
    const ch = num(q.change1dPct);
    if (ch === null || Math.abs(ch) < 0.5) continue;
    const sector = macroSector(q.symbol);
    const riskUp = (sector === 'dollar' || sector === 'rates') && ch > 0;
    const tone = riskUp && Math.abs(ch) >= 1 ? 'emerging' : Math.abs(ch) >= 1.5 ? 'developing' : 'developing';
    pushBlip({
      id: `macro:${q.symbol}`, tone, kind: 'macro', sector,
      title: `${q.symbol} ${pctEn(ch)} (1d)`, titleFa: `${q.symbol} ${pctFa(ch)} (۱ روز)`,
      value: ch, severity: clamp(Math.abs(ch) / 2.5, 0.25, 0.95), meta: q.source || null,
      detail: num(q.priceUsd) !== null ? `${q.priceUsd}` : null
    });
  }

  /* 4 · the curve */
  if (x.curve && num(x.curve.spreadPct) !== null && num(x.curve.spreadPct) < 0) {
    pushBlip({
      id: 'curve:inverted', tone: 'critical', kind: 'curve', sector: 'rates',
      title: `2s10s inverted at ${x.curve.spreadPct}pp`, titleFa: `منحنی ۲/۱۰ وارون در ${faNum(x.curve.spreadPct)} واحد`,
      value: num(x.curve.spreadPct), severity: 0.95, meta: x.curve.source || 'fred:T10Y2Y'
    });
  }

  /* 5 · stablecoin liquidity */
  {
    const net = num(x.chainFlows?.net24hUsd);
    if (net !== null && Math.abs(net) >= 40_000_000) {
      pushBlip({
        id: 'stable:net', tone: net > 0 ? 'opportunity' : 'emerging', kind: 'liquidity', sector: 'crypto',
        title: `stablecoin net ${usdCompact(net)} 24h`, titleFa: `جریان خالص استیبل‌کوین ${usdCompact(net).replace('+', '')} در ۲۴س`,
        value: net, severity: clamp(Math.abs(net) / 400_000_000, 0.25, 0.9), meta: 'defillama',
        detail: x.chainFlows?.topInflowChain ? `top: ${x.chainFlows.topInflowChain.chain}` : null
      });
    }
    for (const f of arr(x.chainFlows?.chainInflows).slice(0, 3)) {
      if (!(num(f.net24hUsd) > 0)) continue;
      pushBlip({
        id: `chain:in:${f.chain}`, tone: 'opportunity', kind: 'chain', sector: 'chain',
        title: `${f.chain} +${usdCompact(f.net24hUsd).replace('+', '')} stablecoins`,
        titleFa: `${f.chain} ${usdCompact(f.net24hUsd).replace('+', '')} ورود استیبل‌کوین`,
        value: num(f.net24hUsd), severity: clamp(num(f.net24hUsd) / 300_000_000, 0.2, 0.8), meta: 'defillama',
        detail: num(f.net24hPct) !== null ? pctEn(f.net24hPct) : null
      });
    }
    for (const f of arr(x.chainFlows?.chainOutflows).slice(0, 2)) {
      if (!(num(f.net24hUsd) < 0)) continue;
      pushBlip({
        id: `chain:out:${f.chain}`, tone: 'emerging', kind: 'chain', sector: 'chain',
        title: `${f.chain} ${usdCompact(f.net24hUsd)} stablecoins`,
        titleFa: `${f.chain} ${usdCompact(f.net24hUsd).replace('-', '\u2212')} خروج استیبل‌کوین`,
        value: num(f.net24hUsd), severity: clamp(Math.abs(num(f.net24hUsd)) / 300_000_000, 0.2, 0.8), meta: 'defillama'
      });
    }
  }

  /* 6 · the measured token flows */
  for (const t of arr(x.tokenFlows?.inflows).slice(0, 3)) {
    if (!(num(t.mcapChangeUsd) > 0)) continue;
    pushBlip({
      id: `token:in:${t.symbol}`, tone: 'opportunity', kind: 'tokenFlow', sector: 'opportunity',
      title: `${t.symbol} +${usdCompact(t.mcapChangeUsd).replace('+', '')} 24h`,
      titleFa: `${t.symbol} ${usdCompact(t.mcapChangeUsd).replace('+', '')} ورود سرمایه در ۲۴س`,
      value: num(t.mcapChangeUsd), severity: clamp(num(t.mcapChangeUsd) / 2e9, 0.2, 0.85), meta: 'coingecko',
      detail: num(t.change24hPct) !== null ? pctEn(t.change24hPct) : null
    });
  }
  for (const t of arr(x.tokenFlows?.outflows).slice(0, 2)) {
    if (!(num(t.mcapChangeUsd) < 0)) continue;
    pushBlip({
      id: `token:out:${t.symbol}`, tone: 'emerging', kind: 'tokenFlow', sector: 'crypto',
      title: `${t.symbol} ${usdCompact(t.mcapChangeUsd)} 24h`,
      titleFa: `${t.symbol} ${usdCompact(t.mcapChangeUsd).replace('-', '\u2212')} خروج سرمایه در ۲۴س`,
      value: num(t.mcapChangeUsd), severity: clamp(Math.abs(num(t.mcapChangeUsd)) / 2e9, 0.2, 0.85), meta: 'coingecko'
    });
  }

  /* 7 · whale transfers (the biggest priced events) */
  for (const e of arr(x.whales?.events).slice().sort((a, b) => (num(b.valueUsd) || 0) - (num(a.valueUsd) || 0)).slice(0, 5)) {
    pushBlip({
      id: `whale:${e.symbol}:${e.at || ''}:${e.valueUsd}`, tone: 'stable', kind: 'whale', sector: 'chain',
      title: `${e.symbol} ${usdCompact(e.valueUsd)} transfer${e.chain ? ` on ${e.chain}` : ''}`,
      titleFa: `انتقال ${e.symbol} به ارزش ${usdCompact(e.valueUsd).replace('+', '')}${e.chain ? ` روی ${e.chain}` : ''}`,
      value: num(e.valueUsd), severity: clamp((num(e.valueUsd) || 0) / 3e8, 0.18, 0.6), meta: 'whales:scanner',
      detail: e.flow || null
    });
  }

  /* 8 · labelled smart-money tokens */
  for (const t of arr(x.sm?.topTokens).slice(0, 4)) {
    const buy = String(t.signal || t.flow || '').toLowerCase();
    const pos = buy.includes('buy') || buy.includes('accum') || buy.includes('in');
    pushBlip({
      id: `sm:${t.symbol}:${t.chain || ''}`, tone: pos ? 'opportunity' : 'developing', kind: 'smartMoney', sector: 'chain',
      title: `${t.symbol} ${pos ? 'accumulation' : 'distribution'} ${usdCompact(num(t.netUsd) ?? num(t.valueUsd))}`,
      titleFa: `${t.symbol} ${pos ? 'انباشت' : 'توزیع'} ${usdCompact(num(t.netUsd) ?? num(t.valueUsd)).replace('+', '')}`,
      value: num(t.netUsd) ?? num(t.valueUsd),
      severity: clamp(Math.abs(num(t.netUsd) ?? num(t.valueUsd) ?? 0) / 3e6, 0.25, 0.85), meta: 'smartMoney:verified-index',
      detail: t.confidence != null ? `confidence ${t.confidence}` : null
    });
  }

  /* 9 · RWA desk movers */
  for (const i of x.rwaInstruments) {
    const ch = num(i.change24hPct);
    if (ch === null || Math.abs(ch) < 0.5) continue;
    pushBlip({
      id: `rwa:${i.symbol}`, tone: ch > 0 ? 'opportunity' : 'developing', kind: 'rwa', sector: 'opportunity',
      title: `${i.symbol} ${pctEn(ch)} (RWA desk)`, titleFa: `${i.symbol} ${pctFa(ch)} (میز RWA)`,
      value: ch, severity: clamp(Math.abs(ch) / 3, 0.2, 0.8), meta: x.envel.rwa?.source || 'brain:rwa'
    });
  }

  /* 10 · cross-class divergences */
  for (const d of x.divergences.slice(0, 3)) {
    const pair = arr(d.classes);
    pushBlip({
      id: `div:${pair.join('-')}`, tone: 'developing', kind: 'divergence', sector: 'equity',
      title: `${pair.map((c) => CLASS_EN[c] || c).join(' vs ')} gap ${d.gapPct}pp`,
      titleFa: `واگرایی ${pair.map((c) => CLASS_FA[c] || c).join(' و ')} با شکاف ${faNum(d.gapPct)} واحد`,
      value: num(d.gapPct), severity: clamp(Math.abs(num(d.gapPct) || 0) / 4, 0.25, 0.8), meta: 'cross-asset-engine'
    });
  }

  /* 11 · the news temperature */
  {
    const geo = num(x.macroDom?.byTopic?.GEOPOLITICS);
    const totalTopics = Object.values(x.macroDom?.byTopic || {}).reduce((a, c) => a + (num(c) || 0), 0);
    if (geo !== null && geo >= 3) {
      pushBlip({
        id: 'news:geopolitics', tone: 'developing', kind: 'news', sector: 'news',
        title: `${geo} geopolitical headlines (${totalTopics} classified)`,
        titleFa: `${faNum(geo)} سرفصل ژئوپلیتیک (${faNum(totalTopics)} دسته‌بندی‌شده)`,
        severity: clamp(geo / 8, 0.25, 0.8), meta: 'macro:classifier'
      });
    }
    const count = num(x.newsDom?.count);
    if (count !== null && count >= 20) {
      pushBlip({
        id: 'news:volume', tone: 'stable', kind: 'news', sector: 'news',
        title: `${count} headlines read this pass`, titleFa: `${faNum(count)} سرفصل در این دور خوانده شد`,
        severity: 0.3, meta: 'news-engine'
      });
    }
  }

  /* determinism: tone ladder first, then severity */
  const toneRank = { critical: 0, emerging: 1, developing: 2, opportunity: 3, stable: 4 };
  blips.sort((a, b) => (toneRank[a.tone] - toneRank[b.tone]) || (b.severity - a.severity));
  const ring = { critical: 0.26, emerging: 0.42, developing: 0.6, opportunity: 0.78, stable: 0.9 };
  const sectorIndex = Object.fromEntries(RADAR_SECTORS.map((s, i) => [s.id, i]));
  const perSector = {};
  blips.forEach((b, i) => {
    const si = sectorIndex[b.sector] ?? 8;
    perSector[si] = (perSector[si] || 0) + 1;
    const within = perSector[si];
    const base = (si / RADAR_SECTORS.length) * Math.PI * 2 - Math.PI / 2;
    const jitter = ((within - 1) % 3) * 0.1;
    b.r = clamp(0.94 - b.severity * 0.72, 0.14, 0.96);
    b.angle = base + jitter;
    b.ring = ring[b.tone];
    b.bearing = Math.round(((b.angle * 180) / Math.PI + 360) % 360);
    b.order = i;
  });
  const counts = { critical: 0, emerging: 0, developing: 0, opportunity: 0, stable: 0 };
  for (const b of blips) counts[b.tone] += 1;
  return { blips: blips.slice(0, 60), counts, sectors: RADAR_SECTORS, total: blips.length };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) THE GLOBE — 40+ economies, an honest read per country.
   Each country links ONLY to instruments this app actually reads; links are
   labelled DIRECT (a parity/index for that economy), PROXY (a mechanism, e.g.
   copper for Chinese growth) or REFERENCE (a local reference rate). What was
   not read stays «unread», never a guessed number.
   ══════════════════════════════════════════════════════════════════════════ */

const C = (id, fa, en, lat, lon, links, proxies, mechFa, mechEn) => Object.freeze({
  id, fa, en, lat, lon, links, proxies: proxies || [], mechFa, mechEn,
  /* the legacy equirectangular placement, derived so old/labels stay put */
  x: Math.round(160 + (lon / 180) * 140),
  y: Math.round(160 - (lat / 90) * 140)
});

export const COUNTRIES = Object.freeze([
  /* ── the original twelve (ids are a public contract) ── */
  C('us', 'آمریکا', 'United States', 39, -98, ['DXY', 'US10Y', 'CURVE', 'EQUITY'], [],
    'شاخص دلار، بازده اوراق و شاخص سهام آمریکا خوانش‌های مستقیم‌اند.', 'Dollar index, Treasury yields and the US equity index are direct reads.'),
  C('eu', 'منطقه یورو', 'Eurozone', 50, 10, ['EURUSD', 'GOLD', 'US10Y'], ['GOLD', 'US10Y'],
    'برابری یورو/دلار خوانش مستقیم است؛ طلا و بازده، پروکسی فشار مالی‌اند.', 'The EUR/USD parity is direct; gold and yields are financial-conditions proxies.'),
  C('uk', 'بریتانیا', 'United Kingdom', 54, -2, ['GBPUSD', 'BRENT', 'US10Y'], ['BRENT', 'US10Y'],
    'برابری پوند مستقیم است؛ برنت پروکسی درآمد انرژی دریای شمال است.', 'The GBP parity is direct; Brent is a proxy for North Sea energy revenue.'),
  C('tr', 'ترکیه', 'Türkiye', 39, 35, ['GOLD', 'DXY'], ['GOLD', 'DXY'],
    'طلا و دلار پروکسی‌های فشار ارزی و تقاضای پوشش ریسک‌اند.', 'Gold and the dollar are proxies for FX pressure and hedging demand.'),
  C('ru', 'روسیه', 'Russia', 60, 90, ['WTI', 'GOLD'], ['WTI', 'GOLD'],
    'نفت پروکسی درآمد صادراتی و طلا پروکسی ذخایر است.', 'Oil proxies export revenue; gold proxies reserves.'),
  C('gulf', 'خلیج فارس', 'Gulf states', 25, 50, ['WTI', 'BRENT'], ['WTI', 'BRENT'],
    'نفت خام مهم‌ترین سازوکار درآمد این اقتصادهاست (پروکسی).', 'Crude is the dominant revenue mechanism here (proxy).'),
  C('ir', 'ایران', 'Iran', 32, 53, ['TMN', 'GOLD', 'WTI'], ['GOLD', 'WTI'],
    'نرخ مرجع USDT/TMN خوانش مستقیم است؛ طلا و نفت پروکسی‌اند.', 'The USDT/TMN reference is direct; gold and oil are proxies.'),
  C('in', 'هند', 'India', 22, 79, ['GOLD', 'WTI'], ['GOLD', 'WTI'],
    'طلا پروکسی تقاضای وارداتی و نفت پروکسی هزینهٔ انرژی است.', 'Gold proxies import demand; crude proxies the energy bill.'),
  C('cn', 'چین', 'China', 35, 104, ['COPPER', 'WTI'], ['COPPER', 'WTI'],
    'مس پروکسی رشد صنعتی و نفت پروکسی هزینهٔ واردات است.', 'Copper proxies industrial growth; crude proxies the import bill.'),
  C('jp', 'ژاپن', 'Japan', 36, 138, ['JPYUSD', 'US10Y'], ['US10Y'],
    'برابری ین مستقیم است؛ بازده آمریکا پروکسی فشار بیرونی است.', 'The yen parity is direct; US yields proxy external pressure.'),
  C('au', 'استرالیا', 'Australia', -25, 134, ['COPPER', 'GOLD'], ['COPPER', 'GOLD'],
    'مس و طلا پروکسی‌های صادرات معدنی‌اند.', 'Copper and gold proxy mineral exports.'),
  C('br', 'برزیل', 'Brazil', -10, -52, ['COPPER', 'WTI'], ['COPPER', 'WTI'],
    'مس و نفت پروکسی‌های صادرات کالایی‌اند.', 'Copper and crude proxy commodity exports.'),

  /* ── the wider board ── */
  C('ca', 'کانادا', 'Canada', 56, -106, ['WTI', 'DXY', 'GOLD'], ['WTI', 'GOLD'],
    'نفت پروکسی درآمد انرژی و دلار پروکسی فشار ارزی است.', 'Crude proxies energy revenue; the dollar proxies FX pressure.'),
  C('mx', 'مکزیک', 'Mexico', 23, -102, ['DXY', 'WTI'], ['DXY', 'WTI'],
    'دلار پروکسی نرخ ارز و نفت پروکسی درآمد نفتی است.', 'The dollar proxies FX; crude proxies oil revenue.'),
  C('ar', 'آرژانتین', 'Argentina', -34, -64, ['GOLD', 'DXY'], ['GOLD', 'DXY'],
    'طلا و دلار پروکسی‌های تقاضای پوشش ریسک‌اند.', 'Gold and the dollar proxy hedging demand.'),
  C('cl', 'شیلی', 'Chile', -33, -71, ['COPPER'], ['COPPER'],
    'مس پروکسی مستقیم درآمد معدنی است.', 'Copper is the proxy for mining revenue.'),
  C('pe', 'پرو', 'Peru', -10, -76, ['COPPER', 'GOLD'], ['COPPER', 'GOLD'],
    'مس و طلا پروکسی صادرات‌اند.', 'Copper and gold proxy exports.'),
  C('za', 'آفریقای جنوبی', 'South Africa', -29, 24, ['GOLD', 'COPPER'], ['GOLD', 'COPPER'],
    'طلا و مس پروکسی صادرات معدنی‌اند.', 'Gold and copper proxy mineral exports.'),
  C('ng', 'نیجریه', 'Nigeria', 9, 8, ['WTI', 'BRENT'], ['WTI', 'BRENT'],
    'نفت پروکسی درآمد دولتی و ارزی است.', 'Crude proxies fiscal and FX revenue.'),
  C('eg', 'مصر', 'Egypt', 26, 30, ['WTI', 'GOLD', 'DXY'], ['WTI', 'GOLD', 'DXY'],
    'نفت، طلا و دلار پروکسی‌های تراز ارزی‌اند.', 'Crude, gold and the dollar proxy the external balance.'),
  C('sa', 'عربستان', 'Saudi Arabia', 24, 45, ['WTI', 'BRENT'], ['WTI', 'BRENT'],
    'برنت پروکسی مستقیم بودجه و درآمد نفتی است.', 'Brent is the proxy for the budget and oil revenue.'),
  C('ae', 'امارات', 'UAE', 24, 54, ['WTI', 'GOLD'], ['WTI', 'GOLD'],
    'نفت پروکسی درآمد و طلا پروکسی تجارت و ذخیره است.', 'Crude proxies revenue; gold proxies trade and reserves.'),
  C('no', 'نروژ', 'Norway', 62, 9, ['BRENT', 'EURUSD'], ['BRENT'],
    'برنت پروکسی درآمد انرژی و یورو پروکسی تجارت است.', 'Brent proxies energy revenue; the euro proxies trade.'),
  C('ch', 'سوئیس', 'Switzerland', 47, 8, ['GOLD', 'EURUSD'], ['GOLD', 'EURUSD'],
    'طلا پروکسی تجارت و امنیت سرمایه است.', 'Gold proxies the bullion trade and safe-haven flows.'),
  C('se', 'سوئد', 'Sweden', 62, 15, ['EURUSD', 'DXY'], ['EURUSD', 'DXY'],
    'برابری‌های ارزی پروکسی تجارت‌اند.', 'FX parities proxy trade.'),
  C('pl', 'لهستان', 'Poland', 52, 20, ['EURUSD', 'GOLD'], ['EURUSD', 'GOLD'],
    'یورو پروکسی تجارت و طلا پروکسی تقاضای امن است.', 'The euro proxies trade; gold proxies safe-haven demand.'),
  C('de', 'آلمان', 'Germany', 51, 10, ['EURUSD', 'COPPER', 'WTI'], ['COPPER', 'WTI'],
    'مس پروکسی رشد صنعتی و نفت پروکسی هزینهٔ انرژی است.', 'Copper proxies industrial growth; crude proxies the energy bill.'),
  C('fr', 'فرانسه', 'France', 46, 2, ['EURUSD', 'GOLD'], ['GOLD'],
    'یورو خوانش مستقیم ارزی و طلا پروکسی ذخایر است.', 'The euro is the direct FX read; gold proxies reserves.'),
  C('it', 'ایتالیا', 'Italy', 42, 12, ['EURUSD', 'US10Y'], ['US10Y'],
    'یورو مستقیم و بازده آمریکا پروکسی فشار بدهی است.', 'The euro is direct; US yields proxy debt pressure.'),
  C('es', 'اسپانیا', 'Spain', 40, -4, ['EURUSD', 'WTI'], ['WTI'],
    'یورو مستقیم و نفت پروکسی هزینهٔ انرژی است.', 'The euro is direct; crude proxies the energy bill.'),
  C('nl', 'هلند', 'Netherlands', 52, 5, ['EURUSD', 'GOLD'], ['GOLD'],
    'یورو مستقیم و طلا پروکسی تجارت است.', 'The euro is direct; gold proxies trade.'),
  C('gr', 'یونان', 'Greece', 39, 22, ['EURUSD', 'BRENT'], ['BRENT'],
    'یورو مستقیم و برنت پروکسی کرایه حمل و انرژی است.', 'The euro is direct; Brent proxies shipping fuel and energy.'),
  C('ua', 'اوکراین', 'Ukraine', 49, 32, ['WTI', 'GOLD', 'COPPER'], ['WTI', 'GOLD', 'COPPER'],
    'نفت، طلا و مس پروکسی‌های ریسک ژئوپلیتیک و صادرات‌اند.', 'Crude, gold and copper proxy geopolitical risk and exports.'),
  C('kz', 'قزاقستان', 'Kazakhstan', 48, 67, ['WTI', 'COPPER'], ['WTI', 'COPPER'],
    'نفت و مس پروکسی صادرات‌اند.', 'Crude and copper proxy exports.'),
  C('pk', 'پاکستان', 'Pakistan', 30, 70, ['GOLD', 'WTI'], ['GOLD', 'WTI'],
    'طلا و نفت پروکسی‌های تراز خارجی‌اند.', 'Gold and crude proxy the external balance.'),
  C('af', 'افغانستان', 'Afghanistan', 34, 66, ['GOLD', 'DXY'], ['GOLD', 'DXY'],
    'طلا و دلار پروکسی‌های بازار ارز مرزی‌اند.', 'Gold and the dollar proxy border FX markets.'),
  C('iq', 'عراق', 'Iraq', 33, 44, ['WTI', 'BRENT'], ['WTI', 'BRENT'],
    'نفت پروکسی درآمد دولت است.', 'Crude proxies government revenue.'),
  C('qa', 'قطر', 'Qatar', 25, 51, ['BRENT', 'WTI'], ['BRENT', 'WTI'],
    'نفت و گاز (برنت به‌عنوان پروکسی) درآمد اصلی است.', 'Oil and gas (Brent as proxy) drive revenue.'),
  C('kw', 'کویت', 'Kuwait', 29, 48, ['BRENT'], ['BRENT'],
    'برنت پروکسی درآمد نفتی است.', 'Brent proxies oil revenue.'),
  C('th', 'تایلند', 'Thailand', 15, 101, ['GOLD', 'WTI'], ['GOLD', 'WTI'],
    'طلا و نفت پروکسی‌های گردشگری و انرژی‌اند.', 'Gold and crude proxy tourism and energy.'),
  C('vn', 'ویتنام', 'Vietnam', 16, 107, ['COPPER', 'WTI'], ['COPPER', 'WTI'],
    'مس پروکسی تولید و نفت پروکسی انرژی است.', 'Copper proxies manufacturing; crude proxies energy.'),
  C('id', 'اندونزی', 'Indonesia', -2, 118, ['COPPER', 'WTI', 'GOLD'], ['COPPER', 'WTI', 'GOLD'],
    'مس، نفت و طلا پروکسی صادرات‌اند.', 'Copper, crude and gold proxy exports.'),
  C('my', 'مالزی', 'Malaysia', 4, 102, ['COPPER', 'WTI'], ['COPPER', 'WTI'],
    'مس و نفت پروکسی تولید و انرژی‌اند.', 'Copper and crude proxy manufacturing and energy.'),
  C('kr', 'کره جنوبی', 'South Korea', 37, 128, ['COPPER', 'US10Y'], ['COPPER', 'US10Y'],
    'مس پروکسی صادرات صنعتی و بازده آمریکا پروکسی شرایط مالی است.', 'Copper proxies industrial exports; US yields proxy financial conditions.'),
  C('sg', 'سنگاپور', 'Singapore', 1, 104, ['DXY', 'GOLD'], ['DXY', 'GOLD'],
    'دلار و طلا پروکسی‌های تجارت و جریان سرمایه‌اند.', 'The dollar and gold proxy trade and capital flows.'),
  C('hk', 'هنگ‌کنگ', 'Hong Kong', 22, 114, ['DXY', 'COPPER'], ['DXY', 'COPPER'],
    'دلار پروکسی پیوند ارزی و مس پروکسی تجارت با چین است.', 'The dollar proxies the peg; copper proxies China trade.')
]);

const FOREX_SYMS = { EURUSD: ['EURUSD', 'EUR_USD'], GBPUSD: ['GBPUSD', 'GBP_USD'], JPYUSD: ['USDJPY', 'JPYUSD', 'USD_JPY'] };
const CURVE_SYMS = new Set(['CURVE']);
const EQUITY_SYMS = new Set(['EQUITY']);

/* ── the country → local-currency map ─────────────────────────────────────
   REPORTED: «بعضی کشورها ناقص خوانده می‌شوند». A country linked only to
   commodity PROXIES had nothing of its own to show; the ECB reference rates
   (carried by the macro desk as `fx`) cover 29 currencies, so every country
   below now reads its OWN currency against the dollar — a direct reading. */
const CCY_OF = Object.freeze({
  eu: 'EUR', de: 'EUR', fr: 'EUR', it: 'EUR', es: 'EUR', nl: 'EUR', gr: 'EUR',
  uk: 'GBP', tr: 'TRY', in: 'INR', cn: 'CNY', br: 'BRL', mx: 'MXN', za: 'ZAR', jp: 'JPY', kr: 'KRW',
  au: 'AUD', ca: 'CAD', ch: 'CHF', se: 'SEK', no: 'NOK', pl: 'PLN', th: 'THB', id: 'IDR', my: 'MYR', sg: 'SGD', hk: 'HKD'
});
const CCY_NAME = Object.freeze({
  EUR: ['یورو', 'euro'], GBP: ['پوند', 'pound'], TRY: ['لیر', 'lira'], INR: ['روپیه هند', 'rupee'], CNY: ['یوان', 'yuan'],
  BRL: ['رئال', 'real'], MXN: ['پزوی مکزیک', 'peso'], ZAR: ['رند', 'rand'], JPY: ['ین', 'yen'], KRW: ['وون', 'won'],
  AUD: ['دلار استرالیا', 'Australian dollar'], CAD: ['دلار کانادا', 'Canadian dollar'], CHF: ['فرانک سوئیس', 'Swiss franc'],
  SEK: ['کرون سوئد', 'krona'], NOK: ['کرون نروژ', 'krone'], PLN: ['زلوتی', 'zloty'], THB: ['بات', 'baht'],
  IDR: ['روپیهٔ اندونزی', 'rupiah'], MYR: ['رینگیت', 'ringgit'], SGD: ['دلار سنگاپور', 'Singapore dollar'], HKD: ['دلار هنگ‌کنگ', 'HK dollar']
});
/* currencies officially fixed to the dollar: a policy FACT, labelled as such */
const PEGS = Object.freeze({
  sa: { ccy: 'SAR', per: 3.75, fa: 'ریال سعودی', en: 'Saudi riyal' },
  ae: { ccy: 'AED', per: 3.6725, fa: 'درهم امارات', en: 'UAE dirham' },
  qa: { ccy: 'QAR', per: 3.64, fa: 'ریال قطر', en: 'Qatari riyal' },
  gulf: { ccy: 'SAR', per: 3.75, fa: 'ریال سعودی و درهم امارات', en: 'Saudi riyal and UAE dirham' }
});

const PROXY_NAME = Object.freeze({
  GOLD: ['طلا', 'Gold'], WTI: ['نفت وست‌تگزاس', 'WTI crude'], BRENT: ['نفت برنت', 'Brent crude'], COPPER: ['مس', 'Copper'],
  DXY: ['شاخص دلار', 'Dollar index'], US10Y: ['بازده اوراق ۱۰ ساله آمریکا', 'US 10-year yield'],
  EQUITY: ['شاخص سهام آمریکا', 'US equity index'], CURVE: ['شیب منحنی ۲ به ۱۰', '2s10s curve'],
  EURUSD: ['یورو در برابر دلار', 'EUR/USD'], GBPUSD: ['پوند در برابر دلار', 'GBP/USD'], JPYUSD: ['ین در برابر دلار', 'JPY/USD']
});

/* ── headline mentions: which of the latest headlines name this economy ───
   The pulse is a count of REAL headlines in this pass that mention the
   country (by name, central bank or capital) — attention, not direction. */
const MENTION_WORDS = Object.freeze({
  us: 'U\\.?S\\.?|United States|America|Federal Reserve|Fed|Treasury|Wall Street|Washington|Trump',
  eu: 'Eurozone|euro zone|ECB|Europe|European|Brussels', uk: 'Britain|British|UK|U\\.K\\.|BoE|Bank of England|London|sterling',
  tr: 'Turkey|Türkiye|Turkish|Ankara', ru: 'Russia|Russian|Moscow|Kremlin|ruble', gulf: 'Gulf|OPEC|Hormuz',
  ir: 'Iran|Iranian|Tehran', in: 'India|Indian|RBI|Delhi|Mumbai|rupee', cn: 'China|Chinese|Beijing|PBOC|yuan',
  jp: 'Japan|Japanese|BoJ|Tokyo|yen', au: 'Australia|Australian|RBA|Sydney', br: 'Brazil|Brazilian|Brasilia',
  ca: 'Canada|Canadian|Ottawa', mx: 'Mexico|Mexican', ar: 'Argentina|Argentine|Milei', cl: 'Chile|Chilean', pe: 'Peru|Peruvian',
  za: 'South Africa|Pretoria|rand', ng: 'Nigeria|Nigerian|Lagos|naira', eg: 'Egypt|Egyptian|Cairo', sa: 'Saudi|Riyadh|Aramco',
  ae: 'UAE|Emirates|Dubai|Abu Dhabi', no: 'Norway|Norwegian|Oslo', ch: 'Switzerland|Swiss|SNB|Zurich', se: 'Sweden|Swedish|Riksbank',
  pl: 'Poland|Polish|Warsaw|zloty', de: 'Germany|German|Bundesbank|Berlin', fr: 'France|French|Paris', it: 'Italy|Italian|Meloni',
  es: 'Spain|Spanish|Madrid', nl: 'Netherlands|Dutch|Amsterdam', gr: 'Greece|Greek|Athens', ua: 'Ukraine|Ukrainian|Kyiv|Kiev',
  kz: 'Kazakhstan', pk: 'Pakistan|Islamabad', af: 'Afghanistan|Taliban|Kabul', iq: 'Iraq|Iraqi|Baghdad', qa: 'Qatar|Doha',
  kw: 'Kuwait', th: 'Thailand|Thai|Bangkok', vn: 'Vietnam|Hanoi', id: 'Indonesia|Jakarta', my: 'Malaysia|Kuala Lumpur',
  kr: 'South Korea|Korean|Seoul', sg: 'Singapore', hk: 'Hong Kong'
});
const MENTION_RE = Object.freeze(Object.fromEntries(
  Object.entries(MENTION_WORDS).map(([id, words]) => [id, new RegExp(`(?<![A-Za-z])(?:${words})(?![A-Za-z])`, 'i')])
));

function countryMentions(country, newsItems) {
  const re = MENTION_RE[country.id];
  const out = [];
  for (const n of arr(newsItems)) {
    const title = String(n?.title || '');
    if (!title) continue;
    if ((re && re.test(title)) || title.includes(country.fa)) out.push({ title, source: n.source || null, url: n.url || null, at: num(n.at) });
  }
  return out;
}

export function buildCountrySnapshot(country, data = {}, { isPersian = true } = {}) {
  const x = extractWorldInputs(data);
  const findForex = (key) => {
    const alts = FOREX_SYMS[key] || [key];
    return x.forexInstruments.find((i) => alts.some((a) => String(i?.symbol || '').toUpperCase().replace('/', '').includes(a.replace('/', ''))));
  };
  const rows = [];
  const proxySet = new Set(country.proxies || []);
  const nm = (key, fallback) => {
    const n = PROXY_NAME[key];
    return n ? { nameFa: n[0], nameEn: n[1] } : { nameFa: fallback || key, nameEn: fallback || key };
  };
  const src = (s) => ({ source: s || null, sourceFa: s ? describeSource(s, true) : null, sourceEn: s ? describeSource(s, false) : null });

  /* 1) the country's OWN currency against the dollar — the direct reading */
  const ccy = CCY_OF[country.id];
  const fxRow = ccy ? x.fx?.[ccy] : null;
  if (fxRow && num(fxRow.perUsd) !== null) {
    const [fa, en] = CCY_NAME[ccy] || [ccy, ccy];
    const change = num(fxRow.change1dPct);
    rows.push({
      sym: `${ccy}/USD`, name: isPersian ? `${fa} در برابر دلار` : `${en} vs dollar`,
      nameFa: `${fa} در برابر دلار`, nameEn: `${en} vs dollar`,
      change, value: String(round(fxRow.perUsd, fxRow.perUsd >= 100 ? 1 : 3)),
      valueFa: `${faNum(round(fxRow.perUsd, fxRow.perUsd >= 100 ? 1 : 3))} ${fa} هر دلار`, valueEn: `${round(fxRow.perUsd, fxRow.perUsd >= 100 ? 1 : 3)} ${ccy} per USD`,
      dir: signOf(change), ...src(fxRow.source || 'ecb'), kind: 'direct', quality: QUALITY.MEASURED, inNet: true,
      note: null, noteFa: change === null ? 'نرخ مرجع خوانده شد؛ تغییر روزانه نرسید.' : (change > 0 ? 'ارز محلی در برابر دلار تقویت شده است.' : change < 0 ? 'ارز محلی در برابر دلار ضعیف شده است.' : null),
      noteEn: change === null ? 'the reference rate was read; no daily change.' : (change > 0 ? 'the local currency gained on the dollar.' : change < 0 ? 'the local currency lost ground to the dollar.' : null)
    });
  }
  const peg = PEGS[country.id];
  if (peg) {
    rows.push({
      sym: `${peg.ccy}/USD`, name: isPersian ? `${peg.fa} در برابر دلار` : `${peg.en} vs dollar`,
      nameFa: `${peg.fa} در برابر دلار`, nameEn: `${peg.en} vs dollar`, change: null, value: String(peg.per),
      valueFa: `${faNum(peg.per)} هر دلار`, valueEn: `${peg.per} per USD`, dir: 'flat', source: 'peg', sourceFa: 'نرخ ثابت رسمی', sourceEn: 'official peg',
      kind: 'peg', quality: QUALITY.LEVEL, note: null,
      noteFa: 'پیوند رسمی به دلار؛ این یک واقعیت سیاستی است، نه خوانش امروز.', noteEn: 'an official dollar peg — a policy fact, not today\u2019s reading.'
    });
  }

  /* 2) the instruments the country is linked to */
  for (const link of country.links) {
    if (CURVE_SYMS.has(link)) {
      if (x.curve) rows.push({
        sym: '2s10s', ...nm('CURVE'), name: isPersian ? 'منحنی بازده ۲/۱۰' : '2s10s yield curve', change: null,
        value: `${x.curve.spreadPct}pp`, valueFa: `${faNum(x.curve.spreadPct)} واحد`, valueEn: `${x.curve.spreadPct}pp`,
        dir: signOf(x.curve.spreadPct), ...src(x.curve.source), kind: 'direct', quality: QUALITY.MEASURED,
        note: isPersian ? 'شیب منحنی؛ مقیاس ۰٫۲۵ واحد گام مهم است.' : 'curve slope; 0.25pp is the step that matters.',
        noteFa: 'منفی بودن شیب یعنی منحنی وارون است.', noteEn: 'a negative slope means the curve is inverted.'
      });
      continue;
    }
    if (EQUITY_SYMS.has(link)) {
      if (x.spx) rows.push({
        sym: x.spx.symbol, ...nm('EQUITY'), name: isPersian ? 'شاخص سهام آمریکا' : 'US equity index',
        change: num(x.spx.change1dPct), value: num(x.spx.priceUsd) !== null ? String(round(x.spx.priceUsd, 2)) : null,
        valueFa: num(x.spx.priceUsd) !== null ? faNum(Math.round(x.spx.priceUsd).toLocaleString('en-US')).replace(/,/g, '\u066c') : null,
        dir: signOf(x.spx.change1dPct), ...src(x.spx.source), kind: proxySet.has(link) ? 'proxy' : 'direct', quality: x.spx.quality || QUALITY.MEASURED, inNet: false, note: null,
        noteFa: x.spx.basisFa || null, noteEn: x.spx.basisEn || null
      });
      continue;
    }
    if (link === 'TMN') {
      if (x.toman?.status === 'fresh') rows.push({
        sym: 'USDT/TMN', nameFa: 'دلار (نرخ مرجع)', nameEn: 'USD reference (Wallex)', name: isPersian ? 'دلار (نرخ مرجع)' : 'USD reference (Wallex)', change: null,
        value: String(Math.round(x.toman.value)), valueFa: `${faNum(Math.round(x.toman.value).toLocaleString('en-US')).replace(/,/g, '\u066c')} تومان`, valueEn: `${Math.round(x.toman.value).toLocaleString('en-US')} TMN`,
        dir: 'flat', source: x.toman.source || 'wallex', sourceFa: 'والکس', sourceEn: 'Wallex', kind: 'reference', quality: QUALITY.MEASURED,
        note: isPersian ? 'نرخ مرجع عمومی، نه نرخ معاملات این اپ.' : 'a public reference rate, not an in-app trading rate.',
        noteFa: 'نرخ مرجع عمومی، نه نرخ معاملات این اپ.', noteEn: 'a public reference rate, not an in-app trading rate.'
      });
      continue;
    }
    if (FOREX_SYMS[link]) {
      /* the ECB row above already carries the currency; the venue parity is
         shown only when the ECB did not (a duplicate is clutter) */
      if (fxRow) continue;
      const q = findForex(link);
      if (q) rows.push({
        sym: q.symbol, ...nm(link), name: isPersian ? nm(link).nameFa : nm(link).nameEn, change: num(q.change24hPct),
        value: num(q.priceUsd) !== null ? String(round(q.priceUsd, 4)) : null,
        valueFa: num(q.priceUsd) !== null ? faNum(round(q.priceUsd, 4)) : null,
        dir: signOf(q.change24hPct), ...src(x.envel.forex?.source || 'ostium'), kind: proxySet.has(link) ? 'proxy' : 'direct', quality: QUALITY.MEASURED, note: null
      });
      continue;
    }
    const q = x.findInd([link]);
    if (!q && link === 'US10Y' && x.bond && x.bond.yieldBp !== null) {
      /* no measured 10-year: the bond ETF's move, converted and labelled */
      const b = x.bond;
      const bp = Math.abs(b.yieldBp).toFixed(1);
      const sg = b.yieldBp > 0 ? '+' : b.yieldBp < 0 ? '\u2212' : '';
      rows.push({
        sym: 'US10Y', ...nm('US10Y'), name: isPersian ? nm('US10Y').nameFa : nm('US10Y').nameEn, change: null,
        value: `${b.yieldBp}bp`, valueFa: `\u2248 ${sg}${faNum(bp)} bp`, valueEn: `\u2248 ${b.yieldBp > 0 ? '+' : b.yieldBp < 0 ? '-' : ''}${bp}bp`,
        dir: b.dir, ...src(b.source), kind: proxySet.has(link) ? 'proxy' : 'direct', quality: b.quality, inNet: false, note: null,
        noteFa: 'تخمین از قیمت صندوق اوراق بلندمدت (TLT)؛ خوانش مستقیم بازده نرسید.', noteEn: 'estimated from the long-bond ETF (TLT); the direct yield read did not arrive.'
      });
      continue;
    }
    if (q) {
      const isProxy = proxySet.has(link);
      rows.push({
        sym: q.symbol, ...nm(link, q.name), name: isPersian ? nm(link, q.name).nameFa : nm(link, q.name).nameEn, change: num(q.change1dPct),
        value: num(q.priceUsd) !== null ? String(round(q.priceUsd, q.priceUsd >= 100 ? 1 : 3)) : null,
        valueFa: num(q.priceUsd) !== null ? faNum(round(q.priceUsd, q.priceUsd >= 100 ? 1 : 3)) : null,
        dir: signOf(q.change1dPct), ...src(q.source), kind: isProxy ? 'proxy' : 'direct', quality: q.quality || QUALITY.MEASURED,
        inNet: isProxy || link === 'DXY',
        note: isProxy ? (isPersian ? 'پروکسی سازوکار اقتصادی، نه دادهٔ مستقیم این کشور.' : 'a mechanism proxy, not direct country data.') : null,
        noteFa: isProxy ? 'پروکسی سازوکار اقتصادی، نه دادهٔ مستقیم این کشور.' : (q.basisFa || null),
        noteEn: isProxy ? 'a mechanism proxy, not direct country data.' : (q.basisEn || null)
      });
    }
  }

  /* 3) the headline pulse: how many of this pass's headlines name the economy */
  const mentions = countryMentions(country, x.newsDom?.items);
  if (mentions.length) {
    rows.push({
      sym: 'NEWS', nameFa: 'خبرهای همین دور', nameEn: 'Headlines this pass', name: isPersian ? 'خبرهای همین دور' : 'Headlines this pass', change: null,
      value: String(mentions.length), valueFa: `${faNum(mentions.length)} خبر`, valueEn: `${mentions.length} headline${mentions.length > 1 ? 's' : ''}`,
      dir: 'flat', source: 'news-engine', sourceFa: 'موتور خبر', sourceEn: 'news engine', kind: 'news', quality: QUALITY.MEASURED,
      note: null, noteFa: 'شمار سرفصل‌هایی که این اقتصاد را نام برده‌اند؛ توجه است، نه جهت.', noteEn: 'headlines that name this economy — attention, not direction.',
      headlines: mentions.slice(0, 2)
    });
  }

  /* the country's mood: its OWN currency when read; otherwise its proxies —
     and the card says which of the two it used */
  const directChanges = rows.filter((r) => r.kind === 'direct' && r.inNet && r.change !== null).map((r) => r.change);
  const proxyChanges = rows.filter((r) => r.kind === 'proxy' && r.change !== null).map((r) => r.change);
  const basis = directChanges.length ? 'direct' : (proxyChanges.length ? 'proxy' : null);
  const pool = basis === 'direct' ? directChanges : basis === 'proxy' ? proxyChanges : [];
  const net = pool.length ? round(pool.reduce((a, c) => a + c, 0) / pool.length) : null;
  const measuredRows = rows.filter((r) => r.kind !== 'news' && r.kind !== 'peg');
  const status = measuredRows.length || peg ? (net !== null ? 'read' : 'partial') : (mentions.length ? 'partial' : 'unread');
  const mood = net === null ? 'flat' : net >= 0.3 ? 'up' : net <= -0.3 ? 'down' : 'flat';
  const dirs = { up: 0, down: 0, flat: 0 };
  for (const r of rows) dirs[r.dir] = (dirs[r.dir] || 0) + 1;

  return {
    country, rows, net, netBasis: basis, status, mood, dirs,
    readCount: rows.length, proxyCount: rows.filter((r) => r.kind === 'proxy').length,
    directCount: rows.filter((r) => r.kind === 'direct').length, mentions: mentions.length,
    summaryFa: buildCountrySummary(country, rows, net, true, basis),
    summaryEn: buildCountrySummary(country, rows, net, false, basis)
  };
}

function buildCountrySummary(country, rows, net, isPersian, basis) {
  if (!rows.length) return isPersian
    ? `برای ${country.fa} در این دور خوانشی ثبت نشد — هیچ عددی حدس زده نمی‌شود.`
    : `No reading was recorded for ${country.en} in this pass — nothing is guessed.`;
  const direct = rows.filter((r) => r.kind === 'direct').length;
  const proxy = rows.filter((r) => r.kind === 'proxy').length;
  const news = rows.find((r) => r.kind === 'news');
  const moodFa = net === null ? 'بدون تغییر خوانده‌شده' : net > 0.3 ? 'برآیند صعودی' : net < -0.3 ? 'برآیند نزولی' : 'خنثی';
  const moodEn = net === null ? 'no measured change' : net > 0.3 ? 'net positive' : net < -0.3 ? 'net negative' : 'neutral';
  const basisFa = basis === 'direct' ? 'بر پایهٔ ارز محلی و خوانش‌های مستقیم' : basis === 'proxy' ? 'فقط بر پایهٔ پروکسی‌ها' : '';
  const basisEn = basis === 'direct' ? 'based on the local currency and direct reads' : basis === 'proxy' ? 'based on proxies only' : '';
  return isPersian
    ? `${faNum(direct)} خوانش مستقیم · ${faNum(proxy)} پروکسی${news ? ` · ${faNum(news.valueFa ? news.value : 0)} خبر` : ''} — ${moodFa}${net !== null ? ` (${pctFa(net)})` : ''}${basisFa ? `، ${basisFa}` : ''}`
    : `${direct} direct · ${proxy} proxies${news ? ` · ${news.value} headlines` : ''} — ${moodEn}${net !== null ? ` (${pctEn(net)})` : ''}${basisEn ? `, ${basisEn}` : ''}`;
}

/** Hubs connected by trade/finance arcs — lit only when both ends read. */
export const GLOBE_ARCS_PAIRS = Object.freeze([
  ['us', 'eu'], ['eu', 'gulf'], ['gulf', 'cn'], ['cn', 'jp'], ['us', 'br'],
  ['ir', 'cn'], ['ru', 'cn'], ['us', 'jp'], ['cn', 'au'], ['eu', 'uk'],
  ['in', 'gulf'], ['za', 'cn'], ['br', 'cn'], ['ca', 'us'], ['sg', 'cn']
]);

/** One object with everything the 3-D globe renders. */
export function buildGlobeModel(data = {}, { isPersian = true } = {}) {
  const snaps = COUNTRIES.map((c) => buildCountrySnapshot(c, data, { isPersian }));
  const byId = new Map(snaps.map((s) => [s.country.id, s]));
  const arcs = GLOBE_ARCS_PAIRS
    .map(([a, b]) => {
      const A = byId.get(a); const B = byId.get(b);
      if (!A || !B) return null;
      return {
        from: a, to: b,
        lit: A.status !== 'unread' && B.status !== 'unread',
        strength: clamp(((A.net === null ? 0 : Math.abs(A.net)) + (B.net === null ? 0 : Math.abs(B.net))) / 4, 0.15, 1)
      };
    })
    .filter(Boolean);
  const read = snaps.filter((s) => s.status === 'read').length;
  const partial = snaps.filter((s) => s.status === 'partial').length;
  return {
    snaps, byId, arcs,
    coverage: { read, partial, unread: snaps.length - read - partial, total: snaps.length }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   6) GLOBAL CAPITAL FLOW MAP — where money is moving, node by node.
   The six-node reference route keeps its public shape; the 2026-10 upgrade
   adds the evidence rows, the magnitude behind each lit node and the measured
   flow leaders (tokens, chains, stablecoins, whales, class moves).
   ══════════════════════════════════════════════════════════════════════════ */

/** A price level in the reader's language, with the unit that makes it readable. */
const levelFor = (q, unitFa, unitEn, fa) => {
  const v = fmtLevel(q?.priceUsd, fa);
  if (v === null) return null;
  return fa ? `${v}${unitFa ? ` ${unitFa}` : ''}` : `${v}${unitEn ? ` ${unitEn}` : ''}`;
};

/** one row of the macro table: a resolved quote → both languages + provenance */
function anchorRow(id, fa, en, icon, q, { unitFa = '', unitEn = '', bond = null } = {}) {
  if (bond) {
    const yb = bond.yieldBp;
    const dir = signOf(yb);
    const bp = yb === null ? null : Math.abs(yb).toFixed(1);
    const sgn = yb > 0 ? '+' : yb < 0 ? '\u2212' : '';
    const lvl = bond.level;
    return {
      id, fa, en, icon,
      status: yb !== null ? 'move' : (lvl !== null ? 'level' : 'unread'),
      levelFa: lvl !== null ? `${faNum(lvl.toFixed(2))}\u066a` : null, levelEn: lvl !== null ? `${lvl.toFixed(2)}%` : null,
      moveFa: yb === null ? null : `${bond.estimate ? '\u2248 ' : ''}${sgn}${faNum(bp)} bp`,
      moveEn: yb === null ? null : `${bond.estimate ? '\u2248 ' : ''}${yb > 0 ? '+' : yb < 0 ? '-' : ''}${bp}bp`,
      dir, quality: bond.quality, source: bond.source,
      sourceFa: describeSource(bond.source, true), sourceEn: describeSource(bond.source, false),
      basisFa: bond.estimate ? 'از قیمت صندوق اوراق بلندمدت (TLT) با دیرش تقریبی ۱۶٫۵ سال؛ تخمین است' : null,
      basisEn: bond.estimate ? 'from the long-bond ETF (TLT) with a ~16.5y duration; an estimate' : null,
      magnitude: yb === null ? null : Math.abs(yb) / BENCH.bonds.sigma
    };
  }
  const move = num(q?.change1dPct);
  const hasLevel = num(q?.priceUsd) !== null;
  return {
    id, fa, en, icon,
    status: !q ? 'unread' : (move !== null ? 'move' : (hasLevel ? 'level' : 'unread')),
    levelFa: levelFor(q, unitFa, unitEn, true), levelEn: levelFor(q, unitFa, unitEn, false),
    moveFa: move === null ? null : pctFa(move), moveEn: move === null ? null : pctEn(move),
    dir: signOf(move),
    quality: q?.quality || null, source: q?.source || null,
    sourceFa: q?.source ? describeSource(q.source, true) : null, sourceEn: q?.source ? describeSource(q.source, false) : null,
    basisFa: q?.basisFa || null, basisEn: q?.basisEn || null,
    magnitude: move === null ? null : Math.abs(move)
  };
}

/**
 * THE MACRO TABLE — dollar, gold, silver, oil, copper, equities and the Treasury
 * curve in one place, each with its level, its daily move, HOW it was obtained
 * (direct / proxy / level only / last good read) and who supplied it.
 * REPORTED: «جریان سرمایه… داده طلا، دلار و اوراق دوباره ناقص است».
 */
export function buildMacroAnchors(data = {}) {
  const x = extractWorldInputs(data);
  const rows = [
    anchorRow('dollar', 'شاخص دلار', 'Dollar index', 'bank', x.dxy),
    anchorRow('gold', 'طلا', 'Gold', 'coin', x.gold, { unitFa: 'دلار / اونس', unitEn: 'USD/oz' }),
    anchorRow('silver', 'نقره', 'Silver', 'coin', x.silver, { unitFa: 'دلار / اونس', unitEn: 'USD/oz' }),
    anchorRow('wti', 'نفت وست‌تگزاس', 'WTI crude', 'flame', x.wti, { unitFa: 'دلار / بشکه', unitEn: 'USD/bbl' }),
    anchorRow('brent', 'نفت برنت', 'Brent crude', 'flame', x.brent, { unitFa: 'دلار / بشکه', unitEn: 'USD/bbl' }),
    anchorRow('copper', 'مس', 'Copper', 'layers', x.copper, { unitFa: 'دلار', unitEn: 'USD' }),
    anchorRow('spx', 'شاخص سهام آمریکا', 'US equity index', 'thermometer', x.spx),
    anchorRow('us10y', 'بازده اوراق ۱۰ ساله', 'US 10-year yield', 'chart', null, { bond: x.bond || { yieldBp: null, level: null, quality: null } }),
    x.us2y ? anchorRow('us2y', 'بازده اوراق ۲ ساله', 'US 2-year yield', 'chart', null, {
      bond: { yieldBp: num(x.us2y.change1dPct) !== null && num(x.us2y.priceUsd) !== null ? round(x.us2y.priceUsd * x.us2y.change1dPct, 1) : null, level: num(x.us2y.priceUsd), quality: x.us2y.quality, source: x.us2y.source, estimate: false }
    }) : null,
    x.us30y ? anchorRow('us30y', 'بازده اوراق ۳۰ ساله', 'US 30-year yield', 'chart', null, {
      bond: { yieldBp: num(x.us30y.change1dPct) !== null && num(x.us30y.priceUsd) !== null ? round(x.us30y.priceUsd * x.us30y.change1dPct, 1) : null, level: num(x.us30y.priceUsd), quality: x.us30y.quality, source: x.us30y.source, estimate: false }
    }) : null
  ].filter(Boolean);
  /* the 2s10s curve is a spread, not a quote: its own row when it was read */
  if (x.curve && num(x.curve.spreadPct) !== null) {
    const sp = Number(x.curve.spreadPct);
    rows.push({
      id: 'curve', fa: 'شیب منحنی ۲ به ۱۰', en: '2s10s curve', icon: 'chain', status: 'level',
      levelFa: `${faNum(sp.toFixed(2))} واحد`, levelEn: `${sp.toFixed(2)}pp`,
      moveFa: null, moveEn: null, dir: sp < 0 ? 'down' : sp > 0 ? 'up' : 'flat',
      quality: x.curve.derived ? QUALITY.PROXY : QUALITY.MEASURED, source: x.curve.source || null,
      sourceFa: x.curve.source ? describeSource(x.curve.source, true) : null, sourceEn: x.curve.source ? describeSource(x.curve.source, false) : null,
      basisFa: sp < 0 ? 'منحنی وارون است؛ نشانهٔ کلاسیک احتیاط' : null, basisEn: sp < 0 ? 'the curve is inverted; a classic caution sign' : null,
      magnitude: Math.abs(sp)
    });
  }
  const summary = { total: rows.length, direct: 0, proxy: 0, levelOnly: 0, stale: 0, unread: 0 };
  for (const r of rows) {
    if (r.status === 'unread') summary.unread += 1;
    else if (r.status === 'level' && r.id !== 'curve') summary.levelOnly += 1;
    else if (r.quality === QUALITY.PROXY) summary.proxy += 1;
    else if (r.quality === QUALITY.STALE) summary.stale += 1;
    else summary.direct += 1;
  }
  return { rows, summary };
}

export function buildFlowMap(data = {}) {
  const x = extractWorldInputs(data);
  const anchors = buildMacroAnchors(data).rows;
  const byId = (id) => anchors.find((r) => r.id === id);
  const fromAnchor = (id, fa, en) => {
    const r = byId(id);
    if (!r || r.status === 'unread') return { id, fa, en, status: 'unread', evidence: null };
    return {
      id, fa, en,
      status: r.status === 'move' ? 'ok' : 'level',
      dir: r.dir, value: r.moveEn, valueFa: r.moveFa, levelFa: r.levelFa, levelEn: r.levelEn,
      magnitude: r.magnitude, unit: id === 'treasuries' ? 'bp 1d' : '% 1d',
      source: r.source, sourceFa: r.sourceFa, sourceEn: r.sourceEn,
      quality: r.quality, basisFa: r.basisFa, basisEn: r.basisEn,
      evidence: [r.levelEn, r.moveEn].filter(Boolean).join(' · ') || null,
      evidenceFa: [r.levelFa, r.moveFa].filter(Boolean).join(' · ') || null
    };
  };
  const taken = (node, id) => ({ ...node, id });
  const nodes = [
    fromAnchor('dollar', 'دلار آمریکا', 'US Dollar'),
    fromAnchor('us10y', 'اوراق خزانهٔ آمریکا', 'US Treasuries'),
    fromAnchor('gold', 'طلا', 'Gold')
  ].map((n) => (n.id === 'dollar' ? taken(n, 'usd') : n.id === 'us10y' ? taken(n, 'treasuries') : n));

  /* crypto: the class average, or the BTC anchor as a labelled stand-in */
  {
    const avg = num(x.crypto?.avgChangePct);
    const btc = x.btc;
    const btcMove = num(btc?.change1dPct);
    const move = avg !== null ? avg : btcMove;
    const qual = avg !== null ? QUALITY.MEASURED : (btcMove !== null ? QUALITY.PROXY : null);
    nodes.push(move !== null ? {
      id: 'btc', fa: 'بیت‌کوین و رمزارزها', en: 'Bitcoin & crypto', status: 'ok',
      dir: signOf(move), value: pctEn(move), valueFa: pctFa(move), magnitude: Math.abs(move), unit: '% 24h',
      levelFa: num(btc?.priceUsd) !== null ? `بیت‌کوین ${fmtLevel(btc.priceUsd, true)} دلار` : null,
      levelEn: num(btc?.priceUsd) !== null ? `BTC ${fmtLevel(btc.priceUsd)} USD` : null,
      source: avg !== null ? 'cross-asset-engine' : btc?.source, quality: qual,
      sourceFa: avg !== null ? 'موتور بین‌دارایی' : describeSource(btc?.source, true),
      sourceEn: avg !== null ? 'cross-asset engine' : describeSource(btc?.source, false),
      basisFa: avg !== null ? `میانگین ${faNum(x.crypto?.withChange ?? x.crypto?.instruments ?? '')} ابزار رمزارزی` : 'بیت‌کوین به‌جای میانگین کلاس رمزارز',
      basisEn: avg !== null ? `average of ${x.crypto?.withChange ?? x.crypto?.instruments ?? ''} crypto instruments` : 'bitcoin stands in for the crypto class average',
      evidence: null, evidenceFa: null
    } : { id: 'btc', fa: 'بیت‌کوین و رمزارزها', en: 'Bitcoin & crypto', status: 'unread', evidence: null });
  }

  /* DeFi: stablecoin supply delta */
  {
    const net = num(x.chainFlows?.net24hUsd);
    nodes.push(net !== null ? {
      id: 'defi', fa: 'دیفای (استیبل‌کوین‌ها)', en: 'DeFi (stablecoins)', status: 'ok',
      dir: signOf(net), value: usdCompact(net).replace('+', ''), valueFa: usdFaCompact(net, { signed: false }),
      magnitude: Math.abs(net), unit: 'USD 24h', source: 'defillama', sourceFa: 'DefiLlama', sourceEn: 'DefiLlama', quality: QUALITY.MEASURED,
      levelFa: x.chainFlows.topInflowChain ? `بیشترین ورودی: ${chainFa(x.chainFlows.topInflowChain.chain)}` : null,
      levelEn: x.chainFlows.topInflowChain ? `top inflow: ${x.chainFlows.topInflowChain.chain}` : null,
      evidence: null, evidenceFa: null
    } : { id: 'defi', fa: 'دیفای (استیبل‌کوین‌ها)', en: 'DeFi (stablecoins)', status: 'unread', evidence: null });
  }

  /* RWA: the venue's own daily candles */
  {
    const inst = x.rwaInstruments;
    const ch = inst.map((i) => num(i.change24hPct)).filter((v) => v !== null);
    const avg = ch.length ? round(ch.reduce((a, c) => a + c, 0) / ch.length) : num(x.rwa?.avgChangePct);
    if (!inst.length && !x.rwa) {
      nodes.push({ id: 'rwa', fa: 'دارایی‌های واقعی', en: 'Real-world assets', status: 'unread', evidence: null });
    } else if (avg === null) {
      nodes.push({ id: 'rwa', fa: 'دارایی‌های واقعی', en: 'Real-world assets', status: 'level', quality: QUALITY.LEVEL,
        levelFa: `${faNum(inst.length)} ابزار قیمت‌دار`, levelEn: `${inst.length} priced instruments`, source: x.envel.rwa?.source || null, sourceFa: 'Ostium', sourceEn: 'Ostium', evidence: null });
    } else {
      nodes.push({
        id: 'rwa', fa: 'دارایی‌های واقعی', en: 'Real-world assets', status: 'ok',
        dir: signOf(avg), value: pctEn(avg), valueFa: pctFa(avg), magnitude: Math.abs(avg), unit: '% 24h avg',
        source: x.envel.rwa?.source || 'cross-asset-engine', sourceFa: 'Ostium', sourceEn: 'Ostium', quality: QUALITY.MEASURED,
        levelFa: inst.length ? `${faNum(ch.length || inst.length)} از ${faNum(inst.length)} ابزار` : null,
        levelEn: inst.length ? `${ch.length || inst.length} of ${inst.length} instruments` : null,
        evidence: null, evidenceFa: null
      });
    }
  }

  const lit = (n) => n.status === 'ok' || n.status === 'level';
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      from: nodes[i].id, to: nodes[i + 1].id,
      active: lit(nodes[i]) && lit(nodes[i + 1]),
      strength: clamp((((nodes[i].magnitude ?? 0) + (nodes[i + 1].magnitude ?? 0)) / 2) / 2, 0.15, 1),
      labelFa: lit(nodes[i]) && lit(nodes[i + 1]) ? `${nodes[i].fa} → ${nodes[i + 1].fa}` : null
    });
  }
  return { nodes, edges };
}

/** The measured flow leaders behind the route — every number from this pass. */
export function buildCapitalFlow(data = {}) {
  const x = extractWorldInputs(data);
  const route = buildFlowMap(data);

  const token = x.tokenFlows ? {
    status: 'ok',
    source: x.tokenFlows.source || 'coingecko',
    count: num(x.tokenFlows.count),
    inflowUsd: num(x.tokenFlows.totals?.inflowUsd),
    outflowUsd: num(x.tokenFlows.totals?.outflowUsd),
    netUsd: num(x.tokenFlows.totals?.netUsd),
    leaders: arr(x.tokenFlows.inflows).slice(0, 5).map((t) => ({
      symbol: t.symbol, name: t.name, valueUsd: num(t.mcapChangeUsd), changePct: num(t.change24hPct), dir: 'in', source: 'coingecko'
    })).concat(arr(x.tokenFlows.outflows).slice(0, 5).map((t) => ({
      symbol: t.symbol, name: t.name, valueUsd: num(t.mcapChangeUsd), changePct: num(t.change24hPct), dir: 'out', source: 'coingecko'
    })))
  } : { status: 'unread', leaders: [] };

  const stable = x.chainFlows ? {
    status: 'ok',
    source: x.chainFlows.source || 'defillama',
    net24hUsd: num(x.chainFlows.net24hUsd),
    net7dUsd: num(x.chainFlows.net7dUsd),
    net24hPct: num(x.chainFlows.net24hPct),
    totalUsd: num(x.chainFlows.totalCirculatingUsd),
    assets: num(x.chainFlows.assets),
    chains: arr(x.chainFlows.chainInflows).slice(0, 5).map((c) => ({ chain: c.chain, net24hUsd: num(c.net24hUsd), net24hPct: num(c.net24hPct), currentUsd: num(c.currentUsd), dir: 'in' }))
      .concat(arr(x.chainFlows.chainOutflows).slice(0, 5).map((c) => ({ chain: c.chain, net24hUsd: num(c.net24hUsd), net24hPct: num(c.net24hPct), currentUsd: num(c.currentUsd), dir: 'out' }))),
    assets_: arr(x.chainFlows.topAssets).slice(0, 5).map((a) => ({ symbol: a.symbol, net24hUsd: num(a.net24hUsd), net7dUsd: num(a.net7dUsd), circulatingUsd: num(a.circulatingUsd), pegType: a.pegType }))
  } : { status: 'unread', chains: [], assets_: [] };

  const classMoves = Object.entries(x.classes)
    .map(([cls, c]) => ({
      cls, avg: num(c?.avgChangePct), advancing: num(c?.advancing), declining: num(c?.declining),
      withChange: num(c?.withChange), instruments: num(c?.instruments),
      top: arr(c?.top).slice(0, 2), bottom: arr(c?.bottom).slice(0, 2), readOnly: cls !== 'crypto'
    }))
    .filter((c) => c.avg !== null || c.instruments);

  const whales = {
    status: x.whales ? 'ok' : 'unread',
    count: num(x.whales?.count),
    events: arr(x.whales?.events).slice(0, 8).map((e) => ({ symbol: e.symbol, chain: e.chain, valueUsd: num(e.valueUsd), flow: e.flow, at: num(e.at) })),
    smartNet: smartMoneyNet(x),
    smartTokens: arr(x.sm?.topTokens).slice(0, 5).map((t) => ({
      symbol: t.symbol, chain: t.chain, valueUsd: num(t.valueUsd), netUsd: num(t.netUsd), signal: t.signal || t.flow, confidence: num(t.confidence)
    })),
    window: x.sm?.window || null
  };

  /* The net measured flow verdict — real totals only, never a projection. */
  const netBits = [
    stable.status === 'ok' && stable.net24hUsd !== null ? { id: 'stablecoin', value: stable.net24hUsd } : null,
    token.status === 'ok' && token.netUsd !== null ? { id: 'tokenMcap', value: token.netUsd } : null,
    whales.smartNet !== null ? { id: 'smartMoney', value: whales.smartNet } : null
  ].filter(Boolean);
  const netSum = netBits.length ? netBits.reduce((s, b) => s + b.value, 0) : null;
  const verdict = netSum === null ? null : {
    netUsd: round(netSum),
    dir: signOf(netSum),
    bits: netBits,
    labelFa: netSum > 0 ? 'جریان خالص به سمت دارایی‌های پرریسک' : netSum < 0 ? 'جریان خالص به سمت نقد/خروج' : 'جریان خالص خنثی',
    labelEn: netSum > 0 ? 'net flow toward risk assets' : netSum < 0 ? 'net flow toward cash / out' : 'net flow flat'
  };
  return { route, anchors: buildMacroAnchors(data), token, stable, classMoves, whales, verdict, at: num(x.tokenFlows?.at) || null };
}

/* ══════════════════════════════════════════════════════════════════════════
   7) MACRO TRANSMISSION — oil → inflation → yields → dollar → EM → crypto.
   Every node carries the real reading (or says it is a model/proxy node) and
   the edges light only when both endpoints were read.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildTransmission(data = {}) {
  const x = extractWorldInputs(data);
  const oilParts = [x.wti, x.brent].filter((q) => q && num(q.change1dPct) !== null);
  const energyAvg = oilParts.length ? round(oilParts.reduce((a, q) => a + q.change1dPct, 0) / oilParts.length) : null;
  const oilQuality = !oilParts.length ? null
    : oilParts.some((q) => q.quality === QUALITY.STALE) ? QUALITY.STALE
      : oilParts.every((q) => q.quality === QUALITY.MEASURED) ? QUALITY.MEASURED : QUALITY.PROXY;
  const mk = (id, fa, en, icon, reading, evidence, evidenceFa) => ({ id, fa, en, icon, evidence: evidence || null, evidenceFa: evidenceFa || null, ...reading });
  const srcOf = (q) => (q?.source ? { source: q.source, sourceFa: describeSource(q.source, true), sourceEn: describeSource(q.source, false) } : { source: null, sourceFa: null, sourceEn: null });

  const bond = x.bond;
  const bondBp = bond && bond.yieldBp !== null ? bond.yieldBp : null;
  const bpTxt = (v, fa) => `${v > 0 ? '+' : v < 0 ? (fa ? '\u2212' : '-') : ''}${fa ? faNum(Math.abs(v).toFixed(1)) : Math.abs(v).toFixed(1)}${fa ? ' bp' : 'bp'}`;

  const nodes = [
    mk('oil', 'نفت خام', 'Crude oil', 'flame', energyAvg !== null
      ? {
        state: 'read', dir: signOf(energyAvg), value: pctEn(energyAvg), valueFa: pctFa(energyAvg), quality: oilQuality, ...srcOf(oilParts[0]),
        meters: [num(x.wti?.change7dPct) !== null ? { key: 'wti7d', value: num(x.wti.change7dPct) } : null].filter(Boolean)
      }
      : { state: 'unread' },
      energyAvg !== null ? `WTI ${pctEn(num(x.wti?.change1dPct))} · Brent ${pctEn(num(x.brent?.change1dPct))}` : null,
      energyAvg !== null ? [
        num(x.wti?.change1dPct) !== null ? `وست‌تگزاس ${pctFa(x.wti.change1dPct)}` : null,
        num(x.brent?.change1dPct) !== null ? `برنت ${pctFa(x.brent.change1dPct)}` : null
      ].filter(Boolean).join(' · ') : null),
    mk('inflation', 'انتظارات تورمی', 'Inflation expectations', 'pulse', energyAvg !== null
      ? { state: 'proxy', dir: signOf(energyAvg), value: null, source: null, noteFa: 'پروکسی: از حرکت انرژی', noteEn: 'proxy: from the energy move' }
      : { state: 'unread' },
      energyAvg !== null ? 'energy move used as the inflation-expectations proxy' : null,
      energyAvg !== null ? 'حرکت انرژی به‌جای انتظارات تورمی استفاده شده است' : null),
    mk('yields', 'بازده اوراق', 'Bond yields', 'chart', bondBp !== null
      ? {
        state: bond.kind === 'yield' ? 'read' : 'proxy', dir: signOf(bondBp), value: bpTxt(bondBp, false), valueFa: bpTxt(bondBp, true),
        quality: bond.quality, ...srcOf(bond),
        noteFa: bond.kind === 'yield' ? null : 'پروکسی: تخمین از قیمت صندوق اوراق بلندمدت',
        noteEn: bond.kind === 'yield' ? null : 'proxy: estimated from the long-bond ETF price',
        meters: [x.curve ? { key: 'curve2s10s', value: x.curve.spreadPct } : null].filter(Boolean)
      }
      : (bond && bond.level !== null
        ? { state: 'read', dir: 'flat', value: null, quality: QUALITY.LEVEL, ...srcOf(bond), meters: [x.curve ? { key: 'curve2s10s', value: x.curve.spreadPct } : null].filter(Boolean) }
        : { state: 'unread' }),
      bond && bond.level !== null ? `US10Y @ ${bond.level.toFixed(2)}%${x.curve ? ` · 2s10s ${x.curve.spreadPct}pp` : ''}` : (bondBp !== null ? `TLT ${pctEn(bond.movePct)}` : null),
      bond && bond.level !== null ? `بازده ۱۰ ساله ${faNum(bond.level.toFixed(2))}٪${x.curve ? ` · شیب ۲ به ۱۰ ${faNum(x.curve.spreadPct)}` : ''}` : (bondBp !== null ? `قیمت صندوق اوراق بلندمدت ${pctFa(bond.movePct)}` : null)),
    mk('usd', 'دلار آمریکا', 'US Dollar', 'bank', num(x.dxy?.change1dPct) !== null
      ? { state: 'read', dir: signOf(x.dxy.change1dPct), value: pctEn(x.dxy.change1dPct), valueFa: pctFa(x.dxy.change1dPct), quality: x.dxy.quality, ...srcOf(x.dxy), meters: [] }
      : { state: 'unread' },
      num(x.dxy?.priceUsd) !== null ? `${x.dxy.symbol || 'DXY'} @ ${x.dxy.priceUsd}` : null,
      num(x.dxy?.priceUsd) !== null ? `شاخص دلار ${faNum(Number(x.dxy.priceUsd).toFixed(1))}` : (x.dxy?.basisFa || null)),
    mk('em', 'فشار بازارهای نوظهور', 'Emerging-market pressure', 'globe', num(x.dxy?.change1dPct) !== null
      ? { state: 'model', dir: signOf(x.dxy.change1dPct), value: null, source: null, noteFa: 'گرهٔ مدل — فقط با خوانش دلار فعال می‌شود', noteEn: 'model node — activates only with the dollar read' }
      : { state: 'unread' },
      null, null),
    mk('cryptoliq', 'نقدینگی رمزارز', 'Crypto liquidity', 'coin', (() => {
      const avg = num(x.crypto?.avgChangePct);
      const net = num(x.chainFlows?.net24hUsd);
      if (avg !== null) return { state: 'read', dir: signOf(avg), value: pctEn(avg), valueFa: pctFa(avg), quality: QUALITY.MEASURED, source: 'cross-asset-engine', sourceFa: 'موتور بین‌دارایی', sourceEn: 'cross-asset engine', meters: net !== null ? [{ key: 'stablecoinNet', value: net }] : [] };
      if (net !== null) return { state: 'read', dir: signOf(net), value: usdCompact(net).replace('+', ''), valueFa: usdFaCompact(net, { signed: false }), quality: QUALITY.MEASURED, source: 'defillama', sourceFa: 'DefiLlama', sourceEn: 'DefiLlama', meters: [] };
      return { state: 'unread' };
    })(),
      num(x.chainFlows?.net24hUsd) !== null ? `stablecoin net ${usdCompact(x.chainFlows.net24hUsd)}` : null,
      num(x.chainFlows?.net24hUsd) !== null ? `خالص استیبل‌کوین ${usdFaCompact(x.chainFlows.net24hUsd)}` : null)
  ];
  /* each node's move in units of a normal day, so an edge can ask «did the
     downstream market actually do what the mechanism predicts?» — and only
     when both ends moved by more than a quiet day */
  const zFor = {
    oil: energyAvg === null ? null : zOf(energyAvg, BENCH.oil.sigma),
    inflation: energyAvg === null ? null : zOf(energyAvg, BENCH.oil.sigma),
    yields: bondBp === null ? null : zOf(bondBp, BENCH.bonds.sigma),
    usd: zOf(num(x.dxy?.change1dPct), BENCH.dollar.sigma),
    em: zOf(num(x.dxy?.change1dPct), BENCH.dollar.sigma),
    cryptoliq: zOf(num(x.crypto?.avgChangePct) ?? num(x.btc?.change1dPct), BENCH.crypto.sigma)
  };
  for (const n of nodes) n.z = zFor[n.id] === null || zFor[n.id] === undefined ? null : round(zFor[n.id], 2);

  const MECH = {
    'oil>inflation': { sign: 1, identity: true, fa: 'انرژی گران‌تر هزینهٔ همه‌چیز را بالا می‌برد', en: 'dearer energy lifts costs everywhere' },
    'inflation>yields': { sign: 1, fa: 'تورم بالاتر معمولاً بازده اوراق را بالا می‌برد', en: 'higher inflation tends to lift bond yields' },
    'yields>usd': { sign: 1, fa: 'بازده بالاتر دلار را جذاب‌تر می‌کند', en: 'higher yields make the dollar more attractive' },
    'usd>em': { sign: 1, identity: true, fa: 'دلار قوی‌تر به بازارهای نوظهور فشار می‌آورد', en: 'a stronger dollar pressures emerging markets' },
    'em>cryptoliq': { sign: -1, fa: 'فشار نوظهور بیشتر، نقدینگی رمزارز را کم می‌کند', en: 'more EM pressure drains crypto liquidity' }
  };
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i]; const b = nodes[i + 1];
    const key = `${a.id}>${b.id}`;
    const mech = MECH[key] || null;
    let agree = null;
    let agreeFa = null; let agreeEn = null;
    if (mech && !mech.identity && a.state !== 'unread' && b.state !== 'unread') {
      const za = a.z; const zb = b.z;
      if (za !== null && zb !== null && Math.abs(za) >= 0.5 && Math.abs(zb) >= 0.5) {
        agree = Math.sign(za) * mech.sign === Math.sign(zb);
        agreeFa = agree ? 'خوانش با سازوکار همخوان است' : 'خوانش با سازوکار نظری ناهمخوان است';
        agreeEn = agree ? 'the reading agrees with the mechanism' : 'the reading contradicts the textbook mechanism';
      } else {
        agreeFa = 'حرکت‌ها آرام‌تر از آن است که همخوانی سنجیده شود'; agreeEn = 'moves are too quiet to test the mechanism';
      }
    }
    edges.push({
      from: a.id, to: b.id,
      lit: a.state !== 'unread' && b.state !== 'unread',
      labelFa: `${a.fa} → ${b.fa}`,
      labelEn: `${a.en} → ${b.en}`,
      mechFa: mech?.fa || null, mechEn: mech?.en || null, identity: !!mech?.identity,
      agree, agreeFa, agreeEn
    });
  }
  const tested = edges.filter((e) => e.agree !== null);
  return {
    nodes, edges, origin: 'local',
    consistency: {
      tested: tested.length, agreed: tested.filter((e) => e.agree).length,
      read: nodes.filter((n) => n.state !== 'unread').length, total: nodes.length
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   8) FUTURE TREE — bull / base / stress scenarios with model weights.
   The weights are a transparent function of THIS pass's readings; every
   applied nudge is listed with its real value, and every scenario names the
   reading that would move it (the «flip» list) so the arithmetic is auditable.
   ══════════════════════════════════════════════════════════════════════════ */

export const FUTURE_ASSETS = Object.freeze(['btc', 'gold', 'dollar', 'equity']);

/** driver id → both languages (kept exported: the panel prints these) */
export const FUTURE_DRIVER_LABEL = Object.freeze({
  stablecoinInflow: { fa: 'ورود استیبل‌کوین', en: 'stablecoin inflow' },
  stablecoinOutflow: { fa: 'خروج استیبل‌کوین', en: 'stablecoin outflow' },
  smartMoneyAccumulation: { fa: 'انباشت پول هوشمند', en: 'smart-money accumulation' },
  smartMoneyDistribution: { fa: 'توزیع پول هوشمند', en: 'smart-money distribution' },
  riskOnRegime: { fa: 'رژیم ریسک‌پذیر', en: 'risk-on regime' },
  riskOffRegime: { fa: 'رژیم ریسک‌گریز', en: 'risk-off regime' },
  rangeMarket: { fa: 'بازار رِنج', en: 'range market' },
  crossClassDivergence: { fa: 'واگرایی کلاس‌ها', en: 'cross-class divergence' },
  invertedCurve: { fa: 'منحنی بازده وارون', en: 'inverted curve' },
  recessionWatch: { fa: 'هشدار رکود', en: 'recession watch' },
  growthWatch: { fa: 'هشدار رشد', en: 'growth watch' },
  dollarStrength: { fa: 'دلار قوی', en: 'dollar strength' },
  dollarWeakness: { fa: 'دلار ضعیف', en: 'dollar weakness' },
  energyPressure: { fa: 'فشار انرژی', en: 'energy pressure' },
  breadthPositive: { fa: 'گستردگی مثبت', en: 'positive breadth' },
  breadthNegative: { fa: 'گستردگی منفی', en: 'negative breadth' },
  whaleCount: { fa: 'فعالیت نهنگ', en: 'whale activity' }
});

export function buildFutureTree(data = {}, asset = 'btc') {
  const x = extractWorldInputs(data);
  const nudges = [];
  let bull = 34; let base = 46; let stress = 20;
  const apply = (target, amount, key, value, evidence) => {
    if (target === 'bull') bull += amount; else if (target === 'stress') stress += amount; else base += amount;
    nudges.push({ key, value, target, amount, evidence: evidence || null });
  };

  const regime = x.regime;
  if (regime === 'RISK_ON' || regime === 'RISK_ON_LEANING') apply('bull', 8, 'riskOnRegime', regime, 'cross-asset regime read');
  else if (regime === 'RISK_OFF' || regime === 'RISK_OFF_LEANING') apply('stress', 8, 'riskOffRegime', regime, 'cross-asset regime read');

  const outlookLabel = String(x.outlook?.label || '');
  if (outlookLabel === 'GROWTH_WATCH') apply('bull', 6, 'growthWatch', outlookLabel, `outlook score ${x.outlook?.score ?? '—'}`);
  if (outlookLabel === 'RECESSION_WATCH') apply('stress', 6, 'recessionWatch', outlookLabel, `outlook score ${x.outlook?.score ?? '—'}`);

  const stableNet = num(x.chainFlows?.net24hUsd);
  if (stableNet !== null) {
    if (stableNet > 0) apply('bull', 5, 'stablecoinInflow', `+${usdCompact(stableNet).replace('+', '')}`, 'defillama stablecoin supply delta');
    else if (stableNet < 0) apply('stress', 5, 'stablecoinOutflow', usdCompact(stableNet).replace('-', '\u2212'), 'defillama stablecoin supply delta');
  }
  if (x.curve && num(x.curve.spreadPct) < 0) apply('stress', 4, 'invertedCurve', `${x.curve.spreadPct}pp`, '2s10s spread');

  const dxyChg = num(x.dxy?.change1dPct);
  if (dxyChg !== null && asset !== 'dollar') {
    if (dxyChg > 0.3) apply('stress', 3, 'dollarStrength', pctEn(dxyChg), `DXY 1d`);
    else if (dxyChg < -0.3) apply('bull', 3, 'dollarWeakness', pctEn(dxyChg), `DXY 1d`);
  }
  const smNet = smartMoneyNet(x);
  if (smNet !== null && (asset === 'btc')) {
    if (smNet > 0) apply('bull', 4, 'smartMoneyAccumulation', usdCompact(smNet).replace('+', ''), 'labelled smart-money net');
    else apply('stress', 4, 'smartMoneyDistribution', usdCompact(smNet).replace('-', '\u2212'), 'labelled smart-money net');
  }

  /* breadth + energy: the two readings the 2026-10 upgrade added to the tree */
  {
    const moves = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
    if (moves.length) {
      const up = moves.filter((v) => v > 0).length;
      const share = up / moves.length;
      if (share >= 0.6) apply('bull', 2, 'breadthPositive', `${up}/${moves.length}`, 'per-class 24h breadth');
      else if (share <= 0.34) apply('stress', 2, 'breadthNegative', `${up}/${moves.length}`, 'per-class 24h breadth');
    }
    const oil = [num(x.wti?.change1dPct), num(x.brent?.change1dPct)].filter((v) => v !== null);
    if (oil.length) {
      const avg = oil.reduce((a, c) => a + c, 0) / oil.length;
      if (avg >= 1.5 && asset !== 'dollar') apply('stress', 2, 'energyPressure', pctEn(avg), 'crude 1d');
    }
    const whaleCount = num(x.whales?.count);
    if (whaleCount !== null && whaleCount >= 10) apply('base', 1, 'whaleCount', String(whaleCount), 'whales scanner count');
  }

  bull = clamp(bull, 5, 80); stress = clamp(stress, 5, 80); base = Math.max(5, 100 - bull - stress);
  const total = bull + base + stress;
  const W = (v) => Math.round((v / total) * 100);

  const drivers = {
    bull: [
      stableNet !== null && stableNet > 0 ? 'stablecoinInflow' : null,
      smNet !== null && smNet > 0 ? 'smartMoneyAccumulation' : null,
      regime.includes('RISK_ON') ? 'riskOnRegime' : null,
      outlookLabel === 'GROWTH_WATCH' ? 'growthWatch' : null,
      x.tokenFlows?.topInflow ? `topInflow:${x.tokenFlows.topInflow.symbol}` : null
    ].filter(Boolean),
    base: ['rangeMarket', ...(x.divergences.length ? ['crossClassDivergence'] : [])],
    stress: [
      x.curve && num(x.curve.spreadPct) < 0 ? 'invertedCurve' : null,
      outlookLabel === 'RECESSION_WATCH' ? 'recessionWatch' : null,
      dxyChg !== null && dxyChg > 0.3 ? 'dollarStrength' : null,
      stableNet !== null && stableNet < 0 ? 'stablecoinOutflow' : null,
      smNet !== null && smNet < 0 ? 'smartMoneyDistribution' : null
    ].filter(Boolean)
  };

  /* The asset's measured move anchors the header. */
  const anchor = asset === 'btc' ? { change: num(x.crypto?.avgChangePct), label: 'crypto class', labelFa: 'کلاس رمزارز' }
    : asset === 'gold' ? { change: num(x.gold?.change1dPct), label: x.gold?.symbol || 'GOLD', labelFa: 'طلا' }
    : asset === 'dollar' ? { change: dxyChg, label: x.dxy?.symbol || 'DXY', labelFa: 'شاخص دلار' }
    : { change: num(x.spx?.change1dPct), label: x.spx?.symbol || 'SPX', labelFa: 'شاخص سهام' };

  /* What would move the tree — each line names the real reading it watches. */
  const flip = [
    stableNet !== null ? {
      key: 'liquidity', textFa: `اگر جریان خالص استیبل‌کوین به ${stableNet > 0 ? 'خروج' : 'ورود'} بچرخد`,
      textEn: `if the stablecoin net flips to ${stableNet > 0 ? 'outflow' : 'inflow'}`, readingFa: `الان ${usdCompact(stableNet).replace('+', '')}`, readingEn: `now ${usdCompact(stableNet)}`
    } : null,
    dxyChg !== null ? {
      key: 'dollar', textFa: `اگر دلار ${dxyChg > 0 ? 'به زیر ۰٪' : 'بالای ۰٫۳٪'} بسته شود`,
      textEn: `if the dollar closes ${dxyChg > 0 ? 'below 0%' : 'above +0.3%'}`, readingFa: `الان ${pctFa(dxyChg)}`, readingEn: `now ${pctEn(dxyChg)}`
    } : null,
    x.curve ? {
      key: 'curve', textFa: `اگر شیب ۲/۱۰ از ${num(x.curve.spreadPct) < 0 ? 'منفی خارج' : 'منفی'} شود`,
      textEn: `if the 2s10s slope ${num(x.curve.spreadPct) < 0 ? 'leaves negative' : 'turns negative'}`, readingFa: `الان ${x.curve.spreadPct} واحد`, readingEn: `now ${x.curve.spreadPct}pp`
    } : null,
    outlookLabel ? {
      key: 'outlook', textFa: 'اگر برچسب چشم‌انداز موتور عوض شود',
      textEn: 'if the engine outlook label changes', readingFa: OUTLOOK_LABEL_FA[outlookLabel] || outlookLabel, readingEn: outlookLabel
    } : null
  ].filter(Boolean);

  return { asset, weights: { bull: W(bull), base: W(base), stress: W(stress) }, nudges, drivers, anchor, flip, baseRate: { bull, base, stress, total } };
}

/* ══════════════════════════════════════════════════════════════════════════
   9) ADVERSARIAL CHALLENGER — the case against the pass's top opportunity.
   Every counterargument says whether it was OBSERVED in this pass (with the
   reading behind it) or is a standing risk the model always carries.
   ══════════════════════════════════════════════════════════════════════════ */

/** typical daily σ of each asset class's AVERAGE move (model constants, see calibration.js) */
const CLASS_SIGMA = Object.freeze({ crypto: 2.8, stocks: 1.0, forex: 0.45, commodities: 1.2, rwa: 0.9 });
const CLASS_NAME_FA = Object.freeze({ crypto: 'رمزارز', stocks: 'سهام', forex: 'ارز', commodities: 'کالا', rwa: 'دارایی واقعی' });
const CLASS_NAME_EN = Object.freeze({ crypto: 'crypto', stocks: 'stocks', forex: 'forex', commodities: 'commodities', rwa: 'RWA' });

export const CHALLENGE_META = Object.freeze({
  macro: { fa: 'ریسک کلان', en: 'Macro risk', icon: 'bank', whyFa: 'نشانه‌های کلاسیک احتیاط معمولاً پیش از ضعف دارایی‌های پرریسک می‌آیند.', whyEn: 'classic caution signs usually arrive before risk assets weaken.' },
  liquidity: { fa: 'خروج نقدینگی', en: 'Liquidity outflow', icon: 'drop', whyFa: 'وقتی دلار از زنجیره‌ها بیرون می‌رود، سوخت خرید کم می‌شود.', whyEn: 'when dollars leave the chains, buying fuel runs low.' },
  dollar: { fa: 'باد مخالف دلار', en: 'Dollar headwind', icon: 'wind', whyFa: 'دلار قوی‌تر معمولاً به دارایی‌های پرریسک فشار می‌آورد.', whyEn: 'a firmer dollar usually pressures risk assets.' },
  whale: { fa: 'خروج پول هوشمند', en: 'Smart-money exit', icon: 'waves', whyFa: 'اگر کیف‌پول‌های برچسب‌دار می‌فروشند، صعود ممکن است شکننده باشد.', whyEn: 'if labelled wallets are selling, the rally may be fragile.' },
  divergence: { fa: 'واگرایی بازارها', en: 'Market divergence', icon: 'swap', whyFa: 'وقتی دو کلاس دارایی جهت مخالف دارند، یکی از آن‌ها اشتباه می‌خواند.', whyEn: 'when two asset classes disagree, one of them is misreading.' },
  volatility: { fa: 'تلاطم بالا', en: 'Elevated volatility', icon: 'pulse', whyFa: 'حرکت‌های بزرگ‌تر از روز معمول، اعتبار هر سیگنال را کم می‌کند.', whyEn: 'moves larger than a normal day weaken any single signal.' },
  coverage: { fa: 'شکاف داده', en: 'Data gap', icon: 'eye', whyFa: 'بخشی از جهان در این دور خوانده نشده است؛ نتیجه کامل نیست.', whyEn: 'part of the world was not read this pass; the picture is incomplete.' },
  model: { fa: 'ریسک مدل', en: 'Model risk', icon: 'gauge', whyFa: 'همهٔ حساسیت‌ها اجزای مرتبهٔ اول مدل‌اند، نه ضرایب اندازه‌گیری‌شده.', whyEn: 'all sensitivities are first-order model terms, not measured betas.' }
});

export function buildChallenger(data = {}) {
  const x = extractWorldInputs(data);

  /* Find the strongest positive signal — that is the thesis to attack. */
  let opp = null;
  const cryptoAvg = num(x.crypto?.avgChangePct);
  if (x.tokenFlows?.topInflow && num(x.tokenFlows.topInflow.mcapChangeUsd) > 0) {
    const t0 = x.tokenFlows.topInflow;
    opp = {
      id: 'tokenInflow', label: `${t0.symbol}`, detail: 'top capital inflow (CoinGecko 24h market-cap delta)', value: `+${round(t0.mcapChangePct)}%`,
      kindFa: 'بیشترین ورود سرمایه', kindEn: 'largest capital inflow', subject: t0.symbol,
      detailFa: `افزایش ارزش بازار در ۲۴ ساعت: ${usdFaCompact(t0.mcapChangeUsd, { signed: false })}`, detailEn: `24h market-cap gain: ${usdCompact(t0.mcapChangeUsd).replace('+', '')}`,
      valueFa: pctFa(t0.mcapChangePct)
    };
  } else if (cryptoAvg !== null && cryptoAvg > 0) {
    opp = {
      id: 'cryptoClass', label: 'crypto class', detail: 'positive measured 24h class average', value: `+${round(cryptoAvg)}%`,
      kindFa: 'صعود کلاس رمزارز', kindEn: 'crypto class rising', subject: null,
      detailFa: 'میانگین اندازه‌گیری‌شدهٔ ۲۴ ساعتهٔ رمزارزها مثبت است', detailEn: 'the measured 24h class average is positive', valueFa: pctFa(cryptoAvg)
    };
  } else if (x.chainFlows?.topInflowChain) {
    const c0 = x.chainFlows.topInflowChain;
    opp = {
      id: 'chainInflow', label: c0.chain, detail: 'top stablecoin inflow chain', value: `$${Math.round(Math.abs(c0.net24hUsd || 0) / 1e6)}M`,
      kindFa: 'بیشترین ورود استیبل‌کوین', kindEn: 'largest stablecoin inflow', subject: c0.chain,
      detailFa: `ورود خالص استیبل‌کوین به ${chainFa(c0.chain)}`, detailEn: `net stablecoin inflow to ${c0.chain}`,
      valueFa: usdFaCompact(c0.net24hUsd, { signed: false })
    };
  }
  if (!opp) return { opportunity: null, arguments: [], observed: 0, summary: null };
  opp.subjectFa = opp.subject ? (opp.id === 'chainInflow' ? chainFa(opp.subject) : opp.subject) : null;

  const stableNet = num(x.chainFlows?.net24hUsd);
  const smNet = smartMoneyNet(x);
  const dxyChg = num(x.dxy?.change1dPct);
  const dxyZ = dxyChg === null ? null : zOf(dxyChg, BENCH.dollar.sigma);
  const inverted = x.curve && num(x.curve.spreadPct) < 0;
  const recession = String(x.outlook?.label) === 'RECESSION_WATCH';
  /* the widest class move, in units of THAT class's normal day */
  const widest = (() => {
    let best = null;
    for (const [cls, c] of Object.entries(x.classes || {})) {
      const avg = num(c?.avgChangePct);
      if (avg === null || !CLASS_SIGMA[cls]) continue;
      const z = avg / CLASS_SIGMA[cls];
      if (!best || Math.abs(z) > Math.abs(best.z)) best = { cls, avg, z };
    }
    return best;
  })();
  const div0 = x.divergences[0] || null;
  const missing = x.missingDomains.length || 0;

  const mk = (id, observed, evidence, evidenceFa, severity) => ({
    id, key: `${id}Risk`, observed: !!observed, evidence: observed ? evidence : (evidence || null), evidenceFa: observed ? evidenceFa : (evidenceFa || null),
    severity: observed ? clamp(severity ?? 0.5, 0.1, 1) : 0,
    titleFa: CHALLENGE_META[id].fa, titleEn: CHALLENGE_META[id].en, whyFa: CHALLENGE_META[id].whyFa, whyEn: CHALLENGE_META[id].whyEn, icon: CHALLENGE_META[id].icon
  });

  const args = [
    mk('macro', recession || inverted,
      inverted ? `2s10s inverted at ${x.curve.spreadPct}pp` : String(x.outlook?.label || ''),
      inverted ? `منحنی بازده ۲ به ۱۰ وارون است (${faNum(x.curve.spreadPct)} واحد)` : (recession ? 'چشم‌انداز موتور: هشدار رکود' : null),
      recession && inverted ? 0.9 : recession ? 0.85 : 0.65),
    mk('liquidity', stableNet !== null && stableNet < 0,
      stableNet !== null ? `stablecoin net ${usdCompact(stableNet)}` : null,
      stableNet !== null ? `عرضهٔ استیبل‌کوین ${usdFaCompact(Math.abs(stableNet), { signed: false })} کم شد` : null,
      stableNet === null ? 0 : Math.abs(stableNet) / LIQUIDITY_SCALE_USD),
    mk('dollar', dxyZ !== null && dxyZ >= 0.5,
      dxyChg !== null ? `DXY ${pctEn(dxyChg)}` : null,
      dxyChg !== null ? `شاخص دلار ${pctFa(dxyChg)} بالا رفت (${faNum(Math.abs(dxyZ).toFixed(1))} برابر روز معمول)` : null,
      dxyZ === null ? 0 : dxyZ / 2.5),
    mk('whale', smNet !== null && smNet < 0,
      smNet !== null ? `labelled net ${usdCompact(smNet)}` : null,
      smNet !== null ? `جریان خالص برچسب‌دار ${usdFaCompact(smNet)}` : null,
      smNet === null ? 0 : Math.abs(smNet) / 20_000_000),
    mk('divergence', x.divergences.length > 0,
      div0 ? `${arr(div0.classes).join(' vs ')} gap ${div0.gapPct}pp` : null,
      div0 ? `${arr(div0.classes).map((c) => CLASS_NAME_FA[c] || c).join(' و ')} ${faNum(div0.gapPct)} واحد با هم فاصله دارند` : null,
      div0 ? num(div0.gapPct) / 4 : 0),
    mk('volatility', widest !== null && Math.abs(widest.z) >= 1.5,
      widest ? `widest class move ${pctEn(widest.avg)}` : null,
      widest ? `${CLASS_NAME_FA[widest.cls]} ${pctFa(widest.avg)} (${faNum(Math.abs(widest.z).toFixed(1))} برابر روز معمول)` : null,
      widest ? Math.abs(widest.z) / 3 : 0),
    mk('coverage', missing >= 2,
      `${missing} domains unread`, `${faNum(missing)} حوزه از ۹ حوزه در این دور خوانده نشد`, 0.35 + missing * 0.05),
    { ...mk('model', false, 'all sensitivities are first-order model terms', 'همهٔ حساسیت‌ها اجزای مرتبهٔ اول مدل‌اند'), observed: false }
  ];
  const observed = args.filter((a) => a.observed);
  const power = observed.reduce((s, a) => s + a.severity, 0);
  const strength = observed.length === 0 ? 'none' : power < 0.9 ? 'low' : power < 1.8 ? 'medium' : 'high';
  return {
    opportunity: opp, arguments: args, observed: observed.length,
    summary: {
      observed: observed.length, total: args.length, strength,
      /* the three strongest observed risks lead; everything else is «standing» */
      top: observed.slice().sort((a, b) => b.severity - a.severity).slice(0, 3).map((a) => a.id),
      standing: args.filter((a) => !a.observed).map((a) => a.id)
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   10) MARKET DNA — per-asset sensitivity profile (model priors + observed
   overlays from this pass). Priors are LABELLED as model assumptions, and
   every gene now carries the pass reading that touches it.
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

export const DNA_GENE_META = Object.freeze({
  liquidity: { fa: 'حساسیت نقدینگی', en: 'Liquidity sensitivity', icon: 'drop' },
  macro: { fa: 'حساسیت کلان', en: 'Macro sensitivity', icon: 'bank' },
  whale: { fa: 'حساسیت نهنگ', en: 'Whale sensitivity', icon: 'waves' },
  usd: { fa: 'حساسیت دلار', en: 'USD sensitivity', icon: 'chart' },
  riskOn: { fa: 'حساسیت ریسک‌پذیری', en: 'Risk-on sensitivity', icon: 'pulse' },
  etf: { fa: 'حساسیت ETF', en: 'ETF sensitivity', icon: 'layers' }
});

export function buildDna(data = {}, symbol = 'BTC') {
  const x = extractWorldInputs(data);
  const sym = String(symbol || 'BTC').toUpperCase();
  const priors = DNA_PRIORS[sym] || DNA_PRIORS.BTC;

  /* The asset's own reading, wherever this pass saw it. */
  const own = x.findInd([sym === 'WTI' ? 'WTI' : sym])
    || x.indicators.find((q) => String(q.symbol).toUpperCase().includes(sym))
    || (sym === 'BTC' || sym === 'ETH' ? arr(x.classes?.crypto?.top).concat(arr(x.classes?.crypto?.bottom)).find((t) => t.symbol === sym) : null);
  const ownChange = num(own?.change1dPct ?? own?.change24hPct ?? own?.changePct ?? (sym === 'BTC' ? x.crypto?.avgChangePct : null));
  const dxyChg = num(x.dxy?.change1dPct);
  const usdAlignment = ownChange === null || dxyChg === null || sym === 'DXY'
    ? null
    : (ownChange > 0 && dxyChg > 0) || (ownChange < 0 && dxyChg < 0) ? 'same' : 'opposite';
  const whaleTouched = [
    ...arr(x.whales?.events), ...arr(x.sm?.topTokens)
  ].some((e) => String(e?.symbol || '').toUpperCase().includes(sym));
  const etfLinked = sym === 'GOLD' ? (data.goldEtfs?.available === true) : (sym === 'BTC' || sym === 'ETH');

  /* Each gene's field reading for THIS pass (or null when nothing touched it) */
  const genes = Object.entries(priors).map(([id, prior]) => {
    let field = null;
    if (id === 'liquidity') {
      const net = num(x.chainFlows?.net24hUsd);
      if (net !== null) field = { dir: signOf(net), value: usdCompact(net).replace('+', ''), kind: 'read', source: 'defillama' };
    } else if (id === 'macro') {
      if (x.regime) field = { dir: x.regime.includes('RISK_OFF') ? 'down' : x.regime.includes('RISK_ON') ? 'up' : 'flat', value: x.regime, kind: 'read', source: 'cross-asset-engine' };
    } else if (id === 'whale') {
      const count = num(x.whales?.count);
      const net = smartMoneyNet(x);
      if (count !== null || net !== null) field = {
        dir: net !== null ? signOf(net) : 'flat',
        value: count !== null ? `${count} ${count === 1 ? 'event' : 'events'}` : null,
        kind: 'read', source: 'whales:scanner'
      };
    } else if (id === 'usd') {
      if (dxyChg !== null) field = { dir: signOf(dxyChg), value: pctEn(dxyChg), kind: 'read', source: x.dxy?.source || null };
    } else if (id === 'riskOn') {
      const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
      if (avgs.length) {
        const up = avgs.filter((v) => v > 0).length;
        field = { dir: up * 2 > avgs.length ? 'up' : up * 2 < avgs.length ? 'down' : 'flat', value: `${up}/${avgs.length}`, kind: 'read', source: 'cross-asset-engine' };
      }
    } else if (id === 'etf') {
      if (x.goldEtfs?.rows?.length) field = { dir: num(x.goldEtfs.rows[0]?.changePct) === null ? 'flat' : signOf(x.goldEtfs.rows[0].changePct), value: `${x.goldEtfs.rows.length} rows`, kind: 'read', source: 'etf:gold' };
    }
    return { id, prior, field };
  });

  return {
    symbol: sym,
    priors,
    genes,
    observed: {
      change: ownChange,
      volatility: ownChange === null ? null : Math.abs(ownChange) >= 2 ? 'high' : Math.abs(ownChange) >= 0.5 ? 'medium' : 'low',
      usdAlignment, whaleTouched, etfLinked,
      source: own?.source || null
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   11) CAUSAL CHAIN (local fallback) — the oil → inflation → yields → dollar
   → pressure → crypto-liquidity transmission, each node lit only by a real
   reading; proxy / unread nodes say so. The causal tab prefers the server's
   own macro-graph engine and falls back to this when it cannot be reached.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildCausalLocal(data = {}) {
  const t = buildTransmission(data);
  return { nodes: t.nodes.map((n) => ({ ...n, state: n.state, value: n.value ?? null })), edges: t.edges, consistency: t.consistency, origin: 'local' };
}

/* ══════════════════════════════════════════════════════════════════════════
   12) THE ECONOMIC OUTLOOK READER — the server's weighted composite PLUS a
   labelled local complement built from the same pass.
   ──────────────────────────────────────────────────────────────────────────
   «چشم‌انداز اقتصادی — دادهٔ کافی نیست» was the report. The engine only emits
   an outlook when ITS inputs were read; the client, however, is holding real
   readings the engine may not have used. So this reader:
     · keeps every server signal verbatim (name, evidence, weight, source),
     · adds LOCAL signals for the readings the server list did not cover —
       each labelled «خوانش محلی», never dressed as the engine's own,
     · states the coverage: how many of the possible signals exist at all,
     · names every missing input and why it is missing.
   Labels/score stay the engine's when it answered; the local composite is
   only the fallback label (clearly marked) when the engine could not.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildOutlookReading(data = {}) {
  const x = extractWorldInputs(data);
  const serverSignals = arr(x.outlook?.signals).map((s) => ({
    id: `server:${s.id}`, rawId: s.id, origin: 'engine',
    name: s.name, nameFa: s.nameFa || null,
    value: num(s.value), weight: num(s.weight) ?? 1,
    direction: s.direction || 'neutral',
    evidence: s.evidence || null, evidenceFa: s.evidenceFa || null,
    source: s.source || null
  }));

  /* the local complement — same weights sign convention as the engine */
  const local = [];
  const addLocal = (id, nameFa, nameEn, value, weight, evidenceFa, evidenceEn, source) => {
    if (value === null || !Number.isFinite(value)) return;
    const v = clamp(value, -1, 1);
    local.push({
      id: `local:${id}`, rawId: id, origin: 'local', name: nameEn, nameFa,
      value: round(v, 3), weight, direction: v > 0.05 ? 'supportive' : v < -0.05 ? 'cautionary' : 'neutral',
      evidence: evidenceEn, evidenceFa, source
    });
  };

  {
    const votes = arr(x.cross?.regime?.votes).filter((v) => num(v?.avg) !== null);
    if (votes.length) {
      const up = votes.filter((v) => num(v.avg) > 0).length;
      addLocal('risk_mood', 'حال‌وهوای کلاس‌های دارایی', 'cross-class mood',
        (up - (votes.length - up)) / votes.length, 1.5,
        `${faNum(up)} از ${faNum(votes.length)} کلاس صعودی — رژیم ${x.regime || 'ترکیبی'}`,
        `${up} of ${votes.length} classes up — regime ${x.regime || 'MIXED'}`, 'cross-asset-engine');
    } else {
      const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
      if (avgs.length) {
        const up = avgs.filter((v) => v > 0).length;
        addLocal('risk_mood', 'حال‌وهوای کلاس‌های دارایی', 'cross-class mood',
          (up - (avgs.length - up)) / avgs.length, 1.5,
          `${faNum(up)} از ${faNum(avgs.length)} کلاس خوانده‌شده صعودی`,
          `${up} of ${avgs.length} observed classes up`, 'cross-asset-engine');
      }
    }
  }
  {
    const moves = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
    const totalInst = Object.values(x.classes).reduce((s, c) => s + (num(c?.advancing) ?? 0) + (num(c?.declining) ?? 0), 0);
    if (moves.length && totalInst) {
      const adv = Object.values(x.classes).reduce((s, c) => s + (num(c?.advancing) ?? 0), 0);
      addLocal('breadth', 'گستردگی حرکت‌ها', 'advance/decline breadth',
        (adv / totalInst - 0.5) * 2, 1.4,
        `${faNum(adv)} از ${faNum(totalInst)} ابزار صعودی`,
        `${adv} of ${totalInst} instruments advancing`, 'cross-asset-engine');
    }
  }
  {
    const dxyChg = num(x.dxy?.change1dPct);
    addLocal('dollar_pressure', 'فشار دلار', 'dollar pressure',
      dxyChg === null ? null : -clamp(dxyChg / 1.5, -1, 1), 1.0,
      dxyChg === null ? null : `شاخص دلار ${pctFa(dxyChg)} در ۱ روز — دلار قوی به ریسک فشار می‌آورد`,
      dxyChg === null ? null : `DXY ${pctEn(dxyChg)} 1d — a firm dollar pressures risk`, x.dxy?.source || null);
  }
  {
    const gold = num(x.gold?.change7dPct ?? x.gold?.change1dPct);
    addLocal('safe_haven_bid', 'تقاضای پناهگاه امن (طلا)', 'safe-haven bid',
      gold === null ? null : -clamp(gold / 3, -1, 1), 0.8,
      gold === null ? null : `طلا ${pctFa(gold)} — رشد طلا تقاضای پوشش ریسک است، نه رشد`,
      gold === null ? null : `gold ${pctEn(gold)} — a rising gold bid is hedging demand`, x.gold?.source || null);
  }
  {
    const oil = [num(x.wti?.change1dPct), num(x.brent?.change1dPct)].filter((v) => v !== null);
    const avg = oil.length ? oil.reduce((a, c) => a + c, 0) / oil.length : null;
    addLocal('energy', 'فشار انرژی/تورم', 'energy & inflation pressure',
      avg === null ? null : -clamp(avg / 4, -1, 1), 1.1,
      avg === null ? null : `نفت ${pctFa(avg)} در ۱ روز (پروکسی تورم)`,
      avg === null ? null : `crude ${pctEn(avg)} 1d (inflation proxy)`, x.wti?.source || x.brent?.source || null);
  }
  {
    const spread = num(x.curve?.spreadPct);
    addLocal('curve', 'شیب منحنی بازده', 'yield-curve slope',
      spread === null ? null : clamp(spread / 1, -1, 1), 1.2,
      spread === null ? null : `شیب ۲/۱۰ ${faNum(spread)} واحد${spread < 0 ? ' — وارون' : ''}`,
      spread === null ? null : `2s10s ${spread}pp${spread < 0 ? ' — inverted' : ''}`, x.curve?.source || null);
  }
  {
    const net = num(x.chainFlows?.net24hUsd);
    addLocal('liquidity', 'نقدینگی استیبل‌کوین', 'stablecoin liquidity',
      net === null ? null : clamp(net / 200_000_000, -1, 1), 1.0,
      net === null ? null : `جریان خالص استیبل‌کوین ${usdCompact(net).replace('+', '')}`,
      net === null ? null : `stablecoin net ${usdCompact(net)}`, 'defillama');
  }
  {
    const net = smartMoneyNet(x);
    addLocal('smart_money', 'جریان نهادی برچسب‌دار', 'labelled institutional flow',
      net === null ? null : clamp(net / 5_000_000, -1, 1), 1.0,
      net === null ? null : `انباشت منهای توزیع: ${usdCompact(net).replace('+', '')}`,
      net === null ? null : `accumulation − distribution: ${usdCompact(net)}`, 'smartMoney:overview');
  }
  {
    const byTopic = x.macroDom?.byTopic || {};
    const total = Object.values(byTopic).reduce((a, c) => a + (num(c) || 0), 0);
    const geo = num(byTopic.GEOPOLITICS);
    addLocal('geopolitics', 'ریسک ژئوپلیتیک', 'geopolitical risk',
      !total || geo === null ? null : -clamp(geo / total / 0.35, -1, 1), 0.8,
      !total || geo === null ? null : `${faNum(geo)} از ${faNum(total)} سرفصل ژئوپلیتیک`,
      !total || geo === null ? null : `${geo} of ${total} headlines geopolitical`, 'macro:classifier');
  }

  /* Merge: the engine's list first, then only the local signals it did not
     already cover (matched by rawId), so the reader never double-counts. */
  const covered = new Set(serverSignals.map((s) => s.rawId));
  const signals = [...serverSignals, ...local.filter((s) => !covered.has(s.rawId))];

  const available = signals.filter((s) => s.value !== null && Number.isFinite(s.value));
  const weightSum = available.reduce((s, x2) => s + (x2.weight || 1), 0);
  const localScore = weightSum ? clamp(available.reduce((s, x2) => s + (x2.value * (x2.weight || 1)), 0) / weightSum, -1, 1) : null;
  const engineScore = num(x.outlook?.score);
  const engineLabel = x.outlook?.label && x.outlook.label !== 'UNAVAILABLE' ? String(x.outlook.label) : null;

  const label = engineLabel || (localScore === null ? 'UNAVAILABLE'
    : localScore >= 0.25 ? 'GROWTH_WATCH' : localScore <= -0.25 ? 'RECESSION_WATCH' : 'MIXED_SIGNALS');
  const score = engineScore !== null ? engineScore : (localScore === null ? null : round(localScore, 2));

  const POSSIBLE = ['risk_mood', 'breadth', 'dollar_pressure', 'safe_haven_bid', 'energy', 'curve', 'liquidity', 'smart_money', 'geopolitics'];
  const have = new Set(signals.map((s) => s.rawId));
  const missing = POSSIBLE.filter((id) => !have.has(id)).map((id) => ({
    id,
    nameFa: (local.find((s) => s.rawId === id) || {}).nameFa || id,
    nameEn: (local.find((s) => s.rawId === id) || {}).name || id,
    whyFa: id === 'curve' ? 'بازده/منحنی خوانده نشد'
      : id === 'energy' ? 'نقل‌قول نفت خوانده نشد'
      : id === 'dollar_pressure' || id === 'safe_haven_bid' ? 'نقل‌قول کلان خوانده نشد'
      : id === 'liquidity' ? 'جریان استیبل‌کوین خوانده نشد'
      : id === 'smart_money' ? 'دامنهٔ پول هوشمند خوانده نشد'
      : id === 'geopolitics' ? 'دسته‌بندی اخبار خوانده نشد'
      : 'کلاس‌های دارایی خوانده نشد',
    whyEn: id === 'curve' ? 'yields/curve unread'
      : id === 'energy' ? 'crude quotes unread'
      : id === 'dollar_pressure' || id === 'safe_haven_bid' ? 'macro quotes unread'
      : id === 'liquidity' ? 'stablecoin flows unread'
      : id === 'smart_money' ? 'smart-money domain unread'
      : id === 'geopolitics' ? 'news classifier unread'
      : 'asset classes unread'
  }));

  const classes = Object.entries(x.classes).map(([cls, c]) => ({
    cls, avg: num(c?.avgChangePct), advancing: num(c?.advancing), declining: num(c?.declining),
    instruments: num(c?.instruments), withChange: num(c?.withChange)
  }));

  return {
    source: engineLabel ? (serverSignals.length ? 'engine+local' : 'engine') : (localScore === null ? 'unavailable' : 'local'),
    label, labelFa: OUTLOOK_LABEL_FA[label] || label, score,
    engineLabel, engineScore,
    localScore: localScore === null ? null : round(localScore, 2),
    signals, missing, possible: POSSIBLE.length,
    availableSignals: available.length,
    coverage: round(available.length / POSSIBLE.length, 2),
    currentState: {
      regime: x.regime || null,
      classes,
      breadth: x.outlook?.currentState?.avgChangePct || null
    },
    note: engineLabel
      ? 'engine signals verbatim + labelled local complement from this pass'
      : 'the engine did not answer this pass — this is the labelled local composite'
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   13) DOMAIN DETAIL — every field each domain actually returned.
   «پول هوشمند و روی زنجیره دادهٔ کافی ندارد» was the report; the payloads DO
   carry rows (top tokens, source health, whale events, headlines, quotes) —
   this reader surfaces them instead of collapsing each domain to one number.
   ══════════════════════════════════════════════════════════════════════════ */

const DOMAIN_LABELS = Object.freeze({
  smart_money: { fa: 'پول هوشمند', en: 'Smart money' },
  whales: { fa: 'نهنگ‌ها', en: 'Whales' },
  onchain: { fa: 'روی زنجیره', en: 'On-chain' },
  news: { fa: 'اخبار', en: 'News' },
  macro: { fa: 'کلان', en: 'Macro' },
  stocks: { fa: 'سهام', en: 'Stocks' },
  forex: { fa: 'ارز', en: 'Forex' },
  commodities: { fa: 'کالا', en: 'Commodities' },
  rwa: { fa: 'دارایی واقعی', en: 'RWA' }
});

/** what each domain IS, in one calm line (the row's subtitle) */
const DOMAIN_ROLE = Object.freeze({
  smart_money: { fa: 'کیف‌پول‌های برچسب‌دار و جریان نهادی', en: 'labelled wallets and institutional flow' },
  whales: { fa: 'انتقال‌های بزرگ روی زنجیره', en: 'large on-chain transfers' },
  onchain: { fa: 'سلامت منابع و فعالیت شبکه‌ها', en: 'source health and network activity' },
  news: { fa: 'سرفصل‌های تازهٔ بازار', en: 'fresh market headlines' },
  macro: { fa: 'قیمت‌های کلان و موضوع‌های خبری', en: 'macro quotes and news themes' },
  stocks: { fa: 'سهام‌های شاخص بازار', en: 'benchmark equities' },
  forex: { fa: 'جفت‌ارزهای اصلی', en: 'major currency pairs' },
  commodities: { fa: 'فلزات و انرژی', en: 'metals and energy' },
  rwa: { fa: 'دارایی‌های واقعی روی زنجیره', en: 'tokenised real-world assets' }
});

export const DOMAIN_KEYS = Object.freeze(Object.keys(DOMAIN_LABELS));

const TOPIC_FA = Object.freeze({
  FED: 'فدرال‌رزرو', INFLATION: 'تورم', GEOPOLITICS: 'ژئوپلیتیک', GROWTH: 'رشد', RATES: 'نرخ بهره', ECB: 'بانک مرکزی اروپا',
  POLITICS: 'سیاست', CRYPTO_POLICY: 'قانون‌گذاری رمزارز', 'CRYPTO POLICY': 'قانون‌گذاری رمزارز', JOBS: 'اشتغال', ENERGY: 'انرژی', TRADE: 'تجارت'
});

/** instrument tickers the Persian reader knows by name (everything else stays a ticker) */
const SYMBOL_FA = Object.freeze({
  'EUR/USD': 'یورو / دلار', 'GBP/USD': 'پوند / دلار', 'USD/JPY': 'دلار / ین', 'USD/CAD': 'دلار / دلار کانادا', 'USD/CHF': 'دلار / فرانک سوئیس',
  'USD/SEK': 'دلار / کرون سوئد', 'USD/MXN': 'دلار / پزوی مکزیک', 'USD/CNH': 'دلار / یوان', 'AUD/USD': 'دلار استرالیا / دلار', 'NZD/USD': 'دلار نیوزیلند / دلار',
  'XAU/USD': 'طلا', 'XAG/USD': 'نقره', 'XPT/USD': 'پلاتین', 'XPD/USD': 'پالادیوم', 'CL/USD': 'نفت وست‌تگزاس', 'BRENT/USD': 'نفت برنت', 'HG/USD': 'مس',
  'SPX/USD': 'اس‌اندپی ۵۰۰', 'NDX/USD': 'نزدک ۱۰۰', 'DJI/USD': 'داوجونز', 'DAX/USD': 'داکس آلمان', 'FTSE/USD': 'فوتسی بریتانیا', 'NIK/USD': 'نیکی ژاپن',
  'HSI/USD': 'هنگ‌سنگ', 'TLT/USD': 'صندوق اوراق بلندمدت', 'HYG/USD': 'صندوق اوراق پربازده',
  DXY: 'شاخص دلار', GOLD: 'طلا', WTI: 'نفت وست‌تگزاس', BRENT: 'نفت برنت', COPPER: 'مس', SPX: 'اس‌اندپی ۵۰۰', US10Y: 'بازده ۱۰ ساله', US2Y: 'بازده ۲ ساله', US30Y: 'بازده ۳۰ ساله', TLT: 'صندوق اوراق بلندمدت'
});
export const symbolFa = (s) => SYMBOL_FA[String(s || '').toUpperCase()] || null;

const SOURCE_FA_DOMAIN = Object.freeze({
  'news-engine': 'موتور خبر', 'whales:scanner': 'اسکنر نهنگ', 'chainintel': 'ردیاب زنجیره', 'smartmoney:overview': 'پول هوشمند',
  ostium: 'Ostium', avantis: 'Avantis', macrodata: 'میز کلان', 'cross-asset-engine': 'موتور بین‌دارایی'
});
const domainSourceFa = (s) => {
  if (!s) return null;
  const raw = String(s);
  const low = raw.toLowerCase();
  return SOURCE_FA_DOMAIN[low] || SOURCE_FA_DOMAIN[low.split(':')[0]] || describeSource(raw, true);
};
const domainSourceEn = (s) => (s ? describeSource(String(s), false) : null);

const STATUS_PERSIAN = Object.freeze({ OK: 'کامل', PARTIAL: 'ناقص', UNAVAILABLE: 'خوانده نشد', STALE: 'قدیمی' });
const STATUS_ENGLISH = Object.freeze({ OK: 'complete', PARTIAL: 'partial', UNAVAILABLE: 'unread', STALE: 'stale' });

export function buildDomainsView(domains) {
  if (!domains) return [];
  return Object.keys(DOMAIN_LABELS).map((key) => {
    const env = domains[key] || null;
    let status = env?.status || 'UNAVAILABLE';
    const data = status === 'OK' ? env.data : null;
    /* a domain the server marked OK whose rows are price-only is «partial» to
       the reader: it answered, but not with everything this screen needs */
    if (status === 'OK' && env?.partial === true) status = 'PARTIAL';
    const out = {
      key, status, statusFa: STATUS_PERSIAN[status] || 'خوانده نشد', statusEn: STATUS_ENGLISH[status] || 'unread',
      tone: status === 'OK' ? 'ok' : status === 'PARTIAL' ? 'warn' : 'off',
      reason: env?.reason || null, source: env?.source || null,
      sourceFa: domainSourceFa(env?.source), sourceEn: domainSourceEn(env?.source),
      at: num(env?.at), confidence: num(env?.confidence),
      stale: data?.stale === true, partial: env?.partial === true,
      label: DOMAIN_LABELS[key], role: DOMAIN_ROLE[key],
      headlineFa: null, headlineEn: null, stats: [],
      metrics: [], list: [], listKind: null
    };
    const stat = (fa, en, valueFa, valueEn, dir = 'flat') => out.stats.push({ fa, en, valueFa, valueEn, dir });

    if (key === 'smart_money' && data) {
      const net = smartMoneyNet({ sm: data });
      const proxy = data.whaleTransferProxy || null;
      const pAcc = num(proxy?.accumulationUsd); const pDist = num(proxy?.distributionUsd);
      if (net !== null) out.metrics.push({ key: 'netFlow', fa: 'جریان خالص', en: 'net flow', value: usdCompact(net), valueFa: usdFaCompact(net), dir: signOf(net) });
      if (num(data.accumulationUsd) !== null) out.metrics.push({ key: 'accumulation', fa: 'انباشت', en: 'accumulation', value: usdCompact(data.accumulationUsd), valueFa: usdFaCompact(data.accumulationUsd, { signed: false }), dir: 'up' });
      if (num(data.distributionUsd) !== null) out.metrics.push({ key: 'distribution', fa: 'توزیع', en: 'distribution', value: usdCompact(-Math.abs(num(data.distributionUsd))), valueFa: usdFaCompact(-Math.abs(num(data.distributionUsd))), dir: 'down' });
      if (net === null && pAcc !== null && pDist !== null) {
        out.metrics.push({ key: 'proxyNet', fa: 'تراز انتقال نهنگ‌ها (پروکسی)', en: 'whale-transfer balance (proxy)', value: usdCompact(pAcc - pDist), valueFa: usdFaCompact(pAcc - pDist), dir: signOf(pAcc - pDist) });
      }
      const wa = data.whaleActivity || proxy?.whaleActivity || null;
      if (num(wa?.count) !== null) out.metrics.push({ key: 'whaleActivity', fa: 'رویداد نهنگ', en: 'whale events', value: String(wa.count), valueFa: faNum(wa.count), dir: num(wa.changePct) === null ? 'flat' : signOf(wa.changePct) });
      if (data.window) out.metrics.push({ key: 'window', fa: 'پنجره', en: 'window', value: String(data.window), valueFa: faNum(String(data.window).replace('h', ' ساعت').replace('d', ' روز')), dir: 'flat' });
      out.listKind = 'tokens';
      out.list = arr(data.topTokens).map((tk) => ({
        symbol: tk.symbol, chain: tk.chain, chainFa: tk.chain ? chainFa(tk.chain) : null, flow: tk.signal || tk.flow || null,
        valueUsd: num(tk.netUsd) ?? num(tk.valueUsd), confidence: num(tk.confidence)
      }));
      if (net !== null) {
        out.headlineFa = `جریان خالص برچسب‌دار ${usdFaCompact(net)}`; out.headlineEn = `labelled net flow ${usdCompact(net)}`;
        stat('خالص', 'net', usdFaCompact(net), usdCompact(net), signOf(net));
      } else if (pAcc !== null && pDist !== null) {
        out.headlineFa = `شواهد تأییدشده کم بود؛ تراز انتقال نهنگ‌ها ${usdFaCompact(pAcc - pDist)} (پروکسی)`;
        out.headlineEn = `verified evidence was thin; whale-transfer balance ${usdCompact(pAcc - pDist)} (proxy)`;
        stat('تراز نهنگ‌ها', 'whale balance', usdFaCompact(pAcc - pDist), usdCompact(pAcc - pDist), signOf(pAcc - pDist));
      } else {
        out.headlineFa = 'جریان نهادی در این دور محاسبه نشد'; out.headlineEn = 'institutional flow was not computed this pass';
      }
      if (num(wa?.count) !== null) stat('رویداد نهنگ', 'whale events', faNum(wa.count), String(wa.count));
    } else if (key === 'whales' && data) {
      const evs = arr(data.events);
      if (num(data.count) !== null) out.metrics.push({ key: 'count', fa: 'رویداد', en: 'events', value: String(data.count), valueFa: faNum(data.count), dir: 'flat' });
      const top = evs.slice().sort((a, b) => (num(b.valueUsd) || 0) - (num(a.valueUsd) || 0))[0];
      if (top) out.metrics.push({ key: 'topEvent', fa: 'بزرگ‌ترین انتقال', en: 'largest transfer', value: `${top.symbol} ${usdCompact(top.valueUsd)}`, valueFa: `${top.symbol} ${usdFaCompact(top.valueUsd, { signed: false })}`, dir: 'flat' });
      out.listKind = 'whales';
      out.list = evs.map((e) => ({ symbol: e.symbol, chain: e.chain, chainFa: e.chain ? chainFa(e.chain) : null, valueUsd: num(e.valueUsd), flow: e.flow, from: e.from || null, to: e.to || null, at: num(e.at) }));
      if (num(data.count) !== null) {
        out.headlineFa = `${faNum(data.count)} انتقال بزرگ${top ? ` · بزرگ‌ترین ${top.symbol} ${usdFaCompact(top.valueUsd, { signed: false })}` : ''}`;
        out.headlineEn = `${data.count} large transfers${top ? ` · largest ${top.symbol} ${usdCompact(top.valueUsd).replace('+', '')}` : ''}`;
        stat('انتقال', 'transfers', faNum(data.count), String(data.count));
        if (top) stat('بزرگ‌ترین', 'largest', usdFaCompact(top.valueUsd, { signed: false }), usdCompact(top.valueUsd).replace('+', ''));
      }
    } else if (key === 'onchain' && data) {
      const sources = arr(data.sources);
      if (sources.length && num(data.healthySources) !== null) out.metrics.push({ key: 'healthy', fa: 'منبع سالم', en: 'healthy sources', value: `${data.healthySources}/${sources.length}`, valueFa: `${faNum(data.healthySources)} از ${faNum(sources.length)}`, dir: 'flat' });
      if (num(data.downSources) !== null && num(data.downSources) > 0) out.metrics.push({ key: 'down', fa: 'منبع خاموش', en: 'sources down', value: String(data.downSources), valueFa: faNum(data.downSources), dir: 'down' });
      if (num(data.degradedSources) !== null && num(data.degradedSources) > 0) out.metrics.push({ key: 'degraded', fa: 'منبع نیمه‌سالم', en: 'degraded', value: String(data.degradedSources), valueFa: faNum(data.degradedSources), dir: 'down' });
      out.listKind = 'sources';
      out.list = sources.map((s) => ({ symbol: s.source, status: s.status, failures: num(s.failures), lastOkAt: num(s.lastOkAt) }));
      out.activity = arr(data.activity).slice(0, 6).map((e) => ({ type: e.type, detail: e.detail, source: e.source, at: num(e.at) }));
      if (sources.length) {
        out.headlineFa = `${faNum(data.healthySources ?? 0)} از ${faNum(sources.length)} منبع سالم است`; out.headlineEn = `${data.healthySources ?? 0} of ${sources.length} sources healthy`;
        stat('منبع سالم', 'healthy', `${faNum(data.healthySources ?? 0)}/${faNum(sources.length)}`, `${data.healthySources ?? 0}/${sources.length}`);
      } else if (out.activity.length) {
        out.headlineFa = `${faNum(out.activity.length)} رویداد شبکه ثبت شد`; out.headlineEn = `${out.activity.length} network events recorded`;
      } else {
        out.headlineFa = 'هیچ منبع زنجیره‌ای در این دور ثبت نشد'; out.headlineEn = 'no on-chain source was recorded this pass';
      }
    } else if (key === 'news' && data) {
      if (num(data.count) !== null) out.metrics.push({ key: 'count', fa: 'سرفصل', en: 'headlines', value: String(data.count), valueFa: faNum(data.count), dir: 'flat' });
      out.listKind = 'headlines';
      out.list = arr(data.items).slice(0, 8).map((n) => ({ symbol: n.symbols?.[0] || null, title: n.title, url: n.url, source: n.source, lang: n.lang, at: num(n.at) }));
      if (num(data.count) !== null) {
        out.headlineFa = `${faNum(data.count)} سرفصل تازه خوانده شد`; out.headlineEn = `${data.count} fresh headlines read`;
        stat('سرفصل', 'headlines', faNum(data.count), String(data.count));
      }
    } else if (key === 'macro' && data) {
      const quotes = arr(data.instruments).length ? arr(data.instruments) : arr(data.quotes);
      if (num(data.attention) !== null) out.metrics.push({ key: 'attention', fa: 'خبر کلان', en: 'macro headlines', value: String(data.attention), valueFa: faNum(data.attention), dir: 'flat' });
      const topics = Object.entries(data.byTopic || {}).sort((a, b) => b[1] - a[1]);
      /* both top topics: a single classifier label would hide the second
         theme that was equally present in this pass's headlines */
      if (topics.length) {
        out.metrics.push({
          key: 'topics', fa: 'موضوع‌های برتر', en: 'top topics',
          value: topics.slice(0, 2).map(([tp, n]) => `${tp}×${n}`).join(' · '),
          valueFa: topics.slice(0, 2).map(([tp, n]) => `${TOPIC_FA[tp] || tp} \u00d7${faNum(n)}`).join(' · '), dir: 'flat'
        });
      }
      if (quotes.length) out.metrics.push({ key: 'quotes', fa: 'قیمت کلان', en: 'macro quotes', value: String(quotes.length), valueFa: faNum(quotes.length), dir: 'flat' });
      out.listKind = 'topics';
      out.list = topics.map(([topic, count]) => ({ symbol: topic, symbolFa: TOPIC_FA[topic] || topic, valueUsd: null, count }));
      out.quotes = quotes.slice(0, 10).map((q) => ({ symbol: q.symbol, nameFa: symbolFa(q.symbol), priceUsd: num(q.priceUsd), change1dPct: num(q.change1dPct), source: q.source, sourceFa: q.source ? describeSource(q.source, true) : null }));
      const stale = data.stale === true;
      out.headlineFa = quotes.length
        ? `${faNum(quotes.length)} قیمت کلان${topics.length ? ` · موضوع برتر: ${TOPIC_FA[topics[0][0]] || topics[0][0]}` : ''}${stale ? ' · آخرین خوانش سالم' : ''}`
        : (topics.length ? `قیمت کلان نرسید · موضوع برتر خبر: ${TOPIC_FA[topics[0][0]] || topics[0][0]}` : 'قیمت کلان و خبر کلان در این دور نرسید');
      out.headlineEn = quotes.length
        ? `${quotes.length} macro quotes${topics.length ? ` · top theme: ${topics[0][0]}` : ''}${stale ? ' · last good read' : ''}`
        : (topics.length ? `no macro quotes · top news theme: ${topics[0][0]}` : 'no macro quotes or headlines this pass');
      if (quotes.length) stat('قیمت کلان', 'quotes', faNum(quotes.length), String(quotes.length));
      if (num(data.attention) !== null) stat('خبر کلان', 'macro news', faNum(data.attention), String(data.attention));
    } else if (data && arr(data.instruments)) {
      const inst = arr(data.instruments);
      const withChange = inst.filter((i) => num(i.change24hPct) !== null);
      const priced = inst.filter((i) => num(i.priceUsd) !== null);
      const avg = withChange.length ? withChange.reduce((s, i) => s + num(i.change24hPct), 0) / withChange.length : null;
      if (inst.length) out.metrics.push({ key: 'instruments', fa: 'ابزار', en: 'instruments', value: String(inst.length), valueFa: faNum(inst.length), dir: 'flat' });
      if (avg !== null) out.metrics.push({ key: 'avg', fa: 'میانگین ۲۴ ساعت', en: 'avg 24h', value: pctEn(avg), valueFa: pctFa(avg), dir: signOf(avg) });
      out.listKind = 'instruments';
      out.list = inst.slice(0, 10).map((i) => ({ symbol: i.symbol, nameFa: symbolFa(i.symbol), name: i.name, valueUsd: null, changePct: num(i.change24hPct), change7dPct: num(i.change7dPct), priceUsd: num(i.priceUsd) }));
      out.readOnly = data.readOnly === true;
      if (inst.length) {
        out.headlineFa = `${faNum(priced.length || inst.length)} ابزار قیمت‌دار${withChange.length ? ` · ${faNum(withChange.length)} با تغییر روزانه` : ' · بدون تغییر روزانه'}`;
        out.headlineEn = `${priced.length || inst.length} priced instruments${withChange.length ? ` · ${withChange.length} with a daily change` : ' · no daily change'}`;
        stat('ابزار', 'instruments', faNum(inst.length), String(inst.length));
        if (avg !== null) stat('میانگین', 'average', pctFa(avg), pctEn(avg), signOf(avg));
      }
    }
    return out;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   13b) THE BRIEFING TILES — the status report as a board of boxes.
   REPORTED: «گزارش وضعیت مدرن‌تر باشد، باکس‌ها اطلاعات درست داشته باشند و با
   لمس هر باکس به صفحهٔ مربوطه بروم».
   Each tile is a VIEW of one calibrated station (so the number on the tile and
   the number on the station board can never disagree) plus WHERE tapping it
   leads: an in-console tab (the macro table, the causal chain, the globe…) or
   a real page of the app (smart money, news, the market list, stocks).
   ══════════════════════════════════════════════════════════════════════════ */

const TAB_NAV = Object.freeze({
  world: { kind: 'tab', tab: 'world', fa: 'وضعیت جهان', en: 'World state' },
  flows: { kind: 'tab', tab: 'flows', fa: 'جریان سرمایه', en: 'Capital flow' },
  causal: { kind: 'tab', tab: 'causal', fa: 'زنجیرهٔ علت', en: 'Causal chain' },
  globe: { kind: 'tab', tab: 'globe', fa: 'کرهٔ زمین', en: 'Globe' },
  future: { kind: 'tab', tab: 'future', fa: 'درخت آینده', en: 'Future tree' },
  domains: { kind: 'tab', tab: 'domains', fa: 'حوزه‌های داده', en: 'Data domains' }
});
const ROUTE_NAV = Object.freeze({
  smart: { kind: 'route', to: '/smart-money', fa: 'پول هوشمند', en: 'Smart money' },
  news: { kind: 'route', to: '/news', fa: 'اخبار', en: 'News' },
  market: { kind: 'route', to: '/', fa: 'بازار', en: 'Market' },
  stocks: { kind: 'route', to: '/stocks', fa: 'سهام', en: 'Stocks' }
});

export function buildBriefingTiles(data = {}) {
  const x = extractWorldInputs(data);
  const stations = buildWeatherStations(data);
  const by = Object.fromEntries(stations.map((s) => [s.id, s]));
  const climate = buildClimate(data);
  const chal = buildChallenger(data);
  const globe = buildGlobeModel(data, { isPersian: true });
  const summary = summariseStations(stations);

  const fromStation = (id, icon, titleFa, titleEn, nav, extra = {}) => {
    const st = by[extra.station || id];
    if (!st) return null;
    const unread = st.tone === 'na' && !st.valueText && !st.valueTextFa;
    return {
      id, icon, tone: st.tone, nav,
      titleFa, titleEn,
      status: unread ? 'unread' : (st.quality === QUALITY.LEVEL ? 'level' : 'ok'),
      valueFa: st.valueTextFa, valueEn: st.valueText, unitFa: st.unitFa, unitEn: st.unitEn,
      subFa: st.readFa || st.noteFa || null, subEn: st.readEn || st.noteEn || null,
      quality: st.quality, severity: st.severity, z: st.z,
      basisFa: st.basisFa, basisEn: st.basisEn,
      ...extra.override
    };
  };

  const tiles = [];

  /* the climate — the one tile that is not a single station */
  {
    const word = climate.label ? TONE_WORD[climate.label] : null;
    tiles.push({
      id: 'climate', icon: 'sun', wide: true, tone: climate.label || 'na', nav: TAB_NAV.world,
      titleFa: 'اقلیم مالی این دور', titleEn: 'Financial climate of this pass',
      status: climate.index === null ? 'unread' : 'ok',
      valueFa: climate.index === null ? null : faNum(climate.index), valueEn: climate.index === null ? null : String(climate.index),
      unitFa: climate.index === null ? null : 'از ۱۰۰', unitEn: climate.index === null ? null : '/ 100',
      wordFa: word?.fa || null, wordEn: word?.en || null,
      subFa: `${faNum(summary.valid)} از ${faNum(summary.total)} ایستگاه معتبر · ${faNum(summary.proxy)} پروکسی`,
      subEn: `${summary.valid} of ${summary.total} stations valid · ${summary.proxy} proxy`,
      quality: climate.index === null ? null : QUALITY.MEASURED, severity: climate.index === null ? null : clamp(climate.index / 100, 0.05, 1), z: null
    });
  }

  const defs = [
    ['dollar', 'bank', 'دلار', 'Dollar', TAB_NAV.flows],
    ['gold', 'shield', 'طلا', 'Gold', TAB_NAV.flows],
    ['bonds', 'chart', 'اوراق خزانه', 'Treasuries', TAB_NAV.flows],
    ['inflation', 'flame', 'نفت و انرژی', 'Oil & energy', TAB_NAV.causal],
    ['equity', 'thermometer', 'سهام آمریکا', 'US equities', ROUTE_NAV.stocks],
    ['crypto', 'coin', 'رمزارز', 'Crypto', ROUTE_NAV.market],
    ['institutional', 'building', 'پول هوشمند', 'Smart money', ROUTE_NAV.smart],
    ['whales', 'waves', 'نهنگ‌ها', 'Whales', ROUTE_NAV.smart]
  ];
  for (const [id, icon, fa, en, nav] of defs) {
    const tile = fromStation(id, icon, fa, en, nav);
    if (tile) tiles.push(tile);
  }

  /* news: headline count + the theme the classifier saw most */
  {
    const st = by.news;
    const topics = Object.entries(x.macroDom?.byTopic || {}).sort((a, b) => b[1] - a[1]);
    const unread = !st || (st.tone === 'na' && !st.valueText);
    tiles.push({
      id: 'news', icon: 'news', tone: st?.tone || 'na', nav: ROUTE_NAV.news,
      titleFa: 'اخبار بازار', titleEn: 'Market news', status: unread ? 'unread' : 'ok',
      valueFa: st?.valueTextFa || null, valueEn: st?.valueText || null, unitFa: 'سرفصل', unitEn: 'headlines',
      subFa: topics.length ? `موضوع برتر: ${TOPIC_FA[topics[0][0]] || topics[0][0]}` : null,
      subEn: topics.length ? `top theme: ${topics[0][0]}` : null,
      quality: unread ? null : QUALITY.MEASURED, severity: st?.severity ?? null, z: null
    });
  }

  /* the challenger: how many observed risks speak against the pass's thesis */
  {
    const observed = chal.arguments.filter((a) => a.observed);
    const top = chal.summary?.top?.[0] ? chal.arguments.find((a) => a.id === chal.summary.top[0]) : null;
    const strength = chal.summary?.strength || null;
    tiles.push({
      id: 'risk', icon: 'warning', nav: TAB_NAV.future,
      tone: !chal.opportunity ? 'na' : strength === 'high' ? 'storm' : strength === 'medium' ? 'rain' : strength === 'low' ? 'cloud' : 'sun',
      titleFa: 'ریسک‌های این دور', titleEn: 'Risks this pass',
      status: chal.opportunity ? 'ok' : 'unread',
      valueFa: chal.opportunity ? faNum(observed.length) : null, valueEn: chal.opportunity ? String(observed.length) : null,
      unitFa: chal.opportunity ? 'ریسک مشاهده‌شده' : null, unitEn: chal.opportunity ? 'observed' : null,
      subFa: top ? top.evidenceFa : (chal.opportunity ? 'هیچ ریسک مشهودی علیه فرصت این دور دیده نشد' : 'فرصتی برای چالش نبود'),
      subEn: top ? top.evidence : (chal.opportunity ? 'no observed risk against this pass\u2019s opportunity' : 'no opportunity to challenge'),
      quality: chal.opportunity ? QUALITY.MEASURED : null, severity: chal.opportunity ? clamp(observed.reduce((s, a) => s + a.severity, 0) / 2, 0.08, 1) : null, z: null
    });
  }

  /* countries: the biggest local-currency move on the board */
  {
    const movers = globe.snaps.filter((s) => s.netBasis === 'direct' && s.net !== null)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    const m = movers[0] || null;
    tiles.push({
      id: 'countries', icon: 'globe', nav: TAB_NAV.globe,
      tone: !m ? 'na' : m.net > 0 ? 'sun' : m.net < 0 ? 'cloud' : 'partly',
      titleFa: 'کشورها', titleEn: 'Countries',
      status: m ? 'ok' : 'unread',
      valueFa: m ? m.country.fa : null, valueEn: m ? m.country.en : null,
      unitFa: m ? pctFa(m.net) : null, unitEn: m ? pctEn(m.net) : null,
      subFa: m ? `بیشترین حرکت ارز محلی · ${faNum(globe.coverage.read)} از ${faNum(globe.coverage.total)} کشور خوانده شد` : `${faNum(globe.coverage.read)} از ${faNum(globe.coverage.total)} کشور خوانده شد`,
      subEn: m ? `largest local-currency move · ${globe.coverage.read} of ${globe.coverage.total} countries read` : `${globe.coverage.read} of ${globe.coverage.total} countries read`,
      quality: m ? QUALITY.MEASURED : null, severity: m ? clamp(Math.abs(m.net) / 1.5, 0.08, 1) : null, z: null
    });
  }

  return { tiles, summary, climate, generatedFrom: 'this pass' };
}

/* ══════════════════════════════════════════════════════════════════════════
   14) PROVIDERS — the five readiness lamps per domain, ready to render.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildProvidersView(providers, domains) {
  if (!providers) return { rows: [], live: 0, total: 0 };
  const LAMPS = ['implemented', 'configured', 'provider_available', 'runtime_ready', 'live'];
  const rows = Object.entries(providers).map(([key, p]) => {
    const domain = domains?.[key] || null;
    const lamps = LAMPS.map((l) => ({ key: l, on: p?.[l] === true }));
    return {
      key,
      label: DOMAIN_LABELS[key] || { fa: key, en: key },
      lamps,
      lit: lamps.filter((l) => l.on).length,
      reason: p?.reason || null,
      status: domain?.status || null,
      source: domain?.source || null,
      at: num(domain?.at)
    };
  });
  rows.sort((a, b) => b.lit - a.lit || a.key.localeCompare(b.key));
  return {
    rows, lamps: LAMPS,
    live: rows.filter((r) => r.lamps[4].on).length,
    ready: rows.filter((r) => r.lamps[3].on).length,
    total: rows.length
  };
}

export default buildWorldState;

/* ── legacy wiring: the weather model also answers with the station array so
   callers that only imported the old name still get the upgraded board. */
export const buildWeatherBoard = buildWeatherStations;
