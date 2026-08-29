/**
 * FBT INTENT AI — SEMANTIC UNDERSTANDING
 * ---------------------------------------------------------------------------
 * Reads what a customer MEANT, in the words they actually used, and returns a
 * structured frame the parser and planner can act on.
 *
 * WHY THIS EXISTS
 *   The original parser is a keyword engine over ~40 tokens of vocabulary. It
 *   is correct on "swap 500 USDC to ETH on Arbitrum" and blind on
 *   "میخوام پولم رشد کنه" — which is what most real customers type. Measured
 *   over a 43-utterance corpus of realistic phrasings, it recovered 40.8% of
 *   the fields a human reader would have extracted (see
 *   test/intent-ai/intent-understanding-probe.mjs).
 *
 * WHY IT IS STILL NOT AN LLM
 *   Every match in this file is a lookup against semanticLexicon.js or a
 *   bounded edit distance. That is deliberate, and it is the same decision
 *   intentParser.js already made: a money-moving decision must not be
 *   reachable by prompt injection, and "which word made the agent think
 *   SELL" has to be answerable from the audit trail. A hosted model can sit
 *   BEHIND this layer as one more evidence source; it cannot replace the
 *   layer, because then no one could explain a trade.
 *
 * WHAT IT ADDS
 *   · asset names in 12 languages, not just tickers ("تتر" → USDT)
 *   · typo tolerance ("bitcoiin" → BTC, "arbitrom" → Arbitrum)
 *   · conjugated Persian/Arabic verbs ("بخرم", "فروختم")
 *   · relative amounts ("نصف پولم" → 50%, "همه" → 100%)
 *   · objectives ("رشد" → growth, "امن باشه" → preserve)
 *   · risk stance, recurrence, max-loss, goal multipliers ("دو برابر" → 100%)
 *   · an explicit "the user gave no number" signal, so the planner PROPOSES
 *     a size and says it proposed it, instead of inventing one
 *
 * It never invents a token, an amount or a chain. Absence stays absence.
 */

import {
  ASSET_ALIAS_INDEX,
  ASSET_NAMES,
  ACTION_LEXICON,
  OBJECTIVE_LEXICON,
  RISK_LEXICON,
  FRACTION_LEXICON,
  FUZZY_AMOUNT_WORDS,
  RECURRENCE_LEXICON,
  TIME_UNITS,
  MULTIPLIER_LEXICON,
  LOSS_GUARD_LEXICON,
  normalizeWord,
  tokenize,
  editDistance,
  typoTolerance,
  stripRtlSuffix,
  isRtlWord
} from './semanticLexicon.js';
import { detectLeverageText, leveragePattern } from './speculativeLexicon.js';

export const SEMANTIC_SCHEMA = 'fbt.semantic-intent.v1';

/* -------------------------------------------------------------------------- */
/*  TEXT PREPARATION                                                           */
/* -------------------------------------------------------------------------- */

const DIGIT_MAPS = ['۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩', '०१२३४५६७८९', '০১২৩৪৫৬৭৮৯'];

/**
 * A second normalisation pass that keeps the two punctuation marks the money
 * readers depend on. `normalizeWord` strips everything non-alphanumeric, which
 * is right for matching words but would erase "$5000" and "10%" before
 * detectCapital and detectPercentages ever saw them — and both are real
 * phrasings ("buy $100 of ETH every month", "I want a 10% return").
 */
export function softNormalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\u200c/g, ' ')
    .replace(/\u200f|\u200e/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[^\p{L}\p{N}$% ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Localised digits → ASCII, plus the Arabic decimal/thousands marks. */
export function foldDigits(text) {
  let out = String(text ?? '');
  for (const digits of DIGIT_MAPS) {
    for (let i = 0; i < 10; i += 1) out = out.split(digits[i]).join(String(i));
  }
  return out.replace(/\u066B/g, '.').replace(/\u066C/g, '').replace(/\u066D/g, ' ');
}

/** Spelled-out small numbers, in the languages the UI ships. */
const NUMBER_WORDS = Object.freeze({
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
  'hundred': 100, 'thousand': 1000,
  'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
  'یازده': 11, 'دوازده': 12, 'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70,
  'صد': 100, 'هزار': 1000, 'میلیون': 1000000, 'میلیارد': 1000000000,
  'واحد': 1, 'اثنان': 2, 'ثلاثة': 3, 'اربعة': 4, 'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تسعة': 9, 'عشرة': 10,
  'مائة': 100, 'مئة': 100, 'ألف': 1000, 'الف': 1000, 'مليون': 1000000,
  'один': 1, 'два': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'десять': 10, 'сто': 100, 'тысяч': 1000,
  'bir': 1, 'iki': 2, 'üç': 3, 'dört': 4, 'beş': 5, 'on': 10, 'yüz': 100, 'bin': 1000,
  'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'diez': 10, 'cien': 100, 'mil': 1000,
  'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'dix': 10, 'cent': 100, 'mille': 1000,
  'satu': 1, 'dua': 2, 'tiga': 3, 'empat': 4, 'lima': 5, 'sepuluh': 10, 'seratus': 100, 'seribu': 1000,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'दस': 10, 'सौ': 100, 'हजार': 1000
});

/** Words that are quantities, never assets — keeps "1 day" from reading as 1 DAY. */
const NON_ASSET_WORDS = new Set([
  ...Object.keys(NUMBER_WORDS),
  'day', 'days', 'hour', 'hours', 'minute', 'minutes', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'percent', 'pct', 'times', 'x', 'usd', 'dollar', 'dollars',
  'روز', 'ساعت', 'دقیقه', 'هفته', 'ماه', 'سال', 'درصد', 'برابر', 'دلار',
  'يوم', 'أيام', 'شهر', 'ساعة', 'دقيقة', 'اسبوع', 'أسبوع', 'سنة',
  'день', 'дней', 'час', 'месяц', 'год', 'gün', 'ay', 'yıl', 'hafta', 'saat'
]);

/**
 * True when `stem` occurs in `text` as a real word.
 *
 * For right-to-left stems a PREFIX also counts. Persian verbs are written as
 * stem + ending — «بخرم», «بخرید», «می‌خرم» are all بخر — and a customer never
 * types the dictionary form. Requiring the whole token would make every
 * conjugated Persian request invisible, which is exactly the gap this module
 * exists to close. The rule is confined to RTL stems: in Latin scripts a
 * 3-letter prefix match is mostly noise.
 */
function hasStem(text, stem) {
  const s = normalizeWord(stem);
  if (!s) return false;
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (s.length <= 3) {
    const boundary = new RegExp(`(^|\\s)${escaped}(\\s|$|[؟?.,!،])`, 'u');
    if (boundary.test(text)) return true;
    if (!isRtlWord(s)) return false;
    // «بخرم» starts with «بخر».
    return new RegExp(`(^|\\s)${escaped}`, 'u').test(text);
  }
  return text.includes(s);
}

/** True when a multi-word English phrase occurs. */
function hasPhrase(text, phrase) {
  const p = normalizeWord(phrase);
  if (!p) return false;
  if (!p.includes(' ')) return hasStem(text, p);
  return text.includes(p);
}

/** Score a phrase/stem hit: whole-word matches beat fragments. */
function stemScore(text, stem) {
  const s = normalizeWord(stem);
  if (!s) return 0;
  if (!hasStem(text, s)) return 0;
  const tokens = tokenize(text);
  return tokens.includes(s) ? 1 : 0.75;
}

/* -------------------------------------------------------------------------- */
/*  ASSET RESOLUTION                                                           */
/* -------------------------------------------------------------------------- */

const ASSET_ALIAS_KEYS = [...ASSET_ALIAS_INDEX.keys()];

/**
 * Resolve one token to a ticker. Exact alias first, then a bounded typo
 * match. Returns null rather than a guess — an invented asset is the most
 * expensive mistake this layer can make.
 */
export function resolveAsset(token) {
  const key = normalizeWord(token);
  if (!key || key.length < 2) return null;
  const exact = ASSET_ALIAS_INDEX.get(key);
  if (exact) return { symbol: exact, via: 'alias', distance: 0 };
  if (NON_ASSET_WORDS.has(key)) return null;

  /* «تترهام» = تتر + هام. Try the bare noun before anything cleverer. */
  const bare = stripRtlSuffix(key);
  if (bare) {
    const bareKey = normalizeWord(bare);
    const hit = ASSET_ALIAS_INDEX.get(bareKey);
    if (hit) return { symbol: hit, via: 'suffix', distance: 0, alias: bareKey };
  }

  const tol = typoTolerance(key);
  if (tol === 0) return null;
  let best = null;
  for (const alias of ASSET_ALIAS_KEYS) {
    if (Math.abs(alias.length - key.length) > tol) continue;
    const d = editDistance(key, alias, tol);
    if (d <= tol && (!best || d < best.distance)) best = { symbol: ASSET_ALIAS_INDEX.get(alias), via: 'typo', distance: d, alias };
  }
  return best;
}

/** Tokens whose chain and token share a name, disambiguated by context. */
const CHAIN_TOKEN_LOOKALIKES = new Set(['ARB', 'OP', 'MATIC', 'SOL', 'AVAX', 'TRX', 'TON', 'BNB', 'ETH']);

/**
 * One word for what the agent thinks the customer wants. Deliberation beats
 * the verb inside it: a question is answered, never executed.
 */
function readingOf({ actions, uniqueAssets, objective, deliberating, goalPct, recurring }) {
  if (deliberating) return 'ask';
  if (recurring) return 'recurring';
  if (goalPct != null && !actions.some((a) => a.action === 'swap' || a.action === 'buy' || a.action === 'sell')) return 'goal';
  if (objective && !actions.length) return 'objective';
  return actions[0]?.action ?? (uniqueAssets.length ? 'analyze' : 'unknown');
}

/** Multi-word asset names ("بیت کوین", "usd coin") scanned against the text. */
export function findAssetPhrases(normalized) {
  const hits = [];
  for (const [alias, symbol] of ASSET_ALIAS_INDEX) {
    if (!alias.includes(' ')) continue;
    const idx = normalized.indexOf(alias);
    if (idx < 0) continue;
    hits.push({ symbol, via: 'phrase', alias, start: idx, length: alias.length });
  }
  // Longest phrases first, so "بیت کوین" is consumed before "کوین".
  return hits.sort((a, b) => b.length - a.length);
}

/* -------------------------------------------------------------------------- */
/*  AMOUNTS                                                                    */
/* -------------------------------------------------------------------------- */

const CURRENCY_WORDS = new Set(
  ASSET_NAMES.USD.map((w) => normalizeWord(w)).filter(Boolean)
);

/**
 * The capital the customer named, if any. Understands "$500", "500$",
 * "500 دلار", "500 dollars", "500 USDT", "0.5 ETH", and spelled-out numbers
 * ("پنج میلیون", "two thousand").
 */
export function detectCapital(normalized) {
  /* "$500" or "500$" */
  const dollarSign = normalized.match(/\$\s?([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s?\$/);
  if (dollarSign) {
    const value = Number(dollarSign[1] ?? dollarSign[2]);
    if (Number.isFinite(value) && value > 0) return { value, unit: 'USD', via: 'symbol', match: dollarSign[0] };
  }

  /* "500 <currency-or-asset-word>" */
  const re = /([0-9]+(?:\.[0-9]+)?)\s*([^\s،,.;:!?؟]+)/g;
  let m;
  while ((m = re.exec(normalized)) !== null) {
    const value = Number(m[1]);
    const word = normalizeWord(m[2]);
    if (!Number.isFinite(value) || value <= 0 || !word) continue;
    if (CURRENCY_WORDS.has(word)) return { value, unit: 'USD', via: 'currency-word', match: m[0] };
    if (NON_ASSET_WORDS.has(word)) continue;
    const asset = resolveAsset(word);
    if (asset) return { value, unit: asset.symbol, via: asset.via, match: m[0] };
  }

  /* "<currency-or-asset-word> 500" — the Persian word order ("دلار ۵۰۰") */
  const rev = /([^\s،,.;:!?؟]+)\s*([0-9]+(?:\.[0-9]+)?)/g;
  while ((m = rev.exec(normalized)) !== null) {
    const word = normalizeWord(m[1]);
    const value = Number(m[2]);
    if (!Number.isFinite(value) || value <= 0 || !word) continue;
    if (CURRENCY_WORDS.has(word)) return { value, unit: 'USD', via: 'currency-word-reversed', match: m[0] };
  }

  /* Spelled-out: "پنج میلیون" / "two thousand" */
  const words = tokenize(normalized);
  let total = 0;
  let pending = 0;
  let spelled = false;
  for (const w of words) {
    const n = NUMBER_WORDS[w];
    if (n == null) continue;
    if (n >= 100) {
      total += (pending || 1) * n;
      pending = 0;
    } else {
      pending += n;
    }
    spelled = true;
  }
  total += pending;
  if (spelled && total > 0 && /million|میلیون|هزار|thousand|مليون|bin|mil|هزار/.test(normalized)) {
    return { value: total, unit: 'USD', via: 'spelled', match: String(total) };
  }
  return null;
}

/** Percentages, and whether the percentage is OF THE PORTFOLIO or A TARGET. */
export function detectPercentages(normalized) {
  const out = { amountPct: null, goalPct: null };
  const re = /([0-9]+(?:\.[0-9]+)?)\s*(?:%|درصد|بالمئة|بالمائة|процент|процентов|yüzde|por ?ciento|pour ?cent|persen|प्रतिशत)/g;
  let m;
  const found = [];
  while ((m = re.exec(normalized)) !== null) found.push({ value: Number(m[1]), index: m.index });
  for (const p of found) {
    if (!Number.isFinite(p.value) || p.value <= 0) continue;
    const after = normalized.slice(p.index, p.index + 60);
    const before = normalized.slice(Math.max(0, p.index - 40), p.index);
    /* "۱۰ درصد از داراییم" — a share of what they hold, not a target. */
    const isShare = /^\s*[0-9.]*\s*(?:%|درصد|بالمئة)?\s*(از|of|من|из|de)/.test(after)
      || /از (دارایی|داراییم|پول|پولم|موجودی|سبد)/.test(after)
      || /\b(of my|of the portfolio|percent of)/.test(after);
    const isTarget = /(سود|profit|return|بازده|عائد|прибыл|kazanç|rendimiento|rendement|gain|رشد|هدف|target|goal|hedef|objetivo)/.test(
      `${before} ${after}`
    );
    if (isShare && out.amountPct == null) out.amountPct = p.value;
    else if (isTarget && out.goalPct == null) out.goalPct = p.value;
    else if (out.amountPct == null) out.amountPct = p.value;
  }
  return out;
}

/** "half of my money" → 50. Returns null when the user never quantified. */
export function detectFraction(normalized) {
  for (const row of FRACTION_LEXICON) {
    for (const kw of row.keywords) if (hasPhrase(normalized, kw)) return { pct: row.pct, via: kw };
    for (const st of row.stems) {
      const s = stemScore(normalized, st);
      if (s > 0) return { pct: row.pct, via: st };
    }
  }
  return null;
}

/** "a bit" / "یکم" — a real "I have no number" signal, not a quantity. */
export function detectFuzzyAmount(normalized) {
  for (const [level, row] of Object.entries(FUZZY_AMOUNT_WORDS)) {
    for (const kw of row.keywords) if (hasPhrase(normalized, kw)) return level;
    for (const st of row.stems) if (hasStem(normalized, st)) return level;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  TIME, RECURRENCE, MULTIPLIERS                                              */
/* -------------------------------------------------------------------------- */

export function detectDuration(normalized) {
  const re = /([0-9]+(?:\.[0-9]+)?)\s*([^\s،,.;:!?؟]+)/g;
  let m;
  while ((m = re.exec(normalized)) !== null) {
    const value = Number(m[1]);
    const word = normalizeWord(m[2]);
    const unit = TIME_UNITS.find((u) => u.words.includes(word) || u.stems.includes(word));
    if (!unit) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    return { hrs: value * unit.hours, unit: unit.unit, via: m[0] };
  }
  return null;
}

export function detectRecurrence(normalized) {
  for (const row of RECURRENCE_LEXICON) {
    for (const kw of row.keywords) if (hasPhrase(normalized, kw)) return { recurring: row.recurring, hours: row.hours, via: kw };
    for (const st of row.stems) {
      const s = stemScore(normalized, st);
      if (s > 0) return { recurring: row.recurring, hours: row.hours, via: st };
    }
  }
  return null;
}

/**
 * "double my money" → factor 2. Kept separate from leverage on purpose:
 * "دو برابر کن" is a return target and a margin setting is not, and confusing
 * the two would be the single worst mistake this file could make.
 */
export function detectMultiplier(normalized) {
  /* Whether the sentence is about margin is the gated module's call. */
  const isLeverageContext = leveragePattern().test(normalized);
  for (const row of MULTIPLIER_LEXICON) {
    let hit = null;
    for (const w of row.words) if (hasPhrase(normalized, w)) { hit = w; break; }
    if (!hit) for (const st of row.stems) if (hasStem(normalized, st)) { hit = st; break; }
    if (!hit) continue;
    // "10x margin" is leverage, not a 900% return target.
    if (isLeverageContext) continue;
    return { factor: row.factor, via: hit };
  }
  return null;
}

/** Margin size, or null. Delegated: see speculativeLexicon.js. */
export function detectLeverage(normalized) {
  return detectLeverageText(normalized);
}

/** "don't lose more than $100" → 100. */
export function detectMaxLoss(normalized) {
  let triggered = false;
  for (const kw of LOSS_GUARD_LEXICON.keywords) if (hasPhrase(normalized, kw)) { triggered = true; break; }
  if (!triggered) for (const st of LOSS_GUARD_LEXICON.stems) if (hasStem(normalized, st)) { triggered = true; break; }
  if (!triggered) return null;
  const capital = detectCapital(normalized);
  return capital && capital.unit === 'USD' ? capital.value : null;
}

/* -------------------------------------------------------------------------- */
/*  INTENT CLASSIFICATION                                                      */
/* -------------------------------------------------------------------------- */

/** Which actions the utterance expresses, strongest first. */
export function detectActions(normalized) {
  const scored = [];
  for (const row of ACTION_LEXICON) {
    let score = 0;
    let source = null;
    for (const kw of row.keywords) {
      if (hasPhrase(normalized, kw)) { score += 1; source = source || kw; }
    }
    for (const cjk of row.cjk || []) {
      if (normalized.includes(cjk)) { score += 1; source = source || cjk; }
    }
    for (const st of row.stems || []) {
      const s = stemScore(normalized, st);
      if (s > 0) { score += s; source = source || st; }
    }
    // Conjugation fallback: a Persian verb stem present as a prefix of a word
    // ("بخرم", "فروختم") still counts, at lower confidence.
    if (score > 0) scored.push({ action: row.action, kind: row.kind, direction: row.direction ?? null, subType: row.subType ?? null, score, source });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * "بیت کوین الان بخرم یا نه؟" / "should I buy ETH now?"
 *
 * This is the single most common thing a nervous customer types, and it is
 * NOT an order. Reading the verb and routing them to a swap screen would be
 * the worst possible answer to a question. Detected explicitly so the
 * classifier can prefer `analyze` over the action it contains.
 */
export function detectDeliberation(normalized) {
  const patterns = [
    /\bshould i\b/, /\bshould we\b/, /\bis it a good\b/, /\bworth (buying|it)\b/,
    /\bnow or (never|later)\b/, /\bor (not|no)\??$/, /\bwhat do you think\b/,
    /یا نه/, /بخرم یا/, /بفروشم یا/, /الان بخرم/, /الان بفروشم/, /بهتره/, /نظرت چیه/,
    /چه نظری/, /آیا/, /هل (أ|ا)?(اشتري|أبيع|يكون)/, /стоит ли/, /malı mıyım/
  ];
  return patterns.some((re) => re.test(normalized));
}

/** What the customer is ultimately trying to achieve. */
export function detectObjective(normalized) {
  let best = null;
  for (const row of OBJECTIVE_LEXICON) {
    let score = 0;
    let source = null;
    for (const kw of row.keywords) if (hasPhrase(normalized, kw)) { score += 1; source = source || kw; }
    for (const st of row.stems) {
      const s = stemScore(normalized, st);
      if (s > 0) { score += s; source = source || st; }
    }
    /*
     * Ties break toward the CONCRETE objective. "دنبال سود هستم، چیکار کنم"
     * carries both an income signal and a "what should I do" signal; answering
     * with a tutorial when the customer asked for yield would be the dumber
     * reading, and rank is what encodes which is which.
     */
    if (score > 0 && (!best || score > best.score || (score === best.score && row.rank > best.rank))) {
      best = { objective: row.objective, rank: row.rank, score, source };
    }
  }
  return best;
}

export function detectRisk(normalized) {
  for (const level of ['high', 'low', 'medium']) {
    const row = RISK_LEXICON[level];
    for (const kw of row.keywords) if (hasPhrase(normalized, kw)) return level;
    for (const st of row.stems) if (hasStem(normalized, st)) return level;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  MAIN ENTRY                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Split a multi-request sentence at its sequencing words. "اول X، بعد Y"
 * yields two clauses; the planner works the first and offers the rest, which
 * beats collapsing two different trades into one average of the two.
 */
export function splitClauses(normalized) {
  const parts = normalized
    .split(/(?:\bthen\b|\bfirst\b|\bafter that\b|(^|\s)(?:بعد|سپس|اول|ثم|затем|sonra|luego|ensuite)(?=\s)|\b\d+\s*[.)]\s)/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 1 ? parts : [normalized];
}

/**
 * Read one utterance.
 *
 * @returns {{schema, text, normalized, actions, assets, objective,
 *            riskTolerance, amountPct, fuzzyAmount, capital, percentages,
 *            durationHrs, recurring, multiplier, leverage, maxLossUsd,
 *            clauses, matched}}
 */
export function analyzeUtterance(rawText, context = {}) {
  const raw = String(rawText ?? '');
  const withDigits = foldDigits(raw);
  const normalized = normalizeWord(withDigits);
  /* Money-shaped punctuation survives only in this copy. */
  const soft = softNormalize(withDigits);
  const matched = [];

  if (!normalized) {
    return {
      schema: SEMANTIC_SCHEMA, text: raw, normalized: '', actions: [], assets: [],
      objective: null, riskTolerance: null, amountPct: null, fuzzyAmount: null,
      capital: null, percentages: { amountPct: null, goalPct: null }, durationHrs: null,
      recurring: null, multiplier: null, leverage: null, maxLossUsd: null,
      clauses: [], matched, understood: false
    };
  }

  /* ── multi-request split ─────────────────────────────────────────────── */
  const clauses = splitClauses(normalized);
  const head = clauses[0];

  /* ── assets, by phrase then by token ─────────────────────────────────── */
  const assets = [];
  const consumed = [];
  for (const hit of findAssetPhrases(head)) {
    assets.push({ symbol: hit.symbol, via: hit.via, position: hit.start, word: hit.alias });
    for (let i = hit.start; i < hit.start + hit.length; i += 1) consumed.push(i);
  }
  let cursor = 0;
  const headTokens = tokenize(head);
  for (let ti = 0; ti < headTokens.length; ti += 1) {
    const word = headTokens[ti];
    const start = head.indexOf(word, cursor);
    cursor = start + word.length;
    if (consumed.includes(start)) continue;

    /*
     * "on Arbitrum" names a NETWORK, not the ARB token. Several chains and
     * their tokens share a word (Arbitrum/ARB, Optimism/OP, Polygon/MATIC),
     * and reading the chain as an asset would make the agent try to buy a
     * token the customer never mentioned. The preposition before the word is
     * what settles it.
     */
    const prev = headTokens[ti - 1];
    const isChainContext = /^(on|over|via|روی|در|شبکه|روی شبکه|network|chain|в сети|на|en la red|sur|di)$/.test(prev ?? '');

    const resolved = resolveAsset(word);
    if (resolved) {
      if (isChainContext && CHAIN_TOKEN_LOOKALIKES.has(resolved.symbol)) {
        matched.push({ kind: 'chain-word', from: word, to: resolved.symbol, via: 'chain-context' });
        continue;
      }
      assets.push({ symbol: resolved.symbol, via: resolved.via, position: start, word });
      matched.push({ kind: 'asset', from: word, to: resolved.symbol, via: resolved.via });
    }
  }
  // De-duplicate keeping first position (order matters for from/to).
  const seen = new Set();
  const uniqueAssets = assets.filter((a) => {
    const key = `${a.symbol}@${a.position}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.position - b.position);

  /* ── everything else ─────────────────────────────────────────────────── */
  const leverage = detectLeverage(normalized);
  const actions = detectActions(head);
  /*
   * Leverage only exists on a margin venue. When the customer named one,
   * "لانگ بگیر" is an order on a perpetual, not a spot buy, however the verb
   * scores on its own — and getting that wrong would send real money to the
   * wrong market.
   */
  if (leverage != null) {
    const fut = actions.find((a) => a.action === 'futures');
    if (fut) fut.score += 2;
    else actions.unshift({ action: 'futures', kind: 'futures', direction: null, subType: null, score: 2, source: 'leverage' });
    actions.sort((a, b) => b.score - a.score);
    matched.push({ kind: 'action', from: `${leverage}x leverage`, to: 'futures', via: 'leverage-context' });
  }
  if (actions[0]) matched.push({ kind: 'action', from: actions[0].source, to: actions[0].action });

  const objective = detectObjective(normalized);
  if (objective) matched.push({ kind: 'objective', from: objective.source, to: objective.objective });

  const riskTolerance = detectRisk(normalized);
  const capital = detectCapital(soft);
  const percentages = detectPercentages(soft);
  const fraction = detectFraction(head);
  const fuzzyAmount = detectFuzzyAmount(head);
  const recurring = detectRecurrence(normalized);
  /* A duration only means something when the sentence is not periodic;
     "every month $100" has no horizon, it has a cadence. */
  const duration = recurring ? null : detectDuration(normalized);
  const multiplier = detectMultiplier(normalized);
  const maxLossUsd = detectMaxLoss(soft);
  const deliberating = detectDeliberation(normalized);

  /* A multiplier IS a goal, expressed as a factor rather than a percent. */
  let goalPct = percentages.goalPct;
  if (goalPct == null && multiplier) goalPct = Math.round((multiplier.factor - 1) * 100 * 100) / 100;

  /* Relative amount: a stated fraction wins over a fuzzy word. */
  const amountPct = fraction ? fraction.pct : (percentages.amountPct ?? null);

  return {
    schema: SEMANTIC_SCHEMA,
    text: raw,
    normalized,
    clauses,
    actions,
    assets: uniqueAssets,
    objective: objective?.objective ?? null,
    objectiveSource: objective?.source ?? null,
    riskTolerance,
    amountPct,
    fractionVia: fraction?.via ?? null,
    fuzzyAmount,
    capital,
    percentages,
    goalPct,
    durationHrs: duration?.hrs ?? null,
    recurring: recurring?.recurring ?? null,
    recurringHours: recurring?.hours ?? null,
    multiplier: multiplier?.factor ?? null,
    leverage,
    maxLossUsd,
    deliberating,
    matched,
    understood: Boolean(
      actions.length || uniqueAssets.length || objective || capital
      || amountPct != null || goalPct != null || riskTolerance || recurring || maxLossUsd
    ),
    /*
     * The reading the agent settled on, in one word, so a UI and an audit
     * trail can both say why. Nothing downstream may infer an action this
     * field does not carry.
     */
    reading: readingOf({ actions, uniqueAssets, objective, deliberating, goalPct, recurring }),
    context: { locale: context.locale ?? null }
  };
}

/** Every asset name the lexicon knows, for the "did you mean" surface. */
export function knownAssetNames() {
  return Object.freeze(Object.fromEntries(Object.entries(ASSET_NAMES).map(([k, v]) => [k, [...v]])));
}
