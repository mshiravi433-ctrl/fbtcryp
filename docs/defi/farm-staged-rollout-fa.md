# rollout مرحله‌ای Farm و Runbook کامل Canary واقعی Aave Base

این سند قرارداد اجرایی build و چک‌لیست عملیاتی اجرای canary زندهٔ مرحلهٔ ۱ (**Aave v3 · Base · native USDC**) است. وجود آداپتور یا سبز بودن تست واحد به معنی مجاز بودن ورود سرمایه نیست. DefiLlama و Kamino API فقط منابع داده و mapping هستند و هیچ‌وقت مقصد تراکنش نیستند.

> **وضعیت فعلی (`2026-10-26`):** کد، دروازهٔ fail-closed، اسکریپت پیش‌بررسی بدون هزینه (`npm run check:aave-base-canary`) و نمونه تنظیمات آماده (`ci/farm-aave-base-canary.env.example`) به طور کامل آماده‌اند. **هیچ canary زنده‌ای بدون مجوز اجرا نشده است**؛ تنها دو مورد باقی‌مانده پیش از اجرای تراکنش واقعی عبارت‌اند از: **«۱) مجوز صریح مالک پروژه» + «۲) آدرس عمومی والت canary مالک»**.

---

## ۱. رفتار fail-closed دروازهٔ بیلد (`scripts/farm-rollout-policy.mjs`)

سیاست مشترک در `scripts/farm-rollout-policy.mjs` تعریف شده و `vite.config.js` آن را هنگام بارگذاری config اجرا می‌کند (`assertFarmRollout(process.env)`). در نتیجه همهٔ مسیرهای اصلی (`npm run build`، `build:farm-rollout`، `build:full` در Vercel، و build وب داخل APK) از یک gate واحد عبور می‌کنند:

- اگر هیچ `VITE_ENABLE_*` مربوط به ورود سرمایه `true` نباشد، build بدون نیاز به متغیر اضافه مجاز و در حالت `capital-off` است (`node scripts/verify-farm-rollout.mjs`).
- اگر یک پروتکل فعال شود، `id` همان پروتکل باید دقیقاً در `FARM_ROLLOUT_PROTOCOLS` ذکر شود (تطابق یک‌به‌یک؛ هرگونه عدم تطابق باعث خطای build می‌شود).
- `FARM_STRICT_FORK_EVIDENCE=true` و `allowlist` عمومی، معتبر (`0x` + ۴۰ کاراکتر هگز غیرصفر) و بدون عضو خالی یا تکراری برای هر پروتکل فعال الزامی است.
- متغیرهای قدیمی سقف مصنوعی (`VITE_*_MAX_*`) پس از ثبت شواهد strict fork از کد حذف شده‌اند (`uncapped` در `scripts/farm-rollout-policy.mjs` و `src/lib/features.js`): تنها سقف‌های حاکم در کد، سقف آن‌چین خود پروتکل (مانند supply cap در Aave) و موجودی کیف پول کاربر هستند. با این حال برای اجرای عملیاتی canary زنده، رقم پیشنهادی استاندارد **۵ USDC** است.
- هر پرچم عمومی `VITE_*_PUBLIC=true` بدون `FARM_CANARY_CONFIRMED=true` بلافاصله build را fail-closed متوقف می‌کند.
- خاموش‌کردن پرچم یا اجرای کلید اضطراری `FARM_CAPITAL=off` فقط ورود سرمایهٔ جدید را می‌بندد؛ مسیر خروج (`withdraw` / `unwrap` / `requestWithdraw` / `claim` / `revoke`) فقط تابع `hasPosition` آن‌چین است و هرگز قفل نمی‌شود.

## ۲. جدول شناسه‌ها و متغیرهای معتبر

| id در `FARM_ROLLOUT_PROTOCOLS` | پرچم ورود سرمایه | متغیر allowlist (آدرس عمومی `0x…`) | پرچم بازگشایی عمومی (فقط پس از `FARM_CANARY_CONFIRMED=true`) |
|---|---|---|---|
| `aave-base` | `VITE_ENABLE_AAVE_BASE_SUPPLY` | `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` | `VITE_AAVE_BASE_SUPPLY_PUBLIC` |
| `compound-base` | `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST` | `VITE_COMPOUND_BASE_SUPPLY_PUBLIC` |
| `aave-arbitrum` | `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` | `VITE_AAVE_ARB_SUPPLY_PUBLIC` |
| `lido` | `VITE_ENABLE_LIDO_STAKE` | `VITE_LIDO_STAKE_ALLOWLIST` | `VITE_LIDO_STAKE_PUBLIC` |
| `morpho-base` | `VITE_ENABLE_MORPHO_BASE_SUPPLY` | `VITE_MORPHO_BASE_SUPPLY_ALLOWLIST` | `VITE_MORPHO_BASE_SUPPLY_PUBLIC` |

---

## ۳. بیلد عمومی پیش‌فرض و کلید توقف اضطراری (Kill-Switch)

بیلد پیش‌فرض محلی بدون هیچ متغیر محیطی در حالت `capital-off` است:

```bash
node scripts/verify-farm-rollout.mjs
# خروجی:
# Farm rollout gate passed: no money-in protocol is enabled (capital-off build).
```

در Vercel یا بیلد کامل (`npm run build:full` که `ci/farm-rollout.env.sh` را می‌خواند)، برای بستن فوری همهٔ مسیرهای ورود سرمایه بدون تغییر کد کافی است فقط یک متغیر ست شود:

```env
FARM_CAPITAL=off
```

---

## ۴. Runbook گام‌به‌گام Canary واقعی مرحلهٔ ۱: فقط Aave v3 Base (USDC بومی)

### الف) شواهد فنی تاییدشدهٔ Aave Base در مخزن
- **آدرس‌های پین‌شده (تک‌منبعی در `src/lib/defi/aaveV3Base.js` و `src/lib/chains.js`):**
  - شبکه: **Base Mainnet (`chainId = 8453`)**
  - `PoolAddressesProvider`: `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D`
  - `Pool`: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
  - `USDC` بومی Circle: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (`decimals = 6`)
  - `aBasUSDC`: `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB`
  - `referralCode`: `0` (و `VITE_FBT_SPLIT_ROUTER_BASE` خالی؛ واریز مستقیم ۰٪ کارمزد)
- **شواهد strict fork:** اجرای سبز `50/50` در [CI job 102268394490](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34288150304/job/102268394490) + فایل لنگر `farm-fork-evidence/aave-base.json` (`36/36 PASS`, `sha256 = 97abf4ad49c016a4ff719eb797b6f9f4dc52b192a5d44a9d3e50f524f4b32fc3`).

### ب) گام ۱ — پیش‌بررسی خودکار بدون هزینه و بدون کلید خصوصی
پیش از هر بیلد canary، اسکریپت پیش‌بررسی را اجرا کنید (این اسکریپت در صورت مشاهدهٔ هرگونه `PRIVATE_KEY` یا `MNEMONIC` در محیط بلافاصله با خطا متوقف می‌شود):

```bash
# ۱) بررسی آفلاین پین‌ها، فایل شواهد fork و شبیه‌سازی gate با آدرس عمومی والت canary:
CANARY_WALLET=0xYOUR_PUBLIC_CANARY_WALLET npm run check:aave-base-canary

# ۲) در ماشین اپراتور با اینترنت آزاد، بررسی read-only آن‌چین روی Base RPC
#    (تطابق Pool/aBasUSDC، فعال و غیرمتوقف بودن رزرو USDC، و کفایت گاز ETH + حداقل 5 USDC در والت):
BASE_RPC_URL=https://mainnet.base.org \
CANARY_WALLET=0xYOUR_PUBLIC_CANARY_WALLET \
  npm run check:aave-base-canary -- --rpc
```

**حداقل موجودی پیشنهادی در والت عمومی canary روی Base (`8453`):**
- حداقل **`5 USDC`** بومی (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- حداقل **`0.001 ETH`** روی شبکهٔ Base برای گاز سه تراکنش (`approve` + `supply` + `withdraw`)

### ج) گام ۲ — نمونه تنظیمات آماده (`ci/farm-aave-base-canary.env.example`)
فایل آماده در `ci/farm-aave-base-canary.env.example` قرار دارد. خلاصهٔ دقیق متغیرهای بیلد canary محدود فقط برای Aave Base:

```env
FARM_ROLLOUT_PROTOCOLS=aave-base
FARM_STRICT_FORK_EVIDENCE=true
FARM_CANARY_CONFIRMED=false

VITE_ENABLE_AAVE_BASE_SUPPLY=true
VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xYOUR_PUBLIC_CANARY_WALLET
VITE_AAVE_BASE_SUPPLY_PUBLIC=false

VITE_ENABLE_COMPOUND_BASE_SUPPLY=false
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=false
VITE_ENABLE_LIDO_STAKE=false
VITE_ENABLE_MORPHO_BASE_SUPPLY=false

VITE_FBT_SPLIT_ROUTER_BASE=
VITE_FBT_SPLIT_ROUTER_ARBITRUM=
VITE_FBT_SPLIT_ROUTER_ETHEREUM=
```

ساخت بیلد canary پس از جایگزینی آدرس عمومی والت مالک:

```bash
set -a && . ./ci/farm-aave-base-canary.env.example && set +a
export VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xYOUR_PUBLIC_CANARY_WALLET
npm run build:farm-rollout
```

خروجی مورد انتظار gate در ابتدای بیلد:
```text
Farm rollout gate passed: limited canary for aave-base (1 canary wallet, uncapped).
```

### د) گام ۳ — چک‌لیست ۸ مرحله‌ای اجرای زنده از داخل کیف پول مالک (فقط پس از مجوز صریح)
1. **اتصال والت allowlist‌شده:** با همان والت عمومی درج‌شده در `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` وارد تب Farm شوید (بررسی کنید با یک والت دیگر دکمهٔ Supply بسته باشد).
2. **تایید شبکه و حساب:** اطمینان حاصل کنید کیف پول روی شبکهٔ **Base (`8453`)** است و موجودی USDC بومی و ETH به درستی خوانده شده است.
3. **بازبینی پلن و شبیه‌سازی پیش از امضا:** مبلغ **`5`** USDC وارد کنید و بررسی کنید اپ شبیه‌سازی `eth_call` + `estimateGas` را بدون خطا به پایان برساند و آدرس مقصد دقیقاً `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` باشد.
4. **امضای `approve` دقیق (Exact Allowance):** تراکنش اول `USDC.approve(pool, 5_000_000)` است — مطمئن شوید در پنجرهٔ کیف پول مقدار دقیقاً **`5 USDC`** است (هرگز `unlimited` نیست).
5. **امضای `supply`:** تراکنش دوم `Pool.supply(USDC, 5_000_000, owner, 0)` را در کیف پول تایید کنید.
6. **تایید Receipt و افزایش پوزیشن:** منتظر تایید آن‌چین بمانید؛ بررسی کنید رویداد رسمی `Supply` در BaseScan ثبت شده، موجودی `aBasUSDC` کیف پول به اندازهٔ `~5.00 USDC` افزایش یافته، و Allowance باقیماندهٔ Pool صفر (`0`) شده باشد.
7. **برداشت کامل (`Withdraw Max`):** بلافاصله گزینهٔ برداشت کامل کل پوزیشن را بزنید و تراکنش `Pool.withdraw(USDC, max, owner)` را امضا کنید؛ تایید کنید رویداد `Withdraw` صادر شده، USDC به کیف پول برگشته و موجودی `aBasUSDC` به صفر رسیده است.
8. **ثبت گزارش بدون هیچ دادهٔ محرمانه:** جدول زیر را در `docs/defi/farm-canary-report.md` پر کنید (فقط اطلاعات عمومی آن‌چین؛ بدون هیچ کلید خصوصی یا seed):

```markdown
### ثبت نتیجهٔ Canary زندهٔ Aave v3 Base
- تاریخ و ساعت (UTC): YYYY-MM-DDTHH:MM:SSZ
- آدرس عمومی والت Canary: 0x...
- تراکنش ۱ (`approve` دقیق ۵ USDC): https://basescan.org/tx/0x... (block #...)
- تراکنش ۲ (`supply` ۵ USDC): https://basescan.org/tx/0x... (block #..., رویداد Supply تایید شد)
- تراکنش ۳ (`withdraw` کامل): https://basescan.org/tx/0x... (block #..., رویداد Withdraw تایید شد)
- موجودی USDC قبل / بعد: ... -> ... (تفاضل = صفر منهای سود لحظه‌ای؛ گاز کل ETH: ...)
- موجودی نهایی `aBasUSDC` و Allowance باقیمانده: `0` / `0`
```

---

## ۵. مراحل بعدی مستقل و گذار به `public-open`

- موفقیت canary روی Aave Base به‌تنهایی مجوز بازکردن Compound Base، Aave Arbitrum، Lido یا Morpho Base نیست؛ هر پروتکل نیازمند PASS شواهد `--strict` به‌روز خود (رجوع به [`farm-execution-readiness-fa.md`](./farm-execution-readiness-fa.md)) و canary مستقل خود است.
- تنها پس از تکمیل و ثبت هر ۸ مرحلهٔ بالا روی زنجیره، مالک می‌تواند با تنظیم هم‌زمان `FARM_CANARY_CONFIRMED=true` و `VITE_AAVE_BASE_SUPPLY_PUBLIC=true` ورودی Aave Base را از `limited-canary` به `public-open` ارتقا دهد (در حالی که `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` همچنان با آدرس والت اپراتور پر باقی می‌ماند تا gate هرگز fail-open نشود).
