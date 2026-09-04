/**
 * FBT INTENT OS — OPERATIONS CENTER CATALOG.
 * ---------------------------------------------------------------------------
 * The [Operations] button renders this catalog. Every card carries:
 *   · capabilityId — the OS/tool capability it maps to (toolRegistry ids)
 *   · action       — what pressing it really does:
 *        'read'        run the real read service / tool and reply in chat
 *        'navigate'    open the real venue page (swap/bridge/farm/…)
 *        'quote'       fetch a real quote then hand off to signing venue
 *        'monitor'     open the monitor creation flow (server-backed)
 *        'order'       open the conditional-order flow (real /orders)
 *        'opportunity' run the opportunity engine
 *        'history'     open history drawer
 *        'unavailable' honest UNAVAILABLE / CONFIGURATION_REQUIRED state
 *
 * No card is decorative: a card with no real backend carries
 * `available: false` and the UI shows UNAVAILABLE/CONFIGURATION_REQUIRED.
 */

export const OPERATIONS_SCHEMA = 'fbt.operations-catalog.v1';

export const CATEGORIES = Object.freeze([
  { id: 'portfolio', title: 'Portfolio', icon: '📊' },
  { id: 'wallet', title: 'Wallet', icon: '👛' },
  { id: 'swap', title: 'Swap', icon: '🔄' },
  { id: 'bridge', title: 'Bridge', icon: '🌉' },
  { id: 'lending', title: 'Lending', icon: '🏦' },
  { id: 'farm', title: 'Farm', icon: '🌾' },
  { id: 'liquidity', title: 'Liquidity', icon: '💧' },
  { id: 'futures', title: 'Futures', icon: '⚡' },
  { id: 'dydx', title: 'dYdX', icon: '⚔️' },
  { id: 'markets', title: 'Global Markets', icon: '🌍' },
  { id: 'intelligence', title: 'Intelligence', icon: '🕵️' },
  { id: 'goals', title: 'Goals', icon: '🎯' },
  { id: 'automation', title: 'Automation', icon: '⏰' },
  { id: 'monitoring', title: 'Monitoring', icon: '👁️' },
  { id: 'rewards', title: 'Rewards', icon: '🏆' }
]);

export const OPERATIONS = Object.freeze([
  /* ------------------------------ Portfolio ------------------------------ */
  { id: 'portfolio_analysis', category: 'portfolio', icon: '📊', title: 'Portfolio Analysis', desc: 'Real portfolio allocation, concentration and risk from your wallet', action: 'read', capabilityId: 'portfolio.analysis', route: '/portfolio' },
  { id: 'portfolio_rebalance', category: 'portfolio', icon: '⚖️', title: 'Rebalance', desc: 'Plan a rebalance toward your target allocation (needs wallet)', action: 'quote', capabilityId: 'portfolio.rebalance', route: '/portfolio', requiresWallet: true },
  { id: 'portfolio_risk', category: 'portfolio', icon: '🛡️', title: 'Risk Analysis', desc: 'Concentration, drawdown and volatility read from real data', action: 'read', capabilityId: 'risk.analyze', route: '/portfolio' },
  { id: 'portfolio_allocation', category: 'portfolio', icon: '🥧', title: 'Asset Allocation', desc: 'Where your value sits across chains and assets', action: 'read', capabilityId: 'wallet.getPortfolio', route: '/portfolio' },

  /* -------------------------------- Wallet ------------------------------ */
  { id: 'wallet_analysis', category: 'wallet', icon: '🔍', title: 'Wallet Analysis', desc: 'Read the connected EVM + Solana wallet state', action: 'read', capabilityId: 'wallet.getBalances', route: '/wallet', requiresWallet: true },
  { id: 'wallet_balances', category: 'wallet', icon: '💳', title: 'Balances', desc: 'Real balances per chain from the multi-chain hook', action: 'read', capabilityId: 'wallet.getBalances', route: '/wallet', requiresWallet: true },
  { id: 'wallet_transactions', category: 'wallet', icon: '🧾', title: 'Transactions', desc: 'Intent OS transaction history (this device)', action: 'read', capabilityId: 'transactions.history', route: '/wallet' },
  { id: 'wallet_evm', category: 'wallet', icon: '🟦', title: 'EVM Wallet', desc: 'Manage EVM wallet / switch network', action: 'navigate', capabilityId: 'wallet.evm', route: '/wallet' },
  { id: 'wallet_solana', category: 'wallet', icon: '🟣', title: 'Solana Wallet', desc: 'Solana balance and swap surface', action: 'navigate', capabilityId: 'wallet.solana', route: '/solana' },

  /* --------------------------------- Swap -------------------------------- */
  { id: 'swap_token', category: 'swap', icon: '🔄', title: 'Token Swap', desc: 'Real quote → preview → wallet signature at the swap venue', action: 'quote', capabilityId: 'swap.quote', route: '/swap', requiresWallet: true },
  { id: 'swap_crosschain', category: 'swap', icon: '🔀', title: 'Cross-chain Swap', desc: 'Bridge/trade across EVM networks (venue: /bridge)', action: 'quote', capabilityId: 'bridge.quote', route: '/bridge', requiresWallet: true },
  { id: 'swap_quote', category: 'swap', icon: '💱', title: 'Quote', desc: 'Live swap quote from the real aggregator', action: 'quote', capabilityId: 'swap.getQuote', route: '/swap' },
  { id: 'swap_execute', category: 'swap', icon: '✅', title: 'Execute Swap', desc: 'Confirm → wallet sign → broadcast (real venue)', action: 'quote', capabilityId: 'swap.execute', route: '/swap', requiresWallet: true },

  /* -------------------------------- Bridge ------------------------------- */
  { id: 'bridge_run', category: 'bridge', icon: '🌉', title: 'Bridge', desc: 'Cross-chain transfer: quote, preview, wallet signature', action: 'quote', capabilityId: 'bridge.quote', route: '/bridge', requiresWallet: true },
  { id: 'bridge_crosschain', category: 'bridge', icon: '↔️', title: 'Cross-chain Transfer', desc: 'LiFi-powered route + signed transfer', action: 'quote', capabilityId: 'bridge.crosschain', route: '/bridge', requiresWallet: true },
  { id: 'bridge_quote', category: 'bridge', icon: '💬', title: 'Bridge Quote', desc: 'Live route/fee/ETA from the bridge engine', action: 'quote', capabilityId: 'bridge.getQuote', route: '/bridge' },
  { id: 'bridge_execute', category: 'bridge', icon: '🚀', title: 'Bridge Execute', desc: 'Prepare → simulate → confirm → sign → verify', action: 'quote', capabilityId: 'bridge.execute', route: '/bridge', requiresWallet: true },

  /* ------------------------------- Lending ------------------------------- */
  { id: 'lending_lend', category: 'lending', icon: '🏦', title: 'Lend', desc: 'Supply to real lending markets (Morpho/Aave style)', action: 'navigate', capabilityId: 'lending.supply', route: '/loan', requiresWallet: true },
  { id: 'lending_borrow', category: 'lending', icon: '🪙', title: 'Borrow', desc: 'Borrow against supplied collateral', action: 'navigate', capabilityId: 'lending.borrow', route: '/loan', requiresWallet: true },
  { id: 'lending_repay', category: 'lending', icon: '↩️', title: 'Repay', desc: 'Repay a borrow position', action: 'navigate', capabilityId: 'lending.repay', route: '/loan', requiresWallet: true },
  { id: 'lending_withdraw', category: 'lending', icon: '📤', title: 'Withdraw', desc: 'Withdraw supplied assets', action: 'navigate', capabilityId: 'lending.withdraw', route: '/loan', requiresWallet: true },
  { id: 'lending_analysis', category: 'lending', icon: '📈', title: 'Position Analysis', desc: 'Lending markets: supply/borrow APY and risk', action: 'read', capabilityId: 'lending.markets', route: '/loan' },

  /* --------------------------------- Farm -------------------------------- */
  { id: 'farm_analysis', category: 'farm', icon: '📊', title: 'Farm Analysis', desc: 'Live yield farms and their APYs (DefiLlama-backed)', action: 'read', capabilityId: 'farming.list', route: '/farm' },
  { id: 'farm_recommend', category: 'farm', icon: '🎯', title: 'Farm Recommendation', desc: 'Ranked farm opportunities toward your goal', action: 'opportunity', capabilityId: 'farming.list', route: '/farm' },
  { id: 'farm_deposit', category: 'farm', icon: '⬇️', title: 'Deposit', desc: 'Deposit into a farm (venue page, wallet signs)', action: 'navigate', capabilityId: 'farming.deposit', route: '/farm', requiresWallet: true },
  { id: 'farm_withdraw', category: 'farm', icon: '⬆️', title: 'Withdraw', desc: 'Withdraw from a farm position', action: 'navigate', capabilityId: 'farming.withdraw', route: '/farm', requiresWallet: true },
  { id: 'farm_claim', category: 'farm', icon: '🎁', title: 'Claim', desc: 'Claim farm rewards', action: 'navigate', capabilityId: 'farming.claim', route: '/farm', requiresWallet: true },
  { id: 'farm_compound', category: 'farm', icon: '🔁', title: 'Compound', desc: 'Re-invest farm rewards', action: 'navigate', capabilityId: 'farming.compound', route: '/farm', requiresWallet: true },

  /* ------------------------------ Liquidity ------------------------------ */
  { id: 'lp_analysis', category: 'liquidity', icon: '💧', title: 'Pool Analysis', desc: 'Liquidity pools: APY, TVL, IL risk', action: 'read', capabilityId: 'liquidity.pools', route: '/farm' },
  { id: 'lp_add', category: 'liquidity', icon: '➕', title: 'Add Liquidity', desc: 'Add to a pool (venue page, wallet signs)', action: 'navigate', capabilityId: 'liquidity.add', route: '/farm', requiresWallet: true },
  { id: 'lp_remove', category: 'liquidity', icon: '➖', title: 'Remove Liquidity', desc: 'Remove from a pool', action: 'navigate', capabilityId: 'liquidity.remove', route: '/farm', requiresWallet: true },
  { id: 'lp_stake', category: 'liquidity', icon: '🧱', title: 'Stake LP', desc: 'Stake LP tokens for rewards', action: 'navigate', capabilityId: 'liquidity.stake', route: '/farm', requiresWallet: true },
  { id: 'lp_unstake', category: 'liquidity', icon: '🔓', title: 'Unstake LP', desc: 'Unstake LP tokens', action: 'navigate', capabilityId: 'liquidity.unstake', route: '/farm', requiresWallet: true },

  /* ------------------------------- Futures ------------------------------- */
  { id: 'futures_analysis', category: 'futures', icon: '📉', title: 'Futures Analysis', desc: 'On-chain perp markets: funding, OI, risk', action: 'read', capabilityId: 'futures.analysis', route: '/perp' },
  { id: 'futures_position', category: 'futures', icon: '📍', title: 'Position', desc: 'Open positions and liquidation prices', action: 'read', capabilityId: 'futures.positions', route: '/perp' },
  { id: 'futures_open', category: 'futures', icon: '🟢', title: 'Open', desc: 'Open a perp position (venue page, real quote)', action: 'navigate', capabilityId: 'futures.open', route: '/perp?tab=onchain', requiresWallet: true },
  { id: 'futures_close', category: 'futures', icon: '🔴', title: 'Close', desc: 'Close a perp position', action: 'navigate', capabilityId: 'futures.close', route: '/perp?tab=onchain&panel=positions', requiresWallet: true },
  { id: 'futures_reduce', category: 'futures', icon: '✂️', title: 'Reduce', desc: 'Reduce position size', action: 'navigate', capabilityId: 'futures.reduce', route: '/perp', requiresWallet: true },
  { id: 'futures_risk', category: 'futures', icon: '🛡️', title: 'Risk Analysis', desc: 'Liquidation/leverage risk for perp markets', action: 'read', capabilityId: 'futures.risk', route: '/perp' },

  /* --------------------------------- dYdX -------------------------------- */
  { id: 'dydx_market', category: 'dydx', icon: '📊', title: 'Market', desc: 'dYdX markets: funding, volume, spread', action: 'read', capabilityId: 'dydx.markets', route: '/dydx' },
  { id: 'dydx_position', category: 'dydx', icon: '📍', title: 'Position', desc: 'dYdX positions', action: 'read', capabilityId: 'dydx.positions', route: '/dydx' },
  { id: 'dydx_open', category: 'dydx', icon: '🟢', title: 'Open', desc: 'Open a dYdX position', action: 'navigate', capabilityId: 'dydx.open', route: '/dydx', requiresWallet: true },
  { id: 'dydx_close', category: 'dydx', icon: '🔴', title: 'Close', desc: 'Close a dYdX position', action: 'navigate', capabilityId: 'dydx.close', route: '/dydx', requiresWallet: true },
  { id: 'dydx_risk', category: 'dydx', icon: '🛡️', title: 'Risk', desc: 'dYdX risk levels', action: 'read', capabilityId: 'dydx.risk', route: '/dydx' },

  /* ---------------------------- Global markets --------------------------- */
  { id: 'markets_stocks', category: 'markets', icon: '📈', title: 'Stocks', desc: 'Live stock data (source: real feed)', action: 'navigate', capabilityId: 'stocks.list', route: '/stocks' },
  { id: 'markets_etf', category: 'markets', icon: '📦', title: 'ETF', desc: 'ETF coverage', action: 'navigate', capabilityId: 'stocks.etf', route: '/stocks' },
  { id: 'markets_funds', category: 'markets', icon: '💰', title: 'Funds', desc: 'Funds coverage', action: 'navigate', capabilityId: 'stocks.funds', route: '/stocks' },
  { id: 'markets_forex', category: 'markets', icon: '💱', title: 'Forex', desc: 'FX pairs (Horizon / global outlook)', action: 'navigate', capabilityId: 'horizon.forex', route: '/invest' },
  { id: 'markets_commodities', category: 'markets', icon: '🛢️', title: 'Commodities', desc: 'Commodity coverage', action: 'navigate', capabilityId: 'horizon.commodities', route: '/invest' },
  { id: 'markets_rwa', category: 'markets', icon: '🏛️', title: 'RWA', desc: 'Real-world-asset tokens (PAXG/XAUt are swappable)', action: 'read', capabilityId: 'rwa.tokens', route: '/market' },
  { id: 'markets_tokenized', category: 'markets', icon: '🔖', title: 'Tokenized Assets', desc: 'Tokenized gold and staked assets', action: 'read', capabilityId: 'rwa.tokenized', route: '/market' },

  /* ---------------------------- Intelligence ----------------------------- */
  { id: 'intel_marketscan', category: 'intelligence', icon: '🛰️', title: 'Market Scan', desc: 'Live market scan: movers, volume, volatility', action: 'read', capabilityId: 'market.overview', route: '/market' },
  { id: 'intel_smartmoney', category: 'intelligence', icon: '🧠', title: 'Smart Money', desc: 'Smart-money wallet tracking (real data)', action: 'read', capabilityId: 'smartMoney.track', route: '/smart-money' },
  { id: 'intel_whales', category: 'intelligence', icon: '🐋', title: 'Whale Tracking', desc: 'Whale movement feed', action: 'read', capabilityId: 'whale.track', route: '/smart-money' },
  { id: 'intel_signals', category: 'intelligence', icon: '📡', title: 'Signals', desc: 'Signal providers', action: 'read', capabilityId: 'signals.list', route: '/signals' },
  { id: 'intel_news', category: 'intelligence', icon: '📰', title: 'News', desc: 'Live market news', action: 'read', capabilityId: 'news.search', route: '/news' },
  { id: 'intel_events', category: 'intelligence', icon: '🗓️', title: 'Events', desc: 'Market events calendar', action: 'read', capabilityId: 'news.events', route: '/news' },
  { id: 'intel_token', category: 'intelligence', icon: '🔍', title: 'Token Analysis', desc: 'Analyze a token with live market data', action: 'read', capabilityId: 'market.tokenDetail', route: '/market' },
  { id: 'intel_contract', category: 'intelligence', icon: '📜', title: 'Contract Analysis', desc: 'Token contract risk screen (address shield)', action: 'read', capabilityId: 'intel.contract', route: '/smart-wallet' },

  /* -------------------------------- Goals -------------------------------- */
  { id: 'goals_create', category: 'goals', icon: '🎯', title: 'Financial Goal', desc: 'Create a real, durable financial goal (Financial OS) — real markets: Horizon/Perp/Stocks', action: 'navigate', capabilityId: 'goals.create', route: '/invest' },
  { id: 'goals_profit', category: 'goals', icon: '📈', title: 'Profit Plan', desc: 'Risk-aware plan toward your profit target — opens real trading: Horizon (افق جهانی), Perp (فیوچرز), Stocks (سهام)', action: 'navigate', capabilityId: 'profit_plan.build', route: '/invest' },
  { id: 'goals_forecast', category: 'goals', icon: '🔮', title: 'Forecast', desc: 'Historical scenario range for a goal (no guarantees) — real data from Horizon', action: 'navigate', capabilityId: 'goals.forecast', route: '/invest' },
  { id: 'goals_whatif', category: 'goals', icon: '🧮', title: 'What-if', desc: 'What-if simulation on real portfolio data — real markets only', action: 'navigate', capabilityId: 'goals.whatif', route: '/invest' },
  { id: 'goals_progress', category: 'goals', icon: '📊', title: 'Progress', desc: 'Real progress toward existing goals — portfolio view', action: 'read', capabilityId: 'goals.progress', route: '/portfolio' },
  { id: 'goals_rebalance', category: 'goals', icon: '⚖️', title: 'Rebalance', desc: 'Align portfolio with the goal plan', action: 'quote', capabilityId: 'portfolio.rebalance', route: '/portfolio', requiresWallet: true },

  /* ------------------------------ Automation ----------------------------- */
  { id: 'auto_watchmarket', category: 'automation', icon: '👁️', title: 'Watch Market', desc: 'Create a real monitor job (server-evaluated)', action: 'monitor', capabilityId: 'monitor.create', route: '/intent' },
  { id: 'auto_pricealert', category: 'automation', icon: '🔔', title: 'Price Alert', desc: 'Alert when an asset crosses a price', action: 'monitor', capabilityId: 'alerts.price', route: '/intent' },
  { id: 'auto_condition', category: 'automation', icon: '📐', title: 'Condition Monitoring', desc: 'Monitor a condition (price, change %, volatility)', action: 'monitor', capabilityId: 'monitor.conditions', route: '/intent' },
  { id: 'auto_strategy', category: 'automation', icon: '🧠', title: 'Auto Strategy', desc: 'Portfolio/opportunity monitor toward a goal', action: 'opportunity', capabilityId: 'opportunity.monitor', route: '/intent' },
  { id: 'auto_scheduled', category: 'automation', icon: '🗓️', title: 'Scheduled Action', desc: 'DCA / recurring buy (server automation registry)', action: 'order', capabilityId: 'automation.schedule', route: '/orders' },
  { id: 'auto_recurring', category: 'automation', icon: '🔁', title: 'Recurring Buy', desc: 'Real recurring DCA plan', action: 'order', capabilityId: 'dca.create', route: '/orders' },
  { id: 'auto_conditional', category: 'automation', icon: '🎯', title: 'Conditional Buy', desc: '«Buy when BTC reaches X» → real order on /orders', action: 'order', capabilityId: 'orders.create', route: '/orders' },

  /* ------------------------------ Monitoring ----------------------------- */
  { id: 'monitor_list', category: 'monitoring', icon: '📋', title: 'Active Monitoring', desc: 'All running monitors with real status', action: 'monitor', capabilityId: 'monitor.list', route: '/intent' },
  { id: 'monitor_opportunity', category: 'monitoring', icon: '🎯', title: 'Opportunity Monitor', desc: 'Watch for opportunities toward your goal', action: 'opportunity', capabilityId: 'opportunity.monitor', route: '/intent' },
  { id: 'monitor_portfolio', category: 'monitoring', icon: '📊', title: 'Portfolio Monitor', desc: 'Watch portfolio risk/change', action: 'monitor', capabilityId: 'portfolio.monitor', route: '/intent' },

  /* -------------------------------- Rewards ------------------------------ */
  { id: 'rewards_dashboard', category: 'rewards', icon: '🏆', title: 'FBT Rewards', desc: 'Points, missions and referrals (real rewards engine)', action: 'navigate', capabilityId: 'rewards.dashboard', route: '/rewards' },
  { id: 'rewards_missions', category: 'rewards', icon: '🎖️', title: 'Missions', desc: 'Complete missions and earn points', action: 'navigate', capabilityId: 'rewards.missions', route: '/rewards' },
  { id: 'rewards_points', category: 'rewards', icon: '⭐', title: 'Points', desc: 'Track points balance', action: 'navigate', capabilityId: 'rewards.points', route: '/rewards' },
  { id: 'rewards_referral', category: 'rewards', icon: '🤝', title: 'Referral', desc: 'Invite friends and earn rewards', action: 'navigate', capabilityId: 'rewards.referral', route: '/rewards' }
]);

export function categoriesForCard(card) {
  return CATEGORIES.find((c) => c.id === card.category) || null;
}

/** Honest availability: a card is available when its venue route exists in the
 *  app and (if required) a wallet is connected/readable. Callers may refine
 *  with real runtime checks (server reachability / capability registry). */
export function cardAvailability(card, { walletConnected = false, serverReachable = false } = {}) {
  if (!card) return { available: false, reason: 'MISSING' };
  if (card.action === 'unavailable') return { available: false, reason: 'UNAVAILABLE' };
  if (card.requiresWallet && !walletConnected) return { available: false, reason: 'WALLET_REQUIRED' };
  if ((card.action === 'monitor' || card.action === 'order' || card.action === 'opportunity') && !serverReachable) {
    return { available: true, reason: 'OFFLINE_FALLBACK' };
  }
  return { available: true, reason: null };
}
