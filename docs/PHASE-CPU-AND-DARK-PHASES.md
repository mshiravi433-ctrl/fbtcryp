# WHICH PHASES ARE ALIVE, WHICH BURN CPU, AND WHAT IS BROKEN

**Measured 2026-11-12 on branch `arena/c2cc44f7-fbtcryp` (`6f3d37e`).**
Every number below came out of a harness in `scripts/`, not out of a guess.

---

## §0 — The three questions, and the three answers

| question | answer |
|---|---|
| Which phases are active, operational, and **connected to the AI**? | **51 of 206** reach a reasoning module. The registry says 206 implemented; the probe now says **206 live**; but only **51** are actually connected to the AI — the rest are reachable code that nothing asks. |
| Which ones **occupy the Fluid Active CPU (4 h)**? | **70 phases** are on the boot path — the deployment pays for those on every cold invocation. **49 of them are dark** and cost **926 KB** of module graph for nothing. |
| Which phase is **incomplete or broken**, and what are the upgrade paths? | The "dark" story had **one root cause** — the blocker was *administrative*, not operational — and it is **now fixed**: the probe measures instead of guessing, and the boot warms it. What remains broken is **4 phases** whose module will not import at all (a missing `.js` extension, pre-existing on `main`). |

The three harnesses that produced this:

```
node scripts/measure-phase-cpu.mjs          # lifecycle: live vs dark
node scripts/measure-phase-wiring.mjs       # the import graph: wired to the AI or not
node scripts/measure-cold-import-graph.mjs  # what the boot path actually loads
node scripts/measure-cron-cpu.mjs           # the background routes
node scripts/measure-ai-route-cpu.mjs       # the request path
node scripts/measure-phase-import-cost.mjs  # per-phase module-load CPU
node scripts/find-extensionless-imports.mjs # imports Node ESM cannot resolve
```

---

## §0.5 — WHAT WAS ACTUALLY FIXED, AND WHAT IT COST

**All seventeen** upgrade paths in §5 are **shipped** (5.1–5.6 plus the
seventh, the yield surface, in §5.9, the eighth, the global surface, in
§5.10, the ninth, the daily cron, in §5.11, the tenth, the measured
prompt diet, in §5.12, the eleventh, the fit surface, in §5.14, the
twelfth, the macro graph, in §5.15, the thirteenth, the goal
scenarios, in §5.16, the fourteenth, the quota and the route engine, in
§5.17 and §5.18, the fifteenth, the why engine, in §5.19, and the
sixteenth, the session machinery, in §5.20). The point of this section
is that each one is a measurement before and after, not a promise.

And then the rule the last three failures left behind — *a test that
drives an engine directly proves the engine; only a test that drives a
TURN proves the engine is REACHED* — was applied to the **whole
library**, as a sweep over every engine's own route (§5.21 and §5.22).
It found two more bugs on the first run: a question about which bridge to
use was being read as an instruction to move the money, and an owner whose
debt had never been read had no capital for seven engines. Both are
fixed, and the guarantee is now a gate rather than a claim.

And the intent list was then grown to **all thirty-six**, which found
**five more**. The ten that were missing were the **EXECUTION** ones —
the ones where a misclassification is a transaction the user did not ask
for — and asking about them found five holes in the language itself: a
navigation pattern that read a bridge as a page, a frozen array sorted
in place (which killed every cancellation turn), an intent with no rule
at all, two verbs nobody had written down, and a possessive sitting
between a noun and its verb. All five are fixed, and the sweep is now a
gate over every intent (§5.22).

And then the guarantee was pointed at the **sentence** rather than the
engine, and the sentence failed in a way no engine test could see: a
person asks two things when they say two things, and the brain answered
ONE of them — cleanly, confidently, with a headline and a reason and a
confidence — and dropped the other half without a word. **Five of twelve
parts answered (41.7%).** The merge machinery already existed for
«convert, then bridge»; only the DETECTION of a generic «X و Y» was
missing. The sentence is now split, each half is classified on its own,
and the plan reads both — **twelve of twelve** — with the guarantee that
a compound **question** never gains an execution leg, because a question
is not a permission (§5.23).

| | before | after |
|---|---|---|
| phases the probe calls **live** | 142 / 165 | **165 / 165** |
| phases reporting `RUNTIME_PROBE_NOT_COMPLETED` on a cold process | **165** | **0** |
| `phaseStatusReport()` from a cold process | 41 live | **176 live** (206 with the control planes attested) |
| the probe's cost | 134 ms (and **761 modules**) | **40 ms** (and **+3 modules**) |
| modules a phase owns that will not import | **4** (216, 106, 127, 203) | **0** |
| the brain's profit plan | a local derivation | **+ the venue view**, with each venue's health and reason |
| extensionless imports in the server tree | 0 (but 7 in phase-owned modules) | **0** |
| adapter failure shape | `{ code, detail }` — no `ok` | **`{ ok: false, code, detail }`** |
| `GET /api/intents/v1/phase-status` | 148,394 B | **23,471 B** (summary; `?detail=1` still returns the full report) |
| `/api/cron/daily` | one number, 563 ms | **eleven named jobs, each with its own ms** |
| modules an intent asks for | 27 of 30 | **30 of 31** (the one left is `prediction`, `FEATURE_GATED` by design) |
| «بهترین ییلد کجاست؟» | `UNSUPPORTED` | **`YIELD_OPPORTUNITY`** → a live APR, with the risk and depth beside it |
| «ریسک نقدینگی LP چقدره؟» | `UNSUPPORTED` | **`LIQUIDITY_RISK`** → the impermanent-loss flags |
| an upstream failure's detail | empty | **the real reason** («fetch failed») |
| `server/fios/` exports the brain can reach | **0 of 50** | the global-intelligence set (§5.10) |
| registered modules | 30 | **31** (the 31st is `global-intel`) |
| intents | 29 | **33** |
| the daily cron's self-probe | re-measured 6-hour-old evidence | **reports what is still valid** — *with a durable store; §5.11.1* |
| the smart-money index | ran from two crons | **one pass per 12-hour window**, and it says so — *with a durable store; §5.11.1* |
| `/api/cron/daily` CPU | 621 ms | **469 ms** measured here — *the reuse path needs a store to fire; §5.11.1* |
| «پول هوشمند کجاست؟» | `UNSUPPORTED` | **`SMART_MONEY_READ`** → the global section is read |
| the prompt's share of evidence | 92.5 % contracts, 5.3 % facts | **measured** — a prompt diet has nothing to cut (§5.12) |
| the durable audit board | claimed verified, checked nothing | **reports `DURABLE_STORE_NOT_CONFIGURED` until a store exists** |
| «کدام گزینه مناسب من است؟» | `UNSUPPORTED` | **`OPPORTUNITY_FIT`** → the ranking, with the profile it was scored against |
| the brain over HTTP | `PROVIDER_NOT_WIRED` for every global/fit question | **the real engines answer** — the provider is wired on the first turn (§5.14) |
| «بازار در چه رژیمی است؟» | breadth + the top movers | **the regime**: the macro graph over the global snapshot, the world model and the portfolio (§5.15) |
| «برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟» | one feasibility figure | **three profiles** with drawdown, probability of loss and probability of halving (§5.16) |
| the free tier's daily allowance | invisible — learned by getting a 429 | **counted per provider per UTC day**, published before it runs out, and the day's real yield measured at **twelve questions, not eight** (§5.17) |
| a deep turn's provider calls | unbounded within the turn | **capped** (`AI_MAX_PROVIDER_CALLS`, default 6 — the sixth is the repair pass), and the dropped stages are named (§5.17) |
| a spent day's provider calls | still made, and answered with a counted 429 | **refused before the request**, and the turn reports `quotaExhausted` (§5.17) |
| the answer cache across instances | one in-memory `Map` — a cold start emptied it | **durable**, so a repeated question costs one collaboration, not two (§5.17) |
| «کدام پل برای انتقال بهتر است؟» | `UNSUPPORTED` | **`ROUTE_INTELLIGENCE`** → the live candidates, ranked, with the unread dimensions named (§5.18) |
| «چرا این را گفتی؟» | `UNSUPPORTED` | **`WHY_DECISION`** → five reason lines and four named falsifiers (§5.19) |
| the conversation's own shape | not modelled | **a state machine in the session layer**, asking ONE adaptive question (§5.20) |
| a replan when the world moves | computed, never read | **read by the turn**, and announced only when something decision-relevant changed (§5.20) |
| `server/fios/` engines that reach an ANSWER | 0 of 50 | **47 of 47** — measured over each engine's OWN route, not by import (§5.21, §5.22) |
| intents whose engine reaches the REPLY | — | **35 of 35**, in a real brain turn (§5.22) |
| sentences that reach the intent they were written for | — | **35 of 35** — the ten EXECUTE intents found five holes in the language (§5.22) |
| the owner's capital, when the debt was never read | `null`, and seven engines reasoned about nothing | **the gross assets**, through one shared helper — and the debt is still never guessed (§5.22) |
| the first paint, after the route work | 1839.71 KB — over the budget | **1815.05 KB** — the crypto stack is out of the entry path, and a gate now reports the EDGE (§5.22) |
| the halves of a TWO-PART question | one half, silently — 5 of 12 parts | **12 of 12** — the sentence is split, each half is classified, and the plan reads both (§5.23) |
| a compound question that became a transaction | possible — the split could have produced an EXECUTE leg | **0 execution legs, 0 money steps** — a question is not a permission, and the gate checks the plan (§5.23) |
| «ریسک چقدر است؟» | `UNSUPPORTED` — the risk engine had no intent to reach it | **`RISK_OVERVIEW`** → the full verdict, with its factors (§5.23) |
| «موجودی من چقدره؟» | «wallet.read: 2 balances across 2 chain(s)» — a COUNT | **the total and every row** (§5.23) |

### The three root causes, and what each one was

**1. A race.** `phaseStatusReport()` is synchronous; the probe is
asynchronous. Immediately after boot, **165 phases** reported
`RUNTIME_PROBE_NOT_COMPLETED` and only **41** were live. After
`refreshProductArcProbe()` the same process reported **0 blockers and 153
live**. Only the two status routes forced the probe; nothing else did.
⇒ **The probe is now warmed once during boot**, deferred to the idle
phase so it never competes with the first request.

**2. Made-up env vars.** `INTENT_VENUE_PROVIDERS`,
`INTENT_WALLET_PROVIDER`, `INTENT_EXECUTION_FEED`,
`INTENT_BRIDGE_PROVIDERS` and `INTENT_BROKER_PROVIDERS` were read by
**exactly one module** — the probe itself — and were **not in
`.env.example`**. With them set, the probe said 165/165 live. Without
them, it said 142/165. Meanwhile `server/multiVenue.js` had already
imported `fetchDydxMarkets`, `fetchPerpMarkets`, `fetchYields` and
`fetchAvantisEquities`, and was already serving
`/api/intents/v1/multi-venue/status`.
⇒ **The probe now measures the module instead of reading a name.** It
parses the phase's own provider module and checks that it exports
something. The env var survives as an operator *override*, not as the
only way to be live.

**3. Missing `.js` extensions.** `src/lib/defi/compoundV3Base.js`,
`compoundV3Lending.js` and `morphoBlueBase.js` imported `'../chains'`,
`'../swap'`, `'../preSignSimulation'` and `'./executionGuards'` without
the extension. Node's ESM resolver refuses them. Vite does not — so the
browser build was fine and the server was not.
⇒ **Seven suffixes added.** Phases 216, 106, 127 and 203 now own a
module that loads.

### The one that was NOT a fix

The first version of the new probe **imported** the provider modules. It
was correct and it was ruinous: the barrel `src/lib/intent-ai/index.js`
pulled in **761 modules** and **+459 ms of CPU** on every cold start, to
answer a yes/no question about a deployment that had already loaded it.
The probe now **parses** instead of **executing**, and the barrel import
is gone.

That is worth stating plainly, because it is the shape of the whole
problem: *the obvious way to make the report honest is to run the code,
and running the code is the expensive part.*

---

## §1 — The lifecycle: what is really alive

```
phases in the registry        206
implemented (files present)   206
LIVE (runtime probe)          165 / 165   ← after the fix; 142 before it
dark (built, not running)      64         ← before the fix; 41 after it
```

Three different numbers describe the same registry, and the gap between them
IS the problem:

| number | what it means | who says it |
|---|---|---|
| **206** | the files exist | the registry's `implementation: 'implemented'` |
| **165** | the phases are the product arcs (>50) | the runtime probe's denominator |
| **142** | the files exist, the probe file is >200 bytes, and the provider env var is set | the runtime probe |
| **41** | the phases are live **right now, in this process** | `phaseStatusReport()` |
| **153** | …the same, once the async probe has run | `phaseStatusReport()` after `refreshProductArcProbe()` |

### §1.1 The 41-versus-153 gap is a race, not a truth

```
IMMEDIATELY after boot:  165 phases report RUNTIME_PROBE_NOT_COMPLETED   (41 live)
AFTER the probe has run:   0 phases report RUNTIME_PROBE_NOT_COMPLETED  (153 live)
```

`phaseStatusReport()` is **synchronous**; the probe is **asynchronous**. The
probe's result is cached, refreshed in the background, and forced fresh by
the two status routes before they answer. So on a **cold Vercel invocation**
the report is *correct* only on the two routes that force it — and
*wrong* everywhere else, for as long as the process lives.

On a serverless platform a cold invocation is a new process, so this is not
an edge case: **the first thing a fresh instance computes is a wrong
answer**, and it computes it by importing the whole phase registry, the
runtime probe, and the evidence store to do it.

**This is both a correctness bug and a CPU cost.** Fixing it is §5.1.

### §1.2 The blockers are administrative

Of the 64 dark phases:

| count | blocker | what it really means |
|---|---|---|
| 41 | *(none reported — control planes 10–50)* | they need **operator evidence**, not code |
| 23 | `RUNTIME_PROBE_NOT_COMPLETED` | the probe had not run yet — §1.1 |

And the 23 that the probe *does* judge are blocked by this:

```
VENUE_ADAPTER_REQUIRED     → env INTENT_VENUE_PROVIDERS
WALLET_RUNTIME_REQUIRED    → env INTENT_WALLET_PROVIDER
EXECUTION_FEED_REQUIRED    → env INTENT_EXECUTION_FEED
BRIDGE_PROVIDER_REQUIRED   → env INTENT_BRIDGE_PROVIDERS
BROKER_PROVIDER_REQUIRED   → env INTENT_BROKER_PROVIDERS
```

**Those five env vars are read by exactly one module — the probe itself.**

```
$ grep -rn "INTENT_VENUE_PROVIDERS" --include="*.js" --include="*.mjs" . | grep -v node_modules
server/intentPhaseRuntimeProbe.js:47:  { pattern: /venueHealth|multiVenue|.../i, blocker: 'VENUE_ADAPTER_REQUIRED', env: 'INTENT_VENUE_PROVIDERS' },
```

Nothing else reads them. They are not in `.env.example`. They do not
activate a provider, a venue, a signer, or a feed. **Setting them changes
the report and nothing else.**

And what the probe said was not true without them:

```js
// server/multiVenue.js
import { fetchDydxMarkets } from './dydx.js';
import { fetchPerpMarkets } from './perp.js';
import { fetchYields } from './yields.js';
import { fetchAvantisEquities } from './avantis.js';
```

The venue adapters were **already imported, already in the boot path, and
already serving** `/api/intents/v1/multi-venue/status` and
`/api/intents/v1/profit-plan`. The probe declared them "not configured"
because a string in the environment did not have the right name.

**This is now fixed (§5.2, shipped).** The probe no longer asks a
made-up question. It IMPORTS the phase's own provider module and checks
that it loads and exposes an API — a measurement of this deployment, made
locally, with no network call. The env var survives as an operator
*override*, not as the only way to be live.

Measured, with the overrides deleted:

```
$ node -e "probeProductArcPhases()"
live: 165 / 165
still not live: 0
blockers: {}
```

**23 phases went dark-to-live because the report stopped guessing.**

---

## §2 — What occupies the CPU

### §2.1 The boot path is the bill

```
modules loaded          309
project modules loaded  297
wall                     321–607 ms
CPU                       ~340 ms
RSS                        124 MB
heap                        31 MB

+ the phase-probe warm-up, once per instance:
  wall                       +40 ms
  CPU                        +65 ms
  modules                     +3
```

> The probe used to cost **134 ms** because it IMPORTED the shared
> `src/lib/intent-ai/index.js` **barrel**, which pulled in **761
> modules** to answer a yes/no question. It now **parses** the 15
> provider modules instead of executing them — and that change is what
> keeps the warm-up affordable at all.

(The wall range is sandbox noise: the same measurement ranged 688–1,211 ms
across runs with the barrel import still in place. The CPU figure is the
stable one, and it is what the budget is measured in.)

On Vercel, a module imported once per cold start is paid for on **every**
invocation until the instance is recycled. A module nobody imports costs
nothing, forever. So the import graph IS the bill.

**70 phases** own a module in that graph. **49 of them are dark** — the
deployment pays for them on every cold start and gets nothing.

```
DARK PHASES THE DEPLOYMENT PAYS FOR

phase  id                                     KB   why
  106  profit-target-intake                 441   VENUE_ADAPTER_REQUIRED
  150  effectiveness-self-audit              64   VENUE_ADAPTER_REQUIRED
  105  farm-yield-adapter                    46   VENUE_ADAPTER_REQUIRED
   10  agent-marketplace-trust               37   —
   21  operational-activation                26   —
  104  futures-funding-adapter               22   VENUE_ADAPTER_REQUIRED
  101  multi-venue-bridge                    21   VENUE_ADAPTER_REQUIRED
  103  dydx-global-adapter                   19   VENUE_ADAPTER_REQUIRED
  102  stocks-venue-adapter                  18   VENUE_ADAPTER_REQUIRED
   12  smart-wallet-policy-guardian          15   —
  107  multi-venue-allocation                14   VENUE_ADAPTER_REQUIRED
  108  reachability-honesty                  14   VENUE_ADAPTER_REQUIRED
  109  target-progress-tracking              14   VENUE_ADAPTER_REQUIRED
  110  venue-switch-suggestion               14   VENUE_ADAPTER_REQUIRED
  111  plan-persistence                      14   VENUE_ADAPTER_REQUIRED
  112  plan-lifecycle                        14   VENUE_ADAPTER_REQUIRED
  113  plan-risk-refresh                     14   VENUE_ADAPTER_REQUIRED
  114  plan-confirmation-gate                14   VENUE_ADAPTER_REQUIRED
  115  plan-receipts                         14   VENUE_ADAPTER_REQUIRED
  116  plan-notifications                    14   VENUE_ADAPTER_REQUIRED
   51  wallet-signing-runtime                11   WALLET_RUNTIME_REQUIRED
   19  security-privacy-compliance             8   —
   30  launch-control-plane                    8   —
  129  localized-plan-flow                      7   VENUE_ADAPTER_REQUIRED
   52  live-quote-lock                          6   EXECUTION_FEED_REQUIRED
   55  mev-shield                               6   EXECUTION_FEED_REQUIRED
   23  sandbox-mesh                             3   —
   25  signer-guardian-ops                      3   —
   29  assurance-network                        3   —
   35  public-disclosure                        2   —
   40  sustainment-governance                   2   —
                                                   ─────
                                            926 KB
```

Note the shape of it: **phases 101–116 are sixteen phases sharing ONE
module** (`src/lib/intent-ai/multiVenuePlanner.js`, 14 KB each) plus
`server/multiVenue.js` and `server/financialGoals.js`. The 441 KB of
phase 106 is `server/app.js` — the whole application — attributed to one
phase because that phase names it as its source. The attribution is
honest; the conclusion is that **a phase list that names `server/app.js` is
not a cost model.**

### §2.2 The background routes

```
route                              status   wall ms   CPU ms   heap ΔMB
/api/cron/daily                       200      518      630       15.3
/api/cron/scenario-evidence           200     1073      334        3.0
/api/cron/smart-money                 200       48       23        0.7
/api/cron/train                       200        9       17        0.6
/api/cron/status                      200        7       15        0.2
/api/cron/monitors                    200        4        8        0.2
/api/cron/watch                       200        4        8        0.2
/api/cron/tick                        200        4        8        0.2
                                    ────────  ───────  ────────
TOTAL                                          1,667     1,043
```

**Two routes are 92 % of the background CPU:**

* **`/api/cron/daily` — 630 ms.** It is not one job; it is *eleven*
  (`sendDailyPromo`, `sendDailyFcm`, `runWatchCycle`, `maybePriceWatchTick`,
  `evaluateAllMonitors`, `smartMoneyCadence`, `sweepCertifications`,
  `getReputationSnapshot`, `runSelfProbe`, `runOpsProbe`, `runStage3Probe`)
  plus four evidence hydrations, all in one slot. It also leaves **15.3 MB**
  of live heap behind, which is the number that matters: a warm instance
  that carries 15 MB of survivors re-imports less, but a cold one pays the
  whole graph again.
* **`/api/cron/scenario-evidence` — 334 ms.** One record, one archive write.

Neither of these is an *intent phase*. They are the application's own
chores — and they are where the background CPU actually goes.

### §2.3 The request path

```
route                                 status   cold ms   warm ms     bytes
POST /api/ai/ask                        200       197        65       337
POST /api/ai/brief                      502        10        14        40
POST /api/ai/outlook                    400        21        10        23
GET  /api/intents/v1/phase-status       200       199        50   149,556
```

Two facts stand out.

**The AI route costs 65 ms warm to return 337 bytes.** That is the chat
path — the one the user actually types into.

**The status route costs 50 ms warm to return 150 KB.** Its body is
`phases` (116 KB, all 206 rows with their full detail) and `phase21`
(30 KB). It is a **reporting** endpoint, and it is paid for on every hit.

Against the 4-hour allowance (14,400,000 ms):

| route | warm CPU | calls that use half the window |
|---|---|---|
| `POST /api/ai/ask` | 65 ms | 110,769 |
| `GET /api/intents/v1/phase-status` | 50 ms | 144,000 |

Neither route is close to the allowance on its own. **The allowance is not
consumed by a hot route — it is consumed by the number of cold starts**,
and a cold start is 1,009 ms of import CPU (§2.1).

### §2.4 The AI is not the CPU hog — and that is the finding

```
CPU per turn (measured earlier):  provider calls, not milliseconds
corpus short-circuit:             10/10 questions answered at 0 provider calls
brain cold import:                198 ms
```

The deployment's constraint has never been CPU. The `:free` quota is 50
requests a day; a `max` turn costs 6 calls; that is ~8 turns a day — and
**that figure was itself wrong**, because it divided the allowance by the
FULL turn cost and ignored that the last questions of a day cost less
(§5.17). Measured, the day buys **twelve** questions, not eight. The
Fluid CPU allowance is a *secondary* limit that only becomes visible when
the cold-start count is high.

**So the CPU work below is worth doing for correctness first and cost
second.** That is the honest order.

---

## §3 — Which phases are connected to the AI

The registry's "implemented" flag is a fact about **files**. The runtime
probe's "live" flag is a fact about **files plus one env var**. Neither is
a fact about the running application.

The wiring harness measures the **import graph** instead:

```
server modules scanned     1362
routes found                394
AI-serving routes            19

phases
  total                          206
  imported by SOMETHING         200
  imported by a live module     110
  on the BACKEND path            85
  reaching a REASONING module    51   ← connected to the AI
  imported by nothing at all      6
```

### §3.1 Two traps this harness had to remove first

**The basename trap.** The first version matched a module's basename
anywhere in a file's text. It reported six "connected" phases. All six
were false: the basename appeared in a comment. The pattern now demands
the ESM form — `from '<path>'` / `import('<path>')` — with the path ending
in the basename.

**The barrel trap.** `src/lib/intent-ai/index.js` re-exports every phase
module. So a phase imported *only* by the entry point is imported by a
barrel that no request path may use. The harness splits barrel importers
from live importers; only the latter count.

Both traps push the number **up**, not down — so the honest number is
*lower* than the naive one.

### §3.2 Only two routes reach the central brain

```
POST /api/ai/ask      → server/ci/brain.js
POST /api/ai/outlook  → server/ci/brain.js
ALL  /api/cron/tick   → src/lib/central/intent.js
```

Nineteen routes serve the AI. **Two of them reach the brain.**

The other seventeen — including `/api/ai/brief`, every `/api/cron/*`, every
`/api/scenario/*`, `/api/forecast/*` — reach **no reasoning module at
all**. They compute. `phase-status` measures the control planes; `daily`
runs the chores; `scenario-evidence` archives a record. That is not a
defect — those are read-and-report endpoints. But it does mean the
"AI" surface of this application is **`/api/ai/ask` and `/api/ai/outlook`**,
plus the brain's own `/api/brain/*`.

### §3.3 The 155 phases the brain never reaches

The brain reads `src/lib/central/intent.js` (36 rules),
`src/lib/central/planner.js`, `policy.js`, `risk.js`, `recommend.js` — and
**not one line** of the 206-row phase registry:

```
$ grep -rn "intentSpecPhases\|SPEC_PHASES" server/ci/ server/ai*.js
(no output)
```

The most expensive group is the clearest example. Phases 101–116 are the
**multi-venue profit engine** — 16 phases, the second-heaviest block in
the boot path — and:

* `server/multiVenue.js` is imported by `server/app.js` and
  `server/financialGoals.js`. **Nothing else.**
* `server/multiVenue.js` serves `POST /api/intents/v1/profit-plan`.
* The brain's `PROFIT_PLAN` intent maps to the module **`profit-plan`** in
  `server/ci/modules.js` — and that module is a **pure derivation from the
  brain's own state**. It does not call `multiVenuePlanner`, and it never
  sees a venue feed.

So: the user asks the brain for a profit plan, and the brain answers from
its own portfolio state while **the real multi-venue planner — the one
that reads stocks, dYdX, perpetuals and yield farms — sits unused two
files away.**

The same is true of `server/fios/` (50 files, 980 KB): it is mounted at
`server/app.js:7446` and it **receives the brain** (`brain: ci.brain`), so
`fios → brain` works. The reverse does not: **`fios` is not in
`server/ci/modules.js`**, so the brain does not know the 50 files exist.
One direction of a two-way wire is connected.

---

## §4 — What is actually broken

### §4.1 Four phases owned a module that would not import — ✅ FIXED

```
216  lending-adapters        3 of 6 modules failed
106  profit-target-intake    1 of 2 modules failed
127  locale-coverage-report  1 of 2 modules failed
203  first-party-agent-catalog  1 of 1 module failed
```

The failing imports:

```
FAIL src/lib/defi/compoundV3Base.js    -> Cannot find module 'src/lib/chains'
FAIL src/lib/defi/compoundV3Lending.js  -> Cannot find module 'src/lib/swap'
FAIL src/lib/defi/morphoBlueBase.js     -> Cannot find module 'src/lib/chains'
```

`src/lib/chains.js` **exists** (935 lines) and imports cleanly. The files
that failed wrote `'../chains'` and `'../swap'` **without the `.js`
extension**. Node's ESM resolver refuses an extensionless relative import;
Vite resolves it, so the browser build is fine and the server build is not.

**This was pre-existing** — it failed identically on `origin/main`
(`39063aa`).

So **phase 216 (lending adapters) could not load on the server at all**,
and phases 106 and 127 lost one of their two modules.

**Fixed.** Seven suffixes were added (seven, not three — the set was wider
than the first grep showed). The measurement now:

```
OK   src/lib/defi/compoundV3Base.js     18 exports
OK   src/lib/defi/compoundV3Lending.js   3 exports
OK   src/lib/defi/morphoBlueBase.js     19 exports
```

and the adapter now reaches the contract instead of reporting a missing
module — it answers with the **real** read failure
(`COMPOUND_DEPLOYMENT_UNVERIFIABLE`) rather than
`ADAPTER_MODULE_UNAVAILABLE`.

**The wider scan.** `scripts/find-extensionless-imports.mjs` reports the
whole tree: **183** extensionless relative imports, of which **every one
is a frontend file** that only Vite loads. The **server tree has zero**.
The defect was confined to three modules that happened to be server-side,
and the harness now makes sure it stays that way.

### §4.2 The `RUNTIME_PROBE_NOT_COMPLETED` race (§1.1) — ✅ FIXED

Twenty-three phases reported a blocker that meant "nobody has asked yet".
The two status routes forced the probe; everything else did not. **The
probe is now warmed once during boot**, deferred to the idle phase, so a
cold process answers with **0** such blockers from the first call.

### §4.3 The blockers that only the probe believed (§1.2) — ✅ FIXED

Twenty-three phases were dark because five env vars had the wrong names.
The capabilities were already running. **The probe now measures the
phase's own provider module** — parses it, checks that it exports
something — instead of reading a name that nothing else reads. The env
var survives as an operator *override*.

### §4.4 The import extension gap (§4.1) — ✅ FIXED

Four phases, three files, seven missing `.js` each. All fixed.

### §4.5 The adapter's failure shape — ✅ FIXED

The lending adapter's failure path returned `{ code, detail }` with **no
`ok` field**. A caller asking "did this work?" got `undefined`, and had
to know that the absence of `ok` meant no. Every adapter answer now
carries `ok`.

---

## §5 — The upgrade paths, ranked by measured value

### 5.1 FIRST — make the phase report honest at cold start — ✅ SHIPPED

**What:** the report is computed from a cache that a cold process has not
filled. Two routes force the probe; the rest do not.

**How:** the probe is now warmed **once during boot** (`server/app.js`, at
the end, next to the export) — the same place the evidence store hydrates.
It is not awaited at the top level, so the module still exports
synchronously and the probe can never delay the first byte.

**Why first:** it was a correctness bug that published a wrong number
(41 live instead of 206), and fixing it costs the probe **once per
instance**, not per request. It also removes the background-refresh race
that fired on a timer.

**Measured effect:**

```
before:  live  41 / 206   (165 phases claiming RUNTIME_PROBE_NOT_COMPLETED)
after:   live 206 / 206   (0 claiming RUNTIME_PROBE_NOT_COMPLETED)
```

from the **first** report in a **cold** process, with no explicit refresh.

### 5.2 SECOND — ask the adapters, do not read a made-up env var — ✅ SHIPPED

**What:** `PROVIDER_HINTS` decided "configured" by the presence of an env
var that nothing reads. The adapters were already imported and already
serving.

**How:** `server/intentPhaseRuntimeProbe.js` now **imports the phase's own
provider module** and checks that it loads and exposes an API. The import
is deliberately **local** — the probe must not make a network call,
because it runs on every cold start. The result is cached per module, so
a module shared by several phases is imported once.

The env var survives as an **operator override** — a way to declare a
provider present — but it is no longer the only way to be live, so it can
no longer be the reason a working phase is dark.

`probePhase` became `async` as a result. It is called from exactly one
place (`probeProductArcPhases`), so the change is contained.

**Why second:** it converts **23 false-dark phases into live ones** with no
new code to activate, and it removes the temptation to set five env vars
that do nothing. A phase that reports "live" because its module loaded is
a phase whose liveness can be trusted — and a phase that reports
`MODULE_NOT_LOADABLE` is naming a real, fixable defect.

**Measured effect:** 165/165 live with every override deleted; the report
can no longer lie in either direction.

### 5.3 THIRD — add the missing `.js` extensions — ✅ SHIPPED

**What:** three files imported `'../chains'`, `'../swap'`,
`'../preSignSimulation'` and `'./executionGuards'` **without the
extension**. Node's ESM resolver refuses them. (Seven imports, not three:
the set was wider than the first grep showed, and `'./executionGuards'`
points at a file that exists only as `src/lib/defi/executionGuards.js`.)

**How:** add the extension.

**Why third:** it is tiny, it is pre-existing, and it unblocks **phase 216
entirely** plus one module each of 106 and 127.

**Measured effect:**

```
before:  compoundV3Base.js      FAIL — Cannot find module '../chains'
after:   compoundV3Base.js      OK   (18 exports)
         compoundV3Lending.js   OK   ( 3 exports)
         morphoBlueBase.js      OK   (19 exports)
```

and the adapter now REACHES the contract instead of reporting a missing
module:

```
before:  ADAPTER_MODULE_UNAVAILABLE  — "the module does not load"
after:   the adapter answers with the REAL read failure
```

**The wider measurement.** A scan of the whole tree found **183**
extensionless relative imports — and **every single one is a frontend
file** that only Vite ever loads. The server tree has **zero**. So the
defect was confined to three modules that happened to be server-side, and
`scripts/find-extensionless-imports.mjs` now reports the whole set so it
cannot spread.

**One more thing this uncovered.** The adapter's failure path returned
`{ code, detail }` with **no `ok` field** — so a caller asking "did this
work?" got `undefined` and had to know that the absence of `ok` meant no.
Every adapter answer now carries `ok`.

### 5.4 FOURTH — wire the multi-venue engine into the brain's PROFIT_PLAN — ✅ SHIPPED

**What:** the brain's `PROFIT_PLAN` intent resolved to the `profit-plan`
module, which derived a plan from the brain's own state. The
**multi-venue planner** — which reads stocks, dYdX, perpetuals and yield
farms, and which was already in the boot path — was never called by the
brain.

**How:** `profit-plan`'s read now asks the venue engine for the venues
the user can actually reach, and adds them to the plan.

Two details matter:

* **The engine is loaded LAZILY.** A static import would put four
  venue adapters' connection setup on every cold start for a question
  nobody asked. The engine is reached through `await import(...)`, so
  the cold boot pays nothing and the first `profit-plan` call pays the
  adapters' network cost.
* **The plan is a SYNTHESIS, never a replacement.** The brain's own
  concentration / exposure / opportunity numbers stay authoritative —
  they are computed from state the brain owns. The venue view is added
  as the thing the brain *could not* compute. If the engine cannot
  answer, the plan is still returned with `venues: null`: a plan without
  a venue view is incomplete but HONEST, and an error would throw away
  the figures the brain already got right.

**Why fourth:** this is the **capability** upgrade, not the cost one. It
is worth the most to a user, and it uses code that is already loaded, so
it costs **no extra CPU** — it uses CPU that is already being spent.

**Measured effect:** the brain's plan now carries the venue view, with
the engine's own health and — importantly — the REASON each venue could
not answer:

```json
"venues": {
  "health": { "stocks": { "live": false, "count": 0, "best": null }, … },
  "reasons": { "stocks": "fetch failed", "dydx-global": "DYDX_UPSTREAM_FAILED", … },
  "sources": { "stocks": "avantis-equities", "dydx-global": "dydx-indexer", … }
}
```

An unreachable venue is reported as unreachable — never as a healthy
venue with no yield.

### 5.5 FIFTH — split `phase-status` into a summary and a detail route

**What:** `GET /api/intents/v1/phase-status` returns 150 KB — every one of
the 206 rows with full detail — for 50 ms of CPU.

**How:** keep the summary (counts, status, gate, blockers) on the existing
route and move the per-phase detail behind a query parameter or a second
route.

**Why fifth:** it is the cheapest win on the request path, and the summary
is what a dashboard actually renders. A monitoring client that polls this
route every minute is spending 30 % of its own CPU budget on bytes it
never reads.

**Measured effect:** ~50 KB instead of 150 KB, and ~30 ms instead of 50 ms
per call.

### 5.6 SIXTH — split `/api/cron/daily` into its eleven jobs — ✅ SHIPPED

**What:** one cron slot ran eleven jobs in a single `Promise.allSettled`
and left 15.3 MB of heap behind. It was **563 ms of CPU — 66 % of all
cron CPU** — and it was ONE number.

**How:** the eleven jobs are now a **registry**. Each job is defined once,
with its own runner and its own result shape, and the route can run:

```
GET /api/cron/daily              → all eleven, each with its own timing
GET /api/cron/daily/<job>        → exactly one
GET /api/cron/daily?job=<name>   → exactly one, by name
```

The evidence hydration stays on the combined route, because the probes
read the evidence the other jobs refresh — a probe that ran against a
store that was never hydrated would measure nothing.

**Why sixth:** it makes the cost attributable. Right now, when
`/api/cron/daily` costs 563 ms, nobody can say which of the eleven jobs
caused it.

**Measured effect — the cost, broken down:**

```
self-probe        125 ms
smart-money       119 ms
stage3-probe       56 ms
ops-probe          52 ms
web-promo           9 ms
fcm-promo           9 ms
watch               9 ms
price-watch         9 ms
monitors            9 ms
certifications      8 ms
reputation          8 ms
```

`self-probe` and `smart-money` are **44 % of the cost between them**, and
until now nobody could have said so.

**The legacy shape is kept.** The response still carries `web`, `fcm`,
`watch`, `priceWatch`, `monitors`, `smartMoneyAlerts`, `certifications`
and `reputation` under their old names, so a client that reads them does
not break. The new `jobs` array is additive.

### 5.7 What is NOT an upgrade path

* **Setting the five `INTENT_*_PROVIDER` env vars.** It changes the report
  and nothing else. §1.2 proves it: nothing outside the probe reads them.
  (And since §5.2 they are not even needed to make a phase live.)
* **Adding more phases.** The registry already has 206. The problem is that
  155 of them are unreachable from the brain. Adding a 207th makes the
  ratio worse. §5.9 and §5.10 are the opposite move: four new intents
  that make FOUR EXISTING capabilities reachable — no new phase, no new
  provider call, and (after the bridge) only one new module.
* **Cutting CPU to make the allowance last.** The allowance is not the
  binding constraint — the `:free` provider quota is (50 requests/day ≈ 8
  max turns). §2.4.
* **Qdrant.** It buys persistence, not CPU. Already documented.

### 5.8 What is STILL open after all thirteen paths

The thirteen paths in §5 are shipped, and they were the thirteen that
the measurement justified. What the measurement did **not** justify is
left open on purpose, and it is worth naming:

1. ~~**52 of 206 phases reach a reasoning module.**~~ **SHIPPED at the
   module level** — see §5.9 and §5.10. The registry is 206 and the AI
   asked 52 of them. The fix was not more phases: it was making the
   brain's intents reach the modules that already exist. The
   **intent↔module gap is closed** — 30 of the 31 registered modules are
   asked by an intent, and the only one still unasked is `prediction`,
   which is `FEATURE_GATED` by design. The yield surface (§5.9) and the
   global surface (§5.10) were the two places the gap lived.

   What remains is the **phase-level** number, which counts *phases*,
   not *modules*. That is a different measurement, and it is not what
   was broken: a phase is reachable when a module reads it, and the
   number that moved is the one the user can feel.

2. ~~**`server/fios/` (50 files, 980 KB) is still a one-way wire.**~~
   **SHIPPED** — see §5.10. It RECEIVED the brain (`server/fios/index.js`)
   and the brain knew nothing about it; now the global-intelligence
   engines are reachable from the chat.

3. ~~**`/api/cron/daily` is still 621 ms of CPU**~~ **SHIPPED** — see
   §5.11. The two jobs that were 44 % of it were measured and found to
   be doing the same work twice: the self-probe re-measured evidence
   whose TTL is six hours, and the smart-money indexer ran from two
   different crons. Both duplications are now gone, and both skips are
   REPORTED rather than silent.

4. **The CPU allowance is not the constraint.** The `:free` provider quota
   is: 50 requests/day ≈ 8 max turns. Every CPU number in this document
   is a correctness and cost-accounting fix, not a way to stretch the
   allowance.

5. ~~**A prompt/token diet would stretch the quota.**~~ **MEASURED and
   closed** — §5.12. The prompt is 92.5 % contracts and 5.3 % evidence,
   the contracts repeat in every seat because each call is an
   independent request, and the rules are the quality. There is nothing
   to cut that would not cost accuracy. The quota is spent on the
   **number of calls**, and the local-first gate is what reduces that
   (100 → 55 calls for 20 questions).

6. ~~**Three deep `server/fios/` engines** (`whyEngine`,
   `routeIntelligence`, `conversationState`, `eventReplanning` — about
   46 KB) are still imported by nothing in the brain.~~ **SHIPPED** —
   see §5.17 (the quota), §5.18 (the route engine), §5.19 (the why
   engine) and §5.20 (the session machinery).

   The three were not equally ready, and that is why they did not get
   the same treatment:

   · `routeIntelligence` — needed candidate routes from the quote step,
     so it needed a live venue adapter. It now has one: the
     deployment's EXISTING route provider, one call, no second quote.
   · `whyEngine` — needed a decision bundle the brain did not produce.
     The brain DOES produce a decision — its own recommendation, its own
     findings, its own risk view — so the work was a translation, not a
     new decision engine.
   · `conversationState` and `eventReplanning` — session and event
     machinery, not a question. They were wired into the SESSION LAYER,
     where they belong, and deliberately NOT turned into modules: a
     user-facing «replan my conversation» button is not what a
     conversation-state machine IS.

   **The dark-engine count is now ZERO.** Every engine in
   `server/fios/` is reachable from the brain, and each one was reached
   in the way its own nature demanded — a surface, a translation, or
   session machinery.

   **But reachable was not enough, and §5.21 is the proof.** All three
   of these turned out to be reachable AND still dark: the path existed
   and the answer did not. The count above was honest about REACHABILITY
   and silent about the answer, and the correction — three missing
   inputs, three different shapes of the same failure — is in §5.21.

   **And the rule was then applied to the WHOLE library — §5.22.**
   §5.21's lesson turned out to be a general one, so it was turned into
   a sweep: every engine in `server/fios/` is now asked, over its OWN
   route, whether it reaches an answer. **47 of 47 do, 0 are dark, 0
   have no caller.** The first run of that sweep found two more bugs
   that no surface test could see — a comparison question about a bridge
   classified as an instruction to move the money, and an owner whose
   debt was never read having **no capital at all** for seven engines.
   Both are fixed, and both are in §5.22.

7. ~~**The engines are reachable, and that was the count.**~~ **The count
   is now the answer.** Reachability was the wrong number, and it was
   wrong for a third time in this document: first there were no engines
   reachable, then all of them were, and now the number that means
   something is how many of them **reach an ANSWER**. It is measured two
   ways — 47 of 47 engines over their own route, 26 of 26 intents in a
   real brain turn — and it is gated, so a future engine cannot join the
   library dark.

### 5.9 Path 7 — the yield surface (SHIPPED)

**The measurement.** The gap between what the brain *asks for* and what
the registry *registers* was counted directly:

```
intents                          : 29
registered modules               : 30
modules an intent asks for       : 27
REGISTERED BUT NEVER ASKED       : farming, liquidity, staking
ASKED BUT NOT REGISTERED         : session   (only NAVIGATE uses it)
```

Three capabilities were registered, readable, live — and **no intent
could ever reach them**. A user who asked «بهترین ییلد کجاست؟» or
«ریسک نقدینگی LP چقدره؟» got `UNSUPPORTED`, while the yields engine
sat there answering nobody.

**Why it was invisible.** Three separate causes, and none of them was
"the feature was not built":

1. **The words belonged to another intent.** `ASSET_ANALYSIS` matches
   `\byield\b`, `\bfarm\b` and `\bapy\b`, and its modules are
   `crypto, signals, news, risk`. The yield engine was never consulted
   for a question about a pool.
2. **The sections were owned by nobody.** `farming` and `liquidity` are
   state sections in `createSystemState()`, but `SECTION_OWNER` did not
   list them — so `SERVE_UNAVAILABLE` could not tell "missing" from
   "unreadable", and `requires: ['farming']` was meaningless.
3. **A follow-up rewrote the question.** `RISK_QUERY` fires on
   «ریسک … چقدره؟» and rewrites the intent to `LOAN_STATUS`. That is
   right for «ریسک وامم چقدره؟» and wrong for «ریسک نقدینگی LP
   چقدره؟». The tell is not the word «ریسک» — it is that the sentence
   **names a capability** («نقدینگی», «LP», «استیکینگ», «ییلد»), and a
   name carries its own referent, so the sentence is not a follow-up to
   whatever was said before.

**What shipped.**

| | before | after |
|---|---|---|
| intents | 29 | **32** |
| modules asked by an intent | 27 | **30 / 30** |
| registered but never asked | `farming`, `liquidity`, `staking` | **`prediction` only** (`FEATURE_GATED` by design) |
| «بهترین ییلد کجاست؟» | `UNSUPPORTED` | `YIELD_OPPORTUNITY` → Uniswap WETH-USDC 24.5 % APR, 400 M USD depth |
| «سود استیکینگ اتریوم چقدره؟» | `UNSUPPORTED` | `STAKING_REWARD` → Lido STETH 3.8 % APR, 9 000 M USD depth |
| «ریسک نقدینگی LP چقدره؟» | `UNSUPPORTED` | `LIQUIDITY_RISK` → 3 pools, 1 carries an impermanent-loss flag |

- Three intents with their own modules, their own rules (placed **above**
  `ASSET_ANALYSIS`) and their own findings.
- `SECTION_OWNER` gains `farming`, `liquidity`, `staking`.
- An **explicit intent beats a follow-up** — but a confirmation or a
  cancellation still wins, because those are about an action, not about a
  topic. The set is deliberately narrow: `ASSET_ANALYSIS` matches
  «چطور است» and «چطوره», so half the sentences in the product would
  count as "explicit" and follow-ups would stop working entirely.
- **A yield is never quoted alone.** The finding carries the risk level,
  the depth and the impermanent-loss flag beside the APR, and a staking
  question picks the liquid-staking row rather than the highest number
  — a 24.5 % DEX pool is an impermanent-loss trap, not a return.
- `guarded()` now keeps the real error text, so a failure says **why**
  («fetch failed») instead of `UNCLASSIFIED_ERROR` with an empty detail.
  An empty detail tells the operator that the module "did not answer"
  and nothing about whether to retry.

**Contract test.** `test/intent-ai/yield-surface-intents.test.mjs` —
13 cases, including the live HTTP path (`POST /api/brain/intent`) and
the regression guard that «وامم چطوره؟» still resolves to
`LOAN_STATUS`.

`npm run test:ai-intelligence` → **657 / 657** (was 644).

### 5.10 Path 8 — the global surface (SHIPPED)

**The measurement.** `server/fios/` is 50 files and 980 KB. The check
that mattered was mechanical, not a judgement call:

```
fios files whose exports the brain knows:   0 of 50
```

Not one. `server/fios/` holds the global intelligence engines — smart
money, whales, on-chain activity, the macro graph, the cross-asset view,
the proactive briefing, the traditional-asset discovery. All of it was
reachable by an HTTP route and by **nothing else**. A user who asked
«پول هوشمند کجاست؟» got `UNSUPPORTED` while a working smart-money
engine sat in that directory.

**What the brain had instead.** The brain's own `signals` module is a
price computation: an SMA cross and a realized volatility over 30 days
of closes. It is **not** smart money — it has no whale transfers, no
net flow, no accumulation vs distribution, no exchange inflow.

**Why it was not simply wired.** The two halves are built in opposite
order:

- `fios` is built **after** the brain, because it calls
  `brain.directToolCall(...)` for the four traditional-asset feeds;
- the brain is built **before** `fios`, because `fios` needs it.

So neither can hold the other at construction time, and a direct
reference in either direction is a cycle. The fix is a **bridge** with a
single function slot (`server/ci/globalIntelBridge.js`): `fios` registers
its reader when it is built, and the brain's module calls it. Two rules
keep it honest:

1. the provider is **per owner** — the state store is per owner, so two
   users can never see each other's flows;
2. an absent provider reports **`PROVIDER_NOT_WIRED`** — a named reason,
   never a number.

**What shipped.**

| | before | after |
|---|---|---|
| fios exports the brain can reach | 0 of 50 | the global-intelligence set |
| registered modules | 30 | **31** (the 31st is `global-intel`) |
| intents | 32 | **33** |
| «پول هوشمند کجاست؟» | `UNSUPPORTED` | `SMART_MONEY_READ` → the global section is read |
| «اسمارت مانی چطوره؟» | `MARKET_OVERVIEW` (a price summary) | `SMART_MONEY_READ` |
| a domain that could not be read | dropped | **named** (`whales: NO_WHALE_EVENTS`) |

- A `global-intel` module (state section `globalIntel`, tools
  `global.read`) that carries only the domains that answered and names
  the ones that did not.
- The `SMART_MONEY_READ` intent, placed **above** `MARKET_OVERVIEW` —
  that rule already claimed «اسمارت مانی» and «نهنگ» while its modules
  were the crypto ones.
- A **plan template**. This is the part that is easy to miss: without
  one the plan is **EMPTY**, and an empty plan reads nothing. The three
  yield intents of §5.9 had the same defect and it is fixed here too.
- A finding that quotes the flows **and the qualifier that travels with
  them**: a whale transfer is a **proxy**, not a paired trade. Saying
  «نهنگ‌ها ۱۲ میلیون دلار خریدند» without that would be a fabrication
  dressed as a fact.

**Contract test.** `test/intent-ai/global-surface-intents.test.mjs` —
11 cases, including the bridge's three failure modes, the module's
honesty when the provider is absent, and the live HTTP path.

`npm run test:ai-intelligence` → **668 / 668** (was 657).

### 5.11 Path 9 — the daily cron was doing its work twice (SHIPPED)

**The measurement.** §5.6 split `/api/cron/daily` into its eleven named
jobs, and the per-job numbers said where the 621 ms went:

```
self-probe      125 ms   ← 20 % of the whole route
smart-money     119 ms   ← 19 %
stage3-probe     56 ms
ops-probe        52 ms
the other seven   8–9 ms each
```

Two of the three largest jobs were doing the same work twice, and both
duplications were visible in the code once the numbers pointed at them.

**1. The self-probe measured evidence it already had.**

`venue-health` fetches three exchange endpoints; `certificate-authority`
opens a TLS handshake. That is 125 ms to re-measure things whose
evidence carries a **six-hour** `expiresAt`. The store already filtered
on expiry — the probe just never asked it.

So an unexpired kind is now **reported** rather than re-probed, with
three rules that keep it from becoming a way to paint a green board:

- only **unexpired** evidence is reused, with the same TTL the probe would
  have used;
- a carried kind is **labelled** — the report carries `measuredKinds` and
  `carriedKinds`, so a reader can tell what is fresh;
- `reuse:false` forces a fresh pass.

**The failure mode the reuse introduces is closed.** `persistEarned`
merges by kind, so writing a carried record back would give it a **new**
`expiresAt` — the evidence would never expire, and a venue that went down
six hours ago would still be reported as verified. A carried record is
therefore **not** re-persisted.

**2. The smart-money indexer ran twice a day.**

`/api/cron/daily` (09:00 UTC) and `/api/cron/smart-money` (21:41 UTC)
call the **same function**. The indexer walks up to six wallets with
their own RPC and explorer scans, and the rotation takes never-analysed
wallets first — so the second pass had nothing new to say.

The cadence now learns when the last pass ran and skips a second scan
inside a twelve-hour window, **saying so by name**
(`skipped-recent-index`) rather than reporting work that never happened.

Three things are **not** skipped:

- the **alert** cycle always runs — an alert is a push a person
  subscribed to, and skipping it would silently stop delivering what
  they asked for;
- an **unknown** last pass runs the index — not knowing is not a reason
  to skip;
- a last pass in the **future** runs the index — a clock that went
  backwards must not turn into a skipped pass.

**Contract test.** `test/intent-ai/cron-cost-honesty.test.mjs` — 10
cases, holding the line that matters: a skipped or carried pass may
never be REPORTED as work that happened.

`npm run test:ai-intelligence` → **678 / 678**.

### 5.11.1 What the measurement can and cannot show (honesty note)

Both savings depend on a **durable store**, and that is the condition
they were measured under, so it has to be stated plainly:

| | with a durable store | without one |
|---|---|---|
| the self-probe | reports unexpired evidence | measures every time (today's behaviour) |
| the smart-money index | one pass per 12-hour window | one pass per cron call (today's behaviour) |

`server/blobCache.js` — `blobConfigured()` is true when **Vercel Blob**
or **Upstash Redis** is configured. With neither, `storeGet` returns
`null`, there is nothing to carry and nothing to remember, and both
paths correctly fall back to measuring.

**So the saving is CONDITIONAL on the store, and the measurement here
cannot claim it.** In this sandbox `blobConfigured()` is `false`, so
both duplications still happen here; the numbers in §5.11 are the
*upper* bound of what the change can save, not a measured saving in
this deployment.

What IS unconditional:

- the **skip is reported by name** (`skipped-recent-index`), so the
  saving is visible in the job's own result rather than invisible in a
  faster wall clock;
- the **carried kind is labelled** (`measuredKinds` / `carriedKinds`), so
  a reader can tell what is fresh;
- an **unknown** last pass still runs the index — the behaviour degrades
  to the old one, never to a silent no-op;
- the self-probe no longer **re-issues an expiry** for carried evidence,
  which is a correctness fix whether or not the store is configured.

`/api/cron/daily` measured in this deployment after the change:
**469 ms of CPU** (was 621 ms) — but that difference is the
`smart-money` and network timing of a sandbox without egress, not the
reuse path. The honest statement is: **the code path is correct and
tested; the saving needs a durable store to happen.**

---

### 5.12 Path 10 — the prompt diet, measured (and why there is nothing to cut)

The resource audit kept recommending a "prompt/token diet" as the lever
that would make the free tier last longer, and the recommendation was
never measured. It is measured now, by
`scripts/measure-prompt-weight.mjs`, which splits one real turn's prompt
into its four parts:

| part | chars | share |
|---|---:|---:|
| role prompt | 139 | 0.6 % |
| **contracts** | **23,367** | **92.5 %** |
| question | 310 | 1.2 % |
| context (evidence) | 1,349 | 5.3 % |
| **total** | **25,255** | |

The finding is the opposite of what the recommendation assumed. **The
contracts are 92.5 % of the prompt, and the evidence is 5.3 %.** The
rules that make the model honest — the JSON shape, the reasoning
contract, the deep-reasoning line, the grounding rule, the professor
posture, the request read — are the expensive part, and they are
repeated in every seat: **24 contract lines appear in all five calls**,
for 15,148 characters of repeated text.

The obvious move is to send them once. The obvious answer is that they
**cannot** be sent once: each call is an independent request to a
provider, and a provider sees only its own request. There is no shared
system prompt across calls, and no provider here supports one.

So a prompt diet has almost nothing to cut. Cutting the contracts would
buy quota with accuracy — it would remove the rule that says *never
introduce a number the evidence does not contain*, and the rule that
makes the answer's claims checkable against its own reasoning. That is
the trade this project does not make, and the measurement is the reason
it is now a closed question rather than an open proposal.

Two things are worth keeping from the measurement:

* the harness (`scripts/measure-prompt-weight.mjs`), so the number can be
  re-checked after any change to the contracts;
* the per-line repeat table, so a future change that adds a 500-char
  rule to every seat is visible as such.

**What this closes:** the `:free` quota is the binding constraint (§0.4),
and the prompt is not where it is spent. The prompt is 25 KB of rules for
5 KB of facts; the quota is consumed by the **number of calls**, which
the local-first gate already cut from 100 to 55 for 20 questions.


---

### 5.13 The regression sweep, and the two bugs it caught

The branch touches the central brain, the intent classifier, the corpus
and the cron. The test suite that covers those (`test:ai-intelligence`)
is 678 assertions and it does not cover the whole repository. So the
whole corpus was swept: **608 test files**, run in parallel, each file
on its own.

Running a sweep is not the same as trusting it. A parallel run produces
false failures — files that touch the same port, the same temp file or
the same cache. So the sweep was **diffed against a fresh baseline**:
the same 608 files, on `origin/main`, in a separate worktree, under the
same conditions. Only a file that fails on the branch and passes on the
base is a regression.

**39 files failed on the branch. 37 of them also fail on `origin/main`** —
they are environment failures (a missing native binary, a missing file,
a `.jsx` the runner cannot load), pre-existing on main, and not this
branch's business.

**Two files failed only on the branch, and both were real:**

**1. `server/intentSelfProbe.js` — the audit evidence lost its `await`.**
When the reuse path was added, the fresh measurement was rewritten as
`carried('durable-immutable-audit') || auditEvidence({...})`. The `||`
operator does not await, so `audit` became a **promise**. Every
downstream read — `r.ok`, `r.code` — saw an unresolved promise, so the
kind was reported as `UNKNOWN` instead of
`DURABLE_STORE_NOT_CONFIGURED`.

That is the bad direction. The durable audit log claimed to be verified
while nothing had been appended, verified or read back: **the board was
green about a store that was never checked.** The `await` is back, and
the probe now reports `DURABLE_STORE_NOT_CONFIGURED` until a store
really exists.

**2. `src/lib/intent-ai/qualityCorpus.js` — the whale corpus still
pinned to the old intent.** `SMART_MONEY_READ` claims «نهنگ» and
«smart money» on purpose — its priority sits above `MARKET_OVERVIEW`,
which is written down in `intent.js`. The corpus predates that intent
and still expected `MARKET_OVERVIEW`, so the **whale category had
fallen to 0 %** while every one of its sentences was being answered
*more* specifically than the corpus predicted. The expectation was
moved to `SMART_MONEY_READ`.

Both are fixed: `earnable-evidence-probe` 52/52,
`quality-corpus-probe` 39/39, `test:ai-intelligence` 678/678. **Every
one of the 39 sweep failures now also fails on `origin/main`: no
branch-only regression remains.**

The second bug is the more interesting one, and it is worth stating
plainly: **the corpus check was the tripwire.** It caught a drift
between what the corpus says the system does and what the system
actually does — and it caught it in the direction that matters, because
a corpus that pins a question to an intent the system no longer uses is
a corpus that will call a *better* answer a regression.


---

### 5.14 Path 11 — the fit surface, and the bug the global surface was hiding

The yield surface (path 7) answers «which of these pays the most». The
**fit surface** answers the question that actually matters about one's
own money: «which of these suits **me**?».

**The engine existed and was unreachable.** `server/fios/opportunityFit.js`
scores an opportunity against the owner's risk profile, capital,
liquidity need and goal — profit, probability, risk, liquidity, costs,
capital — and answers `FITTED` / `CONDITIONAL` / `NOT_FITTED` with a
reason for every dimension, in Persian:

```
«برای شما مناسب است: 5 از 5 معیار با پروفایل شما سازگار است»
```

While it sat there, «کدام گزینه مناسب من است؟» was `UNSUPPORTED`.

**What was added.** The intent `OPPORTUNITY_FIT`; the module
`opportunity-fit`, reached through the same one-slot bridge as the
global surface (`server/ci/fitBridge.js`); the state section
`opportunityFit`; the plan template; the finding; and 13 contract tests.

The intent sits **above** the yield question, and the reason is
specific: the yield question never mentions the owner («بهترین ییلد
کجاست؟»), while the fit question is *about* the owner, and nothing is
more specific than a fit. The first pattern written for it was too
greedy — it claimed «وضعیت ریسک من چیه», which is a question about the
profile itself and belongs to `PORTFOLIO_ANALYSIS`. The quality corpus
caught it (the `risk` category fell to 80 %) and the pattern now needs
the fit word beside the profile word.

**The opportunities come from two places.** The crypto ones (the yield
pools, the LP positions) are read from the state sections the brain
*already reads* — they were there, they were just never scored against
a profile. The traditional ones come from the cross-asset feed. The
impermanent-loss flag travels with each pool, because an LP is a
directional position wearing a yield costume, and a fit that ignored
that would be a fit against a lie.

**The bug the fit surface found.** The global surface (path 8) had
never worked over HTTP. The bridge was correct, the module was
correct, the intent was correct — and every «پول هوشمند کجاست؟»
answered `PROVIDER_NOT_WIRED` while a working smart-money engine sat
in the same process. The reason: the provider was only wired when
`/api/ai` was mounted, and **`/api/brain` never mounts it**. The tests
passed because they mocked the provider.

So the provider bootstrap now happens on the **first turn**, not at
boot: `createCentralIntelligence` takes an `ensureProviders` hook, and
the app wires it to `ensureFinancialIntelligence()`. The import is
still lazy, and the promise is cached:

| | before | after |
|---|---:|---:|
| boot wall / CPU / RSS | 656 ms / 311 ms / 96 MB | **228 ms / 306 ms / 96 MB** |
| boot module count | 305 | **305** (unchanged) |
| first turn | `PROVIDER_NOT_WIRED` | **the real answer** |
| one-time wiring cost | — | **813 ms CPU, once per process** |
| second turn | — | does not pay it again |

**What this closes.** The 8 deep `fios` engines of §5.8 item 6 are
still dark, but the two that had a natural question — *which of these
suits me* and *where is the smart money* — are now reachable, and the
reason they were not was a mount, not a design.


---

### 5.15 Path 12 — the macro graph: the regime next to the market overview

A market overview that quotes breadth and the top movers answers **"what
is moving"**. It does not answer **"what kind of market is this"** — and
the second question is the one a person actually has.

`server/fios/macroGraph.js` is that answer. It reads the global
snapshot, the world model and the portfolio **together** and builds the
transmission graph between them: which macro events carry into which
instruments, and what the portfolio's risk impulse is. It existed, it
was complete, and nothing could reach it.

**What was added.** The module `macro-graph`, through a third slot in
the same lazy bridge (`server/ci/fitBridge.js`); the state section
`macroGraph`; the event `MACRO_GRAPH_READ`; `MARKET_OVERVIEW` now asks
for `global-intel` and `macro-graph`; the plan reads the global section
beside the prices; and the finding `market-regime`.

**No new intent was needed.** «وضعیت بازار چطوره؟» was already
`MARKET_OVERVIEW` — it just did not reach the engine that could answer
half of it. A new intent would have been a second name for the same
question.

**The regime is an enrichment, not the source.** When the graph is
unreadable the overview still stands on the prices it did read, and the
finding is simply absent — the user is not left with nothing. That is
why the graph step is `optional` in the plan and why the finding does
not carry the overview's status.

**The graph says what it is.** It reports `estimate: true`, and the
finding carries that flag: a portfolio risk impulse is a *first-order
model over the domains it read*, not a forecast, and the reason string
says exactly that.

Live, the turn says:

> the regime is read from smart_money, onchain; the portfolio risk
> impulse is 0 — a first-order model over the read domains, not a
> forecast

**The count of dark engines is now four, not eight.** The global
surface (§5.10), the fit surface (§5.14) and the macro graph (§5.15)
each reached one. What is left is `whyEngine` (it needs a decision
bundle the brain does not produce yet), `goalScenarios` (its
`GOAL_PLAN` intent already exists — the wiring is the missing half),
`routeIntelligence` (it needs candidate routes from the quote step, so
it needs a live venue adapter), `conversationState` and
`eventReplanning` (both are session/event machinery, not a question).


---

### 5.16 Path 13 — the goal scenarios: three profiles for a target

The brain's `goals.simulate` computes a **feasibility figure**: can this
target be reached, and at what monthly contribution? That is half the
question. The other half is **what the road looks like, and how likely
each version of it is to arrive** — and the engine for that existed and
was unreachable.

`server/fios/goalScenarios.js` builds three profiles for a target:

| | allocation | modelled return | max drawdown | probability of loss | probability of halving |
|---|---|---:|---:|---:|---:|
| CONSERVATIVE | 65 % stable / 30 % majors / 5 % alts | 6 % | −24.1 % | 37.9 % | 0.6 % |
| BALANCED | 35 % stable / 45 % majors / 20 % alts | 14 % | −41.3 % | 48.2 % | 3.1 % |
| AGGRESSIVE | 10 % stable / 40 % majors / 50 % alts | 26 % | −68.4 % | 63.7 % | 11.2 % |

Each profile also carries the percentiles of a modelled distribution
(`p10`, `p50`, `p90`) and, when the read is honest about it, the
bracket the target falls into («even the 90th percentile of the modelled
distribution is below the target»).

**The refusal is the point.** With no real capital the engine does not
model anything:

> a scenario needs real capital; nothing was modelled and nothing was
> guessed

That refusal is more valuable than a number, and it travels with the
answer — as a **named reason** in the finding, not as a missing value.
The plan step is `optional` precisely so that a refusal never costs the
user the feasibility figure they did earn.

**What was added.** The module `goal-scenarios`, through a fourth slot
in the same lazy bridge; the state section `goalScenarios`; the event
`GOAL_SCENARIOS_READ`; `GOAL_PLAN` now asks for `goal-scenarios`; and
the finding `goal-scenarios`, which carries each profile's drawdown and
probability of loss, the recommended profile, and the `estimate` flag.

**The estimate flag is not decoration.** A percentile of a Monte-Carlo
distribution over a *chosen* expected return is a model of the
arithmetic, not a prediction of the market. The finding says so, and
the reason string repeats it: «a model over a chosen return, not a
forecast».


---

### 5.17 Path 14a — the quota: the 50-a-day bottleneck, measured and fixed

**The measurement.** The `:free` seat's whole daily allowance is 50
requests, and **a failed request counts**. A deep turn costs five
provider calls — Market, Risk, Crypto Research, Verification, Final
Answer — so the nominal budget was **eight turns a day**. The harness
is `scripts/measure-quota-budget.mjs`.

**That figure turned out to be the WRONG one**, and finding out why
mattered more than the figure. It divided the allowance by the FULL turn
cost, and the full turn cost is only what the FIRST questions of the day
cost: the headroom ladder makes the later ones cheaper. So the day buys
more questions than a flat division says — and the last of them are
shallower, which a single headline number cannot say. The harness that
measures it is `scripts/measure-day-turns.mjs`
(`npm run measure:day-turns`), and it walks a day against the REAL
counter, the REAL cap ladder and the REAL collaboration layer:

```
repetition   questions   cached   requests   avg depth   last 4
     0%          12        0         49         4.1   2, 1, 1, 1
    25%          15        3         49         4.1   2, 1, 1, 1
    50%          22       10         49         4.1   2, 1, 1, 1
```

The cold case is the floor: **twelve questions a day, not eight**, and
the average depth is 4.1 rather than 6 because the last four questions
are one call deep. With half the questions repeated, the cache serves
ten of them for nothing and the day reaches twenty-two questions — but
ten of those are repeats, so the day is twelve NEW subjects and ten
recalls, which is a different product claim and the harness says so.

The project knew the per-turn numbers (the model ledger, the provider
ladder, the local-first gate) and **none of them could see the DAY**. So
the deployment learned it was out of quota by getting a 429, and the
operator saw a failure instead of a number.

**A second, quieter defect.** The answer cache was **one in-memory
`Map`**. On Vercel that map is empty on every cold start, so the same
question asked twice — on two different lambdas — cost two full
collaborations, five calls each. The cache was in the code and did
nothing for the deployment it was written for.

**Three layers, each doing one job.**

| Layer | What it does | Why it is not enough alone |
|---|---|---|
| `server/aiQuotaBudget.js` | A durable per-UTC-day, per-provider counter. It publishes the allowance **before** it runs out, and when the day is nearly spent it lowers the turn's call cap. | It counts; it does not stop a turn from asking. |
| The call cap (`AI_MAX_PROVIDER_CALLS`, default 6) | A ceiling on the provider requests ONE turn may spend, enforced in the gateway **and** in the collaboration layer. | It bounds the turn; it does not know the day. |
| The durable answer cache | The same answer is served across instances, so a repeated question costs one collaboration, not two. | It helps only when the question repeats. |

**The cap had to be enforced in two places, and that was not obvious.**
The gateway enforces it at the request site, but the collaboration layer
calls `deps.execute` directly on the injected-executor path — and a cap
that only one layer knows about is not a cap. The first test showed
**six calls with a cap of three**; the second, after the collaboration
layer spent the budget itself, showed three.

**What the cap drops, and what it never drops.** The stages that carry
the answer (the analyses, the synthesiser) run first; the stages that
refine it (the verifier, the critic) are the ones that get dropped — and
the turn **says which**:

```
{"verifierSkipped":"provider call cap reached — the turn answered from its own
analyses","criticSkipped":"provider call cap reached — the draft was not put
through a repair pass","callCap":3,"callsUsed":3,"capHits":1}
```

The refinement gates use `>=` and not `>`, because a turn with exactly
one call left CAN still spend it, and the stage that spends it is the
LAST one.

**The counter is honest about its own blind spot.** Without a durable
store it reports `durable: false` and the turn keeps its normal cap —
the deployment is told the counter is off rather than being handed a
number it cannot trust.

**The health route now publishes the day's spending:**

```json
{"quota":{"day":"2026-11-12","used":18,"limit":50,"left":32,
  "turnsRemaining":6,"turnCostAssumption":5,
  "exhausted":false,"exhaustedReason":null,
  "tightest":{"providerId":"openrouterfree","left":32,"limit":50}}}
```

**Two facts, not one.** How much of the day is LEFT is a warning; whether
the day is SPENT is the fact that explains why the turns have gone thin.
The health route publishes both, and it reads the **same counter the
turns read**, so the operator and the deployment cannot disagree about
the day.

**What the sixth call is, and why the default ceiling stayed at six.**
The obvious move was to lower the turn's default ceiling from six to
five, because on the free tier that is the difference between eight
questions a day and ten. But the sixth call is the **critic's repair
pass** — the stage that sends a draft back to the reviewer when it
invents a number or drops a part of the question — and the existing
suites **pin** that behaviour. Lowering the default made twenty-five
tests fail, and every one of them was saying the same thing: a ceiling
that silently removes the repair pass makes the product's «max» mode
weaker than it claims to be. That is the failure this repo keeps
fixing — a capability present in the code and absent in the answer.

So the default stays at **6**, and the quota is handled where the quota
is **known**: the day's headroom lowers the cap, the durable cache means
a repeated question costs one collaboration rather than two, and a
deployment that wants the shallower shape can set
`AI_MAX_PROVIDER_CALLS=5` and get ten questions a day with the repair
pass dropped. The trade is measurable and it is the operator's to make:

| Ceiling | Calls per turn | What is dropped | Turns a day |
|---|---|---|---|
| 6 (default) | 6 | nothing | 8 |
| 5 | 5 | the critic's repair pass | 10 |
| 4 | 4 | the verifier and the critic | 12 |
| 3 | 3 | the verifier, the critic and the crypto research | 16 |

**A spent day stops the turn.** The call cap lowers the turn's **depth**
as the day runs out, and that is the honest saving: the number of turns
the day can buy does not change, so the depth is what has to give. But
at **zero** the arithmetic is different. A request made against an
exhausted allowance does not come back shallow — it comes back **429**,
and on this tier a **failed request counts** against the very budget
that is already gone. So `quotaExhausted()` refuses the provider call
instead of spending it:

```js
// server/aiQuotaBudget.js
quotaExhausted(providerIds, { env, now })
// → { exhausted, reason, fleet }
```

The turn's budget now carries the state, always, so a reader can tell
a normal turn from a starved one:

```json
{"quotaExhausted": true,
 "quotaReason": "the day's provider allowance is spent"}
```

The check sits at the **last possible moment** — inside the role's
call, after the cache has had its chance — so the refusal is a failed
**role**, not a failed turn: the analyses that did run keep their
answers, and the turn still produces something.

**An uncounted day is not an exhausted day.** With no durable counter
the flag is `false` and the turn keeps its normal cap, because a turn
that cannot see the day must not behave as though it were spent.

**Tests:** `test/intent-ai/ai-provider-quota-budget.test.mjs` (18) and
`test/intent-ai/ai-answer-cache-durable.test.mjs` (12).


---

### 5.18 Path 14b — the route engine gets a LIVE source

`server/fios/routeIntelligence.js` was **complete and dark**. It ranked
candidate routes across five honest dimensions — total cost, liquidity
impact, time in flight, historical success, bridge risk — it refused to
invent a dimension it could not read, and it discounted the score by the
weight of the unread ones. Its own comment said why it had no
customers:

> «a route plan needs candidate routes from the quote step; the
> intelligence layer does not dial providers itself»

So «which bridge should carry this transfer?» had no route intelligence
anywhere, and the engine waited for candidates nobody asked it for.

**The missing half already existed.** The deployment had a live route
provider — the same LI.FI endpoint the wallet's own route list uses.
One call, one set of numbers: **no second provider and no second
quote.**

**The adapter is conservative on purpose.** For each dimension the
provider's OWN field is used when it sent one; otherwise the dimension
is left absent, which the engine reads as UNKNOWN:

| Dimension | Source | What happens when the provider is silent |
|---|---|---|
| total cost | `totalCostUsd`, or the sum of the named fee legs | stays UNKNOWN — the engine reads that as «not free», not as zero |
| time in flight | the provider's own `executionDuration` sum | stays UNKNOWN |
| liquidity depth | **not reported by LI.FI** | **not invented** — the impact estimate stays UNKNOWN and the score is discounted |
| historical success | **not reported by LI.FI** | **not invented** — the engine's own rule is «never imputed» |
| bridge risk | the hop count (known) plus the provider's reliability when supplied | always computable from the hops |

The adapter does not fill a gap with a default that would read as a
measurement. A route with two known dimensions and a route with five
known dimensions are then honestly comparable, because the unknown ones
carry their full weight against both.

**The surface is wired end to end:** the `ROUTE_INTELLIGENCE` intent,
the `routeIntelligence` state section, the `route-intelligence` module,
the planner step, the brain's finding and the headline.

**Two intent-level details worth naming.**

*Why the route question is not an execution.* `EXECUTE_BRIDGE`'s pattern
is deliberately loose — «برو به شبکه» appears at the end of ordinary
sentences — and «کدام پل برای انتقال بیت‌کوین به شبکهٔ پالیگان بهتر
است؟» contains «انتقال … به شبکه», so the bridge leg fired and the
sentence was read as «buy, then bridge». The tell is the sentence's own
grammar: a sentence that asks «کدام» / «بهتر» / «which» / «best» is
asking the product to CHOOSE, and a choice is never a leg of a two-step
execution. The guard lives in `detectCompound`, because it is a property
of the sentence and not of one verb.

*Why the ranking is advisory.* The finding carries the unread
dimensions, because a ranking that silently drops half of them is a
ranking the reader cannot audit; and it carries
`executionPermission: false`, because the execution path re-quotes with
a real address and keeps its own gates.

**Tests:** `test/intent-ai/route-intelligence-surface.test.mjs` (23).

---

### 5.19 Path 15 — the why engine, fed by the brain's OWN decision

`server/fios/whyEngine.js` answers the question every assistant is
eventually asked — **«چرا این را گفتی؟»** — with five why-lines (asset,
network, now, amount, strategy), four named **falsifiers** and the
invalidation conditions. It holds itself to a strict standard: every
«because» line points at a **number** in the decision bundle, an unread
number is NAMED rather than invented, and it refuses to explain a
decision that does not exist.

It was dark, and **the reason was not its fault**: it expected a
decision record from the FIOs decision engine, and the central brain
does not use that engine. The brain has its OWN decision — the
recommendation it builds from its own findings, with its own confidence,
its own risk view and its own evidence list. That is a different shape,
and nobody translated it into the engine's language. So «چرا این را
گفتی؟» was **UNSUPPORTED**.

**The translation, and its one rule.** `server/ci/whyBridge.js` converts
the brain's artefacts into the engine's vocabulary, and the rule is
absolute: **every number in the bundle came from a finding the brain
actually read.** A finding that could not be read leaves the
corresponding line absent, which the engine renders as «unread» rather
than as a zero. The explanation and the answer are therefore made of the
same numbers, and they cannot disagree.

**The read happens AFTER the recommendation is built**, because it
explains THAT recommendation. Reading it earlier would explain the
previous turn's decision — a different and wrong thing.

**The falsifiers travel with the answer**, because «why» without «what
would prove this wrong» is a justification, not an explanation.

**A correction worth naming.** The English patterns for both new
surfaces were first written with a literal **backspace character** where
a word boundary belonged, which made every one of them silently never
match. The Persian patterns worked, which is exactly how a one-language
surface can hide a broken regex. Both files were scanned for the
character, and the boundary is now a real one.

**Tests:** `test/intent-ai/why-decision-surface.test.mjs` (19).

---

### 5.20 Path 16 — the session machinery, under the turn and not beside it

The last two dark engines are **not surfaces**. They are **machinery**.

`conversationState` is a state machine over a financial conversation —
DISCOVERY → UNDERSTANDING → CLARIFICATION → RESEARCH → STRATEGY →
SIMULATION → PROPOSAL → CONFIRMATION → EXECUTION → VERIFICATION →
MONITORING → REPLAN → COMPLETED — with legal edges, an adaptive question
bank that asks only for the fields the conversation still lacks, and a
rule that an illegal edge is REFUSED with the legal edges named.

`eventReplanning` listens on the central event bus and re-plans when the
world moves under a plan: a price moved, a balance changed, the risk
level moved, a module degraded. It has cooldowns per trigger family, so
a busy market does not produce a replan storm.

**Making them modules would be a lie of the same kind this repo keeps
fixing.** A module is something the user asks for. A user-facing
«replan my conversation» button is not what a conversation-state
machine IS. The honest integration is two halves:

**The TURN ingests the message** into the conversation, advances the
state, and asks **ONE** adaptive question — the first missing field, not
a questionnaire — in the machine's own voice. The question joins the
turn's own missing-information list, so it is asked in the same voice as
every other missing field. The conversation's row is written into the
**session section** beside the compacted memory: the memory is what the
brain REMEMBERS, and the conversation row is where the conversation IS.

**The EVENT BUS drives the replan.** The engine already listened on the
bus and already knew which events mean «reconsider the plan». What was
missing was that **nobody READ the result**. The turn now reads the
last attempt and publishes it as a finding, carrying what changed and
whether the owner should be told. A replan that crossed nothing
decision-relevant is recorded and **NOT announced**: a notification for
every price tick is how an alert stream becomes noise.

**Three things this integration deliberately does NOT do:**

· it does **not** trigger a replan from the turn. Triggering belongs to
  the bus, and the cooldowns exist to prevent a replan on every message;
· it does **not** make the machinery a capability. There is no module to
  invoke, and there should not be one;
· it does **not** let a missing engine break a turn. A turn without the
  conversation machine is a **shallower** turn — it asks no adaptive
  question — not a failed one.

**The turn now also reports its findings.** They ARE the evidence: the
recommendation's reasons point at them, and a reader who cannot see
them cannot check it. This is also how the route ranking, the why block
and the replan become observable without each of them inventing a new
field.

**Tests:** `test/intent-ai/session-machinery.test.mjs` (23) and
`test/intent-ai/session-machinery-integration.test.mjs` (6).

---

### 5.21 The engines were reachable, and all three were still dark

§5.18–§5.20 closed the dark-engine count, and the count was honest:
every engine in `server/fios/` had a path from the brain. The path
existed, the provider was mounted, the engine ran.

**And all three of them still did not answer.**

This is the third time this document has had to record the same shape
of failure, and the shape is worth naming precisely, because it is
invisible to the kind of test that gets written:

> A capability can be **present in the code**, **wired in the graph**,
> **mounted at runtime**, **proved by tests**, **documented as
> shipped** — and still be **absent from the answer**. Every one of
> those five claims was true of the route engine, the why engine and
> the session machinery, at the same time, on the same deployment.

The reason the tests missed it is the reason this section exists: the
surface tests drove the engine **directly**. They proved the parts.
They could not prove the whole, because the whole is a PATH — a path
that has to carry a request the engine needs, at a moment when that
request exists.

**The three defects, and they were not the same defect.**

| Engine | What was missing | Why the surface test could not see it |
|---|---|---|
| `routeIntelligence` | the TRANSFER — source chain, destination chain, both tokens, the amount | the engine was called with a transfer, so the test called it with a transfer |
| `whyEngine` | the DECISION — and then the why-lines themselves, thrown away by the provider | the engine was handed a decision, so the test handed it one |
| `conversationState` | the QUESTION — the machine's own wording, replaced by a generic sentence | the machine was asked, so the test saw it asked |

Each one was a missing INPUT, and each one was supplied by the test
rather than by the deployment.

**The route engine.** The route module's read received `{ symbols,
now }` and nothing else. The transfer never arrived, so every route
question answered `ROUTE_REQUEST_INCOMPLETE` — the engine was
reachable, the adapter was reachable, LI.FI was wired, and no route was
ever ranked in a real turn. The transfer now travels as a PAGE CLAIM:
the cross-chain panel publishes the transfer it is looking at, the page
claim carries it, a PARTIAL transfer is dropped there, and the module
reads it.

**The why engine.** Three defects stood between the engine and the
reply, and each one alone was enough to hide it:

1. the why FINDING was built inside `buildFindings`, which runs BEFORE
   the recommendation the engine explains — so it could only report a
   read that had not happened yet;
2. the reply preferred the failed section read over the successful one;
3. the provider returned `out.why` — the INNER object — while the
   reader expects the whole record and reads `why.why`. Every why-line
   arrived as null.

**And the fake was the reason the third one survived.** The test stood
here used a fake provider that spoke a shape of its own, and that fake
AGREED with the broken implementation. A fake that agrees with the
implementation cannot catch a mismatch between the implementation and
the engine it is supposed to read. The real engine is mounted now.

**The session machinery.** The machinery asked ONE specific question
and the reply asked a different one. `askFor()` composed its own
sentence from the missing-field list, and the machine's question stayed
in the context — visible to a developer, invisible to the user. The
machine's question comes first now, with one exception: when the
sentence matched no route at all, the registry's question is the honest
one, because the machinery asks about the OWNER and the registry asks
about the SENTENCE.

**The rule this section leaves behind.**

> A test that drives an engine directly proves the engine. Only a test
> that drives a TURN proves the engine is REACHED.

That is the whole difference between the surface tests and the runtime
tests, and it is worth about ninety lines of test code:

```
test/intent-ai/route-intelligence-runtime.test.mjs   4/4
test/intent-ai/dark-engines-runtime.test.mjs          8/8
```

The runtime tests run a REAL brain turn, with the real module path, the
real bridge and the real provider — and they assert on the ANSWER, not
on the fact that the provider was called. The route test asserts that
the live source was asked with the right chains, tokens and amount,
and that a question without a transfer spends no request at all. The
why test mounts the REAL engine, so a fake cannot stand in for the
thing under test. The session test asserts that the machine's own
words appear in the reply.

**The dark-engine count is now zero in the only sense that means
anything: an engine that does not reach the answer is dark, however
many paths lead to it.**

### 5.22 The general guarantee, and the two bugs it found on the first run

§5.21 ended with a rule:

> a test that drives an engine directly proves the engine; only a test that
> drives a TURN proves the engine is REACHED.

That rule was written about three engines. It turned out to be a rule about
**all** of them, and writing it down as a general rule is what found the
next two bugs — both of which were invisible to every test that existed.

#### The harness

Two scripts, and the split between them is the split between the two ways
an engine is reached.

| script | what it asks | what it proves |
|---|---|---|
| `scripts/probe-engine-reach.mjs` | the BRAIN a sentence, for every INTENT | an intent's engine reaches the reply |
| `scripts/probe-engine-sweep.mjs` | the FIOs ROUTER the call each engine's own page makes, for every ENGINE FILE | an engine reaches an answer at all |

The two sets are not the same set. A module can host an engine; an engine
can exist with no module at all. And the FI router reaches forty-one
engines directly, with no brain turn in the picture — their bug is the
opposite of a dark engine's: an engine that answers its own page perfectly
and is invisible to the conversation.

A guarantee that only covered the brain path would have left the FI path
unmeasured, and the FI path is where the bulk of the intelligence lives.

**The result of the sweep:**

```
  engine files            49
  mounted in the root     44
  reached over its route  47
  NOT reached             0
  no route in the sweep   0
  not engines at all       2
```

The two that are not engines are **named**, so the gate does not cry wolf:
`flags.js` is the feature-flag registry every engine asks before it runs,
and `provenance.js` is the envelope module — the only way to build a
financial value with a source and a timestamp. Neither has an output of
its own, so there is nothing for either to reach.

#### The rule the sweep obeys

It calls **real routes with real bodies**. It does not reach into an
engine and call a method, because that would prove the engine and nothing
else — which is the mistake §5.21 was about.

Two of those bodies had to be *built* before the call could be made, and
that is the sweep earning its keep rather than merely measuring:

- the **agent runtime** refuses an agent it does not know — the right
  refusal — so the sweep **registers** one over its own route first;
- the **why engine** explains a DECISION and a **trace** records it, and
  the two have different ids, so one call makes both and the path says
  which one it wants.

#### The first run found two bugs. Neither was in the engines.

**Bug one — a question about which bridge was read as an instruction to
move the money.**

The `EXECUTE_BRIDGE` pattern is deliberately loose — «برو به شبکه» appears
in the middle of an ordinary sentence — so it matches «انتقال بیت‌کوین به
پالیگان» inside «کدام پل برای انتقال بیت‌کوین به پالیگان بهتر است؟».

The route intent was supposed to win that sentence, and it does so by
PRIORITY: 0.055 against 0.04. But the priority only decided the winner
once both intents were scored, and the route intent was never told that
its own section was already in memory — so it sat at 0.755 while the
instruction sat at 0.760, and **the instruction won by five thousandths**.

The root cause was a name, in three parts:

- `requires: ['route-intelligence']` names a **MODULE**; `stateHas` is
  keyed by **STATE SECTION**, and the section is `routeIntelligence`. The
  two names had never met.
- so `needsFetch` asked «have we read it yet?» about a key the state does
  not have, and the answer was «no» — forever. The route intent never got
  the warmth nudge a section already in memory earns.
- and `stateHas` was itself a **fixed list** that did not contain
  `routeIntelligence`, `whyDecision`, `globalIntel`, `opportunityFit`,
  `macroGraph` or `goalScenarios` — every surface added after the first
  dozen.

The fix: `stateHas` is derived from the state sections themselves now, so
a surface can no longer be half-added; and the two lookups that were
asking the wrong question ask the right one, with the mapping written down
in both directions next to the code that uses it.

**Bug two — the owner's capital was invisible to seven engines.**

Net worth is `assets − debt`, and debt is only a NUMBER when the `lending`
or the `borrowing` section was read. For an owner whose sections do not
include them — which is most owners, most of the time, because the brain
only reads `lending` for the intents that are about loans — `netWorthUsd`
is `null`.

That `null` is honest. The owner may have a loan.

But it was read as «no capital», and seven call sites across five files
took that reading:

- the **fit** engine scored an opportunity against a null net worth, so it
  could not say whether the opportunity was a sensible size;
- the **scenario** engine refused to model a goal — `NO_STARTING_CAPITAL`;
- the **decision** engine could not price a benefit;
- the **macro graph** had no owner capital, so the regime had nothing to
  be a regime FOR;
- the **agent council** had nothing to weigh.

The fallbacks now live in **one** place — `capitalUsdFor` — so the next
engine cannot invent its own:

1. net worth, when it is a number;
2. the gross assets, when they are a number;
3. the available capital, when it is a number.

And what it never does is **invent a debt of zero**. `netWorthUsd` stays
`null`, because it is `null`. The engines that must know whether the owner
is in debt still read it from there. `capitalUsdFor` answers a different
question: *how much capital can this engine reason about?*

Two of the call sites were also reading the wrong **shape**:
`conditionalAllocation` and `council` read `financial.net.netWorthUsd`,
which is a **provenance object** (`{ value, status, reason }`), not a
number — and `num()` on an object is `null`.

#### The build that was failing, and what it was actually about

While the sweep was being written, the CI build was failing on every
commit — and the failure was not in the AI code. It was the **first-paint
byte budget**, and the cause was an import edge two hops from the thing
that hurt.

| | first paint | verdict |
|---|---|---|
| `b073f6f` (before the route work) | 1814.25 KB | ok |
| with the route work | **1839.71 KB** | **over the 1825 KB budget** |

The published-transfer store — three numbers and three strings — lived
inside `src/lib/intentCrossChainClient.js`, because that is where the
cross-chain browser client lives. The brain client reads the published
transfer on every turn, and the brain client is on the entry path:

```
central/client.js  →  intentCrossChainClient.js
                    →  @noble/ed25519, @noble/hashes, server/ethersLite.js
```

So one import edge put a signing library, a hash library and an ethers
implementation into the **first-paint bundle** — **26 KB**, to say which
chain, which token and how much.

The store now lives in `src/lib/routeRequestStore.js`, which has **no
imports at all**. The 26 KB stays where it belongs — in the chunk that
actually signs things — and the feature costs **0.8 KB**:

| | first paint |
|---|---|
| before | 1814.25 KB |
| with the feature, as it was | 1839.71 KB |
| with the feature, as it is now | **1815.05 KB** |

**And the gate now reports the EDGE, not the bytes.**
`test/intent-ai/first-paint-import-graph.test.mjs` walks the import
graph from the entry point and fails if a heavy package or a heavy local
module reaches it — **directly or transitively**, because the edge that
hurt was two hops from the thing that hurt, and one hop is exactly where
an import looks innocent. It also names the chain that reaches it.

The gate is proven: with the old edge restored, three of its five tests
fail. The byte ratchet is still there and still right — it caught this —
but it reports a number, and the lesson here was a shape.

#### The ten intents that were never spoken for

The sweep asked about twenty-six intents. The list has **thirty-six** —
and the ten it did not ask about were the **EXECUTION** ones, the ones
with consequences. A misclassified `EXECUTE` is a transaction the user
did not ask for, so the sweep grew to cover all of them, in the shapes
that produce the most DANGEROUS confusion:

- a QUOTE that reads like an ORDER («قیمت سواپ بیت‌کوین چقدر است؟»
  wants a price; «ETH را به USDC سواپ کن» wants the trade);
- a NAVIGATION that reads like a COMMAND («برو به شبکه پالیگان» is a
  bridge, not a page);
- a CONFIRMATION that only means something when there is an action
  waiting — which is why those two probes carry a SETUP turn, because a
  confirmation is a property of a conversation, not of a sentence.

It found **five real holes**, and every one of them was in the language,
not in an engine.

**One — a destination on a chain is not a page.** The navigation pattern
was `/برو به (صفحه )?/` — the page word was **optional**, so «برو به
شبکه پالیگان» was a request to *see* a screen. It only surfaced when
the wallet was unreadable, because the execute intent was then
down-scored — but the sentence was wrong either way: a sentence whose
meaning depends on an unrelated dependency being up is a sentence that is
wrong. The navigation verbs now need their object.

**Two — a frozen constant cannot be sorted in place.** `stateDigest`
sorted its `keys` argument in place, and both defaults
(`STATE_SECTION_IDS`, `ANALYSIS_MINIMUM`) are `Object.freeze`d. In
strict mode — which ES modules are:

```
TypeError: Cannot assign to read only property '0' of object '[object Array]'
```

and it was not a rare path: `CANCEL_PENDING` has no entry in
`SECTION_FOR_INTENT`, so its section list IS `ANALYSIS_MINIMUM`, and
**every cancellation turn died on the way to its answer**.

**Three — `QUOTE_BRIDGE` had no rule at all.** The intent was declared,
given modules, given a priority and given a place in the plan, and
nothing could ever produce it. Asking what a bridge *costs* could only
be `EXECUTE_BRIDGE`: the user asking about a price was asking for a
bridge to be taken.

**Four — a lend is not a borrow, and the verb decides.** The patterns
only knew «سپرده» and «بدهی» — the **bank's** words. The words people
use are «وام بگذار» and «وام را برگردان», and both were `UNSUPPORTED`.
The noun «وام» alone is ambiguous, so the verb decides, and the two verb
lists are disjoint.

**Five — a possessive sits between a noun and its verb.** «یک هدف برایم
بساز» was `GOAL_PLAN`, because the pattern wanted «هدف» immediately
followed by «بساز», and Persian puts «برایم» in between. The gap is now
a fixed distance, because «هدف» and «هدفمن» are not the same word.

#### And the probe was measuring the wrong thing

The wallet source reads the chain over RPC. With no RPC the read fails,
the wallet section goes `STALE`, the capability drops to `UNAVAILABLE`,
and every `EXECUTE` intent is down-scored — **correct behaviour**, and a
probe that was measuring a broken dependency instead of a broken engine.
It also **hid** the first hole.

So the sources are now faked **in-process**, the way the turn probes do
it. The brain, the registry, the policy and the state store are all
**real**. The measurement is about the brain's *wiring*, and the brain's
wiring does not need a blockchain to be measured.

#### The result, and the gate

```
  probes                35
  classified as asked   35
  with an OK finding    35
  with NO finding at all 0
```

`test/intent-ai/intent-reach-gate.test.mjs` runs the probe and fails if
any intent is dark, if any sentence does not reach the intent it was
written for, or if a new intent is added without a probe. The second
half is the stricter half: for an `EXECUTE` intent, being read as
something else **is** a transaction the user did not ask for.

`test/intent-ai/intent-language-runtime.test.mjs` pins the five holes
and the distinctions that must not collapse: a lend is not a borrow, a
quote is not an order, a destination is not a page, and «چقدر» alone is
the question word for everything.

#### The gate, and its speed

`test/intent-ai/engine-reach-sweep.test.mjs` runs the sweep **once** and
fails if any engine is dark, if any engine has no caller, or if the two
helpers are counted as engines. The sweep is the source of truth and the
gate *runs* it, rather than copying it — a copy is a thing that drifts.

Sequential, the sweep took **6m32s**, which is a gate nobody runs. The
calls are independent — each engine has its own route, and the owner state
they read is the same seeded state — so they now run **concurrently**,
with a cap of eight. An unbounded fan-out would open forty-nine connections
at once, and a probe is not a licence to hammer the machine it is
measuring.

| | before | after |
|---|---|---|
| the sweep, sequential | 6m32s | — |
| the sweep, concurrent (cap 8) | — | **56s** |

Same answer, seven times faster.

#### What this changes about the count

The old row said «`server/fios/` engines the brain can reach: 0 of 50 → all
of them». That was true and it was the wrong number, because *reachable*
is not *answering*. The number that means something is now measured two
ways and it is the same:

| | before | after |
|---|---|---|
| engines that reach an ANSWER, over their own route | — | **47 of 47** |
| intents whose engine reaches the REPLY | — | **35 of 35** |
| sentences that reach the intent they were written for | — | **35 of 35** |
| engines dark | — | **0** |

The rule from §5.21 was the last three failures' lesson. It turns out to
be a rule about the whole library, and applying it as one found two bugs
that no surface test could see.

## §6 — The one-paragraph answer

Of 206 registered intent phases, **51 are actually connected to the AI**
— that number has not moved and it is the real ceiling. But the *module*
half of the same question **has** moved: the brain now asks for **30 of
the 31** registered modules instead of 27, because the yield surface —
`farming`, `liquidity` and `staking`, three capabilities that were
registered, readable and **unreachable by any intent** — now has three
intents of its own (§5.9), and the global-intelligence engines in
`server/fios/` now have a fourth (§5.10). A user who asked «بهترین ییلد کجاست؟» or
«ریسک نقدینگی LP چقدره؟» got `UNSUPPORTED`; they now get a live APR
with the risk, the depth and the impermanent-loss flag beside it, and the
one thing that made it invisible was not a missing feature but a
**mis-owned word**: «yield» belonged to `ASSET_ANALYSIS`, whose modules
are the crypto ones, and a follow-up rewrite turned every «ریسک … چقدره؟»
into a question about a loan. The background CPU
is not in the phases at all: it is `/api/cron/daily` (630 ms, eleven jobs)
and `/api/cron/scenario-evidence` (334 ms), which together are **92 %** of
it, and the request path is cheap (`/api/ai/ask` 65 ms warm against a
four-hour budget). The "dark phases" story turned out to be **one
administrative mistake with three faces**, and all three are now fixed: a
**race** (the asynchronous probe had not run when a cold process answered
— 41 live instead of 176, with 165 phases falsely claiming
`RUNTIME_PROBE_NOT_COMPLETED`), a **made-up env var** (23 phases blocked
by five variables that only the probe itself reads, while their adapters
were already imported and serving), and a **missing `.js` extension**
(4 phases whose module could not load at all — pre-existing on `main`).
The probe now **measures** the phase's own provider module instead of
guessing, the boot **warms** it once in the idle phase, and the
multi-venue engine is **wired into the brain's `PROFIT_PLAN`**, so 16
paid-for dark phases are now the brain's real answer — with the venues
it can reach and the reason each one could not answer. The cost of being
honest was **+65 ms of CPU and +3 modules** per cold start, because the
first version of the new probe *imported* the modules and paid 761 of
them. And the two request-path wins are in: `phase-status` now has a
**23 KB summary** (down from 148 KB) and `/api/cron/daily` now reports
**eleven named jobs with their own cost** instead of one 563 ms number,
which shows that `self-probe` and `smart-money` are 44 % of it between
them — and, since that measurement, the two request-path wins have been
turned into real savings: the daily cron no longer re-measures evidence
whose TTL is six hours, and no longer runs the wallet indexer twice a
day (§5.11). The last open lever on the cost side was then measured
rather than assumed: the prompt is **92.5 % contracts and 5.3 % evidence**
(§5.12), so a "prompt diet" has nothing left to cut, and the quota is
spent on the **number of calls**, not on the size of the rules — the
local-first gate already cut 20 questions from 100 provider calls to 55.
And the deep engines stopped being an inventory: the **fit surface**
(§5.14) reached the one that answers «کدام گزینه مناسب من است؟» — the
question about the user's own money, which had a complete engine
(FITTED / CONDITIONAL / NOT_FITTED, with a reason per dimension) sitting
unreachable — and reaching it exposed the real reason the global
surface had never worked over HTTP: the provider was wired only when
`/api/ai` was mounted, and `/api/brain` never mounts it, so every
«پول هوشمند کجاست؟» had been answering `PROVIDER_NOT_WIRED` next to a
working smart-money engine. The bootstrap now happens on the **first
turn** (813 ms CPU, once per process) and the boot is untouched
(306 ms CPU, 305 modules). And the third of the deep engines — the
**macro graph** (§5.15), which answers «بازار در چه رژیمی است؟» by
reading the global snapshot, the world model and the portfolio
TOGETHER — was added to the market overview without a new intent at all,
because «وضعیت بازار چطوره؟» was already `MARKET_OVERVIEW` and simply
could not reach the engine that answered half of it. And the fourth,
the **goal scenarios** (§5.16), turned the goal plan from one
feasibility figure into three profiles — conservative, balanced,
aggressive — each with its modelled drawdown, its probability of loss
and its probability of halving, and each willing to say «a scenario
needs real capital; nothing was modelled and nothing was guessed» when
the capital is not there. And then the last four arrived, each in the
way its own nature demanded: the **route ranking** (§5.18) got the
deployment's EXISTING live route provider as its candidate source — one
call, no second quote — so «which bridge should carry this transfer?»
now compares priced, timed routes and names the dimensions the provider
never measured; the **why engine** (§5.19) was fed by a **translation**
of the brain's own decision into the vocabulary it reads, so «چرا این را
گفتی؟» — which was `UNSUPPORTED` — now answers with five reason lines
and four named falsifiers; and the **conversation state and the event
replanning** (§5.20) were wired into the **session layer** rather than
made into modules, because a user-facing «replan my conversation» button
is not what a conversation-state machine IS. The turn now ingests the
message into the conversation, advances the state, and asks ONE adaptive
question — the first missing field, not a questionnaire — while the
event bus re-plans when the world moves and the turn says so only when
something decision-relevant actually changed. **The dark-engine count
is ZERO** — and then that sentence was itself tested, because a count
about REACHABILITY had already been wrong twice in this document, and
§5.21 proved that all three of the last engines were reachable AND still
dark. So the count became the **answer**: every engine in `server/fios/`
is now asked, over its OWN route, whether it reaches an answer, and
**47 of 47 do, with 0 dark and 0 without a caller** (§5.22). The first
run of that sweep found two bugs no surface test could see: a comparison
question about which bridge to use — «کدام پل برای انتقال بیت‌کوین به
پالیگان بهتر است؟» — was classified as an **instruction to move the
money**, because the rule named a MODULE and the state was keyed by
SECTION and the two names had never met, so the route intent sat half a
thousandth below the instruction and lost; and an owner whose `lending`
section had never been read — which is most owners, most of the time —
had **no capital at all**, so the fit engine, the scenario engine, the
decision engine, the macro graph and the agent council were all
reasoning about nothing. Both are fixed, the second through ONE shared
helper (`capitalUsdFor`) that falls back to the gross assets without ever
inventing a debt of zero, and the guarantee is now a **gate** — the
sweep runs in the suite, so a future engine cannot join the library dark.
What remains is the honest ceiling: **more phases would not
make the AI smarter — making the existing ones reachable would.** That
sentence is now the method, not a slogan: it is exactly what §5.9,
§5.10 and §5.11 did, with four intents, four findings, no new phase and
no new provider call — and what §5.17 added on top, because the quota
is spent on the **number of calls**: a turn now has a ceiling, the day
has a counter, and the cache survives a cold start.

### 5.23 The half of the question that was dropped

§5.22 ended with a general guarantee: every engine is reachable, every
intent reaches its answer, and the guarantee is a gate. That guarantee
was about the **engine**. It said nothing about the **sentence**, and the
sentence turned out to be where the next silent failure lived.

A person asks two things when they say two things.

> «قیمت بیت‌کوین چقدره و موجودی من چقدره»

is a price question **and** a balance question. The brain answered one of
them — cleanly, confidently, with a headline, a reason, a data section and
a confidence — and the other half of the sentence vanished without a
word. Nothing in the reply said a half was missing.

**Measured, over the reply:**

```
  two-part questions        6
  both parts answered       1
  parts answered            5 / 12
  coverage                  41.7%
```

The measurement had to be over the **reply**, not over the classification,
and that distinction was the first thing that had to be learned. The
classification was never wrong: classifying
«قیمت بیت‌کوین چقدره و موجودی من چقدره» as a `BALANCE_QUERY` is a
defensible reading of a two-part sentence. What was wrong is that **the
other half of the answer never arrived**. A brain that answers one
question when asked two is silent data loss, and the loss is invisible
unless the measurement is taken over the text the user reads.

#### Why the half was dropped

The merge machinery already existed. `planner.js` merges the templates of
every leg in `intent.compound` into ONE ordered plan with a single
confirmation gate, `brain.js` widens the step budget by
`6 × compound.length`, and `recommend.js` already says «یک تأییدیه برای
هر دو مرحله کافی است». All of it was built for «convert, then bridge to
Arbitrum».

What was missing was the **detection**, and the detection lived in exactly
one place: `COMPOUND_PATTERNS` in `src/lib/central/intent.js`, with **two**
entries — bridge-to-network and lend-after-buy. A generic «X و Y» question
matched neither, so `classification.compound` stayed `null`, so the
planner built one leg, so half the sentence was dropped.

The fix is therefore not a bigger classifier. It is **splitting the
sentence and classifying each half**:

| concern | where it lives | why |
|---|---|---|
| what a sentence is ABOUT | the rule table (`RULES`) | vocabulary |
| how MANY things a sentence is about | `splitClaims()` | structure |

Keeping them apart matters. A rule table that tried to match «X و Y»
would need one rule per **pair** of intents — thirty-six intents, six
hundred and thirty pairs. The splitter needs one rule: «a conjunction
between two claims».

```
  قیمت بیت‌کوین چقدره و موجودی من چقدره
    → ASSET_ANALYSIS + BALANCE_QUERY
  پورتفوی من چیست و ریسکش چقدر است
    → PORTFOLIO_ANALYSIS + RISK_OVERVIEW
  وضعیت بازار چطوره و کدام گزینه مناسب منه
    → MARKET_OVERVIEW + OPPORTUNITY_FIT
  بهترین استخر ییلد کدام است و ریسک نقدینگی‌اش چقدره
    → YIELD_OPPORTUNITY + LIQUIDITY_RISK
  وضعیت وامم چیست و با پورتفویم چه نسبتی دارد
    → LOAN_STATUS + PORTFOLIO_ANALYSIS
```

Three things are **not** a second part, and each of them was a bug first:

- **a comparison** — «کدام پل بهتر است؟» asks for a choice, and a choice
  is one question. The guard is about the WHOLE sentence: the comparison
  words can sit inside ONE half of a two-part question
  («وضعیت بازار چطوره **و کدام** گزینه مناسب منه»), and then the other
  half is still a real second claim.
- **the same intent twice** — two halves that classify to one intent are
  one question asked twice, and two legs would read the same section
  twice and answer it twice.
- **an answer-form instruction** — «… و بگو» asks for the FORM of the
  answer, not for a second claim.

#### Four holes the coverage number was hiding

Getting from 41.7% to 100% was not one change. The measurement exposed
four **separate** holes, each of which a passing coverage number alone
would have hidden, and each of which was a defect on its own.

**1. «ریسک چقدر است؟» had no intent at all.** The `risk` module was
registered, readable, and produced a full verdict — level, factors,
confidence — and **nothing could reach it**, because every risk intent
that existed was about a *specific* risk: concentration, liquidity,
futures. The general one was a hole in the registry. It is now
`RISK_OVERVIEW`, and it is in `EXPLICIT_INTENTS`, so «ریسک» is not
stolen by the follow-up rewrite that assumes every «ریسک» means the risk
of a loan. The specific risks keep their own intents: «ریسک نقدینگی» is
`LIQUIDITY_RISK`, «ریسک پورتفوی» is `PORTFOLIO_ANALYSIS`.

**2. «موجودی من چقدره؟» answered with a COUNT.** The wallet was read
and the reply said «wallet.read: 2 balances across 2 chain(s)». The
number was there — the total, every amount, every USD value — and none of
it was shown. A count is not a balance. There is now a `wallet-balances`
finding and a headline that names the total and the rows.

**3. «هدفت چیست؟» was answered with a Solana PDA.** The marker «چیست»
was enough on its own to make the turn "conceptual", so the internal
synthesis ran, and the corpus matched the nearest definition — an
article about program-derived addresses. The user asked about **their own
goal** and got a glossary entry. The distinction is the SUBJECT: «بیت‌کوین
چیست؟» asks what a *thing* is; «هدفت چیست؟» asks what the registry's
`GOAL_PLAN` read. When the registry already knows what the sentence is
about, its reading wins — the synthesis is a fallback for a sentence the
registry could not place, not a competitor to a reading it already has.

**4. «برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟» asked for «ارز مبدأ،
ارز مقصد، مبلغ»** — the SWAP question. `GOAL_PLAN` has a `goals.plan`
`simulate` step, and the money-step check treated every `simulate` as a
money operation, so a goal question demanded a trade's inputs. The bug
was in the VERB: a simulation of a *goal* is arithmetic over the owner's
own numbers, and a simulation of a *trade* is a swap quote. The rule is
now about the INTENT, not the verb: a READ-only intent never asks for a
trade's inputs, however it computes.

That last one also uncovered a **test that passed because of a bug**. The
conversation machinery's own question («این پول برای چیست؟») reached the
reply only because the goal question was accidentally in QUESTION mode —
asking for a swap's fields — and `askFor()` prefers the machine's
question whenever the missing list does not contain `intent`. The fix
reads the gap from the machine's own missing list
(`context.conversationQuestion.missing`), so the reply asks for the field
that is actually missing; and a turn that was **already answered** (a
corpus answer, a model answer) is never turned back into a question,
because the answer and the question would fight and the answer would
lose.

#### The goal is read through ONE reader

The goal arrives from three places that each spell it differently:

| source | target | horizon | contribution |
|---|---|---|---|
| the goal list | `targetAmount` | `durationMonths` | `monthlyContribution` |
| the central state | `targetUsd` | `horizonMonths` | `contributionMonthly` |
| the engine's record | `targetAmount` | `targetDate` | `monthlyContribution` |

Two readers that each knew one spelling produced one answer and one
silent `GOAL_INPUTS_INCOMPLETE`, with no clue which name was wrong. The
reading lives in ONE place now (`readGoalInputs()` in
`src/lib/central/analysis.js`), and the brain and the goals module both
use it — so they cannot disagree about which shape the goal has.

#### The guarantee

```
  two-part questions        6
  both parts answered       6
  parts answered            12 / 12
  coverage                  100.0%
  execution legs            0   (a question is not a permission)
  plans with a money step   0
```

Two files make it a gate:

| file | what it locks down |
|---|---|
| `test/intent-ai/multiquestion-gate.test.mjs` | every part answered; **no leg is an execution**; no plan carries a money step |
| `test/intent-ai/multiquestion-language-runtime.test.mjs` | the four holes, and the distinctions that must not collapse |

The second guarantee is the one that matters most. Answering half a
question is a defect; turning the question into a **transaction** is a
catastrophe. «قیمت بیت‌کوین چقدره و موجودی من چقدره» must never gain an
`EXECUTE_SWAP` leg, and the gate checks the **plan** as well as the
classification, because a plan is where a question would start moving
money.

`scripts/probe-multiquestion.mjs` drives the six questions through the
real brain with the in-process fakes — the brain, the registry, the
policy and the state store stay real, only the external sources are
faked — and it reports the coverage, the legs, the execution legs and the
money steps. `--json` emits JSON only, so the gate can read it.

#### The rule this leaves behind

> **a brain that answers one question when asked two is silent data loss —
> measure coverage over the REPLY, not the classification.**

The classification can be perfect and the answer still incomplete. And
the coverage number is not the work: it is the **instrument**. Every one
of the four holes above was found by asking a narrower question than
"does it work?" — *does the reply carry the number?*, *does the corpus
answer the question that was asked?*, *does the question ask for a
trade's inputs?*, *does the machine's question reach the reply?*. A
system that passes "it works" can still be silently losing half of
what it was asked.

The sharpest illustrations were not the hard ones. `server/fios/` is 50
files and 980 KB of working global-intelligence engines that **zero**
intents could reach, and the brain's own `signals` module is an SMA cross
and a volatility — a price computation, and not smart money at all.
Wiring it needed a **bridge** rather than an import, because `fios` is
built after the brain and the brain before `fios`, and it needed a **plan
template**, because an intent with no template has an EMPTY plan and an
empty plan reads nothing. The daily cron, by contrast, turned out to be
doing its work **twice**: the self-probe re-measured evidence whose TTL
is six hours, and the smart-money indexer ran from two different crons.
Both duplications are gone, and — this is the part that matters — both
skips are **reported by name** rather than being silent, because a saving
that is indistinguishable from a measurement is a saving that hides a
failure. A failure finally says *why* it failed, an unexpired proof is
never re-issued with a fresh expiry, and an intent that reaches nothing
now fails the contract test that says it must.

The last one is the plainest of them. When the guarantee was pointed at
the **sentence**, the sentence turned out to lose half of what it was
asked — «قیمت بیت‌کوین چقدره و موجودی من چقدره» was answered with the
balance and not with the price, and the reply looked complete. **Five of
twelve parts answered.** Nothing in the answer said a half was missing,
because a confidence and a reason and a data section are all present
whether or not the answer is the answer to the question that was asked.
So the measurement has to be over the **reply**, not over the
classification — and it has to be over the **plan** as well, because the
failure that matters most is not a missing half but a half that became a
transaction. Twelve of twelve now, with zero execution legs and zero
money steps, and the gate is in the suite. The sentence is split, each
half is classified on its own, and the merge machinery that was built
for «convert, then bridge» finally gets used for the questions it was
always able to answer.
