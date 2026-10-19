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
