# FBT Autonomous Intelligence 2 — گزارش تحویل

تاریخ: 2026-11-01 · برنچ کاری: `arena/d5054481-fbtcryp` · پایه: `13d05a5`

## چه چیزی واقعاً ساخته شد

- **Mission Control پایدار**: SQLite با WAL/FULL، مهاجرت اتمی، idempotency مالک‌محور، lease و recovery پس از restart، صف وابستگی‌دار، retry کراندار، circuit breaker، pause/resume/cancel، emergency stop و version-CAS.
- **Evidence Engine مستقل**: هر خروجی ابزار یک receipt با منبع، زمان دریافت/مشاهده، raw data، SHA-256، producer و نتیجهٔ verifier دارد. `Completed` فقط وقتی ممکن است که همهٔ وظایف کامل، شواهد verified و Final Judge تصمیم `ANSWER` داده باشد. `trade_request` هرگز خودکار امضا نمی‌شود و در `Waiting Approval` می‌ماند.
- **Agent Runtime و Swarm پویا**: ۹ عامل، انتخاب حداقلی بر اساس kind/goal، delegation/dependsOn، timeout با abort واقعی، خروجی مستقل هر عامل، و هزینهٔ مدل رزروشده پیش از dispatch. usage نامعلوم با سقف رزرو شارژ می‌شود؛ قیمت نامعلوم یعنی مدل صدا زده نمی‌شود.
- **Opportunity Engine اسمارت‌مانی/کریپتو**: کاندیدهای DEX با نقدینگی/حجم/روند/جریان برچسب‌خورده، ریسک، امتیاز، شواهد و محدودیت‌ها. baseline حجم فقط از مشاهدات قبلی ساخته می‌شود؛ whale inflow بدون counterparty برچسب‌خورده ادعا نمی‌شود.
- **Self-learning برگشت‌پذیر**: predictionها با قیمت مستقل آینده سنجیده می‌شوند (Brier/accuracy)، policy نسخه‌بندی و rollback می‌شود؛ نمونهٔ بدون قیمت آینده pending می‌ماند، نه شکست.
- **داشبورد Mission Control**: مسیر additive `/missions` و ورودی در MoreSheet. مأموریت‌ها، عامل‌ها، شواهد، فرصت‌ها، رویدادها، یادگیری، خطا و توقف اضطراری. دادهٔ نمونه یا fallback تصادفی نمایش داده نمی‌شود.
- **صداقت دادهٔ بازار**: `aiMarketEngineRoutes.js` دیگر حجم/کندل/آن‌چین/احساسات ساختگی تولید نمی‌کند؛ فقط OHLC واقعی با provenance و missing fields. `FbtAiMarketEngine.jsx` دیگر sample اولیه یا random walk fallback ندارد.
- **استقرار**: `server/missionControl/worker.js` یک worker دائمی Node 24 با HTTP owner-scoped است. `Dockerfile.mission-worker`، `host/docker-compose.yml` و Caddy مسیر `/api/v1/missions/*` را به worker می‌برند. Vercel فقط control-plane/proxy است (`MISSION_CONTROL_UPSTREAM_URL`).

## فایل‌های اصلی

`server/missionControl/{store,core,evidence,opportunity,model,adapters,learning,runtime,index,router,worker}.js`،
`server/{app,index,aiGateway,aiMarketEngineRoutes}.js`،
`src/components/{MissionControl,FbtAiMarketEngine,MoreSheet}.jsx`، `src/App.jsx`،
`src/lib/missionControlClient.js`، `src/styles/mission-control.css`،
`test/mission-control/*.test.mjs`، `test/mission-control-ui.test.jsx`،
`Dockerfile.mission-worker`، `host/*`، `.env.example`.

## تست‌های اجراشده

| آزمون | نتیجه |
|---|---|
| `node --test test/mission-control/*.test.mjs` (Node 24) | **21/21 PASS** |
| `vitest run test/mission-control-ui.test.jsx test/more-menu.test.jsx` | **27/27 PASS** |
| `npm run test:upgrade14` | **PASS** |
| `node test/intent-ai/fbt-ai-market-engine-probe.mjs` | **7/7 PASS** |
| `npm run build` + first-paint | **PASS**، first-paint ≈ **1743 KB** < 1800 KB |
| `npm run test:agent-hub` | 124/125؛ **یک خطای ازپیش‌موجود**: `native-data.test.mjs:266` expected 3 Solana RPC, actual 4 |
| `npm run test:fios` | **دو خطای ازپیش‌موجود** Phase 211: `/trade → Trade` removed/changed؛ فایل‌های route-diff تولیدشده توسط probe بازگردانده شدند |

خطاهای agent-hub و fios پیش از این تغییرها نیز در baseline وجود داشتند و مربوط به Mission Control نیستند. هیچ مسیر/API موجود حذف نشده است.

توجه: فایل workflow جدید CI به‌دلیل نبود مجوز `workflows` در GitHub App این نشست push نشد و از commit حذف شد؛ خودِ تست‌ها در مخزن هستند و با `npm run mission:test` و vitest بالا اجرا می‌شوند.

## محدودیت‌های صادقانه

- این سیستم **معاملهٔ خودکار امضا نمی‌کند**. `trade_request` فقط تا تأیید و handoff به کیف پول می‌رود؛ کلید خصوصی در اختیار عامل‌ها نیست.
- غنی‌سازی مدل اختیاری است و بدون `MISSION_MODEL_ID` و قیمت معتبر در `MISSION_MODEL_PRICE_PER_1M_JSON` صدا زده نمی‌شود.
- دادهٔ واقعی به providerهای موجود وابسته است؛ در دسترس نبودن منبع، مأموریت را به‌دروغ Completed نمی‌کند.
- **Vercel به‌تنهایی کارگر دائمی نیست.** برای عملیاتی‌شدن کامل باید worker روی یک VPS/هاست با volume پایدار و HTTPS بالا بیاید و `MISSION_CONTROL_UPSTREAM_URL` در Vercel ست شود. بدون آن، UI صادقانه `MISSION_CONTROL_DISABLED` یا `DURABLE_WORKER_REQUIRED` نشان می‌دهد.
- SQLite متعلق به **یک volume/هاست** است؛ دو کپی مستقل روی دو دیسک مجاز نیست.

## راه‌اندازی عملیاتی

راهنمای کامل در `host/README.md` بخش ۲.۲۳ است. خلاصه:

```bash
export MISSION_CONTROL_SECRET="$(openssl rand -hex 32)"
export MISSION_WORKER_TOKEN="$(openssl rand -hex 32)"
export MISSION_OPS_TOKEN="$(openssl rand -hex 32)"
export MISSION_CONTROL_ENABLED=1
cd host && docker compose up -d --build mission-worker caddy
curl https://<worker-domain>/healthz
```

در Vercel: `MISSION_CONTROL_ENABLED=1`، همان `MISSION_CONTROL_SECRET` و `MISSION_WORKER_TOKEN`، و `MISSION_CONTROL_UPSTREAM_URL=https://<worker-domain>`.
