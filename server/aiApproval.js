/**
 * FBT AI — CONTENT-BOUND APPROVALS (server side)
 * ---------------------------------------------------------------------------
 * Gordon's rule, applied to a non-custodial app: an approval is an HMAC over
 * the exact material legs of a plan + the owner + an expiry. It is issued
 * when a plan reaches PLAN_READY (/confirm, /execute) and verified:
 *
 *   · in the browser, right before the wallet is asked to sign
 *     (src/lib/intent-ai/planDigest.js → verifyPlanBinding)
 *   · on the server, by POST /api/v1/ai/approval/verify, for any caller
 *     that wants a second opinion (agents, the MCP bridge, support tooling)
 *
 * What it prevents: the plan that reaches the wallet silently differing from
 * the plan the user reviewed — a re-quote that changed the amount, a stale
 * card, an edited leg, a different owner replaying someone else's approval.
 *
 * What it does NOT do: it does not authorise anything. The wallet signature
 * is still the only thing that moves funds; this only makes sure the thing
 * being signed is the thing that was approved.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { planDigest, PLAN_DIGEST_SCHEMA } from '../src/lib/intent-ai/planDigest.js';

export const APPROVAL_SCHEMA = 'fbt.ai-approval.v1';
/** Long enough to sign a multi-leg plan; short enough that a stale card dies. */
export const APPROVAL_TTL_MS = Math.min(
  30 * 60_000,
  Math.max(60_000, Number(process.env.AI_APPROVAL_TTL_MS) || 10 * 60_000)
);

/* A per-process random secret when nothing is configured: approvals still
   bind content within one instance, they just don't survive a cold start.
   `durable` says which mode we are in — reported, never assumed. */
const EPHEMERAL = randomBytes(32).toString('hex');
function secret() {
  return process.env.AI_APPROVAL_SECRET || process.env.CRON_SECRET || EPHEMERAL;
}
export const approvalDurable = () => Boolean(process.env.AI_APPROVAL_SECRET || process.env.CRON_SECRET);

function mac({ owner, digest, intentId, issuedAt, expiresAt }) {
  return createHmac('sha256', secret())
    .update([APPROVAL_SCHEMA, String(owner || ''), digest, String(intentId || ''), issuedAt, expiresAt].join('|'))
    .digest('hex');
}

/** Issue an approval for `actions`, bound to `owner`. */
export function issueApproval({ owner, actions, intentId = null, now = Date.now(), ttlMs = APPROVAL_TTL_MS } = {}) {
  const legs = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
  if (!legs.length) return null;
  const digest = planDigest(legs);
  const issuedAt = now;
  const expiresAt = now + ttlMs;
  return {
    schema: APPROVAL_SCHEMA,
    digestSchema: PLAN_DIGEST_SCHEMA,
    digest,
    intentId: intentId ? String(intentId).slice(0, 64) : null,
    legs: legs.length,
    issuedAt,
    expiresAt,
    mac: mac({ owner, digest, intentId: intentId ? String(intentId).slice(0, 64) : null, issuedAt, expiresAt }),
    durable: approvalDurable(),
    authorizesExecution: false,
    note: 'Binds the reviewed plan to what the wallet is asked to sign. The wallet signature is still the only authorisation.'
  };
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Verify an approval against the legs about to be signed.
 * Codes: APPROVAL_MATCH · APPROVAL_MISSING · APPROVAL_FORGED ·
 *        APPROVAL_EXPIRED · APPROVAL_MISMATCH · APPROVAL_WRONG_OWNER
 */
export function verifyApproval({ owner, approval, actions, now = Date.now() } = {}) {
  if (!approval || typeof approval !== 'object' || !approval.digest || !approval.mac) {
    return { ok: false, code: 'APPROVAL_MISSING' };
  }
  const expected = mac({
    owner,
    digest: approval.digest,
    intentId: approval.intentId || null,
    issuedAt: approval.issuedAt,
    expiresAt: approval.expiresAt
  });
  if (!safeEqualHex(expected, approval.mac)) {
    /* Either the approval was tampered with, or it was issued to someone
       else. We cannot tell which without leaking the MAC — both refuse. */
    return { ok: false, code: 'APPROVAL_FORGED' };
  }
  if (Number(approval.expiresAt) < now) return { ok: false, code: 'APPROVAL_EXPIRED' };
  const digest = planDigest(actions);
  if (digest !== approval.digest) {
    return { ok: false, code: 'APPROVAL_MISMATCH', expected: approval.digest, actual: digest };
  }
  return { ok: true, code: 'APPROVAL_MATCH', digest, expiresAt: approval.expiresAt };
}
