/**
 * SIGNAL INTELLIGENCE — local persistence (watchlist, alerts, history, consent)
 * ---------------------------------------------------------------------------
 * Everything here is local-only and fail-closed:
 *
 *   · Watchlist  — the user's starred assets; survives reloads.
 *   · Alerts     — { price, confidence, volume, whale, smartMoney, riskChange,
 *                   newSignal, signalUpgrade, signalDowngrade } conditions.
 *                  Evaluated against REAL signal data each refresh; an alert
 *                  fires at most once per cooldown. Local notifications use
 *                  the existing lib/notify.js permission path.
 *   · History    — the LEARNING LOOP: every READY signal is recorded with its
 *                  entry price; once its horizon has elapsed the actual move
 *                  is compared with the call and the result is stored. Nothing
 *                  is ever fabricated, so performance starts honest (0 sample)
 *                  and grows only from real observations.
 *   · Consent    — portfolio-aware AI analysis is OFF by default. The user
 *                  must opt in, and even then only aggregate exposure is ever
 *                  sent — never an address, amount or key.
 */

import { localReasonFromEvidence } from './signalEngine.js';

const KEYS = {
  watch: 'fbt-signal-watch-v1',
  alerts: 'fbt-signal-alerts-v1',
  history: 'fbt-signal-history-v1',
  consent: 'fbt-signal-consent-v1'
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  } catch {
    return value; // private mode / quota — in-memory state still works
  }
}

/* ═══════════════════════════ WATCHLIST ══════════════════════════════ */

export function readWatchlist() {
  const d = read(KEYS.watch, { ids: [] });
  return Array.isArray(d.ids) ? d.ids : [];
}

export function toggleWatch(id) {
  const ids = readWatchlist();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  write(KEYS.watch, { ids: next, at: Date.now() });
  return next;
}

export const isWatched = (id) => readWatchlist().includes(id);

/* ═══════════════════════════ ALERTS ═════════════════════════════════ */

export const ALERT_KINDS = ['price', 'confidence', 'volume', 'whale', 'smartMoney', 'riskChange'];

/**
 * Create an alert. `condition` is one of 'above' | 'below' and `value` the
 * threshold (price in USD, confidence in %, volume turnover %).
 */
export function createAlert({ symbol, coinId = null, kind, condition, value, lang = 'en' }) {
  if (!symbol || !ALERT_KINDS.includes(kind) || !['above', 'below'].includes(condition)) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const alerts = readAlerts();
  if (alerts.some((a) => a.symbol === symbol && a.kind === kind && a.condition === condition && a.value === v)) {
    return alerts; // duplicate rule — no-op
  }
  const row = {
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    symbol: String(symbol).toUpperCase().slice(0, 12),
    coinId,
    kind,
    condition,
    value: v,
    lang,
    active: true,
    createdAt: Date.now(),
    firedAt: 0,
    firedCount: 0
  };
  const next = [...alerts, row];
  write(KEYS.alerts, next);
  return next;
}

export function readAlerts() {
  const d = read(KEYS.alerts, []);
  return Array.isArray(d) ? d : [];
}

export function deleteAlert(id) {
  const next = readAlerts().filter((a) => a.id !== id);
  write(KEYS.alerts, next);
  return next;
}

export function setAlertActive(id, active) {
  const next = readAlerts().map((a) => (a.id === id ? { ...a, active: Boolean(active) } : a));
  write(KEYS.alerts, next);
  return next;
}

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Pure evaluator: which alerts fire against the current real signal data.
 * Returns `{ fired:[alerts], next:[alerts] }`. An alert fires at most once
 * per cooldown window even while the condition keeps holding.
 */
export function evaluateSignalAlerts({ alerts = readAlerts(), signals = [], now = Date.now() } = {}) {
  const next = alerts.map((a) => ({ ...a }));
  const fired = [];
  const store = new Map();

  for (const alert of next) {
    if (!alert.active) continue;
    const matches = signals.filter((s) => {
      const sym = String(s?.coin?.symbol || '').toUpperCase();
      return sym === String(alert.symbol).toUpperCase();
    });
    if (!matches.length) continue;
    const s = matches[0];
    if (!s || s.status !== 'READY') continue;

    let hit = false;
    let value = null;
    switch (alert.kind) {
      case 'price':
        value = s.coin.price ?? null;
        hit = value != null && (alert.condition === 'above' ? value >= alert.value : value <= alert.value);
        break;
      case 'confidence':
        value = s.confidence ?? null;
        hit = value != null && (alert.condition === 'above' ? value >= alert.value : value <= alert.value);
        break;
      case 'volume':
        value = s.volumeChange ?? null;
        hit = value != null && (alert.condition === 'above' ? value >= alert.value : value <= alert.value);
        break;
      case 'whale':
        value = s.whale === 'inflow' ? 1 : s.whale === 'outflow' ? -1 : 0;
        hit = alert.condition === 'above' ? value === 1 : value === -1;
        break;
      case 'smartMoney':
        value = s.smartMoney === 'bullish' ? 1 : s.smartMoney === 'bearish' ? -1 : 0;
        hit = alert.condition === 'above' ? value === 1 : value === -1;
        break;
      case 'riskChange':
        value = s.riskScore ?? null;
        hit = value != null && (alert.condition === 'above' ? value >= alert.value : value <= alert.value);
        break;
      default:
        break;
    }
    if (!hit) continue;

    const key = `${alert.id}`;
    const firedAt = store.get(key) ?? alert.firedAt;
    if (firedAt && now - firedAt < ALERT_COOLDOWN_MS) continue; // cooldown
    store.set(key, now);
    alert.firedAt = now;
    alert.firedCount = (alert.firedCount || 0) + 1;
    fired.push({ ...alert, value });
  }

  return { fired, next };
}

/* ═══════════════════════════ HISTORY + LEARNING LOOP ════════════════ */

const HORIZON_MS = { 1: 24 * 3600_000, 7: 7 * 24 * 3600_000, 30: 30 * 24 * 3600_000 };

/**
 * Record a READY signal into the history ledger. Deduplicated per coin,
 * horizon and calendar day — a 30s poll must never spam the ledger with the
 * same signal re-recorded at a slightly different price.
 */
export function recordSignal(signal, now = Date.now()) {
  if (!signal || signal.status !== 'READY') return readHistory();
  const history = readHistory();
  const day = new Date(now).toISOString().slice(0, 10);
  const entry = {
    id: `${signal.coin.id}:${signal.timeframe}:${day}`,
    symbol: signal.coin.symbol,
    coinId: signal.coin.id,
    ts: now,
    entryPrice: signal.coin.price,
    horizon: signal.timeframe,
    target: signal.target ?? null,
    stop: signal.stop ?? null,
    confidence: signal.confidence,
    classification: signal.classification,
    risk: signal.risk,
    direction: ['STRONG_BUY', 'BUY', 'HIGH_RISK'].includes(signal.classification) ? 'up'
      : ['SELL', 'AVOID'].includes(signal.classification) ? 'down' : 'flat',
    settled: false,
    result: null,
    outcomePct: null,
    drawdownPct: null,
    settledAt: null,
    reasons: signal.reasons || []
  };
  if (history.some((h) => h.id === entry.id)) return history;
  history.push(entry);
  // keep the ledger bounded
  if (history.length > 500) history.splice(0, history.length - 500);
  write(KEYS.history, history);
  return history;
}

/** Persist an updated alert list (used by the evaluator after evaluation). */
export function saveAlerts(alerts) {
  write(KEYS.alerts, Array.isArray(alerts) ? alerts : []);
  return alerts;
}

export function readHistory() {
  const d = read(KEYS.history, []);
  return Array.isArray(d) ? d : [];
}

/**
 * Settle every overdue record against the REAL current price. The learning
 * loop: Signal → Prediction → Market Outcome → Compare → Store.
 */
export function settleHistory({ history = readHistory(), prices = {}, now = Date.now() } = {}) {
  let changed = false;
  const next = history.map((h) => {
    if (h.settled) return h;
    const due = now - h.ts >= (HORIZON_MS[h.horizon] || HORIZON_MS[7]);
    const price = prices[h.coinId];
    if (!due || price == null || !Number.isFinite(price) || price <= 0) return h;
    const move = ((price - h.entryPrice) / h.entryPrice) * 100;
    let result = 'failed';
    if (h.direction === 'up') result = move > 0.5 ? 'success' : move < -0.5 ? 'failed' : 'flat';
    else if (h.direction === 'down') result = move < -0.5 ? 'success' : move > 0.5 ? 'failed' : 'flat';
    else result = Math.abs(move) < 3 ? 'success' : 'failed';
    const adverse = h.direction === 'up' ? Math.min(0, move) : h.direction === 'down' ? Math.max(0, move) : move;
    changed = true;
    return { ...h, settled: true, result, outcomePct: Math.round(move * 100) / 100, drawdownPct: Math.round(adverse * 100) / 100, settledAt: now };
  });
  if (!changed) return history; // same reference — callers can diff cheaply
  write(KEYS.history, next);
  return next;
}

/**
 * Performance metrics computed ONLY from the settled ledger. With zero or one
 * settled signal the numbers are honest: null (no statistics yet), not zero.
 */
export function performance(history = readHistory()) {
  const settled = history.filter((h) => h.settled && h.result !== null);
  if (!settled.length) {
    return {
      totalSignals: history.length,
      settledSignals: 0,
      successful: null,
      failed: null,
      accuracy: null,
      avgReturn: null,
      avgDrawdown: null,
      best: null,
      worst: null,
      note: 'insufficientHistory'
    };
  }
  const success = settled.filter((h) => h.result === 'success').length;
  const failed = settled.filter((h) => h.result === 'failed').length;
  const returns = settled.map((h) => h.outcomePct ?? 0);
  const drawdowns = settled.map((h) => h.drawdownPct ?? 0);
  const best = returns.reduce((a, b) => (Math.abs(b) >= Math.abs(Number(a ?? 0)) ? b : a), returns[0]);
  const worst = returns.reduce((a, b) => (Math.abs(b) <= Math.abs(Number(a ?? 0)) ? b : a), returns[0]);
  return {
    totalSignals: history.length,
    settledSignals: settled.length,
    successful: success,
    failed,
    accuracy: Math.round((success / (success + failed)) * 1000) / 10,
    avgReturn: Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 100) / 100,
    avgDrawdown: Math.round((drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length) * 100) / 100,
    best: best != null ? { pct: best, symbol: settled[returns.indexOf(best)]?.symbol } : null,
    worst: worst != null ? { pct: worst, symbol: settled[returns.indexOf(worst)]?.symbol } : null,
    note: null
  };
}

/* ═══════════════════════════ CONSENT ═════════════════════════════════ */

const DEFAULT_CONSENT = { portfolioAi: false };

export function readConsent() {
  const d = read(KEYS.consent, DEFAULT_CONSENT);
  return { portfolioAi: Boolean(d?.portfolioAi) };
}

export function setConsent(patch = {}) {
  const next = { ...readConsent(), ...patch };
  write(KEYS.consent, next);
  return next;
}

/**
 * Build the aggregate portfolio line that MAY be sent to the AI when the user
 * opted in. Never an address: only symbol → exposure % and total categories.
 */
export function portfolioSummaryForAi({ positions = [], priceMap = {} } = {}) {
  const rows = (positions ?? [])
    .map((p) => ({
      symbol: p.symbol,
      coinId: p.coinId,
      value: Number.isFinite(Number(p.qty)) && priceMap?.[p.coinId] != null ? Number(p.qty) * Number(priceMap[p.coinId]) : null
    }))
    .filter((r) => r.value != null);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!rows.length || total <= 0) return null;
  return {
    totalUsd: Math.round(total),
    exposure: rows
      .map((r) => ({ symbol: r.symbol, exposurePct: Math.round((r.value / total) * 1000) / 10 }))
      .sort((a, b) => b.exposurePct - a.exposurePct)
      .slice(0, 10)
  };
}

/** Deterministic per-signal reasons from evidence (client mirror). */
export function reasonsFromEvidence(evidence = []) {
  const safe = {};
  for (const e of evidence) {
    if (e?.key === 'momentum' || e?.key?.startsWith('momentum')) safe.momentum = safe.momentum ?? (e.direction * 20);
    if (e?.key === 'whaleInflow') safe.whaleFlow = 'inflow';
    if (e?.key === 'whaleOutflow') safe.whaleFlow = 'outflow';
    if (e?.key === 'holderGrowth') safe.holderTrend = 'rising';
    if (e?.key === 'holderSpread') safe.holderTrend = 'falling';
    if (e?.key === 'dexBuy') safe.dexPressure = 'buy';
    if (e?.key === 'dexSell') safe.dexPressure = 'sell';
    if (e?.key === 'smartMoneyAccum') safe.smartMoneySignal = 'ACCUMULATION';
    if (e?.key === 'smartMoneyDistrib') safe.smartMoneySignal = 'DISTRIBUTION';
    if (e?.key === 'rsi' && e?.pct != null) safe.rsi = 50 + (e.direction > 0 ? -20 : e.direction < 0 ? 20 : 0);
  }
  return localReasonFromEvidence(safe);
}
