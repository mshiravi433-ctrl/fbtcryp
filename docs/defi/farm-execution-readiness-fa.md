# وضعیت اجرای Farm و برنامهٔ rollout

بازبینی کد و پروب‌ها: ۲۰۲۶-۱۰-۲۶. وجود آداپتور، تست با provider مصنوعی، PASS واقعی fork با نسخهٔ فعلی پروب، و فعال‌بودن canary در deployment چهار وضعیت جدا هستند. این سند هیچ تراکنش mainnet یا فعال‌سازی public capital را ادعا نمی‌کند و همهٔ فلگ‌های ورود سرمایه در کد و env خاموش (`false`) هستند.

راهنمای اجرایی و متغیرهای build در [`farm-staged-rollout-fa.md`](./farm-staged-rollout-fa.md) است.

## محدودهٔ موجود

| اتصال | محدودهٔ کد | وضعیت ورود سرمایه |
|---|---|---|
| DefiLlama + Kamino Solana API | discovery، APY/TVL، تاریخچه و freshness (بدون کلید API) | فقط data/mapping؛ هرگز transaction target نیست |
| Aave v3 / Base / USDC بومی | supply، withdraw، position، exact approve، revoke، simulation و receipt/event/state proof | اولویت canary؛ پیش‌فرض خاموش |
| Compound v3 / Base / USDC بومی | supply، withdraw، position، exact approve، revoke و proof | مرحلهٔ مستقل بعدی؛ پیش‌فرض خاموش |
| Aave v3 / Arbitrum / USDC بومی | supply، withdraw، position، revoke و proof | مرحلهٔ مستقل بعدی؛ پیش‌فرض خاموش |
| Lido / Ethereum | stake، wrap/unwrap، request withdrawal، استخراج requestId و claim | مرحلهٔ مستقل؛ پیش‌فرض خاموش |
| Morpho Blue / Base | core، marketId پین‌شده، USDC loan و cbBTC collateral | مرحلهٔ مستقل؛ پیش‌فرض خاموش |

## gate مرحله‌ای

`vite.config.js` سیاست fail-closed در `scripts/farm-rollout-policy.mjs` را برای همهٔ buildهای اصلی اجرا می‌کند:

- بدون flag فعال (یا با `FARM_CAPITAL=off`): build عمومی `capital-off` و مجاز است.
- با flag فعال در حالت `limited-canary`: `FARM_ROLLOUT_PROTOCOLS` دقیق، فایل `farm-fork-evidence/<id>.json` با `result: "PASS"` و `sha256` معتبر، `FARM_STRICT_FORK_EVIDENCE=true` و `allowlist` معتبر و غیرخالی همان protocol اجباری است.
- در حالت بازگشایی عمومی (`public-open`): علاوه بر `FARM_STRICT_FORK_EVIDENCE=true`، `FARM_ROLLOUT_PROTOCOLS` دقیق و `allowlist` غیرخالی، تنظیم هم‌زمان `FARM_CANARY_CONFIRMED=true` و پرچم همان پروتکل (`VITE_*_PUBLIC=true`) الزامی است.
- فعال‌کردن Aave Base، protocolهای دیگر را مطالبه یا فعال نمی‌کند.
- flag فعال بدون gate کامل، حتی با اجرای مستقیم `vite build`، build production را fail می‌کند.
- سقف‌های مبلغی قدیمی (`VITE_*_MAX_*_PER_TX` و `VITE_*_MAX_*_TOTAL`) طبق تصمیم صاحب پروژه حذف شده‌اند (`perTxCap: undefined`, `totalCap: undefined`) و سیاست فعلی بدون سقف عددی مصنوعی کار می‌کند، در حالی که گیت‌های `canary`/`public`، شواهد fork و kill switch کاملاً fail-closed باقی مانده‌اند.

## خروج مستقل از feed و kill switch

position hub با descriptorهای ثابت و بدون APY/TVL، قراردادهای پین‌شدهٔ Aave Base، Compound Base، Aave Arbitrum و Lido را مستقیماً می‌خواند. بنابراین خرابی یا فیلتر DefiLlama مسیر position/withdraw/claim/revoke پشتیبانی‌شده را حذف نمی‌کند. خواندن cross-chain به شبکهٔ فعال wallet وابسته نیست؛ امضا همچنان تا network switch صریح مسدود است.

خاموش‌کردن money-in flag فقط supply/stake جدید را می‌بندد. خروج بر اساس owner و position واقعی تصمیم می‌گیرد، نه flag و نه allowlist.

## probeهای strict

```bash
BASE_RPC_URL="$BASE_RPC_URL" npm run test:aave-base-fork -- --strict
BASE_RPC_URL="$BASE_RPC_URL" npm run test:compound-base-fork -- --strict
ARBITRUM_RPC_URL="$ARBITRUM_RPC_URL" npm run test:aave-arbitrum-fork -- --strict
ETHEREUM_RPC_URL="$ETHEREUM_RPC_URL" npm run test:lido-mainnet-fork -- --strict
BASE_RPC_URL="$BASE_RPC_URL" npm run test:morpho-base-fork -- --strict
```

در strict mode نبود متغیر RPC صریح، نبود Anvil، خطای SSL/RPC، SKIP یا هر assertion ناموفق exit غیرصفر است. test واحد یا build موفق جای evidence واقعی fork را نمی‌گیرد.

Aave Base probe علاوه بر deployment/reserve، exact approval، `eth_call` و `estimateGas` برای هر step، بررسی account/network پیش از امضا، receipt/event/position transition، max withdraw، revert/cap و taxonomy مربوط به rejection/timeout/replacement را پوشش می‌دهد.

### evidence ثبت‌شده برای Aave Base

- اجرای نخست روی fork عمومی Base در CI در [run 34287319297](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34287319297) پس از approve و supply واقعی روی fork با `26/27` متوقف شد. علت، layout اشتباه indexed fields در ABI رویداد `Supply` بود؛ این اجرا **PASS محسوب نمی‌شود**.
- ABI با تعریف منتشرشدهٔ `IPool` همسو شد (`user` در data و `referralCode` در topic) و اثبات افزایش position نیز rounding طبیعی scaled aToken را می‌پذیرد، بدون حذف کنترل مقدار و owner رویداد.
- اجرای اصلاح‌شده در commit `2d07829`، مرحلهٔ `Aave Base strict fork evidence` را در [job 102268394490](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34288150304/job/102268394490) با **۵۰/۵۰ assertion موفق** تمام کرد: exact approve پنج USDC، simulation، supply، receipt/event/position proof، withdraw کامل و taxonomy همگی روی fork محلی PASS شدند. step بعدی انتشار GitHub با `Server Error` شکست خورد؛ آن خطای release پس از PASS probe رخ داد و evidence fork را تغییر نمی‌دهد.
- این PASS فقط شرط اول activation است. هنوز allowlist عمومیِ مورد تأیید صاحب wallet و canary زنده با تراکنش‌های mainnet و evidence خروج کامل وجود ندارد.

### گزارش اجرای `--strict` برای ۴ پروتکل باقی‌مانده (۲۰۲۶-۱۰-۲۶)

طبق قاعدهٔ سخت‌گیرانهٔ این مخزن، **`SKIP` معادل `FAIL` است** و هیچ مدرک ساختگی تولید نمی‌شود. در تاریخ `2026-10-26` هر چهار پروب باقی‌مانده با `--strict` روی کد فعلی (`09ab1b5`) اجرا و بررسی شدند:

1. **بررسی باندل‌های واقعی آداپتور پیش از اجرا:** هر چهار باندل Vite پروب (`test/vite.compoundfork.mjs`، `test/vite.aavearb.mjs`، `test/vite.lidofork.mjs` و `test/vite.morphofork.mjs`) بدون خطا کامپایل شدند و خروجی واقعی آن‌ها تأیید کرد که در همگی فلگ ورود سرمایه خاموش (`ENABLED === false`) و سقف‌های حذف‌شده `undefined` هستند.
2. **علت مسدود بودن اجرای محلی Anvil + RPC عمومی در محیط ایزولهٔ فعلی:**
   - باینری `anvil` (Foundry) روی `PATH` این محیط نصب نیست و دانلود مستقیم آن از `release-assets.githubusercontent.com` / `foundry.paradigm.xyz` و نیز اتصال خروجی مستقیم به RPCهای عمومی (`https://mainnet.base.org`، `https://arb1.arbitrum.io/rpc`، `https://eth.llamarpc.com`) در لایهٔ شبکهٔ sandbox با `OpenSSL SSL_connect: SSL_ERROR_SYSCALL` (کد خروج `35`) مسدود است.
   - فراخوانی خودکار ورک‌فلوهای `workflow_dispatch` در GitHub Actions با توکن یکپارچه‌سازی فعلی نیز با `HTTP 403: Resource not accessible by integration` رد می‌شود (نیازمند کلیک دستی صاحب مخزن در تب Actions یا توکن دارای `actions:write`).
3. **نتیجهٔ دقیق هر پروتکل در اجرای `--strict` مورخ ۲۰۲۶-۱۰-۲۶:**

| پروتکل | دستور اجراشده با `--strict` | خروجی و کد خروج واقعی در ۲۰۲۶-۱۰-۲۶ | وضعیت هم‌سنگ استاندارد ۵۰/۵۰ Aave Base | آخرین اجرای تاریخی CI (پیش از توسعهٔ assertionهای جدید) |
|---|---|---|---|---|
| **Compound v3 · Base (`8453`) · USDC** | `BASE_RPC_URL=https://mainnet.base.org node test/compound-base-fork-probe.mjs --strict` | `FAIL anvil available (--strict) — not found on PATH` · `0/1 passed` (`exit 1`) | **FAIL** (در محیط ایزوله؛ عدم دسترسی به `anvil` و RPC عمومی) | [run 34159577173](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34159577173) (۲۰۲۶-۰۹-۰۷؛ انکر قدیمی ۲۹/۲۹، پیش از assertionهای جدید بدون سقف) |
| **Aave v3 · Arbitrum (`42161`) · USDC** | `ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc node test/aave-arbitrum-fork-probe.mjs --strict` | `FAIL anvil available (--strict) — not found on PATH` · `0/1 passed` (`exit 1`) | **FAIL** (در محیط ایزوله؛ نیازمند Anvil nightly با پچ Nitro `#16514` و RPC عمومی) | [run 34177829312](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34177829312) (۲۰۲۶-۰۹-۰۸؛ انکر قدیمی ۳۱/۳۱، پیش از assertionهای جدید) |
| **Lido · Ethereum (`1`) · ETH/stETH/wstETH** | `ETHEREUM_RPC_URL=https://eth.llamarpc.com node test/lido-mainnet-fork-probe.mjs --strict` | `FAIL Anvil is available (--strict) — anvil not found on PATH` · `0/1 passed` (`exit 1`) | **FAIL** (در محیط ایزوله؛ نیازمند Anvil و RPC آرشیوی عمومی برای `eth_getLogs`) | [run 34300888545](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34300888545) (۲۰۲۶-۰۹-۰۹؛ انکر قدیمی ۲۰/۲۰، پیش از assertionهای جدید) |
| **Morpho Blue · Base (`8453`) · USDC/cbBTC** | `BASE_RPC_URL=https://mainnet.base.org node test/morpho-base-fork-probe.mjs --strict` | `FAIL Anvil is available (--strict) — anvil not found on PATH` · `0/1 passed` (`exit 1`) | **FAIL** (در محیط ایزوله؛ عدم دسترسی به `anvil` و RPC عمومی) | [run 34306859437](https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/34306859437) (۲۰۲۶-۰۹-۰۹؛ انکر قدیمی ۲۲/۲۲، پیش از assertionهای جدید) |

> **نکتهٔ صداقت شواهد:** هیچ‌یک از فایل‌های `farm-fork-evidence/*.json` دست‌کاری یا جعل نشده‌اند و تا زمانی که صاحب مخزن ۴ ورک‌فلوی آماده در تب GitHub Actions (`Compound Base fork probe`، `Aave Arbitrum fork probe`، `Lido mainnet fork probe` و `Morpho Base fork probe`) را روی شاخهٔ `main` اجرا نکند و خروجی لاگ واقعی را با `node scripts/record-farm-fork-evidence.mjs <protocol> <logfile>` ثبت نکند، وضعیت strict جدید این ۴ پروتکل در این سند **FAIL (اجرانشده روی Anvil + RPC زنده با نسخهٔ فعلی پروب)** باقی می‌ماند و همهٔ فلگ‌های ورود سرمایه خاموش می‌مانند.

## وضعیت production

تا وقتی این سه مورد با هم موجود نباشند، public capital خاموش می‌ماند:

1. PASS واقعی strict fork برای همان protocol؛
2. allowlist عمومی و غیرخالی با رضایت صاحب wallet؛
3. canary کوچک و کامل شامل supply، proof و withdraw کامل.

وب و APK می‌توانند live و سالم باشند در حالی که money-in عمداً خاموش است. چنین وضعیتی production-safe است، اما «production-ready برای ورود سرمایه عمومی» نیست.
