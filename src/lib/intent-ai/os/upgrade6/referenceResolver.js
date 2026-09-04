/**
 * FBT AI / Intent OS — UPGRADE 6
 * ReferenceResolver + Contextual Answer Resolver + Confidence Layer
 * Spec §9, §11, §32
 */

function normalizeText(input) {
  const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
  let s = String(input ?? '');
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '');
  s = s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
  s = s.replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] || d);
  s = s.replace(/[\u200c]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

/**
 * ReferenceResolver — Spec §11
 * Understands "همون قبلی", "اولی", "این یکی", "همون بیت‌کوین", "برای ۴ ماه", "با همین سرمایه"
 */
export class ReferenceResolver {
  constructor() {
    this.history = [];
  }

  /**
   * Resolve pronoun / reference against conversation memory
   */
  resolve(text, { conversationState = null, messages = [], collectedSlots = {}, currentPage = null } = {}) {
    const t = normalizeText(text);
    if (!t) return { resolved: false, confidence: 0 };

    const slots = collectedSlots || conversationState?.collectedSlots || {};
    const lastQuestion = conversationState?.lastQuestion || null;
    const intent = conversationState?.currentIntent || null;
    const lastAnswer = conversationState?.lastUserAnswer || null;

    // "همون قبلی" → previous asset / previous intent
    if (/همون قبلی|همان قبلی|قبلی/.test(t)) {
      // Try to find last mentioned asset
      const asset = this.findLastAsset(messages, slots);
      if (asset) return { resolved: true, type: 'asset', value: asset, confidence: 0.85, source: 'previous_asset' };
      if (intent) return { resolved: true, type: 'intent', value: intent, confidence: 0.8, source: 'previous_intent' };
      return { resolved: true, type: 'previous', value: lastAnswer || intent, confidence: 0.6, source: 'last_answer' };
    }

    if (/اولی|اولین/.test(t)) {
      return { resolved: true, type: 'selection', value: { index: 0 }, confidence: 0.9, source: 'ordinal_first' };
    }
    if (/دومی|دومین/.test(t)) {
      return { resolved: true, type: 'selection', value: { index: 1 }, confidence: 0.9, source: 'ordinal_second' };
    }
    if (/سومی|سومین/.test(t)) {
      return { resolved: true, type: 'selection', value: { index: 2 }, confidence: 0.9, source: 'ordinal_third' };
    }

    if (/این یکی|همین یکی|همینو|همون|اینو/.test(t)) {
      // "this one" → current page context or last mentioned
      if (currentPage) {
        return { resolved: true, type: 'current_page', value: currentPage, confidence: 0.75, source: 'current_page' };
      }
      const asset = this.findLastAsset(messages, slots);
      if (asset) return { resolved: true, type: 'asset', value: asset, confidence: 0.8, source: 'last_asset' };
      return { resolved: true, type: 'this', value: lastAnswer, confidence: 0.6, source: 'last_answer' };
    }

    if (/همون بیت کوین|همون بیت‌کوین|همین بیت کوین/.test(t)) {
      return { resolved: true, type: 'asset', value: 'BTC', confidence: 0.95, source: 'explicit_btc' };
    }

    if (/با همین سرمایه|همین سرمایه|همان سرمایه|با همون سرمایه/.test(t)) {
      const capital = slots.capital || slots.amount || this.findLastAmount(messages, slots);
      if (capital) return { resolved: true, type: 'capital', value: capital, confidence: 0.9, source: 'same_capital' };
      return { resolved: true, type: 'capital', value: 'same', confidence: 0.7, source: 'same_capital_ref' };
    }

    if (/برای ۴ ماه|برای چهار ماه|برای 4 ماه|4 ماهه/.test(t)) {
      return { resolved: true, type: 'duration', value: { value: 4, unit: 'months', months: 4 }, confidence: 0.95, source: 'explicit_duration' };
    }

    // Generic anaphoric
    if (/همون|همین|اون|آن/.test(t) && t.length < 30) {
      const asset = this.findLastAsset(messages, slots);
      if (asset) return { resolved: true, type: 'asset', value: asset, confidence: 0.65, source: 'anaphoric_asset' };
    }

    return { resolved: false, confidence: 0, reason: 'no_reference_found' };
  }

  findLastAsset(messages, slots) {
    if (slots?.asset) return slots.asset;
    if (slots?.fromToken) return slots.fromToken;
    if (slots?.token) return slots.token;
    // Search messages backwards
    for (let i = (messages || []).length - 1; i >= 0; i--) {
      const m = messages[i];
      const content = String(m.content || m.text || '').toUpperCase();
      const match = content.match(/\b(BTC|ETH|SOL|USDC|USDT|BNB|ARB|AVAX)\b/);
      if (match) return match[1];
    }
    return null;
  }

  findLastAmount(messages, slots) {
    if (slots?.capital) return slots.capital;
    if (slots?.amount) return slots.amount;
    return null;
  }
}

/**
 * Contextual Answer Resolver — Spec §9
 * Before saying "مطمئن نشدم...", check:
 * 1. Last question
 * 2. Current intent
 * 3. Missing slots
 * 4. Previous user messages
 * 5. Current page
 * 6. Active task
 * 7. Agent state
 */
export class ContextualAnswerResolver {
  resolve(userMessage, context = {}) {
    const {
      lastQuestion,
      lastQuestionId,
      currentIntent,
      missingSlots = [],
      previousMessages = [],
      currentPage = null,
      activeTask = null,
      agentState = null,
      collectedSlots = {},
      conversationState = null
    } = context;

    const text = String(userMessage || '').trim();
    if (!text) return { interpretation: null, confidence: 0, reason: 'empty' };

    // Import slot filling parser
    // Avoid circular: inline short checks
    const lower = text.toLowerCase();

    // 1. Last question — highest priority
    if (lastQuestion && lastQuestionId) {
      const expectedType = conversationState?.lastQuestionType || null;
      // Try to interpret answer as response to last question
      const asDuration = this.tryParseDuration(text);
      if (asDuration && (expectedType === 'duration' || expectedType === 'forecast_period' || /مدت|بازه|چقدر.*طول|timeframe|duration/i.test(lastQuestion))) {
        return {
          interpretation: { type: 'slot_fill', slot: 'timeframe', value: asDuration, questionId: lastQuestionId },
          confidence: 0.95,
          source: 'last_question',
          reasoning: `User answered duration "${text}" to question "${lastQuestion}"`
        };
      }
      const asPercent = this.tryParsePercent(text);
      if (asPercent && (expectedType === 'percent' || /درصد|سود|return|percent/i.test(lastQuestion))) {
        return {
          interpretation: { type: 'slot_fill', slot: 'targetReturn', value: asPercent, questionId: lastQuestionId },
          confidence: 0.95,
          source: 'last_question'
        };
      }
      const asConfirm = this.tryParseConfirm(text);
      if (asConfirm !== null) {
        return {
          interpretation: { type: 'confirmation', value: asConfirm, questionId: lastQuestionId },
          confidence: 0.99,
          source: 'last_question'
        };
      }
    }

    // 2. Current intent + missing slots
    if (currentIntent && missingSlots.length) {
      const primaryMissing = missingSlots[0];
      const asDuration = this.tryParseDuration(text);
      if (asDuration && (primaryMissing === 'timeframe' || primaryMissing === 'forecastPeriod')) {
        return {
          interpretation: { type: 'slot_fill', slot: primaryMissing, value: asDuration },
          confidence: 0.9,
          source: 'missing_slots',
          reasoning: `Filling missing slot ${primaryMissing} with duration`
        };
      }
      const asPercent = this.tryParsePercent(text);
      if (asPercent && primaryMissing === 'targetReturn') {
        return {
          interpretation: { type: 'slot_fill', slot: primaryMissing, value: asPercent },
          confidence: 0.9,
          source: 'missing_slots'
        };
      }
    }

    // 3. Previous user messages — check if this is continuation
    if (previousMessages.length) {
      const lastUserMsg = [...previousMessages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        // Short answer likely relates to previous AI question
        if (text.length < 30) {
          return {
            interpretation: { type: 'short_answer', value: text, relatesTo: lastUserMsg },
            confidence: 0.7,
            source: 'previous_messages',
            needsSlotFilling: true
          };
        }
      }
    }

    // 4. Current page context
    if (currentPage && /این|همین|this|it/.test(lower) && lower.length < 40) {
      return {
        interpretation: { type: 'page_reference', value: currentPage, page: currentPage },
        confidence: 0.65,
        source: 'current_page'
      };
    }

    // 5. Active task
    if (activeTask && text.length < 50) {
      return {
        interpretation: { type: 'task_continuation', taskId: activeTask.id, value: text },
        confidence: 0.6,
        source: 'active_task'
      };
    }

    // 6. Agent state — if agent is waiting for something specific
    if (agentState?.waitingFor) {
      return {
        interpretation: { type: 'agent_response', waitingFor: agentState.waitingFor, value: text },
        confidence: 0.55,
        source: 'agent_state'
      };
    }

    // No valid interpretation found — only then ask clarification
    return {
      interpretation: null,
      confidence: 0,
      source: 'none',
      shouldClarify: true,
      reason: 'No valid interpretation from context'
    };
  }

  tryParseDuration(text) {
    const FA = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
    let t = String(text).replace(/[۰-۹]/g, (d) => FA[d] || d).toLowerCase();
    const m = t.match(/(\d+|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)\s*(ماه|سال|روز|هفته|month|year|day|week)/);
    if (m) {
      const nums = { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10 };
      let num = Number(m[1]);
      if (Number.isNaN(num)) num = nums[m[1]] || 0;
      if (num > 0) {
        let unit = m[2];
        if (/ماه|month/.test(unit)) unit = 'months';
        else if (/سال|year/.test(unit)) unit = 'years';
        else if (/روز|day/.test(unit)) unit = 'days';
        else if (/هفته|week/.test(unit)) unit = 'weeks';
        return { value: num, unit, months: unit === 'months' ? num : unit === 'years' ? num * 12 : null, raw: text };
      }
    }
    return null;
  }

  tryParsePercent(text) {
    const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*(درصد|%|percent)/i);
    if (m) {
      const v = Number(m[1].replace(',', '.'));
      if (Number.isFinite(v)) return { value: v, decimal: v / 100, raw: text };
    }
    return null;
  }

  tryParseConfirm(text) {
    const t = String(text).toLowerCase().trim();
    if (/^(بله|آره|آری|باشه|اوکی|ok|yes|confirm|انجام بده|ادامه بده)$/.test(t)) return true;
    if (/^(نه|نخیر|لغو|کنسل|no|cancel)$/.test(t)) return false;
    return null;
  }
}

/**
 * Confidence Layer — Spec §32
 */
export function calculateConfidence(interpretation) {
  if (!interpretation) return 0;
  if (interpretation.confidence != null) return interpretation.confidence;
  // Default based on source
  const sourceScores = {
    last_question: 0.95,
    missing_slots: 0.9,
    previous_messages: 0.7,
    current_page: 0.65,
    active_task: 0.6,
    agent_state: 0.55,
    none: 0
  };
  return sourceScores[interpretation.source] || 0.5;
}

export function shouldExecute(confidence) {
  if (confidence >= 0.85) return 'execute';
  if (confidence >= 0.6) return 'confirm';
  return 'clarify';
}

// Singletons
let refInstance = null;
export function getReferenceResolver() {
  if (!refInstance) refInstance = new ReferenceResolver();
  return refInstance;
}

let ctxInstance = null;
export function getContextualResolver() {
  if (!ctxInstance) ctxInstance = new ContextualAnswerResolver();
  return ctxInstance;
}
