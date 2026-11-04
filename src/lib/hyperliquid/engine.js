/**
 * HYPERLIQUID — DECISION ENGINE (pure, no network, no clock except `now` args)
 * ---------------------------------------------------------------------------
 * Brain and hands, kept apart:
 *   - the AI (aiClient.js) only PROPOSES intents as data;
 *   - this file validates them, applies the user's rules, builds a preview,
 *     and holds each proposal as a pending approval that expires;
 *   - exchangeOps.js is the only code that sends an order, and only after the
 *     user has approved one specific preview.
 */

import { checkOrderAgainstCaps, HL_CAP_DEFAULTS } from './caps.js';

/** A market must trade at least this much in 24 hours to be used at all. */
export const MIN_MARKET_VOLUME_USD = 5000000;
/** One order may not exceed this share of the market's 24-hour volume (slippage guard). */
export const MAX_ORDER_SHARE_OF_VOLUME = 0.01;

export const ENGINE_CODES = Object.freeze({
  BAD_PROPOSAL: 'ENG_BAD_PROPOSAL',
  COIN_NOT_ALLOWED: 'ENG_COIN_NOT_ALLOWED',
  SIDE_INVALID: 'ENG_SIDE_INVALID',
  NOTIONAL_INVALID: 'ENG_NOTIONAL_INVALID',
  LEVERAGE_INVALID: 'ENG_LEVERAGE_INVALID',
  STOP_INVALID: 'ENG_STOP_INVALID',
  RULE_DAILY_LIMIT: 'ENG_RULE_DAILY_LIMIT',
  RULE_COOLDOWN: 'ENG_RULE_COOLDOWN',
  EXPIRED: 'ENG_EXPIRED',
  NOT_PENDING: 'ENG_NOT_PENDING',
  NO_MARKET: 'ENG_NO_MARKET',
  NO_VOLUME_DATA: 'ENG_NO_VOLUME_DATA',
  THIN_MARKET: 'ENG_THIN_MARKET',
  LEVERAGE_OVER_MARKET: 'ENG_LEVERAGE_OVER_MARKET'
});

export const APPROVAL_TTL_MS = 60000;
export const STRATEGIES = Object.freeze(['trend', 'reversion', 'manual']);
export const RULE_DEFAULTS = Object.freeze({ strategy: 'manual', maxTradesPerDay: 3, cooldownMinutes: 60, notes: '' });

const RATIONALE_MAX = 280;
const NOTES_MAX = 300;

/** Validates ONE proposal from the AI. Anything unclear is dropped, not repaired. */
export function validateProposal(raw, { allowedCoins, maxLeverage, maxStopLossPct }) {
  if (!raw || typeof raw !== 'object') return { ok: false, code: ENGINE_CODES.BAD_PROPOSAL };
  if (!allowedCoins.includes(raw.coin)) return { ok: false, code: ENGINE_CODES.COIN_NOT_ALLOWED };
  if (raw.side !== 'long' && raw.side !== 'short') return { ok: false, code: ENGINE_CODES.SIDE_INVALID };
  const notional = Number(raw.notionalUsd);
  if (!Number.isFinite(notional) || notional <= 0) return { ok: false, code: ENGINE_CODES.NOTIONAL_INVALID };
  const leverage = Number(raw.leverage);
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > maxLeverage) {
    return { ok: false, code: ENGINE_CODES.LEVERAGE_INVALID };
  }
  const stop = Number(raw.stopLossPct);
  if (!Number.isFinite(stop) || stop <= 0 || stop > maxStopLossPct) return { ok: false, code: ENGINE_CODES.STOP_INVALID };
  return {
    ok: true,
    intent: {
      coin: raw.coin,
      side: raw.side,
      notionalUsd: notional,
      leverage,
      stopLossPct: stop,
      rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, RATIONALE_MAX) : ''
    }
  };
}

/** Rules are the user's own limits on how often the AI may act. */
export function normalizeRules(input = {}) {
  const strategy = STRATEGIES.includes(input.strategy) ? input.strategy : RULE_DEFAULTS.strategy;
  const maxTrades = Math.round(Number(input.maxTradesPerDay));
  const cooldown = Math.round(Number(input.cooldownMinutes));
  return {
    strategy,
    maxTradesPerDay: Number.isFinite(maxTrades) ? Math.min(10, Math.max(1, maxTrades)) : RULE_DEFAULTS.maxTradesPerDay,
    cooldownMinutes: Number.isFinite(cooldown) ? Math.min(1440, Math.max(0, cooldown)) : RULE_DEFAULTS.cooldownMinutes,
    notes: typeof input.notes === 'string' ? input.notes.slice(0, NOTES_MAX) : ''
  };
}

/** Counts from the session ledger, then checks the user's rules. */
export function evaluateRules(rules, { tradesToday, lastTradeAtByCoin = {}, coin, now }) {
  if (tradesToday >= rules.maxTradesPerDay) return { ok: false, code: ENGINE_CODES.RULE_DAILY_LIMIT };
  const last = lastTradeAtByCoin[coin];
  if (last && now - last < rules.cooldownMinutes * 60000) return { ok: false, code: ENGINE_CODES.RULE_COOLDOWN };
  return { ok: true, code: null };
}

/**
 * Preview the user reads before approving. The stop price is an estimate from
 * the current mid; the real one is set from the actual fill.
 */
export function marketVerdict(intent, market) {
  if (!market || market.asset === undefined) return { ok: false, code: ENGINE_CODES.NO_MARKET };
  if (!Number.isFinite(market.dayNtlVlm)) return { ok: false, code: ENGINE_CODES.NO_VOLUME_DATA };
  if (market.dayNtlVlm < MIN_MARKET_VOLUME_USD || intent.notionalUsd > market.dayNtlVlm * MAX_ORDER_SHARE_OF_VOLUME) {
    return { ok: false, code: ENGINE_CODES.THIN_MARKET };
  }
  if (!Number.isInteger(market.maxLeverage) || market.maxLeverage < 1) return { ok: false, code: ENGINE_CODES.NO_MARKET };
  if (intent.leverage > market.maxLeverage) return { ok: false, code: ENGINE_CODES.LEVERAGE_OVER_MARKET };
  return { ok: true, code: null };
}

export function buildPreview(intent, { mid, caps = HL_CAP_DEFAULTS, state, rules, tradesToday, lastTradeAtByCoin, now, market }) {
  const verdict = checkOrderAgainstCaps(
    { coin: intent.coin, notionalUsd: intent.notionalUsd, leverage: intent.leverage, stopLossPct: intent.stopLossPct },
    state, caps
  );
  const ruleVerdict = evaluateRules(rules, { tradesToday, lastTradeAtByCoin, coin: intent.coin, now });
  const mktVerdict = marketVerdict(intent, market);
  const isLong = intent.side === 'long';
  return {
    coin: intent.coin,
    side: intent.side,
    notionalUsd: intent.notionalUsd,
    leverage: intent.leverage,
    marginUsd: intent.notionalUsd / intent.leverage,
    stopLossPct: intent.stopLossPct,
    estimatedStopPx: mid > 0 ? (isLong ? mid * (1 - intent.stopLossPct) : mid * (1 + intent.stopLossPct)) : null,
    worstCaseLossUsd: intent.notionalUsd * intent.stopLossPct,
    rationale: intent.rationale,
    capsOk: verdict.ok,
    capsCode: verdict.code,
    rulesOk: ruleVerdict.ok,
    rulesCode: ruleVerdict.code,
    marketOk: mktVerdict.ok,
    marketCode: mktVerdict.code,
    marketMaxLeverage: market?.maxLeverage ?? null,
    dayVolumeUsd: market?.dayNtlVlm ?? null,
    canApprove: verdict.ok && ruleVerdict.ok && mktVerdict.ok && mid > 0
  };
}

export function createPending(intent, preview, { id, now, ttlMs = APPROVAL_TTL_MS }) {
  return { id, intent, preview, createdAt: now, expiresAt: now + ttlMs, status: 'pending' };
}

/** Returns the pending item marked approved, or why it cannot be. */
export function approvePending(pending, { now }) {
  if (!pending || pending.status !== 'pending') return { ok: false, code: ENGINE_CODES.NOT_PENDING };
  if (now > pending.expiresAt) return { ok: false, code: ENGINE_CODES.EXPIRED };
  return { ok: true, pending: { ...pending, status: 'approved', approvedAt: now } };
}

/** Session ledger: every approved, executed, failed or rejected action. */
export function createLedger() {
  return { entries: [] };
}

export function recordEntry(ledger, entry) {
  return { entries: [...ledger.entries, entry] };
}

export function tradesSince(ledger, sinceMs) {
  return ledger.entries.filter((e) => e.status === 'executed' && e.at >= sinceMs).length;
}

export function lastTradeTimes(ledger) {
  const out = {};
  for (const e of ledger.entries) {
    if (e.status === 'executed' && (!out[e.coin] || e.at > out[e.coin])) out[e.coin] = e.at;
  }
  return out;
}

export function startOfLocalDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
