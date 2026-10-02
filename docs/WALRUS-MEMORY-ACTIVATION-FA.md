# فعال‌سازی حافظهٔ بلندمدت Walrus Memory — راهنمای عملیاتی

**زمان لازم:** ۱۰ تا ۱۵ دقیقه · **پیش‌نیاز:** یک کیف پول Sui با چند سنت SUI برای یک تراکنش
**وضعیت پیش‌فرض:** خاموش. تا وقتی دو متغیر محیطی تنظیم نشوند، هیچ درخواستی به بیرون نمی‌رود.

> این سند «کارِ باقی‌مانده» را گام‌به‌گام می‌گوید. کد و سیم‌کشی کامل است و تست‌شده؛
> چیزی که فقط اپراتور می‌تواند انجام دهد، ساخت حساب روی زنجیره با کیف پول خودش است.

---

## چرا این کار را ربات/کد نمی‌تواند انجام دهد

`MemWalAccount` یک **آبجکت روی زنجیرهٔ Sui** است. ساختنش یک تراکنش با امضای کیف پول شماست و ثبت کلید delegate هم با همان کیف پول انجام می‌شود. برای انجام خودکار این کار، کد باید کلید خصوصی کیف پول شما را داشته باشد — و آن کلید نه در این اپ ذخیره می‌شود و نه جایی در چت رد و بدل می‌شود. پس تقسیم کار این است:

| کار | ابزار |
|---|---|
| ساخت حساب + ثبت کلید عمومی | کیف پول شما در داشبورد `memory.walrus.xyz` |
| ساخت کلید delegate (خصوصی) | `npm run memwal:keygen` روی سیستم خودتان |
| قرار دادن کلید در محیط deploy | پنل Vercel (متغیر محیطی) |
| اثبات کارکرد کل چرخه + سنجش تأخیر | `npm run memwal:preflight` |

---

## گام ۱ — ساخت کلید delegate (روی سیستم خودتان)

```bash
npm run memwal:keygen
```

خروجی، فقط **کلید عمومی** را نشان می‌دهد و **کلید خصوصی** را در `.env.local` می‌نویسد
(در `.gitignore` است، دسترسی `0600`). کلید خصوصی عمداً چاپ نمی‌شود؛ اگر لازم داری:

```bash
node scripts/memwal-activate.mjs keygen --no-write --print
```

نمونهٔ خروجی:

```
  public key (register THIS in the dashboard):
    <64-char hex — your own public key>
  private key: written to .env.local (git-ignored, chmod 600)
```

---

## گام ۲ — ساخت حساب و ثبت کلید (داشبورد، با کیف پول خودت)

1. به `https://memory.walrus.xyz` برو و کیف پول Sui را وصل کن.
2. **Create account** — یک تراکنش (هزینه: چند سنت SUI). یک `MemWalAccount` با شناسهٔ `0x…` می‌سازی.
3. **Add delegate key** — همان کلید عمومی گام ۱ را جای‌گذاری کن.
4. **شناسهٔ حساب (`0x…`) را کپی کن.** این شناسه عمومی است (نه راز).

⚠️ هرگز **کلید مالک** (کلید کیف پول) را در محیط سرور نگذار. کلید delegate فقط می‌تواند حافظه بخواند و بنویسد؛ کلید مالک می‌تواند حساب را منتقل کند.

---

## گام ۳ — تنظیم متغیرهای محیطی در deploy

در پنل Vercel (یا هر جای deploy) این دو متغیر را اضافه کن:

| متغیر | مقدار |
|---|---|
| `MEMWAL_ACCOUNT_ID` | `0x…` از گام ۲ (عمومی) |
| `MEMWAL_PRIVATE_KEY` | محتوای `.env.local` (راز — فقط سرور) |

با CLI:

```bash
vercel env add MEMWAL_ACCOUNT_ID production
vercel env add MEMWAL_PRIVATE_KEY production   # از .env.local کپی کن
```

سپس **re-deploy** کن. بقیهٔ تنظیمات (سقف‌ها، بودجهٔ زمانی، پیشوند namespace) اختیاری‌اند و پیش‌فرض‌شان محافظه‌کارانه است — فهرست کامل در `.env.example`.

---

## گام ۴ — پیش‌پرواز (Go/No-Go) با اندازه‌گیری واقعی

```bash
npm run memwal:preflight
```

این اسکریپت با **همان کد امضایی که تولید استفاده می‌کند** با relayer حرف می‌زند و هفت چیز را می‌سنجد:

| گام | چه چیزی ثابت می‌شود |
|---|---|
| `/health` | سرویس زنده است و `writes=ok` (نوشتن پذیرفته می‌شود) |
| `/config` | پکیج و شبکهٔ deployment خوانده می‌شود |
| `POST /api/remember` | کلید delegate معتبر است (امضا پذیرفته شد) |
| polling job | نوشتن واقعاً روی Walrus می‌نشیند (`status=done` + `blob_id`) |
| `POST /api/recall` ×۳ | همان حافظه **بر اساس معنا** برمی‌گردد + تأخیر min/median/max |
| `deadline_ms=2000` | relayer بودجهٔ زمانی را رعایت می‌کند |
| `--cleanup` | (اختیاری) namespace آزمایشی از ایندکس پاک می‌شود |

خروجی سالم:

```
  ok   relayer /health answers  status=ok writes=ok
  ok   signed /api/remember is accepted  job …
  ok   the write lands on Walrus (job reaches done)  blob … in 2400ms
  ok   recall answers  410–980ms
  ok   the written memory is recalled by meaning
  gates: reachable=yes credentials=yes signed=yes written=yes recalled=yes
  recall latency: min 410ms · median 620ms · max 980ms
  verdict: GO
```

**دریافت NO_GO یعنی چه:**

| خطا | معنا | راه‌حل |
|---|---|---|
| `NETWORK` در گام اول | دسترسی به `relayer.memory.walrus.xyz` از این محیط بسته/مسدود است | از خود سرور deploy اجرا کن، یا `MEMWAL_SERVER_URL` یک relayer دیگر (self-host) بده |
| `HTTP_401 AUTH_REJECTED` | کلید معتبر است ولی در حساب ثبت نشده | گام ۲-۳: کلید عمومی را در داشبورد اضافه کن |
| `WRITES_PAUSED` | خود relayer نوشتن را موقتاً متوقف کرده | چند ساعت بعد یا در ساعات دیگر امتحان کن |
| `TIMEOUT` در recall | تأخیر بالاست | `MEMWAL_RECALL_DEADLINE_MS` را چک کن؛ پیش‌فرض ۱۲۰۰ms و در مسیر پاسخ معطل‌کننده نیست |
| job به `failed` رسید | مشکل سمت Walrus/محدودیت سهمیه | متن خطا در خروجی `--json` هست؛ سهمیهٔ حساب را بررسی کن |

برای CI یا ثبت شواهد:

```bash
npm run memwal:preflight -- --json > preflight.json
```

بدون هیچ کلید و بدون شبکه هم می‌توانی منطق اسکریپت را بسنجی:

```bash
npm run memwal:preflight:self-test          # GO روی relayer قلابی محلی
node scripts/memwal-activate.mjs preflight --self-test --deny   # مسیر NO_GO و راهنمای رفع
```

---

## گام ۵ — تأیید اینکه روی deploy فعال است

```bash
curl -s https://<your-domain>/api/v1/ai/memory/long-term | jq '.status | {configured, enabled, mode, counters}'
```

باید `enabled: true` و `mode: "on"` ببینی. یک نوبت چت واقعی هم این را نشان می‌دهد:

```json
"context": { "longTermMemory": { "used": 2, "ok": true, "reason": null } }
```

و در `GET /api/v1/ai/memory` بخش `longTerm.counters` می‌گوید چند بار خواند، چند بار نوشت، چند بار رد شد.

---

## گام ۶ — پایش و تصمیم‌های بعدی

| سنجه | کجا | آستانهٔ سالم |
|---|---|---|
| نرخ خطای recall | `longTerm.counters.recall.failed` | نزدیک صفر |
| timeout | `longTerm.counters.recall.timeout` | نزدیک صفر (اگر بالا بود relayer کند است) |
| نوشتن‌های واقعی | `longTerm.counters.remember.sent` | > ۰ در روزهای معمول |
| رد شدن به‌خاطر سهمیه | `...remember.rateLimited` | اگر زیاد شد، یعنی حساب به سقف نزدیک است |
| نوشتن ماندگار جلسهٔ | `persistence.lastError` در `GET /api/v1/ai/memory` | `null` |
| تأخیر بازیابی | خروجی `preflight` یا لاگ relayer | p95 زیر ~۲ ثانیه |

**خاموش‌کردن فوری (بدون انتشار مجدد کد):** `MEMWAL_ENABLED=0` در محیط، یا حذف `MEMWAL_ACCOUNT_ID`. دستیار بلافاصله به رفتار قبلی برمی‌گردد و هیچ درخواستی به بیرون نمی‌رود. کلیدها باقی می‌مانند.

**باطل‌کردن کلید (اگر لو رفت):** در داشبورد کلید delegate را revoke کن، بعد `npm run memwal:keygen` یک کلید تازه می‌سازد و همان چرخهٔ گام ۲ تا ۴ را تکرار کن.

---

## دو نکتهٔ صریح

1. **در حالت پیش‌فرض، relayer میزبان متن حافظه را در مسیر پردازش می‌بیند** (برای embedding و رمزنگاری). کد ما پیش از هر ارسال، `sanitize()` پروژه + فیلتر PII را اجرا می‌کند، اما اگر این مدل اعتماد برایت کافی نیست، دو مسیر جایگزین در سند ارزیابی آمده است: **self-host کردن relayer** (`MEMWAL_SERVER_URL` را به آن بده) یا مسیر manual.
2. **هیچ عدد مالی هرگز به این لایه نمی‌رود.** فقط ترجیح‌ها، اهداف، تصمیم‌ها و فکت‌های گفتگو. موجودی و سفارش همیشه از زنجیره خوانده می‌شوند.

---

## دستورهای مرجع

| دستور | کار |
|---|---|
| `npm run memwal:keygen` | ساخت کلید delegate؛ عمومی → داشبورد، خصوصی → `.env.local` |
| `npm run memwal:status` | آیا این فرایند تنظیم و روشن است؟ نصیحت گام بعدی |
| `npm run memwal:preflight` | پیش‌پرواز زنده + اندازه‌گیری تأخیر + حکم Go/No-Go |
| `npm run memwal:preflight -- --cleanup` | همان + پاک‌کردن namespace آزمایشی از ایندکس |
| `npm run memwal:preflight -- --json` | خروجی ماشین‌خوان برای CI/شواهد |
| `npm run memwal:preflight:self-test` | اجرای کل چرخه روی relayer قلابی محلی (بدون کلید/شبکه) |
| `npm run test:memory` | ۱۰۳ assertion روی پل، تداوم حافظه، سیم‌کشی و همین کیت فعال‌سازی |
