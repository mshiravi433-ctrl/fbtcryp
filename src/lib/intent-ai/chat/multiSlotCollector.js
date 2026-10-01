/**
 * FBT INTENT OS — MULTI-SLOT COLLECTOR
 * ---------------------------------------------------------------------------
 * پاسخ به مشکل «هوش مصنوعی بعد از هر جواب یادش میره»:
 *
 * این ماژول یک فرم چندمرحله‌ای (wizard) است که برای درخواست‌های هدف‌دار
 * (مثل سرمایه‌گذاری، سود، بازه زمانی، ریسک) تمام فیلدهای لازم را به ترتیب
 * می‌پرسد، پاسخ‌ها را در یک draft ذخیره می‌کند، و تا وقتی همه اسلات‌ها پر
 * نشده‌اند در حالت «در حال جمع‌آوری» می‌ماند.
 *
 * ویژگی‌ها:
 *   - چندین سوال به ترتیب پرسیده می‌شود (سرمایه → سود → بازه → ریسک)
 *   - هر پاسخ فقط به اسلات متناظر bind می‌شود
 *   - وقتی همه اسلات‌ها پر شدند، یک intent کامل ساخته و تحلیل عمیق شروع می‌شود
 *   - با یک باکس اختصاصی جواب در UI، کاربر دقیقاً می‌داند پاسخش به کدام سوال است
 *   - بعد از هر پاسخ، خلاصه‌ای از «چی ثبت شد» نمایش داده می‌شود
 *   - TTL و ذخیره‌سازی ب durable تا صفحه هم رفرش شود از بین نرود
 */

import { normalizeDigits, foldText } from './questionLedger.js';
import { DEFAULT_POLICY_CAPS } from '../permissions.js';
import { INTENT_LIMITS } from '../intentLimits.js';
import { num } from '../../strategyBrain/numeric.js';

export const MULTI_SLOT_SCHEMA = 'fbt.multi-slot-form.v1';
export const MULTI_SLOT_KEY = 'fbt.chat.multi-slot-form.v1';
export const FORM_TTL_MS = 45 * 60 * 1000; // 45 دقیقه

const FORMS = Object.freeze({
  STRATEGY_GOAL: {
    id: 'STRATEGY_GOAL',
    fa: {
      title: 'ساخت استراتژی سرمایه‌گذاری',
      done: 'همه اطلاعات گرفتم؛ در حال تحلیل عمیق...'
    },
    en: {
      title: 'Building investment strategy',
      done: 'All info collected; starting deep analysis...'
    },
    slots: [
      {
        key: 'capitalUsd',
        labelFa: 'سرمایه',
        labelEn: 'Capital (USD)',
        askFa: 'چقدر سرمایه می‌خواهی وارد کنی؟ (مثلاً: ۱۰۰ دلار)',
        askEn: 'How much capital do you want to invest? (e.g. $100)',
        expectedType: 'amount',
        placeholderFa: 'مثال: ۱۰۰ یا ۱۰۰ دلار',
        placeholderEn: 'e.g. 100 or $100'
      },
      {
        key: 'targetPct',
        labelFa: 'هدف سود',
        labelEn: 'Target return',
        askFa: 'چند درصد سود می‌خواهی؟ (مثلاً: ۲۰ درصد)',
        askEn: 'What percentage return are you targeting? (e.g. 20%)',
        expectedType: 'percent',
        placeholderFa: 'مثال: ۲۰ یا ۲۰٪',
        placeholderEn: 'e.g. 20 or 20%'
      },
      {
        key: 'horizonDays',
        labelFa: 'بازه زمانی',
        labelEn: 'Time horizon',
        askFa: 'در چه بازه زمانی؟ (مثلاً: ۳۰ روز، ۲ ماه)',
        askEn: 'In what time frame? (e.g. 30 days, 2 months)',
        expectedType: 'duration',
        placeholderFa: 'مثال: ۳۰ روز یا ۲ ماه',
        placeholderEn: 'e.g. 30 days or 2 months'
      },
      {
        key: 'riskProfile',
        labelFa: 'سطح ریسک',
        labelEn: 'Risk level',
        askFa: 'ریسک را در چه سطحی می‌پذیری؟',
        askEn: 'What risk level do you accept?',
        expectedType: 'choice',
        options: [
          { id: 'conservative', labelFa: '🔵 کم / محافظه‌کار', labelEn: '🔵 Low / conservative' },
          { id: 'balanced', labelFa: '🟡 متوسط / متعادل', labelEn: '🟡 Medium / balanced' },
          { id: 'aggressive', labelFa: '🔴 بالا / تهاجمی', labelEn: '🔴 High / aggressive' }
        ]
      }
    ]
  }
});

/* ---------------------------- storage ------------------------------------- */

let memoryForms = {};

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch { return null; }
}

function readStore() {
  const s = storage();
  if (!s) return { ...memoryForms };
  try {
    const raw = s.getItem(MULTI_SLOT_KEY);
    if (!raw) return { ...memoryForms };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      memoryForms = parsed;
      return { ...parsed };
    }
  } catch {}
  return { ...memoryForms };
}

function writeStore(store) {
  const clean = store || {};
  memoryForms = clean;
  const s = storage();
  if (!s) return clean;
  try { s.setItem(MULTI_SLOT_KEY, JSON.stringify(clean)); } catch {}
  return clean;
}

function newId(prefix = 'form') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------- number parsers ------------------------------ */

const SCALE_RE = [
  { re: /(هزار|thousand|k\b)/i, factor: 1000 },
  { re: /(میلیون|million|m\b)/i, factor: 1_000_000 }
];

function parseAmount(text) {
  const raw = normalizeDigits(String(text || '')).replace(/٫/g, '.');
  const cleaned = raw.replace(/[٬،,](?=\d{3}(\D|$))/g, '');
  // A slot answer is one positive amount, not the first number in a new order.
  const m = cleaned.trim().match(/^(?:سرمایه\s*[:：]?\s*)?\$?\s*(\d+(?:\.\d+)?)\s*(هزار|میلیون|thousand|million|k|m)?\s*(?:دلار|تتر|dollars?|usd|usdt|usdc|\$)?$/i);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const scaleWord = m[2] || '';
  const scale = SCALE_RE.find((s) => s.re.test(scaleWord || ' '))?.factor || 1;
  const usd = Math.round(base * scale * 100) / 100;
  return usd <= DEFAULT_POLICY_CAPS.maxCapitalUsd ? usd : null;
}

function parsePercent(text) {
  const raw = normalizeDigits(String(text || '')).replace(/٫/g, '.');
  const m = raw.trim().match(/^(?:هدف\s*سود\s*[:：]?\s*)?(?:(?:حداقل|at least|minimum)\s*)?(\d+(?:\.\d+)?)\s*(?:٪|%|درصد|percent)?$/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0 || v > INTENT_LIMITS.maxGoalPct) return null;
  return v;
}

function parseDuration(text) {
  const raw = normalizeDigits(String(text || '')).replace(/٫/g, '.');
  const folded = raw.trim().toLowerCase();
  if (/-\s*\d/.test(folded) || (folded.match(/\d+(?:\.\d+)?/g) || []).length !== 1) return null;
  let days = null;
  const month = folded.match(/^(\d+(?:\.\d+)?)\s*(?:ماه|months?|mo)$/i);
  const week = folded.match(/^(\d+(?:\.\d+)?)\s*(?:هفته|weeks?|wks?)$/i);
  const day = folded.match(/^(\d+(?:\.\d+)?)\s*(?:روز|days?|d)$/i);
  const year = folded.match(/^(\d+(?:\.\d+)?)\s*(?:سال|years?)$/i);
  if (month) { days = Math.round(Number(month[1]) * 30); }
  else if (week) { days = Math.round(Number(week[1]) * 7); }
  else if (day) { days = Math.round(Number(day[1])); }
  else if (year) { days = Math.round(Number(year[1]) * 365); }
  else {
    // عدد تنها - دیفالت روز
    const bare = folded.match(/^(\d+)$/);
    if (bare) days = Number(bare[1]);
  }
  return Number.isFinite(days) && days > 0 ? { days, source: 'user' } : null;
}

function parseChoice(text, options) {
  const folded = foldText(text);
  if (!folded || !Array.isArray(options)) return null;
  // Whole labels/ids first. Shared tokens such as "/" used to select LOW for
  // every label (including "🟡 متوسط / متعادل"). Never match label fragments.
  const exact = options.find((opt) => [opt.id, opt.labelFa, opt.labelEn]
    .some((label) => label && foldText(label) === folded));
  if (exact) return exact.id;
  const index = folded.match(/^(?:(?:گزینه|option)\s*)?([1-3])$/);
  if (index) return options[Number(index[1]) - 1]?.id || null;
  const hits = [];
  if (/محافظه|کم\s*ریسک|کمترین|\blow\b|conservative|\bsafe\b|حفظ\s*اصل|^کم$/i.test(folded)) hits.push('conservative');
  if (/متوسط|متعادل|\bmedium\b|\bmoderate\b|\bbalanced\b|معمولی/i.test(folded)) hits.push('balanced');
  if (/تهاجمی|ریسک\s*بالا|بالا\s*ریسک|پرریسک|ریسک\s*زیاد|\bhigh\b|aggressive|yolo|^بالا$/i.test(folded)) hits.push('aggressive');
  // Conflicting or negated risk is not silently converted to a risk grant.
  if (hits.length !== 1 || /نیست|نمی|\bnot\b|\bno\b/i.test(folded)) return null;
  return options.some((opt) => opt.id === hits[0]) ? hits[0] : null;
}

export function parseValueForSlot(text, slot) {
  const type = slot.expectedType;
  if (type === 'amount') return parseAmount(text);
  if (type === 'percent') return parsePercent(text);
  if (type === 'duration') return parseDuration(text);
  if (type === 'choice') return parseChoice(text, slot.options || []);
  // text
  return String(text || '').trim().slice(0, 200) || null;
}

/* ---------------------------- public API ---------------------------------- */

/**
 * شروع یک فرم جدید. اگر قبلاً فرم ناتمامی بود و فرم جدید همان type است،
 * آن را ادامه می‌دهد تا پاسخ‌های کاربر از بین نرود.
 */
function validatedInitialValues(values = {}) {
  const clean = {};
  for (const key of ['capitalUsd', 'targetPct', 'horizonDays']) {
    const value = num(key === 'horizonDays' ? values[key]?.days ?? values[key] : values[key]);
    const limit = key === 'capitalUsd' ? DEFAULT_POLICY_CAPS.maxCapitalUsd : key === 'targetPct' ? INTENT_LIMITS.maxGoalPct : Infinity;
    if (value != null && value > 0 && value <= limit && (key !== 'horizonDays' || Math.round(value) > 0)) {
      clean[key] = key === 'horizonDays' ? { days: Math.round(value), source: 'user' } : value;
    }
  }
  if (['conservative', 'balanced', 'aggressive'].includes(values.riskProfile)) clean.riskProfile = values.riskProfile;
  if (num(values.floorPct) > 0 && num(values.floorPct) <= INTENT_LIMITS.maxGoalPct) clean.floorPct = num(values.floorPct);
  return clean;
}

export function startForm({ formId = 'STRATEGY_GOAL', conversationId = null, locale = 'fa', initialValues = {}, restart = false, now = Date.now() } = {}) {
  const def = FORMS[formId];
  if (!def) return { ok: false, error: 'UNKNOWN_FORM' };
  const store = readStore();
  const existing = store[conversationId || 'default'];
  const resumed = !restart && existing?.formId === formId && existing.status === 'COLLECTING'
    && now - Number(existing.startedAt || 0) < FORM_TTL_MS;
  const collected = { ...(resumed ? existing.collected : {}), ...validatedInitialValues(initialValues) };
  const firstMissing = def.slots.findIndex((slot) => collected[slot.key] == null);
  const complete = firstMissing === -1;
  const form = {
    ...(resumed ? existing : {}),
    schema: MULTI_SLOT_SCHEMA,
    id: resumed ? existing.id : newId('mf'),
    formId, conversationId,
    locale: String(locale || 'fa').slice(0, 5),
    status: complete ? 'COMPLETE' : 'COLLECTING',
    startedAt: resumed ? existing.startedAt : now,
    updatedAt: now,
    currentSlotIndex: complete ? def.slots.length - 1 : firstMissing,
    collected,
    history: resumed ? existing.history : [],
    completedAt: complete ? now : null
  };
  writeStore({ ...store, [conversationId || 'default']: form });
  return { ok: true, resumed, complete, form, ...(complete ? { data: buildFinalData(form) } : {}) };
}

/** فرم فعال فعلی (اگر در بازه TTL باشد). */
export function getActiveForm({ conversationId = null, now = Date.now() } = {}) {
  const store = readStore();
  const form = store[conversationId || 'default'] || null;
  if (!form) return null;
  if (form.status !== 'COLLECTING') return null;
  if (now - Number(form.startedAt || 0) > FORM_TTL_MS) {
    // منقضی شده
    const next = { ...store };
    next[conversationId || 'default'] = { ...form, status: 'EXPIRED', updatedAt: now };
    writeStore(next);
    return null;
  }
  return form;
}

/** اسلات فعلی که منتظر جواب است، با تمام metadata برای UI. */
export function getCurrentSlot({ conversationId = null, locale = 'fa', now = Date.now() } = {}) {
  const form = getActiveForm({ conversationId, now });
  if (!form) return null;
  const def = FORMS[form.formId];
  if (!def) return null;
  const slot = def.slots[form.currentSlotIndex];
  if (!slot) return null;
  const fa = String(locale || form.locale || 'fa').startsWith('fa');
  return {
    ...slot,
    formId: form.formId,
    formInstanceId: form.id,
    title: fa ? def.fa.title : def.en.title,
    questionText: fa ? slot.askFa : slot.askEn,
    placeholder: fa ? (slot.placeholderFa || '') : (slot.placeholderEn || ''),
    slotIndex: form.currentSlotIndex,
    totalSlots: def.slots.length,
    collectedCount: def.slots.filter((s) => form.collected[s.key] != null).length,
    collectedLabels: def.slots
      .filter((s) => form.collected[s.key] != null)
      .map((s) => {
        const v = form.collected[s.key];
        return {
          key: s.key,
          label: fa ? s.labelFa : s.labelEn,
          value: formatValue(s, v, fa)
        };
      })
  };
}

function formatValue(slot, value, fa) {
  if (value == null) return '—';
  if (slot.expectedType === 'amount') {
    return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (slot.expectedType === 'percent') return `${value}%`;
  if (slot.expectedType === 'duration') {
    const d = Number(value?.days ?? value);
    if (!Number.isFinite(d)) return '—';
    if (d >= 365 && d % 365 === 0) return fa ? `${d / 365} سال` : `${d / 365} year(s)`;
    if (d >= 30 && d % 30 === 0) return fa ? `${d / 30} ماه` : `${Math.round(d / 30)} month(s)`;
    if (d >= 7 && d % 7 === 0) return fa ? `${d / 7} هفته` : `${d / 7} week(s)`;
    return fa ? `${d} روز` : `${d} day(s)`;
  }
  if (slot.expectedType === 'choice') {
    const opt = (slot.options || []).find((o) => o.id === value);
    if (opt) return fa ? opt.labelFa : opt.labelEn;
    return String(value);
  }
  return String(value);
}

/**
 * پاسخ کاربر به اسلات فعلی را ثبت می‌کند. اگر اسلات آخر بود، فرم کامل شده
 * و برمی‌گرداند. در غیر این صورت به اسلات بعدی می‌رود.
 */
export function submitAnswer({ text, conversationId = null, locale = 'fa', now = Date.now() } = {}) {
  const form = getActiveForm({ conversationId, now });
  if (!form) return { ok: false, error: 'NO_ACTIVE_FORM' };
  const def = FORMS[form.formId];
  if (!def) return { ok: false, error: 'UNKNOWN_FORM' };
  const slot = def.slots[form.currentSlotIndex];
  if (!slot) return { ok: false, error: 'NO_CURRENT_SLOT' };

  const cancelRe = /(?:لغو|کنسل|بی‌?خیال|فراموش|cancel|never\s*mind|drop\s*it)/i;
  if (cancelRe.test(String(text || ''))) {
    const store = readStore();
    const next = { ...store };
    next[conversationId || 'default'] = { ...form, status: 'CANCELLED', updatedAt: now };
    writeStore(next);
    return { ok: true, cancelled: true, form: next[conversationId || 'default'] };
  }

  const value = parseValueForSlot(text, slot);
  if (value == null) {
    const fa = String(locale || form.locale || 'fa').startsWith('fa');
    return {
      ok: false,
      error: 'VALUE_NOT_PARSED',
      questionSlot: { ...getCurrentSlot({ conversationId, locale, now }) },
      hint: fa
        ? `نمی‌فهمم. لطفاً یک ${fa ? slot.labelFa : slot.labelEn} معتبر وارد کن.`
        : `I didn't catch that. Please enter a valid ${slot.labelEn || slot.key}.`
    };
  }

  const store = readStore();
  const collected = { ...form.collected, [slot.key]: value,
    ...(slot.key === 'targetPct' && /حداقل|at least|minimum/i.test(String(text)) ? { floorPct: value } : {}) };
  const history = [...(form.history || []), { slot: slot.key, raw: String(text).slice(0, 200), value, at: now }];
  const nextIndex = def.slots.findIndex((s) => collected[s.key] == null);
  const isComplete = nextIndex === -1;

  const updated = {
    ...form,
    collected,
    history,
    currentSlotIndex: isComplete ? form.currentSlotIndex : nextIndex,
    status: isComplete ? 'COMPLETE' : 'COLLECTING',
    completedAt: isComplete ? now : null,
    updatedAt: now
  };
  const nextStore = { ...store, [conversationId || 'default']: updated };
  writeStore(nextStore);

  const fa = String(locale || form.locale || 'fa').startsWith('fa');
  const ack = fa
    ? `✓ ${slot.labelFa}: ${formatValue(slot, value, fa)} ثبت شد.`
    : `✓ ${slot.labelEn}: ${formatValue(slot, value, fa)} recorded.`;

  if (isComplete) {
    return {
      ok: true,
      complete: true,
      ack,
      summary: buildSummary(updated, def, fa),
      form: updated,
      data: buildFinalData(updated),
      nextMessage: fa ? def.fa.done : def.en.done
    };
  }
  return {
    ok: true,
    complete: false,
    ack,
    form: updated,
    nextSlot: getCurrentSlot({ conversationId, locale, now })
  };
}

function buildSummary(form, def, fa) {
  const lines = def.slots.map((s) => {
    const v = form.collected[s.key];
    const label = fa ? s.labelFa : s.labelEn;
    return `${label}: ${formatValue(s, v, fa)}`;
  });
  return (fa ? 'اطلاعات ثبت‌شده:' : 'Collected info:') + '\n' + lines.join(' · ');
}

function buildFinalData(form) {
  const c = form.collected || {};
  return {
    capitalUsd: Number(c.capitalUsd) || null,
    targetPct: Number(c.targetPct) || null,
    horizonDays: Number(c.horizonDays?.days ?? c.horizonDays) || null,
    riskProfile: c.riskProfile || 'balanced',
    floorPct: num(c.floorPct),
    formId: form.formId,
    startedAt: form.startedAt,
    completedAt: form.completedAt
  };
}

export function cancelForm({ conversationId = null, now = Date.now() } = {}) {
  const store = readStore();
  const form = store[conversationId || 'default'];
  if (!form) return { ok: false, error: 'NO_FORM' };
  const next = { ...store, [conversationId || 'default']: { ...form, status: 'CANCELLED', updatedAt: now } };
  writeStore(next);
  return { ok: true };
}

export function clearForm({ conversationId = null } = {}) {
  const store = readStore();
  const next = { ...store };
  delete next[conversationId || 'default'];
  writeStore(next);
  return { ok: true };
}

/** بررسی اینکه آیا پیام شروع‌کننده‌ی یک فرم هدف‌دار است. */
export function detectFormTrigger(text) {
  const t = foldText(String(text || ''));
  if (!t) return null;
  // کلمات کلیدی هدف‌گذاری و سرمایه‌گذاری (فارسی و انگلیسی)
  if (/(?:استراتژ|برنامه\s*سرمایه|هدف\s*.*سود|هدف\s*مالی|چقدر\s*سرمایه|سرمایه\s*.*سود|سود\s*.*سرمایه|سرمایه\s*گذار|می\s*خو?ا?م\s*.*سرمایه|سرمایه\s*می\s*خو?ا?م|قصد\s*سرمایه|چطور.*سرمایه|چگونه.*سرمایه|investment\s*plan|strategy|i\s*want\s*to\s*(?:invest|make)|how\s*much\s*(?:should|to)\s*invest|build\s*me\s*a\s*plan)/i.test(t)) {
    return 'STRATEGY_GOAL';
  }
  return null;
}

export { FORMS };

export function isFormInterruption(text = '') {
  const folded = foldText(text);
  return /اضطرار|توقف|متوقف|فریز|\b(?:emergency|stop|pause|freeze)\b/i.test(folded)
    || /(?:تحلیل|بررسی|نشان|نمایش|باز کن|جستجو|بخر|بفروش|سرچ|\b(?:analy[sz]e|show|open|search|buy|sell|swap)\b)/i.test(folded)
      && /بازار|پرتفوی|کیف پول|اخبار|بیت|اتریوم|btc|eth|wallet|portfolio|market|news|سواپ|مرکز عملیات|ایجنت/i.test(folded);
}
