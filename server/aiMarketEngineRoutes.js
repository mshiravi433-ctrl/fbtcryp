/**
 * FBT INTENT OS — AI Market Engine & Autonomous Agents Server Routes
 * ---------------------------------------------------------------------------
 * Server-side REST endpoints backing:
 *   - Market Prediction & Analysis Engine (/api/ai/market-prediction)
 *   - 10 Specialist Agents & Delegation (/api/ai/agents)
 *   - Autonomous Portfolio Manager (/api/ai/portfolio/autonomous)
 *   - Simulation & Backtesting Engine (/api/ai/simulation/*)
 *   - Proactive AI & Event Bus (/api/ai/proactive/*)
 *   - AI Agent Marketplace (/api/ai/marketplace/*)
 */

import express from 'express';
import {
  synthesizePrediction,
  PREDICTION_TIMEFRAMES
} from '../src/lib/brain/marketPredictionEngine.js';
import {
  agentOrchestrator10,
  AGENT_IDS,
  AGENT_SPECS
} from '../src/lib/brain/agentOrchestrator10.js';
import {
  evaluateAutonomousPortfolio,
  parseFinancialGoal
} from '../src/lib/brain/autonomousPortfolioManager.js';
import {
  runBacktest,
  runMonteCarloSimulation,
  compareStrategies,
  estimateExecutionImpact,
  PaperTradingSession
} from '../src/lib/brain/simulationBacktestEngine.js';
import {
  proactiveAi,
  AUTONOMY_LEVELS
} from '../src/lib/brain/proactiveAiScheduler.js';
import {
  agentMarketplace,
  PRICING_MODELS
} from '../src/lib/brain/agentMarketplace.js';
import { fetchOhlc, fetchMarkets } from './providers.js';
import { resolveAsset } from './intentMonitoring.js';

export const aiMarketEngineRouter = express.Router();

/**
 * 1. Market Prediction & Multi-timeframe Technical Analysis
 */
aiMarketEngineRouter.get('/market-prediction', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTC').toUpperCase();
    const timeframe = String(req.query.timeframe || '4h');

    const resolved = resolveAsset({ symbol });
    if (!resolved) return res.status(400).json({ ok: false, error: 'UNSUPPORTED_SYMBOL' });
    // A missing feed is an outage, never a synthetic market. This endpoint is
    // technical-only until real volume/on-chain/sentiment adapters are wired.
    const ohlc = await fetchOhlc(resolved.coinId, 30);
    if (!Array.isArray(ohlc) || ohlc.length < 15 || ohlc.some((c) => !Array.isArray(c) || c.length < 5 || ![c[2], c[3], c[4]].every((v) => Number.isFinite(Number(v)) && Number(v) > 0))) {
      return res.status(503).json({ ok: false, error: 'INSUFFICIENT_REAL_CANDLES', source: 'CoinGecko OHLC' });
    }
    const closes = ohlc.map((c) => Number(c[4]));
    const highs = ohlc.map((c) => Number(c[2]));
    const lows = ohlc.map((c) => Number(c[3]));
    const prediction = synthesizePrediction({ symbol, timeframe, closes, highs, lows, volumes: [], onChain: {}, sentiment: {} });
    prediction.provenance = { source: 'CoinGecko OHLC', sourceUrl: `https://www.coingecko.com/en/coins/${resolved.coinId}`, receivedAt: Date.now(), observedAt: Number(ohlc.at(-1)[0]), missing: ['volume', 'onchain', 'sentiment'] };
    prediction.indicators.volume = { status: 'UNAVAILABLE', rvol: null, volumeSpike: null };
    prediction.indicators.onChain = { status: 'UNAVAILABLE', onChainBias: null };
    prediction.indicators.sentiment = { status: 'UNAVAILABLE', sentimentState: null };
    prediction.disclaimerFa = 'این تحلیل فقط بر کندل‌های واقعی دریافت‌شده استوار است؛ حجم، آن‌چین و احساسات بازار در این مسیر خوانده نشده‌اند و قطعیت مالی ندارد.';
    res.json(prediction);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 2. 10 Specialized Agents: Status & Reports
 */
const getAgentsHandler = (req, res) => {
  try {
    const agents = agentOrchestrator10.getAllAgents();
    res.json({
      ok: true,
      count: agents.length,
      agents
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

aiMarketEngineRouter.get('/agents', getAgentsHandler);
aiMarketEngineRouter.get('/specialist-agents', getAgentsHandler);
aiMarketEngineRouter.get('/agents-10', getAgentsHandler);

/**
 * 2b. Dispatch task to an agent or delegate
 */
const postTaskHandler = async (req, res) => {
  try {
    const { agentId, taskType, params = {}, delegateTo = null } = req.body || {};

    if (delegateTo) {
      const agent = agentOrchestrator10.getAgent(agentId || 'trading-agent');
      if (!agent) return res.status(404).json({ ok: false, error: 'AGENT_NOT_FOUND' });
      const delRes = await agent.delegateTask(delegateTo, { type: taskType, params }, agentOrchestrator10);
      return res.json(delRes);
    }

    if (agentId) {
      const agent = agentOrchestrator10.getAgent(agentId);
      if (!agent) return res.status(404).json({ ok: false, error: 'AGENT_NOT_FOUND' });
      const taskRes = await agent.executeTask({ type: taskType, params });
      return res.json(taskRes);
    }

    const dispatchRes = await agentOrchestrator10.dispatchIntent(taskType, params);
    res.json(dispatchRes);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

aiMarketEngineRouter.post('/agents/task', postTaskHandler);
aiMarketEngineRouter.post('/specialist-agents/task', postTaskHandler);

/**
 * 2c. Agent Audit Log
 */
const getAuditHandler = (req, res) => {
  try {
    const limit = Number(req.query.limit) || 25;
    const filter = req.query.agentId || null;
    const logs = agentOrchestrator10.getAuditTrail(limit, filter);
    res.json({ ok: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

aiMarketEngineRouter.get('/agents/audit', getAuditHandler);
aiMarketEngineRouter.get('/specialist-agents/audit', getAuditHandler);

/**
 * 3. Autonomous Portfolio Manager
 */
aiMarketEngineRouter.post('/portfolio/autonomous', (req, res) => {
  try {
    const { prompt, horizonMonths, riskProfileId, holdings, permissionPolicyId } = req.body || {};

    const goal = parseFinancialGoal({
      prompt: prompt || 'می‌خواهم پرتفوی من برای شش ماه آینده با ریسک متوسط مدیریت شود.',
      horizonMonths: horizonMonths || 6,
      riskProfileId: riskProfileId || 'MODERATE',
      permissionPolicyId: permissionPolicyId || 'REQUIRE_APPROVAL'
    });

    const evaluation = evaluateAutonomousPortfolio({
      userGoalSpec: goal,
      holdings: holdings || {}
    });

    res.json(evaluation);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 4. Simulation & Backtesting Engine
 */
aiMarketEngineRouter.post('/simulation/backtest', (req, res) => {
  try {
    const { strategyId, initialCapitalUsd, feeBps, slippageBps } = req.body || {};
    const result = runBacktest({
      strategyId: strategyId || 'TREND_FOLLOWING_EMA',
      initialCapitalUsd: Number(initialCapitalUsd) || 10000,
      feeBps: Number(feeBps) || 10,
      slippageBps: Number(slippageBps) || 15
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/simulation/monte-carlo', (req, res) => {
  try {
    const { initialCapitalUsd, expectedReturnAnnualPct, volatilityAnnualPct, simulatedDays, iterations } = req.body || {};
    const result = runMonteCarloSimulation({
      initialCapitalUsd: Number(initialCapitalUsd) || 10000,
      expectedReturnAnnualPct: Number(expectedReturnAnnualPct) || 25,
      volatilityAnnualPct: Number(volatilityAnnualPct) || 35,
      simulatedDays: Number(simulatedDays) || 180,
      iterations: Number(iterations) || 500
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/simulation/compare', (req, res) => {
  try {
    const { initialCapitalUsd } = req.body || {};
    const result = compareStrategies({ initialCapitalUsd: Number(initialCapitalUsd) || 10000 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/simulation/impact', (req, res) => {
  try {
    const { tradeSizeUsd, poolTvlUsd, chain } = req.body || {};
    const result = estimateExecutionImpact({
      tradeSizeUsd: Number(tradeSizeUsd) || 5000,
      poolTvlUsd: Number(poolTvlUsd) || 1_000_000,
      chain: chain || 'arbitrum'
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 5. Proactive AI: Alerts, Scheduler & Autonomy Config
 */
aiMarketEngineRouter.get('/proactive/alerts', (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const alerts = proactiveAi.getAlerts(limit);
    res.json({
      ok: true,
      autonomyLevel: proactiveAi.userSettings.autonomyLevel,
      alertPreferences: proactiveAi.userSettings.alertPreferences,
      alerts
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/proactive/sweep', (req, res) => {
  try {
    const sweep = proactiveAi.runSweep(req.body || {});
    res.json(sweep);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.get('/proactive/digest', (req, res) => {
  try {
    const period = String(req.query.period || 'DAILY').toUpperCase();
    const digest = proactiveAi.generateDigest(period);
    res.json({ ok: true, digest });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/proactive/autonomy', (req, res) => {
  try {
    const { autonomyLevel, alertPreferences } = req.body || {};
    if (autonomyLevel) proactiveAi.setAutonomyLevel(autonomyLevel);
    if (alertPreferences) proactiveAi.updateAlertPreferences(alertPreferences);
    res.json({
      ok: true,
      autonomyLevel: proactiveAi.userSettings.autonomyLevel,
      alertPreferences: proactiveAi.userSettings.alertPreferences
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 6. AI Agent Marketplace: Catalog, Registration, Security Audit & Costs
 */
aiMarketEngineRouter.get('/marketplace', (req, res) => {
  try {
    const { category, type, maxPrice } = req.query;
    const agents = agentMarketplace.listAgents({
      category,
      type,
      maxPrice: maxPrice ? Number(maxPrice) : null
    });
    res.json({
      ok: true,
      count: agents.length,
      pricingModels: PRICING_MODELS,
      agents
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/marketplace/register', (req, res) => {
  try {
    const regRes = agentMarketplace.registerDeveloperAgent(req.body || {});
    res.json(regRes);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/marketplace/audit', (req, res) => {
  try {
    const { agentId, requestedTools, userPermissions } = req.body || {};
    const auditRes = agentMarketplace.auditAgentPreExecution(agentId, requestedTools, userPermissions);
    res.json(auditRes);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

aiMarketEngineRouter.post('/marketplace/cost', (req, res) => {
  try {
    const { agentId, computeUnits } = req.body || {};
    const costRes = agentMarketplace.calculateExecutionCost(agentId, Number(computeUnits) || 100);
    res.json(costRes);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default aiMarketEngineRouter;

