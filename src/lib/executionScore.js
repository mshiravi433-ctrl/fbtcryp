import { scoreRoutes } from './intentRoutePolicy';
export const EXECUTION_SCORE_SCHEMA = 'fbt.execution-score.v1';
const DIMENSIONS = ['price', 'liquidity', 'gas', 'slippage', 'latency', 'mevProtection'];
const finite = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;
export function executionScore(candidate, candidates = [candidate]) {
  const dimensions = Object.fromEntries(DIMENSIONS.map((name) => [name, { score: null, available: false, reason: 'Evidence not available' }]));
  const evidence = [];
  const row = candidate && typeof candidate === 'object' ? candidate : {};
  if (finite(row.amountOutUsd)) { dimensions.price = { score: null, available: true, reason: 'Compared by existing route policy' }; evidence.push('observed amountOutUsd'); }
  if (finite(row.gasUsd)) { dimensions.gas = { score: null, available: true, reason: 'Observed gas estimate' }; evidence.push('observed gasUsd'); }
  if (finite(row.slippagePct ?? row.slippage)) { dimensions.slippage = { score: null, available: true, reason: 'Quote slippage' }; evidence.push('quote slippage'); }
  if (finite(row.latencyMs)) { dimensions.latency = { score: null, available: true, reason: 'Observed response latency' }; evidence.push('observed latencyMs'); }
  if (finite(row.liquidity)) { dimensions.liquidity = { score: null, available: true, reason: 'Observed quote liquidity' }; evidence.push('observed liquidity'); }
  if (row.mevProtectionEvidence) { dimensions.mevProtection = { score: null, available: true, reason: 'Provider evidence supplied' }; evidence.push('MEV evidence'); }
  let ranked = null;
  try { ranked = scoreRoutes(candidates, { now: Date.now() }); } catch { ranked = null; }
  const comparable = ranked?.ranked?.some((x) => String(x.solver) === String(row.solver || row.source));
  const available = evidence.length > 0 && comparable;
  return { schema: EXECUTION_SCORE_SCHEMA, score: available ? null : null, confidence: evidence.length >= 3 && comparable ? 'low' : evidence.length ? 'none' : 'none', dimensions, methodology: { version: 'v1', weights: {}, normalized: true }, evidence, limitations: ['This score is a scaffold until a validated scoring calibration and complete evidence set exist.', 'It is not a guarantee of execution, profit, safety or best execution.'] };
}
