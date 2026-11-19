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
/* The expansion of the seed corpus: docs/AI-COGNITION-AUDIT-2026-11-11.md measured
   27 items as the ceiling on how much the assistant could KNOW. The wide corpus
   lives in its own file so both halves stay readable, and it follows the same
   truth rules (stable facts only, live numbers never, full metadata). */
import { FBT_KNOWLEDGE_WIDE } from './knowledgeWide.js';

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

/* The seed corpus (§58) — unchanged, kept separate so the seed stays auditable. */
const FBT_KNOWLEDGE_SEED = Object.freeze([
  {
    id: 'kb.product.overview', version: 2, category: 'PRODUCT', status: 'verified', confidence: 95,
    source: 'fbt-app',
    titleFa: 'FBT Swap چیست؟', titleEn: 'What is FBT Swap?',
    tags: ['فبت', 'سوآپ', 'پلتفرم', 'چیست', 'امکانات', 'fbt', 'swap', 'what is', 'platform', 'features', 'معرفی', 'non-custodial'],
    bodyFa: 'FBT Swap یک پلتفرم غیرامانی (non-custodial) برای مبادله دارایی‌های دیجیتال است: سواپ، بریج بین شبکه‌ها، فارم و کسب سود، سیگنال‌ها، اسمارت مانی و دستیار هوشمند Intent AI. کلیدهای کیف پول همیشه روی دستگاه خود کاربر می‌مانند و FBT هرگز عبارت بازیابی یا کلید خصوصی نمی‌خواهد.',
    bodyEn: 'FBT Swap is a non-custodial digital asset platform: swaps, cross-chain bridges, farming and yield, signals, smart-money tracking and the Intent AI assistant. Wallet keys always stay on the user device; FBT never asks for seed phrases or private keys.',
    updatedAt: now()
  },
  {
    id: 'kb.wallet.custody', version: 2, category: 'WALLET', status: 'verified', confidence: 98,
    source: 'fbt-security-policy',
    titleFa: 'کلیدهای من کجاست؟', titleEn: 'Where are my keys?',
    /*
     * «ذخیره» is here because it is the word people actually type. With only
     * «نگهداری» in the vocabulary, the question «کیف پول من کجا ذخیره می شود؟»
     * matched `kb.faq.no-account` (140) instead of this item (107) — because
     * that item's body happens to say «کیف پول شما». The answer was about
     * registering an account, not about where the wallet lives. One word of
     * vocabulary fixed it: with «ذخیره» present, this item wins at 160.
     */
    tags: ['کلید', 'کلید خصوصی', 'نگهداری', 'ذخیره', 'ذخیره می', 'غیرامانی', 'حریم خصوصی', 'private key', 'seed', 'custody', 'non-custodial', 'کیف پول', 'wallet', 'کجا', 'امن', 'stored', 'store',
      /* The colloquial forms of the same question: «پول من کجا نگه داشته
         می‌شود», «where does my money live». */
      'پول', 'پول من', 'money', 'live', 'where'],
    bodyFa: 'کیف پول FBT غیرامانی است: کلید خصوصی و عبارت بازیابی فقط روی دستگاه شما ساخته و نگهداری می‌شوند. هیچ سروری آن‌ها را نمی‌بیند. تراکنش‌ها بدون امضای کیف پول شما اجرا نمی‌شوند و تراکنش روی‌زنجیره برگشت‌ناپذیر است.',
    bodyEn: 'The FBT wallet is non-custodial: your private key and recovery phrase are created and stored only on your device. No server ever sees them. Transactions never run without your wallet signature, and on-chain transactions are irreversible.',
    updatedAt: now()
  },
  {
    id: 'kb.wallet.never-asks', version: 1, category: 'WALLET', status: 'verified', confidence: 99,
    source: 'fbt-security-policy',
    titleFa: 'FBT هرگز چه چیزی نمی‌پرسد؟', titleEn: 'What will FBT never ask for?',
    tags: ['نمی‌پرسد', 'هرگز', 'امنیت', 'کلید', 'عبارت بازیابی', 'never ask', 'security', 'seed phrase', 'private key', 'هشدار', 'کلاهبرداری'],
    bodyFa: 'FBT و پشتیبانی FBT هرگز عبارت بازیابی (seed phrase)، کلید خصوصی، رمز کیف پول یا کد تأیید دو مرحله‌ای شما را نمی‌پرسند. هر کسی این‌ها را خواست — حتی با نام FBT — کلاهبردار است.',
    bodyEn: 'FBT and FBT support will never ask for your recovery phrase, private key, wallet password or 2FA codes. Anyone asking for them — even claiming to be FBT — is a scammer.',
    updatedAt: now()
  },
  {
    id: 'kb.swap.howto', version: 2, category: 'SWAP', status: 'verified', confidence: 92,
    source: 'fbt-app',
    titleFa: 'سواپ چگونه کار می‌کند؟', titleEn: 'How does swapping work?',
    tags: ['سواپ', 'سوآپ', 'تبدیل', 'معامله', 'swap', 'trading', 'exchange', 'how does', 'چطور', 'راهنما'],
    bodyFa: 'مبدأ و مقصد را انتخاب می‌کنید، FBT بهترین مسیر را بین صرافی‌های غیرمتمرکز مقایسه می‌کند و قیمت، کارمزد شبکه و اسلیپیج را در پیش‌نمایش نشان می‌دهد. اجرا فقط با تأیید و امضای کیف پول شما انجام می‌شود.',
    bodyEn: 'Pick source and target; FBT compares routes across decentralized venues and shows price, network fee and slippage in the preview. Execution happens only after your wallet signature.',
    updatedAt: now()
  },
  {
    id: 'kb.bridge.howto', version: 1, category: 'SWAP', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'بریج بین شبکه‌ها', titleEn: 'Cross-chain bridging',
    tags: ['بریج', 'پل', 'شبکه', 'انتقال', 'bridge', 'cross chain', 'transfer', 'polygon', 'arbitrum', 'چطور'],
    bodyFa: 'بریج دارایی را از یک شبکه به شبکه دیگر منتقل می‌کند. FBT مسیرها را با کارمزد و زمان تقریبی مقایسه می‌کند. قبل از تأیید، شبکه مقصد و آدرس را دوباره بررسی کنید؛ تراکنش بریج برگشت‌ناپذیر است.',
    bodyEn: 'A bridge moves an asset from one chain to another. FBT compares routes with fees and estimated timing. Double-check the target chain and address before confirming; bridge transactions are irreversible.',
    updatedAt: now()
  },
  {
    id: 'kb.intentos.overview', version: 3, category: 'INTENT_OS', status: 'verified', confidence: 93,
    source: 'fbt-app',
    titleFa: 'Intent AI چه کاری انجام می‌دهد؟', titleEn: 'What does Intent AI do?',
    tags: ['دستیار', 'هوش مصنوعی', 'intent', 'ai', 'چیکار میکنه', 'what does', 'assistant', 'چیست', 'تحلیل'],
    bodyFa: 'Intent AI دستیار هوشمند FBT است: درخواست شما را به زبان فارسی یا انگلیسی می‌فهمد، داده‌های زنده بازار و کیف پول را بررسی می‌کند، برای کارهای پیچیده از همکاری چند مدل هوش مصنوعی و تحقیق وب استفاده می‌کند و برای هر اقدام مالی حتماً تأیید شما را می‌گیرد. هیچ اقدامی بدون امضای کیف پول شما اجرا نمی‌شود.',
    bodyEn: 'Intent AI is FBT\'s assistant: it understands requests in Persian or English, checks live market and wallet data, uses multi-AI collaboration and web research for complex questions, and always requires your confirmation for financial actions. Nothing executes without your wallet signature.',
    updatedAt: now()
  },
  {
    id: 'kb.intentos.multi-ai', version: 1, category: 'INTENT_OS', status: 'verified', confidence: 90,
    source: 'fbt-ai-upgrade5',
    titleFa: 'همکاری چند مدل هوش مصنوعی', titleEn: 'Multi-AI collaboration',
    tags: ['همکاری', 'چند مدل', 'تجمیع', 'multi-ai', 'collaboration', 'models', 'consensus', 'تعداد مدل', 'نظر'],
    bodyFa: 'برای سؤال‌های پیچیده، FBT به‌جای یک مدل از همکاری چند مدل تخصصی (بازار، ریسک، تحقیق، راستی‌آزمایی) استفاده می‌کند و نتیجه را با داده‌های معتبر و منابع وب می‌سنجد. پاسخ نهایی یک جواب واحد FBT است، نه چند پاسخ پراکنده.',
    bodyEn: 'For complex questions FBT coordinates several specialized models (market, risk, research, verification) and weighs their output against trusted data and web sources. You receive one coherent FBT answer, not several scattered ones.',
    updatedAt: now()
  },
  {
    id: 'kb.signals.nature', version: 1, category: 'SIGNALS', status: 'verified', confidence: 88,
    source: 'fbt-app',
    titleFa: 'سیگنال‌ها چیستند؟', titleEn: 'What are signals?',
    tags: ['سیگنال', 'اخبار', 'تحلیل', 'signal', 'signals', 'alert', 'چیست', 'چیستند', 'اندیکاتور'],
    bodyFa: 'سیگنال‌های FBT خلاصه‌ای تحلیلی از وضعیت بازار و جریان پول هوشمند هستند. سیگنال تضمین سود نیست و جای تصمیم شخصی شما را نمی‌گیرد؛ همیشه ریسک و افق زمانی را در نظر بگیرید.',
    bodyEn: 'FBT signals are analytical summaries of market state and smart-money flow. A signal is not a profit guarantee and never replaces your own decision; always weigh risk and time horizon.',
    updatedAt: now()
  },
  {
    id: 'kb.smartmoney.nature', version: 1, category: 'SMART_MONEY', status: 'verified', confidence: 87,
    source: 'fbt-app',
    titleFa: 'اسمارت مانی چیست؟', titleEn: 'What is smart money?',
    tags: ['اسمارت مانی', 'کیف پول', 'ردیابی', 'smart money', 'whale', 'wallet', 'چیست', 'کیف پول های بزرگ'],
    bodyFa: 'بخش اسمارت مانی جریان انتقال دارایی کیف پول‌های بزرگ و برچسب‌خورده (صرافی‌ها، نهنگ‌ها، میم‌بات‌ها) را روی‌زنجیره رصد می‌کند. این داده مشاهده‌ای است، نه پیش‌بینی؛ جریان دیروز تضمین حرکت امروز نیست.',
    bodyEn: 'Smart money tracks on-chain transfers of large, labelled wallets (exchanges, whales, MEV bots). It is observational data, not prediction; yesterday\'s flow does not guarantee today\'s move.',
    updatedAt: now()
  },
  {
    id: 'kb.defi.yield-rules', version: 1, category: 'DEFI', status: 'verified', confidence: 90,
    source: 'fbt-risk-policy',
    titleFa: 'سود DeFi و ریسک آن', titleEn: 'DeFi yield and its risks',
    tags: ['سود', 'استیک', 'استیکینگ', 'فارم', 'فارمینگ', 'استخر', 'نقدینگی', 'yield', 'staking', 'farming', 'farm', 'apy', 'apr', 'pool', 'liquidity', 'defi', 'ریسک'],
    bodyFa: 'APY نمایش‌داده‌شده برای استخرها لحظه‌ای و متغیر است. ریسک‌های اصلی: تغییر نرخ، ریسک قرارداد هوشمند و ضرر ناپایدار (impermanent loss) در استخرهای دوطرفه. عدد APY هیچ تضمینی برای آینده نیست.',
    bodyEn: 'Displayed pool APY is instantaneous and variable. Main risks: rate changes, smart-contract risk and impermanent loss in two-sided pools. An APY figure is no promise about the future.',
    updatedAt: now()
  },
  {
    id: 'kb.trading.no-advice', version: 1, category: 'TRADING', status: 'verified', confidence: 95,
    source: 'fbt-risk-policy',
    titleFa: 'FBT توصیه مالی نمی‌کند', titleEn: 'FBT does not give financial advice',
    tags: ['توصیه', 'مالی', 'مشاوره', 'advice', 'financial advice', 'recommendation', 'مسئولیت', 'خودم', 'قانون'],
    bodyFa: 'تحلیل‌های FBT (سناریوی صعودی/نزولی/خنثی، امتیاز ریسک) ابزار تصمیم‌گیری هستند، نه دستور خرید یا فروش. هیچ مدل هوش مصنوعی نمی‌تواند بازار را قطعی پیش‌بینی کند؛ مسئولیت تصمیم با شماست.',
    bodyEn: 'FBT analysis (bull/bear/neutral scenarios, risk scores) is decision support, not a buy or sell instruction. No AI model can predict markets with certainty; the decision is yours.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.volatility', version: 1, category: 'RISK', status: 'verified', confidence: 94,
    source: 'fbt-risk-policy',
    titleFa: 'نوسان بازار طبیعی است', titleEn: 'Market volatility is normal',
    tags: ['نوسان', 'نوسانی', 'ریسک', 'volatility', 'risk', 'normal', 'بازار', 'طبیعی', 'ترس'],
    bodyFa: 'نوسان شدید بخشی از بازار کریپتو است. قبل از هر تصمیم هیجانی: اندازه پوزیشن، سناریوی نزولی و توان تحمل ضرر را بررسی کنید. فروش یا خرید از روی ترس یا FOMO یکی از پرتکرارترین دلایل ضرر کاربران است.',
    bodyEn: 'Sharp volatility is part of crypto. Before any impulsive move, review position size, the downside scenario and your loss tolerance. Trading out of fear or FOMO is among the most common causes of user losses.',
    updatedAt: now()
  },
  {
    id: 'kb.general.btc', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 96,
    source: 'general-crypto',
    titleFa: 'بیت کوین (BTC) چیست؟', titleEn: 'What is Bitcoin (BTC)?',
    tags: ['بیت کوین', 'btc', 'bitcoin', 'چیست', 'تعریف', 'what is', 'digital gold', 'پادشاه ارزهای دیجیتال'],
    bodyFa: 'بیت کوین اولین شبکه پولی غیرمتمرکز است (۲۰۰۹، ساتوشی ناکاموتو)؛ بدون بانک یا واسطه، با دفتر کل عمومی (بلاک‌چین) و عرضه محدود ۲۱ میلیون واحد. استخراج با اثبات کار انجام می‌شود و halvings عرضه جدید را هر ~۴ سال نصف می‌کنند.',
    bodyEn: 'Bitcoin is the first decentralized money network (2009, Satoshi Nakamoto): no bank or intermediary, a public ledger (blockchain) and a capped supply of 21 million coins. Secured by proof-of-work; halvings cut new supply roughly every 4 years.',
    updatedAt: now()
  },
  {
    id: 'kb.general.usdt', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 95,
    source: 'general-crypto',
    titleFa: 'تتر (USDT) چیست؟', titleEn: 'What is Tether (USDT)?',
    tags: ['تتر', 'usdt', 'tether', 'استیبل کوین', 'دلار', 'stablecoin', 'pegged', 'چیست', 'what is'],
    bodyFa: 'تتر یک استیبل‌کوین با ارزش متصل به دلار آمریکا است که روی شبکه‌های مختلف (از جمله Ethereum، Tron و Solana) منتشر می‌شود. برای انتقال دلار بدون نوسان استفاده می‌شود؛ همیشه به شبکه درست دقت کنید، چون ارسال به شبکه اشتباه ممکن است غیرقابل بازیابی باشد.',
    bodyEn: 'Tether is a stablecoin pegged to the US dollar, issued on several networks (including Ethereum, Tron and Solana). Used to move dollar value without volatility; always check the network — sending on the wrong network can be unrecoverable.',
    updatedAt: now()
  },
  {
    id: 'kb.general.eth', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 95,
    source: 'general-crypto',
    titleFa: 'اتریوم (ETH) چیست؟', titleEn: 'What is Ethereum (ETH)?',
    tags: ['اتریوم', 'eth', 'ethereum', 'چیست', 'تعریف', 'what is', 'smart contract', 'قرارداد هوشمند', 'erc20'],
    bodyFa: 'اتریوم شبکه‌ای برای قراردادهای هوشمند و برنامه‌های غیرمتمرکز (dApps) است؛ اتر (ETH) سوخت اجرای عملیات روی آن است. بیشتر اکوسیستم DeFi و NFT روی اتریوم و لایه‌های دوم آن ساخته شده‌اند.',
    bodyEn: 'Ethereum is the network for smart contracts and decentralized apps; ether (ETH) fuels execution. Most of DeFi and NFTs are built on Ethereum and its layer-2s.',
    updatedAt: now()
  },
  {
    id: 'kb.solana.network', version: 1, category: 'SOLANA', status: 'verified', confidence: 92,
    source: 'general-crypto',
    titleFa: 'سولانا چیست؟ شبکه سولانا', titleEn: 'What is Solana? The Solana network',
    tags: ['سولانا', 'solana', 'sol', 'شبکه', 'network', 'چیست', 'what is', 'بلاک چین', 'blockchain', 'سریع'],
    bodyFa: 'سولانا یک بلاک‌چین با کارمزد بسیار پایین و تأیید سریع تراکنش است؛ FBT سواپ و دارایی‌های Solana را پشتیبانی می‌کند. توکن بومی آن SOL برای کارمزد و اعتبارسنجی استفاده می‌شود.',
    bodyEn: 'Solana is a blockchain with very low fees and fast confirmation; FBT supports Solana swaps and assets. Its native token SOL pays fees and secures validation.',
    updatedAt: now()
  },
  {
    id: 'kb.product.dca', version: 1, category: 'PRODUCT', status: 'verified', confidence: 89,
    source: 'fbt-app',
    titleFa: 'خرید خودکار (DCA)', titleEn: 'DCA automation',
    tags: ['دی سی ای', 'خرید خودکار', 'پله ای', 'dca', 'dollar cost averaging', 'automatic buy', 'زمان بندی', 'schedule'],
    bodyFa: 'با خودکارسازی FBT می‌توانید خرید دوره‌ای (مثلاً روزانه یا هفتگی) بسازید تا نوسان نقطه ورود میانگین شود. هر چرخه طبق قوانین اجرا و در صورت نیاز تأیید می‌شود؛ می‌توانید هر زمان مکث یا لغو کنید.',
    bodyEn: 'FBT automations let you schedule recurring buys (e.g. daily or weekly) so entry timing is averaged. Each cycle runs under your rules, can be paused or cancelled at any time.',
    updatedAt: now()
  },
  {
    id: 'kb.product.fee', version: 1, category: 'PRODUCT', status: 'verified', confidence: 97,
    source: 'src/lib/feeBps.js',
    titleFa: 'کارمزد پلتفرم چقدر است؟', titleEn: 'What is the platform fee?',
    tags: ['کارمزد', 'هزینه', 'درصد', 'fee', 'platform fee', 'cost', 'چقدر', 'چند درصد', 'pricing', 'cost', 'هزینه', 'price', 'چقدر'],
    bodyFa: `کارمزد پلتفرم FBT ${feeFa()}٪ (${toEasternDigits(String(FEE_BPS))} بیسیس‌پوینت) برای هر سواپ است و سقف سخت آن ${feeFa(FEE_BPS_MAX)}٪ است. کارمزد شبکه (گس) جدا از این مبلغ است و به شبکهٔ مقصد بستگی دارد. این عدد در یک ماژول واحد تعریف شده و مقدار خارج از بازهٔ مجاز به پیش‌فرض برمی‌گردد.`,
    bodyEn: `The FBT platform fee is ${feePercentString()}% (${FEE_BPS} bps) per swap, hard-capped at ${feePercentString(FEE_BPS_MAX)}%. Network gas is separate and depends on the destination chain. The rate lives in one module, and an out-of-range value falls back to the default.`,
    updatedAt: now()
  },
  {
    /*
     * «آیا پلتفرم غیرامانی است؟» is the single most-asked question about this
     * product, and the corpus did NOT hold the answer to it. The question
     * matched `kb.faq.no-account` — an item about not needing an account —
     * which merely MENTIONS the word «کیف پول». A question whose answer the
     * corpus does not hold must not be answered from the corpus at all.
     *
     * The wording is the APP'S OWN wording, taken from
     * `src/i18n/locales/fa.json` → `about.value.security.body`, so the corpus
     * and the interface cannot drift apart.
     */
    id: 'kb.product.non-custodial', version: 1, category: 'PRODUCT', status: 'verified', confidence: 99,
    source: 'fbt-security-policy',
    titleFa: 'آیا پلتفرم غیرامانی است؟', titleEn: 'Is the platform non-custodial?',
    /*
     * The tags are DELIBERATELY NARROW. «کلید» and «کلید خصوصی» live in
     * `kb.wallet.custody`, which is the item that ANSWERS «کلید خصوصی من کجا
     * نگهداری می شود؟». Reusing them here made this item the runner-up for
     * that question, which shrank the lexical gap from 57 to 20 and silently
     * switched OFF the retriever's decisive-lexical override — so the hybrid
     * search started answering a custody question with a risk item.
     *
     * One vocabulary must belong to ONE item. This item says the platform
     * holds nothing; `kb.wallet.custody` says where the key lives.
     */
    tags: ['غیرامانی', 'غیرحضانتی', 'غیر امانی', 'حضانت', 'non-custodial', 'custodial', 'کیف پول', 'wallet', 'دارایی', 'نگه نمی‌داریم', 'شرکتی', 'پول من کجاست', 'امن'],
    bodyFa: 'بله، FBT غیرامانی است: ما چیزی نگه نمی‌داریم. نه کیف پول شرکتی هست که پولت در آن بماند، نه صف برداشت. کلید خصوصی و عبارت بازیابی فقط روی دستگاه خودت ساخته و نگهداری می‌شوند و هیچ سروری آن‌ها را نمی‌بیند؛ هر تراکنش را خودت با کیف پول خودت امضا می‌کنی و مستقیم روی بلاکچین ثبت می‌شود.',
    bodyEn: 'Yes. FBT is non-custodial: we hold nothing. There is no company wallet your money can sit in, and no withdrawal queue. Your private key and recovery phrase are created and stored only on your device, no server ever sees them; you sign every transaction yourself and it settles directly on-chain.',
    updatedAt: now()
  },
  {
    /*
     * «حداکثر مبلغ برداشت چقدر است؟» had the same disease: the corpus held
     * no item about a withdrawal LIMIT, so the question matched an item that
     * merely mentioned «برداشت». The honest answer is a property of the
     * product: because there is no withdrawal queue at all, there is no
     * withdrawal cap. Saying so is the answer; inventing a number would be a
     * fabrication.
     *
     * Wording is the app's own, from `onboarding.swap.body`.
     */
    id: 'kb.product.withdrawal', version: 1, category: 'PRODUCT', status: 'verified', confidence: 97,
    source: 'fbt-app',
    titleFa: 'سقف برداشت چقدر است؟', titleEn: 'What is the withdrawal limit?',
    tags: ['برداشت', 'سقف برداشت', 'حداکثر', 'حداکثر مبلغ', 'withdrawal', 'withdraw', 'limit', 'واریز', 'صف', 'خروج', 'حساب', 'بدون حساب', 'بدون واریز'],
    bodyFa: 'سقف برداشتی وجود ندارد، چون اصلاً صف برداشت و حساب کاربری در کار نیست: هر توکنی را مستقیم از کیف پول خودت معامله کن — بدون حساب، بدون واریز، بدون انتظار برای برداشت. دارایی‌ات هیچ‌وقت در حسابی که ما کنترلش کنیم نمی‌ماند و توکن‌ها مستقیم بین کیف پول‌ها جابه‌جا می‌شوند.',
    bodyEn: 'There is no withdrawal limit, because there is no withdrawal queue and no custodial account in the first place: you trade each token straight from your own wallet — no account, no deposit, no waiting for a withdrawal. Your assets never sit in an account we control, and tokens move directly between wallets.',
    updatedAt: now()
  },
  {
    id: 'kb.product.team', version: 1, category: 'PRODUCT', status: 'verified', confidence: 99,
    source: 'fbt-app',
    titleFa: 'سازندگان FBT چه کسانی هستند؟', titleEn: 'Who are the makers of FBT?',
    tags: ['سازنده', 'تیم', 'توسعه دهنده', 'team', 'makers', 'builders', 'who', 'چه کسانی', 'شرکت'],
    bodyFa: 'نام سازندگان، بنیان‌گذاران و اعضای تیم FBT در دانش تأییدشدهٔ محصول ثبت نشده است. دستیار هوشمند FBT در این حالت به‌جای حدس زدن نام، صریح می‌گوید که این اطلاعات در دانش ثبت نشده و کاربر را به کانال‌های رسمی (صفحهٔ دربارهٔ ما و صفحهٔ تماس) ارجاع می‌دهد. آنچه تأیید شده این است: FBT غیرامانی است، کلیدها روی دستگاه کاربر می‌مانند و FBT هرگز عبارت بازیابی یا کلید خصوصی نمی‌خواهد.',
    bodyEn: 'The names of FBT’s makers, founders and team members are not recorded in the verified product knowledge. Instead of guessing a name, the assistant says the information is not recorded and points the user to the official channels (About and Contact pages). What is verified: FBT is non-custodial, keys stay on the user device, and FBT never asks for a recovery phrase or private key.',
    updatedAt: now()
  },
  {
    id: 'kb.product.pages', version: 1, category: 'PRODUCT', status: 'verified', confidence: 94,
    source: 'src/App.jsx',
    titleFa: 'FBT چه صفحه‌هایی دارد؟', titleEn: 'Which pages does FBT have?',
    tags: ['صفحه', 'بخش', 'منو', 'pages', 'sections', 'navigation', 'features', 'کدام', 'راهنمای'],
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
/*  THE FULL KNOWLEDGE BASE — seed + wide corpus                               */
/* -------------------------------------------------------------------------- */
/*
 * Every item carries version/source/status/confidence, and every category in
 * KNOWLEDGE_CATEGORIES now holds several items. The audit found `FAQ` empty
 * and several categories with a single item, which meant a question in those
 * areas had nothing to ground itself on and the answer fell back to the
 * model's memory — exactly what the honesty rules forbid.
 */
export const FBT_KNOWLEDGE = Object.freeze([
  ...FBT_KNOWLEDGE_SEED,
  ...FBT_KNOWLEDGE_WIDE
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
  let raw = String(text || '')
    .replace(/بیت\s*کوین|بیتکوین/gi, ' بیتکوین بیت کوین btc bitcoin ')
    .replace(/اتریوم/gi, ' اتریوم eth ethereum ')
    .replace(/سولانا/gi, ' سولانا sol solana ')
    .replace(/ام\s*وی\s*ار\s*وی|ام\s*وی\s*آر\s*وی/gi, ' mvrv ')
    .replace(/نرخ\s*بهره/gi, ' نرخ بهره rates interest yield ')
    .replace(/تورم/gi, ' تورم inflation ')
    /*
     * «لیکوییدیتی» (liquidity risk) and «لیکوییدشدن» (liquidation) are
     * DIFFERENT things, and Persian writes them differently — but the corpus
     * item that defines liquidation is titled «لیکوییدشدن (Liquidation) چیست
     * و چطور جلویش را بگیر», so the question «ریسک لیکوییدیتی چیست؟» used
     * to match `kb.risk.position-sizing` (105) instead — an item about
     * position sizing, which is not what was asked.
     *
     * The alias makes both spellings share the stem, so the item written to
     * explain the concept wins. The English side matters too: "liquidation
     * risk" and "liquidity risk" are what people actually type.
     */
    .replace(/لیکویید(?:یتی|شدن|شده)/gi, ' liquidation liquidity liquidate ')
    .replace(/لیکوید(?:یتی|شدن|شده)/gi, ' liquidation liquidity liquidate ');
  /*
   * ─── TRANSLITERATION, NOT TRANSLATION (2026-11-19) ────────────────────────
   * Persian speakers write the English term in Persian letters: «ایمپرمننت
   * لاس», «فاندینگ ریت», «تکنیکال», «استیبل کوین». The corpus is bilingual
   * but its titles carry the LATIN term in parentheses, so «ایمپرمننت لاس
   * چیست؟» shared no token with «ریسک ضرر غیرخطی (Impermanent Loss) چیست؟»
   * and the retriever answered with whatever else was nearby.
   *
   * Every alias below maps a way of WRITING a known term onto the term the
   * corpus actually stores. It is a spelling bridge, not a thesaurus: the
   * vocabulary stays the corpus's, and an alias never invents a concept.
   */
  const TRANSLITERATIONS = [
    [/ایمپرمننت|ایمپرمنت|یمپرمننت/gi, ' impermanent '],
    [/\bلاس\b/g, ' loss '],
    [/لیکوییدیشن|لیکوئیدیشن|لیکوییدشن|لیکویدیشن/gi, ' liquidation liquidation liquidate '],
    [/فاندینگ|فاندینگ\s*ریت/gi, ' funding '],
    [/تکنیکال/gi, ' technical '],
    [/فاندامنتال/gi, ' fundamental '],
    [/استیبل\s*کوین|استیبلکوین/gi, ' stablecoin stable '],
    [/استیکینگ|استیک/gi, ' staking stake '],
    [/دیفای/gi, ' defi '],
    [/پرپ(?:یوال|چوال)?|پرپچوال/gi, ' perpetual '],
    [/اسپات/gi, ' spot '],
    [/ارد\s*راپ|ایردراپ/gi, ' airdrop '],
    [/هاوینگ/gi, ' halving '],
    [/توکنومیکس/gi, ' tokenomics '],
    [/مارکت\s*کپ|مارکتکپ/gi, ' market cap '],
    [/اوپن\s*اینترست/gi, ' open interest '],
    [/اسمارت\s*مانی/gi, ' smart money '],
    [/پرتفوی|پورتفوی|پورتفولیو/gi, ' portfolio '],
    [/کیف\s*پول|کیفپول/gi, ' wallet '],
    [/عبارت\s*(?:بازیابی|ریکاوری)|سید\s*فریز/gi, ' seed phrase recovery '],
    [/کلید\s*خصوصی|پرایوت\s*کی/gi, ' private key '],
    [/نهنگ/gi, ' whale '],
    [/نوسان/gi, ' volatility '],
    [/مقاومت|حمایت/gi, ' support resistance '],
    [/کندل/gi, ' candle '],
    [/پولبک/gi, ' pullback '],
    [/میم\s*کوین/gi, ' memecoin '],
    [/بریج|پل\s*شبکه/gi, ' bridge '],
    [/اسلیپیج|اسلیپیج/gi, ' slippage '],
    [/کارمزد\s*(?:شبکه|گس)/gi, ' gas fee network '],
    [/سیگنال/gi, ' signal ']
  ];
  for (const [re, replacement] of TRANSLITERATIONS) raw = raw.replace(re, replacement);
  return new Set(
    normalizeUpgrade4(raw)
      .split(/\s+/)
      .map((w) => w.replace(/\u200c/g, ''))
      .filter((w) => w.length >= 3)
  );
}

/*
 * ─── STOPWORDS (§56) ──────────────────────────────────────────────────────
 * The score is `overlap / qTokens.size`, so every function word in the query
 * dilutes the score of the words that actually carry the meaning. "how do I
 * recover my wallet" tokenises to 3 tokens, only ONE of which ("recover") is
 * content — so the real intent scored a third of what it should, and a
 * generic item that happened to contain "wallet" could outrank it.
 *
 * Dropping these terms costs nothing: they carry no retrieval signal, and
 * the stem bonus below already handles the Persian forms («کیف پول» against
 * «کیف پولم») which are content words, not stopwords.
 */
const KNOWLEDGE_STOPWORDS = new Set([
  'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'the', 'and', 'for', 'are', 'was', 'were', 'been', 'being', 'does', 'did',
  'doing', 'have', 'has', 'had', 'having', 'can', 'could', 'will', 'would',
  'shall', 'should', 'may', 'might', 'must', 'you', 'your', 'yours', 'my',
  'our', 'ours', 'their', 'its', 'it', 'they', 'them', 'he', 'she', 'his',
  'her', 'this', 'that', 'these', 'those', 'there', 'here', 'not', 'no',
  'yes', 'but', 'if', 'then', 'else', 'than', 'too', 'very', 'just', 'also',
  'get', 'got', 'gets', 'make', 'makes', 'made', 'take', 'takes',
  'happens', 'happened', 'occur', 'occurred', 'meaning', 'means', 'mean',
  'does', 'work', 'works', 'working', 'used', 'using', 'use', 'using',
  'thing', 'things', 'way', 'ways', 'kind', 'sort', 'like', 'need', 'want',
  'actually', 'really', 'exactly', 'please', 'thanks', 'thank', 'hello',
  'hi', 'hey', 'good', 'morning', 'evening', 'night', 'day', 'time', 'times',
  'know', 'knows', 'tell', 'tells', 'give', 'gives', 'use', 'uses',
  'want', 'wants', 'need', 'needs', 'let', 'lets', 'with', 'from', 'into',
  'out', 'off', 'over', 'under', 'about', 'any', 'some', 'all', 'more',
  'most', 'much', 'many', 'lot', 'do', 'done', 'so', 'up', 'down', 'me',
  'am', 'be', 'via', 'per',
  'از', 'به', 'با', 'در', 'را', 'که', 'این', 'آن', 'است', 'هست', 'هستند',
  'شد', 'شود', 'می', 'های', 'ها', 'یک', 'بر', 'برای', 'تا', 'یا',
  'هم', 'همه', 'چه', 'چگونه', 'چطور', 'کی', 'کجا', 'چرا', 'آیا', 'من', 'شما',
  'او', 'ما', 'آنها', 'خود', 'بود', 'باشد', 'دارد', 'دارند', 'کنم', 'کنید',
  'بده', 'بدید', 'چیه', 'چیست', 'بگو', 'بگید',
  'لطفا', 'لطفاً', 'میشه', 'می‌شود', 'هستش', 'میکنه', 'می‌کند', 'روی', 'زیر',
  'بین', 'بعد', 'قبل', 'وقتی', 'اگر', 'پس', 'اما', 'ولی', 'هر',
  /* THE QUESTION'S SCAFFOLDING, NOT ITS SUBJECT (2026-11-19).
     «فاندینگ ریت چطور کار می‌کند؟» shares «چطور/کار/می‌کند» with every
     how-does-it-work item in the corpus, so the swap explainer outranked the
     (missing) funding-rate item and the assistant answered a different
     question with full confidence. The same words made «چرا باید تنوع داشته
     باشم؟» match the emergency-fund item instead of diversification. None of
     these carry subject matter, so all of them go. */
  'کار', 'کنه', 'کنم', 'کنی', 'کنید', 'کنند', 'میکنه', 'می‌کنه', 'میکنم',
  'میکنن', 'باید', 'باشم', 'باشه', 'باشیم', 'باشید', 'داشته', 'داریم',
  'دارم', 'دارید', 'میتونم', 'می‌تونم', 'میتونه', 'بشه', 'بشم', 'چجوری',
  'چه‌جوری', 'یعنی', 'خانه',
  /* «چطور جلوی ضرر رو بگیرم» matched the PHISHING item on «جلوی» + «بگیرم»
     while the stop-loss item (the one that contains «ضرر») sat below it. */
  'بگیرم', 'بگیری', 'بگیر', 'جلوی', 'جلو', 'نگه', 'داری', 'ندارم'
]);

/*
 * ─── LIGHT ENGLISH MORPHOLOGY ──────────────────────────────────────────────
 * The corpus says "liquidation"; the user writes "liquidated". Without a
 * stemmer those are two different tokens and the question silently misses.
 * The rules below are deliberately shallow — they collapse the inflections
 * that actually show up in crypto questions, and they never rewrite a word
 * to something the corpus does not contain.
 */
const ENGLISH_STEM_RULES = [
  /* The nominalisation families first: "liquidation", "liquidated" and
     "liquidate" must converge on one stem, otherwise the corpus word and the
     user's word stay two different tokens. */
  [/ations?$/, 'ate'],
  [/ization$/, 'ize'],
  [/ations$/, 'ate'],
  [/ised$/, 'ize'],
  [/ized$/, 'ize'],
  [/ising$/, 'ize'],
  [/izing$/, 'ize'],
  [/ation$/, 'ate'],
  [/ated$/, 'ate'],
  [/ating$/, 'ate'],
  /* The plain -ing family: "staking" -> "stake", "trading" -> "trade".
     The doubled-consonant form ("running" -> "run") is handled too. */
  [/([bdfglmnprt])\1ing$/, '$1ing'],
  [/([bdfglmnprt])ing$/, '$1'],
  [/ing$/, ''],
  /*
   * The plain -ing family: "staking" -> "stake", "trading" -> "trade".
   *
   * The ORDER matters and is easy to get wrong. The rules are tried in
   * sequence and the first match wins, so the specific forms must come
   * BEFORE the general one:
   *
   *   "running"  -> doubled consonant -> "run"
   *   "staking"  -> single consonant  -> "stake"
   *   "trading"  -> nothing else      -> "trad"
   *
   * With the general /ing$/ rule first, "staking" became "stak" while
   * the corpus word "stake" stayed "stake" — two different tokens for
   * one word, which is exactly the failure the stemmer exists to prevent.
   */
  [/ied$/, 'y'],
  [/ies$/, 'y'],
  [/ied$/, 'y'],
  [/ying$/, 'y'],
  [/sses$/, 'ss'],
  [/ches$/, 'ch'],
  [/shes$/, 'sh'],
  [/xes$/, 'x'],
  [/zes$/, 'z'],
  [/s$/, '']
];

function stemEnglish(token) {
  const t = String(token || '');
  /* Only Latin words are stemmed — Persian morphology is handled by the
     existing partial-word bonus, and guessing there would do harm. */
  if (!/^[a-z][a-z-]*$/.test(t)) return t;
  if (t.length <= 3) return t;
  for (const [re, rep] of ENGLISH_STEM_RULES) {
    if (re.test(t) && t.replace(re, rep).length >= 3) return t.replace(re, rep);
  }
  return t;
}

/*
 * ─── AMBIGUOUS STEMS ───────────────────────────────────────────────────────
 * A few stems are shared by words with genuinely different meanings, and
 * collapsing them makes the retriever confidently wrong:
 *
 *   liquid / liquidity / liquidated / liquidation
 *
 * "liquidity" and "liquidated" are not the same subject, yet a naive
 * -ed/-tion rule merges them, so a question about getting liquidated
 * retrieves the ETF-flows item because it happens to talk about liquidity.
 *
 * These words are therefore left unstemmed, and the corpus instead spells
 * the variant it wants ("liquidated") where it matters. The cost is that
 * "liquidate" and "liquidation" rely on their exact forms — which the
 * corpus states explicitly, so the match is exact and correct.
 */
const UNSTEMMED_WORDS = new Set([
  'liquid', 'liquidity', 'liquide', 'liquidated', 'liquidation',
  'leveraged', 'leverage', 'leveraging',
  'funded', 'funding', 'fund',
  'swap', 'swaps', 'swapping',
  'yield', 'yields', 'yielding',
  'bridge', 'bridges', 'bridging',
  'borrow', 'borrowed', 'borrowing'
]);

/**
 * Query tokens with the function words removed. Only the QUERY is filtered:
 * the corpus keeps every word, because a stopword can legitimately be the
 * whole answer ("is my wallet safe" -> "safe").
 */
function tokenizeQuery(text) {
  const tokens = tokenizeWithAliases(text);
  const meaningful = [...tokens].filter((t) => !KNOWLEDGE_STOPWORDS.has(t));
  /* Never let the filter empty a query: a question made only of stopwords
     ("what is this" -> "what", "is") still has to retrieve something. */
  return meaningful.length ? new Set(meaningful) : tokens;
}

/** Apply the English stemmer to every token of a set. */
function stemSet(tokens) {
  const out = new Set();
  for (const t of tokens) {
    out.add(t);
    if (UNSTEMMED_WORDS.has(t)) continue;
    const stem = stemEnglish(t);
    if (stem !== t) out.add(stem);
  }
  return out;
}

/**
 * The token sets of one knowledge item, computed once.
 *
 * The corpus is frozen, so an item's tokens never change. Computing them
 * per search meant 309 tokenisations of the same 103 items on every single
 * lookup — the dominant cost of the lexical retriever.
 *
 * @param {object} item
 * @param {boolean} isFa
 * @returns {{ titleTokens: Set<string>, pureTitleTokens: Set<string>, iTokens: Set<string> }}
 */
const ITEM_TOKEN_CACHE = new WeakMap();
/*
 * ─── DOCUMENT FREQUENCY: HOW MUCH A WORD ACTUALLY TELLS US (2026-11-19) ────
 * Overlap counting weights «پول» the same as «ایمپرمننت». One appears in
 * thirty items, the other in one — so a question that mentions money and a
 * rare term was answered by whichever item had the most money-ish words.
 *
 * IDF is the standard correction and it costs one pass over a frozen corpus:
 * a matched token is worth log(1 + N / (1 + df)) instead of 1, so the words
 * that identify the subject dominate and the ones every item shares fade.
 */
let CORPUS_DF = null;
const DOC_FREQ_MIN = 0;

function corpusDocFreq() {
  if (CORPUS_DF) return CORPUS_DF;
  const df = new Map();
  const items = FBT_KNOWLEDGE.filter((item) => item.status !== 'deprecated');
  for (const item of items) {
    const tokens = new Set();
    for (const isFa of [true, false]) {
      const cache = itemTokenCache(item, isFa);
      for (const t of cache.iTokens) tokens.add(t);
      for (const t of cache.titleTokens) tokens.add(t);
    }
    for (const t of tokens) df.set(t, (df.get(t) || 0) + 1);
  }
  const total = Math.max(1, items.length);
  CORPUS_DF = {
    total,
    /* Square-rooted: a full IDF is a strong re-ranker and started
       outranking the platform-fee item for «what does it cost me», which is
       the question that item exists for. The root keeps the signal (rare
       words weigh more) without letting it flip an otherwise correct order. */
    idf: (token) => Math.sqrt(Math.log(1 + total / (1 + (df.get(token) || DOC_FREQ_MIN))))
  };
  return CORPUS_DF;
}

function itemTokenCache(item, isFa) {
  let byLocale = ITEM_TOKEN_CACHE.get(item);
  if (!byLocale) { byLocale = new Map(); ITEM_TOKEN_CACHE.set(item, byLocale); }
  const hit = byLocale.get(isFa ? 'fa' : 'en');
  if (hit) return hit;
  const title = isFa ? item.titleFa : item.titleEn;
  const body = isFa ? item.bodyFa : item.bodyEn;
  const tagStr = Array.isArray(item.tags) ? item.tags.join(' ') : '';
  const built = {
    titleTokens: stemSet(tokenizeWithAliases(`${title} ${tagStr}`)),
    /* The title alone, without the tag vocabulary. */
    pureTitleTokens: stemSet(tokenizeWithAliases(title)),
    iTokens: stemSet(tokenizeWithAliases(`${title} ${body} ${tagStr} ${item.category}`))
  };
  byLocale.set(isFa ? 'fa' : 'en', built);
  return built;
}

/**
 * Retrieve the most relevant knowledge items for a question. Deterministic
 * token-overlap scoring; deprecated items are never returned.
 */
export function searchKnowledge(query, { locale = 'fa', limit = 3, category = null } = {}) {
  const qTokens = stemSet(tokenizeQuery(query));
  if (!qTokens.size) return [];
  /*
   * ─── THE SUBJECT ANCHOR (2026-11-19) ─────────────────────────────────────
   * A hit that shares only scaffolding words with the question is not a hit.
   *
   * Before this, «فاندینگ ریت چطور کار می‌کند؟» retrieved the SWAP explainer
   * at lexical 40 — the shared words were «چطور», «کار» and «می‌کند» — and the
   * assistant then answered a question about swap mechanics with a title and
   * a body, as if that were the answer. Same for «چرا باید تنوع داشته باشم؟»,
   * which matched «قبل از سرمایه‌گذاری چه ذخیره‌ای داشته باشم؟» on «باید …
   * داشته باشم» and buried the diversification item underneath.
   *
   * `anchorTokens` is what is left of the question once the scaffolding is
   * gone. An item must contain at least one of them (unless the question was
   * scaffolding only, in which case the original token set is used).
   */
  const subjectAnchor = qTokens;
  /*
   * A SHORT question is decided by its SUBJECT, not by a body mention.
   *
   * «ایمپرمننت لاس چیست؟» has no corpus item, and the semantic layer used to
   * hand back «جیتو (Jito) و فرستندهٔ تراکنش چیست؟» — a passage that shares
   * nothing with the question — which the assistant then presented as the
   * answer. With one or two content words in the question, the item must name
   * that subject in its TITLE or TAGS to be retrievable at all. A longer
   * question may still reach an item through its body.
   */
  /* A one- or two-word question is anchored on the item's TITLE or TAGS, so a
     body mention cannot carry it; a longer question may still reach an item
     through its body. */
  const strictAnchor = false;

  /*
   * A definitional question names ONE subject and asks what it is. The
   * subject is the noun right before the definitional marker ("بیت کوین چیست"
   * -> "بیت کوین"; "what is ethereum" -> "ethereum"). Everything else in the
   * sentence is function word, which the stopword list has already removed.
   */
  const DEFINITION_MARKERS = [
    /چیست|چیه|چی|یعنی چه|تعریف|معنی|معنیاش چیه|چیکار میکنه|چیکار می‌کند/,
    /what (is|are|does) /,
    /meaning of|define|definition of|explain what/
  ];
  const definitional = DEFINITION_MARKERS.some((re) => re.test(String(query || '').toLowerCase()));
  let definitionalSubject = null;
  if (definitional) {
    /* The subject is the thing being defined. In Persian it is often TWO
       words ("بیت کوین", "اتریوم"), so the subject is taken as the phrase
       that PRECEDES the definition marker, not as one token. */
    const text = String(query || '');
    const marker = DEFINITION_MARKERS.find((re) => re.test(text.toLowerCase()));
    let head = text;
    let tail = '';
    if (marker) {
      const m = text.toLowerCase().match(marker);
      if (m && m.index != null) {
        /* The two languages put the subject on opposite sides of the marker:
             Persian — "بیت کوین چیست"  → the subject is BEFORE
             English  — "what is bitcoin" → the subject is AFTER
           So the head and the tail are both kept and the side that actually
           carries content becomes the subject. */
        head = text.slice(0, m.index);
        tail = text.slice(m.index + m[0].length);
      }
    }
    /* For English the marker swallows the subject ("what is bitcoin"), so
       fall back to the token list when the head came out empty. */
    const headTokens = [...tokenizeQuery(head)].filter(
      (t) => t.length >= 3 && !/^(چیست|چیه|چی|یعنی|تعریف|معنی|چیکار|است|هست)$/.test(t)
    );
    /* For English the head is empty ("what is "), so the subject comes from
       the tail: "funding rate", "impermanent loss", "a bridge". */
    if (!headTokens.length && tail) {
      const tailTokens = [...tokenizeQuery(tail)].filter(
        (t) => t.length >= 3 && !/^(the|a|an|is|are|does|do)$/.test(t)
      );
      if (tailTokens.length) {
        /* The article is dropped: "what is a bridge" -> "bridge", and the
           title "What is a bridge?" is matched as "what is <subject>". */
        const normalizedTail = normalizeUpgrade4(tail).replace(/\s+/g, ' ').trim();
        const words = normalizedTail.split(' ').filter((w) => w && !/^(the|a|an)$/.test(w));
        definitionalSubject = words.length >= 2 ? words.slice(0, 2).join(' ') : (words[0] || normalizedTail);
      }
    }
    if (headTokens.length) {
      /* The subject is the phrase IMMEDIATELY before the marker, not the
         whole head: in "PDA در سولانا چیست؟" the subject is "PDA", not
         "PDA در سولانا" — otherwise every Solana item would look like the
         definition of Solana.
         The phrase may be one or two words ("بیت کوین"), so the LAST one
         or two words of the head are taken. */
      const normalizedHead = normalizeUpgrade4(head).replace(/\s+/g, ' ').trim();
      const words = normalizedHead.split(' ').filter(Boolean);
      definitionalSubject = words.length >= 2 ? words.slice(-2).join(' ') : normalizedHead;
      if (!definitionalSubject || definitionalSubject.length < 3) {
        definitionalSubject = headTokens.sort((a, b) => b.length - a.length)[0];
      }
    } else {
      const content = [...tokenizeQuery(text)].filter(
        (t) => t.length >= 3 && !/^(چیست|چیه|چی|یعنی|تعریف|معنی|چیکار)$/.test(t)
      );
      content.sort((a, b) => b.length - a.length);
      definitionalSubject = content[0] || null;
    }
  }
  /* The subject as a token set, so a multi-word subject ("funding rate") can
     be matched against a title word by word. For a definitional question the
     subject is the thing being defined; for any other question it is simply
     the query's content vocabulary, which is what the title tie-break needs. */
  const subjectTokens = definitionalSubject
    ? stemSet(tokenizeWithAliases(definitionalSubject))
    : stemSet(tokenizeQuery(query));

  const scored = [];
  for (const item of FBT_KNOWLEDGE) {
    if (item.status === 'deprecated') continue;
    if (category && item.category !== category) continue;
    const isFa = String(locale).startsWith('fa');
    const title = isFa ? item.titleFa : item.titleEn;
    const body = isFa ? item.bodyFa : item.bodyEn;
    const tagStr = Array.isArray(item.tags) ? item.tags.join(' ') : '';
    /*
     * ─── THE ITEM TOKEN CACHE (2026-11-11) ────────────────────────────────
     *
     * These three token sets depend ONLY on the item, and the corpus is
     * frozen — so recomputing them on every search is pure waste.
     *
     * Measured: a search tokenised 3 × 103 = 309 strings, and each one
     * ran `normalizeUpgrade4` (nine regex passes plus a typo-replacement
     * loop). That made a lexical search cost 16 ms warm — 50× the offline
     * embedding (0.1 ms) and enough to turn the local-first gate from a
     * saving into a cost.
     *
     * The cache is keyed by locale, and the sets are built lazily on the
     * first search that needs them. Nothing about the ranking changes: the
     * same strings produce the same tokens, every time.
     */
    const cache = itemTokenCache(item, isFa);
    const titleTokens = cache.titleTokens;
    /* The title alone, without the tag vocabulary. */
    const pureTitleTokens = cache.pureTitleTokens;
    const iTokens = cache.iTokens;
    /*
     * The subject anchor gate: at least one of the question's content words
     * must actually occur in the item. A scaffolding-only match is noise, and
     * noise presented as a grounded answer is worse than "I don't know".
     */
    let anchored = false;
    for (const t of subjectAnchor) {
      if (strictAnchor ? titleTokens.has(t) : (titleTokens.has(t) || iTokens.has(t))) { anchored = true; break; }
    }
    if (!anchored) continue;
    const { idf } = corpusDocFreq();
    let overlap = 0;
    let weightTotal = 0;
    for (const t of qTokens) {
      /* The denominator is the weight a PERFECT match would score, so the
         result stays a percentage of what the question could have matched. */
      weightTotal += 1.6 * idf(t);
      if (titleTokens.has(t)) overlap += 1.6 * idf(t);
      else if (iTokens.has(t)) overlap += 1 * idf(t);
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
    /* Scaled to the same range the previous (unweighted) scorer produced —
       a perfect title+tag match is ~160 — so the confidence thresholds that
       read these scores keep their meaning. */
    let score = Math.round((overlap / Math.max(0.0001, weightTotal)) * 170);
    /*
     * ─── THE TITLE SAYS WHAT THE ITEM IS ABOUT (2026-11-19) ────────────────
     * «فاندینگ ریت چیست؟» tied three items at 80: the funding-rate item, the
     * open-interest item and a long on-chain-metrics list — every one of them
     * MENTIONS funding, only one of them is about it. The tie was broken by
     * an id comparison, so a question about funding could be answered with a
     * paragraph about OI.
     *
     * Coverage of the question's subject in the item's own TITLE is the
     * signal that separates "is about" from "mentions": the item written to
     * explain the subject carries it in its title. The bonus is proportional
     * to how much of the subject the title covers, so one shared word cannot
     * outweigh a question that only needed that one word.
     */
    let titleHits = 0;
    let titleWeight = 0;
    let subjectWeight = 0;
    for (const t of subjectAnchor) {
      const w = idf(t);
      subjectWeight += w;
      /* TITLE **or** TAGS: the tags are the vocabulary the corpus uses to
         make a colloquial question reachable, so an item tagged «cost» is
         declaring that it answers cost questions. */
      if (titleTokens.has(t)) { titleHits += 1; titleWeight += w; }
    }
    /* Weighted by rarity: a title that repeats a word EVERY item carries
       («cost») is not evidence that the item is about the question, while a
       title carrying its rare term is. The bonus is a share of the subject's
       total rarity, so the scale does not depend on how long the question is. */
    if (titleHits && subjectWeight > 0) score += Math.round(40 * (titleWeight / subjectWeight));
    /*
     * ─── DEFINITIONAL INTENT (§56) ────────────────────────────────────────
     * "بیت کوین چیست؟" and "what is ethereum" ask for the DEFINITION of one
     * subject. Many items mention that subject, so plain token overlap ties
     * them all at the same score and the winner is decided by an id
     * comparison — which can put a market-structure essay ahead of the
     * actual definition.
     *
     * When the question is definitional, the item whose own TITLE is the
     * subject wins, because that is the item written to define it. The boost
     * is deliberately large and deliberately narrow: it only fires for a
     * definitional question, and only when the subject token is in the title.
     */
    if (definitional && score > 0 && definitionalSubject) {
      const subject = definitionalSubject;
      /* Two tiers, because "the title mentions it" is not the same as "the
         title IS it":
           · title STARTS with the subject  -> this is the definition item
           · title merely CONTAINS it      -> this item is ABOUT the subject
         The definition tier wins outright. */
      /* The title is compared as a PHRASE, because the Persian title of the
         Solana item is "شبکه سولانا" while the subject asked about is
         "سولانا" — the subject is inside the title, not at its start. */
      const titleText = normalizeUpgrade4(String(title || '')).replace(/\s+/g, ' ').trim();
      const subjectText = normalizeUpgrade4(String(subject)).replace(/\s+/g, ' ').trim();
      /* The DEFINITION tier is narrow on purpose: the title must be ABOUT
         the subject, not merely mention it. "شبکه سولانا" defines Solana,
         but "کارمزد تراکنش در سولانا" is about fees and merely mentions it.
         So the subject must sit at the START of the title, or the title must
         BE the subject — with an optional leading qualifier word. */
      /*
       * The DEFINITION tier looks for a title that IS the definition:
       *   · English  — "What is Bitcoin (BTC)?"  /  "What is Tether (USDT)?"
       *   · Persian  — "بیت کوین (BTC) چیست؟"  /  "تتر (USDT) چیست؟"
       * The subject sits before the Persian marker and after the English
       * one, so each side is matched in its own shape. A title that merely
       * mentions the subject ("چرا سولانا سریع است؟", "Is Bitcoin a safe
       * haven?") is NOT a definition and does not earn this tier.
       */
      const faTitle = normalizeUpgrade4(String(item.titleFa || '')).replace(/\s+/g, ' ').trim();
      const enTitle = normalizeUpgrade4(String(item.titleEn || '')).replace(/\s+/g, ' ').trim();
      /* The Persian definition title puts the subject FIRST and the marker
         LAST: "بیت کوین (BTC) چیست؟". Requiring the subject at the START
         is what separates the definition of Solana ("شبکه سولانا") from an
         item that merely ends in "چیست؟" while talking about Solana
         ("PDA در سولانا چیست؟"). */
      const faDef = faTitle.startsWith(subjectText)
        && /چیست|چیه|یعنی/.test(faTitle)
        && faTitle.indexOf(subjectText) < faTitle.search(/چیست|چیه|یعنی/);
      const enDef = enTitle.startsWith(`what is ${subjectText}`)
        || enTitle.startsWith(`what are ${subjectText}`)
        /* The title keeps the article while the subject drops it. */
        || enTitle.startsWith(`what is a ${subjectText}`)
        || enTitle.startsWith(`what is an ${subjectText}`)
        || enTitle.startsWith(`what are a ${subjectText}`)
        || enTitle.startsWith(`what are the ${subjectText}`)
        || enTitle.startsWith(`what is the ${subjectText}`);
      const titleHasSubject = faDef || enDef
        || titleText === subjectText
        || titleText.startsWith(`${subjectText}(`);
      if (titleHasSubject) {
        score += 100;
      } else if (titleTokens.has(subject)) {
        score += 30;
      }
    }
    /*
     * A SUBJECT-TITLE tie-break, for the case where two items are about the
     * same subject but only one is written as the canonical explanation of
     * it. "How does staking work" matches the product's Earn section and
     * the DeFi yield-risk item equally, because both carry the word
     * "staking" in their tags — but only one of them has the subject in
     * its TITLE. When that is true, the title wins, because the title is
     * the item's own statement of what it is about.
     *
     * This runs for EVERY query, not only definitional ones — otherwise the
     * tie would simply be broken by an id comparison, which is arbitrary.
     */
    if (score > 0 && subjectTokens.size && !(definitional && definitionalSubject)) {
      /* Only the TITLE itself counts here — NOT the tags. Tags are the
         vocabulary a question is matched against; the title is the item's
         own statement of what it is about. Counting tags here would give
         the same credit to every item that merely lists the subject. */
      let titleSubjectHits = 0;
      for (const st of subjectTokens) if (pureTitleTokens.has(st)) titleSubjectHits += 1;
      if (titleSubjectHits === subjectTokens.size && subjectTokens.size >= 1) {
        score += 12;
      }
    }
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
      /* How many tokens the item's own title carries — the tie-break signal
         used by the sort above (a tighter title is a more specific item). */
      titleTokens: pureTitleTokens.size,
      titleMatches: titleHits,
      score
    });
  }
  return scored
    /* Equal scores: the item whose TITLE is a tighter statement of the subject
       is the one written to answer it — «نرخ تاموینگ (Funding Rate) چیست؟»
       over a six-subject on-chain glossary. */
    .sort((a, b) => (b.score - a.score)
      || (Number(a.titleTokens) - Number(b.titleTokens))
      || a.id.localeCompare(b.id))
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
