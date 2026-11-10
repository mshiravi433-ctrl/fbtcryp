/**
 * MARKET FRAME — what this turn can actually say about the market, and what it cannot.
 * ---------------------------------------------------------------------------
 * A market answer goes wrong in a specific, repeatable way: the turn holds one
 * 24h print and three prices, and the answer talks about a 200-day average, a
 * trendline, an RSI divergence, and a three-month target. Every one of those
 * needs a price HISTORY that the turn never had. The model is not lying about
 * the market; it is answering from its training instead of from the data.
 *
 * So before the specialists write, this module computes a frame from the data
 * actually present — no model call, no fetch:
 *
 *   · instruments — price, 24h change, 24h range, volume, market cap, ATH,
 *     sector: whatever the context carries, normalised;
 *   · breadth, dispersion and a volatility REGIME across those instruments;
 *   · relative strength against the benchmark (BTC), when both changes exist;
 *   · horizon support — with no history, the honest horizon is «today»; a 7d
 *     change buys a week, nothing buys a month;
 *   · NOT SUPPORTED — the indicators this turn's data cannot carry (RSI, MACD,
 *     moving averages, trendlines, correlations, depth/slippage, funding,
 *     open interest);
 *   · gaps — what is missing (live read, breadth, sector, volume).
 *
 * `checkMarketAnalysis` then holds the draft to it: an indicator that needs
 * history, or a horizon the data cannot support, becomes a MUST-FIX for the
 * reviewer instead of a confident-looking number.
 */

export const MARKET_FRAME_SCHEMA = 'fbt.ai-market-frame.v1';
export const MARKET_FRAME_VERSION = '1.0.0';

const num = (v) => (v == null || v === '' || typeof v === 'boolean' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

const ASSET_RE = /\b(btc|eth|sol|bnb|xrp|ada|doge|ton|avax|link|arb|op|matic|gold|xau)\b|بیت[\s]*کوین|اتریوم|سولانا|ریپل|دوج/gi;
/* ZWNJ (U+200C) is a letter to JS but whitespace to a reader: «می‌رسد» and
   «می رسد» are the same word, so every Persian word gap tolerates it. */
const ZW = '[\\s\\u200c]*';
const ANALYSIS_RE = [
  new RegExp(`تحلیل|بررسی|وضعیت|روند|بازار|سیگنال|نقطه${ZW}ورود|حمایت|مقاومت|آینده|پیش${ZW}بینی|نوسان`),
  /\banaly[sz]e\b|\bmarket\b|\btrend\b|\bsetup\b|\boutlook\b|\bchart\b|\bforecast\b/i
];

/** Is this a market-analysis turn (as opposed to a price quote or small talk)? */
export function detectMarketAnalysis(message = '', taskTypes = []) {
  const text = String(message || '');
  if (!text.trim()) return false;
  const types = Array.isArray(taskTypes) ? taskTypes : [];
  const asset = new RegExp(ASSET_RE.source, 'i').test(text);
  const analytical = ANALYSIS_RE.some((re) => re.test(text));
  if (types.includes('market') && (asset || analytical)) return true;
  return asset && analytical;
}

/* ── extraction ───────────────────────────────────────────────────────────── */

function rowFrom(raw = {}, symbolHint = null) {
  const symbol = String(raw.symbol || raw.coin || raw.ticker || symbolHint || '').toUpperCase();
  if (!symbol) return null;
  const price = num(raw.priceUsd ?? raw.price ?? raw.usd ?? raw.current_price ?? raw.last);
  const change = num(raw.change24hPct ?? raw.change24h ?? raw.price_change_percentage_24h ?? raw.change);
  /* A number in `priceMap` IS the price; anything richer may carry more. */
  return {
    symbol,
    price,
    change24hPct: change,
    change7dPct: num(raw.change7dPct ?? raw.change7d ?? raw.price_change_percentage_7d),
    volume24hUsd: num(raw.volume24hUsd ?? raw.volume24h ?? raw.volume ?? raw.total_volume),
    marketCapUsd: num(raw.marketCapUsd ?? raw.marketCap ?? raw.market_cap),
    sector: raw.sector || raw.category || null,
    ath: num(raw.ath ?? raw.allTimeHigh),
    low24h: num(raw.low24h ?? raw.low_24h ?? raw.low),
    high24h: num(raw.high24h ?? raw.high_24h ?? raw.high)
  };
}

function collectInstruments(context = {}) {
  const market = context.market || {};
  const bySymbol = new Map();
  const put = (row) => {
    if (!row) return;
    const existing = bySymbol.get(row.symbol);
    bySymbol.set(row.symbol, existing ? { ...existing, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value != null)) } : row);
  };

  for (const key of ['assets', 'coins', 'rows', 'instruments']) {
    if (Array.isArray(market[key])) for (const raw of market[key]) put(rowFrom(raw));
  }
  const priceMap = market.priceMap || context.priceMap || null;
  if (priceMap && typeof priceMap === 'object') {
    for (const [symbol, value] of Object.entries(priceMap)) {
      if (value == null) continue;
      if (typeof value === 'object') put(rowFrom(value, symbol));
      else put(rowFrom({ price: value }, symbol));
    }
  }
  return [...bySymbol.values()].filter((r) => r.symbol);
}

/* ── the frame ────────────────────────────────────────────────────────────── */

const Z = '[\\s\\u200c]*';
const HORIZON_WORDS = [
  { re: new RegExp(`(?:تا|در)${Z}(?:یک|۱|1)${Z}(?:سال|ساله)`), days: 365 },
  { re: new RegExp(`(?:تا|در)${Z}(?:شش|۶|6)${Z}ماه`), days: 180 },
  { re: new RegExp(`(?:تا|در)${Z}(?:سه|۳|3)${Z}ماه`), days: 90 },
  { re: new RegExp(`(?:تا|در)${Z}(?:نه|۹|9)${Z}ماه`), days: 270 },
  { re: new RegExp(`(?:تا|در)${Z}(?:یک|۱|1)${Z}ماه|ماه${Z}آینده|ماه${Z}بعد`), days: 30 },
  { re: new RegExp(`(?:تا|در)${Z}(?:یک|۱|1)${Z}هفته|هفته${Z}آینده|هفته${Z}بعد|چند${Z}هفته`), days: 7 },
  { re: /\b(?:next|in\s+(?:a|one))\s+week\b/i, days: 7 },
  { re: /\b(?:next|in\s+(?:a|one))\s+month\b/i, days: 30 },
  { re: /\b(?:next|in\s+(?:a|one))\s+quarter\b/i, days: 90 },
  { re: /\b(?:next|in\s+(?:a|one))\s+year\b/i, days: 365 }
];

function requestedHorizonDays(message = '') {
  const text = String(message || '');
  let days = null;
  for (const { re, days: d } of HORIZON_WORDS) {
    if (re.test(text)) days = Math.max(days || 0, d);
  }
  return days;
}

/**
 * Build the frame from what the turn holds. Every branch is additive: a context
 * with one price yields a small honest frame, never an invented one.
 */
export function buildMarketFrame({ context = {}, message = '', knowledge = [] } = {}) {
  const market = context.market || {};
  const instruments = collectInstruments(context);
  const withPrice = instruments.filter((i) => i.price != null);
  /* The context's top-level `change24hPct` is BTC's move; give it to the BTC row
     before breadth is counted, or the benchmark silently drops out of it. */
  const benchmark = instruments.find((i) => i.symbol === 'BTC') || null;
  const benchmarkChange = benchmark?.change24hPct ?? num(market.change24hPct) ?? null;
  if (benchmark && benchmark.change24hPct == null && benchmarkChange != null) benchmark.change24hPct = benchmarkChange;
  const changes = instruments.filter((i) => i.change24hPct != null);
  const dataStatus = String(market.dataStatus || market.status || (withPrice.length ? 'unknown' : 'missing')).toLowerCase();
  const stale = ['stale', 'offline', 'degraded', 'cached'].includes(dataStatus) || market.stale === true;


  const advancers = changes.filter((i) => i.change24hPct > 0).length;
  const decliners = changes.filter((i) => i.change24hPct < 0).length;
  const flat = changes.length - advancers - decliners;
  const changeValues = changes.map((i) => i.change24hPct);
  const dispersion = changeValues.length >= 2 ? Math.max(...changeValues) - Math.min(...changeValues) : null;

  const anchor = Math.abs(benchmarkChange ?? 0);
  const regime = dispersion == null && benchmarkChange == null
    ? 'unknown'
    : (anchor >= 6 || (dispersion ?? 0) >= 12)
      ? 'turbulent'
      : (anchor >= 2 || (dispersion ?? 0) >= 5)
        ? 'normal'
        : 'calm';

  const relative = instruments
    .filter((i) => i.symbol !== 'BTC' && i.change24hPct != null && benchmarkChange != null)
    .map((i) => ({ symbol: i.symbol, relativeStrength: round(i.change24hPct - benchmarkChange, 2) }));

  for (const i of instruments) {
    i.rangePosition = i.low24h != null && i.high24h != null && i.price != null && i.high24h > i.low24h
      ? round((i.price - i.low24h) / (i.high24h - i.low24h), 3)
      : null;
    i.drawdownFromAthPct = i.ath != null && i.price != null && i.ath > 0
      ? round(((i.ath - i.price) / i.ath) * 100, 2)
      : null;
    i.liquidityTier = i.volume24hUsd == null
      ? null
      : i.volume24hUsd >= 1e9 ? 'deep' : i.volume24hUsd >= 5e7 ? 'liquid' : 'thin';
  }

  const sectors = instruments.filter((i) => i.sector && i.change24hPct != null);
  const sectorAvg = new Map();
  for (const i of sectors) {
    const prev = sectorAvg.get(i.sector) || { sum: 0, n: 0 };
    sectorAvg.set(i.sector, { sum: prev.sum + i.change24hPct, n: prev.n + 1 });
  }
  const leadership = [...sectorAvg.entries()]
    .map(([sector, v]) => ({ sector, avgChangePct: round(v.sum / v.n, 2) }))
    .sort((a, b) => b.avgChangePct - a.avgChangePct);

  /* Horizon: the honest one is what the data can speak to. */
  const has7d = instruments.some((i) => i.change7dPct != null);
  const hasOhlc = [market.ohlc, market.candles].some((rows) => Array.isArray(rows) && rows.length >= 2);
  const supportedDays = has7d || hasOhlc ? 7 : 1;
  const askedDays = requestedHorizonDays(message);
  const horizonGap = askedDays != null && askedDays > supportedDays;

  const notSupported = [];
  if (!hasOhlc) notSupported.push('ohlc_history', 'rsi', 'macd', 'moving_averages', 'trendlines', 'bollinger', 'fibonacci');
  if (!market.orderBook && !market.depth) notSupported.push('orderbook_depth', 'slippage_estimate');
  if (!market.funding && !market.fundingRate) notSupported.push('funding_rate', 'positioning');
  if (!market.openInterest) notSupported.push('open_interest');
  if (!market.onchain && !knowledge.some((k) => /onchain|آن‌چین|on-chain/i.test(String(k?.text || k?.title || '')))) {
    notSupported.push('onchain_flows');
  }
  if (instruments.length < 2) notSupported.push('relative_strength', 'correlation');

  const gaps = [];
  if (!withPrice.length) gaps.push('live_prices');
  if (stale) gaps.push('fresh_market_data');
  if (instruments.length < 5) gaps.push('market_breadth');
  if (!sectors.length) gaps.push('sector_leadership');
  if (!instruments.some((i) => i.volume24hUsd != null)) gaps.push('volume');

  return {
    schema: MARKET_FRAME_SCHEMA,
    version: MARKET_FRAME_VERSION,
    asOf: num(market.fetchedAt) || null,
    dataStatus: dataStatus === 'unknown' && !withPrice.length ? 'missing' : dataStatus,
    stale,
    instruments,
    benchmark: benchmark ? { symbol: 'BTC', change24hPct: benchmarkChange } : (benchmarkChange != null ? { symbol: 'BTC', change24hPct: benchmarkChange } : null),
    breadth: {
      tracked: instruments.length,
      advancers,
      decliners,
      flat,
      ratio: decliners > 0 ? round(advancers / decliners, 2) : (advancers > 0 ? advancers : null)
    },
    dispersionPct: round(dispersion, 2),
    regime,
    relative,
    leadership,
    horizon: {
      supportedDays,
      requestedDays: askedDays,
      basis: hasOhlc ? 'ohlc_history' : has7d ? '24h+7d_change' : '24h_only',
      exceeded: horizonGap
    },
    notSupported,
    gaps
  };
}

/* ── rendering ────────────────────────────────────────────────────────────── */

const STATUS_FA = { live: 'زنده', stale: 'کهنه', offline: 'آفلاین', degraded: 'مخدوش', cached: 'کش‌شده', missing: 'ناموجود', unknown: 'نامشخص' };

/** The data half of the prompt: what is measured, and the hard limits. */
export function renderMarketFrame(frame) {
  if (!frame || frame.schema !== MARKET_FRAME_SCHEMA) return '';
  const lines = [];
  const status = STATUS_FA[frame.dataStatus] || frame.dataStatus;
  lines.push(`MARKET FRAME (computed from this turn's data; status=${status}):`);

  if (frame.instruments.length) {
    const rows = frame.instruments.slice(0, 8).map((i) => {
      const bits = [];
      if (i.price != null) bits.push(`$${i.price}`);
      if (i.change24hPct != null) bits.push(`${i.change24hPct > 0 ? '+' : ''}${i.change24hPct}% 24h`);
      if (i.rangePosition != null) bits.push(`range ${Math.round(i.rangePosition * 100)}%`);
      if (i.drawdownFromAthPct != null) bits.push(`${i.drawdownFromAthPct}% off ATH`);
      if (i.liquidityTier) bits.push(`liquidity ${i.liquidityTier}`);
      return `- ${i.symbol}: ${bits.join(', ')}`;
    });
    lines.push(...rows);
  } else {
    lines.push('- no instrument data in this turn.');
  }

  if (frame.breadth.tracked >= 2) {
    lines.push(`- breadth: ${frame.breadth.advancers} up / ${frame.breadth.decliners} down of ${frame.breadth.tracked}, dispersion ${frame.dispersionPct ?? '—'}pp, regime ${frame.regime}`);
  }
  if (frame.relative.length) {
    lines.push(`- vs BTC: ${frame.relative.map((r) => `${r.symbol} ${r.relativeStrength > 0 ? '+' : ''}${r.relativeStrength}pp`).join(', ')}`);
  }
  if (frame.leadership.length) {
    lines.push(`- sector leadership: ${frame.leadership.slice(0, 2).map((s) => `${s.sector} ${s.avgChangePct > 0 ? '+' : ''}${s.avgChangePct}%`).join(', ')}`);
  }
  lines.push(`- horizon this data supports: ${frame.horizon.supportedDays === 1 ? 'today only (24h print)' : `up to ${frame.horizon.supportedDays} days`} (${frame.horizon.basis})`
    + (frame.horizon.exceeded ? ` — the question asks for ${frame.horizon.requestedDays} days, so state the horizon mismatch explicitly` : ''));
  if (frame.notSupported.length) {
    lines.push(`- NOT SUPPORTED by this data (do not present a value for any of these): ${frame.notSupported.join(', ')}. If the user asks for one, say the turn has no price history / depth read and name what would be needed.`);
  }
  if (frame.gaps.length) lines.push(`- gaps: ${frame.gaps.join(', ')} — name them instead of filling them with a guess.`);
  return lines.join('\n');
}

/** The contract for the answer's shape ('' when there is no frame to respect). */
export function renderMarketContract(frame) {
  if (!frame || frame.schema !== MARKET_FRAME_SCHEMA) return '';
  return [
    'MARKET ANALYSIS CONTRACT (a researcher\'s market note, not a signal):',
    '- open with what the data shows, in the frame\'s own numbers; do not restate the price as a conclusion.',
    '- state what this data cannot support before the reader asks.',
    '- keep the horizon honest: with a 24h print, today\'s read is not a three-month thesis unless you mark it as a scenario.',
    '- name the invalidation level: the price or condition that proves this read wrong.',
    '- end with what to watch next (one data point), not with a promise.'
  ].join('\n');
}

/* ── compliance ───────────────────────────────────────────────────────────── */

const INDICATOR_RE = new RegExp(`(?<!\\p{L})(?:rsi|macd|ema|sma|ichimoku|bollinger|فیبوناچی|ایچیموکو|بولینگر|میانگین${Z}متحرک|خط${Z}روند|ترند${Z}لاین|دیورجنس|واگرایی)(?!\\p{L})`, 'iu');
const LONG_HORIZON_RE = new RegExp(`(?:تا|در)${Z}(?:یک|۱|1|دو|۲|2|سه|۳|3|شش|۶|6|نه|۹|9|دوازده|۱۲|12)${Z}(?:هفته|ماه|سال)|ماه${Z}آینده|سال${Z}آینده|بلند${Z}مدت|میان${Z}مدت|\\b(?:next|coming)\\s+(?:month|quarter|year)\\b`, 'i');
/* Persian boundary, not \b: «واگرایی» (divergence) CONTAINS «اگر», and matching
   inside it would exempt every answer that mentions a divergence. */
const CONDITIONAL_RE = new RegExp(`(?<!\\p{L})(?:اگر|مشروط|فرض)(?!\\p{L})|در${Z}صورت|سناریو|unless|if\\s|scenario`, 'iu');
const TARGET_RE = new RegExp(`(?:می${Z}رسد|می${Z}رسه|هدف|خواهد${Z}رسید|تا${Z}سطح|محدودهٔ?${Z}هدف|\\btarget\\b|\\bwill\\s+(?:reach|hit)\\b|\\bto\\s+\\$?\\d)`, 'i');
/* Saying «این داده سری زمانی ندارد، پس RSI قابل محاسبه نیست» is the CORRECT
   behaviour, not a violation: a sentence that denies the input is exempt. */
const DENIAL_RE = new RegExp(`(?:قابل${Z}محاسبه${Z}نیست|محاسبه${Z}نمی|در${Z}دسترس${Z}نیست|نمی${Z}توان|نداریم|ندارد|بدون${Z}سری|فقط${Z}قیمت${Z}لحظه|cannot\\s+be\\s+computed|not\\s+available|no\\s+(?:ohlc|price)\\s+history|don't\\s+have)`, 'iu');

/**
 * Did the answer respect the frame?
 *
 * Two checks, both narrow: an indicator whose input does not exist in this
 * turn, and a horizon target the data cannot carry. Conditional scenarios are
 * exempt from the horizon check — a scenario is allowed to be long, a forecast
 * is not.
 */
export function checkMarketAnalysis({ frame = null, answer = '' } = {}) {
  const text = String(answer || '');
  const issues = [];
  if (!frame || frame.schema !== MARKET_FRAME_SCHEMA || !text.trim()) {
    return { schema: MARKET_FRAME_SCHEMA, applicable: false, issues, compliant: true };
  }

  const sentences = text.split(/[.!?\n؛;]+/).map((x) => x.trim()).filter(Boolean);
  const claimsIndicator = sentences.some((sentence) => INDICATOR_RE.test(sentence) && !DENIAL_RE.test(sentence));
  if (frame.notSupported.includes('ohlc_history') && claimsIndicator) {
    issues.push({
      id: 'INDICATOR_WITHOUT_HISTORY',
      severity: 'HIGH',
      detail: 'the answer uses an indicator that needs a price history (RSI/MACD/moving average/trendline/divergence) and this turn has no OHLC series. Remove the indicator or say the turn cannot compute it.'
    });
  }

  const longHorizon = LONG_HORIZON_RE.test(text);
  const target = TARGET_RE.test(text);
  const conditional = CONDITIONAL_RE.test(text);
  if (frame.horizon.exceeded && longHorizon && target && !conditional) {
    issues.push({
      id: 'HORIZON_EXCEEDS_DATA',
      severity: 'MEDIUM',
      detail: `the question asks for ${frame.horizon.requestedDays} days but the data supports ${frame.horizon.supportedDays}. Present the longer view as an explicit scenario with its assumptions, or say the data cannot support it.`
    });
  }

  return {
    schema: MARKET_FRAME_SCHEMA,
    applicable: true,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft is clean). */
export function renderMarketViolations(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `MARKET FRAME VIOLATIONS (the answer claims more than the data holds; fix each one):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

export default buildMarketFrame;
