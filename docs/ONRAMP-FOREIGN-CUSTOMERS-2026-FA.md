# خرید/فروش با کارت برای مشتریانِ خارج از کشور — بررسی گزینه‌ها

> تاریخ: **۲۰۲۶/۱۰/۱۱** · مبنا: بازرسیِ مستقیمِ همین مخزن + منابع عمومیِ هر ارائه‌دهنده
> این سند **تحلیل و تصمیم** است، نه کد. هیچ تغییری در `src/` یا `server/` ایجاد نشده.

---

## ۰) جوابِ کوتاه

**بله، از نظرِ فنی ده‌ها ارائه‌دهنده هست** — MoonPay، Transak، Mercuryo، Banxa، Wert، Alchemy Pay،
Paybis، Guardarian، Coinbase (CDP Onramp)، Stripe/Bridge، Sardine، Zerohash و از همه مهم‌تر
**تجمیع‌کننده‌هایی مثل Onramper** که با یک ادغام به ۳۰+ رمپ وصلتان می‌کنند.

**اما گلوگاه شما «نبودِ ارائه‌دهنده» نیست.** دو مانعِ دیگر دارید:

1. **KYBِ شخصیت حقوقی شما** — ارائه‌دهنده باید «شرکتِ شما» را تأیید کند، نه فقط کاربر را.
   Onramper صریحاً می‌گوید: باید شخص حقوقیِ ثبت‌شده داشته باشید، مدارک ثبت را بفرستید،
   KYB میان ۳ تا ۷ روز کاری طول می‌کشد و حق اشتراک دارد [1](https://docs.onramper.com/docs/step-by-step-guide).
   ارائه‌دهندگانِ دارای مجوزِ آمریکا/اروپا/بریتانیا عملاً نمی‌توانند با شرکتِ ثبت‌شده در ایران قرارداد
   ببندند، و بقیه هم در KYB غربالِ تحریم دارند (و اساساً راهی برای واریزِ درآمدِ شما ندارند).
2. **کشورِ کاربر** — برای مشتریِ خارجی این مانع حل است، اما باید بدانید هر رمپ فهرستِ
   سیاهِ خودش را دارد (مثلاً Ramp و MoonPay هر دو ایران را پشتیبانی نمی‌کنند
   [1](https://support.rampnetwork.com/en/articles/433-which-countries-and-us-states-are-unsupported-for-buying-and-selling-crypto) ·
   [1](https://support.moonpay.com/en/articles/380968-moonpay-s-unsupported-countries)).

**«مثلِ یونیسواپ» هم همین مدل است:** یونیسواپ خودش کارت نمی‌کشد. در فوریهٔ ۲۰۲۵ با
Robinhood، MoonPay و Transak برای خرید/فروش در ۱۸۰+ کشور همکاری کرد — یعنی «ویجتِ
دیگری را جاسازی کن + سهمِ درآمد بگیر» [4](https://cointelegraph.com/news/uniswap-partners-robinhood-moonpay-transak-turn-crypto-cash).
دقیقاً همان کاری که شما با Ramp کرده‌اید.

بنابراین سه مسیرِ واقعی دارید که در بخش ۵ آمده است.

---

## ۱) وضعیتِ فعلی در کد (شواهد، نه حدس)

| قطعه | فایل | وضعیت |
|---|---|---|
| تنها ارائه‌دهندهٔ فیات | `server/buySell.js:202` — `ProviderRegistry.providers = [RampNetworkHostedCheckoutProvider]` | فقط Ramp |
| حالتِ پیکربندی‌نشده | `src/lib/guidedCheckout.js` | دیپ‌لینک به `app.rampnetwork.com/landing` با کلیدِ عمومیِ **خودِ Ramp**، نه کلیدِ شریک |
| فروش (Off-ramp) | `.env.example` → `RAMP_ENABLED_FLOWS` | پیش‌فرض فقط ONRAMP؛ بدون تأییدِ Ramp، Sell صادقانه `SELL_UNAVAILABLE` است |
| P2P | `server/hodlhodl.js` + `src/components/P2PMarket.jsx` | بازارِ BTC با escrow مولتی‌سیگ، بدون KYC، درآمد از referral |
| شاپ/گیفت‌کارت | `src/lib/shopLinks.js` + `server/shop.js` | CryptoRefills به‌عنوان Merchant of Record |
| پایِ ایرانی | `server/iranBuy.js` | زرین‌پال (تومان) + والکس (OTC) برای کاربرِ داخل ایران |

**دو نکتهٔ مهم از همین کد:**

- معماری از قبل **چندارائه‌دهنده‌ای** طراحی شده: `ProviderRegistry` یک آرایه است و
  `ProviderRouter` بین‌شان مسیریابی می‌کند. اضافه کردنِ ارائه‌دهندهٔ دوم/سوم از نظرِ
  مهندسی کارِ کوچکی است — مشروط به اینکه همان قراردادهای سخت‌گیرانه را رعایت کند
  (capability → quote → hosted checkout → وب‌هوکِ امضاشده → تأییدِ مستقلِ on-chain).
- امروز **هیچ کارمزدِ شریکی برای رمپ تنظیم نشده**: سندِ خودتان می‌گوید
  «no Ramp partner fee is configured». یعنی حتی اگر Ramp کاملاً پیکربندی شود،
  رمپ امروز **درآمدی برای شما ندارد**. این نکته در بخش ۵ مهم می‌شود.

---

## ۲) چرا این‌جا فقط «لینک‌دهی» دارید

دلیلش تنبلیِ طراحی نیست؛ سه واقعیتِ بیرونی است:

1. **Ramp با شرکتِ ایرانی قرارداد نمی‌بندد** (و نه هیچ ارائه‌دهندهٔ دارای مجوزِ غربی).
   مخزنِ شما همین را صادقانه پذیرفته: «Production onboarding requires Ramp's own
   partner/KYB approval… this repository ships the architecture; it does not and cannot
   ship eligibility.»
2. **مشتریِ داخل ایران** با این ریل‌ها کار نمی‌کند — ایران در فهرستِ Unsupportedِ
   Ramp و MoonPay هست [1](https://support.rampnetwork.com/en/articles/433-which-countries-and-us-states-are-unsupported-for-buying-and-selling-crypto) ·
   [1](https://support.moonpay.com/en/articles/380968-moonpay-s-unsupported-countries).
3. **قانونِ خودِ شما جعل را ممنوع کرده**: «no country spoofing, no identity
   manipulation, no falsified company location, no bypass of a provider rejection».
   این خط قرمز را در ادامه هم حفظ می‌کنیم.

---

## ۳) جدولِ گزینه‌ها

### الف) ارائه‌دهندگانِ مستقیم (نیاز به قرارداد + KYBِ شرکت)

| ارائه‌دهنده | خرید/فروش | پوشش | رویِ دیگرِ سکه | واقع‌بینی برای شما |
|---|---|---|---|---|
| **Onramper** (تجمیع‌کننده) | هر دو | ۳۰+ رمپ، ۱۳۰+ روش پرداخت، ۸۰۰+ دارایی؛ مسیریابی خودکار برای بهترین نرخ/پذیرش [1](https://docs.onramper.com/docs/getting-started) | خودش کارت پردازش نمی‌کند؛ KYC را ارائه‌دهندهٔ زیرین انجام می‌دهد | **با شخصیت حقوقی خارجی، بهترین نقطهٔ شروع**: یک قرارداد، N رمپ، کمترین نگه‌داری |
| **MoonPay** | هر دو | ۱۶۰+ کشور، headless و hosted، کارت/اپل‌پی/گوگل‌پی/ACH/SEPA [4](https://www.moonpay.com/business/ramps) | کارمزد تا ۴.۵٪؛ پشتیبانی ضعیف | نیاز به موجودیتِ غیرتحریمی |
| **Transak** | هر دو | ۱۲۵–۱۶۰ کشور؛ قدرت در UPI/PIX/SEPA Instant [5](https://paybis.com/blog/transak-alternatives/) | نگه‌داشتنِ وجه در سفارش‌های ناموفق | خوب برای ترافیکِ بازارهای نوظهور |
| **Mercuryo** | هر دو | ۱۴۰+ کشور، کارت ~۳.۹۵٪، SEPA ~۱.۹۵٪ [1](https://eco.com/support/en/articles/15210390-best-stablecoin-onramps-2026-moonpay-transak-coinbase-onramp-compared) | تمرکزِ اروپایی | خوب برای مشتریِ اروپایی |
| **Banxa** | عمدتاً خرید | ۱۳۰+ کشور؛ قوی در استرالیا (POLi/PayID) و کانادا (Interac) | کارمزد متغیر، بعضاً بالا | مکمل |
| **Wert** | خرید (off-ramp در نقشهٔ راه) | ۱۸۰+ کشور و همهٔ ایالت‌های آمریکا؛ مجوز در آمریکا و اروپا [2](https://hemi.xyz/blog/hemi-and-wert-unite-to-enable-fiat-onramps-for-programmable-bitcoin) | تا ~۱٬۰۰۰$ بدون آپلود مدرک (KYC مبتنی بر ریسک)؛ ۴٪ کارمزد + تا ۱٪ قابلِ افزودن برای شما [1](https://grokipedia.com/page/Wert) | onboarding دستی و قراردادِ شریک لازم است |
| **Alchemy Pay** | هر دو | ۱۷۳ کشور، ۵۰+ ارز فیات، ۳۰۰+ روش پرداخت [1](https://alchemypay.org/news-and-press/core-onboards-alchemy-pay-as-ramp-service-provider-within-its-ecosystem)، مجوزها در لیتوانی/کانادا/استرالیا و MTL در آمریکا [4](https://alchemypay.org/news-and-press/alchemy-pay-achieves-austrac-approval-as-digital-currency-exchange-provider-in-australia) | تمرکز آسیا/آفریقا/لاتام | جالب اگر ترافیکِ شما غیرغربی است |
| **Coinbase CDP Onramp** | خرید (off-ramp محدود) | کشورهای عملیاتیِ کوین‌بیس جز ژاپن؛ کارت در ۹۰+ کشور | **Guest Checkout در ۳۰ ژوئن ۲۰۲۶ منسوخ شد** → باید Headless API [1](https://docs.cdp.coinbase.com/onramp/additional-resources/faq) | برای کاربرِ آمریکایی/اروپایی عالی |
| **Stripe Crypto Onramp / Bridge** | خرید (+off-ramp از طریق Bridge) | آمریکا + ۳۰+ کشور؛ ~۱.۵٪ + ۰.۳۰$ | فعلاً عمدتاً برای کسب‌وکارهای آمریکایی [1](https://stripe.com/blog/everything-we-announced-at-sessions-2026) | دور از دسترس تا وقتی موجودیتِ آمریکایی ندارید |
| **Paybis / Guardarian / Simplex / TransFi** | هر دو | ۱۸۰+ کشور (Paybis با مجوزهای MiCA/PSD2 و FCA) [3](https://paybis.com/blog/the-top-7-best-crypto-onramp-solutions/) | تنوعِ کیفیت | گزینه‌های پشتیبان |

### ب) مسیرِ **بدون قرارداد** (امروز قابل اجرا، بدون KYBِ شرکت)

این‌ها امتدادِ مستقیمِ همان «guided handoff» فعلیِ شما هستند: کاربر به سایتِ
ارائه‌دهنده می‌رود، آن‌جا KYC می‌دهد، شما کمیسیون می‌گیرید.

| سرویس | شکل | نکته |
|---|---|---|
| **ChangeNOW** | لینکِ ریفرال / ویجت / Exchange API | بدون هزینهٔ ادغام، راه‌اندازیِ فوری، Buy/Sell دارد [1](https://changenow.io/program-affiliate) |
| **Swapzone** | لینک / ویجت / API | تا ۵۰٪ RevShare؛ بخشِ Buy/Sell از طریق ارائه‌دهندگانِ مورد اعتماد [3](https://swapzone.io/partners/referral-program) |
| **Changelly / SimpleSwap / StealthEX** | ویجت + افیلیت | پوششِ ارز بالا؛ کیفیتِ پشتیبانی متغیر |
| **HodlHodl** | referralِ سرور-ساید | همین الان در مخزن دارید؛ ۰.۷۵٪ → ۰.۵٪ برای کاربرِ ارجاعی |

### ج) ریل‌های P2P / غیرامانی (برای هر کسی که از KYC رد می‌شود)

| سرویس | مدل | محدودیت |
|---|---|---|
| **HodlHodl** | escrow ۲-از-۳، بدون KYC، ۱۰۰+ ارز فیات | فقط BTC؛ در آمریکا در دسترس نیست |
| **Bisq** | کاملاً غیرمتمرکز، بدون اپراتور | دسکتاپ، منحنیِ یادگیری، نقدینگیِ کم |
| **RoboSats** | لایتنینگ، هویتِ یک‌بارمصرف | سقف ~۱٬۴۰۰$ در هر معامله |
| **Peach Bitcoin / NoOnes / LocalCoinSwap / Mostro** | موبایل‌محور، KYC اختیاری | نقدینگی و پوششِ کشور متغیر [1](https://koinly.io/blog/top-no-kyc-crypto-exchanges/) |

---

## ۴) یک نکتهٔ حقوقیِ صریح (و خط قرمزها)

- **ساختنِ یک شرکتِ واقعی در یک حوزهٔ غیرتحریمی** (با مدیر، حساب بانکی و فعالیتِ واقعی)
  یک ساختارِ حقوقیِ مرسوم و مشروع است **اگر شفاف باشد**: ارائه‌دهنده باید از ساختار گروه
  مطلع شود و خودِ شرکت واقعاً وجود داشته باشد.
- **این چیزها را پیشنهاد نمی‌کنم و مخزن شما هم ممنوع کرده**: جعلِ کشور یا هویت،
  شرکتِ صوری برای پنهان کردنِ مالکیتِ واقعی، دور زدنِ رد شدنِ یک ارائه‌دهنده،
  یا گفتنِ «پرداخت تأیید شد» بدون وب‌هوکِ امضاشده + تأییدِ on-chain.
- **MiCA دارد فضا را سخت‌تر می‌کند، نه آسان‌تر** (ارائه‌دهندگانِ اروپایی از ۲۰۲۵/۲۰۲۶
  CASP شدند؛ Ramp مجوزِ MiCA را ژانویهٔ ۲۰۲۶ گرفت [3](https://paybis.com/blog/the-top-7-best-crypto-onramp-solutions/)).
  هر تصمیمِ جدی را با وکیلِ انطباق/حقوقی جلو ببرید — من مشاور حقوقی نیستم.

---

## ۵) سه سناریو — با هزینه، زمان و ریسک

### سناریو ۱ — «چندرمپیِ بدون قرارداد» (همین هفته · بدون هیچ KYB · ریسکِ حقوقی ≈ صفر)
guided handoff را از «فقط Ramp» به «هر کشور، بهترین رمپِ در دسترس» تعمیم بدهید و
لینک‌های افیلیت را اضافه کنید.
- ✅ امروز اجرا می‌شود و **برخلافِ وضعیتِ فعلی، درآمد می‌سازد** (الان کارمزدِ شریکیِ رمپ صفر است).
- ⚠️ وب‌هوک ندارید ⇒ فقط می‌توانید بگویید «واریز/برداشت روی زنجیره دیده شد»،
  نه «پرداخت تأیید شد». این دقیقاً با قانونِ فعلیِ `src/lib/buySellWatch.js` سازگار است — چیزی را جعل نمی‌کنید.

### سناریو ۲ — «شخصیت حقوقی خارجی + یک تجمیع‌کننده» (راهِ محصولِ واقعی · ۲–۴ ماه)
۱) موجودیت در حوزهٔ غیرتحریمی → ۲) **Onramper** به‌عنوان لایهٔ اصلی (یک قرارداد، ۳۰+ رمپ،
مسیریابی خودکار برای نرخِ تبدیل بهتر) → ۳) یک رمپ مستقیم (Transak یا MoonPay) به‌عنوان پشتیبان.
- ✅ این مسیر برای اولین بار **فروش (off-ramp) واقعی** هم می‌دهد که امروز بسته است.
- ⚠️ وابسته به نتیجهٔ KYB؛ و باید شفاف و با مشورتِ حقوقی باشد.

### سناریو ۳ — «P2P به‌عنوان لبهٔ بازار» (مکمل، نه جایگزین)
برای کاربری که هیچ رمپی قبولش نمی‌کند (از جمله کاربرِ داخلِ ایران)، HodlHodl را از
«نمایش بازار» به «مسیرِ پیش‌فرضِ کشورهای unsupported» ارتقا دهید و Bisq/RoboSats/NoOnes
را به‌عنوان خروجی اضافه کنید.
- ⚠️ طبق یادداشتِ خودِ `server/hodlhodl.js`: درآمدِ این مسیر حدود **۲۵ برابر کمتر** از
  سواپِ خودتان است. مکمل است، نه موتورِ درآمد.

---

## ۶) دو گیرِ فنی که باید در هر سناریویی حل شود

1. **`src/lib/intent-ai/regionalCompliance.js` فقط EU/GB/US/TR/AE را می‌شناسد.**
   بقیهٔ دنیا → `DEFAULT` → **`fiat-onramp` و `fiat-offramp` مسدود**. یعنی برای
   «مشتریِ خارجی» امروز سیاستِ سخت‌گیرانه اعمال می‌شود و عملاً رمپ برای اکثر کشورها بسته است.
   هر سناریویی که بروید، این جدول باید برای کشورهای هدف تکمیل شود.
2. **`src/lib/intent-ai/fiatRampBoundary.js` دارد `RAMP_SUPPORTED = false` را نگه می‌دارد**
   (AI حق ندارد وعدهٔ رمپ بدهد). هر ارائه‌دهندهٔ جدید باید زیرِ همین مرز برود:
   مسیر درست به صفحهٔ Buy است، نه لینکِ پرداختِ شخصِ ثالث در چت.

---

## ۷) پیشنهادِ مرحله‌بندی‌شده

1. **همین حالا:** دقیق کنید مشتریانِ خارجی‌تان در کدام ۳–۵ کشورند (ترکیه؟ امارات؟ آلمان؟
   کانادا؟ هند؟). پوششِ هر رمپ فرق می‌کند و این یک تصمیم، بقیه را تعیین می‌کند.
2. **ماه جاری (بدون قرارداد):** سناریو ۱ + اصلاحِ `REGION_POLICY` برای کشورهای هدف.
3. **موازی:** مشاورهٔ حقوقی برای موجودیتِ خارجی؛ سپس KYB با Onramper.
4. **بعد:** فعال کردنِ off-ramp (فروش) — امروز عملاً در دسترس نیست.
5. **دائمی:** P2P به‌عنوان fallback برای کشورهای unsupported.

---

## ۸) منابع

- Onramper (معرفی و KYB): [۱](https://docs.onramper.com/docs/getting-started) · [۲](https://docs.onramper.com/docs/step-by-step-guide)
- Uniswap + Robinhood/MoonPay/Transak: [۴](https://cointelegraph.com/news/uniswap-partners-robinhood-moonpay-transak-turn-crypto-cash)
- Ramp — کشورهای Unsupported (ایران در فهرست): [۱](https://support.rampnetwork.com/en/articles/433-which-countries-and-us-states-are-unsupported-for-buying-and-selling-crypto)
- MoonPay — کشورهای Unsupported (ایران در فهرست): [۱](https://support.moonpay.com/en/articles/380968-moonpay-s-unsupported-countries)
- Coinbase CDP Onramp (منسوخ شدنِ Guest Checkout): [۱](https://docs.cdp.coinbase.com/onramp/additional-resources/faq)
- Stripe Sessions 2026 (Crypto Onramp): [۱](https://stripe.com/blog/everything-we-announced-at-sessions-2026)
- Wert (محدودیت‌ها، پوشش، مجوزها): [۱](https://grokipedia.com/page/Wert) · [۲](https://hemi.xyz/blog/hemi-and-wert-unite-to-enable-fiat-onramps-for-programmable-bitcoin) · [۵](https://www.alchemy.com/dapps/wert)
- Alchemy Pay (پوشش و مجوزها): [۱](https://alchemypay.org/news-and-press/core-onboards-alchemy-pay-as-ramp-service-provider-within-its-ecosystem) · [۴](https://alchemypay.org/news-and-press/alchemy-pay-achieves-austrac-approval-as-digital-currency-exchange-provider-in-australia)
- مقایسهٔ کارمزد/پوشش/مجوز: [۳](https://paybis.com/blog/the-top-7-best-crypto-onramp-solutions/) · [۱](https://eco.com/support/en/articles/15210390-best-stablecoin-onramps-2026-moonpay-transak-coinbase-onramp-compared) · [۵](https://mercuryo.io/explore/learn/best-b2b-fiat-to-crypto-payment-gateway-developers)
- افیلیتِ بدون قرارداد: [۱](https://changenow.io/program-affiliate) · [۳](https://swapzone.io/partners/referral-program)
- P2P / بدون KYC: [۱](https://koinly.io/blog/top-no-kyc-crypto-exchanges/) · [۲](https://laikalabs.ai/market-intelligence/best-p2p-crypto-exchanges-zero-fee)
