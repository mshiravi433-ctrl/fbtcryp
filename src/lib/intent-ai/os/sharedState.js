/**
 * FBT CENTRAL INTELLIGENCE — one shared state model.
 * Wallet, portfolio, markets, capabilities and page context live here so
 * Intent OS and module pages cannot drift into two incompatible truths.
 */

import { getCentralWalletState, isWalletConnected } from './centralWalletState.js';
import { listCapabilities } from './appCapabilities.js';
import { emitEvent, EVENTS } from './eventBus.js';

export const SHARED_STATE_SCHEMA = 'fbt.shared-state.v1';

function stamp(source, freshness = 'FRESH') {
  return {
    version: Date.now(),
    updatedAt: new Date().toISOString(),
    source: source || 'shared-state',
    freshness
  };
}

const empty = () => ({
  schema: SHARED_STATE_SCHEMA,
  wallet: getCentralWalletState(),
  portfolio: { holdings: [], totalValueUsd: null, freshness: 'NONE', hydrating: false },
  markets: { dataStatus: 'unavailable' },
  positions: {},
  orders: [],
  lending: {},
  borrowing: {},
  farming: {},
  liquidity: {},
  futures: {},
  dydx: {},
  stocks: {},
  rwa: {},
  signals: {},
  news: {},
  events: {},
  goals: {},
  profitPlan: {},
  alerts: {},
  transactions: {},
  health: {},
  capabilities: listCapabilities().map((c) => ({
    capabilityId: c.id,
    module: c.id,
    status: 'AVAILABLE',
    operations: [...(c.actions || []), ...(c.queries || [])],
    requiresWallet: Boolean(c.requiresWallet),
    route: c.route
  })),
  context: { page: '/', tab: null, selectedAsset: null, walletConnected: false },
  operational: { asset: null, operation: null, amount: null, intent: null },
  meta: stamp('boot', 'NONE')
});

let store = empty();

export function getSharedState() {
  return {
    ...store,
    wallet: getCentralWalletState(),
    capabilities: [...(store.capabilities || [])]
  };
}

export function patchSharedState(section, value, { source = 'shared-state', freshness = 'FRESH' } = {}) {
  if (!section) return getSharedState();
  store = {
    ...store,
    [section]: value,
    meta: stamp(source, freshness)
  };
  try {
    if (section === 'portfolio') emitEvent(EVENTS.PORTFOLIO_UPDATED, { freshness }, source);
  } catch { /* optional */ }
  return getSharedState();
}

export function setPageContextState(page = {}) {
  store = {
    ...store,
    context: {
      page: page.page || page.route || store.context.page,
      tab: page.tab ?? store.context.tab,
      selectedAsset: page.selectedAsset ?? page.asset ?? store.context.selectedAsset,
      selectedNetwork: page.selectedNetwork ?? page.chainId ?? store.context.selectedNetwork,
      walletConnected: page.walletConnected ?? isWalletConnected()
    },
    meta: stamp('page-context', 'FRESH')
  };
  return store.context;
}

export function rememberOperationalSlots(slots = {}) {
  const prev = store.operational || {};
  store = {
    ...store,
    operational: {
      asset: slots.asset ?? slots.token ?? prev.asset,
      operation: slots.operation ?? slots.intent ?? prev.operation,
      amount: slots.amount ?? slots.amountUsd ?? prev.amount,
      fromToken: slots.fromToken ?? prev.fromToken,
      toToken: slots.toToken ?? prev.toToken,
      intent: slots.intent ?? prev.intent,
      updatedAt: Date.now()
    }
  };
  return store.operational;
}

export function getOperationalSlots() {
  return { ...(store.operational || {}) };
}

export function resetSharedState() {
  store = empty();
  return getSharedState();
}
