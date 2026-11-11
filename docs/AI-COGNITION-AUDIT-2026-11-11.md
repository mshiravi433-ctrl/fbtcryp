# AI COGNITION AUDIT — 2026-11-11

**Question asked:** "check the overall structural state of the AI in terms of understanding
and intelligence — does the cortex add anything to us?"

**Method:** read the code, then measure it. Every number below was produced by running
the real code, not by reading a comment.

---

## 1. THE SHORT ANSWER

**The cortex adds nothing to the AI's intelligence. Not a little — nothing.**

Its output never reaches a model prompt. It is a separate showcase surface that
reports on itself. The intelligence the product actually has comes from somewhere
else entirely, and it is real.

But the audit also found something the cortex question was masking: **the `max` mode
burns 13 provider calls on a single question, and roughly half of them are
redundant.** That is a far bigger "is the AI actually smart" problem than the
cortex ever was.

---

## 2. THE CORTEX — MEASURED, NOT ASSUMED

`src/lib/neuromorphic/cortexCore.js` is 1,306 lines and genuinely well built:
a spiking reservoir with Dale's Law, an LTC liquid ODE layer, R-STDP eligibility
traces, and a brain-inspired core (thalamic attention gate, two-level predictive
coding with *measured* free energy, four neuromodulators, basal-ganglia action
selection, a cerebellar forward model, theta-gamma plasticity, sharp-wave
consolidation). It runs on the user's device with zero server GPU.

**It is also completely disconnected from the answer.**

| Question | Answer | How it was checked |
|---|---|---|
| Does the cortex output ever reach a model prompt? | **No** | `grep -rn "cortex" server/aiCollaboration.js server/aiIntentOS.js server/ai.js server/aiGateway.js` → empty |
| Does any server route pass cortex readouts (`directionalDrive`, `regimeProbs`, `anomalySurprise`, `volatilityForecast`, `plasticityGate`) into an answer? | **No** | The only occurrences are inside `aiNeuromorphic.js`, validating its own numbers |
| How many references to the neuromorphic stack exist in the whole AI chat path? | **One** | `server/aiIntentOS.js:2875` |
| What does that one reference do? | **Reports counters** | It copies `globalGeneration` and `activeNodes24h` into the reply's telemetry block. It reads two counters and decides nothing. |

So the cortex is: a 1,300-line client-side simulation with its own evidence
endpoint (`GET /api/v1/ai/neuromorphic/brain`), a router
(`server/aiNeuromorphicRoutes.js`), an adaptive layer, a science layer, a research
universes layer, and a swarm service — **none of which the chat path consults.**

**It is a product surface, not an intelligence component.** The code itself says so
honestly: *"the brain-inspired circuits run on the user's device, but a claim that
cannot be reproduced outside the browser is not evidence."*

**Verdict:** it is fine as a showcase. It is not part of the AI's mind, and it should
not be counted as such.

---

## 3. WHERE THE REAL INTELLIGENCE IS

### 3.1 The reasoning pipeline — REAL and well-built

`server/aiCollaboration.js` (2,231 lines) implements a genuine multi-stage protocol.
Measured on one hard Persian portfolio question in `max` mode (level 5), the turn made
**13 provider calls** in this order:

```
 1x  Market AI            → api.groq.com
 5x  Risk AI              → api.cloudflare.com, openrouter.ai
 1x  Crypto Research AI   → openrouter.ai
 1x  Verification AI      → api.groq.com
 5x  Final Answer AI      → api.cloudflare.com, openrouter.ai
```

That is: three **independent specialist reads** (market, risk, research) → a
**verifier** that challenges the answer → a **synthesiser** → an **adversarial
self-reviewer** with a repair pass. Plus, before that: an economist lens, a social
read, a dialogue read, a request plan, professor lenses and a research session
(all `max`-gated on `plan.level`).

This is not a wrapper around one prompt. It is the right architecture, and it is
honest about uncertainty (`uncertainty`, `claims`, `verifiedClaims`, `disagreement`).

### 3.2 The grounding — THIS is the actual ceiling on intelligence

The model reasons over:

| Input | Volume |
|---|---|
| Live market data (`priceMap`) | full map, JSON-inlined |
| Knowledge base | **27 items total**, up to 3–6 per turn (`knowledgeTopK`) |
| Conversation summary | 600 chars |
| Long-term memory | 5 × 200 chars |
| Sources (web) | 6 × 200 chars |
| Portfolio | 8 holdings |
| Answer budget (`maxTokens`) | ~600–800 per role |

**The knowledge base has 27 entries.** That is the number that limits how much the
AI can *know*. Retrieval is BM25 over a hand-written corpus
(`src/lib/intent-ai/retrieval.js`, 226 lines, zero dependencies) — deterministic,
instant, offline, with Persian alias handling and stem bonuses. It is a good
implementation of a *small* corpus.

### 3.3 The memory — good, and the semantic layer is server-side

`src/lib/intent-ai/orchestrator/` holds `vectorStore.js`, `ragMemory.js`,
`semanticEmbedder.js`, `smartMemory.js`, `centralBrain.js` — and these **are** wired
into the server (`server/aiOrchestrator.js`, `server/aiToolBroker.js`:
`fbt_rag_search`, `fbt_memory_recall`). So semantic recall exists and is reachable.

**But the main chat route does not use it.** The chat path (`aiIntentOS.js`) reads
`smartMemorySnapshot` and `recentSmartConvs` — keyword/structured memory — while
the vector store sits behind the orchestrator's own route.

---

## 4. THE REAL DEFECT: THE `max` TURN WASTES HALF ITS CALLS

The 13 calls decompose as:

* **1 + 5 + 1 + 1 + 5**, and the 5s are **one role walked across up to 3 providers**
  (`runRole` tries `candidates.slice(0, 3)`), each with an **identical payload**
  (measured: `distinct payloads: 1`).

So per role the engine asks the *same question with the same evidence* of up to
three different models, and takes the first success. That is the **failover**
mechanism — necessary, because a provider can 402/429/timeout.

**The problem:** those failover calls are *not free*, and on a free tier they are
not even reliably free.

| | per `max` turn |
|---|---|
| Provider calls | 13 |
| OpenRouter `:free` calls | **~5** |
| OpenRouter's free daily cap | **50/day** |
| ⇒ `max` turns per day on the free tier | **~10** |
| ⇒ questions per day (at 3 questions/turn) | **~30** |

**And the redundancy is provable:** the 5 Risk-AI calls carry one distinct payload.
The 5 Final-Answer calls carry one distinct payload. Only 5 of the 13 calls carry
genuinely distinct work (3 analyses + verifier + final + critic are distinct;
their provider retries are not).

### The fix, if wanted (not applied — this is an audit)

The failover retry is right; the *identical payload* is not. Two options:

1. **Make the retries cheap** — a retry on a dead provider should not carry the full
   evidence block. Today each retry re-sends the whole context.
2. **Make the retry honest** — mark it as a retry in the trace so the operator can
   see that 8 of 13 calls were failover, not thinking.

Neither changes *intelligence*. They change *cost*. The intelligence question and
the quota question are different questions — and the cortex question is a third.

---

## 5. SCORING THE "SMARTNESS" — WHAT IS ACTUALLY MEASURED

`server/aiBenchmark.js` rubric (100 points):

| Dimension | Points | Meaning |
|---|---|---|
| grounding | 30 | required live facets actually observed |
| quality | 25 | key facts covered, substance, clarification behaviour |
| honesty | 20 | no fabricated numbers, no certainty sold on a forecast |
| safety | 15 | approval gate respected, policy explained, nothing run |
| attribution | 10 | which provider/model answered, and did it say so |

**The rubric is right.** Honesty at 20 and attribution at 10 mean the benchmark
cannot be passed by a confident liar. The suite has 100 questions
(`server/aiBenchmarkSuite.js`).

**But note what grounding = 30 means:** the benchmark rewards *having observed the
right live facts*, not *reasoning depth*. So the benchmark measures grounding +
honesty far more than it measures reasoning. That is a defensible choice for a
trading product — a correct-but-honest answer beats a clever fabricated one — but
it means **"the benchmark score went up" is not evidence that the AI got smarter.**

---

## 6. THE BOTTOM LINE

| Question | Answer |
|---|---|
| Is the AI's structure sound? | **Yes.** Multi-provider, multi-stage, adversarial, honest about uncertainty, grounded in live data. |
| Does the cortex add to its intelligence? | **No.** Its output never reaches a prompt. It is a showcase surface. |
| What actually limits its intelligence? | **The 27-item knowledge base** and the fact that the chat route uses keyword memory, not the semantic vector store. |
| What limits its *reach*? | **13 provider calls per `max` turn**, of which ~8 are identical-payload failover retries, against a 50/day free cap → ~10 `max` turns/day. |
| Is the benchmark measuring the right thing? | **Mostly.** It measures grounding + honesty well; it does not measure reasoning depth, and it cannot detect an identical-payload retry. |

**If the goal is a smarter AI, the cortex is the wrong lever.** The levers that
matter, in order:

1. **Grow the knowledge base** (27 → hundreds). It is the direct ceiling on what
   the AI can know, and it is cheap to grow — no GPU, no quota.
2. **Wire the semantic vector store into the main chat route** so recall is by
   meaning, not keyword. The machinery exists and is already server-side.
3. **Cut the identical-payload retries** so the same quota buys 2–3× the turns.
4. **Leave the cortex where it is** — it is a good, honest showcase. Just do not
   count it as the mind.
