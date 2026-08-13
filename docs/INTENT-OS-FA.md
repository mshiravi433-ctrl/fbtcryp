# معماری FBT Intent OS — از DEX تا لایه اجرای مالی

> وضعیت سند: معماری محصول + MVP پیاده‌شده در این مخزن  
> نسخه پروتکل: `fbt.intent.v1`  
> نسخه رسید اجرا: `fbt.execution-proof.v1`

## تصمیم اصلی

مسیر درست این نیست که هفت قابلیت مستقل و نمایشی کنار Swap اضافه شوند. این هفت ایده باید روی یک ستون فقرات مشترک ساخته شوند:

```text
Intent
  → Policy / Risk Engine
  → Solver Discovery
  → Comparable Quotes
  → Simulation
  → User Signature
  → Settlement
  → Execution Receipt
```

در این معماری، **AI صاحب پول نیست**. AI فقط می‌تواند متن را توضیح دهد یا یک Intent ساختاریافته پیشنهاد کند. فیلدهای ساختاریافته، سقف‌ها، Wallet signature و قراردادها مرجع اجرای واقعی‌اند.

---

## چیزی که اکنون واقعاً پیاده شده است

### ۱. صفحه مرکزی Intent OS

مسیر جدید:

```text
/#/intent
```

دکمه مرکزی اپ مستقیماً این صفحه را باز می‌کند. صفحه چهار بخش دارد:

1. **Compose** — ساخت Intent با فیلدهای قطعی
2. **Memory** — ترجیحات و محدودیت‌های محلی
3. **Proofs** — آرشیو رسیدهای اجرای واقعی
4. **Network** — قابلیت‌های زنده و Roadmap شبکه Solver

چهار نوع Intent تعریف شده:

| نوع | وضعیت فعلی | رفتار صادقانه |
|---|---|---|
| Swap | قابل تحویل به صفحه Swap | بازبینی و امضای کاربر الزامی است |
| Outcome | Draft-only | تا اتصال Solverهای وثیقه‌دار اجرا نمی‌شود |
| Automation | قابل تحویل به Orders | فقط پایش/اعلان؛ امضای نهایی با کاربر |
| Workflow | Draft-only | مراحل مدل می‌شوند ولی اتمیک جا زده نمی‌شوند |

### ۲. موتور Risk قطعی

`src/lib/intentOS.js` این موارد را پیش از هر Handoff بررسی می‌کند:

- سقف Slippage شخصی
- سقف ارزش هر Intent
- Quiet hours بر اساس ساعت محلی
- الزام self-custody
- الزام امضای نهایی
- درخواست Receipt
- وضعیت واقعی حریم خصوصی
- موجود بودن Adapter لازم

خروجی Risk Engine یکی از این دو حالت است:

- `ready-for-review`: فقط اجازه رفتن به صفحه بازبینی؛ نه اجرا
- `draft-only`: ذخیره محلی بدون دکمه اجرای گمراه‌کننده

### ۳. Memory Wallet بدون پروفایل‌سازی سرور

ترجیحات زیر فقط روی همان دستگاه ذخیره می‌شوند:

- شبکه ترجیحی
- حداکثر Slippage
- آستانه مبلغ برای نیاز به Private handling
- سقف هر Intent
- ساعات ممنوع معامله
- الزام Proof-of-Execution

**نکته امنیتی:** این Memory یک قرارداد Account Abstraction نیست. کسی که Seed را در کیف دیگری داشته باشد می‌تواند این قوانین را دور بزند. UI این محدودیت را مخفی نمی‌کند.

### ۴. Trace واقعی رقابت Quoteها

Quote engine قبلاً KyberSwap، OpenOcean و Velora را موازی بررسی می‌کرد، ولی فقط تعداد Routeها را نگه می‌داشت. اکنون برای هر دور Quote یک Trace کم‌حجم ساخته می‌شود:

- نام Solver
- پاسخ/خطا
- زمان پاسخ
- قابلیت اجرا
- Amount out
- Min out
- Fee bps
- Slippage
- Gas USD، فقط اگر منبع واقعاً داده باشد
- تعداد Hop

Calldata، آدرس کیف و RouteSummary بزرگ در Trace رسید ذخیره نمی‌شوند.

### ۵. Proof-of-Execution Receipt بعد از تراکنش واقعی

پس از تأیید Swap روی زنجیره، اپ یک سند canonical می‌سازد و SHA-256 آن را محاسبه می‌کند. سند شامل این چهار لایه است:

1. Constraints کاربر
2. Solver responseهای مشاهده‌شده
3. Selection policy و Route انتخابی
4. Tx hash، chain، block و gas used

ادعای دقیق رسید:

> بهترین پاسخ قابل‌اجرا در میان پاسخ‌های قابل‌استفاده‌ای که در همان دور Quote و با Fee/Slippage یکسان مشاهده شدند.

رسید **ادعا نمی‌کند**:

- بهترین Route کل جهان بوده؛
- Solver خاموش Quote بهتری نداشته؛
- تراکنش حتماً Confidential بوده؛
- MEV یا Gas نامشخص را صرفه‌جویی کرده؛
- این سند ZK proof یا امضای FBT است.

اگر Savings قابل‌اندازه‌گیری نباشد مقدار `null` می‌ماند؛ صفر یا عدد تخمینی نمایش داده نمی‌شود.

### ۶. سطح عمومی DEX-to-DEX

دو endpoint نسخه‌دار اضافه شده است:

```http
GET  /api/intents/v1/capabilities
POST /api/intents/v1/validate
```

اولی قابلیت‌ها و محدودیت‌ها را منتشر می‌کند. دومی Envelope بیرونی Intent را بدون گرفتن کلید، پول یا Calldata اعتبارسنجی می‌کند.

عمداً endpoint عمومی Bid/Execution باز نشده است؛ چون پیش از آن باید این موارد وجود داشته باشد:

- Solver authentication
- Quote commitment امضاشده
- Nonce و replay protection
- Bond / stake
- Timeout و cancellation rules
- Dispute mechanism
- Rate limit و anti-spam اقتصادی

باز کردن `POST /bids` بدون این موارد شبکه Solver نیست؛ سطح حمله است.

---

## تحلیل هفت ایده

## ۱. Proof of Execution

### MVP فعلی

- Route trace واقعی
- Constraint snapshot
- Selection policy صریح
- Tx settlement reference
- Canonical JSON + SHA-256
- Verify و Download روی دستگاه

### لایهٔ پروتکل فعلی و مسیر استاندارد کامل

Solver اکنون `fbt.solver-quote.v1` را پیش از Deadline با Ed25519 امضا می‌کند؛ پیام علاوه بر مبلغ و Gas، Fee، Slippage، Chain، `intentHash`، `routeCommitment`، زمان صدور، انقضا و nonce را نیز می‌بندد. Bidها وارد Transparency log غیرقابل‌overwrite می‌شوند و رسید پایان Coordinator ریشه، Policy و انتخاب را امضا می‌کند.

ریشهٔ رسید بسته‌شده می‌تواند در قرارداد permissionless `IntentAuctionAnchor` ثبت و event آن مستقل از سرور بررسی شود. اما استاندارد کامل هنوز به این موارد نیاز دارد:

- Admission تراکنشی یا Watchtower مستقل برای اثبات completeness؛
- اتصال رسید انتخاب به Settlement واقعی و مقدار دریافتی؛
- Bond و dispute rule برای Quote غیرقابل‌اجرا؛
- Verifier مستقل و امکان rotation امن کلید Coordinator.

بدون امضای Solver، امضای Close یا Anchor مستقل، SHA-256 به‌تنهایی فقط fingerprint محتواست؛ کسی که کل سند را عوض کند می‌تواند هش تازه هم بسازد.

## ۲. Private Intent DEX

سه سطح متفاوت نباید با هم اشتباه شوند:

| سطح | چه چیزی را پنهان می‌کند | محدودیت |
|---|---|---|
| Private RPC | از mempool عمومی | Relay جزئیات را می‌بیند؛ Wallet ممکن است RPC دیگری استفاده کند |
| Commit–reveal | جزئیات تا پایان Bidding | Metadata و timing ممکن است لو برود |
| Confidential compute / threshold encryption | جزئیات از Solverهای غیرمجاز | به attestation، committee و failure recovery نیاز دارد |

نسخه فعلی **Private RPC recommendation را Confidential Intent نام نمی‌گذارد**. اگر کاربر Relay یا Confidential بخواهد، Risk Engine مسیر را Block می‌کند؛ چون اپ نمی‌تواند transport کیف خارجی را attest کند.

مسیر پیشنهادی توسعه:

1. Intent commitment بدون مبلغ/توکن آشکار
2. Threshold encryption بین چند operator مستقل
3. Solver admission با stake
4. Decrypt پس از پایان auction یا داخل TEE
5. Settlement از طریق contract دارای nonce
6. Receipt با transport attestation

## ۳. Outcome Marketplace

Outcome نباید با Quote لحظه‌ای اشتباه شود. مثال:

```text
حداقل 10 ETH تا ساعت T
حداکثر هزینه 20,000 USDC
```

Solver باید بتواند روش خود را پنهان نگه دارد ولی نتیجه را ضمانت کند. Bid لازم است این‌ها را داشته باشد:

- guaranteed minimum
- total maximum cost
- expiry
- settlement chain
- partial-fill policy
- collateral/bond
- failure penalty

تا وقتی Bond و Settlement Adapter وجود ندارد، Intent نوع Outcome فقط Draft است. نشان‌دادن سه Quote ساختگی به‌عنوان «رقابت Solverها» ممنوع است.

## ۴. DEX-to-DEX Network

نقش‌ها:

```text
Requester (wallet / DEX / treasury)
Solver (DEX / MM / aggregator / OTC)
Executor (settlement transaction builder)
Verifier (re-simulation + proof checker)
Watchtower (censorship / missed-best-bid monitor)
```

یک شرکت نباید هم‌زمان تنها Solver، Verifier و Proof publisher باشد؛ در آن صورت Network فقط API متمرکز با نام جدید است.

## ۵. Composable Swap

Workflow پیشنهادی باید DAG باشد، نه آرایه ساده در نسخه نهایی:

```text
node: action + chain + asset + precondition + postcondition
edge: dependency + value binding
```

هر Node باید این موارد را داشته باشد:

- `minOutput`
- `maxInput`
- `deadline`
- `allowedContracts`
- `revertPolicy`
- `approvalScope`

ریسک اصلی Partial completion است: Swap انجام شود ولی Bridge fail کند. سه مدل Settlement ممکن است:

1. **Atomic single-chain** — بهترین حالت، محدود به یک زنجیره
2. **Escrowed cross-chain state machine** — پیچیده و نیازمند timeout/refund
3. **Sequential user signatures** — مدل فعلی و صادقانه FBT

## ۶. Memory Wallet

Memory نباید بی‌اجازه از رفتار، «مجوز» نتیجه بگیرد. تفکیک لازم:

- **Observed preference**: «معمولاً Arbitrum را انتخاب می‌کنی»
- **Confirmed rule**: «Arbitrum شبکه پیش‌فرض باشد»
- **Hard policy**: «بیشتر از ۰٫۵٪ Slippage ممنوع»

فقط دو مورد آخر حق اثر روی اجرا دارند و باید کاربر صریحاً تأییدشان کند. داده رفتاری خام نباید به سرور ارسال شود مگر با opt-in روشن.

## ۷. FBT Intent OS

Intent OS محصول بالادستی است؛ Swap و Orders Adapterهای آن هستند، نه برعکس. ترتیب رشد:

```text
Phase 1  — local compiler + risk + real quote trace + receipts       [انجام شده]
Phase 2a — signed solver commitments + immutable transparency log    [انجام شده]
Phase 2b — signed selection close + verified optional EVM anchor      [انجام شده]
Phase 2c — transactional admission + independent completeness watcher [مرحله بعد]
Phase 3  — bonded open solver network + outcome settlement
Phase 4  — atomic same-chain workflows + cross-chain state machine
Phase 5  — threshold-encrypted confidential intents
Phase 6  — independent verifiers and standardisation
```

### وضعیت دقیق Phase 2a

اکنون هر Solver فقط در صورتی می‌تواند Quote ثبت کند که کلید عمومی Ed25519 آن در `INTENT_SOLVER_KEYS` تعریف شده باشد. امضا همهٔ مقادیر مالی، `intentHash`، `routeCommitment`، زنجیره، nonce، زمان صدور و انقضا را پوشش می‌دهد. کلید خصوصی در اختیار خود Solver می‌ماند و نباید در `VITE_*` یا مخزن قرار گیرد.

```bash
# تولید یک‌بارهٔ کلیدها
node scripts/intent-solver.mjs keygen

# ساخت نمونهٔ Quote
node scripts/intent-solver.mjs example > quote.json

# امضا در محیط خود Solver
INTENT_SOLVER_PRIVATE_KEY='…' node scripts/intent-solver.mjs sign quote.json > signed.json
```

هر Quote پذیرفته‌شده در مسیر مستقل `intent/solver/nonce` نوشته می‌شود؛ overwrite مجاز نیست و nonce تکراری رد می‌شود. اگر `BLOB_READ_WRITE_TOKEN` وجود داشته باشد این ثبت پایدار است، وگرنه API و UI صریحاً حالت حافظهٔ موقت را اعلام می‌کنند. گزارش عمومی ریشهٔ Merkle قطعی و inclusion proof هر Quote را برمی‌گرداند.

این پیاده‌سازی هنوز ادعاهای زیر را ندارد:

- هر ریشه به‌صورت پیش‌فرض anchor نشده؛ وضعیت فقط بعد از تراکنش تأییدشده تغییر می‌کند؛
- ثبت‌شدن در log به معنی executable calldata یا settlement موفق نیست؛
- Solverها bond ندارند و جریمهٔ failure اعمال نمی‌شود؛
- Blob تراکنش اتمیک چندمسیره ندارد، پس completeness مجموعه هنوز اثبات نشده است؛
- هیچ کلید خصوصی Solver یا کاربر به FBT واگذار نمی‌شود.

### وضعیت دقیق Phase 2b

Endpoint بستن مزایده فقط با Bearer secret سروری `INTENT_AUCTION_CLOSE_TOKEN` فعال می‌شود. سپس کلید مستقل `INTENT_COORDINATOR_PRIVATE_KEY` یک رسید `fbt.auction-close.v1` را امضا می‌کند. این کلید فقط سند را امضا می‌کند؛ Wallet نیست و اجازهٔ انتقال دارایی یا اجرای calldata ندارد.

Policy قطعی `MAX_OUTPUT_WITHIN_SIGNED_LIMITS_V1` ابتدا Chain، executability، زمان، سقف Fee و سقف Slippage را بررسی می‌کند. سپس بیشترین خروجی را انتخاب می‌کند و برای tie از Gas، Fee، Slippage و در آخر hash استفاده می‌کند. رسید شامل تمام rejection reasonها، ترتیب گزینه‌های مجاز، برنده، ریشه و اندازهٔ مجموعه و کلید عمومی Coordinator است.

```bash
# کلید Coordinator را مثل کلید Solver بساز، ولی هرگز privateKey را در VITE_* نگذار
node scripts/intent-solver.mjs keygen

# بستن توسط اپراتور
curl -X POST "$FBT_URL/api/intents/v1/auctions/$INTENT_HASH/close" \
  -H "authorization: Bearer $INTENT_AUCTION_CLOSE_TOKEN" \
  -H 'content-type: application/json' \
  --data-binary @close-request.json
```

برای لنگر بیرونی، `contracts/IntentAuctionAnchor.sol` هیچ Tokenی نگه نمی‌دارد و فقط event منتشر می‌کند. هر شخص می‌تواند calldata دقیق رسید را از endpoint عمومی یا CLI آفلاین بگیرد، با Wallet خودش تراکنش بفرستد و tx hash را برگرداند. سرور فقط زمانی `externallyAnchored: true` اعلام می‌کند که RPC تعریف‌شده در `INTENT_ANCHOR_NETWORKS`، آدرس Contract، event دقیق و حداقل confirmation را تأیید کند.

```bash
node scripts/intent-auction.mjs verify close.json
node scripts/intent-auction.mjs calldata close.json 8453 0xYourAnchorContract
node scripts/intent-auction.mjs verify-anchor close.json anchor-claim.json
```

محدودیت مهم: Anchor زمان و محتوای **مجموعهٔ بسته‌شده** را ثابت می‌کند، نه اینکه Coordinator پیش از Seal هیچ Bidی را سانسور نکرده است. برای این ادعا به transactional admission یا Watchtower مستقل در Phase 2c نیاز است.

Endpointهای عمومی `/capabilities`، `/coordinator`، `/anchor-networks`، `/auctions/:intentHash` و endpointهای commitment/log وضعیت واقعی Coordinator، durability، anchor و completeness را نمایش می‌دهند.

---

## Threat model خلاصه

| تهدید | کنترل لازم |
|---|---|
| AI intent را اشتباه ترجمه کند | Structured fields مرجع؛ Preview و signature اجباری |
| Solver Quote دروغ بدهد | Simulation + signed commitment + bond |
| Frontend بهترین Bid را حذف کند | Merkle commitment + transparency log + watchtower |
| Replay یک Intent | chain-bound nonce + expiry + consumed mapping |
| Partial workflow | state machine + refund timeout |
| افشای Whale intent | threshold encryption + padded metadata |
| Rule حافظه دور زده شود | on-chain smart account policy؛ نسخه محلی کافی نیست |
| رسید بعداً تغییر کند | external anchor یا signature؛ هش محلی به‌تنهایی کافی نیست |

## اصل محصول

> هر قابلیت مالی باید یکی از سه وضعیت روشن را داشته باشد: **Live**، **Partial** یا **Roadmap**. «ظاهر زنده با داده ساختگی» وضعیت چهارم نیست.
