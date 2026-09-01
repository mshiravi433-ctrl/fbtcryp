/**
 * FBT INTENT OS — Dynamic Suggestions
 * ---------------------------------------------------------------------------
 * Spec §17: Remove static Swap/Bridge/Send/Goal/Analysis for all users
 * Suggestions must be contextual
 */

export const SUGGESTION_SCHEMA = 'fbt.suggestion.v1';

const SUGGESTION_TEMPLATES = Object.freeze({
  YIELD: [
    { id: 'yield_discover', label: 'Yieldهای مناسب', prompt: 'بهترین Yield را پیدا کن' },
    { id: 'dca', label: 'DCA', prompt: 'یک برنامه DCA بساز' },
    { id: 'rebalance', label: 'Portfolio Rebalance', prompt: 'پرتفوی من را متعادل کن' },
    { id: 'risk_return', label: 'Risk/Return Comparison', prompt: 'مقایسه ریسک و بازده را نشان بده' }
  ],
  BUY_ETH: [
    { id: 'buy_eth', label: 'Buy ETH', prompt: 'ETH بخر' },
    { id: 'swap_eth', label: 'Swap', prompt: 'ETH را Swap کن' },
    { id: 'cross_eth', label: 'Cross-chain', prompt: 'ETH را Cross-chain کن' },
    { id: 'dca_eth', label: 'DCA ETH', prompt: 'برای ETH برنامه DCA بساز' },
    { id: 'eth_analysis', label: 'ETH Analysis', prompt: 'تحلیل ETH را نشان بده' }
  ],
  MARKET: [
    { id: 'market_overview', label: 'Market Overview', prompt: 'بازار را بررسی کن' },
    { id: 'smart_money', label: 'Smart Money', prompt: 'Smart Money را بررسی کن' },
    { id: 'whale', label: 'Whale Activity', prompt: 'ببین نهنگ‌ها چه می‌خرند' },
    { id: 'signals', label: 'Signals', prompt: 'سیگنال‌های امروز را نشان بده' },
    { id: 'top_movers', label: 'Top Movers', prompt: 'بیشترین رشد امروز' }
  ],
  PORTFOLIO: [
    { id: 'analyze_portfolio', label: 'تحلیل پرتفوی', prompt: 'پرتفوی من را تحلیل کن' },
    { id: 'rebalance', label: 'متعادل‌سازی', prompt: 'پرتفوی من را متعادل کن' },
    { id: 'risk', label: 'بررسی ریسک', prompt: 'ریسک پرتفوی من چقدر است؟' },
    { id: 'yield', label: 'فرصت‌های سود', prompt: 'بهترین فرصت سود را پیدا کن' }
  ],
  WALLET: [
    { id: 'balance', label: 'موجودی', prompt: 'موجودی من را بررسی کن' },
    { id: 'portfolio', label: 'پرتفوی', prompt: 'پرتفوی من را تحلیل کن' },
    { id: 'history', label: 'تاریخچه', prompt: 'تاریخچه تراکنش‌ها' },
    { id: 'send', label: 'ارسال', prompt: 'ارسال دارایی' }
  ],
  SWAP: [
    { id: 'quote', label: 'گرفتن قیمت', prompt: 'قیمت را بگیر' },
    { id: 'best_route', label: 'بهترین مسیر', prompt: 'بهترین مسیر Swap را پیدا کن' },
    { id: 'slippage', label: 'تنظیم Slippage', prompt: 'Slippage را تنظیم کن' }
  ],
  GENERAL: [
    { id: 'market', label: 'بازار', prompt: 'بازار را بررسی کن' },
    { id: 'portfolio', label: 'پرتفوی', prompt: 'پرتفوی من را تحلیل کن' },
    { id: 'yield', label: 'سود', prompt: 'بهترین Yield را پیدا کن' },
    { id: 'news', label: 'اخبار', prompt: 'اخبار امروز کریپتو' }
  ]
});

export function getSuggestionsForIntent(intentType, context = {}, entities = {}) {
  const type = String(intentType || 'GENERAL').toUpperCase();
  
  if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) {
    return SUGGESTION_TEMPLATES.YIELD.slice(0, 4);
  }
  if (['BUY', 'SELL', 'SWAP'].includes(type)) {
    const token = entities.token || entities.toToken || entities.fromToken;
    if (token && String(token).toUpperCase() === 'ETH') {
      return SUGGESTION_TEMPLATES.BUY_ETH.slice(0, 4);
    }
    return [
      { id: 'swap', label: 'Swap', prompt: `${token || ''} Swap` },
      { id: 'bridge', label: 'Bridge', prompt: `${token || ''} Bridge` },
      { id: 'dca', label: `DCA ${token || ''}`, prompt: `برای ${token || ''} DCA بساز` },
      { id: 'analysis', label: `${token || ''} Analysis`, prompt: `تحلیل ${token || ''}` }
    ];
  }
  if (['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'SMART_MONEY', 'WHALE'].includes(type)) {
    return SUGGESTION_TEMPLATES.MARKET.slice(0, 4);
  }
  if (['PORTFOLIO_ANALYSIS', 'REBALANCE', 'RISK_ANALYSIS'].includes(type)) {
    return SUGGESTION_TEMPLATES.PORTFOLIO.slice(0, 4);
  }
  if (['WALLET_BALANCE'].includes(type)) {
    return SUGGESTION_TEMPLATES.WALLET.slice(0, 4);
  }
  if (type === 'INVESTMENT_PLAN') {
    return [
      { id: 'yield', label: 'Yieldهای مناسب', prompt: 'بهترین Yield را پیدا کن' },
      { id: 'dca', label: 'DCA', prompt: 'برنامه DCA بساز' },
      { id: 'rebalance', label: 'Portfolio Rebalance', prompt: 'پرتفوی را متعادل کن' },
      { id: 'risk', label: 'Risk/Return', prompt: 'مقایسه ریسک و بازده' }
    ];
  }
  
  // Contextual based on current page
  const currentPage = context.currentPage || '/';
  if (currentPage.includes('/market')) return SUGGESTION_TEMPLATES.MARKET.slice(0, 4);
  if (currentPage.includes('/portfolio')) return SUGGESTION_TEMPLATES.PORTFOLIO.slice(0, 4);
  if (currentPage.includes('/wallet')) return SUGGESTION_TEMPLATES.WALLET.slice(0, 4);
  if (currentPage.includes('/swap')) return SUGGESTION_TEMPLATES.SWAP.slice(0, 4);
  
  return SUGGESTION_TEMPLATES.GENERAL.slice(0, 4);
}

export function getSuggestionsForMessage(message, context = {}) {
  const text = String(message || '').toLowerCase();
  
  if (text.includes('سود') || text.includes('yield') || text.includes('بیشتر')) {
    return SUGGESTION_TEMPLATES.YIELD.slice(0, 4);
  }
  if (text.includes('eth')) {
    return SUGGESTION_TEMPLATES.BUY_ETH.slice(0, 4);
  }
  if (text.includes('بازار') || text.includes('market')) {
    return SUGGESTION_TEMPLATES.MARKET.slice(0, 4);
  }
  if (text.includes('پرتفوی') || text.includes('portfolio')) {
    return SUGGESTION_TEMPLATES.PORTFOLIO.slice(0, 4);
  }
  
  return getSuggestionsForIntent(context.lastIntentType || 'GENERAL', context);
}
