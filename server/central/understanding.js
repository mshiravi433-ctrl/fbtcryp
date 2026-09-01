/**
 * FBT CENTRAL INTELLIGENCE OS — Understanding Engine.
 * ---------------------------------------------------------------------------
 * UNDERSTAND is step one of the ultimate rule (§44). Classification is
 * deterministic and bilingual (FA/EN): rules first, so the brain never
 * depends on an LLM being alive. If an LLM provider IS configured it may
 * refine low-confidence classifications, but it can only CHANGE the type,
 * never invent entities — entities always come from the parser or the real
 * state (§3: the LLM reasons, the services are the source of truth).
 */

export const INTENT_TYPES = Object.freeze([
  'PORTFOLIO_ANALYSIS', 'CONCENTRATION_CHECK', 'SWAP', 'BRIDGE',
  'SWAP_AND_BRIDGE', 'LEND', 'BORROW', 'REPAY', 'LOAN_SAFETY',
  'FUTURES_OPEN', 'FUTURES_CLOSE', 'DYDX_ORDER', 'SELL', 'BUY',
  'GOAL_CREATE', 'GOAL_PROGRESS', 'WHAT_IF', 'MARKET_OVERVIEW',
  'NEWS_BRIEF', 'SIGNALS_BRIEF', 'RISK_REVIEW', 'REBALANCE', 'NAVIGATION',
  'TRANSACTION_STATUS', 'GENERIC'
]);

const KNOWN_ASSETS = ['BTC', 'ETH', 'USDC', 'USDT', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRX', 'TON', 'WBTC', 'WETH', 'DAI', 'FBT'];
const ASSET_ALIASES = {
  بیتکوین: 'BTC', 'بیت‌کوین': 'BTC', 'بیت کوین': 'BTC', 'بیت‌ کوین': 'BTC', bitcoin: 'BTC', btc: 'BTC',
  اتریوم: 'ETH', ethereum: 'ETH', eth: 'ETH',
  سولانا: 'SOL', solana: 'SOL', sol: 'SOL',
  تتر: 'USDT', usdt: 'USDT',
  یواسدسی: 'USDC', usdc: 'USDC',
  بایننس: 'BNB', bnb: 'BNB',
  دوج: 'DOGE', doge: 'DOGE'
};
const NETWORK_ALIASES = {
  ethereum: 'ethereum', اتریوم: 'ethereum', mainnet: 'ethereum',
  arbitrum: 'arbitrum', آربیتروم: 'arbitrum',
  polygon: 'polygon', پالیگان: 'polygon',
  optimism: 'optimism', آپتیمیزم: 'optimism',
  base: 'base', بیس: 'base',
  bsc: 'bsc', binance: 'bsc',
  solana: 'solana', ترون: 'tron', tron: 'tron'
};

const FA_NUM = '۰۱۲۳۴۵۶۷۸۹';
const toEnDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => String(FA_NUM.indexOf(d)));

const PERSIAN_UNITS = { هزار: 1e3, میلیون: 1e6, 'میلیون دلار': 1e6, میلیارد: 1e9, thousand: 1e3, million: 1e6, k: 1e3 };

function extractAmount(text) {
  const t = toEnDigits(text);
  // "$500" / "500 دلار" / "500 USD"
  let m = t.match(/\$\s?([\d,]+(?:\.\d+)?)/i) || t.match(/([\d,]+(?:\.\d+)?)\s*(?:دلار|دل|usd|usdt|dollar)/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  // "500 هزار دلار" / "2 میلیون"
  m = t.match(/([\d,]+(?:\.\d+)?)\s*(هزار|میلیون|میلیارد|thousand|million|k)\b/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    const mult = PERSIAN_UNITS[m[2].toLowerCase()] || PERSIAN_UNITS[m[2]] || 1;
    if (Number.isFinite(n)) return n * mult;
  }
  return null;
}

function extractPercent(text) {
  const t = toEnDigits(text);
  const m = t.match(/([\d.]+)\s*(?:٪|%|درصد|percent)/i);
  return m ? Number(m[1]) : null;
}

function extractAsset(text) {
  const raw = String(text || '');
  const t = raw.toLowerCase();
  /* Latin symbols: pick the EARLIEST word-boundary occurrence so
     "USDC را به ETH تبدیل کن" yields the source asset (USDC), not the
     target. Aliases can't be trusted with ordering (eth ⊂ "usdc" scans). */
  let best = null;
  for (const sym of KNOWN_ASSETS) {
    const re = new RegExp(`(^|[^a-z0-9])${sym.toLowerCase()}($|[^a-z0-9])`, 'i');
    const m = t.match(re);
    if (m && (best == null || m.index < best.index)) best = { sym, index: m.index };
  }
  if (best) return best.sym;
  /* Persian / long-form aliases. */
  for (const [alias, symbol] of Object.entries(ASSET_ALIASES)) {
    if (t.includes(alias.toLowerCase())) return symbol;
  }
  return null;
}

function extractNetwork(text) {
  const t = String(text || '').toLowerCase();
  for (const [alias, net] of Object.entries(NETWORK_ALIASES)) {
    if (t.includes(alias)) return net;
  }
  return null;
}

/** Deterministic bilingual classifier. Order matters: most specific first. */
export function classifyMessage(message) {
  const t = toEnDigits(String(message || '')).toLowerCase();
  const has = (...pats) => pats.some((p) => (p instanceof RegExp ? p.test(t) : t.includes(p)));

  if (has('وامم چقدر امن', 'وامم امن', 'امنیت وام', 'loan safety', 'how safe is my loan', 'وامم چطوره', 'وضعیت وام', 'وضعیت وامم', 'health factor', 'سلامت وام'))
    return 'LOAN_SAFETY';
  if (has('بگیرم؟', 'چقدر می‌توانم بگیرم', 'چقدر میتونم بگیرم', 'وام بگیرم', 'استقراض', 'borrow', 'قرض گرفتن'))
    return 'BORROW';
  if (has('بازپرداخت', 'پس بدهم', 'پس دادن وام', 'repay', 'قسط'))
    return 'REPAY';
  if (has('سود سپرده', 'لند کنم', 'سپرده‌گذاری', 'سپرده گذاری', 'لند', 'lend', 'earn interest', 'سود دیفای'))
    return 'LEND';
  if (has('اگر', 'بریزد', 'ب ریزد', 'بالا برود', 'چه می‌شود', 'شبیه‌سازی', 'what if', 'if btc', 'سناریو', 'فرض کن'))
    if (has('بریزد', 'بالا برود', 'چه می‌شود', 'what if', 'if btc', 'سناریو', 'اگر'))
      return 'WHAT_IF';
  /* Trade verbs MUST outrank review verbs: "USDC را به ETH تبدیل کن" also
     contains "بررسی"-adjacent words in natural sentences, and the wrong
     order would turn a swap into a portfolio read. */
  if (has('به', 'تبدیل', 'سواپ', 'خرید', 'بخر', 'فروش', 'بفروش', 'مبادله', 'خریدن', 'فروختن', 'بخرم', 'بفروشم', 'بده', 'بریز به', 'تبدیل کن', 'کن به', 'بفرست', 'ارسال کن', 'انتقال بده', 'واریز کن', 'send', 'transfer')) {
    const bridge = has('آربیتروم', 'arbitrum', 'پل', 'بریج', 'انتقال به', 'ببر', 'به زنجیر', 'bridge', 'به base', 'به polygon', 'به optimism', 'به bsc', 'به ترون');
    const swap = has('تبدیل', 'سواپ', 'خرید', 'بخر', 'فروش', 'بفروش', 'مبادله', 'خریدن', 'فروختن', 'بخرم', 'بفروشم', 'بده', 'کن به', 'تبدیل کن');
    if (bridge && swap) return 'SWAP_AND_BRIDGE';
    if (bridge) return 'BRIDGE';
    if (has('بفروشم', 'بفروش', 'فروختن', 'فروش', 'خارج بشم', 'خارجش', 'بده', 'خارج کن', 'sell', 'خارج شدن')) return 'SELL';
    if (has('بفرست', 'ارسال کن', 'انتقال بده', 'واریز کن', 'send', 'transfer')) return 'SWAP'; // SEND flows through swap/bridge rails
    if (has('بخرم', 'بخر', 'خریدن', 'خرید', 'اضافه کن', 'بگیر', 'خریدش', 'buy', 'بگیرم')) return 'BUY';
    if (swap) return 'SWAP';
  }
  if (has('زیاد دارم', 'تمرکز', 'خیلی دارم', 'بیش از حد', 'too much', 'concentration', 'overexposed'))
    return 'CONCENTRATION_CHECK';
  if (has('پرتفوی', 'پرتفوی من', 'سبد', 'دارایی‌هام', 'دارایی هام', 'بررسی کن', 'portfolio', 'وضعیت دارایی', 'دارایی‌های من'))
    return 'PORTFOLIO_ANALYSIS';
  if (has('هدف', 'به ۱۰۰', 'به 100', 'می‌خواهم برس', 'میخواهم برس', 'هدفم', 'goal')) {
    return has('پیشرفت', 'چقدر نزدیک', 'وضعیت هدف', 'progress') ? 'GOAL_PROGRESS' : 'GOAL_CREATE';
  }
  if (has('فیوچرز', 'آتی', 'پوزیشن', 'لوریج', 'اهرم', 'futures', 'perp'))
    return has('بستن', 'ببند', 'خارج', 'close') ? 'FUTURES_CLOSE' : 'FUTURES_OPEN';
  if (has('dydx', 'دای‌دکس', 'دای دکس', 'اردر')) return 'DYDX_ORDER';
  if (has('سیگنال', 'سیگنال‌ها', 'سیگنالها', 'سیگنالی', 'سیگنال بده', 'سیگنال بازار', 'سیگنال داریم', 'سیگنالی هست', 'سیگنا', 'سیگنالی برای', 'سیگنال‌های')) return 'SIGNALS_BRIEF';
  if (has('اخبار', 'خبر', 'چه خبر', 'تحلیل خبری', 'تیتر', 'news')) return 'NEWS_BRIEF';
  if (has('ریسک', 'ریسکم', 'کاهش ریسک', 'مدیریت ریسک', 'risk')) return 'RISK_REVIEW';
  if (has('ریبالانس', 'بهینه', 'ترکیب دارایی', 'rebalance', 'بهینه‌سازی')) return 'REBALANCE';
  if (has('بازار', 'قیمت', 'مارکت', 'نرخ', 'وضعیت بازار', 'market', 'قیمت‌ها', 'امروز بازار', 'نرخ بیت', 'قیمتش')) return 'MARKET_OVERVIEW';
  if (has('تراکنش', 'وضعیت تراکنش', 'تراکنشم', 'tx', 'transaction status', 'hash', 'هش تراکنش')) return 'TRANSACTION_STATUS';
  if (has('برو به', 'صفحه', 'باز کن', 'نمایش بده', 'بریم به', 'باز کردن', 'open ', 'navigate', 'go to')) return 'NAVIGATION';
  return 'GENERIC';
}

function extractRecipient(text) {
  const t = String(text || '');
  const m = t.match(/\b(0x[0-9a-fA-F]{20,80}|[1-9A-HJ-NP-Za-km-z]{20,60})\b/);
  if (!m) return null;
  // Avoid swallowing asset symbols / short words: recipients are long.
  return m[1].length >= 20 ? m[1] : null;
}

export function extractEntities(message) {
  return {
    asset: extractAsset(message),
    network: extractNetwork(message),
    amountUsd: extractAmount(message),
    percent: extractPercent(message),
    targetAsset: extractTargetAsset(message),
    recipient: extractRecipient(message)
  };
}

/** For "convert A to B" / "A را به B تبدیل کن": the second asset mentioned. */
function extractTargetAsset(message) {
  const t = toEnDigits(String(message || ''));
  const m = t.match(/(?:به|to|into)\s+([A-Za-z]{2,6})\b/i) || t.match(/تبدیل کن(?:\s+به)?\s+([A-Za-z]{2,6})/i);
  if (m) {
    const sym = m[1].toUpperCase();
    if (KNOWN_ASSETS.includes(sym)) return sym;
    const alias = ASSET_ALIASES[m[1].toLowerCase()];
    if (alias) return alias;
  }
  return null;
}

export function understanding(message) {
  const type = classifyMessage(message);
  const entities = extractEntities(message);
  return { type, entities, confidence: type === 'GENERIC' ? 0.3 : 0.85 };
}
