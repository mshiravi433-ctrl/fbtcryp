# فرم Play Protect — لینک و متن آماده

> برای نسخهٔ **۱.۲۸.۰** · بستهٔ **`ir.fbtswap.app`** · ۱۸ مرداد ۱۴۰۵
> هر ادعای داخل متن را با `AndroidManifest.xml` چک کردم. چیزی از خودم ننوشتم.

---

# 🔴 اول این را بخوان — ممکن است اصلاً لازم نباشد

سند رسمی گوگل را همین الان خواندم (آخرین به‌روزرسانی: ۲۰۲۶-۰۷-۲۹). **نوع پیامی
که کاربر می‌بیند تعیین می‌کند فرم فایده دارد یا نه:**

| پیامی که کاربر دیده | فرم جواب می‌دهد؟ |
|---|---|
| **"App blocked to protect your device"** | ✅ بله |
| **"Harmful App Blocked"** | ✅ بله |
| **"This app is unknown to Play Protect. To protect yourself and others, send it to Google for a security check"** | ❌ **نه** |

برای پیام سوم، خودِ گوگل نوشته:

> *"Appeals are not relevant and won't remove this message."*

**پس اول از بازار بپرس دقیقاً کدام جمله را دیده‌اند.** اگر جملهٔ سوم بود،
فرستادن فرم فقط وقت تلف کردن است — راه حلش انتشار در APKPure و Uptodown است تا
Play Protect اپ را بشناسد.

---

# لینک فرم

```
https://support.google.com/googleplay/android-developer/contact/protectappeals
```

⚠️ **بدون تغییر IP باز نمی‌شود** و به صفحهٔ دیگری منتقل می‌شوی. اول IP را عوض
کن، بعد لینک را باز کن.

---

# فیلدهای فرم

| فیلد | چه بنویسی |
|---|---|
| Package name | `ir.fbtswap.app` |
| App name | `FBT Swap` |
| Developer / Company | `Fanous Bazaar Pishgam Co.` |
| Contact email | `fbtswap@gmail.com` |
| URL to download your APK | لینک زیر ⬇️ |

## 🔴 فیلد لینک APK — اینجاست که اکثر اعتراض‌ها رد می‌شوند

رایج‌ترین جواب رد:

> *"The link you have provided does not lead to an APK file or the file is corrupted"*

چون یک **ربات** فایل را دانلود می‌کند. صفحهٔ HTML، صفحهٔ «برای دانلود کلیک
کنید»، یا لینکی که لاگین بخواهد — همه رد می‌شوند.

**این لینک را بگذار** (مستقیم خودِ فایل، بدون لاگین):

```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/download/latest/app-release.apk
```

❌ **این را نگذار** (صفحهٔ HTML است، رد می‌شود):
`https://github.com/mshiravi433-ctrl/fbtcryp/releases/latest`

---

# متن توضیحات — این را کامل کپی کن

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

## چرا این متن این‌طور نوشته شده

تصادفی نیست. مستقیماً به معیارهای خودِ گوگل جواب می‌دهد:

گوگل نوشته اپی که از اینترنت دانلود شود **و** یکی از چهار مجوز حساس زیر را
بخواهد، خودکار مسدود می‌شود:

| مجوز حساس | ما داریم؟ |
|---|---|
| `RECEIVE_SMS` | ❌ نداریم |
| `READ_SMS` | ❌ نداریم |
| `NOTIFICATION_LISTENER` | ❌ نداریم |
| `ACCESSIBILITY` | ❌ نداریم |

**هیچ‌کدام را نداریم** — از `AndroidManifest.xml` چک کردم. کل مجوزهای ما شش‌تاست
و همان شش‌تا در متن نام برده و توضیح داده شده‌اند.

سه چیز دیگر هم که گوگل به آن‌ها حساس است، همه سبزند:

| مورد | ما |
|---|---|
| `targetSdkVersion` قدیمی | ✅ **۳۵** — جدیدترین |
| `usesCleartextTraffic` | ✅ **false** |
| `android:debuggable` | ✅ ندارد — بیلد release |
| امضا | ✅ کلید release، نه debug |

---

# دربارهٔ «هش» که پرسیدی

**فرم Play Protect هش نمی‌خواهد.** فقط لینک APK و متن بالا. کل فیلدهایش را
بالاتر نوشتم.

ولی اگر جای دیگری (مثلاً بازار) اثر انگشت کلید امضا را خواست:

۱. گیت‌هاب → تب **Actions**
۲. آخرین اجرای **Build APK** را باز کن
۳. مرحلهٔ **Run bash ci/build-both.sh**
۴. دنبال خط `▸ signature:` بگرد — SHA-256 زیرش نوشته شده

**خودم نمی‌توانم برایت بخوانمش** — لاگ کامل از این محیط قابل دانلود نیست و
عددی از خودم نمی‌سازم.

---

# بعد از فرستادن

- جواب گوگل **فقط انگلیسی** است
- معمولاً **۱ تا ۲ هفته**
- اگر ایمیل «قبلاً یک اعتراض در صف بررسی است» گرفتی، **دوباره نفرست** — دو بار
  فرستادن صف را عقب می‌اندازد
- 🔴 **کلید امضا را عوض نکن.** اینترنت پر است از توصیهٔ «کلید جدید بساز». برای
  ما فاجعه است: با کلید متفاوت، اندروید نسخهٔ جدید را آپدیت حساب نمی‌کند و هر
  کسی اپ را نصب کرده باید اول حذفش کند. ضمناً چند نفر گزارش داده‌اند کلید جدید
  هم بعد از چند روز دوباره مسدود شده — یعنی مشکل را حل نمی‌کند

# 💡 راهی که موازی با این جواب می‌دهد و سریع‌تر است

انتشار در **APKPure** و **Uptodown**. وقتی اپ از چند منبع شناخته‌شده پخش شود و
نصب واقعی بگیرد، Play Protect زودتر آن را در پایگاه داده‌اش ثبت می‌کند — و این
دقیقاً همان چیزی است که مشکل «unknown» را حل می‌کند، نه فرم.

هیچ‌کدام این ایراد را نمی‌گیرند و منتظر گوگل هم نمی‌مانند.

| فروشگاه | لینک |
|---|---|
| APKPure | https://developer.apkpure.com |
| Uptodown | https://www.uptodown.dev/#/sign-up |

**صادقانه: این را زودتر از فرم انجام بده.**
