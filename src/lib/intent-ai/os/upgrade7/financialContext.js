/**
 * FBT INTENT OS — UPGRADE 7 · Personal Financial Context + Cross-Module Routing
 * ---------------------------------------------------------------------------
 * Spec §9 (structured personal financial context; never guess what is absent),
 * §10 (cross-module intelligence — the user should not have to find the module),
 * §17 (smart money enrichment for a token question).
 */

export const FINANCIAL_CONTEXT_SCHEMA = 'fbt.financial-context.v7';

/** Every slice the OS is allowed to reason about, and its availability. */
export const CONTEXT_SLICES = Object.freeze([
  'wallets', 'balances', 'assets', 'portfolio', 'positions', 'openOrders',
  'yieldPositions', 'loans', 'farming', 'futures', 'watchlist', 'alerts',
  'previousIntent', 'currentGoal'
]);

function slice(value, { source = null, fetchedAt = null } = {}) {
  const present = value != null && (!Array.isArray(value) || value.length > 0) && (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 0);
  return {
    available: present,
    value: present ? value : null,
    source: present ? source : null,
    fetchedAt: present ? (fetchedAt || Date.now()) : null,
    // The single most important field in this module: when a slice is absent the
    // OS must SAY so rather than invent a number (§9, §26).
    unknown: !present
  };
}

/**
 * Assemble the structured financial picture from whatever the host actually
 * passed. Nothing is fabricated; a missing slice is explicitly `unknown`.
 */
export function buildFinancialContext({
  wallet = null, portfolio = null, orders = null, positions = null,
  yieldPositions = null, loans = null, farming = null, futures = null,
  watchlist = null, alerts = null, previousIntent = null, currentGoal = null,
  fetchedAt = null
} = {}) {
  const balances = wallet?.balances || wallet?.tokenBalances || portfolio?.balances || null;
  const holdings = portfolio?.holdings || null;

  const ctx = {
    schema: FINANCIAL_CONTEXT_SCHEMA,
    wallets: slice(
      wallet?.address || wallet?.solanaAddress
        ? [wallet.address, wallet.solanaAddress].filter(Boolean).map((address) => ({ address, chainId: wallet.chainId || null, canSign: wallet.canSign !== false }))
        : null,
      { source: 'wallet-context', fetchedAt }
    ),
    balances: slice(balances, { source: 'wallet', fetchedAt }),
    assets: slice(
      holdings ? holdings.map((h) => ({ symbol: h.symbol, valueUsd: h.valueUsd ?? null, amount: h.amount ?? h.balance ?? null })) : null,
      { source: 'portfolio', fetchedAt }
    ),
    portfolio: slice(
      portfolio?.totalValueUsd != null || holdings?.length
        ? { totalValueUsd: portfolio.totalValueUsd ?? null, holdingCount: holdings?.length ?? 0, dataStatus: portfolio.dataStatus || null }
        : null,
      { source: 'portfolio', fetchedAt }
    ),
    positions: slice(positions, { source: 'positions' }),
    openOrders: slice(orders, { source: 'orders' }),
    yieldPositions: slice(yieldPositions, { source: 'yield' }),
    loans: slice(loans, { source: 'lending' }),
    farming: slice(farming, { source: 'farm' }),
    futures: slice(futures, { source: 'futures' }),
    watchlist: slice(watchlist, { source: 'watchlist' }),
    alerts: slice(alerts, { source: 'alerts' }),
    previousIntent: slice(previousIntent, { source: 'session' }),
    currentGoal: slice(currentGoal, { source: 'goal-memory' })
  };

  const available = CONTEXT_SLICES.filter((k) => ctx[k]?.available);
  ctx.coverage = Math.round((available.length / CONTEXT_SLICES.length) * 100) / 100;
  ctx.availableSlices = available;
  ctx.unknownSlices = CONTEXT_SLICES.filter((k) => !ctx[k]?.available);
  ctx.builtAt = Date.now();
  return ctx;
}

/** What the OS may state as fact vs what it must decline to answer (§9, §26). */
export function canAnswerFrom(financialContext, sliceName) {
  const s = financialContext?.[sliceName];
  return {
    ok: Boolean(s?.available),
    reason: s?.available ? null : 'SLICE_UNAVAILABLE',
    messageFa: s?.available ? null : 'برای این مورد داده تاییدشده‌ای ندارم.',
    messageEn: s?.available ? null : "I don't currently have verified data for this."
  };
}

/* -------------------------------------------------------------------------- */
/*  §10 CROSS-MODULE INTELLIGENCE                                               */
/* -------------------------------------------------------------------------- */

/**
 * The modules a goal touches, in the order the OS should consult them. The user
 * says what they want; the OS decides which of Wallet / Portfolio / Swap /
 * Lending / Farm / Futures / Signals / Smart Money / Market are involved.
 */
export const MODULE_GRAPH = Object.freeze({
  wallet: { connects: ['portfolio', 'swap', 'futures'], route: '/wallet' },
  portfolio: { connects: ['wallet', 'swap', 'lending', 'farm', 'market'], route: '/portfolio' },
  swap: { connects: ['wallet', 'portfolio', 'market'], route: '/swap' },
  lending: { connects: ['portfolio', 'wallet'], route: '/lend' },
  farm: { connects: ['portfolio', 'wallet'], route: '/farm' },
  futures: { connects: ['wallet', 'market', 'signals'], route: '/futures' },
  signals: { connects: ['market', 'smartMoney'], route: '/signals' },
  smartMoney: { connects: ['market', 'signals'], route: '/smart-money' },
  market: { connects: ['signals', 'smartMoney', 'portfolio'], route: '/market' }
});

const GOAL_MODULES = {
  maximize_return: ['portfolio', 'market', 'farm', 'lending', 'swap'],
  generate_income: ['portfolio', 'farm', 'lending'],
  reduce_risk: ['portfolio', 'market', 'swap'],
  preserve_capital: ['portfolio', 'swap', 'lending'],
  rebalance: ['portfolio', 'swap', 'wallet'],
  exit: ['portfolio', 'swap', 'wallet'],
  accumulate: ['swap', 'wallet', 'market'],
  monitor: ['market', 'signals', 'smartMoney'],
  understand: ['market', 'smartMoney', 'signals']
};

export function resolveModules({ goal = null, intentType = null, assets = [] } = {}) {
  const set = new Set(GOAL_MODULES[goal] || []);
  const type = String(intentType || '').toUpperCase();
  if (['SWAP', 'BUY', 'SELL'].includes(type)) { set.add('swap'); set.add('wallet'); set.add('market'); }
  if (['BRIDGE', 'SEND'].includes(type)) { set.add('wallet'); }
  if (['PORTFOLIO_ANALYSIS', 'REBALANCE', 'RISK_ANALYSIS'].includes(type)) { set.add('portfolio'); set.add('market'); }
  if (['YIELD_DISCOVERY', 'FARM'].includes(type)) set.add('farm');
  if (['LEND', 'BORROW'].includes(type)) set.add('lending');
  if (['FUTURES'].includes(type)) set.add('futures');
  if (['SMART_MONEY', 'WHALE'].includes(type)) { set.add('smartMoney'); set.add('market'); }
  if (['SIGNALS'].includes(type)) set.add('signals');
  if (['ANALYZE_TOKEN', 'MARKET_ANALYSIS', 'MARKET_CONTEXT'].includes(type)) { set.add('market'); if (assets.length) set.add('smartMoney'); }
  if (['WALLET_BALANCE'].includes(type)) set.add('wallet');

  const modules = [...set];
  return {
    modules,
    routes: modules.map((m) => MODULE_GRAPH[m]?.route).filter(Boolean),
    // Second-degree modules: what the answer will probably need next (§7).
    related: [...new Set(modules.flatMap((m) => MODULE_GRAPH[m]?.connects || []))].filter((m) => !set.has(m))
  };
}

/* -------------------------------------------------------------------------- */
/*  §17 SMART MONEY ENRICHMENT                                                  */
/* -------------------------------------------------------------------------- */

export const SMART_MONEY_FIELDS = Object.freeze([
  'whales', 'topHolders', 'holderConcentration', 'smartMoneyActivity',
  'walletInflow', 'walletOutflow', 'liquidity', 'volume', 'contractRisk'
]);

/**
 * Normalise whatever the smart-money service returned into the nine fields the
 * spec names, and mark which ones are genuinely present. A missing field is
 * reported as unknown — never as zero.
 */
export function buildSmartMoneyView(raw = {}, { asset = null } = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = raw?.[k];
      if (v != null) return v;
    }
    return null;
  };

  const view = {
    schema: 'fbt.smart-money-view.v7',
    asset: asset || raw?.symbol || raw?.asset || null,
    whales: pick('whales', 'whaleEvents', 'largeHolders'),
    topHolders: pick('topHolders', 'holders'),
    holderConcentration: pick('holderConcentration', 'concentration', 'top10Pct'),
    smartMoneyActivity: pick('smartMoneyActivity', 'smartMoney', 'activity'),
    walletInflow: pick('walletInflow', 'inflow', 'inflowUsd'),
    walletOutflow: pick('walletOutflow', 'outflow', 'outflowUsd'),
    liquidity: pick('liquidity', 'liquidityUsd', 'tvl'),
    volume: pick('volume', 'volume24h', 'volumeUsd'),
    contractRisk: pick('contractRisk', 'tokenRisk', 'riskScore'),
    source: raw?.source || 'smart-money',
    fetchedAt: raw?.fetchedAt || raw?.updatedAt || Date.now()
  };

  view.availableFields = SMART_MONEY_FIELDS.filter((f) => view[f] != null);
  view.unknownFields = SMART_MONEY_FIELDS.filter((f) => view[f] == null);
  view.coverage = Math.round((view.availableFields.length / SMART_MONEY_FIELDS.length) * 100) / 100;

  const net = Number(view.walletInflow) - Number(view.walletOutflow);
  view.netFlowUsd = Number.isFinite(net) ? net : null;
  view.flowBias = view.netFlowUsd == null ? null : (view.netFlowUsd > 0 ? 'accumulation' : view.netFlowUsd < 0 ? 'distribution' : 'flat');

  const conc = Number(view.holderConcentration);
  view.concentrationRisk = Number.isFinite(conc) ? (conc > 0.6 ? 'high' : conc > 0.35 ? 'medium' : 'low') : null;
  return view;
}

/** §17 — combine the smart-money read with the market read into one verdict. */
export function combineWithMarket(smartMoneyView, marketData = {}) {
  const chg = Number(marketData?.change24hPct ?? marketData?.changePct);
  const priceDirection = Number.isFinite(chg) ? (chg > 1 ? 'up' : chg < -1 ? 'down' : 'flat') : null;
  const flow = smartMoneyView?.flowBias || null;

  let alignment = null;
  if (priceDirection && flow) {
    if ((priceDirection === 'up' && flow === 'accumulation') || (priceDirection === 'down' && flow === 'distribution')) alignment = 'confirmed';
    else if (priceDirection === 'flat' || flow === 'flat') alignment = 'neutral';
    else alignment = 'divergent';
  }

  return {
    priceDirection,
    flowBias: flow,
    alignment,
    concentrationRisk: smartMoneyView?.concentrationRisk || null,
    // Divergence between price and flow is exactly the thing worth telling a
    // user — and exactly the thing that must not be stated as a prediction.
    note: alignment === 'divergent' ? 'price_and_flow_disagree' : null,
    dataCoverage: smartMoneyView?.coverage ?? 0
  };
}
