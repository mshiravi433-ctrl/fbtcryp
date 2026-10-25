# فاز صفر — «سفارش خودکار» روی ونووی پرپتوال: dYdX و Ostium

**تاریخ:** ۲۰۲۶-۱۰-۲۵
**شاخه:** `arena/2dd4aacf-fbtcryp`
**سند بالادستی:** [امکان‌سنجی تب «اتصال به صرافی بیرونی»](2026-10-25-external-exchange-api-autoorder-feasibility-fa.md) — بخش ۱۲، ردیف «فاز صفر»
**وضعیت:** اجرا شد، تست‌ها سبز، آمادهٔ ادغام در `main`

---

## ۰. خلاصهٔ یک‌بندی

فاز صفر یعنی: موتور «سفارش خودکار» به‌جای آنکه فقط هشدار بفرستد، روی دو ونووی
پرپتوالی که **از قبل کلید تفویضی و کد سازندهٔ ما را دارند** سفارش واقعی بگذارد و
لغو کند. هیچ زیرساخت پولی تازه‌ای اضافه نشد، هیچ حضانتی شکل نگرفت، هیچ کلید
صرافی بیرونی ذخیره نشد، و درآمد روی همان ریل کارمزد سازنده باقی ماند
(dYdX با ۱۰۰۰ ppm، Ostium تا ۵۰ bps).

در مسیر اجرا **دو باگ پروتکلی** پیدا شد که هر دو از قبل در کد بودند و هر دو باعث
می‌شدند مسیر «ساخته‌شده» عملاً اجرا نشود:

| # | باگ | نتیجهٔ واقعی |
|---|---|---|
| ۱ | `placeDydxOrder` برای سفارش LIMIT مقدار `timeInForce` را `undefined` می‌فرستاد | SDK پیش از هر امضایی `timeInForce must be set if orderType is LIMIT` پرتاب می‌کرد — **هیچ سفارش محدود dYdX از این اپ ثبت نشده بود** |
| ۲ | `buildOpenTrade` در هر دو انکودر (مرورگر و سرور) همیشه `slippageBps` می‌فرستاد (پیش‌فرض ۲۵) | از فوریهٔ ۲۰۲۶ پروتکل Ostium برای سفارش limit/stop اسلیپیج غیرصفر را **ریورت** می‌کند — **هیچ سفارش استراحت‌کنندهٔ Ostium از این اپ روی زنجیره نمی‌نشست** |

هر دو رفع شدند و هر دو با تستِ خودِ کدِ فروشنده قفل شدند (بخش ۶).

---

## ۱. صورت مسئله: چرا فاز صفر و نه تب «اتصال صرافی بیرونی»

سند امکان‌سنجی به این نتیجه رسید که تب «کلید API سایت دیگر» سه مانع مستقل دارد:

1. **جغرافیایی/قانونی** — بایننس، OKX و Bybit صریحاً ایران را ممنوع کرده‌اند و کلید
   API را برای فعالیت از حوزهٔ قضایی محدودشده غیرفعال می‌کنند (پروندهٔ باز DOJ/دادستانی
   منهتن دربارهٔ بایننس، ۲۰۲۶-۰۹-۲۲). پرسیدن کلید از کاربرِ ایرانی یعنی دعوت او به
   چیزی که حسابش را فریز می‌کند.
2. **حضانتِ اختیار** — اینکه دارایی روی سایت دیگر است، حضانتِ *دارایی* را از بین
   می‌برد، اما کلیدِ «اجازهٔ معامله» حضانتِ *اختیار معامله* است. اگر آن کلید روی
   سرور ما بنشیند، ما تصمیم‌گیرندهٔ معاملاتی کاربر می‌شویم.
3. **«سود بده»** — وعدهٔ سود، مدیریت داراییِ دارای اختیار است، نه ابزار.

فاز صفر هیچ‌کدام از این سه را لمس نمی‌کند، چون:

- ونوو **ما** هستند (dYdX و Ostium)، نه صرافی بیرونی؛
- کلید **تفویضی و موقت** است: در dYdX یک کلید درون‌مرورگریِ ephemeral که در
  sessionStorage می‌ماند و فقط سفارش می‌گذارد/لغو می‌کند (برداشت ندارد)؛ در Ostium
  خودِ کیف‌پول کاربر هر تراکنش را امضا می‌کند؛
- **هیچ موتور خودکاری سمت سرور نیست** — سفارش روی خودِ ونوو استراحت می‌کند و ونوو
  آن را اجرا می‌کند. ما فقط «می‌گذاریم» و «لغو می‌کنیم»؛ هر دو با امضای کاربر.

این همان الگویی است که Hyperliquid با «agent wallet» استاندارد کرده (فاز ۱ سند
بالادستی) و دقیقاً همان چیزی است که dYdX از قبل در این اپ دارد.

---

## ۲. چه چیزی ساخته شد

```
src/lib/perpOrders.js            ← پلنرِ خالص + انبار رکوردها (بدون I/O، بدون حالت ماژول)
src/lib/perpAutoCopy.js          ← کپی FA/EN در یک ماژول (نه در ۱۲ فایل زبانه)
src/components/orders/PerpAutoOrders.jsx  ← UI، lazy، پشت پرچم speculation
src/pages/Orders.jsx             ← فقط یک نقطهٔ mount (lazyRetry + Suspense)
src/lib/dydx.js                  ← sendDydxOrder / placeDydxAutoOrder / cancelDydxOrder
src/lib/ostium.js                ← اسلیپیج ۰، buildCancelLimitOrder، getOstiumOpenOrders
server/futures/adapters/ostium.js ← همان دو قاعده در آینهٔ سرور (هم‌گام)
```

### ۲٫۱ پلنر خالص (`src/lib/perpOrders.js`)

قاعدهٔ تکرارشدهٔ این ریپو: **منطق خالص در lib، تماس با ونوو در لبه**
(الگو: `cowOrders.js`/`solanaOrders.js`). به همین دلیل پلنر نه `fetch` دارد، نه
`import.meta.env`، نه تایمر، و نه یک متغیر ماژولیِ قابل تغییر. تنها `localStorage`
آن دو تابع نگهبان‌دارِ خواندن/نوشتن رکوردها هستند.

پلنر برای هر سفارش تصمیم می‌گیرد:

- **ونوو** — `PERP_VENUE.DYDX | PERP_VENUE.OSTIUM`، با سقف‌های صریح
  (`PERP_VENUE_CAPS`: dYdX ۱۰۰۰ ppm، Ostium حداکثر ۵۰ bps + کارمزد اوراکل ۰٫۱۰ دلار).
- **نوع** — `PERP_KIND`: `entry-limit | entry-stop | take-profit | stop-loss`.
- **هندسهٔ بازار** — `dydxTickSize`/`dydxSizeStep` از `subticksPerTick` و
  `quantumConversionExponent`؛ اگر اینها در دسترس نباشند پلنر **رد می‌کند**
  (`TICK_UNKNOWN`/`SIZE_STEP_UNKNOWN`)، حدس نمی‌زند. گردکردن قیمت با جهت صریح
  (`roundPerpPrice(price, tick, 'up'|'down')`) تا یک سفارش خرید هرگز بالاتر از قیمت
  تایپ‌شدهٔ کاربر گرد نشود.
- **جهت تریگر** — `dydxTriggerSide` قاعدهٔ dYdX را کد می‌کند: در STOP، خرید **بالای**
  بازار و فروش **زیر** بازار آتش می‌شود؛ در TAKE_PROFIT برعکس. اگر تریگر از قبل رد
  شده باشد، پلنر `TRIGGER_WRONG_SIDE` می‌دهد؛ اگر یک LIMIT بازار را قطع کند
  (یا دقیقاً روی بازار باشد) `LIMIT_CROSSES_MARKET`. این دومین نام قبلاً
  `TRIGGER_PASSED` بود که برای یک سفارش محدود معنای درستی نداشت.
- **Ostium** — برای هر سفارش غیر مارکت `slippageBps` را به **۰** زور می‌کند و آنچه
  کاربر خواسته در `requestedSlippageBps` نگه می‌دارد (تا UI بتواند توضیح بدهد چرا
  تغییر کرد). اندیشهٔ نهional = وثیقه × اهرم. `index` یک شکاف uint8 است، پس خارج از
  ۰–۲۵۵ رد می‌شود (`INVALID_INDEX`).
- **پیش‌نمایش کارمزد** — `perpFeePreview` سهم ما، سهم ونوو و کارمزد اوراکل را جدا
  گزارش می‌کند و اگر نتواند کل را کامل کند، `totalFeeUsd: null` می‌دهد نه صفر.
- **وضعیت** — `PERP_STATE` + `dydxOrderState`/`ostiumOrderState`؛ وضعیتی که ونوو
  جوابش را نداده `UNKNOWN` می‌ماند و **هرگز به «باز» ترجمه نمی‌شود**.

### ۲٫۲ لبهٔ dYdX (`src/lib/dydx.js`)

`sendDydxOrder` تنها جایی است که ۲۲ آرگومان جایگاهی `client.placeOrder` نوشته
می‌شود. این مهم است: سه فراخوانی قبلاً هرکدام این آرگومان‌ها را جدا می‌نوشتند و
همین باعث شد آرگومان هشتم (`timeInForce`) در یکی غلط و در بقیه درست باشد.

تاپل‌های درست که با **خودِ SDK پین‌شدهٔ ۳٫۴٫۰** تأیید شدند:

| نوع سفارش | `type` | `timeInForce` | `execution` | `postOnly` | عمر | `OrderFlags` |
|---|---|---|---|---|---|---|
| محدودِ استراحت‌کننده | `LIMIT` | `GTT` | `null` | `false` (بولین، نه `undefined`) | `goodTilTimeInSeconds` | `LONG_TERM` (۶۴) |
| ورود/خروج استاپ | `STOP_MARKET` | **نباید باشد** | `IOC` | `false` | — | `CONDITIONAL` (۳۲) |
| حد سود | `TAKE_PROFIT_MARKET` | **نباید باشد** | `IOC` | `false` | — | `CONDITIONAL` (۳۲) |
| مارکت | `MARKET` | `undefined` مجاز | `IOC` | `false` | — | `SHORT_TERM` (۰) |

سه دامی که در SDK ۳٫۴٫۰ اندازه‌گیری شدند و در کد ما بسته شدند:

1. `calculateOrderFlags(LIMIT, undefined)` **پرتاب می‌کند** — LIMIT بدون TIF معنا ندارد.
2. `calculateTimeInForce(LIMIT, GTT, *, undefined)` **پرتاب می‌کند** با پیام
   «postOnly must be set if order type is LIMIT and timeInForce is GTT» — یعنی
   `postOnly: false` یک *مقدار* است، نه «نرسیدن به آرگومان».
3. `STOP_MARKET`/`TAKE_PROFIT_MARKET` با `execution` برابر `DEFAULT` یا `POST_ONLY`
   پرتاب می‌کنند («Execution value DEFAULT not supported for STOP_MARKET or
   TAKE_PROFIT_MARKET»)؛ فقط `IOC`/`FOK` مجاز است.

**لغو:** `cancelOrder(subaccount, clientId, orderFlags, marketId, goodTilBlock,
goodTilTimeInSeconds)` برای سفارش stateful (LONG_TERM یا CONDITIONAL) عمر غیرصفر
می‌خواهد و `goodTilBlock` باید **دقیقاً صفر** باشد — `undefined` پرتاب می‌کند
(«Lifetime must be set if ...»/«goodTilBlock must be 0»). برای SHORT_TERM برعکس.
`cancelDydxOrder` جدید همین را کد می‌کند؛ `cancelDydxConditionalOrder` قدیمی
`CONDITIONAL` را هاردکد کرده بود و برای یک LIMIT بلندمدت غلط بود.

`DYDX_LIMIT_GOOD_TIL_SECONDS = 28 * 24 * 60 * 60`. در UI چهار گزینهٔ انقضا هست
(۱/۷/۲۸/۹۰ روز)؛ ۹۰ روز از سقف ۲۸ روزهٔ dYdX برای سفارش stateful بیشتر است و
پلنر آن را با `BAD_EXPIRY` رد می‌کند — یعنی گزینه‌ای که در UI هست ولی ونوو قبول
نمی‌کند، پیش از امضا رد می‌شود نه بعد از یک تراکنش شکست‌خورده.

### ۲٫۳ لبهٔ Ostium (`src/lib/ostium.js` + آینهٔ سرور)

- **اسلیپیج ۰ برای غیرمارکت** در هر دو انکودر. بردارهای طلایی
  `test/ostium-golden.json` همه مارکت هستند، پس این قاعده هیچ‌کدام را نمی‌شکند و
  تست هم‌گامی آینه سبز ماند.
- **`buildCancelLimitOrder(pairId, idx)`** → `cancelOpenLimitOrder(uint16,uint8)`.
  انتخابگر با SDK ۰٫۱۲٫۰ تطبیق داده شد.
- **`getOstiumOpenOrders()`** روی همان `POST /api/ostium/subgraph` موجود می‌خواند.
  آن مسیر **allowlist پرس‌وجو ندارد** و کوئری تازه بدون هیچ تغییر سمت سرور کار
  می‌کند — یک تأیید صریح، نه حدس.
- **`idx`** آخرین قطعهٔ `_` در شناسهٔ ساب‌گراف است (`id.split('_').pop()`)، یعنی
  شکاف on-chain؛ شمارندهٔ سراسریِ `orderId` در uint8 جا نمی‌شود و استفاده از آن
  یک لغو اشتباه را لغو می‌کرد.
- **هزینهٔ لغو:** Ostium برای لغو یک سفارش limit/stop حدود ۰٫۱۰ USDC از وثیقه
  کم می‌کند و کارمزد اوراکلِ زمان ثبت **برگشت‌ناپذیر** است. این در کپی بازبینی
  به کاربر گفته می‌شود.

### ۲٫۴ انبار رکوردها

`PERP_ORDERS_STORAGE_KEY = 'fbt-perp-orders-v1'`، `MAX_PERP_ORDERS = 50`،
و خواندن/نوشتن در برابر نبودِ `localStorage` و JSON خراب نگهبان دارد. رکورد پس از
ثبت **همان عمری را نگه می‌دارد که امضا شد** (`goodTilSeconds` + `orderFlags`) تا
لغو بتواند خودش را بازسازی کند.

**چرا سمت سرور آینه نشد:** `server/store.js` «آخرین نویسنده برنده» است و
`src/lib/orders.js` عمداً خالص است — `sanitizeKeeper` هر ارائه‌دهنده‌ای غیر از
`cow`/`jupiter` را دور می‌اندازد. افزودن dYdX/Ostium به آن لیست یعنی ساختن یک
اجراکنندهٔ سمت سرور، یعنی شروع حضانت. فاز صفر صریحاً این را انجام **نمی‌دهد**؛
ونوو خودش سفارش را نگه می‌دارد و اجرا می‌کند، پس به هیچ تیکر زیر روزانه‌ای نیاز
نیست (که روی پلن Hobby ویرسل همهٔ دیپلوی‌ها را می‌شکند).

### ۲٫۵ UI

`PerpAutoOrders` با `lazyRetry` و `<Suspense fallback={null}>` در `Orders.jsx`
سوار شده و پشت `SPECULATION_ENABLED` است (در بیلدی که speculation خاموش است
`null` برمی‌گرداند). نتیجهٔ اندازه‌گیری‌شده:

- چانک جدا: `dist/assets/PerpAutoOrders-*.js` = **۵۰٬۵۳۵ بایت**.
- چانک eager (`index-*.js`) **صفر** ارجاع به آن دارد؛ تنها چانکِ lazyِ `Orders`
  به آن اشاره می‌کند.
- بودجهٔ first-paint: **۱۷۰۸٫۸۱ KB از ۱۷۵۰ KB** (با `VITE_ENABLE_SPECULATION=true`
  و `VITE_ENABLE_SPOT_TRADE=true`، یعنی سنگین‌ترین پیکربندی) — سبز.

کلاس‌های CSS استفاده‌شده همه **موجود** هستند (`ord-badge is-keeper|is-watch`،
`ord-status-ready|quote-below|unavailable`، `ord-field`، `ord-warn`، `segmented`).
دو کلاسی که در نسخهٔ نخست نوشته شده بودند (`.ord-keeper-badge` و
`.ord-keeper-state`) در ریپو وجود ندارند و حذف شدند — قاعده: پیش از استفاده از هر
کلاس، `src/index.css` و `src/styles/*.css` را grep کن.

سه باگ درون‌فایلی که پیش از اولین اجرا پیدا و رفع شد: حلقهٔ TDZ (سه متغیر پس از
`useMemo`-ای تعریف شده بودند که از آنها استفاده می‌کرد)، یک بلوک تکراری
`const { haptic } = useTelegram()`، و یک عبارت سه‌گانهٔ دوتایی برای قیمت.

---

## ۳. کپی: یک ماژول، دو زبان، و سه خط قرمز

افزودن کلید به ۱۲ فایل زبانه، بررسی‌کنندهٔ «شکاف کلید» را به خطر می‌اندازد
(۱۳٬۰۹۵ کلید در `src/i18n/coverage.json`). پیشینهٔ `keeperCopy.js` دنبال شد:
کپی درون‌ماژولی در `src/lib/perpAutoCopy.js` با `perpAutoCopyFor(lang)` که برای
`/^fa\b/i` فارسی و در غیر این صورت انگلیسی می‌دهد.

خط‌قرمزهای محصولی که هم در تست واحد و هم در ممیزی سیم‌کشی قفل شده‌اند — هیچ رشتهٔ
نمایشیِ کاربر (با حذف کامنت‌ها) نباید اینها را داشته باشد:
`سود تضمینی`، `درآمد قطعی`، `ربات پرسود`، `تضمین سود`، `guaranteed profit|return`،
`sure profit`، `risk-free`.

و باید اینها را داشته باشد: امکان از دست رفتن بخشی یا همهٔ سرمایه، اینکه کاربر هر
تراکنش را امضا می‌کند، و اینکه سهم پلتفرم چیست (bps/ppm). وضعیتِ بی‌جواب
«خوانده نشد» است، نه «باز».

---

## ۴. چه چیزی عمداً ساخته نشد

| ساخته نشد | چرا |
|---|---|
| تب «کلید API صرافی بیرونی» | سه مانع بخش ۱؛ فاز ۲ سند بالادستی |
| اجراکنندهٔ سمت سرور | حضانتِ اختیار؛ `server/watch.js` عمداً مسیر امضا/allowance ندارد |
| افزودن dYdX/Ostium به `sanitizeKeeper` | همان دلیل بالا؛ `orders.js` خالص می‌ماند |
| کران زیر روزانه در `vercel.json` | روی Hobby **همهٔ دیپلوی‌ها** را می‌شکند |
| ارتقای `@ostium/builder-sdk` به ۰٫۱۲٫۰ | قاعدهٔ اسلیپیج یک قاعدهٔ **on-chain** است، نه فقط SDK؛ بردارهای طلایی روی ۰٫۷٫۰ قفل‌اند و ارتقا ریسک بی‌فایده است |
| ارتقای `@dydxprotocol/v4-client-js` از ۳٫۴٫۰ | همان دلیل؛ تاپل‌ها با نسخهٔ پین‌شده تأیید شدند |
| تب تازه در `Orders.jsx` | آن صفحه سیستم تب ندارد؛ کار تب به `src/pages/Perp.jsx` تعلق دارد |
| CCXT | وابستگی تازه بدون نیاز؛ ونووها SDK خودشان را دارند |

---

## ۵. ریسک‌ها و کارهای باقی‌مانده

1. **اندازه‌گیری روی دستگاه واقعی** — سندباکس نه کیف‌پول دارد نه فید زندهٔ ونوو؛
   مسیر امضا روی مرورگر واقعی تست نشده. تست‌ها پلنر، تاپل‌ها و انکودرها را قفل
   می‌کنند، نه پاسخ واقعی dYdX/Ostium را.
2. **`IconExternal/IconShield/IconTrend`** در `src/components/Icons` و propهای
   `Sheet`/`SegIndicator`/`ModernSelect` با خواندن منبع تأیید شدند، نه با رندر.
3. **TP/SL در Ostium** امروز از دو راه اثبات‌شده می‌رود: TP/SL در لحظهٔ باز شدن
   (پروتکل اجرا می‌کند) یا `buildModifyPosition`. سفارش استراحت‌کنندهٔ limit/stop
   حالا انکودر و لغو درست دارد ولی در `Ostium.jsx` هرگز `orderType` پاس نمی‌شود —
   یعنی سیم‌کشیِ UIِ آن مسیر کار فاز بعدی است.
4. **`src/lib/dcaExecution.js`** هنوز `isUnavailableChain()` را برای `dydx`/`ostium`
   درست برمی‌گرداند؛ تغییرش فقط وقتی مجاز است که یک رسید اجرای واقعی موجود باشد
   (`verified === true`، شناسهٔ منطبق، `txHash.length >= 8`، `actualUsd > 0`).
5. **فاز ۱** (Hyperliquid با agent wallet کاربر + کد سازنده، ۱۰۰ USDC
   برگشت‌پذیر) قوی‌ترین پیشینهٔ «اتوماسیون بدون حضانت» است و قدم بعدی منطقی.

---

## ۶. تست‌ها

| مجموعه | نتیجه |
|---|---|
| `test/perp-venue-contract-probe.mjs` (تازه، در `test/run.mjs` ثبت شد) | سبز — تاپل قدیمی با کد خودِ فروشنده پرتاب می‌کند؛ `LIMIT+GTT → LONG_TERM` و `isStatefulOrder === true`؛ `STOP_MARKET → CONDITIONAL` با TIF برابر IOC (۱)؛ `orderFlagsFor` برای ۸ جفت نوع/TIF با `calculateOrderFlags` SDK agrees؛ قاعدهٔ لغو هم در منبع فروشنده هم در ما؛ یک نقطهٔ فراخوانی برای `placeOrder`/`cancelOrder` |
| `test/perp-auto-orders-units.mjs` (تازه، در `test/units.mjs` ثبت شد) | **۹۸ ردیف تازه، همه سبز** |
| باندل `test/units.mjs` | ۲۰۳۴ ردیف؛ ۸ شکست که **دقیقاً همان ۸ شکستِ بیس‌لاین بدون تغییرات من** است (به fetch-stub اجراکننده نیاز دارند) |
| `test/wiring.mjs` | ۲۹۵۱ ردیف؛ **۱۷ ردیف تازه همه سبز**؛ ۶۰ شکست = **دقیقاً برابر با بیس‌لاین** |
| `test/tpsl-depth-history.test.mjs` | ۴۰/۴۰ سبز (تغییرات `dydx.js` آن را نشکست) |
| `test/futures-engine-probe.mjs` | همهٔ بردارهای طلایی Ostium سبز، از جمله «WTI 3x with wider slippage» (مارکت، اسلیپیج حفظ شد) |
| `test/ostium-subgraph-gateway.test.mjs` | ۱۰/۱۰ سبز |
| `npx vitest run test/orders-*.test.jsx` | ۷۷/۷۸ سبز؛ تنها شکست («marks a token with no feed…») **روی بیس‌لاین هم شکست دارد** |
| `vite build` | سبز؛ first-paint ۱۷۰۸٫۸۱ KB از ۱۷۵۰ KB |

دو مورد از تست‌ها عمداً **رفتار فروشنده** را قفل می‌کنند نه متن ما را: پروب،
`helpers.calculateOrderFlags`/`calculateTimeInForce` را از مسیر CJSِ SDK پین‌شده
(`build/cjs/src/…`) صدا می‌زند، چون `exports` اجازهٔ import مسیرهای ESM داخلی را
نمی‌دهد. سه تلاش برای ESM پیش از این شکست خورده بود و تکرار نشد.

یک دام در خودِ تست‌ها: `test/tpsl-depth-history-ui.test.jsx` ماژول `dydx` را با
فقط ۵ export ماک می‌کند؛ اگر کامپوننت TP/SL زمانی این مسیر را transitively
import کند، آن ماک باید گسترش یابد.

---

## ۷. چک‌لیست پذیرش

- [x] موتور سفارش خودکار روی ونووهای کلید-تفویضیِ زندهٔ خودمان کار می‌کند، نه فقط هشدار
- [x] بدون زیرساخت پولی تازه؛ بدون حضانت؛ بدون ذخیرهٔ کلید معاملاتی CEX
- [x] درآمد روی همان ریل کارمزد سازنده (dYdX ۱۰۰۰ ppm به `dydx17493m25rh59j2sf2525r49htr2cva5rqnf76r7`؛ Ostium تا ۵۰ bps)
- [x] هیچ عبارت «سود تضمینی» در هیچ رشتهٔ نمایشی نیست (با تست قفل شده)
- [x] بودجهٔ first-paint بالا نرفت (بخش lazy است)
- [x] آینهٔ سرور و مرورگر هم‌گام ماند (تست هم‌گامی سبز)
- [x] ادغام در `main` برای دیپلوی تولید (دیپلوی برای `arena/*` خاموش است)
