/**
 * FBT INTENT AI — STRATEGY KIT (autonomy core, layer 3a)
 * ---------------------------------------------------------------------------
 * Modelled on the part of freqtrade that is worth stealing: a strategy is a
 * small declarative object — entry, exit, stoploss, ROI table, optional
 * trailing and position adjustment — and the SAME object is used by the live
 * loop and by the backtester. freqtrade's whole credibility comes from that
 * identity: the thing you backtested is the thing that runs. If the backtester
 * had its own copy of the entry rule, the number it prints would describe a
 * strategy nobody is running.
 *
 * Everything here is pure and synchronous. No network, no wallet, no clock —
 * which is what makes it probeable and what makes the backtest trustworthy:
 * the same code path, fed real candles.
 */

export const STRATEGY_SCHEMA = 'fbt.ai-strategy.v1';
export const BACKTEST_SCHEMA = 'fbt.ai-backtest.v1';

/* ── indicators ───────────────────────────────────────────────────────────
   Four, implemented from their definitions. Anything more would be a
   re-implementation of a library this app does not have; these four are what
   the bundled strategies need and each one is pinned by the probe.
   ──────────────────────────────────────────────────────────────────────── */

export function sma(values, period) {
  const rows = Array.isArray(values) ? values.map(Number) : [];
  const p = Math.max(1, Math.floor(Number(period) || 1));
  if (rows.length < p) return null;
  let sum = 0;
  for (let i = rows.length - p; i < rows.length; i += 1) sum += rows[i];
  return sum / p;
}

export function ema(values, period) {
  const rows = Array.isArray(values) ? values.map(Number) : [];
  const p = Math.max(1, Math.floor(Number(period) || 1));
  if (!rows.length) return null;
  const k = 2 / (p + 1);
  let out = rows[0];
  for (let i = 1; i < rows.length; i += 1) out = rows[i] * k + out * (1 - k);
  return out;
}

/** Wilder's RSI — the smoothing freqtrade/TA-Lib use, not a plain average. */
export function rsi(values, period = 14) {
  const rows = Array.isArray(values) ? values.map(Number) : [];
  const p = Math.max(1, Math.floor(Number(period) || 14));
  if (rows.length <= p) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i += 1) {
    const d = rows[i] - rows[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  for (let i = p + 1; i < rows.length; i += 1) {
    const d = rows[i] - rows[i - 1];
    avgGain = (avgGain * (p - 1) + Math.max(d, 0)) / p;
    avgLoss = (avgLoss * (p - 1) + Math.max(-d, 0)) / p;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Average true range over the last `period` candles ({high, low, close}). */
export function atr(candles, period = 14) {
  const rows = Array.isArray(candles) ? candles : [];
  const p = Math.max(1, Math.floor(Number(period) || 14));
  if (rows.length <= p) return null;
  const trs = [];
  for (let i = 1; i < rows.length; i += 1) {
    const high = Number(rows[i].high);
    const low = Number(rows[i].low);
    const prevClose = Number(rows[i - 1].close);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const tail = trs.slice(-p);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

/** Everything a strategy callback is allowed to see at one candle. */
export function buildContext({ candles, index, strategy, position = null, params = {} }) {
  const upto = candles.slice(0, index + 1);
  const closes = upto.map((c) => Number(c.close));
  const last = upto[upto.length - 1] || null;
  const p = strategy.params || {};
  return {
    index,
    candle: last,
    candles: upto,
    closes,
    price: last ? Number(last.close) : null,
    position,
    strategy,
    params: { ...p, ...params },
    indicators: {
      smaFast: sma(closes, p.smaFast || 9),
      smaSlow: sma(closes, p.smaSlow || 21),
      emaFast: ema(closes, p.emaFast || 9),
      emaSlow: ema(closes, p.emaSlow || 21),
      rsi: rsi(closes, p.rsiPeriod || 14),
      atr: atr(upto, p.atrPeriod || 14)
    }
  };
}

/* ── the bundled strategies ──────────────────────────────────────────────
   Three, each one the smallest honest version of a rule that is actually
   used. They are defaults a user can arm, not advice; every one of them is
   run through the backtester before the UI will offer to arm it.
   ──────────────────────────────────────────────────────────────────────── */

export const BUILTIN_STRATEGIES = Object.freeze([
  {
    id: 'ema-cross',
    schema: STRATEGY_SCHEMA,
    title: 'EMA 9/21 cross',
    titleFa: 'تقاطع EMA ۹/۲۱',
    description: 'Enter when the fast EMA crosses above the slow one, exit on the cross back. Trend following; loses in chop.',
    venue: 'swap-evm',
    kind: 'spot',
    timeframeMinutes: 60,
    params: { emaFast: 9, emaSlow: 21 },
    stoplossPct: 4,
    takeProfitPct: null,
    roi: { 1440: 1.5, 4320: 0.5 },
    entry: (ctx) => {
      const { emaFast, emaSlow } = ctx.indicators;
      const prev = ctx.closes.length > 2 ? ema(ctx.closes.slice(0, -1), ctx.params.emaFast || 9) : null;
      const prevSlow = ctx.closes.length > 2 ? ema(ctx.closes.slice(0, -1), ctx.params.emaSlow || 21) : null;
      if (emaFast == null || emaSlow == null || prev == null || prevSlow == null) return false;
      return prev <= prevSlow && emaFast > emaSlow;
    },
    exit: (ctx) => {
      const { emaFast, emaSlow } = ctx.indicators;
      if (emaFast == null || emaSlow == null) return false;
      return emaFast < emaSlow;
    }
  },
  {
    id: 'rsi-reversion',
    schema: STRATEGY_SCHEMA,
    title: 'RSI(14) mean reversion',
    titleFa: 'بازگشت به میانگین RSI(۱۴)',
    description: 'Buy oversold (<30), sell overbought (>70). Works in ranges, gets run over in trends — the stoploss is what limits that.',
    venue: 'swap-evm',
    kind: 'spot',
    timeframeMinutes: 60,
    params: { rsiPeriod: 14, oversold: 30, overbought: 70 },
    stoplossPct: 5,
    takeProfitPct: 6,
    roi: {},
    entry: (ctx) => (ctx.indicators.rsi != null ? ctx.indicators.rsi < (ctx.params.oversold ?? 30) : false),
    exit: (ctx) => (ctx.indicators.rsi != null ? ctx.indicators.rsi > (ctx.params.overbought ?? 70) : false)
  },
  {
    id: 'dca-accumulator',
    schema: STRATEGY_SCHEMA,
    title: 'Scheduled DCA',
    titleFa: 'خرید پله‌ای زمان‌بندی‌شده',
    description: 'Buys a fixed amount on a schedule, ignores price. The only strategy here whose edge is time in market rather than a signal.',
    venue: 'swap-evm',
    kind: 'dca',
    timeframeMinutes: 1440,
    params: {},
    stoplossPct: null,
    takeProfitPct: null,
    roi: {},
    entry: (ctx) => Boolean(ctx.position === null),
    exit: () => false
  }
]);

export function getStrategy(id) {
  return BUILTIN_STRATEGIES.find((s) => s.id === String(id)) || null;
}

/** Validate a user/custom strategy before anything is allowed to arm it. */
export function validateStrategy(strategy = {}) {
  const errors = [];
  if (!strategy.id) errors.push('MISSING_ID');
  if (typeof strategy.entry !== 'function') errors.push('MISSING_ENTRY');
  if (strategy.exit != null && typeof strategy.exit !== 'function') errors.push('EXIT_NOT_FUNCTION');
  if (strategy.stoplossPct != null && !(Number(strategy.stoplossPct) > 0 && Number(strategy.stoplossPct) < 100)) {
    errors.push('STOPLOSS_OUT_OF_RANGE');
  }
  if (strategy.timeframeMinutes != null && !(Number(strategy.timeframeMinutes) > 0)) errors.push('BAD_TIMEFRAME');
  return { ok: errors.length === 0, errors };
}

/* ── the backtester ───────────────────────────────────────────────────────
   One loop, long-only, one position at a time — the honest scope of what this
   app's venues let a retail user do from a chat. Costs are applied on BOTH
   sides, because a backtest without the exit fee is the most common way a
   strategy gets a number it does not deserve.
   ──────────────────────────────────────────────────────────────────────── */

/** freqtrade's minimal_roi: { minutesHeld: pctTarget }, most generous first. */
export function roiTargetFor(roi = {}, minutesHeld) {
  const entries = Object.entries(roi || {})
    .map(([mins, pct]) => [Number(mins), Number(pct)])
    .filter(([mins, pct]) => Number.isFinite(mins) && Number.isFinite(pct))
    .sort((a, b) => a[0] - b[0]);
  let target = null;
  for (const [mins, pct] of entries) {
    if (minutesHeld >= mins) target = pct;
  }
  return target;
}

export function backtestStrategy({
  strategy,
  candles = [],
  initialUsd = 1000,
  feePct = 0.3,
  slippagePct = 0.1,
  warmup = 30
} = {}) {
  const valid = validateStrategy(strategy);
  if (!valid.ok) return { ok: false, schema: BACKTEST_SCHEMA, code: 'INVALID_STRATEGY', errors: valid.errors };
  const rows = Array.isArray(candles) ? candles.filter((c) => Number.isFinite(Number(c?.close))) : [];
  if (rows.length <= warmup + 2) {
    return { ok: false, schema: BACKTEST_SCHEMA, code: 'NOT_ENOUGH_DATA', candles: rows.length, required: warmup + 3 };
  }

  const stepMinutes = Number(strategy.timeframeMinutes) || 60;
  const fee = Number(feePct) || 0;
  const slip = Number(slippagePct) || 0;
  const capital = Number(initialUsd) > 0 ? Number(initialUsd) : 1000;

  let cash = capital;
  let position = null;
  const trades = [];
  const equity = [];
  let peak = capital;
  let maxDrawdownPct = 0;

  const markValue = (pos, price) => (pos ? pos.units * price : 0);

  for (let i = warmup; i < rows.length; i += 1) {
    const price = Number(rows[i].close);
    const ctx = buildContext({ candles: rows, index: i, strategy, position });
    const minutesHeld = position ? (i - position.entryIndex) * stepMinutes : 0;

    if (position) {
      const changePct = ((price - position.entryPrice) / position.entryPrice) * 100;
      const stop = strategy.stoplossPct != null ? -Number(strategy.stoplossPct) : null;
      const tp = strategy.takeProfitPct != null ? Number(strategy.takeProfitPct) : null;
      const roi = roiTargetFor(strategy.roi, minutesHeld);
      const exitSignal = typeof strategy.exit === 'function' ? Boolean(strategy.exit(ctx)) : false;

      let reason = null;
      if (stop != null && changePct <= stop) reason = 'STOPLOSS';
      else if (tp != null && changePct >= tp) reason = 'TAKE_PROFIT';
      else if (roi != null && changePct >= roi) reason = 'ROI';
      else if (exitSignal) reason = 'EXIT_SIGNAL';

      if (reason) {
        const gross = markValue(position, price);
        const net = gross * (1 - (fee + slip) / 100);
        cash += net;
        trades.push({
          entryIndex: position.entryIndex,
          exitIndex: i,
          entryPrice: position.entryPrice,
          exitPrice: price,
          entryAt: rows[position.entryIndex]?.time ?? null,
          exitAt: rows[i]?.time ?? null,
          minutesHeld,
          stakeUsd: position.stakeUsd,
          grossPct: changePct,
          netUsd: net - position.stakeUsd,
          netPct: ((net - position.stakeUsd) / position.stakeUsd) * 100,
          reason
        });
        position = null;
      }
    } else if (typeof strategy.entry === 'function' && strategy.entry(ctx) && cash > 0) {
      const stakeUsd = Math.min(cash, Number(strategy.stakeUsd) > 0 ? Number(strategy.stakeUsd) : cash);
      const effective = stakeUsd * (1 - (fee + slip) / 100);
      cash -= stakeUsd;
      position = { entryIndex: i, entryPrice: price, units: effective / price, stakeUsd };
    }

    const value = cash + markValue(position, price);
    equity.push({ index: i, time: rows[i]?.time ?? null, price, value });
    if (value > peak) peak = value;
    const dd = peak > 0 ? ((peak - value) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const lastValue = equity.length ? equity[equity.length - 1].value : capital;
  const wins = trades.filter((t) => t.netUsd > 0);
  const losses = trades.filter((t) => t.netUsd <= 0);
  const grossWin = wins.reduce((a, t) => a + t.netUsd, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netUsd, 0));

  return {
    ok: true,
    schema: BACKTEST_SCHEMA,
    strategyId: strategy.id,
    candles: rows.length,
    warmup,
    initialUsd: capital,
    finalUsd: lastValue,
    returnPct: ((lastValue - capital) / capital) * 100,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    avgTradePct: trades.length ? trades.reduce((a, t) => a + t.netPct, 0) / trades.length : null,
    bestTradePct: trades.length ? Math.max(...trades.map((t) => t.netPct)) : null,
    worstTradePct: trades.length ? Math.min(...trades.map((t) => t.netPct)) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    maxDrawdownPct,
    /* An open position at the end is NOT a closed trade. Reporting it as one
       would inflate the trade count the loop is compared against. */
    openAtEnd: Boolean(position),
    openPosition: position ? { entryPrice: position.entryPrice, entryIndex: position.entryIndex, stakeUsd: position.stakeUsd } : null,
    feePct: fee,
    slippagePct: slip,
    equityCurve: equity,
    tradeLog: trades,
    /* Printed with every backtest this app shows. A backtest is a measurement
       of the past on one instrument; the sentence keeps it from being read as
       a forecast, which is the single most common lie in trading UIs. */
    disclaimer: 'Backtest on historical candles with fees and slippage on both sides. Past behaviour is not a forecast.'
  };
}
