# Solana replay-fixture provenance

These payloads are executed Solana mainnet `getTransaction` results imported
for deterministic decoder replay. They are not synthetic transactions. The
only normalization was:

1. unwrap a one-element array or JSON-RPC `result` envelope when present;
2. require the result to contain `transaction` and `meta`;
3. pretty-print the resulting JSON.

No balance, instruction, account or timestamp field was edited.

| Local file | Source repository | Commit | Source path | Licence |
| --- | --- | --- | --- | --- |
| `jupiter-v6-pyusd-usdc-2dyb2hr9.json` | `madlabs-tech/onchain-data-mcp` | `c75576585761360f894cb227244a0ed3b3ba43c5` | `crates/protocols/fixtures/solana/mainnet_jupiter_pyusd_usdc.json` | MIT |
| `jupiter-v6-jup-usdc-5fbwfqrm.json` | `hodgerpodger/staketaxcsv` | `a99acd845a3409aa11d28bd2cb61ae652bea290d` | `src/tests/data/SOL/fetch_tx/wrapper-5FBWfqrMYoYbqq6yBWJUtqbVmCDAcz79M7NrzB1yxNLibzMWjndHsVRvwDMkUNgwr58KdLP7pCBjkwhnHrbTre5k.json` | MIT |
| `jupiter-v6-usdt-usdc-4vug6xbf.json` | `hodgerpodger/staketaxcsv` | `a99acd845a3409aa11d28bd2cb61ae652bea290d` | `src/tests/data/SOL/fetch_tx/wrapper-4vug6xbfY6xpk81oA6p2gJzoA8eb9nowdB3mnNiF97QWiW5cPRXWh3cRutKrGCFbonML7JjLo5xJzuXAntRzN3MZ.json` | MIT |
| `raydium-amm-v4-usdc-3p36wgra.json` | `0xjeffro/tx-parser` | `475b1ebff79a2f41ec966919fdefa01f11f6c5d7` | `solana/data/OKXDEX_commissionSplProxySwap.json` | MPL-2.0 |

Included licence texts:

- `LICENSE-MIT-madlabs-tech.txt` — Copyright (c) 2026 madlabs-tech.
- `LICENSE-MIT-stake-tax.txt` — Copyright (c) 2021, stake.tax.
- `LICENSE-MPL-2.0.txt` — Mozilla Public License 2.0 text from tx-parser.

--- Phase 6 attribution ---
Source: jowency-me/solana-tx-parser (MIT, commit 71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca)
Files: testdata/transactions/swap_titan_2.json, swap_raydium_amm_1.json, swap_raydium_route_1.json, swap_titan_1.json, swap_stabble_1.json, swap_exa6gyh_2.json
Normalization: wire-format base64 via normalizeSolanaWireTransaction in solanaReplay.js
