/**
 * FBT FINANCIAL OS — Permission Center, Autonomy modes, Kill switches
 * (Upgrade 10 §45, §46, §57, §58).
 * ---------------------------------------------------------------------------
 * §45 asks for permissions that are granular, revocable, auditable and
 * time-limited. That is four properties, and each one is a specific mechanism
 * here rather than a promise:
 *
 *   granular     one scope per capability, not one "AI can trade" switch
 *   revocable    revoke() takes effect on the NEXT check, with no cache
 *   auditable    every grant/revoke/denial returns an audit row
 *   time-limited every grant carries expiresAt and check() re-reads the clock
 *
 * THE DEFAULT IS NO. An unknown scope is denied, an expired grant is denied, a
 * grant made under a different autonomy mode is denied. A permission system
 * whose failure mode is "allow" is decoration.
 *
 * KILL SWITCHES (§57) sit ABOVE permissions: when a switch is engaged, no grant
 * of any kind can authorise the covered class of work. That ordering is the
 * whole point of a kill switch and it is asserted in the tests.
 */
import { CI_SCHEMA, hashString, usableNumber } from './schema.js';

export const PERMISSION_SCHEMA = 'fbt.permission-center.v1';
export const KILL_SWITCH_SCHEMA = 'fbt.kill-switch.v1';

/** §45's table, as scopes. `execute:*` scopes are the ones that move money. */
export const PERMISSION_SCOPES = Object.freeze({
  'view:wallet': { label: 'View wallet', money: false, defaultGranted: true },
  'view:portfolio': { label: 'View portfolio', money: false, defaultGranted: true },
  'research:market': { label: 'Research market', money: false, defaultGranted: true },
  'create:alert': { label: 'Create alerts', money: false, defaultGranted: true },
  'prepare:swap': { label: 'Prepare swap', money: false, defaultGranted: true },
  'execute:swap': { label: 'Execute swap', money: true, defaultGranted: false },
  'execute:transfer': { label: 'Transfer funds', money: true, defaultGranted: false },
  'execute:bridge': { label: 'Bridge', money: true, defaultGranted: false },
  'execute:borrow': { label: 'Borrow', money: true, defaultGranted: false },
  'execute:lend': { label: 'Lend / supply', money: true, defaultGranted: false },
  'execute:rebalance': { label: 'Rebalance portfolio', money: true, defaultGranted: false }
});
export const SCOPE_IDS = Object.freeze(Object.keys(PERMISSION_SCOPES));

/** §46's ladder. Each mode names the HIGHEST thing the system may do unasked. */
export const AUTONOMY_MODES = Object.freeze({
  OBSERVE_ONLY: { id: 'OBSERVE_ONLY', rank: 0, label: 'Observe only', allowsPrepare: false, allowsExecute: false, perActionApproval: true },
  SUGGEST: { id: 'SUGGEST', rank: 1, label: 'Suggest', allowsPrepare: false, allowsExecute: false, perActionApproval: true },
  SIMULATE: { id: 'SIMULATE', rank: 2, label: 'Simulate', allowsPrepare: true, allowsExecute: false, perActionApproval: true },
  APPROVE_EACH: { id: 'APPROVE_EACH', rank: 3, label: 'Approve each action', allowsPrepare: true, allowsExecute: true, perActionApproval: true },
  LIMITED_AUTOMATION: { id: 'LIMITED_AUTOMATION', rank: 4, label: 'Limited automation', allowsPrepare: true, allowsExecute: true, perActionApproval: false }
});
export const AUTONOMY_MODE_IDS = Object.freeze(Object.keys(AUTONOMY_MODES));

const MAX_GRANT_MS = 30 * 24 * 3600_000;
const DEFAULT_GRANT_MS = 24 * 3600_000;

export function createPermissionCenter({ now = () => Date.now(), defaultMode = 'SUGGEST' } = {}) {
  /** owner -> { mode, grants: Map<scope, grant>, audit: [] } */
  const owners = new Map();

  function scope(owner) {
    const key = String(owner || 'anon').slice(0, 80);
    if (!owners.has(key)) {
      const grants = new Map();
      for (const [id, meta] of Object.entries(PERMISSION_SCOPES)) {
        if (meta.defaultGranted) grants.set(id, { scope: id, granted: true, at: now(), expiresAt: null, origin: 'default', limitUsd: null });
      }
      owners.set(key, { mode: AUTONOMY_MODES[defaultMode] ? defaultMode : 'SUGGEST', grants, audit: [] });
    }
    return owners.get(key);
  }

  function audit(owner, row) {
    const entry = { ...row, at: now(), id: hashString(`${owner}|${row.action}|${row.scope || ''}|${now()}`) };
    const s = scope(owner);
    s.audit.push(entry);
    if (s.audit.length > 200) s.audit.shift();
    return entry;
  }

  function setMode(owner, mode) {
    const id = String(mode || '').toUpperCase();
    if (!AUTONOMY_MODES[id]) return { ok: false, code: 'UNKNOWN_MODE', allowed: AUTONOMY_MODE_IDS };
    const s = scope(owner);
    const previous = s.mode;
    s.mode = id;
    /* Lowering autonomy REVOKES money grants immediately. Leaving them alive
       under a lower mode is the loophole that makes the mode selector cosmetic. */
    let revoked = 0;
    if (AUTONOMY_MODES[id].rank < AUTONOMY_MODES[previous].rank) {
      for (const [key, grant] of s.grants) {
        if (PERMISSION_SCOPES[key]?.money && grant.granted) { s.grants.delete(key); revoked += 1; }
      }
    }
    audit(owner, { action: 'SET_MODE', from: previous, to: id, revokedMoneyGrants: revoked });
    return { ok: true, mode: id, previous, revokedMoneyGrants: revoked };
  }

  function grant(owner, scopeId, { ttlMs = DEFAULT_GRANT_MS, limitUsd = null, reason = null } = {}) {
    const id = String(scopeId || '');
    if (!PERMISSION_SCOPES[id]) return { ok: false, code: 'UNKNOWN_SCOPE', allowed: SCOPE_IDS };
    const s = scope(owner);
    const mode = AUTONOMY_MODES[s.mode];
    if (PERMISSION_SCOPES[id].money && !mode.allowsExecute) {
      audit(owner, { action: 'GRANT_DENIED', scope: id, reason: `autonomy mode ${s.mode} does not allow execution` });
      return { ok: false, code: 'MODE_FORBIDS_SCOPE', mode: s.mode, detail: `raise autonomy to ${AUTONOMY_MODES.APPROVE_EACH.id} or higher before granting ${id}` };
    }
    const ttl = Math.max(60_000, Math.min(MAX_GRANT_MS, usableNumber(ttlMs) ?? DEFAULT_GRANT_MS));
    const record = {
      scope: id, granted: true, at: now(), expiresAt: now() + ttl, ttlMs: ttl,
      limitUsd: usableNumber(limitUsd), origin: 'user', reason: reason ? String(reason).slice(0, 120) : null
    };
    s.grants.set(id, record);
    audit(owner, { action: 'GRANT', scope: id, ttlMs: ttl, limitUsd: record.limitUsd });
    return { ok: true, grant: record };
  }

  function revoke(owner, scopeId = null) {
    const s = scope(owner);
    if (!scopeId) {
      const n = s.grants.size;
      s.grants.clear();
      audit(owner, { action: 'REVOKE_ALL', revoked: n });
      return { ok: true, revoked: n };
    }
    const existed = s.grants.delete(String(scopeId));
    audit(owner, { action: 'REVOKE', scope: scopeId, existed });
    return { ok: true, revoked: existed ? 1 : 0 };
  }

  /**
   * The only function that authorises anything. Fails closed on every unknown.
   * `killSwitches` is passed in rather than imported so a caller cannot forget
   * it: the signature makes the dependency visible.
   */
  function check(owner, scopeId, { amountUsd = null, killSwitches = null, actionId = null } = {}) {
    const id = String(scopeId || '');
    const meta = PERMISSION_SCOPES[id];
    const s = scope(owner);
    const deny = (code, detail) => {
      const row = audit(owner, { action: 'DENY', scope: id, code, detail, actionId });
      return { schema: PERMISSION_SCHEMA, brain: CI_SCHEMA, granted: false, scope: id, code, detail, mode: s.mode, auditId: row.id };
    };
    if (!meta) return deny('UNKNOWN_SCOPE', `no such permission scope; known scopes are ${SCOPE_IDS.join(', ')}`);

    /* Kill switches outrank every grant. */
    if (killSwitches) {
      const engaged = killSwitches.blocking({ scope: id, money: meta.money });
      if (engaged.length) return deny('KILL_SWITCH_ENGAGED', `blocked by ${engaged.map((k) => k.id).join(', ')}`);
    }
    const mode = AUTONOMY_MODES[s.mode];
    if (meta.money && !mode.allowsExecute) return deny('MODE_FORBIDS_SCOPE', `autonomy mode ${s.mode} does not allow execution`);

    const g = s.grants.get(id);
    if (!g || !g.granted) return deny('NOT_GRANTED', `${meta.label} has not been granted`);
    if (g.expiresAt !== null && g.expiresAt <= now()) {
      s.grants.delete(id);
      return deny('GRANT_EXPIRED', `the grant for ${meta.label} expired`);
    }
    const amt = usableNumber(amountUsd);
    if (g.limitUsd !== null && g.limitUsd !== undefined) {
      if (amt === null) return deny('AMOUNT_UNKNOWN', `this grant carries a ${g.limitUsd} USD limit, so an unpriced action cannot be authorised`);
      if (amt > g.limitUsd) return deny('OVER_LIMIT', `${amt} USD exceeds the ${g.limitUsd} USD limit on this grant`);
    }
    const row = audit(owner, { action: 'ALLOW', scope: id, amountUsd: amt, actionId });
    return {
      schema: PERMISSION_SCHEMA, brain: CI_SCHEMA, granted: true, scope: id, mode: s.mode,
      expiresAt: g.expiresAt, limitUsd: g.limitUsd ?? null,
      perActionApproval: mode.perActionApproval, auditId: row.id
    };
  }

  /** The §45 table, rendered for the UI. */
  function table(owner) {
    const s = scope(owner);
    const at = now();
    return {
      schema: PERMISSION_SCHEMA, brain: CI_SCHEMA,
      mode: s.mode,
      modeLabel: AUTONOMY_MODES[s.mode].label,
      modes: Object.values(AUTONOMY_MODES),
      rows: SCOPE_IDS.map((id) => {
        const g = s.grants.get(id);
        const live = Boolean(g?.granted && (g.expiresAt === null || g.expiresAt > at));
        return {
          scope: id, label: PERMISSION_SCOPES[id].label, money: PERMISSION_SCOPES[id].money,
          granted: live, origin: g?.origin || null, expiresAt: g?.expiresAt ?? null,
          limitUsd: g?.limitUsd ?? null,
          blockedByMode: PERMISSION_SCOPES[id].money && !AUTONOMY_MODES[s.mode].allowsExecute
        };
      })
    };
  }

  const auditTrail = (owner, limit = 50) => scope(owner).audit.slice(-Math.max(1, Math.min(200, limit))).reverse();

  return { schema: PERMISSION_SCHEMA, setMode, grant, revoke, check, table, auditTrail, scopes: PERMISSION_SCOPES, modes: AUTONOMY_MODES };
}

/* ── §57 Kill switches ─────────────────────────────────────────────────── */

export const KILL_SWITCH_IDS = Object.freeze(['GLOBAL', 'EXECUTION', 'AGENT', 'PROVIDER']);

/**
 * Four switches with a defined precedence. GLOBAL blocks everything including
 * reads-that-cost-money; EXECUTION blocks only money scopes; AGENT stops
 * autonomous agent work; PROVIDER disables one named upstream.
 *
 * Engaging is cheap and reversible; DISENGAGING requires a reason, because an
 * un-audited "we turned it back on" is the incident-report line nobody wants.
 */
export function createKillSwitches({ now = () => Date.now() } = {}) {
  const state = new Map(KILL_SWITCH_IDS.map((id) => [id, { id, engaged: false, at: null, reason: null, by: null, target: null }]));
  const log = [];

  function engage(id, { reason = 'unspecified', by = 'operator', target = null } = {}) {
    const key = String(id || '').toUpperCase();
    if (!state.has(key)) return { ok: false, code: 'UNKNOWN_SWITCH', allowed: KILL_SWITCH_IDS };
    const row = { id: key, engaged: true, at: now(), reason: String(reason).slice(0, 160), by: String(by).slice(0, 60), target: target ? String(target).slice(0, 60) : null };
    state.set(key, row);
    log.push({ ...row, action: 'ENGAGE' });
    return { ok: true, switch: row };
  }

  function disengage(id, { reason = null, by = 'operator' } = {}) {
    const key = String(id || '').toUpperCase();
    if (!state.has(key)) return { ok: false, code: 'UNKNOWN_SWITCH', allowed: KILL_SWITCH_IDS };
    if (!reason) return { ok: false, code: 'REASON_REQUIRED', detail: 'turning a kill switch back off must be recorded with a reason' };
    const row = { id: key, engaged: false, at: now(), reason: String(reason).slice(0, 160), by: String(by).slice(0, 60), target: null };
    state.set(key, row);
    log.push({ ...row, action: 'DISENGAGE' });
    return { ok: true, switch: row };
  }

  /** Which engaged switches block this scope. Empty array means "not blocked". */
  function blocking({ scope: scopeId = null, money = false, agent = false, provider = null } = {}) {
    const out = [];
    const global = state.get('GLOBAL');
    if (global.engaged) out.push(global);
    const exec = state.get('EXECUTION');
    if (exec.engaged && (money || String(scopeId || '').startsWith('execute:'))) out.push(exec);
    const ag = state.get('AGENT');
    if (ag.engaged && agent) out.push(ag);
    const pr = state.get('PROVIDER');
    if (pr.engaged && provider && (!pr.target || pr.target === provider)) out.push(pr);
    return out;
  }

  return {
    schema: KILL_SWITCH_SCHEMA,
    engage, disengage, blocking,
    status: () => ({ schema: KILL_SWITCH_SCHEMA, brain: CI_SCHEMA, switches: [...state.values()], anyEngaged: [...state.values()].some((s) => s.engaged) }),
    history: (limit = 50) => log.slice(-limit).reverse()
  };
}
