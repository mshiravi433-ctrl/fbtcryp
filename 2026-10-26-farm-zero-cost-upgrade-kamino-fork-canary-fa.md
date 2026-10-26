# ۲۰۲۶-۱۰-۲۶ — ارتقای بدون هزینهٔ بخش Farm: منابع رایگان استخرها (Kamino سولانا + ممیزی DefiLlama)، پروب‌های `--strict` فورک، فریز SplitRouter تا مرز ممیزی، و Runbook کامل Canary واقعی Aave Base

این یادداشت گزارش فنی و شواهد کامل اجرای ۴ گام رایگان ارتقای بخش **Farm** (با **هزینهٔ صفر مطلق**: بدون تراکنش روی mainnet، بدون استقرار قرارداد، بدون ساخت حساب آن‌چین، بدون کلید خصوصی، و بدون روشن‌کردن پرچم‌های فعال‌سازی) بر پایهٔ نقشهٔ راه `docs/STOCK-FARM-FEE-REVIEW-FA.md` است.

---

## ۱. گام اول — ممیزی منابع رایگان استخرها (`server/yields.js`) و افزودن Kamino روی Solana

### الف) منبع رایگان مستقیم Kamino Main Market (`api.kamino.finance`)
- **شواهد API واقعی:** اندپوینت عمومی و بدون نیاز به کلید یا پرداخت `https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics?env=mainnet-beta` و اندپوینت تاریخچهٔ روزانهٔ هر رزرو (`/reserves/{reserve}/metrics/history?env=mainnet-beta&frequency=day`) به پایپ‌لاین رسمی `/api/yields` متصل شدند.
- **منطق نگاشت محافظه‌کارانه و ضدتورم:**
  - `tvlUsd = totalSupplyUsd - totalBorrowUsd` (فقط نقدینگی آزاد قابل‌برداشت، نه کل سپردهٔ ناخالص).
  - رد خودکار رزروهای اشباع‌شده (`tvlUsd <= 0` یا استقراض کامل)، نامعتبر یا زیر کف TVL (`$50,000`) و بالای سقف APY (`500%`).
  - تبدیل دقیق نرخ اعشاری `supplyApy` به درصد پایه (`apyBase = supplyApy * 100`, `apyReward = null`) — بدون هیچ عدد ساختگی؛ در صورت خوانده‌نشدن یا اختلال Kamino API، پایپ‌لاین fail-open به فید DefiLlama برمی‌گردد و تاریخچهٔ خوانده‌نشده `data: []` برمی‌گرداند.
  - تشخیص استیبل‌کوین صرفاً بر اساس فهرست mintهای تاییدشدهٔ دلاری سولانا (`USDC`, `USDT`, `PYUSD`, `USDS`, `FDUSD`, `USDG`)، نه بر اساس حدس رشته‌ای روی نماد.
  - **حذف هم‌پوشانی (Deduplication):** اگر استخر Main Market یک توکن از قبل در فید `kamino-lend` در DefiLlama (`poolMeta === 'SOL/BTC Market'` با همان `underlyingTokens[0]`) حضور داشته باشد، ردیف تکراری ساخته نمی‌شود و فقط رزروهای غایب در DefiLlama با شناسهٔ پایدار `kamino-<reservePubkey>` اضافه می‌شوند.

### ب) ممیزی خط‌به‌خط `DefiLlama/yield-server` برای `ALLOWED_PROJECTS`
- **۱۱ اسلاگ سالم و تاییدشده اضافه شدند** (رسیدن فهرست به **۴۲ اسلاگ فعال**):
  - **Solana:** `kamino-lend`, `kamino-liquidity`, `jupiter-lend`, `save`, `raydium-amm`, `orca-dex`, `drift-staked-sol`, `binance-staked-sol`
  - **EVM:** `spark-savings` (Ethereum/Base/Arbitrum/Avalanche)، `benqi-staked-avax`، `benqi-lending` (Avalanche)
- **۹ اسلاگ مرده/تغییرنام‌یافته پاک‌سازی شدند:** `lido-v2`, `rocket-pool-eth`, `coinbase-wrapped-staked-eth-cbeth`, `spark`, `benqi`, `uniswap-v3-lp`, `aerodrome`, `pancakeswap-amm-v2`, `marinade` (جایگزین‌شده با اسلاگ‌های واقعی فعال در DefiLlama).
- **۷ کاندیدای بررسی‌شده صراحتاً رد و در تست‌ها مسدود (`pinned out`) شدند** (درس مستقیم از تجربهٔ قبلی `meteora` و `ajna-v2`):
  1. `meteora`: خطای زمان اجرای `ReferenceError: p is not defined` و `apyReward is not defined` در سورس آداپتور بالادستی + لینک اشتباه Raydium.
  2. `ajna-v2`: گزارش کردن `collateralSymbol` به‌جای توکن قرض‌داده‌شده (`quoteToken`) در فیلد `symbol`.
  3. `seamless-v2`: توکن‌های اهرمی بدهی+وثیقه (`LeverageManager`) نه وام‌دهی سادهٔ بدون ریسک لیکوییدیشن.
  4. `stargate-v1`: استخرهای مهاجرت‌یافته با `apyBase` صفر، ۱۰۰٪ وابسته به `apyReward`، و ناسازگاری نام زنجیرهٔ `'Binance'`؛ آداپتور `stargate-v2` در `yield-server` وجود ندارد.
  5. `pendle-v2`: اختلاط توکن‌های سررسیددار `PT`/`SY` با استخرهای LP که بدون نمایش تاریخ انقضا گمراه‌کننده است.
  6. `gmx-evm` / `gmx-v1-perps` / `gmx-solana`: خروجی خالی در `/poolsEnriched` و ریسک طرف مقابل معامله‌گران اهرمی (GM/GLP).
  7. `radiant-v2`: سابقهٔ اکسپلویت و بدهی معوق بازارها در کنار مقادیر گمراه‌کنندهٔ APY.
- نام‌های نمایشی (`PROJECT_DISPLAY_NAMES` در `src/lib/farmDeFi.js`)، نشان‌های بصری محلی (`PROTOCOL_MARKS` در `src/lib/protocolMarks.js`) و لینک‌های رسمی غیرکلودفلر برای همهٔ ۴۲ اسلاگ تکمیل و در `test/wiring.mjs` قفل شدند.

---

## ۲. گام دوم — اجرای `--strict` پروب‌های فورک ۴ پروتکل باقی‌مانده

- باندل‌های تولیدی آداپتور فورک برای هر ۴ پروتکل (`test/vite.{compoundfork,aavearb,lidofork,morphofork}.mjs`) با Vite بیلد و تایید شدند: خروجی هر ۴ باندل دارای `ENABLED === false` و `perTx === undefined && total === undefined` است (`test/.out` پس از تست پاک شد).
- هر ۴ پروب با پرچم `--strict` اجرا شدند (`compound-base-fork-probe.mjs`, `aave-arbitrum-fork-probe.mjs`, `lido-mainnet-fork-probe.mjs`, `morpho-base-fork-probe.mjs`):
  - **بدون متغیر صریح RPC:** هر ۴ پروب به شکل fail-closed با `0/1 passed` (`EXIT=1`) متوقف شدند.
  - **با متغیر صریح RPC عمومی:** به دلیل نبود باینری `anvil` روی `PATH` سندباکس و مسدود بودن egress خروجی سندباکس به `release-assets.githubusercontent.com` و اندپوینت‌های JSON-RPC عمومی (`curl` exit `35`)، و همچنین عدم دسترسی توکن یکپارچه‌سازی به `actions:write` برای اجرای دستی `gh workflow run` (`HTTP 403`)، طبق قانون سخت‌گیرانهٔ **`SKIP = FAIL`** نتیجهٔ اجرای محلی تاریخ `2026-10-26` برای هر ۴ پروتکل صادقانه **FAIL (`0/1 passed`, `EXIT=1`)** در `docs/defi/farm-execution-readiness-fa.md` ثبت شد.
- **صفر مدرک ساختگی:** هیچ فایل جدید یا ساختگی در `farm-fork-evidence/*.json` نوشته نشد و هیچ پرچم ورود سرمایه‌ای روشن نشد (`node scripts/verify-farm-rollout.mjs` → `capital-off`).

---

## ۳. گام سوم — ارتقا و فریز ریهرسال SplitRouter تا مرز ممیزی (`docs/defi/SPLIT-ROUTER-FA.md`)

- **ریهرسال رفتاری EVM محلی (`test/split-router/split-router-evm-rehearsal.mjs`):** از `28/28` به **`42/42` assertion سبز** ارتقا یافت؛ اکنون علاوه بر مسیر چهارگانه، **هر سه شکل دقیق استقرار mainnet** (شکل Base بدون Lido، شکل Arbitrum فقط-Aave با `comet=0, morpho=0, lido=0`، و شکل Ethereum فقط-Lido با `asset=0`) به همراه گردش کامل واریز، تقسیم کارمزد، موجودی صفر روتر، `ZERO_TARGET` روی مسیرهای غایب، و **هر ۷ گارد constructor** (`ZERO_ASSET`, `ZERO_FEE_RECIPIENT`, `FEE_TOO_HIGH`, `NO_TARGET`, `MORPHO_LOAN_TOKEN_MISMATCH`, `MORPHO_MARKET_INCOMPLETE`, `MORPHO_MARKET_ID_MISMATCH`) اثبات می‌شوند.
- **ریهرسال فورک سه‌شبکه‌ای (`test/split-router/split-router-fork-rehearsal.mjs` + `npm run test:split-router-fork`):**
  - شبکهٔ سوم مقصد یعنی **Arbitrum One (`42161` — Aave v3 native USDC `0xaf88…5831` و `aArbUSDCn 0x724d…8C637`)** به ریهرسال فورک اضافه شد تا هر ۳ شبکهٔ جدول استقرار (`Base 8453`, `Arbitrum 42161`, `Ethereum 1`) پوشش داده شوند.
  - در حالت `--strict` وجود صریح هر سه متغیر `BASE_RPC_URL`، `ARBITRUM_RPC_URL` و `ETH_RPC_URL` اجباری شد (هم‌تراز با پروب‌های ۵ پروتکل و پوشش‌داده‌شده در `test/farm-rollout-gate.test.js`).
  - قالب ورک‌فلوی یک‌کلیکی `ci/split-router-fork-rehearsal.yml` (با `foundry-toolchain@nightly` برای پشتیبانی از Arbitrum Nitro `#16514`) ساخته شد.
  - اجرای محلی `--strict` در سندباکس به همان دلیل نبود `anvil` و مسدودیت egress شبکه با `SKIP = FAIL` برابر **FAIL (`0/1`, `EXIT=1`)** ثبت شد و هیچ `split-router-fork-rehearsal-report.json` ساختگی تولید نشد.
- **بستهٔ فریز پیش از ممیزی خارجی:** هش SHA-256 سورس `contracts/FBTSplitRouter.sol` (`12c54c38…312b5c9b8`) و آرتیفکت `src/lib/splitRouterArtifact.json` (`80cf4d53…239354a7`، `7166` بایت با `solc 0.8.24`، `audited: false`) در `docs/defi/SPLIT-ROUTER-FA.md` ثبت شد و همهٔ متغیرهای `VITE_FBT_SPLIT_ROUTER_*` خاموش ماندند.

---

## ۴. گام چهارم — آماده‌سازی کامل Canary واقعی Aave Base (بدون اجرای زنده)

- **هم‌ترازی کامل مستندات با کد فعلی (`uncapped`):** ارجاع‌های منسوخ به متغیرهای حذف‌شدهٔ `VITE_*_MAX_*` از `docs/defi/farm-staged-rollout-fa.md`، `docs/defi/farm-vercel-env.md` و `docs/defi/farm-canary-report.md` پاک‌سازی و با سیاست واقعی `scripts/farm-rollout-policy.mjs` هم‌تراز شدند.
- **نمونه پیکربندی اختصاصی مرحلهٔ ۱ (`ci/farm-aave-base-canary.env.example`):** پروفایل آمادهٔ `limited-canary` منحصراً برای `aave-base` (`FARM_CANARY_CONFIRMED=false`، چهار پروتکل دیگر `false`، و `VITE_FBT_SPLIT_ROUTER_*` خالی) اضافه شد که تنها جای خالی آن آدرس عمومی والت canary مالک است.
- **ابزار پیش‌بررسی خودکار بدون هزینه (`scripts/verify-aave-base-canary-ready.mjs` / `npm run check:aave-base-canary`):**
  - گارد مکانیکی بهداشت اسرار: در صورت وجود هرگونه `PRIVATE_KEY`، `MNEMONIC` یا مقدار ۶۴ کاراکتر هگز شبیه کلید خصوصی در متغیرهای محیطی بلافاصله با خطا (`exit 1`) بسته می‌شود.
  - تایید وضعیت پیش‌فرض `capital-off`، پین‌های تک‌منبعی EIP-55 قراردادهای Aave v3 Base، خاموش بودن `SplitRouter` پیش از ممیزی، سلامت فایل لنگر `farm-fork-evidence/aave-base.json`، شبیه‌سازی دروازهٔ `limited-canary`، و حالت اختیاری `--rpc` (فقط `eth_call` خواندنی برای بررسی سلامت رزرو و موجودی حداقل `5 USDC` + `0.0005 ETH` گاز روی Base).

---

## ۵. اقلام هزینه‌دار که طبق دستور صراحتاً انجام نشدند (باقی‌مانده برای تصمیم مالک)

| ردیف | آیتم هزینه‌دار / نیازمند مجوز مالک | هزینهٔ تخمینی | وضعیت فعلی |
| :--- | :--- | :--- | :--- |
| ۱ | اجرای زندهٔ Canary روی **Aave v3 Base** (چرخهٔ `approve` + `supply 5 USDC` + `withdraw max`) | گاز شبکهٔ Base (~`$0.02`) + ۵ USDC برگشت‌پذیر در والت مالک | Runbook، نمونه env و پیش‌بررسی کامل شد؛ **فقط نیازمند مجوز مالک + آدرس عمومی والت canary** |
| ۲ | ساخت حساب ارجاع Jupiter Referral برای کارمزد سواپ به **jitoSOL** روی سولانا | حدود **`~$1`** اجارهٔ حساب توکن (rent) روی Solana | انجام نشد (صرف هزینه روی زنجیره ممنوع) |
| ۳ | استقرار و seed اولیهٔ **Morpho Curated Vault** اختصاصی برای دریافت performance fee | حدود **`~$25`** گاز + seed اولیه | انجام نشد (استقرار قرارداد و هزینه ممنوع) |
| ۴ | **ممیزی امنیتی مستقل خارجی** و استقرار آن‌چین قرارداد `FBTSplitRouter` روی Base / Arbitrum / Ethereum | هزینهٔ ممیزی حرفه‌ای + گاز استقرار ۳ شبکه | کد و ریهرسال محلی ۴۲/۴۲ فریز شد؛ `audited: false` و همهٔ envها خاموش ماندند |
