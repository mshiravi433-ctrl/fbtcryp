/**
 * FBT SMART INTENT OS — AI UPGRADE 5: KNOWLEDGE CENTER + RETRIEVAL
 * ---------------------------------------------------------------------------
 * A controlled internal knowledge layer (§55-57). The AI retrieves the few
 * relevant items per question instead of stuffing the whole base into every
 * prompt (§56), and every item carries version/source/status metadata (§57):
 *
 *   FBT Knowledge
 *   ├── PRODUCT ├── WALLET ├── SWAP ├── INTENT_OS ├── SIGNALS ├── DEFI
 *   ├── SOLANA ├── SMART_MONEY ├── TRADING ├── FAQ ├── RISK └── GENERAL_CRYPTO
 *
 * Truth rules:
 *   - Only STABLE product knowledge lives here. Prices, balances, APYs and
 *     news NEVER do — those come from live tools (§43).
 *   - `status: 'verified'` items may be stated as fact; 'unverified' items
 *     must be hedged; 'deprecated' items are never retrieved.
 *   - Retrieval is deterministic token-overlap scoring — reproducible in tests.
 */

import { normalizeUpgrade4 } from './intentUnderstandingEngine.js';
/* The one place the platform fee exists. The knowledge item below states it
   from this constant, so the assistant can never quote a fee the engine does
   not charge. */
import { FEE_BPS, FEE_BPS_MAX, feePercentString, toEasternDigits } from '../../feeBps.js';

const feeFa = (bps = FEE_BPS) => toEasternDigits(feePercentString(bps)).replace('.', '٫');

export const KNOWLEDGE_SCHEMA = 'fbt.knowledge.v1';
export const KNOWLEDGE_CATEGORIES = Object.freeze([
  'PRODUCT', 'WALLET', 'SWAP', 'INTENT_OS', 'SIGNALS', 'DEFI',
  'SOLANA', 'SMART_MONEY', 'TRADING', 'FAQ', 'RISK', 'GENERAL_CRYPTO'
]);

export const KNOWLEDGE_STATUSES = Object.freeze(['verified', 'unverified', 'deprecated']);

const now = () => Date.now();

/* -------------------------------------------------------------------------- */
/*  SEED KNOWLEDGE — real FBT capabilities only (§58: never claim features     */
/*  that do not exist; future features must say Coming Soon)                   */
/* -------------------------------------------------------------------------- */

export const FBT_KNOWLEDGE = Object.freeze([
  {
    id: 'kb.product.overview', version: 2, category: 'PRODUCT', status: 'verified', confidence: 95,
    source: 'fbt-app',
    titleFa: 'FBT Swap چیست؟', titleEn: 'What is FBT Swap?',
    bodyFa: 'FBT Swap یک پلتفرم غیرامانی (non-custodial) برای مبادله دارایی‌های دیجیتال است: سواپ، بریج بین شبکه‌ها، فارم و کسب سود، سیگنال‌ها، اسمارت مانی و دستیار هوشمند Intent AI. کلیدهای کیف پول همیشه روی دستگاه خود کاربر می‌مانند و FBT هرگز عبارت بازیابی یا کلید خصوصی نمی‌خواهد.',
    bodyEn: 'FBT Swap is a non-custodial digital asset platform: swaps, cross-chain bridges, farming and yield, signals, smart-money tracking and the Intent AI assistant. Wallet keys always stay on the user device; FBT never asks for seed phrases or private keys.',
    updatedAt: now()
  },
  {
    id: 'kb.wallet.custody', version: 2, category: 'WALLET', status: 'verified', confidence: 98,
    source: 'fbt-security-policy',
    titleFa: 'کلیدهای من کجاست؟', titleEn: 'Where are my keys?',
    bodyFa: 'کیف پول FBT غیرامانی است: کلید خصوصی و عبارت بازیابی فقط روی دستگاه شما ساخته و نگهداری می‌شوند. هیچ سروری آن‌ها را نمی‌بیند. تراکنش‌ها بدون امضای کیف پول شما اجرا نمی‌شوند و تراکنش روی‌زنجیره برگشت‌ناپذیر است.',
    bodyEn: 'The FBT wallet is non-custodial: your private key and recovery phrase are created and stored only on your device. No server ever sees them. Transactions never run without your wallet signature, and on-chain transactions are irreversible.',
    updatedAt: now()
  },
  {
    id: 'kb.wallet.never-asks', version: 1, category: 'WALLET', status: 'verified', confidence: 99,
    source: 'fbt-security-policy',
    titleFa: 'FBT هرگز چه چیزی نمی‌پرسد؟', titleEn: 'What will FBT never ask for?',
    bodyFa: 'FBT و پشتیبانی FBT هرگز عبارت بازیابی (seed phrase)، کلید خصوصی، رمز کیف پول یا کد تأیید دو مرحله‌ای شما را نمی‌پرسند. هر کسی این‌ها را خواست — حتی با نام FBT — کلاهبردار است.',
    bodyEn: 'FBT and FBT support will never ask for your recovery phrase, private key, wallet password or 2FA codes. Anyone asking for them — even claiming to be FBT — is a scammer.',
    updatedAt: now()
  },
  {
    id: 'kb.swap.howto', version: 2, category: 'SWAP', status: 'verified', confidence: 92,
    source: 'fbt-app',
    titleFa: 'سواپ چگونه کار می‌کند؟', titleEn: 'How does swapping work?',
    bodyFa: 'مبدأ و مقصد را انتخاب می‌کنید، FBT بهترین مسیر را بین صرافی‌های غیرمتمرکز مقایسه می‌کند و قیمت، کارمزد شبکه و اسلیپیج را در پیش‌نمایش نشان می‌دهد. اجرا فقط با تأیید و امضای کیف پول شما انجام می‌شود.',
    bodyEn: 'Pick source and target; FBT compares routes across decentralized venues and shows price, network fee and slippage in the preview. Execution happens only after your wallet signature.',
    updatedAt: now()
  },
  {
    id: 'kb.bridge.howto', version: 1, category: 'SWAP', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'بریج بین شبکه‌ها', titleEn: 'Cross-chain bridging',
    bodyFa: 'بریج دارایی را از یک شبکه به شبکه دیگر منتقل می‌کند. FBT مسیرها را با کارمزد و زمان تقریبی مقایسه می‌کند. قبل از تأیید، شبکه مقصد و آدرس را دوباره بررسی کنید؛ تراکنش بریج برگشت‌ناپذیر است.',
    bodyEn: 'A bridge moves an asset from one chain to another. FBT compares routes with fees and estimated timing. Double-check the target chain and address before confirming; bridge transactions are irreversible.',
    updatedAt: now()
  },
  {
    id: 'kb.intentos.overview', version: 3, category: 'INTENT_OS', status: 'verified', confidence: 93,
    source: 'fbt-app',
    titleFa: 'Intent AI چه کاری انجام می‌دهد؟', titleEn: 'What does Intent AI do?',
    bodyFa: 'Intent AI دستیار هوشمند FBT است: درخواست شما را به زبان فارسی یا انگلیسی می‌فهمد، داده‌های زنده بازار و کیف پول را بررسی می‌کند، برای کارهای پیچیده از همکاری چند مدل هوش مصنوعی و تحقیق وب استفاده می‌کند و برای هر اقدام مالی حتماً تأیید شما را می‌گیرد. هیچ اقدامی بدون امضای کیف پول شما اجرا نمی‌شود.',
    bodyEn: 'Intent AI is FBT\'s assistant: it understands requests in Persian or English, checks live market and wallet data, uses multi-AI collaboration and web research for complex questions, and always requires your confirmation for financial actions. Nothing executes without your wallet signature.',
    updatedAt: now()
  },
  {
    id: 'kb.intentos.multi-ai', version: 1, category: 'INTENT_OS', status: 'verified', confidence: 90,
    source: 'fbt-ai-upgrade5',
    titleFa: 'همکاری چند مدل هوش مصنوعی', titleEn: 'Multi-AI collaboration',
    bodyFa: 'برای سؤال‌های پیچیده، FBT به‌جای یک مدل از همکاری چند مدل تخصصی (بازار، ریسک، تحقیق، راستی‌آزمایی) استفاده می‌کند و نتیجه را با داده‌های معتبر و منابع وب می‌سنجد. پاسخ نهایی یک جواب واحد FBT است، نه چند پاسخ پراکنده.',
    bodyEn: 'For complex questions FBT coordinates several specialized models (market, risk, research, verification) and weighs their output against trusted data and web sources. You receive one coherent FBT answer, not several scattered ones.',
    updatedAt: now()
  },
  {
    id: 'kb.signals.nature', version: 1, category: 'SIGNALS', status: 'verified', confidence: 88,
    source: 'fbt-app',
    titleFa: 'سیگنال‌ها چیستند؟', titleEn: 'What are signals?',
    bodyFa: 'سیگنال‌های FBT خلاصه‌ای تحلیلی از وضعیت بازار و جریان پول هوشمند هستند. سیگنال تضمین سود نیست و جای تصمیم شخصی شما را نمی‌گیرد؛ همیشه ریسک و افق زمانی را در نظر بگیرید.',
    bodyEn: 'FBT signals are analytical summaries of market state and smart-money flow. A signal is not a profit guarantee and never replaces your own decision; always weigh risk and time horizon.',
    updatedAt: now()
  },
  {
    id: 'kb.smartmoney.nature', version: 1, category: 'SMART_MONEY', status: 'verified', confidence: 87,
    source: 'fbt-app',
    titleFa: 'اسمارت مانی چیست؟', titleEn: 'What is smart money?',
    bodyFa: 'بخش اسمارت مانی جریان انتقال دارایی کیف پول‌های بزرگ و برچسب‌خورده (صرافی‌ها، نهنگ‌ها، میم‌بات‌ها) را روی‌زنجیره رصد می‌کند. این داده مشاهده‌ای است، نه پیش‌بینی؛ جریان دیروز تضمین حرکت امروز نیست.',
    bodyEn: 'Smart money tracks on-chain transfers of large, labelled wallets (exchanges, whales, MEV bots). It is observational data, not prediction; yesterday\'s flow does not guarantee today\'s move.',
    updatedAt: now()
  },
  {
    id: 'kb.defi.yield-rules', version: 1, category: 'DEFI', status: 'verified', confidence: 90,
    source: 'fbt-risk-policy',
    titleFa: 'سود DeFi و ریسک آن', titleEn: 'DeFi yield and its risks',
    bodyFa: 'APY نمایش‌داده‌شده برای استخرها لحظه‌ای و متغیر است. ریسک‌های اصلی: تغییر نرخ، ریسک قرارداد هوشمند و ضرر ناپایدار (impermanent loss) در استخرهای دوطرفه. عدد APY هیچ تضمینی برای آینده نیست.',
    bodyEn: 'Displayed pool APY is instantaneous and variable. Main risks: rate changes, smart-contract risk and impermanent loss in two-sided pools. An APY figure is no promise about the future.',
    updatedAt: now()
  },
  {
    id: 'kb.trading.no-advice', version: 1, category: 'TRADING', status: 'verified', confidence: 95,
    source: 'fbt-risk-policy',
    titleFa: 'FBT توصیه مالی نمی‌کند', titleEn: 'FBT does not give financial advice',
    bodyFa: 'تحلیل‌های FBT (سناریوی صعودی/نزولی/خنثی، امتیاز ریسک) ابزار تصمیم‌گیری هستند، نه دستور خرید یا فروش. هیچ مدل هوش مصنوعی نمی‌تواند بازار را قطعی پیش‌بینی کند؛ مسئولیت تصمیم با شماست.',
    bodyEn: 'FBT analysis (bull/bear/neutral scenarios, risk scores) is decision support, not a buy or sell instruction. No AI model can predict markets with certainty; the decision is yours.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.volatility', version: 1, category: 'RISK', status: 'verified', confidence: 94,
    source: 'fbt-risk-policy',
    titleFa: 'نوسان بازار طبیعی است', titleEn: 'Market volatility is normal',
    bodyFa: 'نوسان شدید بخشی از بازار کریپتو است. قبل از هر تصمیم هیجانی: اندازه پوزیشن، سناریوی نزولی و توان تحمل ضرر را بررسی کنید. فروش یا خرید از روی ترس یا FOMO یکی از پرتکرارترین دلایل ضرر کاربران است.',
    bodyEn: 'Sharp volatility is part of crypto. Before any impulsive move, review position size, the downside scenario and your loss tolerance. Trading out of fear or FOMO is among the most common causes of user losses.',
    updatedAt: now()
  },
  {
    id: 'kb.general.btc', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 96,
    source: 'general-crypto',
    titleFa: 'بیت کوین (BTC) چیست؟', titleEn: 'What is Bitcoin (BTC)?',
    bodyFa: 'بیت کوین اولین شبکه پولی غیرمتمرکز است (۲۰۰۹، ساتوشی ناکاموتو)؛ بدون بانک یا واسطه، با دفتر کل عمومی (بلاک‌چین) و عرضه محدود ۲۱ میلیون واحد. استخراج با اثبات کار انجام می‌شود و halvings عرضه جدید را هر ~۴ سال نصف می‌کنند.',
    bodyEn: 'Bitcoin is the first decentralized money network (2009, Satoshi Nakamoto): no bank or intermediary, a public ledger (blockchain) and a capped supply of 21 million coins. Secured by proof-of-work; halvings cut new supply roughly every 4 years.',
    updatedAt: now()
  },
  {
    id: 'kb.general.usdt', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 95,
    source: 'general-crypto',
    titleFa: 'تتر (USDT) چیست؟', titleEn: 'What is Tether (USDT)?',
    bodyFa: 'تتر یک استیبل‌کوین با ارزش متصل به دلار آمریکا است که روی شبکه‌های مختلف (از جمله Ethereum، Tron و Solana) منتشر می‌شود. برای انتقال دلار بدون نوسان استفاده می‌شود؛ همیشه به شبکه درست دقت کنید، چون ارسال به شبکه اشتباه ممکن است غیرقابل بازیابی باشد.',
    bodyEn: 'Tether is a stablecoin pegged to the US dollar, issued on several networks (including Ethereum, Tron and Solana). Used to move dollar value without volatility; always check the network — sending on the wrong network can be unrecoverable.',
    updatedAt: now()
  },
  {
    id: 'kb.general.eth', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 95,
    source: 'general-crypto',
    titleFa: 'اتریوم (ETH) چیست؟', titleEn: 'What is Ethereum (ETH)?',
    bodyFa: 'اتریوم شبکه‌ای برای قراردادهای هوشمند و برنامه‌های غیرمتمرکز (dApps) است؛ اتر (ETH) سوخت اجرای عملیات روی آن است. بیشتر اکوسیستم DeFi و NFT روی اتریوم و لایه‌های دوم آن ساخته شده‌اند.',
    bodyEn: 'Ethereum is the network for smart contracts and decentralized apps; ether (ETH) fuels execution. Most of DeFi and NFTs are built on Ethereum and its layer-2s.',
    updatedAt: now()
  },
  {
    id: 'kb.solana.network', version: 1, category: 'SOLANA', status: 'verified', confidence: 92,
    source: 'general-crypto',
    titleFa: 'شبکه سولانا', titleEn: 'The Solana network',
    bodyFa: 'سولانا یک بلاک‌چین با کارمزد بسیار پایین و تأیید سریع تراکنش است؛ FBT سواپ و دارایی‌های Solana را پشتیبانی می‌کند. توکن بومی آن SOL برای کارمزد و اعتبارسنجی استفاده می‌شود.',
    bodyEn: 'Solana is a blockchain with very low fees and fast confirmation; FBT supports Solana swaps and assets. Its native token SOL pays fees and secures validation.',
    updatedAt: now()
  },
  {
    id: 'kb.product.dca', version: 1, category: 'PRODUCT', status: 'verified', confidence: 89,
    source: 'fbt-app',
    titleFa: 'خرید خودکار (DCA)', titleEn: 'DCA automation',
    bodyFa: 'با خودکارسازی FBT می‌توانید خرید دوره‌ای (مثلاً روزانه یا هفتگی) بسازید تا نوسان نقطه ورود میانگین شود. هر چرخه طبق قوانین اجرا و در صورت نیاز تأیید می‌شود؛ می‌توانید هر زمان مکث یا لغو کنید.',
    bodyEn: 'FBT automations let you schedule recurring buys (e.g. daily or weekly) so entry timing is averaged. Each cycle runs under your rules, can be paused or cancelled at any time.',
    updatedAt: now()
  },
  {
    id: 'kb.product.fee', version: 1, category: 'PRODUCT', status: 'verified', confidence: 97,
    source: 'src/lib/feeBps.js',
    titleFa: 'کارمزد پلتفرم چقدر است؟', titleEn: 'What is the platform fee?',
    bodyFa: `کارمزد پلتفرم FBT ${feeFa()}٪ (${toEasternDigits(String(FEE_BPS))} بیسیس‌پوینت) برای هر سواپ است و سقف سخت آن ${feeFa(FEE_BPS_MAX)}٪ است. کارمزد شبکه (گس) جدا از این مبلغ است و به شبکهٔ مقصد بستگی دارد. این عدد در یک ماژول واحد تعریف شده و مقدار خارج از بازهٔ مجاز به پیش‌فرض برمی‌گردد.`,
    bodyEn: `The FBT platform fee is ${feePercentString()}% (${FEE_BPS} bps) per swap, hard-capped at ${feePercentString(FEE_BPS_MAX)}%. Network gas is separate and depends on the destination chain. The rate lives in one module, and an out-of-range value falls back to the default.`,
    updatedAt: now()
  },
  {
    id: 'kb.product.team', version: 1, category: 'PRODUCT', status: 'verified', confidence: 99,
    source: 'fbt-app',
    titleFa: 'سازندگان FBT چه کسانی هستند؟', titleEn: 'Who are the makers of FBT?',
    bodyFa: 'نام سازندگان، بنیان‌گذاران و اعضای تیم FBT در دانش تأییدشدهٔ محصول ثبت نشده است. دستیار هوشمند FBT در این حالت به‌جای حدس زدن نام، صریح می‌گوید که این اطلاعات در دانش ثبت نشده و کاربر را به کانال‌های رسمی (صفحهٔ دربارهٔ ما و صفحهٔ تماس) ارجاع می‌دهد. آنچه تأیید شده این است: FBT غیرامانی است، کلیدها روی دستگاه کاربر می‌مانند و FBT هرگز عبارت بازیابی یا کلید خصوصی نمی‌خواهد.',
    bodyEn: 'The names of FBT’s makers, founders and team members are not recorded in the verified product knowledge. Instead of guessing a name, the assistant says the information is not recorded and points the user to the official channels (About and Contact pages). What is verified: FBT is non-custodial, keys stay on the user device, and FBT never asks for a recovery phrase or private key.',
    updatedAt: now()
  },
  {
    id: 'kb.product.pages', version: 1, category: 'PRODUCT', status: 'verified', confidence: 94,
    source: 'src/App.jsx',
    titleFa: 'FBT چه صفحه‌هایی دارد؟', titleEn: 'Which pages does FBT have?',
    bodyFa: 'فهرست صفحه‌های FBT از خود جدول مسیرهای برنامه خوانده می‌شود و شامل بازار، صفحهٔ هر دارایی، مقایسه، سواپ، بریج، کیف پول، سبد، سیگنال‌ها، اسمارت مانی، سهام توکن‌شده، وام، کسب سود، فارم، خزانه، سفارش‌ها، NFT، اخبار، کشف، فرصت‌ها، اکوسیستم، توسعه‌دهندگان، آموزش، راهنما، امنیت، تنظیمات، جوایز، اجتماعی، رهبران بازار، بیمه، آزمایشگاه، لانچ‌پد و صفحات حقوقی است. مسیرهای مربوط به معاملات مشتقه و شرط‌بندی قیمتی فقط وقتی فعال‌اند که پرچم مربوطه روشن باشد. هیچ صفحه‌ای خارج از این جدول وجود ندارد و دستیار مسیر نمی‌سازد.',
    bodyEn: 'The page list is read from the app’s own route table: market, per-asset pages, compare, swap, bridge, wallet, portfolio, signals, smart money, tokenized stocks, loans, earn, farm, vault, orders, NFT, news, discover, opportunities, ecosystem, developers, learn, help, security, settings, rewards, social, leaderboard, insurance, lab, launchpad and the legal pages. Derivative and price-prediction routes exist only when their feature flag is on. No page exists outside this table, and the assistant never invents a route.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.mvrv', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 95,
    source: 'onchain-valuation-standard',
    tags: ['mvrv', 'realized', 'cap', 'valuation', 'ارزش‌گذاری', 'ام وی آر وی', 'انچین', 'آنچین'],
    titleFa: 'شاخص MVRV چیست و چطور تفسیر می‌شود؟', titleEn: 'What is MVRV and how is it read?',
    bodyFa: 'MVRV نسبت ارزش بازار به ارزش تحقق‌یافته (Market Cap ÷ Realized Cap) است. Realized Cap هر کوین را با آخرین قیمت جابه‌جایی روی‌زنجیره ارزش‌گذاری می‌کند و برآوردی از میانگین بهای تمام‌شدهٔ هولدرهاست. وقتی MVRV بسیار بالاتر از محدوده‌های تاریخی باشد (مثلاً بالای ۳ تا ۳٫۷ در چرخه‌های گذشته BTC)، سود تحقق‌نیافته و فشار فروش احتمالی بالاست؛ وقتی نزدیک یا زیر ۱ باشد، بخش بزرگی از بازار در زیان است که تاریخاً با نواحی تسلیم و انباشت هم‌زمان بوده است. محدودیت مهم: انتقال‌های نهادی و ETFها می‌توانند Realized Cap را جابه‌جا کنند، بنابراین MVRV به‌تنهایی ابزار زمان‌بندی دقیق نیست و با جریان نقدینگی و ساختار بازار خوانده می‌شود.',
    bodyEn: 'MVRV is the ratio of Market Cap to Realized Cap (which values each coin at the price it last moved on-chain, estimating aggregate holder cost basis). Historically, elevated MVRV (for example above 3–3.7 in past Bitcoin cycles) indicates large unrealized profits and higher distribution risk, whereas MVRV near or below 1 indicates widespread unrealized loss and historical capitulation/accumulation zones. Key caveat: institutional custody and ETF settlement flows alter on-chain UTXO velocity, so MVRV is a macro valuation gauge rather than a standalone timing signal.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.onchain-metrics', version: 1, category: 'TRADING', status: 'verified', confidence: 93,
    source: 'derivatives-onchain-handbook',
    tags: ['sopr', 'funding', 'open interest', 'etf', 'netflow', 'فاندینگ', 'اوپن اینترست', 'آنچین', 'نقدینگی'],
    titleFa: 'شاخص‌های آن‌چین و مشتقات (SOPR، Funding Rate، Open Interest، جریان ETF)', titleEn: 'On-chain & derivatives signals (SOPR, Funding Rate, Open Interest, ETF flows)',
    bodyFa: 'در تحلیل ساختار بازار چهار شاخص مکمل قیمت هستند: ۱) SOPR نشان می‌دهد کوین‌های جابه‌جاشده با سود (>۱) یا ضرر (<۱) خرج شده‌اند؛ ۲) Funding Rate هزینهٔ نگهداری پوزیشن‌های دائمی است — فاندینگ بسیار مثبت نشانهٔ ازدحام لانگ اهرمی و ریسک لانگ‌اسکوئیز است؛ ۳) Open Interest مجموع قراردادهای باز است که جهش آن همراه با افزایش قیمت یعنی ورود اهرم تازه؛ ۴) جریان خالص ETF و صرافی‌ها (Exchange Netflow) فشار تقاضای نهادی در برابر عرضهٔ قابل‌فروش در صرافی را نشان می‌دهد.',
    bodyEn: 'Four structural series complement spot price: (1) SOPR shows whether coins moving on-chain are spent in profit (>1) or loss (<1); (2) Funding Rate reflects perpetual-futures positioning bias — extreme positive funding signals crowded longs vulnerable to squeezes; (3) Open Interest tracks active leverage; (4) Spot ETF net inflows and Exchange Netflows measure institutional absorption versus coins positioned to sell.',
    updatedAt: now()
  },
  {
    id: 'kb.economics.inflation-scarce-assets', version: 1, category: 'RISK', status: 'verified', confidence: 94,
    source: 'monetary-economics-principles',
    tags: ['تورم', 'کمیاب', 'طلا', 'دارایی', 'نرخ بهره', 'inflation', 'scarce', 'gold', 'debasement', 'real yield'],
    titleFa: 'چرا تورم و سیاست پولی بر دارایی‌های کمیاب (طلا و بیت‌کوین) اثر می‌گذارد؟', titleEn: 'Why inflation affects scarce assets (gold, Bitcoin, real assets)',
    bodyFa: 'از دید اقتصاد کلان، سازوکار اثر تورم بر دارایی‌های کمیاب سه بخش دارد: ۱) رقیق‌شدن قدرت خرید پول فیات (Monetary Debasement): وقتی عرضه پول سریع‌تر از تولید واقعی رشد می‌کند، قیمت اسمی دارایی‌هایی که عرضهٔ غیرکشسان و محدود دارند (مثل ۲۱ میلیون واحد بیت‌کوین یا استخراج محدود طلا) بازتنظیم می‌شود؛ ۲) هزینهٔ فرصت و نرخ بهره واقعی (Real Yield = نرخ اسمی منهای تورم): وقتی تورم از نرخ بهره پیشی بگیرد یا نرخ واقعی منفی شود، هزینهٔ فرصت نگهداری دارایی بدون سود نقدی کاهش می‌یابد و سرمایه به سمت ذخیرهٔ ارزش حرکت می‌کند؛ ۳) نکته و شرط ابطال: در موج اول تورم اگر بانک مرکزی نرخ بهره واقعی را تند بالا ببرد و نقدینگی را جمع کند (QT)، دارایی‌های ریسکی و حتی طلا ممکن است موقتاً زیر فشار نقدینگی افت کنند تا زمانی که انقباض متوقف یا نرخ واقعی افت کند.',
    bodyEn: 'In macroeconomics, inflation transmits to scarce assets through three channels: (1) Fiat dilution & supply inelasticity — when money supply outpaces real output, assets with hard or slow-growing supply (such as gold or capped 21M Bitcoin) reprice in nominal terms; (2) Real yield & opportunity cost — lower or negative real interest rates (nominal rate minus inflation) cut the opportunity cost of holding non-yielding stores of value; (3) Crucial nuance & falsifier — if inflation forces central banks into aggressive real-rate hikes and quantitative tightening, liquidity contraction can pressure scarce and risk assets in the short run until tightening peaks.',
    updatedAt: now()
  },
  {
    id: 'kb.economics.rates-liquidity', version: 1, category: 'TRADING', status: 'verified', confidence: 93,
    source: 'macro-transmission-framework',
    tags: ['نرخ بهره', 'فدرال', 'دلار', 'dxy', 'نقدینگی', 'fed', 'fomc', 'liquidity', 'rates', 'm2'],
    titleFa: 'کانال انتقال نرخ بهره، شاخص دلار (DXY) و نقدینگی جهانی به بازار کریپتو', titleEn: 'How interest rates, DXY and global liquidity transmit to crypto',
    bodyFa: 'بیت‌کوین و بازار کریپتو به چرخهٔ نقدینگی جهانی حساس‌اند: کاهش نرخ بهره واقعی و تضعیف شاخص دلار (DXY) هزینهٔ تأمین مالی را کم کرده و اشتهای ریسک (Risk-On) را تقویت می‌کند؛ برعکس، جهش بازده اوراق خزانه و انقباض نقدینگی (QT) اهرم‌ها را جمع می‌کند و بر دارایی‌های پرنوسان فشار می‌آورد. شرط ابطال این رابطه زمانی است که یک محرک خاص درون‌بخشی (مثل بحران اعتباری بانکی یا ورود مستقیم سرمایه نهادی) همبستگی کوتاه‌مدت با بازار سهام را بشکند.',
    bodyEn: 'Crypto is highly sensitive to global liquidity cycles: falling real yields and a softer DXY lower financing costs and support risk-on allocation, while rising real treasury yields and quantitative tightening drain marginal leverage. This transmission breaks temporarily when crypto-specific flows (such as institutional spot ETF inflows or systemic credit stress) dominate macro beta.',
    updatedAt: now()
  },
  {
    id: 'kb.economics.btc-drivers', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 94,
    source: 'btc-market-structure',
    tags: ['بیت کوین', 'رشد', 'صعود', 'هاوینگ', 'etf', 'عرضه', 'btc', 'bitcoin', 'growth', 'halving'],
    titleFa: 'محرک‌های بنیادین و ریسک‌های رشد بیت‌کوین (BTC)', titleEn: 'Fundamental drivers and invalidation risks for Bitcoin (BTC)',
    bodyFa: 'برآیند رشد یا افت بیت‌کوین بر چهار اهرم می‌چرخد: ۱) عرضهٔ غیرکشسان (سقف ۲۱ میلیون و نصف‌شدن صدور جدید در هر هاوینگ)، ۲) تقاضای حاشیه‌ای و جریان نهادی (ورود/خروج خالص ETFها و خزانه‌های شرکتی)، ۳) نقدینگی کلان و نرخ بهره واقعی، و ۴) بازتاب‌پذیری اهرم در مشتقات. بر پایه نرخ پایه تاریخی، چرخه‌های صعودی پایدار معمولاً هم‌زمان با تقاضای واقعی اسپات و انبساط نقدینگی بوده‌اند؛ در مقابل، خروج مداوم جریان ETF، افزایش نرخ بهره واقعی یا شوک نقدینگی می‌تواند فرضیه رشد را باطل یا به تأخیر بیندازد.',
    bodyEn: 'Bitcoin’s medium-term trajectory rests on four pillars: (1) supply inelasticity (21M hard cap and post-halving issuance reduction), (2) marginal spot demand such as net ETF/institutional inflows, (3) macro liquidity and real interest rates, and (4) derivatives leverage reflexivity. Historically, durable expansions combine positive spot demand with easing liquidity; sustained ETF outflows, rising real rates, or macro risk-off shocks weaken or invalidate a bullish thesis.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.tokenomics-valuation', version: 1, category: 'RISK', status: 'verified', confidence: 92,
    source: 'tokenomics-risk-standard',
    tags: ['fdv', 'market cap', 'unlock', 'عرضه', 'توکنومیکس', 'حجم بازار', 'تورم توکن'],
    titleFa: 'تفاوت Market Cap و FDV و ریسک آزادسازی توکن‌ها (Token Unlocks)', titleEn: 'Market Cap vs FDV and token unlock dilution risk',
    bodyFa: 'Market Cap حاصل‌ضرب قیمت در عرضهٔ در گردش فعلی است، اما FDV (ارزش رقیق‌شدهٔ کامل) قیمت را در کل عرضهٔ نهایی ضرب می‌کند. پروژه‌هایی با شناوری پایین (Low Float) و FDV بالا در زمان آزادسازی توکن‌های تیم یا سرمایه‌گذاران (Vesting Unlocks) با فشار عرضهٔ ساختاری روبه‌رو می‌شوند، مگر آنکه تقاضای واقعی و درآمد پروتکل هم‌زمان رشد کند.',
    bodyEn: 'Market Cap multiplies price by circulating supply, while FDV uses total maximum supply. Low-float / high-FDV tokens face structural sell pressure during scheduled team and investor unlocks unless organic protocol demand scales proportionally.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.position-sizing', version: 1, category: 'RISK', status: 'verified', confidence: 95,
    source: 'fbt-risk-discipline',
    tags: ['مدیریت ریسک', 'پله', 'سبد', 'حد ضرر', 'اهرم', 'تنوع', 'position', 'sizing', 'dca', 'allocation'],
    titleFa: 'اصول تخصیص سبد، ورود پله‌ای و مدیریت ریسک بدون اهرم', titleEn: 'Portfolio allocation, staged entry and non-leveraged risk control',
    bodyFa: 'در بازار پرنوسان، بقا بر بیشینه‌سازی سود کوتاه‌مدت اولویت دارد: ۱) مشخص کردن افق زمانی و بیشینه افت قابل‌تحمل (Drawdown Budget) پیش از ورود؛ ۲) نگهداری دارایی‌های هسته‌ای با نقدشوندگی بالا و پرهیز از تمرکز بیش از حد روی یک توکن پرریسک؛ ۳) ورود و خروج پله‌ای (DCA / Staged Scaling) به‌جای خرید یک‌جا؛ ۴) نگهداری حاشیه نقدینگی استیبل‌کوین و اجتناب از اهرم برای جلوگیری از لیکوییدیشن اجباری.',
    bodyEn: 'In volatile markets, survival precedes optimization: (1) define time horizon and maximum acceptable drawdown before sizing positions; (2) anchor core allocation in deep-liquidity assets and cap single-asset concentration; (3) scale entries and exits in stages rather than lump-sum timing; (4) hold a stablecoin buffer and avoid leverage that forces liquidation on routine swings.',
    updatedAt: now()
  }
]);

/* -------------------------------------------------------------------------- */
/*  RETRIEVAL (§56)                                                            */
/* -------------------------------------------------------------------------- */

function tokenize(text) {
  return new Set(
    normalizeUpgrade4(text)
      .split(/\s+/)
      .map((w) => w.replace(/\u200c/g, ''))
      .filter((w) => w.length >= 3)
  );
}

function tokenizeWithAliases(text) {
  const raw = String(text || '')
    .replace(/بیت\s*کوین|بیتکوین/gi, ' بیتکوین بیت کوین btc bitcoin ')
    .replace(/اتریوم/gi, ' اتریوم eth ethereum ')
    .replace(/سولانا/gi, ' سولانا sol solana ')
    .replace(/ام\s*وی\s*ار\s*وی|ام\s*وی\s*آر\s*وی/gi, ' mvrv ')
    .replace(/نرخ\s*بهره/gi, ' نرخ بهره rates interest yield ')
    .replace(/تورم/gi, ' تورم inflation ');
  return new Set(
    normalizeUpgrade4(raw)
      .split(/\s+/)
      .map((w) => w.replace(/\u200c/g, ''))
      .filter((w) => w.length >= 3)
  );
}

/**
 * Retrieve the most relevant knowledge items for a question. Deterministic
 * token-overlap scoring; deprecated items are never returned.
 */
export function searchKnowledge(query, { locale = 'fa', limit = 3, category = null } = {}) {
  const qTokens = tokenizeWithAliases(query);
  if (!qTokens.size) return [];

  const scored = [];
  for (const item of FBT_KNOWLEDGE) {
    if (item.status === 'deprecated') continue;
    if (category && item.category !== category) continue;
    const isFa = String(locale).startsWith('fa');
    const title = isFa ? item.titleFa : item.titleEn;
    const body = isFa ? item.bodyFa : item.bodyEn;
    const tagStr = Array.isArray(item.tags) ? item.tags.join(' ') : '';
    const titleTokens = tokenizeWithAliases(`${title} ${tagStr}`);
    const iTokens = tokenizeWithAliases(`${title} ${body} ${tagStr} ${item.category}`);
    let overlap = 0;
    for (const t of qTokens) {
      if (titleTokens.has(t)) overlap += 1.6;
      else if (iTokens.has(t)) overlap += 1;
    }
    /* Partial-word bonus for Persian stems («کیف پول» vs «کیف پولم») */
    for (const t of qTokens) {
      if (!iTokens.has(t) && t.length >= 4) {
        for (const it of iTokens) {
          if (it.startsWith(t.slice(0, 4)) || t.startsWith(it.slice(0, 4))) { overlap += 0.5; break; }
        }
      }
    }
    if (overlap <= 0) continue;
    const score = Math.round((overlap / Math.max(1, qTokens.size)) * 100);
    scored.push({
      schema: KNOWLEDGE_SCHEMA,
      id: item.id,
      version: item.version,
      category: item.category,
      status: item.status,
      confidence: item.confidence,
      source: item.source,
      title,
      body,
      bodyEn: item.bodyEn,
      score
    });
  }
  return scored
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function getKnowledgeItem(id) {
  const item = FBT_KNOWLEDGE.find((k) => k.id === id);
  if (!item) return null;
  return {
    schema: KNOWLEDGE_SCHEMA,
    id: item.id,
    version: item.version,
    category: item.category,
    status: item.status,
    confidence: item.confidence,
    source: item.source,
    titleFa: item.titleFa,
    titleEn: item.titleEn,
    bodyFa: item.bodyFa,
    bodyEn: item.bodyEn,
    updatedAt: item.updatedAt
  };
}

export function listKnowledge({ category = null, includeDeprecated = false } = {}) {
  return FBT_KNOWLEDGE
    .filter((k) => (!category || k.category === category) && (includeDeprecated || k.status !== 'deprecated'))
    .map((k) => ({
      schema: KNOWLEDGE_SCHEMA,
      id: k.id,
      version: k.version,
      category: k.category,
      status: k.status,
      confidence: k.confidence,
      source: k.source,
      titleFa: k.titleFa,
      titleEn: k.titleEn,
      updatedAt: k.updatedAt
    }));
}

export function knowledgeStats() {
  const byCategory = {};
  const byStatus = {};
  for (const k of FBT_KNOWLEDGE) {
    byCategory[k.category] = (byCategory[k.category] || 0) + 1;
    byStatus[k.status] = (byStatus[k.status] || 0) + 1;
  }
  return { total: FBT_KNOWLEDGE.length, categories: KNOWLEDGE_CATEGORIES, byCategory, byStatus };
}
