# Lido · Ethereum · stETH / wstETH — in-app stake adapter

The app's fourth DeFi **execution** adapter: stake ETH for stETH on Ethereum mainnet (chainId 1), wrap stETH to wstETH, unwrap, request withdrawal via WithdrawalQueue, and claim finalized withdrawals — from inside the app, signed by the user's own wallet.

| | |
|---|---|
| Adapter | `src/lib/defi/lido.js` (pure, no React) |
| Feature flag | `src/lib/features.js` |
| Local ledger | `src/lib/defi/lidoHistory.js` |
| UI | `src/components/Farm/LidoPanel.jsx`, mounted from `src/pages/Farm.jsx` |
| Wiring pins | `test/wiring.mjs`, section 116 |
| Fork probe | `test/lido-fork-probe.mjs` → `npm run test:lido-fork` (future) |

---

## 1. Addresses and where they came from

Every Lido address is pinned in `src/lib/defi/lido.js` and **nowhere else** in `src/`. A wiring pin greps the whole tree to prove it.

| Contract | Address | Source |
|---|---|---|
| stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | https://docs.lido.fi/deployed-contracts/ |
| wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | https://docs.lido.fi/deployed-contracts/ |
| WithdrawalQueue | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` | https://docs.lido.fi/deployed-contracts/ |

Verified on Etherscan:
- https://etherscan.io/address/0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
- https://etherscan.io/address/0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
- https://etherscan.io/address/0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1

### Runtime verification

Pinned constants are never trusted alone. Before any write, `verifyDeployment()` checks:

1. `wstETH.stETH() == LIDO.stETH`
2. `WithdrawalQueue.WSTETH() == LIDO.wstETH`
3. `WithdrawalQueue.STETH() == LIDO.stETH`
4. `stETH.getTotalPooledEther()` is readable (contract is live)

A mismatch throws — the adapter would rather be unusable than move value against a contract it did not verify.

### Protocol shapes relied on

Verified against Lido docs and Etherscan ABIs:

- `stETH.submit(address _referral) payable returns (uint256)` — stake ETH
- `stETH.balanceOf`, `sharesOf`, `getTotalPooledEther`, `getFee`, `isStakingPaused`
- `wstETH.wrap(uint256)`, `unwrap(uint256)`, `getWstETHByStETH`, `getStETHByWstETH`, `stETH()`
- `WithdrawalQueue.requestWithdrawals(uint256[] _amounts, address _owner) returns (uint256[])`
- `WithdrawalQueue.claimWithdrawal(uint256 _requestId)`
- `WithdrawalQueue.getWithdrawalRequests`, `getWithdrawalStatus`, `getWithdrawalQueueLength`, `isPaused`, `isBunkerModeActive`

---

## 2. Enabling the flag, and the caps

Everything is in `src/lib/features.js`. **All default to the safe value.**

| Export | Default | Env var |
|---|---|---|
| `LIDO_STAKE_ENABLED` | `false` | `VITE_ENABLE_LIDO_STAKE=true` |
| `LIDO_STAKE_MAX_ETH_PER_TX` | `1` | `VITE_LIDO_STAKE_MAX_ETH_PER_TX` |
| `LIDO_STAKE_MAX_ETH_TOTAL` | `10` | `VITE_LIDO_STAKE_MAX_ETH_TOTAL` |
| `LIDO_STAKE_ALLOWLIST` | `[]` | `VITE_LIDO_STAKE_ALLOWLIST=0xabc…,0xdef…` |

```bash
VITE_ENABLE_LIDO_STAKE=true \
VITE_LIDO_STAKE_ALLOWLIST=0xaaa…,0xbbb… \
npm run build
```

Flag is `=== 'true'`, not `!== 'false'`. A build that forgets the env var ships with the money path **closed**. `vite.config.js` pins `__LIDO_ENABLED__` and `__LIDO_STAKE_ENABLED__` the same way.

Caps are enforced **in the adapter**, not only UI: per-tx and total position caps. A blocked plan returns `steps: []`.

### The kill switch

Set the flag off and rebuild. Stake disappears. Withdrawals, unwrap, claim, and revoke do NOT disappear — they are gated by `lidoWithdrawAllowedFor` which looks only at position/history, never flag. Gating the exit would trap funds.

Position on wrong chain: if user has confirmed Lido history but is on different chain, panel shows with "switch to Ethereum" prompt instead of vanishing.

### Partial state (approve confirmed, wrap/request did not)

Approve and wrap/request are two transactions. If first lands and second fails, user holds standing allowance. `derivePartialApprovalState` combines ledger with on-chain allowance — chain wins — and panel shows revoke buttons. Revoke is `approve(spender, 0)`.

Ledger capped, newest-first, explicit field whitelist, public facts only: hash, amount, block, timestamp, owner, requestId. Never key/mnemonic/signature.

---

## 3. Execution model

Five modes:

- **stake**: ETH → stETH via `stETH.submit(referral)` payable. Checks native balance + gas floor `NATIVE_GAS_FLOOR[1]` (0.0035 ETH), staking paused, caps.
- **wrap**: stETH → wstETH via `wstETH.wrap`. Exact-amount approve if needed.
- **unwrap**: wstETH → stETH via `wstETH.unwrap`.
- **requestWithdraw**: stETH → ticket via `requestWithdrawals([amount], owner)`. Exact-amount approve to queue if needed. Warns on bunker mode.
- **claim**: ticket → ETH via `claimWithdrawal(requestId)`. Checks owner, finalized, not claimed.

All unsigned steps go through `lib/preSignSimulation.js` before user is asked to sign. UI only enables signing on `simulated-clean` and non-blocked execution gate.

Approvals are for **exactly** the amount being wrapped/queued, never MaxUint256. Standing infinite approval would let compromised contract move rest of wallet's stETH.

`onBehalfOf` / `owner` always the connected owner. No param lets them differ.

Reads fail closed. Undecodable reserve, missing provider, or failed verification throws typed error, never plausible default.

---

## 4. What was deliberately not built

| Not built | Why |
|---|---|
| Leverage, borrow, repay | No leverage in Lido; separate risk. |
| Swap into stETH (USDT→stETH) | Swap venue's job, not this adapter. |
| Other chains | Pins and verification are chain-specific (mainnet 1). |
| Unbounded approvals | Exact amount or zero on revoke. |
| Any server component | Ledger local, nothing uploaded. |
| A fee on stake/wrap/unwrap/request/claim | None charged on this page — only Ethereum gas. Swaps elsewhere still carry platform fee. |
| `referral` param | Always zero address, honest default. |
| Lido SDK | Plain ABI calls suffice. |
| New page | Entry attaches to existing Farm pool detail for Lido pools. |

---

## 5. Known limitations

- **Withdrawal queue delay**: Lido withdrawals are not instant — tickets must finalize. `claimable` vs `pending` shown. Bunker mode may extend delay.
- **`totalEthEquivalent`**: wstETH value converted via `getStETHByWstETH` — if that read fails, total is stETH only, not 0.
- **Buffered ether / fee**: read best-effort; if unreadable, null, not 0.
- **Status reads fail closed**: if `getProtocolStatus` unreadable, adapter throws typed error and plan returns no steps.
- **No price oracle pin**: stETH is ETH-pegged by protocol, not by external oracle.
