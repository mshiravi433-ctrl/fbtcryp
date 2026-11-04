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
    .filter((m) => Number.isFinite(m.dayNtlVlm) && m.dayNtlVlm >= minVolumeUsd && (m.midPx > 0 || m.markPx > 0))
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
  const ms = { '1h': 3600000, '4h': 14400000, '1d': 86400000 }[interval];
  if (!ms) return { ok: false, code: HL_ERRORS.BAD_TYPE };
  const startTime = now - ms * count;
  const res = await postInfo({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime: now } }, options);
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return { ok: false, code: HL_ERRORS.BAD_RESPONSE };
  const candles = res.data
    .map((c) => ({ t: num(c.t), o: num(c.o), h: num(c.h), l: num(c.l), c: num(c.c), v: num(c.v) }))
    .filter((c) => c.t !== null && c.c !== null);
  return { ok: true, candles };
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
