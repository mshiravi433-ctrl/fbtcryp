# FBT INTENT AI — پر کردن خلأهای مشخصات ۶۵بندی (Spec 65 Gap-Fill)

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۵بندی محصول
قرارداد کلی: **Source ≠ operational.** هیچ بخشی از این سند ادعای live/production/ready/verified نمی‌کند.

## وضعیت صادقانه (بنر پایانی — حفظ شده)

```
Launch blocked.
Operational activation unavailable.
No financial execution is authorized.
No External Agent live execution is claimed.
```

این بنر از `LAUNCH_BANNER` (فاز ۳۰) خوانده می‌شود و در صفحهٔ Intent OS به‌صورت نوار وضعیت همیشه‌نمایان نمایش داده می‌شود (`src/pages/IntentOS.jsx` → `LaunchStatusStrip`). هر ماژول جدید `noExecutionPermission` دارد و `operational=false` و `live=false` می‌ماند مگر با شواهد مستقل.

معماری دست‌نخورده ماند: دقیقاً سه mode (HUMAN↔AI / AI↔AI داخلی / FBT↔External)، Council + Guardian + Capability Router + Execution/Monitor/Exit/Learning/Genome. کنترل‌پلن فاز ۲۱–۵۰ فاز جدید نگرفت؛ فقط خلأها وصل شد.

---

## ۱) ماژول‌ها — به ترتیب اولویت اجرا

### goalNegotiation.js — بند ۵۹ (Goal Negotiation)
- **هدف:** هدف غیرواقعی (مثلاً +۵۰٪ در ۲۴ساعت) ردّ منطقی شود و سه گزینهٔ Keep Target / Reduce Risk / Extend Duration داده شود.
- **محدوده:** بر پایهٔ `assessTarget` (targetReality)؛ فقط ارزیابی و ثبت انتخاب کاربر.
- **ورودی/خروجی:** ورودی {capital, targetPct/targetCapital, durationHrs} → خروجی {decision: NEGOTIATE|ACKNOWLEDGE, reasons[], options[], choice}. `applyGoalChoice` انتخاب را ثبت می‌کند.
- **محدودیت:** قبول هدف ≠ اجازهٔ اجرا؛ Guardian پیش‌مایش همچنان لازم. probability/expected return از خودش نمی‌سازد.
- **وضعیت:** contract پیاده‌سازی شده؛ نه operational نه live.
- **تست/پذیرش:** `test:spec65-core` — هدف افراطی NEGOTIATE می‌شود، گزینه‌ها grantsExecution=false، انتخاب اجرا مجوز نمی‌دهد.

### costToGoal.js — بندهای ۳۰–۳۱ (Cost-to-Goal + Net Outcome)
- **هدف:** هزینهٔ کامل تا هدف: Swap+Gas+Bridge+Funding+Spread+Slippage+Performance+ExternalAgent؛ Net = Gross − هزینه‌ها.
- **ورودی/خروجی:** `computeCostToGoal({capitalUsd, targetUsd, costs, costEvidence})` → {costs[8], totalKnownCostUsd, netRemainderUsd, unknownCostClasses[]}. `predictNetOutcome({grossOutputUsd, ...})` → {expectedNetUsd, disclaimers[]}.
- **محدودیت:** هزینهٔ نامعلوم = unavailable نه صفر؛ net تا وقتی کلاسی نامعلوم است lower-bound است. وعدهٔ سود ممنوع (`profitPromised:false`).
- **وضعیت:** contract؛ وضعیت partial/unavailable صادق.
- **تست/پذیرش:** `test:spec65-core` — unknown ≠ zero، net=1091.5 در مثال، بدون مجوز اجرا.

### whyTransparency.js — بندهای ۴۹–۵۰ (Why Decision / Why Permission)
- **هدف:** روی هر اقدام WHY (هزینه/نقدینگی/ریسک/احتمال اجرا)؛ برای درخواست مجوز dYdX/futures/external: چرا، ریسک، جایگزین بدون آن.
- **ورودی/خروجی:** `whyThisDecision({action, decision, evidence, costs, liquidity, risk, alternative})` → {factors, evidenceBacked, saysBetter}. `whyThisPermission({capability, requestReason, strategy, alternatives})` → {riskSummary, alternativesWithoutCapability, declinePath}.
- **محدودیت:** بدون شواهد دوطرفه ادعای «بهتر» نمی‌کند (`saysBetter:false`). Decline = SAFE_REPLAN؛ نه بن‌بست نه auto-enable.
- **تست/پذیرش:** `test:spec65-core` — مقایسه بدون شواهد ممنوع، مسیر decline صادق.

### shadowExecution.js — بند ۲۴ (Shadow/Paper Execution)
- **هدف:** تمرین استراتژی قبل از پول واقعی در sandbox ایزوله.
- **محدودیت‌های سخت:** sandbox باید attested-isolated باشد؛ mainnet/productionSigner/realCustody رد می‌شوند؛ **Timeout ≠ quote** (status=timeout با خروجی/هزینهٔ null)؛ paper موفق = `paper-passed` نه live-ready؛ انتقال به real فقط با زنجیرهٔ کامل مستقل (`paperToRealRequirements`).
- **تست/پذیرش:** `test:spec65-core` — paper≠live با ۵ ادعا (passed/timeout/hung/no-simulator/upgrade-path).

### capabilityScanner.js (گسترش) — بند ۱
- **کاتالوگ کامل شد:** Smart Wallet, Swap, DEX Aggregator, Liquidity Router, Bridge, DeFi, Farm, Staking, Lending, Borrowing, Futures, Perpetual, dYdX, CEX, Signals, Investment, **RWA, Payment, P2P, Shop** (بدون adapter = not-implemented), Limit Orders, DCA, AI Prediction, Portfolio, **Risk Engine**, External Agents و…
- **افزوده:** `scanSummary` (چند مورد مرتبط/اختیاری/در دسترس/بدون شواهد) و `assertScanBeforeStart` (اسکن قبل از شروع؛ اسکن ≠ فعال‌سازی).
- **تست/پذیرش:** `test:spec65-capability` — ۲۶+ قابلیت الزامی موجود، RWA/Payment/P2P/Shop صادقانه not-implemented.

### capabilityActivation.js — بندهای ۲ و ۴ (Marketplace + One-Click)
- **جریان:** Permission → Wallet → Limits → Activate. یک کلیک فقط «درخواست مجوز» است (`PERMISSION_REQUEST_ONLY_NOT_EXECUTION`).
- **محدودیت:** بدون شواهد عملیاتی `activate` سبز نمی‌شود (`pending-evidence`). برای قابلیت غایب، `discoverForCapability` External Agent را discover می‌کند؛ **listing ≠ permission ≠ execution**.
- **تست/پذیرش:** `test:spec65-capability` — Activate بدون شواهد pending، فعال‌سازیِ شواهددار هم فقط planning.

### autoRevoke.js — بند ۵
- **هدف:** بعد از پایان/انقضای Intent: مجوز dYdX منقضی، External Agent revoked، Smart Wallet session expired.
- **قرارداد:** `sweepAutoRevoke` (گرنت‌های terminal/expired را revoke می‌کند و ثبت می‌کند)، `assertBoundedGrant` (گرنت بدون انقضا = خطا)، `revokeGrantNow`، `reapplyGrantAfterControl` (تحت STOP دوباره اعمال نمی‌شود).
- **محدودیت:** دسترسی دائمی ممنوع (`PERMANENT_ACCESS_FORBIDDEN`)؛ این لایه پول جابه‌جا نمی‌کند.
- **تست/پذیرش:** `test:spec65-capability` — انقضا→revoke، permanent→violation، STOP→block.

### specialistAgents.js — بندهای ۶–۲۰ + ۲۱ + ۲۲
- **۱۵ نقش:** Strategy, Execution (دو موتور داخلی واقعی) + Risk, Guardian, Research, Market, Liquidity, Bridge, Fee, Gas, Portfolio, Hedge, Exit, Learning, Auditor (قرارداد؛ `live:false` تا موتور واقعی وصل شود).
- **هر نقش:** ورودی/خروجی محدود + cannot صریح (sign/execute/custody/seed/bypass Guardian/bypass policy/override STOP) + check قطعی. Bridge فقط quote = quote-only. Portfolio بدون موجودی attested = unattested.
- **Council (۲۱):** `assertCouncilQuorum` — معاملات مهم حداقل Research+Strategy+Risk+Liquidity+Guardian. **Voting (۲۲):** `tallyVotes` با آستانهٔ policy؛ Guardian ❌ = REJECT؛ APPROVE فقط «اجازهٔ رفتن به authorization screen».
- **تست/پذیرش:** `test:spec65-specialists` — council اجرا نمی‌کند (`canExecute:false`, `replacesGuardian:false`)، Guardian veto قطعی.

### marketRegime.js — بند ۲۷
- رژیم‌ها: bull/bear/sideways/high-volatility/low-liquidity/risk-on/risk-off فقط از شواهد سورس‌دار با quality؛ بدون شواهد `regime:'unavailable'`. دادهٔ کهنه با confidenceDecay رد می‌شود. رژیم استراتژی را کور تغییر نمی‌دهد (`strategyChangesAutomatically:false`).
- **تست/پذیرش:** `test:spec65-adapters`.

### eventRiskAdapter.js — بند ۲۹
- news/unlock/CPI/FOMC/ETF/upgrade فقط با کلاس منبع معتبر (official-calendar/onchain-schedule/attested-news) می‌تواند ریسک را بالا ببرد؛ منبع نامعتبر هرگز ریسک را پایین نمی‌آورد. eventRisk بالا → فقط کاهش confidence + بازبینی؛ اجرای پنهان ممنوع.
- **تست/پذیرش:** `test:spec65-adapters` — `unverifiedCanOnlyRaiseRisk:true`، `hiddenExecution:false`.

### smartMoneyAdapter.js — بند ۲۸
- پنل نهنگ موجود (`src/lib/whales.js` shape) را به evidence استراتژی وصل می‌کند: inflow/outflow صرافی، جریان خالص، برچسب‌های برتر. نبود داده = `unavailable`؛ عدد ساختگی ممنوع. advice-only.
- **تست/پذیرش:** `test:spec65-adapters` — محاسبه فقط از رویدادهای مشاهده‌شده، stale = unavailable.

### parallelStrategies.js — بند ۲۵
- تقسیم سرمایه فقط با سازگاری policy (سقف سرمایه هر استراتژی، ریسک هر استراتژی، ریسک پرتفوی وزنی). ناسازگار = `POLICY_INCOMPATIBLE` fail-closed. استراتژی بدون شواهد/ریسک = fail-closed. پول جابه‌جا نمی‌شود.
- **تست/پذیرش:** `test:spec65-lifecycle`.

### confidenceDecay.js — بند ۳۷
- `decayConfidence = base × 0.5^(age/halfLife)` قطعی؛ زیر آستانه = `stale-review-required` + `executionBlocked:true`. observedAt نامعلوم/آینده هرگز بی‌صدا trusted نمی‌شود.
- **تست/پذیرش:** `test:spec65-adapters`.

### goalProgress.js — بندهای ۴۱–۴۲
- پیشرفت فقط با موجودی attested (provider+checkedAt+confirmed). بدون آن progressPct=null و `unattested`. Goal Tree چهار نوع زیرهدف با وزن محدود؛ درخت ≠ اجرا (`treeIsNotExecution`).
- **تست/پذیرش:** `test:spec65-lifecycle`.

### intentOptimizer.js — بندهای ۵۸ و ۶۰
- «سود بیشتر» مبهم → ۷ سؤال شفاف‌سازی (Risk/Duration/Capital/DeFi/Futures/dYdX/External)؛ پاسخ فقط از کاربر (`autoFillAnswers:false`). بستهٔ پیشنهادی: futures پیش‌فرض خاموش و نیازمند opt-in صریح، dYdX فقط optional، max-loss الزامی، target بالاتر از سقف ریسک cap و flag می‌شود. Recommended ≠ activation.
- **تست/پذیرش:** `test:spec65-protocol-presentation`.

### chatReplay.js — بند ۴۸
- Replay از رویدادهای ساختاریافته: تصمیم‌ها/دلایل/هشدارها/تعویض استراتژی/نتیجه (فقط با receipt تأییدشده). chain-of-thought خصوصی و راز drop و شمرده می‌شوند.
- **تست/پذیرش:** `test:spec65-lifecycle`.

### agentReputation.js — بندهای ۴۳–۴۵
- پنج دستهٔ Performance/Reliability/Risk/Communication/Accuracy فقط observed؛ نمونهٔ کم = insufficient_data نه ٪ ساختگی. Leaderboard: risk-adjusted، بدون badge بدون نمونه، انتشار عمومی opt-in صادقانه. Appreciation دوطرفه + دلیل کوتاه؛ `affectsGuardian/affectsRiskPolicy/affectsStop = false`.
- **تست/پذیرش:** `test:spec65-protocol-presentation`.

### personalityLayer.js — بندهای ۴۶–۴۷
- پنج لحن فقط روی متن نمایش (`scope:'display-only'`)؛ `personalityCannotChangeRisk` برای اثبات不变 بودن ریسک/policy/STOP بین لحن‌ها. Avatar قطعی/تزئینی؛ `grantsPermission:false`.
- **تست/پذیرش:** `test:spec65-protocol-presentation` — personality ریسک را عوض نمی‌کند.

### agentProtocol.js — بندهای ۵۱، ۵۳، ۵۷
- Envelope ۱۱فیلدی: Agent ID/Capabilities/Permissions/Intent/Risk/Fee/Input/Output/Status/Reputation/Expiration. Passport ناقص/unverified → `incompletePassportNonExecutable:true` بدون padding. زنجیرهٔ User→Goal→Research→Strategy→External?→Risk→Guardian→Execution→Exit: هر حلقه halt دارد، هیچ حلقه‌ای امضا نمی‌کند (`noLinkSigns`).
- **تست/پذیرش:** `test:spec65-protocol-presentation`.

### agentPayment.js — بند ۵۲
- سه کلاس هزینه (service/performance/network) + سقف برداشت؛ درخواست بالای سقف همیشه BLOCK. **نمایش fee ≠ پرداخت**: تسویه فقط با شواهد (provider+checkedAt+confirmed+evidenceId)؛ ادعای zero-fee بدون شواهد flag می‌شود.
- **تست/پذیرش:** `test:spec65-protocol-presentation`.

### agentLearningExchange.js — بند ۵۴
- بعد از Session: چه درست/غلط بود، فرضیهٔ غلط، کدام بهتر — فقط ساختاریافته، فقط با opt-in صریح هر مشارکت‌کننده، بدون متن چت خصوصی، `uploadEnabled:false` (local-only)، بدون تضعیف Guardian/Risk.
- **تست/پذیرش:** `test:spec65-protocol-presentation`.

### disasterMode.js — بندهای ۳۵–۳۶
- Disaster فقط با incident شواهددار (bridge-exploit/contract-exploit/oracle-failure/extreme-vol/liquidity-collapse) → حالت دفاعی طبق policy؛ suspected = pending-confirmation؛ فرض فاجعه ممنوع؛ `autoExit/autoSell=false` و bypass Guardian/STOP ممنوع. Smart Pause: توقف برای ارزیابی مجدد؛ **Pause ≠ مجوز ادامه**.
- **تست/پذیرش:** `test:spec65-lifecycle`.

### dynamicRouteSwitch.js — بند ۳۳
- خرابی venue باید با شواهد health ثبت شود؛ جایگزین فقط «پیشنهاد» است؛ تعویض material-delta یا mid-execution → re-authorization الزامی. بدون جایگزین سالم → review نه مسیر اجباری.
- **تست/پذیرش:** `test:spec65-lifecycle`.

---

## ۲) اتصال‌های جدا از Intent (بخش H — صادقانه)

- **Market regime از Verdict/Signals:** `marketRegime.js` ورودی را از evidence سرویس Verdict/Signals می‌گیرد؛ ادعا نمی‌شود از اول مال Intent بوده.
- **Whale tracking موجود:** `smartMoneyAdapter.js` مستقیماً payload پنل موجود را مصرف می‌کند.
- **P2P / RWA / Payment / Shop:** در کاتالوگ `not-implemented` و فقط در صورت adapter+شواهد conditional می‌شوند.
- **Bridge:** quote ≠ executable (هم در specialistAgents هم در capability catalog).

## ۳) تست‌ها

- شش probe جدید + npm scripts:
  - `test:spec65-core` (۳۲) — paper≠live، score بدون evidence خالی، decline→replan
  - `test:spec65-capability` (۲۶) — کاتالوگ کامل، one-click=permission، auto-revoke
  - `test:spec65-specialists` (۱۹) — council اجرا نمی‌کند، Guardian veto
  - `test:spec65-adapters` (۱۹) — regime/event/smart-money صادق، confidence decay
  - `test:spec65-lifecycle` (۳۱) — scheduler امضا نمی‌کند، intent منقضی غیرقابل اجرا
  - `test:spec65-protocol-presentation` (۴۳) — personality ریسک را عوض نمی‌کند، سقف برداشت، opt-in
- مجموع: **۱۷۰ ادعا، همه سبز.** رگرسیون: phase2–50 + phase-status همه OK.
- اجرای کامل: `npm run test:spec65`

## ۴) UI

- `src/pages/IntentOS.jsx` → نوار `LaunchStatusStrip` با بنر قراردادی + نسخهٔ sentinel؛ سبز نشدنی. هیچ دکمهٔ اجرای سبزی اضافه نشد.

## ۵) پذیرش کلی

1. هیچ ماژول جدیدیauthorize/executenمی‌کند؛ همه `noExecutionPermission`.
2. هر دادهٔ نامعلوم = unavailable/null؛ هیچ عدد ساختگی.
3. بنر پایانی حفظ و در UI عمومی نمایش داده می‌شود.
4. سه mode و مرزهای phaseBoundary دست‌نخورده.
5. config ≠ implementation ≠ verification ≠ operational activation.
