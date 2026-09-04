/**
 * FBT SMART INTENT OS — AI UPGRADE 4: CORE INTENT UNDERSTANDING ENGINE
 * ---------------------------------------------------------------------------
 * Implements full NLP understanding, request prediction, goal extraction,
 * reference resolution, typo tolerance, financial slang & Iranian market units,
 * question classification, conflict detection, user correction learning,
 * clarification priority ranking, confidence breakdown, and structured UserIntent.
 */

import { aliasChainId, aliasToken } from './moduleRouter.js';
import { getSessionOperationalSlots } from './intentSession.js';

export const INTENT_ENGINE_VERSION = '4.0.0';
export const USER_INTENT_SCHEMA = 'fbt.user-intent.v4';

/* -------------------------------------------------------------------------- */
/*  NORMALIZATION & ARABIC/PERSIAN FOLDING & TYPO TOLERANCE                    */
/* -------------------------------------------------------------------------- */

const AR_TO_FA = {
  'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا',
  'ؤ': 'و', 'ى': 'ی', 'ئ': 'ی'
};

const DIGIT_MAP = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
};

/** Common typos & Persian verb-endings dictionary */
const TYPO_REPLACEMENTS = [
  // Repeated Persian characters at end of words (e.g. بخرر -> بخر, تترر -> تتر)
  [/\bبخر+[یر]?\b/g, 'بخر'],
  [/\bبفروش+[سش]?\b/g, 'بفروش'],
  [/\bتتر+[\s$]/g, 'تتر '],
  [/\bسولانا+[\s$]/g, 'سولانا '],
  [/\bاتر+وم\b/g, 'اتریوم'],
  [/\bبی\s*کوین\b/g, 'بیت کوین'],
  [/\bبیتکویین\b/g, 'بیت کوین'],
  [/\bسواپ\s*کنش\b/g, 'سواپ کن این'],
  [/\bتبدیلش\s*کن\b/g, 'تبدیل کن این'],
  [/\bبخرش\b/g, 'بخر این'],
  [/\bبفروشش\b/g, 'بفروش این'],
  [/\bswapp+\b/g, 'swap'],
  [/\bbitcoi+n\b/g, 'bitcoin'],
  [/\barbitro+m\b/g, 'arbitrum'],
  [/\bethereu+m\b/g, 'ethereum'],
  [/\bsolan+a+\b/g, 'solana'],
  [/\btethe+r\b/g, 'tether'],
  [/\bbekhar\b/g, 'بخر buy'],
  [/\bbefroo?sh\b/g, 'بفروش sell'],
  [/\bberiz\b/g, 'واریز deposit'],
  [/\benteghal\b/g, 'انتقال transfer'],
  [/\bsoot\b/g, 'سود yield'],
  [/\bpoolam\b/g, 'پولم balance'],
  [/\bmojoodi\b/g, 'موجودی balance']
];

export function normalizeUpgrade4(raw) {
  let str = String(raw ?? '')
    .replace(/[يكةۀأإآؤىئ]/g, (c) => AR_TO_FA[c] || c)
    .replace(/[۰-۹٠-٩०-९০-৯]/g, (d) => DIGIT_MAP[d] || d)
    .replace(/[\u200c\u200f\u200e\u064b-\u0652\u0670]/g, ' ')
    .replace(/(\d+)[.,/](\d+)/g, '$1__DECIMAL__$2')
    .replace(/[?!.,;:؛،؟)("'`\/\\]/g, ' ')
    .replace(/__DECIMAL__/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  for (const [pattern, repl] of TYPO_REPLACEMENTS) {
    str = str.replace(pattern, repl);
  }
  return str.replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/*  FINANCIAL SLANG & IRANIAN MARKET UNITS & ALIASES                           */
/* -------------------------------------------------------------------------- */

export const SLANG_ASSET_MAP = Object.freeze({
  'بیت': 'BTC',
  'بیت کوین': 'BTC',
  'بیتکوین': 'BTC',
  'بی کوین': 'BTC',
  'bitcoin': 'BTC',
  'btc': 'BTC',
  'اتریوم': 'ETH',
  'اتر': 'ETH',
  'اتروم': 'ETH',
  'ethereum': 'ETH',
  'eth': 'ETH',
  'تتر': 'USDT',
  'tether': 'USDT',
  'usdt': 'USDT',
  'دلار': 'USD',
  'usd': 'USD',
  'سول': 'SOL',
  'سولانا': 'SOL',
  'solana': 'SOL',
  'sol': 'SOL',
  'بایننس': 'BNB',
  'بی ان بی': 'BNB',
  'bnb': 'BNB',
  'آربیتروم': 'ARB',
  'اربیتروم': 'ARB',
  'arbitrum': 'ARB',
  'arb': 'ARB',
  'پالیگان': 'MATIC',
  'متیک': 'MATIC',
  'polygon': 'MATIC',
  'matic': 'MATIC',
  'اوپتیمیزم': 'OP',
  'آپتیمیزم': 'OP',
  'optimism': 'OP',
  'op': 'OP',
  'آوالانچ': 'AVAX',
  'avalanche': 'AVAX',
  'avax': 'AVAX',
  'ترون': 'TRX',
  'tron': 'TRX',
  'trx': 'TRX',
  'دوج': 'DOGE',
  'دوج کوین': 'DOGE',
  'doge': 'DOGE',
  'ریپل': 'XRP',
  'xrp': 'XRP',
  'کاردانو': 'ADA',
  'ada': 'ADA',
  'تون': 'TON',
  'تون کوین': 'TON',
  'ton': 'TON'
});

export const IRANIAN_CURRENCY_PATTERNS = Object.freeze([
  { pattern: /(\d+(?:\.\d+)?)\s*(?:میلیون|میلیون\s*تومان|میلیون\s*تومن)/i, multiplier: 1_000_000, unit: 'TOMAN' },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:میلیارد|میلیارد\s*تومان|میلیارد\s*تومن)/i, multiplier: 1_000_000_000, unit: 'TOMAN' },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:تومن|تومان)/i, multiplier: 1, unit: 'TOMAN' },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:ریال)/i, multiplier: 0.1, unit: 'TOMAN' },
  { pattern: /(?:ده|۱۰)\s*تومن/i, value: 10, unit: 'TOMAN' },
  { pattern: /(?:صد|۱۰۰)\s*تومن/i, value: 100, unit: 'TOMAN' },
  { pattern: /(?:یک|یه|۱)\s*میلیون/i, value: 1_000_000, unit: 'TOMAN' },
  { pattern: /(?:دو|۲)\s*میلیون/i, value: 2_000_000, unit: 'TOMAN' },
  { pattern: /(?:پنج|۵)\s*میلیون/i, value: 5_000_000, unit: 'TOMAN' },
  { pattern: /(?:ده|۱۰)\s*میلیون/i, value: 10_000_000, unit: 'TOMAN' }
]);

/* -------------------------------------------------------------------------- */
/*  QUESTION & INTENT CLASSIFICATION TAXONOMY                                  */
/* -------------------------------------------------------------------------- */

export const QUESTION_TYPES = Object.freeze({
  INFORMATION: 'INFORMATION',         // "بیت کوین چیه؟"
  PORTFOLIO_QUERY: 'PORTFOLIO_QUERY', // "من بیت کوین دارم؟"
  BALANCE_QUERY: 'BALANCE_QUERY',     // "چقدر بیت دارم؟", "چقدر سرمایه دارم؟"
  MARKET_QUERY: 'MARKET_QUERY',       // "بیت کوین الان چطوره؟"
  RECOMMENDATION: 'RECOMMENDATION',   // "به نظرت بیت بخرم؟"
  EXECUTION: 'EXECUTION',             // "بیت کوین بخر", "برام بیت کوین بخر"
  CONDITIONAL: 'CONDITIONAL',         // "اگر بیت زیر 100 هزار شد بخر"
  GOAL_PLANNING: 'GOAL_PLANNING',     // "میخوام پولم رشد کنه"
  HELP: 'HELP'                        // "چه کاری بلدی؟"
});

/* -------------------------------------------------------------------------- */
/*  INTENT RECOGNITION PATTERNS & HEURISTICS                                   */
/* -------------------------------------------------------------------------- */

export function classifyQuestionType(text) {
  const norm = normalizeUpgrade4(text);

  // 1. Definition / Explanation question
  if (/(چیست|چیه|تعریف|توضیح|what is|tell me about|explain)/i.test(norm) && !/(چقدر|کیف|پرتفوی|دارم|سود|بخرم|قیمت)/i.test(norm)) {
    return QUESTION_TYPES.INFORMATION;
  }

  // 2. Balance query ("چقدر بیت دارم؟", "موجودیم چقدره؟", "چقدر سرمایه دارم؟")
  if (/(چقدر.*دارم|چقدر.*موجودی|موجودیم.*چقدر|موجودیم|چقدر.*سرمایه|how much.*have|my balance|my funds)/i.test(norm)) {
    return QUESTION_TYPES.BALANCE_QUERY;
  }

  // 3. Portfolio query ("من بیت کوین دارم؟", "بیت کوین دارم؟", "چیا دارم که بفروشم؟", "سبدم چیه")
  if (/(دارم\s*\?|دارم\s*$|من.*دارم|چیا دارم|چه دارایی.*دارم|سبدم|پرتفوی من|do i have|my portfolio)/i.test(norm)) {
    return QUESTION_TYPES.PORTFOLIO_QUERY;
  }

  // 4. Recommendation request ("به نظرت بیت بخرم؟", "چی بخرم؟", "پیشنهادت چیه؟")
  if (/(نظرت|پیشنهاد|چی بخرم|کدوم ارز|به نظرت|should i buy|what to buy|recommend)/i.test(norm)) {
    return QUESTION_TYPES.RECOMMENDATION;
  }

  // 5. Conditional strategy ("اگر بیت زیر 100 هزار شد بخر", "اگه رسید خبر بده")
  if (/(اگر|اگه|هر وقت|چنانچه|if\b|when\b)/i.test(norm) && /(بخر|بفروش|سواپ|خبر|هشدار|اطلاع|alert|buy|sell)/i.test(norm)) {
    return QUESTION_TYPES.CONDITIONAL;
  }

  // 6. Market analysis question ("بیت کوین الان چطوره؟", "وضعیت بازار")
  if (/(چطوره|چگونه است|وضعیت|تحلیل|روند|قیمت|how is|how's|price of|market status)/i.test(norm)) {
    return QUESTION_TYPES.MARKET_QUERY;
  }

  // 7. Goal planning ("پولم رو زیاد کن", "میخوام سرمایه‌ام رشد کنه")
  if (/(پولم.*زیاد|سرمایه‌ام.*بیشتر|سرمایه.*رشد|سود کنم|هدف مالی|grow.*money|make.*profit|build wealth)/i.test(norm)) {
    return QUESTION_TYPES.GOAL_PLANNING;
  }

  // 8. Explicit execution request ("بخر", "بفروش", "سواپ کن", "ارسال کن")
  if (/(بخر|خرید کن|بفروش|فروش|سواپ|تبدیل کن|بفرست|انتقال بده|buy\b|sell\b|swap\b|send\b|transfer\b)/i.test(norm)) {
    return QUESTION_TYPES.EXECUTION;
  }

  // 9. Help / capabilities
  if (/(چه کاری بلدی|چیکار میتونی|قابلیت|راهنما|help\b|capabilities\b|what can you do)/i.test(norm)) {
    return QUESTION_TYPES.HELP;
  }

  return 'GENERAL';
}

/* -------------------------------------------------------------------------- */
/*  CONFLICT & CORRECTION DETECTION                                            */
/* -------------------------------------------------------------------------- */

export function detectConflict(text) {
  const norm = normalizeUpgrade4(text);
  // User asked both BUY and SELL on the same thing at once: "بیت رو بخر و بفروش"
  const hasBuy = /\b(بخر|خرید|buy)\b/i.test(norm);
  const hasSell = /\b(بفروش|فروش|sell)\b/i.test(norm);
  const hasAnd = /\b(و|and|هم)\b/i.test(norm);

  if (hasBuy && hasSell && (hasAnd || norm.includes('بخر و بفروش') || norm.includes('buy and sell'))) {
    return {
      conflict: true,
      reason: 'MUTUALLY_EXCLUSIVE_ACTIONS',
      messageFa: 'منظورتان خرید است یا فروش آن؟',
      messageEn: 'Did you mean to buy or sell?'
    };
  }
  return { conflict: false };
}

export function detectUserCorrection(text, session = null) {
  const norm = normalizeUpgrade4(text);
  // User correction: "نه، منظورم فروش بود", "نه ETH", "نه ۵۰۰ دلار", "اشتباه شد بخر"
  const isCorrection = /^(نه|نخیر|اشتباه شد|no\b|nope\b|not that|instead|منظورم)/i.test(norm);
  if (!isCorrection) return null;

  let newIntent = null;
  if (/\b(فروش|بفروش|sell)\b/i.test(norm)) newIntent = 'SELL';
  else if (/\b(خرید|بخر|buy)\b/i.test(norm)) newIntent = 'BUY';
  else if (/\b(سواپ|تبدیل|swap)\b/i.test(norm)) newIntent = 'SWAP';

  let newAsset = null;
  for (const [key, sym] of Object.entries(SLANG_ASSET_MAP)) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(norm)) {
      newAsset = sym;
      break;
    }
  }

  return {
    isCorrection: true,
    newIntent,
    newAsset,
    raw: text
  };
}

/* -------------------------------------------------------------------------- */
/*  PRONOUN & REFERENCE RESOLUTION                                             */
/* -------------------------------------------------------------------------- */

export function resolveReferences(text, historyOrContext = {}, extraContext = {}) {
  let conversation = [];
  let context = {};

  if (Array.isArray(historyOrContext)) {
    conversation = historyOrContext;
    context = extraContext || {};
  } else if (historyOrContext && typeof historyOrContext === 'object') {
    conversation = historyOrContext.conversation || [];
    context = historyOrContext;
  }

  const norm = normalizeUpgrade4(text);
  const hasPronoun = /(?:^|\s)(?:این|اون|همین|این ارز|ارز قبلی|همون|این یکی|این رو|اون رو|آن|بقیه\s*اش|بقیه‌اش|بقیه|مابقی)(?:[\s\u200c]|$)/i.test(norm)
    || /\b(this|it|that|the same|the rest|all of it|rest|same)\b/i.test(norm)
    || /(?:بقیه|مابقی|همه‌اش)/.test(text);

  if (!hasPronoun) return { hasPronoun: false, resolvedAsset: null, resolvedFrom: null, resolvedText: text, inferredEntities: {}, resolvedToken: null };
  let resolved = String(text || '');
  const inferredEntities = {};
  let resolvedAsset = null;
  let resolvedFrom = null;

  const slots = context.operational || (context.sessionId ? getSessionOperationalSlots(context.sessionId) : {}) || {};

  // 1. Check operational slots from previous turn
  if (slots.asset || slots.token || slots.fromToken || slots.toToken) {
    resolvedAsset = slots.asset || slots.token || slots.toToken || slots.fromToken;
    resolvedFrom = 'previous_turn_slot';
  }

  // 2. Check context asset / selected asset / last token
  if (!resolvedAsset && (context.selectedAsset || context.lastToken || context.asset)) {
    resolvedAsset = context.selectedAsset || context.lastToken || context.asset;
    resolvedFrom = 'page_context';
  }

  // 3. Check conversation history
  if (!resolvedAsset && Array.isArray(conversation) && conversation.length) {
    for (let i = conversation.length - 1; i >= 0; i--) {
      const msg = conversation[i]?.content || '';
      for (const [key, sym] of Object.entries(SLANG_ASSET_MAP)) {
        if (new RegExp(`(?:^|\\s)${key}(?:\\s|$)`, 'i').test(msg)) {
          resolvedAsset = sym;
          resolvedFrom = 'conversation_history';
          break;
        }
      }
      if (resolvedAsset) break;
      const m = msg.match(/\b(BTC|ETH|USDT|USDC|SOL|MATIC|BNB|AVAX|ARB|OP)\b/i);
      if (m) {
        resolvedAsset = m[1].toUpperCase();
        resolvedFrom = 'conversation_history';
        break;
      }
    }
  }

  if (resolvedAsset) {
    inferredEntities.token = resolvedAsset;
    resolved = resolved
      .replace(/\b(it|that|this)\b/gi, resolvedAsset)
      .replace(/(?:آن|این|اون|همون)(?:[\s\u200c]|$)/g, `${resolvedAsset} `)
      .replace(/\b(the rest|all of it)\b/gi, `remaining ${resolvedAsset}`)
      .replace(/(?:بقیه[\s\u200c]*اش|همه‌[\s\u200c]*اش|مابقیش|بقیه)/g, `باقیمانده ${resolvedAsset}`);
  }

  return {
    hasPronoun,
    resolvedAsset: resolvedAsset || null,
    resolvedFrom: resolvedFrom || (hasPronoun ? 'unresolved' : null),
    resolvedText: resolved,
    inferredEntities,
    resolvedToken: resolvedAsset || null
  };
}

/* -------------------------------------------------------------------------- */
/*  ENTITY EXTRACTION (Upgrade 4)                                              */
/* -------------------------------------------------------------------------- */

export function extractEntitiesUpgrade4(rawText, context = {}) {
  const text = String(rawText || '');
  const norm = normalizeUpgrade4(text);
  const entities = {
    assets: [],
    tokens: [],
    token: null,
    fromToken: null,
    toToken: null,
    amount: null,
    amountUsd: null,
    amountUnit: null,
    amountPct: null,
    isFuzzyAmount: false,
    fuzzyType: null,
    currency: 'USD',
    network: null,
    chainIds: [],
    timeframe: null,
    riskPreference: null,
    targetReturn: null,
    targetReturnNote: null,
    priceTrigger: null,
    priceTriggerOperator: null,
    constraints: [],
    urgency: 'normal',
    isCorrection: false,
    isConflict: false,
    resolvedReferences: {}
  };

  // 1. Resolve Pronouns / References
  const ref = resolveReferences(text, context);
  if (ref.hasPronoun && ref.resolvedAsset) {
    entities.resolvedReferences.asset = ref.resolvedAsset;
    entities.resolvedReferences.from = ref.resolvedFrom;
    entities.token = ref.resolvedAsset;
    entities.tokens.push(ref.resolvedAsset);
  }

  // 2. Asset Extraction (including Slang & Typos)
  const foundTokens = [];
  for (const [slang, sym] of Object.entries(SLANG_ASSET_MAP)) {
    const reg = new RegExp(`(^|[^\\p{L}\\p{N}])${slang}($|[^\\p{L}\\p{N}])`, 'u');
    if (reg.test(norm)) {
      if (sym === 'USD' && (norm.includes('تتر') || norm.includes('usdt'))) {
        // If "تتر" also appears, ignore generic "دلار"
        continue;
      }
      foundTokens.push({ symbol: sym, word: slang, index: norm.indexOf(slang) });
    }
  }

  foundTokens.sort((a, b) => a.index - b.index);
  const uniqTokens = [...new Set(foundTokens.map((t) => t.symbol))];

  if (uniqTokens.length) {
    entities.tokens = uniqTokens;
    if (uniqTokens.length >= 2) {
      entities.fromToken = uniqTokens[0];
      entities.toToken = uniqTokens[1];
      entities.token = uniqTokens[0];
    } else {
      entities.token = uniqTokens[0];
    }
  }

  // Explicit swap destination phrasing: "بیت رو تبدیل کن به تتر", "تبدیل به USDT"
  const toMatch = /(?:به|به سمت|تبدیل به|swap to|convert to|into)\s*([A-Za-z]{2,10}|تتر|اتریوم|سولانا|بیت.?کوین|usdt|eth|btc|sol)/i.exec(norm);
  if (toMatch) {
    const destWord = toMatch[1].trim();
    const destSym = SLANG_ASSET_MAP[destWord] || aliasToken(destWord) || destWord.toUpperCase();
    if (destSym) {
      entities.toToken = destSym;
      if (entities.token && entities.token !== destSym) {
        entities.fromToken = entities.token;
      }
    }
  }

  // 3. Amount Extraction (Exact, Iranian Units, Percentages, Relative)
  // Check Iranian Currency patterns first
  for (const row of IRANIAN_CURRENCY_PATTERNS) {
    const m = norm.match(row.pattern);
    if (m) {
      const val = row.value != null ? row.value : Number(m[1]) * row.multiplier;
      entities.amount = String(val);
      entities.amountUnit = row.unit;
      entities.currency = row.unit;
      break;
    }
  }

  // Exact amount with currency ($500, 500 دلار, 500 USDT, 0.5 ETH)
  const amountMatch = norm.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(USDC|USDT|ETH|BTC|SOL|USD|\$|دلار|تتر)/i);
  if (amountMatch && !entities.amount) {
    entities.amount = amountMatch[1].replace(/,/g, '');
    const sym = aliasToken(amountMatch[2]) || SLANG_ASSET_MAP[amountMatch[2].toLowerCase()] || amountMatch[2];
    entities.amountSymbol = sym;
    entities.amountUnit = sym;
  }

  const dollarMatch = norm.match(/(?:\$|usd|dollars?|دلار)\s*(\d+(?:,\d+)*(?:\.\d+)?)|(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:dollars?|دلار|usd)/i);
  if (dollarMatch && !entities.amountUsd) {
    entities.amountUsd = (dollarMatch[1] || dollarMatch[2]).replace(/,/g, '');
    if (!entities.amount) entities.amount = entities.amountUsd;
    entities.amountUnit = 'USD';
  }

  // Bare number when context is already buying/selling (e.g. "1000")
  if (!entities.amount) {
    const bareNumberMatch = norm.match(/^(\d+(?:,\d+)*(?:\.\d+)?)$/);
    if (bareNumberMatch) {
      entities.amount = bareNumberMatch[1].replace(/,/g, '');
    }
  }

  // Relative amounts & percentages ("نصفشو", "همشو", "50%", "20 درصد")
  if (/نصف|نصفش|نصفشو|نصف پولم|half|50%/i.test(norm)) {
    entities.amountPct = 50;
    entities.isRelative = true;
  } else if (/همشو|همش|همه پولم|کل پولم|تمامش|100%|everything|all of it/i.test(norm)) {
    entities.amountPct = 100;
    entities.isRelative = true;
  } else if (/یک سوم|یک‌سوم|a third|33%/i.test(norm)) {
    entities.amountPct = 33;
    entities.isRelative = true;
  } else if (/یک چهارم|یک‌چهارم|quarter|25%/i.test(norm)) {
    entities.amountPct = 25;
    entities.isRelative = true;
  } else {
    const pctMatch = norm.match(/(\d+(?:\.\d+)?)\s*(?:درصد|%|percent)/i);
    if (pctMatch) {
      const p = parseFloat(pctMatch[1]);
      if (p > 0 && p <= 100) entities.amountPct = p;
    }
  }

  // Fuzzy amounts ("یه مقدار", "مقداری", "یک کم", "a bit", "some")
  if (/یه مقدار|یک مقدار|مقداری|کمی|یک کم|a bit|some|a little/i.test(norm)) {
    entities.isFuzzyAmount = true;
    entities.fuzzyType = 'unspecified';
  }

  // 4. Timeframe Extraction (الان, امروز, امشب, فردا, این هفته, این ماه, 6 ماه, یک سال)
  if (/الان|فوراً|همین الان|now|immediately/i.test(norm)) {
    entities.timeframe = { raw: 'الان', normalizedHrs: 0, label: 'Immediate' };
    entities.urgency = 'high';
  } else if (/امروز|today/i.test(norm)) {
    entities.timeframe = { raw: 'امروز', normalizedHrs: 24, label: 'Today (24h)' };
  } else if (/امشب|tonight/i.test(norm)) {
    entities.timeframe = { raw: 'امشب', normalizedHrs: 12, label: 'Tonight (12h)' };
  } else if (/فردا|tomorrow/i.test(norm)) {
    entities.timeframe = { raw: 'فردا', normalizedHrs: 24, label: 'Tomorrow (24h)' };
  } else if (/این هفته|this week/i.test(norm)) {
    entities.timeframe = { raw: 'این هفته', normalizedHrs: 168, label: '1 Week' };
  } else if (/این ماه|this month/i.test(norm)) {
    entities.timeframe = { raw: 'این ماه', normalizedHrs: 720, label: '1 Month' };
  } else if (/(\d+)\s*(?:ماه|month|months|mo)/i.test(norm)) {
    const m = norm.match(/(\d+)\s*(?:ماه|month|months|mo)/i);
    const months = parseInt(m[1], 10);
    entities.timeframe = { raw: `${months} ماه`, normalizedHrs: months * 720, label: `${months} Months` };
  } else if (/(\d+)\s*(?:سال|year|years|y)/i.test(norm)) {
    const y = norm.match(/(\d+)\s*(?:سال|year|years|y)/i);
    const years = parseInt(y[1], 10);
    entities.timeframe = { raw: `${years} سال`, normalizedHrs: years * 8760, label: `${years} Years` };
  } else if (/کوتاه[\s-]?مدت|short[\s-]?term/i.test(norm)) {
    entities.timeframe = { raw: 'کوتاه‌مدت', normalizedHrs: 720, label: 'Short-term' };
  } else if (/بلند[\s-]?مدت|long[\s-]?term/i.test(norm)) {
    entities.timeframe = { raw: 'بلندمدت', normalizedHrs: 4320, label: 'Long-term' };
  }

  // 5. Target Return Detection (20 درصد سود, دو برابر, 10% رشد, etc.)
  if (/دو برابر|double|2x/i.test(norm)) {
    entities.targetReturn = 100;
  } else if (/سه برابر|triple|3x/i.test(norm)) {
    entities.targetReturn = 200;
  } else if (/(\d+(?:\.\d+)?)\s*(?:درصد سود|درصد رشد|% سود|% رشد|percent return|percent profit)/i.test(norm)) {
    const r = norm.match(/(\d+(?:\.\d+)?)\s*(?:درصد سود|درصد رشد|% سود|% رشد|percent return|percent profit)/i);
    entities.targetReturn = parseFloat(r[1]);
  }

  if (entities.targetReturn != null) {
    entities.targetReturnNote = 'این یک هدف است و تضمینی برای تحقق سود وجود ندارد.';
  }

  // 5b. Price trigger for conditional orders / alerts
  // «وقتی قیمتش به ۲۷۰۰ رسید» / «اگر ETH کمتر از 3000 شد خبر بده» / «alert me if eth hits 2700»
  let triggerMatch = null;
  try {
    triggerMatch = norm.match(/(?:قیمتش?\s*(?:به|reached|hits|is|equals)\s*(\d+(?:\.\d+)?))|(?:اگر\s*[a-z\u0600-\u06ff]+\s*(?:کمتر از|بالاتر از|زیر|بالای|بالاتر|کمتر|below|above|under|over|>=|<=|>|<)\s*(\d+(?:\.\d+)?))|(?:اگر\s*[a-z\u0600-\u06ff]+\s*(?:به|رسید|reached|hits)\s*(\d+(?:\.\d+)?))|(?:when(?:ever)?\s*[^.!?]{0,40}?(?:hits|reaches|goes above|goes below|above|below)\s*(\d+(?:\.\d+)?))/i);
  } catch { /* ignore malformed regex */ }
  if (triggerMatch) {
    const rawTrigger = triggerMatch[1] || triggerMatch[2] || triggerMatch[3] || triggerMatch[4];
    const trigger = rawTrigger ? parseFloat(rawTrigger) : null;
    if (trigger != null && Number.isFinite(trigger)) {
      entities.priceTrigger = trigger;
      entities.priceTriggerOperator = /بالاتر از|بالای|بالاتر|above|over|>=|>/.test(norm) ? 'above'
        : /کمتر از|زیر|کمتر|below|under|<=|</.test(norm) ? 'below'
          : 'at';
    }
  }

  // 6. Risk Preference (low, moderate, high, aggressive, capital_preservation)
  if (/اصل پولم حفظ بشه|حفظ اصل سرمایه|بدون ریسک|بی ریسک|protect capital/i.test(norm)) {
    entities.riskPreference = 'capital_preservation';
  } else if (/ریسک کم|کم ریسک|low risk|conservative|محافظه/i.test(norm)) {
    entities.riskPreference = 'low';
  } else if (/ریسک متعادل|ریسک متوسط|متعادل|moderate|medium risk/i.test(norm)) {
    entities.riskPreference = 'moderate';
  } else if (/ریسک بالا|پرریسک|high risk|aggressive/i.test(norm)) {
    entities.riskPreference = 'high';
  } else if (/هرچی شد بشه|yolo|all in|بترکونم/i.test(norm)) {
    entities.riskPreference = 'aggressive';
  }

  // 7. Network / Chain Resolution
  const chainWords = ['ethereum', 'arbitrum', 'آربیتروم', 'base', 'بیس', 'optimism', 'آپتیمیزم', 'bsc', 'bnb', 'بایننس', 'polygon', 'پالیگان', 'avalanche', 'solana', 'سولانا', 'اتریوم'];
  const foundChains = [];
  for (const w of chainWords) {
    const idx = norm.indexOf(w);
    if (idx >= 0) foundChains.push({ word: w, id: aliasChainId(w) });
  }
  const chainIds = foundChains.map((c) => c.id).filter(Boolean);
  if (chainIds.length) {
    entities.chainIds = [...new Set(chainIds)];
    entities.network = entities.chainIds[0];
  }

  // 8. EVM / Solana Address
  const evm = text.match(/0x[a-fA-F0-9]{40}/);
  if (evm) entities.toAddress = evm[0];

  return entities;
}

/* -------------------------------------------------------------------------- */
/*  CLARIFICATION PRIORITY & MINIMAL QUESTION ENGINE                           */
/* -------------------------------------------------------------------------- */

export function calculateClarificationPriority({ intentType, entities = {}, context = {}, locale = 'fa' } = {}) {
  const isFa = locale.startsWith('fa') || locale === 'fa';
  const missing = [];
  const priorityList = [];

  const hasToken = Boolean(entities.token || entities.toToken);
  const hasAmount = Boolean(entities.amount || entities.amountUsd || entities.amountPct);

  if (['BUY', 'SELL', 'SWAP'].includes(intentType)) {
    // 1. Asset check
    if (!hasToken) {
      missing.push('asset');
      priorityList.push({
        priority: 2, // Execution-critical
        field: 'asset',
        questionFa: 'کدام ارز را مدنظر دارید؟ (مثلاً BTC، ETH، SOL)',
        questionEn: 'Which asset do you have in mind? (e.g. BTC, ETH, SOL)'
      });
    }

    // 2. Amount check
    if (hasToken && !hasAmount && !entities.isFuzzyAmount) {
      missing.push('amount');
      const tokenName = entities.token || 'ارز';
      priorityList.push({
        priority: 2, // Execution-critical
        field: 'amount',
        questionFa: `مبلغ یا مقدار موردنظر برای ${intentType === 'BUY' ? 'خرید' : intentType === 'SELL' ? 'فروش' : 'سواپ'} ${tokenName} را مشخص می‌کنید؟`,
        questionEn: `What amount would you like to ${intentType.toLowerCase()} for ${tokenName}?`
      });
    }

    // 3. Swap destination check
    if (intentType === 'SWAP' && !entities.toToken && entities.token) {
      missing.push('destination_asset');
      priorityList.push({
        priority: 2, // Execution-critical
        field: 'destination_asset',
        questionFa: `می‌خواهید ${entities.token} را به چه ارزی تبدیل کنید؟ (مثلاً USDT)`,
        questionEn: `Which asset do you want to convert ${entities.token} into? (e.g. USDT)`
      });
    }
  }

  if (intentType === 'GOAL' || intentType === 'INVESTMENT_PLAN') {
    if (!entities.timeframe) {
      missing.push('timeframe');
      priorityList.push({
        priority: 4, // Optimization-related
        field: 'timeframe',
        questionFa: 'افق زمانی مدنظرتان چقدر است؟ (مثلاً ۶ ماه، ۱ سال)',
        questionEn: 'What is your investment timeframe? (e.g. 6 months, 1 year)'
      });
    }
    if (!entities.riskPreference) {
      missing.push('riskPreference');
      priorityList.push({
        priority: 4, // Optimization-related
        field: 'riskPreference',
        questionFa: 'سطح ریسک موردنظر شما چیست؟ (کم / متعادل / بالا)',
        questionEn: 'What is your preferred risk level? (Low / Moderate / High)'
      });
    }
  }

  // Sort by priority ascending (1 = highest priority)
  priorityList.sort((a, b) => a.priority - b.priority);

  const top = priorityList[0] || null;
  const minimalQuestion = top ? {
    fa: top.questionFa,
    en: top.questionEn
  } : null;

  return {
    missingFields: missing,
    priorityList,
    minimalQuestion,
    needsClarification: missing.length > 0 && priorityList.length > 0
  };
}

/* -------------------------------------------------------------------------- */
/*  CONFIDENCE BREAKDOWN ENGINE (Section 27 & 56)                              */
/* -------------------------------------------------------------------------- */

export function calculateIntentConfidenceBreakdown({ intentType, entities = {}, context = {}, questionType = 'GENERAL' } = {}) {
  let intentConfidence = 0.90;
  let contextConfidence = 0.85;
  let entityConfidence = 0.85;
  let executionConfidence = 0.90;

  if (questionType === QUESTION_TYPES.INFORMATION || questionType === QUESTION_TYPES.HELP) {
    intentConfidence = 0.98;
    entityConfidence = 0.95;
    executionConfidence = 1.0;
  } else if (['BUY', 'SELL', 'SWAP', 'SEND'].includes(intentType)) {
    if (!entities.token && !entities.toToken) {
      entityConfidence = 0.50;
      executionConfidence = 0.40;
    } else {
      entityConfidence = 0.95;
    }

    if (!entities.amount && !entities.amountUsd && !entities.amountPct && !entities.isFuzzyAmount) {
      executionConfidence = Math.min(executionConfidence, 0.70);
    }
  }

  if (context.hasWallet || context.wallet?.connected) {
    contextConfidence = 0.98;
  }

  const overallConfidence = Math.round(((intentConfidence * 0.35) + (entityConfidence * 0.30) + (contextConfidence * 0.15) + (executionConfidence * 0.20)) * 100) / 100;

  return {
    intent: intentConfidence,
    context: contextConfidence,
    entity: entityConfidence,
    execution: executionConfidence,
    overall: overallConfidence
  };
}

export { calculateIntentConfidenceBreakdown as calculateConfidenceBreakdown };

/* -------------------------------------------------------------------------- */
/*  SMART NEXT-ACTION PREDICTION (Section 24)                                  */
/* -------------------------------------------------------------------------- */

export function predictNextActions(intentOrParams = {}, contextParam = {}) {
  let intentType = 'GENERAL';
  let entities = {};
  let context = {};

  if (intentOrParams && (intentOrParams.primaryIntent || intentOrParams.type || intentOrParams.entities)) {
    intentType = intentOrParams.primaryIntent || intentOrParams.type || 'GENERAL';
    entities = intentOrParams.entities || {};
    context = contextParam || {};
  } else if (intentOrParams && typeof intentOrParams === 'object') {
    intentType = intentOrParams.intentType || intentOrParams.type || 'GENERAL';
    entities = intentOrParams.entities || {};
    context = intentOrParams.context || {};
  }

  const token = entities.token || entities.toToken || entities.tokenOut || entities.fromToken || entities.tokenIn || 'BTC';
  const sym = String(token).toUpperCase();

  switch (intentType) {
    case 'MARKET_ANALYSIS':
    case 'ANALYZE_TOKEN':
      return [
        { labelFa: `خرید ${sym}`, labelEn: `Buy ${sym}`, prompt: `${sym} بخر`, intent: 'BUY' },
        { labelFa: `تنظیم هشدار ${sym}`, labelEn: `Alert ${sym}`, prompt: `اگر ${sym} تغییر کرد خبرم کن`, intent: 'ALERT' },
        { labelFa: 'تحلیل بیشتر', labelEn: 'Deep Analysis', prompt: `تحلیل عمیق ${sym}`, intent: 'MARKET_ANALYSIS' },
        { labelFa: 'مقایسه با ETH', labelEn: 'Compare with ETH', prompt: `مقایسه ${sym} با ETH`, intent: 'COMPARE' }
      ];
    case 'PORTFOLIO_ANALYSIS':
    case 'WALLET_BALANCE':
      return [
        { labelFa: 'بررسی ریسک پرتفوی', labelEn: 'Check Risk', prompt: 'ریسک پرتفوی من چقدر است', intent: 'RISK_ANALYSIS' },
        { labelFa: 'متعادل‌سازی', labelEn: 'Rebalance', prompt: 'پرتفوی من را متعادل کن', intent: 'REBALANCE' },
        { labelFa: 'فرصت‌های سود', labelEn: 'Yield Opportunities', prompt: 'بهترین فرصت سود را پیدا کن', intent: 'YIELD_DISCOVERY' }
      ];
    case 'SWAP':
    case 'BUY':
      return [
        { labelFa: 'بررسی لغزش قیمت (Slippage)', labelEn: 'Check Slippage', prompt: 'اسلیپیج سواپ چقدر است؟', intent: 'CHECK_SLIPPAGE' },
        { labelFa: 'تایید سواپ', labelEn: 'Confirm Swap', prompt: 'انجامش بده', intent: 'CONFIRM_SWAP' },
        { labelFa: 'بررسی موجودی کیف پول', labelEn: 'Check Balance', prompt: 'موجودی من چقدر است؟', intent: 'CHECK_BALANCE' },
        { labelFa: 'تنظیم حد ضرر', labelEn: 'Set Stop Loss', prompt: `حد ضرر برای ${sym}`, intent: 'STOP_LOSS' }
      ];
    default:
      return [
        { labelFa: 'تحلیل پرتفوی', labelEn: 'Analyze Portfolio', prompt: 'پرتفوی من را تحلیل کن', intent: 'PORTFOLIO_ANALYSIS' },
        { labelFa: 'وضعیت بازار', labelEn: 'Market Overview', prompt: 'وضعیت بازار چطوره', intent: 'MARKET_ANALYSIS' },
        { labelFa: 'فرصت‌های سود', labelEn: 'Yield', prompt: 'بهترین فرصت‌های سود', intent: 'YIELD_DISCOVERY' }
      ];
  }
}

export const normalizeEngineText = normalizeUpgrade4;
export const extractAdvancedEntities = extractEntitiesUpgrade4;

export function parseSlangAndUnits(text) {
  const norm = normalizeUpgrade4(text);
  let parsedAmount = null;
  let relativePercentage = null;

  // Slang fractions
  if (/(?:half|نصف|نیمه)\s*(?:of\s*(?:my\s*)?(?:money|portfolio|balance|holdings)|پولم|داراییم|موجودیم)/i.test(norm) || /50\s*%/i.test(norm)) {
    relativePercentage = 50;
  } else if (/(?:all|همه|کل)\s*(?:of\s*(?:my\s*)?(?:money|portfolio|balance|holdings)|داراییم|پولم|موجودیم|همه‌چیز)/i.test(norm) || /100\s*%/i.test(norm)) {
    relativePercentage = 100;
  } else if (/quarter|یک چهارم|ربع/i.test(norm) || /25\s*%/i.test(norm)) {
    relativePercentage = 25;
  }

  // Persian fraction like "نیم بیت" (0.5 BTC)
  const nimMatch = norm.match(/نیم\s+(?:بیت|اتریوم|تتر|[a-zA-Z]+)/i);
  if (nimMatch) {
    parsedAmount = 0.5;
  }

  // English multipliers: 100k, 2.5m, 50 bucks
  const kMatch = norm.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    parsedAmount = parseFloat(kMatch[1]) * 1000;
  }

  const mMatch = norm.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (mMatch) {
    parsedAmount = parseFloat(mMatch[1]) * 1000000;
  }

  const bucksMatch = norm.match(/(\d+(?:\.\d+)?)\s*(?:bucks|dollar|dollars|\$)/i);
  if (bucksMatch && parsedAmount === null) {
    parsedAmount = parseFloat(bucksMatch[1]);
  }

  return {
    parsedAmount,
    relativePercentage,
    raw: text
  };
}

export function buildStructuredUserIntent(text, baseIntent = {}) {
  const norm = normalizeUpgrade4(text);
  const entities = extractEntitiesUpgrade4(norm);
  const slang = parseSlangAndUnits(norm);

  const primaryIntent = baseIntent.primaryIntent || baseIntent.type || 'GENERAL';

  // Extract constraints
  const slippageMatch = norm.match(/(?:slippage|لغزش|اسلیپیج)\s*(?:is|بود|باشد)?\s*(?:حداکثر|max|under|<|<=)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const gasMatch = norm.match(/(?:gas|گس|کارمزد)\s*(?:is|بود|باشد)?\s*(?:under|below|زیر|کمتر\s*از|<|<=)?\s*(\d+(?:\.\d+)?)\s*gwei/i);

  const constraints = {
    maxSlippagePercent: slippageMatch ? parseFloat(slippageMatch[1]) : (baseIntent.constraints?.maxSlippagePercent ?? 1.0),
    maxGasGwei: gasMatch ? parseFloat(gasMatch[1]) : (baseIntent.constraints?.maxGasGwei ?? null),
    allowedChains: entities.network ? [entities.network] : ['ethereum', 'arbitrum', 'polygon', 'solana'],
    preferredVenue: entities.venue || null
  };

  // Extract conditional strategy
  let conditionalStrategy = null;
  const conditionMatch = norm.match(/(?:if|اگر|هنگامی که|چنانچه)\s*(?:قیمت|price)?\s*([a-zA-Z0-9\u0600-\u06FF]+)?\s*(?:به|reached|hits|is|equals|>=|<=|>|<)\s*(\d+(?:\.\d+)?)/i);
  if (conditionMatch || norm.includes('اگر') || norm.includes('if')) {
    const targetPrice = conditionMatch ? parseFloat(conditionMatch[2]) : (norm.match(/(\d{4,})/)?.[1] ? parseFloat(norm.match(/(\d{4,})/)[1]) : null);
    conditionalStrategy = {
      condition: 'PRICE_TRIGGER',
      targetPrice,
      action: primaryIntent === 'BUY' || norm.includes('بخر') || norm.includes('buy') ? 'BUY' : 'SELL'
    };
  }

  // Extract timeframe
  let timeframe = { horizonDays: null, frequency: null, duration: null };
  const monthMatch = norm.match(/(\d+)\s*(?:month|months|ماه)/i);
  const weekMatch = norm.match(/(\d+)\s*(?:week|weeks|هفته)/i);
  const dayMatch = norm.match(/(\d+)\s*(?:day|days|روز)/i);
  if (monthMatch) {
    timeframe.horizonDays = parseInt(monthMatch[1], 10) * 30;
  } else if (weekMatch) {
    timeframe.horizonDays = parseInt(weekMatch[1], 10) * 7;
  } else if (dayMatch) {
    timeframe.horizonDays = parseInt(dayMatch[1], 10);
  }

  // Extract risk preference
  let riskTolerance = 'MEDIUM';
  if (/low\s*risk|کم\s*ریسک|بدون\s*ریسک|ریسک\s*نکن|محافظه‌کار/i.test(norm)) {
    riskTolerance = 'LOW';
  } else if (/high\s*risk|پر\s*ریسک|ریسک\s*بالا|اهرم|leverage/i.test(norm)) {
    riskTolerance = 'HIGH';
  }

  const riskPreference = {
    riskTolerance,
    maxDrawdownPercent: riskTolerance === 'LOW' ? 5 : riskTolerance === 'HIGH' ? 30 : 15,
    preferProtected: riskTolerance === 'LOW'
  };

  // Implicit intents
  const implicitIntents = [];
  if (primaryIntent === 'SWAP' || primaryIntent === 'BUY' || primaryIntent === 'SELL' || slang.relativePercentage !== null) {
    implicitIntents.push('CHECK_BALANCE');
  }
  if (primaryIntent === 'SWAP' || primaryIntent === 'BRIDGE') {
    implicitIntents.push('CHECK_GAS_ESTIMATE');
  }

  return {
    primaryIntent,
    subIntents: baseIntent.subIntents || [],
    goal: baseIntent.goal || null,
    constraints,
    relativeAmount: {
      isRelative: slang.relativePercentage !== null,
      percentage: slang.relativePercentage,
      baseUnit: entities.fromToken || entities.token || 'portfolio'
    },
    implicitIntents,
    conditionalStrategy,
    timeframe,
    riskPreference,
    urgency: {
      priority: norm.includes('سریع') || norm.includes('fast') || norm.includes('urgent') ? 'HIGH' : 'NORMAL',
      deadline: null
    },
    entities: {
      ...entities,
      amount: slang.parsedAmount || entities.amount || baseIntent.entities?.amount || null,
      ...(baseIntent.entities || {})
    }
  };
}

export function determineMinimalClarification(intent = {}, context = {}) {
  const primaryIntent = intent.primaryIntent || intent.type || 'GENERAL';
  const entities = intent.entities || {};
  const missing = intent.missingFields || [];

  if (['SWAP', 'BUY', 'SELL'].includes(primaryIntent)) {
    if (!entities.tokenIn && !entities.fromToken && missing.includes('tokenIn')) {
      return {
        priority: 'EXECUTION',
        field: 'tokenIn',
        question: 'Which token would you like to swap from?',
        fa: 'از کدام توکن می‌خواهید تبدیل را انجام دهید؟',
        en: 'Which token would you like to swap from?'
      };
    }
    if (!entities.tokenOut && !entities.toToken && missing.includes('tokenOut')) {
      return {
        priority: 'EXECUTION',
        field: 'tokenOut',
        question: 'Which token would you like to receive?',
        fa: 'کدام ارز را می‌خواهید دریافت کنید؟',
        en: 'Which token would you like to receive?'
      };
    }
    if (!entities.amount && !entities.amountUsd && !entities.amountPct && missing.includes('amount')) {
      return {
        priority: 'FINANCIAL',
        field: 'amount',
        question: 'How much would you like to swap?',
        fa: 'چه مقدار می‌خواهید تبدیل کنید؟',
        en: 'How much would you like to swap?'
      };
    }
  }

  if (primaryIntent === 'SEND') {
    if (!entities.recipient && missing.includes('recipient')) {
      return {
        priority: 'SAFETY',
        field: 'recipient',
        question: 'What is the recipient address?',
        fa: 'آدرس گیرنده را مشخص کنید.',
        en: 'What is the recipient address?'
      };
    }
    if (!entities.token && missing.includes('token')) {
      return {
        priority: 'EXECUTION',
        field: 'token',
        question: 'Which token do you want to send?',
        fa: 'کدام توکن را می‌خواهید ارسال کنید؟',
        en: 'Which token do you want to send?'
      };
    }
  }

  if (missing.length > 0) {
    const f = missing[0];
    return {
      priority: 'OPTIONAL',
      field: f,
      question: `Please specify ${f}.`,
      fa: `لطفاً ${f} را مشخص کنید.`,
      en: `Please specify ${f}.`
    };
  }

  return null;
}

export function detectCorrectionOrConflict(text, session = null) {
  const isCorr = detectUserCorrection(text, session);
  const isConf = detectConflict(text);
  return {
    isCorrection: isCorr.isCorrection,
    isConflict: isConf.isConflict,
    details: isCorr.isCorrection ? isCorr : isConf
  };
}
