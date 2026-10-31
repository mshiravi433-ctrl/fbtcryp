/**
 * FBT AI — ADAPTIVE AI COUNCIL (Section 4 — شورای هوش مصنوعی تطبیقی)
 * ---------------------------------------------------------------------------
 * 8 Specialized Council Roles, dynamically selected per request by the Central
 * Brain based on request type, domain signals, stakes, and cost budget:
 *
 *   1. `technical_analyst`           — تحلیلگر تکنیکال
 *   2. `onchain_analyst`             — تحلیلگر آن‌چین
 *   3. `smart_money_analyst`         — تحلیلگر اسمارت‌مانی
 *   4. `macro_news_analyst`          — تحلیلگر اخبار و اقتصاد کلان
 *   5. `risk_specialist`             — متخصص مدیریت ریسک
 *   6. `trading_strategy_specialist` — متخصص استراتژی معاملاتی
 *   7. `decision_critic`             — منتقد تصمیم‌ها
 *   8. `final_arbiter`               — داور نهایی
 *
 * Wave execution topology:
 *   • Wave 1 (Concurrent): Selected domain & risk/strategy specialists (1..6)
 *   • Wave 2 (Adversarial Audit): `decision_critic` challenges Wave 1 outputs,
 *     checks contradictions, unsupported claims, user constraints & past mistakes
 *   • Wave 3 (Synthesis & Verdict): `final_arbiter` weighs evidence credibility
 *     + learned agent/model trust weights + Critic's audit to render final output
 *
 * Guaranteed structured output fields:
 *   • `memberOpinions`       (نظر هر متخصص)
 *   • `evidenceUsed`         (شواهد و داده‌های استفاده‌شده)
 *   • `pointsOfAgreement`    (نقاط توافق)
 *   • `pointsOfDisagreement` (نقاط اختلاف)
 *   • `confidence`           (سطح اطمینان)
 *   • `finalDecision`        (تصمیم نهایی)
 *   • `decisionReasons`      (دلایل تصمیم)
 */

import { redactSecrets } from './redact.js';

export const ADAPTIVE_COUNCIL_SCHEMA = 'fbt.adaptive-council.v1';

export const COUNCIL_ROSTER = Object.freeze({
  technical_analyst: {
    id: 'technical_analyst',
    wave: 1,
    roleFa: 'تحلیلگر تکنیکال',
    roleEn: 'Technical Analyst',
    preferredSpecialty: 'quant_technical',
    facets: ['market_prices', 'asset_regime'],
    tools: ['fbt_get_market_snapshot'],
    descriptionFa: 'بررسی روند قیمت، مومنتوم ۲۴ساعته/هفتگی، نوسان و رژیم تکنیکال بازار'
  },
  onchain_analyst: {
    id: 'onchain_analyst',
    wave: 1,
    roleFa: 'تحلیلگر آن‌چین',
    roleEn: 'On-Chain Analyst',
    preferredSpecialty: 'onchain_defi',
    facets: ['yield_rates', 'wallet_state', 'venue_quote'],
    tools: ['fbt_get_yields', 'fbt_get_wallet_state', 'fbt_get_quote_preview'],
    descriptionFa: 'تحلیل داده‌های درون‌زنجیره‌ای، نقدینگی استخرها، بازده دیفای و وضعیت شبکه'
  },
  smart_money_analyst: {
    id: 'smart_money_analyst',
    wave: 1,
    roleFa: 'تحلیلگر اسمارت‌مانی',
    roleEn: 'Smart Money Analyst',
    preferredSpecialty: 'smart_money_flow',
    facets: ['smart_money', 'market_prices'],
    tools: ['fbt_get_signals'],
    descriptionFa: 'ردیابی جریان پول هوشمند، انباشت یا توزیع نهنگ‌ها و سیگنال‌های کیف‌پول‌های برتر'
  },
  macro_news_analyst: {
    id: 'macro_news_analyst',
    wave: 1,
    roleFa: 'تحلیلگر اخبار و اقتصاد کلان',
    roleEn: 'News & Macro Analyst',
    preferredSpecialty: 'macro_news',
    facets: ['news_flow', 'macro_state'],
    tools: ['fbt_get_news', 'fbt_get_macro_snapshot'],
    descriptionFa: 'بررسی اخبار اثرگذار، نرخ بهره، دلار، طلا و فضای ریسک‌پذیری اقتصاد کلان'
  },
  risk_specialist: {
    id: 'risk_specialist',
    wave: 1,
    roleFa: 'متخصص مدیریت ریسک',
    roleEn: 'Risk Management Specialist',
    preferredSpecialty: 'risk_safety',
    facets: ['portfolio_state', 'wallet_state', 'market_prices', 'asset_regime'],
    tools: ['fbt_get_portfolio', 'fbt_get_wallet_state', 'fbt_get_market_snapshot'],
    descriptionFa: 'ارزیابی ریسک نزولی، تمرکز سبد، خطر اهرم، نقدشوندگی و انطباق با پروفایل ریسک کاربر'
  },
  trading_strategy_specialist: {
    id: 'trading_strategy_specialist',
    wave: 1,
    roleFa: 'متخصص استراتژی معاملاتی',
    roleEn: 'Trading Strategy Specialist',
    preferredSpecialty: 'strategy_design',
    facets: ['market_prices', 'asset_regime', 'yield_rates', 'portfolio_state'],
    tools: ['fbt_get_market_snapshot', 'fbt_get_yields', 'fbt_get_portfolio'],
    descriptionFa: 'طراحی سناریوهای عملیاتی غیرامانی (ورود پله‌ای، DCA، ریبالانس، حد ابطال و سایز پوزیشن)'
  },
  decision_critic: {
    id: 'decision_critic',
    wave: 2,
    roleFa: 'منتقد تصمیم‌ها',
    roleEn: 'Decision Critic',
    preferredSpecialty: 'adversarial_critic',
    facets: [],
    tools: [],
    descriptionFa: 'نقد همتایان، کشف تناقض‌ها، شناسایی ادعاهای بدون شاهد و یادآوری خطاهای گذشته'
  },
  final_arbiter: {
    id: 'final_arbiter',
    wave: 3,
    roleFa: 'داور نهایی',
    roleEn: 'Final Arbiter',
    preferredSpecialty: 'synthesis_arbiter',
    facets: [],
    tools: [],
    descriptionFa: 'جمع‌بندی شواهد، وزن‌دهی بر اساس اعتبار منابع و سوابق اعتماد، و صدور تصمیم نهایی'
  }
});

export const COUNCIL_MEMBER_IDS = Object.freeze(Object.keys(COUNCIL_ROSTER));

const SOURCE_CREDIBILITY = Object.freeze({
  observed: 0.95,
  verified: 0.85,
  degraded: 0.55,
  skipped: 0.20,
  unavailable: 0.0
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function cleanText(s, max = 520) {
  const out = String(redactSecrets(String(s ?? ''))).trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/**
 * Dynamically select which Council specialists are needed for a given request.
 * Never selects all 8 blindly — justifies both `selectedMembers` and `skippedMembers`.
 */
export function selectCouncilMembers({
  classification = {},
  message = '',
  learningGuidance = null,
  forceMembers = null
} = {}) {
  if (Array.isArray(forceMembers) && forceMembers.length) {
    const valid = forceMembers.filter((id) => COUNCIL_ROSTER[id]);
    if (valid.length && !valid.includes('final_arbiter')) valid.push('final_arbiter');
    return {
      councilRequired: valid.length > 0,
      selectedMembers: valid.map((id) => ({
        memberId: id,
        roleFa: COUNCIL_ROSTER[id].roleFa,
        roleEn: COUNCIL_ROSTER[id].roleEn,
        wave: COUNCIL_ROSTER[id].wave,
        reason: 'EXPLICIT_OVERRIDE'
      })),
      skippedMembers: COUNCIL_MEMBER_IDS.filter((id) => !valid.includes(id)).map((id) => ({
        memberId: id,
        reason: 'NOT_IN_EXPLICIT_OVERRIDE'
      }))
    };
  }

  const complexity = classification.complexity || 'MODERATE';
  const category = classification.category || 'MULTI_DOMAIN_COMPLEX';
  const text = String(message || '').toLowerCase();

  // Trivial chitchat / simple single-price / static FAQ -> NO council needed!
  if (complexity === 'TRIVIAL' || ['SOCIAL_CHITCHAT', 'FACTUAL_KNOWLEDGE'].includes(category)) {
    return {
      councilRequired: false,
      selectedMembers: [],
      skippedMembers: COUNCIL_MEMBER_IDS.map((id) => ({
        memberId: id,
        reason: `COMPLEXITY_${complexity}_NO_COUNCIL_NEEDED`
      }))
    };
  }
  if (complexity === 'SIMPLE' && category === 'PRICE_LOOKUP') {
    return {
      councilRequired: false,
      selectedMembers: [],
      skippedMembers: COUNCIL_MEMBER_IDS.map((id) => ({
        memberId: id,
        reason: 'SINGLE_TOOL_PRICE_LOOKUP'
      }))
    };
  }

  const chosen = new Map(); // memberId -> reason
  const add = (id, reason) => { if (COUNCIL_ROSTER[id] && !chosen.has(id)) chosen.set(id, reason); };

  const cues = {
    technical: /(تکنیکال|نمودار|چارت|روند|نوسان|حمایت|مقاومت|مومنتوم|قیمت|بخرم|بفروشم|صعودی|نزولی|technical|chart|trend|rsi|macd|volatility|momentum|price|buy|sell)/i.test(message)
      || ['TECHNICAL_ANALYSIS', 'TRADING_STRATEGY', 'MULTI_DOMAIN_COMPLEX', 'PRICE_LOOKUP'].includes(category),
    onchain: /(آن[\s\u200c]*چین|درون[\s\u200c]*زنجیره|استیک|دیفای|بازده|سود\s*سپرده|تی[\s\u200c]*وی[\s\u200c]*ال|نقدینگی|گس|کارمزد\s*شبکه|سواپ|بریج|on[\s-]*chain|tvl|defi|yield|apy|staking|liquidity|gas|pool|swap|bridge)/i.test(message)
      || ['ONCHAIN_ANALYSIS', 'DEFI_YIELD', 'EXECUTION_PLANNING'].includes(category),
    smartMoney: /(اسمارت[\s\u200c]*مانی|پول\s*هوشمند|نهنگ|کیف[\s\u200c]*پول.*بزرگ|انباشت|توزیع|ورود\s*پول|سیگنال|smart[\s-]*money|whale|accumulation|distribution|inflow|outflow|signal)/i.test(message)
      || ['SMART_MONEY_FLOW', 'MULTI_DOMAIN_COMPLEX'].includes(category),
    macroNews: /(اخبار|خبر|اقتصاد\s*کلان|فدرال|نرخ\s*بهره|تورم|دلار|طلا|تحریم|قوانین|رگولاتوری|چرا\s*ریخت|چرا\s*رشد|news|macro|fed|fomc|cpi|inflation|dxy|gold|etf|regulation|why\s+did)/i.test(message)
      || ['MACRO_NEWS_IMPACT', 'MULTI_DOMAIN_COMPLEX'].includes(category),
    risk: /(ریسک|خطر|ضرر|زیان|اهرم|لوریج|سبد|پورتفولیو|امن|محافظه|کل\s*سرمایه|دارایی|دلار|بخرم|سرمایه[\s\u200c]*گذاری|risk|drawdown|leverage|portfolio|safe|exposure|all[\s-]*in|invest|buy|sell)/i.test(message)
      || ['RISK_ASSESSMENT', 'PORTFOLIO_AUDIT', 'TRADING_STRATEGY', 'DEFI_YIELD', 'EXECUTION_PLANNING', 'MULTI_DOMAIN_COMPLEX'].includes(category)
      || complexity === 'COMPLEX' || complexity === 'CRITICAL',
    strategy: /(استراتژی|برنامه|پله[\s\u200c]*ای|دی[\s\u200c]*سی[\s\u200c]*ای|تخصیص|ریبالانس|چه\s*کار\s*کنم|چطور\s*وارد|حد\s*ضرر|بخرم\s*یا|strategy|dca|plan|rebalance|allocate|entry|exit|stop[\s-]*loss|should\s+i|what\s+should)/i.test(message)
      || ['TRADING_STRATEGY', 'PORTFOLIO_AUDIT', 'EXECUTION_PLANNING', 'MULTI_DOMAIN_COMPLEX'].includes(category)
  };

  if (cues.technical) add('technical_analyst', 'TECHNICAL_AND_PRICE_REGIME_SIGNAL');
  if (cues.onchain) add('onchain_analyst', 'ONCHAIN_LIQUIDITY_OR_YIELD_SIGNAL');
  if (cues.smartMoney) add('smart_money_analyst', 'WHALE_AND_SMART_MONEY_FLOW_SIGNAL');
  if (cues.macroNews) add('macro_news_analyst', 'NEWS_AND_MACRO_REGIME_SIGNAL');
  if (cues.risk) add('risk_specialist', 'DOWNSIDE_AND_PORTFOLIO_RISK_GUARD');
  if (cues.strategy) add('trading_strategy_specialist', 'ACTIONABLE_STRATEGY_FORMULATION');

  // Ensure at least 2 domain/specialist voices when convening a council
  if (chosen.size === 0) {
    add('technical_analyst', 'DEFAULT_MARKET_BASELINE');
    add('risk_specialist', 'DEFAULT_RISK_BASELINE');
  } else if (chosen.size === 1) {
    if (!chosen.has('risk_specialist')) add('risk_specialist', 'COMPLEMENTARY_RISK_CHECK');
    else add('technical_analyst', 'COMPLEMENTARY_MARKET_CONTEXT');
  }

  // Dynamic Critic selection: convened on COMPLEX/CRITICAL stakes, strategy/capital decisions, or past learning mistakes
  if (
    complexity === 'COMPLEX'
    || complexity === 'CRITICAL'
    || chosen.size >= 4
    || Boolean(learningGuidance?.requireCritic)
    || /(نقد|مقایسه|تناقض|ریسک\s*بالا|اهرم|کل\s*پول|all[\s-]*in|leverage|critic|compare)/i.test(text)
  ) {
    add('decision_critic', learningGuidance?.requireCritic ? 'PAST_MISTAKE_GUARD_REQUIRED' : 'HIGH_STAKES_ADVERSARIAL_AUDIT');
  }

  // Final Arbiter is always present when a council convenes to synthesize & arbitrate
  add('final_arbiter', 'EVIDENCE_WEIGHTED_FINAL_ARBITRATION');

  const selectedMembers = COUNCIL_MEMBER_IDS
    .filter((id) => chosen.has(id))
    .map((id) => ({
      memberId: id,
      roleFa: COUNCIL_ROSTER[id].roleFa,
      roleEn: COUNCIL_ROSTER[id].roleEn,
      wave: COUNCIL_ROSTER[id].wave,
      reason: chosen.get(id)
    }));

  const skippedMembers = COUNCIL_MEMBER_IDS
    .filter((id) => !chosen.has(id))
    .map((id) => ({
      memberId: id,
      roleFa: COUNCIL_ROSTER[id].roleFa,
      reason: complexity === 'MODERATE' || complexity === 'SIMPLE'
        ? 'DOMAIN_NOT_REQUIRED_COST_OPTIMIZED'
        : 'DOMAIN_NOT_PERTINENT_TO_REQUEST'
    }));

  return {
    councilRequired: true,
    selectedMembers,
    skippedMembers
  };
}

/* ───────────────────── Specialist Deterministic Grounding ───────────────── */

function findFacet(evidence = [], facetIds = []) {
  return evidence.filter((e) => facetIds.includes(e.facetId));
}

function extractMarketSnapshot(evidence = [], primaryAsset = null) {
  const m = evidence.find((e) => e.facetId === 'market_prices' && e.status === 'observed');
  const a = evidence.find((e) => e.facetId === 'asset_regime' && e.status === 'observed');
  const rows = Array.isArray(m?.summary?.assets)
    ? m.summary.assets
    : (Array.isArray(m?.summary?.top) ? m.summary.top : (Array.isArray(m?.summary) ? m.summary : []));
  let target = null;
  if (primaryAsset && rows.length) {
    target = rows.find((r) => String(r.symbol || r.id || '').toUpperCase() === primaryAsset) || rows[0];
  } else if (rows.length) {
    target = rows[0];
  }
  const price = Number(target?.price ?? target?.priceUsd ?? a?.summary?.price ?? m?.summary?.btcPrice ?? NaN);
  const change24h = Number(target?.change24h ?? target?.changePct24h ?? a?.summary?.change24h ?? NaN);
  const regime = a?.summary?.regime || m?.summary?.regime || null;
  return {
    observed: Boolean(m || a),
    symbol: target?.symbol || primaryAsset || 'MARKET',
    price: Number.isFinite(price) ? price : null,
    change24h: Number.isFinite(change24h) ? change24h : null,
    regime
  };
}

function buildDomainSpecialistBaseline(memberId, {
  question,
  primaryAsset,
  evidence = [],
  userProfile = {},
  agentPrivateRows = [],
  sharedRows = [],
  pastWarnings = []
}) {
  const mkt = extractMarketSnapshot(evidence, primaryAsset);
  const cited = [];
  const markCited = (e) => { if (e?.facetId && !cited.includes(e.facetId)) cited.push(e.facetId); };

  if (memberId === 'technical_analyst') {
    findFacet(evidence, ['market_prices', 'asset_regime']).forEach((e) => { if (e.status === 'observed') markCited(e); });
    if (!mkt.observed) {
      return {
        stance: 'neutral',
        action: 'HOLD_WAIT',
        confidence: 38,
        summary: `داده زنده قیمت/رژیم برای ${primaryAsset || 'بازار'} در دسترس نیست؛ بدون کندل و قیمت تأییدشده سیگنال تکنیکال صادر نمی‌شود.`,
        keyArguments: ['عدم دسترسی به فید قیمت لحظه‌ای (No observed price feed)'],
        risks: ['ورود کور بدون داده قیمت و نوسان لحظه‌ای'],
        evidenceCited: cited
      };
    }
    const chg = mkt.change24h ?? 0;
    const stance = chg >= 1.8 ? 'bullish' : chg <= -1.8 ? 'bearish' : 'neutral';
    const action = stance === 'bullish' ? 'FAVORABLE_STAGED' : stance === 'bearish' ? 'HOLD_WAIT' : 'HOLD_WAIT';
    const conf = clamp(58 + Math.min(20, Math.round(Math.abs(chg) * 2.5)), 45, 82);
    const priceTxt = mkt.price !== null ? `$${mkt.price}` : 'خوانده‌شده';
    const chgTxt = mkt.change24h !== null ? `${mkt.change24h >= 0 ? '+' : ''}${mkt.change24h.toFixed(2)}%` : 'خنثی';
    return {
      stance,
      action,
      confidence: conf,
      summary: `بررسی تکنیکال ${mkt.symbol}: قیمت فعلی ${priceTxt} با تغییر ۲۴ساعته ${chgTxt}${mkt.regime ? ` (رژیم: ${mkt.regime})` : ''}. ${stance === 'bullish' ? 'مومنتوم کوتاه‌مدت مثبت است اما ورود پله‌ای ارجح است.' : stance === 'bearish' ? 'فشار فروش غالب است؛ صبر تا تثبیت حمایت توصیه می‌شود.' : 'بازار در محدوده نوسانی/تجمیع قرار دارد.'}`,
      keyArguments: [
        `قیمت مشاهده‌شده ${mkt.symbol}: ${priceTxt} (تغییر ۲۴ساعته: ${chgTxt})`,
        mkt.regime ? `رژیم تکنیکال ثبت‌شده: ${mkt.regime}` : 'عدم مشاهده شکست قطعی روند',
        ...(agentPrivateRows[0] ? [`یادداشت حافظه اختصاصی تکنیکال: ${agentPrivateRows[0].note.slice(0, 100)}`] : [])
      ],
      risks: [Math.abs(chg) > 5 ? 'نوسان ۲۴ساعته بالا و احتمال بازگشت به میانگین (Mean Reversion)' : 'احتمال تله نوسانی در تایم‌فریم پایین'],
      evidenceCited: cited
    };
  }

  if (memberId === 'onchain_analyst') {
    const onchainEv = findFacet(evidence, ['yield_rates', 'wallet_state', 'venue_quote']).filter((e) => e.status === 'observed');
    onchainEv.forEach(markCited);
    if (!onchainEv.length) {
      return {
        stance: 'neutral',
        action: 'HOLD_WAIT',
        confidence: 42,
        summary: 'شاخص‌های آن‌چین و نرخ استخرهای دیفای در این نوبت مشاهده نشدند؛ وضعیت درون‌زنجیره‌ای خنثی ارزیابی می‌شود.',
        keyArguments: ['فید بازده/استخر یا وضعیت کیف‌پول خوانده نشده است'],
        risks: ['ریسک اسلیپیج و عمق نقدینگی بررسی‌نشده در زنجیره مقصد'],
        evidenceCited: cited
      };
    }
    const yieldEv = onchainEv.find((e) => e.facetId === 'yield_rates');
    const pools = Array.isArray(yieldEv?.summary?.pools) ? yieldEv.summary.pools : (Array.isArray(yieldEv?.summary?.top) ? yieldEv.summary.top : []);
    const topPool = pools[0];
    return {
      stance: topPool ? 'bullish' : 'neutral',
      action: topPool ? 'FAVORABLE_STAGED' : 'ANSWER',
      confidence: 68,
      summary: topPool
        ? `تحلیل آن‌چین: نقدینگی زنجیره‌ای فعال است؛ نمونه استخر ثبت‌شده ${topPool.project || topPool.protocol || 'DeFi'} با بازده ${topPool.apy ?? topPool.apr ?? 'مشاهده‌شده'}%.`
        : 'داده‌های آن‌چین و کیف‌پول بدون ناهنجاری نقدینگی مشاهده شدند.',
      keyArguments: [
        `تعداد منابع آن‌چین مشاهده‌شده: ${onchainEv.length}`,
        topPool ? `استخر شاخص: ${topPool.symbol || primaryAsset || 'Pool'} (${topPool.apy ?? 'N/A'}% APY)` : 'خوانش آن‌چین پایدار'
      ],
      risks: ['ریسک قرارداد هوشمند (Smart Contract Risk) و تغییر ناگهانی TVL استخرها'],
      evidenceCited: cited
    };
  }

  if (memberId === 'smart_money_analyst') {
    const smEv = evidence.find((e) => e.facetId === 'smart_money' && e.status === 'observed');
    if (smEv) markCited(smEv);
    if (!smEv) {
      return {
        stance: 'neutral',
        action: 'HOLD_WAIT',
        confidence: 40,
        summary: 'سیگنال تأییدشده‌ای از جریان کیف‌پول‌های اسمارت‌مانی در این لحظه ثبت نشده است.',
        keyArguments: ['نبود داده جریان انباشت/توزیع نهنگ‌ها در خوانش فعلی'],
        risks: ['احتمال واگرایی پنهان نهنگ‌ها در غیاب داده اسمارت‌مانی'],
        evidenceCited: cited
      };
    }
    const rawStr = JSON.stringify(smEv.summary || {}).toLowerCase();
    const accum = /(accumulat|bullish|inflow|buy|انباشت|ورود)/.test(rawStr);
    const distrib = /(distribut|bearish|outflow|sell|توزیع|خروج)/.test(rawStr);
    const stance = accum && !distrib ? 'bullish' : distrib && !accum ? 'bearish' : 'neutral';
    return {
      stance,
      action: stance === 'bullish' ? 'FAVORABLE_STAGED' : stance === 'bearish' ? 'CAUTIOUS_REDUCE' : 'HOLD_WAIT',
      confidence: stance === 'neutral' ? 56 : 70,
      summary: stance === 'bullish'
        ? `ردیابی اسمارت‌مانی نشان‌دهنده تمایل به انباشت (Accumulation) روی ${primaryAsset || 'دارایی‌های شاخص'} است.`
        : stance === 'bearish'
          ? `هشدار اسمارت‌مانی: نشانه‌های توزیع و خروج سرمایه هوشمند مشاهده شده است.`
          : 'جریان کیف‌پول‌های اسمارت‌مانی متعادل و بدون جهت‌گیری یک‌طرفه است.',
      keyArguments: [`خوانش مستقیم سیگنال اسمارت‌مانی (${smEv.tool})`],
      risks: ['کیف‌پول‌های بزرگ ممکن است با افق زمانی متفاوت از معامله‌گر خرد عمل کنند'],
      evidenceCited: cited
    };
  }

  if (memberId === 'macro_news_analyst') {
    const newsEv = evidence.find((e) => e.facetId === 'news_flow' && e.status === 'observed');
    const macroEv = evidence.find((e) => e.facetId === 'macro_state' && e.status === 'observed');
    if (newsEv) markCited(newsEv);
    if (macroEv) markCited(macroEv);
    if (!newsEv && !macroEv) {
      return {
        stance: 'neutral',
        action: 'HOLD_WAIT',
        confidence: 42,
        summary: 'فید اخبار و نماگرهای اقتصاد کلان در این نوبت در دسترس نبود؛ فضای کلان بدون سوگیری فرض می‌شود.',
        keyArguments: ['عدم مشاهده تیترهای خبری یا شاخص‌های کلان'],
        risks: ['ریسک رویدادهای خبری تقویم اقتصادی (FOMC / CPI)'],
        evidenceCited: cited
      };
    }
    const blob = JSON.stringify({ n: newsEv?.summary, m: macroEv?.summary }).toLowerCase();
    const negNews = /(hack|exploit|sec|ban|crash|war|hawkish|inflation\s+surge|ریزش|سقوط|هک|تحریم)/.test(blob);
    const posNews = /(approval|etf\s+inflow|rate\s+cut|dovish|adoption|تایید|ورود\s*سرمایه|کاهش\s*نرخ)/.test(blob);
    const stance = negNews && !posNews ? 'bearish' : posNews && !negNews ? 'bullish' : 'neutral';
    return {
      stance,
      action: stance === 'bearish' ? 'CAUTIOUS_REDUCE' : stance === 'bullish' ? 'FAVORABLE_STAGED' : 'HOLD_WAIT',
      confidence: 65,
      summary: stance === 'bearish'
        ? 'فضای اخبار و اقتصاد کلان حاوی سیگنال‌های ریسک‌گریزی (Risk-Off) است؛ احتیاط مضاعف لازم است.'
        : stance === 'bullish'
          ? 'کاتالیزورهای خبری و فضای کلان هم‌سو با دارایی‌های ریسکی (Risk-On) ارزیابی می‌شوند.'
          : 'اخبار و متغیرهای کلان در وضعیت خنثی/متعادل قرار دارند.',
      keyArguments: [
        newsEv ? 'تیترهای خبری لحظه‌ای بررسی شدند' : null,
        macroEv ? 'شاخص‌های اقتصاد کلان بررسی شدند' : null
      ].filter(Boolean),
      risks: ['چرخش ناگهانی سنتیمنت خبری و نوسان شاخص دلار (DXY)'],
      evidenceCited: cited
    };
  }

  if (memberId === 'risk_specialist') {
    const portEv = evidence.find((e) => e.facetId === 'portfolio_state' && e.status === 'observed');
    const walEv = evidence.find((e) => e.facetId === 'wallet_state' && e.status === 'observed');
    if (portEv) markCited(portEv);
    if (walEv) markCited(walEv);
    if (mkt.observed) cited.push('market_prices');

    const prefs = userProfile?.preferencesMap || {};
    const asksLeverage = /(اهرم|لوریج|مارجین|فیوچرز|۱۰x|20x|50x|100x|leverage|margin|futures|all[\s-]*in|کل\s*پولم)/i.test(question);
    const userConservative = prefs.riskTolerance === 'CONSERVATIVE' || prefs.leveragePolicy === 'NO_LEVERAGE_SPOT_ONLY';
    const highVol = Math.abs(mkt.change24h || 0) >= 6;

    if (asksLeverage && userConservative) {
      return {
        stance: 'bearish',
        action: 'AVOID_REJECT',
        confidence: 88,
        summary: 'هشدار جدی مدیریت ریسک: درخواست شامل اهرم/تمرکز بالاست که مستقیماً با پروفایل کم‌ریسک و قانون عدم استفاده از اهرم کاربر در تضاد است.',
        keyArguments: [
          `ترجیح ثبت‌شده کاربر در حافظه بلندمدت: ${prefs.riskTolerance || ''} ${prefs.leveragePolicy || ''}`.trim(),
          'ریسک لیکوییدیشن و از دست رفتن اصل سرمایه غیرقابل‌پذیرش است'
        ],
        risks: ['لیکوییدیشن کامل پوزیشن', 'نقض مستقیم محدودیت ریسک کاربر'],
        evidenceCited: cited
      };
    }
    if (asksLeverage || highVol || pastWarnings.length > 0) {
      return {
        stance: 'cautious',
        action: 'CAUTIOUS_REDUCE',
        confidence: 78,
        summary: `متخصص مدیریت ریسک احتیاط و کاهش سایز پوزیشن را الزامی می‌داند (${asksLeverage ? 'خطر اهرم/تمرکز بالا' : highVol ? `نوسان شدید ${mkt.change24h?.toFixed(1)}%` : 'سوابق خطای قبلی در شرایط مشابه'}).`,
        keyArguments: [
          asksLeverage ? 'استفاده از اهرم یا ورود تک‌پله‌ای ریسک دراداون را چندبرابر می‌کند' : null,
          highVol ? `نوسان ۲۴ساعته بالا (${mkt.change24h?.toFixed(2)}%)` : null,
          pastWarnings[0] ? `درس تجربه قبلی: ${pastWarnings[0].warning}` : null
        ].filter(Boolean),
        risks: ['ریزش ناگهانی قیمت (Drawdown)', 'تمرکز بیش از حد روی یک دارایی'],
        evidenceCited: cited
      };
    }
    return {
      stance: 'neutral',
      action: 'FAVORABLE_STAGED',
      confidence: 72,
      summary: 'از منظر مدیریت ریسک، تنها ورود پله‌ای اسپات (حداکثر ۲ تا ۵ درصد سبد در هر پله) با حد ابطال مشخص و حفظ نقدینگی استیبل‌کوین مجاز است.',
      keyArguments: [
        portEv ? 'وضعیت پرتفوی کاربر در ارزیابی لحاظ شد' : 'اجرای غیرامانی بدون اهرم پنهان',
        prefs.riskTolerance ? `تطبیق با سطح ریسک کاربر (${prefs.riskTolerance})` : 'رعایت سقف ریسک استاندارد اسپات'
      ],
      risks: ['نوسان سیستماتیک بازار کریپتو'],
      evidenceCited: cited
    };
  }

  // trading_strategy_specialist
  if (mkt.observed) cited.push('market_prices');
  const prefs = userProfile?.preferencesMap || {};
  const style = prefs.strategyStyle || 'DCA_STAGED';
  const chg = mkt.change24h ?? 0;
  const stance = chg >= 1.8 ? 'bullish' : chg <= -2.0 ? 'neutral' : 'neutral';
  return {
    stance,
    action: stance === 'bullish' ? 'FAVORABLE_STAGED' : 'HOLD_WAIT',
    confidence: mkt.observed ? 68 : 45,
    summary: mkt.observed
      ? `استراتژی پیشنهادی برای ${mkt.symbol}: اجرای اسپات ۳ پله‌ای (${style})، حفظ سپر نقدینگی استیبل‌کوین و تعیین سطح ابطال پیش از هر تصمیم کاربر.`
      : 'طراحی استراتژی مشروط به دریافت قیمت لحظه‌ای و مشخص شدن افق زمانی و مبلغ سرمایه‌گذاری کاربر است.',
    keyArguments: [
      `سبک اجرایی منطبق با کاربر: ${style}`,
      mkt.price ? `نقطه مرجع فعلی ${mkt.symbol}: $${mkt.price}` : 'نیاز به تأیید قیمت لحظه‌ای پیش از اقدام',
      sharedRows.length ? `هماهنگی با ${sharedRows.length} یافته مشترک سایر متخصصان` : 'ساختار غیرامانی با تأیید صریح کاربر'
    ],
    risks: ['ورود یک‌جای سرمایه‌گذاری در سقف نوسان کوتاه‌مدت'],
    evidenceCited: cited
  };
}

/* ───────────────────── Wave 2: Decision Critic (منتقد تصمیم‌ها) ─────────── */

function runDecisionCritic({
  wave1Opinions,
  evidence,
  userProfile,
  pastWarnings = []
}) {
  const stances = wave1Opinions.map((o) => o.stance);
  const bullishCount = stances.filter((s) => s === 'bullish').length;
  const bearishOrCautious = stances.filter((s) => s === 'bearish' || s === 'cautious').length;
  const observedFacets = evidence.filter((e) => e.status === 'observed');
  const missingFacets = evidence.filter((e) => e.status !== 'observed');

  const critiques = [];
  const risks = [];
  let confidencePenalty = 0;

  if (bullishCount > 0 && bearishOrCautious > 0) {
    critiques.push(`اختلاف جهت بین متخصصان (${bullishCount} دیدگاه مثبت در برابر ${bearishOrCautious} دیدگاه محتاط/نزولی)؛ اجماع کامل وجود ندارد.`);
    confidencePenalty += 10;
  }
  if (bullishCount >= 2 && bearishOrCautious === 0 && wave1Opinions.length >= 2) {
    critiques.push('هشدار هم‌فکری گروهی (Groupthink Check): همه تحلیلگران هم‌جهت هستند؛ سناریوی خلاف جهت و ریسک دنباله (Tail Risk) باید لحاظ شود.');
    confidencePenalty += 4;
  }
  if (missingFacets.length > 0) {
    critiques.push(`${missingFacets.length} منبع داده (${missingFacets.map((f) => f.facetId).join(', ')}) مشاهده نشده و نباید در عددسازی لحاظ شود.`);
    confidencePenalty += Math.min(18, missingFacets.length * 6);
  }
  if (observedFacets.length === 0) {
    critiques.push('هیچ داده ابزاری زنده‌ای مشاهده نشده است؛ هرگونه توصیه قطعی مردود است.');
    confidencePenalty += 25;
  }
  if (pastWarnings.length > 0) {
    critiques.push(`یادآوری خطاهای گذشته از حافظه: ${pastWarnings.map((w) => w.warning || w.lesson).join(' | ')}`);
    confidencePenalty += 8;
  }

  const riskMember = wave1Opinions.find((o) => o.memberId === 'risk_specialist');
  if (riskMember?.action === 'AVOID_REJECT') {
    critiques.push('متخصص مدیریت ریسک وضعیت را مغایر با ایمنی سرمایه کاربر تشخیص داده است؛ منتقد از وتوی ریسک حمایت می‌کند.');
    risks.push('نقض مرزهای ریسک کاربر در صورت بی‌توجهی به هشدار متخصص ریسک');
  }

  const stance = riskMember?.action === 'AVOID_REJECT'
    ? 'bearish'
    : (confidencePenalty >= 14 ? 'cautious' : 'neutral');

  return {
    stance,
    action: riskMember?.action === 'AVOID_REJECT' ? 'AVOID_REJECT' : (confidencePenalty >= 14 ? 'CAUTIOUS_REDUCE' : 'HOLD_WAIT'),
    confidence: clamp(76 - Math.floor(confidencePenalty / 3), 50, 85),
    summary: critiques.length
      ? `نقد تصمیم‌ها: ${critiques.slice(0, 2).join(' ')}`
      : 'بررسی انتقادی انجام شد: ادعاهای متخصصان با داده‌های مشاهده‌شده و پروفایل کاربر هم‌خوانی دارند، اما مدیریت سایز پوزیشن الزامی است.',
    keyArguments: critiques.length ? critiques : ['انطباق ادعاها با شواهد ابزاری بررسی شد'],
    risks: risks.length ? risks : ['ریسک تغییر ناگهانی رژیم بازار پس از صدور تحلیل'],
    evidenceCited: observedFacets.map((e) => e.facetId),
    confidencePenalty
  };
}

/* ───────────────────── Agreement & Disagreement Extraction ──────────────── */

function computeAgreementsAndDisagreements(opinions = []) {
  const pointsOfAgreement = [];
  const pointsOfDisagreement = [];

  const domainOps = opinions.filter((o) => o.memberId !== 'final_arbiter');
  const byStance = new Map();
  for (const op of domainOps) {
    const list = byStance.get(op.stance) || [];
    list.push(op);
    byStance.set(op.stance, list);
  }

  // Agreements
  for (const [stance, members] of byStance.entries()) {
    if (members.length >= 2) {
      pointsOfAgreement.push({
        type: 'STANCE_ALIGNMENT',
        stance,
        members: members.map((m) => m.memberId),
        rolesFa: members.map((m) => m.roleFa),
        summary: `${members.map((m) => m.roleFa).join(' و ')} روی رویکرد «${stance}» هم‌نظر هستند.`
      });
    }
  }

  // Non-custodial staged safety consensus
  const stagedSupporters = domainOps.filter((o) => o.action === 'FAVORABLE_STAGED' || o.action === 'HOLD_WAIT' || o.action === 'CAUTIOUS_REDUCE');
  if (stagedSupporters.length >= 2) {
    pointsOfAgreement.push({
      type: 'RISK_DISCIPLINE',
      members: stagedSupporters.map((m) => m.memberId),
      summary: 'توافق بر پرهیز از ورود هیجانی تک‌پله‌ای و حفظ کنترل غیرامانی دارایی توسط کاربر.'
    });
  }

  // Disagreements
  const bulls = byStance.get('bullish') || [];
  const bears = [...(byStance.get('bearish') || []), ...(byStance.get('cautious') || [])];
  if (bulls.length > 0 && bears.length > 0) {
    pointsOfDisagreement.push({
      type: 'DIRECTIONAL_VS_RISK_CONFLICT',
      sideA: {
        stance: 'bullish',
        members: bulls.map((m) => m.memberId),
        rolesFa: bulls.map((m) => m.roleFa),
        view: bulls[0].summary
      },
      sideB: {
        stance: bears[0].stance,
        members: bears.map((m) => m.memberId),
        rolesFa: bears.map((m) => m.roleFa),
        view: bears[0].summary
      },
      summary: `${bulls.map((m) => m.roleFa).join('، ')} سیگنال مثبت می‌بینند، در حالی که ${bears.map((m) => m.roleFa).join('، ')} بر ریسک نزولی/احتیاط تأکید دارند.`
    });
  }

  const critic = opinions.find((o) => o.memberId === 'decision_critic');
  if (critic && critic.confidencePenalty >= 10 && pointsOfDisagreement.length === 0) {
    pointsOfDisagreement.push({
      type: 'CRITIC_EVIDENCE_CHALLENGE',
      sideA: {
        stance: 'specialist_panel',
        members: domainOps.filter((m) => m.memberId !== 'decision_critic').map((m) => m.memberId)
      },
      sideB: {
        stance: critic.stance,
        members: ['decision_critic'],
        view: critic.summary
      },
      summary: critic.summary
    });
  }

  return { pointsOfAgreement, pointsOfDisagreement };
}

/* ───────────────────── Adaptive AI Council Factory ──────────────────────── */

export function createAdaptiveCouncil({
  smartMemory = null,
  performanceLearning = null,
  now = () => Date.now()
} = {}) {
  return {
    schema: ADAPTIVE_COUNCIL_SCHEMA,
    roster: COUNCIL_ROSTER,
    selectMembers: selectCouncilMembers,

    /**
     * Convene the Adaptive AI Council for a request.
     * Supports optional `modelExecutor({ member, prompt, evidence })` so the
     * Central Brain can assign optimal LLM models with automatic failover to
     * high-priority council seats while keeping every claim tool-anchored.
     */
    async convene({
      owner = 'anon',
      sessionId = null,
      question = '',
      classification = {},
      evidence = [],
      memoryContext = null,
      learningGuidance = null,
      modelExecutor = null, // async ({ member, baseline }) => { summary, stance, confidence, provider, model, failoverUsed, attemptedProviders }
      forceMembers = null,
      clarificationNeeded = null
    } = {}) {
      const startedAt = now();
      const guidance = learningGuidance || (performanceLearning
        ? performanceLearning.buildDecisionGuidance({
          owner,
          asset: classification?.entities?.assets?.[0] || null,
          taskType: classification?.category || 'MULTI_DOMAIN_COMPLEX'
        })
        : { modelTrustWeights: {}, agentTrustWeights: {}, confidenceDampener: 0, pastMistakeWarnings: [] });

      const selection = selectCouncilMembers({
        classification,
        message: question,
        learningGuidance: guidance,
        forceMembers
      });

      if (!selection.councilRequired) {
        return {
          ok: true,
          schema: ADAPTIVE_COUNCIL_SCHEMA,
          councilConvened: false,
          selectedMembers: [],
          skippedMembers: selection.skippedMembers,
          reason: 'COUNCIL_NOT_NEEDED_FOR_SIMPLE_REQUEST'
        };
      }

      const primaryAsset = classification?.entities?.assets?.[0] || null;
      const userProfile = memoryContext?.userProfile || (smartMemory ? await smartMemory.getUserProfile(owner) : {});
      const pastWarnings = [
        ...(memoryContext?.relevantExperiences?.warnings || []),
        ...(guidance?.pastMistakeWarnings || [])
      ];

      const wave1Members = selection.selectedMembers.filter((m) => m.wave === 1);
      const hasCritic = selection.selectedMembers.some((m) => m.memberId === 'decision_critic');

      // ── WAVE 1: Concurrent Domain & Risk/Strategy Specialists ──
      const wave1Opinions = await Promise.all(wave1Members.map(async (sel) => {
        const spec = COUNCIL_ROSTER[sel.memberId];
        const [privMem, sharedMem] = smartMemory
          ? await Promise.all([
            smartMemory.recallAgentPrivate({ owner, agentId: sel.memberId, requesterAgentId: sel.memberId, query: question, limit: 2 }),
            smartMemory.readSharedMemory({ owner, readerAgentId: sel.memberId, query: question, sessionId, limit: 4 })
          ])
          : [{ rows: [] }, { rows: [] }];

        const baseline = buildDomainSpecialistBaseline(sel.memberId, {
          question,
          primaryAsset,
          evidence,
          userProfile,
          agentPrivateRows: privMem.rows || [],
          sharedRows: sharedMem.rows || [],
          pastWarnings
        });

        let llmAugment = null;
        if (typeof modelExecutor === 'function') {
          try {
            llmAugment = await modelExecutor({
              member: spec,
              question,
              baseline,
              evidence: findFacet(evidence, spec.facets),
              userProfile
            });
          } catch { /* Specialist falls back cleanly to deterministic tool-grounded baseline */ }
        }

        const agentTrust = Number(guidance?.agentTrustWeights?.[sel.memberId] ?? 1.0);
        const modelProvider = llmAugment?.provider || 'deterministic-specialist';
        const modelTrust = Number(guidance?.modelTrustWeights?.[modelProvider] ?? 1.0);
        const citedObs = evidence.filter((e) => baseline.evidenceCited.includes(e.facetId));
        const avgEvCred = citedObs.length
          ? citedObs.reduce((s, e) => s + (SOURCE_CREDIBILITY[e.status] ?? 0.3), 0) / citedObs.length
          : 0.35;

        const opinion = {
          memberId: sel.memberId,
          roleFa: spec.roleFa,
          roleEn: spec.roleEn,
          wave: 1,
          selectionReason: sel.reason,
          stance: llmAugment?.stance || baseline.stance,
          action: llmAugment?.action || baseline.action,
          confidence: clamp(Math.round(llmAugment?.confidence ?? baseline.confidence), 15, 92),
          summary: cleanText(llmAugment?.summary || baseline.summary, 520),
          keyArguments: baseline.keyArguments,
          risks: baseline.risks,
          evidenceCited: baseline.evidenceCited,
          evidenceCredibility: Math.round(avgEvCred * 100) / 100,
          agentTrustWeight: agentTrust,
          modelTrustWeight: modelTrust,
          effectiveWeight: Math.round((0.45 * avgEvCred + 0.35 * (agentTrust / 1.3) + 0.20 * (modelTrust / 1.3)) * 1000) / 1000,
          provider: modelProvider,
          model: llmAugment?.model || 'fbt-domain-specialist-v2',
          failoverUsed: Boolean(llmAugment?.failoverUsed),
          attemptedProviders: llmAugment?.attemptedProviders || [modelProvider]
        };

        // Persist private domain note + publish to controlled shared memory for Wave 2 & 3
        if (smartMemory) {
          await Promise.all([
            smartMemory.rememberAgentPrivate({
              owner,
              agentId: sel.memberId,
              note: opinion.summary,
              topic: classification?.category || 'analysis',
              assets: primaryAsset ? [primaryAsset] : [],
              confidence: opinion.confidence / 100
            }),
            smartMemory.publishSharedMemory({
              owner,
              publisherAgentId: sel.memberId,
              claim: opinion.summary,
              topic: spec.roleEn,
              assets: primaryAsset ? [primaryAsset] : [],
              confidence: opinion.confidence / 100,
              evidenceRefs: opinion.evidenceCited,
              allowedReaders: ['decision_critic', 'final_arbiter', 'trading_strategy_specialist', 'risk_specialist'],
              sessionId
            })
          ]).catch(() => {});
        }

        return opinion;
      }));

      // ── WAVE 2: Decision Critic (منتقد تصمیم‌ها) ──
      const allOpinions = [...wave1Opinions];
      let criticResult = null;
      if (hasCritic) {
        const criticSpec = COUNCIL_ROSTER.decision_critic;
        const baseCrit = runDecisionCritic({
          wave1Opinions,
          evidence,
          userProfile,
          pastWarnings
        });
        let llmCrit = null;
        if (typeof modelExecutor === 'function') {
          try {
            llmCrit = await modelExecutor({
              member: criticSpec,
              question,
              baseline: baseCrit,
              peerOpinions: wave1Opinions,
              evidence
            });
          } catch { /* fallback to baseCrit */ }
        }
        const criticTrust = Number(guidance?.agentTrustWeights?.decision_critic ?? 1.0);
        criticResult = {
          memberId: 'decision_critic',
          roleFa: criticSpec.roleFa,
          roleEn: criticSpec.roleEn,
          wave: 2,
          selectionReason: selection.selectedMembers.find((m) => m.memberId === 'decision_critic')?.reason || 'ADVERSARIAL_AUDIT',
          stance: llmCrit?.stance || baseCrit.stance,
          action: baseCrit.action,
          confidence: baseCrit.confidence,
          summary: cleanText(llmCrit?.summary || baseCrit.summary, 520),
          keyArguments: baseCrit.keyArguments,
          risks: baseCrit.risks,
          evidenceCited: baseCrit.evidenceCited,
          evidenceCredibility: 0.85,
          agentTrustWeight: criticTrust,
          modelTrustWeight: 1.0,
          effectiveWeight: Math.round(0.75 * criticTrust * 1000) / 1000,
          confidencePenalty: baseCrit.confidencePenalty,
          provider: llmCrit?.provider || 'deterministic-critic',
          model: llmCrit?.model || 'fbt-adversarial-critic-v2',
          failoverUsed: Boolean(llmCrit?.failoverUsed),
          attemptedProviders: llmCrit?.attemptedProviders || [llmCrit?.provider || 'deterministic-critic']
        };
        allOpinions.push(criticResult);
      }

      // ── WAVE 3: Final Arbiter (داور نهایی) ──
      const { pointsOfAgreement, pointsOfDisagreement } = computeAgreementsAndDisagreements(allOpinions);

      const evidenceUsed = evidence.map((e) => ({
        facetId: e.facetId,
        tool: e.tool,
        status: e.status,
        credibility: SOURCE_CREDIBILITY[e.status] ?? 0,
        freshnessMs: e.ms ?? null,
        summary: e.status === 'observed' ? redactSecrets(e.summary) : null,
        citedByMembers: allOpinions.filter((op) => op.evidenceCited?.includes(e.facetId)).map((op) => op.memberId)
      }));

      // Evidence- & Credibility-Weighted Tally
      let bullWeight = 0;
      let bearWeight = 0;
      let neutralWeight = 0;
      for (const op of wave1Opinions) {
        const w = Math.max(0.1, op.effectiveWeight);
        if (op.stance === 'bullish') bullWeight += w;
        else if (op.stance === 'bearish' || op.stance === 'cautious') bearWeight += w;
        else neutralWeight += w;
      }
      const totalWeight = Math.max(0.001, bullWeight + bearWeight + neutralWeight);

      const riskMember = wave1Opinions.find((o) => o.memberId === 'risk_specialist');
      const observedCount = evidenceUsed.filter((e) => e.status === 'observed').length;
      const avgEvidenceScore = evidenceUsed.length
        ? evidenceUsed.reduce((s, e) => s + e.credibility, 0) / evidenceUsed.length
        : 0.4;
      const agreementRatio = Math.max(bullWeight, bearWeight, neutralWeight) / totalWeight;
      const criticPenalty = criticResult?.confidencePenalty || 0;
      const learningPenalty = Number(guidance?.confidenceDampener || 0);

      let finalAction = 'HOLD_WAIT';
      let finalStance = 'neutral';
      const decisionReasons = [];

      if (clarificationNeeded?.required) {
        finalAction = 'CLARIFY';
        finalStance = 'uncertain';
        decisionReasons.push(`اطلاعات کلیدی برای تصمیم‌گیری دقیق ناقص است (${clarificationNeeded.missingSlots.join('، ')})؛ ابتدا شفاف‌سازی از کاربر درخواست می‌شود.`);
      } else if (observedCount === 0 && evidenceUsed.length > 0 && classification?.requiresToolTruth) {
        finalAction = 'ABSTAIN';
        finalStance = 'abstain';
        decisionReasons.push('ابزارهای خوانش داده واقعی در این لحظه پاسخ ندادند؛ بر اساس قانون صحت داده‌ها از حدس زدن اعداد خودداری شد.');
      } else if (riskMember?.action === 'AVOID_REJECT') {
        finalAction = 'AVOID_REJECT';
        finalStance = 'bearish';
        decisionReasons.push(`وتوی ایمنی متخصص مدیریت ریسک: ${riskMember.summary}`);
      } else if (bullWeight / totalWeight >= 0.52 && bearWeight / totalWeight < 0.35 && observedCount > 0) {
        finalAction = 'FAVORABLE_STAGED';
        finalStance = 'bullish';
        decisionReasons.push(`اکثریت وزن‌دار شواهد (${Math.round((bullWeight / totalWeight) * 100)}%) با تکیه بر داده‌های مشاهده‌شده رویکرد مثبت پله‌ای را تأیید می‌کنند.`);
      } else if (bearWeight / totalWeight >= 0.45) {
        finalAction = 'CAUTIOUS_REDUCE';
        finalStance = 'cautious';
        decisionReasons.push(`وزن سیگنال‌های احتیاط/نزولی (${Math.round((bearWeight / totalWeight) * 100)}%) بر سیگنال‌های صعودی غلبه دارد؛ حفظ نقدینگی در اولویت است.`);
      } else {
        finalAction = 'HOLD_WAIT';
        finalStance = 'neutral';
        decisionReasons.push('شواهد بین متخصصان متعادل یا نیازمند تأیید بیشتر روند است؛ صبر و پایش نقاط کلیدی کم‌ریسک‌ترین گزینه است.');
      }

      if (pointsOfDisagreement.length > 0) {
        decisionReasons.push(`نحوه داوری اختلاف‌ها: شواهد مشاهده‌شده ابزاری (اعتبار ${Math.round(avgEvidenceScore * 100)}%) و انضباط ریسک بر حدس‌های بدون پشتوانه اولویت داده شدند.`);
      }
      if (criticResult && criticPenalty > 0) {
        decisionReasons.push(`اعمال بازبینی منتقد تصمیم‌ها: سطح اطمینان به میزان ${criticPenalty} واحد تعدیل شد.`);
      }
      if (learningPenalty > 0) {
        decisionReasons.push(`کالیبراسیون یادگیری از عملکرد گذشته: تعدیل ${learningPenalty}- واحدی اطمینان بر اساس سوابق خطای قبلی.`);
      }

      const rawConf = Math.round(
        32
        + avgEvidenceScore * 38
        + agreementRatio * 20
        - criticPenalty
        - learningPenalty
      );
      const confidenceScore = finalAction === 'ABSTAIN'
        ? Math.min(25, Math.max(10, rawConf))
        : finalAction === 'CLARIFY'
          ? Math.min(42, Math.max(20, rawConf))
          : clamp(rawConf, 22, 88);
      const confidenceBand = confidenceScore >= 72 ? 'HIGH' : confidenceScore >= 48 ? 'MEDIUM' : 'LOW';

      const arbiterSpec = COUNCIL_ROSTER.final_arbiter;
      const arbiterSummaryFa = `جمع‌بندی داور نهایی (${allOpinions.length + 1} عضو تخصصی): اقدام پیشنهادی «${finalAction}» با سطح اطمینان ${confidenceScore}% (${confidenceBand}). ${decisionReasons[0]}`;
      const arbiterOpinion = {
        memberId: 'final_arbiter',
        roleFa: arbiterSpec.roleFa,
        roleEn: arbiterSpec.roleEn,
        wave: 3,
        selectionReason: 'EVIDENCE_WEIGHTED_FINAL_ARBITRATION',
        stance: finalStance,
        action: finalAction,
        confidence: confidenceScore,
        summary: arbiterSummaryFa,
        keyArguments: decisionReasons,
        risks: pointsOfDisagreement.map((d) => d.summary),
        evidenceCited: evidenceUsed.filter((e) => e.status === 'observed').map((e) => e.facetId),
        evidenceCredibility: Math.round(avgEvidenceScore * 100) / 100,
        agentTrustWeight: Number(guidance?.agentTrustWeights?.final_arbiter ?? 1.0),
        modelTrustWeight: 1.0,
        effectiveWeight: 1.0,
        provider: 'fbt-council-arbiter',
        model: 'fbt-evidence-arbiter-v2',
        failoverUsed: false,
        attemptedProviders: ['fbt-council-arbiter']
      };
      allOpinions.push(arbiterOpinion);

      const strategyMember = wave1Opinions.find((o) => o.memberId === 'trading_strategy_specialist');
      const finalDecision = {
        action: finalAction,
        stance: finalStance,
        asset: primaryAsset,
        summary: arbiterSummaryFa,
        summaryEn: `Final Arbiter Verdict (${allOpinions.length} specialists): ${finalAction} (${finalStance}) at ${confidenceScore}% (${confidenceBand}) confidence.`,
        strategyGuidance: strategyMember?.summary || null,
        clarificationQuestions: clarificationNeeded?.questions || [],
        executionAuthorized: false,
        canExecute: false,
        canSign: false,
        canMoveFunds: false
      };

      return {
        ok: true,
        schema: ADAPTIVE_COUNCIL_SCHEMA,
        councilConvened: true,
        durationMs: now() - startedAt,
        selectedMembers: selection.selectedMembers,
        skippedMembers: selection.skippedMembers,
        // ── All 7 Required Council Output Fields ──
        memberOpinions: allOpinions,
        evidenceUsed,
        pointsOfAgreement,
        pointsOfDisagreement,
        confidence: {
          score: confidenceScore,
          band: confidenceBand,
          breakdown: {
            evidenceCredibilityAvg: Math.round(avgEvidenceScore * 100) / 100,
            agreementRatio: Math.round(agreementRatio * 100) / 100,
            criticPenalty,
            learningPenalty
          }
        },
        finalDecision,
        decisionReasons
      };
    }
  };
}

export default createAdaptiveCouncil;
