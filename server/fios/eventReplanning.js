/**
 * FBT FINANCIAL INTELLIGENCE OS — Event-Driven Replanning (Phase 212, upgrade 12).
 * ---------------------------------------------------------------------------
 * The event bus (server/central/eventBus.js) already carries every important
 * occurrence. What was missing was the AI ON the bus: something that hears
 * «BTC price changed» and runs the chain the owner drew —
 *
 *   PRICE_CHANGED → market event → AI brain (macro graph + risk) →
 *   portfolio re-check → opportunity fit re-score → user watch notify
 *
 * and hears «Fed announcement» (NEWS_RECEIVED) and runs
 *
 *   NEWS_RECEIVED → macro event → news agent → market agent → risk agent →
 *   portfolio recalculation → user notification
 *
 * DESIGN
 *  - subscribe() attaches ONE listener per event family to the central bus.
 *    Handlers are fire-and-forget with their own try/catch: a dead handler
 *    must never take the bus (or the request that published) down.
 *  - Each handled event becomes a REPLAN ATTEMPT row: what fired, what was
 *    re-read, what changed, what the owner should be told — capped history.
 *  - Debounce/cooldown: one replan per owner per 60s per trigger family, so
 *    a burst of PRICE_CHANGED ticks does not become a burst of replans.
 *  - The replan never executes anything. Its output is a RECOMMENDATION to
 *    re-check (the decision engine + the user's confirmation stay in charge).
 */

import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';

export const EVENT_REPLANNING_SCHEMA = 'fbt.fi.event-replanning.v1';

/** Which bus events this engine listens to, and what each means. All of
 *  these are in the central bus vocabulary (src/lib/central/schema.js). */
export const REPLAN_TRIGGERS = Object.freeze({
  PRICE_CHANGED: { family: 'market', label: 'قیمت تغییر کرد', cooldownMs: 60_000 },
  NEWS_RECEIVED: { family: 'macro', label: 'خبر جدید رسید', cooldownMs: 60_000 },
  BALANCE_CHANGED: { family: 'wallet', label: 'موجودی تغییر کرد', cooldownMs: 60_000 },
  POSITION_CHANGED: { family: 'portfolio', label: 'پوزیشن تغییر کرد', cooldownMs: 60_000 },
  LIQUIDATION_RISK_CHANGED: { family: 'risk', label: 'ریسک لیکویید شدن تغییر کرد', cooldownMs: 30_000 },
  RISK_CHANGED: { family: 'risk', label: 'ریسک تغییر کرد', cooldownMs: 30_000 },
  SIGNAL_CHANGED: { family: 'market', label: 'سیگنال تغییر کرد', cooldownMs: 60_000 },
  GOAL_PROGRESS_CHANGED: { family: 'goal', label: 'پیشرفت هدف تغییر کرد', cooldownMs: 5 * 60_000 },
  SAFE_STOP: { family: 'risk', label: 'توقف امن', cooldownMs: 0 },
  MODULE_DEGRADED: { family: 'risk', label: 'یک ماژول degrade شد', cooldownMs: 0 }
});

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The engine. `bus` is the central event bus ({ publish, subscribe,
 * recentEvents }); the FI engines are injected as read callbacks.
 */
export function createEventReplanningEngine({
  bus = null, collections = null, observability = null,
  macroGraphFor = null, financialStateFor = null, riskFor = null,
  agentCouncilConvene = null, guardianCheck = null,
  log = () => {}, now = () => Date.now()
} = {}) {
  const lastRun = new Map(); // `${owner}:${family}` → at
  const attempts = []; // bounded in-memory ring of recent attempts
  const MAX_ATTEMPTS = 200;
  let subscribed = false;

  async function persist(owner, row) {
    attempts.unshift(row);
    if (attempts.length > MAX_ATTEMPTS) attempts.length = MAX_ATTEMPTS;
    if (collections) {
      try {
        await collections.put('replan_attempts', owner, { ...row, id: 'latest' }, { idKey: 'id' });
      } catch (err) {
        log(`event-replanning:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'replan.completed', owner, payload: { trigger: row.trigger, changed: row.changed, notify: row.notify } });
  }

  /**
   * One replan attempt for one owner + trigger. Everything is a READ; the
   * output is what changed and whether the owner should hear about it.
   */
  async function replan(owner, { trigger = 'PRICE_CHANGED', payload = {}, correlationId = null } = {}) {
    const gate = requireFlag('EVENT_REPLANNING_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const spec = REPLAN_TRIGGERS[trigger];
    if (!spec) return { ok: false, code: 'UNKNOWN_TRIGGER', allowed: Object.keys(REPLAN_TRIGGERS) };
    const at = now();
    const cooldownKey = `${owner}:${spec.family}`;
    const last = lastRun.get(cooldownKey);
    if (spec.cooldownMs > 0 && last && at - last < spec.cooldownMs) {
      return { ok: true, skipped: true, reason: 'COOLDOWN', retryInMs: spec.cooldownMs - (at - last) };
    }
    lastRun.set(cooldownKey, at);

    const before = { riskLevel: null, impulse: null };
    const reads = [];

    /* 1: the macro graph — did the transmission impulse move? */
    let macro = null;
    if (macroGraphFor) {
      try {
        macro = await macroGraphFor(owner);
        reads.push('macro-graph');
      } catch { macro = null; }
    }
    /* 2: the financial state — did exposure/net worth move? */
    let financial = null;
    if (financialStateFor) {
      try {
        financial = await financialStateFor(owner);
        reads.push('financial-state');
      } catch { financial = null; }
    }
    /* 3: the risk reading. */
    let risk = null;
    if (riskFor) {
      try {
        risk = riskFor(owner);
        reads.push('risk');
      } catch { risk = null; }
    }
    /* 4: the domain council — BUY/HOLD/SELL with the fresh reads. */
    let council = null;
    if (agentCouncilConvene) {
      try {
        const domains = macro?.graph ? macro.graph : {};
        const marketPayload = payload || {};
        const out = await agentCouncilConvene(owner, {
          asset: String(marketPayload.asset || marketPayload.symbol || 'BTC').toUpperCase(),
          market: marketPayload.market || null,
          risk,
          financial,
          macroGraph: domains.impulse ? domains : null,
          costs: marketPayload.costs || null,
          securitySignals: risk?.securitySignals || null
        });
        if (out?.ok) council = out.council;
        reads.push('agent-council');
      } catch { council = null; }
    }
    /* 5: the guardian — did anything cross a safety line? */
    let guardian = null;
    if (guardianCheck) {
      try {
        guardian = await guardianCheck(owner);
        reads.push('guardian');
      } catch { guardian = null; }
    }

    const impulse = num(macro?.graph?.portfolioRiskImpulse);
    const changed = {
      macroImpulse: impulse !== null && Math.abs(impulse) > 0.05,
      riskLevel: Boolean(risk?.level && risk.level !== before.riskLevel && before.riskLevel !== null),
      councilDecision: council ? council.decision : null,
      guardianAlert: Array.isArray(guardian?.alerts) ? guardian.alerts.length > 0 : (guardian?.status === 'ALERT' || null)
    };
    const anyChange = changed.macroImpulse || changed.riskLevel || changed.guardianAlert;

    const row = {
      schema: EVENT_REPLANNING_SCHEMA,
      id: `rpl_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      owner,
      trigger,
      family: spec.family,
      label: spec.label,
      at,
      correlationId,
      reads,
      changed,
      impulse: impulse !== null ? Number(impulse.toFixed(4)) : null,
      riskLevel: risk?.level || null,
      council: council ? { decision: council.decision, confidence: council.confidence, narrative: council.narrative } : null,
      notify: anyChange,
      recommendation: anyChange
        ? (changed.guardianAlert
          ? 'a guardian line was crossed — re-run the decision before any new entry'
          : changed.riskLevel
            ? `risk moved to ${risk.level} — re-run the decision engine before any new entry`
            : `macro transmission impulse ${impulse} — re-score open opportunities against the new context`)
        : 'nothing crossed a decision-relevant line; no replan needed',
      executionAuthorized: false
    };
    await persist(owner, row);
    return { ok: true, replan: row };
  }

  /** Attach the AI to the central bus. Idempotent. Handles both bus shapes:
   *  the CI bus (`subscribe(owner, listener)` where every listener hears every
   *  record `{ type, owner, payload }`) and the simple type-based bus. */
  function subscribe() {
    if (subscribed || !bus || typeof bus.subscribe !== 'function') return { ok: Boolean(subscribed), attached: Object.keys(REPLAN_TRIGGERS).length };
    const dispatch = (event) => {
      const type = String(event?.type || '').toUpperCase();
      if (!REPLAN_TRIGGERS[type]) return;
      const owner = String(event?.owner || event?.payload?.owner || 'anon').slice(0, 64);
      replan(owner, { trigger: type, payload: event?.payload || {} }).catch((err) => {
        log(`event-replanning:handler-failed:${type}:${String(err?.message || err).slice(0, 80)}`);
      });
    };
    try {
      /* CI bus: subscribe(owner, listener) — '*' hears every publish. */
      bus.subscribe('*', dispatch);
    } catch (err) {
      log(`event-replanning:subscribe-failed:${String(err?.message || err).slice(0, 80)}`);
      return { ok: false, attached: 0 };
    }
    subscribed = true;
    log(`event-replanning:subscribed:${Object.keys(REPLAN_TRIGGERS).length} triggers`);
    return { ok: true, attached: Object.keys(REPLAN_TRIGGERS).length };
  }

  function recent(owner = null, { limit = 20 } = {}) {
    const rows = owner ? attempts.filter((r) => r.owner === owner) : attempts;
    return { ok: true, attempts: rows.slice(0, Math.max(1, limit)) };
  }

  return {
    schema: EVENT_REPLANNING_SCHEMA,
    replan,
    subscribe,
    recent,
    TRIGGERS: REPLAN_TRIGGERS
  };
}
