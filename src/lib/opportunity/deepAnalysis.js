/**
 * OPPORTUNITY — DEEP ANALYSIS MODEL
 * ---------------------------------------------------------------------------
 * «با کلیک روی هر فرصت، صفحه‌ای باز شود که شامل تحلیل تکنیکال، آن‌چین، نقدینگی،
 *  تاریخچه عملکرد، سناریوهای سود و زیان و ریسک قرارداد هوشمند باشد.»
 *
 * This module turns ONE opportunity row into the six blocks that page renders.
 * It is pure: it never fetches, so the page can render it from whatever it
 * already has and ask for more only where the block says `status: 'loading'`.
 *
 * ─── THE ONE RULE ───────────────────────────────────────────────────────────
 * A block with no evidence is `unavailable`, with the reason spelled out. It is
 * NEVER an empty chart, a zero, or a plausible-looking number. That matters
 * most for the smart-contract block: an audit we have not read is not "passed".
 *
 * ─── WHAT EACH BLOCK IS BUILT FROM ──────────────────────────────────────────
 *   technical    daily candles (getOhlc) → computeIndicators → trend, RSI, MACD,
 *                Bollinger position, ATR, support/resistance, drawdown
 *   onchain      the opportunity's own evidence rows (flow, holders, wallets) —
 *                the engine only carries what a feed actually reported
 *   liquidity    TVL / depth, the fee model's own slippage assumption, and the
 *                capital-to-depth ratio, which is what actually decides exit
 *   performance  yield history (getYieldHistory) when the row has a pool id;
 *                otherwise the measured price series, clearly labelled
 *   scenarios    arithmetic on the row's own economics: the same fees the card
 *                showed, applied across ±move bands — and impermanent loss for
 *                an LP position, because that is the number people forget
 *   contractRisk the engine's own risk components, expanded check by check
 */

import { computeIndicators } from '../intelligence/indicators.js';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const list = (v) => (Array.isArray(v) ? v : []);
const round = (v, d = 2) => (num(v) == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
const pct = (v) => (num(v) == null ? null : round(v, 2));

/** Categories where the position is a swap into an asset (price exposure). */
const DIRECTIONAL = new Set(['EMERGING_TOKEN', 'WHALE_FLOW']);
/** Categories with impermanent loss (two-asset exposure). */
const LP = new Set(['LIQUIDITY_POOL', 'FARMING']);
/** Categories whose yield is paid in a unit of account (no price exposure). */
const YIELD_ONLY = new Set(['LENDING', 'RWA']);

/* ═══════════════════════ TECHNICAL ═══════════════════════ */

/**
 * Technical read from real daily candles.
 *
 * `indicators` may be passed in (the token page already computed them) — the
 * function then only formats them, so two screens can never disagree about the
 * same RSI. With no candles the block is `unavailable` with the reason, which is
 * the honest answer for a lending market that has no chart of its own.
 */
export function technicalRead({ candles = null, indicators = null, priceUsd = null } = {}) {
  const computed = indicators || (list(candles).length >= 20 ? computeIndicators(candles) : null);
  if (!computed) {
    return {
      status: 'unavailable',
      reason: 'no-candles',
      noteFa: 'کندل کافی برای این دارایی در دسترس نیست؛ تحلیل تکنیکال ساخته نمی‌شود.',
      noteEn: 'Not enough candles for this asset; no technical read is produced.'
    };
  }
  const v = computed.values || {};
  const trend = v.trend || {};
  const signals = [];
  if (v.rsi14 != null) {
    signals.push({
      id: 'rsi', value: round(v.rsi14, 1),
      tone: v.rsi14 >= 70 ? 'hot' : v.rsi14 <= 30 ? 'cold' : 'neutral',
      labelFa: v.rsi14 >= 70 ? 'RSI در ناحیه اشباع خرید' : v.rsi14 <= 30 ? 'RSI در ناحیه اشباع فروش' : 'RSI در ناحیه میانی',
      labelEn: v.rsi14 >= 70 ? 'RSI overbought' : v.rsi14 <= 30 ? 'RSI oversold' : 'RSI mid-range'
    });
  }
  if (v.macdHist != null) {
    signals.push({
      id: 'macd', value: round(v.macdHist, 4),
      tone: v.macdHist > 0 ? 'up' : v.macdHist < 0 ? 'down' : 'neutral',
      labelFa: v.macdHist > 0 ? 'هیستوگرام MACD مثبت' : 'هیستوگرام MACD منفی',
      labelEn: v.macdHist > 0 ? 'MACD histogram positive' : 'MACD histogram negative'
    });
  }
  if (v.bbPercentB != null) {
    signals.push({
      id: 'bollinger', value: round(v.bbPercentB * 100, 1),
      tone: v.bbPercentB > 0.95 ? 'hot' : v.bbPercentB < 0.05 ? 'cold' : 'neutral',
      labelFa: `موقعیت در باند بولینگر: ${round(v.bbPercentB * 100, 0)}٪`,
      labelEn: `Bollinger band position: ${round(v.bbPercentB * 100, 0)}%`
    });
  }
  const levels = list(computed.levels);
  return {
    status: 'live',
    bars: computed.bars ?? list(candles).length,
    price: num(priceUsd) ?? v.close ?? null,
    trend: {
      label: trend.label ?? 'unknown',
      strength: round(trend.strength, 1),
      slopePct: round(trend.slopePct, 3),
      r2: round(trend.r2, 3)
    },
    position: {
      aboveSma20: computed.position?.aboveSma20 ?? null,
      aboveSma50: computed.position?.aboveSma50 ?? null,
      aboveSma200: computed.position?.aboveSma200 ?? null
    },
    volatility: {
      atrPct: round(v.atrPct, 2),
      drawdownPct: round(v.drawdown, 2)
    },
    levels: levels.slice(0, 4).map((l) => ({ price: round(l.price, 6), kind: l.kind ?? null, touches: l.touches ?? null })),
    signals
  };
}

/* ═══════════════════════ ON-CHAIN ═══════════════════════ */

/**
 * On-chain evidence — the rows the scan already verified.
 *
 * This is deliberately narrow. The engine only carries evidence a feed reported
 * (verified paired swaps, holder growth, pool TVL), so the block cannot become a
 * place where a screen invents "whale interest" nobody measured.
 */
export function onchainRead(opportunity) {
  const evidence = list(opportunity?.evidence);
  const m = opportunity?.metrics || {};
  const rows = [];
  if (m.netFlowUsd != null) {
    rows.push({
      id: 'netflow', value: round(m.netFlowUsd, 0), unit: 'usd',
      labelFa: m.netFlowUsd >= 0 ? 'جریان خالص ورودی نهنگ‌ها' : 'جریان خالص خروجی نهنگ‌ها',
      labelEn: m.netFlowUsd >= 0 ? 'Net whale inflow' : 'Net whale outflow'
    });
  }
  if (m.sampleSize != null && opportunity?.category === 'WHALE_FLOW') {
    rows.push({ id: 'wallets', value: m.sampleSize, labelFa: 'کیف‌پول مستقل تأییدشده', labelEn: 'Independent verified wallets' });
  }
  if (m.tvlUsd != null) {
    rows.push({ id: 'tvl', value: round(m.tvlUsd, 0), unit: 'usd', labelFa: 'TVL قرارداد', labelEn: 'Contract TVL' });
  }
  if (m.liquidityUsd != null && m.liquidityUsd !== m.tvlUsd) {
    rows.push({ id: 'liquidity', value: round(m.liquidityUsd, 0), unit: 'usd', labelFa: 'عمق نقدینگی', labelEn: 'Liquidity depth' });
  }
  if (m.utilizationPct != null) {
    rows.push({ id: 'utilization', value: round(m.utilizationPct, 1), unit: '%', labelFa: 'نرخ استفاده از استخر وام', labelEn: 'Borrow utilisation' });
  }
  if (m.ageDays != null) {
    rows.push({ id: 'age', value: round(m.ageDays, 1), unit: 'days', labelFa: 'عمر دارایی', labelEn: 'Asset age' });
  }
  return {
    status: rows.length || evidence.length ? 'live' : 'unavailable',
    reason: rows.length || evidence.length ? null : 'no-onchain-evidence',
    noteFa: rows.length ? null : 'برای این فرصت داده آن‌چین تأییدشده‌ای در دسترس نیست.',
    noteEn: rows.length ? null : 'No verified on-chain evidence is available for this opportunity.',
    rows,
    evidence: evidence.map((e) => ({ type: e.type, detail: e.detail }))
  };
}

/* ═══════════════════════ LIQUIDITY ═══════════════════════ */

/**
 * Liquidity and exit reality: how much the user's own position moves the pool.
 *
 * `impactPct` is the fee model's slippage estimate (capital ÷ depth × 50,
 * clamped) — the same number the card showed, so the page cannot contradict the
 * card. `exitDaysAtVolume` answers "how long would unwinding take" only when the
 * feed reported real volume; otherwise null.
 */
export function liquidityRead(opportunity, { capitalUsd = null } = {}) {
  const m = opportunity?.metrics || {};
  const e = opportunity?.economics || {};
  const depth = num(m.liquidityUsd) ?? num(m.tvlUsd);
  const capital = num(capitalUsd) ?? num(m.capitalNeededUsd) ?? num(e.capitalUsd);
  if (depth == null) {
    return {
      status: 'unavailable', reason: 'no-depth',
      noteFa: 'عمق نقدینگی این بازار در فید گزارش نشده است.',
      noteEn: 'The feed did not report this market’s liquidity depth.'
    };
  }
  const depthSharePct = capital != null && depth > 0 ? round((capital / depth) * 100, 3) : null;
  const slippagePct = num(e.fees?.slippagePctAssumed) ?? num(m.slippagePctAssumed);
  const volume = num(opportunity?.metrics?.volume24hUsd);
  return {
    status: 'live',
    depthUsd: round(depth, 0),
    capitalUsd: round(capital, 0),
    depthSharePct,
    slippagePct,
    slippageUsd: num(e.fees?.slippageUsd) ?? num(m.slippageUsd),
    /* One position holding >1% of a pool is already a price move on exit. */
    concentration: depthSharePct == null ? null : depthSharePct > 2 ? 'high' : depthSharePct > 0.5 ? 'medium' : 'low',
    volume24hUsd: volume != null ? round(volume, 0) : null,
    exitDaysAtVolume: volume != null && volume > 0 && capital != null ? round(capital / volume, 4) : null,
    noteFa: 'لغزش از نسبت سرمایه به عمق برآورد می‌شود، نه از دفتر سفارش.',
    noteEn: 'Slippage is estimated from capital ÷ depth, not from an order book.'
  };
}

/* ═══════════════════════ PERFORMANCE HISTORY ═══════════════════════ */

/**
 * Measured history for the row: a yield series when the row has a pool id, or a
 * price series. Both are REAL observations; neither is a projection, and the
 * block names which one it is.
 */
export function performanceRead({ history = null, priceSeries = null, kind = null } = {}) {
  const points = list(history?.points).filter((p) => num(p.apy) != null);
  if (points.length >= 2) {
    const values = points.map((p) => Number(p.apy));
    const first = values[0];
    const last = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return {
      status: 'live', kind: 'yield',
      range: history.range || null,
      source: history.source || null,
      points: points.map((p) => ({ t: p.timestamp, value: Number(p.apy) })),
      stats: {
        firstApyPct: round(first, 2), lastApyPct: round(last, 2),
        minApyPct: round(min, 2), maxApyPct: round(max, 2), meanApyPct: round(mean, 2),
        changePct: first > 0 ? round(((last - first) / first) * 100, 2) : null,
        /* How much of today's headline is above its own 30-day mean. */
        aboveMeanPct: mean > 0 ? round(((last - mean) / mean) * 100, 2) : null
      },
      noteFa: 'نرخ‌های واقعی ثبت‌شده در دوره؛ نرخ آینده تضمین نمی‌شود.',
      noteEn: 'Real recorded rates over the window; the future rate is not guaranteed.'
    };
  }
  const prices = list(priceSeries).filter((v) => num(v) != null);
  if (prices.length >= 2) {
    const first = Number(prices[0]);
    const last = Number(prices[prices.length - 1]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      status: 'live', kind: 'price',
      points: prices.map((value, i) => ({ t: null, value: Number(value), i })),
      stats: {
        firstPrice: round(first, 6), lastPrice: round(last, 6),
        minPrice: round(min, 6), maxPrice: round(max, 6),
        changePct: first > 0 ? round(((last - first) / first) * 100, 2) : null,
        drawdownPct: max > 0 ? round(((min - max) / max) * 100, 2) : null
      },
      noteFa: 'سری قیمت اندازه‌گیری‌شده؛ بازده گذشته تکرار نمی‌شود.',
      noteEn: 'Measured price series; past returns do not repeat.'
    };
  }
  return {
    status: 'unavailable', reason: kind === 'price' ? 'no-price-history' : 'no-yield-history',
    noteFa: 'تاریخچه عملکردی برای این مورد در دسترس نیست؛ عددی جای آن ساخته نمی‌شود.',
    noteEn: 'No performance history is available for this row; no number is invented in its place.'
  };
}

/* ═══════════════════════ PROFIT / LOSS SCENARIOS ═══════════════════════ */

/** Impermanent loss for a 50/50 pool at price ratio k (k = new/old). */
export function impermanentLossPct(k) {
  const r = Number(k);
  if (!Number.isFinite(r) || r <= 0) return null;
  return ((2 * Math.sqrt(r)) / (1 + r) - 1) * 100;
}

/**
 * ±move bands for this position, priced with the SAME fee block the card showed.
 *
 *   grossPct   the row's own yield over the horizon (or its one-off spread)
 *   pricePct   the move applied to the underlying  (0 for a unit-of-account
 *              yield — a USDC lending market does not care that ETH fell 20%)
 *   ilPct      impermanent loss, only for a two-asset LP
 *   feesPct    every fee, as a % of capital
 *   netUsd/netPct  what the position actually ends with
 */
export function scenarioTable(opportunity, { capitalUsd = null, horizonDays = null, moves = [-0.3, -0.15, 0, 0.15, 0.3] } = {}) {
  const e = opportunity?.economics;
  if (!e) {
    return {
      status: 'unavailable', reason: 'no-economics',
      noteFa: 'این فرصت بازده تخمینی ندارد (مثلاً جریان نهنگ یا توکن نوظهور)؛ سناریوی سود ساخته نمی‌شود.',
      noteEn: 'This opportunity carries no return estimate (a flow or an emerging token); no profit scenario is produced.'
    };
  }
  const capital = num(capitalUsd) ?? num(e.capitalUsd) ?? num(opportunity?.metrics?.capitalNeededUsd);
  if (!capital || capital <= 0) {
    return {
      status: 'unavailable', reason: 'no-capital',
      noteFa: 'برای محاسبه سناریو، سرمایه قابل استفاده لازم است.',
      noteEn: 'Investable capital is required to price the scenarios.'
    };
  }
  const days = num(horizonDays) ?? num(e.horizonDays) ?? 30;
  const category = opportunity?.category;
  const feeUsd = num(e.fees?.totalUsd) ?? 0;
  const feesPct = (feeUsd / capital) * 100;
  const grossApy = num(e.grossProfitUsd) != null && days > 0
    ? (Number(e.grossProfitUsd) / capital) * (365 / days) * 100
    : null;
  const isLp = LP.has(category);
  const directional = DIRECTIONAL.has(category) || isLp;
  const yieldPct = grossApy != null ? (grossApy * days) / 365 : 0;

  const rows = moves.map((move) => {
    const pricePct = directional ? move * 100 : 0;
    const ilPct = isLp && move !== 0 ? impermanentLossPct(1 + move) : 0;
    const grossPct = yieldPct + pricePct + (ilPct || 0);
    const netPct = grossPct - feesPct;
    return {
      movePct: round(move * 100, 0),
      pricePct: round(pricePct, 2),
      yieldPct: round(yieldPct, 2),
      ilPct: ilPct ? round(ilPct, 2) : 0,
      feesPct: round(feesPct, 3),
      netPct: round(netPct, 2),
      netUsd: round((capital * netPct) / 100, 2),
      tone: netPct > 0 ? 'up' : netPct < 0 ? 'down' : 'flat'
    };
  });

  /* Break-even move: how far the underlying can fall before the position loses
     money after fees. The single most useful line on the page. */
  const zeroRow = rows.find((r) => r.movePct === 0);
  const breakEvenMovePct = directional && zeroRow
    ? round(feesPct - yieldPct, 2)
    : null;

  return {
    status: 'live',
    capitalUsd: round(capital, 0),
    horizonDays: days,
    grossApyPct: round(grossApy, 2),
    feesUsd: round(feeUsd, 2),
    feesPct: round(feesPct, 3),
    priceExposure: directional,
    impermanentLoss: isLp,
    rows,
    breakEvenMovePct,
    noteFa: isLp
      ? 'برای استخر دو دارایی، افت نسبی قیمت باعث زیان دائمی (IL) می‌شود؛ ستون IL همین است.'
      : directional
        ? 'بازده تخمینی با حرکت قیمت جمع می‌شود؛ کارمزد و لغزش از آن کم می‌شود.'
        : 'بازده از نرخ وام/دارایی واقعی می‌آید و به حرکت قیمت همان دارایی وابسته نیست.',
    noteEn: isLp
      ? 'In a two-asset pool a relative price move causes impermanent loss; that is the IL column.'
      : directional
        ? 'The estimated yield adds to the price move; fees and slippage are subtracted.'
        : 'Yield comes from the lending/RWA rate and does not depend on that asset’s price move.'
  };
}

/* ═══════════════════════ SMART-CONTRACT RISK ═══════════════════════ */

/**
 * Expanded contract risk — the engine's components, check by check, with the
 * checks we CANNOT perform named as unknown rather than assumed safe.
 */
export function contractRiskRead(opportunity) {
  const risk = opportunity?.risk;
  if (!risk || risk.score == null) {
    return {
      status: 'unavailable', reason: 'no-risk-model',
      noteFa: 'مدل ریسک برای این مورد شاخصی ندارد.', noteEn: 'The risk model has no component for this row.'
    };
  }
  const c = risk.components || {};
  const checks = [
    { id: 'audit', status: 'unknown', labelFa: 'گزارش ممیزی قرارداد', labelEn: 'Contract audit report',
      detailFa: 'ممیزی مستقل در این اسکن خوانده نشده است؛ «تأییدشده» گزارش نمی‌شود.', detailEn: 'No independent audit was read in this scan; it is not reported as passed.' },
    { id: 'smartContract', value: c.smartContract, labelFa: 'ریسک قرارداد هوشمند', labelEn: 'Smart-contract risk' },
    { id: 'upgradeability', status: 'unknown', labelFa: 'قابلیت ارتقای قرارداد (proxy)', labelEn: 'Contract upgradeability (proxy)',
      detailFa: 'کلید ادمین و قابلیت ارتقا در این اسکن بررسی نشده است.', detailEn: 'Admin keys and upgradeability were not inspected in this scan.' },
    { id: 'liquidity', value: c.liquidity, labelFa: 'ریسک نقدینگی', labelEn: 'Liquidity risk' },
    { id: 'counterparty', value: c.counterparty, labelFa: 'ریسک طرف مقابل / پروتکل', labelEn: 'Counterparty / protocol risk' },
    { id: 'bridge', value: c.bridge, labelFa: 'ریسک پل بین‌شبکه‌ای', labelEn: 'Bridge risk' },
    { id: 'oracle', status: 'unknown', labelFa: 'منبع اوراکل قیمت', labelEn: 'Price oracle source',
      detailFa: 'منبع قیمت قرارداد در این اسکن بررسی نشده است.', detailEn: 'The contract’s price source was not inspected in this scan.' }
  ];
  return {
    status: 'live',
    score: risk.score,
    level: risk.level,
    coverage: risk.coverage,
    checks,
    noteFa: 'امتیاز از مؤلفه‌های موجود وزن‌دهی می‌شود؛ موارد «نامشخص» در محاسبه نیستند و ایمن فرض نشده‌اند.',
    noteEn: 'The score weights available components; “unknown” checks are excluded — not assumed safe.'
  };
}

/* ═══════════════════════ ASSEMBLY ═══════════════════════ */

/**
 * The whole deep-analysis model for one row.
 *
 * @param {object} opportunity  a row from scanOpportunities (or a scan result)
 * @param {object} ctx          { capitalUsd, horizonDays, candles, indicators,
 *                                priceSeries, yieldHistory }
 */
export function buildDeepAnalysis(opportunity, ctx = {}) {
  if (!opportunity) return null;
  const capital = num(ctx.capitalUsd) ?? num(opportunity.metrics?.capitalNeededUsd) ?? num(opportunity.economics?.capitalUsd);
  return {
    opportunityId: opportunity.opportunityId,
    category: opportunity.category,
    title: opportunity.title,
    technical: technicalRead({ candles: ctx.candles, indicators: ctx.indicators, priceUsd: opportunity.metrics?.priceUsd }),
    onchain: onchainRead(opportunity),
    liquidity: liquidityRead(opportunity, { capitalUsd: capital }),
    performance: performanceRead({ history: ctx.yieldHistory, priceSeries: ctx.priceSeries }),
    scenarios: scenarioTable(opportunity, { capitalUsd: capital, horizonDays: ctx.horizonDays }),
    contractRisk: contractRiskRead(opportunity),
    /* Score decomposition, so the single 0–100 on the card is auditable. */
    score: {
      total: opportunity.score ?? null,
      breakdown: opportunity.scoreBreakdown ?? null,
      confidence: opportunity.confidence ?? null,
      confidencePct: opportunity.confidence == null ? null : Math.round(Number(opportunity.confidence) * 100)
    },
    evidence: list(opportunity.evidence),
    caveats: list(opportunity.caveats)
  };
}
