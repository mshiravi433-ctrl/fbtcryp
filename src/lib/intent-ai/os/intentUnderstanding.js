/**
 * FBT INTENT OS — Intent Understanding
 * ---------------------------------------------------------------------------
 * Spec §4 + §5
 * Extract real user intent, not just keywords.
 * Maps natural language → structured intent types.
 */

import { aliasChainId, aliasToken, wantsPageOpen } from './moduleRouter.js';

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
  'SIGNALS',
  'P2P',
  'DYDX',
  'HORIZON',
  'FOREX',
  'RWA',
  'BTC_WALLET',
  'WALLET_CONNECT',
  'WALLET_DISCONNECT',
  'SWITCH_NETWORK',
  'ADD_TOKEN',
  'NOTIFICATIONS',
  'SETTINGS',
  'REWARDS',
  'INTENT_OS',
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
    weight: 8,
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
      /تبدیل.*کن|معاوضه|سواپ|تبدیل ارز/i,
      /swap|convert.*to|convert /i,
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
      /فارم.*را.*باز|فارم.*باز/i,
      /از فارم|خرید از فارم|استخر/i
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
  },
  {
    type: 'SIGNALS',
    weight: 7,
    patterns: [
      /سیگنال|signals?/i,
      /آینده.*توکن|آینده.*ارز|outlook|پیش.?بینی.*قیمت/i,
      /پیگیری از شبکه.?سیگنال|شبکه سیگنال/i
    ]
  },
  {
    type: 'SEND',
    weight: 7,
    patterns: [
      /بفرست|ارسال کن|ارسال.*آدرس|send (to|token)|transfer to/i,
      /به .*آدرس.*بفرست|واریز به/i
    ]
  },
  {
    type: 'BRIDGE',
    weight: 7,
    patterns: [
      /از شبکه.*به شبکه|ببر.*شبکه|منتقل.*شبکه/i,
      /بریج|بریدج|پل.*زنجیره|bridge|cross.?chain/i
    ]
  },
  {
    type: 'BORROW',
    weight: 6,
    patterns: [
      /وام بگیر|وام گرفتن|borrow/i,
      /قرض بگیر|اعتبار بگیر/i
    ]
  },
  {
    type: 'LEND',
    weight: 6,
    patterns: [
      /وام بده|سپرده.?گذار|لند کن|supply.*aave|lend /i
    ]
  },
  {
    type: 'STOCKS',
    weight: 6,
    patterns: [
      /سهام|توکن شرکتی|xstock|stocks?/i
    ]
  },
  {
    type: 'HORIZON',
    weight: 7,
    patterns: [
      /افق جهانی|horizon/i,
      /فارکس|forex|جفت.?ارز|صندوق|commodit|طلا|نفت/i,
      /rwa|real.?world|توکنی.?ز/i
    ]
  },
  {
    type: 'DYDX',
    weight: 7,
    patterns: [
      /dydx|دی.?وای.?دی.?ایکس/i
    ]
  },
  {
    type: 'FUTURES',
    weight: 6,
    patterns: [
      /پرپچوال|perpetual|فیوچرز|futures|perp/i,
      /فیوچرز سولانا|solana perp/i
    ]
  },
  {
    type: 'P2P',
    weight: 6,
    patterns: [
      /p2p|پی.?تو.?پی|همتا به همتا/i
    ]
  },
  {
    type: 'ORDERS',
    weight: 7,
    patterns: [
      /سفارش خودکار|سفارش حد|limit order|auto.?order/i,
      /خودت ایجاد کنی.*سفارش|شرط.*سفارش/i
    ]
  },
  {
    type: 'NOTIFICATIONS',
    weight: 7,
    patterns: [
      /نوتیفیکیشن|اعلان|alert|notification|خبرم کن|هشدار/i
    ]
  },
  {
    type: 'BTC_WALLET',
    weight: 7,
    patterns: [
      /والت بیت.?کوین|کیف پول بیت|btc wallet|bitcoin wallet|چک.*بیت.?کوین/i
    ]
  },
  {
    type: 'WALLET_DISCONNECT',
    weight: 7,
    patterns: [
      /بستن والت|والت را ببند|والت.*ببند|قطع.*کیف|disconnect wallet|خارج شو.*کیف/i
    ]
  },
  {
    type: 'WALLET_CONNECT',
    weight: 6,
    patterns: [
      /اتصال کیف|وصل.*کیف|connect wallet/i
    ]
  },
  {
    type: 'SWITCH_NETWORK',
    weight: 7,
    patterns: [
      /تعویض شبکه|عوض.*شبکه|switch network|change network/i
    ]
  },
  {
    type: 'ADD_TOKEN',
    weight: 7,
    patterns: [
      /اضافه کردن توکن|افزودن توکن|توکن.*اضافه|اضافه.*توکن|import token|add token/i
    ]
  },
  {
    type: 'REWARDS',
    weight: 6,
    patterns: [
      /امتیازها|امتیاز من|rewards|پاداش/i
    ]
  },
  {
    type: 'SETTINGS',
    weight: 5,
    patterns: [
      /تنظیمات|settings/i
    ]
  },
  {
    type: 'INTENT_OS',
    weight: 6,
    patterns: [
      /تب.*intent|intent os|اینتنت/i
    ]
  },
  {
    type: 'SMART_MONEY',
    weight: 7,
    patterns: [
      /کیف پول بزرگ|رفتار کیف پول|smart.?money|اسمارت مانی/i
    ]
  }
];

// Navigation intent extraction
const NAV_TARGETS = [
  { route: '/news', keywords: ['اخبار', 'news'], type: 'NEWS_SEARCH' },
  { route: '/farm', keywords: ['فارم', 'farm', 'استخر'], type: 'FARM' },
  { route: '/wallet', keywords: ['کیف پول', 'والت', 'wallet'], type: 'NAVIGATION' },
  { route: '/portfolio', keywords: ['پرتفوی', 'portfolio', 'سبد'], type: 'PORTFOLIO_ANALYSIS' },
  { route: '/market', keywords: ['بازار', 'market'], type: 'MARKET_ANALYSIS' },
  { route: '/swap', keywords: ['سواپ', 'swap'], type: 'SWAP' },
  { route: '/solana', keywords: ['سواپ سولانا', 'solana swap'], type: 'SWAP' },
  { route: '/bridge', keywords: ['بریج', 'bridge', 'پل'], type: 'BRIDGE' },
  { route: '/signals', keywords: ['سیگنال', 'signals'], type: 'SIGNALS' },
  { route: '/smart-money', keywords: ['smart money', 'هوشمند', 'اسمارت'], type: 'SMART_MONEY' },
  { route: '/loan', keywords: ['وام', 'lending', 'loan'], type: 'LEND' },
  { route: '/earn', keywords: ['earn', 'yield'], type: 'YIELD_DISCOVERY' },
  { route: '/explore', keywords: ['explore', 'کاوش'], type: 'MARKET_CONTEXT' },
  { route: '/nft', keywords: ['nft', 'ان اف تی'], type: 'NAVIGATION' },
  { route: '/shop', keywords: ['shop', 'فروشگاه', 'گیفت', 'gift'], type: 'NAVIGATION' },
  { route: '/settings', keywords: ['تنظیمات', 'settings'], type: 'SETTINGS' },
  { route: '/orders', keywords: ['سفارش خودکار', 'سفارش', 'orders'], type: 'ORDERS' },
  { route: '/perp', keywords: ['فیوچرز', 'futures', 'perp', 'پرپچوال'], type: 'FUTURES' },
  { route: '/dydx', keywords: ['dydx'], type: 'DYDX' },
  { route: '/stocks', keywords: ['سهام', 'stocks'], type: 'STOCKS' },
  { route: '/invest', keywords: ['افق جهانی', 'فارکس', 'forex', 'جفت ارز'], type: 'HORIZON' },
  { route: '/p2p', keywords: ['p2p', 'پی تو پی'], type: 'P2P' },
  { route: '/rewards', keywords: ['امتیاز', 'rewards', 'پاداش'], type: 'REWARDS' },
  { route: '/intent', keywords: ['اینتنت', 'intent os'], type: 'INTENT_OS' },
  { route: '/buy', keywords: ['خرید و فروش'], type: 'BUY' },
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
    requiresWallet: ['PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'SWAP', 'BRIDGE', 'SEND', 'BUY', 'SELL', 'REBALANCE', 'FARM', 'LEND', 'BORROW', 'DCA'].includes(top[0]),
    readOnly: [
      'PORTFOLIO_ANALYSIS', 'MARKET_ANALYSIS', 'NEWS_SEARCH', 'MARKET_CONTEXT', 'OPEN_CALM', 'PLAY_MUSIC',
      'NAVIGATION', 'WALLET_BALANCE', 'SMART_MONEY', 'WHALE', 'YIELD_DISCOVERY', 'INVESTMENT_PLAN',
      'FARM', 'LEND', 'ANALYZE_TOKEN', 'RISK_ANALYSIS', 'SIGNALS', 'STOCKS', 'HORIZON', 'FOREX', 'RWA',
      'P2P', 'DYDX', 'FUTURES', 'ORDERS', 'BTC_WALLET', 'NOTIFICATIONS', 'SETTINGS', 'REWARDS',
      'INTENT_OS', 'ADD_TOKEN', 'SWITCH_NETWORK', 'WALLET_CONNECT', 'WALLET_DISCONNECT',
      'SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'
    ].includes(top[0]),
    handoff: !['PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'YIELD_DISCOVERY', 'INVESTMENT_PLAN', 'RISK_ANALYSIS', 'GENERAL', 'CANCEL', 'CONTINUE', 'DETAILS'].includes(top[0])
  };
}

function extractEntities(text) {
  const entities = {};

  const raw = String(text || '');

  const amountMatch = raw.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(USDC|USDT|ETH|BTC|SOL|USD|\$|دلار|تتر)/i);
  if (amountMatch) {
    entities.amount = amountMatch[1].replace(/,/g, '');
    entities.amountSymbol = aliasToken(amountMatch[2]) || amountMatch[2];
  }

  const dollarMatch = raw.match(/(?:\$|usd|dollars?|دلار)\s*(\d+(?:,\d+)*(?:\.\d+)?)|(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:dollars?|دلار|usd)/i);
  if (dollarMatch && !entities.amount) {
    entities.amountUsd = (dollarMatch[1] || dollarMatch[2]).replace(/,/g, '');
  }

  const tokens = [];
  const aliasHits = ['تتر', 'اتریوم', 'اتر', 'بیت‌کوین', 'بیت کوین', 'بیتکوین', 'سولانا', 'بایننس'];
  for (const a of aliasHits) {
    if (raw.includes(a)) {
      const t = aliasToken(a);
      if (t) tokens.push(t);
    }
  }
  const tokenRegex = /\b(ETH|BTC|SOL|USDC|USDT|BNB|ARB|MATIC|AVAX|OP|DAI)\b/gi;
  for (const m of raw.matchAll(tokenRegex)) tokens.push(m[1].toUpperCase());
  const uniq = [...new Set(tokens)];
  if (uniq.length) {
    entities.tokens = uniq;
    if (uniq.length >= 2) {
      entities.fromToken = uniq[0];
      entities.toToken = uniq[1];
    } else {
      entities.token = uniq[0];
    }
  }

  const toPrep = /(?:به|به سمت|تبدیل به)\s*([A-Za-z]{2,10}|تتر|اتریوم|سولانا|بیت.?کوین)/i.exec(raw);
  if (toPrep) {
    const dest = aliasToken(toPrep[1]) || String(toPrep[1]).toUpperCase();
    if (dest) {
      entities.toToken = dest;
      if (entities.token && entities.token !== dest) entities.fromToken = entities.fromToken || entities.token;
    }
  }

  const chainWords = ['ethereum', 'arbitrum', 'آربیتروم', 'base', 'بیس', 'optimism', 'آپتیمیزم', 'bsc', 'bnb', 'بایننس', 'polygon', 'پالیگان', 'avalanche', 'solana', 'سولانا', 'اتریوم'];
  const foundChains = [];
  for (const w of chainWords) {
    const lower = raw.toLowerCase();
    const j = raw.indexOf(w) >= 0 ? raw.indexOf(w) : lower.indexOf(w.toLowerCase());
    if (j >= 0) foundChains.push({ w, j, id: aliasChainId(w) });
  }
  foundChains.sort((a, b) => a.j - b.j);
  const chains = foundChains.map((c) => c.w.toLowerCase());
  const chainIds = foundChains.map((c) => c.id).filter(Boolean);
  if (chains.length) entities.chains = [...new Set(chains)];
  if (chainIds.length) {
    const uniqueIds = [...new Set(chainIds)];
    entities.chainIds = uniqueIds;
    entities.network = uniqueIds[0];
    if (uniqueIds.length > 1) {
      entities.fromChain = uniqueIds[0];
      entities.toChain = uniqueIds[1];
      entities.destinationNetwork = uniqueIds[1];
    }
  }

  const evmAddr = raw.match(/0x[a-fA-F0-9]{40}/);
  if (evmAddr) entities.toAddress = evmAddr[0];

  // Timeframes
  const timeMatch = text.match(/(\d+)\s*(سال|ماه|روز|year|month|day)/i);
  if (timeMatch) {
    entities.timeframe = { value: timeMatch[1], unit: timeMatch[2] };
  }

  // Risk
  if (/ریسک.*کم|low.*risk|محافظه/i.test(raw)) entities.riskTolerance = 'low';
  else if (/ریسک.*متوسط|medium.*risk/i.test(raw)) entities.riskTolerance = 'medium';
  else if (/ریسک.*زیاد|high.*risk|تهاجمی/i.test(raw)) entities.riskTolerance = 'high';

  if (/solana|سولانا/i.test(raw)) entities.venue = 'solana';
  else if (/evm|اتریوم|آربیتروم|بیس/i.test(raw)) entities.venue = 'evm';

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
