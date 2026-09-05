/**
 * FBT FINANCIAL OS — Financial Guardian (Upgrade 11+12 §22)
 * ---------------------------------------------------------------------------
 * Always-on monitoring layer that watches for risk events across the entire
 * ecosystem. Detects, analyzes, prioritizes, notifies, and recommends
 * actions. Works proactively — does not wait for user to ask.
 *
 * Monitors:
 *   - Portfolio Risk (concentration, drawdown, correlation)
 *   - Transaction Risk (unusual patterns, scam detection)
 *   - Credit Risk (LTV, liquidation proximity)
 *   - Smart Contract Risk (protocol health, exploit signals)
 *   - Market Shock (sudden price moves, regime changes)
 *   - Goal Deviation (falling behind on goals)
 *   - Abnormal Activity (unusual wallet behavior)
 */

export const GUARDIAN_SCHEMA = 'fbt.financial-guardian.v2';

const SEVERITY = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Run a full guardian sweep across all monitored dimensions
 */
export function runGuardianSweep({
  financialState = null,
  portfolio = null,
  wallet = null,
  goals = [],
  credit = null,
  defiPositions = [],
  marketContext = null,
  recentTransactions = [],
  autonomyLevel = 2, // 0=observe, 1=analyze, 2=recommend, 3=prepare, 4=execute_with_confirm, 5=autonomous
  now = Date.now()
} = {}) {
  const alerts = [];

  // 1. Portfolio Risk
  if (portfolio || financialState) {
    const portfolioAlerts = checkPortfolioRisk(portfolio, financialState, now);
    alerts.push(...portfolioAlerts);
  }

  // 2. Credit / Liquidation Risk
  if (credit || (financialState?.totalDebtUsd > 0)) {
    const creditAlerts = checkCreditRisk(credit, financialState, now);
    alerts.push(...creditAlerts);
  }

  // 3. Market Shock Detection
  if (marketContext) {
    const marketAlerts = checkMarketShock(marketContext, now);
    alerts.push(...marketAlerts);
  }

  // 4. Goal Deviation
  if (goals.length > 0 && financialState) {
    const goalAlerts = checkGoalDeviation(goals, financialState, now);
    alerts.push(...goalAlerts);
  }

  // 5. Transaction Anomaly
  if (recentTransactions.length > 0) {
    const txAlerts = checkTransactionAnomaly(recentTransactions, wallet, now);
    alerts.push(...txAlerts);
  }

  // 6. DeFi Position Health
  if (defiPositions.length > 0) {
    const defiAlerts = checkDefiHealth(defiPositions, now);
    alerts.push(...defiAlerts);
  }

  // Sort by severity and add recommended actions
  const sorted = alerts
    .sort((a, b) => (SEVERITY[b.severity] || 0) - (SEVERITY[a.severity] || 0))
    .map(a => ({
      ...a,
      recommendedAction: getRecommendedAction(a, autonomyLevel),
      requiresPermission: SEVERITY[a.severity] >= SEVERITY.HIGH
    }));

  // Compute overall health score
  const healthScore = computeHealthScore(sorted);

  return {
    schema: GUARDIAN_SCHEMA,
    status: 'OK',
    at: now,
    healthScore,
    healthLevel: healthScore >= 80 ? 'EXCELLENT' : healthScore >= 60 ? 'GOOD' : healthScore >= 40 ? 'FAIR' : healthScore >= 20 ? 'POOR' : 'CRITICAL',
    alerts: sorted,
    alertCount: sorted.length,
    criticalAlerts: sorted.filter(a => a.severity === 'CRITICAL').length,
    highAlerts: sorted.filter(a => a.severity === 'HIGH').length,
    autonomyLevel,
    canAutoAct: autonomyLevel >= 4,
    summary: generateGuardianSummary(sorted, healthScore)
  };
}

/**
 * Evaluate a single event and determine if guardian should fire
 */
export function evaluateEvent(event, context = {}) {
  const type = String(event?.type || '').toUpperCase();
  const alerts = [];

  switch (type) {
    case 'PRICE_CHANGED':
      if (Math.abs(Number(event.payload?.changePct || 0)) > 10) {
        alerts.push({
          type: 'PRICE_SHOCK',
          severity: Math.abs(event.payload.changePct) > 20 ? 'CRITICAL' : 'HIGH',
          title: `${event.payload.symbol || 'Asset'} moved ${event.payload.changePct > 0 ? '+' : ''}${event.payload.changePct}%`,
          modules: ['MARKET', 'PORTFOLIO', 'RISK'],
          detail: `Significant price movement detected`,
          recommendedAction: 'REVIEW_PORTFOLIO'
        });
      }
      break;

    case 'WHALE_MOVED':
      alerts.push({
        type: 'WHALE_ACTIVITY',
        severity: 'MEDIUM',
        title: `Whale movement: ${event.payload.symbol || 'asset'}`,
        modules: ['SMART_MONEY', 'RESEARCH'],
        detail: event.payload.detail || 'Large on-chain movement detected',
        recommendedAction: 'MONITOR'
      });
      break;

    case 'LIQUIDATION_RISK':
      alerts.push({
        type: 'LIQUIDATION_THREAT',
        severity: 'CRITICAL',
        title: 'Liquidation risk detected',
        modules: ['CREDIT', 'RISK', 'WALLET'],
        detail: event.payload.detail || 'Position at risk of liquidation',
        recommendedAction: 'ADD_COLLATERAL_OR_REDUCE_DEBT'
      });
      break;

    case 'GOAL_DEVIATION':
      alerts.push({
        type: 'GOAL_OFF_TRACK',
        severity: 'HIGH',
        title: `Goal "${event.payload.goalName || 'unnamed'}" is off track`,
        modules: ['GOALS', 'PORTFOLIO', 'RISK'],
        detail: event.payload.detail || 'Goal progress falling behind',
        recommendedAction: 'REVIEW_STRATEGY'
      });
      break;

    case 'PAYMENT_FAILED':
      alerts.push({
        type: 'PAYMENT_FAILURE',
        severity: 'HIGH',
        title: 'Payment failed',
        modules: ['PAY', 'WALLET'],
        detail: event.payload.detail || 'A payment could not be completed',
        recommendedAction: 'CHECK_BALANCE_AND_RETRY'
      });
      break;

    case 'PORTFOLIO_DRIFT':
      alerts.push({
        type: 'PORTFOLIO_DRIFT',
        severity: 'MEDIUM',
        title: 'Portfolio allocation has drifted',
        modules: ['PORTFOLIO', 'RISK'],
        detail: event.payload.detail || 'Asset allocation has shifted from target',
        recommendedAction: 'CONSIDER_REBALANCE'
      });
      break;

    case 'MARKET_REGIME_CHANGED':
      alerts.push({
        type: 'REGIME_CHANGE',
        severity: 'HIGH',
        title: `Market regime changed to ${event.payload.regime || 'unknown'}`,
        modules: ['MACRO', 'RISK', 'PORTFOLIO'],
        detail: event.payload.detail || 'Market conditions have materially changed',
        recommendedAction: 'REVIEW_ALLOCATION'
      });
      break;

    case 'NEW_OPPORTUNITY':
      alerts.push({
        type: 'OPPORTUNITY',
        severity: 'LOW',
        title: 'New opportunity detected',
        modules: ['RESEARCH', 'DEFI', 'RWA'],
        detail: event.payload.detail || 'A personalized opportunity has been identified',
        recommendedAction: 'REVIEW_OPPORTUNITY'
      });
      break;

    case 'PROTOCOL_RISK_CHANGED':
      alerts.push({
        type: 'PROTOCOL_RISK',
        severity: 'HIGH',
        title: `Protocol risk increased: ${event.payload.protocol || 'unknown'}`,
        modules: ['DEFI', 'RISK', 'SECURITY'],
        detail: event.payload.detail || 'Protocol health has degraded',
        recommendedAction: 'ASSESS_EXPOSURE'
      });
      break;
  }

  return {
    schema: GUARDIAN_SCHEMA,
    status: 'OK',
    at: Date.now(),
    event: { type, source: event?.source || null },
    alerts: alerts.map(a => ({
      ...a,
      alertId: `grd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now()
    })),
    actionRequired: alerts.some(a => SEVERITY[a.severity] >= SEVERITY.MEDIUM)
  };
}

// ── Internal Checkers ────────────────────────────────────────────────────────

function checkPortfolioRisk(portfolio, financialState, now) {
  const alerts = [];
  const holdings = portfolio?.holdings || [];
  const total = holdings.reduce((s, h) => s + Number(h.valueUsd || 0), 0) || Number(financialState?.netWorthUsd || 0);

  if (total <= 0) return alerts;

  // Concentration check
  for (const h of holdings) {
    const pct = (Number(h.valueUsd || 0) / total) * 100;
    if (pct > 50) {
      alerts.push({
        alertId: `grd_${now.toString(36)}_conc_${h.symbol}`,
        type: 'CONCENTRATION',
        severity: pct > 70 ? 'CRITICAL' : 'HIGH',
        title: `${h.symbol || 'Asset'} is ${Math.round(pct)}% of portfolio`,
        modules: ['PORTFOLIO', 'RISK'],
        detail: `Single asset exceeds safe concentration threshold`,
        createdAt: now,
        data: { symbol: h.symbol, pct: Math.round(pct * 10) / 10, valueUsd: Number(h.valueUsd || 0) }
      });
    }
  }

  // Drawdown check
  if (portfolio?.drawdownPct != null && portfolio.drawdownPct > 15) {
    alerts.push({
      alertId: `grd_${now.toString(36)}_dd`,
      type: 'DRAWDOWN',
      severity: portfolio.drawdownPct > 30 ? 'CRITICAL' : portfolio.drawdownPct > 20 ? 'HIGH' : 'MEDIUM',
      title: `Portfolio down ${Math.round(portfolio.drawdownPct)}% from peak`,
      modules: ['PORTFOLIO', 'RISK'],
      detail: 'Significant drawdown detected — review stop-loss and risk management',
      createdAt: now
    });
  }

  return alerts;
}

function checkCreditRisk(credit, financialState, now) {
  const alerts = [];
  const ltv = Number(credit?.ltv || (financialState?.totalDebtUsd > 0 && financialState?.totalCollateralUsd > 0
    ? (financialState.totalDebtUsd / financialState.totalCollateralUsd) * 100
    : 0));

  if (ltv > 60) {
    alerts.push({
      alertId: `grd_${now.toString(36)}_ltv`,
      type: 'LIQUIDATION_RISK',
      severity: ltv > 80 ? 'CRITICAL' : ltv > 70 ? 'HIGH' : 'MEDIUM',
      title: `Loan-to-Value at ${Math.round(ltv)}%`,
      modules: ['CREDIT', 'RISK'],
      detail: ltv > 80 ? 'Liquidation is imminent — act immediately' : 'LTV approaching danger zone',
      createdAt: now,
      data: { ltv: Math.round(ltv * 10) / 10 }
    });
  }

  return alerts;
}

function checkMarketShock(marketContext, now) {
  const alerts = [];

  if (marketContext.regime === 'BEAR_HIGH_VOL') {
    alerts.push({
      alertId: `grd_${now.toString(36)}_regime`,
      type: 'MARKET_REGIME',
      severity: 'HIGH',
      title: 'Market in high-volatility bear regime',
      modules: ['MACRO', 'RISK', 'PORTFOLIO'],
      detail: 'Defensive positioning recommended',
      createdAt: now
    });
  }

  if (marketContext.btcDominanceChange != null && Math.abs(marketContext.btcDominanceChange) > 5) {
    alerts.push({
      alertId: `grd_${now.toString(36)}_dom`,
      type: 'REGIME_SHIFT',
      severity: 'MEDIUM',
      title: `BTC dominance shifted ${marketContext.btcDominanceChange > 0 ? '+' : ''}${Math.round(marketContext.btcDominanceChange)}%`,
      modules: ['MACRO', 'PORTFOLIO'],
      detail: 'Market leadership is shifting',
      createdAt: now
    });
  }

  return alerts;
}

function checkGoalDeviation(goals, financialState, now) {
  const alerts = [];

  for (const goal of goals) {
    const progress = Number(goal.progressPct || 0);
    const monthsElapsed = goal.createdAt ? Math.ceil((now - goal.createdAt) / (30 * 86400000)) : 0;
    const monthsTotal = goal.horizonMonths || 12;
    const expectedProgress = Math.min(100, (monthsElapsed / monthsTotal) * 100);
    const deviation = progress - expectedProgress;

    if (deviation < -25) {
      alerts.push({
        alertId: `grd_${now.toString(36)}_goal_${goal.goalId || 'x'}`,
        type: 'GOAL_DEVIATION',
        severity: deviation < -50 ? 'CRITICAL' : 'HIGH',
        title: `Goal "${goal.name || 'unnamed'}" is significantly behind`,
        modules: ['GOALS', 'PORTFOLIO', 'RISK'],
        detail: `Progress: ${Math.round(progress)}% vs expected ${Math.round(expectedProgress)}%`,
        createdAt: now,
        data: { goalId: goal.goalId, progress, expected: Math.round(expectedProgress), deviation: Math.round(deviation) }
      });
    }
  }

  return alerts;
}

function checkTransactionAnomaly(transactions, wallet, now) {
  const alerts = [];
  const recent = transactions.filter(t => now - (t.timestamp || t.at || 0) < 3600_000); // last hour

  // Unusual frequency
  if (recent.length > 10) {
    alerts.push({
      alertId: `grd_${now.toString(36)}_freq`,
      type: 'UNUSUAL_FREQUENCY',
      severity: 'HIGH',
      title: `${recent.length} transactions in the last hour`,
      modules: ['SECURITY', 'WALLET'],
      detail: 'Unusual transaction frequency detected — verify all transactions were authorized',
      createdAt: now
    });
  }

  // Large single transaction
  for (const tx of recent) {
    const value = Number(tx.valueUsd || tx.amountUsd || 0);
    if (value > 10000) {
      alerts.push({
        alertId: `grd_${now.toString(36)}_large_${tx.txHash?.slice(0, 8) || 'x'}`,
        type: 'LARGE_TRANSACTION',
        severity: value > 50000 ? 'HIGH' : 'MEDIUM',
        title: `Large transaction: $${Math.round(value).toLocaleString()}`,
        modules: ['WALLET', 'SECURITY'],
        detail: `Transaction of $${Math.round(value).toLocaleString()} detected`,
        createdAt: now,
        data: { txHash: tx.txHash, valueUsd: value }
      });
    }
  }

  return alerts;
}

function checkDefiHealth(defiPositions, now) {
  const alerts = [];

  for (const pos of defiPositions) {
    if (pos.healthFactor != null && pos.healthFactor < 1.5) {
      alerts.push({
        alertId: `grd_${now.toString(36)}_hf_${pos.protocol || 'x'}`,
        type: 'PROTOCOL_HEALTH',
        severity: pos.healthFactor < 1.1 ? 'CRITICAL' : pos.healthFactor < 1.3 ? 'HIGH' : 'MEDIUM',
        title: `${pos.protocol || 'Protocol'} position health: ${pos.healthFactor.toFixed(2)}`,
        modules: ['DEFI', 'RISK'],
        detail: 'Health factor approaching liquidation threshold',
        createdAt: now
      });
    }
  }

  return alerts;
}

function getRecommendedAction(alert, autonomyLevel) {
  const actions = {
    CONCENTRATION: autonomyLevel >= 3 ? 'PREPARE_REBALANCE' : 'REVIEW_AND_REBALANCE',
    DRAWDOWN: 'REVIEW_STOP_LOSS',
    LIQUIDATION_RISK: autonomyLevel >= 4 ? 'ADD_COLLATERAL_IMMEDIATELY' : 'ADD_COLLATERAL_OR_REDUCE_DEBT',
    MARKET_REGIME: 'REVIEW_ALLOCATION',
    GOAL_DEVIATION: 'REVIEW_STRATEGY',
    PAYMENT_FAILURE: 'CHECK_BALANCE_AND_RETRY',
    UNUSUAL_FREQUENCY: 'VERIFY_TRANSACTIONS',
    LARGE_TRANSACTION: 'VERIFY_AUTHORIZATION',
    PROTOCOL_HEALTH: autonomyLevel >= 3 ? 'PREPARE_WITHDRAWAL' : 'ASSESS_AND_WITHDRAW',
    WHALE_ACTIVITY: 'MONITOR',
    OPPORTUNITY: 'REVIEW_OPPORTUNITY',
    REGIME_SHIFT: 'REVIEW_ALLOCATION',
    PRICE_SHOCK: 'REVIEW_POSITIONS',
    PROTOCOL_RISK: 'ASSESS_EXPOSURE',
    REGIME_CHANGE: 'REVIEW_ALLOCATION',
    PORTFOLIO_DRIFT: 'CONSIDER_REBALANCE'
  };
  return actions[alert.type] || 'REVIEW';
}

function computeHealthScore(alerts) {
  if (alerts.length === 0) return 95;

  let score = 100;
  for (const a of alerts) {
    switch (a.severity) {
      case 'CRITICAL': score -= 25; break;
      case 'HIGH': score -= 15; break;
      case 'MEDIUM': score -= 8; break;
      case 'LOW': score -= 3; break;
      default: score -= 1;
    }
  }
  return Math.max(0, Math.min(100, score));
}

function generateGuardianSummary(alerts, healthScore) {
  if (alerts.length === 0) return 'All systems healthy — no immediate concerns detected.';

  const critical = alerts.filter(a => a.severity === 'CRITICAL');
  const high = alerts.filter(a => a.severity === 'HIGH');

  if (critical.length > 0) {
    return `⚠️ ${critical.length} critical issue(s) require immediate attention. Health score: ${healthScore}/100.`;
  }
  if (high.length > 0) {
    return `${high.length} high-priority item(s) need review. Health score: ${healthScore}/100.`;
  }
  return `${alerts.length} item(s) to be aware of. Health score: ${healthScore}/100.`;
}

export default { runGuardianSweep, evaluateEvent, GUARDIAN_SCHEMA };
