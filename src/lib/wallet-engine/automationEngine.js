/**
 * FBT WALLET ENGINE — WALLET AUTOMATION ENGINE
 * ---------------------------------------------------------------------------
 * Rule → condition → alert, evaluated locally against wallet state. The spec's
 * examples map one-to-one:
 *
 *   اگر ETH < X          → { when:'PRICE_LT', asset:'ETH', threshold }
 *   اگر Balance < X      → { when:'BALANCE_LT', asset, thresholdUsd }
 *   اگر P&L > X          → { when:'PNL_GT', thresholdUsd }
 *   اگر تراکنش بزرگ آمد → { when:'LARGE_TX', thresholdUsd }
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · The engine only EVALUATES rules and produces alert records. It never
 *   executes anything — sending a notification or a wallet action is a
 *   separate, user-approved step.
 * · A rule with an unknown `when` is a typed failure (`UNKNOWN_RULE`), not a
 *   silent no-op, so a typo can never quietly disable a user's protection.
 * · Missing data yields `triggered:false` with `dataMissing:true` — an
 *   unreadable balance must not read as "balance is fine".
 */

export const AUTOMATION_SCHEMA = 'fbt.automation-rule.v1';

export const RULE_TYPES = Object.freeze([
  'PRICE_LT', 'PRICE_GT', 'BALANCE_LT', 'BALANCE_GT', 'PNL_GT', 'PNL_LT', 'LARGE_TX'
]);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Normalize a rule into `fbt.automation-rule.v1`. */
export function parseRule(rule = {}) {
  const when = String(rule.when || '').toUpperCase();
  return {
    schema: AUTOMATION_SCHEMA,
    id: String(rule.id || `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`),
    when,
    asset: rule.asset ? String(rule.asset).toUpperCase() : null,
    threshold: num(rule.threshold) ?? null,
    action: rule.action || 'alert',
    params: rule.params && typeof rule.params === 'object' ? { ...rule.params } : {}
  };
}

/**
 * Evaluate one rule against a wallet state object.
 * `state` carries whatever the rule needs: `{ prices:{ETH:…}, balances:{ETH:{amount,valueUsd}}, pnlUsd, incomingUsd }`.
 */
export function evaluateRule(rule, state = {}) {
  const r = rule?.schema === AUTOMATION_SCHEMA ? rule : parseRule(rule);
  const state_ = state || {};
  const prices = state_.prices || {};
  const balances = state_.balances || {};

  const assetVal = (field) => {
    const b = balances[r.asset];
    if (b && b[field] != null) return num(b[field]);
    return null;
  };

  const mk = (triggered, extra = {}) => ({
    rule: r,
    triggered,
    ...extra,
    alert: triggered
      ? { schema: 'fbt.automation-alert.v1', ruleId: r.id, when: r.when, asset: r.asset, threshold: r.threshold, action: r.action, ...extra.message && { message: extra.message } }
      : null
  });

  switch (r.when) {
    case 'PRICE_LT':
    case 'PRICE_GT': {
      const price = num(prices[r.asset]);
      if (price == null) return mk(false, { dataMissing: true });
      const hit = r.when === 'PRICE_LT' ? price < r.threshold : price > r.threshold;
      return mk(hit, { current: price });
    }
    case 'BALANCE_LT':
    case 'BALANCE_GT': {
      const value = assetVal('valueUsd') ?? assetVal('amount');
      if (value == null) return mk(false, { dataMissing: true });
      const hit = r.when === 'BALANCE_LT' ? value < r.threshold : value > r.threshold;
      return mk(hit, { current: value });
    }
    case 'PNL_GT':
    case 'PNL_LT': {
      const pnl = num(state_.pnlUsd);
      if (pnl == null) return mk(false, { dataMissing: true });
      const hit = r.when === 'PNL_GT' ? pnl > r.threshold : pnl < r.threshold;
      return mk(hit, { current: pnl });
    }
    case 'LARGE_TX': {
      const incoming = num(state_.incomingUsd);
      if (incoming == null) return mk(false, { dataMissing: true });
      return mk(incoming >= r.threshold, { current: incoming });
    }
    default:
      return { rule: r, triggered: false, error: 'UNKNOWN_RULE', alert: null };
  }
}

/** Evaluate a list of rules; returns the triggered alerts only. */
export function evaluateAll(rules = [], state = {}) {
  const alerts = [];
  const results = (Array.isArray(rules) ? rules : []).map((rule) => {
    const res = evaluateRule(rule, state);
    if (res.alert) alerts.push(res.alert);
    return res;
  });
  return { schema: 'fbt.automation-run.v1', results, alerts, triggered: alerts.length };
}
