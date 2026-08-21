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

فعال‌سازی در پروداکشن فقط یک شرط دارد: `BLOB_READ_WRITE_TOKEN` تنظیم باشد
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

## تست

`npm test` → سوئیت `ecosystem registry` (پروب `test/ecosystem-registry-probe.mjs`)
و `ecosystem catalog UI`. پروب هم سطح ماژول را می‌سنجد (مالکیت، صفحه‌بندی،
حالت unavailable، حذف ردیف مسموم هنگام خواندن) و هم HTTP واقعی روی
`server/app.js` را: درخواست احرازشده‌ای که `withdrawFunds`،
`executeWithoutUser` یا `automaticExecution` بخواهد با ۴۰۰ رد می‌شود.
