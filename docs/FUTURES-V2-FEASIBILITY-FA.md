# امکان‌سنجی «FBT Futures v2 — Perpetual Trading Terminal»

**تاریخ:** ۲۰۲۶-۱۱-۰۸ · **شاخه:** `arena/99530337-fbtcryp` · **نوع سند:** امکان‌سنجی و تحلیل شکاف (بدون تغییر کد)
**پرسش:** آیا طرح ۱۳ بخشی «ترمینال حرفه‌ای پرپچوال» روی همین کد قابل اجراست، و چه چیزی کم داریم؟

> این سند **کد نمی‌نویسد**. هر عددی که می‌گوید «اندازه‌گیری شد» از اجرای واقعی روی همین checkout آمده؛ هر چیزی که از مستندات فروشنده آمده با منبع علامت خورده ([فهرست منابع](#۱۱-منابع)). جایی که نتوانسته‌ام تست کنم، صریح گفته‌ام.

---

## ۰. جواب کوتاه

**بله، اجرایی است — ولی نه در یک مرحله و نه با فرض‌هایی که در طرح نوشته شده.**

سه چیز امروز بین طرح و واقعیت ایستاده، و هیچ‌کدام با کد حل نمی‌شود:

| # | مانع | چرا با کد حل نمی‌شود |
|---|---|---|
| ۱ | **هیچ انبار داده‌ی تاریخی برای OI / Funding / Liquidations وجود ندارد.** دیتابیس، cron جمع‌کننده و سری زمانی نداریم؛ فقط snapshot لحظه‌ای از dYdX و Velocity | این داده را باید یا خودمان از امروز جمع کنیم (که یعنی «امروز شروع کن، دو هفته بعد اولین سری») یا از فروشنده بخریم (Coinglass: heatmap فقط از پلن ۸۷۹ دلاری) [1](https://cryptomarkets.tools/tools/coinglass) |
| ۲ | **دو ونوی اصلی، مکانیک اهرم/مارجینی که طرح فرض کرده را ندارند.** dYdX v4 فقط cross-margin دارد، اسلایدر اهرم ندارد (اهرم از حجم پوزیشن مشتق می‌شود) و isolated یعنی subaccount فرزند ≥۱۲۸ با حداقل ۲۰ USDC [2](https://docs.dydx.xyz/interaction/integration/integration-onboarding)[3](https://nautilustrader.io/docs/nightly/integrations/dydx/). Velocity هم مارجین cross دارد | فرم‌هایی مثل «Cross/Isolated» و «کاهش اهرم» باید per-venue تعریف شوند، نه global — وگرنه UI چیزی را نشان می‌دهد که ونو انجام نمی‌دهد |
| ۳ | **زمین حقوقی/جغرافیایی.** هر دو ونوی پرپ‌چوال اصلی (Hyperliquid و dYdX) دسترسی از ایران را در Terms خود بسته‌اند [4](https://learnhyper.com/access/countries/)[5](https://www.datawallet.com/crypto/dydx-restricted-countries)، و مجوز TradingView Advanced Charts فقط برای «محیط عمومی و بدون پی‌وال» است و باید درخواست داده شود [6](https://www.tradingview.com/free-charting-libraries/)[7](https://www.tradingview.com/charting-library-docs/latest/introduction/) | این‌ها تصمیم مالک/حقوقی است، نه مهندسی. تا روشن نشود، هر یک ساعت کد روی این بخش ممکن است دور ریخته شود |

و یک نکته‌ی مهم درباره‌ی خودِ صفحه: ترمینالی که در طرح توصیف شده، **عمداً** در v1 حذف شده بود. تست‌های `test/perp-layout.test.jsx` و `test/perp-redesign.test.jsx` امروز «نبودِ ترمینال» را assert می‌کنند:

```
test/perp-redesign.test.jsx:138  it('does NOT put the order ticket, the fee table or the liquidation table on the page')
test/perp-layout.test.jsx:125    it('keeps the page free of anything that is not the list')
```

یعنی v2 ≠ «کشیدن چند باکس روی `/perp`»؛ v2 = **یک مسیر تازه** (دسکتاپ) با بازنویسی آگاهانه‌ی آن دو تست. اگر بدون این تصمیم شروع شود، CI قرمز می‌شود و ظاهراً «کار خراب است»، در حالی که فقط قرارداد قدیمی نقض شده.

---

## ۱. نقطه‌ی شروع: امروز دقیقاً چه داریم

اندازه‌گیری روی همین checkout: **۱۳۳۷ فایل در `src` (۴۲۶٫۷k خط)، ۳۸۷ فایل در `server` (۱۴۴k خط)، ۸۱۴ فایل تست، ۱۲ locale**.

| لایه | فایل | واقعیتِ امروز |
|---|---|---|
| تب‌ها | `src/pages/Perp.jsx` (۱۸۰۶ خط) | چهار تب: spot / overview (پرپچوال) / dYdX / on-chain؛ همه پشت `SPECULATION_ENABLED` به‌جز spot |
| **لیست جفت‌ها** | همان، `perp-pair-strip` | کاتالوگ ساخته‌شده از featured + کاتالوگ ونو + جدول بازار زنده + جستجو + تعداد اعلام‌شده |
| تیکت سفارش | همان (Sheet تمام‌صفحه) | long/short، collateral، چیپ اهرم `[2,5,10,20,50]`، TP/SL **فقط برای Ostium** (`supportsTpSl = route === ROUTE.OSTIUM`)، پیش‌نمایش لیکوییدیشن از موتور خالص |
| موتور خالص | `src/lib/futures-engine/` (۹ فایل) | `providers` کاتالوگ + capability flag، `fees` (Protocol+Network+FBT با سقف)، `risk` (score/level/فاصله لیکوییدیشن/warning)، `router`، `stateMachine`، `errors`، `ids`, `events`, `store` |
| BFF | `server/futures/router.js` (۷۷۲ خط) | `/providers /health /markets /markets/:p/:m /candles /funding /open-interest /positions/:wallet /account/:wallet /fees /fees/ledger /quote /risk /prepare /execute /simulate /verify /positions/:id/{increase,decrease,close,tp,sl} /executions/:wallet` — همه واقعی، هیچ‌کدام امضا نمی‌کند |
| ونوها | `server/futures/adapters/{drift,ostium}.js`, `src/lib/dydx.js`, `src/lib/hyperliquid/*` | Velocity (Solana، کلاینت می‌سازد و کیف پول امضا می‌کند)، Ostium (calldata امضانشده)، dYdX (نشست client-signed)، Hyperliquid (کل زنجیرهٔ کد نوشته شده ولی `execution: NOT_BUILT` و در کاتالوگ `tab: null`) |
| چارت | `ProChart` (۱۲۰۴ خط + `proChartMath` ۴۲۸ خط)، `TradingChart`، `FuturesMarketChart` | lightweight-charts **۵.۲.۱** به‌صورت `await import()` (lazy). ProChart: شمع/خط/ناحیه، MA/EMA، Bollinger، RSI، MACD، حجم، Fibonacci، price line، log scale، کراس‌هیر، اسکرین‌شات |
| چارت فیوچرز | `FuturesMarketChart.jsx` | فقط **۴ بازه** `15m/1h/4h/1d`؛ تب dYdX عملاً **خط** می‌کشد (`TrendChart`)، نه شمع |
| پوزیشن‌ها | `FuturesPositionsCard.jsx` (۴۲۹ خط) | ادغام Solana+EVM، poll هر ۱۰ ثانیه فقط وقتی تب visible، بستن ۲۵/۵۰/۱۰۰٪. فیلدها: entry/mark/size/pnl/TP/SL — **بدون** ROE، funding paid، marge، liq price، leverage |
| دفتر سفارش | `DerivativesDashboard` (`/derivatives`) | فقط برای dYdX، و فقط **دو عدد**: bid/ask depth در ±۱٪ + spread. عمق واقعی یا تیبل ۲۰ سطحی ندارد |
| فاندینگ | `server/perp.js` + `FundingPanel` | CoinGecko `/derivatives`، جدول اینتروال هر ونو (۸h/۱h) با قاعده‌ی «نرخ بی‌تاریخ را سالانه نکن»؛ ۶ دارایی |
| هشدار | `server/priceWatch.js`, `server/orderAlerts.js`, `push.js`, cron ۵ دقیقه‌ای GitHub | زیرساخت push + قیمت/P&L موجود است؛ **هیچ هشدار مخصوص پرپ‌چوال** (فاصله لیکوییدیشن، فاندینگ) وجود ندارد |
| هوش مصنوعی | `server/aiGateway.js` (۱۰ پرووایدر)، `aiMarketEngineRoutes`, `marketOverviewIntel` | زیرساخت آماده؛ ولی هیچ پرامپت/پیلود اختصاصی «تحلیل پرپچوال» با اعداد قرارداد وجود ندارد |
| دکمه/قرارداد | `src/lib/futures-engine/providers.js` | `capabilities` هر ونو ۱۵ فلگ دارد (canExecute، supportsLimitOrders، supportsReduceOnly…) — **این دقیقاً قرارداد آداپتر است که بخش ۱۲ طرح می‌خواهد**؛ فقط ناقص است |

**نتیجه:** ستون فقرات معماری پیشنهادی طرح (لایه ۱۲) از قبل وجود دارد. v2 بیشتر «پر کردن» است تا «ساختن از صفر» — به‌جز یک لایه که کامل غایب است: **موتور داده‌ی بازار**.

---

## ۲. وضعیت اجرایی: آنچه همین حالا کار می‌کند (اندازه‌گیری‌شده)

| بررسی | فرمان | نتیجه |
|---|---|---|
| نصب وابستگی‌ها | `npm ci --ignore-scripts` | ❌ `EBADPLATFORM fsevents` (وابستگی اختیاری macOS) — با `npm install --ignore-scripts` یا `--omit=optional` حل شد |
| تست‌های پرپ | `npx vitest run test/perp-terminal.test.jsx test/perp-routes.test.js` | ✅ **۴۱/۴۱ سبز** |
| موتور فیوچرز | `node test/futures-engine-probe.mjs` | ✅ سبز (calldata، allowlist، کارمزد) |
| بیلد کامل | `vite build` با `VITE_ENABLE_SPECULATION=true` | ✅ **۱m۰۶s** (heap ۲٫۶GB) |
| بودجه first paint | `node scripts/check-first-paint.mjs` | ✅ **۱۷۹۴٫۰۹ KB از ۱۸۲۵ KB** → فقط **۳۱ KB** سر جای مانده |

⚠️ **محدودیت شبکه‌ی این سندباکس:** فقط `npmjs`, `github`, `pypi` باز است. پس نتوانستم پاسخ واقعی `indexer.dydx.trade`، `api.hyperliquid.xyz` یا `data.velocity.exchange` را ببینم. هرچه در بخش ۳ درباره‌ی «چه داده‌ای قابل دریافت است» می‌گویم از **مستندات رسمی فروشنده** است، نه از اجرای زنده.

---

## ۳. شکاف بخش‌به‌بخش: ۱۳ بخش طرح در برابر امروز

راهنمای ستون «منبع داده»: 🟢 رایگان و بدون کلید از ونوی موجود · 🟡 رایگان ولی از یک CEX (به‌عنوان بنچمارک بازار) · 🔴 پولی یا ناموجود

### ۳٫۱ — نوار اطلاعات بازار (بخش ۱ طرح)

| فیلد | dYdX | Velocity | Ostium | امروز در UI |
|---|---|---|---|---|
| Last / Mark / Index | `oraclePrice` (+ candle close) | `mark` + `oracle` | `mid` | فقط mid/oracle |
| 24h Change | `priceChange24H` ✅ | `priceChange24hPercent` ✅ | ندارد | ✅ |
| **24h High/Low** | ❌ در market نیست → از کندل‌ها | ❌ | ❌ | ❌ **غایب** |
| 24h Volume | `volume24H` ✅ | `volume24hUsd` ✅ | ندارد | ✅ |
| Open Interest | `openInterest` (base) ✅ | `openInterestLong/ShortUsd` ✅ | subgraph ✅ | ✅ |
| Funding Rate | `nextFundingRate` (۱h) ✅ | `fundingHourlyPct` ✅ | `lastFundingRate`/block (تخمین) | ✅ (در جدول جدا) |
| **Next Funding (زمان)** | `nextFundingAt` هست، **در `normaliseMarket` مپ نشده** [8](https://dydxprotocol.github.io/v3-teacher/) | ندارد | ندارد | ❌ |
| **Margin fractions** (IMR/MMR) | `initialMarginFraction`, `maintenanceMarginFraction` هست، **مپ نشده** | از stats قابل تخمین | — | ❌ (موتور ریسک فرض می‌کند لیکوییدیشن = ۱۰۰٪ زیان) |

**کاری که لازم است:** گسترش `normaliseMarket` در `src/lib/dydx.js` (۴ فیلد: `nextFundingAt`, IMR, MMR, `trades24H`)، محاسبه‌ی 24h High/Low از کندل ۱h (۲۴ کندل) همان‌جا، و یک فرمت یکسان `MarketSnapshot` برای هر سه ونو. این بخش **کوچک و کم‌ریسک** است (~۳–۴ روز) و بلافاصله بیشتر نوار بالای طرح را می‌دهد.

### ۳٫۲ — نمودار حرفه‌ای (بخش ۲)

| قابلیت | امروز | شکاف واقعی |
|---|---|---|
| Candlestick | ✅ ProChart | — |
| **Heikin Ashi** | ❌ | تبدیل OHLC خالص (۳۰ خط ریاضی، تست‌پذیر) |
| تایم‌فریم ۱m…۱W | فیوچرز: فقط ۱۵m/۱h/۴h/۱d | dYdX resolutionها ۱MIN…۱DAY است؛ **هفتگی ندارد** (باید از روزانه aggregate کنیم، وگرنه ادعای 1W دروغ است) |
| RSI/MACD/BB/EMA/SMA | ✅ | — |
| **VWAP** | ❌ | فرمول استاندارد (typical price × volume) — نیاز به حجم کندل که dYdX/Velocity می‌دهند |
| **Volume Profile** | ❌ | محاسبه‌پذیر از کندل‌ها (binning) — تقریبی، باید «تخمینی» برچسب بخورد |
| **OI Chart / Funding History** | ❌ | **نیاز به انبار داده** (بخش ۴)؛ dYdX `/v4/historicalFunding` دارد [9](https://pkg.go.dev/github.com/k4k3ru-hub/dydx/go/rest/endpoint) ولی **پروکسی نشده** |
| **Liquidation Heatmap** | ❌ | منبع رایگان **ندارد**؛ Coinglass پلن ۸۷۹$/ماه [1](https://cryptomarkets.tools/tools/coinglass) |
| Long/Short Ratio | ❌ | dYdX ندارد؛ Binance `/futures/data/topLongShortAccountRatio` رایگان و بدون کلید |
| نقاط ورود/خروج + خط لیکوییدیشن | 🟡 price line در ProChart هست، در فیوچرز استفاده نشده | اتصال ساده |
| **ابزار رسم (Trendline/Support)** | ❌ | بسته‌ی MIT `lightweight-charts-drawing@0.6.3` (peer: lwc ^5، ۸۶ ابزار) [10](https://registry.npmjs.org/lightweight-charts-drawing) — یا TradingView Advanced Charts |
| TradingView واقعی | ❌ | Advanced Charts: درخواست + محیط عمومی + بدون پی‌وال [6](https://www.tradingview.com/free-charting-libraries/)؛ برای اپ اندرویدی (WebView) هم باید مجوز بررسی شود |

**حکم:** ۹۰٪ بخش ۲ با `lightweight-charts` فعلی + ریاضی خالص انجام‌شدنی است (Heikin، VWAP، VP، Fibonacci، drawing). **دو چیز نه:** Liquidation Heatmap (داده) و «TradingView واقعی» (لایسنس). پیشنهاد: همان `ProChart` را به یک `FuturesChart` ارتقا بدهیم، نه موتور سوم؛ چون بیلد اول‌پینت فقط ۳۱ KB جا دارد و بسته‌ی drawing هم باید lazy بماند.

### ۳٫۳ — پنل سفارش (بخش ۳)

| قابلیت | dYdX | Velocity | Ostium | امروز در UI |
|---|---|---|---|---|
| Long/Short | ✅ | ✅ | ✅ | ✅ |
| **Leverage 1x..max** | ⚠️ مفهوم متفاوت: اهرم = notional/equity، سقف = 1/IMR | ✅ `maxLeverage` per market | ✅ | 🟡 چیپ ثابت `[2,5,10,20,50]` |
| **Cross / Isolated** | cross اجباری؛ isolated = subaccount ≥۱۲۸ (۳۰۰۰ زیرحساب، حداقل ۲۰ USDC) [2](https://docs.dydx.xyz/interaction/integration/integration-onboarding) | cross | cross | ❌ |
| Market | ✅ | ✅ | ✅ | ✅ |
| **Limit / Stop / TP-SL / Reduce-Only / Post-Only / TIF** | ✅ در SDK (`orderFlagsFor`, `timeInForce`, `postOnly`) | ✅ `PostOnlyParams`, trigger orders | limit موجود | 🟡 فقط market از تیکت؛ limit در صفحه dYdX، TP/SL فقط Ostium |
| پیش‌نمایش: مارجین، ارزش، کارمزد، ورود تخمینی، لیکوییدیشن، PnL | ✅ (`/quote`, `/risk`, `fees`) | ✅ | ✅ | ✅ برای کارمزد/لیکوییدیشن؛ **لیکوییدیشن روی مدل ۱۰۰٪-زیان** است چون MMR ونو را نداریم |

**بزرگ‌ترین ریسک این بخش:** عدد «قیمت لیکوییدیشن» امروز برای dYdX/Velocity با مدل `full-collateral-upper-bound` حساب می‌شود (کد خودش هم این را می‌گوید) — یعنی **زودتر از واقعیت** است و کاربر را محافظه‌کار می‌کند، ولی «حرفه‌ای» نیست. برای ترمینال v2 باید per-venue فرمول لیکوییدیشن واقعی پیاده شود: dYdX از `maintenanceMarginFraction`، Velocity از maintenance margin بازار، Ostium از قاعده‌ی مستند خودش (که هست). این کار **موتور ریسک را قابل‌اعتماد می‌کند** و پیش‌نیاز «Risk Guardian» است.

### ۳٫۴ — پوزیشن‌های باز (بخش ۴)

امروز `FuturesPositionsCard` این‌ها را دارد: entry، mark، size، PnL، TP/SL، بستن ٪. **ندارد:** ROE٪، Realized PnL، Funding Paid، Margin، Leverage، Liq.Price، افزودن مارجین، تغییر TP/SL از همان ردیف (dYdX کارت جدا دارد)، Close All، انتقال مارجین.

سرور از قبل `increase/decrease/close/tp/sl` را دارد — ولی برای **Velocity** فقط ۴ اکشن و برای Ostium ۵ اکشن؛ `increase` روی Velocity صریحاً `PROVIDER_READ_ONLY` برمی‌گرداند. یعنی «افزودن مارجین» در ترمینال باید per-venue فعال/غیرفعال شود، نه همیشه روشن.

Funding Paid: dYdX در `/v4/historical-pnl` و fills دارد؛ Velocity در account summary. **هیچ‌کدام پروکسی نشده** → این ستون یا ساخته می‌شود یا «—» می‌ماند (طبق قاعده‌ی honesty این repo، «—» بهتر از صفر است).

### ۳٫۵ — دفتر سفارش / معاملات / عمق (بخش ۵)

| پنل | داده | امروز |
|---|---|---|
| Order Book (n سطح) | dYdX `/v4/orderbooks/perpetualMarket` آرایه‌ی `bids/asks` می‌دهد [11](https://docs.dydx.xyz/interaction/integration/integration-markets)؛ پروکسی موجود است ولی فقط `bidDepth1Pct` را از آن حساب می‌کند (`src/lib/dydx.js:145`) — سطوح دور ریخته می‌شوند | 🟡 داده هست، UI نیست |
| | Velocity DLOB `/l2?marketName=…&depth=1` — کد **`depth=1`** می‌زند؛ اینکه پارامتر عمق تا چند سطح بالا می‌رود باید روی خود API تأیید شود (تست نکردم) | 🟡 |
| | Hyperliquid `l2Book` حداکثر **۲۰ سطح در هر طرف** می‌دهد [14](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) | 🔴 مسیر HL خاموش است |
| Recent Trades | dYdX `/v4/trades/perpetualMarket/{ticker}` [9](https://pkg.go.dev/github.com/k4k3ru-hub/dydx/go/rest/endpoint) — **پروکسی نشده** | ❌ |
| Depth chart | از همان orderbook | ❌ (فقط دو bar در `/derivatives`) |

این بخش **ارزان‌ترین برد بزرگ** است: منبع داده موجود است، فقط مسیر BFF + یک کامپوننت لازم دارد.

### ۳٫۶ — Market Intelligence (بخش ۶)

این جدول را باید صادقانه تقسیم کرد:

| شاخص | منبع واقعی | هزینه | حکم |
|---|---|---|---|
| OI (لحظه‌ای) | ونو | 🟢 | همین حالا |
| **OI Change / تاریخچه** | هیچ ونویی history نمی‌دهد (dYdX فقط عدد جاری) | 🟢 ولی **باید خودمان ذخیره کنیم** | از امروز snapshot بگیر |
| Funding history | dYdX `/v4/historicalFunding` | 🟢 | پروکسی + ذخیره |
| Long/Short ratio | dYdX ندارد → Binance futures data | 🟡 | «بنچمارک بازار، نه این ونو» برچسب بخورد |
| Taker Buy/Sell، CVD | از trades هر ونو یا Binance aggTrades | 🟡 | شدنی |
| Liquidation حجم | dYdX fills با `type: LIQUIDATED`؟ (نیاز به تأیید) | 🟡 | باید تست شود |
| **Liquidation Heatmap** | Coinglass Professional | 🔴 ۸۷۹$/ماه، و «استفاده تجاری فقط از پلن سوم (۳۷۹$+)» [1](https://cryptomarkets.tools/tools/coinglass) | یا بخر، یا حذف کن، یا «مدل تخمینی» با برچسب بزرگ |
| **Whale Positions** | Coinglass پلن Startup ۹۵$/ماه برای HL [1](https://cryptomarkets.tools/tools/coinglass) | 🔴 | فقط اگر بودجه باشد |
| Basis (perp−spot) | قیمت اسپات CoinGecko (موجود) | 🟢 | شدنی |

**قاعده‌ای که نباید شکسته شود:** heatmap و whale را نمی‌شود «از OI حساب کرد» و اسمش را داده گذاشت. سه گزینه است: بخریم، حذف کنیم، یا صریح بنویسیم «مدل تخمینی FBT از OI عمومی — نه داده‌ی ونو». گزینه سوم شرافتمندانه است ولی در UX باید از داده‌ی واقعی جدا دیده شود.

### ۳٫۷ — مدیریت ریسک (بخش ۷)

موتور `risk.js` از قبل دارد: riskScore، riskLevel، فاصله لیکوییدیشن، blockReasonها، سقفهای سیاست (`hardMaxLeverage=50`, `minLiquidationDistancePct=0.5`, `riskBudgetPctOfBalance=25`).

**ندارد:** Margin Ratio، Margin Utilization، Account Equity، Available Balance (کل حساب)، Maintenance/Initial Margin، Liquidation Distance در سطح **حساب**، Risk per Trade، Max Drawdown، Portfolio Exposure، Correlated Positions، Daily Loss Limit (در `caps.js` فقط برای Hyperliquid AI-trade هست)، Maximum Leverage Limit (بخشی هست).

هشدارها (لیکوییدیشن، فاندینگ، نوسان، نقدینگی، هم‌زمانی پوزیشن‌ها، فعال‌شدن SL): **زیرساخت push و cron ۵ دقیقه‌ای وجود دارد**، منطق هشدار مخصوص پرپ نه. یک نکته‌ی مهم: `FuturesPositionsCard` عمداً فقط وقتی تب visible است poll می‌کند — پس هشدارِ «نزدیک لیکوییدیشن» باید **سمت سرور/کرون** ساخته شود، نه با پولینگ مرورگر. یعنی یک مسیر cron تازه (مثل `/api/cron/futures-risk`) که کیف پول‌های تحت نظر را بخواند. این کار یعنی سرور باید آدرس کیف پول‌ها را نگه دارد — که الان در این repo عمداً نگه نمی‌دارد. **این یک تصمیم حریم خصوصی است، نه جزئیات فنی.**

### ۳٫۸ — موتور هوش مصنوعی (بخش ۸)

واقعیت: زیرساخت چند-پرووایدری (`aiGateway.js` با OpenRouter/OpenAI/Groq/Gemini/Anthropic/…) و `aiMarketEngineRoutes` موجود است. کاری که لازم است، «مدل تازه» نیست؛ **پیلود تازه** است:

- یک `futuresIntelPayload` که فقط اعداد واقعی را بفرستد (OI، OI change، funding، basis، long/short، فاصله لیکوییدیشن، نوسان) با timestamp هر کدام؛
- خروجی ساختاریافته با schema (`bias`, `confidence`, `drivers[]`, `risks[]`, `scenarios[]`) — نه متن آزاد؛
- سه محدودیت سخت: (۱) AI هرگز سفارش نمی‌سازد و امضا نمی‌کند (هم‌راستا با `AI_TRADE_ENABLED` فعلی که فقط «پیشنهاد» می‌دهد)، (۲) هر عدد در متن AI باید در پیلود باشد (ضدتوهم: اگر نبود، «نامعلوم»)، (۳) `confidence` یک عدد از یک قاعده‌ی مشخص باشد (مثلاً از سیگنال‌های منطبق)، نه سلیقه‌ی مدل.

آن ۹ زیرسیستم طرح، در عمل **۵ کال ماژول** است: (تحلیل بازار + سیگنال) / (ریسک + پیش‌بینی لیکوییدیشن) / (فاندینگ) / (نهنگ — وابسته به داده پولی) / (سناریو + استراتژی). ادعای «۹ موتور» بازاریابی است؛ از نظر کد یکی است با ۵ ورودی مختلف.

### ۳٫۹ و ۳٫۱۰ — تب‌های تکمیلی و شبیه‌ساز قبل از معامله

| تب طرح | امروز |
|---|---|
| Open Positions | ✅ (کارت) |
| Open Orders / Order History | 🟡 `getDydxOrders` هست، `PerpAutoOrders` در `/orders` هست — در صفحه فیوچرز نیست |
| Trade History | ✅ `FuturesHistory` (dYdX fills) — در انتهای تب dYdX |
| Transaction / Funding History | ❌ |
| PnL Analysis | ❌ (dYdX `/v4/historical-pnl` پروکسی نشده) |
| Copy Trading | 🟡 `smart-money copy-trade` در repo هست (پروب `smart-money-copy-trade-probe.mjs`)، اتصالش به پرپ ساخته نشده |
| Trading Bots | 🟡 `perpOrders.js` + `PerpAutoOrders` + `intent-ai/autonomy/botLoop.js` (PAPER/ARMED/LIVE با protections) — موتور هست، سطح پرپ ندارد |
| API / Automation | 🟡 `sdk/`, `mcp/`, `developerKeys.js` با scopeها؛ **عمداً** هیچ scopeی `sign/execute/withdraw` ندارد |

**شبیه‌ساز (بخش ۱۰):** تقریباً همه‌اش ریاضی خالص است و در `futures-engine` جا می‌گیرد: سناریوی ±۱/۳/۵٪، سرمایه در معرض، لیکوییدیشن، هزینه فاندینگ ۸/۲۴/۷۲h، زیان با SL، ریسک کل با چند پوزیشن. **یک شرط:** نرخ فاندینگ ۷۲ ساعته نباید با «نرخ فعلی × ۷۲» حساب شود (این همان خطای سالانه‌سازی بی‌تاریخ است که `server/perp.js` قبلاً حل کرده)؛ باید از تاریخچه‌ی جمع‌شده یا از «آخرین نرخ‌های اعلامی» استفاده شود و صریح بنویسد «تخمین با نرخ فعلی».

### ۳٫۱۱ تا ۳٫۱۳ — طراحی، معماری، اولویت

- **طراحی (بخش ۱۱):** `.app-shell` امروز `max-width: 520px` است و از ۹۰۰px به بعد `min(1440px, calc(100% - 96px))` می‌شود (با `app-shell--wide`), پس **پوسته‌ی سه‌ستونی دسکتاپ جا دارد**. ولی: ۱۸۰۶ خط `Perp.jsx` + ۱۶۰۸ خط `perp-modern.css` + تست‌هایی که «لیست بودن» را پین کرده‌اند یعنی ترمینال باید **مسیر جدا** باشد (`/perp/terminal` یا `/trade/:symbol`) با CSS جدا، وگرنه هر دو تجربه خراب می‌شوند.
- **معماری (بخش ۱۲):** ۸۰٪ آماده است. چیزی که واقعاً کم است در بخش ۴ آمده.
- **اولویت (بخش ۱۳):** ترتیب پیشنهادی من با ترتیب طرح **یک جا** تفاوت دارد: `Risk & Liquidation Engine` قبل از `Order Book` بیاید، نه بعد از آن — چون عدد لیکوییدیشن غلط، تمام ترمینال را بی‌اعتبار می‌کند، در حالی که نبودِ دفتر سفارش فقط یک پنل کمتر است.

---

## ۴. آنچه «کم داریم» — فهرست دقیق

### ۴٫۱ یک لایه‌ی کامل غایب: **موتور داده‌ی بازار (Market Data Engine)**

طرح در بخش ۱۲ درست می‌گوید: `Market Data Engine ← Prices · Funding · OI`. این لایه امروز **وجود ندارد**. آنچه هست: خواندن لحظه‌ای هر ونو در لحظه‌ی رندر. چیزی که نیست:

1. **انبار سری زمانی.** هیچ‌جا OI/funding/trades را ذخیره نمی‌کنیم. `server/cache.js` فقط TTL دارد، `blobCache.js` برای پاسخ AI است، و `store.js` (KV) برای leaderboard. برای OI Chart، Funding History، OI Change، Basis History **باید از امروز جمع‌آوری شروع شود**.
2. **جمع‌کننده‌ی دوره‌ای.** Vercel Hobby: کرون فقط روزی یک‌بار [12](https://vercel.com/docs/cron-jobs) — و repo خودش این را در `docs/VERCEL-CRON-HOBBY-FA.md` ثبت کرده. راه‌حل موجود همان الگوست: **GitHub Actions هر ۵ دقیقه** که همین حالا برای `/api/cron/watch` استفاده می‌شود (`.github/workflows/order-watch-tick.yml`). پس جمع‌آوری ۵ دقیقه‌ای شدنی است؛ ۱ دقیقه‌ای نه (بدون سرویس دائمی مثل `Dockerfile.mission-worker`).
3. **یکدست‌سازی.** امروز هر صفحه فیلدها را خودش تفسیر می‌کند (`normaliseMarket` در dydx، `normaliseStatsRow` در drift، subgraph در ostium). یک `MarketSnapshot` مشترک لازم است تا «آخرین قیمت» در سه جای UI سه عدد نباشد.

### ۴٫۲ فیلدهای جاافتاده که فقط باید مپ شوند (کم‌هزینه، اثر زیاد)
- `nextFundingAt`, `initialMarginFraction`, `maintenanceMarginFraction`, `trades24H` در `src/lib/dydx.js`
- ۲۴h High/Low از کندل‌ها (هر دو ونو)
- `bidDepth/askDepth` برای عمق واقعی (الان فقط ±۱٪)

### ۴٫۳ مسیرهای BFF غایب
`/api/dydx/trades/:ticker`, `/api/dydx/historical-funding/:ticker`, `/api/dydx/historical-pnl/:address`, `/api/futures/orderbook/:provider/:market` (عمق n-سطحی), `/api/futures/trades/:provider/:market`.

### ۴٫۴ منطق غایب
- **فرمول لیکوییدیشن per-venue** (امروز: `full-collateral-upper-bound` برای هر ونویی که مدلش را نمی‌شناسیم)
- مارجین/equity در سطح حساب، Margin Ratio، Maintenance Margin
- Close All، تغییر TP/SL از ردیف پوزیشن، ROE، funding paid
- هشدارهای پرپ (لیکوییدیشن/فاندینگ/نوسان) — منطق + مسیر کرون
- **قرارداد capability کامل‌تر**: هر ونو بگوید کدام order type را می‌پذیرد تا UI دکمه‌ی مرده نسازد (بخشی هست: ۱۵ فلگ)

### ۴٫۵ واقعیت‌های سختِ زیرساختی
- **هیچ WebSocket در کلاینت وجود ندارد** (grep روی `src`: صفر `new WebSocket`). v2 «لحظه‌ای» یعنی یا اتصال مستقیم مرورگر به WS ونوها (dYdX `wss://indexer.dydx.trade/v4/ws` [13](https://docs.dydx.xyz/interaction/endpoints)، HL، Velocity) یا SSE از یک هاست دائمی. روی Vercel serverless (maxDuration 60s) **WS ماندگار ممکن نیست**. این تصمیم معماری، پیش‌نیاز "حرفه‌ای بودن" است.
- **بودجه‌ی first paint:** ۳۱ KB. هر چیز ترمینال باید lazy باشد؛ `lightweight-charts` الان ۱۹۷ KB در چانک جدا و lazy است ✅.
- **i18n:** ۱۲ locale، ۱۴٫۷۲۴ کلید. هر ترمینال تازه ۲۰۰–۴۰۰ کلید × ۱۲ فایل. (همین حالا ۲۵ کلید در `fa.json` نسبت به `en` غایب است.)
- **۱۲ زبان × ۱۸۰۶ خط صفحه** = هر تغییر متن، ۱۲ فایل را لمس می‌کند. برای v2 پیشنهاد: کلیدها فقط `en`+`fa` نوشته شوند و بقیه با fallback انگلیسی (که i18next انجام می‌دهد).
- **فیلتر کلمات فروشگاه:** `SPECULATION_ENABLED` به‌دلیل رد شدن در APKPure، کل تب‌های اهرمی را در بیلد استور **حذف** می‌کند. ترمینال v2 باید همان‌جا بماند: وب فقط. این یک قید محصولی موجود است، نه مانع تازه.

---

## ۵. سه پیشنهاد تمایز (بخش «نظر نهایی» شما) — ارزیابی صادقانه

| قابلیت | ارزش | هزینه | ریسک | حکم |
|---|---|---|---|---|
| **AI Copilot** (کنار چارت) | بالا و فوری: FBT همین حالا ۱۰ پرووایدر AI و پیلود بازار دارد؛ رقیب این را «تحلیل امضاشده» ندارد | ★★☆☆☆ (~۱ هفته) | توهم عددی → با قاعده‌ی «هر عدد باید در پیلود باشد» حل می‌شود | ✅ **اول این** |
| **Smart Risk Guardian** | بالاترین ROI: جلوی زیان کاربر را می‌گیرد، به داده‌ی پولی نیاز ندارد، و موتور ریسکش از قبل ۶۰٪ نوشته شده | ★★★☆☆ (~۲ هفته، مشروط به فرمول لیکوییدیشن هر ونو) | برچسب غلط «تضمین» → باید «تخمین با مدل X» بنویسد | ✅ **دوم** |
| **Autonomous Trading** | هیجان‌انگیز، ولی در این repo سه بار عمداً محدود شده (کلید فقط در حافظه، caps fail-closed، هر سفارش امضای کیف پول) | ★★★★★ (~۴–۶ هفته + حقوقی) | بالا: مسئولیت، فیلتر فروشگاه، و اینکه کاربر پول را به یک حلقه بسپارد | ⏳ **آخر و با «تأیید انسان» — نه خودمختار کامل** |

نکته‌ی مهم: «Autonomous» بدون سرور دائمی و بدون کلید تفویضیِ ماندگار، **از نظر فنی خودمختار نیست**. `botLoop.js` الان سه حالت PAPER/ARMED/LIVE دارد و LIVE هم امضا می‌خواهد. این را باید در بازاریابی صادقانه گفت: «نیمه‌خودکار با تأیید».

---

## ۶. برآورد حجم کار (تیم ۲ نفره، بدون احتساب تأخیر حقوقی)

| مرحله | محتوا | نفر-هفته | پیش‌نیاز |
|---|---|---|---|
| ۰ | مسیر تازه `/perp/terminal` + پوسته‌ی سه‌ستونی responsive + بازنویسی آگاهانه‌ی ۲ تست | ۲ | تصمیم «مسیر جدا» |
| ۱ | `MarketSnapshot` مشترک + فیلدهای جاافتاده + ۲۴h H/L + Next funding | ۱ | — |
| ۲ | **موتور لیکوییدیشن/مارجین per-venue** + پنل ریسک حساب | ۲ | فرمول هر ونو |
| ۳ | چارت: ۷ بازه، Heikin، VWAP، VP، drawing، خط لیکوییدیشن | ۲ | — |
| ۴ | Order Book + Trades + Depth (BFF + UI) | ۱٫۵ | مسیرهای BFF |
| ۵ | پنل پوزیشن کامل (ROE/funding/margin/close-all) | ۲ | مرحله ۲ |
| ۶ | جمع‌آورنده‌ی تاریخی + OI/Funding charts + Basis | ۲ | کرون GH Actions |
| ۷ | پنل سفارش کامل (limit/stop/post-only/TIF + capability-gating) | ۲٫۵ | capability flagها |
| ۸ | AI Copilot (پیلود + اسکیمای خروجی + UI) | ۱ | مرحله ۱ |
| ۹ | آلرت‌های پرپ (لیکوییدیشن/فاندینگ) | ۱ | مرحله ۲ + تصمیم حریم خصوصی |
| ۱۰ | i18n (en+fa، بقیه fallback) + تست + بیلد gate + مستندسازی | ۱٫۵ | — |
| **جمع MVP (۰،۱،۲،۳،۵،۸،۱۰)** | **ترمینال قابل استفاده با ریسک درست و AI** | **~۱۲ نفر-هفته ≈ ۵–۶ هفته تقویمی برای ۲ نفر** | |
| **جمع کامل طرح** | + دفتر سفارش، تاریخچه، bots، heatmap | **~۲۰–۲۴ نفر-هفته ≈ ۱۰–۱۲ هفته** | |

این برآورد **شامل** خرید/یکپارچه‌سازی دادهٔ پولی (Heatmap/Whale) و مذاکره‌ی لایسنس چارت نیست.

---

## ۷. هفت تصمیمی که فقط مالک می‌تواند بگیرد

1. **ونوی اصلی کیست؟** این repo سه مسیر دارد (Velocity/Ostium/dYdX) و Hyperliquid نوشته‌شده ولی خاموش. ترمینالی که برای «همه» ساخته شود، برای هیچ‌کدام خوب نیست. پیشنهاد من: **dYdX** (عمیق‌ترین دفتر سفارش، کامل‌ترین order type، لیکوییدیشن مستند) به‌عنوان ونوی مرجع v2، بقیه در سطح «فقط‌خواندنی/بستن».
2. **سیاست جغرافیایی.** dYdX و Hyperliquid هر دو ایران را در Terms منع کرده‌اند [4](https://learnhyper.com/access/countries/)[5](https://www.datawallet.com/crypto/dydx-restricted-countries). ویژگی‌های ترمینال (اهرم، فاندینگ، لیکوییدیشن) همان چیزهایی است که فیلترها دنبالش هستند. تا این تصمیم روشن نشود، ساخت ترمینال ممکن است سرمایه‌سوزی باشد.
3. **Hyperliquid باز شود یا نه؟** کل کدش هست، ولی با `maxLeverage: 2` و `allowedCoins: ['BTC','ETH']` و `execution: NOT_BUILT`. باز کردنش = یک ونوی تازه با builder fee، تقریباً یک هفته کار + تصمیم حقوقی.
4. **بودجه‌ی داده.** Heatmap/Whale بدون پول ممکن نیست: Coinglass از ۳۷۹$/ماه برای استفاده تجاری و ۸۷۹$/ماه برای heatmap [1](https://cryptomarkets.tools/tools/coinglass). سه گزینه: بخریم / حذف / «مدل تخمینی» با برچسب.
5. **چارت: lightweight-charts یا TradingView Advanced Charts؟** دومی حرفه‌ای‌تر است ولی نیاز به درخواست و شرایط «محیط عمومی، بدون پی‌وال» دارد [6](https://www.tradingview.com/free-charting-libraries/). پیشنهاد: **اول lightweight-charts + drawing package** (بدون تعهد و بدون بحث لایسنس)، و Advanced Charts را به‌عنوان ارتقای بعدی در نظر بگیریم.
6. **حریم خصوصی هشدارها.** هشدار «نزدیک لیکوییدیشن» فقط با نگه‌داشتن آدرس کیف پول سمت سرور ممکن است. آیا می‌پذیریم؟ (جایگزین: هشدار فقط وقتی صفحه باز است — که برای لیکوییدیشن بی‌فایده است.)
7. **ترمینال مسیر جدا باشد یا حالت تازه‌ی `/perp`؟** پیشنهاد: مسیر جدا + لینک از `/perp`. دلیلش در بخش ۰ آمده (تست‌های پین‌کننده).

---

## ۸. سه قدمی که **بدون هیچ تصمیمی** می‌شود همین امروز شروع کرد

اگر بخواهیم منتظر تصمیم‌های بخش ۷ نمانیم، این سه کار مستقل و کم‌ریسک‌اند و بعداً به هر تصمیمی وصل می‌شوند:

1. **شروع جمع‌آوری سری زمانی از امروز.** یک کرون ۵ دقیقه‌ای که `markets + funding + OI` هر ونو را ببرد و در Blob/KV ذخیره کند. هر روز تأخیر = یک روز داده‌ی از دست رفته؛ این تنها کاری است که «تأخیرش جبران‌شدنی نیست».
2. **پر کردن فیلدهای جاافتاده‌ی dYdX** (`nextFundingAt`, IMR/MMR، ۲۴h H/L) + پروکسی `/v4/trades` و `/v4/historicalFunding`. چهار عدد و دو مسیر؛ بلافاصله نوار بالای طرح و هزینه‌ی فاندینگ واقعی را می‌دهد.
3. **موتور لیکوییدیشن واقعی per-venue** در `futures-engine/risk.js` با تست. این تنها ستونی است که اگر غلط باشد، تمام ترمینال بی‌اعتبار است.

هیچ‌کدام از این سه به لایسنس چارت، بودجه داده، یا تصمیم جغرافیایی وابسته نیست.

---

## ۸.۵ وضعیت اجرا: چه چیزی از این گزارش ساخته شد (۲۰۲۶‑۱۱‑۰۸)

این بخش بعد از گزارش اضافه شد، چون هر سه قدمِ بخش ۸ و دو ستونِ بخش ۳ حالا **در کد هستند و تست دارند**. هدفش این است که هیچ‌کس گزارش را با وضعیت فعلی اشتباه نگیرد.

| بخش طرح | وضعیت | کجا |
|---|---|---|
| موتور لیکوییدیشن واقعی per-venue | ✅ ساخته شد | `futures-engine/risk.js` — مدل `maintenance-margin` با MMR خودِ ونو، مدل مستند Ostium، و کران بالا فقط وقتی MMR منتشر نشده. هر نتیجه `model` خودش را حمل می‌کند |
| ۴ فیلد جاافتاده‌ی dYdX | ✅ ساخته شد | `src/lib/dydx.js` — `nextFundingAt`، IMR/MMR، `trades24H`، `maxLeverage` مشتق‌شده |
| ۲۴ ساعته High/Low | ✅ ساخته شد (روش دیگر) | از ۲۴ کندل ساعتی خودِ ونو، سمت سرور با کش ۶۰ ثانیه — نه از درصد روی قیمت |
| تیپ و دفتر سفارش | ✅ ساخته شد | `/api/dydx/trades/:ticker` (کش ۲ ثانیه)، لدر کامل در `getDydxOrderbook` |
| هیتوری فاندینگ | ✅ ساخته شد | `/api/dydx/funding-history/:ticker` (کش ۵ دقیقه) |
| ترمینال سه‌ستونی | ✅ ساخته شد — **مسیر جدا** | `/perp/terminal` (فلگ `VITE_ENABLE_PERP_TERMINAL`)، `/perp` دست‌نخورده ماند |
| یکسان‌سازی واژگان ریسک | ✅ ساخته شد | `futures-engine/riskBridge.js` — نگاشت کامل دو‌طرفه + آستانه‌های مشترک |
| اتصال به موتور فرصت‌ها | ✅ ساخته شد | `scanPersonalised({ futures })` سقف ریسک‌پذیری را **پایین** می‌آورد، هرگز بالا |
| رأی پیش از سفارش (سمت سرور) | ✅ ساخته شد | `server/central/futuresBridge.js` — `futuresPreTrade` Exposure فعلی حساب را می‌شمارد |
| حجم‌پروفایل / Heikin Ashi / VWAP / ۱W | ✅ منطق ساخته شد | `proChartMath.js` (آگره‌یت از ۱D، با برچسب) — هنوز روی چارت وصل نشده |
| Heatmap لیکوییدیشن | ❌ ساخته **نشد** | طبق بخش ۹ بدون دادهٔ Coinglass دروغ است |
| وب‌سوکت / استریم | ❌ ساخته **نشد** | با `maxDuration: 60` روی Vercel Hobby ممکن نیست |
| هاست پایدار برای ربات | ❌ ساخته **نشد** | تصمیم بخش ۷ |

**اعداد اندازه‌گیری‌شده после کار:** بیلد ۳۶۳۰ ماژول / حدود ۵۵ ثانیه · first-paint ۱۸۰۰٫۶ KB از بودجهٔ ۱۸۲۵ KB (یعنی **۲۴٫۴ KB جا** — قبل از این کار ۱۷۹۴٫۱ KB بود، پس این کار ۶٫۵ KB اضافه کرد) · تست‌های جدید: ۳۴ + ۱۵ + ۱۲ + ۴ + ۴ = ۶۹ بررسی، همه سبز.

**سه اشکالی که تست‌ها گرفتند و درست شدند** (ارزش گفتن دارد، چون هر سه از آن دسته‌ای بودند که در بازبینی چشمی دیده نمی‌شوند): خواندن `openPerpetualPositions` به‌صورت آرایه روی پاسخی که آبجکت است، حسابِ دارای پوزیشن را «تخت» نشان می‌داد؛ چارت پیش از رسیدن اولین پاسخ ونو به ونوی fallback وصل می‌شد؛ و یک notional بدون قیمت به‌عنوان حجم قابل‌معامله نمایش داده می‌شد.

---

## ۹. چه چیزی «نه» می‌گویم (به‌عنوان مهندس، نه بازاریاب)

- **«Liquidation Heatmap» بدون خرید داده، ساختنی نیست.** اگر بسازیم و اسمش را heatmap بگذاریم، دروغ است.
- **«Cross/Isolated» به‌صورت global ساخته نمی‌شود.** در dYdX یعنی subaccount جدا؛ در Velocity معنی ندارد. UI باید per-venue باشد، وگرنه کاربر چیزی را انتخاب می‌کند که اجرا نمی‌شود.
- **«تایم‌فریم 1W»** برای dYdX وجود ندارد؛ باید از ۱D آگره‌یت شود و برچسب «ساخته‌شده از کندل روزانه» بگیرد.
- **«اهرم تا سقف مجاز بازار»** برای dYdX یک اسلایدر نیست: اهرم = notional ÷ equity، و سقف = 1/IMR. می‌شود این را «نمایش» داد، ولی نمی‌شود به ونو «دستور اهرم» فرستاد.
- **«۹ موتور AI»** در عمل ۵ ماژول با یک مدل است. بهتر است ۲ ماژول واقعاً خوب باشد تا ۹ چک‌باکس.
- **«Autonomous»** بدون هاست دائمی + کلید تفویضی ماندگار، فقط «نیمه‌خودکار با تأیید» است.

---

## ۱۰. جمع‌بندی در یک پاراگراف

طرح شما از نظر محصول درست است و از نظر معماری هم تقریباً همان چیزی است که این repo از قبل دارد: کاتالوگ ونو با capability flag، موتور خالص ریسک/کارمزد، BFF که هرگز امضا نمی‌کند، و صفحه‌ای که عمداً «لیست» است. بنابراین v2 یک بازنویسی نیست؛ یک **پرکردن** است: یک لایه‌ی داده‌ی تاریخی که غایب است، فرمول لیکوییدیشن واقعی هر ونو، چارت کامل‌تر روی همان کتابخانه، و یک مسیر دسکتاپ تازه. با ۲ نفر، یک ترمینال قابل استفاده با ریسک درست و AI حدود **۵ تا ۶ هفته** کار است. آنچه می‌تواند کل پروژه را متوقف کند کد نیست: **دسترسی ایران در Terms هر دو ونوی اصلی**، **لایسنس چارت**، و **داده‌ی پولی heatmap**. تا این سه روشن نشود، سه قدم بخش ۸ را می‌شود بی‌خطر شروع کرد.

---

## ۱۱. منابع

1. Coinglass API — پلن‌ها و گیت‌های endpoint: https://cryptomarkets.tools/tools/coinglass
2. dYdX — subaccountها، cross-margin و isolated (≥۱۲۸، حداقل ۲۰ USDC): https://docs.dydx.xyz/interaction/integration/integration-onboarding
3. dYdX — «Margin mode: cross only، leverage از margin fraction، netting»: https://nautilustrader.io/docs/nightly/integrations/dydx/
4. Hyperliquid — کشورهای محدودشده (شامل ایران، OFAC): https://learnhyper.com/access/countries/
5. dYdX — کشورهای محدودشده (شامل ایران): https://www.datawallet.com/crypto/dydx-restricted-countries
6. TradingView — Advanced Charts: رایگان با شرط انتساب و «محیط عمومی، بدون پی‌وال»: https://www.tradingview.com/free-charting-libraries/
7. TradingView — شرایط استفاده در مستندات Charting Library: https://www.tradingview.com/charting-library-docs/latest/introduction/
8. dYdX — فیلدهای بازار (`nextFundingAt`, `initialMarginFraction`, `maintenanceMarginFraction`, `trades24H`): https://dydxprotocol.github.io/v3-teacher/
9. dYdX — مسیرهای indexer (`/v4/historicalFunding/`, trades): https://pkg.go.dev/github.com/k4k3ru-hub/dydx/go/rest/endpoint
10. `lightweight-charts-drawing` — MIT، ۸۶ ابزار، peer `lightweight-charts ^5`: https://registry.npmjs.org/lightweight-charts-drawing
11. dYdX — data در دسترس: orderbook، `openInterest`، `volume24H`، `nextFundingRate`: https://docs.dydx.xyz/interaction/integration/integration-markets
12. Vercel — محدودیت کرون Hobby (روزی یک‌بار): ثبت‌شده در `docs/VERCEL-CRON-HOBBY-FA.md` همین repo
13. dYdX — endpointهای indexer و WebSocket: https://docs.dydx.xyz/interaction/endpoints
14. Hyperliquid — endpointهای `info` (l2Book، candleSnapshot، metaAndAssetCtxs، historicalOrders، userFills): https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
15. Hyperliquid — بازه‌های کندل مجاز: `1m…1M` شامل `1w` (همان منبع ۱۴)
