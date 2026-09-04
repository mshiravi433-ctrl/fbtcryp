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

/**
 * Retrieve the most relevant knowledge items for a question. Deterministic
 * token-overlap scoring; deprecated items are never returned.
 */
export function searchKnowledge(query, { locale = 'fa', limit = 3, category = null } = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.size) return [];

  const scored = [];
  for (const item of FBT_KNOWLEDGE) {
    if (item.status === 'deprecated') continue;
    if (category && item.category !== category) continue;
    const title = String(locale).startsWith('fa') ? item.titleFa : item.titleEn;
    const body = String(locale).startsWith('fa') ? item.bodyFa : item.bodyEn;
    const iTokens = tokenize(`${title} ${body} ${item.category}`);
    let overlap = 0;
    for (const t of qTokens) if (iTokens.has(t)) overlap += 1;
    /* Partial-word bonus for Persian stems («کیف پول» vs «کیف پولم») */
    for (const t of qTokens) {
      if (!iTokens.has(t)) {
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
      title: String(locale).startsWith('fa') ? item.titleFa : item.titleEn,
      body: String(locale).startsWith('fa') ? item.bodyFa : item.bodyEn,
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
