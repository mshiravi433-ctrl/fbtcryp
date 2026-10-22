/*
 * Editorial directory for the External Agent Hub — crypto first.
 *
 * These are links to third-party products, not reviewed provider records. They
 * must never be merged into the executable server catalogue. Keep every product
 * and pricing link on the vendor's own HTTPS domain, and keep plan descriptions
 * high-level so regional pricing/limits can be confirmed at the source.
 *
 * Two directories exist side by side on purpose:
 *
 *   · FBT NATIVE AGENTS — actually run here, in this deployment. They are NOT
 *     in this file; they come from the server catalogue (`source: "native"`).
 *   · THIS FILE — an editorial shortlist of tools and APIs a crypto user may
 *     want. Nothing here is connected, executed or reviewed by FBT. A vendor
 *     appears only if it publishes an official site and developer docs.
 *
 * "Free tier" below means the vendor publicly documents free or trial access;
 * limits change, so the card always links to the vendor's own page instead of
 * quoting a number this file cannot keep true.
 */
export const RECOMMENDATIONS_REVIEWED_ON = '2026-10-22';

export const KRYPTO_CATEGORY_IDS = Object.freeze([
  'swap', 'portfolio', 'yield', 'data', 'strategy', 'security', 'trading'
]);

export const RECOMMENDATION_CATEGORIES = Object.freeze([
  { id: 'all', fa: 'همه', en: 'All' },
  { id: 'swap', fa: 'سواپ و مسیریابی چندزنجیره‌ای', en: 'Swap & multichain routing' },
  { id: 'portfolio', fa: 'پورتفوی آن‌چین', en: 'On-chain portfolio' },
  { id: 'yield', fa: 'فرصت‌های فارم', en: 'Farm & yield' },
  { id: 'data', fa: 'قیمت و دادهٔ آن‌چین', en: 'Price & on-chain data' },
  { id: 'strategy', fa: 'ساخت و اجرای استراتژی', en: 'Strategy & execution' },
  { id: 'security', fa: 'امنیت و تحقیق', en: 'Security & research' },
  { id: 'trading', fa: 'تحلیل و معامله', en: 'Analysis & trading' },
  { id: 'general', fa: 'دستیار عمومی', en: 'General assistant' },
  { id: 'coding', fa: 'کدنویسی', en: 'Coding' },
  { id: 'automation', fa: 'اتوماسیون', en: 'Automation' }
]);

const entry = (row) => Object.freeze({
  a2a: false,
  ...row,
  kind: Object.freeze(row.kind),
  summary: Object.freeze(row.summary),
  bestFor: Object.freeze(row.bestFor),
  freeAccess: Object.freeze(row.freeAccess),
  paidAccess: Object.freeze(row.paidAccess)
});

export const RECOMMENDED_EXTERNAL_AGENTS = Object.freeze([

  /* ── swap & multichain routing ─────────────────────────────────────────── */
  entry({
    id: '1inch',
    name: '1inch',
    vendor: '1inch Network',
    mark: '1',
    category: 'swap',
    kind: { fa: 'تجمیع‌کنندهٔ DEX و مسیریابی', en: 'DEX aggregator and router' },
    summary: {
      fa: 'مسیریابی سفارش‌ها بین صرافی‌های غیرمتمرکز و APIهای توسعه‌دهنده برای قیمت، مسیر و دادهٔ بازار؛ چندین زنجیرهٔ EVM را پوشش می‌دهد.',
      en: 'Routes orders across decentralized exchanges and exposes developer APIs for pricing, swap routes and market data across several EVM chains.'
    },
    bestFor: {
      fa: 'پیدا کردن مسیر سواپ با بهترین نرخ و بررسی دادهٔ بازار از طریق API؛ خروجی را قبل از امضا خودتان مقایسه کنید.',
      en: 'Finding a competitive swap route and reading market data through its API; compare the quote yourself before signing.'
    },
    freeAccess: {
      fa: 'پورتال توسعه‌دهنده طرح رایگان/آزمایشی با محدودیت درخواست دارد؛ شرایط را در پورتال بررسی کنید.',
      en: 'The developer portal offers free/trial access with request limits; confirm the current terms there.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی برای حجم بالاتر و قابلیت‌های بیشتر API ارائه می‌شود.',
      en: 'Paid developer plans add higher volume and more API features.'
    },
    productUrl: 'https://1inch.io/',
    pricingUrl: 'https://portal.1inch.dev/',
    docsUrl: 'https://docs.1inch.io/'
  }),
  entry({
    id: 'lifi',
    name: 'LI.FI / Jumper',
    vendor: 'LI.FI',
    mark: 'LF',
    category: 'swap',
    kind: { fa: 'تجمیع‌کنندهٔ پل و سواپ بین‌زنجیره‌ای', en: 'Bridge and cross-chain swap aggregator' },
    summary: {
      fa: 'یک API و رابط Jumper برای مقایسهٔ مسیرهای پل و سواپ بین زنجیره‌ها؛ FBT خودش برای برآورد مسیر بین‌زنجیره‌ای از همین زیرساخت استفاده می‌کند.',
      en: 'One API — and the Jumper interface — comparing bridge and swap routes across chains. FBT itself uses this infrastructure for its cross-chain route estimates.'
    },
    bestFor: {
      fa: 'مقایسهٔ زمان، کارمزد و پل در یک مسیر بین‌زنجیره‌ای؛ برای اجرا همیشه خروجی نهایی را در کیف‌پول خودتان تأیید کنید.',
      en: 'Comparing time, fees and bridges on a cross-chain route; always confirm the final output in your own wallet before executing.'
    },
    freeAccess: {
      fa: 'API عمومی با سقف درخواست و بدون نیاز به کلید در بسیاری از مسیرها؛ برای حجم بالا کلید لازم است.',
      en: 'A public API with request limits; many routes work without a key, higher volume needs one.'
    },
    paidAccess: {
      fa: 'طرح‌های سازمانی و پلن‌های با حجم بالا؛ شرایط را از تیم LI.FI بگیرید.',
      en: 'Enterprise and high-volume plans; terms come from the LI.FI team.'
    },
    productUrl: 'https://li.fi/',
    pricingUrl: 'https://docs.li.fi/',
    docsUrl: 'https://docs.li.fi/'
  }),
  entry({
    id: 'jupiter',
    name: 'Jupiter',
    vendor: 'Jupiter',
    mark: 'J',
    category: 'swap',
    kind: { fa: 'تجمیع‌کنندهٔ سواپ سولانا', en: 'Solana swap aggregator' },
    summary: {
      fa: 'مسیریابی سواپ روی سولانا با APIهای قیمت، توکن و مسیر؛ مرجع اصلی مسیرهای سولانا در این اکوسیستم.',
      en: 'Solana swap routing with price, token and route APIs — the reference aggregator for the Solana ecosystem.'
    },
    bestFor: {
      fa: 'سواپ توکن‌های سولانا و خواندن لیست توکن‌ها؛ پیش از معامله، نقدینگی و ریسک توکن را جدا بررسی کنید.',
      en: 'Swapping Solana tokens and reading the token list; check liquidity and token risk separately before trading.'
    },
    freeAccess: {
      fa: 'API عمومی با محدودیت نرخ؛ رابط وب بدون حساب قابل استفاده است.',
      en: 'A public API with rate limits; the web interface works without an account.'
    },
    paidAccess: {
      fa: 'دسترسی با ظرفیت بالاتر از طریق برنامهٔ API؛ شرایط را در مستندات بررسی کنید.',
      en: 'Higher-capacity API access is available through its developer programme; see the docs.'
    },
    productUrl: 'https://jup.ag/',
    pricingUrl: 'https://station.jup.ag/docs',
    docsUrl: 'https://station.jup.ag/docs'
  }),
  entry({
    id: 'odos',
    name: 'Odos',
    vendor: 'Odos',
    mark: 'O',
    category: 'swap',
    kind: { fa: 'مسیریابی چندتوکنی', en: 'Multi-token routing' },
    summary: {
      fa: 'مسیریابی سواپ با امکان ترکیب چند توکن در یک مسیر؛ API توسعه‌دهنده برای قیمت و ساخت مسیر.',
      en: 'Swap routing that can combine several tokens in one route, with a developer API for quotes and route building.'
    },
    bestFor: {
      fa: 'مسیرهایی که چند دارایی را هم‌زمان درگیر می‌کنند؛ خروجی و کارمزد را با یک تجمیع‌کنندهٔ دیگر مقایسه کنید.',
      en: 'Routes that touch several assets at once; compare output and fees with another aggregator.'
    },
    freeAccess: {
      fa: 'طرح توسعه‌دهنده با محدودیت درخواست ارائه می‌شود.',
      en: 'A developer plan with request limits is available.'
    },
    paidAccess: {
      fa: 'ظرفیت بالاتر و پشتیبانی در طرح‌های تجاری.',
      en: 'Higher capacity and support on commercial plans.'
    },
    productUrl: 'https://odos.xyz/',
    pricingUrl: 'https://docs.odos.xyz/',
    docsUrl: 'https://docs.odos.xyz/'
  }),
  entry({
    id: 'kyberswap',
    name: 'KyberSwap',
    vendor: 'Kyber Network',
    mark: 'K',
    category: 'swap',
    kind: { fa: 'تجمیع‌کننده و استخر نقدینگی', en: 'Aggregator and liquidity pools' },
    summary: {
      fa: 'سواپ و مسیریابی چندزنجیره‌ای همراه با استخرهای نقدینگی و API؛ بخشی از مسیرهای FBT هم از این پروتکل می‌گذرد.',
      en: 'Multichain swaps and routing alongside liquidity pools and an API; some of FBT’s own routes already use this protocol.'
    },
    bestFor: {
      fa: 'مقایسهٔ نرخ در زنجیره‌های مختلف و بررسی استخرها؛ ریسک قرارداد و IL را جدا ارزیابی کنید.',
      en: 'Comparing rates across chains and reviewing pools; evaluate contract and impermanent-loss risk separately.'
    },
    freeAccess: {
      fa: 'رابط و API عمومی با محدودیت نرخ.',
      en: 'Public interface and API with rate limits.'
    },
    paidAccess: {
      fa: 'دسترسی تجاری و ظرفیت بالاتر از طریق تیم Kyber.',
      en: 'Commercial and higher-capacity access through the Kyber team.'
    },
    productUrl: 'https://kyberswap.com/',
    pricingUrl: 'https://docs.kyberswap.com/',
    docsUrl: 'https://docs.kyberswap.com/'
  }),

  /* ── on-chain portfolio ────────────────────────────────────────────────── */
  entry({
    id: 'zerion',
    name: 'Zerion',
    vendor: 'Zerion',
    mark: 'Z',
    category: 'portfolio',
    kind: { fa: 'پورتفوی آن‌چین و API', en: 'On-chain portfolio and API' },
    summary: {
      fa: 'تجمیع موجودی، موقعیت‌های دیفای، تاریخچه، PnL و NFT یک کیف‌پول در چند زنجیره؛ API آن همین داده‌ها را به برنامه‌ها می‌دهد.',
      en: 'Aggregates a wallet’s balances, DeFi positions, history, PnL and NFTs across chains; its API exposes the same data to apps.'
    },
    bestFor: {
      fa: 'دیدن همهٔ دارایی‌ها و موقعیت‌های یک کیف‌پول در یک نما؛ برای دادهٔ برنامه‌نویسی، مستندات API و محدودیت طرح را بخوانید.',
      en: 'Seeing all of a wallet’s assets and positions in one view; for programmatic data read the API docs and plan limits.'
    },
    freeAccess: {
      fa: 'نسخهٔ وب و موبایل رایگان است؛ API طرح محدود دارد.',
      en: 'The web and mobile app are free; the API has a limited plan.'
    },
    paidAccess: {
      fa: 'طرح‌های API با نرخ درخواست بالاتر و دادهٔ بیشتر.',
      en: 'API plans add higher rate limits and more data.'
    },
    productUrl: 'https://zerion.io/',
    pricingUrl: 'https://zerion.io/api',
    docsUrl: 'https://developers.zerion.io/'
  }),
  entry({
    id: 'debank',
    name: 'DeBank',
    vendor: 'DeBank',
    mark: 'D',
    category: 'portfolio',
    kind: { fa: 'ردیابی پورتفوی Web3', en: 'Web3 portfolio tracker' },
    summary: {
      fa: 'نمای پورتفوی چندزنجیره‌ای، موقعیت‌های پروتکل‌ها و تاریخچهٔ تراکنش؛ Cloud API برای توسعه‌دهندگان.',
      en: 'A multichain portfolio view with protocol positions and transaction history, plus a Cloud API for developers.'
    },
    bestFor: {
      fa: 'بررسی دستی کیف‌پول‌ها و ساختن داشبورد؛ برای دادهٔ خودکار، دسترسی Cloud را جداگانه بگیرید.',
      en: 'Manual wallet research and dashboards; for automated data you need Cloud API access separately.'
    },
    freeAccess: {
      fa: 'رابط عمومی رایگان است؛ API سهمیهٔ محدود دارد.',
      en: 'The public interface is free; the API has a limited quota.'
    },
    paidAccess: {
      fa: 'دسترسی API با سهمیهٔ بالاتر به‌صورت اشتراک.',
      en: 'Subscription API access with higher quotas.'
    },
    productUrl: 'https://debank.com/',
    pricingUrl: 'https://cloud.debank.com/',
    docsUrl: 'https://docs.cloud.debank.com/'
  }),
  entry({
    id: 'rotki',
    name: 'Rotki',
    vendor: 'Rotki',
    mark: 'R',
    category: 'portfolio',
    kind: { fa: 'حسابداری و ردیابی متن‌باز', en: 'Open-source accounting and tracking' },
    summary: {
      fa: 'نرم‌افزار متن‌باز برای ردیابی پورتفوی چندزنجیره‌ای و گزارش مالیاتی با دادهٔ محلی؛ برای حریم خصوصی گزینهٔ متفاوتی است.',
      en: 'Open-source, local-first portfolio tracking and tax reporting across chains — a different trade-off for privacy.'
    },
    bestFor: {
      fa: 'کاربرانی که می‌خواهند داده روی دستگاه خودشان بماند و گزارش قابل‌ممیزی بسازند.',
      en: 'Users who want their data to stay on their own machine and need an auditable report.'
    },
    freeAccess: {
      fa: 'نسخهٔ متن‌باز رایگان و قابل اجرا روی سیستم خودتان.',
      en: 'The open-source edition is free and self-hosted.'
    },
    paidAccess: {
      fa: 'نسخهٔ آماده و پشتیبانی تجاری به‌صورت اشتراک.',
      en: 'A packaged edition and commercial support are subscription-based.'
    },
    productUrl: 'https://rotki.com/',
    pricingUrl: 'https://rotki.com/',
    docsUrl: 'https://docs.rotki.com/'
  }),

  /* ── farm & yield ──────────────────────────────────────────────────────── */
  entry({
    id: 'yield-xyz',
    name: 'Yield.xyz',
    vendor: 'Yield.xyz',
    mark: 'Y',
    category: 'yield',
    kind: { fa: 'زیرساخت بازده و استیکینگ', en: 'Yield and staking infrastructure' },
    summary: {
      fa: 'یک API برای کشف و ساخت تراکنش‌های استیکینگ، وام‌دهی و بازده در ده‌ها شبکه؛ تراکنش را بدون امضا برمی‌گرداند و کیف‌پول شما آن را امضا می‌کند.',
      en: 'One API to discover and build staking, lending and yield transactions across dozens of networks; it returns unsigned transactions for your wallet to sign.'
    },
    bestFor: {
      fa: 'مقایسه و ساخت مسیر بازده به‌صورت برنامه‌نویسی‌شده؛ شرایط پروتکل مقصد و ریسک آن را جداگانه بررسی کنید.',
      en: 'Comparing and building yield routes programmatically; still check the destination protocol’s terms and risk yourself.'
    },
    freeAccess: {
      fa: 'دسترسی توسعه‌دهنده با کلید API و محدودیت؛ شرایط را در مستندات ببینید.',
      en: 'Developer access with an API key and limits; see the docs for current terms.'
    },
    paidAccess: {
      fa: 'طرح‌های تجاری و مدل درآمدی برای محصولات بزرگ‌تر.',
      en: 'Commercial plans and revenue models for larger products.'
    },
    productUrl: 'https://yield.xyz/',
    pricingUrl: 'https://docs.yield.xyz/',
    docsUrl: 'https://docs.yield.xyz/'
  }),
  entry({
    id: 'beefy',
    name: 'Beefy',
    vendor: 'Beefy Finance',
    mark: 'B',
    category: 'yield',
    kind: { fa: 'بهینه‌سازی بازده چندزنجیره‌ای', en: 'Multichain yield optimizer' },
    summary: {
      fa: 'استخرهای بازده خودکار روی چندین زنجیره؛ APY و مسیرها را نشان می‌دهد و قراردادهای پروتکل ریسک خودشان را دارند.',
      en: 'Auto-compounding yield vaults across chains; it shows APY and routes, while each vault’s contract carries its own risk.'
    },
    bestFor: {
      fa: 'کشف استخرهای بازده و مقایسهٔ استراتژی‌ها؛ پیش از سپردن دارایی، قرارداد و پاداش‌ها را بررسی کنید.',
      en: 'Discovering vaults and comparing strategies; inspect the contract and rewards before depositing.'
    },
    freeAccess: {
      fa: 'استفاده از رابط رایگان است؛ کارمزد از بازده استخر کسر می‌شود.',
      en: 'The interface is free; a performance fee is taken from vault yield.'
    },
    paidAccess: {
      fa: 'طرح اشتراکی ندارد؛ هزینه از طریق کارمزد عملکرد است.',
      en: 'No subscription; costs come through performance fees.'
    },
    productUrl: 'https://beefy.com/',
    pricingUrl: 'https://docs.beefy.finance/',
    docsUrl: 'https://docs.beefy.finance/'
  }),
  entry({
    id: 'pendle',
    name: 'Pendle',
    vendor: 'Pendle',
    mark: 'P',
    category: 'yield',
    kind: { fa: 'معامله و تفکیک بازده', en: 'Yield trading and tokenisation' },
    summary: {
      fa: 'تفکیک بازده به توکن‌های اصلی و بازده و معاملهٔ آن‌ها؛ ابزاری تخصصی برای مدیریت نرخ بازده آینده.',
      en: 'Splits yield into principal and yield tokens and lets you trade them — a specialist tool for managing future yield.'
    },
    bestFor: {
      fa: 'کاربران آشنا به ساختار PT/YT و ریسک قرارداد؛ مناسب تازه‌کارها نیست.',
      en: 'Users who understand PT/YT mechanics and contract risk; not a beginner product.'
    },
    freeAccess: {
      fa: 'رابط رایگان است؛ کارمزد در معامله و استخرها اعمال می‌شود.',
      en: 'The interface is free; fees apply inside trades and pools.'
    },
    paidAccess: {
      fa: 'طرح اشتراکی ندارد؛ هزینه از طریق کارمزد و هزینهٔ فرصت است.',
      en: 'No subscription; costs are fees and opportunity cost.'
    },
    productUrl: 'https://www.pendle.finance/',
    pricingUrl: 'https://docs.pendle.finance/',
    docsUrl: 'https://docs.pendle.finance/'
  }),
  entry({
    id: 'defillama-yields',
    name: 'DefiLlama Yields',
    vendor: 'DefiLlama',
    mark: 'DL',
    category: 'yield',
    kind: { fa: 'دادهٔ بازده و استخرها', en: 'Yield and pool data' },
    summary: {
      fa: 'فهرست استخرهای بازده با APY پایه/پاداش، TVL و ریسک IL؛ همان منبعی که بهینه‌ساز بازده FBT و صفحهٔ فارم از آن تغذیه می‌شوند.',
      en: 'Pool data with base/reward APY, TVL and IL risk — the same feed behind FBT’s own Yield Optimizer and Farm screen.'
    },
    bestFor: {
      fa: 'بررسی خام دادهٔ استخرها و مقایسه با فیلتر ایمنی FBT؛ داده را با داشبورد خود پروتکل تلاقی دهید.',
      en: 'Reading raw pool data and comparing it with FBT’s safety filter; cross-check with the protocol’s own dashboard.'
    },
    freeAccess: {
      fa: 'دادهٔ عمومی و API بدون کلید برای بخش بزرگی از نقاط انتهایی.',
      en: 'Public data and a keyless API for a large part of its endpoints.'
    },
    paidAccess: {
      fa: 'سرویس‌های پولی برای دسترسی پرحجم و تجاری.',
      en: 'Paid services for high-volume and commercial access.'
    },
    productUrl: 'https://defillama.com/yields',
    pricingUrl: 'https://defillama.com/docs/api',
    docsUrl: 'https://defillama.com/docs/api'
  }),

  /* ── price & on-chain data ─────────────────────────────────────────────── */
  entry({
    id: 'coingecko',
    name: 'CoinGecko',
    vendor: 'CoinGecko',
    mark: 'CG',
    category: 'data',
    kind: { fa: 'قیمت، تاریخچه و دادهٔ توکن', en: 'Price, history and token data' },
    summary: {
      fa: 'قیمت، ارزش بازار، تاریخچه، اطلاعات توکن‌ها و داده‌های مرتبط از طریق API؛ منبع اصلی قیمت در بخش بزرگی از FBT.',
      en: 'Prices, market caps, history, token metadata and related data through its API — a primary price source across much of FBT.'
    },
    bestFor: {
      fa: 'قیمت مرجع و تاریخچهٔ بازار؛ برای دادهٔ لحظه‌ای معاملاتی، منبع دیگری هم بررسی کنید.',
      en: 'Reference prices and market history; for trading-grade live data, cross-check another source.'
    },
    freeAccess: {
      fa: 'طرح Demo رایگان با محدودیت نرخ و دادهٔ محدود؛ کلید API لازم است.',
      en: 'A free Demo plan with rate and data limits; an API key is required.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی با سقف بالاتر و دادهٔ بیشتر.',
      en: 'Paid plans add higher limits and more data.'
    },
    productUrl: 'https://www.coingecko.com/',
    pricingUrl: 'https://www.coingecko.com/en/api/pricing',
    docsUrl: 'https://docs.coingecko.com/'
  }),
  entry({
    id: 'defillama',
    name: 'DefiLlama',
    vendor: 'DefiLlama',
    mark: 'DL',
    category: 'data',
    kind: { fa: 'TVL، پروتکل‌ها و حادثه‌ها', en: 'TVL, protocols and incidents' },
    summary: {
      fa: 'TVL، حجم، درآمد پروتکل‌ها و فهرست حادثه‌های امنیتی؛ دادهٔ پایهٔ گزارش امنیتی پروتکل در FBT از اینجا می‌آید.',
      en: 'Protocol TVL, volume, fees and a security-incident feed — the basis of FBT’s own Protocol Security Brief.'
    },
    bestFor: {
      fa: 'سنجش اندازه و روند یک پروتکل و بررسی سابقهٔ حادثه؛ داده را با گزارش خود پروژه کامل کنید.',
      en: 'Sizing a protocol and checking its incident history; complete the picture with the project’s own reports.'
    },
    freeAccess: {
      fa: 'بخش بزرگی از API بدون کلید و رایگان است.',
      en: 'A large part of the API is free and keyless.'
    },
    paidAccess: {
      fa: 'دسترسی تجاری پرحجم از طریق سرویس پولی.',
      en: 'High-volume commercial access through its paid service.'
    },
    productUrl: 'https://defillama.com/',
    pricingUrl: 'https://defillama.com/docs/api',
    docsUrl: 'https://defillama.com/docs/api'
  }),
  entry({
    id: 'dune',
    name: 'Dune',
    vendor: 'Dune Analytics',
    mark: 'DU',
    category: 'data',
    kind: { fa: 'پرس‌وجوی SQL روی دادهٔ آن‌چین', en: 'SQL over on-chain data' },
    summary: {
      fa: 'نوشتن و اجرای کوئری SQL روی دادهٔ زنجیره و ساخت داشبورد؛ مناسب تحلیل عمیق و سفارشی.',
      en: 'Write and run SQL over on-chain data and publish dashboards — built for deep, custom analysis.'
    },
    bestFor: {
      fa: 'تحلیلگرانی که می‌خواهند سؤال خودشان را روی داده بسازند؛ نتیجهٔ داشبورد را به‌عنوان منبع نهایی تأیید نکنید.',
      en: 'Analysts who want to build their own question on the data; a third-party dashboard is not a primary source.'
    },
    freeAccess: {
      fa: 'حساب رایگان با محدودیت اجرای کوئری و داشبورد.',
      en: 'A free account with limits on query runs and dashboards.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی با توان محاسباتی و همکاری بیشتر.',
      en: 'Paid plans add more compute and collaboration.'
    },
    productUrl: 'https://dune.com/',
    pricingUrl: 'https://dune.com/pricing',
    docsUrl: 'https://docs.dune.com/'
  }),
  entry({
    id: 'nansen',
    name: 'Nansen',
    vendor: 'Nansen',
    mark: 'N',
    category: 'data',
    kind: { fa: 'برچسب کیف‌پول و هوشمندی', en: 'Wallet labels and intelligence' },
    summary: {
      fa: 'برچسب‌گذاری کیف‌پول‌ها، ردیابی جریان سرمایه و داشبوردهای تحلیلی؛ ابزار پولی و تخصصی.',
      en: 'Wallet labelling, capital-flow tracking and analytics dashboards — a paid, specialist toolkit.'
    },
    bestFor: {
      fa: 'پژوهش جریان سرمایه و رفتار کیف‌پول‌های شناخته‌شده؛ برچسب‌ها را قطعی و بی‌خطا فرض نکنید.',
      en: 'Researching capital flow and known-wallet behaviour; do not treat labels as certain.'
    },
    freeAccess: {
      fa: 'نسخهٔ محدود یا آزمایشی دارد؛ دادهٔ کامل پولی است.',
      en: 'A limited or trial tier exists; full data is paid.'
    },
    paidAccess: {
      fa: 'اشتراک ماهانه با سطوح مختلف دسترسی.',
      en: 'Monthly subscriptions with different access levels.'
    },
    productUrl: 'https://www.nansen.ai/',
    pricingUrl: 'https://www.nansen.ai/pricing',
    docsUrl: 'https://docs.nansen.ai/'
  }),
  entry({
    id: 'arkham',
    name: 'Arkham',
    vendor: 'Arkham Intelligence',
    mark: 'A',
    category: 'data',
    kind: { fa: 'هوشمندی موجودیت‌های آن‌چین', en: 'On-chain entity intelligence' },
    summary: {
      fa: 'نقشهٔ موجودیت‌ها و آدرس‌ها، ردیابی جریان و هشدار؛ برای پژوهش کیف‌پول‌های بزرگ و صرافی‌ها.',
      en: 'Entity and address mapping, flow tracking and alerts — aimed at research on large wallets and exchanges.'
    },
    bestFor: {
      fa: 'ردیابی مقصد و مبدأ دارایی‌های بزرگ؛ هویت‌ها را با شواهد چندمنبعی تأیید کنید.',
      en: 'Tracing large flows; corroborate identities with more than one source.'
    },
    freeAccess: {
      fa: 'دسترسی پایهٔ رایگان با محدودیت.',
      en: 'Basic free access with limits.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی برای هشدار، API و تیم‌ها.',
      en: 'Paid plans add alerts, API access and team features.'
    },
    productUrl: 'https://arkhamintelligence.com/',
    pricingUrl: 'https://arkhamintelligence.com/',
    docsUrl: 'https://arkhamintelligence.com/'
  }),
  entry({
    id: 'coinglass',
    name: 'CoinGlass',
    vendor: 'CoinGlass',
    mark: 'CGL',
    category: 'trading',
    kind: { fa: 'دادهٔ مشتقات و لیکوییدیشن', en: 'Derivatives and liquidation data' },
    summary: {
      fa: 'نرخ فاندینگ، بهرهٔ باز، لیکوییدیشن و دادهٔ بازار مشتقات؛ مکمل تحلیل قیمت نقدی.',
      en: 'Funding rates, open interest, liquidations and derivatives market data — a complement to spot analysis.'
    },
    bestFor: {
      fa: 'خواندن فشار اهرم و موقعیت‌های باز؛ این داده پیش‌بینی جهت نیست.',
      en: 'Reading leverage pressure and open positioning; it is not a direction forecast.'
    },
    freeAccess: {
      fa: 'دادهٔ پایه رایگان با محدودیت صفحه.',
      en: 'Basic data is free with page limits.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی برای دادهٔ تاریخی و API.',
      en: 'Paid plans add historical data and API access.'
    },
    productUrl: 'https://www.coinglass.com/',
    pricingUrl: 'https://www.coinglass.com/pricing',
    docsUrl: 'https://docs.coinglass.com/'
  }),

  /* ── strategy & execution ──────────────────────────────────────────────── */
  entry({
    id: 'quantconnect',
    name: 'QuantConnect',
    vendor: 'QuantConnect',
    mark: 'QC',
    category: 'strategy',
    kind: { fa: 'بک‌تست و اجرای الگوریتم', en: 'Algorithm backtesting and execution' },
    summary: {
      fa: 'پلتفرم پژوهش کمی با دادهٔ تاریخی، بک‌تست، بهینه‌سازی و اجرای الگوریتم روی چند بازار از جمله کریپتو.',
      en: 'A quantitative research platform with historical data, backtesting, optimisation and live deployment across markets including crypto.'
    },
    bestFor: {
      fa: 'توسعه و آزمون استراتژی با کد خودتان؛ بک‌تست خوب با اجرای واقعی تفاوت دارد و هزینه‌ها را جدا حساب کنید.',
      en: 'Developing and testing your own coded strategies; a good backtest is not live performance — model costs explicitly.'
    },
    freeAccess: {
      fa: 'طرح رایگان با منابع محدود پژوهش و بک‌تست.',
      en: 'A free tier with limited research and backtesting resources.'
    },
    paidAccess: {
      fa: 'اشتراک‌های پولی برای داده، توان محاسبه و اجرای زنده؛ قیمت منطقه‌ای است.',
      en: 'Paid subscriptions for data, compute and live deployment; pricing varies by region.'
    },
    productUrl: 'https://www.quantconnect.com/',
    pricingUrl: 'https://www.quantconnect.com/pricing',
    docsUrl: 'https://www.quantconnect.com/docs/'
  }),
  entry({
    id: 'tradingview',
    name: 'TradingView',
    vendor: 'TradingView',
    mark: 'TV',
    category: 'strategy',
    kind: { fa: 'تحلیل تکنیکال و اسکریپت', en: 'Technical analysis and scripting' },
    summary: {
      fa: 'نمودار، اندیکاتور و زبان Pine برای ساخت و آزمون قاعده‌های معاملاتی؛ هشدارها و جامعهٔ بزرگ اسکریپت.',
      en: 'Charts, indicators and the Pine language for building and testing trading rules, with alerts and a large script community.'
    },
    bestFor: {
      fa: 'ساختن و دیدن سیگنال روی نمودار؛ برای اجرای خودکار به بازار و صرافی و کد جداگانه نیاز دارید.',
      en: 'Building and visualising signals; automated execution needs a separate market and exchange integration.'
    },
    freeAccess: {
      fa: 'طرح رایگان با محدودیت اندیکاتور و هشدار.',
      en: 'A free plan with indicator and alert limits.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی با هشدار بیشتر، زمان‌فریم‌های بیشتر و دادهٔ اضافی.',
      en: 'Paid plans add more alerts, timeframes and extra data.'
    },
    productUrl: 'https://www.tradingview.com/',
    pricingUrl: 'https://www.tradingview.com/pricing/',
    docsUrl: 'https://www.tradingview.com/pine-script-docs/'
  }),
  entry({
    id: 'hummingbot',
    name: 'Hummingbot',
    vendor: 'Hummingbot Foundation',
    mark: 'HB',
    category: 'strategy',
    kind: { fa: 'مارکت‌میکینگ متن‌باز', en: 'Open-source market making' },
    summary: {
      fa: 'ربات متن‌باز مارکت‌میکینگ و آربیتراژ با اتصال به صرافی‌های متمرکز و غیرمتمرکز.',
      en: 'An open-source market-making and arbitrage bot that connects to centralised and decentralised exchanges.'
    },
    bestFor: {
      fa: 'کاربران فنی که میزبانی و کلید API را خودشان مدیریت می‌کنند؛ ریسک اجرا و امنیت کلید بالاست.',
      en: 'Technical users who manage their own hosting and API keys; execution and key-security risk are high.'
    },
    freeAccess: {
      fa: 'نرم‌افزار متن‌باز و رایگان؛ هزینهٔ سرور و کارمزد صرافی جداست.',
      en: 'Open-source and free; server and exchange fees are separate.'
    },
    paidAccess: {
      fa: 'طرح اشتراکی ندارد؛ پشتیبانی و آموزش تجاری وجود دارد.',
      en: 'No subscription; commercial support and courses exist.'
    },
    productUrl: 'https://hummingbot.org/',
    pricingUrl: 'https://hummingbot.org/installation/',
    docsUrl: 'https://hummingbot.org/'
  }),
  entry({
    id: 'freqtrade',
    name: 'Freqtrade',
    vendor: 'Freqtrade',
    mark: 'FT',
    category: 'strategy',
    kind: { fa: 'ربات معاملاتی متن‌باز', en: 'Open-source trading bot' },
    summary: {
      fa: 'ربات متن‌باز پایتون با بک‌تست، هایپراوپت و اجرای زنده روی صرافی‌های پشتیبانی‌شده.',
      en: 'An open-source Python bot with backtesting, hyperopt and live trading on supported exchanges.'
    },
    bestFor: {
      fa: 'تست استراتژی با دادهٔ خودتان و اجرای کنترل‌شده؛ پیش از پول واقعی، حالت خشک را کامل اجرا کنید.',
      en: 'Testing strategies on your own data and running them under control; run dry mode thoroughly before real funds.'
    },
    freeAccess: {
      fa: 'متن‌باز و رایگان.',
      en: 'Open-source and free.'
    },
    paidAccess: {
      fa: 'طرح اشتراکی ندارد؛ هزینهٔ سرور و صرافی جداست.',
      en: 'No subscription; server and exchange costs are separate.'
    },
    productUrl: 'https://www.freqtrade.io/',
    pricingUrl: 'https://www.freqtrade.io/en/stable/',
    docsUrl: 'https://www.freqtrade.io/en/stable/'
  }),
  entry({
    id: 'composer',
    name: 'Composer',
    vendor: 'Composer',
    mark: 'C',
    category: 'strategy',
    kind: { fa: 'ساخت استراتژی بدون کد', en: 'No-code strategy builder' },
    summary: {
      fa: 'ساخت استراتژی‌های خودکار با رابط بدون کد و اجرای آن‌ها؛ برای کاربرانی که کدنویسی نمی‌کنند.',
      en: 'Build and run automated strategies through a no-code interface, aimed at users who do not code.'
    },
    bestFor: {
      fa: 'ساخت سریع استراتژی و مشاهدهٔ عملکرد؛ اجرای خودکار پول واقعی ریسک جداگانه دارد.',
      en: 'Quickly composing a strategy and watching it run; automated live money carries its own risk.'
    },
    freeAccess: {
      fa: 'دورهٔ آزمایشی یا طرح پایه دارد؛ شرایط را در سایت ببینید.',
      en: 'A trial or entry tier exists; check the current terms on its site.'
    },
    paidAccess: {
      fa: 'اشتراک ماهانه/سالانه با دسترسی به استراتژی‌های بیشتر.',
      en: 'Monthly/annual subscriptions with access to more strategies.'
    },
    productUrl: 'https://www.composer.trade/',
    pricingUrl: 'https://www.composer.trade/pricing',
    docsUrl: 'https://www.composer.trade/'
  }),

  /* ── security & research ───────────────────────────────────────────────── */
  entry({
    id: 'goplus',
    name: 'GoPlus Security',
    vendor: 'GoPlus',
    mark: 'GP',
    category: 'security',
    kind: { fa: 'اسکن قرارداد و توکن', en: 'Token and contract scanning' },
    summary: {
      fa: 'API امنیتی رایگان برای بررسی هانی‌پات، مالیات، مالکیت، پروکسی و هولدرها؛ همان منبعی که اسکنر ریسک توکن FBT استفاده می‌کند.',
      en: 'A keyless security API for honeypot, tax, ownership, proxy and holder checks — the feed behind FBT’s own Token Risk Scanner.'
    },
    bestFor: {
      fa: 'بررسی سریع قرارداد قبل از معامله؛ «پرچم ندید» یعنی اسکنر چیزی پیدا نکرد، نه امن بودن.',
      en: 'A quick contract check before trading; “no flag” means the scanner found nothing, not that it is safe.'
    },
    freeAccess: {
      fa: 'نقاط انتهایی پایه بدون کلید و رایگان.',
      en: 'Basic endpoints are keyless and free.'
    },
    paidAccess: {
      fa: 'دسترسی تجاری با سقف بالاتر و نقاط انتهایی بیشتر.',
      en: 'Commercial access adds higher limits and more endpoints.'
    },
    productUrl: 'https://gopluslabs.io/',
    pricingUrl: 'https://docs.gopluslabs.io/',
    docsUrl: 'https://docs.gopluslabs.io/'
  }),
  entry({
    id: 'token-sniffer',
    name: 'Token Sniffer',
    vendor: 'Token Sniffer',
    mark: 'TS',
    category: 'security',
    kind: { fa: 'امتیاز ریسک قرارداد', en: 'Contract risk scoring' },
    summary: {
      fa: 'امتیاز و گزارش ریسک توکن‌های تازه‌راه‌اندازی‌شده با بررسی قرارداد و نقدینگی؛ مناسب غربال اولیه.',
      en: 'Risk scores and reports for newly launched tokens based on contract and liquidity checks — useful as a first screen.'
    },
    bestFor: {
      fa: 'غربال سریع توکن‌های ناشناس؛ امتیاز بالا تضمین فروش‌پذیری یا نبود کلاهبرداری نیست.',
      en: 'A quick screen of unknown tokens; a high score does not guarantee sellability or honesty.'
    },
    freeAccess: {
      fa: 'جست‌وجوی وب رایگان؛ API سهمیهٔ محدود دارد.',
      en: 'Free web lookups; the API has a limited quota.'
    },
    paidAccess: {
      fa: 'دسترسی API پولی برای حجم بالاتر.',
      en: 'Paid API access for higher volume.'
    },
    productUrl: 'https://tokensniffer.com/',
    pricingUrl: 'https://tokensniffer.com/api',
    docsUrl: 'https://tokensniffer.com/api'
  }),
  entry({
    id: 'rugcheck',
    name: 'RugCheck',
    vendor: 'RugCheck',
    mark: 'RC',
    category: 'security',
    kind: { fa: 'اسکن توکن‌های سولانا', en: 'Solana token scanning' },
    summary: {
      fa: 'بررسی قرارداد و توکنومیک توکن‌های سولانا: مالکیت، فریز، mint و تمرکز هولدرها.',
      en: 'Inspects Solana tokens for ownership, freeze authority, mint authority and holder concentration.'
    },
    bestFor: {
      fa: 'بررسی توکن‌های سولانا که GoPlus پوشش نمی‌دهد؛ نتیجه را با نقدینگی واقعی DEX ترکیب کنید.',
      en: 'Checking Solana tokens that GoPlus does not cover; combine the result with real DEX liquidity.'
    },
    freeAccess: {
      fa: 'رابط و API عمومی رایگان با محدودیت.',
      en: 'Free public interface and API with rate limits.'
    },
    paidAccess: {
      fa: 'دسترسی پرحجم از طریق API تجاری.',
      en: 'High-volume access through its commercial API.'
    },
    productUrl: 'https://rugcheck.xyz/',
    pricingUrl: 'https://rugcheck.xyz/',
    docsUrl: 'https://rugcheck.xyz/'
  }),
  entry({
    id: 'honeypot',
    name: 'Honeypot.is',
    vendor: 'Honeypot.is',
    mark: 'HP',
    category: 'security',
    kind: { fa: 'آزمون هانی‌پات روی DEX', en: 'DEX honeypot simulation' },
    summary: {
      fa: 'شبیه‌سازی خرید و فروش یک توکن روی DEX برای تشخیص اینکه آیا می‌توان فروخت؛ تمرکز روی EVM.',
      en: 'Simulates a buy and sell on a DEX to see whether a token can actually be sold; EVM-focused.'
    },
    bestFor: {
      fa: 'بررسی سریع «می‌توانم بفروشم؟»؛ نتیجه به وضعیت لحظه‌ای استخر بستگی دارد.',
      en: 'A quick “can I sell?” check; the result depends on the pool’s state at that moment.'
    },
    freeAccess: {
      fa: 'رابط و API پایه رایگان.',
      en: 'Free interface and basic API.'
    },
    paidAccess: {
      fa: 'دسترسی با ظرفیت بالاتر برای توسعه‌دهندگان.',
      en: 'Higher-capacity access for developers.'
    },
    productUrl: 'https://honeypot.is/',
    pricingUrl: 'https://honeypot.is/',
    docsUrl: 'https://honeypot.is/'
  }),
  entry({
    id: 'blockaid',
    name: 'Blockaid',
    vendor: 'Blockaid',
    mark: 'BL',
    category: 'security',
    kind: { fa: 'تشخیص تهدید تراکنش', en: 'Transaction threat detection' },
    summary: {
      fa: 'تحلیل قبل از امضا برای شناسایی امضای مخرب، فیشینگ و قراردادهای خطرناک؛ ابزار توسعه‌دهنده برای کیف‌پول‌ها.',
      en: 'Pre-signature analysis to flag malicious signatures, phishing and dangerous contracts — a developer tool for wallets.'
    },
    bestFor: {
      fa: 'تیم‌هایی که کیف‌پول یا صرافی می‌سازند؛ کاربر عادی باید از هشدارهای کیف‌پول خودش استفاده کند.',
      en: 'Teams building wallets or exchanges; end users should rely on their own wallet’s warnings.'
    },
    freeAccess: {
      fa: 'دسترسی محدود/آزمایشی برای توسعه‌دهندگان.',
      en: 'Limited/trial developer access.'
    },
    paidAccess: {
      fa: 'طرح سازمانی با قرارداد اختصاصی.',
      en: 'Enterprise plans with custom agreements.'
    },
    productUrl: 'https://www.blockaid.io/',
    pricingUrl: 'https://docs.blockaid.io/',
    docsUrl: 'https://docs.blockaid.io/'
  }),
  entry({
    id: 'santiment',
    name: 'Santiment',
    vendor: 'Santiment',
    mark: 'S',
    category: 'trading',
    kind: { fa: 'دادهٔ احساسات و آن‌چین', en: 'Sentiment and on-chain data' },
    summary: {
      fa: 'ترکیب دادهٔ آن‌چین، اجتماعی و توسعه با API و داشبورد؛ برای تحلیل رفتار بازار.',
      en: 'Combines on-chain, social and development data with an API and dashboards for market-behaviour analysis.'
    },
    bestFor: {
      fa: 'خواندن احساسات و فعالیت توسعه؛ شاخص اجتماعی را سیگنال قطعی معامله نکنید.',
      en: 'Reading sentiment and development activity; social metrics are not a standalone signal.'
    },
    freeAccess: {
      fa: 'داشبورد و بخشی از داده رایگان؛ API پولی است.',
      en: 'Dashboards and some data are free; the API is paid.'
    },
    paidAccess: {
      fa: 'اشتراک ماهانه با دسترسی API.',
      en: 'Monthly subscription with API access.'
    },
    productUrl: 'https://app.santiment.net/',
    pricingUrl: 'https://santiment.net/pricing/',
    docsUrl: 'https://academy.santiment.net/'
  }),

  /* ── general assistants ────────────────────────────────────────────────── */
  entry({
    id: 'chatgpt',
    name: 'ChatGPT',
    vendor: 'OpenAI',
    mark: 'AI',
    category: 'general',
    kind: { fa: 'دستیار چندمنظوره', en: 'General-purpose assistant' },
    summary: {
      fa: 'برای نوشتن، تحلیل، ایده‌پردازی و کارهای روزمره؛ ابزارهای پیشرفته بر اساس طرح و دسترسی حساب محدود می‌شوند.',
      en: 'For writing, analysis, brainstorming and everyday tasks. Advanced tools and multi-step features depend on plan and account availability.'
    },
    bestFor: {
      fa: 'شروع سریع برای کارهای عمومی و ساخت پیش‌نویس؛ پاسخ مهم را با منبع اصلی بررسی کنید.',
      en: 'A quick starting point for general tasks and first drafts; verify important claims against primary sources.'
    },
    freeAccess: {
      fa: 'طرح رایگان دارد؛ برخی ابزارها و میزان استفاده محدود است.',
      en: 'A free plan is available; some tools and usage are limited.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی با دسترسی یا سقف بالاتر؛ قابلیت‌ها بسته به طرح فرق می‌کند.',
      en: 'Paid plans offer different feature access and higher limits; availability varies by plan.'
    },
    productUrl: 'https://chatgpt.com/',
    pricingUrl: 'https://chatgpt.com/pricing/'
  }),
  entry({
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    mark: 'C',
    category: 'general',
    kind: { fa: 'دستیار عمومی و کدنویسی', en: 'General and coding assistant' },
    summary: {
      fa: 'برای تحلیل و نگارش اسناد، کارهای پژوهشی و کمک به کدنویسی؛ Claude Code و برخی قابلیت‌های پژوهشی به طرح وابسته‌اند.',
      en: 'Useful for document analysis, writing, research and coding; Claude Code and some research features depend on plan.'
    },
    bestFor: {
      fa: 'خلاصه‌سازی اسناد بلند، بازنویسی دقیق و کمک به فهم یا تغییر کد.',
      en: 'Summarising long documents, careful editing, and help understanding or changing code.'
    },
    freeAccess: {
      fa: 'نسخهٔ رایگان با سقف مصرف در دسترس است؛ پشتیبانی منطقه‌ای را بررسی کنید.',
      en: 'A free tier is available with usage limits; check supported regions.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی مصرف بیشتری می‌دهند و قابلیت‌هایی مانند Claude Code/Research را فعال می‌کنند.',
      en: 'Paid plans provide more usage and unlock features such as Claude Code and Research.'
    },
    productUrl: 'https://claude.ai/',
    pricingUrl: 'https://claude.com/pricing'
  }),
  entry({
    id: 'gemini',
    name: 'Gemini',
    vendor: 'Google',
    mark: 'G',
    category: 'general',
    kind: { fa: 'دستیار چندرسانه‌ای', en: 'Multimodal assistant' },
    summary: {
      fa: 'دستیار چندرسانه‌ای گوگل با ابزارهای پژوهش و امکاناتی که می‌توانند با سرویس‌های Google همراه شوند.',
      en: 'Google’s multimodal assistant, with research tools and features that can work alongside Google services.'
    },
    bestFor: {
      fa: 'کار با متن، تصویر و محتوای روزمره؛ اگر اتصال به برنامه‌های Google را فعال می‌کنید، مجوزها را دقیق بررسی کنید.',
      en: 'Working with text, images and everyday content; carefully review permissions before connecting Google apps.'
    },
    freeAccess: {
      fa: 'با حساب Google دسترسی رایگان پایه دارد؛ سقف‌ها و مدل‌های قابل‌دسترسی ممکن است تغییر کند.',
      en: 'A basic free tier is available with a Google Account; limits and model access can change.'
    },
    paidAccess: {
      fa: 'طرح‌های Google AI امکانات و سقف‌های متفاوتی دارند و دسترسی منطقه‌ای است.',
      en: 'Google AI subscriptions offer different features and limits, with regional availability.'
    },
    productUrl: 'https://gemini.google/',
    pricingUrl: 'https://gemini.google/subscriptions/'
  }),
  entry({
    id: 'perplexity',
    name: 'Perplexity',
    vendor: 'Perplexity AI',
    mark: 'P',
    category: 'general',
    kind: { fa: 'ایجنت پژوهش وب', en: 'Web research agent' },
    summary: {
      fa: 'جست‌وجوی وب و پاسخ‌های دارای ارجاع؛ برای بررسی چندمنبعی و گزارش اولیه مناسب است.',
      en: 'Web search with cited answers, useful for multi-source research and first-pass reports.'
    },
    bestFor: {
      fa: 'پیدا کردن منابع، مقایسهٔ دیدگاه‌ها و تهیهٔ گزارش قابل‌پیگیری؛ ارجاعات را باز کنید و خودتان راستی‌آزمایی کنید.',
      en: 'Finding sources, comparing viewpoints and drafting traceable reports; open the citations and verify them yourself.'
    },
    freeAccess: {
      fa: 'جست‌وجوی پایه رایگان با سقف استفاده و قابلیت‌های محدودتر.',
      en: 'Free basic search with usage caps and fewer advanced features.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی برای پژوهش عمیق‌تر، مدل‌ها و منابع بیشتر.',
      en: 'Paid plans add higher research limits, model choices and additional sources.'
    },
    productUrl: 'https://www.perplexity.ai/',
    pricingUrl: 'https://www.perplexity.ai/hub/pricing'
  }),
  entry({
    id: 'microsoft-copilot',
    name: 'Microsoft Copilot',
    vendor: 'Microsoft',
    mark: 'M',
    category: 'general',
    kind: { fa: 'دستیار عمومی و بهره‌وری', en: 'General and productivity assistant' },
    summary: {
      fa: 'برای پرسش‌های عمومی و کارهای روزمره؛ در بعضی اشتراک‌های Microsoft 365 به برنامه‌ها و اسناد کاری هم نزدیک می‌شود.',
      en: 'For general questions and everyday work; eligible Microsoft 365 subscriptions add deeper access to work apps and documents.'
    },
    bestFor: {
      fa: 'کاربران Microsoft 365 که می‌خواهند در کنار اسناد و ایمیل‌ها از دستیار استفاده کنند؛ مجوز و دسترسی فایل‌ها را بررسی کنید.',
      en: 'Microsoft 365 users who want an assistant alongside documents and email; review licensing and file permissions.'
    },
    freeAccess: {
      fa: 'نسخهٔ رایگان برای کارهای عمومی دارد؛ قابلیت‌های Microsoft 365 جداگانه و وابسته به اشتراک‌اند.',
      en: 'A free version is available for general use; Microsoft 365 features depend on a separate subscription.'
    },
    paidAccess: {
      fa: 'قابلیت‌های بیشتر در طرح‌های Microsoft 365 شخصی یا کاری؛ قیمت و شرایط بر اساس منطقه و مجوز فرق می‌کند.',
      en: 'More features are available in Microsoft 365 personal or work plans; pricing and eligibility vary by region and license.'
    },
    productUrl: 'https://copilot.microsoft.com/',
    pricingUrl: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing'
  }),

  /* ── coding ────────────────────────────────────────────────────────────── */
  entry({
    id: 'github-copilot',
    name: 'GitHub Copilot',
    vendor: 'GitHub',
    mark: 'GH',
    category: 'coding',
    kind: { fa: 'ایجنت کدنویسی', en: 'Coding agent' },
    summary: {
      fa: 'کمک برنامه‌نویسی در محیط‌های توسعه و GitHub؛ قابلیت گفت‌وگو و ایجنت با سهمیهٔ مصرف همراه است.',
      en: 'Coding assistance across development environments and GitHub; chat and agent features use plan-based allowances.'
    },
    bestFor: {
      fa: 'تکمیل کد، بررسی تغییرها و واگذاری بعضی کارهای مخزن؛ تغییرات و تست‌ها را پیش از ادغام بازبینی کنید.',
      en: 'Code completion, review and delegating repository tasks; inspect changes and tests before merging.'
    },
    freeAccess: {
      fa: 'طرح Free با سقف محدود برای گفت‌وگو و استفاده از ایجنت دارد.',
      en: 'The Free plan includes limited chat and agent usage.'
    },
    paidAccess: {
      fa: 'طرح‌های شخصی و سازمانی با ظرفیت و امکانات بیشتر؛ مصرف مدل‌ها سهمیه‌بندی می‌شود.',
      en: 'Individual and business plans offer more capacity and features; model use is metered by allowances.'
    },
    productUrl: 'https://github.com/features/copilot',
    pricingUrl: 'https://github.com/features/copilot/plans'
  }),
  entry({
    id: 'cursor',
    name: 'Cursor',
    vendor: 'Anysphere',
    mark: 'Cu',
    category: 'coding',
    kind: { fa: 'محیط کدنویسی با ایجنت', en: 'Agentic coding environment' },
    summary: {
      fa: 'ویرایشگر کد با عامل‌های هوش مصنوعی برای فهم مخزن، برنامه‌ریزی و اعمال تغییرهای چندفایلی.',
      en: 'An AI coding editor with agents for understanding a codebase, planning and making multi-file changes.'
    },
    bestFor: {
      fa: 'توسعه‌دهندگانی که می‌خواهند عامل را روی کد خودشان اجرا کنند؛ diff، دسترسی فایل‌ها و خروجی تست را بازبینی کنید.',
      en: 'Developers who want an agent to work in their own codebase; review diffs, file access and test output.'
    },
    freeAccess: {
      fa: 'طرح رایگان با استفادهٔ محدود از Agent و Chat دارد.',
      en: 'A free plan includes limited Agent and Chat usage.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی سقف بالاتر و بعضی امکانات ابری/خودکارسازی دارند.',
      en: 'Paid plans add higher limits and, depending on plan, cloud-agent and automation features.'
    },
    productUrl: 'https://cursor.com/',
    pricingUrl: 'https://cursor.com/pricing'
  }),

  /* ── automation ────────────────────────────────────────────────────────── */
  entry({
    id: 'n8n',
    name: 'n8n Agents',
    vendor: 'n8n',
    mark: 'n8n',
    category: 'automation',
    kind: { fa: 'سازندهٔ ایجنت و گردش‌کار', en: 'Agent and workflow builder' },
    summary: {
      fa: 'برای ساخت ایجنت‌های سفارشی و اتصال ابزارها در گردش‌کار؛ به پیکربندی و نگهداری فنی بیشتری نیاز دارد.',
      en: 'Build custom agents and connect tools in workflows; it requires more technical setup and maintenance.'
    },
    bestFor: {
      fa: 'کاربر فنی که کنترل بیشتری روی ابزارها و میزبانی می‌خواهد؛ مجوز، امنیت سرور و هزینهٔ مدل را خودش مدیریت می‌کند.',
      en: 'Technical users who want more control over tools and hosting; you manage server security, licensing and model costs.'
    },
    freeAccess: {
      fa: 'نسخهٔ Community را می‌توان رایگان خودمیزبان کرد؛ هزینهٔ سرور و مدل هوش مصنوعی ممکن است جدا باشد.',
      en: 'The Community edition can be self-hosted for free; server and AI-model costs may be separate.'
    },
    paidAccess: {
      fa: 'طرح‌های ابری و تجاری پولی با سهمیهٔ اجرا و امکانات متفاوت دارد.',
      en: 'Paid cloud and business plans have different execution allowances and features.'
    },
    productUrl: 'https://n8n.io/ai-agents/',
    pricingUrl: 'https://n8n.io/pricing/'
  }),
  entry({
    id: 'zapier-agents',
    name: 'Zapier Agents',
    vendor: 'Zapier',
    mark: 'Z',
    category: 'automation',
    kind: { fa: 'پلتفرم ایجنت و اتوماسیون', en: 'Agent and automation platform' },
    summary: {
      fa: 'ساخت ایجنت‌هایی که می‌توانند در گردش‌کارهای متصل به برنامه‌های دیگر کار کنند؛ هر اقدام می‌تواند سهمیهٔ مصرف کند.',
      en: 'Build agents that work across connected apps and workflows; agent activities may consume a usage allowance.'
    },
    bestFor: {
      fa: 'کارهای تکراری بین ابزارهای کاری؛ پیش از فعال‌کردن، دسترسی‌ها و اقدام‌های مجاز هر اتصال را محدود کنید.',
      en: 'Repeated work across business apps; limit permissions and permitted actions for each connection before enabling.'
    },
    freeAccess: {
      fa: 'پلن Agents Free با سقف فعالیت دارد.',
      en: 'An Agents Free plan is available with an activity cap.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی ظرفیت بیشتر یا امکانات تیمی دارند؛ ممکن است جدا از پلن اصلی Zapier باشند.',
      en: 'Paid plans offer higher capacity or team features and may be separate from core Zapier plans.'
    },
    productUrl: 'https://zapier.com/agents',
    pricingUrl: 'https://zapier.com/pricing'
  })
]);

/** Counts per category, computed once for the filter chips. */
export const RECOMMENDATION_COUNTS = Object.freeze(
  RECOMMENDED_EXTERNAL_AGENTS.reduce((acc, row) => {
    acc[row.category] = (acc[row.category] || 0) + 1;
    acc.all = (acc.all || 0) + 1;
    return acc;
  }, {})
);
