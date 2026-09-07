# Protection risk engine

The engine consumes wallet-supplied, verifiable exposure records: chain, protocol, contract, asset, LP/lending/bridge/oracle dependencies and amount. It returns per-kind risk bands, portfolio risk, eligible exposure, existing coverage and a coverage gap. It recommends only; it cannot sign or buy. Missing balances are not invented.