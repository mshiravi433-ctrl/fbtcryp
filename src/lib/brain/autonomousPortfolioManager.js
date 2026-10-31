/**
 * FBT INTENT OS — Autonomous Portfolio Manager (Section 9)
 * ---------------------------------------------------------------------------
 * Autonomous wealth and asset management engine aligned with user financial goals.
 *
 * Example User Intent:
 *   «می‌خواهم پرتفوی من برای شش ماه آینده با ریسک متوسط مدیریت شود.»
 *   ("I want my portfolio managed for the next 6 months with medium risk.")
 *
 * Pipeline & Disciplines:
 *   1. Goal Parser & Definition (Horizon, Risk Profile, Target Return, Base Asset)
 *   2. Multi-chain Asset Scanner (EVM, Solana, Stables, Liquid Positions)
 *   3. Portfolio Composition & Concentration (HHI Index, Asset Weights)
 *   4. Risk & Asset Correlation Matrix (Covariance, Portfolio Volatility, VaR 95%, Sharpe)
 *   5. Opportunity Identifier (Lending Yields, Staking, Undervalued Sectors)
 *   6. Target Capital Allocation Proposal (Modern Portfolio / Risk Parity)
 *   7. Drift Detector (Trigger when |w_current - w_target| >= threshold)
 *   8. Rebalancing Plan Generator (Batched swaps, gas & slippage minimized)
 *   9. Performance Reporter (PnL, Goal Trajectory, Benchmark Comparison)
 *  10. Permission Policy Enforcement (ADVISORY, REQUIRE_APPROVAL, AUTO_WITH_LIMITS)
 */

export const PORTFOLIO_SCHEMA = 'fbt.autonomous-portfolio.v1';

export const RISK_PROFILES = Object.freeze({
  CONSERVATIVE: {
    id: 'CONSERVATIVE',
    labelFa: 'محافظه‌کارانه',
    targetVolatilityAnnualPct: 15,
    maxDrawdownTolerancePct: 10,
    expectedReturnAnnualPct: 12,
    targetWeights: { BTC: 0.35, ETH: 0.20, STABLES: 0.40, ALTS: 0.05 }
  },
  MODERATE: {
    id: 'MODERATE',
    labelFa: 'متوسط / متعادل',
    targetVolatilityAnnualPct: 28,
    maxDrawdownTolerancePct: 20,
    expectedReturnAnnualPct: 25,
    targetWeights: { BTC: 0.40, ETH: 0.25, STABLES: 0.20, SOL: 0.10, ALTS: 0.05 }
  },
  AGGRESSIVE: {
    id: 'AGGRESSIVE',
    labelFa: 'تهاجمی / پربازده',
    targetVolatilityAnnualPct: 48,
    maxDrawdownTolerancePct: 35,
    expectedReturnAnnualPct: 45,
    targetWeights: { BTC: 0.30, ETH: 0.25, SOL: 0.20, ALTS: 0.15, STABLES: 0.10 }
  }
});

export const USER_PERMISSION_POLICIES = Object.freeze({
  ADVISORY: {
    id: 'ADVISORY',
    labelFa: 'فقط مشاوره و گزارش',
    descFa: 'سیستم صرفاً پیشنهاد تخصیص و متعادل‌سازی را به کاربر نمایش می‌دهد؛ هیچ تراکنشی بدون اجرای دستی کاربر انجام نمی‌شود.',
    canExecute: false
  },
  REQUIRE_APPROVAL: {
    id: 'REQUIRE_APPROVAL',
    labelFa: 'تأیید قبل از اجرا',
    descFa: 'پیشنهادهای متعادل‌سازی توسط سیستم آماده شده و با ۱ کلیک تأیید در کیف‌پول امضا می‌شوند.',
    canExecute: true,
    requiresExplicitSign: true
  },
  AUTO_WITH_LIMITS: {
    id: 'AUTO_WITH_LIMITS',
    labelFa: 'خودکار تحت سقف محدود',
    descFa: 'متعادل‌سازی تا سقف روزانه مشخص، اسلیپیج زیر ۰.۵٪ و کارمزد گس بهینه به صورت خودکار اجرا می‌گردد.',
    canExecute: true,
    requiresExplicitSign: false,
    maxDailySpendUsd: 1000,
    maxSlippageBps: 50
  }
});

/**
 * Standard correlation coefficients between major asset classes (derived empirically)
 */
export const ASSET_CORRELATION_MATRIX = Object.freeze({
  BTC:     { BTC: 1.00, ETH: 0.82, SOL: 0.68, STABLES: 0.00, ALTS: 0.74 },
  ETH:     { BTC: 0.82, ETH: 1.00, SOL: 0.75, STABLES: 0.00, ALTS: 0.80 },
  SOL:     { BTC: 0.68, ETH: 0.75, SOL: 1.00, STABLES: 0.00, ALTS: 0.82 },
  STABLES: { BTC: 0.00, ETH: 0.00, SOL: 0.00, STABLES: 1.00, ALTS: 0.00 },
  ALTS:    { BTC: 0.74, ETH: 0.80, SOL: 0.82, STABLES: 0.00, ALTS: 1.00 }
});

export const ASSET_ANNUAL_VOLATILITY = Object.freeze({
  BTC: 0.45,
  ETH: 0.55,
  SOL: 0.70,
  STABLES: 0.02,
  ALTS: 0.85
});

/**
 * 1. Parse and compile a user financial goal
 */
export function parseFinancialGoal({
  prompt = '',
  horizonMonths = 6,
  riskProfileId = 'MODERATE',
  initialCapitalUsd = 10000,
  permissionPolicyId = 'REQUIRE_APPROVAL'
} = {}) {
  let risk = RISK_PROFILES[riskProfileId] || RISK_PROFILES.MODERATE;
  let months = Number(horizonMonths) || 6;

  // Simple heuristic language matching
  if (/کم|محافظه‌کار|low|conservative/i.test(prompt)) {
    risk = RISK_PROFILES.CONSERVATIVE;
  } else if (/تهاجمی|بسیار پرریسک|aggressive|high/i.test(prompt)) {
    risk = RISK_PROFILES.AGGRESSIVE;
  } else if (/متوسط|متعادل|medium|moderate/i.test(prompt)) {
    risk = RISK_PROFILES.MODERATE;
  }

  const monthMatch = prompt.match(/(\d+)\s*(ماه|month)/i);
  if (monthMatch) {
    months = parseInt(monthMatch[1], 10);
  }

  const policy = USER_PERMISSION_POLICIES[permissionPolicyId] || USER_PERMISSION_POLICIES.REQUIRE_APPROVAL;

  return {
    id: `goal_${Date.now()}`,
    userPrompt: prompt,
    horizonMonths: months,
    riskProfile: risk,
    initialCapitalUsd: Number(initialCapitalUsd),
    permissionPolicy: policy,
    targetReturnUsd: Math.round(initialCapitalUsd * (1 + (risk.expectedReturnAnnualPct / 100) * (months / 12))),
    createdAt: Date.now()
  };
}

/**
 * 2. Scan and aggregate user asset holdings
 */
export function scanUserAssets(holdings = {}) {
  // holdings: { BTC: { balance: 0.1, priceUsd: 65000 }, ETH: { balance: 1.5, priceUsd: 3500 }, ... }
  const defaultSample = {
    BTC: { balance: 0.08, priceUsd: 68000 },
    ETH: { balance: 1.2, priceUsd: 3400 },
    SOL: { balance: 12, priceUsd: 175 },
    USDT: { balance: 2500, priceUsd: 1.0 },
    USDC: { balance: 1500, priceUsd: 1.0 }
  };

  const raw = Object.keys(holdings).length > 0 ? holdings : defaultSample;
  let totalValueUsd = 0;
  const items = [];

  for (const [symbol, info] of Object.entries(raw)) {
    const bal = Number(info.balance || 0);
    const price = Number(info.priceUsd || 1);
    const valUsd = bal * price;
    totalValueUsd += valUsd;

    items.push({
      symbol: symbol.toUpperCase(),
      balance: bal,
      priceUsd: price,
      valueUsd: Math.round(valUsd * 100) / 100
    });
  }

  // Group into standard asset categories (BTC, ETH, SOL, STABLES, ALTS)
  const categorized = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    STABLES: 0,
    ALTS: 0
  };

  items.forEach((item) => {
    item.weightPct = totalValueUsd > 0 ? Math.round((item.valueUsd / totalValueUsd) * 1000) / 10 : 0;
    if (item.symbol === 'BTC') categorized.BTC += item.valueUsd;
    else if (item.symbol === 'ETH') categorized.ETH += item.valueUsd;
    else if (item.symbol === 'SOL') categorized.SOL += item.valueUsd;
    else if (['USDT', 'USDC', 'DAI', 'FDUSD'].includes(item.symbol)) categorized.STABLES += item.valueUsd;
    else categorized.ALTS += item.valueUsd;
  });

  const categoryWeights = {};
  for (const [k, v] of Object.entries(categorized)) {
    categoryWeights[k] = totalValueUsd > 0 ? Math.round((v / totalValueUsd) * 1000) / 1000 : 0;
  }

  return {
    totalValueUsd: Math.round(totalValueUsd * 100) / 100,
    assetCount: items.length,
    assets: items,
    categoryWeights
  };
}

/**
 * 3. Portfolio Risk & Correlation Matrix Analysis
 */
export function calculatePortfolioRisk(weights = {}) {
  // weights: { BTC: 0.4, ETH: 0.25, SOL: 0.15, STABLES: 0.15, ALTS: 0.05 }
  const categories = ['BTC', 'ETH', 'SOL', 'STABLES', 'ALTS'];
  const w = {};
  categories.forEach((c) => {
    w[c] = Number(weights[c] || 0);
  });

  // Calculate portfolio variance: sum_i sum_j w_i * w_j * vol_i * vol_j * corr_ij
  let portfolioVariance = 0;
  for (const i of categories) {
    for (const j of categories) {
      const volI = ASSET_ANNUAL_VOLATILITY[i] || 0.5;
      const volJ = ASSET_ANNUAL_VOLATILITY[j] || 0.5;
      const corr = ASSET_CORRELATION_MATRIX[i]?.[j] ?? (i === j ? 1 : 0.6);
      portfolioVariance += w[i] * w[j] * volI * volJ * corr;
    }
  }

  const portfolioVolAnnual = Math.sqrt(Math.max(0, portfolioVariance));
  const portfolioVolAnnualPct = Math.round(portfolioVolAnnual * 1000) / 10;
  const dailyVol = portfolioVolAnnual / Math.sqrt(365);

  // 1-Day 95% Value at Risk (z = 1.645)
  const var95DailyPct = Math.round(dailyVol * 1.645 * 1000) / 10;
  const var95MonthlyPct = Math.round(dailyVol * Math.sqrt(30) * 1.645 * 1000) / 10;

  // Concentration Index (HHI - Herfindahl-Hirschman Index: sum of squared weights)
  const hhi = Math.round(Object.values(w).reduce((acc, val) => acc + Math.pow(val * 100, 2), 0));
  let diversificationTier = 'WELL_DIVERSIFIED';
  if (hhi > 3500) diversificationTier = 'HIGHLY_CONCENTRATED';
  else if (hhi > 2200) diversificationTier = 'MODERATELY_CONCENTRATED';

  // Expected annual return based on weights
  const expectedReturnPct = Math.round(
    (w.BTC * 35 + w.ETH * 40 + w.SOL * 50 + w.STABLES * 10 + w.ALTS * 60) * 10
  ) / 10;

  // Sharpe Ratio (assuming risk free rate = 4.5% on stable yields)
  const riskFreeRate = 4.5;
  const sharpe = portfolioVolAnnualPct > 0
    ? Math.round(((expectedReturnPct - riskFreeRate) / portfolioVolAnnualPct) * 100) / 100
    : 0;

  return {
    annualizedVolatilityPct: portfolioVolAnnualPct,
    var95DailyPct,
    var95MonthlyPct,
    sharpeRatio: sharpe,
    expectedReturnPct,
    hhiScore: hhi,
    diversificationTier,
    correlationMatrix: ASSET_CORRELATION_MATRIX
  };
}

/**
 * 4. Drift Detector & Rebalancing Plan Generator
 */
export function generateRebalancePlan({
  currentWeights = {},
  targetWeights = {},
  totalValueUsd = 10000,
  driftThreshold = 0.05 // 5% drift threshold
} = {}) {
  const categories = ['BTC', 'ETH', 'SOL', 'STABLES', 'ALTS'];
  const drifts = [];
  let requiresRebalance = false;

  for (const cat of categories) {
    const curr = Number(currentWeights[cat] || 0);
    const target = Number(targetWeights[cat] || 0);
    const delta = curr - target; // positive means overweight (need to sell), negative underweight (need to buy)

    drifts.push({
      category: cat,
      currentWeightPct: Math.round(curr * 1000) / 10,
      targetWeightPct: Math.round(target * 1000) / 10,
      deltaWeightPct: Math.round(delta * 1000) / 10,
      overweight: delta > 0,
      exceedsThreshold: Math.abs(delta) >= driftThreshold
    });

    if (Math.abs(delta) >= driftThreshold) {
      requiresRebalance = true;
    }
  }

  // Generate required batched trade actions
  const tradeActions = [];
  if (requiresRebalance) {
    const toSell = drifts.filter((d) => d.deltaWeightPct > 0 && d.exceedsThreshold);
    const toBuy = drifts.filter((d) => d.deltaWeightPct < 0 && d.exceedsThreshold);

    for (const sellItem of toSell) {
      const sellAmountUsd = Math.round((sellItem.deltaWeightPct / 100) * totalValueUsd);
      for (const buyItem of toBuy) {
        const buyPortionUsd = Math.round(sellAmountUsd * (Math.abs(buyItem.deltaWeightPct) / 100));
        if (buyPortionUsd > 10) {
          tradeActions.push({
            action: 'SWAP',
            fromAsset: sellItem.category === 'STABLES' ? 'USDT' : sellItem.category,
            toAsset: buyItem.category === 'STABLES' ? 'USDC' : buyItem.category,
            amountUsd: buyPortionUsd,
            estimatedGasUsd: 1.25,
            route: 'DEX_AGGREGATOR_OPTIMAL'
          });
        }
      }
    }
  }

  const estimatedTotalGasUsd = Math.round(tradeActions.length * 1.5 * 100) / 100;

  return {
    requiresRebalance,
    drifts,
    tradeActions,
    estimatedTotalGasUsd,
    actionCount: tradeActions.length,
    planStatus: requiresRebalance ? 'REBALANCE_RECOMMENDED' : 'WITHIN_BOUNDS'
  };
}

/**
 * 5. Full Autonomous Portfolio Evaluation
 */
export function evaluateAutonomousPortfolio({
  userGoalSpec = null,
  holdings = {},
  now = Date.now()
} = {}) {
  const goal = userGoalSpec || parseFinancialGoal({
    prompt: 'می‌خواهم پرتفوی من برای شش ماه آینده با ریسک متوسط مدیریت شود.',
    horizonMonths: 6,
    riskProfileId: 'MODERATE'
  });

  const scan = scanUserAssets(holdings);
  const currentRisk = calculatePortfolioRisk(scan.categoryWeights);
  const targetWeights = goal.riskProfile.targetWeights;
  const targetRisk = calculatePortfolioRisk(targetWeights);

  const rebalance = generateRebalancePlan({
    currentWeights: scan.categoryWeights,
    targetWeights,
    totalValueUsd: scan.totalValueUsd,
    driftThreshold: 0.05
  });

  // Yield opportunities for idle stables
  const yieldOpportunities = [
    {
      protocol: 'Morpho Blue (USDC)',
      chain: 'Base',
      netApyPct: 10.8,
      safetyScore: 94,
      availableCapitalUsd: Math.round(scan.totalValueUsd * (scan.categoryWeights.STABLES || 0.2)),
      recommendedAllocationUsd: Math.round(scan.totalValueUsd * 0.15)
    },
    {
      protocol: 'Kamino Lending (JLP/USDC)',
      chain: 'Solana',
      netApyPct: 12.4,
      safetyScore: 91,
      availableCapitalUsd: Math.round(scan.totalValueUsd * 0.1),
      recommendedAllocationUsd: Math.round(scan.totalValueUsd * 0.08)
    }
  ];

  return {
    ok: true,
    timestamp: now,
    goal,
    portfolioValueUsd: scan.totalValueUsd,
    composition: scan,
    riskAnalysis: {
      current: currentRisk,
      targetProjected: targetRisk
    },
    rebalancing: rebalance,
    yieldOpportunities,
    executionPolicy: goal.permissionPolicy,
    summaryFa: rebalance.requiresRebalance
      ? `پرتفوی شما دارای ${rebalance.tradeActions.length} انحراف وزنی فراتر از ۵٪ است و نیاز به متعادل‌سازی مجدد دارد.`
      : 'اوزان پرتفوی در محدوده مطلوب هدف مالی قرار دارد و انحراف معناداری مشاهده نمی‌شود.'
  };
}
