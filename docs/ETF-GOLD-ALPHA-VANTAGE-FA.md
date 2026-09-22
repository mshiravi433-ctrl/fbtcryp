# ETF + Gold (Alpha Vantage) — فاز اول Read-only

تاریخ: 2026-09-22  
وضعیت: پیاده‌سازی شده — فقط خواندنی، بدون معامله

## خلاصه

ماژول ETF که در Central Brain به‌صورت hardcoded با پیام
`no ETF data source is wired in this deployment` و وضعیت `UNAVAILABLE` بود،
اکنون به یک Provider واقعی Alpha Vantage وصل است. قیمت Spot طلا (XAU/USD)
نیز از همان کلید خوانده می‌شود و به commodities/RWA متصل می‌شود بدون اینکه
داده ETF جای commodity بنشیند یا برعکس.

**Funds** و **Prediction** در این فاز همچنان `UNAVAILABLE` باقی مانده‌اند.

## Env لازم (فقط Backend / Vercel)

| نام | محل | توضیح |
|-----|------|--------|
| `ALPHA_VANTAGE_API_KEY` | Vercel Production / `.env` سرور | کلید رسمی Alpha Vantage |
| `ALPHA_VANTAGE_TIMEOUT_MS` | اختیاری | پیش‌فرض `10000` |

قوانین امنیتی:

- هیچ `VITE_ALPHA_VANTAGE_API_KEY` وجود ندارد و نباید ساخته شود.
- کلید فقط در `server/providers/alphaVantage.js` خوانده می‌شود.
- URL حاوی `apikey` قبل از log با `redactUrl` پاک می‌شود.
- پاسخ API و error body هرگز کلید را برنمی‌گردانند.
- fail-closed: بدون کلید یا با rate-limit/خطا، داده جعلی ساخته نمی‌شود.

## Endpointها

| Method | Path | TTL کش (تقریبی) |
|--------|------|------------------|
| GET | `/api/etf` | 15 دقیقه (quote universe) |
| GET | `/api/etf?category=bitcoin\|ethereum\|gold` | 15 دقیقه |
| GET | `/api/etf/:symbol` | 15 دقیقه |
| GET | `/api/etf/:symbol/profile` | 24 ساعت |
| GET | `/api/etf/status` | 30 ثانیه |
| GET | `/api/gold/spot` | 12 دقیقه |
| GET | `/api/gold/history?interval=daily\|weekly\|monthly` | 12 ساعت |
| GET | `/api/gold/status` | 30 ثانیه |

هر پاسخ موفق `meta` دارد:

```json
{
  "provider": "alpha-vantage",
  "schema": "fbt.alpha-vantage.v1",
  "fetchedAt": 0,
  "cached": false,
  "stale": false,
  "cacheAgeMs": 0,
  "delayed": true,
  "realtime": false
}
```

بدون کلید:

```json
{ "ok": false, "error": "PROVIDER_NOT_CONFIGURED", "message": "منبع داده ETF تنظیم نشده …" }
```
(HTTP 503)

## دارایی‌های فاز اول

**Bitcoin spot ETFs:** IBIT, FBTC, ARKB, BITB, GBTC, BTCW, HODL, BRRR, EZBC  
**Ethereum spot ETFs:** ETHA, FETH, ETHE, ETHW, ETHV, EZET  
**Gold ETFs:** GLD, IAU, GLDM, SGOL, BAR  
**Spot metal:** XAU/USD (واحد: USD per troy ounce)

Upstreamهای رسمی:

- `ETF_PROFILE`
- `GLOBAL_QUOTE`
- `GOLD_SILVER_SPOT` (`symbol=XAU` با fallback `GOLD`)
- `GOLD_SILVER_HISTORY`

## TTL و کنترل مصرف

| داده | TTL |
|------|-----|
| ETF quote | ≥ 15 دقیقه |
| ETF profile/holdings | ≥ 24 ساعت |
| Gold spot | 10–15 دقیقه (پیش‌فرض 12m) |
| Gold history | 6–24 ساعت (پیش‌فرض 12h) |

- `withCache` پروژه: single-flight + stale-if-error
- fallback حافظه‌ای bounded (`memFallback`, cap 256)
- حداکثر یک retry کنترل‌شده فقط برای transient (timeout/5xx/network) — نه 4xx/rate-limit
- کلاینت یک درخواست لیست می‌زند (نه polling per-symbol) و با `usePoll` هنگام hidden بودن tab متوقف می‌شود

## Central Brain

فایل: `server/ci/modules.js` + `server/ci/sources.js`

| وضعیت health | معنی |
|--------------|------|
| `UNAVAILABLE` | کلید تنظیم نیست |
| `UNKNOWN` / UNOBSERVED | کلید هست، هنوز probe واقعی نشده |
| `HEALTHY` | حداقل یک read معتبر |
| `DEGRADED` | stale cache یا بخشی از symbols شکست |
| `DOWN` | کلید هست، probe شکست، cache معتبر نیست |

- Capability ماژول `etf`: `READ_ONLY` وقتی کلید هست، وگرنه `UNAVAILABLE`
- `executes: false` همیشه
- ETF اختیاریِ تنظیم‌نشده کل Brain را outage نمی‌کند
- `commodities` طلای اسپات AV را با Ostium ادغام می‌کند (dedupe بر اساس symbol)
- `funds` و `prediction` دست‌نخورده `UNAVAILABLE`

## UI

- مسیر: `/etf` (lazy)
- منو: More → «ETFs & Gold» / «ETF و طلا»
- تب‌ها: Bitcoin ETFs · Ethereum ETFs · Gold ETFs · Gold Spot
- نمایش: قیمت، تغییر، نام صندوق، delayed/stale، آخرین به‌روزرسانی
- Gold Spot: واحد «USD per troy ounce» / «دلار آمریکا به ازای هر اونس تروا»
- بدون کلید: «منبع داده ETF تنظیم نشده»
- stale: برچسب «آخرین داده معتبر»
- بدون داده: صفر/نمودار جعلی نیست
- Funds/Prediction در این صفحه نیستند

## فایل‌های اصلی

| فایل | نقش |
|------|-----|
| `server/providers/alphaVantage.js` | Provider + normalize + cache + health |
| `server/etfGold.js` | لایه سرویس API/CI |
| `server/app.js` | Routeهای `/api/etf*` و `/api/gold*` |
| `server/ci/sources.js` | `etfMarkets`, `goldSpot` |
| `server/ci/modules.js` | ماژول‌های etf / commodities / funds |
| `server/fios/traditionalAssets.js` | discovery ETF وقتی domain موجود باشد |
| `src/lib/etfGold.js` | کلاینت API |
| `src/pages/Etf.jsx` | UI |
| `src/App.jsx`, `src/components/MoreSheet.jsx` | route + منو |
| `src/i18n/locales/en.json`, `fa.json` | ترجمه‌ها |
| `.env.example` | مستند env (بدون مقدار واقعی) |
| `test/etf-gold-provider-probe.mjs` | 50 تست provider/brain |
| `test/etf-gold-api-probe.mjs` | 21 تست HTTP + regression |

## تست‌ها

```bash
npm run test:etf-gold          # provider + API
npm run test:etf-gold-provider
npm run test:etf-gold-api
npm run test:central-brain-http
node test/intent-ai/traditional-assets-probe.mjs
node --input-type=module -e "import app from './api/index.js'"  # import سالم برای Vercel
npm run build
```

نتایج این session:

- provider probe: **50/50**
- API probe: **21/21** (شامل `/api/health`, `/api/news`, `/api/markets`)
- central-brain HTTP: **37/37**
- traditional-assets: **24/24**
- `api/index.js` import: OK
- production build: OK

## محدودیت‌های باقی‌مانده

1. **Funds Provider** ساخته نشده — عمداً.
2. **Prediction Market** فعال نشده — عمداً.
3. هیچ مسیر خرید/فروش/سفارش ETF یا طلا وجود ندارد.
4. سهمیه free-tier Alpha Vantage محدود است؛ cold fill کل universe ممکن است با rate-limit به stale/partial برسد (رفتار fail-closed + stale-if-error).
5. قیمت‌ها delayed هستند (بازار سهام آمریکا)، نه realtime tick-by-tick.
6. Profile holdings به shape رسمی AV وابسته‌اند؛ اگر upstream shape عوض شود `PROFILE_SHAPE_UNUSABLE` برمی‌گردد نه داده تخمینی.
7. Gold history فقط intervalهای `daily|weekly|monthly` را می‌پذیرد.

## Deploy checklist

1. در Vercel Production متغیر `ALPHA_VANTAGE_API_KEY` را ست کنید (نام دقیق).
2. Redeploy.
3. `GET /api/etf/status` → `configured: true` (ممکن است ابتدا `UNOBSERVED`/`UNKNOWN` باشد تا اولین read).
4. `GET /api/etf?category=bitcoin` و `GET /api/gold/spot` را یک‌بار warm کنید.
5. UI `/etf` را باز کنید — بدون polling مخفی.
