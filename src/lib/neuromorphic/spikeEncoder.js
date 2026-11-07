/**
 * FBT NEUROMORPHIC 2050 — PHASE 1: EVENT-DRIVEN SPIKE ENCODER
 * ===========================================================================
 * Converts real market, candle, and portfolio observations into sparse,
 * biologically inspired ON/OFF polarized spike trains and graded currents.
 *
 * Honesty contract:
 *   · Never fabricates observations: if fewer than 3 valid candles or 0 priced
 *     market rows are provided, returns `{ ok: false, reason: ... }`.
 *   · Send-on-Delta (Event-Driven): flat, unchanged inputs emit zero spikes,
 *     keeping compute sparse and energy-proportional on mobile & desktop.
 */

export const SPIKE_ENCODER_SCHEMA = 'fbt.neuromorphic.spike-encoder.v1';

/** 8 canonical sensory dimensions → 16 polarized ON/OFF spiking channels. */
export const SENSORY_AXES = Object.freeze([
  'returnShort',       // 0,1: immediate price impulse (+ON / -OFF)
  'returnMedium',      // 2,3: multi-bar momentum (+ON / -OFF)
  'realizedVol',       // 4,5: high turbulence (+ON) vs compression (-OFF)
  'volumeImpulse',     // 6,7: volume surge (+ON) vs liquidity drought (-OFF)
  'rsiDeviation',      // 8,9: overbought tension (+ON) vs oversold tension (-OFF)
  'rangePosition',     // 10,11: breakout near highs (+ON) vs breakdown near lows (-OFF)
  'breadthSkew',       // 12,13: market-wide advance (+ON) vs decline (-OFF)
  'structuralStress'   // 14,15: wick rejection / dispersion stress (+ON) vs calm (-OFF)
]);

export const SENSORY_CHANNELS = SENSORY_AXES.length * 2; // 16 channels

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tanhSafe = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  if (n > 12) return 1;
  if (n < -12) return -1;
  return Math.tanh(n);
};

/**
 * Extract normalized sensory vector [-1, +1]^8 from real OHLCV candles.
 * Requires at least 3 finite candles; never invents missing prices.
 */
export function featuresFromCandles(candles = [], { breadthRatio = null } = {}) {
  if (!Array.isArray(candles)) {
    return { ok: false, reason: 'INVALID_CANDLES' };
  }
  const clean = candles
    .map((c) => ({
      open: Number(c?.open ?? c?.o),
      high: Number(c?.high ?? c?.h),
      low: Number(c?.low ?? c?.l),
      close: Number(c?.close ?? c?.c),
      volume: Number(c?.volume ?? c?.v),
      time: c?.time ?? c?.t ?? null
    }))
    .filter((c) => Number.isFinite(c.close) && c.close > 0 && Number.isFinite(c.high) && Number.isFinite(c.low));

  if (clean.length < 3) {
    return { ok: false, reason: 'INSUFFICIENT_OBSERVATIONS', count: clean.length };
  }

  const n = clean.length;
  const last = clean[n - 1];
  const prev = clean[n - 2];
  const lookback = clean.slice(Math.max(0, n - 24));

  // 1. Short log-return (1 bar), scaled by local volatility
  const returns = [];
  for (let i = 1; i < lookback.length; i += 1) {
    const r = Math.log(lookback[i].close / lookback[i - 1].close);
    if (Number.isFinite(r)) returns.push(r);
  }
  const rShortRaw = Math.log(last.close / prev.close);
  const meanR = returns.reduce((s, v) => s + v, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((s, v) => s + (v - meanR) ** 2, 0) / Math.max(1, returns.length);
  const sigma = Math.max(1e-5, Math.sqrt(variance));

  const returnShort = tanhSafe(rShortRaw / (sigma * 1.8));

  // 2. Medium-horizon return (up to 8 bars)
  const anchorIdx = Math.max(0, n - Math.min(9, n));
  const rMedRaw = Math.log(last.close / clean[anchorIdx].close);
  const medScale = sigma * Math.sqrt(Math.max(1, n - 1 - anchorIdx)) * 1.5;
  const returnMedium = tanhSafe(rMedRaw / Math.max(1e-5, medScale));

  // 3. Realized volatility regime relative to baseline 1.5% bar vol
  const realizedVol = tanhSafe((sigma - 0.012) / 0.018);

  // 4. Volume impulse (when volume exists; otherwise neutral 0 — never faked)
  const finiteVols = lookback.map((c) => c.volume).filter((v) => Number.isFinite(v) && v > 0);
  let volumeImpulse = 0;
  if (finiteVols.length >= 3 && Number.isFinite(last.volume) && last.volume > 0) {
    const sorted = [...finiteVols].sort((a, b) => a - b);
    const medianVol = sorted[Math.floor(sorted.length / 2)] || 1;
    volumeImpulse = tanhSafe(Math.log(last.volume / medianVol));
  }

  // 5. RSI-14 style gain/loss balance mapped to [-1, +1]
  let gains = 0;
  let losses = 0;
  for (const r of returns.slice(-14)) {
    if (r > 0) gains += r;
    else losses -= r;
  }
  const rsTotal = gains + losses;
  const rsi01 = rsTotal > 1e-9 ? gains / rsTotal : 0.5;
  const rsiDeviation = clamp((rsi01 - 0.5) * 2.2, -1, 1);

  // 6. Range position within lookback high-low envelope
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of lookback) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  const span = hi - lo;
  const rangePosition = span > 1e-9 ? clamp(((last.close - lo) / span) * 2 - 1, -1, 1) : 0;

  // 7. Breadth skew (if market breadth is supplied, else 0)
  const breadthSkew = breadthRatio != null && Number.isFinite(Number(breadthRatio))
    ? clamp((Number(breadthRatio) - 0.5) * 2.2, -1, 1)
    : 0;

  // 8. Structural intrabar stress (wick-to-body tension & high-low shock)
  const barRange = Math.max(0, last.high - last.low);
  const body = Math.abs(last.close - last.open || 0);
  const wickShare = barRange > 1e-9 ? (barRange - body) / barRange : 0;
  const rangeVsSigma = (barRange / last.close) / Math.max(1e-5, sigma);
  const structuralStress = tanhSafe((wickShare * 0.8 + (rangeVsSigma - 1.2) * 0.5));

  const vector = new Float32Array([
    returnShort,
    returnMedium,
    realizedVol,
    volumeImpulse,
    rsiDeviation,
    rangePosition,
    breadthSkew,
    structuralStress
  ]);

  return {
    ok: true,
    vector,
    meta: {
      lastClose: last.close,
      prevClose: prev.close,
      lastTime: last.time,
      return1Bar: rShortRaw,
      volatility: sigma,
      barsUsed: lookback.length
    }
  };
}

/**
 * Extract normalized sensory vector [-1, +1]^8 from a live Market Pulse / market rows.
 * Never invents missing rows; requires at least 3 valid priced assets.
 */
export function featuresFromMarketPulse({ markets = [], pulse = null } = {}) {
  const valid = Array.isArray(markets)
    ? markets.filter((m) => {
        const p = Number(m?.current_price ?? m?.price);
        const ch = Number(m?.price_change_percentage_24h ?? m?.change24h);
        return Number.isFinite(p) && p > 0 && Number.isFinite(ch);
      })
    : [];

  if (valid.length < 3 && !(pulse?.breadth?.counted >= 3)) {
    return { ok: false, reason: 'INSUFFICIENT_MARKET_ROWS', count: valid.length };
  }

  const changes24h = valid.map((m) => Number(m.price_change_percentage_24h ?? m.change24h) / 100);
  const changes7d = valid
    .map((m) => Number(m.price_change_percentage_7d_in_currency ?? m.change7d))
    .filter((v) => Number.isFinite(v))
    .map((v) => v / 100);

  const mean24 = changes24h.length
    ? changes24h.reduce((s, v) => s + v, 0) / changes24h.length
    : (Number(pulse?.medianChange24h) || 0) / 100;
  const mean7d = changes7d.length
    ? changes7d.reduce((s, v) => s + v, 0) / changes7d.length
    : mean24;

  const disp = changes24h.length
    ? Math.sqrt(changes24h.reduce((s, v) => s + (v - mean24) ** 2, 0) / changes24h.length)
    : 0.025;

  const upCount = pulse?.breadth?.advancers != null
    ? Number(pulse.breadth.advancers)
    : changes24h.filter((c) => c > 0).length;
  const totalCount = pulse?.breadth?.counted != null
    ? Math.max(1, Number(pulse.breadth.counted))
    : Math.max(1, changes24h.length);
  const breadthRatio = upCount / totalCount;

  // Turnover ratio (volume / mcap)
  const turnovers = valid
    .map((m) => {
      const vol = Number(m.total_volume ?? m.volume24h ?? m.volume);
      const cap = Number(m.market_cap ?? m.marketCap ?? m.mcap);
      return Number.isFinite(vol) && Number.isFinite(cap) && cap > 0 ? vol / cap : null;
    })
    .filter((v) => v !== null);
  const meanTurnover = turnovers.length
    ? turnovers.reduce((s, v) => s + v, 0) / turnovers.length
    : 0.06;

  const vector = new Float32Array([
    tanhSafe(mean24 / 0.045),                          // returnShort
    tanhSafe(mean7d / 0.12),                           // returnMedium
    tanhSafe((disp - 0.035) / 0.04),                   // realizedVol (cross-sectional dispersion)
    tanhSafe((meanTurnover - 0.065) / 0.05),           // volumeImpulse
    clamp((breadthRatio - 0.5) * 2.1, -1, 1),          // rsiDeviation proxy
    tanhSafe(mean24 / Math.max(0.01, disp)),           // rangePosition / signal-to-noise
    clamp((breadthRatio - 0.5) * 2.4, -1, 1),          // breadthSkew
    tanhSafe((disp - Math.abs(mean24)) / 0.05)         // structuralStress (divergence)
  ]);

  // Anchor price (BTC or top market cap asset) for realized reward tracking
  const anchor = valid.find((m) => String(m.symbol || '').toUpperCase() === 'BTC') || valid[0] || null;
  const anchorPrice = anchor ? Number(anchor.current_price ?? anchor.price) : null;

  return {
    ok: true,
    vector,
    meta: {
      assetsCounted: totalCount,
      breadthRatio,
      meanChange24h: mean24,
      dispersion: disp,
      anchorSymbol: anchor ? String(anchor.symbol || '').toUpperCase() : null,
      lastClose: Number.isFinite(anchorPrice) ? anchorPrice : null
    }
  };
}

/**
 * Stateful Send-on-Delta + Leaky Integrator Spike Encoder.
 * Emits binary spikes {0, 1} across 16 ON/OFF channels plus graded currents.
 */
export function createSpikeEncoder({ deltaThreshold = 0.06, accumulatorThreshold = 0.32 } = {}) {
  const prevValues = new Float32Array(SENSORY_AXES.length);
  const accumulators = new Float32Array(SENSORY_CHANNELS);
  let initialized = false;

  function encode(featureVector) {
    if (!featureVector || featureVector.length < SENSORY_AXES.length) {
      throw new Error('SPIKE_ENCODER_VECTOR_TOO_SHORT');
    }
    const spikes = new Float32Array(SENSORY_CHANNELS);
    const currents = new Float32Array(SENSORY_CHANNELS);
    let activeSpikes = 0;

    for (let i = 0; i < SENSORY_AXES.length; i += 1) {
      const val = clamp(Number(featureVector[i]) || 0, -1, 1);
      const delta = initialized ? val - prevValues[i] : val;
      prevValues[i] = val;

      const onIdx = i * 2;
      const offIdx = i * 2 + 1;

      // Positive drive + positive delta shock feed ON channel; negative feed OFF channel
      const onDrive = Math.max(0, val) * 0.65 + Math.max(0, delta) * 0.85;
      const offDrive = Math.max(0, -val) * 0.65 + Math.max(0, -delta) * 0.85;

      currents[onIdx] = onDrive;
      currents[offIdx] = offDrive;

      // Event-driven Send-on-Delta + Integrate-and-Fire sensory receptor
      accumulators[onIdx] = accumulators[onIdx] * 0.62 + onDrive;
      accumulators[offIdx] = accumulators[offIdx] * 0.62 + offDrive;

      if (accumulators[onIdx] >= accumulatorThreshold || delta >= deltaThreshold * 2.2) {
        spikes[onIdx] = 1;
        accumulators[onIdx] = Math.max(0, accumulators[onIdx] - accumulatorThreshold);
        activeSpikes += 1;
      }
      if (accumulators[offIdx] >= accumulatorThreshold || -delta >= deltaThreshold * 2.2) {
        spikes[offIdx] = 1;
        accumulators[offIdx] = Math.max(0, accumulators[offIdx] - accumulatorThreshold);
        activeSpikes += 1;
      }
    }

    initialized = true;
    return {
      spikes,
      currents,
      activeSpikes,
      sparsity: 1 - activeSpikes / SENSORY_CHANNELS
    };
  }

  function reset() {
    prevValues.fill(0);
    accumulators.fill(0);
    initialized = false;
  }

  return { encode, reset, channels: SENSORY_CHANNELS };
}
