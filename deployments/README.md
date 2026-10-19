# Public deployment records

This directory holds **public, secret-free** deployment records written by
`scripts/collective-deploy.mjs` after a live activation, for example
`collective-4663.json`.

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

`.github/workflows/collective-activation.yml` commits `collective-4663.json` only after
`collective-activate.mjs --check` has passed **and** the record was marked
`verified`. The API then reads those addresses, the deployment block and the
public RPC from the committed evidence (`server/collective/activation.snapshot.js`),
so the live site turns on with no Vercel environment change.

Guards that always win:

- an explicit `COLLECTIVE_READS_ENABLED=false` disables the automatic path;
- any explicit `COLLECTIVE_*` environment value overrides the record;
- a record with `verified !== true`, a different chain id, a non-HTTPS or
  credential-bearing RPC URL, or missing addresses is ignored entirely.

The record is public by design: addresses, block numbers and timestamps only.
The deploying key is never part of it and is never written to disk.
