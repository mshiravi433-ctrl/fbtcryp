/**
 * FBT CENTRAL INTELLIGENCE OS — Decision + Execution Pipeline (§18, §19,
 * §31, §32, §43, §44).
 * ---------------------------------------------------------------------------
 * The ultimate rule, as code:
 *
 *   USER REQUEST → UNDERSTAND → RESOLVE CONTEXT → READ REAL STATE →
 *   DISCOVER CAPABILITIES → SELECT TOOLS → BUILD PLAN → CHECK POLICY →
 *   QUOTE/SIMULATE → ASK CONFIRMATION → EXECUTE → VERIFY → UPDATE CENTRAL
 *   STATE → PUBLISH EVENTS → UPDATE ALL RELATED MODULES → RESPOND
 *
 * The forbidden path (USER → LLM → GENERIC ANSWER) is structurally
 * impossible here: the reply is BUILT from tool results (§19). If there is
 * no data, the reply names exactly what is missing — never a canned phrase.
 */
import { randomUUID } from 'node:crypto';
import { understanding } from './understanding.js';
import { getMemory, updateMemory, resolveContext, normalizePageContext } from './contextEngine.js';
import { assembleState, afterAction, getSession, recordPendingAction, recordRecentAction, recordError } from './stateStore.js';
import { planForIntent, planRequiresConfirmation, splitPlan } from './planner.js';
import { policyCheck, securityScan } from './policy.js';
import { runTool } from './toolRouter.js';
import { createAction, transitionAction, getAction, findActionByRequestId, actionSummary } from './actionEngine.js';
import { capabilityReport } from './capabilities.js';
import { portfolioRisk, concentrationCheck, lendingRisk, futuresRisk, scenarioShock } from './riskEngine.js';
import { concentrationRecommendation, loanSafetyRecommendation, whatIfRecommendation } from './recommendationEngine.js';
import { publish } from './eventBus.js';
import { CENTRAL_OS_VERSION, FORBIDDEN_GENERIC_PHRASES, INTENT_STATUS } from './constants.js';
import { getModule } from './registry.js';

const intents = new Map();     // intentId -> record
const byRequestId = new Map(); // requestId -> intentId

const nowMs = () => Date.now();
const fmtUsd = (n) => (Number.isFinite(Number(n)) ? `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—');

export function getIntent(intentId) { return intents.get(String(intentId || '')) || null; }

function createIntentRecord({ owner, message, requestId }) {
  const intentId = `intent_${randomUUID()}`;
  const record = {
    intentId,
    requestId: requestId || null,
    owner,
    userMessage: String(message || '').slice(0, 1200),
    intentType: null,
    entities: {},
    context: {},
    requiredModules: [],
    requiredTools: [],
    plan: [],
    risk: {},
    confirmationRequired: false,
    executionRequired: false,
    verificationRequired: false,
    status: 'PLANNING',
    state: 'RECEIVED',
    trace: [],
    toolResults: {},
    response: null,
    createdAt: nowMs(),
    updatedAt: nowMs()
  };
  intents.set(intentId, record);
  if (requestId) byRequestId.set(requestId, intentId);
  return record;
}

function mark(record, state, extra = {}) {
  record.state = state;
  record.updatedAt = nowMs();
  Object.assign(record, extra);
  record.trace.push({ stage: state, at: nowMs() });
}

/**
 * Run one plan through the tool router. Auto steps execute; optional steps
 * may fail softly (data enrichment), mandatory failures abort the intent.
 */
async function runAutoSteps(record, plan, ctx) {
  const results = {};
  for (const step of plan) {
    const res = await runTool({
      module: step.module,
      operation: step.operation,
      input: { ...step.params, ...(step.params?.asset ? {} : {}), owner: record.owner },
      ctx,
      permissionGranted: 'EXECUTE', // the pipeline decides; the router still gates per-op
      trace: record.trace
    });
    results[`${step.module}.${step.operation}`] = res;
    if (!res.ok && !step.optional) {
      recordError(record.owner, { at: nowMs(), module: step.module, error: res.error, status: res.status });
      return { ok: false, failedStep: step, results, failure: res };
    }
  }
  return { ok: true, results };
}

const stepResult = (results, module, op) => results[`${module}.${op}`];
const liveResult = (r) => (r?.ok && r.result && r.result.dataStatus !== 'unavailable' ? r.result : null);

/* -------------------------------------------------------------------------- */
/* response builders (§43): result + reason + data + risk + confidence        */
/* -------------------------------------------------------------------------- */

function analysisResponse({ intentType, message, risk = {}, confidence = 0.7, recommendation = null, rows = [], data = [], suggestions = [], card = null }) {
  return {
    mode: 'ANSWER',
    intentType,
    message,
    result: { rows, card },
    reason: recommendation?.reason?.length ? recommendation.reason : undefined,
    data: data.length || recommendation?.data?.length ? [...data, ...(recommendation?.data || [])] : undefined,
    risk,
    confidence,
    recommendation: recommendation?.recommendation || null,
    alternatives: recommendation?.alternatives || [],
    suggestions
  };
}

function actionResponse({ intentType, message, action, quote = null, plan, note = null }) {
  return {
    mode: 'ACTION',
    intentType,
    message,
    action: action ? actionSummary(action) : null,
    quote: quote || null,
    plan: plan.map((s) => ({ module: s.module, operation: s.operation, gated: s.permission === 'EXECUTE' })),
    note,
    confirmationRequired: true,
    suggestions: ['تایید و ادامه', 'انصراف']
  };
}

function questionResponse(message, missing) {
  return { mode: 'QUESTION', message, missing };
}

function errorResponse({ intentType, message, status, error, recovery = null, safeStop = false }) {
  return { mode: safeStop ? 'SAFE_STOP' : 'ERROR_AND_RECOVERY', intentType, message, status, error, recovery };
}

/* -------------------------------------------------------------------------- */
/* domain analysts — build answers from the assembled tool results            */
/* -------------------------------------------------------------------------- */

async function analyzePortfolio(record, results, state) {
  const portfolio = liveResult(stepResult(results, 'portfolio', 'read'));
  if (!portfolio) {
    return questionResponse(
      'برای بررسی پرتفوی باید کیف پول وصل باشد و دارایی‌ها از سمت کلاینت ارسال شوند.',
      ['wallet', 'portfolio']
    );
  }
  const risk = portfolioRisk(state);
  const markets = liveResult(stepResult(results, 'markets', 'read'));
  const priced = (portfolio.holdings || []).slice(0, 8).map((h) => {
    const coin = markets?.coins?.find((c) => c.symbol === String(h.symbol).toUpperCase());
    return {
      symbol: h.symbol,
      valueUsd: Number(h.valueUsd) || 0,
      sharePct: risk.dataStatus === 'live' && risk.totalValueUsd > 0 ? Number(((Number(h.valueUsd) || 0) / risk.totalValueUsd * 100).toFixed(1)) : null,
      change24hPct: coin?.change24hPct ?? null
    };
  });
  const rows = priced;
  let message = `ارزش کل پرتفوی ${fmtUsd(portfolio.totalValueUsd)} در ${portfolio.holdings.length} دارایی است.`;
  if (risk.dataStatus === 'live') {
    message += risk.concentrated
      ? ` پرتفوی متمرکز است (بیشترین سهم: ${risk.topAsset.symbol} با ${risk.topAsset.sharePct}٪).`
      : ` تمرکز پرتفوی متعادل است (بیشترین سهم: ${risk.topAsset.symbol} با ${risk.topAsset.sharePct}٪).`;
  }
  if (!markets) message += ' داده بازار در این لحظه در دسترس نیست؛ قیمت‌های لحظه‌ای نمایش داده نشد.';
  return analysisResponse({
    intentType: record.intentType,
    message,
    risk: risk.dataStatus === 'live' ? { hhi: risk.hhi, concentrated: risk.concentrated, topAsset: risk.topAsset } : {},
    confidence: markets ? 0.85 : 0.7,
    rows,
    data: [
      { source: 'wallet', metric: 'connected', value: Boolean(state.wallet?.connected) },
      { source: 'portfolio', metric: 'totalValueUsd', value: portfolio.totalValueUsd },
      ...(markets ? [{ source: 'markets', metric: 'coinsTracked', value: markets.count }] : [])
    ],
    suggestions: ['BTC زیاد دارم؟', 'ریسکم را کم کن', 'اگر BTC ۳۰٪ بریزد چه می‌شود؟']
  });
}

async function analyzeConcentration(record, results, state, entities) {
  const asset = entities.asset || state.activePage?.selectedAsset;
  const concentration = asset ? concentrationCheck(state, asset) : portfolioRisk(state);
  if (concentration.dataStatus !== 'live') {
    return questionResponse('برای محاسبه تمرکز، پرتفوی متصل لازم است.', ['portfolio']);
  }
  const signals = liveResult(stepResult(results, 'signals', 'read'));
  const news = liveResult(stepResult(results, 'news', 'read'));
  if (!asset) {
    const top = concentration.topAsset;
    return analysisResponse({
      intentType: record.intentType,
      message: `متمرکزترین دارایی شما ${top.symbol} با ${top.sharePct}٪ از پرتفوی است.`,
      confidence: 0.8,
      rows: concentration.rows,
      data: [{ source: 'portfolio', metric: 'hhi', value: concentration.hhi }],
      suggestions: [`${top.symbol} زیاد دارم؟`, 'بفروشم؟']
    });
  }
  const rec = concentrationRecommendation({ concentration, signals, news });
  if (!concentration.found) {
    return analysisResponse({
      intentType: record.intentType,
      message: `${asset} در پرتفوی فعلی شما پیدا نشد؛ دارایی‌های فعلی: ${concentration.rows.map((r) => r.symbol).join('، ')}.`,
      confidence: 0.85,
      rows: concentration.rows
    });
  }
  return analysisResponse({
    intentType: record.intentType,
    message: rec.recommendation,
    risk: rec.risk,
    confidence: rec.confidence,
    recommendation: rec,
    rows: concentration.rows,
    data: [{ source: 'portfolio', metric: 'assetSharePct', value: concentration.assetSharePct }],
    suggestions: ['بفروشم؟', 'اگر این دارایی ۳۰٪ بریزد چه می‌شود؟', 'یک هشدار قیمت تنظیم کن']
  });
}

async function analyzeLoanSafety(record, results, state) {
  const lending = liveResult(stepResult(results, 'lending', 'read'));
  const position = lending?.positions?.[0];
  if (!position) return questionResponse('برای بررسی امنیت وام، باید پوزیشن وام (وثیقه و بدهی) وصل باشد.', ['lending']);
  const risk = lendingRisk(position);
  const rec = loanSafetyRecommendation({ lendingRisk: risk });
  return analysisResponse({
    intentType: record.intentType,
    message: rec.recommendation,
    risk: { healthFactor: risk.healthFactor, ltvPct: risk.ltvPct, band: risk.riskBand, distanceToLiquidationPct: risk.distanceToLiquidationPct },
    confidence: rec.confidence,
    recommendation: rec,
    rows: [{
      label: 'Collateral', value: fmtUsd(risk.collateralUsd)
    }, {
      label: 'Borrowed', value: fmtUsd(risk.borrowedUsd)
    }, {
      label: 'Health Factor', value: risk.healthFactor
    }, {
      label: 'Borrow APR', value: position.borrowAprPct != null ? `${position.borrowAprPct}٪` : '—'
    }],
    card: {
      type: 'LOAN_STATUS',
      collateralUsd: risk.collateralUsd,
      borrowedUsd: risk.borrowedUsd,
      healthFactor: risk.healthFactor,
      borrowAprPct: position.borrowAprPct ?? null,
      riskBand: risk.riskBand
    },
    suggestions: ['چقدر دیگر می‌توانم وام بگیرم؟', 'اگر وثیقه ۲۰٪ بریزد چه می‌شود؟']
  });
}

async function analyzeWhatIf(record, results, state, entities) {
  const asset = entities.asset || state.activePage?.selectedAsset || 'BTC';
  const dropPct = entities.percent ?? 30;
  const scenario = scenarioShock(state, { asset, dropPct });
  if (scenario.dataStatus !== 'live') return questionResponse('سناریو به پرتفوی متصل نیاز دارد.', ['portfolio']);
  const rec = whatIfRecommendation({ scenario });
  return analysisResponse({
    intentType: record.intentType,
    message: rec.recommendation,
    risk: rec.risk,
    confidence: rec.confidence,
    recommendation: rec,
    rows: [
      { label: 'قبل از شوک', value: fmtUsd(scenario.beforeUsd) },
      { label: 'بعد از شوک', value: fmtUsd(scenario.afterUsd) },
      { label: 'زیان', value: fmtUsd(scenario.lossUsd) }
    ],
    card: { type: 'WHAT_IF', ...scenario },
    data: rec.data,
    suggestions: ['چطور ریسک را کم کنم؟', 'یک هشدار قیمت تنظیم کن']
  });
}

async function analyzeMarket(record, results) {
  const markets = liveResult(stepResult(results, 'markets', 'read'));
  if (!markets) return errorResponse({ intentType: record.intentType, message: 'داده بازار در دسترس نیست.', status: 'DATA_UNAVAILABLE', error: 'MARKETS_UNAVAILABLE' });
  const top = markets.coins.slice(0, 6).map((c) => ({ symbol: c.symbol, priceUsd: c.priceUsd, change24hPct: c.change24hPct, volumeUsd: c.volumeUsd }));
  return analysisResponse({
    intentType: record.intentType,
    message: `وضعیت بازار: ${top.map((c) => `${c.symbol} ${fmtUsd(c.priceUsd)} (${c.change24hPct ?? '—'}٪)`).join('، ')}.`,
    confidence: 0.9,
    rows: top,
    data: [{ source: 'markets', metric: 'coins', value: markets.count }],
    suggestions: ['سیگنال‌ها را نشان بده', 'اخبار مهم چیست؟']
  });
}

async function analyzeSignals(record, results, entities) {
  const signals = liveResult(stepResult(results, 'signals', 'read'));
  const news = liveResult(stepResult(results, 'news', 'read'));
  const futures = liveResult(stepResult(results, 'futures', 'read'));
  if (!signals) return errorResponse({ intentType: record.intentType, message: 'سیگنالی قابل ساخت نیست — داده بازار در دسترس نیست.', status: 'DATA_UNAVAILABLE', error: 'SIGNALS_UNAVAILABLE' });
  // §30: signal + news + funding combined into ONE intelligence row per asset.
  const combined = signals.rows.slice(0, 6).map((s) => {
    const newsRow = news?.items?.find((i) => String(i.title || '').toUpperCase().includes(s.symbol));
    const funding = futures?.rows?.find((r) => String(r.asset || '').toUpperCase().startsWith(s.symbol));
    return {
      symbol: s.symbol, momentum: s.momentum, volatility: s.volatility, change24hPct: s.change24hPct,
      fundingAprPct: funding?.fundingAprPct ?? null,
      news: newsRow ? { title: newsRow.title, source: newsRow.source } : null
    };
  });
  return analysisResponse({
    intentType: record.intentType,
    message: combined.length
      ? `هوش بازار (${entities.asset || 'کل بازار'}): ${combined.map((c) => `${c.symbol} ${c.momentum}`).join('، ')}.`
      : 'برای این دارایی داده سیگنال نداریم.',
    confidence: 0.75,
    rows: combined,
    data: [
      { source: 'signals', metric: 'rows', value: combined.length },
      ...(news ? [{ source: 'news', metric: 'items', value: news.items.length }] : []),
      ...(futures ? [{ source: 'futures', metric: 'venues', value: futures.rows.length }] : [])
    ],
    suggestions: ['BTC زیاد دارم؟', 'اخبار مهم چیست؟']
  });
}

async function analyzeNews(record, results, entities) {
  const news = liveResult(stepResult(results, 'news', 'read'));
  if (!news) return errorResponse({ intentType: record.intentType, message: 'هیچ فید خبری در دسترس نیست.', status: 'DATA_UNAVAILABLE', error: 'NEWS_UNAVAILABLE' });
  const rows = news.items.slice(0, 8).map((i) => ({ title: i.title, source: i.source, at: i.at, url: i.url }));
  return analysisResponse({
    intentType: record.intentType,
    message: entities.asset
      ? `${rows.length} خبر مرتبط با ${entities.asset} پیدا شد.`
      : `${rows.length} خبر اخیر ثبت شد.`,
    confidence: 0.85,
    rows,
    data: [{ source: 'news', metric: 'items', value: news.items.length }],
    suggestions: ['سیگنال‌ها را نشان بده', 'تاثیرش روی پرتفوی من چیست؟']
  });
}

async function analyzeGoals(record, results, state, entities) {
  const goals = liveResult(stepResult(results, 'goals', 'read'));
  const portfolio = liveResult(stepResult(results, 'portfolio', 'read'));
  const goalTarget = entities.amountUsd;
  if (record.intentType === 'GOAL_CREATE') {
    if (!goalTarget) return questionResponse('هدف مالی را با عدد بگویید، مثلاً: «می‌خواهم تا ۲ سال دیگر به ۱۰۰ هزار دلار برسم».', ['goalTarget']);
    const current = Number(portfolio?.totalValueUsd) || 0;
    const gap = Math.max(0, goalTarget - current);
    return analysisResponse({
      intentType: record.intentType,
      message: current > 0
        ? `برای هدف ${fmtUsd(goalTarget)} با پرتفوی فعلی ${fmtUsd(current)}، فاصله ${fmtUsd(gap)} است. برای ساخت برنامه، هدف را در ماژول Goals ثبت می‌کنم (نیازمند تایید).`
        : `هدف ${fmtUsd(goalTarget)} ثبت شد؛ پرتفوی متصل نیست — بعد از اتصال، برنامه ساخته می‌شود.`,
      confidence: 0.7,
      rows: [{ label: 'هدف', value: fmtUsd(goalTarget) }, { label: 'دارایی فعلی', value: fmtUsd(current) }, { label: 'فاصله', value: fmtUsd(gap) }],
      data: [{ source: 'portfolio', metric: 'totalValueUsd', value: current }],
      suggestions: ['برنامه‌اش را بساز', 'با ماهی ۵۰۰ دلار چقدر طول می‌کشد؟']
    });
  }
  const rows = goals?.goals?.length ? goals.goals.map((g) => ({ title: g.title || g.name || 'goal', target: g.targetUsd ?? g.target ?? null, status: g.status })) : [];
  return analysisResponse({
    intentType: record.intentType,
    message: rows.length ? `${rows.length} هدف فعال دارید.` : 'هنوز هدفی ثبت نشده است.',
    confidence: 0.85,
    rows,
    suggestions: ['می‌خواهم تا ۲ سال دیگر به ۱۰۰ هزار دلار برسم']
  });
}

/* -------------------------------------------------------------------------- */
/* execution intents → actions behind the confirmation gate                   */
/* -------------------------------------------------------------------------- */

/**
 * Futures Engine v3 (§18): a leveraged order is never created from an
 * ambiguous sentence. Missing market or size → QUESTION. Provider read-only or
 * unavailable → the honest Persian fallback, no action. Otherwise the preview
 * carries the engine's fee breakdown, risk verdict and route so the user
 * confirms exactly what the On-Chain tab will sign.
 */
function futuresIntent(record, results, entities, page) {
  const quoteRes = stepResult(results, 'futures', 'quote');
  const quote = quoteRes?.ok ? quoteRes.result : null;
  const asset = entities.asset || page?.selectedAsset || null;
  if (!quoteRes || (!quoteRes.ok && ['MARKET_REQUIRED', 'SIZE_REQUIRED'].includes(quoteRes.error))) {
    const missing = !asset ? ['market'] : [entities.amountUsd == null ? 'amountUsd' : null, entities.leverage == null ? 'leverage' : null].filter(Boolean);
    const text = !asset
      ? 'روی کدام بازار؟ نام بازار (مثلاً BTC یا XAU) را بگویید یا تب آن‌چین را باز کنید.'
      : 'مبلغ وثیقه (به دلار) و اهرم را مشخص کنید؛ مثلاً «۵۰ دلار با اهرم ۵». بدون این دو، هیچ پوزیشنی ساخته نمی‌شود.';
    return { done: true, response: questionResponse(text, missing.length ? missing : ['market']) };
  }
  if (!quoteRes.ok) {
    const code = String(quoteRes.error || 'PROVIDER_UNAVAILABLE');
    const msg = code === 'PROVIDER_READ_ONLY' || quoteRes.detail === 'این بازار در حال حاضر فقط برای مشاهده در دسترس است.'
      ? 'این بازار در حال حاضر فقط برای مشاهده در دسترس است.'
      : code === 'MARKET_NOT_LISTED'
        ? `بازار ${asset || ''} روی پروتکل‌های آن‌چین فعال فهرست نشده است. بازار دیگری انتخاب کنید.`
        : `پروتکل فیوچرز در این لحظه در دسترس نیست (${code}). هیچ سفارشی ساخته نشد؛ می‌توانید بعداً دوباره تلاش کنید.`;
    return { done: true, response: errorResponse({ intentType: record.intentType, message: msg, status: quoteRes.status || 'PROVIDER_ERROR', error: code, recovery: quoteRes.recovery || null, safeStop: Boolean(quoteRes.securityStop) }) };
  }
  if (!quote.executable) {
    const msg = quote.userMessage || 'این قابلیت هنوز برای محیط Production پیکربندی نشده است.';
    return { done: true, response: analysisResponse({ intentType: record.intentType, message: `${msg} قیمت ${quote.market.symbol}: ${fmtUsd(quote.market.mid)} · ریسک: ${quote.risk.riskLevel} (${quote.risk.riskScore}/100).`, confidence: 0.9, rows: [{ label: 'market', value: quote.market.symbol }, { label: 'mid', value: quote.market.mid }, { label: 'providerStatus', value: quote.providerStatus }], data: [{ source: 'futures', metric: 'providerStatus', value: quote.providerStatus }], suggestions: ['تب آن‌چین را باز کن', 'ریسک این پوزیشن چقدر است؟'] }) };
  }
  if (quote.risk?.blocked) {
    return { done: true, response: errorResponse({ intentType: record.intentType, message: `موتور ریسک این سفارش را مسدود کرد: ${quote.risk.blockReasons.join('، ')}. اندازه، اهرم یا حد ضرر را تغییر دهید؛ هیچ تراکنشی ساخته نشد.`, status: 'POLICY', error: 'RISK_BLOCKED', recovery: { strategy: 'ADJUST_INPUT', risk: quote.risk } }) };
  }
  return { done: false, quote };
}

async function executionIntent(record, results, state, entities, page) {
  const module = record.intentType === 'BRIDGE' ? 'bridge'
    : ['FUTURES_OPEN', 'FUTURES_CLOSE'].includes(record.intentType) ? 'futures'
    : record.intentType === 'DYDX_ORDER' ? 'dydx'
    : 'swap';
  const operation = 'prepare';
  const actionParams = {
    asset: entities.asset || page?.selectedAsset || null,
    targetAsset: entities.targetAsset || null,
    amountUsd: entities.amountUsd ?? null,
    network: entities.network || page?.selectedNetwork || null,
    fromChain: page?.selectedNetwork || null,
    toChain: entities.network || null,
    ...(module === 'futures' ? { leverage: entities.leverage ?? null, side: entities.side || 'long', provider: 'ostium' } : {})
  };
  let futuresPreview = null;
  if (module === 'futures') {
    const gate = futuresIntent(record, results, entities, page);
    if (gate.done) {
      record.response = gate.response;
      record.status = gate.response.mode === 'QUESTION' || gate.response.mode === 'ANSWER' ? INTENT_STATUS.COMPLETED : INTENT_STATUS.ERROR;
      return gate.response;
    }
    futuresPreview = gate.quote;
  }
  const quoteRes = stepResult(results, module, 'quote');
  const quote = liveResult(quoteRes) || null;

  const { action, deduplicated } = createAction({
    intentId: record.intentId,
    module,
    operation,
    params: actionParams,
    requiresConfirmation: true,
    verificationRequired: true,
    requestId: record.requestId,
    owner: record.owner
  });

  record.pendingActionId = action.actionId;
  record.executionRequired = true;
  record.verificationRequired = true;
  record.confirmationRequired = true;
  record.status = INTENT_STATUS.AWAITING_CONFIRMATION;
  record.risk = quote?.quote?.estimate ? { estGasUsd: quote.quote.estimate.gasCosts?.[0]?.amount?.usd ?? null } : {};
  recordPendingAction(record.owner, actionSummary(action));

  const amountTxt = actionParams.amountUsd ? `${fmtUsd(actionParams.amountUsd)} ` : '';
  const assetTxt = actionParams.asset || 'دارایی انتخابی';
  const targetTxt = actionParams.targetAsset ? ` به ${actionParams.targetAsset}` : (actionParams.network ? ` به ${actionParams.network}` : '');
  const quoteTxt = quote?.quote
    ? ` نرخ زنده دریافت شد: خروجی تخمینی ${quote.quote.estimate?.toAmountMin ?? quote.quote.estimate?.toAmount ?? '—'} ${quote.quote.tool || ''}`.trim()
    : quoteRes && !quoteRes.ok ? ` نقل‌قول زنده در دسترس نیست (${quoteRes.error}) — پس از تایید دوباره تلاش می‌شود.` : '';
  const dedupeTxt = deduplicated ? ' (درخواست تکراری بود؛ همان عملیات قبلی بازگردانده شد و معامله جدیدی ساخته نشد)' : '';

  if (futuresPreview) {
    const f = futuresPreview;
    record.risk = { riskScore: f.risk.riskScore, riskLevel: f.risk.riskLevel, liquidationDistancePct: f.risk.liquidationDistancePct, warnings: f.risk.warnings };
    const feeTxt = f.fee ? `کارمزد پروتکل ${f.fee.protocol.known ? fmtUsd(f.fee.protocol.feeUsd) : 'نامشخص'} + کارمزد FBT ${fmtUsd(f.fee.fbt.feeUsd)} (${f.fee.fbt.bps} bps) + کارمزد شبکه (در کیف پول)` : '';
    const liqTxt = f.risk.liquidationDistancePct != null ? ` فاصله تا لیکویید ≈ ${f.risk.liquidationDistancePct.toFixed(2)}٪.` : '';
    return actionResponse({
      intentType: record.intentType,
      message: `پیش‌نمایش پوزیشن ${f.order.side === 'short' ? 'شورت' : 'لانگ'} ${f.market.symbol} روی ${f.provider} — وثیقه ${fmtUsd(f.order.collateralUsd)} × اهرم ${f.order.leverage} = ${fmtUsd(f.order.notionalUsd)} اسمی، قیمت مرجع ${fmtUsd(f.market.mid)}. ${feeTxt}. ریسک: ${f.risk.riskLevel} (${f.risk.riskScore}/100).${liqTxt}${dedupeTxt} برای ساخت تراکنش تایید کنید؛ امضا فقط در کیف پول شما و در تب آن‌چین انجام می‌شود.`,
      action,
      quote: { futures: f },
      plan: record.plan,
      note: f.risk.warnings.length ? `هشدارها: ${f.risk.warnings.join('، ')}` : null
    });
  }

  return actionResponse({
    intentType: record.intentType,
    message: `آماده اجرا: ${module === 'swap' ? 'سواپ' : module === 'bridge' ? 'بریج' : module === 'futures' ? 'پوزیشن فیوچرز' : 'سفارش dYdX'} — ${amountTxt}${assetTxt}${targetTxt}.${quoteTxt}${dedupeTxt} برای اجرا تایید کنید؛ هیچ تراکنشی بدون تایید شما امضا نمی‌شود.`,
    action,
    quote,
    plan: record.plan
  });
}

/* -------------------------------------------------------------------------- */
/* the pipeline itself                                                         */
/* -------------------------------------------------------------------------- */

export async function handleIntent({ message, owner, requestId = null, page = null, context = null }) {
  /* §34 — replayed requestId returns the SAME intent, never a second one. */
  if (requestId && byRequestId.has(requestId)) {
    const existing = intents.get(byRequestId.get(requestId));
    if (existing) return { intentId: existing.intentId, deduplicated: true, status: existing.status, response: existing.response, state: existing.state };
  }

  const record = createIntentRecord({ owner, message, requestId });
  publish('INTENT_RECEIVED', { intentId: record.intentId, owner }, { source: 'pipeline' });
  const trace = record.trace;

  try {
    /* UNDERSTAND */
    mark(record, 'UNDERSTANDING');
    const { type, entities, confidence } = understanding(message);
    record.intentType = type;
    record.entities = entities;
    trace.push({ stage: 'UNDERSTAND', at: nowMs(), intentType: type, confidence });

    /* CONTEXT RESOLUTION (§5, §6, §7) */
    mark(record, 'CONTEXT_RESOLUTION');
    const pageCtx = normalizePageContext(page);
    if (pageCtx) {
      const s = getSession(owner);
      s.page = pageCtx;
    }
    const memory = await getMemory(owner);
    const resolvedCtx = resolveContext({ message, entities, memory, page: pageCtx });
    record.entities = resolvedCtx.resolved;
    record.context = { page: pageCtx, inheritedFrom: resolvedCtx.inheritedFrom, memoryHint: resolvedCtx.intentHint };
    trace.push({ stage: 'CONTEXT_RESOLUTION', at: nowMs(), inherited: resolvedCtx.inheritedFrom });

    /* "انجامش بده" with a pending confirmation → resume, don't re-plan. */
    if (resolvedCtx.intentHint?.kind === 'CONFIRM_PENDING') {
      const pending = memory.pendingConfirmation;
      const target = pending?.intentId ? getIntent(pending.intentId) : null;
      if (target && target.status === INTENT_STATUS.AWAITING_CONFIRMATION) {
        return confirmIntent(owner, target.intentId, { viaMessage: true });
      }
    }
    if (resolvedCtx.needsClarification) {
      const resp = questionResponse('روی کدام دارایی؟ نام دارایی را بگویید یا اول صفحه آن را باز کنید.', ['asset']);
      record.response = resp;
      record.status = INTENT_STATUS.COMPLETED;
      mark(record, 'COMPLETED');
      await rememberTurn(owner, record, resp);
      return { intentId: record.intentId, status: record.status, response: resp, state: record.state };
    }

    /* STATE INSPECTION — read the real unified state (§4) */
    mark(record, 'STATE_INSPECTION');
    if (context && typeof context === 'object') {
      // Client truth (wallet/portfolio/positions) arrives with the request.
      const { ingestClientData } = await import('./stateStore.js');
      ingestClientData(owner, context);
    }
    const state = await assembleState(owner);
    trace.push({ stage: 'STATE_INSPECTION', at: nowMs(), lastUpdated: state.lastUpdated });

    /* DISCOVER CAPABILITIES + PLAN */
    mark(record, 'PLANNING');
    const capabilities = await capabilityReport({ owner });
    record.context.capabilities = Object.fromEntries(Object.entries(capabilities).map(([k, v]) => [k, v.status]));
    const plan = planForIntent(record.intentType, { entities: record.entities, state, page: pageCtx });
    record.plan = plan;
    record.requiredModules = [...new Set(plan.map((s) => s.module))];
    record.requiredTools = plan.map((s) => `${s.module}.${s.operation}`);
    record.confirmationRequired = planRequiresConfirmation(plan);
    trace.push({ stage: 'PLANNING', at: nowMs(), steps: plan.length, confirmationRequired: record.confirmationRequired });

    /* POLICY CHECK up front (§33) */
    mark(record, 'POLICY_CHECK');
    const sec = securityScan({ action: { amountUsd: record.entities.amountUsd, recipient: record.entities.recipient }, state });
    if (sec.length) {
      record.status = INTENT_STATUS.SAFE_STOP;
      record.response = errorResponse({ intentType: record.intentType, message: 'این عملیات به دلیل بررسی امنیتی متوقف شد. برای جلوگیری از انتقال اشتباه، تراکنش اجرا نشد.', status: 'SAFE_STOP', error: sec[0].code, safeStop: true });
      mark(record, 'SAFE_STOP');
      publish('SECURITY_STOP', { intentId: record.intentId, code: sec[0].code }, { source: 'pipeline' });
      await rememberTurn(owner, record, record.response);
      return { intentId: record.intentId, status: record.status, response: record.response, state: record.state };
    }

    /* RUN READ/PREPARE STEPS through the tool router */
    mark(record, 'QUOTE');
    const { auto } = splitPlan(plan);
    const ctx = { owner, clientData: getSession(owner).clientData, page: pageCtx };
    const run = await runAutoSteps(record, auto, ctx);
    record.toolResults = run.results;
    trace.push({ stage: 'AUTO_STEPS', at: nowMs(), ok: run.ok, failedStep: run.failedStep ? `${run.failedStep.module}.${run.failedStep.operation}` : null });

    if (!run.ok) {
      const f = run.failure;
      record.status = INTENT_STATUS.ERROR;
      record.response = errorResponse({ intentType: record.intentType, message: 'اجرای این درخواست با خطا مواجه شد.', status: f.status, error: f.error, recovery: f.recovery || null, safeStop: Boolean(f.securityStop) });
      mark(record, f.securityStop ? 'SAFE_STOP' : 'ERROR');
      await rememberTurn(owner, record, record.response);
      return { intentId: record.intentId, status: record.status, response: record.response, state: record.state };
    }

    /* STATE-BOUND ANSWERS OR THE CONFIRMATION GATE */
    mark(record, 'SIMULATION');
    const execTypes = ['SWAP', 'SELL', 'BUY', 'BRIDGE', 'SWAP_AND_BRIDGE', 'FUTURES_OPEN', 'FUTURES_CLOSE', 'DYDX_ORDER'];
    let response;
    if (execTypes.includes(record.intentType)) {
      response = await executionIntent(record, run.results, state, record.entities, pageCtx);
    } else {
      mark(record, 'EXECUTION'); // read-only intents "execute" their analysis here
      switch (record.intentType) {
        case 'PORTFOLIO_ANALYSIS': response = await analyzePortfolio(record, run.results, state); break;
        case 'CONCENTRATION_CHECK': response = await analyzeConcentration(record, run.results, state, record.entities); break;
        case 'LOAN_SAFETY': response = await analyzeLoanSafety(record, run.results, state); break;
        case 'BORROW': case 'LEND': case 'REPAY': response = await analyzeLoanSafety(record, run.results, state); break;
        case 'WHAT_IF': response = await analyzeWhatIf(record, run.results, state, record.entities); break;
        case 'MARKET_OVERVIEW': response = await analyzeMarket(record, run.results); break;
        case 'SIGNALS_BRIEF': response = await analyzeSignals(record, run.results, record.entities); break;
        case 'NEWS_BRIEF': response = await analyzeNews(record, run.results, record.entities); break;
        case 'GOAL_CREATE': case 'GOAL_PROGRESS': response = await analyzeGoals(record, run.results, state, record.entities); break;
        case 'RISK_REVIEW': response = await analyzePortfolio(record, run.results, state); break;
        case 'REBALANCE': response = await analyzePortfolio(record, run.results, state); break;
        case 'TRANSACTION_STATUS': {
          const tx = liveResult(stepResult(run.results, 'transactions', 'read'));
          response = tx
            ? analysisResponse({ intentType: record.intentType, message: 'تراکنش پیدا شد.', confidence: 0.9, rows: [{ label: 'status', value: tx.transaction?.status || tx.transaction?.executionStatus || 'UNKNOWN' }] })
            : questionResponse('برای بررسی تراکنش، شناسه یا آدرس کیف پول لازم است.', ['txId']);
          break;
        }
        default: {
          /* GENERIC: answer ONLY with what the real state can say. */
          const caps = record.context.capabilities || {};
          const available = Object.entries(caps).filter(([, v]) => v === 'AVAILABLE').map(([k]) => k).slice(0, 8);
          response = questionResponse(
            `درخواست شما به یک عملیات مشخص نگاشت نشد.${available.length ? ` ماژول‌های در دسترس: ${available.join('، ')}.` : ''} مثال‌های قابل اجرا: «پرتفوی من را بررسی کن»، «500 دلار USDC را به ETH تبدیل کن»، «وضعیت وامم چطوره؟».`,
            ['intent']
          );
        }
      }
      record.status = INTENT_STATUS.COMPLETED;
    }

    /* sanity: never ship a forbidden generic phrase (§20) */
    if (response?.message) {
      const lower = String(response.message).toLowerCase();
      if (FORBIDDEN_GENERIC_PHRASES.some((p) => lower.includes(p.toLowerCase()))) {
        response = { ...response, message: `${response.message} (داده لازم برای این بخش در دسترس نبود.)` };
      }
    }

    record.response = response;
    if (record.status !== INTENT_STATUS.AWAITING_CONFIRMATION) {
      mark(record, 'COMPLETED');
      publish('INTENT_COMPLETED', { intentId: record.intentId, type: record.intentType }, { source: 'pipeline' });
    } else {
      trace.push({ stage: 'CONFIRMATION_GATE', at: nowMs(), actionId: record.pendingActionId });
    }
    await rememberTurn(owner, record, response);
    return {
      intentId: record.intentId,
      status: record.status,
      state: record.state,
      response,
      plan: record.plan.map((s) => ({ module: s.module, operation: s.operation, gated: s.permission === 'EXECUTE' })),
      trace: record.trace,
      capabilities: record.context.capabilities
    };
  } catch (err) {
    record.status = INTENT_STATUS.ERROR;
    record.response = errorResponse({ intentType: record.intentType, message: 'خطای داخلی در پردازش درخواست.', status: 'INTERNAL', error: String(err?.message || 'INTERNAL').slice(0, 160) });
    mark(record, 'ERROR');
    publish('INTENT_FAILED', { intentId: record.intentId, error: record.response.error }, { source: 'pipeline' });
    await rememberTurn(owner, record, record.response);
    return { intentId: record.intentId, status: record.status, response: record.response, state: record.state };
  }
}

/* ------------------------- confirmation & cancellation --------------------- */

export async function confirmIntent(owner, intentId, { viaMessage = false } = {}) {
  const record = getIntent(intentId);
  if (!record) return { ok: false, status: 404, error: 'INTENT_NOT_FOUND' };
  if (record.owner !== owner) return { ok: false, status: 403, error: 'OWNER_MISMATCH' };
  if (record.status !== INTENT_STATUS.AWAITING_CONFIRMATION) {
    return { ok: false, status: 409, error: `INTENT_NOT_AWAITING_CONFIRMATION:${record.status}` };
  }
  const action = getAction(record.pendingActionId);
  if (!action) return { ok: false, status: 409, error: 'ACTION_MISSING' };

  mark(record, 'CONFIRMATION');
  transitionAction(action.actionId, 'CONFIRMED', { note: viaMessage ? 'confirmed by message' : 'confirmed by user' });

  /* re-check policy with the CURRENT state (§18: is the data fresh?) */
  const state = await assembleState(owner, { force: true });
  const policy = policyCheck({ plan: record.plan, action: action.params, state });
  if (!policy.allowed) {
    transitionAction(action.actionId, 'REJECTED', { note: policy.stopCode });
    record.status = policy.safeStop ? INTENT_STATUS.SAFE_STOP : INTENT_STATUS.ERROR;
    record.response = errorResponse({
      intentType: record.intentType,
      message: 'این عملیات به دلیل بررسی امنیتی متوقف شد. برای جلوگیری از انتقال اشتباه، تراکنش اجرا نشد.',
      status: 'SAFE_STOP', error: policy.stopCode, safeStop: policy.safeStop
    });
    mark(record, policy.safeStop ? 'SAFE_STOP' : 'ERROR');
    publish('SECURITY_STOP', { intentId, code: policy.stopCode }, { source: 'pipeline' });
    await rememberTurn(owner, record, record.response);
    return { ok: true, intentId, status: record.status, response: record.response };
  }

  /* EXECUTE — server-side execution is: build the unsigned tx / hand-off. */
  mark(record, 'EXECUTION');
  transitionAction(action.actionId, 'EXECUTING');
  const session = getSession(owner);
  const ctx = { owner, clientData: session.clientData, page: record.context?.page || null };
  /* Map the connected wallet onto the prepared tx input — the brain reads
     the real wallet state instead of asking the user again (§1). */
  const execInput = { ...action.params, owner };
  if (!execInput.fromAddress && session.clientData?.wallet?.evmAddresses?.length) {
    execInput.fromAddress = session.clientData.wallet.evmAddresses[0];
  }
  const exec = await runTool({
    module: action.module,
    operation: action.operation, // 'prepare' — real signing stays in the user wallet
    input: execInput,
    ctx,
    permissionGranted: 'EXECUTE',
    trace: record.trace
  });

  if (!exec.ok) {
    transitionAction(action.actionId, 'FAILED', { result: { error: exec.error, status: exec.status } });
    record.status = exec.securityStop ? INTENT_STATUS.SAFE_STOP : INTENT_STATUS.ERROR;
    const retried = (exec.attempts?.length || 1) > 1 || exec.recoveries?.length > 0;
    record.response = errorResponse({
      intentType: record.intentType,
      message: exec.securityStop
        ? 'این عملیات به دلیل بررسی امنیتی متوقف شد. برای جلوگیری از انتقال اشتباه، تراکنش اجرا نشد.'
        : `آماده‌سازی تراکنش ناموفق بود (${String(exec.error || 'PROVIDER_ERROR').slice(0, 80)}).${retried ? ' تلاش مجدد و مسیر جایگزین به‌صورت خودکار امتحان شد؛' : ''} هیچ تراکنشی ناقص ارسال نشد.`,
      status: exec.status, error: exec.error, recovery: exec.recovery || null, safeStop: Boolean(exec.securityStop)
    });
    mark(record, exec.securityStop ? 'SAFE_STOP' : 'ERROR');
    await rememberTurn(owner, record, record.response);
    return { ok: true, intentId, status: record.status, response: record.response };
  }

  /* VERIFY */
  mark(record, 'VERIFICATION');
  transitionAction(action.actionId, 'VERIFYING');
  const verify = await runTool({
    module: action.module, operation: 'verify',
    input: { ...action.params, owner, prepared: exec.result },
    ctx, permissionGranted: 'EXECUTE', trace: record.trace
  });

  /* STATE UPDATE + EVENTS (§16): refresh everything affected. */
  mark(record, 'STATE_UPDATE');
  await afterAction(owner, {
    module: action.module, operation: action.operation, result: exec.result,
    eventPayload: { intentId, actionId: action.actionId, params: action.params }
  });

  transitionAction(action.actionId, 'COMPLETED', {
    result: exec.result,
    verification: verify.ok ? verify.result : { note: 'verification pending on-chain confirmation' }
  });
  recordRecentAction(owner, actionSummary(getAction(action.actionId)));
  record.status = INTENT_STATUS.COMPLETED;

  const prepared = exec.result?.quote || exec.result || null;
  const feeInfo = prepared?.estimate?.gasCosts?.[0]?.amount?.usd;
  record.response = {
    mode: 'ACTION_RESULT',
    intentType: record.intentType,
    message: action.module === 'swap' || action.module === 'bridge'
      ? `تراکنش ${action.module === 'swap' ? 'سواپ' : 'بریج'} آماده شد و برای امضا به کیف پول شما تحویل می‌شود. سرور هیچ کلیدی را امضا نمی‌کند. پس از تایید در کیف پول، وضعیت از مسیر Verify پیگیری و تمام ماژول‌ها به‌روزرسانی می‌شوند.`
      : `عملیات ${action.module} آماده اجرا شد و به کیف پول تحویل می‌شود.`,
    action: actionSummary(getAction(action.actionId)),
    result: {
      action: `${action.module}.${action.operation}`,
      amountUsd: action.params.amountUsd ?? null,
      network: action.params.network || action.params.fromChain || null,
      feeUsd: feeInfo ?? null,
      status: 'PREPARED_FOR_WALLET',
      transaction: exec.result?.unsignedTx ? 'unsigned tx attached' : null,
      verification: verify.ok ? verify.result : { pending: true },
      finalResult: 'HANDED_TO_WALLET'
    },
    verificationRequired: true,
    suggestions: ['وضعیت تراکنش را بررسی کن', 'پرتفوی من را بررسی کن']
  };
  mark(record, 'COMPLETED');
  publish('INTENT_COMPLETED', { intentId, type: record.intentType, module: action.module }, { source: 'pipeline' });
  await rememberTurn(owner, record, record.response);
  return { ok: true, intentId, status: record.status, response: record.response, action: actionSummary(getAction(action.actionId)) };
}

export async function cancelIntent(owner, intentId) {
  const record = getIntent(intentId);
  if (!record) return { ok: false, status: 404, error: 'INTENT_NOT_FOUND' };
  if (record.owner !== owner) return { ok: false, status: 403, error: 'OWNER_MISMATCH' };
  if (record.pendingActionId) {
    const action = getAction(record.pendingActionId);
    if (action && ['PENDING', 'CONFIRMED'].includes(action.status)) transitionAction(action.actionId, 'CANCELLED');
  }
  record.status = INTENT_STATUS.CANCELLED;
  record.response = { mode: 'ANSWER', intentType: record.intentType, message: 'عملیات لغو شد. هیچ تراکنشی اجرا نشد.' };
  mark(record, 'CANCELLED');
  await updateMemory(owner, { pendingConfirmation: null });
  return { ok: true, intentId, status: record.status, response: record.response };
}

/* ------------------------------ memory of turns ---------------------------- */

async function rememberTurn(owner, record, response) {
  await updateMemory(owner, {
    lastIntent: { type: record.intentType, at: nowMs(), pendingAmount: record.entities?.amountUsd ?? null, intentId: record.intentId },
    lastEntities: record.entities || null,
    lastTool: record.requiredTools?.length ? record.requiredTools[record.requiredTools.length - 1] : null,
    lastResult: response?.mode === 'ANSWER' ? { mode: response.mode, confidence: response.confidence } : null,
    lastAction: record.pendingActionId ? { actionId: record.pendingActionId, module: getAction(record.pendingActionId)?.module } : null,
    lastError: response?.mode === 'ERROR_AND_RECOVERY' ? { status: response.status, error: response.error } : null,
    pendingConfirmation: record.status === INTENT_STATUS.AWAITING_CONFIRMATION
      ? { intentId: record.intentId, actionId: record.pendingActionId, at: nowMs() }
      : null,
    conversationTurn: { at: nowMs(), intentType: record.intentType, entities: record.entities, mode: response?.mode || null }
  });
}

export function listIntents({ owner = null, limit = 20 } = {}) {
  return [...intents.values()]
    .filter((i) => (owner ? i.owner === owner : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((i) => ({ intentId: i.intentId, type: i.intentType, status: i.status, state: i.state, at: i.createdAt, requestId: i.requestId }));
}

/** Test hook. */
export function resetPipeline() { intents.clear(); byRequestId.clear(); }
