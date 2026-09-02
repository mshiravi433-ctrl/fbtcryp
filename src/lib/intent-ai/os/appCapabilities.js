/**
 * FBT INTENT OS — App API Contract & Capability Registry
 * ---------------------------------------------------------------------------
 * Every page in FBT exposes a capability contract: id, actions, queries,
 * route, events. This is the single source of truth for navigation,
 * tool routing and event bus wiring.
 *
 * Spec §23 + §1: AI must know every page, its API, Action and capabilities.
 */

export const APP_CAPABILITY_SCHEMA = 'fbt.app-capability.v1';

export const APP_CAPABILITIES = Object.freeze([
  // Wallet layer
  Object.freeze({
    id: 'wallet',
    name: 'Wallet',
    description: 'Main wallet overview, EVM + Solana unified',
    route: '/wallet',
    actions: ['wallet.connect', 'wallet.disconnect', 'wallet.getBalances', 'wallet.send', 'wallet.receive', 'wallet.getHistory'],
    queries: ['wallet.balances', 'wallet.addresses', 'wallet.status', 'wallet.history'],
    events: ['wallet.connected', 'wallet.disconnected', 'wallet.updated'],
    category: 'wallet',
    requiresWallet: false
  }),
  Object.freeze({
    id: 'evm-wallet',
    name: 'EVM Wallet',
    description: 'EVM chains wallet management',
    route: '/wallet',
    actions: ['evm.connect', 'evm.disconnect', 'evm.getBalances', 'evm.send', 'evm.switchChain'],
    queries: ['evm.balances', 'evm.chain', 'evm.tokens'],
    events: ['evm.connected', 'evm.chainChanged'],
    category: 'wallet',
    requiresWallet: true,
    supportedChains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]
  }),
  Object.freeze({
    id: 'solana-wallet',
    name: 'Solana Wallet',
    description: 'Solana wallet and SPL tokens',
    route: '/solana',
    actions: ['solana.connect', 'solana.disconnect', 'solana.getBalances', 'solana.send'],
    queries: ['solana.balances', 'solana.tokens', 'solana.nfts'],
    events: ['solana.connected', 'solana.disconnected'],
    category: 'wallet',
    requiresWallet: true,
    supportedChains: [501]
  }),
  // Portfolio & Trading
  Object.freeze({
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Portfolio overview, analysis, PnL',
    route: '/portfolio',
    actions: ['portfolio.analyze', 'portfolio.rebalance', 'portfolio.export'],
    queries: ['portfolio.summary', 'portfolio.holdings', 'portfolio.pnl', 'portfolio.allocation', 'portfolio.history'],
    events: ['portfolio.updated', 'portfolio.rebalanced'],
    category: 'portfolio',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'swap',
    name: 'Swap',
    description: 'Same-chain token swap via aggregator',
    route: '/swap',
    actions: ['swap.quote', 'swap.execute', 'swap.approve'],
    queries: ['swap.quote', 'swap.history', 'swap.tokens', 'swap.price'],
    events: ['swap.quoted', 'swap.completed', 'swap.failed'],
    category: 'trading',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'buy-sell',
    name: 'Buy & Sell',
    description: 'Provider-hosted fiat on-ramp with direct wallet settlement and blockchain verification',
    route: '/buy',
    actions: ['buySell.buy_quote', 'buySell.sell_quote', 'buySell.buy_asset', 'buySell.sell_asset', 'buySell.checkout'],
    queries: ['buySell.capabilities', 'buySell.buy_status', 'buySell.sell_status', 'buySell.payment_status', 'buySell.settlement_status', 'buySell.transaction_status'],
    events: ['buySell.quoteReady', 'buySell.created', 'buySell.checkoutStarted', 'buySell.completed'],
    category: 'trading',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'bridge',
    name: 'Bridge',
    description: 'Cross-chain bridge',
    route: '/bridge',
    actions: ['bridge.quote', 'bridge.execute'],
    queries: ['bridge.status', 'bridge.history', 'bridge.routes', 'bridge.quote'],
    events: ['bridge.quoted', 'bridge.completed', 'bridge.failed'],
    category: 'trading',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'cross-chain',
    name: 'Cross-Chain',
    description: 'Cross-chain execution and tracking',
    route: '/bridge',
    actions: ['crosschain.quote', 'crosschain.execute', 'crosschain.track'],
    queries: ['crosschain.status', 'crosschain.history', 'crosschain.routes'],
    events: ['crosschain.started', 'crosschain.completed'],
    category: 'trading',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'intent-os',
    name: 'Intent OS',
    description: 'Intent OS — AI operating layer',
    route: '/intent',
    actions: ['intent.create', 'intent.execute', 'intent.cancel'],
    queries: ['intent.list', 'intent.status', 'intent.history', 'intent.capabilities'],
    events: ['intent.created', 'intent.completed', 'intent.failed'],
    category: 'system'
  }),
  Object.freeze({
    id: 'orders',
    name: 'Orders',
    description: 'Limit orders, active orders',
    route: '/orders',
    actions: ['orders.create', 'orders.cancel'],
    queries: ['orders.list', 'orders.active', 'orders.history'],
    events: ['order.created', 'order.filled', 'order.cancelled'],
    category: 'trading',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'futures',
    name: 'Futures',
    description: 'Perpetual futures — Perpetual overview, dYdX session, On-Chain (Ostium) engine',
    route: '/perp?tab=onchain',
    /* Futures Engine v3: every action here is backed by /api/v1/futures/* and
       the On-Chain tab. Nothing is listed that the backend cannot do. */
    actions: [
      'futures.open', 'futures.close', 'futures.increase', 'futures.decrease',
      'futures.setTakeProfit', 'futures.setStopLoss', 'futures.setLeverage', 'futures.quote'
    ],
    queries: [
      'futures.markets', 'futures.providers', 'futures.positions', 'futures.funding',
      'futures.openInterest', 'futures.fees', 'futures.risk', 'futures.health', 'futures.history'
    ],
    /* Exactly the names src/lib/futures-engine/events.js emits. */
    events: [
      'FUTURES_QUOTE_UPDATED', 'FUTURES_RISK_UPDATED', 'FUTURES_ORDER_PREPARED',
      'FUTURES_ORDER_SUBMITTED', 'FUTURES_ORDER_CONFIRMED', 'FUTURES_ORDER_FAILED',
      'FUTURES_POSITION_OPENED', 'FUTURES_POSITION_UPDATED', 'FUTURES_POSITION_CLOSED',
      'FUTURES_TP_SL_UPDATED', 'FUTURES_FEE_RECORDED', 'FUTURES_PROVIDER_HEALTH_CHANGED'
    ],
    category: 'trading',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'lending',
    name: 'Lending',
    description: 'Lending protocols, supply assets',
    route: '/loan',
    actions: ['lending.supply', 'lending.withdraw', 'lending.claim'],
    queries: ['lending.markets', 'lending.positions', 'lending.apy', 'lending.history'],
    events: ['lending.supplied', 'lending.withdrawn'],
    category: 'defi',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'borrowing',
    name: 'Borrowing',
    description: 'Borrow against collateral',
    route: '/loan',
    actions: ['borrowing.borrow', 'borrowing.repay'],
    queries: ['borrowing.markets', 'borrowing.positions', 'borrowing.health', 'borrowing.apy'],
    events: ['borrowing.borrowed', 'borrowing.repaid'],
    category: 'defi',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'farming',
    name: 'Farming',
    description: 'Yield farming, liquidity pools',
    route: '/farm',
    actions: ['farming.stake', 'farming.unstake', 'farming.harvest'],
    queries: ['farming.pools', 'farming.positions', 'farming.apy', 'farming.rewards'],
    events: ['farming.staked', 'farming.unstaked', 'farming.harvested'],
    category: 'defi',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'yield',
    name: 'Yield',
    description: 'Yield discovery and optimization',
    route: '/earn',
    actions: ['yield.discover', 'yield.optimize', 'yield.deposit'],
    queries: ['yield.opportunities', 'yield.apy', 'yield.risk', 'yield.history'],
    events: ['yield.discovered', 'yield.deposited'],
    category: 'defi'
  }),
  Object.freeze({
    id: 'staking',
    name: 'Staking',
    description: 'Native and liquid staking',
    route: '/earn',
    actions: ['staking.stake', 'staking.unstake', 'staking.claim'],
    queries: ['staking.pools', 'staking.positions', 'staking.rewards', 'staking.apy'],
    events: ['staking.staked', 'staking.unstaked'],
    category: 'defi',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'signals',
    name: 'Signals',
    description: 'Trading signals, AI insights',
    route: '/signals',
    actions: ['signals.get', 'signals.subscribe'],
    queries: ['signals.list', 'signals.active', 'signals.history', 'signals.performance'],
    events: ['signals.new', 'signals.updated'],
    category: 'market'
  }),
  Object.freeze({
    id: 'smart-money',
    name: 'Smart Money',
    description: 'Smart money tracking and analysis',
    route: '/smart-money',
    actions: ['smartmoney.track', 'smartmoney.analyze'],
    queries: ['smartmoney.wallets', 'smartmoney.trades', 'smartmoney.tokens', 'smartmoney.performance'],
    events: ['smartmoney.trade', 'smartmoney.walletUpdated'],
    category: 'market'
  }),
  Object.freeze({
    id: 'whale-tracking',
    name: 'Whale Tracking',
    description: 'Whale wallet monitoring',
    route: '/smart-money',
    actions: ['whale.track', 'whale.analyze'],
    queries: ['whale.wallets', 'whale.movements', 'whale.alerts'],
    events: ['whale.movement', 'whale.alert'],
    category: 'market'
  }),
  Object.freeze({
    id: 'market',
    name: 'Market',
    description: 'Market overview, tokens, prices',
    route: '/market',
    actions: ['market.refresh'],
    queries: ['market.overview', 'market.tokens', 'market.prices', 'market.trends', 'market.topMovers'],
    events: ['market.updated'],
    category: 'market'
  }),
  Object.freeze({
    id: 'tokens',
    name: 'Tokens',
    description: 'Token detail, analysis',
    route: '/market',
    actions: ['tokens.analyze', 'tokens.favorite'],
    queries: ['tokens.detail', 'tokens.price', 'tokens.chart', 'tokens.holders', 'tokens.risk'],
    events: ['tokens.viewed'],
    category: 'market'
  }),
  Object.freeze({
    id: 'stocks',
    name: 'Stocks',
    description: 'Equities, stock trading via Avantis/Ostium',
    route: '/stocks',
    actions: ['stocks.trade', 'stocks.analyze'],
    queries: ['stocks.markets', 'stocks.prices', 'stocks.positions'],
    events: ['stocks.traded'],
    category: 'trading',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'dca',
    name: 'DCA',
    description: 'Dollar-cost averaging automation',
    route: '/intent',
    actions: ['dca.create', 'dca.pause', 'dca.resume', 'dca.cancel'],
    queries: ['dca.list', 'dca.status', 'dca.history'],
    events: ['dca.created', 'dca.executed', 'dca.paused'],
    category: 'investment',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'rebalancing',
    name: 'Rebalancing',
    description: 'Portfolio rebalancing',
    route: '/portfolio',
    actions: ['rebalancing.plan', 'rebalancing.execute'],
    queries: ['rebalancing.suggestion', 'rebalancing.history', 'rebalancing.allocation'],
    events: ['rebalancing.planned', 'rebalancing.completed'],
    category: 'investment',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'financial-goals',
    name: 'Financial Goals',
    description: 'Financial goals, planning, growth targets',
    route: '/earn',
    actions: ['goals.create', 'goals.update', 'goals.track'],
    queries: ['goals.list', 'goals.progress', 'goals.projection'],
    events: ['goals.created', 'goals.updated', 'goals.completed'],
    category: 'investment'
  }),
  Object.freeze({
    id: 'ai-agents',
    name: 'AI Agents',
    description: 'AI agents directory and management',
    route: '/intent',
    actions: ['agents.list', 'agents.activate'],
    queries: ['agents.directory', 'agents.status'],
    events: ['agents.activated'],
    category: 'system'
  }),
  Object.freeze({
    id: 'news',
    name: 'News',
    description: 'Crypto news, market news',
    route: '/news',
    actions: ['news.open', 'news.refresh', 'news.search'],
    queries: ['news.list', 'news.search', 'news.trending'],
    events: ['news.opened', 'news.updated'],
    category: 'content'
  }),
  Object.freeze({
    id: 'explore',
    name: 'Explore',
    description: 'Explore dApps, ecosystem',
    route: '/explore',
    actions: ['explore.open', 'explore.search'],
    queries: ['explore.list', 'explore.trending', 'explore.categories'],
    events: ['explore.opened'],
    category: 'content'
  }),
  Object.freeze({
    id: 'nft',
    name: 'NFT',
    description: 'NFT gallery, collection',
    route: '/nft',
    actions: ['nft.view', 'nft.transfer'],
    queries: ['nft.list', 'nft.collection', 'nft.detail'],
    events: ['nft.viewed', 'nft.transferred'],
    category: 'content',
    requiresWallet: true
  }),
  Object.freeze({
    id: 'gift-cards',
    name: 'Gift Cards',
    description: 'Gift cards shop',
    route: '/shop',
    actions: ['giftcards.buy', 'giftcards.redeem'],
    queries: ['giftcards.list', 'giftcards.categories', 'giftcards.balance'],
    events: ['giftcards.purchased'],
    category: 'commerce'
  }),
  Object.freeze({
    id: 'sim',
    name: 'SIM',
    description: 'eSIM purchase',
    route: '/shop',
    actions: ['sim.buy', 'sim.activate'],
    queries: ['sim.plans', 'sim.coverage', 'sim.balance'],
    events: ['sim.purchased'],
    category: 'commerce'
  }),
  Object.freeze({
    id: 'travel',
    name: 'Travel',
    description: 'Travel booking',
    route: '/shop',
    actions: ['travel.search', 'travel.book'],
    queries: ['travel.destinations', 'travel.deals'],
    events: ['travel.booked'],
    category: 'commerce'
  }),
  Object.freeze({
    id: 'hotels',
    name: 'Hotels',
    description: 'Hotel booking',
    route: '/shop',
    actions: ['hotels.search', 'hotels.book'],
    queries: ['hotels.list', 'hotels.deals', 'hotels.detail'],
    events: ['hotels.booked'],
    category: 'commerce'
  }),
  Object.freeze({
    id: 'settings',
    name: 'Settings',
    description: 'App settings, preferences',
    route: '/settings',
    actions: ['settings.update', 'settings.reset'],
    queries: ['settings.get', 'settings.preferences'],
    events: ['settings.updated'],
    category: 'system'
  }),
  Object.freeze({
    id: 'notifications',
    name: 'Notifications',
    description: 'Notifications center',
    route: '/settings',
    actions: ['notifications.read', 'notifications.clear'],
    queries: ['notifications.list', 'notifications.unread'],
    events: ['notifications.received'],
    category: 'system'
  }),
  Object.freeze({
    id: 'calm',
    name: 'Calm / Relaxation',
    description: 'Calm, relaxation, music, meditation',
    route: '/explore',
    actions: ['calm.open', 'calm.play', 'calm.pause', 'calm.stop'],
    queries: ['calm.tracks', 'calm.recommended', 'calm.mood'],
    events: ['calm.opened', 'music.played', 'music.paused'],
    category: 'media'
  })
]);

const capabilityMap = new Map(APP_CAPABILITIES.map(c => [c.id, c]));
const routeMap = new Map();
for (const cap of APP_CAPABILITIES) {
  if (!routeMap.has(cap.route)) routeMap.set(cap.route, []);
  routeMap.get(cap.route).push(cap);
}

export function getCapability(id) {
  return capabilityMap.get(String(id || '').toLowerCase()) || null;
}

export function getCapabilitiesByRoute(route) {
  return routeMap.get(String(route || '')) || [];
}

export function getCapabilitiesByCategory(category) {
  return APP_CAPABILITIES.filter(c => c.category === category);
}

export function listCapabilities() {
  return [...APP_CAPABILITIES];
}

export function findCapabilityForAction(actionId) {
  const id = String(actionId || '').toLowerCase();
  return APP_CAPABILITIES.find(c => 
    c.actions.some(a => a.toLowerCase() === id || id.startsWith(a.split('.')[0]))
  ) || null;
}

// Hierarchical grouping for tool discovery
export const CAPABILITY_HIERARCHY = Object.freeze({
  wallet: ['wallet', 'evm-wallet', 'solana-wallet'],
  portfolio: ['portfolio', 'rebalancing', 'financial-goals'],
  trading: ['buy-sell', 'swap', 'bridge', 'cross-chain', 'orders', 'futures', 'stocks'],
  defi: ['lending', 'borrowing', 'farming', 'yield', 'staking', 'dca'],
  market: ['market', 'tokens', 'signals', 'smart-money', 'whale-tracking'],
  investment: ['dca', 'rebalancing', 'financial-goals', 'yield', 'farming'],
  content: ['news', 'explore', 'nft', 'signals'],
  commerce: ['gift-cards', 'sim', 'travel', 'hotels'],
  system: ['settings', 'notifications', 'intent-os', 'ai-agents'],
  media: ['calm']
});

export function getHierarchyForIntent(intentType) {
  const t = String(intentType || '').toUpperCase();
  if (['PORTFOLIO_ANALYSIS', 'REBALANCE', 'ANALYZE_PORTFOLIO'].includes(t)) return ['portfolio', 'market'];
  if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(t)) return ['trading', 'wallet'];
  if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(t)) return ['defi', 'investment'];
  if (['MARKET_ANALYSIS', 'SMART_MONEY', 'WHALE'].includes(t)) return ['market', 'content'];
  if (['NEWS_SEARCH', 'MARKET_CONTEXT'].includes(t)) return ['content', 'market'];
  if (['OPEN_CALM', 'PLAY_MUSIC'].includes(t)) return ['media', 'system'];
  if (['NAVIGATION'].includes(t)) return ['system'];
  if (['DCA', 'GOAL', 'INVESTMENT_PLAN'].includes(t)) return ['investment', 'portfolio'];
  return ['wallet', 'portfolio', 'trading', 'market', 'system'];
}
