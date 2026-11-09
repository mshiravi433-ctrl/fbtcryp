/**
 * FBT AI — INTERNAL DEEP REASONING SYNTHESIZER
 * ---------------------------------------------------------------------------
 * Ensures FBT's intelligence layers (Economist Lens, Professor Pedagogy &
 * Falsifier, Knowledge Center, Multi-part Question Decomposition, Social/Emotion
 * /Discourse/Situation reads, Market Frame, Strategy Frame, Decision Gate, and
 * Partial Input Repair) produce genuine, structured, non-hallucinated reasoning
 * even when external LLM keys are not configured or when all external providers
 * fail/timeout.
 *
 * Non-negotiable invariants:
 *   · Never fabricates live prices, balances, APYs, dates, or percentages.
 *   · Always checks distress / safety before any analytical framing.
 *   · Preserves falsifiability on forward-looking / driver reasoning.
 *   · Returns `{ ok: false }` on opaque/unmatched inputs so `buildDegradedAnswer`
 *     keeps its honest operator/provider diagnostic notice intact.
 */

import { searchKnowledge } from '../src/lib/intent-ai/os/knowledgeCenter.js';
import { retrieve as retrieveBm25 } from '../src/lib/intent-ai/retrieval.js';
import { checkFalsifier } from './aiProfessor.js';
import { FEE_BPS, feePercentString } from '../src/lib/feeBps.js';
import { detectProductQuestion, answerProduct } from './aiProductBrain.js';

export const INTERNAL_REASONER_SCHEMA = 'fbt.internal-reasoner.v1';

const ASSET_ALIASES_IN_TEXT = [
  ['BTC', /(?:btc|bitcoin|بیت[\s\u200c]*کوین|بیتکوین)/i],
  ['ETH', /(?:eth|ethereum|اتریوم|اتر\b)/i],
  ['SOL', /(?:sol|solana|سولانا)/i],
  ['USDT', /(?:usdt|tether|تتر)/i],
  ['USDC', /(?:usdc|یو[\s\u200c]*اس[\s\u200c]*دی[\s\u200c]*سی)/i],
  ['GOLD', /(?:xau|gold|طلا)/i]
];

function uniqById(items = []) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * Retrieve rich, multi-part-aware verified knowledge passages.
 * Combines full-query hits, per-sub-question hits, and partial-repaired query hits.
 */
export function gatherExpandedKnowledge({
  message = '',
  repaired = '',
  subQuestions = [],
  existingKnowledge = [],
  locale = 'fa',
  limit = 4
} = {}) {
  const pool = [...(Array.isArray(existingKnowledge) ? existingKnowledge : [])];
  const queries = [
    message,
    repaired && repaired !== message ? repaired : null,
    ...(Array.isArray(subQuestions) ? subQuestions.map((s) => s?.text || s?.question || (typeof s === 'string' ? s : null)) : [])
  ].filter((q) => typeof q === 'string' && q.trim().length >= 2);

  for (const q of queries) {
    for (const k of searchKnowledge(q, { locale, limit: 3 })) {
      pool.push(k);
    }
    try {
      for (const p of retrieveBm25(q, { locale, limit: 2 })) {
        pool.push({ ...p, version: 1, bodyEn: p.bodyEn || p.body });
      }
    } catch { /* retrieval is additive */ }
  }

  return uniqById(pool)
    .sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(2, limit));
}

function formatPriceLines({ message = '', assets = [], context = {}, isFa = true } = {}) {
  const priceMap = context?.market?.priceMap;
  if (!priceMap || typeof priceMap !== 'object') return [];
  const mentioned = new Set((assets || []).map((a) => String(a).toUpperCase()));
  for (const [sym, re] of ASSET_ALIASES_IN_TEXT) {
    if (re.test(message)) mentioned.add(sym);
  }
  const entries = Object.entries(priceMap).filter(([, p]) => p != null && Number.isFinite(Number(p)));
  if (!entries.length) return [];

  const relevant = mentioned.size
    ? entries.filter(([sym]) => mentioned.has(String(sym).toUpperCase()))
    : (/بازار|مارکت|قیمت|market|price|crypto|معرفی|بخرم/i.test(message) ? entries.slice(0, 4) : []);
  if (!relevant.length) return [];

  const formatted = relevant.map(([sym, p]) => `${sym}: $${Number(p).toLocaleString('en-US')}`);
  const chg = context.market?.change24hPct;
  const chgNote = chg != null && Number.isFinite(Number(chg))
    ? (isFa ? ` (تغییر ۲۴ ساعت: ${Number(chg) >= 0 ? '+' : ''}${Number(chg).toFixed(1)}٪)` : ` (24h change: ${Number(chg) >= 0 ? '+' : ''}${Number(chg).toFixed(1)}%)`)
    : '';
  return [
    isFa
      ? `داده زنده بازار: ${formatted.join(' | ')}${chgNote}.`
      : `Live market snapshot: ${formatted.join(' | ')}${chgNote}.`
  ];
}

function buildSafetyReply(isFa) {
  return isFa
    ? 'می‌فهمم این وضعیت سنگین و فرساینده است. در این حالت هیچ توصیهٔ معاملاتی یا خرید و فروش نمی‌دهم و قولی دربارهٔ جبران سریع نمی‌دهم. بهترین کار الان توقف تصمیم‌های مالی تازه است؛ با یک فرد مورد اعتماد یا مشاور مستقل دربارهٔ فشار این موقعیت صحبت کن.'
    : 'I hear how heavy this situation feels. Right now I will not offer trading advice or make promises about recovery. The safest step is to pause any new financial decisions and talk through this with someone you trust or an independent professional.';
}

function buildRecommendationFramework({ message, context, partialRead, isFa }) {
  const lines = [];
  const priceLines = formatPriceLines({ message, context, isFa });
  if (priceLines.length) lines.push(priceLines[0]);

  if (isFa) {
    lines.push(
      'بدون دانستن افق زمانی، میزان تحمل افت سرمایه و هدف شما، معرفی یک کوین مشخص به‌عنوان «بهترین گزینه» حرفه‌ای نیست و توصیه مالی محسوب می‌شود. چارچوب انتخاب استاندارد به تفکیک سطح ریسک:'
    );
    lines.push(
      '• هسته کم‌ریسک‌تر بازار (Core): بیت‌کوین (BTC) بالاترین نقدشوندگی و سابقه بازار را دارد؛ برای بخش اصلی سبد با ریسک نسبتاً کمتر نسبت به آلت‌کوین‌ها، هرچند همچنان نوسانی است.\n'
      + '• لایه رشد و قرارداد هوشمند (L1 Core): اتریوم (ETH) یا سولانا (SOL) وابسته به فعالیت دیفای و کارمزد شبکه هستند؛ پتانسیل رشد و افت هر دو بیشتر از BTC است.\n'
      + '• سپر نقدینگی و بازده کم‌نوسان: نگهداری بخشی از سرمایه در استیبل‌کوین (USDC/USDT) یا استخرهای وام‌دهی معتبر برای کنترل افت سبد و خرید پله‌ای در اصلاح‌ها.'
    );
    lines.push(
      'شرط ابطال این تقسیم‌بندی: اگر افق شما بسیار کوتاه‌مدت باشد یا توان تحمل افت ۲۰ تا ۴۰ درصدی بازار کریپتو را نداشته باشید، وزن دارایی‌های پرنوسان باید به حداقل برسد.'
    );
  } else {
    lines.push(
      'Naming one coin as a universal pick without knowing your time horizon, drawdown tolerance, and goal would be guesswork, not sound analysis. A structured selection framework by risk tier:'
    );
    lines.push(
      '• Core Store-of-Value (BTC): deepest liquidity and longest market history; lower relative altcoin risk, though still sensitive to macro liquidity.\n'
      + '• Smart-Contract / L1 Growth (ETH / SOL): tied to on-chain usage, fees, and DeFi demand; higher upside beta and sharper drawdowns than BTC.\n'
      + '• Liquidity Buffer (USDC / USDT or audited lending): preserves dry powder for staged entries and limits portfolio-wide volatility.'
    );
    lines.push(
      'Falsifier / boundary: if your horizon is short-term or a 20–40% crypto drawdown violates your risk budget, volatile allocation should stay minimal.'
    );
  }

  if (!partialRead?.question?.text) {
    lines.push(
      isFa
        ? 'برای اینکه دقیق‌تر تطبیق بدهم، افق زمانی و سطح ریسک مدنظرت چیست — کم، متعادل یا پرریسک؟'
        : 'To narrow this down for you: what is your time horizon and preferred risk level — low, balanced, or high?'
    );
  }
  return lines;
}

function buildMacroWhySynthesis({ message, isFa }) {
  const lower = String(message || '').toLowerCase();
  const asksInflation = /(تورم|inflation|کمیاب|scarce|طلا|gold|چاپ پول|debasement)/i.test(lower);
  const asksRates = /(نرخ\s*بهره|فدرال|interest\s*rate|fed\b|fomc|dxy|نقدینگی|liquidity)/i.test(lower);
  const lines = [];

  if (asksInflation) {
    lines.push(isFa
      ? 'سازوکار اقتصادی: تورم قدرت خرید واحد پول فیات را کاهش می‌دهد؛ دارایی‌هایی که عرضهٔ محدود یا غیرکشسان دارند (مثل عرضهٔ محدود ۲۱ میلیونی بیت‌کوین یا استخراج محدود طلا) هم از نظر اسمی بازتنظیم قیمت می‌شوند و هم به‌عنوان ذخیرهٔ ارزش تقاضای بیشتری جذب می‌کنند.'
      : 'Economic mechanism: inflation erodes fiat purchasing power, prompting nominal repricing and store-of-value demand toward assets with inelastic or capped supply (such as 21M-capped Bitcoin or constrained gold supply).');
    lines.push(isFa
      ? 'کانال انتقال و هزینهٔ فرصت: عامل تعیین‌کننده «نرخ بهرهٔ واقعی» (نرخ اسمی منهای تورم) است. وقتی نرخ واقعی پایین یا منفی باشد، هزینهٔ فرصت نگهداری داراییِ بدون سود دوره‌ای کاهش می‌یابد و نقدینگی راحت‌تر به سمت دارایی‌های کمیاب می‌رود.'
      : 'Transmission & opportunity cost: the decisive variable is real yield (nominal rates minus inflation). Lower or negative real yields reduce the opportunity cost of holding non-yielding scarce assets and support capital rotation into them.');
    lines.push(isFa
      ? 'نکتهٔ نرخ پایه و شرط ابطال: افزایش تورم همیشه به معنی رشد فوری نیست؛ اگر بانک مرکزی در واکنش به تورم، نرخ بهرهٔ واقعی را تند بالا ببرد و نقدینگی را جمع کند (QT)، دارایی‌های ریسکی و حتی دارایی‌های کمیاب در کوتاه‌مدت زیر فشار قرار می‌گیرند تا زمانی که انقباض متوقف شود.'
      : 'Base-rate nuance & falsifier: inflation does not mechanically lift scarce assets in every phase — if central banks respond with aggressive real-rate hikes and liquidity contraction (QT), tightening liquidity can weigh on scarce and risk assets until policy peaks.');
  } else if (asksRates) {
    lines.push(isFa
      ? 'سازوکار و کانال انتقال: تغییر نرخ بهره از دو مسیر به بازار دارایی‌ها منتقل می‌شود — نرخ تنزیل جریان نقدی آینده و هزینهٔ تأمین مالی اهرم. کاهش نرخ واقعی و افت شاخص دلار (DXY) اشتهای ریسک را بالا می‌برد و افزایش آن‌ها نقدینگی حاشیه‌ای را جمع می‌کند.'
      : 'Mechanism & transmission: policy rate shifts transmit through discount rates and funding costs. Falling real yields and a softer DXY ease financial conditions for risk assets, while rising real yields tighten marginal leverage.');
    lines.push(isFa
      ? 'شرط ابطال: اگر جریان ورودی نهادی خاص (مثل تقاضای قوی اسپات ETF) یا ریسک اعتباری بانکی همبستگی معمول با نرخ بهره را بشکند، بازار می‌تواند موقتاً خلاف جهت نرخ‌ها حرکت کند.'
      : 'Falsifier: asset-specific institutional flows (such as sustained spot ETF inflows) or banking credit stress can temporarily override the usual inverse rate sensitivity.');
  }
  return lines;
}

function buildPartialValueSupport({ partialRead, context, strategyFrame, isFa }) {
  if (!partialRead || partialRead.completeness === 'complete' || partialRead.completeness === 'small-talk') return [];
  const lines = [];
  const act = partialRead.inferred?.act;
  const assets = partialRead.inferred?.assets || [];

  if (assets.includes('BTC') && !assets.some((a) => a !== 'BTC')) {
    lines.push(isFa
      ? 'تحلیل کلیدی BTC: چشم‌انداز کوتاه‌مدت بیت‌کوین به سه متغیر وابسته است — جریان خالص تقاضای اسپات و ETFها، مسیر نرخ بهرهٔ واقعی و نقدینگی جهانی، و سطح اهرم در بازار مشتقات (Funding و Open Interest). قیمت لحظه‌ایِ زنده تنها زمانی نقل می‌شود که داده در همین نوبت دریافت شده باشد؛ مگر اینکه جریان خروجی صندوق‌ها تداوم یابد یا انقباض نقدینگی تشدید شود.'
      : 'Core BTC read: near-term direction hinges on spot/ETF net demand, real-rate and global liquidity conditions, and derivatives leverage (funding & open interest). Live prices are quoted only when verified in this turn; bullish expectations weaken if ETF outflows persist or real yields tighten.');
  } else if (assets.includes('ETH') && !assets.some((a) => a !== 'ETH')) {
    lines.push(isFa
      ? 'ریسک و ساختار اتریوم (ETH): علاوه بر نوسان عمومی بازار کریپتو و همبستگی با نقدینگی کلان، ریسک‌های اختصاصی ETH شامل تغییر سهم کارمزد لایهٔ اصلی در برابر لایه‌دوها (L2 Rollups)، ریسک قراردادهای هوشمند و پل‌ها، رقابت اکوسیستم‌های رقیب، و ریسک تمرکز در استیکینگ/اهرم مشتقات است. بدون دریافت دادهٔ لحظه‌ای یا کندل در این نوبت، قیمت یا تارگت عددی حدس زده نمی‌شود و این ارزیابی با تغییر جریان ETF یا کارمزد شبکه باید بازنگری شود.'
      : 'ETH risk & structure: beyond macro crypto beta, ETH-specific risks include mainnet fee capture vs L2 rollups, smart-contract/bridge exposure, competing L1 ecosystems, and derivatives/staking leverage concentration. Without a live snapshot in this turn, no price or target is invented; reassess if institutional flows or network fee revenue shifts.');
  } else if (assets.length) {
    const list = assets.join(', ');
    lines.push(isFa
      ? `برای ${list}: بدون دریافت کندل چندبازه در این نوبت، اندیکاتور یا تارگت قیمتی حدس نمی‌زنم؛ بررسی استاندارد ریسک شامل عمق نقدینگی اسپات، نوسان تاریخی، تمرکز هولدرها و ریسک قرارداد هوشمند/اهرم است و با چرخش جریان نقدینگی باید بازبینی شود.`
      : `For ${list}: without multi-timeframe candle series in this turn, I will not invent indicators or price targets; standard risk assessment checks spot liquidity, historical drawdown, holder concentration, and smart-contract/leverage exposure, subject to revision if liquidity flows reverse.`);
  } else if (act === 'strategy' || strategyFrame) {
    const cap = strategyFrame?.capitalUsd;
    const feePct = feePercentString(FEE_BPS);
    lines.push(isFa
      ? `چارچوب طراحی استراتژی${cap ? ` روی سرمایهٔ $${Number(cap).toLocaleString('en-US')}` : ''}: برای سبد واقعی، ابتدا باید افق زمانی و بیشینه افت قابل‌تحمل (Drawdown Budget) مشخص شود؛ هر جابه‌جایی در FBT کارمزد پایهٔ ${feePct}٪ (حداکثر رفت‌وبرگشت حدود ${(Number(feePct) * 2).toFixed(1)}٪) به علاوهٔ گس شبکه دارد که بازده خالص استراتژی‌های کوتاه‌مدت را محدود می‌کند.`
      : `Strategy framework${cap ? ` for $${Number(cap).toLocaleString('en-US')} capital` : ''}: a sound plan pairs capital with a time horizon and drawdown budget; each FBT swap carries a ${feePct}% base fee (~${(Number(feePct) * 2).toFixed(1)}% round-trip) plus network gas, which constrains high-turnover plans.`);
  } else if (act === 'buy' || act === 'sell' || act === 'swap') {
    lines.push(isFa
      ? 'پیش از آماده کردن مسیر غیرامانی (بدون اجرا بدون امضای شما)، دارایی هدف و مقدار معامله لازم است تا نرخ، اسلیپیج و کارمزد شبکه بررسی شوند.'
      : 'Before preparing a non-custodial quote preview (never executed without your wallet signature), I need the asset and amount to check live pricing, slippage, and gas.');
  }
  return lines;
}

/**
 * Synthesize an intelligent, grounded, multi-layer internal response.
 * Returns `{ ok: true, answer, knowledgeUsed, internalSynthesis: true, falsifierApplied }`
 * or `{ ok: false }` when there is genuinely no grounded topic/evidence to answer from.
 */
export function synthesizeInternalAnswer({
  message = '',
  locale = 'fa',
  context = {},
  knowledge = [],
  sources = [],
  subQuestions = [],
  economistLenses = [],
  professorLenses = [],
  socialRead = null,
  emotionRead = null,
  situationRead = null,
  discourseRead = null,
  dialogueRead = null,
  marketFrame = null,
  strategyFrame = null,
  decisionEvidence = null,
  partialRead = null,
  productRead = null,
  plan = null
} = {}) {
  const isFa = String(locale || 'fa').startsWith('fa');

  /* ── 1. Safety & acute distress always take absolute precedence ─────── */
  const panicSellDistress = /(?:خیلی\s*)?ضرر\s*کردم.{0,40}(?:حالم\s*بد|ناراحتم|ترسیدم)|(?:همشو|همه‌شو|همه\s*چیمو|همه\s*پولمو)\s*بفروشم/i.test(String(message || ''));
  if (socialRead?.distress || panicSellDistress || (emotionRead?.acute && ['grief', 'shame', 'burnout'].includes(emotionRead.primary) && Number(emotionRead.intensity) >= 0.7)) {
    return {
      ok: true,
      schema: INTERNAL_REASONER_SCHEMA,
      answer: buildSafetyReply(isFa),
      knowledgeUsed: false,
      internalSynthesis: true,
      safetyContainment: true
    };
  }

  /* ── 2. Indirect refusal: accept gracefully without pushing ─────────── */
  if (socialRead?.pragmatics?.indirectRefusal) {
    return {
      ok: true,
      schema: INTERNAL_REASONER_SCHEMA,
      answer: isFa
        ? 'باشه، هیچ عجله‌ای نیست و الان کاری پیشنهاد یا اجرا نمی‌کنم. هر زمان سؤال یا نیازی داشتی همین‌جا بپرس.'
        : 'Understood — no rush, and I will not push or propose anything right now. Ask whenever you are ready.',
      knowledgeUsed: false,
      internalSynthesis: true
    };
  }

  const repairedMsg = Array.isArray(partialRead?.repairs) && partialRead.repairs.length && partialRead.repaired
    ? partialRead.repaired
    : message;

  const effectiveProductRead = productRead || (detectProductQuestion(repairedMsg) ? answerProduct({ message: repairedMsg, locale }) : null);

  /* ── 3. Verified product brain (early-exit ONLY when single-topic FBT) ── */
  const isCompoundProductQuestion = Boolean(
    effectiveProductRead?.answer
    && (
      (Array.isArray(subQuestions) && subQuestions.length >= 2)
      || (/(?:بیت[\s\u200c]*کوین|بیتکوین|اتریوم|سولانا|btc|eth|sol|قیمت|چنده|price|تورم|mvrv)/i.test(repairedMsg)
          && /(?:کارمزد|fee|غیرامانی|non-custodial|fbt)/i.test(repairedMsg))
    )
  );
  if (effectiveProductRead && effectiveProductRead.answer && !isCompoundProductQuestion) {
    return {
      ok: true,
      schema: INTERNAL_REASONER_SCHEMA,
      answer: effectiveProductRead.answer,
      knowledgeUsed: true,
      internalSynthesis: true
    };
  }

  /* ── 4. Gather expanded, multi-part verified knowledge ──────────────── */
  const explicitBtc = /(?:btc|bitcoin|بیت[\s\u200c]*کوین|بیتکوین)/i.test(repairedMsg);
  const inferredAssets = Array.isArray(partialRead?.inferred?.assets) ? partialRead.inferred.assets : [];
  const otherAssetFollowUp = !explicitBtc && inferredAssets.some((a) => a && a !== 'BTC');

  const rawKb = gatherExpandedKnowledge({
    message,
    repaired: repairedMsg,
    subQuestions,
    existingKnowledge: knowledge,
    locale,
    limit: 6
  });
  const expandedKb = otherAssetFollowUp
    ? rawKb.filter((k) => k.id !== 'kb.economics.btc-drivers' && k.id !== 'kb.crypto.btc')
    : rawKb;

  const sections = [];

  /* ── 5. Social & emotional lead-in (calibrated, never overbearing) ───── */
  if (socialRead?.pragmatics?.taarof && !socialRead.distress) {
    sections.push(isFa ? 'خواهش می‌کنم، در خدمتم.' : 'Glad to help.');
  } else if (emotionRead?.primary === 'fear' || socialRead?.tone === 'anxious') {
    sections.push(isFa
      ? 'طبیعی است که نوسان بازار نگران‌کننده باشد؛ به‌جای حدس، فقط بر پایهٔ داده و مدیریت ریسک بررسی می‌کنیم.'
      : 'Market volatility is understandably unsettling; let us look strictly at verified data and risk boundaries instead of guessing.');
  } else if (socialRead?.tone === 'frustrated' || socialRead?.tone === 'hostile') {
    sections.push(isFa
      ? 'متوجهم که وضعیت خسته‌کننده است؛ مستقیم و شفاف سراغ اصل مطلب می‌روم.'
      : 'I understand the frustration; let me get straight to the point clearly.');
  }

  if (situationRead?.hasRead && situationRead.direction === 'loss' && situationRead.pct != null) {
    const pctStr = Math.abs(Number(situationRead.pct)).toFixed(1);
    sections.push(isFa
      ? `وضعیت خوانده‌شدهٔ سبد شما (${pctStr}٪ افت در خوانش فعلی${situationRead.concentration?.symbol ? ` با تمرکز روی ${situationRead.concentration.symbol}` : ''}) نشان می‌دهد اولویت با کنترل ریسک و پرهیز از جبران هیجانی است.`
      : `Your current portfolio read (${pctStr}% down${situationRead.concentration?.symbol ? `, concentrated in ${situationRead.concentration.symbol}` : ''}) argues for capital protection rather than aggressive recovery risk.`);
  }

  /* ── 6. Open-ended discovery / buy-recommendation query ─────────────── */
  const isDiscoveryRec = /(?:معرفی\s*کن|پیشنهاد\s*بده|چی\s*(?:خوبه|بخرم)|یه\s*چی\s*(?:خوب|بخرم)|کدوم\s*(?:ارز|توکن|کوین)|چه\s*ارزی.{0,20}(?:بخرم|خوبه)|what\s+(?:should\s+i|to)\s+buy|which\s+(?:coin|token|asset).{0,20}buy|recommend\s+(?:something|a\s+coin))/i.test(repairedMsg);
  if (isDiscoveryRec) {
    sections.push(...buildRecommendationFramework({ message: repairedMsg, context, partialRead, isFa }));
    return {
      ok: true,
      schema: INTERNAL_REASONER_SCHEMA,
      answer: sections.join('\n\n'),
      knowledgeUsed: expandedKb.length > 0,
      internalSynthesis: true
    };
  }

  /* ── 7. Live market & frame grounding ───────────────────────────────── */
  const priceLines = formatPriceLines({
    message: repairedMsg,
    assets: partialRead?.inferred?.assets || [],
    context,
    isFa
  });
  if (priceLines.length) sections.push(...priceLines);

  if (marketFrame && marketFrame.dataStatus === 'live' && marketFrame.instruments?.length >= 2) {
    const reg = marketFrame.regime || 'mixed';
    const leader = marketFrame.leadership?.[0]?.symbol;
    sections.push(isFa
      ? `نمای رژیم بازار (${marketFrame.instruments.length} دارایی): رژیم کلی «${reg}»${leader ? `، پیشران نسبی ${leader}` : ''}؛ توجه داشته باش این خوانش از قیمت‌های لحظه‌ای است و بدون سری کندل و عمق سفارش‌ها، اندیکاتور تکنیکال ساخته نمی‌شود.`
      : `Market regime (${marketFrame.instruments.length} assets): "${reg}"${leader ? `, relative leader ${leader}` : ''}; based strictly on spot snapshots (no OHLC/orderbook indicators inferred).`);
  }

  /* ── 8. Macro / Economist why synthesis + Knowledge passages ────────── */
  const macroWhy = buildMacroWhySynthesis({ message: repairedMsg, isFa });
  const asksTokenomics = /(?:fdv|market\s*cap|unlock|توکنومیکس|آزادسازی)/i.test(repairedMsg);

  /* Avoid duplicating an inflation KB item if macroWhy already speaks directly,
     and do not let weak secondary matches hijack macro explanations. */
  const selectedKb = [];
  for (const k of expandedKb) {
    if (k.id === 'kb.economics.inflation-scarce-assets' && macroWhy.length > 0) continue;
    if (k.id === 'kb.economics.rates-liquidity' && macroWhy.length > 0 && /نرخ\s*بهره|فدرال|interest\s*rate|fed/i.test(repairedMsg) && !/تورم|inflation/i.test(repairedMsg)) continue;
    if (k.id === 'kb.analytics.tokenomics-valuation' && !asksTokenomics && macroWhy.length > 0) continue;
    if (macroWhy.length > 0 && Number(k.score || 0) < 70) continue;
    selectedKb.push(k);
    if (selectedKb.length >= 2) break;
  }

  if (selectedKb.length) {
    if (selectedKb.length === 1) {
      sections.push(isFa ? selectedKb[0].body : (selectedKb[0].bodyEn || selectedKb[0].body));
    } else {
      for (const item of selectedKb) {
        const title = item.title ? `${item.title}: ` : '';
        const body = isFa ? item.body : (item.bodyEn || item.body);
        sections.push(`${title}${body}`);
      }
    }
  }

  if (isCompoundProductQuestion && effectiveProductRead?.answer && !sections.some((s) => s.includes(effectiveProductRead.answer))) {
    sections.push(effectiveProductRead.answer);
  }

  if (macroWhy.length) {
    sections.push(...macroWhy);
  }

  /* If a multi-part query asked for a live price AND no live price snapshot was available,
     disclose that missing live price explicitly alongside the verified static parts. */
  const asksLivePrice = /(?:الان|لحظه|فعلی|چنده|قیمت|price|live|current)/i.test(repairedMsg);
  if (asksLivePrice && !priceLines.length && sections.length > 0) {
    sections.push(isFa
      ? 'دادهٔ زندهٔ قیمت در این نوبت دریافت نشد، بنابراین قیمت لحظه‌ای را حدس نمی‌زنم و فقط از بخش‌های تأییدشده پاسخ دادم.'
      : 'Live spot price data was unavailable in this turn, so I am not guessing a live price and only answered the verified parts.');
  }

  /* ── 9. Partial / fragment / typo constructive interpretation ───────── */
  const partialSupport = buildPartialValueSupport({ partialRead, context, strategyFrame, isFa });
  if (partialSupport.length && !selectedKb.some((k) => k.id === 'kb.economics.btc-drivers')) {
    sections.push(...partialSupport);
  } else if (partialRead?.completeness !== 'complete' && partialRead?.completeness !== 'small-talk' && partialRead?.question?.text && !sections.some((s) => s.includes(partialRead.question.text))) {
    sections.push(partialRead.question.text);
  }

  /* ── 10. Web sources when live web search returned results ──────────── */
  if (Array.isArray(sources) && sources.length) {
    sections.push(isFa
      ? `${sources.length} منبع وب پیدا شد؛ مرجع اصلی: «${sources[0].title}».`
      : `${sources.length} web source(s) found; top result: "${sources[0].title}".`);
  }

  /* ── 11. Nothing grounded matched → yield back to honest empty-fleet notice */
  if (!sections.length) {
    return {
      ok: false,
      schema: INTERNAL_REASONER_SCHEMA,
      answer: '',
      knowledgeUsed: false,
      internalSynthesis: false
    };
  }

  /* ── 12. Ensure falsifiability whenever professor/economist asks for it ─ */
  let answer = sections.join('\n\n');
  if ((professorLenses.includes('FALSIFIER') || economistLenses.includes('FALSIFIER')) && answer.length > 40) {
    const fCheck = checkFalsifier({ message: repairedMsg, answer });
    if (fCheck.applicable && !fCheck.compliant) {
      const falsifierNote = isFa
        ? 'شرط ابطال و بازنگری این تحلیل: اگر جریان تقاضای اسپات معکوس شود، نرخ بهرهٔ واقعی افزایش یابد یا شواهد زنده خلاف این سازوکار را نشان دهد، این جمع‌بندی باطل می‌شود.'
        : 'Falsifier: this reading is invalidated if spot demand reverses, real yields tighten further, or live readings contradict this mechanism.';
      answer = `${answer}\n\n${falsifierNote}`;
    }
  }

  return {
    ok: true,
    schema: INTERNAL_REASONER_SCHEMA,
    answer,
    knowledgeUsed: expandedKb.length > 0,
    internalSynthesis: true
  };
}
