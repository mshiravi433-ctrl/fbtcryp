# External Agent Hub — architecture and honest status

**What this is:** a reviewed, server-controlled hub of real third-party AI agents
inside FBTSwap AI's Agents area. FBT is the trusted interface and task broker; the
provider hosts the intelligence.

**What this is not:** a marketplace, a commission scheme, a subscription reseller,
a credit ledger, a custodial payment rail, or a new FBT agent runtime. There is no
FBT cut in this feature and no code here that can move money.

---

## Status (2026-10-22)

| Area | State |
|---|---|
| Registry with review gates | ✅ implemented |
| A2A adapter (card, `message/send`, `tasks/get`, `tasks/cancel`) | ✅ implemented |
| Task broker (consent, idempotency, reconciliation, history) | ✅ implemented |
| Connection manager (per-user OAuth, sealed credentials, revoke) | ✅ implemented, **no provider configured** |
| Webhook verification (HMAC + timestamp + single-use) | ✅ implemented, requires Upstash |
| Operator kill switches (global + per provider, durable) | ✅ implemented |
| **First-party (native) agents** — analysis, DeFi, security | ✅ implemented, **ON by default** (`AGENT_HUB_NATIVE_AGENTS`) |
| **User key** for a user-supplied agent | ✅ implemented (AES-256-GCM, owner-scoped, revocable) |
| Recommended / Discover / Connected / Activity UI in `/intent` → Agents | ✅ implemented |
| Editorial recommendations with official product/pricing links | ✅ 38 cards in 12 categories; informational only, never executable or FBT-reviewed |
| Direct on-chain payment (x402-style relay) | ⛔ **not implemented** — Phase 3 deferred |
| User-supplied agent cards (bring your own agent) | ✅ implemented |
| Any approved live provider | ⛔ **none** — see the decision matrix |

**The feature is ON by default** (`AGENT_HUB_ENABLED` unset/`true`). That does
not put a provider in front of anybody: the *reviewed* catalogue is still empty
until an operator writes a decision record — no provider could be verified from
the build environment, and the operator jurisdiction for a jurisdiction-sensitive
approval has never been supplied.

The external-agent view opens on a small editorial directory of well-known
services, with links to each vendor's official product and pricing pages. These
recommendations are informational only: they are not FBT-reviewed, do not appear
in the execution catalogue, and are never run or connected by this page. The
separate **Discover / Add** subtab explains the A2A flow and lets a user paste a
compatible public agent-card URL (see *User-supplied agents* below).
`AGENT_HUB_ENABLED=false` disables provider discovery and execution; the
informational recommendation directory remains separate from provider records
and execution authority.

---

## Layers

```
src/components/AgentHub/AgentHubPanel.jsx     Recommended · Discover · Connected · Activity
src/components/AgentHub/RecommendedAgents.jsx editorial cards; never executable
src/lib/intent-ai/agentHub/recommendations.js curated entries and official source links
src/lib/intent-ai/agentHub/client.js          browser transport (device identity)
src/lib/intent-ai/agentHub/consent.js         ONE consent composer (shared)
src/lib/intent-ai/agentHub/render.js          safe result rendering
                       │
                       ▼
server/agentHub/router.js                     /api/ai/agent-hub/*
server/agentHub/tasks.js                      task broker
server/agentHub/consent.js                    consent + hash
server/agentHub/connections.js                per-user OAuth, sealed credentials
server/agentHub/store.js                      task/event/connection rows
server/agentHub/idempotency.js                SET-NX claims, no double create
server/agentHub/providers.js                  reviewed registry (server config)
server/agentHub/adapters/a2a.js               protocol translation
server/agentHub/httpSafe.js                   allowlisted, bounded egress
server/agentHub/webhooks.js                   signature + replay protection
server/agentHub/protocol.js                   state machine, sanitizers, redaction
```

The consent composer lives in `src/lib` and is imported by **both** the browser
and the server, so the preview a user approves is byte-for-byte the payload the
provider receives. There is no second implementation to drift.

## Where it lives in the app

`/intent` → bottom tab **Agents** (`tag-tab-agents`). That tab now has a two-way
switch at the top:

- **My automations** — this account's existing automations and monitors, unchanged.
- **External agents** — the hub: Recommended · Discover / Add · Connected · Activity.
  Recommended opens first and lists official links for everyday, research, coding,
  and workflow tools. It is an editorial directory, not a reviewed or executable
  provider listing.

The default follows the server: the external view opens first **only** when the
hub is enabled *and* at least one reviewed agent is live (`defaultAgentsView`);
otherwise the user's own automations stay in front. A manual choice is sticky for
the session.

Deep link: `/intent?tab=agents&view=external` (or `view=mine`), handled by the
same `?tab=` resolver as every other in-app destination.

A real count of live agents is shown next to the switch when it is non-zero.

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/api/ai/agent-hub/catalog` | reviewed listings + the owner's own sources, with live status |
| GET | `/api/ai/agent-hub/sources` | the agent cards this device added | 
| POST | `/api/ai/agent-hub/sources` | verify + store one card URL (max 8 per owner) |
| DELETE | `/api/ai/agent-hub/sources/:id` | remove one of your own sources **and its key** |
| POST | `/api/ai/agent-hub/sources/:id/credential` | store the user's own key for the user's own agent (sealed) |
| DELETE | `/api/ai/agent-hub/sources/:id/credential` | delete the sealed key before the metadata |
| GET | `/api/ai/agent-hub/agents/:agentId` | detail incl. provider terms/privacy |
| GET | `/api/ai/agent-hub/connections` | OAuth connections **and** stored agent keys (never the secret) |
| POST | `/api/ai/agent-hub/providers/:id/connections/start` | OAuth + PKCE, owner-bound state |
| GET/POST | `/api/ai/agent-hub/providers/:id/connections/callback` | single-use code |
| DELETE | `/api/ai/agent-hub/connections/:id` | revoke + delete sealed secret |
| POST | `/api/ai/agent-hub/agents/:agentId/tasks` | requires `idempotency-key` |
| GET | `/api/ai/agent-hub/tasks` | owner-scoped history |
| GET | `/api/ai/agent-hub/tasks/:id` | syncs from provider, bounded interval |
| POST | `/api/ai/agent-hub/tasks/:id/cancel` | provider's answer is the truth |
| POST | `/api/ai/agent-hub/providers/:id/webhook` | signed providers only |
| GET | `/api/ai/agent-hub/provider-health` | ops token required |
| POST | `/api/ai/agent-hub/provider-health/kill` | ops token required |

Route names were chosen against the existing surface: `/api/ai/agents` belongs to
the command-center roster and `/api/ai/external-agents` to the FI trust registry.
Both are asserted still alive by `test/agent-hub/hub-api-probe.mjs`.

## First-party agents (`fbt-native`)

The reviewed registry stays empty until an operator signs a decision record, and
an OAuth connection needs a reviewed provider to exist. That gate is correct — and
it used to leave the Agents tab with nothing that could actually run. Native
agents close the gap **without weakening the gate**:

- they are FBT's *own* agents (`server/agentHub/native/`), executed in-process
  against public data the app already serves (CoinGecko, DefiLlama yields,
  DefiLlama protocols/hacks, GoPlus, LI.FI, the explorer and smart-money reads);
- there is nothing to review because there is no third party, nothing to
  authorise because there is no external account, and nothing to bill;
- they are labelled `FBT native` (`approvalStatus: FBT_FIRST_PARTY`,
  `integrationType: NATIVE`, `accessModel: FREE_PUBLIC`) and are rendered from
  the server's catalogue only — a disabled agent disappears from the UI;
- every agent names its **data sources** on the card, and every result says which
  source answered, which was unavailable, and when it was read;
- they cannot execute: no order, no swap, no signature, no transfer. The
  swap-assistant reads a LI.FI *quote*; it never builds a transaction request;
- kill switches, consent, idempotency, history and rendering are the same code
  paths as any external provider — this adds a source of agents, not a second
  runtime.

Eleven agents ship in three groups:

| Group | Agents |
|---|---|
| Analysis & trading | AI Trading Analyst · Smart Money Tracker · Token Research Agent · Strategy Backtesting Agent |
| DeFi | Yield Optimizer · Liquidity Pool Analyzer · Lending Risk Agent · Cross-chain Swap Assistant |
| Security & research | Token Risk Scanner · Wallet Exposure Auditor · Protocol Security Brief |

`AGENT_HUB_NATIVE_AGENTS=false` removes all of them; the hub then reports an
honest empty catalogue again (this is what the API probe asserts for a deploy
with no providers).

## User-supplied agents (bring your own agent)

The reviewed registry is the right gate for a *listing* — FBT vouches for what
it shows. It is the wrong gate for "I already use this agent and I want it in
the app", because it needs a written decision record for every provider on
earth. `server/agentHub/userAgents.js` is the second, narrower path:

- the user pastes an A2A **agent-card URL**; FBT fetches that card once and lists
  the skills the card actually declares — no bundled or editorial suggestion is
  ever inserted into the executable source list;
- the address must be `https`, on port 443, on a public domain (no IP literal, no
  private/internal name, no credentials, no query string) — the same
  `httpSafe.js` rules a reviewed provider gets, because "nobody reviewed this
  destination" is exactly when they matter;
- the RPC endpoint comes from the card's own `url` field and must be on the same
  host; a card that declares none falls back to the origin only when it was
  served from a conventional discovery path;
- a source is stored **only after a successful verification**, is owner-scoped
  (another device cannot see, run or delete it), capped at 8 per owner and rate
  limited (12 attempts / 10 min, because a failing card still costs a fetch);
- every listing carries `source: "user"`, and the UI labels it *Added by you* —
  a self-added agent can never be displayed as FBT-reviewed, or the reverse;
- the same adapter, broker, consent and kill-switch code paths apply. The global
  kill switch stops user sources too;
- **if the agent needs a key**, the user can store their own for their own agent
  (`POST /sources/:id/credential`). It is sealed with AES-256-GCM under
  `AGENT_HUB_SECRET_KEY`, stored under an owner-scoped key, never returned in a
  response and never logged; the header name and scheme come from an allowlist
  (`authorization`, `x-api-key`, `api-key`, `x-auth-token`) so a request body can
  never choose an arbitrary header. The key is unsealed only while a task for
  that same source and owner is being created or synced, and is deleted first
  when the key or the source is removed. Without `AGENT_HUB_SECRET_KEY` the
  server refuses to store one (`AGENT_HUB_SECRET_KEY_REQUIRED`) rather than
  keeping it in plaintext.

## Invariants the code enforces

- **Server-side resolution.** No provider URL, remote agent id, price, recipient
  or scope ever comes from a request body.
- **One remote create per logical request.** Claim (atomic when Redis is
  configured) is taken *before* the provider call. A timeout or a lost response
  becomes `reconciling`; FBT does not send a second create. A different key is a
  user decision.
- **Unknown is not success.** Unrecognised provider states map to `reconciling`.
  `completed` only ever comes from the provider.
- **Consent is a list, not a transcript.** The user ticks categories; the server
  builds the message; the row stores categories + hash, never the values.
- **Provider text is data.** No HTML rendering, https-only links, capped sizes,
  injection-shaped text flagged next to the result.
- **Payment is a gate, not an ability.** `DIRECT_CRYPTO_PAYMENT` answers
  `PAYMENT_REQUIRED` and stops. There is no relayer, no custody, no marking a task
  paid.
- **No execution authority.** Nothing in this feature feeds an order, a swap, a
  signature or a policy limit.

## Tests

```bash
npm run test:agent-hub
```

- `test/agent-hub/a2a-adapter.test.mjs` — adapter contract + SSRF/redirect rules,
  including a user key forwarded as allowlisted headers (24 tests, local A2A
  conformance server)
- `test/agent-hub/hub-security.test.mjs` — consent, registry refusals, webhook
  signatures/replay, idempotency semantics, redaction (36 tests)
- `test/agent-hub/user-sources.test.mjs` — card-URL validation (scheme, IP,
  private name, credentials, query, port), RPC-host pinning, verify-before-store,
  idempotency, cap, rate limit, owner-scoped delete (21 tests)
- `test/agent-hub/hub-api-probe.mjs` — the real `server/app.js` over HTTP:
  owner isolation, IP-only refusal, payment/account gates, double-click,
  lost response, kill switches, first-party agents end to end, user sources and
  their sealed keys end to end, routing hygiene (127 assertions)
- `test/agent-hub/agent-hub-ui.test.jsx` — source-linked recommendation list
  (38 cards, crypto categories), native-agent cards and their run path,
  category/search filters, disabled-catalogue behavior, Persian labels, the
  add-source form, the user-key form, consent preview, sanitized rendering,
  injection warning (28 tests)

`test/agent-hub/conformance-server.mjs` is the only fake agent in the repository.
It binds to `127.0.0.1`, is never imported by production code, and refuses to
represent a real provider.

## Enabling a provider

1. Complete `docs/agent-hub/provider-decision-matrix.md` for that provider.
2. Add the record to `AGENT_HUB_PROVIDERS_JSON` (shape in the matrix doc).
3. Set the webhook/OAuth secrets **by the env names the record declares**, and
   `AGENT_HUB_OPS_TOKEN` (the hub itself is on by default; `AGENT_HUB_ENABLED=false`
   turns it off).
4. `GET /api/ai/agent-hub/provider-health` — every provider must read `LIVE` and
   `registryErrors` must be empty.
5. Run `npm run test:agent-hub`.

## Deferred by decision

- **x402 / direct provider payment.** No approved provider with a testable flow;
  implementing a payment relay against an imagined provider would be the exact
  failure mode this project forbids. `paidInvocationEnabled` is reported as
  `false` everywhere instead of a button that would fail at the last step.
- **Streaming, push completion, multi-turn `input-required` continuation.** The
  adapter declares them unsupported so the UI cannot promise them.
- **Contextual agent suggestions from the chat brain.** A separate editorial
  directory with official product/pricing links now exists. Recommending a
  third-party agent from a specific chat turn still needs its own consent design
  and remains deferred.
- **MCP tools.** MCP servers expose tools, not agents (§5). They belong to a
  future Tools experience, not this page.

## Residual risks

- **DNS rebinding on user-supplied card hosts.** The address rules reject IP
  literals and private names, but a public name that resolves to a private
  address at request time cannot be seen by a hostname check. Same residual risk
  the reviewed registry carries; it now also applies to user sources, which are
  more numerous by nature. Closing it needs resolver-level pinning, which this
  runtime does not expose.

- **No atomic cross-instance lock without Upstash.** The idempotency claim is
  atomic on Redis. With only Blob/memory, two simultaneous cold-start requests
  could both claim; account-required and paid tasks therefore refuse without a
  durable backend (`DURABLE_STORE_REQUIRED`), and free tasks carry `durable:false`.
- **DNS rebinding.** Hostname allowlisting cannot see a rebound DNS answer;
  closing that needs resolver pinning this runtime does not expose.
- **Provider-side retention.** FBT can show what a provider *says* about prompt
  training and retention (recorded in the review), not verify it. The review
  record is the evidence; it is displayed next to the agent.
- **Webhooks without Redis are refused**, not processed without replay
  protection. A deployment without Upstash must rely on polling.
