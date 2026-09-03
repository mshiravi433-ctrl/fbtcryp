# موتور فیوچرز FBT — ارتقای Production نسخهٔ ۳.۰

این گزارش می‌گوید چه چیزی ساخته شد، هر لایه به کدام لایهٔ دیگر وصل است، چه چیزی
عمداً ساخته **نشد**، و چطور می‌شود همهٔ این‌ها را با یک دستور دوباره ثابت کرد.

قاعدهٔ اصلی این کار یک جمله بود: **دکمه‌ای که کاری نمی‌کند، قابلیت پیاده‌سازی‌شده
نیست.** پس هر مسیر از تب تا کیف پول، سر به سر، با تست بسته شده است.

---

## ۱. ساختار تب‌ها

صفحهٔ فیوچرز (`/perp`) حالا سه تب دارد، در همان کنترل segmented قبلی، با همان
اندازه و همان نشانگر (`SegIndicator id="perp-tab"`):

| کلید | en | fa | چه چیزی است |
|---|---|---|---|
| `overview` | Perpetual | پرپچوال | همان صفحهٔ مرور قبلی: قیمت شاخص، فاندینگ، جدول لیکوییدیشن، آموزش |
| `dydx` | dYdX Orbit | مدار dYdX | همان تب dYdX قبلی (نشست client-signed) |
| `onchain` | On-Chain | آن‌چین | **جدید** — موتور اجرای آن‌چین (Ostium روی Arbitrum) |

هیچ طراحی تازه‌ای وارد نشده؛ تب سوم از همان کارت‌ها، دکمه‌ها، `dir-switch`،
`lev-chip`، `brg-quote` و شیشه‌های `derivatives-glass.css` استفاده می‌کند.

لینک عمیق: `/perp?tab=onchain` (و برای Intent OS:
`&market=BTC&side=long&collateral=100&leverage=5`).

---

## ۲. لایه‌ها و اتصال آن‌ها

```
تب On-Chain (src/pages/FuturesOnchain.jsx)
   └─ src/lib/futuresClient.js             فقط same-origin، بدون fallback آفلاین
        └─ /api/v1/futures/*  (server/futures/router.js)
             ├─ server/futures/registry.js   وضعیت مشتق‌شده از probe + فلگ‌ها
             ├─ server/futures/adapters/ostium.js   خواندن + ساخت تراکنش امضانشده
             ├─ server/futures/ledger.js     اجراها + دفتر کارمزد append-only + idempotency
             └─ src/lib/futures-engine/*     موتور خالص مشترک مرورگر/سرور
                  ├─ providers.js   کاتالوگ، FORBIDDEN_PROVIDER_IDS (صرافی‌های متمرکز)
                  ├─ fees.js        Protocol + Network + FBT = Total
                  ├─ risk.js        riskScore / level / liquidationDistance / block
                  ├─ router.js      انتخاب venue بدون ورودی «درآمد FBT»
                  ├─ stateMachine.js IDLE … COMPLETED + شاخه‌های خطا
                  ├─ errors.js, ids.js, events.js, store.js (zustand + event bus)
```

### وضعیت پروتکل‌ها (Registry)

`AVAILABLE / DEGRADED / READ_ONLY / UNAVAILABLE / MAINTENANCE / BLOCKED`

- وضعیت **همیشه از probe زنده** (فید قیمت + ساب‌گراف) مشتق می‌شود. هیچ جای کد
  `status: 'AVAILABLE'` نوشته نشده؛ تست wiring این را پین کرده است.
- متغیرهای محیطی فقط می‌توانند دسترسی را کم کنند:
  `FUTURES_PROVIDERS_ENABLED` (پیش‌فرض `ostium,dydx`)،
  `FUTURES_PROVIDERS_MAINTENANCE`، `FUTURES_PROVIDERS_BLOCKED`.
- Binance / Bybit / KuCoin / MEXC در `FORBIDDEN_PROVIDER_IDS` هستند و همیشه
  `BLOCKED` گزارش می‌شوند. هیچ API معاملاتی CEX ساخته نشده و نبودش صفحه را
  نمی‌شکند.
- GMX / Avantis / Hyperliquid / Drift در کاتالوگ با `execution: NOT_BUILT` هستند:
  در مقایسهٔ چندپروتکلی دیده می‌شوند ولی «پیکربندی‌نشده» و غیرقابل معامله.

### کارمزد (FBTFuturesFeeEngine)

- `total = protocol + network + fbt` — اگر یکی نامعلوم باشد، total **null** است و
  UI به‌جای عدد ناقص می‌نویسد «در مرحلهٔ بازبینی».
- کارمزد FBT = bps از **notional**، سیاست‌ها: STANDARD ۵ / VIP ۳ / PARTNER ۲ /
  ZERO ۰؛ سقف سخت ۱۰ bps و سقف خود پروتکل (Ostium: ۵۰). `Math.min` روی هر دو.
- در calldata اوستیوم، `builderFee = bps × 10٬000` (۵ bps → ۵۰٬۰۰۰). تست UI این
  عدد را از تراکنشی که کیف پول امضا کرده **دیکد** می‌کند و با پیش‌نمایش مقایسه
  می‌کند.
- اکشن‌های مدیریتی (TP/SL، کاهش، بستن) کارمزد FBT **صفر** دارند.
- منبع حقیقت: سرور. فرانت‌اند هیچ bps ثابتی ندارد؛ هر رکورد در دفتر کارمزد
  append-only ثبت می‌شود (`GET /api/v1/futures/fees/ledger`).

### ریسک (Risk Engine)

خروجی: `riskScore (0–100)`, `riskLevel (LOW/MEDIUM/HIGH/EXTREME)`,
`liquidationDistancePct`, `liquidationPrice`, `maxRecommendedCollateralUsd`,
`warnings[]`, `blockReasons[]`.

مدل لیکوییدیشن اوستیوم از مستندات خودشان: زیان٪ = ۱۰۰٪ − (اهرم ÷ حداکثر اهرم × ۲۵٪).

دلایل توقف (`blocked: true` ⇒ هیچ تراکنشی ساخته نمی‌شود، نه در UI و نه در
`/prepare`): `LEVERAGE_ABOVE_POLICY` (>۵۰×)، `LEVERAGE_ABOVE_VENUE_MAX`،
`MARKET_CLOSED`، `LIQUIDATION_TOO_CLOSE`، `INSUFFICIENT_BALANCE`،
`STOP_LOSS_WRONG_SIDE`، `TAKE_PROFIT_WRONG_SIDE`، `EXCEEDS_OPEN_INTEREST_CAP`.

### روتر

`selectVenue()` ورودی‌هایش: وضعیت، پشتیبانی بازار، باز بودن بازار، اهرم، کارمزدی
که **کاربر** می‌پردازد، اسپرد، OI، فاندینگ، تازگی داده. **هیچ ورودی «درآمد FBT»
ندارد** — تست موتور این را با یک venue گران‌تر برای کاربر ولی پردرآمدتر برای ما
ثابت می‌کند.

### ماشین حالت تراکنش

`IDLE → VALIDATING → QUOTING → RISK_CHECK → PREPARED → AWAITING_SIGNATURE →
SUBMITTED → PENDING → CONFIRMED → VERIFYING → COMPLETED`

شاخه‌های خطا: `BLOCKED`, `REJECTED` (USER_REJECTED؛ **هرگز** retry خودکار),
`FAILED`, `TIMEOUT`, `RECOVERY`.

---

## ۳. API

همه زیر `/api/v1/futures`؛ پاسخ‌ها با پاکت `{ ok, data, meta }` و
`requestId / intentId / executionId / idempotencyKey`.

| مسیر | کار |
|---|---|
| `GET /providers`, `GET /health` | رجیستری با وضعیت مشتق‌شده |
| `GET /markets`, `GET /markets/:provider/:market` | بازارها از ساب‌گراف + فید |
| `GET /candles` | کندل‌های واقعی؛ اوستیوم از `/v1/ohlc`، **ونیو (Velocity)** از `GET data.velocity.exchange/market/:symbol/candles/:res` (تأیید زندهٔ 2026-09-03؛ `ts` ثانیه، سری fill/oracle). نبود = `live:false` و لیست خالی |
| `GET /funding`, `GET /open-interest` | فاندینگ و OI زنده |
| `GET /positions/:wallet`, `GET /account/:wallet` | پوزیشن‌ها، موجودی و allowance از RPC |
| `GET /fees`, `GET /fees/ledger`, `GET /executions/:wallet` | پیش‌نمایش کارمزد، دفتر کارمزد، اجراها |
| `POST /quote`, `POST /risk` | قیمت + کارمزد + ریسک + مسیر |
| `POST /prepare` (= `/execute`) | تراکنش **امضانشده** + شبیه‌سازی؛ `Idempotency-Key` اجباری |
| `POST /simulate`, `POST /verify` | شبیه‌سازی جدا؛ تأیید هش و به‌روزرسانی ledger |
| `POST /positions/:id/{increase,decrease,close,tp,sl}` | مدیریت پوزیشن، همه امضانشده |

سرور **هیچ‌وقت** امضا یا broadcast نمی‌کند؛ هر تراکنش با
`capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' }` برمی‌گردد.

---

## ۴. Intent OS

- سرور: `server/futures/intentAdapter.js` پشت ماژول `futures` در
  `server/central/adapters.js`؛ برنامه‌ریز (`planner.js`) برای `FUTURES_OPEN/CLOSE`
  مسیر read → portfolio → risk → quote → prepare می‌سازد؛ `understanding.js` اهرم
  و جهت را استخراج می‌کند؛ `pipeline.js`:
  - بازار یا مبلغ نامشخص ⇒ **QUESTION** (هرگز سفارش از جملهٔ مبهم)
  - پروتکل در دسترس نیست ⇒ خطای صادقانه با همان جمله‌های فارسی مصوب
  - ریسک مسدود ⇒ `RISK_BLOCKED`
  - در غیر این صورت ⇒ **پیش‌نمایش تأیید** با کارمزد و ریسک، قبل از هر اجرا
- کلاینت: `IntentAIRoute.jsx` پیش‌نویس `futures_open` را به
  `/perp?tab=onchain&market=…&side=…&collateral=…&leverage=…` می‌فرستد. تب فقط
  **فرم** را پر می‌کند؛ قیمت، کارمزد، ریسک و تراکنش دوباره از سرور می‌آید و کاربر
  باید «بازبینی» و سپس «تأیید» را بزند. اهرم بالای ۵۰ در لینک clamp می‌شود.
- رجیستری قابلیت کلاینت (`appCapabilities.js`) فقط اکشن‌ها و رویدادهایی را
  فهرست می‌کند که واقعاً وجود دارند (`futures.*`, `FUTURES_*`).

جملات مصوب:
- «این بازار در حال حاضر فقط برای مشاهده در دسترس است.» (`futures.readOnlyNotice`)
- «این قابلیت هنوز برای محیط Production پیکربندی نشده است.» (`futures.err.NOT_CONFIGURED`)

---

## ۵. چیزهایی که عمداً حذف یا ساخته نشد

- **کاتالوگ آفلاین dYdX و اوستیوم حذف شد** (`dydxOffline.js`, `ostiumOffline.js`).
  قبلاً وقتی upstream قطع بود، بازارها، قیمت‌ها و یک سری قیمت مصنوعی جایگزین
  می‌شد. حالا پاسخ `unavailable: true` و لیست خالی است و صفحه حالت صادقانهٔ
  «فید در دسترس نیست — معامله غیرفعال» را نشان می‌دهد. جدول «این جفت چیست؟» که
  محتوای آموزشی واقعی بود به `src/lib/assetKnowledge.js` منتقل شد.
- نمودار تب Perpetual اگر داده از اسنپ‌شات آفلاین باشد، به‌جای اسپارک‌لاین
  می‌نویسد «داده بازار موقتاً در دسترس نیست».
- هیچ API معاملاتی CEX، هیچ دور زدن تحریم/جغرافیا/KYC، هیچ کلید خصوصی سمت سرور.
- هیچ عبارت «سود تضمینی / بدون ریسک / ۱۰۰٪» در هیچ locale — تست دارد.

---

## ۶. تست‌ها

| دستور | چه چیزی را ثابت می‌کند |
|---|---|
| `node test/futures-engine-probe.mjs` | موتور خالص: کارمزد، ریسک، روتر (بدون ورودی درآمد)، ماشین حالت، خطاها، ID ها |
| `node test/futures-bff-run.mjs` | BFF واقعی روی اپ Express: پاکت‌ها، idempotency، READ_ONLY/UNAVAILABLE، تراکنش امضانشده، ledger، نرمال‌سازی کندل ونیو سرتاسر |
| `node test/futures-velocity-feed-probe.mjs` | آداپتر و رجیستری Velocity با پیلود زندهٔ اسیرشده: قیمت/OI/فاندینگ/کارمزد + نگاشت کندل (`ts` ثانیه → ms، سری fill با fallback اوراکل) + شکست صادقانه |
| `node test/futures-velocity-trade-probe.mjs` | باندل SDK فرستاده‌شده: همهٔ نمادهای مسیر سفارش + سطح ریفرر (escrow/sweep) + PDA ها |
| `npm run test:futures` | engine + BFF + باندل SDK (هر سه بالا) |
| `test/futures-onchain-probe.jsx` (داخل `npm test`) | صفحهٔ واقعی `/perp` با BFF و کیف پول stub: سه سناریو UNAVAILABLE / READ_ONLY / AVAILABLE، دیکد calldata امضاشده، هش به `/verify`، تب‌های دیگر سالم، فارسی RTL، هند-آف Intent OS، حذف بازار نمایشی dYdX |
| `test/wiring.mjs` بخش «Futures Engine v3» | حقایق منبع: سه تب، همان SegIndicator، بدون کاتالوگ آفلاین، بدون فارسی هاردکد، کلیدهای en/fa، رجیستری بدون AVAILABLE ثابت، بدون CEX |

گلدن‌تست `test/ostium-golden.json` خروجی سازندهٔ تراکنش را بایت‌به‌بایت با SDK
رسمی اوستیوم مقایسه می‌کند.

---

## ۷. پیکربندی

```
FUTURES_PROVIDERS_ENABLED=ostium,dydx
FUTURES_PROVIDERS_MAINTENANCE=
FUTURES_PROVIDERS_BLOCKED=
FUTURES_FBT_FEE_BPS=          # خالی = سیاست STANDARD (۵)؛ سقف ۱۰
FUTURES_FBT_FEE_RECIPIENT=    # خالی = VITE_PAYOUT_EVM
OSTIUM_API_URL=               # خالی = builder.prod.bedrock.ostium.io
VELOCITY_DATA_API=            # خالی = https://data.velocity.exchange (بدون کلید)
VELOCITY_DLOB_API=            # خالی = https://dlob.velocity.exchange  (بدون کلید)
SOLANA_RPC_URL=               # سمت سرور؛ خالی = RPC عمومی سولانا
VITE_SOLANA_RPC=              # سمت مرورگر (build-time؛ بعد از ست کردن redeploy)
VELOCITY_REFERRER=            # authority ریفرر FBT (سمت سرور)
VITE_VELOCITY_REFERRER=       # همان آدرس، سمت بیلد (در ci/WORKFLOW-FIXED.yml هم مپ شده)
```

هیچ‌کدام برای بالا آمدن اپ لازم نیست؛ خالی بودن یعنی همان وضعیت صادقانه.

---

## ۸. کیف پول سولانا در تب On-Chain (هند-آف صفحهٔ کیف پول)

دکمهٔ «اتصال کیف پول» در تب On-Chain وقتی کیفی وصل نیست کاربر را به
`#/wallet?tab=solana&return=/perp?tab=onchain&market=…&side=…&collateral=…&leverage=…`
می‌برد — همان سفارشِ در دستِ ساخت در `return` حمل می‌شود. صفحهٔ کیف پول با
اولین اتصال سولانا (رویداد `solana:wallet-change`) خودکار به همان مسیر
برمی‌گردد؛ `return` فقط مسیر داخلی (شروع‌شده با یک `/` تکی) را می‌پذیرد.
تشخیص اتصال: اینجکشن (`window.phantom.solana` / `solflare` / `backpack`)،
Wallet Standard/MWA (`getMwaWallet`، ثبت‌شده در خود تب هم)، رویدادهای
`accountChanged` کیف پول و بازخوانی سبک `solanaAddress()` برای اینجکشن
دیرهنگام. اگر هیچ کیفی روی دستگاه نیست، پیام خوانا + همان دکمه (که به
صفحهٔ کیف پول می‌رود) نمایش داده می‌شود. همین رفتار در TP/SL/close هم
اعمال شده است.

## ۹. کارمزد ریفرر Velocity (مسیر رسیدن کارمزد به FBT)

نرخ رسمی: سطح Standard **۱۰٪** از کارمزد taker کاربرِ معرفی‌شده (کاربر ۵٪
تخفیف می‌گیرد)؛ سطح Accelerated ۲۰٪ با تأیید تیم Velocity. ریفرر فقط در
اولین `initialize_user` آن ولت ثبت می‌شود. کد:

- `src/lib/velocityTrade.js`: ریفرر فقط وقتی ضمیمه می‌شود که `UserStats`
  ریفرر روی زنجیره باشد (`fbtReferrerInfo` از RPC می‌خواند)؛ هنگام ضمیمه‌شدن،
  `RevenueShareEscrow` کاربر هم ساخته می‌شود (`getInitializeRevenueShareEscrowIx`)
  وگرنه fill کاربر با `UnableToLoadRevenueShareAccount` شکست می‌خورد.
- `npm run velocity:referrer-setup` — از کی‌پیر **لوکال**
  (`VELOCITY_KEYPAIR_PATH`، بیرون از ریپو) `UserStats`+`User(0)`+
  `RevenueShare` می‌سازد و pubkey + خطوط env را چاپ می‌کند.
- `npm run velocity:referral-sweep` — برای cron: `RevenueShareEscrowMap.syncAll()`
  → `getAllByReferrer` / `getEscrowsOwingRevenueShare` → چک
  `calculateRevenueShareSweepAvailable` قبل از هر `settleRevenueShare`
  (`VELOCITY_SWEEP_DRY_RUN=1` برای خشک).

مسیر Builder Code (که به کارمزد کاربر **اضافه** می‌کند) عمداً پیاده نشده؛
واحد آن هم ۱۰ واحد tenth-bps = ۱ bp است (سقف پروتکل 1000 = ۱٪) — اگر روزی
اضافه شود فقط با تأیید صریح کاربر در UI.

چیزی که کد نمی‌تواند و باید دستی انجام شود: ساخت/نگهداری کی‌پیر FBT، امضای
تراکنش‌های راه‌اندازی، ست کردن env در Vercel و درخواست سطح Accelerated.
