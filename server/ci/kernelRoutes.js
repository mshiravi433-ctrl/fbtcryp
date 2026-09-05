/**
 * FBT FINANCIAL OS — Kernel HTTP surface (Upgrade 10 §42, §45, §52, §53).
 * ---------------------------------------------------------------------------
 * Mounted under the SAME `/api/brain` gateway as the rest of the Central
 * Intelligence OS, so the frontend still speaks to exactly one origin and
 * inherits the same rate budget, the same owner derivation and the same error
 * envelope. Adding a second gateway would have re-created the fragmentation
 * Upgrade 10 exists to remove.
 *
 *   GET/PATCH/DELETE /financial/profile      §9  the profile, editable + resettable
 *   GET/POST         /financial/goals        §7  Goal OS
 *   PATCH/DELETE     /financial/goals/:id
 *   GET             /financial/state         §8  the financial state
 *   POST            /financial/advise        §10–§12 ranked decisions + council
 *   POST            /financial/scenarios     §14
 *   POST            /financial/project       §15 Monte Carlo
 *   GET             /financial/optimize      §13
 *   POST            /financial/twin          §47 Financial Twin
 *   GET             /financial/monitor       §28/§29
 *   POST            /financial/outcome       §25 outcome learning
 *   GET             /financial/calibration   §35
 *   GET/POST/DELETE /permissions             §45 Permission Center
 *   POST            /permissions/mode        §46 autonomy
 *   GET/POST        /kill-switch             §57
 *   GET/POST/DELETE /memory                  §22–§24
 *   GET             /evaluation              §61
 *
 * EVERY MUTATING ROUTE HERE IS NON-FINANCIAL. Not one of them can move a token:
 * the money path is `/intent` → confirm → wallet signature, unchanged. These
 * routes edit the user's own preferences, goals and permissions.
 */
import { Router } from 'express';
import { CI_SCHEMA } from '../../src/lib/central/schema.js';
import { MEMORY_KIND_IDS } from '../../src/lib/central/memory.js';
import { SCOPE_IDS, AUTONOMY_MODE_IDS, KILL_SWITCH_IDS } from '../../src/lib/central/permission.js';

export const KERNEL_ROUTES_SCHEMA = 'fbt.kernel-routes.v1';

/** Writes are cheap but not free; a bounded body keeps a hostile client cheap too. */
const MAX_BODY_FIELDS = 24;

export function mountKernelRoutes({ router = Router(), kernel, ownerFor, log = () => {} } = {}) {
  const wrap = (handler) => async (req, res) => {
    try {
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > MAX_BODY_FIELDS) {
        return res.status(400).json({ ok: false, code: 'BODY_TOO_LARGE', detail: `at most ${MAX_BODY_FIELDS} top-level fields` });
      }
      const out = await handler(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
      return undefined;
    } catch (error) {
      log('kernel-route-error', String(error?.message || error).slice(0, 160));
      if (!res.headersSent) res.status(500).json({ ok: false, code: 'KERNEL_ERROR', brain: CI_SCHEMA, detail: String(error?.message || error).slice(0, 160) });
      return undefined;
    }
  };
  const owner = (req) => ownerFor(req);

  /* ── profile ─────────────────────────────────────────────────────── */
  router.get('/financial/profile', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA, brain: CI_SCHEMA,
    profile: kernel.getProfile(owner(req)),
    gaps: kernel.profileGaps(owner(req))
  })));

  router.patch('/financial/profile', wrap(async (req) => {
    const origin = req.body?.origin === 'inferred' ? 'inferred' : 'stated';
    const { origin: _drop, ...patch } = req.body || {};
    void _drop;
    const res = kernel.patchProfile(owner(req), patch, { origin });
    return { ok: res.ok !== false, schema: KERNEL_ROUTES_SCHEMA, ...res };
  }));

  router.delete('/financial/profile', wrap(async (req) => {
    const keys = Array.isArray(req.body?.fields) ? req.body.fields : null;
    return { ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.clearProfile(owner(req), keys) };
  }));

  /* ── goals ───────────────────────────────────────────────────────── */
  router.get('/financial/goals', wrap(async (req) => ({ ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.listGoals(owner(req)) })));

  router.post('/financial/goals', wrap(async (req, res) => {
    const out = kernel.addGoal(owner(req), req.body || {});
    if (!out.ok) return res.status(400).json({ ok: false, schema: KERNEL_ROUTES_SCHEMA, ...out });
    return res.status(201).json({ ok: true, schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  router.patch('/financial/goals/:goalId', wrap(async (req, res) => {
    const out = kernel.updateGoal(owner(req), String(req.params.goalId), req.body || {});
    return res.status(out.ok ? 200 : 404).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  router.delete('/financial/goals/:goalId', wrap(async (req, res) => {
    const out = kernel.removeGoal(owner(req), String(req.params.goalId));
    return res.status(out.ok ? 200 : 404).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  /* ── financial state, decisions, simulation ──────────────────────── */
  router.get('/financial/state', wrap(async (req) => ({ ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.assess(owner(req)) })));

  router.post('/financial/advise', wrap(async (req, res) => {
    const out = kernel.advise(owner(req), {
      goalId: req.body?.goalId || null,
      weightOverrides: req.body?.weights || null
    });
    return res.status(out.status === 'OK' ? 200 : 409).json({ ok: out.status === 'OK', schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  router.post('/financial/scenarios', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA,
    ...kernel.scenarios(owner(req), { custom: Array.isArray(req.body?.custom) ? req.body.custom.slice(0, 6) : [] })
  })));

  router.post('/financial/project', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA,
    ...kernel.project(owner(req), {
      months: req.body?.months, expectedReturnPct: req.body?.expectedReturnPct,
      volatilityPct: req.body?.volatilityPct, monthlyContributionUsd: req.body?.monthlyContributionUsd,
      paths: req.body?.paths, seed: req.body?.seed
    })
  })));

  router.get('/financial/optimize', wrap(async (req) => ({ ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.optimize(owner(req)) })));

  router.post('/financial/twin', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA,
    ...kernel.twin(owner(req), {
      change: req.body?.change || {},
      horizonsMonths: Array.isArray(req.body?.horizonsMonths) ? req.body.horizonsMonths.slice(0, 5) : [3, 6, 12]
    })
  })));

  /* ── strategy, monitoring, learning ──────────────────────────────── */
  router.post('/financial/strategies', wrap(async (req, res) => {
    const out = kernel.registerStrategy(owner(req), req.body || {});
    return res.status(out.ok ? 201 : 400).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  router.post('/financial/strategies/:id/transition', wrap(async (req, res) => {
    const out = kernel.moveStrategy(owner(req), String(req.params.id), req.body?.state, String(req.body?.reason || ''));
    return res.status(out.ok ? 200 : 409).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  router.get('/financial/monitor', wrap(async (req) => ({ ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.monitor(owner(req)) })));

  router.post('/financial/outcome', wrap(async (req, res) => {
    const out = kernel.recordOutcome(owner(req), { decision: req.body?.decision || null, actual: req.body?.actual || {} });
    return res.status(out.status === 'OK' ? 200 : 400).json({ ok: out.status === 'OK', schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  router.get('/financial/calibration', wrap(async (req) => ({ ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.calibration(owner(req)) })));

  /* ── permissions + autonomy ──────────────────────────────────────── */
  router.get('/permissions', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA,
    ...kernel.permissions.table(owner(req)),
    audit: kernel.permissions.auditTrail(owner(req), 30)
  })));

  router.post('/permissions', wrap(async (req, res) => {
    const out = kernel.permissions.grant(owner(req), req.body?.scope, {
      ttlMs: req.body?.ttlMs, limitUsd: req.body?.limitUsd, reason: req.body?.reason
    });
    return res.status(out.ok ? 200 : 400).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, scopes: SCOPE_IDS, ...out });
  }));

  router.delete('/permissions', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.permissions.revoke(owner(req), req.body?.scope || null)
  })));

  router.post('/permissions/mode', wrap(async (req, res) => {
    const out = kernel.permissions.setMode(owner(req), req.body?.mode);
    return res.status(out.ok ? 200 : 400).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, modes: AUTONOMY_MODE_IDS, ...out });
  }));

  router.post('/permissions/check', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA,
    ...kernel.authorize(owner(req), { scope: req.body?.scope, amountUsd: req.body?.amountUsd ?? null, actionId: req.body?.actionId || null })
  })));

  /* ── kill switches ───────────────────────────────────────────────── */
  router.get('/kill-switch', wrap(async () => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.killSwitches.status(), history: kernel.killSwitches.history(20)
  })));

  router.post('/kill-switch', wrap(async (req, res) => {
    const engage = req.body?.engaged !== false;
    const out = engage
      ? kernel.killSwitches.engage(req.body?.id, { reason: req.body?.reason, by: req.body?.by || 'user', target: req.body?.target })
      : kernel.killSwitches.disengage(req.body?.id, { reason: req.body?.reason, by: req.body?.by || 'user' });
    return res.status(out.ok ? 200 : 400).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, switches: KILL_SWITCH_IDS, ...out });
  }));

  /* ── memory ──────────────────────────────────────────────────────── */
  router.get('/memory', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA, kinds: MEMORY_KIND_IDS,
    stats: kernel.memory.stats(owner(req)),
    records: kernel.memory.exportAll(owner(req)).slice(0, 60)
  })));

  router.post('/memory/retrieve', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA,
    ...kernel.memory.retrieve(owner(req), {
      text: String(req.body?.text || '').slice(0, 400),
      tags: Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 8) : [],
      limit: req.body?.limit
    })
  })));

  router.post('/memory/promote', wrap(async (req, res) => {
    const out = kernel.memory.promote(owner(req), String(req.body?.id || ''), { confirmedByUser: req.body?.confirmedByUser === true });
    return res.status(out.ok ? 200 : 400).json({ ok: out.ok, schema: KERNEL_ROUTES_SCHEMA, ...out });
  }));

  router.delete('/memory', wrap(async (req) => ({
    ok: true, schema: KERNEL_ROUTES_SCHEMA,
    ...kernel.memory.forget(owner(req), { id: req.body?.id || null, kind: req.body?.kind || null, key: req.body?.key || null })
  })));

  /* ── evaluation ──────────────────────────────────────────────────── */
  router.get('/evaluation', wrap(async (req) => ({ ok: true, schema: KERNEL_ROUTES_SCHEMA, ...kernel.evaluationSnapshot(owner(req)) })));

  return router;
}

export default mountKernelRoutes;
