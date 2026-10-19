# FBT AI Collective — v1 implementation record

## Status

This is an additive, **non-deployed** public-vault module. It is not an audit, a production launch approval, or evidence of a live Robinhood Chain vault. No production addresses, oracle, stablecoin contract, ERC-4626 strategy, or deployment block were available to verify in the repository. Reads and keeper execution are disabled by default.

The deliverable currently implements the **stable-yield lane only**. Farming/LP and approved-token trading are surfaced as disabled, and the v1 factory rejects those vault kinds. The `ExecutionRouter` and policy hooks are a constrained foundation for a separately reviewed future release; they are not an enabled user product. Do not activate those lanes by changing a flag or granting a role.

## Repository integration

The existing `/vault`, Earn, More, wallet, and other screens remain in place. The new dashboard is mounted at `/#/collective` and linked from More → Earn. It uses the repository's existing wallet context and `WalletConnectSheet`.

```text
contracts/collective/
  AccessController.sol       governor / guardian / keeper / factory roles
  CollectiveDeployers.sol    split deployers to fit the EIP-170 bytecode limit
  CollectiveFactory.sol      isolated stable-yield vault creation; other kinds rejected
  EmergencyModule.sol        global pause and current-incident resolution
  EpochManager.sol           rolling 30-day periods; seven-day subscription window
  ExecutionRouter.sol        narrow V2-style future trading surface; not enabled in v1
  RewardAccounting.sol       fixed-point realized-income allocation and claim math
  RiskController.sol         delayed allowlists, risk limits, oracle and liquidity gates
  StrategyAdapter.sol        one fixed ERC-4626 target per vault; bounded slippage
  StrategyVault.sol           ERC-4626 share accounting, income claims, expenses, exits
  WithdrawalQueue.sol        FIFO, partial, liquidity-aware principal payments
  interfaces/ICollective.sol shared contract interfaces
  mocks/CollectiveMocks.sol  local-only test assets, target, oracles and router

server/collective/
  abi.js config.js           narrow read ABIs and fail-closed environment parsing
  indexer.js reader.js       bounded public event scans and on-chain snapshots
  routes.js                  GET-only /api/collective routes; no-store responses
  strategyPolicy.js          deterministic, read-only bounded proposal planner
scripts/collective-keeper.mjs  one-shot keeper; dry-run unless separately enabled
src/lib/collective/
  abi.js api.js constants.js wallet-signed transaction helpers
src/pages/Collective.jsx      additive dashboard, disclosures and user actions
src/styles/collective.css     route-scoped responsive and light-theme styles
test/collective/
  contract-probe.mjs           local Ganache accounting / authorization regressions
  api.test.mjs                 config, policy, event-indexer and HTTP tests
scripts/compile-collective.mjs pinned local Solidity compile and EIP-170 checks
```

## Architecture and boundaries

```text
User wallet ── exact approval + signed deposit/claim/request ──> StrategyVault
                                                                  │
                         fixed ERC-4626 target <── StrategyAdapter┘
                                                                  │
                                  EpochManager / RewardAccounting ┘
                                                                  │
                  WithdrawalQueue <── fixed principal liability ──┘

Browser ── same-origin GET /api/collective/* ──> Express reader ──> configured RPC
   │
   └── no server transaction/broadcast endpoint

Deterministic policy planner ── bounded proposal ──> opt-in keeper signer
                                                      └── on-chain checks run again
```

- A factory-created vault has one accounting asset and one immutable ERC-4626 target. Vaults do not share balances or liabilities.
- Deposits are available only before the first epoch starts and in the seven-day post-settlement subscription window. Principal requests open when the 30-day period ends and stay open through settlement plus its seven-day window. Epochs are rolling 30-day periods, not calendar months.
- The vault requires every strategy share to be exited before settlement. This prevents profit realized after settlement from being attributed to a new depositor cohort; if the target is illiquid or broken, settlement and the next subscription window can be delayed. A settled income snapshot uses historical shares. Only realized net gains, after accrued loss recovery, the disclosed reserve, and approved expenses accrued before settlement, can become a separate income liability. Pre-settlement expenses consume unallocated realized income first; any excess reduces shareholder NAV. Unrealized appreciation stays in NAV. Income claims and principal requests are different transactions and accounting buckets.
- A principal request burns shares and records the request-time redemption estimate as a FIFO liability. Payments may be partial and wait for strategy liquidity. Later strategy P/L can leave the fixed queue liability underfunded; this is not instant liquidity or principal protection.
- The on-chain risk controller checks asset/protocol allowlists, oracle freshness, per-trade value, total strategy allocation/concentration, gas-cost ceiling, reported target liquidity and emergency state. The adapter compares ERC-4626 quote/actual share and exit amounts against the configured slippage bound. The target is still an external trust dependency.
- The planner cannot sign or construct arbitrary target calldata. Keeper actions are a fixed allowlist and on-chain roles/policy are authoritative. The HTTP API never receives or stores a signing key.
- The contracts contain no generic call, arbitrary target selection, admin sweep, or rescue function. This reduces arbitrary token movement but means mistaken or blacklisted assets may be unrecoverable.

## Acceptance coverage and deliberate limits

| Requirement | v1 status |
| --- | --- |
| Isolated, user-funded stable-yield vault | Implemented in contracts; not deployed |
| Company principal | None supplied by this implementation |
| Separate realized-income claims | Implemented, snapshot-based, independently tested |
| Monthly settlement | Rolling 30-day epochs; settlement requires full strategy exit and can be delayed by liquidity; not calendar months |
| Deposits / request windows | Deposits: seven days after settlement; principal requests: after period end through seven days after settlement; first cohort stays open until epoch one starts |
| Principal withdrawal queue | FIFO, partial funding, principal-only payout; not instant |
| Stable strategy | One immutable allowlisted ERC-4626 target per vault |
| Risk/oracle/liquidity/slippage/emergency controls | On-chain gates exist; production oracle/target configuration is absent |
| Farming / LP | Disabled; no production accounting adapter |
| Approved-token trading | Disabled; do not deploy/activate the incomplete future lane |
| AI/Keeper | Deterministic read-only proposal planner; keeper is opt-in and user-independent only for authorized fixed calls |
| Public dashboard / API | Additive route and read-only same-origin API; configuration required |
| Zero company-funded principal | Compatible with this implementation |
| Zero gas or operating expense | Not possible for public chain transactions; callers and operators pay their own gas/service costs |
| Independent audit | Not performed |
| Mainnet deployment / real funds | Not performed; explicit approval and verified configuration still required |

## Local verification

Most recently run:

- `npm run test:collective` — **passed**. `solc 0.8.24` compiled all 13 Collective sources; 19 local Ganache assertions and 5 API/config/policy/indexer/router/integration tests passed. `StrategyVaultDeployer` is 24,564 bytes against EIP-170's 24,576-byte limit (12 bytes of margin); preserve the pinned compiler/settings and re-check size after any Solidity change.
- `npm run build` — **passed**. The Collective JS/CSS chunks built and the first-paint bundle check reported 1,690 KiB against a 1,700 KiB budget. Existing warnings remain for Android `assetlinks.json` (no real `FBT_ANDROID_SHA256` was supplied), vendor bundles, duplicate imports and large chunks.
- The locale check found `nav.collective` in all 12 shipped locales. The broader repository wiring audit returned 2,836/2,881 checks; 45 existing checks still fail, none identifying the Collective route/page/translation integration. Review those against the project's baseline; this is not a full-repository pass.

Ganache fell back to its JavaScript implementation because the optional µWS native binary was missing. No public chain, deployment or real asset was used by these tests. The contracts have no independent security audit or production configuration; this source alone is not a live Collective deployment.

## Change stages

1. Add isolated contracts and local mocks; compile and EIP-170 review.
2. Add read-only server configuration, reader, bounded event indexing and proposal policy.
3. Add opt-in keeper and tests; no write/broadcast API.
4. Add relative-URL wallet client, a new dashboard route, More-menu link and localized disclosures.
5. Run local compile, Ganache/API tests and frontend build.
6. **Not done:** chain-address verification, audit, deployment rehearsal, deployment approval, mainnet deployment, funding, user-asset activation or merge to `main`.

See [Threat model](THREAT_MODEL.md) and [Environment/deployment runbook](RUNBOOK.md) before any future deployment work.
