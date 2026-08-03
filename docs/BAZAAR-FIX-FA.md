# دو ایراد کافه‌بازار — چه کار کنیم

> نوشته: ۱۲ مرداد ۱۴۰۵ · برای **v1.13.1 / versionCode 35**

بازار دو تا ایراد گرفته. یکی‌شان **کاملاً حل‌شدنی است و خبر خوبی دارد**،
یکی‌شان **پول و مدرک می‌خواهد**. جدا بررسی‌شان می‌کنم.

---

# ایراد ۱ — Blocked by Play Protect

## اول یک خبر خوب: اپ ما مورد بدی ندارد

قبل از پر کردن هر فرمی، رفتم سند رسمی گوگل را خواندم
([Developer Guidance for Play Protect Warnings](https://developers.google.com/android/play-protect/warning-dev-guidance))
و اپ خودمان را با آن تطبیق دادم. این مهم است، چون فرم اعتراض فقط وقتی جواب
می‌دهد که اپ واقعاً تمیز باشد — وگرنه فقط رد می‌شوی و دو هفته وقت رفته.

گوگل می‌گوید نصب را **خودکار مسدود می‌کند** اگر اپی از اینترنت دانلود شده
باشد **و** یکی از این چهار مجوز حساس را بخواهد:

| مجوز حساس | اپ ما دارد؟ |
|---|---|
| `RECEIVE_SMS` | ❌ ندارد |
| `READ_SMS` | ❌ ندارد |
| `NOTIFICATION_LISTENER` | ❌ ندارد |
| `ACCESSIBILITY` | ❌ ندارد |

**هیچ‌کدام را نداریم.** کل مجوزهای اپ ما این شش‌تاست:

```
INTERNET · ACCESS_NETWORK_STATE · USE_BIOMETRIC
VIBRATE · CAMERA · POST_NOTIFICATIONS
```

سه چیز دیگر را هم که گوگل به آن‌ها حساس است چک کردم:

| مورد | وضعیت ما |
|---|---|
| `targetSdkVersion` قدیمی (هشدار «ساخته‌شده برای نسخهٔ قدیمی») | ✅ **35** — جدیدترین |
| `android:debuggable` | ✅ ندارد — بیلد release است |
| `usesCleartextTraffic` (HTTP رمزنگاری‌نشده) | ✅ **false** |
| امضا | ✅ کلید release، نه debug |

**نتیجه:** ما مورد واقعی نداریم. پس این چیست؟

## پس چرا مسدود می‌شود؟

چون **اپ ما را نمی‌شناسد**. گوگل هر APK تازه‌ای را که از بیرون پلی‌استور
نصب شود، تا وقتی در پایگاه دادهٔ Play Protect ثبت نشده، **ناشناس** حساب
می‌کند. این یک اتهام نیست، یک «هنوز ندیده‌امت» است.

> ⚠️ **یک نکتهٔ مهم از سند گوگل که خیلی‌ها اشتباه می‌کنند:**
> اگر پیامی که کاربر می‌بیند این باشد —
> *"This app is unknown to Play Protect. To protect yourself and others, send
> it to Google for a security check"* — گوگل صریحاً نوشته
> **«Appeals are not relevant and won't remove this message»**.
> یعنی فرم برای این پیام بی‌فایده است.
>
> فرم فقط برای پیام **«App blocked to protect your device»** یا
> **«Harmful App Blocked»** کار می‌کند. اول ببین بازار دقیقاً کدام را
> گزارش کرده.

## کار کن: فرم اعتراض

**لینک رسمی:**
```
https://support.google.com/googleplay/android-developer/contact/protectappeals
```

⚠️ حرف بازار درست است: **بدون تغییر IP فرم باز نمی‌شود** و به صفحهٔ دیگری
منتقل می‌شوی. IP را عوض کن، بعد لینک را باز کن.

### فرم را این‌طور پر کن

| فیلد | چه بنویسی |
|---|---|
| Package name | `ir.fbt.swap` |
| App name | `FBT Swap` |
| Developer / Company | `Fanous Bazaar Pishgam Co.` |
| Contact email | `fbtswap@gmail.com` |
| URL to download your APK | ⚠️ پایین بخوان — مهم‌ترین بخش فرم |

### 🔴 فیلد لینک APK — جایی که اکثر اعتراض‌ها رد می‌شوند

رایج‌ترین جواب رد گوگل این است:

> *"The link you have provided does not lead to an APK file or the file is
> corrupted"*

چون گوگل یک **ربات** است که فایل را دانلود می‌کند. صفحهٔ HTML، صفحهٔ
«برای دانلود کلیک کنید»، یا لینکی که اول لاگین بخواهد، همه رد می‌شوند.

**لینک ما مستقیم است و مشکلی ندارد:**
```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/download/latest/app-release.apk
```

این آدرس مستقیماً خودِ فایل را می‌دهد (نه صفحهٔ ریلیز)، عمومی است، و لاگین
نمی‌خواهد. **همین را بگذار.**

> اگر به هر دلیل رد شد، فایل را در Dropbox بگذار و در انتهای لینک
> `?dl=0` را به **`?dl=1`** تغییر بده — این تفاوت بین «صفحهٔ پیش‌نمایش» و
> «دانلود مستقیم» است و دقیقاً همان چیزی است که خیلی‌ها را گیر انداخته.

### فیلد توضیحات — این متن را کپی کن

فرم می‌خواهد اپ را توصیف کنی و بگویی چرا دسترسی‌های حساس داری. متن زیر را
نوشته‌ام تا مستقیماً به معیارهای خود گوگل جواب بدهد
(Mobile Unwanted Software principles و تعریف PHA):

```
FBT Swap (ir.fbt.swap) is a non-custodial cryptocurrency swap interface for
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
website is https://www.lawpoetics.ir

We believe the block is a false positive caused by the app being newly
published and not yet known to Play Protect, rather than by any behaviour
matching the Mobile Unwanted Software principles or the Potentially Harmful
Application definitions.
```

### بعدش

- جواب گوگل **فقط انگلیسی** است (خودشان نوشته‌اند).
- معمولاً **۱ تا ۲ هفته** طول می‌کشد. اگر ایمیل «قبلاً یک اعتراض در صف
  بررسی است» گرفتی، **دوباره نفرست** — دو بار فرستادن صف را عقب می‌اندازد.
- **کلید امضا (keystore) را عوض نکن.** اینترنت پر است از توصیهٔ «کلید جدید
  بساز». برای ما فاجعه است: با کلید متفاوت، اندروید نسخهٔ جدید را
  به‌روزرسانی حساب نمی‌کند و هر کسی که اپ را نصب کرده باید اول حذفش کند.
  ضمناً چند نفر در همان بحث‌ها گفته‌اند کلید جدید هم بعد از چند روز دوباره
  مسدود می‌شود — یعنی مشکل را حل نمی‌کند، فقط عقب می‌اندازد.

### 💡 و راه دومی که موازی با این کار می‌کند

انتشار در **APKPure** و **Uptodown**. وقتی اپ از چند منبع شناخته‌شده پخش
شود و نصب واقعی بگیرد، خود Play Protect زودتر آن را در پایگاه داده‌اش ثبت
می‌کند. این‌ها هیچ‌کدام این ایراد را نمی‌گیرند و منتظر گوگل هم نمی‌مانند.
(راهنمای کاملش در `store/UPLOAD-KIT-EN.md`.)

---

# ایراد ۲ — ایمیل سازمانی

## این یعنی چه

بازار ایمیلی می‌خواهد **روی دامنهٔ خودت**، نه جی‌میل:

```
❌ fbtswap@gmail.com
✅ info@lawpoetics.ir   یا   support@lawpoetics.ir
```

دلیلش این است که جی‌میل را هرکسی در سی ثانیه می‌سازد، ولی ایمیل روی یک
دامنه یعنی واقعاً آن دامنه را کنترل می‌کنی — یک لایه احراز هویت ارزان برای
آن‌ها.

## خبر خوب: دامنه را از قبل داری

`lawpoetics.ir` مال خودت است و سایت روی همان بالاست. یعنی **نصف کار انجام
شده**؛ فقط باید سرویس ایمیل به آن وصل شود.

## سه راه، از ارزان به گران

### راه ۱ — سرویس ایمیل ایرانی (پیشنهاد من)

سرویس‌هایی مثل **لیارا**، **میلفا** یا **پارس‌پک** روی دامنهٔ `.ir` ایمیل
می‌دهند، پرداخت ریالی دارند و فیلتر نیستند. ارزان‌ترین پلن‌ها معمولاً
ماهی چند ده هزار تومان است.

| سرویس | لینک |
|---|---|
| لیارا | https://liara.ir/products/business-email/ |
| میلفا | https://mailfa.com/email-hosting |
| پارس‌پک | https://parspack.com |

بعد از ساختن، **forwarding** را روشن کن تا هرچه به `info@lawpoetics.ir`
می‌آید داخل همان جی‌میل فعلی‌ات بیفتد — نیازی نیست صندوق جدیدی را چک کنی.

> ⚠️ **یک نکتهٔ فنی که ممکن است سایت را بخواباند:** سرویس ایمیل از تو
> می‌خواهد رکورد **MX** به DNS دامنه اضافه کنی. رکوردهای `A` و `CNAME` که
> الان دامنه را به Vercel وصل کرده‌اند را **دست نزن** — فقط MX را اضافه کن.
> MX فقط ایمیل را مسیریابی می‌کند و به سایت کاری ندارد. اگر اشتباهی A را
> عوض کنی، `lawpoetics.ir` از دسترس خارج می‌شود.

### راه ۲ — Zoho Mail

پلن رایگانش یک دامنه و پنج کاربر می‌دهد. **ولی** ثبت‌نام از IP ایران معمولاً
مشکل دارد و حساب‌های ایرانی سابقهٔ بسته‌شدن دارند. اگر ایمیل پشتیبانی رسمی
اپت وسط کار قطع شود، بدتر از نداشتنش است. **پیشنهاد نمی‌کنم.**

### راه ۳ — Google Workspace

ماهی حدود ۶ دلار، و کارت خارجی می‌خواهد. برای این مرحله بی‌مورد است.

## بعد از ساختن ایمیل، این‌جاها را عوض کن

آدرس ایمیل در چند جای پروژه نوشته شده. وقتی ایمیل سازمانی آماده شد، بگو تا
همه را با هم به‌روز کنم:

| کجا | الان |
|---|---|
| `index.html` (داده‌های ساختاریافته) | `fbtswap@gmail.com` |
| صفحهٔ تماس در اپ | `fbtswap@gmail.com` |
| `store/UPLOAD-KIT-EN.md` | `fbtswap@gmail.com` |
| فرم فروشگاه‌ها | `fbtswap@gmail.com` |

---

# جمع‌بندی — به ترتیب کاری

| # | کار | هزینه | چقدر طول می‌کشد |
|---|---|---|---|
| ۱ | ببین بازار دقیقاً کدام پیام Play Protect را گفته | — | ۲ دقیقه |
| ۲ | با تغییر IP فرم اعتراض را بفرست | رایگان | ۱۵ دقیقه + ۱–۲ هفته انتظار |
| ۳ | **همزمان** در APKPure و Uptodown منتشر کن | رایگان | ~۳۵ دقیقه |
| ۴ | ایمیل سازمانی روی `lawpoetics.ir` بگیر | ~ماهی چند ده هزار تومان | ۳۰ دقیقه |
| ۵ | ایمیل جدید را در پروژه جایگزین کن | — | من انجام می‌دهم |

**صادقانه:** مرحلهٔ ۳ را زودتر از ۲ نتیجه می‌دهد. اعتراض به گوگل هفته‌ها طول
می‌کشد و تضمینی هم نیست؛ APKPure و Uptodown هیچ‌کدام این دو ایراد را
نمی‌گیرند و کاربر واقعی می‌آورند — که تنها چیزی است که الان کم داریم.
