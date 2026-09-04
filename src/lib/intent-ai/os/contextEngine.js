/**
 * FBT INTENT OS — Context Engine
 * ---------------------------------------------------------------------------
 * Spec §6 + §7 + §36 Performance
 * Builds full context before decision:
 * Current Page, Wallet, Balances, Portfolio, Chains, Recent Actions, etc.
 * Lazy, caching, parallel reads, event-driven updates.
 */

import { getCentralWalletState, isWalletConnected, mergeWalletSnapshots } from './centralWalletState.js';
import { getOperationalSlots, setPageContextState } from './sharedState.js';
import { onEvent, EVENTS } from './eventBus.js';

export const CONTEXT_SCHEMA = 'fbt.ai-context.v1';

const CACHE_TTL = 8_000;
const cache = new Map();

try {
  onEvent(EVENTS.WALLET_CONNECTED, () => clearContextCache());
  onEvent(EVENTS.WALLET_DISCONNECTED, () => clearContextCache());
  onEvent(EVENTS.WALLET_ACCOUNT_CHANGED, () => clearContextCache());
  onEvent(EVENTS.WALLET_NETWORK_CHANGED, () => clearContextCache());
  onEvent(EVENTS.PORTFOLIO_UPDATED, () => clearContextCache());
} catch { /* listeners are optional at import time */ }

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
  conversationId = null,
  currentPage = '/',
  currentRoute = null,
  currentTab = null,
  activeTab = null,
  selectedAsset = null,
  selectedNetwork = null,
  currentWorkflow = null,
  walletState = null,
  portfolioState = null,
  conversation = [],
  memory = [],
  services = {},
  locale = 'fa'
} = {}) {
  const now = Date.now();
  const route = currentRoute || currentPage;
  const central = getCentralWalletState();
  const liveWallet = mergeWalletSnapshots(walletState, central);

  const cacheKey = `ctx:${userId || 'anon'}:${route}:${liveWallet?.address || ''}:${liveWallet?.connectionStatus || ''}:${selectedAsset || ''}`;
  const cached = getCached(cacheKey);
  if (cached && isWalletConnected(liveWallet) === Boolean(cached.hasWallet)) {
    return {
      ...cached,
      walletState: liveWallet,
      timestamp: now,
      cached: true,
      selectedAsset: selectedAsset || cached.selectedAsset,
      selectedNetwork: selectedNetwork || cached.selectedNetwork,
      activeTab: activeTab || currentTab || cached.activeTab,
      currentWorkflow: currentWorkflow || cached.currentWorkflow,
      operational: getOperationalSlots()
    };
  }
  
  // Parallel reads for performance (Spec §36)
  const [
    wallet,
    portfolio,
    market,
    recentActions,
    preferences,
    activeGoals
  ] = await Promise.all([
    resolveWalletContext(liveWallet, services),
    resolvePortfolioContext(portfolioState, services, liveWallet),
    resolveMarketContext(services),
    resolveRecentActions(services, userId),
    resolvePreferences(services, userId),
    resolveActiveGoals(services, userId)
  ]);

  const context = {
    schema: CONTEXT_SCHEMA,
    userId,
    sessionId: sessionId || conversationId,
    conversationId: conversationId || sessionId,
    currentPage,
    currentRoute: route,
    currentTab: currentTab || activeTab,
    activeTab: activeTab || currentTab,
    selectedAsset,
    selectedNetwork,
    currentWorkflow,
    locale,
    timestamp: now,
    
    // Wallet layer (Spec §20 Universal Wallet Context)
    wallet,
    walletState: liveWallet,
    
    // Portfolio
    portfolio,
    portfolioState,
    operational: getOperationalSlots(),
    services,
    
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
    hasWallet: isWalletConnected(wallet) || Boolean(wallet?.connected),
    canSign: Boolean(wallet?.canSign),
    totalValueUsd: Number.isFinite(Number(portfolio?.totalValueUsd)) ? Number(portfolio.totalValueUsd) : null,
    
    // Performance meta
    builtAt: now,
    cached: Boolean(cached)
  };

  try { setPageContextState({ page: currentPage, route, walletConnected: context.hasWallet, selectedAsset, selectedNetwork }); } catch { /* page context is best-effort */ }

  if (context.hasWallet && portfolio?.freshness !== 'PENDING') {
    setCached(cacheKey, context);
  }

  return context;
}

async function resolveWalletContext(walletState, services) {
  const central = getCentralWalletState();
  const live = mergeWalletSnapshots(walletState, central);
  const connected = isWalletConnected(live) || Boolean(live?.connected || live?.isConnected);

  const base = {
    connected,
    connectionStatus: live.connectionStatus || (connected ? 'CONNECTED' : 'DISCONNECTED'),
    hydrating: Boolean(live.hydrating || live.connectionStatus === 'HYDRATING'),
    canSign: live.canSign !== false && Boolean(live.address || live.solanaAddress),
    evmAddresses: live.evmAddresses || (live.address ? [live.address] : []),
    solanaAddresses: live.solanaAddresses || (live.solanaAddress ? [live.solanaAddress] : []),
    chains: live.chains || (live.chainId ? [live.chainId] : []),
    balances: live.balances || live.tokenBalances || [],
    tokens: live.tokens || [],
    nfts: live.nfts || [],
    positions: live.positions || { lending: [], borrowing: [], farming: [], staking: [] },
    orders: live.orders || [],
    futures: live.futures || [],
    address: live.address || live.evmAddresses?.[0] || null,
    solanaAddress: live.solanaAddress || live.solanaAddresses?.[0] || null,
    chainId: live.chainId ?? null,
    nativeBalance: live.nativeBalance ?? null,
    freshness: live.freshness || (connected ? 'FRESH' : 'NONE'),
    lastUpdated: live.lastUpdated || Date.now()
  };

  if (base.balances.length || base.tokens.length) return base;

  try {
    if (services.walletService?.getContext) {
      const ctx = await services.walletService.getContext();
      if (ctx) {
        return {
          ...base,
          ...ctx,
          connected: Boolean(ctx.connected || base.connected),
          address: ctx.address || base.address,
          balances: ctx.balances || base.balances
        };
      }
    }
  } catch { /* service miss is not a disconnect */ }

  return base;
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

  const balances = walletState?.balances || walletState?.tokenBalances;
  if (Array.isArray(balances) && balances.length) {
    const holdings = balances.map((b) => ({
      symbol: b.symbol,
      chainId: b.chainId,
      valueUsd: Number.isFinite(Number(b.valueUsd ?? b.value)) ? Number(b.valueUsd ?? b.value) : null,
      amount: b.amount ?? null
    }));
    const priced = holdings.filter((h) => Number.isFinite(Number(h.valueUsd)));
    const total = priced.reduce((s, h) => s + Number(h.valueUsd), 0);
    return {
      dataStatus: holdings.length ? 'live' : 'unavailable',
      totalValueUsd: priced.length ? total : null,
      holdings,
      partial: priced.length < holdings.length,
      freshness: walletState?.hydrating ? 'PENDING' : 'FRESH'
    };
  }

  const connected = isWalletConnected(walletState);
  return {
    dataStatus: connected ? 'pending' : 'unavailable',
    totalValueUsd: null,
    holdings: [],
    hydrating: Boolean(connected),
    freshness: connected ? 'PENDING' : 'NONE',
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
    '/earn': { page: 'yield', tab: 'opportunities', canExecute: ['deposit'] },
    '/solana': { page: 'solana-swap', tab: 'swap', canExecute: ['swap', 'addToken'] },
    '/invest': { page: 'horizon', tab: 'markets', canExecute: ['invest'] },
    '/dydx': { page: 'dydx', tab: 'markets', canExecute: ['trade'] },
    '/ostium': { page: 'ostium', tab: 'markets', canExecute: ['trade'] },
    '/p2p': { page: 'p2p', tab: 'send', canExecute: ['send'] },
    '/rewards': { page: 'rewards', tab: 'points', canExecute: ['view'] },
    '/buy': { page: 'buy-sell', tab: 'buy', canExecute: ['buy', 'sell'] }
  };
  
  return pageMap[r] || { page: 'general', tab: 'overview', canExecute: [] };
}

export function isFollowUpToCurrentPage(message, currentPage) {
  const text = String(message || '').toLowerCase();
  const hasThis = /(این|همین|this|it|همین را|این را)/i.test(text);
  const hasExecute = /(اجرا|execute|انجام|run)/i.test(text);
  return hasThis && hasExecute && Boolean(currentPage);
}
