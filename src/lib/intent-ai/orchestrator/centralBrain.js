/**
 * FBT AI — UPGRADED CENTRAL BRAIN ENGINE (Section 1 — مغز مرکزی FBT AI)
 * ---------------------------------------------------------------------------
 * Understands every user request and orchestrates the exact models, specialist
 * agents, read-only tools, semantic memory, and adaptive council needed:
 *
 *   1. تشخیص هوشمند نوع درخواست (`classifyRequest`)
 *   2. انتخاب خودکار بهترین مدل برای هر وظیفه با بودجه پیچیدگی و هزینه (`selectOptimalModels`)
 *   3. تقسیم وظایف پیچیده بین چند ایجنت (`decomposeTask`)
 *   4. مدیریت اجرای هم‌زمان ایجنت‌ها (`executeAgentsConcurrently`)
 *   5. بررسی و مقایسه نتایج ایجنت‌ها (`compareAgentResults`)
 *   6. شناسایی اختلاف و اطلاعات متناقض (`detectContradictions`)
 *   7. انتخاب نتیجه نهایی بر اساس شواهد و اعتبار منابع (`selectEvidenceBasedResult`)
 *   8. تشخیص عدم اطمینان و درخواست اطلاعات بیشتر (`assessUncertaintyAndClarify`)
 *   9. مدیریت خطا و انتخاب خودکار Provider جایگزین (`executeWithProviderFailover`)
 *  10. ثبت کامل مراحل تصمیم‌گیری (`decisionTrace`)
 *
 * Core Invariants:
 *   • NEVER invokes all models for every request: model count is strictly gated
 *     by complexity & cost (`0..1` for trivial/simple, `2` for moderate, `3..4` max for complex/critical).
 *   • Non-custodial & read-only: `canExecute: false`, `canSign: false`, `canMoveFunds: false`, `executionAuthorized: false`.
 *   • Every input/output/trace passes through `redactSecrets`.
 */

import { cosine, embedText } from './vectorStore.js';
import { clipDeep, containsSensitiveKeyOrPhrase, redactSecrets } from './redact.js';
import { createSmartMemory } from './smartMemory.js';
import { createPerformanceLearning } from './performanceLearning.js';
import { COUNCIL_ROSTER, createAdaptiveCouncil, selectCouncilMembers } from './adaptiveCouncil.js';

export const CENTRAL_BRAIN_SCHEMA = 'fbt.central-brain.v2';
export const CENTRAL_BRAIN_VERSION = '2.0.0';

/**
 * Capability, specialty, and relative cost catalogue for FBT's multi-provider fleet.
 * `costUnits`: 1 = ultra-low/free tier, 2 = economy, 3 = balanced, 5 = premium reasoning.
 */
export const MODEL_FLEET_CATALOGUE = Object.freeze({
  groq: {
    provider: 'groq',
    defaultModel: 'llama-3.3-70b-versatile',
    costUnits: 1,
    latencyClass: 'ultra_fast',
    specialties: { fast_general: 0.95, classification: 0.94, quant_technical: 0.72, macro_news: 0.75, strategy_design: 0.72, risk_safety: 0.70, onchain_defi: 0.70, smart_money_flow: 0.70, adversarial_critic: 0.68, synthesis_arbiter: 0.72 }
  },
  workersai: {
    provider: 'workersai',
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    costUnits: 1,
    latencyClass: 'ultra_fast',
    specialties: { fast_general: 0.92, classification: 0.90, quant_technical: 0.68, macro_news: 0.70, strategy_design: 0.66, risk_safety: 0.66, onchain_defi: 0.66, smart_money_flow: 0.66, adversarial_critic: 0.62, synthesis_arbiter: 0.66 }
  },
  gemini: {
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    costUnits: 2,
    latencyClass: 'fast',
    specialties: { fast_general: 0.90, macro_news: 0.94, smart_money_flow: 0.86, onchain_defi: 0.85, quant_technical: 0.84, strategy_design: 0.84, risk_safety: 0.82, adversarial_critic: 0.80, synthesis_arbiter: 0.86 }
  },
  deepseek: {
    provider: 'deepseek',
    defaultModel: 'deepseek-chat',
    costUnits: 2,
    latencyClass: 'balanced',
    specialties: { quant_technical: 0.96, onchain_defi: 0.90, strategy_design: 0.91, risk_safety: 0.89, adversarial_critic: 0.90, synthesis_arbiter: 0.89, smart_money_flow: 0.85, macro_news: 0.78, fast_general: 0.80 }
  },
  openrouter: {
    provider: 'openrouter',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    costUnits: 2,
    latencyClass: 'balanced',
    specialties: { macro_news: 0.90, smart_money_flow: 0.91, onchain_defi: 0.88, quant_technical: 0.86, strategy_design: 0.87, fast_general: 0.88, risk_safety: 0.84, adversarial_critic: 0.83, synthesis_arbiter: 0.87 }
  },
  mistral: {
    provider: 'mistral',
    defaultModel: 'mistral-small-latest',
    costUnits: 2,
    latencyClass: 'fast',
    specialties: { fast_general: 0.87, synthesis_arbiter: 0.84, macro_news: 0.83, strategy_design: 0.82, risk_safety: 0.80, quant_technical: 0.79, onchain_defi: 0.78, smart_money_flow: 0.78, adversarial_critic: 0.78 }
  },
  aimlapi: {
    provider: 'aimlapi',
    defaultModel: 'gpt-4o-mini',
    costUnits: 3,
    latencyClass: 'balanced',
    specialties: { strategy_design: 0.90, synthesis_arbiter: 0.90, macro_news: 0.88, smart_money_flow: 0.86, quant_technical: 0.85, onchain_defi: 0.85, risk_safety: 0.87, adversarial_critic: 0.86, fast_general: 0.85 }
  },
  anthropic: {
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    costUnits: 5,
    latencyClass: 'deep',
    specialties: { risk_safety: 0.97, adversarial_critic: 0.97, synthesis_arbiter: 0.96, strategy_design: 0.93, macro_news: 0.90, onchain_defi: 0.88, quant_technical: 0.88, smart_money_flow: 0.86, fast_general: 0.75 }
  }
});

const KNOWN_ASSETS = Object.freeze([
  ['BTC', /(?:\bbtc\b|\bbitcoin\b|بیت[\s\u200c]*کوین|بیتکوین)/i],
  ['ETH', /(?:\beth\b|\bethereum\b|اتریوم|اتر\b)/i],
  ['SOL', /(?:\bsol\b|\bsolana\b|سولانا)/i],
  ['BNB', /(?:\bbnb\b|بایننس\s*کوین)/i],
  ['XRP', /(?:\bxrp\b|\bripple\b|ریپل)/i],
  ['TON', /(?:\bton\b|\btoncoin\b|تون[\s\u200c]*کوین)/i],
  ['ARB', /(?:\barb\b|\barbitrum\b|آربیتروم)/i],
  ['OP', /(?:\boptimism\b|اپتیمیزم)/i],
  ['BASE', /(?:\bbase\s+chain\b|شبکه\s*بیس)/i],
  ['AVAX', /(?:\bavax\b|\bavalanche\b|آوالانچ)/i],
  ['LINK', /(?:\blink\b|\bchainlink\b|چین[\s\u200c]*لینک)/i],
  ['DOGE', /(?:\bdoge\b|\bdogecoin\b|دوج[\s\u200c]*کوین|دوج)/i],
  ['PEPE', /(?:\bpepe\b|پپه)/i],
  ['USDT', /(?:\busdt\b|\btether\b|تتر)/i],
  ['USDC', /(?:\busdc\b|یو[\s\u200c]*اس[\s\u200c]*دی[\s\u200c]*سی)/i],
  ['GOLD', /(?:\bxau\b|\bgold\b|طلا|انس\s*جهانی)/i]
]);

export const SOURCE_CREDIBILITY_WEIGHTS = Object.freeze({
  observed_user_state: 1.00,   // Direct wallet / portfolio / quote read
  observed_market_feed: 0.92,  // Live market / smart-money / yield / macro feed
  verified_knowledge: 0.84,    // Verified FBT KB + explicit USER_SAID memory
  degraded_feed: 0.58,         // Cached / degraded feed
  unverified_inference: 0.28,  // Pure LLM prose with zero tool backing
  unsupported_numeric: 0.00    // Invented number without tool read
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeDigits(s = '') {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CAPABILITY 1: تشخیص هوشمند نوع درخواست (`classifyRequest`)               */
/* ────────────────────────────────────────────────────────────────────────── */

export function classifyRequest(rawMessage = '', { userProfile = null } = {}) {
  const cleanMsg = normalizeDigits(String(redactSecrets(String(rawMessage || '')))).trim();
  const lower = cleanMsg.toLowerCase();

  const assets = [];
  for (const [sym, re] of KNOWN_ASSETS) {
    if (re.test(cleanMsg)) assets.push(sym);
  }

  // Extract USD amount if mentioned
  let amountUsd = null;
  const amtMatch = lower.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|هزار)?/) || lower.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(هزار\s*)?(?:دلار|usd|usdt|تتر)/);
  if (amtMatch) {
    const num = Number(String(amtMatch[1]).replace(/,/g, ''));
    if (Number.isFinite(num) && num > 0) amountUsd = num * (amtMatch[2] ? 1000 : 1);
  }

  let horizon = null;
  if (/(کوتاه[\s\u200c]*مدت|روزانه|امروز|ساعتی|اسکلپ|short[\s-]*term|intraday|scalp|today|24h)/i.test(cleanMsg)) horizon = 'SHORT_TERM';
  else if (/(میان[\s\u200c]*مدت|هفتگی|چند\s*هفته|چند\s*ماه|swing|medium[\s-]*term|weekly)/i.test(cleanMsg)) horizon = 'MEDIUM_TERM';
  else if (/(بلند[\s\u200c]*مدت|سالانه|هودل|چند\s*سال|long[\s-]*term|hodl|multi[\s-]*year)/i.test(cleanMsg)) horizon = 'LONG_TERM';

  // Domain signals
  const signals = {
    greeting: /^(?:(?:سلام|درود|وقت\s*بخیر|صبح\s*بخیر|عصر\s*بخیر|شب\s*بخیر|خوبی|چطوری|مرسی|ممنون|تشکر|خداحافظ|hi|hello|hey|thanks|thank\s+you)[\s!?.،]*)+$/i.test(cleanMsg),
    faqKnowledge: /(چیست|یعنی\s*چه|چطور\s*کار\s*می|آموزش|توضیح\s*بده|کارمزد\s*پلتفرم|غیرامانی\s*یعنی|what\s+is|how\s+does|explain)/i.test(cleanMsg),
    priceOnly: /(قیمت|چنده|چند\s*دلاره|\bprice\b)/i.test(cleanMsg),
    technical: /(تکنیکال|نمودار|چارت|حمایت|مقاومت|روند|مومنتوم|نوسان|آراس[\s\u200c]*آی|مکدی|technical|chart|trend|rsi|macd|support|resistance|volatility)/i.test(cleanMsg),
    onchain: /(آن[\s\u200c]*چین|درون[\s\u200c]*زنجیره|تی[\s\u200c]*وی[\s\u200c]*ال|نقدینگی\s*استخر|گس|تراکنش|on[\s-]*chain|tvl|liquidity\s+pool|gas)/i.test(cleanMsg),
    smartMoney: /(اسمارت[\s\u200c]*مانی|پول\s*هوشمند|نهنگ|انباشت|توزیع|ورود\s*پول\s*هوشمند|smart[\s-]*money|whale|accumulation|distribution)/i.test(cleanMsg),
    macroNews: /(اخبار|خبر|اقتصاد\s*کلان|نرخ\s*بهره|فدرال|تورم|تحریم|جنگ|چرا\s*ریخت|چرا\s*رشد|news|macro|fed|fomc|cpi|inflation|headline|why\s+did)/i.test(cleanMsg),
    defiYield: /(استیک|استیکینگ|دیفای|سود\s*سپرده|بازده|ای[\s\u200c]*پی[\s\u200c]*وای|فارمینگ|yield|apy|apr|staking|defi|vault|lending)/i.test(cleanMsg),
    portfolioWallet: /(پورتفولیو|پرتفوی|سبد\s*من|دارایی[\s\u200c]*هام|موجودی\s*(?:من|کیف)|کیف\s*پولم|کل\s*دارایی|my\s+portfolio|my\s+wallet|my\s+balance|my\s+holdings)/i.test(cleanMsg),
    risk: /(ریسک|خطر|ضرر|لیکویید|اهرم|لوریج|امنیت\s*سبد|دراداون|risk|drawdown|liquidation|leverage|exposure)/i.test(cleanMsg),
    strategyDecision: /(استراتژی|بخرم|بفروشم|نگه\s*دارم|صبر\s*کنم|سرمایه[\s\u200c]*گذاری\s*کنم|پیشنهاد\s*معاملاتی|چه\s*کار\s*کنم|پله[\s\u200c]*ای|ریبالانس|strategy|should\s+i\s+(?:buy|sell|hold|invest)|trade\s+setup|allocate|rebalance)/i.test(cleanMsg),
    executionQuote: /(سواپ|تبدیل\s*کن|بریج\s*کن|نرخ\s*تبدیل|مسیر\s*سواپ|swap|bridge|quote|convert)/i.test(cleanMsg),
    comparison: /(مقایسه|کدام\s*بهتر|یا\s+|در\s*برابر|\bvs\.?\b|\bversus\b|compare|better\s+than)/i.test(cleanMsg)
  };

  const activeDomainCount = [
    signals.technical,
    signals.onchain,
    signals.smartMoney,
    signals.macroNews,
    signals.defiYield,
    signals.portfolioWallet,
    signals.risk,
    signals.strategyDecision,
    signals.executionQuote
  ].filter(Boolean).length;

  // Determine primary request category
  let category = 'FACTUAL_KNOWLEDGE';
  if (!cleanMsg || cleanMsg.length < 2) category = 'AMBIGUOUS_INCOMPLETE';
  else if (signals.greeting) category = 'SOCIAL_CHITCHAT';
  else if (activeDomainCount >= 3 || (signals.strategyDecision && activeDomainCount >= 2) || (signals.comparison && assets.length >= 2 && activeDomainCount >= 1)) {
    category = 'MULTI_DOMAIN_COMPLEX';
  } else if (signals.portfolioWallet) category = 'PORTFOLIO_AUDIT';
  else if (signals.executionQuote) category = 'EXECUTION_PLANNING';
  else if (signals.strategyDecision) category = 'TRADING_STRATEGY';
  else if (signals.defiYield) category = 'DEFI_YIELD';
  else if (signals.smartMoney) category = 'SMART_MONEY_FLOW';
  else if (signals.onchain) category = 'ONCHAIN_ANALYSIS';
  else if (signals.macroNews) category = 'MACRO_NEWS_IMPACT';
  else if (signals.risk) category = 'RISK_ASSESSMENT';
  else if (signals.technical) category = 'TECHNICAL_ANALYSIS';
  else if (signals.priceOnly && assets.length > 0) category = 'PRICE_LOOKUP';
  else if (signals.faqKnowledge) category = 'FACTUAL_KNOWLEDGE';
  else if (/^(بخرم|بفروشم|الان\s*خوبه|پیشنهاد\s*بده|چی\s*بخرم|سرمایه[\s\u200c]*گذاری\s*کنم|should\s+i\s+buy|what\s+to\s+buy)[\s?؟!]*$/i.test(cleanMsg)) {
    category = 'AMBIGUOUS_INCOMPLETE';
  } else if (assets.length > 0) {
    category = 'TECHNICAL_ANALYSIS';
  }

  // Complexity score (0..100)
  let score = 10;
  if (signals.greeting) score = 5;
  else {
    score += activeDomainCount * 18;
    score += Math.min(20, assets.length * 8);
    if (signals.comparison) score += 14;
    if (signals.strategyDecision) score += 20;
    if (signals.portfolioWallet || signals.executionQuote) score += 16;
    if (amountUsd && amountUsd >= 5000) score += 15;
    if (/(اهرم|لوریج|کل\s*سرمایه|کل\s*پول|leverage|margin|all[\s-]*in)/i.test(cleanMsg)) score += 18;
    if (cleanMsg.length > 180) score += 8;
  }
  score = clamp(score, 0, 100);

  let complexity = 'SIMPLE';
  if (score <= 12 || category === 'SOCIAL_CHITCHAT') complexity = 'TRIVIAL';
  else if (score <= 34 && !signals.strategyDecision) complexity = 'SIMPLE';
  else if (score <= 58) complexity = 'MODERATE';
  else if (score <= 80) complexity = 'COMPLEX';
  else complexity = 'CRITICAL';

  // Cost budget gating (NEVER invoke all models!)
  const costBudget = complexity === 'TRIVIAL'
    ? 'ZERO_MODEL_OR_ULTRA_CHEAP'
    : complexity === 'SIMPLE'
      ? 'ECONOMY_SINGLE_MODEL'
      : complexity === 'MODERATE'
        ? 'BALANCED_DUAL_MODEL'
        : 'DEEP_SELECTIVE_COUNCIL';

  // Required read-only tools
  const requiredTools = new Set();
  if (assets.length > 0 || signals.priceOnly || signals.technical || signals.strategyDecision || category === 'MULTI_DOMAIN_COMPLEX') {
    requiredTools.add('fbt_get_market_snapshot');
  }
  if (signals.smartMoney || category === 'MULTI_DOMAIN_COMPLEX') requiredTools.add('fbt_get_signals');
  if (signals.macroNews || category === 'MULTI_DOMAIN_COMPLEX') {
    requiredTools.add('fbt_get_news');
    if (/(نرخ\s*بهره|فدرال|تورم|دلار|طلا|کلان|macro|fed|cpi|dxy|gold)/i.test(cleanMsg)) {
      requiredTools.add('fbt_get_macro_snapshot');
    }
  }
  if (signals.defiYield || signals.onchain) requiredTools.add('fbt_get_yields');
  if (signals.portfolioWallet || (signals.risk && userProfile)) {
    requiredTools.add('fbt_get_portfolio');
    requiredTools.add('fbt_get_wallet_state');
  }
  if (signals.executionQuote && assets.length >= 2) requiredTools.add('fbt_get_quote_preview');

  const requiresToolTruth = signals.portfolioWallet || signals.priceOnly || signals.executionQuote;

  return {
    category,
    complexity,
    complexityScore: score,
    costBudget,
    language: /[\u0600-\u06FF]/.test(cleanMsg) ? 'fa' : 'en',
    entities: {
      assets,
      amountUsd,
      horizon,
      isComparison: signals.comparison
    },
    activeDomainCount,
    requiredTools: [...requiredTools],
    requiresToolTruth,
    needsCouncil: ['MODERATE', 'COMPLEX', 'CRITICAL'].includes(complexity) && !['SOCIAL_CHITCHAT', 'FACTUAL_KNOWLEDGE'].includes(category)
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CAPABILITY 2: انتخاب خودکار بهترین مدل (Cost & Complexity Aware)          */
/* ────────────────────────────────────────────────────────────────────────── */

export function selectOptimalModels({
  classification,
  subTasks = [],
  availableProviders = null, // array of provider IDs; defaults to configured or full fleet
  providerHealth = {},       // { [provider]: { healthy: boolean, errorRate: 0..1 } }
  trustWeights = {}          // { [provider]: 0.35..1.65 } from PerformanceLearning
} = {}) {
  const fleetIds = Array.isArray(availableProviders) && availableProviders.length
    ? availableProviders.filter((id) => MODEL_FLEET_CATALOGUE[id])
    : Object.keys(MODEL_FLEET_CATALOGUE);

  const complexity = classification?.complexity || 'SIMPLE';
  // Strict model count budget by complexity!
  const maxDistinctModels = complexity === 'TRIVIAL'
    ? 0
    : complexity === 'SIMPLE'
      ? 1
      : complexity === 'MODERATE'
        ? 2
        : complexity === 'CRITICAL'
          ? 4
          : 3;

  // Max per-call cost unit allowed by budget
  const maxCostUnits = complexity === 'TRIVIAL'
    ? 1
    : complexity === 'SIMPLE'
      ? 2
      : complexity === 'MODERATE'
        ? 3
        : 5;

  if (maxDistinctModels === 0 || fleetIds.length === 0) {
    return {
      maxModelBudget: maxDistinctModels,
      selectedModels: [],
      taskAssignments: {},
      skippedModels: fleetIds.map((p) => ({
        provider: p,
        reason: maxDistinctModels === 0 ? 'TRIVIAL_REQUEST_ZERO_LLM_COST_SAVING' : 'NO_PROVIDER_CONFIGURED'
      })),
      estimatedCostUnits: 0
    };
  }

  function rankForSpecialty(specialty = 'fast_general', allowPremium = false) {
    return fleetIds
      .map((id) => {
        const spec = MODEL_FLEET_CATALOGUE[id];
        const healthInfo = providerHealth[id] || { healthy: true, errorRate: 0 };
        if (healthInfo.healthy === false) return null;
        const costCap = allowPremium ? 5 : maxCostUnits;
        const overBudgetPenalty = spec.costUnits > costCap ? (spec.costUnits - costCap) * 0.25 : 0;
        const affinity = spec.specialties[specialty] ?? spec.specialties.fast_general ?? 0.7;
        const trust = clamp(Number(trustWeights[id] ?? 1.0), 0.35, 1.65);
        const healthScore = 1 - clamp(Number(healthInfo.errorRate || 0), 0, 1);
        const costEfficiency = (6 - spec.costUnits) / 5; // prefers cheaper when quality is equal
        const totalScore = affinity * 0.44 + (trust / 1.4) * 0.28 + healthScore * 0.16 + costEfficiency * 0.12 - overBudgetPenalty;
        return {
          provider: id,
          model: spec.defaultModel,
          costUnits: spec.costUnits,
          latencyClass: spec.latencyClass,
          specialty,
          affinity,
          trustWeight: trust,
          score: Math.round(totalScore * 10000) / 10000
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }

  const effectiveTasks = subTasks.length
    ? subTasks
    : [{
      taskId: 'primary_response',
      agentId: 'primary_responder',
      specialty: complexity === 'SIMPLE' ? 'fast_general' : 'synthesis_arbiter'
    }];

  const chosenSet = new Map(); // provider -> modelDescriptor
  const taskAssignments = {};

  for (const task of effectiveTasks) {
    const ranked = rankForSpecialty(task.specialty || 'fast_general', complexity === 'CRITICAL');
    if (!ranked.length) continue;

    // Pick highest-scoring model, respecting maxDistinctModels cap across the whole turn!
    let primary = ranked[0];
    if (!chosenSet.has(primary.provider) && chosenSet.size >= maxDistinctModels) {
      // Reuse the best already-selected model for this specialty to stay strictly within cost budget!
      const fromChosen = ranked.find((r) => chosenSet.has(r.provider));
      if (fromChosen) primary = fromChosen;
    } else {
      chosenSet.set(primary.provider, primary);
    }

    const fallbacks = ranked
      .filter((r) => r.provider !== primary.provider)
      .slice(0, 3)
      .map((r) => ({ provider: r.provider, model: r.model, score: r.score }));

    taskAssignments[task.taskId] = {
      taskId: task.taskId,
      agentId: task.agentId,
      primaryProvider: primary.provider,
      primaryModel: primary.model,
      selectionScore: primary.score,
      trustWeight: primary.trustWeight,
      costUnits: primary.costUnits,
      fallbackChain: fallbacks
    };
  }

  const selectedModels = [...chosenSet.values()];
  const skippedModels = fleetIds
    .filter((id) => !chosenSet.has(id))
    .map((id) => ({
      provider: id,
      model: MODEL_FLEET_CATALOGUE[id]?.defaultModel,
      costUnits: MODEL_FLEET_CATALOGUE[id]?.costUnits,
      reason: providerHealth[id]?.healthy === false
        ? 'PROVIDER_UNHEALTHY_CIRCUIT_OPEN'
        : MODEL_FLEET_CATALOGUE[id]?.costUnits > maxCostUnits
          ? `EXCEEDS_${complexity}_COST_BUDGET`
          : `NOT_NEEDED_CAP_${maxDistinctModels}_MODELS`
    }));

  return {
    maxModelBudget: maxDistinctModels,
    selectedModels,
    taskAssignments,
    skippedModels,
    estimatedCostUnits: selectedModels.reduce((s, m) => s + m.costUnits, 0)
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CAPABILITY 3: تقسیم وظایف پیچیده بین چند ایجنت (`decomposeTask`)          */
/* ────────────────────────────────────────────────────────────────────────── */

export function decomposeTask({ classification, message = '', learningGuidance = null, forceCouncilMembers = null } = {}) {
  const councilPlan = selectCouncilMembers({
    classification,
    message,
    learningGuidance,
    forceMembers: forceCouncilMembers
  });

  if (!councilPlan.councilRequired) {
    const specialty = classification.category === 'TECHNICAL_ANALYSIS'
      ? 'quant_technical'
      : classification.category === 'MACRO_NEWS_IMPACT'
        ? 'macro_news'
        : 'fast_general';
    return {
      multiAgent: false,
      councilPlan,
      subTasks: [{
        taskId: 'task_direct_1',
        wave: 1,
        agentId: 'direct_analyst',
        roleFa: 'تحلیلگر مستقیم مغز مرکزی',
        roleEn: 'Direct Brain Analyst',
        specialty,
        tools: classification.requiredTools || [],
        dependsOn: [],
        objective: `پاسخ مستقیم و کم‌هزینه به درخواست (${classification.category})`
      }]
    };
  }

  const subTasks = councilPlan.selectedMembers.map((m, idx) => {
    const spec = COUNCIL_ROSTER[m.memberId];
    const wave1Ids = councilPlan.selectedMembers.filter((x) => x.wave === 1).map((x) => `task_${x.memberId}`);
    const dependsOn = m.wave === 1
      ? []
      : m.wave === 2
        ? wave1Ids
        : [...wave1Ids, ...(councilPlan.selectedMembers.some((x) => x.wave === 2) ? ['task_decision_critic'] : [])];

    return {
      taskId: `task_${m.memberId}`,
      order: idx + 1,
      wave: m.wave,
      agentId: m.memberId,
      roleFa: spec.roleFa,
      roleEn: spec.roleEn,
      specialty: spec.preferredSpecialty,
      tools: spec.tools,
      facets: spec.facets,
      dependsOn,
      selectionReason: m.reason,
      objective: spec.descriptionFa
    };
  });

  return {
    multiAgent: subTasks.length > 1,
    councilPlan,
    subTasks
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CAPABILITY 4 & 9: اجرای هم‌زمان ایجنت‌ها + انتخاب خودکار Provider جایگزین */
/* ────────────────────────────────────────────────────────────────────────── */

export async function executeWithProviderFailover({
  assignment,
  invokeProvider, // async ({ provider, model, prompt, agentId, timeoutMs }) => { text, stance, confidence, model }
  prompt,
  agentId,
  timeoutMs = 4500,
  onProviderError = null
} = {}) {
  if (!assignment || typeof invokeProvider !== 'function') {
    return {
      ok: false,
      usedFallbackDeterministic: true,
      provider: 'deterministic-specialist',
      model: 'fbt-deterministic-v2',
      failoverUsed: false,
      attemptedProviders: [],
      errorTrail: []
    };
  }

  const candidates = [
    { provider: assignment.primaryProvider, model: assignment.primaryModel },
    ...(assignment.fallbackChain || [])
  ].filter((c) => c?.provider);

  const attemptedProviders = [];
  const errorTrail = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    attemptedProviders.push(cand.provider);
    let timer = null;
    try {
      const res = await Promise.race([
        invokeProvider({
          provider: cand.provider,
          model: cand.model,
          prompt,
          agentId,
          timeoutMs
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`PROVIDER_TIMEOUT_${timeoutMs}MS`)), timeoutMs);
        })
      ]);
      const text = String(res?.text ?? res?.reply ?? res?.summary ?? '').trim();
      if (!text) throw new Error('EMPTY_PROVIDER_RESPONSE');

      return {
        ok: true,
        text: String(redactSecrets(text)),
        stance: res?.stance || null,
        action: res?.action || null,
        confidence: res?.confidence ?? null,
        provider: cand.provider,
        model: res?.model || cand.model,
        failoverUsed: i > 0,
        failoverHops: i,
        attemptedProviders,
        errorTrail
      };
    } catch (err) {
      const errMsg = String(err?.message || err).slice(0, 140);
      errorTrail.push({ provider: cand.provider, error: errMsg });
      if (typeof onProviderError === 'function') {
        onProviderError(cand.provider, errMsg);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    ok: false,
    usedFallbackDeterministic: true,
    provider: 'deterministic-specialist',
    model: 'fbt-deterministic-v2',
    failoverUsed: attemptedProviders.length > 0,
    failoverHops: attemptedProviders.length,
    attemptedProviders,
    errorTrail
  };
}

/**
 * Bounded concurrent executor across parallel agent tasks inside a wave.
 */
export async function executeAgentsConcurrently(tasks = [], workerFn, { maxConcurrency = 4, taskTimeoutMs = 5000 } = {}) {
  if (!tasks.length) return [];
  const results = new Array(tasks.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < tasks.length) {
      const idx = cursor;
      cursor += 1;
      const task = tasks[idx];
      const started = Date.now();
      let timer = null;
      try {
        const value = await Promise.race([
          workerFn(task, idx),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`AGENT_TIMEOUT_${taskTimeoutMs}MS`)), taskTimeoutMs);
          })
        ]);
        results[idx] = { ok: true, taskId: task.taskId, agentId: task.agentId, durationMs: Date.now() - started, output: value };
      } catch (err) {
        results[idx] = {
          ok: false,
          taskId: task.taskId,
          agentId: task.agentId,
          durationMs: Date.now() - started,
          error: String(err?.message || err).slice(0, 160)
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, maxConcurrency), tasks.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CAPABILITIES 5 & 6: مقایسه نتایج ایجنت‌ها و شناسایی تناقض‌ها              */
/* ────────────────────────────────────────────────────────────────────────── */

export function compareAgentResults(agentOutputs = []) {
  const valid = agentOutputs.filter((a) => a && a.summary);
  if (!valid.length) {
    return {
      comparedCount: 0,
      stanceDistribution: {},
      semanticSimilarityAvg: 0,
      agreementScore: 0,
      pointsOfAgreement: []
    };
  }

  const stanceDistribution = {};
  for (const a of valid) {
    const st = String(a.stance || 'neutral').toLowerCase();
    stanceDistribution[st] = (stanceDistribution[st] || 0) + 1;
  }

  // Pairwise semantic similarity using dense bilingual semantic embeddings
  const vectors = valid.map((a) => embedText(a.summary));
  let pairSum = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      pairSum += Math.max(0, cosine(vectors[i], vectors[j]));
      pairs += 1;
    }
  }
  const semanticSim = pairs > 0 ? pairSum / pairs : 1;
  const maxStanceVotes = Math.max(...Object.values(stanceDistribution));
  const stanceAgreement = maxStanceVotes / valid.length;
  const agreementScore = Math.round((stanceAgreement * 0.65 + semanticSim * 0.35) * 1000) / 1000;

  const pointsOfAgreement = [];
  for (const [st, cnt] of Object.entries(stanceDistribution)) {
    if (cnt >= 2) {
      const aligned = valid.filter((a) => String(a.stance || 'neutral').toLowerCase() === st);
      pointsOfAgreement.push({
        stance: st,
        agents: aligned.map((a) => a.memberId || a.agentId),
        summary: `هم‌سویی ${cnt} ایجنت (${aligned.map((a) => a.roleFa || a.agentId).join('، ')}) روی وضعیت «${st}».`
      });
    }
  }

  return {
    comparedCount: valid.length,
    stanceDistribution,
    semanticSimilarityAvg: Math.round(semanticSim * 1000) / 1000,
    stanceAgreement: Math.round(stanceAgreement * 1000) / 1000,
    agreementScore,
    pointsOfAgreement
  };
}

function extractNumbers(text = '') {
  const norm = normalizeDigits(text);
  const matches = [...norm.matchAll(/(?:\$\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(%|درصد|دلار|usd)?/gi)];
  return matches
    .map((m) => ({
      value: Number(String(m[1]).replace(/,/g, '')),
      unit: (m[2] || '').toLowerCase()
    }))
    .filter((n) => Number.isFinite(n.value) && n.value > 0 && n.value !== 24 && n.value !== 100);
}

export function detectContradictions({ agentOutputs = [], evidence = [], userProfile = null } = {}) {
  const contradictions = [];
  const domainAgents = agentOutputs.filter((a) => (a.memberId || a.agentId) !== 'final_arbiter');

  // 1. Directional Conflict
  const bulls = domainAgents.filter((a) => a.stance === 'bullish');
  const bears = domainAgents.filter((a) => a.stance === 'bearish' || a.action === 'AVOID_REJECT');
  if (bulls.length > 0 && bears.length > 0) {
    contradictions.push({
      type: 'DIRECTIONAL_CONFLICT',
      severity: 'HIGH',
      agentsA: bulls.map((a) => a.memberId || a.agentId),
      agentsB: bears.map((a) => a.memberId || a.agentId),
      description: `تناقض جهتی: ${bulls.map((a) => a.roleFa || a.agentId).join('، ')} دیدگاه صعودی دارند اما ${bears.map((a) => a.roleFa || a.agentId).join('، ')} هشدار نزولی/رد صادر کرده‌اند.`
    });
  }

  // 2. Numeric Contradiction across agents on percentage or USD figures
  const pctClaims = [];
  const usdClaims = [];
  for (const ag of domainAgents) {
    const nums = extractNumbers(ag.summary || '');
    for (const n of nums) {
      if (n.unit === '%' || n.unit === 'درصد') pctClaims.push({ agentId: ag.memberId || ag.agentId, value: n.value });
      else if (n.unit === 'دلار' || n.unit === 'usd' || n.value >= 50) usdClaims.push({ agentId: ag.memberId || ag.agentId, value: n.value });
    }
  }
  const checkSpread = (claims, label, relTolerance = 0.25) => {
    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        if (claims[i].agentId === claims[j].agentId) continue;
        const hi = Math.max(claims[i].value, claims[j].value);
        const lo = Math.min(claims[i].value, claims[j].value);
        if (lo > 0 && (hi - lo) / hi > relTolerance && (hi - lo) >= 1.5) {
          contradictions.push({
            type: 'NUMERIC_CONTRADICTION',
            severity: 'MEDIUM',
            agentsA: [claims[i].agentId],
            agentsB: [claims[j].agentId],
            values: [claims[i].value, claims[j].value],
            description: `اختلاف عددی در ${label}: ${claims[i].agentId} مقدار ${claims[i].value} و ${claims[j].agentId} مقدار ${claims[j].value} را گزارش کرده‌اند.`
          });
          return;
        }
      }
    }
  };
  checkSpread(pctClaims, 'درصد/نرخ', 0.35);
  checkSpread(usdClaims, 'مقدار دلاری/قیمت', 0.15);

  // 3. Unsupported Numeric Claim when zero observed tools exist
  const observedTools = evidence.filter((e) => e.status === 'observed');
  if (observedTools.length === 0 && evidence.length > 0) {
    for (const ag of domainAgents) {
      if (usdClaims.some((c) => c.agentId === (ag.memberId || ag.agentId))) {
        contradictions.push({
          type: 'UNSUPPORTED_NUMERIC_CLAIM',
          severity: 'CRITICAL',
          agentsA: [ag.memberId || ag.agentId],
          agentsB: ['tool_truth_guard'],
          description: `ایجنت ${ag.memberId || ag.agentId} عدد قیمتی/موجودی ذکر کرده در حالی که هیچ ابزار داده‌ای مشاهده نشده است.`
        });
      }
    }
  }

  // 4. User Preference / Risk Policy Conflict
  const prefs = userProfile?.preferencesMap || {};
  if (prefs.riskTolerance === 'CONSERVATIVE' || prefs.leveragePolicy === 'NO_LEVERAGE_SPOT_ONLY') {
    for (const ag of domainAgents) {
      if (/(با\s*اهرم\s*وارد|استفاده\s*از\s*لوریج\s*توصیه|use\s+high\s+leverage|10x\s+long)/i.test(ag.summary || '')) {
        contradictions.push({
          type: 'USER_PREFERENCE_CONFLICT',
          severity: 'HIGH',
          agentsA: [ag.memberId || ag.agentId],
          agentsB: ['user_memory_profile'],
          description: `پیشنهاد ${ag.memberId || ag.agentId} با محدودیت ثبت‌شده کاربر در حافظه بلندمدت (${prefs.riskTolerance || prefs.leveragePolicy}) در تضاد است.`
        });
      }
    }
  }

  return contradictions;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CAPABILITY 7: انتخاب نتیجه نهایی بر اساس شواهد و اعتبار منابع             */
/* ────────────────────────────────────────────────────────────────────────── */

export function selectEvidenceBasedResult({
  agentOutputs = [],
  evidence = [],
  contradictions = [],
  trustWeights = { models: {}, agents: {} }
} = {}) {
  const observedMap = new Map(evidence.map((e) => [e.facetId, e]));
  const unsupportedAgents = new Set(
    contradictions
      .filter((c) => c.type === 'UNSUPPORTED_NUMERIC_CLAIM' || c.type === 'USER_PREFERENCE_CONFLICT')
      .flatMap((c) => c.agentsA || [])
  );

  const scoredCandidates = agentOutputs
    .filter((a) => (a.memberId || a.agentId) !== 'final_arbiter')
    .map((a) => {
      const id = a.memberId || a.agentId;
      const cited = Array.isArray(a.evidenceCited) ? a.evidenceCited : [];
      let sourceCredibility = SOURCE_CREDIBILITY_WEIGHTS.unverified_inference;

      if (unsupportedAgents.has(id)) {
        sourceCredibility = SOURCE_CREDIBILITY_WEIGHTS.unsupported_numeric;
      } else if (cited.length > 0) {
        const creds = cited.map((fid) => {
          const ev = observedMap.get(fid);
          if (!ev) return SOURCE_CREDIBILITY_WEIGHTS.unverified_inference;
          if (ev.status === 'observed') {
            return (fid === 'portfolio_state' || fid === 'wallet_state' || fid === 'venue_quote')
              ? SOURCE_CREDIBILITY_WEIGHTS.observed_user_state
              : SOURCE_CREDIBILITY_WEIGHTS.observed_market_feed;
          }
          if (ev.status === 'degraded') return SOURCE_CREDIBILITY_WEIGHTS.degraded_feed;
          return 0.1;
        });
        sourceCredibility = creds.reduce((s, x) => s + x, 0) / creds.length;
      }

      const agentTrust = clamp(Number(trustWeights?.agents?.[id] ?? a.agentTrustWeight ?? 1.0), 0.35, 1.65);
      const modelTrust = clamp(Number(trustWeights?.models?.[a.provider] ?? a.modelTrustWeight ?? 1.0), 0.35, 1.65);
      const unsupportedPenalty = unsupportedAgents.has(id) ? 0.55 : 0;

      const compositeScore = Math.max(
        0,
        sourceCredibility * 0.52
        + (agentTrust / 1.5) * 0.28
        + (modelTrust / 1.5) * 0.20
        - unsupportedPenalty
      );

      return {
        agentId: id,
        roleFa: a.roleFa || id,
        stance: a.stance,
        action: a.action,
        summary: a.summary,
        provider: a.provider,
        sourceCredibility: Math.round(sourceCredibility * 1000) / 1000,
        agentTrust,
        modelTrust,
        compositeScore: Math.round(compositeScore * 10000) / 10000
      };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    winner: scoredCandidates[0] || null,
    rankedCandidates: scoredCandidates,
    credibilityHierarchyUsed: SOURCE_CREDIBILITY_WEIGHTS
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CAPABILITY 8: تشخیص عدم اطمینان و درخواست اطلاعات بیشتر                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function assessUncertaintyAndClarify({
  classification,
  message = '',
  userProfile = null,
  evidence = [],
  contradictions = []
} = {}) {
  const missingSlots = [];
  const questions = [];
  const prefs = userProfile?.preferencesMap || {};
  const goals = userProfile?.goals || [];
  const assets = classification?.entities?.assets || [];

  // Case 1: Ambiguous request with no asset/subject
  if (
    classification.category === 'AMBIGUOUS_INCOMPLETE'
    || (['TRADING_STRATEGY', 'TECHNICAL_ANALYSIS', 'PRICE_LOOKUP', 'EXECUTION_PLANNING'].includes(classification.category) && assets.length === 0 && !/(بازار|مارکت|سبد|پرتفوی|market|portfolio|crypto)/i.test(message))
  ) {
    missingSlots.push('target_asset');
    questions.push('لطفاً مشخص کنید کدام ارز یا دارایی مدنظر شماست؟ (مثلاً BTC، ETH یا SOL)');
  }

  // Case 2: Execution / swap planning missing amount or pair
  if (classification.category === 'EXECUTION_PLANNING') {
    if (assets.length < 2) {
      missingSlots.push('swap_pair');
      questions.push('قصد تبدیل کدام توکن مبدأ به کدام توکن مقصد را دارید؟');
    }
    if (!classification.entities?.amountUsd && !/[0-9]/.test(normalizeDigits(message))) {
      missingSlots.push('amount');
      questions.push('مقدار یا مبلغ موردنظر برای بررسی نرخ تبدیل چقدر است؟');
    }
  }

  // Case 3: Trading strategy / investment advice missing both risk tolerance AND horizon (when not in user's long-term memory!)
  if (classification.category === 'TRADING_STRATEGY' && !prefs.riskTolerance && !classification.entities?.horizon && goals.length === 0) {
    if (normalizeDigits(message).length < 45) {
      missingSlots.push('risk_and_horizon');
      questions.push('افق زمانی سرمایه‌گذاری شما (کوتاه‌مدت یا بلندمدت) و میزان ریسک‌پذیری‌تان (کم‌ریسک، متعادل یا پرریسک) چگونه است؟');
    }
  }

  const requiredUnavailable = classification.requiresToolTruth
    && evidence.length > 0
    && evidence.every((e) => e.status !== 'observed');

  const highConflictCount = contradictions.filter((c) => c.severity === 'HIGH' || c.severity === 'CRITICAL').length;
  const uncertaintyScore = clamp(
    (missingSlots.length * 32)
    + (requiredUnavailable ? 45 : 0)
    + (highConflictCount * 18),
    0,
    100
  );

  const needsClarification = missingSlots.length > 0 && uncertaintyScore >= 30;

  if (!needsClarification && highConflictCount > 0 && questions.length === 0) {
    questions.push('با توجه به اختلاف سیگنال‌های کوتاه‌مدت و ریسک، آیا تمایل دارید تحلیل بر اساس افق بلندمدت و ورود پله‌ای (DCA) محدود شود؟');
  }

  return {
    uncertaintyScore,
    isUncertain: uncertaintyScore >= 40,
    requiredDataUnavailable: requiredUnavailable,
    required: needsClarification,
    missingSlots,
    questions
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  COMPLETE CENTRAL BRAIN ENGINE (`createCentralBrain`)                      */
/* ────────────────────────────────────────────────────────────────────────── */

export function createCentralBrain({
  smartMemory = null,
  performanceLearning = null,
  adaptiveCouncil = null,
  toolRunner = null,       // async (toolName, args, ctx) => { status, summary, ms }
  providerInvoker = null,  // async ({ provider, model, prompt, agentId, timeoutMs }) => { text, stance, confidence, model }
  availableProviders = null,
  maxTracesPerOwner = 60,
  now = () => Date.now()
} = {}) {
  const memory = smartMemory || createSmartMemory({ now });
  const learning = performanceLearning || createPerformanceLearning({ smartMemory: memory, now });
  const council = adaptiveCouncil || createAdaptiveCouncil({ smartMemory: memory, performanceLearning: learning, now });

  const providerHealth = new Map(); // provider -> { failures, successes, openUntil, lastError }
  const tracesByOwner = new Map();  // owner -> trace[]
  let runSeq = 0;

  function getHealthMap() {
    const ts = now();
    const out = {};
    for (const id of Object.keys(MODEL_FLEET_CATALOGUE)) {
      const h = providerHealth.get(id);
      if (!h) {
        out[id] = { healthy: true, errorRate: 0, failures: 0, successes: 0 };
      } else {
        const total = Math.max(1, h.failures + h.successes);
        out[id] = {
          healthy: h.openUntil <= ts,
          errorRate: h.failures / total,
          failures: h.failures,
          successes: h.successes,
          lastError: h.lastError
        };
      }
    }
    return out;
  }

  function recordProviderFailure(provider, errMsg) {
    const h = providerHealth.get(provider) || { failures: 0, successes: 0, openUntil: 0, lastError: null };
    h.failures += 1;
    h.lastError = errMsg;
    if (h.failures >= 2) h.openUntil = now() + 30_000;
    providerHealth.set(provider, h);
  }

  function recordProviderSuccess(provider) {
    const h = providerHealth.get(provider) || { failures: 0, successes: 0, openUntil: 0, lastError: null };
    h.successes += 1;
    h.openUntil = 0;
    providerHealth.set(provider, h);
  }

  function saveTrace(owner, traceRecord) {
    const key = owner || 'anon';
    const list = tracesByOwner.get(key) || [];
    list.push(traceRecord);
    while (list.length > maxTracesPerOwner) list.shift();
    tracesByOwner.set(key, list);
  }

  return {
    schema: CENTRAL_BRAIN_SCHEMA,
    version: CENTRAL_BRAIN_VERSION,
    smartMemory: memory,
    performanceLearning: learning,
    adaptiveCouncil: council,

    /** Zero-LLM-cost inspection of how the Central Brain understands & plans a request. */
    async understand({ owner = 'anon', message = '' } = {}) {
      if (containsSensitiveKeyOrPhrase(message)) {
        return { ok: false, error: 'SENSITIVE_INPUT_REFUSED', executionAuthorized: false };
      }
      const userProfile = await memory.getUserProfile(owner);
      const classification = classifyRequest(message, { userProfile });
      const guidance = learning.buildDecisionGuidance({
        owner,
        asset: classification.entities.assets[0] || null,
        taskType: classification.category,
        candidateProviders: availableProviders || Object.keys(MODEL_FLEET_CATALOGUE)
      });
      const decomposition = decomposeTask({ classification, message, learningGuidance: guidance });
      const modelPlan = selectOptimalModels({
        classification,
        subTasks: decomposition.subTasks,
        availableProviders,
        providerHealth: getHealthMap(),
        trustWeights: guidance.modelTrustWeights
      });
      const uncertainty = assessUncertaintyAndClarify({
        classification,
        message,
        userProfile
      });

      return {
        ok: true,
        schema: CENTRAL_BRAIN_SCHEMA,
        classification,
        decomposition,
        modelPlan,
        uncertainty,
        learningGuidance: guidance,
        executionAuthorized: false
      };
    },

    /**
     * Full 10-stage Central Brain execution pipeline with complete decision trace.
     */
    async run({
      owner = 'anon',
      sessionId = null,
      message = '',
      preloadedEvidence = null, // optional pre-gathered evidence rows
      forceCouncilMembers = null,
      recordTurnMemory = true
    } = {}) {
      const startedAt = now();
      runSeq += 1;
      const runId = `cb_${startedAt.toString(36)}_${runSeq}`;
      const stages = [];

      const recordStage = (stageName, stageStarted, details, status = 'completed') => {
        stages.push({
          step: stages.length + 1,
          stage: stageName,
          status,
          durationMs: Math.max(0, now() - stageStarted),
          details: clipDeep(redactSecrets(details), 360)
        });
      };

      // Safety gate: never process or store private keys / seed phrases
      if (containsSensitiveKeyOrPhrase(message)) {
        recordStage('SAFETY_GATE', startedAt, { reason: 'SENSITIVE_CREDENTIAL_DETECTED' }, 'blocked');
        const blockedTrace = { runId, owner, at: startedAt, durationMs: now() - startedAt, stages };
        saveTrace(owner, blockedTrace);
        return {
          ok: false,
          runId,
          error: 'SENSITIVE_INPUT_REFUSED',
          answer: 'به‌منظور حفاظت از دارایی شما، عبارت بازیابی یا کلید خصوصی هرگز پردازش یا ذخیره نمی‌شود. هیچ کلیدی را در چت وارد نکنید.',
          decisionTrace: blockedTrace,
          executionAuthorized: false,
          canExecute: false,
          canSign: false,
          canMoveFunds: false
        };
      }

      // ── STAGE 1: تشخیص هوشمند نوع درخواست (Request Understanding) ──
      let t0 = now();
      const userProfile = await memory.getUserProfile(owner);
      const classification = classifyRequest(message, { userProfile });
      recordStage('1_REQUEST_CLASSIFICATION', t0, {
        category: classification.category,
        complexity: classification.complexity,
        complexityScore: classification.complexityScore,
        costBudget: classification.costBudget,
        entities: classification.entities,
        requiredTools: classification.requiredTools
      });

      // ── STAGE 2: بازیابی به‌موقع حافظه معنایی و سوابق یادگیری (Memory & Learning Recall) ──
      t0 = now();
      const guidance = learning.buildDecisionGuidance({
        owner,
        asset: classification.entities.assets[0] || null,
        taskType: classification.category,
        candidateProviders: availableProviders || Object.keys(MODEL_FLEET_CATALOGUE)
      });
      const decomposition = decomposeTask({
        classification,
        message,
        learningGuidance: guidance,
        forceCouncilMembers
      });
      const activeAgentIds = decomposition.subTasks.map((t) => t.agentId);
      const memoryContext = await memory.contextualRecall({
        owner,
        query: message,
        intentType: classification.category,
        entities: { assets: classification.entities.assets },
        activeAgents: activeAgentIds,
        sessionId
      });
      recordStage('2_CONTEXTUAL_MEMORY_AND_LEARNING_RECALL', t0, {
        goalsCount: memoryContext.userProfile?.goals?.length || 0,
        preferencesCount: memoryContext.userProfile?.preferences?.length || 0,
        recalledConversations: memoryContext.relevantConversations?.length || 0,
        recalledDecisions: memoryContext.pastDecisions?.length || 0,
        pastWarningsCount: memoryContext.relevantExperiences?.warnings?.length || 0,
        activePolicyVersion: guidance.currentPolicyVersion
      });

      // ── STAGE 3: انتخاب خودکار مدل‌ها و تقسیم وظایف (Model Selection & Task Decomposition) ──
      t0 = now();
      const modelPlan = selectOptimalModels({
        classification,
        subTasks: decomposition.subTasks,
        availableProviders,
        providerHealth: getHealthMap(),
        trustWeights: guidance.modelTrustWeights
      });
      recordStage('3_MODEL_SELECTION_AND_TASK_DECOMPOSITION', t0, {
        maxModelBudget: modelPlan.maxModelBudget,
        selectedModelCount: modelPlan.selectedModels.length,
        selectedModels: modelPlan.selectedModels.map((m) => ({ provider: m.provider, model: m.model, costUnits: m.costUnits, trustWeight: m.trustWeight })),
        skippedModelCount: modelPlan.skippedModels.length,
        skippedSample: modelPlan.skippedModels.slice(0, 4),
        subTaskCount: decomposition.subTasks.length,
        subTasks: decomposition.subTasks.map((t) => ({ taskId: t.taskId, agentId: t.agentId, wave: t.wave }))
      });

      // ── STAGE 4: گردآوری داده‌های ابزاری خواندنی (Read-Only Tool Gathering) ──
      t0 = now();
      let evidence = Array.isArray(preloadedEvidence) ? [...preloadedEvidence] : [];
      if (!preloadedEvidence && typeof toolRunner === 'function' && classification.requiredTools.length > 0) {
        const toolTasks = classification.requiredTools.map((toolName) => ({
          taskId: `tool_${toolName}`,
          agentId: 'tool_broker',
          toolName
        }));
        const gathered = await executeAgentsConcurrently(
          toolTasks,
          async (tt) => toolRunner(tt.toolName, { symbols: classification.entities.assets, owner }, { owner }),
          { maxConcurrency: 4, taskTimeoutMs: 3500 }
        );
        evidence = gathered.map((g, idx) => {
          const toolName = classification.requiredTools[idx];
          const facetMap = {
            fbt_get_market_snapshot: 'market_prices',
            fbt_get_signals: 'smart_money',
            fbt_get_news: 'news_flow',
            fbt_get_macro_snapshot: 'macro_state',
            fbt_get_yields: 'yield_rates',
            fbt_get_portfolio: 'portfolio_state',
            fbt_get_wallet_state: 'wallet_state',
            fbt_get_quote_preview: 'venue_quote'
          };
          if (!g.ok || !g.output) {
            return { facetId: facetMap[toolName] || toolName, tool: toolName, status: 'unavailable', error: g.error || 'TOOL_FAILED' };
          }
          return {
            facetId: g.output.facetId || facetMap[toolName] || toolName,
            tool: toolName,
            status: g.output.status || (g.output.ok === false ? 'unavailable' : 'observed'),
            summary: g.output.summary ?? g.output.data ?? g.output,
            ms: g.durationMs
          };
        });
      }
      recordStage('4_TOOL_EVIDENCE_GATHERING', t0, {
        requestedTools: classification.requiredTools,
        observedCount: evidence.filter((e) => e.status === 'observed').length,
        unavailableCount: evidence.filter((e) => e.status !== 'observed').length
      });

      // ── STAGE 5: ارزیابی عدم اطمینان اولیه (Initial Uncertainty Check) ──
      t0 = now();
      const preUncertainty = assessUncertaintyAndClarify({
        classification,
        message,
        userProfile: memoryContext.userProfile,
        evidence
      });
      recordStage('5_PRE_EXECUTION_UNCERTAINTY_CHECK', t0, preUncertainty);

      // ── STAGE 6: اجرای هم‌زمان ایجنت‌ها / شورای هوش مصنوعی تطبیقی + Failover ──
      t0 = now();
      const failoverEvents = [];

      const modelExecutor = typeof providerInvoker === 'function' && modelPlan.selectedModels.length > 0
        ? async ({ member, baseline }) => {
          const taskId = `task_${member.id}`;
          const assignment = modelPlan.taskAssignments[taskId] || Object.values(modelPlan.taskAssignments)[0];
          if (!assignment) return null;
          const prompt = [
            `نقش تخصصی شما: ${member.roleFa} (${member.roleEn})`,
            `سؤال کاربر: ${redactSecrets(message)}`,
            memoryContext.promptSummary ? `حافظه مرتبط کاربر:\n${memoryContext.promptSummary}` : '',
            `ارزیابی پایه مبتنی بر داده‌های واقعی ابزار: ${baseline.summary}`,
            'بر اساس داده‌های مشاهده‌شده و بدون جعل هیچ عدد جدیدی، جمع‌بندی کوتاه و دقیق تخصصی ارائه دهید.'
          ].filter(Boolean).join('\n\n');

          const res = await executeWithProviderFailover({
            assignment,
            invokeProvider: providerInvoker,
            prompt,
            agentId: member.id,
            onProviderError: (prov, err) => recordProviderFailure(prov, err)
          });
          if (res.ok) recordProviderSuccess(res.provider);
          if (res.failoverUsed) {
            failoverEvents.push({
              agentId: member.id,
              attemptedProviders: res.attemptedProviders,
              finalProvider: res.provider,
              errorTrail: res.errorTrail
            });
          }
          return res.ok
            ? {
              summary: res.text,
              stance: res.stance || baseline.stance,
              confidence: res.confidence ?? baseline.confidence,
              provider: res.provider,
              model: res.model,
              failoverUsed: res.failoverUsed,
              attemptedProviders: res.attemptedProviders
            }
            : {
              summary: baseline.summary,
              stance: baseline.stance,
              confidence: baseline.confidence,
              provider: res.provider,
              model: res.model,
              failoverUsed: res.failoverUsed,
              attemptedProviders: res.attemptedProviders
            };
        }
        : null;

      let councilReport = null;
      let agentOutputs = [];

      if (decomposition.councilPlan.councilRequired) {
        councilReport = await council.convene({
          owner,
          sessionId,
          question: message,
          classification,
          evidence,
          memoryContext,
          learningGuidance: guidance,
          modelExecutor,
          forceMembers: forceCouncilMembers,
          clarificationNeeded: preUncertainty
        });
        agentOutputs = councilReport.memberOpinions || [];
      } else {
        // Fast single-agent / zero-model path for TRIVIAL & SIMPLE requests!
        const directTask = decomposition.subTasks[0];
        const assignment = modelPlan.taskAssignments[directTask.taskId];
        let directText = '';
        let usedProvider = 'deterministic-direct';
        let usedModel = 'fbt-fast-path-v2';
        let failoverUsed = false;
        let attemptedProviders = [];

        if (preUncertainty.required) {
          directText = preUncertainty.questions.join(' ');
        } else if (preUncertainty.requiredDataUnavailable) {
          directText = 'ابزار خوانش داده موردنیاز در این لحظه پاسخ نداد؛ برای جلوگیری از ارائه عدد نادرست، لطفاً لحظاتی دیگر تلاش کنید.';
        } else if (assignment && typeof providerInvoker === 'function') {
          const prompt = [
            `سؤال کاربر: ${redactSecrets(message)}`,
            memoryContext.promptSummary ? `حافظه مرتبط کاربر:\n${memoryContext.promptSummary}` : '',
            evidence.filter((e) => e.status === 'observed').length
              ? `داده‌های مشاهده‌شده: ${JSON.stringify(evidence.filter((e) => e.status === 'observed').map((e) => ({ facet: e.facetId, summary: e.summary })))}`
              : ''
          ].filter(Boolean).join('\n');
          const res = await executeWithProviderFailover({
            assignment,
            invokeProvider: providerInvoker,
            prompt,
            agentId: directTask.agentId,
            onProviderError: (prov, err) => recordProviderFailure(prov, err)
          });
          if (res.ok) {
            recordProviderSuccess(res.provider);
            directText = res.text;
            usedProvider = res.provider;
            usedModel = res.model;
          }
          failoverUsed = res.failoverUsed;
          attemptedProviders = res.attemptedProviders;
          if (res.failoverUsed) {
            failoverEvents.push({
              agentId: directTask.agentId,
              attemptedProviders: res.attemptedProviders,
              finalProvider: res.provider,
              errorTrail: res.errorTrail
            });
          }
        }

        if (!directText) {
          const obsPrice = evidence.find((e) => e.facetId === 'market_prices' && e.status === 'observed');
          if (classification.category === 'SOCIAL_CHITCHAT') {
            directText = 'سلام! مغز مرکزی FBT آماده تحلیل بازار، بررسی ریسک، مدیریت اهداف مالی و پاسخ به پرسش‌های شماست.';
          } else if (obsPrice) {
            const sym = classification.entities.assets[0] || 'بازار';
            const rows = Array.isArray(obsPrice.summary?.assets) ? obsPrice.summary.assets : [];
            const row = rows.find((r) => String(r.symbol || '').toUpperCase() === sym) || rows[0];
            directText = row?.price
              ? `بر اساس خوانش لحظه‌ای بازار، قیمت ${row.symbol || sym} حدود $${row.price} است${Number.isFinite(Number(row.change24h)) ? ` (تغییر ۲۴ساعته: ${row.change24h}%)` : ''}.`
              : `خلاصه داده بازار مشاهده شد: ${JSON.stringify(obsPrice.summary).slice(0, 220)}`;
          } else {
            directText = `درخواست شما (${classification.category}) در مسیر بهینه بررسی شد.${memoryContext.userProfile?.preferences?.length ? ' ترجیحات ذخیره‌شده شما در نظر گرفته شد.' : ''}`;
          }
        }

        agentOutputs = [{
          memberId: directTask.agentId,
          agentId: directTask.agentId,
          roleFa: directTask.roleFa,
          stance: preUncertainty.required ? 'uncertain' : 'neutral',
          action: preUncertainty.required ? 'CLARIFY' : (preUncertainty.requiredDataUnavailable ? 'ABSTAIN' : 'ANSWER'),
          confidence: preUncertainty.required ? 35 : (preUncertainty.requiredDataUnavailable ? 20 : 78),
          summary: directText,
          evidenceCited: evidence.filter((e) => e.status === 'observed').map((e) => e.facetId),
          provider: usedProvider,
          model: usedModel,
          failoverUsed,
          attemptedProviders
        }];
      }
      recordStage('6_CONCURRENT_AGENT_EXECUTION_AND_FAILOVER', t0, {
        executedAgentCount: agentOutputs.length,
        councilConvened: Boolean(councilReport?.councilConvened),
        failoverCount: failoverEvents.length,
        failoverEvents
      });

      // ── STAGE 7: مقایسه نتایج ایجنت‌ها و شناسایی تناقض‌ها ──
      t0 = now();
      const comparison = compareAgentResults(agentOutputs);
      const contradictions = detectContradictions({
        agentOutputs,
        evidence,
        userProfile: memoryContext.userProfile
      });
      recordStage('7_AGENT_COMPARISON_AND_CONTRADICTION_DETECTION', t0, {
        comparedCount: comparison.comparedCount,
        agreementScore: comparison.agreementScore,
        contradictionsFound: contradictions.length,
        contradictions
      });

      // ── STAGE 8: انتخاب نتیجه بر اساس شواهد و اعتبار منابع + تشخیص نهایی عدم اطمینان ──
      t0 = now();
      const trustSnapshot = learning.getTrustWeights();
      const evidenceSelection = selectEvidenceBasedResult({
        agentOutputs,
        evidence,
        contradictions,
        trustWeights: trustSnapshot
      });
      const finalUncertainty = assessUncertaintyAndClarify({
        classification,
        message,
        userProfile: memoryContext.userProfile,
        evidence,
        contradictions
      });
      recordStage('8_EVIDENCE_CREDIBILITY_SELECTION_AND_UNCERTAINTY', t0, {
        topCredibleAgent: evidenceSelection.winner?.agentId || null,
        topCompositeScore: evidenceSelection.winner?.compositeScore || null,
        uncertaintyScore: finalUncertainty.uncertaintyScore,
        clarificationRequired: finalUncertainty.required
      });

      // ── STAGE 9: سنتز خروجی نهایی (Final Verdict Assembly) ──
      t0 = now();
      let finalAction = councilReport?.finalDecision?.action || agentOutputs[0]?.action || 'ANSWER';
      let finalStance = councilReport?.finalDecision?.stance || agentOutputs[0]?.stance || 'neutral';
      let finalConfidence = councilReport?.confidence?.score ?? agentOutputs[0]?.confidence ?? 70;
      let answer = councilReport?.finalDecision?.summary || agentOutputs[0]?.summary || '';

      if (finalUncertainty.required) {
        finalAction = 'CLARIFY';
        finalStance = 'uncertain';
        finalConfidence = Math.min(42, finalConfidence);
        answer = `برای ارائه تحلیل و تصمیم دقیق، نیاز به اطلاعات تکمیلی دارم:\n• ${finalUncertainty.questions.join('\n• ')}`;
      } else if (finalUncertainty.requiredDataUnavailable) {
        finalAction = 'ABSTAIN';
        finalStance = 'abstain';
        finalConfidence = Math.min(25, finalConfidence);
        answer = 'داده واقعی موردنیاز (کیف‌پول/پرتفوی/قیمت) در حال حاضر از ابزار خوانده نشد؛ بر اساس قوانین ایمنی FBT از حدس زدن ارقام خودداری می‌شود.';
      }

      recordStage('9_FINAL_VERDICT', t0, {
        finalAction,
        finalStance,
        finalConfidence
      });

      // ── STAGE 10: ثبت در حافظه معنایی بلندمدت و لاگ پیش‌بینی برای یادگیری ──
      t0 = now();
      let recordedPredictionId = null;
      if (recordTurnMemory && message.trim()) {
        await memory.rememberConversation({
          owner,
          userMessage: message,
          assistantReply: answer,
          intentType: classification.category,
          assets: classification.entities.assets,
          sessionId,
          lang: classification.language,
          autoExtractTraits: true
        });

        if (councilReport?.councilConvened || ['TRADING_STRATEGY', 'TECHNICAL_ANALYSIS', 'MULTI_DOMAIN_COMPLEX', 'SMART_MONEY_FLOW'].includes(classification.category)) {
          const mktEv = evidence.find((e) => e.facetId === 'market_prices' && e.status === 'observed');
          const primarySym = classification.entities.assets[0] || null;
          const mktRows = Array.isArray(mktEv?.summary?.assets) ? mktEv.summary.assets : [];
          const entryPrice = Number(mktRows.find((r) => String(r.symbol || '').toUpperCase() === primarySym)?.price || NaN);

          await memory.rememberDecision({
            owner,
            question: message,
            assets: classification.entities.assets,
            verdict: finalAction,
            stance: finalStance,
            confidence: finalConfidence,
            summary: answer,
            reasons: councilReport?.decisionReasons || [answer.slice(0, 160)],
            entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
            specialists: agentOutputs.map((a) => a.memberId || a.agentId)
          });

          if (primarySym && !['CLARIFY', 'ABSTAIN'].includes(finalAction)) {
            const predRes = await learning.recordPrediction({
              owner,
              question: message,
              asset: primarySym,
              taskType: classification.category,
              predictedDirection: finalStance,
              confidence: finalConfidence,
              entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
              evidenceQuality: evidence.length ? evidence.filter((e) => e.status === 'observed').length / evidence.length : 0.6,
              modelVotes: agentOutputs
                .filter((a) => a.provider && !a.provider.startsWith('fbt-council'))
                .map((a) => ({ provider: a.provider, model: a.model, direction: a.stance, confidence: a.confidence })),
              agentVotes: agentOutputs.map((a) => ({ agentId: a.memberId || a.agentId, direction: a.stance, confidence: a.confidence, summary: a.summary }))
            });
            if (predRes.ok) recordedPredictionId = predRes.predictionId;
          }
        }
      }
      recordStage('10_MEMORY_AND_LEARNING_COMMIT', t0, {
        conversationSaved: Boolean(recordTurnMemory && message.trim()),
        recordedPredictionId
      });

      const decisionTrace = {
        runId,
        owner,
        at: startedAt,
        totalDurationMs: Math.max(0, now() - startedAt),
        stageCount: stages.length,
        stages
      };
      saveTrace(owner, decisionTrace);

      return {
        ok: true,
        schema: CENTRAL_BRAIN_SCHEMA,
        version: CENTRAL_BRAIN_VERSION,
        runId,
        answer,
        classification,
        modelSelection: {
          maxModelBudget: modelPlan.maxModelBudget,
          selectedModels: modelPlan.selectedModels,
          skippedModels: modelPlan.skippedModels,
          estimatedCostUnits: modelPlan.estimatedCostUnits
        },
        taskDecomposition: decomposition.subTasks,
        agentComparison: comparison,
        contradictions,
        evidenceSelection,
        uncertainty: finalUncertainty,
        failoverEvents,
        council: councilReport,
        memoryContextUsed: {
          hasRelevantContext: memoryContext.hasRelevantContext,
          goalsCount: memoryContext.userProfile?.goals?.length || 0,
          preferencesCount: memoryContext.userProfile?.preferences?.length || 0,
          recalledConversationsCount: memoryContext.relevantConversations?.length || 0,
          pastDecisionsCount: memoryContext.pastDecisions?.length || 0,
          warningsCount: memoryContext.relevantExperiences?.warnings?.length || 0
        },
        learning: {
          policyVersion: guidance.currentPolicyVersion,
          recordedPredictionId
        },
        decision: {
          action: finalAction,
          stance: finalStance,
          confidence: finalConfidence,
          clarificationQuestions: finalUncertainty.questions
        },
        decisionTrace,
        // Mandatory non-custodial safety flags
        executionAuthorized: false,
        canExecute: false,
        canSign: false,
        canMoveFunds: false
      };
    },

    getTraces({ owner = null, limit = 20 } = {}) {
      if (owner) {
        return (tracesByOwner.get(owner) || []).slice(-Math.max(1, limit)).reverse();
      }
      const all = [];
      for (const list of tracesByOwner.values()) all.push(...list);
      return all.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, Math.max(1, limit));
    },

    async status(owner = null) {
      const memStats = await memory.stats(owner);
      const learnSummary = learning.summary({ owner });
      return {
        ok: true,
        schema: CENTRAL_BRAIN_SCHEMA,
        version: CENTRAL_BRAIN_VERSION,
        capabilities: [
          '1_intelligent_request_classification',
          '2_cost_complexity_optimal_model_selection',
          '3_multi_agent_task_decomposition',
          '4_concurrent_agent_execution',
          '5_agent_result_comparison',
          '6_contradiction_detection',
          '7_evidence_credibility_selection',
          '8_uncertainty_and_clarification',
          '9_provider_error_failover',
          '10_complete_decision_trace'
        ],
        fleetHealth: getHealthMap(),
        councilSpecialists: Object.values(COUNCIL_ROSTER).map((r) => ({
          id: r.id,
          wave: r.wave,
          roleFa: r.roleFa,
          roleEn: r.roleEn
        })),
        memory: memStats,
        learning: learnSummary,
        laws: {
          neverCallsAllModelsUnnecessarily: true,
          baseModelsModified: false,
          executionAuthorized: false,
          canExecute: false,
          canSign: false,
          canMoveFunds: false
        }
      };
    }
  };
}

export default createCentralBrain;
