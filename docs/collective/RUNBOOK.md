# FBT AI Collective v1 — environment and deployment runbook

## Safety gate: current status

**Do not deploy or fund this module from this repository state.** This is a local/test implementation only. It has no verified Robinhood Chain deployment address, accounting-token address, oracle implementation, ERC-4626 strategy address, production RPC endpoint, production deployment block, independent audit, or deployment authorization. The repository's mention of chain id `4663` is not verification of any asset or protocol.

The following steps describe the future operational sequence. They are not a deployment script and do not authorize mainnet transactions.

## Local build and tests

Requirements: the repository's supported Node.js version (package engines require Node `>=20`) and npm. The current sandbox used Node `v22.22.3`.

```sh
npm ci
npm run compile:collective
node test/collective/contract-probe.mjs
node --test test/collective/api.test.mjs
npm run build
```

`npm run test:collective` runs the Solidity compile, the local Ganache probe and the API tests in one command. The probe uses local mock tokens/oracles/strategy only. Never copy mock addresses into a live configuration.

The main frontend build also calls existing repository vendor scripts and `scripts/assetlinks.mjs --ensure`. Android association output requires the real Play App Signing fingerprint in `FBT_ANDROID_SHA256`; do not invent a fingerprint to silence that warning.

## Read-only server configuration

All values are blank/disabled in `.env.example` intentionally. Configure only after independent verification:

```dotenv
COLLECTIVE_READS_ENABLED=true
COLLECTIVE_CHAIN_ID=4663
COLLECTIVE_RPC_URL=https://<verified-read-only-rpc>
COLLECTIVE_FACTORY_ADDRESS=0x<verified-deployed-factory>
COLLECTIVE_ASSET_ADDRESS=0x<verified-accounting-token>
COLLECTIVE_DEPLOYMENT_BLOCK=<factory-creation-block>
COLLECTIVE_EVENT_MAX_BLOCK_SPAN=20000
COLLECTIVE_ALLOW_LOCAL_RPC=false

COLLECTIVE_KEEPER_ENABLED=false
# Only in a deployment secret manager; never in source, browser config or logs:
COLLECTIVE_KEEPER_PRIVATE_KEY=
```

Rules:

1. `COLLECTIVE_CHAIN_ID` is pinned to `4663`; the reader checks the RPC chain id.
2. The reader requires factory and asset bytecode and checks `factory.usdt()` equals `COLLECTIVE_ASSET_ADDRESS`.
3. `COLLECTIVE_DEPLOYMENT_BLOCK` anchors bounded event scans. It must be the verified factory creation block. Event spans are capped by code; do not bypass the cap with a proxy or alternate route.
4. The public config response never includes the RPC URL or keeper key. Check this property before any API deployment.
5. Remote RPC endpoints must use HTTPS. `COLLECTIVE_ALLOW_LOCAL_RPC=true` only relaxes that check for loopback hosts (`localhost`, `127.0.0.1`, `::1`) and must not be set in production.
6. `COLLECTIVE_READS_ENABLED` only enables a verified read path. It does not deploy a vault, create an investment strategy, or make assets safe.
7. The API has GET-only Collective routes. There is no server signing or transaction broadcast endpoint.
8. Use a read-only RPC credential. Respect the provider's rate limits and privacy terms; do not place the credential in `VITE_*` or any browser bundle.

After setting read configuration on a non-production environment, verify:

- `GET /api/collective/status` reports `ready: true`, chain id 4663 and matching factory/asset verification.
- `GET /api/collective/vaults` returns only factory-registered vault addresses.
- `GET /api/collective/vault/:address` reads expected accounting, strategy target, epoch and risk policy directly from the configured chain.
- `GET /api/collective/vault/:address/events` rejects ranges outside the configured deployment/head/span.
- No public response includes RPC credentials, keeper key, signing material or private data.

If any value is missing, mismatched or stale, keep reads disabled and investigate. Do not replace a failed check with a manually typed symbol, explorer label or guessed address.

## Deployment order (future, after audit and approval only)

No production deployment script is supplied. Deployments must be prepared and independently reviewed by the contract/security operators using a pinned, verified compiler and multisig procedure.

1. Select and verify the actual Robinhood Chain accounting token, its decimals/transfer semantics and administrative controls. Do not infer it from `USDT` ticker text.
2. Select a production price oracle and liquidity oracle implementing `ICollectivePriceOracle` and `ICollectiveLiquidityOracle`. Verify feed sources, freshness, decimals, update authority, outage behavior and manipulation resistance. `MockCollectiveOracle` and `MockCollectiveLiquidityOracle` are test-only.
3. Independently review the exact ERC-4626 target address, its implementation/proxy, underlying asset, deposit/withdraw/redemption behavior, maxWithdraw reporting, fees, pause/admin controls and liquidity. `Mock4626Strategy` and `MockSlippage4626` are test-only.
4. Prepare a governor multisig, a separately controlled guardian and an isolated keeper key/account. No key should be shared with the website/API.
5. Deploy and verify, in dependency order: `AccessController`; `EmergencyModule`; production oracle contracts; `RiskController`; `ExecutionRouter`; `StrategyVaultDeployer`; `CollectiveModulesDeployer`; `CollectiveFactory`.
6. Bind the exact factory once on both deployers with `setFactory(factoryAddress)`. Because this is one-time, verify all constructor addresses and the factory bytecode before sending either transaction.
7. Through the multisig, grant `FACTORY_ROLE` to the factory, `EXECUTION_ROUTER_ROLE` to the router, and `KEEPER_ROLE` only to the approved keeper(s). Verify `GOVERNOR_ROLE` and `GUARDIAN_ROLE`. Do not give the AI service a role.
8. Queue and, after the configured policy delay, execute the accounting-asset and ERC-4626 protocol allowlists, stable-yield kind activation and approved expense-recipient allowlist. Review every transaction and event before execution.
9. Create one stable-yield vault with explicit `Limits`: max trade USD E8, transaction-cost ceiling, minimum target liquidity, allocation/concentration caps, slippage bps, reserve bps, max oracle age and `enabled=true`. Factory v1 rejects farming/LP and trading kinds.
10. Verify the resulting `CollectiveVaultCreated` event and every deployed child address; read code/immutables; test the first cohort, first epoch, settlement, separate claims, FIFO queue, partial liquidity and pause/resume with a small controlled rehearsal before any broader launch.
11. Configure read-only API variables only after the deployment and deployment block have been independently checked. Keep keeper execution disabled until a separate operations review.

**Do not improvise missing production oracle implementations, limits or addresses.** The deployment is not ready until the dedicated oracle/adapter code and independent review exist.

## Epoch and liquidity semantics

The v1 epoch is rolling 30 days (not a calendar-month boundary). Deposits stop when an epoch starts. Principal requests can be queued after the 30-day end even if income settlement is waiting; after settlement, deposits and principal requests are open for up to seven days. Settlement is deliberately blocked until all ERC-4626 strategy shares have been exited, so profit realized after a snapshot cannot be handed to a new cohort. An illiquid or failed target can therefore delay settlement, the next deposit window and queue payments indefinitely. This is a safety/accounting condition, not a maturity promise. Test it on the exact target before deployment and disclose it to users.

## Keeper operation

Dry-run is the default:

```sh
npm run keeper:collective
```

The script reads all configured vaults, emits bounded deterministic proposals and performs no transaction. Before any later execution, review the proposal against current chain state, risk policy, gas estimate, signer balance, keeper role, incident status and multisig operations policy.

The execution mode requires both:

```sh
COLLECTIVE_KEEPER_ENABLED=true npm run keeper:collective -- --execute
```

The private key must be injected by a secret manager into the process environment; do not place it in `.env.example`, source, CI output, shell history, client bundles or application logs. The key should be unique, monitored, funded only for limited gas, and restricted to the on-chain keeper role. Test key rotation and emergency revocation before production. The script itself is not a managed, continuously supervised service.

Transactions on the chain require gas. In execution mode the keeper account pays keeper gas. User deposits, claims and withdrawal requests are sent by the user's wallet, which pays user gas. A relayer/paymaster can sponsor gas only by transferring that cost to another funded operator; it does not make transaction execution free.

## Economics and costs

- No company investment principal is programmed or supplied by this module.
- No guaranteed APY/return or capital protection is promised.
- Every public-chain user transaction consumes gas. Users can be made the payer (current design) or an approved sponsor can pay through a separately designed relay; either way someone pays.
- Public RPC, monitoring, audits, incident response and keeper operations may also have costs. “No company principal” is possible; “fully operational at zero cost” is not a reliable public-chain operating model.
- The current dashboard intentionally discloses user-paid gas, variable returns, potential principal loss, queued withdrawals and lack of independent audit.

## Rollback / incident response

1. Guardian calls `EmergencyModule.pause(code,evidenceHash)` and captures transaction hash and incident id. The pause is global to this Collective deployment.
2. Stop keeper execution and preserve logs, proposals, configuration versions and RPC/provider health evidence. Never expose secret values.
3. Determine whether the issue is a stale oracle, target behavior, asset transfer, queue liquidity, role compromise, RPC/API issue or contract issue. Do not send additional deposits to “test” a live failure.
4. Governor records a resolution hash for the current incident only. `resume` rejects an older incident id, but the governor decision still needs multisig review.
5. Keep public deposits disabled until incident review, remediation, tests and authorization complete. Existing claims/funded queue payments may remain available if the contracts allow them; do not promise that strategy liquidity can be recovered.
6. If a token, target or vault is compromised, there is no privileged rescue/sweep function. Any recovery plan must be specific to the verified contracts and independently reviewed.

## Rollout checklist

- [ ] Independent Solidity audit delivered; critical/high findings resolved and re-tested.
- [ ] Exact chain id, RPC, token, oracle, target, deployer/factory bytecode and deployment block verified by a second operator.
- [ ] Governance multisig, guardian, keeper role and key-revocation drills complete.
- [ ] Testnet rehearsal covers first cohort, 30-day settlement, income claims, transfer/remainder rounding, expense recipient binding, partial queue payments, stuck FIFO head, stale oracle, slippage bound, token transfer fee, policy timelock, pause/resume and role changes.
- [ ] Production limits and all off-chain disclosures approved by legal/risk/operations owners.
- [ ] Read-only API passes no-secret checks and event-index bound checks.
- [ ] Keeper remains dry-run by default; execution is enabled only with separate explicit approval.
- [ ] Users are told they can lose principal, withdrawals are not instant, returns are variable, and user gas is required.
- [ ] No farming/trading lane is activated from the v1 contracts.
- [ ] Deployment/funding approval is explicit and separately recorded; this code change is not such approval.
