import { AGENT_IDS, createAgentRun, nowMs } from './contracts.js';

export function selectAgents({ intentType, hasPortfolio, executionRequested }) {
  const picked = ['intent'];
  if (intentType === 'PORTFOLIO_ANALYSIS' || hasPortfolio) {
    picked.push('wallet', 'portfolio', 'market', 'risk', 'strategy');
  }
  if (intentType === 'MONITORING_REQUEST') {
    picked.push('portfolio', 'monitoring');
  }
  if (intentType === 'TRADE_EXECUTION' || executionRequested) {
    picked.push('wallet', 'execution', 'risk', 'monitoring');
  }
  return Array.from(new Set(picked)).filter((id) => AGENT_IDS.includes(id));
}

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function runIntentAgent(context = {}) {
  return {
    summary: context.message || '',
    route: context.currentRoute || '/intent',
    confidence: 0.86
  };
}

async function runWalletAgent(context = {}) {
  const wallet = context.walletContext || {};
  return {
    connected: Boolean(wallet.address || wallet.connected),
    chain: wallet.chainId || wallet.chain || null,
    address: wallet.address || null,
    confidence: wallet.address ? 0.91 : 0.62
  };
}

async function runPortfolioAgent(context = {}) {
  const portfolio = context.portfolioContext || {};
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const totalValue = safeNumber(portfolio.totalValue, null);
  const concentration = positions.length
    ? Math.max(...positions.map((position) => safeNumber(position.weightPct ?? position.weight ?? 0, 0)))
    : null;
  return {
    totalValue,
    positionCount: positions.length,
    concentration,
    topPositions: positions.slice(0, 3),
    confidence: positions.length ? 0.87 : 0.58
  };
}

async function runMarketAgent(context = {}) {
  const market = context.marketContext || context.analysis || {};
  return {
    sentiment: market.sentiment || 'neutral',
    volatility: market.volatility || 'medium',
    catalysts: Array.isArray(market.catalysts) ? market.catalysts.slice(0, 4) : [],
    confidence: 0.74
  };
}

async function runRiskAgent(context = {}) {
  const portfolio = context.portfolioContext || {};
  const concentration = safeNumber(portfolio.concentrationPct, null)
    ?? (Array.isArray(portfolio.positions) && portfolio.positions.length
      ? Math.max(...portfolio.positions.map((position) => safeNumber(position.weightPct ?? position.weight ?? 0, 0)))
      : null);
  const riskProfile = context.state?.collectedSlots?.riskProfile || context.riskProfile || null;
  return {
    riskProfile,
    concentration,
    warnings: [
      concentration != null && concentration > 45 ? 'high concentration risk' : null,
      !riskProfile ? 'risk profile missing' : null
    ].filter(Boolean),
    confidence: concentration != null ? 0.89 : 0.68
  };
}

async function runStrategyAgent(context = {}) {
  const horizonMonths = safeNumber(context.state?.collectedSlots?.timeframe || context.horizonMonths || context.goal?.horizonMonths, null);
  const riskProfile = context.state?.collectedSlots?.riskProfile || context.riskProfile || context.goal?.riskProfile || 'medium';
  const options = [
    {
      id: 'defensive-rebalance',
      label: 'Defensive rebalance',
      rationale: 'Reduce concentration and increase stability assets.',
      suitability: riskProfile === 'low' ? 0.93 : 0.72
    },
    {
      id: 'balanced-rotation',
      label: 'Balanced rotation',
      rationale: 'Rotate part of concentrated positions into diversified core exposures.',
      suitability: riskProfile === 'medium' ? 0.96 : 0.78
    },
    {
      id: 'opportunistic-tilt',
      label: 'Opportunistic tilt',
      rationale: 'Reserve a smaller tactical sleeve for catalysts and higher beta.',
      suitability: riskProfile === 'high' ? 0.94 : 0.61
    }
  ];
  return {
    horizonMonths,
    riskProfile,
    options,
    preferredOption: options.slice().sort((a, b) => (b.suitability || 0) - (a.suitability || 0))[0],
    confidence: 0.82
  };
}

async function runExecutionAgent(context = {}) {
  const pendingExecution = context.pendingExecution || context.state?.executionState?.pendingExecution || null;
  return {
    ready: Boolean(pendingExecution),
    action: pendingExecution,
    confidence: pendingExecution ? 0.88 : 0.51
  };
}

async function runMonitoringAgent(context = {}) {
  return {
    suggestedAlerts: ['price drawdown', 'allocation drift', 'execution confirmation'],
    confidence: 0.73
  };
}

const AGENT_RUNNERS = {
  intent: runIntentAgent,
  wallet: runWalletAgent,
  portfolio: runPortfolioAgent,
  market: runMarketAgent,
  risk: runRiskAgent,
  strategy: runStrategyAgent,
  execution: runExecutionAgent,
  monitoring: runMonitoringAgent,
  news: async () => ({ headlines: [], confidence: 0.4 }),
  smartMoney: async () => ({ flows: [], confidence: 0.4 }),
  research: async () => ({ notes: [], confidence: 0.4 })
};

export async function runAgents({ agents, context = {} }) {
  const selectedAgents = Array.isArray(agents) && agents.length
    ? agents
    : selectAgents({
        intentType: context.intentType,
        hasPortfolio: Boolean(context.portfolioContext?.positions?.length),
        executionRequested: Boolean(context.pendingExecution)
      });

  const startedAt = nowMs();
  const results = await Promise.allSettled(
    selectedAgents.map(async (agentId) => {
      const begin = nowMs();
      const runner = AGENT_RUNNERS[agentId] || AGENT_RUNNERS.intent;
      const result = await runner(context);
      return createAgentRun({
        agentId,
        intentId: context.intentId || null,
        taskId: context.taskId || null,
        status: 'ok',
        result,
        confidence: result?.confidence ?? null,
        latency: nowMs() - begin,
        timestamp: nowMs()
      });
    })
  );

  const runs = results.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    return createAgentRun({
      agentId: selectedAgents[index],
      intentId: context.intentId || null,
      taskId: context.taskId || null,
      status: 'error',
      confidence: 0,
      error: entry.reason?.message || String(entry.reason || 'agent failed'),
      latency: null,
      timestamp: nowMs()
    });
  });

  const consensus = synthesizeAgentResults(runs, { startedAt, finishedAt: nowMs() });
  return { selectedAgents, runs, consensus };
}

export function synthesizeAgentResults(runs = [], meta = {}) {
  const successfulRuns = runs.filter((run) => run.status === 'ok');
  const strategy = successfulRuns.find((run) => run.agentId === 'strategy')?.result || null;
  const risk = successfulRuns.find((run) => run.agentId === 'risk')?.result || null;
  const portfolio = successfulRuns.find((run) => run.agentId === 'portfolio')?.result || null;
  const wallet = successfulRuns.find((run) => run.agentId === 'wallet')?.result || null;
  const confidence = successfulRuns.length
    ? Number((successfulRuns.reduce((sum, run) => sum + Number(run.confidence || 0), 0) / successfulRuns.length).toFixed(3))
    : 0;

  return {
    status: successfulRuns.length ? 'ok' : 'degraded',
    preferredOption: strategy?.preferredOption || null,
    options: strategy?.options || [],
    warnings: [
      ...(risk?.warnings || []),
      ...(wallet?.connected ? [] : ['wallet not connected'])
    ],
    portfolio,
    risk,
    confidence,
    startedAt: meta.startedAt || null,
    finishedAt: meta.finishedAt || null
  };
}
