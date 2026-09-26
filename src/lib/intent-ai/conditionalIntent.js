/**
 * FBT INTENT AI — CROSS-ASSET CONDITIONAL INTENT (Phase 217).
 * ---------------------------------------------------------------------------
 * «اگر طلا ۵٪ اصلاح کرد و BTC هم بالای ۶۵۰۰۰ بود، ۱۰٪ سرمایه را به طلا
 * اختصاص بده.»
 *
 * Read that sentence and six things have to be understood at once:
 *
 *   GOLD        an instrument the AI's asset vocabulary did not contain
 *   BTC         an instrument from a DIFFERENT class
 *   PORTFOLIO   «سرمایه» is the owner's capital, not a number they typed
 *   RISK        a 5% drawdown is a risk statement, not a price
 *   CONDITION   two of them, joined by AND, spanning two asset classes
 *   ALLOCATION  10% of the portfolio into gold — an action, not a question
 *
 * Before this module the parser saw: an INSTRUMENT_QUERY (a page) and nothing
 * else, because the asset lexicon was crypto-only and no intent type could
 * hold a condition. The page existed; the language to drive it did not.
 *
 * WHAT THIS FILE PRODUCES — one `ConditionalIntent` frame:
 *
 *   { logic: 'AND',
 *     conditions: [ { asset: 'GOLD', assetClass: 'commodities',
 *                     metric: 'PERCENT_CHANGE', operator: 'BELOW',
 *                     threshold: -5, basis: 'DRAWDOWN_FROM_NOW' },
 *                   { asset: 'BTC', assetClass: 'crypto',
 *                     metric: 'PRICE', operator: 'ABOVE',
 *                     threshold: 65000, basis: 'ABSOLUTE' } ],
 *     action: { kind: 'ALLOCATE', target: { symbol: 'GOLD', assetClass: 'commodities' },
 *               sizePct: 10, sizeUsd: null, source: 'PORTFOLIO' },
 *     portfolio: true, risk: { mentioned: true, maxDrawdownPct: 5 } }
 *
 * WHAT IT NEVER DOES
 *   · never invents an instrument — an unmatched token stays unmatched and
 *     lands in `missing` so the caller can ASK instead of guessing;
 *   · never invents a threshold — «اگر طلا اصلاح کرد» parses to a condition
 *     with `threshold: null` and `missing: ['THRESHOLD']`;
 *   · never signs, quotes, or executes. This is the understanding layer. The
 *     allocation maths and the execution gate live in
 *     server/fios/conditionalAllocation.js.
 */

import {
  findInstruments,
  instrumentFor,
  normalizeForMatch,
  resolveInstrumentToken
} from './crossAssetInstruments.js';

export const CONDITIONAL_INTENT_SCHEMA = 'fbt.conditional-intent.v1';

/* ══════════════════ the vocabulary ═══════════════════════════════════════ */

/** «اگر / اگه / وقتی / در صورت» — the sentence is conditional. */
const CONDITION_MARKERS = Object.freeze([
  'اگر', 'اگه', 'اگهی', 'چنانچه', 'هرگاه', 'هر وقت', 'هر زمان', 'وقتی که', 'وقتی', 'زمانی که',
  'در صورت', 'در صورتی که', 'به شرطی که', 'به شرط اینکه',
  'if', 'when', 'once', 'whenever', 'in case', 'provided that', 'provided'
]);

/** «و / و همچنین» → every condition must hold. «یا» → any one is enough. */
const OR_CONNECTIVES = Object.freeze(['یا', 'or', 'either', '||']);

/** A price/percent going DOWN. */
const DOWN_WORDS = Object.freeze([
  'اصلاح', 'اصلاحی', 'ریزش', 'ریخت', 'بریزد', 'بریزه', 'افت', 'افتاد', 'بیفتد', 'بیفته',
  'سقوط', 'کاهش', 'پایین', 'پایینتر', 'پایین‌تر', 'تنزل', 'نزول', 'نزولی', 'ضرر',
  'drop', 'drops', 'dropped', 'fall', 'falls', 'fell', 'decline', 'declines', 'declined',
  'dip', 'dips', 'dipped', 'correct', 'corrects', 'corrected', 'pullback', 'pull back',
  'down', 'lower', 'crash', 'crashes', 'slump', 'slumps', 'sink', 'sinks', 'tank', 'tanks'
]);

/** A price/percent going UP. */
const UP_WORDS = Object.freeze([
  'رشد', 'صعود', 'صعودی', 'افزایش', 'بالا', 'بالاتر', 'جهش', 'تقویت', 'مثبت',
  'rise', 'rises', 'rose', 'gain', 'gains', 'gained', 'climb', 'climbs', 'rally', 'rallies',
  'jump', 'jumps', 'surge', 'surges', 'up', 'higher', 'pump', 'pumps', 'moon', 'mooning'
]);

/** Comparator → operator. Order matters: the longest phrase must win. */
const ABOVE_WORDS = Object.freeze([
  'بالاتر از', 'بالای', 'بالا تر از', 'بیشتر از', 'بیش از', 'بیشتر', 'بالاتر',
  'above', 'over', 'higher than', 'greater than', 'more than', 'at least', '>=', '≥'
]);
const BELOW_WORDS = Object.freeze([
  'پایینتر از', 'پایین‌تر از', 'پایین تر از', 'زیر', 'کمتر از', 'کمتر', 'کم‌تر از', 'پایینتر', 'پایین‌تر',
  'below', 'under', 'lower than', 'less than', 'at most', '<=', '≤'
]);
/** «برسه به / reaches / hits» — a crossing, evaluated as the same side. */
const CROSS_WORDS = Object.freeze([
  'برسد به', 'برسه به', 'برسد', 'برسه', 'رسید به', 'رسید', 'بزند به', 'بزنه به', 'لمس کند', 'لمس کنه',
  'reaches', 'reach', 'reached', 'hits', 'hit', 'touches', 'touch', 'gets to', 'crosses', 'cross'
]);

/** The allocation / trade verb. `kind` is what the action becomes. */
const ACTION_VERBS = Object.freeze([
  { kind: 'ALLOCATE', words: ['اختصاص بده', 'اختصاص بدهید', 'اختصاص بدم', 'اختصاص', 'تخصیص بده', 'تخصیص', 'allocate', 'assign', 'allot', 'apportion'] },
  { kind: 'ALLOCATE', words: ['منتقل کن', 'منتقل کنید', 'انتقال بده', 'انتقال', 'move', 'shift', 'transfer'] },
  { kind: 'ALLOCATE', words: ['بگذار', 'بذار', 'بگذارید', 'بذارید', 'قرار بده', 'put', 'place'] },
  { kind: 'ALLOCATE', words: ['سرمایه گذاری کن', 'سرمایه‌گذاری کن', 'سرمایه گذاری', 'invest', 'allocate to'] },
  { kind: 'BUY', words: ['بخر', 'بخرم', 'بخرید', 'خرید کن', 'خرید بزن', 'buy', 'purchase', 'get'] },
  { kind: 'SELL', words: ['بفروش', 'بفروشم', 'بفروشید', 'فروش بزن', 'خارج کن', 'خروج', 'sell', 'exit', 'dump'] },
  { kind: 'REBALANCE', words: ['ریبالانس کن', 'متعادل کن', 'rebalance', 're-allocate'] }
]);
const ALLOCATE_ONLY = new Set(['ALLOCATE']);

/** «سرمایه / پرتفوی / سبد» — the size is a share of the owner's capital. */
const PORTFOLIO_WORDS = Object.freeze([
  'سرمایه', 'دارایی', 'پرتفوی', 'پورتفوی', 'سبد', 'کل دارایی', 'ارزش خالص', 'پورتفولیو',
  'capital', 'portfolio', 'net worth', 'networth', 'my money', 'my funds', 'holdings', 'wealth', 'assets'
]);
const RISK_WORDS = Object.freeze([
  'ریسک', 'ضرر', 'حد ضرر', 'استاپ لاس', 'حداکثر ضرر', 'افت مجاز', 'تحمل',
  'risk', 'drawdown', 'stop loss', 'stoploss', 'max loss', 'maxloss', 'loss limit', 'tolerance'
]);

/** Spoken fractions — «نصف سرمایه» is 50%, not a parsing failure. */
const FRACTIONS = Object.freeze({
  'نصف': 50, 'نیم': 50, 'نیمی': 50, 'half': 50, 'halves': 50,
  'یک سوم': 33.33, 'یکسوم': 33.33, 'third': 33.33, 'a third': 33.33,
  'یک چهارم': 25, 'یکچهارم': 25, 'ربع': 25, 'quarter': 25, 'a quarter': 25,
  'یک پنجم': 20, 'fifth': 20,
  'همه': 100, 'همش': 100, 'کل': 100, 'تمام': 100, 'all': 100, 'everything': 100,
  'دو سوم': 66.67, 'two thirds': 66.67,
  'سه چهارم': 75, 'three quarters': 75
});

/** Thousand / million multipliers, fa + en. */
const SCALE_WORDS = Object.freeze({
  'هزار': 1e3, 'k': 1e3, 'هزار دلار': 1e3,
  'میلیون': 1e6, 'm': 1e6, 'million': 1e6, 'mil': 1e6,
  'میلیارد': 1e9, 'b': 1e9, 'billion': 1e9
});

/* ══════════════════ small helpers ═══════════════════════════════════════ */

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 4) => (v == null ? null : Number(Number(v).toFixed(d)));

/** True when `word` occurs as a whole token in `hay` (RTL stems get a prefix
 *  pass, because Persian verbs arrive conjugated: «می‌ریزد»). */
function hasWord(hay, word) {
  const w = String(word || '').trim();
  if (!w) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$|[%.,!؟?؛;])`, 'u').test(hay);
}
function firstWordFrom(hay, words) {
  const ordered = [...words].sort((a, b) => b.length - a.length);
  for (const w of ordered) if (hasWord(hay, w)) return w;
  return null;
}
function wordIndex(hay, word) {
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\s)${escaped}(\\s|$|[%.,!؟?؛;])`, 'u').exec(hay);
  return m ? m.index + (m[1] ? m[1].length : 0) : -1;
}

/** «۵٪» / «5%» / «۵ درصد» / «five percent» → 5. */
function readPercent(clause) {
  const direct = /(\d+(?:\.\d+)?)\s*%/u.exec(clause);
  if (direct) return num(direct[1]);
  const worded = /(\d+(?:\.\d+)?)\s*(?:درصد|percent|pct|فیصد|في المئة)/u.exec(clause);
  if (worded) return num(worded[1]);
  return null;
}

/** «۶۵۰۰۰» / «65k» / «۱۰۰ هزار» → 65000 / 65000 / 100000. Never a guess. */
function readNumber(clause, { excludePercent = true } = {}) {
  let hay = clause;
  if (excludePercent) hay = hay.replace(/(\d+(?:\.\d+)?)\s*%/gu, ' ');
  const scaled = /(\d+(?:\.\d+)?)\s*([a-z\u0600-\u06FF]+)/u.exec(hay);
  if (scaled) {
    const n = num(scaled[1]);
    const scale = SCALE_WORDS[scaled[2]];
    if (n != null && scale) return n * scale;
  }
  const plain = /(\d+(?:\.\d+)?)/u.exec(hay);
  return plain ? num(plain[1]) : null;
}

/**
 * Where the SIZE of an action starts inside a clause.
 *
 * This exists because Persian and English both allow the verb to come LAST
 * («۱۰٪ سرمایه را به طلا اختصاص بده»). Slicing the condition out of such a
 * clause at the verb would leave «۱۰٪ سرمایه را به طلا» behind, and the
 * condition parser would then read 10% as the condition's own threshold. The
 * size is the true boundary, so the size is what we cut at.
 */
function sizeMatch(t) {
  const candidates = [];
  const pct = /(\d+(?:\.\d+)?)\s*%/u.exec(t);
  if (pct) candidates.push(pct.index);
  const usd = /(?:[$]\s*\d)|(?:\d+(?:\.\d+)?\s*(?:دلار|dollar|usd|تومان))/u.exec(t);
  if (usd) candidates.push(usd.index);
  const frac = Object.keys(FRACTIONS).sort((a, b) => b.length - a.length).find((f) => hasWord(t, f));
  if (frac) {
    const i = wordIndex(t, frac);
    if (i >= 0) candidates.push(i);
  }
  const at = candidates.filter((i) => i > 0).sort((a, b) => a - b)[0];
  return at == null ? null : at;
}

/** True when a stretch of text actually compares something — the test that
 *  separates a real condition from the action's own arguments. */
function hasComparison(text) {
  const t = normalizeForMatch(text);
  if (!t) return false;
  return Boolean(directionOf(t) || firstWordFrom(t, ABOVE_WORDS) || firstWordFrom(t, BELOW_WORDS) || firstWordFrom(t, CROSS_WORDS));
}

/** The direction a clause is talking about: 'DOWN' | 'UP' | null. */
function directionOf(clause) {
  const down = firstWordFrom(clause, DOWN_WORDS);
  const up = firstWordFrom(clause, UP_WORDS);
  if (down && up) return wordIndex(clause, down) <= wordIndex(clause, up) ? 'DOWN' : 'UP';
  if (down) return 'DOWN';
  if (up) return 'UP';
  return null;
}

/* ══════════════════ clause splitting ════════════════════════════════════ */

/**
 * The normaliser clause splitting needs. It is `normalizeForMatch` with ONE
 * difference that matters: the Persian/Arabic separators («،» «؛») become a
 * sentinel instead of a space.
 *
 * Why it matters: `normalizeForMatch` collapses every separator to a space,
 * which is right for matching words and fatal for splitting clauses —
 * «…بود، ۱۰٪ سرمایه را…» would arrive as one long clause, the action verb
 * would swallow the second condition, and «۱۰٪» would be read as ITS
 * threshold. A percent sign that belongs to the size must never become the
 * condition's number.
 */
function clauseNormalize(text) {
  let out = String(text ?? '');
  const maps = ['۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩'];
  for (const digits of maps) {
    for (let i = 0; i < 10; i += 1) out = out.split(digits[i]).join(String(i));
  }
  return out
    .toLowerCase()
    .replace(/[٪﹪％]/g, '%')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[\u200f\u200e]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[،؛؛,;]/gu, ' | ')
    .replace(/[^\p{L}\p{N}%$| ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a turn into clauses on the connectives a person actually uses.
 * «اگر طلا ۵٪ اصلاح کرد و BTC هم بالای ۶۵۰۰۰ بود، ۱۰٪ سرمایه را به طلا
 * اختصاص بده» → three clauses, and the «و» / «،» are what make the second
 * one a condition rather than noise.
 */
export function splitClauses(text) {
  const t = clauseNormalize(text);
  const parts = t
    .split(/(?:\s+و\s+|\s+and\s+|\s+or\s+|\s+یا\s+|\s+then\s+|\s+آنگاه\s+|\s*\|\s*)/gu)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [t].filter(Boolean);
}

/** True when the text opens with a conditional marker (fa or en). */
export function isConditionalText(text) {
  const t = normalizeForMatch(text);
  return CONDITION_MARKERS.some((m) => hasWord(t, m) || t.startsWith(`${m} `) || t.includes(` ${m} `));
}

/* ══════════════════ condition parsing ═══════════════════════════════════ */

/**
 * One clause → one condition. Returns null when the clause names no
 * instrument or no comparison — a clause that is not a condition is not a
 * condition, and inventing one is how a watch starts firing on nothing.
 */
export function parseCondition(clause, { id = 'c1' } = {}) {
  const t = normalizeForMatch(clause);
  if (!t) return null;
  const found = findInstruments(t, { limit: 3 });
  if (!found.length) return null;

  const pct = readPercent(t);
  const abs = readNumber(t);
  const direction = directionOf(t);
  const above = firstWordFrom(t, ABOVE_WORDS);
  const below = firstWordFrom(t, BELOW_WORDS);
  const cross = firstWordFrom(t, CROSS_WORDS);
  const comparator = above || below || null;

  let metric = null;
  let operator = null;
  let threshold = null;
  let basis = null;

  if (pct != null) {
    /* «۵٪ اصلاح کرد» is a DRAWDOWN: the threshold is -5 and the operator is
       BELOW, because «a 5% correction» means «down 5% or more». Flipping this
       to "price ≤ 5" would be the single worst misread in the file. */
    metric = 'PERCENT_CHANGE';
    if (direction === 'UP') {
      operator = 'ABOVE'; threshold = pct; basis = 'RALLY_FROM_NOW';
    } else if (direction === 'DOWN') {
      operator = 'BELOW'; threshold = -Math.abs(pct); basis = 'DRAWDOWN_FROM_NOW';
    } else if (below) {
      operator = 'BELOW'; threshold = -Math.abs(pct); basis = 'DRAWDOWN_FROM_NOW';
    } else if (above || cross) {
      operator = 'ABOVE'; threshold = Math.abs(pct); basis = 'RALLY_FROM_NOW';
    } else {
      /* A percent with no direction at all: keep the number, admit the gap. */
      metric = 'PERCENT_CHANGE'; operator = 'BELOW'; threshold = -Math.abs(pct); basis = 'UNSPECIFIED';
    }
  } else if (abs != null) {
    metric = 'PRICE';
    if (below) { operator = 'BELOW'; threshold = abs; basis = 'ABSOLUTE'; }
    else if (above) { operator = 'ABOVE'; threshold = abs; basis = 'ABSOLUTE'; }
    else if (cross) { operator = 'ABOVE'; threshold = abs; basis = 'CROSS'; }
    else if (direction === 'DOWN') { operator = 'BELOW'; threshold = abs; basis = 'ABSOLUTE'; }
    else if (direction === 'UP') { operator = 'ABOVE'; threshold = abs; basis = 'ABSOLUTE'; }
    else { metric = 'PRICE'; operator = null; threshold = null; basis = 'ABSOLUTE'; }
  } else if (direction) {
    /* «اگر طلا اصلاح کرد…» — the DIRECTION is clear and the NUMBER is not.
       That is not a parsing failure: it is a drawdown watch waiting for its
       threshold, and `missing: ['THRESHOLD']` is what turns it into a
       question. Guessing 5% because 5% is common would be a fabricated
       trigger on real money. */
    metric = 'PERCENT_CHANGE';
    operator = direction === 'DOWN' ? 'BELOW' : 'ABOVE';
    threshold = null;
    basis = direction === 'DOWN' ? 'DRAWDOWN_FROM_NOW' : 'RALLY_FROM_NOW';
  }

  /* Either way, no threshold means no condition — record it and let the
     caller ask. Guessing «5%» because 5% is a common number is a lie. */
  const inst = found[0];
  return {
    id,
    asset: inst.symbol,
    assetClass: inst.assetClass,
    display: inst.name?.en || inst.symbol,
    metric,
    operator,
    threshold,
    basis,
    comparatorWord: comparator || cross || null,
    directionWord: direction ? (direction === 'UP' ? firstWordFrom(t, UP_WORDS) : firstWordFrom(t, DOWN_WORDS)) : null,
    raw: String(clause).trim()
  };
}

/* ══════════════════ action parsing ══════════════════════════════════════ */

/**
 * One clause → the allocation/trade action. A clause with no verb and no
 * target is not an action; `null` is the honest answer.
 */
export function parseAction(clause) {
  const t = normalizeForMatch(clause);
  if (!t) return null;

  let verb = null;
  let kind = null;
  let verbIndex = -1;
  for (const group of ACTION_VERBS) {
    const w = firstWordFrom(t, group.words);
    if (!w) continue;
    const i = wordIndex(t, w);
    if (verbIndex === -1 || i < verbIndex) { verb = w; kind = group.kind; verbIndex = i; }
  }
  if (!verb) return null;

  /* SIZE — a percent of capital, an absolute amount, or a spoken fraction. */
  const pct = readPercent(t);
  let sizePct = pct;
  let sizeUsd = null;
  const usd = /(?:[$]\s*(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*(?:دلار|dollar|usd|تومان))/u.exec(t);
  if (usd) {
    sizeUsd = num(usd[1] ?? usd[2]);
    /* A dollar figure is only the size when no percent was named: «۱۰٪
       سرمایه» is a share, and «۵۰۰۰ دلار به طلا» is an amount. */
    if (sizePct != null && !/[$]\s*\d/.test(t)) sizeUsd = null;
  }
  if (sizePct == null) {
    const frac = Object.keys(FRACTIONS).sort((a, b) => b.length - a.length).find((f) => hasWord(t, f));
    if (frac) sizePct = FRACTIONS[frac];
  }

  /* SOURCE — «سرمایه/پرتفوی» means the owner's real capital figure, which the
     engine must READ, never assume. An absolute amount names itself. */
  const portfolioWord = firstWordFrom(t, PORTFOLIO_WORDS);
  const source = sizeUsd != null && !portfolioWord ? 'AMOUNT' : (portfolioWord ? 'PORTFOLIO' : (sizePct != null ? 'PORTFOLIO' : null));

  /* TARGET — the instrument after «به / to / into», because that is what
     distinguishes «۱۰٪ سرمایه را به طلا اختصاص بده» (target = gold) from a
     sentence that merely mentions gold somewhere else. */
  const found = findInstruments(t, { limit: 4 });
  let target = null;
  const prep = /(?:^|\s)(?:به|روی|در|برای|به سمت|to|into|in|towards?)\s+/u.exec(t);
  if (prep) {
    const at = prep.index + prep[0].length;
    const after = found.filter((f) => f.start >= at).sort((a, b) => a.start - b.start)[0];
    if (after) target = { symbol: after.symbol, assetClass: after.assetClass };
  }
  if (!target) {
    /* No preposition («طلا بخر»): the instrument AFTER the verb wins, and if
       the verb came last, the last named instrument does. */
    const afterVerb = found.filter((f) => f.start >= verbIndex).sort((a, b) => a.start - b.start)[0];
    const pick = afterVerb || found[found.length - 1] || null;
    if (pick) target = { symbol: pick.symbol, assetClass: pick.assetClass };
  }

  return {
    kind,
    verb,
    target,
    sizePct: sizePct == null ? null : round(sizePct, 4),
    sizeUsd: sizeUsd == null ? null : round(sizeUsd, 2),
    source,
    portfolioWord,
    raw: String(clause).trim()
  };
}

/* ══════════════════ the whole frame ═════════════════════════════════════ */

/**
 * Text → one `ConditionalIntent`.
 *
 * `ok` is true when the sentence is a conditional cross-asset request at all
 * (a marker and at least one readable condition OR a complete action).
 * `missing` is the list of things the caller must ASK for — the engine turns
 * each entry into a question instead of a default.
 */
export function parseConditionalIntent(text, { lang = null, now = Date.now() } = {}) {
  const original = String(text ?? '');
  const t = normalizeForMatch(original);
  const detectedLang = lang || (/[\u0600-\u06FF]/.test(original) ? 'fa' : 'en');

  const marker = CONDITION_MARKERS.filter((m) => hasWord(t, m)).sort((a, b) => b.length - a.length)[0] || null;
  const clauses = splitClauses(original).map((c) => (marker && hasWord(normalizeForMatch(c), marker) ? c.replace(new RegExp(`^\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'u'), '') : c));

  const conditions = [];
  let action = null;
  for (const clause of clauses) {
    const got = parseAction(clause);
    if (got && (got.target || got.sizePct != null || got.sizeUsd != null)) {
      if (!action) action = got;
      /* The action clause can also carry a condition before its verb:
         «اگر شاخص دلار بالای ۱۰۵ رفت نصف سرمایه را به نقره منتقل کن» has no
         comma, so the whole thing arrives as one clause. Cut at the SIZE
         (not the verb) and only accept the prefix as a condition when it
         actually compares something — otherwise «۱۰٪ سرمایه را به طلا» would
         be read as a 10% condition on gold. */
      const nt = normalizeForMatch(clause);
      const vi = got.verb ? wordIndex(nt, got.verb) : -1;
      const si = sizeMatch(nt);
      const cut = [vi, si].filter((v) => typeof v === 'number' && v > 0).sort((a, b) => a - b)[0];
      const prefix = cut && cut > 8 ? nt.slice(0, cut) : '';
      if (prefix && hasComparison(prefix) && findInstruments(prefix, { limit: 2 }).length) {
        const pre = parseCondition(prefix, { id: `c${conditions.length + 1}` });
        if (pre) conditions.push(pre);
      }
      continue;
    }
    const cond = parseCondition(clause, { id: `c${conditions.length + 1}` });
    if (cond) conditions.push(cond);
  }

  /* LOGIC — «یا / or» makes it OR, and the check runs on the CONDITION REGION
     (everything before the action verb) rather than on the clauses. It has
     to: `splitClauses` consumes «or» as a separator, so by the time the
     clauses exist the word that decides the logic is already gone. Reading
     the region also keeps «allocate 10% to gold or silver» — an OR in the
     action, not in the trigger — from silently weakening the condition. */
  let actionStart = -1;
  for (const group of ACTION_VERBS) {
    const w = firstWordFrom(t, group.words);
    if (!w) continue;
    const i = wordIndex(t, w);
    if (actionStart === -1 || i < actionStart) actionStart = i;
  }
  const conditionRegion = actionStart > 0 ? t.slice(0, actionStart) : t;
  const logic = OR_CONNECTIVES.some((w) => hasWord(conditionRegion, w)) ? 'OR' : 'AND';

  const portfolioWord = firstWordFrom(t, PORTFOLIO_WORDS);
  const riskWord = firstWordFrom(t, RISK_WORDS);
  const riskPct = riskWord ? readPercent(t) : null;

  const missing = [];
  if (!conditions.length) missing.push('CONDITION');
  if (!action) missing.push('ACTION');
  else {
    if (!action.target) missing.push('TARGET');
    if (action.sizePct == null && action.sizeUsd == null) missing.push('SIZE');
  }
  for (const c of conditions) {
    if (c.threshold == null) { missing.push('THRESHOLD'); break; }
  }

  const classes = [...new Set([
    ...conditions.map((c) => c.assetClass),
    ...(action?.target ? [action.target.assetClass] : [])
  ].filter(Boolean))];

  /* Confidence is the evidence, not a vibe: a marker, each fully-specified
     condition and a complete action each add their own weight. */
  let confidence = 0;
  if (marker) confidence += 0.22;
  confidence += conditions.filter((c) => c.threshold != null).length * 0.18;
  if (action?.target) confidence += 0.16;
  if (action?.sizePct != null || action?.sizeUsd != null) confidence += 0.14;
  if (classes.length > 1) confidence += 0.1;
  if (conditions.length > 1) confidence += 0.08;
  confidence = round(Math.min(0.97, confidence), 3);

  return {
    schema: CONDITIONAL_INTENT_SCHEMA,
    ok: Boolean(marker) && (conditions.length > 0 || Boolean(action?.target)),
    isConditional: Boolean(marker),
    lang: detectedLang,
    at: now,
    text: original,
    marker,
    logic,
    conditions,
    action,
    portfolio: {
      /* `referenced` = the user SAID «سرمایه/پرتفوی/capital». `assumed` = they
         named only a percentage («put 5% into AAPL»), so the share is read
         against capital but that reading is ours, not theirs — and the engine
         says so instead of presenting it as their words. */
      referenced: Boolean(portfolioWord),
      assumed: !portfolioWord && action?.source === 'PORTFOLIO',
      word: portfolioWord
    },
    risk: { mentioned: Boolean(riskWord), word: riskWord, maxDrawdownPct: riskPct },
    classes,
    missing,
    confidence,
    unresolvedTokens: []
  };
}

/**
 * The sentence the AI says back, built from the frame alone. The point is
 * that the user can CORRECT a misread before anything is stored: a condition
 * silently understood wrong is worse than one asked about.
 */
export function describeConditionalIntent(intent, { lang = null } = {}) {
  const l = lang || intent?.lang || 'en';
  const fa = l === 'fa';
  const conds = (intent?.conditions || []).map((c) => {
    const name = instrumentFor(c.asset)?.name?.[l] || c.display || c.asset;
    if (c.threshold == null) return fa ? `${name} — حد نصاب مشخص نشده` : `${name} — threshold not given`;
    if (c.metric === 'PERCENT_CHANGE') {
      const pct = faDigits(Math.abs(Number(c.threshold)), fa);
      if (c.operator === 'BELOW') return fa ? `${name} ${pct}٪ اصلاح کند (از حالا)` : `${name} drops ${pct}% (from now)`;
      return fa ? `${name} ${pct}٪ رشد کند (از حالا)` : `${name} rises ${pct}% (from now)`;
    }
    const op = c.operator === 'BELOW' ? (fa ? 'زیر' : 'below') : (fa ? 'بالای' : 'above');
    return fa ? `${name} ${op} ${faDigits(c.threshold, fa)}` : `${name} ${op} ${c.threshold}`;
  });
  const joiner = intent?.logic === 'OR' ? (fa ? ' یا ' : ' OR ') : (fa ? ' و ' : ' AND ');
  const a = intent?.action;
  const targetName = a?.target ? (instrumentFor(a.target.symbol)?.name?.[l] || a.target.symbol) : null;
  let act = '';
  if (a && targetName) {
    const size = a.sizePct != null
      ? (fa ? `${faDigits(a.sizePct, fa)}٪` : `${a.sizePct}%`)
      : (a.sizeUsd != null ? `$${faDigits(a.sizeUsd, fa)}` : (fa ? 'مقدار نامشخص' : 'an unset amount'));
    if (a.kind === 'ALLOCATE') act = fa ? `${size} سرمایه به ${targetName} اختصاص داده شود` : `allocate ${size} of capital to ${targetName}`;
    else if (a.kind === 'BUY') act = fa ? `${size} ${targetName} خریده شود` : `buy ${size} of ${targetName}`;
    else if (a.kind === 'SELL') act = fa ? `${size} ${targetName} فروخته شود` : `sell ${size} of ${targetName}`;
    else act = fa ? `${targetName} به ${size} متعادل شود` : `rebalance ${targetName} to ${size}`;
  }
  if (!conds.length && act) return fa ? `اگر (شرطی گفته نشده)، ${act}` : `if (no condition given), ${act}`;
  if (!act) return fa ? `اگر ${conds.join(joiner)}` : `if ${conds.join(joiner)}`;
  return fa ? `اگر ${conds.join(joiner)}، آنگاه ${act}` : `if ${conds.join(joiner)}, then ${act}`;
}

/** The question to ask for one missing slot. Never a default value. */
export function questionFor(missing, { lang = 'en' } = {}) {
  const fa = lang === 'fa';
  const table = {
    CONDITION: fa ? 'چه شرطی را چک کنم؟ (مثلاً «اگر طلا ۵٪ اصلاح کرد»)' : 'what condition should I watch? (e.g. “if gold drops 5%”)',
    THRESHOLD: fa ? 'حد نصاب شرط چقدر باشد؟ (مثلاً «۵٪» یا «بالای ۶۵۰۰۰»)' : 'what is the threshold? (e.g. “5%” or “above 65000”)',
    ACTION: fa ? 'وقتی شرط برقرار شد چه کنم؟ (مثلاً «۱۰٪ سرمایه را اختصاص بده»)' : 'what should happen when it triggers? (e.g. “allocate 10% of capital”)',
    TARGET: fa ? 'مقصد کدام دارایی باشد؟ (مثلاً «به طلا»)' : 'which asset is the target? (e.g. “to gold”)',
    SIZE: fa ? 'چه مقدار؟ (مثلاً «۱۰٪ سرمایه» یا «۵۰۰۰ دلار»)' : 'how much? (e.g. “10% of capital” or “$5000”)'
  };
  return table[missing] || (fa ? 'بقیه‌اش را توضیح بدهید.' : 'please clarify the rest.');
}

/** Persian numerals in the reply the user reads. The frame keeps ASCII
 *  digits (contracts compare numbers, not glyphs); only the sentence they
 *  are mirrored back in is localised. */
function faDigits(value, fa) {
  if (!fa) return value;
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(value).replace(/[0-9]/g, (d) => map[Number(d)]);
}

export { resolveInstrumentToken };
