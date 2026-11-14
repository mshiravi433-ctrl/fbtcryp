/**
 * FBT AI RISK ENGINE — THE TEN RISK FAMILIES
 * ===========================================================================
 * «موتور ریسک نباید صرفاً درصد ریسک نشان بدهد؛ باید سیستم مدیریت، پیش‌بینی،
 *  شبیه‌سازی و کنترل ریسک باشد.»
 *
 * One number cannot do that. A portfolio at "62" tells a user nothing about
 * WHAT is at 62, what would make it 80, and which single action would bring it
 * back down. So the engine grades TEN families separately, every family keeps
 * the measurement that produced it, and the composite score is a weighted
 * mean with its own coverage — never a mood.
 *
 * ─── THE CONTRACT OF THIS FILE ──────────────────────────────────────────────
 *   · A family is not a label, it is a QUESTION with the data that answers it
 *     (`needs`). A family whose data never arrived is reported as `unknown`
 *     with coverage 0 — it is NOT quietly scored 0 ("all clear").
 *   · `weight` is the family's share of the composite score. Weights are fixed
 *     policy constants, not tuned to make today's number look better.
 *   · Every accent is a THEME TOKEN. The page is black/navy/violet by design,
 *     green means "measured safe" and red means "measured serious" — nothing
 *     else may borrow those two.
 *   · Higher = riskier, on every family and on the composite. The rest of the
 *     app reads "higher is better", which is exactly why this one says so out
 *     loud everywhere it is rendered (`direction`).
 */

export const RISK_TAXONOMY_VERSION = 'fbt.risk-taxonomy.1';

/**
 * Bands, in score order. `tone` maps to the palette:
 *   safe    → mint   (the ONLY green)
 *   calm    → cyan
 *   watch   → violet
 *   raised  → amber
 *   serious → red    (the ONLY red)
 * `unverified` exists because a low score built on 20% of the book is not
 * good news, and painting it green is how a risk screen lies.
 */
export const RISK_BANDS = Object.freeze([
  { id: 'safe', max: 24, tone: 'safe', fa: 'ایمن', en: 'Safe' },
  { id: 'calm', max: 39, tone: 'calm', fa: 'آرام', en: 'Calm' },
  { id: 'watch', max: 54, tone: 'watch', fa: 'تحت نظر', en: 'Watch' },
  { id: 'raised', max: 69, tone: 'raised', fa: 'بالا', en: 'Raised' },
  { id: 'serious', max: 100, tone: 'serious', fa: 'جدی', en: 'Serious' }
]);

/** The family table. Ten questions, ten weights, ten owners of a number. */
export const RISK_FAMILIES = Object.freeze([
  {
    id: 'volatility',
    weight: 1.25,
    fa: 'ریسک نوسان و سقوط قیمت',
    en: 'Volatility & crash exposure',
    shortFa: 'نوسان',
    shortEn: 'Volatility',
    hue: 'var(--rgb-5)',
    needs: ['market-swings', 'market-dispersion', 'portfolio-24h'],
    questionFa: 'اگر بازار امروز تند حرکت کند، چند درصد از سرمایه در معرض است؟',
    questionEn: 'If the tape moves hard today, how much of the book is exposed?'
  },
  {
    id: 'portfolio',
    weight: 1.15,
    fa: 'تمرکز سرمایه و همبستگی',
    en: 'Concentration & correlation',
    shortFa: 'تمرکز',
    shortEn: 'Concentration',
    hue: 'var(--rgb-2)',
    needs: ['holding-weights', 'asset-correlation'],
    questionFa: 'چند تصمیم واقعی در پرتفوی هست، یا همه یک شرط‌بندی است؟',
    questionEn: 'How many independent bets does this book actually hold?'
  },
  {
    id: 'liquidity',
    weight: 1.1,
    fa: 'نقدشوندگی و عمق بازار',
    en: 'Liquidity & market depth',
    shortFa: 'نقدشوندگی',
    shortEn: 'Liquidity',
    hue: 'var(--rgb-1)',
    needs: ['token-turnover', 'position-vs-volume'],
    questionFa: 'اگر بخواهید همین حالا بفروشید، بازار چقدر می‌تواند جذب کند؟',
    questionEn: 'If you sold right now, how much could the market absorb?'
  },
  {
    id: 'smartContract',
    weight: 1.05,
    fa: 'آسیب‌پذیری قرارداد هوشمند',
    en: 'Smart-contract risk',
    shortFa: 'قرارداد',
    shortEn: 'Contract',
    hue: 'var(--rgb-8)',
    needs: ['holdings-have-contracts', 'contract-scan'],
    questionFa: 'قراردادهایی که پول در آن‌هاست، فروش‌شدنی و سالم‌اند؟',
    questionEn: 'Can the contracts holding your money actually be exited?'
  },
  {
    id: 'defi',
    weight: 1.0,
    fa: 'ریسک دیفای و لیکوییدیشن',
    en: 'DeFi & liquidation',
    shortFa: 'دیفای',
    shortEn: 'DeFi',
    hue: 'var(--rgb-3)',
    needs: ['lending-position'],
    questionFa: 'فاصلهٔ وام‌ها تا لیکویید شدن چقدر است؟',
    questionEn: 'How far are the loans from liquidation?'
  },
  {
    id: 'network',
    weight: 0.9,
    fa: 'اختلال شبکه و تمرکز زنجیره',
    en: 'Network & chain concentration',
    shortFa: 'شبکه',
    shortEn: 'Network',
    hue: 'var(--rgb-4)',
    needs: ['chain-allocation', 'chain-reads'],
    questionFa: 'اگر یک شبکه بخوابد یا شلوغ شود، چه چیزی از دسترس خارج می‌شود؟',
    questionEn: 'If one network stalls, what becomes unreachable?'
  },
  {
    id: 'counterparty',
    weight: 0.95,
    fa: 'ریسک پلتفرم و طرف معامله',
    en: 'Counterparty & platform',
    shortFa: 'طرف معامله',
    shortEn: 'Counterparty',
    hue: 'var(--rgb-9)',
    needs: ['provider-evidence'],
    questionFa: 'پلتفرم‌هایی که مسیر معامله از آن‌ها می‌گذرد، همین حالا پاسخ می‌دهند؟',
    questionEn: 'Do the platforms carrying your route answer right now?'
  },
  {
    id: 'leverage',
    weight: 1.2,
    fa: 'وام‌گیری و احتمال لیکوییدیشن',
    en: 'Leverage & liquidation',
    shortFa: 'وام‌گیری',
    shortEn: 'Leverage',
    hue: 'var(--rgb-6)',
    needs: ['open-leveraged-positions'],
    questionFa: 'وام‌گیری باز چقدر است و تا قیمت لیکوییدیشن چند درصد فاصله دارد؟',
    questionEn: 'How much leverage is open, and how far is the liquidation price?'
  },
  {
    id: 'stablecoin',
    weight: 0.9,
    fa: 'دی‌پگ و پشتوانه استیبل‌کوین',
    en: 'Stablecoin depeg & backing',
    shortFa: 'استیبل‌کوین',
    shortEn: 'Stablecoin',
    hue: 'var(--rgb-7)',
    needs: ['stablecoin-quotes', 'stable-share'],
    questionFa: 'آن بخشی که «پول نقد» حساب می‌کنید، واقعاً یک دلار است؟',
    questionEn: 'Is the part you count as cash actually worth a dollar?'
  },
  {
    id: 'operational',
    weight: 0.75,
    fa: 'خطای اجرا و امنیت کیف پول',
    en: 'Operational & wallet security',
    shortFa: 'اجرا',
    shortEn: 'Operational',
    hue: 'var(--rgb-7)',
    needs: ['device-settings'],
    questionFa: 'تنظیمات همین دستگاه، سرمایه را از خطای اجرا محافظت می‌کند؟',
    questionEn: 'Do this device’s own settings protect the money from execution error?'
  }
]);

export const FAMILY_BY_ID = Object.freeze(
  Object.fromEntries(RISK_FAMILIES.map((f) => [f.id, f]))
);

export const FAMILY_IDS = Object.freeze(RISK_FAMILIES.map((f) => f.id));

export const familyLabel = (id, locale = 'fa', short = false) => {
  const f = FAMILY_BY_ID[id];
  if (!f) return id;
  if (locale === 'fa') return short ? f.shortFa : f.fa;
  return short ? f.shortEn : f.en;
};

/** Band for a score. `null` → unverified (no measurement, not "safe"). */
export function bandForScore(score, { coverage = 1 } = {}) {
  if (score == null || !Number.isFinite(Number(score))) {
    return { id: 'unverified', tone: 'watch', fa: 'اندازه‌گیری نشده', en: 'Not measured' };
  }
  const s = Number(score);
  const band = RISK_BANDS.find((b) => s <= b.max) || RISK_BANDS[RISK_BANDS.length - 1];
  /*
   * THE GREEN GATE. A low composite score is only GOOD NEWS when enough of the
   * book was measured to support it. Below half coverage a 12 is not "safe",
   * it is "we saw a third of your money" — and it is returned as such.
   */
  if ((band.id === 'safe' || band.id === 'calm') && coverage < 0.5) {
    return { ...band, id: 'unverified', tone: 'watch', fa: 'پوشش ناکافی', en: 'Low coverage', band };
  }
  return band;
}

/** Tone → accent token. Only `safe` is green and only `serious` is red. */
export const TONE_TOKEN = Object.freeze({
  safe: 'var(--up)',
  calm: 'var(--rgb-9)',
  watch: 'var(--rgb-2)',
  raised: 'var(--rgb-5)',
  serious: 'var(--down)',
  muted: 'var(--text-3)'
});

export const toneOf = (band) => (band && TONE_TOKEN[band.tone] ? band.tone : 'watch');
