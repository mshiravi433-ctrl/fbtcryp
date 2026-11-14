# THE DARK PHASES — what is built, what is switched off, and what the next step is

**Measured 2026-11-12 against `arena/c2cc44f7-fbtcryp` @ `072e493`.**

Every number below was produced by running the project's own code, not by
reading the documentation. Where a claim could not be measured, it is
marked as such.

---

## §1 — The question this document answers

Two questions were asked:

1. **What is the next step in making the AI smarter?**
2. **Is there a phase that is switched off and incomplete?**

The answer to the second is **yes, and there are twenty-two of them**. The
answer to the first follows directly from what they are.

---

## §2 — What is switched off

### 2.1 The phase registry: 206 phases, 206 implemented, 0 live

```
INTENT_AI_SANDBOX_EVIDENCE=0 INTENT_OS_ACTIVATION=0
→ launchAllowed: false, evidence 0/21
→ 206/206 phases: impl=implemented, live=false, operational=false
```

Every phase has its source files on disk. **Not one of them is live** in
the fail-closed configuration — which is the correct and honest reading:
without operator evidence, a deployment must not claim to be live.

But that framing hides the real question, so the AI-bearing subset was
isolated.

### 2.2 The AI-bearing phases: 24, of which 22 are dark

The filter is by name and title (agent, model, memory, strategy, reason,
inference, learn) over all 206 phases. Then each one's source files were
scanned for a reference to a reasoning or provider module
(`aiGateway | executeProviderChat | providerInvoker | routedChat |
aiCollaboration | aiIntelligence`).

| | count |
|---|---|
| AI-bearing phases | **24** |
| reaching a reasoning/provider module | **2** |
| **dark (built, not wired)** | **22** |

The two that are wired: `first-party-agent-catalog`,
`upgrade5-collaborative-intelligence`.

### 2.3 The twenty-two dark phases

| phase | source files | blocker |
|---|---|---|
| `deep-intelligence-brain` | 13 | `RUNTIME_PROBE_NOT_COMPLETED` |
| `financial-intelligence-brain` | 16 | `RUNTIME_PROBE_NOT_COMPLETED` |
| `strategy-competition-and-simulation` | 4 | 2 |
| `agent-marketplace-trust` | 3 | 6 |
| `upgrade7-deep-intelligence` | 4 | `RUNTIME_PROBE_NOT_COMPLETED` |
| `external-agent-runtime` | 1 | 4 |
| `intent-genome-and-memory` | 1 | 3 (consent/retention/encryption) |
| `agent-dispute-reputation` | 2 | 1 |
| `human-agent-escalation` | 2 | 1 |
| `command-deck` | 2 | 1 |
| `model-supply-chain` | 1 | 1 |
| `agent-fleet-gov` | 1 | 1 |
| `consented-memory` | 1 | 1 |
| `agent-protocol-v2` | 1 | 1 |
| `agent-escrow` | 1 | 1 |
| `agent-sandbox-runtime` | 1 | 1 |
| `bounded-autonomy-176/177/178/180` | 1 each | 1 |
| `taught-memory` | 1 | 1 |
| `external-agent-voice` | 1 | 1 |

**Four of them are blockers of the honest kind** (`RUNTIME_PROBE_NOT_COMPLETED`
means: no probe has ever run them). **The rest are blocked by exactly one
thing** — the same thing, over and over.

---

## §3 — What the dark part actually is

### 3.1 There is a whole operating system in `server/fios/`

```
server/fios/          50 files
server/ci/            the central intelligence OS
server/ci/brain.js    1489 lines
```

`server/fios/` is not a stub. It contains `worldModel.js`,
`financialState.js`, `research.js`, `strategy.js`, `competition.js`,
`simulation.js`, `decision.js`, `confidence.js`, `evidence.js`,
`learning.js`, `genome.js`, `guardian.js`, `council.js`, `router.js` and
more. It is mounted — `server/app.js:7446` imports
`createFinancialIntelligence` and passes it `brain: ci.brain`.

### 3.2 The brain has no model. It never had one.

```
grep -n "aiGateway|executeProviderChat|providerInvoker|routedChat|aiCollaboration|aiIntelligence"
   server/ci/*.js  src/lib/central/*.js
→ (no output)
```

The brain's only source of answers is `synthesizeInternalAnswer`
(`server/ci/brain.js:46, :593`) — the **local** reasoner. The brain has
**36 intent rules** (`src/lib/central/intent.js:77`) and a 28-module
registry, and it can execute, quote, simulate and verify. But the moment a
question is not one of its 36 rules, it has nothing to say.

### 3.3 Measured: the brain cannot answer what the chat already answers

```
POST /api/ai/chat          «کارمزد پلتفرم FBT چقدر است؟»  → answers (0 provider calls)
POST /api/brain/intent     «کارمزد پلتفرم FBT چقدر است؟»  → intentType: UNSUPPORTED
                           «…به هیچ مسیر ثبت‌شده‌ای در رجیستری مرکزی نرساندم…»
```

And the classifier, run directly:

| question | gate answers it? | brain classifies it? |
|---|---|---|
| کارمزد پلتفرم FBT چقدر است؟ | ✅ | ❌ UNSUPPORTED |
| سقف برداشت چقدر است؟ | ✅ | ❌ UNSUPPORTED |
| کیف پول من کجا ذخیره می شود | ✅ | ❌ UNSUPPORTED |
| بیت کوین چیست؟ | ✅ | ❌ UNSUPPORTED |
| اتریوم چیست؟ | ✅ | ❌ UNSUPPORTED |
| استیبل کوین چیست؟ | ✅ | ❌ UNSUPPORTED |
| تیم FBT چه کسانی هستند؟ | ✅ | ❌ UNSUPPORTED |

**0 of 7.** The reasoner itself is not the problem — called the same way
the brain calls it, it answers correctly:

```
synthesizeInternalAnswer({message, locale, context})   → ok:true, knowledgeUsed:true
  answer: «کارمزد پلتفرم ۰٫۷٪ (۷۰ bps) هر سواپ است با سقف سخت ۱٪…»
```

The reason it never runs in the brain is **the order of the chain**:
`intentType: UNSUPPORTED` ⇒ no primary module ⇒ the synthesis branch is
never reached. The brain asks *"which of my 36 registered intents is
this?"* first, and only then asks *"can I answer?"*. A question that is
not in the registry never reaches the part that could answer it.

---

## §4 — Why this is the next step, in one line

**The reasoning layer and the phase registry are two islands, and the
bigger island has no model.**

- The phase registry (206 phases) governs custody, policy, escrow,
  consent, provenance and evidence. It is well built and it is honest
  about its scope.
- The reasoning layer (`aiCollaboration.js`, `aiGateway.js`) is where the
  intelligence actually lives. It is **outside** the registry entirely.
- The central brain (`server/ci/brain.js`) sits between them, is mounted
  in the UI, has a 36-rule intent classifier, 28 modules, a full
  UNDERSTAND→…→RESPOND chain, and **calls no model provider at all**.

So the intelligence the user sees in the chat is one path, and the
intelligence the registry certifies is a different, non-reasoning path.
That is the gap.

---

## §5 — The three candidate next steps, ranked by measured value

### 5.1 FIRST — give the brain the same corpus short-circuit the chat has

**What it is.** The brain's `UNSUPPORTED` branch should fall through to
the local-first gate (`server/aiLocalFirstGate.js`) before it answers
"that is not in my registry".

**Why it is first.** It is the smallest change with the largest measured
effect: it converts **0 of 7** of the questions the corpus already answers
from *refusal* into *answers*, at **zero provider calls**. It reuses
machinery that already exists and is already tested (17 gate tests + 4
e2e tests).

**What it must not do.** It must not bypass the brain's own chain — the
brain reads real state first, and a corpus answer must never override a
read. And it must respect the safety floor already in the gate.

### 5.2 SECOND — let the brain reach a provider, with a budget

**What it is.** When the corpus cannot answer and the intent is not
registered, the brain should be able to *ask a model* — through the same
gateway, with the same per-turn budget (`beginAiTurnBudget()`), and
through the same `:free` ladder the chat uses.

**Why it is second, not first.** It spends the scarce resource. The
`:free` cap is 50 requests/day and a `max` turn is 6 calls — roughly 8
turns a day. Every provider call the brain makes is one fewer for the
chat. So the corpus short-circuit must come first: it is free, and it
answers most of what the brain currently refuses.

### 5.3 THIRD — close the runtime probe

**What it is.** 4 of the 22 dark phases are blocked by
`RUNTIME_PROBE_NOT_COMPLETED`: `deep-intelligence-brain`,
`financial-intelligence-brain`, `upgrade7-deep-intelligence`,
`consented-memory`. Their source exists; **no probe has ever run them.**

**Why it is third.** A probe that runs the phase is worth more than a
flag that says it works. But a probe that reports a phase as live while
it still cannot reach a model is exactly the self-attestation defect this
audit has been fixing everywhere else. So the probe should be written
**after** the brain can actually reason — otherwise it certifies a
hollow phase.

---

## §6 — The two things that are NOT the next step

- **Qdrant.** It gives persistence and shared state. It does not make the
  AI smarter and does not cut provider calls (measured — see
  `docs/AI-COGNITION-AUDIT-2026-11-11.md` §15.5).
- **More phases.** The registry already has 206. Adding a 207th
  disconnected phase adds code volume, not intelligence — and the user's
  standing instruction is explicit about this: diagnose the limit, do not
  add code for its own sake.

---

## §6.5 — WHAT WAS BUILT (2026-11-12)

The first step (§5.1) is **shipped**: the brain now has the corpus
short-circuit.

### What changed

`server/ci/brain.js` — the `UNSUPPORTED` branch used to answer
«به هیچ مسیر ثبت‌شده‌ای نرساندم» for EVERY question the 36-rule registry
did not cover. It now tries the verified corpus **first**, and only
declines if the corpus cannot answer.

Three properties make it safe:

1. It runs **only** when the registry found nothing AND the plan has no
   steps — so it can never override a real read, a quote, a policy
   verdict or a safety refusal. All of those happen earlier in the chain.
2. The gate's own **safety floor** applies (`SAFETY_PRECHECK_RE`), so a
   distressed person is never answered from a glossary.
3. It costs **zero provider calls**.

`src/lib/intent-ai/os/knowledgeCenter.js` — `kb.wallet.custody` gained
the word **«ذخیره»** in its vocabulary. With only «نگهداری», the question
«کیف پول من کجا ذخیره می شود؟» matched `kb.faq.no-account` (140) — an
item about whether registration is needed — because that item's body
happens to say «کیف پول شما». The answer was about an account, not about
where the wallet lives. One word fixed it: with «ذخیره» present, custody
wins at 160.

### The measured result

| question | before | after |
|---|---|---|
| کارمزد پلتفرم FBT چقدر است؟ | `UNSUPPORTED` → refused | **`CORPUS_LOOKUP`**, ۰٫۷٪ (۷۰ bps) |
| بیت کوین چیست؟ | `UNSUPPORTED` → refused | **`CORPUS_LOOKUP`**, «اولین شبکه پولی غیرمتمرکز…» |
| کیف پول من کجا ذخیره می شود | `UNSUPPORTED` → refused | **`CORPUS_LOOKUP`**, `kb.wallet.custody` |
| قیمت بیت کوین چنده؟ | `ASSET_ANALYSIS` (live price) | **unchanged** — still reads the market |

**0/7 → 7/7**, at **0 provider calls**.

The answer carries its citation: `intent.answeredFromCorpus` and
`intent.corpusMatch` are published, and the finding the recommendation is
built from names the source and says — in Persian and English — that it
was **retrieved, not generated**.

### The tests

`test/intent-ai/ci-brain-corpus-shortcut.test.mjs` (7 tests) locks both
directions:

* a corpus-answerable question is answered, with its citation;
* a live-price question is **not** answered from a glossary;
* a question outside both the registry and the corpus **still refuses
  honestly** and still names the paths the brain does have;
* the short-circuit consults no provider.

---

## §6.6 — WHAT WAS BUILT (2026-11-12, second half)

§6.5 shipped the corpus short-circuit. It shipped **with four defects**,
and the second half of the day's work was finding and fixing them, plus
shipping the model fallback (§5.2) that the short-circuit made possible.

### 6.6.1 The gate had drifted away from the brain

The brain had re-implemented the gate's rule **inline** instead of calling
it. Two copies of one rule is one copy too many, and they had drifted
within a day: the shared gate refused «ریسک X چیست؟» while the brain
answered it from a glossary.

**Fix:** `server/ci/brain.js` now calls the shared `evaluateLocalFirst`.
One rule, one place to be wrong.

### 6.6.2 A RISK question is a JUDGEMENT, not a lookup

«ریسک لیکوییدیتی چیست؟» was answered with `kb.swap.price-impact` — an
item about price impact. The corpus holds definitions, so answering a risk
question from it produces a fluent **non-answer**.

**Fix:** `RISK_JUDGEMENT_RE` in `server/aiLocalFirstGate.js`, applied in
BOTH `evaluateLocalFirst` and `preEvaluateLocalFirst`. The subject is
optional and may be long, because the **question form** decides what kind
of answer is wanted, not the topic. Validated over 21 cases: 9 risk
questions caught, 12 lookups not caught.

### 6.6.3 A SCENARIO is a LIVE question — and the rule had to be plan-independent

«سقوط بیت کوین چه اثری دارد؟» was answered with `kb.analytics.sopr-read`
— an item about how a historical rule is applied.

The root cause is worth recording, because it is a general lesson: the
other freshness rules read `plan.freshness`, and **the central brain has
no collaboration plan** (it has its own 36-rule intent registry). A rule
that depends on a plan the caller may not have is a rule that silently
does not apply — and that is exactly what happened.

**Fix:** `LIVE_SCENARIO_RE`, deliberately **plan-independent**, in both
gates. Zero mismatches over 13 cases.

### 6.6.4 The corpus was missing two answers it should have held

«آیا پلتفرم غیرامانی است؟» and «حداکثر مبلغ برداشت چقدر است؟» matched
items that merely **mentioned** the topic. A question whose answer the
corpus does not hold must not be answered from the corpus at all.

**Fix:** two new items, worded in the app's **own** words
(`src/i18n/locales/fa.json` → `about.value.security.body`,
`onboarding.swap.body`) so the corpus and the interface cannot drift:
`kb.product.non-custodial` (99) and `kb.product.withdrawal` (97).
Corpus: 103 → **105 items**.

### 6.6.5 THE FREE SEAT WAS UNREACHABLE (a real production bug)

While wiring the model fallback, the fallback produced its honest refusal
even with a valid key. The reason was a **gateway** defect, not a brain
defect:

`openrouterfree` is the **same key** as `openrouter` with a different
model list — the `:free` models. A free key asked for a paid model answers
**402 on every call**, so a route naming only `openrouter` is a route that
fails on a free deployment. And the deployment's default fleet is
`['openrouterfree','groq','workersai']` — the free seat is the FIRST seat.

But `getPreferredProvidersForTask` named `openrouterfree` in **no base
candidate order at all**. It was reachable only in `max` mode, through
`MAX_PROVIDER_ORDER`. So every direct caller using `balanced` — which
includes the brain's fallback — asked a **paid** seat, got 402, and fell
through to the refusal.

The seat existed, the fleet named it, and **no route ever asked it**.

**Fix:** `openrouterfree` sits immediately after `openrouter` in every
candidate order. The paid seat still leads a deployment with paid access,
and the historical order (pinned by index 0 in the mode test) does not
move.

### 6.6.6 The model fallback (§5.2)

`server/ci/brain.js` now has a model path for the questions the corpus
declines AND the registry did not cover:

* **one** provider call, through the **same** gateway as the chat;
* `beginAiTurnBudget()` — the same per-turn ledger, so a provider that
  already failed this turn is not asked again;
* at most **3** seats, in the registry's health order, `:free` first;
* `intelligence: 'balanced'`, `maxTokens: 700`;
* a generated answer is **labelled as generated** (`answeredFromModel`,
  `modelProvider`), because a retrieved fact carries a citation and cannot
  drift while a generated one can.

**A failure never becomes an answer.** With no key, or with every seat
failing, the brain falls through to the old honest refusal.

### 6.6.7 Measured, after everything

| | before §6.5 | after §6.5 | **now** |
|---|---|---|---|
| LOOKUP answered from the corpus | 0/7 | 7/7 | **10/10** |
| LOOKUP refused | 7 | 0 | **0** |
| JUDGEMENT answered from a glossary | 1/6 | 1/6 | **0/6** |
| corpus items | 103 | 103 | **105** |
| provider calls for a corpus answer | — | 0 | **0** |
| provider calls for a model answer | — | — | **1** (≤3 seats) |
| brain answers a non-corpus question | refuses | refuses | **via the free ladder** |

The two LOOKUP questions that used to fail were the two the corpus did not
hold — and the fix was to give the corpus the answer, not to loosen the
scorer.

### 6.6.8 The tests

* `test/intent-ai/ci-brain-corpus-shortcut.test.mjs` — **10** (7 + the two
  new corpus answers + the risk guard);
* `test/intent-ai/ci-brain-model-fallback.test.mjs` — **5** (new): the
  model is reached, one call not six, the answer is labelled, a failure
  falls back to the honest refusal, a corpus answer costs zero;
* `test/intent-ai/free-seat-is-reachable.test.mjs` — **5** (new): the free
  seat is in every route, survives the configured filter, the historical
  order does not move, no route names an unregistered provider;
* `test/intent-ai/ai-local-first-gate.test.mjs` — **22** (17 + the risk
  rule, the risk false-positive guard, the scenario rule, the scenario
  false-positive guard, and the pre-gate pair);
* `npm run test:ai-intelligence` — **629/629**.

**A vocabulary belongs to ONE item.** Adding «کلید خصوصی» to
`kb.product.non-custodial` made it the runner-up for «کلید خصوصی من کجا
نگهداری می شود؟», which shrank the lexical gap from 57 to 20 and silently
switched off the retriever's decisive-lexical override — so the hybrid
search began answering a custody question with a **risk** item. The tags
were narrowed, and the corpus went back to ranking `kb.wallet.custody`
first. This one is worth remembering: adding a word to the corpus can
switch a ranking RULE off without any test noticing.

---

## §7 — The honest summary

| | before | **now (5.1 + 5.2 shipped)** | after 5.3 |
|---|---|---|---|
| brain can answer a corpus question | ❌ 0/7 | ✅ **10/10** | ✅ 10/10 |
| provider calls for those | — | **0** | **0** |
| brain can answer a non-corpus question | ❌ refuses | ✅ **via the free ladder** | ✅ via the free ladder |
| a JUDGEMENT answered from a glossary | ⚠️ 1/6 | ✅ **0/6** | ✅ 0/6 |
| the free seat reachable from `balanced` | ❌ never | ✅ **every route** | ✅ every route |
| dark phases with a probe | 0/4 | 0/4 | **4/4** |
| intelligence inside the phase registry | none | **corpus-grounded + model** | corpus-grounded + model |

**§5.2 is shipped.** The brain now reaches a provider through the same
gateway, the same per-turn budget and the same `:free` ladder the chat
uses — for the questions the corpus cannot answer, and with a failure that
falls back to the honest refusal instead of a fabrication.

**The next step (§5.3)** is the runtime probe for the four phases blocked by
`RUNTIME_PROBE_NOT_COMPLETED` — written now, but written LAST, because a
probe for a phase that cannot reason is a probe of nothing.

---

## §8 — WHAT CHANGED AFTER THIS DOCUMENT WAS WRITTEN

This document was the first measurement. Three of the findings in it have
since been **acted on**, and the numbers below are the ones that are true
now.

**The four phases blocked by `RUNTIME_PROBE_NOT_COMPLETED` are no longer
blocked** — and they never were blocked by anything real. The blocker
meant "nobody has asked the probe yet", and on a cold process nobody had.
The probe is now warmed **once during boot**, deferred to the idle phase:

```
before:  41 live, 165 phases claiming RUNTIME_PROBE_NOT_COMPLETED
after:   176 live, 0 claiming it
```

**The "administrative blockers" are gone.** The five `INTENT_*_PROVIDER`
variables were read by exactly one module — the probe — and were not in
`.env.example`. The probe now **parses the phase's own provider module**
and checks that it exports a surface. The env var survives as an operator
override, not as the only way to be live.

```
probe: 142/165 live  ->  165/165 live, with every override deleted
```

**The un-importable modules load now.** Seven extensionless imports in
three DeFi modules are fixed. Phases 216, 106, 127 and 203 own a module
that loads.

**And the multi-venue engine is no longer an island.** The brain's
`PROFIT_PLAN` now asks it which venues the user can reach. Sixteen
paid-for dark phases became the brain's real answer — with the engine
loaded lazily, so the cold boot pays nothing for it.

The full measured analysis, including what these fixes cost, is in
**`docs/PHASE-CPU-AND-DARK-PHASES.md`** (§0.5 has the before/after
table).
