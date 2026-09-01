# FBT Wallet Engine — architecture & engines (EN)

The Wallet Engine is a **pure, testable layer** (`src/lib/wallet-engine/`) that
implements the proposed Wallet Core architecture and the ten priority engines,
with **zero UI changes** — no component, no style was touched.

## Architecture

```
                  Wallet Core
                      │
            Wallet Orchestrator   ← orchestrator.js
                      │
     ┌────────────────┼────────────────┐
     │                │                │
 EVM Adapter     Solana Adapter    BTC Adapter   ← adapters.js
     │                │                │
 EVM Chains         Solana         Bitcoin
     │
 WalletConnect   ← sessionManager.js
```

Engines on top of the core: balance, asset resolver, simulation, gas,
approval, security, cost basis / P&L, portfolio, automation, unified indexer,
real-time tracker, transaction intelligence, address book, WC sessions,
recurring, notifications.

## The two load-bearing pieces

**Wallet Capability Engine** (`capabilities.js`) — the system knows which
wallet fits which operation:

```js
{ wallet: 'solana-main', chain: 'solana', capabilities: ['send','receive','swap','stake'] }
{ wallet: 'btc-main',    chain: 'bitcoin', capabilities: ['send','receive'] }
```

`selectWalletFor({ capability, family })` treats family as a **hard filter**
and refuses (`NO_CAPABLE_WALLET`) instead of guessing.

**Wallet State Machine** (`walletStateMachine.js`) —

```
CREATED → CONNECTED → READY → ACTION_PREPARED → AWAITING_SIGNATURE
        → SIGNED → BROADCASTED → PENDING → CONFIRMED
FAILED · CANCELLED · EXPIRED
```

Every state has an evidence gate: `SIGNED` needs a signature, `BROADCASTED`
needs a tx hash, `CONFIRMED` needs a successful receipt. `SIGNED → CONFIRMED`
is an illegal transition — this is what makes "approved but never executed"
structurally impossible.

## The ten priority engines

| # | Engine | Module |
|---|---|---|
| 1 | Transaction Simulation | `simulationEngine.js` |
| 2 | Smart Asset Resolver | `assetResolver.js` |
| 3 | Unified Indexer | `indexer.js` |
| 4 | Wallet Capability Engine | `capabilities.js` |
| 5 | Wallet State Machine | `walletStateMachine.js` |
| 6 | Approval Manager | `approvalManager.js` |
| 7 | Security / Risk Engine | `securityEngine.js` |
| 8 | Cost Basis + P&L | `costBasisEngine.js` |
| 9 | Wallet Automation Engine | `automationEngine.js` |
| 10 | Real-Time Transaction Tracker | `tracker.js` |

## Honesty rules (every module)

1. Missing data is `null` / `unknown`, never zero and never "safe".
2. Evidence gates success — no hash → no broadcast, no receipt → no confirmed.
3. No wrong guess instead of "I don't know" — selection refuses when nothing fits.
4. Messages are i18n keys, never hardcoded prose.
5. Nothing here signs or broadcasts on its own; only the orchestrator moves value.

## Tests

```bash
npm run test:wallet-engine   # 76 assertions, pure (no DOM / network / SDK)
```

The probe is also wired into `npm test` (`test/run.mjs`).

## What is deliberately NOT done yet

Wiring into `WalletContext.jsx` / the Wallet screen is intentionally left out
per the request to keep the UI untouched. The integration path is documented in
the Persian doc (`WALLET-ENGINE-FA.md`, section ۸).
