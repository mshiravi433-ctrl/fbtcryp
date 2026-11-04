/**
 * «AI ترید» — product copy (Persian). One module, one voice.
 *
 * Wording rules, enforced by test/hyperliquid-aitrade-units.mjs:
 *   · nothing promises a profit, a guaranteed return or a fill;
 *   · every decision screen says loss is possible and that the user approves;
 *   · the key-entry text always says the MAIN wallet key must not be pasted.
 */

export const AI_TRADE_TAB_LABEL = 'AI ترید';

export const AI_TRADE_COPY = Object.freeze({
  title: 'AI ترید',
  subtitle: 'تحلیل را AI می‌سازد، تصمیم را تو می‌گیری. هیچ سفارشی بدون تأیید تو ارسال نمی‌شود.',
  riskNotice: 'معامله با اهرم می‌تواند تمام سرمایه‌ات را از دست بدهد. تصمیم و امضا با خودت است.',
  statusLabel: Object.freeze({
    locked: 'قفل',
    connected: 'متصل',
    ready: 'آماده',
    stopped: 'توقف اضطراری'
  }),
  autoLock: 'به‌دلیل عدم فعالیت یا خروج از صفحه، کلیدها از حافظه پاک شدند.',
  lockNow: 'قفل کردن و پاک کردن کلیدها',
  lockNotice: 'کلیدها از حافظه پاک شدند. برای ادامه دوباره وصل شو.',
  steps: Object.freeze({
    connect: 'اتصال',
    account: 'حساب',
    limits: 'سقف‌ها',
    ai: 'تحلیل و قوانین',
    approve: 'تأیید',
    report: 'گزارش'
  }),
  needConnect: 'اول در مرحلهٔ «اتصال» حساب را وصل کن.',
  connect: {
    title: 'اتصال حساب',
    help: 'در Hyperliquid یک «API wallet» (کلید agent) بساز. این کلید فقط می‌تواند معامله کند و برداشت ندارد.',
    mainKeyWarning: 'کلید اصلی کیف پول خودت را اینجا وارد نکن. اگر آن را وارد کردی، پاکش کن و کلیدهایت را عوض کن.',
    notStored: 'کلیدها فقط در حافظهٔ این صفحه می‌مانند و ذخیره نمی‌شوند. با قفل شدن یا بستن صفحه پاک می‌شوند.',
    addressLabel: 'آدرس عمومی حساب (0x…)',
    keyLabel: 'کلید agent (0x…)',
    connectBtn: 'اتصال و خواندن حساب',
    connected: 'حساب وصل شد.',
    agentShown: 'کلید agent: ',
    ok: 'فرمت کلید درست است.',
    steps: Object.freeze([
      'در Hyperliquid به بخش API برو و یک API wallet بساز.',
      'آدرس عمومی حساب اصلی‌ات را بگذار.',
      'کلید agent را بگذار؛ همین و بس.'
    ]),
    errors: Object.freeze({
      AGENT_KEY_EMPTY: 'کلیدی وارد نشده است.',
      AGENT_KEY_BAD_FORMAT: 'فرمت کلید درست نیست. باید با 0x شروع شود و ۶۴ کاراکتر هگزادسیمال داشته باشد.',
      AGENT_KEY_ZERO: 'این کلید معتبر نیست.'
    })
  },
  account: {
    title: 'وضعیت حساب',
    refresh: 'به‌روزرسانی',
    unknown: 'نامشخص',
    equity: 'ارزش حساب',
    exposure: 'پوزیشن باز',
    unrealised: 'سود و زیان باز',
    realisedToday: 'تحقق‌یافته امروز',
    dailyUsed: 'زیان امروز از سقف',
    positions: 'پوزیشن‌ها',
    noPositions: 'پوزیشن بازی نیست.',
    updated: 'آخرین خواندن: ',
    stale: 'اطلاعات قدیمی است. دوباره بخوان.',
    errors: Object.freeze({
      HL_BAD_ADDRESS: 'آدرس معتبر نیست.',
      HL_RATE_LIMITED: 'تعداد درخواست‌ها زیاد است. کمی صبر کن.',
      HL_TIMEOUT: 'پاسخ از Hyperliquid دیر رسید.',
      HL_NETWORK: 'اتصال به Hyperliquid برقرار نشد.',
      HL_HTTP_ERROR: 'Hyperliquid خطا برگرداند.',
      HL_BAD_RESPONSE: 'پاسخ قابل‌خواندن نبود.',
      HL_BAD_TYPE: 'درخواست نامعتبر بود.'
    })
  },
  limits: {
    title: 'سقف‌ها',
    total: 'سقف کل باز بودن (دلار)',
    perOrder: 'سقف هر سفارش (دلار)',
    dailyLoss: 'سقف زیان روزانه (دلار)',
    leverage: 'بیشترین اهرم',
    coins: 'بازارهای مجاز',
    stopRule: 'هر سفارش حد ضرر دارد؛ فاصله‌اش حداکثر ۵٪ است و ضرر احتمالی هر سفارش باید در سقف زیان روزانه جا شود. ضرر باز هم حساب می‌شود.',
    killSwitch: 'توقف اضطراری',
    killSwitchHelp: 'روشن که شود، هیچ سفارش جدیدی ارسال نمی‌شود. پوزیشن‌ها و حد ضررهای باز دست‌نخورده می‌مانند.',
    saved: 'سقف‌ها معتبرند و همین حالا برای تأیید سفارش‌ها اعمال می‌شوند.',
    errors: Object.freeze({
      HL_SETTINGS_NOT_A_NUMBER: 'این مقدار عدد نیست.',
      HL_SETTINGS_NOT_POSITIVE: 'این مقدار باید بزرگ‌تر از صفر باشد.',
      HL_SETTINGS_STOP_LOSS_OVER_SYSTEM_LIMIT: 'حد ضرر هر پوزیشن از ۱۰٪ بیشتر است.',
      HL_SETTINGS_ORDER_OVER_SYSTEM_LIMIT: 'سقف هر سفارش از ۲۰٬۰۰۰ دلار بیشتر است.',
      HL_SETTINGS_EXPOSURE_BELOW_ORDER: 'سقف کل نمی‌تواند از سقف هر سفارش کمتر باشد.',
      HL_SETTINGS_LEVERAGE_OVER_SYSTEM_LIMIT: 'اهرم از سقف مجاز محصول بیشتر است.',
      HL_SETTINGS_LEVERAGE_NOT_INTEGER: 'اهرم باید عدد صحیح باشد.',
      HL_SETTINGS_COIN_OUTSIDE_UNIVERSE: 'این بازار در نسخهٔ فعلی مجاز نیست.'
    })
  },
  ai: {
    title: 'تحلیل و قوانین',
    keyLabel: 'کلید AI (BYOK)',
    keyHelp: 'کلید AI خودت. مستقیم از همین مرورگر به ارائه‌دهنده می‌رود و جایی ذخیره نمی‌شود.',
    endpointLabel: 'نشانی ارائه‌دهنده (https)',
    modelLabel: 'نام مدل',
    strategyTitle: 'سبک تحلیل',
    strategies: Object.freeze({
      trend: 'دنبال روند',
      reversion: 'برگشت به میانگین',
      manual: 'فقط وقتی خودم بگویم'
    }),
    maxTrades: 'حداکثر معامله در روز',
    cooldown: 'فاصلهٔ بین دو معامله روی یک بازار (دقیقه)',
    notes: 'یادداشت برای تحلیلگر (اختیاری)',
    notesHint: 'مثلاً: فقط ساعات آمریکا، یا از اخبار بزرگ دوری کن.',
    analyze: 'تحلیل بازار',
    analyzing: 'در حال تحلیل…',
    needAi: 'برای تحلیل، کلید AI و نام مدل را وارد کن.',
    needFresh: 'اول حساب را به‌روز کن، بعد تحلیل بگیر.',
    done: 'پیشنهادها آمادهٔ تأیید هستند.',
    none: 'تحلیلگر در این لحظه سیگنال روشنی ندید. این یعنی معامله نکن.',
    dropped: 'بعضی پیشنهادها به‌خاطر قوانین یا فرمت نامعتبر کنار گذاشته شدند.',
    errors: Object.freeze({
      AI_NOT_HTTPS: 'نشانی ارائه‌دهنده باید https باشد.',
      AI_NO_KEY: 'کلید AI وارد نشده است.',
      AI_NETWORK: 'اتصال به ارائه‌دهندهٔ AI برقرار نشد.',
      AI_HTTP_ERROR: 'ارائه‌دهندهٔ AI خطا برگرداند. کلید یا نام مدل را بررسی کن.',
      AI_TIMEOUT: 'پاسخ AI دیر رسید.',
      AI_BAD_OUTPUT: 'پاسخ AI قابل‌خواندن نبود. هیچ سفارشی ساخته نشد.'
    })
  },
  approve: {
    title: 'صف تأیید',
    empty: 'پیشنهادی برای تأیید نیست.',
    hold: 'نگه دار برای تأیید',
    holdHint: 'نیم ثانیه نگه دار. رها کردن زودهنگام لغو می‌کند.',
    reject: 'رد',
    expires: 'مهلت تأیید: ',
    expired: 'مهلت تمام شد؛ این پیشنهاد دیگر قابل تأیید نیست.',
    side: Object.freeze({ long: 'خرید (long)', short: 'فروش (short)' }),
    labels: Object.freeze({
      notional: 'حجم', margin: 'وثیقه', leverage: 'اهرم', stop: 'حد ضرر تقریبی',
      worst: 'بدترین زیان', rationale: 'دلیل تحلیلگر'
    }),
    blockedBy: 'این پیشنهاد الان قابل تأیید نیست:',
    working: 'در حال ارسال…',
    statusLabels: Object.freeze({
      pending: 'منتظر تأیید',
      executing: 'در حال ارسال',
      executed: 'اجرا شد',
      failed: 'اجرا نشد',
      rejected: 'رد شد',
      expired: 'منقضی شد'
    }),
    errors: Object.freeze({
      ENG_COIN_NOT_ALLOWED: 'این بازار مجاز نیست.',
      ENG_RULE_DAILY_LIMIT: 'سقف معامله‌های امروز پر شده است.',
      ENG_RULE_COOLDOWN: 'هنوز زمان فاصلهٔ این بازار نرسیده است.',
      HL_CAP_KILL_SWITCH: 'توقف اضطراری روشن است.',
      HL_CAP_COIN_NOT_ALLOWED: 'این بازار مجاز نیست.',
      HL_CAP_ORDER_TOO_LARGE: 'حجم از سقف هر سفارش بیشتر است.',
      HL_CAP_EXPOSURE_EXCEEDED: 'با این سفارش از سقف کل باز بودن رد می‌شوی.',
      HL_CAP_LEVERAGE_TOO_HIGH: 'اهرم از سقف بیشتر است.',
      HL_CAP_DAILY_LOSS_REACHED: 'سقف زیان روزانه پر شده است.',
      HL_CAP_STOP_LOSS_MISSING: 'حد ضرر ندارد.',
      HL_CAP_STOP_LOSS_TOO_WIDE: 'حد ضرر از ۵٪ بیشتر است.',
      HL_CAP_STOP_LOSS_OVER_BUDGET: 'اگر حد ضرر بخورد، از سقف زیان امروز رد می‌شوی.',
      HL_CAP_BAD_INPUT: 'اطلاعات حساب کامل نیست؛ اول حساب را به‌روز کن.'
    })
  },
  exec: Object.freeze({
    HL_EXEC_CAPS_REFUSED: 'سقف‌ها این سفارش را نپذیرفتند. چیزی ارسال نشد.',
    HL_EXEC_UNKNOWN_MARKET: 'این بازار در Hyperliquid پیدا نشد.',
    HL_EXEC_NO_PRICE: 'قیمت لحظه‌ای نرسید. چیزی ارسال نشد.',
    HL_EXEC_TOO_SMALL: 'حجم از حداقل سفارش Hyperliquid کمتر است.',
    HL_EXEC_LEVERAGE_FAILED: 'تنظیم اهرم انجام نشد. هیچ سفارشی ثبت نشد.',
    HL_EXEC_NOT_FILLED: 'سفارش پر نشد و چیزی باز نشد.',
    HL_EXEC_STOP_FAILED_CLOSED: 'حد ضرر ثبت نشد، پس پوزیشن همان لحظه بسته شد.',
    HL_EXEC_STOP_FAILED_OPEN: 'هشدار: حد ضرر ثبت نشد و بستن پوزیشن هم انجام نشد. همین الان در Hyperliquid بررسی کن.',
    HL_EXEC_NETWORK: 'اتصال قطع شد؛ وضعیت را در Hyperliquid بررسی کن.',
    HL_EXEC_REJECTED: 'Hyperliquid درخواست را رد کرد.',
    HL_RATE_LIMITED: 'تعداد درخواست‌ها زیاد است. کمی صبر کن.',
    HL_TIMEOUT: 'پاسخ دیر رسید؛ وضعیت را در Hyperliquid بررسی کن.',
    HL_HTTP_ERROR: 'Hyperliquid خطا برگرداند.'
  }),
  report: {
    title: 'گزارش',
    empty: 'هنوز سفارشی ثبت نشده.',
    executed: 'اجراشده امروز',
    realised: 'سود و زیان تحقق‌یافتهٔ امروز (پس از کارمزد)',
    fees: 'کارمزد امروز',
    fills: 'تعداد پرشدن‌ها',
    refresh: 'به‌روزرسانی گزارش',
    disclaimer: 'این گزارش فقط سوابق این نشست را نشان می‌دهد. سود یا زیان در گذشته تضمینی برای آینده نیست.',
    stopLine: 'حد ضرر: ',
    entryLine: 'ورود: '
  }
});
