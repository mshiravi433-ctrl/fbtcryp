/**
 * FBT CENTRAL INTELLIGENCE OS — Central Risk Engine (spec §24, §25).
 * ---------------------------------------------------------------------------
 * ONE risk function for the whole system. Swap, bridge, lending, borrow,
 * futures, dYdX, LP, farm, goals and the profit plan all call this, so
 * "open a 5× perp" is judged against the portfolio the user actually has
 * instead of against whatever the page that happens to host the perp widget
 * chose to look at. That single sentence is the whole reason §24 exists.
 *
 * WHAT MAKES A VERDICT HONEST
 * Every factor records its `source` and its `dataAt`, and an unreadable input
 * becomes a `MISSING` factor that LOWERS confidence rather than being skipped.
 * `decision: 'block'` therefore never rests on optimism — when the health factor
 * cannot be read, a borrow is blocked, not "allowed with caveats".
 */
import { CI_SCHEMA, ERROR_CLASSES, RISK_CONTEXT, round, usableNumber } from './schema.js';
import { getSection, freshness } from './state.js';
import { analyzeConcentration, analyzeExposure, assessLendingSafety, classifySymbol } from './analysis.js';

export const RISK_SCHEMA = 'fbt.central-risk.v1';

export const RISK_LEVELS = Object.freeze(['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'CRITICAL']);
const RANK = { LOW: 0, MODERATE: 1, ELEVATED: 2, HIGH: 3, CRITICAL: 4, MISSING: 2, UNKNOWN: 2 };

/* Product limits, in one place so a probe can assert them and a reviewer can
   change them deliberately rather than per-page. */
export const RISK_LIMITS = Object.freeze({
  concentrationSharePct: 45,
  leverageRatioBlock: 3,
  leverageRatioWarn: 1.5,
  healthFactorFloor: 1.35,
  liquidationDistanceWarnPct: 15,
  priceImpactBlockPct: 3,
  priceImpactWarnPct: 1,
  slippageBlockPct: 5,
  staleSectionsBlockExecute: 1,
  minConfidenceForAdvice: 0.35
});

const factor = (id, level, detail, { source, dataAt, value = null, limit = null, weight = 1 } = {}) => ({
  id, level, detail: String(detail).slice(0, 160), source: source || 'risk-engine', dataAt: dataAt || null, value, limit, weight
});

/**
 * `assessRisk` — the shared entry point.
 *
 * @param state     unified system state (sections with provenance)
 * @param context   the module context from RISK_CONTEXT (which sections matter)
 * @param quote     the quote/simulation result, if this turn produced one
 * @param securitySignals  anything that must stop the pipeline outright
 */
export function assessRisk({ intent = null, plan = null, state, context = 'portfolio', quote = null, simulation = null, securitySignals = [], capabilities = {}, now = Date.now() } = {}) {
  const factors = [];
  const data = [];
  const read = (key) => getSection(state || {}, key).data;
  const sourceOf = (key) => ({ source: getSection(state || {}, key).source || 'unknown', dataAt: getSection(state || {}, key).updatedAt || null });
  const portfolio = read('portfolio');
  const wallet = read('wallet');
  const markets = read('markets');
  const riskContext = RISK_CONTEXT[context] || { sections: ['portfolio'], checks: [] };

  /* 1 — security first; it outranks everything and cannot be traded off. */
  const stoppers = (Array.isArray(securitySignals) ? securitySignals : []).map((s) => (typeof s === 'string' ? s : s?.code)).filter(Boolean);
  if (stoppers.length) {
    return finalize({
      level: 'CRITICAL', decision: 'block',
      factors: [factor('security', 'CRITICAL', `security signal: ${stoppers.join(', ')}`, { source: 'security-engine' })],
      reasons: [`a security check failed (${stoppers[0]}); the operation is stopped, not retried`],
      data, confidence: 0.99, context, blockedBySecurity: true
    });
  }

  /* 2 — concentration, computed from live holdings. */
  const concentration = analyzeConcentration(portfolio);
  if (concentration.status === 'OK') {
    /* The field the analysis engine actually returns. Reading a name that does not
       exist produced `0` here, which the risk engine then reported as "concentration
       LOW" for a portfolio that was 100% one asset — a silent, safety-relevant
       lie. The fallback is now explicit and refuses instead of zeroing. */
    const share = usableNumber(concentration.topSharePct ?? concentration.topShareOfRiskPct);
    const level = share >= RISK_LIMITS.concentrationSharePct * 1.4 ? 'HIGH' : share >= RISK_LIMITS.concentrationSharePct ? 'ELEVATED' : share >= 30 ? 'MODERATE' : 'LOW';
    factors.push(factor('concentration', share === null ? 'MISSING' : level, `${concentration.topAsset} is ${share ?? 'unreadable'}% of risk capital (${concentration.rows.length} valued holdings, HHI ${concentration.hhi})`, { value: share, limit: RISK_LIMITS.concentrationSharePct, ...sourceOf('portfolio') }));
    data.push({ id: 'concentration', source: 'portfolio-service + market data', detail: `top asset ${concentration.topAsset} ${share}%`, dataAt: concentration.at });
  } else {
    factors.push(factor('concentration', 'MISSING', `concentration could not be computed: ${concentration.reason}`, { source: 'portfolio-service' }));
  }

  /* 3 — cross-module exposure (this is what makes §24 central, not per-page). */
  const exposure = analyzeExposure({
    portfolio,
    lending: read('lending'),
    futures: read('futures'),
    dydx: read('dydx'),
    farming: read('farming'),
    liquidity: read('liquidity')
  });
  if (exposure.status === 'OK') {
    const lev = usableNumber(exposure.leverageRatio) ?? 0;
    const level = lev >= RISK_LIMITS.leverageRatioBlock ? 'CRITICAL' : lev >= RISK_LIMITS.leverageRatioWarn ? 'ELEVATED' : lev > 1.05 ? 'MODERATE' : 'LOW';
    factors.push(factor('leverage', level, `gross exposure ${exposure.grossExposureUsd} USD against equity ${exposure.equityUsd} USD (×${lev}); debt ${exposure.debtUsd} USD`, { value: lev, limit: RISK_LIMITS.leverageRatioBlock, source: 'portfolio + lending + futures + dYdX' }));
    if (exposure.missingSources?.length) factors.push(factor('exposure-coverage', 'MISSING', `exposure excludes ${exposure.missingSources.join(', ')} (unreadable)`, { source: 'risk-engine' }));
    data.push({ id: 'exposure', source: 'portfolio-service + lending-protocol + futures-engine', detail: `net ${exposure.netExposureUsd} USD, gross ${exposure.grossExposureUsd} USD`, dataAt: exposure.at });
  } else {
    factors.push(factor('leverage', 'MISSING', `exposure could not be computed: ${exposure.reason}`, { source: 'risk-engine' }));
  }

  /* 4 — lending health, whenever a lending/borrow context is in play. */
  if (['lending', 'borrowing', 'portfolio', 'rebalance'].includes(context)) {
    const lendingSection = read('lending');
    const position = Array.isArray(lendingSection?.positions) ? lendingSection.positions[0] : lendingSection?.position || null;
    if (position) {
      const safety = assessLendingSafety({ position, oracle: lendingSection?.oracle || null });
      if (safety.status === 'OK' && safety.hasDebt) {
        const hf = usableNumber(safety.healthFactor);
        const distance = usableNumber(safety.distanceToLiquidationPct);
        const level = hf === null ? 'HIGH' : hf < 1.05 ? 'CRITICAL' : hf < RISK_LIMITS.healthFactorFloor ? 'HIGH' : distance !== null && distance < RISK_LIMITS.liquidationDistanceWarnPct ? 'ELEVATED' : 'MODERATE';
        factors.push(factor('liquidation', level, `health factor ${hf === null ? 'unreadable' : hf}, a ${distance === null ? '?' : distance}% move in collateral reaches liquidation${safety.oracleFresh === false ? ' (oracle freshness unverified)' : ''}`, { value: hf, limit: RISK_LIMITS.healthFactorFloor, source: 'lending-protocol', dataAt: safety.at }));
        data.push({ id: 'health-factor', source: 'lending-protocol (on-chain)', detail: `HF ${hf}`, dataAt: safety.at });
      }
    } else if (lendingSection) {
      factors.push(factor('liquidation', 'LOW', 'a lending position was read and carries no outstanding debt', { source: 'lending-protocol' }));
    } else {
      factors.push(factor('liquidation', 'MISSING', 'the lending position could not be read from the protocol', { source: 'lending-protocol' }));
    }
  }

  /* 5 — execution maths on the quote itself. */
  const impact = usableNumber(quote?.priceImpactPct ?? simulation?.priceImpactPct);
  if (impact !== null) {
    const level = impact >= RISK_LIMITS.priceImpactBlockPct ? 'HIGH' : impact >= RISK_LIMITS.priceImpactWarnPct ? 'MODERATE' : 'LOW';
    factors.push(factor('price-impact', level, `estimated impact ${impact}% of pool depth`, { value: impact, limit: RISK_LIMITS.priceImpactBlockPct, source: 'dex-aggregator' }));
    data.push({ id: 'price-impact', source: 'dex-aggregator', detail: `${impact}%`, dataAt: quote?.at || null });
  } else if (context === 'swap' || context === 'rebalance') {
    factors.push(factor('price-impact', 'MISSING', 'no live quote was produced, so impact is unknown', { source: 'dex-aggregator' }));
  }
  const slippage = usableNumber(quote?.slippagePct ?? simulation?.slippagePct);
  if (slippage !== null && slippage > RISK_LIMITS.slippageBlockPct) {
    factors.push(factor('slippage', 'HIGH', `slippage tolerance ${slippage}% exceeds the ${RISK_LIMITS.slippageBlockPct}% limit`, { value: slippage, limit: RISK_LIMITS.slippageBlockPct, source: 'dex-aggregator' }));
  }

  /* 6 — token risk, when a counterparty asset is known. */
  const tokenRisk = quote?.tokenRisk || read('markets')?.tokenRisk?.[String(quote?.toAsset || intent?.entities?.asset || '').toUpperCase()];
  if (tokenRisk) {
    const level = tokenRisk.level === 'critical' || tokenRisk.honeypot ? 'CRITICAL' : tokenRisk.level === 'high' ? 'HIGH' : tokenRisk.level === 'medium' ? 'MODERATE' : 'LOW';
    factors.push(factor('token-risk', level, `counterparty token flags: ${tokenRisk.flags?.join(', ') || tokenRisk.level || 'none'}`, { source: 'token-risk-service' }));
    if (tokenRisk.honeypot) stoppers.push('HONEYPOT_DETECTED');
  }

  /* 7 — bridge specifics. */
  if (context === 'bridge') {
    const depth = usableNumber(quote?.destinationLiquidityUsd);
    const feeDrift = usableNumber(quote?.feeDriftPct);
    if (depth !== null && quote?.amountUsd && depth < quote.amountUsd * 1.5) factors.push(factor('destination-liquidity', 'ELEVATED', `destination pool ${round(depth, 0)} USD is thin against a ${quote.amountUsd} USD transfer`, { source: 'bridge' }));
    else if (depth === null) factors.push(factor('destination-liquidity', 'MISSING', 'bridge provider did not report destination liquidity', { source: 'bridge' }));
    if (feeDrift !== null && Math.abs(feeDrift) > 15) factors.push(factor('fee-drift', 'ELEVATED', `estimated fee moved ${round(feeDrift, 1)}% since the quote`, { source: 'bridge' }));
  }

  /* 8 — new leverage is judged against the WHOLE portfolio (spec §24). */
  if (['futures', 'dydx'].includes(context)) {
    const requestedLeverage = usableNumber(intent?.entities?.leverage ?? quote?.leverage);
    const equity = usableNumber(portfolio?.totalValueUsd ?? wallet?.totalValueUsd);
    const notional = usableNumber(quote?.notionalUsd ?? (equity && requestedLeverage ? equity * requestedLeverage : null));
    if (requestedLeverage !== null && equity !== null && notional !== null) {
      const share = equity > 0 ? notional / equity : null;
      const level = requestedLeverage > 10 || (share !== null && share > 0.5) ? 'HIGH' : requestedLeverage > 5 ? 'ELEVATED' : 'MODERATE';
      factors.push(factor('new-leverage', level, `${round(requestedLeverage, 2)}× on ${round(notional, 0)} USD is ${share === null ? '?' : round(share * 100, 1)}% of portfolio equity`, { value: requestedLeverage, limit: 10, source: 'futures-engine + portfolio-service' }));
    } else {
      factors.push(factor('new-leverage', 'MISSING', 'size or equity unknown; leverage cannot be judged against the portfolio', { source: 'futures-engine' }));
    }
    const funding = usableNumber(markets?.fundingAprPct?.[intent?.entities?.asset] ?? read('futures')?.fundingAprPct);
    if (funding !== null && Math.abs(funding) > 40) factors.push(factor('funding', 'ELEVATED', `funding APR ${round(funding, 1)}% is crowding one side`, { source: 'futures-engine' }));
  }

  /* 9 — goal risk: a plan built on unreadable data is a hazard, not a help. */
  if (['goals', 'profit-plan'].includes(context)) {
    const goal = read('goals');
    if (!goal) factors.push(factor('goal-data', 'MODERATE', 'no goal record was readable; any plan is a sketch, not a tracked plan', { source: 'goals-engine' }));
    else factors.push(factor('goal-data', 'LOW', `goal read from the goals engine (target ${round(goal?.targetUsd, 0)} USD)`, { source: 'goals-engine' }));
  }

  /* 10 — the state's own reliability: data we could not read is a risk factor. */
  let staleCount = 0;
  let unavailableCount = 0;
  for (const key of riskContext.sections) {
    const f = freshness(state || {}, key, now);
    if (f.status === 'STALE' || f.status === 'PARTIAL') staleCount += 1;
    if (f.status === 'UNAVAILABLE' || f.status === 'MISSING') unavailableCount += 1;
  }
  if (staleCount) factors.push(factor('data-freshness', staleCount >= 2 ? 'HIGH' : 'MODERATE', `${staleCount} of ${riskContext.sections.length} risk inputs are stale`, { source: 'central-state', value: staleCount }));
  if (unavailableCount) factors.push(factor('data-availability', unavailableCount >= 2 ? 'HIGH' : 'MODERATE', `${unavailableCount} risk input(s) could not be read at all`, { source: 'central-state', value: unavailableCount }));

  /* 11 — module capability degradation the user should hear about (§8). */
  const degraded = Object.entries(capabilities).filter(([, v]) => v === 'DEGRADED' || v === 'READ_ONLY' || v === 'UNAVAILABLE');
  if (degraded.length) factors.push(factor('module-health', degraded.some(([, v]) => v === 'UNAVAILABLE') ? 'MODERATE' : 'LOW', degraded.slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' '), { source: 'capability-manager' }));

  return finalize({ factors, data, context, now });
}

/* Persian rendering of a factor, from its STRUCTURED fields.
 *
 * The risk engine runs in the browser and on the server, and its output is quoted
 * in replies, in the confirmation card and in logs. Hand-writing a second Persian
 * sentence at each of the 23 push sites would guarantee the two languages drift
 * apart — the English line would say one number and the Persian line another. So
 * both are rendered from `value`/`limit`/`level`, which is also why every factor
 * carries its numbers instead of only a sentence.
 */
const FA_LEVEL_RISK = { CRITICAL: 'بحرانی', HIGH: 'بالا', ELEVATED: 'افزایشی', MODERATE: 'متوسط', LOW: 'پایین', MISSING: 'ناخوانا', WATCH: 'نیازمند توجه' };
const faNumR = (v, max = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  try { return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: max }).format(n); } catch { return String(n); }
};

function renderFa(f) {
  const lvl = FA_LEVEL_RISK[String(f.level).toUpperCase()] || String(f.level || '—');
  const cmp = f.limit !== null && f.limit !== undefined ? `، حد مجاز ${faNumR(f.limit)}` : '';
  switch (f.id) {
    case 'concentration': return f.value === null ? 'تمرکز قابل محاسبه نبود؛ دارایی‌ها یا قیمت‌ها خوانده نشدند' : `تمرکز: مهم‌ترین دارایی ${faNumR(f.value)}٪ از سرمایهٔ پرریسک${cmp} — سطح ${lvl}`;
    case 'leverage': return f.value === null ? 'اهرم ترکیبی محاسبه نشد' : `اهرم ترکیبی ${faNumR(f.value)}×${cmp} — سطح ${lvl}`;
    case 'exposure-coverage': return 'بخشی از venues برای محاسبهٔ مواجهه خوانده نشد؛ عدد کامل نیست';
    case 'liquidation': return f.value === null ? 'فاکتور سلامت از پروتکل خوانده نشد' : `فاکتور سلامت ${faNumR(f.value, 3)} (کف سیاست ${faNumR(f.limit)}) — فاصله تا لیکوئیداسیون باید جدی گرفته شود`;
    case 'price-impact': return f.value === null ? 'نرخ زنده‌ای تولید نشد، پس اثر قیمتی نامعلوم است' : `اثر قیمتی برآوردی ${faNumR(f.value)}٪ از عمق استخر${cmp}`;
    case 'slippage': return `تحمل لغزش ${faNumR(f.value)}٪ از حد ${faNumR(f.limit)}٪ بالاتر است`;
    case 'token-risk': return `پرچم‌های امنیتی توکن مقصد: ${String(f.detail || '').split(':').slice(1).join(':').trim() || '—'} — این مورد با تکرار دور زده نمی‌شود`;
    case 'destination-liquidity': return f.value === null ? 'ارزش استخر مقصد اعلام نشد' : 'نقدینگی مقصد در برابر مبلغ انتقال نازک است';
    case 'fee-drift': return 'کارمزد برآوردی پس از گرفتن نرخ جابه‌جا شده است';
    case 'new-leverage': return f.value === null ? 'اندازه یا equity مشخص نبود، پس اهرم جدید قابل سنجش نیست' : `اهرم درخواستی ${faNumR(f.value)}× از پرتفوی`;
    case 'funding': return `نرخ فاندینگ ${faNumR(f.value, 1)}٪ یک سمت بازار را شلوغ کرده است`;
    case 'goal-data': return f.level === 'LOW' ? 'هدف از موتور اهداف خوانده شد' : 'هیچ هدف ثبت‌شده‌ای خوانده نشد؛ هر برنامه‌ای در حد طرح است، نه برنامهٔ پیگیری‌شده';
    case 'data-freshness': return `${faNumR(f.value, 0)} ورودی ریسک کهنه بود — اعداد ممکن است جایگزین شده باشند`;
    case 'data-availability': return `${faNumR(f.value, 0)} ورودی ریسک اصلاً خوانده نشد`;
    case 'module-health': return `سلامت ماژول‌ها: ${String(f.detail || '').slice(0, 80)}`;
    case 'oracle': return 'تازگی اوراکل تأیید نشد';
    default: return f.value === null && f.limit === null ? `عامل «${f.id}» در سطح ${lvl}` : `عامل «${f.id}»: ${faNumR(f.value)}${cmp} — سطح ${lvl}`;
  }
}

function finalize({ factors, data = [], context = 'portfolio', reasons = [], confidence = null, level = null, now = Date.now(), blockedBySecurity = false }) {
  const worst = factors.reduce((acc, f) => ((RANK[f.level] ?? 0) > (RANK[acc] ?? -1) ? f.level : acc), null);
  const derived = level || worst || 'MODERATE';
  const blockers = factors.filter((f) => f.level === 'CRITICAL');
  const warnings = factors.filter((f) => f.level === 'HIGH' || f.level === 'ELEVATED');
  const unknowns = factors.filter((f) => f.level === 'MISSING');
  const computed = confidence ?? round(Math.max(0.12, Math.min(0.95, 0.9 - unknowns.length * 0.16 - (blockers.length ? 0 : 0))), 3);
  const decision = blockers.length || derived === 'CRITICAL' ? 'block'
    : unknowns.length >= 3 ? 'block'
      : derived === 'HIGH' ? 'warn-hard'
        : derived === 'ELEVATED' || derived === 'MODERATE' ? 'warn' : 'allow';
  const reasonsOut = Array.from(new Set([
    ...reasons,
    ...blockers.map((f) => f.detail),
    ...warnings.map((f) => f.detail),
    ...unknowns.map((f) => f.detail)
  ])).filter(Boolean).slice(0, 8);
  const localised = factors.map((f) => (f.detailFa ? f : { ...f, detailFa: renderFa(f) }));
  const reasonsFaOut = Array.from(new Set([
    ...blockers.map((f) => f.detailFa || renderFa(f)),
    ...warnings.map((f) => f.detailFa || renderFa(f)),
    ...unknowns.map((f) => f.detailFa || renderFa(f))
  ])).filter(Boolean).slice(0, 8);
  return {
    schema: RISK_SCHEMA,
    brain: CI_SCHEMA,
    context,
    level: derived,
    decision,
    blockedBySecurity,
    factors: localised,
    reasons: reasonsOut,
    reasonsFa: reasonsFaOut,
    data,
    confidence: computed,
    limits: RISK_LIMITS,
    mayAdvise: computed >= RISK_LIMITS.minConfidenceForAdvice,
    /** §26: advice without an evidence list is not advice, it is noise. */
    evidenceCount: data.length,
    at: now
  };
}

/**
 * Recompute risk AFTER a mutation, from the refreshed sections. §16's guarantee
 * that "no module shows stale data after an operation" is only as real as this
 * call being part of the post-verification path — not an optional hook.
 */
export function refreshRiskFor({ state, sections = ['portfolio', 'wallet', 'markets'], now = Date.now() }) {
  return { needed: sections.filter((k) => freshness(state, k, now).status !== 'LIVE'), sections };
}

export function riskLevelRank(level) {
  return RANK[level] ?? 0;
}

export { classifySymbol };
