# ۲۰۲۶-۱۱-۰۲ — پیش‌بینی کندل‌های آینده با مدل Kronos روی ترمینال نمودار توکن

- **درخواست:** «ببین این متن باز اینده نگری نمودار بدرد میخوره» + لینک [shiyu-coder/Kronos](https://github.com/shiyu-coder/Kronos)، سپس «انجام بده و پاز تکمیل و ۱۰۰ درصد شدن عملیاتی بیار رو برنچ اصلی لایو بشه».
- **چه انتخاب شد و چرا:** **Kronos** — اولین مدل foundation متن‌باز برای کندل‌های مالی (K-line/OHLCV)، پذیرفته‌شدهٔ AAAI 2026 (ارشیو [2508.02739](https://arxiv.org/abs/2508.02739))، لایسنس **MIT**، ۴۵.۵k ستاره، آموزش‌دیده روی دادهٔ ۴۵+ صرافی جهانی (شامل کریپتو). برخلاف مدل‌های عمومی سری‌زمانی، ورودی/خروجی‌اش دقیقاً همان چیزی است که چارت می‌کشد: کندل‌های گذشته → کندل‌های بعدی. وزن‌های باز: `NeoQuasar/Kronos-small` (۲۴٫۷M پارامتر، کانتکست ۵۱۲) + `NeoQuasar/Kronos-Tokenizer-base`.

## معماری — چرا یک کارگر جداگانه

```
مرورگر ──POST /api/forecast──► Express (Vercel) ──► server/kronosForecast.js
                                                          │  cache + breaker
                                                          ▼
                                              forecast/worker.py :8765
                                              (کانتینر دائمی، مدل Kronos)
```

- **وزن مدل داخل serverless نمی‌نشیند:** دانلود ~۱۰۰ مگابایتی وزن‌ها در boot و چند ثانیه استنتاج autoregressive روی CPU، با عمر کوتاه تابع‌های Vercel ناسازگار است. الگو دقیقاً همان `Dockerfile.mission-worker` است: `Dockerfile.kronos-worker` + سرویس `kronos-worker` در `host/docker-compose.yml` (volume برای کش HuggingFace) + مسیر `/kronos/*` در `host/Caddyfile`؛ روی Vercel فقط `KRONOS_WORKER_URL` ست می‌شود.
- **کد مدل vendor شد:** `forecast/kronos_model/` (فایل‌های `kronos.py`/`module.py`/`__init__.py` از کامیت `67b630e` ریپوی اصلی، فقط با دو پچ ایمپورت: حذف وابستگی به CWD و tqdm اختیاری). یعنی build بدون دسترسی به GitHub هم کامل می‌شود و منشأ/پچ‌ها در `forecast/kronos_model/PROVENANCE.md` شفاف ثبت است.
- **کارگر خودش را صادقانه گزارش می‌دهد:** `GET /healthz` → `{backend, loaded, loading, error, forecasts}`؛ `POST /forecast` با قفل تک‌استنتاج (CPU یک‌نفره)، warm-up در بوت، و باک‌اند `mock` فقط برای تست قرارداد (هرگز پیش‌فرض نیست؛ `get("KRONOS_BACKEND", "kronos")` پین شده).

## صداقت — دو برچسب، هیچ عدد بی‌برچسبی

`server/kronosForecast.js` وقتی کارگر جواب ندهد (قطع، کند، یا وزن لود نشده) **۵۰۳ برنمی‌گرداند**؛ یک **مدل پایهٔ آماری** (drift+σ با seed ثابت از همان پنجره) می‌سازد با:

```json
{ "provider": "baseline", "model": "drift-volatility baseline",
  "worker": { "ok": false, "error": "ECONNREFUSED…" } }
```

بَجِ داخل چارت کلمهٔ `provider` را عیناً نشان می‌دهد: «Kronos» با تگ بنفش یا **«مدل پایه» با تگ کهربایی** — خواننده همیشه می‌داند دارد به چه نگاه می‌کند، و جملهٔ «برآورد مدل از کندل‌های گذشته — نه توصیهٔ مالی، نه تضمین.» همیشه کنار پروژه است. سه لایهٔ محافظ دیگر: **timeout** (۴۵s)، **breaker** (۳ شکست → ۳۰s قطع فراخوانی، بدون تأخیر برای چارت)، و **کش per-series** (امضای دو کندل آخر + طول پنجره + افق — هر خوانندهٔ بیت‌کوین امروز یک فراخوانی کارگر هزینه دارد، نه یکی به‌ازای هر بازدید).

## رابط کاربری

- **دکمهٔ «پیش‌بینی AI»** در تولبار ترمینال تمام‌صفحه (کارت درون‌صفحه دست‌نخورده — جا ندارد و کسی ندیده‌اش نمی‌خواهد).
- **اوورلی نسل دوم روی همان پن** series دوم `CandlestickSeries` با رنگ بنفش نیمه‌شفاف (`borderUpColor/DownColor`) — عمداً سبز/قرمز نیست تا با شمعِ چاپ‌شده اشتباه گرفته نشود. **ساختاری نیست**: نمایش/مخفی‌سازی فقط `setData`+`applyOptions` است (بدون rebuild، بدون پریدن زوم).
- **کهنگی در موتور کلیپ می‌شود:** به‌محض اینکه شمع واقعی داخل بازهٔ پروژه چاپ شد، آن شمع «تاریخ» است و پروژه فقط زمان‌های جواب‌نداده را نگه می‌دارد؛ با امضای جدید، خودِ کلاینت دوباره درخواست می‌دهد (کش سمت سرور همان را پاسخ می‌دهد).
- **درخواست از همان کندل‌های روی صفحه:** `postTokenForecast` کندل‌های `time*1000` (میلی‌ثانیهٔ فید) را می‌فرستد — پروژه و چارت هیچ‌وقت سرِ اینکه دارند به کدام شمع نگاه می‌کنند اختلاف ندارند. هورایزن پیش‌فرض `clamp(len/8, 12, 48)`.
- **شکست = هیچ:** خطا چیزی رسم نمی‌کند و پیام «پروژه هم‌اکنون در دسترس نیست» را نشان می‌دهد (همان قاعدهٔ `getOhlc`: بدون fallback آفلاین، بدون دادهٔ اختراعی).
- **i18n:** ۷ کلید `coin.pro.forecast*` در en/fa + `scripts/locales/token-chart.mjs` برای هر ۱۰ زبانِ partial و بازتولید با `scripts/gen-locales.mjs` (پینِ `pro-chart-prefs` این را برای همهٔ زبان‌ها اجباری می‌کند).

## فایل‌های تازه

- `forecast/worker.py` (کارگر HTTP با استاندارد کتابخانه — بدون Flask)، `forecast/__init__.py`، `forecast/requirements.txt`، `forecast/test_worker.py` (۱۸ تست بدون torch/شبکه)، `forecast/kronos_model/*` (vendor از upstream).
- `Dockerfile.kronos-worker` (torch نسخهٔ CPU از download.pytorch.org تا ایمیج ~۱GB بماند).
- `server/kronosForecast.js` (کلاینت کارگر + breaker + کش + baseline).
- `test/kronos-forecast.test.mjs` (۱۴ تست روت/کلاینت با stub کردن `globalThis.fetch`)، `test/pro-chart-forecast.test.jsx` (۶ تست UI).

## تغییریافته

`server/app.js` (روت‌های `POST /api/forecast` و `GET /api/forecast/:id?days=1|7|30` کنار `/api/volume/:id`)، `src/lib/api.js` (`postTokenForecast`)، `src/components/ProChart/ProChart.jsx` (سری `forecastSeries` + افکت‌ها + بازرنگی تم)، `src/components/ProChart/TokenChart.jsx` (دکمه، state، بَج، نوت‌ها)، `src/styles/pro-chart.css`، `src/i18n/locales/{en,fa,es,fr,hi,id,pt,ru,tr,ur,zh}.json` + `coverage.json`، `scripts/locales/token-chart.mjs`، `test/wiring.mjs` (۱۰ پین تازه)، `package.json` (`test:forecast` + پیوستن به `test:pro-chart`)، `host/docker-compose.yml`، `host/Caddyfile`، `.env.example` (بلوک ۲٫۲۴).

## اعتبارسنجی

- `npm run test:forecast` **۳۸/۳۸** (node --test ۱۴ + vitest ۶ + unittest پایتون ۱۸).
- `npm run test:pro-chart` **۴۵/۴۵** (۶ تست تازهٔ پیش‌بینی داخلش).
- `test/wiring.mjs` **۳٬۰۲۰ پین / ۶۵ شکست = دقیقاً خط پایهٔ main** (۱۰ پین تازه همه پاس، ۰ شکست تازه).
- `coindetail-probe` **۳۹/۳۹**؛ `coin-detail-tabs` **۴/۴**؛ `app-boot` **۱/۱**.
- **E2E زنده در سندباکس:** کارگر پایتون (باک‌اند mock) روی ۸۷۶۵ + سرور Node روی ۸۷۸۷ → `POST /api/forecast` با ۱۲۰ کندل مصنوعی **۲۰۰** با `provider=mock` و ۱۸ کندل خروجی؛ فراخوانی دوم **`cached: true`**؛ ورودی ناقص **۴۰۰**؛ `/healthz` هر دو سمت سبز. (وزن‌های واقعی Kronos در سندباکس قابل دانلود نبود — `huggingface.co` از این شبکه بسته است؛ در پروداکشن همان مسیر `kronos` با warm-up بالا می‌آید و `healthz` وضعیت را گزارش می‌کند.)
- `npm run build` **سبز** و `check-first-paint` **PASS — ۱٬۷۵۵٫۸۶KB از ۱٬۸۰۰KB**.

## استقرار (پس از merge روی main)

1. `cd host && docker compose up -d --build kronos-worker caddy` — وزن‌ها در اولین بوت دانلود و روی volume `kronos-cache` می‌مانند.
2. روی Vercel: `KRONOS_WORKER_URL=https://ai.yourdomain.com/kronos` (+ `KRONOS_WORKER_TOKEN` در هر دو سمت، اختیاری).
3. بدون هیچ‌کدام از این دو، سایت باز هم کار می‌کند: پروژه با برچسب «مدل پایه» جواب می‌دهد و دکمه هرگز بی‌پاسخ نمی‌ماند.
