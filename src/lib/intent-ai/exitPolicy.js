/**
 * Stop-loss / take-profit / trailing-stop / emergency-unwind.
 * Every exit is proposed as an action that MUST pass Guardian.
 */
import { guardianReview, emergencyStopCheck } from './guardian.js';
import { classifyFailure } from './failureModes.js';

export function evaluateExit({
  kind = 'stop_loss',
  markPrice,
  entryPrice,
  stopLossPct = 5,
  takeProfitPct = 10,
  trailPct = 3,
  highWater,
  emergencyStop = false,
  policy,
  actionBase = {}
} = {}) {
  const stop = emergencyStopCheck(emergencyStop);
  if (!stop.ok) {
    return proposeUnwind('emergency_unwind', policy, actionBase, 'EMERGENCY_STOP');
  }
  const mark = Number(markPrice);
  const entry = Number(entryPrice);
  if (!Number.isFinite(mark) || !Number.isFinite(entry) || entry <= 0) {
    return { ok: false, fire: false, error: classifyFailure('MISSING_DATA', { detail: 'PRICE_UNKNOWN' }) };
  }
  const pnlPct = ((mark - entry) / entry) * 100;

  if (kind === 'stop_loss' && pnlPct <= -Math.abs(stopLossPct)) {
    return proposeUnwind('stop_loss', policy, actionBase, 'STOP_LOSS');
  }
  if (kind === 'take_profit' && pnlPct >= Math.abs(takeProfitPct)) {
    return proposeUnwind('take_profit', policy, actionBase, 'TAKE_PROFIT');
  }
  if (kind === 'trailing_stop') {
    const hw = Number(highWater);
    if (!Number.isFinite(hw)) return { ok: false, fire: false, error: classifyFailure('MISSING_DATA') };
    const drop = ((hw - mark) / hw) * 100;
    if (drop >= Math.abs(trailPct)) return proposeUnwind('trailing_stop', policy, actionBase, 'TRAILING_STOP');
  }
  return { ok: true, fire: false, pnlPct };
}

function proposeUnwind(kind, policy, actionBase, reason) {
  const action = {
    action: actionBase.action || 'swap',
    chainId: actionBase.chainId,
    protocol: actionBase.protocol || 'swap',
    asset: actionBase.asset,
    amountUsd: actionBase.amountUsd,
    execution: true,
    note: `exit:${kind}`
  };
  const g = guardianReview(action, policy, { now: Date.now(), sessionStartAt: policy?.sessionStartAt });
  if (!g.approved) {
    return { ok: false, fire: false, kind, reason, guardian: g, error: classifyFailure('GUARDIAN_REJECTED') };
  }
  return { ok: true, fire: true, kind, reason, guardian: g, action };
}
