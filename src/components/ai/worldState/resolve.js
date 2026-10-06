/**
 * FBT WORLD CONSOLE — the reading resolver.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): gold, the dollar and the bonds were «خوانده نشد» on every
 * tab — the stations, the capital-flow map, the causal chain, the globe — even
 * though the page held a gold price, a dozen currency pairs and an ETF quote.
 *
 * The old extractor read each concept from exactly ONE place (`cross.macro
 * .indicators`). When the macro desk was dark the concept was unread
 * everywhere, however many other inputs on the page carried the same fact.
 * This resolver gives every concept an ORDERED list of places to look and says
 * which one answered:
 *
 *   measured  the instrument itself, with a 24h move
 *   proxy     a different instrument that moves with it, named as such
 *             (gold ← PAXG token or the GLD ETF; dollar ← the major FX pairs;
 *              bond yields ← the TLT bond ETF, inverted)
 *   level     a price with no move — enough to show, not enough to colour
 *   stale     measured, but the last good read rather than a live one
 *
 * HONESTY RULES (unchanged, and enforced here rather than in each panel):
 *   · a concept nobody could read stays null — never a plausible number;
 *   · a proxy is labelled a proxy on the object itself, so no panel can print
 *     it as if it were the instrument;
 *   · a level-only reading never supplies a move.
 *
 * Pure: no React, no DOM, no network.
 */

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const QUALITY = Object.freeze({ MEASURED: 'measured', PROXY: 'proxy', LEVEL: 'level', STALE: 'stale' });

/** the dollar-index basket (ICE): weight of each currency's USD pair. `usdQuote`
 *  = the pair is quoted CCY/USD (EUR/USD), so a rise there is a FALL of the dollar. */
const DXY_BASKET = Object.freeze([
  { ccy: 'EUR', w: 0.576, aliases: ['EURUSD'], usdQuote: true },
  { ccy: 'JPY', w: 0.136, aliases: ['USDJPY'], usdQuote: false },
  { ccy: 'GBP', w: 0.119, aliases: ['GBPUSD'], usdQuote: true },
  { ccy: 'CAD', w: 0.091, aliases: ['USDCAD'], usdQuote: false },
  { ccy: 'SEK', w: 0.042, aliases: ['USDSEK'], usdQuote: false },
  { ccy: 'CHF', w: 0.036, aliases: ['USDCHF'], usdQuote: false }
]);

/** typical modified duration of the 20Y+ treasury ETF — the bridge between a
 *  bond-price move and a yield move. A MODEL CONSTANT, only ever used for the
 *  direction and an order-of-magnitude note, and labelled as such. */
export const TLT_DURATION = 16.5;

/** how a raw upstream `source` string should read to a person. */
const CCY_FA = { EUR: 'یورو', JPY: 'ین', GBP: 'پوند', CAD: 'دلار کانادا', SEK: 'کرون سوئد', CHF: 'فرانک سوئیس' };

export function describeSource(source, isPersian = true) {
  const s = String(source || '');
  const head = s.split(':')[0].toLowerCase();
  const table = {
    ostium: ['Ostium', 'Ostium'],
    treasury: ['خزانه‌داری آمریکا', 'US Treasury'],
    ecb: ['بانک مرکزی اروپا', 'ECB'],
    fredcsv: ['FRED', 'FRED'], fred: ['FRED', 'FRED'],
    stooq: ['Stooq', 'Stooq'], yahoo: ['Yahoo Finance', 'Yahoo Finance'],
    av: ['Alpha Vantage', 'Alpha Vantage'],
    coingecko: ['CoinGecko', 'CoinGecko'], defillama: ['DefiLlama', 'DefiLlama'],
    macrodata: ['میز کلان', 'macro desk']
  };
  const hit = table[head];
  if (!hit) return s ? s.replace(/[:_]/g, ' ') : null;
  const label = isPersian ? hit[0] : hit[1];
  if (head === 'ecb' && /basket/i.test(s)) return isPersian ? 'سبد رسمی ECB' : 'ECB official basket';
  return label;
}

/** the quote shape every panel already understands, plus the quality facts. */
function quote({ symbol, name = null, priceUsd = null, change1dPct = null, change7dPct = null, source = null, at = null, quality, basisFa = null, basisEn = null, levelSource = null, unit = null }) {
  return {
    symbol, name, unit,
    priceUsd: num(priceUsd), change1dPct: num(change1dPct), change7dPct: num(change7dPct),
    source, at: num(at), quality, basisFa, basisEn, levelSource
  };
}

const withMove = (q) => q && num(q.change1dPct) !== null;

/** every instrument row the four class domains returned, with their symbol flattened */
function domainRows(x) {
  const rows = [];
  for (const [domain, list] of [['forex', x.forexInstruments], ['commodities', x.commoditiesInstruments], ['rwa', x.rwaInstruments], ['stocks', x.stocksInstruments]]) {
    for (const r of arr(list)) rows.push({ ...r, __flat: norm(r?.symbol), __domain: domain });
  }
  return rows;
}
const findRow = (rows, aliases) => {
  const want = aliases.map(norm);
  return rows.find((r) => want.includes(r.__flat)) || null;
};

/** a quote from an Ostium/brain domain row */
function fromRow(row, symbol, name, basisSourceLabel = 'ostium') {
  if (!row) return null;
  const move = num(row.change24hPct);
  return quote({
    symbol, name, priceUsd: row.priceUsd,
    change1dPct: move, change7dPct: row.change7dPct,
    source: move !== null && row.changeSource ? `${basisSourceLabel}:1D` : basisSourceLabel,
    at: row.asOf || null,
    quality: move !== null ? QUALITY.MEASURED : QUALITY.LEVEL
  });
}

/** macro indicator quote → resolver quote (flags stale reads) */
function fromIndicator(q, stale, ageMs) {
  if (!q) return null;
  const move = num(q.change1dPct);
  return quote({
    symbol: q.symbol, name: q.name, unit: q.unit, priceUsd: q.priceUsd,
    change1dPct: move, change7dPct: q.change7dPct, source: q.source, at: q.at,
    quality: move === null ? QUALITY.LEVEL : stale ? QUALITY.STALE : QUALITY.MEASURED,
    basisFa: stale && ageMs ? `آخرین خوانش سالم؛ ${Math.max(1, Math.round(ageMs / 60000))} دقیقه قدیمی` : null,
    basisEn: stale && ageMs ? `last good read; ${Math.max(1, Math.round(ageMs / 60000))} min old` : null
  });
}

/**
 * @param {object} x  the raw inputs extractWorldInputs gathered
 * @returns the resolved concepts + a per-concept provenance table
 */
export function resolveMarkets(x) {
  const stale = x.macroStale === true;
  const ageMs = num(x.macroStaleAgeMs);
  const ind = x.ind || {};
  const rows = domainRows(x);
  const pick = (...syms) => { for (const s of syms) if (ind[s]) return ind[s]; return null; };
  const choose = (...cands) => cands.find(withMove) || cands.find((c) => c && num(c.priceUsd) !== null) || null;

  /* ── gold ──────────────────────────────────────────────────────────────── */
  const goldMacro = fromIndicator(pick('GOLD', 'XAU', 'XAUUSD'), stale, ageMs);
  const goldOstium = fromRow(findRow(rows, ['XAUUSD']), 'XAU', 'Gold (Ostium)');
  const paxg = x.tokenFlows?.anchors?.PAXG || x.tokenFlows?.anchors?.XAUT || null;
  const goldToken = paxg && num(paxg.change24hPct) !== null ? quote({
    symbol: 'XAU', name: 'Gold (PAXG token)', priceUsd: goldOstium?.priceUsd ?? paxg.priceUsd,
    change1dPct: paxg.change24hPct, change7dPct: paxg.change7dPct,
    source: `coingecko:${paxg.symbol || 'PAXG'}`, quality: QUALITY.PROXY,
    levelSource: goldOstium?.priceUsd != null ? 'ostium' : 'coingecko',
    basisFa: 'توکن طلای ' + (paxg.symbol || 'PAXG') + ' — هر توکن معادل یک اونس طلاست', basisEn: `${paxg.symbol || 'PAXG'} gold-backed token — one token is one ounce`
  }) : null;
  const etf = arr(x.goldEtfs?.rows).find((r) => num(r?.changePct) !== null && num(r?.priceUsd) > 0) || null;
  const goldEtf = etf ? quote({
    symbol: 'XAU', name: `Gold (${etf.symbol} ETF)`, priceUsd: goldOstium?.priceUsd ?? null,
    change1dPct: etf.changePct, source: `av:${etf.symbol}`, quality: QUALITY.PROXY,
    levelSource: goldOstium?.priceUsd != null ? 'ostium' : null,
    basisFa: `صندوق طلای ${etf.symbol} — تغییر روزِ بورس آمریکا`, basisEn: `${etf.symbol} gold ETF — the US-session move`
  }) : null;
  const gold = choose(goldMacro, goldOstium, goldToken, goldEtf);

  /* ── silver / crude / copper ───────────────────────────────────────────── */
  const silver = choose(fromIndicator(pick('SILVER', 'XAG'), stale, ageMs), fromRow(findRow(rows, ['XAGUSD']), 'XAG', 'Silver (Ostium)'));
  const wti = choose(fromIndicator(pick('WTI', 'CL'), stale, ageMs), fromRow(findRow(rows, ['WTIUSD', 'CLUSD']), 'WTI', 'WTI (Ostium)'));
  const brent = choose(fromIndicator(pick('BRENT', 'BRN'), stale, ageMs), fromRow(findRow(rows, ['BRENTUSD']), 'BRENT', 'Brent (Ostium)'));
  const copper = choose(fromIndicator(pick('COPPER', 'HG', 'XCU'), stale, ageMs), fromRow(findRow(rows, ['XCUUSD', 'HGUSD']), 'COPPER', 'Copper (Ostium)'));

  /* ── equity index ──────────────────────────────────────────────────────── */
  const spxMacro = fromIndicator(pick('SPX'), stale, ageMs);
  const etfIdx = fromIndicator(pick('SPY', 'QQQ'), stale, ageMs);
  if (etfIdx && etfIdx.quality !== QUALITY.LEVEL) {
    etfIdx.quality = etfIdx.quality === QUALITY.STALE ? QUALITY.STALE : QUALITY.PROXY;
    etfIdx.basisFa = etfIdx.basisFa || `صندوق ${etfIdx.symbol} به‌جای خود شاخص`;
    etfIdx.basisEn = etfIdx.basisEn || `${etfIdx.symbol} ETF stands in for the index`;
  }
  const spxOstium = fromRow(findRow(rows, ['US500USD', 'SPXUSD']), 'SPX', 'S&P 500 (Ostium)');
  const spx = choose(spxMacro, spxOstium, etfIdx);

  /* ── dollar ────────────────────────────────────────────────────────────── */
  const dxyMacro = fromIndicator(pick('DXY'), stale, ageMs);
  if (dxyMacro && /^ecb:/i.test(String(dxyMacro.source || ''))) {
    dxyMacro.basisFa = dxyMacro.basisFa || 'محاسبه‌شده با وزن‌های رسمی شاخص دلار از نرخ‌های مرجع ECB';
    dxyMacro.basisEn = dxyMacro.basisEn || 'computed with the official dollar-index weights from ECB reference rates';
  }
  let dxyProxy = null;
  {
    let wSum = 0; let acc = 0; const used = [];
    for (const b of DXY_BASKET) {
      const r = findRow(rows, b.aliases);
      const c = r ? num(r.change24hPct) : null;
      if (c === null) continue;
      const usdMove = b.usdQuote ? -c : c; /* USD strength vs this currency */
      acc += b.w * usdMove; wSum += b.w; used.push(b.ccy);
    }
    if (wSum >= 0.6 && used.length >= 3) {
      dxyProxy = quote({
        symbol: 'DXY', name: 'Dollar basket (FX pairs)', priceUsd: null,
        change1dPct: Math.round((acc / wSum) * 100) / 100, source: 'ostium:1D', quality: QUALITY.PROXY,
        basisFa: `سبد جفت‌ارزهای اصلی (${used.map((c) => CCY_FA[c] || c).join('، ')}) با وزن شاخص دلار`, basisEn: `weighted basket of the major pairs (${used.join(', ')}) at dollar-index weights`
      });
    }
  }
  const dxy = choose(dxyMacro, dxyProxy);

  /* ── bonds ─────────────────────────────────────────────────────────────── */
  const us10y = fromIndicator(pick('US10Y'), stale, ageMs);
  const us2y = fromIndicator(pick('US2Y'), stale, ageMs);
  const us30y = fromIndicator(pick('US30Y'), stale, ageMs);
  const tltMacro = pick('TLT');
  const tlt = tltMacro ? fromIndicator(tltMacro, stale, ageMs) : fromRow(findRow(rows, ['TLTUSD']), 'TLT', 'TLT (Ostium)');
  if (tlt) { tlt.quality = withMove(tlt) ? (tlt.quality === QUALITY.STALE ? QUALITY.STALE : QUALITY.PROXY) : QUALITY.LEVEL; }

  /* ── crypto anchors ────────────────────────────────────────────────────── */
  const anchor = (sym) => {
    const a = x.tokenFlows?.anchors?.[sym];
    if (!a) return null;
    return quote({ symbol: sym, name: a.name, priceUsd: a.priceUsd, change1dPct: a.change24hPct, change7dPct: a.change7dPct, source: 'coingecko', quality: num(a.change24hPct) !== null ? QUALITY.MEASURED : QUALITY.LEVEL });
  };

  /* ── currency-vs-USD table (ECB reference rates) ───────────────────────── */
  const fxList = arr(x.macroDom?.fx).length ? arr(x.macroDom.fx) : arr(x.cross?.macro?.fx);
  const fx = {};
  for (const f of fxList) if (f?.ccy && num(f.perUsd) !== null) fx[String(f.ccy).toUpperCase()] = f;

  const concepts = { gold, silver, wti, brent, copper, spx, dxy, us10y, us2y, us30y, tlt, btc: anchor('BTC'), eth: anchor('ETH') };
  const provenance = {};
  for (const [k, v] of Object.entries(concepts)) {
    provenance[k] = v ? { quality: v.quality, source: v.source, basisFa: v.basisFa, basisEn: v.basisEn, hasMove: withMove(v) } : null;
  }
  return { ...concepts, fx, provenance };
}

/** The bond reading as ONE object the panels can print without caring whether
 *  it is the yield itself or its ETF proxy.
 *    measured → the 10Y yield and its move; the curve when read;
 *    proxy    → TLT's own move and the DIRECTION it implies for yields.
 *  `yieldBp` is the 1-day change of the yield in basis points, derived from the
 *  level and its percentage change (measured) or estimated from TLT (proxy,
 *  `estimate: true`). */
export function bondReading(r, curve = null) {
  const y = r?.us10y;
  if (y && num(y.priceUsd) !== null && num(y.change1dPct) !== null) {
    const level = y.priceUsd; const c = y.change1dPct;
    const prev = level / (1 + c / 100);
    return {
      kind: 'yield', quality: y.quality, level, yieldBp: Math.round((level - prev) * 100 * 10) / 10,
      movePct: c, dir: c > 0 ? 'up' : c < 0 ? 'down' : 'flat', source: y.source, at: y.at,
      curve: curve && num(curve.spreadPct) !== null ? curve.spreadPct : null, estimate: false, symbol: 'US10Y'
    };
  }
  const t = r?.tlt;
  if (t && num(t.change1dPct) !== null) {
    const c = t.change1dPct;
    return {
      kind: 'tlt', quality: t.quality, level: null, yieldBp: Math.round((-c / TLT_DURATION) * 100 * 10) / 10,
      movePct: c, dir: c > 0 ? 'down' : c < 0 ? 'up' : 'flat', /* a bond RALLY is a yield FALL */
      source: t.source, at: t.at, curve: null, estimate: true, symbol: 'TLT'
    };
  }
  if (y && num(y.priceUsd) !== null) {
    return { kind: 'yield', quality: QUALITY.LEVEL, level: y.priceUsd, yieldBp: null, movePct: null, dir: 'flat', source: y.source, at: y.at, curve: null, estimate: false, symbol: 'US10Y' };
  }
  return null;
}
