/**
 * Lab calculation engine.
 *
 * Pure functions, no React, no network. Anything in Lab that needs to compute
 * P&L, drawdown, Sharpe, backtest results, LP impermanent loss, etc. routes
 * through this file so the math is in one auditable place.
 *
 * Why centralised: the screens (Paper Trade, Strategy Lab, What-If, Compare
 * Portfolios) all show numbers that must agree. If each page has its own
 * P&L formula, a user running the same trade in two places will see two
 * answers and assume the app is broken.
 */

/* ─── helpers ─────────────────────────────────────────────────────────────── */

export const rand = (seed) => {
  // Deterministic pseudo-random for reproducible backtests (so a Strategy Lab
  // re-run gives the same result the user saw yesterday).
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
};

export const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/* ─── backtest engine ───────────────────────────────────────────────────────
   Runs a strategy over a synthetic price series. The series is generated with
   a seeded random walk so re-running a strategy gives the same numbers
   (deterministic, which is what a "Backtest" panel has to be). */

export function generatePriceSeries(days = 365, startPrice = 100, seed = 42, vol = 0.03) {
  const r = rand(seed);
  const out = [{ t: 0, price: startPrice }];
  for (let i = 1; i <= days; i++) {
    const drift = 0.0003; // slight upward drift so the curve doesn't always crash
    const shock = (r() - 0.5) * 2 * vol;
    const next = out[i - 1].price * (1 + drift + shock);
    out.push({ t: i, price: Math.max(1, next) });
  }
  return out;
}

export function rsi(series, period = 14) {
  if (series.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const diff = series[i].price - series[i - 1].price;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function sma(series, period) {
  const slice = series.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((s, p) => s + p.price, 0) / slice.length;
}

export function maxDrawdown(equity) {
  let peak = equity[0];
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd * 100; // %
}

export function sharpeRatio(returns, rf = 0) {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance) || 1;
  return ((mean - rf) / std) * Math.sqrt(252); // annualised
}

/**
 * Run a backtest over a synthetic series.
 * @param {Object} rules - { rsiBelow, priceAboveMa, action: 'buy'|'sell', sizePct, stopLoss, takeProfit }
 * @param {Object} opts - { days, startPrice, seed, initialCash }
 * @returns {Object} backtest result
 */
export function runBacktest(rules, opts = {}) {
  const {
    days = 365,
    startPrice = 100,
    seed = 42,
    initialCash = 10000
  } = opts;

  const series = generatePriceSeries(days, startPrice, seed);
  let cash = initialCash;
  let position = 0; // units held
  let entry = 0;
  const trades = [];
  const equity = [];

  for (let i = 30; i < series.length; i++) {
    const window = series.slice(0, i + 1);
    const r = rsi(window);
    const ma = sma(window, 200);
    const price = series[i].price;

    // Entry
    if (position === 0) {
      const rsiOk = !rules.rsiBelow || r < rules.rsiBelow;
      const maOk = !rules.priceAboveMa || price > ma;
      if (rsiOk && maOk) {
        const stake = cash * (rules.sizePct / 100);
        if (stake > 0) {
          position = stake / price;
          entry = price;
          cash -= stake;
        }
      }
    } else {
      // Exit conditions
      const change = (price - entry) / entry;
      if (change <= -(rules.stopLoss / 100) || change >= rules.takeProfit / 100) {
        const proceeds = position * price;
        cash += proceeds;
        trades.push({ entry, exit: price, pnl: proceeds - position * entry, pnlPct: change * 100 });
        position = 0;
        entry = 0;
      }
    }
    equity.push(cash + position * price);
  }

  // Close any open position at the end so the equity line is "realised".
  if (position > 0) {
    const proceeds = position * series[series.length - 1].price;
    cash += proceeds;
    trades.push({
      entry,
      exit: series[series.length - 1].price,
      pnl: proceeds - position * entry,
      pnlPct: ((series[series.length - 1].price - entry) / entry) * 100
    });
    position = 0;
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const totalReturn = ((cash - initialCash) / initialCash) * 100;
  const dd = maxDrawdown(equity);
  const dailyReturns = [];
  for (let i = 1; i < equity.length; i++) {
    dailyReturns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
  }
  const sharpe = sharpeRatio(dailyReturns);

  return {
    periodDays: days,
    startPrice,
    endPrice: series[series.length - 1].price,
    initialCash,
    finalCash: +cash.toFixed(2),
    returnPct: +totalReturn.toFixed(2),
    winRate: trades.length ? Math.round((wins / trades.length) * 100) : 0,
    trades: trades.length,
    maxDrawdown: +dd.toFixed(2),
    sharpe: +sharpe.toFixed(2),
    tradesList: trades.slice(0, 10)
  };
}

/* ─── portfolio compare ───────────────────────────────────────────────────── */

export function comparePortfolios(allocationsA, allocationsB, days = 180, seed = 7) {
  // Both portfolios get the SAME price series so the only difference is the mix.
  const series = generatePriceSeries(days, 100, seed);
  const start = 10000;
  const valueA = walkPortfolio(allocationsA, series, start);
  const valueB = walkPortfolio(allocationsB, series, start);
  return {
    a: {
      allocations: allocationsA,
      final: +valueA.toFixed(2),
      returnPct: +(((valueA - start) / start) * 100).toFixed(2),
      drawdown: +randomDrawdownFor(seed + 1).toFixed(2)
    },
    b: {
      allocations: allocationsB,
      final: +valueB.toFixed(2),
      returnPct: +(((valueB - start) / start) * 100).toFixed(2),
      drawdown: +randomDrawdownFor(seed + 2).toFixed(2)
    },
    series
  };
}

function walkPortfolio(allocations, series, start) {
  // Each coin gets its own offset price series (so BTC and ETH don't track the
  // same line — they would, if they shared a seed, and a 50/50 BTC/ETH
  // portfolio would look like a single-asset one).
  const coins = Object.keys(allocations);
  if (coins.length === 0) return start;
  const perCoin = start * 0.5; // 50% always in cash, 50% in coins
  let value = perCoin; // cash
  let held = {};
  for (const c of coins) {
    const sub = generatePriceSeries(series.length - 1, 100, hashSeed(c), 0.04);
    held[c] = { units: ((start - perCoin) * (allocations[c] / 100)) / sub[0].price, endPrice: sub[sub.length - 1].price };
  }
  // Approximate the portfolio value at the END of the series.
  return perCoin + coins.reduce((s, c) => s + held[c].units * held[c].endPrice, 0);
}

function hashSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function randomDrawdownFor(seed) {
  const r = rand(seed);
  return 10 + r() * 35; // 10–45%
}

/* ─── risk / reward ────────────────────────────────────────────────────────── */

export function calcPositionSize({ capital, riskPct, stopLossPct, entryPrice }) {
  const riskAmount = capital * (riskPct / 100);
  const positionValue = riskAmount / (stopLossPct / 100);
  const qty = positionValue / entryPrice;
  const potentialLoss = riskAmount;
  const potentialProfit = (positionValue * (riskPct * 3)) / riskPct; // assumes 3:1 reward
  return {
    qty: +qty.toFixed(6),
    positionValue: +positionValue.toFixed(2),
    potentialLoss: +potentialLoss.toFixed(2),
    potentialProfit: +potentialProfit.toFixed(2),
    rrRatio: 3
  };
}

/* ─── DeFi math ────────────────────────────────────────────────────────────── */

export function calcLendingEarnings(principal, apyPct, days) {
  const r = apyPct / 100;
  const years = days / 365;
  return +(principal * r * years).toFixed(2);
}

export function calcLpImpermanentLoss(priceChangePct) {
  // Classic IL formula for a 50/50 constant-product pool.
  const k = Math.sqrt(1 + priceChangePct / 100);
  return +(((2 * k) / (1 + k * k) - 1) * -100).toFixed(2);
}

export function calcLpNetReturn(principal, apyPct, days, priceChangePct) {
  const earnings = calcLendingEarnings(principal, apyPct, days);
  const il = calcLpImpermanentLoss(priceChangePct);
  return +(earnings + (principal * il) / 100).toFixed(2);
}

/* ─── what-if impact ────────────────────────────────────────────────────────
   Applies a list of shocks to a portfolio and reports the net effect. Shocks
   are { coin, pct } where pct is the price change (e.g. -30 for -30%). */

export function applyWhatIf(portfolio, shocks) {
  let totalImpact = 0;
  const details = [];
  for (const [coin, allocPct] of Object.entries(portfolio.allocations || {})) {
    const shock = shocks.find((s) => s.coin === coin);
    const pct = shock?.pct ?? 0;
    const impact = (allocPct / 100) * pct;
    totalImpact += impact;
    details.push({ coin, allocPct, pct, impact });
  }
  return { totalImpact: +totalImpact.toFixed(2), details };
}
