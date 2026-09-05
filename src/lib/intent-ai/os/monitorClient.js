/**
 * FBT INTENT OS — MARKET MONITOR CLIENT (browser half).
 * ---------------------------------------------------------------------------
 * Wires "بازار را بپای / watch BTC / if ETH < 3000 tell me" to the real server
 * monitor registry (POST /api/v1/ai/monitors …). The server stores, prices and
 * evaluates; this file only talks to it and formats results for the chat.
 *
 * Fail-closed: when the gateway is unreachable the caller gets
 * { ok:false, error:'UNAVAILABLE' } — never a local fake monitor.
 */

import { apiBase } from '../../apiBase.js';

const TIMEOUT_MS = 10000;

const base = () => {
  try { return (typeof apiBase === 'function' ? apiBase() : '') || '/api'; } catch { return '/api'; }
};

async function call(path, { method = 'GET', body = null } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const device = (() => {
      try { return window.localStorage.getItem('fbt.ai.device.v1') || ''; } catch { return ''; }
    })();
    const res = await fetch(`${base()}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(device ? { 'x-fbt-device': device } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text.slice(0, 160) }; } })() : {};
    if (!res.ok) return { ok: false, status: res.status, ...json };
    return { ok: true, status: res.status, ...json };
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- */
/* pure parsing — tested by the probe, no network here                        */
/* ------------------------------------------------------------------------- */

const ASSET_HINTS = Object.freeze({
  btc: 'BTC', bitcoin: 'BTC', '₿': 'BTC', 'بیت‌کوین': 'BTC', 'بیتکوین': 'BTC', 'بیت کوین': 'BTC',
  eth: 'ETH', ethereum: 'ETH', ether: 'ETH', 'اتریوم': 'ETH', 'اتريم': 'ETH', 'اتیريوم': 'ETH',
  sol: 'SOL', solana: 'SOL', 'سولانا': 'SOL',
  bnb: 'BNB', 'binance': 'BNB', 'بایننس': 'BNB',
  arb: 'ARB', arbitrum: 'ARB', 'ارب': 'ARB',
  avax: 'AVAX', avalanche: 'AVAX',
  link: 'LINK', chainlink: 'LINK',
  usdt: 'USDT', tether: 'USDT', 'تتر': 'USDT',
  usdc: 'USDC',
  doge: 'DOGE', dogecoin: 'DOGE',
  matic: 'MATIC', polygon: 'MATIC',
  xrp: 'XRP', ripple: 'XRP', ada: 'ADA', trx: 'TRON', ton: 'TON', sui: 'SUI', dot: 'DOT'
});

/**
 * Resolve the asset a monitor sentence names. Returns symbol or null.
 * Only known symbols return — a token we cannot price is refused honestly.
 */
export function resolveMonitorAsset(text) {
  const s = String(text || '').toLowerCase();
  for (const [k, v] of Object.entries(ASSET_HINTS)) {
    if (new RegExp(`(^|[^a-z0-9])${k}($|[^a-z0-9])`, 'i').test(s)) return v;
  }
  return null;
}

/**
 * Parse "بازار را بپای" style sentences into a monitor draft.
 *
 * Supports:
 *   «بازار را بپای»                         → MARKET monitor (all assets notion)
 *   «بازار BTC را بپای»                     → explicit asset
 *   «اگر ETH کمتر از 3000 شد خبر بده»       → PRICE BELOW 3000
 *   «BTC رو پایش کن، بالای 100k خبر بده»   → PRICE ABOVE 100000
 *   «هر ساعت چک کن»                         → interval hint
 *
 * Returns { monitor } or { error }. Threshold parsing understands k/K suffixes
 * and fa digits; anything unreadable is an error — never a guessed number.
 */
export function parseMonitorRequest(text, { asset = null, intervalMinutes = 60, baseline = null, locale = 'fa' } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'EMPTY' };

  const foundAsset = asset ? String(asset).toUpperCase() : resolveMonitorAsset(raw);
  const isMarketWide = !foundAsset && /بپای|پایش|نظارت|watch|monitor|follow/i.test(raw);

  const numFrom = (m) => {
    if (!m) return null;
    const fa = m.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const n = parseFloat(fa.replace(/[kK,]/g, ''));
    if (!Number.isFinite(n)) return null;
    return /k|K/.test(m) ? n * 1000 : n;
  };

  const above = raw.match(/(?:بالاتر|بالای|بیشتر|فوق|بیش از|above|over|≥|>)\s*([0-9۰-۹.,kK]+)/i);
  const below = raw.match(/(?:کمتر از|کمتر|پایین‌تر از|پایین‌تر|زیر|below|under|≤|<)\s*([0-9۰-۹.,kK]+)/i);
  const at = raw.match(/(?:به)\s*([0-9۰-۹.,kK]+)\s*(?:رسید(?:ه)?|برسه|برسد)|(?:رسید(?:ه)?(?:\s*به)?)\s*([0-9۰-۹.,kK]+)|(?:hits?|reaches|at)\s*([0-9۰-۹.,kK]+)/i);
  const pct = /%|درصد|pct/i.test(raw);
  const threshold = numFrom(pct ? (above?.[1] || below?.[1] || at?.[1] || at?.[2] || at?.[3]) : (above?.[1] || below?.[1] || at?.[1] || at?.[2] || at?.[3]));

  if (!isMarketWide && !threshold) return { error: 'NO_CONDITION', asset: foundAsset };
  const operator = above ? 'ABOVE' : (below ? 'BELOW' : 'ABOVE');
  const metric = pct ? 'PERCENT_CHANGE' : 'PRICE';

  const intervalMatch = raw.match(/(?:هر|every|each)\s*(\d+)?\s*(?:دقیقه|دقیقه|ساعت|روز|دقیقه|min(?:ute)?s?|hour?s?|day?s?)/i);
  let interval = intervalMinutes;
  if (intervalMatch) {
    const n = Number(intervalMatch[1] || 1);
    if (/ساعت|hour/i.test(intervalMatch[0])) interval = n * 60;
    else if (/روز|day/i.test(intervalMatch[0])) interval = n * 1440;
    else interval = Math.min(n, 1440);
    const allowed = [5, 15, 30, 60, 180, 360, 720, 1440];
    interval = allowed.includes(interval) ? interval : (interval <= 15 ? 15 : interval <= 60 ? 60 : interval <= 360 ? 360 : 720);
  }

  return {
    monitor: {
      type: isMarketWide ? 'MARKET' : 'ASSET',
      metric,
      operator,
      threshold,
      baseline,
      intervalMinutes: interval,
      asset: foundAsset ? { symbol: foundAsset } : null,
      label: null,
      locale
    }
  };
}

/** Human detail line for a monitor card, keyed so the UI can localize. */
export function monitorDetail(m, locale = 'fa') {
  const symbol = m?.asset?.symbol || (m?.type === 'MARKET' ? 'MARKET' : '—');
  const t = m?.threshold;
  const op = m?.operator === 'BELOW' ? 'below' : 'above';
  const metric = m?.metric === 'PERCENT_CHANGE' ? 'pct' : 'price';
  return { symbol, op, metric, threshold: t, intervalMinutes: m?.intervalMinutes || 60, status: m?.status || 'ACTIVE' };
}

/* ------------------------------------------------------------------------- */
/* API                                                                        */
/* ------------------------------------------------------------------------- */

export const listMonitors = () => call('/v1/ai/monitors');

export const createMonitor = (draft) => call('/v1/ai/monitors', { method: 'POST', body: draft });

export const pauseMonitor = (id) => call(`/v1/ai/monitors/${encodeURIComponent(String(id || ''))}/pause`, { method: 'POST' });
export const resumeMonitor = (id) => call(`/v1/ai/monitors/${encodeURIComponent(String(id || ''))}/resume`, { method: 'POST' });
export const cancelMonitor = (id) => call(`/v1/ai/monitors/${encodeURIComponent(String(id || ''))}/cancel`, { method: 'POST' });
export const deleteMonitor = (id) => call(`/v1/ai/monitors/${encodeURIComponent(String(id || ''))}`, { method: 'DELETE' });
export const evaluateMonitorNow = (id) => call(`/v1/ai/monitors/${encodeURIComponent(String(id || ''))}/evaluate`, { method: 'POST' });
export const monitorEngineStatus = () => call('/v1/ai/monitors/status');
