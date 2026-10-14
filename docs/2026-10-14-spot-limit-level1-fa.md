# ۲۰۲۶-۱۰-۱۴ — سفارش Limit سطح ۱: تشخیص شرط با کوتیشن واقعی، بدون اجرای خودکار

## خلاصه

سفارش Limit روی همه‌ی شبکه‌های سواپ (EVM و Solana) به‌روزرسانی شد تا در لحظه‌ی
برقراری شرط، **کوتیشن واقعی** گرفته شود و فقط اگر خروجی کوتیشن حداقل حد کاربر را
بدهد، سفارش به وضعیت «آماده» برسد. اجرا همچنان **فقط با تایید صریح کاربر** انجام
می‌شود. هیچ تراکنشی بدون کلیک کاربر ارسال نمی‌شود.

---

## تغییرات کلیدی

### منطق شرط و کوتیشن (`src/lib/orders.js`)

- تابع تازه‌ی `evaluateLimitWithQuote(order, rate, quote)`:
  - **شرط برقرار + کوتیشن ≥ حد** → `ready: true, reason: 'QUOTE_READY'`
  - **شرط برقرار + کوتیشن < حد** → `ready: false, reason: 'QUOTE_BELOW_LIMIT'`
  - **کوتیشن ناموفق** → `ready: false, reason: 'QUOTE_UNAVAILABLE'`
  - **سررسید** → `ready: false, reason: 'EXPIRED'`
  - **هیچ‌گاه** `ready: true` نمی‌شود اگر کوتیشن واقعی نباشد.

- تابع تازه‌ی `computeMinAmountOut(order, amountIn, toDecimals)`:
  - حداقل خروجی را با دقت `decimals` مقصد و گرد کردن به نفع کاربر (ceil) محاسبه می‌کند.
  - USDC (۶)، USDT (۶) و ETH/WETH (۱۸) پوشش داده شده‌اند.
  - وقتی `priceOf === 'to'` باشد، نرخ معکوس می‌شود.

- گزینه‌های سررسید تازه: `1h`، `24h`، `7d` (از `LIMIT_EXPIRY_OPTIONS`)
- سقف کارمزد اختیاری: `maxFeeBps`

### رابط کاربری (`src/pages/Orders.jsx`)

- **کارت پیام صادقانه** بالای صفحه: «این سفارش با تایید شما اجرا می‌شود؛ اجرای
  خودکار وجود ندارد.»
- **انتخابگر سررسید** در فرم سفارش Limit با سه گزینه‌ی ۱ ساعت، ۲۴ ساعت، ۷ روز.
- **خروجی تخمینی** با قیمت حد نمایش داده می‌شود، نه قیمت لحظه‌ای.
- وضعیت‌های تازه: `ready` (آماده)، `quote_below` (کوتیشن زیر حد)، `unavailable` (در دسترس نیست)

### ترجمه (`src/i18n/locales/`)

- ۲۰ کلید جدید `orders.level1.*` در ۱۲ زبان.
- فارسی و انگلیسی و عربی کامل؛ ۹ زبان دیگر از `scripts/locales/product.mjs` بازسازی شدند.

### تست‌ها (`test/orders-limit-level1.test.jsx`)

۳۰ تست جدید، همه سبز:

| دسته | تعداد |
|---|---|
| گرد کردن decimals (USDC/USDT/ETH) | ۶ |
| سه نتیجه‌ی evaluateLimitWithQuote | ۹ |
| سررسید و انقضا | ۲ |
| لغو سفارش (محلی، بدون on-chain) | ۲ |
| عدم اجرای خودکار (mock sendTransaction) | ۲ |
| ساخت سفارش با گزینه‌های تازه | ۶ |
| پوشش شبکه | ۲ |
| **جمع** | **۳۰** |

---

## جدول پوشش شبکه‌ها

| شبکه | شناسه | پشتیبانی Limit | دلیل |
|---|---|---|---|
| BNB Smart Chain | 56 | ✅ | KyberSwap + OpenOcean |
| Ethereum | 1 | ✅ | KyberSwap + OpenOcean + Velora |
| Polygon | 137 | ✅ | KyberSwap + OpenOcean |
| Arbitrum One | 42161 | ✅ | KyberSwap + OpenOcean + Velora |
| Base | 8453 | ✅ | KyberSwap + OpenOcean + Velora |
| Optimism | 10 | ✅ | KyberSwap + OpenOcean |
| Avalanche | 43114 | ✅ | KyberSwap + OpenOcean |
| Linea | 59144 | ✅ | KyberSwap |
| Sonic | 146 | ✅ | KyberSwap |
| Mantle | 5000 | ✅ | OpenOcean + LI.FI |
|Monad Testnet | 80094 | ✅ | LI.FI |
| Robinhood | 4663 | ✅ | LI.FI |
| Unichain | 130 | ✅ | OpenOcean |
| Abstract | 2741 | ✅ | OpenOcean |
| Scroll | 534352 | ✅ | LI.FI |
| zkSync Era | 324 | ✅ | LI.FI |
| Solana | mainnet | ⚠️ کارت جدا | Jupiter (بدون watch سرور) |

> **شبکه‌های ناپشتیبان:** اگر یک شبکه در فهرست بالا نباشد یا اگریگیتور
> برای آن مسیر نداشته باشد، در فرم سفارش غیرفعال نمایش داده می‌شود.

---

## موارد کنار گذاشته‌شده (به سطح بعد)

- **قرارداد جدید:** هیچ قراردادی دیپلوی نشد. لغو on-chain نیاز به قرارداد دارد.
- **Solver/Bond:** هیچ سرویس solver ساخته نشد.
- **نقدینگی:** هیچ کیف‌پول با موجودی ساخته نشد.
- **اجرای خودکار:** هیچ کدی `sendTransaction` یا `signTypedData` را بدون کلیک
  کاربر فراخوانی نمی‌کند. اجرای خودکار در این سطح وجود ندارد.
- **Stop-Loss/Trailing/Bracket روی اسپات:** فقط Limit در این سطح.
- **لغو on-chain:** فقط حذف محلی و همگام‌سازی سرور.

---

## مراحل فعال‌سازی توسط کاربر

### تیک واچر سرور (اختیاری)
برای فعال‌سازی بررسی ۵ دقیقه‌ای سفارش‌ها توسط سرور:

1. فایل `ci/order-watch-tick.yml` را در `.github/workflows/` کپی کنید.
2. Secret `CRON_SECRET` را در تنظیمات ریپازیتوری تنظیم کنید.
3. هیچ secret یا کلید جدیدی در کد نوشته نشده است.

---

## فایل‌های تغییرکرده

- `src/lib/orders.js` — توابع تازه: `evaluateLimitWithQuote`, `computeMinAmountOut`, `LIMIT_EXPIRY_OPTIONS`
- `src/pages/Orders.jsx` — کارت صادقانه، انتخابگر سررسید، خروجی تخمینی
- `src/styles/orders-modern.css` — استایل‌های Level 1
- `src/i18n/locales/en.json` — ۲۰ کلید جدید
- `src/i18n/locales/fa.json` — ۲۰ کلید جدید
- `src/i18n/locales/ar.json` — ۲۰ کلید جدید
- `src/i18n/locales/{zh,hi,es,fr,ru,tr,ur,id,pt}.json` — بازسازی از `scripts/locales/product.mjs`
- `scripts/locales/product.mjs` — ترجمه‌های ۹ زبانه
- `test/orders-limit-level1.test.jsx` — ۳۰ تست جدید
- `CHANGELOG.md` — ورودی تازه
- `docs/2026-10-14-spot-limit-level1-fa.md` — این سند

---

## نتیجه‌ی تست‌ها

| تست | نتیجه |
|---|---|
| `test/orders-limit-level1.test.jsx` | ۳۰/۳۰ سبز |
| `test/orders-auto-modern.test.jsx` | ۷/۷ سبز |
| `test/wiring.mjs` | بدون افزایش شکست (۲۷ پیش‌موجود) |
| `npx vite build` | موفق |
