# FBT Wallet Engine — معماری Wallet Core و ده موتور اولویت‌دار

> این سند پیاده‌سازیِ «معماری Backend / Wallet Engine» است که در پیام شما آمد.
> طبق خواستهٔ شما، **هیچ تغییری در UI فعلی داده نشده است** — نه یک دکمه، نه یک
> استایل. همهٔ کار در یک لایهٔ خالص و تست‌پذیر انجام شده که بعداً (وقتی تصمیم
> گرفتید) به‌صورت تدریجی به صفحهٔ Wallet وصل می‌شود.

---

## ۱) چه چیزی ساخته شد و کجا

| مسیر | محتوا |
|---|---|
| `src/lib/wallet-engine/` | ۲۱ ماژول خالص (بدون شبکه، بدون DOM، بدون SDK کیف پول) |
| `test/wallet-engine-probe.mjs` | ۷۶ ادعای قفل‌شده روی رفتار موتورها |
| `docs/WALLET-ENGINE-FA.md` | همین سند |
| `docs/WALLET-ENGINE.md` | نسخهٔ کوتاه انگلیسی |

اجرای تست مستقل:

```bash
npm run test:wallet-engine      # فقط موتور کیف پول (۷۶/۷۶)
```

تست داخل سوئیت کامل هم اضافه شده (در `test/run.mjs`) و با `npm test` اجرا می‌شود.

---

## ۲) معماری — دقیقاً همان درختی که پیشنهاد کردید

```
                    Wallet Core
                        │
              Wallet Orchestrator   ← orchestrator.js
                        │
       ┌────────────────┼────────────────┐
       │                │                │
   EVM Adapter      Solana Adapter    BTC Adapter   ← adapters.js
       │                │                │
   EVM Chains          Solana         Bitcoin
       │
   WalletConnect   ← sessionManager.js
```

و روی آن:

```
Wallet Core
│
├── Balance Engine       ← balanceEngine.js      (تجمیع EVM + Solana + BTC)
├── Asset Resolver       ← assetResolver.js      (USDC در همهٔ شبکه‌ها)
├── Transaction Engine   ← orchestrator.js       (prepare→sign→broadcast)
├── Simulation Engine    ← simulationEngine.js   (پیش‌نمایش + ریسک قرارداد)
├── P&L Engine           ← costBasisEngine.js    (FIFO، Realized/Unrealized)
├── Portfolio Engine     ← portfolioEngine.js    (Allocation، Concentration)
├── Security Engine      ← securityEngine.js     (آدرس/قرارداد/توکن/رفتار)
├── Approval Engine      ← approvalManager.js    (Unlimited detection، Revoke)
├── Notification Engine  ← notifications.js      (الگوهای i18n)
├── Automation Engine    ← automationEngine.js   (اگر ETH < X → Alert)
├── Address Book         ← addressBook.js        (EVM/Solana/BTC + تشخیص شبکه)
├── Indexer              ← indexer.js            (Unified Indexer)
└── (Tracker)            ← tracker.js            (Real-Time، آمادهٔ WebSocket)
```

هر ماژول یک فایل مستقل است و می‌توان آن را **جداگانه** import کرد یا از طریق
`src/lib/wallet-engine/index.js` همه را یک‌جا گرفت.

---

## ۳) Wallet Capability Engine — «کدام Wallet برای کدام عملیات؟»

فایل: `capabilities.js`

سیستم دیگر فرض نمی‌کند هر کیف پولی همه‌کاره است. هر کیف پول یک مجموعهٔ
قابلیت صریح دارد و انتخاب کیف پول، **فیلتر سخت** روی خانوادهٔ زنجیره است —
نه امتیاز نرم:

```js
declareWallet({ id: 'solana-main', family: 'solana', address: '...' })
// capabilities: send, receive, swap, stake, sign_message, sign_transaction, watch

declareWallet({ id: 'btc-main', family: 'bitcoin', address: 'bc1q...' })
// capabilities: send, receive, watch   ← و بس
```

- `FAMILY_CAPABILITIES` سقفِ صادقانهٔ هر خانواده است؛ کیف پول فقط می‌تواند
  **کمتر** اعلام کند (مثلاً watch-only بدون `send`)، هرگز بیشتر.
- `selectWalletFor({ capability, family, chainId })` یا بهترین کیف پول را
  برمی‌گرداند یا `NO_CAPABLE_WALLET`. درخواست «استیک روی بیت‌کوین» هرگز به
  کیف پول EVM نمی‌افتد.
- `hasCapability` / `missingCapabilities` / `capabilityGaps` برای چک‌های قبل
  از امضا.

### مثال از رفتار واقعی (در تست قفل شده)

```
bitcoin wallet: send + receive — بدون swap / stake / approve
evm wallet:     send, receive, swap, approve, revoke, stake, bridge, …
selectWalletFor(stake, family=bitcoin)  → NO_CAPABLE_WALLET
selectWalletFor(send,  family=solana)   → کیف پول Solana (نه EVM)
```

---

## ۴) Wallet State Machine — جلوگیری از «تأیید شد ولی اجرا نشد»

فایل: `walletStateMachine.js`

```
CREATED → CONNECTED → READY → ACTION_PREPARED → AWAITING_SIGNATURE
        → SIGNED → BROADCASTED → PENDING → CONFIRMED
```

خطاها: `FAILED` · `CANCELLED` · `EXPIRED`

هر پله یک **دروازهٔ شواهد** دارد. بدون شواهد، انتقال رد می‌شود:

| حالت | شواهد لازم |
|---|---|
| `CONNECTED` | آدرس |
| `READY` | حداقل یک اکانت |
| `ACTION_PREPARED` | توصیف عملیات |
| `SIGNED` | امضا یا payload امضاشده |
| `BROADCASTED` | **هش تراکنش** |
| `PENDING` | هش تراکنش |
| `CONFIRMED` | **رسیپت موفق** |

نتیجه‌های قفل‌شده در تست:

- `SIGNED` بدون هش نمی‌تواند `CONFIRMED` شود — فقط `BROADCASTED` (با هش) یا `FAILED`.
- `BROADCASTED` بدون `txHash` رد می‌شود (`TX_HASH_REQUIRED`). این دقیقاً همان
  باگ «تأیید شد ولی اجرا انجام نشد» است که در Intent OS دیدید؛ این‌جا
  **ساختاری** غیرممکن شده است.
- `CONFIRMED` بدون رسیپت موفق، `FAILED` با دلیل `NO_RECEIPT` می‌شود — موفقیتِ
  جعلی وجود ندارد.
- از `CONFIRMED` دیگر نمی‌شود به `FAILED` برگشت (برگشت‌ناپذیریِ موفقیت).

`orchestrator.js` این ماشین را با Registry و Capability Engine به هم وصل می‌کند:
اول قابلیت چک می‌شود (قبل از اینکه از کاربر امضا خواسته شود)، بعد پله‌به‌پله
با شواهد جلو می‌رود.

---

## ۵) ده موتور اولویت‌دار — وضعیت هر کدام

### ۱. Transaction Simulation — `simulationEngine.js`
- `simulateOutcome(...)`: مقدار دریافتی، هزینهٔ Gas به دلار، تغییر موجودی،
  price-impact — به‌صورت محاسبات خالص.
- `mergeSimulation(...)`: نتیجهٔ `eth_call` واقعی (از `preSignSimulation.js` که
  قبلاً در پروژه هست) را با محاسبات ترکیب می‌کند. `provider-busy` یعنی
  «شبیه‌سازی اجرا نشد» → دروازهٔ امضا **بسته** می‌ماند.
- `contractRisk(...)`: ریسک قرارداد مقصد (honeypot، unverified، holders کم،
  سن کم). بدون داده → `unknown`، نه «امن».

### ۲. Smart Asset Resolver — `assetResolver.js`
- «USDC من را نشان بده» → همهٔ شبکه‌هایی که USDC دارند (EVM هر chain + Solana)
  با قرارداد/mint درست.
- آدرس EVM / Solana / Bitcoin را تشخیص می‌دهد و تطبیقِ آدرس فقط **دقیق** است
  (تطبیق پیشوندی عمداً ارائه نمی‌شود؛ راه فیشینگ را می‌بندد).
- کاتالوگ EVM از `chains.js` تزریق می‌شود؛ `catalog.js` فقط بذر Solana/BTC را
  دارد (با یادداشت «همگام بمانید»).

### ۳. Unified Indexer — `indexer.js`
- EVM / Solana / Bitcoin → یک رکورد `fbt.tx.v1`.
- `ingest` idempotent است (تکرار همان tx دو بار ذخیره نمی‌شود).
- `query` با فیلتر family / chain / address / asset / kind، و `history` یکجا.
- بدون هش، ثبت رد می‌شود (`HASH_REQUIRED`) — نه ثبتِ بی‌هویت.

### ۴. Wallet Capability Engine — `capabilities.js`
(بالا توضیح داده شد — بخش ۳)

### ۵. Wallet State Machine — `walletStateMachine.js`
(بالا توضیح داده شد — بخش ۴)

### ۶. Approval Manager — `approvalManager.js`
- روی `approvalHygiene.js` (فاز ۸۳ موجود) بنا شده: طبقه‌بندی exact / bounded /
  `UNLIMITED`، تشخیص `MaxUint256`، ریسک، stale بودن.
- `scanApprovals`: خروجی مرتب‌شده — approvals نامحدود و پرریسک **اول** می‌آیند،
  نه ته لیست. خلاصهٔ per-chain و `revoke plan` برای هر ردیف.

### ۷. Security / Risk Engine — `securityEngine.js`
- `assessRecipient`: آدرس تازه / قرارداد / بدون checksum / بلاک‌لیست.
- `assessToken`: honeypot / unverified / امتیاز اسکنر.
- `assessTransfer`: ترکیب هر دو + ریسک approval در یک verdict؛ `level=high` یعنی blocked.
- `detectUnusualBehavior`: شلیک سریع، تراکنش بزرگ، «اولین اقدام، مبلغ بزرگ»، fan-out.

### ۸. Cost Basis + P&L — `costBasisEngine.js`
- تفکیک `Buy / Sell / Swap / Transfer / Deposit / Withdrawal`.
- لات‌های FIFO با هزینهٔ شامل کارمزد؛ فروش فقط واحدِ واقعاً خریداری‌شده را
  مصرف می‌کند و P&L محقق‌شده تولید می‌کند.
- انتقال بین کیف پول‌های خودی P&L نمی‌سازد (جابه‌جایی حضانت است، نه فروش).
- فروش بیشتر از موجودی، `overSold` می‌شود نه لات منفی.

### ۹. Wallet Automation Engine — `automationEngine.js`
- `PRICE_LT / PRICE_GT / BALANCE_LT / BALANCE_GT / PNL_GT / PNL_LT / LARGE_TX`.
- «اگر ETH < X → Alert» دقیقاً یک ردیف است.
- دادهٔ گم‌شده → `dataMissing`، هرگز «شرط برقرار نشد»؛ قانون ناشناخته → `UNKNOWN_RULE`.

### ۱۰. Real-Time Transaction Tracker — `tracker.js`
- `Prepared → Signed → Broadcast → Pending → Confirmed` + `Failed/Cancelled/Expired`.
- `subscribe/emit/timeline` خالص و همگام؛ وصل‌کردن به WebSocket/SSE یک آداپتور
  یک‌خطی است (عمداً transport-agnostic).

---

## ۶) هشت قابلیتِ دیگر (خارج از ده‌تای اولویت، ولی در معماری حاضر)

| قابلیت | فایل | خلاصه |
|---|---|---|
| Universal Balance Engine | `balanceEngine.js` | نرمال‌سازی + تجمیع + ارزش‌گذاری (بدون اختراع قیمت) |
| Smart Gas Manager | `gasManager.js` | کافی/ناقص/نامعلوم + مقدار کسری + Gas Abstraction |
| Smart Portfolio Engine | `portfolioEngine.js` | Allocation، Concentration، Performance |
| Transaction Intelligence | `intelligence.js` | Swap/Send/Receive/Approve/Bridge/Stake/LP از روی calldata و رویدادها |
| Smart Address Book | `addressBook.js` | نام‌گذاری + recent/frequent + تشخیص شبکهٔ اشتباه |
| WalletConnect Session Manager | `sessionManager.js` | sessionها، chainها، permissions، expiry، disconnect |
| Recurring Transactions | `recurring.js` | DCA / انتقال / پرداخت / سرمایه‌گذاری دوره‌ای + nextDue |
| Smart Notifications | `notifications.js` | الگوهای i18n برای رویدادهای مشخص‌شده |
| Multi-Wallet Manager | `registry.js` | EVM۱، EVM۲، Solana، BTC، External — یک رجیستری |

---

## ۷) قوانین صداقت (در سراسر موتور)

این‌ها را از سبک موجود پروژه قرض گرفته‌ام و در هر فایل تکرار شده:

1. **دادهٔ گم‌شده ≠ صفر و ≠ امن.** قیمت ناموجود → `valueUsd: null` و مجموعِ
   «ناقص» گزارش می‌شود، نه مجموعِ کمتر.
2. **شواهد، دروازهٔ موفقیت است.** بدون هش → بدون broadcast؛ بدون رسیپت → بدون
   confirmed.
3. **هرگز حدسِ اشتباه به‌جای «نمی‌دانم».** انتخاب کیف پول بدون نامزد مناسب
   `NO_CAPABLE_WALLET` می‌دهد، نه نزدیک‌ترین گزینه.
4. **پیام‌ها کلید i18n هستند، نه جملهٔ سخت‌کدشده.** تا ۱۱ زبانِ موجود مسئول
   متن بمانند.
5. **هیچ‌کدام از این‌ها خودش تراکنش نمی‌فرستد.** امضا و broadcast فقط از
   اورکستراتور با شواهد عبور می‌کند.

---

## ۸) چه چیزهایی هنوز «اتصال» می‌خواهند (و چرا الان نه)

این لایه عمداً **خالص** است؛ یعنی هنوز به `WalletContext.jsx` یا صفحهٔ Wallet
وصل نشده. اتصال، تغییر UI محسوب می‌شود که شما گفتید دست نزنیم. وقتی خواستید،
نقشهٔ اتصال به این شکل است (هر کدام جدا و کم‌ریسک):

1. **Registry + State Machine در Context**: به‌جای متغیرهای پراکندهٔ اتصال،
   کیف پول‌ها در `createWalletRegistry` ثبت و با اورکستراتور جابه‌جا شوند.
2. **Balance Engine**: خروجی `useWalletBalances` به `aggregateBalances` داده شود.
3. **Asset Resolver**: ایندکس از `TOKENS` (chains.js) + mints سولانا ساخته شود
   و به کادر «USDC من را نشان بده» وصل شود.
4. **Approval/Security**: داده‌های واقعی allowance و اسکنر تزریق شوند
   (الگوریتم از قبل هست).
5. **Tracker/Indexer**: یک حافظهٔ مشترک یا endpoint سرور برای سابقهٔ یکپارچه.

همهٔ این‌ها در سمت منطق هستند و می‌توان بدون دست‌زدن به چیدمان صفحه انجام شوند.

---

## ۹) جمع‌بندی

- **UI دست‌نخورده ماند.** صفر تغییر در کامپوننت‌ها و استایل‌ها.
- **معماری پیشنهادی شما پیاده شد** (Core → Orchestrator → Adapters + موتورها).
- **هر ۱۰ قابلیت اولویت‌دار** به‌صورت موتور خالص پیاده و تست شد (۷۶ ادعا).
- **۸ قابلیت دیگر** هم در قالب ماژول‌های کوچک حاضرند تا معماری ناقص نماند.
- لایه کاملاً قابل تست است: `npm run test:wallet-engine` بدون شبکه و بدون DOM.

گام بعدیِ طبیعی (وقتی بگویید): اتصال تدریجیِ همین موتورها به WalletContext،
بدون تغییر ظاهر.
