# چرا تغییرات لایو نمی‌شد + رفع خطاهای صفحهٔ وام، WalletConnect و سولانا (2026-09-22)

> تاریخ: ۲۰۲۶-۰۹-۲۲ · شاخه: `arena/01a0c9da-fbtcryp`
> هر حکم این سند **اندازه‌گیری‌شده** است — یا از خودِ سایت زنده (`fbtswap.ir`)، یا از سورس رسمی پروتکل، یا از تست‌هایی که مجدداً اجرا شدند.

---

## ۰. خلاصهٔ یک‌خطی

کد دیروز لایو **است** (سایت نسخهٔ v19 را سرو می‌کند)، اما صفحهٔ وام هنوز قرمز است چون «اصلاحِ دیروز» خودِ اوراکل **برای بار دوم اسم تابع را اشتباه گرفت**؛ «unverified domain» یک مسئلهٔ بودجهٔ ۵ ثانیه‌ای+شبکه است نه داشبورد؛ و `assetlinks.json` هرگز در هیچ محیط بیلدی ساخته نشده — هر سه الان رفع شده‌اند.

---

## ۱. «تغییرات لایو نمی‌شوند» — واقعیت مسیر دیپلوی

**اندازه‌گیری زنده، ۲۰۲۶-۰۹-۲۲ (ساعت ~۱۶:۱۷ UTC):**

```
GET https://fbtswap.ir/sw.js        →  SHELL = 'fbt-shell-v19'   ✅ آخرین نسخهٔ main لایو است
GET https://fbtswap.ir/             →  200 (سایت زنده)
GET https://fbtswap.ir/api/lending/status → 200, state NORMAL
```

**رفتار واقعی** (نه سیاست فرضی — از روی کد و مشاهده):

۱. **وب‌سایت فقط روی مرج به `main` دیپلوی می‌شود.** در `vercel.json`: `git.deploymentEnabled = { "arena/*": false }` — یعنی هر شاخهٔ Arena **preview نمی‌گیرد**. هر تغییری در جلسات Arena روی شاخهٔ آن جلسه می‌ماند تا وقتی PRش در main مرج شود.
۲. **مرج آخر (PR #393) در ۱۵:۲۶Z انجام شد و Vercel آن را دیپلوی کرد** — v19 که همان دیپلوی است زنده است.
۳. اسنپ‌شات تشخیصیِ شما (`"at": "2026-09-22T10:08:11Z"`) **پنج ساعت قبل از آن مرج** گرفته شده. یعنی «تغییرات لایو نشده» یعنی «اسنپ‌شات کسی به دیپلوی نرسیده بود» — نه اینکه دیپلوی شکسته بوده.
۴. برای APK: ورک‌فلوی «Build APK» روی **هر push (هر شاخهٔ arena)** اجرا می‌شود و ریلیز `latest` گیت‌هاب را به‌روز می‌کند. این با وب متفاوت است.
۵. کشِ service worker کاربر می‌تواند شِل قدیمی را نگه دارد — برای همین هر اصلاحی که داخل باندل است با **تغییر نام کش** (این PR: `v19 → v20`) به همهٔ دستگاه‌ها می‌رسد.

**چه چیزی الان برای این اضافه شد:**

- `window.__FBT_BUILD__` (تنظیم در `main.jsx` از define سایت) — شامل `version`, `commitShort`, `ref`, `builtAt`. Vercel متغیر `VERCEL_GIT_COMMIT_*` را تزریق می‌کند؛ در غیابش `git rev-parse HEAD`؛ در غیاب هر دو، خالی — هرگز مقدار ساختگی نه.
- صفحهٔ Settings زیر نسخه، هش کوتاه کامیت + تاریخ بیلد را نشان می‌دهد: بدون برچسب فارسی جدید، چون هش و تاریخ زبان ندارند.
- `GET /api/version` — همان پاسپورت سمت سرور (نسخه، کامیت، ref، زمان شروع پروسه).

این‌ها باعث می‌شود پاسخِ «آیا تغییرم رسید؟» **یک نگاه** باشد نه حدس: هشِ Settings (یا `/api/version`) باید برابر HEADِ `main` باشد.

---

## ۲. صفحهٔ وام — «قیمت‌های اوراکل خوانده نشد»: دیباگِ دو سیلی‌کتور

**اندازه‌گیری زنده قبل از این اصلاح:**

```
GET /api/lending/markets?network=42161 → oracleStatus: "unavailable", oracleCode: "RPC_ERROR", oraclePrice: null (همهٔ مارکت‌ها), circuit: "DEGRADED"
GET /api/lending/markets?network=8453  → همان
```

یعنی اصلاحِ دیروز (که در PR #393 مرج شد) مشکل را حل نکرد.

**ریشه — دو اتفاق در یک روز:**

۱. نسخهٔ اول (صبح): اوراکل را مستقیم از روی Pool با `getPriceOracle()` می‌خواند — تابعی که روی Pool نیست → همهٔ RPCهای واقعی revert کردند.
۲. «اصلاحِ» ظهر (v19): سیلی‌کتور شد `pool.getAddressesProvider()` — **این تابع هم روی Pool نیست.** گتر واقعی Pool در Aave V3 حروف بزرگ است: `ADDRESSES_PROVIDER()` — سورس ریلیز پروتکل: `aave-v3-origin/src/contracts/interfaces/IPool.sol` خط ۵۷۶:

```solidity
function ADDRESSES_PROVIDER() external view returns (IPoolAddressesProvider);
```

سلکتورهای واقعی (محاسبه‌شده):
- `ADDRESSES_PROVIDER()` = `0x0542975c` ✅
- `getAddressesProvider()` = `0xfe65acfe` ❌ (روی Pool ریلیز Aave V3 وجود ندارد → revert → RPC_ERROR)
- `getPriceOracle()` = `0xfca513a8` ✅ (روی **PoolAddressesProvider** است، نه Pool)

چرا تست‌ها سبز بودند؟ چون مок (`test/helpers/aaveMockProvider.mjs`) به **هر سلکتور تایپ‌شده‌ای** جواب می‌داد — دقیقاً همان رفتاری که یک زنجیر واقعی ندارد. دو outage پشت‌سرهم از همین جا آمد.

**اصلاح (سرور و کلاینت، هر دو):**

- `server/lending.js` و `src/lib/lending.js`: ترتیب واقعی پروتکل — اول `ADDRESSES_PROVIDER()` (کانونیکال)، بعد `getAddressesProvider()` (فقط برای forkهای سبک V2)، و در آخر رجیستری استاتیکِ **تأییدشده داخل ریپو** (Base و Arbitrum — همان آدرس‌هایی که آداپتورهای Farm (src/lib/defi/aaveV3*.js) در هر اجرای fork-probe CI پینشان می‌کنند). `providerVia` نام می‌برد کدام مسیر جواب داده تا رگرشن بعدی اسم داشته باشد.
- مکالمهٔ سوم (`static-registry`) فقط آخرِ خط است: Pool همچنان مرج است.

**تست‌های رگرسیون:**

- `test/helpers/aaveMockProvider.mjs`: حالا **سلکتور-دقیق** است — Pool فقط گتر کانونیکال را جواب می‌دهد؛ حالت `legacyGetter: true` شبیه‌سازی fork می‌کند. مکی که هر اسمی را می‌پذیرفت دیگر رگرشن پنهان نمی‌کند.
- `test/lending-service.test.js`: توس «هر دو outage» — یک تست مسیر کانونیکال (جواب, و هیچ فراخوانی به اسم‌های غلط) + یک تست جدید مسیر fork (`providerVia === 'getAddressesProvider'`).
- `test/lending-bff-config-probe.test.js`: پین سیلی‌کتور خام `0x0542975c` روی هر دو ABI سرور/کلاینت.

نتیجهٔ اجرا: **۹۱/۹۱** تست lending-service + bff-probe سبز، ۳۰/۳۰ engine probe، farm ۶۲/۶۲، walletconnect ۴۰۵/۴۰۵.

---

## ۳. WalletConnect — «unverified domain»: چه چیزی واقعی است و چه چیزی در اختیار ما نیست

**چیزی که داشبورد و رجیستری درست است (اندازه‌گیری‌شده):**
- project id کد: `8e36eccabebf5a4567f4e974fafd6b20` — رجیستری: `fbtswap.ir`, `https://fbtswap.ir`, `https://localhost` — origin فعلی مجاز ✅
- `metadata.url` = `https://fbtswap.ir` — برابر origin صفحه ✅
- رله‌ها باز ✅ · پیش‌بینی حکم: `VALID` ✅

**چیزی که واقعاً fail می‌شود (از دمپ خود شما):**
`verify.attestation.error = NO_JWT_WITHIN_BUDGET` — iframe مخصوص `verify.walletconnect.org` در **بودجهٔ ۵ ثانیه‌ای SDK** هیچ JWT برنگردانده (دروازهٔ اول از سه دروازه: شبکه → رجیستری → metadata). وقتی JWT نیست، والت «Cannot verify» می‌گوید — حتا اگر دامنه‌تان کاملاً ثبت باشد.

**و چه چیزی در این PR عوض شد:**

۱. **پروب‌ها دیگر دروغ نمی‌گویند.** `probeVerifyReachability` قبلاً با fetch ساده + CORS میرفت — یعنی روی هر میزبانی که `Access-Control-Allow-Origin` نداشت، «Failed to fetch» می‌گرفت حتا اگر میزبان سالم بود. حالا `mode: 'no-cors'` است: رزولو معنایش «میزبان جواب داد»، ریجکت معنایش «شبکه واقعاً بسته است». ردیف «❌ دسترسی به Verify Enclave» که دیدید به‌احتمال زیاد همان false negative بود.
۲. **سنجش واقعی enclave:** `probeVerifyEnclaveFrame` خودِ enclave را در iframe مخفی (همان مکانیزم SDK) لود می‌کند تا حد LOADED/TIMEOUT؛ و `measureVerifyEnclave` یکبار در صفحه (و از بوت `main.jsx`) آن را ذخیره می‌کند.
۳. **بودجهٔ توسعه‌یافتهٔ attestation با گیتِ شواهد:** `installVerifyBudgetExtension` (نصب در `session.js` بعد از init، از همان core موجود) — وقتی پاسخ SDK خالی برگشت:
   - اگر سنجش گفت enclave LOADED است (شبکه کند ولی کار می‌کند) → همان handshake با همان id ولی بودجهٔ ۸ ثانیه‌ای دوباره; JWT همان چیزی است که SDK تنها صبرش را نداشت (payload به origin وصل می‌شود، نه به مشاهده‌گر).
   - اگر سنجش گفت بسته است (شبکهٔ فیلترشده) → **هیچ ثانیه‌ای اضافه صرف نمی‌شود**؛ رفتار دقیقاً مثل SDK می‌ماند.
۴. Enclave در **boot** هم warm می‌شود (نه فقط لحظهٔ connect).

**صداقت فنی:** اگر `verify.walletconnect.org` در سطح شبکهٔ کاربر فیلتر باشد، هیچ کدی در سمت dApp نمی‌تواند JWT امضاشدهٔ enclave بسازد (امضا فقط دست TEE سرور WalletConnect است). در آن حالت «Cannot verify» **مانع اتصال یا امضا نیست** — یک نشان اعتماد است. این PR آن را با مسیرهای واقعی (کند ≠ بسته) سر و سامان می‌دهد و هر چه باقی می‌ماند را صادقانه گزارش می‌کند.

تست‌ها: ورودی‌های جدید در `test/walletconnect-stack-probe.mjs` (۴۰۵/۴۰۵ سبز) — هر دو سمت گیت پوشش داده شده‌اند: شبکهٔ بسته = بدون تکرار؛ شبکهٔ کند = تکرار موفق.

---

## ۴. سولانا + Phantom — `assetlinks.json` 404

**اندازه‌گیری زنده:**

```
GET https://fbtswap.ir/.well-known/assetlinks.json → 404 NOT_FOUND
```

**ریشه:** فایل فقط با `FBT_ANDROID_SHA256` در محیط بیلد تولید می‌شود؛ این متغیر در **هیچ محیطی نیست** — ورک‌فلوی APK کِی‌استور را دارد (`ANDROID_KEYSTORE_BASE64`) و Vercel هیچ‌کدام را ندارد. برای همین فایل هرگز و هیچ‌جا نوشته نشده.

**اصلاح — خود-شفابخشی در CI:** اسکریپت آماده‌به‌استفادهٔ `ci/assetlinks-publish.sh` در همین ریپوست. چون خطای GitHub «GitHub App without `workflows` permission» اجازهٔ پوشِ ویرایش `.github/workflows/*.yml` به اتومیشن نمی‌دهد، قدمِ ورک‌فلو آماده‌به-الصاق در `ci/assetlinks-publish-step.yml` است — **یک بار** از رابط وب گیت‌هاب (با توکن خودتان اجازهٔ workflows دارد) بالای خط `run: bash ci/build-both.sh` الصاق/ذخیره کنید. پس از آن اسکریپت در هر ران «Build APK»:

۱. کِی‌استوری که APK با آن امضا می‌شود را decode می‌کند،
۲. با `keytool` اثرانگشت SHA-256 را می‌خواند (درست همان ابزاری که راست می‌گوید)،
۳. فایل را با همان ژنراتور مستند (`scripts/assetlinks.mjs`) می‌نویسد — پکیج‌نیم از `capacitor.config.json` خوانده می‌شود نه تایپ — و با `--check` اعتبارش را هم ثابت می‌کند،
۴. و **فقط وقتی محتوا عوض شود**، روی همین شاخه commit+push می‌کند (با امضای `fbt-build[bot]`، بدون `[skip ci]` چون Vercel باید همان کامیت را دیپلوی کند؛ حلقه‌ای هم نمی‌شود چون ران بعدی تفاوتی نمی‌بیند).

دو تضمین بدون استثنا در اسکریپت نوشته شده:

- **هرگز** اثرانگشت debug یا حدسی منتشر نمی‌کند (بدون کِی‌استور: skip، نه نوشتن) — چون هاش غلط چیزی را verify نمی‌کند فقط شبیه انجام‌شده به نظر می‌رسد.
- هیچ‌وقت جاب را به‌خاطر خطای انتشار قرمز نمی‌کند (APK خودش ارتی‌فکت اصلی است) — اما خطاهای خود ژنراتور (validation) اجازه دارند fail شوند چون آن‌ها باگ‌اند.

**آنچه پس از الصاقِ قدم + مرج اتفاق می‌افتد:**

۱. اولین ران «Build APK» کامیت `ci: publish /.well-known/assetlinks.json ...` روی همان شاخه می‌سازد و ری‌رِید می‌کند (برای merge بعدی: `git pull` کنید).
۲. بعد مرج به main، Vercel فایل `public/.well-known/assetlinks.json` را سرو می‌کند (Vite کپی dot-dir را انجام می‌دهد — از روی سورس Vite چک شد).
۳. تأیید زنده:

```bash
node scripts/assetlinks.mjs --remote
curl -s https://fbtswap.ir/.well-known/assetlinks.json | jq -e 'type == "array"'
```

هشدار Phantom با fetch بعدی خودش رفع می‌شود (بدون نیاز به ثبت‌نام).

---

## ۵. فایل‌های عوض‌شده

| فایل | تغییر |
|---|---|
| `server/lending.js` | `ADDRESSES_PROVIDER` کانونیکال + fork fallback + رجیستری استاتیک تأییدشده; `providerVia`/`providerAddress` در payload |
| `src/lib/lending.js` | همین در کلاینت; `AAVE_ADDRESSES_PROVIDERS` از Farm-verified values |
| `src/lib/wc/verify.js` | `probeVerifyReachability` بدون CORS-دروغ; `+probeVerifyEnclaveFrame`, `measureVerifyEnclave`, `getVerifyEnclaveState`, `requestVerifyAttestation`, `installVerifyBudgetExtension`, `VERIFY_EXTENDED_BUDGET_MS` |
| `src/lib/wc/session.js` | نصب extension پس از init + سنجش enclave هنگام connect |
| `src/main.jsx` | warm+measure در بوت; انتشار `window.__FBT_BUILD__` |
| `vite.config.js` | define `__FBT_BUILD__` (Vercel/GitHub/git) |
| `server/app.js` | `GET /api/version` |
| `src/pages/Settings.jsx` | ردیف هش+تاریخ بیلد کنار نسخه |
| `public/sw.js` | bump شِل `v19 → v20` (دلیل کامل در کامنت فایل) |
| `ci/assetlinks-publish.sh` + `ci/assetlinks-publish-step.yml` | انتشار خودکار assetlinks.json از کِی‌استور، فقط روی تغییر — قدم ورک‌فلو آماده‌به-الصاق است (توکن اتومیشن workflows-اجازه ندارد) |
| `test/helpers/aaveMockProvider.mjs` | موک سلکتور-دقیق + حالت `legacyGetter` (ریشهٔ سبز-ماندنِ غلط تست‌ها) |
| `test/lending-service.test.js`, `test/lending-bff-config-probe.test.js`, `test/walletconnect-stack-probe.mjs` | رگرسیون‌های دو outage + پین سلکتور خام + ۱۹ چک جدید برای پروب‌های verify |

## ۶. چک‌لیست تأیید بعد از دیپلوی این PR

```bash
# ۱) همان تغییرِ روی main روی وب لایو شده؟
curl -s https://fbtswap.ir/api/version | jq '.commitShort'   # باید برابر HEADِ main باشد
# در مرورگر: DevTools → window.__FBT_BUILD__

# ۲) اوراکل وام
for chain in 42161 8453 1; do
  curl -s "https://fbtswap.ir/api/lending/markets?network=$chain" | jq '.meta.oracleStatus, .meta.providerVia // empty, .data.markets[0].oraclePrice'
done                                                              # باید "ok" یا "partial" + قیمت‌ها برگردد

# ۳) assetlinks
curl -s https://fbtswap.ir/.well-known/assetlinks.json | jq -e 'type == "array"'

# ۴) سرویس-ورکر
curl -s https://fbtswap.ir/sw.js | grep -o "fbt-shell-v[0-9]*"    # v20
```
