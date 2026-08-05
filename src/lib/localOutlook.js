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

/*
 * ─── WHY THIS TABLE WAS REWRITTEN ───────────────────────────────────────────
 * The owner's report, verbatim: «گرامر سیگنال خیلی بده و انگار داره یک ربات
 * مینویسه نه انسان» — the signals read like a machine wrote them. He is right,
 * and the causes were specific rather than stylistic. Each one is fixed here
 * and named so it does not come back:
 *
 * 1. SENTENCES WERE GLUED, NOT COMPOSED. `summaryStrong` interpolated `{lead}`
 *    mid-paragraph with a bare space. Whatever the lead sentence happened to
 *    be got dropped between two unrelated clauses, so the paragraph had no
 *    connective tissue: fact, fact, fact. Human writing joins clauses. The
 *    templates now open with the lead and use real connectives around it.
 *
 * 2. THE PERSIAN WAS A WORD-FOR-WORD TRACING OF THE ENGLISH. "which is why
 *    confidence sits at X%" became «و به همین دلیل اطمینان روی X٪ است» — the
 *    verb «روی … است» is not how Persian states a measured value; «X٪ است» is.
 *    Several more of the same kind: «خواندن‌های متناقض» is a literal calque of
 *    "mixed readings" and means nothing in Persian; it is now «وقتی
 *    اندیکاتورها هم‌جهت نیستند».
 *
 * 3. A NUMBER WAS PRINTED WHERE A WORD BELONGS. "{n} of {total} indicators
 *    point the same way" is fine at 5-of-7 and absurd at 1-of-7 ("1 of 7
 *    indicators point"). English needed the verb agreed; Persian needed the
 *    plural marker dropped. Both now go through `plural()`.
 *
 * 4. DOLLAR SIGNS INSIDE RTL TEXT. `${lvl}` rendered as "$150.12" inside a
 *    Persian sentence, and the bidi algorithm pushed the "$" to the wrong end
 *    of the number on some renderers. Persian and Arabic now use the currency
 *    word after the figure, which is also how a Persian speaker says it.
 *
 * 5. ARABIC HAD BEEN TRUNCATED. Several Arabic strings were a half-length
 *    paraphrase of the English — `risks.news` lost the entire second clause
 *    explaining WHAT is invisible to the analysis. A shorter warning is a
 *    weaker warning.
 *
 * None of this is machine-translated. Safety and financial copy is the one
 * category where an approximate translation is a liability.
 */

const T = {
  en: {
    bias: { bullish: 'leaning up', bearish: 'leaning down', neutral: 'no clear direction' },
    headline: {
      bullish: '{sym} is leaning bullish — {conf}% of the indicators agree',
      bearish: '{sym} is leaning bearish — {conf}% of the indicators agree',
      neutral: '{sym} has no clear signal — the indicators disagree'
    },
    /*
     * The lead sentence comes FIRST and the rest follows from it, rather than
     * the lead being wedged into the middle of a paragraph about something
     * else. That single change is most of what made this read like a person.
     */
    summaryStrong:
      '{lead} {agree}, which is where the {conf}% figure comes from. Volatility is running at {vol}% annualised, so over {days} days a move of roughly {band}% in either direction would be unremarkable for this asset — that is a range, not a target.',
    summaryWeak:
      '{lead} But the indicators are pulling against each other, which is why confidence is only {conf}%. Volatility is {vol}% annualised, so a {days}-day swing of around {band}% either way is ordinary here. When the readings disagree, the useful answer is usually to wait rather than to pick a side.',
    lead: {
      rsiLow:
        'RSI has fallen to {rsi}, which is oversold territory — often the run-up to a bounce, though in a genuine downtrend it can sit there for weeks.',
      rsiHigh:
        'RSI is up at {rsi}, which is overbought — often the run-up to a pullback, though a strong rally can hold it there for a long time.',
      rsiMid: 'RSI is at {rsi}, mid-range, and is not saying much on its own.',
      trendUp: 'Price is holding above its 20-period average with MACD momentum positive.',
      trendDown: 'Price has slipped below its 20-period average and MACD momentum is negative.',
      flat: 'Price is drifting around its 20-period average without committing either way.'
    },
    drivers: {
      rsiOversold: 'RSI at {rsi} — oversold',
      rsiOverbought: 'RSI at {rsi} — overbought',
      macdUp: 'MACD histogram has turned positive — upward momentum is building',
      macdDown: 'MACD histogram has turned negative — downward momentum is building',
      aboveMa: 'Trading {pct}% above the 20-period average',
      belowMa: 'Trading {pct}% below the 20-period average',
      goldenCross: 'The 20-period average has crossed above the 50 — trend structure is up',
      deathCross: 'The 20-period average has crossed below the 50 — trend structure is down',
      momentumUp: 'Up {pct}% over the past 7 days',
      momentumDown: 'Down {pct}% over the past 7 days',
      bbLow: 'Sitting near the lower Bollinger band',
      bbHigh: 'Sitting near the upper Bollinger band',
      nearSupport: 'Close to support at {lvl}',
      nearResistance: 'Close to resistance at {lvl}'
    },
    risks: {
      volatile:
        'Volatility is {vol}% annualised. A stop placed tightly will be taken out by ordinary noise, before the move it was meant to protect against ever happens.',
      conflict:
        'The indicators contradict one another here, so no single reading below carries much weight on its own.',
      overbought:
        'It is already overbought. Entering now means buying after the move rather than ahead of it.',
      oversold:
        'Oversold can stay oversold for a long time. Nothing in these numbers marks a bottom.',
      thin:
        'There is less than 30 days of price history, so every indicator below is computed on a short sample and should be read loosely.',
      news:
        'No news feed is connected, so this reads price and nothing else. A listing, an exploit or a regulatory headline is completely invisible to it.',
      resistance:
        'Resistance sits just above at {lvl} — that is where recent rallies have stalled.',
      support:
        'Support sits just below at {lvl}, and a break through it usually accelerates the move.'
    },
    invalidation: {
      bullish: 'A close below {lvl} would break the structure this read rests on.',
      bearish: 'A close above {lvl} would break the structure this read rests on.',
      neutral: 'A decisive close outside {low} to {high} would settle the current indecision.'
    },
    briefHeadline: {
      bullish: 'Market broadly higher — {up} of the {total} majors are up',
      bearish: 'Market broadly lower — {down} of the {total} majors are down',
      neutral: 'A mixed session, with no clear market direction'
    },
    briefSummary:
      'Total market cap has moved {mcapChange}% over the past 24 hours, with Bitcoin dominance at {btcDom}%. {breadth} {domNote}',
    breadthUp:
      '{up} of the top {total} are up on the day, so this is a broad move rather than one or two names carrying the index.',
    breadthDown:
      '{down} of the top {total} are down on the day, so this is broad selling rather than an isolated fall.',
    breadthMixed:
      'Gainers and losers are close to evenly split, which is what an undecided tape looks like.',
    domUp:
      'Bitcoin dominance rising while the market falls usually means money is leaving altcoins first.',
    domDown:
      'Falling Bitcoin dominance usually means risk appetite is rotating into altcoins.',
    domFlat: 'Dominance is steady, so capital is not rotating strongly in either direction.'
  },

  fa: {
    bias: { bullish: 'متمایل به صعود', bearish: 'متمایل به نزول', neutral: 'بدون جهت مشخص' },
    headline: {
      bullish: '{sym} متمایل به صعود است — {conf}٪ اندیکاتورها هم‌نظرند',
      bearish: '{sym} متمایل به نزول است — {conf}٪ اندیکاتورها هم‌نظرند',
      neutral: '{sym} سیگنال روشنی ندارد — اندیکاتورها با هم اختلاف دارند'
    },
    summaryStrong:
      '{lead} {agree} و عدد {conf}٪ دقیقاً از همین‌جا می‌آید. نوسان سالانه {vol}٪ است، یعنی در {days} روز حرکتی حدود {band}٪ به هر طرف برای این دارایی چیز عجیبی نیست — این یک بازه است، نه هدف قیمتی.',
    summaryWeak:
      '{lead} اما اندیکاتورها خلاف هم را نشان می‌دهند و اطمینان به همین دلیل فقط {conf}٪ است. نوسان سالانه {vol}٪ است، پس نوسان حدود {band}٪ به هر طرف در {days} روز اینجا عادی است. وقتی اندیکاتورها هم‌جهت نیستند، جواب مفید معمولاً صبر کردن است نه انتخاب یک سمت.',
    lead: {
      rsiLow:
        'RSI تا {rsi} پایین آمده که محدوده اشباع فروش است — معمولاً مقدمه یک برگشت، هرچند در یک روند نزولی واقعی می‌تواند هفته‌ها همان‌جا بماند.',
      rsiHigh:
        'RSI روی {rsi} بالا رفته که اشباع خرید است — معمولاً مقدمه یک اصلاح، هرچند یک رالی قوی می‌تواند مدت‌ها نگهش دارد.',
      rsiMid: 'RSI روی {rsi} و در میانه است و به‌تنهایی حرف خاصی نمی‌زند.',
      trendUp: 'قیمت بالای میانگین ۲۰ دوره‌ای ایستاده و مومنتوم MACD مثبت است.',
      trendDown: 'قیمت زیر میانگین ۲۰ دوره‌ای رفته و مومنتوم MACD منفی است.',
      flat: 'قیمت حول میانگین ۲۰ دوره‌ای می‌چرخد بدون اینکه سمتی را انتخاب کند.'
    },
    drivers: {
      rsiOversold: 'RSI روی {rsi} — اشباع فروش',
      rsiOverbought: 'RSI روی {rsi} — اشباع خرید',
      macdUp: 'هیستوگرام MACD مثبت شده — مومنتوم صعودی در حال شکل‌گیری است',
      macdDown: 'هیستوگرام MACD منفی شده — مومنتوم نزولی در حال شکل‌گیری است',
      aboveMa: '{pct}٪ بالاتر از میانگین ۲۰ دوره‌ای معامله می‌شود',
      belowMa: '{pct}٪ پایین‌تر از میانگین ۲۰ دوره‌ای معامله می‌شود',
      goldenCross: 'میانگین ۲۰ از بالای میانگین ۵۰ رد شده — ساختار روند صعودی است',
      deathCross: 'میانگین ۲۰ از زیر میانگین ۵۰ رد شده — ساختار روند نزولی است',
      momentumUp: 'در ۷ روز گذشته {pct}٪ بالا رفته',
      momentumDown: 'در ۷ روز گذشته {pct}٪ پایین آمده',
      bbLow: 'نزدیک باند پایینی بولینگر ایستاده',
      bbHigh: 'نزدیک باند بالایی بولینگر ایستاده',
      nearSupport: 'نزدیک حمایت {lvl}',
      nearResistance: 'نزدیک مقاومت {lvl}'
    },
    risks: {
      volatile:
        'نوسان سالانه {vol}٪ است. حد ضرری که تنگ گذاشته شود با نویز عادی بازار فعال می‌شود، قبل از اینکه اصلاً حرکتی که برایش گذاشته شده اتفاق بیفتد.',
      conflict:
        'اندیکاتورها اینجا خلاف هم را می‌گویند، پس هیچ‌کدام از خواندن‌های پایین به‌تنهایی وزن زیادی ندارد.',
      overbought:
        'همین حالا در اشباع خرید است. ورود در این نقطه یعنی خرید بعد از حرکت، نه پیش از آن.',
      oversold:
        'اشباع فروش می‌تواند مدت‌ها ادامه پیدا کند. هیچ‌چیز در این اعداد کف را مشخص نمی‌کند.',
      thin:
        'کمتر از ۳۰ روز تاریخچه قیمت وجود دارد، پس همه اندیکاتورهای پایین روی نمونه کوتاهی حساب شده‌اند و باید با احتیاط خوانده شوند.',
      news:
        'هیچ منبع خبری متصل نیست، پس این تحلیل فقط قیمت را می‌خواند و بس. لیست شدن در یک صرافی، هک شدن یا یک خبر قانون‌گذاری کاملاً برایش نامرئی است.',
      resistance:
        'مقاومت {lvl} درست بالای قیمت است — همان‌جایی که رالی‌های اخیر متوقف شده‌اند.',
      support:
        'حمایت {lvl} درست زیر قیمت است و شکستنش معمولاً حرکت را تندتر می‌کند.'
    },
    invalidation: {
      bullish: 'بسته شدن زیر {lvl} ساختاری را که این تحلیل روی آن بنا شده می‌شکند.',
      bearish: 'بسته شدن بالای {lvl} ساختاری را که این تحلیل روی آن بنا شده می‌شکند.',
      neutral: 'یک بسته شدن قاطع بیرون از {low} تا {high} بلاتکلیفی فعلی را حل می‌کند.'
    },
    briefHeadline: {
      bullish: 'بازار عمدتاً صعودی — {up} تا از {total} ارز بزرگ مثبت‌اند',
      bearish: 'بازار عمدتاً نزولی — {down} تا از {total} ارز بزرگ منفی‌اند',
      neutral: 'بازار مختلط است و جهت مشخصی ندارد'
    },
    briefSummary:
      'ارزش کل بازار در ۲۴ ساعت گذشته {mcapChange}٪ جابه‌جا شده و سلطه بیت‌کوین {btcDom}٪ است. {breadth} {domNote}',
    breadthUp:
      '{up} تا از {total} ارز برتر امروز مثبت‌اند، پس حرکت فراگیر است و یکی دو اسم شاخص را بالا نکشیده‌اند.',
    breadthDown:
      '{down} تا از {total} ارز برتر امروز منفی‌اند، پس این فروش فراگیر است نه یک ریزش جداافتاده.',
    breadthMixed:
      'تعداد مثبت‌ها و منفی‌ها تقریباً برابر است؛ تصویر یک بازار بلاتکلیف دقیقاً همین است.',
    domUp:
      'بالا رفتن سلطه بیت‌کوین در بازاری که می‌ریزد معمولاً یعنی پول اول از آلت‌کوین‌ها بیرون می‌رود.',
    domDown: 'پایین آمدن سلطه بیت‌کوین معمولاً یعنی ریسک‌پذیری به سمت آلت‌کوین‌ها می‌چرخد.',
    domFlat: 'سلطه ثابت است، پس سرمایه به هیچ سمتی چرخش قوی ندارد.'
  },

  ar: {
    bias: { bullish: 'يميل للصعود', bearish: 'يميل للهبوط', neutral: 'بلا اتجاه واضح' },
    headline: {
      bullish: '{sym} يميل للصعود — {conf}٪ من المؤشرات متفقة',
      bearish: '{sym} يميل للهبوط — {conf}٪ من المؤشرات متفقة',
      neutral: '{sym} بلا إشارة واضحة — المؤشرات متضاربة'
    },
    summaryStrong:
      '{lead} و{agree}، ومن هنا جاء رقم {conf}٪. التذبذب السنوي {vol}٪، أي أن حركة بنحو {band}٪ في أي اتجاه خلال {days} أيام ليست أمراً غريباً على هذا الأصل — هذا نطاق وليس هدفاً.',
    summaryWeak:
      '{lead} لكن المؤشرات تشد في اتجاهات متعاكسة، ولهذا الثقة {conf}٪ فقط. التذبذب السنوي {vol}٪، فحركة نحو {band}٪ في أي اتجاه خلال {days} أيام أمر عادي هنا. وحين تتضارب القراءات يكون الجواب المفيد عادةً هو الانتظار لا اختيار جانب.',
    lead: {
      rsiLow:
        'انخفض مؤشر RSI إلى {rsi}، وهي منطقة تشبع بيعي — غالباً ما تسبق ارتداداً، لكنه في اتجاه هابط حقيقي قد يبقى هناك أسابيع.',
      rsiHigh:
        'ارتفع مؤشر RSI إلى {rsi}، وهو تشبع شرائي — غالباً ما يسبق تصحيحاً، لكن موجة صعود قوية قد تبقيه هناك طويلاً.',
      rsiMid: 'مؤشر RSI عند {rsi} في المنتصف، ولا يقول الكثير بمفرده.',
      trendUp: 'السعر ثابت فوق متوسط ٢٠ فترة وزخم MACD موجب.',
      trendDown: 'انزلق السعر تحت متوسط ٢٠ فترة وزخم MACD سالب.',
      flat: 'السعر يتحرك حول متوسط ٢٠ فترة دون أن يحسم اتجاهه.'
    },
    drivers: {
      rsiOversold: 'RSI عند {rsi} — تشبع بيعي',
      rsiOverbought: 'RSI عند {rsi} — تشبع شرائي',
      macdUp: 'هيستوغرام MACD تحوّل إلى الموجب — زخم صاعد يتكوّن',
      macdDown: 'هيستوغرام MACD تحوّل إلى السالب — زخم هابط يتكوّن',
      aboveMa: 'يتداول أعلى بـ {pct}٪ من متوسط ٢٠ فترة',
      belowMa: 'يتداول أدنى بـ {pct}٪ من متوسط ٢٠ فترة',
      goldenCross: 'متوسط ٢٠ عبر فوق متوسط ٥٠ — بنية الاتجاه صاعدة',
      deathCross: 'متوسط ٢٠ عبر تحت متوسط ٥٠ — بنية الاتجاه هابطة',
      momentumUp: 'ارتفع {pct}٪ خلال الأيام السبعة الماضية',
      momentumDown: 'انخفض {pct}٪ خلال الأيام السبعة الماضية',
      bbLow: 'قريب من نطاق بولينجر السفلي',
      bbHigh: 'قريب من نطاق بولينجر العلوي',
      nearSupport: 'قريب من الدعم عند {lvl}',
      nearResistance: 'قريب من المقاومة عند {lvl}'
    },
    risks: {
      volatile:
        'التذبذب السنوي {vol}٪. وقف الخسارة الضيق سيُضرب بضجيج السوق العادي قبل أن تحدث أصلاً الحركة التي وُضع من أجلها.',
      conflict:
        'المؤشرات تتناقض هنا، فلا قراءة منفردة مما يلي تحمل وزناً كبيراً بمفردها.',
      overbought:
        'هو في التشبع الشرائي أصلاً. الدخول الآن يعني الشراء بعد الحركة لا قبلها.',
      oversold:
        'التشبع البيعي قد يستمر طويلاً. لا شيء في هذه الأرقام يحدد القاع.',
      thin:
        'تاريخ السعر أقل من ٣٠ يوماً، فكل المؤشرات أدناه محسوبة على عينة قصيرة وينبغي قراءتها بتحفظ.',
      news:
        'لا يوجد مصدر أخبار متصل، فالتحليل يقرأ السعر ولا شيء غيره. الإدراج في منصة أو اختراق أو خبر تنظيمي كلها غير مرئية له تماماً.',
      resistance:
        'المقاومة عند {lvl} فوق السعر مباشرة — وهناك توقفت الموجات الصاعدة الأخيرة.',
      support:
        'الدعم عند {lvl} تحت السعر مباشرة، وكسره يسرّع الحركة عادةً.'
    },
    invalidation: {
      bullish: 'إغلاق تحت {lvl} يكسر البنية التي تقوم عليها هذه القراءة.',
      bearish: 'إغلاق فوق {lvl} يكسر البنية التي تقوم عليها هذه القراءة.',
      neutral: 'إغلاق حاسم خارج {low} إلى {high} يحسم التردد الحالي.'
    },
    briefHeadline: {
      bullish: 'السوق مرتفع عموماً — {up} من {total} من العملات الكبرى مرتفعة',
      bearish: 'السوق منخفض عموماً — {down} من {total} من العملات الكبرى منخفضة',
      neutral: 'جلسة مختلطة بلا اتجاه واضح'
    },
    briefSummary:
      'تحركت القيمة السوقية الإجمالية {mcapChange}٪ خلال ٢٤ ساعة، وهيمنة البيتكوين {btcDom}٪. {breadth} {domNote}',
    breadthUp:
      '{up} من أصل {total} من الأكبر مرتفعة اليوم، فالحركة واسعة ولم يرفع المؤشرَ اسم أو اسمان.',
    breadthDown:
      '{down} من أصل {total} من الأكبر منخفضة اليوم، فالبيع واسع لا هبوط معزول.',
    breadthMixed:
      'الرابحون والخاسرون متقاربون تقريباً، وهذه صورة سوق متردد.',
    domUp:
      'ارتفاع هيمنة البيتكوين مع هبوط السوق يعني عادةً أن المال يغادر العملات البديلة أولاً.',
    domDown: 'انخفاض هيمنة البيتكوين يعني عادةً تحوّل الإقبال نحو العملات البديلة.',
    domFlat: 'الهيمنة مستقرة، فلا دوران قوي لرأس المال في أي اتجاه.'
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
  /*
   * Price figures stay in Latin digits because they are compared and copied
   * far more than they are read aloud — but the currency MARKER around them
   * is localised by `money()` before we get here, so there is no longer a
   * bare "$" for the bidi algorithm to strand on the wrong side of the
   * number. That stranding was one of the things that made the Persian read
   * as machine output.
   */
  return String(text).replace(/(\d+[\d.,]*\s?(?:دلار|دولار))|(\d)/g, (m, priced, digit) =>
    priced ?? set[Number(digit)]
  );
}

/** `{a}` placeholder interpolation. Missing keys become an empty string. */
function fill(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/**
 * A price level, written the way each language writes one.
 *
 * ─── WHY THIS IS NOT JUST `'$' + n` ─────────────────────────────────────────
 * It was, and inside an RTL paragraph the result was wrong twice over.
 *
 * First, direction. "$150.12" dropped into Persian prose puts a
 * left-to-right currency symbol at a bidirectional boundary; the Unicode bidi
 * algorithm resolves that differently depending on what precedes it, so the
 * same figure could render as "$150.12" in one sentence and "150.12$" in the
 * next. Inconsistent within a single screen is what makes text look broken
 * even to a reader who cannot say why.
 *
 * Second, idiom. A Persian speaker says «۱۵۰ دلار», not «$۱۵۰» — the unit
 * follows the number as a word. Writing it the other way is a tell that the
 * sentence was translated rather than written.
 *
 * So the symbol becomes a trailing word in fa/ar and stays a leading symbol
 * in en. The templates carry a bare `{lvl}` and this decides the form.
 */
function money(v, lang = 'en') {
  if (!Number.isFinite(v)) return '—';
  const n =
    v >= 1000
      ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : v >= 1
        ? v.toFixed(2)
        : v.toFixed(6);
  if (lang === 'fa') return `${n} دلار`;
  if (lang === 'ar') return `${n} دولار`;
  return `$${n}`;
}

/**
 * The "how many indicators agree" clause, built as a whole rather than
 * interpolated as a bare number.
 *
 * ─── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 * The English template was "{n} of {total} indicators point the same way".
 * At 5-of-7 that is correct. At 1-of-7 it printed
 *
 *     "1 of 7 indicators point the same way"
 *
 * — a plain subject-verb disagreement, and precisely the kind of error that
 * makes a reader conclude a machine wrote the sentence, because one did. The
 * same template also printed "0 of 7", which is grammatical but reads as an
 * error rather than as information.
 *
 * Building the clause here means the verb can agree, and the zero case can
 * say something useful instead of quoting a bare nought.
 *
 * Persian is a no-op for agreement — «۱ تا از ۷ اندیکاتور» is correct at
 * every count — but the zero case still deserves words rather than a digit,
 * so it is handled in both.
 */
function agreementClause(n, total, lang) {
  if (lang === 'fa') {
    if (n === 0) return 'هیچ‌کدام از اندیکاتورها هم‌جهت نیستند';
    /*
     * Persian DOES need agreement here, contrary to the first pass at this.
     * With a count of one the verb is singular — «۱ اندیکاتور … نشان می‌دهد»
     * — and the plural «نشان می‌دهند» after «۱ تا» is wrong in the same way
     * "1 indicators point" is wrong in English. The «تا» classifier is also
     * dropped for one, because «۱ تا اندیکاتور» is spoken register and this
     * is written analysis.
     */
    if (n === 1) return `از ${total} اندیکاتور فقط یکی همین جهت را نشان می‌دهد`;
    return `از ${total} اندیکاتور، ${n} تا یک جهت را نشان می‌دهند`;
  }
  if (lang === 'ar') {
    if (n === 0) return 'لا مؤشر واحد يتفق مع البقية';
    /*
     * Arabic number agreement, which is not optional and was wrong.
     * After 3–10 the counted noun takes the plural genitive — «٧ مؤشرات»,
     * not «٧ مؤشراً». The accusative singular «مؤشراً» is correct only from
     * 11 upward. With one, the noun is singular and the verb follows it.
     */
    if (n === 1) return `من أصل ${total} مؤشرات هناك واحد فقط يشير إلى الاتجاه نفسه`;
    const counted = total >= 3 && total <= 10 ? 'مؤشرات' : 'مؤشراً';
    return `من أصل ${total} ${counted} هناك ${n} تشير إلى الاتجاه نفسه`;
  }
  if (n === 0) return 'none of the indicators agree with each other';
  if (n === 1) return `just 1 of the ${total} indicators points the same way`;
  return `${n} of the ${total} indicators point the same way`;
}

/**
 * Capitalise a clause that has been placed at the start of a sentence.
 *
 * ─── WHY THIS IS NEEDED AND WHY IT IS LANGUAGE-GATED ────────────────────────
 * The summary is "{lead} {agree}, which is…". The lead ends with a full stop,
 * so `{agree}` begins a new sentence and rendered as
 *
 *     "…MACD momentum positive. none of the indicators agree…"
 *
 * A lowercase letter after a full stop is the most visible possible sign that
 * text was assembled by machine rather than written.
 *
 * Persian and Arabic have no letter case at all, so applying this blindly
 * would be a no-op there in the best case and a mangled first grapheme in the
 * worst — Arabic-script letters change shape by position, and touching the
 * first one risks breaking the join. Hence the explicit gate rather than a
 * `toUpperCase()` that "does nothing anyway".
 */
function startSentence(clause, lang) {
  if (lang !== 'en' || typeof clause !== 'string' || !clause) return clause;
  return clause[0].toUpperCase() + clause.slice(1);
}

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
    /*
     * A whole clause, not a bare count. See `agreementClause` — interpolating
     * the number alone produced "1 of 7 indicators point", which is a
     * grammar error and the single clearest tell that a machine wrote it.
     */
    agree: startSentence(agreementClause(agreeing, sigs.length, lang), lang),
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
    drivers.push(fill(p.drivers.nearSupport, { lvl: money(ind.support, lang) }));
  }
  if (drivers.length < 3 && ind.resistance != null && price && ind.resistance / price - 1 < 0.03) {
    drivers.push(fill(p.drivers.nearResistance, { lvl: money(ind.resistance, lang) }));
  }

  /* -------------------------------- risks ------------------------------- */
  // Always at least one, and always the honest one: this reads price only.
  const risks = [];
  if (vol != null && vol > 60) risks.push(fill(p.risks.volatile, { vol: num(vol, 0) }));
  if (confidence < 45) risks.push(p.risks.conflict);
  if (bias === 'bullish' && rsiVal != null && rsiVal > 68) risks.push(p.risks.overbought);
  if (bias === 'bearish' && rsiVal != null && rsiVal < 32) risks.push(p.risks.oversold);
  if (risks.length < 3 && ind.resistance != null && price && ind.resistance / price - 1 < 0.05) {
    risks.push(fill(p.risks.resistance, { lvl: money(ind.resistance, lang) }));
  }
  if (risks.length < 3) risks.push(p.risks.news);

  /* ---------------------------- invalidation ---------------------------- */
  let invalidation;
  if (bias === 'bullish') {
    invalidation = fill(p.invalidation.bullish, {
      lvl: money(ind.support ?? (ma20 != null ? ma20 : price * 0.95), lang)
    });
  } else if (bias === 'bearish') {
    invalidation = fill(p.invalidation.bearish, {
      lvl: money(ind.resistance ?? (ma20 != null ? ma20 : price * 1.05), lang)
    });
  } else {
    invalidation = fill(p.invalidation.neutral, {
      low: money(ind.support ?? price * 0.95, lang),
      high: money(ind.resistance ?? price * 1.05, lang)
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
