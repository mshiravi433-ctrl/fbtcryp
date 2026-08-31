# Smart Money — FBT On-Chain Intelligence Layer

Tracks smart money behaviour: whales, active wallets and liquidity flow **before
the effect is obvious in price**. Everything is derived from **real on-chain /
market data**. There is no mock data, no hard-coded stats and no fake address
labels — when a data source is missing, the metric reports `unavailable`
rather than inventing a number.

> **This is not a buy signal, not a profit guarantee and not insider
> information.** It is **on-chain signal · behaviour · activity · risk · flow**.
> Confidence is the strength of a pattern in observed data, never a price
> prediction. The AI always separates **observed data**, **inference** and
> **prediction**.

## Structure

```
Smart Money
├── Overview        headline metrics, accumulation ranking, flows, early feed
├── Whales          large wallets ranked by observed transfer volume
├── Smart Wallets   behaviour-classified wallets (smart / whale / early …)
├── Token Intel     per-token holders, buyers/sellers, accumulation, liquidity
├── Money Flow      CEX inflow/outflow, exchange registry, liquidity movement
└── Alerts          tracked-wallet whale alerts
```

## Data sources (all real, key-optional)

| Need | Source | Key required |
|------|--------|--------------|
| Large transfers / whale events | chain RPC + Etherscan-family explorers (`server/whales.js`) | optional (denser with key) |
| Token pairs, liquidity, volume, age | DexScreener | no |
| Address history, balances, holders | Blockscout (keyless) + explorer key | no (denser with key) |
| Prices | CoinGecko (`server/providers.js`, shared) | optional |
| Solana wallets/transfers | public Solana RPC + Solscan | no (denser with Solscan) |

Sources are isolated in `server/smartMoney/dataSources.js` behind a fetch seam
(`__setFetchForTests`) and every call fails closed: an upstream outage returns
`{ dataStatus: 'unavailable' }`, never a fabricated value.

## Exchange Wallet Registry (`registry.js`)

Only addresses from credible public sources (persistent explorer name-tags /
exchange disclosures) with a recorded `source` and `confidence` are ever
labelled as exchange inflow/outflow. DEX routers/factories are used to classify
buys/sells and liquidity events. Unrecognised counterparties stay **Unknown**.

Add new addresses in `server/smartMoney/registry.js` — never guess a label.

## Scores (computed server-side; the AI only explains)

- **Smart Money Score** — profitability, consistency, early entries, risk-adjusted
  return, liquidity awareness, holding quality (weighted, documented).
- **Reputation** — historical performance, consistency, realised P&L, win rate,
  holding duration, liquidity awareness, token selection, counterparty/scam risk.
- **Risk** — scam interaction, suspicious contracts, concentration, bridge/CEX
  exposure, leverage, low-liquidity tokens; returns a LOW/MEDIUM/HIGH band plus
  human-readable `+ / −` reasons for the **"Why?"** panel.
- **Accumulation / Distribution** — weighted independent signals
  (net buying, holder growth, smart-money flow, exchange flow, liquidity).
  Thresholds live in `config.js`, never hard-coded in the algorithm.
- **P&L** — realised from transaction history + tx-time prices; unrealised from
  current holdings. Missing history reduces coverage; it is never fabricated.

Each score carries a `coverage` fraction so the UI can say "based on N of M
factors". Wallets are behaviour-tagged (`SMART_MONEY`, `WHALE`, `EARLY_BUYER`,
`PROFITABLE_TRADER`, `HIGH_VOLUME`, `LONG_TERM_HOLDER`, `DEX_TRADER`). The word
**"INSIDER" is never used** — only `INSIDER_LIKE_BEHAVIOR` for behavioural
resemblance.

## API (`/api/v1/smart-money`)

```
GET  /overview?window=24h|7d|30d
GET  /whales?minUsd=
GET  /wallets
GET  /wallet/:chain/:address            (chain = id or "solana")
GET  /wallet/:address                   (auto-detect)
GET  /token/:chain/:address?window=1h|4h|24h|7d
GET  /flows
GET  /liquidity?minUsd=
GET  /exchanges                         (transparent registry manifest)
GET  /early-tokens
GET  /fresh-wallets
GET  /alerts?identity=
POST /alerts/read
GET  /watchlist?identity=
POST /watchlist                         {identity, lang, rows[]}
DELETE /watchlist/:id?identity=
GET  /api/cron/smart-money              (CRON_SECRET; runs alert evaluation)
```

## Alerts

Track a wallet (or token) and pick event types: large buy/sell, transfer,
exchange deposit/withdrawal, new token, liquidity movement, accumulation,
distribution. The server evaluates tracked targets against the live labelled
event stream (`watchlist.js → runAlertCycle`), deduplicates and cooldowns each
alert, and delivers through the **existing** web-push / FCM transport
(`server/push.js`, `server/fcm.js`) — no second notification system. A user
intent like *"tell me if smart money accumulates ETH"* creates a
`SMART_MONEY_ALERT` automation whose action is **NOTIFY** only — the AI never
trades without an explicit, separate user instruction.

## Performance & architecture

```
Data ingestion (RPC / explorers / DexScreener / Blockscout / Solscan)
  → normalize & label (registry)
  → wallet intelligence · token intelligence
  → flow engine → detection engines (accumulation/distribution)
  → risk / reputation scores → alerts → AI explanation
```

- TTL caches (`server/cache.js`) + single-flight; aggregates are materialised
  and shared across requests — a page render never re-reads full chain history.
- Heavy scoring is cached per wallet/token; page targets are cached <1.5s,
  lookups <2s, alerts evaluated on a schedule.
- The frontend client is `src/lib/smartMoneyClient.js`; the page is
  `src/pages/SmartMoney.jsx` (+ `SmartMoneyWallet.jsx`, `SmartMoneyToken.jsx`,
  `src/components/TokenSmartMoney.jsx`). The AI bridge is
  `src/lib/smartMoneyAI.js`, feeding the existing intent-ai smart-money
  evidence adapter.

## Acceptance tests

`test/smart-money-probe.mjs` (registered in `test/run.mjs`) exercises the real
engines, registry labelling discipline, fail-closed data sources, the full API
surface, watchlist persistence and the detect → alert → push cycle.
