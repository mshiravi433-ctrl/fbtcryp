/**
 * FBT INTENT OS — OPERATIONS CATALOG LOCALIZATION.
 * ---------------------------------------------------------------------------
 * ─── THE BUG ────────────────────────────────────────────────────────────────
 *   «در مرکز عملیات، رابط کاربری انگلیسی است حتی وقتی زبان برنامه فارسی است»
 *
 * Every one of the 15 categories and 80 cards in opsCatalog.js carried a
 * hard-coded English `title` and `desc` string literal. OperationsPanel
 * rendered `{card.title}` directly, so the entire Operations Center stayed in
 * English no matter what the app language was. There was no translation to
 * miss — the strings were data, and the data was monolingual.
 *
 * ─── WHY NOT src/i18n/locales/*.json ────────────────────────────────────────
 * The app's `t()` helper is for interface CHROME — labels a designer writes.
 * These 190 strings are the catalog's own content: they are generated from and
 * validated against `opsCatalog.js`, they change whenever a card is added, and
 * ops-center-probe checks them against the card list. Keeping them beside the
 * catalog means one file to edit when a card lands, and a missing translation
 * is caught by the probe rather than surfacing as a blank label at runtime.
 *
 * ─── FALLBACK IS DELIBERATE AND VISIBLE ─────────────────────────────────────
 * `localizeOpsCard` falls back to English rather than rendering an empty
 * string or a raw key. A user seeing one English label among Persian ones is a
 * small, self-reporting bug; a user seeing `ops.card.farm_claim.title` is a
 * broken product. `missingOpsTranslations()` exists so a test can fail on the
 * gap instead of waiting for someone to notice it on screen.
 */

/** Category labels, keyed by the category id in opsCatalog.CATEGORIES. */
const CATEGORY_LABELS = Object.freeze({
  portfolio: { fa: 'پرتفوی', ar: 'المحفظة', en: 'Portfolio' },
  wallet: { fa: 'کیف پول', ar: 'المحفظة النقدية', en: 'Wallet' },
  swap: { fa: 'سواپ', ar: 'المبادلة', en: 'Swap' },
  bridge: { fa: 'بریج', ar: 'الجسر', en: 'Bridge' },
  lending: { fa: 'وام', ar: 'الإقراض', en: 'Lending' },
  farm: { fa: 'فارم', ar: 'المزرعة', en: 'Farm' },
  liquidity: { fa: 'نقدینگی', ar: 'السيولة', en: 'Liquidity' },
  futures: { fa: 'فیوچرز', ar: 'العقود الآجلة', en: 'Futures' },
  dydx: { fa: 'dYdX', ar: 'dYdX', en: 'dYdX' },
  markets: { fa: 'بازارهای جهانی', ar: 'الأسواق العالمية', en: 'Global Markets' },
  intelligence: { fa: 'هوشمندی بازار', ar: 'ذكاء السوق', en: 'Intelligence' },
  goals: { fa: 'اهداف', ar: 'الأهداف', en: 'Goals' },
  automation: { fa: 'خودکارسازی', ar: 'الأتمتة', en: 'Automation' },
  monitoring: { fa: 'پایش', ar: 'المراقبة', en: 'Monitoring' },
  rewards: { fa: 'پاداش‌ها', ar: 'المكافآت', en: 'Rewards' }
});

/**
 * Card titles and descriptions, keyed by card id.
 *
 * The Persian is written the way this product's users speak, not transliterated
 * English: «سواپ» and «بریج» are the words in use, so they stay, while
 * "concentration" becomes «تمرکز دارایی» rather than a loanword.
 *
 * The honesty markers in the English descriptions are preserved in every
 * language. "needs wallet", "no guarantees" and "this device" are not
 * decoration — they are the difference between an accurate label and a claim
 * the app cannot keep. A translation that drops them is a bug.
 */
const CARD_LABELS = Object.freeze({
  /* ------------------------------ Portfolio ------------------------------ */
  portfolio_analysis: {
    fa: { title: 'تحلیل پرتفوی', desc: 'تخصیص واقعی دارایی، تمرکز و ریسک، خوانده‌شده از کیف پول شما' },
    ar: { title: 'تحليل المحفظة', desc: 'التوزيع الفعلي للأصول والتركّز والمخاطر من محفظتك' }
  },
  portfolio_rebalance: {
    fa: { title: 'متعادل‌سازی', desc: 'برنامه‌ی متعادل‌سازی به سمت تخصیص هدف (نیازمند کیف پول)' },
    ar: { title: 'إعادة التوازن', desc: 'خطة إعادة توازن نحو التوزيع المستهدف (يتطلب محفظة)' }
  },
  portfolio_risk: {
    fa: { title: 'تحلیل ریسک', desc: 'تمرکز، افت سرمایه و نوسان، محاسبه‌شده از داده واقعی' },
    ar: { title: 'تحليل المخاطر', desc: 'التركّز والانخفاض والتقلب من بيانات حقيقية' }
  },
  portfolio_allocation: {
    fa: { title: 'تخصیص دارایی', desc: 'ارزش شما روی هر شبکه و هر دارایی کجاست' },
    ar: { title: 'توزيع الأصول', desc: 'أين تقع قيمتك عبر الشبكات والأصول' }
  },

  /* -------------------------------- Wallet ------------------------------- */
  wallet_analysis: {
    fa: { title: 'تحلیل کیف پول', desc: 'خواندن وضعیت کیف پول متصل EVM و سولانا' },
    ar: { title: 'تحليل المحفظة', desc: 'قراءة حالة محفظة EVM وسولانا المتصلة' }
  },
  wallet_balances: {
    fa: { title: 'موجودی‌ها', desc: 'موجودی واقعی هر شبکه از هوک چند-زنجیره‌ای' },
    ar: { title: 'الأرصدة', desc: 'الأرصدة الحقيقية لكل شبكة' }
  },
  wallet_transactions: {
    fa: { title: 'تراکنش‌ها', desc: 'تاریخچه تراکنش‌های Intent OS (روی همین دستگاه)' },
    ar: { title: 'المعاملات', desc: 'سجل معاملات Intent OS (على هذا الجهاز)' }
  },
  wallet_evm: {
    fa: { title: 'کیف پول EVM', desc: 'مدیریت کیف پول EVM و تعویض شبکه' },
    ar: { title: 'محفظة EVM', desc: 'إدارة محفظة EVM وتبديل الشبكة' }
  },
  wallet_solana: {
    fa: { title: 'کیف پول سولانا', desc: 'موجودی سولانا و صفحه سواپ آن' },
    ar: { title: 'محفظة سولانا', desc: 'رصيد سولانا وواجهة المبادلة' }
  },

  /* --------------------------------- Swap -------------------------------- */
  swap_token: {
    fa: { title: 'سواپ توکن', desc: 'نقل‌قول واقعی ← پیش‌نمایش ← امضای کیف پول در صفحه سواپ' },
    ar: { title: 'مبادلة العملات', desc: 'عرض سعر حقيقي ← معاينة ← توقيع المحفظة' }
  },
  swap_crosschain: {
    fa: { title: 'سواپ بین‌زنجیره‌ای', desc: 'انتقال یا معامله بین شبکه‌های EVM (مقصد: صفحه بریج)' },
    ar: { title: 'مبادلة عبر السلاسل', desc: 'تحويل أو تداول بين شبكات EVM (الوجهة: الجسر)' }
  },
  swap_quote: {
    fa: { title: 'نقل‌قول', desc: 'نقل‌قول زنده سواپ از اگریگیتور واقعی' },
    ar: { title: 'عرض السعر', desc: 'عرض سعر حي للمبادلة من المجمّع الحقيقي' }
  },
  swap_execute: {
    fa: { title: 'اجرای سواپ', desc: 'تأیید ← امضای کیف پول ← ارسال به شبکه (در صفحه واقعی)' },
    ar: { title: 'تنفيذ المبادلة', desc: 'تأكيد ← توقيع المحفظة ← بث المعاملة' }
  },

  /* -------------------------------- Bridge ------------------------------- */
  bridge_run: {
    fa: { title: 'بریج', desc: 'انتقال بین‌زنجیره‌ای: نقل‌قول، پیش‌نمایش، امضای کیف پول' },
    ar: { title: 'الجسر', desc: 'تحويل عبر السلاسل: عرض سعر ومعاينة وتوقيع' }
  },
  bridge_crosschain: {
    fa: { title: 'انتقال بین‌زنجیره‌ای', desc: 'مسیریابی با LiFi و انتقال امضاشده' },
    ar: { title: 'تحويل عبر السلاسل', desc: 'مسار عبر LiFi وتحويل موقّع' }
  },
  bridge_quote: {
    fa: { title: 'نقل‌قول بریج', desc: 'مسیر، کارمزد و زمان تخمینی زنده از موتور بریج' },
    ar: { title: 'عرض سعر الجسر', desc: 'المسار والرسوم والوقت المتوقع مباشرة' }
  },
  bridge_execute: {
    fa: { title: 'اجرای بریج', desc: 'آماده‌سازی ← شبیه‌سازی ← تأیید ← امضا ← راستی‌آزمایی' },
    ar: { title: 'تنفيذ الجسر', desc: 'تحضير ← محاكاة ← تأكيد ← توقيع ← تحقق' }
  },

  /* ------------------------------- Lending ------------------------------- */
  lending_lend: {
    fa: { title: 'سپرده‌گذاری', desc: 'عرضه به بازارهای وام‌دهی واقعی (مدل Aave/Morpho)' },
    ar: { title: 'الإقراض', desc: 'التوريد إلى أسواق إقراض حقيقية' }
  },
  lending_borrow: {
    fa: { title: 'وام گرفتن', desc: 'وام در برابر وثیقه‌ی عرضه‌شده' },
    ar: { title: 'الاقتراض', desc: 'اقتراض مقابل الضمانات المودعة' }
  },
  lending_repay: {
    fa: { title: 'بازپرداخت', desc: 'بازپرداخت یک موقعیت وام' },
    ar: { title: 'السداد', desc: 'سداد مركز اقتراض' }
  },
  lending_withdraw: {
    fa: { title: 'برداشت', desc: 'برداشت دارایی‌های عرضه‌شده' },
    ar: { title: 'السحب', desc: 'سحب الأصول المودعة' }
  },
  lending_analysis: {
    fa: { title: 'تحلیل موقعیت', desc: 'بازارهای وام: نرخ عرضه و وام‌گیری و ریسک آن‌ها' },
    ar: { title: 'تحليل المركز', desc: 'أسواق الإقراض: عوائد التوريد والاقتراض والمخاطر' }
  },

  /* --------------------------------- Farm -------------------------------- */
  farm_analysis: {
    fa: { title: 'تحلیل فارم', desc: 'فارم‌های زنده و نرخ سود سالانه‌شان (منبع: DefiLlama)' },
    ar: { title: 'تحليل المزرعة', desc: 'مزارع العوائد الحية ونِسَب العائد السنوي' }
  },
  farm_recommend: {
    fa: { title: 'پیشنهاد فارم', desc: 'فرصت‌های فارم، رتبه‌بندی‌شده بر اساس هدف شما' },
    ar: { title: 'توصية المزرعة', desc: 'فرص مرتبة وفق هدفك' }
  },
  farm_deposit: {
    fa: { title: 'واریز', desc: 'واریز به یک فارم (در صفحه‌ی خودش، با امضای کیف پول)' },
    ar: { title: 'الإيداع', desc: 'الإيداع في مزرعة (في صفحتها، بتوقيع المحفظة)' }
  },
  farm_withdraw: {
    fa: { title: 'برداشت', desc: 'برداشت از یک موقعیت فارم' },
    ar: { title: 'السحب', desc: 'السحب من مركز مزرعة' }
  },
  farm_claim: {
    fa: { title: 'دریافت پاداش', desc: 'دریافت پاداش‌های فارم' },
    ar: { title: 'المطالبة', desc: 'المطالبة بمكافآت المزرعة' }
  },
  farm_compound: {
    fa: { title: 'سرمایه‌گذاری مجدد', desc: 'سرمایه‌گذاری دوباره‌ی پاداش‌های فارم' },
    ar: { title: 'إعادة الاستثمار', desc: 'إعادة استثمار مكافآت المزرعة' }
  },

  /* ------------------------------ Liquidity ------------------------------ */
  lp_analysis: {
    fa: { title: 'تحلیل استخر', desc: 'استخرهای نقدینگی: سود سالانه، ارزش قفل‌شده و ریسک ضرر ناپایدار' },
    ar: { title: 'تحليل المجمّع', desc: 'مجمّعات السيولة: العائد والقيمة المقفلة ومخاطر الخسارة غير الدائمة' }
  },
  lp_add: {
    fa: { title: 'افزودن نقدینگی', desc: 'افزودن به یک استخر (در صفحه‌ی خودش، با امضای کیف پول)' },
    ar: { title: 'إضافة سيولة', desc: 'الإضافة إلى مجمّع (في صفحته، بتوقيع المحفظة)' }
  },
  lp_remove: {
    fa: { title: 'برداشت نقدینگی', desc: 'خروج از یک استخر' },
    ar: { title: 'سحب السيولة', desc: 'الخروج من مجمّع' }
  },
  lp_stake: {
    fa: { title: 'استیک توکن LP', desc: 'استیک توکن‌های LP برای دریافت پاداش' },
    ar: { title: 'رهن رموز LP', desc: 'رهن رموز LP للحصول على مكافآت' }
  },
  lp_unstake: {
    fa: { title: 'خروج از استیک LP', desc: 'آزادسازی توکن‌های LP' },
    ar: { title: 'إلغاء رهن LP', desc: 'تحرير رموز LP' }
  },

  /* ------------------------------- Futures ------------------------------- */
  futures_analysis: {
    fa: { title: 'تحلیل فیوچرز', desc: 'بازارهای پرپچوال آن‌چین: نرخ فاندینگ، بهره باز و ریسک' },
    ar: { title: 'تحليل العقود الآجلة', desc: 'أسواق العقود الدائمة: التمويل والمراكز المفتوحة والمخاطر' }
  },
  futures_position: {
    fa: { title: 'موقعیت‌ها', desc: 'موقعیت‌های باز و قیمت لیکویید شدن' },
    ar: { title: 'المراكز', desc: 'المراكز المفتوحة وأسعار التصفية' }
  },
  futures_open: {
    fa: { title: 'باز کردن موقعیت', desc: 'باز کردن موقعیت پرپچوال (در صفحه‌ی خودش، با نقل‌قول واقعی)' },
    ar: { title: 'فتح مركز', desc: 'فتح مركز دائم (في صفحته، بعرض سعر حقيقي)' }
  },
  futures_close: {
    fa: { title: 'بستن موقعیت', desc: 'بستن یک موقعیت پرپچوال' },
    ar: { title: 'إغلاق مركز', desc: 'إغلاق مركز دائم' }
  },
  futures_reduce: {
    fa: { title: 'کاهش موقعیت', desc: 'کم کردن اندازه‌ی موقعیت' },
    ar: { title: 'تقليص المركز', desc: 'تقليل حجم المركز' }
  },
  futures_risk: {
    fa: { title: 'تحلیل ریسک', desc: 'ریسک اهرم و لیکویید شدن در بازارهای پرپچوال' },
    ar: { title: 'تحليل المخاطر', desc: 'مخاطر الرافعة والتصفية في الأسواق الدائمة' }
  },

  /* --------------------------------- dYdX -------------------------------- */
  dydx_market: {
    fa: { title: 'بازار', desc: 'بازارهای dYdX: فاندینگ، حجم و اسپرد' },
    ar: { title: 'السوق', desc: 'أسواق dYdX: التمويل والحجم والفارق السعري' }
  },
  dydx_position: {
    fa: { title: 'موقعیت‌ها', desc: 'موقعیت‌های شما در dYdX' },
    ar: { title: 'المراكز', desc: 'مراكزك في dYdX' }
  },
  dydx_open: {
    fa: { title: 'باز کردن', desc: 'باز کردن یک موقعیت در dYdX' },
    ar: { title: 'فتح', desc: 'فتح مركز في dYdX' }
  },
  dydx_close: {
    fa: { title: 'بستن', desc: 'بستن یک موقعیت در dYdX' },
    ar: { title: 'إغلاق', desc: 'إغلاق مركز في dYdX' }
  },
  dydx_risk: {
    fa: { title: 'ریسک', desc: 'سطوح ریسک در dYdX' },
    ar: { title: 'المخاطر', desc: 'مستويات المخاطر في dYdX' }
  },

  /* ---------------------------- Global markets --------------------------- */
  markets_stocks: {
    fa: { title: 'سهام', desc: 'داده‌ی زنده‌ی سهام (از منبع واقعی)' },
    ar: { title: 'الأسهم', desc: 'بيانات أسهم حية من مصدر حقيقي' }
  },
  markets_etf: {
    fa: { title: 'صندوق‌های ETF', desc: 'پوشش صندوق‌های قابل معامله' },
    ar: { title: 'صناديق المؤشرات', desc: 'تغطية صناديق المؤشرات المتداولة' }
  },
  markets_funds: {
    fa: { title: 'صندوق‌ها', desc: 'پوشش صندوق‌های سرمایه‌گذاری' },
    ar: { title: 'الصناديق', desc: 'تغطية صناديق الاستثمار' }
  },
  markets_forex: {
    fa: { title: 'فارکس', desc: 'جفت‌ارزها (افق جهانی)' },
    ar: { title: 'الفوركس', desc: 'أزواج العملات (الأفق العالمي)' }
  },
  markets_commodities: {
    fa: { title: 'کالاها', desc: 'پوشش بازار کالا' },
    ar: { title: 'السلع', desc: 'تغطية سوق السلع' }
  },
  markets_rwa: {
    fa: { title: 'دارایی‌های واقعی', desc: 'توکن‌های دارایی واقعی (PAXG و XAUt قابل سواپ هستند)' },
    ar: { title: 'الأصول الواقعية', desc: 'رموز الأصول الواقعية (PAXG وXAUt قابلة للمبادلة)' }
  },
  markets_tokenized: {
    fa: { title: 'دارایی‌های توکن‌شده', desc: 'طلای توکن‌شده و دارایی‌های استیک‌شده' },
    ar: { title: 'الأصول المرمّزة', desc: 'الذهب المرمّز والأصول المرهونة' }
  },

  /* ---------------------------- Intelligence ----------------------------- */
  intel_marketscan: {
    fa: { title: 'اسکن بازار', desc: 'اسکن زنده‌ی بازار: بیشترین تغییرها، حجم و نوسان' },
    ar: { title: 'مسح السوق', desc: 'مسح حي للسوق: الأكثر حركة والحجم والتقلب' }
  },
  intel_smartmoney: {
    fa: { title: 'پول هوشمند', desc: 'ردیابی کیف پول‌های پول هوشمند (داده واقعی)' },
    ar: { title: 'المال الذكي', desc: 'تتبع محافظ المال الذكي (بيانات حقيقية)' }
  },
  intel_whales: {
    fa: { title: 'ردیابی نهنگ‌ها', desc: 'جریان جابه‌جایی‌های نهنگ‌ها' },
    ar: { title: 'تتبع الحيتان', desc: 'تدفق تحركات الحيتان' }
  },
  intel_signals: {
    fa: { title: 'سیگنال‌ها', desc: 'ارائه‌دهندگان سیگنال' },
    ar: { title: 'الإشارات', desc: 'مزودو الإشارات' }
  },
  intel_news: {
    fa: { title: 'اخبار', desc: 'اخبار زنده‌ی بازار' },
    ar: { title: 'الأخبار', desc: 'أخبار السوق الحية' }
  },
  intel_events: {
    fa: { title: 'رویدادها', desc: 'تقویم رویدادهای بازار' },
    ar: { title: 'الأحداث', desc: 'تقويم أحداث السوق' }
  },
  intel_token: {
    fa: { title: 'تحلیل توکن', desc: 'تحلیل یک توکن با داده‌ی زنده‌ی بازار' },
    ar: { title: 'تحليل الرمز', desc: 'تحليل رمز ببيانات سوق حية' }
  },
  intel_contract: {
    fa: { title: 'تحلیل قرارداد', desc: 'بررسی ریسک قرارداد توکن (سپر آدرس)' },
    ar: { title: 'تحليل العقد', desc: 'فحص مخاطر عقد الرمز' }
  },

  /* -------------------------------- Goals -------------------------------- */
  goals_create: {
    fa: { title: 'هدف مالی', desc: 'ساخت یک هدف مالی واقعی و ماندگار' },
    ar: { title: 'هدف مالي', desc: 'إنشاء هدف مالي حقيقي ودائم' }
  },
  goals_profit: {
    fa: { title: 'برنامه سود', desc: 'برنامه‌ای آگاه به ریسک، به سمت هدف سود شما' },
    ar: { title: 'خطة الربح', desc: 'خطة واعية بالمخاطر نحو هدف ربحك' }
  },
  goals_forecast: {
    fa: { title: 'پیش‌بینی', desc: 'بازه‌ی سناریوهای تاریخی برای یک هدف (بدون هیچ تضمینی)' },
    ar: { title: 'التوقع', desc: 'نطاق سيناريوهات تاريخية لهدف (بدون أي ضمان)' }
  },
  goals_whatif: {
    fa: { title: 'تحلیل «چه می‌شد اگر»', desc: 'شبیه‌سازی روی داده‌ی واقعی پرتفوی' },
    ar: { title: 'ماذا لو', desc: 'محاكاة على بيانات محفظة حقيقية' }
  },
  goals_progress: {
    fa: { title: 'پیشرفت', desc: 'پیشرفت واقعی به سمت اهداف موجود' },
    ar: { title: 'التقدم', desc: 'التقدم الفعلي نحو الأهداف القائمة' }
  },
  goals_rebalance: {
    fa: { title: 'متعادل‌سازی', desc: 'هم‌راستا کردن پرتفوی با برنامه‌ی هدف' },
    ar: { title: 'إعادة التوازن', desc: 'مواءمة المحفظة مع خطة الهدف' }
  },

  /* ------------------------------ Automation ----------------------------- */
  auto_watchmarket: {
    fa: { title: 'رصد بازار', desc: 'ساخت یک مانیتور واقعی (ارزیابی روی سرور)' },
    ar: { title: 'مراقبة السوق', desc: 'إنشاء مهمة مراقبة حقيقية (تُقيَّم على الخادم)' }
  },
  auto_pricealert: {
    fa: { title: 'هشدار قیمت', desc: 'هشدار وقتی یک دارایی از قیمتی عبور کند' },
    ar: { title: 'تنبيه السعر', desc: 'تنبيه عند تجاوز أصل لسعر معين' }
  },
  auto_condition: {
    fa: { title: 'پایش شرط', desc: 'پایش یک شرط (قیمت، درصد تغییر، نوسان)' },
    ar: { title: 'مراقبة شرط', desc: 'مراقبة شرط (السعر، نسبة التغير، التقلب)' }
  },
  auto_strategy: {
    fa: { title: 'استراتژی خودکار', desc: 'پایش پرتفوی و فرصت‌ها به سمت یک هدف' },
    ar: { title: 'استراتيجية آلية', desc: 'مراقبة المحفظة والفرص نحو هدف' }
  },
  auto_scheduled: {
    fa: { title: 'عملیات زمان‌بندی‌شده', desc: 'خرید پلکانی یا تکرارشونده (رجیستری خودکارسازی سرور)' },
    ar: { title: 'إجراء مجدول', desc: 'شراء دوري أو متكرر (سجل الأتمتة على الخادم)' }
  },
  auto_recurring: {
    fa: { title: 'خرید تکرارشونده', desc: 'برنامه‌ی واقعی خرید پلکانی (DCA)' },
    ar: { title: 'شراء متكرر', desc: 'خطة شراء دوري حقيقية' }
  },
  auto_conditional: {
    fa: { title: 'خرید شرطی', desc: '«وقتی بیت‌کوین به X رسید بخر» ← سفارش واقعی در صفحه سفارش‌ها' },
    ar: { title: 'شراء مشروط', desc: '«اشترِ عندما يبلغ البيتكوين X» ← أمر حقيقي في صفحة الأوامر' }
  },

  /* ------------------------------ Monitoring ----------------------------- */
  monitor_list: {
    fa: { title: 'پایش‌های فعال', desc: 'همه‌ی مانیتورهای در حال اجرا با وضعیت واقعی' },
    ar: { title: 'المراقبات النشطة', desc: 'كل المراقبات الجارية بحالتها الحقيقية' }
  },
  monitor_opportunity: {
    fa: { title: 'پایش فرصت', desc: 'رصد فرصت‌ها به سمت هدف شما' },
    ar: { title: 'مراقبة الفرص', desc: 'رصد الفرص نحو هدفك' }
  },
  monitor_portfolio: {
    fa: { title: 'پایش پرتفوی', desc: 'رصد ریسک و تغییرات پرتفوی' },
    ar: { title: 'مراقبة المحفظة', desc: 'رصد مخاطر المحفظة وتغيراتها' }
  },

  /* -------------------------------- Rewards ------------------------------ */
  rewards_dashboard: {
    fa: { title: 'پاداش‌های FBT', desc: 'امتیازها، ماموریت‌ها و دعوت دوستان' },
    ar: { title: 'مكافآت FBT', desc: 'النقاط والمهام والإحالات' }
  },
  rewards_missions: {
    fa: { title: 'ماموریت‌ها', desc: 'ماموریت‌ها را کامل کنید و امتیاز بگیرید' },
    ar: { title: 'المهام', desc: 'أكمل المهام واكسب النقاط' }
  },
  rewards_points: {
    fa: { title: 'امتیازها', desc: 'پیگیری موجودی امتیاز' },
    ar: { title: 'النقاط', desc: 'تتبع رصيد النقاط' }
  },
  rewards_referral: {
    fa: { title: 'دعوت دوستان', desc: 'دوستان را دعوت کنید و پاداش بگیرید' },
    ar: { title: 'الإحالة', desc: 'ادعُ أصدقاءك واكسب مكافآت' }
  }
});

/** 'fa-IR' → 'fa'. Anything unknown reads as English. */
export function langOf(locale) {
  const tag = String(locale || 'fa').toLowerCase();
  if (tag.startsWith('fa')) return 'fa';
  if (tag.startsWith('ar')) return 'ar';
  return 'en';
}

/**
 * Localized category label.
 * @returns {string} the translated title, or the catalog's English title.
 */
export function localizeOpsCategory(category, locale = 'fa') {
  if (!category) return '';
  const lang = langOf(locale);
  if (lang === 'en') return category.title;
  return CATEGORY_LABELS[category.id]?.[lang] || category.title;
}

/**
 * Localized card.
 *
 * Returns a NEW object with `title`/`desc` swapped and everything else — id,
 * action, capabilityId, route, requiresWallet — passed through untouched. The
 * routing and availability logic reads those fields, so translating must never
 * be able to change what a card DOES.
 */
export function localizeOpsCard(card, locale = 'fa') {
  if (!card) return card;
  const lang = langOf(locale);
  if (lang === 'en') return card;
  const t = CARD_LABELS[card.id]?.[lang];
  if (!t) return card;
  return { ...card, title: t.title || card.title, desc: t.desc || card.desc };
}

/**
 * Which cards/categories have no translation in a given language.
 *
 * Exists so a probe fails on a missing string when a card is ADDED, rather
 * than the gap being discovered by a Persian speaker reading English on
 * screen. Pass the live catalog in to keep this file from having to import it
 * (and to let a test check a subset).
 */
export function missingOpsTranslations({ cards = [], categories = [], lang = 'fa' } = {}) {
  const language = langOf(lang);
  if (language === 'en') return { cards: [], categories: [] };
  return {
    cards: cards.filter((c) => {
      const t = CARD_LABELS[c.id]?.[language];
      return !t || !t.title || !t.desc;
    }).map((c) => c.id),
    categories: categories.filter((c) => !CATEGORY_LABELS[c.id]?.[language]).map((c) => c.id)
  };
}

export { CATEGORY_LABELS, CARD_LABELS };
