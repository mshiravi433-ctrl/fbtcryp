/**
 * FBT INTENT OS — Context Engine
 * ---------------------------------------------------------------------------
 * Spec §6 + §7 + §36 Performance
 * Builds full context before decision:
 * Current Page, Wallet, Balances, Portfolio, Chains, Recent Actions, etc.
 * Lazy, caching, parallel reads, event-driven updates.
 */

export const CONTEXT_SCHEMA = 'fbt.ai-context.v1';

const CACHE_TTL = 30_000; // 30s
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, { value, at: Date.now() });
}

export function clearContextCache() {
  cache.clear();
}

/**
 * Build context — parallel reads, lazy where possible
 * Spec §6: includes Current Page, Wallet, Portfolio, etc.
 */
export async function buildContext({
  userId = null,
  sessionId = null,
  currentPage = '/',
  currentRoute = null,
  currentTab = null,
  walletState = null,
  portfolioState = null,
  conversation = [],
  memory = [],
  services = {},
  locale = 'fa'
} = {}) {
  const now = Date.now();
  const route = currentRoute || currentPage;

  // Try cache for expensive reads
  const cacheKey = `ctx:${userId || 'anon'}:${route}:${walletState?.address || ''}`;
  const cached = getCached(cacheKey);
  
  // Parallel reads for performance (Spec §36)
  const [
    wallet,
    portfolio,
    market,
    recentActions,
    preferences,
    activeGoals
  ] = await Promise.all([
    resolveWalletContext(walletState, services),
    resolvePortfolioContext(portfolioState, services, walletState),
    resolveMarketContext(services),
    resolveRecentActions(services, userId),
    resolvePreferences(services, userId),
    resolveActiveGoals(services, userId)
  ]);

  const context = {
    schema: CONTEXT_SCHEMA,
    userId,
    sessionId,
    currentPage,
    currentRoute: route,
    currentTab,
    locale,
    timestamp: now,
    
    // Wallet layer (Spec §20 Universal Wallet Context)
    wallet,
    walletState,
    
    // Portfolio
    portfolio,
    portfolioState,
    
    // Market
    market,
    
    // Conversation & Memory
    conversation: Array.isArray(conversation) ? conversation.slice(-20) : [],
    memory: Array.isArray(memory) ? memory.slice(-8) : [],
    
    // App state
    recentActions,
    preferences,
    activeGoals,
    
    // Derived
    connectedChains: wallet?.chains || [],
    hasWallet: Boolean(wallet?.connected),
    canSign: Boolean(wallet?.canSign),
    totalValueUsd: portfolio?.totalValueUsd || 0,
    
    // Performance meta
    builtAt: now,
    cached: Boolean(cached)
  };

  // Cache for next call
  if (wallet?.connected) {
    setCached(cacheKey, context);
  }

  return context;
}

async function resolveWalletContext(walletState, services) {
  if (!walletState) {
    return {
      connected: false,
      canSign: false,
      evmAddresses: [],
      solanaAddresses: [],
      chains: [],
      balances: [],
      tokens: [],
      nfts: [],
      positions: { lending: [], borrowing: [], farming: [], staking: [] },
      orders: [],
      futures: []
    };
  }

  // If walletState already has full data, use it
  if (walletState.balances || walletState.tokens) {
    return {
      connected: Boolean(walletState.connected || walletState.isConnected),
      canSign: walletState.canSign !== false && Boolean(walletState.address || walletState.solanaAddress),
      evmAddresses: walletState.evmAddresses || (walletState.address ? [walletState.address] : []),
      solanaAddresses: walletState.solanaAddresses || (walletState.solanaAddress ? [walletState.solanaAddress] : []),
      chains: walletState.chains || [],
      balances: walletState.balances || [],
      tokens: walletState.tokens || [],
      nfts: walletState.nfts || [],
      positions: walletState.positions || { lending: [], borrowing: [], farming: [], staking: [] },
      orders: walletState.orders || [],
      futures: walletState.futures || [],
      address: walletState.address || walletState.evmAddresses?.[0] || null,
      solanaAddress: walletState.solanaAddress || walletState.solanaAddresses?.[0] || null
    };
  }

  // Try to fetch via services if available
  try {
    if (services.walletService?.getContext) {
      const ctx = await services.walletService.getContext();
      return ctx;
    }
  } catch {}

  return {
    connected: Boolean(walletState.connected || walletState.isConnected),
    canSign: Boolean(walletState.address),
    evmAddresses: walletState.address ? [walletState.address] : [],
    solanaAddresses: [],
    chains: [],
    balances: [],
    tokens: [],
    nfts: [],
    positions: { lending: [], borrowing: [], farming: [], staking: [] },
    orders: [],
    futures: []
  };
}

async function resolvePortfolioContext(portfolioState, services, walletState) {
  if (portfolioState && portfolioState.holdings) {
    return portfolioState;
  }

  try {
    if (services.portfolioService?.getSummary) {
      return await services.portfolioService.getSummary();
    }
  } catch {}

  // Fallback: build from wallet balances
  if (walletState?.balances) {
    const holdings = walletState.balances.map(b => ({
      symbol: b.symbol,
      chainId: b.chainId,
      valueUsd: b.valueUsd || b.value || 0,
      amount: b.amount || 0
    }));
    const total = holdings.reduce((s, h) => s + (h.valueUsd || 0), 0);
    return {
      dataStatus: holdings.length ? 'live' : 'unavailable',
      totalValueUsd: total,
      holdings,
      partial: false
    };
  }

  return {
    dataStatus: 'unavailable',
    totalValueUsd: null,
    holdings: [],
    partial: false
  };
}

async function resolveMarketContext(services) {
  try {
    if (services.marketService?.getRelevantData) {
      return await services.marketService.getRelevantData();
    }
  } catch {}
  return { dataStatus: 'unavailable' };
}

async function resolveRecentActions(services, userId) {
  try {
    if (services.historyService?.getRecent) {
      return await services.historyService.getRecent(userId);
    }
  } catch {}
  return [];
}

async function resolvePreferences(services, userId) {
  try {
    if (services.preferencesService?.get) {
      return await services.preferencesService.get(userId);
    }
  } catch {}
  // Try localStorage
  try {
    const raw = localStorage.getItem('fbt.preferences.v1');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

async function resolveActiveGoals(services, userId) {
  try {
    if (services.goalsService?.list) {
      return await services.goalsService.list(userId);
    }
  } catch {}
  return [];
}

/**
 * Update context with new result (Spec §14 Agent Loop — OBSERVE)
 */
export async function updateContext(context, result) {
  if (!context || typeof context !== 'object') return context;
  
  const updated = { ...context, lastResult: result, updatedAt: Date.now() };
  
  // If result contains new balances, update wallet
  if (result?.balances) {
    updated.wallet = { ...updated.wallet, balances: result.balances };
  }
  if (result?.portfolio) {
    updated.portfolio = { ...updated.portfolio, ...result.portfolio };
  }
  
  return updated;
}

/**
 * Current Page Awareness (Spec §7)
 * AI must know where user is, so "this" "execute it" refers to current page action
 */
export function getCurrentPageContext(route) {
  const r = String(route || '/').split('?')[0];

  // Farm publishes its selected pool and current tab into this session-scoped
  // context. Follow-up phrases such as “this one” can therefore resolve the
  // pool without copying wallet state or inventing a second Farm wallet.
  if (r === '/farm' && typeof sessionStorage !== 'undefined') {
    try {
      const farm = JSON.parse(sessionStorage.getItem('fbt:farm-context') || 'null');
      if (farm?.page === 'farm') {
        return {
          page: 'farm', tab: farm.tab || 'recommended', selectedPool: farm.selectedPool || null,
          network: farm.network || null, walletState: farm.walletState || 'read-only',
          previousIntent: farm.previousIntent || null, pendingAction: farm.pendingAction || null,
          canExecute: ['browse', 'analyze', 'compare']
        };
      }
    } catch { /* optional session context; fall through to route defaults */ }
  }
  
  // Map routes to capabilities
  const pageMap = {
    '/wallet': { page: 'wallet', tab: 'overview', canExecute: ['send', 'receive'] },
    '/portfolio': { page: 'portfolio', tab: 'overview', canExecute: ['analyze', 'rebalance'] },
    '/swap': { page: 'swap', tab: 'swap', canExecute: ['swap', 'quote'] },
    '/bridge': { page: 'bridge', tab: 'bridge', canExecute: ['bridge', 'quote'] },
    '/market': { page: 'market', tab: 'overview', canExecute: ['view', 'analyze'] },
    '/farm': { page: 'farm', tab: 'recommended', selectedPool: null, canExecute: ['browse', 'analyze', 'compare'] },
    '/loan': { page: 'lending', tab: 'supply', canExecute: ['supply', 'borrow'] },
    '/signals': { page: 'signals', tab: 'list', canExecute: ['view'] },
    '/smart-money': { page: 'smart-money', tab: 'overview', canExecute: ['track'] },
    '/news': { page: 'news', tab: 'list', canExecute: ['open', 'search'] },
    '/explore': { page: 'explore', tab: 'list', canExecute: ['open'] },
    '/nft': { page: 'nft', tab: 'gallery', canExecute: ['view'] },
    '/shop': { page: 'gift-cards', tab: 'shop', canExecute: ['buy'] },
    '/settings': { page: 'settings', tab: 'general', canExecute: ['update'] },
    '/intent': { page: 'intent-os', tab: 'chat', canExecute: ['create', 'execute'] },
    '/orders': { page: 'orders', tab: 'active', canExecute: ['cancel'] },
    '/perp': { page: 'futures', tab: 'markets', canExecute: ['open', 'close'] },
    '/stocks': { page: 'stocks', tab: 'markets', canExecute: ['trade'] },
    '/earn': { page: 'yield', tab: 'opportunities', canExecute: ['deposit'] }
  };
  
  return pageMap[r] || { page: 'general', tab: 'overview', canExecute: [] };
}

export function isFollowUpToCurrentPage(message, currentPage) {
  const text = String(message || '').toLowerCase();
  const hasThis = /(این|همین|this|it|همین را|این را)/i.test(text);
  const hasExecute = /(اجرا|execute|انجام|run)/i.test(text);
  return hasThis && hasExecute && Boolean(currentPage);
}
