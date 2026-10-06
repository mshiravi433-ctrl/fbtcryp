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

  /* Macro indicators keyed by symbol — the desk's real quotes. */
  const indicators = arr(cross?.macro?.indicators);
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

  return {
    cross, domains, classes, indicators, ind, findInd,
    dxy, gold, wti, brent, spx, us10y, us2y, copper, curve,
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
  liquidity: { fa: 'نقدینگی استیبل‌کوین', en: 'Stablecoin liquidity' },
  volatility: { fa: 'تلاطم', en: 'Volatility' },
  whales: { fa: 'فعالیت نهنگ‌ها', en: 'Whale activity' },
  chains: { fa: 'افق زنجیره‌ها', en: 'Chain horizon' },
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

function station(id, icon, tone, severity, valueText, valueTextFa, evidence, source, noteFa, noteEn) {
  return { id, icon, tone, severity: tone === 'na' ? null : clamp(severity ?? 0.5, 0, 1), valueText, valueTextFa, evidence: evidence.filter(Boolean), source: source || null, noteFa: noteFa || null, noteEn: noteEn || null };
}

/**
 * The station board. Order = importance: the four measures the product asked
 * to lead with (institutional flow, dollar strength, energy inflation, global
 * risk) come right after the climate row.
 */
export function buildWeatherStations(data = {}) {
  const x = extractWorldInputs(data);
  const out = [];

  /* institutional flow — labelled smart money */
  {
    const net = smartMoneyNet(x);
    const acc = num(x.sm?.accumulationUsd); const dist = num(x.sm?.distributionUsd);
    const tone = net === null ? 'na' : net > 0 ? 'sun' : net < -1_000_000 ? 'storm' : 'rain';
    out.push(station('institutional', tone === 'na' ? 'bank' : net > 0 ? 'sun' : 'rain', net === null ? 'na' : tone,
      net === null ? null : clamp(Math.abs(net) / 8_000_000, 0.15, 1),
      net === null ? null : usdCompact(net), net === null ? null : usdCompact(net).replace('-', '\u2212'),
      [acc !== null ? { key: 'smartMoneyAcc', value: acc } : null, dist !== null ? { key: 'smartMoneyDist', value: dist } : null,
        x.sm?.window ? { key: 'window', value: x.sm.window } : null],
      x.envel.smart_money?.source || 'smartMoney:overview',
      net === null ? null : (net > 0 ? 'انباشت برچسب‌دار بیشتر از توزیع است.' : 'توزیع برچسب‌دار بیشتر از انباشت است.'),
      net === null ? null : (net > 0 ? 'labelled accumulation exceeds distribution.' : 'labelled distribution exceeds accumulation.')));
  }

  /* dollar strength */
  {
    const v = num(x.dxy?.change1dPct);
    const v7 = num(x.dxy?.change7dPct);
    out.push(station('dollar', 'wind', v === null ? 'na' : Math.abs(v) >= 0.7 ? 'windy' : v > 0 ? 'partly' : 'sun',
      v === null ? null : clamp(Math.abs(v) / 1.5, 0.12, 1),
      v === null ? null : pctEn(v), v === null ? null : pctFa(v),
      [v !== null ? { key: 'dxy1d', value: v } : null, v7 !== null ? { key: 'dxy7d', value: v7 } : null],
      x.dxy?.source || null,
      v === null ? null : (v > 0 ? 'دلار قوی معمولاً به دارایی‌های پرریسک فشار می‌آورد.' : 'دلار ضعیف معمولاً نقدینگی ریسک را آزاد می‌کند.'),
      v === null ? null : (v > 0 ? 'a firm dollar usually pressures risk assets.' : 'a softer dollar usually frees risk liquidity.')));
  }

  /* inflation pressure (energy) */
  {
    const moves = [num(x.wti?.change1dPct), num(x.brent?.change1dPct)].filter((v) => v !== null);
    const avg = moves.length ? moves.reduce((a, c) => a + c, 0) / moves.length : null;
    const w7 = num(x.wti?.change7dPct);
    out.push(station('inflation', 'flame', avg === null ? 'na' : avg >= 1.2 ? 'storm' : avg > 0.2 ? 'partly' : avg < -1 ? 'rain' : 'cloud',
      avg === null ? null : clamp(Math.abs(avg) / 3, 0.12, 1),
      avg === null ? null : pctEn(avg), avg === null ? null : pctFa(avg),
      [num(x.wti?.change1dPct) !== null ? { key: 'wti1d', value: num(x.wti.change1dPct) } : null,
        num(x.brent?.change1dPct) !== null ? { key: 'brent1d', value: num(x.brent.change1dPct) } : null,
        w7 !== null ? { key: 'wti7d', value: w7 } : null],
      x.wti?.source || x.brent?.source || null,
      avg === null ? null : 'پروکسی انرژی برای انتظارات تورمی — نه خود شاخص تورم.',
      avg === null ? null : 'energy is a proxy for inflation expectations — not the CPI itself.'));
  }

  /* global risk */
  {
    const score = num(x.outlook?.score);
    const label = String(x.outlook?.label || '');
    const level = label === 'RECESSION_WATCH' ? 'storm' : label === 'GROWTH_WATCH' ? 'sun'
      : x.regime.includes('RISK_OFF') ? 'rain' : x.regime.includes('RISK_ON') ? 'sun' : label ? 'cloud' : x.regime ? 'cloud' : 'na';
    const sev = level === 'storm' ? 0.9 : level === 'rain' ? 0.68 : level === 'cloud' ? 0.5 : level === 'sun' ? 0.22 : null;
    out.push(station('risk', level === 'na' ? 'shield' : level === 'storm' ? 'storm' : level === 'rain' ? 'rain' : level === 'sun' ? 'sun' : 'cloud',
      level, sev, label || (x.regime || null),
      label ? OUTLOOK_LABEL_FA[label] || label : (x.regime || null),
      [x.regime ? { key: 'regime', value: x.regime } : null, score !== null ? { key: 'outlookScore', value: score } : null,
        x.curve ? { key: 'curve2s10s', value: x.curve.spreadPct } : null],
      'cross-asset-engine',
      label === 'RECESSION_WATCH' ? 'مدل، هشدار رکود می‌خواند.' : label === 'GROWTH_WATCH' ? 'مدل، رشد را می‌خواند.' : null,
      label === 'RECESSION_WATCH' ? 'the model reads a recession watch.' : label === 'GROWTH_WATCH' ? 'the model reads a growth watch.' : null));
  }

  /* the remaining stations */
  {
    const stableNet = num(x.chainFlows?.net24hUsd);
    const pctv = num(x.chainFlows?.net24hPct);
    out.push(station('liquidity', stableNet === null ? 'drop' : stableNet > 0 ? 'sun' : 'rain',
      stableNet === null ? 'na' : stableNet > 0 ? 'sun' : stableNet < -50_000_000 ? 'storm' : 'rain',
      stableNet === null ? null : clamp(Math.abs(stableNet) / 300_000_000, 0.12, 1),
      stableNet === null ? null : usdCompact(stableNet).replace('+', ''),
      stableNet === null ? null : usdCompact(stableNet).replace('+', '').replace('-', '\u2212'),
      [stableNet !== null ? { key: 'stablecoinNet', value: stableNet } : null, pctv !== null ? { key: 'stablecoinNetPct', value: pctv } : null,
        x.chainFlows?.topInflowChain ? { key: 'topInflowChain', value: x.chainFlows.topInflowChain.chain } : null],
      'defillama',
      stableNet === null ? null : 'تغییر عرضهٔ استیبل‌کوین = ورود/خروج دلار به زنجیره‌ها.',
      stableNet === null ? null : 'stablecoin supply delta = dollars entering/leaving chains.'));
  }
  {
    const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
    const spread = avgs.length ? Math.max(...avgs.map(Math.abs)) : null;
    const level = spread === null ? null : spread >= 2 ? 'storm' : spread >= 0.7 ? 'partly' : 'sun';
    out.push(station('volatility', spread === null ? 'pulse' : spread >= 2 ? 'storm' : spread >= 0.7 ? 'partly' : 'sun',
      spread === null ? 'na' : level,
      spread === null ? null : clamp(spread / 3, 0.12, 1),
      spread === null ? null : pctEn(spread), spread === null ? null : pctFa(spread),
      [spread !== null ? { key: 'maxClassMove', value: round(spread) } : null,
        avgs.length ? { key: 'classesRead', value: avgs.length } : null],
      'cross-asset-engine', null, null));
  }
  {
    const count = num(x.whales?.count);
    const smNet = smartMoneyNet(x);
    const tone = count === null && smNet === null ? 'na' : (smNet !== null && smNet < 0) ? 'storm' : count !== null && count > 10 ? 'partly' : 'sun';
    out.push(station('whales', tone === 'na' ? 'waves' : tone === 'storm' ? 'storm' : 'waves', tone,
      count === null ? null : clamp(count / 25, 0.15, 1),
      count === null ? null : (x.whales?.events?.[0] ? `${x.whales.events[0].symbol} ${usdCompact(x.whales.events[0].valueUsd)}` : String(count)),
      count === null ? null : faNum(count),
      [count !== null ? { key: 'whaleEvents', value: count } : null, smNet !== null ? { key: 'smartMoneyNet', value: smNet } : null],
      'whales:scanner', null, null));
  }
  {
    const healthy = num(x.onchain?.healthySources); const totalSrc = arr(x.onchain?.sources).length;
    const down = num(x.onchain?.downSources) || 0;
    const tone = !x.onchain ? 'na' : down > 0 ? 'rain' : totalSrc ? 'sun' : 'partly';
    out.push(station('chains', tone === 'na' ? 'cloud' : tone, tone,
      totalSrc ? clamp(healthy / totalSrc, 0.15, 1) : null,
      x.onchain ? `${healthy ?? 0}/${totalSrc}` : null, x.onchain ? `${faNum(healthy ?? 0)}/${faNum(totalSrc)}` : null,
      [x.onchain ? { key: 'healthySources', value: `${healthy}/${totalSrc}` } : null, down ? { key: 'downSources', value: down } : null],
      'chainIntel', null, null));
  }
  {
    const count = num(x.newsDom?.count);
    const geo = num(x.macroDom?.byTopic?.GEOPOLITICS);
    const tone = count === null ? 'na' : (geo !== null && geo >= 3) ? 'partly' : 'sun';
    out.push(station('news', tone === 'na' ? 'news' : 'news', tone,
      count === null ? null : clamp(count / 40, 0.12, 1),
      count === null ? null : `${faNum(count)} ${count === 1 ? '' : ''}`.trim(),
      count === null ? null : faNum(count),
      [count !== null ? { key: 'headlines', value: count } : null, geo !== null ? { key: 'geopoliticsTopic', value: geo } : null],
      'news-engine', null, null));
  }
  {
    const inst = x.rwaInstruments;
    const ch = inst.map((i) => num(i.change24hPct)).filter((v) => v !== null);
    const avg = ch.length ? ch.reduce((a, c) => a + c, 0) / ch.length : null;
    const tone = !x.rwaDom && !x.rwa ? 'na' : avg === null ? 'cloud' : avg > 0.2 ? 'sun' : avg < -0.5 ? 'rain' : 'partly';
    out.push(station('rwa', 'building', tone,
      avg === null ? null : clamp(Math.abs(avg) / 2, 0.12, 1),
      avg === null ? (inst.length ? `${inst.length}` : null) : pctEn(avg),
      avg === null ? (inst.length ? faNum(inst.length) : null) : pctFa(avg),
      [inst.length ? { key: 'instruments', value: inst.length } : null, avg !== null ? { key: 'avgChange', value: avg } : null],
      x.envel.rwa?.source || null, null, null));
  }
  {
    const avg = num(x.crypto?.avgChangePct);
    const cl = x.crypto || null;
    const tone = avg === null ? 'na' : avg > 0.6 ? 'sun' : avg < -0.6 ? 'rain' : 'partly';
    out.push(station('crypto', 'coin', tone,
      avg === null ? null : clamp(Math.abs(avg) / 4, 0.12, 1),
      avg === null ? null : pctEn(avg), avg === null ? null : pctFa(avg),
      [avg !== null ? { key: 'classAvg', value: avg } : null,
        cl?.advancing !== undefined ? { key: 'advancing', value: `${cl.advancing}/${cl.withChange ?? cl.instruments ?? ''}` } : null],
      'cross-asset-engine', null, null));
  }

  return out;
}

/** Climate-index component labels (the chips under the hero). */
export const CLIMATE_PART_META = Object.freeze({
  regime: { fa: 'حال‌وهوای کلاس‌ها', en: 'cross-class mood' },
  outlook: { fa: 'چشم‌انداز موتور', en: 'engine outlook' },
  dollar: { fa: 'فشار دلار', en: 'dollar pressure' },
  energy: { fa: 'انرژی/تورم', en: 'energy & inflation' },
  volatility: { fa: 'تلاطم', en: 'volatility' },
  liquidity: { fa: 'نقدینگی استیبل‌کوین', en: 'stablecoin liquidity' },
  smartMoney: { fa: 'جریان نهادی', en: 'institutional flow' },
  curve: { fa: 'شیب منحنی', en: 'curve slope' },
  geopolitics: { fa: 'ژئوپلیتیک', en: 'geopolitics' }
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
  {
    const dxyChg = num(x.dxy?.change1dPct);
    if (dxyChg !== null) add('dollar', -clamp(dxyChg / 1.5, -1, 1), 1.2,
      `DXY ${pctEn(dxyChg)} 1d`, `شاخص دلار ${pctFa(dxyChg)} در ۱ روز`);
  }
  {
    const moves = [num(x.wti?.change1dPct), num(x.brent?.change1dPct)].filter((v) => v !== null);
    if (moves.length) {
      const avg = moves.reduce((a, c) => a + c, 0) / moves.length;
      add('energy', -clamp(avg / 3, -1, 1), 1.0, `crude ${pctEn(avg)} 1d (energy proxy)`, `نفت ${pctFa(avg)} در ۱ روز (پروکسی انرژی)`);
    }
  }
  {
    const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
    const spread = avgs.length ? Math.max(...avgs.map(Math.abs)) : null;
    if (spread !== null) add('volatility', -clamp(spread / 3, -1, 1), 1.2,
      `widest class move ${pctEn(spread)}`, `بیشترین حرکت کلاس ${pctFa(spread)}`);
  }
  {
    const stableNet = num(x.chainFlows?.net24hUsd);
    if (stableNet !== null) add('liquidity', clamp(stableNet / 200_000_000, -1, 1), 1.4,
      `stablecoin net ${usdCompact(stableNet)}`, `جریان خالص استیبل‌کوین ${usdCompact(stableNet).replace('+', '')}`);
  }
  {
    const smNet = smartMoneyNet(x);
    if (smNet !== null) add('smartMoney', clamp(smNet / 5_000_000, -1, 1), 1.0,
      `labelled net ${usdCompact(smNet)}`, `جریان برچسب‌دار ${usdCompact(smNet).replace('+', '')}`);
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
  const coverage = round(weight / 10.2, 3); // 10.2 = the sum of every weight above
  const label = score === null || coverage < 0.3 ? null
    : score >= 0.25 ? 'sun' : score >= 0.05 ? 'partly' : score > -0.25 ? 'cloud' : score > -0.6 ? 'rain' : 'storm';

  return {
    label,
    index: score === null ? null : Math.round((score + 1) * 50),
    score: score === null ? null : round(score, 3),
    components,
    coverage,
    readCount: components.length,
    total: 9,
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

export function buildCountrySnapshot(country, data = {}, { isPersian = true } = {}) {
  const x = extractWorldInputs(data);
  const findForex = (key) => {
    const alts = FOREX_SYMS[key] || [key];
    return x.forexInstruments.find((i) => alts.some((a) => String(i?.symbol || '').toUpperCase().replace('/', '').includes(a.replace('/', ''))));
  };
  const rows = [];
  const proxySet = new Set(country.proxies || []);
  for (const link of country.links) {
    if (CURVE_SYMS.has(link)) {
      if (x.curve) rows.push({
        sym: '2s10s', name: isPersian ? 'منحنی بازده ۲/۱۰' : '2s10s yield curve', change: null,
        value: `${x.curve.spreadPct}pp`, dir: signOf(x.curve.spreadPct), source: x.curve.source || null, kind: 'direct',
        note: isPersian ? 'شیب منحنی؛ مقیاس ۰٫۲۵ واحد گام مهم است.' : 'curve slope; 0.25pp is the step that matters.'
      });
      continue;
    }
    if (EQUITY_SYMS.has(link)) {
      if (x.spx) rows.push({
        sym: x.spx.symbol, name: isPersian ? 'شاخص سهام آمریکا' : 'US equity index',
        change: num(x.spx.change1dPct), value: num(x.spx.priceUsd) !== null ? String(round(x.spx.priceUsd, 2)) : null,
        dir: signOf(x.spx.change1dPct), source: x.spx.source || null, kind: proxySet.has(link) ? 'proxy' : 'direct', note: null
      });
      continue;
    }
    if (link === 'TMN') {
      if (x.toman?.status === 'fresh') rows.push({
        sym: 'USDT/TMN', name: isPersian ? 'دلار (نرخ مرجع)' : 'USD reference (Wallex)', change: null,
        value: String(Math.round(x.toman.value)), dir: 'flat', source: x.toman.source || 'wallex', kind: 'reference',
        note: isPersian ? 'نرخ مرجع عمومی، نه نرخ معاملات این اپ.' : 'a public reference rate, not an in-app trading rate.'
      });
      continue;
    }
    if (FOREX_SYMS[link]) {
      const q = findForex(link);
      if (q) rows.push({
        sym: q.symbol, name: isPersian ? 'برابری ارز' : 'FX parity', change: num(q.change24hPct),
        value: num(q.priceUsd) !== null ? String(round(q.priceUsd, 4)) : null, dir: signOf(q.change24hPct),
        source: x.envel.forex?.source || null, kind: proxySet.has(link) ? 'proxy' : 'direct', note: null
      });
      continue;
    }
    const q = x.findInd([link]);
    if (q) rows.push({
      sym: q.symbol, name: q.name || link, change: num(q.change1dPct),
      value: num(q.priceUsd) !== null ? String(round(q.priceUsd, q.priceUsd >= 100 ? 1 : 3)) : null,
      dir: signOf(q.change1dPct), source: q.source || null, kind: proxySet.has(link) ? 'proxy' : 'direct',
      note: proxySet.has(link) ? (isPersian ? 'پروکسی سازوکار اقتصادی، نه دادهٔ مستقیم این کشور.' : 'a mechanism proxy, not direct country data.') : null
    });
  }
  const changes = rows.map((r) => r.change).filter((v) => v !== null);
  const net = changes.length ? round(changes.reduce((a, c) => a + c, 0) / changes.length) : null;
  const status = rows.length ? (changes.length ? 'read' : 'partial') : 'unread';
  const mood = net === null ? 'flat' : net >= 0.3 ? 'up' : net <= -0.3 ? 'down' : 'flat';
  const dirs = { up: 0, down: 0, flat: 0 };
  for (const r of rows) dirs[r.dir] = (dirs[r.dir] || 0) + 1;

  return {
    country, rows, net, status, mood, dirs,
    readCount: rows.length, proxyCount: rows.filter((r) => r.kind === 'proxy').length,
    summaryFa: buildCountrySummary(country, rows, net, true),
    summaryEn: buildCountrySummary(country, rows, net, false)
  };
}

function buildCountrySummary(country, rows, net, isPersian) {
  if (!rows.length) return isPersian
    ? `برای ${country.fa} در این دور خوانشی ثبت نشد — هیچ عددی حدس زده نمی‌شود.`
    : `No reading was recorded for ${country.en} in this pass — nothing is guessed.`;
  const proxy = rows.filter((r) => r.kind === 'proxy').length;
  const parts = rows.slice(0, 3).map((r) => `${r.sym} ${r.change !== null ? (isPersian ? pctFa(r.change) : pctEn(r.change)) : r.value}`).join(' · ');
  const moodFa = net === null ? 'بدون تغییر خوانده‌شده' : net > 0.3 ? 'برآیند صعودی' : net < -0.3 ? 'برآیند نزولی' : 'خنثی';
  const moodEn = net === null ? 'no measured change' : net > 0.3 ? 'net positive' : net < -0.3 ? 'net negative' : 'neutral';
  return isPersian
    ? `${rows.length} خوانش · ${proxy} پروکسی · ${moodFa}${net !== null ? ` (${pctFa(net)})` : ''} — ${parts}`
    : `${rows.length} reads · ${proxy} proxies · ${moodEn}${net !== null ? ` (${pctEn(net)})` : ''} — ${parts}`;
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

export function buildFlowMap(data = {}) {
  const x = extractWorldInputs(data);
  const mk = (id, fa, en, basis) => ({ id, fa, en, ...basis });

  const nodes = [
    mk('usd', 'دلار آمریکا', 'US Dollar', num(x.dxy?.change1dPct) !== null
      ? {
        status: 'ok', dir: signOf(x.dxy.change1dPct), value: pctEn(x.dxy.change1dPct), valueFa: pctFa(x.dxy.change1dPct),
        magnitude: Math.abs(x.dxy.change1dPct), unit: '% 1d', source: x.dxy.source,
        evidence: `${x.dxy.symbol || 'DXY'} ${num(x.dxy.priceUsd) ?? ''}`.trim()
      }
      : { status: 'unread', evidence: null }),
    mk('treasuries', 'اوراق قرضه آمریکا', 'US Treasuries', num(x.us10y?.change1dPct) !== null
      ? {
        status: 'ok', dir: signOf(x.us10y.change1dPct), value: pctEn(x.us10y.change1dPct), valueFa: pctFa(x.us10y.change1dPct),
        magnitude: Math.abs(x.us10y.change1dPct), unit: '% 1d', source: x.us10y.source,
        evidence: `${x.us10y.symbol || 'US10Y'} @ ${num(x.us10y.priceUsd) ?? ''}${x.curve ? ` · 2s10s ${x.curve.spreadPct}pp` : ''}`
      }
      : { status: 'unread', evidence: null }),
    mk('gold', 'طلا', 'Gold', num(x.gold?.change1dPct) !== null
      ? {
        status: 'ok', dir: signOf(x.gold.change1dPct), value: pctEn(x.gold.change1dPct), valueFa: pctFa(x.gold.change1dPct),
        magnitude: Math.abs(x.gold.change1dPct), unit: '% 1d', source: x.gold.source,
        evidence: `${x.gold.symbol || 'GOLD'} @ ${num(x.gold.priceUsd) ?? ''}${num(x.gold.change7dPct) !== null ? ` · 7d ${pctEn(x.gold.change7dPct)}` : ''}`
      }
      : { status: 'unread', evidence: null }),
    mk('btc', 'بیت‌کوین و رمزارزها', 'Bitcoin & crypto', num(x.crypto?.avgChangePct) !== null
      ? {
        status: 'ok', dir: signOf(x.crypto.avgChangePct), value: pctEn(x.crypto.avgChangePct), valueFa: pctFa(x.crypto.avgChangePct),
        magnitude: Math.abs(x.crypto.avgChangePct), unit: '% 24h avg', source: 'cross-asset-engine',
        evidence: x.tokenFlows?.topInflow ? `top inflow ${x.tokenFlows.topInflow.symbol} ${usdCompact(x.tokenFlows.topInflow.mcapChangeUsd)}` : null
      }
      : { status: 'unread', evidence: null }),
    mk('defi', 'دیفای (استیبل‌کوین‌ها)', 'DeFi (stablecoins)', num(x.chainFlows?.net24hUsd) !== null
      ? {
        status: 'ok', dir: signOf(x.chainFlows.net24hUsd), value: usdCompact(x.chainFlows.net24hUsd).replace('+', ''),
        valueFa: usdCompact(x.chainFlows.net24hUsd).replace('+', '').replace('-', '\u2212'),
        magnitude: Math.abs(x.chainFlows.net24hUsd), unit: 'USD 24h', source: 'defillama',
        evidence: x.chainFlows.topInflowChain ? `top chain ${x.chainFlows.topInflowChain.chain} ${usdCompact(x.chainFlows.topInflowChain.net24hUsd)}` : null
      }
      : { status: 'unread', evidence: null }),
    mk('rwa', 'دارایی‌های واقعی (RWA)', 'Real-world assets', (() => {
      const inst = x.rwaInstruments;
      const ch = inst.map((i) => num(i.change24hPct)).filter((v) => v !== null);
      if (!inst.length && !x.rwa) return { status: 'unread', evidence: null };
      const avg = ch.length ? round(ch.reduce((a, c) => a + c, 0) / ch.length) : num(x.rwa?.avgChangePct);
      return {
        status: 'ok', dir: signOf(avg), value: avg !== null ? pctEn(avg) : String(inst.length), valueFa: avg !== null ? pctFa(avg) : faNum(inst.length),
        magnitude: avg === null ? null : Math.abs(avg), unit: avg !== null ? '% 24h avg' : 'instruments',
        source: x.envel.rwa?.source || 'cross-asset-engine',
        evidence: inst.length ? `${inst.length} instrument(s)` : null
      };
    })())
  ];
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      from: nodes[i].id, to: nodes[i + 1].id,
      active: nodes[i].status === 'ok' && nodes[i + 1].status === 'ok',
      strength: clamp((((nodes[i].magnitude ?? 0) + (nodes[i + 1].magnitude ?? 0)) / 2) / 2, 0.15, 1),
      labelFa: nodes[i].evidence && nodes[i + 1].evidence ? `${nodes[i].fa} → ${nodes[i + 1].fa}` : null
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
  return { route, token, stable, classMoves, whales, verdict, at: num(x.tokenFlows?.at) || null };
}

/* ══════════════════════════════════════════════════════════════════════════
   7) MACRO TRANSMISSION — oil → inflation → yields → dollar → EM → crypto.
   Every node carries the real reading (or says it is a model/proxy node) and
   the edges light only when both endpoints were read.
   ══════════════════════════════════════════════════════════════════════════ */

export function buildTransmission(data = {}) {
  const x = extractWorldInputs(data);
  const energyAvg = (() => {
    const vals = [num(x.wti?.change1dPct), num(x.brent?.change1dPct)].filter((v) => v !== null);
    return vals.length ? round(vals.reduce((a, c) => a + c, 0) / vals.length) : null;
  })();
  const mk = (id, fa, en, icon, reading, evidence) => ({ id, fa, en, icon, evidence: evidence || null, ...reading });

  const nodes = [
    mk('oil', 'نفت خام', 'Crude oil', 'flame', energyAvg !== null
      ? { state: 'read', dir: signOf(energyAvg), value: pctEn(energyAvg), valueFa: pctFa(energyAvg), source: x.wti?.source || x.brent?.source || null, meters: [num(x.wti?.change7dPct) !== null ? { key: 'wti7d', value: num(x.wti.change7dPct) } : null].filter(Boolean) }
      : { state: 'unread' },
      energyAvg !== null ? `WTI ${pctEn(num(x.wti?.change1dPct))} · Brent ${pctEn(num(x.brent?.change1dPct))}` : null),
    mk('inflation', 'انتظارات تورمی', 'Inflation expectations', 'pulse', energyAvg !== null
      ? { state: 'proxy', dir: signOf(energyAvg), value: null, source: null, noteFa: 'پروکسی: از حرکت انرژی', noteEn: 'proxy: from the energy move' }
      : { state: 'unread' },
      energyAvg !== null ? 'energy move used as the inflation-expectations proxy' : null),
    mk('yields', 'بازده اوراق', 'Bond yields', 'chart', num(x.us10y?.change1dPct) !== null
      ? { state: 'read', dir: signOf(x.us10y.change1dPct), value: pctEn(x.us10y.change1dPct), valueFa: pctFa(x.us10y.change1dPct), source: x.us10y.source || null, meters: [x.curve ? { key: 'curve2s10s', value: x.curve.spreadPct } : null].filter(Boolean) }
      : { state: 'unread' },
      num(x.us10y?.priceUsd) !== null ? `${x.us10y.symbol || 'US10Y'} @ ${x.us10y.priceUsd}%${x.curve ? ` · 2s10s ${x.curve.spreadPct}pp` : ''}` : null),
    mk('usd', 'دلار آمریکا', 'US Dollar', 'bank', num(x.dxy?.change1dPct) !== null
      ? { state: 'read', dir: signOf(x.dxy.change1dPct), value: pctEn(x.dxy.change1dPct), valueFa: pctFa(x.dxy.change1dPct), source: x.dxy.source || null, meters: [] }
      : { state: 'unread' },
      num(x.dxy?.priceUsd) !== null ? `${x.dxy.symbol || 'DXY'} @ ${x.dxy.priceUsd}` : null),
    mk('em', 'فشار بازارهای نوظهور', 'Emerging-market pressure', 'globe', num(x.dxy?.change1dPct) !== null
      ? { state: 'model', dir: signOf(x.dxy.change1dPct), value: null, source: null, noteFa: 'گرهٔ مدل — فقط با خوانش دلار فعال می‌شود', noteEn: 'model node — activates only with the dollar read' }
      : { state: 'unread' },
      null),
    mk('cryptoliq', 'نقدینگی رمزارز', 'Crypto liquidity', 'coin', (() => {
      const avg = num(x.crypto?.avgChangePct);
      const net = num(x.chainFlows?.net24hUsd);
      if (avg !== null) return { state: 'read', dir: signOf(avg), value: pctEn(avg), valueFa: pctFa(avg), source: 'cross-asset-engine', meters: net !== null ? [{ key: 'stablecoinNet', value: net }] : [] };
      if (net !== null) return { state: 'read', dir: signOf(net), value: usdCompact(net).replace('+', ''), valueFa: usdCompact(net).replace('+', '').replace('-', '\u2212'), source: 'defillama', meters: [] };
      return { state: 'unread' };
    })(),
      num(x.chainFlows?.net24hUsd) !== null ? `stablecoin net ${usdCompact(x.chainFlows.net24hUsd)}` : null)
  ];
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      from: nodes[i].id, to: nodes[i + 1].id,
      lit: nodes[i].state !== 'unread' && nodes[i + 1].state !== 'unread',
      labelFa: `${nodes[i].fa} → ${nodes[i + 1].fa}`,
      labelEn: `${nodes[i].en} → ${nodes[i + 1].en}`
    });
  }
  return { nodes, edges, origin: 'local' };
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

export function buildChallenger(data = {}) {
  const x = extractWorldInputs(data);

  /* Find the strongest positive signal — that is the thesis to attack. */
  let opp = null;
  const cryptoAvg = num(x.crypto?.avgChangePct);
  if (x.tokenFlows?.topInflow && num(x.tokenFlows.topInflow.mcapChangeUsd) > 0) {
    opp = { id: 'tokenInflow', label: `${x.tokenFlows.topInflow.symbol}`, detail: 'top capital inflow (CoinGecko 24h market-cap delta)', value: `+${round(x.tokenFlows.topInflow.mcapChangePct)}%` };
  } else if (cryptoAvg !== null && cryptoAvg > 0) {
    opp = { id: 'cryptoClass', label: 'crypto class', detail: 'positive measured 24h class average', value: `+${round(cryptoAvg)}%` };
  } else if (x.chainFlows?.topInflowChain) {
    opp = { id: 'chainInflow', label: x.chainFlows.topInflowChain.chain, detail: 'top stablecoin inflow chain', value: `$${Math.round(Math.abs(x.chainFlows.topInflowChain.net24hUsd || 0) / 1e6)}M` };
  }
  if (!opp) return { opportunity: null, arguments: [], observed: 0 };

  const stableNet = num(x.chainFlows?.net24hUsd);
  const smNet = smartMoneyNet(x);
  const dxyChg = num(x.dxy?.change1dPct);
  const inverted = x.curve && num(x.curve.spreadPct) < 0;
  const spread = (() => {
    const avgs = Object.values(x.classes).map((c) => num(c?.avgChangePct)).filter((v) => v !== null);
    return avgs.length ? Math.max(...avgs.map(Math.abs)) : null;
  })();

  const args = [
    {
      id: 'macro', key: 'macroRisk',
      observed: String(x.outlook?.label) === 'RECESSION_WATCH' || inverted,
      evidence: inverted ? `2s10s inverted at ${x.curve.spreadPct}pp` : String(x.outlook?.label || '')
    },
    {
      id: 'liquidity', key: 'liquidityRisk',
      observed: stableNet !== null && stableNet < 0,
      evidence: stableNet !== null ? `stablecoin net ${usdCompact(stableNet)}` : null
    },
    {
      id: 'dollar', key: 'dollarHeadwind',
      observed: dxyChg !== null && dxyChg > 0,
      evidence: dxyChg !== null ? `DXY ${pctEn(dxyChg)}` : null
    },
    {
      id: 'whale', key: 'whaleExitRisk',
      observed: smNet !== null && smNet < 0,
      evidence: smNet !== null ? `labelled net ${usdCompact(smNet)}` : null
    },
    {
      id: 'divergence', key: 'divergenceRisk',
      observed: x.divergences.length > 0,
      evidence: x.divergences[0] ? `${arr(x.divergences[0].classes).join(' vs ')} gap ${x.divergences[0].gapPct}pp` : null
    },
    {
      id: 'volatility', key: 'volatilityRisk',
      observed: spread !== null && spread >= 2,
      evidence: spread !== null ? `widest class move ${pctEn(spread)}` : null
    },
    {
      id: 'coverage', key: 'dataGapRisk',
      observed: (x.missingDomains.length || 0) >= 2,
      evidence: `${x.missingDomains.length || 0} domains unread`
    },
    { id: 'model', key: 'modelRisk', observed: false, evidence: 'all sensitivities are first-order model terms' }
  ];
  return { opportunity: opp, arguments: args, observed: args.filter((a) => a.observed).length };
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
  return { nodes: t.nodes.map((n) => ({ ...n, state: n.state, value: n.value ?? null })), edges: t.edges, origin: 'local' };
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

export const DOMAIN_KEYS = Object.freeze(Object.keys(DOMAIN_LABELS));

export function buildDomainsView(domains) {
  if (!domains) return [];
  return Object.keys(DOMAIN_LABELS).map((key) => {
    const env = domains[key] || null;
    const status = env?.status || 'UNAVAILABLE';
    const data = status === 'OK' ? env.data : null;
    const out = {
      key, status, reason: env?.reason || null, source: env?.source || null,
      at: num(env?.at), confidence: num(env?.confidence),
      stale: data?.stale === true, partial: env?.partial === true,
      label: DOMAIN_LABELS[key], metrics: [], list: [], listKind: null
    };

    if (key === 'smart_money' && data) {
      const net = smartMoneyNet({ sm: data });
      if (net !== null) out.metrics.push({ key: 'netFlow', fa: 'جریان خالص', en: 'net flow', value: usdCompact(net), dir: signOf(net) });
      if (num(data.accumulationUsd) !== null) out.metrics.push({ key: 'accumulation', fa: 'انباشت', en: 'accumulation', value: usdCompact(data.accumulationUsd), dir: 'up' });
      if (num(data.distributionUsd) !== null) out.metrics.push({ key: 'distribution', fa: 'توزیع', en: 'distribution', value: usdCompact(-Math.abs(num(data.distributionUsd))), dir: 'down' });
      if (num(data.whaleActivity?.count) !== null) out.metrics.push({ key: 'whaleActivity', fa: 'رویداد نهنگ', en: 'whale events', value: String(data.whaleActivity.count), dir: num(data.whaleActivity.changePct) === null ? 'flat' : signOf(data.whaleActivity.changePct) });
      if (data.window) out.metrics.push({ key: 'window', fa: 'پنجره', en: 'window', value: String(data.window), dir: 'flat' });
      out.listKind = 'tokens';
      out.list = arr(data.topTokens).map((t) => ({
        symbol: t.symbol, chain: t.chain, flow: t.signal || t.flow || null,
        valueUsd: num(t.netUsd) ?? num(t.valueUsd), confidence: num(t.confidence)
      }));
    } else if (key === 'whales' && data) {
      if (num(data.count) !== null) out.metrics.push({ key: 'count', fa: 'رویداد', en: 'events', value: String(data.count), dir: 'flat' });
      const top = arr(data.events).slice().sort((a, b) => (num(b.valueUsd) || 0) - (num(a.valueUsd) || 0))[0];
      if (top) out.metrics.push({ key: 'topEvent', fa: 'بزرگ‌ترین انتقال', en: 'largest transfer', value: `${top.symbol} ${usdCompact(top.valueUsd)}`, dir: 'flat' });
      out.listKind = 'whales';
      out.list = arr(data.events).map((e) => ({ symbol: e.symbol, chain: e.chain, valueUsd: num(e.valueUsd), flow: e.flow, at: num(e.at) }));
    } else if (key === 'onchain' && data) {
      const sources = arr(data.sources);
      if (num(data.healthySources) !== null) out.metrics.push({ key: 'healthy', fa: 'منبع سالم', en: 'healthy sources', value: `${data.healthySources}/${sources.length}`, dir: 'flat' });
      if (num(data.downSources) !== null && num(data.downSources) > 0) out.metrics.push({ key: 'down', fa: 'منبع خاموش', en: 'sources down', value: String(data.downSources), dir: 'down' });
      if (num(data.degradedSources) !== null && num(data.degradedSources) > 0) out.metrics.push({ key: 'degraded', fa: 'منبع نیمه‌سالم', en: 'degraded', value: String(data.degradedSources), dir: 'down' });
      if (data.scope) out.metrics.push({ key: 'scope', fa: 'دامنهٔ بررسی', en: 'scope', value: String(data.scope), dir: 'flat' });
      out.listKind = 'sources';
      out.list = sources.map((s) => ({ symbol: s.source, status: s.status, failures: num(s.failures), lastOkAt: num(s.lastOkAt) }));
      out.activity = arr(data.activity).slice(0, 6).map((e) => ({ type: e.type, detail: e.detail, source: e.source, at: num(e.at) }));
    } else if (key === 'news' && data) {
      if (num(data.count) !== null) out.metrics.push({ key: 'count', fa: 'سرفصل', en: 'headlines', value: String(data.count), dir: 'flat' });
      out.listKind = 'headlines';
      out.list = arr(data.items).slice(0, 8).map((n) => ({ symbol: n.symbols?.[0] || null, title: n.title, url: n.url, source: n.source, lang: n.lang, at: num(n.at) }));
    } else if (key === 'macro' && data) {
      if (num(data.attention) !== null) out.metrics.push({ key: 'attention', fa: 'توجه خبری', en: 'attention', value: String(data.attention), dir: 'flat' });
      const topics = Object.entries(data.byTopic || {}).sort((a, b) => b[1] - a[1]);
      /* both top topics: a single classifier label would hide the second
         theme that was equally present in this pass's headlines */
      if (topics.length) out.metrics.push({ key: 'topics', fa: 'موضوع‌های برتر', en: 'top topics', value: topics.slice(0, 2).map(([t, n]) => `${t}×${n}`).join(' · '), dir: 'flat' });
      const quotes = arr(data.instruments).length ? arr(data.instruments) : arr(data.quotes);
      if (quotes.length) out.metrics.push({ key: 'quotes', fa: 'نقل‌قول', en: 'quotes', value: String(quotes.length), dir: 'flat' });
      out.listKind = 'topics';
      out.list = topics.map(([topic, count]) => ({ symbol: topic, valueUsd: null, count }));
      out.quotes = quotes.slice(0, 8).map((q) => ({ symbol: q.symbol, priceUsd: num(q.priceUsd), change1dPct: num(q.change1dPct), source: q.source }));
    } else if (data && arr(data.instruments)) {
      const inst = arr(data.instruments);
      if (num(data.instruments) === null && inst.length) out.metrics.push({ key: 'instruments', fa: 'ابزار', en: 'instruments', value: String(inst.length), dir: 'flat' });
      const withChange = inst.filter((i) => num(i.change24hPct) !== null);
      const avg = withChange.length ? withChange.reduce((s, i) => s + num(i.change24hPct), 0) / withChange.length : null;
      if (avg !== null) out.metrics.push({ key: 'avg', fa: 'میانگین ۲۴س', en: 'avg 24h', value: pctEn(avg), dir: signOf(avg) });
      out.listKind = 'instruments';
      out.list = inst.slice(0, 8).map((i) => ({ symbol: i.symbol, name: i.name, valueUsd: null, changePct: num(i.change24hPct), priceUsd: num(i.priceUsd) }));
      out.readOnly = data.readOnly === true;
    }
    return out;
  });
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
