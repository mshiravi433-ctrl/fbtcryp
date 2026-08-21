/** Remaining Phase 2/3 boundaries. Pure, fail-closed validation only. */
export const SCHEMAS = Object.freeze({ portfolioAgent: 'fbt.portfolio-agent.v1', revenueEvent: 'fbt.revenue-event.v1', certification: 'fbt.certification.v1', reputation: 'fbt.reputation-graph.v1' });
const finite = (x) => Number.isFinite(Number(x));
export function validatePortfolioAgent(input = {}) {
  const p = input.permissions || {}; const r = input.rebalance || {};
  if (input.schema !== SCHEMAS.portfolioAgent || !Array.isArray(input.allocations) || !input.allocations.length) return { ok: false, code: 'INVALID_PORTFOLIO_AGENT' };
  if (p.executeWithoutUser === true || p.withdrawFunds === true) return { ok: false, code: 'FORBIDDEN_PERMISSION' };
  if (!finite(r.maxTradeUsd) || Number(r.maxTradeUsd) <= 0 || !finite(r.maxSlippageBps) || Number(r.maxSlippageBps) < 0) return { ok: false, code: 'BOUNDS_REQUIRED' };
  return { ok: true, value: { ...input, permissions: { ...p, executeWithoutUser: false, withdrawFunds: false }, rebalance: { ...r, mode: 'approval_required' } } };
}
export function validateRevenueEvent(input = {}) { if (input.schema !== SCHEMAS.revenueEvent || !input.projectId || input.status !== 'unavailable') return { ok: false, code: 'REVENUE_NOT_CONFIGURED' }; return { ok: true, value: { ...input, grossAmount: null, platformShare: null, developerShare: null } }; }
export function validateCertification(input = {}) { if (input.schema !== SCHEMAS.certification || !input.subjectId || !input.certificationType || !input.issuer || !input.issuedAt) return { ok: false, code: 'INVALID_CERTIFICATION' }; if (input.status === 'active' && !Array.isArray(input.evidence)) return { ok: false, code: 'EVIDENCE_REQUIRED' }; return { ok: true }; }
export function reputationRelationship(input = {}) { const sample = Number(input.sampleSize); if (!Number.isInteger(sample) || sample < 5) return { ...input, count: null, successRate: null, confidence: 'none', status: 'insufficient_data' }; return { ...input, confidence: input.confidence || 'low', status: 'observed' }; }
