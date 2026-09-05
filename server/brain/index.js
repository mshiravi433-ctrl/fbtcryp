/**
 * FBT FINANCIAL OS — Server Brain Module (Upgrade 11+12)
 * ---------------------------------------------------------------------------
 * Server-side integration for the Predictive Brain, Opportunity Engine,
 * Financial Guardian, and Cross-Module Workflow Engine.
 *
 * Mounted under /api/brain/ alongside the existing Central Intelligence API.
 * Does NOT replace any existing route — it ADDS new endpoints for:
 *
 *   GET  /api/brain/predictive/goal/:goalId      goal forecasting
 *   GET  /api/brain/predictive/portfolio          portfolio forecasting
 *   GET  /api/brain/predictive/cashflow            cashflow forecasting
 *   GET  /api/brain/predictive/risk                risk forecasting
 *   POST /api/brain/predictive/twin                digital twin projection
 *   GET  /api/brain/opportunities                  personalized opportunities
 *   GET  /api/brain/guardian                       guardian sweep
 *   POST /api/brain/guardian/event                 evaluate a single event
 *   GET  /api/brain/daily-brief                    daily financial brief
 *   POST /api/brain/workflow                       execute a cross-module workflow
 *   GET  /api/brain/workflow/:id                   workflow status
 *   GET  /api/brain/knowledge                      ecosystem knowledge graph
 *   POST /api/brain/route                          route an intent to modules
 */
import { Router } from 'express';
import { CI_SCHEMA } from '../../src/lib/central/schema.js';

export const BRAIN_ROUTES_SCHEMA = 'fbt.brain-routes.v1';

/**
 * Create the brain router. Receives the kernel, state store, and event bus
 * from the existing central intelligence so it can read real state.
 */
export function createBrainRouter({ kernel, stateStore, events, log = () => {} } = {}) {
  const router = Router();

  const ownerFor = (req) => {
    const device = String(req?.get?.('x-fbt-device') || '').trim();
    if (/^[A-Za-z0-9_-]{8,64}$/.test(device)) return `dev:${device.slice(0, 40)}`;
    const address = String(req?.body?.wallet?.address || req?.body?.address || '').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) return `evm:${address.toLowerCase()}`;
    return `ip:${String(req?.ip || 'anon').slice(0, 48)}`;
  };

  const wrap = (handler) => async (req, res) => {
    try {
      const out = await handler(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (error) {
      log('brain-route-error', String(error?.message || error).slice(0, 160));
      if (!res.headersSent) res.status(500).json({ ok: false, code: 'BRAIN_ERROR', brain: CI_SCHEMA, detail: String(error?.message || error).slice(0, 160) });
    }
  };

  /* ── Predictive Brain ─────────────────────────────────────────────── */

  router.get('/predictive/risk', wrap(async (req) => {
    const owner = ownerFor(req);
    const { forecastRisk } = await import('../../src/lib/brain/predictiveBrain.js');
    const state = kernel ? kernel.assess(owner) : {};
    const fs = state.financialState || {};
    const positions = fs.positions || [];
    return {
      ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA,
      ...forecastRisk({ financialState: fs, positions, marketContext: fs.marketContext || null })
    };
  }));

  router.post('/predictive/twin', wrap(async (req) => {
    const owner = ownerFor(req);
    const { createFinancialTwin, projectTwin } = await import('../../src/lib/brain/predictiveBrain.js');
    const state = kernel ? kernel.assess(owner) : {};
    const fs = state.financialState || {};
    const goals = kernel ? kernel.listGoals(owner).goals || [] : [];

    const twinResult = createFinancialTwin({
      financialState: fs, goals,
      riskProfile: kernel?.getProfile(owner)?.riskProfile?.value || 'MODERATE'
    });

    if (!twinResult.ok) return { ok: false, ...twinResult };

    const scenarios = Array.isArray(req.body?.scenarios) ? req.body.scenarios.slice(0, 6) : [
      { name: 'Bull Case', expectedReturnPct: 25, volatilityPct: 30 },
      { name: 'Base Case', expectedReturnPct: 10, volatilityPct: 40 },
      { name: 'Bear Case', expectedReturnPct: -15, volatilityPct: 60 },
      { name: 'Stable', expectedReturnPct: 3, volatilityPct: 10 }
    ];

    const projection = projectTwin({
      twin: twinResult.twin,
      scenarios,
      months: req.body?.months || 12
    });

    return { ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA, twin: twinResult.twin, ...projection };
  }));

  /* ── Opportunities ────────────────────────────────────────────────── */

  router.get('/opportunities', wrap(async (req) => {
    const owner = ownerFor(req);
    const { scanOpportunities } = await import('../../src/lib/brain/opportunityEngine.js');
    const state = kernel ? kernel.assess(owner) : {};
    const fs = state.financialState || {};
    const goals = kernel ? kernel.listGoals(owner).goals || [] : [];
    const profile = kernel ? kernel.getProfile(owner) : {};

    return {
      ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA,
      ...scanOpportunities({
        financialState: fs,
        userProfile: profile,
        goals,
        riskProfile: profile.riskProfile?.value || 'MODERATE',
        defiOpportunities: [],
        rwaOpportunities: [],
        smartMoneySignals: []
      })
    };
  }));

  /* ── Guardian ─────────────────────────────────────────────────────── */

  router.get('/guardian', wrap(async (req) => {
    const owner = ownerFor(req);
    const { runGuardianSweep } = await import('../../src/lib/brain/financialGuardian.js');
    const state = kernel ? kernel.assess(owner) : {};
    const fs = state.financialState || {};
    const goals = kernel ? kernel.listGoals(owner).goals || [] : [];

    return {
      ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA,
      ...runGuardianSweep({
        financialState: fs,
        goals,
        marketContext: fs.marketContext || null,
        autonomyLevel: Number(req.query.autonomyLevel) || 2
      })
    };
  }));

  router.post('/guardian/event', wrap(async (req) => {
    const { evaluateEvent } = await import('../../src/lib/brain/financialGuardian.js');
    return {
      ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA,
      ...evaluateEvent(req.body || {})
    };
  }));

  /* ── Daily Brief ──────────────────────────────────────────────────── */

  router.get('/daily-brief', wrap(async (req) => {
    const owner = ownerFor(req);
    const { generateDailyBrief } = await import('../../src/lib/brain/index.js');
    const { runGuardianSweep } = await import('../../src/lib/brain/financialGuardian.js');
    const state = kernel ? kernel.assess(owner) : {};
    const fs = state.financialState || {};
    const goals = kernel ? kernel.listGoals(owner).goals || [] : [];
    const guardian = runGuardianSweep({ financialState: fs, goals });

    return {
      ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA,
      ...generateDailyBrief({
        financialState: fs,
        goals,
        guardian,
        marketContext: fs.marketContext || null
      })
    };
  }));

  /* ── Knowledge Graph ──────────────────────────────────────────────── */

  router.get('/knowledge', wrap(async (req) => {
    const { resolveIntentToModules, ECOSYSTEM_MODULES } = await import('../../src/lib/brain/knowledgeGraph.js');
    const query = String(req.query.q || '').trim();
    const graph = query ? resolveIntentToModules(query) : {
      modules: [], edges: [], selectedModuleIds: [], crossModule: false,
      totalModules: Object.keys(ECOSYSTEM_MODULES).length, matchedKeywords: 0
    };
    return { ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA, ...graph, allModules: ECOSYSTEM_MODULES };
  }));

  /* ── Ecosystem Router ─────────────────────────────────────────────── */

  router.post('/route', wrap(async (req) => {
    const { routeIntent } = await import('../../src/lib/brain/ecosystemRouter.js');
    const owner = ownerFor(req);
    const state = kernel ? kernel.assess(owner) : {};
    const fs = state.financialState || {};
    const goals = kernel ? kernel.listGoals(owner).goals || [] : [];
    const profile = kernel ? kernel.getProfile(owner) : {};

    return {
      ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA,
      ...routeIntent({
        message: req.body?.message || '',
        page: req.body?.page || null,
        financialState: fs,
        userProfile: profile,
        activeGoals: goals,
        riskProfile: profile.riskProfile?.value || null,
        conversationContext: req.body?.conversationContext || null
      })
    };
  }));

  /* ── Cross-Module Workflow ────────────────────────────────────────── */

  const workflowStore = new Map();
  const MAX_WORKFLOWS = 50;

  router.post('/workflow', wrap(async (req) => {
    const owner = ownerFor(req);
    const message = String(req.body?.message || '').trim();
    if (!message) return res_status(400, { ok: false, code: 'MESSAGE_REQUIRED' });

    const { routeIntent } = await import('../../src/lib/brain/ecosystemRouter.js');
    const state = kernel ? kernel.assess(owner) : {};
    const fs = state.financialState || {};
    const goals = kernel ? kernel.listGoals(owner).goals || [] : [];
    const profile = kernel ? kernel.getProfile(owner) : {};

    // Route the intent
    const routing = routeIntent({
      message, financialState: fs, userProfile: profile,
      activeGoals: goals, riskProfile: profile.riskProfile?.value || null
    });

    if (!routing.ok) return { ok: false, ...routing };

    // Create a workflow record
    const workflowId = `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const workflow = {
      workflowId,
      owner,
      message: message.slice(0, 200),
      status: 'ROUTED',
      plan: routing.plan,
      steps: routing.plan.modules.primary.map(m => ({
        moduleId: m.id,
        status: 'PENDING',
        startedAt: null,
        completedAt: null,
        result: null
      })),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    workflowStore.set(workflowId, workflow);
    if (workflowStore.size > MAX_WORKFLOWS) {
      const oldest = [...workflowStore.keys()][0];
      workflowStore.delete(oldest);
    }

    return {
      ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA,
      workflow,
      message: `Workflow created with ${workflow.steps.length} step(s) across modules: ${workflow.steps.map(s => s.moduleId).join(', ')}`
    };
  }));

  router.get('/workflow/:id', wrap(async (req) => {
    const wf = workflowStore.get(req.params.id);
    if (!wf) return { ok: false, code: 'WORKFLOW_NOT_FOUND', detail: 'Workflows are ephemeral and expire when the store rotates' };
    return { ok: true, schema: BRAIN_ROUTES_SCHEMA, brain: CI_SCHEMA, workflow: wf };
  }));

  function res_status(code, body) {
    return { ok: false, ...body, _status: code };
  }

  return router;
}

export default createBrainRouter;
