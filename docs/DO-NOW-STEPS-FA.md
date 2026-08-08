# الان چه کار کنم — قدم به قدم

> نسخهٔ **۱.۲۸.۰** · نام بسته **`ir.fbtswap.app`** · ۱۸ مرداد ۱۴۰۵
> همه‌چیز را همین حالا چک کردم، از حافظه ننوشتم.

---

# جواب سؤال اول: بله، فقط APK جدید هست

چک کردم. صفحهٔ انتشار **فقط سه فایل** دارد و هر سه امروز ساخته شده‌اند:

```
app-release.apk      ۹.۵۷ مگ   ← فروشگاه‌ها
FBT-Swap-full.apk    ۹.۵۹ مگ   ← نصب مستقیم
app-release.aab      ۹.۱۸ مگ   ← فقط گوگل‌پلی
```

نسخه‌های قدیمی (`v1.0.0` تا `v1.2.4`) هنوز به‌عنوان **تگ** در گیت‌هاب هستند
ولی **هیچ فایلی داخلشان نیست** — چک کردم، خالی‌اند. پس کسی نمی‌تواند اشتباهی
نسخهٔ قدیمی را دانلود کند. ✅

**تنها لینکی که باید بدهی:**
```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/latest
```

---

# 🟩 مرحلهٔ ۱ — Firebase (مهم‌ترین، اول این)

بدون این، **هشدار قیمت و اعلان سفارش‌ها** روی نسخهٔ جدید ممکن است کار کند و
بعداً بی‌هشدار قطع شود.

۱. برو به **https://console.firebase.google.com**
۲. پروژهٔ **`fbt-room-a46fc`**
۳. ⚙️ **Project settings**
۴. پایین صفحه، بخش **Your apps** → دکمهٔ **Add app** → آیکون **Android**
۵. در فیلد Android package name بنویس:
```
ir.fbtswap.app
```
۶. **Register app** → بعد **Download google-services.json**
۷. فایل را برایم بفرست — من جایگزینش می‌کنم

> ⚠️ **اپ قدیمی `ir.fbt.swap` را در فایربیس پاک نکن.** کاربرهای نسخهٔ قبلی هنوز
> به آن وصل‌اند. یک پروژه می‌تواند چند اپ اندروید داشته باشد.

⏱ ۵ دقیقه

---

# 🟩 مرحلهٔ ۲ — کافه‌بازار

## لینک
```
https://pishkhan.cafebazaar.ir
```

## فایل
`app-release.apk` — **نه** `FBT-Swap-full.apk`

## فیلدهای فرم

| فیلد | مقدار |
|---|---|
| نام بسته | `ir.fbtswap.app` |
| نسخه | `1.28.0` (versionCode 56) |
| نام برنامه | FBT Swap |
| دسته‌بندی | مالی |
| رده سنی | ۱۸+ |
| ایمیل | `fbtswap@gmail.com` |
| وب‌سایت | `https://fbtswap.ir` |
| حریم خصوصی | `https://fbtswap.ir/#/legal/privacy` |

🔴 در آدرس حریم خصوصی **علامت `#` حتماً باشد** — بدونش صفحه ۴۰۴ می‌دهد.

## ⚠️ در توضیحات بازار این کلمات را ننویس

مصوبهٔ شورای عالی فضای مجازی تبلیغ خدمات رمزارز را به دارندگان مجوز محدود کرده:

❌ «سرمایه‌گذاری» · ❌ «سود» · ❌ «بازدهی» · ❌ «صرافی»

✅ به‌جایش: **«ابزار مدیریت کیف پول و مشاهدهٔ بازار»**

این دروغ نیست — ما دفتر سفارش نداریم و نقدینگی نگه نمی‌داریم.

متن فارسی آمادهٔ بازار در `store/LISTING-FA.md` هست (۳٬۲۰۱ کاراکتر).

⏱ ۲۰ دقیقه

---

# 🟩 مرحلهٔ ۳ — مایکت

```
https://developer.myket.ir
```

همان فایل، همان فیلدها، همان هشدار کلمات.

⏱ ۱۵ دقیقه

---

# 🟩 مرحلهٔ ۴ — فرم Play Protect (همان «متن با هش»)

## اول یک نکته که وقتت را نجات می‌دهد

خود گوگل نوشته: اگر پیامی که کاربر می‌بیند این باشد —

> *"This app is unknown to Play Protect"*

— **فرم بی‌فایده است**: «Appeals are not relevant and won't remove this
message». فرم فقط برای این دو پیام کار می‌کند:

- **"App blocked to protect your device"**
- **"Harmful App Blocked"**

**اول از بازار بپرس دقیقاً کدام پیام را دیده‌اند.**

## لینک فرم
```
https://support.google.com/googleplay/android-developer/contact/protectappeals
```

⚠️ حرف بازار درست است: **بدون تغییر IP فرم باز نمی‌شود**.

## فیلدهای فرم

| فیلد | مقدار |
|---|---|
| Package name | `ir.fbtswap.app` |
| App name | `FBT Swap` |
| Developer | `Fanous Bazaar Pishgam Co.` |
| Contact email | `fbtswap@gmail.com` |
| URL to download your APK | لینک زیر ⬇️ |

### 🔴 فیلد لینک APK

رایج‌ترین دلیل رد شدن این است که ربات گوگل فایل را دانلود می‌کند و به صفحهٔ
HTML می‌رسد. **لینک مستقیم بده، نه صفحهٔ ریلیز:**

```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/download/latest/app-release.apk
```

### متن توضیحات — این را کپی کن

> این متن را با نام بستهٔ جدید و دامنهٔ درست به‌روز کردم. نسخهٔ قبلی هنوز
> `ir.fbt.swap` و `lawpoetics.ir` را می‌گفت — اگر آن را می‌فرستادی، فرم دربارهٔ
> اپی حرف می‌زد که وجود ندارد و دامنه‌ای که مال ما نیست.

```
FBT Swap (ir.fbtswap.app) is a non-custodial cryptocurrency swap interface for
Android, built with Capacitor. It is distributed outside Google Play because
our company is based in Iran and cannot register a Play Console account.

The app requests only six permissions, and none of them are the sensitive
permissions listed in the Play Protect guidance:

- INTERNET and ACCESS_NETWORK_STATE: fetch public market prices and swap
  routes from public APIs.
- CAMERA: scan QR codes containing wallet addresses, so users do not have to
  hand-type a 42-character address. Used only inside a scanner screen the user
  opens explicitly.
- USE_BIOMETRIC: optional fingerprint/face lock for the app itself.
- POST_NOTIFICATIONS: user-configured price alerts.
- VIBRATE: haptic feedback.

We do NOT request RECEIVE_SMS, READ_SMS, NOTIFICATION_LISTENER, ACCESSIBILITY,
REQUEST_INSTALL_PACKAGES, SYSTEM_ALERT_WINDOW, QUERY_ALL_PACKAGES, location,
contacts or external storage.

The app is non-custodial: it never receives a private key or recovery phrase,
and it cannot move funds. Every transaction is signed by the user's own wallet
application. There is no account, no login and no advertising SDK. The app
targets API 35, sets usesCleartextTraffic="false", is signed with a release
key, and is not debuggable.

Source code is public at https://github.com/mshiravi433-ctrl/fbtcryp and the
website is https://fbtswap.ir

We believe the block is a false positive caused by the app being newly
published and not yet known to Play Protect, rather than by any behaviour
matching the Mobile Unwanted Software principles or the Potentially Harmful
Application definitions.
```

## دربارهٔ «هش» که پرسیدی

فرم Play Protect **هش نمی‌خواهد** — فقط لینک APK و متن بالا. ولی اگر جایی
اثر انگشت کلید امضا (SHA-256) را خواستند، در لاگ بیلد هست:

۱. برو به **Actions** در گیت‌هاب
۲. آخرین اجرای **Build APK** را باز کن
۳. مرحلهٔ **Run bash ci/build-both.sh**
۴. دنبال خط **`▸ signature:`** بگرد — زیرش SHA-256 نوشته شده

خودم نمی‌توانم برایت بخوانمش، چون لاگ کامل از این محیط قابل دانلود نیست.

## بعدش

- جواب گوگل **فقط انگلیسی** است
- **۱ تا ۲ هفته** طول می‌کشد
- اگر ایمیل «قبلاً یک اعتراض در صف است» گرفتی، **دوباره نفرست** — صف عقب می‌افتد
- 🔴 **کلید امضا (keystore) را عوض نکن.** با کلید متفاوت، اندروید نسخهٔ جدید را
  آپدیت حساب نمی‌کند

⏱ ۱۵ دقیقه + ۱ تا ۲ هفته انتظار

---

# 🟩 مرحلهٔ ۵ — ورسل

## جواب کوتاه: **هیچ چیز لازم نیست**

چک کردم. سایت زنده است، API سالم است، و **هیچ‌کدام از متغیرهای ورسل به نام
بستهٔ اندروید ربط ندارند** — نام بسته فقط داخل APK است.

| چیزی که چک کردم | نتیجه |
|---|---|
| `fbtswap.ir/api/health` | ✅ `{"ok":true}` |
| متغیرهای ورسل | ✅ هیچ‌کدام نام بسته ندارند |
| لینک دانلود در سایت | ندارد — سایت اصلاً لینک APK ندارد |

## ولی یک چیز اختیاری که ارزش دارد

`VITE_SUPPORT_EMAIL` را **نگذار** (تصمیم خودت بود که روی جی‌میل بمانی) ✅

اگر خواستی درآمد بیشتری فعال کنی، `/api/revenue/readiness` می‌گوید **۹ خط از
۱۷** الان زنده است. دو تا از بقیه **رایگان** و فقط ثبت‌نام می‌خواهند:

| خط | متغیر ورسل | کار لازم |
|---|---|---|
| Avantis | `VITE_AVANTIS_REF_CODE` | ثبت‌نام رایگان با یک امضای کیف پول در avantisfi.com |
| UTEX | `VITE_UTEX_CAMPAIGN_ID` | ثبت‌نام در partners.utex.io |

بعد از گرفتن کد: ورسل → Settings → Environment Variables → اضافه کن → **Redeploy**.

این‌ها به انتشار در بازار ربطی ندارند، جدا هستند.

⏱ صفر (هیچ کاری لازم نیست)

---

# ⚠️ چیزی که حتماً به کاربرها بگو

نام بسته عوض شده، پس اندروید این را **یک اپ جدید** می‌بیند:

- روی نسخهٔ قدیمی **آپدیت نمی‌شود** — **کنارش** نصب می‌شود
- هیچ داده‌ای منتقل نمی‌شود: نه کیف پول، نه تنظیمات، نه امتیازها

## 🔴 هشدار

> **هر کسی کیف پول داخل برنامه ساخته، قبل از حذف نسخهٔ قدیمی باید عبارت
> بازیابی‌اش را بگیرد.** نسخهٔ قدیمی را حذف کنی، اندروید داده‌هایش را هم پاک
> می‌کند و **هیچ‌کس نمی‌تواند برش گرداند.**

مسیر: نسخهٔ قدیمی → کیف پول → پشتیبان‌گیری → عبارت را بنویس → **بعد** نسخهٔ
جدید را نصب کن.

کسانی که با متامسک یا تراست‌ولت وصل می‌شوند این مشکل را ندارند.

---

# خلاصه

| # | کار | کجا | وقت |
|---|---|---|---|
| ۱ | ثبت اپ جدید در Firebase | console.firebase.google.com | ۵ د |
| ۲ | آپلود در بازار | pishkhan.cafebazaar.ir | ۲۰ د |
| ۳ | آپلود در مایکت | developer.myket.ir | ۱۵ د |
| ۴ | فرم Play Protect (اگر پیام درست بود) | لینک بالا | ۱۵ د |
| ۵ | **ورسل — هیچ کاری لازم نیست** | — | ۰ |

**پیشنهاد من:** مرحلهٔ ۲ و ۳ را زودتر از ۴ انجام بده. اعتراض به گوگل هفته‌ها
طول می‌کشد و ممکن است اصلاً جواب ندهد؛ انتشار در بازار و مایکت همین هفته نتیجه
می‌دهد.
