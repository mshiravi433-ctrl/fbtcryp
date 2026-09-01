/**
 * LENDING ENGINE — alert rules (§22/§23 of the production spec).
 * ---------------------------------------------------------------------------
 * The Alert Engine is separate from the frontend: `evaluateAlerts` is a pure
 * function over (current position, previous position, market snapshot,
 * thresholds), so the same rules run in the browser, in the server BFF and
 * later in the notification pipeline. No alert is invented by a component.
 *
 * Rules implemented (§22):
 *   · HEALTH_FACTOR_LOW        — HF below a threshold (default 1.5) or dropped
 *   · LTV_HIGH                 — LTV above threshold
 *   · COLLATERAL_DROP          — collateral fell X% since last snapshot
 *   · BORROW_APY_CHANGE        — borrow APY moved X% since last snapshot
 *   · SUPPLY_APY_CHANGE        — supply APY moved X% since last snapshot
 *   · LIQUIDATION_DISTANCE     — distance to liquidation below X%
 *   · ORACLE_ANOMALY           — oracle flagged abnormal / stale
 *   · POSITION_CHANGED         — external change (indexer vs wallet state)
 *   · TRANSACTION_FAILED       — an execution reported failure
 *
 * Thresholds are configuration. Severity: info | warning | critical.
 */

export const ALERT_TYPES = Object.freeze([
  'HEALTH_FACTOR_LOW', 'LTV_HIGH', 'COLLATERAL_DROP', 'BORROW_APY_CHANGE',
  'SUPPLY_APY_CHANGE', 'LIQUIDATION_DISTANCE', 'ORACLE_ANOMALY',
  'POSITION_CHANGED', 'TRANSACTION_FAILED'
]);

export const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  healthFactorLow: 1.5,          // warn below, critical below 1.2 (spec §12/§23)
  healthFactorDropPct: 15,       // "2.34 → 1.92" style drop
  ltvHighPct: 70,
  collateralDropPct: 10,
  apyChangePct: 25,
  liquidationDistanceLowPct: 15,
  criticalHealthFactor: 1.2
});

const severityFor = (type, value, thresholds) => {
  if (type === 'HEALTH_FACTOR_LOW') return value < thresholds.criticalHealthFactor ? 'critical' : 'warning';
  if (type === 'LIQUIDATION_DISTANCE') return value < thresholds.liquidationDistanceLowPct / 2 ? 'critical' : 'warning';
  if (type === 'ORACLE_ANOMALY') return 'critical';
  if (type === 'TRANSACTION_FAILED') return 'critical';
  if (type === 'POSITION_CHANGED') return 'info';
  return 'warning';
};

const cloneId = (alert) => `${alert.type}:${alert.asset ?? 'account'}`;

/**
 * Evaluate every rule. Returns an array of alerts:
 *   { type, severity, asset, title, body, value }
 * where title/body are plain English (the UI translates by type) and `value`
 * carries the numbers. `previous` may be null (first observation).
 */
export function evaluateAlerts({
  position = null,            // { healthFactor, totalCollateralUsd, totalDebtUsd, ltvPct, liquidationDistancePct }
  previous = null,            // the previous snapshot of the same shape
  market = null,              // { supplyApyPct, borrowApyPct } per asset: { [assetId]: {...} }
  previousMarket = null,
  thresholds = DEFAULT_ALERT_THRESHOLDS,
  oracle = null,              // { status: 'ok' | 'stale' | 'anomaly' }
  txFailed = null,            // { action, asset } when an execution failed
  externalPositionChange = false
} = {}) {
  const alerts = [];
  const th = { ...DEFAULT_ALERT_THRESHOLDS, ...(thresholds || {}) };

  const push = (alert) => {
    if (!alerts.some((a) => cloneId(a) === cloneId(alert))) alerts.push(alert);
  };

  if (position) {
    const hf = position.healthFactor;
    if (hf != null && Number.isFinite(Number(hf)) && Number(hf) < th.healthFactorLow) {
      push({
        type: 'HEALTH_FACTOR_LOW',
        severity: severityFor('HEALTH_FACTOR_LOW', Number(hf), th),
        asset: null,
        value: Number(hf),
        title: 'Health factor is low',
        body: `Health factor is ${Number(hf).toFixed(2)}. Consider adding collateral or repaying debt.`
      });
    }

    if (previous && previous.healthFactor != null && hf != null
      && Number(previous.healthFactor) > Number(hf)
      && (1 - Number(hf) / Number(previous.healthFactor)) * 100 >= th.healthFactorDropPct) {
      push({
        type: 'HEALTH_FACTOR_LOW',
        severity: severityFor('HEALTH_FACTOR_LOW', Number(hf), th),
        asset: null,
        value: { from: Number(previous.healthFactor), to: Number(hf) },
        title: 'Health factor dropped',
        body: `Health factor fell ${Number(previous.healthFactor).toFixed(2)} → ${Number(hf).toFixed(2)}.`
      });
    }

    if (position.ltvPct != null && Number(position.ltvPct) >= th.ltvHighPct) {
      push({
        type: 'LTV_HIGH', severity: 'warning', asset: null, value: Number(position.ltvPct),
        title: 'LTV is high',
        body: `Loan-to-value is ${Number(position.ltvPct).toFixed(1)}%.`
      });
    }

    if (position.liquidationDistancePct != null
      && Number(position.liquidationDistancePct) < th.liquidationDistanceLowPct) {
      push({
        type: 'LIQUIDATION_DISTANCE',
        severity: severityFor('LIQUIDATION_DISTANCE', Number(position.liquidationDistancePct), th),
        asset: null,
        value: Number(position.liquidationDistancePct),
        title: 'Close to liquidation',
        body: `Liquidation distance is ${Number(position.liquidationDistancePct).toFixed(1)}%.`
      });
    }

    if (previous && position.totalCollateralUsd != null && previous.totalCollateralUsd != null
      && Number(previous.totalCollateralUsd) > 0
      && (1 - Number(position.totalCollateralUsd) / Number(previous.totalCollateralUsd)) * 100 >= th.collateralDropPct) {
      push({
        type: 'COLLATERAL_DROP', severity: 'warning', asset: null,
        value: { from: Number(previous.totalCollateralUsd), to: Number(position.totalCollateralUsd) },
        title: 'Collateral value dropped',
        body: 'The value of your collateral fell since the last check.'
      });
    }
  }

  for (const [assetId, rates] of Object.entries(market || {})) {
    const prev = previousMarket?.[assetId];
    const supply = Number(rates?.supplyApyPct);
    const borrow = Number(rates?.borrowApyPct);
    if (prev && Number.isFinite(Number(prev.borrowApyPct)) && Number.isFinite(borrow)
      && Number(prev.borrowApyPct) > 0
      && Math.abs(borrow / Number(prev.borrowApyPct) - 1) * 100 >= th.apyChangePct) {
      push({
        type: 'BORROW_APY_CHANGE', severity: 'info', asset: assetId,
        value: { from: Number(prev.borrowApyPct), to: borrow },
        title: 'Borrow APY changed',
        body: `Borrow APY moved ${Number(prev.borrowApyPct).toFixed(2)}% → ${borrow.toFixed(2)}%.`
      });
    }
    if (prev && Number.isFinite(Number(prev.supplyApyPct)) && Number.isFinite(supply)
      && Number(prev.supplyApyPct) > 0
      && Math.abs(supply / Number(prev.supplyApyPct) - 1) * 100 >= th.apyChangePct) {
      push({
        type: 'SUPPLY_APY_CHANGE', severity: 'info', asset: assetId,
        value: { from: Number(prev.supplyApyPct), to: supply },
        title: 'Supply APY changed',
        body: `Supply APY moved ${Number(prev.supplyApyPct).toFixed(2)}% → ${supply.toFixed(2)}%.`
      });
    }
  }

  if (oracle && (oracle.status === 'anomaly' || oracle.status === 'stale')) {
    push({
      type: 'ORACLE_ANOMALY', severity: 'critical', asset: null, value: oracle.status,
      title: 'Oracle feed abnormal',
      body: 'The price feed is abnormal. High-risk new transactions are paused.'
    });
  }

  if (txFailed) {
    push({
      type: 'TRANSACTION_FAILED', severity: 'critical', asset: txFailed.asset ?? null,
      value: txFailed,
      title: 'Transaction failed',
      body: `The ${txFailed.action ?? 'lending'} transaction did not complete.`
    });
  }

  if (externalPositionChange) {
    push({
      type: 'POSITION_CHANGED', severity: 'info', asset: null, value: null,
      title: 'Position changed externally',
      body: 'Your position changed outside this session and has been refreshed.'
    });
  }

  return alerts;
}

/** The §23 bell: count of unread + one-line digest for the header. */
export function alertsDigest(alerts) {
  const list = Array.isArray(alerts) ? alerts : [];
  const critical = list.filter((a) => a.severity === 'critical').length;
  const warning = list.filter((a) => a.severity === 'warning').length;
  return { total: list.length, critical, warning };
}
