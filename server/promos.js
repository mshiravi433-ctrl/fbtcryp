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

/**
 * The platform fee, for the one promo that quotes it.
 *
 * The server cannot import `src/lib/feeBps.js` — that module reads
 * `import.meta.env`, which only exists inside the Vite bundle. So the rate is
 * mirrored here from `FEE_BPS` in the environment, with the same 70 bps
 * default and the same 100 bps cap.
 *
 * Keeping the two in step matters: this string is rendered by the OS
 * notification shade, so a stale number reaches the user as a push telling
 * them a price the app does not charge. That is exactly the bug this replaced
 * — the copy said 0.5% while every swap took 0.70%.
 */
const FEE_BPS = (() => {
  const n = Number(process.env.FEE_BPS ?? process.env.VITE_FEE_BPS);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : 70;
})();

const FEE_PCT = String(Number((FEE_BPS / 100).toFixed(2)));
const FEE_PCT_FA = FEE_PCT.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).replace('.', '٫');
const FEE_PCT_AR = FEE_PCT.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]).replace('.', '٫');

export const PROMOS = {
  promo1: {
    fa: ['بازار امروز چطور بود؟', 'قیمت زنده بیش از هزار ارز، رایگان و بدون ثبت‌نام.'],
    en: ['How did the market move today?', 'Live prices for a thousand-plus coins, free and with no signup.'],
    ar: ['كيف تحرك السوق اليوم؟', 'أسعار حية لأكثر من ألف عملة مجاناً.']
  },
  promo2: {
    fa: ['سواپ روی ۱۰ شبکه', 'BNB، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک و سولانا — همه از کیف پول خودت.'],
    en: ['Swap across 10 networks', 'BNB, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic and Solana — all from your own wallet.'],
    ar: ['التبادل على ١٠ شبكات', 'من محفظتك مباشرة على عشر شبكات.']
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
    fa: ['کارمزد شفاف', `${FEE_PCT_FA}٪ کارمزد پلتفرم، قبل از امضا نمایش داده می‌شود. گس جداست و به شبکه می‌رود.`],
    en: ['Transparent fees', `${FEE_PCT}% platform fee, shown before you sign. Gas is separate and goes to the network.`],
    ar: ['رسوم شفافة', `${FEE_PCT_AR}٪ رسوم المنصة تُعرض قبل التوقيع.`]
  }
};
