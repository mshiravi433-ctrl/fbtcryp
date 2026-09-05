/**
 * FBT FINANCIAL OS — Ecosystem Knowledge Graph (Upgrade 11+12 §3)
 * ---------------------------------------------------------------------------
 * Central relationship map that the Intelligence Kernel uses to understand
 * how User → Wallet → Assets → Portfolio → Goals → Risk → Trading → DeFi →
 * Credit → RWA → Business → Payments → Marketplace → Research are connected.
 *
 * This is NOT a database — it is a deterministic function that, given the
 * current financial state and user intent, returns the relevant sub-graph
 * with edges, weights, and reasoning paths. The brain uses it to decide
 * WHICH modules are relevant for a given question, instead of routing
 * everything to a single module.
 *
 * WHY THIS EXISTS
 * Without a knowledge graph, the brain routes "20% profit" only to Trading.
 * With it, the brain sees that the user has DeFi positions, RWA holdings,
 * and a medium risk profile, so it also considers Yield, Lending, and
 * Smart Money signals — producing a multi-module answer.
 */

export const KNOWLEDGE_SCHEMA = 'fbt.ecosystem-knowledge-graph.v1';

/** Module taxonomy — the nodes of the graph */
export const ECOSYSTEM_MODULES = Object.freeze({
  PAY: { id: 'PAY', label: 'Payments', category: 'transaction', priority: 1 },
  WALLET: { id: 'WALLET', label: 'Wallet', category: 'core', priority: 0 },
  PORTFOLIO: { id: 'PORTFOLIO', label: 'Portfolio', category: 'core', priority: 0 },
  TRADING: { id: 'TRADING', label: 'Trading', category: 'investment', priority: 2 },
  SWAP: { id: 'SWAP', label: 'Swap', category: 'transaction', priority: 1 },
  DEFI: { id: 'DEFI', label: 'DeFi', category: 'investment', priority: 2 },
  FARM: { id: 'FARM', label: 'Farming', category: 'investment', priority: 2 },
  LENDING: { id: 'LENDING', label: 'Lending', category: 'investment', priority: 2 },
  FUTURES: { id: 'FUTURES', label: 'Futures', category: 'investment', priority: 3 },
  CREDIT: { id: 'CREDIT', label: 'Credit', category: 'finance', priority: 2 },
  RWA: { id: 'RWA', label: 'Real World Assets', category: 'investment', priority: 2 },
  BUSINESS: { id: 'BUSINESS', label: 'Business', category: 'finance', priority: 2 },
  MARKETPLACE: { id: 'MARKETPLACE', label: 'Marketplace', category: 'commerce', priority: 2 },
  RESEARCH: { id: 'RESEARCH', label: 'Research', category: 'intelligence', priority: 1 },
  SMART_MONEY: { id: 'SMART_MONEY', label: 'Smart Money', category: 'intelligence', priority: 1 },
  SIGNALS: { id: 'SIGNALS', label: 'Signals', category: 'intelligence', priority: 1 },
  NEWS: { id: 'NEWS', label: 'News', category: 'intelligence', priority: 1 },
  GOALS: { id: 'GOALS', label: 'Financial Goals', category: 'planning', priority: 1 },
  RISK: { id: 'RISK', label: 'Risk', category: 'governance', priority: 1 },
  SECURITY: { id: 'SECURITY', label: 'Security', category: 'governance', priority: 0 },
  MACRO: { id: 'MACRO', label: 'Macro', category: 'intelligence', priority: 1 },
  NFT: { id: 'NFT', label: 'NFT', category: 'asset', priority: 2 },
  STOCKS: { id: 'STOCKS', label: 'Stocks/ETF', category: 'investment', priority: 2 },
  FOREX: { id: 'FOREX', label: 'Forex', category: 'investment', priority: 2 },
  COMMODITIES: { id: 'COMMODITIES', label: 'Commodities', category: 'investment', priority: 2 },
  CROSS_CHAIN: { id: 'CROSS_CHAIN', label: 'Cross-Chain', category: 'transaction', priority: 1 },
  BRIDGE: { id: 'BRIDGE', label: 'Bridge', category: 'transaction', priority: 1 }
});

/** Directed edges: from → to with relationship type and weight */
const BASE_EDGES = [
  { from: 'WALLET', to: 'TRADING', rel: 'FUNDS', weight: 0.9 },
  { from: 'WALLET', to: 'PAY', rel: 'FUNDS', weight: 0.95 },
  { from: 'WALLET', to: 'CREDIT', rel: 'COLLATERAL', weight: 0.7 },
  { from: 'WALLET', to: 'DEFI', rel: 'FUNDS', weight: 0.8 },
  { from: 'WALLET', to: 'RWA', rel: 'FUNDS', weight: 0.6 },
  { from: 'WALLET', to: 'MARKETPLACE', rel: 'FUNDS', weight: 0.7 },
  { from: 'WALLET', to: 'SWAP', rel: 'FUNDS', weight: 0.9 },
  { from: 'WALLET', to: 'LENDING', rel: 'FUNDS', weight: 0.7 },
  { from: 'PORTFOLIO', to: 'TRADING', rel: 'ALLOCATION', weight: 0.9 },
  { from: 'PORTFOLIO', to: 'DEFI', rel: 'ALLOCATION', weight: 0.7 },
  { from: 'PORTFOLIO', to: 'RWA', rel: 'ALLOCATION', weight: 0.5 },
  { from: 'PORTFOLIO', to: 'RISK', rel: 'EXPOSURE', weight: 0.95 },
  { from: 'PORTFOLIO', to: 'GOALS', rel: 'PROGRESS', weight: 0.9 },
  { from: 'TRADING', to: 'PORTFOLIO', rel: 'POSITION', weight: 0.9 },
  { from: 'DEFI', to: 'PORTFOLIO', rel: 'YIELD', weight: 0.7 },
  { from: 'LENDING', to: 'CREDIT', rel: 'DEBT', weight: 0.8 },
  { from: 'CREDIT', to: 'RISK', rel: 'LIQUIDATION', weight: 0.95 },
  { from: 'BUSINESS', to: 'CREDIT', rel: 'NEEDS', weight: 0.8 },
  { from: 'BUSINESS', to: 'PAY', rel: 'OPERATES', weight: 0.85 },
  { from: 'RESEARCH', to: 'TRADING', rel: 'INFORMS', weight: 0.8 },
  { from: 'RESEARCH', to: 'DEFI', rel: 'INFORMS', weight: 0.7 },
  { from: 'RESEARCH', to: 'RWA', rel: 'INFORMS', weight: 0.6 },
  { from: 'SMART_MONEY', to: 'TRADING', rel: 'SIGNAL', weight: 0.7 },
  { from: 'SMART_MONEY', to: 'DEFI', rel: 'SIGNAL', weight: 0.6 },
  { from: 'NEWS', to: 'TRADING', rel: 'CATALYST', weight: 0.6 },
  { from: 'SIGNALS', to: 'TRADING', rel: 'TRIGGER', weight: 0.7 },
  { from: 'MARKETPLACE', to: 'PAY', rel: 'SETTLES', weight: 0.9 },
  { from: 'FUTURES', to: 'RISK', rel: 'EXPOSURE', weight: 0.95 },
  { from: 'FUTURES', to: 'TRADING', rel: 'POSITION', weight: 0.8 },
  { from: 'FARM', to: 'DEFI', rel: 'SUBSET', weight: 0.9 },
  { from: 'FARM', to: 'PORTFOLIO', rel: 'YIELD', weight: 0.7 },
  { from: 'STOCKS', to: 'PORTFOLIO', rel: 'ASSET', weight: 0.7 },
  { from: 'FOREX', to: 'PAY', rel: 'FX', weight: 0.6 },
  { from: 'CROSS_CHAIN', to: 'BRIDGE', rel: 'USES', weight: 0.9 },
  { from: 'BRIDGE', to: 'WALLET', rel: 'SETTLES', weight: 0.8 },
  { from: 'MACRO', to: 'RISK', rel: 'CONTEXT', weight: 0.7 },
  { from: 'MACRO', to: 'TRADING', rel: 'REGIME', weight: 0.6 }
];

/** Intent → Module relevance mapping */
const INTENT_MODULE_MAP = {
  // Payment intents
  'pay': ['PAY', 'WALLET', 'SWAP'],
  'send': ['PAY', 'WALLET', 'CROSS_CHAIN'],
  'transfer': ['PAY', 'WALLET', 'BRIDGE', 'CROSS_CHAIN'],
  'invoice': ['PAY', 'BUSINESS'],
  'bill': ['PAY', 'WALLET'],
  'purchase': ['MARKETPLACE', 'PAY', 'WALLET'],
  'buy_item': ['MARKETPLACE', 'PAY', 'WALLET'],

  // Investment intents
  'invest': ['PORTFOLIO', 'RESEARCH', 'TRADING', 'DEFI', 'RWA', 'RISK', 'GOALS'],
  'grow': ['PORTFOLIO', 'RESEARCH', 'TRADING', 'DEFI', 'RWA', 'SMART_MONEY', 'RISK', 'GOALS'],
  'profit': ['TRADING', 'DEFI', 'FARM', 'LENDING', 'RWA', 'RESEARCH', 'SMART_MONEY', 'RISK'],
  'yield': ['DEFI', 'FARM', 'LENDING', 'RESEARCH', 'RISK'],
  'stake': ['DEFI', 'FARM', 'RESEARCH', 'RISK'],
  'farm': ['DEFI', 'FARM', 'RESEARCH', 'RISK'],
  'lend': ['LENDING', 'DEFI', 'RESEARCH', 'RISK', 'CREDIT'],
  'borrow': ['CREDIT', 'LENDING', 'RISK'],

  // Trading intents
  'buy': ['TRADING', 'SWAP', 'WALLET', 'RESEARCH'],
  'sell': ['TRADING', 'SWAP', 'WALLET'],
  'trade': ['TRADING', 'RESEARCH', 'SIGNALS', 'RISK'],
  'swap': ['SWAP', 'WALLET', 'TRADING'],
  'exchange': ['SWAP', 'CROSS_CHAIN', 'BRIDGE'],
  'order': ['TRADING', 'SIGNALS'],
  'futures': ['FUTURES', 'TRADING', 'RISK'],
  'perpetual': ['FUTURES', 'TRADING', 'RISK'],
  'long': ['TRADING', 'FUTURES', 'RESEARCH'],
  'short': ['TRADING', 'FUTURES', 'RESEARCH'],

  // Research intents
  'research': ['RESEARCH', 'NEWS', 'SMART_MONEY', 'SIGNALS'],
  'analyze': ['RESEARCH', 'RISK', 'SMART_MONEY'],
  'news': ['NEWS', 'RESEARCH', 'SIGNALS'],
  'why': ['RESEARCH', 'NEWS', 'SMART_MONEY', 'MACRO', 'SIGNALS'],
  'what_happened': ['NEWS', 'RESEARCH', 'MACRO', 'SMART_MONEY'],
  'opinion': ['RESEARCH', 'SMART_MONEY', 'RISK'],

  // Portfolio intents
  'portfolio': ['PORTFOLIO', 'WALLET', 'RISK', 'GOALS'],
  'allocation': ['PORTFOLIO', 'RISK', 'RESEARCH', 'GOALS'],
  'rebalance': ['PORTFOLIO', 'TRADING', 'RISK', 'SWAP'],
  'diversify': ['PORTFOLIO', 'RESEARCH', 'RWA', 'DEFI', 'RISK'],
  'drift': ['PORTFOLIO', 'RISK', 'GOALS'],
  'performance': ['PORTFOLIO', 'TRADING', 'RESEARCH'],

  // Business intents
  'business': ['BUSINESS', 'CREDIT', 'PAY', 'RISK'],
  'revenue': ['BUSINESS', 'PAY'],
  'expense': ['BUSINESS', 'PAY'],
  'cashflow': ['BUSINESS', 'PAY', 'CREDIT', 'RISK'],
  'customer': ['BUSINESS', 'PAY'],

  // Credit intents
  'credit': ['CREDIT', 'RISK', 'WALLET', 'LENDING'],
  'loan': ['CREDIT', 'LENDING', 'RISK', 'BUSINESS'],
  'collateral': ['CREDIT', 'WALLET', 'RISK'],
  'debt': ['CREDIT', 'LENDING', 'RISK'],
  'borrow_capacity': ['CREDIT', 'WALLET', 'PORTFOLIO', 'RISK'],

  // RWA intents
  'rwa': ['RWA', 'RESEARCH', 'RISK', 'PORTFOLIO'],
  'real_estate': ['RWA', 'RESEARCH', 'CREDIT', 'RISK'],
  'tokenized': ['RWA', 'RESEARCH', 'DEFI'],
  'treasury': ['RWA', 'RESEARCH', 'MACRO'],
  'commodity': ['COMMODITIES', 'RESEARCH', 'RWA', 'RISK'],
  'stock': ['STOCKS', 'RESEARCH', 'PORTFOLIO'],
  'forex': ['FOREX', 'RESEARCH', 'PAY'],

  // Smart Money intents
  'whale': ['SMART_MONEY', 'RESEARCH', 'TRADING'],
  'smart_money': ['SMART_MONEY', 'RESEARCH', 'TRADING', 'DEFI'],
  'on_chain': ['SMART_MONEY', 'RESEARCH'],
  'flow': ['SMART_MONEY', 'RESEARCH', 'TRADING'],

  // Goal intents
  'goal': ['GOALS', 'PORTFOLIO', 'RISK', 'RESEARCH'],
  'target': ['GOALS', 'PORTFOLIO', 'RISK'],
  'plan': ['GOALS', 'PORTFOLIO', 'RISK', 'RESEARCH'],
  'save': ['GOALS', 'PORTFOLIO', 'PAY'],
  'retirement': ['GOALS', 'PORTFOLIO', 'RWA', 'RISK'],

  // Risk intents
  'risk': ['RISK', 'PORTFOLIO', 'CREDIT', 'SECURITY'],
  'safe': ['RISK', 'SECURITY', 'RWA', 'PORTFOLIO'],
  'loss': ['RISK', 'PORTFOLIO', 'TRADING'],
  'liquidation': ['CREDIT', 'RISK', 'LENDING'],
  'protect': ['RISK', 'SECURITY', 'PORTFOLIO'],

  // Scenario intents
  'scenario': ['GOALS', 'PORTFOLIO', 'RISK', 'RESEARCH'],
  'what_if': ['GOALS', 'PORTFOLIO', 'RISK', 'RESEARCH'],
  'simulate': ['GOALS', 'PORTFOLIO', 'RISK'],
  'predict': ['RESEARCH', 'MACRO', 'PORTFOLIO', 'RISK'],
  'forecast': ['RESEARCH', 'MACRO', 'PORTFOLIO', 'GOALS'],

  // Marketplace intents
  'shop': ['MARKETPLACE', 'PAY', 'WALLET'],
  'product': ['MARKETPLACE', 'PAY'],
  'gift_card': ['MARKETPLACE', 'PAY'],
  'travel': ['MARKETPLACE', 'PAY', 'FOREX'],
  'hotel': ['MARKETPLACE', 'PAY'],

  // Cross-chain intents
  'bridge': ['BRIDGE', 'CROSS_CHAIN', 'WALLET'],
  'cross_chain': ['CROSS_CHAIN', 'BRIDGE', 'WALLET'],

  // DeFi intents
  'defi': ['DEFI', 'RESEARCH', 'RISK', 'PORTFOLIO'],
  'protocol': ['DEFI', 'RESEARCH', 'RISK'],
  'pool': ['DEFI', 'FARM', 'RESEARCH'],
  'liquidity': ['DEFI', 'FARM', 'RESEARCH', 'RISK'],
  'vault': ['DEFI', 'RESEARCH', 'RISK'],
  'restake': ['DEFI', 'RESEARCH', 'RISK'],

  // Macro intents
  'inflation': ['MACRO', 'RESEARCH', 'RISK', 'COMMODITIES'],
  'interest_rate': ['MACRO', 'RESEARCH', 'RISK', 'RWA'],
  'fed': ['MACRO', 'RESEARCH', 'RISK'],
  'market_crash': ['MACRO', 'RISK', 'PORTFOLIO', 'RESEARCH'],
  'regime': ['MACRO', 'RESEARCH', 'TRADING', 'RISK'],

  // Monitoring intents
  'monitor': ['PORTFOLIO', 'RISK', 'GOALS', 'NEWS'],
  'alert': ['NEWS', 'SIGNALS', 'SMART_MONEY', 'RISK'],
  'watch': ['SMART_MONEY', 'SIGNALS', 'NEWS'],
  'notify': ['NEWS', 'SIGNALS', 'RISK']
};

/**
 * Build the relevant sub-graph for a given intent and user context.
 * Returns sorted modules with relevance scores and reasoning paths.
 */
export function resolveEcosystemGraph({
  intentKeywords = [],
  financialState = null,
  userProfile = null,
  activeGoals = [],
  existingPositions = {},
  riskProfile = null,
  now = Date.now()
} = {}) {
  const moduleScores = new Map();
  const edges = [];
  const reasoning = [];

  // Score modules based on intent keywords
  for (const kw of intentKeywords) {
    const normalizedKey = String(kw).toLowerCase().replace(/[^a-z_]/g, '_');
    const modules = INTENT_MODULE_MAP[normalizedKey] || [];
    for (let i = 0; i < modules.length; i++) {
      const modId = modules[i];
      const baseScore = 1.0 - (i * 0.12); // first module gets highest score
      const current = moduleScores.get(modId) || { score: 0, reasons: [] };
      current.score = Math.max(current.score, baseScore);
      current.reasons.push(`intent_keyword:${normalizedKey}`);
      moduleScores.set(modId, current);
    }
  }

  // Boost modules based on existing positions
  if (existingPositions.defi?.length > 0) {
    boostModule(moduleScores, 'DEFI', 0.3, 'has_defi_positions');
  }
  if (existingPositions.rwa?.length > 0) {
    boostModule(moduleScores, 'RWA', 0.3, 'has_rwa_positions');
  }
  if (existingPositions.futures?.length > 0) {
    boostModule(moduleScores, 'FUTURES', 0.3, 'has_futures_positions');
  }
  if (existingPositions.lending?.length > 0) {
    boostModule(moduleScores, 'LENDING', 0.3, 'has_lending_positions');
  }
  if (existingPositions.business) {
    boostModule(moduleScores, 'BUSINESS', 0.3, 'has_business_state');
  }

  // Boost based on active goals
  for (const goal of activeGoals) {
    if (goal.type === 'GROWTH' || goal.type === 'INVESTMENT') {
      boostModule(moduleScores, 'PORTFOLIO', 0.2, 'active_growth_goal');
      boostModule(moduleScores, 'RESEARCH', 0.2, 'active_growth_goal');
      boostModule(moduleScores, 'GOALS', 0.3, 'active_goal_tracking');
    }
    if (goal.type === 'SAVINGS' || goal.type === 'PAYMENT') {
      boostModule(moduleScores, 'PAY', 0.2, 'active_payment_goal');
    }
  }

  // Risk profile adjustment
  if (riskProfile === 'CONSERVATIVE') {
    boostModule(moduleScores, 'RWA', 0.2, 'conservative_risk_profile');
    boostModule(moduleScores, 'LENDING', 0.15, 'conservative_risk_profile');
    reduceModule(moduleScores, 'FUTURES', 0.3, 'conservative_risk_profile');
    reduceModule(moduleScores, 'TRADING', 0.15, 'conservative_risk_profile');
  } else if (riskProfile === 'AGGRESSIVE') {
    boostModule(moduleScores, 'TRADING', 0.2, 'aggressive_risk_profile');
    boostModule(moduleScores, 'DEFI', 0.2, 'aggressive_risk_profile');
    boostModule(moduleScores, 'FUTURES', 0.15, 'aggressive_risk_profile');
  }

  // Always include core modules
  boostModule(moduleScores, 'WALLET', 0.1, 'always_core');
  boostModule(moduleScores, 'RISK', 0.1, 'always_core');

  // Build edges for selected modules
  const selectedModules = [...moduleScores.entries()]
    .filter(([, v]) => v.score > 0.1)
    .sort((a, b) => b[1].score - a[1].score);

  for (const edge of BASE_EDGES) {
    const fromSelected = moduleScores.has(edge.from);
    const toSelected = moduleScores.has(edge.to);
    if (fromSelected && toSelected) {
      edges.push({ ...edge, effectiveWeight: edge.weight * Math.min(
        moduleScores.get(edge.from)?.score || 0.5,
        moduleScores.get(edge.to)?.score || 0.5
      )});
    }
  }

  // Build reasoning
  for (const [modId, data] of selectedModules) {
    reasoning.push({
      module: modId,
      score: Math.round(data.score * 100) / 100,
      reasons: data.reasons.slice(0, 3),
      definition: ECOSYSTEM_MODULES[modId] || null
    });
  }

  return {
    schema: KNOWLEDGE_SCHEMA,
    at: now,
    modules: reasoning.map(r => ({ id: r.module, ...r })),
    edges: edges.sort((a, b) => b.effectiveWeight - a.effectiveWeight).slice(0, 20),
    selectedModuleIds: reasoning.map(r => r.module),
    crossModule: reasoning.length > 2,
    totalModules: Object.keys(ECOSYSTEM_MODULES).length,
    matchedKeywords: intentKeywords.length
  };
}

/**
 * Given a natural-language-style intent, extract relevant keywords
 * and resolve the ecosystem graph.
 */
export function resolveIntentToModules(intentText, context = {}) {
  const text = String(intentText || '').toLowerCase();
  const keywords = [];

  // Match against all intent keys
  for (const key of Object.keys(INTENT_MODULE_MAP)) {
    const normalized = key.replace(/_/g, ' ');
    if (text.includes(normalized) || text.includes(key)) {
      keywords.push(key);
    }
  }

  // Persian keyword mapping
  const FA_MAP = {
    'خرید': 'buy', 'فروش': 'sell', 'پرداخت': 'pay', 'ارسال': 'send',
    'سرمایه‌گذاری': 'invest', 'رشد': 'grow', 'سود': 'profit',
    'وام': 'loan', 'قرض': 'borrow', 'اعتبار': 'credit',
    'پرتفوی': 'portfolio', 'ریسک': 'risk', 'هدف': 'goal',
    'تحقیق': 'research', 'تحلیل': 'analyze', 'اخبار': 'news',
    'کسب‌وکار': 'business', 'درآمد': 'revenue', 'هزینه': 'expense',
    'جریان_نقدی': 'cashflow', 'صندوق': 'defi', 'استیک': 'stake',
    'فارم': 'farm', 'lend': 'lend', 'bridg': 'bridge',
    'امن': 'safe', 'محافظت': 'protect', 'هشدار': 'alert',
    'مانیتور': 'monitor', 'سناریو': 'scenario', 'پیش‌بینی': 'predict',
    'نهنگ': 'whale', 'پول_هوشمند': 'smart_money', 'توکن': 'research',
    'ملک': 'real_estate', 'سفر': 'travel', 'محصول': 'product',
    'شتاب': 'farm', 'نقدینگی': 'liquidity', 'تورم': 'inflation',
    'سقوط': 'market_crash', 'بحران': 'market_crash'
  };

  for (const [fa, en] of Object.entries(FA_MAP)) {
    if (text.includes(fa)) {
      keywords.push(en);
    }
  }

  // Deduplicate
  const unique = [...new Set(keywords)];
  return resolveEcosystemGraph({ intentKeywords: unique, ...context });
}

function boostModule(scores, moduleId, amount, reason) {
  const current = scores.get(moduleId) || { score: 0, reasons: [] };
  current.score = Math.min(1.0, current.score + amount);
  current.reasons.push(reason);
  scores.set(moduleId, current);
}

function reduceModule(scores, moduleId, amount, reason) {
  const current = scores.get(moduleId) || { score: 0, reasons: [] };
  current.score = Math.max(0, current.score - amount);
  scores.set(moduleId, current);
}

export default { resolveEcosystemGraph, resolveIntentToModules, ECOSYSTEM_MODULES, KNOWLEDGE_SCHEMA };
