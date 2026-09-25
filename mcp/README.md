# fbt-mcp — FBT Swap MCP Server

A thin, scope-gated **Model Context Protocol** bridge over the FBT Swap API.
It lets MCP clients — Cursor, Claude Code, Claude Desktop, Codex, and other
agent runtimes — read market intelligence, request quotes and run dry-run
simulations against a real FBT deployment.

> **HARD BOUNDARY.** Nothing in this bridge signs, broadcasts, settles or
> withdraws. FBT Swap is non-custodial: the user's wallet is the only signer in
> the system, every trade is signed on the user's device, and no tool here (nor
> the API behind it) ever receives a key, seed phrase or signature. Quote and
> plan outputs are **advisory** — their natural next step is "show the user, who
> may sign in FBT Swap". This is not investment advice.

Zero npm dependencies (Node ≥ 18). Tool-surface design follows the same
"tenant-scoped wrapper over the human API" pattern as QuantDinger Community's
`quantdinger-mcp` (Apache 2.0); the code here is original and this repository's
own LICENSE governs it.

## Install and run

Local (stdio) — the usual path for editor agents:

```bash
# from this repository
node mcp/src/cli.mjs            # or: npm run mcp
```

Claude Desktop / Claude Code / Cursor / Windsurf MCP config:

```json
{
  "mcpServers": {
    "fbt": {
      "command": "node",
      "args": ["/absolute/path/to/fbtcryp/mcp/src/cli.mjs"],
      "env": {
        "FBT_BASE_URL": "https://fbtswap.ir",
        "FBT_API_KEY": "fbt_sandbox_…"
      }
    }
  }
}
```

`FBT_API_KEY` is optional: without it only the public read tools work. Mint a
sandbox key from the in-app **Developers** page
(`POST /api/developer/projects/{id}/keys`) — the secret is shown once. Scoped
tools check their scope against server truth (`GET /api/developer/whoami`);
a revoked key fails closed immediately.

Remote agents (streamable-HTTP subset):

```bash
FBT_MCP_TRANSPORT=http FBT_MCP_HOST=127.0.0.1 FBT_MCP_PORT=7801 \
FBT_MCP_AUTH_TOKEN="a-long-random-secret-not-the-api-key" \
node mcp/src/cli.mjs
# POST /mcp  ·  GET /healthz   — terminate TLS at your reverse proxy, or tunnel
```

A **non-loopback bind refuses to start without `FBT_MCP_AUTH_TOKEN`**, and the
inbound token must not equal `FBT_API_KEY` (they authenticate different legs).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `FBT_BASE_URL` | `https://fbtswap.ir` | FBT API root (point at `http://127.0.0.1:8787`-style dev origin for local dev) |
| `FBT_API_KEY` | — | optional `fbt_sandbox_…` developer key (hashed server-side; shown once at creation) |
| `FBT_TIMEOUT_MS` | `20000` | upstream request timeout |
| `FBT_MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `FBT_MCP_HOST` | `127.0.0.1` | http bind host (loopback unless a token is set) |
| `FBT_MCP_PORT` | `7801` | http bind port |
| `FBT_MCP_AUTH_TOKEN` | — | bearer required from http callers; required to bind non-loopback |

## Tool surface

Scopes mirror the developer-key scopes (`server/developerKeys.js`). There is
deliberately no `sign`, `execute`, `withdraw` or `settle` scope — nothing here
can grow into one. Each tool advertises its scope as `x-fbt-scope` in
`tools/list` so a client can grey out what its key cannot call.

| Tool | Scope | Purpose |
| --- | --: | --- |
| `fbt_whoami` | any key | key identity + scopes + the never-sign boundary |
| `fbt_check_health`, `fbt_get_environments` | public | liveness and what THIS deployment can do |
| `fbt_get_fee_router_status` | public | is the self-deployed FeeRouter connected: per-chain addresses + live on-chain read (honest UNREACHABLE / NOT_DEPLOYED), bytecode hash, audit state |
| `fbt_get_markets`, `fbt_get_prices`, `fbt_get_coin`, `fbt_search_coins`, `fbt_get_trending` | public | market discovery and data |
| `fbt_get_news` | public | aggregated headlines |
| `fbt_get_signals_pulse`, `fbt_explain_signal` | public | deterministic signal evidence + AI narration of it |
| `fbt_get_network_overview`, `fbt_get_smart_money_overview`, `fbt_get_smart_money_flows` | public | network + on-chain intelligence |
| `fbt_get_intent_capabilities`, `fbt_get_intent_status` | public | Intent OS contract and operational status |
| `fbt_browse_listings` | public | ecosystem agent/strategy/liquidity catalog (self-reported until certified) |
| `fbt_get_cross_chain_quote`, `fbt_get_bridge_quote`, `fbt_get_dln_quote` | `request_quote` | advisory quotes (~60 s life). Returned `transactionRequest`s are signed by the USER's wallet, never here |
| `fbt_scan_defi_opportunities`, `fbt_build_defi_plan`, `fbt_build_profit_plan` | `request_simulation` | dry-run reserve math, costed plans, profit-target proposals — nothing broadcast |
| `fbt_list_my_listings`, `fbt_save_listing`, `fbt_listing_action` | `manage_listings` | your own registry entries; `publish` still requires an allowlisted reviewer's certification |

If a caller invents an execution-flavoured tool name (`sign_swap`, `execute`,
`swap_now`, …) the server answers with a fixed `POLICY_REFUSAL` — the boundary
is taught, not just enforced.

## What this bridge will never do

`x-fbt-boundary` (also returned by `fbt_whoami` and
`GET /api/openapi.json`):

```json
{ "canSign": false, "canExecute": false, "canSettle": false,
  "canWithdraw": false, "custody": false, "userSignatureRequired": true }
```

Also: secrets are redacted from every tool payload before it reaches a model
(including anything an upstream ever echoed back), public tools send no
Authorization header at all, and stdout in stdio mode carries JSON-RPC frames
only.

## Probe

```bash
npm run test:mcp        # node test/mcp/mcp-probe.mjs
```

Asserts, among the rest: every advertised tool route exists in `server/app.js`
(the same discipline as the Developers page), no tool name or description can
sign/execute, scope gates fail closed without network, redaction scrubs
credential-shaped junk, and both transports behave as framed (stdio) and
authenticated (http).

## Protocol coverage

`initialize` · `notifications/initialized` · `ping` · `tools/list` ·
`tools/call` over newline-delimited JSON-RPC 2.0 (stdio) or single JSON-RPC
messages over stateless streamable-HTTP `POST /mcp`. Protocol versions
`2025-06-18`, `2025-03-26`, `2024-11-05`. No sampling, resources, prompts or
roots — we advertise only what exists.

Persian walkthrough: [docs/MCP-BRIDGE-FA.md](../docs/MCP-BRIDGE-FA.md).
