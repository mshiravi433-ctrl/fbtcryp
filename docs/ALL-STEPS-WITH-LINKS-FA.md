# همهٔ کارهای مانده — مرحله به مرحله، با لینک دقیق

تاریخ: ۲۰۲۶/۰۸/۰۷ · **هر لینک این سند امروز باز و تست شد**

اگر فقط یک سند می‌خوانی، همین باشد. کارها به ترتیبی چیده شده که باید انجام
شوند: **اول امنیت، بعد رایگان‌ها، آخر پولی‌ها.**

---

## 🔑 اطلاعاتی که چند بار لازمت می‌شود

| چیست | مقدار |
|---|---|
| کیف EVM ما | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| کیف سولانا | `B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4` |
| کیف ترون | `TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ` |
| آدرس THORChain | `thor12cqv53jqz6tnzmlsg9y207xe83raeem8nywqxt` |
| نامی که همه‌جا می‌گذاریم | `fbtswap` (**همه کوچک**) |
| پروژهٔ ورسل | `fbtcryp-kkxi` (**نه** `fbtcryp4`) |

**مسیر ست کردن هر متغیر — این را حفظ کن، ده بار تکرار می‌شود:**

```
https://vercel.com/dashboard  →  fbtcryp-kkxi  →  Settings
   →  Environment Variables  →  Add  →  هر سه محیط تیک  →  Save
   →  تب Deployments  →  ⋯ بالاترین  →  Redeploy  →  تیک کش را بردار
```

---

# 🔴 بخش ۱ — امنیت (اول این‌ها)

## ۱-۱ · کلید فایربیس — **فوری‌ترین کار کل سند**

کلید `dd3e2f8a0523...` که در چت فرستادی **دسترسی کامل ادمین به کل دیتابیس**
می‌دهد. کلید سرویس‌اکانت **عوض نمی‌شود** — فقط حذف و ساخت نو.

🔗 **https://console.cloud.google.com/iam-admin/serviceaccounts**

۱. پروژهٔ **`fbt-room-a46fc`** را انتخاب کن
۲. روی `firebase-adminsdk-fbsvc@fbt-room-a46fc.iam.gserviceaccount.com` بزن
۳. تب **KEYS** → کلید `dd3e2f8a...` → **حذف**
۴. **ADD KEY → Create new key → JSON** → فایل دانلود می‌شود
۵. فایل را با ویرایشگر متن باز کن و این سه را در ورسل بگذار:

| Key | مقدار |
|---|---|
| `FIREBASE_PROJECT_ID` | `fbt-room-a46fc` |
| `FIREBASE_CLIENT_EMAIL` | مقدار `client_email` |
| `FIREBASE_PRIVATE_KEY` | مقدار `private_key` — **کل رشته** با همان `\n`ها، دست‌کاری نکن |

## ۱-۲ · چهار کلید دیگر

📖 **راهنمای کلیک‌به‌کلیک: [`ROTATE-KEYS-STEPS-FA.md`](ROTATE-KEYS-STEPS-FA.md)**

| چه چیزی | لینک | متغیر |
|---|---|---|
| Alchemy | 🔗 https://dashboard.alchemy.com | `ALCHEMY_API_KEY` |
| Groq | 🔗 https://console.groq.com/keys | `GROQ_API_KEY` |
| Vercel Blob | 🔗 https://vercel.com/dashboard ← تب **Storage** | خودکار |
| LI.FI | 🔗 https://portal.li.fi | `LIFI_API_KEY` |
| رمز `a09303653064A@` | هرجا استفاده شده | + ۲FA روی جیمیل |

> LI.FI کم‌خطرترین است: API بدون کلید هم کار می‌کند، کلید فقط سقف درخواست را
> بالا می‌برد. کسی نمی‌تواند با آن پول ما را بردارد.

## ۱-۳ · حذف پروژهٔ اضافی

پروژهٔ `fbtcryp4` هنوز وصل است و سهمیهٔ دیپلوی رایگان را دو برابر می‌سوزاند.

🔗 https://vercel.com/dashboard ← **`fbtcryp4`** ← Settings ← پایین ←
**Delete Project**

> ⚠️ `fbtcryp-kkxi` را حذف نکن — آن سایت اصلی است.

---

# 🟢 بخش ۲ — رایگان

## ۲-۱ · Avantis — بهترین گزینهٔ رایگان

📖 **راهنمای کامل با هر کلیک: [`AVANTIS-STEPS-FA.md`](AVANTIS-STEPS-FA.md)**

| مرحله | لینک |
|---|---|
| ورود | 🔗 https://www.avantisfi.com/trade |
| ساخت کد | 🔗 https://www.avantisfi.com/referral |

⚠️ **سه تله:**
1. آدرس **`/referral`** است — **مفرد**. `/referrals` خطای ۴۰۴ می‌دهد (تست کردم)
2. با **کیف واقعی** وارد شو، **نه گوگل/ایمیل** — آن‌ها کیف امانی می‌سازند
3. کد **قابل تغییر نیست** — `fbtswap`، همه کوچک، سه بار بخوانش

متغیر: `VITE_AVANTIS_REF_CODE` = `fbtswap`
💰 **۵٪ از کارمزد، برای همیشه**

## ۲-۲ · ایمیل به KyberSwap

بزرگ‌ترین خط درآمد ما روی هاست قدیمی و محدود است. کلید **رایگان** است.

🔗 ایمیل به: **business@kyber.network**

```
Subject: API key request — FBT Swap (fbtswap.ir)

Hello,
We are FBT Swap (https://fbtswap.ir), a non-custodial swap interface routing
EVM swaps through the KyberSwap aggregator. We would like to request an API
key for the aggregator API to move off the rate-limited legacy host.
Contact: fbtswap@gmail.com
Thank you.
```

متغیر: `KYBER_API_KEY`
💰 درآمد جدید نمی‌سازد — از خط موجود **محافظت** می‌کند

## ۲-۳ · Google Search Console + Bing

بدون این، گوگل عملاً سایت را نمی‌بیند.

🔗 **https://search.google.com/search-console**
← Add Property ← **URL prefix** ← `https://fbtswap.ir`
← تأیید با **HTML tag** (کدش را برایم بفرست تا در `index.html` بگذارم)
← بعد: **Sitemaps** ← بنویس `sitemap.xml` ← Submit

🔗 **https://www.bing.com/webmasters**
← **Import from Google Search Console** ← ۳۰ ثانیه، خودکار

## ۲-۴ · Trezor — منتظر جواب

🔗 https://affiliate.trezor.io/users/signup/

تنها فروشندهٔ سخت‌افزاری که در فرمش **«Iran (Islamic Republic Of)»** واقعاً
هست — امروز دوباره فرم را باز کردم و دیدمش. اگر جواب ندادند،
**Forgot Password** بزن ببین اکانت ساخته شده یا نه.

متغیر: `VITE_AFFILIATE_TREZOR` · 💰 ~۱۵٪ از فروش هر دستگاه

## ۲-۵ · UTEX — ❌ **بسته است، رهایش کن**

گفتی «اگر با IP آمریکا نمی‌آورد چون VPN است مشکلی نیست». امروز دوباره از سه
آدرس مختلف تست کردم:

- `utex.io` → «not available in your country»
- `partners.utex.io` → همان
- `partners.utex.io/content/links` → همان

هر سه یکسان. من نمی‌توانم از اینجا تشخیص دهم بلاکِ کدام کشور است.
**اگر با گوشی خودت باز شد بگو تا وصلش کنم؛ اگر نه، از کد حذفش می‌کنم.**

---

# 🟡 بخش ۳ — پولی

> 📖 چرا این‌ها **همین الان با کارمزد صفر کار می‌کنند**:
> [`PAID-ITEMS-ZERO-FEE-FA.md`](PAID-ITEMS-ZERO-FEE-FA.md)

## ۳-۱ · GMX — ۲ سنت

🔗 **https://app.gmx.io/#/referrals**

۱. کیف را وصل کن، شبکه روی **Arbitrum** (نه Avalanche، نه Base)
۲. تب **Affiliates**
۳. کد: `fbtswap`
۴. تأیید تراکنش (~۰٫۰۲ دلار)

> 🚨 **به بزرگی و کوچکی حروف حساس است.** `FBTSwap` و `fbtswap` دو کد جدا
> هستند. مستندات خودشان امروز می‌گویند: «Arbitrum is the **leader chain**
> for new referral-code validation».

متغیر: `VITE_GMX_REF_CODE` = `fbtswap`
💰 ۵٪ کارمزد + کاربر ۵٪ **تخفیف** می‌گیرد

## ۳-۲ · THORName — ۹ دلار → باز شدن بیت‌کوین

**امروز دوباره چک کردم، هنوز آزاد است:**

🔗 https://gateway.liquify.com/chain/thorchain_api/thorchain/thorname/fbtswap
→ `{"code":2,"message":"fail to fetch THORName"}` = **کسی ثبتش نکرده**

🔗 **https://thorswap.finance** ← منو ← **THORName**
- نام: `fbtswap`
- آدرس: `thor12cqv53jqz6tnzmlsg9y207xe83raeem8nywqxt`

متغیر: `THOR_NAME` = `fbtswap`
💰 ۰٫۷٪ روی **BTC / BCH / LTC / DOGE** که الان صفر است

## ۳-۳ · خزانهٔ Morpho — ۲۵ دلار

🔗 **https://app.morpho.org/vaults** ← Create Vault (روی **Base**)

۱۵ دلار گس + ۱۰ دلار بذر به آدرس سوخته.
> آن ۱۰ دلار **اختیاری نیست** — بدون آن اولین سپرده‌گذار قابل حمله است.

متغیرها: `VITE_FBT_VAULT_ADDRESS` و `VITE_FBT_VAULT_CHAIN` = `8453`

## ۳-۴ · ژوپیتر — **انجام نده**

سولانا از OpenOcean همان ۰٫۷۰٪ را **رایگان** می‌دهد. ژوپیتر برای هر توکن یک
حساب on-chain جدا می‌خواهد. پول را جای دیگر خرج کن.

---

# ❌ بخش ۴ — این‌ها را دنبال نکن

| سرویس | پاسخ واقعی |
|---|---|
| SimpleSwap | `{"code":401,"description":"Wrong api key"}` + ToS اسم ایران |
| StealthEX | `{"err":{"kind":"Auth","details":"API key is invalid"}}` |
| 1inch | `{"success":false,"error":"Unauthorized"}` |
| OKX DEX | `"Request header OK-ACCESS-KEY can not be empty"` |
| ChangeNOW | تعلیق تا سپتامبر |
| Ledger | فرم ثبت‌نام **ایران ندارد** |
| Kraken / Alpaca / Public.com / Coinbase | W-8BEN یا بانک → **OFAC FAQ 54** |
| dYdX | حداقل ۱۰٬۰۰۰ دلار حجم شخصی |
| Hyperliquid | ۱۰٬۰۰۰ دلار حجم یا ۱۰۰ USDC |
| Aave / Uniswap / Curve / SunSwap | برنامهٔ معرف ندارند |
| UTEX | «not available in your country» از سه آدرس |

**الگو:** هرچه از **بانک** رد شود بسته است؛ هرچه **روی زنجیره** یا
**فقط USDT** باشد باز. برای همین Avantis و deBridge و THORChain جواب می‌دهند.

---

# ✅ بخش ۵ — اینها انجام شده، کاری لازم نیست

| خط درآمدی | نرخ | وضعیت |
|---|---|---|
| سواپ EVM (KyberSwap) | ۰٫۷۰٪ | ✅ زنده |
| سواپ سولانا (OpenOcean) | ۰٫۷۰٪ | ✅ زنده |
| سواپ بدون گس (۰x) | ۰٫۷۰٪ | ✅ زنده |
| پرداخت با تماس | ۰٫۷۰٪ | ✅ زنده |
| پل LI.FI | ۰٫۳۰٪ | ✅ زنده |
| پل بین‌شبکه‌ای ۰x | ۰٫۳۰٪ | ✅ زنده |
| **پل deBridge** | **۰٫۴۰٪** | ✅ **تازه اضافه شد** |
| طلای دیجیتال | ۰٫۷۰٪ | ✅ زنده |
| Velora | قیمت‌گیری | ✅ زنده |
| THORChain غیر-UTXO | ۰٫۷۰٪ | ✅ زنده |

**۹ از ۱۷ خط زنده.** برای ۸ تای باقی‌مانده **هیچ کدی لازم نیست نوشته شود**.

---

# 📋 چک‌لیست نهایی

| # | کار | لینک | هزینه |
|---|---|---|---|
| ۱ | کلید فایربیس | [console.cloud.google.com](https://console.cloud.google.com/iam-admin/serviceaccounts) | رایگان |
| ۲ | Alchemy + Groq + Blob + رمز | [راهنما](ROTATE-KEYS-STEPS-FA.md) | رایگان |
| ۳ | حذف `fbtcryp4` | [vercel.com](https://vercel.com/dashboard) | رایگان |
| ۴ | **Avantis** | [راهنما](AVANTIS-STEPS-FA.md) | رایگان |
| ۵ | ایمیل کایبر | business@kyber.network | رایگان |
| ۶ | Search Console + Bing | [بالا](https://search.google.com/search-console) | رایگان |
| ۷ | **GMX** | [app.gmx.io](https://app.gmx.io/#/referrals) | ۰٫۰۲ دلار |
| ۸ | THORName | [thorswap.finance](https://thorswap.finance) | ۹ دلار |
| ۹ | Morpho | [app.morpho.org](https://app.morpho.org/vaults) | ۲۵ دلار |

**جمع کل: ۳۴٫۰۲ دلار**

---

## بعد از هر تغییر — این را چک کن

🔗 **https://fbtswap.ir/api/revenue/readiness**

و یادت باشد: بعد از **هر** تغییر متغیر، **Redeploy** با تیک کش برداشته —
وگرنه مقدار قدیمی داخل بیلد می‌ماند و به نظر می‌رسد کارت هیچ اثری نداشته.
شایع‌ترین اشتباه همین است.
