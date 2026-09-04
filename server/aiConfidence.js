/**
 * FBT AI CONFIDENCE & LIVE DATA ENGINE (Upgrade 4)
 * ---------------------------------------------------------------------------
 * Spec Phase 3 & Upgrade 4: Multi-AI Intelligence Upgrade — Confidence Engine & Live Data Validation
 *
 * Requirements:
 *   - Confidence Score (0-100%)
 *   - Confidence Breakdown (intent, context, entity, execution)
 *   - Decision Thresholds (PROCEED_PLAN, CONFIRM_INTERPRETATION, ASK_CLARIFICATION)
 *   - Pre-execution checklist (Intent, Entity, Amount, Network, Wallet, Permission, Risk)
 *   - Risk Score (LOW, MEDIUM, HIGH, EXTREME)
 *   - AI Agreement (e.g., 3/3, 4/5)
 *   - Data Freshness (LIVE, RECENT, STALE, UNAVAILABLE)
 *   - Execution Risk (LOW, MEDIUM, HIGH)
 */

export function evaluateConfidenceMetrics({
  intent = {},
  consensus = null,
  context = {},
  toolsUsed = [],
  dataStatus = 'live'
} = {}) {
  const factors = [];
  let score = 85; // Baseline

  // 1. Data Freshness & Grounding
  const now = Date.now();
  const priceMap = context.market?.priceMap || context.priceMap;
  const hasLivePrices = Boolean(priceMap && Object.keys(priceMap).length > 0);
  const walletConnected = Boolean(context.wallet?.connected || context.wallet?.address);

  let dataFreshness = 'LIVE';
  if (!hasLivePrices && ['SWAP', 'BUY', 'SELL', 'REBALANCE', 'INVESTMENT_PLAN'].includes(intent.type)) {
    dataFreshness = 'RECENT';
    score -= 15;
    factors.push({ name: 'DATA_FRESHNESS', penalty: -15, reason: 'Live price feed fallback active' });
  }

  if (dataStatus === 'unavailable' || context.portfolio?.dataStatus === 'unavailable') {
    dataFreshness = 'UNAVAILABLE';
    score -= 25;
    factors.push({ name: 'DATA_UNAVAILABLE', penalty: -25, reason: 'Some on-chain data sources unavailable' });
  }

  // 2. AI Consensus & Model Agreement
  let agreementScore = 1.0;
  if (consensus) {
    if (consensus.divergenceDetected) {
      score -= 20;
      agreementScore = 0.6;
      factors.push({ name: 'MODEL_DIVERGENCE', penalty: -20, reason: 'Models expressed conflicting market outlooks' });
    } else {
      score += 5;
      factors.push({ name: 'MODEL_CONVERGENCE', bonus: +5, reason: 'High alignment across AI intelligence providers' });
    }

    if (consensus.confidenceScore < 60) {
      score -= 15;
      factors.push({ name: 'LOW_MODEL_CONFIDENCE', penalty: -15, reason: 'Underlying models indicated market uncertainty' });
    }
  }

  // 3. Tool Grounding (Did we use real registered tools?)
  const registeredToolsCount = Array.isArray(toolsUsed) ? toolsUsed.length : 0;
  if (registeredToolsCount > 0) {
    score += 5;
    factors.push({ name: 'TOOL_GROUNDING', bonus: +5, reason: 'Analysis grounded in live tool outputs' });
  }

  // 4. Execution Risk Assessment
  let executionRisk = 'LOW';
  const capitalAmountUsd = Number(intent.entities?.amountUsd || intent.amountUsd || intent.entities?.amount || 0);
  const totalPortfolioUsd = Number(context.portfolio?.totalValueUsd || 0);

  if (intent.type === 'FUTURES' || intent.entities?.leverage > 2) {
    executionRisk = 'HIGH';
    score -= 15;
    factors.push({ name: 'LEVERAGE_RISK', penalty: -15, reason: 'Leveraged financial product involves liquidation risk' });
  } else if (totalPortfolioUsd > 0 && capitalAmountUsd > totalPortfolioUsd * 0.5) {
    executionRisk = 'MEDIUM';
    score -= 10;
    factors.push({ name: 'CONCENTRATION_RISK', penalty: -10, reason: 'Action utilizes >50% of detected portfolio' });
  }

  const intentConf = intent.confidenceBreakdown?.intent ?? (intent.confidence || 0.9);
  const contextConf = intent.confidenceBreakdown?.context ?? (walletConnected ? 0.98 : 0.85);
  const entityConf = intent.confidenceBreakdown?.entity ?? (intent.entities?.token ? 0.95 : 0.7);
  const execConf = intent.confidenceBreakdown?.execution ?? ((intent.entities?.amount || intent.readOnly) ? 0.95 : 0.65);

  const finalScore = Math.min(98, Math.max(15, score));
  const isLowConfidence = finalScore < 60 || dataFreshness === 'UNAVAILABLE';

  return {
    confidenceScore: finalScore,
    confidenceLabel: finalScore >= 90 ? 'VERY_HIGH' : finalScore >= 75 ? 'HIGH' : finalScore >= 60 ? 'MODERATE' : 'LOW',
    breakdown: {
      intent: intentConf,
      context: contextConf,
      entity: entityConf,
      execution: execConf
    },
    decision: finalScore >= 90 ? 'PROCEED_PLAN' : finalScore >= 70 ? 'CONFIRM_INTERPRETATION' : 'ASK_CLARIFICATION',
    dataFreshness,
    aiAgreement: consensus?.agreementRatio || '1/1',
    executionRisk,
    riskScore: consensus?.riskScore || (executionRisk === 'HIGH' ? 'HIGH' : 'MEDIUM'),
    isLowConfidence,
    factors,
    verifiedAt: now
  };
}
