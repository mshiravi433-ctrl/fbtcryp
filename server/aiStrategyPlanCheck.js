/**
 * FBT AI — STRATEGY ARITHMETIC (does the plan contradict itself?)
 * ---------------------------------------------------------------------------
 * The rubric checks that a strategy answer HAS the eight sections. It does not
 * check that the numbers inside them agree with each other — and that is where
 * model-written plans fail:
 *
 *   · allocations that add up to 130% of the capital;
 *   · a "long" whose stop sits ABOVE the entry (a guaranteed loss);
 *   · a risk budget of 2% next to a 40% position with an 8% stop (3.2% risk);
 *   · leverage above the platform cap;
 *   · a position larger than the user's whole portfolio.
 *
 * These are arithmetic, not opinion, so they are checked deterministically and
 * fed to the reviewer as MUST-FIX. The parser is deliberately conservative:
 * a percentage only counts as an allocation when it is attached to capital, a
 * portfolio or an asset; a stop is only compared when one sentence contains
 * both an entry and a stop; a per-trade risk only when the text names it per
 * trade. A checker that cries wolf is worse than no checker — every rule here
 * is pinned by a negative test as well as a positive one.
 *
 * No model call, no execution authority: this reads text and reports.
 */

import { normalizeDigits } from './aiEvidenceAudit.js';

export const STRATEGY_ARITHMETIC_SCHEMA = 'fbt.ai-strategy-arithmetic.v1';

function norm(text) {
  return normalizeDigits(String(text || ''))
    .replace(/\u200c/g, '')
    .replace(/[٬,']/g, ',');
}

function sentenceSplit(text) {
  return text.split(/[.؛;\n]+|(?<=[!?؟])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Allocation percentages that are explicitly of capital, a portfolio or an asset. */
function allocationPercents(text) {
  const found = [];
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)\s*(?:(?:از|of)\s*)?(?:کل\s*)?(?:سرمایه|سبد|پرتفوی|capital|portfolio)/gi,
    /(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)\s*(?:در|به|روی|into|in)\s*(?:[A-Za-z][A-Za-z0-9]{1,9}|[\u0600-\u06FF]{3,})/g,
    /(?:[A-Za-z][A-Za-z0-9]{1,9}|[\u0600-\u06FF]{3,})\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) {
        /* The same figure can be caught by two patterns; dedupe by position. */
        if (!found.some((f) => Math.abs(f.index - m.index) < 8)) found.push({ value, index: m.index });
      }
    }
  }
  return found;
}

function numberValue(raw) {
  const cleaned = String(raw).replace(/,/g, '').trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const ENTRY_RE = /(?:ورود|خرید|بخرم|لانگ|entry|buy|long)/i;
const EXIT_RE = /(?:فروش|بفروشم|شورت|short|sell)/i;
const STOP_RE = /(?:حد\s*ضرر|استاپ|stop[-\s]?loss|stop)/i;

/** Compare entry and stop inside ONE sentence. */
function stopSideViolations(text) {
  const out = [];
  for (const sentence of sentenceSplit(text)) {
    if (!STOP_RE.test(sentence)) continue;
    const isLong = ENTRY_RE.test(sentence);
    const isShort = EXIT_RE.test(sentence);
    if (isLong === isShort) continue; // neither, or both → too ambiguous to judge
    const stopMatch = sentence.match(/(?:حد\s*ضرر|استاپ|stop[-\s]?loss|stop)\D{0,10}(\d[\d.,]*)/i);
    if (!stopMatch) continue;
    const stop = numberValue(stopMatch[1]);
    if (stop == null) continue;
    const beforeStop = sentence.slice(0, stopMatch.index);
    const candidates = [...beforeStop.matchAll(/(\d[\d.,]*)/g)].map((m) => numberValue(m[1]));
    const entry = candidates.find((v) => v != null && v >= 10 && v !== stop);
    if (entry == null) continue;
    if (isLong && stop >= entry) {
      out.push({ id: 'stop_on_wrong_side', detail: `long entry ${entry} with stop ${stop} — the stop is not below the entry` });
    }
    if (isShort && stop <= entry) {
      out.push({ id: 'stop_on_wrong_side', detail: `short entry ${entry} with stop ${stop} — the stop is not above the entry` });
    }
  }
  return out;
}

function leverageViolations(text, frame) {
  const cap = Number(frame?.policy?.maxLeverage);
  if (!Number.isFinite(cap)) return [];
  const m = text.match(/(?:اهرم|لوریج|leverage)\D{0,10}(\d+(?:\.\d+)?)\s*(?:x|×|برابر)?/i);
  if (!m) return [];
  const value = Number(m[1]);
  return Number.isFinite(value) && value > cap
    ? [{ id: 'leverage_exceeds_policy', detail: `leverage ${value}× exceeds the platform cap of ${cap}×` }]
    : [];
}

function amountViolations(text, frame) {
  const capital = Number(frame?.capitalUsd);
  if (!Number.isFinite(capital) || capital <= 0) return [];
  /*
   * Precision over recall: an amount is only read as a POSITION SIZE when a
   * sizing word sits next to it and no price marker does. «حد ضرر ۹۵٬۰۰۰» and
   * «خرید در ۱۰۰٬۰۰۰» are levels, not sizes, and flagging them would train the
   * reviewer to ignore this check.
   */
  const out = [];
  const re = /(?:\$\s*(\d[\d.,]*))|(?:(\d[\d.,]*)\s*(?:دلار|usd|dollars?))/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = numberValue(m[1] || m[2]);
    if (value == null || value <= capital * 1.02) continue;
    const sentence = sentenceSplit(text).find((s) => s.includes(m[0])) || '';
    if (!/(پوزیشن|position|سرمایه[\s\u200c]*گذاری|invest|اختصاص|تخصیص|بگذار|وارد\s*کن)/i.test(sentence)) continue;
    const before = sentence.slice(0, Math.max(0, sentence.indexOf(m[0])));
    if (/(حد\s*ضرر|استاپ|stop|ورود|entry|قیمت|price)/i.test(before.slice(-24))) continue;
    out.push({ id: 'amount_exceeds_capital', detail: `a position of ${value} exceeds the ${capital} available` });
    break;
  }
  return out;
}

function allocationViolations(text) {
  const allocations = allocationPercents(text);
  if (allocations.length < 2) return [];
  const sum = allocations.reduce((a, b) => a + b.value, 0);
  return sum > 100.5
    ? [{ id: 'allocations_exceed_100', detail: `allocations add up to ${Math.round(sum * 100) / 100}% of the capital` }]
    : [];
}

/** size% × stop% must stay inside the per-trade risk budget the plan states. */
function riskBudgetViolations(text) {
  const budget = text.match(/(?:ریسک|risk)\s*(?:هر\s*(?:معامله|پوزیشن|پله)|per\s*(?:trade|position))/i);
  if (!budget) return [];
  const riskPct = text.match(/(?:ریسک|risk)\s*(?:هر\s*(?:معامله|پوزیشن|پله)|per\s*(?:trade|position))\D{0,12}(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)?/i);
  const budgetPct = riskPct ? Number(riskPct[1]) : null;
  if (budgetPct == null || !(budgetPct > 0)) return [];

  for (const sentence of sentenceSplit(text)) {
    if (!STOP_RE.test(sentence)) continue;
    const stopPctMatch = sentence.match(/(?:حد\s*ضرر|استاپ|stop[-\s]?loss|stop)\D{0,10}(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)/i);
    if (!stopPctMatch) continue;
    const stopPct = Number(stopPctMatch[1]);
    const size = allocationPercents(sentence).map((a) => a.value).sort((a, b) => b - a)[0];
    if (!Number.isFinite(stopPct) || !Number.isFinite(size)) continue;
    const implied = (size * stopPct) / 100;
    if (implied > budgetPct * 1.2) {
      return [{
        id: 'risk_exceeds_budget',
        detail: `a ${size}% position with a ${stopPct}% stop risks ${Math.round(implied * 100) / 100}% of capital, above the stated ${budgetPct}% per trade`
      }];
    }
  }
  return [];
}

/**
 * Check a strategy draft against its own frame.
 * @returns {{schema, violations:Array<{id,detail}>, clean:boolean, checked:string[]}}
 */
export function checkPlanArithmetic(text, frame = null) {
  const body = norm(text);
  const violations = [
    ...allocationViolations(body),
    ...stopSideViolations(body),
    ...leverageViolations(body, frame),
    ...amountViolations(body, frame),
    ...riskBudgetViolations(body)
  ];
  return {
    schema: STRATEGY_ARITHMETIC_SCHEMA,
    /* What this check can see. Stated so a caller never reads `clean` as a
       guarantee about facts the text did not contain. */
    checked: ['allocations', 'stop_side', 'leverage', 'position_size', 'risk_budget'],
    violations,
    clean: violations.length === 0
  };
}

/**
 * Is this number a PLAN PARAMETER (an entry, stop or target level) rather than
 * an asserted market fact? The repair gate uses this: a reviewer may change a
 * stop from 105,000 to 95,000 — that is a decision inside the plan, not an
 * invented price — while a new number in prose is still refused.
 */
export function isPlanParameter(text, value) {
  const body = norm(text);
  const target = Number(value);
  if (!Number.isFinite(target)) return false;
  const marker = /(حد\s*ضرر|استاپ|ورود|entry|stop[\s-]?loss|stop|target|هدف\s*قیمتی|تارگت)/i;
  const re = /(\d[\d.,]*)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (numberValue(m[1]) !== target) continue;
    const before = body.slice(Math.max(0, m.index - 30), m.index);
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (marker.test(before) || marker.test(after)) return true;
  }
  return false;
}

/** Reviewer-facing block. Empty when the plan is internally consistent. */
export function renderStrategyViolations(arithmetic) {
  if (!arithmetic || !Array.isArray(arithmetic.violations) || !arithmetic.violations.length) return '';
  const lines = arithmetic.violations.map((v) => `- ${v.id}: ${v.detail}`);
  return `STRATEGY ARITHMETIC — the plan contradicts itself. Fix or withdraw these figures, they must agree with each other and with the frame:\n${lines.join('\n')}`;
}

export default checkPlanArithmetic;
