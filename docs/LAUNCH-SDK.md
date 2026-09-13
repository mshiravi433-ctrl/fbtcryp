# FBT Launch — API & SDK Reference

**Non-custodial token & liquidity launchpad.** This document describes the
public HTTP surface (`server/launch.js`) and the official SDK
(`sdk/fbt-launch.mjs`). A full Persian overview of the product lives in
`docs/LAUNCH-FA.md`.

> **Read this first — the custody contract.**
> FBT never holds user funds, never receives private keys or seed phrases,
> and never signs a user's financial transactions. The API below only ever
> returns **prepared bytes** and **read-only on-chain facts**. The user's
> wallet signs every step. Anything that looks like it "launches a token
> for me" without a wallet signing is not this product.

---

## 1. Endpoints

All under `/api/launch`. All stateless and side-effect free **except**
`POST /launch/record`, which appends a non-sensitive public record.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/launch/config` | Networks, DEX registry, fee schedule, custody statement |
| `GET` | `/launch/prepare` | Byte-exact plan + risk verdict for one phase |
| `GET` | `/launch/verify` | Read-only on-chain readback of a finished launch |
| `POST` | `/launch/record` | Optional public record (refuses 503 with no durable store) |
| `GET` | `/launch/records/:chainId` | Public records for a chain |

### `GET /api/launch/config`
No parameters.
```json
{
  "schema": "fbt.launch-config.v1",
  "solana": { "status": "COMING_SOON", "note": "…" },
  "networks": [
    {
      "chainId": 56, "name": "BNB", "short": "BNB", "color": "#…",
      "native": { "symbol": "BNB", "decimals": 18 },
      "explorer": "https://bscscan.com",
      "dex": { "id": "pancakeswap-v2", "name": "PancakeSwap", "factory": "0x…", "router": "0x…", "wrapped": "0x…", "feeTierBps": 25 },
      "quotes": [ { "symbol": "BNB", "native": true }, { "symbol": "USDT", "address": "0x…", "decimals": 6 } ],
      "fbtFactory": null, "mode": "direct", "tokenDeployReady": true, "status": "ready"
    }
  ],
  "fees": { "launchFeeBps": 0, "swapFeeBps": 70, "protocolFeeBps": 0, "notes": { "launch": "0%", "swap": "0.70%", "protocol": "0%" } },
  "factoryRegistry": { "56": "0x…" },
  "durableRecords": false,
  "noCustody": { "holdsFunds": false, "holdsKeys": false, "signsUserTransactions": false, "statement": "…" }
}
```
`networks[].status` is `ready` when a V2-family DEX is pinned for the chain
(still re-verified on-chain before any signature), and the chain is ABSENT
from the list when it is not — a chain is never offered and then blocked.

`networks[].mode` says who the token transaction talks to, and it is per chain:
`direct` (the v1 default — the token's creation bytecode is sent straight from
the user's wallet, `to: null`, no FBT contract involved) or `factory` (an
FBTTokenFactory is pinned for the chain through `FBTLAUNCH_FACTORY_<id>`; the
factory is a stateless deployer/registry and the path a future on-chain launch
fee would need). `tokenDeployReady` is `true` in both modes, because direct
deploy needs no operator contract at all.

### `GET /api/launch/prepare`
Query parameters (all optional; the set that makes sense per phase):

| Param | Type | Phase | Meaning |
|-------|------|-------|---------|
| `chainId` | number | both | one of 8453, 56, 42161, 137, 1 |
| `name`, `symbol`, `decimals`, `supply` | string | **one** | token spec (mandatory only to CREATE the token) |
| `capMintable` … `capMaxTx` | "true" | one | advanced owner powers (all pre-disclosed) |
| `quote` | JSON | both | `{ symbol, address?, decimals, native? }` |
| `tokenAmount`, `quoteAmount` | decimal string | both | initial pool sizes, human units |
| `slippageBps` | number | both | default 100 |
| `creator` | address | both | the user's wallet (LP goes here) |
| `mode` | "direct" \| "factory" | one | force a mode; default comes from `FBTLAUNCH_FACTORY_<id>` (absent ⇒ `direct`) |
| `factoryAddress` | address | one | force factory mode with this address |
| `nonce` | number | one | the creator's transaction count, used ONLY to predict the direct-deploy address (re-read before signing) |
| `tokenAddress` | address | **two** | existing token — enables pool/liquidity phase |
| `createPairNeeded` | "true" | two | whether the pool must be created |
| `pairAddress` | address | two | existing pair, when any |

**Phase one** (no `tokenAddress`) returns a plan whose `steps` are:
`create-token` + a `deferred-pool` intent (no bytes — the token doesn't
exist yet, so there is nothing honest to encode). **Phase two**
(`tokenAddress` set) returns the real pool steps:
`approve-token` (+ `approve-quote` for ERC-20 quotes) + `create-pair` (only
when needed) + `add-liquidity` / `addLiquidityETH`.

```json
{
  "ok": true,
  "noCustody": { "signsUserTransactions": false, "statement": "…" },
  "dex": { "verified": true, "reason": null },
  "plan": {
    "schema": "fbt.launch-plan.v1", "phase": "token" | "pool", "chainId": 56,
    "dex": { "id": "…", "factory": "0x…", "router": "0x…", "wrapped": "0x…" },
    "mode": "direct",
    "predictedTokenAddress": "0x…",
    "steps": [ { "id": "create-token", "to": null, "data": "0x…", "value": "0", "deploy": true, "predictedAddress": "0x…", "expectedCode": "0x…", "description": "…" } ],
    "signatureOrder": ["token.create", "pool.create", "liquidity.approve", "liquidity.approveQuote", "liquidity.add"],
    "createPairNeeded": null, "pairAddress": null
  },
  "risk": { "score": 0, "band": "low", "findings": [], "gates": [], "blocked": false, "confirmRequired": false }
}
```
`risk` is computed server-side with the **same deterministic engine** the
UI uses, and includes the live DEX verification result — the plan and its
risk verdict leave the API together.

In `direct` mode the `create-token` step is a plain CREATE: `to` is `null`,
`data` is the token creation bytecode followed by
`abi.encode(name, symbol, decimals, initialSupply, creator, capabilities)`,
and `predictedAddress`/`predictedTokenAddress` is the address the token WILL
be created at — the last 160 bits of `keccak256(rlp([creator, nonce]))`, shown
before the signature. After the receipt, the app checks that the transaction
was a deployment that landed at EXACTLY that address and that the code there
equals the published runtime bytecode byte for byte
(`codeMatches` → `DIRECT_CODE_MISMATCH` and friends); there is no
`TokenCreated` event to read in this mode.

Errors: `CHAIN_NOT_SUPPORTED`, `SPEC_INVALID` (with `errors[]`),
`QUOTE_INVALID`, `AMOUNT_INVALID`, `CREATOR_REQUIRED`,
`FACTORY_NOT_DEPLOYED` (409, factory mode only), `PHASE_TWO_NEEDS_QUOTE` (409),
`NO_RPC`/`ANCHOR_PAIR_MISSING` (dex.verified=false, launch stays blocked).

### `GET /api/launch/verify`
Read-only on-chain readback. Params: `chainId`, `token`, `pair`, `creator`,
`quote` (JSON), `tokenMin`, `quoteMin`, `newPair` ("true"/"false"),
`expect` (JSON `{ name, symbol, decimals, supply }`).
```json
{ "ok": true, "token": { "verified": true, "address": "0x…", "name": "…", "problems": [] },
  "pool": { "verified": true, "address": "0x…", "lpBalance": "…", "reserves": { "token": "…", "quote": "…" }, "problems": [] } }
```
For a `newPair`, reserves must fall within `[signedMin, desired × 1.02]`
on both legs — a front-run or a mis-created pool fails verification.

### `POST /api/launch/record`
Body = one record. Only the closed allow-list is stored
(`launchId`, `creatorPublicAddress`, `network`, `tokenAddress`,
`poolAddress`, `tokenName`, `symbol`, `supply`, `initialPrice`,
`tokenLiquidity`, `quoteLiquidity`, `quoteSymbol`, `provider`, `status`,
`riskScore`, `txHashes`, `createdAt`, `updatedAt`); **everything else is
dropped at the boundary**. Returns `503 NO_DURABLE_STORE` when the
deployment has no durable store configured — the caller's local history is
the source of truth either way, so a failed record is not a failed launch.

### `GET /api/launch/records/:chainId`
```json
{ "ok": true, "durable": false, "count": 0, "records": [] }
```

---

## 2. SDK — `sdk/fbt-launch.mjs`

ESM, browser + Node 18+, zero required dependencies beyond `ethers` (used
for its `Interface` in one place). Wallet-agnostic: you inject the signer.

```js
import { FBTLaunch } from './sdk/fbt-launch.mjs';

const launch = new FBTLaunch({
  apiBase: '/api',                 // or a full https URL
  signer: wallet.getSigner(),      // ethers v6 Signer — the USER'S wallet
  provider: wallet.getReadProvider(),
  address: wallet.address,
  gasHeadroomPct: 20,              // gasLimit = estimateGas × 1.2
  confirmations: 1,
  onStep: (s) => console.log(s.id, s.status)
});

// 1. what can I launch, and at what cost?
const cfg = await launch.config();

// 2. byte-exact plan + risk (phase one)
const p1 = await launch.prepare({
  chainId: 56, name: 'FBT Gold', symbol: 'FBTG',
  decimals: 18, supply: '1000000000',
  quote: { symbol: 'USDT', address: '0x55…', decimals: 6 },
  tokenAmount: '100000', quoteAmount: '10000'
});
// inspect p1.plan.steps, p1.risk — the UI's job. Then:

// 3. execute: estimate → user signs → wait → read the chain back
const result = await launch.run(p1.plan);
// result.state === 'CONFIRMED'  → verify before claiming success:
const v = await launch.verify({
  chainId: 56, token: result.token.address, pair: result.pool?.address,
  creator: wallet.address,
  quote: { symbol: 'USDT', address: '0x55…', decimals: 6 }
});
if (v.ok) await launch.record({ launchId: '…', network: 56, tokenAddress: result.token.address, status: 'LIVE', riskScore: p1.risk.score });
```

### `run(plan)` — the execution law
- Estimates every step first; a failed simulation aborts **before** any
  signature is requested (nothing is signed that would revert).
- Signs in the **injected** signer only. The SDK has no key material.
- User rejection (`code 4001`) → `CANCELLED` (their choice), never `FAILED`.
- Revert / bad receipt → `FAILED`, or `RETRYABLE` + `partial` when the token
  already mined (recovery: re-run with the existing `tokenAddress`).
- The deferred pool intent is materialised against the **real** token
  address read from the `TokenCreated` event — never against a placeholder.

### SDK error codes
`SIGNER_REQUIRED`, `PROVIDER_REQUIRED`, `TOKEN_MISSING_BEFORE_POOL`,
`POOL_PREPARE_FAILED`, `SIMULATION_FAILED: …`, `USER_REJECTED`,
`TX_REVERTED`, `TOKEN_EVENT_NOT_FOUND`, plus the API's codes
(`FACTORY_NOT_DEPLOYED`, `CHAIN_NOT_SUPPORTED`, …).

---

## 3. The shared byte builder

`src/lib/launch/calldata.js` is the **single** builder imported by the app
(`src/pages/Launch.jsx`), the API (`server/launch.js`) and the SDK's
prepare path. The same inputs produce the same bytes in all three — which
is what makes "prepare here, sign there, verify everywhere" honest.
`test/launch-probe.mjs` pins that property by decoding the bytes back to
the original intent.

---

## 4. Environment (server)

```bash
# FBT factory deployment per chain (public constant — paste after deploy).
# OPTIONAL: setting one switches THAT chain to factory mode. A chain with no
# address launches in the default DIRECT mode (the user's wallet deploys the
# token; no FBT contract is involved and there is nothing to pay us).
FBTLAUNCH_FACTORY_8453=
FBTLAUNCH_FACTORY_56=
FBTLAUNCH_FACTORY_42161=
FBTLAUNCH_FACTORY_137=
FBTLAUNCH_FACTORY_1=
FBTLAUNCH_FACTORY_10=
FBTLAUNCH_FACTORY_43114=

# Optional DEX factory overrides (default: built-in registry, re-verified live)
FBTLAUNCH_DEX_FACTORY_56=
```

Deploy a factory:
```bash
node scripts/compile-launch.mjs
DEPLOYER_PRIVATE_KEY=0x… RPC_URL=https://… CHAIN_ID=56 \
  node scripts/deploy-launch-factory.mjs
# verify-only, no key:
RPC_URL=https://… CHAIN_ID=56 node scripts/deploy-launch-factory.mjs verify 0xFactory
```

Verify the DEX registry (CI/operators, reads only):
```bash
node scripts/verify-launch-dex.mjs          # all chains
node scripts/verify-launch-dex.mjs 56 8453  # specific
```
