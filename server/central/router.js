/**
 * FBT CENTRAL INTELLIGENCE OS — Central API (§36, §37).
 * ---------------------------------------------------------------------------
 * The frontend talks to ONE gateway:
 *
 *   POST /api/intent                    new user intent (chat or command)
 *   GET  /api/intent/:id                full intent record (state machine,
 *                                       plan, tool results, trace)
 *   POST /api/intent/:id/confirm        explicit confirmation (§33 EXECUTE)
 *   POST /api/intent/:id/cancel         cancel a pending intent
 *
 *   GET  /api/system/state              unified system state (§4)
 *   GET  /api/system/health             module health map
 *   GET  /api/system/capabilities       capability map (§8)
 *   GET  /api/system/events             recent event ring buffer (§15)
 *
 *   POST /api/tools/read | quote | prepare | simulate | execute | verify
 *                                       direct tool router access (§9)
 *
 *   GET  /api/transactions/:id          transaction lookup + verification
 *
 * Session scoping uses the same device header as the rest of the AI surface
 * (`x-fbt-device`), so one device = one brain session.
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { handleIntent, getIntent, confirmIntent, cancelIntent, listIntents } from './pipeline.js';
import { assembleState, ingestClientData, getSession } from './stateStore.js';
import { capabilityReport, capabilityOf } from './capabilities.js';
import { runTool } from './toolRouter.js';
import { getModule, listModules, moduleCoverage, featureCompleteness } from './registry.js';
import { recentEvents, eventStats } from './eventBus.js';
import { getAction, listActions, actionSummary } from './actionEngine.js';
import { getMemory } from './contextEngine.js';
import { CENTRAL_OS_VERSION } from './constants.js';
import { getUpgrade8State, patchUpgrade8State, startUpgrade8Intent, askUpgrade8Question, createUpgrade8Simulation } from './upgrade8Store.js';

export const centralRouter = Router();

const DEVICE_HEADER = 'x-fbt-device';
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
/* SAME salt as the V1 AI OS owner derivation: one device must map to one
   owner across both surfaces, otherwise the two brains see two users. */
const SALT = process.env.FINANCIAL_GOALS_SALT || process.env.CRON_SECRET || 'fbt-ai-intent-os';

function ownerFor(req) {
  if (req?.tgUser?.id) return `tg:${req.tgUser.id}`;
  const device = String(req?.get?.(DEVICE_HEADER) || '').trim();
  if (DEVICE_RE.test(device)) {
    return `dev:${createHash('sha256').update(`${device}|${SALT}`).digest('hex').slice(0, 32)}`;
  }
  return `ip:${String(req?.ip || 'anon').slice(0, 64)}`;
}

const ok = (res, body) => res.json(body);
const bad = (res, status, error, extra = {}) => res.status(status).json({ ok: false, error, ...extra });

/* -------------------------------- /api/intent ------------------------------ */

centralRouter.post('/intent', async (req, res) => {
  const owner = ownerFor(req);
  const { message, requestId = null, page = null, context = null } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return bad(res, 400, 'MESSAGE_REQUIRED');
  if (message.length > 1200) return bad(res, 400, 'MESSAGE_TOO_LONG');
  if (context && typeof context === 'object') ingestClientData(owner, context);
  const out = await handleIntent({ message: message.trim(), owner, requestId, page, context });
  return ok(res, { ok: true, version: CENTRAL_OS_VERSION, owner, ...out });
});

centralRouter.get('/intent/:id', (req, res) => {
  const record = getIntent(req.params.id);
  if (!record) return bad(res, 404, 'INTENT_NOT_FOUND');
  return ok(res, {
    ok: true,
    intent: {
      intentId: record.intentId,
      requestId: record.requestId,
      userMessage: record.userMessage,
      intentType: record.intentType,
      entities: record.entities,
      context: record.context,
      requiredModules: record.requiredModules,
      requiredTools: record.requiredTools,
      plan: record.plan,
      risk: record.risk,
      confirmationRequired: record.confirmationRequired,
      executionRequired: record.executionRequired,
      verificationRequired: record.verificationRequired,
      status: record.status,
      state: record.state,
      response: record.response,
      trace: record.trace,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  });
});

centralRouter.post('/intent/:id/confirm', async (req, res) => {
  const owner = ownerFor(req);
  const out = await confirmIntent(owner, req.params.id);
  if (out.status === 404 || out.status === 403 || out.status === 409) return bad(res, out.status, out.error);
  return ok(res, { ok: true, ...out });
});

centralRouter.post('/intent/:id/cancel', async (req, res) => {
  const owner = ownerFor(req);
  const out = await cancelIntent(owner, req.params.id);
  if (!out.ok) return bad(res, out.status, out.error);
  return ok(res, out);
});

centralRouter.get('/intents', (req, res) => {
  const owner = ownerFor(req);
  return ok(res, { ok: true, intents: listIntents({ owner }) });
});

/* ------------------------------- /api/system ------------------------------- */

/* GET reads; POST ingests client-owned truth (wallet/portfolio/positions)
   and returns the refreshed unified state — one call keeps the brain honest. */
centralRouter.get('/system/state', async (req, res) => {
  const owner = ownerFor(req);
  const state = await assembleState(owner);
  const memory = await getMemory(owner);
  return ok(res, {
    ok: true,
    version: CENTRAL_OS_VERSION,
    state,
    memory: {
      lastIntent: memory.lastIntent,
      lastEntities: memory.lastEntities,
      lastAction: memory.lastAction,
      lastError: memory.lastError,
      pendingConfirmation: memory.pendingConfirmation
    }
  });
});

centralRouter.post('/system/state', async (req, res) => {
  const owner = ownerFor(req);
  if (req.body && typeof req.body === 'object') {
    ingestClientData(owner, req.body);
    if (req.body.page && typeof req.body.page === 'object') {
      const { setPage } = await import('./stateStore.js');
      const { normalizePageContext } = await import('./contextEngine.js');
      const page = normalizePageContext(req.body.page);
      if (page) setPage(owner, page);
    }
  }
  const state = await assembleState(owner, { force: true });
  return ok(res, { ok: true, version: CENTRAL_OS_VERSION, state });
});

centralRouter.get('/system/health', async (req, res) => {
  const owner = ownerFor(req);
  const report = await capabilityReport({ owner, clientData: getSession(owner).clientData });
  const coverage = moduleCoverage();
  return ok(res, {
    ok: true,
    version: CENTRAL_OS_VERSION,
    uptimeSec: Math.round(process.uptime()),
    moduleCoverage: coverage,
    modules: report,
    events: eventStats()
  });
});

centralRouter.get('/system/capabilities', async (req, res) => {
  const owner = ownerFor(req);
  const report = await capabilityReport({ owner, clientData: getSession(owner).clientData });
  return ok(res, { ok: true, capabilities: report });
});

centralRouter.get('/system/events', (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : null;
  const limit = Math.min(200, Number(req.query.limit) || 50);
  return ok(res, { ok: true, events: recentEvents({ type, limit }) });
});

centralRouter.get('/system/modules', (_req, res) => ok(res, { ok: true, modules: listModules(), coverage: moduleCoverage() }));

/* ------------------------------ Upgrade 8 ----------------------------------
 * Lifecycle resources are deliberately separate from the legacy action map.
 * They are resumable records, not UI flags, and all writes are scoped to the
 * same owner used by /intent and /system/state.
 */
centralRouter.get('/intent-os/state', (req, res) => ok(res, { ok: true, state: getUpgrade8State(ownerFor(req)) }));
centralRouter.post('/intent-os/state', (req, res) => ok(res, { ok: true, state: patchUpgrade8State(ownerFor(req), req.body || {}) }));
centralRouter.post('/intent-os/intents', (req, res) => ok(res, { ok: true, state: startUpgrade8Intent(ownerFor(req), req.body || {}) }));
centralRouter.post('/intent-os/questions', (req, res) => ok(res, { ok: true, state: askUpgrade8Question(ownerFor(req), req.body || {}) }));
centralRouter.post('/intent-os/simulate', (req, res) => ok(res, { ok: true, simulation: createUpgrade8Simulation(req.body || {}) }));

centralRouter.get('/system/module/:id', (req, res) => {
  const adapter = getModule(req.params.id);
  if (!adapter) return bad(res, 404, 'MODULE_NOT_REGISTERED');
  return ok(res, {
    ok: true,
    module: {
      id: adapter.id, label: adapter.label, permissionLevel: adapter.permissionLevel,
      dependsOn: adapter.dependsOn, completeness: featureCompleteness(adapter.id),
      capabilities: adapter.capabilities()
    }
  });
});

centralRouter.get('/system/actions', (req, res) => {
  const owner = ownerFor(req);
  return ok(res, { ok: true, actions: listActions({ owner }).map(actionSummary) });
});

centralRouter.get('/system/memory', async (req, res) => {
  const owner = ownerFor(req);
  const memory = await getMemory(owner);
  const { conversationContext, ...safe } = memory;
  return ok(res, { ok: true, memory: safe, turns: conversationContext?.turns?.length || 0 });
});

/* -------------------------------- /api/tools ------------------------------- */

const TOOL_OPS = ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'];
for (const op of TOOL_OPS) {
  centralRouter.post(`/tools/${op}`, async (req, res) => {
    const owner = ownerFor(req);
    const { module, input = {} } = req.body || {};
    if (!module || !getModule(module)) return bad(res, 404, 'MODULE_NOT_REGISTERED');
    const result = await runTool({
      module,
      operation: op,
      input: { ...(input || {}), owner },
      ctx: { owner, clientData: getSession(owner).clientData },
      permissionGranted: 'EXECUTE'
    });
    return res.status(result.ok ? 200 : result.status === 'SAFE_STOP' ? 451 : 422).json({ ok: result.ok, ...result });
  });
}

/* ----------------------------- /api/transactions ---------------------------- */

centralRouter.get('/transactions/:id', async (req, res) => {
  const owner = ownerFor(req);
  const id = String(req.params.id || '');
  if (id.startsWith('act_')) {
    const action = getAction(id);
    if (!action) return bad(res, 404, 'ACTION_NOT_FOUND');
    return ok(res, { ok: true, kind: 'action', transaction: actionSummary(action) });
  }
  const viaTool = await runTool({ module: 'transactions', operation: 'read', input: { id }, ctx: { owner }, permissionGranted: 'READ' });
  if (!viaTool.ok) return bad(res, 404, 'TX_NOT_FOUND');
  return ok(res, { ok: true, kind: 'cross-chain', transaction: viaTool.result.transaction });
});

export default centralRouter;
