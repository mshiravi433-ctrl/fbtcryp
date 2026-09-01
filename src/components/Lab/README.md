# Lab v2 — Financial Simulation Center

A self-contained practice environment where users learn trading, investing,
and DeFi mechanics without risking real money. Lives at `/lab`.

## What is here

| Group       | Card             | Purpose                                                  |
|-------------|------------------|----------------------------------------------------------|
| Practice    | 🔮 Prediction    | Up/down calls vs an AI heuristic, scored on accuracy    |
| Practice    | 📈 Paper Trading | Real position lifecycle with SL/TP and a risk score     |
| Practice    | 💰 Investment Sim| Build a portfolio, run it over 1d/1w/1m/3m/1y            |
| Learn       | 🎯 Challenges    | "BTC -18%, what do you do?" with a consequence          |
| Learn       | 🧠 Lessons       | One-question quizzes with explanations                   |
| Learn       | 🛡️ Risk Trainer  | Interactive R:R + position size calculator              |
| Advanced    | 🧪 Strategy Lab  | Rule-based strategy builder with deterministic backtest |
| Advanced    | 🏦 DeFi Lab      | Lend, borrow, LP (with IL), farm, stake                  |
| Advanced    | 🧩 What-If?      | Apply a basket of shocks to a portfolio                  |
| More tools  | ⚖️ Compare       | Portfolio A vs Portfolio B                               |
| More tools  | 🏆 My Level      | XP, level, badges                                        |
| More tools  | 🎖️ Leaderboard   | Virtual ranking with the user row injected              |

## Architecture

```
src/
├── store/useLabStore.js          Zustand store, persisted to localStorage under fbt-lab-v1
├── lib/lab/
│   ├── engine.js                 Pure math: backtest, R:R, IL, what-if, LP
│   ├── scenarios.js              Scenarios (5), lessons (8), AI coach strings
│   └── marketData.js             Hybrid: real CoinGecko prices → mock fallback
├── components/Lab/
│   ├── Shared.jsx                Header, Panel, Row, AICoach, ResultCard, Sparkline, etc.
│   ├── PracticeGroup.jsx         Practice group of 3 cards
│   ├── LearnGroup.jsx            Learn group of 3 cards
│   ├── AdvancedGroup.jsx         Advanced group of 3 cards
│   ├── PredictionCard.jsx        Predict screen
│   ├── PaperTrade.jsx            Paper trading screen
│   ├── InvestmentSim.jsx         Investment simulator
│   ├── Challenges.jsx            Market challenges
│   ├── Lesson.jsx                Interactive lessons
│   ├── RiskTrainer.jsx           R:R calculator
│   ├── StrategyLab.jsx           Strategy builder + backtest
│   ├── DeFiSim.jsx               DeFi primitives
│   ├── WhatIf.jsx                What-if scenarios
│   ├── ComparePortfolios.jsx     A vs B
│   ├── LevelSystem.jsx           XP, level, badges
│   └── Leaderboard.jsx           Virtual ranking
├── pages/Lab.jsx                 The single page that hosts all of the above
└── styles/lab-v2.css             Lab v2 styles (lab2- prefix; never collides with the
                                  older lab-modern.css that the original Predict/Invest
                                  screens still use)
```

## Persistence

Everything (balance, XP, predictions, trades, strategies, etc.) lives in
`localStorage` under the single key `fbt-lab-v1`. **The server never sees a
Lab row** — the hosting tier is a free one with a tight quota, and the Lab
deliberately stays client-only so the free tier does not have to budget for
it. The `partialize` selector in `useLabStore.js` drops derived getters from
the persisted blob so the saved payload is just the user's data.

## Determinism

- `lib/lab/engine.js` uses seeded pseudo-random generators, so the same
  backtest with the same rules gives the same numbers. A user can share
  a strategy and the recipient sees the same chart.
- `lib/lab/marketData.js` falls back to a deterministic minute-bucketed
  price walk when CoinGecko is unreachable. The numbers wobble by ~1% per
  minute, so the chart looks "live" without the API cost.

## Adding a new sub-screen

1. Write the component under `src/components/Lab/`.
2. Add it to the appropriate group's `CARDS` array in
   `PracticeGroup.jsx` / `LearnGroup.jsx` / `AdvancedGroup.jsx`.
3. If the screen needs persisted state, add a field to `useLabStore.js`.
   The store is the single source of truth — do not call `localStorage`
   directly from a component.
4. Use the shared `Panel`, `Row`, `AICoach`, `ResultCard` from
   `Shared.jsx` so the visual language stays consistent.

## Constraints that shaped the build

- **No real money, ever.** Same as the main app's Predict/Invest — see
  the long note at the top of `useAppStore.js`. The Lab is a simulator
  wrapped in a UI; if anyone ever wires real funds into it, they need a
  financial-services licence and a server. Don't.
- **No network round-trips for math.** All P&L, IL, Sharpe, etc. are
  computed in `lib/lab/engine.js`. The only network call is for live
  prices, and it gracefully falls back to a deterministic mock.
- **No backend.** Every leaderboard entry besides "You" is a static
  calibration row. The leaderboard is a UX cue, not a real ranking.
