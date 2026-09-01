/**
 * FBT CENTRAL INTELLIGENCE OS — Central Planner (§13, §18).
 * ---------------------------------------------------------------------------
 * Simple requests become ONE step; complex requests become an ordered plan:
 *
 *   "پرتفوی من را بررسی کن، ریسک را کم کن و بهترین مسیر را پیشنهاد بده"
 *     → wallet.read → portfolio.read → markets.read → risk.analyze →
 *       signals.read → news.read → recommendation.generate → presentPlan
 *
 * Every step names a module + operation + permission level, so the policy
 * engine and the tool router can enforce §33 per-step. NO financial
 * execution step ever runs without an explicit confirmation gate (§13).
 */

const step = (module, operation, { permission = null, params = {}, optional = false, description = '' } = {}) => ({
  module, operation, permission, params, optional, description
});

/** Plan templates keyed by intent type. Order = execution order. */
export function planForIntent(intentType, { entities = {}, state = null, page = null } = {}) {
  const asset = entities.asset || page?.selectedAsset || null;

  switch (intentType) {
    case 'PORTFOLIO_ANALYSIS':
      return [
        step('wallet', 'read', { description: 'read wallet state', optional: true }),
        step('portfolio', 'read', { description: 'read holdings' }),
        step('markets', 'read', { description: 'read market state', optional: true }),
        step('risk', 'read', { description: 'portfolio risk pass', optional: true })
      ];
    case 'CONCENTRATION_CHECK':
      return [
        step('portfolio', 'read', { description: 'read holdings' }),
        step('markets', 'read', { description: 'market context', optional: true }),
        step('signals', 'read', { params: { asset }, description: 'asset signal', optional: true }),
        step('news', 'read', { params: { asset }, description: 'asset news', optional: true })
      ];
    case 'RISK_REVIEW':
      return [
        step('wallet', 'read', { optional: true }),
        step('portfolio', 'read', {}),
        step('markets', 'read', { optional: true }),
        step('risk', 'read', { optional: true }),
        step('futures', 'read', { optional: true })
      ];
    case 'SWAP':
    case 'SELL':
    case 'BUY':
      return [
        step('markets', 'read', { description: 'price check', optional: true }),
        step('swap', 'quote', { params: { asset, amountUsd: entities.amountUsd }, description: 'live quote', optional: true }),
        step('swap', 'simulate', { params: { asset }, description: 'simulate the route', optional: true }),
        step('swap', 'prepare', { permission: 'EXECUTE', params: { asset }, description: 'build unsigned tx (needs confirmation)' })
      ];
    case 'BRIDGE':
      return [
        step('bridge', 'quote', { params: { network: entities.network }, description: 'bridge quote', optional: true }),
        step('bridge', 'prepare', { permission: 'EXECUTE', params: { network: entities.network }, description: 'build unsigned bridge tx (needs confirmation)' })
      ];
    case 'SWAP_AND_BRIDGE':
      return [
        step('swap', 'quote', { params: { asset }, description: 'swap leg quote', optional: true }),
        step('swap', 'prepare', { permission: 'EXECUTE', params: { asset }, description: 'swap leg (needs confirmation)' }),
        step('bridge', 'quote', { params: { network: entities.network }, description: 'bridge leg quote', optional: true }),
        step('bridge', 'prepare', { permission: 'EXECUTE', params: { network: entities.network }, description: 'bridge leg (needs confirmation)', optional: true })
      ];
    case 'LOAN_SAFETY':
      return [
        step('lending', 'read', { description: 'loan position' }),
        step('wallet', 'read', { optional: true }),
        step('risk', 'read', { description: 'lending risk pass', optional: true }),
        step('markets', 'read', { optional: true, description: 'collateral oracle cross-check' })
      ];
    case 'BORROW':
      return [
        step('borrowing', 'quote', { description: 'borrow capacity + APR', optional: true }),
        step('lending', 'read', { description: 'current position' }),
        step('risk', 'read', { description: 'post-borrow risk preview', optional: true })
      ];
    case 'LEND':
    case 'REPAY':
      return [
        step('lending', 'read', {}),
        step('farming', 'read', { optional: true, description: 'yield alternatives' })
      ];
    case 'FUTURES_OPEN':
    case 'FUTURES_CLOSE':
      return [
        step('futures', 'read', { description: 'perp market state', optional: true }),
        step('portfolio', 'read', { description: 'portfolio exposure (§24: futures risk includes the current book)', optional: true }),
        step('risk', 'read', { optional: true }),
        step('futures', 'quote', { permission: 'EXECUTE', params: { asset }, description: 'position preview (needs confirmation)' })
      ];
    case 'DYDX_ORDER':
      return [
        step('dydx', 'read', { params: { asset }, description: 'dYdX markets', optional: true }),
        step('dydx', 'quote', { permission: 'EXECUTE', params: { asset }, description: 'order preview (needs confirmation)' })
      ];
    case 'WHAT_IF':
      return [
        step('portfolio', 'read', {}),
        step('forecast', 'read', { params: { asset }, optional: true }),
        step('risk', 'read', { description: 'scenario risk' })
      ];
    case 'GOAL_CREATE':
    case 'GOAL_PROGRESS':
      return [
        step('goals', 'read', {}),
        step('portfolio', 'read', { optional: true }),
        step('markets', 'read', { optional: true }),
        step('farming', 'read', { optional: true, description: 'yield options for the plan' })
      ];
    case 'MARKET_OVERVIEW':
      return [step('markets', 'read', {})];
    case 'NEWS_BRIEF':
      return [step('news', 'read', { params: { asset } })];
    case 'SIGNALS_BRIEF':
      return [
        step('signals', 'read', { params: { asset } }),
        step('news', 'read', { params: { asset }, optional: true }),
        step('futures', 'read', { optional: true, description: 'funding context' })
      ];
    case 'REBALANCE':
      return [
        step('wallet', 'read', { optional: true }),
        step('portfolio', 'read', {}),
        step('markets', 'read', { optional: true }),
        step('risk', 'read', { optional: true }),
        step('swap', 'quote', { permission: 'PREPARE', params: { asset }, description: 'rebalance quote (needs confirmation)', optional: true })
      ];
    case 'TRANSACTION_STATUS':
      return [step('transactions', 'read', { params: { id: entities.txId } })];
    default:
      return [
        step('markets', 'read', { optional: true }),
        step('portfolio', 'read', { optional: true })
      ];
  }
}

/** Which steps demand explicit user confirmation (§13/§33): any EXECUTE. */
export function planRequiresConfirmation(plan) {
  return plan.some((s) => s.permission === 'EXECUTE' || s.operation === 'execute');
}

export function splitPlan(plan) {
  return {
    auto: plan.filter((s) => s.permission !== 'EXECUTE'),
    gated: plan.filter((s) => s.permission === 'EXECUTE')
  };
}
