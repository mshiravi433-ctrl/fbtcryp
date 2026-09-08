# Morpho Blue Base — one executable market scope

Status: **adapter and fork probe are gated; this is not a public rollout**.

This document defines the only Morpho scope in this release. It is **Morpho Blue's core market**, not a Morpho vault and not an ERC-4626 share contract.

## Immutable scope

| Field | Value | Provenance / use |
|---|---|---|
| Chain | Base, `8453` | transaction network |
| Morpho Blue core | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | official Morpho address resource; transaction target |
| Market ID | `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836` | `idToMarketParams(bytes32)` selector |
| Loan token | Base USDC, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals | official token registry and on-chain market parameter |
| Collateral token | Base cbBTC, `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf`, 8 decimals | official token registry and on-chain market parameter |
| Oracle | `0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9` | immutable market parameter |
| IRM | `0x46415998764C29aB2a25CbeA6254146D50D22687` | immutable market parameter |
| LLTV | `860000000000000000` (86%) | immutable market parameter |
| Market creation block | `19326981` | official Morpho API observation |

The adapter supplies and withdraws **only the loan token, USDC**. It does not
supply cbBTC collateral, borrow USDC, repay debt, or claim rewards. It passes the
full `MarketParams` tuple to Morpho Blue and verifies every field before a plan
is returned.

## Data mapping versus transaction authority

The DefiLlama feed contains a Base `morpho-blue` row with `symbol=CBBTC`,
`underlyingTokens=[0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf]`, and UUID:

`7d33d57d-36dc-414b-9538-22a223250468`

That UUID is a **reporting/data identifier only**. It is not a contract address,
market ID, approval spender, or transaction target. The adapter never chooses a
market from a symbol or a DefiLlama filter. The mapping is accepted only when
the market ID and immutable parameters read from the official Morpho endpoint
and the chain agree:

- Morpho API selector: `8453:<marketId>`
- loan token: Base USDC
- collateral token: Base cbBTC
- oracle, IRM, and LLTV: the exact values above

If the API/feed row changes, disappears, or cannot be fetched, exits are not
blocked; however, no new quote or position value may be fabricated from that
feed. Contract verification remains the source of transaction truth.

## Execution boundary

`src/lib/defi/morphoBlueBase.js` is intentionally limited to:

1. chain/account and on-chain market verification;
2. live USDC balance, allowance, market position, and supply-share reads;
3. exact-amount approval followed by `supply(marketParams, assets, 0, owner)`;
4. explicit-amount or share-based max `withdraw(..., owner, owner)`;
5. post-mining receipt status, `Supply`/`Withdraw`/`Approval` event, market ID,
   owner/receiver, exact amount, and position-transition verification.

Wallet signing remains in the UI execution boundary. Account and chain are
rechecked immediately before each signature. A user rejection is not recorded
as a protocol revert. Timeout, replacement/cancellation, failed receipt, and
protocol/event mismatch remain distinct recovery states. A withdraw/revoke plan
is not dependent on the supply flag or the data feed.

## Rollout gate

Do not call this production-ready or enable public capital until all of the
following have evidence:

- unit tests for market tuple matching, exact calldata, cap/balance/gas checks,
  max withdrawal, wrong chain, event mismatch, receipt failure, and partial
  approval recovery;
- a Base mainnet fork probe run with `--strict`, including approval, supply,
  receipt/event/position verification, withdraw, reload/recovery and rejection
  paths;
- a non-empty address allowlist in the actual web/APK build, checked after
  build-time defines are applied;
- review of this mapping against the official Morpho API and address resource;
- no reward path is shown as implemented: this scope has no Morpho reward
  claim operation.

The public `build:full` remains capital-path-off. The guarded rollout command
requires explicit strict-fork evidence and a non-empty allowlist for every
money-moving canary configured in that build.
