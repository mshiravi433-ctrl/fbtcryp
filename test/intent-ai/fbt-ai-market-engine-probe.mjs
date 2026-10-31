/**
 * FBT INTENT OS — Comprehensive AI Market Engine, 10 Agents & Marketplace Probe
 * ---------------------------------------------------------------------------
 * Validates all required capabilities:
 *   1. Market Prediction Engine (15m, 1h, 4h, 1D, 1W, 1M, 10 indicators, Bayesian confluence)
 *   2. 10 Specialized Agents Architecture & Tool Access
 *   3. Inter-Agent Delegation & A2A Collaboration
 *   4. Autonomous Portfolio Manager (Section 9: Goal, Scan, Risk, Correlation, Drift, Rebalance)
 *   5. Simulation & Backtesting Engine (Section 10: Backtest, Monte Carlo, Paper Trade, Impact)
 *   6. Proactive AI, Scheduler & Event Bus
 *   7. AI Agent Marketplace (MCP, A2A, Registration, 85/15 RevShare, Sandbox Audit)
 *   8. Server REST API routes
 */

import assert from 'node:assert/strict';
import {
  PREDICTION_TIMEFRAMES,
  TIMEFRAME_DETAILS,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateMovingAverages,
  calculateVolatility,
  calculateVolumeAnalysis,
  calculateMarketStructure,
  calculateLiquidityAnalysis,
  calculateOnChainAnalysis,
  calculateSentimentAnalysis,
  synthesizePrediction
} from '../../src/lib/brain/marketPredictionEngine.js';
import {
  AGENT_IDS,
  AGENT_SPECS,
  agentOrchestrator10,
  auditLog,
  FbtSpecialistAgent,
  createAgentMemory
} from '../../src/lib/brain/agentOrchestrator10.js';
import {
  PORTFOLIO_SCHEMA,
  RISK_PROFILES,
  USER_PERMISSION_POLICIES,
  ASSET_CORRELATION_MATRIX,
  parseFinancialGoal,
  scanUserAssets,
  calculatePortfolioRisk,
  generateRebalancePlan,
  evaluateAutonomousPortfolio
} from '../../src/lib/brain/autonomousPortfolioManager.js';
import {
  runBacktest,
  runMonteCarloSimulation,
  compareStrategies,
  PaperTradingSession,
  estimateExecutionImpact
} from '../../src/lib/brain/simulationBacktestEngine.js';
import {
  proactiveAi,
  eventBus,
  AUTONOMY_LEVELS,
  ALERT_CATEGORIES,
  ProactiveEventBus
} from '../../src/lib/brain/proactiveAiScheduler.js';
import {
  agentMarketplace,
  PRICING_MODELS,
  PROTOCOL_SUPPORT,
  VERIFICATION_TIERS
} from '../../src/lib/brain/agentMarketplace.js';

console.log('--- STARTING FBT AI MARKET ENGINE & INTENT OS PROBE ---');

/* ==========================================================================
   TEST 1: MARKET ANALYSIS & PREDICTION ENGINE
   ========================================================================== */
console.log('[1/7] Testing Market Prediction & Technical Analysis Engine...');

// Check timeframes
assert.deepEqual(PREDICTION_TIMEFRAMES, ['15m', '1h', '4h', '1D', '1W', '1M'], 'All 6 required timeframes must be supported');
for (const tf of PREDICTION_TIMEFRAMES) {
  assert.ok(TIMEFRAME_DETAILS[tf], `Timeframe details must exist for ${tf}`);
}

// Indicator computations
const sampleCloses = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 114, 113, 115, 117, 116, 118, 120, 119, 122];
const sampleHighs = sampleCloses.map((c) => c + 1.5);
const sampleLows = sampleCloses.map((c) => c - 1.5);
const sampleVols = sampleCloses.map(() => 8000);

const rsi = calculateRSI(sampleCloses, 14);
assert.ok(Number.isFinite(rsi.value), 'RSI value must be finite');
assert.ok(rsi.value >= 0 && rsi.value <= 100, 'RSI must be bounded between 0 and 100');

const macd = calculateMACD(sampleCloses, 12, 26, 9);
assert.ok(macd !== null, 'MACD object returned');

const bb = calculateBollingerBands(sampleCloses, 20, 2);
assert.ok(bb.upper > bb.lower, 'Bollinger upper band must exceed lower band');
assert.ok(bb.bandwidth > 0, 'Bollinger bandwidth must be positive');

const ma = calculateMovingAverages(sampleCloses);
assert.ok(ma.sma20 > 0, 'SMA20 must be calculated');

const vol = calculateVolatility(sampleHighs, sampleLows, sampleCloses, 14);
assert.ok(vol.atr > 0, 'ATR volatility must be positive');
assert.ok(['LOW_COMPRESSION', 'NORMAL', 'EXPANDED_HIGH'].includes(vol.regime), 'Valid volatility regime');

const volume = calculateVolumeAnalysis(sampleVols, sampleCloses, 20);
assert.ok(volume.rvol > 0, 'Relative volume must be positive');

const struct = calculateMarketStructure(sampleHighs, sampleLows, sampleCloses);
assert.ok(['BULLISH', 'BEARISH', 'RANGING'].includes(struct.structure), 'Market structure classified');

const liq = calculateLiquidityAnalysis(sampleHighs, sampleLows, sampleCloses);
assert.ok(Array.isArray(liq.fairValueGaps), 'FVG array returned');

const onchain = calculateOnChainAnalysis({ mvrv: 1.2, exchangeNetflowUsd: -50000000, whaleAccumulationScore: 85 });
assert.equal(onchain.onChainBias, 'BULLISH', 'Heavy outflows & whale score must produce bullish bias');

const sent = calculateSentimentAnalysis({ fearGreedIndex: 20 });
assert.equal(sent.sentimentState, 'EXTREME_FEAR', 'Fear & Greed <= 25 is Extreme Fear');
assert.equal(sent.contrarianBias, 'BULLISH', 'Contrarian bias is Bullish in extreme fear');

// Bayesian scenario synthesis
const pred = synthesizePrediction({
  symbol: 'BTC',
  timeframe: '4h',
  closes: sampleCloses,
  highs: sampleHighs,
  lows: sampleLows,
  volumes: sampleVols
});

assert.ok(pred.ok, 'Prediction synthesis must succeed');
assert.equal(
  pred.scenarios.bullish.probabilityPct + pred.scenarios.bearish.probabilityPct + pred.scenarios.neutral.probabilityPct,
  100,
  'Scenarios must strictly sum to 100%'
);
assert.ok(pred.confidence.scorePct >= 40 && pred.confidence.scorePct <= 90, 'Confidence score within honest bounds');
assert.ok(pred.keyLevels.support1 > 0, 'Support 1 must be calculated');
assert.ok(pred.keyLevels.resistance1 > 0, 'Resistance 1 must be calculated');
assert.ok(pred.keyLevels.invalidationPrice > 0, 'Invalidation price must be present');
assert.ok(pred.contributingFactors.length > 0, 'Contributing factors must be reported');
assert.ok(pred.predictionRisk.level, 'Risk level must be present');
assert.ok(pred.validUntil > Date.now(), 'Validity time window must be in future');
assert.ok(pred.disclaimerFa.includes('قطعیت'), 'Honest disclaimer must be present');
console.log('✓ Market Prediction Engine passed 100%');

/* ==========================================================================
   TEST 2: 10 SPECIALIZED AGENTS ARCHITECTURE & DELEGATION
   ========================================================================== */
console.log('[2/7] Testing 10 Specialized Agents Architecture & A2A Collaboration...');

assert.equal(AGENT_IDS.length, 10, 'Must have exactly 10 specialized agent IDs');
const expectedIds = [
  'trading-agent', 'portfolio-manager', 'arbitrage-agent', 'market-maker-agent',
  'yield-optimizer', 'risk-manager', 'rebalancing-agent', 'research-agent',
  'onchain-agent', 'smart-money-agent'
];
assert.deepEqual(AGENT_IDS, expectedIds, '10 agent IDs must match exact specification');

// Verify each agent spec
for (const id of AGENT_IDS) {
  const spec = AGENT_SPECS[id];
  assert.ok(spec.goalFa, `Agent ${id} must have a clear objective (goalFa)`);
  assert.ok(Array.isArray(spec.allowedTools) && spec.allowedTools.length > 0, `Agent ${id} must have allowed tools`);
  assert.ok(spec.maxRiskTier, `Agent ${id} must have controlled risk tier`);
}

// Memory verification
const mem = createAgentMemory('trading-agent');
assert.ok(mem.shortTerm !== undefined, 'Short term memory present');
assert.ok(mem.longTerm !== undefined, 'Long term memory present');
assert.ok(Array.isArray(mem.episodic), 'Episodic memory array present');

// Tool access control
const tradingAgent = agentOrchestrator10.getAgent('trading-agent');
assert.ok(tradingAgent.verifyToolAccess('dex_swap').ok, 'Trading agent has dex_swap access');
assert.equal(tradingAgent.verifyToolAccess('unauthorized_secret_tool').ok, false, 'Unauthorized tool must be denied');

// Task execution and performance metrics
const taskRes = await tradingAgent.executeTask({ type: 'SWAP', params: { from: 'USDT', to: 'ETH', amount: 500 } });
assert.ok(taskRes.ok, 'Task execution succeeded');
assert.equal(taskRes.agentId, 'trading-agent');
assert.ok(taskRes.evaluation.meetsBenchmark, 'Post-execution evaluation benchmark passed');

// Delegation (A2A Collaboration)
const delRes = await tradingAgent.delegateTask('risk-manager', { type: 'RISK_CHECK', params: {} }, agentOrchestrator10);
assert.ok(delRes.ok, 'Delegation to Risk Manager must succeed');
assert.equal(delRes.agentId, 'risk-manager');

// Audit log check
const recentAudit = auditLog.getRecentLogs(5);
assert.ok(recentAudit.length >= 2, 'Audit log entries recorded');
assert.ok(recentAudit[0].timestamp > 0, 'Audit timestamp recorded');
console.log('✓ 10 Agents Architecture & Delegation passed 100%');

/* ==========================================================================
   TEST 3: AUTONOMOUS PORTFOLIO MANAGER (Section 9)
   ========================================================================== */
console.log('[3/7] Testing Autonomous Portfolio Manager (Section 9)...');

const goal = parseFinancialGoal({
  prompt: 'می‌خواهم پرتفوی من برای شش ماه آینده با ریسک متوسط مدیریت شود.',
  horizonMonths: 6,
  riskProfileId: 'MODERATE'
});
assert.equal(goal.horizonMonths, 6, 'Parsed horizon is 6 months');
assert.equal(goal.riskProfile.id, 'MODERATE', 'Risk profile is MODERATE');

const scanned = scanUserAssets({
  BTC: { balance: 0.1, priceUsd: 68000 },
  ETH: { balance: 1.5, priceUsd: 3400 },
  USDT: { balance: 3000, priceUsd: 1.0 }
});
assert.equal(scanned.assetCount, 3, 'Scanned 3 assets');
assert.ok(scanned.totalValueUsd > 14000, 'Total portfolio value computed');

const risk = calculatePortfolioRisk(scanned.categoryWeights);
assert.ok(risk.annualizedVolatilityPct > 0, 'Portfolio volatility calculated');
assert.ok(risk.var95DailyPct > 0, '1-day 95% VaR calculated');
assert.ok(risk.sharpeRatio !== null, 'Sharpe ratio computed');
assert.ok(risk.correlationMatrix.BTC.ETH > 0.7, 'Correlation between BTC and ETH reflects realistic positive value');

const rebalance = generateRebalancePlan({
  currentWeights: { BTC: 0.7, ETH: 0.1, STABLES: 0.2, SOL: 0, ALTS: 0 },
  targetWeights: { BTC: 0.4, ETH: 0.25, STABLES: 0.2, SOL: 0.1, ALTS: 0.05 },
  totalValueUsd: 20000,
  driftThreshold: 0.05
});
assert.equal(rebalance.requiresRebalance, true, 'Drift >= 5% must trigger rebalance proposal');
assert.ok(rebalance.tradeActions.length > 0, 'Rebalancing swap actions generated');

const fullEval = evaluateAutonomousPortfolio({ userGoalSpec: goal });
assert.ok(fullEval.ok, 'Full autonomous portfolio evaluation succeeded');
assert.ok(fullEval.yieldOpportunities.length > 0, 'Yield opportunities identified');
assert.ok(fullEval.executionPolicy.id, 'User execution policy enforced');
console.log('✓ Autonomous Portfolio Manager passed 100%');

/* ==========================================================================
   TEST 4: SIMULATION & BACKTESTING ENGINE (Section 10)
   ========================================================================== */
console.log('[4/7] Testing Simulation & Backtesting Engine (Section 10)...');

const bt = runBacktest({ initialCapitalUsd: 10000 });
assert.equal(bt.isSimulation, true, 'Backtest must be flagged isSimulation: true');
assert.equal(bt.mode, 'BACKTEST');
assert.ok(Number.isFinite(bt.totalReturnPct), 'Total return finite');
assert.ok(Number.isFinite(bt.maxDrawdownPct), 'Max drawdown finite');
assert.ok(bt.profitFactor >= 0, 'Profit factor calculated and non-negative');

const mc = runMonteCarloSimulation({ iterations: 200 });
assert.equal(mc.isSimulation, true, 'Monte Carlo flagged as simulation');
assert.ok(mc.percentiles.p50MedianUsd > 0, 'Median P50 calculated');
assert.ok(mc.profitProbabilityPct >= 0 && mc.profitProbabilityPct <= 100, 'Profit probability percentage valid');

const cmp = compareStrategies();
assert.equal(cmp.isSimulation, true);
assert.equal(cmp.strategies.length, 3, 'Compares 3 strategies side-by-side');

const paper = new PaperTradingSession({ initialBalanceUsd: 10000 });
const paperOrder = paper.placeVirtualOrder({ type: 'BUY', symbol: 'ETH', currentPrice: 3400, amountUsd: 2000 });
assert.ok(paperOrder.ok, 'Paper order executed');
assert.equal(paperOrder.order.isSimulation, true, 'Paper order flagged isSimulation: true');
assert.equal(paper.virtualBalanceUsd, 8000, 'Virtual cash updated');

const snap = paper.getSnapshot({ ETH: 3600 });
assert.ok(snap.positionsValueUsd > 2000, 'Unrealized paper gain computed');

const impact = estimateExecutionImpact({ tradeSizeUsd: 10000, poolTvlUsd: 2000000 });
assert.ok(impact.estimatedSlippagePct >= 0, 'Slippage estimated');
assert.ok(impact.estimatedGasUsd > 0, 'Gas cost estimated');
console.log('✓ Simulation & Backtesting Engine passed 100%');

/* ==========================================================================
   TEST 5: PROACTIVE AI & EVENT BUS / SCHEDULER
   ========================================================================== */
console.log('[5/7] Testing Proactive AI & Event Bus / Scheduler...');

let busEventFired = false;
eventBus.on('ALERT_DISPATCHED', (evt) => {
  if (evt) busEventFired = true;
});

const sweep = proactiveAi.runSweep({
  marketData: { btcPrice: 69000, btcRsi: 74, btcMacdCross: 'BEARISH_CROSS' },
  portfolioData: { healthFactor: 1.22 }
});
assert.ok(sweep.ok, 'Sweep completed');
assert.ok(sweep.alertsCreated >= 2, 'Generated proactive alerts for market and risk');
assert.equal(busEventFired, true, 'Event Bus received emitted alert');

const digest = proactiveAi.generateDigest('DAILY');
assert.ok(digest.titleFa.includes('روزانه'), 'Daily digest generated');

proactiveAi.setAutonomyLevel('SEMI_AUTONOMOUS');
assert.equal(proactiveAi.userSettings.autonomyLevel, 'SEMI_AUTONOMOUS', 'Autonomy level updated');
console.log('✓ Proactive AI & Event Bus passed 100%');

/* ==========================================================================
   TEST 6: AI AGENT MARKETPLACE & REVENUE SHARING
   ========================================================================== */
console.log('[6/7] Testing AI Agent Marketplace & Sandbox Audit...');

const catalog = agentMarketplace.listAgents();
assert.ok(catalog.length >= 5, 'Marketplace catalog loaded');
assert.ok(catalog.some((a) => a.type === 'NATIVE'), 'Contains native agents');
assert.ok(catalog.some((a) => a.type === 'EXTERNAL'), 'Contains external agents');

// Register developer agent
const devReg = agentMarketplace.registerDeveloperAgent({
  id: 'dev-solana-risk-auditor',
  name: 'Solana Risk Auditor',
  author: 'SolDev Team',
  declaredTools: ['token_profile_query'],
  pricing: { model: 'PAY_PER_USE', feeUsd: 0.10 }
});
assert.ok(devReg.ok, 'Developer registration succeeded');

// Pre-execution sandbox audit
const auditPass = agentMarketplace.auditAgentPreExecution('dev-solana-risk-auditor', ['token_profile_query']);
assert.equal(auditPass.verdict, 'APPROVED', 'Declared tools approved');

const auditFail = agentMarketplace.auditAgentPreExecution('dev-solana-risk-auditor', ['undeclared_malicious_tool']);
assert.equal(auditFail.verdict, 'BLOCKED', 'Undeclared tools blocked');

// 85% developer / 15% protocol revenue share calculation
const cost = agentMarketplace.calculateExecutionCost('dev-solana-risk-auditor', 100);
assert.equal(cost.revenueSharing.developerSharePct, 85, 'Developer gets 85%');
assert.equal(cost.revenueSharing.protocolFeePct, 15, 'Protocol fee is 15%');
assert.equal(cost.baseFeeUsd, 0.10);
assert.equal(cost.revenueSharing.developerShareUsd, 0.085);
assert.equal(cost.revenueSharing.protocolFeeUsd, 0.015);
console.log('✓ AI Agent Marketplace & Revenue Sharing passed 100%');

/* ==========================================================================
   TEST 7: SERVER REST API INTEGRATION
   ========================================================================== */
console.log('[7/7] Testing Server REST Routes Integration...');

import { aiMarketEngineRouter } from '../../server/aiMarketEngineRoutes.js';
assert.ok(typeof aiMarketEngineRouter === 'function', 'aiMarketEngineRouter is valid Express router');

console.log('--- ALL FBT AI MARKET ENGINE PROBES PASSED SUCCESSFULLY (7/7) ---');
