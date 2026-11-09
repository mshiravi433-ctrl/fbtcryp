/**
 * FBT AI — ECONOMIST'S LENS (smartest mode)
 * ---------------------------------------------------------------------------
 * The smartest mode was deep but still spoke like a market commentator: it
 * described the move, hedged, and stopped. A professor of economics does
 * something different — and it is *checkable*, not a personality sketch:
 *
 *   · names the mechanism (supply/demand, incentives, liquidity, rates,
 *     opportunity cost) and says who pays for the outcome;
 *   · gives the base rate before the specific story;
 *   · traces the transmission channel instead of asserting a link;
 *   · separates the short-run move from the long-run constraint;
 *   · asks whose incentives shape the claim being repeated;
 *   · states the observation that would falsify the view.
 *
 * This module selects the lenses a question actually needs — deterministically,
 * from the question text and the router's task types — and renders them as a
 * prompt contract. No model call, no numbers, no execution authority.
 *
 * `balanced` and `swift` never receive it (their prompts stay byte-identical).
 */

export const ECONOMIST_LENS_SCHEMA = 'fbt.ai-economist-lens.v1';

/** Canonical order: the renderer follows this, so the prompt is stable. */
export const LENS_ORDER = [
  'MECHANISM',
  'BASE_RATE',
  'TRANSMISSION',
  'REFLEXIVITY',
  'INCENTIVES',
  'OPPORTUNITY_COST',
  'TIME_HORIZON',
  'FALSIFIER'
];

const LENS_TEXT = {
  MECHANISM: 'name the mechanism (supply/demand, incentives, liquidity, rates, opportunity cost) and say who pays for the outcome — not just what the price did',
  BASE_RATE: 'give the base rate first: what usually happens in this situation, before the specific story — a story that beats the base rate needs evidence',
  TRANSMISSION: 'trace the channel explicitly (policy → funding costs → risk appetite → price, or news → flows → price); do not assert a link you cannot walk through',
  REFLEXIVITY: 'account for reflexivity: price moves change narratives and positioning, and that changes price — say which direction the loop is running',
  INCENTIVES: 'ask whose incentives shape the claim or the product (issuer, exchange, influencer, fee earner) and how that would bias what you are told',
  OPPORTUNITY_COST: 'state the opportunity cost: what the user gives up by holding or doing this instead of the alternative, including the risk-free option',
  TIME_HORIZON: 'separate the short-run move from the long-run constraint, and say which horizon your conclusion is true for',
  FALSIFIER: 'state the observation that would prove you wrong — a view that cannot be falsified is not an analysis'
};

const KEYWORDS = [
  { lens: 'TRANSMISSION', re: /(نرخ\s*بهره|تورم|فدرال|فد|بانک\s*مرکزی|سیاست\s*پولی|اقتصاد\s*کلان|ماکرو|رکود|نقدینگی|macro|inflation|\bfed\b|central bank|rate (cut|hike)|\bgdp\b|recession|liquidity)/i },
  { lens: 'INCENTIVES', re: /(کارمزد|کمیسیون|اپلیکیشن|محصول|اشتراک|پاداش|استیکینگ|سود\s*سپرده|\bfee\b|commission|subscription|reward|staking|\bapy\b|\byield\b|product|platform)/i },
  { lens: 'OPPORTUNITY_COST', re: /(سبد|تخصیص|وزن|تنوع|پرتفوی|portfolio|allocation|diversif|rebalanc)/i },
  { lens: 'TIME_HORIZON', re: /(بلندمدت|کوتاه\s*مدت|افق|long[-\s]?term|short[-\s]?term|horizon|drawdown|لوریج|leverage)/i }
];

const TASK_LENSES = {
  market: ['BASE_RATE', 'REFLEXIVITY'],
  'crypto-analysis': ['BASE_RATE', 'REFLEXIVITY'],
  strategy: ['BASE_RATE', 'TIME_HORIZON'],
  risk: ['OPPORTUNITY_COST', 'TIME_HORIZON'],
  portfolio: ['OPPORTUNITY_COST'],
  news: ['TRANSMISSION', 'INCENTIVES'],
  macro: ['TRANSMISSION', 'TIME_HORIZON'],
  verification: ['FALSIFIER']
};

/**
 * Pick the lenses for one question.
 * @param {{message?: string, taskTypes?: string[], intentType?: string|null}} params
 * @returns {string[]} lens ids, canonical order, 2–4 items
 */
export function selectEconomicLenses({ message = '', taskTypes = [], intentType = null } = {}) {
  const text = String(message || '');
  if (!text.trim()) return [];

  const picked = new Set(['MECHANISM']);

  for (const t of Array.isArray(taskTypes) ? taskTypes : []) {
    for (const lens of TASK_LENSES[String(t).toLowerCase()] || []) picked.add(lens);
  }
  if (intentType) {
    for (const lens of TASK_LENSES[String(intentType).toLowerCase()] || []) picked.add(lens);
  }
  for (const { lens, re } of KEYWORDS) if (re.test(text)) picked.add(lens);

  /* FALSIFIER is always last and always present: the professor's signature. */
  picked.add('FALSIFIER');

  const ordered = LENS_ORDER.filter((id) => picked.has(id));
  /* Keep the prompt bounded: four lenses with FALSIFIER preserved. */
  if (ordered.length <= 4) return ordered;
  const head = ordered.filter((id) => id !== 'FALSIFIER').slice(0, 3);
  return LENS_ORDER.filter((id) => head.includes(id) || id === 'FALSIFIER');
}

/**
 * The prompt contract. Empty string when no lens was selected, so nothing is
 * added to a turn that did not ask for economic reasoning.
 */
export function renderEconomistLens(lenses) {
  const ids = Array.isArray(lenses) ? LENS_ORDER.filter((id) => lenses.includes(id)) : [];
  if (!ids.length) return '';
  const lines = ids.map((id) => `- ${id}: ${LENS_TEXT[id]}`);
  return [
    "ECONOMIST'S LENS (FBT smartest mode — reason like a professor of economics, not a price commentator):",
    ...lines,
    'Write like a professor to a smart student: define the terms you use, give one concrete example, and keep jargon only where it is precise. These are reasoning obligations, not decoration — if the evidence cannot support one of them, say which reading is missing instead of inventing it.'
  ].join('\n');
}

/** The persona record published with the reply. */
export function economistPersona(lenses) {
  const ids = Array.isArray(lenses) ? LENS_ORDER.filter((id) => lenses.includes(id)) : [];
  if (!ids.length) return null;
  return { schema: ECONOMIST_LENS_SCHEMA, id: 'economist', lenses: ids };
}

export default selectEconomicLenses;
