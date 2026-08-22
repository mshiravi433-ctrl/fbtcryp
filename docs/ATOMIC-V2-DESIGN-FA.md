# طراحی Intent v2 — سواپ میان‌زنجیره‌ای با تضمین all-or-refund (فقط طراحی)

> **وضعیت: design document — هیچ کدی، قراردادی یا flagی در این سند فعال
> نمی‌شود.** جریان v1 فعلی (`sequential-user-signatures`, `atomic:false`,
> بدون custody/escrow/automatic settlement) دقیقاً همان می‌ماند و UI/API
> همچنان non-atomic بودن آن را شفاف اعلام می‌کنند.
>
> پیش‌نیازهای هر implementation: تأیید صریح طراحی توسط مالک پروژه →
> پیاده‌سازی به‌عنوان پروتکل جدا (v2) → testnet کامل → audit مستقل →
> TVL cap محدود → rollout مرحله‌ای → مجوز جداگانهٔ mainnet.

## ۱. صورت‌مسئله و مرز صداقت

بین دو chain مستقل، transaction واحد جهانی وجود ندارد. «Atomic» در عمل
یعنی ترکیب شرط رمزنگاری‌شده/اقتصادی + lock + timeout + refund طوری که
**یا هر دو پا انجام شوند، یا دارایی قابل بازگشت باشد** — و این ادعا همیشه
باید همراه با trust model و محدودیت‌هایش بیان شود (مثلاً «all-or-refund
پس از حداکثر T، به شرط live بودن حداقل یک RPC صادق»)، نه به‌صورت مطلق.

## ۲. مقایسهٔ گزینه‌های معماری

### ۲٫۱ HTLC (hashlock + timelock)

- **مکانیزم:** کاربر روی source با hash(H) قفل می‌کند؛ طرف مقابل روی
  destination با همان H قفل می‌کند؛ claim مقصد preimage را افشا می‌کند و
  همان preimage claim مبدأ را ممکن می‌سازد. deadline مقصد باید به‌طور
  ایمن کوتاه‌تر از مبدأ باشد (deadline ordering) وگرنه race/theft ممکن است.
- **مزایا:** non-custodial واقعی؛ بدون bridge؛ trust model حداقلی
  (فقط liveness زنجیره‌ها و خود کاربر).
- **معایب:** نیازمند counterparty فعال با liquidity روی مقصد؛ UX ضعیف
  (۲+ tx برای هر طرف، انتظار refund در بدترین حالت = کل timelock مبدأ)؛
  ریسک free-option برای طرف مقابل (نوسان قیمت در پنجرهٔ timelock)؛
  fee volatility در chainهای شلوغ می‌تواند claim/refund را گران کند؛
  سازگاری: هر دو سمت باید قرارداد HTLC برای همان token داشته باشند.
- **trust model:** بهترین؛ **هزینه/UX:** بدترین.

### ۲٫۲ Escrow contract (lock/settle/cancel/refund/pause)

- **مکانیزم:** قرارداد escrow روی source دارایی کاربر را lock می‌کند؛
  settlement با شرط قابل‌بررسی (اثبات fill مقصد یا امضای oracle/verifier)
  آزاد می‌شود؛ timeout → refund.
- **مزایا:** UX بهتر از HTLC؛ state machine صریح؛ pause اضطراری ممکن.
- **معایب:** «چه کسی settlement را تأیید می‌کند؟» همان مسئلهٔ اعتماد را
  برمی‌گرداند (oracle/relayer/multisig)؛ admin/governance risk واقعی است
  (کلید pause یا upgrade = قدرت مسدودسازی یا سرقت غیرمستقیم)؛ audit جدی
  لازم دارد؛ pause نباید بتواند refund را هم مسدود کند (باید refund-after-
  timeout حتی در حالت pause زنده بماند).
- **trust model:** متوسط، وابسته به مکانیزم اثبات مقصد.

### ۲٫۳ Solver/Relayer با liquidity + bond (مدل intent-based، مثل across-style)

- **مکانیزم:** solver مقصد را از liquidity خودش fill می‌کند
  (destination fill first)، سپس با اثبات fill از escrow مبدأ settle
  می‌گیرد. bond/collateral + slashing برای misbehavior؛ dispute window.
- **مزایا:** بهترین UX (کاربر یک امضا/tx؛ مقصد سریع پر می‌شود)؛ ریسک کاربر
  محدود به «مبدأ قفل شده تا settlement/refund»؛ با مدل auction/solver فعلی
  intent در این repo هم‌راستاست.
- **معایب:** به solver با سرمایه نیاز دارد (`SOLVER_OR_MARKET_MAKER_EXISTS:
  [NOT PROVIDED]` — blocker جدی)؛ solver insolvency/refusal → مسیر refund
  باید مستقل از solver کار کند؛ dispute handling و اثبات fill مقصد باز به
  یک verification layer نیاز دارد (light client / optimistic + challenge /
  committee)؛ اقتصاد bond باید بزرگ‌تر از سود تقلب باشد.
- **trust model:** اقتصادی-رمزنگاری‌شده؛ **پیشنهاد اصلی این سند** به شرط
  وجود solver واقعی.

### ۲٫۴ Bridge / Message layer (LayerZero، Axelar، Hyperlane، …)

- **مکانیزم:** پیام «مبدأ قفل شد» از طریق bridge به مقصد می‌رود و برعکس.
- **مزایا:** ساده‌سازی مهندسی؛ پوشش chainهای زیاد.
- **معایب:** **bridge به‌تنهایی atomic نمی‌سازد** — فقط انتقال پیام است و
  کل امنیت به trust assumptions همان bridge (committee/validator set)
  فرومی‌کاهد؛ تاریخ exploitهای بزرگ bridge؛ reorg مبدأ پس از ارسال پیام؛
  bridge failure → stuck funds اگر refund مستقل طراحی نشود.
- **trust model:** ضعیف‌ترین در بین گزینه‌ها؛ فقط به‌عنوان transport
  کمکی با refund مستقل قابل بررسی است، نه به‌عنوان تضمین.

### جمع‌بندی مقایسه

| گزینه | Trust | UX | هزینه | نیاز به نقدینگی ثالث | ریسک اصلی |
|---|---|---|---|---|---|
| HTLC | عالی | ضعیف | متوسط | بله (counterparty) | free-option، timeout طولانی |
| Escrow | متوسط | خوب | متوسط | خیر | admin key، مکانیزم اثبات مقصد |
| Solver+bond | خوب (اقتصادی) | عالی | کم برای کاربر | بله (solver) | insolvency، اقتصاد bond |
| Bridge | ضعیف | خوب | متوسط | خیر | compromise کل bridge |

**پیشنهاد:** ترکیب «escrow مبدأ + destination-fill توسط solver باندشده +
refund مستقل از solver پس از timeout»، با HTLC خالص به‌عنوان fallback
non-custodial برای جفت‌های بدون solver. تصمیم نهایی به فیلدهای
`ACCEPTABLE_TRUST_MODEL`، `SOLVER_*` و `REFUND_MODEL` (همه فعلاً
`[NOT PROVIDED]`) وابسته است.

## ۳. State machine پیشنهادی v2 (source escrow + solver fill)

```
CREATED ──user lock tx──► LOCKED(source)
LOCKED ──solver fill مقصد + اثبات──► FILL_CLAIMED
FILL_CLAIMED ──پنجرهٔ challenge بدون dispute──► SETTLED   (solver از escrow می‌گیرد)
FILL_CLAIMED ──dispute موفق──► DISPUTED ──► REFUNDABLE
LOCKED ──بدون fill تا deadline──► REFUNDABLE
REFUNDABLE ──user claim یا refund خودکار──► REFUNDED
هر حالت ── CANCELLED فقط قبل از LOCKED (هیچ دارایی درگیر نیست)
```

قواعد سخت:

1. `REFUNDABLE → REFUNDED` هرگز نباید به امضای solver، relayer، admin یا
   FBT وابسته باشد — فقط timeout on-chain + امضای خود کاربر (و در صورت
   انتخاب `REFUND_MODEL: automatic`، هر کسی بتواند refund را trigger کند).
2. `pause` اضطراری فقط ورودی‌های جدید (`CREATED→LOCKED`) را می‌بندد؛
   مسیر refund هرگز pause نمی‌شود.
3. deadlineها: `fillDeadline < challengeEnd < refundStart` با حاشیهٔ
   reorg-safe در هر دو chain.
4. هر state transition یک event on-chain صریح دارد؛ backend فقط index
   می‌کند و هیچ transitionی را خودش انجام نمی‌دهد.

## ۴. Threat model / Risk register

| # | تهدید | اثر | کنترل |
|---|---|---|---|
| 1 | Partial execution (فقط یک پا) | ضرر یک طرف | escrow + refund-after-timeout؛ هرگز release بدون اثبات fill |
| 2 | Locked/stuck funds | فریز دارایی کاربر | refund مستقل از همهٔ طرف‌ها؛ سقف timeout قراردادی |
| 3 | Timeout/refund failure | فریز دائمی | تست invariant: از هر state قابل‌دسترس، مسیر refund وجود دارد؛ audit |
| 4 | Replay attack (فراخوانی مجدد settle/refund) | برداشت دوباره | nonce/state-machine on-chain؛ کلید کامل رکورد مثل الگوی anchor |
| 5 | Signature replay/misuse بین chainها | جعل settlement | EIP-712 domain با chainId + آدرس قرارداد + intentId |
| 6 | Chain reorg | fill/lock ناپدید شود | confirmation floor (پیش‌فرض 12) قبل از هر تصمیم؛ challenge window > عمق reorg محتمل |
| 7 | RPC outage/manipulation | تصمیم غلط verifier | multi-RPC quorum (مدل موجود ≥2) + fail-closed |
| 8 | Relayer failure | تأخیر settlement | settlement permissionless (هر کسی بتواند با اثبات، settle را trigger کند) |
| 9 | Solver insolvency | fill انجام نشود | فقط ریسک تأخیر؛ refund مستقل؛ bond slashing برای fill دروغ |
| 10 | Destination liquidity failure | fill ناقص | fill باید exact-or-nothing باشد؛ partial fill در v2.0 ممنوع |
| 11 | Gas failure در claim/refund | گیر افتادن کاربر | refund قابل trigger توسط هر کسی؛ متادیتای gas در UI |
| 12 | Wrong chain / wrong token | ارسال به مقصد غلط | pin کردن token address + chainId داخل intent امضاشده؛ verification موجود per-leg |
| 13 | Compromised admin/owner keys | سرقت/فریز | ترجیح: بدون admin؛ اگر لازم شد Safe multisig + timelock، بدون قدرت برداشت دارایی کاربر |
| 14 | Compromised relayer keys | جعل پیام | relayer هیچ authority یکجانبه‌ای نداشته باشد؛ فقط carrier |
| 15 | Bridge/message compromise | جعل اثبات مقصد | عدم اتکا به bridge به‌عنوان تنها منبع حقیقت؛ challenge window + verifier مستقل |
| 16 | باگ smart contract | همه‌چیز | audit مستقل اجباری + TVL cap اولیه + bug bounty |
| 17 | Upgrade/proxy risk | rug از طریق upgrade | ترجیح non-upgradeable؛ اگر proxy، timelock عمومی و اعلان |
| 18 | Front-running / MEV | استخراج ارزش از fill | fill قیمتش را از سند امضاشدهٔ auction می‌گیرد نه از mempool؛ private relay اختیاری |
| 19 | Accounting/fee mismatch | ضرر خاموش | invariantهای on-chain: escrow فقط مبلغ دقیق سند؛ feeها صریح در intent |
| 20 | Emergency pause vs refund | فریز تحت عنوان امنیت | pause فقط ورودی جدید؛ refund pause-proof (تست الزامی) |
| 21 | پیامدهای حقوقی/custody | ریسک قانونی | escrow قراردادی غیرمتمرکز، بدون کنترل انسانی بر دارایی؛ بررسی حقوقی قبل از mainnet (`LEGAL_OR_OPERATIONAL_LIMITS: [NOT PROVIDED]`) |

## ۵. جداسازی از v1 و migration plan

1. **پروتکل جدا:** namespace جدید `/api/intents/v2/…` + schemaهای جدید
   (`fbt.intent-v2.lock.v1` و …). هیچ endpoint یا schema v1 تغییر نمی‌کند.
2. **Backward compatibility:** v1 برای همیشه قابل‌سرویس می‌ماند؛
   capabilities فعلی (`atomic:false` و envelope با
   `ATOMIC_CROSS_CHAIN_UNAVAILABLE`) تا فعال‌سازی واقعی v2 دست‌نخورده.
3. **مراحل migration:**
   - فاز D0: تصویب این طراحی + تکمیل فیلدهای `[NOT PROVIDED]`
   - فاز D1: قراردادهای v2 + تست unit/property/invariant + fuzz روی
     state machine (بدون هیچ deploy)
   - فاز D2: testnet end-to-end (جفت token آزمایشی، solver آزمایشی،
     شبیه‌سازی همهٔ ۲۱ ردیف threat model) — فقط با مجوز صریح
   - فاز D3: audit مستقل + رفع یافته‌ها + انتشار گزارش عمومی
   - فاز D4: mainnet با TVL cap کوچک + دورهٔ مشاهده + kill-switch ورودی
   - فاز D5: افزایش تدریجی cap؛ v1 به‌عنوان مسیر ساده باقی می‌ماند
4. **لایه‌ها به تفکیک:** contracts (escrow/fill/bond) · backend (indexer +
   verifier چند-RPC، بازاستفاده از `intentCrossChainVerification.js`) ·
   API (v2 خواندنی + submit اثبات‌ها) · frontend (state machine نمایشی با
   برچسب صادقانهٔ trust model) · event model (هر transition یک event).

## ۶. معیار صادقانهٔ `atomic:true`

فقط وقتی همهٔ این‌ها هم‌زمان برقرار شد، و فقط برای **مسیر v2** (نه v1):

1. قراردادهای escrow/fill deployشده، verified-source و audit-شده روی هر دو chain؛
2. اثبات ماشینی این invariant: از هر state قابل‌دسترس، یا settle کامل ممکن
   است یا refund کامل — بدون نیاز به هیچ طرف مورد اعتماد؛
3. refund در عمل روی testnet و mainnet-cap تحت شکست‌های واقعی
   (solver خاموش، relayer خاموش، RPC قطع) تمرین و ثبت شده باشد؛
4. عبارت capability دقیق باشد: مثلاً
   `atomicity: "all-or-refund-within-T, trust-minimized (source escrow + bonded fill)"`
   نه `atomic:true` مطلق و بدون قید؛
5. تأیید صریح مالک پروژه.

تا آن زمان: `atomic:false` در v1 **و** v2-preview باقی می‌ماند.

## ۷. داده‌های لازم قبل از implementation (همه فعلاً `[NOT PROVIDED]`)

جفت شبکه و token مبدأ/مقصد (با آدرس و explorer)، حداقل/حداکثر اندازهٔ
swap، `INITIAL_TVL_CAP`، `ACCEPTABLE_TRUST_MODEL`، قابل‌قبول بودن lock
موقت و مدت آن، مدل refund (خودکار/کاربر/هر دو) و سقف timeout، الزامات UX
(تعداد امضا، زمان انتظار، رفتار شکست مقصد، سیاست cancel)، وجود solver
واقعی + مستندات/کیف پول عمومی آن، کاندیدای bridge/message layer + مدل
امنیتی + auditها، مدل governance (پیشنهاد: Safe multisig + timelock، بدون
قدرت برداشت)، الزام pause اضطراری، upgradeability (پیشنهاد: No)، و الزام
audit مستقل قبل از mainnet (پیشنهاد: Yes).
