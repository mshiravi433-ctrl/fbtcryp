/**
 * «AI ترید» — product copy (Persian). Kept in one module, like perpAutoCopy.js.
 *
 * Wording rules, enforced by test/hyperliquid-aitrade-units.mjs:
 *   · nothing promises a profit, a guaranteed return or a fill;
 *   · every screen states that loss is possible and that the user signs;
 *   · the key-entry text always says the MAIN wallet key must not be pasted.
 */

export const AI_TRADE_TAB_LABEL = 'AI ترید';

export const AI_TRADE_COPY = Object.freeze({
  title: 'AI ترید',
  subtitle: 'حساب خودت را ببین، سقف‌هایت را تنظیم کن. هیچ سفارشی بدون تأیید تو ارسال نمی‌شود.',
  riskNotice: 'معامله با اهرم می‌تواند تمام سرمایه‌ات را از دست بدهد. تصمیم و امضا با خودت است.',
  geoNotice: 'اگر در کشوری هستی که این صرافی یا خدمات آن در آن‌جا محدود است، استفاده از این بخش برای تو ممنوع یا پرخطر است. مسئولیت رعایت قوانین با خودت است.',
  phases: Object.freeze({
    connect: 'اتصال',
    account: 'حساب',
    limits: 'محدودیت‌ها',
    ai: 'هوش مصنوعی',
    rules: 'قوانین و پیش‌نمایش',
    approvals: 'تأیید و گزارش'
  }),
  connect: {
    help: 'در Hyperliquid یک «API wallet» (کلید agent) بساز. این کلید فقط می‌تواند معامله کند و برداشت ندارد.',
    mainKeyWarning: 'کلید اصلی کیف پول خودت را اینجا وارد نکن. اگر آن را وارد کردی، پاکش کن و کلیدهایت را عوض کن.',
    notStored: 'در این نسخه کلید ذخیره نمی‌شود. فقط فرمتش بررسی می‌شود.',
    ok: 'فرمت کلید درست است.',
    errors: Object.freeze({
      AGENT_KEY_EMPTY: 'کلیدی وارد نشده است.',
      AGENT_KEY_BAD_FORMAT: 'فرمت کلید درست نیست. باید با 0x شروع شود و ۶۴ کاراکتر هگزادسیمال داشته باشد.',
      AGENT_KEY_ZERO: 'این کلید معتبر نیست.'
    })
  },
  account: {
    addressLabel: 'آدرس عمومی کیف پول (0x…)',
    addressHint: 'فقط آدرس عمومی. هرگز کلید خصوصی یا عبارت بازیابی وارد نکن.',
    read: 'خواندن حساب',
    unknown: 'نامشخص',
    errors: Object.freeze({
      HL_BAD_ADDRESS: 'آدرس معتبر نیست.',
      HL_RATE_LIMITED: 'تعداد درخواست‌ها زیاد است. کمی صبر کن.',
      HL_TIMEOUT: 'پاسخ از Hyperliquid دیر رسید.',
      HL_NETWORK: 'اتصال به Hyperliquid برقرار نشد.',
      HL_HTTP_ERROR: 'Hyperliquid خطا برگرداند.',
      HL_BAD_RESPONSE: 'پاسخ قابل‌خواندن نبود.'
    })
  },
  limits: {
    total: 'سقف کل باز بودن (دلار)',
    perOrder: 'سقف هر سفارش (دلار)',
    dailyLoss: 'سقف زیان روزانه (دلار)',
    leverage: 'بیشترین اهرم',
    coins: 'بازارهای مجاز',
    killSwitch: 'توقف اضطراری',
    killSwitchHelp: 'با روشن شدن، هیچ سفارشی پذیرفته نمی‌شود.',
    saved: 'تنظیمات معتبرند. فعلاً فقط روی این صفحه اعمال شده‌اند.',
    errors: Object.freeze({
      HL_SETTINGS_NOT_A_NUMBER: 'این مقدار عدد نیست.',
      HL_SETTINGS_NOT_POSITIVE: 'این مقدار باید بزرگ‌تر از صفر باشد.',
      HL_SETTINGS_ORDER_OVER_SYSTEM_LIMIT: 'سقف هر سفارش از ۲۰٬۰۰۰ دلار بیشتر است.',
      HL_SETTINGS_EXPOSURE_BELOW_ORDER: 'سقف کل نمی‌تواند از سقف هر سفارش کمتر باشد.',
      HL_SETTINGS_LEVERAGE_OVER_SYSTEM_LIMIT: 'اهرم از سقف مجاز محصول بیشتر است.',
      HL_SETTINGS_LEVERAGE_NOT_INTEGER: 'اهرم باید عدد صحیح باشد.',
      HL_SETTINGS_COIN_OUTSIDE_UNIVERSE: 'این بازار در نسخهٔ فعلی مجاز نیست.'
    })
  },
  comingSoon: Object.freeze({
    tag: 'نسخهٔ بعدی',
    ai: 'اتصال هوش مصنوعی (BYOK یا MCP) در نسخهٔ بعدی اضافه می‌شود.',
    rules: 'ساخت قانون و پیش‌نمایش روی قیمت واقعی در نسخهٔ بعدی اضافه می‌شود.',
    approvals: 'صف تأیید سفارش و گزارش در نسخهٔ بعدی اضافه می‌شود.'
  })
});
