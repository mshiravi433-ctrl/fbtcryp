# FBT Intent AI OS — Refactor Notes

This documents the unified AI OS refactor. It is a single conversational
interface for all of FBT: the user talks, the AI gathers live context, selects
a real FBT tool, prepares a plan, confirms in chat, and hands the action to the
real wallet/venue flow for signature.

## What changed

### App surface
- `/intent-ai` now renders `src/components/IntentAIUnified.jsx` instead of the
  old policy-first `IntentAIPanel`.
- Removed the visible policy editor and L1/L2/L3 selector from the production
  surface.
- Removed the fixed "quick actions / suggestions" row from the chat. The only
  suggestions are **dynamic**, generated from the user's latest intent and the
  live context (max 4).
- Added `[ + Actions ]` drawer (Swap / Bridge / Send / Buy / Sell / Futures /
  Farm / Lending / Financial Goal / DCA / Portfolio). The drawer is a helper;
  the assistant works without it.
- Chat input is always at the bottom, mobile-first, dark, glass, minimal.

### Backend API (`/api/v1/ai`)
- `POST /context` — current wallet / chains / balances / portfolio / intents /
  automations / activity / memory summary.
- `POST /suggestions` — intent classifier + dynamic suggestion engine (max 4).
- `POST /chat` — one turn: intent → live context → tool registry → plan →
  execution firewall → structured reply + suggestions.
- `POST /execute` — validates an `AIAction` against wallet, chain, balance,
  slippage/gas/simulation state and returns an honest hand-off to the real
  venue/wallet flow. It never signs and never fabricates a transaction hash.
- `GET /tools` — the unified tool registry (`aiToolRegistry.js`).
- `GET/POST/DELETE /automations`, pause/run/result — durable automation records
  with real status (`ACTIVE / PAUSED / FAILED / COMPLETED / CANCELLED`),
  `nextExecution`, `lastExecution`, `result`, `transactionHash`, `error`.
- `GET/POST /memory` — safe conversation memory (no keys/seeds/passwords).
- `POST /goal`, `POST /goal/:id/plan` — connects the existing Financial Goals
  service.

### Honesty rules preserved
- No server-side signer, no seed/private-key handling, no fabricated
  `COMPLETED`.
- A transaction hash is only ever stored when the client reports a real one.
- Every balance/price/yield is either real or reported `unavailable`.
- Default AI control no longer uses artificial `$100/$500/$1000` ceilings. The
  user owns their wallet. Mandatory checks still run at execution: wallet,
  chain, balance, slippage, gas, validation, simulation, user approval for the
  wallet/security flow.

### Solana + EVM
- The context includes connected EVM addresses and, when connected, the Solana
  address and live SOL balance.
- Solana is a first-class chain (chain id `501`) in the AI chain registry.
- Solana actions hand off to `/solana`; EVM actions to `/swap`, `/bridge`,
  `/wallet`, `/perp`, `/farm`, `/loan`, `/stocks`, `/portfolio` depending on
  the action type.

## Files added/changed

### New
- `server/aiIntentOS.js`
- `src/lib/aiIntentClient.js`
- `src/components/IntentAIUnified.jsx`
- `src/styles/intent-ai-os.css`
- `src/lib/intent-ai/aiToolRegistry.js`
- `docs/ai-os-refactor.md`

### Modified
- `server/app.js` — mounted `/api/v1/ai`, added own rate limit.
- `src/App.jsx` — `/intent-ai` uses the new unified UI.
- `src/lib/intent-ai/commandCenter.js` — AI defaults are product-boundary
  values, not small artificial caps, and chain registry includes Solana.
- `src/lib/intent-ai/permissions.js` — Solana chain id in the allowed chains.
- `src/lib/solanaWallet.js` — added `getSolanaBalance()` live SOL balance read.

## Next steps
- Extend `/chat/stream` with SSE when a model provider is configured.
- Wire the post-execution automation result callback from the real venue
  screens into `/api/v1/ai/automations/:id/result`.
- Add live quote/gas details to the execution card when venue quotes are
  available.
