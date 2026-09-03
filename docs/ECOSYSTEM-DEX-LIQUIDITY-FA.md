# DEX، نقدینگی و پل‌ها — اتصال واقعی به FBT و کارمزد FBT

> تاریخ: ۲۰۲۶-۰۹-۰۳
> وضعیت قبل: صفحهٔ اکوسیستم این منابع را «متصل/کارمزددار» نمایش نمی‌داد و جملهٔ پایین صفحه می‌گفت «رابطهٔ ما با این پروژه‌ها: هیچ».
> وضعیت بعد: هر منبع دارای نشان «کارمزد → FBT» (وقتی واقعاً fee-ready باشد)، کارت جزئیات کارمزد، و یک endpoint بررسی زنده است که وضعیت را بر اساس شواهد، نه ادعا، به‌روز می‌کند.

---

## چرا این بخش مهم است

FBT Swap نقدینگی خودش را نگه نمی‌دارد؛ از چند DEX/Aggregator استفاده می‌کند.
در بخش «DEX و نقدینگی» این منبع‌ها واقعاً به اپ و سایت FBT **متصل** هستند و
در زمان اجرای سواپ، **کارمزد از داخل خود تراکنش به کیف FBT می‌رسد**.
بنابراین جملهٔ «با این پروژه‌ها درآمدی نداریم» در این بخش درست نیست.

## پنج منبع فعلی

| منبع | نوع | محل اجرا در FBT | کارمزد FBT | گیرنده | وضعیت |
|---|---|---|---|---|---|
| **KyberSwap** | DEX Aggregator (EVM) | `src/lib/aggregator.js` + `/api/swap/kyber/*` | ۷۰ bps (۰٫۷۰٪) | `0xaf5CE154…24d6` | feeReady ✅ |
| **OpenOcean** | DEX Aggregator (EVM) | `src/lib/openocean.js` + `/api/swap/oo/*` | ۷۰ bps، خالص ۵۶ bps (۲۰٪ سهم provider) | `0xaf5CE154…24d6` | feeReady ✅ |
| **OpenOcean (Solana)** | DEX Aggregator (Solana) | `server/solanaOcean.js` + `/api/solana/oo/*` | ۷۰ bps، خالص ۵۶ bps (۲۰٪ سهم De¹/OpenOcean) | `B6gysn5JGQ…BFLv4` | feeReady ✅ |
| **0x Gasless** | Gasless / Meta-Transaction | `server/gasless.js` + `/api/gasless/*` | ۷۰ bps | `0xaf5CE154…24d6` | نیاز به `ZEROX_API_KEY` |
| **Velora** | Price Source (quote-only) | `src/lib/velora.js` + `/api/swap/velora/prices` | ۷۰ bps هنگام اجرایی‌شدن | `0xaf5CE154…24d6` | quote-only، هنوز execute نمی‌کند |

## پل‌های اکوسیستم و کارمزد آن‌ها

| منبع | نوع | محل اجرا | کارمزد FBT | گیرنده | وضعیت |
|---|---|---|---|---|---|
| **LI.FI** | Bridge Aggregator | `server/lifi.js` + `/api/cross-chain/*`, `/api/bridge/*` | ۳۰ bps (۰٫۳٪) | `0xaf5CE154…24d6` | نیاز به `LIFI_FEE_READY=true` و integrator ثبت‌شده |
| **deBridge DLN** | Bridge Protocol | `server/dln.js` + `/api/dln/*` | ۴۰ bps (۰٫۴٪) | `0xaf5CE154…24d6` | feeReady ✅ (بدون کلید) |
| **0x Cross-Chain** | Cross-Chain Router | `server/xchain.js` + `/api/xchain/*` | ۳۰ bps (۰٫۳٪) | `0xaf5CE154…24d6` | نیاز به `ZEROX_API_KEY` |
| **THORChain** | Cross-Chain Protocol | `server/thorchain.js` | ۷۰ bps برای UTXO | `0xaf5CE154…24d6` | **غیرفعال**؛ نیاز به `THOR_NAME` |

نکات صادقانه:
- **THORChain** الان `configured:false` است چون `THOR_NAME` نداریم؛ بدون خرید
  THORName فقط با RUNE pair کار می‌کند و کارمزد UTXO به ما نمی‌رسد.
- **deBridge DLN** ۴۰ bps می‌دهد نه ۷۰، چون علاوه بر کارمزد درصدی یک هزینهٔ ثابت
  با سکهٔ بومی می‌گیرد؛ نرخ ۰٫۴٪ اندازه‌گیری‌شده و برای کاربر بهترین است.
- **0x Cross-Chain** از همان `ZEROX_API_KEY` استفاده می‌کند؛ بدون کلید inactive است.

## جملات صادقانه (چرا بعضی نشان «کارمزد» ندارند)

- **Velora** در حال حاضر فقط قیمت می‌دهد و سواپ را اجرا نمی‌کند. کد و پیکربندی
  کارمزد آماده است؛ هنگامی که به مسیر اجرایی ارتقا یابد، ۷۰ bps مستقیم به کیف FBT
  می‌رسد. در صفحه به‌صورت «غیرفعال تا فعال‌شدن» می‌ماند، نه دروغِ «الان درآمد داریم».
- **0x Gasless** بدون `ZEROX_API_KEY` در دسترس نیست. وقتی کلید تنظیم شود،
  `feeReady` و نشان کارمزد فعال می‌شود.
- **OpenOcean** (EVM و Solana) از هر ۷۰ bps، طبق مدل مستند خودشان ۲۰٪ برمی‌دارد؛
  بنابراین FBT خالص ۵۶ bps دریافت می‌کند. صفحه این را «net» نشان می‌دهد تا
  عدد اغراق‌آمیز نباشد.

---

## چه چیزی در کد تغییر کرد

۱. **متادیتای کارمزد** در `src/lib/ecosystemData.js`:
   هر provider در `PROVIDER_CATEGORIES` دارای `fee` است و `buildEcosystemData`
   آن را با `deriveFee(meta, provider)` به کارت/دراور می‌دهد.
   فیلد `active` فقط وقتی `configured && feeReady` است `true` می‌شود.

۲. **کارت و دراور اکوسیستم** (`src/pages/Ecosystem.jsx`,
   `src/components/ecosystem/ProtocolDrawer.jsx`):
   - کارت: نشان سبز «کارمزد → FBT · 0.7%» + «net 56 bps» در صورت سهم provider.
   - دراور: بخش «کارمزد FBT» با درصد، bps، سهم provider، گیرنده و وضعیت فعال/غیرفعال.

۳. **جملهٔ پایین صفحه**:
   در view مربوط به DEX/پل به‌جای «رابطه ما: هیچ» این را نشان می‌دهد:
   «این منابع به FBT متصل‌اند و کارمزد پلتفرم از داخل تراکنش پرداخت می‌شود؛
   FBT به این پروژه‌ها وابستگی/سهام/کنترل ندارد.»

۴. **دریافت شواهد سلامت، نه حدس**:
   - `server/app.js`: بعد از هر فراخوان واقعی `/api/swap/*`, `/api/solana/oo/*`,
     `/api/gasless/*` نتیجه در `server/providerStatus.js` ثبت می‌شود
     (`recordSuccess` / `recordFailure`).
   - `server/providerProbe.js`:
     `POST /api/providers/probe` با یک quote کوچک از هر منبع (بدون امضا/انتشار)
     وضعیت واقعی را می‌سنجد و در همان tracker ثبت می‌کند.
   - `src/lib/ecosystemData.js`:
     صفحهٔ اکوسیستم بعد از باز شدن، probe را اجرا و سپس `/api/providers/status` را
     دوباره می‌خواند؛ بنابراین پس از اولین بار، «متصل/نامشخص» بر اساس شواهد تعیین
     می‌شود نه صرفاً به این دلیل که سرور تازه بالا آمده است.

## endpointها

```
GET  /api/providers/status       ← وضعیت استاندارد (configured/reachable/feeReady/…)
POST /api/providers/probe        ← یک quote کوچک از هر منبع و ثبت شواهد سلامت
```

`probe` فقط quote می‌گیرد؛ هیچ تراکنش امضا/انتشار/ذخیره نمی‌کند.
آدرس‌های بالادستی ثابت هستند و مبلغ‌ها بسیار کوچک، پس نمی‌توان از آن به‌عنوان
open proxy یا ابزار حرکت پول استفاده کرد.

## 0x Gasless — کلید را کجا بگذارم

### از کجا کلید بگیرم

- صفحهٔ ثبتنام/ورود داشبورد 0x: **https://dashboard.0x.org/create-account**
- بعد از ورود، داشبورد: **https://dashboard.0x.org**
- مسیر داخل داشبورد: **create/select an App** → **API Keys** → **Generate/Add API key**
- مدارک رسمی: **https://0x.org/docs/api** («Visit dashboard.0x.org to get your API Key»)

> ⚠️ 0x روی پلن‌ها ساخته شده؛ موقع ثبت ممکن است ازت بخواهد یک App بسازی یا یک plan انتخاب کنی.
> آدرس ایمیل و کیف پول می‌خواهد؛ اگر ثبت‌نام از منطقهٔ تو محدود شد، همان پیام خطا را بگو تا راهش را بگویم.

این کلید **سمت سرور** خوانده می‌شود (`server/gasless.js`)، پس **هرگز `VITE_` نگذار**
و هرگز داخل APK یا کد مرورگر نگذار چون لو می‌رود.

### وب/سایت (`fbtswap.ir`)

```
Vercel Dashboard ← پروژهٔ fbtcryp-kkxi ← Settings ← Environment Variables
```

| Key | Value |
|---|---|
| `ZEROX_API_KEY` | خود کلید 0x (مثلاً `00000000-...`) |

- Environments: ✅ Production ✅ Preview ✅ Development
- بعد از Save: **Redeploy** کن (بدون کش build) چون سرور متغیرها را موقع بوت می‌خواند.

### تست محلی

در ریشهٔ repo فایل `.env` بساز (این فایل در `.gitignore` است و نباید کامیت شود):

```bash
ZEROX_API_KEY=کلیدت
```

سپس:

```bash
npm run dev:api
```

### اندروید/APK

لازم نیست در APK بگذاری. اپ داخلی به `https://fbtswap.ir/api` وصل می‌شود و
همان کلید سمت سرور را می‌خواند. کافی است کلید در Vercel باشد.

### بعد از گذاشتن — چک کن

```bash
curl -s https://fbtswap.ir/api/gasless/status
```

انتظار: `{"configured":true,"feeBps":70,...}`

اگر `configured:false` شد، یعنی کلید هنوز به سرور نرسیده — معمولاً Redeploy یادت رفته.
هیچ‌وقت کلید را در چت نفرست؛ فقط بگو «گذاشتم».

---

## تست دستی

```bash
curl -s https://fbtswap.ir/api/providers/status | jq '.providers[] | [.id, .configured, .reachable, .feeReady]'
```

بعد:

```bash
curl -s -X POST https://fbtswap.ir/api/providers/probe | jq
curl -s https://fbtswap.ir/api/providers/status | jq '.providers[] | [.id, .reachable, .feeReady]'
```

انتظار: KyberSwap، OpenOcean، Velora، و OpenOcean Solana بعد از probe
`reachable=true` (یا شکست واضح با `lastFailureAt`) دارند؛
`0x-gasless` فقط اگر `ZEROX_API_KEY` تنظیم باشد `feeReady=true`.
