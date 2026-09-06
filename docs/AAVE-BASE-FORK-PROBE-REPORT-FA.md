# گزارش مرحله — پروب fork آداپتر Aave v3 Base (USDC) و اصلاحات پیش از اجرا

تاریخ: ۲۰۲۶-۰۹-۰۶ — برنچ `arena/01a0770b-fbtcryp` (پایه: b223619 = merge پر #217)

## خلاصه

خواستهٔ اصلی این مرحله: **اجرای واقعی** `npm run test:aave-base-fork -- --strict` روی
fork ای از Base mainnet و چسباندن خروجی کامل pass/fail در گزارش.

نتیجهٔ صادقانه: **پروب در این سندباکس قابل اجرا نبود** — خروجی شبکه فقط به
github.com / api.github.com / registry.npmjs.org / pypi.org باز است و تمام RPC های
Base/Ethereum تست‌شده connection-reset می‌خورند؛ anvil نصب نیست و اسکریپت نصب
Foundry هم در همین لایه قطع می‌شود؛ و توکن agent اجازهٔ نوشتن زیر
`.github/workflows/` را ندارد (محدودیت مستند خود ریپو در `ci/README.md`).
خروجی هر سه تلاش در پایین آمده — «اجرا نشد چون محیط بسته است» بدون شواهد گزارش
نمی‌شود، ولی «اجرا شد و پاس شد» هم ادعا نمی‌شود.

اما در مسیر آماده‌سازی، بازبینی source-of-truth (سورس release های خود پروتکل،
که از GitHub API قابل دریافت بود) **دو نقص قطعی در آداپتر** را نشان داد که اگر
پروب همین‌حالا روی Base اجرا می‌شد، روی آن‌ها قرمز می‌شد — و هر دو اصلاح و با
تست پین شدند:

1. **جدول `RESERVE_DATA_SHAPES` یک layout موهوم «۱۳-word / v3.3+» را اعلان کرده
   بود** که در هیچ release ای از Aave وجود ندارد. واقعیت (از سورس تگ‌ها):
   نسخه‌های v3.0.x (aave-v3-core) ۱۵ word با aToken در word 8 هستند و **تمام**
   نسخه‌های v3.1.0 تا v3.7.0 (aave-v3-origin) ۱۷ word با aToken در word 9.
   اگر Pool اصلی Base روی هر کد ≥ v3.1 باشد (و شواهد ارتقای governance در
   ۲۰۲۵–۲۰۲۶ همین را می‌گوید)، جدول قبلی روی دادهٔ زنده حتماً
   `AAVE_RESERVE_DATA_UNDECODABLE` می‌داد و کل مسیر پول مسدود می‌شد.
2. **`explainRevert` فقط revert های قدیمیِ رشته‌ای عددی را می‌شناخت.** Aave از
   نسخهٔ v3.4.0 (ژوئیه ۲۰۲۵) همهٔ کدهای رشته‌ای (مثل `'26'`) را به custom
   error های بدون آرگومان با همان نام (`InvalidAmount()` و…) تبدیل کرده است؛
   payload خطا حالا فقط selector است و عدد ۲۶ جایی نیست. روی چنین instance ای
   (و v3.7.0 آگوست ۲۰۲۶ همچنان custom است) همهٔ revert های واقعی «ناشناخته»
   می‌ماندند — دقیقاً همان بند «revert نگاشت‌نشده» از چک‌لیست rollout.

پروب fork نیز طوری تقویت شد که rule 7 آن حالا واقعاً revert های زنده را با
`eth_call` می‌زند (supply با مبلغ صفر و withdraw فراتر از موجودی) و نگاشت
`explainRevert` را — در هر کدام از دو دوران خطای پروتکل که fork جواب دهد —
بررسی می‌کند.

## ۱) چرا پروب اینجا اجرا نشد — خروجی‌ها

### شبکه
تمام این endpoint ها تست شدند و همگی `000` (connection reset/refused) بودند:
`mainnet.base.org` (و نسخهٔ http)، `base.llamarpc.com`، `base-rpc.publicnode.com`،
`developer-access-mainnet.base.org`، `1rpc.io/base`، `base.drpc.org`،
`rpc.ankr.com/base`، `base.blockpi.network`، `base.gateway.tenderly.co`،
`cloudflare-eth.com`، `ethereum.publicnode.com`، `eth.llamarpc.com` و … .
کنترل: `api.github.com` و `registry.npmjs.org` از همین سندباکس ۲۰۰ می‌دهند؛
پس فیلتر، لیست مجاز نام‌میزبان است، نه قطعی سراسری.

### anvil / Foundry
```
$ curl -L https://foundry.paradigm.xyz | bash
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to foundry.paradigm.xyz:443
```

### خود پروب (دقیقاً همان اسکریپت acceptance)
```
$ npm run test:aave-base-fork
> node test/aave-base-fork-probe.mjs
──────────────────────────────────────────────────────────────────────────────
Aave v3 · Base (8453) · USDC — mainnet fork probe
──────────────────────────────────────────────────────────────────────────────
⏭  SKIPPED — 'anvil' is not on PATH.
    This probe is the acceptance test for the Aave Base supply adapter, so it
    must be run by hand before the flag is enabled. Exact commands:
      curl -L https://foundry.paradigm.xyz | bash && foundryup
      BASE_RPC_URL=https://mainnet.base.org node test/aave-base-fork-probe.mjs --strict
──────────────────────────────────────────────────────────────────────────────
result
──────────────────────────────────────────────────────────────────────────────
0/0 passed          (exit 0)

$ node test/aave-base-fork-probe.mjs --strict ; echo $?
❌ anvil available (--strict)  — not found on PATH
result
──────────────────────────────────────────────────────────────────────────────
FAIL  anvil available (--strict)                not found on PATH
0/1 passed          (exit 1)
```

### GitHub Actions (مسیر اجرای networked)
تلاش شد workflow ای برای اجرای پروب ساخته و push شود؛ push با این پیام رد شد:
```
! [remote rejected] ... (refusing to allow a GitHub App to create or update
  workflow `.github/workflows/aave-base-fork-probe.yml` without `workflows` permission)
```
این همان محدودیتی است که `ci/README.md` و کامنت `ci/build-apk.yml` مستند کرده‌اند
(توکن agent نمی‌تواند زیر `.github/workflows/` بنویسد؛ فایل را owner دستی می‌گذارد).
بنابراین یک تمپلیت آمادهٔ اجرا اضافه شد: **`ci/aave-base-fork-probe.yml`**
(workflow_dispatch با input برای RPC؛ نصب anvil روی runner؛ اجرای
`--strict` با pipefail؛ آپلود artifact از لاگ کامل). روش استفاده در ادامهٔ گزارش.

## ۲) اصلاح ۱ — `decodeReserveData`: shape های واقعی، نه حدسی

### lineage واقعی (راستی‌آزمایی ۲۰۲۶-۰۹-۰۶ از سورس release ها)

| کد | مخزن/تگ | واژه‌ها | aToken | ts | id |
|---|---|---|---|---|---|
| v3.0.x (deploy های ۲۰۲۳–۲۴) | `aave/aave-v3-core` master/v1.19.4 | ۱۵ | word **8** | 6 | 7 |
| v3.1.0 | `aave-dao/aave-v3-origin` | ۱۷ | word **9** | 6 | 7 |
| v3.2.0 / v3.2.1 | همان (stable-rate منسوخ، اسلات حفظ شد) | ۱۷ | word **9** | 6 | 7 |
| v3.3.0 (۲۰۲۵-۰۲-۲۴) | همان (اسلات ۵ ← deficit) | ۱۷ | word **9** | 6 | 7 |
| v3.4.0 (۲۰۲۵-۰۷-۳۰) | همان | ۱۷ | word **9** | 6 | 7 |
| v3.5.0 / v3.6.0 / v3.7.0 (۲۰۲۶-۰۸-۰۵) | همان | ۱۷ | word **9** | 6 | 7 |

نکتهٔ تاریخی مهم: ادعای قبلی («v3.3.0 فیلدهای stable را حذف کرد») غلط است —
v3.2 آن‌ها را منسوخ کرد ولی **در struct نگه داشت** و v3.3 فقط یک اسلات را به
`deficit` تغییر کاربری داد. چیزی که aToken را جابه‌جا کرد، v3.1.0 بود
(درج `liquidationGracePeriodUntil` بعد از id و افزودن `virtualUnderlyingBalance`
در انتها). layout «۱۳-word با aToken در word 7» در **هیچ** release ای وجود ندارد.

علاوه بر این، رفتار ethers بررسی شد: decode یک tuple کوتاه‌تر روی دادهٔ بلندتر
ساکتانه موفق می‌شود (واژه‌های اضافه نادیده گرفته می‌شوند) — پس شکل ۱۵-word روی
دادهٔ ۱۷-word «دیکد» می‌شود و باید اعتبارسنجی ردش کند (aToken کاندید = word 8 =
grace period (uint40) → رد؛ همین الان هم این‌طور بود و این یعنی خطای قبلی «امن»
بود ولی **مسیر پول را کاملاً می‌بست**). تست واحد این رفتار را پین می‌کند.

### تغییرات
- `src/lib/defi/aaveV3Base.js` — کامنت provenance بازنویسی شد؛ `RESERVE_DATA_SHAPES`
  حالا فقط دو شکل واقعی دارد:
  - `'v3.0.x (aave-v3-core, 15w)'` — aTokenWord 8، words 15
  - `'v3.1+ (aave-v3-origin, 17w)'` — aTokenWord 9، words 17
- `test/helpers/aaveMockProvider.mjs` — ثابت‌های `SHAPE_CORE_V30X` /
  `SHAPE_ORIGIN_V31` / `SHAPE_PHANTOM_13W`؛ encoder هر سه شکل (۱۵/۱۷/۱۳-word) را
  با ترتیب فیلدهای منطبق بر `DataTypes.sol` می‌سازد و shape ناشناس را throw می‌کند؛
  پیش‌فرض mock روی ۱۷-word (واقعیت فعلی Base) رفت.
- `test/farm-defi.test.js` — دو تست جدید:
  - «declares exactly the two shapes the released protocol source actually has»
    (words/aTokenWord/timestampWord/idWord هر دو شکل + مجموعهٔ دقیق دو عضوی)
  - «rejects the phantom 13-word "v3.3+" layout that matches no released pool»
- `docs/defi/aave-v3-base.md` — بخش Runtime verification با lineage درست بازنویسی شد.

## ۳) اصلاح ۲ — `explainRevert`: دوران custom errors (v3.4+)

`Errors.sol` در هر نسخه دریافت و مقایسه شد:
- v3.0.x و v3.3.0: ثابت‌های رشته‌ای (`INVALID_AMOUNT = '26'` و…) — جدول عددی فعلی
  درست بود.
- v3.4.0 به بعد (v3.4.0، v3.5.0، v3.6.0، v3.7.0): **۸۸–۸۹ خطای custom بدون آرگومان
  با همان نام‌ها** (`error InvalidAmount();`, `error NotEnoughAvailableUserBalance();` …)
  و صفر ثابت رشته‌ای.

### تغییرات
- `AAVE_V3_CUSTOM_ERRORS` در `src/lib/defi/aaveV3Base.js`: نگاشت selector چهاربایتی
  هر خطا به همان کلید i18n دوران عددی (۱۲ کلید، همه از قبل در en/fa/ar موجود —
  کلید جدیدی به locale ها اضافه نشد).
- `explainRevert` دو-دورانه شد: اول selector (در `err.data` یا prose) →
  نگاشت custom؛ بعد مسیر قدیمی کد عددی. شکل خروجی تغییری نکرد
  (`{code, key, known, reason}`).
- تست‌ها: هر selector جدول در تست با `keccak256(name + "()")` بازتولید و مقایسه
  می‌شود (اشتباه تایپی = شکست تست، نه miss خاموش)؛ رفتار روی `{data}`، روی
  `{reason}` و fallback برای selector ناشناس؛ و backward compatibility کدهای عددی.
- پروب rule 7 واقعی شد (زیر): حالا وقتی fork اجرا شود، نگاشت را روی revert های
  زنده می‌سنجد.

## ۴) تقویت پروب — rule 7 واقعی شد

قبلاً rule 7 فقط رد محلی سقف per-tx را چک می‌کرد (بدون هیچ revert زنجیره‌ای) و
`explainRevert` در کل پروب هرگز صدا زده نمی‌شد. حالا (فایل
`test/aave-base-fork-probe.mjs`) بعد از چرخهٔ کامل supply/withdraw:
1. `eth_call` با `supply(USDC, 0, …)` → باید revert واقعی بدهد و
   `explainRevert` آن را به `farm.aave.err.invalidAmount` نگاشت کند (کد ۲۶ یا
   `InvalidAmount` — هر کدام که fork جواب دهد)؛
2. `eth_call` با `withdraw(USDC, 1, …)` وقتی position خالی است → باید revert
   بدهد و به `farm.aave.err.notEnoughBalance` نگاشت شود (کد ۳۲ یا custom)؛
3. تست قبلی رد سقف per-tx سر جایش ماند.

## ۵) بازبینی مستقل آداپتر (امضای reviewer)

- **آدرس‌ها** — هر پنج آدرس (Pool، PoolAddressesProvider، aBasUSDC، USDC و
  AaveProtocolDataProvider مستند) بایت‌به‌بایت با `src/AaveV3Base.sol` از
  `bgd-labs/aave-address-book` (نسخهٔ زنده، دریافت‌شده از GitHub API در همین
  تاریخ) مقایسه و تطبیق داده شد:
  `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` (POOL)،
  `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` (POOL_ADDRESSES_PROVIDER)،
  `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` (USDC_A_TOKEN)،
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC_UNDERLYING) — همگی ✓.
  پین wiring هم اثبات می‌کند آدرس‌ها فقط در `aaveV3Base.js` هستند و USDC از
  `chains.js` می‌آید.
- **مبلغ approve**: دقیقاً `amountWei` (تست: approve-value == 5_000_000 برای
  supply ۵)؛ `MaxUint256` فقط در `'max'` وایتدرو (قرارداد Aave همین را می‌خواهد)؛
  revoke = صفر. پین‌های wiring: هیچ MaxUint256 پیش از withdraw builder نیست.
- **onBehalfOf و گیرندهٔ withdraw**: همیشه owner متصل؛ هیچ پارامتری اجازهٔ
  تفاوت نمی‌دهد (پین + تست calldata).
- **هر write از preSignSimulation**: پنل از `buildUnsignedTransaction` +
  `simulateUnsignedTransaction` + `evaluateExecutionGate` می‌گذرد و فقط با
  `simulated-clean` اجازهٔ امضا دارد؛ آداپتر هیچ‌وقت امضا نمی‌کند.
- **باگ‌های عرضه/برداشت**: caps ۱۰۰/۵۰۰ در خود آداپتر؛ خروج (withdraw/revoke)
  هرگز پشت فلگ/سقف/allowlist نیست.

## ۶) تست‌های اجراشده (همه با خروجی)

| مورد | قبل | بعد | نتیجه |
|---|---|---|---|
| vitest (farm-defi + panel) | ۴۴/۴۴ | **۴۷/۴۷** | ✓ |
| wiring (داخل npm test) | ۲۴۵۱ ردیف، ۰ شکست | همان | ✓ |
| npm test (کل) | ۱۸ شکست | **۱۸ شکستِ یکسان** | diff نام‌به‌نام = صفر |
| build off/on/off + sha | — | جدول زیر | ✓ |

- شمارش vitest: `farm-defi.test.js` ۳۷ → ۴۰ تست، `farm-aave-panel.test.jsx` ۷ تست.
- diff شکست‌های npm test قبل/بعد: مجموعهٔ ۱۸ تایی (Settings region availability،
  guard واژگان، lockfile platform، guided flow و بقیهٔ شناخته‌شده) هیچ تغییری
  نکرد — همان‌هایی که روی main خالی هم می‌شکنند. لاگ کامل:
  `/tmp/npm-test.log` (قبل)، `/tmp/npm-test-final.log` (بعد).
- **اثبات خاموش‌بودن فلگ در بیلد (grep کافی نیست)** — سه بیلد پشت‌سرهم:

| بیلد | فایل Farm چانک | sha256 (۱۶ رقم) |
|---|---|---|
| `npm run build` (اف — اول) | `Farm-C_g79fcC.js` | `a643bc7d4100f380…` |
| `VITE_ENABLE_AAVE_BASE_SUPPLY=true VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0x1111…,0x2222… npm run build` | `Farm-CbLeKOCy.js` | `43feb363d0be8272…` |
| `npm run build` دوباره (اف — همان که ship می‌شود) | `Farm-C_g79fcC.js` | `a643bc7d4100f380…` (دقیقاً یکسان) |

لاگ کامل سه بیلد: `/tmp/final-build-off1.log`، `/tmp/final-build-on1.log`،
`/tmp/final-build-off2.log`. این سه بیلد روی درختِ نهاییِ همین تغییرات زده شده‌اند
(بعد از اصلاحات explainRevert و shape ها).

grep روی هیچ‌کدام از باندل‌ها نه `VITE_ENABLE_AAVE_BASE_SUPPLY` پیدا می‌کند و نه
`VITE_AAVE_BASE_SUPPLY_ALLOWLIST` — define آن‌ها را fold کرده (همان‌طور که
مستندات گفته‌اند)؛ تفاوت فقط در hash چانک ثابت می‌شود.

## ۷) یافتهٔ جانبی — allowlist در بیلد app از env خط فرمان وارد نمی‌شود

در بیلد «on + allowlist» آدرس‌های allowlist در باندل **نبود** (grep = صفر).
علت: در `features.js`، allowlist و سقف‌ها با `import.meta.env[name]` داینامیک خوانده
می‌شوند و Vite فقط دسترسی استاتیک را جایگزین می‌کند؛ define ای که برای فلگ در
`vite.config.js` هست (از `process.env`) برای allowlist وجود ندارد. پس دستور
مستندشدهٔ rollout — `VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0x… npm run build` —
فعلاً بیلدی می‌سازد که allowlist آن `[]` است (یعنی برای همه باز است، نه فقط
لیست). پیامد: تا وقتی probe پاس نشده rollout در کار نیست، ولی **قبل از اولین
بیلد allowlist-only باید این fix شود** — یا define اختصاصی در `vite.config.js`
(مثل فلگ) یا تحویل allowlist از `.env` فایل. این را عمداً تغییر ندادم (مسیر پول؛
خارج از scope پروب) — در سؤال پایانی تصمیم بگیرید.

## ۸) فایل‌های تغییرکرده

- `src/lib/defi/aaveV3Base.js` — shape های واقعی ReserveData + پشتیبانی custom
  error ها در explainRevert (+ کامنت‌های provenance مستند)
- `test/helpers/aaveMockProvider.mjs` — سه شکل encode + ثابت‌ها؛ پیش‌فرض ۱۷-word
- `test/farm-defi.test.js` — ۴۰ تست (پین دو shape، رد phantom، نگاشت selector ها)
- `test/aave-base-fork-probe.mjs` — rule 7 واقعی (revert های زنده با eth_call)
- `docs/defi/aave-v3-base.md` — lineage درست + دوران‌های خطا
- `ci/aave-base-fork-probe.yml` — **جدید**؛ تمپلیت اجرای دستی پروب روی runner
  networked (طبق الگوی `ci/README.md`؛ چون agent نمی‌تواند زیر `.github/workflows/`
  بنویسد، باید دستی کپی شود)
- `docs/AAVE-BASE-FORK-PROBE-REPORT-FA.md` — همین گزارش

## ۹) آنچه هنوز verify نشده (صادقانه)

1. **اجرای واقعی پروب** روی fork از Base mainnet — کدام shape در عمل جواب
   می‌دهد، supply/withdraw واقعی، و کدام دوران خطا روی Base است. shape ها از
   سورس release های پروتکل مشتق شده‌اند (حدس نیست)، ولی اثبات نهایی همان اجراست
   و خواستهٔ کاربر «hex خام از پروب + unit test با همان hex» فقط با یک اجرا
   کامل می‌شود.
2. **allowlist folding در بیلد app** (بند ۷).
3. **دورهٔ پایش ۲–۴ هفته‌ای** بعد از enable برای allowlist.

## ۱۰) راه اجرای پروب (دو گزینه)

**گزینهٔ A (پیشنهادی — بدون نیاز به ماشین شخصی):**
طبق `ci/README.md`، محتوای `ci/aave-base-fork-probe.yml` را دستی در فایل
`.github/workflows/aave-base-fork-probe.yml` بگذارید و commit کنید، سپس از تب
Actions → «Aave Base fork probe» → Run workflow (input پیش‌فرض
`https://mainnet.base.org`). خروجی کامل در لاگ ران و در artifact
`aave-base-fork-probe.log` می‌آید؛ لاگ‌ها برای توکن من خواندنی‌اند، پس کافی است
اجرا شود — ادامهٔ راستی‌آزمایی و چسباندن خروجی در گزارش را خودم انجام می‌دهم.

**گزینهٔ B:** روی هر ماشین با دسترسی اینترنت:
```
curl -L https://foundry.paradigm.xyz | bash && foundryup
BASE_RPC_URL=https://mainnet.base.org npm run test:aave-base-fork -- --strict
```
و خروجی کامل را همین‌جا بچسبانید.
