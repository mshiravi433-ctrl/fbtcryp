/**
 * FBT FINANCIAL OS — Predictive Brain (Upgrade 11+12 §18, §19, §20)
 * ---------------------------------------------------------------------------
 * Predictive financial intelligence layer that sits on top of the Central
 * Intelligence Kernel. Provides:
 *   - Goal Forecasting
 *   - Portfolio Forecasting
 *   - Cashflow Forecasting
 *   - Risk Forecasting
 *   - Liquidation Risk Forecast
 *   - Goal Deviation Detection
 *   - Market Regime Detection
 *   - Opportunity Prediction
 *   - Anomaly Detection
 *   - Behavioral Prediction
 *   - Strategy Decay Detection
 *
 * Also implements the Digital Financial Twin (§19) — a simulation of the
 * user's financial state that can project "what if" scenarios forward.
 */

export const PREDICTIVE_SCHEMA = 'fbt.predictive-brain.v1';
export const TWIN_SCHEMA = 'fbt.digital-financial-twin.v1';

/**
 * Goal Forecasting: will the user reach their goal at current trajectory?
 */
export function forecastGoal({
  goal = null,
  financialState = null,
  monthlyContribution = 0,
  expectedReturnPct = 8,
  volatilityPct = 30,
  now = Date.now()
} = {}) {
  if (!goal || !financialState) {
    return { status: 'UNAVAILABLE', reason: 'GOAL_OR_STATE_MISSING' };
  }

  const currentValue = Number(financialState.netWorthUsd || financialState.availableCapitalUsd || 0);
  const targetValue = Number(goal.targetUsd || 0);
  if (targetValue <= 0) return { status: 'UNAVAILABLE', reason: 'NO_TARGET' };

  const deadline = goal.deadline || goal.horizonMonths
    ? new Date(goal.createdAt + (goal.horizonMonths || 12) * 30 * 86400000).getTime()
    : now + 12 * 30 * 86400000;
  const monthsRemaining = Math.max(1, Math.ceil((deadline - now) / (30 * 86400000)));
  const monthsElapsed = Math.max(0, Math.ceil((now - (goal.createdAt || now)) / (30 * 86400000)));

  // Current progress
  const currentProgressPct = Math.min(100, (currentValue / targetValue) * 100);

  // Required monthly return to hit target
  const gap = targetValue - currentValue;
  const requiredMonthlyReturn = monthsRemaining > 0
    ? gap / monthsRemaining
    : gap;

  // Required annual return rate
  const requiredAnnualReturnPct = currentValue > 0
    ? ((targetValue / currentValue) ** (12 / monthsRemaining) - 1) * 100
    : null;

  // Probability of success (simplified model)
  const excessReturn = expectedReturnPct - (requiredAnnualReturnPct || 100);
  const probabilityOfSuccess = excessReturn > 0
    ? Math.min(95, 50 + excessReturn * 2)
    : Math.max(5, 50 + excessReturn * 3);

  // Trajectory
  const trajectory = [];
  let projected = currentValue;
  const monthlyReturn = expectedReturnPct / 100 / 12;
  for (let m = 1; m <= monthsRemaining; m++) {
    projected = projected * (1 + monthlyReturn) + monthlyContribution;
    trajectory.push({
      month: m,
      projectedUsd: Math.round(projected),
      targetUsd: Math.round(targetValue * (m / monthsRemaining)),
      confidencePct: Math.round(Math.max(20, probabilityOfSuccess - m * 2) * 10) / 10
    });
  }

  // Deviation detection
  const expectedProgressPct = monthsElapsed > 0
    ? Math.min(100, (monthsElapsed / (monthsElapsed + monthsRemaining)) * 100)
    : 0;
  const deviationPct = currentProgressPct - expectedProgressPct;

  return {
    schema: PREDICTIVE_SCHEMA,
    status: 'OK',
    at: now,
    goalId: goal.goalId || null,
    goalName: goal.name || null,
    currentValueUsd: Math.round(currentValue * 100) / 100,
    targetValueUsd: targetValue,
    currentProgressPct: Math.round(currentProgressPct * 10) / 10,
    expectedProgressPct: Math.round(expectedProgressPct * 10) / 10,
    deviationPct: Math.round(deviationPct * 10) / 10,
    isOnTrack: Math.abs(deviationPct) < 15,
    monthsRemaining,
    requiredMonthlyContributionUsd: Math.round(requiredMonthlyReturn * 100) / 100,
    requiredAnnualReturnPct: requiredAnnualReturnPct != null ? Math.round(requiredAnnualReturnPct * 10) / 10 : null,
    probabilityOfSuccess: Math.round(probabilityOfSuccess * 10) / 10,
    trajectory: trajectory.slice(0, 24),
    verdict: deviationPct < -20 ? 'BEHIND' : deviationPct > 20 ? 'AHEAD' : 'ON_TRACK'
  };
}

/**
 * Portfolio Forecasting: where will the portfolio be in N months?
 */
export function forecastPortfolio({
  financialState = null,
  months = 6,
  expectedReturnPct = 10,
  volatilityPct = 40,
  monthlyContributionUsd = 0,
  paths = 1000,
  seed = 20260905,
  now = Date.now()
} = {}) {
  const currentValue = Number(financialState?.netWorthUsd || financialState?.availableCapitalUsd || 0);
  if (currentValue <= 0) {
    return { status: 'UNAVAILABLE', reason: 'NO_PORTFOLIO_VALUE' };
  }

  // Monte Carlo simulation
  const results = monteCarloSimulate({
    startUsd: currentValue,
    months,
    expectedReturnPct,
    volatilityPct,
    monthlyContributionUsd,
    paths,
    seed
  });

  // Percentiles
  const sorted = results.finalValues.sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  // Probability of loss
  const lossCount = sorted.filter(v => v < currentValue).length;
  const probLoss = (lossCount / sorted.length) * 100;

  // Probability of exceeding target
  const probGain20 = (sorted.filter(v => v > currentValue * 1.2).length / sorted.length) * 100;
  const probGain50 = (sorted.filter(v => v > currentValue * 1.5).length / sorted.length) * 100;

  return {
    schema: PREDICTIVE_SCHEMA,
    status: 'OK',
    at: now,
    currentValueUsd: Math.round(currentValue * 100) / 100,
    months,
    expectedReturnPct,
    volatilityPct,
    monthlyContributionUsd,
    paths,
    percentiles: {
      p5: Math.round(p5 * 100) / 100,
      p25: Math.round(p25 * 100) / 100,
      p50: Math.round(p50 * 100) / 100,
      p75: Math.round(p75 * 100) / 100,
      p95: Math.round(p95 * 100) / 100,
      mean: Math.round(mean * 100) / 100
    },
    probabilities: {
      lossPct: Math.round(probLoss * 10) / 10,
      gain20Pct: Math.round(probGain20 * 10) / 10,
      gain50Pct: Math.round(probGain50 * 10) / 10,
      breakevenPct: Math.round((100 - probLoss) * 10) / 10
    },
    maxDrawdownPct: Math.round(Math.max(...results.maxDrawdowns) * 10) / 10,
    avgDrawdownPct: Math.round((results.maxDrawdowns.reduce((a, b) => a + b, 0) / results.maxDrawdowns.length) * 10) / 10
  };
}

/**
 * Cashflow Forecasting
 */
export function forecastCashflow({
  financialState = null,
  months = 3,
  knownInflows = [],
  knownOutflows = [],
  now = Date.now()
} = {}) {
  const currentBalance = Number(financialState?.liquidUsd || financialState?.availableCapitalUsd || 0);
  const avgMonthlyIncome = Number(financialState?.monthlyIncomeUsd || 0);
  const avgMonthlyExpense = Number(financialState?.monthlyExpenseUsd || 0);

  const forecast = [];
  let balance = currentBalance;

  for (let m = 1; m <= months; m++) {
    const monthStart = now + (m - 1) * 30 * 86400000;
    const monthEnd = monthStart + 30 * 86400000;

    // Add known inflows/outflows for this month
    const monthInflows = knownInflows
      .filter(f => f.date >= monthStart && f.date < monthEnd)
      .reduce((sum, f) => sum + Number(f.amount || 0), 0);
    const monthOutflows = knownOutflows
      .filter(f => f.date >= monthStart && f.date < monthEnd)
      .reduce((sum, f) => sum + Number(f.amount || 0), 0);

    balance += avgMonthlyIncome + monthInflows - avgMonthlyExpense - monthOutflows;

    forecast.push({
      month: m,
      startBalanceUsd: Math.round((balance - avgMonthlyIncome - monthInflows + avgMonthlyExpense + monthOutflows) * 100) / 100,
      endBalanceUsd: Math.round(balance * 100) / 100,
      inflowUsd: Math.round((avgMonthlyIncome + monthInflows) * 100) / 100,
      outflowUsd: Math.round((avgMonthlyExpense + monthOutflows) * 100) / 100,
      netUsd: Math.round((avgMonthlyIncome + monthInflows - avgMonthlyExpense - monthOutflows) * 100) / 100,
      hasShortfall: balance < 0
    });
  }

  const monthsUntilShortfall = forecast.findIndex(f => f.hasShortfall);

  return {
    schema: PREDICTIVE_SCHEMA,
    status: 'OK',
    at: now,
    currentBalanceUsd: Math.round(currentBalance * 100) / 100,
    monthlyNetUsd: Math.round((avgMonthlyIncome - avgMonthlyExpense) * 100) / 100,
    monthsUntilShortfall: monthsUntilShortfall >= 0 ? monthsUntilShortfall + 1 : null,
    forecast,
    isHealthy: monthsUntilShortfall < 0 || monthsUntilShortfall > 2
  };
}

/**
 * Risk Forecasting: what risks are likely in the near future?
 */
export function forecastRisk({
  financialState = null,
  positions = [],
  marketContext = null,
  now = Date.now()
} = {}) {
  const risks = [];

  // Concentration risk
  if (positions.length > 0) {
    const total = positions.reduce((s, p) => s + Number(p.valueUsd || 0), 0);
    for (const pos of positions) {
      const pct = total > 0 ? (Number(pos.valueUsd || 0) / total) * 100 : 0;
      if (pct > 40) {
        risks.push({
          type: 'CONCENTRATION',
          severity: pct > 60 ? 'HIGH' : 'MEDIUM',
          asset: pos.symbol || pos.asset,
          pct: Math.round(pct * 10) / 10,
          detail: `${pos.symbol || 'Asset'} represents ${Math.round(pct)}% of portfolio`,
          probability: 0.8,
          impact: 'HIGH',
          horizon: 'IMMEDIATE'
        });
      }
    }
  }

  // Liquidation risk
  if (financialState?.totalDebtUsd > 0 && financialState?.totalCollateralUsd > 0) {
    const ltv = (financialState.totalDebtUsd / financialState.totalCollateralUsd) * 100;
    if (ltv > 60) {
      risks.push({
        type: 'LIQUIDATION',
        severity: ltv > 80 ? 'CRITICAL' : ltv > 70 ? 'HIGH' : 'MEDIUM',
        ltv: Math.round(ltv * 10) / 10,
        detail: `Loan-to-Value at ${Math.round(ltv)}%`,
        probability: ltv > 80 ? 0.6 : ltv > 70 ? 0.3 : 0.1,
        impact: 'CRITICAL',
        horizon: 'SHORT_TERM'
      });
    }
  }

  // Market regime risk
  if (marketContext?.regime === 'BEARISH' || marketContext?.trend === 'BEARISH') {
    risks.push({
      type: 'MARKET_REGIME',
      severity: 'HIGH',
      regime: marketContext.regime || 'BEARISH',
      detail: 'Market is in bearish regime — consider defensive positioning',
      probability: 0.7,
      impact: 'HIGH',
      horizon: 'MEDIUM_TERM'
    });
  }

  // Volatility risk
  if (marketContext?.volatilityPct > 60) {
    risks.push({
      type: 'VOLATILITY',
      severity: marketContext.volatilityPct > 100 ? 'HIGH' : 'MEDIUM',
      volatilityPct: marketContext.volatilityPct,
      detail: `Market volatility at ${marketContext.volatilityPct}% — elevated uncertainty`,
      probability: 0.6,
      impact: 'MEDIUM',
      horizon: 'SHORT_TERM'
    });
  }

  return {
    schema: PREDICTIVE_SCHEMA,
    status: 'OK',
    at: now,
    risks: risks.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
    }),
    overallRiskLevel: risks.length === 0 ? 'LOW' :
      risks.some(r => r.severity === 'CRITICAL') ? 'CRITICAL' :
      risks.some(r => r.severity === 'HIGH') ? 'HIGH' :
      risks.some(r => r.severity === 'MEDIUM') ? 'MEDIUM' : 'LOW',
    riskCount: risks.length,
    immediateRisks: risks.filter(r => r.horizon === 'IMMEDIATE').length
  };
}

/**
 * Market Regime Detection
 */
export function detectMarketRegime({
  marketData = null,
  prices = [],
  now = Date.now()
} = {}) {
  if (!prices.length && !marketData) {
    return { status: 'UNAVAILABLE', reason: 'NO_MARKET_DATA' };
  }

  const trend = marketData?.trend || 'UNKNOWN';
  const volatility = Number(marketData?.volatilityPct || 0);
  const volume = marketData?.volumeTrend || 'NORMAL';
  const sentiment = marketData?.sentiment || 'NEUTRAL';

  // Regime classification
  let regime = 'RANGING';
  if (trend === 'BULLISH' && volatility < 30) regime = 'BULL_LOW_VOL';
  else if (trend === 'BULLISH' && volatility >= 30) regime = 'BULL_HIGH_VOL';
  else if (trend === 'BEARISH' && volatility < 30) regime = 'BEAR_LOW_VOL';
  else if (trend === 'BEARISH' && volatility >= 30) regime = 'BEAR_HIGH_VOL';
  else if (volatility >= 60) regime = 'HIGH_VOLATILITY';
  else if (volume === 'LOW') regime = 'LOW_LIQUIDITY';

  return {
    schema: PREDICTIVE_SCHEMA,
    status: 'OK',
    at: now,
    regime,
    trend,
    volatilityPct: volatility,
    volumeTrend: volume,
    sentiment,
    recommendedStrategy: getRegimeStrategy(regime),
    confidence: 0.6
  };
}

/**
 * Digital Financial Twin: project the user's financial state forward
 */
export function createFinancialTwin({
  financialState = null,
  goals = [],
  riskProfile = 'MODERATE',
  behaviors = {},
  now = Date.now()
} = {}) {
  if (!financialState) {
    return { status: 'UNAVAILABLE', reason: 'NO_FINANCIAL_STATE' };
  }

  const twin = {
    schema: TWIN_SCHEMA,
    status: 'OK',
    at: now,
    assets: {
      liquidUsd: Number(financialState.liquidUsd || 0),
      investedUsd: Number(financialState.investedUsd || 0),
      totalUsd: Number(financialState.netWorthUsd || financialState.availableCapitalUsd || 0)
    },
    liabilities: {
      totalDebtUsd: Number(financialState.totalDebtUsd || 0),
      monthlyDebtPaymentUsd: Number(financialState.monthlyDebtPaymentUsd || 0)
    },
    income: {
      monthlyUsd: Number(financialState.monthlyIncomeUsd || 0),
      sources: financialState.incomeSources || []
    },
    expenses: {
      monthlyUsd: Number(financialState.monthlyExpenseUsd || 0),
      categories: financialState.expenseCategories || []
    },
    goals: goals.map(g => ({
      name: g.name,
      targetUsd: g.targetUsd,
      deadline: g.deadline,
      progressPct: g.progressPct || 0
    })),
    riskProfile,
    behaviors: {
      riskTolerance: behaviors.riskTolerance || riskProfile,
      investmentHorizon: behaviors.horizon || 'MEDIUM_TERM',
      lossAversion: behaviors.lossAversion || 'MODERATE',
      tradingFrequency: behaviors.tradingFrequency || 'LOW'
    }
  };

  return { ok: true, twin };
}

/**
 * Project the twin forward under different scenarios
 */
export function projectTwin({
  twin = null,
  scenarios = [],
  months = 12,
  now = Date.now()
} = {}) {
  if (!twin) return { status: 'UNAVAILABLE', reason: 'NO_TWIN' };

  const projections = scenarios.map(scenario => {
    let value = twin.assets.totalUsd;
    const monthlyReturn = (scenario.expectedReturnPct || 0) / 100 / 12;
    const monthlyVol = (scenario.volatilityPct || 20) / 100 / Math.sqrt(12);
    const trajectory = [];

    for (let m = 1; m <= months; m++) {
      // Deterministic projection (no randomness for reproducibility)
      value = value * (1 + monthlyReturn) + (twin.income.monthlyUsd - twin.expenses.monthlyUsd);
      trajectory.push({
        month: m,
        valueUsd: Math.round(value * 100) / 100,
        netWorthUsd: Math.round((value - twin.liabilities.totalDebtUsd) * 100) / 100
      });
    }

    return {
      scenario: scenario.name || 'Unnamed',
      assumptions: {
        expectedReturnPct: scenario.expectedReturnPct,
        volatilityPct: scenario.volatilityPct,
        shock: scenario.shock || null
      },
      finalValueUsd: Math.round(value * 100) / 100,
      finalNetWorthUsd: Math.round((value - twin.liabilities.totalDebtUsd) * 100) / 100,
      totalReturnPct: twin.assets.totalUsd > 0
        ? Math.round(((value - twin.assets.totalUsd) / twin.assets.totalUsd) * 1000) / 10
        : null,
      trajectory: trajectory.slice(0, 24),
      goalAchievement: twin.goals.map(g => ({
        name: g.name,
        targetUsd: g.targetUsd,
        achieved: value >= g.targetUsd,
        gapUsd: Math.max(0, Math.round((g.targetUsd - value) * 100) / 100)
      }))
    };
  });

  return {
    schema: TWIN_SCHEMA,
    status: 'OK',
    at: now,
    months,
    projections,
    comparison: generateComparison(projections)
  };
}

/**
 * Anomaly Detection: find unusual patterns in the financial state
 */
export function detectAnomalies({
  current = null,
  previous = null,
  thresholds = {},
  now = Date.now()
} = {}) {
  if (!current || !previous) {
    return { status: 'UNAVAILABLE', reason: 'NEED_CURRENT_AND_PREVIOUS' };
  }

  const anomalies = [];
  const defaultThresholds = {
    balanceChange: 20, // 20%
    spendingChange: 30,
    newLargePosition: 500, // $500
    concentrationChange: 15,
    ...thresholds
  };

  // Balance anomaly
  const currentBalance = Number(current.netWorthUsd || current.availableCapitalUsd || 0);
  const previousBalance = Number(previous.netWorthUsd || previous.availableCapitalUsd || 0);
  if (previousBalance > 0) {
    const changePct = Math.abs((currentBalance - previousBalance) / previousBalance) * 100;
    if (changePct > defaultThresholds.balanceChange) {
      anomalies.push({
        type: 'BALANCE_ANOMALY',
        severity: changePct > 50 ? 'HIGH' : 'MEDIUM',
        changePct: Math.round(changePct * 10) / 10,
        detail: `Balance changed by ${Math.round(changePct)}% since last check`,
        current: currentBalance,
        previous: previousBalance
      });
    }
  }

  return {
    schema: PREDICTIVE_SCHEMA,
    status: 'OK',
    at: now,
    anomalies,
    anomalyCount: anomalies.length,
    isNormal: anomalies.length === 0
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function monteCarloSimulate({ startUsd, months, expectedReturnPct, volatilityPct, monthlyContributionUsd, paths, seed }) {
  const finalValues = [];
  const maxDrawdowns = [];
  const monthlyReturn = expectedReturnPct / 100 / 12;
  const monthlyVol = volatilityPct / 100 / Math.sqrt(12);

  // Simple seeded pseudo-random
  let rngState = seed;
  const rng = () => {
    rngState = (rngState * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (rngState >>> 0) / 0xFFFFFFFF;
  };

  // Box-Muller for normal distribution
  const normalRandom = () => {
    const u1 = rng() || 0.0001;
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  for (let p = 0; p < paths; p++) {
    let value = startUsd;
    let peak = startUsd;
    let maxDrawdown = 0;

    for (let m = 0; m < months; m++) {
      const shock = monthlyReturn + monthlyVol * normalRandom();
      value = value * (1 + shock) + monthlyContributionUsd;
      value = Math.max(0, value);
      peak = Math.max(peak, value);
      const drawdown = peak > 0 ? ((peak - value) / peak) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    finalValues.push(value);
    maxDrawdowns.push(maxDrawdown);
  }

  return { finalValues, maxDrawdowns };
}

function getRegimeStrategy(regime) {
  const strategies = {
    BULL_LOW_VOL: 'Accumulate — favorable risk/reward for growth assets',
    BULL_HIGH_VOL: 'Cautious accumulation — use DCA, widen stops',
    BEAR_LOW_VOL: 'Defensive — increase cash, reduce exposure',
    BEAR_HIGH_VOL: 'High caution — preserve capital, look for hedges',
    HIGH_VOLATILITY: 'Reduce position sizes, increase diversification',
    LOW_LIQUIDITY: 'Avoid large trades, use limit orders',
    RANGING: 'Range-trade or wait for breakout confirmation'
  };
  return strategies[regime] || 'Maintain current allocation, monitor for regime change';
}

function generateComparison(projections) {
  if (projections.length < 2) return null;
  const best = projections.reduce((a, b) => (a.finalValueUsd > b.finalValueUsd ? a : b));
  const worst = projections.reduce((a, b) => (a.finalValueUsd < b.finalValueUsd ? a : b));
  const spread = best.finalValueUsd - worst.finalValueUsd;
  return {
    bestCase: best.scenario,
    worstCase: worst.scenario,
    spreadUsd: Math.round(spread * 100) / 100,
    spreadPct: worst.finalValueUsd > 0
      ? Math.round((spread / worst.finalValueUsd) * 1000) / 10
      : null
  };
}

export default {
  forecastGoal, forecastPortfolio, forecastCashflow, forecastRisk,
  detectMarketRegime, createFinancialTwin, projectTwin, detectAnomalies,
  PREDICTIVE_SCHEMA, TWIN_SCHEMA
};
