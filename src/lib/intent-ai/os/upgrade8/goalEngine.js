import { INTENT_STATUS, createGoalRecord, createIntentRecord, nowMs } from './contracts.js';
import { extractDurationDays, extractDurationMonths, extractAmountUsd, extractRiskProfile, normalizeText } from './questionEngine.js';

const PORTFOLIO_KEYWORDS = ['portfolio', 'portfo', 'portfolio analysis', 'پرتفوی', 'سبد'];
const EXECUTION_KEYWORDS = ['buy', 'sell', 'swap', 'bridge', 'borrow', 'lend', 'farm', 'stake', 'short', 'long', 'خرید', 'فروش', 'سواپ', 'بریج', 'وام'];
const MONITORING_KEYWORDS = ['monitor', 'alert', 'notify', 'watch', 'رصد', 'پایش', 'هشدار'];

export function detectIntentType(message) {
  const normalized = normalizeText(message);
  if (PORTFOLIO_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))) {
    if (normalized.includes('rebalance') || normalized.includes('بازچین') || normalized.includes('متعادل')) return 'PORTFOLIO_REBALANCE';
    return 'PORTFOLIO_ANALYSIS';
  }
  // If user provides capital, timeframe, or risk (e.g. «۱۰۰۰ دلار برای ۲۰ روز با ریسک متوسط»)
  if (
    (normalized.includes('ریسک') || normalized.includes('risk') || normalized.includes('سود') || normalized.includes('سرمایه') || normalized.includes('برنامه')) &&
    (normalized.match(/\d+\s*(?:دلار|usdt|usdc|usd|\$)/i) || normalized.match(/(?:روز|ماه|سال|day|month)/i))
  ) {
    return 'PORTFOLIO_ANALYSIS';
  }
  if (EXECUTION_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))) {
    return 'TRADE_EXECUTION';
  }
  if (MONITORING_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))) {
    return 'MONITORING_REQUEST';
  }
  if (normalized.includes('plan') || normalized.includes('strategy') || normalized.includes('برنامه') || normalized.includes('استراتژی')) {
    return 'PLAN_REQUEST';
  }
  return 'GENERAL';
}

export function inferGoalFromMessage(message, context = {}) {
  const normalized = normalizeText(message);
  const intentType = context.intentType || detectIntentType(message);
  const horizonMonths = extractDurationMonths(message) || context.horizonMonths || null;
  const horizonDays = extractDurationDays(message) || context.horizonDays || null;
  const amountUsd = extractAmountUsd(message) || context.amountUsd || null;
  const riskProfile = extractRiskProfile(message) || context.riskProfile || null;

  if (intentType === 'PORTFOLIO_ANALYSIS' || intentType === 'PLAN_REQUEST') {
    return {
      type: 'portfolio-analysis',
      title: horizonDays
        ? `Analyze portfolio plan for ${horizonDays} days (${amountUsd ? `$${amountUsd}` : 'capital'})`
        : horizonMonths
          ? `Analyze portfolio for the next ${horizonMonths} months`
          : 'Analyze current portfolio',
      description: 'Review holdings, allocation, scenario risk and recommended strategy.',
      horizonMonths,
      horizonDays,
      amountUsd,
      riskProfile,
      assumptions: [
        horizonDays ? `time horizon: ${horizonDays} days` : horizonMonths ? `time horizon: ${horizonMonths} months` : 'time horizon pending',
        amountUsd ? `capital: $${amountUsd}` : null,
        riskProfile ? `risk profile: ${riskProfile}` : 'risk profile pending'
      ].filter(Boolean)
    };
  }

  if (intentType === 'PORTFOLIO_REBALANCE') {
    return {
      type: 'portfolio-rebalance',
      title: 'Rebalance portfolio',
      description: 'Reduce concentration risk and align positions with target allocation.',
      horizonMonths,
      riskProfile,
      assumptions: []
    };
  }

  if (intentType === 'TRADE_EXECUTION') {
    return {
      type: 'safe-execution',
      title: 'Safely execute requested action',
      description: 'Validate wallet state, simulate transaction, confirm, execute and verify.',
      horizonMonths,
      riskProfile,
      assumptions: []
    };
  }

  if (intentType === 'MONITORING_REQUEST') {
    return {
      type: 'monitoring',
      title: 'Monitor portfolio and trigger alerts',
      description: 'Track thresholds, scenarios and follow-up actions.',
      horizonMonths,
      riskProfile,
      assumptions: []
    };
  }

  return {
    type: 'general-support',
    title: 'Assist user intent',
    description: 'Understand the request and produce the next best step.',
    horizonMonths,
    riskProfile,
    assumptions: []
  };
}

export function createIntentAndGoal({ state, message, route = '/intent', timestamp = nowMs(), context = {} }) {
  const intentType = context.intentType || detectIntentType(message);
  const goalSeed = inferGoalFromMessage(message, { ...context, intentType });

  const goal = createGoalRecord({
    title: goalSeed.title,
    description: goalSeed.description,
    type: goalSeed.type,
    horizonMonths: goalSeed.horizonMonths,
    riskProfile: goalSeed.riskProfile,
    assumptions: goalSeed.assumptions,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const requiredSlots = [];
  if (intentType === 'PORTFOLIO_ANALYSIS') {
    if (!goalSeed.horizonMonths && !goalSeed.horizonDays) requiredSlots.push('timeframe');
    if (!goalSeed.riskProfile) requiredSlots.push('riskProfile');
  }

  const intent = createIntentRecord({
    conversationId: state?.conversationId || null,
    goalId: goal.goalId,
    type: intentType,
    originalMessage: message,
    normalizedMessage: normalizeText(message),
    status: requiredSlots.length ? INTENT_STATUS.CLARIFYING : INTENT_STATUS.READY,
    confidence: intentType === 'GENERAL' ? 0.55 : 0.88,
    requiredSlots,
    filledSlots: {
      ...(goalSeed.horizonDays ? { timeframe: `${goalSeed.horizonDays} days`, horizonDays: goalSeed.horizonDays } : goalSeed.horizonMonths ? { timeframe: goalSeed.horizonMonths } : {}),
      ...(goalSeed.riskProfile ? { riskProfile: goalSeed.riskProfile } : {}),
      ...(goalSeed.amountUsd ? { amountUsd: goalSeed.amountUsd } : {})
    },
    routeContext: route,
    entities: {
      horizonMonths: goalSeed.horizonMonths,
      horizonDays: goalSeed.horizonDays,
      amountUsd: goalSeed.amountUsd,
      riskProfile: goalSeed.riskProfile
    },
    explanation: `Intent classified as ${intentType}`,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return { intent, goal };
}

export function mergeGoalFromAnswer(goal, slot, value, timestamp = nowMs()) {
  if (!goal) return goal;
  if (slot === 'riskProfile') {
    return { ...goal, riskProfile: value, updatedAt: timestamp };
  }
  if (slot === 'timeframe' || slot === 'durationMonths') {
    return { ...goal, horizonMonths: Number(value) || value, updatedAt: timestamp };
  }
  return { ...goal, updatedAt: timestamp };
}

export function summarizeGoal(goal) {
  if (!goal) return '';
  const parts = [goal.title];
  if (goal.horizonMonths) parts.push(`${goal.horizonMonths}m horizon`);
  if (goal.riskProfile) parts.push(`${goal.riskProfile} risk`);
  return parts.filter(Boolean).join(' • ');
}
