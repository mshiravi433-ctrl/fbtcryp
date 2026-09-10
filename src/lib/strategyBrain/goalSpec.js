/**
 * FBT STRATEGY BRAIN — GOAL SPEC (layer 1 of 4).
 * ---------------------------------------------------------------------------
 * The request that motivated this whole module:
 *   «من ۱۰ هزار دلار دارم، در ۴ ماه حداقل ۱۵٪ سود می‌خواهم و ریسک متوسط
 *    قبول دارم.»
 *
 * That sentence is not a swap and not a portfolio screenshot. It is an
 * OBJECTIVE with four numbers in it — capital, target, horizon, risk — and the
 * only useful answer is a cross-module plan built from those four numbers.
 *
 * The intent parser already extracts `amountUsd` / `horizonDays` /
 * `riskPreference`, but it misses exactly the parts this sentence uses:
 *   · «۱۰ هزار دلار» — Persian digits AND the word «هزار» (10 × 1000);
 *     the parser's regex wants `\d+` followed by دلار, so it reads nothing.
 *   · «۱۵٪ سود» — the Persian percent sign ٪ (U+066A) is not `%`, so the
 *     target-return regex never fires.
 *
 * Rather than widen every regex in the parser (each one is pinned by a golden
 * probe), this file reads the raw sentence itself and falls back to the
 * parser's entities when it finds nothing. One parser for one job: turning a
 * sentence into the four numbers a strategy is allowed to be built on.
 *
 * THE LAW: a number that is not in the sentence and not in the wallet is not
 * invented here. Missing capital returns `missing: ['capitalUsd']` and the
 * caller asks for it — it never plans against an assumed portfolio.
 */

import { num } from './numeric.js';

export const GOAL_SPEC_SCHEMA = 'fbt.strategy-goal-spec.v1';

const FA_DIGITS = Object.freeze({ '۰': '0', '٠': '0', '۱': '1', '١': '1', '۲': '2', '٢': '2', '۳': '3', '٣': '3', '۴': '4', '٤': '4', '۵': '5', '٥': '5', '۶': '6', '٦': '6', '۷': '7', '٧': '7', '۸': '8', '٨': '8', '۹': '9', '٩': '9' });

/** Persian/Arabic digits → ASCII, and the Persian comma → nothing. */
export function toAsciiDigits(input) {
  return String(input ?? '')
    .replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] ?? d)
    .replace(/[٬،]/g, '')
    .replace(/\u200c/g, ' ');
}


const WORD_NUMBERS = Object.freeze({
  یک: 1, يك: 1, یکی: 1, يک: 1,
  دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10,
  بیست: 20, سی: 30, پنجاه: 50, صد: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, twenty: 20, thirty: 30, fifty: 50
});

/* «در یک سال» / "a year" — the indefinite article is a ONE, but only where a
   time unit follows it, so it is listed here and not in WORD_NUMBERS. */
const HORIZON_TOKENS = '\\d+(?:\\.\\d+)?|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|یک|يك|one|two|three|four|five|six|seven|eight|nine|ten|twelve|a|an';

function wordNumber(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  const ascii = toAsciiDigits(t);
  if (/^\d+(?:\.\d+)?$/.test(ascii)) return Number(ascii);
  return WORD_NUMBERS[t] ?? null;
}

/**
 * Multiplier words after a number: «۱۰ هزار دلار» = 10 × 1000,
 * «۲ میلیون» = 2 × 1e6, «1.5k», «2m», «10 thousand».
 */
const SCALES = Object.freeze([
  { re: /(هزار|هزارتومن|هزارتومان|thousand|k\b)/i, factor: 1_000 },
  { re: /(میلیون|million|m\b)/i, factor: 1_000_000 },
  { re: /(میلیارد|billion|b\b)/i, factor: 1_000_000_000 }
]);

/* ── capital ─────────────────────────────────────────────────────────────── */

/**
 * Read the capital the strategy may be planned against.
 * Order: an explicit amount in the sentence → the wallet/portfolio the app
 * already read. Both are labelled with their source, because "the user said
 * 10k" and "the wallet holds 10k" are different facts with different weight.
 */
export function readCapitalUsd({ text = '', entities = {}, portfolio = null, balances = null, wallet = null } = {}) {
  const raw = toAsciiDigits(text);

  /* «۱۰ هزار دلار» / «$10,000» / «10000 dollars» / «10k usd» */
  const amountRe = /(\d+(?:\.\d+)?|دو|سه|چهار|پنج|ده)\s*(هزار|میلیون|میلیارد|thousand|million|billion|k\b|m\b|b\b)?\s*(?:دلار|تتر|dollar|dollars|usd|usdt|usdc|\$)|\$?\s*(\d{3,}(?:[.,]\d+)?|\d+(?:\.\d+)?\s*(?:k|m|b)\b)\s*(?:دلار|dollar|dollars|usd|usdt|usdc)?/i;
  const hit = raw.match(amountRe);
  if (hit) {
    const literal = hit[1] || hit[3];
    const base = literal ? wordNumber(literal) : null;
    if (base != null) {
      const scaleWord = hit[2] || (/(\d+(?:\.\d+)?)\s*(k|m|b)\b/i.exec(literal || '')?.[2]) || '';
      const scale = SCALES.find((s) => s.re.test(scaleWord || ' '))?.factor || 1;
      const usd = base * scale;
      if (usd > 0) return { usd, source: 'user', evidence: hit[0].trim() };
    }
  }

  const total = num(portfolio?.totalValueUsd ?? portfolio?.totalUsd ?? portfolio?.valueUsd);
  if (total != null && total > 0) return { usd: total, source: 'portfolio' };

  if (Array.isArray(portfolio?.holdings) && portfolio.holdings.length) {
    const sum = portfolio.holdings.reduce((acc, h) => acc + (num(h.valueUsd) || 0), 0);
    if (sum > 0) return { usd: sum, source: 'holdings' };
  }

  if (Array.isArray(balances) && balances.length) {
    const sum = balances.reduce((acc, b) => acc + (num(b.valueUsd) || 0), 0);
    if (sum > 0) return { usd: sum, source: 'balances' };
  }

  const fromEntity = num(entities?.amountUsd ?? entities?.amount);
  if (fromEntity != null && fromEntity > 0 && entities?.amountSymbol !== 'ETH' && entities?.amountSymbol !== 'BTC') {
    return { usd: fromEntity, source: 'parser' };
  }

  const stable = num(wallet?.stablecoinUsd ?? wallet?.usdValue);
  if (stable != null && stable > 0) return { usd: stable, source: 'wallet' };

  return { usd: 0, source: null };
}

/* ── target ──────────────────────────────────────────────────────────────── */

/**
 * The return the user asked for, as a PERCENT of capital (15 → +15%).
 * «۱۵٪ سود», «15 درصد سود», «حداقل ۲۰ درصد بازدهی», «at least 15% profit»,
 * «سودم دو برابر شود» (→ 100%). The parser's `targetReturn` is honoured when
 * this file finds nothing, so both spellings of the same idea work.
 */
export function readTargetPct({ text = '', entities = {} } = {}) {
  const raw = toAsciiDigits(text);

  const multiple = raw.match(/(دو|سه|two|three|[\d.]+)\s*برابر|(double|triple|2x|3x)/i);
  if (multiple) {
    const word = multiple[1] || multiple[2];
    const n = wordNumber(word) ?? (/triple|3x/i.test(word) ? 3 : 2);
    if (n > 1) return { pct: (n - 1) * 100, source: 'multiple', evidence: multiple[0].trim() };
  }

  /* number → percent-sign/word → goal  («۱۵٪ سود», «15 درصد سود») */
  const after = raw.match(/(\d+(?:\.\d+)?)\s*(?:٪|%|درصد|percent)\s*(?:سود|بازدهی|بازده|رشد|profit|return|gain)?/i);
  if (after && /سود|بازده|رشد|profit|return|gain|درصد|percent|٪|%/i.test(after[0])) {
    const pct = num(after[1]);
    if (pct != null && pct > 0 && pct <= 100000) return { pct, source: 'percent', evidence: after[0].trim() };
  }

  /* goal → number  («سود ۱۵ درصد», «profit of 15%») */
  const before = raw.match(/(?:سود|بازدهی|بازده|رشد|profit|return|gain)[^.!?]{0,24}?(\d+(?:\.\d+)?)\s*(?:٪|%|درصد|percent)/i);
  if (before) {
    const pct = num(before[1]);
    if (pct != null && pct > 0) return { pct, source: 'percent', evidence: before[0].trim() };
  }

  const fromEntity = num(entities?.targetReturn);
  if (fromEntity != null && fromEntity > 0) return { pct: fromEntity, source: 'parser' };

  return { pct: null, source: null };
}

/* ── horizon ─────────────────────────────────────────────────────────────── */

const HORIZON_UNITS = Object.freeze([
  { re: new RegExp(`(${HORIZON_TOKENS})\\s*(?:روز|day|days)`, 'i'), days: 1 },
  { re: new RegExp(`(${HORIZON_TOKENS})\\s*(?:هفته|week|weeks)`, 'i'), days: 7 },
  { re: new RegExp(`(${HORIZON_TOKENS})\\s*(?:ماه|month|months|mo)`, 'i'), days: 30 },
  { re: new RegExp(`(${HORIZON_TOKENS})\\s*(?:سال|year|years)`, 'i'), days: 365 }
]);

/** Horizon in days, from the sentence or from the parser's entities. */
export function readHorizonDays({ text = '', entities = {} } = {}) {
  const raw = toAsciiDigits(text);
  for (const unit of HORIZON_UNITS) {
    const hit = raw.match(unit.re);
    if (!hit) continue;
    const token = String(hit[1] || '').trim().toLowerCase();
    const n = wordNumber(token) ?? (/^(a|an)$/.test(token) ? 1 : null);
    if (n != null && n > 0) {
      return { days: Math.round(n * unit.days), source: 'sentence', evidence: hit[0].trim() };
    }
  }
  const fromEntity = num(entities?.horizonDays);
  if (fromEntity != null && fromEntity > 0) return { days: Math.round(fromEntity), source: 'parser' };
  const hrs = num(entities?.timeframe?.normalizedHrs);
  if (hrs != null && hrs > 0) return { days: Math.max(1, Math.round(hrs / 24)), source: 'parser' };
  return { days: null, source: null };
}

/* ── risk ────────────────────────────────────────────────────────────────── */

/**
 * The user's own risk appetite, normalised onto the three bands the strategy
 * engine is allowed to plan inside. `capital_preservation` and `low` both
 * land on `conservative`; the engine's band is a CEILING, never a suggestion.
 */
export function readRiskProfile({ text = '', entities = {} } = {}) {
  const raw = toAsciiDigits(text).toLowerCase();
  const pref = String(entities?.riskPreference || '').toLowerCase();

  const has = (re) => re.test(raw);
  if (has(/حفظ اصل سرمایه|اصل پولم|بدون ریسک|بی ریسک|protect capital|no risk|capital preservation/i) || pref === 'capital_preservation') {
    return { profile: 'conservative', source: pref ? 'parser' : 'sentence' };
  }
  if (has(/ریسک کم|کم ریسک|کمترین ریسک|low risk|conservative|محافظه|safe/i) || pref === 'low') {
    return { profile: 'conservative', source: pref ? 'parser' : 'sentence' };
  }
  if (has(/هرچی شد بشه|yolo|all in|بترکونم|ریسک خیلی بالا|very high risk/i) || pref === 'aggressive') {
    return { profile: 'aggressive', source: pref ? 'parser' : 'sentence' };
  }
  if (has(/ریسک بالا|پرریسک|high risk|aggressive|ریسک زیاد/i) || pref === 'high') {
    return { profile: 'aggressive', source: pref ? 'parser' : 'sentence' };
  }
  if (has(/ریسک متوسط|ریسک متعادل|متوسط|متعادل|moderate|medium risk|balanced/i) || pref === 'moderate') {
    return { profile: 'balanced', source: pref ? 'parser' : 'sentence' };
  }
  return { profile: 'balanced', source: 'default' };
}

/* ── the spec ────────────────────────────────────────────────────────────── */

/**
 * @returns {{ok:boolean, schema:string, capitalUsd:number, capitalSource:string|null,
 *            targetPct:number|null, horizonDays:number|null, riskProfile:string,
 *            riskSource:string, floorPct:number|null, missing:string[], evidence:object}}
 */
export function parseGoalSpec({ text = '', entities = {}, portfolio = null, balances = null, wallet = null } = {}) {
  const capital = readCapitalUsd({ text, entities, portfolio, balances, wallet });
  const target = readTargetPct({ text, entities });
  const horizon = readHorizonDays({ text, entities });
  const risk = readRiskProfile({ text, entities });
  /* «حداقل ۱۵٪» — "at least" is a FLOOR, and the plan is judged against the
     floor, not against the best case. Without this the strategy could satisfy
     "15% minimum" with a 4% carry plan and call it done. */
  const floor = /حداقل|دست کم|کمتر از این نه|at least|minimum|no less than/i.test(toAsciiDigits(text));

  const missing = [];
  if (!(capital.usd > 0)) missing.push('capitalUsd');
  if (target.pct == null) missing.push('targetPct');
  if (horizon.days == null) missing.push('horizonDays');

  return {
    ok: missing.length === 0,
    schema: GOAL_SPEC_SCHEMA,
    capitalUsd: Math.round((capital.usd || 0) * 100) / 100,
    capitalSource: capital.source,
    targetPct: target.pct,
    targetSource: target.source,
    /* A minimum target is the bar; a soft one is still the target. */
    floorPct: floor && target.pct != null ? target.pct : null,
    horizonDays: horizon.days,
    horizonSource: horizon.source,
    riskProfile: risk.profile,
    riskSource: risk.source,
    missing,
    evidence: {
      capital: capital.evidence || null,
      target: target.evidence || null,
      horizon: horizon.evidence || null
    },
    /* The sentence the numbers were read from, so the answer can show its work. */
    sourceText: String(text || '').slice(0, 240)
  };
}
