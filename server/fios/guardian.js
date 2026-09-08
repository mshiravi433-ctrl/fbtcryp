/**
 * FBT FINANCIAL INTELLIGENCE OS — Proactive Guardian + Replanning (batch 5).
 * ---------------------------------------------------------------------------
 * The guardian is the part of the system that speaks UP instead of waiting
 * to be asked. It has three jobs:
 *
 *   1. MONITORING   every `check()` compares the current financial state with
 *                   the previous snapshot and reports only what crossed a
 *                   decision-relevant threshold (the thresholds live in
 *                   src/lib/central/monitoring.js and say WHY they are
 *                   where they are). A 2% wobble is not an alert; a 5% net
 *                   worth move is, because a decision taken on the old value
 *                   could have been different.
 *   2. EARLY WARNINGS   problems while they are still small: goal deviation,
 *                   leverage creep, liquidity drying up, drawdown,
 *                   concentration. Each warning carries its distance to the
 *                   danger line and the action that would clear it.
 *   3. REPLANNING   when the approved plan no longer fits the world, the
 *                   guardian says so with the exact triggers that fired and
 *                   — when a regeneration path is wired — runs it: new
 *                   strategies, new competition, a new decision that names
 *                   the old one as what it replaced.
 *
 * THE GUARDIAN CANNOT APPROVE
 * `consult()` returns findings; a BLOCK finding stops a run, a WARN rides
 * along as a note. It has no `approve` method because there is nothing to
 * implement: permission is the policy engine's and the user's, and this file
 * refuses to grow a third source of it.
 *
 * Change detection and early warnings are NOT re-implemented: both come from
 * `src/lib/central/monitoring.js` (`detectChanges`, `earlyWarnings`,
 * `evaluateStrategy`, `REPLAN_TRIGGERS`), so the supervised and the
 * autonomous paths are watched by the same instrument.
 */
import { randomUUID } from 'node:crypto';
import { detectChanges, earlyWarnings, evaluateStrategy, REPLAN_TRIGGERS } from '../../src/lib/central/monitoring.js';
import { financialGuardian } from '../../src/lib/central/council.js';
import { requireFlag } from './flags.js';
import { snapshotRow, headline } from './financialState.js';
import { readValue } from './provenance.js';

export const GUARDIAN_SCHEMA = 'fbt.fi.guardian.v1';

const MAX_ALERTS = 100;
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'PYUSD', 'FDUSD']);

/**
 * Shape the canonical financial state (server/fios/financialState.js) into
 * the record `earlyWarnings`/`detectChanges` read (src/lib/central shape).
 * Only real reads become numbers; everything else is null and the warnings
 * skip it.
 */
export function monitoringShape(financial = null) {
  if (!financial || financial.status === 'UNAVAILABLE') return null;
  const netWorthUsd = readValue(financial.net?.netWorthUsd);
  const debtUsd = readValue(financial.net?.debtUsd);
  const drawdownPct = readValue(financial.performance?.drawdownPct);
  const volatilityPct = readValue(financial.risk?.volatilityPct);
  const leverage = readValue(financial.risk?.leverage);
  const concentration = readValue(financial.risk?.concentration) || null;

  /* Stable share from the real holdings, not from an assumption. */
  let stableSharePct = null;
  const holdings = financial.computed?.holdings || financial.sections?.portfolio?.data?.holdings || [];
  const total = Array.isArray(holdings) ? holdings.reduce((a, h) => a + (Number(h?.valueUsd) > 0 ? Number(h.valueUsd) : 0), 0) : 0;
  if (total > 0) {
    const stables = Array.isArray(holdings)
      ? holdings.reduce((a, h) => (STABLES.has(String(h?.symbol || '').toUpperCase()) && Number(h?.valueUsd) > 0 ? a + Number(h.valueUsd) : a), 0)
      : 0;
    stableSharePct = Math.round((stables / total) * 10000) / 100;
  }

  return {
    status: financial.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'OK',
    netWorthUsd,
    availableCapitalUsd: readValue(financial.net?.availableCapitalUsd),
    debtUsd,
    drawdownPct,
    volatilityPct,
    leverage,
    stableSharePct,
    concentration: concentration && Number(concentration.topSharePct) != null
      ? { topAsset: concentration.topAsset, topSharePct: concentration.topSharePct, unavailable: false }
      : null
  };
}

export function createGuardian({ collections, observability = null, policyEngine = null, regen = null, log = () => {}, now = () => Date.now() } = {}) {
  const alerts = new Map(); // owner -> bounded ring of alert rows

  function pushAlert(owner, alert) {
    const ring = alerts.get(owner) || [];
    ring.push(alert);
    alerts.set(owner, ring.slice(-MAX_ALERTS));
    return ring;
  }

  /**
   * One monitoring pass. Reads the previous snapshot, computes what changed
   * and what is warning, emits the events, and stores the new snapshot so
   * the NEXT pass has a baseline.
   *
   * @param {object} p
   * @param {string} p.owner
   * @param {object} p.financial      canonical financial state (this pass)
   * @param {object} [p.goalProgress] { deviationPct, track }
   * @param {object} [p.strategy]     the active strategy row (lifecycle)
   * @param {object} [p.profile]      { concentrationTolerancePct: { value } }
   */
  async function check({ owner, financial = null, goalProgress = null, strategy = null, profile = null, correlationId = null } = {}) {
    const gate = requireFlag('PROACTIVE_GUARDIAN_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const at = now();

    const current = financial ? snapshotRow(financial) : null;
    if (!current) {
      return { ok: false, code: 'NO_FINANCIAL_STATE', detail: 'the financial state was not readable; the guardian monitors what exists, not what is hoped for' };
    }

    const { rows } = await collections.read('financial_state', owner);
    const previous = (rows.find((r) => r?.id === 'snapshot') || rows[0])?.values || null;

    const changes = previous ? detectChanges(previous, current, { now: at }) : { changed: false, count: 0, changes: [], note: 'first snapshot; nothing to compare against yet' };
    const shape = monitoringShape(financial);
    const warningsOut = earlyWarnings({ financialState: shape, goalProgress, strategy, profile, now: at });

    const newAlerts = [];
    const add = (code, severity, detail, suggestion = null, meta = {}) => {
      const alert = { id: `alm_${randomUUID().replace(/-/g, '').slice(0, 16)}`, owner: String(owner).slice(0, 80), code, severity, detail, suggestion, at, ...meta };
      newAlerts.push(alert);
      if (observability) observability.emit({ type: severity === 'HIGH' ? 'guardian.alerted' : 'monitor.triggered', owner, correlationId, severity: severity === 'HIGH' ? 'critical' : 'warning', payload: { code, detail: String(detail).slice(0, 160) } });
    };

    for (const c of changes.changes) {
      add('CHANGE_DETECTED', c.kind === 'BAND' ? 'MEDIUM' : 'INFO',
        `${c.field}: ${c.before} → ${c.after} (${c.deltaPct !== null ? `${c.deltaPct}%` : `Δ${c.delta}`}); ${c.why}`,
        null, { field: c.field, before: c.before, after: c.after });
    }
    for (const w of warningsOut.warnings) {
      add(w.code, w.severity === 'HIGH' ? 'HIGH' : 'MEDIUM', w.detail, w.suggestion, { distance: w.distance });
    }

    /* Store this pass's snapshot as the next pass's baseline. One row per
       owner (id fixed) so the collection cap is never a concern. */
    const row = { id: 'snapshot', at, values: current, headline: headline(financial) || null };
    await collections.put('financial_state', owner, row);

    const out = {
      ok: true,
      schema: GUARDIAN_SCHEMA,
      at,
      changed: changes.changed,
      changes: changes.changes,
      warnings: warningsOut.warnings,
      alerts: newAlerts,
      snapshot: row,
      headline: row.headline,
      durable: collections.durable(),
      note: newAlerts.length ? `${newAlerts.length} new alert(s)` : 'inside every monitored band'
    };
    if (newAlerts.length) {
      const ring = pushAlert(owner, ...newAlerts);
      out.recent = ring.slice(-20).reverse();
    }
    return out;
  }

  /**
   * The pre-flight consult the autonomy loop asks: given THIS request and
   * THIS state, does the guardian block it? Uses the shared
   * `financialGuardian` (src/lib/central/council.js) for the suitability
   * checks, plus a live risk/security pass. Returns findings; the caller
   * decides — and in this codebase the loop decides "block on BLOCK".
   */
  async function consult({ owner, request = {}, policy = null, financial = null, risk = null, decision = null, goal = null, profile = null } = {}) {
    const at = now();
    const findings = [];

    const blocking = (id, detail) => findings.push({ id, ok: false, unknown: false, severity: 'BLOCK', detail });
    const warn = (id, detail) => findings.push({ id, ok: false, unknown: false, severity: 'WARN', detail });
    const ok = (id, detail) => findings.push({ id, ok: true, unknown: false, severity: 'INFO', detail });
    const unknown = (id, detail) => findings.push({ id, ok: null, unknown: true, severity: 'WARN', detail });

    /* Security signals are non-negotiable. */
    const signals = Array.isArray(risk?.securitySignals) ? risk.securitySignals : [];
    if (signals.length) {
      blocking('security-signals', `security signals present: ${signals.slice(0, 4).map((s) => (s?.code ? String(s.code) : String(s).slice(0, 40))).join(', ')}`);
    } else {
      ok('security-signals', 'no security signal was raised by any read');
    }

    /* CRITICAL risk stops everything, guardian or not. */
    const level = String(risk?.level || '').toUpperCase();
    if (level === 'CRITICAL') blocking('critical-risk', 'the risk engine is at CRITICAL for this owner right now');
    else if (level) ok('risk-level', `risk level ${level}`);
    else unknown('risk-level', 'no risk assessment was supplied for this run');

    /* Freshness: an execution on stale state is a decision on yesterday. */
    const stale = financial?.provenance?.stale || [];
    const unavailable = financial?.provenance?.unavailable || [];
    if (stale.length || unavailable.length) {
      warn('data-freshness', `${stale.length} stale / ${unavailable.length} unavailable input(s): ${[...stale, ...unavailable].slice(0, 4).join(', ')}`);
    } else if (financial?.confidence !== undefined) {
      ok('data-freshness', `state confidence ${financial.confidence}`);
    }

    /* The shared suitability instrument: goal consistency, tolerance,
       exposure, contradiction, downside. */
    const shared = financialGuardian({
      decision: {
        id: decision?.id || null,
        type: decision?.decision || decision?.type || request.kind,
        riskLevel: level || null,
        expectedReturnPct: decision?.expectedReturnPct ?? null,
        capitalRequiredUsd: Number.isFinite(Number(request.amountUsd)) ? Number(request.amountUsd) : null,
        downside: decision?.downside || (Number.isFinite(Number(request.amountUsd)) ? `up to $${request.amountUsd} is at work under policy limits` : null)
      },
      goal: goal || null,
      profile: profile || { riskProfile: { value: policy?.riskLimit || null } },
      financialState: {
        availableCapitalUsd: readValue(financial?.net?.availableCapitalUsd),
        netWorthUsd: readValue(financial?.net?.netWorthUsd)
      },
      freshnessReport: { stale: stale.map((s) => ({ key: s })), unavailable: unavailable.map((s) => ({ key: s })) },
      now: at
    });
    for (const f of shared.findings) {
      if (!f.ok && !f.unknown && f.severity === 'BLOCK') blocking(`suitability:${f.id}`, f.detail);
      else if (!f.ok && !f.unknown) warn(`suitability:${f.id}`, f.detail);
      else if (f.unknown) unknown(`suitability:${f.id}`, f.detail);
      else ok(`suitability:${f.id}`, f.detail);
    }

    const blockList = findings.filter((f) => !f.ok && !f.unknown && f.severity === 'BLOCK');
    const warnList = findings.filter((f) => !f.ok && !f.unknown && f.severity === 'WARN');
    return {
      ok: true,
      schema: GUARDIAN_SCHEMA,
      at,
      status: blockList.length ? 'BLOCK' : warnList.length ? 'WARN' : 'PASS',
      blocking: blockList,
      warnings: warnList,
      unknowns: findings.filter((f) => f.unknown),
      findings,
      grantsPermission: false
    };
  }

  /**
   * Replanning: is the approved plan still the right one?
   *
   * With `regen` wired (the HTTP layer passes the real pipeline), a verdict
   * of REPLAN_REQUIRED / REPLAN_RECOMMENDED runs it: new strategies, new
   * competition, a new decision that names the one it replaces. Without it,
   * the honest answer is the verdict + triggers + `replanned: false`.
   *
   * @param {object} p
   * @param {object} [p.strategy]   the active strategy row ({ strategyId, state, name, expectedReturnPct, realisedReturnPct })
   * @param {object} [p.changes]    a `check()` changes result
   * @param {object} [p.warnings]   a `check()` warnings result
   * @param {string[]} [p.triggers] raw trigger ids ({ type, detail, severity } or plain ids)
   * @param {object} [p.context]    everything the regeneration pipeline needs (owner, financial, world, preferences, goal, risk, intent…)
   */
  async function replan({ owner, strategy = null, changes = null, warnings = null, triggers = [], goalProgress = null, context = {}, correlationId = null } = {}) {
    const gate = requireFlag('PROACTIVE_GUARDIAN_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const at = now();

    const evaluation = evaluateStrategy({
      strategy: strategy ? { strategyId: strategy.strategyId || strategy.id, state: strategy.state || 'ACTIVE', name: strategy.name || null, expectedReturnPct: strategy.expectedReturnPct ?? null, realisedReturnPct: strategy.realisedReturnPct ?? null } : null,
      changes, warnings, goalProgress,
      triggers: Array.isArray(triggers) ? triggers : [],
      now: at
    });

    const base = {
      ok: true,
      schema: GUARDIAN_SCHEMA,
      at,
      verdict: evaluation.verdict,
      strategyId: strategy?.strategyId || strategy?.id || null,
      triggers: evaluation.triggers,
      goalTrack: evaluation.goalTrack,
      suggestedState: evaluation.suggestedState,
      explanation: evaluation.explanation,
      replanned: false,
      triggersVocabulary: REPLAN_TRIGGERS
    };

    if (evaluation.status === 'UNAVAILABLE') {
      return { ...base, ok: false, code: 'NO_ACTIVE_STRATEGY', detail: 'a replan needs the strategy it would replace; without it the question is "what should we do", which is /strategies' };
    }
    if (evaluation.verdict === 'STILL_VALID') {
      return { ...base, note: 'the approved plan still stands on the evidence it was chosen with' };
    }
    if (typeof regen !== 'function') {
      return { ...base, code: 'REGEN_NOT_WIRED', detail: 'a replan is warranted but no regeneration pipeline is wired in this context; the verdict and its triggers are the answer' };
    }
    if (observability) observability.emit({ type: 'replan.started', owner, correlationId, payload: { verdict: evaluation.verdict, triggers: evaluation.triggers.map((t) => t.trigger) } });
    try {
      const regenerated = await regen({ owner, context, reason: evaluation.explanation, triggers: evaluation.triggers, correlationId });
      if (!regenerated?.ok) {
        return { ...base, code: regenerated?.code || 'REPLAN_FAILED', detail: regenerated?.detail || 'regeneration failed; the old plan is left untouched rather than replaced by a broken one' };
      }
      if (observability) observability.emit({ type: 'replan.completed', owner, correlationId, payload: { verdict: evaluation.verdict, decisionId: regenerated.decision?.id || null, strategyId: regenerated.decision?.strategyId || null } });
      return {
        ...base,
        replanned: true,
        verdict: 'REPLANNED',
        decision: regenerated.decision || null,
        strategies: regenerated.strategies || null,
        competition: regenerated.competition || null,
        replacedStrategyId: strategy?.strategyId || strategy?.id || null
      };
    } catch (err) {
      log(`guardian:replan-failed:${String(err?.message || err).slice(0, 120)}`);
      return { ...base, code: 'REPLAN_FAILED', detail: String(err?.message || err).slice(0, 160) };
    }
  }

  /** Stop every active policy. The API's STOP button, the UI and this file
   *  all arrive at the same place in policy.js. */
  async function emergencyStop(owner, { reason = 'stopped by the user', by = 'user' } = {}) {
    if (!policyEngine) return { ok: false, code: 'POLICY_ENGINE_NOT_WIRED' };
    const out = await policyEngine.emergencyStop(owner, { reason, by });
    if (out.ok) {
      pushAlert(owner, { id: `alm_${randomUUID().replace(/-/g, '').slice(0, 16)}`, owner: String(owner).slice(0, 80), code: 'EMERGENCY_STOP', severity: 'HIGH', detail: `all policies stopped: ${reason}`, at: now() });
      if (observability) observability.emit({ type: 'guardian.alerted', owner, severity: 'critical', payload: { code: 'EMERGENCY_STOP', detail: String(reason).slice(0, 160) } });
    }
    return out;
  }

  /** The operator view: recent alerts, the last check, the policy stop
   *  state. What the panel shows under "Guardian". */
  async function status(owner) {
    const ring = (alerts.get(owner) || []).slice(-20).reverse();
    const { rows } = await collections.read('financial_state', owner);
    const lastSnapshot = rows.find((r) => r?.id === 'snapshot') || null;
    const policies = policyEngine ? await policyEngine.status(owner) : null;
    return {
      ok: true,
      schema: GUARDIAN_SCHEMA,
      flag: requireFlag('PROACTIVE_GUARDIAN_ENABLED'),
      lastCheckAt: lastSnapshot?.at || null,
      lastHeadline: lastSnapshot?.headline || null,
      recentAlerts: ring,
      policies: policies ? { count: policies.count, anyEmergency: policies.anyEmergency, emergencies: (policies.policies || []).filter((p) => p.emergency).map((p) => ({ policyId: p.id, at: p.emergency.at, reason: p.emergency.reason, by: p.emergency.by })) } : null,
      durable: collections.durable()
    };
  }

  return {
    schema: GUARDIAN_SCHEMA,
    check, consult, replan, emergencyStop, status,
    monitoringShape,
    _alerts: (owner) => (alerts.get(owner) || []).slice(-20).reverse()
  };
}
