/**
 * FBT INTENT OS — PHASE 213: THE OPEN QUESTION LEDGER
 * ---------------------------------------------------------------------------
 * The complaint this module exists to answer:
 *
 *   «اگر سوالی می‌پرسد هوش مصنوعی باید منتظر جواب کاربر باشد و در جواب اون
 *    کار کند، نه اینکه یادش بره»
 *
 * The OS already had three places that could remember a question
 * (`pendingU7QuestionRef`, `conversationState.lastQuestionId`, the Upgrade-8
 * pending question). Three place, three lifetimes, one bug: a question asked on
 * the server path left nothing the next turn could bind to, and a question asked
 * before a reload was gone. This module is the single durable contract:
 *
 *   ONE open question at a time, persisted, bound exactly once.
 *
 *   askQuestion ──▶ [ open ] ──user message──▶ classifyAnswer
 *                     ▲                            │
 *                     │                    ANSWER │ SKIP │ CANCEL │ NEW_TOPIC
 *                     │                            ▼
 *                     └── re-surfaced once ──── closed with a reason
 *
 * Laws (all enforced here, all tested by test/intent-ai/phase213-*.mjs):
 *   1. Asking a new question SUPERSEDES the old one; it never silently
 *      orphans it, and it never asks the same question twice in a row.
 *   2. An answer is consumed exactly once. `bindAnswer` closes the question,
 *      so the next turn cannot re-bind the same sentence.
 *   3. A new topic does NOT eat the question: the question stays open, and the
 *      caller is told to answer the new request AND re-surface the question
 *      (in fresh wording, because repeating the same sentence is what "dumb"
 *      looks like).
 *   4. Nothing here executes anything. The ledger stores slots and text only —
 *      no wallet, no plan, no authority.
 *   5. Storage failures are survivable: private mode still works in memory.
 */

export const OPEN_QUESTION_SCHEMA = 'fbt.open-question.v1';
export const OPEN_QUESTION_KEY = 'fbt.chat.open-question.v1';
/** A question older than this stops blocking turns (it is not forgotten, it is
 *  honestly expired — the bar stops showing and the ledger says why). */
export const QUESTION_TTL_MS = 24 * 60 * 60 * 1000;
/** Do not ask the same sentence twice inside this window (§33 no-repetition). */
export const ANTI_REPEAT_WINDOW_MS = 30 * 60 * 1000;
export const MAX_LEDGER = 40;

export const ANSWER_KINDS = Object.freeze({
  ANSWER: 'ANSWER',
  SKIP: 'SKIP',
  CANCEL: 'CANCEL',
  NEW_TOPIC: 'NEW_TOPIC'
});

export const QUESTION_STATUS = Object.freeze({
  OPEN: 'open',
  ANSWERED: 'answered',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
  SUPERSEDED: 'superseded',
  EXPIRED: 'expired'
});

/* -------------------------------------------------------------------------- */
/*  TEXT NORMALISATION — Persian arrives with ZWNJ and Persian digits           */
/* -------------------------------------------------------------------------- */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(value) {
  return String(value ?? '')
    .split('')
    .map((ch) => {
      const p = PERSIAN_DIGITS.indexOf(ch);
      if (p >= 0) return String(p);
      const a = ARABIC_DIGITS.indexOf(ch);
      if (a >= 0) return String(a);
      return ch;
    })
    .join('');
}

/** Fold for comparison only — the stored question keeps its original wording. */
export function foldText(value) {
  return normalizeDigits(value)
    .replace(/\u200c/g, ' ')
    .replace(/[\u200b\u200e\u200f]/g, '')
    .replace(/[«»"'`؛;,.:!?؟\-–—()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  STORAGE — memory first, localStorage when available                        */
/* -------------------------------------------------------------------------- */

let memoryLedger = [];

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readLedger() {
  const store = storage();
  if (!store) return [...memoryLedger];
  try {
    const raw = store.getItem(OPEN_QUESTION_KEY);
    if (!raw) return [...memoryLedger];
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [];
    memoryLedger = rows;
    return [...rows];
  } catch {
    return [...memoryLedger];
  }
}

function writeLedger(rows) {
  const list = (Array.isArray(rows) ? rows : []).slice(-MAX_LEDGER);
  memoryLedger = list;
  const store = storage();
  if (!store) return list;
  try {
    store.setItem(OPEN_QUESTION_KEY, JSON.stringify(list));
  } catch { /* private mode: the in-memory ledger still serves this session */ }
  return list;
}

/* -------------------------------------------------------------------------- */
/*  ASK                                                                        */
/* -------------------------------------------------------------------------- */

function newId(prefix = 'q') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Questions with no question mark and no verb still count; we only need a
 *  stable fingerprint to stop asking the same thing twice. */
export function questionFingerprint(text) {
  return foldText(text).slice(0, 200);
}

export function findOpenRow(rows, { conversationId = null } = {}) {
  const conv = conversationId ? String(conversationId) : null;
  const open = (rows || []).filter((row) => row && row.status === QUESTION_STATUS.OPEN);
  const scoped = conv ? open.filter((row) => !row.conversationId || row.conversationId === conv) : open;
  return scoped.length ? scoped[scoped.length - 1] : null;
}

/**
 * Register the question the assistant just asked. There is exactly one open
 * question afterwards — the previous one is superseded with a reason, so a
 * later "why did you drop my question?" has an answer in the ledger.
 */
export function askQuestion({
  text,
  slot = 'text',
  expectedType = 'text',
  options = [],
  intentId = null,
  conversationId = null,
  locale = 'fa',
  source = 'chat',
  now = Date.now()
} = {}) {
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, error: 'EMPTY_QUESTION' };

  const rows = readLedger();
  const fingerprint = questionFingerprint(clean);
  const previous = findOpenRow(rows, { conversationId });

  if (previous && previous.fingerprint === fingerprint) {
    /* Same question, same session: keep the open row (do not reset its clock)
       and tell the caller it is a repeat so the UI does not stack two bars. */
    return { ok: true, repeat: true, question: previous, replacedId: null };
  }

  const question = {
    schema: OPEN_QUESTION_SCHEMA,
    id: newId('q'),
    questionId: null,
    text: clean,
    fingerprint,
    slot: String(slot || 'text'),
    expectedType: String(expectedType || 'text'),
    options: (Array.isArray(options) ? options : [])
      .slice(0, 6)
      .map((o, i) => (typeof o === 'string'
        ? { id: `opt_${i}`, label: o }
        : { id: String(o?.id || `opt_${i}`), label: String(o?.label || o?.value || '') })),
    intentId: intentId ? String(intentId) : null,
    conversationId: conversationId ? String(conversationId) : null,
    locale: String(locale || 'fa').slice(0, 5),
    source: String(source || 'chat').slice(0, 32),
    status: QUESTION_STATUS.OPEN,
    askedAt: now,
    updatedAt: now,
    closedAt: null,
    closeReason: null,
    reaskCount: 0,
    answer: null,
    answeredAt: null,
    lastUserMessage: null,
    lastUserMessageAt: null
  };
  question.questionId = question.id;

  if (previous) {
    const idx = rows.findIndex((row) => row.id === previous.id);
    rows[idx] = {
      ...rows[idx],
      status: QUESTION_STATUS.SUPERSEDED,
      closeReason: 'new_question_asked',
      closedAt: now,
      updatedAt: now
    };
  }
  rows.push(question);
  writeLedger(rows);
  return { ok: true, repeat: false, question, replacedId: previous?.id || null };
}

/** Was this sentence already asked inside the anti-repeat window? */
export function wasRecentlyAsked(text, { now = Date.now(), windowMs = ANTI_REPEAT_WINDOW_MS } = {}) {
  const fp = questionFingerprint(text);
  if (!fp) return false;
  return readLedger().some((row) => row.fingerprint === fp && now - Number(row.askedAt || 0) <= windowMs);
}

/* -------------------------------------------------------------------------- */
/*  READ                                                                       */
/* -------------------------------------------------------------------------- */

export function getOpenQuestion({ conversationId = null, now = Date.now() } = {}) {
  const rows = readLedger();
  const row = findOpenRow(rows, { conversationId });
  if (!row) return null;
  if (now - Number(row.askedAt || 0) > QUESTION_TTL_MS) {
    const idx = rows.findIndex((r) => r.id === row.id);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], status: QUESTION_STATUS.EXPIRED, closeReason: 'ttl', closedAt: now, updatedAt: now };
      writeLedger(rows);
    }
    return null;
  }
  return row;
}

/** Same read, but it also says WHETHER something expired — the UI shows a
 *  one-line note instead of silently dropping a question. */
export function getOpenQuestionState({ conversationId = null, now = Date.now() } = {}) {
  const rows = readLedger();
  const open = findOpenRow(rows, { conversationId });
  if (open) {
    const age = now - Number(open.askedAt || 0);
    if (age > QUESTION_TTL_MS) {
      return { question: null, expired: true, expiredAt: Number(open.askedAt) + QUESTION_TTL_MS, open: false };
    }
    return { question: open, expired: false, open: true, ageMs: age };
  }
  const last = rows[rows.length - 1] || null;
  return {
    question: null,
    expired: Boolean(last && last.status === QUESTION_STATUS.EXPIRED),
    expiredAt: last?.closedAt || null,
    open: false
  };
}

export function getLedger() {
  return readLedger();
}

/* -------------------------------------------------------------------------- */
/*  ANSWER CLASSIFICATION                                                      */
/* -------------------------------------------------------------------------- */

const CANCEL_RE = /(?:^|\s)(?:بی\s*خیال|بیخیال|ولش\s*کن|کنسل|لغو\s*کن|فراموشش\s*کن|never\s*mind|nevermind|forget\s*it|cancel|drop\s*it)(?![A-Za-z0-9\u0621-\u06FF])/i;
const SKIP_RE = /(?:^|\s)(?:نمی\s*دونم|نمی\s*دانم|نمی\s*دونم|نمی‌?دانم|هیچ\s*ایده|بعدا|بعداً|فعلا\s*نه|فعلاً\s*نه|هر\s*چی|هرچی|مهم\s*نیست|فرقی\s*نمی\s*کنه|skip|idk|i\s*don'?t\s*know|dont\s*know|no\s*idea|later|whatever|any(?:thing)?|not\s*sure|unsure)(?![A-Za-z0-9\u0621-\u06FF])/i;
const YES_RE = /(?:^|\s)(?:بله|آره|اره|بلی|باشه|اوکی|اوکیه|حتما|قطعا|موافقم|تایید|تأیید|درسته|yes|yep|yeah|sure|ok|okay|confirm|confirmed|approve|correct)(?![A-Za-z0-9\u0621-\u06FF])/i;
const NO_RE = /(?:^|\s)(?:نه|خیر|نمی\s*خوام|نمیخوام|نمی‌?خواهم|مخالفم|رد\s*می\s*کنم|no|nope|don'?t|do\s*not|reject|decline)(?![A-Za-z0-9\u0621-\u06FF])/i;
/** A sentence that starts a NEW request is not an answer to a slot question. */
const NEW_REQUEST_RE = /(?:^|\s)(?:می\s*خوام|میخوام|می‌?خواهم|میخام|تحلیل\s*کن|بده|بگیر|بساز|بزن|ببند|بپای|نشان\s*بده|بخر|بفروش|بفروشم|سواپ|swap|bridge|انتقال\s*بده|بفرست|جستجو\s*کن|سرچ\s*کن|search|صداش\s*کن|صداشو\s*کن|compare|مقایسه\s*کن|وضعیت|گزارش\s*بده|بعدا|بعداً|بعدتر)(?![A-Za-z0-9\u0621-\u06FF])/i;
/** Domain nouns that, beside an imperative, mean "a new request", not "an answer". */
const DOMAIN_RE = /(?:بازار|پرتفوی|پورتفو|کیف\s*پول|قیمت|سواپ|بریج|فارم|وام|استخر|خبر|گزارش|تحلیل|مقایسه|بیت\s*کوین|بیتکوین|اتریوم|سولانا|بازارها|swap|bridge|market|portfolio|price|news|analysis|report|compare|btc|eth|sol)/i;
/** Vocabulary that belongs to the coordination questions themselves — a
 *  coordination subject IS the answer to "دربارهٔ چه چیزی مذاکره کنند؟". */
const NEGOTIATION_VOCAB = /(?:مذاکره|ایجنت|شورا|توافق|تضاد|اضطرار|نظر\s*دوم|negotiat|agent|council|agreement|conflict)/i;

/* Small talk that must never be mistaken for the answer to a financial
   question. Deliberately a short, high-precision list — the full classifier
   lives in `chat/socialChat.js` and is used by the chat itself. */
const SOCIAL_TURN_RE = /^(?:سلام|درود|سلام\s*علیکم|صبح\s*بخیر|شب\s*بخیر|حالت\s*چطوره|حالت\s*چطور\s*است|چطوری|خوبی|چه\s*خبر|چخبر|ممنون|مرسی|متشکرم|thanks|thank\s*you|hi|hello|hey|how\s*are\s*you|good\s*morning|good\s*evening|nasılsın|merhaba)[!؟?.\s]*$/i;
const QUESTION_MARK_RE = /[?؟]\s*$/;

const MONTH_RE = /(\d+(?:[.,]\d+)?)\s*(?:ماه|month|months|mo)(?![A-Za-z\u0621-\u06FF])/i;
const DAY_RE = /(\d+(?:[.,]\d+)?)\s*(?:روز|day|days|d)(?![A-Za-z\u0621-\u06FF])/i;
const WEEK_RE = /(\d+(?:[.,]\d+)?)\s*(?:هفته|week|weeks|wk|wks)(?![A-Za-z\u0621-\u06FF])/i;
const YEAR_RE = /(\d+(?:[.,]\d+)?)\s*(?:سال|year|years|yr|yrs)(?![A-Za-z\u0621-\u06FF])/i;
const AMOUNT_RE = /(\$|usd|usdt|usdc|دلار|تتر|دلاری)?\s*([\d][\d.,\u066b]*)\s*(k|هزار|thousand|میلیون|million|m)?\s*(?:\$|usd|usdt|usdc|دلار|تتر|دلاری)?/i;
const PERCENT_RE = /([\d][\d.,]*)\s*(?:%|درصد|percent)/i;

function toNumber(raw, scale = '') {
  const base = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const s = String(scale || '').toLowerCase();
  if (s === 'k' || s === 'هزار' || s === 'thousand') return base * 1000;
  if (s === 'million' || s === 'm' || s === 'میلیون') return base * 1e6;
  return base;
}

/**
 * What did the user's message do to the open question?
 *
 * The four kinds are deliberately about BEHAVIOUR, not sentiment:
 * ANSWER  → bind the value, close the question, continue the work
 * SKIP    → close with reason `skipped`, continue with the stated assumption
 * CANCEL  → close with reason `cancelled`, stop asking
 * NEW_TOPIC → keep it open, answer the new request, re-surface in fresh words
 */
export function classifyAnswer(text, question = null, { now = Date.now() } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { kind: ANSWER_KINDS.SKIP, value: null, reason: 'EMPTY' };
  const folded = foldText(raw);
  const expected = String(question?.expectedType || 'text');

  if (CANCEL_RE.test(folded)) return { kind: ANSWER_KINDS.CANCEL, value: null, reason: 'USER_CANCELLED' };

  /* «حالت چطوره» while a question is open is small talk, not the answer. A
     pleasantry must not silently consume the slot the question asked for —
     the question stays open and the turn is read as a new (social) topic. */
  if (SOCIAL_TURN_RE.test(folded)) {
    return { kind: ANSWER_KINDS.NEW_TOPIC, value: null, reason: 'SOCIAL_TURN' };
  }

  /* A message that BOTH defers and asks for something new («بعداً جواب می‌دهم،
     یک تحلیل از بازار بده») is a new request, not a skip: the question must
     survive it. This check therefore runs before the skip words. */
  const answersItsOwnSubject = question?.source === 'negotiation' && NEGOTIATION_VOCAB.test(folded);
  const imperative = NEW_REQUEST_RE.test(folded) && DOMAIN_RE.test(folded);
  const shortNewQuestion = QUESTION_MARK_RE.test(raw) && folded.split(' ').length > 3 && DOMAIN_RE.test(folded);
  if (!answersItsOwnSubject && (imperative || shortNewQuestion)) {
    return { kind: ANSWER_KINDS.NEW_TOPIC, value: null, reason: 'NEW_REQUEST' };
  }

  if (SKIP_RE.test(folded)) return { kind: ANSWER_KINDS.SKIP, value: null, reason: 'USER_SKIPPED' };

  /* Choice questions accept a label, an index, or a yes/no. */
  const options = Array.isArray(question?.options) ? question.options : [];
  if (options.length) {
    const hit = options.find((o) => foldText(o.label) && folded.includes(foldText(o.label)))
      || options.find((o) => foldText(o.id) && folded === foldText(o.id));
    if (hit) return { kind: ANSWER_KINDS.ANSWER, value: { id: hit.id, label: hit.label }, reason: 'OPTION_MATCH' };
    const indexMatch = folded.match(/^(?:گزینه\s*)?([1-6])(?:ی|م|ام)?$/) || folded.match(/(?:option|گزینه)\s*([1-6])/);
    if (indexMatch) {
      const idx = Number(indexMatch[1]) - 1;
      if (options[idx]) return { kind: ANSWER_KINDS.ANSWER, value: { id: options[idx].id, label: options[idx].label }, reason: 'OPTION_INDEX' };
    }
  }

  if (expected === 'yes-no' || expected === 'confirmation') {
    if (YES_RE.test(folded)) return { kind: ANSWER_KINDS.ANSWER, value: true, reason: 'YES' };
    if (NO_RE.test(folded)) return { kind: ANSWER_KINDS.ANSWER, value: false, reason: 'NO' };
  }

  if (expected === 'amount' || expected === 'number') {
    const m = folded.match(AMOUNT_RE);
    const amount = m ? toNumber(m[2], m[3]) : null;
    if (amount != null) return { kind: ANSWER_KINDS.ANSWER, value: amount, reason: 'NUMBER' };
  }

  if (expected === 'percent') {
    const p = folded.match(PERCENT_RE) || folded.match(AMOUNT_RE);
    const pct = p ? toNumber(p[1] ?? p[2], p[3]) : null;
    if (pct != null) return { kind: ANSWER_KINDS.ANSWER, value: pct, reason: 'PERCENT' };
  }

  if (expected === 'duration' || expected === 'timeframe') {
    const month = folded.match(MONTH_RE);
    if (month) return { kind: ANSWER_KINDS.ANSWER, value: { unit: 'month', value: toNumber(month[1]) }, reason: 'DURATION' };
    const week = folded.match(WEEK_RE);
    if (week) return { kind: ANSWER_KINDS.ANSWER, value: { unit: 'week', value: toNumber(week[1]) }, reason: 'DURATION' };
    const day = folded.match(DAY_RE);
    if (day) return { kind: ANSWER_KINDS.ANSWER, value: { unit: 'day', value: toNumber(day[1]) }, reason: 'DURATION' };
    const year = folded.match(YEAR_RE);
    if (year) return { kind: ANSWER_KINDS.ANSWER, value: { unit: 'year', value: toNumber(year[1]) }, reason: 'DURATION' };
  }

  /* Generic numeric slot asked in words ("چند؟") still deserves the number. */
  if (!options.length && expected === 'text' && /^\s*-?[\d][\d.,\s]*$/.test(folded)) {
    return { kind: ANSWER_KINDS.ANSWER, value: toNumber(folded.replace(/\s/g, '')), reason: 'BARE_NUMBER' };
  }

  /* Anything else is treated as the answer text itself: an open question that
     awaits a sentence ("هدف بعدی‌ات چیست؟") must not be dropped because the
     reply had no keyword. */
  return { kind: ANSWER_KINDS.ANSWER, value: raw.slice(0, 400), reason: 'FREE_TEXT' };
}

/* -------------------------------------------------------------------------- */
/*  BIND                                                                       */
/* -------------------------------------------------------------------------- */

function closeRow(rows, id, status, reason, { now, answer = null } = {}) {
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  rows[idx] = {
    ...rows[idx],
    status,
    closeReason: reason,
    closedAt: now,
    updatedAt: now,
    answer: answer ?? rows[idx].answer,
    answeredAt: answer != null ? now : rows[idx].answeredAt
  };
  return rows[idx];
}

/**
 * Bind the user's message to the open question. Called on EVERY turn (from the
 * chat surface, before the pipeline runs) so a question asked anywhere in the
 * app is answered wherever the user replies.
 */
export function bindAnswer({ text, conversationId = null, now = Date.now() } = {}) {
  const rows = readLedger();
  const open = findOpenRow(rows, { conversationId });
  if (!open) return { ok: false, error: 'NO_OPEN_QUESTION' };

  const verdict = classifyAnswer(text, open, { now });
  const base = { ok: true, question: open, kind: verdict.kind, value: verdict.value, reason: verdict.reason };

  if (verdict.kind === ANSWER_KINDS.ANSWER) {
    const closed = closeRow(rows, open.id, QUESTION_STATUS.ANSWERED, verdict.reason, { now, answer: verdict.value });
    writeLedger(rows);
    return { ...base, closed: true, question: closed };
  }
  if (verdict.kind === ANSWER_KINDS.SKIP) {
    const closed = closeRow(rows, open.id, QUESTION_STATUS.SKIPPED, verdict.reason, { now });
    writeLedger(rows);
    return { ...base, closed: true, question: closed };
  }
  if (verdict.kind === ANSWER_KINDS.CANCEL) {
    const closed = closeRow(rows, open.id, QUESTION_STATUS.CANCELLED, verdict.reason, { now });
    writeLedger(rows);
    return { ...base, closed: true, question: closed };
  }

  /* NEW_TOPIC: the question survives, the new request is still served. */
  const idx = rows.findIndex((row) => row.id === open.id);
  rows[idx] = {
    ...rows[idx],
    lastUserMessage: String(text || '').slice(0, 300),
    lastUserMessageAt: now,
    reaskCount: Number(rows[idx].reaskCount || 0) + 1,
    updatedAt: now
  };
  writeLedger(rows);
  return { ...base, closed: false, question: rows[idx] };
}

/** Close a question without an answer (user pressed ✕, or the flow moved on). */
export function closeQuestion({ questionId = null, reason = 'closed_by_user', now = Date.now() } = {}) {
  const rows = readLedger();
  const target = questionId
    ? rows.find((row) => row.id === questionId)
    : findOpenRow(rows, {});
  if (!target) return { ok: false, error: 'QUESTION_NOT_FOUND' };
  const status = reason === 'skipped' ? QUESTION_STATUS.SKIPPED : QUESTION_STATUS.CANCELLED;
  const closed = closeRow(rows, target.id, status, reason, { now }) || target;
  writeLedger(rows);
  return { ok: true, question: closed };
}

export function resetLedger() {
  memoryLedger = [];
  const store = storage();
  if (store) {
    try { store.removeItem(OPEN_QUESTION_KEY); } catch { /* nothing to clear */ }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  WHAT THE TURN MUST SAY AND WHAT THE MODEL MUST BE TOLD                     */
/* -------------------------------------------------------------------------- */

const SLOT_LABELS = Object.freeze({
  amount: { fa: 'مقدار', en: 'amount' },
  amountUsd: { fa: 'مقدار دلاری', en: 'USD amount' },
  token: { fa: 'دارایی', en: 'asset' },
  chain: { fa: 'شبکه', en: 'network' },
  duration: { fa: 'بازه زمانی', en: 'timeframe' },
  timeframe: { fa: 'بازه زمانی', en: 'timeframe' },
  percent: { fa: 'درصد', en: 'percentage' },
  risk: { fa: 'سطح ریسک', en: 'risk level' },
  riskProfile: { fa: 'سطح ریسک', en: 'risk level' },
  choice: { fa: 'انتخاب', en: 'choice' },
  confirmation: { fa: 'تأیید', en: 'confirmation' },
  text: { fa: 'توضیح', en: 'detail' }
});

export function slotLabel(slot, locale = 'fa') {
  const key = String(slot || 'text');
  const entry = SLOT_LABELS[key] || null;
  const lang = String(locale || 'fa').toLowerCase().startsWith('fa') ? 'fa' : 'en';
  if (entry) return entry[lang];
  return key;
}

function formatValue(value, locale = 'fa') {
  const fa = String(locale || 'fa').toLowerCase().startsWith('fa');
  if (value === true) return fa ? 'بله' : 'yes';
  if (value === false) return fa ? 'نه' : 'no';
  if (value && typeof value === 'object') {
    if (value.unit) {
      const unit = { month: fa ? 'ماه' : 'month(s)', week: fa ? 'هفته' : 'week(s)', day: fa ? 'روز' : 'day(s)', year: fa ? 'سال' : 'year(s)' }[value.unit] || value.unit;
      return `${value.value} ${unit}`;
    }
    if (value.label) return String(value.label);
    return JSON.stringify(value);
  }
  return String(value ?? '—');
}

/**
 * The sentence the chat shows when a question was just answered or skipped.
 * Short, factual, and it names the slot — which is what proves to the user that
 * the answer was actually recorded rather than politely acknowledged.
 */
export function acknowledgement(verdict, { locale = 'fa' } = {}) {
  const fa = String(locale || 'fa').toLowerCase().startsWith('fa');
  const q = verdict?.question || {};
  if (!verdict?.ok) return null;
  if (verdict.kind === ANSWER_KINDS.ANSWER) {
    const slot = slotLabel(q.slot, locale);
    const value = formatValue(verdict.value, locale);
    return fa ? `✓ ثبت شد — ${slot}: ${value}. حالا با همین ادامه می‌دهم.` : `✓ Recorded — ${slot}: ${value}. Continuing with that.`;
  }
  if (verdict.kind === ANSWER_KINDS.SKIP) {
    return fa ? 'باشه، از این یکی گذشتم و سؤالم را بستم؛ هر وقت خواستی بگو تا برگردیم سرش.' : "Fine — I closed that question and moved on. Say the word if you want to come back to it.";
  }
  if (verdict.kind === ANSWER_KINDS.CANCEL) {
    return fa ? 'باشه، سؤال لغو شد.' : 'OK, that question is cancelled.';
  }
  if (verdict.kind === ANSWER_KINDS.NEW_TOPIC) {
    return fa
      ? `به درخواست جدیدت می‌رسم. فقط این یک سؤال هنوز باز مانده: «${q.text}» — هر وقت جوابش را دادی، همان را ادامه می‌دهم.`
      : `I'll handle the new request. One question is still open: "${q.text}" — answer it whenever you like and I'll continue from there.`;
  }
  return null;
}

/**
 * The exact instruction block appended to the model prompt. Written as a
 * constraint, not a suggestion: the model is told what the turn IS, what to do
 * with it, and what it is forbidden to do (re-ask, or silently change subject).
 * Returns null when nothing is open — the turn is then a normal turn.
 */
export function promptBlock({ locale = 'fa' } = {}) {
  const state = getOpenQuestionState();
  if (!state.question) return null;
  const q = state.question;
  const fa = String(locale || 'fa').toLowerCase().startsWith('fa');
  const slot = slotLabel(q.slot, locale);
  const options = q.options.map((o) => o.label).filter(Boolean);
  const lines = fa
    ? [
        '[سؤال باز — الزامی]',
        `تو پیش‌تر این سؤال را از کاربر پرسیدی: «${q.text}» (اسلات: ${slot}).`,
        options.length ? `گزینه‌هایی که خودت دادی: ${options.join(' | ')}.` : '',
        'پیام این نوبت کاربر را اول به‌عنوان پاسخ همین سؤال بخوان.',
        'اگر پاسخ است: در یک خط تأیید کن چه چیزی ثبت شد، سپس همان کار نیمه‌تمام را ادامه بده. سؤال را تکرار نکن.',
        'اگر پاسخ نیست و درخواست تازه‌ای است: درخواست تازه را انجام بده، و در پایان فقط یک بار و با جمله‌ای تازه یادآوری کن که این سؤال هنوز باز است.',
        'هرگز ادعا نکن چیزی را ثبت یا اجرا کرده‌ای که نشده. سؤال را دوباره با همان جمله نپرس.'
      ]
    : [
        '[OPEN QUESTION — MANDATORY CONTEXT]',
        `You previously asked the user: "${q.text}" (slot: ${slot}).`,
        options.length ? `Choices you offered: ${options.join(' | ')}.` : '',
        "Read this turn's user message FIRST as a reply to that question.",
        'If it is an answer: acknowledge in one line what was recorded, then continue the unfinished work. Do not repeat the question.',
        'If it is a new request: serve the new request, and once at the end remind them in fresh wording that the question is still open.',
        'Never claim something was recorded or executed when it was not. Never ask the same question twice.'
      ];
  return lines.filter(Boolean).join('\n');
}

/** Compact object that travels to the server inside `hints`. */
export function answerHint(verdict = null) {
  const state = getOpenQuestionState();
  const q = verdict?.question || state.question;
  if (!q && !verdict) return null;
  return {
    schema: OPEN_QUESTION_SCHEMA,
    questionId: q?.id || null,
    question: q?.text || null,
    slot: q?.slot || null,
    expectedType: q?.expectedType || null,
    status: verdict?.kind || null,
    value: verdict?.value ?? null,
    closed: verdict?.closed === true,
    stillOpen: verdict ? verdict.closed !== true : true,
    at: Date.now()
  };
}

/**
 * The single object the chat attaches to a chat request so the server reads the
 * turn as an answer (or as a turn that happens while a question is open). Built
 * here, next to the two pieces it is made of, so the client and the probe share
 * one definition instead of re-assembling it at each call site.
 */
export function answerBindingHint({ verdict = null, locale = 'fa' } = {}) {
  const state = getOpenQuestionState();
  const prompt = promptBlock({ locale });
  if (!verdict && !state.question) return null;
  return {
    schema: OPEN_QUESTION_SCHEMA,
    ...(verdict ? { verdict: answerHint(verdict) } : {}),
    ...(prompt ? { prompt } : {}),
    stillOpen: Boolean(state.question),
    at: Date.now()
  };
}

export const QUESTION_LEDGER_INFO = Object.freeze({
  schema: OPEN_QUESTION_SCHEMA,
  storageKey: OPEN_QUESTION_KEY,
  ttlMs: QUESTION_TTL_MS,
  antiRepeatWindowMs: ANTI_REPEAT_WINDOW_MS,
  maxOpen: 1
});
