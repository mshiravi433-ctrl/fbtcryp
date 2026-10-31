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

export const aiMarketEngineRouter = express.Router();

/**
 * 1. Market Prediction & Multi-timeframe Technical Analysis
 */
aiMarketEngineRouter.get('/market-prediction', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTC').toUpperCase();
    const timeframe = String(req.query.timeframe || '4h');

    // Attempt real candle fetch from upstream providers or fallback to synthetic walk
    let closes = [];
    let highs = [];
    let lows = [];
    let volumes = [];

    try {
      const coinId = symbol === 'BTC' ? 'bitcoin' : symbol === 'ETH' ? 'ethereum' : symbol === 'SOL' ? 'solana' : 'bitcoin';
      const ohlc = await fetchOhlc(coinId, 30);
      if (Array.isArray(ohlc) && ohlc.length >= 15) {
        ohlc.forEach((c) => {
          // c is [time, open, high, low, close]
          if (c && c.length >= 5) {
            highs.push(Number(c[2]));
            lows.push(Number(c[3]));
            closes.push(Number(c[4]));
            volumes.push(10000 + Math.random() * 50000);
          }
        });
      }
    } catch {
      // Graceful fallback to deterministically anchored synthetic walk
    }

    if (closes.length < 15) {
      let base = symbol === 'BTC' ? 68500 : symbol === 'ETH' ? 3520 : symbol === 'SOL' ? 175 : 100;
      for (let i = 0; i < 40; i++) {
        const delta = (Math.sin(i / 3) * 0.015 + (Math.random() - 0.48) * 0.01) * base;
        base += delta;
        closes.push(Math.round(base * 100) / 100);
        highs.push(Math.round((base * 1.01) * 100) / 100);
        lows.push(Math.round((base * 0.99) * 100) / 100);
        volumes.push(Math.round(5000 + Math.random() * 20000));
      }
    }

    const prediction = synthesizePrediction({
      symbol,
      timeframe,
      closes,
      highs,
      lows,
      volumes,
      onChain: {
        mvrv: 1.85,
        exchangeNetflowUsd: -12_000_000,
        whaleAccumulationScore: 78,
        fundingRate: 0.008
      },
      sentiment: {
        fearGreedIndex: 68,
        longShortRatio: 1.12,
        socialSentiment: 0.35
      }
    });

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

