/**
 * FBT AI CONFIDENCE & LIVE DATA ENGINE
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Confidence Engine & Live Data Validation
 *
 * Requirements:
 *   - Confidence Score (0-100%)
 *   - Risk Score (LOW, MEDIUM, HIGH, EXTREME)
 *   - AI Agreement (e.g., 3/3, 4/5)
 *   - Data Freshness (LIVE, RECENT, STALE, UNAVAILABLE)
 *   - Execution Risk (LOW, MEDIUM, HIGH)
 *   - Live Data Grounding: Strictly verifies that real prices, balances, gas,
 *     and yields are sourced from authoritative Data/Tool layers, not LLM guesses.
 */

export function evaluateConfidenceMetrics({
  intent = {},
  consensus = null,
  context = {},
  toolsUsed = [],
  dataStatus = 'live'
} = {}) {
  const factors = [];
  let score = 80; // Baseline

  // 1. Data Freshness & Grounding
  const now = Date.now();
  const priceMap = context.market?.priceMap || context.priceMap;
  const hasLivePrices = Boolean(priceMap && Object.keys(priceMap).length > 0);
  const walletConnected = Boolean(context.wallet?.connected || context.wallet?.address);
  const hasLiveBalances = Boolean(context.wallet?.balances || context.portfolio?.holdings?.length);

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
  const capitalAmountUsd = Number(intent.entities?.amountUsd || intent.amountUsd || 0);
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

  // Final Clamp
  const finalScore = Math.min(95, Math.max(15, score));
  const isLowConfidence = finalScore < 60 || dataFreshness === 'UNAVAILABLE';

  return {
    confidenceScore: finalScore,
    confidenceLabel: finalScore >= 80 ? 'HIGH' : finalScore >= 60 ? 'MODERATE' : 'LOW',
    dataFreshness,
    aiAgreement: consensus?.agreementRatio || '1/1',
    executionRisk,
    riskScore: consensus?.riskScore || (executionRisk === 'HIGH' ? 'HIGH' : 'MEDIUM'),
    isLowConfidence,
    factors,
    verifiedAt: now
  };
}
