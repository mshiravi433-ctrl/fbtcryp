/**
 * FBT INTENT AI — CROSS-ASSET INSTRUMENT REGISTRY (Phase 217).
 * ---------------------------------------------------------------------------
 * The AI's asset vocabulary used to be crypto-only: `resolveAsset('طلا')`
 * returned null, a monitor on gold was `UNKNOWN_ASSET`, and «اگر طلا ۵٪ اصلاح
 * کرد» could not become an intent because the thing being conditioned on did
 * not exist to the parser. RWA / stocks / forex / commodities / etf / funds
 * had PAGES; they had no place in the language layer.
 *
 * This module is that place. It is deliberately dumb and deliberately finite:
 * a table of instruments the app can actually READ, each with
 *
 *   · symbol      the canonical name every downstream contract uses
 *   · assetClass  one of the six TRADITIONAL_CLASSES, or `crypto`
 *   · aliases     the words a real person types, fa / en / ar
 *   · read        WHERE a live price can come from — never "somewhere"
 *
 * THE READ CONTRACT
 *   An instrument whose `read.kind` is `unreadable` has NO feed in this
 *   deployment. That is not a bug to paper over: it is the honest value, and
 *   it is what lets the conditional engine refuse instead of simulate. Every
 *   other kind names the exact module that must answer.
 *
 *   crypto   providers.fetchSimplePrices([coinId])
 *   macro    server/macroData.js — MACRO_SYMBOLS (keyless: stooq → yahoo → fred)
 *   global   the global-intel domain (stocks / forex / commodities / rwa),
 *            read THROUGH the brain (Avantis equities, Ostium FX/metals)
 *   unreadable  no feed wired; a condition on it is refused, not invented
 *
 * Nothing here signs, quotes a fee, or invents a price. It is a lexicon with
 * a source attached to every word.
 */

/** The six traditional classes `instrumentOf` recognises, plus crypto. */
export const CROSS_ASSET_CLASSES = Object.freeze([
  'crypto', 'etf', 'funds', 'stocks', 'forex', 'commodities', 'rwa'
]);

/** Classes that are NOT crypto — the ones this phase makes AI-native. */
export const TRADITIONAL_INSTRUMENT_CLASSES = Object.freeze([
  'etf', 'funds', 'stocks', 'forex', 'commodities', 'rwa'
]);

export const INSTRUMENT_SCHEMA = 'fbt.cross-asset-instrument.v1';

/* ══════════════════ the table ════════════════════════════════════════════ */
/* `read` is the whole point of the file: an instrument the app cannot price
   is an instrument a condition must refuse. Keep it per-row, keep it honest. */

const R = Object.freeze({
  crypto: (coinId) => ({ kind: 'crypto', coinId }),
  macro: (symbol) => ({ kind: 'macro', symbol }),
  global: (domain, category = null) => ({ kind: 'global', domain, category }),
  none: (reason) => ({ kind: 'unreadable', reason })
});

export const INSTRUMENTS = Object.freeze([
  /* ─── commodities ─────────────────────────────────────────────────────── */
  {
    symbol: 'GOLD', assetClass: 'commodities', unit: 'USD/oz',
    name: { en: 'Gold', fa: 'طلا', ar: 'الذهب' },
    aliases: ['gold', 'xau', 'spot gold', 'gold spot', 'gold ounce',
      'طلا', 'طلای جهانی', 'انس طلا', 'انس', 'اونس طلا', 'اونس', 'زر', 'طلای آبشده',
      'ذهب', 'سکه طلا'],
    read: R.macro('GOLD'), alsoRead: R.global('commodities', 'commodities')
  },
  {
    symbol: 'SILVER', assetClass: 'commodities', unit: 'USD/oz',
    name: { en: 'Silver', fa: 'نقره', ar: 'الفضة' },
    aliases: ['silver', 'xag', 'spot silver',
      'نقره', 'انس نقره', 'اونس نقره',
      'فضة'],
    read: R.global('commodities', 'commodities')
  },
  {
    symbol: 'WTI', assetClass: 'commodities', unit: 'USD/bbl',
    name: { en: 'WTI Crude', fa: 'نفت خام WTI', ar: 'النفط' },
    aliases: ['wti', 'crude', 'crude oil', 'oil', 'cl',
      'نفت', 'نفت خام', 'نفت وست تگزاس'],
    read: R.macro('WTI'), alsoRead: R.global('commodities', 'commodities')
  },
  {
    symbol: 'BRENT', assetClass: 'commodities', unit: 'USD/bbl',
    name: { en: 'Brent Crude', fa: 'نفت برنت', ar: 'نفط برنت' },
    aliases: ['brent', 'brent crude', 'brn',
      'برنت', 'نفت برنت'],
    read: R.global('commodities', 'commodities')
  },
  {
    symbol: 'COPPER', assetClass: 'commodities', unit: 'USD/lb',
    name: { en: 'Copper', fa: 'مس', ar: 'النحاس' },
    aliases: ['copper', 'hg', 'مس', 'نحاس'],
    read: R.global('commodities', 'commodities')
  },

  /* ─── stocks ──────────────────────────────────────────────────────────── */
  {
    symbol: 'SPX', assetClass: 'stocks', unit: 'index', kind: 'index',
    name: { en: 'S&P 500', fa: 'شاخص S&P 500', ar: 'إس آند بي 500' },
    aliases: ['spx', 'sp500', 's&p 500', 's&p500', 's and p', 's&p', 'sp 500',
      'اس اند پی', 'اس‌اند‌پی', 'شاخص اس اند پی', 'بورس آمریکا', 's&p 500 futures'],
    read: R.macro('SPX')
  },
  {
    symbol: 'NDX', assetClass: 'stocks', unit: 'index', kind: 'index',
    name: { en: 'Nasdaq 100', fa: 'شاخص نزدک', ar: 'ناسداك' },
    aliases: ['ndx', 'nasdaq', 'nasdaq 100', 'نزدک', 'ناسداک', 'نزدک ۱۰۰'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'AAPL', assetClass: 'stocks', unit: 'USD',
    name: { en: 'Apple', fa: 'اپل', ar: 'أبل' },
    aliases: ['aapl', 'apple', 'اپل', 'سهام اپل', 'تفاح'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'TSLA', assetClass: 'stocks', unit: 'USD',
    name: { en: 'Tesla', fa: 'تسلا', ar: 'تسلا' },
    aliases: ['tsla', 'tesla', 'تسلا', 'سهام تسلا'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'MSFT', assetClass: 'stocks', unit: 'USD',
    name: { en: 'Microsoft', fa: 'مایکروسافت', ar: 'مايكروسوفت' },
    aliases: ['msft', 'microsoft', 'مایکروسافت', 'مايكروسوفت'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'NVDA', assetClass: 'stocks', unit: 'USD',
    name: { en: 'NVIDIA', fa: 'انویدیا', ar: 'إنفيديا' },
    aliases: ['nvda', 'nvidia', 'انویدیا', 'انودیا', 'نویدیا'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'GOOGL', assetClass: 'stocks', unit: 'USD',
    name: { en: 'Alphabet / Google', fa: 'گوگل', ar: 'جوجل' },
    aliases: ['googl', 'goog', 'google', 'alphabet', 'گوگل', 'الفابت'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'AMZN', assetClass: 'stocks', unit: 'USD',
    name: { en: 'Amazon', fa: 'آمازون', ar: 'أمازون' },
    aliases: ['amzn', 'amazon', 'آمازون', 'امازون'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'META', assetClass: 'stocks', unit: 'USD',
    name: { en: 'Meta', fa: 'متا', ar: 'ميتا' },
    aliases: ['meta', 'facebook', 'متا', 'فیسبوک', 'فیس بوک'],
    read: R.global('stocks', 'stocks')
  },

  /* ─── forex ───────────────────────────────────────────────────────────── */
  {
    symbol: 'DXY', assetClass: 'forex', unit: 'index', kind: 'index',
    name: { en: 'US Dollar Index', fa: 'شاخص دلار', ar: 'مؤشر الدولار' },
    aliases: ['dxy', 'dx.f', 'dollar index', 'usd index', 'dx',
      'شاخص دلار', 'دلار ایندکس', 'ایندکس دلار', 'شاخص dxy'],
    read: R.macro('DXY')
  },
  {
    symbol: 'EURUSD', assetClass: 'forex', unit: 'rate',
    name: { en: 'EUR/USD', fa: 'یورو به دلار', ar: 'اليورو دولار' },
    aliases: ['eurusd', 'eur/usd', 'euro dollar', 'euro',
      'یورو', 'یورو به دلار', 'یورو دلار', 'جفت ارز یورو'],
    read: R.global('forex', 'forex')
  },
  {
    symbol: 'GBPUSD', assetClass: 'forex', unit: 'rate',
    name: { en: 'GBP/USD', fa: 'پوند به دلار', ar: 'الجنيه دولار' },
    aliases: ['gbpusd', 'gbp/usd', 'cable', 'sterling',
      'پوند', 'پوند به دلار', 'پوند دلار'],
    read: R.global('forex', 'forex')
  },
  {
    symbol: 'USDJPY', assetClass: 'forex', unit: 'rate',
    name: { en: 'USD/JPY', fa: 'دلار به ین', ar: 'الدولار ين' },
    aliases: ['usdjpy', 'usd/jpy', 'yen',
      'ین', 'ین ژاپن', 'دلار به ین', 'دلار ین'],
    read: R.global('forex', 'forex')
  },

  /* ─── RWA (tokenised real-world assets) ───────────────────────────────── */
  {
    symbol: 'RWA', assetClass: 'rwa', unit: 'USD',
    name: { en: 'Tokenised real-world assets', fa: 'دارایی‌های دنیای واقعی', ar: 'أصول العالم الحقيقي' },
    aliases: ['rwa', 'real world asset', 'real-world asset', 'realworld', 'rwa basket',
      'دارایی دنیای واقعی', 'دارایی واقعی', 'توکنایز', 'توکنیزه',
      'real? world'],
    read: R.global('rwa', 'rwa')
  },
  {
    symbol: 'TREAS', assetClass: 'rwa', unit: 'USD',
    name: { en: 'Tokenised treasuries', fa: 'خزانه‌داری توکنایز‌شده', ar: 'خزانة مرمزة' },
    aliases: ['tokenized treasury', 'tokenised treasury', 'treasury token', 'tbil', 'buidl',
      'خزانه توکنایز', 'اوراق خزانه توکنایز', 'اوراق قرضه توکنایز'],
    read: R.global('rwa', 'rwa')
  },
  {
    symbol: 'REALT', assetClass: 'rwa', unit: 'USD',
    name: { en: 'Tokenised real estate', fa: 'املاک توکنایز‌شده', ar: 'عقارات مرمزة' },
    aliases: ['tokenized real estate', 'tokenised real estate', 'realty', 'property token',
      'املاک', 'ملک', 'عقار', 'املاک توکنایز', 'ملک توکنایز'],
    read: R.global('rwa', 'rwa')
  },

  /* ─── ETF ─────────────────────────────────────────────────────────────── */
  {
    symbol: 'SPY', assetClass: 'etf', unit: 'USD',
    name: { en: 'SPDR S&P 500 ETF', fa: 'صندوق SPY', ar: 'صندوق SPY' },
    aliases: ['spy', 'spdr', 's&p 500 etf', 'etf اس اند پی'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'QQQ', assetClass: 'etf', unit: 'USD',
    name: { en: 'Invesco QQQ ETF', fa: 'صندوق QQQ', ar: 'صندوق QQQ' },
    aliases: ['qqq', 'nasdaq etf', 'etf نزدک'],
    read: R.global('stocks', 'stocks')
  },
  {
    symbol: 'GLD', assetClass: 'etf', unit: 'USD',
    name: { en: 'Gold ETF', fa: 'صندوق طلا', ar: 'صندوق الذهب' },
    aliases: ['gld', 'gold etf', 'etf طلا', 'صندوق طلا', 'طلای صندوقی'],
    read: R.none('NO_ETF_FEED')
  },
  {
    symbol: 'SLV', assetClass: 'etf', unit: 'USD',
    name: { en: 'Silver ETF', fa: 'صندوق نقره', ar: 'صندوق الفضة' },
    aliases: ['slv', 'silver etf', 'etf نقره', 'صندوق نقره'],
    read: R.none('NO_ETF_FEED')
  },
  {
    symbol: 'TLT', assetClass: 'etf', unit: 'USD',
    name: { en: '20+ Year Treasury ETF', fa: 'صندوق اوراق خزانه', ar: 'صندوق سندات الخزانة' },
    aliases: ['tlt', 'treasury etf', 'etf اوراق'],
    read: R.none('NO_ETF_FEED')
  },

  /* ─── funds ───────────────────────────────────────────────────────────── */
  {
    symbol: 'MMF', assetClass: 'funds', unit: 'USD',
    name: { en: 'Money-market fund', fa: 'صندوق درآمد ثابت', ar: 'صندوق السوق النقدي' },
    aliases: ['mmf', 'money market', 'money market fund',
      'صندوق درآمد ثابت', 'صندوق سرمایه گذاری', 'صندوق سرمایه‌گذاری', 'صندوق نقدی'],
    read: R.none('NO_FUNDS_FEED')
  },

  /* ─── crypto (the same vocabulary the swap rails already use) ─────────── */
  { symbol: 'BTC', assetClass: 'crypto', unit: 'USD', name: { en: 'Bitcoin', fa: 'بیت‌کوین', ar: 'بيتكوين' },
    aliases: ['btc', 'bitcoin', 'xbt', 'بیت کوین', 'بیتکوین', 'بیت‌کوین', 'بيتكوين', 'بٹ کوائن'], read: R.crypto('bitcoin') },
  { symbol: 'ETH', assetClass: 'crypto', unit: 'USD', name: { en: 'Ethereum', fa: 'اتریوم', ar: 'إيثيريوم' },
    aliases: ['eth', 'ethereum', 'ether', 'اتریوم', 'اتریوم', 'إيثيريوم'], read: R.crypto('ethereum') },
  { symbol: 'SOL', assetClass: 'crypto', unit: 'USD', name: { en: 'Solana', fa: 'سولانا', ar: 'سولانا' },
    aliases: ['sol', 'solana', 'سولانا'], read: R.crypto('solana') },
  { symbol: 'USDC', assetClass: 'crypto', unit: 'USD', name: { en: 'USD Coin', fa: 'یو‌اس‌دی‌سی', ar: 'يو إس دي سي' },
    aliases: ['usdc', 'usd coin', 'یو اس دی سی'], read: R.crypto('usd-coin') },
  { symbol: 'USDT', assetClass: 'crypto', unit: 'USD', name: { en: 'Tether', fa: 'تتر', ar: 'تيثر' },
    aliases: ['usdt', 'tether', 'تتر'], read: R.crypto('tether') },
  { symbol: 'XRP', assetClass: 'crypto', unit: 'USD', name: { en: 'XRP', fa: 'ریپل', ar: 'ريبل' },
    aliases: ['xrp', 'ripple', 'ریپل'], read: R.crypto('ripple') },
  { symbol: 'BNB', assetClass: 'crypto', unit: 'USD', name: { en: 'BNB', fa: 'بی‌ان‌بی', ar: 'بي ان بي' },
    aliases: ['bnb', 'binance coin'], read: R.crypto('binancecoin') },
  { symbol: 'PAXG', assetClass: 'crypto', unit: 'USD', name: { en: 'PAX Gold', fa: 'پکس گلد', ar: 'باكس جولد' },
    aliases: ['paxg', 'pax gold', 'پکس گلد'], read: R.crypto('pax-gold') },
  { symbol: 'XAUT', assetClass: 'crypto', unit: 'USD', name: { en: 'Tether Gold', fa: 'تتر گلد', ar: 'تيثر جولد' },
    aliases: ['xaut', 'tether gold', 'تتر گلد'], read: R.crypto('tether-gold') }
]);

/* ══════════════════ the index ════════════════════════════════════════════ */

const ALIAS_INDEX = new Map();
for (const inst of INSTRUMENTS) {
  for (const alias of [inst.symbol.toLowerCase(), ...inst.aliases.map((a) => String(a).toLowerCase())]) {
    if (!alias) continue;
    /* First writer wins, and the table is ordered: the specific instrument
       («انس طلا») must not be stolen by the generic one («طلا»). */
    if (!ALIAS_INDEX.has(alias)) ALIAS_INDEX.set(alias, inst.symbol);
  }
}
const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
/** Longest first, so «طلا» never shadows «انس طلا». */
const ALIAS_BY_LENGTH = [...ALIAS_INDEX.keys()].sort((a, b) => b.length - a.length);

/** The row for a canonical symbol, or null. Never a guess. */
export function instrumentFor(symbol) {
  return BY_SYMBOL.get(String(symbol || '').toUpperCase()) || null;
}

/** The class of a canonical symbol, or null when the symbol is unknown. */
export function classOf(symbol) {
  return instrumentFor(symbol)?.assetClass || null;
}

/** Every instrument of one class. */
export function instrumentsInClass(assetClass) {
  const key = String(assetClass || '').toLowerCase();
  return INSTRUMENTS.filter((i) => i.assetClass === key);
}

/** True when a live read exists for this instrument in this deployment. */
export function isReadable(symbol) {
  return instrumentFor(symbol)?.read?.kind !== 'unreadable';
}

/**
 * Resolve ONE token to an instrument. Exact alias first, then the longest
 * alias contained in the token. Returns null rather than a guess — an
 * invented asset is the most expensive mistake this layer can make.
 */
export function resolveInstrumentToken(token) {
  const key = String(token || '').trim().toLowerCase();
  if (key.length < 2) return null;
  const exact = ALIAS_INDEX.get(key);
  if (exact) return { symbol: exact, via: 'alias' };
  const hit = ALIAS_BY_LENGTH.find((a) => a.length >= 3 && key.includes(a));
  if (hit) return { symbol: ALIAS_INDEX.get(hit), via: 'contains', alias: hit };
  return null;
}

/**
 * Every instrument named in a text, in the order they appear, with the
 * matched span so a parser can tell the condition's asset from the action's
 * target («اگر طلا اصلاح کرد … به طلا اختصاص بده» names GOLD twice, and only
 * the position says which is which).
 *
 * Returns [] when the text names nothing. Multi-word aliases win over the
 * single words inside them.
 */
export function findInstruments(text, { limit = 8 } = {}) {
  const hay = normalizeForMatch(text);
  const found = [];
  const taken = [];
  for (const alias of ALIAS_BY_LENGTH) {
    if (alias.length < 2) continue;
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(alias, from);
      if (idx < 0) break;
      from = idx + alias.length;
      /* Word-boundary check so «oil» does not fire inside «boiler». */
      if (!isBoundary(hay, idx, alias.length)) continue;
      if (taken.some(([s, e]) => idx < e && idx + alias.length > s)) continue;
      const symbol = ALIAS_INDEX.get(alias);
      taken.push([idx, idx + alias.length]);
      found.push({ symbol, alias, start: idx, end: idx + alias.length, ...instrumentFor(symbol) });
      if (found.length >= limit) return sortByStart(found);
    }
  }
  return sortByStart(found);
}

const sortByStart = (rows) => rows.sort((a, b) => a.start - b.start);

/** True when `[i, i+len)` sits on token boundaries in `hay`. */
function isBoundary(hay, i, len) {
  const before = i === 0 ? ' ' : hay[i - 1];
  const after = i + len >= hay.length ? ' ' : hay[i + len];
  const boundary = new Set([' ', '.', ',', ';', ':', '!', '?', '؟', '،', '«', '»', '(', ')', '/', '"', "'", '\n', '\t', '%']);
  if (!boundary.has(before) && !/[\p{N}]/u.test(before)) return false;
  if (!boundary.has(after) && !/[\p{N}]/u.test(after)) return false;
  return true;
}

/**
 * The normaliser the whole cross-asset parser shares. Two differences from
 * `softNormalize` next door, both load-bearing here:
 *   · `%` and `$` SURVIVE — «۵٪ اصلاح کرد» and «$2000» are the numbers this
 *     feature is about, and normalising them away would erase the condition;
 *   · digits are folded to ASCII, because «۵٪» is how most users type it.
 */
export function normalizeForMatch(text) {
  let out = String(text ?? '');
  const maps = ['۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩', '०१२३४५६७८९'];
  for (const digits of maps) {
    for (let i = 0; i < 10; i += 1) out = out.split(digits[i]).join(String(i));
  }
  return out
    .toLowerCase()
    /* The percent signs first: «۵٪» is how the condition is typed, and the
       catch-all strip below would otherwise delete the mark and leave a bare
       number with no way to tell «۵٪ اصلاح» from «۵۰۰۰ دلار». */
    .replace(/[٪﹪％]/g, '%')
    .replace(/[\u066B]/g, '.')
    .replace(/[\u066C]/g, '')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[\u200f\u200e]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[^\p{L}\p{N}%$ ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where a live read must come from, for the engine (never "somewhere"). */
export function readPlanFor(symbol) {
  const inst = instrumentFor(symbol);
  if (!inst) return null;
  const chain = [inst.read, inst.alsoRead].filter(Boolean);
  return {
    symbol: inst.symbol,
    assetClass: inst.assetClass,
    chain,
    readable: chain.some((c) => c.kind !== 'unreadable')
  };
}
