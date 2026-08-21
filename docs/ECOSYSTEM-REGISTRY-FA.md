# رجیستری ایجنت/استراتژی (کاتالوگ اکوسیستم)

این سند وضعیت واقعی `/api/ecosystem/*` را توضیح می‌دهد: چه چیزی ساخته شد،
چه چیزی عمداً ساخته **نشد**، و برای فعال‌شدن در پروداکشن چه چیزی لازم است.

## خلاصه

پیش از این `server/ecosystemCatalog.js` یک استاب بود و همیشه
`{"data": [], "dataStatus": "unavailable"}` برمی‌گرداند. حالا کاتالوگ از یک
رجیستری پایدارِ احرازشده می‌خواند:

- خواندن: عمومی و فقط‌خواندنی.
- نوشتن: فقط با احراز هویت تلگرام (`x-telegram-init-data`)، با کلید
  idempotency، و پس از عبور از اعتبارسنج‌های fail-closed.
- هیچ مسیری برای اجرا، امضا، برداشت وجه یا نگه‌داری وجوه وجود ندارد.

## فایل‌ها

| فایل | نقش |
| --- | --- |
| `server/ecosystemRegistry.js` | ذخیره/خواندن پایدار + مالکیت + پروجکشن فیلدهای مجاز |
| `server/ecosystemCatalog.js` | پاسخ `fbt.resource-list.v1` با `dataStatus` صادقانه |
| `server/ecosystemSchemas.js` | `validateAgent`, `validateStrategy`, `validateLiquidityProvider` |
| `server/app.js` | routeهای `/api/ecosystem/*` |
| `src/lib/ecosystemCatalog.js` | کلاینت فقط‌خواندنی (بدون هیچ نویسنده‌ای) |
| `src/pages/IntentOS.jsx` | تب‌های Agents و Strategies |
| `server/ecosystemCertifications.js` | صدور/باطل‌کردن گواهی + اشتقاق نشان «گواهی‌شده» |
| `server/ecosystemReputation.js` | اعتبار مشاهده‌شده و تجمیعی از مشاهدات اجرا |
| `server/portfolioAgents.js` | پیکربندی approval-only پرتفوی |
| `server/developerKeys.js` | ساخت/باطل‌کردن/**احراز هویت** کلید API |

کلیدهای store (نسخه‌دار): `ecosystem-agents:v1`، `ecosystem-strategies:v1`،
`ecosystem-liquidity:v1`. مالک هر رکورد داخل خود رکورد در `ownerId` نگهداری
می‌شود و **هرگز** در پاسخ عمومی برنمی‌گردد.

## endpointها

خواندن (عمومی):

```
GET /api/ecosystem/agents?cursor=<id>&limit=<1..50>
GET /api/ecosystem/strategies
GET /api/ecosystem/liquidity
```

نوشتن (نیازمند تلگرام + هدر `idempotency-key`):

```
POST /api/ecosystem/agents                 ← validateAgent
POST /api/ecosystem/agents/:id             ← ویرایش، فقط مالک
POST /api/ecosystem/agents/:id/unlist      ← حذف از فهرست، فقط مالک
POST /api/ecosystem/strategies             ← validateStrategy
POST /api/ecosystem/strategies/:id
POST /api/ecosystem/strategies/:id/unlist
POST /api/ecosystem/liquidity              ← همیشه 405 (فقط‌خواندنی)
```

کدهای خطا: `AUTH_REQUIRED` (۴۰۱)، `FORBIDDEN_PERMISSION` /
`AUTOMATIC_EXECUTION_FORBIDDEN` / `MAX_AMOUNT_REQUIRED` … (۴۰۰)،
`NOT_ENTRY_OWNER` (۴۰۳)، `ENTRY_NOT_FOUND` (۴۰۴)، `TYPE_NOT_WRITABLE` (۴۰۵)،
`ENTRY_ID_TAKEN` / `DUPLICATE_ENTRY` / `IDEMPOTENCY_CONFLICT` (۴۰۹)،
`REGISTRY_STORE_UNAVAILABLE` (۵۰۳، `retryable: true`).

## `dataStatus` یعنی چه

- `live` → یک رجیستری پایدار پاسخ داد. آرایهٔ خالی یعنی «هنوز کسی ثبت نکرده».
- `unavailable` → هیچ ذخیره‌سازی پایداری پیکربندی نشده. آرایهٔ خالی یعنی
  «نمی‌دانیم»، نه «چیزی وجود ندارد». UI این دو حالت را با دو متن متفاوت
  نشان می‌دهد.

فعال‌سازی نوشتن در پروداکشن یک شرط دارد: `BLOB_READ_WRITE_TOKEN` تنظیم باشد
(همان توکنی که کش پایدار AI از آن استفاده می‌کند). بدون آن، نوشتن با ۵۰۳ رد
می‌شود؛ چون یک نوشتنِ غیرپایدار در اولین cold start ناپدید می‌شد و کاربر
تصور می‌کرد ثبت انجام شده است.

## مرز ایمنی (عمدی و غیرقابل دور زدن)

1. هر نوشتن از `validateAgent` / `validateStrategy` عبور می‌کند و **خروجی
   اعتبارسنجی‌شده** ذخیره می‌شود، نه ورودی خام. این اعتبارسنج‌ها
   `permissions.withdrawFunds`، `permissions.executeWithoutUser` و
   `action.automaticExecution` را رد می‌کنند.
2. اعتبارسنجی **پیش از** مصرف کلید idempotency و پیش از لمس ذخیره‌سازی اجرا
   می‌شود (`screenRegistryInput`)، بنابراین پاسخ به یک درخواست ناایمن چه
   ذخیره‌سازی بالا باشد چه نباشد یکسان است: ۴۰۰.
3. رکورد ذخیره‌شده یک پروجکشن روی فهرست سفید فیلدهاست؛ فیلدهای ناشناخته
   (مثل `signerKey`، `webhook`، `verified: true`) اصلاً ذخیره نمی‌شوند.
4. `verification.status` همیشه `unverified` است — هم موقع نوشتن و هم دوباره
   موقع خواندن. هیچ خط لوله بازبینی‌ای وجود ندارد که خلاف آن را ادعا کند.
5. خواندن هم fail-closed است: هر ردیف ذخیره‌شده دوباره اعتبارسنجی می‌شود و
   ردیفی که دیگر قبول نمی‌شود (بلاب دستکاری‌شده یا اسکیمای قدیمی) منتشر
   نمی‌شود.
6. liquidity عمداً فقط‌خواندنی است: بدون تسویهٔ RFQ و بدون custody، یک لیستِ
   خوداظهار هیچ ادعای صادقانه‌ای برای عرضه ندارد.

## UI

تب‌های Agents و Strategies در `src/pages/IntentOS.jsx` با `useEffect` و فقط
هنگام باز شدن همان تب، کاتالوگ را می‌گیرند. چهار حالت دارند: در حال بارگذاری،
خطا (با دکمهٔ تلاش دوباره)، `unavailable` (همان متن قبلی)، و فهرست واقعی.
هر کارت نام، توضیح، زنجیره‌ها، `executionMode` (ایجنت) یا `policy`
(استراتژی) و برچسب «تأییدنشده» را نشان می‌دهد — و هیچ دکمهٔ اجرا/امضا/نصب
ندارد. همهٔ رشته‌ها از i18n می‌آیند (en/fa/ar) با fallback انگلیسی.

## مرحلهٔ ۳ — چرخهٔ عمر، مالکیت و کلید API

### چرخهٔ عمر

```
draft ──submit──▶ submitted ──publish──▶ published ──revoke──▶ revoked
  │                   │                                          │
  └──delete──▶ deleted└──────────── draft ◀───────────────────────┘
```

- `draft` و `submitted` فقط برای مالک دیده می‌شوند (`GET /api/ecosystem/mine/...`).
- `published` تنها حالتی است که در کاتالوگ عمومی ظاهر می‌شود — و فقط تا وقتی
  گواهیِ فعال داشته باشد (پایین را ببین).
- `revoked` از کاتالوگ حذف می‌شود ولی رکورد و id برای ردگیری می‌ماند؛ مالک
  می‌تواند آن را به `draft` برگرداند و دوباره برای بررسی بفرستد.
- هیچ رکوردی فیزیکی پاک نمی‌شود؛ `deleted` هم فقط یک حالت است.

endpointها (همه فقط برای مالک، با idempotency):

```
POST /api/ecosystem/{agents|strategies}/:id/submit
POST /api/ecosystem/{agents|strategies}/:id/publish
POST /api/ecosystem/{agents|strategies}/:id/revoke
POST /api/ecosystem/{agents|strategies}/:id/delete
GET  /api/ecosystem/mine/{agents|strategies}
```

ویرایش فقط در `draft` و `submitted` مجاز است و هر ویرایش رکورد را به `draft`
برمی‌گرداند (`ENTRY_NOT_EDITABLE` در غیر این صورت). دلیلش ساده است: عوض‌کردن
محتوای یک لیستینگِ منتشرشده که نشان «گواهی‌شده» دارد، سودمندترین حملهٔ ممکن
روی این رجیستری است.

### کلیدهای API (شکاف بستهٔ مرحله ۳)

پیش از این `server/developerKeys.js` کلید می‌ساخت و هش می‌کرد ولی هیچ
middlewareای آن را بررسی نمی‌کرد — یعنی «باطل‌کردن کلید» عملاً بی‌اثر بود.
حالا:

- `Authorization: Bearer fbt_sandbox_...` خوانده می‌شود، `sha256` می‌شود و از
  طریق ایندکس `developer-key-index:v1:<hash>` به `{owner, projectId, keyId}`
  می‌رسد (بدون پیمایش همهٔ کلیدها).
- کلید ناموجود/بدشکل → ۴۰۱ `API_KEY_INVALID`؛ باطل‌شده → ۴۰۱ `API_KEY_REVOKED`.
- در موفقیت، هویت همان **مالک** است، نه بیشتر؛ `lastUsedAt` حداکثر هر ۵ دقیقه
  یک بار نوشته می‌شود (نه یک نوشتن پایدار به ازای هر درخواست).
- اسکوپ‌ها: `read_network`, `create_intent`, `request_quote`,
  `request_simulation`, و **`manage_listings`** که تنها اسکوپ تغییردهندهٔ
  وضعیت است و فقط به همین کاتالوگ دسترسی دارد. نبود اسکوپ → ۴۰۳
  `SCOPE_NOT_ALLOWED`. هیچ اسکوپی برای امضا/اجرا/برداشت وجود ندارد.
- خواندن عمومی کاتالوگ همچنان بدون کلید کار می‌کند.

## مرحلهٔ ۴ — گواهی و اعتبار

### گواهی (`ecosystem-certifications:v1`)

```
GET  /api/ecosystem/certifications?subjectId=...&subjectType=...
POST /api/ecosystem/certifications            ← فقط صادرکنندهٔ مجاز
POST /api/ecosystem/certifications/:id/revoke ← فقط صادرکنندهٔ مجاز
```

- صادرکننده‌ها با `ECOSYSTEM_CERTIFIERS` تعریف می‌شوند:
  `12345:FBT Review,67890:External Audit`. **اگر تنظیم نشود هیچ‌کس نمی‌تواند
  گواهی صادر کند، پس هیچ چیزی منتشر نمی‌شود** — کاتالوگ خالی می‌ماند به‌جای
  اینکه پر از خوداظهاریِ «تأییدشده» شود.
- در رکورد، **برچسب** صادرکننده ذخیره می‌شود نه آیدی تلگرام او.
- `evidence` الزامی است و فقط لینک https یا هش sha256 می‌پذیرد؛ متن آزاد رد
  می‌شود (شواهدِ غیرقابل‌بررسی تزئین است و متن آزاد راهِ ورود PII).
- کلید API نمی‌تواند گواهی صادر کند: یک اعتبارنامهٔ تفویض‌شده نباید بتواند
  برای لیستینگ مالک خودش ضمانت کند.

**قانون طلایی:** نشان «گواهی‌شده» از این store مشتق می‌شود، نه از خود آیتم؛ و
در **هر بار خواندن** بررسی می‌شود. یعنی باطل‌کردن گواهی، لیستینگ را بلافاصله
از کاتالوگ عمومی حذف می‌کند، و گواهیِ قدیمی‌تر از محتوای فعلی (ویرایش پس از
بررسی) نشان نمی‌گیرد.

### اعتبار (`ecosystem-reputation:v1`)

- `GET /api/reputation/:id` دیگر استاب نیست: از خلاصهٔ تجمیعی می‌خواند.
- منبع داده همان مشاهدات اجرای opt-in و سطلی‌شدهٔ موجود است
  (`fbt.intent-execution-observation.v1`). **هیچ endpointای اعتبار نمی‌پذیرد**؛
  اعتباری که بتوان POST کرد تبلیغ است.
- ذخیره فقط شمارش/نرخ موفقیت/سطح اطمینان است — بدون آدرس، هش تراکنش یا هویت.
- کمتر از ۵ نمونهٔ قطعی → `insufficient_data` و **هم شمارش و هم نرخ `null`**.
- انصراف کاربر (`cancelled`) در مخرج نرخ موفقیت حساب نمی‌شود.
- در کاتالوگ، خلاصهٔ اعتبار فقط وقتی `observed` باشد ضمیمه می‌شود.

### Portfolio Agent

`GET /api/portfolio/agent` و `POST /api/portfolio/agent` با ذخیرهٔ
`portfolio-agents:v1:{owner}`. `validatePortfolioAgent` همچنان
`withdrawFunds`/`executeWithoutUser` را رد می‌کند و `mode` را روی
`approval_required` قفل می‌کند. هیچ زمان‌بند، job یا امضاکننده‌ای این رکورد را
نمی‌خواند: فقط توصیف چیزی است که کاربر می‌خواهد.

## تست

`npm test` → سوئیت `ecosystem registry` (پروب `test/ecosystem-registry-probe.mjs`)
و `ecosystem catalog UI`. پروب هم سطح ماژول را می‌سنجد (مالکیت، صفحه‌بندی،
حالت unavailable، حذف ردیف مسموم هنگام خواندن، چرخهٔ عمر، گواهی، کلید API،
اعتبار و portfolio agent) و هم HTTP واقعی روی `server/app.js` را: درخواست
احرازشده‌ای که `withdrawFunds`، `executeWithoutUser` یا `automaticExecution`
بخواهد با ۴۰۰ رد می‌شود.

نمونهٔ موارد امنیتی مرحله ۳ و ۴ در پروب:

- کلید بدون اسکوپ لازم → `SCOPE_NOT_ALLOWED` (۴۰۳)
- کلید باطل‌شده → `API_KEY_REVOKED` (۴۰۱)؛ کلید بدشکل → ۴۰۱، نه ۵۰۳
- گواهی active بدون evidence (یا با «متن آزاد» به‌جای لینک/هش) → رد
- اعتبار با کمتر از ۵ نمونه → `insufficient_data` با `null` بودن شمارش و نرخ
- مالک غیرمرتبط نمی‌تواند ویرایش/انتقال وضعیت انجام دهد
- باطل‌کردن گواهی → حذف فوری لیستینگ از کاتالوگ عمومی
