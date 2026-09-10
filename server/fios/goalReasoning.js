/**
 * FBT FINANCIAL INTELLIGENCE OS — Goal Reasoning (Phase 212, upgrade 18).
 * ---------------------------------------------------------------------------
 * «تا چهار ماه دیگه می‌خوام حداقل ۲۰ درصد جلو باشم ولی بیشتر از ۱۰ درصد ضرر
 * نکنم» must become a machine-readable constraint set BEFORE any strategy is
 * generated — otherwise the strategy layer plans for the wrong person:
 *
 *   { goal: 'capital_growth', targetReturnPct: 20, horizonMonths: 4,
 *     maxDrawdownPct: 10, risk: 'moderate', budgetUsd: null }
 *
 * WHAT THIS IS
 * A deterministic reasoner over the intent text (fa/en), because a wrong parse
 * becomes a wrong trade. It extracts the eight fields the decision layer needs
 * — goal kind, target return, horizon, max drawdown, risk band, budget,
 * liquidity need and permissions — and NEVER guesses a missing field: an
 * absent field stays null and the conversation engine turns it into the next
 * adaptive question (see conversationState.js).
 *
 * WHAT THIS IS NOT
 * Not a classifier replacement. classify() still decides the intent type; this
 * module reads the SAME text for the structured goal constraints, and the
 * decision/council/why engines consume both.
 */

export const GOAL_REASONING_SCHEMA = 'fbt.fi.goal-reasoning.v1';

export const GOAL_KINDS = Object.freeze([
  'capital_growth', 'income', 'capital_preservation', 'speculation', 'debt_reduction', 'savings'
]);

export const RISK_BANDS = Object.freeze(['conservative', 'moderate', 'aggressive']);

const PCT_RE = /(\d+(?:[.,]\d+)?)/;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Persian/Arabic digits → Latin, so «۲۰٪» and «20%» parse identically. */
export function normalizeDigits(text = '') {
  const map = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
  return String(text || '').replace(/[۰-۹٠-٩]/g, (d) => map[d] || d).replace(/٪/g, '%');
}

/* JS \b is defined over [A-Za-z0-9_] — Persian letters are NOT word chars,
   so `درصد\b` never matches. This lookahead is the Persian-aware boundary:
   "not followed by another letter of either alphabet". */
const NOT_LETTER = '(?![\\u0600-\\u06FFa-zA-Z])';

/** "چهار ماه" / "4 months" / "۴ ماهگی" → months. Persian compound numbers
 *  (سه‌ماهه، شش ماهه) and English (a year, 90 days) both resolve. */
export function extractHorizonMonths(text = '') {
  const t = normalizeDigits(String(text || ''));
  const words = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12
  };
  let m = t.match(new RegExp(`(\\d+)\\s*(?:ماه|ماهه|months?|mo)${NOT_LETTER}`, 'i'));
  if (m) return Math.max(1, Math.min(120, Number(m[1])));
  m = t.match(new RegExp(`(\\d+)\\s*(?:سال|سالانه|years?|yr)${NOT_LETTER}`, 'i'));
  if (m) return Math.max(1, Math.min(50, Number(m[1]) * 12));
  m = t.match(new RegExp(`(\\d+)\\s*(?:هفته|weeks?)${NOT_LETTER}`, 'i'));
  if (m) return Math.max(1, Math.round(Number(m[1]) / 4.33));
  m = t.match(new RegExp(`(\\d+)\\s*(?:روز|days?)${NOT_LETTER}`, 'i'));
  if (m) return Math.max(1, Math.round(Number(m[1]) / 30.4));
  m = t.match(new RegExp(`(?:^|\\s)(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|یک|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده)\\s*(?:ماه|months?)${NOT_LETTER}`, 'i'));
  if (m) return words[String(m[1]).toLowerCase()] || null;
  if (/\b(?:یک\s*)?سال(?:ه| دیگر| دیگه| بعد)?\b|\ba year\b/i.test(t)) return 12;
  if (/\b(?:شش|۶|6)\s*ماه(?:ه)?\b|\bhalf a year\b|\bsix months\b/i.test(t)) return 6;
  if (/\b(?:سه|۳|3)\s*ماه(?:ه)?\b|\bthree months\b|\bquarter\b/i.test(t)) return 3;
  if (/\b(?:یک|۱|1)\s*ماه(?:ه)?\b|\bone month\b|\bmonthly\b/i.test(t)) return 1;
  return null;
}

/** "۲۰ درصد" / "20 percent" / "2x" / "دو برابر" → percent. Doubles become
 *  +100%, «برابر» is the Persian way users say multiples. */
export function extractTargetReturnPct(text = '') {
  const t = normalizeDigits(String(text || ''));
  let m = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:درصد|در صد|%|percent|pct|basis points|bp)${NOT_LETTER}`, 'i'));
  if (m) {
    const v = Number(m[1].replace(',', '.'));
    if (/basis points|bp(?![a-z])/i.test(t) && v <= 1000) return Math.round(v / 100 * 100) / 100;
    return Math.round(v * 100) / 100;
  }
  m = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:برابر|×|x)${NOT_LETTER}`, 'i')) || t.match(/(?:^|\s)(\d+(?:[.,]\d+)?)x(?![a-z])/i);
  if (m) return Math.round((Number(m[1].replace(',', '.')) - 1) * 10000) / 100;
  m = t.match(/\bدو\s*برابر\b|\bdouble\b|\b2x\b/i);
  if (m) return 100;
  return null;
}

/** «بیشتر از ۱۰ درصد ضرر نکنم» / "max 10% drawdown" → percent. */
export function extractMaxDrawdownPct(text = '') {
  const t = normalizeDigits(String(text || ''));
  const loss = t.match(/(?:حداکثر|بیشتر از|زیر|کمتر از|به اندازه|at most|max(?:imum)?|no more than|less than|under)\s*(\d+(?:[.,]\d+)?)\s*(?:درصد|در صد|٪|%|percent|pct)\s*(?:ضرر|افت|ریزش|کاهش|loss|drawdown|down|ضرر نکنم|نکنم)/i)
    || t.match(/(\d+(?:[.,]\d+)?)\s*(?:درصد|در صد|٪|%|percent|pct)\s*(?:ضرر|افت|loss|drawdown)/i)
    || t.match(/(?:drawdown|loss)\s*(?:of|at most|max)?\s*(\d+(?:[.,]\d+)?)\s*(?:درصد|٪|%|percent|pct)?/i);
  if (loss) return Math.round(Number(loss[1].replace(',', '.')) * 100) / 100;
  return null;
}

function extractGoalKind(text = '') {
  const t = String(text || '');
  if (/سود (جذبی|ماهانه)|درآمد (منظم|ماهانه)|dividend|yield income|monthly income|کسب درآمد/i.test(t)) return 'income';
  if (/حفظ (سرمایه|اصلی)|capital preservation|پولم سالم|ضمانت اصل|نبض?رسم/i.test(t)) return 'capital_preservation';
  if (/تسویه|بدهی|debt|loan payoff|وامم رو ببندم/i.test(t)) return 'debt_reduction';
  if (/پس‌انداز|پس انداز|saving|خرید خانه|خرید ماشین/i.test(t)) return 'savings';
  if (/قمار|شانس|speculat|پامپ/i.test(t)) return 'speculation';
  if (/سود کنم|سود کردن|profit|رشد|بریم جلو|جلو باشم|capital growth|بیشترش کنم|augment|بالا بردم/i.test(t)) return 'capital_growth';
  return null;
}

function extractRiskBand(text = '') {
  const t = String(text || '');
  if (/ریسک (پایین|کم)|low risk|امن و مطمئن|محافظه‌کار|محافظه کار|conservative/i.test(t)) return 'conservative';
  if (/ریسک (بالا|زیاد)|high risk|تهاجمی|جنگجو|aggressive|all.?in/i.test(t)) return 'aggressive';
  if (/ریسک متوسط|moderate|متعادل|balanced|میانه/i.test(t)) return 'moderate';
  return null;
}

function extractBudgetUsd(text = '') {
  const t = normalizeDigits(String(text || ''));
  const NUMBER = '((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)';
  let m = t.match(new RegExp(`(?:\\$|usd|دلار|دلاری)\\s*${NUMBER}(\\s*(?:k|m|هزار|میلیون))?`, 'i')) || t.match(new RegExp(`${NUMBER}\\s*(?:k|m|هزار|میلیون)?\\s*(?:دلار|usd|dollars)`, 'i'));
  if (!m) return null;
  const raw = String(m[1]).replace(/,/g, '');
  let v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = String(m[2] || '').toLowerCase();
  if (/^k$|هزار/.test(unit)) v *= 1_000;
  else if (/^m$|میلیون/.test(unit)) v *= 1_000_000;
  return Math.round(v * 100) / 100;
}

function extractLiquidityNeed(text = '') {
  const t = String(text || '');
  if (/هر وقت خواستم|فوری|بلافاصله|نقد|liquid|withdraw anytime|quick access|به پول دسترسی/i.test(t)) return 'high';
  if (/قفل|lock|نمی‌خوام بردارم|long term|بلندمدت|لاک/i.test(t)) return 'low';
  return null;
}

function extractPermissions(text = '') {
  const t = String(text || '');
  const out = [];
  if (/خودکار|autopilot|اتومات|automatic|دستت آزاده|بدون پرسیدن/i.test(t)) out.push('autonomous_within_policy');
  if (/اول ازم بپرس|همیشه تأیید|always confirm|تأیید من|صبر کن من/i.test(t)) out.push('confirm_each');
  return out;
}

/**
 * The full reasoner. Total (never throws); every field is either a REAL
 * extraction or null — the conversation engine decides what to ask next.
 *
 * @param {string} text the raw user message
 * @param {object} [context] { state, preferences } — used only to keep fields
 *        the user already answered elsewhere (explicit text still wins).
 */
export function reasonAboutGoal(text = '', { preferences = null } = {}) {
  const t = String(text || '');
  const targetReturnPct = extractTargetReturnPct(t);
  const maxDrawdownPct = extractMaxDrawdownPct(t);
  const horizonMonths = extractHorizonMonths(t);
  const risk = extractRiskBand(t);
  /* A drawdown cap IS a risk statement: «بیشتر از ۱۰٪ ضرر نکنم» with no band
     word means conservative-to-moderate, and the derived band is labelled. */
  let derivedRisk = null;
  let riskSource = risk ? 'stated' : null;
  if (!risk && maxDrawdownPct !== null) {
    derivedRisk = maxDrawdownPct <= 10 ? 'conservative' : maxDrawdownPct <= 25 ? 'moderate' : 'aggressive';
    riskSource = 'derived-from-drawdown';
  }
  return {
    schema: GOAL_REASONING_SCHEMA,
    goal: extractGoalKind(t),
    targetReturnPct,
    horizonMonths,
    maxDrawdownPct,
    risk: risk || derivedRisk,
    riskSource,
    budgetUsd: extractBudgetUsd(t),
    liquidityNeed: extractLiquidityNeed(t),
    permissions: extractPermissions(t),
    /* What the reasoner could NOT read — the adaptive-question fuel. */
    missing: [
      ...(extractGoalKind(t) ? [] : ['goal']),
      ...(targetReturnPct !== null ? [] : ['targetReturnPct']),
      ...(horizonMonths !== null ? [] : ['horizonMonths']),
      ...(maxDrawdownPct !== null ? [] : ['maxDrawdownPct']),
      ...(extractBudgetUsd(t) !== null ? [] : ['budgetUsd'])
    ],
    preferencesFallback: preferences || null,
    estimate: true,
    note: 'deterministic fa/en goal reasoning; null fields are questions, never guesses'
  };
}

/** Reachability sanity: a 4-month 20% target needs ~80% annualized — the
 *  honest ceiling check the planner uses before promising anything. */
export function requiredAnnualizedPct({ targetReturnPct = null, horizonMonths = null } = {}) {
  const target = num(targetReturnPct);
  const months = num(horizonMonths);
  if (target === null || months === null || months <= 0) return null;
  const factor = Math.pow(1 + target / 100, 12 / months);
  return Math.round((factor - 1) * 10000) / 100;
}
