/**
 * FBT INTENT OS — Intent Understanding
 * ---------------------------------------------------------------------------
 * Spec §4 + §5
 * Extract real user intent, not just keywords.
 * Maps natural language → structured intent types.
 */

import { aliasChainId, aliasToken, wantsPageOpen } from './moduleRouter.js';
import {
  normalizeUpgrade4,
  extractEntitiesUpgrade4,
  classifyQuestionType,
  detectConflict,
  detectUserCorrection,
  calculateClarificationPriority,
  calculateConfidenceBreakdown,
  predictNextActions,
  QUESTION_TYPES
} from './intentUnderstandingEngine.js';

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
  'OPS_CENTER',
  'AGENTS',
  'STRATEGY',
  'SYSTEM_STATUS',
  'SECURITY',
  'NFT',
  'SHOP',
  'EXPLORE',
  'LEARN',
  'DOCS',
  'LEADERBOARD',
  'VAULT',
  'CAPABILITIES',
  'EXECUTE_CURRENT',
  'CANCEL',
  'CONTINUE',
  'DETAILS',
  'GENERAL'
]);

/* -------------------------------------------------------------------------- */
/*  NORMALISATION                                                              */
/* -------------------------------------------------------------------------- */
/**
 * Real Persian input is not typed the way the regexes above were written:
 * Arabic ي/ك arrive from iOS keyboards, ZWNJ (\u200c) splits «پرتفوی‌ام» in a
 * place no `.*` can see, and Persian/Arabic digits never match `\d`.
 *
 * The legacy INTENT_PATTERNS keep running against the RAW text — they encode
 * ZWNJ-joined words like «نهنگ‌ها» on purpose and normalising underneath them
 * would silently change what they match. The keyword layer below runs against
 * the normalised form instead, which is where the tolerance is needed.
 */
const AR_TO_FA = { 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و' };
const DIGIT_MAP = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/[يكةۀأإآؤ]/g, (c) => AR_TO_FA[c] || c)
    .replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] || d)
    .replace(/[\u200c\u200f\u200e\u064b-\u0652]/g, ' ')
    .replace(/[?!.,;:؛،؟)("'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/*  KEYWORD LAYER                                                              */
/* -------------------------------------------------------------------------- */
/**
 * WHY THIS EXISTS — the bug this file was rewritten to fix.
 *
 * INTENT_PATTERNS is a co-occurrence grammar: nearly every rule needs TWO
 * words in one sentence («پرتفوی» AND «تحلیل»). Users do not type sentences
 * into an assistant, they type nouns: «پرتفوی», «سود», «تحلیل», «استراتژی»,
 * «مرکز عملیات». Every one of those scored zero, fell through the
 * `top[1] < 3` guard and came back as GENERAL@0.3 — the generic "I couldn't
 * map that to a module" reply the user reported.
 *
 * A bare noun is a WEAKER signal than a full phrase, not an absent one. It
 * scores 3 (just clears the floor) so any real INTENT_PATTERNS match still
 * outranks it, and two keywords for the same intent still lose to one
 * explicit phrase. Nothing here can promote a keyword above an executable
 * grammar match.
 */
const KEYWORD_WEIGHT = 3;

const KEYWORD_LEXICON = Object.freeze([
  { type: 'PORTFOLIO_ANALYSIS', words: ['پرتفوی', 'پرتفولیو', 'پورتفولیو', 'پرتفو', 'سبد دارایی', 'سبد من', 'داراییهای من', 'تخصیص', 'توزیع دارایی', 'portfolio', 'holdings', 'allocation', 'asset allocation'] },
  { type: 'WALLET_BALANCE', words: ['کیف پول', 'کیفپول', 'والت', 'موجودی', 'موجودیم', 'دارایی', 'داراییها', 'wallet', 'balance', 'balances'] },
  { type: 'YIELD_DISCOVERY', words: ['سود', 'سودآوری', 'سود اوری', 'بازدهی', 'بازده', 'درامد', 'درآمد', 'ییلد', 'apy', 'apr', 'yield', 'earn', 'staking', 'استیک', 'سپرده'] },
  { type: 'MARKET_ANALYSIS', words: ['تحلیل', 'انالیز', 'آنالیز', 'بررسی', 'بازار', 'مارکت', 'قیمت', 'نرخ', 'روند', 'analysis', 'analyse', 'analyze', 'market', 'price', 'trend'] },
  { type: 'RISK_ANALYSIS', words: ['ریسک', 'خطر', 'risk', 'exposure', 'drawdown'] },
  { type: 'NEWS_SEARCH', words: ['اخبار', 'خبر', 'خبرها', 'news', 'headline', 'headlines'] },
  { type: 'SIGNALS', words: ['سیگنال', 'سیگنالها', 'signal', 'signals', 'outlook'] },
  { type: 'SWAP', words: ['سواپ', 'تبدیل', 'معاوضه', 'swap', 'convert', 'exchange'] },
  { type: 'BRIDGE', words: ['بریج', 'بریدج', 'پل', 'bridge', 'کراس‌چین', 'کراس چین', 'کراسچین', 'بین‌زنجیره‌ای', 'cross-chain', 'cross chain', 'crosschain'] },
  { type: 'FARM', words: ['فارم', 'استخر', 'ال پی', 'farm', 'farming', 'pool', 'liquidity'] },
  { type: 'LEND', words: ['وام دادن', 'لند', 'lend', 'lending', 'supply', 'aave'] },
  { type: 'BORROW', words: ['وام', 'قرض', 'borrow', 'loan'] },
  { type: 'ORDERS', words: ['سفارش', 'سفارشها', 'سفارشات', 'order', 'orders', 'limit'] },
  /* Transaction history is a wallet read — the wallet page owns the ledger. */
  { type: 'WALLET_BALANCE', words: ['تاریخچه', 'تراکنش', 'تراکنشها', 'تاریخچه تراکنشها', 'history', 'transactions', 'transaction history'] },
  /* A bare "quote" with no pair still belongs on the swap surface. */
  { type: 'SWAP', words: ['نقل قول', 'قیمت بگیر', 'quote', 'get a quote'] },
  { type: 'SMART_MONEY', words: ['اسمارت مانی', 'پول هوشمند', 'smart money', 'smartmoney'] },
  { type: 'WHALE', words: ['نهنگ', 'نهنگها', 'whale', 'whales'] },
  { type: 'REWARDS', words: ['امتیاز', 'پاداش', 'جایزه', 'rewards', 'points', 'airdrop'] },
  { type: 'SETTINGS', words: ['تنظیمات', 'settings', 'preferences'] },
  { type: 'NOTIFICATIONS', words: ['اعلان', 'اعلانها', 'نوتیف', 'هشدار', 'alert', 'alerts', 'notification', 'notifications'] },
  /* Monitors are the Ops Center's own surface, not a settings screen. */
  { type: 'OPS_CENTER', words: ['پایش', 'پایشها', 'مانیتور', 'مانیتورها', 'monitor', 'monitors', 'monitoring'] },
  { type: 'STOCKS', words: ['سهام', 'سهم', 'بورس', 'stock', 'stocks', 'xstock', 'equities'] },
  /* Tokenized real-world assets — the Stocks/RWA surface owns these. */
  { type: 'RWA', words: ['توکن شده', 'توکنیزه', 'دارایی واقعی', 'rwa', 'tokenized', 'tokenized assets', 'real world asset'] },
  { type: 'P2P', words: ['p2p', 'پی تو پی', 'همتا به همتا'] },
  { type: 'FUTURES', words: ['فیوچرز', 'پرپچوال', 'اهرم', 'futures', 'perp', 'perps', 'perpetual', 'leverage'] },
  { type: 'DYDX', words: ['dydx', 'دیوایدیایکس'] },
  { type: 'HORIZON', words: ['افق جهانی', 'فارکس', 'forex', 'طلا', 'نفت', 'کالا', 'commodity', 'commodities'] },
  { type: 'BUY', words: ['خرید', 'بخرم', 'buy', 'purchase'] },
  { type: 'SELL', words: ['فروش', 'بفروشم', 'sell'] },
  { type: 'SEND', words: ['ارسال', 'انتقال', 'واریز', 'send', 'transfer'] },
  { type: 'REBALANCE', words: ['متعادل', 'متوازن', 'ریبالانس', 'rebalance', 'rebalancing'] },
  { type: 'GOAL', words: ['هدف', 'هدف مالی', 'goal', 'goals', 'target'] },
  { type: 'DCA', words: ['دی سی ای', 'خرید پلکانی', 'خرید دورهای', 'dca', 'recurring'] },
  { type: 'CONTINUE', words: ['ادامه', 'ادامهاش', 'continue', 'resume', 'go on'] },
  { type: 'DETAILS', words: ['جزئیات', 'جزییات', 'بیشتر', 'details', 'more'] },

  /* ── app surfaces the assistant must be able to reach ─────────────────── */
  { type: 'OPS_CENTER', words: ['مرکز عملیات', 'مرکز عملیاتی', 'اپراسیون', 'ops center', 'operations center', 'operations', 'ops'] },
  { type: 'AGENTS', words: ['ایجنت', 'ایجنتها', 'ایجنت ها', 'عامل هوشمند', 'agent', 'agents'] },
  { type: 'STRATEGY', words: ['استراتژی', 'استراتژیها', 'استراتژی ها', 'strategy', 'strategies', 'playbook'] },
  { type: 'SYSTEM_STATUS', words: ['وضعیت سیستم', 'وضعیت سرویس', 'سلامت سیستم', 'system status', 'status', 'health', 'uptime'] },
  { type: 'SECURITY', words: ['امنیت', 'ادیت', 'حسابرسی', 'security', 'audit'] },
  { type: 'NFT', words: ['nft', 'ان اف تی', 'nfts'] },
  { type: 'SHOP', words: ['فروشگاه', 'گیفت کارت', 'گیفت', 'shop', 'store', 'gift card'] },
  { type: 'EXPLORE', words: ['کاوش', 'اکسپلور', 'کشف', 'explore', 'discover'] },
  { type: 'LEARN', words: ['اموزش', 'آموزش', 'یادگیری', 'learn', 'academy', 'tutorial'] },
  { type: 'DOCS', words: ['مستندات', 'داکیومنت', 'docs', 'documentation', 'api'] },
  { type: 'LEADERBOARD', words: ['لیدربورد', 'جدول رتبه', 'رتبهبندی', 'leaderboard', 'ranking'] },
  { type: 'VAULT', words: ['ولت هوشمند', 'خزانه', 'vault'] },
  { type: 'INTENT_OS', words: ['intent os', 'intentos', 'اینتنت', 'اینتنت او اس'] },
  { type: 'BTC_WALLET', words: ['والت بیتکوین', 'کیف بیتکوین', 'btc wallet', 'bitcoin wallet'] },
  { type: 'CAPABILITIES', words: ['چه کاری بلدی', 'چیکار میتونی', 'چه کارهایی بلدی', 'قابلیت', 'قابلیتها', 'راهنما', 'کمک', 'help', 'what can you do', 'capabilities', 'commands'] }
]);

/** Pre-compile one boundary-aware matcher per keyword (built once, not per call). */
const KEYWORD_MATCHERS = KEYWORD_LEXICON.map((entry) => ({
  type: entry.type,
  matchers: entry.words.map((w) => {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Persian has no case and no \b that works on its script — bound on
    // "not a letter or digit" instead so «سود» does not match inside «سودان».
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'u');
  })
}));

function scoreKeywords(normalized) {
  const hits = [];
  for (const entry of KEYWORD_MATCHERS) {
    for (const re of entry.matchers) {
      if (re.test(normalized)) {
        hits.push({ type: entry.type, score: KEYWORD_WEIGHT });
        break; // one keyword hit per intent — repeats are not extra evidence
      }
    }
  }
  return hits;
}

/**
 * «بیت کوین چطوره» / «قیمت اتریوم» / «بیت کوین چیه» — a token name plus a question about it is
 * a token analysis, not a swap and not GENERAL. Kept separate from the lexicon
 * because it needs the extracted entity, not a word.
 */
const TOKEN_QUESTION = /(چطور|چطوره|چگونه|وضعیت|قیمت|نرخ|تحلیل|بخرم|ارزش|چیه|چیست|how is|how's|what is|what about|price of|outlook|worth)/i;

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
      /پرتفوی\s*من|پرتفویم|my portfolio|پرتفوی\s*\?/i,
      /من.*دارم\s*\?|دارم\s*\?|دارم\s*$|چیا دارم|چه دارایی.*دارم|کدوم دارایی.*دارم|do i have/i
    ]
  },
  {
    type: 'WALLET_BALANCE',
    weight: 5,
    patterns: [
      /موجودی.*بررسی|بررسی.*موجودی/i,
      /موجودی.*من|موجودیم/i,
      /چقدر.*دارم|دارایی.*من|چقدر.*سرمایه/i,
      /موجودی.*چقدر|چقدر.*موجودی/i,
      /balance|how much.*have|how many.*have|my balance/i,
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
      /برای.*ETH.*سرمایه/i,
      /پولم.*زیاد|سرمایه‌ام.*بیشتر|سرمایه‌ام.*رشد|رشد.*سرمایه|grow.*money/i
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
      /بخر|خرید.*کن|می‌خواهم.*ETH|ETH.*می‌خواهم|برام.*بخر|یه مقدار.*بگیر/i,
      /buy.*ETH|get.*ETH|want.*ETH|buy bitcoin|buy /i
    ]
  },
  {
    type: 'SELL',
    weight: 4,
    patterns: [
      /بفروش|فروش.*کن|می‌خواهم.*بفروشم|رو بفروش/i,
      /sell.*ETH|sell /i
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
    type: 'ORDERS',
    weight: 6,
    patterns: [
      /اگر.*شد.*بخر|اگر.*رسید.*بخر|اگه.*شد.*بخر|conditional.*order|limit.*order/i
    ]
  },
  {
    type: 'NOTIFICATIONS',
    weight: 6,
    patterns: [
      /اگر.*رسید.*خبر|اگر.*شد.*خبر|خبرم کن|اطلاع بده|alert me|notify me/i
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
      /کراس.?چین|کراس چین|کراسچین|بین.?زنجیره/i,
      /بریج|بریدج|پل.*زنجیره|bridge|cross.?chain|crosschain/i
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

  const normalized = normalizeText(text);
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

  /*
   * Keyword layer — the fix for bare nouns («پرتفوی», «سود», «استراتژی»).
   * It only ADDS evidence; a phrase match from INTENT_PATTERNS always carries
   * more weight, so nothing that used to classify correctly can be displaced.
   */
  for (const hit of scoreKeywords(normalized)) {
    scores.set(hit.type, (scores.get(hit.type) || 0) + hit.score);
    matched.push({ type: hit.type, score: hit.score, keyword: true });
  }

  // Check navigation separately
  const nav = extractNavigationIntent(text);
  if (nav) {
    const existing = scores.get(nav.type) || 0;
    scores.set(nav.type, existing + 6);
    matched.push({ type: nav.type, score: 6, nav });
  }

  // Entity extraction (Upgrade 4)
  const entities = extractEntities(text, context);

  // Upgrade 4 NLP classification & conflict/correction analysis
  const questionType = classifyQuestionType(text);
  const conflict = detectConflict(text);
  const correction = detectUserCorrection(text, context);

  /*
   * A named token plus a question about it is a token analysis. Without this
   * «بیت کوین چطوره» and «قیمت اتریوم» scored nothing at all: the token name
   * is an entity, not one of the lexicon words.
   */
  if (entities.token && !entities.fromToken && TOKEN_QUESTION.test(text)) {
    scores.set('ANALYZE_TOKEN', (scores.get('ANALYZE_TOKEN') || 0) + 5);
    matched.push({ type: 'ANALYZE_TOKEN', score: 5, tokenQuestion: entities.token });
  }

  // Sort by score, breaking ties deterministically so the same sentence never
  // classifies two different ways between runs.
  const sorted = [...scores.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  const top = sorted[0];

  // If user corrected to SELL / BUY / SWAP, apply correction
  if (correction && correction.newIntent) {
    scores.set(correction.newIntent, (scores.get(correction.newIntent) || 0) + 15);
  }

  // If no clear intent, try to infer from context
  if (!top || top[1] < 3) {
    // Contextual follow-up: "this" "it" refers to current page/action
    if (/(این|همین|this|it).*اجرا|اجرا.*کن/i.test(text) && context.currentPage) {
      const breakdown = calculateConfidenceBreakdown({ intentType: 'EXECUTE_CURRENT', entities, context, questionType });
      const clarification = calculateClarificationPriority({ intentType: 'EXECUTE_CURRENT', entities, context });
      return {
        ok: true,
        type: 'EXECUTE_CURRENT',
        primaryIntent: 'EXECUTE_CURRENT',
        confidence: 0.85,
        confidenceBreakdown: breakdown,
        questionType,
        entities,
        raw: text,
        contextRef: context.currentPage,
        matched: [],
        isFollowUp: true,
        missingInformation: clarification.missingFields,
        clarificationPriority: clarification.priorityList,
        minimalQuestion: clarification.minimalQuestion,
        isCorrection: Boolean(correction?.isCorrection),
        isConflict: Boolean(conflict.conflict),
        conflictDetails: conflict.conflict ? { messageFa: conflict.messageFa, messageEn: conflict.messageEn } : null
      };
    }

    const slots = context.operational || {};
    if (/(بخرش|بفروشش|بخر|فروش|تبدیل|انجام بده)/i.test(text) && (slots.asset || entities.token)) {
      const op = /فروش|sell/i.test(text) ? 'SELL' : (/تبدیل|swap/i.test(text) ? 'SWAP' : 'BUY');
      const mergedEntities = {
        ...entities,
        token: entities.token || slots.asset,
        amount: entities.amount || entities.amountUsd || slots.amount
      };
      const breakdown = calculateConfidenceBreakdown({ intentType: op, entities: mergedEntities, context, questionType });
      const clarification = calculateClarificationPriority({ intentType: op, entities: mergedEntities, context });
      return {
        ok: true,
        type: op,
        primaryIntent: op,
        confidence: 0.8,
        confidenceBreakdown: breakdown,
        questionType,
        entities: mergedEntities,
        raw: text,
        isFollowUp: true,
        matched,
        missingInformation: clarification.missingFields,
        clarificationPriority: clarification.priorityList,
        minimalQuestion: clarification.minimalQuestion,
        isCorrection: Boolean(correction?.isCorrection),
        isConflict: Boolean(conflict.conflict),
        conflictDetails: conflict.conflict ? { messageFa: conflict.messageFa, messageEn: conflict.messageEn } : null
      };
    }

    const clarification = calculateClarificationPriority({ intentType: 'GENERAL', entities, context });
    const breakdown = calculateConfidenceBreakdown({ intentType: 'GENERAL', entities, context, questionType });
    return {
      ok: true,
      type: 'GENERAL',
      primaryIntent: 'GENERAL',
      confidence: 0.3,
      confidenceBreakdown: breakdown,
      questionType,
      entities,
      raw: text,
      matched,
      shouldAsk: false,
      missingInformation: clarification.missingFields,
      clarificationPriority: clarification.priorityList,
      minimalQuestion: clarification.minimalQuestion,
      isCorrection: Boolean(correction?.isCorrection),
      isConflict: Boolean(conflict.conflict),
      conflictDetails: conflict.conflict ? { messageFa: conflict.messageFa, messageEn: conflict.messageEn } : null
    };
  }

  const confidence = Math.min(0.98, top[1] / (top[1] + (sorted[1]?.[1] || 0) + 1) + 0.3);
  const secondary = sorted.slice(1, 3).map(([k]) => k);
  const selectedType = (correction && correction.newIntent) ? correction.newIntent : top[0];

  const clarification = calculateClarificationPriority({ intentType: selectedType, entities, context });
  const breakdown = calculateConfidenceBreakdown({ intentType: selectedType, entities, context, questionType });
  const nextPredictedActions = predictNextActions({ intentType: selectedType, entities, context });

  return {
    ok: true,
    type: selectedType,
    primaryIntent: selectedType,
    secondaryIntents: secondary,
    confidence: Math.round(confidence * 100) / 100,
    confidenceBreakdown: breakdown,
    questionType,
    entities,
    goal: entities.targetReturn ? 'TARGET_RETURN' : entities.timeframe ? 'TIMEFRAME_GROWTH' : null,
    assets: entities.tokens?.map((sym) => ({ symbol: sym, role: sym === entities.toToken ? 'target' : 'primary' })) || [],
    amount: entities.amount ? [{ value: entities.amount, unit: entities.amountUnit || 'USD', isRelative: Boolean(entities.isRelative) }] : [],
    currency: entities.currency || 'USD',
    network: entities.network || null,
    timeframe: entities.timeframe || null,
    riskPreference: entities.riskPreference || null,
    targetReturn: entities.targetReturn || null,
    targetReturnNote: entities.targetReturnNote || null,
    constraints: entities.constraints || [],
    urgency: entities.urgency || 'normal',
    executionRequested: ['BUY', 'SELL', 'SWAP', 'SEND', 'BRIDGE'].includes(selectedType) || /(برام.*بخر|اجرا کن|do it)/i.test(text),
    missingInformation: clarification.missingFields,
    clarificationPriority: clarification.priorityList,
    minimalQuestion: clarification.minimalQuestion,
    assumptions: [],
    requiresConfirmation: ['BUY', 'SELL', 'SWAP', 'SEND', 'BRIDGE', 'REBALANCE'].includes(selectedType),
    isCorrection: Boolean(correction?.isCorrection),
    isConflict: Boolean(conflict.conflict),
    conflictDetails: conflict.conflict ? { messageFa: conflict.messageFa, messageEn: conflict.messageEn } : null,
    nextPredictedActions,
    raw: text,
    matched,
    navigation: nav,
    isFollowUp: /(این|همین|this|it)/i.test(text),
    requiresWallet: ['PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'SWAP', 'BRIDGE', 'SEND', 'BUY', 'SELL', 'REBALANCE', 'FARM', 'LEND', 'BORROW', 'DCA'].includes(selectedType),
    readOnly: [
      'PORTFOLIO_ANALYSIS', 'MARKET_ANALYSIS', 'NEWS_SEARCH', 'MARKET_CONTEXT', 'OPEN_CALM', 'PLAY_MUSIC',
      'NAVIGATION', 'WALLET_BALANCE', 'SMART_MONEY', 'WHALE', 'YIELD_DISCOVERY', 'INVESTMENT_PLAN',
      'FARM', 'LEND', 'ANALYZE_TOKEN', 'RISK_ANALYSIS', 'SIGNALS', 'STOCKS', 'HORIZON', 'FOREX', 'RWA',
      'P2P', 'DYDX', 'FUTURES', 'ORDERS', 'BTC_WALLET', 'NOTIFICATIONS', 'SETTINGS', 'REWARDS',
      'INTENT_OS', 'ADD_TOKEN', 'SWITCH_NETWORK', 'WALLET_CONNECT', 'WALLET_DISCONNECT',
      'SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND',
      'OPS_CENTER', 'AGENTS', 'STRATEGY', 'SYSTEM_STATUS', 'SECURITY', 'NFT', 'SHOP',
      'EXPLORE', 'LEARN', 'DOCS', 'LEADERBOARD', 'VAULT', 'CAPABILITIES'
    ].includes(selectedType),
    handoff: !['PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'YIELD_DISCOVERY', 'INVESTMENT_PLAN', 'RISK_ANALYSIS', 'GENERAL', 'CANCEL', 'CONTINUE', 'DETAILS', 'CAPABILITIES', 'SYSTEM_STATUS', 'AGENTS', 'STRATEGY'].includes(selectedType)
  };
}

function extractEntities(text, context = {}) {
  const deep = extractEntitiesUpgrade4(text, context);
  const raw = String(text || '');

  const amountMatch = raw.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(USDC|USDT|ETH|BTC|SOL|USD|\$|دلار|تتر)/i);
  if (amountMatch && !deep.amount) {
    deep.amount = amountMatch[1].replace(/,/g, '');
    deep.amountSymbol = aliasToken(amountMatch[2]) || amountMatch[2];
  }

  const dollarMatch = raw.match(/(?:\$|usd|dollars?|دلار)\s*(\d+(?:,\d+)*(?:\.\d+)?)|(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:dollars?|دلار|usd)/i);
  if (dollarMatch && !deep.amountUsd) {
    deep.amountUsd = (dollarMatch[1] || dollarMatch[2]).replace(/,/g, '');
    if (!deep.amount) deep.amount = deep.amountUsd;
  }

  const tokens = [...(deep.tokens || [])];
  const aliasHits = ['تتر', 'اتریوم', 'اتر', 'بیت‌کوین', 'بیت کوین', 'بیتکوین', 'سولانا', 'بایننس'];
  for (const a of aliasHits) {
    if (raw.includes(a)) {
      const t = aliasToken(a);
      if (t && !tokens.includes(t)) tokens.push(t);
    }
  }
  const tokenRegex = /\b(ETH|BTC|SOL|USDC|USDT|BNB|ARB|MATIC|AVAX|OP|DAI)\b/gi;
  for (const m of raw.matchAll(tokenRegex)) {
    const sym = m[1].toUpperCase();
    if (!tokens.includes(sym)) tokens.push(sym);
  }
  const uniq = [...new Set(tokens)];
  if (uniq.length) {
    deep.tokens = uniq;
    if (uniq.length >= 2) {
      deep.fromToken = deep.fromToken || uniq[0];
      deep.toToken = deep.toToken || uniq[1];
      deep.token = deep.token || uniq[0];
    } else {
      deep.token = deep.token || uniq[0];
    }
  }

  const toPrep = /(?:به|به سمت|تبدیل به)\s*([A-Za-z]{2,10}|تتر|اتریوم|سولانا|بیت.?کوین)/i.exec(raw);
  if (toPrep) {
    const dest = aliasToken(toPrep[1]) || String(toPrep[1]).toUpperCase();
    if (dest) {
      deep.toToken = dest;
      if (deep.token && deep.token !== dest) deep.fromToken = deep.fromToken || deep.token;
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
  if (chains.length) deep.chains = [...new Set(chains)];
  if (chainIds.length) {
    const uniqueIds = [...new Set(chainIds)];
    deep.chainIds = uniqueIds;
    deep.network = uniqueIds[0];
    if (uniqueIds.length > 1) {
      deep.fromChain = uniqueIds[0];
      deep.toChain = uniqueIds[1];
      deep.destinationNetwork = uniqueIds[1];
    }
  }

  const evmAddr = raw.match(/0x[a-fA-F0-9]{40}/);
  if (evmAddr && !deep.toAddress) deep.toAddress = evmAddr[0];

  // Timeframes
  const timeMatch = raw.match(/(\d+)\s*(سال|ماه|روز|year|month|day)/i);
  if (timeMatch && !deep.timeframe) {
    deep.timeframe = { value: timeMatch[1], unit: timeMatch[2] };
  }

  // Risk
  if (/ریسک.*کم|low.*risk|محافظه/i.test(raw)) deep.riskTolerance = 'low';
  else if (/ریسک.*متوسط|medium.*risk/i.test(raw)) deep.riskTolerance = 'medium';
  else if (/ریسک.*زیاد|high.*risk|تهاجمی/i.test(raw)) deep.riskTolerance = 'high';

  if (/solana|سولانا/i.test(raw)) deep.venue = 'solana';
  else if (/evm|اتریوم|آربیتروم|بیس/i.test(raw)) deep.venue = 'evm';

  return deep;
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
  { input: 'جزئیاتش را بیشتر بررسی کن', expected: 'DETAILS' },

  /* ── BARE NOUNS ──────────────────────────────────────────────────────────
   * Every case below used to return GENERAL@0.3 — the "I couldn't map that to
   * a module" reply users actually hit. They are the regression net for the
   * keyword layer: a user types a noun, not a sentence, and still gets routed.
   */
  { input: 'پرتفوی', expected: 'PORTFOLIO_ANALYSIS' },
  { input: 'سود', expected: 'YIELD_DISCOVERY' },
  { input: 'تحلیل', expected: 'MARKET_ANALYSIS' },
  { input: 'کیف پول من', expected: 'WALLET_BALANCE' },
  { input: 'استراتژی', expected: 'STRATEGY' },
  { input: 'ایجنت‌ها را نشان بده', expected: 'AGENTS' },
  { input: 'مرکز عملیات', expected: 'OPS_CENTER' },
  { input: 'وضعیت سیستم', expected: 'SYSTEM_STATUS' },
  { input: 'امنیت', expected: 'SECURITY' },
  { input: 'nft', expected: 'NFT' },
  { input: 'فروشگاه', expected: 'SHOP' },
  { input: 'چه کاری بلدی', expected: 'CAPABILITIES' },
  { input: 'برای ادامه کار', expected: 'CONTINUE' },
  { input: 'سهام', expected: 'STOCKS' },
  { input: 'بریج', expected: 'BRIDGE' },
  { input: 'p2p', expected: 'P2P' },
  { input: 'سفارش‌های من', expected: 'ORDERS' },
  { input: 'اخبار', expected: 'NEWS_SEARCH' },

  /* ── TOKEN + QUESTION ────────────────────────────────────────────────────
   * A named coin plus a question about it is an analysis request. Neither
   * word is in the lexicon; the entity extractor supplies the token.
   */
  { input: 'بیت کوین چطوره', expected: 'ANALYZE_TOKEN' },
  { input: 'قیمت اتریوم', expected: 'ANALYZE_TOKEN' },

  /* ── MIXED SCRIPT / ARABIC KEYBOARD ──────────────────────────────────────
   * Arabic ي and ك arrive from iOS keyboards; normalisation must fold them.
   */
  { input: 'پرتفوي', expected: 'PORTFOLIO_ANALYSIS' },
  { input: 'كيف پول', expected: 'WALLET_BALANCE' }
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
