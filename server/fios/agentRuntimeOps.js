/**
 * FBT FINANCIAL INTELLIGENCE OS — Agent Runtime Ops (Phase 212, upgrade 10).
 * ---------------------------------------------------------------------------
 * The external-agent runtime was «implemented / unavailable in runtime»: the
 * registry (agents.js) had identity, passports, trust tiers and reputation,
 * but no RUNTIME — nothing issued a session, checked a tool call, enforced a
 * rate limit or stood ready with a kill switch. This module is that runtime:
 *
 *   session key       issued per (owner, agent, scope); carries its own
 *                    expiration (hard ceiling 24h) and never survives revoke
 *   tool permissions  scoped per session from the agent's trust tier: a
 *                    TRUSTED agent may READ market/wallet context and VOTE in
 *                    the council; nobody but the USER's own wallet signs
 *   rate limits       per session (default 60 calls / 10 min) and per owner
 *                    (default 240 calls / 10 min) — fail-closed
 *   sandbox           every call runs against READ-ONLY copies; an agent
 *                    never receives secrets and never mutates state
 *   kill switch       owner-level + agent-level; a tripped switch refuses
 *                    every future call until the owner clears it
 *   audit trail       every open / call / refuse / expire / kill is a durable
 *                    row with the session key prefix — never the key itself
 *
 * THE LAW: a session NEVER grants execution. Tool scopes are read/prepare/vote;
 * the EXECUTE scope does not exist in this runtime by design.
 */

import { createHash, randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';

export const AGENT_RUNTIME_SCHEMA = 'fbt.fi.agent-runtime.v1';

export const TOOL_SCOPES = Object.freeze(['market.read', 'wallet.read', 'portfolio.read', 'news.read', 'macro.read', 'council.vote', 'research.prepare']);

/** What each trust tier may hold. UNTRUSTED and EXPIRED hold nothing. */
export const TIER_SCOPES = Object.freeze({
  HIGH_TRUST: TOOL_SCOPES,
  TRUSTED: ['market.read', 'wallet.read', 'portfolio.read', 'news.read', 'macro.read', 'council.vote', 'research.prepare'],
  LIMITED: ['market.read', 'news.read', 'macro.read'],
  UNTRUSTED: [],
  EXPIRED: []
});

const SESSION_TTL_MS = 24 * 3600_000;
const SESSION_RATE = { calls: 60, windowMs: 10 * 60_000 };
const OWNER_RATE = { calls: 240, windowMs: 10 * 60_000 };
const MAX_SESSIONS_PER_OWNER = 16;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const nowMs = () => Date.now();

function keyFingerprint(key) {
  return createHash('sha256').update(String(key || '')).digest('hex').slice(0, 12);
}

/**
 * The runtime. In-memory session table + durable audit rows (capped), one
 * instance per process — the same discipline the policy engine uses.
 */
export function createAgentRuntime({ collections = null, registry = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  const sessions = new Map(); // sessionId → session
  const killSwitch = { owner: new Set(), agent: new Set() };
  const rateWindow = { session: new Map(), owner: new Map() };

  async function audit(owner, row) {
    const entry = { schema: AGENT_RUNTIME_SCHEMA, at: now(), owner, ...row };
    if (collections) {
      try {
        await collections.put('agent_runtime_audit', owner, entry, { idKey: 'id' });
      } catch (err) {
        log(`agent-runtime:audit-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    return entry;
  }

  function overRate(bucket, map, { calls, windowMs }) {
    const at = now();
    const key = String(bucket);
    const row = map.get(key);
    if (!row || at - row.at >= windowMs) {
      map.set(key, { at, count: 1 });
      return false;
    }
    row.count += 1;
    return row.count > calls;
  }

  /**
   * Open a session for a registered agent. The registry's trust tier decides
   * the scopes; the owner may narrow them further but never widen them.
   */
  async function openSession(owner, { agentId = null, scopes = null, ttlMs = SESSION_TTL_MS, by = 'user' } = {}) {
    const gate = requireFlag('AGENT_RUNTIME_OPS_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    if (!agentId) return { ok: false, code: 'AGENT_ID_REQUIRED' };
    if (killSwitch.owner.has(owner) || killSwitch.agent.has(String(agentId))) {
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'open.refused', agentId, reason: 'KILL_SWITCH_ACTIVE' });
      return { ok: false, code: 'KILL_SWITCH_ACTIVE', detail: 'the kill switch is tripped; only the owner can clear it' };
    }
    /* The tier comes from the registry when wired; a caller-supplied tier is
       only accepted for a registry-less (test) runtime and is capped. */
    let tier = null;
    if (registry?.get) {
      const got = await registry.get(owner, agentId).catch(() => ({ ok: false }));
      if (!got?.ok) return { ok: false, code: 'AGENT_NOT_REGISTERED', detail: 'only registered agents may hold sessions' };
      tier = got.row?.trust?.tier || got.row?.tier || 'UNTRUSTED';
    } else {
      tier = String(by === 'user' ? 'TRUSTED' : 'UNTRUSTED');
    }
    const allowed = TIER_SCOPES[tier] || [];
    const requested = Array.isArray(scopes) ? scopes.map((s) => String(s)) : allowed;
    const granted = requested.filter((s) => allowed.includes(s));
    const denied = requested.filter((s) => !allowed.includes(s));
    const open = [...sessions.values()].filter((s) => s.owner === owner);
    if (open.length >= MAX_SESSIONS_PER_OWNER) {
      return { ok: false, code: 'TOO_MANY_SESSIONS', detail: `${MAX_SESSIONS_PER_OWNER} sessions already open for this owner` };
    }
    const at = now();
    const session = {
      schema: AGENT_RUNTIME_SCHEMA,
      id: `ses_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      owner,
      agentId: String(agentId),
      tier,
      scopes: granted,
      openedAt: at,
      expiresAt: at + Math.max(60_000, Math.min(num(ttlMs) ?? SESSION_TTL_MS, SESSION_TTL_MS)),
      calls: 0,
      status: 'ACTIVE',
      isolation: 'read-only-sandbox',
      executionGranted: false
    };
    /* The session key exists once, here, and only in the caller's response —
       everything durable stores its fingerprint. */
    const key = `sk_${randomUUID().replace(/-/g, '')}`;
    session.keyFingerprint = keyFingerprint(key);
    sessions.set(session.id, session);
    await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'session.opened', agentId, sessionId: session.id, scopes: granted, tier });
    if (observability) observability.emit({ type: 'agent-runtime.session-opened', owner, payload: { agentId, tier, scopes: granted.length } });
    return { ok: true, session, key, denied: denied.length ? denied : null, expiresAt: session.expiresAt };
  }

  /** Verify a call: key, expiry, scope, rate limits, kill switch. */
  async function checkToolCall(owner, { key = null, scope = null, agentId = null } = {}) {
    const gate = requireFlag('AGENT_RUNTIME_OPS_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code };
    const fp = keyFingerprint(key);
    const session = [...sessions.values()].find((s) => s.owner === owner && s.keyFingerprint === fp);
    if (!session) {
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'call.refused', reason: 'SESSION_NOT_FOUND', keyFingerprint: fp, scope: scope || null });
      return { ok: false, code: 'SESSION_NOT_FOUND', detail: 'no session for this key' };
    }
    const at = now();
    /* The kill switch outranks everything, including a still-ACTIVE session —
       a tripped switch must refuse with ITS code, not SESSION_NOT_FOUND. */
    if (killSwitch.owner.has(owner) || killSwitch.agent.has(session.agentId)) {
      session.status = 'KILLED';
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'call.refused', sessionId: session.id, reason: 'KILL_SWITCH_ACTIVE', scope });
      return { ok: false, code: 'KILL_SWITCH_ACTIVE', detail: 'the kill switch is tripped; only the owner can clear it' };
    }
    if (session.status !== 'ACTIVE') {
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'call.refused', sessionId: session.id, reason: `SESSION_${session.status}`, scope });
      return { ok: false, code: session.status === 'EXPIRED' ? 'SESSION_EXPIRED' : `SESSION_${session.status}`, detail: `the session is ${String(session.status).toLowerCase()}` };
    }
    if (session.expiresAt <= at) {
      session.status = 'EXPIRED';
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'session.expired', sessionId: session.id, agentId: session.agentId });
      return { ok: false, code: 'SESSION_EXPIRED', detail: 'the session key expired; open a new one' };
    }
    if (agentId && String(agentId) !== session.agentId) {
      return { ok: false, code: 'SESSION_AGENT_MISMATCH', detail: 'a session key belongs to exactly one agent (isolation)' };
    }
    if (!TOOL_SCOPES.includes(scope)) {
      return { ok: false, code: 'UNKNOWN_SCOPE', allowed: TOOL_SCOPES };
    }
    if (!session.scopes.includes(scope)) {
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'call.refused', sessionId: session.id, reason: 'SCOPE_NOT_GRANTED', scope });
      return { ok: false, code: 'SCOPE_NOT_GRANTED', detail: `${scope} was not granted to this session (tier ${session.tier})`, granted: session.scopes };
    }
    if (overRate(session.id, rateWindow.session, SESSION_RATE)) {
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'call.refused', sessionId: session.id, reason: 'SESSION_RATE_LIMIT', scope });
      return { ok: false, code: 'SESSION_RATE_LIMIT', detail: `${SESSION_RATE.calls} calls / ${SESSION_RATE.windowMs / 60000} min per session` };
    }
    if (overRate(owner, rateWindow.owner, OWNER_RATE)) {
      await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'call.refused', sessionId: session.id, reason: 'OWNER_RATE_LIMIT', scope });
      return { ok: false, code: 'OWNER_RATE_LIMIT', detail: `${OWNER_RATE.calls} calls / ${OWNER_RATE.windowMs / 60000} min per owner` };
    }
    session.calls += 1;
    await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'call.allowed', sessionId: session.id, agentId: session.agentId, scope });
    return { ok: true, session: { id: session.id, agentId: session.agentId, tier: session.tier, scope, isolation: session.isolation }, executionGranted: false };
  }

  /** The kill switch: owner-level (all agents) or agent-level. */
  async function tripKillSwitch(owner, { agentId = null, reason = 'operator' } = {}) {
    if (agentId) killSwitch.agent.add(String(agentId));
    else killSwitch.owner.add(owner);
    let killed = 0;
    for (const s of sessions.values()) {
      if (s.owner === owner && (!agentId || s.agentId === String(agentId)) && s.status === 'ACTIVE') {
        s.status = 'KILLED';
        killed += 1;
      }
    }
    await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'kill-switch.tripped', agentId: agentId || null, reason, killedSessions: killed });
    if (observability) observability.emit({ type: 'agent-runtime.kill-switch', owner, payload: { agentId: agentId || 'ALL', killed } });
    return { ok: true, killed, scope: agentId ? 'agent' : 'owner' };
  }

  async function clearKillSwitch(owner, { agentId = null } = {}) {
    if (agentId) killSwitch.agent.delete(String(agentId));
    else {
      killSwitch.owner.delete(owner);
      killSwitch.agent.clear();
    }
    await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'kill-switch.cleared', agentId: agentId || null });
    return { ok: true };
  }

  async function revokeSession(owner, sessionId) {
    const s = sessions.get(String(sessionId));
    if (!s || s.owner !== owner) return { ok: false, code: 'SESSION_NOT_FOUND' };
    s.status = 'REVOKED';
    await audit(owner, { id: `ops_${randomUUID().replace(/-/g, '').slice(0, 16)}`, op: 'session.revoked', sessionId: s.id, agentId: s.agentId });
    return { ok: true };
  }

  function status(owner) {
    const rows = [...sessions.values()].filter((s) => s.owner === owner);
    return {
      ok: true,
      schema: AGENT_RUNTIME_SCHEMA,
      sessions: rows.map(({ keyFingerprint, ...rest }) => ({ ...rest, keyFingerprint })),
      active: rows.filter((s) => s.status === 'ACTIVE' && s.expiresAt > now()).length,
      killSwitch: { owner: killSwitch.owner.has(owner), agents: [...killSwitch.agent] },
      limits: { session: SESSION_RATE, owner: OWNER_RATE, ttlMs: SESSION_TTL_MS, maxSessions: MAX_SESSIONS_PER_OWNER },
      scopes: TOOL_SCOPES,
      executionGranted: false
    };
  }

  /* Expire stale sessions lazily on every status read. */
  function sweep() {
    const at = now();
    for (const [id, s] of sessions) {
      if (s.status === 'ACTIVE' && s.expiresAt <= at) s.status = 'EXPIRED';
      if (['EXPIRED', 'REVOKED', 'KILLED'].includes(s.status) && at - s.expiresAt > 24 * 3600_000) sessions.delete(id);
    }
  }

  return {
    schema: AGENT_RUNTIME_SCHEMA,
    openSession,
    checkToolCall,
    revokeSession,
    tripKillSwitch,
    clearKillSwitch,
    status: (owner) => { sweep(); return status(owner); },
    audit,
    TIER_SCOPES
  };
}
