# افزودن شبکه‌های سواپ — تحلیل، پیاده‌سازی و گیت راستی‌آزمایی

> سند فارسیِ تحلیل «کدام شبکه‌های مهم را نداریم» + شرحِ چیزی که در این تغییر
> اضافه شد و کاری که پیش از انتشار واقعی باید انجام شود.

---

> **به‌روزرسانی ۲۰۲۶-۰۹-۱۰:** پس از چهار شبکهٔ مرحلهٔ قبلی، **Scroll (SCR)** و
> **zkSync Era (ZK)** نیز در رجیستری فعال‌اند. هر دو native ETH، WETH و
> USDC/USDT/DAI پین‌شدهٔ آفلاین دارند، لیست بلندِ CoinGecko از `tokenLists.js`
> بار می‌شود، و گیرندهٔ کارمزدشان از `payout.js` به حساب EVM پروژه resolve می‌شود.
> مسیرهای KyberSwap/OpenOcean برای آن‌ها در کد موجود است؛ قبل از حجم واقعی همان
> گیت fee-echo بخش ۴ اجرا شود.

## ۱) وضعیتِ پیش از این تغییر

قبل از این تغییر اپ روی **۱۰ شبکهٔ قابل‌سواپ** کار می‌کرد:

| | شبکه‌ها | موتور مسیریابی |
|---|---|---|
| ۹ شبکهٔ EVM | BNB، Ethereum، Polygon، Arbitrum، Base، Optimism، Avalanche، Linea، Sonic | KyberSwap aggregator (پلتفورم فیس هم‌جا، روی‌زنجیره) |
| ۱ شبکهٔ غیر-EVM | Solana | Jupiter (صفحهٔ جدا) |

نکتهٔ مهم معماری (از کامنت خود کد): **یک شبکه فقط وقتی لیست می‌شود که واقعاً هم سواپ شود هم فیس ما را بدهد.** شبکه‌ای که aggregator برایش مسیر برنگرداند، فقط یک آیتم «no route» می‌سازد که از نبودنش بدتر است؛ به همین دلیل Scroll در گذشته «عمداً» اضافه نشده بود چون کوئری زنده ۴۰۴ گرفت.

---

## ۲) کدام شبکه‌های مهم را نداریم؟

فهرست رسمی KyberSwap (منبع یکسان همین اپ) این EVM شبکه‌ها را با aggregator پشتیبانی
می‌کند که ما نداشتیم:

- **Mantle** (chainId 5000) — L2 بزرگ و باسابقه، گس‌کوین MNT
- **Berachain** (chainId 80094) — یکی از بزرگ‌ترین شبکه‌ها از نظر TVL (حتی از Base/Arbitrum در برخی بازه‌ها جلوتر بود)
- **Unichain** (chainId 130) — L2 خودِ Uniswap روی OP Stack، گس‌کوین ETH
- **Monad** (chainId 143) — L1 جدید پرارزش/پرحجم، گس‌کوین MON
- و شبکه‌های دیگر: Ronin، zkSync، Scroll، Fantom، Blast، Rise و …

> انتخابِ این چهار شبکه بر اساس معیار **TVL/اهمیت جهانی** و این که روی فهرست رسمی
> supported-EVM شبکه‌های KyberSwap قرار دارند بود (همان گیت Linea/Sonic). «ارزان‌گس
> برای کاربر ایرانی» معیار دیگری است که می‌تواند شبکه‌های دیگری (مثلاً Tron/USDT) را
> جلو بیندازد؛ آن‌ها در گامِ بعدی جای دارند.

---

## ۳) چه چیزی اضافه شد

چهار شبکهٔ **Mantle · Berachain · Unichain · Monad** به لایه‌های پیکربندیِ هستهٔ سواپ
اضافه شدند (همان مسیری که Linea/Sonic قبلاً رفتند). الان تعداد شبکهٔ قابل‌سواپ
**۱۴** شده: ۱۳ EVM + سولانا.

| فایل | چه کاری |
|---|---|
| `src/lib/chains.js` | ورودی `EVM_CHAINS` (RPC، اکسپلورر، گس‌کوین، color) + `EVM_CHAIN_ORDER` + توکنِ native در `TOKENS` |
| `src/lib/aggregator.js` | اسلاگ KyberSwap در `NETWORK_SLUG` → سواپ و اخذ فیس روی‌زنجیره |
| `src/lib/wallet-engine/adapters.js` | همگام‌سازی `EVM_CHAIN_IDS` + `EXPLORERS.evm` |
| `src/lib/tokenLists.js` | منبع لیست توکن هر شبکه (CoinGecko) تا توکن‌های رایج و لانگ‌تیل همان شبکه در پیکر ظاهر شوند |
| `src/lib/payout.js` | ردیف نمایش «کارمزد کجا می‌رود» در `PAYOUT_DIRECTORY` |
| `scripts/verify-fees.mjs` | افزودن چهار شبکه به ابزار راستی‌آزمایی زندهٔ فیس |
| `index.html`, `README.md`, `src/i18n/locales/{en,fa}.json`, `src/pages/About.jsx`, `src/lib/geminiDirect.js` | به‌روزرسانی شمارش/فهرست شبکه‌ها در متن‌های اصلی |

### مسیر واقعیِ سواپ برای یک شبکهٔ جدید
کلیک روی تگ شبکه (از `EVM_CHAIN_ORDER`) → `wallet.switchChain` که شبکه را در کیف پول
کاربر اضافه می‌کند از متادیتای خود رجیستری → کوئوت از KyberSwap (`NETWORK_SLUG`) با
`feeReceiver` که از `payout.js` برای همان chainId (خانوادهٔ EVM) حل می‌شود → تأیید
`extraFee` که فیس را برمی‌گرداند → امضای کاربر.

---

## ۴) ⚠️ کاری که هنوز باید انجام شود (گیت پیش از انتشار)

سیاست پروژه این است که یک شبکه فقط پس از **کوئوت زندهٔ fee-echo** لیست شود. این
environment از sandbox به اینترنت عمومی RPC/KyberSwap دسترسی ندارد، پس آن تست این‌جا
**اجرا نشده** است. متادیتای زنجیره (chainId / RPC / اکسپلورر / گس‌کوین) از منابع رسمی
چک شده، اما آدرس‌های توکن و اسلاگ کوین‌گکو فقط باید با اجرای همان گیت تأیید نهایی شوند.

دقیقاً همان دستوری که برای Linea/Sonic استفاده می‌شد، حالا برای هر چهار شبکهٔ جدید:

```bash
node scripts/verify-fees.mjs            # همهٔ شبکه‌ها
node scripts/verify-fees.mjs --chain 5000    # فقط Mantle
node scripts/verify-fees.mjs --chain 80094   # Berachain
node scripts/verify-fees.mjs --chain 130     # Unichain
node scripts/verify-fees.mjs --chain 143     # Monad
```

برای هر شبکه باید «✓ aggregator confirms 70 bps to <address>» برگردد. اگر
`extraFee` نیامد یا گیرنده/مقدارش مال ما نبود، **آن شبکه را نباید منتشر کرد**.

نکته‌های راستی‌آزمایی دستی:
- آدرس توکن‌های خروجیِ `verify-fees.mjs` (WMON/WBERA/WETH/USDC) را روی اکسپلوررِ همان
  شبکه چک کنید (منبع هرکدام در کامنت همان فایل آمده).
- اسلاگ‌های CoinGecko در `tokenLists.js` اگر ۴۰۴ بدهند فقط یعنی لیست توکن آن شبکه در
  پیکر نمی‌آید (به‌نرمی نادیده گرفته می‌شود)؛ برای اطمینان هرکدام را در مرورگر باز کنید.

---

## ۵) فهرستِ پیگیری (آینده)

- متن بازاریابی/آنبوردینگ در **۱۲ زبان** (مثل `step2` و FAQ صفحهٔ About و اسناد `docs/`)
  هنوز «ده شبکه» و فهرست قدیمی را می‌گوید. این‌ها متنِ تولیدشده از قالب هستند و بهتر
  است با `scripts/ngen-landing.mjs` / `ngen-locales.mjs` دوباره تولید شوند، نه دستی.
- شبکه‌های دیگرِ ممکن: Scroll، Fantom، zkSync، Ronin، و … — با همین الگو به شرط قبول شدن
  در گیتِ زندهٔ fee-echo.
- شبکه‌های «فقط دریافت» (TON/Tron) هنوز سواپ نمی‌شوند؛ افزودن سواپِ آن‌ها مسیر دیگری
  (غیر-EVM) است و خارج از این تغییر است.

---

## ۶) اصلاحیهٔ ۲۰۲۶-۰۹-۱۱ — «مسیری بین این دو توکن وجود ندارد» روی شبکه‌های جدید

### علت ریشه‌ای (با شاهد زنده، نه حدس)

گیت‌وی KyberSwap برای اسلاگ‌های `scroll`، `zksync` و `mantle` **HTTP 404** برمی‌گرداند
(پروب زندهٔ `aggregator-api.kyberswap.com/{slug}/api/v1/routes` در ۲۰۲۶-۰۹-۱۱؛ در همان
دقیقه linea/sonic/berachain/unichain/monad کوئوت واقعی برگرداندند). صفحهٔ رسمی
supported-networks هم این سه شبکه را **بدون تیک aggregator** فهرست می‌کند. یعنی وجودِ
اسلاگ در `NETWORK_SLUG` دیگر به معنای «Kyber این زنجیره را روت می‌کند» نبود؛ پرسیدن از یک
endpoint مرده، Kyber را بازندهٔ قطعی هر مقایسه می‌کرد و چون OpenOcean با leash سه‌ثانیه‌ایِ
طراحی‌شده برای «نظر دوم» اجرا می‌شد، هر کندیِ OpenOcean تبدیل می‌شد به
«مسیری بین این دو توکن وجود ندارد».

### چه چیزی عوض شد

- `src/lib/aggregator.js` — مجموعهٔ `KYBER_LIVE` (پروب زنده) اضافه شد؛ `aggregatorSupports`
  حالا یعنی «اسلاگ دارد **و** گیت‌وی زنده است».
- `src/lib/swap.js` — منبعی که شبکه را سرو نمی‌کند اصلاً پرسیده نمی‌شود؛ روی زنجیره‌های
  بدون Kyber، منبع OpenOcean به‌صورت **PRIMARY** با `timeoutMs: 12000` اجرا می‌شود.
  همچنین گارد `if (!cfg?.router)` اضافه شد تا زنجیره‌های بدون روتر مستقیم، به‌جای سقوطِ
  `new Contract(undefined, …)`، پاسخِ classify‌شده و قابل تلاش دوباره برگردانند.
- `src/lib/openocean.js` — پارامتر `timeoutMs` برای همان ارتقا به منبع اصلی.
- `scripts/verify-fees.mjs` — مسیر راستی‌آزمایی OpenOcean برای 5000/534352/324:
  کوئوت (وجود مسیر) + ساخت calldata + خواندن `referrer` از `/decodeInputData`
  (همان اثباتی که `verifyOpenOceanFee` پیش از امضا می‌خواهد). اسلاگ مردهٔ `mantle`
  از نقشهٔ Kyber این ابزار حذف شد.
- آدرس‌های توکن پین‌شدهٔ Mantle/Berachain/Unichain/Monad در `src/lib/chains.js`
  (WMNT/USDT/USDC.e/WETH، WETH/USDC.e/HONEY/WBTC، USDC، WMON/USDC/WETH) هرکدام با یک
  منبع زنده (GeckoTerminal pools / نقشهٔ پلتفرم CoinGecko) تأیید شد تا انتخاب‌گر توکن
  حتی آفلاین یک جفت قابل سواپ داشته باشد.
- همگام‌سازی نقشه‌هایی که از `EVM_CHAIN_ORDER` جا مانده بودند و دقیقاً همان
  «توکن ندارد / سواپ نمی‌شود» را می‌ساختند:
  `wallet-engine/adapters.js` (EVM_CHAIN_IDS + EXPLORERS)، `coinToSwap.js` و
  `coinVenue.js` (CHAIN_PREFERENCE)، `tokenIcon.jsx` (TW_CHAIN + NATIVE_LOGO)،
  `farmDeFi.js` (CHAIN_ICON_KEYS) و `scripts/gen-asset-icons.mjs` (NETWORKS).
- `dexName` هر سه زنجیرهٔ بدون Kyber به `OpenOcean` تغییر کرد تا زیرنویس صفحهٔ سواپ
  («سواپ واقعی روی زنجیره با …») منبع واقعی را بگوید.

### گیت انتشار، نسخهٔ به‌روز

```bash
node scripts/verify-fees.mjs              # Kyber برای ۹ زنجیرهٔ زنده‌اش
node scripts/verify-fees.mjs --chain 534352   # Scroll: مسیر OpenOcean + اکوی referrer
node scripts/verify-fees.mjs --chain 324      # zkSync Era: همان مسیر
node scripts/verify-fees.mjs --chain 5000     # Mantle: همان مسیر
```

خروجی مورد انتظار روی زنجیره‌های OpenOcean: «✓ OpenOcean route exists via …» و
«✓ decoded calldata carries referrer 0xaf5C…24d6». اگر Kyber روزی اسلاگی را دوباره سرو
کند، کافی است chainId به `KYBER_LIVE` برگردد — مقایسهٔ دومنعی خودبه‌خود برمی‌گردد.
