/**
 * UI STRINGS FOR THE OPERATIONS / HISTORY / STATUS / INTELLIGENCE PANELS.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *   «توی مرکز عملیات وقتی زبان برنامه فارسی است، رابط انگلیسی نشان می‌دهد»
 *
 * Every one of these strings used to be written inline as
 *
 *     locale === 'en' ? 'Paused' : 'متوقف'
 *
 * There were forty of them. That shape has two defects, and the app hit both:
 *
 *   1. It is a TWO-language switch in a THREE-language app. `ar` is not `en`,
 *      so it fell through to the Persian branch — an Arabic speaker got
 *      Persian, silently, with no missing-key warning anywhere to catch it.
 *      (Some spots were written the other way round and gave Arabic English.)
 *   2. `locale` is a full BCP-47 tag. The live value is `fa-IR`, `en-US`,
 *      `ar-SA` — not the bare subtag. `locale === 'en'` is FALSE for `en-US`,
 *      which is exactly how an English user ends up reading Persian labels,
 *      and how the reverse bug reached the user's screenshot.
 *
 * `langOf()` already normalizes a tag to one of fa/en/ar for the ops catalog;
 * reusing it here means the panels and the catalog can never disagree about
 * what language is on screen.
 *
 * ─── WHY NOT locales/{fa,en,ar}.json ────────────────────────────────────────
 * Same reason as `opsCatalogI18n.js`: `test/wiring.mjs` guard #1 requires every
 * static `t('…')` key to exist in `en.json`, and these strings are consumed by
 * plain functions (`statusPill`) that are called from non-component code and
 * from Node probes with no i18next instance mounted. A plain lookup table has
 * no runtime and no initialization order to get wrong.
 *
 * Arabic here is real Arabic, not transliterated Persian — the two languages
 * share an alphabet and almost none of this vocabulary.
 */

import { langOf } from './opsCatalogI18n.js';

/**
 * key → { fa, en, ar }.
 *
 * Grouped by the panel that reads it. A key with no entry for the active
 * language falls back to English rather than rendering the key itself: a
 * momentary English word is a translation gap, a raw `ops.status.paused` on
 * screen is a broken product.
 */
export const OPS_PANEL_STRINGS = {
  /* ---- statusPill: monitor / order lifecycle ---------------------------- */
  'status.active':     { fa: 'فعال',              en: 'Active',      ar: 'نشط' },
  'status.paused':     { fa: 'متوقف',             en: 'Paused',      ar: 'متوقف' },
  'status.triggered':  { fa: 'شرط برقرار شد',     en: 'Triggered',   ar: 'تحقق الشرط' },
  'status.completed':  { fa: 'تکمیل',             en: 'Completed',   ar: 'مكتمل' },
  'status.cancelled':  { fa: 'لغو شده',           en: 'Cancelled',   ar: 'ملغى' },
  'status.error':      { fa: 'خطا',               en: 'Error',       ar: 'خطأ' },
  'status.draft':      { fa: 'پیش‌نویس',          en: 'Draft',       ar: 'مسودة' },
  'status.waiting':    { fa: 'در انتظار تأیید',   en: 'Waiting',     ar: 'في انتظار التأكيد' },
  'status.executing':  { fa: 'در حال اجرا',       en: 'Executing',   ar: 'قيد التنفيذ' },
  'status.unknown':    { fa: 'نامشخص',            en: 'Unknown',     ar: 'غير معروف' },

  /* ---- Operations panel -------------------------------------------------- */
  'ops.aria':          { fa: 'عملیات',            en: 'Operations',  ar: 'العمليات' },
  'ops.title':         { fa: 'مرکز عملیات',       en: 'Operations Center', ar: 'مركز العمليات' },
  'ops.walletNeeded':  { fa: 'نیاز به کیف پول',   en: 'Wallet needed', ar: 'يتطلب محفظة' },
  'ops.unavailable':   { fa: 'در دسترس نیست',     en: 'Unavailable', ar: 'غير متاح' },
  'ops.note': {
    fa: 'هر کارت یک عملیات واقعی است؛ کارت‌هایی که کیف پول می‌خواهند دلیل غیرفعال بودن را نشان می‌دهند.',
    en: 'Every card is a real operation. Cards needing a connected wallet show why they are disabled.',
    ar: 'كل بطاقة عملية حقيقية. البطاقات التي تحتاج محفظة متصلة توضّح سبب تعطيلها.'
  },

  /* ---- History panel ----------------------------------------------------- */
  'history.you':       { fa: 'شما',               en: 'You',         ar: 'أنت' },
  'history.ai':        { fa: 'اینتنت',            en: 'AI',          ar: 'الذكاء' },

  /* ---- Status panel ------------------------------------------------------ */
  'status.connected':      { fa: 'متصل',            en: 'Connected',      ar: 'متصل' },
  'status.notConnected':   { fa: 'متصل نیست',       en: 'Not connected',  ar: 'غير متصل' },
  'status.online':         { fa: 'آنلاین',          en: 'Online',         ar: 'متصل بالإنترنت' },
  'status.durableStore':   { fa: 'ذخیره بادوام',    en: 'Durable store',  ar: 'تخزين دائم' },
  'status.memoryStore':    { fa: 'حافظه موقت',      en: 'Memory store',   ar: 'تخزين مؤقت' },
  'status.configured':     { fa: 'پیکربندی شده',    en: 'Configured',     ar: 'مُهيّأ' },
  'status.notConfigured':  { fa: 'پیکربندی نشده',   en: 'Not configured', ar: 'غير مُهيّأ' },
  'status.note': {
    fa: 'همه مقادیر از سرویس‌های واقعی خوانده می‌شوند؛ هیچ عدد شبیه‌سازی‌شده‌ای نمایش داده نمی‌شود.',
    en: 'All values are read from live services. Nothing here is a simulated number.',
    ar: 'تُقرأ جميع القيم من خدمات حيّة. لا يوجد هنا أي رقم محاكى.'
  },

  /* ---- Monitor card ------------------------------------------------------ */
  'monitor.checked':   { fa: 'آخرین بررسی',       en: 'checked',     ar: 'آخر فحص' },
  'monitor.pause':     { fa: 'توقف',              en: 'Pause',       ar: 'إيقاف' },
  'monitor.resume':    { fa: 'ادامه',             en: 'Resume',      ar: 'استئناف' },
  'monitor.checkNow':  { fa: 'بررسی اکنون',       en: 'Check now',   ar: 'افحص الآن' },
  'monitor.cancel':    { fa: 'لغو',               en: 'Cancel',      ar: 'إلغاء' },

  /* ---- Opportunity list -------------------------------------------------- */
  'opp.none': {
    fa: 'فرصتی با داده کافی پیدا نشد.',
    en: 'No opportunities with enough real data.',
    ar: 'لا توجد فرص ببيانات كافية.'
  },
  'opp.histRate':      { fa: 'نرخ تاریخی',        en: 'hist. rate',  ar: 'المعدل التاريخي' },
  'opp.monitor':       { fa: 'پایش کن',           en: 'Monitor',     ar: 'راقب' },
  'opp.note': {
    fa: 'بازده و احتمال، مشاهدات تاریخی یا APY اعلام‌شده‌اند — هیچ‌گاه تضمین نیستند. اطمینان و کیفیت داده هر ردیف نمایش داده می‌شود.',
    en: 'Expected return / probability are historical observations or stated APY — never guaranteed. Confidence and data quality are shown per row.',
    ar: 'العائد والاحتمال ملاحظات تاريخية أو نسبة APY معلنة — وليست مضمونة أبداً. تظهر الثقة وجودة البيانات لكل صف.'
  },

  /* ---- Order card -------------------------------------------------------- */
  'order.conditionalBuy': { fa: 'خرید شرطی',      en: 'conditional buy', ar: 'شراء مشروط' },
  'order.stored':         { fa: 'سفارش واقعی ثبت شد', en: 'Stored real order', ar: 'تم تسجيل أمر حقيقي' },

  /* ---- Bottom menu bar --------------------------------------------------- */
  'menu.multiAi':      { fa: 'هوش چندمدلی',       en: 'Multi-AI',    ar: 'ذكاء متعدد' },

  /* ---- Ecosystem section (agents + strategies) --------------------------- */
  'eco.agents':        { fa: 'ایجنت‌ها',          en: 'Agents',      ar: 'الوكلاء' },
  'eco.strategies':    { fa: 'استراتژی‌ها',       en: 'Strategies',  ar: 'الاستراتيجيات' },
  'eco.loading':       { fa: 'در حال خواندن فهرست…', en: 'Loading the registry…', ar: 'جارٍ تحميل السجل…' },
  'eco.errorTitle':    { fa: 'فهرست خوانده نشد',  en: 'Could not read the registry', ar: 'تعذّرت قراءة السجل' },
  'eco.errorBody': {
    fa: 'درخواست به سرویس فهرست ناموفق بود. این یعنی پاسخی نگرفتیم — نه اینکه چیزی ثبت نشده است.',
    en: 'The request to the registry failed. That means we got no answer — not that nothing is listed.',
    ar: 'فشل الطلب إلى السجل. هذا يعني أننا لم نتلقَّ رداً — لا أنه لا توجد مُدخلات.'
  },
  'eco.retry':         { fa: 'تلاش دوباره',       en: 'Retry',       ar: 'إعادة المحاولة' },
  'eco.unavailableTitle': { fa: 'فهرستی پیکربندی نشده', en: 'No registry configured', ar: 'لا يوجد سجل مُهيّأ' },
  'eco.unavailableBody': {
    fa: 'این نصب هیچ ثبت‌گاه بادوامی ندارد، پس چیزی برای نمایش وجود ندارد.',
    en: 'This installation has no durable registry, so there is nothing to list.',
    ar: 'لا يملك هذا التثبيت سجلاً دائماً، لذا لا يوجد ما يُعرض.'
  },
  'eco.emptyTitle':    { fa: 'هنوز چیزی ثبت نشده', en: 'Nothing listed yet', ar: 'لا توجد مُدخلات بعد' },
  'eco.emptyBody': {
    fa: 'ثبت‌گاه پاسخ داد و خالی است. هنوز کسی چیزی منتشر نکرده.',
    en: 'The registry answered and it is empty. Nobody has published anything yet.',
    ar: 'ردّ السجل وهو فارغ. لم ينشر أحد شيئاً بعد.'
  },
  'eco.loadMore':      { fa: 'بیشتر',             en: 'Load more',   ar: 'تحميل المزيد' },
  'eco.pageError': {
    fa: 'صفحه بعد خوانده نشد. ردیف‌های بالا سر جای خود هستند.',
    en: 'The next page failed to load. The rows above are unaffected.',
    ar: 'فشل تحميل الصفحة التالية. الصفوف أعلاه لم تتأثر.'
  },
  'eco.verified':      { fa: 'گواهی‌شده',         en: 'Certified',   ar: 'مُعتمد' },
  'eco.unverified':    { fa: 'بررسی‌نشده',        en: 'Unreviewed',  ar: 'غير مُراجَع' },
  'eco.staleCert':     { fa: 'گواهی منقضی',       en: 'Certificate expired', ar: 'انتهت الشهادة' },
  'eco.execution':     { fa: 'اجرا',              en: 'Execution',   ar: 'التنفيذ' },
  'eco.mode.manual':   { fa: 'دستی',              en: 'Manual',      ar: 'يدوي' },
  'eco.mode.simulation-only': { fa: 'فقط شبیه‌سازی', en: 'Simulation only', ar: 'محاكاة فقط' },
  'eco.chains':        { fa: 'شبکه‌ها',           en: 'Chains',      ar: 'الشبكات' },
  'eco.approval':      { fa: 'تأیید کاربر',       en: 'User approval', ar: 'موافقة المستخدم' },
  'eco.required':      { fa: 'همیشه لازم',        en: 'Always required', ar: 'مطلوبة دائماً' },
  'eco.withdraw':      { fa: 'برداشت وجه',        en: 'Withdrawals', ar: 'السحوبات' },
  'eco.never':         { fa: 'هرگز',              en: 'Never',       ar: 'أبداً' },
  'eco.trigger':       { fa: 'محرک',              en: 'Trigger',     ar: 'المُشغِّل' },
  'eco.trigger.price':          { fa: 'قیمت',      en: 'Price',           ar: 'السعر' },
  'eco.trigger.time':           { fa: 'زمان',      en: 'Time',            ar: 'الوقت' },
  'eco.trigger.portfolio_drift':{ fa: 'انحراف پرتفوی', en: 'Portfolio drift', ar: 'انحراف المحفظة' },
  'eco.trigger.gas':            { fa: 'کارمزد شبکه', en: 'Gas',           ar: 'رسوم الشبكة' },
  'eco.trigger.manual':         { fa: 'دستی',      en: 'Manual',          ar: 'يدوي' },
  'eco.maxAmount':     { fa: 'سقف مبلغ',          en: 'Max amount',  ar: 'الحد الأقصى للمبلغ' },
  'eco.maxSlippage':   { fa: 'حداکثر لغزش',       en: 'Max slippage', ar: 'أقصى انزلاق' },
  'eco.assets':        { fa: 'دارایی‌ها',         en: 'Assets',      ar: 'الأصول' },
  'eco.notStated':     { fa: 'اعلام نشده',        en: 'Not stated',  ar: 'غير مُحدَّد' },
  'eco.anyChain':      { fa: 'اعلام نشده',        en: 'Not stated',  ar: 'غير مُحدَّد' },
  'eco.automatic':     { fa: 'اجرای خودکار',      en: 'Automatic execution', ar: 'تنفيذ تلقائي' },
  'eco.publisher':     { fa: 'منتشرشده از حساب تلگرام تأییدشده', en: 'Published from a Telegram-verified account', ar: 'مَنشور من حساب تيليجرام مُوثَّق' },
  'eco.homepage':      { fa: 'صفحه پروژه',        en: 'Project page', ar: 'صفحة المشروع' },
  'eco.reputation':    { fa: 'موفقیت مشاهده‌شده', en: 'Observed success', ar: 'نجاح مُلاحَظ' },
  'eco.samples':       { fa: 'نمونه',             en: 'samples',     ar: 'عيّنات' },
  'eco.listNote': {
    fa: 'این فهرست فقط برای مشاهده است. هیچ ایجنت یا استراتژی‌ای از اینجا اجرا، نصب یا امضا نمی‌شود و هیچ‌کدام به دارایی شما دسترسی ندارند.',
    en: 'This list is read-only. Nothing here can be run, installed or signed from this screen, and no listing has access to your funds.',
    ar: 'هذه القائمة للعرض فقط. لا يمكن تشغيل أو تثبيت أو توقيع أي شيء من هذه الشاشة، ولا يملك أي مُدخل صلاحية على أموالك.'
  },
  'eco.limitations':   { fa: 'محدودیت‌های اعلام‌شده', en: 'Stated limitations', ar: 'القيود المعلنة' },
  /* ---- History panel chrome --------------------------------------------- */
  'hist.title':         { fa: 'تاریخچه',      en: 'History',        ar: 'السجل' },
  'hist.conversations': { fa: 'گفتگوها',      en: 'Conversations',  ar: 'المحادثات' },
  'hist.operations':    { fa: 'عملیات',       en: 'Operations',     ar: 'العمليات' },
  'hist.monitoring':    { fa: 'پایش فعال',    en: 'Active Monitoring', ar: 'المراقبة النشطة' },
  'hist.empty':         { fa: 'هنوز چیزی ثبت نشده', en: 'Nothing recorded yet', ar: 'لم يُسجَّل شيء بعد' },
  'hist.continue':      { fa: 'ادامه',        en: 'Continue',       ar: 'متابعة' },
  'hist.close':         { fa: 'بستن',         en: 'Close',          ar: 'إغلاق' },

  /* ---- Status panel chrome ----------------------------------------------- */
  'st.title':       { fa: 'وضعیت Intent OS', en: 'Intent OS Status', ar: 'حالة Intent OS' },
  'st.wallet':      { fa: 'کیف پول',        en: 'Wallet',           ar: 'المحفظة' },
  'st.server':      { fa: 'درگاه AI',       en: 'AI Gateway',       ar: 'بوابة الذكاء' },
  'st.monitors':    { fa: 'پایش‌ها',        en: 'Monitors',         ar: 'المراقبات' },
  'st.orders':      { fa: 'سفارش‌ها',       en: 'Orders',           ar: 'الأوامر' },
  'st.automations': { fa: 'اتوماسیون‌ها',   en: 'Automations',      ar: 'الأتمتة' },
  'st.engine':      { fa: 'موتور پایش',     en: 'Monitor engine',   ar: 'محرك المراقبة' },
  'st.cron':        { fa: 'کرون پس‌زمینه',  en: 'Background cron',  ar: 'مهمة الخلفية' },

  /* ---- Monitor draft form ------------------------------------------------ */
  'mon.title':     { fa: 'ایجاد پایش',  en: 'Create Monitor', ar: 'إنشاء مراقبة' },
  'mon.asset':     { fa: 'دارایی',      en: 'Asset',          ar: 'الأصل' },
  'mon.metric':    { fa: 'شاخص',        en: 'Metric',         ar: 'المؤشر' },
  'mon.operator':  { fa: 'شرط',         en: 'Operator',       ar: 'الشرط' },
  'mon.threshold': { fa: 'آستانه',      en: 'Threshold',      ar: 'العتبة' },
  'mon.interval':  { fa: 'بررسی هر',    en: 'Check every',    ar: 'افحص كل' },
  'mon.create':    { fa: 'ایجاد پایش',  en: 'Create Monitor', ar: 'إنشاء مراقبة' },
  'mon.cancel':    { fa: 'انصراف',      en: 'Cancel',         ar: 'إلغاء' },
  'mon.note': {
    fa: 'سرور این پایش را با قیمت واقعی ارزیابی می‌کند و هر بررسی ثبت می‌شود؛ هیچ شرط ساختگی‌ای وجود ندارد.',
    en: 'The server evaluates this job against live prices and records every check. No fake trigger.',
    ar: 'يقيّم الخادم هذه المهمة مقابل أسعار حيّة ويسجّل كل فحص. لا يوجد أي مُشغِّل وهمي.'
  },

  /* ---- Order draft form -------------------------------------------------- */
  'ord.title':  { fa: 'خرید شرطی',        en: 'Conditional Buy',      ar: 'شراء مشروط' },
  'ord.asset':  { fa: 'دارایی',           en: 'Asset',                ar: 'الأصل' },
  'ord.target': { fa: 'قیمت هدف (دلار)',  en: 'Target price (USD)',   ar: 'السعر المستهدف (دولار)' },
  'ord.amount': { fa: 'مبلغ (دلار)',      en: 'Amount (USD)',         ar: 'المبلغ (دولار)' },
  'ord.create': { fa: 'ایجاد سفارش',      en: 'Create Order',         ar: 'إنشاء أمر' },
  'ord.cancel': { fa: 'انصراف',           en: 'Cancel',               ar: 'إلغاء' },
  'ord.note': {
    fa: 'یک سفارش واقعی در /orders ایجاد می‌شود: سرور قیمت را پایش می‌کند و خبر می‌دهد؛ پر شدن همیشه با امضای شما در صفحه سواپ انجام می‌شود.',
    en: 'Creates a REAL limit watch on /orders: the server watches the price and alerts; the fill is always signed by you at the swap screen.',
    ar: 'يُنشئ مراقبة حدّية حقيقية في /orders: يراقب الخادم السعر ويُنبّه؛ أما التنفيذ فيوقّعه أنت دائماً في شاشة المبادلة.'
  }
};

/**
 * Strings that need a value substituted. Kept as functions rather than
 * `{count}` placeholders because each language puts the number in a different
 * place, and a format string that only works for one word order is how these
 * ended up as inline ternaries in the first place.
 */
export const OPS_PANEL_PHRASES = {
  everyMinutes: {
    fa: (n) => `هر ${n} دقیقه`,
    en: (n) => `every ${n}m`,
    ar: (n) => `كل ${n} دقيقة`
  },
  monitorCount: {
    fa: (a, total) => `${a} فعال از ${total}`,
    en: (a, total) => `${a} active / ${total} total`,
    ar: (a, total) => `${a} نشطة من ${total}`
  },
  goalEstimate: {
    fa: (pct) => `هدف: ${pct}٪ → این تخمین است، نه تضمین`,
    en: (pct) => `Goal: ${pct}% → this is an estimate, never a guarantee`,
    ar: (pct) => `الهدف: ${pct}٪ ← هذا تقدير وليس ضماناً`
  }
};

/** Call one of the phrase builders above for the active locale. */
export function opsPhrase(key, locale, ...args) {
  const row = OPS_PANEL_PHRASES[key];
  if (!row) return '';
  return (row[langOf(locale)] || row.en)(...args);
}

/**
 * Look up one string for the active locale.
 *
 * `locale` is passed straight through from i18next, so it is a full tag like
 * `fa-IR`. `langOf` reduces it to fa/en/ar; anything else lands on English.
 */
export function opsText(key, locale = 'fa') {
  const row = OPS_PANEL_STRINGS[key];
  if (!row) return key;
  return row[langOf(locale)] || row.en || key;
}

/**
 * Every key whose translation is missing for `lang`. Used by the probe so a
 * string added in one language cannot ship half-translated — the exact class
 * of bug this file was created to remove.
 */
export function missingOpsPanelStrings(lang) {
  const out = [];
  for (const [key, row] of Object.entries(OPS_PANEL_STRINGS)) {
    if (!row[lang] || typeof row[lang] !== 'string' || !row[lang].trim()) out.push(key);
  }
  return out;
}

/** The locale tag used for `toLocaleString` number/date formatting. */
export function intlLocale(locale = 'fa') {
  const lang = langOf(locale);
  if (lang === 'en') return 'en-US';
  if (lang === 'ar') return 'ar';
  return 'fa-IR';
}
