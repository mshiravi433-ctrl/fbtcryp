/**
 * FBT INTENT OS — Confidence Engine & Live Data Grounding (Upgrade 4)
 * ---------------------------------------------------------------------------
 * Computes multi-factor confidence breakdown:
 *   - Intent Confidence (0..1)
 *   - Context Confidence (0..1)
 *   - Entity Confidence (0..1)
 *   - Execution Confidence (0..1)
 *   - Overall Confidence Score (0..100)
 *
 * Pre-Execution Checklist:
 *   Intent Check + Entity Check + Amount Check + Network Check + Wallet Check + Permission Check + Risk Check
 */

export const CONFIDENCE_ENGINE_SCHEMA = 'fbt.confidence-engine.v4';

export const CONFIDENCE_DECISION = {
  PROCEED_PLAN: 'PROCEED_PLAN',
  CONFIRM_INTERPRETATION: 'CONFIRM_INTERPRETATION',
  ASK_CLARIFICATION: 'ASK_CLARIFICATION'
};

export function calculateConfidenceBreakdown(intent = {}, context = {}) {
  const intentConf = intent.confidence ?? (intent.primaryIntent || intent.type ? 0.92 : 0.4);
  const hasConnectedWallet = Boolean(context.walletConnected || context.connected || context.wallet?.connected || context.walletState?.connected);
  const contextConf = hasConnectedWallet ? 0.95 : 0.75;

  const entities = intent.entities || {};
  let entityCount = 0;
  if (entities.token || entities.tokenIn || entities.tokenOut || entities.asset) entityCount++;
  if (entities.amount || entities.relativeAmount || entities.percentage) entityCount++;
  if (entities.chain || entities.network) entityCount++;
  const entityConf = entityCount >= 2 ? 0.95 : entityCount === 1 ? 0.75 : (intent.readOnly ? 0.9 : 0.5);

  const hasBalance = context.hasRequiredBalance !== false && (!context.walletBalances || !entities.tokenIn || (context.walletBalances[entities.tokenIn] !== undefined && context.walletBalances[entities.tokenIn] >= (entities.amount || 0)));
  const executionConf = (hasConnectedWallet && hasBalance && (entities.amount || intent.readOnly)) ? 0.95 : 0.65;

  // Weighted score: 35% intent, 25% entity, 20% context, 20% execution
  const overallScore = Math.round((intentConf * 0.35 + entityConf * 0.25 + contextConf * 0.20 + executionConf * 0.20) * 100);

  let decision = CONFIDENCE_DECISION.ASK_CLARIFICATION;
  if (overallScore >= 80) {
    decision = CONFIDENCE_DECISION.PROCEED_PLAN;
  } else if (overallScore >= 50) {
    decision = CONFIDENCE_DECISION.CONFIRM_INTERPRETATION;
  }

  return {
    overallScore,
    decision,
    breakdown: {
      intentConfidence: intentConf,
      entityCompleteness: entityConf,
      contextConfidence: contextConf,
      executionReadiness: executionConf
    }
  };
}

export function evaluatePreExecutionChecklist(intent = {}, context = {}) {
  const entities = intent.entities || {};
  const balances = context.balances || context.walletBalances || {};
  const tokenIn = entities.tokenIn || entities.token || entities.fromToken;
  const amount = Number(entities.amount || 0);

  const balanceAvailable = tokenIn ? Number(balances[tokenIn] ?? balances[tokenIn?.toUpperCase()] ?? balances[tokenIn?.toLowerCase()] ?? 0) : 0;
  const hasSufficientBalance = !amount || (balanceAvailable >= amount);

  const checks = [
    { name: 'intentResolved', passed: Boolean(intent.type && intent.type !== 'UNKNOWN'), description: 'Intent accurately parsed' },
    { name: 'entitiesResolved', passed: Boolean(tokenIn || intent.readOnly), description: 'Required token and destination entities resolved' },
    { name: 'amountValid', passed: Boolean(amount > 0 || entities.relativeAmount || intent.readOnly), description: 'Amount is positive and within boundary' },
    { name: 'walletConnected', passed: Boolean(context.connected || context.walletConnected || context.wallet?.connected), description: 'Execution wallet is active' },
    { name: 'signerPermission', passed: Boolean(context.canSign !== false), description: 'Signer permission granted' },
    { name: 'balanceSufficiency', passed: hasSufficientBalance, description: 'Source token balance is sufficient' },
    { name: 'riskSafetyPolicy', passed: Boolean(entities.riskTolerance !== 'prohibited'), description: 'Risk score conforms to policy limits' }
  ];

  const allPassed = checks.every(c => c.passed);
  return {
    allPassed,
    checks,
    failedChecks: checks.filter(c => !c.passed).map(c => c.name)
  };
}

export function createConfidenceEngine() {
  return {
    schema: CONFIDENCE_ENGINE_SCHEMA,

    evaluate({ intent = {}, consensus = null, context = {}, toolsUsed = [], dataStatus = 'live' } = {}) {
      const factors = [];
      let score = 85;

      const priceMap = context.market?.priceMap || context.priceMap;
      const hasLivePrices = Boolean(priceMap && Object.keys(priceMap).length > 0);

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

      const registeredToolsCount = Array.isArray(toolsUsed) ? toolsUsed.length : 0;
      if (registeredToolsCount > 0) {
        score += 5;
        factors.push({ name: 'TOOL_GROUNDING', bonus: +5, reason: 'Analysis grounded in live tool outputs' });
      }

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

      // Breakdown calculation
      const intentConf = intent.confidenceBreakdown?.intent ?? (intent.confidence || 0.9);
      const contextConf = intent.confidenceBreakdown?.context ?? (context.hasWallet ? 0.98 : 0.85);
      const entityConf = intent.confidenceBreakdown?.entity ?? (intent.entities?.token ? 0.95 : 0.7);
      const execConf = intent.confidenceBreakdown?.execution ?? ((intent.entities?.amount || intent.readOnly) ? 0.95 : 0.65);

      const finalScore = Math.min(98, Math.max(15, score));
      const isLowConfidence = finalScore < 60 || dataFreshness === 'UNAVAILABLE';

      // Pre-Execution Checklist
      const checklist = this.validatePreExecutionChecklist({ intent, context });

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
        checklist,
        verifiedAt: Date.now()
      };
    },

    /**
     * Pre-execution safety checklist (Spec §41)
     */
    validatePreExecutionChecklist({ intent = {}, context = {} } = {}) {
      const isReadOnly = Boolean(intent.readOnly || ['PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'MARKET_ANALYSIS', 'YIELD_DISCOVERY', 'NEWS_SEARCH'].includes(intent.type));
      if (isReadOnly) {
        return { ok: true, isReadOnly: true, checks: { intent: true, entity: true, amount: true, network: true, wallet: true, permission: true, risk: true } };
      }

      const hasIntent = Boolean(intent.type && intent.type !== 'UNKNOWN');
      const hasEntity = Boolean(intent.entities?.token || intent.entities?.toToken || intent.entities?.fromToken);
      const hasAmount = Boolean(intent.entities?.amount || intent.entities?.amountUsd || intent.entities?.amountPct || intent.entities?.isFuzzyAmount);
      const hasWallet = Boolean(context.wallet?.connected || context.walletState?.connected);
      const hasPermission = Boolean(context.wallet?.canSign !== false);
      const riskApproved = intent.entities?.riskTolerance !== 'prohibited';

      const ok = hasIntent && hasEntity && hasAmount && hasWallet && hasPermission && riskApproved;

      return {
        ok,
        isReadOnly: false,
        checks: {
          intent: hasIntent,
          entity: hasEntity,
          amount: hasAmount,
          network: true,
          wallet: hasWallet,
          permission: hasPermission,
          risk: riskApproved
        },
        missing: [
          !hasIntent && 'intent',
          !hasEntity && 'token',
          !hasAmount && 'amount',
          !hasWallet && 'wallet_connection'
        ].filter(Boolean)
      };
    }
  };
}

export const confidenceEngine = createConfidenceEngine();
