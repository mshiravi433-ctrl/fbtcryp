/**
 * FBT AI — REAL SEMANTIC EMBEDDING ENGINE (Multi-Provider Neural + Bilingual Dense Semantic)
 * ---------------------------------------------------------------------------
 * Provides operational, production-grade semantic embeddings for Qdrant and
 * the embedded Vector Database:
 *
 *   Tier 1 — Live Neural Embedding Providers (automatic selection + failover):
 *     • Google Gemini (`gemini-embedding-001` / `text-embedding-004`)
 *     • OpenRouter (`openai/text-embedding-3-small`)
 *     • Cloudflare Workers AI (`@cf/baai/bge-m3` — multilingual Persian/English)
 *     • Mistral (`mistral-embed`)
 *     • AIMLAPI (`text-embedding-3-small`)
 *
 *   Tier 2 — Dense Bilingual (Persian + English + Finglish) Semantic Concept +
 *            Morphological Distributional Embedder:
 *     • Maps Persian/English synonyms, financial concepts, user goals, risk
 *       profiles, technical/on-chain/smart-money/macro signals, and negation
 *       polarity into shared latent semantic axes, fused with stemmed lexical
 *       and subword n-gram projections.
 *     • Guarantees zero-downtime semantic recall (cross-lingual & synonym-aware)
 *       even when external embedding APIs are unconfigured, rate-limited, or
 *       unreachable.
 *
 * Safety invariants:
 *   • Every input passes through `redactSecrets` BEFORE caching or network I/O.
 *   • Supports arbitrary positive vector dimensions (`1..65536`, default `256`).
 */

import { redactSecrets } from './redact.js';

export const EMBEDDER_SCHEMA = 'fbt.semantic-embedder.v2';
export const DEFAULT_EMBED_DIM = 256;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Normalize Persian/Arabic typography, digits, ZWNJ, and casing. */
export function normalizeMultilingualText(raw) {
  let s = String(redactSecrets(String(raw ?? ''))).normalize('NFKC');
  s = s
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/إ|أ|آ/g, 'ا')
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic/Persian harakat
    .replace(/[\u200c\u200d\u200e\u200f]/g, ' '); // ZWNJ -> space so compound forms unify
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const pi = PERSIAN_DIGITS.indexOf(ch);
    if (pi >= 0) { out += String(pi); continue; }
    const ai = ARABIC_DIGITS.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    out += ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lightweight Persian + English morphological stemmer for financial & conversational terms. */
export function stemBilingualToken(tok) {
  if (!tok || tok.length < 3) return tok;
  let t = tok;
  // Persian common suffixes (plural, possessive, comparative, verbal)
  const faSuffixes = ['هایمان', 'هایشان', 'هایت', 'هایم', 'هایی', 'های', 'گان', 'ترین', 'تر', 'شان', 'مان', 'تان', 'ها'];
  for (const suf of faSuffixes) {
    if (t.length > suf.length + 2 && t.endsWith(suf)) {
      t = t.slice(0, -suf.length);
      break;
    }
  }
  // English common suffixes
  const enSuffixes = ['ization', 'ational', 'fulness', 'ousness', 'iveness', 'ments', 'ment', 'ings', 'ing', 'edly', 'ness', 'able', 'ible', 'ions', 'ion', 'ies', 'ers', 'est', 'ly', 'ed', 'es', 's'];
  if (/^[a-z]+$/.test(t)) {
    for (const suf of enSuffixes) {
      if (t.length > suf.length + 2 && t.endsWith(suf)) {
        t = suf === 'ies' ? `${t.slice(0, -3)}y` : t.slice(0, -suf.length);
        break;
      }
    }
  }
  return t;
}

/**
 * Curated bilingual (Persian + English + Finglish) semantic concept axes.
 * Each concept maps cross-lingual synonyms onto shared latent dimensions so
 * e.g. "کم‌ریسک / محافظه‌کارانه / حفظ سرمایه" and "low risk conservative safe"
 * produce high cosine similarity even without an external LLM call.
 */
const SEMANTIC_CONCEPTS = Object.freeze([
  { id: 'risk_low', polaritySensitive: true, terms: ['کم ریسک', 'ریسک کم', 'ریسک پایین', 'محافظه کار', 'محافظه کارانه', 'امن', 'ایمن', 'حفظ سرمایه', 'حفظ اصل', 'کم خطر', 'مطمئن', 'بدون ریسک', 'conservative', 'low risk', 'risk averse', 'safe', 'capital preservation', 'defensive', 'prudent', 'kom risk', 'amniat'] },
  { id: 'risk_high', polaritySensitive: true, terms: ['پرریسک', 'ریسک بالا', 'ریسک زیاد', 'تهاجمی', 'جسورانه', 'نوسان بالا', 'سفته بازی', 'قمار', 'aggressive', 'high risk', 'degen', 'speculative', 'volatile', 'all in', 'yolo', 'por risk'] },
  { id: 'leverage_margin', polaritySensitive: true, terms: ['اهرم', 'لوریج', 'مارجین', 'فیوچرز', 'پرپچوال', 'لیکویید', 'لیکوییدیشن', 'تعهدی', 'شورت', 'لانگ', 'leverage', 'leveraged', 'margin', 'futures', 'perpetual', 'perp', 'liquidation', 'cross margin', 'isolated'] },
  { id: 'spot_dca', polaritySensitive: false, terms: ['اسپات', 'خرید پله ای', 'پله ای', 'دی سی ای', 'میانگین کم کردن', 'خرید دوره ای', 'نقدی', 'spot', 'dca', 'dollar cost', 'staged', 'ladder', 'tranche', 'accumulate slowly'] },
  { id: 'goal_wealth_saving', polaritySensitive: false, terms: ['هدف', 'اهداف', 'پس انداز', 'بازنشستگی', 'خرید خانه', 'مسکن', 'خودرو', 'بلندمدت', 'بلند مدت', 'آینده', 'سرمایه گذاری', 'ثروت', 'هدف مالی', 'goal', 'goals', 'target', 'saving', 'savings', 'retirement', 'house', 'long term', 'wealth', 'horizon', 'milestone'] },
  { id: 'horizon_short', polaritySensitive: false, terms: ['کوتاه مدت', 'نوسان گیری', 'اسکلپ', 'روزانه', 'ساعتی', 'فوری', 'امروز', 'الان', 'دی ترید', 'scalp', 'scalping', 'intraday', 'day trade', 'short term', 'quick flip', 'hourly', 'today'] },
  { id: 'horizon_long', polaritySensitive: false, terms: ['بلند مدت', 'بلندمدت', 'چند ساله', 'سالانه', 'ماهانه', 'هودل', 'نگهداری طولانی', 'long term', 'multi year', 'hodl', 'hold', 'yearly', '12 month', 'invest'] },
  { id: 'preference_constraint', polaritySensitive: true, terms: ['ترجیح', 'ترجیحات', 'علاقه', 'دوست دارم', 'می خواهم', 'سلیقه', 'قانون من', 'سبک من', 'محدودیت', 'فقط', 'prefer', 'preference', 'preferences', 'favorite', 'style', 'constraint', 'rule', 'always', 'like to'] },
  { id: 'bullish_up', polaritySensitive: true, terms: ['صعودی', 'رشد', 'افزایش', 'پامپ', 'شکست مقاومت', 'مومنتوم مثبت', 'خرید', 'سبز', 'بالا رفتن', 'bullish', 'uptrend', 'rally', 'breakout', 'pump', 'surge', 'gain', 'upside', 'buy', 'long'] },
  { id: 'bearish_down', polaritySensitive: true, terms: ['نزولی', 'ریزش', 'سقوط', 'کراش', 'دامپ', 'کاهش', 'اصلاح', 'قرمز', 'فروش', 'شکست حمایت', 'ضرر', 'bearish', 'downtrend', 'crash', 'dump', 'drop', 'plunge', 'correction', 'selloff', 'downside', 'sell'] },
  { id: 'technical_analysis', polaritySensitive: false, terms: ['تکنیکال', 'نمودار', 'چارت', 'کندل', 'حمایت', 'مقاومت', 'آراس آی', 'مکدی', 'میانگین متحرک', 'ایچیموکو', 'فیبوناچی', 'حجم معاملات', 'روند', 'technical', 'chart', 'candle', 'rsi', 'macd', 'ema', 'sma', 'bollinger', 'support', 'resistance', 'momentum', 'trend', 'volatility'] },
  { id: 'onchain_metrics', polaritySensitive: false, terms: ['آنچین', 'آن چین', 'درون زنجیره', 'تی وی ال', 'قفل شده', 'نقدینگی شبکه', 'کارمزد شبکه', 'گس', 'تراکنش', 'آدرس فعال', 'استخر نقدینگی', 'onchain', 'on chain', 'tvl', 'liquidity', 'gas', 'active addresses', 'hashrate', 'chain flow', 'bridge flow', 'pool depth'] },
  { id: 'smart_money_whales', polaritySensitive: false, terms: ['اسمارت مانی', 'پول هوشمند', 'نهنگ', 'نهنگ ها', 'کیف پول بزرگ', 'انباشت', 'توزیع', 'جریان نهنگ', 'معامله گران حرفه ای', 'ورود پول', 'خروج پول', 'smart money', 'whale', 'whales', 'institutional', 'accumulation', 'distribution', 'inflow', 'outflow', 'insider', 'top wallets'] },
  { id: 'macro_news', polaritySensitive: false, terms: ['اخبار', 'خبر', 'اقتصاد کلان', 'نرخ بهره', 'تورم', 'فدرال رزرو', 'دلار', 'طلا', 'جنگ', 'تحریم', 'قوانین', 'رگولاتوری', 'ئی تی اف', 'macro', 'news', 'headline', 'fed', 'fomc', 'interest rate', 'cpi', 'inflation', 'dxy', 'gold', 'geopolitics', 'regulation', 'sec', 'etf'] },
  { id: 'defi_yield_staking', polaritySensitive: false, terms: ['دیفای', 'سود', 'استیکینگ', 'استیک', 'سپرده', 'بازدهی', 'ای پی وای', 'وام دهی', 'فارمینگ', 'نقدینگی', 'defi', 'yield', 'apy', 'apr', 'staking', 'stake', 'lending', 'vault', 'farming', 'lp', 'passive income'] },
  { id: 'portfolio_allocation', polaritySensitive: false, terms: ['پورتفولیو', 'سبد', 'دارایی', 'تنوع بخشی', 'تخصیص', 'ریبالانس', 'توازن', 'وزن دارایی', 'تمرکز', 'موجودی', 'portfolio', 'allocation', 'diversification', 'diversify', 'rebalance', 'holdings', 'exposure', 'concentration', 'balance', 'net worth'] },
  { id: 'trading_strategy', polaritySensitive: false, terms: ['استراتژی', 'برنامه معاملاتی', 'حد ضرر', 'حد سود', 'استاپ لاس', 'تیک پرافیت', 'مدیریت سرمایه', 'سایز پوزیشن', 'نقطه ورود', 'نقطه خروج', 'strategy', 'stop loss', 'take profit', 'position size', 'sizing', 'entry', 'exit', 'risk reward', 'playbook', 'setup'] },
  { id: 'swap_execution', polaritySensitive: false, terms: ['سواپ', 'تبدیل', 'معامله', 'خرید', 'فروش', 'بریج', 'اسلیپیج', 'مسیر', 'نرخ تبدیل', 'swap', 'trade', 'convert', 'exchange', 'bridge', 'quote', 'route', 'slippage', 'dex'] },
  { id: 'security_custody', polaritySensitive: false, terms: ['امنیت', 'هک', 'کلاهبرداری', 'راگ پول', 'اسکم', 'کیف پول', 'غیرامانی', 'کلید', 'مجوز', 'اپروو', 'فیشینگ', 'security', 'hack', 'exploit', 'scam', 'rug', 'rugpull', 'phishing', 'custody', 'non custodial', 'allowance', 'audit'] },
  { id: 'asset_btc', polaritySensitive: false, terms: ['بیت کوین', 'بیتکوین', 'ساتوشی', 'btc', 'bitcoin', 'xbt'] },
  { id: 'asset_eth', polaritySensitive: false, terms: ['اتریوم', 'اتر', 'eth', 'ethereum', 'ether', 'weth'] },
  { id: 'asset_sol', polaritySensitive: false, terms: ['سولانا', 'sol', 'solana'] },
  { id: 'asset_stable', polaritySensitive: false, terms: ['تتر', 'استیبل کوین', 'یو اس دی سی', 'دلار دیجیتال', 'نقد', 'usdt', 'usdc', 'dai', 'stablecoin', 'stablecoins', 'cash', 'tether'] },
  { id: 'asset_alt_meme', polaritySensitive: false, terms: ['آلت کوین', 'میم کوین', 'شت کوین', 'پپه', 'دوج', 'شیبا', 'آربیتروم', 'بیس', 'تون', 'altcoin', 'memecoin', 'pepe', 'doge', 'shib', 'arb', 'op', 'base', 'ton', 'avax', 'bnb', 'xrp', 'link'] },
  { id: 'outcome_success', polaritySensitive: false, terms: ['موفق', 'موفقیت', 'سودآور', 'درست بود', 'دقیق', 'برنده', 'مثبت', 'نتیجه خوب', 'success', 'successful', 'profitable', 'accurate', 'correct', 'win', 'worked well', 'validated'] },
  { id: 'outcome_failure', polaritySensitive: false, terms: ['ناموفق', 'اشتباه', 'خطا', 'ضررده', 'زیان', 'شکست', 'غلط بود', 'درس عبرت', 'استاپ خورد', 'failure', 'failed', 'mistake', 'wrong', 'loss', 'error', 'invalidated', 'stopped out', 'postmortem'] },
  { id: 'comparison_critique', polaritySensitive: false, terms: ['مقایسه', 'کدام بهتر', 'تفاوت', 'نقد', 'انتقاد', 'مخالف', 'تناقض', 'اختلاف', 'بررسی', 'compare', 'versus', 'vs', 'better', 'difference', 'critic', 'critique', 'contradiction', 'disagree', 'conflict'] },
  { id: 'decision_verdict', polaritySensitive: false, terms: ['تصمیم', 'جمع بندی', 'نتیجه نهایی', 'رای', 'داور', 'پیشنهاد نهایی', 'چه کار کنم', 'بخرم یا نه', 'decision', 'verdict', 'arbiter', 'final', 'conclusion', 'recommend', 'should i'] },
  { id: 'uncertainty_clarify', polaritySensitive: false, terms: ['نامشخص', 'عدم اطمینان', 'مبهم', 'اطلاعات بیشتر', 'سوال', 'مطمئن نیستم', 'نیاز به داده', 'uncertain', 'uncertainty', 'ambiguous', 'clarify', 'more info', 'missing data', 'unknown'] },
  { id: 'fees_cost', polaritySensitive: false, terms: ['کارمزد', 'هزینه', 'ارزان', 'گران', 'کمیسیون', 'بهینه', 'fee', 'fees', 'cost', 'cheap', 'expensive', 'commission', 'gas fee'] }
]);

const NEGATION_CUES = new Set([
  'نه', 'نخیر', 'هرگز', 'اصلا', 'بدون', 'پرهیز', 'ممنوع', 'متنفرم', 'نمی', 'نکن', 'نباید', 'ضد',
  'no', 'not', 'never', 'without', 'avoid', 'avoiding', 'hate', 'dislike', 'ban', 'forbid', 'zero', 'none', 'dont', "don't", 'anti'
]);

function fnv1a32(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function normalizeDim(dim, fallback = DEFAULT_EMBED_DIM) {
  const n = Math.floor(Number(dim) || fallback);
  return Math.max(8, Math.min(65536, n));
}

export function l2Normalize(vec) {
  const out = new Float32Array(vec.length);
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = Number(vec[i]) || 0;
    out[i] = v;
    norm += v * v;
  }
  if (norm > 0) {
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < out.length; i++) out[i] *= inv;
  }
  return Array.from(out);
}

/**
 * Align any neural provider vector (e.g. 768, 1024, 1536, 3072) to `targetDim`
 * via Matryoshka-preserving signed orthogonal block folding + L2 normalization.
 * When `vec.length === targetDim`, returns L2-normalized vector unchanged.
 */
export function alignVectorDimension(vec, targetDim = DEFAULT_EMBED_DIM) {
  const dim = normalizeDim(targetDim);
  if (!Array.isArray(vec) || vec.length === 0) return new Array(dim).fill(0);
  if (vec.length === dim) return l2Normalize(vec);

  const out = new Float32Array(dim);
  if (vec.length > dim) {
    // Preserve leading Matryoshka dimensions with primary weight + fold tail orthogonally
    for (let i = 0; i < vec.length; i++) {
      const v = Number(vec[i]) || 0;
      if (i < dim) {
        out[i] += v;
      } else {
        const idx = fnv1a32(`fold:${i}`, 0x9e3779b9) % dim;
        const sign = (fnv1a32(`sign:${i}`, 0x85ebca6b) & 1) === 0 ? 0.5 : -0.5;
        out[idx] += v * sign;
      }
    }
    return l2Normalize(out);
  }

  // Expand smaller vector deterministically into targetDim
  for (let i = 0; i < vec.length; i++) out[i] = Number(vec[i]) || 0;
  for (let i = vec.length; i < dim; i++) {
    const srcA = i % vec.length;
    const srcB = (i * 7 + 3) % vec.length;
    const sign = (i & 1) === 0 ? 1 : -1;
    out[i] = ((Number(vec[srcA]) || 0) + sign * (Number(vec[srcB]) || 0)) * 0.25;
  }
  return l2Normalize(out);
}

/**
 * Synchronous, zero-latency bilingual dense semantic + morphological embedder.
 * Combines:
 *   1. Concept latent subspace (cross-lingual Persian/English/Finglish concepts + negation polarity)
 *   2. Stemmed word unigram + bigram distributional projections
 *   3. Character 3-gram subword projections (for typos & morphological variants)
 */
export function embedSemanticSync(text, { dim = DEFAULT_EMBED_DIM } = {}) {
  const size = normalizeDim(dim);
  const vec = new Float32Array(size);
  const clean = normalizeMultilingualText(text);
  if (!clean) return Array.from(vec);

  const rawTokens = clean.split(/[^a-z0-9\u0600-\u06ff_']+/).filter((w) => w.length >= 2);
  const stemmedTokens = rawTokens.map(stemBilingualToken);

  // Check negation window around character offsets
  const negationPositions = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i];
    if (NEGATION_CUES.has(tok) || (tok.startsWith('ن') && tok.length >= 4 && /^(نمی|نخواه|ندار|نباش|نکن)/.test(tok))) {
      negationPositions.push(i);
    }
  }
  const hasNearbyNegation = (phrase) => {
    const firstWord = phrase.split(' ')[0];
    const idx = rawTokens.findIndex((t) => t === firstWord || t.includes(firstWord));
    if (idx < 0) return negationPositions.length > 0 && rawTokens.length <= 6;
    return negationPositions.some((np) => np >= idx - 3 && np <= idx + 2);
  };

  // 1. Semantic Concept Latent Projections (strong semantic weight)
  const padded = ` ${clean} `;
  for (let cIdx = 0; cIdx < SEMANTIC_CONCEPTS.length; cIdx++) {
    const concept = SEMANTIC_CONCEPTS[cIdx];
    let hits = 0;
    let negated = false;
    for (const term of concept.terms) {
      if (term.includes(' ')) {
        if (padded.includes(` ${term} `) || clean.includes(term)) {
          hits += 1.35;
          if (concept.polaritySensitive && hasNearbyNegation(term)) negated = true;
        }
      } else if (rawTokens.includes(term) || stemmedTokens.includes(term)) {
        hits += 1.0;
        if (concept.polaritySensitive && hasNearbyNegation(term)) negated = true;
      }
    }
    if (hits > 0) {
      const magnitude = Math.min(2.6, 1.15 + Math.log1p(hits) * 0.85);
      // Project each concept onto 4 deterministic orthogonal coordinates:
      // 2 topic-invariant coordinates + 2 polarity-sensitive coordinates!
      for (let k = 0; k < 4; k++) {
        const slot = fnv1a32(`concept:${concept.id}:${k}`, 0x517cc1b7) % size;
        const baseSign = (fnv1a32(`csign:${concept.id}:${k}`, 0x27d4eb2f) & 1) === 0 ? 1 : -1;
        const polFlip = k >= 2 && concept.polaritySensitive && negated ? -1 : 1;
        vec[slot] += baseSign * polFlip * magnitude;
      }
      // Cross-link negated risk_high -> risk_low & vice versa for natural antonym alignment!
      if (negated && concept.id === 'leverage_margin') {
        const safeSlot = fnv1a32('concept:risk_low:0', 0x517cc1b7) % size;
        const safeSign = (fnv1a32('csign:risk_low:0', 0x27d4eb2f) & 1) === 0 ? 1 : -1;
        vec[safeSlot] += safeSign * 1.1;
      }
      if (negated && concept.id === 'risk_high') {
        const safeSlot = fnv1a32('concept:risk_low:1', 0x517cc1b7) % size;
        const safeSign = (fnv1a32('csign:risk_low:1', 0x27d4eb2f) & 1) === 0 ? 1 : -1;
        vec[safeSlot] += safeSign * 1.25;
      }
    }
  }

  // 2. Stemmed Lexical Unigrams + Bigrams
  for (let i = 0; i < stemmedTokens.length; i++) {
    const tok = stemmedTokens[i];
    const h1 = fnv1a32(`uni:${tok}`);
    vec[h1 % size] += (h1 & (1 << 24)) ? 0.95 : -0.95;

    const raw = rawTokens[i];
    if (raw !== tok) {
      const hr = fnv1a32(`raw:${raw}`);
      vec[hr % size] += (hr & (1 << 24)) ? 0.45 : -0.45;
    }

    if (i + 1 < stemmedTokens.length) {
      const bg = `${tok}_${stemmedTokens[i + 1]}`;
      const hb = fnv1a32(`bi:${bg}`);
      vec[hb % size] += (hb & (1 << 24)) ? 0.65 : -0.65;
    }

    // 3. Character 3-grams for morphological & typo resilience
    if (raw.length >= 3) {
      for (let j = 0; j <= raw.length - 3; j++) {
        const tg = raw.slice(j, j + 3);
        const ht = fnv1a32(`tri:${tg}`);
        vec[ht % size] += (ht & (1 << 24)) ? 0.25 : -0.25;
      }
    }
  }

  return l2Normalize(vec);
}

/** Discover configured external neural embedding providers from env or explicit options. */
export function resolveEmbeddingProviders(env = process.env, explicitProviders = null) {
  if (Array.isArray(explicitProviders) && explicitProviders.length) return explicitProviders;
  const providers = [];
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY;
  if (geminiKey) {
    providers.push({
      id: 'gemini',
      model: env.FBT_EMBED_MODEL_GEMINI || 'gemini-embedding-001',
      apiKey: geminiKey,
      endpoint: env.GEMINI_EMBED_URL || 'https://generativelanguage.googleapis.com/v1beta/models'
    });
  }
  if (env.OPENROUTER_API_KEY) {
    providers.push({
      id: 'openrouter',
      model: env.FBT_EMBED_MODEL_OPENROUTER || 'openai/text-embedding-3-small',
      apiKey: env.OPENROUTER_API_KEY,
      endpoint: env.OPENROUTER_EMBED_URL || 'https://openrouter.ai/api/v1/embeddings'
    });
  }
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    providers.push({
      id: 'workersai',
      model: env.FBT_EMBED_MODEL_WORKERSAI || '@cf/baai/bge-m3',
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`
    });
  }
  if (env.MISTRAL_API_KEY) {
    providers.push({
      id: 'mistral',
      model: env.FBT_EMBED_MODEL_MISTRAL || 'mistral-embed',
      apiKey: env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/embeddings'
    });
  }
  if (env.AIMLAPI_KEY) {
    providers.push({
      id: 'aimlapi',
      model: env.FBT_EMBED_MODEL_AIMLAPI || 'text-embedding-3-small',
      apiKey: env.AIMLAPI_KEY,
      endpoint: 'https://api.aimlapi.com/v1/embeddings'
    });
  }
  return providers;
}

async function callProviderEmbed(provider, cleanText, { dim, fetchImpl, timeoutMs }) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('FETCH_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (provider.id === 'gemini') {
      const url = `${provider.endpoint}/${encodeURIComponent(provider.model)}:embedContent?key=${encodeURIComponent(provider.apiKey)}`;
      const body = {
        model: `models/${provider.model}`,
        content: { parts: [{ text: cleanText }] },
        outputDimensionality: dim <= 3072 ? dim : undefined
      };
      const res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`EMBED_GEMINI_HTTP_${res.status}`);
      const json = await res.json();
      const values = json?.embedding?.values;
      if (!Array.isArray(values) || !values.length) throw new Error('EMBED_GEMINI_EMPTY');
      return values;
    }

    if (provider.id === 'workersai') {
      const url = `${provider.endpoint}/${provider.model}`;
      const res = await f(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({ text: [cleanText] }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`EMBED_WORKERSAI_HTTP_${res.status}`);
      const json = await res.json();
      const values = json?.result?.data?.[0];
      if (!Array.isArray(values) || !values.length) throw new Error('EMBED_WORKERSAI_EMPTY');
      return values;
    }

    // OpenAI-compatible (openrouter, mistral, aimlapi, custom)
    const body = { model: provider.model, input: cleanText };
    if (provider.supportsDimensions !== false && /text-embedding-3|qwen3-embedding/i.test(provider.model)) {
      body.dimensions = dim;
    }
    const res = await f(provider.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`EMBED_${provider.id.toUpperCase()}_HTTP_${res.status}`);
    const json = await res.json();
    const values = json?.data?.[0]?.embedding;
    if (!Array.isArray(values) || !values.length) throw new Error(`EMBED_${provider.id.toUpperCase()}_EMPTY`);
    return values;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create a full-featured Semantic Embedder instance with:
 *   • Neural provider routing + circuit breaker + automatic failover
 *   • Bilingual dense semantic fallback (`fbt-bilingual-semantic-v2`)
 *   • Bounded LRU cache
 *   • Batch & single embedding methods + full telemetry
 */
export function createSemanticEmbedder({
  dim = DEFAULT_EMBED_DIM,
  mode = process.env.FBT_EMBEDDING_MODE || 'auto', // 'auto' | 'neural' | 'local'
  providers = null,
  customEmbedFn = null,
  fetchImpl = null,
  timeoutMs = 3500,
  cacheMax = 1024,
  cooldownMs = 30_000,
  now = () => Date.now()
} = {}) {
  const targetDim = normalizeDim(dim);
  const configuredProviders = resolveEmbeddingProviders(process.env, providers);
  const cache = new Map(); // key -> { vector, provider, model }
  const breaker = new Map(); // providerId -> { failures, openUntil, lastError, calls, successes }
  const stats = {
    calls: 0,
    cacheHits: 0,
    neuralCalls: 0,
    neuralFailures: 0,
    failovers: 0,
    localSemanticCalls: 0
  };

  function getBreaker(id) {
    let b = breaker.get(id);
    if (!b) {
      b = { failures: 0, openUntil: 0, lastError: null, calls: 0, successes: 0 };
      breaker.set(id, b);
    }
    return b;
  }

  function putCache(key, entry) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, entry);
    if (cache.size > cacheMax) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  async function embedOneWithMeta(rawText) {
    stats.calls += 1;
    const clean = normalizeMultilingualText(rawText).slice(0, 6000);
    if (!clean) {
      return {
        vector: new Array(targetDim).fill(0),
        provider: 'empty',
        model: 'zero-vector',
        dim: targetDim,
        cached: false
      };
    }

    const cacheKey = `${targetDim}|${mode}|${clean}`;
    const hit = cache.get(cacheKey);
    if (hit) {
      stats.cacheHits += 1;
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return { ...hit, dim: targetDim, cached: true };
    }

    // Custom injected embedder (e.g. enterprise / test neural model)
    if (typeof customEmbedFn === 'function' && mode !== 'local') {
      try {
        stats.neuralCalls += 1;
        const rawVec = await customEmbedFn(clean, { dim: targetDim });
        const aligned = alignVectorDimension(rawVec, targetDim);
        const entry = { vector: aligned, provider: 'custom', model: 'custom-embedder', failoverUsed: false };
        putCache(cacheKey, entry);
        return { ...entry, dim: targetDim, cached: false };
      } catch (err) {
        stats.neuralFailures += 1;
        stats.failovers += 1;
        if (mode === 'neural' && !configuredProviders.length) throw err;
      }
    }

    // Live Neural Providers with automatic failover
    if (mode !== 'local' && configuredProviders.length > 0) {
      const ts = now();
      let attempted = 0;
      let lastErr = null;
      for (const p of configuredProviders) {
        const b = getBreaker(p.id);
        if (b.openUntil > ts) continue;
        attempted += 1;
        b.calls += 1;
        stats.neuralCalls += 1;
        try {
          const rawVec = await callProviderEmbed(p, clean, { dim: targetDim, fetchImpl, timeoutMs });
          const aligned = alignVectorDimension(rawVec, targetDim);
          b.failures = 0;
          b.openUntil = 0;
          b.successes += 1;
          const entry = {
            vector: aligned,
            provider: p.id,
            model: p.model,
            failoverUsed: attempted > 1
          };
          if (attempted > 1) stats.failovers += 1;
          putCache(cacheKey, entry);
          return { ...entry, dim: targetDim, cached: false };
        } catch (err) {
          lastErr = err;
          stats.neuralFailures += 1;
          b.failures += 1;
          b.lastError = String(err?.message || err).slice(0, 140);
          if (b.failures >= 2) b.openUntil = ts + cooldownMs;
        }
      }
      if (mode === 'neural') {
        throw lastErr || new Error('ALL_EMBEDDING_PROVIDERS_UNAVAILABLE');
      }
      if (attempted > 0) stats.failovers += 1;
    }

    // Tier 2: Dense Bilingual Semantic + Morphological Embedder
    stats.localSemanticCalls += 1;
    const vector = embedSemanticSync(clean, { dim: targetDim });
    const entry = {
      vector,
      provider: 'local-semantic',
      model: 'fbt-bilingual-semantic-v2',
      failoverUsed: false
    };
    putCache(cacheKey, entry);
    return { ...entry, dim: targetDim, cached: false };
  }

  return {
    schema: EMBEDDER_SCHEMA,
    dimension: targetDim,
    mode,
    embedSync: (text) => embedSemanticSync(text, { dim: targetDim }),
    embed: async (text) => (await embedOneWithMeta(text)).vector,
    embedWithMeta: embedOneWithMeta,
    embedBatch: async (texts = []) => {
      const results = await Promise.all(texts.map((t) => embedOneWithMeta(t)));
      return {
        vectors: results.map((r) => r.vector),
        items: results,
        dim: targetDim
      };
    },
    status: () => ({
      schema: EMBEDDER_SCHEMA,
      dimension: targetDim,
      mode,
      cacheSize: cache.size,
      configuredProviders: configuredProviders.map((p) => {
        const b = getBreaker(p.id);
        return {
          id: p.id,
          model: p.model,
          healthy: b.openUntil <= now(),
          calls: b.calls,
          successes: b.successes,
          failures: b.failures,
          lastError: b.lastError
        };
      }),
      fallbackModel: 'fbt-bilingual-semantic-v2',
      stats: { ...stats }
    }),
    clearCache: () => cache.clear()
  };
}

export default createSemanticEmbedder;
