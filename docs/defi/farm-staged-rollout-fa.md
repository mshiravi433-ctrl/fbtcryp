# rollout مرحله‌ای Farm و canary محدود

این سند قرارداد اجرایی build است. وجود آداپتور یا سبز بودن تست واحد به معنی مجاز بودن ورود سرمایه نیست. DefiLlama فقط منبع داده و mapping است و هیچ‌وقت target تراکنش نیست.

## رفتار fail-closed

سیاست مشترک در `scripts/farm-rollout-policy.mjs` تعریف شده و `vite.config.js` آن را هنگام بارگذاری config اجرا می‌کند. در نتیجه همهٔ مسیرهای اصلی (`npm run build`، `build:full` در Vercel، و build وب داخل APK) از همان gate عبور می‌کنند؛ اجرای مستقیم `vite build` هم gate را دور نمی‌زند.

- اگر هیچ `VITE_ENABLE_*` مربوط به ورود سرمایه `true` نباشد، build بدون evidence مجاز و در حالت `capital-off` است.
- اگر یک protocol فعال باشد، id همان protocol باید در `FARM_ROLLOUT_PROTOCOLS` باشد.
- فهرست protocolهای انتخاب‌شده و flagهای فعال باید دقیقاً یکسان باشند.
- `FARM_STRICT_FORK_EVIDENCE=true` و allowlist عمومی، معتبر و غیرخالی برای هر protocol فعال اجباری است.
- آدرس صفر، عضو نامعتبر، عضو خالی و عضو تکراری پذیرفته نمی‌شود.
- سقف canary نمی‌تواند از سقف reviewشدهٔ فعلی بیشتر شود: Aave/Compound/Morpho برابر ۱۰۰۰ USDC در هر تراکنش و ۱۰۰۰۰ USDC کل، و Lido برابر ۱ ETH و ۱۰ ETH کل.
- خاموش‌کردن flag فقط ورود جدید را می‌بندد. withdraw/claim/revoke به flag یا DefiLlama وابسته نیست.

## idهای معتبر

| id rollout | flag | allowlist |
|---|---|---|
| `aave-base` | `VITE_ENABLE_AAVE_BASE_SUPPLY` | `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` |
| `compound-base` | `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST` |
| `aave-arbitrum` | `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` |
| `lido` | `VITE_ENABLE_LIDO_STAKE` | `VITE_LIDO_STAKE_ALLOWLIST` |
| `morpho-base` | `VITE_ENABLE_MORPHO_BASE_SUPPLY` | `VITE_MORPHO_BASE_SUPPLY_ALLOWLIST` |

## build عمومی امن

هیچ متغیر rollout لازم نیست:

```bash
npm run build
```

خروجی gate:

```text
Farm rollout gate passed: no money-in protocol is enabled (capital-off build).
```

## مرحلهٔ اول: فقط Aave Base

ابتدا ابزار و RPC read-only را بررسی کنید:

```bash
anvil --version
forge --version
BASE_RPC_URL="$BASE_RPC_URL" npm run test:aave-base-fork -- --strict
```

در حالت `--strict` نبود صریح `BASE_RPC_URL`، نبود Anvil، خطای fork/RPC، هر assertion ناموفق یا SKIP خروجی ناموفق است. probe واقعی روی fork محلی approval دقیق، `eth_call`، `estimateGas`، کنترل account/network پیش از امضا، supply، receipt/event/position proof، withdraw کامل، revert/cap و طبقه‌بندی rejection/timeout/replacement را بررسی می‌کند. هیچ تراکنشی به Base mainnet ارسال نمی‌شود.

در ۲۰۲۶-۰۹-۰۹، اجرای اصلاح‌شدهٔ Aave Base در [CI job 102268394490](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34288150304/job/102268394490) هر ۵۰ assertion strict fork را PASS کرد. اجرای قبل از آن با `26/27` یک mismatch واقعی ABI رویداد `Supply` را پیدا کرد و به‌درستی evidence محسوب نشد. جزئیات در [`farm-execution-readiness-fa.md`](./farm-execution-readiness-fa.md) ثبت شده است. این PASS به‌تنهایی اجازهٔ فعال‌سازی نمی‌دهد؛ allowlist مورد تأیید صاحب wallet و canary زنده با خروج کامل هنوز لازم است.

فقط پس از PASS و review evidence:

```env
FARM_STRICT_FORK_EVIDENCE=true
FARM_ROLLOUT_PROTOCOLS=aave-base

VITE_ENABLE_AAVE_BASE_SUPPLY=true
VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xPUBLIC_CANARY_WALLET
VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX=1000
VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL=10000

VITE_ENABLE_COMPOUND_BASE_SUPPLY=false
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=false
VITE_ENABLE_LIDO_STAKE=false
VITE_ENABLE_MORPHO_BASE_SUPPLY=false
```

سپس:

```bash
npm run build:farm-rollout
```

allowlist باید آدرس عمومی wallet صاحب canary باشد. هیچ private key، seed یا mnemonic در config، CI یا گزارش قرار نمی‌گیرد. canary زنده فقط بعد از تأیید صریح صاحب همان wallet و از داخل wallet او انجام می‌شود.

## مراحل بعدی مستقل

هر protocol probe و rollout مستقل دارد و موفقیت Aave Base آن‌ها را باز نمی‌کند:

```bash
BASE_RPC_URL="$BASE_RPC_URL" npm run test:compound-base-fork -- --strict
ARBITRUM_RPC_URL="$ARBITRUM_RPC_URL" npm run test:aave-arbitrum-fork -- --strict
ETHEREUM_RPC_URL="$ETHEREUM_RPC_URL" npm run test:lido-mainnet-fork -- --strict
BASE_RPC_URL="$BASE_RPC_URL" npm run test:morpho-base-fork -- --strict
```

## وب و Android

- Vercel از `build:full` استفاده می‌کند؛ این script در نهایت config اصلی Vite را بارگذاری می‌کند و مشمول gate است.
- Android همان bundle وب را با Capacitor sync می‌کند. متغیرهای rollout فقط وقتی وارد APK/AAB می‌شوند که workflow آن‌ها را صریحاً به build بدهد.
- workflow عمومی فعلی متغیرهای Farm را به build پاس نمی‌دهد؛ بنابراین artifact عمومی به‌صورت پیش‌فرض `capital-off` باقی می‌ماند.
- برای انتشار canary Android باید همین مجموعهٔ کامل متغیرهای مرحلهٔ Aave Base به build داده و محتوای bundle قبل از بسته‌بندی بررسی شود؛ تنظیم flag تنها مجاز نیست.

## canary زنده

ترتیب اجباری:

1. اتصال wallet عمومی allowlist‌شده و تأیید صریح صاحب آن؛
2. بررسی مجدد account و Base chain؛
3. quote/plan و simulation واقعی `eth_call` + `estimateGas`؛
4. approval دقیق مبلغ، نه unlimited؛
5. supply کوچک در سقف؛
6. receipt موفق، رویداد رسمی `Supply` و افزایش position؛
7. withdraw کامل با رویداد `Withdraw` و position نهایی؛
8. ثبت tx hash، block، event و before/after بدون هیچ credential.

تا پیش از تکمیل این چرخه، وضعیت فقط «canary-ready در کد» است، نه production-ready برای public capital.

## گذار به public-open (بعد از canary موفق) — پیش‌فرض خاموش

پس از اینکه canaryِ روی زنجیره تأیید شد، ممکن است ورودی جدید را به **هر wallet متصل** باز کنی، نه فقط allowlist. این کار با افزودن پرچم public آن protocol **به‌همراه** `FARM_CANARY_CONFIRMED=true` انجام می‌شود:

| protocol | public flag |
|---|---|
| Aave v3 Base | `VITE_AAVE_BASE_SUPPLY_PUBLIC=true` |
| Aave v3 Arbitrum | `VITE_AAVE_ARB_SUPPLY_PUBLIC=true` |
| Compound v3 Base | `VITE_COMPOUND_BASE_SUPPLY_PUBLIC=true` |
| Lido | `VITE_LIDO_STAKE_PUBLIC=true` |
| Morpho Blue Base | `VITE_MORPHO_BASE_SUPPLY_PUBLIC=true` |

قواعد ثابت:

- **پرچم public بدون `FARM_CANARY_CONFIRMED=true` باعث fail-closed شدن build می‌شود** (gate خطا می‌دهد).
- allowlist حتی در حالت public هم باید غیرخالی بماند (همان wallet fee-recipient)، بنابراین gate هیچ‌وقت fail-open نمی‌شود.
- حالت public فقط **SUPPLY/STAKE** را برای همه باز می‌کند و همان سقف‌ها (۱۰۰۰/۱۰۰۰۰ USDC و Lido ۱/۱۰ ETH) اعمال می‌شود.
- **WITHDRAW/UNWRAP/REQUESTWITHDRAW/CLAIM** همچنان فقط با `hasPosition` گیت می‌شود؛ هرگز با flag/allowlist/caps/public باز نمی‌شود.

```env
FARM_STRICT_FORK_EVIDENCE=true
FARM_CANARY_CONFIRMED=true
FARM_ROLLOUT_PROTOCOLS=aave-base,aave-arbitrum,compound-base,lido,morpho-base

VITE_ENABLE_AAVE_BASE_SUPPLY=true
VITE_AAVE_BASE_SUPPLY_PUBLIC=true
# ... همین الگو برای Aave Arb / Compound / Lido / Morpho با *_PUBLIC=true
```

تا وقتی canary تأیید نشده این متغیرها را **ست نکن**؛ deployment باید `limited-canary` بماند.
