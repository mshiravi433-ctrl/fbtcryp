/**
 * FBT AI — STRATEGY FRAME + RUBRIC (smartest mode, strategy turns)
 * ---------------------------------------------------------------------------
 * A model asked to "build an investment strategy" does three things badly when
 * it is left alone:
 *
 *   1. it invents the numbers it was not given (capital, weights, fees);
 *   2. it writes an opinion instead of a PLAN — no sizing, no entry condition,
 *      no invalidation, no cost, no scenarios;
 *   3. it presents a complete-looking plan whose missing piece is exactly the
 *      one that decides the outcome (a stop nobody can violate because nobody
 *      wrote one).
 *
 * This module gives the collaboration engine two deterministic things:
 *
 *   · FRAME — the facts a plan is allowed to stand on: the user's real capital,
 *     their current weights and concentration, the platform fee and what it
 *     costs to break even, the policy caps. Anything absent is listed in `gaps`
 *     instead of being guessed, and the prompt says so explicitly.
 *
 *   · RUBRIC — the eight sections a strategy answer must contain (objective,
 *     horizon, risk budget, sizing, entry condition, invalidation, cost,
 *     scenarios). The synthesiser is told the rubric before it writes; the
 *     reviewer is told which sections are missing in the draft. It is a
 *     completeness contract, not a claim that the strategy is good.
 *
 * No network, no model call, no execution authority (`executionAuthorized` is
 * not part of this object at all). `balanced`/`swift` never see it.
 */

import { FEE_BPS } from '../src/lib/feeBps.js';
import { normalizeDigits } from './aiEvidenceAudit.js';
import { DEFAULT_POLICY_CAPS } from '../src/lib/intent-ai/permissions.js';

export const STRATEGY_FRAME_SCHEMA = 'fbt.ai-strategy-frame.v1';

/* The eight sections. Six are mandatory; monitoring is strongly expected. */
export const STRATEGY_RUBRIC = Object.freeze([
  { id: 'objective', required: true, fa: 'هدف و بازده مورد انتظار', en: 'objective and expected outcome', re: /(هدف|بازده|سود مورد انتظار|objective|target return|goal)/i },
  { id: 'horizon', required: true, fa: 'افق زمانی', en: 'time horizon', re: /(افق|بلندمدت|کوتاه‌مدت|کوتاه مدت|ماه|سال|هفته|horizon|long[-\s]?term|short[-\s]?term|months?|years?|weeks?)/i },
  { id: 'risk_budget', required: true, fa: 'بودجهٔ ریسک و حداکثر افت قابل تحمل', en: 'risk budget and maximum tolerable drawdown', re: /(ریسک|حداکثر افت|تحمل|drawdown|risk tolerance|risk budget|max loss)/i },
  { id: 'sizing', required: true, fa: 'اندازهٔ هر بخش (درصد یا مبلغ)', en: 'size of every leg (percent or amount)', re: /(درصد|[\d۰-۹]\s*(?:٪|%)|وزن|سهم|مبلغ|پله|tranche|allocation|position size|weight)/i },
  { id: 'entry_condition', required: true, fa: 'شرط ورود', en: 'entry condition', re: /(شرط ورود|اگر|وقتی|entry|trigger|condition|فقط در صورت)/i },
  { id: 'invalidation', required: true, fa: 'شرط ابطال یا حد ضرر', en: 'invalidation level or stop', re: /(حد ضرر|ابطال|خروج|stop[-\s]?loss|invalidation|exit)/i },
  { id: 'cost', required: true, fa: 'هزینه و کارمزد', en: 'cost and fees', re: /(کارمزد|هزینه|اسلیپیج|fee|slippage|cost)/i },
  { id: 'scenarios', required: true, fa: 'سناریوهای صعودی/پایه/نزولی', en: 'bull/base/bear scenarios', re: /(سناریو|صعودی|نزولی|base case|bull|bear|scenario)/i },
  { id: 'monitoring', required: false, fa: 'پایش و بازبینی', en: 'monitoring and revision', re: /(پایش|بازبینی|هر هفته|هر ماه|review|monitor|rebalanc)/i }
]);

const RISK_BANDS = [
  { id: 'conservative', re: /(محافظه[\s\u200c]*کار|کم[\s\u200c]*ریسک|ریسک[\s\u200c]*پایین|conservative|low risk)/i },
  { id: 'aggressive', re: /(تهاجمی|ریسک[\s\u200c]*پذیر|پرریسک|ریسک[\s\u200c]*بالا|aggressive|high risk|risk[- ]on)/i },
  { id: 'balanced', re: /(متعادل|میانه|balanced|moderate)/i }
];

/*
 * The router tags `strategy` only when an intent classifier says STRATEGY or the
 * turn is HIGH_STAKES. A plain «چطور سرمایه‌ام را تقسیم کنم؟» therefore reached
 * the panel as a generic reasoning question and never met the strategy engine.
 * This is the deterministic fallback, used ONLY by the smartest mode, so no
 * other mode gains a role or a call.
 */
const STRATEGY_REQUEST_RE = /(استراتژی|استراتژي|برنامه[\s\u200c]*(?:ٔ\s*)?سرمایه|برنامه[\s\u200c]*سرمایه[\s\u200c]*گذاری|تخصیص[\s\u200c]*(?:سرمایه|دارایی)|(?:چطور|چگونه|how\s+should\s+i).{0,80}(?:تقسیم|split|allocate|پخش)|پلکانی|پله[\s\u200c]*ای|DCA|dollar[\s-]?cost|سرمایه[\s\u200c]*گذاری[\s\u200c]*بلند|allocation|rebalanc|position[\s-]?sizing|investment\s+plan|money\s+management|risk\s+per\s+trade|مدیریت[\s\u200c]*سرمایه)/i;

export function detectStrategyRequest(message) {
  return STRATEGY_REQUEST_RE.test(String(message || ''));
}

/*
 * ─── GOAL MATH ──────────────────────────────────────────────────────────────
 * «۲۰٪ سود در ۶ ماه» is a number a professor turns into an obligation before
 * anything else: 3.1% a month compounded, ~44% annualised, and after the
 * round-trip fee the gross target is higher still. That arithmetic is exact,
 * so it is computed here instead of being left to the model's intuition — and
 * when the horizon or the target is missing, it is a named gap.
 */
const WORD_NUMBERS = { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12, 'هجده': 18, 'بیست': 20, 'بیست و چهار': 24 };

function wordNumbersToDigits(text) {
  let out = text;
  /* Longest first, and never inside another word: «دوازده» must not become
     «دواز» + «ده». */
  const entries = Object.entries(WORD_NUMBERS).sort((a, b) => b[0].length - a[0].length);
  for (const [word, value] of entries) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`(?<![\\p{L}])${escaped}\\s*(?=(?:ماه|ماهه|سال|هفته|روز|month|year|week|day))`, 'gu'),
      `${value} `
    );
  }
  return out;
}

function parseGoal(message, feeRoundTripPct) {
  const text = wordNumbersToDigits(normalizeDigits(String(message || '')).replace(/\u200c/g, ''));
  const targetMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)\s*(?:سود|بازده|رشد|سالیانه|profit|return|gain)/i)
    || text.match(/(?:سود|بازده|رشد|profit|return|gain)\D{0,20}(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)/i)
    || text.match(/(?:هدف|target)\D{0,12}(\d+(?:\.\d+)?)\s*(?:٪|%|درصد)/i);
  const horizonMatch = text.match(/(\d+)\s*(ماه|ماهه|ماه‌|سال|هفته|روز|month|months|year|years|week|weeks|day|days)/i);
  const targetPct = targetMatch ? Number(targetMatch[1]) : null;
  let months = null;
  if (horizonMatch) {
    const n = Number(horizonMatch[1]);
    const unit = horizonMatch[2].toLowerCase();
    if (/سال|year/.test(unit)) months = n * 12;
    else if (/هفته|week/.test(unit)) months = (n * 7) / 30.44;
    else if (/روز|day/.test(unit)) months = n / 30.44;
    else months = n;
  }
  const usable = targetPct != null && targetPct > 0 && targetPct <= 1000 && months != null && months > 0 && months <= 600;
  if (!usable) return { targetPct: usable ? targetPct : null, months: usable ? months : null, gaps: true };
  const growth = 1 + targetPct / 100;
  const requiredMonthlyPct = round((growth ** (1 / months) - 1) * 100, 2);
  const requiredAnnualPct = round((growth ** (12 / months) - 1) * 100, 2);
  return {
    targetPct,
    months: round(months, 2),
    requiredMonthlyPct,
    requiredAnnualPct,
    grossTargetPct: round(targetPct + feeRoundTripPct, 2),
    gaps: false
  };
}

function detectRiskBand(message) {
  const text = String(message || '');
  for (const band of RISK_BANDS) if (band.re.test(text)) return band.id;
  return null;
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Build the factual frame for a strategy turn.
 * @param {{context?: object, message?: string}} params
 */
export function buildStrategyFrame({ context = {}, message = '' } = {}) {
  const gaps = [];
  const portfolio = context?.portfolio || null;
  const capitalUsd = Number.isFinite(Number(portfolio?.totalValueUsd)) && Number(portfolio.totalValueUsd) > 0
    ? round(Number(portfolio.totalValueUsd), 2)
    : null;
  if (capitalUsd == null) gaps.push('capital');

  const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const weights = capitalUsd
    ? holdings
      .map((h) => ({
        symbol: String(h?.symbol || '').toUpperCase(),
        valueUsd: Number.isFinite(Number(h?.valueUsd)) ? round(Number(h.valueUsd), 2) : null,
        weightPct: Number.isFinite(Number(h?.valueUsd)) ? round((Number(h.valueUsd) / capitalUsd) * 100, 2) : null
      }))
      .filter((h) => h.symbol && h.weightPct != null)
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, 8)
    : [];
  if (!weights.length) gaps.push('weights');

  const topWeightPct = weights.length ? weights[0].weightPct : null;
  const concentration = topWeightPct != null && topWeightPct >= 50 ? 'high'
    : topWeightPct != null && topWeightPct >= 30 ? 'moderate' : topWeightPct != null ? 'low' : null;

  const priceMap = context?.market?.priceMap && typeof context.market.priceMap === 'object'
    ? Object.keys(context.market.priceMap).slice(0, 20)
    : [];
  if (!priceMap.length) gaps.push('live_prices');
  if (context?.market?.dataStatus && context.market.dataStatus !== 'live') gaps.push('stale_market_data');

  const riskBand = detectRiskBand(message);
  if (!riskBand) gaps.push('risk_band');
  if (!/(ماه|سال|هفته|بلندمدت|کوتاه|horizon|month|year|week)/i.test(String(message || ''))) gaps.push('horizon');

  /* The one cost every plan pays, whether or not the model mentions it. */
  const feeBps = Number(FEE_BPS) || 0;
  const feeRoundTripPct = round((feeBps * 2) / 100, 2);

  const parsedGoal = parseGoal(message, feeRoundTripPct);
  const goal = parsedGoal && !parsedGoal.gaps ? parsedGoal : null;
  if (!goal) gaps.push('goal');
  if (goal) delete goal.gaps;

  return {
    schema: STRATEGY_FRAME_SCHEMA,
    capitalUsd,
    weights,
    topWeightPct,
    concentration,
    priceSymbols: priceMap,
    riskBand,
    goal,
    feeBps,
    feeRoundTripPct,
    policy: {
      maxLeverage: DEFAULT_POLICY_CAPS.maxLeverage,
      maxSlippagePct: DEFAULT_POLICY_CAPS.maxSlippagePct,
      maxTransactionUsd: DEFAULT_POLICY_CAPS.maxTransactionUsd
    },
    gaps,
    complete: capitalUsd != null && weights.length > 0 && riskBand != null
  };
}

/**
 * The prompt block. Empty when there is no frame (non-strategy turns), so no
 * other answer pays for this.
 */
export function renderStrategyFrame(frame) {
  if (!frame || frame.schema !== STRATEGY_FRAME_SCHEMA) return '';
  const lines = [
    'STRATEGY FRAME (computed facts — the ONLY numbers a plan may treat as given; everything else must be stated as an assumption):'
  ];
  if (frame.capitalUsd != null) lines.push(`- investable capital (aggregate): $${frame.capitalUsd}`);
  if (frame.weights.length) {
    lines.push(`- current weights: ${frame.weights.map((w) => `${w.symbol} ${w.weightPct}%`).join(', ')}`);
    if (frame.concentration) lines.push(`- concentration: ${frame.concentration} (largest position ${frame.topWeightPct}%)`);
  }
  if (frame.priceSymbols.length) lines.push(`- live prices available for: ${frame.priceSymbols.join(', ')}`);
  if (frame.riskBand) lines.push(`- the user's stated risk posture: ${frame.riskBand} (do not re-label it; state the drawdown assumption it implies)`);
  lines.push(`- platform fee: ${frame.feeBps} bps per side → ${frame.feeRoundTripPct}% round trip. Any leg must clear this before it is worth doing.`);
  lines.push(`- policy caps that a plan may not exceed: leverage ≤ ${frame.policy.maxLeverage}×, slippage ≤ ${frame.policy.maxSlippagePct}%, single transaction ≤ $${frame.policy.maxTransactionUsd}`);
  if (frame.goal) {
    lines.push(`- GOAL MATH (computed from the user's own words): +${frame.goal.targetPct}% over ${frame.goal.months} months = `
      + `${frame.goal.requiredMonthlyPct}%/month compounded ≈ ${frame.goal.requiredAnnualPct}% annualised; `
      + `after a ${frame.feeRoundTripPct}% round trip the strategy must earn ≈ ${frame.goal.grossTargetPct}% gross. `
      + 'State plainly whether the evidence supports that, and do not round the obligation away.');
  }
  if (frame.gaps.length) {
    lines.push(`- NOT READ (do not guess these; name them as what the plan is missing): ${frame.gaps.join(', ')}`);
  }
  lines.push('Build a conditional PLAN, not an opinion. Every leg needs a size, an entry condition and an invalidation level. FBT never executes: present options and their trade-offs.');
  return lines.join('\n');
}

/** The eight sections, told to the model BEFORE it writes. */
export function renderStrategyRubricContract() {
  const required = STRATEGY_RUBRIC.filter((r) => r.required).map((r) => r.id);
  return `STRATEGY RUBRIC (a strategy answer that omits any of these is unfinished): ${required.join(', ')}. `
    + 'For each: the objective and horizon, the risk budget and maximum tolerable drawdown, the size of every leg, the entry condition, the invalidation level, the cost (fees/slippage) and the bull/base/bear scenarios. '
    + 'Sizing must satisfy the arithmetic: position% × stop% ≤ the per-trade risk budget%, allocations must sum to ≤ 100%, a long stop must sit below its entry (and a short stop above it), and leverage may not exceed the policy cap. '
    + 'If the frame lacks an input, say which reading is missing instead of inventing it.';
}

/**
 * Check a draft against the rubric.
 * @returns {{schema, present: string[], missing: string[], score: number, complete: boolean}}
 */
export function checkStrategyRubric(text) {
  const body = String(text || '');
  const present = [];
  const missing = [];
  for (const section of STRATEGY_RUBRIC) {
    if (section.re.test(body)) present.push(section.id);
    else if (section.required) missing.push(section.id);
  }
  const requiredTotal = STRATEGY_RUBRIC.filter((r) => r.required).length;
  return {
    schema: 'fbt.ai-strategy-rubric.v1',
    present,
    missing,
    score: round(((requiredTotal - missing.length) / requiredTotal) * 100, 0),
    complete: missing.length === 0
  };
}

/** Reviewer-facing gaps. Empty when the draft is complete. */
export function renderStrategyGaps(rubric) {
  if (!rubric || !Array.isArray(rubric.missing) || !rubric.missing.length) return '';
  const labels = rubric.missing.map((id) => {
    const section = STRATEGY_RUBRIC.find((r) => r.id === id);
    return section ? `${id} (${section.en})` : id;
  });
  return `STRATEGY SECTIONS MISSING FROM THE DRAFT — add each one, using only the frame's numbers, or say which reading is unavailable:\n${labels.join('\n')}`;
}

export default buildStrategyFrame;
