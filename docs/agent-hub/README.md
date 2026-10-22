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
| Discover / Connected / Activity UI in `/intent` → Agents | ✅ implemented |
| Direct on-chain payment (x402-style relay) | ⛔ **not implemented** — Phase 3 deferred |
| Any approved live provider | ⛔ **none** — see the decision matrix |

The feature ships **off**: `AGENT_HUB_ENABLED` defaults to `false` and the
catalogue is empty until an operator configures a reviewed provider. That is the
honest outcome of Phase 0: no provider could be verified from this environment
(only `github.com` + package registries are reachable), and the operator
jurisdiction needed for a jurisdiction-sensitive approval has not been supplied.

One reviewed provider + one config entry makes the end-to-end slice live; the
whole path is already tested against a local A2A conformance server.

---

## Layers

```
src/components/AgentHub/AgentHubPanel.jsx     Discover · Connected · Activity
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
- **External agents** — the hub: Discover · Connected · Activity.

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
| GET | `/api/ai/agent-hub/catalog` | server-resolved listings + live status |
| GET | `/api/ai/agent-hub/agents/:agentId` | detail incl. provider terms/privacy |
| GET | `/api/ai/agent-hub/connections` | device-scoped owner |
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

- `test/agent-hub/a2a-adapter.test.mjs` — adapter contract + SSRF/redirect rules
  (24 tests, local A2A conformance server)
- `test/agent-hub/hub-security.test.mjs` — consent, registry refusals, webhook
  signatures/replay, idempotency semantics, redaction (36 tests)
- `test/agent-hub/hub-api-probe.mjs` — the real `server/app.js` over HTTP:
  owner isolation, IP-only refusal, payment/account gates, double-click,
  lost response, kill switches, routing hygiene (83 assertions)
- `test/agent-hub/agent-hub-ui.test.jsx` — catalogue states, context preview,
  approval gate, sanitized rendering, injection warning (13 tests)

`test/agent-hub/conformance-server.mjs` is the only fake agent in the repository.
It binds to `127.0.0.1`, is never imported by production code, and refuses to
represent a real provider.

## Enabling a provider

1. Complete `docs/agent-hub/provider-decision-matrix.md` for that provider.
2. Add the record to `AGENT_HUB_PROVIDERS_JSON` (shape in the matrix doc).
3. Set `AGENT_HUB_ENABLED=true`, the webhook/OAuth secrets **by the env names the
   record declares**, and `AGENT_HUB_OPS_TOKEN`.
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
- **Agent suggestions from the chat brain.** The surface exists, but suggesting a
  third-party agent from a chat turn needs its own consent design; it is not in
  this slice.
- **MCP tools.** MCP servers expose tools, not agents (§5). They belong to a
  future Tools experience, not this page.

## Residual risks

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
