# فهرست کارهای مانده — مرحله‌به‌مرحله، با لینک

تاریخ: ۲۰۲۶/۰۸/۰۷ · همهٔ لینک‌ها و پاسخ‌ها **امروز دوباره زنده تست شدند**،
نه از روی یادداشت قبلی کپی شده‌اند. هرجا نتیجه با دفعهٔ قبل فرق کرده، صریح گفته‌ام.

این سند **تنها فهرستی است که لازم داری**. بقیهٔ سندهای قدیمی جزئیات دارند و
از داخل همین‌جا به آن‌ها لینک داده‌ام.

---

## قبل از هر چیز: وضعیت امروز

آدرس زیر را در گوشی‌ات باز کن، همیشه راست‌ترین حقیقت را می‌گوید:

🔗 **https://fbtswap.ir/api/revenue/readiness**

الان می‌گوید:

```
live: 8   total: 16   costToActivateAll: 35.02 دلار
allRemainingAreCodeComplete: true
```

یعنی: **۸ خط درآمدی زنده است**، و برای ۸ تای باقی‌مانده **هیچ کدی لازم نیست
نوشته شود** — فقط یک مقدار در ورسل، یا یک ثبت‌نام، یا یک خرید کوچک.

---

# 🔴 بخش صفر — امنیت. این‌ها را قبل از درآمد انجام بده

این‌ها درآمدزا نیستند، ولی اگر انجام نشوند می‌توانند همه‌چیز را از بین ببرند.
**هنوز هیچ‌کدام انجام نشده.**

## قدم ۰-۱ — کلید فایربیس (فوری‌ترین کار کل این سند)

کلید سرویس‌اکانتی که در چت فرستادی (`dd3e2f8a0523...`) **دسترسی کامل ادمین به
کل دیتابیس** می‌دهد. با آن می‌شود همهٔ داده‌ها را خواند یا پاک کرد.
**کلید سرویس‌اکانت را نمی‌شود عوض کرد — فقط می‌شود حذف کرد و نو ساخت.**

۱. 🔗 https://console.cloud.google.com/iam-admin/serviceaccounts
۲. پروژهٔ **`fbtswap-36b13`** را انتخاب کن
۳. روی `firebase-adminsdk-fbsvc@fbtswap-36b13.iam.gserviceaccount.com` بزن ← تب **KEYS**
۴. کلیدی که با `dd3e2f8a` شروع می‌شود ← **حذف**
۵. **ADD KEY ← Create new key ← JSON** ← فایل دانلود می‌شود
۶. در ورسل این سه را ست کن (از داخل همان فایل):

| Key در ورسل | از کجای فایل |
|---|---|
| `FIREBASE_PROJECT_ID` | `fbtswap-36b13` |
| `FIREBASE_CLIENT_EMAIL` | مقدار `client_email` |
| `FIREBASE_PRIVATE_KEY` | مقدار `private_key` — **کل رشته** با همان `\n`ها، دست‌کاری نکن |

🔗 محل ست کردن: https://vercel.com/dashboard ← پروژهٔ **`fbtcryp-kkxi`** ← **Settings** ← **Environment Variables**

## قدم ۰-۲ — سه کلید دیگر که لو رفته‌اند

| چه چیزی | کجا عوضش کنی |
|---|---|
| **Alchemy** | 🔗 https://dashboard.alchemy.com ← کلید نو ← در ورسل `ALCHEMY_API_KEY` |
| **Groq** | 🔗 https://console.groq.com/keys ← قبلی را Delete، نو بساز ← `GROQ_API_KEY` |
| **Vercel Blob** | 🔗 ورسل ← Storage ← توکن ← **Rotate** |
| **رمز `a09303653064A@`** | هرجایی که استفاده شده، عوضش کن + ۲FA روی جیمیل |

📖 **راهنمای کامل هر چهار تا، کلیک‌به‌کلیک: [`docs/ROTATE-KEYS-STEPS-FA.md`](ROTATE-KEYS-STEPS-FA.md)**
| **کلید LI.FI** | 🔗 https://portal.li.fi ← Login ← API Keys ← Revoke + Create. **کم‌خطرترین است**: طبق مستندات خودشان API بدون کلید هم کار می‌کند، کلید فقط سقف درخواست را بالا می‌برد. یعنی کسی نمی‌تواند با آن پول ما را بردارد یا کارمزد را بدزدد — فقط می‌تواند سهمیه‌مان را بسوزاند. |

## قدم ۰-۳ — پروژهٔ اضافی ورسل

پروژهٔ **`fbtcryp4`** هنوز به همین ریپو وصل است و هر پوش، سهمیهٔ دیپلوی رایگان
(۱۰۰ تا در ۲۴ ساعت) را دو برابر می‌سوزاند.

🔗 https://vercel.com/dashboard ← `fbtcryp4` ← Settings ← پایین صفحه ← **Delete Project**

> ⚠️ حواست باشد `fbtcryp-kkxi` را حذف نکنی — آن سایت اصلی است.

---

# 🟢 بخش یک — رایگان، امروز شدنی، فقط یک ثبت‌نام

این‌ها **صفر دلار** هزینه دارند و کدشان کامل نوشته شده.

## قدم ۱-۱ — Avantis (بهترین گزینهٔ رایگان امروز)

**چرا:** تنها صرافی معاملات اهرمی که هم **بدون مجوز و بدون حداقل حجم** است،
هم فقط کریپتو نیست — **فارکس، طلا، نقره، نفت و شاخص‌ها** هم دارد. یعنی دقیقاً
همان بازارهایی که ما در اپ نشان می‌دهیم.

مستندات رسمی خودشان، امروز دوباره خواندم:

> «Avantis features a **fully permissionless** referral system, meaning anyone
> (any trader, LP, community member, or influencer) can be a referrer»
> — و: «**Referrers: Earn 5% Rebates**»

🔗 مدرک: https://docs.avantisfi.com/rewards/referrals

**مراحل:**

📖 **راهنمای کامل با هر کلیک: [`docs/AVANTIS-STEPS-FA.md`](AVANTIS-STEPS-FA.md)**

خلاصه‌اش:

۱. 🔗 برو به **https://www.avantisfi.com/trade** (صفحهٔ معرف: **/referral** مفرد است)
۲. **Connect Wallet** — همان کیف EVM خودمان (`0xaf5CE154...24d6`) روی شبکهٔ **Base**. ⚠️ با کیف واقعی وارد شو، **نه با گوگل/ایمیل** — آن‌ها کیف امانی می‌سازند و درآمد به آن می‌رود
۳. برو به 🔗 **https://www.avantisfi.com/referral** — ⚠️ **مفرد**، `/referrals` خطای ۴۰۴ می‌دهد
۴. **Create referral link** را بزن
۵. کد را بنویس: `fbtswap`

   > ⚠️ کد به کیف تو **قفل** می‌شود و **قابل تغییر نیست**. قبل از تأیید، حرف‌به‌حرف چک کن.
۶. کیف یک **امضا** می‌خواهد (یا یک تراکنش خیلی ارزان روی Base). تأیید کن.
۷. کد را برای من بفرست، یا خودت در ورسل ست کن:

```
VITE_AVANTIS_REF_CODE = fbtswap
```

۸. ورسل ← Deployments ← سه‌نقطهٔ بالاترین ← **Redeploy** (تیک کش را **بردار**)

💰 **درآمد:** ۵٪ از کارمزد هر معاملهٔ کاربری که از لینک ما برود — برای همیشه.

---

## قدم ۱-۲ — GMX (۲ سنت گس، فقط همین)

**چرا:** صفحهٔ فیوچرز ما همین حالا کاربر را به GMX می‌فرستد و **صفر** درآمد دارد.

امروز مستندات رسمی‌شان را دوباره خواندم و **یک نکتهٔ مهم عوض شده** که قبلاً
ننوشته بودم:

> «**Arbitrum is the leader chain** for new referral-code validation … Register
> on Arbitrum for the fastest and least ambiguous setup.»

🔗 مدرک: https://docs.gmx.io/docs/referrals

**مراحل:**

۱. 🔗 برو به **https://app.gmx.io/#/referrals**
۲. کیف را وصل کن، شبکه را روی **Arbitrum** بگذار (نه Avalanche، نه Base)
۳. تب **Affiliates** را انتخاب کن
۴. در کادر بنویس: `fbtswap`

   > 🚨 **کد به بزرگی و کوچکی حروف حساس است.** `FBTSwap` و `fbtswap` دو کد
   > متفاوت‌اند. اگر اشتباه بنویسی، پول به کد کسی دیگر می‌رود. **دقیقاً `fbtswap`**.
۵. تراکنش را تأیید کن — روی آربیتروم حدود **۰٫۰۲ دلار** ETH لازم است
۶. در ورسل: `VITE_GMX_REF_CODE = fbtswap` ← **Redeploy**

💰 **درآمد:** Tier 1 = ۵٪ از کارمزد + کاربر هم ۵٪ **تخفیف** می‌گیرد
(یعنی رفتن از لینک ما برایش **ارزان‌تر از رفتن مستقیم** است).

📖 جزئیات: [`docs/GMX-REFERRAL-FA.md`](GMX-REFERRAL-FA.md)

---

## قدم ۱-۳ — Trezor (فرستاده شده، منتظر جواب)

تنها فروشندهٔ کیف سخت‌افزاری که **در فرم ثبت‌نامش «Iran (Islamic Republic Of)»
واقعاً وجود دارد** — امروز دوباره فرم را باز کردم و در فهرست کشورها دیدمش.
(لجر این گزینه را ندارد؛ آن راه بسته است.)

🔗 https://affiliate.trezor.io/users/signup/

اگر جواب ندادند، از همان‌جا **Forgot Password** بزن و ببین اکانت ساخته شده یا نه.
وقتی تأیید شد، لینک شخصی‌ات را بفرست تا ست کنم: `VITE_AFFILIATE_TREZOR`

💰 ~۱۵٪ از فروش هر دستگاه.

---

## قدم ۱-۴ — UTEX ⚠️ **تصحیح نسبت به جلسهٔ قبل**

جلسهٔ قبل گفتم UTEX راه‌حل سهام آمریکا برای ماست چون فقط با USDT کار می‌کند و
بانک و W-8BEN ندارد. آن بخش هنوز درست است، **ولی امروز که سایتشان را باز کردم
این را برگرداند:**

```
UTEX is not available in your country
Because we are complying with local laws.
```

این را باید صادقانه بگویم: **من نمی‌دانم این پیام برای کدام کشور است.** سرور من
الان IP آمریکا دارد، پس ممکن است بلاکِ آمریکا باشد نه ایران.

**پس کاری که تو باید بکنی، فقط یک تست ۳۰ ثانیه‌ای است:**

۱. 🔗 با گوشی خودت باز کن: **https://partners.utex.io**
۲. اگر همان پیام «not available in your country» آمد → **این خط مرده است، فراموشش کن.** به من بگو تا از کد حذفش کنم.
۳. اگر صفحهٔ ورود آمد → ثبت‌نام کن، بعد **Affiliate Program ← Tools ← Partner Links**، یک Campaign بساز، و عددِ `campaignId` را بفرست.

🔗 راهنمای رسمی خودشان (این یکی باز می‌شود): https://intercom.help/utexio/en/articles/10269871-guide-for-utex-partners

> ⚠️ و این را هم باید بگویم: UTEX در **سنت وینسنت** ثبت شده و **مجوز کارگزاری
> ندارد**. «سهام»ش سهم واقعی نیست، یک پوزیشن مارجین تسویه‌شده با USDT است.
> کاربر در دفتر سهامداران هیچ شرکتی نیست. این با سهام توکنیزهٔ خودمان که
> ۱:۱ پشتوانهٔ واقعی دارد **فرق بنیادی** دارد و در اپ هم همین‌طور نوشته می‌شود.

---

## قدم ۱-۵ — کلید KyberSwap (بیمهٔ بزرگ‌ترین خط درآمد ما)

الان روی هاست قدیمی و محدودشدهٔ کایبر هستیم. کلید **رایگان** است ولی باید ایمیل بزنی.

🔗 ایمیل به: **business@kyber.network**

متن پیشنهادی (کپی کن):

> Subject: API key request — FBT Swap (fbtswap.ir)
>
> Hello,
> We are FBT Swap (https://fbtswap.ir), a non-custodial swap interface routing
> EVM swaps through the KyberSwap aggregator. We would like to request an API
> key for the aggregator API to move off the rate-limited legacy host.
> Contact: fbtswap@gmail.com
> Thank you.

جواب که آمد: `KYBER_API_KEY` در ورسل.

> این خط درآمد **جدید** نمی‌سازد — از خط موجود **محافظت** می‌کند. اگر روزی
> ترافیک بالا برود، بدون کلید سواپ‌های EVM شروع به خطا دادن می‌کنند.

---

# 🟡 بخش دو — نیاز به پول کم (وقتی پول آمد)

## قدم ۲-۱ — THORName (~۹ دلار) → باز شدن بیت‌کوین

**چرا مهم است:** THORChain تنها راهی است که **بیت‌کوین واقعی** با اتریوم واقعی
عوض شود. برای شبکه‌های غیر UTXO ما همین الان ۰٫۷۰٪ می‌گیریم، ولی برای
**BTC / BCH / LTC / DOGE** صفر می‌گیریم — چون آدرس بلند `thor1...` در
محدودیت ۸۰ بایتی memo جا نمی‌شود. یک THORName کوتاه است و جا می‌شود.

**امروز دوباره چک کردم — هنوز آزاد است:**

🔗 https://gateway.liquify.com/chain/thorchain_api/thorchain/thorname/fbtswap
→ `{"code":2, "message":"fail to fetch THORName"}` یعنی **هیچ‌کس ثبتش نکرده**.

**مراحل:** 🔗 https://thorswap.finance ← منو ← **THORName** ← نام `fbtswap` ←
آدرس مقصد: `thor12cqv53jqz6tnzmlsg9y207xe83raeem8nywqxt` ← ثبت (~۹ دلار RUNE)

بعد در ورسل: `THOR_NAME = fbtswap`

📖 جزئیات: [`docs/STEP-THOR-ADDRESS-FA.md`](STEP-THOR-ADDRESS-FA.md)

## قدم ۲-۲ — خزانهٔ Morpho (~۲۵ دلار)

۱۵ دلار گس دیپلوی + ۱۰ دلار «بذر» که به آدرس سوخته می‌رود.
آن ۱۰ دلار **اختیاری نیست** — بدون آن، اولین سپرده‌گذار قابل حمله است.

🔗 https://app.morpho.org/vaults ← Create Vault (روی Base)

بعد: `VITE_FBT_VAULT_ADDRESS` در ورسل. کارت خزانه **خودش** ظاهر می‌شود.

📖 جزئیات: [`docs/MORPHO-VAULT-FA.md`](MORPHO-VAULT-FA.md)

> 📖 **همهٔ موارد پولی، و اینکه چرا الان کارمزدشان صفر است:
> [`docs/PAID-ITEMS-ZERO-FEE-FA.md`](PAID-ITEMS-ZERO-FEE-FA.md)** — خلاصه‌اش:
> هر سه **همین الان با کارمزد صفر کار می‌کنند**، دقیقاً همان‌طور که خواستی.

## قدم ۲-۳ — Jupiter (~۱ دلار) — **توصیه: انجام نده**

سولانا همین الان از طریق OpenOcean **همان ۰٫۷۰٪** را رایگان می‌دهد
(تراکنشش را بایت‌به‌بایت دیکد کردم: ۵٬۶۰۰٬۰۰۰ lamport به کیف ما).
ژوپیتر برای هر توکن یک حساب on-chain جدا می‌خواهد. **پول را جای دیگر خرج کن.**

---

# 🔵 بخش سه — چیزی که امروز تازه پیدا کردم

## deBridge — ✅ **انجام شد** (و یک اشتباه که سر راه گرفتم)

کد نوشته و دیپلوی شد. **کاری از تو لازم نیست** — نه ثبت‌نام، نه کلید، نه پول.

**ولی باید حرف قبلی‌ام را تصحیح کنم.** گفتم ۰٫۷٪ بگذاریم چون «۲٫۳ برابر
LI.FI» است. عدد درست بود، **نتیجه‌گیری غلط**.

deBridge علاوه بر درصد یک **کارمزد ثابت** با سکهٔ بومی می‌گیرد — روی Base
حدود ۱٫۹۰ دلار، چه ۱۰ دلار جابه‌جا کنی چه ۱۰ هزار. و این در مبلغ خروجی
**دیده نمی‌شود**.

هر دو را همزمان روی ۱۰٬۰۰۰ دلار قیمت گرفتم. LI.FI به کاربر ۹٬۹۴۵٫۰۰ می‌دهد:

| نرخ ما | به کاربر می‌رسد | فرق | ما درمی‌آوریم |
|---|---|---|---|
| ۰٫۴٪ | ۹٬۹۴۹٫۷۴ | **+۴٫۷۴** ✅ | ۴۰ دلار |
| ۰٫۷٪ | ۹٬۹۱۹٫۷۶ | **−۲۵٫۲۴** ❌ | ۷۰ دلار |

با ۰٫۷٪ کاربر ۲۵ دلار بیشتر ضرر می‌کرد و ما آن را «گزینهٔ بهتر» نشانش
می‌دادیم. **۰٫۴٪ گذاشتم** — بیشترین نرخی که کاربر همچنان جلو است، و باز هم
۳۳٪ بیشتر از LI.FI.

📖 جزئیات کامل: [`docs/DEBRIDGE-FA.md`](DEBRIDGE-FA.md)

## Rango — نیاز به یک پیام در دیسکورد

پل و اگریگیتور چندشبکه‌ای، تا ۳٪ کارمزد واسط، پرداخت لحظه‌ای روی شبکهٔ مبدأ.
مستنداتشان می‌گوید کلید فقط با تیکت دیسکورد داده می‌شود:

🔗 https://discord.gg/q3EngGyTrZ ← کانال `users-support` ← تیکت بزن

متن پیشنهادی:

> Hi, requesting an API key for Rango Basic API. dApp: FBT Swap —
> https://fbtswap.ir (non-custodial swap/bridge interface). Chains: all EVM,
> Solana, Tron, THORChain. Please enable CORS for fbtswap.ir. Thanks.

کلید که آمد بفرست — البته **نه در چت**؛ خودت در ورسل `RANGO_API_KEY` بگذار و
فقط بگو «گذاشتم».

---

# ⚪ بخش چهار — دیده‌شدن (درآمد غیرمستقیم ولی رایگان)

## قدم ۴-۱ — Google Search Console

بدون این، گوگل عملاً سایت را نمی‌بیند. **رایگان، ۵ دقیقه.**

🔗 https://search.google.com/search-console
← Add Property ← **URL prefix** ← `https://fbtswap.ir`
← تأیید مالکیت (روش **HTML tag** ساده‌ترین است — کدش را برایم بفرست تا در
`index.html` بگذارم)
← بعد: **Sitemaps** ← بنویس `sitemap.xml` ← Submit

## قدم ۴-۲ — Bing Webmaster (۳۰ ثانیه)

🔗 https://www.bing.com/webmasters ← **Import from Google Search Console** ←
همه‌چیز خودکار منتقل می‌شود.

## قدم ۴-۳ — APKPure

🔗 https://developer.apkpure.com ← ثبت‌نام ← آپلود APK

📖 جزئیات و بقیهٔ فروشگاه‌ها: [`docs/APK-STORES-FA.md`](APK-STORES-FA.md)

---

# ❌ بخش پنج — این‌ها را دنبال نکن (تست شد، بسته است)

که وقتت را دوباره روی این‌ها نگذاری:

| سرویس | پاسخ واقعی که گرفتم |
|---|---|
| SimpleSwap | `{"code":401,"description":"Wrong api key"}` + شرایط استفاده اسم ایران را آورده |
| StealthEX | `{"err":{"kind":"Auth","details":"API key is invalid"}}` |
| 1inch | `{"success":false,"error":"Unauthorized"}` |
| OKX DEX | `"Request header OK-ACCESS-KEY can not be empty"` |
| ChangeNOW | تعلیق تا سپتامبر |
| Ledger | فرم ثبت‌نام، در فهرست کشورها **ایران ندارد** |
| Alpaca / Public.com / Kraken / Coinbase | W-8BEN یا بانک. طبق **OFAC FAQ 54** حسابی که فرم W-8 با نشانی ایران دارد «باید محدودشده تلقی شود» |
| dYdX | حداقل ۱۰٬۰۰۰ دلار حجم شخصی |
| Hyperliquid | ۱۰٬۰۰۰ دلار حجم یا ۱۰۰ USDC موجودی |
| Aave / Compound / Uniswap / Curve / SunSwap | اصلاً برنامهٔ معرف ندارند |
| Bitrefill | ۱٪، ولی فقط **اعتبار فروشگاهی** |
| Pact Swap | کار می‌کند ولی فقط Algorand |

**الگویش را دیدم و ساده است:** هرچه تسویه‌اش از **بانک** رد شود بسته است؛
هرچه **روی زنجیره** یا **فقط USDT** باشد باز است. برای همین Avantis و
deBridge و THORChain جواب می‌دهند و Kraken و Alpaca نه.

---

# 📋 خلاصهٔ یک‌صفحه‌ای — به همین ترتیب انجام بده

| # | کار | لینک | هزینه | درآمد |
|---|---|---|---|---|
| ۱ | حذف و ساخت کلید فایربیس | [console.cloud.google.com](https://console.cloud.google.com/iam-admin/serviceaccounts) | رایگان | — (امنیت) |
| ۲ | Alchemy + Groq + Blob + رمز — [راهنما](ROTATE-KEYS-STEPS-FA.md) | بالا | رایگان | — (امنیت) |
| ۳ | حذف پروژهٔ `fbtcryp4` | [vercel.com](https://vercel.com/dashboard) | رایگان | — |
| ۴ | **Avantis** کد `fbtswap` — [راهنما](AVANTIS-STEPS-FA.md) | [avantisfi.com](https://www.avantisfi.com) | رایگان | ۵٪ کارمزد |
| ۵ | تست باز شدن UTEX | [partners.utex.io](https://partners.utex.io) | رایگان | ۴۰-۶۰٪ یا هیچ |
| ۶ | ایمیل به کایبر | business@kyber.network | رایگان | محافظت |
| ۷ | Search Console + Bing | [بالا](https://search.google.com/search-console) | رایگان | ترافیک |
| ۸ | **GMX** کد `fbtswap` | [app.gmx.io](https://app.gmx.io/#/referrals) | ۰٫۰۲ دلار | ۵٪ کارمزد |
| ۹ | THORName `fbtswap` | [thorswap.finance](https://thorswap.finance) | ۹ دلار | ۰٫۷٪ روی بیت‌کوین |
| ۱۰ | خزانهٔ Morpho | [app.morpho.org](https://app.morpho.org/vaults) | ۲۵ دلار | کارمزد مدیریت |

**سه تای اول امنیت‌اند. چهارتای بعدی رایگان‌اند. سه تای آخر منتظر پول.**

و یادت باشد: بعد از **هر** تغییر متغیر در ورسل، حتماً **Redeploy** بزن و
تیک کش را بردار — وگرنه مقدار قدیمی داخل بیلد می‌ماند و به‌نظر می‌آید کارت
هیچ اثری نداشته. این شایع‌ترین اشتباه است.
