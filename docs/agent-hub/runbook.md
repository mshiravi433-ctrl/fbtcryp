# External Agent Hub — operations runbook

Audience: whoever holds the deployment's environment variables. Nothing here
requires a redeploy for a stop; some steps require one for a start.

---

## 1. Is it on?

```bash
curl -s https://<host>/api/ai/agent-hub/catalog | jq '{enabled,status,reason,agents:(.agents|length)}'
# { "enabled": false, "status": "DISABLED", "reason": "AGENT_HUB_DISABLED", "agents": 0 }
```

`enabled:false` with `reason: AGENT_HUB_DISABLED` = the flag is off (normal).
`reason: KILL_SWITCH` = an operator stopped it (see §4).

Operator view (needs `x-fbt-ops-token`):

```bash
curl -s -H "x-fbt-ops-token: $AGENT_HUB_OPS_TOKEN" \
  https://<host>/api/ai/agent-hub/provider-health | jq
```

Check three fields first: `enabled`, `killSwitch.global`, and `registryErrors`
(an operator who thinks a provider is live but is not is the failure mode that
field exists for).

## 2. Turning it on safely

1. `AGENT_HUB_ENABLED=true`.
2. `AGENT_HUB_PROVIDERS_JSON` = the reviewed record(s). Start with **one free,
   read-only agent**.
3. `AGENT_HUB_OPS_TOKEN` (≥16 chars) — otherwise the ops routes 404 by design.
4. `AGENT_HUB_SECRET_KEY` only if the provider uses OAuth (`connections.start`
   refuses without it; free public agents do not need it).
5. Durable storage: **Upstash is required for account-required or paid tasks**
   (they refuse with `DURABLE_STORE_REQUIRED` otherwise) and for webhooks
   (`WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE` without it).
6. `GET /provider-health?refresh=1` → every provider `LIVE`, `registryErrors: []`.
7. `npm run test:agent-hub`.

## 3. Adding a provider

- Review it (`provider-decision-matrix.md` §1); the record needs identity, a
  decision-record URL, a jurisdiction block, and `APPROVED_*`.
- Add it to `AGENT_HUB_PROVIDERS_JSON`; keep `enabled` per provider for a staged
  rollout.
- Its card host must be in `allowedHosts`, and the RPC URL (if any) on the same
  host or a subdomain.
- Optional `authorization` needs env vars **named in the record**:
  `clientIdEnv`, `clientSecretEnv`. Never put a secret in the JSON record.
- Optional `webhook` needs `secretEnv` pointing at a ≥24-char secret.

## 4. Stop it

**Everything, immediately, without a deploy:**

```bash
# env (takes effect on the next request; no restart needed if the platform
# reloads env, otherwise flip the durable switch below)
AGENT_HUB_KILL_SWITCH=true

# durable switch — survives cold starts and other instances
curl -s -X POST https://<host>/api/ai/agent-hub/provider-health/kill \
  -H "x-fbt-ops-token: $AGENT_HUB_OPS_TOKEN" -H 'content-type: application/json' \
  -d '{"scope":"global","tripped":true,"reason":"incident-INC-123"}'
```

**One provider:**

```bash
-d '{"scope":"provider","providerId":"provider-slug","tripped":true,"reason":"bad results"}'
```

Effects: the provider disappears from the catalogue, `createTask` refuses with
`AGENT_UNAVAILABLE`, and in-flight tasks keep their rows (the UI still shows
their last known state, honestly labelled).

Clearing: `{"scope":"global","tripped":false}`. The switch is stored under
`agenthub:kill:v1:global:<target>` and read fresh on every request. If the store
is unreadable the module treats the global switch as TRIPPED (fail closed).

**One agent:** `enabled:false` on the provider record (or remove the provider
from `AGENT_HUB_PROVIDERS`), then redeploy config.

## 5. Common failures

| Symptom | Code | Meaning / action |
|---|---|---|
| Catalogue empty, `enabled:true` | — | No provider configured, or all `UNAVAILABLE`. Check `/provider-health`. |
| Provider `UNCONFIGURED` | `PROVIDER_ADAPTER_NOT_IMPLEMENTED` | Record says `PROVIDER_TASK_API`; only `A2A` is implemented in this build. |
| Registry error | `PROVIDER_JURISDICTION_UNRESOLVED` | Fill the jurisdiction block; do not remove the check. |
| | `PROVIDER_NOT_APPROVED` | Status is not `APPROVED_*`. |
| | `PROVIDER_CARD_HOST_NOT_ALLOWLISTED` | Card host is not under `allowedHosts`. |
| Task stuck `reconciling` | `PROVIDER_UNREACHABLE` / `PROVIDER_TIMEOUT` | The create may have succeeded at the provider. **Do not re-create with the same key** (it will not create); ask the user to start a new request only after the provider's own dashboard/records are checked. |
| `PROVIDER_TASK_NOT_FOUND` on a poll | — | The provider forgot the task. The row is marked `reconciling` + `outcomeUnknown`; no automatic retry. |
| Webhook 503 | `WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE` | Upstash not configured. Events are refused on purpose; rely on polling. |
| Webhook 401 | `WEBHOOK_SIGNATURE_INVALID` / `..._STALE` | Wrong secret, wrong signed string (`timestamp + "." + rawBody`), or clock skew > 5 min. |
| `AUTH_REQUIRED` after connecting | — | Connection expired/revoked, or `AGENT_HUB_SECRET_KEY` changed (sealed blobs become unreadable — expected; users reconnect). |
| `DURABLE_STORE_REQUIRED` | — | Account-required task without Upstash/Blob. Configure storage or keep the agent free. |
| `429 RATE_LIMITED` | — | Per-owner create burst (`AGENT_HUB_CREATE_RATE`, default 8/min) or the `/api/ai` gateway budget. |

## 6. Incident: a provider returned harmful or wrong content

1. Trip the provider's kill switch (§4).
2. Collect the task ids from the user's Activity (the row holds the provider
   reference, the approved context hash and the normalized result).
3. Providers cannot execute inside FBT: no transaction, signature, payment or
   policy change can originate from a result. If a user reports that a result
   *looked* actionable, the fix is copy and the injection warning, not a rollback
   of funds.
4. If the provider is compromised, also remove it from
   `AGENT_HUB_PROVIDERS_JSON` and rotate `AGENT_HUB_SECRET_KEY` (this invalidates
   every sealed connection — users reconnect), plus that provider's
   `secretEnv`/OAuth secret.

## 7. Key rotation

| Key | Rotation effect |
|---|---|
| `AGENT_HUB_SECRET_KEY` | All sealed connection credentials become unreadable → every user reconnects. Plan it. |
| `AGENT_HUB_STATE_SECRET` | In-flight OAuth authorizations fail (`OAUTH_STATE_INVALID`). Safe; they expire in 10 minutes anyway. |
| `AGENT_HUB_OPS_TOKEN` | Ops routes answer 404 to the old token immediately. |
| Provider webhook secret | Signatures fail until the provider's dashboard matches. |

## 8. Cost and billing posture

- FBT does not bill for external agents: `priceQuote.amount` is 0 and the UI says
  so. No commission code exists.
- Provider-reported cost, when a provider supplies it, is stored on the task
  (`costReported`) and shown as *reported by the provider*.
- Paid invocation is off. A `DIRECT_CRYPTO_PAYMENT` provider produces
  `PAYMENT_REQUIRED` and makes no provider call. Turning that on is Phase 3 and
  needs its own design, provider and audit — not a flag flip.

## 9. Verification checklist after any change

```bash
npm run test:agent-hub                     # adapter, security, API, UI
node test/fios/fios-api-probe.mjs          # route collisions with the FI surface
```

Plus, on the deployment: `/api/ai/agent-hub/catalog` (enabled state as intended),
`/api/ai/agent-hub/provider-health` (all LIVE, no registry errors),
`/api/ai/agents` (command center still answers), `/api/ai/external-agents` (FI
trust registry still answers).
