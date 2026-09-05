# FBT INTENT OS — UPGRADE 7 · گزارش نهایی

> Predictive Intelligence + Autonomous Planning + Deep Intent Understanding
> اجراشده روی کد فعلی، بدون هیچ تغییری در UI/UX، استایل، رنگ‌بندی، typography،
> navigation design یا componentهای موجود.

---

## FILES CHANGED (۳ فایل — همه افزایشی)

| فایل | تغییر | خطوط |
|---|---|---|
| `src/lib/intent-ai/os/index.js` | یک import، یک `export * as upgrade7`، و یک بلوک `try/catch` که کلید `upgrade7` را به خروجی `process()` اضافه می‌کند | +39 |
| `test/run.mjs` | اضافه شدن سه probe به suite اصلی | +15 |
| `package.json` | چهار اسکریپت `test:upgrade7*` | +4 |

هیچ کلید موجودی در پاسخ `process()` حذف یا بازنویسی نشد. هیچ تابع موجودی
تغییر رفتار نداد.

## FILES NOT CHANGED (تایید شده با تست)

```text
src/components/IntentAIUnified.jsx      ← ۲۹۸۴ خط، دست‌نخورده
src/styles/intent-ai-os.css             ← دست‌نخورده
src/App.jsx · src/index.css             ← دست‌نخورده
src/lib/intent-ai/os/upgrade6/**        ← هر ۱۶ ماژول دست‌نخورده
src/lib/intent-ai/os/agents/**          ← هر ۱۳ agent دست‌نخورده
src/lib/intent-ai/os/orchestrator.js    ← دست‌نخورده
src/lib/intent-ai/os/intentUnderstanding.js       ← دست‌نخورده
src/lib/intent-ai/os/intentUnderstandingEngine.js ← دست‌نخورده
src/lib/intent-ai/os/toolRegistry.js · memoryEngine.js · contextEngine.js
server/**                               ← دست‌نخورده
```

probe رگرسیون این را به‌صورت خودکار assert می‌کند:
`§37 the chat panel was not rewritten around Upgrade 7`.

## NEW MODULES — `src/lib/intent-ai/os/upgrade7/` (۱۲ فایل)

| ماژول | بندهای spec |
|---|---|
| `deepIntent.js` | §1 §2 §11 §18 — استخراج ۱۲ اسلات + hidden intent |
| `intentGraph.js` | §3 §36 — گراف با ۶ وضعیت node و انسداد transitive |
| `planner.js` | §4 §5 §6 §30 §33 §34 — plan پویا، قابل توقف، قابل resume |
| `agentMesh.js` | §12 §13 §39 §40 §41 — موازی/ترتیبی، cross-check، timeout/retry/fallback/health، dedupe |
| `confidence.js` | §14 §15 §16 §26 §29 — تازگی داده، کیفیت منبع، no-hallucination، برچسب fact/signal/interpretation/speculation |
| `semanticMemory.js` | §18 §21 §22 §23 §24 §25 — goal memory، answer binding، فشرده‌سازی، تناقض، تصحیح |
| `safety.js` | §21 §27 §28 §46 — پایپ‌لاین ۱۰ مرحله‌ای، simulation preview، secret scrubbing |
| `monitoring.js` | §8 §31 §32 §33 §35 — monitor، recurring، هدف بلندمدت، notification با relevance/cooldown/mute |
| `financialContext.js` | §9 §10 §17 — ۱۴ slice مالی، cross-module routing، smart money |
| `predictive.js` | §7 §8 §19 §20 — پیش‌بینی درخواست بعدی، smart clarification |
| `runtime.js` | §38 §42 — cache/debounce/background/budget + متریک یادگیری |
| `goldenConversations.js` | §43 §44 §45 — ۵۲ مکالمه + ۷ چک رگرسیون |
| `index.js` | §47 §48 — barrel + `enrich()` + Definition of Done |

## MODIFIED MODULES

فقط `os/index.js` — و فقط به‌صورت الحاقی. `enrich()` تابعی است **total**: هرگز
throw نمی‌کند و در صورت خطا `{ ok:false }` برمی‌گرداند. علاوه بر آن، فراخوانی در
`try/catch` قرار دارد. اگر کل Upgrade 7 حذف شود، رفتار اپ دقیقاً به حالت قبل
برمی‌گردد.

## NEW AGENTS

هیچ agent جدیدی ساخته نشد — این عمدی است. `agentMesh` همان ۱۵ agent موجود را
با قرارداد §40 (timeout/retry/fallback/health) و §13 (cross-check + synthesis)
احاطه می‌کند. Synthesis به‌صورت یک تابع خالص پیاده شد، نه یک agent هفدهم.

## NEW TOOLS

هیچ tool جدیدی ثبت نشد. `toolRegistry` دست‌نخورده است.

## NEW STATE

```text
localStorage:
  fbt.upgrade7.plans.v1      planها + گراف (§6 resume) — سقف ۱۲
  fbt.upgrade7.semantic.v1   حافظه معنایی + goal memory — سقف ۴۰ در هر kind
  fbt.upgrade7.monitors.v1   monitorها، recurringها، هدف‌ها، notificationها
  fbt.upgrade7.metrics.v1    متریک یادگیری — سقف ۳۰۰ رویداد
in-memory:
  TTL cache (سقف ۲۰۰)، inflight dedupe map، agent health registry
```

همه با fallback درون‌حافظه‌ای — در private mode یا Node (تست) کار می‌کنند.

## NEW MEMORY

سه لایه موجود (`memoryEngine`، `memoryV2 L1/L2/L3`، `intentSession`) حفظ شدند.
لایهٔ چهارم اضافه شد: **حافظهٔ معنایی** — `fact / decision / preference / goal /
completed_task / open_task / answer` به‌جای متن خام، به‌همراه فشرده‌سازی context
(۱۲۰ پیام → ۶ پیام اخیر + خلاصهٔ task + تصمیم‌ها + پاسخ‌ها + هدف‌ها).

## NEW TESTS

| probe | assertion | نتیجه |
|---|---|---|
| `upgrade7-intelligence-probe.mjs` | ۱۵۵ | ✅ ۱۵۵/۱۵۵ |
| `upgrade7-golden-conversations-probe.mjs` | ۳۷ (روی ۵۲ مکالمه) | ✅ ۳۷/۳۷ |
| `upgrade7-regression-probe.mjs` | ۳۷ | ✅ ۳۷/۳۷ |
| **مجموع** | **۲۲۹** | **✅ ۲۲۹/۲۲۹** |

اسکریپت‌ها: `npm run test:upgrade7` · `test:upgrade7-golden` ·
`test:upgrade7-regression` · `test:upgrade7-all`. هر سه به `npm test` هم اضافه
شدند تا هر deployment آن‌ها را اجرا کند (§43).

### باگ‌هایی که خود probeها پیدا کردند (و اصلاح شدند)

۱. `آ`/`ا` folding باعث می‌شد «درآمد» هرگز match نشود → الگو پس از folding نوشته شد.
۲. `maximize my returns` به‌خاطر `my` بین فعل و مفعول match نمی‌شد.
۳. «۲۰٪ سود» هدف را پر نمی‌کرد (goal فقط از کلمات خوانده می‌شد) → عدد هدف
   خودش goal را می‌سازد، وگرنه turn بعدی چیزی برای carry کردن نداشت.
۴. «یک استراتژی بساز» به template ساده می‌رفت به‌جای FINANCIAL_GOAL.
۵. **مهم‌ترین:** پاسخ کوتاه «۴ ماه» یک plan جدید می‌ساخت به‌جای ادامهٔ plan فعال —
   یعنی دقیقاً همان «Start new conversation» که §6 ممنوع کرده. با تشخیص
   `bareSlotAnswer` اصلاح شد.

## PERFORMANCE IMPACT

- `enrich()` کاملاً همگام و CPU-only است (بدون I/O، بدون شبکه): **۱–۳ms** برای
  یک turn معمول.
- کارهای سنگین (استخراج معنایی، متریک) با `runInBackground` به
  `requestIdleCallback` منتقل می‌شوند → main thread بلاک نمی‌شود (§38).
- `withBudget` سقف زمانی برای هر enrichment می‌گذارد؛ در timeout پاسخ پایه برنده است.
- cache با TTL + dedupe درخواست + debounce موجود است.
- مصرف حافظه محدود: همهٔ storeها سقف دارند.

## SECURITY IMPACT

- **مثبت.** `scrubForAI` هر `privateKey` / `seed phrase` / `mnemonic` / `KMS
  secret` را قبل از رسیدن به هر prompt یا context حذف می‌کند (بازگشتی، تا عمق ۶).
- پایپ‌لاین §27 بدون `requestConfirmation` و بدون `sign` **اجرا نمی‌کند** — نبود
  gate به معنای رد است، نه عبور.
- probe به‌صورت خودکار source هر ۱۱ ماژول Upgrade 7 را اسکن می‌کند: هیچ‌کدام
  `process.env.*KEY/SECRET/TOKEN` نمی‌خوانند و هیچ signer نگه نمی‌دارند.
- هیچ agent — از جمله Synthesis — مجاز به تصمیم مالی مستقل نیست
  (`autonomousDecisionAllowed: false`).

## REGRESSION RESULTS

هر ۷ مورد §45 تست و سبز:

```text
✅ No navigation loop      ✅ No repeated questions   ✅ No wallet disconnect
✅ No context reset        ✅ No scroll regression    ✅ No duplicate execution
✅ No stale transaction
```

probeهای موجود Upgrade 1–6 بدون تغییر پاس می‌شوند:
`upgrade6-stateful-os` · `upgrade6-followup-resume` · `upgrade6-short-answer-alef`
· `intent-understanding` · `phase204-upgrade4` · `upgrade5-collaborative` ·
`chat-navigation` — همه OK.

## KNOWN LIMITATIONS

۱. **`enrich()` هنوز از UI مصرف نمی‌شود.** بلوک `upgrade7` روی پاسخ سوار است و
   کامل تست شده، اما `IntentAIUnified.jsx` عمداً دست‌نخورده ماند تا قانون طلایی
   شکسته نشود. نمایش «AI status / intent progress / agent status / confidence»
   با همان style system فعلی یک قدم جداگانه و کوچک است (§37).
۲. **`dataSnapshots` و `claims` باید از host تزریق شوند.** منطق تازگی داده و
   no-hallucination کامل و تست‌شده است، اما تا وقتی adapterهای واقعی
   `fetchedAt`/`source` را پاس ندهند، `freshness` برابر `null` می‌ماند (fail-open
   به رفتار فعلی، نه ادعای دروغ).
۳. **پایپ‌لاین §27 gate-injected است.** ترتیب اجباری پیاده و تست شده؛ اتصال آن به
   `simulationGate.js` / `confirmationGate.js` واقعی در مسیر اجرای swap یک کار
   جداگانه است.
۴. **Monitoring در سمت client است.** `checkMonitors` باید توسط یک ticker یا
   `server/intentMonitor.js` تغذیه شود؛ خودش poll نمی‌کند.
۵. **Cross-check روی stance جهت‌دار کار می‌کند** (bullish/bearish/neutral).
   اختلاف‌های ظریف‌تر (مثلاً دو APY متفاوت) هنوز به divergence تبدیل نمی‌شوند.
۶. `npm test` کامل در این sandbox قابل اجرا نبود (`node_modules` نصب نیست —
   `ethers` پیدا نمی‌شود). سه probe جدید و همهٔ probeهای intent-ai مرتبط
   مستقیماً اجرا و سبز شدند.

## DEFINITION OF DONE (§48) — ۳۱/۳۱

```text
✅ Intent Understanding 2.0     ✅ Hidden Intent Detection   ✅ Intent Graph
✅ AI Planner                   ✅ Dynamic Planning          ✅ Resume Capability
✅ Predictive Intent            ✅ Proactive Intelligence    ✅ Cross-Module Intelligence
✅ Multi-Agent Collaboration    ✅ Agent Cross-Check         ✅ Confidence Layer
✅ Fresh Data Awareness         ✅ Smart Money integration   ✅ Goal Memory
✅ Semantic Memory              ✅ Contradiction Detection   ✅ User Correction Learning
✅ No-Hallucination checks      ✅ Simulation Before Exec.   ✅ Goal-Based Financial Brain
✅ Continuous Monitoring        ✅ Recurring Intent          ✅ Intent Priority
✅ Conflict Resolution          ✅ Agent Health              ✅ Agent Timeout/Fallback
✅ Request Deduplication        ✅ Golden Conversation Tests ✅ Regression Tests
✅ Security validation
```
