/**
 * FBT INTENT OS — Intent Understanding
 * ---------------------------------------------------------------------------
 * Spec §4 + §5
 * Extract real user intent, not just keywords.
 * Maps natural language → structured intent types.
 */

export const INTENT_TYPES = Object.freeze([
  'PORTFOLIO_ANALYSIS',
  'MARKET_ANALYSIS',
  'RISK_ANALYSIS',
  'YIELD_DISCOVERY',
  'NEWS_SEARCH',
  'MARKET_CONTEXT',
  'OPEN_CALM',
  'PLAY_MUSIC',
  'NAVIGATION',
  'WALLET_BALANCE',
  'SWAP',
  'BRIDGE',
  'SEND',
  'BUY',
  'SELL',
  'INVESTMENT_PLAN',
  'DCA',
  'GOAL',
  'FARM',
  'LEND',
  'BORROW',
  'STAKING',
  'FUTURES',
  'STOCKS',
  'SMART_MONEY',
  'WHALE',
  'ORDERS',
  'REBALANCE',
  'ANALYZE_TOKEN',
  'EXECUTE_CURRENT',
  'CANCEL',
  'CONTINUE',
  'DETAILS',
  'GENERAL'
]);

// Persian + English patterns
const INTENT_PATTERNS = [
  {
    type: 'PORTFOLIO_ANALYSIS',
    weight: 5,
    patterns: [
      /پرتفوی.*افت|افت.*پرتفوی/i,
      /پرتفوی.*تحلیل|تحلیل.*پرتفوی/i,
      /پرتفوی.*بررسی|بررسی.*پرتفوی/i,
      /سبد.*تحلیل|تحلیل.*سبد/i,
      /portfolio.*analysis|analyze.*portfolio/i,
      /why.*portfolio.*down|portfolio.*down/i,
      /عملکرد.*پرتفوی|وضعیت.*پرتفوی/i,
      /پرتفوی\s*من|پرتفویم|my portfolio|پرتفوی\s*\?/i
    ]
  },
  {
    type: 'WALLET_BALANCE',
    weight: 5,
    patterns: [
      /موجودی.*بررسی|بررسی.*موجودی/i,
      /موجودی.*من|موجودیم/i,
      /چقدر.*دارم|دارایی.*من/i,
      /موجودی.*چقدر|چقدر.*موجودی/i,
      /balance|how much.*have|my balance/i,
      /کیف پول.*موجودی|موجودی.*کیف/i
    ]
  },
  {
    type: 'YIELD_DISCOVERY',
    weight: 5,
    patterns: [
      /سود.*بیشتر|بیشتر.*سود/i,
      /جایی.*بگذار.*سود|سود.*بگذار/i,
      /بهترین.*سود|سود.*بهترین/i,
      /فرصت\s*سود|فرصت‌های\s*سود|فرصت های سود|profit opportunit/i,
      /yield|best.*apy|highest.*yield/i,
      /سرمایه.*سود|پول.*سود|کجا.*سود/i
    ]
  },
  {
    type: 'NEWS_SEARCH',
    weight: 5,
    patterns: [
      /اخبار.*امروز|اخبار.*کریپتو/i,
      /خبر.*امروز|اخبار.*بازار/i,
      /news.*today|crypto.*news/i,
      /اخبار.*باز کن|صفحه.*اخبار/i
    ]
  },
  {
    type: 'OPEN_CALM',
    weight: 5,
    patterns: [
      /آرامش.*باز|باز.*آرامش/i,
      /آهنگ.*آرام|موسیقی.*آرام/i,
      /calm.*open|open.*calm/i,
      /relax.*music|music.*relax/i,
      /یه.*آهنگ.*آرام|آهنگ.*بذار/i
    ]
  },
  {
    type: 'PLAY_MUSIC',
    weight: 5,
    patterns: [
      /آهنگ.*پخش|پخش.*آهنگ/i,
      /موسیقی.*پخش|پخش.*موسیقی/i,
      /play.*music|music.*play/i,
      /آهنگ.*آرامش/i
    ]
  },
  {
    type: 'NAVIGATION',
    weight: 4,
    patterns: [
      /باز کن|صفحه.*باز|برو.*صفحه/i,
      /open.*page|go.*to|navigate/i,
      /کیف پولم.*باز|صفحه.*فارم|صفحه.*اخبار/i
    ]
  },
  {
    type: 'INVESTMENT_PLAN',
    weight: 5,
    patterns: [
      /سرمایه‌گذاری|سرمایه گذاری/i,
      /بهترین.*سرمایه|سرمایه.*بهترین/i,
      /1000.*دلار.*سرمایه|سرمایه.*1000/i,
      /investment.*plan|best.*invest/i,
      /برای.*ETH.*سرمایه/i
    ]
  },
  {
    type: 'REBALANCE',
    weight: 5,
    patterns: [
      /متعادل.*کن|پرتفوی.*متعادل/i,
      /rebalance|re-balance/i,
      /سبد.*متوازن|متوازن.*کن/i
    ]
  },
  {
    type: 'SWAP',
    weight: 4,
    patterns: [
      /تبدیل.*کن|معاوضه|سواپ/i,
      /swap|convert.*to/i,
      /USDC.*ETH|ETH.*USDC/i
    ]
  },
  {
    type: 'BUY',
    weight: 4,
    patterns: [
      /بخر|خرید.*کن|می‌خواهم.*ETH|ETH.*می‌خواهم/i,
      /buy.*ETH|get.*ETH|want.*ETH/i
    ]
  },
  {
    type: 'BRIDGE',
    weight: 4,
    patterns: [
      /بریج|بریدج|پل.*زنجیره/i,
      /bridge|cross.*chain/i
    ]
  },
  {
    type: 'SMART_MONEY',
    weight: 4,
    patterns: [
      /smart.*money|هوشمند.*پول/i,
      /smart.*money.*بررسی/i
    ]
  },
  {
    type: 'FARM',
    weight: 6,
    patterns: [
      /صفحه.*فارم|فارم.*باز کن|صفحه.*فارم.*باز/i,
      /farm.*page|open.*farm/i,
      /فارم.*را.*باز|فارم.*باز/i
    ]
  },
  {
    type: 'WHALE',
    weight: 5,
    patterns: [
      /نهنگ.*خرید|نهنگ‌ها.*خرید|whale.*buy/i,
      /whale.*tracking|نهنگ.*چی/i,
      /نهنگ‌ها.*چه.*می‌خرند|نهنگ.*می‌خرند|ببین.*نهنگ/i,
      /whale.*buying|what.*whale.*buy/i,
      /نهنگ/i
    ]
  },
  {
    type: 'GOAL',
    weight: 4,
    patterns: [
      /هدف.*سه.*ساله|هدف.*مالی|برنامه.*هدف/i,
      /financial.*goal|goal.*plan/i,
      /سه.*ساله.*برنامه/i
    ]
  },
  {
    type: 'CONTINUE',
    weight: 7,
    patterns: [
      /همان.*کاری.*گفتیم|همان.*کار.*که.*گفتیم|همان.*کاری.*که.*گفتیم/i,
      /همان.*کاری.*که.*گفتیم.*ادامه|ادامه.*بده.*همان|همان.*را.*ادامه/i,
      /continue.*previous|resume.*previous/i,
      /ادامه.*بده/i
    ]
  },
  {
    type: 'EXECUTE_CURRENT',
    weight: 5,
    patterns: [
      /این.*را.*اجرا|اجراش.*کن|همین.*را.*انجام/i,
      /execute.*this|run.*this|do.*it/i,
      /همین.*کار.*اجرا/i
    ]
  },
  {
    type: 'CANCEL',
    weight: 5,
    patterns: [
      /لغوش.*کن|کنسل|لغو/i,
      /cancel|abort/i
    ]
  },
  {
    type: 'DETAILS',
    weight: 4,
    patterns: [
      /جزئیات.*بیشتر|بیشتر.*بررسی|دقیق.*بررسی/i,
      /more.*details|details.*more/i
    ]
  }
];

// Navigation intent extraction
const NAV_TARGETS = [
  { route: '/news', keywords: ['اخبار', 'news'], type: 'NEWS_SEARCH' },
  { route: '/farm', keywords: ['فارم', 'farm'], type: 'FARM' },
  { route: '/wallet', keywords: ['کیف پول', 'wallet'], type: 'NAVIGATION' },
  { route: '/portfolio', keywords: ['پرتفوی', 'portfolio', 'سبد'], type: 'PORTFOLIO_ANALYSIS' },
  { route: '/market', keywords: ['بازار', 'market'], type: 'MARKET_ANALYSIS' },
  { route: '/swap', keywords: ['سواپ', 'swap'], type: 'SWAP' },
  { route: '/bridge', keywords: ['بریج', 'bridge'], type: 'BRIDGE' },
  { route: '/signals', keywords: ['سیگنال', 'signals'], type: 'MARKET_ANALYSIS' },
  { route: '/smart-money', keywords: ['smart money', 'هوشمند'], type: 'SMART_MONEY' },
  { route: '/loan', keywords: ['وام', 'lending', 'loan'], type: 'LEND' },
  { route: '/earn', keywords: ['earn', 'سود', 'yield'], type: 'YIELD_DISCOVERY' },
  { route: '/explore', keywords: ['explore', 'کاوش'], type: 'MARKET_CONTEXT' },
  { route: '/nft', keywords: ['nft', 'ان اف تی'], type: 'NAVIGATION' },
  { route: '/shop', keywords: ['shop', 'فروشگاه', 'گیفت', 'gift'], type: 'NAVIGATION' },
  { route: '/settings', keywords: ['تنظیمات', 'settings'], type: 'NAVIGATION' },
  { route: '/orders', keywords: ['سفارش', 'orders'], type: 'ORDERS' },
  { route: '/perp', keywords: ['فیوچرز', 'futures', 'perp'], type: 'FUTURES' },
  { route: '/stocks', keywords: ['سهام', 'stocks'], type: 'STOCKS' },
  { route: '/calm', keywords: ['آرامش', 'calm', 'relax'], type: 'OPEN_CALM' }
];

export function extractNavigationIntent(text) {
  const lower = String(text || '').toLowerCase();
  for (const target of NAV_TARGETS) {
    for (const kw of target.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        // Check if it's a navigation request
        if (/(باز کن|برو|open|go to|navigate|صفحه)/i.test(text)) {
          return { route: target.route, type: target.type, keyword: kw };
        }
      }
    }
  }
  return null;
}

export function understandIntent(message, context = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return {
      ok: false,
      type: 'GENERAL',
      confidence: 0,
      reason: 'EMPTY',
      entities: {},
      shouldAsk: true
    };
  }

  const scores = new Map();
  const matched = [];

  for (const rule of INTENT_PATTERNS) {
    let hits = 0;
    let matchedPattern = null;
    for (const pat of rule.patterns) {
      if (pat.test(text)) {
        hits += 1;
        matchedPattern = pat;
      }
    }
    if (hits > 0) {
      const score = hits * rule.weight;
      scores.set(rule.type, (scores.get(rule.type) || 0) + score);
      matched.push({ type: rule.type, score, pattern: matchedPattern });
    }
  }

  // Check navigation separately
  const nav = extractNavigationIntent(text);
  if (nav) {
    const existing = scores.get(nav.type) || 0;
    scores.set(nav.type, existing + 6);
    matched.push({ type: nav.type, score: 6, nav });
  }

  // Sort by score
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];

  // Entity extraction
  const entities = extractEntities(text);

  // If no clear intent, try to infer from context
  if (!top || top[1] < 3) {
    // Contextual follow-up: "this" "it" refers to current page/action
    if (/(این|همین|this|it).*اجرا|اجرا.*کن/i.test(text) && context.currentPage) {
      return {
        ok: true,
        type: 'EXECUTE_CURRENT',
        confidence: 0.85,
        entities,
        raw: text,
        contextRef: context.currentPage,
        matched: [],
        isFollowUp: true
      };
    }

    const slots = context.operational || {};
    if (/(بخرش|بفروشش|بخر|فروش|تبدیل|انجام بده)/i.test(text) && (slots.asset || entities.token)) {
      const op = /فروش|sell/i.test(text) ? 'SELL' : (/تبدیل|swap/i.test(text) ? 'SWAP' : 'BUY');
      return {
        ok: true,
        type: op,
        confidence: 0.8,
        entities: {
          ...entities,
          token: entities.token || slots.asset,
          amount: entities.amount || entities.amountUsd || slots.amount
        },
        raw: text,
        isFollowUp: true,
        matched
      };
    }

    return {
      ok: true,
      type: 'GENERAL',
      confidence: 0.3,
      entities,
      raw: text,
      matched,
      shouldAsk: false
    };
  }

  const confidence = Math.min(0.98, top[1] / (top[1] + (sorted[1]?.[1] || 0) + 1) + 0.3);

  return {
    ok: true,
    type: top[0],
    confidence: Math.round(confidence * 100) / 100,
    entities,
    raw: text,
    matched,
    navigation: nav,
    isFollowUp: /(این|همین|this|it)/i.test(text),
    requiresWallet: ['PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'SWAP', 'BRIDGE', 'SEND', 'BUY', 'SELL', 'REBALANCE', 'FARM', 'LEND', 'DCA'].includes(top[0]),
    readOnly: ['PORTFOLIO_ANALYSIS', 'MARKET_ANALYSIS', 'NEWS_SEARCH', 'MARKET_CONTEXT', 'OPEN_CALM', 'PLAY_MUSIC', 'NAVIGATION', 'WALLET_BALANCE', 'SMART_MONEY', 'WHALE', 'YIELD_DISCOVERY', 'INVESTMENT_PLAN', 'FARM', 'LEND', 'ANALYZE_TOKEN', 'RISK_ANALYSIS'].includes(top[0])
  };
}

function extractEntities(text) {
  const entities = {};

  // Amounts: 100 USDC, $100, ۱۰۰ دلار
  const amountMatch = text.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(USDC|USDT|ETH|BTC|SOL|USD|\$|دلار)/i);
  if (amountMatch) {
    entities.amount = amountMatch[1].replace(/,/g, '');
    entities.amountSymbol = amountMatch[2];
  }

  // Dollar amounts
  const dollarMatch = text.match(/\$?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:dollars?|دلار|usd)?/i);
  if (dollarMatch && !entities.amount) {
    entities.amountUsd = dollarMatch[1].replace(/,/g, '');
  }

  // Tokens
  const tokenRegex = /\b(ETH|BTC|SOL|USDC|USDT|BNB|ARB|MATIC|AVAX|OP|DAI)\b/gi;
  const tokens = [...text.matchAll(tokenRegex)].map(m => m[1].toUpperCase());
  if (tokens.length) {
    entities.tokens = [...new Set(tokens)];
    if (tokens.length >= 2) {
      entities.fromToken = tokens[0];
      entities.toToken = tokens[1];
    } else {
      entities.token = tokens[0];
    }
  }

  // Chain names
  const chainRegex = /\b(ethereum|arbitrum|base|optimism|bsc|bnb|polygon|avalanche|solana)\b/gi;
  const chains = [...text.matchAll(chainRegex)].map(m => m[1].toLowerCase());
  if (chains.length) entities.chains = chains;

  // Timeframes
  const timeMatch = text.match(/(\d+)\s*(سال|ماه|روز|year|month|day)/i);
  if (timeMatch) {
    entities.timeframe = { value: timeMatch[1], unit: timeMatch[2] };
  }

  // Risk
  if (/ریسک.*کم|low.*risk|محافظه/i.test(text)) entities.riskTolerance = 'low';
  else if (/ریسک.*متوسط|medium.*risk/i.test(text)) entities.riskTolerance = 'medium';
  else if (/ریسک.*زیاد|high.*risk|تهاجمی/i.test(text)) entities.riskTolerance = 'high';

  return entities;
}

// Acceptance tests (Spec §40)
export const ACCEPTANCE_TESTS = Object.freeze([
  { input: 'اخبار را باز کن', expected: 'NEWS_SEARCH' },
  { input: 'صفحه فارم را باز کن', expected: 'FARM' },
  { input: 'کیف پولم را باز کن', expected: 'NAVIGATION' },
  { input: 'یک آهنگ آرامش‌بخش پخش کن', expected: 'PLAY_MUSIC' },
  { input: 'موجودی من را بررسی کن', expected: 'WALLET_BALANCE' },
  { input: 'پرتفوی من را تحلیل کن', expected: 'PORTFOLIO_ANALYSIS' },
  { input: 'بهترین فرصت سرمایه‌گذاری را پیدا کن', expected: 'INVESTMENT_PLAN' },
  { input: '100 USDC را به ETH تبدیل کن', expected: 'SWAP' },
  { input: 'پرتفوی من را متعادل کن', expected: 'REBALANCE' },
  { input: 'بهترین Yield را پیدا کن', expected: 'YIELD_DISCOVERY' },
  { input: 'Smart Money را بررسی کن', expected: 'SMART_MONEY' },
  { input: 'ببین نهنگ‌ها چه می‌خرند', expected: 'WHALE' },
  { input: 'برای هدف سه ساله‌ام برنامه بساز', expected: 'GOAL' },
  { input: 'همان کاری که گفتیم را ادامه بده', expected: 'CONTINUE' },
  { input: 'این را اجرا کن', expected: 'EXECUTE_CURRENT' },
  { input: 'لغوش کن', expected: 'CANCEL' },
  { input: 'جزئیاتش را بیشتر بررسی کن', expected: 'DETAILS' }
]);

export function runAcceptanceTests() {
  const results = [];
  for (const test of ACCEPTANCE_TESTS) {
    const result = understandIntent(test.input);
    results.push({
      input: test.input,
      expected: test.expected,
      got: result.type,
      pass: result.type === test.expected,
      confidence: result.confidence
    });
  }
  return results;
}
