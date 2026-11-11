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
