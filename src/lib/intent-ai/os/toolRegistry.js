/**
 * FBT INTENT OS — Universal Tool Registry
 * ---------------------------------------------------------------------------
 * Spec §2 + §3 + §24
 * Central registry with hierarchical & dynamic loading.
 * AI never sees all tools at once — only relevant subset loads.
 * Every tool has validated schema, never hallucinated.
 */

import { APP_CAPABILITIES, getHierarchyForIntent } from './appCapabilities.js';

export const TOOL_SCHEMA = 'fbt.ai-tool.v1';

// Core tool definitions — wired to real APIs
const TOOLS = [
  // Wallet
  {
    id: 'wallet.getBalances',
    name: 'Get Wallet Balances',
    description: 'Read EVM + Solana balances from real wallet services',
    category: 'wallet',
    capabilities: ['read', 'balance', 'evm', 'solana'],
    inputSchema: { type: 'object', properties: { address: { type: 'string' }, chainId: { type: 'number' } } },
    execute: async (input, ctx) => ctx.walletService?.getBalances?.(input) ?? { ok: false, reason: 'NO_WALLET_SERVICE' },
    readOnly: true,
    requiresWallet: true,
    requiresConfirmation: false,
    supportedChains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144, 501],
    route: '/wallet'
  },
  {
    id: 'wallet.getPortfolio',
    name: 'Get Portfolio Summary',
    description: 'Portfolio holdings, total value, PnL',
    category: 'portfolio',
    capabilities: ['read', 'portfolio', 'pnl', 'allocation'],
    inputSchema: { type: 'object', properties: { includeHistory: { type: 'boolean' } } },
    execute: async (input, ctx) => ctx.portfolioService?.getSummary?.(input) ?? { ok: false, reason: 'NO_PORTFOLIO_SERVICE' },
    readOnly: true,
    requiresWallet: true,
    requiresConfirmation: false,
    route: '/portfolio'
  },
  {
    id: 'wallet.connect',
    name: 'Connect Wallet',
    description: 'Open wallet connect flow',
    category: 'wallet',
    capabilities: ['connect', 'auth'],
    inputSchema: { type: 'object', properties: { chain: { type: 'string' } } },
    execute: async (input, ctx) => ctx.navigation?.navigate?.({ route: '/wallet', params: input }),
    readOnly: false,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/wallet'
  },
  // Trading
  {
    id: 'swap.quote',
    name: 'Get Swap Quote',
    description: 'Get real swap quote from aggregator',
    category: 'trading',
    capabilities: ['quote', 'swap', 'price'],
    inputSchema: {
      type: 'object',
      required: ['fromSymbol', 'toSymbol', 'amount'],
      properties: {
        fromSymbol: { type: 'string' },
        toSymbol: { type: 'string' },
        amount: { type: 'string' },
        chainId: { type: 'number' },
        slippage: { type: 'number' }
      }
    },
    execute: async (input, ctx) => ctx.swapService?.getQuote?.(input) ?? { ok: false, reason: 'NO_SWAP_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    supportedChains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144],
    route: '/swap'
  },
  {
    id: 'swap.execute',
    name: 'Execute Swap',
    description: 'Execute swap with wallet signature',
    category: 'trading',
    capabilities: ['execute', 'swap', 'trade'],
    inputSchema: {
      type: 'object',
      required: ['fromSymbol', 'toSymbol', 'amount', 'chainId'],
      properties: {
        fromSymbol: { type: 'string' },
        toSymbol: { type: 'string' },
        amount: { type: 'string' },
        chainId: { type: 'number' },
        slippage: { type: 'number' }
      }
    },
    execute: async (input, ctx) => ctx.swapService?.execute?.(input) ?? { ok: false, reason: 'NO_SWAP_SERVICE' },
    readOnly: false,
    requiresWallet: true,
    requiresConfirmation: true,
    supportedChains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144],
    route: '/swap'
  },
  {
    id: 'bridge.quote',
    name: 'Get Bridge Quote',
    description: 'Get cross-chain bridge quote',
    category: 'trading',
    capabilities: ['quote', 'bridge', 'cross-chain'],
    inputSchema: {
      type: 'object',
      required: ['fromChain', 'toChain', 'token', 'amount'],
      properties: {
        fromChain: { type: 'number' },
        toChain: { type: 'number' },
        token: { type: 'string' },
        amount: { type: 'string' }
      }
    },
    execute: async (input, ctx) => ctx.bridgeService?.getQuote?.(input) ?? { ok: false, reason: 'NO_BRIDGE_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/bridge'
  },
  {
    id: 'bridge.execute',
    name: 'Execute Bridge',
    description: 'Execute bridge transfer',
    category: 'trading',
    capabilities: ['execute', 'bridge', 'cross-chain'],
    inputSchema: {
      type: 'object',
      required: ['fromChain', 'toChain', 'token', 'amount'],
      properties: {
        fromChain: { type: 'number' },
        toChain: { type: 'number' },
        token: { type: 'string' },
        amount: { type: 'string' }
      }
    },
    execute: async (input, ctx) => ctx.bridgeService?.execute?.(input) ?? { ok: false, reason: 'NO_BRIDGE_SERVICE' },
    readOnly: false,
    requiresWallet: true,
    requiresConfirmation: true,
    route: '/bridge'
  },
  {
    id: 'send.execute',
    name: 'Send Tokens',
    description: 'Send tokens to address',
    category: 'trading',
    capabilities: ['execute', 'send', 'transfer'],
    inputSchema: {
      type: 'object',
      required: ['to', 'amount', 'token'],
      properties: {
        to: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string' },
        chainId: { type: 'number' }
      }
    },
    execute: async (input, ctx) => ctx.walletService?.send?.(input) ?? { ok: false, reason: 'NO_WALLET_SERVICE' },
    readOnly: false,
    requiresWallet: true,
    requiresConfirmation: true,
    route: '/wallet'
  },
  // DeFi
  {
    id: 'yield.discover',
    name: 'Discover Yield Opportunities',
    description: 'Find best yield farms, APY, risk',
    category: 'defi',
    capabilities: ['read', 'yield', 'discover', 'apy'],
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string' },
        chainId: { type: 'number' },
        riskTolerance: { type: 'string', enum: ['low', 'medium', 'high'] },
        minApy: { type: 'number' }
      }
    },
    execute: async (input, ctx) => ctx.yieldService?.discover?.(input) ?? { ok: false, reason: 'NO_YIELD_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/earn'
  },
  {
    id: 'farming.list',
    name: 'List Farming Pools',
    description: 'List farming pools with APY and TVL',
    category: 'defi',
    capabilities: ['read', 'farm', 'pools'],
    inputSchema: { type: 'object', properties: { chainId: { type: 'number' }, protocol: { type: 'string' } } },
    execute: async (input, ctx) => ctx.farmService?.list?.(input) ?? { ok: false, reason: 'NO_FARM_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/farm'
  },
  {
    id: 'lending.markets',
    name: 'Get Lending Markets',
    description: 'Lending/borrowing markets, rates',
    category: 'defi',
    capabilities: ['read', 'lending', 'borrowing', 'markets'],
    inputSchema: { type: 'object', properties: { chainId: { type: 'number' }, asset: { type: 'string' } } },
    execute: async (input, ctx) => ctx.lendingService?.getMarkets?.(input) ?? { ok: false, reason: 'NO_LENDING_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/loan'
  },
  // Market & Research
  {
    id: 'market.overview',
    name: 'Market Overview',
    description: 'Market overview, top movers, trends',
    category: 'market',
    capabilities: ['read', 'market', 'overview'],
    inputSchema: { type: 'object', properties: { timeframe: { type: 'string' } } },
    execute: async (input, ctx) => ctx.marketService?.getOverview?.(input) ?? { ok: false, reason: 'NO_MARKET_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/market'
  },
  {
    id: 'market.tokenDetail',
    name: 'Token Detail',
    description: 'Detailed token info, chart, risk',
    category: 'market',
    capabilities: ['read', 'token', 'detail', 'chart'],
    inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string' }, chainId: { type: 'number' } } },
    execute: async (input, ctx) => ctx.marketService?.getToken?.(input) ?? { ok: false, reason: 'NO_MARKET_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/market'
  },
  {
    id: 'signals.list',
    name: 'Get Trading Signals',
    description: 'AI trading signals',
    category: 'market',
    capabilities: ['read', 'signals', 'ai'],
    inputSchema: { type: 'object', properties: { asset: { type: 'string' }, type: { type: 'string' } } },
    execute: async (input, ctx) => ctx.signalsService?.list?.(input) ?? { ok: false, reason: 'NO_SIGNALS_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/signals'
  },
  {
    id: 'smartMoney.track',
    name: 'Smart Money Tracking',
    description: 'Track smart money wallets and trades',
    category: 'market',
    capabilities: ['read', 'smart-money', 'whale'],
    inputSchema: { type: 'object', properties: { address: { type: 'string' }, token: { type: 'string' } } },
    execute: async (input, ctx) => ctx.smartMoneyService?.track?.(input) ?? { ok: false, reason: 'NO_SMARTMONEY_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/smart-money'
  },
  {
    id: 'whale.track',
    name: 'Whale Tracking',
    description: 'Whale movements and alerts',
    category: 'market',
    capabilities: ['read', 'whale', 'tracking'],
    inputSchema: { type: 'object', properties: { token: { type: 'string' }, minAmount: { type: 'number' } } },
    execute: async (input, ctx) => ctx.whaleService?.track?.(input) ?? { ok: false, reason: 'NO_WHALE_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/smart-money'
  },
  // Investment
  {
    id: 'dca.create',
    name: 'Create DCA Plan',
    description: 'Create dollar-cost averaging automation',
    category: 'investment',
    capabilities: ['write', 'dca', 'automation'],
    inputSchema: {
      type: 'object',
      required: ['asset', 'amount', 'frequency'],
      properties: {
        asset: { type: 'string' },
        amount: { type: 'string' },
        frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
        chainId: { type: 'number' }
      }
    },
    execute: async (input, ctx) => ctx.dcaService?.create?.(input) ?? { ok: false, reason: 'NO_DCA_SERVICE' },
    readOnly: false,
    requiresWallet: true,
    requiresConfirmation: true,
    route: '/intent'
  },
  {
    id: 'portfolio.rebalance',
    name: 'Rebalance Portfolio',
    description: 'Calculate and execute portfolio rebalance',
    category: 'investment',
    capabilities: ['execute', 'rebalance', 'portfolio'],
    inputSchema: {
      type: 'object',
      properties: {
        targetAllocation: { type: 'object' },
        riskTolerance: { type: 'string' }
      }
    },
    execute: async (input, ctx) => ctx.portfolioService?.rebalance?.(input) ?? { ok: false, reason: 'NO_PORTFOLIO_SERVICE' },
    readOnly: false,
    requiresWallet: true,
    requiresConfirmation: true,
    route: '/portfolio'
  },
  {
    id: 'goals.create',
    name: 'Create Financial Goal',
    description: 'Create financial goal and plan',
    category: 'investment',
    capabilities: ['write', 'goal', 'planning'],
    inputSchema: {
      type: 'object',
      required: ['title', 'targetAmount', 'timeframe'],
      properties: {
        title: { type: 'string' },
        targetAmount: { type: 'number' },
        timeframe: { type: 'string' },
        riskTolerance: { type: 'string' }
      }
    },
    execute: async (input, ctx) => ctx.goalsService?.create?.(input) ?? { ok: false, reason: 'NO_GOALS_SERVICE' },
    readOnly: false,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/earn'
  },
  // Content & System
  {
    id: 'news.search',
    name: 'Search News',
    description: 'Search crypto news',
    category: 'content',
    capabilities: ['read', 'news', 'search'],
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' } } },
    execute: async (input, ctx) => ctx.newsService?.search?.(input) ?? { ok: false, reason: 'NO_NEWS_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/news'
  },
  {
    id: 'navigation.open',
    name: 'Open Page',
    description: 'Navigate to a page',
    category: 'system',
    capabilities: ['navigate', 'open'],
    inputSchema: { type: 'object', required: ['route'], properties: { route: { type: 'string' }, params: { type: 'object' } } },
    execute: async (input, ctx) => {
      if (ctx.navigation?.navigate) return ctx.navigation.navigate(input);
      return { ok: true, navigated: input.route };
    },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/'
  },
  {
    id: 'calm.play',
    name: 'Play Calm Music',
    description: 'Play relaxation music',
    category: 'media',
    capabilities: ['media', 'play', 'calm'],
    inputSchema: {
      type: 'object',
      properties: {
        mood: { type: 'string', enum: ['relax', 'focus', 'sleep', 'meditation'] },
        category: { type: 'string' }
      }
    },
    execute: async (input, ctx) => ctx.mediaService?.play?.(input) ?? { ok: true, playing: input.mood || 'relaxation' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/explore'
  },
  {
    id: 'market.smartMoney',
    name: 'Smart Money Overview',
    description: 'Smart money wallets overview',
    category: 'market',
    capabilities: ['read', 'smart-money'],
    inputSchema: { type: 'object', properties: {} },
    execute: async (input, ctx) => ctx.smartMoneyService?.overview?.(input) ?? { ok: false, reason: 'NO_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/smart-money'
  },
  {
    id: 'portfolio.analysis',
    name: 'Portfolio Analysis',
    description: 'Deep portfolio analysis with risk',
    category: 'portfolio',
    capabilities: ['read', 'analysis', 'risk'],
    inputSchema: { type: 'object', properties: { detailed: { type: 'boolean' } } },
    execute: async (input, ctx) => ctx.portfolioService?.analyze?.(input) ?? { ok: false, reason: 'NO_SERVICE' },
    readOnly: true,
    requiresWallet: true,
    requiresConfirmation: false,
    route: '/portfolio'
  },
  {
    id: 'risk.analyze',
    name: 'Risk Analysis',
    description: 'Analyze portfolio risk',
    category: 'portfolio',
    capabilities: ['read', 'risk', 'analysis'],
    inputSchema: { type: 'object', properties: { portfolio: { type: 'object' } } },
    execute: async (input, ctx) => ctx.riskService?.analyze?.(input) ?? { ok: false, reason: 'NO_RISK_SERVICE' },
    readOnly: true,
    requiresWallet: false,
    requiresConfirmation: false,
    route: '/portfolio'
  },
  {
    id: 'orders.list',
    name: 'List Orders',
    description: 'List active and historical orders',
    category: 'trading',
    capabilities: ['read', 'orders'],
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    execute: async (input, ctx) => ctx.ordersService?.list?.(input) ?? { ok: false, reason: 'NO_ORDERS_SERVICE' },
    readOnly: true,
    requiresWallet: true,
    requiresConfirmation: false,
    route: '/orders'
  }
];

// Index for fast lookup
const toolMap = new Map(TOOLS.map(t => [t.id, t]));
const categoryMap = new Map();
for (const tool of TOOLS) {
  if (!categoryMap.has(tool.category)) categoryMap.set(tool.category, []);
  categoryMap.get(tool.category).push(tool);
}

// Hierarchical tool discovery
const INTENT_TO_CATEGORIES = Object.freeze({
  PORTFOLIO_ANALYSIS: ['portfolio', 'market'],
  MARKET_ANALYSIS: ['market', 'portfolio'],
  RISK_ANALYSIS: ['portfolio', 'market'],
  YIELD_DISCOVERY: ['defi', 'investment', 'portfolio'],
  NEWS_SEARCH: ['content', 'market'],
  MARKET_CONTEXT: ['market', 'content'],
  OPEN_CALM: ['media', 'system'],
  PLAY_MUSIC: ['media'],
  NAVIGATION: ['system'],
  WALLET_BALANCE: ['wallet', 'portfolio'],
  SWAP: ['trading', 'wallet'],
  BRIDGE: ['trading', 'wallet'],
  SEND: ['wallet', 'trading'],
  INVESTMENT_PLAN: ['investment', 'portfolio', 'defi', 'market'],
  DCA: ['investment', 'trading'],
  GOAL: ['investment', 'portfolio'],
  FARM: ['defi', 'investment'],
  LEND: ['defi'],
  FUTURES: ['trading'],
  SMART_MONEY: ['market'],
  WHALE: ['market'],
  GENERAL: ['wallet', 'portfolio', 'market', 'system']
});

export function getTool(id) {
  return toolMap.get(String(id || '')) || null;
}

export function listTools() {
  return [...TOOLS];
}

export function getToolsByCategory(category) {
  return categoryMap.get(String(category || '')) ? [...categoryMap.get(String(category || ''))] : [];
}

export function getToolsByCapability(capability) {
  const cap = String(capability || '').toLowerCase();
  return TOOLS.filter(t => t.capabilities.some(c => c.toLowerCase().includes(cap)));
}

/**
 * Hierarchical & Dynamic tool loading
 * Spec §3: User says "for ETH investment" → Investment → Portfolio, Yield, Market, Signals, DCA, Swap
 * Only relevant tools load, prevents Tool Sprawl
 */
export function resolveToolsForIntent(intentType, context = {}) {
  const type = String(intentType || 'GENERAL').toUpperCase();
  const categories = INTENT_TO_CATEGORIES[type] || getHierarchyForIntent(type) || ['wallet', 'portfolio', 'market', 'system'];
  
  const resolved = [];
  const seen = new Set();
  
  // Load tools by category priority
  for (const cat of categories) {
    const tools = getToolsByCategory(cat) || [];
    for (const tool of tools) {
      if (seen.has(tool.id)) continue;
      
      // Filter by wallet availability if needed
      if (tool.requiresWallet && !context.wallet?.connected) {
        // Still include but mark as needing wallet
        resolved.push({ ...tool, needsWallet: true });
      } else {
        resolved.push(tool);
      }
      seen.add(tool.id);
    }
  }
  
  // Add navigation tools always available
  if (!seen.has('navigation.open')) {
    const navTool = getTool('navigation.open');
    if (navTool) resolved.push(navTool);
  }
  
  return resolved;
}

export function getRelevantToolsForMessage(message, context = {}) {
  // Quick heuristic to avoid loading all tools
  const text = String(message || '').toLowerCase();
  
  if (text.includes('اخبار') || text.includes('news') || text.includes('خبر')) {
    return resolveToolsForIntent('NEWS_SEARCH', context);
  }
  if (text.includes('آرام') || text.includes('موسیقی') || text.includes('calm') || text.includes('music') || text.includes('آهنگ')) {
    return resolveToolsForIntent('PLAY_MUSIC', context);
  }
  if (text.includes('پرتفوی') || text.includes('portfolio') || text.includes('سبد')) {
    if (text.includes('افت') || text.includes('تحلیل') || text.includes('بررسی') || text.includes('analyze')) {
      return resolveToolsForIntent('PORTFOLIO_ANALYSIS', context);
    }
    if (text.includes('متعادل') || text.includes('rebalance')) {
      return resolveToolsForIntent('REBALANCE', context);
    }
    return resolveToolsForIntent('PORTFOLIO_ANALYSIS', context);
  }
  if (text.includes('موجودی') || text.includes('balance')) {
    return resolveToolsForIntent('WALLET_BALANCE', context);
  }
  if (text.includes('سود') || text.includes('yield') || text.includes('فارم') || text.includes('farm')) {
    return resolveToolsForIntent('YIELD_DISCOVERY', context);
  }
  if (text.includes('swap') || text.includes('تبدیل') || text.includes('معاوضه')) {
    return resolveToolsForIntent('SWAP', context);
  }
  if (text.includes('بریج') || text.includes('bridge') || text.includes('پل')) {
    return resolveToolsForIntent('BRIDGE', context);
  }
  if (text.includes('باز کن') || text.includes('open') || text.includes('برو')) {
    return resolveToolsForIntent('NAVIGATION', context);
  }
  
  // Default: general but hierarchical
  return resolveToolsForIntent('GENERAL', context);
}

// Validation — no hallucination (Spec §24)
export function validateToolInput(toolId, input) {
  const tool = getTool(toolId);
  if (!tool) return { ok: false, error: 'TOOL_NOT_FOUND', message: 'این قابلیت در حال حاضر در دسترس نیست.' };
  
  const schema = tool.inputSchema;
  if (!schema) return { ok: true };
  
  // Simple required check
  if (schema.required) {
    for (const field of schema.required) {
      if (input[field] == null || String(input[field]).trim() === '') {
        return { ok: false, error: 'MISSING_FIELD', field, message: `فیلد ${field} الزامی است` };
      }
    }
  }
  
  return { ok: true, tool };
}

export function getToolCategories() {
  return [...categoryMap.keys()];
}

export { INTENT_TO_CATEGORIES };
