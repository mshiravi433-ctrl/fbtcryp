/**
 * REQUEST PLAN — read the request, then build the answer it actually asked for.
 * ---------------------------------------------------------------------------
 * Two layers already read the message: `socialRead` reads the PERSON (register,
 * tone, hidden need) and `dialogueRead` reads the QUESTION (act, shape). Neither
 * answers the question a reviewer of answers has to ask:
 *
 *   · What is the user supposed to be holding when this answer ends?
 *     A verdict? A number? A plan with weights? A mechanism?
 *   · Which facts does that deliverable REQUIRE, and did the user actually give
 *     them — or is the answer about to invent a 10,000-dollar budget nobody
 *     mentioned?
 *   · How long should it be, at what register, for a beginner or an expert?
 *   · In what ORDER does a good answer to this request go — and does the first
 *     sentence answer, or does it warm up?
 *
 * So this module builds a deterministic plan (no model call):
 *
 *   deliverable  verdict | number | comparison | plan | explanation | steps |
 *                scenario | reassurance | fact
 *   constraints  amount, horizon, risk limit, format, length, urgency
 *   missing      the critical slots the deliverable needs and the turn lacks
 *   expertise    beginner | mixed | expert (from the vocabulary of the message)
 *   stance       warmth, directness, length mirroring, at most one ask-back
 *   blueprint    first-sentence rule, ordered sections, sentence budget, avoids
 *
 * `checkRequestPlan` then holds the draft to it, and only with narrow triggers:
 * a preamble that hides the verdict, a budget/horizon the turn never had, the
 * ignored missing slot, a four-paragraph answer to «کوتاه بگو», and expert
 * jargon aimed at someone who said they are new.
 *
 * Smartest mode only, level 3+. balanced/swift keep the prompt they always had.
 */

export const REQUEST_PLAN_SCHEMA = 'fbt.ai-request-plan.v1';
export const REQUEST_PLAN_VERSION = '1.0.0';

/* ── text helpers ─────────────────────────────────────────────────────────── */

const FA_DIGITS = /[\u06F0-\u06F9]/g;
const AR_DIGITS = /[\u0660-\u0669]/g;

/** Persian/Arabic digits → ASCII, ZWNJ removed, thousands separators dropped. */
export function normalizeText(value = '') {
  return String(value || '')
    .replace(FA_DIGITS, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(AR_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u200c/g, ' ')
    /* «۶۸٬۰۰۰» and «۶۸,۰۰۰» are one number; «۶۸٫۵» is a decimal. Turning the
       separators into spaces (the obvious first move) splits 10 000 in two and
       every amount check downstream then sees "10". */
    .replace(/[\u066c٬,]/g, '')
    .replace(/[\u066b٫]/g, '.')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* Persian word boundary: `\b` is ASCII-only, so it never matches at «بخر» /
   «بخرم». Every keyword below is matched with explicit letter lookarounds. */
function word(text, term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loose = escaped.replace(/\s+/g, '[\\s\u200c]*');
  return new RegExp(`(?<![\\p{L}])${loose}(?![\\p{L}])`, 'iu').test(text);
}

function anyWord(text, list) {
  return list.some((term) => word(text, term));
}

function sentencesOf(text = '') {
  return String(text || '')
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[^\p{L}\p{N}]/gu, '').length > 0);
}

/* ── lexicons ─────────────────────────────────────────────────────────────── */

const VERDICT_ASK = [
  'بخرم یا نه', 'بخرم یا نگیرم', 'نگه دارم', 'نگهش دارم', 'بفروشم', 'بفروشم یا نه',
  'به نظرت', 'نظرت چیه', 'ارزششو داره', 'ارزش دارد', 'منطقیه', 'به صلاح',
  'برم داخل', 'وارد بشم', 'وارد شوم', 'شروع کنم',
  'should i', 'should we', 'worth it', 'hold or sell', 'buy or wait', 'what do you think'
];

const NUMBER_ASK = ['چقدر', 'چنده', 'چند است', 'چند میشه', 'قیمتش', 'نرخ', 'how much', 'what price'];
/* No bare «یا»: it appears in half of all Persian sentences. Comparison
   needs a comparing phrase AND two assets. */
const COMPARE_ASK = ['کدوم بهتره', 'کدوم بهتر', 'کدام بهتر', 'کدوم رو بگیرم', 'مقایسه', 'بهتره یا', 'کدومش', 'versus', ' vs ', 'compare', 'which is better'];
const PLAN_ASK = ['استراتژی', 'برنامه', 'تخصیص', 'چطور تقسیم', 'چگونه تقسیم', 'چند درصد', 'پلن', 'strategy', 'allocation', 'plan'];
const EXPLAIN_ASK = ['چرا', 'یعنی چی', 'یعنی چه', 'توضیح بده', 'دلیلش', 'چطور کار میکنه', 'چگونه کار', 'why', 'explain', 'what does', 'how does', 'meaning'];
const STEPS_ASK = ['چطور', 'چگونه', 'مراحل', 'قدم به قدم', 'گام به گام', 'how do i', 'how to', 'steps'];
const SCENARIO_ASK = ['پیش بینی', 'پیشبینی', 'آینده', 'تا ماه', 'تا سال', 'تا هفته', 'forecast', 'outlook', 'next month', 'next year'];
const ANALYSIS_ASK = ['تحلیل', 'بررسی', 'وضعیت بازار', 'روند بازار', 'analyze', 'analysis', 'review', 'market outlook'];

const SHORT_FORMAT = ['کوتاه', 'خلاصه', 'در یک خط', 'یک خط', 'خلاصه وار', 'سر سری', 'سریع بگو', 'short', 'brief', 'one line', 'tldr', 'tl;dr'];
const LONG_FORMAT = ['مفصل', 'کامل توضیح', 'با جزئیات', 'جزئیات کامل', 'طولانی', 'همه چیز را بگو', 'detailed', 'in depth', 'full explanation'];
const TABLE_FORMAT = ['جدول', 'table'];
const LIST_FORMAT = ['لیست', 'فهرست', 'بولت', 'bullet', 'list'];

const BEGINNER = [
  'تازه واردم', 'تازه وارد', 'تازه کارم', 'تازه کار', 'نو کار', 'تازه شروع', 'مبتدی', 'نوپا', 'بلد نیستم', 'نمیفهمم', 'نمی دانم یعنی',
  'به زبان ساده', 'ساده توضیح', 'مثل بچه', 'مثل تازه کار', 'برای اولین بار',
  'beginner', 'newbie', 'noob', 'i am new', "i'm new", 'explain like', 'simple terms', 'eli5'
];

const EXPERT_TERMS = [
  'فاندینگ', 'بیس', 'بازار مشتقه', 'اهرم', 'لیکوییدیشن', 'لیکویید', 'اپن اینترست', 'او آی',
  'دلتا نچرال', 'دلوانچرال', 'ایمپرمننت لاس', 'ضرر ناپایدار', 'مهو', 'mev', 'lvr', 'apr', 'apy',
  'بک تست', 'بکتست', 'اسلیپیج', 'اسلیپیج', 'عمق بازار', 'پوزیشن سایزینگ', 'ریسک به ریوارد',
  'funding', 'basis', 'perp', 'open interest', 'liquidation', 'delta neutral', 'impermanent loss', 'slippage', 'backtest'
];

const ASSET_RE = /\b(btc|eth|sol|bnb|xrp|ada|doge|ton|avax|link|arb|op|matic)\b|بیت[\s]*کوین|اتریوم|سولانا|ریپل|دوج/iu;

const NUM_WORD = {
  'یک': 1, '۱': 1, '1': 1, 'دو': 2, '۲': 2, '2': 2, 'سه': 3, '۳': 3, '3': 3,
  'چهار': 4, '۴': 4, '4': 4, 'پنج': 5, '۵': 5, '5': 5, 'شش': 6, '۶': 6, '6': 6,
  'شیش': 6, 'هفت': 7, '۷': 7, '7': 7, 'هشت': 8, '۸': 8, '8': 8, 'نه': 9, '۹': 9, '9': 9,
  'ده': 10, '۱۰': 10, '10': 10, 'دوازده': 12, '۱۲': 12, '12': 12
};
const NUM_ALT = Object.keys(NUM_WORD).join('|');
const Z = '[\\s\\u200c]*';
/* A month is 30 days and a year 365 — a coarse bucket, not a calendar. */
const HORIZON_PATTERNS = [
  { re: new RegExp(`(?:تا|در)${Z}(\\d+)${Z}(?:روز|day)`, 'i'), days: (m) => Number(m[1]) },
  { re: new RegExp(`(?:تا|در)${Z}(?:یک|۱|1)${Z}(?:هفته|week)|هفته${Z}(?:آینده|بعد|دیگر|other)|یک${Z}هفته`, 'i'), days: () => 7 },
  { re: new RegExp(`(?:تا|در)${Z}(${NUM_ALT})${Z}ماه|ماه${Z}(?:آینده|بعد|دیگر)`, 'i'), days: (m) => (NUM_WORD[m[1]] || 1) * 30 },
  { re: new RegExp(`(?:تا|در)${Z}(${NUM_ALT})${Z}(?:سال|ساله)|سال${Z}(?:آینده|بعد|دیگر)`, 'i'), days: (m) => (NUM_WORD[m[1]] || 1) * 365 },
  { re: /بلند[\s\u200c]*مدت|long[\s-]*term/i, days: () => 365 },
  { re: /کوتاه[\s\u200c]*مدت|short[\s-]*term/i, days: () => 30 },
  { re: /\bnext[\s]+(week|month|year)\b/i, days: (m) => (m[1].toLowerCase() === 'week' ? 7 : m[1].toLowerCase() === 'month' ? 30 : 365) }
];

const CURRENCY = 'دلار|تتر|تومان|یورو|درهم|usdt|usd|eur|\\$';

/* ── constraints ──────────────────────────────────────────────────────────── */

/** An explicit budget/position the user named («۲۰۰۰۰ دلار», «$5k», «۵ میلیون تومان»). */
export function readAmount(text = '') {
  const t = normalizeText(text);
  const m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(هزار|میلیون|میلیارد|k|m|bn)?\\s*(${CURRENCY})`, 'i'))
    || t.match(new RegExp(`(${CURRENCY})\\s*(\\d+(?:\\.\\d+)?)\\s*(هزار|میلیون|میلیارد|k|m|bn)?`, 'i'));
  if (!m) return null;
  let value;
  let unit;
  if (/^\d/.test(m[1])) {
    value = Number(m[1]);
    unit = (m[3] || '').toLowerCase();
    const scale = m[2] ? String(m[2]).toLowerCase() : '';
    if (scale === 'هزار' || scale === 'k') value *= 1e3;
    if (scale === 'میلیون' || scale === 'm') value *= 1e6;
    if (scale === 'میلیارد' || scale === 'bn') value *= 1e9;
  } else {
    unit = String(m[1]).toLowerCase();
    value = Number(m[2]);
    const scale = (m[3] || '').toLowerCase();
    if (scale === 'هزار' || scale === 'k') value *= 1e3;
    if (scale === 'میلیون' || scale === 'm') value *= 1e6;
    if (scale === 'میلیارد' || scale === 'bn') value *= 1e9;
  }
  return Number.isFinite(value) && value > 0 ? { value, unit } : null;
}

function readHorizonDays(text = '') {
  const t = normalizeText(text);
  let days = null;
  for (const { re, days: resolve } of HORIZON_PATTERNS) {
    const m = t.match(re);
    if (m) days = Math.max(days || 0, Number(resolve(m)) || 0);
  }
  return days || null;
}

function readRiskLimit(text = '') {
  const t = normalizeText(text);
  /* «حداکثر ۱۰٪ ریسک», «فقط ۵ درصد ضرر», «ریسک ۲ درصد». */
  const m = t.match(/(?:حداکثر|نهایت|فقط|ریسک|ضرر)\s*(?:حدود\s*)?(\d+(?:\.\d+)?)\s*٪|(?:حداکثر|نهایت|فقط|ریسک)\s*(\d+(?:\.\d+)?)\s*(?:درصد|percent|%)/i);
  const pct = m ? Number(m[1] || m[2]) : null;
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : null;
}

/** Numbers that already exist in the turn — anything else is invented. */
function allowedNumbers({ message = '', context = {} } = {}) {
  const set = new Set();
  const collect = (s) => {
    for (const hit of normalizeText(s).matchAll(/-?\d+(?:\.\d+)?/g)) set.add(String(Math.abs(Number(hit[0]))));
  };
  collect(message);
  if (context && typeof context === 'object') {
    try {
      collect(JSON.stringify(context));
    } catch { /* a context that cannot serialise carries no readable figure */ }
  }
  return set;
}

/* ── deliverable ──────────────────────────────────────────────────────────── */

function detectDeliverable(text, social, dialogue) {
  if (anyWord(text, VERDICT_ASK)) return 'verdict';
  if (anyWord(text, COMPARE_ASK) && (ASSET_RE.test(text) || /\bvs\b/i.test(text))) return 'comparison';
  if (anyWord(text, PLAN_ASK)) return 'plan';
  if (anyWord(text, SCENARIO_ASK) && (ASSET_RE.test(text) || dialogue?.shape === 'PREDICTION')) return 'scenario';
  if (anyWord(text, NUMBER_ASK) && !anyWord(text, EXPLAIN_ASK)) return 'number';
  if (anyWord(text, STEPS_ASK)) return 'steps';
  if (anyWord(text, EXPLAIN_ASK)) return 'explanation';
  if (anyWord(text, ANALYSIS_ASK)) return 'analysis';
  if (social?.need === 'reassurance' || social?.need === 'risk_containment') return 'reassurance';
  return 'fact';
}

const CRITICAL_SLOTS = {
  verdict: ['asset', 'capital', 'horizon'],
  number: ['asset'],
  comparison: ['assets_two'],
  plan: ['capital', 'horizon', 'risk'],
  scenario: ['asset', 'horizon'],
  explanation: [],
  analysis: ['asset'],
  steps: [],
  reassurance: [],
  fact: []
};

const SLOT_TEXT = {
  asset: { fa: 'کدام دارایی', en: 'which asset' },
  assets_two: { fa: 'کدام دو دارایی', en: 'which two assets' },
  capital: { fa: 'چه سرمایه‌ای در کار است', en: 'how much capital is involved' },
  horizon: { fa: 'افق زمانی', en: 'the time horizon' },
  risk: { fa: 'حد تحمل ریسک', en: 'the risk limit' }
};

function readSlots({ text, context = {} }) {
  const assets = new Set((normalizeText(text).match(new RegExp(ASSET_RE.source, 'giu')) || []).map((a) => a.toLowerCase()));
  const hasCapital = Boolean(readAmount(text))
    || Number(context?.portfolio?.totalValueUsd) > 0
    || Number(context?.portfolio?.cashUsd) > 0
    || Number(context?.capital?.amountUsd) > 0;
  return {
    asset: assets.size > 0,
    assets_two: assets.size >= 2,
    capital: hasCapital,
    horizon: Boolean(readHorizonDays(text)),
    risk: Boolean(readRiskLimit(text)) || text.includes('ریسک') || /\brisk\b/i.test(text)
  };
}

function readExpertise(text, social) {
  const beginner = anyWord(text, BEGINNER);
  if (beginner) return 'beginner';
  const hits = EXPERT_TERMS.filter((term) => word(text, term)).length;
  if (hits >= 2) return 'expert';
  return 'mixed';
}

/* ── the plan ─────────────────────────────────────────────────────────────── */

const BLUEPRINTS = {
  verdict: {
    first: 'the verdict first, in one sentence, then the two or three reasons that carry it',
    sections: ['verdict (hold / buy / wait / sell — pick one and say it plainly)', 'the 2–3 reasons that carry it, each tied to a number or a condition', 'what would change the verdict (the level or the condition)', 'the single number to watch'],
    max: 8
  },
  number: {
    first: 'the number itself, with its timestamp and where it came from',
    sections: ['the number (value + as-of)', 'what moved it in the last 24h', 'what makes it stale in the next hours'],
    max: 5
  },
  comparison: {
    first: 'which one wins for this user, in one sentence',
    sections: ['the winner and the margin', 'the axis that decided it (not a list of everything)', 'when the ranking flips'],
    max: 7
  },
  plan: {
    first: 'the shape of the plan in one sentence (allocation and the risk rule), before any detail',
    sections: ['goal + horizon restated in one line', 'allocation with explicit numbers', 'risk rule and invalidation', 'cost/execution note'],
    max: 12
  },
  explanation: {
    first: 'the answer to «why / what does it mean» in one sentence, in plain words',
    sections: ['the one-sentence answer', 'the mechanism or channel', 'a concrete number or example', 'what this explanation does NOT cover'],
    max: 10
  },
  steps: {
    first: 'the first step, not a preamble about steps',
    sections: ['ordered steps (max 5), each with a check the user can make', 'the failure point to watch', 'what to do if a step fails'],
    max: 10
  },
  scenario: {
    first: 'today\'s read in one sentence, then the scenario clearly labelled as a scenario',
    sections: ['base case with the current data', 'conditional scenario with its assumption stated', 'invalidation', 'the one thing to watch'],
    max: 9
  },
  reassurance: {
    first: 'one short clause that acknowledges the situation — then the substance, no lecture',
    sections: ['acknowledge in one clause', 'state the risk once, plainly', 'the one thing in their control', 'one next step'],
    max: 6
  },
  analysis: {
    first: 'the current read in one sentence, with the number it stands on',
    sections: ['the read today, in the frame\'s own numbers', 'the two things that would change it', 'what this data cannot show', 'what to watch next'],
    max: 9
  },
  fact: {
    first: 'the fact, then its source',
    sections: ['the fact', 'where it comes from', 'the caveat if there is one'],
    max: 6
  }
};

const AVOID = {
  verdict: ['do not open with «سؤال خوبی پرسیدی» / «بستگی به شرایط دارد» as the whole first sentence', 'do not end with a disclaimer instead of a verdict'],
  number: ['do not answer a number question with a range and no point estimate'],
  comparison: ['do not compare on five axes; pick the one that decides it'],
  plan: ['do not invent a budget or a horizon the user never gave'],
  explanation: ['do not define terms the user did not ask about', 'no textbook history'],
  steps: ['no theory before the first step'],
  scenario: ['do not present a scenario as a forecast', 'no unconditional target'],
  reassurance: ['no pep talk, no moralising about risk, no promises'],
  analysis: ['do not narrate the chart you cannot see', 'no target without a horizon the data supports'],
  fact: ['no padding, no «as an AI»']
};

/**
 * Build the plan for this turn.
 *
 * `dialogue` (the question-shape read) refines the deliverable; `social` (the
 * person read) sets the stance. Neither is required — the plan stands alone.
 */
export function analyzeRequest({ message = '', locale = 'fa', context = {}, history = '', social = null, dialogue = null } = {}) {
  const raw = String(message || '');
  const text = normalizeText(raw);
  const empty = !text;

  const deliverable = empty ? 'fact' : detectDeliverable(text, social, dialogue);
  const blueprint = BLUEPRINTS[deliverable] || BLUEPRINTS.fact;

  const amount = readAmount(text);
  const horizonDays = readHorizonDays(text);
  const riskLimitPct = readRiskLimit(text);

  const format = anyWord(text, SHORT_FORMAT) ? 'short'
    : anyWord(text, LONG_FORMAT) ? 'detailed'
      : anyWord(text, TABLE_FORMAT) ? 'table'
        : anyWord(text, LIST_FORMAT) ? 'list' : 'prose';

  /* Length is a promise: a one-line question does not owe twelve sentences. */
  const words = text.split(/\s+/).filter(Boolean).length;
  const urgency = social?.urgent === true || anyWord(text, ['فوری', 'سریع', 'زود', 'urgent', 'asap']);
  let length = format === 'short' || urgency ? 'short'
    : format === 'detailed' ? 'detailed'
      : words <= 12 ? 'short'
        : 'medium';
  /* A plan or a comparison is not a one-liner because the question was short. */
  const substantial = ['plan', 'comparison', 'scenario', 'explanation', 'analysis'];
  if (length === 'short' && substantial.includes(deliverable) && format !== 'short' && !urgency) length = 'medium';
  const maxSentences = length === 'short' ? 4 : length === 'detailed' ? blueprint.max : Math.min(blueprint.max, 8);

  const slots = readSlots({ text, context });
  const missing = empty ? [] : (CRITICAL_SLOTS[deliverable] || []).filter((slot) => !slots[slot]);

  const expertise = empty ? 'mixed' : readExpertise(text, social);

  const warmth = social?.distress ? 'careful'
    : social?.tone === 'anxious' || social?.tone === 'frustrated' ? 'warm_brief'
      : social?.tone === 'hostile' ? 'neutral_firm'
        : social?.tone === 'playful' ? 'light'
          : 'neutral';

  return {
    schema: REQUEST_PLAN_SCHEMA,
    version: REQUEST_PLAN_VERSION,
    locale,
    deliverable,
    constraints: {
      amountUsd: amount ? amount.value : null,
      amountUnit: amount ? amount.unit : null,
      horizonDays,
      riskLimitPct,
      format,
      length,
      urgency
    },
    missing,
    missingText: missing.map((slot) => (String(locale).startsWith('fa') ? SLOT_TEXT[slot].fa : SLOT_TEXT[slot].en)),
    expertise,
    stance: {
      warmth,
      directness: urgency || deliverable === 'verdict' ? 'answer_first' : 'answer_first',
      mirror: length,
      /* At most one ask-back: a form is not an answer. */
      askBackAtMost: missing.length ? 1 : 0
    },
    blueprint: {
      firstSentence: blueprint.first,
      sections: blueprint.sections,
      maxSentences,
      avoid: [...(AVOID[deliverable] || []), ...(expertise === 'beginner' ? ['no jargon without a plain-language gloss'] : [])]
    },
    hasHistory: Boolean(String(history || '').trim()),
    /* Facts the turn may use: the message's own numbers plus context. */
    allowedNumbers: [...allowedNumbers({ message: raw, context })]
  };
}

/* ── rendering ────────────────────────────────────────────────────────────── */

const DELIVERABLE_FA = {
  verdict: 'حکم (بخر / نگه دار / صبر کن / بفروش)',
  number: 'عدد',
  comparison: 'مقایسه با برندهٔ مشخص',
  plan: 'برنامه با وزن‌ها',
  explanation: 'توضیح سازوکار',
  steps: 'گام‌های عملی',
  scenario: 'سناریو',
  reassurance: 'آرام‌سازی + یک قدم',
  analysis: 'تحلیل با عدد امروز',
  fact: 'واقعیت + منبع'
};

/** The plan as a prompt block, in the same English the other briefs use. '' when there is no plan. */
export function renderRequestPlan(plan) {
  if (!plan || plan.schema !== REQUEST_PLAN_SCHEMA) return '';
  const lines = ['REQUEST READ (what was asked, and the shape the answer owes):'];

  lines.push(`- deliverable: ${plan.deliverable}. The FIRST sentence must deliver it: ${plan.blueprint.firstSentence}.`);
  lines.push(`- order: ${plan.blueprint.sections.join(' → ')}`);
  lines.push(`- length: at most about ${plan.blueprint.maxSentences} sentences (the turn reads as "${plan.constraints.length}").`);

  if (plan.missing.length) {
    lines.push(`- not given by the user, and the answer must not invent it: ${plan.missing.join(', ')}. State your assumption in one clause, or ask at most ONE question; never manufacture the figure or the horizon.`);
  }

  const given = [];
  if (plan.constraints.amountUsd) given.push(`${plan.constraints.amountUsd} ${plan.constraints.amountUnit}`);
  if (plan.constraints.horizonDays) given.push(`${plan.constraints.horizonDays} days`);
  if (plan.constraints.riskLimitPct) given.push(`risk ≤ ${plan.constraints.riskLimitPct}%`);
  if (given.length) lines.push(`- given by the user, must stay exactly that: ${given.join(', ')}`);

  if (plan.expertise === 'beginner') {
    lines.push('- level: the user is new. Gloss each specialist term in place, in plain words; do not skip the definition and do not assume the vocabulary.');
  } else if (plan.expertise === 'expert') {
    lines.push('- level: the user uses specialist vocabulary. Skip the basics; go to the mechanism and the number.');
  }

  if (plan.stance.warmth === 'careful') {
    lines.push('- tone: careful and short; acknowledge the situation once and give no trading advice.');
  } else if (plan.stance.warmth === 'warm_brief') {
    lines.push('- tone: one short empathetic clause, then straight to the substance; do not amplify the worry.');
  } else if (plan.stance.warmth === 'neutral_firm') {
    lines.push('- tone: neutral and firm; do not mirror hostility, do not defend yourself.');
  }

  if (plan.blueprint.avoid.length) lines.push(`- avoid: ${plan.blueprint.avoid.join('; ')}`);

  return lines.join('\n');
}

/* ── compliance ───────────────────────────────────────────────────────────── */

const PREAMBLE_RE = /^(?:سؤال|سوال)\s*(?:خوب|عالی|باحالی|جالبی)|^(?:چه|چقدر)\s*(?:سؤال|سوال)\s*خوب|^بستگی\s*به\s*شرایط|^بستگی\s*دارد|^(?:good|great|interesting)\s+question|^it\s+depends|^that'?s\s+a\s+(?:good|great)\s+question/i;
const VERDICT_WORD = /(?<![\p{L}])(?:بخر|نخر|بفروش|نفروش|نگه\s*دار|صبر\s*کن|وارد\s*نشو|خارج\s*شو|نگه|بخرم|بفروشم|توصیه\s*می\s*کنم|پیشنهاد\s*می\s*کنم)(?![\p{L}])|(?<![\p{L}])(?:hold|buy|sell|wait|avoid|don'?t\s+buy|i\s+would)(?![\p{L}])/iu;
const COMPARE_WORD = /بهتر|قوی\s*تر|ضعیف\s*تر|ترجیح|برنده|پیشتاز|بهتره|better|stronger|wins|prefer|outperform/iu;
const ASSUMPTION_RE = /فرض\s*می\s*کنم|فرض\s*کن|با\s*فرض|بر\s*اساس|اگر|تا\s*وقتی|مادامی|در\s*صورت|سناریو|assum|assuming|unless|\bif\b|based\s+on/iu;
const QUESTION_MARK = /[?؟]/;

const EXPERT_TERM_RE = new RegExp(
  `(?<![\\p{L}])(?:${['funding', 'basis', 'perp', 'liquidation', 'open\\s+interest', 'delta\\s+neutral', 'impermanent\\s+loss', 'slippage', 'backtest', 'mev', 'apr', 'apy', 'فاندینگ', 'لیکوییدیشن', 'اسلیپیج', 'بک\\s*تست', 'اهرم', 'عمق\\s*بازار'].join('|')})(?![\\p{L}])`,
  'iu'
);
const GLOSS_RE = /[(（][^)）]{3,80}[)）]|یعنی|یعنے|—\s*\p{L}/u;

/** An allocation-shaped figure: «با ۱۰٬۰۰۰ دلار», «سرمایه ۵۰۰۰ دلار», «budget of $2k». */
const ALLOCATION_AMOUNT_RE = new RegExp(
  `(?:با|سرمایه\\s*(?:ای|ی|ام|ت)?|بودجه\\s*(?:ای|ی|ام|ت)?|موجودی|پول(?:ی|ت|م)?|حدود|به\\s*مبلغ)\\s*[^0-9]{0,14}(\\d[\\d.]*)\\s*(${CURRENCY})`,
  'iu'
);

function firstSentence(answer = '') {
  const parts = String(answer || '').trim().split(/(?<=[.!?؟])\s+/);
  return String(parts[0] || '').trim();
}

/**
 * Did the answer keep the plan's promise?
 *
 * Five narrow checks. Each one fires only on its own trigger, because a checker
 * that nags on every deep answer gets turned off and then protects nothing.
 */
export function checkRequestPlan({ plan = null, answer = '' } = {}) {
  const text = String(answer || '');
  const issues = [];
  if (!plan || plan.schema !== REQUEST_PLAN_SCHEMA || !text.trim() || plan.deliverable === 'fact') {
    return { schema: REQUEST_PLAN_SCHEMA, applicable: false, issues, compliant: true };
  }

  const first = firstSentence(text);

  /* 1. The answer hides the answer: a verdict/number/comparison question whose
        first sentence is a preamble, a hedge, or a question of its own (the
        last one is a legal ask-back when a critical slot is missing). */
  if (['verdict', 'number', 'comparison'].includes(plan.deliverable)) {
    const asksBack = QUESTION_MARK.test(first) && plan.missing.length > 0;
    const preamble = PREAMBLE_RE.test(first);
    const hasVerdict = VERDICT_WORD.test(first);
    const hasNumber = /\d/.test(normalizeText(first));
    const hasCompare = COMPARE_WORD.test(first);
    const delivers = plan.deliverable === 'verdict' ? hasVerdict || hasCompare
      : plan.deliverable === 'number' ? hasNumber
        : hasCompare || hasVerdict;
    if (!delivers && !asksBack) {
      issues.push({
        id: 'FIRST_SENTENCE_HIDES_ANSWER',
        severity: 'HIGH',
        detail: preamble
          ? 'the first sentence is a preamble/hedge. Replace it with the verdict/number the user asked for; the reasoning comes after it.'
          : `the first sentence does not deliver the ${plan.deliverable} this question asked for. Open with it.`
      });
    }
  }

  /* 2. A budget the turn never had. Price mentions are untouched: this only
        fires on allocation-shaped figures («با ۱۰٬۰۰۰ دلار»). */
  if (plan.missing.includes('capital') || plan.missing.includes('risk')) {
    const allowed = new Set(plan.allowedNumbers || []);
    const invented = [];
    for (const hit of normalizeText(text).matchAll(new RegExp(ALLOCATION_AMOUNT_RE.source, 'giu'))) {
      const value = String(Number(hit[1]));
      if (!allowed.has(value)) invented.push(hit[1]);
    }
    if (invented.length) {
      issues.push({
        id: 'INVENTED_CONSTRAINT',
        severity: 'HIGH',
        detail: `the answer allocates ${invented.join(', ')} that the user never mentioned. Name the assumption as an assumption, or ask.`
      });
    }
  }

  /* 3. A critical slot missing, and the answer neither asks nor states an
        assumption — it just answers as if it knew. */
  if (plan.missing.length && plan.deliverable !== 'number') {
    const handlesMissing = QUESTION_MARK.test(text) || ASSUMPTION_RE.test(text);
    if (!handlesMissing) {
      issues.push({
        id: 'MISSING_SLOT_IGNORED',
        severity: 'MEDIUM',
        detail: `the answer needs ${plan.missing.join(', ')} and the user did not give it: state the assumption in one clause, or ask ONE question.`
      });
    }
  }

  /* 4. «کوتاه بگو» is a promise about length. */
  const sentences = sentencesOf(text).length;
  if (plan.constraints.length === 'short' && sentences > plan.blueprint.maxSentences * 2) {
    issues.push({
      id: 'LENGTH_OVERSHOOT',
      severity: 'MEDIUM',
      detail: `the user asked for a short answer (${plan.blueprint.maxSentences} sentences) and got ${sentences}. Cut to the deliverable and one line of support.`
    });
  }

  /* 5. Jargon aimed at someone who said they are new. */
  if (plan.expertise === 'beginner') {
    const terms = new Set((normalizeText(text).match(new RegExp(EXPERT_TERM_RE.source, 'giu')) || []).map((t) => t.toLowerCase()));
    if (terms.size >= 2 && !GLOSS_RE.test(text)) {
      issues.push({
        id: 'JARGON_WITHOUT_GLOSS',
        severity: 'LOW',
        detail: `the user said they are new and the answer uses ${[...terms].join(', ')} with no plain-language gloss. Gloss each term in place.`
      });
    }
  }

  return {
    schema: REQUEST_PLAN_SCHEMA,
    applicable: true,
    deliverable: plan.deliverable,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft keeps the plan). */
export function renderRequestDeficit(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `REQUEST PLAN VIOLATIONS (the answer does not match the request it was given; fix each one):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

export default analyzeRequest;
