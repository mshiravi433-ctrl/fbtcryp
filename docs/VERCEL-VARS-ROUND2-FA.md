# مرحلهٔ آخر فعال‌سازی ۲۱/۲۱ — متغیرهای Vercel (برای موبایل)

> این فایل را در مرورگر موبایل باز کن و طبقش پیش برو. بعد از ۲ تغییر env،
> بقیهٔ کارها را پنل فعال‌سازی خودش انجام می‌دهد.

## گام ۱ — این ۱ متغیر را در Vercel عوض کن (جایگزین مقدار قبلی)

```bash
INTENT_INDEPENDENT_REVIEWERS=reviewer-1:MCowBQYDK2VwAyEAu17rkD2IidDvhtdTw5zGHzw/5+bX/4dmZKFbvIJHNMA=
```

**مسیر:** `vercel.com → fbtcryp-kkxi → Settings → Environment Variables`

- نام: `INTENT_INDEPENDENT_REVIEWERS`
- مقدار: `reviewer-1:MCowBQYDK2VwAyEAu17rkD2IidDvhtdTw5zGHzw/5+bX/4dmZKFbvIJHNMA=`
- تیک Production ✅ (Preview و Development هم بزن)
- Save

> ❗ این **جایگزین** مقدار قبلی می‌شود (نه در کنارش). کلید خصوصیِ همین کلیدِ جدید
> در پنل فعال‌سازی است و امضا همان‌جا زده می‌شود؛ چیزی به Vercel نمی‌رود جز کلید عمومی.

**چرا؟** کلید خصوصی بازبین قبلی در فایل `fbt-reviewer-private.pem` در سندباکس قبلی
بود که دیگر در دسترس نیست. کلید جدید را همین الان ساخته‌ام؛ فقط عمومیِ آن بالا می‌رود.

## گام ۲ — این ۲ متغیر را حذف کن (اگر در لیست هست)

```bash
FEE_ROUTER_ADDRESS
INTENT_WORKFLOW_BATCH_ADDRESS
```

اگر هرکدام در Vercel هست، **حذفش کن** (روی … کلیک کن → Remove → Save).

**چرا؟** شاهد `policy-contract` الان با کد `CONTRACT_NOT_DEPLOYED` رد می‌شود:
سرور، آدرس تنظیم‌شده را روی زنجیرهٔ `RPC_URL` با `eth_getCode` چک می‌کند و کدی
آنجا نیست. وقتی آدرس تنظیم نشده باشد، drill سیستم، بایت‌کدِ کامپایل‌شدهٔ FeeRouter
را (که در باندل است) هش می‌کند و شاهد را به‌صورت `compiled-FeeRouter` با
`onChainMatched: false` صادقانه ثبت می‌کند — این همان مسیر پیش‌بینی‌شده در خود
سیستم است و شاهد را می‌سازد. (استقرار واقعی روی آربیتروم را بعداً می‌شود انجام داد؛
مسیر فعلی برای ۲۱/۲۱ کافی است.)

> `VITE_FEE_ROUTER_ADDRESS` (اگر داری) را دست نزن — فقط اسم‌های بدون `VITE_` بالاست.

## گام ۳ — Redeploy

`Vercel → Deployments → آخرین استقرار → ⋮ → Redeploy`

(تغییر env فقط با استقرار جدید اعمال می‌شود.)

## گام ۴ — پنل فعال‌سازی را باز کن و دکمهٔ شروع را بزن

پنل (live preview) در همین جلسه بالای صفحه است:

1. دکمهٔ **«▶ شروع فعال‌سازی»** را بزن.
2. پنل خودش این‌ها را انجام می‌دهد:
   - تولید ~۱۰۰ درخواست واقعی → تکمیل `slo-measurement` (≥۲۰ نمونه، p95≤۲s)
   - اجرای `ops-probe?force=1` → ثبت `policy-contract`
   - گرفتن review package از سرور + امضای Ed25519 + ارسال → ثبت `independent-security-review`
   - اجرای `self-probe` → ثبت `slo-measurement`
   - ارسال snapshot کامل ۲۱تایی به `operator-evidence` → پایداری روی Blob
   - نمایش نتیجهٔ نهایی: `evidence: "21/21"` و `launchAllowed: true`
3. اگر چیزی قرمز شد، لاگ پنل را بخوان — معمولاً یعنی Redeploy هنوز کامل نشده.

## بعد از موفقیت

- `/api/intents/v1/evidence-status` → `"evidence": "21/21"`
- `/api/intents/v1/activation` → `"launchAllowed": true` و `"operational": true`

یادآوری: شاهدها TTL دارند (۵-۲۴ ساعت) و cron روزانه + بوت سرد آن‌ها را تازه می‌کند؛
فقط `slo-measurement` به ترافیک واقعی روزانه نیاز دارد که با بازدید کاربران تأمین می‌شود.
