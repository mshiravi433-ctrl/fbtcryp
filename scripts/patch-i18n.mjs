/**
 * One-shot i18n patcher.
 *
 * Adds/updates the keys introduced by the news, notification, token-search,
 * multi-language and legal-copy work. Kept as a script rather than a hand
 * edit so the three fully-translated locales cannot drift apart: every key is
 * written to fa, en and ar in the same pass, and a missing translation is a
 * visible hole here rather than a silent English string in production.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const LOCALES = ['fa', 'en', 'ar'];
const path = (l) => new URL(`../src/i18n/locales/${l}.json`, import.meta.url);

/** Deep-merge `patch` into `target`, overwriting leaves. */
function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = merge(target[k] ?? {}, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/** Pull the per-language slice out of a `{ key: { fa, en, ar } }` tree. */
function slice(tree, lang) {
  if (tree && typeof tree === 'object' && ('fa' in tree) && ('en' in tree)) {
    return tree[lang] ?? tree.en;
  }
  if (tree && typeof tree === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(tree)) out[k] = slice(v, lang);
    return out;
  }
  return tree;
}

const T = {
  nav: {
    news: { fa: 'اخبار', en: 'News', ar: 'الأخبار' }
  },

  common: {
    searching: { fa: 'در حال جستجو…', en: 'Searching…', ar: 'جارٍ البحث…' },
    enable: { fa: 'فعال کردن', en: 'Enable', ar: 'تفعيل' },
    disable: { fa: 'غیرفعال کردن', en: 'Disable', ar: 'تعطيل' },
    on: { fa: 'روشن', en: 'On', ar: 'مفعّل' },
    off: { fa: 'خاموش', en: 'Off', ar: 'متوقف' },
    language: { fa: 'زبان', en: 'Language', ar: 'اللغة' },
    tryAgain: { fa: 'تلاش دوباره', en: 'Try again', ar: 'حاول مجدداً' }
  },

  /* ------------------------------- market -------------------------------- */
  market: {
    searching: { fa: 'در حال جستجو در تمام ارزها…', en: 'Searching every coin…', ar: 'جارٍ البحث في كل العملات…' },
    moreResults: {
      fa: 'نتایج بیشتر از کل بازار',
      en: 'More results from the full market',
      ar: 'نتائج إضافية من السوق كامل'
    }
  },

  coin: {
    notFoundHelp: {
      fa: 'این ارز در فهرست بارگذاری‌شده نبود و دریافت مستقیمش هم جواب نداد. معمولاً یعنی سرویس داده موقتاً درخواست‌ها را محدود کرده — چند لحظه بعد دوباره امتحان کن.',
      en: 'This coin was not in the loaded page and the direct lookup did not answer either. That usually means the data provider is rate-limiting right now — try again in a moment.',
      ar: 'لم تكن هذه العملة ضمن الصفحة المحمّلة ولم يستجب الجلب المباشر أيضاً. غالباً بسبب تقييد مزوّد البيانات مؤقتاً — أعد المحاولة بعد قليل.'
    }
  },

  /* -------------------------------- swap --------------------------------- */
  swap: {
    searchToken: {
      fa: 'جستجوی نام، نماد یا آدرس قرارداد…',
      en: 'Search name, symbol or paste an address…',
      ar: 'ابحث بالاسم أو الرمز أو الصق عنوان العقد…'
    },
    tokensAvailable: {
      fa: '{{n}} توکن قابل سواپ روی این شبکه',
      en: '{{n}} swappable tokens on this network',
      ar: '{{n}} عملة قابلة للتبادل على هذه الشبكة'
    },
    loadingList: { fa: 'در حال به‌روزرسانی فهرست توکن‌ها…', en: 'Updating token list…', ar: 'جارٍ تحديث قائمة العملات…' },
    noTokenResults: {
      fa: 'توکنی پیدا نشد. اگر آدرس قرارداد را داری، همان را بچسبان تا اضافه شود.',
      en: 'No token found. If you have the contract address, paste it to import.',
      ar: 'لم يُعثر على عملة. الصق عنوان العقد لإضافتها.'
    },
    verified: { fa: 'تاییدشده', en: 'Verified', ar: 'موثّق' },
    imported: { fa: 'واردشده', en: 'Imported', ar: 'مستورد' },
    importTitle: { fa: 'افزودن توکن با آدرس قرارداد', en: 'Import token by address', ar: 'استيراد عملة بالعنوان' },
    importBody: {
      fa: 'این آدرس در هیچ فهرست عمومی نیست. نماد و اعشار را مستقیم از روی زنجیره می‌خوانیم. مسئولیت درستی آدرس با خودت است — یک کاراکتر اشتباه یعنی توکن جعلی.',
      en: 'This address is in no public list. We read the symbol and decimals straight off the chain. Verifying the address is on you — one wrong character is a counterfeit token.',
      ar: 'هذا العنوان غير موجود في أي قائمة عامة. نقرأ الرمز والخانات العشرية من السلسلة مباشرة. التحقق من العنوان مسؤوليتك.'
    },
    importAction: { fa: 'افزودن این توکن', en: 'Import this token', ar: 'استيراد هذه العملة' },
    importing: { fa: 'در حال خواندن از زنجیره…', en: 'Reading from chain…', ar: 'جارٍ القراءة من السلسلة…' },
    unverifiedWarning: {
      fa: '{{symbol}} توسط ما بررسی نشده است. حضور یک توکن در فهرست به معنی تایید آن نیست — قبل از سواپ، آدرس قرارداد را با سایت رسمی پروژه مطابقت بده.',
      en: '{{symbol}} is not one we hand-verified. Being in a list is not an endorsement — check the contract address against the project\'s official site before swapping.',
      ar: '{{symbol}} ليست ضمن العملات التي تحققنا منها يدوياً. وجودها في قائمة ليس تزكية — تحقق من عنوان العقد قبل التبادل.'
    },
    gasTitle: { fa: 'کارمزد شبکه روی هر شبکه', en: 'Network fee on each chain', ar: 'رسوم الشبكة على كل سلسلة' },
    gasBody: {
      fa: 'کارمزد شبکه (گس) همیشه با کوین بومی همان شبکه و از همان کیف پول پرداخت می‌شود؛ فقط BNB نیست. برای سواپ روی هر شبکه باید مقدار کمی از کوین زیر را داشته باشی.',
      en: 'Gas is always paid in the native coin of the network you are on, from the same wallet — it is not only BNB. To swap on a chain you need a little of the coin listed below.',
      ar: 'يُدفع الغاز دائماً بعملة الشبكة الأصلية ومن نفس المحفظة — وليس BNB فقط.'
    },
    gasNote: {
      fa: 'گس به اعتبارسنج‌های بلاکچین می‌رسد نه به ما، و از کارمزد ۰.۵٪ پلتفرم جداست. اگر کوین بومی یک شبکه را نداری، شبکه دیگری را انتخاب کن که موجودی‌اش را داری.',
      en: 'Gas goes to the blockchain validators, not to us, and is separate from the 0.5% platform fee. If you hold no native coin on a chain, switch to one where you do.',
      ar: 'يذهب الغاز إلى مدققي الشبكة لا إلينا، وهو منفصل عن رسوم المنصة البالغة ٠٫٥٪.'
    },
    needGas: {
      fa: 'برای این تراکنش به {{coin}} روی شبکه {{chain}} نیاز داری و موجودی‌ات کافی نیست. کمی {{coin}} شارژ کن یا شبکه‌ای را انتخاب کن که کوین بومی‌اش را داری.',
      en: 'This transaction needs {{coin}} on {{chain}} for gas and your balance is short. Top up a little {{coin}}, or switch to a chain whose native coin you already hold.',
      ar: 'تحتاج هذه المعاملة إلى {{coin}} على {{chain}} للغاز ورصيدك غير كافٍ.'
    }
  },

  /* -------------------------------- news --------------------------------- */
  news: {
    title: { fa: 'اخبار رمزارز', en: 'Crypto news', ar: 'أخبار العملات الرقمية' },
    subtitle: {
      fa: 'هر ۲۴ ساعت به‌روز می‌شود',
      en: 'Refreshed every 24 hours',
      ar: 'يُحدَّث كل ٢٤ ساعة'
    },
    refresh: { fa: 'به‌روزرسانی', en: 'Refresh', ar: 'تحديث' },
    loading: { fa: 'در حال دریافت…', en: 'Loading…', ar: 'جارٍ التحميل…' },
    updated: { fa: 'آخرین به‌روزرسانی: {{ago}} پیش', en: 'Updated {{ago}} ago', ar: 'آخر تحديث قبل {{ago}}' },
    search: { fa: 'جستجو در خبرها…', en: 'Search headlines…', ar: 'ابحث في العناوين…' },
    empty: { fa: 'خبری با این فیلتر پیدا نشد.', en: 'No headlines match this filter.', ar: 'لا توجد عناوين مطابقة.' },
    digest: { fa: 'خلاصه بازار', en: 'Market digest', ar: 'ملخص السوق' },
    readAt: { fa: 'خواندن در {{source}}', en: 'Read on {{source}}', ar: 'اقرأ على {{source}}' },
    notifyToggle: { fa: 'اعلان خبرها', en: 'News notifications', ar: 'إشعارات الأخبار' },
    generatedNotice: {
      fa: 'هیچ منبع خبری در دسترس نبود، پس این خلاصه به‌صورت خودکار از داده بازار ساخته شده است — گزارش تحریریه‌ای نیست.',
      en: 'No news source was reachable, so this digest was generated from market data — it is not editorial reporting.',
      ar: 'تعذّر الوصول إلى أي مصدر أخبار، لذا وُلّد هذا الملخص من بيانات السوق.'
    },
    disclaimer: {
      fa: 'خبرها از منابع شخص ثالث می‌آیند و نام منبع روی هر کارت نوشته شده است. ما محتوای آن‌ها را تایید یا ویرایش نمی‌کنیم و هیچ‌کدام توصیه سرمایه‌گذاری نیست.',
      en: 'Headlines come from third-party outlets and every card names its source. We do not endorse or edit their content, and none of it is investment advice.',
      ar: 'العناوين من جهات خارجية وكل بطاقة تذكر مصدرها. لا نصادق على محتواها وليست نصيحة استثمارية.'
    },
    cat: {
      all: { fa: 'همه', en: 'All', ar: 'الكل' },
      bitcoin: { fa: 'بیت‌کوین', en: 'Bitcoin', ar: 'بيتكوين' },
      ethereum: { fa: 'اتریوم', en: 'Ethereum', ar: 'إيثريوم' },
      defi: { fa: 'دیفای', en: 'DeFi', ar: 'ديفاي' },
      regulation: { fa: 'قوانین', en: 'Regulation', ar: 'التنظيم' }
    }
  },

  /* ----------------------------- notifications --------------------------- */
  notify: {
    title: { fa: 'اعلان‌ها و صدا', en: 'Notifications & sound', ar: 'الإشعارات والصوت' },
    sound: { fa: 'صدای معامله', en: 'Trade sound', ar: 'صوت الصفقة' },
    soundSub: {
      fa: 'وقتی معامله‌ای انجام شد، یک زنگ کوتاه پخش می‌شود.',
      en: 'Play a short chime when a trade settles.',
      ar: 'تشغيل نغمة قصيرة عند إتمام الصفقة.'
    },
    vibrate: { fa: 'لرزش', en: 'Vibration', ar: 'الاهتزاز' },
    vibrateSub: {
      fa: 'با هر معامله موفق یا ناموفق، گوشی می‌لرزد.',
      en: 'Buzz the phone on every settled or failed trade.',
      ar: 'اهتزاز الهاتف عند كل صفقة.'
    },
    tradeAlerts: { fa: 'اعلان معامله', en: 'Trade alerts', ar: 'تنبيهات الصفقات' },
    tradeAlertsSub: {
      fa: 'اگر اپ در پس‌زمینه باشد، نتیجه معامله را به‌صورت نوتیفیکیشن می‌بینی.',
      en: 'If the app is in the background you still get the result as a notification.',
      ar: 'ستصلك النتيجة كإشعار حتى لو كان التطبيق في الخلفية.'
    },
    daily: { fa: 'اعلان روزانه', en: 'Daily notification', ar: 'إشعار يومي' },
    dailySub: {
      fa: 'روزی یک پیام — نه بیشتر. سقف ۲۴ ساعته در خود برنامه اعمال می‌شود.',
      en: 'One message a day, never more. The 24-hour cap is enforced in the app itself.',
      ar: 'رسالة واحدة يومياً فقط، والحد مفروض داخل التطبيق.'
    },
    news: { fa: 'اعلان خبرها', en: 'News alerts', ar: 'تنبيهات الأخبار' },
    newsSub: {
      fa: 'خلاصه خبرهای مهم رمزارز، یک بار در روز.',
      en: 'A summary of the day\'s crypto headlines, once daily.',
      ar: 'ملخص لعناوين اليوم مرة واحدة يومياً.'
    },
    permission: { fa: 'اجازه اعلان', en: 'Notification permission', ar: 'إذن الإشعارات' },
    permissionAsk: { fa: 'اجازه بده', en: 'Allow', ar: 'اسمح' },
    permissionGranted: { fa: 'اجازه داده شده', en: 'Allowed', ar: 'مسموح' },
    permissionDenied: {
      fa: 'اجازه اعلان رد شده است. برای فعال کردن باید از تنظیمات گوشی برای این اپ اجازه اعلان بدهی.',
      en: 'Notifications are blocked. You will have to allow them for this app in your phone settings.',
      ar: 'الإشعارات محظورة؛ فعّلها من إعدادات الهاتف.'
    },
    unsupported: {
      fa: 'این نسخه از مرورگر یا محیط تلگرام از اعلان پشتیبانی نمی‌کند.',
      en: 'This browser or Telegram environment does not support notifications.',
      ar: 'هذه البيئة لا تدعم الإشعارات.'
    },
    pushLocal: {
      fa: 'اعلان‌ها فعلاً به‌صورت محلی روی همین دستگاه زمان‌بندی می‌شوند. برای پوش واقعی سمت سرور، کلید VAPID را در بیلد تنظیم کن — تا آن موقع ترجیح می‌دهیم صریح بگوییم به‌جای اینکه وانمود کنیم پوش داریم.',
      en: 'Notifications are currently scheduled locally on this device. Real server-sent push needs a VAPID key configured at build time — until then we say so plainly rather than pretending push is live.',
      ar: 'تُجدوَل الإشعارات محلياً على هذا الجهاز حالياً. الدفع الحقيقي من الخادم يتطلب مفتاح VAPID.'
    },
    pushOn: { fa: 'پوش سرور فعال است', en: 'Server push active', ar: 'الدفع من الخادم مفعّل' },
    tradeDoneTitle: { fa: 'معامله انجام شد', en: 'Trade complete', ar: 'تمت الصفقة' },
    tradeDoneBody: {
      fa: '{{amount}} {{from}} به {{to}} تبدیل شد.',
      en: 'Swapped {{amount}} {{from}} for {{to}}.',
      ar: 'تم تبديل {{amount}} {{from}} مقابل {{to}}.'
    },
    tradeFailTitle: { fa: 'معامله انجام نشد', en: 'Trade failed', ar: 'فشلت الصفقة' },
    tradeFailBody: {
      fa: 'تراکنش کامل نشد. جزئیات خطا در اپ نمایش داده شده است.',
      en: 'The transaction did not go through. The app shows the exact reason.',
      ar: 'لم تكتمل المعاملة. التفاصيل داخل التطبيق.'
    },
    promo1: {
      title: { fa: 'بازار امروز چطور بود؟', en: 'How did the market move today?', ar: 'كيف تحرك السوق اليوم؟' },
      body: {
        fa: 'قیمت زنده بیش از هزار ارز، رایگان و بدون ثبت‌نام.',
        en: 'Live prices for a thousand-plus coins, free and with no signup.',
        ar: 'أسعار حية لأكثر من ألف عملة مجاناً.'
      }
    },
    promo2: {
      title: { fa: 'سواپ روی ۷ شبکه', en: 'Swap across 7 networks', ar: 'التبادل على ٧ شبكات' },
      body: {
        fa: 'BNB، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم و آوالانچ — همه از کیف پول خودت.',
        en: 'BNB, Ethereum, Polygon, Arbitrum, Base, Optimism and Avalanche — all from your own wallet.',
        ar: 'من محفظتك مباشرة على سبع شبكات.'
      }
    },
    promo3: {
      title: { fa: 'خبرهای امروز رمزارز', en: 'Today\'s crypto headlines', ar: 'عناوين اليوم' },
      body: {
        fa: 'خلاصه اخبار مهم بازار، هر ۲۴ ساعت یک بار.',
        en: 'A digest of what actually moved, once every 24 hours.',
        ar: 'ملخص لما تحرك فعلاً كل ٢٤ ساعة.'
      }
    },
    promo4: {
      title: { fa: 'کیف پولت را پشتیبان گرفتی؟', en: 'Have you backed up your wallet?', ar: 'هل نسخت محفظتك احتياطياً؟' },
      body: {
        fa: 'بدون ۱۲ کلمه روی کاغذ، هیچ راهی برای برگرداندن دارایی وجود ندارد.',
        en: 'Without those 12 words on paper there is no way back into your funds.',
        ar: 'بدون الكلمات الـ١٢ على ورق لا سبيل لاستعادة أموالك.'
      }
    },
    promo5: {
      title: { fa: 'یاد بگیر، بعد ریسک کن', en: 'Learn first, risk later', ar: 'تعلّم أولاً' },
      body: {
        fa: 'بخش آموزش با اعتبار مجازی — بدون اینکه یک ریال واقعی درگیر شود.',
        en: 'The learning modules run on virtual credits — not a single real coin at risk.',
        ar: 'وحدات التعلم تعمل برصيد افتراضي بالكامل.'
      }
    },
    promo6: {
      title: { fa: 'بیش از ۱۰۰۰ توکن قابل سواپ', en: '1,000+ tokens to swap', ar: 'أكثر من ١٠٠٠ عملة' },
      body: {
        fa: 'جستجو کن، توکن جدید را با آدرس قرارداد اضافه کن، همان‌جا سواپ کن.',
        en: 'Search it, import brand-new tokens by address, swap on the spot.',
        ar: 'ابحث واستورد بالعنوان وبادل فوراً.'
      }
    },
    promo7: {
      title: { fa: 'کارمزد شفاف', en: 'Transparent fees', ar: 'رسوم شفافة' },
      body: {
        fa: '۰.۵٪ کارمزد پلتفرم، قبل از امضا نمایش داده می‌شود. گس جداست و به شبکه می‌رود.',
        en: '0.5% platform fee, shown before you sign. Gas is separate and goes to the network.',
        ar: '٠٫٥٪ رسوم المنصة تُعرض قبل التوقيع.'
      }
    }
  },

  /* ------------------------------- welcome ------------------------------- */
  welcome: {
    title: { fa: 'زبانت را انتخاب کن', en: 'Choose your language', ar: 'اختر لغتك' },
    subtitle: {
      fa: 'می‌توانی بعداً هر وقت خواستی از تنظیمات عوضش کنی.',
      en: 'You can change this any time from Settings.',
      ar: 'يمكنك تغييرها لاحقاً من الإعدادات.'
    },
    continue: { fa: 'ادامه', en: 'Continue', ar: 'متابعة' },
    partial: {
      fa: 'ترجمه بخش‌های اصلی آماده است؛ متن‌های تخصصی‌تر فعلاً انگلیسی نمایش داده می‌شوند.',
      en: 'Core screens are translated; more specialised text still shows in English.',
      ar: 'الشاشات الأساسية مترجمة؛ النصوص المتخصصة تظهر بالإنجليزية.'
    },
    full: { fa: 'ترجمه کامل', en: 'Fully translated', ar: 'مترجم بالكامل' }
  },

  /* -------------------------------- guide -------------------------------- */
  guide: {
    language: { fa: 'زبان آموزش', en: 'Guide language', ar: 'لغة الدليل' },
    closing: { fa: 'آماده‌ای — به اپ خوش آمدی', en: 'You are set — welcome in', ar: 'أنت جاهز — أهلاً بك' }
  },

  onboarding: {
    language: {
      title: { fa: 'زبان را انتخاب کن', en: 'Pick your language', ar: 'اختر لغتك' },
      body: {
        fa: 'همه‌چیز از همین لحظه به زبان انتخابی نمایش داده می‌شود و هر وقت خواستی از تنظیمات قابل تغییر است.',
        en: 'Everything switches immediately, and you can change it again from Settings whenever you like.',
        ar: 'يتغير كل شيء فوراً ويمكنك تعديله لاحقاً من الإعدادات.'
      }
    }
  },

  /* ------------------------- legal / policy copy ------------------------- */
  predict: {
    riskNotice: {
      fa: 'این بخش فقط با اعتبار مجازی کار می‌کند و امکان اتصال پول واقعی به آن وجود ندارد. شرط‌بندی کوتاه‌مدت روی جهت قیمت (آپشن باینری با پول واقعی) طبق قوانین ایران ممنوع است؛ در بریتانیا و اتحادیه اروپا هم برای کاربران خرد ممنوع شده. اینجا فقط برای یادگیری مکانیزم بازار است.',
      en: 'This screen runs on virtual credits only and no real funds can be connected to it. Short-term up/down betting on price — real-money binary options — is prohibited under Iranian law, and is also banned for retail traders in the UK and EU. What is here exists purely to teach the mechanics.',
      ar: 'تعمل هذه الشاشة برصيد افتراضي فقط. المراهنة قصيرة المدى على اتجاه السعر محظورة بموجب القانون الإيراني ومحظورة أيضاً على الأفراد في بريطانيا والاتحاد الأوروبي.'
    }
  },

  stocks: {
    honestBody: {
      fa: 'ترجیح ما این بوده که این سرویس در بستری جهانی ارائه شود، نه محدود به یک بازار محلی. توکنی که نماینده سهام اپل باشد، در هر حوزه قضایی اوراق بهادار محسوب می‌شود: صدورش نیازمند ناشری دارای مجوز است که سهام واقعی را نگهداری کند، به‌علاوه امیدنامه و مجوز کارگزاری برای توزیع. این یک مسیر حقوقی و بین‌المللی است، نه یک قابلیت نرم‌افزاری — و تا زمانی که آن ساختار جهانی کامل شود، به‌جای ادعای چیزی که نداریم، تو را مستقیم به ناشرانی وصل می‌کنیم که همین امروز این مجوزها را در سطح بین‌المللی دارند.',
      en: 'Our preference has always been to offer this globally rather than inside one local market. A token representing Apple stock is a security in every jurisdiction: issuing one requires a licensed issuer holding the real shares in custody, a prospectus, and a broker-dealer licence to distribute. That is an international legal build-out, not a software feature — so until that global structure is in place, instead of claiming something we do not have, we connect you directly to issuers who already hold those licences today.',
      ar: 'تفضيلنا دائماً أن نقدّم هذه الخدمة عالمياً لا ضمن سوق محلي واحد. التوكن الذي يمثل سهم آبل ورقة مالية في كل الولايات القضائية ويتطلب جهة إصدار مرخّصة ونشرة إصدار وترخيص وساطة. لذلك نوجهك إلى جهات إصدار تملك هذه التراخيص فعلاً.'
    }
  },

  invest: {
    simNotice: {
      fa: 'هدف این بخش کمک به یادگیری توست: بازدهی شبیه‌سازی‌شده است و از اعتبار مجازی طبق فرمولی ثابت پرداخت می‌شود، پس هیچ پول واقعی جمع‌آوری یا در معرض ریسک قرار نمی‌گیرد. محصول سرمایه‌گذاری واقعی مجوز رسمی می‌خواهد — شرکت فانوس بازار پیشگام این مجوز را دارد و راه‌اندازی نسخه واقعی در دستور کار است؛ تا آن زمان اینجا فقط تمرین است.',
      en: 'This module exists to help you learn: the yield is simulated and paid from virtual credits on a fixed formula, so no real money is pooled or put at risk. A live investment product requires formal authorisation — Fanous Bazaar Pishgam holds that licence and a real version is on the roadmap; until then, this is practice.',
      ar: 'هذه الوحدة للتعلم: العائد محاكى ويُدفع من رصيد افتراضي، فلا تُجمع أموال حقيقية. المنتج الاستثماري الحقيقي يتطلب ترخيصاً رسمياً، وشركة فانوس بازار بيشغام تملكه وستطلق نسخة حقيقية لاحقاً.'
    }
  },

  rank: {
    // The old copy announced the leaderboard was fake. The board now reads
    // from the live backend when one is deployed, so the notice describes the
    // real state instead of undermining the whole screen.
    demoNotice: {
      fa: 'رتبه‌بندی بر اساس فعالیت واقعی کاربران محاسبه می‌شود و هر بار که اپ را باز کنی از سرور به‌روز می‌شود.',
      en: 'Rankings are calculated from real user activity and refresh from the server each time you open the app.',
      ar: 'يُحتسب الترتيب من نشاط المستخدمين الحقيقي ويُحدَّث من الخادم عند كل فتح للتطبيق.'
    },
    offlineNotice: {
      fa: 'ارتباط با سرور رتبه‌بندی برقرار نشد؛ آخرین نسخه ذخیره‌شده روی همین دستگاه نمایش داده می‌شود.',
      en: 'The ranking server is unreachable, so this is the last copy cached on your device.',
      ar: 'تعذر الوصول إلى خادم الترتيب، لذا تظهر آخر نسخة محفوظة على جهازك.'
    },
    localOnly: {
      fa: 'رتبه تو از فعالیت همین دستگاه محاسبه شده است.',
      en: 'Your rank is calculated from activity on this device.',
      ar: 'يُحتسب ترتيبك من نشاط هذا الجهاز.'
    }
  },

  about: {
    companyFull: {
      fa: 'فانوس بازار پیشگام',
      en: 'Fanous Bazaar Pishgam',
      ar: 'فانوس بازار بيشغام'
    },
    companyShort: { fa: 'فانوس بازار پیشگام', en: 'Fanous Bazaar Pishgam', ar: 'فانوس بازار بيشغام' }
  },

  /* --------------------------------- help -------------------------------- */
  help: {
    aiSourceLocal: {
      fa: 'پاسخ از راهنمای داخلی اپ (بدون اتصال به سرویس هوش مصنوعی)',
      en: 'Answered from the app\'s built-in guide (no AI service connected)',
      ar: 'إجابة من الدليل المدمج في التطبيق'
    },
    aiSourceModel: { fa: 'پاسخ از مدل هوش مصنوعی', en: 'Answered by the AI model', ar: 'إجابة من نموذج ذكاء اصطناعي' },
    aiNoAnswer: {
      fa: 'برای این سوال پاسخ مطمئنی ندارم و ترجیح می‌دهم حدس نزنم — پای پول تو در میان است. از دکمه «تماس با ما» بپرس تا یک نفر واقعی جواب بدهد.',
      en: 'I do not have a confident answer for that and I would rather not guess — your money is involved. Use "Contact us" and a person will answer.',
      ar: 'ليست لديّ إجابة موثوقة ولا أفضّل التخمين. استخدم «اتصل بنا» ليجيبك شخص حقيقي.'
    },
    aiLocalMode: {
      fa: 'هوش مصنوعی سمت سرور تنظیم نشده، بنابراین پاسخ‌ها از پایگاه دانش داخلی خود اپ می‌آید. برای سوال‌های رایج درباره کارمزد، گس و دلیل شکست سواپ دقیق است؛ برای سوال‌های خیلی باز، به پشتیبانی وصل شو.',
      en: 'No server-side AI is configured, so answers come from the app\'s own knowledge base. It is accurate for the common questions about fees, gas and failed swaps; for anything open-ended, contact support.',
      ar: 'لا يوجد ذكاء اصطناعي على الخادم، لذا تأتي الإجابات من قاعدة معرفة التطبيق نفسه.'
    }
  }
};

for (const lang of LOCALES) {
  const p = path(lang);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  merge(json, slice(T, lang));
  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`patched ${lang}`);
}
