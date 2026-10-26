# Split Router — کارمزدِ واریز بدون نگهداری پول

> پرسشی که این قرارداد پاسخش است:
>
> «میخواهیم کارمزد بگیریم اما پول دست ما نباشد»

قرارداد: [`contracts/FBTSplitRouter.sol`](../contracts/FBTSplitRouter.sol) ·
آرتیفکت کامپایل‌شده: `src/lib/splitRouterArtifact.json` ·
درز سمت کلاینت: [`src/lib/defi/splitRouter.js`](../../src/lib/defi/splitRouter.js)

---

## یک پاراگراف

پنج مسیر اجرایی فارم (Aave Base، Aave Arbitrum، Compound III Base، Morpho Blue Base، Lido) امروز پول کاربر را **مستقیم از کیف خودش به پروتکل** می‌فرستند — و دقیقاً به همین دلیل برای ما درآمدی ندارند. SplitRouter یک کارمزد کوچک (پیش‌فرض ۰٫۳٪، سقف سخت ۱٪) از **مبلغ ورودی** برمی‌دارد و بقیه را **در همان یک تراکنشِ امضاشده توسط خود کاربر**، به نام خودِ او، به همان پروتکل پین‌شده می‌رساند:

```
USDC/ETH کاربر ──┬── کارمزد (feeBps) ──→ کیف پرداخت ما (feeRecipient)
                 └── مبلغ خالص ───────→ پروتکل، به نام خود کاربر
                                        (aUSDC / سهم Comet / سهم Morpho / stETH → کیفِ خودش)
```

برداشت **هرگز** از این قرارداد نمی‌گذرد؛ مسیر خروج دقیقاً همان امروز باقی می‌ماند: مستقیم از پروتکل به کیف کاربر، بدون کارمزد.

## چرا این «پول دست ما نیست» است

این ادعا مهندسی‌شده و روی زنجیره قابل تأیید است، نه شعار:

| تضمین | چطور |
|---|---|
| قرارداد بین تراکنش‌ها هیچ موجودی ندارد | هر مسیر با `require(balance == 0)` تمام می‌شود (`ASSET_STUCK` / `ETH_STUCK`) — ریهرسال همین را assert می‌کند |
| سهم‌ها هرگز به روتر نمی‌رسد | `onBehalfOf` در کد **اجباراً** `msg.sender` است؛ سهم Compound و stETH همان تراکنش به کاربر transfer می‌شود |
| هیچ کلید مدیریتی وجود ندارد | صفر admin: بدون owner، بدون `setFeeBps`، بدون rescue، بدون upgrade — پروب ABI همین را assert می‌کند |
| بعد از استقرار هیچ‌چیز عوض نمی‌شود | feeBps و feeRecipient و همه مقصدها **immutable** هستند؛ تغییر کارمزد = قرارداد جدید + تأیید مجدد کاربران |
| مقصد قابل تغییر نیست | هر پروتکل آدرس immutable پین‌شده دارد؛ `forward()` عمومی وجود ندارد |
| مارکت Morpho قابل جابه‌جایی نیست | پنج پارامتر مارکت immutable است و constructor با keccak ثابت می‌کند دقیقاً همان مارکتی است که آداپتور اپ پین کرده |
| کارمزد سقف دارد | `MAX_FEE_BPS = 100` (۱٪) داخل قرارداد — همان سقفی که `src/lib/feeBps.js` سمت کلاینت دارد |
| ETH لخت نمی‌ماند | `receive()` وجود ندارد؛ تنها ورودی payable، `stakeLido()` است که همه‌چیز را همان تراکنش فوروارد می‌کند |

هزینهٔ آگاهانهٔ این طراحی: توکنی که اشتباهی به قرارداد فرستاده شود برای همیشه می‌ماند. برای مسیر پول، این درست‌ترین معامله است — «owner که می‌تواند از قرارداب پول بیرون بکشد» یعنی honeypot. (FeeRouter سمت سواپ تصمیم معکوس گرفته؛ اینجا استاندارد سخت‌گیرانه‌تر است.)

## مرز با والات مورفو

کارت «خزانه FBT USDC» (`src/lib/vault.js`) کارمزد **تکرارشونده** داخلی خودش را دارد و عمداً از این روتر جداست: ورود به والات مستقیم است تا دو کارمزد روی هم نیفتد — درآمد والات از کارمزد عملکرد on-chain می‌آید، نه از ۰٫۳٪ ورودی. روتر فقط پنج مسیر واریز مستقیمِ فارم را کارمزدی می‌کند.

## پیکربندی هر شبکه (مقادیر پین‌شده، آینهٔ آداپتورها)

| فیلد Config | Base (8453) | Arbitrum (42161) | Ethereum (1) |
|---|---|---|---|
| `asset` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC) | USDC بومی آربیتروم | — (مسیر توکنی ندارد) |
| `aavePool` | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0x0` |
| `comet` | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | `0x0` | `0x0` |
| `morpho` + پارامترهای مارکت | Morpho Base + مارکت cbBTC پین‌شدهٔ `morphoBlueBase.js` | `0x0` | `0x0` |
| `lido` | `0x0` | `0x0` | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` |
| `feeRecipient` | آدرس payout (همان `VITE_PAYOUT_*`) | همان | همان |
| `feeBps` | مثلاً `30` (۰٫۳٪) — هر عددی ≤ 100 | همان | همان |

روی اتریوم استقرار فقط-Lido مجاز است و constructor دارایی توکنی نمی‌خواهد (`asset = 0x0`).

## نقشهٔ اجرا (به همین ترتیب — هیچ مرحله‌ای حذف نمی‌شود)

1. **کامپایل و تست رفتاری (هر جا Node هست):**
   ```bash
   npm run test:split-router
   ```
   = کامپایل با `solc 0.8.24` + پروب سطح ABI (`10/10` assertion، از جمله «صفر-admin» و پین selectorها) + ریهرسال EVM محلی با ganache (`42/42` assertion روی همان bytecode تولیدی، شامل هر سه شکل استقرار واقعیِ Base، Arbitrum فقط-Aave و Ethereum فقط-Lido، تقسیم دقیق کارمزد، موجودی صفرِ روتر در پایان هر مسیر، `ZERO_TARGET` روی توابع غایب هر شبکه، و همهٔ ۷ گارد constructor) + ۲۶ تست واحد و یکپارچگی کلاینت (`test/split-router-defi.test.js`).
2. **ریهرسال fork سه‌شبکه‌ای (mainnet-state، با anvil — دروازهٔ پیش از ممیزی):**
   ```bash
   curl -L https://foundry.paradigm.xyz | bash && foundryup --install nightly
   BASE_RPC_URL=https://mainnet.base.org \
   ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc \
   ETH_RPC_URL=https://ethereum-rpc.publicnode.com \
     npm run test:split-router-fork -- --strict
   ```
   همان آرتیفکت تولیدی، روی fork واقعی **هر سه شبکهٔ مقصد** (Base `8453` با Aave/Comet/Morpho واقعی، Arbitrum One `42161` با Aave native-USDC واقعی، و Ethereum `1` با Lido واقعی) به همراه تطبیق آن‌چین `PoolAddressesProvider.getPool()` و `UNDERLYING_ASSET_ADDRESS()` پیش از استقرار. در حالت `--strict` هر سه متغیر `BASE_RPC_URL`، `ARBITRUM_RPC_URL` و `ETH_RPC_URL` باید صراحتاً ست باشند و نبود `anvil` یا رد شدن هر گارد معادل **FAIL** قطعی (`exit 1`) است. قالب آمادهٔ اجرای یک‌کلیکی روی GitHub Actions در `ci/split-router-fork-rehearsal.yml` (با `foundry-toolchain` نسخهٔ `nightly` جهت پشتیبانی از Arbitrum Nitro `#16514`) قرار داده شده است.
3. **ممیزی امنیتی مستقل (مرز هزینه‌دار — متوقف در همین نقطه بدون مجوز و بودجه).** فیلد `audited: false` آرتیفکت را فقط دستی و بعد از گزارش ممیزی واقعی عوض کنید. تا آن موقع هیچ آدرسی در env نگذارید.
4. **استقرار هر شبکه** با Config بالا (از حساب payout/دپلوی، نه از کلید کاربران). آدرس قرارداد را در این جدول ثبت و در explorer وریفای کنید.
5. **فعال‌سازی در اپ:** فقط `VITE_FBT_SPLIT_ROUTER_BASE` / `_ARBITRUM` / `_ETHEREUM` را ست کنید. پنل‌ها **وصل شده‌اند**: هر ۵ پنل (Aave Base/Arb، Compound، Morpho، Lido) پلن واریز را از `routeSupplyPlan` عبور می‌دهند، قبل از امضا سطر «کارمزد واریز: X از Y (Z٪) … برداشت همیشه بدون کارمزد است» را نشان می‌دهند، و receipt را دو-لایه (رویداد `Routed` + رویداد خودِ پروتکل با مبلغ خالص به نام مالک) اثبات می‌کنند. برداشت/خروج/claim هیچ‌وقت از روتر نمی‌گذرند.
6. **در صورت مشکل:** env را خالی کنید. مسیر واریز همان لحظه به واریز مستقیم امروز برمی‌گردد؛ برداشت‌ها از اول هم مستقیم بودند. کارمزد از خود قرارداد برداشت می‌شود چون feeRecipient است و سهمش را در همان تراکنش‌ها گرفته.

## بستهٔ فریز تا مرز ممیزی و گزارش اجرای `--strict` (`2026-10-26`)

### ۱. مشخصات فریز آرتیفکت جهت تحویل به ممیز خارجی
- **فایل منبع:** `contracts/FBTSplitRouter.sol` — هش SHA-256: `12c54c3802770ba7a41f8e881d262c2cd04b100364993a813088b8b312b5c9b8`
- **آرتیفکت کامپایل‌شده:** `src/lib/splitRouterArtifact.json` — هش SHA-256: `80cf4d53e3cd1046c55b7e1dccbcdb1327447bee59a3452b92fe9243239354a7`
- **کامپایلر و بهینه‌ساز:** `solc 0.8.24` (`optimizer.enabled = true`, `runs = 200`)، طول deployed bytecode برابر `7166` بایت (زیر سقف EIP-170 یعنی `24576` بایت)، وضعیت `audited: false` دست‌نخورده.
- **وضعیت متغیرهای محیطی:** `VITE_FBT_SPLIT_ROUTER_BASE`، `VITE_FBT_SPLIT_ROUTER_ARBITRUM` و `VITE_FBT_SPLIT_ROUTER_ETHEREUM` همگی **خالی (`OFF`)** هستند.

### ۲. نتیجهٔ اجرای تست‌ها و ریهرسال `--strict` در تاریخ `2026-10-26`

| لایهٔ آزمون | فرمان اجراشده | نتیجه | جزئیات و شواهد |
| :--- | :--- | :--- | :--- |
| کامپایل + پروب ABI | `node scripts/compile-split-router.mjs && node test/split-router/split-router-contract-probe.mjs` | **PASS (`10/10`)** | اثبات صفر-admin، نبود `receive()`، سقف کامپایل‌شدهٔ `MAX_FEE_BPS = 100` و تطابق selectorهای چهار پروتکل. |
| ریهرسال رفتاری EVM محلی (Ganache) | `node test/split-router/split-router-evm-rehearsal.mjs` | **PASS (`42/42`)** | پوشش هر سه شکل استقرار واقعی (`Base` چهارمسیره بدون Lido، `Arbitrum` فقط-Aave، `Ethereum` فقط-Lido بدون `asset`)، اثبات موجودی صفر روتر، `ZERO_TARGET` روی مسیرهای غایب، و هر ۷ گارد constructor (`ZERO_ASSET`, `ZERO_FEE_RECIPIENT`, `FEE_TOO_HIGH`, `NO_TARGET`, `MORPHO_LOAN_TOKEN_MISMATCH`, `MORPHO_MARKET_INCOMPLETE`, `MORPHO_MARKET_ID_MISMATCH`). گزارش: `test/split-router/split-router-rehearsal-report.json`. |
| یکپارچگی کلاینت و پنل‌ها | `npx vitest run test/split-router-defi.test.js` | **PASS (`26/26`)** | بازنویسی پلن برای هر ۵ آداپتور، ۳ حالت allowance، افشای کارمزد پیش از امضا، و اثبات receipt دولایه. |
| ریهرسال fork سه‌شبکه‌ای (`--strict`) در سندباکس محلی | `BASE_RPC_URL=https://mainnet.base.org ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc ETH_RPC_URL=https://ethereum-rpc.publicnode.com npm run test:split-router-fork -- --strict` | **FAIL (`0/1` — `EXIT=1`)** | با قانون سخت‌گیرانهٔ `SKIP = FAIL`: باینری `anvil` روی `PATH` سندباکس نصب نیست و egress خروجی سندباکس به `release-assets.githubusercontent.com` و اندپوینت‌های JSON-RPC عمومی مسدود است (`curl` exit `35`). بدون RPC صریح نیز اسکریپت با `missing BASE_RPC_URL, ARBITRUM_RPC_URL, ETH_RPC_URL` (`EXIT=1`) بسته می‌شود. هیچ گزارش جعلی `split-router-fork-rehearsal-report.json` ساخته نشد. |

### ۳. تنها گام رایگان پیش از تحویل به ممیز (برای مالک مخزن روی GitHub Actions)
1. فایل آمادهٔ `ci/split-router-fork-rehearsal.yml` را یک بار دستی در `.github/workflows/split-router-fork-rehearsal.yml` قرار دهید.
2. از تب **Actions → SplitRouter 3-chain fork rehearsal → Run workflow** اجرا را بزنید تا روی رانر رایگان GitHub با `foundry-toolchain@nightly` هر سه fork (Base + Arbitrum + Ethereum) با `--strict` اجرا و آرتیفکت `split-router-fork-rehearsal-report.json` تولید شود.
3. از آن نقطه به بعد کار دقیقاً روی **مرز هزینه‌دار (ممیزی خارجی قرارداد + گاز استقرار روی ۳ شبکه)** قرار دارد و بدون مجوز صریح مالک ادامه داده نمی‌شود.

## وضعیت فعلی (صادقانه)

- قرارداد **نوشته و کامپایل شده**، ریهرسال رفتاری آن روی EVM محلی برای هر سه شکل استقرار شبکه **PASS کامل** است (`42/42`)، پروب ABI سبز است (`10/10`)، و تست‌های واحد/یکپارچگی کلاینت سبزند (`26/26`).
- **پنل‌ها وصل شده‌اند** (تست receipt دو-لایه در هر ۴ آداپتور + تست‌های `routeSupplyPlan` برای هر سه حالت allowance). تا وقتی env خالی است، همه‌چیز همان واریز مستقیم امروز است — fail-open با همان مرجعِ پلن.
- اسکریپت ریهرسال fork سه‌شبکه‌ای (`test/split-router/split-router-fork-rehearsal.mjs`) و ورک‌فلوی CI آن (`ci/split-router-fork-rehearsal.yml`) برای هر سه شبکهٔ Base، Arbitrum و Ethereum تکمیل شده‌اند؛ اجرای محلی `--strict` در سندباکس فعلی به دلیل نبود `anvil` و محدودیت egress شبکه طبق قانون `SKIP = FAIL` برابر **FAIL (`0/1`)** ثبت شد و باید پیش از ممیزی روی رانر GitHub Actions سبز شود.
- **ممیزی نشده (`audited: false`).** تا ممیزی مستقل + استقرار، هیچ env ای ست نیست و رفتار اپ بایت‌به‌بایت همان امروز است.
- هیچ‌کدام از آداپتورها، پنل‌ها یا gateهای موجود تغییر نکرده‌اند.

## چیزهایی که عمداً وجود ندارند

- **کارمزد برداشت** — خروج همیشه مستقیم و رایگان؛ کارمزد فقط روی ورود.
- **owner / rescue / setFeeBps** — صفر-admin، برای همیشه.
- **forward عمومی یا allowlist قابل‌تغییر** — مقصدها immutable و per-chain اند.
- **چند-دارایی** — هر استقرار یک asset پین‌شده؛ دارایی جدید = استقرار جدید (سطح ممیزی کوچک‌تر).
- **hook یا referral** — `referralCode = 0` (برنامهٔ ارجاع Aave غیرفعال است)، Morpho بدون hooks، Lido با referral صفر.
