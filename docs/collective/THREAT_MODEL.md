# FBT AI Collective v1 — threat model

## Assets and invariants

- User-deposited accounting tokens and vault shares.
- Realized-income liability, fractional claim remainders and historical eligibility snapshots.
- FIFO withdrawal liability, risk reserve and accrued operating expenses.
- Strategy-adapter position and governance/keeper/guardian authority.
- Integrity of the configured chain, factory, accounting asset, ERC-4626 target, price oracle and liquidity oracle.

Invariants intended by the code:

1. Principal and income are not interchangeable: income claims and queued principal use distinct liabilities.
2. No depositor receives shares at a post-deposit NAV calculation that includes their own transfer.
3. Approved expenses recorded before settlement reduce unallocated realized income before distribution; costs above pending income reduce shareholder NAV.
4. Mid-epoch deposits are closed; only historical snapshot holders earn that epoch's realized income.
5. Queue payments come only from idle funds remaining after income, accrued-income, expense and reserve obligations. Requests are FIFO and may be partially paid.
6. No user withdraws synchronously through ERC-4626 `withdraw`/`redeem`.
7. Strategy calls use one fixed allowlisted ERC-4626 target, exact approvals, bounded quote/actual slippage and fail-closed risk/oracle checks.
8. The API is read-only. The planner has no signer. Keeper execution is separately enabled and still passes the on-chain policy.
9. No company principal is seeded by this code. This does not remove gas or operations costs.

## Actors and trust boundaries

- **Depositor/claimant:** can deposit only during an open window, request queued principal in its window and claim separately. Pays transaction gas.
- **Keeper:** can call a limited action surface. For `invest` and strategy exit, requires the keeper role. Cannot change allowlists/limits or select arbitrary recipients/targets.
- **Guardian:** can pause the shared Collective immediately. Cannot resume.
- **Governor:** expected to be a multisig. Can queue delayed allowlist/limit changes, accrue/pay capped approved expenses, rotate guardian and propose a delayed two-step governor handoff. A compromised governor can still change trusted parameters and is a critical residual risk.
- **Read API/RPC:** supplies display and planning data only. The UI does not treat it as execution authority. RPC credentials are server-side and omitted from public configuration responses.
- **ERC-4626 strategy, accounting asset and oracles:** external contracts/observations. They must be independently reviewed and chain-verified; code allowlisting alone is not proof of safety.

## Threats and mitigations

| Threat | Intended mitigation | Residual risk / open work |
| --- | --- | --- |
| Keeper submits arbitrary calldata or steals assets | Fixed adapter target; narrow vault methods; keeper role; no arbitrary-call/rescue surface; on-chain checks repeat | Malicious target/oracle or contract bug can still cause loss. No independent audit. |
| Compromised or malicious AI service signs transactions | Planner is deterministic/read-only; `aiCanSign=false`; API has no broadcast/private-key route | Keeper private key remains a hot operational credential if an operator enables it. Use a separate limited account and secret manager. |
| Replayed or stale keeper proposals | Proposal ids bind vault/epoch/action/amount; router nonce is consumed; current contract policy is re-evaluated | A normal vault method may be called again if its on-chain state permits; each state transition must remain idempotent or time-gated. |
| Stale, missing, future-dated or zero-price oracle observation | Oracle timestamp and nonzero price required; freshness window bounded; failures revert | Oracle correctness, manipulation resistance, stablecoin depeg risk and admin controls are configuration/audit dependencies. |
| Illiquid ERC-4626 strategy | Invest gate checks target-reported max-withdraw liquidity; requests queue FIFO; exits can be partial; a public keeper path can raise liquidity for queued requests; settlement requires all strategy shares exited so a later cohort cannot inherit earlier realized income | `maxWithdraw` is the protocol's own report, not a guarantee. Strategy redemption, settlement and the next subscription window can be delayed indefinitely; the FIFO head is never skipped. |
| Slippage / ERC-4626 share-price or fee behavior | Previewed share amount checked against actual minted shares; withdrawal/liquidation receipt checked against slippage bound | A malicious or noncompliant target may lie in previews; approved target requires code and economic review. No target address is provided here. |
| Fee-on-transfer / rebasing accounting token | Deposit, claim, queue payment, expense payment and adapter transfers require exact deltas; unsupported transfer behavior reverts | Token behavior can change through proxy/admin upgrade; verify implementation and upgrade authorities. |
| NAV manipulation or unrealized income distributed | Income only from realized adapter P/L; loss carry is recovered before positive income; snapshots use historical balances | ERC-4626 `convertToAssets` may be manipulable or stale. A compromised target can misstate NAV. |
| Income/principal double spend | Separate `incomeLiability`, `withdrawalLiability`, expenses and risk reserve; queue payment excludes protected buckets | Logic is complex fixed-point accounting and needs independent audit, invariant/fuzz testing and formal review. Dust may remain reserved. |
| Expense paid to wrong recipient | Per-recipient accrual ledger, allowlist and per-epoch hard cap; pre-settlement costs consume unallocated realized income before it is distributable | Governor can approve a bad recipient or create an expense; costs beyond pending realized income reduce shareholder NAV. Audit the recipient/expense policy before activation. Company expenses are not a promise of zero user-paid costs. |
| Old emergency incident unpauses a new incident | Resolve and resume require the current incident id; governor must document current resolution | Governor key compromise can resume after a false resolution. Emergency pause is global to all Collective vaults. |
| Role compromise / unsafe role transition | Governor-controlled role grants; governor/guardian cannot be generically revoked; delayed two-step governor transfer; policy timelock | Governance remains trusted. No on-chain timelock for every keeper/role grant, so multisig/operational controls matter. |
| Queue griefing or blacklisted recipient | FIFO, partial payments, no skip; all payments are explicit events | A head recipient whose asset transfer always reverts can block later users. A future version needs a carefully audited cancellation/skip design, not an ad hoc admin bypass. |
| Reentrancy / token callback | OpenZeppelin `ReentrancyGuard`, `SafeERC20`, exact limited interactions | Reentrancy review is not a substitute for audit; composability of the external target remains relevant. |
| RPC/API data spoofing or leak | Same-origin GET API, bounded scans, no-store, address/chain/code/factory-asset verification, no private-key endpoint | RPC can censor or return stale data; monitor multiple independent endpoints before deployment. The app currently supports one configured reader. |
| Wrong chain/token/strategy configuration | No hard-coded deployment address; chain-id, code, asset match checks; reads and keeper disabled by default | Correctness still depends on operator verifying the actual addresses, oracle implementation, deployment block, bytecode and protocol docs. |
| Gas spikes / transaction cost | On-chain gas-cost ceiling uses a fresh native price; caller signs each transaction | Transactions can fail when gas/oracle data is unavailable. Public users pay gas; a relayer would shift costs to its sponsor, not eliminate them. |
| Farming/trading module is activated prematurely | Factory v1 accepts stable-yield only; dashboard labels later lanes disabled | ExecutionRouter is only a foundation. Do not register a non-stable vault or enable a later lane without new accounting, code, tests, audit and explicit release. |

## Failure and recovery behavior

- Missing configuration, unavailable RPC, wrong chain, missing code, asset mismatch, stale prices, invalid target or unapproved policy should fail closed.
- A guardian pause blocks deposits and investment/swap actions. Claims and already-funded FIFO payments remain possible. An emergency pause does not guarantee an immediate principal exit.
- If the strategy is illiquid, queued principal remains a liability until cash arrives. It can remain unpaid indefinitely. Because settlement requires a full strategy exit, the next deposit window and income settlement can also be delayed indefinitely. Do not market the queue or settlement as a maturity guarantee.
- If target valuation or asset transfer is non-standard, transactions may revert; no privileged rescue path is included. This is intentional fail-closed behavior but can make a configuration error irreversible.
- A withdrawal request is priced using the current vault preview at request time and burns shares. Later realized losses may leave the queue underfunded; later gains do not automatically reprice the fixed request. The remaining vault shareholders absorb later NAV changes.

## Required independent review before any public funds

1. Independent Solidity audit and remediation verification; do not label this code audited before that is complete.
2. Fuzz/invariant testing over deposits, transfers, epochs, claim batches, fractional remainder, expenses, loss carry, partial queue payouts, paused transitions and target failures.
3. Independent chain verification of chain id, token implementation/proxy admin, factory/deployer bytecode, oracle code/feed configuration, strategy target code, target asset, liquidity behavior and explorer links.
4. Rehearsal with a multisig and separate guardian/keeper on a test deployment; role-recovery drill; pause/resume drill; queue-underfunding drill; stale-oracle drill.
5. Economic review of every risk limit, expense cap, reserve, target exit fee, queue policy and prospective user disclosure.
6. Explicit operator approval for any deployment or funding. This repository change does not grant that approval.
