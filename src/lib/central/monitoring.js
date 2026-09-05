/**
 * FBT FINANCIAL OS — Strategy lifecycle, Monitoring, Early Warning, Replanning
 * (Upgrade 10 §27, §28, §29, §50).
 * ---------------------------------------------------------------------------
 * "Change → Detect → Re-evaluate → Replan", as three pure functions that can be
 * run on a schedule, on an event, or inside a turn:
 *
 *   detectChanges()   two snapshots → the material differences, with magnitude
 *   earlyWarnings()   one snapshot + goal → the problems that are still small
 *   evaluateStrategy() strategy + current state → is this still the right plan?
 *
 * WHAT MAKES THIS MORE THAN A DIFF
 * A change is only interesting if it crosses a threshold that a DECISION would
 * have depended on. So every detector carries the threshold it used and the
 * reason that threshold exists. "BTC moved 0.4%" is noise; "concentration
 * crossed the tolerance you stated" is a replan trigger, and the difference is
 * written down here rather than argued about in review.
 */
import { CI_SCHEMA, round, usableNumber } from './schema.js';

export const MONITORING_SCHEMA = 'fbt.monitoring-engine.v1';
export const STRATEGY_SCHEMA = 'fbt.strategy-lifecycle.v1';

const num = (v) => usableNumber(v);

/* ── §27 Strategy lifecycle ────────────────────────────────────────────── */

export const STRATEGY_STATES = Object.freeze([
  'DRAFT', 'SIMULATED', 'APPROVED', 'ACTIVE', 'MONITORED', 'DEGRADED', 'REVISED', 'ARCHIVED'
]);

/** The only legal transitions. Anything else is a bug, and it throws loudly. */
export const STRATEGY_TRANSITIONS = Object.freeze({
  DRAFT: ['SIMULATED', 'ARCHIVED'],
  SIMULATED: ['APPROVED', 'DRAFT', 'ARCHIVED'],
  APPROVED: ['ACTIVE', 'REVISED', 'ARCHIVED'],
  ACTIVE: ['MONITORED', 'DEGRADED', 'ARCHIVED'],
  MONITORED: ['DEGRADED', 'REVISED', 'ACTIVE', 'ARCHIVED'],
  DEGRADED: ['REVISED', 'ARCHIVED'],
  REVISED: ['SIMULATED', 'APPROVED', 'ARCHIVED'],
  ARCHIVED: []
});

export function createStrategy(input = {}, { now = Date.now() } = {}) {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, code: 'BAD_NAME' };
  return {
    ok: true,
    strategy: {
      schema: STRATEGY_SCHEMA,
      strategyId: String(input.strategyId || `strat_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
      name,
      goalId: input.goalId ? String(input.goalId).slice(0, 64) : null,
      decisionId: input.decisionId ? String(input.decisionId).slice(0, 64) : null,
      state: 'DRAFT',
      expectedReturnPct: num(input.expectedReturnPct),
      riskLevel: input.riskLevel ? String(input.riskLevel).toUpperCase() : null,
      horizonMonths: num(input.horizonMonths),
      actions: Array.isArray(input.actions) ? input.actions.slice(0, 12) : [],
      history: [{ state: 'DRAFT', at: now, reason: 'created' }],
      createdAt: now,
      updatedAt: now
    }
  };
}

export function transitionStrategy(strategy, next, { reason = '', at = Date.now() } = {}) {
  const target = String(next || '').toUpperCase();
  if (!STRATEGY_STATES.includes(target)) return { ok: false, code: 'UNKNOWN_STATE', allowed: STRATEGY_STATES };
  const allowed = STRATEGY_TRANSITIONS[strategy?.state] || [];
  if (!allowed.includes(target)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: strategy?.state || null, to: target, allowed };
  }
  return {
    ok: true,
    strategy: {
      ...strategy,
      state: target,
      updatedAt: at,
      history: [...(strategy.history || []), { state: target, at, reason: String(reason).slice(0, 120) }].slice(-24)
    }
  };
}

/* ── §28 Change detection ──────────────────────────────────────────────── */

/**
 * Thresholds are named and justified. Every one of them is the point at which a
 * DECISION taken on the old value could have been different.
 */
export const CHANGE_THRESHOLDS = Object.freeze({
  netWorthPct: { value: 5, why: 'a 5% move in net worth changes position sizing on any goal with a horizon under a year' },
  concentrationPct: { value: 5, why: 'concentration is scored in 5-point bands by the decision engine' },
  leverage: { value: 0.25, why: 'a quarter turn of leverage moves the liquidation distance materially' },
  debtPct: { value: 10, why: 'debt is a hard input to the borrow gate' },
  stableSharePct: { value: 7, why: 'the liquidity component of every decision score reads this directly' },
  drawdownPct: { value: 5, why: 'drawdown crossing five points is where an early warning becomes a replan' },
  riskLevel: { value: 1, why: 'any change of risk band invalidates the score the plan was chosen with' }
});

const RISK_RANK = { LOW: 1, MODERATE: 2, ELEVATED: 3, HIGH: 4, CRITICAL: 5 };

export function detectChanges(before = {}, after = {}, { now = Date.now() } = {}) {
  const changes = [];
  const relative = (key, threshold, why) => {
    const a = num(before?.[key]);
    const b = num(after?.[key]);
    if (a === null || b === null || a === 0) return;
    const deltaPct = round(((b - a) / Math.abs(a)) * 100, 2);
    if (Math.abs(deltaPct) >= threshold) {
      changes.push({ field: key, kind: 'RELATIVE', before: a, after: b, deltaPct, threshold, why, material: true });
    }
  };
  const absolute = (key, threshold, why) => {
    const a = num(before?.[key]);
    const b = num(after?.[key]);
    if (a === null || b === null) return;
    const delta = round(b - a, 4);
    if (Math.abs(delta) >= threshold) {
      changes.push({ field: key, kind: 'ABSOLUTE', before: a, after: b, delta, threshold, why, material: true });
    }
  };

  relative('netWorthUsd', CHANGE_THRESHOLDS.netWorthPct.value, CHANGE_THRESHOLDS.netWorthPct.why);
  relative('debtUsd', CHANGE_THRESHOLDS.debtPct.value, CHANGE_THRESHOLDS.debtPct.why);
  absolute('leverage', CHANGE_THRESHOLDS.leverage.value, CHANGE_THRESHOLDS.leverage.why);
  absolute('stableSharePct', CHANGE_THRESHOLDS.stableSharePct.value, CHANGE_THRESHOLDS.stableSharePct.why);
  absolute('drawdownPct', CHANGE_THRESHOLDS.drawdownPct.value, CHANGE_THRESHOLDS.drawdownPct.why);

  const cBefore = num(before?.concentration?.topSharePct);
  const cAfter = num(after?.concentration?.topSharePct);
  if (cBefore !== null && cAfter !== null && Math.abs(cAfter - cBefore) >= CHANGE_THRESHOLDS.concentrationPct.value) {
    changes.push({
      field: 'concentration.topSharePct', kind: 'ABSOLUTE', before: cBefore, after: cAfter,
      delta: round(cAfter - cBefore, 2), threshold: CHANGE_THRESHOLDS.concentrationPct.value,
      why: CHANGE_THRESHOLDS.concentrationPct.why, material: true
    });
  }
  const rBefore = RISK_RANK[String(before?.riskLevel || '').toUpperCase()];
  const rAfter = RISK_RANK[String(after?.riskLevel || '').toUpperCase()];
  if (rBefore && rAfter && rBefore !== rAfter) {
    changes.push({
      field: 'riskLevel', kind: 'BAND', before: before.riskLevel, after: after.riskLevel,
      delta: rAfter - rBefore, threshold: 1, why: CHANGE_THRESHOLDS.riskLevel.why, material: true
    });
  }

  return {
    schema: MONITORING_SCHEMA, brain: CI_SCHEMA, at: now,
    status: 'OK',
    changed: changes.length > 0,
    count: changes.length,
    changes,
    thresholds: CHANGE_THRESHOLDS,
    note: changes.length ? null : 'nothing crossed a decision-relevant threshold; the current plan was not re-opened'
  };
}

/* ── §29 Early Warning System ──────────────────────────────────────────── */

/**
 * Problems while they are still small. Each warning states its trigger, its
 * distance to the danger line, and the action that would clear it.
 */
export function earlyWarnings({ financialState = null, goalProgress = null, strategy = null, profile = null, now = Date.now() } = {}) {
  const warnings = [];
  const add = (code, severity, detail, suggestion, distance = null) => warnings.push({ code, severity, detail, suggestion, distance });

  if (!financialState || financialState.status === 'UNAVAILABLE') {
    return { schema: MONITORING_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_FINANCIAL_STATE', warnings: [], at: now };
  }

  const dev = num(goalProgress?.deviationPct);
  if (dev !== null && dev < -10) {
    add('GOAL_DEVIATION', dev < -25 ? 'HIGH' : 'MEDIUM',
      `progress is ${Math.abs(dev)} points behind the pace this goal needs`,
      'either raise the contribution, extend the horizon, or accept a lower target — all three are honest, doing nothing is not',
      round(dev, 2));
  }

  const lev = num(financialState.leverage);
  if (lev !== null && lev > 1.5) {
    add('LEVERAGE_INCREASE', lev > 2.5 ? 'HIGH' : 'MEDIUM',
      `combined leverage is ${lev}×`,
      'repay part of the debt or reduce derivative notional before the next drawdown does it for you',
      round(lev - 1.5, 2));
  }

  const stable = num(financialState.stableSharePct);
  if (stable !== null && stable < 5) {
    add('LIQUIDITY_DECREASE', 'MEDIUM',
      `stablecoins are ${stable}% of assets — there is almost no dry powder and no buffer for a debt call`,
      'convert a small share of the largest position into a stable buffer',
      round(5 - stable, 2));
  }

  const dd = num(financialState.drawdownPct);
  if (dd !== null && dd <= -20) {
    add('DRAWDOWN_INCREASE', dd <= -35 ? 'HIGH' : 'MEDIUM',
      `the portfolio is ${Math.abs(dd)}% below its recorded peak`,
      'check whether the thesis behind the largest loser still holds before averaging into it',
      round(dd, 2));
  }

  const conc = financialState.concentration;
  const tolerance = num(profile?.concentrationTolerancePct?.value) ?? 35;
  if (conc && !conc.unavailable && num(conc.topSharePct) !== null && conc.topSharePct > tolerance) {
    add('CONCENTRATION_INCREASE', conc.topSharePct > tolerance + 20 ? 'HIGH' : 'MEDIUM',
      `${conc.topAsset} is ${conc.topSharePct}% of risk capital against a ${tolerance}% tolerance`,
      `trim ${conc.topAsset} or grow the rest of the book`,
      round(conc.topSharePct - tolerance, 2));
  }

  if (strategy && strategy.state === 'ACTIVE' && num(strategy.expectedReturnPct) !== null && num(strategy.realisedReturnPct) !== null) {
    const gap = round(strategy.realisedReturnPct - strategy.expectedReturnPct, 2);
    if (gap < -Math.max(2, Math.abs(strategy.expectedReturnPct) * 0.4)) {
      add('STRATEGY_DEGRADATION', 'MEDIUM',
        `«${strategy.name}» is running ${Math.abs(gap)} points below its own estimate`,
        'move the strategy to DEGRADED and re-evaluate rather than waiting for the horizon to end',
        gap);
    }
  }

  return {
    schema: MONITORING_SCHEMA, brain: CI_SCHEMA, at: now,
    status: 'OK',
    count: warnings.length,
    highest: warnings.reduce((h, w) => (w.severity === 'HIGH' ? 'HIGH' : h === 'HIGH' ? 'HIGH' : w.severity), 'NONE'),
    warnings,
    checked: ['goal deviation', 'leverage', 'liquidity', 'drawdown', 'concentration', 'strategy performance'],
    note: warnings.length ? null : 'every monitored measure is inside its band'
  };
}

/* ── §28 Replanning Engine 2.0 ─────────────────────────────────────────── */

export const REPLAN_TRIGGERS = Object.freeze([
  'MARKET', 'RISK', 'PORTFOLIO', 'GOAL', 'LIQUIDITY', 'STRATEGY_PERFORMANCE', 'NEWS', 'SMART_MONEY'
]);

/**
 * Is the active strategy still the right one? Returns a verdict plus the exact
 * triggers that fired, so the replan the user is offered can name its cause.
 */
export function evaluateStrategy({
  strategy = null, changes = null, warnings = null, goalProgress = null, triggers = [], now = Date.now()
} = {}) {
  if (!strategy) return { schema: MONITORING_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_ACTIVE_STRATEGY', at: now };

  const fired = [];
  for (const t of Array.isArray(triggers) ? triggers : []) {
    const id = String(t?.type || t || '').toUpperCase();
    if (REPLAN_TRIGGERS.includes(id)) fired.push({ trigger: id, detail: t?.detail || null, severity: t?.severity || 'MEDIUM' });
  }
  for (const c of changes?.changes || []) {
    const map = { netWorthUsd: 'PORTFOLIO', debtUsd: 'PORTFOLIO', leverage: 'RISK', stableSharePct: 'LIQUIDITY', drawdownPct: 'RISK', riskLevel: 'RISK', 'concentration.topSharePct': 'PORTFOLIO' };
    const id = map[c.field];
    if (id) fired.push({ trigger: id, detail: `${c.field} ${c.before} → ${c.after}`, severity: 'MEDIUM' });
  }
  for (const w of warnings?.warnings || []) {
    const map = { GOAL_DEVIATION: 'GOAL', LEVERAGE_INCREASE: 'RISK', LIQUIDITY_DECREASE: 'LIQUIDITY', DRAWDOWN_INCREASE: 'RISK', CONCENTRATION_INCREASE: 'PORTFOLIO', STRATEGY_DEGRADATION: 'STRATEGY_PERFORMANCE' };
    const id = map[w.code];
    if (id) fired.push({ trigger: id, detail: w.detail, severity: w.severity });
  }

  const unique = [];
  const seen = new Set();
  for (const f of fired) {
    const key = `${f.trigger}|${f.detail || ''}`;
    if (!seen.has(key)) { seen.add(key); unique.push(f); }
  }
  const high = unique.filter((f) => f.severity === 'HIGH').length;
  const verdict = high > 0 ? 'REPLAN_REQUIRED'
    : unique.length >= 2 ? 'REPLAN_RECOMMENDED'
      : unique.length === 1 ? 'REVIEW'
        : 'STILL_VALID';

  const track = goalProgress?.track || null;
  return {
    schema: MONITORING_SCHEMA, brain: CI_SCHEMA, at: now,
    status: 'OK',
    strategyId: strategy.strategyId,
    strategyState: strategy.state,
    verdict,
    triggers: unique,
    goalTrack: track,
    /* The suggested lifecycle move, so the caller does not have to re-derive it
       and possibly disagree with the verdict it just printed. */
    suggestedState: verdict === 'REPLAN_REQUIRED' ? 'DEGRADED' : verdict === 'REPLAN_RECOMMENDED' ? 'MONITORED' : strategy.state,
    explanation: unique.length
      ? `${unique.length} trigger(s) fired since this strategy was approved: ${unique.slice(0, 3).map((f) => f.trigger.toLowerCase()).join(', ')}${high ? ' — at least one is high severity, so the plan is treated as no longer current' : ''}`
      : 'no monitored input crossed a threshold, so the approved plan still stands on the evidence it was chosen with'
  };
}

/* ── §50 Event Intelligence ────────────────────────────────────────────── */

/**
 * A raw event becomes meaning, impact, affected holdings and a suggested
 * posture. Deliberately conservative: the default action is MONITOR, and only
 * an event with a measured magnitude against a held asset escalates.
 */
export function interpretEvent(event = {}, { financialState = null, now = Date.now() } = {}) {
  const type = String(event.type || '').toUpperCase();
  const symbol = String(event.symbol || event.asset || '').toUpperCase() || null;
  const held = symbol && financialState?.assetExposureUsd ? num(financialState.assetExposureUsd[symbol]) : null;
  const netWorth = num(financialState?.netWorthUsd);
  const sharePct = held !== null && netWorth ? round((held / netWorth) * 100, 2) : null;

  const MEANING = {
    WHALE_TRANSFER: 'a large holder moved supply; where it moved to decides whether it is a sale',
    EXCHANGE_INFLOW: 'supply moved onto an exchange, which is where selling happens',
    EXCHANGE_OUTFLOW: 'supply moved off an exchange, which usually means custody rather than sale',
    PRICE_CHANGED: 'the quoted price of a held asset moved',
    LIQUIDATION: 'leveraged positions were force-closed, which can cascade',
    PROTOCOL_EXPLOIT: 'a protocol lost funds; anything deposited there is at risk right now',
    DEPEG: 'a stablecoin traded away from its peg'
  };
  const meaning = MEANING[type] || null;
  if (!meaning) {
    return { schema: MONITORING_SCHEMA, status: 'UNAVAILABLE', reason: 'UNKNOWN_EVENT_TYPE', type, detail: 'no interpretation is offered for an event type this engine does not model' };
  }

  const magnitude = num(event.valueUsd ?? event.amountUsd ?? event.movePct);
  const impact = type === 'PROTOCOL_EXPLOIT' || type === 'DEPEG' ? 'HIGH'
    : sharePct !== null && sharePct > 20 ? 'HIGH'
      : sharePct !== null && sharePct > 5 ? 'MEDIUM'
        : held !== null ? 'LOW' : 'INFORMATIONAL';
  const action = impact === 'HIGH' ? 'REVIEW_NOW' : impact === 'MEDIUM' ? 'MONITOR_CLOSELY' : 'MONITOR';

  return {
    schema: MONITORING_SCHEMA, brain: CI_SCHEMA, at: now, status: 'OK',
    raw: { type, symbol, magnitude, source: event.source || null, observedAt: event.at || null },
    meaning,
    impact,
    affected: held === null ? [] : [{ symbol, exposureUsd: held, sharePct }],
    action,
    explanation: held === null
      ? `${meaning}. You hold none of ${symbol || 'this asset'} in the portfolio that was read, so nothing in your position changes.`
      : `${meaning}. You hold ${held} USD of ${symbol}${sharePct === null ? '' : ` (${sharePct}% of net worth)`}, so the impact is rated ${impact}.`
  };
}

/* ── §49 Daily brief ───────────────────────────────────────────────────── */

/**
 * A digest that only fires on CHANGE. The spec's requirement is "not spam", and
 * the mechanism for that is a hard rule: if nothing crossed a threshold and no
 * warning is open, the brief is `{ send: false }`.
 */
export function buildDailyBrief({
  financialState = null, changes = null, warnings = null, goalProgress = null,
  opportunities = null, news = [], strategy = null, now = Date.now()
} = {}) {
  const materialChanges = (changes?.changes || []).filter((c) => c.material);
  const openWarnings = (warnings?.warnings || []);
  const topOpportunity = (opportunities?.ranked || [])[0] || null;
  const importantNews = (Array.isArray(news) ? news : []).filter((n) => String(n?.impact || '').toUpperCase() === 'HIGH').slice(0, 3);

  const send = Boolean(
    materialChanges.length > 0 || openWarnings.length > 0 || importantNews.length > 0
    || (goalProgress?.track && ['BEHIND', 'AT_RISK'].includes(goalProgress.track))
  );

  return {
    schema: MONITORING_SCHEMA, brain: CI_SCHEMA, at: now,
    send,
    reason: send ? 'at least one monitored measure changed materially' : 'nothing crossed a threshold since the last brief — no notification is sent',
    sections: send ? {
      portfolio: financialState ? { netWorthUsd: financialState.netWorthUsd, drawdownPct: financialState.drawdownPct, stableSharePct: financialState.stableSharePct } : null,
      goal: goalProgress ? { track: goalProgress.track, progressPct: goalProgress.progressPct, deviationPct: goalProgress.deviationPct } : null,
      risk: financialState ? { leverage: financialState.leverage, concentration: financialState.concentration } : null,
      changes: materialChanges.slice(0, 5),
      warnings: openWarnings.slice(0, 5),
      opportunity: topOpportunity ? { id: topOpportunity.id, name: topOpportunity.name, aprPct: topOpportunity.aprPct, score: topOpportunity.opportunityScore } : null,
      news: importantNews,
      strategy: strategy ? { name: strategy.name, state: strategy.state } : null
    } : null
  };
}
