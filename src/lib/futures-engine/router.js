/**
 * FBT FUTURES ROUTER (spec §6).
 * ---------------------------------------------------------------------------
 * Picks the venue for an order from what is actually available. The ranking
 * is EXECUTION QUALITY AND SAFETY ONLY:
 *
 *   status → market open → capability fit → total user cost → liquidity →
 *   spread → funding → freshness
 *
 * FBT revenue is NOT an input. `scoreCandidate` does not receive the FBT fee
 * as a component that could favour a venue; the test suite pins this by
 * scoring the same candidates under every fee policy and asserting the order
 * never changes.
 *
 * Every decision explains itself (`reasons[]`) and lists the venues it
 * rejected and why, so the comparison card and the Intent OS say the same
 * thing.
 */
import { EXECUTABLE_STATUSES, PROVIDER_STATUS } from './providers.js';

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @typedef {object} RouteCandidate
 * @property {string} providerId
 * @property {string} status                 PROVIDER_STATUS
 * @property {object} capabilities           flags from the catalogue
 * @property {boolean|null} isMarketOpen
 * @property {number|null} maxLeverage
 * @property {number|null} protocolFeeBps    venue opening fee (bps of notional)
 * @property {number|null} protocolFlatUsd
 * @property {number|null} networkFeeUsd
 * @property {number|null} spreadBps
 * @property {number|null} openInterestUsd
 * @property {number|null} fundingAprPct     paid by the requested side (+ = you pay)
 * @property {number|null} dataAgeMs
 * @property {boolean}     supportsMarket    the requested market exists here
 */

export function rejectReason(c, { leverage, needTp = false, needSl = false } = {}) {
  if (!c) return 'NO_CANDIDATE';
  if (!EXECUTABLE_STATUSES.includes(c.status)) return `STATUS_${c.status || PROVIDER_STATUS.UNAVAILABLE}`;
  if (!c.capabilities?.canPrepare || !c.capabilities?.canExecute) return 'NO_EXECUTION_PATH';
  if (c.supportsMarket === false) return 'MARKET_NOT_LISTED';
  if (c.isMarketOpen === false) return 'MARKET_CLOSED';
  const lev = num(leverage);
  const max = num(c.maxLeverage);
  if (lev != null && max != null && max > 0 && lev > max) return 'LEVERAGE_ABOVE_VENUE_MAX';
  if (needTp && !c.capabilities?.supportsTakeProfit) return 'NO_TAKE_PROFIT';
  if (needSl && !c.capabilities?.supportsStopLoss) return 'NO_STOP_LOSS';
  return null;
}

/**
 * Lower is better. Cost in USD terms for the user, then quality penalties.
 * The FBT fee is deliberately NOT part of this number.
 */
export function scoreCandidate(c, { notionalUsd }) {
  const notional = num(notionalUsd) || 0;
  const reasons = [];
  let score = 0;

  const pBps = num(c.protocolFeeBps);
  if (pBps != null) { score += (notional * pBps) / 10_000; reasons.push(`protocol_fee_bps=${pBps}`); }
  else { score += notional * 0.001; reasons.push('protocol_fee_unknown_penalised'); }

  const flat = num(c.protocolFlatUsd);
  if (flat != null) score += Math.max(0, flat);

  const gas = num(c.networkFeeUsd);
  if (gas != null) { score += Math.max(0, gas); reasons.push(`network_fee_usd=${gas.toFixed(2)}`); }
  else { score += 0.5; reasons.push('network_fee_unknown_penalised'); }

  const spread = num(c.spreadBps);
  if (spread != null) { score += (notional * spread) / 20_000; reasons.push(`half_spread_bps=${(spread / 2).toFixed(2)}`); }

  const funding = num(c.fundingAprPct);
  if (funding != null && funding > 0) { score += (notional * funding) / 100 / 365; reasons.push(`funding_1d_cost_apr=${funding.toFixed(2)}`); }

  const oi = num(c.openInterestUsd);
  if (oi != null && oi > 0 && notional > oi * 0.05) { score += notional * 0.002; reasons.push('large_vs_open_interest'); }

  const age = num(c.dataAgeMs);
  if (age != null && age > 60_000) { score += 0.25; reasons.push('stale_feed_penalised'); }
  if (c.status === PROVIDER_STATUS.DEGRADED) { score += 1; reasons.push('degraded_penalised'); }

  return { score, reasons };
}

/**
 * Select the venue. Returns
 *   { ok, providerId, reasons, ranked:[...], rejected:[{providerId, reason}] }
 */
export function selectVenue(candidates = [], { notionalUsd, leverage, needTp = false, needSl = false } = {}) {
  const rejected = [];
  const ranked = [];
  for (const c of candidates) {
    const why = rejectReason(c, { leverage, needTp, needSl });
    if (why) { rejected.push({ providerId: c?.providerId || null, reason: why }); continue; }
    const { score, reasons } = scoreCandidate(c, { notionalUsd });
    ranked.push({ providerId: c.providerId, score, reasons, status: c.status });
  }
  ranked.sort((a, b) => a.score - b.score || String(a.providerId).localeCompare(String(b.providerId)));
  if (!ranked.length) return { ok: false, providerId: null, reasons: ['NO_EXECUTABLE_VENUE'], ranked, rejected };
  return { ok: true, providerId: ranked[0].providerId, reasons: ranked[0].reasons, ranked, rejected };
}
