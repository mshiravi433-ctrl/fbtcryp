/**
 * FBT AI — is this question asking for an EXPLANATION or for the market's state?
 * ---------------------------------------------------------------------------
 * The evidence gate used to require a verified live source for EVERY question
 * whose conversation kind was QUESTION. That is right for «قیمت بیت‌کوین
 * چنده؟» — a number nobody may invent — and wrong for «ایمپرمننت لاس چیه؟»
 * or «چطور ریسک پورتفوی‌ام را کم کنم؟», which are answered from stable
 * knowledge and reasoning. The assistant refused both, so every explainer
 * question read as «the AI knows nothing».
 *
 * This module draws that line explicitly and conservatively:
 *
 *   · a question that asks what something IS or HOW something WORKS, or asks
 *     for advice, is CONCEPTUAL — it may be answered without live data;
 *   · the moment it names a current state — a price, today, news, my balance,
 *     my portfolio, an order — it is NOT conceptual and the live-evidence
 *     rule stands unchanged.
 *
 * The classifier never grants permission to state a number: even a conceptual
 * answer is forbidden from inventing prices or dates. It only says which
 * QUESTIONS may be answered at all.
 */

const LIVE_STATE = [
  /* persian */
  /قیمت|چنده|چقدره|چقدر\s*است|نرخ\s*الان|الان\s*چند/iu,
  /امروز|دیروز|همین\s*الان|این\s*هفته|این\s*ماه|لحظه/iu,
  /اخبار|خبر\s*های|تیتر/iu,
  /* «کیف پول من» is deliberately absent: «چطور کیف پول من را وصل کنم؟»
     is a how-to. A question with no explanation marker is factual anyway. */
  /پرتفوی\s*من|پورتفوی\s*من|موجودی\s*من|سود\s*من|ضرر\s*من|بازده\s*من/iu,
  /تحلیل\s*کن|آنالیز\s*کن|بررسی\s*کن|بفرست|بخر|بفروش|سواپ\s*کن|منتقل\s*کن|بریج\s*کن|قفل\s*کن|استیک\s*کن/iu,
  /\bآپشن|\bقرارداد\s*باز|\bپوزیشن\s*من/iu,
  /* english */
  /\b(price|how much is|how much does|worth|current|today|now|latest|news)\b/iu,
  /* «my portfolio», «my balance» — a reading of a state. «my wallet» is NOT
     here on purpose: «how do I connect my wallet» is a how-to, and treating
     it as a data request refused a question the product should answer. */
  /\b(my|our)\s+(portfolio|balance|pnl|profit)\b/iu,
  /analyz|analys|buy|sell|swap|bridge|stake|transfer|execute/iu,
  /\b(now|today|right now|latest)\b/iu
];

/*
 * A PLAN REQUEST is never an explanation, however it is phrased. «استراتژی
 * سرمایه‌گذاری ۲۰٪ در ۶ ماه با این سبد چیست؟» ends in «چیست» and used to be
 * classified conceptual, which let the local corpus answer it with the Earn
 * explainer at score 110 — a real answer to a different question. Asking for
 * a plan is asking for work, not for a definition.
 */
const PLAN_REQUEST = [
  /* «پرتفوی» and «سرمایه‌گذاری» alone are NOT plan markers — «چطور ریسک
     پرتفوی‌ام را کم کنم؟» is an advice question, and «سرمایه‌گذاری چیست؟» is a
     definition. They only become a plan with an action word next to them. */
  /استراتژی|پلن|طرح\s*(?:سرمایه|معامل)|سبد\s*(?:من|ما|خودم)|بچین|تخصیص\s*(?:بده|ده)|چیدمان/iu,
  /(?:پرتفوی|پورتفوی|سبد|سرمایه‌گذاری|سرمایه\s*گذاری).{0,18}(?:بچین|طراحی|بساز|بنویس|آماده)/iu,
  /بچین|طراحی\s*کن|بنویس|بساز|آماده\s*کن|پیشنهاد\s*(?:بده|کن)/iu,
  /\b(strategy|plan|allocate|allocation|portfolio|rebalance)\b/iu,
  /\b(build|design|make|give)\b.{0,24}\b(plan|portfolio|strategy)\b/iu
];

const CONCEPTUAL = [
  /* persian — definition */
  /چیست|چیه|چی\s*هست|یعنی\s*(?:چه|چی)|تعریف|معنی(?:‌|ی)?\s*(?:چه|چی)/iu,
  /* persian — mechanism / how-to */
  /چطور|چگونه|چه\s*جور|چه‌جوری|چطوری/iu,
  /توضیح\s*بده|شرح\s*بده|بیشتر\s*توضیح|تفاوت|فرق|مقایسه\s*کن/iu,
  /* persian — advice / reasoning */
  /باید\s*چه\s*کار|چیکار\s*کنم|چه\s*کاری\s*کنم|پیشنهاد|راهنمایی|نصیحت|چرا\s+(?:باید|مهم)/iu,
  /* english */
  /\bwhat\s*(?:is|are|does|do)\b|\bwhat'?s\b/iu,
  /\bhow\s+(?:does|do|is|are|can|should|to)\b|\bexplain\b|\bdifference\s+between\b/iu,
  /\bwhy\s+(?:does|do|is|are|should|isn'?t|don'?t)\b|\bversus\b|\bvs\.?\b/iu,
  /\bguide|tutorial|meaning of|definition of\b/iu
];

/** Intents whose answer is a claim about the world's current state. */
const STATE_INTENTS = new Set([
  'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'NEWS_SEARCH', 'ANALYZE_TOKEN', 'ANALYZE_TOKEN_DEEP',
  'PRICE_CHECK', 'WHY_MARKET_MOVE', 'SMART_MONEY', 'WHALE', 'SIGNALS', 'STOCKS',
  'PORTFOLIO_ANALYSIS', 'RISK_ANALYSIS', 'WALLET_BALANCE', 'ORDERS', 'YIELD_DISCOVERY',
  'FARM', 'LEND', 'BORROW', 'STAKING', 'REBALANCE', 'DCA', 'BUY', 'SELL', 'SWAP', 'BRIDGE',
  'SEND', 'INVESTMENT_PLAN', 'GOAL_PLAN', 'STRATEGY', 'STRATEGY_PLAN', 'RECOMMENDATION'
]);

export const QUESTION_SHAPE_SCHEMA = 'fbt.ai.question-shape.v1';

/**
 * Classify a message.
 *
 * @returns {{ conceptual: boolean, reason: string, signals: {conceptual:boolean, live:boolean, intent:boolean} }}
 */
export function classifyQuestionShape(message = '', { intentType = null } = {}) {
  const text = String(message || '').trim();
  if (!text) return { schema: QUESTION_SHAPE_SCHEMA, conceptual: false, reason: 'EMPTY', signals: { conceptual: false, live: false, intent: false } };

  const live = LIVE_STATE.some((re) => re.test(text));
  const conceptualWord = CONCEPTUAL.some((re) => re.test(text));
  const stateIntent = STATE_INTENTS.has(String(intentType || '').toUpperCase());
  const planRequest = PLAN_REQUEST.some((re) => re.test(text));

  if (planRequest) {
    return { schema: QUESTION_SHAPE_SCHEMA, conceptual: false, reason: 'PLAN_REQUEST', signals: { conceptual: false, live, intent: stateIntent, plan: true } };
  }

  /* A live-state word wins over a conceptual word every time: «چطور قیمت
     بیت‌کوین امروز را ببینم؟» is a data request wearing a how-to. */
  if (live) {
    return { schema: QUESTION_SHAPE_SCHEMA, conceptual: false, reason: 'LIVE_STATE', signals: { conceptual: conceptualWord, live, intent: stateIntent } };
  }
  if (stateIntent && !conceptualWord) {
    return { schema: QUESTION_SHAPE_SCHEMA, conceptual: false, reason: 'STATE_INTENT', signals: { conceptual: conceptualWord, live, intent: stateIntent } };
  }
  if (conceptualWord) {
    return { schema: QUESTION_SHAPE_SCHEMA, conceptual: true, reason: 'EXPLANATION', signals: { conceptual: conceptualWord, live, intent: stateIntent } };
  }
  return { schema: QUESTION_SHAPE_SCHEMA, conceptual: false, reason: 'NO_EXPLANATION_SIGNAL', signals: { conceptual: false, live, intent: stateIntent } };
}

/** Is this a request for a plan, an allocation, or a strategy? */
export function isPlanRequest(message = '') {
  return classifyQuestionShape(message, {}).reason === 'PLAN_REQUEST';
}

/** Convenience predicate. */
export function isConceptualQuestion(message = '', options = {}) {
  return classifyQuestionShape(message, options).conceptual === true;
}
