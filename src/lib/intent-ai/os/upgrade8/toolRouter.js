import { TOOL_IDS, createToolRun, nowMs } from './contracts.js';

const DEFAULT_REGISTRY = {
  wallet: { category: 'wallet', chains: ['evm', 'solana'], assets: ['*'], freshnessMs: 30_000, permission: 'VIEW' },
  portfolio: { category: 'portfolio', chains: ['evm', 'solana'], assets: ['*'], freshnessMs: 120_000, permission: 'ANALYZE' },
  swap: { category: 'execution', chains: ['evm', 'solana'], assets: ['*'], freshnessMs: 15_000, permission: 'EXECUTE' },
  bridge: { category: 'execution', chains: ['evm', 'solana'], assets: ['*'], freshnessMs: 15_000, permission: 'EXECUTE' },
  lending: { category: 'defi', chains: ['evm'], assets: ['*'], freshnessMs: 120_000, permission: 'EXECUTE' },
  farm: { category: 'defi', chains: ['evm'], assets: ['*'], freshnessMs: 120_000, permission: 'EXECUTE' },
  futures: { category: 'derivatives', chains: ['evm'], assets: ['*'], freshnessMs: 10_000, permission: 'EXECUTE' },
  market: { category: 'market-data', chains: ['*'], assets: ['*'], freshnessMs: 60_000, permission: 'ANALYZE' },
  news: { category: 'intel', chains: ['*'], assets: ['*'], freshnessMs: 600_000, permission: 'ANALYZE' },
  smartMoney: { category: 'intel', chains: ['evm'], assets: ['*'], freshnessMs: 300_000, permission: 'ANALYZE' },
  signals: { category: 'intel', chains: ['*'], assets: ['*'], freshnessMs: 120_000, permission: 'ANALYZE' },
  orders: { category: 'orders', chains: ['evm', 'solana'], assets: ['*'], freshnessMs: 30_000, permission: 'VIEW' },
  navigation: { category: 'ui', chains: ['*'], assets: ['*'], freshnessMs: 0, permission: 'VIEW' },
  notifications: { category: 'alerts', chains: ['*'], assets: ['*'], freshnessMs: 0, permission: 'NOTIFY' },
  simulation: { category: 'safety', chains: ['evm', 'solana'], assets: ['*'], freshnessMs: 15_000, permission: 'SIMULATE' }
};

export function getToolRegistry() {
  return { ...DEFAULT_REGISTRY };
}

function includesWildcard(list = [], value) {
  return Array.isArray(list) && (list.includes('*') || (value != null && list.includes(value)));
}

export function assessToolAvailability(toolId, context = {}) {
  const registry = context.registry || getToolRegistry();
  const tool = registry[toolId];
  if (!tool) {
    return { toolId, supported: false, reason: 'missing-tool-definition' };
  }

  const chainKey = context.chainKey || context.chain || context.walletContext?.chainType || '*';
  const assetKey = context.assetSymbol || context.asset || '*';
  const supported = includesWildcard(tool.chains, chainKey) || includesWildcard(tool.chains, '*');
  const assetSupported = includesWildcard(tool.assets, assetKey) || includesWildcard(tool.assets, '*');
  const freshnessTarget = Number(tool.freshnessMs) || 0;
  const freshAt = Number(context.freshAt || context.timestamp || 0) || null;
  const isFresh = !freshnessTarget || (freshAt && nowMs() - freshAt <= freshnessTarget);

  return {
    toolId,
    supported,
    chainSupported: supported,
    assetSupported,
    freshAt,
    freshnessMs: freshnessTarget,
    stale: freshnessTarget ? !isFresh : false,
    permission: tool.permission,
    meta: tool,
    reason: !supported ? 'unsupported-chain' : !assetSupported ? 'unsupported-asset' : isFresh ? 'ok' : 'stale'
  };
}

export function planToolSequence(intentType) {
  if (intentType === 'PORTFOLIO_ANALYSIS') {
    return ['portfolio', 'market', 'simulation', 'notifications'];
  }
  if (intentType === 'TRADE_EXECUTION') {
    return ['wallet', 'simulation', 'swap', 'notifications'];
  }
  if (intentType === 'MONITORING_REQUEST') {
    return ['portfolio', 'market', 'notifications'];
  }
  return ['market'];
}

export function createToolRunRecord(toolId, context = {}) {
  const availability = assessToolAvailability(toolId, context);
  return createToolRun({
    toolId,
    status: availability.supported && availability.assetSupported ? 'ok' : 'blocked',
    result: availability,
    freshAt: availability.freshAt,
    supported: availability.supported,
    chainSupported: availability.chainSupported,
    assetSupported: availability.assetSupported,
    timestamp: context.timestamp || nowMs()
  });
}

export function summarizeToolState(state = {}) {
  const requested = Array.isArray(state.requested) ? state.requested : [];
  const health = state.health || {};
  return requested.map((toolId) => `${toolId}:${health[toolId]?.reason || 'unknown'}`).join(', ');
}

export function normalizeRequestedTools(intentType, existing = []) {
  return Array.from(new Set([...(existing || []), ...planToolSequence(intentType)])).filter((toolId) => TOOL_IDS.includes(toolId));
}
