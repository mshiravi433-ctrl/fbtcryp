/**
 * OSTIUM OFFLINE FEED + ASSET KNOWLEDGE — the Global Horizon tab never dies.
 * ---------------------------------------------------------------------------
 * Two jobs live here:
 *
 *  1. OFFLINE FEED. The Ostium price feed and subgraph are public, but a
 *     deployment without egress (or a transient upstream outage) previously
 *     left the tab on a dead "feed unavailable" screen with nothing to press
 *     but retry. This snapshot of the real pair catalogue keeps every control
 *     alive, clearly labelled OFFLINE, and a deterministic demo series powers
 *     the chart so the screen still teaches the product while the feed is
 *     down. The moment the live feed returns it replaces this entirely.
 *
 *  2. ASSET KNOWLEDGE. Asked for: when a pair is selected, the page must
 *     explain what each leg IS — «XPD چیست؟ USD چیست؟» — in a popup. This is
 *     the bilingual lookup table behind that popup and the header strip.
 */

/* ═══════════════════════════════════════════════════════════════════════
   1. ASSET KNOWLEDGE — symbol → name + short description (fa/en)
   ═══════════════════════════════════════════════════════════════════════ */

export const ASSET_KNOWLEDGE = {
  /* ── Commodities ── */
  XAU: {
    fa: { name: 'طلای جهانی', desc: 'طلا (اونس) — فلز گرانبهایی که در طول تاریخ ارزش خود را حفظ کرده و در بازارهای پرنوسان به‌عنوان «پناهگاه امن» خریداری می‌شود. قیمت آن به دلار هر اونس اعلام می‌شود.' },
    en: { name: 'Gold', desc: 'Gold (troy ounce) — the classic safe-haven metal; its dollar price moves on inflation, real rates and geopolitical risk.' }
  },
  XAG: {
    fa: { name: 'نقره', desc: 'نقره (اونس) — فلز گرانبهای صنعتی؛ هم کاربرد جواهرات و هم کاربرد گسترده در صنعت (الکترونیک و انرژی خورشیدی) دارد و معمولاً نوسان بیشتری از طلا نشان می‌دهد.' },
    en: { name: 'Silver', desc: 'Silver (troy ounce) — a precious metal with heavy industrial use (electronics, solar); more volatile than gold.' }
  },
  XPD: {
    fa: { name: 'پالادیوم', desc: 'پالادیوم — فلز کمیاب و صنعتی که بخش بزرگ مصرف آن در کاتالیزورهای خودروهای بنزینی است. عرضهٔ محدود و تقاضای صنعتی، نوسان بالایی به آن می‌دهد.' },
    en: { name: 'Palladium', desc: 'Palladium — a scarce industrial metal, most of it used in petrol-car catalytic converters; tight supply makes it volatile.' }
  },
  XPT: {
    fa: { name: 'پلاتین', desc: 'پلاتین — فلز گرانبهای کمیاب؛ کاربرد اصلی آن کاتالیزور خودروهای دیزلی و جواهرات است و بخشی از تقاضای آن از صنعت هیدروژن و پیل‌های سوختی می‌آید.' },
    en: { name: 'Platinum', desc: 'Platinum — a rare precious metal used in diesel catalysts, jewellery and increasingly hydrogen fuel cells.' }
  },
  WTI: {
    fa: { name: 'نفت خام وست تگزاس', desc: 'نفت خام WTI — شاخص قیمت نفت آمریکا. قیمت آن تحت تأثیر اوپک، ذخایر آمریکا، تنش‌های ژئوپلیتیک و وضعیت اقتصاد جهانی است.' },
    en: { name: 'WTI Crude Oil', desc: 'West Texas Intermediate crude — the US oil benchmark, driven by OPEC policy, US inventories and geopolitics.' }
  },
  NGAS: {
    fa: { name: 'گاز طبیعی', desc: 'گاز طبیعی — سوخت فسیلی که قیمت آن به شدت فصلی است (زمستان = تقاضای گرمایش) و به‌شدت به آب‌وهوا و ذخایر آمریکا حساس است.' },
    en: { name: 'Natural Gas', desc: 'Natural gas — a seasonal, weather-driven fuel; US inventories and winter demand dominate its price.' }
  },
  COPPER: {
    fa: { name: 'مس', desc: 'مس — فلز صنعتی کلیدی که «دکتر مس» نامیده می‌شود چون وضعیت اقتصاد جهانی را زودتر از شاخص‌ها نشان می‌دهد؛ مصرف اصلی آن برق و ساختمان است.' },
    en: { name: 'Copper', desc: 'Copper — “Dr Copper”, the industrial metal whose price tracks global growth; used mainly in power and construction.' }
  },

  /* ── Forex ── */
  USD: {
    fa: { name: 'دلار آمریکا', desc: 'دلار آمریکا — ارز ذخیرهٔ جهان و طرف مقابل تقریباً همهٔ جفت‌ارزها و کالاها. قیمت آن با سیاست نرخ بهرهٔ فدرال رزرو (FED) تعیین می‌شود.' },
    en: { name: 'US Dollar', desc: 'The US dollar — the world’s reserve currency and the quote leg of most pairs here; driven by Federal Reserve policy.' }
  },
  EUR: {
    fa: { name: 'یورو', desc: 'یورو — ارز رسمی حوزهٔ یورو (۲۰ کشور اروپایی) و دومین ارز ذخیرهٔ جهان. سیاست آن از سوی بانک مرکزی اروپا (ECB) تعیین می‌شود.' },
    en: { name: 'Euro', desc: 'The euro — the single currency of the eurozone, the second reserve currency, steered by the ECB.' }
  },
  GBP: {
    fa: { name: 'پوند بریتانیا', desc: 'پوند استرلینگ — قدیمی‌ترین ارز فعال جهان؛ نوسان آن به سیاست بانک مرکزی انگلستان (BoE) و داده‌های اقتصاد بریتانیا گره خورده است.' },
    en: { name: 'British Pound', desc: 'Sterling — the oldest currency still traded; moves on Bank of England policy and UK data.' }
  },
  JPY: {
    fa: { name: 'ین ژاپن', desc: 'ین ژاپن — ارز سومین اقتصاد بزرگ جهان و معروف به «ارز امن» در بحران‌ها؛ نرخ بهرهٔ بسیار پایین آن سال‌ها آن را به منبع معاملات کَری (Carry) تبدیل کرده بود.' },
    en: { name: 'Japanese Yen', desc: 'The yen — a traditional funding and safe-haven currency; ultra-low BoJ rates made it the classic carry-trade leg.' }
  },
  CHF: {
    fa: { name: 'فرانک سوئیس', desc: 'فرانک سوئیس — ارز امن و باثبات؛ در بحران‌های جهانی سرمایه به سمت آن می‌آید. بانک ملی سوئیس در نوسان‌های شدید مداخله می‌کند.' },
    en: { name: 'Swiss Franc', desc: 'The franc — the classic safe-haven currency; the SNB intervenes when moves get extreme.' }
  },
  AUD: {
    fa: { name: 'دلار استرالیا', desc: 'دلار استرالیا — ارز صادرکنندهٔ بزرگ مواد اولیه (آهن، زغال و طلا)؛ به اقتصاد چین بسیار حساس است و «ارز کالایی» محسوب می‌شود.' },
    en: { name: 'Australian Dollar', desc: 'The Aussie — a commodity currency; as a big exporter of iron ore and coal it tracks China’s economy.' }
  },
  CAD: {
    fa: { name: 'دلار کانادا', desc: 'دلار کانادا — «لونی»؛ به نفت گره خورده چون کانادا صادرکنندهٔ بزرگ نفت به آمریکاست و اقتصاد دو کشور به هم وابسته‌اند.' },
    en: { name: 'Canadian Dollar', desc: 'The loonie — closely tied to oil: Canada is the largest crude exporter to the US.' }
  },
  NZD: {
    fa: { name: 'دلار نیوزیلند', desc: 'دلار نیوزیلند — «کیوی»؛ ارز کوچک و کالایی که به لبنیات و کشاورزی وابسته است و در معاملات ریسک‌پذیر محبوب است.' },
    en: { name: 'New Zealand Dollar', desc: 'The kiwi — a small commodity currency tied to dairy and agriculture; popular in risk-on trading.' }
  },

  /* ── Stocks ── */
  AAPL: {
    fa: { name: 'اپل', desc: 'اپل — بزرگ‌ترین شرکت فناوری جهان از نظر ارزش بازار؛ سازندهٔ آیفون، مک و سرویس‌های دیجیتال. معیار سهام فناوری آمریکاست.' },
    en: { name: 'Apple', desc: 'Apple — the world’s most valuable tech company: iPhone, Mac and a fast-growing services business.' }
  },
  TSLA: {
    fa: { name: 'تسلا', desc: 'تسلا — خودروساز برقی و شرکت انرژی؛ سهام آن به‌خاطر وابستگی به ایلان ماسک و رشد فروش EV نوسان بسیار بالایی دارد.' },
    en: { name: 'Tesla', desc: 'Tesla — the EV and energy company; one of the most volatile mega-cap stocks, closely tied to Elon Musk.' }
  },
  NVDA: {
    fa: { name: 'انویدیا', desc: 'انویدیا — سازندهٔ تراشه‌های هوش مصنوعی (GPU). رشد انفجاری آن با موج هوش مصنوعی، آن را به یکی از ارزشمندترین شرکت‌های جهان تبدیل کرده است.' },
    en: { name: 'NVIDIA', desc: 'NVIDIA — the AI-chip giant; its GPUs power the AI boom and made it one of the world’s most valuable companies.' }
  },
  MSFT: {
    fa: { name: 'مایکروسافت', desc: 'مایکروسافت — غول نرم‌افزار و ابر (Azure)؛ سرمایه‌گذار بزرگ OpenAI و یکی از باثبات‌ترین سهام بزرگ فناوری.' },
    en: { name: 'Microsoft', desc: 'Microsoft — software and Azure cloud giant, OpenAI’s biggest backer, one of the steadiest mega-cap tech names.' }
  },
  AMZN: {
    fa: { name: 'آمازون', desc: 'آمازون — بزرگ‌ترین فروشگاه آنلاین جهان و رهبر رایانش ابری (AWS). درآمد آن معیار سلامت مصرف‌کنندهٔ آمریکاست.' },
    en: { name: 'Amazon', desc: 'Amazon — the world’s largest online retailer and cloud leader (AWS); a bellwether for US consumer spending.' }
  },
  GOOG: {
    fa: { name: 'آلفابت (گوگل)', desc: 'آلفابت — شرکت مادر گوگل؛ موتور جستجو، یوتیوب و ابر. درآمد اصلی آن تبلیغات دیجیتال است.' },
    en: { name: 'Alphabet (Google)', desc: 'Alphabet — Google’s parent: search, YouTube and cloud; its revenue is digital advertising.' }
  },
  GOOGL: {
    fa: { name: 'آلفابت (گوگل)', desc: 'آلفابت — شرکت مادر گوگل؛ موتور جستجو، یوتیوب و ابر. درآمد اصلی آن تبلیغات دیجیتال است.' },
    en: { name: 'Alphabet (Google)', desc: 'Alphabet — Google’s parent: search, YouTube and cloud; its revenue is digital advertising.' }
  },
  META: {
    fa: { name: 'متا', desc: 'متا — شرکت مادر فیسبوک، اینستاگرام و واتساپ؛ با سرمایه‌گذاری سنگین روی هوش مصنوعی و متاورس.' },
    en: { name: 'Meta', desc: 'Meta — Facebook, Instagram and WhatsApp’s parent, now investing heavily in AI.' }
  },
  NFLX: {
    fa: { name: 'نتفلیکس', desc: 'نتفلیکس — پیشروی استریم ویدیو با بیش از ۳۰۰ میلیون مشترک؛ ارزش آن به رشد مشترک و قدرت قیمت‌گذاری بستگی دارد.' },
    en: { name: 'Netflix', desc: 'Netflix — the streaming leader with 300M+ subscribers; priced on subscriber growth and pricing power.' }
  },
  AMD: {
    fa: { name: 'ای‌ام‌دی', desc: 'ای‌ام‌دی — سازندهٔ پردازنده و کارت گرافیک؛ رقیب اصلی انویدیا در تراشه‌های هوش مصنوعی.' },
    en: { name: 'AMD', desc: 'AMD — CPU and GPU maker, NVIDIA’s main challenger in AI accelerators.' }
  },

  /* ── Indices ── */
  SPX: {
    fa: { name: 'اس‌اند‌پی ۵۰۰', desc: 'شاخص S&P 500 — سبد ۵۰۰ شرکت بزرگ آمریکا؛ مهم‌ترین معیار بازار سهام جهان و نمایندهٔ «بازار آمریکا».' },
    en: { name: 'S&P 500', desc: 'The S&P 500 — 500 large US companies; the world’s most-watched stock market benchmark.' }
  },
  NDX: {
    fa: { name: 'نزدک ۱۰۰', desc: 'شاخص Nasdaq-100 — ۱۰۰ شرکت بزرگ غیرمالی بورس نزدک؛ سنگین‌وزن آن‌ها سهام فناوری و هوش مصنوعی است.' },
    en: { name: 'Nasdaq-100', desc: 'The Nasdaq-100 — 100 of the largest non-financial Nasdaq companies; heavy on tech and AI names.' }
  },
  DJI: {
    fa: { name: 'داوجونز', desc: 'شاخص داوجونز — قدیمی‌ترین شاخص آمریکا با ۳۰ شرکت صنعتی بزرگ؛ نمایندهٔ «وال‌استریت کلاسیک».' },
    en: { name: 'Dow Jones', desc: 'The Dow — the oldest US index, 30 large industrial names, the classic “Wall Street” gauge.' }
  },
  DAX: {
    fa: { name: 'دکس آلمان', desc: 'شاخص DAX — ۴۰ شرکت بزرگ بورس فرانکفورت؛ معیار اصلی اقتصاد اروپا به‌ویژه صنعت خودرو و شیمی.' },
    en: { name: 'DAX', desc: 'Germany’s DAX — 40 Frankfurt-listed giants; the main gauge of Europe’s industrial economy.' }
  },
  NKY: {
    fa: { name: 'نیکِی ۲۲۵', desc: 'شاخص Nikkei 225 — ۲۲۵ شرکت بزرگ بورس توکیو؛ نمایندهٔ بازار آسیا و حساس به نرخ ین.' },
    en: { name: 'Nikkei 225', desc: 'Japan’s Nikkei 225 — 225 Tokyo-listed leaders; Asia’s bellwether, sensitive to the yen.' }
  },

  /* ── ETFs ── */
  GLD: {
    fa: { name: 'صندوق طلا', desc: 'GLD — صندوق قابل معاملهٔ طلا که هر سهم آن نمایندهٔ مقدار مشخصی طلای فیزیکی است؛ راهی ساده برای دنبال کردن قیمت طلا.' },
    en: { name: 'Gold ETF', desc: 'GLD — a gold exchange-traded fund backed by physical bullion; an easy way to track gold.’s price.' }
  },
  SLV: {
    fa: { name: 'صندوق نقره', desc: 'SLV — صندوق قابل معاملهٔ نقره که هر سهم آن نمایندهٔ مقدار مشخصی نقرهٔ فیزیکی است.' },
    en: { name: 'Silver ETF', desc: 'SLV — a silver ETF backed by physical silver.' }
  },
  SPY: {
    fa: { name: 'صندوق اس‌اند‌پی ۵۰۰', desc: 'SPY — بزرگ‌ترین و نقدشونده‌ترین صندوق قابل معاملهٔ اس‌اند‌پی ۵۰۰؛ یک سهم = یک سبد از کل بازار آمریکا.' },
    en: { name: 'S&P 500 ETF', desc: 'SPY — the largest, most liquid S&P 500 ETF: one share equals a slice of the whole US market.' }
  },
  QQQ: {
    fa: { name: 'صندوق نزدک ۱۰۰', desc: 'QQQ — صندوق قابل معاملهٔ نزدک ۱۰۰؛ سبدی از ۱۰۰ سهم بزرگ فناوری.' },
    en: { name: 'Nasdaq-100 ETF', desc: 'QQQ — the Nasdaq-100 ETF: a basket of the 100 largest tech-heavy names.' }
  },
  TLT: {
    fa: { name: 'صندوق اوراق بلندمدت', desc: 'TLT — صندوق اوراق خزانهٔ بلندمدت آمریکا؛ قیمت آن برعکس نرخ بهره حرکت می‌کند و «سنسور بازار» برای انتظارات نرخ بهره است.' },
    en: { name: 'Long-Term Treasury ETF', desc: 'TLT — long-dated US Treasuries; moves inversely to rates and reads the market’s rate expectations.' }
  },

  /* ── Crypto ── */
  BTC: {
    fa: { name: 'بیت‌کوین', desc: 'بیت‌کوین — اولین و بزرگ‌ترین ارز دیجیتال؛ «طلای دیجیتال» با عرضهٔ محدود ۲۱ میلیونی و معیار کل بازار کریپتو.' },
    en: { name: 'Bitcoin', desc: 'Bitcoin — the first and largest cryptocurrency, capped at 21M coins; the benchmark of all crypto.' }
  },
  ETH: {
    fa: { name: 'اتریوم', desc: 'اتریوم — بزرگ‌ترین شبکهٔ قرارداد هوشمند؛ پایهٔ اکثر برنامه‌های غیرمتمرکز، استیبل‌کوین‌ها و دیفای.' },
    en: { name: 'Ethereum', desc: 'Ethereum — the largest smart-contract network; the base layer of most DeFi and stablecoins.' }
  },
  SOL: {
    fa: { name: 'سولانا', desc: 'سولانا — بلاک‌چین پرسرعت و کم‌هزینه؛ میزبان اکوسیستم بزرگ میم‌کوین‌ها و برنامه‌های مصرفی.' },
    en: { name: 'Solana', desc: 'Solana — a fast, low-cost chain hosting a large memecoin and consumer-app ecosystem.' }
  }
};

/** Default copy for symbols with no dedicated entry. */
export function assetKnowledgeFor(symbol) {
  const s = String(symbol || '').toUpperCase();
  return ASSET_KNOWLEDGE[s] || {
    fa: { name: s, desc: `${s} — نماد معاملاتی این جفت‌ارز. جزئیات بیشتر در لحظهٔ باز شدن معامله نمایش داده می‌شود.` },
    en: { name: s, desc: `${s} — the trading symbol of this pair.` }
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   2. OFFLINE PAIR CATALOGUE — same shape as getOstiumMarkets() rows
   ═══════════════════════════════════════════════════════════════════════ */

const P = (pairId, from, to, category, price, maxLev, feeBps = 2) => ({
  pairId, from, to, name: `${from}/${to}`, category,
  maxLeverage: maxLev, overnightMaxLeverage: Math.min(maxLev, 10),
  openFeeBps: feeBps,
  bid: Number((price * 0.9992).toFixed(4)),
  mid: Number(price.toFixed(4)),
  ask: Number((price * 1.0008).toFixed(4)),
  isMarketOpen: true,
  isDayTradingClosed: false,
  timestampSeconds: Math.floor(Date.now() / 1000)
});

export function offlineOstiumMarkets() {
  const pairs = [
    /* Commodities */
    P('XAUUSD', 'XAU', 'USD', 'Commodities', 3420.5, 100),
    P('XAGUSD', 'XAG', 'USD', 'Commodities', 41.85, 100),
    P('XPDUSD', 'XPD', 'USD', 'Commodities', 1214.2, 100),
    P('XPTUSD', 'XPT', 'USD', 'Commodities', 1082.7, 100),
    P('WTIUSD', 'WTI', 'USD', 'Commodities', 71.4, 50),
    P('NGASUSD', 'NGAS', 'USD', 'Commodities', 2.94, 50),
    P('COPPERUSD', 'COPPER', 'USD', 'Commodities', 4.62, 50),
    /* Forex */
    P('EURUSD', 'EUR', 'USD', 'Forex', 1.0842, 200),
    P('GBPUSD', 'GBP', 'USD', 'Forex', 1.2718, 200),
    P('USDJPY', 'USD', 'JPY', 'Forex', 149.62, 200),
    P('USDCHF', 'USD', 'CHF', 'Forex', 0.8841, 200),
    P('AUDUSD', 'AUD', 'USD', 'Forex', 0.6528, 200),
    P('USDCAD', 'USD', 'CAD', 'Forex', 1.3612, 200),
    P('NZDUSD', 'NZD', 'USD', 'Forex', 0.5984, 200),
    /* Stocks */
    P('AAPLUSD', 'AAPL', 'USD', 'Stocks', 231.4, 20),
    P('TSLAUSD', 'TSLA', 'USD', 'Stocks', 322.8, 20),
    P('NVDAUSD', 'NVDA', 'USD', 'Stocks', 142.6, 20),
    P('MSFTUSD', 'MSFT', 'USD', 'Stocks', 448.2, 20),
    P('AMZNUSD', 'AMZN', 'USD', 'Stocks', 208.9, 20),
    P('GOOGUSD', 'GOOG', 'USD', 'Stocks', 192.4, 20),
    P('METAUSD', 'META', 'USD', 'Stocks', 596.1, 20),
    P('NFLXUSD', 'NFLX', 'USD', 'Stocks', 782.3, 20),
    P('AMDUSD', 'AMD', 'USD', 'Stocks', 158.7, 20),
    /* Indices */
    P('SPXUSD', 'SPX', 'USD', 'Indices', 6321.4, 50),
    P('NDXUSD', 'NDX', 'USD', 'Indices', 22418.6, 50),
    P('DJIUSD', 'DJI', 'USD', 'Indices', 44862.1, 50),
    P('DAXUSD', 'DAX', 'USD', 'Indices', 19684.3, 50),
    P('NKYUSD', 'NKY', 'USD', 'Indices', 39214.8, 50),
    /* ETFs */
    P('GLDUSD', 'GLD', 'USD', 'ETFs', 318.5, 30),
    P('SLVUSD', 'SLV', 'USD', 'ETFs', 39.2, 30),
    P('SPYUSD', 'SPY', 'USD', 'ETFs', 630.8, 30),
    P('QQQUSD', 'QQQ', 'USD', 'ETFs', 548.9, 30),
    P('TLTUSD', 'TLT', 'USD', 'ETFs', 88.4, 30),
    /* Crypto */
    P('BTCUSD', 'BTC', 'USD', 'Crypto', 118500, 50),
    P('ETHUSD', 'ETH', 'USD', 'Crypto', 3855, 50),
    P('SOLUSD', 'SOL', 'USD', 'Crypto', 188.6, 50)
  ];
  return { pairs, live: false, generatedAt: null, offline: true };
}

/* ═══════════════════════════════════════════════════════════════════════
   3. DEMO PRICE SERIES — deterministic, labelled, powers the chart offline
   ═══════════════════════════════════════════════════════════════════════ */

/** Deterministic pseudo-random walk seeded by the pair id. Never real data;
    the chart header always carries the offline label when this is in use. */
export function ostiumDemoSeries(pair, points = 72) {
  if (!pair) return [];
  const base = Number(pair.mid) || 0;
  if (!base) return [];
  let seed = 0;
  const s = String(pair.pairId || pair.name || 'x');
  for (let i = 0; i < s.length; i += 1) seed = (seed * 31 + s.charCodeAt(i)) % 99991;
  const out = [];
  let v = base * 0.985;
  const now = Date.now();
  const stepMs = 3_600_000; /* hourly points */
  for (let i = 0; i < points; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const wave = Math.sin(i / 7 + seed % 10) * 0.004;
    const drift = ((seed / 2147483648) - 0.5) * 0.008 + wave;
    v = Math.max(base * 0.8, v * (1 + drift));
    out.push({ x: now - (points - i) * stepMs, y: v });
  }
  return out;
}
