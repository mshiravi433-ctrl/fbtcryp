/**
 * FBT SMART INTENT OS — AI UPGRADE 5: CUSTOMER QUESTION INTELLIGENCE
 * ---------------------------------------------------------------------------
 * Discovers WHAT users actually ask, clusters equivalent phrasings, and turns
 * real demand into product knowledge (§28-33):
 *
 *   "BTC چطوره؟" / "بیت کوین چه وضعیه؟" / "نظرت درباره بیت کوین چیه؟"
 *        → cluster: MARKET_OUTLOOK
 *   "چطور USDT بخرم؟" / "با تومان تتر بخرم؟"
 *        → cluster: USDT_PURCHASE
 *
 * Privacy laws (§28, §44):
 *   - Never store secrets: private keys, seed phrases, API secrets are
 *     detected and rejected BEFORE anything is recorded.
 *   - Storage keeps cluster counters + a short REDACTED sample, not raw
 *     personal data.
 *
 * This module is the deterministic core (normalization, clustering, gap
 * math, FAQ candidate shaping). The server module (server/aiQuestionIntel.js)
 * owns storage, aggregation windows and the admin endpoints.
 */

import { normalizeUpgrade4 } from './intentUnderstandingEngine.js';

export const QUESTION_INTEL_SCHEMA = 'fbt.question-intel.v5';
export const FAQ_CANDIDATE_SCHEMA = 'fbt.faq-candidate.v1';

/* -------------------------------------------------------------------------- */
/*  SECRET GUARD — nothing sensitive ever enters question analytics (§28)      */
/* -------------------------------------------------------------------------- */

const SECRET_PATTERNS = [
  /0x[a-fA-F0-9]{64}/, // 32-byte hex private key
  /\b(?:private[\s_-]?key|secret[\s_-]?key|mnemonic|seed[\s_-]?phrase|recovery[\s_-]?phrase|master[\s_-]?password|api[\s_-]?secret|passphrase)\b/i,
  /\bbearer\s+[a-zA-Z0-9_\-.]{20,}/i,
  /(?:\b[a-z]{3,10}\b[\s,]+){11,23}[a-z]{3,10}\b/i // 12-24 word phrase candidate
];

export function containsSecretMaterial(text) {
  const str = String(text || '');
  return SECRET_PATTERNS.some((re) => re.test(str));
}

/** Strip addresses/keys and cap length — the ONLY form safe to persist. */
export function redactForStorage(text, max = 120) {
  let out = String(text || '')
    .replace(/0x[a-fA-F0-9]{40,}/g, '[ADDR]')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (m) => (/[1-9A-HJ-NP-Za-km-z]{40,44}/.test(m) ? '[ADDR]' : m))
    .replace(/\b\d{12,}\b/g, '[NUM]')
    .replace(/[\u0000-\u001f\u200b-\u200f]/g, ' ')
    .trim();
  if (containsSecretMaterial(out)) return '[REDACTED_SECRET]';
  return out.slice(0, max);
}

/* -------------------------------------------------------------------------- */
/*  QUESTION CLUSTERS (§29)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Cluster catalog. Patterns run against normalizeUpgrade4() output: Persian
 * letters folded, Persian digits mapped, punctuation gone, lower-cased — so
 * «بیت کوین چطوره؟» and «BTC chetore?» both land in MARKET_OUTLOOK.
 * `risk: 'high'` marks money-decision and panic-adjacent clusters (§62).
 */
export const QUESTION_CLUSTERS = Object.freeze([
  {
    id: 'GREETING',
    labelFa: 'احوال‌پرسی',
    labelEn: 'Greetings',
    category: 'CASUAL',
    risk: 'low',
    /* NOTE: no \b — JS word boundaries do not exist around Persian letters. */
    patterns: [/^(سلام|سلاام|درود|صبح بخیر|شب بخیر|خسته نباشی|چه خبر|hi(?![a-z])|hello|hey(?![a-z]))/]
  },
  {
    id: 'THANKS',
    labelFa: 'تشکر',
    labelEn: 'Thanks',
    category: 'CASUAL',
    risk: 'low',
    patterns: [/^(ممنون|مرسی|دمت گرم|سپاس|عالی بود|دستت درد نکنه|خیلی کمک کردی|thanks|thank you|thx(?![a-z])|ty(?![a-z]))/]
  },
  {
    id: 'MARKET_OUTLOOK',
    labelFa: 'چشم‌انداز بازار',
    labelEn: 'Market Outlook',
    category: 'MARKET',
    risk: 'medium',
    patterns: [
      /(بیت کوین|بیت|btc|bitcoin|اتریوم|eth|ethereum|سولانا|sol|solana|بازار|market).{0,24}(چطور|چه وضع|خوبه|نظرت|outlook|how is|bullish|bearish|رشد|ریزش)/,
      /(چطور|چه وضع|نظرت|outlook|how is).{0,24}(بیت کوین|بیت|btc|bitcoin|اتریوم|eth|ethereum|سولانا|sol|solana|بازار|market)/,
      /(چرا|why).{0,30}(ریخت|افت|drop|fall|dump|up|pump|بالا)/
    ]
  },
  {
    id: 'USDT_PURCHASE',
    labelFa: 'خرید تتر',
    labelEn: 'USDT Purchase',
    category: 'ONBOARDING',
    risk: 'medium',
    patterns: [
      /(usdt|تتر|tether).{0,30}(بخر|خرید|buy|purchase|تهیه|چطور|چگونه|how)/,
      /(بخر|خرید|buy|purchase|تهیه|چطور|چگونه|how).{0,30}(usdt|تتر|tether)/,
      /(ریال|تومان|toman|rial).{0,30}(usdt|تتر|tether|crypto|کریپتو|ارز)/
    ]
  },
  {
    id: 'TOKEN_RESEARCH',
    labelFa: 'تحقیق توکن',
    labelEn: 'Token Research',
    category: 'RESEARCH',
    risk: 'medium',
    patterns: [
      /(این ارز|این کوین|این توکن|this (coin|token|asset)|درباره.{0,16}(ارز|کوین|توکن)|about (this|the) (coin|token))/,
      /(پروژه|project|تیم|team|tokenomics|توکنومیکس|قرارداد|contract|tvl|هولدر|holders|وایت پیپر|whitepaper)/,
      /(چیست|چیه|what is).{0,24}(پروژه|project|توکن|token|ارز|کوین|coin)/
    ]
  },
  {
    id: 'NEWS_IMPACT',
    labelFa: 'تأثیر اخبار',
    labelEn: 'News Impact',
    category: 'NEWS',
    risk: 'medium',
    patterns: [
      /(خبر|news|اخبار|اعلامیه|announcement|اتفاق|event).{0,40}(تاثیر|اثر|impact|effect|روی|on)/,
      /(تاثیر|اثر|impact|effect).{0,40}(خبر|news|اخبار|اعلامیه|announcement|اتفاق|event)/,
      /* «تصمیم نرخ بهره روی بازار چه اثری دارد» — impact phrasing without the
         literal word "news": macro events + impact verbs. */
      /(چه اثری|چه تاثیری|what impact|impact (?:does|on)|چه عواقبی)/,
      /(نرخ بهره|rate decision|fed|فدرال|etf|رگولاتور|regulator|regulation|مقررات|قانون).{0,60}(اثر|تاثیر|impact|effect|روی|on|بازار|market|crypto|کریپتو)/
    ]
  },
  {
    id: 'RISK_FEAR',
    labelFa: 'ترس و ریسک',
    labelEn: 'Risk & Fear',
    category: 'EMOTIONAL',
    risk: 'high',
    patterns: [
      /(می ترسم|میترسم|نمی ترسم|ترس|نگران|استرس|scared|afraid|worried|fear|panic)/,
      /(ضرر|از دست|ریسک|lose|loss|risk).{0,24}(می کنم|بدم|کنم|money|پول)/
    ]
  },
  {
    id: 'SELL_DECISION',
    labelFa: 'تصمیم فروش',
    labelEn: 'Sell Decision',
    category: 'TRADING',
    risk: 'high',
    patterns: [/(بفروشم|بفروش|sell|خارج شم|exit).{0,24}(\?|؟|$|الان|now|ya|یا|یا نه|or not)/, /(بفروشم|sell\b)/]
  },
  {
    id: 'BUY_DECISION',
    labelFa: 'تصمیم خرید',
    labelEn: 'Buy Decision',
    category: 'TRADING',
    risk: 'high',
    patterns: [
      /(بخرم|الان بخر|buy now|should i buy|بخرم یا نه|نقطه ورود|entry|ورود)/,
      /(fomo|جا نمونم|جا نمانم|از دست بره)/
    ]
  },
  {
    id: 'WALLET_BALANCE',
    labelFa: 'موجودی کیف پول',
    labelEn: 'Wallet Balance',
    category: 'WALLET',
    risk: 'low',
    patterns: [/(موجودی|چقدر دارم|دارایی من|balance|holdings|how much (do )?i (have|own)|portfolio)/]
  },
  {
    id: 'WALLET_SECURITY',
    labelFa: 'امنیت کیف پول',
    labelEn: 'Wallet Security',
    category: 'SECURITY',
    risk: 'high',
    patterns: [
      /(امن|امنیت|secure|security|safe|هک|hack|دزدیده|stolen).{0,30}(کیف پول|wallet|پول|دارایی|funds|account|حساب|fbt|اپ|app|پلتفرم)/,
      /* Reversed word order: «کیف پول من امن است؟» / "is my wallet safe". */
      /(کیف پول|wallet|دارایی|funds|account|حساب|fbt).{0,30}(امن|امنیت|secure|security|safe|هک|hack|مطمئن)/,
      /* Key/recovery custody is a security question by definition. */
      /(کلید خصوصی|private key|عبارت بازیابی|recovery phrase|seed phrase|بازیابی کیف پول|recover.{0,20}wallet|کیف پولم رو بازیابی|کیف پول.{0,12}بازیابی)/
    ]
  },
  {
    id: 'HOW_TO_SWAP',
    labelFa: 'نحوه سواپ',
    labelEn: 'How to Swap',
    category: 'PRODUCT',
    risk: 'low',
    patterns: [/(swap|سواپ|تبدیل|convert).{0,30}(چطور|چگونه|how|راهنما|guide)/, /(چطور|چگونه|how).{0,30}(swap|سواپ|تبدیل|convert)/]
  },
  {
    id: 'HOW_TO_BRIDGE',
    labelFa: 'نحوه بریج',
    labelEn: 'How to Bridge',
    category: 'PRODUCT',
    risk: 'low',
    patterns: [/(bridge|بریج|cross.?chain).{0,30}(چطور|چگونه|how|راهنما|guide)/, /(چطور|چگونه|how).{0,30}(bridge|بریج|cross.?chain)/]
  },
  {
    id: 'FEES',
    labelFa: 'کارمزدها',
    labelEn: 'Fees',
    category: 'PRODUCT',
    risk: 'low',
    patterns: [/(کارمزد|fee|gas|اسلیپیج|slippage)/]
  },
  {
    id: 'PRICE_CHECK',
    labelFa: 'قیمت لحظه‌ای',
    labelEn: 'Price Check',
    category: 'MARKET',
    risk: 'low',
    patterns: [/(قیمت|price|چند|how much is).{0,24}(بیت|btc|bitcoin|اتریوم|eth|ethereum|سول|sol|solana|تتر|usdt|arbitrum|arb|ارز|کوین|token)/]
  },
  {
    id: 'DCA_AUTOMATION',
    labelFa: 'خرید خودکار / DCA',
    labelEn: 'DCA & Automation',
    category: 'PRODUCT',
    risk: 'medium',
    patterns: [/(dca|خرید خودکار|خودکار|automation|ربات|bot|زمان بندی|schedule)/]
  },
  {
    id: 'YIELD_STAKING',
    labelFa: 'سود و استیکینگ',
    labelEn: 'Yield & Staking',
    category: 'DEFI',
    risk: 'medium',
    patterns: [/(استیک|stake|staking|farm|farming|yield|سود|apy|apr|lend|وام|borrow)/]
  },
  {
    id: 'SIGNALS_SMART_MONEY',
    labelFa: 'سیگنال و اسمارت مانی',
    labelEn: 'Signals & Smart Money',
    category: 'SIGNALS',
    risk: 'medium',
    patterns: [/(سیگنال|signal|اسمارت مانی|smart money|نهنگ|whale|پول هوشمند)/]
  },
  {
    id: 'GENERAL_CRYPTO_KNOWLEDGE',
    labelFa: 'دانش عمومی کریپتو',
    labelEn: 'General Crypto Knowledge',
    category: 'KNOWLEDGE',
    risk: 'low',
    patterns: [/(چیست|چیه|یعنی چی|what is|what are|define|how does.{0,24}work|توضیح بده|explain)/]
  },
  {
    id: 'SUPPORT_ISSUE',
    labelFa: 'مشکل پشتیبانی',
    labelEn: 'Support Issue',
    category: 'SUPPORT',
    risk: 'medium',
    patterns: [/(کار نمی کنه|مشکل|error|باگ|bug|گیر کرده|stuck|failed|ناموفق|pending|تراکنش انجام نشد|support|پشتیبانی|crash|freeze|باز نمی شه|باز نمیشه|بالا نمیاد)/]
  }
]);

/* «how does staking work» is a mechanism question — general knowledge — even
   though it contains a yield keyword. Mechanism phrasing wins first. */
const MECHANISM_RE = /(how\s+(?:does|do)\s.{0,30}\swork|چطور\s*کار\s*می\s*کن[هد]|چگونه\s*کار\s*می\s*کن[هد]|way\s+of\s+work)/i;

/**
 * Assign a question to its cluster. Patterns are tried in catalog order;
 * the first hit wins, with `GENERAL_CRYPTO_KNOWLEDGE` and `OTHER` as the
 * catch-alls. Returns { clusterId, category, risk, confidence }.
 */
export function clusterQuestion(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { clusterId: 'OTHER', category: 'OTHER', risk: 'low', confidence: 0, normalized: '' };
  const normalized = normalizeUpgrade4(text);

  if (MECHANISM_RE.test(normalized)) {
    return { clusterId: 'GENERAL_CRYPTO_KNOWLEDGE', category: 'KNOWLEDGE', risk: 'low', confidence: 0.8, normalized };
  }

  for (const cluster of QUESTION_CLUSTERS) {
    for (const pattern of cluster.patterns) {
      if (pattern.test(normalized)) {
        return {
          clusterId: cluster.id,
          category: cluster.category,
          risk: cluster.risk,
          confidence: 0.85,
          normalized
        };
      }
    }
  }
  return { clusterId: 'OTHER', category: 'OTHER', risk: 'low', confidence: 0.3, normalized };
}

export function getCluster(id) {
  return QUESTION_CLUSTERS.find((c) => c.id === id) || null;
}

/* -------------------------------------------------------------------------- */
/*  KNOWLEDGE GAP DETECTION (§31)                                              */
/* -------------------------------------------------------------------------- */

/**
 * A cluster is a knowledge gap when it is BOTH frequent AND unresolved.
 * `stats` rows: { clusterId, count, resolutionRate, clarificationRate,
 * avgConfidence, correctionRate }.
 */
export function detectKnowledgeGaps(stats = [], { minCount = 3, resolutionFloor = 0.6, confidenceFloor = 55, clarificationCeiling = 0.4, correctionCeiling = 0.25 } = {}) {
  const gaps = [];
  for (const row of stats) {
    const count = Number(row.count) || 0;
    if (count < minCount) continue;
    const signals = [];
    if (Number(row.resolutionRate ?? 1) < resolutionFloor) signals.push('LOW_RESOLUTION');
    if (Number(row.avgConfidence ?? 100) < confidenceFloor) signals.push('LOW_CONFIDENCE');
    if (Number(row.clarificationRate ?? 0) > clarificationCeiling) signals.push('HIGH_CLARIFICATION');
    if (Number(row.correctionRate ?? 0) > correctionCeiling) signals.push('HIGH_CORRECTION');
    if (!signals.length) continue;

    const cluster = getCluster(row.clusterId);
    gaps.push({
      clusterId: row.clusterId,
      labelFa: cluster?.labelFa || row.clusterId,
      labelEn: cluster?.labelEn || row.clusterId,
      count,
      signals,
      recommendation: recommendForGap(row.clusterId, signals)
    });
  }
  return gaps.sort((a, b) => b.count - a.count);
}

export function recommendForGap(clusterId, signals = []) {
  const base = {
    TOKEN_RESEARCH: { action: 'NEW_DATA_SOURCE', detail: 'Connect protocol/on-chain data (docs, TVL, holders) for token deep-research answers.' },
    NEWS_IMPACT: { action: 'TOOL_INTEGRATION', detail: 'Wire the news impact engine into the default answer path for news questions.' },
    RISK_FEAR: { action: 'PROMPT_IMPROVEMENT', detail: 'Strengthen the emotional-response prompt: acknowledge, explain risk, offer structured assessment.' },
    USDT_PURCHASE: { action: 'FAQ_UPDATE', detail: 'Publish a reviewed on-ramp FAQ (rial → USDT paths, limits, timing).' },
    WALLET_SECURITY: { action: 'FAQ_UPDATE', detail: 'Publish a reviewed self-custody security FAQ (what FBT never asks for, recovery reality).' },
    HOW_TO_SWAP: { action: 'FAQ_UPDATE', detail: 'Link the swap guide directly from chat answers.' },
    HOW_TO_BRIDGE: { action: 'FAQ_UPDATE', detail: 'Link the bridge guide directly from chat answers.' },
    FEES: { action: 'FAQ_UPDATE', detail: 'Publish a fees & slippage explainer sourced from live route quotes.' },
    MARKET_OUTLOOK: { action: 'SPECIALIZED_AGENT', detail: 'Route outlook questions through the market+risk collaborative agents with live data.' },
    SUPPORT_ISSUE: { action: 'TOOL_INTEGRATION', detail: 'Surface real order/tx status tools before answering support questions.' },
    DCA_AUTOMATION: { action: 'FAQ_UPDATE', detail: 'Explain DCA automation limits and confirmation flow.' },
    YIELD_STAKING: { action: 'NEW_DATA_SOURCE', detail: 'Ground yield answers in the live yields provider only.' },
    SIGNALS_SMART_MONEY: { action: 'NEW_DATA_SOURCE', detail: 'Ground signals answers in the live signals/smart-money providers only.' }
  };
  const mapped = base[clusterId] || { action: 'KB_DOCUMENT', detail: 'Author a reviewed knowledge-base entry covering this question cluster.' };
  if (signals.includes('HIGH_CORRECTION') && mapped.action === 'FAQ_UPDATE') {
    return { ...mapped, action: 'PROMPT_IMPROVEMENT', detail: `${mapped.detail} Answers here are frequently corrected by users.` };
  }
  return mapped;
}

/* -------------------------------------------------------------------------- */
/*  FAQ CANDIDATE GENERATION (§32) — DRAFT ONLY, never auto-published          */
/* -------------------------------------------------------------------------- */

const FAQ_TEMPLATES = {
  MARKET_OUTLOOK: {
    questionFa: 'چشم‌انداز بازار را چگونه بررسی کنم؟',
    questionEn: 'How do I check the market outlook?',
    outlineFa: 'ابزارهای تحلیل بازار FBT + داده‌های زنده + سناریوهای صعودی/نزولی + سلب مسئولیت تحلیلی.',
    outlineEn: 'FBT market analysis tools + live data + bull/bear scenarios + analysis disclaimer.'
  },
  USDT_PURCHASE: {
    questionFa: 'چگونه با تومان تتر (USDT) بخرم؟',
    questionEn: 'How do I buy USDT with toman?',
    outlineFa: 'مسیرهای ورود ریال، محدودیت‌ها، زمان‌بندی و کارمزدها — فقط بر اساس قابلیت‌های واقعی محصول.',
    outlineEn: 'Rial on-ramp paths, limits, timing and fees — only real product capabilities.'
  },
  WALLET_SECURITY: {
    questionFa: 'چگونه دارایی‌های من محافظت می‌شوند؟',
    questionEn: 'How are my assets protected?',
    outlineFa: 'غیرامانی بودن کیف پول، کلیدها در دستگاه کاربر، هیچ‌کس از FBT عبارت بازیابی نمی‌خواهد.',
    outlineEn: 'Non-custodial wallet, keys stay on device, FBT never asks for recovery phrases.'
  },
  TOKEN_RESEARCH: {
    questionFa: 'درباره یک توکن چه اطلاعاتی می‌توانم بگیرم؟',
    questionEn: 'What can I learn about a token?',
    outlineFa: 'پروژه، توکنومیکس، شبکه، نقدینگی، اخبار و ریسک‌ها — با ذکر منابع معتبر.',
    outlineEn: 'Project, tokenomics, network, liquidity, news and risks — with cited sources.'
  },
  RISK_FEAR: {
    questionFa: 'وقتی بازار می‌ریزد چه کنم؟',
    questionEn: 'What should I do when the market drops?',
    outlineFa: 'بررسی ریسک پرتفوی، سناریوهای نزولی، پرهیز از تصمیم هیجانی — بدون توصیه قطعی.',
    outlineEn: 'Portfolio risk review, downside scenarios, avoiding impulsive moves — no firm advice.'
  },
  FEES: {
    questionFa: 'کارمزدها چگونه محاسبه می‌شوند؟',
    questionEn: 'How are fees calculated?',
    outlineFa: 'کارمزد شبکه + اسلیپیج مسیر، نمایش واقعی در پیش‌نمایش سواپ.',
    outlineEn: 'Network fee + route slippage, shown for real in the swap preview.'
  },
  HOW_TO_SWAP: {
    questionFa: 'چگونه سواپ انجام دهم؟',
    questionEn: 'How do I swap?',
    outlineFa: 'انتخاب مبدأ/مقصد، پیش‌نمایش قیمت، تأیید کیف پول.',
    outlineEn: 'Pick source/target, preview the route, confirm in your wallet.'
  },
  HOW_TO_BRIDGE: {
    questionFa: 'چگونه دارایی را بین شبکه‌ها جابه‌جا کنم؟',
    questionEn: 'How do I move assets across chains?',
    outlineFa: 'مقایسه مسیر بریج، کارمزد و زمان، تأیید تراکنش.',
    outlineEn: 'Compare bridge routes, fees and timing, confirm the transaction.'
  },
  DCA_AUTOMATION: {
    questionFa: 'خرید خودکار (DCA) چگونه کار می‌کند؟',
    questionEn: 'How does DCA automation work?',
    outlineFa: 'زمان‌بندی، محدودیت‌ها و جریان تأیید کاربر.',
    outlineEn: 'Scheduling, limits and the user confirmation flow.'
  },
  YIELD_STAKING: {
    questionFa: 'از کجا سود (Yield) پیدا کنم؟',
    questionEn: 'Where do I find yield?',
    outlineFa: 'استخرهای زنده، APY واقعی و ریسک هر استخر.',
    outlineEn: 'Live pools, real APY and per-pool risk.'
  },
  SIGNALS_SMART_MONEY: {
    questionFa: 'سیگنال‌ها و اسمارت مانی چه هستند؟',
    questionEn: 'What are signals and smart money?',
    outlineFa: 'منبع داده، معنی سیگنال و اینکه سیگنال تضمین سود نیست.',
    outlineEn: 'Data source, what a signal means, and that signals are not profit guarantees.'
  }
};

/**
 * Shape a cluster into a FAQ CANDIDATE. Candidates are drafts by definition:
 * `status: 'draft'`, `reviewed: false` — publishing requires human review (§32).
 */
export function buildFaqCandidate(clusterId, { count = 0, locale = 'fa' } = {}) {
  const cluster = getCluster(clusterId);
  if (!cluster) return null;
  const template = FAQ_TEMPLATES[clusterId];
  if (!template) return null;
  return {
    schema: FAQ_CANDIDATE_SCHEMA,
    id: `faqcand_${clusterId.toLowerCase()}`,
    clusterId,
    status: 'draft',
    reviewed: false,
    publishable: false,
    demandCount: Number(count) || 0,
    language: String(locale || 'fa').slice(0, 2),
    questionFa: template.questionFa,
    questionEn: template.questionEn,
    outlineFa: template.outlineFa,
    outlineEn: template.outlineEn,
    generatedFrom: 'real-question-clusters',
    note: 'Generated from anonymized question analytics. MUST be reviewed by the product team before it becomes official copy.'
  };
}

export function buildFaqCandidates(stats = [], { minCount = 3, limit = 8 } = {}) {
  return stats
    .filter((s) => Number(s.count) >= minCount && FAQ_TEMPLATES[s.clusterId])
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((s) => buildFaqCandidate(s.clusterId, { count: s.count, locale: s.language }));
}

/* -------------------------------------------------------------------------- */
/*  FEEDBACK CLASSIFICATION (§64)                                              */
/* -------------------------------------------------------------------------- */

export const FEEDBACK_REASONS = Object.freeze([
  'incorrect', 'outdated', 'too_long', 'too_vague',
  'wrong_intent', 'missing_data', 'bad_recommendation', 'technical_issue'
]);

/** Map free-form feedback text (or a UI reason id) onto the fixed taxonomy. */
export function classifyFeedbackReason(reasonText) {
  const raw = String(reasonText || '').trim().toLowerCase();
  if (!raw) return null;
  if (FEEDBACK_REASONS.includes(raw)) return raw;
  const rules = [
    [/غلط|اشتباه|نادرست|wrong|incorrect|false|hallucinat/i, 'incorrect'],
    [/قدیمی|outdated|استاله|stale|expired/i, 'outdated'],
    [/طولانی|طولانیه|too long|verbose/i, 'too_long'],
    [/مبهم|کلی|vague|unclear|general/i, 'too_vague'],
    [/منظورم|نفهمید|intent|متوجه نشد|misunderst/i, 'wrong_intent'],
    [/داده|اطلاعات|قیمت|data|missing|number|عدد/i, 'missing_data'],
    [/پیشنهاد|توصیه|advice|recommend/i, 'bad_recommendation'],
    [/باگ|ارور|کار نکرد|error|bug|crash|timeout|technical/i, 'technical_issue']
  ];
  for (const [re, reason] of rules) if (re.test(raw)) return reason;
  return 'technical_issue';
}
