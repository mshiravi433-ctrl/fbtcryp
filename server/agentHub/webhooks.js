/**
 * FBT EXTERNAL AGENT HUB — signed webhooks (§12, §16).
 * ---------------------------------------------------------------------------
 * A webhook is an UNAUTHENTICATED request from the internet until the HMAC
 * proves otherwise, so nothing about it is trusted before then:
 *
 *   · The signature is checked over `timestamp + "." + rawBody`. Raw, not
 *     re-serialized: `JSON.stringify(JSON.parse(x))` is not the bytes the
 *     provider signed, and accepting it would let a whitespace change pass.
 *   · Timestamps outside a ±5 minute window are refused (a captured request
 *     must not be replayable tomorrow).
 *   · The signature is single-use: the digest is claimed with `SET NX` in the
 *     same Redis instance the money paths use. Without that atomic primitive the
 *     webhook is REFUSED rather than processed without replay protection —
 *     "best effort" is not a property an event that can mark a task completed
 *     is allowed to have.
 *   · Only providers that declare a `webhook.secretEnv` in the reviewed
 *     registry can reach this code path at all.
 *
 * The payload is parsed into a narrow shape and then handed to the broker, which
 * owns the task-row update. This module never writes a row itself.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { upstashConfigured, upstashSetIfAbsent } from '../blobCache.js';
import { normalizeResult, sanitizeProviderText, stateFromA2A } from './protocol.js';

export const WEBHOOK_SCHEMA = 'fbt.agent-hub.webhook.v1';
export const MAX_SKEW_MS = 5 * 60_000;
const MAX_BODY = 200_000;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
};

/** Constant-time secret lookup; a missing secret is a refusal, never a skip. */
export function webhookSecret(provider, env = process.env) {
  const name = provider?.webhook?.secretEnv;
  if (!name) return null;
  const value = String(env[name] || '').trim();
  return value.length >= 24 ? value : null;
}

/**
 * @returns {{ok:true, replayKey:string, timestamp:number}} | {{ok:false, code:string}}
 */
export async function verifyWebhook({ provider, rawBody, headers = {}, env = process.env, now = () => Date.now() }) {
  if (!provider?.webhook) return { ok: false, code: 'WEBHOOK_NOT_CONFIGURED' };
  const secret = webhookSecret(provider, env);
  if (!secret) return { ok: false, code: 'WEBHOOK_SECRET_UNCONFIGURED' };

  const body = typeof rawBody === 'string' ? rawBody : '';
  if (!body || body.length > MAX_BODY) return { ok: false, code: 'WEBHOOK_BODY_INVALID' };

  const header = (name) => {
    const value = headers?.[String(name).toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  const signatureHeader = header(provider.webhook.signatureHeader || 'x-fbt-signature');
  const timestampHeader = header(provider.webhook.timestampHeader || 'x-fbt-timestamp');
  if (!signatureHeader || !timestampHeader) return { ok: false, code: 'WEBHOOK_SIGNATURE_MISSING' };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return { ok: false, code: 'WEBHOOK_TIMESTAMP_INVALID' };
  const at = now();
  const timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
  if (Math.abs(at - timestampMs) > MAX_SKEW_MS) return { ok: false, code: 'WEBHOOK_TIMESTAMP_STALE' };

  const provided = String(signatureHeader).replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return { ok: false, code: 'WEBHOOK_SIGNATURE_INVALID' };

  /* The signed payload is the exact timestamp header value plus the exact bytes
     the provider sent. */
  const expected = createHmac('sha256', secret).update(`${timestampHeader}.`).update(body).digest('hex');
  if (!safeEqual(provided, expected)) return { ok: false, code: 'WEBHOOK_SIGNATURE_INVALID' };

  /* Signature is valid from here on. What remains is whether this event can be
     processed EXACTLY ONCE — and without the atomic primitive it cannot, so the
     answer is a refusal, not a best-effort apply. */
  if (!upstashConfigured()) return { ok: false, code: 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE' };

  const replayKey = `agent-hub:webhook:v1:${provider.id}:${createHash('sha256').update(provided).digest('hex').slice(0, 40)}`;
  const firstUse = await upstashSetIfAbsent(replayKey, { at }, MAX_SKEW_MS * 4);
  if (!firstUse) return { ok: false, code: 'WEBHOOK_REPLAYED' };

  return { ok: true, replayKey, timestamp: timestampMs };
}

/**
 * Provider payload → the narrow event the broker applies.
 *
 * Accepts the A2A push-notification shape (a Task) and the flat shape some
 * providers use. Everything else is `WEBHOOK_PAYLOAD_INVALID` — a webhook that
 * cannot be understood must not be able to guess a state.
 */
export function parseWebhookPayload(body = {}) {
  if (!body || typeof body !== 'object') return { ok: false, code: 'WEBHOOK_PAYLOAD_INVALID' };

  const task = body.task && typeof body.task === 'object' ? body.task : body;
  const remoteTaskId = sanitizeProviderText(task.id || task.taskId || body.taskId || body.remoteTaskId || '', 200).trim();
  if (!remoteTaskId) return { ok: false, code: 'WEBHOOK_TASK_ID_REQUIRED' };

  const rawState = task?.status?.state || body.state || body.status?.state || null;
  if (!rawState) return { ok: false, code: 'WEBHOOK_STATE_REQUIRED' };
  const state = stateFromA2A(rawState);

  const partsText = [];
  for (const artifact of Array.isArray(task.artifacts) ? task.artifacts : []) {
    for (const part of Array.isArray(artifact?.parts) ? artifact.parts : []) {
      if (part?.kind === 'text' && typeof part.text === 'string') partsText.push(part.text);
    }
  }
  const statusText = (Array.isArray(task?.status?.message?.parts) ? task.status.message.parts : [])
    .map((p) => (p?.kind === 'text' ? p.text : '')).filter(Boolean).join('\n');
  const text = [...partsText, statusText].filter(Boolean).join('\n\n').slice(0, 20000) || null;

  const cost = body.providerReportedCost || body.cost || null;
  const providerReportedCost = cost && typeof cost === 'object' ? {
    amount: Number(cost.amount) || null,
    asset: sanitizeProviderText(cost.asset, 20) || null,
    network: sanitizeProviderText(cost.network, 40) || null,
    source: 'webhook'
  } : null;

  return {
    ok: true,
    event: {
      remoteTaskId,
      state,
      providerStatus: sanitizeProviderText(rawState, 40) || null,
      text,
      providerReportedCost,
      normalized: text ? normalizeResult({ text, providerRef: remoteTaskId }) : null
    }
  };
}
