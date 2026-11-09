/**
 * THE CRYPTO PROFESSOR — how to write like a researcher, not like a feed.
 * ---------------------------------------------------------------------------
 * The economist lens (server/aiEconomistLens.js) governs REASONING: mechanism,
 * base rate, transmission channel, incentives, opportunity cost, horizon,
 * falsifiability. This module governs two different things that a professor of
 * cryptocurrency does and a market feed does not:
 *
 *   1. PEDAGOGY — define a term before using it, show one concrete example,
 *      name the established concept instead of inventing a phrase, and put a
 *      RANGE on uncertainty rather than a point estimate.
 *   2. SOURCING — say where a number came from (tool read, primary source,
 *      secondary report, model inference) instead of presenting all four in
 *      the same voice.
 *
 * And one thing that is ENFORCED rather than requested: a forward-looking
 * claim must carry its FALSIFIER — the observation that would prove it wrong.
 * "BTC will reach 120k" is a horoscope; "…unless the funding rate stays
 * negative for a week" is a research claim. `checkFalsifier` is deterministic
 * and runs on the draft and on the final text, so a forecast without a
 * disconfirming condition becomes a MUST-FIX for the reviewer.
 *
 * No model call, no invented fact, and nothing here runs outside `max`.
 */

export const PROFESSOR_SCHEMA = 'fbt.ai-professor.v1';
export const PROFESSOR_VERSION = '1.0.0';

export const PROFESSOR_LENSES = Object.freeze({
  DEFINE_TERMS: Object.freeze({
    id: 'DEFINE_TERMS',
    line: 'define every non-obvious term in one clause the first time you use it (MVRV, funding, MEV, TVL, slippage) — a reader should not have to leave the answer to understand it.'
  }),
  DATA_PROVENANCE: Object.freeze({
    id: 'DATA_PROVENANCE',
    line: 'say where each material number comes from — a tool read, a primary document, a secondary report, or your own inference — and never let inference wear the clothes of data.'
  }),
  BASE_RATE: Object.freeze({
    id: 'BASE_RATE',
    line: 'when a relevant, reliable base rate and sample size are supplied, give them before the story; otherwise say the base rate is unknown, never invent one.'
  }),
  CONCRETE_EXAMPLE: Object.freeze({
    id: 'CONCRETE_EXAMPLE',
    line: 'where useful attach a worked example; use supplied numbers or clearly label hypothetical numbers, never present them as live observations.'
  }),
  UNCERTAINTY_RANGE: Object.freeze({
    id: 'UNCERTAINTY_RANGE',
    line: 'state uncertainty as a range with the assumptions that set its ends, never as a single precise figure you cannot defend.'
  }),
  FALSIFIER: Object.freeze({
    id: 'FALSIFIER',
    line: 'end with what would change your mind: the observation, level or data point that would prove this reading wrong.'
  })
});

const LENS_ORDER = ['DEFINE_TERMS', 'DATA_PROVENANCE', 'BASE_RATE', 'UNCERTAINTY_RANGE', 'CONCRETE_EXAMPLE', 'FALSIFIER'];

/* What makes a message a place where a research posture earns its cost. */
const TECHNICAL_RE = [
  /mvrv|nupl|sopr|funding|open\s*interest|perpetual|\bfutures\b|basis\b|mev|liquidity|tvl|slippage|impermanent/i,
  /هش|هالوینگ|نقدینگی|عمق\s*بازار|فاندینگ|بهره|اسلیپیج|ناپایداری|ماینر/i,
  /protocol|tokenomics|vesting|unlock|emission|stak(?:e|ing)|validator/i,
  /وایت\s*پیپر|توکنومیک|آنلاک|استیکینگ|اعتبارسنج/i
];
const ACADEMIC_RE = [
  /چرا|چگونه|مقایسه|تفاوت|توضیح بده|تحلیل|دلیل|سازوکار|ریسک|سرمایه‌گذاری|استراتژی/i,
  /\bwhy\b|\bhow\b|\bcompare\b|\bexplain\b|\banaly[sz]e\b|\bstrategy\b|\brisk\b/i
];

/**
 * Which pedagogy lenses this turn needs.
 *
 * Narrow on purpose: a definition and a worked example are worth a paragraph
 * in a technical or analytical question and are noise in «سلام». `FALSIFIER`
 * is always included when the lenses are used at all.
 */
export function selectProfessorLenses({ message = '', taskTypes = [] } = {}) {
  const text = String(message || '');
  const technical = TECHNICAL_RE.some((re) => re.test(text));
  const analytical = ACADEMIC_RE.some((re) => re.test(text))
    || (Array.isArray(taskTypes) && taskTypes.some((t) => ['reasoning', 'research', 'strategy', 'market'].includes(t)));
  if (!technical && !analytical) return [];

  const wanted = new Set(['FALSIFIER', 'DATA_PROVENANCE']);
  if (technical) wanted.add('DEFINE_TERMS');
  if (analytical) wanted.add('BASE_RATE');
  if (/\d|[۰-۹]/.test(text) || /چقدر|چند|price|قیمت/i.test(text)) wanted.add('UNCERTAINTY_RANGE');
  if (wanted.has('DEFINE_TERMS') || technical) wanted.add('CONCRETE_EXAMPLE');

  const lenses = LENS_ORDER.filter((id) => wanted.has(id)).slice(0, 5);
  /* The falsifier is the point of the exercise; it never falls off the cap. */
  if (!lenses.includes('FALSIFIER')) lenses.push('FALSIFIER');
  return lenses;
}

/** The contract handed to the specialists and the synthesiser ('' when unused). */
export function renderProfessorContract(lenses = []) {
  const chosen = (Array.isArray(lenses) ? lenses : [])
    .map((id) => PROFESSOR_LENSES[id])
    .filter(Boolean);
  if (!chosen.length) return '';
  return [
    'RESEARCH POSTURE (write like a professor of this field, not like a market feed):',
    ...chosen.map((l) => `- ${l.line}`),
    '- Plain prose, no headings you would not say out loud, no hype adjectives, no promises. If the evidence cannot carry a claim, say which part is missing.'
  ].join('\n');
}

/* ── the enforced part ────────────────────────────────────────────────────── */

const FORECAST_RE = [
  /پیش[‌\s]*بینی/, /احتمال\s*(?:زیاد|بالا|کم)/, /(?:تا|در)\s*(?:هفته|ماه|سال)\s*(?:آینده|بعد|دیگر|دیگه)/,
  /(?:می\s*رسد|می\s*رسه|خواهد\s*رسید|میره\s*بالا|میاد\s*پایین)/, /هدف\s*(?:قیمتی|بعدی)/,
  /\bwill\s+(?:reach|hit|rise|fall|go)\b/i, /\bexpect(?:ed|s)?\b/i, /\bforecast\b/i, /\bby\s+(?:next|end of)\b/i, /\btarget\b/i
];

const FALSIFIER_RE = [
  /اگر\s*(?:[^.!?\n]{0,40})?(?:شود|شد|برسد|رسید|بیاید|بیاید|بشکند|بشکند|بماند|بماند)/,
  /اگر\s*(?:به|زیر|بالای)/, /در\s*صورتی\s*که/, /مگر\s*(?:اینکه|این)/,
  /(?:باطل|نقض|رد)\s*(?:می\s*شود|خواهد\s*شد)/, /این\s*(?:تحلیل|سناریو|فرض)\s*باطل/,
  /چه\s*چیزی\s*(?:این|نظر)/, /چه\s*چیزی\s*را\s*عوض/,
  /\bunless\b/i, /\binvalidat/i, /\bwould\s+(?:prove|show)\s+(?:me|this)\s+wrong\b/i,
  /\bif\s+[^.!?\n]{0,40}\b(?:falls?|drops?|closes?|stays?|breaks?)\b/i, /\bfalsif/i
];

/**
 * Does the answer make a forward-looking claim, and does it say what would
 * prove it wrong?
 *
 * `applicable` is false when the answer forecasts nothing: a factual read of
 * today's price owes no falsifier.
 */
export function checkFalsifier({ message = '', answer = '' } = {}) {
  const text = String(answer || '');
  const forecasts = FORECAST_RE.filter((re) => re.test(text));
  const asksForecast = FORECAST_RE.some((re) => re.test(String(message || '')));
  const applicable = text.trim().length > 0 && (forecasts.length > 0 || asksForecast);
  const hasFalsifier = FALSIFIER_RE.some((re) => re.test(text));
  const issues = [];
  if (applicable && !hasFalsifier) {
    issues.push({
      id: 'FORECAST_WITHOUT_FALSIFIER',
      severity: 'MEDIUM',
      detail: 'the answer makes a forward-looking claim without saying what would prove it wrong. Add the observation, level or data point that would invalidate the reading.'
    });
  }
  return {
    schema: PROFESSOR_SCHEMA,
    applicable,
    forecast: applicable,
    hasFalsifier,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft is clean). */
export function renderFalsifierDeficit(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `PROFESSOR DEFICIT (the answer is a forecast without a falsifier; fix it, do not soften it):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

export default selectProfessorLenses;
