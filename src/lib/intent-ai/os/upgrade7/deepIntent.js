/**
 * FBT INTENT OS — UPGRADE 7 · Intent Understanding 2.0 + Hidden Intent
 * ---------------------------------------------------------------------------
 * Spec §1 (WHAT/WHY/GOAL/CONTEXT/CONSTRAINTS/TIMEFRAME/RISK/ASSETS/AMOUNT/
 * ACTION/URGENCY/USER PREFERENCE), §2 (hidden intent), §11 (natural language →
 * action), §18 (goal memory carry-over).
 *
 * ─── WHY A NEW MODULE AND NOT AN EDIT ───────────────────────────────────────
 * `intentUnderstanding.understandIntent()` already classifies a sentence into a
 * single dominant `type`, and dozens of probes assert on that exact shape. This
 * module does not touch it: it CONSUMES its output and adds the second
 * dimension — the *why* behind the *what* — as a separate, additive object. If
 * this file threw on every call, the app would behave exactly as it does today.
 */

export const DEEP_INTENT_SCHEMA = 'fbt.deep-intent.v7';

/* -------------------------------------------------------------------------- */
/*  NORMALISATION (local, tolerant — never throws)                             */
/* -------------------------------------------------------------------------- */

const AR_TO_FA = { 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ى': 'ی', 'ئ': 'ی' };
const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

export function normalizeDeep(raw) {
  return String(raw ?? '')
    .replace(/[يكةۀأإآؤىئ]/g, (c) => AR_TO_FA[c] || c)
    .replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] || d)
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/*  GOAL / OBJECTIVE                                                            */
/* -------------------------------------------------------------------------- */

export const GOALS = Object.freeze({
  MAXIMIZE_RETURN: 'maximize_return',
  PRESERVE_CAPITAL: 'preserve_capital',
  REDUCE_RISK: 'reduce_risk',
  GENERATE_INCOME: 'generate_income',
  REBALANCE: 'rebalance',
  UNDERSTAND: 'understand',
  EXIT: 'exit',
  ACCUMULATE: 'accumulate',
  MONITOR: 'monitor'
});

const GOAL_PATTERNS = [
  [GOALS.MAXIMIZE_RETURN, /(بیشترین\s*(بازده|سود)|حداکثر\s*(سود|بازده)|maximi[sz]e\s*(my\s*|the\s*)?(return|profit|yield)|بالاترین\s*سود|بیشترین\s*بازدهی|highest\s*return)/],
  [GOALS.PRESERVE_CAPITAL, /(حفظ\s*(سرمایه|ارزش)|از\s*دست\s*ندم|preserve\s*capital|protect\s*(my\s*)?capital|سرمایه.*محفوظ|ذخیره\s*(کنم|کن).*سود|سود.*ذخیره)/],
  [GOALS.REDUCE_RISK, /(ریسک(م| من)?\s*(را|رو)?\s*(کم|پایین|کاهش)|کم\s*ریسک|reduce\s*(the\s*)?risk|lower\s*risk|de-?risk|امن\s*تر)/],
  [GOALS.GENERATE_INCOME, /(درامد|درآمد|سود\s*(ثابت|ماهانه)|passive\s*income|yield|استیک|فارم|سپرده)/],
  [GOALS.REBALANCE, /(متعادل|بالانس|rebalanc|تخصیص\s*مجدد|توزیع\s*مجدد)/],
  [GOALS.EXIT, /(خارج\s*شم|نقد\s*کن|همه\s*(رو|را)\s*بفروش|exit\s*(my|the)|cash\s*out|liquidate)/],
  [GOALS.ACCUMULATE, /(جمع\s*کنم|انباشت|accumulate|پله\s*ای\s*بخر|dca|خرید\s*پلکانی)/],
  [GOALS.MONITOR, /(خبرم\s*کن|اطلاع\s*بده|alert\s*me|notify\s*me|رصد\s*کن|زیر\s*نظر|watch)/],
  [GOALS.UNDERSTAND, /(چطوره|چه\s*خبر|چرا|توضیح|تحلیل|بررسی\s*کن|how\s*is|why\s*(did|is)|explain|analy[sz]e|what.?s\s*happening)/]
];

export function extractGoal(text) {
  const t = normalizeDeep(text);
  const hits = [];
  for (const [goal, re] of GOAL_PATTERNS) if (re.test(t)) hits.push(goal);
  // "maximum return but not too much risk" is a risk-adjusted objective, not a
  // contradiction — the user said both on purpose.
  const riskAdjusted = hits.includes(GOALS.MAXIMIZE_RETURN) && (hits.includes(GOALS.REDUCE_RISK) || hits.includes(GOALS.PRESERVE_CAPITAL));
  return {
    goal: hits[0] || null,
    goals: hits,
    objective: riskAdjusted ? 'risk_adjusted_return' : (hits[0] ? `${hits[0]}` : null)
  };
}

/* -------------------------------------------------------------------------- */
/*  TIMEFRAME                                                                   */
/* -------------------------------------------------------------------------- */

const FA_NUMBER_WORDS = {
  'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'چار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6,
  'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'دوازده': 12, 'یکسال': 1,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, nine: 9, ten: 10, twelve: 12
};

const UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

function unitOf(word) {
  if (/روز|day/.test(word)) return 'day';
  if (/هفته|week/.test(word)) return 'week';
  if (/ماه|month/.test(word)) return 'month';
  if (/سال|year/.test(word)) return 'year';
  return null;
}

export function extractTimeframe(text) {
  const t = normalizeDeep(text);
  const numeric = t.match(/(\d+(?:\.\d+)?)\s*(روز|هفته|ماهه|ماه|ساله|سال|days?|weeks?|months?|years?)/);
  if (numeric) {
    const unit = unitOf(numeric[2]);
    const value = Number(numeric[1]);
    if (unit && Number.isFinite(value)) {
      return { value, unit, days: value * UNIT_DAYS[unit], label: `${value}_${unit}s`, raw: numeric[0] };
    }
  }
  const worded = t.match(/(یک|یه|دو|سه|چهار|چار|پنج|شش|شیش|هفت|هشت|نه|ده|دوازده|one|two|three|four|five|six|nine|ten|twelve)\s*(روز|هفته|ماهه|ماه|ساله|سال|days?|weeks?|months?|years?)/);
  if (worded) {
    const unit = unitOf(worded[2]);
    const value = FA_NUMBER_WORDS[worded[1]];
    if (unit && value) {
      return { value, unit, days: value * UNIT_DAYS[unit], label: `${value}_${unit}s`, raw: worded[0] };
    }
  }
  if (/(کوتاه\s*مدت|short\s*term|زودی|فوری)/.test(t)) return { value: 1, unit: 'month', days: 30, label: 'short_term', approximate: true };
  if (/(بلند\s*مدت|long\s*term|چند\s*سال)/.test(t)) return { value: 2, unit: 'year', days: 730, label: 'long_term', approximate: true };
  return null;
}

/* -------------------------------------------------------------------------- */
/*  RISK                                                                        */
/* -------------------------------------------------------------------------- */

export function extractRisk(text) {
  const t = normalizeDeep(text);
  // Negations first: "ریسک خیلی بالا نباشه" is NOT high risk.
  if (/ریسک[^.]{0,20}(خیلی\s*)?(بالا|زیاد|بالایی)[^.]{0,12}(نباشه|نباشد|نمی\s*خوام|نخواستم|not)/.test(t)) {
    return { level: 'not_high', tolerance: 'medium', explicit: true, negated: true };
  }
  if (/(no\s*(high\s*)?risk|not\s*(too\s*)?risky|بدون\s*ریسک|ریسک\s*نکنم)/.test(t)) {
    return { level: 'low', tolerance: 'low', explicit: true };
  }
  if (/(ریسک\s*(بالا|زیاد|تهاجمی)|high\s*risk|aggressive|تهاجمی|پر\s*ریسک)/.test(t)) {
    return { level: 'high', tolerance: 'high', explicit: true };
  }
  if (/(ریسک\s*(متوسط|میانه)|medium\s*risk|moderate|بالانس)/.test(t)) {
    return { level: 'medium', tolerance: 'medium', explicit: true };
  }
  if (/(ریسک\s*(کم|پایین)|low\s*risk|conservative|محافظه\s*کار|امن)/.test(t)) {
    return { level: 'low', tolerance: 'low', explicit: true };
  }
  return { level: null, tolerance: null, explicit: false };
}

/* -------------------------------------------------------------------------- */
/*  CAPITAL SOURCE / AMOUNT                                                     */
/* -------------------------------------------------------------------------- */

export function extractCapitalSource(text) {
  const t = normalizeDeep(text);
  if (/(سرمایه\s*(فعلی|موجود)(م|ام)?|پرتفوی\s*(فعلی|من|م)|همین\s*که\s*دارم|current\s*(portfolio|capital)|my\s*(existing\s*)?portfolio|با\s*دارایی\s*(م|فعلی))/.test(t)) {
    return 'current_portfolio';
  }
  if (/(موجودی\s*کیف|والت(م|ام)?|wallet\s*balance|از\s*کیف\s*پول)/.test(t)) return 'wallet';
  if (/(پول\s*جدید|واریز|deposit|شارژ\s*کنم|new\s*capital)/.test(t)) return 'new_deposit';
  return null;
}

export function extractAmount(text) {
  const t = normalizeDeep(text);
  const pct = t.match(/(\d+(?:\.\d+)?)\s*(?:٪|%|درصد|percent)/);
  const usd = t.match(/(?:\$|usd|dollars?|دلار|تتر|usdt|usdc)\s*(\d+(?:[.,]\d+)*)|(\d+(?:[.,]\d+)*)\s*(?:\$|usd|dollars?|دلار|تتر|usdt|usdc)/);
  const half = /(نصف|نیمی|half)/.test(t);
  const all = /(همه\s*(ی|‌ای)?\s*(دارایی|پول|سرمایه)|کل\s*(سرمایه|پرتفوی)|all\s*(of\s*)?my|everything)/.test(t);
  const part = /(بخشی|قسمتی|مقداری|some\s*of|part\s*of)/.test(t);
  return {
    percent: pct ? Number(pct[1]) : (half ? 50 : (all ? 100 : null)),
    usd: usd ? Number(String(usd[1] || usd[2]).replace(/,/g, '')) : null,
    qualifier: all ? 'all' : half ? 'half' : part ? 'partial' : null,
    isRelative: Boolean(half || all || part || pct)
  };
}

/* -------------------------------------------------------------------------- */
/*  TARGET RETURN                                                               */
/* -------------------------------------------------------------------------- */

export function extractTargetReturn(text) {
  const t = normalizeDeep(text);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:٪|%|درصد|percent)\s*(?:سود|بازده|return|profit|رشد)?/);
  if (m && /(سود|بازده|return|profit|رشد|target|هدف)/.test(t)) return { pct: Number(m[1]) };
  const money = t.match(/(?:به|to|تا)\s*(?:\$)?\s*(\d[\d,]{3,})\s*(?:\$|دلار|usd)?/);
  if (money && /(برسون|برسه|هدف|target|grow|رشد)/.test(t)) return { targetValueUsd: Number(money[1].replace(/,/g, '')) };
  return null;
}

/* -------------------------------------------------------------------------- */
/*  URGENCY · CONSTRAINTS · PREFERENCES                                         */
/* -------------------------------------------------------------------------- */

export function extractUrgency(text) {
  const t = normalizeDeep(text);
  if (/(فوری|همین\s*الان|سریع|urgent|right\s*now|asap|زود\s*باش)/.test(t)) return 'high';
  if (/(وقت\s*دارم|عجله\s*ای\s*نیست|no\s*rush|whenever|بعدا)/.test(t)) return 'low';
  return 'normal';
}

export function extractConstraints(text) {
  const t = normalizeDeep(text);
  const out = [];
  if (/(بدون\s*(کارمزد|فی)\s*(بالا|زیاد)|کارمزد\s*کم|low\s*fee|cheap\s*gas|گس\s*کم)/.test(t)) out.push({ kind: 'fee', value: 'low' });
  if (/(فقط\s*(روی|در)\s*(سولانا|solana))/.test(t)) out.push({ kind: 'chain', value: 'solana' });
  if (/(فقط\s*استیبل|only\s*stable|استیبل\s*کوین\s*فقط)/.test(t)) out.push({ kind: 'asset_class', value: 'stable' });
  if (/(بدون\s*اهرم|no\s*leverage|اهرم\s*نه)/.test(t)) out.push({ kind: 'leverage', value: 'none' });
  if (/(نفروش|نمی\s*خوام\s*بفروشم|don.?t\s*sell|بدون\s*فروش)/.test(t)) out.push({ kind: 'no_sell', value: true });
  if (/(حلال|شرعی|halal|sharia)/.test(t)) out.push({ kind: 'compliance', value: 'halal' });
  return out;
}

export function extractPreferences(text) {
  const t = normalizeDeep(text);
  const prefs = {};
  if (/(خلاصه|کوتاه|briefly|short\s*answer|مختصر)/.test(t)) prefs.verbosity = 'short';
  if (/(کامل|مفصل|جزئیات|detailed|in\s*detail)/.test(t)) prefs.verbosity = 'detailed';
  if (/(خودت\s*انجام\s*بده|اتومات|auto)/.test(t)) prefs.autonomy = 'high';
  if (/(قبلش\s*بپرس|از\s*من\s*بپرس|ask\s*me\s*first)/.test(t)) prefs.autonomy = 'low';
  return prefs;
}

/* -------------------------------------------------------------------------- */
/*  ACTION                                                                      */
/* -------------------------------------------------------------------------- */

export const ACTIONS = Object.freeze({
  ANALYZE: 'analyze', BUY: 'buy', SELL: 'sell', SWAP: 'swap', BRIDGE: 'bridge',
  SEND: 'send', REBALANCE: 'rebalance', STAKE: 'stake', LEND: 'lend',
  ALERT: 'alert', SCHEDULE: 'schedule', COMPARE: 'compare', PLAN: 'plan', NAVIGATE: 'navigate'
});

const ACTION_PATTERNS = [
  [ACTIONS.ALERT, /(اگر|وقتی|هر\s*وقت|if|when)[^.]{0,40}(خبرم\s*کن|اطلاع\s*بده|notify|alert|هشدار)/],
  [ACTIONS.SCHEDULE, /(هر\s*(ماه|هفته|روز)|ماهانه|هفتگی|روزانه|every\s*(month|week|day)|monthly|weekly|recurring|مرتب)/],
  [ACTIONS.REBALANCE, /(متعادل|بالانس|rebalanc)/],
  [ACTIONS.COMPARE, /(مقایسه|compare|کدوم\s*بهتر|versus|\bvs\b|نسبت\s*به\s*قبلی)/],
  [ACTIONS.SWAP, /(سواپ|تبدیل\s*کن|swap|convert)/],
  [ACTIONS.BRIDGE, /(بریج|پل\s*بزن|bridge|منتقل\s*کن\s*به\s*شبکه)/],
  [ACTIONS.SEND, /(بفرست|ارسال\s*کن|انتقال\s*بده|send\s*to|transfer\s*to)/],
  [ACTIONS.BUY, /(بخر|خرید\s*کن|buy|purchase)/],
  [ACTIONS.SELL, /(بفروش|فروش\s*کن|sell)/],
  [ACTIONS.STAKE, /(استیک|stake|سپرده\s*گذاری)/],
  [ACTIONS.LEND, /(وام\s*بده|lend|قرض\s*بده)/],
  [ACTIONS.PLAN, /(برنامه|استراتژی|plan|strategy|چیکار\s*کنم|چه\s*کنم|what\s*should\s*i)/],
  [ACTIONS.ANALYZE, /(تحلیل|بررسی|چطوره|چه\s*خبر|analy[sz]e|review|چرا)/]
];

export function extractAction(text) {
  const t = normalizeDeep(text);
  for (const [action, re] of ACTION_PATTERNS) if (re.test(t)) return action;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  §2 HIDDEN INTENT DETECTION                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "بیت‌کوین الان چطوره؟" is never only a price question. The user is standing in
 * a wallet app with money on the line: price, trend, risk, whether to buy, and
 * what it means for what they already hold are all live questions. We answer the
 * bundle without asking five follow-ups first (§2, §19).
 */
export function detectHiddenIntents(text, { primaryIntent = null, context = {} } = {}) {
  const t = normalizeDeep(text);
  const type = String(primaryIntent || '').toUpperCase();
  const hidden = [];
  const push = (id, why, weight) => hidden.push({ id, reason: why, weight });

  const asksAboutAsset = /(چطوره|چه\s*خبر|وضعیت|how\s*is|what.?s\s*up\s*with|قیمت|price)/.test(t);
  const hasPortfolio = Boolean(context.portfolio?.totalValueUsd || context.portfolio?.holdings?.length);

  if (type === 'ANALYZE_TOKEN' || (asksAboutAsset && (context.asset || /btc|eth|sol|بیت|اتر|سولانا/.test(t)))) {
    push('price', 'asset named in a question', 0.95);
    push('trend', 'a price without direction answers nothing', 0.9);
    push('risk', 'the user holds money in this app', 0.8);
    push('buy_opportunity', 'asking about an asset usually precedes a decision', 0.65);
    if (hasPortfolio) push('portfolio_impact', 'user has holdings that this asset moves', 0.7);
  }

  if (type === 'PORTFOLIO_ANALYSIS') {
    push('allocation', 'portfolio question implies composition', 0.9);
    push('risk', 'concentration is the first thing a portfolio review owes', 0.85);
    push('performance', 'users measure a portfolio by its return', 0.8);
    push('optimization', 'the unspoken follow-up is always "what should I change"', 0.6);
  }

  if (/(چرا|why)[^.]{0,30}(ریخت|افتاد|پامپ|رشد|dump|crash|drop|pump|rall)/.test(t)) {
    push('price_move_cause', 'explicit causal question', 0.95);
    push('news', 'a move is explained by events', 0.85);
    push('onchain_signal', 'flows explain what headlines do not', 0.7);
    push('macro', 'crypto moves with liquidity', 0.6);
  }

  if (/(سود|yield|apy|بازده)/.test(t) && /(کجا|بهترین|best|where|پیدا)/.test(t)) {
    push('yield_discovery', 'explicit yield search', 0.9);
    push('risk', 'a yield number without its risk is a trap', 0.85);
    push('liquidity', 'exit matters as much as entry', 0.6);
  }

  if (type === 'SWAP' || type === 'BUY' || type === 'SELL') {
    push('best_route', 'execution quality is part of the request', 0.8);
    push('fees', 'gas and slippage change the answer', 0.75);
    push('timing', 'users want to know if now is a bad moment', 0.5);
  }

  // De-duplicate, strongest first.
  const seen = new Set();
  return hidden
    .sort((a, b) => b.weight - a.weight)
    .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
}

/* -------------------------------------------------------------------------- */
/*  MAIN — buildDeepIntent                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Consumes the existing `understandIntent()` result and adds the second
 * dimension. Never mutates the input.
 *
 * @param {string} message  raw user text
 * @param {object} baseIntent  output of understandIntent() (optional)
 * @param {object} context  { portfolio, wallet, goalMemory, asset, ... }
 */
export function buildDeepIntent(message, baseIntent = {}, context = {}) {
  const text = String(message || '');
  const goalInfo = extractGoal(text);
  const timeframe = extractTimeframe(text);
  const risk = extractRisk(text);
  const amount = extractAmount(text);
  const capitalSource = extractCapitalSource(text);
  const targetReturn = extractTargetReturn(text);
  const constraints = extractConstraints(text);
  const preferences = extractPreferences(text);
  const urgency = extractUrgency(text);
  const action = extractAction(text) || (baseIntent.readOnly ? ACTIONS.ANALYZE : null);
  const hiddenIntents = detectHiddenIntents(text, { primaryIntent: baseIntent.type || baseIntent.primaryIntent, context });

  const entities = baseIntent.entities || {};
  const assets = [];
  for (const sym of entities.tokens || []) assets.push(String(sym).toUpperCase());
  if (entities.token && !assets.includes(String(entities.token).toUpperCase())) assets.push(String(entities.token).toUpperCase());
  if (!assets.length && context.asset) assets.push(String(context.asset).toUpperCase());

  /*
   * §18 Goal memory: an unstated slot inherits the value the user already gave
   * in this conversation. "حالا همین را برای BTC انجام بده" keeps the goal,
   * timeframe and risk and swaps only the asset.
   */
  const mem = context.goalMemory || {};
  const inherited = [];
  const resolved = {
    goal: goalInfo.goal || (mem.goal ?? null),
    objective: goalInfo.objective || (mem.objective ?? null),
    timeframe: timeframe || (mem.timeframe ?? null),
    risk: risk.explicit ? risk : (mem.risk ?? risk),
    targetReturn: targetReturn || (mem.targetReturn ?? null),
    capitalSource: capitalSource || (mem.capitalSource ?? null)
  };
  if (!goalInfo.goal && mem.goal) inherited.push('goal');
  if (!timeframe && mem.timeframe) inherited.push('timeframe');
  if (!risk.explicit && mem.risk) inherited.push('risk');
  if (!targetReturn && mem.targetReturn) inherited.push('targetReturn');
  if (!capitalSource && mem.capitalSource) inherited.push('capitalSource');

  /*
   * "maximum return, but not too much risk" states a return goal and a risk
   * ceiling in one breath. `extractGoal` only sees the words; the risk ceiling
   * lives in `extractRisk` (which understands the negation). Combining them
   * here is what turns two half-signals into the objective the user actually
   * described: a RISK-ADJUSTED return.
   */
  const riskCeiling = resolved.risk?.level && ['low', 'medium', 'not_high'].includes(resolved.risk.level);
  if (resolved.goal === GOALS.MAXIMIZE_RETURN && riskCeiling) resolved.objective = 'risk_adjusted_return';

  /*
   * «می‌خوام ۲۰٪ سود کنم» names no goal word at all — the goal IS the number.
   * A stated target return (or target portfolio value) is a growth objective,
   * so it fills the goal slot when nothing more specific was said. Without this
   * the goal never reaches memory and the follow-up turn ("حالا همین را برای
   * BTC") has nothing to carry.
   */
  if (!resolved.goal && resolved.targetReturn) {
    resolved.goal = GOALS.MAXIMIZE_RETURN;
    resolved.objective = riskCeiling ? 'risk_adjusted_return' : GOALS.MAXIMIZE_RETURN;
  }

  const why = deriveWhy({ goal: resolved.goal, action, hiddenIntents });

  const slots = {
    what: baseIntent.type || baseIntent.primaryIntent || 'GENERAL',
    why,
    goal: resolved.goal,
    objective: resolved.objective,
    context: {
      currentPage: context.currentPage || null,
      hasWallet: Boolean(context.wallet?.connected || context.wallet?.isConnected),
      hasPortfolio: Boolean(context.portfolio?.totalValueUsd != null || context.portfolio?.holdings?.length),
      capitalSource: resolved.capitalSource
    },
    constraints,
    timeframe: resolved.timeframe,
    risk: resolved.risk,
    assets,
    amount,
    action,
    urgency,
    userPreference: preferences
  };

  const filled = countFilled(slots);
  return {
    schema: DEEP_INTENT_SCHEMA,
    ...slots,
    targetReturn: resolved.targetReturn,
    hiddenIntents,
    inheritedFromMemory: inherited,
    completeness: filled.ratio,
    filledSlots: filled.filled,
    totalSlots: filled.total,
    raw: text,
    createdAt: Date.now()
  };
}

function deriveWhy({ goal, action, hiddenIntents }) {
  if (goal === GOALS.MAXIMIZE_RETURN) return 'grow_capital';
  if (goal === GOALS.REDUCE_RISK || goal === GOALS.PRESERVE_CAPITAL) return 'protect_capital';
  if (goal === GOALS.GENERATE_INCOME) return 'earn_yield';
  if (goal === GOALS.EXIT) return 'realize_or_exit';
  if (goal === GOALS.MONITOR) return 'stay_informed';
  if (action === ACTIONS.COMPARE) return 'choose_between_options';
  if (hiddenIntents.some((h) => h.id === 'buy_opportunity')) return 'evaluate_entry';
  if (action === ACTIONS.ANALYZE) return 'make_an_informed_decision';
  return null;
}

function countFilled(slots) {
  const keys = ['goal', 'timeframe', 'action', 'urgency'];
  let filled = 0;
  if (slots.goal) filled++;
  if (slots.timeframe) filled++;
  if (slots.action) filled++;
  if (slots.risk?.level) filled++;
  if (slots.assets?.length) filled++;
  if (slots.amount?.percent != null || slots.amount?.usd != null) filled++;
  const total = keys.length + 2;
  return { filled, total, ratio: Math.round((filled / total) * 100) / 100 };
}

/**
 * §19/§20 — what is genuinely missing, given everything already known.
 * Returns at most ONE question, and only when it cannot be inferred.
 */
export function missingCriticalSlots(deep, { requireForExecution = false } = {}) {
  const missing = [];
  const needsFinancialPlan = [GOALS.MAXIMIZE_RETURN, GOALS.GENERATE_INCOME, GOALS.ACCUMULATE].includes(deep.goal);

  if (needsFinancialPlan && !deep.timeframe) missing.push({ slot: 'timeframe', priority: 1, expectedType: 'duration' });
  if (needsFinancialPlan && !deep.risk?.level) missing.push({ slot: 'risk', priority: 2, expectedType: 'risk_level' });
  if (requireForExecution) {
    if (!deep.assets?.length) missing.push({ slot: 'asset', priority: 0, expectedType: 'token' });
    if (deep.amount?.percent == null && deep.amount?.usd == null) missing.push({ slot: 'amount', priority: 1, expectedType: 'amount' });
  }
  // Already known from portfolio/wallet? Then it is not missing (§19).
  const known = deep.context || {};
  const filtered = missing.filter((m) => !(m.slot === 'amount' && known.capitalSource === 'current_portfolio'));
  filtered.sort((a, b) => a.priority - b.priority);
  return filtered;
}
