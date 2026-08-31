/**
 * FBT INTENT AI OS — unified tool registry.
 * ---------------------------------------------------------------------------
 * One explicit list of every capability the AI gateway can route to. The AI
 * engine picks from this registry instead of owning a separate set of "agents"
 * for wallets, swaps, bridges, farms, lending, futures, stocks and goals.
 *
 * `kind` says what the tool does; `route` is the real FBT API/surface that
 * owns the data. A tool is never a fake function and never a hard-coded
 * balance/price/hash — if the underlying service is unavailable it reports
 * `unavailable` and the chat says so.
 */

export const AI_TOOL_SCHEMA = 'fbt.ai-tool-registry.v1';

export const AI_TOOLS = Object.freeze([
  Object.freeze({ id: 'getPortfolio', kind: 'read', scope: 'portfolio', route: '/v1/ai/context', live: true }),
  Object.freeze({ id: 'getWalletBalances', kind: 'read', scope: 'wallet', route: '/v1/ai/context', live: true }),
  Object.freeze({ id: 'getTokenPrice', kind: 'read', scope: 'market', route: '/v1/market', live: true }),
  Object.freeze({ id: 'getSwapQuote', kind: 'quote', scope: 'swap', route: '/swap', live: true }),
  Object.freeze({ id: 'executeSwap', kind: 'execute', scope: 'swap', route: '/swap', live: true, requiresSignature: true }),
  Object.freeze({ id: 'getBridgeQuote', kind: 'quote', scope: 'bridge', route: '/bridge', live: true }),
  Object.freeze({ id: 'executeBridge', kind: 'execute', scope: 'bridge', route: '/bridge', live: true, requiresSignature: true }),
  Object.freeze({ id: 'sendTransaction', kind: 'execute', scope: 'send', route: '/wallet', live: true, requiresSignature: true }),
  Object.freeze({ id: 'getFarmOpportunities', kind: 'read', scope: 'farm', route: '/v1/ai/context', live: true }),
  Object.freeze({ id: 'getLendingOpportunities', kind: 'read', scope: 'lending', route: '/loan', live: true }),
  Object.freeze({ id: 'getFuturesMarkets', kind: 'read', scope: 'futures', route: '/perp', live: true }),
  Object.freeze({ id: 'getStockMarkets', kind: 'read', scope: 'stocks', route: '/stocks', live: true }),
  Object.freeze({ id: 'createIntent', kind: 'write', scope: 'intent', route: '/intent', live: true }),
  Object.freeze({ id: 'getIntent', kind: 'read', scope: 'intent', route: '/v1/ai/context', live: true }),
  Object.freeze({ id: 'createDCA', kind: 'write', scope: 'automation', route: '/v1/ai/automations', live: true }),
  Object.freeze({ id: 'createFinancialGoal', kind: 'write', scope: 'goal', route: '/v1/ai/goal', live: true }),
  Object.freeze({ id: 'rebalancePortfolio', kind: 'execute', scope: 'portfolio', route: '/portfolio', live: true, requiresSignature: true }),
  Object.freeze({ id: 'getSignals', kind: 'read', scope: 'signals', route: '/signals', live: true }),
  Object.freeze({ id: 'getMarketAnalysis', kind: 'read', scope: 'research', route: '/v1/ai/chat', live: true })
]);

export const listAiTools = () => AI_TOOLS.map((t) => ({ ...t }));

export const findAiTool = (id) => AI_TOOLS.find((t) => t.id === id) || null;
