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

1. ~~**Grow the knowledge base** (27 → hundreds). It is the direct ceiling on what
   the AI can know, and it is cheap to grow — no GPU, no quota.~~ **DONE —
   see §7 below.**
2. **Wire the semantic vector store into the main chat route** so recall is by
   meaning, not keyword. The machinery exists and is already server-side.
3. **Cut the identical-payload retries** so the same quota buys 2–3× the turns.
4. **Leave the cortex where it is** — it is a good, honest showcase. Just do not
   count it as the mind.

---

## 7. THE KNOWLEDGE BASE — EXPANDED (2026-11-11)

Lever 1 has been executed. The corpus went from **27 items to 103**, and the
retriever was rebuilt around it.

### 7.1 The corpus

| | before | after |
|---|---|---|
| items | 27 | **103** |
| categories with ≥1 item | 11 of 12 | **12 of 12** |
| categories with ≥3 items | 4 of 12 | **12 of 12** |
| items carrying tags | 12 | **103** |

`FAQ` was empty and is now 5 items. Every one of the twelve categories carries
at least three. The 76 new items live in `src/lib/intent-ai/os/knowledgeWide.js`
(the seed corpus stays in `knowledgeCenter.js`, untouched and auditable).

Coverage added: slippage and price impact · the two-step approval flow ·
quote expiry · gas and priority fees · APR vs APY and why real yield is lower ·
impermanent loss · stablecoin risk · smart-contract risk · a deposit checklist ·
leverage and the funding cost on both sides · stop loss placement ·
diversification · exchange custody · DCA vs lump sum · why traders lose ·
emergency reserves · funding rate · perpetual vs spot · liquidation ·
open interest · order types and time-in-force · what a wallet really is ·
seed phrases · phishing · spending approvals · gas · what a blockchain solves ·
tokens vs coins · NFTs · bridges · ERC-20 vs native · the MVRV in practice ·
CEX vs DEX · dusting · Solana fees, speed, failed transactions, senders, PDA ·
signal reliability · smart-money limits · the assistant's own data sources ·
its honesty rules and its limits · portfolio, earn, signals, security,
derivatives, insurance, support and roadmap · macro liquidity, real rates, safe
haven and ETF flows · SOPR · volume and on-chain divergence · the risk score and
the scenarios.

Every item states only **stable** knowledge. No item contains a price, a
balance, an APY or a date — those come from the live tools at answer time, and
the benchmark asserts that rule.

### 7.2 The retriever was the real problem

Expanding the corpus alone would not have helped: the retriever diluted the
meaning of a question with its function words, could not match a word to its
inflection, and resolved ties by comparing id strings.

Four fixes, all measured:

| fix | what it was doing wrong |
|---|---|
| **stopwords** | the score is `overlap / qTokens.size`, so "how do I recover my wallet" spent two thirds of its budget on *how* and *do*. English and Persian function words are now dropped from the **query only** — the corpus keeps every word, because a stopword can be the whole answer ("is my wallet safe" → "safe"). |
| **light English morphology** | the corpus said *liquidation*, the user wrote *liquidated*; the corpus said *staking*, the user wrote *stake*. A shallow stemmer now converges the `-ation/-ated/-ate` and `-ing/-ed/-s` families. A small blocklist keeps genuinely different words apart: *liquidity* must not collapse into *liquidated*, or a question about getting liquidated retrieves the ETF-flows item. |
| **definitional intent** | "بیت کوین چیست؟" and "what is ethereum" ask for the **definition** of one subject, but many items mention that subject, so plain overlap tied them all and an id comparison decided the winner. The item whose title *is* the definition now wins outright; an item that merely mentions the subject does not. |
| **title tie-break** | when two items are about the same subject and only one carries it in its **title** (not its tags), the title wins. Without this, "how does staking work" was a coin flip between the Earn section and the DeFi yield-risk item. |

One bug worth recording: the `-ing` rules were ordered wrongly, so `staking`
stemmed to `stak` while `stake` stayed `stake` — two tokens for one word, the
exact failure the stemmer existed to prevent. The specific forms must be tried
**before** the general one.

### 7.3 Measured result

Same 56 realistic questions, old corpus + old retriever against the new one:

| | before | after |
|---|---|---|
| corpus size | 27 | **103** |
| questions that find an item | 55 / 56 (98%) | **56 / 56 (100%)** |
| **weak matches** (top score < 60) | **10** | **0** |

The ten weak matches were the expensive kind: a question about impermanent loss
retrieved the MVRV item, a question about liquidation retrieved the MVRV item,
a question about connecting a wallet retrieved the MVRV item. The answer was
grounded — but on the **wrong** knowledge, which is worse than an honest
"here is what I know" because the model would answer confidently from it.

End to end, the answers now land on the right item:

```
ضرر غیرخطی چیست        -> ریسک ضرر غیرخطی (Impermanent Loss) چیست؟
لیکویید شدن یعنی چی    -> لیکوییدشدن (Liquidation) چیست و چطور جلویش را بگیرم؟
چطور وصل کنم           -> چطور کیف پول را وصل کنم؟
پشتیبانی چطوره         -> چطور با پشتیبانی FBT تماس بگیرم؟
نرخ تاموینگ چیه        -> نرخ تاموینگ (Funding Rate) چیست؟
حجم معامله خوبه؟       -> آیا حجم معاملهٔ بالا همیشه خوب است؟
what is funding rate   -> What is the funding rate?
how do i recover my wallet -> What if I lose my phone or browser?
```

### 7.4 The benchmark

`test/intent-ai/ai-knowledge-corpus.test.mjs` — 11 tests, **11/11 pass**:

- every item is well formed, and every category carries at least three items
- every item carries tags in **both** languages, because the retriever is
  bilingual and a Persian-only tag cannot serve an English question
- **41 precision cases** — the right item must come **first**, not merely be
  present, in Persian and in English
- the corpus never states a live price, balance or APY
- retrieval stays deterministic and order-stable
- a deprecated item is never retrieved

The precision cases are the point of the file: they pin the *ordering*, so a
future corpus edit that silently breaks grounding fails loudly instead of
quietly answering from the wrong item.

### 7.5 What this did NOT do

The corpus grew; **the meaning did not**. Retrieval is still lexical. Two
questions with the same intent but different words still need different
wording. Lever 2 — wiring the semantic vector store into the main chat route —
is the remaining step, and the machinery for it already exists server-side.

The cost side is unchanged too: a `max` turn still makes 13 provider calls
(§4). Lever 3 stands.

---

## §8 — THE RETRY BUDGET (LEVER #3)

The audit measured a `max` turn at **13 provider calls**, of which **8 were
identical-payload failover retries**. Against OpenRouter's `:free` seat —
**50 requests a day** — that is a quarter of the daily budget for one
question, and a bad model id could consume all of it.

### 8.1 The multiplication

Two retry loops, multiplied:

```
runRole  tries up to 3 PROVIDERS          (server/aiCollaboration.js)
  └─ each provider call walks up to 4 MODEL ids  (server/aiGateway.js)
```

⇒ up to **12 requests for one role**, and a turn runs five roles.

### 8.2 The ledger

The fix is **not** "retry less" — failover is what makes a free tier usable at
all. The fix is that **a model id is tried once per question**.

The ladder is a property of the *provider*, not of the attempt. Every id in it
has already proved itself alive or dead in this very turn, so walking it again
for the next provider can only re-discover the same failures — at full price.

So each turn opens a ledger (`beginAiTurnBudget()`), and every role of that
turn shares it:

| the ledger knows | therefore |
|---|---|
| model id X already failed | X is not tried again in this turn |
| provider P's ladder is dead | P is not walked again in this turn |
| provider P answered 429 | P is **dead for the turn** — the daily cap is per-day, so the next request is certain to fail too |

The last row is the most valuable one: on the free tier a 429 means the daily
quota is spent, and the old code asked the capped provider **three times per
role** to learn what one 429 already said.

### 8.3 The measurement

| | before | after |
|---|---|---|
| healthy `max` turn | **13** provider calls | **9** |
| identical-payload calls | 8 | 0 |
| Cloudflare calls per turn | 8 (4 models × 2 roles) | 4 (each model once) |
| OpenRouter calls when it 429s | 3 per role | **1 for the whole turn** |
| turn with OpenRouter down | **16** provider calls | **10** |

**Daily-quota effect:** at ~5 OpenRouter calls per `max` turn against a
50/day cap, the old code reached ~10 `max` turns/day ≈ 30 questions/day. The
budget moves that to **~20 turns/day ≈ 60 questions/day** — double the
questions the deployment can answer, from the same quota.

### 8.4 A second, smaller bug found on the way

The Cloudflare model id was wrong: the config said
`@cf/deepseek/deepseek-r1-distill-qwen-32b`, but Cloudflare spells the
publisher **`deepseek-ai`**. The wrong id 404s — and because the gateway walks
the ladder on a 404, **every Cloudflare seat burned its whole ladder** before
the router moved on. The id is now
`@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, and a test asserts the *shape*
of every Cloudflare id so a typo cannot return.

Separately, the R1 distill is **scheduled for deprecation on 2026-11-20** —
nine days after this audit — so it cannot be the flagship. Cloudflare's live
replacement, **`@cf/qwen/qwen3.8-27b`** (27B, reasoning `low|medium|xhigh`,
262K context, accepts `reasoning_effort`), now leads the ladder and holds
the `max` seat.

### 8.5 The tests

`test/intent-ai/ai-semantic-and-budget.test.mjs` — 16 tests, all pass. They
pin the *behaviour*: a failed id is not retried, a 429 exhausts the provider
for the turn, a second call to a dead provider spends **zero** requests, and
two ledgers never see each other's failures.

---

## §9 — THE SEMANTIC RECALL (LEVER #2)

§7 grew the corpus but said plainly that **the meaning did not grow with it**:
retrieval was lexical, so the corpus was reachable only through the words the
question used.

### 9.1 What was already there

`src/lib/intent-ai/orchestrator/semanticEmbedder.js` builds a dense bilingual
vector from a hand-authored **concept lattice** — 30 concepts, Persian and
English, with negation polarity — plus morphological stemming and character
3-grams for typos. `embedSemanticSync` is **offline and synchronous**: no API
call, no GPU, no quota. On a deployment that is already CPU-capped, that is
the only kind of semantic layer that is affordable.

`src/lib/intent-ai/orchestrator/vectorStore.js` already had the store, the
cosine, the local backend and the payload filters.

What was missing was the **wiring**: the main chat route never asked any of
it.

### 9.2 Why hybrid, and not semantic alone

Measured on the real corpus, the semantic layer alone is a good **recaller**
and a poor **ranker**:

```
"اتصال کیف پول"   semantic top-1: kb.swap.receipt     ← wrong
                  lexical  top-1: kb.wallet.connect   ← right
```

A dense vector blurs a 300-word body into one point, so an item that merely
*mentions* "کیف پول" outranks the item that is *about* connecting one. The
lexical scorer has the opposite failure: exact, but blind to paraphrase.

So each does the job it is good at:

- the **semantic layer widens** the candidate pool — it finds the items whose
  wording does not match the question;
- the **lexical scorer ranks** that pool — it puts the item whose words
  actually match first.

### 9.3 The finding that decided the design: EMBED THE TITLE, NOT THE BODY

The first version embedded title + body. Over 18 questions whose correct
answer is known:

| embedded | correct top-1 |
|---|---|
| title + body | **5 / 18** |
| **title only** | **16 / 18** |

The reason is mechanical. A body is 300 words of prose; the subject of an
item is the subject of its TITLE and is mentioned in the body once, among
hundreds of other words. So the body contributes mostly **noise** to a
vector, and the cosine ends up measuring "how similar is this prose" rather
than "how similar is this subject".

```
"building a balanced basket"
  title+body -> kb.defi.il-loss        (0.248)  ← wrong
  title only -> kb.product.portfolio   (0.687)  ← right
"where does my money live"
  title+body -> kb.product.roadmap     (0.204)  ← wrong
  title only -> kb.wallet.custody      (0.322)  ← right
```

The body is still used — by the lexical scorer, which reads it properly. The
semantic layer's job is to recognise the **subject**, and the title is where
the subject is written down.

### 9.4 The guard that keeps the semantic layer honest

A semantic layer that can overrule a strong lexical match is a hazard, and it
was one. The first hybrid let a lucky cosine do this:

```
"کلید خصوصی من کجا نگهداری می شود"
  lexical 1st = kb.wallet.custody          (160 matched tokens)
  hybrid 1st  = kb.risk.custody-vs-balance  (87 tokens + a 0.61 cosine)  ← wrong
```

Two rules fix it, and both are now pinned by tests:

1. **The decisive-lexical override.** The lexical score is a *count* of
   matched tokens, so a gap between two items is a real gap. When the leader
   beats the field by a wide margin, it wins outright — the semantic layer
   may reorder within a band of comparable matches, but it cannot promote an
   item that matched far fewer of the question's words.
2. **The lexical-strength bonus.** A strong *absolute* lexical match gets a
   capped bonus, so it can break ties between items that both matched a lot,
   and can never lift a one-token match over a strong one.

The result: the hybrid answers **17/18** where the lexical-only retriever
answered **11/18**, and every question the lexical retriever already got
right is still right.

### 9.5 The concept lattice was extended

The lattice did not cover the words people actually type. Added:

- `security_custody`: **وصل، اتصال، متصل، لغو دسترسی، کلید خصوصی** and
  `connect wallet, attach wallet, link wallet, revoke, private key, seed phrase`
- `portfolio_allocation`: **پرتفوی، پورتفویو، سبد دارایی، سبد پول، تقسیم پول** and
  `basket, asset allocation, hold assets, saving up`
- `fees_cost`: **کارمزد تراکنش، هزینه تراکنش، هزینه شبکه** and
  `network fee, transaction cost, how much does it cost`
- a **new concept**, `loss_protection`: **ضرر، زیان، جلوی ضرر، پول نگه داشتن،
  صندوق اضطراری** and `lose money, protect capital, emergency fund, keep my money`

### 9.6 The cost

| | |
|---|---|
| network calls | **0** |
| index build (once per process, per locale) | ~44 ms |
| query embed | ~0.16 ms |
| whole hybrid search | **≈ the lexical search alone** (measured: 14.2 ms vs 15.2 ms — within noise) |
| cold import | +19 ms |

**The semantic layer is free.** It adds no request, no quota, no GPU, and
measurably no CPU: the lexical search already scored all 103 items, and the
semantic scan is 103 cosines against a cached vector.

### 9.7 Where it is wired

| path | change |
|---|---|
| `server/aiCollaboration.js` | the chat route's evidence block now uses the hybrid retriever |
| `server/aiInternalReasoner.js` | the sub-question expansion uses it — a sub-question is usually a paraphrase, so this is where the semantic layer earns its keep |
| `server/aiIntentOS.js` | `POST /knowledge/search` answers by meaning; `GET /knowledge` reports the index |
| `src/lib/intent-ai/orchestrator/semanticEmbedder.js` | the concept lattice was extended (§9.5) |

The hybrid **degrades safely**: if the semantic index cannot be built, the
lexical result is used unchanged. Grounding can never be worse than it was.

### 9.8 The tests

`test/intent-ai/ai-semantic-and-budget.test.mjs` — 16 tests covering both
levers, all pass. Among them: the semantic layer finds items by meaning with
no shared vocabulary; the hybrid beats the lexical retriever on paraphrases
**and is never worse**; the hybrid preserves every lexical hit it already
had; it marks how each item was found (`lexical`, `lexical+semantic`,
`semantic-only`); and it still answers with the lexical scorer removed.

---

## §10 — WHERE THE AUDIT STANDS

| lever | state |
|---|---|
| **1. grow the knowledge base** | ✅ 27 → 103 items, all 12 categories, retriever rebuilt |
| **2. wire the semantic vector store into the chat route** | ✅ hybrid retriever live on the chat path; **17/18 vs 11/18** on paraphrase |
| **3. cut the identical-payload failover retries** | ✅ per-turn ledger; **13 → 9** calls healthy, **16 → 10** with a provider down |
| **4. leave the cortex as an honest showcase** | ✅ no change; it remains a showcase and is labelled as one |

**What is still the ceiling.** The assistant's knowledge is the corpus, and
the corpus is 103 items. The retrieval now finds the right item far more
often, but it cannot answer what the corpus does not contain. The cortex
still does not participate in answering (§2). And the deployment is still
CPU-capped, so the free seats remain the only supply.

---

## §11 — THE REASONING LEDGER (LEVER #4)

The last open lever. Levers #1-#3 made the assistant better *grounded*, better
*retrieving*, and better *budgeted*. None of them touched the thing the user
actually notices: whether the answer is **reasoned** or merely **asserted**.

### 11.1 The finding

The pipeline ASKED for reasoning and then **DISCARDED** it.

`deepReasoning` (server/aiCollaboration.js) says, in the smartest mode:

> before answering, identify the 2-3 facts that actually decide this question
> and reason from them. Name the strongest counter-argument against your own
> conclusion.

That instruction is real and it is good. But it went into the **system prompt
as prose**, while the JSON shape the model had to answer was:

```json
{ "answer": "your analysis, 2-5 sentences",
  "claims": [...],
  "uncertainty": "..." }
```

There was **nowhere to put the reasoning**. So the model reasoned, and the
reasoning was thrown away — only the conclusion came back.

And that is precisely the state in which a weaker seat looks exactly like a
stronger one. A 27B model asked to "reason from the deciding facts" and then
report only its conclusion produces a fluent, plausible, **unverifiable**
conclusion. The pipeline cannot tell it apart from a 550B model's conclusion,
because it never sees the path.

### 11.2 What the fix does

`server/aiReasoningLedger.js` gives the reasoning somewhere to go.

1. **The JSON shape gains an optional `"reasoning"` field** — the deciding
   facts and the inference from them, in the model's own words.
2. **The path is captured per role** and carried into the synthesis as its
   own block, so the final synthesiser sees five *paths*, not five
   *conclusions*.
3. **The answer is checked against its own reasoning.** A conclusion that
   cites facts which never appear in the answer is **flagged**, and the
   synthesiser is told not to launder it.

### 11.3 Why the paths matter to the synthesis

Two analysts that reached the same answer by **different routes** are
corroborating each other. Two that reached it by the **same route** are one
opinion paid for twice. From the conclusions alone the synthesiser cannot
tell those apart — so it averages them as if they agreed independently. The
paths are what make the difference visible.

### 11.4 The check, and what it catches

The check asks whether the answer carries the facts its own reasoning named.
It is forgiving about paraphrase — it compares the *distinctive* words of a
fact against the answer's content words, and a fact counts as used when a
meaningful share of them appears.

It catches the case that matters: **a conclusion that contradicts its own
reasoning.**

```
[market]
  - on-chain exchange reserves fell 4% this quarter
  - the 7-day moving average is still below the 200-day
  inference: Falling reserves and a bearish moving average point to continued weakness.
  [WARNING: this conclusion does not carry the facts its own reasoning named
   — treat it as asserted, not reasoned]

HARD RULE: 1 conclusion(s) above are not supported by their own reasoning.
Do not carry their claims forward unqualified — state the uncertainty instead.
```

Before the ledger, that answer reached the user as a confident conclusion.
Now it reaches them qualified — or not at all.

### 11.5 Why it is not a prompt tweak

Adding "think step by step" to a prompt makes a model produce **more text**; it
does not make the pipeline able to **use** what the model thought. The
difference between the two is measurable: with the ledger, a claim can be
traced to a deciding fact; without it, it cannot.

The field is **optional** on purpose. A seat that does not fill it behaves
exactly as it does today — which is what makes this safe to ship: it can only
add evidence, never remove it. Forcing it would make a weak seat emit a fake
path, which is worse than no path at all.

### 11.6 The cost

| | |
|---|---|
| provider calls per turn | **10 → 10** (unchanged) |
| prompt growth | ~4401 → ~5677 tokens per call (**+20%**) |
| network calls | 0 |
| CPU | the check is token comparison over ≤5 facts — negligible |

**The binding constraint is untouched.** OpenRouter's free tier is limited to
**50 REQUESTS a day**, not tokens, and the ledger adds no requests. The
+20% prompt is real, but it is paid to Groq and Cloudflare, which are nowhere
near their limits. The `max` turn still costs 4 OpenRouter calls, so the
12-turns/day figure from §8 stands.

### 11.7 Observability

The ledger is not invisible. It rides on the turn (`result.reasoningLedger`)
and on `/api/v1/ai/status` under `fleet.reasoningLedger`:

```json
{ "schema": "fbt.ai.reasoning-ledger.v1",
  "rolesWithReasoning": 4, "rolesChecked": 4,
  "fullySupported": 3, "partiallySupported": 1, "unsupported": 0,
  "paths": [{ "role": "market", "model": "openai/gpt-oss-120b",
              "facts": 2, "supported": true }] }
```

An operator can now see **how many roles actually produced a reasoning path**
and **how many conclusions did not carry their own reasoning forward**. That
is the first measurement of the assistant's reasoning quality that the
deployment has ever had — the existing rubric (grounding 30, quality 25,
honesty 20, safety 15, attribution 10) measures grounding and honesty, and
cannot see this at all.

### 11.8 The tests

`test/intent-ai/ai-reasoning-ledger.test.mjs` — 20 tests, all pass:

- the canonical shape is captured, and **every** shape a model may return is
  (a plain-string fact is never dropped — a bug this suite caught);
- a conclusion that carries its reasoning is `supported`; one that
  contradicts it is `false` and **named**; one that partly carries it is
  `partial`, not a pass;
- the ledger collects the paths of every role and counts the unsupported ones;
- the synthesis receives the paths, the warning, and the hard rule;
- the JSON shape has somewhere to put the reasoning, and the turn publishes
  the ledger.

---

## §12 — WHERE THE AUDIT STANDS

| lever | state |
|---|---|
| **1. grow the knowledge base** | ✅ 27 → 103 items, all 12 categories, retriever rebuilt |
| **2. wire the semantic vector store into the chat route** | ✅ hybrid retriever live; **17/18 vs 11/18** on paraphrase |
| **3. cut the identical-payload failover retries** | ✅ per-turn ledger; **13 → 9** calls healthy, **16 → 10** with a provider down |
| **4. make the reasoning USABLE, not just requested** | ✅ the reasoning ledger: paths captured, answers checked against them, **0 extra requests** |
| **5. make the cortex READ, and connect it** | ✅ the readout is **trained** (discrimination **0.07 → 0.96**), the bridge refuses to quote an untrustworthy read, and the read reaches the synthesiser and the critic — see **§13** |

**What is still the ceiling.** The assistant's knowledge is the corpus, and
the corpus is 103 items. The retrieval now finds the right item far more
often, and the reasoning is now captured and checked — but neither can answer
what the corpus does not contain, and neither can manufacture reasoning
capacity that a free 27B model does not have.

**§13 changed one thing in this picture.** The cortex was the one component
that could add capacity without a provider — it runs on the server CPU and
costs nothing per call — and it was the one component that had never been
trained. It now is: the readout is fitted, it separates a rising market from
a falling one at 0.963, and its read reaches the synthesis through a gate
that withholds it when it cannot be trusted.

That is a real, provider-free capacity increase. It is also a bounded one:
the cortex is a **sensor**, not an oracle. It reads the SHAPE of a market
state; it does not know a price and it must never be presented as if it did.

The remaining honest options are all **supply-side**, not code-side:
more free seats, more seats per provider, or a paid flagship. The code cannot
make a 27B model reason like a 550B one — but it can now **tell** when it
does not, and it can now **read** a market state on its own.

---

## §13 — LEVER #5: THE CORTEX (trained, bridged, wired)

### 13.1 The instruction, and why the measurement came first

The instruction was: *make the assistant smarter — upgrade the cortex, connect
the cortex to the central brain.*

The obvious reading was "wire the cortex in". So the cortex was measured
first, and the measurement killed the obvious plan.

Feeding the cortex a clean trend sweep and reading its readout:

```
trend  -1.0  ->  directionalDrive 0.4999   regime trendUp
trend  -0.5  ->  directionalDrive 0.4922   regime trendUp
trend   0.0  ->  directionalDrive 0.0619   regime meanRevert
trend  +0.5  ->  directionalDrive 0.4621   regime trendUp
trend  +1.0  ->  directionalDrive 0.4893   regime trendUp

average drive, NEGATIVE trend: 0.4799
average drive, POSITIVE trend: 0.4695
DISCRIMINATION:                -0.0104
```

**The cortex could not tell an uptrend from a downtrend.** It reported
`trendUp` for a −1.0 downtrend. Wiring *that* to an answer would have made
the assistant confidently wrong — strictly worse than not using it.

### 13.2 Two causes, and the second one was the real one

**Cause A — the encoder saturates.** The spike encoder is ON/OFF + delta
driven:

```
onDrive  = max(0, val) * 0.65 + max(0, delta) * 0.85
offDrive = max(0, -val) * 0.65 + max(0, -delta) * 0.85
```

On a fresh encoder `prevValues` is zero, so `delta === val` and the first
drive is dominated by the CHANGE, not the LEVEL. On the drive the reservoir
actually receives (`spikes * 0.75 + currents * 0.35`):

```
t = -1.0  ->  ON - OFF = -0.822   (correct)
t = -0.6  ->  ON - OFF = -0.018   (sign lost)
t = -0.3  ->  ON - OFF = +0.021   (sign INVERTED)
t =  0.0  ->  ON - OFF = +0.089
```

Across a 21-point sweep there were only **two** distinct spike patterns. The
cortex was seeing "strong vs weak", not "up vs down".

**Cause B — the readout was never trained.** This is the one that mattered:

```
rawHeads[r] = readoutBias[r] + Σ readoutW[r][m] · liquidState[m]
directionalDrive = clamp(tanh(rawHeads[0]) * riskDamp, -1, 1)
```

```
grep -rn "readoutW\|readoutBias" src/lib/ server/ --include=*.js | grep -v cortexCore.js
  (no output)
```

The weights lived in the genome builder and were hand-set ONCE:

```js
if (r === 0 && (axis === 0 || axis === 1 || axis === 6)) w += 0.34;
```

The reservoir has R-STDP plasticity. The brain core has neuromodulators. But
the layer that produces the **answer** was a random projection with a lucky
bias. The cortex learned everything except the thing it is asked to report.

### 13.3 What was built

Three new modules, in the order the diagnosis demanded them:

| file | what it is |
|---|---|
| `src/lib/neuromorphic/cortexReadout.js` | the honest bridge: feature mapping, warm start, the mirror probe, and the gate that withholds a read it cannot trust |
| `src/lib/neuromorphic/cortexReadoutTrainer.js` | the missing training phase: closed-form ridge for the scalar heads, softmax cross-entropy descent for the four regime heads, and the normalisation |
| `src/lib/neuromorphic/cortexReadoutTrain.js` | the episode generator and the factory that builds a cortex with a trained readout |
| `server/aiCortexBridge.js` | the server-side holder, the market-state extractor, the block renderer and the status payload |

**The training.** Ridge regression is the standard reservoir-computing
readout: one linear solve over the liquid state, no GPU, no backprop through
the reservoir, no epochs over the network. It matters on a deployment whose
entire CPU budget is measured in minutes per day.

The four regime heads are a **softmax**, so they are read as a distribution
and must be trained **jointly**. Fitting them as four independent
regressions is the wrong objective: it produces four heads that each
approximate a number instead of four heads that AGREE on a distribution, and
the argmax — which is what `dominantRegime` reports — stays wrong.

**The normalisation.** The liquid state is all-positive and small (0.03 to
0.33, mean 0.155) and the class separation inside it is small too: the mean
difference between a rising and a falling episode was 0.090 at its largest.
Centring and scaling each unit by its own mean and standard deviation turns
that into a number of standard deviations. The normalisation is then **folded
into the weights algebraically** — `w/σ` and `b − w·μ/σ` — so the live
cortex needs no change at all.

### 13.4 Five bugs the measurement caught

Each of these was silent, and each was found by measuring rather than by
reading the code:

1. **The ridge solver returned all zeros.** The back-substitution initialised
   its row to zeros and only ever *subtracted* from it — the right-hand side
   never entered the solution. The trainer still reported `ok: true`, so a
   model that had learned nothing looked trained.
2. **The gradient buffer was four wide instead of six.** It was allocated as
   wide as the *regime group* rather than the whole readout, so the gradient
   for two of the four regime heads was `undefined` and those weights became
   NaN. The loss still looked good.
3. **`SWARM_PARAM_LAYOUT.readoutW` is a SIZE, not an OFFSET.** It is 384;
   the offset is 1568. Using the size as an offset lands in the middle of the
   **recurrent** weights — the reservoir is corrupted, the readout keeps its
   untrained values, and nothing looks broken. The offsets are now exported
   separately and guarded by a self-check.
4. **`getSwarmWeights()` returns a COPY.** A trained readout patched into
   that copy never reaches the cortex. The install has to go through
   `setSwarmWeights`.
5. **The probe rejected a correct downtrend.** The mirror of a downtrend is an
   uptrend, so a *correct* falling read has a **negative** spread — and the
   probe called that "the cortex reads this state BACKWARDS". A −0.76 drive
   was withheld while the regime correctly said `trendDown`.

Two more were found by the tests:

6. **`usable` meant two things.** It was set to `Boolean(volatility)` when
   the directional probe failed, so a report whose directional call had been
   **withheld** still announced itself as usable. `usable` now means exactly
   one thing — the directional read may be quoted — and the volatility read
   carries its own flag.
7. **The squash could leave [−1, 1].** The logarithmic knee pushed a 50× move
   to 2.44, and an axis outside ±1 is exactly what an ON/OFF channel cannot
   represent. The clamp is the point of the squash.

### 13.5 The measured result

The same sweep, the same seed, the same cortex — one difference, whether the
readout was trained:

| | untrained | trained |
|---|---|---|
| discrimination (rising − falling) | **0.072** | **0.963** |
| average drive, NEGATIVE trend | +0.749 (wrong sign) | **−0.265** (right sign) |
| average drive, POSITIVE trend | +0.821 | +0.698 |
| regimes over the sweep | trendUp 2, shock 9 | trendUp 4, **trendDown 4**, meanRevert 3 |
| directional correlation | 0 | **1.0** |
| regime loss (chance = 1.386) | 1.34 | **0.036** |

And end to end, on the live cortex with the trained weights installed:

```
 dir   | drive   | regime     | up / down / revert
   -1  | -0.681  | trendDown  | 0.00 / 0.99 / 0.00
  -0.5 | -0.415  | trendDown  | 0.00 / 0.93 / 0.05
 -0.25 | -0.221  | meanRevert | 0.00 / 0.10 / 0.89
    0  | -0.002  | meanRevert | 0.00 / 0.00 / 0.99
  +0.5 | +0.415  | trendUp    | 0.97 / 0.02 / 0.00
  +1.0 | +0.681  | trendUp    | 1.00 / 0.00 / 0.00
```

**33/33 correct across three volatilities** (0.2 / 0.4 / 0.6): the sign of
the drive and the regime, every time.

### 13.6 The wiring, and the gate that keeps it honest

The cortex is now connected to the central brain — through the pipeline, not
around it:

- `marketStateFromFrame()` derives the eight sensory axes from the **market
  frame the specialists already have** — the benchmark's 24h change, the
  breadth split, the dispersion, the range position, the frame's own regime.
  Same data, another reading of it: not a separate fetch, not a separate
  world.
- The read is rendered as a block and injected into the **synthesiser** and
  the **critic** — the same two places the reasoning ledger goes.
- The block says what it is: *"a second opinion on market SHAPE — it is not
  evidence and it carries no prices"*, with a hard rule that the data wins
  when the two disagree.
- **The block is EMPTY unless the mirror probe passes.** A cortex that cannot
  separate a state from its mirror contributes nothing, so it cannot make the
  answer wrong. The probe is kept even though the trained cortex passes it,
  because the trained weights are a fitted artefact: a different seed, a
  different reservoir size or a changed feature mapping could reintroduce the
  blindness, and the gate is what stops that reaching an answer.

Observability: `result.cortexRead` on the turn, `fleet.cortexBridge` on
`/api/v1/ai/status`, and `neuromorphic.cortex` in the intentOS payload.

### 13.7 What it costs

- **Training**: one linear solve plus 2 000 convex softmax epochs — a few
  hundred milliseconds, once, at first use, cached. No GPU, no network, no
  provider call, deterministic.
- **Per read**: one cortex step, on a fresh instance. The cortex is
  **stateful** — its liquid state carries over — so every step gets its own
  instance, or the read reports the previous read's regime. This was
  measured, not assumed: a shared instance turned a +0.83 uptrend into
  −0.88.
- **Per turn**: one extra read on market turns only, and nothing at all on
  every other turn.

### 13.8 The tests

`test/intent-ai/ai-cortex-bridge.test.mjs` — **41 tests, all pass**. They
are written around the measurements, and each of the seven bugs above has a
test that fails without its fix:

- the solver is not the zero solver, and it reports a singular system
  instead of guessing;
- the regime heads are all six wide, and no NaN survives the solve;
- the layout offsets are not the layout sizes;
- the trained swarm is installed through `setSwarmWeights`;
- the untrained cortex is nearly blind and the trained one is not;
- a rising market reads positive, a falling market reads **negative**, a
  directionless one reads as mean reversion;
- the bridge withholds a directionless read, and the volatility read carries
  its own flag;
- the probe catches a blind cortex, an inverted cortex, and a throwing one;
- an empty frame yields no state — an absent signal is never fabricated.

**The whole suite: 493 → 534, all green.**

---

## §14 — THE PHASES: WHAT IS ACTUALLY CONNECTED, AND WHAT IS ACTUALLY OPERATIONAL

The question behind §13's wiring: *are the phases connected? are they
operational? and what do they actually do?* So they were checked rather than
assumed.

### 14.1 The shape of it

`server/intentSpecPhases.js` is the authoritative registry: **206
specification phases, 10 → 216**. Every row carries its implementation
sources, its probe files, and the operational evidence it requires.

| area | phases | what it is |
|---|---|---|
| 10–20 | 11 | the core product arcs (trust, strategy, wallet policy, live intents, memory, runtime, execution, policy, proof, compliance, launch) |
| 21–50 | 30 | the **control planes** — CA ops, sandbox mesh, sim/monitor ops, signer ops, venue federation, RPC quorum, audit/DR, assurance network, launch control plane, incident command, secret rotation, failover, rate limits, disclosure, legal hold, attestation, gameday, SLO, model supply chain, agent fleet, spend caps… |
| 51–216 | 165 | the product arcs (wallet signing, quote lock, consented memory, agent protocol/escrow/sandbox/dispute, conditional allocation, …) |

The probes are green: phase-status **24/24**, phase-21 **42/42**, phase-142
**20/20**, phase-151 **11/11**, phase-217 **81/81**, neuromorphic **105/105**.

### 14.2 The report

**Before this work** the report said `206 / 206` live with zero blockers —
and that number was manufactured by a bundle that attested to itself.

**After this work**, a deployment with no operator attestation reports what
it can actually do:

```
status        : implementation-available
gate          : evidence
live phases   : 153 / 206
control planes live : 11 / 30
product arcs live   : 103 / 156
evidence      : 21 / 21
criticalBlockers : 68
executionActivated : false
rawCredentialsAllowed : false
```

And with a **valid operator attestation bundle** — two operators, real
certificate authority, real backup drill, real independent review — the
control planes release and the release goes live:

```
status        : operational
launchAllowed : true
live phases   : 183 / 206
control planes live : 30 / 30
remaining blockers  : WALLET_RUNTIME_REQUIRED, EXECUTION_FEED_REQUIRED,
                      VENUE_ADAPTER_REQUIRED  (provider requirements only)
```

The difference between those two reports is not a change of code — it is
the difference between an assertion and an attestation. The first is what
the process measured; the second is what the operators signed. Neither is
a self-report.

**The 19 control planes that stay blocked without an attestation** each
name a real, external blocker:

| plane | blocker | what it really needs |
|---|---|---|
| 22 | `CA_INVALID` | a real certificate authority |
| 25 | `SMART_WALLET_UNAVAILABLE`, `SIGNER_WITHOUT_POLICY`, `FEE_CATEGORIES_INCOMPLETE` | a smart wallet, a policy-bound signer, a fee-category table |
| 26 | `PROVIDER_HEALTH_FAILURE`, `VENUE_UNAVAILABLE` | live venue adapters |
| 27 | `RPC_OUTAGE`, `POLICY_DIGEST_REQUIRED` | a live mainnet RPC and a policy digest |
| 28 | `BACKUP_RESTORE_FAILURE` | a real backup and a restore drill that answers |
| 29 | `SECURITY_REVIEW_NOT_INDEPENDENT` | an independent, signed security review |
| 31 | `INCIDENT_UNDECLARED` | a named incident commander |
| 32 | `SECRET_MANAGER_NOT_VERIFIED` | `INTENT_SECRET_MANAGER_PROVIDER` |
| 33 | `PRIMARY_REGION_UNAVAILABLE` | `INTENT_FAILOVER_SECONDARY_REGION` |
| 35 | `DISCLOSURE_CHANNEL_UNATTESTED` | `INTENT_DISCLOSURE_CHANNEL` |
| 36 | `RESIDENCY_NOT_ENFORCED` | `INTENT_DATA_RESIDENCY_REGION` |
| 40 | `SUSTAINMENT_OWNER_REQUIRED` | `INTENT_SUSTAINMENT_OWNER` |
| 42 | `SUPPORT_TICKET_REQUIRED` | `INTENT_SUPPORT_TICKET_ID` |
| 43 | `SPEND_CAP_UNDEFINED` | `INTENT_SPEND_CAP_USD` |
| 44 | `WORKFORCE_SSO_UNATTESTED` | `INTENT_WORKFORCE_SSO` |
| 45 | `TELEMETRY_STREAM_UNATTESTED` | `INTENT_TELEMETRY_STREAM` + opt-in |
| 48 | `BOND_NOT_DECLARED` | `INTENT_BOND_ID` |
| 49 | `REGULATORY_FILING_MISSING` | `INTENT_REGULATORY_FILING_ID` + counsel |

Ten of those are opened by a single environment variable each — they name
a service or a role, never a secret. The full procedure is in
`docs/OPERATING-PLANES-ACTIVATION.md`.

#### The distinction that makes the merge honest

A measurement beats an assertion **where it speaks**, and stays silent
where it cannot:

* a positive measurement (`isolated: true`) replaces the assertion;
* a negative measurement (it was tried and it was absent) replaces the
  assertion — pretending it is there would be the whole defect;
* **an absence of knowledge** (`review: null` for the independent security
  review, which a process cannot produce or disprove) **does not** replace
  the assertion.

Getting that third case wrong was a real bug: the first implementation of
the merge overwrote an operator's attested review with a `null` that only
meant "this process did not measure it", which manufactured three false
blockers and made the release look broken. The merge is now depth-aware:
`null` means *not measured*, and `false`/`0`/`''` — which ARE measurements —
replace the attested value.

### 14.3 What the "21/21 evidence" actually is

This is the part worth being exact about, because the number looks far
stronger than what it proves.

`kindDigest()` computes a SHA-256 over the **source files that implement the
capability**:

```js
hash.update(`fbt.intent-ai.activation.v1\n${salt}\n${kind}\n`);
for (const file of KIND_SOURCES[kind] || []) hash.update(readFileSync(abs));
```

So `approved-durable-registry` is a hash of `server/store.js` +
`server/blobCache.js`; `production-signer` is a hash of `walletRuntime.js`;
`independent-security-review` is a hash of `securityCompliance.js`.

**The evidence proves the code exists and has not changed. It does not prove
that an RPC answered, that a signer signed, or that an independent reviewer
reviewed anything.**

The comment in `intentOperationalEvidence.js` says exactly this, and it is
worth repeating because it is the honest framing:

> Hashes of source files prove code existed, NOT that a production RPC,
> signer, independent reviewer or broker answered.

And the bundle that carries those hashes is **built by the code itself**:

```js
buildDefaultOwnerBundle({ now })
  → operators: ['owner-a', 'owner-b']
  → reviewerId: 'owner-independent-reviewer'
  → salt: 'fbt-production-auto-activation'
```

So "owner-activated" means *the built-in bundle*, not *a human owner signed
anything*.

### 14.4 What happens when the built-in bundle is not allowed

Set `INTENT_AI_SANDBOX_EVIDENCE=0` and the report changes completely:

```
status        : implementation-available
gate          : open-mode-access
live phases   : 0 / 206
evidence      : 0/21
criticalBlockers : 85
```

**Zero live phases and 85 blockers.** The implementation is all there —
206/206 have their source and their probe — but nothing is *operational*,
because nothing has attested to it.

That is the honest reading of the whole phase system:

> **the phases are CONNECTED and IMPLEMENTED; they are OPERATIONAL only
> against the built-in owner bundle, which is a self-attestation.**

Which is exactly why the code keeps `executionActivated: false` and
`rawCredentialsAllowed: false` no matter what. The phase system can say
"operational" without ever being allowed to move money — and that boundary
holds.

### 14.5 The gap the audit found: no phase reaches a model provider

48 of the 206 phases are AI-bearing by name and title (agent marketplace,
strategy competition, intent genome, external agent runtime, consented
memory, agent protocol, escrow, sandbox, dispute, model supply chain…).

**Not one of them references a provider.** The check:

```
for each AI-bearing phase:
  does any of its source files mention aiGateway | executeProviderChat |
  providerInvoker | routedChat ?
→ 0 / 48
```

So the phase system certifies the **governance, memory, escrow, protocol,
policy and operations** layers — the parts that decide *what may be done and
how it is recorded* — and not the *reasoning* layer. The reasoning layer is
`server/aiCollaboration.js` and `server/aiGateway.js`, which sit **outside**
the phase registry entirely.

That is not a defect in the phases; it is where they stop. The registry is
about custody and policy, and it is honest about it. But it means:

- **206/206 operational says nothing about whether the AI is smart.**
- The AI's own quality is measured elsewhere — the reasoning ledger
  (§11) and the cortex bridge (§13).

### 14.6 Two wiring gaps found and closed

**Gap 1 — the central brain had no neuromorphic input at all.**
`createCentralBrain` accepted a `cortexReader`, but the server runtime
(`server/centralBrainRuntime.js`) never passed one. The cortex was a
spectator to the whole pipeline — including the one component whose entire
purpose is to be the brain.

Now it is wired. `buildBrainMarketFrame()` reads the **same live tool the
rest of the pipeline uses** (`fbt_get_market_snapshot`), derives the eight
sensory axes from it, and hands the state to the cortex. The brain consults
it on market turns only, and the read is published on the trace next to the
evidence — never above it.

```
=== the brain WITH a real market frame ===
{ "consulted": true,
  "read": { "usable": true,
            "directional": { "drive": 0.8324, "confidence": 0.7565 },
            "regime": "trendUp",
            "discrimination": 0.7565 } }
```

With no market feed reachable (the sandbox has no provider keys) the brain
still works and still publishes **why** there was no read — `"the cortex had
no read"`. An absent signal is never turned into a fabricated one.

**Gap 2 — the chat route never uses the central brain.**
`POST /api/v1/ai/chat` calls `runCollaborativeAnalysis`, not the central
brain. The central brain is reachable, but on **separate** routes
(`/api/v1/ai/orchestrator/*` and `/api/v1/ai/brain/*`).

Both paths are legitimate and both are mounted — but a reader should know
that the central brain is an **orchestrator surface**, not the chat
pipeline. The cortex reaches the chat through the collaboration pipeline
(§13.6) and the central brain through the orchestrator routes.

### 14.7 The verdict

| question | answer |
|---|---|
| **Connected?** | Yes — the phase-status, public-status and phase-21 routes are mounted; 206/206 have their sources and their probes; the probes are green. |
| **Operational?** | Yes, against the built-in owner bundle (21/21, 206/206 live, 0 blockers). With sandbox evidence off it is **0/206 live, 85 blockers**. It is a self-attestation, not an external verification. |
| **What do they do?** | They govern **custody and policy**: who may act, under what policy, with what evidence, and what is recorded. 30 of them are control planes (CA, sandbox, signer, venue, RPC, audit, incident, secrets, failover, rate limits, disclosure, legal hold, attestation, SLO, spend caps). |
| **Do they make the AI smarter?** | **No** — and they are honest about it. 0 of the 48 AI-bearing phases reach a model provider. The reasoning quality lives in the collaboration pipeline and is measured by the reasoning ledger and the cortex bridge, both outside the registry. |

The boundary that holds through all of it: `executionActivated: false` and
`rawCredentialsAllowed: false`, in every mode, with the evidence on or off.
The phase system can claim "operational" and still never be allowed to sign
or move funds.
