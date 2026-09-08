/**
 * FBT FINANCIAL INTELLIGENCE OS — Confidence Engine (§18).
 * ---------------------------------------------------------------------------
 * Six separate confidences, each DERIVED from something measurable:
 *
 *   intent      how well the sentence was classified (brain's own confidence,
 *               or 0 when the intent was not classified)
 *   data        provenance coverage + freshness of the financial state
 *   research    evidence quality behind the research bundle
 *   strategy    evidence quality of the selected strategy
 *   risk        whether a risk assessment actually ran on live state
 *   execution   quote freshness + wallet + capability + policy readiness
 *
 * `overall` is NOT an average. For anything that moves money the weakest of
 * (data, risk, execution) caps it, because a confident answer on stale balances
 * is worse than no answer. No dimension is ever reported to more than two
 * decimals, and a dimension with nothing behind it is 0 — never a baseline.
 */
import { round } from '../../src/lib/central/schema.js';
import { FRESHNESS } from './provenance.js';

export const CONFIDENCE_SCHEMA = 'fbt.fi.confidence.v1';

export const CONFIDENCE_DIMENSIONS = Object.freeze([
  'intent', 'data', 'research', 'strategy', 'risk', 'execution'
]);

/** What must be non-zero before an execution may be considered. */
export const CRITICAL_FOR_EXECUTION = Object.freeze(['data', 'risk', 'execution']);

const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : 0);

export function intentConfidence(intent = null) {
  if (!intent) return { value: 0, basis: 'NO_INTENT' };
  const raw = Number(intent.confidence);
  if (!Number.isFinite(raw)) return { value: 0, basis: 'INTENT_NOT_CLASSIFIED' };
  const pct = raw > 1 ? raw / 100 : raw;
  return { value: round(Math.max(0, Math.min(1, pct)), 2), basis: `classifier ${intent.classificationSource || intent.intentType || 'unknown'}` };
}

export function dataConfidence({ financial = null, world = null } = {}) {
  const coverage = Number(world?.provenance?.coverage ?? financial?.provenance?.coverage);
  const base = Number(financial?.confidence);
  if (!Number.isFinite(coverage) && !Number.isFinite(base)) return { value: 0, basis: 'NO_STATE_READ' };
  const stale = (world?.provenance?.stale?.length || 0) + (financial?.provenance?.stale?.length || 0);
  const unavailable = (world?.provenance?.unavailable?.length || 0);
  const value = round(Math.max(0, Math.min(1, (num(base) * 0.6 + num(coverage) * 0.4) - stale * 0.04 - unavailable * 0.01)), 2);
  return { value, basis: `state confidence ${num(base)}, provenance coverage ${num(coverage)}, ${stale} stale, ${unavailable} unavailable` };
}

export function researchConfidence(research = null) {
  if (!research) return { value: 0, basis: 'NO_RESEARCH' };
  if (research.status === 'UNAVAILABLE') return { value: 0, basis: 'RESEARCH_UNAVAILABLE' };
  const conf = Number(research.confidence);
  const partialPenalty = research.status === 'PARTIAL' ? 0.1 : 0;
  return { value: round(Math.max(0, num(conf) - partialPenalty), 2), basis: `${research.evidence?.length || 0} evidence rows, status ${research.status}` };
}

export function strategyConfidence(strategy = null, competition = null) {
  if (!strategy) return { value: 0, basis: 'NO_STRATEGY_SELECTED' };
  const quality = String(strategy.evidenceQuality?.status || 'insufficient-evidence');
  if (quality !== 'observed') return { value: 0.15, basis: `evidence ${quality}` };
  const sample = Number(strategy.evidenceQuality?.sampleSize) || 0;
  const sampleFactor = Math.min(1, sample / 30);
  const declared = num(strategy.confidencePct !== null && strategy.confidencePct !== undefined ? strategy.confidencePct / 100 : null);
  const vetoed = competition?.judge?.rejected?.some((r) => r.strategyId === strategy.id) ? 0.3 : 0;
  return { value: round(Math.max(0, Math.min(0.95, (declared || 0.5) * (0.5 + sampleFactor * 0.5)) - vetoed), 2), basis: `evidence observed, ${sample} samples` };
}

export function riskConfidence(risk = null, { stateFresh = false } = {}) {
  if (!risk) return { value: 0, basis: 'NO_RISK_ASSESSMENT' };
  if (risk.status === 'UNAVAILABLE' || risk.level === null) return { value: 0, basis: 'RISK_UNAVAILABLE' };
  const signals = Array.isArray(risk.securitySignals) ? risk.securitySignals.length : 0;
  const value = round(Math.max(0, Math.min(0.95, 0.85 - signals * 0.1 + (stateFresh ? 0.05 : 0))), 2);
  return { value, basis: `level ${risk.level}, ${signals} security signals${stateFresh ? ', state fresh' : ', state not fresh'}` };
}

export function executionConfidence({ quote = null, wallet = null, capabilities = null, policy = null, now = Date.now() } = {}) {
  const reasons = [];
  let value = 0;
  if (!quote) reasons.push('no quote');
  else {
    const ageMs = now - Number(quote.at || quote.quotedAt || 0);
    const ttl = Number(quote.ttlMs || 90_000);
    if (ageMs > ttl) reasons.push(`quote expired ${Math.round((ageMs - ttl) / 1000)}s ago`);
    else value += 0.45 * (1 - ageMs / ttl);
    if (quote.executable === false) reasons.push('quote is not executable');
    else value += 0.15;
  }
  if (!wallet?.connected) reasons.push('wallet not connected');
  else value += 0.15;
  const cap = capabilities && typeof capabilities === 'object' ? capabilities.swap || capabilities.bridge : null;
  if (cap && ['UNAVAILABLE', 'INCOMPLETE'].includes(String(cap))) reasons.push(`capability ${cap}`);
  else if (cap) value += 0.1;
  if (policy && policy.ok === false) reasons.push(`policy ${policy.code || 'failed'}`);
  else if (policy?.ok === true) value += 0.15;
  return { value: round(Math.max(0, Math.min(0.95, value)), 2), basis: reasons.length ? reasons.join('; ') : 'quote, wallet, capability and policy all ready' };
}

/**
 * Combine the dimensions. `executionRequested` switches on the hard rule that
 * the weakest critical input caps the answer.
 */
export function overallConfidence(parts = {}, { executionRequested = false } = {}) {
  const values = {};
  for (const dim of CONFIDENCE_DIMENSIONS) values[dim] = num(parts[dim]?.value);
  const measured = CONFIDENCE_DIMENSIONS.filter((d) => values[d] > 0);
  const weights = { intent: 0.15, data: 0.25, research: 0.15, strategy: 0.2, risk: 0.15, execution: 0.1 };
  const weighted = measured.reduce((a, d) => a + values[d] * weights[d], 0) / Math.max(0.0001, measured.reduce((a, d) => a + weights[d], 0));
  const critical = CRITICAL_FOR_EXECUTION.map((d) => values[d]);
  const cap = Math.min(...critical);
  const value = round(executionRequested ? Math.min(weighted, cap) : Math.min(weighted, 0.95), 2);
  const blockers = executionRequested ? CRITICAL_FOR_EXECUTION.filter((d) => values[d] === 0) : [];
  return {
    schema: CONFIDENCE_SCHEMA,
    overall: value,
    dimensions: values,
    parts,
    measured: measured.length,
    executionRequested,
    cappedBy: executionRequested ? CRITICAL_FOR_EXECUTION[critical.indexOf(cap)] : null,
    blockers,
    actionable: !executionRequested || blockers.length === 0,
    /* Two decimals, and a note that this is a quality measure, not a
       probability of profit. */
    fakePrecisionAvoided: true,
    note: 'confidence describes the quality of the inputs, not the chance of a profit'
  };
}

export function createConfidenceEngine({ log = () => {} } = {}) {
  function assess({ intent = null, financial = null, world = null, research = null, strategy = null, competition = null, risk = null, quote = null, wallet = null, capabilities = null, policy = null, executionRequested = false, now = Date.now() } = {}) {
    const parts = {
      intent: intentConfidence(intent),
      data: dataConfidence({ financial, world }),
      research: researchConfidence(research),
      strategy: strategyConfidence(strategy, competition),
      risk: riskConfidence(risk, { stateFresh: world?.provenance?.stale?.length === 0 }),
      execution: executionConfidence({ quote, wallet, capabilities, policy, now })
    };
    return overallConfidence(parts, { executionRequested });
  }
  return { schema: CONFIDENCE_SCHEMA, assess, dimensions: CONFIDENCE_DIMENSIONS };
}

export { FRESHNESS };
