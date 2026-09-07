# Future FBT Protection Pool

Pool status is `DISABLED_PENDING_LEGAL_SECURITY_REVIEW`. `ProtectionPoolAccounting` tracks capital, reserves, premiums, claims, utilization, loss and solvency. `PoolSolvencyEngine` pauses new coverage below the configured reserve threshold while existing contractual policies remain subject to their terms.

Future modular contracts should separate pool, policy, router, treasury, reserve, claims and registry responsibilities, with OpenZeppelin access control, pause, reentrancy protection, SafeERC20, replay/deadline checks, role separation, multisig and timelock. No APY, return, payout or legality is promised.