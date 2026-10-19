# Public deployment records

This directory holds **public, secret-free, chain-specific** deployment records written by
`scripts/collective-deploy.mjs`, for example `collective-4663.json` (Robinhood
mainnet) and `collective-46630.json` (Robinhood testnet). A testnet file is
never a substitute for or overwrite of the mainnet file.

A record contains only:

- chain id and public contract addresses;
- the accounting-asset and strategy-target public addresses;
- the factory deployment block (used to bound public event scans);
- the policy timelock timestamps;
- transaction hashes, block numbers, gas used and the gas payer address.

It never contains a private key, RPC credential, keeper secret or user data.
The deploying wallet's key is read from the environment and is not persisted.

Commit a live record only after `scripts/collective-activate.mjs --check`
passes. Local rehearsal records are written to `test/.out/` and are gitignored.

Never hand-edit addresses into a record to make the dashboard show something:
the API re-verifies bytecode, chain id and `factory.usdt()` on every cold read
and will keep public reads disabled if anything does not match.

## Automatic configuration from the verified record (2026-10-19)

`.github/workflows/collective-activation.yml` commits only the selected chain's
record after `collective-activate.mjs --check` has passed and that exact record
was marked `verified`. The API selects a snapshot entry only when its `chainId`
and `testnet` flag match the selected network. With no explicit
`COLLECTIVE_CHAIN_ID`, the verified snapshot's `defaultChainId` selects the
public site network; a testnet check changes that default to `46630` without
changing the `4663` record. No Vercel RPC/factory/asset environment values are
needed when explicit overrides are absent.

Guards that always win:

- an explicit `COLLECTIVE_READS_ENABLED=false` disables the automatic path;
- an explicit `COLLECTIVE_CHAIN_ID` always wins; the record must match it exactly;
- any explicit `COLLECTIVE_*` environment value overrides the record;
- a record with `verified !== true`, an unknown/mismatched chain ID, a conflicting
  `testnet` flag, a non-HTTPS or credential-bearing RPC URL, or missing addresses
  is ignored entirely.

The record is public by design: addresses, block numbers and timestamps only.
The deploying key is never part of it and is never written to disk.
