/**
 * FBT INTENT OS — PARTIAL INPUT READ (what the user meant, when the words don't say it)
 * -----------------------------------------------------------------------------------
 * People do not type complete sentences into a chat box. They type «بیتکوین؟»,
 * «۲۵۰ دلار سولانا», «استراتژی من با ۲۰۰۰۰», or they type with the keyboard on
 * the wrong language and send «fovl». A layer that waits for a well-formed
 * question treats all of that as small talk, and a layer that guesses silently
 * is worse: it answers a question the person never asked, with numbers they
 * never gave.
 *
 * So this module does three things, deterministically and without a model call:
 *
 *   1. REPAIR — fold Arabic yeh/kaf, Persian digits, ZWNJ; reverse the
 *      English-on-Persian-layout mistake («fovl» → «بخرم»); snap near-miss
 *      spellings to the known words («بیتکاین» → «بیتکوین») and finish a word
 *      that was cut mid-typing («استرات» → «استراتژی»).
 *   2. INFER — the most likely act, asset, amount and horizon, each with the
 *      basis it came from (the words, the previous turn, the page, or the shape
 *      of a fragment) and an explicit assumption label.
 *   3. BUDGET — at most ONE question, and only when the missing slot is the one
 *      thing the answer cannot be useful without. The rest is stated as an
 *      assumption, not interrogated.
 *
 * `deepThinkFloor` is the execution side of the same promise: a fragment, a cut
 * sentence or a garbled line is not cheap input — it is the input where a wrong
 * reading costs the most — so it never runs on the one-line path. Pure social
 * turns stay exempt (the small-talk law outranks depth; see the router).
 */

import {
  normalizeUpgrade4,
  extractEntitiesUpgrade4,
  SLANG_ASSET_MAP
} from '../intentUnderstandingEngine.js';
import { classifySocialAct } from './socialIntent.js';

export const PARTIAL_INPUT_SCHEMA = 'fbt.ai-partial-input.v1';
export const PARTIAL_INPUT_VERSION = '1.0.0';

/* ── folding ──────────────────────────────────────────────────────────────── */

export function foldInput(raw) {
  return String(raw ?? '')
    .replace(/\u0640/g, '')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * Persian has no `\b`: it is a script without case and JS word boundaries are
 * ASCII-only, so `\bبخر\b` never matches. Every term below is anchored with a
 * Persian-safe boundary instead — the third time this lesson has cost us a
 * silent miss, so it lives in one helper now.
 */
function termRe(term) {
  const t = foldInput(term);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const persian = /[\u0600-\u06FF]/.test(t);
  const letters = t.replace(/[^\u0600-\u06FF]/g, '').length;
  /* Persian inflects by suffix (بخر → بخرم/بخرد/بخرید), so a 4+ letter Persian
     term matches as a prefix; short terms and Latin tickers stay strict. */
  const tail = persian && letters >= 4 ? '' : '(?![\\p{L}])';
  return new RegExp(`(?<![\\p{L}])${escaped}${tail}`, 'iu');
}

const has = (text, term) => termRe(term).test(text);

/* ── the keyboard-layout mistake ──────────────────────────────────────────── */

/* Standard Persian layout, key by key. If a message has no Persian letters but
   its Latin letters land on Persian ones, the person was typing Persian with an
   English layout — «fovl» is «بخرم», not a ticker. */
const LATIN_TO_PERSIAN = Object.freeze({
  q: 'ض', w: 'ص', e: 'ث', r: 'ق', t: 'ف', y: 'غ', u: 'ع', i: 'ه', o: 'خ', p: 'ح',
  '[': 'ج', ']': 'چ', a: 'ش', s: 'س', d: 'ی', f: 'ب', g: 'ل', h: 'ا', j: 'ت', k: 'ن',
  l: 'م', ';': 'ک', "'": 'گ', z: 'ظ', x: 'ط', c: 'ز', v: 'ر', b: 'ذ', n: 'د', m: 'ئ',
  ',': 'و', '.': '.', '/': '/'
});

const KNOWN_WORDS = Object.freeze([
  /* assets, Persian and Latin */
  'بیتکوین', 'بیت کوین', 'اتریوم', 'سولانا', 'تتر', 'دوج کوین', 'ریپل', 'کاردانو',
  'بایننس', 'پالیگان', 'آوالانچ', 'چین لینک', 'پولکادات', 'لایت کوین', 'مونرو',
  'bitcoin', 'ethereum', 'solana', 'tether', 'dogecoin', 'ripple', 'cardano',
  /* acts */
  'بخرم', 'بفروشم', 'بخرد', 'بفروش', 'خرید', 'فروش', 'سواپ', 'تبدیل', 'تحلیل',
  'قیمت', 'چنده', 'چقدره', 'استراتژی', 'سرمایه‌گذاری', 'سیگنال', 'کارمزد', 'امنیت',
  'سبد', 'پرتفوی', 'سازنده', 'بریج', 'کیف پول', 'سود', 'ضرر', 'ریسک', 'اهرم',
  'ورود', 'خروج', 'چطوری', 'چطور', 'بخرم؟', 'بفروشم؟', 'چیه', 'چیست'
]);

const WORD_SET = new Set(KNOWN_WORDS.map((w) => foldInput(w)));

/* Words that are already correct and must never be snapped to a neighbour:
   «چقدر» is not a typo of «چقدره», and «سود» is not a typo of «سودِ» anything. */
const COMMON_WORDS = Object.freeze([
  'چقدر', 'چقدره', 'چنده', 'چند', 'چرا', 'چطور', 'چطوری', 'چیه', 'چیست', 'کی', 'کجا',
  'سود', 'ضرر', 'کرده', 'کردم', 'دارم', 'داری', 'داره', 'بود', 'هست', 'هستم', 'میشه',
  'بشه', 'کنم', 'بکنم', 'بدم', 'بگیرم', 'امروز', 'فردا', 'دیروز', 'هفته', 'ماه', 'سال',
  'دلار', 'تومان', 'ریال', 'سرمایه', 'پول', 'ارز', 'کوین', 'توکن', 'بازار', 'رمزارز',
  'من', 'تو', 'شما', 'ما', 'یه', 'یک', 'این', 'آن', 'هم', 'و', 'یا', 'که', 'از', 'به',
  'با', 'برای', 'در', 'تا', 'روی', 'مثل', 'مثلا', 'اما', 'ولی', 'اگر', 'وقتی', 'چون',
  'سلام', 'ممنون', 'مرسی', 'خوبی', 'خوبم', 'لطفا', 'بگو', 'بگید', 'کن', 'کنید', 'است',
  'باشه', 'باشد', 'بودن', 'شدن', 'کردن', 'الان', 'موقع', 'وضعیت', 'بهتر', 'بهترین'
]);
const COMMON_SET = new Set(COMMON_WORDS.map((w) => foldInput(w)));

function reverseLayout(token) {
  let out = '';
  for (const ch of String(token || '').toLowerCase()) out += LATIN_TO_PERSIAN[ch] || ch;
  return out;
}

/** Damerau–Levenshtein distance, capped — we only care about "one or two slips". */
export function editDistance(a, b, cap = 3) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > cap) return cap + 1;
  const rows = [];
  for (let i = 0; i <= s.length; i++) rows.push([i]);
  for (let j = 0; j <= t.length; j++) rows[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = value;
    }
  }
  return rows[s.length][t.length];
}

/** How many slips a word of this length may have (short words stay strict). */
function toleranceFor(word) {
  const n = [...word].length;
  if (n <= 3) return 0;
  if (n <= 5) return 1;
  return 2;
}

/** Snap one word to a known word: exact → layout → near-miss typo → cut prefix. */
export function resolveWord(rawWord, { allowPrefix = false } = {}) {
  const word = foldInput(rawWord).toLowerCase();
  if (!word) return null;
  if (WORD_SET.has(word) || COMMON_SET.has(word)) return { word, how: 'exact' };

  /* English-on-Persian layout: only when the result is a real word. */
  if (/^[a-z',.;[\]/]{2,}$/.test(word)) {
    const mapped = foldInput(reverseLayout(word));
    if (WORD_SET.has(mapped)) return { word: mapped, how: 'layout' };
    for (const known of KNOWN_WORDS) {
      const target = foldInput(known);
      if (editDistance(mapped, target, 2) <= toleranceFor(target)) return { word: target, how: 'layout' };
    }
  }

  if (allowPrefix && word.length >= 3) {
    const prefixes = KNOWN_WORDS.map((w) => foldInput(w)).filter((t) => t.startsWith(word) && t !== word);
    if (prefixes.length) {
      prefixes.sort((a, b) => a.length - b.length);
      return { word: prefixes[0], how: 'prefix' };
    }
  }

  let best = null;
  for (const known of KNOWN_WORDS) {
    const target = foldInput(known);
    const cap = toleranceFor(target);
    if (!cap) continue;
    const d = editDistance(word, target, cap);
    if (d <= cap && (!best || d < best.distance)) best = { word: target, how: 'typo', distance: d };
  }
  return best;
}

/* ── repair ───────────────────────────────────────────────────────────────── */

const DANGLING = Object.freeze(['و', 'یا', 'که', 'از', 'به', 'با', 'برای', 'در', 'تا', 'روی', 'مثل', 'مثلا', 'مثلاً', 'اما', 'ولی', 'اگر', 'وقتی', 'چون', 'and', 'or', 'but']);

/**
 * Read the text with the recoverable mistakes undone.
 *
 * Nothing here rewrites what the user wrote for display — the repaired text is
 * a READING, reported beside the original with the list of repairs.
 */
export function repairInput(message = '') {
  const original = String(message || '');
  const folded = foldInput(original);
  const tokens = folded.split(' ').filter(Boolean);
  const repairs = [];
  const words = [];
  const trailingEllipsis = /(?:\.{2,}|…)\s*$/.test(original.trim());

  tokens.forEach((token, index) => {
    const isLast = index === tokens.length - 1;
    const bare = token.replace(/[؟?!.,،؛:;"'«»()]/g, '');
    if (!bare) return;
    const resolved = resolveWord(bare, { allowPrefix: isLast || trailingEllipsis });
    if (resolved && resolved.how !== 'exact') {
      repairs.push({ token: bare, to: resolved.word, how: resolved.how });
      words.push(resolved.word);
      return;
    }
    words.push(bare);
  });

  const lastToken = (tokens[tokens.length - 1] || '').replace(/[؟?!.,،؛:;"'«»()]/g, '');
  const dangling = DANGLING.includes(lastToken);
  const layoutFixed = repairs.some((r) => r.how === 'layout');
  const cutWord = repairs.find((r) => r.how === 'prefix') || null;

  return {
    original,
    folded,
    text: words.join(' '),
    repairs,
    layoutFixed,
    trailingEllipsis,
    dangling,
    cutWord,
    /* The message stops mid-thought: a connector at the end, an ellipsis, or a
       word that only exists as the beginning of another. */
    truncated: Boolean(trailingEllipsis || cutWord || dangling),
    /* It was unreadable as written and only becomes readable after repair. */
    garbled: Boolean(layoutFixed || repairs.some((r) => r.how === 'typo'))
  };
}

/* ── vocabulary for inference ─────────────────────────────────────────────── */

const ACT_TERMS = Object.freeze([
  /* A definition question is COMPLETE by construction — «تتر یعنی چی» is not a
     fragment, and the hard law says a static definition never exceeds level 2,
     so it is also exempt from the deep-think floor. */
  ['definition', ['یعنی چی', 'یعنی چه', 'یعنی چیست', 'چیست', 'چیه', 'به چه معنی', 'معنی', 'what is', 'what are', 'meaning of']],
  ['buy', ['بخرم', 'بخری', 'بخرید', 'بخرد', 'بخرن', 'خرید', 'بخرم؟', 'buy', 'long']],
  ['sell', ['بفروشم', 'بفروش', 'بفروشید', 'فروش', 'sell', 'short']],
  ['swap', ['سواپ', 'تبدیل', 'swap', 'convert']],
  ['strategy', ['استراتژی', 'سرمایه گذاری', 'سرمایه‌گذاری', 'پلن', 'strategy', 'plan']],
  ['analysis', ['تحلیل', 'نظرت', 'نظر شما', 'چطوره', 'خوبه', 'ارزشش', 'آینده', 'پیش بینی', 'analyze', 'analyse', 'outlook']],
  ['price', ['قیمت', 'چنده', 'چقدره', 'نرخ', 'price']],
  ['fee', ['کارمزد', 'کمیسیون', 'fee', 'commission']],
  ['security', ['امنیت', 'امنه', 'کلید', 'عبارت بازیابی', 'هک', 'secure', 'safe']],
  ['portfolio', ['سبد', 'پرتفوی', 'پورتفولیو', 'portfolio', 'holdings']],
  ['howto', ['چطور', 'چگونه', 'چطوری', 'نحوه', 'howto']]
]);

const AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(دلار|تومان|ریال|یورو|درصد|٪|%|usd|\$|dollar|percent)/iu;
const FUZZY_AMOUNT_RE = /(یه\s*(?:مقدار|کم|کمی|دسته)|مبلغ\s*(?:کم|معلوم\s*نیست)|نمی\s*دونم\s*چقدر|هر\s*چی|whatever|some)\b/iu;
const VERBISH = Object.freeze(['بخر', 'بفروش', 'کن', 'کنم', 'هست', 'است', 'باشد', 'می خوام', 'میخوام', 'می خواهم', 'شود', 'دارم', 'دارید', 'بدهم', 'بگیرم', 'چنده', 'چقدره', 'چیه', 'چیست', 'بدم', 'بده', 'بدید', 'بگو', 'بگید', 'بنویس', 'want', 'need', 'should', 'can']);

function assetsIn(text, { message, context = {} } = {}) {
  const found = [];
  const push = (asset) => { if (asset && !found.includes(asset)) found.push(asset); };
  let entities = {};
  try {
    entities = extractEntitiesUpgrade4(message, context) || {};
  } catch {
    entities = {};
  }
  if (entities.token) push(String(entities.token).toUpperCase());
  for (const t of entities.tokens || []) push(String(t).toUpperCase());
  for (const [word, asset] of Object.entries(SLANG_ASSET_MAP)) {
    const fold = foldInput(word);
    if (!fold) continue;
    if (has(text, fold)) push(String(asset).toUpperCase());
  }
  return found;
}

function actOf(text) {
  for (const [act, terms] of ACT_TERMS) {
    if (terms.some((t) => has(text, t))) return act;
  }
  return 'unknown';
}

/* ── the read ─────────────────────────────────────────────────────────────── */

/**
 * Read an incomplete message the way a good analyst would: assume the least,
 * name the assumption, and ask the one question that changes the answer.
 */
export function readPartialInput({ message = '', locale = 'fa', context = {}, priorIntent = null } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const repair = repairInput(message);
  const text = repair.text || repair.folded;
  const tokens = text.split(' ').filter(Boolean);
  const entities = (() => { try { return extractEntitiesUpgrade4(message, context) || {}; } catch { return {}; } })();

  let social = null;
  try { social = classifySocialAct(String(message || ''), { locale }); } catch { social = null; }
  const pureSocial = Boolean(social && social.pure);

  const rawAssets = assetsIn(text, { message, context: {} });
  const assets = [...rawAssets];
  const priorAssets = Array.isArray(context?.lastAssets) ? context.lastAssets.filter(Boolean) : [];
  const contextAsset = !assets.length && priorAssets.length ? String(priorAssets[0]).toUpperCase() : null;
  if (contextAsset) assets.push(contextAsset);

  const act = actOf(text);
  const amount = (() => {
    if (entities.amount != null) {
      const asNumber = Number(String(entities.amount).replace(/,/g, ''));
      return {
        value: Number.isFinite(asNumber) ? asNumber : entities.amount,
        unit: entities.amountUnit || 'USD',
        basis: 'message'
      };
    }
    const m = AMOUNT_RE.exec(text);
    if (m) return { value: Number(String(m[1]).replace(',', '.')), unit: m[2], basis: 'message' };
    return null;
  })();
  const fuzzyAmount = FUZZY_AMOUNT_RE.test(text) || entities.isFuzzyAmount === true;
  const verbish = VERBISH.some((t) => has(text, t));
  const question = /[؟?]/.test(String(message));

  const signals = {
    empty: !tokens.length,
    tooShort: tokens.length > 0 && tokens.length <= 3,
    noVerb: !verbish,
    dangling: repair.dangling,
    ellipsis: repair.trailingEllipsis,
    cutWord: Boolean(repair.cutWord),
    layout: repair.layoutFixed,
    typo: repair.repairs.some((r) => r.how === 'typo'),
    mixedScript: /[\p{Script=Latin}]/u.test(message) && /[\u0600-\u06FF]/.test(message),
    question,
    pureSocial
  };

  const wantsTrade = ['buy', 'sell', 'swap'].includes(act);
  /* "Informative enough to answer without guessing": a verb-ish word, or enough
     words to carry a request. A two-word line is a fragment even when the words
     are a real act («فروش فوری»). */
  const informative = tokens.length >= 4 || verbish;

  let completeness = 'complete';
  if (signals.empty) completeness = 'empty';
  else if (pureSocial) completeness = 'small-talk';
  else if (act === 'definition' && !repair.truncated) completeness = 'complete';
  else if (repair.truncated) completeness = 'truncated';
  else if (repair.garbled) completeness = 'garbled';
  else if (wantsTrade && !assets.length) completeness = 'ambiguous';
  else if (tokens.length <= 3 && !informative) completeness = 'fragment';
  /* No verb and no question mark: the sentence was left mid-thought even if the
     words themselves are complete («استراتژی من با ۲۰۰۰۰»). */
  else if (!verbish && !question) completeness = 'truncated';

  /* Assumptions: what we filled in, and from where. Each one MUST be said out
     loud in the answer; silence is the failure mode this module exists to stop. */
  const assumptions = [];
  if (contextAsset) {
    assumptions.push({
      slot: 'asset',
      value: contextAsset,
      basis: 'previous-turn',
      fa: `دارایی از نوبت قبل (${contextAsset}) خوانده شد`,
      en: `the asset was carried over from the previous turn (${contextAsset})`
    });
  }
  if (act === 'unknown' && assets.length && completeness === 'fragment') {
    const likely = amount ? 'buy' : 'analysis';
    assumptions.push({
      slot: 'act',
      value: likely,
      basis: amount ? 'amount-and-asset-without-verb' : 'bare-asset-fragment',
      fa: amount
        ? 'پیام فقط «مبلغ + دارایی» است، پس درخواستِ خرید فرض شد'
        : 'پیام فقط نام دارایی است، پس پرسشِ وضعیت/تحلیل فرض شد',
      en: amount
        ? 'the message is an amount plus an asset with no verb, so a buy request was assumed'
        : 'the message is just an asset name, so a state/analysis question was assumed'
    });
  }
  if (act === 'unknown' && wantsTrade === false && !assets.length && completeness === 'fragment' && question) {
    assumptions.push({
      slot: 'intent',
      value: 'short question',
      basis: 'one-word-question',
      fa: 'پیام یک پرسشِ یک‌کلمه‌ای است؛ خوانشِ محتمل‌ترین پرسش دربارهٔ همان واژه',
      en: 'the message is a one-word question; it was read as the most likely question about that word'
    });
  }
  if (completeness === 'garbled' && repair.repairs.length) {
    assumptions.push({
      slot: 'wording',
      value: repair.repairs.map((r) => `${r.token}→${r.to}`).join(', '),
      basis: 'repaired-spelling',
      fa: `نوشتار پیام ترمیم شد (${repair.repairs.map((r) => `${r.token}→${r.to}`).join('، ')})`,
      en: `the wording was repaired (${repair.repairs.map((r) => `${r.token}→${r.to}`).join(', ')})`
    });
  }

  /* What is genuinely missing — only slots that change the answer. */
  const missing = [];
  if (wantsTrade && !assets.length) missing.push({ slot: 'asset', why: fa ? 'دارایی مشخص نشده' : 'no asset named' });
  if (wantsTrade && !amount && !fuzzyAmount) missing.push({ slot: 'amount', why: fa ? 'مبلغ مشخص نشده' : 'no amount given' });
  if (act === 'strategy' && !entities.timeframe) missing.push({ slot: 'horizon', why: fa ? 'افق زمانی مشخص نشده' : 'no horizon given' });

  /* One question, for the slot that makes the answer possible. */
  const critical = missing.find((m) => ['asset', 'amount', 'horizon'].includes(m.slot)) || null;
  const askable = Boolean(critical) && !pureSocial;
  const ask = askable
    ? {
      slot: critical.slot,
      fa: critical.slot === 'asset'
        ? 'منظورت کدام دارایی است — BTC، ETH یا SOL؟'
        : critical.slot === 'amount'
          ? 'چه مبلغی در ذهن داری؟ (اگر هنوز معلوم نیست، بگو تا با درصد جلو برویم)'
          : 'این برنامه برای چه افقی است — چند هفته، چند ماه یا یک سال؟',
      en: critical.slot === 'asset'
        ? 'Which asset do you mean — BTC, ETH or SOL?'
        : critical.slot === 'amount'
          ? 'What amount do you have in mind? (If not yet, say so and I will work in percentages.)'
          : 'What horizon is this for — weeks, months or a year?'
    }
    : null;

  const confidence = (() => {
    let score = 0.35;
    if (completeness === 'complete') score = 0.86;
    if (completeness === 'fragment') score = 0.62;
    if (completeness === 'garbled') score = 0.74;
    if (completeness === 'truncated') score = 0.58;
    if (completeness === 'ambiguous') score = 0.46;
    if (completeness === 'small-talk') score = 0.98;
    if (act !== 'unknown') score += 0.06;
    if (assets.length) score += 0.04;
    if (contextAsset) score -= 0.04;
    return Math.max(0, Math.min(0.98, Number(score.toFixed(2))));
  })();

  return {
    schema: PARTIAL_INPUT_SCHEMA,
    version: PARTIAL_INPUT_VERSION,
    completeness,
    original: repair.original,
    repaired: repair.text,
    repairs: repair.repairs,
    signals,
    inferred: {
      act,
      assets,
      assetSource: contextAsset ? 'previous-turn' : (rawAssets.length ? 'message' : 'none'),
      amount,
      fuzzyAmount,
      timeframe: entities.timeframe || null
    },
    assumptions,
    missing,
    question: ask,
    questionBudget: ask ? 1 : 0,
    social: pureSocial,
    confidence
  };
}

/* ── contract & checks ────────────────────────────────────────────────────── */

const COMPLETENESS_NOTE = Object.freeze({
  fragment: 'a FRAGMENT, not a full question',
  truncated: 'CUT OFF mid-thought',
  garbled: 'misspelt or typed in the wrong keyboard layout',
  ambiguous: 'missing the one thing that makes it answerable',
  empty: 'empty',
  complete: 'complete',
  'small-talk': 'small talk'
});

/**
 * The brief. Returns '' for a complete or purely social message, so a
 * well-formed turn costs nothing and every earlier prompt stays byte-identical.
 */
export function renderPartialContract(read) {
  if (!read || read.schema !== PARTIAL_INPUT_SCHEMA) return '';
  if (read.completeness === 'empty' || read.completeness === 'small-talk') return '';
  if (read.completeness === 'complete' && !read.questionBudget && !read.assumptions.length) return '';

  const lines = [];
  lines.push(`PARTIAL INPUT (the message is ${COMPLETENESS_NOTE[read.completeness] || read.completeness}):`);
  if (read.repairs.length) {
    lines.push(`- read with the recoverable mistakes undone: «${read.repaired}»`);
  }
  const reading = [read.inferred.act !== 'unknown' ? read.inferred.act : null,
    read.inferred.assets.length ? read.inferred.assets.join('/') : null]
    .filter(Boolean).join(' · ');
  if (reading) lines.push(`- most likely reading: ${reading} (confidence ${read.confidence})`);

  for (const a of read.assumptions) lines.push(`- ASSUMPTION you must state in your first two sentences: ${a.en} (${a.basis})`);
  lines.push('- answer the most likely reading usefully FIRST. A clarification-only reply to a fragment is a refusal dressed as care.');
  if (read.missing.length) {
    lines.push(`- genuinely missing: ${read.missing.map((m) => m.slot).join(', ')}. Do not invent any of them, and do not silently pick a number.`);
  }
  if (read.questionBudget === 1 && read.question) {
    lines.push(`- question budget: ONE. If you must ask, ask exactly this and nothing else: «${read.question.en}»`);
  } else {
    lines.push('- question budget: at most ONE question, and only if it changes the answer.');
  }
  if (read.completeness === 'truncated') {
    lines.push('- the message stops mid-thought: say so in one short clause and answer the half you can.');
  }
  return lines.join('\n');
}

const DISCLOSURE_RE = /فرض|اگر\s+منظور|اگر\s+مقصود|یعنی\s+منظورت|منظورت\s+(?:این|همان)|این\s+را\s+از\s+پیامت\s+خواندم|احتمالاً|به\s*نظر\s*می\s*رسد|خوانش\s+من|assuming|if\s+you\s+mean|i\s+read\s+(?:that|this)\s+as|i'?ll\s+assume/iu;

function countQuestions(text) {
  return (String(text || '').match(/[؟?]/g) || []).length;
}

/**
 * Did the answer respect the read? Three narrow checks; each fires only on a
 * turn that was actually incomplete, so a well-formed exchange is untouched.
 */
export function checkPartialAnswer({ read = null, answer = '' } = {}) {
  const raw = String(answer || '');
  /* Persian digits and the Persian decimal separator defeat every ASCII
     pattern; fold once and match the folded text (review #3's lesson). */
  const text = foldInput(raw);
  const issues = [];
  if (!read || read.schema !== PARTIAL_INPUT_SCHEMA || !text.trim()) {
    return { schema: PARTIAL_INPUT_SCHEMA, applicable: false, issues, compliant: true };
  }
  if (read.completeness === 'empty' || read.completeness === 'small-talk') {
    return { schema: PARTIAL_INPUT_SCHEMA, applicable: false, issues, compliant: true };
  }
  if (read.completeness === 'complete' && !read.questionBudget && !read.assumptions.length) {
    return { schema: PARTIAL_INPUT_SCHEMA, applicable: false, issues, compliant: true };
  }

  const disclosed = DISCLOSURE_RE.test(text.slice(0, 400));

  /* 1. The reading was used but never named. */
  if (read.assumptions.length && !disclosed) {
    issues.push({
      id: 'ASSUMED_SPEC_UNDISCLOSED',
      severity: 'MEDIUM',
      detail: `the message was incomplete and the answer silently used the reading (${read.assumptions.map((a) => a.slot).join(', ')}). Name the assumption in the first two sentences: "if you mean X…".`
    });
  }

  /* 2. A number the person never gave, presented as their plan. */
  if (read.missing.some((m) => m.slot === 'amount')) {
    const concrete = /(?:با|برای|حدود|معادل)\s*[0-9][0-9.,]*\s*(?:دلار|تومان|یورو|درصد|٪|%|dollar|usd)/iu;
    if (concrete.test(text) && !disclosed) {
      issues.push({
        id: 'INVENTED_AMOUNT',
        severity: 'HIGH',
        detail: 'the user gave no amount and the answer builds a plan on a concrete amount. Use a percentage/example framing and label it, or ask the one question.'
      });
    }
  }

  /* 3. An interrogation instead of one precise question. */
  const questions = countQuestions(raw);
  if (questions > 1) {
    issues.push({
      id: 'QUESTION_BUDGET_EXCEEDED',
      severity: 'MEDIUM',
      detail: `the answer asks ${questions} questions; this turn allows 1. Ask the one that changes the answer, assume (and label) the rest.`
    });
  }

  return {
    schema: PARTIAL_INPUT_SCHEMA,
    applicable: true,
    completeness: read.completeness,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft respected the read). */
export function renderPartialDeficit(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `PARTIAL-INPUT VIOLATIONS (the message was incomplete; fix each one):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

/* ── depth ────────────────────────────────────────────────────────────────── */

/**
 * How deep must this turn run?
 *
 * Incomplete input is where a cheap answer costs the most: the person is not
 * being lazy, they are typing in a hurry, in a second language, on a phone — and
 * a misread fragment is a wrong financial plan. So fragments, cut sentences and
 * garbled lines get a floor of 3 (two models + tools) in every mode.
 * Small talk is exempt: «سلام» is not a research question, and pretending
 * otherwise buys latency and no information.
 */
export function deepThinkFloor({ read = null, smallTalk = false } = {}) {
  if (smallTalk || read?.completeness === 'small-talk') return { floor: 0, reason: 'small-talk' };
  /* The static-definition law outranks depth: «what is BTC?» needs a clear
     answer, not a three-model debate. */
  if (read?.inferred?.act === 'definition') return { floor: 0, reason: 'static-definition' };
  if (!read || read.schema !== PARTIAL_INPUT_SCHEMA) return { floor: 0, reason: 'no-read' };
  if (read.completeness === 'empty') return { floor: 0, reason: 'empty' };
  if (['fragment', 'truncated', 'garbled', 'ambiguous'].includes(read.completeness)) {
    return { floor: 3, reason: `incomplete-${read.completeness}` };
  }
  return { floor: 0, reason: 'complete' };
}

export default readPartialInput;
