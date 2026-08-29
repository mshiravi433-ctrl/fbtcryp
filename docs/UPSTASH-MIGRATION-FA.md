# مهاجرت رایگان از Vercel Blob به Upstash Redis

این پروژه وقتی هر دو متغیر Upstash معتبر باشند، Upstash را جایگزین کامل مسیر
`server/blobCache.js` می‌کند. در این حالت حتی اگر `BLOB_READ_WRITE_TOKEN` قدیمی هنوز
در Vercel باشد، از مسیر اصلی key-value هیچ read/write به Blob ارسال نمی‌شود.

## متغیرهای Vercel

در Settings → Environment Variables، برای Production/Preview/Development:

```text
UPSTASH_REDIS_REST_URL=https://YOUR_DATABASE.upstash.io
UPSTASH_REDIS_REST_TOKEN=YOUR_PRIVATE_REST_TOKEN
```

هیچ‌کدام نباید با `VITE_` شروع شوند. Token را در چت، Git یا screenshot عمومی قرار
ندهید.

## ترتیب انتشار

1. PR دارای adapter را به `main` merge کنید.
2. Redeploy کنید تا متغیرهای جدید وارد runtime شوند.
3. باز کنید: `/api/intents/v1/activation-config`.
4. هر دو ردیف Upstash باید `configured:true` و `active:true` باشند؛ ردیف Blob باید
   در صورت وجود Upstash، `active:false` باشد.
5. اجرا کنید: `/api/intents/v1/ops-probe?force=1`.
6. نتیجهٔ `backup-restore-drill` باید موفق باشد؛ این یک round-trip واقعی write/read/hash
   روی storage است و صرف وجود Token را قبول نمی‌کند.
7. Redeploy دیگری انجام دهید و `/api/intents/v1/evidence-status` را باز کنید. اگر
   رکوردها بعد از cold start باقی ماندند، persistence تأیید شده است.
8. حالا `BLOB_READ_WRITE_TOKEN` را از هر سه محیط Vercel حذف و دوباره Redeploy کنید.

## رفتار شکست

- URL یا Token ناقص: Upstash فعال نمی‌شود و در صورت وجود، Blob استفاده می‌شود.
- Upstash تنظیم‌شده ولی credential اشتباه/سرویس قطع: عملیات durable شکست می‌خورد؛
  سیستم آن را موفق گزارش نمی‌کند و برای پنهان‌کردن خطا به Blob پولی fallback نمی‌کند.
- هر مقدار cache با TTL واقعی Redis (`SET ... EX`) ذخیره می‌شود؛ cache دائمی و بدون
  انقضا ساخته نمی‌شود.
- status عمومی فقط نام backend و booleanها را نشان می‌دهد؛ URL و Token منتشر نمی‌شوند.

## تست محلی قرارداد storage

```bash
npm run test:upstash-store
```

این probe با REST شبیه‌سازی‌شده ثابت می‌کند که SET/GET و TTL کار می‌کنند و وقتی هر دو
credential وجود دارند هیچ درخواست Vercel Blob صادر نمی‌شود. سلامت credential واقعی
فقط با `ops-probe` همان deployment قابل اثبات است.
