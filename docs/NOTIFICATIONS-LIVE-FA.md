# زنده‌کردن زنجیرهٔ نوتیفیکیشن — هم سایت، هم اپ (گام‌به‌گام با لینک)

> تاریخ: ۲۰۲۶/۰۹/۱۰ · روی برنچ `main`. این سند فقط **روشن‌کردن** چیزی است که ساخته و
> سبز شده است؛ کد تحویل کامل است. چیزی که می‌ماند، ست‌کردن متغیرها در داشبورد ورسل
> و راستی‌آزمایی روی دستگاه واقعی است — برای **هر دو** نسخه:
> **سایت/مرورگر (Web Push)** و **اپ اندروید (FCM)**.

## چه چیزی همین حالا در کد هست و سبز است؟ (پیش‌زمینه)

- سایت/مرورگر/PWA از VAPID و `POST /api/push/subscribe` استفاده می‌کند (`server/push.js`).
- اپ اندروید (Capacitor) از `@capacitor/push-notifications` و FCM استفاده می‌کند و توکن را
  به `POST /api/push/fcm` می‌فرستد (`server/fcm.js`، `src/lib/notify.js`).
- هر دو کانال با یک تحویل‌دهندهٔ مشترک (`sendWatchAlert`/`deliverStagePush`) به دستگاهِ
  مخاطب می‌رسند: سفارش‌ها (`/api/cron/daily` → `runWatchCycle`)، مانیتورهای بازار،
  هشدارهای smart-money و پروموی روزانه. خطای قدیمی «بدون کال‌بک اجرا شد و اعلان بی‌صدا
  حذف شد» رفع شده و سه پروب مربوطه سبزند:
  `node test/native-notify-probe.mjs`، `node test/watch-push-probe.mjs`،
  `node test/intent-ai/phase67-notifications-probe.mjs`.

پس «درست‌نشدن اعلان» الان در بیشتر موارد یعنی **متغیرهای محیطی تنظیم یا بازپخش نشده‌اند**،
نه باگ کد.

---

## ۰ · چک اولیه (۱۰ ثانیه)

از کامپیوتر خودت (اینجا اینترنت عمومی در دسترس نیست) این سندِ تمام‌چک را اجرا کن:

```bash
BASE_URL=https://fbtswap.ir node scripts/notify-verify.mjs
```

خروجی، وضعیت هر دو کانال را جدا می‌گوید: `SITE … VAPID` و `APP … FCM`، دلیلِ خاموش‌بودن
(کلید نیست؟ PEM نیست؟ `\n`ها ریخته؟)، plus بودنِ حافظهٔ ماندگار و `CRON_SECRET`. تمام
ردیف‌های `❌` را طبق گام‌های پایین درست کن.

> آدرس پروژهٔ ورسل اصلی `fbtcryp-kkxi` است (نه `fbtcryp4`). مسیر ست کردن هر متغیر یکسان است:
>
> **https://vercel.com/dashboard → `fbtcryp-kkxi` → Settings → Environment Variables → Add → تیک Production و Preview → Save → تب Deployments → ⋯ بالایین → Redeploy (تیک کش را بردار)**
>
> متغیرها فقط در لحظهٔ بوت خوانده می‌شوند؛ **Save بدون Redeploy کافی نیست.**

---

## ۱ · کانال سایت — Web Push (VAPID)

| متغیر | جنس | توضیح |
|---|---|---|
| `VITE_VAPID_PUBLIC_KEY` | عمومی | در build کلاینت می‌رود؛ راز نیست |
| `VAPID_PRIVATE_KEY` | **راز** | فقط سمت سرور |
| `VAPID_SUBJECT` | عمومی | مثل `mailto:support@fbtswap.ir` |

ساخت جفت‌کلید (یک‌بار، با `npx web-push generate-vapid-keys` روی دستگاه خودت یا
ابزار تولید کلید در صفحهٔ push امن) → عمومی را در `VITE_VAPID_PUBLIC_KEY` و خصوصی را در
`VAPID_PRIVATE_KEY` بگذار → Redeploy.

**راستی‌آزمایی:** `GET https://fbtswap.ir/api/push/status` باید
`"web": true` بدهد. (این endpoint هیچ رازی برنمی‌گرداند.)

---

## ۲ · کانال اپ — FCM (اندروید)

| متغیر | جنس | توضیح |
|---|---|---|
| `FIREBASE_PROJECT_ID` | عمومی | باید `fbtswap-36b13` باشد |
| `FIREBASE_CLIENT_EMAIL` | عمومی | `client_email` از فایل سرویس‌اکانت |
| `FIREBASE_PRIVATE_KEY` | **راز** | `private_key` از همان فایل — **کل رشته** با همان `\n`ها |

نکتهٔ امنیتی مهم: کلید سرویس‌اکانت **دسترسی کامل ادمین به دیتابیس** می‌دهد و فقط سمت سرور
است (هیچ `VITE_` ندارد). اگر لو رفته باشد، تنها راه **حذف در کنسول گوگل** است، نه عوض‌کردن
رمز. راهنمای کامل ساخت/چرخش کلید:
- کجا بگذارم؟ [`WHERE-TO-PUT-KEYS-FA.md`](WHERE-TO-PUT-KEYS-FA.md)
- چطور بسازم/بچرخانم؟ [`ROTATE-KEYS-STEPS-FA.md`](ROTATE-KEYS-STEPS-FA.md)
- کنسول: **https://console.cloud.google.com/iam-admin/serviceaccounts** (پروژهٔ `fbtswap-36b13`)

پروژهٔ واقعی اپ `fbtswap-36b13` است و `android/app/google-services.json` همان را دارد.
هر راهنمای قدیمی که `fbt-room-a46fc` می‌گوید نادیده بگیر.

**سه حالت خرابی رایج کلید خصوصی** (که `fcmDiagnose` جدا جدا نشان می‌دهد):
1. متغیر ذخیره نشده / Redeploy نشده → `present:false`
2. دورِ `BEGIN/END PRIVATE KEY` هنگام کپی بریده شده → `looksPem:false`
3. دنبالهٔ `\n` صاف شده (شایع‌ترین؛ همان خطای گمراه‌کنندهٔ `invalid_grant`) → `hasNewlines:false`

**راستی‌آزمایی (از خود گوگل می‌پرسد):**
```bash
curl -s https://fbtswap.ir/api/push/selftest
```
این endpoint یک OAuth واقعی می‌سازد و با توکنِ عمداً نامعتبر به FCM می‌زند؛ هیچ‌چیز به
دستگاهی نمی‌رسد. `"ok": true, "stage":"SEND"` یعنی احراز هویت و پروژه درست‌اند و فقط
توکنِ آزمایشی رد شده است.

---

## ۳ · ماندگاری + اجرای دستی چرخهٔ روزانه

| متغیر | چرا لازم است |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | بدون آن `store` هر instance مجزاست و با cold start فراموش می‌شود؛ اشتراک‌ها و توکن‌های FCM نمی‌مانند. از **Vercel → پروژه → تب Storage** |
| `CRON_SECRET` | مسیرهای `/api/cron/*` را گیت می‌کند و برای اجرای دستیِ همان چرخه لازم است |

اجرای دستیِ همان چیزی که ورسل هر روز ۰۹:۰۰ UTC می‌زند:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     https://fbtswap.ir/api/cron/daily
```
خروجی باید شامل `web: {sent,failed…}`، `fcm: {sent,failed…}` و `watch: {checked,triggered,sent}` باشد.

> ⚠️ **سقف واقعی ورسل Hobby:** هر cron فقط **روزی یک‌بار** می‌تواند بریزد
> (مستند: [`VERCEL-CRON-HOBBY-FA.md`](VERCEL-CRON-HOBBY-FA.md)). پس هشدارِ سفارش/قیمت
> حداکثر در اجرای بعدیِ چرخهٔ روزانه می‌رسد، نه لحظه‌ای. این محدودیتِ پلن است، نه باگ؛
> اعلان «با اپ بسته می‌رسد» ولی با تأخیرِ حداکثر یک روز.

---

## ۴ · راستی‌آزمایی نهایی روی دستگاه — سایت و اپ

### سایت (مرورگر / PWA)
1. باز کن `https://fbtswap.ir` → تنظیمات → اعلان‌ها → اجازه بده.
2. چک کن `GET /api/push/status` حالا `subscribers` را **۱** بالا نشان دهد.
3. یک سفارش حد/قیمت تنظیم کن و قیمت هدف را بزن. اعلانِ وب‌پوش باید در shade سیستم بیاید.
4. بعد از رسیدن، `subscribers` کم نشده و endpoint هرگز در `❌` نیفتاده باشد.

### اپ (APK اندروید، Android 13+)
1. `GET /api/push/status` → `devices` را ببین؛ بعد مجوز اعلان را در اپ بده → توکن FCM ثبت
   می‌شود و `devices` بالا می‌رود.
2. همان سفارش/مانیتور را بگذار، اپ را کامل ببند، قیمت هدف را بزن.
3. اعلان FCM باید با اپِ بسته برسد و روی آن بزنی → به مسیر داخلی (مثلاً `/orders`) برود.
   (فقط مسیرهای داخلی باز می‌شوند؛ URL خارجی/مسیر ناشناخته رد می‌شود.)

> اگر `subscribers` یا `devices` صفر است، **به معنی خرابی نیست** — یعنی هنوز کسی اجازهٔ
> نوتیفیکیشن نداده است؛ ثبت‌نام کاملاً opt-in است.

---

## جمع‌بندی چک‌لیست

| # | کار | کجا | هزینه |
|---|---|---|---|
| ۱ | `scripts/notify-verify.mjs` را اجرا کن | خودت | رایگان |
| ۲ | `VITE_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | [vercel.com/dashboard](https://vercel.com/dashboard) → `fbtcryp-kkxi` | رایگان |
| ۳ | `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | همان + [console.cloud.google.com](https://console.cloud.google.com/iam-admin/serviceaccounts) | رایگان |
| ۴ | `BLOB_READ_WRITE_TOKEN` (تب Storage) + `CRON_SECRET` | همان | رایگان |
| ۵ | بعد از هر Save → **Redeploy** با تیک کش برداشته | همان | — |
| ۶ | `/api/push/selftest` و `/api/push/status` را چک کن | خودت | رایگان |
| ۷ | تست روی دستگاه واقعی (سایت و اپ) از بخش ۴ | خودت | رایگان |

- **خودِ سند را یک‌جا ببین:** [`NOTIFICATIONS-AUDIT-FA.md`](NOTIFICATIONS-AUDIT-FA.md) (ممیزی)
  و [`NOTIFY-DIAGNOSIS-FA.md`](NOTIFY-DIAGNOSIS-FA.md) (ریشه‌یابی قبلی).
- **سند وضعیت سرور کرون/پوش:** `GET /api/cron/status` — همهٔ متغیرهایِ موجود/گمشده را برای
  هر دو کانال می‌گوید.
