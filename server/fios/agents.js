/**
 * FBT FINANCIAL INTELLIGENCE OS — External Agents + Agent Trust (batch 6).
 * ---------------------------------------------------------------------------
 * External agents (third-party software that advises on this user's money)
 * are registered here, scored for trust, and — at most — invited to VOTE in
 * the council and the strategy competition, down-weighted and marked
 * untrusted. They never execute, never hold funds, and never hold a key:
 * the passport sanitizer refuses raw credentials at the door
 * (`RAW_CREDENTIAL_FORBIDDEN`), and every row this module produces carries
 * `canExecute: false` so no future caller can mistake a high score for
 * authority.
 *
 * TRUST IS MEASURED, NOT CLAIMED
 * `computeAgentTrustScore` is a pure function of four real inputs:
 *
 *   passport      sanitised through `sanitizeExternalAgentPassport` — a
 *                 listing can NEVER mark itself verified; only FBT's trusted
 *                 server registry can (`passportFromCatalog`)
 *   security      `evaluateExternalAgentSecurity` over that passport —
 *                 verified, unexpired, no raw credentials, no custody
 *   sandbox       the passport's own sandbox attestation (stages + evidence)
 *   reputation    this system's OWN recorded, VERIFIED interactions —
 *                 an agent cannot buy its reputation with unverified claims
 *
 * Score components (caps are part of the arithmetic, not the prose):
 *   base 40            registered with an accepted, sanitised passport
 *   +15 security       the security evaluation passed for this passport
 *   +10 sandbox        a complete production sandbox with operator approval
 *   +25 reputation     (success − 2·failure) / total over ≥ 3 verified
 *                      samples — below the sample floor it is 0, not a hope
 *   cap 95             "perfect trust" does not exist for software touching
 *                      money; the last 5 points are unreachable by design
 *   0 EXPIRED          an expired passport is a corpse, whatever it did well
 *
 * Tiers: EXPIRED 0 · UNTRUSTED <40 · LIMITED 40–69 · TRUSTED 70–89 ·
 * HIGH_TRUST 90–95. Authorization to vote requires ≥ 70 (TRUSTED).
 */
import { randomUUID } from 'node:crypto';
import {
  sanitizeExternalAgentPassport,
  passportFromCatalog,
  evaluateExternalAgentSecurity,
  EXTERNAL_AGENT_SANDBOX_STAGES
} from '../../src/lib/intent-ai/externalAgentTrust.js';

export const AGENT_REGISTRY_SCHEMA = 'fbt.fi.agent-registry.v1';

export const TRUST_TIERS = Object.freeze(['EXPIRED', 'UNTRUSTED', 'LIMITED', 'TRUSTED', 'HIGH_TRUST']);
export const TRUST_FLOOR_FOR_AUTHORIZATION = 70;
export const MIN_REPUTATION_SAMPLES = 3;
const MAX_REPUTATION_SAMPLES = 100;
const MAX_AGENTS_PER_OWNER = 24;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const idFor = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

/**
 * The pure trust arithmetic. Every input is a real artifact (passport,
 * security evaluation, recorded interactions) — there is no "reputation
 * input" this function cannot see, and the basis array names every point
 * the score is made of, so a probe (or the UI) can audit it.
 */
export function computeAgentTrustScore({ passport = null, security = null, interactions = null, now = Date.now() } = {}) {
  const basis = [];
  let score = 0;

  const expired = passport?.expiresAt != null && Number(passport.expiresAt) <= now;
  if (expired) {
    basis.push({ component: 'passport', points: 0, note: `passport expired ${new Date(Number(passport.expiresAt)).toISOString()}` });
    return { score: 0, tier: 'EXPIRED', basis, cap: 95 };
  }

  if (!passport) {
    basis.push({ component: 'passport', points: 0, note: 'no passport; an agent without an identity is scored zero' });
    return { score: 0, tier: 'UNTRUSTED', basis, cap: 95 };
  }

  score += 40;
  basis.push({ component: 'passport', points: 40, note: `registered, sanitised passport ${passport.id}` });

  const secOk = security?.ok === true;
  if (secOk) {
    score += 15;
    basis.push({ component: 'security', points: 15, note: 'security evaluation passed (verified, unexpired, no raw credentials, no custody)' });
  } else {
    const codes = (security?.failures || []).map((f) => f.code).slice(0, 4);
    basis.push({ component: 'security', points: 0, note: codes.length ? `security evaluation failed: ${codes.join(', ')}` : 'no security evaluation was run' });
  }

  const sandbox = passport?.sandbox;
  const sandboxComplete = sandbox?.productionReady === true && EXTERNAL_AGENT_SANDBOX_STAGES.every((s) => (sandbox?.completedStages || []).includes(s));
  if (sandboxComplete) {
    score += 10;
    basis.push({ component: 'sandbox', points: 10, note: 'complete production sandbox with operator approval and per-stage evidence' });
  } else {
    basis.push({ component: 'sandbox', points: 0, note: `sandbox stage "${sandbox?.stage || 'discovery'}", productionReady ${sandbox?.productionReady === true}` });
  }

  const samples = Array.isArray(interactions?.samples) ? interactions.samples : [];
  const success = interactions?.success ?? samples.filter((s) => s.ok).length;
  const failure = interactions?.failure ?? samples.filter((s) => !s.ok).length;
  const total = success + failure;
  if (total >= MIN_REPUTATION_SAMPLES) {
    const rep = Math.max(0, ((success - 2 * failure) / total) * 25);
    score += rep;
    basis.push({ component: 'reputation', points: Math.round(rep * 100) / 100, note: `${success} success / ${failure} failure over ${total} VERIFIED interactions` });
  } else {
    basis.push({ component: 'reputation', points: 0, note: `below the ${MIN_REPUTATION_SAMPLES}-verified-sample floor (${total} recorded); reputation is measured, not assumed` });
  }

  score = Math.min(95, score);
  /* A failed security evaluation is disqualifying for the tier, however many
     points the passport itself earned: unverified software that advises on
     money is UNTRUSTED, full stop. */
  const tier = !secOk ? 'UNTRUSTED'
    : score >= 90 ? 'HIGH_TRUST'
      : score >= TRUST_FLOOR_FOR_AUTHORIZATION ? 'TRUSTED'
        : score >= 40 ? 'LIMITED'
          : 'UNTRUSTED';
  return { score: Math.round(score * 100) / 100, tier, basis, cap: 95 };
}

export function createAgentRegistry({ collections, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function load(owner) {
    const { ok, rows, code } = await collections.read('agent_trust', owner);
    if (!ok) return { ok: false, code, rows: [] };
    return { ok: true, rows };
  }

  async function save(owner, row) {
    const res = await collections.put('agent_trust', owner, row, { idKey: 'id' });
    return { ok: res.ok, durable: res.durable ?? collections.durable(), code: res.code || null };
  }

  const withTrust = (row) => {
    row.trust = computeAgentTrustScore({ passport: row.passport, security: row.security, interactions: row.interactions, now: now() });
    row.expired = row.trust.tier === 'EXPIRED';
    return row;
  };

  /**
   * Register an agent from a USER-supplied description. The passport is
   * sanitised with trustedVerification: FALSE — a listing cannot mark itself
   * verified, so every user-registered agent starts unverified and earns its
   * way up through recorded, verified interactions only.
   */
  async function register(owner, input = {}) {
    const at = now();
    const name = String(input.name || '').trim().slice(0, 60);
    if (!name) return { ok: false, code: 'NAME_REQUIRED' };
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code };
    if (loaded.rows.length >= MAX_AGENTS_PER_OWNER) return { ok: false, code: 'TOO_MANY_AGENTS', max: MAX_AGENTS_PER_OWNER };
    if (loaded.rows.some((r) => r?.name === name)) return { ok: false, code: 'AGENT_ALREADY_REGISTERED', name };

    const sanitized = sanitizeExternalAgentPassport(
      { id: input.agentId || `ext-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`, ...input.passport, name },
      { trustedVerification: false, now: at, source: 'user-registered' }
    );
    if (!sanitized.ok) return { ok: false, code: sanitized.code, detail: 'the passport was refused by the sanitizer; raw credentials and self-verification are not accepted' };
    const passport = sanitized.passport;
    const security = evaluateExternalAgentSecurity(passport, { stage: 'analysis', now: at });

    const row = {
      schema: AGENT_REGISTRY_SCHEMA,
      id: idFor('agt'),
      owner: null,
      name,
      provider: String(input.provider || 'unknown').slice(0, 60),
      capabilities: Array.isArray(input.capabilities) ? input.capabilities.map((c) => String(c).toLowerCase().slice(0, 32)).slice(0, 16) : (passport.capabilities || []),
      passport,
      security: { ok: security.ok, failures: security.failures.map((f) => f.code), stage: 'analysis' },
      interactions: { success: 0, failure: 0, samples: [] },
      authorizedScopes: [],
      revoked: false,
      createdAt: at,
      updatedAt: at,
      canExecute: false
    };
    withTrust(row);
    const res = await save(owner, row);
    if (!res.ok) return { ok: false, code: res.code };
    if (observability) observability.emit({ type: 'learning.completed', owner, payload: { agent: row.id, action: 'registered', trust: row.trust.score, tier: row.trust.tier } });
    return { ok: true, agent: publicRow(row), durable: res.durable };
  }

  /**
   * The TRUSTED path: a row derived by FBT's own server registry gets a
   * passport that may carry a real verification. This is the only way an
   * agent starts verified — and it is the server, not the client, that calls
   * this function.
   */
  async function registerFromCatalog(owner, row = {}, { source = 'server-catalog' } = {}) {
    const at = now();
    const sanitized = passportFromCatalog(row, { now: at, source });
    if (!sanitized.ok) return { ok: false, code: sanitized.code };
    const passport = sanitized.passport;
    const security = evaluateExternalAgentSecurity(passport, { stage: 'analysis', now: at });
    const agent = {
      schema: AGENT_REGISTRY_SCHEMA,
      id: idFor('agt'),
      owner: null,
      name: String(row.name || passport.id).slice(0, 60),
      provider: 'fbt-catalog',
      capabilities: passport.capabilities || [],
      passport,
      security: { ok: security.ok, failures: security.failures.map((f) => f.code), stage: 'analysis' },
      interactions: { success: 0, failure: 0, samples: [] },
      authorizedScopes: [],
      revoked: false,
      createdAt: at,
      updatedAt: at,
      canExecute: false
    };
    withTrust(agent);
    const res = await save(owner, agent);
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true, agent: publicRow(agent), durable: res.durable, verified: security.ok };
  }

  /**
   * Record one interaction with an agent. Only VERIFIED interactions count —
   * a claimed fill that the chain did not confirm builds no reputation in
   * either direction. This is the same verified-only rule memory.js applies
   * to outcome learning; reputation is learned the same way.
   */
  async function recordInteraction(owner, agentId, { ok, verified, detail = null } = {}) {
    const at = now();
    const found = await get(owner, agentId);
    if (!found.ok) return { ok: false, code: found.code };
    const agent = found.record;
    if (agent.revoked) return { ok: false, code: 'AGENT_REVOKED' };
    if (verified !== true) {
      return { ok: true, counted: false, reason: 'UNVERIFIED_INTERACTIONS_BUILD_NO_REPUTATION', agentId: String(agentId), trust: agent.trust };
    }
    const samples = [...(agent.interactions?.samples || []), { ok: ok === true, at, detail: String(detail || '').slice(0, 120) }].slice(-MAX_REPUTATION_SAMPLES);
    agent.interactions = {
      success: samples.filter((s) => s.ok).length,
      failure: samples.filter((s) => !s.ok).length,
      samples
    };
    agent.updatedAt = at;
    withTrust(agent);
    const res = await save(owner, agent);
    if (!res.ok) return { ok: false, code: res.code };
    if (observability) observability.emit({ type: 'learning.completed', owner, payload: { agent: agent.id, action: ok ? 'success' : 'failure', verified: true, trust: agent.trust.score, tier: agent.trust.tier } });
    return { ok: true, counted: true, agentId: agent.id, trust: agent.trust, durable: res.durable };
  }

  /**
   * Authorize a scope (e.g. 'council-vote', 'strategy-proposal') for an
   * agent. Requires the TRUSTED floor — a score is a measurement, and the
   * floor is the line between "measured enough" and "not yet".
   */
  async function authorize(owner, agentId, { scope = 'council-vote', by = 'user' } = {}) {
    const at = now();
    const found = await get(owner, agentId);
    if (!found.ok) return { ok: false, code: found.code };
    const agent = found.record;
    if (agent.revoked) return { ok: false, code: 'AGENT_REVOKED' };
    const cleanScope = String(scope).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
    if (!['council-vote', 'strategy-proposal'].includes(cleanScope)) {
      return { ok: false, code: 'UNKNOWN_SCOPE', allowed: ['council-vote', 'strategy-proposal'], detail: 'agents can advise; there is no execution scope to grant' };
    }
    if (agent.trust.tier === 'EXPIRED' || agent.trust.score < TRUST_FLOOR_FOR_AUTHORIZATION) {
      return {
        ok: false,
        code: 'AUTHORIZATION_REFUSED',
        score: agent.trust.score,
        required: TRUST_FLOOR_FOR_AUTHORIZATION,
        tier: agent.trust.tier,
        detail: `trust ${agent.trust.score} is below the ${TRUST_FLOOR_FOR_AUTHORIZATION} floor (basis: ${agent.trust.basis.map((b) => b.component).join(', ')})`
      };
    }
    if (!agent.authorizedScopes.includes(cleanScope)) agent.authorizedScopes.push(cleanScope);
    agent.updatedAt = at;
    agent.authorizations = [{ scope: cleanScope, at, by: String(by).slice(0, 40) }, ...(agent.authorizations || [])].slice(0, 20);
    const res = await save(owner, agent);
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true, agent: publicRow(agent), durable: res.durable };
  }

  async function revoke(owner, agentId, { reason = null } = {}) {
    const found = await get(owner, agentId);
    if (!found.ok) return { ok: false, code: found.code };
    const agent = found.record;
    const at = now();
    agent.revoked = true;
    agent.authorizedScopes = [];
    agent.revokeReason = String(reason || 'revoked by the owner').slice(0, 160);
    agent.updatedAt = at;
    const res = await save(owner, agent);
    if (!res.ok) return { ok: false, code: res.code };
    if (observability) observability.emit({ type: 'learning.completed', owner, payload: { agent: agent.id, action: 'revoked', trust: agent.trust.score } });
    return { ok: true, agent: publicRow(agent), durable: res.durable };
  }

  async function get(owner, id) {
    const { ok, code, rows } = await load(owner);
    if (!ok) return { ok: false, code, record: null };
    const row = rows.find((r) => r?.id === String(id)) || null;
    if (!row) return { ok: false, code: 'AGENT_NOT_FOUND', id: String(id), record: null };
    const record = withTrust({ ...row, interactions: { ...row.interactions } });
    return { ok: true, record, durable: collections.durable() };
  }

  async function list(owner) {
    const { ok, code, rows } = await load(owner);
    if (!ok) return { ok: false, code, agents: [] };
    return { ok: true, agents: rows.map((r) => publicRow(withTrust({ ...r, interactions: { ...r.interactions } }))), count: rows.length, durable: collections.durable() };
  }

  /** The exact shape the competition engine expects for an external vote. */
  async function forCompetition(owner, agentId) {
    const found = await get(owner, agentId);
    if (!found.ok) return { ok: false, code: found.code, externalAgent: null };
    const agent = found.record;
    return {
      ok: true,
      externalAgent: {
        authorized: !agent.revoked && agent.authorizedScopes.includes('council-vote'),
        trust: { score: agent.trust.score, expired: agent.expired },
        passport: { id: agent.passport?.id || agent.id }
      },
      agentId: agent.id,
      untrustedText: true
    };
  }

  return {
    schema: AGENT_REGISTRY_SCHEMA,
    TIERS: TRUST_TIERS,
    TRUST_FLOOR_FOR_AUTHORIZATION,
    computeTrust: computeAgentTrustScore,
    register, registerFromCatalog, recordInteraction, authorize, revoke, get, list, forCompetition
  };
}

/** The API view: name, trust, basis, scopes — never the raw passport claims
 *  a client could re-interpret, and always canExecute: false. */
function publicRow(row) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    capabilities: row.capabilities,
    passport: {
      id: row.passport?.id || null,
      verified: row.passport?.securityStatus === 'verified',
      independentlyVerified: row.passport?.verification?.independentlyVerified === true,
      expiresAt: row.passport?.expiresAt ?? null,
      capabilities: row.passport?.capabilities || []
    },
    security: row.security,
    trust: row.trust,
    expired: row.expired,
    revoked: row.revoked,
    interactions: { success: row.interactions?.success || 0, failure: row.interactions?.failure || 0 },
    authorizedScopes: row.authorizedScopes || [],
    canExecute: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
