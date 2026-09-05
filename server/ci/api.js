/**
 * FBT CENTRAL INTELLIGENCE OS — Central API (spec §36, §37, §12, §17).
 * ---------------------------------------------------------------------------
 * §37's promise is that the frontend calls ONE gateway instead of wiring a
 * separate path per feature. This router is that gateway:
 *
 *   POST /api/brain/intent                  one turn, end to end
 *   GET  /api/brain/intent/:id              the stored trail (§35)
 *   POST /api/brain/intent/:id/confirm      run the parked action's handoff
 *   POST /api/brain/intent/:id/cancel       park cancelled
 *   POST /api/brain/intent/:id/receipt      wallet reports what it signed
 *   GET  /api/brain/system/state            the unified state (§4)
 *   POST /api/brain/system/context          page awareness (§7)
 *   GET  /api/brain/system/health           module + provider health
 *   GET  /api/brain/system/capabilities     capability matrix + §40 audit
 *   GET  /api/brain/system/events           recent events (§15)
 *   GET  /api/brain/system/stream           SSE (§17)
 *   POST /api/brain/tools/{read,quote,prepare,simulate,execute,verify}
 *   GET  /api/brain/transactions/:id        the action record
 *
 * WHY EVERY ROUTE GOES THROUGH `evaluatePolicy` (or the action engine)
 * A tool endpoint that trusts the caller to have checked policy is a policy that
 * exists for the chat and not for the app. So `/tools/execute` refuses unless a
 * confirmed action id accompanies it, and the refusal names what is missing. The
 * router is not a shortcut around the brain — it is another door into it.
 *
 * All routes are mounted under one prefix and inherit the app's `/api` budget;
 * the AI-specific budget also covers the intent routes because they spend real
 * provider quota (each turn reads wallet + market + protocol state).
 */
import { Router } from 'express';
import { CI_SCHEMA, CI_VERSION, STATE_SECTION_IDS, ACTION_TYPES, EVENT_TYPES } from '../../src/lib/central/schema.js';
import { resolvePage } from '../../src/lib/central/context.js';
import { auditRegistry } from '../../src/lib/central/registry.js';
import { classifyError, humanizeError } from '../../src/lib/central/errors.js';
import { createCentralStateStore } from './stateStore.js';
import { createEventBus, attachSse } from './eventBus.js';
import { createCentralBrain } from './brain.js';
import { createKernel } from './kernel.js';
import { mountKernelRoutes } from './kernelRoutes.js';
import { setCiSource, resetCiSources, healthSnapshot } from './sources.js';

export const CI_ROUTES_SCHEMA = 'fbt.central-api.v1';
const DEVICE_HEADER = 'x-fbt-device';
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_MESSAGE = 1200;

export function createCentralIntelligence({ ioOverride = null, log = () => {} } = {}) {
  const stateStore = createCentralStateStore({ log });
  const events = createEventBus({ stateStore, log });
  const brain = createCentralBrain({ stateStore, events, io: ioOverride || {}, log });
  /*
   * Upgrade 10's Central Intelligence Kernel. It reads the SAME state store the
   * brain writes, so the financial layer can never disagree with the numbers
   * the chat quoted, and it holds no execution path of its own — every money
   * move still goes through the brain's action engine and the user's wallet.
   */
  const kernel = createKernel({ stateStore, events, log });
  const router = Router();

  const ownerFor = (req) => {
    if (req?.tgUser?.id) return `tg:${req.tgUser.id}`;
    const device = String(req?.get?.(DEVICE_HEADER) || '').trim();
    if (DEVICE_RE.test(device)) return `dev:${device.slice(0, 40)}`;
    const address = String(req?.body?.wallet?.address || req?.body?.address || '').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) return `evm:${address.toLowerCase()}`;
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return `sol:${address}`;
    return `ip:${String(req?.ip || 'anon').slice(0, 48)}`;
  };

  /** One wrapper so every route answers the same way on failure (§22). */
  const route = (handler) => async (req, res) => {
    try {
      const out = await handler(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (error) {
      const classified = classifyError(error, { module: 'central-api' });
      const ledgerEntry = { code: classified.code, at: Date.now() };
      events.publish({ type: 'TRANSACTION_FAILED', owner: ownerFor(req), payload: ledgerEntry, source: 'central-api' });
      log('error', `${classified.code}: ${classified.technical}`.slice(0, 180));
      res.status(classified.safeStop ? 403 : classified.class === 'SECURITY' ? 403 : 502).json({
        ok: false,
        brain: CI_SCHEMA,
        code: classified.safeStop ? 'SAFE_STOP' : classified.code,
        message: humanizeError(classified, { locale: req.body?.locale === 'en' ? 'en' : 'fa' }),
        recovery: classified.ladder.length ? classified.ladder.slice(0, 3) : null,
        intentId: req.body?.intentId || null
      });
    }
  };

  /* ── intents ─────────────────────────────────────────────────────────── */
  router.post('/intent', route(async (req, res) => {
    const owner = ownerFor(req);
    const message = String(req.body?.message ?? '').slice(0, MAX_MESSAGE);
    if (!message.trim() && !req.body?.txHash) return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE', hint: 'a message, or a txHash to verify an executed action' });
    const out = await brain.handle({
      owner,
      message,
      page: req.body?.page || req.body?.context || null,
      locale: req.body?.locale === 'en' ? 'en' : req.body?.locale === 'fa' ? 'fa' : 'fa',
      confirm: req.body?.confirm === true,
      actionId: req.body?.actionId || null,
      planDigest: req.body?.planDigest || null,
      requestId: req.body?.requestId || req.get?.('x-fbt-request-id') || null,
      executionId: req.body?.executionId || null,
      txHash: req.body?.txHash || null,
      chainId: req.body?.chainId ?? null,
      hints: req.body?.hints || null
    });
    return res.json(out);
  }));

  router.get('/intent/:id', route(async (req, res) => {
    const owner = ownerFor(req);
    const found = brain.findIntent(owner, req.params.id);
    if (!found) return res.status(404).json({ ok: false, error: 'INTENT_NOT_FOUND', detail: 'intents are per-device and retained for the last 24 turns' });
    return res.json({ ok: true, brain: CI_SCHEMA, intent: found, recent: brain.intentsFor(owner).slice(0, 6) });
  }));

  /* 409, not 400: the request was valid when the card was drawn and is stale now,
     which is what the client needs to know in order to re-ask instead of retry. */
  const isReplayOrStale = (code) => ['ACTION_NOT_CONFIRMABLE', 'ACTION_ALREADY_SIGNED', 'ALREADY_IN_FLIGHT', 'PLAN_CHANGED'].includes(code);

  router.post('/intent/:id/confirm', route(async (req, res) => {
    const owner = ownerFor(req);
    const actionId = String(req.body?.actionId || req.params.id).slice(0, 64);
    const out = await brain.confirmAction({
      owner, actionId,
      planDigest: req.body?.planDigest || null,
      execute: req.body?.execute !== false
    });
    if (!out.ok) {
      const code = out.code === 'CONFIRMATION_EXPIRED' || isReplayOrStale(out.code) ? 409 : 400;
      return res.status(code).json({ ok: false, ...out, message: humanizeError({ code: out.code }, { locale: req.body?.locale || 'fa' }) });
    }
    return res.json({ ok: true, brain: CI_SCHEMA, ...out, state: await stateStore.snapshot(owner, { includeData: false }) });
  }));

  router.post('/intent/:id/cancel', route(async (req, res) => {
    const owner = ownerFor(req);
    const out = await brain.cancelAction({ owner, actionId: String(req.body?.actionId || req.params.id).slice(0, 64), reason: String(req.body?.reason || 'cancelled from the client').slice(0, 80) });
    return res.status(out.ok ? 200 : 409).json({ ok: out.ok, ...out });
  }));

  /**
   * The wallet tells us what it signed; we verify against the chain and run the
   * §16 cascade. This endpoint is the difference between "the UI showed a
   * success toast" and "every module is now looking at the new balance".
   */
  router.post('/intent/:id/receipt', route(async (req, res) => {
    const owner = ownerFor(req);
    const out = await brain.reportExecutionResult({
      owner,
      actionId: String(req.body?.actionId || req.params.id).slice(0, 64),
      txHash: req.body?.txHash || null,
      chainId: req.body?.chainId ?? null,
      status: req.body?.status === 'REJECTED' ? 'REJECTED' : 'BROADCAST'
    });
    return res.status(out.ok ? 200 : 409).json({ ok: out.ok, brain: CI_SCHEMA, ...out });
  }));

  /* ── system ──────────────────────────────────────────────────────────── */
  router.get('/system/state', route(async (req, res) => {
    const owner = ownerFor(req);
    await stateStore.get(owner);
    const includeData = req.query.data === '1' || req.query.data === 'true';
    const snapshot = await stateStore.snapshot(owner, { includeData });
    return res.json({ ok: true, schema: CI_ROUTES_SCHEMA, brain: CI_SCHEMA, version: CI_VERSION, ...snapshot, memory: brain.memoryFor(owner), sections: STATE_SECTION_IDS });
  }));

  router.post('/system/context', route(async (req, res) => {
    const owner = ownerFor(req);
    const page = resolvePage(req.body || {});
    stateStore.write(owner, 'activePage', { data: page, source: 'client-context', status: 'OK', now: Date.now() });
    if (page.module && page.module !== 'session') {
      stateStore.write(owner, 'activeModule', { data: { id: page.module, tab: page.tab, since: Date.now() }, source: 'client-context', status: 'OK', now: Date.now() });
    }
    if (req.body?.wallet?.address) {
      /* The browser may tell us WHICH wallet it holds; it may not tell us what is
         IN it. Balances come from the chain through the wallet module — otherwise
         a compromised page could feed the brain a fictional portfolio. */
      const current = stateStore.peek(owner).sections.wallet.data || {};
      stateStore.write(owner, 'wallet', { data: { ...current, addresses: { evm: [req.body.wallet.address] }, connected: true, claimedBy: 'client-context' }, source: 'client-context', status: 'PARTIAL', now: Date.now() });
    }
    return res.json({ ok: true, page, brain: CI_SCHEMA, accepted: { address: Boolean(req.body?.wallet?.address), balancesIgnored: true } });
  }));

  router.get('/system/health', route(async (req, res) => {
    const owner = ownerFor(req);
    const health = await brain.health(owner);
    const registry = brain.registry(owner);
    const audit = auditRegistry(registry.list);
    const failing = Object.entries(health.modules).filter(([, v]) => v.status && v.status !== 'HEALTHY');
    return res.json({
      ok: failing.length === 0,
      brain: CI_SCHEMA,
      version: CI_VERSION,
      at: Date.now(),
      modules: health.modules,
      sources: healthSnapshot(),
      registry: { modules: audit.modules, complete: audit.complete, coveragePct: audit.coveragePct, incomplete: audit.incomplete, verdict: audit.verdict },
      brainStats: brain.stats(),
      store: stateStore.stats(),
      /** A degraded source is a 200 with a reason, never a 500: the brain is
          healthy even when one provider is not, and the difference matters for
          uptime checks that would otherwise page on a rate limit. */
      degraded: failing.map(([id, v]) => ({ module: id, status: v.status, detail: v.detail }))
    });
  }));

  router.get('/system/capabilities', route(async (req, res) => {
    const owner = ownerFor(req);
    const registry = brain.registry(owner);
    const matrix = brain.capabilities(owner);
    const audit = auditRegistry(registry.list);
    return res.json({
      ok: true, brain: CI_SCHEMA, at: Date.now(),
      capabilities: matrix.capabilities,
      detail: matrix.detail,
      counts: matrix.counts,
      coverage: matrix.coverage,
      definitionOfDone: audit,
      /** §40's required contract, so a feature owner can diff their module against it. */
      contract: brain.moduleContract,
      actions: ACTION_TYPES,
      events: EVENT_TYPES
    });
  }));

  router.get('/system/events', route(async (req, res) => {
    const owner = ownerFor(req);
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
    return res.json({ ok: true, brain: CI_SCHEMA, owner: null, events: events.recent(owner, limit).map(({ dedupeKey, fingerprint, ...rest }) => { void dedupeKey; void fingerprint; return rest; }) });
  }));

  router.get('/system/stream', (req, res) => {
    const owner = ownerFor(req);
    attachSse(req, res, events, owner);
  });

  /* ── tools (§9's router, exposed for direct, policy-checked calls) ───── */
  const toolHandler = (operation) => async (req, res) => {
    const owner = ownerFor(req);
    const moduleId = String(req.body?.module || '').toLowerCase().slice(0, 32);
    if (!moduleId) return res.status(400).json({ ok: false, error: 'MODULE_REQUIRED', available: brain.registry(owner).list.map((m) => m.id) });
    if (operation === 'execute' && !req.body?.actionId) {
      /* The one thing this endpoint will never do: take an order because a caller
         said so. An execution without a confirmed action record is refused here and
         in the policy engine, so it cannot be reached by skipping the chat. */
      return res.status(428).json({
        ok: false, code: 'CONFIRMATION_REQUIRED',
        error: 'execute requires a confirmed actionId from POST /api/brain/intent',
        detail: 'no financial action runs without a plan the user saw and confirmed (§33)',
        brain: CI_SCHEMA
      });
    }
    /* The actionId is carried into the brain as well, so the CONFIRMED check lives
       with the executor and not only in front of this route. */
    const out = await brain.directToolCall({ owner, module: moduleId, operation, input: req.body?.input || req.body || {}, actionId: req.body?.actionId || null });
    return res.json({ ok: out.ok, brain: CI_SCHEMA, operation, ...out });
  };
  for (const operation of ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify']) {
    router.post(`/tools/${operation}`, route(toolHandler(operation)));
  }

  router.get('/transactions/:id', route(async (req, res) => {
    const owner = ownerFor(req);
    const registry = brain.registry(owner);
    const action = registry.actions.find(owner, req.params.id);
    if (!action) return res.status(404).json({ ok: false, error: 'ACTION_NOT_FOUND', detail: 'action records are per-device and expire after 30 minutes' });
    return res.json({ ok: true, brain: CI_SCHEMA, action, verification: action.verification, transaction: action.transaction, signature: action.signature ? { signed: true, txHash: action.signature.txHash } : { signed: false } });
  }));

  /** Deliberate test seam, mirrored from sources.js (see the honesty note there). */
  router.post('/system/test-source', (req, res) => {
    if (process.env.NODE_ENV === 'production' && process.env.FBT_ALLOW_CI_TEST_HOOKS !== '1') {
      return res.status(403).json({ ok: false, error: 'TEST_HOOK_DISABLED' });
    }
    const { name, behaviour } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'NAME_REQUIRED' });
    if (behaviour === null) { resetCiSources(); return res.json({ ok: true, reset: true }); }
    return res.json({ ok: false, error: 'SOURCE_INJECTION_IS_PROCESS_LOCAL', detail: 'override sources with setCiSource() in the probe process, not over HTTP' });
  });

  /* Upgrade 10's financial surface, mounted on the SAME gateway (see the note
     in kernelRoutes.js): one origin, one budget, one owner derivation. */
  mountKernelRoutes({ router, kernel, ownerFor, log });

  return { router, stateStore, events, brain, kernel, ownerFor, schema: CI_ROUTES_SCHEMA };
}

/** Kept for the probes: the singleton shape mirrors the other server modules. */
let singleton = null;
export function centralIntelligence(options = {}) {
  if (!singleton) singleton = createCentralIntelligence(options);
  return singleton;
}

export { setCiSource, resetCiSources };
export default createCentralIntelligence;
