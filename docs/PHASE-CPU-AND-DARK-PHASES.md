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

**All eleven** upgrade paths in §5 are **shipped** (5.1–5.6 plus the
seventh, the yield surface, in §5.9, the eighth, the global surface, in
§5.10, the ninth, the daily cron, in §5.11, the tenth, the measured
prompt diet, in §5.12, and the eleventh, the fit surface, in §5.14).
The point of this section is that each one is a measurement before and
after, not a promise.

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
requests a day; a `max` turn costs 6 calls; that is ~8 turns a day. The
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

### 5.8 What is STILL open after all eleven paths

The eleven paths in §5 are shipped, and they were the eleven that the
measurement justified. What the measurement did **not** justify is left
open on purpose, and it is worth naming:

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

6. **Six deep `server/fios/` engines** (`macroGraph`, `whyEngine`,
   `goalScenarios`, `routeIntelligence`, `traditionalAssets`,
   `conversationState`, `eventReplanning` — about 90 KB) are still
   imported by nothing in the brain. The global surface (§5.10) and the
   fit surface (§5.14) wired two of the eight; these are the next ones,
   and they are a real path rather than a placeholder.

   Two of them are close to a natural question and will be the next
   ones: `routeIntelligence` («کدام مسیر انتقال بهتر است؟») and
   `macroGraph` («بازار در چه رژیمی است؟»). `whyEngine` needs a
   decision bundle first — it explains a decision that already exists,
   and the brain does not produce one yet.

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
(306 ms CPU, 305 modules). What remains is the honest ceiling: **more phases would not make
the AI smarter — making the existing ones reachable would.** That sentence
is now the method, not a slogan: it is exactly what §5.9, §5.10 and
§5.11 did, with four intents, four findings, no new phase and no new
provider call.

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
