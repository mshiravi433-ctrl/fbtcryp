# گرفتنِ `VITE_MERCURYO_WIDGET_ID` — گام‌به‌گام، با لینک

> تاریخ: **۲۰۲۶/۱۰/۱۱** · هر لینکِ این سند را خودم باز کردم و نوشتم که واقعاً چه دارد.
> آدرسِ حدسی در این سند نیست (همان اشتباهی که برای CryptoRefills رخ داد، این‌جا تکرار نشده).

---

## قبل از شروع: این شناسه دقیقاً چه می‌کند؟

`widget_id` یک **شناسهٔ عمومی** است که در URL می‌رود. کارش دو چیز است:
۱) ویجتِ Mercuryo را با تنظیماتِ شما بالا می‌آورد، و ۲) تراکنش را به شما **منتسب** می‌کند (درآمد).
بدون آن هم ریلِ ما کار می‌کند — فقط ردیفِ Mercuryo با دلیلِ «نیاز به شناسهٔ عمومیِ تنظیم‌شده»
در بخشِ درهایِ بسته نمایش داده می‌شود و درآمدی ثبت نمی‌شود.

**چیز محرمانه‌ای لازم نداریم.** `Secret` و `Sign Key` را هم در پنل خواهید دید — آن‌ها را
هرگز در متغیرهای `VITE_` نگذارید (داخل باندلِ مرورگر می‌روند). فقط `widget_id`.

---

## گام ۱ — درخواستِ دسترسی به پنل

داکسِ Mercuryo صریح است: «Access to the Mercuryo Dashboard — **contact your integration
manager if you don't have credentials yet**». یعنی خودثبت‌نامی ندارد.

🔗 **فرمِ فروش:** <https://mercuryo.io/get-in-touch>

فیلدهایی که پر می‌کنید: نام · نام خانوادگی · ایمیل · **Company website** · Telegram ID ·
**Product** (اینجا `On-Ramp` را انتخاب کنید) · **Industry** · **Country of your business** ·
توضیحِ use case.

📧 یا مستقیم ایمیل: **sales@mercuryo.io**

> **نکتهٔ صریح و مهم:** فرم «کشورِ کسب‌وکارِ شما» را می‌پرسد. اگر با شخصیت حقوقیِ ایرانی ثبت
> کنید، احتمالِ رد شدن بالاست — همان مانعِ KYB که در سندِ
> `docs/ONRAMP-FOREIGN-CUSTOMERS-2026-FA.md` توضیح داده شد. راهِ تمیز این است که درخواست را
> با همان شخصیت حقوقیِ غیرتحریمی بدهید که برای سناریو ۲ در نظر گرفته‌اید. پنهان‌کاری نه لازم
> است و نه مجاز: عدمِ افشا یعنی نقضِ قرارداد و بسته شدنِ حسابِ بعدی.

---

## گام ۲ — ورود به پنل

🔗 **Production:** <https://dashboard.mercuryo.io>
🔗 **Sandbox (تست بدون پول واقعی):** <https://sandbox-dashboard.mrcr.io>
🔗 **راهنمای شروعِ سریعِ خودشان:** <https://widget.docs.mercuryo.io/guide/getting-started/quick-start>

---

## گام ۳ — ساختِ ویجت و برداشتنِ شناسه

در پنل: **Widgets → Add Widget**

| فیلد | مقدار |
|---|---|
| **Domain URL** | برای روشِ Redirect که ما استفاده می‌کنیم، دقیقاً این را وارد کنید: `https://exchange.mercuryo.io` |
| | ⚠️ بدون اسلشِ آخر و بدون کاراکترِ اضافه — داکس می‌گوید mismatch باعث خطای `widget.mercuryo.io refused to connect` می‌شود |
| **Widget ID** | همین را کپی کنید. شکلش مثلِ این است: `67710925-8b40-4767-846e-3b88db69f04d` |
| **Secret** (پایینِ همان صفحه) | کپی کنید ولی **فقط سمت سرور** — در `VITE_` نگذارید |

---

## گام ۴ — Callback (اختیاری، و فعلاً ردش کنید)

داکس می‌گوید Callback URL را با endpointِ سرورتان پر کنید و Sign Key را بردارید.
ریلِ فعلیِ ما **وب‌هوک ندارد** و عمداً هرگز «پرداخت تأیید شد» نمی‌گوید، پس این گام را می‌توانید
رد کنید. اگر بعداً خواستید تأییدِ واقعی داشته باشید، درِ آن همین‌جاست:
🔗 <https://widget.docs.mercuryo.io/guide/monitoring/callbacks>

---

## گام ۵ — فعال کردنِ فروش (Off-Ramp)

داکس: «**Off-Ramp and Spend Card are disabled by default.** Contact your integration manager
to enable them for your widget.»
یعنی اگر می‌خواهید تبِ **فروش** هم از این در عبور کند، همان ایمیلِ گام ۱ را بفرستید و بخواهید
Off-Ramp را روی ویجت فعال کنند.

---

## گام ۶ — گذاشتنِ شناسه در پروژه

**وب (Vercel):** Settings → Environment Variables → `VITE_MERCURYO_WIDGET_ID` = شناسه → **Redeploy**
(متغیرهای Vite در زمانِ build در می‌آیند؛ بدون redeploy اثر نمی‌کند.)

**محلی:** در `.env` کنارِ بقیه (نمونه در `.env.example`).

**APK — یک دامِ واقعی:** در `.github/workflows/build-apk.yml` یک بلاک `env:` هست که متغیرهای
`VITE_*` را از `vars.` می‌خواند (مثل `VITE_WALLETCONNECT_PROJECT_ID`). هر `VITE_`ای که آن‌جا
نباشد، داخل APK **خالی** می‌ماند و ویجت روی وب کار می‌کند اما در اپ نه. باید این دو کار را
خودتان انجام دهید (من اجازهٔ ویرایشِ workflow را ندارم):

1. در `.github/workflows/build-apk.yml` به بلاکِ `env:` اضافه کنید:
   ```yaml
   VITE_MERCURYO_WIDGET_ID: ${{ vars.VITE_MERCURYO_WIDGET_ID }}
   ```
2. در گیت‌هاب: Settings → Secrets and variables → Actions → **Variables** → New repository variable
   با همین نام و مقدار.

---

## گام ۷ — تست

🔗 محیطِ تست: <https://widget.docs.mercuryo.io/guide/getting-started/sandbox>

بعد از تنظیم، صفحهٔ **Buy** را باز کنید تا گامِ «بازبینی» بروید. ردیفِ Mercuryo باید از
بخشِ «درهای بسته» به فهرستِ درهای باز منتقل شود و دکمه‌اش این را بسازد:

```
https://exchange.mercuryo.io/?widget_id=…&type=buy&currency=USDT&fiat_currency=EUR&fiat_amount=100
```

و برای فروش:

```
https://exchange.mercuryo.io/?widget_id=…&type=sell&currency=USDT&fiat_currency=EUR&amount=100
```

---

## دو نکته درباره‌ی اینکه کد چه چیزی را پر می‌کند و چه چیزی را نه

- **`fiat_amount` در برابر `amount`:** مستنداتِ Mercuryo می‌گوید `amount` مقدارِ **رمزارز**
  است و `fiat_amount` مقدارِ **فیات**. کد ما برای خرید از `fiat_amount` و برای فروش از
  `amount` استفاده می‌کند (هر دو تست دارند).
- **آدرسِ کیف پول را ما پر نمی‌کنیم،** حتی با اینکه پارامترِ `address` مستند است: چون
  نگاشتِ شبکه‌های ما (`arbitrum`, `base`, …) به کدهای شبکهٔ Mercuryo را تأیید نکرده‌ایم، و
  فرستادنِ یک آدرس بدون شبکهٔ مطمئن یعنی احتمالِ واریز روی زنجیره‌ای غیر از آنچه سفارش و
  گزارشِ آنچینِ ما روی آن حساب می‌کنند. کاربر آدرس و شبکه را در صفحهٔ خودِ Mercuryo وارد
  می‌کند، جایی که هر دو در یک قدم دیده می‌شوند.

---

## منابع

- مرجعِ پارامترها: <https://widget.docs.mercuryo.io/guide/integration/widget-parameters>
- شروعِ سریع (۴ گام): <https://widget.docs.mercuryo.io/guide/getting-started/quick-start>
- نمای کلی و URLهای محیط‌ها: <https://widget.docs.mercuryo.io/guide/getting-started/overview>
- تماس با فروش: <https://mercuryo.io/get-in-touch> · sales@mercuryo.io
- راهنمای تاجران: <https://b2bhelp.mercuryo.io/hc/en-gb>
