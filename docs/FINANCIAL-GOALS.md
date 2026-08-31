# Financial OS — Financial Goals

The **Profit plan** tab of Intent OS is now the Financial OS: the user states a
goal, the server does the arithmetic, and an approved plan is handed to the
**existing** Intent OS. No new execution engine was created.

```
Goal → Analysis → Strategy → Allocation → Intent → Approval → Execution → Monitoring
       └──────────────────── server (backend) ──────────────────────────┘   └ existing Intent OS ┘
```

Persian version: [`FINANCIAL-GOALS-FA.md`](./FINANCIAL-GOALS-FA.md)

---

## 1. What was added

| Layer | File | Role |
| --- | --- | --- |
| Calculation engine (pure) | `src/lib/financialGoalEngine.js` | required return, allocation, risk score, scenarios, monitoring, intent payload |
| Storage + route logic | `server/financialGoals.js` | three collections, ownership, event timeline, market snapshot |
| Routes | `server/app.js` | the seven specified endpoints |
| Browser client | `src/lib/financialGoals.js` | API calls, device scope, no secrets anywhere |
| Intent hand-off | `src/lib/financialGoalIntent.js` | intent payload → an ordinary Intent OS draft |
| UI | `src/components/FinancialGoals.jsx` | three screens: My Goals / Build My Plan / Review Plan |
| Styles | `src/styles/intent-os.css` (`fg-*`) | the same visual language as Intent OS |
| Tests | `test/financial-goals-probe.mjs` | 104 checks: engine, storage, HTTP, safety |

---

## 2. API — only these seven routes

```text
POST /api/v1/financial-goals             create a goal
GET  /api/v1/financial-goals             list goals
GET  /api/v1/financial-goals/:id         goal + latest plan
POST /api/v1/financial-goals/:id/build-plan
POST /api/v1/financial-goals/:id/approve
POST /api/v1/financial-goals/:id/pause
GET  /api/v1/financial-goals/:id/progress
```

Every response carries `meta.durable`, `meta.dataStatus` and
`meta.limitations`, so the UI can say whether the data is really persisted.

`build-plan` returns (abridged):

```json
{
  "data": {
    "plan": {
      "requiredReturnPct": 25.99,
      "riskScore": 38,
      "allocation": [
        { "asset": "BTC", "percentage": 24 },
        { "asset": "ETH", "percentage": 14 },
        { "asset": "STABLE", "percentage": 32 },
        { "asset": "OTHER", "percentage": 30 }
      ],
      "scenarios": [
        { "id": "bear", "ratePct": 0,     "projectedUsd": 10000 },
        { "id": "base", "ratePct": 1.1,   "projectedUsd": 10333 },
        { "id": "bull", "ratePct": 25.99, "projectedUsd": 20000 }
      ],
      "guarantees": { "returnsGuaranteed": false, "priceForecastIncluded": false }
    }
  }
}
```

`approve` returns the intent payload and **nothing else happens**:

```json
{
  "data": {
    "intent": {
      "schema": "fbt.financial-goal-intent.v1",
      "source": "FINANCIAL_GOAL",
      "goalId": "goal_123",
      "actions": [
        { "type": "ALLOCATE", "asset": "BTC", "percentage": 30, "amount": 3000 },
        { "type": "ALLOCATE", "asset": "ETH", "percentage": 20, "amount": 2000 }
      ],
      "requiresUserApproval": true,
      "autonomousExecution": false,
      "secretsIncluded": false
    }
  },
  "meta": { "executed": false, "nextStep": "REVIEW_AND_SIGN_IN_INTENT_OS" }
}
```

---

## 3. Storage

This API has no SQL database — it is a stateless cache in front of public
market data — so the three specified tables are three key namespaces in the
shared key-value store (`server/store.js`), named after the tables:

```text
financial_goals:<owner>         one row per goal
financial_goal_plans:<owner>    the latest plan per goal
financial_goal_events:<owner>   append-only timeline
```

Goal columns are exactly the specified ones:

```text
id · userId(owner) · startingCapital · targetAmount · currency
targetDate · riskProfile · monthlyContribution · status · createdAt · updatedAt
```

**Durability is reported, never implied.** Without `BLOB_READ_WRITE_TOKEN` the
store is per-instance and disappears on a cold start, and every response says
so through `durable` / `dataStatus`.

**Ownership:** the verified Telegram session (`req.tgUser.id`) when present,
otherwise the `x-fbt-device` header — a random per-install id the server hashes
before it becomes a storage key. It is **scope, not authentication**: it keeps
one person's goals separate from another's, and the UI says "saved for this
device" rather than implying a cloud account.

---

## 4. The calculation engine

```js
requiredCagr(starting, target, years)  =  (target / starting) ** (1 / years) − 1
```

* With a monthly contribution the required rate is solved by bisection over
  the same future-value curve (`requiredReturnWithContributions`); when the
  contributions alone are enough the answer is `0%`, not a scarier number.
* `validateAllocation` is the specified function, called in three places —
  when the allocation is produced, before a plan is stored, and before an
  intent is built. Anything but 100% throws and is never persisted.
* **Risk score (0–100)** is derived from the risk profile, the required
  return, the horizon, how much the contributions already cover, and the gap
  between the required return and the live yield. Every point is attributed in
  `riskFactors`, so the screen can explain the number instead of dropping one
  from the sky.
* **The three scenarios are assumption bands, not forecasts:**
  * Bear — no growth at all (principal + contributions)
  * Base — the live, haircut venue yield continues
  * Bull — the goal's own required return happens
* **No price forecast.** BTC / ETH / OTHER sleeves are exposure, not income;
  only the stable sleeve is credited with income, and only from a live feed
  using the same haircuts `multiVenuePlanner.js` already applies. A dead feed
  yields `null`, never a guess.

---

## 5. Hand-off to the existing Intent OS

```
Financial Goal → Financial Plan → Existing Intent OS → Existing Risk Engine → Existing Execution
```

`src/lib/financialGoalIntent.js` turns the payload into an ordinary draft using
the **existing** functions — `compileIntent` → `saveCompiledIntent` →
`ensureLifecycle` — and sends the user to the compose tab, which already owns
review, signing and execution.

* `ALLOCATE BTC` / `ALLOCATE ETH` → `swap` steps in a same-chain workflow
  (or a single swap intent when only one leg is tradable).
* `ALLOCATE STABLE` → not a trade; it is already the quote asset, and the UI
  says so.
* `ALLOCATE OTHER` → never turned into an invented ticker; reported instead.
* If no tradable leg remains, no draft is created and the reason is shown.

There is no server signer, no scheduler and no broadcast path. The tests assert
exactly that (`autonomousExecution === false`, `nextStep: REVIEW_AND_SIGN_…`).

---

## 6. Monitoring

`GET /:id/progress` computes the six specified facts:

```text
Current Value · Target Value · Progress % · Expected Path · Actual Path · Status
```

Statuses: `ON_TRACK · AHEAD · BEHIND · AT_RISK · COMPLETED · PAUSED`

* The expected path is the goal's compounding path (geometric, not a straight
  line — a straight line would overstate how far along an early goal is).
* A reported value is written as a `VALUE_SNAPSHOT` event; repeating the same
  value does not duplicate the row.
* Until a value is reported the response carries `valueReported: false` and the
  UI shows "no value reported" instead of ranking the user as behind.

---

## 7. AI and security

* Natural-language goal parsing is deterministic and runs **on the device**
  (`parseGoalFromText`): what the user types is never sent to a model.
* No private key, seed phrase, password or API secret is read or sent by any
  layer of this feature (`secretsIncluded: false` in the payload).
* AI cannot execute a transaction because there is no execution path — the
  only route to a signature is the existing Intent OS with the user's wallet.
* The seams for AI narrative (strategy / scenario / recommendation) are
  documented but deliberately left deterministic for now, so no screen shows a
  number a model invented.

---

## 8. Running it

```bash
npm run dev                       # web (5173) + API (8787)
npm run test:financial-goals      # 104 checks
npm test                          # the whole suite, including this
```

---

## 9. Deliberately not done yet

* DCA and automatic rebalancing on top of a saved plan
* Model-written strategy / scenario explanations (same boundary: no secret
  ever reaches the model)
* Automatic current-value reporting from the connected wallet (today the value
  is either typed or passed as `currentValueUsd`)
* A real SQL database if the product needs one — the namespaces above stay the
  same either way
