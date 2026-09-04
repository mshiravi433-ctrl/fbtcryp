/**
 * FBT AI / Intent OS — UPGRADE 6
 * Slot Filling Engine + Short Answer Understanding + Reference Resolver
 * Spec §7, §8, §10, §11, §20, §21, §33
 */

// Persian digit maps
const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const FA_WORD_NUMBERS = {
  'یک': 1, 'یکی': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
  'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'پانزده': 15, 'شانزده': 16, 'هفده': 17, 'هجده': 18, 'نوزده': 19, 'بیست': 20,
  'اول': 1, 'اولی': 1, 'دوم': 2, 'دومی': 2, 'سوم': 3, 'سومی': 3
};

function normalizeText(input) {
  let s = String(input ?? '');
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '');
  s = s.replace(/[\u064B-\u0652\u0670]/g, '');
  s = s.replace(/\u0640/g, '');
  s = s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه');
  s = s.replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] || d);
  s = s.replace(/[\u200c]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

// Slot definitions per intent
export const SLOT_DEFINITIONS = Object.freeze({
  GOAL_PROFIT: {
    goal: { type: 'goal', required: true },
    targetReturn: { type: 'percent', required: true },
    timeframe: { type: 'duration', required: true },
    capital: { type: 'amount', required: false },
    risk: { type: 'risk', required: false }
  },
  FORECAST: {
    asset: { type: 'asset', required: true },
    timeframe: { type: 'duration', required: true },
    scenario: { type: 'scenario', required: false }
  },
  PORTFOLIO_ANALYSIS: {
    analysisType: { type: 'analysisType', required: false }
  },
  SWAP: {
    fromToken: { type: 'asset', required: true },
    toToken: { type: 'asset', required: true },
    amount: { type: 'amount', required: true }
  },
  GENERAL: {}
});

/**
 * Parse short answers — Spec §10
 * "بله", "نه", "۴ ماه", "۲۰ درصد", "همین", "اولی", "دومی", "انجام بده", "لغو کن", "ادامه بده", "آره", "نه فعلاً", "بیشتر توضیح بده"
 */
export function parseShortAnswer(text) {
  const t = normalizeText(text);
  if (!t) return { type: 'empty', confidence: 0 };

  // Confirmation
  if (/^(بله|آره|آری|باشه|اوکی|ok|yes|yep|yeah|confirm|انجام بده|انجامش بده|ادامه بده|ادامه|تایید|تأیید)$/.test(t)) {
    return { type: 'confirm', value: true, confidence: 0.99, raw: text };
  }
  if (/^(نه|نخیر|نه فعلا|فعلا نه|لغو کن|کنسل|بی خیال|no|nope|cancel|stop)$/.test(t)) {
    return { type: 'reject', value: false, confidence: 0.99, raw: text };
  }
  if (/^(بیشتر توضیح بده|توضیح بده|بیشتر|more|explain)$/.test(t)) {
    return { type: 'more_info', value: 'more', confidence: 0.95, raw: text };
  }

  // Duration parsing — "۴ ماه" → 4 months
  const duration = parseDuration(t);
  if (duration) {
    return { type: 'duration', value: duration, confidence: 0.99, raw: text, normalized: `${duration.value} ${duration.unit}` };
  }

  // Percent — "۲۰ درصد" → 20%
  const percent = parsePercent(t);
  if (percent) {
    return { type: 'percent', value: percent, confidence: 0.99, raw: text };
  }

  // Amount — "$10,000", "100 دلار"
  const amount = parseAmount(t);
  if (amount) {
    return { type: 'amount', value: amount, confidence: 0.95, raw: text };
  }

  // Selection — "اولی", "دومی", "همین"
  const selection = parseSelection(t);
  if (selection) {
    return { type: 'selection', value: selection, confidence: 0.90, raw: text };
  }

  // Reference — "همون قبلی", "این یکی", "همون بیت‌کوین", "با همین سرمایه"
  const reference = parseReference(t);
  if (reference) {
    return { type: 'reference', value: reference, confidence: 0.85, raw: text };
  }

  return { type: 'text', value: text, confidence: 0.5, raw: text };
}

export function parseDuration(text) {
  const t = normalizeText(text);
  // 4 ماه, 4 months, 2 سال, 30 روز
  let m = t.match(/(\d+(?:[.,]\d+)?|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)\s*(ماه|ماهه|month|months|سال|ساله|year|years|روز|روزه|day|days|هفته|week|weeks)/);
  if (!m) {
    // Bare "4 ماه" may have number as word
    m = t.match(/(یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|\d+)\s*(ماه|سال|روز|هفته)/);
  }
  if (m) {
    let numStr = m[1];
    let num = Number(numStr);
    if (Number.isNaN(num)) num = FA_WORD_NUMBERS[numStr] || 0;
    if (num <= 0) return null;
    let unit = m[2];
    if (/ماه/.test(unit) || /month/.test(unit)) unit = 'months';
    else if (/سال/.test(unit) || /year/.test(unit)) unit = 'years';
    else if (/روز/.test(unit) || /day/.test(unit)) unit = 'days';
    else if (/هفته/.test(unit) || /week/.test(unit)) unit = 'weeks';
    else unit = 'months';
    return { value: num, unit, months: unit === 'months' ? num : unit === 'years' ? num * 12 : null, raw: text };
  }
  // Just "4 ماه" without regex above? try simpler
  if (/^\s*\d+\s*ماه/.test(t) || /^\d+\s*ماه/.test(text)) {
    const n = parseInt(t, 10);
    if (n) return { value: n, unit: 'months', months: n, raw: text };
  }
  return null;
}

export function parsePercent(text) {
  const t = normalizeText(text);
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*(درصد|٪|%|percent)/);
  if (m) {
    const v = Number(m[1].replace(',', '.'));
    if (Number.isFinite(v)) return { value: v, decimal: v / 100, raw: text };
  }
  return null;
}

export function parseAmount(text) {
  const t = normalizeText(text);
  // $10,000 or 10000 دلار
  let m = t.match(/\$?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(دلار|usd|\$)?/i);
  if (m) {
    const rawNum = m[1].replace(/[,\s]/g, '');
    const num = Number(rawNum);
    if (Number.isFinite(num) && num > 0) {
      return { value: num, currency: 'USD', raw: text };
    }
  }
  return null;
}

export function parseSelection(text) {
  const t = normalizeText(text);
  if (/^(همین|همینو|همون|همین یکی|این یکی|همین باشه)$/.test(t)) return { index: 0, type: 'same' };
  if (/^(اولی|اولین|اول|1|گزینه اول)$/.test(t)) return { index: 0, type: 'first' };
  if (/^(دومی|دومین|دوم|2|گزینه دوم)$/.test(t)) return { index: 1, type: 'second' };
  if (/^(سومی|سومین|سوم|3)$/.test(t)) return { index: 2, type: 'third' };
  return null;
}

export function parseReference(text) {
  const t = normalizeText(text);
  if (/همون قبلی|قبلی|همان قبلی/.test(t)) return { ref: 'previous', raw: text };
  if (/همین سرمایه|با همین سرمایه|همون سرمایه/.test(t)) return { ref: 'same_capital', raw: text };
  if (/همون بیت کوین|همون بیت‌کوین|همان بیت کوین/.test(t)) return { ref: 'same_asset', asset: 'BTC', raw: text };
  if (/این یکی|همین یکی|همینو/.test(t)) return { ref: 'this_one', raw: text };
  if (/برای \d+ ماه|برای چهار ماه|برای ۴ ماه/.test(t)) {
    const dur = parseDuration(t);
    if (dur) return { ref: 'duration', duration: dur, raw: text };
  }
  if (t.includes('همون') || t.includes('همین') || t.includes('این')) {
    return { ref: 'anaphoric', raw: text };
  }
  return null;
}

/**
 * Slot Filling Engine — Spec §8
 * Last unanswered question has highest priority
 */
export class SlotFillingEngine {
  constructor() {
    this.slots = {};
    this.missing = [];
    this.lastQuestion = null;
    this.lastQuestionId = null;
    this.expectedType = null;
  }

  setExpectedQuestion(question, questionId, expectedType) {
    this.lastQuestion = question;
    this.lastQuestionId = questionId;
    this.expectedType = expectedType;
  }

  /**
   * Fill slot from user answer — understands short answers via lastQuestion
   */
  fillFromAnswer(answerText, { conversationState = null, currentIntent = null } = {}) {
    const parsed = parseShortAnswer(answerText);
    const expected = this.expectedType || conversationState?.lastQuestionType || null;

    // If expected type matches parsed type, fill directly
    if (expected && parsed.type === expected) {
      return {
        filled: true,
        slot: expected,
        value: parsed.value,
        confidence: parsed.confidence,
        parsed
      };
    }

    // If expected is duration and we got duration
    if (expected === 'duration' && parsed.type === 'duration') {
      return { filled: true, slot: 'timeframe', value: parsed.value, confidence: 0.99, parsed };
    }
    if (expected === 'forecast_period' && parsed.type === 'duration') {
      return { filled: true, slot: 'forecastPeriod', value: parsed.value, confidence: 0.99, parsed };
    }
    if (expected === 'percent' && parsed.type === 'percent') {
      return { filled: true, slot: 'targetReturn', value: parsed.value, confidence: 0.99, parsed };
    }

    // Generic: if we have a missing slot and parsed type matches any missing
    if (conversationState?.missingSlots?.length) {
      for (const missing of conversationState.missingSlots) {
        if (missing === 'timeframe' && parsed.type === 'duration') {
          return { filled: true, slot: 'timeframe', value: parsed.value, confidence: 0.99, parsed };
        }
        if (missing === 'targetReturn' && parsed.type === 'percent') {
          return { filled: true, slot: 'targetReturn', value: parsed.value, confidence: 0.99, parsed };
        }
        if (missing === 'capital' && parsed.type === 'amount') {
          return { filled: true, slot: 'capital', value: parsed.value, confidence: 0.95, parsed };
        }
      }
    }

    // If short answer is confirm/reject, treat as answer to last question
    if (parsed.type === 'confirm' || parsed.type === 'reject') {
      return { filled: true, slot: expected || 'confirmation', value: parsed.value, confidence: parsed.confidence, parsed };
    }

    // If selection or reference, resolve
    if (parsed.type === 'selection' || parsed.type === 'reference') {
      return { filled: false, needsResolution: true, parsed, slot: expected || 'reference' };
    }

    // Fallback: return parsed but not auto-filled
    return { filled: false, parsed, slot: expected };
  }

  /**
   * Extract slots from full sentence — e.g. "می‌خوام در ۴ ماه ۲۰٪ سود کنم"
   */
  extractFromSentence(text) {
    const slots = {};
    const t = normalizeText(text);

    const dur = parseDuration(t);
    if (dur) slots.timeframe = dur;

    const pct = parsePercent(t);
    if (pct) slots.targetReturn = pct;

    const amt = parseAmount(t);
    if (amt) slots.capital = amt;

    // Risk
    if (/ریسک کم|محافظه|low risk/i.test(t)) slots.risk = 'low';
    else if (/ریسک متوسط|medium risk/i.test(t)) slots.risk = 'medium';
    else if (/ریسک زیاد|high risk|تهاجمی/i.test(t)) slots.risk = 'high';

    // Goal
    if (/سود|profit|بازدهی/.test(t)) slots.goal = 'profit';

    return slots;
  }

  getMissingSlots(collected, required) {
    const missing = [];
    for (const key of Object.keys(required)) {
      if (required[key].required && !collected[key]) missing.push(key);
    }
    return missing;
  }
}

// Singleton
let engineInstance = null;
export function getSlotFillingEngine() {
  if (!engineInstance) engineInstance = new SlotFillingEngine();
  return engineInstance;
}
