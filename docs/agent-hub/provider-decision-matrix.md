# Provider decision matrix

**Review date:** 2026-10-22 · **Owner:** FBTSwap AI (External Agent Hub)
**Status of every candidate below:** `UNVERIFIED`

> No provider is approved. Nothing in this document is a marketing claim about a
> provider, and nothing here is evidence that an integration works. An entry moves
> to `APPROVED_*` only after the checks in §1 are completed and signed, and only
> then may it appear in `AGENT_HUB_PROVIDERS_JSON` and therefore in the catalogue.

---

## 0. Why nothing could be approved in this pass

Three blockers, all of them structural rather than technical:

1. **No live verification was possible from the implementation environment.**
   Outbound access was limited to `github.com`, `codeload.github.com`,
   `api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.
   Every candidate's Agent Card / task API host was unreachable (`curl` → `000`).
   A "live check" that cannot reach the provider is not a live check, and the
   Hub's own rule — public listings must be backed by a real health check — is
   what forbids approving one from documentation alone.
2. **The operator jurisdiction is not established.** §7 makes this a hard gate
   rather than a note: an approval that cannot name the operator jurisdiction and
   the target user regions is refused by the validator
   (`PROVIDER_JURISDICTION_UNRESOLVED`). Nationality is not residence and is not
   used as a proxy for either. Several candidates below restrict eligibility by
   residence/entity, so this must be answered before their review can finish.
3. **No provider has been contacted.** There is no account, no API key, no test
   environment, and no written confirmation that this use is permitted. Approving
   on the strength of a public marketing page would be exactly the fabricated
   integration the project forbids.

The implementation is complete and tested behind a disabled flag; **one reviewed
record is what turns it on**.

---

## 1. Review checklist (what an entry must pass)

Copy this table into the record for each provider and fill every row with
evidence, not adjectives.

### Identity
| Field | Required |
|---|---|
| Legal / product name | |
| Official website | |
| Official agent or API documentation | |
| Agent Card URL or task API endpoint | |
| Terms of Service URL | |
| Privacy Policy URL | |
| Brand / attribution requirements | |
| Support and security contact | |
| Date of review + reviewer | |

### Technical
| Field | Required |
|---|---|
| Real remote agent (not a tool/MCP server) | ☐ |
| Stable task or message protocol (A2A / provider task API) | ☐ |
| Input and output schemas | ☐ |
| Authentication method | ☐ |
| Idempotency support (A2A `messageId`, or documented equivalent) | ☐ |
| Timeout and cancellation behaviour | ☐ |
| Webhook or polling support | ☐ |
| Rate limits | ☐ |
| Health-check endpoint | ☐ |
| Error taxonomy | ☐ |
| Test environment | ☐ |
| Result provenance / citations | ☐ |

### Commercial
| Field | Required |
|---|---|
| FBT is not required to prepay or hold a paid master plan | ☐ |
| Business integration is permitted by the provider's terms | ☐ |
| Direct user billing is supported where payment is required | ☐ |
| FBT may display the provider's name and documentation links | ☐ |
| No resale is required (FBT resells nothing) | ☐ |
| No minimum commitment, no hidden provider cost to FBT | ☐ |

### Jurisdiction and eligibility
| Field | Required |
|---|---|
| Operator jurisdiction (legal entity or natural person) | ☐ |
| Target user regions | ☐ |
| Provider restrictions by residence / location / nationality / entity | ☐ |
| Account eligibility requirements (KYC, entity, country list) | ☐ |
| Confirmation that no restriction is being bypassed | ☐ |

### Privacy and security
| Field | Required |
|---|---|
| Minimum user data required | ☐ |
| Prompts used for training? (yes / no / unknown, with source) | ☐ |
| Data retention policy | ☐ |
| OAuth scopes requested and why | ☐ |
| Credential storage requirements | ☐ |
| User revocation path | ☐ |
| Sub-processors / additional recipients | ☐ |
| Provider terms permit processing wallet/portfolio context | ☐ |

### Economics
| Field | Required |
|---|---|
| Model: free / user-paid / provider-sponsored | ☐ |
| Price shown to the user before invocation | ☐ |
| Refund policy | ☐ |
| Network / facilitator / provider fees disclosed | ☐ |

**Outcome:** `APPROVED_FREE` · `APPROVED_ACCOUNT_REQUIRED` ·
`APPROVED_DIRECT_PAID` · `TECHNICAL_ONLY` · `BLOCKED_COMMERCIAL` ·
`BLOCKED_JURISDICTION` · `BLOCKED_SECURITY` · `UNVERIFIED`

Only the three `APPROVED_*` values can be configured. The validator refuses the
rest by name, and refuses the commercial models this project does not implement
(`FBT_PREPAID`, `FBT_MASTER_ACCOUNT`, `FBT_RESELLS_SUBSCRIPTION`,
`FBT_CUSTODIAL_PAYMENT`, `FBT_AUTO_RENEWING_CRYPTO`).

---

## 2. Candidates assessed

| Candidate | Integration form | Outcome | Why |
|---|---|---|---|
| **Base / Coinbase Wallet MCP** | MCP (tools) | `TECHNICAL_ONLY` → not listable here | MCP exposes wallet/market tools, not a hosted agent with task semantics (§5 MCP rule). Could belong to a future *Tools* experience. |
| **Aave MCP** | MCP (tools) | `TECHNICAL_ONLY` → not listable here | Same rule: a DeFi tool server is not an external agent. Listing it would be the misleading entry §5 forbids. |
| **Binance MCP** | MCP (tools) | `TECHNICAL_ONLY` → not listable here | Tool surface only; also jurisdiction-sensitive (residence restrictions), which cannot be assessed without §1 jurisdiction answers. |
| **Gate for AI** | MCP / API | `UNVERIFIED` | Public pages describe tools and exchange APIs; no hosted agent task protocol was verified. Also jurisdiction-sensitive. |
| **GT Protocol** | proprietary | `UNVERIFIED` | Requires account/entity onboarding and market-making vocabulary; no verifiable A2A card or task API from this environment. Marketing copy is not evidence. |
| **Olas Mech Marketplace** | on-chain mech + HTTP | `UNVERIFIED` | The most plausible "real third-party agent services" candidate, but each *mech* is a separate provider requiring its own technical, jurisdictional, privacy and commercial review — and most paths require on-chain payment, which Phase 3 does not implement. Also unreachable from this environment. |
| **Virtuals ACP** | on-chain job protocol | `UNVERIFIED` | Task/job semantics exist, but settlement is on-chain and the commercial model varies per agent; needs the same per-provider review plus a payment design this build does not have. |
| **Independent A2A agents** | A2A | `UNVERIFIED` | The intended integration form. Each candidate must publish a card on a reviewed host and complete §1. None was contacted. |
| **Independent x402 agent services** | x402 + task API | `UNVERIFIED` | x402 is a payment mechanism, not proof of an agent; and paid invocation is deliberately not implemented in this build. |

No candidate is `BLOCKED_*` yet: "blocked" would require a review with evidence
that was actually performed. `UNVERIFIED` is the accurate state, and it keeps the
catalogue empty.

---

## 3. Record shape (what an operator pastes into config)

```json
{
  "id": "provider-slug",
  "name": "Provider Name",
  "websiteUrl": "https://provider.example",
  "documentationUrl": "https://provider.example/docs",
  "termsUrl": "https://provider.example/terms",
  "privacyUrl": "https://provider.example/privacy",
  "supportUrl": "https://provider.example/security",
  "integrationType": "A2A",
  "accessModel": "FREE_PUBLIC",
  "approvalStatus": "APPROVED_FREE",
  "approvalEvidence": {
    "reviewedAt": "2026-11-01",
    "reviewedBy": "ops-name",
    "documentUrl": "https://provider.example/decision-record",
    "jurisdiction": {
      "operatorJurisdiction": "NL",
      "targetRegions": ["EU"],
      "providerRestrictions": ["no US persons"],
      "accountEligibility": "account required, KYC tier 1"
    },
    "promptTraining": "no",
    "dataRetention": "30 days",
    "notes": "A2A card verified 2026-11-01; message/send + tasks/get confirmed"
  },
  "allowedHosts": ["provider.example"],
  "cardUrl": "https://provider.example/.well-known/agent-card.json",
  "rpcUrl": "https://provider.example/a2a",
  "category": "research",
  "costSummary": "Free within provider rate limits",
  "enabled": true
}
```

Optional blocks, only when the provider actually supports them:

```json
"authorization": {
  "type": "OAUTH2",
  "authorizeUrl": "https://provider.example/oauth/authorize",
  "tokenUrl": "https://provider.example/oauth/token",
  "scopes": ["agent.read", "agent.task"],
  "clientIdEnv": "PROVIDER_CLIENT_ID",
  "clientSecretEnv": "PROVIDER_CLIENT_SECRET"
},
"webhook": {
  "secretEnv": "PROVIDER_WEBHOOK_SECRET",
  "signatureHeader": "x-fbt-signature",
  "timestampHeader": "x-fbt-timestamp"
}
```

The validator enforces: https (except an explicit loopback test), the card/RPC
host inside `allowedHosts`, `APPROVED_*` only, a decision-record URL, a
jurisdiction with operator + target regions, and the access models in §6 of the
master specification.

---

## 4. What would change this matrix

1. A network from which the candidate's card endpoint is reachable, with the
   card fetched and its `skills` recorded.
2. Answers to the jurisdiction block from the operator (residence and any entity),
   so provider restrictions can be checked rather than guessed.
3. A provider test environment or a written statement that a sandbox is available.

With those three, one free, read-only research agent can be approved and the
existing end-to-end slice becomes live without further code.
