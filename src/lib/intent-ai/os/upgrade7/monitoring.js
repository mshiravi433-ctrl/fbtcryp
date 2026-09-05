/**
 * FBT INTENT OS — UPGRADE 7 · Monitoring · Recurring · Long-Term Goals
 * ---------------------------------------------------------------------------
 * Spec §8 (proactive intelligence, non-spammy, mutable, confirmation-gated),
 * §31 (continuous monitoring of an active intent), §32 (recurring intent →
 * scheduler, never a standing permission for a risky financial action),
 * §33 (intent priority), §35 (long-term goal tracking).
 *
 * `server/intentMonitor.js` / `intentScheduler.js` and `os/monitorClient.js`
 * already exist and keep their jobs. This is the client-side bookkeeping that
 * decides WHAT is worth watching and WHETHER a notification has earned the
 * user's attention.
 */

export const MONITORING_SCHEMA = 'fbt.monitoring.v7';
const STORE_KEY = 'fbt.upgrade7.monitors.v1';

export const MONITOR_STATUS = Object.freeze({
  MONITORING: 'monitoring', TRIGGERED: 'triggered', PAUSED: 'paused', EXPIRED: 'expired', CANCELLED: 'cancelled'
});

export const ALERT_KIND = Object.freeze({
  VOLATILITY: 'btc_volatility', EXPOSURE: 'portfolio_exposure', WALLET_MOVE: 'large_wallet_movement',
  POSITION_RISK: 'position_risk', GAS: 'gas_expensive', BRIDGE_LIQUIDITY: 'bridge_liquidity',
  TARGET_REACHED: 'target_reached', GOAL_PROGRESS: 'goal_progress'
});

let store = null;

function blank() { return { monitors: [], goals: [], notifications: [], settings: { enabled: true, muted: {} } }; }

function load() {
  if (store) return store;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && Array.isArray(p.monitors)) { store = { ...blank(), ...p }; return store; } }
    }
  } catch { /* ignore */ }
  store = blank();
  return store;
}

function persist() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

function mid(p = 'mon') { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

/* -------------------------------------------------------------------------- */
/*  §31 CONTINUOUS MONITORING                                                   */
/* -------------------------------------------------------------------------- */

export function createMonitor({
  intentId = null, planId = null, kind = 'price_target', asset = null,
  target = null, operator = '>=', currentValue = null, expiresAt = null,
  notify = true, conversationId = 'default', label = null
} = {}) {
  const s = load();
  const monitor = {
    id: mid(), schema: MONITORING_SCHEMA, intentId, planId, conversationId,
    kind, asset, target, operator, currentValue, label,
    status: MONITOR_STATUS.MONITORING, notify,
    createdAt: Date.now(), updatedAt: Date.now(), expiresAt, checks: 0, lastCheckedAt: null, triggeredAt: null
  };
  s.monitors.push(monitor);
  if (s.monitors.length > 40) s.monitors = s.monitors.slice(-40);
  persist();
  return monitor;
}

export function listMonitors({ status = null, conversationId = null } = {}) {
  const s = load();
  return s.monitors.filter((m) => (!status || m.status === status) && (!conversationId || m.conversationId === conversationId));
}

function compare(current, target, operator) {
  const a = Number(current); const b = Number(target);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (operator) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': return a === b;
    default: return false;
  }
}

/**
 * Feed live values in; get back the monitors that just crossed their target.
 * @param {object} values  { BTC: 71000, ETH: 3400 }
 */
export function checkMonitors(values = {}, now = Date.now()) {
  const s = load();
  const triggered = [];
  for (const m of s.monitors) {
    if (m.status !== MONITOR_STATUS.MONITORING) continue;
    if (m.expiresAt && now > m.expiresAt) { m.status = MONITOR_STATUS.EXPIRED; m.updatedAt = now; continue; }
    const key = m.asset ? String(m.asset).toUpperCase() : m.kind;
    const current = values[key] ?? values[m.asset] ?? values[m.kind];
    if (current == null) continue;
    m.currentValue = current;
    m.checks += 1;
    m.lastCheckedAt = now;
    if (compare(current, m.target, m.operator)) {
      m.status = MONITOR_STATUS.TRIGGERED;
      m.triggeredAt = now;
      triggered.push(m);
    }
    m.updatedAt = now;
  }
  persist();
  return triggered;
}

export function monitorStatusView(monitor, locale = 'fa') {
  const fa = String(locale || 'fa').startsWith('fa');
  return {
    id: monitor.id,
    target: fa ? `هدف: ${monitor.asset || ''} ${monitor.operator} ${monitor.target}` : `Target: ${monitor.asset || ''} ${monitor.operator} ${monitor.target}`,
    current: fa ? `فعلی: ${monitor.currentValue ?? '—'}` : `Current: ${monitor.currentValue ?? '—'}`,
    status: monitor.status === MONITOR_STATUS.TRIGGERED
      ? (fa ? 'هدف محقق شد' : 'Target reached')
      : (fa ? 'در حال رصد' : 'Monitoring')
  };
}

export function cancelMonitor(id) {
  const s = load();
  const m = s.monitors.find((x) => x.id === id);
  if (m) { m.status = MONITOR_STATUS.CANCELLED; m.updatedAt = Date.now(); persist(); }
  return m || null;
}

/* -------------------------------------------------------------------------- */
/*  §32 RECURRING INTENT                                                        */
/* -------------------------------------------------------------------------- */

const CADENCE_MS = { daily: 86_400_000, weekly: 604_800_000, monthly: 2_592_000_000 };

export function parseRecurrence(text) {
  const t = String(text || '').toLowerCase();
  if (/(هر\s*روز|روزانه|daily|every\s*day)/.test(t)) return { cadence: 'daily', intervalMs: CADENCE_MS.daily };
  if (/(هر\s*هفته|هفتگی|weekly|every\s*week)/.test(t)) return { cadence: 'weekly', intervalMs: CADENCE_MS.weekly };
  if (/(هر\s*ماه|ماهانه|monthly|every\s*month)/.test(t)) return { cadence: 'monthly', intervalMs: CADENCE_MS.monthly };
  return null;
}

/**
 * A recurring financial action is a SCHEDULE, not a blanket permission. Every
 * occurrence re-runs the pre-check and asks again if it is risky (§32).
 */
export function createRecurringIntent({
  intentId = null, cadence = 'monthly', action = null, asset = null, amount = null,
  requiresPermissionEachRun = true, conversationId = 'default', startAt = null
} = {}) {
  const intervalMs = CADENCE_MS[cadence] || CADENCE_MS.monthly;
  const s = load();
  const rec = {
    id: mid('rec'), schema: MONITORING_SCHEMA, kind: 'recurring',
    intentId, conversationId, cadence, intervalMs, action, asset, amount,
    // A risky action can NEVER hold a permanent permission.
    requiresPermissionEachRun: requiresPermissionEachRun || isRisky(action),
    status: MONITOR_STATUS.MONITORING,
    nextRunAt: startAt || Date.now() + intervalMs,
    runs: [], createdAt: Date.now(), updatedAt: Date.now()
  };
  s.monitors.push(rec);
  persist();
  return rec;
}

function isRisky(action) {
  return ['buy', 'sell', 'swap', 'bridge', 'send', 'rebalance', 'stake', 'lend'].includes(String(action || '').toLowerCase());
}

/** The lifecycle each occurrence must walk: pre-check → permission → run → verify. */
export function prepareRecurringRun(rec, { context = {}, now = Date.now() } = {}) {
  if (!rec || rec.status !== MONITOR_STATUS.MONITORING) return { ok: false, reason: 'NOT_ACTIVE' };
  if (now < rec.nextRunAt) return { ok: false, reason: 'NOT_DUE', dueIn: rec.nextRunAt - now };

  const preChecks = {
    walletConnected: Boolean(context.wallet?.connected || context.wallet?.isConnected),
    hasBalance: context.hasBalance !== false,
    dataFresh: context.dataFresh !== false
  };
  const preCheckOk = Object.values(preChecks).every(Boolean);

  return {
    ok: preCheckOk,
    reason: preCheckOk ? null : 'PRECHECK_FAILED',
    preChecks,
    requiresPermission: rec.requiresPermissionEachRun,
    // If it needs permission we ASK; we never execute silently.
    nextStep: !preCheckOk ? 'notify_user' : (rec.requiresPermissionEachRun ? 'request_permission' : 'execute')
  };
}

export function recordRecurringRun(recId, outcome = {}) {
  const s = load();
  const rec = s.monitors.find((m) => m.id === recId);
  if (!rec) return null;
  rec.runs.push({ at: Date.now(), ...outcome });
  if (rec.runs.length > 24) rec.runs = rec.runs.slice(-24);
  rec.nextRunAt = Date.now() + rec.intervalMs;
  rec.updatedAt = Date.now();
  persist();
  return rec;
}

/* -------------------------------------------------------------------------- */
/*  §35 LONG-TERM GOAL TRACKING                                                 */
/* -------------------------------------------------------------------------- */

export function createLongTermGoal({ label = null, targetValueUsd = null, currentValueUsd = null, months = 12, conversationId = 'default' } = {}) {
  const s = load();
  const goal = {
    id: mid('goal'), label, targetValueUsd, startValueUsd: currentValueUsd, currentValueUsd,
    months, conversationId, status: 'active',
    createdAt: Date.now(), deadlineAt: Date.now() + months * 2_592_000_000, updatedAt: Date.now(), history: []
  };
  s.goals.push(goal);
  if (s.goals.length > 10) s.goals = s.goals.slice(-10);
  persist();
  return goal;
}

export function updateGoalProgress(goalId, currentValueUsd) {
  const s = load();
  const g = s.goals.find((x) => x.id === goalId);
  if (!g) return null;
  g.currentValueUsd = currentValueUsd;
  g.history.push({ at: Date.now(), value: currentValueUsd });
  if (g.history.length > 60) g.history = g.history.slice(-60);
  if (g.targetValueUsd && currentValueUsd >= g.targetValueUsd) g.status = 'reached';
  g.updatedAt = Date.now();
  persist();
  return goalProgress(g);
}

export function goalProgress(goal) {
  if (!goal) return null;
  const start = Number(goal.startValueUsd) || 0;
  const cur = Number(goal.currentValueUsd) || 0;
  const target = Number(goal.targetValueUsd) || 0;
  const span = target - start;
  const pct = span > 0 ? Math.max(0, Math.min(100, Math.round(((cur - start) / span) * 100))) : null;
  const elapsed = Date.now() - goal.createdAt;
  const totalTime = goal.deadlineAt - goal.createdAt;
  const timePct = totalTime > 0 ? Math.round((elapsed / totalTime) * 100) : null;
  return {
    ...goal,
    progressPct: pct,
    timeElapsedPct: timePct,
    // Behind schedule is a fact worth stating; a forecast is not.
    onTrack: pct != null && timePct != null ? pct >= timePct - 10 : null
  };
}

export function listGoals({ conversationId = null } = {}) {
  return load().goals.filter((g) => !conversationId || g.conversationId === conversationId).map(goalProgress);
}

/* -------------------------------------------------------------------------- */
/*  §8 PROACTIVE NOTIFICATIONS — relevant, non-spam, mutable                    */
/* -------------------------------------------------------------------------- */

const RELEVANCE_FLOOR = 0.5;
const COOLDOWN_MS = { [ALERT_KIND.VOLATILITY]: 3_600_000, [ALERT_KIND.GAS]: 1_800_000, default: 900_000 };

export function setNotificationsEnabled(enabled) {
  const s = load();
  s.settings.enabled = Boolean(enabled);
  persist();
  return s.settings;
}

export function muteAlertKind(kind, muted = true) {
  const s = load();
  s.settings.muted[kind] = Boolean(muted);
  persist();
  return s.settings;
}

export function getNotificationSettings() { return { ...load().settings }; }

/**
 * Decide whether an alert is allowed to interrupt. Four gates: master switch,
 * per-kind mute, relevance to what this user actually holds, and a cooldown so
 * the same alert cannot fire twice in a row (§8).
 */
export function shouldNotify({ kind, relevance = 0.5, now = Date.now() } = {}) {
  const s = load();
  if (!s.settings.enabled) return { allowed: false, reason: 'NOTIFICATIONS_DISABLED' };
  if (s.settings.muted[kind]) return { allowed: false, reason: 'KIND_MUTED' };
  if (relevance < RELEVANCE_FLOOR) return { allowed: false, reason: 'NOT_RELEVANT' };
  const last = [...s.notifications].reverse().find((n) => n.kind === kind);
  const cooldown = COOLDOWN_MS[kind] || COOLDOWN_MS.default;
  if (last && now - last.at < cooldown) return { allowed: false, reason: 'COOLDOWN', retryAfterMs: cooldown - (now - last.at) };
  return { allowed: true };
}

export function computeRelevance({ kind, asset = null, portfolio = null, monitors = [] } = {}) {
  let score = 0.4;
  const holdings = portfolio?.holdings || [];
  const total = Number(portfolio?.totalValueUsd) || 0;
  if (asset && holdings.length) {
    const h = holdings.find((x) => String(x.symbol).toUpperCase() === String(asset).toUpperCase());
    if (h) {
      const weight = total > 0 ? (Number(h.valueUsd) || 0) / total : 0;
      score += 0.25 + Math.min(0.35, weight);        // held, and weighted by size
    } else score -= 0.15;                             // not held → less interesting
  }
  if (monitors.some((m) => m.asset && asset && String(m.asset).toUpperCase() === String(asset).toUpperCase())) score += 0.25;
  if (kind === ALERT_KIND.POSITION_RISK || kind === ALERT_KIND.TARGET_REACHED) score += 0.2;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

export function emitNotification({ kind, title, body, asset = null, relevance = 0.5, requiresConfirmation = false, action = null } = {}) {
  const gate = shouldNotify({ kind, relevance });
  if (!gate.allowed) return { emitted: false, ...gate };
  const s = load();
  const note = {
    id: mid('note'), kind, title, body, asset, relevance,
    // A notification may PROPOSE a financial action; it may never perform one.
    requiresConfirmation: requiresConfirmation || isRisky(action?.type),
    action: action || null,
    at: Date.now(), read: false, dismissible: true
  };
  s.notifications.push(note);
  if (s.notifications.length > 50) s.notifications = s.notifications.slice(-50);
  persist();
  return { emitted: true, notification: note };
}

export function listNotifications({ unreadOnly = false, limit = 20 } = {}) {
  const s = load();
  return s.notifications.filter((n) => !unreadOnly || !n.read).slice(-limit).reverse();
}

export function markNotificationRead(id) {
  const s = load();
  const n = s.notifications.find((x) => x.id === id);
  if (n) { n.read = true; persist(); }
  return n || null;
}

export function clearMonitoring() { store = blank(); persist(); }
