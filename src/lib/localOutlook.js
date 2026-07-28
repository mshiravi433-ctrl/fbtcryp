/**
 * LOCAL OUTLOOK NARRATOR
 * ---------------------------------------------------------------------------
 * "AI analysis" was dead whenever no model was configured — which is the
 * default state of a fresh build — and the screen just said "temporarily
 * unavailable". That was misleading twice over: it implied a transient outage
 * when nothing was ever configured, and it hid the fact that the analysis
 * underneath is real and already computed.
 *
 * What is actually happening on that screen: `lib/ai.js` computes RSI, MACD,
 * Bollinger bands, moving averages, momentum and realised volatility from real
 * price history, weights them into a score, and derives a confidence figure
 * from how much the indicators agree. That is the substance. A language model
 * was only ever narrating it.
 *
 * So this module narrates it instead — deterministically, from the same
 * numbers, in the user's language. It produces exactly the shape `getOutlook`
 * returns, so the UI does not care which tier answered, and it labels itself
 * `source: 'local'` so the UI can say so honestly.
 *
 * WHY THIS IS ARGUABLY BETTER THAN THE MODEL HERE
 * A model asked to comment on indicators will occasionally invent a level, a
 * news event, or a confident price target. This cannot: every sentence is
 * assembled from a number that was actually computed. The range it quotes is
 * the volatility cone from `projectRange`, which is honest about being a cone
 * and not a forecast. Where the model wins is open-ended questions and news
 * grounding — so when a model IS configured, it still takes priority.
 */

import { projectRange } from './ai';

/* -------------------------------------------------------------------------- */
/* phrase tables                                                              */
/* -------------------------------------------------------------------------- */

const T = {
  en: {
    bias: { bullish: 'leaning up', bearish: 'leaning down', neutral: 'no clear direction' },
    headline: {
      bullish: '{sym}: indicators lean bullish, {conf}% agreement',
      bearish: '{sym}: indicators lean bearish, {conf}% agreement',
      neutral: '{sym}: indicators disagree, no clear signal'
    },
    summaryStrong:
      '{n} of {total} indicators point the same way, which is why confidence sits at {conf}%. {lead} Realised volatility is {vol}% annualised, so a {days}-day move of roughly {band}% either way is normal for this asset — that is the range, not a target.',
    summaryWeak:
      'The indicators contradict each other, which is why confidence is only {conf}%. {lead} At {vol}% annualised volatility a {days}-day swing of about {band}% either way is ordinary here. Mixed readings are a reason to wait, not a reason to pick a side.',
    lead: {
      rsiLow: 'RSI at {rsi} is in oversold territory, which often precedes a bounce but can stay low in a real downtrend.',
      rsiHigh: 'RSI at {rsi} is overbought, which often precedes a pullback but can persist through a strong rally.',
      rsiMid: 'RSI at {rsi} is mid-range and not saying much on its own.',
      trendUp: 'Price is above its 20-period average and MACD momentum is positive.',
      trendDown: 'Price is below its 20-period average and MACD momentum is negative.',
      flat: 'Price is hovering around its 20-period average.'
    },
    drivers: {
      rsiOversold: 'RSI {rsi} — oversold',
      rsiOverbought: 'RSI {rsi} — overbought',
      macdUp: 'MACD histogram positive — upward momentum building',
      macdDown: 'MACD histogram negative — downward momentum building',
      aboveMa: 'Trading {pct}% above the 20-period average',
      belowMa: 'Trading {pct}% below the 20-period average',
      goldenCross: '20-period average above the 50 — trend structure is up',
      deathCross: '20-period average below the 50 — trend structure is down',
      momentumUp: '7-day momentum {pct}%',
      momentumDown: '7-day momentum {pct}%',
      bbLow: 'Near the lower Bollinger band',
      bbHigh: 'Near the upper Bollinger band',
      nearSupport: 'Close to support at ${lvl}',
      nearResistance: 'Close to resistance at ${lvl}'
    },
    risks: {
      volatile: 'Volatility is {vol}% annualised — stops placed tight will be hit by noise alone.',
      conflict: 'The indicators disagree with each other, so any single reading here is weak evidence.',
      overbought: 'Already overbought: entering here means buying after the move, not before it.',
      oversold: 'Oversold can stay oversold. Nothing in these numbers marks a bottom.',
      thin: 'Under 30 days of price history — every indicator below is computed on a short sample.',
      news: 'No news feed is connected, so this reads price only. A listing, hack or regulatory headline is invisible to it.',
      resistance: 'Resistance at ${lvl} sits just above; that is where rallies have stalled recently.',
      support: 'Support at ${lvl} sits just below; a break through it usually accelerates.'
    },
    invalidation: {
      bullish: 'A close below ${lvl} would break the structure this read is based on.',
      bearish: 'A close above ${lvl} would break the structure this read is based on.',
      neutral: 'A decisive close outside ${low}–${high} would resolve the current indecision.'
    },
    briefHeadline: {
      bullish: 'Market broadly higher — {up} of {total} majors up',
      bearish: 'Market broadly lower — {down} of {total} majors down',
      neutral: 'Mixed session — no clear market direction'
    },
    briefSummary:
      'Total market cap is {mcapChange}% over 24h with BTC dominance at {btcDom}%. {breadth} {domNote}',
    breadthUp: '{up} of the top {total} are up on the day, so the move is broad rather than one or two names.',
    breadthDown: '{down} of the top {total} are down on the day, so this is broad selling rather than an isolated move.',
    breadthMixed: 'Gainers and losers are roughly balanced, which is what an indecisive tape looks like.',
    domUp: 'Rising BTC dominance in a falling market usually means money rotating out of altcoins first.',
    domDown: 'Falling BTC dominance usually means risk appetite is rotating into altcoins.',
    domFlat: 'Dominance is steady, so capital is not rotating strongly either way.'
  },

  fa: {
    bias: { bullish: 'متمایل به صعود', bearish: 'متمایل به نزول', neutral: 'بدون جهت مشخص' },
    headline: {
      bullish: '{sym}: اندیکاتورها متمایل به صعودند، {conf}٪ هم‌جهت',
      bearish: '{sym}: اندیکاتورها متمایل به نزولند، {conf}٪ هم‌جهت',
      neutral: '{sym}: اندیکاتورها با هم اختلاف دارند، سیگنال روشنی نیست'
    },
    summaryStrong:
      '{n} اندیکاتور از {total} تا یک جهت را نشان می‌دهند و به همین دلیل اطمینان روی {conf}٪ است. {lead} نوسان محقق‌شده {vol}٪ سالانه است، پس حرکت حدود {band}٪ به هر طرف در {days} روز برای این دارایی عادی است — این یک بازه است نه یک هدف قیمتی.',
    summaryWeak:
      'اندیکاتورها یکدیگر را نقض می‌کنند و به همین دلیل اطمینان فقط {conf}٪ است. {lead} با نوسان {vol}٪ سالانه، نوسان حدود {band}٪ به هر طرف در {days} روز اینجا معمولی است. خواندن‌های متناقض دلیلی برای صبر کردن است، نه برای انتخاب یک سمت.',
    lead: {
      rsiLow: 'RSI روی {rsi} در محدوده اشباع فروش است؛ معمولاً پیش از برگشت دیده می‌شود اما در یک روند نزولی واقعی می‌تواند مدت‌ها پایین بماند.',
      rsiHigh: 'RSI روی {rsi} در اشباع خرید است؛ معمولاً پیش از اصلاح دیده می‌شود اما در یک رالی قوی می‌تواند ادامه پیدا کند.',
      rsiMid: 'RSI روی {rsi} در میانه است و به‌تنهایی حرف خاصی نمی‌زند.',
      trendUp: 'قیمت بالای میانگین ۲۰ دوره‌ای است و مومنتوم MACD مثبت است.',
      trendDown: 'قیمت زیر میانگین ۲۰ دوره‌ای است و مومنتوم MACD منفی است.',
      flat: 'قیمت حول میانگین ۲۰ دوره‌ای در نوسان است.'
    },
    drivers: {
      rsiOversold: 'RSI {rsi} — اشباع فروش',
      rsiOverbought: 'RSI {rsi} — اشباع خرید',
      macdUp: 'هیستوگرام MACD مثبت — مومنتوم صعودی در حال شکل‌گیری',
      macdDown: 'هیستوگرام MACD منفی — مومنتوم نزولی در حال شکل‌گیری',
      aboveMa: 'معامله {pct}٪ بالاتر از میانگین ۲۰ دوره‌ای',
      belowMa: 'معامله {pct}٪ پایین‌تر از میانگین ۲۰ دوره‌ای',
      goldenCross: 'میانگین ۲۰ بالای ۵۰ — ساختار روند صعودی است',
      deathCross: 'میانگین ۲۰ زیر ۵۰ — ساختار روند نزولی است',
      momentumUp: 'مومنتوم ۷ روزه {pct}٪',
      momentumDown: 'مومنتوم ۷ روزه {pct}٪',
      bbLow: 'نزدیک باند پایینی بولینگر',
      bbHigh: 'نزدیک باند بالایی بولینگر',
      nearSupport: 'نزدیک حمایت در ${lvl}',
      nearResistance: 'نزدیک مقاومت در ${lvl}'
    },
    risks: {
      volatile: 'نوسان {vol}٪ سالانه است — حد ضررهای تنگ فقط با نویز بازار فعال می‌شوند.',
      conflict: 'اندیکاتورها با هم اختلاف دارند، پس هر خواندن منفرد اینجا شاهد ضعیفی است.',
      overbought: 'همین حالا در اشباع خرید است: ورود اینجا یعنی خرید بعد از حرکت، نه قبل از آن.',
      oversold: 'اشباع فروش می‌تواند ادامه پیدا کند. هیچ‌چیز در این اعداد کف را مشخص نمی‌کند.',
      thin: 'کمتر از ۳۰ روز تاریخچه قیمت — همه اندیکاتورهای زیر روی نمونه کوتاهی محاسبه شده‌اند.',
      news: 'هیچ منبع خبری متصل نیست، پس این تحلیل فقط قیمت را می‌خواند. لیست شدن، هک یا خبر قانون‌گذاری برایش نامرئی است.',
      resistance: 'مقاومت ${lvl} درست بالای قیمت است؛ اخیراً رالی‌ها همان‌جا متوقف شده‌اند.',
      support: 'حمایت ${lvl} درست زیر قیمت است؛ شکستنش معمولاً حرکت را تندتر می‌کند.'
    },
    invalidation: {
      bullish: 'بسته شدن زیر ${lvl} ساختاری که این تحلیل بر آن بنا شده را می‌شکند.',
      bearish: 'بسته شدن بالای ${lvl} ساختاری که این تحلیل بر آن بنا شده را می‌شکند.',
      neutral: 'یک بسته شدن قاطع بیرون از ${low}–${high} بلاتکلیفی فعلی را حل می‌کند.'
    },
    briefHeadline: {
      bullish: 'بازار عمدتاً صعودی — {up} از {total} ارز بزرگ مثبت',
      bearish: 'بازار عمدتاً نزولی — {down} از {total} ارز بزرگ منفی',
      neutral: 'بازار مختلط — جهت مشخصی ندارد'
    },
    briefSummary:
      'ارزش کل بازار در ۲۴ ساعت {mcapChange}٪ تغییر کرده و سلطه بیت‌کوین روی {btcDom}٪ است. {breadth} {domNote}',
    breadthUp: '{up} از {total} ارز برتر امروز مثبت‌اند، پس حرکت فراگیر است نه محدود به یکی دو اسم.',
    breadthDown: '{down} از {total} ارز برتر امروز منفی‌اند، پس این فروش فراگیر است نه یک حرکت جداافتاده.',
    breadthMixed: 'تعداد مثبت‌ها و منفی‌ها تقریباً برابر است؛ تصویر یک بازار بلاتکلیف دقیقاً همین است.',
    domUp: 'افزایش سلطه بیت‌کوین در بازار نزولی معمولاً یعنی پول اول از آلت‌کوین‌ها خارج می‌شود.',
    domDown: 'کاهش سلطه بیت‌کوین معمولاً یعنی ریسک‌پذیری به سمت آلت‌کوین‌ها می‌چرخد.',
    domFlat: 'سلطه ثابت است، پس سرمایه به هیچ سمتی چرخش قوی ندارد.'
  },

  ar: {
    bias: { bullish: 'يميل للصعود', bearish: 'يميل للهبوط', neutral: 'بلا اتجاه واضح' },
    headline: {
      bullish: '{sym}: المؤشرات تميل للصعود، توافق {conf}٪',
      bearish: '{sym}: المؤشرات تميل للهبوط، توافق {conf}٪',
      neutral: '{sym}: المؤشرات متضاربة، لا إشارة واضحة'
    },
    summaryStrong:
      '{n} من {total} مؤشرات تشير للاتجاه نفسه، ولذلك الثقة عند {conf}٪. {lead} التذبذب المحقق {vol}٪ سنوياً، فحركة نحو {band}٪ في أي اتجاه خلال {days} أيام أمر طبيعي — هذا نطاق وليس هدفاً.',
    summaryWeak:
      'المؤشرات تتناقض، ولذلك الثقة {conf}٪ فقط. {lead} عند تذبذب {vol}٪ سنوياً تُعد حركة {band}٪ خلال {days} أيام عادية. التضارب سبب للانتظار لا لاختيار جانب.',
    lead: {
      rsiLow: 'مؤشر RSI عند {rsi} في منطقة التشبع البيعي، وقد يستمر منخفضاً في اتجاه هابط حقيقي.',
      rsiHigh: 'مؤشر RSI عند {rsi} في التشبع الشرائي، وقد يستمر خلال موجة صعود قوية.',
      rsiMid: 'مؤشر RSI عند {rsi} في المنتصف ولا يقول الكثير وحده.',
      trendUp: 'السعر فوق متوسط ٢٠ فترة وزخم MACD موجب.',
      trendDown: 'السعر تحت متوسط ٢٠ فترة وزخم MACD سالب.',
      flat: 'السعر يتذبذب حول متوسط ٢٠ فترة.'
    },
    drivers: {
      rsiOversold: 'RSI {rsi} — تشبع بيعي',
      rsiOverbought: 'RSI {rsi} — تشبع شرائي',
      macdUp: 'هيستوغرام MACD موجب — زخم صاعد',
      macdDown: 'هيستوغرام MACD سالب — زخم هابط',
      aboveMa: 'يتداول {pct}٪ فوق متوسط ٢٠ فترة',
      belowMa: 'يتداول {pct}٪ تحت متوسط ٢٠ فترة',
      goldenCross: 'متوسط ٢٠ فوق ٥٠ — بنية الاتجاه صاعدة',
      deathCross: 'متوسط ٢٠ تحت ٥٠ — بنية الاتجاه هابطة',
      momentumUp: 'زخم ٧ أيام {pct}٪',
      momentumDown: 'زخم ٧ أيام {pct}٪',
      bbLow: 'قرب نطاق بولينجر السفلي',
      bbHigh: 'قرب نطاق بولينجر العلوي',
      nearSupport: 'قرب الدعم عند ${lvl}',
      nearResistance: 'قرب المقاومة عند ${lvl}'
    },
    risks: {
      volatile: 'التذبذب {vol}٪ سنوياً — وقف الخسارة الضيق سيُضرب بالضجيج وحده.',
      conflict: 'المؤشرات متضاربة، فأي قراءة منفردة هنا دليل ضعيف.',
      overbought: 'في التشبع الشرائي أصلاً: الدخول هنا شراء بعد الحركة لا قبلها.',
      oversold: 'التشبع البيعي قد يستمر. لا شيء هنا يحدد القاع.',
      thin: 'أقل من ٣٠ يوماً من التاريخ السعري — كل المؤشرات محسوبة على عينة قصيرة.',
      news: 'لا يوجد مصدر أخبار متصل، فالتحليل يقرأ السعر فقط.',
      resistance: 'المقاومة عند ${lvl} فوق السعر مباشرة.',
      support: 'الدعم عند ${lvl} تحت السعر مباشرة؛ كسره يسرّع الحركة عادة.'
    },
    invalidation: {
      bullish: 'إغلاق تحت ${lvl} يكسر البنية التي تقوم عليها هذه القراءة.',
      bearish: 'إغلاق فوق ${lvl} يكسر البنية التي تقوم عليها هذه القراءة.',
      neutral: 'إغلاق حاسم خارج ${low}–${high} يحسم التردد الحالي.'
    },
    briefHeadline: {
      bullish: 'السوق مرتفع عموماً — {up} من {total}',
      bearish: 'السوق منخفض عموماً — {down} من {total}',
      neutral: 'جلسة مختلطة — لا اتجاه واضح'
    },
    briefSummary:
      'القيمة السوقية الإجمالية {mcapChange}٪ خلال ٢٤ ساعة وهيمنة البيتكوين {btcDom}٪. {breadth} {domNote}',
    breadthUp: '{up} من أصل {total} مرتفعة اليوم، فالحركة واسعة.',
    breadthDown: '{down} من أصل {total} منخفضة اليوم، فالبيع واسع.',
    breadthMixed: 'الرابحون والخاسرون متوازنون تقريباً.',
    domUp: 'ارتفاع هيمنة البيتكوين في سوق هابط يعني عادة خروج المال من العملات البديلة أولاً.',
    domDown: 'انخفاض الهيمنة يعني عادة تحول الإقبال نحو العملات البديلة.',
    domFlat: 'الهيمنة مستقرة، فلا دوران قوي لرأس المال.'
  }
};

/** Fall back to English for the nine partially-translated languages. */
const pack = (lang) => T[lang] ?? T.en;

/**
 * Persian and Arabic use their own digit shapes. Mixing Latin digits into
 * otherwise-Persian prose reads as broken — the rest of the app already
 * localises numerals, so the narrator has to as well.
 */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function localiseDigits(text, lang) {
  const set = lang === 'fa' ? FA_DIGITS : lang === 'ar' ? AR_DIGITS : null;
  if (!set) return text;
  // Currency figures stay Latin: an address or a dollar amount is copied and
  // compared far more often than it is read aloud, and Persian-Indic digits
  // inside a "$165.06" break that.
  return String(text).replace(/(\$[\d.,]+)|(\d)/g, (m, money, digit) =>
    money ?? set[Number(digit)]
  );
}

/** `{a}` placeholder interpolation. Missing keys become an empty string. */
function fill(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const money = (v) =>
  !Number.isFinite(v)
    ? '—'
    : v >= 1000
      ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : v >= 1
        ? v.toFixed(2)
        : v.toFixed(6);

/* -------------------------------------------------------------------------- */
/* per-asset outlook                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Narrate an `analyze()` result.
 *
 * @param {object} args
 * @param {object} args.analysis result of `analyze()` — required
 * @param {object} args.coin     market row (symbol, name, change24h/7d)
 * @param {string} args.lang     UI language
 * @param {number} args.days     horizon for the volatility cone
 */
export function localOutlook({ analysis, coin = {}, lang = 'en', days = 7 }) {
  if (!analysis) return null;

  const p = pack(lang);
  const ind = analysis.indicators ?? {};
  const { score, confidence, price } = analysis;

  const bias = score > 12 ? 'bullish' : score < -12 ? 'bearish' : 'neutral';

  // How many indicators agree with the overall direction. This is the honest
  // basis for the confidence number, so it belongs in the prose too.
  const sigs = analysis.signals ?? [];
  const agreeing = sigs.filter((s) =>
    bias === 'neutral' ? Math.abs(s.score) < 20 : bias === 'bullish' ? s.score > 0 : s.score < 0
  ).length;

  const rsiVal = ind.rsi;
  const ma20 = ind.ma20;
  const macdHist = ind.macd?.histogram;
  const vol = ind.volatility;
  const pctB = ind.bollinger?.percentB;

  /* ------------------------------ lead line ----------------------------- */
  let lead;
  if (rsiVal != null && rsiVal < 32) lead = fill(p.lead.rsiLow, { rsi: num(rsiVal, 0) });
  else if (rsiVal != null && rsiVal > 68) lead = fill(p.lead.rsiHigh, { rsi: num(rsiVal, 0) });
  else if (ma20 != null && price > ma20 * 1.005 && (macdHist ?? 0) > 0) lead = p.lead.trendUp;
  else if (ma20 != null && price < ma20 * 0.995 && (macdHist ?? 0) < 0) lead = p.lead.trendDown;
  else if (rsiVal != null) lead = fill(p.lead.rsiMid, { rsi: num(rsiVal, 0) });
  else lead = p.lead.flat;

  /* ------------------------------- range -------------------------------- */
  const cone = projectRange(analysis, days);
  const bandPct = cone && price ? ((cone.high - cone.low) / 2 / price) * 100 : null;

  const summaryTemplate = confidence >= 45 ? p.summaryStrong : p.summaryWeak;
  const summary = fill(summaryTemplate, {
    n: agreeing,
    total: sigs.length,
    conf: Math.round(confidence),
    lead,
    vol: num(vol, 0),
    days,
    band: num(bandPct, 1)
  });

  /* ------------------------------ drivers ------------------------------- */
  // Ordered by |contribution| so the strongest evidence is listed first,
  // rather than whichever indicator happens to come first in the array.
  const drivers = [];
  const byStrength = [...sigs].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  for (const s of byStrength) {
    if (drivers.length >= 3) break;
    if (Math.abs(s.score) < 15) continue;

    if (s.key === 'rsi' && rsiVal != null) {
      if (rsiVal < 40) drivers.push(fill(p.drivers.rsiOversold, { rsi: num(rsiVal, 0) }));
      else if (rsiVal > 60) drivers.push(fill(p.drivers.rsiOverbought, { rsi: num(rsiVal, 0) }));
    } else if (s.key === 'macd') {
      drivers.push(s.score > 0 ? p.drivers.macdUp : p.drivers.macdDown);
    } else if (s.key === 'ma20') {
      drivers.push(
        fill(s.score > 0 ? p.drivers.aboveMa : p.drivers.belowMa, { pct: num(Math.abs(s.value), 1) })
      );
    } else if (s.key === 'cross') {
      drivers.push(s.score > 0 ? p.drivers.goldenCross : p.drivers.deathCross);
    } else if (s.key === 'momentum') {
      drivers.push(
        fill(s.score > 0 ? p.drivers.momentumUp : p.drivers.momentumDown, {
          pct: (s.value >= 0 ? '+' : '') + num(s.value, 1)
        })
      );
    } else if (s.key === 'bollinger' && pctB != null) {
      drivers.push(pctB < 0.35 ? p.drivers.bbLow : pctB > 0.65 ? p.drivers.bbHigh : null);
    }
  }

  // Proximity to a level is real, actionable context the score does not carry.
  if (drivers.length < 3 && ind.support != null && price && price / ind.support - 1 < 0.03) {
    drivers.push(fill(p.drivers.nearSupport, { lvl: money(ind.support) }));
  }
  if (drivers.length < 3 && ind.resistance != null && price && ind.resistance / price - 1 < 0.03) {
    drivers.push(fill(p.drivers.nearResistance, { lvl: money(ind.resistance) }));
  }

  /* -------------------------------- risks ------------------------------- */
  // Always at least one, and always the honest one: this reads price only.
  const risks = [];
  if (vol != null && vol > 60) risks.push(fill(p.risks.volatile, { vol: num(vol, 0) }));
  if (confidence < 45) risks.push(p.risks.conflict);
  if (bias === 'bullish' && rsiVal != null && rsiVal > 68) risks.push(p.risks.overbought);
  if (bias === 'bearish' && rsiVal != null && rsiVal < 32) risks.push(p.risks.oversold);
  if (risks.length < 3 && ind.resistance != null && price && ind.resistance / price - 1 < 0.05) {
    risks.push(fill(p.risks.resistance, { lvl: money(ind.resistance) }));
  }
  if (risks.length < 3) risks.push(p.risks.news);

  /* ---------------------------- invalidation ---------------------------- */
  let invalidation;
  if (bias === 'bullish') {
    invalidation = fill(p.invalidation.bullish, {
      lvl: money(ind.support ?? (ma20 != null ? ma20 : price * 0.95))
    });
  } else if (bias === 'bearish') {
    invalidation = fill(p.invalidation.bearish, {
      lvl: money(ind.resistance ?? (ma20 != null ? ma20 : price * 1.05))
    });
  } else {
    invalidation = fill(p.invalidation.neutral, {
      low: money(ind.support ?? price * 0.95),
      high: money(ind.resistance ?? price * 1.05)
    });
  }

  const loc = (text) => localiseDigits(text, lang);

  return {
    bias,
    // Never dress a deterministic read up as high conviction; the cap is the
    // same one the model path uses.
    confidence: Math.min(88, Math.round(confidence)),
    headline: loc(
      fill(p.headline[bias], { sym: coin.symbol ?? '', conf: Math.round(confidence) })
    ),
    summary: loc(summary),
    range: cone ? { low: cone.low, high: cone.high, horizonDays: days } : null,
    drivers: drivers.filter(Boolean).slice(0, 3).map(loc),
    risks: risks.slice(0, 3).map(loc),
    invalidation: loc(invalidation),
    sources: [],
    source: 'local',
    generatedAt: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/* market-wide brief                                                          */
/* -------------------------------------------------------------------------- */

/** Narrate the whole market from global stats plus the top movers. */
export function localBrief({ global, top = [], lang = 'en' }) {
  if (!global && !top.length) return null;
  const p = pack(lang);

  const rows = top.filter((c) => Number.isFinite(c?.change24h));
  const up = rows.filter((c) => c.change24h > 0).length;
  const down = rows.length - up;
  const total = rows.length || 1;

  const mcapChange = Number(global?.mcapChange) || 0;
  const btcDom = Number(global?.btcDominance) || 0;

  // Breadth, not just the index: a cap-weighted number can be green while most
  // assets are red, and saying so is the whole value of a breadth read.
  const ratio = up / total;
  const bias = ratio > 0.62 && mcapChange > 0 ? 'bullish' : ratio < 0.38 && mcapChange < 0 ? 'bearish' : 'neutral';

  const breadth =
    ratio > 0.62
      ? fill(p.breadthUp, { up, total })
      : ratio < 0.38
        ? fill(p.breadthDown, { down, total })
        : p.breadthMixed;

  const domNote = mcapChange < -0.5 && btcDom > 50 ? p.domUp : mcapChange > 0.5 ? p.domDown : p.domFlat;

  const drivers = [];
  const sorted = [...rows].sort((a, b) => b.change24h - a.change24h);
  if (sorted[0]) drivers.push(`${sorted[0].symbol} ${sorted[0].change24h >= 0 ? '+' : ''}${num(sorted[0].change24h, 1)}%`);
  if (sorted[1]) drivers.push(`${sorted[1].symbol} ${sorted[1].change24h >= 0 ? '+' : ''}${num(sorted[1].change24h, 1)}%`);
  const worst = sorted[sorted.length - 1];
  if (worst && worst !== sorted[0]) drivers.push(`${worst.symbol} ${num(worst.change24h, 1)}%`);

  const loc = (text) => localiseDigits(text, lang);

  return {
    bias,
    confidence: Math.round(Math.min(80, 40 + Math.abs(ratio - 0.5) * 90)),
    headline: loc(fill(p.briefHeadline[bias], { up, down, total })),
    summary: loc(
      fill(p.briefSummary, {
        mcapChange: (mcapChange >= 0 ? '+' : '') + num(mcapChange, 2),
        btcDom: num(btcDom, 1),
        breadth,
        domNote
      })
    ),
    // Tickers stay Latin — "BTC" is a symbol, not prose.
    drivers,
    risks: [loc(p.risks.news)],
    sources: [],
    source: 'local',
    generatedAt: Date.now()
  };
}
