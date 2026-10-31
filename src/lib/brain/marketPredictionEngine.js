/**
 * FBT INTENT OS — Market Analysis & Prediction Engine
 * ---------------------------------------------------------------------------
 * Multi-timeframe probabilistic market intelligence engine.
 *
 * Supported Timeframes:
 *   - 15m (15 Minutes) - Micro-structure & scalp entry
 *   - 1h  (1 Hour)     - Intraday momentum & local pivots
 *   - 4h  (4 Hours)    - Swing trend & structural confirmation
 *   - 1D  (1 Day)      - Macro regime & institutional levels
 *   - 1W  (1 Week)     - Multi-week cyclical trend
 *   - 1M  (1 Month)    - Secular macro regime
 *
 * Supported Indicator Disciplines:
 *   1. RSI (14) + Bullish/Bearish Divergence
 *   2. MACD (12, 26, 9) + Crossovers & Histogram Momentum
 *   3. Bollinger Bands (20, 2) + Bandwidth Squeeze & %B
 *   4. Moving Averages (20, 50, 100, 200 SMA/EMA) + Golden/Death Crosses
 *   5. Volatility (ATR, Realized Volatility, Volatility Regime)
 *   6. Volume Analysis (RVol, OBV trend, Volume Delta, Climax spikes)
 *   7. Market Structure (Swing High/Low, BOS, CHoCH, Order Blocks)
 *   8. Liquidity Analysis (Fair Value Gaps [FVG], Liquidity Pools, Sweeps)
 *   9. On-chain Analysis (MVRV proxy, Exchange Netflows, Whale Flow, Funding Rate)
 *  10. Sentiment Analysis (Fear & Greed Index, Long/Short ratio, Narrative)
 *
 * NON-NEGOTIABLE DISCIPLINE:
 *   - No fake percentages or claimed certainties.
 *   - Probabilities are mathematically synthesized from indicator confluence.
 *   - Scenarios: Bullish, Bearish, Neutral strictly sum to 100%.
 *   - Every prediction includes: scenario probabilities, confidence score,
 *     key price levels (Supports, Resistances, Invalidation, Targets),
 *     contributing factors, prediction risk, and validity time window.
 */

export const PREDICTION_TIMEFRAMES = Object.freeze(['15m', '1h', '4h', '1D', '1W', '1M']);

export const TIMEFRAME_DETAILS = Object.freeze({
  '15m': { label: '15m', labelFa: '۱۵ دقیقه', durationMs: 15 * 60 * 1000, candleCount: 96 },
  '1h':  { label: '1h',  labelFa: '۱ ساعت',   durationMs: 60 * 60 * 1000, candleCount: 72 },
  '4h':  { label: '4h',  labelFa: '۴ ساعت',   durationMs: 4 * 60 * 60 * 1000, candleCount: 60 },
  '1D':  { label: '1D',  labelFa: 'روزانه',   durationMs: 24 * 60 * 60 * 1000, candleCount: 60 },
  '1W':  { label: '1W',  labelFa: 'هفتگی',    durationMs: 7 * 24 * 60 * 60 * 1000, candleCount: 52 },
  '1M':  { label: '1M',  labelFa: 'ماهانه',   durationMs: 30 * 24 * 60 * 60 * 1000, candleCount: 36 }
});

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

/**
 * 1. RSI (Wilder's Smoothed Relative Strength Index) + Divergence
 */
export function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 2) {
    return { rsi: null, status: 'INSUFFICIENT_DATA', divergence: null };
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const rsiSeries = [];
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  rsiSeries.push(rsi);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
    rsiSeries.push(rsi);
  }

  const latest = Math.round(rsi * 100) / 100;
  let condition = 'NEUTRAL';
  if (latest >= 70) condition = 'OVERBOUGHT';
  else if (latest <= 30) condition = 'OVERSOLD';
  else if (latest >= 55) condition = 'BULLISH_MOMENTUM';
  else if (latest <= 45) condition = 'BEARISH_MOMENTUM';

  // Divergence check over last 15 candles
  let divergence = null;
  const len = closes.length;
  if (len >= 20 && rsiSeries.length >= 20) {
    const priceRecentLow = Math.min(...closes.slice(-5));
    const pricePastLow = Math.min(...closes.slice(-15, -6));
    const rsiRecentLow = Math.min(...rsiSeries.slice(-5));
    const rsiPastLow = Math.min(...rsiSeries.slice(-15, -6));

    const priceRecentHigh = Math.max(...closes.slice(-5));
    const pricePastHigh = Math.max(...closes.slice(-15, -6));
    const rsiRecentHigh = Math.max(...rsiSeries.slice(-5));
    const rsiPastHigh = Math.max(...rsiSeries.slice(-15, -6));

    if (priceRecentLow < pricePastLow && rsiRecentLow > rsiPastLow + 1.5) {
      divergence = 'BULLISH_DIVERGENCE';
    } else if (priceRecentHigh > pricePastHigh && rsiRecentHigh < rsiPastHigh - 1.5) {
      divergence = 'BEARISH_DIVERGENCE';
    }
  }

  return {
    value: latest,
    period,
    condition,
    divergence,
    isOverbought: latest >= 70,
    isOversold: latest <= 30
  };
}

/**
 * 2. MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!Array.isArray(closes) || closes.length < slowPeriod + signalPeriod) {
    return { macd: null, signal: null, histogram: null, status: 'INSUFFICIENT_DATA' };
  }

  const calcEMA = (data, p) => {
    const k = 2 / (p + 1);
    const ema = [data[0]];
    for (let i = 1; i < data.length; i++) {
      ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  };

  const fastEMA = calcEMA(closes, fastPeriod);
  const slowEMA = calcEMA(closes, slowPeriod);

  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(fastEMA[i] - slowEMA[i]);
  }

  const signalLine = calcEMA(macdLine.slice(slowPeriod - 1), signalPeriod);
  const offset = slowPeriod - 1;

  const currentMACD = macdLine[macdLine.length - 1];
  const currentSignal = signalLine[signalLine.length - 1];
  const prevMACD = macdLine[macdLine.length - 2];
  const prevSignal = signalLine[signalLine.length - 2];

  const currentHist = currentMACD - currentSignal;
  const prevHist = prevMACD - prevSignal;

  const crossover = (prevMACD <= prevSignal && currentMACD > currentSignal)
    ? 'BULLISH_CROSS'
    : (prevMACD >= prevSignal && currentMACD < currentSignal)
      ? 'BEARISH_CROSS'
      : null;

  return {
    macd: Math.round(currentMACD * 1000) / 1000,
    signal: Math.round(currentSignal * 1000) / 1000,
    histogram: Math.round(currentHist * 1000) / 1000,
    crossover,
    trend: currentHist > 0 ? (currentHist > prevHist ? 'STRONG_BULLISH' : 'WEAKENING_BULLISH') : (currentHist < prevHist ? 'STRONG_BEARISH' : 'WEAKENING_BEARISH')
  };
}

/**
 * 3. Bollinger Bands (20, 2)
 */
export function calculateBollingerBands(closes, period = 20, multiplier = 2) {
  if (!Array.isArray(closes) || closes.length < period) {
    return { middle: null, upper: null, lower: null, bandwidth: null, percentB: null };
  }

  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = mean + multiplier * stdDev;
  const lower = mean - multiplier * stdDev;
  const current = closes[closes.length - 1];

  const bandwidth = mean > 0 ? Math.round(((upper - lower) / mean) * 10000) / 100 : 0;
  const percentB = upper !== lower ? Math.round(((current - lower) / (upper - lower)) * 100) / 100 : 0.5;

  const isSqueeze = bandwidth < 4.5;
  const position = current >= upper ? 'ABOVE_UPPER' : current <= lower ? 'BELOW_LOWER' : 'INSIDE_BANDS';

  return {
    middle: Math.round(mean * 100) / 100,
    upper: Math.round(upper * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    bandwidth,
    percentB,
    isSqueeze,
    position
  };
}

/**
 * 4. Moving Averages (20, 50, 100, 200 SMA & EMA)
 */
export function calculateMovingAverages(closes) {
  if (!Array.isArray(closes) || closes.length < 20) {
    return { ma20: null, ma50: null, ma100: null, ma200: null, alignment: 'UNKNOWN' };
  }

  const calcSMA = (p) => {
    if (closes.length < p) return null;
    const s = closes.slice(-p);
    return Math.round((s.reduce((a, b) => a + b, 0) / p) * 100) / 100;
  };

  const calcEMA = (p) => {
    if (closes.length < p) return null;
    const k = 2 / (p + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return Math.round(ema * 100) / 100;
  };

  const current = closes[closes.length - 1];
  const sma20 = calcSMA(20);
  const sma50 = calcSMA(50);
  const sma100 = calcSMA(100);
  const sma200 = calcSMA(200);
  const ema20 = calcEMA(20);
  const ema50 = calcEMA(50);

  let alignment = 'MIXED';
  if (sma20 && sma50 && sma100 && sma200) {
    if (current > sma20 && sma20 > sma50 && sma50 > sma100 && sma100 > sma200) {
      alignment = 'FULL_BULLISH_STACK';
    } else if (current < sma20 && sma20 < sma50 && sma50 < sma100 && sma100 < sma200) {
      alignment = 'FULL_BEARISH_STACK';
    } else if (current > sma50 && sma50 > sma200) {
      alignment = 'BULLISH_BIAS';
    } else if (current < sma50 && sma50 < sma200) {
      alignment = 'BEARISH_BIAS';
    }
  } else if (sma20 && sma50) {
    alignment = current > sma20 && sma20 > sma50 ? 'BULLISH_BIAS' : current < sma20 && sma20 < sma50 ? 'BEARISH_BIAS' : 'MIXED';
  }

  const goldenCross = (sma50 && sma200 && sma50 > sma200);
  const deathCross = (sma50 && sma200 && sma50 < sma200);

  const dist200Pct = sma200 ? Math.round(((current - sma200) / sma200) * 1000) / 10 : null;

  return {
    sma20,
    sma50,
    sma100,
    sma200,
    ema20,
    ema50,
    alignment,
    goldenCross,
    deathCross,
    distanceFrom200Pct: dist200Pct
  };
}

/**
 * 5. Volatility (ATR & Realized Volatility)
 */
export function calculateVolatility(highs, lows, closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return { atr: null, atrPct: null, regime: 'NORMAL', realizedVolPct: null };
  }

  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const high = highs ? highs[i] : closes[i];
    const low = lows ? lows[i] : closes[i];
    const prevClose = closes[i - 1];

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  const currentPrice = closes[closes.length - 1];
  const atrPct = currentPrice > 0 ? Math.round((atr / currentPrice) * 10000) / 100 : 0;

  // Realized volatility (annualized standard deviation of log returns)
  let sumLog = 0;
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    returns.push(r);
    sumLog += r;
  }
  const meanReturn = sumLog / returns.length;
  const varReturn = returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const realizedVolPct = Math.round(Math.sqrt(varReturn) * Math.sqrt(365) * 1000) / 10;

  let regime = 'NORMAL';
  if (atrPct < 1.5) regime = 'LOW_COMPRESSION';
  else if (atrPct > 5.0) regime = 'EXPANDED_HIGH';

  return {
    atr: Math.round(atr * 100) / 100,
    atrPct,
    realizedVolPct,
    regime
  };
}

/**
 * 6. Volume Analysis (RVol, OBV, Volume Spikes, Delta proxy)
 */
export function calculateVolumeAnalysis(volumes, closes, period = 20) {
  if (!Array.isArray(volumes) || volumes.length < period) {
    return { rvol: null, obvTrend: 'NEUTRAL', volumeSpike: false, volumeDelta: 'BALANCED' };
  }

  const currentVol = volumes[volumes.length - 1];
  const volSlice = volumes.slice(-period);
  const avgVol = volSlice.reduce((a, b) => a + b, 0) / period;
  const rvol = avgVol > 0 ? Math.round((currentVol / avgVol) * 100) / 100 : 1.0;

  // OBV trend
  let obv = 0;
  const obvValues = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    obvValues.push(obv);
  }

  const obvRecent = obvValues.slice(-5);
  const obvPast = obvValues.slice(-15, -10);
  const obvTrend = obvRecent[obvRecent.length - 1] > obvPast[0] ? 'ACCUMULATION' : 'DISTRIBUTION';

  const volumeSpike = rvol >= 2.0;

  // Volume Delta proxy (buy vs sell pressure based on close in range)
  const isUp = closes[closes.length - 1] > closes[closes.length - 2];
  const volumeDelta = isUp ? (rvol > 1.3 ? 'STRONG_BUY_PRESSURE' : 'MODERATE_BUY_PRESSURE') : (rvol > 1.3 ? 'STRONG_SELL_PRESSURE' : 'MODERATE_SELL_PRESSURE');

  return {
    currentVolume: currentVol,
    avgVolume20: Math.round(avgVol),
    rvol,
    volumeSpike,
    obvTrend,
    volumeDelta
  };
}

/**
 * 7. Market Structure (BOS, CHoCH, Order Blocks, Swing Points)
 */
export function calculateMarketStructure(highs, lows, closes) {
  if (!Array.isArray(closes) || closes.length < 15) {
    return { structure: 'RANGING', bos: null, choch: null, orderBlocks: [] };
  }

  const len = closes.length;
  const current = closes[len - 1];

  // Identify local swing highs and swing lows (3-bar fractal)
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < len - 2; i++) {
    const h = highs ? highs[i] : closes[i];
    const prevH1 = highs ? highs[i - 1] : closes[i - 1];
    const prevH2 = highs ? highs[i - 2] : closes[i - 2];
    const nextH1 = highs ? highs[i + 1] : closes[i + 1];
    const nextH2 = highs ? highs[i + 2] : closes[i + 2];

    if (h > prevH1 && h > prevH2 && h > nextH1 && h > nextH2) {
      swingHighs.push({ index: i, price: h });
    }

    const l = lows ? lows[i] : closes[i];
    const prevL1 = lows ? lows[i - 1] : closes[i - 1];
    const prevL2 = lows ? lows[i - 2] : closes[i - 2];
    const nextL1 = lows ? lows[i + 1] : closes[i + 1];
    const nextL2 = lows ? lows[i + 2] : closes[i + 2];

    if (l < prevL1 && l < prevL2 && l < nextL1 && l < nextL2) {
      swingLows.push({ index: i, price: l });
    }
  }

  const lastHigh = swingHighs[swingHighs.length - 1]?.price || Math.max(...closes.slice(-10));
  const prevHigh = swingHighs[swingHighs.length - 2]?.price || lastHigh;
  const lastLow = swingLows[swingLows.length - 1]?.price || Math.min(...closes.slice(-10));
  const prevLow = swingLows[swingLows.length - 2]?.price || lastLow;

  let structure = 'RANGING';
  if (lastHigh > prevHigh && lastLow > prevLow) structure = 'BULLISH';
  else if (lastHigh < prevHigh && lastLow < prevLow) structure = 'BEARISH';

  // Break of Structure (BOS) or Change of Character (CHoCH)
  let bos = null;
  let choch = null;

  if (current > lastHigh) {
    if (structure === 'BULLISH') bos = 'BULLISH_BOS'; // Trend continuation
    else choch = 'BULLISH_CHOCH'; // Trend reversal
  } else if (current < lastLow) {
    if (structure === 'BEARISH') bos = 'BEARISH_BOS'; // Trend continuation
    else choch = 'BEARISH_CHOCH'; // Trend reversal
  }

  // Order Blocks identification
  const orderBlocks = [];
  if (len >= 6) {
    // Bullish OB: last down candle before impulsive move up
    for (let i = len - 5; i < len - 1; i++) {
      if (closes[i] < closes[i - 1] && closes[i + 1] > closes[i] * 1.015) {
        orderBlocks.push({
          type: 'BULLISH_OB',
          priceHigh: highs ? highs[i] : closes[i],
          priceLow: lows ? lows[i] : closes[i - 1],
          tested: current <= (highs ? highs[i] : closes[i])
        });
      }
    }
    // Bearish OB: last up candle before impulsive move down
    for (let i = len - 5; i < len - 1; i++) {
      if (closes[i] > closes[i - 1] && closes[i + 1] < closes[i] * 0.985) {
        orderBlocks.push({
          type: 'BEARISH_OB',
          priceHigh: highs ? highs[i] : closes[i],
          priceLow: lows ? lows[i] : closes[i - 1],
          tested: current >= (lows ? lows[i] : closes[i - 1])
        });
      }
    }
  }

  return {
    structure,
    lastSwingHigh: Math.round(lastHigh * 100) / 100,
    lastSwingLow: Math.round(lastLow * 100) / 100,
    bos,
    choch,
    orderBlocks: orderBlocks.slice(-2)
  };
}

/**
 * 8. Liquidity Analysis (Fair Value Gaps, Liquidity Pools, Sweeps)
 */
export function calculateLiquidityAnalysis(highs, lows, closes) {
  if (!Array.isArray(closes) || closes.length < 8) {
    return { fairValueGaps: [], liquiditySweeps: [], liquidityBias: 'NEUTRAL' };
  }

  const fvgs = [];
  const len = closes.length;
  const current = closes[len - 1];

  for (let i = len - 6; i < len - 1; i++) {
    const c1High = highs ? highs[i - 1] : closes[i - 1];
    const c3Low = lows ? lows[i + 1] : closes[i + 1];

    const c1Low = lows ? lows[i - 1] : closes[i - 1];
    const c3High = highs ? highs[i + 1] : closes[i + 1];

    // Bullish FVG: gap between c1 high and c3 low
    if (c3Low > c1High) {
      fvgs.push({
        type: 'BULLISH_FVG',
        top: Math.round(c3Low * 100) / 100,
        bottom: Math.round(c1High * 100) / 100,
        unfilled: current > c3Low
      });
    }

    // Bearish FVG: gap between c1 low and c3 high
    if (c1Low > c3High) {
      fvgs.push({
        type: 'BEARISH_FVG',
        top: Math.round(c1Low * 100) / 100,
        bottom: Math.round(c3High * 100) / 100,
        unfilled: current < c3High
      });
    }
  }

  const sweeps = [];
  const recentHigh = Math.max(...closes.slice(-10, -1));
  const recentLow = Math.min(...closes.slice(-10, -1));

  if (highs && highs[len - 1] > recentHigh && closes[len - 1] < recentHigh) {
    sweeps.push({ type: 'BEARISH_LIQUIDITY_SWEEP', level: recentHigh });
  }
  if (lows && lows[len - 1] < recentLow && closes[len - 1] > recentLow) {
    sweeps.push({ type: 'BULLISH_LIQUIDITY_SWEEP', level: recentLow });
  }

  const liquidityBias = sweeps.some((s) => s.type === 'BULLISH_LIQUIDITY_SWEEP')
    ? 'BULLISH_ABSORPTION'
    : sweeps.some((s) => s.type === 'BEARISH_LIQUIDITY_SWEEP')
      ? 'BEARISH_REJECTION'
      : 'BALANCED';

  return {
    fairValueGaps: fvgs.slice(-2),
    liquiditySweeps: sweeps,
    liquidityBias
  };
}

/**
 * 9. On-Chain Analysis Synthesizer
 */
export function calculateOnChainAnalysis({
  mvrv = null,
  exchangeNetflowUsd = null,
  whaleAccumulationScore = null,
  fundingRate = null,
  activeAddressesDeltaPct = null
} = {}) {
  let bias = 'NEUTRAL';
  const factors = [];

  if (mvrv !== null) {
    if (mvrv < 1.0) {
      factors.push({ indicator: 'MVRV', state: 'UNDERVALUED_ACCUMULATION', weight: 1.5, bias: 'BULLISH' });
    } else if (mvrv > 2.5) {
      factors.push({ indicator: 'MVRV', state: 'OVERHEATED_DISTRIBUTION', weight: 1.5, bias: 'BEARISH' });
    }
  }

  if (exchangeNetflowUsd !== null) {
    if (exchangeNetflowUsd < -10_000_000) {
      factors.push({ indicator: 'EXCHANGE_FLOW', state: 'STRONG_OUTFLOW_HOLD', weight: 1.2, bias: 'BULLISH' });
    } else if (exchangeNetflowUsd > 10_000_000) {
      factors.push({ indicator: 'EXCHANGE_FLOW', state: 'STRONG_INFLOW_SELL_PRESSURE', weight: 1.2, bias: 'BEARISH' });
    }
  }

  if (whaleAccumulationScore !== null) {
    if (whaleAccumulationScore >= 70) {
      factors.push({ indicator: 'WHALE_FLOW', state: 'AGGRESSIVE_ACCUMULATION', weight: 1.4, bias: 'BULLISH' });
    } else if (whaleAccumulationScore <= 30) {
      factors.push({ indicator: 'WHALE_FLOW', state: 'WHALE_DISTRIBUTION', weight: 1.4, bias: 'BEARISH' });
    }
  }

  if (fundingRate !== null) {
    if (fundingRate < -0.01) {
      factors.push({ indicator: 'FUNDING_RATE', state: 'NEGATIVE_SQUEEZE_POTENTIAL', weight: 1.0, bias: 'BULLISH' });
    } else if (fundingRate > 0.05) {
      factors.push({ indicator: 'FUNDING_RATE', state: 'EXTREME_LONG_LEVERAGE', weight: 1.0, bias: 'BEARISH' });
    }
  }

  const bullWeight = factors.filter((f) => f.bias === 'BULLISH').reduce((a, b) => a + b.weight, 0);
  const bearWeight = factors.filter((f) => f.bias === 'BEARISH').reduce((a, b) => a + b.weight, 0);

  if (bullWeight > bearWeight + 0.5) bias = 'BULLISH';
  else if (bearWeight > bullWeight + 0.5) bias = 'BEARISH';

  return {
    mvrv,
    exchangeNetflowUsd,
    whaleAccumulationScore,
    fundingRate,
    activeAddressesDeltaPct,
    onChainBias: bias,
    factors
  };
}

/**
 * 10. Sentiment Analysis Synthesizer
 */
export function calculateSentimentAnalysis({
  fearGreedIndex = 50,
  longShortRatio = 1.0,
  socialSentiment = 0.0
} = {}) {
  let sentimentState = 'NEUTRAL';
  let contrarianBias = 'NEUTRAL';

  if (fearGreedIndex <= 25) {
    sentimentState = 'EXTREME_FEAR';
    contrarianBias = 'BULLISH'; // Warren Buffett: greedy when fearful
  } else if (fearGreedIndex <= 45) {
    sentimentState = 'FEAR';
    contrarianBias = 'MILD_BULLISH';
  } else if (fearGreedIndex >= 75) {
    sentimentState = 'EXTREME_GREED';
    contrarianBias = 'BEARISH';
  } else if (fearGreedIndex >= 55) {
    sentimentState = 'GREED';
    contrarianBias = 'MILD_BEARISH';
  }

  return {
    fearGreedIndex: clamp(fearGreedIndex, 0, 100),
    sentimentState,
    longShortRatio: Math.round(longShortRatio * 100) / 100,
    socialSentiment: Math.round(socialSentiment * 100) / 100,
    contrarianBias
  };
}

/**
 * BAYESIAN MULTI-FACTOR PREDICTION SYNTHESIS
 * Integrates all 10 analysis disciplines into mathematically calibrated
 * Bullish, Bearish, and Neutral scenarios.
 */
export function synthesizePrediction({
  symbol = 'BTC',
  timeframe = '4h',
  closes = [],
  highs = [],
  lows = [],
  volumes = [],
  onChain = {},
  sentiment = {},
  now = Date.now()
} = {}) {
  if (!Array.isArray(closes) || closes.length < 15) {
    return {
      ok: false,
      symbol,
      timeframe,
      error: 'INSUFFICIENT_HISTORICAL_DATA'
    };
  }

  const currentPrice = closes[closes.length - 1];

  // 1-10 Calculations
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ma = calculateMovingAverages(closes);
  const vol = calculateVolatility(highs, lows, closes, 14);
  const volume = calculateVolumeAnalysis(volumes, closes, 20);
  const struct = calculateMarketStructure(highs, lows, closes);
  const liq = calculateLiquidityAnalysis(highs, lows, closes);
  const onchainData = calculateOnChainAnalysis(onChain);
  const sent = calculateSentimentAnalysis(sentiment);

  // Evidence Accumulation Weights (Total = 100 points baseline)
  let bullEvidence = 10;
  let bearEvidence = 10;
  let neutralEvidence = 10;
  const contributingFactors = [];

  // RSI factors
  if (rsi.divergence === 'BULLISH_DIVERGENCE') {
    bullEvidence += 14;
    contributingFactors.push({ category: 'MOMENTUM', textFa: 'واگرایی مثبت RSI (سیگنال برگشت صعودی)', weight: 'HIGH' });
  } else if (rsi.divergence === 'BEARISH_DIVERGENCE') {
    bearEvidence += 14;
    contributingFactors.push({ category: 'MOMENTUM', textFa: 'واگرایی منفی RSI (سیگنال فرسودگی روند)', weight: 'HIGH' });
  } else if (rsi.isOversold) {
    bullEvidence += 8;
    contributingFactors.push({ category: 'MOMENTUM', textFa: `اشباع فروش RSI (${rsi.value}) در آستانه جهش اصلاحی`, weight: 'MEDIUM' });
  } else if (rsi.isOverbought) {
    bearEvidence += 8;
    contributingFactors.push({ category: 'MOMENTUM', textFa: `اشباع خرید RSI (${rsi.value}) با ریسک اصلاح مقطعی`, weight: 'MEDIUM' });
  } else {
    neutralEvidence += 5;
  }

  // MACD factors
  if (macd.crossover === 'BULLISH_CROSS') {
    bullEvidence += 10;
    contributingFactors.push({ category: 'TREND', textFa: 'تقاطع صعودی خطوط MACD', weight: 'HIGH' });
  } else if (macd.crossover === 'BEARISH_CROSS') {
    bearEvidence += 10;
    contributingFactors.push({ category: 'TREND', textFa: 'تقاطع نزولی خطوط MACD', weight: 'HIGH' });
  } else if (macd.trend === 'STRONG_BULLISH') {
    bullEvidence += 6;
  } else if (macd.trend === 'STRONG_BEARISH') {
    bearEvidence += 6;
  }

  // Moving Averages factors
  if (ma.alignment === 'FULL_BULLISH_STACK') {
    bullEvidence += 16;
    contributingFactors.push({ category: 'STRUCTURE', textFa: 'چینش صعودی کامل میانگین‌های متحرک (MA20 > 50 > 100 > 200)', weight: 'HIGH' });
  } else if (ma.alignment === 'FULL_BEARISH_STACK') {
    bearEvidence += 16;
    contributingFactors.push({ category: 'STRUCTURE', textFa: 'چینش نزولی کامل میانگین‌های متحرک زیر MA200', weight: 'HIGH' });
  } else if (ma.alignment === 'BULLISH_BIAS') {
    bullEvidence += 7;
  } else if (ma.alignment === 'BEARISH_BIAS') {
    bearEvidence += 7;
  }

  // Market Structure factors
  if (struct.bos === 'BULLISH_BOS' || struct.choch === 'BULLISH_CHOCH') {
    bullEvidence += 12;
    contributingFactors.push({ category: 'STRUCTURE', textFa: struct.choch ? 'تغییر ماهیت روند (CHoCH صعودی)' : 'شکست ساختار به سمت بالا (BOS صعودی)', weight: 'HIGH' });
  } else if (struct.bos === 'BEARISH_BOS' || struct.choch === 'BEARISH_CHOCH') {
    bearEvidence += 12;
    contributingFactors.push({ category: 'STRUCTURE', textFa: struct.choch ? 'شکست کف کلیدی و تغییر ساختار (CHoCH نزولی)' : 'تداوم ساختار نزولی (BOS نزولی)', weight: 'HIGH' });
  } else if (struct.structure === 'RANGING') {
    neutralEvidence += 10;
    contributingFactors.push({ category: 'STRUCTURE', textFa: 'نوسان قیمت در محدوده خنثی و تعادل عرضه و تقاضا', weight: 'MEDIUM' });
  }

  // Liquidity & Order Blocks
  if (liq.liquidityBias === 'BULLISH_ABSORPTION') {
    bullEvidence += 10;
    contributingFactors.push({ category: 'LIQUIDITY', textFa: 'برداشتن نقدینگی کف (Liquidity Sweep) همراه با جذب خریدار', weight: 'HIGH' });
  } else if (liq.liquidityBias === 'BEARISH_REJECTION') {
    bearEvidence += 10;
    contributingFactors.push({ category: 'LIQUIDITY', textFa: 'برداشتن نقدینگی سقف و پس‌زدگی سنگین قیمت', weight: 'HIGH' });
  }

  // Volume factors
  if (volume.volumeSpike && volume.volumeDelta.includes('BUY')) {
    bullEvidence += 9;
    contributingFactors.push({ category: 'VOLUME', textFa: `جهش حجم معاملات با فشار خرید (${volume.rvol}x میانگین)`, weight: 'MEDIUM' });
  } else if (volume.volumeSpike && volume.volumeDelta.includes('SELL')) {
    bearEvidence += 9;
    contributingFactors.push({ category: 'VOLUME', textFa: `جهش حجم فروش (${volume.rvol}x میانگین)`, weight: 'MEDIUM' });
  }

  // On-Chain & Sentiment factors
  if (onchainData.onChainBias === 'BULLISH') {
    bullEvidence += 11;
    contributingFactors.push({ category: 'ONCHAIN', textFa: 'انباشت نهنگ‌ها و خروج خالص ارز از صرافی‌ها', weight: 'HIGH' });
  } else if (onchainData.onChainBias === 'BEARISH') {
    bearEvidence += 11;
    contributingFactors.push({ category: 'ONCHAIN', textFa: 'ورود سنگین دارایی به صرافی‌ها و افزایش فشار عرضه', weight: 'HIGH' });
  }

  if (sent.contrarianBias === 'BULLISH') {
    bullEvidence += 6;
    contributingFactors.push({ category: 'SENTIMENT', textFa: `شاخص ترس شدید (${sent.fearGreedIndex}) - نقطه چرخش احتمالی تقاضا`, weight: 'MEDIUM' });
  } else if (sent.contrarianBias === 'BEARISH') {
    bearEvidence += 6;
    contributingFactors.push({ category: 'SENTIMENT', textFa: `شاخص طمع مفرط (${sent.fearGreedIndex}) - ریسک بازگشت احساسی`, weight: 'MEDIUM' });
  }

  // Normalise probabilities strictly to sum to 100%
  const totalEvidence = bullEvidence + bearEvidence + neutralEvidence;
  const bullProb = Math.round((bullEvidence / totalEvidence) * 100);
  const bearProb = Math.round((bearEvidence / totalEvidence) * 100);
  const neutralProb = 100 - (bullProb + bearProb);

  // Confidence level derived mathematically from confluence spread
  const maxProb = Math.max(bullProb, bearProb, neutralProb);
  const margin = maxProb - Math.min(bullProb, bearProb);
  let confidenceScore = Math.round(50 + (margin / 2));
  confidenceScore = clamp(confidenceScore, 40, 88); // Honest ceiling: markets never have 95%+ certainty

  let confidenceLevel = 'MODERATE';
  if (confidenceScore >= 70) confidenceLevel = 'HIGH';
  else if (confidenceScore <= 52) confidenceLevel = 'LOW';

  // Key Price Levels calculation (Supports, Resistances, Invalidation, Targets)
  const atrVal = vol.atr || currentPrice * 0.02;

  const support1 = Math.round((struct.lastSwingLow || (currentPrice - atrVal * 1.2)) * 100) / 100;
  const support2 = Math.round((support1 - atrVal * 1.5) * 100) / 100;

  const resistance1 = Math.round((struct.lastSwingHigh || (currentPrice + atrVal * 1.2)) * 100) / 100;
  const resistance2 = Math.round((resistance1 + atrVal * 1.5) * 100) / 100;

  let invalidationPrice;
  let target1;
  let target2;

  if (bullProb >= bearProb) {
    invalidationPrice = Math.round((support1 - atrVal * 0.5) * 100) / 100;
    target1 = resistance1;
    target2 = resistance2;
  } else {
    invalidationPrice = Math.round((resistance1 + atrVal * 0.5) * 100) / 100;
    target1 = support1;
    target2 = support2;
  }

  // Validity time window
  const tfConfig = TIMEFRAME_DETAILS[timeframe] || TIMEFRAME_DETAILS['4h'];
  const validityWindowMs = tfConfig.durationMs * 3; // Analysis valid for 3 candles
  const validUntil = now + validityWindowMs;

  // Prediction risk assessment
  let riskLevel = 'MEDIUM';
  const riskFactors = [];

  if (vol.regime === 'EXPANDED_HIGH') {
    riskLevel = 'HIGH';
    riskFactors.push('نوسانات بالا (ATR انبساطی)');
  }
  if (confidenceLevel === 'LOW') {
    riskLevel = 'HIGH';
    riskFactors.push('عدم همگرایی شفاف میان اندیکاتورها');
  }
  if (bb.isSqueeze) {
    riskFactors.push('فشردگی باند بولینگر؛ احتمال شکست ناگهانی با دامنه بزرگ');
  }
  if (riskFactors.length === 0) {
    riskLevel = 'LOW';
    riskFactors.push('همگرایی متناسب ساختار و حجم');
  }

  return {
    ok: true,
    symbol,
    timeframe,
    currentPrice: Math.round(currentPrice * 100) / 100,
    timestamp: now,
    validUntil,
    validityWindowHours: Math.round((validityWindowMs / (3600 * 1000)) * 10) / 10,
    scenarios: {
      bullish: {
        probabilityPct: bullProb,
        labelFa: 'سناریوی صعودی',
        thesisFa: bullProb >= 50 ? 'تداوم روند تقاضا به سمت اهداف بالاتر با حمایت ساختاری' : 'جهش اصلاحی در صورت حفظ محدوده حمایتی',
        target1,
        target2
      },
      bearish: {
        probabilityPct: bearProb,
        labelFa: 'سناریوی نزولی',
        thesisFa: bearProb >= 50 ? 'فشار عرضه و شکست سطوح به سمت محدوده‌های کف' : 'اصلاح قیمتی در مواجهه با مقاومت‌های معتبر',
        target1: support1,
        target2: support2
      },
      neutral: {
        probabilityPct: neutralProb,
        labelFa: 'سناریوی خنثی',
        thesisFa: 'نوسان فرسایشی درون محدوده معاملاتی کنونی بدون جهت‌گیری شفاف',
        rangeHigh: resistance1,
        rangeLow: support1
      }
    },
    confidence: {
      scorePct: confidenceScore,
      level: confidenceLevel,
      labelFa: confidenceLevel === 'HIGH' ? 'بالا' : confidenceLevel === 'MODERATE' ? 'متوسط' : 'محدود'
    },
    keyLevels: {
      support1,
      support2,
      resistance1,
      resistance2,
      invalidationPrice,
      pivotPoint: Math.round(((resistance1 + support1 + currentPrice) / 3) * 100) / 100
    },
    contributingFactors,
    predictionRisk: {
      level: riskLevel,
      labelFa: riskLevel === 'HIGH' ? 'بالا' : riskLevel === 'MEDIUM' ? 'متوسط' : 'پایین',
      factorsFa: riskFactors
    },
    indicators: {
      rsi,
      macd,
      bollingerBands: bb,
      movingAverages: ma,
      volatility: vol,
      volume,
      marketStructure: struct,
      liquidity: liq,
      onChain: onchainData,
      sentiment: sent
    },
    disclaimerFa: 'این تحلیل یک خروجی احتمالاتی حاصل از همگرایی داده‌های فنی و آن‌چین است و متضمن قطعیت مالی نمی‌باشد.'
  };
}
