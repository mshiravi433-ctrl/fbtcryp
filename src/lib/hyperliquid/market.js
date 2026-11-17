/**
 * HYPERLIQUID — READ-ONLY MARKET AND FILLS (pure request/parse, injectable fetch)
 * ---------------------------------------------------------------------------
 * Every call here is an /info POST. Nothing in this file signs or sends an
 * order. Missing or malformed data becomes null, never zero.
 */

import { HL_INFO_URL, HL_ERRORS } from './readonly.js';

export const HL_MARKET_TYPES = Object.freeze(['meta', 'metaAndAssetCtxs', 'allMids', 'candleSnapshot', 'userFillsByTime']);

/** Market names as Hyperliquid spells them (e.g. BTC, ETH, kPEPE). HIP-3 'dex:NAME' markets are excluded. */
export const HL_COIN_NAME = /^[A-Za-z0-9]{1,16}$/;

const CANDLE_INTERVAL_MS = Object.freeze({ '1h': 3600000, '4h': 14400000, '1d': 86400000 });
export const AI_ANALYSIS_MIN_CLOSED_BARS = 26;

async function postInfo(body, { fetchImpl = globalThis.fetch, timeoutMs = 8000, url = HL_INFO_URL } = {}) {
  if (!HL_MARKET_TYPES.includes(body?.type)) return { ok: false, code: HL_ERRORS.BAD_TYPE };
  if (typeof fetchImpl !== 'function') return { ok: false, code: HL_ERRORS.NETWORK };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller?.signal
    });
    if (res.status === 429) return { ok: false, code: HL_ERRORS.RATE_LIMITED };
    if (!res.ok) return { ok: false, code: HL_ERRORS.HTTP_ERROR, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (cause) {
    if (cause?.name === 'AbortError') return { ok: false, code: HL_ERRORS.TIMEOUT };
    return { ok: false, code: HL_ERRORS.NETWORK };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Prefer a real mid, then a real mark; zero and malformed prices are unknown. */
export function usableMarketPrice(market) {
  for (const candidate of [market?.midPx, market?.markPx]) {
    if (Number.isFinite(candidate) && candidate > 0) return candidate;
  }
  return null;
}

function normalizeClosedCandles(candles, interval, now) {
  const duration = CANDLE_INTERVAL_MS[interval];
  if (!duration || !Array.isArray(candles) || !Number.isFinite(now)) return [];
  const byTime = new Map();
  for (const raw of candles) {
    const candle = {
      t: num(raw?.t),
      o: num(raw?.o),
      h: num(raw?.h),
      l: num(raw?.l),
      c: num(raw?.c),
      v: num(raw?.v)
    };
    if (!Number.isFinite(candle.t) || candle.t < 1_000_000_000_000 || candle.t + duration > now) continue;
    if (![candle.o, candle.h, candle.l, candle.c].every((value) => Number.isFinite(value) && value > 0)) continue;
    if (candle.h < Math.max(candle.o, candle.c) || candle.l > Math.min(candle.o, candle.c) || candle.h < candle.l) continue;
    if (candle.v !== null && candle.v < 0) candle.v = null;
    byTime.set(candle.t, candle);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function exponentialAverage(values, period) {
  if (values.length < period) return null;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const weight = 2 / (period + 1);
  let average = seed;
  for (let index = period; index < values.length; index += 1) {
    average = values[index] * weight + average * (1 - weight);
  }
  return average;
}

function relativeStrengthIndex(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
  }
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function averageTrueRangePct(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].c;
    ranges.push(Math.max(current.h - current.l, Math.abs(current.h - previousClose), Math.abs(current.l - previousClose)));
  }
  if (ranges.length < period) return null;
  let average = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index += 1) average = (average * (period - 1) + ranges[index]) / period;
  return average / candles[candles.length - 1].c * 100;
}

/**
 * A deterministic, descriptive snapshot from complete candles only. It makes
 * no long/short call: missing bars stay null, and the caller decides whether
 * the history is deep enough to submit to the AI analyst.
 */
export function summarizeCandles(candles, { interval = '1h', now = Date.now(), midPrice = null } = {}) {
  const duration = CANDLE_INTERVAL_MS[interval];
  const rows = normalizeClosedCandles(candles, interval, now);
  const closes = rows.map((row) => row.c);
  const dailyBars = duration ? Math.max(1, Math.round(86400000 / duration)) : null;
  const last = rows[rows.length - 1] || null;
  const contiguous = rows.length >= AI_ANALYSIS_MIN_CLOSED_BARS
    && rows.every((row, index) => index === 0 || row.t - rows[index - 1].t === duration);
  const pctChange = (current, previous) => previous > 0 && Number.isFinite(current)
    ? ((current / previous) - 1) * 100 : null;
  const ema12 = exponentialAverage(closes, 12);
  const ema26 = exponentialAverage(closes, 26);
  const recentDay = dailyBars ? rows.slice(-dailyBars) : [];
  const rangeHigh = recentDay.length === dailyBars ? Math.max(...recentDay.map((row) => row.h)) : null;
  const rangeLow = recentDay.length === dailyBars ? Math.min(...recentDay.map((row) => row.l)) : null;
  const rangeWidthPct = rangeHigh !== null && last?.c > 0 ? (rangeHigh - rangeLow) / last.c * 100 : null;
  const price = Number.isFinite(midPrice) && midPrice > 0 ? midPrice : null;
  const lastClosedAt = last ? last.t + duration : null;
  const fresh = lastClosedAt !== null && lastClosedAt <= now && now - lastClosedAt <= duration * 2;
  const complete = rows.length >= AI_ANALYSIS_MIN_CLOSED_BARS && contiguous && fresh;
  return {
    source: 'hyperliquid_info_candleSnapshot',
    interval,
    dataStatus: complete ? 'live' : rows.length ? 'partial' : 'unavailable',
    completedBars: rows.length,
    contiguous,
    lastClosedAt,
    currentMid: price,
    returnsPct: {
      oneBar: rows.length >= 2 ? pctChange(last.c, rows[rows.length - 2].c) : null,
      twentyFourHours: dailyBars && rows.length > dailyBars
        ? pctChange(last.c, rows[rows.length - dailyBars - 1].c) : null
    },
    ema: {
      period12: ema12,
      period26: ema26,
      spreadPct: ema12 !== null && ema26 > 0 ? (ema12 / ema26 - 1) * 100 : null
    },
    rsi14: relativeStrengthIndex(closes),
    atr14Pct: averageTrueRangePct(rows),
    range24h: rangeHigh !== null && rangeLow !== null
      ? { high: rangeHigh, low: rangeLow, widthPct: rangeWidthPct }
      : null
  };
}

/**
 * Every perp market in one map: coin → { asset, szDecimals, maxLeverage, onlyIsolated,
 * markPx, midPx, dayNtlVlm, openInterest }. `universe[i]` and `ctxs[i]` describe the
 * same market (same index), so they are joined by position, as the API defines.
 * A market with no usable name or size decimals is skipped, never guessed.
 */
export function parseMarkets(metaRaw, ctxsRaw) {
  const universe = metaRaw?.universe;
  if (!Array.isArray(universe)) return { ok: false, code: HL_ERRORS.BAD_RESPONSE };
  const ctxs = Array.isArray(ctxsRaw) ? ctxsRaw : [];
  const markets = {};
  universe.forEach((row, asset) => {
    if (!row || typeof row.name !== 'string' || !HL_COIN_NAME.test(row.name)) return;
    if (!Number.isInteger(row.szDecimals) || row.szDecimals < 0 || row.isDelisted === true) return;
    const ctx = ctxs[asset] || {};
    markets[row.name] = {
      coin: row.name,
      asset,
      szDecimals: row.szDecimals,
      maxLeverage: Number.isInteger(row.maxLeverage) && row.maxLeverage > 0 ? row.maxLeverage : null,
      onlyIsolated: row.onlyIsolated === true,
      markPx: num(ctx.markPx),
      midPx: num(ctx.midPx),
      dayNtlVlm: num(ctx.dayNtlVlm),
      openInterest: num(ctx.openInterest)
    };
  });
  return { ok: true, markets };
}

/** Markets with a live price and at least `minVolumeUsd` traded in 24 hours, busiest first. */
export function eligibleMarkets(markets, { minVolumeUsd }) {
  return Object.values(markets || {})
    .filter((m) => Number.isFinite(m.dayNtlVlm) && m.dayNtlVlm >= minVolumeUsd && usableMarketPrice(m) !== null)
    .sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
}

export async function fetchMarkets(options) {
  const res = await postInfo({ type: 'metaAndAssetCtxs' }, options);
  if (!res.ok) return res;
  if (!Array.isArray(res.data) || res.data.length < 2) return { ok: false, code: HL_ERRORS.BAD_RESPONSE };
  return parseMarkets(res.data[0], res.data[1]);
}

export async function fetchMid(coin, options) {
  const res = await postInfo({ type: 'allMids' }, options);
  if (!res.ok) return res;
  const mid = num(res.data?.[coin]);
  return mid && mid > 0 ? { ok: true, mid } : { ok: false, code: HL_ERRORS.BAD_RESPONSE };
}

/** Hourly (or other) candles, reduced to the fields an analyst needs. */
export async function fetchCandles(coin, { interval = '1h', count = 48, now = Date.now() } = {}, options) {
  const ms = CANDLE_INTERVAL_MS[interval];
  if (!ms) return { ok: false, code: HL_ERRORS.BAD_TYPE };
  const startTime = now - ms * count;
  const res = await postInfo({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime: now } }, options);
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return { ok: false, code: HL_ERRORS.BAD_RESPONSE };
  return { ok: true, candles: normalizeClosedCandles(res.data, interval, now) };
}

/**
 * Fills since `startTime` for `user`, summarised as realised PnL after fees.
 * closedPnl is the gross PnL of closing fills; fees are subtracted separately.
 */
export async function fetchRealisedSince(user, startTime, options) {
  const res = await postInfo({ type: 'userFillsByTime', user, startTime }, options);
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return { ok: false, code: HL_ERRORS.BAD_RESPONSE };
  let realised = 0;
  let fees = 0;
  let count = 0;
  for (const f of res.data) {
    const pnl = num(f?.closedPnl);
    const fee = num(f?.fee);
    if (pnl === null || fee === null) return { ok: false, code: HL_ERRORS.BAD_RESPONSE };
    realised += pnl;
    fees += fee;
    count += 1;
  }
  return { ok: true, realisedPnlUsd: realised - fees, feesUsd: fees, fillCount: count };
}
