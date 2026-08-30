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
| Workflow | تک‌زنجیره: آمادهٔ بازبینی / میان‌زنجیره: Draft-only | DAG تک‌زنجیره‌ای با امضای کاربر؛ پل یا زنجیرهٔ دوم اتمیک جا زده نمی‌شود |

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

- `ready-for-review`: فقط اجازه رفتن به صفحه بازبینی؛ نه اجرا (سواپ، اتوماسیون، و گردش‌کار تک‌زنجیره‌ای)
- `draft-only`: ذخیره محلی بدون دکمه اجرای گمراه‌کننده (بازار نتیجه، گردش‌کار میان‌زنجیره‌ای، حریم خصوصی متصل‌نشده)

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

پس از Phase 3a سطح عمومی این‌ها را هم دارد — همگی شواهد پس از بستن مزایده، نه Bid:

```http
GET  /api/intents/v1/bonds
POST /api/intents/v1/auctions/{intentHash}/execution-claims
POST /api/intents/v1/auctions/{intentHash}/disputes
POST /api/intents/v1/auctions/{intentHash}/adjudicate   (فقط اپراتور، با Bearer)
```

عمداً endpoint عمومی Bid/Execution باز نشده است؛ چون پیش از آن باید این موارد وجود داشته باشد:

- Solver authentication
- Quote commitment امضاشده
- Nonce و replay protection
- Bond / stake — از Phase 3a به‌صورت اعلام‌شده (بدون escrow آن‌چین)
- Timeout و cancellation rules
- Dispute mechanism — از Phase 3a برای اجرای پس از انتخاب
- Rate limit و anti-spam اقتصادی

باز کردن `POST /bids` بدون این موارد شبکه Solver نیست؛ سطح حمله است.

### ۷. وثیقهٔ اعلام‌شده و تسویهٔ نتیجه (Phase 3)

از Phase 3 هر نتیجهٔ اجرا قابل ادعا و قابل راستی‌آزمایی است: سالور برنده ادعای اجرای امضاشده می‌دهد، راستی‌آزمای مستقل می‌تواند اعتراض کند، Coordinator داوری قطعی جریمه امضا می‌کند و گزارش‌های تسویهٔ مستقل، «وعده در برابر تحویل» را بازمحاسبه و کنترل متقاطع می‌کنند. وثیقه‌ها **اعلام عمومی**‌اند (بدون escrow آن‌چین و بدون نگهداری وجوه توسط FBT) — جزئیات در بخش‌های «وضعیت دقیق Phase 3a» و «وضعیت دقیق Phase 3b».

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

ریشهٔ رسید بسته‌شده می‌تواند در قرارداد permissionless `IntentAuctionAnchor` ثبت و event آن مستقل از سرور بررسی شود. از Phase 2c هر پذیرش یک رسید تراکنشی امضاشده دارد و ناظران مستقل کامل‌بودن مجموعهٔ بسته‌شده را با گزارش قابل‌بازمحاسبه داوری می‌کنند. از Phase 3a سالور برنده ادعای اجرای امضاشده (`fbt.execution-claim.v1`) می‌دهد و Coordinator نتیجه را مقابل حداقل خروجی امضاشده قطعی داوری می‌کند. استاندارد کامل هنوز به این موارد نیاز دارد:

- ~~Admission تراکنشی یا Watchtower مستقل برای اثبات completeness~~ — تحویل‌شده در Phase 2c (رسید `fbt.admission-receipt.v1` + گزارش `fbt.completeness-report.v1`)؛
- ~~اتصال رسید انتخاب به Settlement واقعی و مقدار دریافتی~~ — Phase 3a ادعای اجرای امضاشده را به مبلغ دریافتی وصل کرد؛ راستی‌آزمایی مستقل کیفیت آن Phase 3b است؛
- ~~Bond و dispute rule برای Quote غیرقابل‌اجرا~~ — تحویل‌شده در Phase 3a (وثیقهٔ اعلام‌شده + داوری قطعی جریمه؛ وصول خارج از پروتکل)؛
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

Phase 3a/3b وثیقهٔ اعلام‌شده، داوری جریمه و گزارش تسویهٔ قابل‌بازمحاسبه را آوردند؛ ولی **Settlement Adapter واقعی** — مسیری که پول را به نتیجه برساند — هنوز وجود ندارد. پس Intent نوع Outcome همچنان فقط Draft است. نشان‌دادن سه Quote ساختگی به‌عنوان «رقابت Solverها» ممنوع است.

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
Phase 2c — transactional admission + independent completeness watcher [انجام شده]
Phase 3a — declared solver bonds + execution claims + disputes +
           deterministic penalty adjudication                        [انجام شده]
Phase 3b — outcome settlement reports + independent re-grading +
           offline settlement CLI                                    [انجام شده]
Phase 4a — atomic same-chain workflows (user-signed batch, no output verify) [انجام شده]
Phase 4b — sequential cross-chain signed state machine (non-atomic)     [انجام شده]
Phase 4c — real multi-RPC per-leg tx verification + signed account bindings [انجام شده؛ فعال‌سازی وابسته به RPC env واقعی]
Phase 5  — Outcome Marketplace + confidential intent transport          [انجام شده]
Phase 6  — operator bindings + key rotation + optional root anchor       [انجام شده؛ فعال‌سازی وابسته به env واقعی]
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
- Blob تراکنش اتمیک چندمسیره ندارد؛ پس «تضمین لحظه‌ای» کامل‌بودن مجموعه در لحظهٔ Seal ممکن نیست — اما از Phase 2c حذف یک Bid دارای رسید پذیرش، مدرک رمزنگاری قابل‌استقلال‌اثباتی علیه Coordinator است؛
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

محدودیت مهم: Anchor زمان و محتوای **مجموعهٔ بسته‌شده** را ثابت می‌کند، نه اینکه Coordinator پیش از Seal هیچ Bidی را سانسور نکرده است. این شکاف از Phase 2c با رسید پذیرش امضاشده و گزارش ناظر مستقل پوشیده شده است — بخش بعدی.

Endpointهای عمومی `/capabilities`، `/coordinator`، `/anchor-networks`، `/auctions/:intentHash` و endpointهای commitment/log وضعیت واقعی Coordinator، durability، anchor و completeness را نمایش می‌دهند.

### وضعیت دقیق Phase 2c

Phase 2c دو مکانیزم تحویل می‌دهد: **پذیرش تراکنشی** و **ناظر مستقل کامل‌بودن**. نتیجهٔ ترکیب این دو: سانسور Bid پیش از Seal دیگر «غیرقابل‌اثبات» نیست؛ یا Coordinator آن را در Close شامل می‌کند، یا مدرک امضاشده‌ای علیه خودش صادر کرده است.

#### ۱. رسید پذیرش تراکنشی (`fbt.admission-receipt.v1`)

هر `POST /api/intents/v1/commitments` موفق (201) علاوه بر ثبت immutable، یک رسید Ed25519 امضاشده توسط همان کلید Coordinator برمی‌گرداند که دقیقاً چهار واقعیت را می‌بندد: `intentHash`، `entryHash`، `acceptedAt`، `solverId`. رسید داخل همان قفل پذیرش و پس از چک دوبارهٔ وضعیت Seal صادر می‌شود؛ پس پاسخ 201 یعنی «ورودی ثبت شد» و «رسید صادر شد» به‌صورت یک تراکنش واحد.

رسیدها **قطعی‌اند**: هستهٔ رسید تابع خالص ورودی ذخیره‌شدهٔ لاگ است و امضای Ed25519 قطعی است، بنابراین:

- Solver اگر پاسخ HTTP را از دست بدهد، همان رسید بایت‌به‌بایت از `GET /api/intents/v1/admissions/{intentHash}/{entryHash}` قابل‌بازیابی است؛
- هر ناظر می‌تواند رسید هر ورودی لاگ را مستقل بازتولید و امضای آن را بدون هیچ Registryای بررسی کند.

محدودیت صادقانه: بازتولید پس از چرخش کلید Coordinator با کلید **جدید** امضا می‌شود؛ رسیدهای اصلی صادرشده با کلید قدیمی پابرجا و قابل‌راستی‌آزمایی می‌مانند. و زمان `acceptedAt` ساعت مشاهدهٔ Coordinator است؛ کوچک‌نمایی زمان توسط Coordinator برای یک Bid منفرد قابل‌اثبات نیست، ولی در مقیاس با مقایسهٔ ساعت Solver آشکار می‌شود.

#### ۲. گزارش ناظر کامل‌بودن (`fbt.completeness-report.v1`)

ناظر مستقل — هر سازمانی با کلید ثبت‌شده در `INTENT_WATCHER_KEYS` — رسیدهای مشاهده‌شده را با Close امضاشده مقایسه می‌کند. قواعد رتبه‌بندی **قطعی**‌اند؛ با ورودی یکسان، هر ماشین همان نتیجه را می‌دهد:

| وضعیت رسید نسبت به Close | رتبه‌بندی | معنا |
|---|---|---|
| در مجموعهٔ برنده/ردشدهٔ Close | `eligible` / `rejected` | سالم |
| در فهرست مشاهدهٔ دیررس Close | `late-observed` | سالم |
| `acceptedAt ≤ sealedAt − skew` ولی در Close نیست | `omitted-pre-seal` | **مدرک سخت سوءرفتار** |
| Close آن را late خوانده ولی رسید پیش از پنجرهٔ skew است | `late-contradiction` | **مدرک سخت سوءرفتار** (دو امضای Coordinator ناسازگار) |
| داخل پنجرهٔ `±skew` حول Seal یا بین Seal و Close | `ambiguous-window` | صادقانه نامشخص |
| `acceptedAt > closedAt + skew` | `post-close` | سالم؛ پس از تصمیم |

حکم گزارش: `misconduct-evident` ← `inconclusive` ← `complete`، و با صفر رسید `unmonitored` — صفر رسید هرگز «کامل» تلقی نمی‌شود. پنجرهٔ skew (پیش‌فرض ۲۰۰۰ms، قابل‌تنظیم با `INTENT_WATCHER_SKEW_MS`) مرز صادقانۀ ترتیب بین نمونه‌های مستقل سرور است: داخل آن پنجره، وقفه یا سانسور از هم تفکیک‌ناپذیرند.

سرور پیش از ذخیره، هر گزارش را **بازمحاسبه** می‌کند: امضای Close، امضای هر رسید، رتبه‌بندی‌ها، شمارش‌ها و حکم باید با کلید ثبت‌شدهٔ ناظر دقیقاً بازتولید شوند؛ گزارشی که بازمحاسبه نشود حتی با امضای معتبر ذخیره نمی‌شود. ذخیره immutable است و reportId یکتا بازپخش idempotent دارد.

#### ۳. واچ‌تاور آفلاین مستقل

```bash
# بررسی آفلاین یک رسید پذیرش
node scripts/intent-watchtower.mjs verify-receipt receipt.json

# محاسبه حکم کامل‌بودن بدون تماس با FBT
node scripts/intent-watchtower.mjs verify close.json receipts.json

# امضای گزارش به‌عنوان ناظر مستقل و ارسال
INTENT_WATCHER_PRIVATE_KEY='…' INTENT_WATCHER_ID='watch-coop' \
  node scripts/intent-watchtower.mjs report close.json receipts.json > report.json
curl -X POST "$FBT_URL/api/intents/v1/auctions/$INTENT_HASH/watcher-reports" \
  -H 'content-type: application/json' --data-binary @report.json

# راستی‌آزمایی آفلاین گزارش ذخیره‌شده
node scripts/intent-watchtower.mjs verify-report report.json close.json

# جمع‌آوری شواهد از endpointهای عمومی (رسیدها derive سروری‌اند؛ ضعیف‌تر از
# رسیدی که Solver در لحظهٔ پاسخ 201 گرفته است)
node scripts/intent-watchtower.mjs collect https://your-fbt-host $INTENT_HASH out.json
```

#### ۴. وضعیت زندهٔ کامل‌بودن هر مزایده

پاسخ `GET /api/intents/v1/auctions/:intentHash` پس از بستن، بلوک `completeness` را دارد: `unmonitored`، `watcher-verified`، `inconclusive` یا `misconduct-reported` — همراه با فهرست خلاصهٔ گزارش‌ها و فید کامل `/watcher-reports` که هر بار دوباره راستی‌آزمایی می‌شود. فیلدهای `auctionCompletenessProof` در خودِ Close و در capabilities عمداً `false` باقی می‌مانند: کامل‌بودن ادعای لحظهٔ امضای Close نیست؛ حکمی بعدی و مبتنی بر مدرکِ هر مزایده است.

این پیاده‌سازی هنوز ادعاهای زیر را ندارد و Phase 3+ نیاز دارند:

- رسید پذیرش ورود به مجموعهٔ بسته را «تضمین» نمی‌کند؛ سانسور را **قابل‌اثبات** می‌کند، نه غیرممکن؛
- کلیدهای ناظر در env یک deployment تعریف می‌شوند — استقلال واقعی نیازمند اپراتور مستقلِ واقعی پشت هر کلید است، نه صرفاً فیلد Registry؛
- ترتیب بین نمونه‌های سرورلس بر ساعت تکیه دارد، پس پنجرهٔ skew صادقانه نامشخص باقی می‌ماند؛
- Watchtower کامل‌بودن را می‌سنجد، نه کیفیت Route یا Settlement را؛ Bond و dispute در Phase 3a آمده‌اند (اعلام‌شده، بدون نگهداری وجوه) و گزارش‌های مستقل تسویهٔ نتیجه در Phase 3b تحویل شده‌اند (بخش بعد).

### وضعیت دقیق Phase 3a — شبکهٔ سالور وثیقه‌دار + ادعای اجرا، اختلاف و داوری جریمه

Phase 3a نیمهٔ اول «bonded open solver network + outcome settlement» است: از این پس «Quote برنده اجرا نشد» یک وضعیت بی‌پاسخ نیست، بلکه یک مسیر قطعی داوری دارد. هر چهار بخش با همان قاعدهٔ صداقت قبلی کار می‌کنند: **FBT هیچ وجهی نگه نمی‌دارد**.

#### ۱. وثیقهٔ اعلام‌شدهٔ سالورها (`fbt.solver-bond.v1`)

`INTENT_SOLVER_BONDS` رجیستری بیانیه‌های عمومی وثیقه است — مبلغ، دارایی، انقضا، توضیح — بدون هیچ کلید یا رازی. بورد عمومی `GET /api/intents/v1/bonds` وضعیت صادقانهٔ هر ردیف را می‌دهد: سالور فقط وقتی `bonded` است که اعلامش بالاتر از حداقل پروتکل (۱۰۰۰ دلار) باشد، در رجیستری سالورها ثبت باشد و وثیقه منقضی نشده باشد. capabilities و بورد هر دو صریح‌اند: `enforcement: 'out-of-protocol-declared'`، `custody: false`، `onChainEscrow: false` — امضاهای پروتکل پول جابه‌جا نمی‌کنند و چنین ادعایی هم نمی‌کنند؛ وصول جریمهٔ اعلام‌شده کار لایهٔ تسویه است (قرارداد escrow، توافق، رجیستری اعتبار).

#### ۲. ادعای اجرای امضاشده (`fbt.execution-claim.v1`)

پس از بستن مزایده، **سالور برنده** امضا می‌کند که در عمل چه شد: هش تراکنش، زنجیره، مبلغ واقعاً دریافت‌شده، کارمزد، زمان اجرا — مقید به close، ورودی انتخاب‌شده و کلید رجیستری برنده. ادعا کلید عمومی سالور را خودش حمل می‌کند، پس بدون Registry هم آفلاین راستی‌آزمایی می‌شود. دو تضمین ساختاری:

- **ادعا نمی‌تواند Quote را عریض‌تر کند:** خروجی حداقلی (`minOutFor`) از `amountOut` و `slippageBps` تعهد امضاشده بازمحاسبه می‌شود، نه از چیزی که ادعا دربارهٔ خودش می‌گوید؛
- **ادعا راستی‌آزمایی آن‌چین ادعا نمی‌کند:** `onChainVerified: false` و `txInclusionCheck: 'not-performed'` داخل خود ادعا امضا می‌شوند — ادعا مدرک امضاشده است، نه تسویهٔ ماشین‌راستی‌آزمایی‌شده.

هر close فقط یک شیار ادعای تغییرناپذیر دارد: بازپخش یکسان idempotent است و ادعای دومِ متفاوت conflict می‌گیرد، نه بازنویسی.

#### ۳. اختلاف راستی‌آزمای مستقل (`fbt.dispute.v1`)

`INTENT_VERIFIER_KEYS` کلیدهای عمومی راستی‌آزمایان مستقل را ثبت می‌کند (همان قالب رجیستری سالورها؛ بدون هیچ کلید خصوصی). اختلاف یک مشاهدهٔ امضاشده و کران‌دار است — `no-execution`، `short-fill`، `false-claim`، `late-execution` — و هرگز خودش رأی نیست؛ موتور درجه‌بندی قطعی معنی آن را تعیین می‌کند.

#### ۴. داوری قطعی جریمه (`fbt.adjudication.v1`)

با همان Bearer اپراتورِ بستن مزایده، Coordinator شواهد تغییرناپذیر را بازخوانی می‌کند، با موتور مشترک قطعی درجه‌بندی می‌کند و نتیجه را امضا می‌کند. جدول جریمه (نسبت به وثیقهٔ اعلام‌شده):

| وضعیت | جریمه |
|---|---|
| `fulfilled` (دریافتی ≥ حداقل امضاشده) | ۰٪ |
| `short-filled` خودگزارش‌شده | ۲۵٪ |
| `short-filled` لو رفته (ادعای filled غلط) | ۵۰٪ |
| `failed` خودگزارش‌شده (reverted/expired) | ۵۰٪ |
| `failed` لو رفته (برچسب غلط یا اجرای پس از پنجره) | ۱۰۰٪ |
| `unexecuted` (پس از مهلت، بدون ادعا) | ۱۰۰٪ |
| `contested` (تناقض راستی‌آزمای ثبت‌شده) | ۵۰٪ |

خودگزارشی شکست، جریمه را نصف می‌کند — انگیزهٔ اعتراف صادقانه بدون نیاز به اوراکل. تا وقتی پنجرهٔ اجرا باز است (`validUntil + INTENT_EXECUTION_GRACE_SECONDS`، پیش‌فرض ۳۰۰ ثانیه) داوری با `EXECUTION_WINDOW_OPEN` رد می‌شود؛ هیچ‌کس پیش از مهلت «گناهکار» اعلام نمی‌شود. سالور بدون وثیقه `bonded: false` و `penaltyUsd: null` می‌گیرد — جریمهٔ ساختگی هرگز ساخته نمی‌شود.

رکورد داوری **همهٔ ورودی‌هایش را داخل خودش حمل می‌کند** (تعهد انتخاب‌شده، ادعا، اختلاف‌ها)، پس هر شخص ثالث `verifyAdjudication` را بازمحاسبه می‌کند: حکم، جریمه و bonded بودن باید دقیقاً بازتولید شوند؛ رکوردی که بازمحاسبه نشود حتی با امضای معتبر Coordinator رد می‌شود. داوری عکس لحظه‌ای است (غیرقابل‌بازنویسی)؛ ادعایی که بعد از آن برسد، به‌جای بازنویسی تاریخ، یک تناقض قابل‌راستی‌آزمایی می‌سازد — که گزارش‌های Phase 3b آن را ردیف می‌کنند.

#### ۵. وضعیت زندهٔ اجرای هر مزایده

`GET /api/intents/v1/auctions/:intentHash` حالا بلوک `execution` (ادعا + وضعیت راستی‌آزمایی)، فهرست `disputes` و `adjudication` (+`adjudicationVerified`) را برمی‌گرداند و هر بار مقابل Close امضاشده دوباره راستی‌آزمایی می‌شوند. capabilities بلوک‌های `bonds` و `execution` را منتشر می‌کند؛ با رجیستری خالی همه‌چیز صادقانه `configured: false` می‌شود.

محدودیت‌های صادقانهٔ Phase 3a:

- **وثیقه اعلام است، نه گرو واقعی:** پروتکل وجوه وثیقه را نگه نمی‌دارد، منتقل نمی‌کند و وصول جریمه را اجرا نمی‌کند؛ خروجی داوری یک دستورِ مدرک‌دارِ امضاشده است برای لایهٔ تسویهٔ خارج از پروتکل؛
- ادعاها **راستی‌آزمایی آن‌چین** نمی‌شوند (بدون RPC و بدون رمزگشایی receipt) — کیفیت ادعاها از Phase 3b با گزارش‌های مستقلِ قابل‌بازمحاسبه پیگیری می‌شود، نه با ادعای کاذب آن‌چین؛
- راستی‌آزمایان در env یک deployment ثبت می‌شوند — استقلال واقعی مثل ناظران، به اپراتور مستقل واقعی پشت هر کلید بستگی دارد؛
- پولِ هیچ‌کس، از جمله وثیقه، هرگز در مسیر این endpointها جابه‌جا نمی‌شود.

### وضعیت دقیق Phase 3b — گزارش تسویهٔ نتیجه + درجه‌بندی مجدد مستقل

Phase 3b نیمهٔ دوم و پایانی فاز ۳ است: حالا **کیفیت اجرا و تسویه هم قابل ادعا و قابل راستی‌آزمایی است**، نه فقط کامل‌بودن مجموعه. گزارش تسویه (`fbt.settlement-report.v1`) همان کاری را برای نتیجهٔ اجرا می‌کند که گزارش کامل‌بودن برای مجموعهٔ بسته‌شده انجام می‌دهد — با یک تفاوت مهم: این‌جا مرجعِ درجه‌بندی فقط امضاها نیست، **حساب تسویه** است.

#### ۱. حساب تسویه: وعده در برابر تحویل

گزارش از روی همان شواهدِ داوری بازمحاسبه می‌شود و عددها را منتشر می‌کند:

```text
quotedMinOut  = floor(amountOut × (10000 − slippageBps) / 10000)   ← تعهد امضاشده
promisedOut   = amountOut تعهد امضاشده
deliveredOut  = amountReceived ادعای امضاشده
shortfall     = promisedOut − deliveredOut   (واحد توکن + bps)
```

حکم قطعی: `fulfilled`، `short-filled`، `failed`، `unexecuted`، `pending`، `contested` — و زمان ارزیابی داخل خود گزارش امضا می‌شود، پس گزارش ذخیره‌شده همیشه بازتولید می‌شود؛ پنجرهٔ pending هیچ‌وقت به شواهدی تبدیل نمی‌شود که در زمان گزارش وجود نداشته است.

#### ۲. کنترل متقاطع داوری (`adjudication-mismatch`)

اگر گزارش، داوری ذخیره‌شدهٔ Coordinator را هم داخل خودش حمل کند و حکم آن داوری از همان شواهد بازتولید نشود، حکم گزارش `adjudication-mismatch` می‌شود: دو بیانیهٔ امضاشده — داوری و قواعد قطعی — با هم تناقض دارند، یعنی مدرک سخت سوءرفتار، دقیقاً هم‌ردهٔ رسید پذیرشی که از مجموعهٔ بسته حذف شده است. یک مثال واقعی: سالور ادعای `filled` می‌دهد و داوری بر آن اساس `fulfilled` امضا می‌شود؛ راستی‌آزمای مستقل ادعای امضاشدهٔ دیگری از همان سالور با مبلغ کمتر مشاهده کرده است — گزارشِ او `short-filled` بازمحاسبه می‌شود و تناقض را روی وضعیت عمومی مزایده می‌آورد.

#### ۳. سرور پیش از ذخیره، بازمحاسبه می‌کند

`POST /api/intents/v1/auctions/{intentHash}/settlement-reports` مثل گزارش‌های ناظر رفتار می‌کند: امضای راستی‌آزما کافی نیست؛ حکم، اعداد کسری و کنترل متقاطع باید دقیقاً از شواهد تعبیه‌شده بازتولید شوند وگرنه گزارش حتی با کلید معتبر رد می‌شود. ذخیره غیرقابل‌بازنویسی است و reportId یکتا بازپخش idempotent دارد. `GET …/settlement-reports` هر بار دوباره راستی‌آزمایی می‌کند.

#### ۴. وضعیت زندهٔ تسویهٔ هر مزایده

`GET /api/intents/v1/auctions/{intentHash}` حالا بلوک `settlement` دارد: `unmonitored` ← `fulfilled` / `pending` / `adverse` / `adjudication-mismatch`. اولویت محافظه‌کارانه است: mismatch بر همه غالب است، هر حکم adverse بر fulfilled غالب است و صفر گزارش هرگز «تسویه‌شده» خوانده نمی‌شود. دامنه صادقانه اعلام می‌شود: `observed-evidence-only` — فقط شواهدی که راستی‌آزمایان واقعاً دیده‌اند.

#### ۵. CLI آفلاین مستقل

```bash
node scripts/intent-settler.mjs min-out commitment.json
INTENT_SOLVER_PRIVATE_KEY='…' INTENT_SOLVER_ID='mm-a' \
  node scripts/intent-settler.mjs claim close.json commitment.json \
  --outcome filled --tx 0x… --received 400000000000000000 --fee 70
INTENT_VERIFIER_PRIVATE_KEY='…' INTENT_VERIFIER_ID='verify-coop' \
  node scripts/intent-settler.mjs dispute close.json --kind no-execution
node scripts/intent-settler.mjs verify-claim claim.json close.json commitment.json
node scripts/intent-settler.mjs grade close.json commitment.json --claim claim.json --adjudication adjudication.json
INTENT_VERIFIER_PRIVATE_KEY='…' INTENT_VERIFIER_ID='verify-coop' \
  node scripts/intent-settler.mjs report close.json commitment.json --claim claim.json > report.json
node scripts/intent-settler.mjs verify-report report.json close.json
node scripts/intent-settler.mjs collect https://your-fbt-host $INTENT_HASH out.json
```

محدودیت‌های صادقانهٔ Phase 3b — و کل Phase 3:

- **تسویه یعنی «مدرک قطعی نتیجه»، نه انتقال خودکار وجوه:** پروتکل هیچ‌جا پول جابه‌جا نمی‌کند؛ نه در وثیقه، نه در وصول جریمه، نه در تسویه. `custody: false` و `onChainTxVerified: false` داخل خود رکوردها امضا می‌شوند؛
- مقدار «تحویل‌شده» از **ادعای امضاشدهٔ سالور** می‌آید، نه از رمزگشایی receipt آن‌چین — راستی‌آزمایان مستقل و کنترل متقاطع داوری، خطای ادعا را به مدرک تبدیل می‌کنند ولی ادعای کاذبِ یک‌جانبه را ناممکن نمی‌کنند؛
- راستی‌آزمایان واقعاً مستقل هنوز به اپراتورهای واقعی پشت کلیدها بستگی دارند؛ Registry به‌تنهایی استقلال نمی‌سازد؛
- `POST /bids` همچنان بسته است؛ شبکهٔ سالور تا آن موقع از مسیر امضاشدهٔ Quote → Close → Claim → Adjudication → Settlement Report کار می‌کند.

### وضعیت دقیق Phase 4a — گردش‌کار تک‌زنجیره‌ای + دستورهای claim/dispute

Phase 4a فقط **تک‌زنجیره** را باز می‌کند. Envelope بیرونی همان `fbt.intent.v1` با `kind: 'workflow'` است و گراف تودرتو `fbt.workflow.v1` (۲ تا ۸ گره، بدون دور) را حمل می‌کند. `steps[]` نمای سازگار قدیمی است و در سرور به DAG تبدیل می‌شود.

#### ۱. همان زنجیره در برابر میان‌زنجیره

- همهٔ گره‌ها روی یک `chainId` و بدون عمل `bridge` → Risk Engine `WORKFLOW_SINGLE_CHAIN_ATOMIC` می‌دهد، وضعیت `ready-for-review`، `executable: false`، `custodyAllowed: false`، `requireUserSignature: true`. Handoff به `/swap?...&workflow=1` است تا کاربر بازبینی و امضا کند.
- هر پل یا زنجیرهٔ دوم → `draft-only` با کد `ATOMIC_CROSS_CHAIN_UNAVAILABLE`. پرچم قدیمی `unavailable.atomicComposableWorkflows` با `unavailable.atomicCrossChainWorkflows` عوض شده است.

#### ۲. قرارداد `IntentWorkflowBatch`

`execute(workflowId, Call[], RevertPolicy)` یک دستهٔ همان‌تراکنش با سیاست AbortAll / Continue / SkipRemaining است. ETH باقیمانده به فراخواننده برمی‌گردد. **مالک ندارد، rescue ندارد**؛ ERC-20 که اشتباهاً به آن فرستاده شود گیر می‌کند. قرارداد خروجی تماس را با `minOutput` یا postcondition نمی‌سنجد و `msg.sender` زیرتماس، خودِ دسته‌کننده است نه کاربر. کال‌دیتای ساخته‌شده هش SHA-256 برنامه‌ریزی‌شدهٔ هر گره است (`liveRouterCalldata: false`) نه payload زندهٔ روتر DEX.

آدرس عمومی فقط از `INTENT_WORKFLOW_BATCH_ADDRESS` خوانده می‌شود. بدون آدرس معتبر، `capabilities.workflows.contract.configured` صادقانه `false` می‌ماند.

#### ۳. رسید و قابلیت‌ها

رسید `fbt.workflow-execution-proof.v1` ادعای `SINGLE_CHAIN_BATCH_EXECUTED` را با `globalAtomicity: false` و `outputVerified: false` امضا می‌کند — نه «اتمیک کل جهان». Capabilities بلوک `workflows` را منتشر می‌کند: `singleChainAtomic: true`، `crossChainAtomic: false`، `maxNodes: 8`. Adapter زندهٔ `fbt-single-chain-workflow` settlement را `user-signed-batch` اعلام می‌کند.

#### ۴. CLI

`scripts/intent-settler.mjs` حالا `claim` (با `INTENT_SOLVER_PRIVATE_KEY`) و `dispute` (با `INTENT_VERIFIER_PRIVATE_KEY`) را صدا می‌زند. هر دو builderهای سروری موجود را به کار می‌گیرند و کلید خصوصی را هرگز چاپ نمی‌کنند. این کلیدها فقط در secrets manager اپراتور می‌مانند — نه در مخزن، نه در `VITE_*`، نه در چت.

محدودیت‌های صادقانهٔ Phase 4a:

- گردش‌کار میان‌زنجیره‌ای اتمیک نیست؛ فاز ۴ب فقط state machine شواهدِ امضای ترتیبی را اضافه کرده و عمداً این محدودیت را عوض نمی‌کند؛
- دسته‌کننده خروجی را راستی‌آزمایی نمی‌کند و کال‌دیتای زندهٔ DEX نمی‌سازد؛
- سرور هرگز خرج نمی‌کند؛ `executable` روی envelope عمومی `false` می‌ماند؛
- `POST /bids` همچنان بسته است.

### وضعیت دقیق Phase 4b — state machine میان‌زنجیره‌ای با امضای ترتیبی

فاز ۴ب **تسویهٔ اتمیک** اضافه نمی‌کند. خروجی واقعی این فاز یک دفتر شواهد
نسخه‌دار است تا دو طرف بتوانند پاهای جداگانه را با کلید خود امضا و مستقل از FBT
راستی‌آزمایی کنند:

- `fbt.cross-chain-state.v1`: `source` و `destination` هرکدام `chainId`، توکن
  (`symbol/address/native/decimals`) و مبلغ صحیح در کوچک‌ترین واحد را دارند؛
  `parties` کلید عمومی سخت‌گیرانهٔ Ed25519 دو طرف را pin می‌کند؛
  `timeout.sourceSignatureBy`، `destinationSignatureBy` و `refundSignatureBy`
  ترتیب و سقف زمانی را می‌بندند؛
- `refund` دقیقاً بازگشت دارایی منبع از counterparty به initiator است، با
  `mode: 'user-signed-transfer'`، `automatic:false` و
  `enforceableByFbt:false`. بدون escrow، FBT نمی‌تواند counterparty را مجبور
  به بازپرداخت کند؛
- `fbt.cross-chain-leg-receipt.v1`: initiator ابتدا `source-transfer` را امضا
  می‌کند. سپس counterparty یا `destination-transfer` را تا deadline مقصد امضا
  می‌کند یا پس از آن `refund` را در پنجرهٔ بازپرداخت. رسید دوم به `receiptId`
  رسید اول متصل است و هر دو exact chain/token/amount/txHash را پوشش می‌دهند؛
- `txHash` در این نسخه **ادعای امضاشدهٔ طرف** است، نه نتیجهٔ RPC. بنابراین
  `onChainVerified:false`، `custody:false`، `escrow:false`،
  `automaticSettlement:false`، `atomic:false` و `globalAtomicity:false` داخل
  خود state و receipt ثابت‌اند؛
- ذخیره‌سازی state/receipt غیرقابل‌جایگزینی است. با Blob واقعی durable است؛
  بدون Blob فقط process-memory و `configured:false` در capabilities. مرز race
  چند instance نیز صادقانه `crossInstanceTransitionAtomicity:false` است.

API عمومی:

```text
POST /api/intents/v1/cross-chain/states
GET  /api/intents/v1/cross-chain/states/:stateId
POST /api/intents/v1/cross-chain/states/:stateId/receipts
```

CLI آفلاین (کلید خصوصی فقط در محیط همان طرف):

```bash
node scripts/intent-cross-chain.mjs create plan.json > state.json
INTENT_CROSS_CHAIN_PRIVATE_KEY='…' \
  node scripts/intent-cross-chain.mjs sign state.json \
  --leg source-transfer --tx 0x… > source-receipt.json
INTENT_CROSS_CHAIN_PRIVATE_KEY='…' \
  node scripts/intent-cross-chain.mjs sign state.json source-receipt.json \
  --leg destination-transfer --tx 0x… > destination-receipt.json
node scripts/intent-cross-chain.mjs verify-state \
  state.json source-receipt.json destination-receipt.json
```

**گارد محصول تغییر نکرده است:** `fbt.intent.v1` و Risk Engine برای هر bridge یا
زنجیرهٔ دوم همچنان `draft-only` و `ATOMIC_CROSS_CHAIN_UNAVAILABLE` می‌دهند؛
`unavailable.atomicCrossChainWorkflows:true` صحیح باقی مانده است. state machine
شواهد قابل‌راستی‌آزمایی می‌سازد، نه calldata خودکار، custody یا «اتمیک جهانی».

### وضعیت دقیق Phase 4c — راستی‌آزمایی واقعی چند-RPC هر پا (۱.۳۵.۰)

فاز ۴c ادعای غیراتمیک بودن را تغییر نمی‌دهد و هیچ receipt تاریخی را بازنویسی
نمی‌کند. رسید `fbt.cross-chain-leg-receipt.v1` برای همیشه یک ادعای امضاشدهٔ طرف
است و `onChainVerified:false` نگه می‌دارد. آنچه اضافه شد یک **لایهٔ مشتق‌شدهٔ
مستقل** است:

#### ۱. `fbt.cross-chain-account-binding.v1`

طرف، آدرس آن‌چین خود را با همان کلید Ed25519 که در state pin شده امضا می‌کند:
`stateId`، `partyId`، `chainId`، آدرس checksum شده، `partyPublicKey`،
صدور/انقضا، `walletProof` و claims صریح.

**اثبات کیف پول EIP-191 (واقعی):** دستور `binding-challenge` چالش عمومی و
قطعی می‌سازد که domain، schema، `stateId`، `partyId`، `chainId`، آدرس، کلید
عمومی Ed25519، `issuedAt`، `expiresAt` و nonce را bind می‌کند. کاربر چالش را
در کیف پول خودش با `personal_sign` امضا می‌کند و فقط امضای عمومی به CLI
داده می‌شود؛ کلید خصوصی کیف پول هرگز دریافت نمی‌شود. سرور با
`ethers.verifyMessage` امضا را بازیابی می‌کند و آدرس بازیابی‌شده باید دقیقاً
با آدرس binding یکی باشد.

```json
{
  "addressControlSelfAttested": true,
  "walletSignatureScheme": "EIP-191",
  "walletSignatureVerified": true,
  "fundsAuthorityGranted": false,
  "custody": false
}
```

بدون wallet proof، binding به‌صورت signed assertion ذخیره می‌شود و صادقانه
`walletSignatureScheme:null` و `walletSignatureVerified:false` دارد — اما
هرگز برای `onchain-verified` کافی نیست (وضعیت پا `wallet-proof-required`).
EIP-1271 (کیف پول قرارداد هوشمند) صریحاً unsupported است
(`WALLET_PROOF_SCHEME_UNSUPPORTED`) و fallback ساختگی وجود ندارد. صرف قرار
دادن آدرس در body درخواست API پذیرفته نمی‌شود؛ فقط امضای کلید همان party.

#### ۲. `fbt.cross-chain-tx-verification.v1`

verifier ثبت‌شده (registry `INTENT_VERIFIER_KEYS`) هر پا را از quorum حداقل
دو endpoint HTTPS با hostname متفاوت می‌خواند و گزارش bounded امضا می‌کند که
به `stateId`، `receiptId`، leg، chain/token/amount دقیق، آدرس‌های
فرستنده/گیرنده و binding idها، block number/hash، receipt status،
confirmations، observation نرمال‌شدهٔ هر RPC، quorum، verdict، reasonCodes،
`evaluatedAt` و هویت verifier متصل است. transport سخت‌گیرانه است: timeout
محدود، سقف اندازهٔ پاسخ 512KiB، shape/لاگ strict؛ پاسخ خام و نامحدود ذخیره
نمی‌شود.

- **ERC-20:** receipt موفق + رخداد `Transfer` دقیقاً از قرارداد token برنامه +
  from/to/amount دقیق + توافق block hash بین quorum + حداقل confirmation.
  رخداد مشابه از قرارداد دیگر پذیرفته نمی‌شود، لاگ malformed و چند رخداد
  مبهم رد می‌شوند (`MALFORMED_TRANSFER_EVENT` / `AMBIGUOUS_TRANSFER_EVENT`)
  و fee-on-transfer/rebasing بدون policy صریح هرگز verified نمی‌شود.
- **Native:** بررسی دقیق from/to/value خود تراکنش + receipt موفق + block hash
  + confirmations.
- **confirmations:** `latestBlock - receiptBlock + 1` (overflow-safe)؛ کمتر از
  `minConfirmations` → `confirmations-pending`.
- **reorg:** block hash عوض‌شده، تراکنش روی blockهای متفاوت یا اختلاف
  tx/receipt در یک endpoint → `reorg-detected` و fail-closed.

سرور پیش از ذخیره: کلید verifier را با registry چک می‌کند، bindingها و wallet
proofها را دوباره verify می‌کند، **خودش** زنجیره را از endpointهای خودش دوباره
می‌خواند و verdict را بازمحاسبه می‌کند. گزارش غیرقابل‌بازتولید با
`VERIFICATION_NOT_RECOMPUTABLE` رد می‌شود؛ رکورد ذخیره‌شده
`serverRecomputedBeforeStorage:true` را attest می‌کند. snapshot موقت
(pending/disagreement) فقط با claims صادقانه ذخیره می‌شود و با ظهور نتیجهٔ
نهایی `VERIFICATION_SUPERSEDED` می‌گیرد. ذخیره‌سازی immutable و idempotent،
سقف ۳ گزارش برای هر receipt، و خواندن عمومی همهٔ گزارش‌ها را با کلید embedded
verifier بازراستی‌آزمایی می‌کند (چرخش registry گزارش تاریخی را حذف نمی‌کند).

fail-closed: RPC disagreement، reorg/دریفت block-hash، receipt ناموفق، tx
پیدانشده، confirmation ناکافی، token contract/فرستنده/گیرنده/amount اشتباه،
رخداد اشتباه یا malformed، binding منقضی یا کلید اشتباه، wallet proof
نامعتبر، و کمتر از quorum توافق. outage پاسخ `verification-unavailable`
می‌گیرد و هرگز «verified» یا رد قطعی یا نتیجهٔ خالی معتبر نمی‌شود.

#### ۳. وضعیت مشتق‌شده و مرز صداقت

هر پا یکی از این وضعیت‌ها را دارد: `signed-only`، `binding-required`،
`wallet-proof-required`، `verification-pending`، `confirmations-pending`،
`rpc-disagreement`، `reorg-detected`، `verification-unavailable`،
`verification-rejected`، `onchain-verified`. اگر همهٔ پاهای ثبت‌شده verified
شوند `allSubmittedLegsOnChainVerified:true` می‌شود؛ اما `atomic`،
`globalAtomicity`، `custody`، `escrow`، `automaticSettlement` و
`refundEnforcedByFbt` همچنان false — تأیید دو تراکنش جدا آن‌ها را اتمیک
نمی‌کند — و envelope با `ATOMIC_CROSS_CHAIN_UNAVAILABLE` پیش‌نویس می‌ماند.

RPCها فقط در env سروری `INTENT_CROSS_CHAIN_RPC_NETWORKS` هستند (قالب: chainId،
quorum، minConfirmations، providers با id/rpcUrl)؛ هیچ URL در پاسخ عمومی،
log یا `VITE_*` ظاهر نمی‌شود. capabilities بلوک مستقل
`crossChainVerification` را منتشر می‌کند (`configured`، `bindingSchema`،
`verificationSchema`، `walletProof:"EIP-191"`، `eip1271Supported:false`،
`multiRpcRequired:true`، `minimumQuorum:2`، `configuredChains`،
`providerIndependenceProven:false`، `serverRecomputesBeforeStorage:true`،
`onChainTxVerification`، `atomic:false`، `custody:false`) و بدون env واقعی:
`configured:false`، `configuredChains:0`، `onChainTxVerification:false`.
hostname متفاوت اثبات استقلال provider نیست و RPC خصوصی «confidential» نامیده
نمی‌شود. سقف هزینهٔ RPC جداگانه است
(`INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT`).

#### API و CLI

```text
POST     /api/intents/v1/cross-chain/states/:stateId/account-binding-challenge
POST/GET /api/intents/v1/cross-chain/states/:stateId/account-bindings
POST/GET /api/intents/v1/cross-chain/states/:stateId/verification-reports
POST/GET /api/intents/v1/cross-chain/states/:stateId/receipts/:receiptId/verification-reports
GET      /api/intents/v1/cross-chain/states/:stateId    ← + legVerification
```

```bash
# طرف: چالش عمومی قطعی (بدون هیچ کلید خصوصی)
node scripts/intent-cross-chain.mjs binding-challenge state.json \
  --party initiator-id --chain 42161 --address 0x… --expires-at 1790000000 \
  --nonce challenge-id > challenge.json
# کاربر چالش را در کیف پول خودش با personal_sign امضا می‌کند (EIP-191)
# و فقط امضای عمومی را به CLI می‌دهد؛ کلید خصوصی کیف پول هرگز دریافت نمی‌شود.
INTENT_CROSS_CHAIN_PRIVATE_KEY='…' \
  node scripts/intent-cross-chain.mjs bind-account state.json \
  --party initiator-id --chain 42161 --address 0x… --expires-at 1790000000 \
  --wallet-signature 0x… --nonce challenge-id > binding.json
node scripts/intent-cross-chain.mjs verify-binding state.json binding.json

# verifier: خواندن واقعی زنجیره + امضای گزارش
INTENT_CROSS_CHAIN_RPC_NETWORKS='[{"chainId":42161,"quorum":2,"minConfirmations":3,"providers":[{"id":"arb-a","rpcUrl":"https://…"},{"id":"arb-b","rpcUrl":"https://…"}]}]' \
  node scripts/intent-cross-chain.mjs verify-tx state.json \
  --receipt receipt.json --from-binding from.json --to-binding to.json
INTENT_VERIFIER_PRIVATE_KEY='…' INTENT_CROSS_CHAIN_RPC_NETWORKS='…' \
  node scripts/intent-cross-chain.mjs sign-verification state.json \
  --receipt receipt.json --from-binding from.json --to-binding to.json \
  --verifier-id verify-coop > report.json
node scripts/intent-cross-chain.mjs verify-report state.json \
  --report report.json --receipt receipt.json --from-binding from.json --to-binding to.json
```

هیچ private key و هیچ RPC URL هرگز چاپ نمی‌شود.

### وضعیت دقیق Phase 4d — سواپ اتمیک میان‌زنجیره‌ای واقعی (HTLC)

فاز ۴د اولین جایی است که «اتمیک» برای میان‌زنجیره‌ای **واقعی** است، چون
سازوکارش روی خود زنجیره‌ها اجرا می‌شود: هر دو پا در قرارداد
`IntentAtomicSwap` (HTLC) با یک `hashlock` مشترک قفل می‌شوند و مهلت‌ها طوری
مرتب می‌شوند که **یا هر دو پا با یک preimage تسویه می‌شوند یا هر دو پا
بازپرداخت می‌شوند.** جزئیات کامل: [INTENT-ATOMIC-SWAP-FA](INTENT-ATOMIC-SWAP-FA.md).

نکته‌های کلیدی:

- کامپایلر پیش از تولید هر کال‌دیتایی قانون
  `destination.timeout + 3600s ≤ source.timeout` را اعمال می‌کند؛ نقض آن
  `ATOMIC_SWAP_TIMELOCK_ORDER_UNSAFE` است — جفتِ «اینجا بگیر، آنجا بازپرداخت»
  هرگز کامپایل نمی‌شود؛
- اسکرو در طول سواپِ باز نزد قرارداد است و همین صادقانه اعلام می‌شود؛ FBT
  کلید ندارد، سرور هیچ تراکنشی را امضا یا ارسال نمی‌کند و preimage فقط روی
  دستگاه کاربر می‌ماند؛
- فقط EVM↔EVM؛ سولانا و زنجیره‌های بدون قراردادِ مستقر رد می‌شوند؛
- تا استقرار روی حداقل دو زنجیره و تنظیم `INTENT_ATOMIC_SWAP_ADDRESSES`،
  قابلیت `unavailable` با `ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED` گزارش
  می‌شود و `unavailable.atomicCrossChainWorkflows` در همان حالت `true`
  می‌ماند؛
- مسیر مرحله‌ای ۴ب/۴c و کد `ATOMIC_CROSS_CHAIN_UNAVAILABLE` آن دست‌نخورده و
  بدون برچسب‌گذاری مجدد باقی می‌ماند.

```text
GET  /api/intents/v1/atomic-swap/status
POST /api/intents/v1/atomic-swap/plan
POST /api/intents/v1/atomic-swap/verify
```

### وضعیت دقیق Phase 6 — اپراتور مستقل، چرخش کلید و anchor ریشه

#### ۱. اتصال رمزنگاری‌شدهٔ اپراتور به کلید ناظر/راستی‌آزما

هر اپراتور بیرونی در secrets manager خودش یک
`fbt.operator-attestation.v1` زمان‌دار را با همان کلید watcher/verifier امضا
می‌کند. سند `operatorId/name/url`، نقش، `registryId`، کلید عمومی، زمان صدور و
انقضا را می‌بندد. سرور فقط سند عمومی امضاشده را از
`INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS` می‌خواند.

`independentVerification.configured:true` فقط وقتی است که **تمام** کلیدهای فعال
watcher/verifier attestation معتبر و منطبق داشته باشند و کلیدشان با کلیدهای
Solver/Coordinator یکی نباشد. بااین‌حال:

```text
keyControlProven: true                       # قابل اثبات رمزنگاری
organizationalIndependenceSelfAttested: true # گفتهٔ امضاشدهٔ اپراتور
organizationalIndependenceProven: false      # همیشه؛ رجیستری چنین چیزی را ثابت نمی‌کند
```

استقلال واقعی یعنی سازمان، زیرساخت، secrets manager و فرایند مشاهده واقعاً
بیرون FBT اداره و بیرون پروتکل audit شوند. ثبت یک کلید یا حتی attestation
خوداظهاری به‌تنهایی استقلال سازمانی نمی‌سازد. `/api/intents/v1/operators` این
مرز و bindingهای عمومی را منتشر می‌کند. ساخت/بررسی آفلاین:

```bash
INTENT_OBSERVER_PRIVATE_KEY='…' \
  node scripts/intent-operator.mjs attest operator-input.json > attestation.json
node scripts/intent-operator.mjs verify attestation.json
```

#### ۲. چرخش امن Coordinator

`fbt.coordinator-key-rotation.v1` یک transition از `oldPublicKey` به
`newPublicKey` است که **هر دو کلید** آن را امضا می‌کنند. فقط کلید فعال در
`INTENT_COORDINATOR_PRIVATE_KEY` اسناد جدید را امضا می‌کند؛ کلیدهای بازنشسته در
`fbt.coordinator-keyring.v1` با `signsNewDocuments:false` صرفاً برای راستی‌آزمایی
منتشر می‌شوند. هر receipt/close تاریخی public key امضاکننده را داخل bytes
امضاشدهٔ خودش دارد، پس با تعویض env همچنان مستقل راستی‌آزمایی می‌شود. اگر receipt
پیش از rotation و close پس از آن باشد، گزارش completeness زنجیرهٔ دوامضاشده را
همراه خود حمل و server آن را دوباره بررسی می‌کند.

مراسم آفلاین است؛ کلید قدیم و جدید هرگز لازم نیست هم‌زمان روی سرور باشند:

```bash
node scripts/intent-coordinator.mjs draft OLD_PUBLIC NEW_PUBLIC > rotation.json
INTENT_COORDINATOR_ROTATION_PRIVATE_KEY='…old…' \
  node scripts/intent-coordinator.mjs sign-old rotation.json > old-signed.json
INTENT_COORDINATOR_ROTATION_PRIVATE_KEY='…new…' \
  node scripts/intent-coordinator.mjs sign-new old-signed.json > dual-signed.json
node scripts/intent-coordinator.mjs verify dual-signed.json
```

فقط `dual-signed.json` عمومی در `INTENT_COORDINATOR_ROTATIONS` قرار می‌گیرد؛
هیچ private key داخل JSON، مخزن، `VITE_*` یا چت نمی‌رود. بدون رکورد واقعی،
`coordinatorRotationConfigured:false` باقی می‌ماند.

#### ۳. انتشار اختیاری ریشهٔ Merkle

`fbt.merkle-root-manifest.v1` از **تمام entryHashهای پاسخ log** دوباره محاسبه
می‌شود و `intentHash + merkleRoot + logSize` را با `rootId` قطعی می‌بندد.
قرارداد permissionless `IntentMerkleRootAnchor` فقط همین tuple را event می‌کند؛
walletی در FBT وجود ندارد. هرکس calldata را ارسال می‌کند و FBT تنها پس از دیدن
رخداد دقیق قرارداد پیکربندی‌شده و confirmation کافی، رکورد
`fbt.merkle-root-anchor-record.v1` را ذخیره می‌کند.

```text
GET  /api/intents/v1/merkle-anchor-networks
GET  /api/intents/v1/log/:intentHash/root-anchor-calldata/:chainId
POST /api/intents/v1/log/:intentHash/root-anchor
```

ریشه با هر Quote جدید عوض می‌شود؛ anchor قدیمی هرگز به root جدید تعمیم داده
نمی‌شود. بدون deployment واقعی در `INTENT_MERKLE_ANCHOR_NETWORKS`:
`configured:false` و `externallyAnchored:false`. حتی با anchor معتبر، claims
صریح‌اند: timestamp/set commitment بله؛ completeness، execution، settlement و
custody خیر. CLI: `scripts/intent-root-anchor.mjs`.

از ۱.۳۵.۰ ابزار deployment کامل است (Solidity دقیقاً 0.8.24):

```bash
node scripts/compile-merkle-anchor.mjs
DEPLOYER_PRIVATE_KEY=0x… RPC_URL=https://… CHAIN_ID=8453 \
  node scripts/deploy-merkle-anchor.mjs          # deploy + verify bytecode/event
RPC_URL=https://… CHAIN_ID=8453 \
  node scripts/deploy-merkle-anchor.mjs verify 0xAddress   # فقط verify
```

deploy فقط با credential واقعی در environment امن اپراتور انجام می‌شود؛
`DEPLOYER_PRIVATE_KEY` هرگز در مخزن، چت، log یا `VITE_*` قرار نمی‌گیرد و FBT آن
را از کاربر نمی‌خواهد. بدون deployment واقعی، وضعیت `configured:false` صادقانه
باقی می‌ماند.

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
