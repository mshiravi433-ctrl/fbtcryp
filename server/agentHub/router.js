/**
 * FBT EXTERNAL AGENT HUB — HTTP surface (§12).
 * ---------------------------------------------------------------------------
 * Mounted at `/api/ai/agent-hub`, deliberately NOT at `/api/ai/agents` and not
 * at `/api/ai/external-agents`:
 *
 *   /api/ai/agents           → command-center roster (server/aiCommand.js)
 *   /api/ai/external-agents  → the FI trust registry (server/fios/router.js)
 *   /api/ai/agent-hub/**     → this feature
 *
 * Three surfaces, three meanings, one meaning each. A probe asserts all three
 * still answer on their own paths so a future mount cannot quietly steal one.
 *
 * IDENTITY: the Hub uses the SAME owner derivation as the rest of the AI surface
 * (`ci.ownerFor`: telegram → device header → IP). Sensitive operations — any
 * task creation, any connection action — additionally require a DEVICE-scoped
 * identity: an IP is a shared NAT, not a person, and the spec is explicit that
 * an address is not authentication for a task a provider may bill. A caller with
 * only an IP gets `STRONG_OWNER_REQUIRED`, not somebody else's history.
 *
 * ERRORS: one envelope, one code, an honest detail. Provider internals are never
 * echoed; they are stored, redacted, in the task's diagnostic field.
 */

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AGENT_HUB_SCHEMA, redactSecrets, userMessageFor } from './protocol.js';
import { parseWebhookPayload, verifyWebhook } from './webhooks.js';

const noStore = (res) => res.set('cache-control', 'no-store');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
};

export function createAgentHubRouter({ hub, ownerFor, env = process.env, log = () => {} } = {}) {
  const router = Router();

  const ownerOf = (req) => {
    const owner = ownerFor ? ownerFor(req) : `ip:${String(req?.ip || 'anon').slice(0, 48)}`;
    return String(owner || 'anon');
  };
  const isStrongOwner = (owner) => owner.startsWith('dev:') || owner.startsWith('tg:');

  const fail = (res, status, code, extra = {}) => {
    noStore(res);
    const { detail = null, ...rest } = extra || {};
    return res.status(status).json({
      ok: false,
      schema: AGENT_HUB_SCHEMA,
      code,
      detail: detail || userMessageFor(code, null),
      ...rest
    });
  };
  const ok = (res, body) => {
    noStore(res);
    return res.status(200).json({ ok: true, schema: AGENT_HUB_SCHEMA, ...body });
  };

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const detail = redactSecrets(error?.message || error, 160);
      log(`agenthub:route-failed:${detail}`);
      if (!res.headersSent) fail(res, 500, 'AGENT_HUB_ERROR');
    }
  };

  const opsAllowed = (req) => {
    const expected = String(env.AGENT_HUB_OPS_TOKEN || '').trim();
    if (expected.length < 16) return false;
    const provided = String(req.get('x-fbt-ops-token') || '').trim();
    return safeEqual(provided, expected);
  };

  /* ══════════════════════ discovery ══════════════════════ */

  router.get('/catalog', handle(async (req, res) => {
    const out = await hub.broker.catalog({ owner: ownerOf(req) });
    if (!out.ok) return fail(res, 400, out.code || 'CATALOG_UNAVAILABLE');
    return ok(res, {
      enabled: out.enabled,
      status: out.status,
      reason: out.reason || null,
      detail: out.detail || null,
      durable: out.durable,
      paidInvocationEnabled: false,
      agents: out.agents,
      providers: out.providers,
      /* How many agent cards this owner may add, and how many they have.
         `sources.durable` is the same fact as the top-level `durable`; it is
         repeated here so the add form can warn about a lost row without the
         caller having to join two fields. */
      sources: out.sources || null,
      registryErrors: out.registryErrors || [],
      at: out.at
    });
  }));

  router.get('/agents/:agentId', handle(async (req, res) => {
    const out = await hub.broker.getAgent({ owner: ownerOf(req), agentId: req.params.agentId });
    if (!out.ok) return fail(res, out.code === 'HUB_DISABLED' ? 503 : 404, out.code);
    return ok(res, { agent: out.agent, durable: hub.store.durable() });
  }));

  /* ══════════════════════ user-supplied sources ══════════════════════
     The user's own agent cards. Owner-scoped, capped, and verified by a real
     fetch before a row is written — the URL is checked by the network layer
     (HTTPS, no IP literal, no private host, no credentials, no query), never
     by a client-side rule. */

  const sourceStatus = (code) => (
    code === 'SOURCE_RATE_LIMITED' ? 429
      : code === 'SOURCE_LIMIT_REACHED' ? 409
        : code === 'SOURCE_CARD_UNREACHABLE' ? 422
          : code === 'SOURCE_NOT_FOUND' ? 404
            : code === 'HUB_DISABLED' ? 503
              : 400
  );

  router.get('/sources', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    if (!hub.broker.flags().enabled) return fail(res, 503, 'HUB_DISABLED');
    const out = await hub.userSources.list({ owner });
    return ok(res, { sources: out.sources, cap: hub.userSources.cap, durable: out.durable });
  }));

  router.post('/sources', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    if (!hub.broker.flags().enabled) return fail(res, 503, 'HUB_DISABLED');
    const body = req.body || {};
    const out = await hub.userSources.add({
      owner,
      cardUrl: body.cardUrl || body.url || '',
      label: body.label || body.name || ''
    });
    if (!out.ok) {
      return fail(res, sourceStatus(out.code), out.code, {
        providerStatus: out.httpStatus || null,
        /* The upstream reason is a machine code (PROVIDER_TIMEOUT, …), never
           provider prose: the user needs to know WHICH check failed. */
        reason: out.detail || null
      });
    }
    /* A new/updated card must not be served from a warm adapter cache. */
    hub.adapters._reset();
    return ok(res, { source: out.source, existing: out.existing === true, cap: hub.userSources.cap, durable: out.durable });
  }));

  router.delete('/sources/:sourceId', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const out = await hub.userSources.remove({ owner, sourceId: req.params.sourceId });
    if (!out.ok) return fail(res, sourceStatus(out.code), out.code);
    /* A key that outlives the source it belongs to is a secret nobody can
       revoke from the UI. Removing the source removes its key too. */
    await hub.sourceCredentials?.remove({ owner, sourceId: req.params.sourceId }).catch(() => null);
    hub.adapters._reset();
    return ok(res, { removedId: out.removedId, durable: out.durable });
  }));

  /* ── the user's own key for their own A2A agent ─────────────────────────
     This is the connection path that works without an OAuth provider record:
     the user pastes a key THEY hold, for an agent THEY added. Nothing is
     reviewed, nothing is bundled, and the key is sealed server-side. */

  const credentialStatus = (code) => (
    code === 'SOURCE_NOT_FOUND' ? 404
      : code === 'AGENT_HUB_SECRET_KEY_REQUIRED' ? 503
        : 400
  );

  router.post('/sources/:sourceId/credential', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    if (!hub.sourceCredentials) return fail(res, 503, 'CREDENTIAL_STORE_UNCONFIGURED');
    const body = req.body || {};
    const out = await hub.sourceCredentials.save({
      owner,
      sourceId: req.params.sourceId,
      headerName: body.headerName || 'authorization',
      scheme: body.scheme || 'bearer',
      secret: body.secret || body.key || ''
    });
    if (!out.ok) return fail(res, credentialStatus(out.code), out.code, { field: out.field || null });
    return ok(res, { connection: out.connection, capability: hub.sourceCredentials.capability() });
  }));

  router.delete('/sources/:sourceId/credential', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    if (!hub.sourceCredentials) return fail(res, 503, 'CREDENTIAL_STORE_UNCONFIGURED');
    const out = await hub.sourceCredentials.remove({ owner, sourceId: req.params.sourceId });
    if (!out.ok) return fail(res, credentialStatus(out.code), out.code);
    return ok(res, { connection: out.connection });
  }));

  /* ══════════════════════ connections ══════════════════════ */

  router.get('/connections', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const out = await hub.connections.list(owner);
    /* One list, two kinds of relationship: an OAuth account the user linked,
       and a key the user stored for an agent they added. The UI labels them
       differently; neither is a reviewed provider. */
    const keys = hub.sourceCredentials ? await hub.sourceCredentials.list({ owner }).catch(() => ({ credentials: [] })) : { credentials: [] };
    return ok(res, {
      connections: [...out.connections, ...(keys.credentials || [])],
      durable: out.durable,
      capability: {
        ...hub.connections.capability(),
        apiKey: hub.sourceCredentials ? hub.sourceCredentials.capability() : { supported: false }
      }
    });
  }));

  router.post('/providers/:providerId/connections/start', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    if (!hub.broker.flags().enabled) return fail(res, 503, 'HUB_DISABLED');
    const out = await hub.connections.start({ owner, providerId: req.params.providerId });
    if (!out.ok) {
      const status = out.code === 'PROVIDER_NOT_FOUND' ? 404 : 409;
      return fail(res, status, out.code);
    }
    return ok(res, { authorizationUrl: out.authorizationUrl, expiresAt: out.expiresAt });
  }));

  const completeConnection = handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const source = req.method === 'GET' ? req.query : (req.body || {});
    if (source.error) return fail(res, 400, 'OAUTH_PROVIDER_DENIED');
    if (typeof source.code !== 'string' || typeof source.state !== 'string') {
      return fail(res, 400, 'OAUTH_CALLBACK_INCOMPLETE');
    }
    const out = await hub.connections.complete({
      owner,
      providerId: req.params.providerId,
      code: source.code,
      state: source.state
    });
    if (!out.ok) return fail(res, out.code === 'PROVIDER_NOT_FOUND' ? 404 : 400, out.code);
    return ok(res, { connection: out.connection, durable: out.durable });
  });
  router.get('/providers/:providerId/connections/callback', completeConnection);
  router.post('/providers/:providerId/connections/callback', completeConnection);

  router.delete('/connections/:connectionId', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const out = await hub.connections.revoke({ owner, connectionId: req.params.connectionId });
    if (!out.ok) return fail(res, out.code === 'CONNECTION_NOT_FOUND' ? 404 : 400, out.code);
    return ok(res, { connection: out.connection, durable: out.durable });
  }));

  /* ══════════════════════ tasks ══════════════════════ */

  router.post('/agents/:agentId/tasks', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const idempotencyKey = req.get('idempotency-key') || (req.body || {}).idempotencyKey || null;
    const out = await hub.broker.createTask({ owner, agentId: req.params.agentId, body: req.body || {}, idempotencyKey });
    if (!out.ok) {
      const status = out.status || (out.code === 'HUB_DISABLED' ? 503 : out.code === 'AGENT_NOT_FOUND' ? 404 : 400);
      return fail(res, status, out.code, {
        requiresConnection: out.requiresConnection === true,
        paymentRequired: out.paymentRequired === true,
        paidInvocationEnabled: out.paidInvocationEnabled ?? false,
        providerStatus: out.providerStatus || null,
        field: out.field || null,
        retryAfterMs: out.retryAfterMs || null
      });
    }
    return ok(res, { task: out.task, replay: out.replay === true, durable: out.durable });
  }));

  router.get('/tasks', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const out = await hub.broker.listTasks({ owner, limit: Number(req.query.limit) || 30 });
    return ok(res, { tasks: out.tasks, durable: out.durable });
  }));

  router.get('/tasks/:taskId', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const out = await hub.broker.getTask({ owner, taskId: req.params.taskId, sync: req.query.sync !== '0' });
    if (!out.ok) return fail(res, out.code === 'TASK_NOT_FOUND' ? 404 : 400, out.code);
    return ok(res, { task: out.task, events: out.events, durable: out.durable });
  }));

  router.post('/tasks/:taskId/cancel', handle(async (req, res) => {
    const owner = ownerOf(req);
    if (!isStrongOwner(owner)) return fail(res, 401, 'STRONG_OWNER_REQUIRED');
    const out = await hub.broker.cancelTask({ owner, taskId: req.params.taskId });
    if (!out.ok) {
      return fail(res, out.status || 400, out.code, { task: out.task || null, providerStatus: null });
    }
    return ok(res, { canceled: out.canceled, task: out.task });
  }));

  /* ══════════════════════ webhooks (signed providers only) ══════════════════════ */

  router.post('/providers/:providerId/webhook', handle(async (req, res) => {
    const provider = hub.registry.get(req.params.providerId);
    /* An unknown provider gets the same answer as an unsigned one: the surface
       does not confirm which providers exist to an unauthenticated caller. */
    if (!provider || !provider.webhook) return fail(res, 404, 'WEBHOOK_NOT_CONFIGURED');

    const verified = await verifyWebhook({
      provider,
      rawBody: req.rawBody || (typeof req.body === 'string' ? req.body : ''),
      headers: req.headers,
      env
    });
    if (!verified.ok) {
      log(`agenthub:webhook-rejected:${provider.id}:${verified.code}`);
      /* A deployment problem (no secret, no replay protection) is a 503: the
         provider is not at fault and the event was NOT processed. A bad
         signature/timestamp is the caller's problem: 401. */
      const status = ['WEBHOOK_SECRET_UNCONFIGURED', 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE'].includes(verified.code) ? 503 : 401;
      return fail(res, status, verified.code);
    }

    const parsed = parseWebhookPayload(req.body && typeof req.body === 'object' ? req.body : {});
    if (!parsed.ok) return fail(res, 400, parsed.code);

    const out = await hub.broker.applyWebhook({
      providerId: provider.id,
      remoteTaskId: parsed.event.remoteTaskId,
      state: parsed.event.state,
      text: parsed.event.text,
      providerStatus: parsed.event.providerStatus,
      providerReportedCost: parsed.event.providerReportedCost
    });
    if (!out.ok) return fail(res, out.code === 'REMOTE_TASK_UNKNOWN' ? 202 : 400, out.code);
    return ok(res, { applied: out.applied !== false, task: out.task || null });
  }));

  /* ══════════════════════ operator surfaces ══════════════════════ */

  router.get('/provider-health', handle(async (req, res) => {
    if (!opsAllowed(req)) return fail(res, 404, 'NOT_FOUND');
    const out = await hub.broker.health({ force: req.query.refresh === '1' });
    return ok(res, out);
  }));

  router.post('/provider-health/kill', handle(async (req, res) => {
    if (!opsAllowed(req)) return fail(res, 404, 'NOT_FOUND');
    const { scope = 'global', providerId = null, tripped = true, reason = null } = req.body || {};
    const knownProvider = hub.registry.all().some((p) => p.id === providerId)
      || (hub.native?.enabled?.() && providerId === hub.native.provider.id);
    if (scope === 'provider' && !knownProvider) {
      return fail(res, 404, 'PROVIDER_NOT_FOUND');
    }
    const out = await hub.broker.setKill({ scope, providerId, tripped: tripped === true, reason, by: 'ops' });
    if (!out.ok) return fail(res, 400, out.code || 'KILL_SWITCH_FAILED');
    return ok(res, { killSwitch: out });
  }));

  return router;
}
