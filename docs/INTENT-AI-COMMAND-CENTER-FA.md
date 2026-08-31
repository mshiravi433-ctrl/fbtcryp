# فاز ۲۰۹ — صفحهٔ «هوش مصنوعی» (`/#/intent-ai`) به‌عنوان یک AI Command Center

> این سند همان چیزی است که مالک خواست: **هیچ صفحهٔ جدیدی ساخته نشد**؛ همان صفحهٔ
> Intent OS بازنویسی شد تا به‌جای فهرست‌کردن ۱۷ ایجنت، پنج کار اصلی را نشان دهد و
> هیچ‌وقت بدون تأیید کیف پول چیزی را اجرا نکند. تاریخ: ۱۴۰۵/۰۶/۰۹ (2026-08-31).

## ۰. سه اصلی که کل طراحی از آن‌ها می‌آید

1. **کاربر ایجنت نمی‌خرد، کارش را می‌گوید.** صفحه فقط پنج «درب» دارد
   (`Trade / Earn / Protect / Plan / Automate`) و چهار «دکمهٔ اقدام».
2. **AI معامله نمی‌کند.** هر چیزی که این صفحه (deck، ارکستراتور، فایروال) تولید
   می‌کند یک **پلن** است؛ اجرای واقعی یعنی: فایروال → تأیید کاربر → امضای کیف
   پول. هیچ مسیری در deck امضا یا broadcast صدا نمی‌زند — و این را تستِ
   stub-signer می‌سنجد، نه grep.
   مسیر «ارسال به شبکه» همان چیزی است که فازهای ۲۰۱–۲۰۷ ساختند و فقط با
   تیک صریح کاربر + `wallet.canSign` + دو امضای کیف پول اجرا می‌شود
   (`broadcastReady && broadcastOptIn && wallet.canSign`) — یعنی باز هم
   بعد از ارادهٔ کاربر، نه بعد از تصمیم AI.
3. **چیزی که نشان داده می‌شود باید واقعی باشد.** اگر فید بازار جواب نداده،
   ریل «unavailable» می‌گوید، نه چرخنده؛ اگر کیف پول خوانده نشده، `—`
   نمایش داده می‌شود نه `$0`؛ اگر ریسک محاسبه نشده، برچسب ریسک اصلاً رندر نمی‌شود.

## ۱. لایه‌ها و فایل‌ها

| فایل | نقش |
| --- | --- |
| `src/lib/intent-ai/commandCenter.js` | تمام منطق، ESM خالص، بدون React: طبقه‌بندی، ساخت پلن، فایروال، کنترل، اتوماسیون، snapshot |
| `src/components/IntentAIPanel.jsx` | همان صفحهٔ قبلی؛ هدر + سه تب اضافه شد، چت/تأیید/رسید سرِ جایشان ماندند |
| `src/components/ai/AiCommandDeck.jsx` | `AiQuickActions`, `AiPortfolioCard`, `AiToolGrid`, `AiThinkRail`, `AiPlanCard`, `AiAgentLanes` |
| `src/components/ai/AiControlPanel.jsx` | ⚙ AI Control: حالت، سقف‌ها، شبکه‌ها، توقف اضطراری |
| `src/components/ai/AiAutomations.jsx` | فهرست اتوماسیون‌ها + فرم ساخت، همه به‌صورت «پلنی برای تأیید» |
| `src/styles/ai-command-center.css` | شیشه/تاریک/مینیمال: `#07070a` + هالهٔ شعاعی بنفش، کارت‌های بلور، گوشهٔ ۲۴px، دو ستون زیر ۶۰۰px |
| `src/lib/aiCommandClient.js` ↔ `server/aiCommand.js` | آینهٔ سرور برای snapshot/plan/stop (آفلاین؟ فقط localStorage) |
| `server/ai.js → classifyIntentWithModel` | مدل فقط وقتی کمک گرفته می‌شود که کاربر چیزی tapped نکرده و اطمینان محلی زیر ۰٫۶ است |

```
chat / tap  →  classifyIntent()  →  buildPlan()  →  orchestrate()
                                                     │
                                     validateExecution(plan, { aiControl,
                                     automations, dailyVolumeUsd, wallet,
                                     sessionLevel })   ← Execution Firewall
                                                     │
                            Approve → executionStageLedger() → hand-off به کیف پول
```

## ۲. طبقه‌بندی قصد (نه `includes('buy')`)

`AI_INTENTS = TRADE · EARN · PORTFOLIO · PROTECT · RESEARCH · AUTOMATION · GENERAL`.
`classifyIntent()` اول رأی‌های معنایی را می‌شمارد (واژگان وزن‌دار، نه زیررشته)،
بعد در صورت نیاز مدل (`server/ai.js`) نظر می‌دهد. هر پلن منشأ تصمیمش را رویش
دارد: `plan.source ∈ semantic-votes | fallback | surface-tap |
context-carry-over | model-label-only`. یعنی اگر فقط یک برچسب مدل وسط کار بوده،
پلن رویش نوشته «model-label-only» — وانمود نمی‌کند فهمیده است.
کلمات کلیدی **فقط** fallback هستند؛ هرگز به‌تنهایی تصمیم نمی‌گیرند.

## ۳. فایروال اجرا — ۱۱ بررسی، مرتب و عمداً بی‌رحم

```
EMERGENCY_STOP → NO_ACTIONS → MODE_NOT_ALLOWED → SURFACE_DISABLED →
CHAIN_NOT_ALLOWED → PER_TX_LIMIT → DAILY_LIMIT → RISK_LIMIT →
SIMULATION_BLOCKED → WALLET_REQUIRED → APPROVAL_REQUIRED
```

- **اول توقف اضطراری**: یک نشست متوقف‌شده حتی نباید محاسبه کند «اگر نبود مجاز می‌شد».
- **آخر امضا**: `WALLET_REQUIRED` همیشه true است؛ این fallback نیست، مرز است.
- سقف روزانه از **تاریخچهٔ واقعی** خوانده می‌شود (`loadIntentTxHistory()`، فقط
  امروز)، نه از یک شمارندهٔ ساختگی. `handleFinalConfirmWithBudget` اگر سقف رد
  شود رسید `blocked` با `reasonKey = AI_BUDGET_DAILY` می‌گذارد.
- `validateExecution` **هیچ‌وقت پلنی را بازتر نمی‌کند**؛ فقط می‌تواند blockedتر کند.
- `AI_CONTROL_DEFAULTS` عمداً تنگ است: `$100` برای هر تراکنش، `$500` در روز،
  ریسک `35/100`، و پنج زنجیره از شش (`BSC` پیش‌فرض خاموش). پروفایل تازه باید
  دری را باز کند، نه اینکه در باز پیدا کند.
- Solana/Tron چک‌باکس ندارند: `NON_EVM_VENUES` — صفحهٔ خودشان را دارند و هیچ
  intent adapter برای آن‌ها وجود ندارد، پس پیشنهادشان وعدهٔ توخالی بود.

## ۴. ریل «فکر می‌کنم» و هشت مرحلهٔ اجرا

`thinkingStages(intent)` برای هر قصد متفاوت است — دقیقاً همان مراحلی که اجرا
می‌شوند نشان داده می‌شوند، نه یک انیمیشن ثابت:

| قصد | مراحل |
| --- | --- |
| TRADE | understanding · portfolio · market · quote · strategy |
| EARN | understanding · portfolio · market · yield · protocolRisk · strategy |
| PROTECT | understanding · portfolio · risk · approvals · strategy |
| PORTFOLIO | understanding · portfolio · market · risk · strategy |
| RESEARCH | understanding · portfolio · market · sources · strategy |
| AUTOMATION | understanding · portfolio · schedule · risk · strategy |
| GENERAL | understanding · portfolio · market · strategy |

`EXECUTION_STAGES = plan · risk · simulation · quotes · firewall · wallet ·
signature · blockchain`. هر ردیف ledger چهار فیلد دارد:
`{ id, status, detail, attested, at }` و `at` فقط وقتی `attested` واقعی است
پر می‌شود:

- `plan`، `risk`، `firewall` از دادهٔ خودمان attest می‌شوند (تعداد legs،
  `riskScore/100`، نتیجهٔ فایروال).
- `simulation` و `quotes` فقط وقتی `done`اند که provider واقعاً جواب داده باشد؛
  در غیر این صورت `unavailable` با دلیل `no-simulation-provider-attached` /
  `a live quote is fetched at the venue, not here`.
- `wallet` بدون attest فقط `ready` است (`connect-a-wallet-to-sign` اگر نه).
- `signature` و `blockchain` همیشه `handoff`‌اند: «the signature belongs to
  your wallet, never to this app» — هیچ‌وقت سبز نمی‌شوند.

## ۵. حالت‌ها (Manual / Assisted / Autonomous) و توقف

`AI_MODES` به سطح نشست نگاشت می‌شود: manual → L1، assisted → L2، autonomous → L3.
Autonomous **فقط** یک تپ اضافهٔ «Approve» را برمی‌دارد؛ امضا هرگز لغو نمی‌شود —
این جمله در خود کارت (`intentAI.cc.control.modeNote.autonomous`) هم نوشته شده.
توقف اضطراری در `fbt.ai.emergencyStop.v1` ذخیره می‌شود و **پیش از اولین paint**
بازخوانی می‌گردد؛ اگر وسط ساخت پلن زده شود، همان لحظه دکمهٔ Approve از بین
می‌رود (تست شده). رهاسازی دو تپ ارادی می‌خواهد و سمت سرور هم
`POST /api/ai/emergency-stop/release` با `body.confirm === true` است، وگرنه `400`.

## ۶. اتوماسیون = پلن تأییدشونده، نه دستور دائمی

`AUTOMATION_KINDS = dca · rebalance · protect · yield`،
`AUTOMATION_CADENCES = daily · weekly · biweekly · monthly`. هر ردیف
`executionModel: 'per-run-user-confirmation'` دارد: حتی وقتی فعال است، هر اجرا
به تأیید کاربر نیاز دارد. `chainId` اتوماسیون از اولین زنجیرهٔ مجازِ کاربر
گرفته می‌شود، نه از یک پیش‌فرض. ورودی ناقص با کد رد می‌شود
(`AUTOMATION_INVALID` / `SCHEDULE_INVALID`) و هیچ‌وقت حدس زده نمی‌شود.

## ۷. قرارداد API (بدون متن آزاد مدل)

| مسیر | پاسخ |
| --- | --- |
| `POST /api/ai/chat` | `fbt.ai-chat.v1` + `classification{intent,confidence,surface,source,requiresClarification}` + `plan` + `verdict` + `stages` |
| `GET`/`POST /api/ai/dashboard` | `fbt.ai-dashboard.v1` + `clientSections` (پورتفوی/حجم روزانه/تأییدها از کلاینت می‌آیند) + `dataStatus` هر بخش |
| `POST /api/ai/plan` · `GET /api/ai/plan/:id` | پلن per-caller ذخیره می‌شود (`tgUser?.id ?? ip`، TTL یک ساعت، سقف ۲۰۰) |
| `POST /api/ai/plan/:id/approve` | اگر فایروال رد کند `409 FIREWALL_REFUSED` + بررسی‌های ردشده؛ وگرنه `APPROVED_FOR_WALLET_CONFIRMATION` و `requiresUserSignature: true` |
| `POST /api/ai/plan/:id/execute` | `409 BLOCKED` / `428 AWAITING_APPROVAL` / `412 WALLET_SIGNATURE_REQUIRED` / `200 HANDOFF_READY` با `executed: false, broadcasts: false` |
| `GET`/`POST /api/ai/automations` · `DELETE /api/ai/automations/:id` | CRUD با تأیید per-run |
| `POST /api/ai/emergency-stop` (+ `/release`) | دامنه: `ai-prepared-plans-and-automations-for-this-caller` + `automationsPaused` |
| `GET /api/ai/agents` | `presentation: { shownOnMainSurface: 0, hiddenByDesign: true }` |

`context` ارسالی به سرور **سانیتایز** می‌شود: آدرس و «این تراکنش را بفرست» رد
می‌شوند و صراحتاً `wallet: { connected: false, canSign: false, reason:
'wallet-lives-in-the-browser' }` اعلام می‌شود. سرور هیچ‌وقت امضاکننده نیست.

## ۸. ۱۷ ایجنت: مخفی، نه حذف‌شده

`AI_AGENTS` (۱۷ تا) سرِ جایشان‌اند و همان‌ها route را می‌سازند. در UI تنها
جای نمایش، یک `<details>` بسته داخل `AiAgentLanes` است با تیتر «Behind this
plan» و این جمله: «None of these agents can hold a key, sign, or move funds.»
هیچ کارت قابل‌کلیکی به نام یک ایجنت وجود ندارد. Market Maker،
Agent-to-Agent، Multi-Agent و Research در صفحهٔ اول اصلاً ظاهر نمی‌شوند — این
را تست `no agent is a menu item on the first screen` نگهبانی می‌کند.

## ۹. زبان (i18n)

- همهٔ کلیدهای این فاز زیر `intentAI.cc.*` در `en.json` و `fa.json` نشستند:
  **۲۳۷ leaf، کامل و متقارن** — شامل خانواده‌های پویا (`think.*`, `plan.block.*`
  برای هر ۱۱ کد فایروال، `check.*`, `action.*`, `assumption.*`, `cannot.*`,
  `alloc.*`, `risk.*`, `cadence.*`, `mode.*`, `automation.*`, `stage.*`,
  `tool.*`, `quick.*`, `agent*`).
- در `fa` تنها دو leaf بدون فارسی «FBT AI» (برند هدر، دقیقاً همان چیزی که در
  خواسته نوشته شد) و «—» (جای‌نمای خالی) هستند.
- فاصله‌های قدیمیِ غیرمرتبط با این فاز هم بسته شد: `activation.banner.*` و
  `intentAI.readiness.*` (۸ کلید) ترجمه شدند و چند برچسب انگلیسیِ باقی‌مانده
  روی همین صفحه (`intentAI.mode.*`, `intentAI.msg.intent`,
  `intentAI.flow.swapBridge`, `intentAI.confirm.tool.swap|bridge`,
  `activation.blockers/missing`) فارسی شدند.
- نتیجهٔ `node scripts/gen-locales.mjs`: **`fa` هر ۵۵۱۶ کلید en را دارد**؛
  ۵۴۲۶ تا ترجمهٔ واقعی‌اند و ۷۱ «هنوز انگلیسی» عمداً لاتین می‌مانند —
  نام برند و تیکر (`Intent OS`, `WalletConnect`, `dYdX`, `Aave V3 · {{chain}}`,
  `BNB · ETH · Polygon …`, `fbt.ai`). همچنین `intentAI.quick.phrase.intentOS`
  انگلیسی مانده چون **ورودی موتور طبقه‌بندی** است، نه متن نمایشی.
- fallback‌های ترجمه (۹ زبان جزئی ≈ ۱۷٪) به انگلیسی، طراحی است؛ `fa`/`ar`
  دستی‌اند. coverage در `src/i18n/coverage.json` تولیدی است و ویرایش دستی نکنید.
- چندجمله‌ای‌های i18next عمداً استفاده نشد (`_one/_other` به `count` نیاز
  دارند و فراخوانی‌ها `n`/`r` می‌دهند)؛ پس `portfolio.found` می‌شود
  «Opportunities found: {{n}} · Risk flags: {{r}}».

## ۱۰. تست‌ها و نحوهٔ اجرا

```bash
npm test                          # همه‌چیز؛ همان مسیری که CI می‌رود
node -e "import('./test/wiring.mjs').then(m=>{const r=m.default();console.log(r.filter(x=>!x[1]))})"
                                  # هر کلید t() استاتیک باید در en.json باشد (۲۲۴۸ بررسی)
```

این فاز با یک suite mount شده سنجیده می‌شود؛ داخل `test/run.mjs` دو خط است
(`.jsx` نیاز به build دارد، پس npm script مستقل ندارد — دقیقاً مثل فازهای ۲۰۱–۲۰۷):

```
npx vite build -c test/vite.intentai3.mjs --logLevel error
# سپس jsdom را install کنید و test/.out/intentai3/phase209-command-deck-probe.js
# را import کنید و run(root) را صدا بزنید (همان کاری که run.mjs می‌کند).
```

نتیجهٔ اجرای کامل `npm test` در این فاز (۱۴۰۵/۰۶/۰۹): **۹۴۳۹ assertion در ۱۸۵
suite، بدون هیچ شکستی** — `All suites passed.` از جمله سه suite خودِ این صفحه:
`intent AI command deck 29/29`، `intent AI panel 25/25`، `intent AI upgrade
20/20` و `wiring 2248/2248` (این آخری هر کلید `t()` استاتیک را با `en.json`
می‌سنجد، پس ترجمهٔ گمشده نمی‌تواند بی‌صدا بماند). کامپوننت‌ها mount شده و با
کلیک/تایپ رانده می‌شوند؛ «هیچ امضایی، هیچ broadcast» با stub signer سنجیده
می‌شود، نه با grep. تست boot هم تأیید می‌کند پلتفرم‌ها، first-paint budget و
سایز تکه‌ها با این صفحهٔ جدید از حد نگهبان‌ها رد می‌شوند (`the AI command center
stays out of the first paint budget`, `≤74kB of main-blocking JS on every route`).

> نکتهٔ محیطی (فقط برای ماشین‌های کوچک): روی ≈۴GB RAM، build واقعی `dist/` در
> گام `building shipped static bundle` گاهی با `SIGKILL` (۱۳۷) می‌میرد. راه‌حل
> بی‌خطر: `NODE_OPTIONS=--max-old-space-size=1800 npm test` — همان اجرای سبزِ
> بالا با این متغیر گرفته شده و ربطی به کد ندارد.

## ۱۱. چیزهایی که عمداً ساخته نشد

- صفحهٔ جدید و route جدید (خواستهٔ صریح: «فقط صفحهٔ جدید نساز»).
- هر فهرستی از ۱۷ ایجنت در صفحهٔ اول.
- اجرای خودکار، و هر state که «اجرا شد» را قبل از هش واقعی بگوید.
- نمایش Market Maker / A2A / Multi-Agent / Research در صفحهٔ اول.
- حذف قابلیت‌های قبلی: ارکستراتور و Tool Registry **روی** سیستم موجود سوار
  شدند؛ `IntentRail`/`ExecutionControls` حذف‌شده‌ها به دلیل تضاد با فاز ۱۴۲
  بازنگشتند و منطق توقف از `userStop`/`userControl` می‌آید.
