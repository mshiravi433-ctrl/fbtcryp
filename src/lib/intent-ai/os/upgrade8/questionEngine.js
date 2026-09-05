import {
  ANSWER_STATUS,
  QUESTION_STATUS,
  createAnswerRecord,
  createNotification,
  nowMs
} from './contracts.js';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const RISK_MAP = [
  { patterns: ['conservative', 'low risk', 'low-risk', 'کم ریسک', 'ریسک کم', 'محافظه کار', 'محافظه‌کار'], value: 'low' },
  { patterns: ['balanced', 'moderate', 'medium risk', 'medium-risk', 'ریسک متوسط', 'متوسط', 'متعادل'], value: 'medium' },
  { patterns: ['aggressive', 'high risk', 'high-risk', 'ریسک بالا', 'پرریسک', 'تهاجمی'], value: 'high' }
];

const YES_WORDS = ['yes', 'yep', 'sure', 'ok', 'okay', 'confirm', 'confirmed', 'بله', 'آره', 'اوکی', 'باشه'];
const NO_WORDS = ['no', 'nope', 'cancel', 'stop', 'نه', 'لغو', 'نمیخوام', 'نمی‌خوام'];
const SECOND_WORDS = ['2', 'second', 'option 2', 'گزینه دوم', 'دومی', 'همون گزینه دوم', 'همان گزینه دوم'];
const FIRST_WORDS = ['1', 'first', 'option 1', 'گزینه اول', 'اولی', 'همون گزینه اول'];
const THIRD_WORDS = ['3', 'third', 'option 3', 'گزینه سوم', 'سومی'];
const FOURTH_WORDS = ['4', 'fourth', 'option 4', 'گزینه چهارم', 'چهارمی'];
const SAME_WORDS = ['same', 'that one', 'همون', 'همان', 'همونه'];

export function normalizeDigits(value) {
  return String(value || '')
    .split('')
    .map((char) => {
      const pIndex = PERSIAN_DIGITS.indexOf(char);
      if (pIndex >= 0) return String(pIndex);
      const aIndex = ARABIC_DIGITS.indexOf(char);
      if (aIndex >= 0) return String(aIndex);
      return char;
    })
    .join('');
}

export function normalizeText(value) {
  return normalizeDigits(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractDurationMonths(text) {
  const normalized = normalizeText(text);
  const monthMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(month|months|mo|ماه)/i);
  if (monthMatch) return Math.max(1, Math.round(Number(monthMatch[1])));

  const yearMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(year|years|yr|yrs|سال)/i);
  if (yearMatch) return Math.max(1, Math.round(Number(yearMatch[1]) * 12));

  if (normalized.includes('quarter') || normalized.includes('سه ماه') || normalized.includes('سه‌ماه')) return 3;
  if (normalized.includes('چهار ماه')) return 4;
  if (normalized.includes('half year') || normalized.includes('شش ماه')) return 6;
  return null;
}

export function extractRiskProfile(text) {
  const normalized = normalizeText(text);
  for (const entry of RISK_MAP) {
    if (entry.patterns.some((pattern) => normalized.includes(normalizeText(pattern)))) {
      return entry.value;
    }
  }
  return null;
}

export function resolveOrdinalReference(text) {
  const normalized = normalizeText(text);
  if (FIRST_WORDS.some((word) => normalized.includes(normalizeText(word)))) return 0;
  if (SECOND_WORDS.some((word) => normalized.includes(normalizeText(word)))) return 1;
  if (THIRD_WORDS.some((word) => normalized.includes(normalizeText(word)))) return 2;
  if (FOURTH_WORDS.some((word) => normalized.includes(normalizeText(word)))) return 3;
  return null;
}

function findOptionByReference(text, options = [], fallbackOptions = []) {
  if (!Array.isArray(options) || !options.length) options = fallbackOptions;
  if (!Array.isArray(options) || !options.length) return null;

  const ordinalIndex = resolveOrdinalReference(text);
  if (ordinalIndex != null && options[ordinalIndex]) {
    return {
      index: ordinalIndex,
      option: options[ordinalIndex],
      confidence: 0.94,
      reason: 'ordinal-reference'
    };
  }

  const normalized = normalizeText(text);
  const lastOption = fallbackOptions?.find?.((item) => item?.selected);
  if (lastOption && SAME_WORDS.some((word) => normalized.includes(normalizeText(word)))) {
    return {
      index: fallbackOptions.indexOf(lastOption),
      option: lastOption,
      confidence: 0.76,
      reason: 'same-as-selected'
    };
  }

  const byLabelIndex = options.findIndex((option) => {
    const label = normalizeText(option?.label || option?.title || option?.value || '');
    return label && normalized.includes(label);
  });
  if (byLabelIndex >= 0) {
    return {
      index: byLabelIndex,
      option: options[byLabelIndex],
      confidence: 0.88,
      reason: 'label-match'
    };
  }

  return null;
}

export function parseAnswerValue({ text, question = {}, state = null }) {
  const normalized = normalizeText(text);
  const expectedType = question.expectedType || 'text';
  const selection = findOptionByReference(text, question.options, state?.agentState?.lastPresentedOptions);

  if (expectedType === 'riskProfile' || question.slot === 'riskProfile') {
    const risk = extractRiskProfile(text);
    if (risk) return { value: risk, confidence: 0.97, kind: 'riskProfile' };
    if (selection?.option?.value) return { value: selection.option.value, confidence: selection.confidence, kind: 'selection' };
  }

  if (expectedType === 'durationMonths' || question.slot === 'durationMonths' || question.slot === 'timeframe') {
    const months = extractDurationMonths(text);
    if (months) return { value: months, confidence: 0.96, kind: 'durationMonths' };
    if (selection?.option?.value != null) return { value: selection.option.value, confidence: selection.confidence, kind: 'selection' };
  }

  if (expectedType === 'boolean') {
    if (YES_WORDS.some((word) => normalized.includes(normalizeText(word)))) return { value: true, confidence: 0.96, kind: 'boolean' };
    if (NO_WORDS.some((word) => normalized.includes(normalizeText(word)))) return { value: false, confidence: 0.96, kind: 'boolean' };
  }

  if (expectedType === 'selection' || question.options?.length) {
    if (selection?.option) {
      return {
        value: selection.option.value ?? selection.option.id ?? selection.option.label,
        label: selection.option.label || selection.option.title || null,
        optionIndex: selection.index,
        confidence: selection.confidence,
        kind: selection.reason
      };
    }
  }

  const percentMatch = normalized.match(/(\d+(?:\.\d+)?)\s*%/);
  if ((expectedType === 'percent' || question.slot?.toLowerCase().includes('percent')) && percentMatch) {
    return { value: Number(percentMatch[1]), confidence: 0.93, kind: 'percent' };
  }

  const numericMatch = normalized.match(/\b(\d+(?:\.\d+)?)\b/);
  if ((expectedType === 'number' || expectedType === 'currency') && numericMatch) {
    return { value: Number(numericMatch[1]), confidence: 0.9, kind: expectedType };
  }

  if (normalized) {
    return { value: text.trim(), confidence: 0.7, kind: 'text' };
  }

  return null;
}

export function bindAnswerToState({ state, text, question = null, timestamp = nowMs() }) {
  if (!state) return { state, bound: null, error: 'missing-state' };
  const activeQuestion = question || state.questions?.find?.((item) => item.questionId === state.pendingQuestion) || null;
  if (!activeQuestion) return { state, bound: null, error: 'no-active-question' };

  const parsed = parseAnswerValue({ text, question: activeQuestion, state });
  if (!parsed) {
    return {
      state,
      bound: null,
      error: 'unparsed-answer',
      notification: createNotification({
        level: 'WARNING',
        title: 'Answer not understood',
        message: 'The answer could not be matched to the active question.'
      })
    };
  }

  const answer = createAnswerRecord({
    questionId: activeQuestion.questionId,
    intentId: activeQuestion.intentId,
    slot: activeQuestion.slot,
    value: parsed.value,
    rawText: text,
    confidence: parsed.confidence,
    status: ANSWER_STATUS.BOUND,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const answers = Array.isArray(state.answers) ? state.answers.slice() : [];
  answers.push(answer);

  const questions = (state.questions || []).map((item) => {
    if (item.questionId !== activeQuestion.questionId) return item;
    return {
      ...item,
      status: QUESTION_STATUS.ANSWERED,
      updatedAt: timestamp
    };
  });

  const collectedSlots = {
    ...(state.collectedSlots || {}),
    [activeQuestion.slot]: parsed.value
  };

  const missingSlots = Array.isArray(state.missingSlots)
    ? state.missingSlots.filter((slot) => slot !== activeQuestion.slot)
    : [];

  const intents = (state.intents || []).map((intent) => {
    if (intent.intentId !== activeQuestion.intentId) return intent;
    return {
      ...intent,
      filledSlots: {
        ...(intent.filledSlots || {}),
        [activeQuestion.slot]: parsed.value
      },
      requiredSlots: Array.isArray(intent.requiredSlots)
        ? intent.requiredSlots.filter((slot) => slot !== activeQuestion.slot)
        : intent.requiredSlots,
      status: missingSlots.length ? intent.status : 'ready',
      updatedAt: timestamp
    };
  });

  const updatedState = {
    ...state,
    answers,
    questions,
    intents,
    collectedSlots,
    missingSlots,
    pendingQuestion: null,
    conversation: state.conversation
      ? {
          ...state.conversation,
          activeQuestionId: null,
          updatedAt: timestamp
        }
      : state.conversation,
    lastUpdated: timestamp
  };

  return {
    state: updatedState,
    bound: {
      slot: activeQuestion.slot,
      value: parsed.value,
      label: parsed.label || null,
      confidence: parsed.confidence,
      questionId: activeQuestion.questionId,
      answerId: answer.answerId
    },
    error: null
  };
}

export function createFollowupQuestion({ state, intentId, taskId, slot, prompt, expectedType = 'text', options = [], required = true }) {
  const timestamp = nowMs();
  const question = {
    questionId: `q_${slot}_${timestamp}`,
    intentId: intentId || state?.activeIntent || null,
    taskId: taskId || state?.activeTask || null,
    slot,
    prompt,
    expectedType,
    required,
    options: Array.isArray(options) ? options : [],
    status: QUESTION_STATUS.ACTIVE,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    ...(state || {}),
    questions: [...(state?.questions || []), question],
    pendingQuestion: question.questionId,
    missingSlots: Array.from(new Set([...(state?.missingSlots || []), slot])),
    conversation: state?.conversation
      ? {
          ...state.conversation,
          activeQuestionId: question.questionId,
          status: 'WAITING',
          updatedAt: timestamp
        }
      : state?.conversation,
    lastUpdated: timestamp
  };
}

export function extractReferableOptions(payload = {}) {
  const buckets = [
    payload.options,
    payload.suggestions,
    payload.opportunities,
    payload.recommendations,
    payload.actions,
    payload.plan?.steps,
    payload.analysis?.options
  ];

  const normalized = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (!item) continue;
      normalized.push({
        id: item.id || item.optionId || item.key || null,
        label: item.label || item.title || item.name || item.action || String(item.value || '').slice(0, 80),
        value: item.value ?? item.id ?? item.label ?? item.title ?? item.name,
        meta: item
      });
    }
  }
  return normalized.slice(0, 8);
}

export function rememberPresentedOptions(state, payload = {}, selectedIndex = null) {
  const options = extractReferableOptions(payload).map((item, index) => ({
    ...item,
    selected: selectedIndex === index
  }));
  if (!options.length) return state;
  return {
    ...state,
    agentState: {
      ...(state.agentState || {}),
      lastPresentedOptions: options
    },
    lastUpdated: nowMs()
  };
}
