# مسیرِ بدون قرارداد برای مشتریانِ ترکیه و امارات — نقشهٔ اجرا

> تاریخ: **۲۰۲۶/۱۰/۱۱** · انتخابِ کاربر: **سناریو ۱ (بدون قرارداد / بدون KYB)** · بازارِ هدف: **ترکیه + امارات**
> این سند **طرح و چک‌لیست** است؛ هیچ کدی در `src/` یا `server/` تغییر نکرده.

---

## ۱) چه چیزی از قبل در مخزن دارید (و چرا این مسیر ارزان است)

| موجودی | فایل | یعنی چه |
|---|---|---|
| ریلِ handoff بدون کلید | `src/lib/guidedCheckout.js` | کاربر را به صفحهٔ **عمومیِ خودِ Ramp** می‌فرستد؛ هیچ کلیدِ شریکی در کار نیست |
| گزارشِ روی زنجیره | `src/lib/buySellWatch.js` + `WalletWatchReport.jsx` | تنها سیگنالِ صادقِ بعد از handoff: دلتای موجودیِ کیف پول |
| مرزِ ادعا | `src/lib/intent-ai/fiatRampBoundary.js` | `RAMP_SUPPORTED = false` ⇒ AI حق ندارد وعدهٔ رمپ بدهد |
| سیاستِ منطقه‌ای | `src/lib/intent-ai/regionalCompliance.js` | **AE مجاز است**؛ **TR امروز روی `fiat-onramp` مسدود است** |

پس سناریو ۱ یعنی: **همین ریل را از یک ارائه‌دهنده به یک «نقشهٔ کشور → ارائه‌دهنده» تعمیم بدهید**
+ شناسهٔ افیلیت بگذارید. نه وب‌هوک می‌خواهد، نه قرارداد، نه KYB.

**انگیزهٔ مالیِ پنهان:** مستنداتِ خودتان می‌گوید امروز «no Ramp partner fee is configured».
یعنی رمپِ فعلی **هیچ درآمدی** ندارد. با افیلیت، این مسیر از روزِ اول درآمد می‌سازد.

---

## ۲) واقعیت‌های بازارِ هدف (این بخش تعیین‌کننده است)

### 🇹🇷 ترکیه — سخت‌گیرانه، و فعلاً نباید اولویت باشد

- از مارس ۲۰۲۵، فعالیت به‌عنوان **CASP نیازمند مجوز از CMB** (هیئت بازار سرمایه) است؛
  متخلف «غیرقانونی» تلقی می‌شود [1](https://www.legal500.com/developments/thought-leadership/the-legal-regime-of-crypto-assets-in-turkey-and-the-role-of-regulatory-institutions/).
- مقرراتِ MASAK (۲۰۲۵): احراز هویت برای تراکنش‌های بالای ۱۵٬۰۰۰ لیر (~۳۶۰ دلار)،
  یادداشتِ اجباری برای هر انتقال، **تأخیرِ برداشت ۴۸ ساعت (۷۲ ساعت برای برداشتِ اول)**،
  و سقفِ انتقالِ استیبل‌کوین **۳٬۰۰۰ دلار روزانه / ۵۰٬۰۰۰ دلار ماهانه**
  (با رعایتِ کاملِ Travel Rule دو برابر می‌شود) [2](https://finance.yahoo.com/news/turkey-authorities-power-freeze-crypto-124843511.html) ·
  [3](https://coincentral.com/turkey-tightens-crypto-regulations-to-combat-money-laundering-and-illegal-betting/).

**برداشتِ عملیاتی:** این محدودیت‌ها **ارائه‌دهنده را هدف می‌گیرند، نه شما** — اما یعنی
هر ادعای سقف/زمان در UI شما اگر از منبعِ زنده نیاید، غلط است. و سیاستِ فعلیِ مخزن
(`TR → fiat-onramp مسدود`) تصمیمِ محافظه‌کارانه و دفاع‌پذیری است.
**پیشنهاد: ترکیه را فعلاً همان‌طور مسدود نگه دارید تا یک نظرِ حقوقی بگیرید.**

### 🇦🇪 امارات — بهترین نقطهٔ شروع

- امارات از نظرِ رمپ «مجاز» است (در فهرستِ Unsupportedِ Ramp نیست
  [1](https://support.rampnetwork.com/en/articles/433-which-countries-and-us-states-are-unsupported-for-buying-and-selling-crypto))،
  **و `REGION_POLICY` خودتان هم امروز AE را بدون مسدودیت تعریف کرده.**
- نکتهٔ مهم: ارائهٔ خدمات به ساکنان امارات نیازمند مجوزِ **VARA / ADGM-FSRA / DFSA / SCA** است،
  و VARA در مارس 2026 دستورِ توقفِ فعالیتِ پلتفرمِ بدون‌مجوز را صادر کرده
  [3](https://learn.backpack.exchange/articles/best-crypto-exchanges-uae-dubai).
  ⇒ **فقط به ارائه‌دهنده‌ای لینک بدهید که در امارات مجوز/پوششِ قانونی دارد.**
- ریلِ AED بالغ است: بایننس از ژوئن ۲۰۲۶ انتقالِ بانکیِ درهم را از طریقِ **Roma** (دارای مجوزِ VARA)
  فعال کرده [1](https://thearabianpost.com/binance-deepens-uae-crypto-access/)؛ OKX، Rain (ADGM)،
  BitOasis و Crypto.com هم AED دارند [2](https://cryptonews.com/cryptocurrency/best-crypto-exchange-uae/).

---

## ۳) جدولِ نامزدها برای نقشهٔ «کشور → ارائه‌دهنده»

ستونِ «وضعیت» صادقانه است: ✅ تأییدشده از منبعِ عمومی · ⚠️ باید زنده چک شود.

| ارائه‌دهنده | TRY | AED | نیاز به قرارداد؟ | وضعیت | نکته |
|---|---|---|---|---|---|
| **Ramp** (linک فعلی) | ⚠️ | ⚠️ | خیر (لینک عمومی) | ✅ پوششِ کلی | ۱۵۰+ کشور و ۴۰+ ارز فیات [2](https://rampnetwork.com/buy-crypto)؛ ترکیه و امارات در فهرستِ Unsupported نیستند — **اما تک‌تکِ TRY/AED باید با کاتالوگِ زنده چک شود** |
| **Mercuryo** | ✅ | ✅ | خیر برای لینک | ✅ تأییدشده | صریحاً هم AED و هم TRY را برای on/off-ramp فهرست کرده [5](https://b2bhelp.mercuryo.io/hc/en-gb/articles/31974438200861-What-fiat-currencies-does-Mercuryo-support-for-on-off-ramp) |
| **Onramp Money** | ✅ | ✅ | خیر برای لینک | ✅ تأییدشده | صریحاً INR/TRY/AED/MXN/VND؛ ۲۲ ارز فیات، ۷۵+ کشور [1](https://onramp.money/) |
| **ChangeNOW** | ⚠️ | ⚠️ | خیر | ✅ برنامهٔ افیلیت | لینکِ ریفرال / ویجت / API، بدون هزینهٔ ادغام، بخشِ Buy/Sell [1](https://changenow.io/program-affiliate) |
| **Swapzone** | ⚠️ | ⚠️ | خیر | ✅ برنامهٔ افیلیت | تا ۵۰٪ RevShare روی لینک/ویجت/API [3](https://swapzone.io/partners/referral-program) |
| **Transak / MoonPay / Coinbase / Stripe** | ✅ | ✅ | **بله** | ⛔ خارج از این مسیر | برای سناریو ۲ می‌مانند |
| **HodlHodl / Bisq / RoboSats** | ✅ | ✅ | خیر | ✅ همین الان | BTC و P2P بدون KYC؛ پوششِ جهانی، مناسبِ fallback |

**قاعدهٔ انتخاب (پیشنهادی، بدون کد):**
`کشور = AE` → اگر ارائه‌دهنده در امارات مجوز/پوشش دارد → Mercuryo/Onramp Money/Ramp؛
در غیر این صورت → سقوط به P2P. `کشور = TR` → تا وقتِ نظرِ حقوقی، فقط P2P.

---

## ۴) سه قانونِ ادعا (تغییرناپذیر — برای هر ارائه‌دهندهٔ جدید هم)

1. **«پرداخت تأیید شد» ممنوع.** بدون وب‌هوکِ امضاشده + رسیدِ on-chain، تنها جملهٔ مجاز همان
   است که امروز دارید: «واریز/برداشت روی زنجیره دیده شد — با جهتِ سفارش شما هم‌خوان است؛
   وضعیتِ پرداخت نزدِ ارائه‌دهنده از دید ما پیدا نیست.»
2. **هیچ دور زدنی.** جعلِ کشور، VPN، هویتِ دستکاری‌شده، یا ادامه دادن بعد از رد شدنِ
   ارائه‌دهنده — همان خط قرمزی که `BUY-SELL-INTEGRATION.md` نوشته.
3. **قیمت/سقف/زمان فقط از منبعِ زنده.** سقف‌های ترکیه (۳٬۰۰۰$/روز) را هیچ‌جا در UI
   hard-code نکنید؛ یا از ارائه‌دهنده بخوانید یا اصلاً ننویسید.

---

## ۵) چک‌لیستِ قبل از فعال کردنِ هر ردیف (همه‌اش دستی و قابل انجام در یک روز)

برای هر ارائه‌دهنده این ۵ تا را پر کنید و تاریخ بزنید:

- [ ] صفحهٔ رسمی‌اش می‌گوید **این کشور** را پوشش می‌دهد (نه حدس، نه مقالهٔ ثالث).
- [ ] **این ارز (TRY/AED)** در فهرستِ ارزهایش هست.
- [ ] مسیرِ KYC/پرداخت واقعاً روی سایتِ خودش کامل می‌شود (نه ریدایرکتِ ناقص).
- [ ] **برنامهٔ افیلیت/پارتنر** دارد و نرخ و شرایطِ پرداخت را کتبی گرفته‌اید.
- [ ] شرایطِ استفاده‌اش **لینک‌دهی/ارجاع** را منع نکرده است.

سؤال‌هایی که باید ایمیل کنید: نرخِ RevShare · حداقلِ پرداخت و دوره‌اش · آیا sub-id
دارید (برای تفکیکِ ترافیکِ ما) · آیا لینک‌دهی از یک دامنهٔ ایرانی مشکلی دارد ·
آیا در امارات/ترکیه مجوز دارد.

---

## ۶) ترتیبِ پیشنهادیِ اجرا

| گام | کار | وابسته به | خروجی |
|---|---|---|---|
| ۱ | گرفتنِ Partner ID از Mercuryo و Onramp Money + ChangeNOW/Swapzone (همه رایگان) | — | شناسه‌ها آماده |
| ۲ | پر کردنِ جدولِ چک‌لیستِ بخش ۵ برای AE | گام ۱ | ردیف‌های «تأییدشده برای امارات» |
| ۳ | **فقط امارات** را به نقشه اضافه کنید (AE از قبل در `REGION_POLICY` مجاز است) | گام ۲ | اولین کشورِ زنده |
| ۴ | اندازه‌گیریِ دو هفته‌ای: کلیک → تکمیل، نرخِ تشخیصِ دلتا، نرخِ شکایت | گام ۳ | عددِ واقعیِ تبدیل |
| ۵ | **ترکیه فقط بعد از نظرِ حقوقی** دربارهٔ رژیمِ CASP/MASAK | نظرِ حقوقی | تصمیمِ TR |
| ۶ | P2P (HodlHodl/Bisq) را به‌عنوان fallbackِ همه‌جا نصب کنید | — | پوشش برای کشورهای ردشده |

---

## ۷) آنچه این مسیر **حل نمی‌کند** (صادقانه)

- **فروش (off-ramp) همچنان تقریباً بسته است.** اکثرِ برنامه‌های افیلیت روی «خرید»
  متمرکزند؛ برای فروشِ واقعی باید سناریو ۲ (موجودیتِ حقوقی + قرارداد) را بروید.
- **وب‌هوک ندارید** ⇒ سفارش در سیستم شما هیچ‌وقت به «تأیید‌شده» نمی‌رسد؛ فقط
  «روی زنجیره دیده شد». این محدودیت را در UI و در چتِ AI باید صریح نوشت.
- **وابستگی به ارائه‌دهندهٔ ثالث:** اگر فردا صفحهٔ عمومی‌اش را عوض کند، لینک می‌شکند
  (دقیقاً همان بلایی که سرِ `buy.ramp.network` آمد). ⇒ یک **بررسیِ دوره‌ایِ لینک**
  لازم است، شبیه چیزی که الان برای Ramp دارید.
- **درآمدِ افیلیت کوچک است**؛ این مسیر برای «داشتنِ یک رمپِ صادق و درآمدِ پایه» خوب است،
  نه برای تبدیل شدن به موتورِ اصلیِ درآمد.

---

## ۸) منابع

- مقرراتِ ترکیه (CMB/CASP + MASAK): [1](https://www.legal500.com/developments/thought-leadership/the-legal-regime-of-crypto-assets-in-turkey-and-the-role-of-regulatory-institutions/) · [2](https://finance.yahoo.com/news/turkey-authorities-power-freeze-crypto-124843511.html) · [3](https://coincentral.com/turkey-tightens-crypto-regulations-to-combat-money-laundering-and-illegal-betting/)
- امارات (VARA و ریلِ AED): [3](https://learn.backpack.exchange/articles/best-crypto-exchanges-uae-dubai) · [1](https://thearabianpost.com/binance-deepens-uae-crypto-access/) · [2](https://cryptonews.com/cryptocurrency/best-crypto-exchange-uae/)
- Ramp (پوشش و کشورهای Unsupported): [2](https://rampnetwork.com/buy-crypto) · [1](https://support.rampnetwork.com/en/articles/433-which-countries-and-us-states-are-unsupported-for-buying-and-selling-crypto)
- Mercuryo (AED و TRY): [5](https://b2bhelp.mercuryo.io/hc/en-gb/articles/31974438200861-What-fiat-currencies-does-Mercuryo-support-for-on-off-ramp)
- Onramp Money (TRY/AED): [1](https://onramp.money/)
- افیلیت: [1](https://changenow.io/program-affiliate) · [3](https://swapzone.io/partners/referral-program)
