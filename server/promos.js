/**
 * NOTIFICATION COPY DECK
 * ---------------------------------------------------------------------------
 * Extracted from push.js so BOTH delivery channels (VAPID web push and FCM)
 * send the same wording. Duplicating this was the obvious shortcut and the
 * wrong one: the two channels would drift, and a user with the PWA and the
 * APK installed would get two differently-worded notifications for the same
 * event.
 *
 * These strings are rendered by the OS notification shade, so the app never
 * gets a chance to translate them — they must already be in the right
 * language when they leave the server.
 */

export const PROMOS = {
  promo1: {
    fa: ['بازار امروز چطور بود؟', 'قیمت زنده بیش از هزار ارز، رایگان و بدون ثبت‌نام.'],
    en: ['How did the market move today?', 'Live prices for a thousand-plus coins, free and with no signup.'],
    ar: ['كيف تحرك السوق اليوم؟', 'أسعار حية لأكثر من ألف عملة مجاناً.']
  },
  promo2: {
    fa: ['سواپ روی ۷ شبکه', 'BNB، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم و آوالانچ — همه از کیف پول خودت.'],
    en: ['Swap across 7 networks', 'BNB, Ethereum, Polygon, Arbitrum, Base, Optimism and Avalanche — all from your own wallet.'],
    ar: ['التبادل على ٧ شبكات', 'من محفظتك مباشرة على سبع شبكات.']
  },
  promo3: {
    fa: ['خبرهای امروز رمزارز', 'خلاصه اخبار مهم بازار، هر ۲۴ ساعت یک بار.'],
    en: ["Today's crypto headlines", 'A digest of what actually moved, once every 24 hours.'],
    ar: ['عناوين اليوم', 'ملخص لما تحرك فعلاً كل ٢٤ ساعة.']
  },
  promo4: {
    fa: ['کیف پولت را پشتیبان گرفتی؟', 'بدون ۱۲ کلمه روی کاغذ، هیچ راهی برای برگرداندن دارایی وجود ندارد.'],
    en: ['Have you backed up your wallet?', 'Without those 12 words on paper there is no way back into your funds.'],
    ar: ['هل نسخت محفظتك احتياطياً؟', 'بدون الكلمات الـ١٢ على ورق لا سبيل لاستعادة أموالك.']
  },
  promo5: {
    fa: ['یاد بگیر، بعد ریسک کن', 'بخش آموزش با اعتبار مجازی — بدون اینکه یک ریال واقعی درگیر شود.'],
    en: ['Learn first, risk later', 'The learning modules run on virtual credits — not a single real coin at risk.'],
    ar: ['تعلّم أولاً', 'وحدات التعلم تعمل برصيد افتراضي بالكامل.']
  },
  promo6: {
    fa: ['بیش از ۱۰۰۰ توکن قابل سواپ', 'جستجو کن، توکن جدید را با آدرس قرارداد اضافه کن، همان‌جا سواپ کن.'],
    en: ['1,000+ tokens to swap', 'Search it, import brand-new tokens by address, swap on the spot.'],
    ar: ['أكثر من ١٠٠٠ عملة', 'ابحث واستورد بالعنوان وبادل فوراً.']
  },
  promo7: {
    fa: ['کارمزد شفاف', '۰.۵٪ کارمزد پلتفرم، قبل از امضا نمایش داده می‌شود. گس جداست و به شبکه می‌رود.'],
    en: ['Transparent fees', '0.5% platform fee, shown before you sign. Gas is separate and goes to the network.'],
    ar: ['رسوم شفافة', '٠٫٥٪ رسوم المنصة تُعرض قبل التوقيع.']
  }
};
