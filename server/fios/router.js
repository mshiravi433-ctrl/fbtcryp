/**
 * FBT FINANCIAL INTELLIGENCE OS — API router (batch 7).
 * ---------------------------------------------------------------------------
 * Mounted under /api/ai AFTER the command-center routes, so it inherits the
 * same /api/ai budget (GETs free, POSTs 10/min by default) and the same
 * device identity as the rest of the AI surface. There is no third gateway:
 * the owner is derived by the SAME ownerFor the central brain uses (tgUser →
 * x-fbt-device → wallet → ip), so a request FI sees as owner X is the owner
 * X's state store rows belong to.
 *
 * Route notes (the ones that are not self-evident):
 *   /external-agents — NOT /agents: /api/ai/agents belongs to the existing
 *                      command-center router; the registry lives here.
 *   /health          — NOT /status: /api/ai/status belongs to the command
 *                      center. /health reports flags + the last REAL results
 *                      + the applied migration version + durability.
 *   /decision/:id/evidence — the SHOW EVIDENCE button's bundle: the decision
 *                      row's linked evidence rows plus their quality counts.
 *   /policies/:id/stop     — the STOP button: one policy, or every active
 *                      policy when policyId is absent. `by` is always 'user'
 *                      from this surface; the machine cannot stop itself
 *                      through the API any more than it can resume itself.
 */
import { Router } from 'express';

export const FI_ROUTES_SCHEMA = 'fbt.fi.routes.v1';

const MAX_TEXT = 2000;
const MAX_AMOUNT = 100_000_000;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function createFiRouter({ fi, ownerFor, log = () => {} } = {}) {
  const router = Router();
  const ownerOf = (req) => {
    if (ownerFor) return ownerFor(req);
    const device = String(req?.get?.('x-fbt-device') || '').trim();
    if (/^[A-Za-z0-9_-]{8,64}$/.test(device)) return `dev:${device.slice(0, 40)}`;
    return `ip:${String(req?.ip || 'anon').slice(0, 48)}`;
  };

  /* Per-owner lazy migration, once in flight at a time per owner. A failed
     migration must not take the API down: the route proceeds, and the next
     call retries the (idempotent) steps. */
  const inFlight = new Map();
  const ensureMigrated = (owner) => {
    if (!inFlight.has(owner)) {
      inFlight.set(owner, fi.migrations.migrateOwner(owner)
        .catch((err) => log(`migrations:failed:${owner}:${String(err?.message || err).slice(0, 120)}`))
        .finally(() => inFlight.delete(owner)));
    }
    return inFlight.get(owner);
  };

  const reject = (status, code, detail = null, extra = {}) => ({ __reject: true, status, code, detail, extra });
  const route = (handler) => async (req, res) => {
    try {
      const owner = ownerOf(req);
      const out = await handler(req, res, owner);
      if (out && out.__reject) {
        res.status(out.status || 400).json({ ok: false, financialIntelligence: FI_ROUTES_SCHEMA, code: out.code, detail: out.detail || null, ...(out.extra || {}) });
        return;
      }
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (error) {
      const detail = String(error?.detail || error?.message || error).slice(0, 240);
      log(`fi-router:error:${detail}`);
      res.status(502).json({ ok: false, financialIntelligence: FI_ROUTES_SCHEMA, code: error?.code || 'FI_ERROR', detail });
    }
  };

  /* ══════════════════════ health + state ══════════════════════ */

  router.get('/health', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    return fi.health(owner);
  }));

  router.get('/financial-state', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const financial = await fi.financialStateFor(owner);
    return { ok: true, schema: financial.schema, financial, durable: fi.collections.durable() };
  }));

  router.get('/world-state', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const world = await fi.worldModelFor(owner);
    return { ok: true, schema: world.schema, world: fi.worldModelDigest ? fi.worldModelDigest(world) : world, durable: fi.collections.durable() };
  }));

  /* ══════════════════════ research (data, not chatbot) ══════════════════════ */

  router.post('/research', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const subject = String(body.subject || body.token || body.message || '').trim();
    if (!subject) return reject(400, 'SUBJECT_REQUIRED', 'research needs a subject: an asset symbol, protocol or question');
    const world = await fi.worldModelFor(owner);
    const kinds = Array.isArray(body.kinds) && body.kinds.length
      ? body.kinds.map((k) => String(k).toLowerCase()).slice(0, 10)
      : undefined;
    const out = await fi.research.research({
      owner,
      subject: subject.slice(0, 80),
      kinds,
      world,
      token: body.token && typeof body.token === 'object' ? body.token : null,
      correlationId: body.correlationId || null
    });
    /* The engine returns { ok:true, research:{ status:'UNAVAILABLE', … } }
       when the provider had nothing — it still completed, honestly. The
       status then lives on the research row, not on a thrown error. */
    if (!out.ok) return reject(422, out.code || 'RESEARCH_UNAVAILABLE', out.detail || 'no provider returned usable data; nothing was estimated');
    if (out.research?.status === 'UNAVAILABLE') {
      return reject(422, 'RESEARCH_UNAVAILABLE', 'no provider returned usable data for this subject; nothing was estimated', { missing: out.research.missing || [] });
    }
    return { ok: true, research: out.research, durable: fi.collections.durable() };
  }));

  router.get('/research', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const rows = await fi.research.recent(owner, { limit: Math.min(30, Math.max(1, Number(req.query.limit) || 10)) });
    return { ok: true, research: rows, count: rows.length, durable: fi.collections.durable() };
  }));

  router.get('/research/:id', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const got = await fi.research.get(owner, req.params.id);
    if (!got.ok) return reject(404, 'RESEARCH_NOT_FOUND', `no research ${req.params.id} for this owner`, { id: req.params.id });
    return { ok: true, research: got.row, durable: fi.collections.durable() };
  }));

  /* ══════════════════════ strategies + simulation ══════════════════════ */

  router.post('/strategies', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const financial = await fi.financialStateFor(owner);
    if (financial.status === 'UNAVAILABLE') return reject(409, 'NO_FINANCIAL_STATE', financial.reason);
    const world = await fi.worldModelFor(owner);
    const prefs = await fi.preferences.resolve(owner);
    /* Smart money is a first-class input to strategy generation — same feed
       the Intelligence page reads, folded into evidence + notes. */
    const smartMoney = fi.smartMoneyIntel
      ? await fi.smartMoneyIntel.fetch({ window: body.window || '24h' }).catch(() => null)
      : null;
    const globalIntel = fi.globalIntelFor
      ? await fi.globalIntelFor(owner).catch(() => null)
      : null;
    const crossAsset = fi.crossAssetFor
      ? await fi.crossAssetFor(owner, {}).catch(() => null)
      : null;
    const out = await fi.strategyEngine.generate({
      owner,
      intent: { message: String(body.message || body.intent || '').slice(0, MAX_TEXT) },
      financial, world,
      goal: body.goal || null,
      preferences: prefs,
      globalIntel,
      crossAsset,
      smartMoney,
      correlationId: body.correlationId || null
    });
    return out.ok
      ? {
          ok: true,
          strategies: out.strategies,
          smartMoney: smartMoney && smartMoney.status !== 'unavailable'
            ? { status: smartMoney.status, netFlowUsd: smartMoney.signals?.netFlowUsd ?? null, alignment: smartMoney.alignment }
            : null,
          durable: out.durable ?? fi.collections.durable()
        }
      : reject(409, out.code, out.detail);
  }));

  router.get('/strategies', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const rows = await fi.strategyEngine.recent(owner, { limit: Math.min(30, Math.max(1, Number(req.query.limit) || 10)) });
    return { ok: true, strategies: rows, durable: fi.collections.durable() };
  }));

  /* Strategy competition: the analyst / strategist / risk-auditor / judge
     roles run over the supplied (or previously generated) strategies and
     the ranked comparison + the judge's verdict are returned. A strategy
     that lost carries its rejection reasons; disagreement is never hidden. */
  router.post('/strategies/compare', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    let rows = Array.isArray(body.strategies) ? body.strategies.slice(0, 12) : null;
    const prefs = await fi.preferences.resolve(owner);
    if (!rows || rows.length < 2) {
      const recentRows = await fi.strategyEngine.recent(owner, { limit: 12 });
      rows = recentRows.slice(0, 12);
    }
    if (!rows || rows.length < 2) {
      return reject(409, 'NEEDS_AT_LEAST_TWO_STRATEGIES', 'generate strategies first, or pass at least two in the body', { count: rows ? rows.length : 0 });
    }
    const financial = await fi.financialStateFor(owner).catch(() => null);
    const world = await fi.worldModelFor(owner).catch(() => null);
    const smartMoney = fi.smartMoneyIntel
      ? await fi.smartMoneyIntel.fetch({ window: body.window || '24h' }).catch(() => null)
      : null;
    const crossAsset = fi.crossAssetFor
      ? await fi.crossAssetFor(owner, {}).catch(() => null)
      : null;

    /* Live route simulation for every candidate — Phase 11 runtime provider. */
    let routeSims = body.simulations || null;
    let simBundle = null;
    if (!routeSims && fi.routeSimulator?.simulateAll) {
      simBundle = await fi.routeSimulator.simulateAll(rows, {
        financial, world, smartMoney, crossAsset
      }).catch(() => null);
      if (simBundle?.ok) routeSims = simBundle.simulations;
    }

    const out = await fi.competition.compete({
      owner,
      strategies: rows,
      preferences: prefs,
      goal: body.goal || null,
      simulations: routeSims,
      smartMoney,
      financial,
      crossAsset,
      correlationId: body.correlationId || null
    });
    return out.ok
      ? {
          ok: true,
          comparison: out.competition,
          routeSimulations: simBundle?.ok ? simBundle.simulations : null,
          liveSimulation: out.competition?.liveSimulation === true,
          smartMoney: smartMoney && smartMoney.status !== 'unavailable'
            ? { status: smartMoney.status, netFlowUsd: smartMoney.signals?.netFlowUsd ?? null }
            : null,
          durable: fi.collections.durable()
        }
      : reject(409, out.code, out.detail || null, { count: out.count || rows.length });
  }));

  /* Explicit live route-simulate endpoint — Strategy A/B/C → simulate → rank. */
  router.post('/strategies/simulate', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    let rows = Array.isArray(body.strategies) ? body.strategies.slice(0, 12) : null;
    if (!rows || !rows.length) {
      rows = await fi.strategyEngine.recent(owner, { limit: 12 });
    }
    if (!rows || !rows.length) {
      return reject(409, 'NO_STRATEGIES', 'generate strategies first, or pass them in the body');
    }
    const financial = await fi.financialStateFor(owner);
    if (financial.status === 'UNAVAILABLE') return reject(409, 'NO_FINANCIAL_STATE', financial.reason);
    const world = await fi.worldModelFor(owner);
    const smartMoney = fi.smartMoneyIntel
      ? await fi.smartMoneyIntel.fetch({ window: body.window || '24h' }).catch(() => null)
      : null;
    const crossAsset = fi.crossAssetFor
      ? await fi.crossAssetFor(owner, {}).catch(() => null)
      : null;
    if (!fi.routeSimulator?.simulateAll) {
      return reject(503, 'ROUTE_SIMULATOR_UNAVAILABLE', 'live route simulator is not wired in this deployment');
    }
    const simBundle = await fi.routeSimulator.simulateAll(rows, {
      financial, world, smartMoney, crossAsset
    });
    if (!simBundle.ok) return reject(502, simBundle.code || 'SIMULATION_FAILED', 'route simulation failed');

    /* Rank by risk-adjusted score when competition is available. */
    let comparison = null;
    if (rows.length >= 2) {
      const prefs = await fi.preferences.resolve(owner);
      const comp = await fi.competition.compete({
        owner,
        strategies: rows,
        preferences: prefs,
        goal: body.goal || null,
        simulations: simBundle.simulations,
        smartMoney,
        financial,
        crossAsset,
        correlationId: body.correlationId || null
      });
      if (comp.ok) comparison = comp.competition;
    }

    return {
      ok: true,
      schema: 'fbt.fi.route-simulator.v1',
      simulations: simBundle.simulations,
      passed: simBundle.passed,
      live: true,
      estimate: true,
      bestStrategyId: comparison?.judge?.winnerId || null,
      winnerStatus: comparison?.judge?.winnerStatus || null,
      comparison,
      smartMoney: smartMoney && smartMoney.status !== 'unavailable'
        ? {
            status: smartMoney.status,
            netFlowUsd: smartMoney.signals?.netFlowUsd ?? null,
            cexDexDirection: smartMoney.signals?.cexDexDirection ?? null,
            whaleActivity: smartMoney.signals?.whaleActivity ?? null
          }
        : null,
      executionPermission: false,
      guaranteed: false,
      durable: fi.collections.durable()
    };
  }));

  router.post('/simulate', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const financial = await fi.financialStateFor(owner);
    if (financial.status === 'UNAVAILABLE') return reject(409, 'NO_FINANCIAL_STATE', financial.reason);
    const out = await fi.simulationEngine.simulate({
      owner,
      sections: fi.flatSectionsFor(owner),
      financial,
      costs: body.costs || {},
      goal: body.goal || null,
      custom: Array.isArray(body.custom) ? body.custom.slice(0, 8) : [],
      correlationId: body.correlationId || null
    });
    return out.ok ? { ok: true, simulation: out.simulation, durable: out.durable ?? fi.collections.durable() } : reject(409, out.code, out.detail);
  }));

  router.post('/what-if', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const text = String(body.text || body.message || '');
    if (!text.trim()) return reject(400, 'TEXT_REQUIRED', 'a what-if question is required');
    const financial = await fi.financialStateFor(owner);
    if (financial.status === 'UNAVAILABLE') return reject(409, 'NO_FINANCIAL_STATE', financial.reason);
    const out = await fi.runWhatIf(fi.simulationEngine, {
      owner,
      text: text.slice(0, MAX_TEXT),
      sections: fi.flatSectionsFor(owner),
      financial,
      goal: body.goal || null,
      correlationId: body.correlationId || null
    });
    return out.ok
      ? { ok: true, whatIf: out, durable: fi.collections.durable() }
      : reject(422, out.code || 'UNRECOGNIZED_WHAT_IF', out.detail || 'this question is outside the supported what-ifs', { interpretation: out.interpretation || null });
  }));

  /* ══════════════════════ the decision pipeline ══════════════════════ */

  router.post('/decision', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const correlationId = body.correlationId || req.get?.('x-fbt-request-id') || null;

    const financial = await fi.financialStateFor(owner);
    if (financial.status === 'UNAVAILABLE') return reject(409, 'NO_FINANCIAL_STATE', financial.reason, { reason: financial.reason });
    const world = await fi.worldModelFor(owner);
    const prefs = await fi.preferences.resolve(owner);
    const goal = body.goal || null;

    /* Smart money + global context — feed the SAME observations into
       strategy generation, competition ranking and the decision record. */
    const smartMoney = fi.smartMoneyIntel
      ? await fi.smartMoneyIntel.fetch({ window: body.window || '24h' }).catch(() => null)
      : null;
    const globalIntel = fi.globalIntelFor
      ? await fi.globalIntelFor(owner).catch(() => null)
      : null;
    const crossAsset = fi.crossAssetFor
      ? await fi.crossAssetFor(owner, {}).catch(() => null)
      : null;

    let rows = Array.isArray(body.strategies) ? body.strategies.slice(0, 12) : null;
    if (!rows || rows.length < 2) {
      const gen = await fi.strategyEngine.generate({
        owner,
        intent: { message: String(body.message || body.intent || '').slice(0, MAX_TEXT) },
        financial, world, goal, preferences: prefs,
        globalIntel, crossAsset, smartMoney,
        correlationId
      });
      if (!gen.ok) return reject(409, gen.code, gen.detail);
      rows = gen.strategies;
    }

    /* Live route simulation BEFORE competition so the judge ranks simulated
       risk-adjusted outcomes, not bare proposals. */
    let routeSims = null;
    if (fi.routeSimulator?.simulateAll) {
      const simBundle = await fi.routeSimulator.simulateAll(rows, {
        financial, world, globalIntel, crossAsset, smartMoney
      }).catch(() => null);
      if (simBundle?.ok) routeSims = simBundle.simulations;
    }

    const comp = await fi.competition.compete({
      owner,
      strategies: rows,
      preferences: prefs,
      goal,
      simulations: routeSims,
      smartMoney,
      financial,
      crossAsset,
      correlationId
    });
    if (!comp.ok) return reject(409, comp.code, comp.detail);

    const sim = await fi.simulationEngine.simulate({ owner, sections: fi.flatSectionsFor(owner), financial, goal, correlationId }).catch(() => ({ ok: false, code: 'SIMULATION_UNAVAILABLE' }));
    const risk = fi.riskFor(owner, world);

    /* Authority inputs — all default false. Flip only when the caller
       supplies every gate (execute + userConfirmed + auth screen +
       guardian + policy). Returns stay unguaranteed forever. */
    const executionRequested = body.execute === true || body.executionRequested === true;
    const userConfirmed = body.userConfirmed === true || body.confirmed === true;
    const authorizationScreenShown = body.authorizationScreenShown === true || body.authScreen === true;
    const guardianApproved = body.guardianApproved === true;
    let policyVerdict = body.policyVerdict && typeof body.policyVerdict === 'object' ? body.policyVerdict : null;
    if (executionRequested && !policyVerdict && body.policyId && fi.policyEngine?.evaluate) {
      policyVerdict = await fi.policyEngine.evaluate({
        owner,
        policyId: body.policyId,
        request: {
          kind: rows.find((r) => r.id === (comp.competition?.judge?.winnerId))?.kind || body.kind || 'HOLD',
          amountUsd: num(body.amountUsd) ?? 0,
          asset: body.asset || null,
          chain: body.chainId || body.chain || null,
          gasUsd: num(body.gasUsd),
          slippagePct: num(body.slippagePct),
          riskLevel: risk?.level || null
        }
      }).catch((err) => ({ ok: false, code: 'POLICY_EVAL_FAILED', detail: String(err?.message || err).slice(0, 120) }));
    }

    const decided = await fi.decisionEngine.decide({
      owner,
      intent: String(body.message || body.intent || '').trim() ? { message: String(body.message || body.intent).slice(0, MAX_TEXT) } : null,
      financial, world,
      strategies: rows,
      competition: comp.competition,
      simulation: sim.ok ? sim.simulation : null,
      risk,
      preferences: prefs,
      goal,
      globalIntel,
      crossAsset,
      smartMoney,
      routeSimulations: routeSims,
      policyVerdict,
      executionRequested,
      userConfirmed,
      authorizationScreenShown,
      guardianApproved,
      controls: body.controls || null,
      limits: body.limits || null,
      runtimeEvidence: body.runtimeEvidence || null,
      correlationId
    });
    if (!decided.ok) return reject(409, decided.code, decided.detail, { state: decided.state || null });

    /* The council judges the REAL decision (with its id), not a draft: the
       Guardian reads the decision's risk, capital and downside as recorded. */
    const decisionRow = decided.decision;
    const cnc = await fi.council.convene({
      owner,
      strategies: rows,
      preferences: prefs,
      goal,
      competition: comp,
      risk,
      financial,
      world,
      decision: decisionRow.decision ? { id: decisionRow.id, type: decisionRow.decision.type, riskLevel: decisionRow.decision.riskLevel, expectedReturnPct: decisionRow.decision.expectedReturnPct, capitalRequiredUsd: decisionRow.decision.amountUsd, downside: `modelled downside ${rows.find((r) => r.id === decisionRow.decision.strategyId)?.potentialLossPct ?? 'unmodelled'}%`, reversible: true } : null,
      goalSpec: goal,
      correlationId
    });

    return {
      ok: true,
      decision: decisionRow,
      trace: decided.trace,
      council: cnc.ok ? cnc.council : null,
      competition: comp.competition,
      simulation: sim.ok ? sim.simulation : null,
      routeSimulations: routeSims,
      liveSimulation: comp.competition?.liveSimulation === true,
      bestStrategyId: comp.competition?.judge?.winnerId || decisionRow?.decision?.strategyId || null,
      smartMoney: decisionRow.smartMoney || null,
      alternatives: decisionRow.alternatives,
      reason: decisionRow.reason,
      confidence: decisionRow.confidence,
      conditions: decisionRow.conditions,
      /* Authority — true only when every gate passed on this request. */
      executionPermission: decisionRow.executionPermission === true,
      guaranteed: decisionRow.guaranteed === true,
      returnGuaranteed: false,
      processGuaranteed: decisionRow.processGuaranteed === true,
      guaranteedNote: decisionRow.guaranteedNote || null,
      authority: decided.authority || decisionRow.authority || null,
      durable: fi.collections.durable()
    };
  }));

  /**
   * Confirm a previously-recommended decision and activate authority flags.
   * POST /api/ai/decision/:id/confirm
   *
   * Body gates (all required for executionPermission:true):
   *   userConfirmed, authorizationScreenShown, guardianApproved
   *   policyId | policyVerdict
   * Optional: controls, limits, runtimeEvidence, amountUsd, …
   *
   * Returns the patched decision with executionPermission / guaranteed
   * resolved. Still never signs; wallet hand-off is a separate step.
   */
  router.post('/decision/:id/confirm', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const got = await fi.decisionEngine.get(owner, req.params.id);
    if (!got.ok || !got.row) return reject(404, 'DECISION_NOT_FOUND', `no decision ${req.params.id} for this owner`, { id: req.params.id });

    const prior = got.row;
    const financial = await fi.financialStateFor(owner);
    const risk = fi.riskFor(owner);
    const prefs = await fi.preferences.resolve(owner);

    let policyVerdict = body.policyVerdict && typeof body.policyVerdict === 'object' ? body.policyVerdict : null;
    if (!policyVerdict && body.policyId && fi.policyEngine?.evaluate) {
      policyVerdict = await fi.policyEngine.evaluate({
        owner,
        policyId: body.policyId,
        request: {
          kind: prior.decision?.type || body.kind || 'HOLD',
          amountUsd: num(body.amountUsd) ?? num(prior.decision?.amountUsd) ?? 0,
          asset: body.asset || null,
          chain: body.chainId || body.chain || null,
          gasUsd: num(body.gasUsd),
          slippagePct: num(body.slippagePct),
          riskLevel: risk?.level || prior.decision?.riskLevel || null
        }
      }).catch((err) => ({ ok: false, code: 'POLICY_EVAL_FAILED', detail: String(err?.message || err).slice(0, 120) }));
    }
    if (!policyVerdict && body.policyOk === true) {
      /* Explicit one-shot ALLOW when the client already evaluated a policy
         out-of-band and only needs the authority flip recorded. */
      policyVerdict = { ok: true, decision: 'ALLOW', policyId: body.policyId || prior.policyId || 'oneshot' };
    }

    const { resolveExecutionAuthority, limitsFromContext } = await import('./executionAuthority.js');
    const authority = resolveExecutionAuthority({
      executionRequested: true,
      userConfirmed: body.userConfirmed === true || body.confirmed === true,
      authorizationScreenShown: body.authorizationScreenShown === true || body.authScreen === true,
      guardianApproved: body.guardianApproved === true,
      policyVerdict,
      confidence: prior.confidence || body.confidence || null,
      risk: risk || { level: prior.decision?.riskLevel },
      chosen: prior.decision,
      controls: body.controls || null,
      limits: body.limits || limitsFromContext({
        chosen: prior.decision,
        financial: financial?.status === 'UNAVAILABLE' ? null : financial,
        preferences: prefs,
        policyVerdict
      }),
      runtimeEvidence: body.runtimeEvidence || null,
      liveSimulation: prior.liveSimulation === true,
      now: Date.now()
    });

    const patched = {
      ...prior,
      updatedAt: Date.now(),
      status: authority.executionPermission ? 'AUTHORIZED' : prior.status,
      executionPermission: authority.executionPermission === true,
      executionAuthorized: authority.executionAuthorized === true,
      financialExecutionAuthorized: authority.financialExecutionAuthorized === true,
      automaticExecution: false,
      guaranteed: authority.guaranteed === true,
      returnGuaranteed: false,
      processGuaranteed: authority.processGuaranteed === true,
      guaranteedWhat: authority.guaranteedWhat || null,
      guaranteedNote: authority.guaranteedNote || null,
      authority: {
        status: authority.status,
        reason: authority.reason,
        blockers: authority.blockers,
        gates: authority.gates,
        checkedAt: authority.checkedAt
      },
      policyId: policyVerdict?.policyId || prior.policyId || null,
      confirmedAt: authority.executionPermission ? Date.now() : null,
      signs: false,
      submits: false
    };
    await fi.collections.put('decisions', owner, patched);
    return {
      ok: true,
      decision: patched,
      authority,
      executionPermission: patched.executionPermission,
      guaranteed: patched.guaranteed,
      returnGuaranteed: false,
      processGuaranteed: patched.processGuaranteed,
      guaranteedNote: patched.guaranteedNote,
      durable: fi.collections.durable()
    };
  }));

  router.get('/decision/:id', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const got = await fi.decisionEngine.get(owner, req.params.id);
    if (!got.ok) return reject(404, 'DECISION_NOT_FOUND', `no decision ${req.params.id} for this owner`, { id: req.params.id });
    return { ok: true, decision: got.row, durable: fi.collections.durable() };
  }));

  router.get('/decision/:id/evidence', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const bundle = await fi.evidence.bundle(owner, 'decision', req.params.id);
    if (!bundle.ok) return reject(404, bundle.code, 'no evidence is linked to that decision', { id: req.params.id });
    return { ok: true, decisionId: req.params.id, evidence: bundle.evidence, quality: bundle.quality, durable: fi.collections.durable() };
  }));

  router.get('/trace/:id', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const got = await fi.traceStore.get(owner, req.params.id);
    const trace = got.trace || got.row;
    if (!got.ok || !trace) return reject(404, got.code || 'TRACE_NOT_FOUND', `no trace ${req.params.id} for this owner`, { id: req.params.id });
    return { ok: true, trace: fi.traceStore.summary(trace), durable: fi.collections.durable() };
  }));

  /* ══════════════════════ evidence (the audit surface) ══════════════════════ */

  router.get('/evidence', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const type = req.query.type ? String(req.query.type).toLowerCase() : null;
    const rows = await fi.evidence.recent(owner, {
      limit: Math.min(100, Math.max(1, Number(req.query.limit) || 40)),
      type
    });
    return { ok: true, evidence: rows, count: rows.length, durable: fi.collections.durable() };
  }));

  router.get('/evidence/:id', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const got = await fi.evidence.get(owner, req.params.id);
    if (!got.ok) return reject(404, 'EVIDENCE_NOT_FOUND', `no evidence ${req.params.id} for this owner`, { id: req.params.id });
    return { ok: true, evidence: got.row, durable: fi.collections.durable() };
  }));

  /* ══════════════════════ policies (the authority) ══════════════════════ */

  router.get('/policies', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const st = await fi.policyEngine.status(owner);
    return { ok: true, ...st, durable: fi.collections.durable() };
  }));

  router.get('/policies/:id', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const got = await fi.policyEngine.get(owner, req.params.id);
    if (!got.ok) return reject(404, got.code, `no policy ${req.params.id} for this owner`, { id: req.params.id });
    return { ok: true, policy: got.policy, durable: fi.collections.durable() };
  }));

  router.post('/policies', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const p = body.policy || body;
    if (num(p.maxDailyUsd) === null || num(p.maxCumulativeUsd) === null) {
      return reject(400, 'LIMITS_REQUIRED', 'a policy without daily and lifetime ceilings is not a scope; name the limits');
    }
    const out = await fi.policyEngine.create(owner, p);
    return out.ok ? { ok: true, policy: out.policy, durable: out.durable } : reject(409, out.code, out.detail || null, { errors: out.errors || null });
  }));

  /* The STOP button for one policy. `by` is always 'user' on this surface —
     the machine has no API route to stop itself; the stop comes through a
     human clicking, which is the whole point. */
  router.post('/policies/:id/stop', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.policyEngine.emergencyStop(owner, { policyId: req.params.id, reason: String(body.reason || 'stopped by the user').slice(0, 160), by: 'user' });
    if (!out.ok) return reject(409, out.code, out.detail || null);
    return { ok: true, stopped: out.stopped, durable: fi.collections.durable() };
  }));

  router.post('/policies/stop', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.policyEngine.emergencyStop(owner, { policyId: null, reason: String(body.reason || 'stopped by the user').slice(0, 160), by: 'user' });
    if (!out.ok) return reject(409, out.code, out.detail || null, { stopped: out.stopped || [] });
    return { ok: true, stopped: out.stopped, count: (out.stopped || []).length, scope: out.scope, durable: fi.collections.durable() };
  }));

  router.post('/policies/:id/resume', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.policyEngine.resume(owner, req.params.id, { by: 'user', reason: body.reason ? String(body.reason).slice(0, 160) : null });
    return out.ok ? { ok: true, policy: out.policy, durable: out.durable } : reject(409, out.code, out.detail || null);
  }));

  router.post('/policies/:id/revoke', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.policyEngine.revoke(owner, req.params.id, { reason: body.reason ? String(body.reason).slice(0, 160) : null });
    return out.ok ? { ok: true, policy: out.policy, durable: out.durable } : reject(409, out.code, out.detail || null);
  }));

  /* ══════════════════════ autonomy ══════════════════════ */

  router.get('/autonomy', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    return { ok: true, capabilities: fi.autonomy.capabilities(), durable: fi.collections.durable() };
  }));

  router.post('/autonomy/run', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const request = body.request || (body.kind ? body : {});
    const policyId = body.policyId;
    if (!policyId) return reject(400, 'POLICY_ID_REQUIRED', 'a run is an execution under a standing policy; name the policy');
    if (!request.kind || num(request.amountUsd) === null) {
      return reject(400, 'INCOMPLETE_REQUEST', 'the run needs at least kind and amountUsd; the loop will not fill in the rest');
    }
    const amount = num(request.amountUsd);
    if (amount <= 0 || amount > MAX_AMOUNT) return reject(400, 'AMOUNT_INVALID', `amount must be in (0, ${MAX_AMOUNT}]`);

    const financial = await fi.financialStateFor(owner);
    const world = await fi.worldModelFor(owner);
    const risk = fi.riskFor(owner, world);

    const report = await fi.autonomy.run({
      owner,
      policyId,
      request,
      financial: financial.status === 'UNAVAILABLE' ? null : financial,
      world,
      risk,
      decision: body.decision || null,
      correlationId: body.correlationId || req.get?.('x-fbt-request-id') || null
    });
    return {
      ok: report.ok,
      report,
      state: report.state,
      stopGate: report.stopGate,
      stopCode: report.stopCode,
      executedNothing: report.executedNothing,
      verificationId: report.verificationId,
      capabilities: fi.autonomy.capabilities(),
      durable: fi.collections.durable()
    };
  }));

  /* ══════════════════════ guardian + replan ══════════════════════ */

  router.get('/guardian/status', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    return fi.guardian.status(owner);
  }));

  /* The durable event feed: every material change, warning and stop. */
  router.get('/guardian/events', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.guardian.events(owner, { limit: Number(req.query.limit) || 40 });
    return { ok: true, ...out };
  }));

  router.post('/guardian/check', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const financial = await fi.financialStateFor(owner);
    const out = await fi.guardian.check({
      owner,
      financial: financial.status === 'UNAVAILABLE' ? null : financial,
      goalProgress: body.goalProgress || null,
      strategy: body.strategy || null,
      profile: body.profile || (await fi.preferences.resolve(owner)),
      correlationId: body.correlationId || null
    });
    return out.ok ? { ok: true, ...out, durable: fi.collections.durable() } : reject(409, out.code, out.detail || null);
  }));

  router.post('/replan', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.guardian.replan({
      owner,
      strategy: body.strategy || null,
      changes: body.changes || null,
      warnings: body.warnings || null,
      triggers: Array.isArray(body.triggers) ? body.triggers.slice(0, 12) : [],
      goalProgress: body.goalProgress || null,
      context: body.context || {},
      correlationId: body.correlationId || null
    });
    return out.ok ? { ok: true, replan: out, durable: fi.collections.durable() } : reject(409, out.code, out.detail || null);
  }));

  /* ══════════════════════ council (persisted disagreement) ══════════════════════ */

  router.get('/council', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.council.recent(owner, { limit: Math.min(30, Math.max(1, Number(req.query.limit) || 10)) });
    return { ok: true, councils: out.records, durable: fi.collections.durable() };
  }));

  router.get('/council/:id', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const got = await fi.council.get(owner, req.params.id);
    if (!got.ok) return reject(404, got.code, `no council ${req.params.id} for this owner`, { id: req.params.id });
    return { ok: true, council: got.record, durable: fi.collections.durable() };
  }));

  /* ══════════════════════ external agents (the registry) ══════════════════════ */

  router.get('/external-agents', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.agents.list(owner);
    return { ok: true, agents: out.agents, count: out.count, durable: fi.collections.durable() };
  }));

  router.get('/external-agents/:id', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const got = await fi.agents.get(owner, req.params.id);
    if (!got.ok) return reject(404, got.code, `no agent ${req.params.id} for this owner`, { id: req.params.id });
    return { ok: true, agent: got.record, durable: fi.collections.durable() };
  }));

  router.post('/external-agents', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.agents.register(owner, body);
    return out.ok ? { ok: true, agent: out.agent, durable: out.durable } : reject(409, out.code, out.detail || null);
  }));

  router.post('/external-agents/:id/interaction', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    if (typeof body.ok !== 'boolean') return reject(400, 'OK_REQUIRED', 'an interaction is a success or a failure');
    const out = await fi.agents.recordInteraction(owner, req.params.id, body);
    if (!out.ok && out.code) return reject(404, out.code, out.detail || null);
    return { ok: true, counted: out.counted, reason: out.reason || null, trust: out.trust || null, durable: fi.collections.durable() };
  }));

  router.post('/external-agents/:id/authorize', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.agents.authorize(owner, req.params.id, { scope: body.scope || 'council-vote', by: 'user' });
    return out.ok ? { ok: true, agent: out.agent, durable: out.durable } : reject(409, out.code, out.detail || null, { score: out.score ?? null, required: out.required ?? null });
  }));

  router.post('/external-agents/:id/revoke', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = await fi.agents.revoke(owner, req.params.id, { reason: body.reason ? String(body.reason).slice(0, 160) : null });
    return out.ok ? { ok: true, agent: out.agent, durable: out.durable } : reject(409, out.code, out.detail || null);
  }));

  /* ══════════════════════ learning ══════════════════════ */

  router.get('/learning', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.learning.history(owner, { limit: Math.min(40, Math.max(1, Number(req.query.limit) || 10)) });
    return { ok: true, outcomes: out.outcomes, durable: fi.collections.durable() };
  }));

  /* Explicit outcomes alias (§14/§15): prediction → actual → error → lesson. */
  router.get('/learning/outcomes', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.learning.history(owner, { limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20)) });
    return { ok: true, outcomes: out.outcomes, count: (out.outcomes || []).length, durable: fi.collections.durable() };
  }));

  router.get('/learning/calibration', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    return fi.learning.calibration(owner);
  }));

  router.post('/learning', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const execution = body.execution || (body.verified !== undefined ? body : {});
    if (execution.verified !== true) {
      return reject(422, 'OUTCOME_NOT_VERIFIED', 'learning reads only verified completions; say so with verificationId once the chain confirms');
    }
    const out = await fi.learning.learn(owner, { execution, correlationId: body.correlationId || null });
    return out.ok ? { ok: true, record: out.record, lessons: out.lessons, failures: out.failures, durable: out.durable } : reject(409, out.code, out.detail || null);
  }));

  /* ══════════════════════ preferences ══════════════════════ */

  router.get('/preferences', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const p = await fi.preferences.resolve(owner);
    return { ok: true, preferences: p, durable: fi.collections.durable() };
  }));

  router.post('/preferences/statement', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const text = String(body.text || '');
    if (!text.trim()) return reject(400, 'TEXT_REQUIRED', 'the sentence to remember is required');
    const out = await fi.preferences.learnFromStatement(owner, text.slice(0, MAX_TEXT));
    return out.ok ? { ok: true, written: out.written, preferences: out.preferences, durable: fi.collections.durable() } : reject(422, out.code, out.detail || null);
  }));

  /* ══════════════════════ Phase 211: GLOBAL AI INTELLIGENCE ══════════════════════
   * All additive routes. The FI router deliberately does not own /agents or
   * /status (those belong to the command center); these live under
   * /global/* — /api/ai/global/intelligence, /global/briefing,
   * /global/cross-asset, /global/providers — and every response says what was
   * actually read (per-domain status + missing[]) instead of promising. */

  router.get('/global/intelligence', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const refresh = String(req.query.refresh || '') === '1' || String(req.query.refresh || '').toLowerCase() === 'true';
    const snapshot = await fi.globalIntelFor(owner, { refresh });
    return {
      ok: true,
      schema: snapshot.schema,
      globalIntelligence: snapshot,
      durable: fi.collections.durable()
    };
  }));

  router.get('/global/briefing', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const refresh = String(req.query.refresh || '') === '1' || String(req.query.refresh || '').toLowerCase() === 'true';
    const briefing = await fi.briefingFor(owner, { refresh });
    return {
      ok: true,
      schema: briefing.schema,
      briefing,
      durable: fi.collections.durable()
    };
  }));

  router.get('/global/cross-asset', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    /* The AI commentary follows the caller's language (Accept-Language, fa
       default — this surface is Persian-first). */
    const al = String(req.get?.('accept-language') || req.query.lang || 'fa').toLowerCase();
    const language = al.split(',').map((s) => s.trim().split('-')[0]).find((c) => ['fa', 'en'].includes(c)) || 'fa';
    const refresh = String(req.query.refresh || '') === '1' || String(req.query.refresh || '').toLowerCase() === 'true';
    const analysis = await fi.crossAssetFor(owner, { refresh, language });
    return {
      ok: true,
      schema: analysis.schema,
      crossAsset: analysis,
      digest: fi.crossAsset.digest(analysis),
      durable: fi.collections.durable()
    };
  }));

  /* The readiness lights per domain — implemented · configured ·
   * provider_available · runtime_ready · live — from the LAST real snapshot
   * (a live:true is a result this process actually produced). */
  router.get('/global/providers', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const snapshot = await fi.globalIntelFor(owner, {});
    return {
      ok: true,
      schema: snapshot.schema,
      providers: snapshot.providers,
      domains: Object.fromEntries(Object.entries(snapshot.domains || {}).map(([k, v]) => [k, { status: v.status, source: v.source, reason: v.reason, at: v.at }])),
      coverage: snapshot.coverage,
      available: snapshot.available,
      missing: snapshot.missing,
      durable: fi.collections.durable()
    };
  }));

  /* ══════════════════════ Phase 212: DEEP INTELLIGENCE ══════════════════════
   * مغز تصمیم‌گیری. All additive, all read-only (the only writes are the
   * engines' own persistence rows), every response carrying what was actually
   * read. Routes:
   *   GET  /deep/status                  every engine + flag + bus attach state
   *   GET  /deep/macro-graph             the transmission graph + why-riskier
   *   GET  /deep/why/:decisionId         the why block of a decision
   *   GET  /deep/profile                 the personal financial profile
   *   GET  /deep/wallet-context          the universal wallet context
   *   GET  /deep/evaluation/due          decisions due for self-review
   *   POST /deep/evaluation/review       evaluate one decision (actuals in)
   *   GET  /deep/evaluation/regimes      per-regime prediction error stats
   *   POST /deep/agent-council           convene the domain agents (BUY/HOLD/SELL)
   *   POST /deep/goal-scenarios          Conservative/Balanced/Aggressive plan
   *   POST /deep/goal-scenarios/what-if  the four named what-ifs (real math)
   *   POST /deep/opportunities/fit       score one/ranked list vs the profile
   *   POST /deep/conversation/ingest     one message into the state machine
   *   POST /deep/conversation/advance    a legal transition
   *   GET  /deep/conversation            the active conversation + next question
   *   POST /deep/goal-reasoning          text → structured goal constraints
   *   GET  /deep/agents/runtime          session/kill-switch status
   *   POST /deep/agents/sessions         open an agent session (scoped, expiring)
   *   POST /deep/agents/call             check a tool call (scope+rate+kill)
   *   POST /deep/agents/kill             trip the kill switch
   *   POST /deep/events/replan           run/see event-driven replanning
   */

  router.get('/deep/status', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    return {
      ok: true,
      deepIntelligence: {
        macroGraph: true,
        whyEngine: true,
        personalProfile: true,
        evaluation: true,
        agentCouncil: true,
        goalScenarios: true,
        opportunityFit: true,
        conversationState: true,
        walletContext: true,
        agentRuntime: true,
        eventReplanning: true,
        goalReasoning: true
      },
      flags: fiFlags(),
      durable: fi.collections.durable(),
      executionAuthorized: false
    };
  }));

  router.get('/deep/macro-graph', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.macroGraphFor(owner);
    if (!out.ok) return reject(409, out.code || 'MACRO_GRAPH_UNAVAILABLE', out.detail || null);
    const asset = String(req.query.asset || req.query.why || '').toUpperCase();
    return {
      ok: true,
      schema: out.graph.schema,
      graph: fi.macroGraphDigest ? fi.macroGraphDigest(out.graph) : out.record,
      coverage: out.graph.coverage,
      portfolioRiskImpulse: out.graph.portfolioRiskImpulse,
      whyRiskier: asset ? out.graph.whyRiskier(asset.toLowerCase()) : out.graph.whyPortfolioRiskier(),
      durable: fi.collections.durable()
    };
  }));

  router.get('/deep/why/:decisionId', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const stored = await fi.whyEngine.forDecision(owner, req.params.decisionId);
    if (stored) return { ok: true, why: stored, source: 'stored', durable: fi.collections.durable() };
    const decision = await fi.decisionEngine.get(owner, req.params.decisionId).catch(() => null);
    if (!decision?.row && !decision?.id) return reject(404, 'DECISION_NOT_FOUND', `no decision ${req.params.decisionId} for this owner`);
    const row = decision.row || decision;
    const financial = await fi.financialStateFor(owner).catch(() => null);
    const prefs = await fi.preferences.resolve(owner).catch(() => null);
    const out = await fi.whyEngine.explain(owner, {
      decision: row,
      strategies: [],
      simulation: null,
      preferences: prefs
    }, { persist: true });
    return out.ok ? { ok: true, why: out.why, source: 'rebuilt', durable: fi.collections.durable() } : reject(409, out.code, out.detail);
  }));

  router.get('/deep/profile', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.personalProfile.profileFor(owner, { goal: req.query.goal ? { months: Number(req.query.goal) || null } : null });
    if (!out.ok) return reject(409, out.code || 'PROFILE_UNAVAILABLE', out.flag || null);
    return { ok: true, profile: out.profile, durable: fi.collections.durable() };
  }));

  router.get('/deep/wallet-context', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const context = await fi.walletContext.contextFor(owner);
    return {
      ok: context.status !== 'UNAVAILABLE',
      ...(context.status === 'UNAVAILABLE' ? { code: 'NO_WALLET_SECTION_READ', detail: context.reason } : {}),
      walletContext: context,
      durable: fi.collections.durable()
    };
  }));

  router.get('/deep/evaluation/due', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.evaluation.reviewDue(owner, { limit: Math.min(50, Math.max(1, Number(req.query.limit) || 20)) });
    return { ok: true, due: out.due || [], count: out.count || 0, durable: fi.collections.durable() };
  }));

  router.post('/deep/evaluation/review', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    if (!body.decisionId) return reject(400, 'DECISION_ID_REQUIRED', 'the decision to review is required');
    const got = await fi.decisionEngine.get(owner, body.decisionId).catch(() => null);
    const decision = got?.row || got;
    if (!decision?.id) return reject(404, 'DECISION_NOT_FOUND', `no decision ${body.decisionId} for this owner`);
    const out = await fi.evaluation.evaluate(owner, {
      decision,
      actual: {
        returnPct: num(body.returnPct),
        drawdownPct: num(body.drawdownPct),
        slippagePct: num(body.slippagePct),
        pnlUsd: num(body.pnlUsd),
        amountUsd: num(body.amountUsd),
        executionId: body.executionId || null,
        verified: body.verified === true
      }
    });
    return out.ok ? { ok: true, evaluation: out.row, durable: fi.collections.durable() } : reject(409, out.code, out.detail || 'OUTCOME_UNREADABLE');
  }));

  router.get('/deep/evaluation/regimes', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const regimes = await fi.evaluation.regimes(owner);
    return { ok: true, regimes, durable: fi.collections.durable() };
  }));

  router.post('/deep/agent-council', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const globalIntel = await fi.globalIntelFor(owner).catch(() => null);
    const financial = await fi.financialStateFor(owner).catch(() => null);
    const world = await fi.worldModelFor(owner).catch(() => null);
    const crossAsset = await fi.crossAssetFor(owner, {}).catch(() => null);
    const profile = await fi.personalProfile.profileFor(owner, {}).catch(() => null);
    const macro = await fi.macroGraphFor(owner).catch(() => null);
    const domains = globalIntel?.domains || {};
    const marketValue = world?.domains?.market?.value ?? null;
    const out = await fi.agentCouncil.convene(owner, {
      asset: String(body.asset || 'BTC').toUpperCase(),
      market: marketValue?.value ?? marketValue,
      risk: fi.riskFor(owner, world),
      financial,
      profile: profile?.ok ? profile.profile : null,
      goal: body.goal || null,
      smartMoney: domains.smart_money?.status === 'OK' ? domains.smart_money : null,
      crossAsset,
      news: domains.news?.status === 'OK' ? domains.news.data : null,
      onchain: domains.onchain?.status === 'OK' ? domains.onchain.data : null,
      macroGraph: macro?.ok ? macro.graph : null,
      whales: domains.whales?.status === 'OK' ? domains.whales : null,
      costs: body.costs || null,
      securitySignals: fi.riskFor(owner, world)?.securitySignals || null,
      defi: body.defi || null
    });
    return out.ok ? { ok: true, council: out.council, durable: fi.collections.durable() } : reject(409, out.code, out.flag || null);
  }));

  router.post('/deep/goal-scenarios', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const financial = await fi.financialStateFor(owner).catch(() => null);
    const out = await fi.goalScenarios.scenariosFor(owner, {
      goal: body.goal || { targetUsd: num(body.targetUsd), months: num(body.months), maxDrawdownPct: num(body.maxDrawdownPct), monthlyContributionUsd: num(body.monthlyContributionUsd) },
      financial,
      liveYieldPct: num(body.liveYieldPct)
    });
    return out.ok ? { ok: true, scenarios: out, durable: fi.collections.durable() } : reject(409, out.code, out.detail);
  }));

  router.post('/deep/goal-scenarios/what-if', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const financial = await fi.financialStateFor(owner).catch(() => null);
    const out = await fi.goalScenarios.whatIfsFor(owner, { sections: fi.flatSectionsFor(owner), financial });
    return out.ok ? { ok: true, whatIfs: out.whatIfs, estimate: true, durable: fi.collections.durable() } : reject(409, out.code, out.reason);
  }));

  router.post('/deep/opportunities/fit', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const profile = await fi.personalProfile.profileFor(owner, { goal: body.goal || null });
    if (!profile.ok) return reject(409, profile.code || 'PROFILE_UNAVAILABLE', profile.flag || null);
    const financial = await fi.financialStateFor(owner).catch(() => null);
    if (Array.isArray(body.opportunities)) {
      const out = await fi.opportunityFit.rankFor(owner, { opportunities: body.opportunities, profile: profile.profile, financial, goal: body.goal || null });
      return { ok: true, ranked: out.ranked, count: out.count, durable: fi.collections.durable() };
    }
    if (!body.opportunity || typeof body.opportunity !== 'object') {
      return reject(400, 'OPPORTUNITY_REQUIRED', 'one opportunity (or opportunities[]) is required');
    }
    const out = await fi.opportunityFit.score(owner, { opportunity: body.opportunity, profile: profile.profile, financial, goal: body.goal || null });
    return out.ok ? { ok: true, fit: out.fit, durable: fi.collections.durable() } : reject(409, out.code, out.detail);
  }));

  router.post('/deep/conversation/ingest', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const message = String(body.message || '').slice(0, MAX_TEXT);
    if (!message.trim()) return reject(400, 'MESSAGE_REQUIRED');
    const goalReasoning = fi.goalReasoning.reason(message);
    const out = await fi.conversationState.ingest(owner, {
      message,
      locale: body.locale || 'fa',
      goalReasoning,
      patch: body.patch || {}
    });
    return out.ok
      ? { ok: true, conversation: out.conversation, suggestion: out.suggestion, question: out.question, goalReasoning, durable: fi.collections.durable() }
      : reject(409, out.code, out.flag || null);
  }));

  router.post('/deep/conversation/advance', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    if (!body.to) return reject(400, 'TARGET_STATE_REQUIRED', 'to is required');
    const out = await fi.conversationState.advance(owner, { to: body.to, note: body.note || null, patch: body.patch || {} });
    return out.ok ? { ok: true, conversation: out.conversation, durable: fi.collections.durable() } : reject(422, out.code, out.detail || null, { allowed: out.allowed || null, from: out.from || null });
  }));

  router.get('/deep/conversation', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const out = await fi.conversationState.active(owner, { locale: 'fa' });
    if (!out.ok) return reject(409, out.code, null);
    const { suggestNextState, nextAdaptiveQuestion } = await import('./conversationState.js');
    return {
      ok: true,
      conversation: out.conversation,
      suggestion: suggestNextState(out.conversation, out.conversation.context || {}),
      question: nextAdaptiveQuestion(out.conversation.state, out.conversation.context || {}),
      states: (await import('./conversationState.js')).CONVERSATION_STATES,
      durable: fi.collections.durable()
    };
  }));

  router.post('/deep/goal-reasoning', route(async (req, res, owner) => {
    const body = req.body || {};
    const text = String(body.text || body.message || '').slice(0, MAX_TEXT);
    if (!text.trim()) return reject(400, 'TEXT_REQUIRED');
    const prefs = await fi.preferences.resolve(owner).catch(() => null);
    const reasoning = fi.goalReasoning.reason(text, { preferences: prefs });
    return {
      ok: true,
      reasoning,
      requiredAnnualizedPct: fi.goalReasoning.requiredAnnualizedPct({ targetReturnPct: reasoning.targetReturnPct, horizonMonths: reasoning.horizonMonths }),
      durable: fi.collections.durable()
    };
  }));

  router.get('/deep/agents/runtime', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    return { ok: true, runtime: fi.agentRuntime.status(owner), agents: (await fi.agents.list(owner).catch(() => ({ agents: [] }))).agents || [], durable: fi.collections.durable() };
  }));

  router.post('/deep/agents/sessions', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    if (!body.agentId) return reject(400, 'AGENT_ID_REQUIRED');
    const out = await fi.agentRuntime.openSession(owner, {
      agentId: body.agentId,
      scopes: Array.isArray(body.scopes) ? body.scopes : null,
      ttlMs: num(body.ttlMs),
      by: 'user'
    });
    return out.ok ? { ok: true, session: out.session, key: out.key, denied: out.denied || null, expiresAt: out.expiresAt } : reject(409, out.code, out.detail || null);
  }));

  router.post('/deep/agents/call', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    if (!body.key || !body.scope) return reject(400, 'KEY_AND_SCOPE_REQUIRED');
    const out = await fi.agentRuntime.checkToolCall(owner, { key: body.key, scope: body.scope, agentId: body.agentId || null });
    return out.ok ? { ok: true, call: out.session } : reject(403, out.code, out.detail || null, { granted: out.granted || null, allowed: out.allowed || null });
  }));

  router.post('/deep/agents/kill', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    const out = body.clear === true
      ? await fi.agentRuntime.clearKillSwitch(owner, { agentId: body.agentId || null })
      : await fi.agentRuntime.tripKillSwitch(owner, { agentId: body.agentId || null, reason: body.reason || 'user' });
    return { ok: true, killSwitch: out, runtime: fi.agentRuntime.status(owner) };
  }));

  router.post('/deep/events/replan', route(async (req, res, owner) => {
    await ensureMigrated(owner);
    const body = req.body || {};
    if (body.trigger) {
      const out = await fi.eventReplanning.replan(owner, { trigger: String(body.trigger).toUpperCase(), payload: body.payload || {} });
      return out.ok ? { ok: true, replan: out.replan || null, skipped: out.skipped === true || null, durable: fi.collections.durable() } : reject(409, out.code, out.flag || null);
    }
    const recent = fi.eventReplanning.recent(owner, { limit: Math.min(50, Math.max(1, Number(body.limit) || 20)) });
    return { ok: true, attempts: recent.attempts, triggers: fi.eventReplanning.TRIGGERS, durable: fi.collections.durable() };
  }));

  return router;
}
