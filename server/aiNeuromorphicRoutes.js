/**
 * FBT NEUROMORPHIC 2050 — ADDITIVE HTTP ROUTES
 * ===========================================================================
 * Mounted at `/api/v1/ai` alongside `aiOrchestratorRoutes` and `aiBenchmarkRoutes`.
 *
 * Endpoints:
 *   GET  /neuromorphic/status   Swarm generation, active nodes, caller XP & laws
 *   GET  /neuromorphic/genome   Latest 1,159-parameter global genome (bandwidth-aware)
 *   POST /neuromorphic/delta    Submit verified on-device walk-forward synaptic delta
 *   POST /neuromorphic/infer    Deterministic readout using current global genome
 *   GET  /neuromorphic/brain    Phase 6 brain-inspired evidence probe (measured)
 *   GET  /neuromorphic/science         Phase 7 universal scientific memory: measured statistics + world registry
 *   POST /neuromorphic/science/prior   Upload a portable prior packet (no raw data, pre-specified families only)
 *   GET  /neuromorphic/universes       Phase 8 parallel research universes: deterministic engine self-test
 *
 * Owner derivation matches `server/aiOrchestratorRoutes.js` (`x-fbt-device`
 * salted SHA-256 → `dev:...`) so zero raw device IDs or IPs are stored in the
 * neural ledger.
 */

import { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  NEUROMORPHIC_SWARM_SCHEMA,
  getNeuromorphicSwarm
} from './aiNeuromorphic.js';
import { getBrainInspiredReport } from './aiNeuromorphicBrain.js';
import { getScienceProbeReport, getScienceRegistry } from './aiNeuromorphicScience.js';
import { getResearchUniversesProbe } from './aiResearchUniverses.js';

export const NEUROMORPHIC_ROUTES_SCHEMA = 'fbt.neuromorphic.routes.v1';

const DEVICE_HEADER = 'x-fbt-device';
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SALT = process.env.FINANCIAL_GOALS_SALT || process.env.CRON_SECRET || 'fbt-ai-intent-os';

const ownerFor = (req) => {
  if (req?.tgUser?.id) return `tg:${req.tgUser.id}`;
  const device = String(req?.get?.(DEVICE_HEADER) || '').trim();
  if (DEVICE_RE.test(device)) {
    return `dev:${createHash('sha256').update(`${device}|${SALT}`).digest('hex').slice(0, 32)}`;
  }
  return `ip:${createHash('sha256').update(`${String(req?.ip || 'anon')}|${SALT}`).digest('hex').slice(0, 24)}`;
};

export function createNeuromorphicRouter({ swarm = null, log = () => {} } = {}) {
  const router = Router();
  const S = () => swarm || getNeuromorphicSwarm();

  const wrap = (handler) => async (req, res) => {
    try {
      const out = await handler(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (err) {
      log('neuromorphic-route-error', String(err?.message || err).slice(0, 160));
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          code: 'NEUROMORPHIC_ERROR',
          schema: NEUROMORPHIC_SWARM_SCHEMA,
          detail: String(err?.message || err).slice(0, 160)
        });
      }
    }
  };

  router.get('/neuromorphic/status', wrap(async (req) => {
    const owner = ownerFor(req);
    return S().getStatus({ owner });
  }));

  router.get('/neuromorphic/genome', wrap(async (req) => {
    const sinceRaw = req.query?.sinceGeneration ?? req.query?.since;
    const sinceGeneration = sinceRaw !== undefined && sinceRaw !== '' ? Number(sinceRaw) : null;
    return S().getGenome({ sinceGeneration });
  }));

  router.post('/neuromorphic/delta', wrap(async (req, res) => {
    const owner = ownerFor(req);
    const out = await S().submitDelta({ owner, packet: req.body || {} });
    if (!out.ok) {
      res.status(400);
    }
    return out;
  }));

  /**
   * Phase 6 — measured brain-inspired evidence.
   * Deterministic, cached for 60s, zero server GPU, no execution path.
   */
  router.get('/neuromorphic/brain', wrap(async (req) => {
    const ticksRaw = Number(req.query?.ticks);
    const ticks = Number.isFinite(ticksRaw) && ticksRaw > 0 ? Math.min(240, Math.max(8, ticksRaw)) : 60;
    return getBrainInspiredReport({ ticks });
  }));

  /**
   * Phase 7 — Universal Scientific Memory.
   * The probe is measured (seeded simulations of the statistics engine) and the
   * world registry reports only pre-specified families, with contributor counts.
   */
  router.get('/neuromorphic/science', wrap(async (req) => {
    const nullTestsRaw = Number(req.query?.nullTests);
    const altTestsRaw = Number(req.query?.altTests);
    const nullTests = Number.isFinite(nullTestsRaw)
      ? Math.min(480, Math.max(24, Math.round(nullTestsRaw)))
      : 240;
    const altTests = Number.isFinite(altTestsRaw)
      ? Math.min(120, Math.max(8, Math.round(altTestsRaw)))
      : 40;
    const probe = getScienceProbeReport({ nullTests, altTests });
    const world = await getScienceRegistry().getWorld({ limit: 12 });
    return { ...probe, world };
  }));

  /**
   * Phase 8 — Parallel Research Universes.
   * Deterministic engine self-test on a synthetic fixture, cached for 60 s.
   * Real candles and device genomes never leave the device.
   */
  router.get('/neuromorphic/universes', wrap(async (req) => {
    const populationRaw = Number(req.query?.population);
    const stepsRaw = Number(req.query?.steps);
    return getResearchUniversesProbe({
      population: Number.isFinite(populationRaw) ? populationRaw : undefined,
      steps: Number.isFinite(stepsRaw) ? stepsRaw : undefined
    });
  }));

  /**
   * Phase 7 — publish this device's portable prior.
   * Refuses invented hypothesis families, raw data and oversized packets; the
   * response always carries the hard no-execution laws and the storage mode.
   */
  router.post('/neuromorphic/science/prior', wrap(async (req, res) => {
    const owner = ownerFor(req);
    const packet = req.body?.packet && typeof req.body.packet === 'object' ? req.body.packet : req.body;
    const out = await getScienceRegistry().submitPrior({ owner, packet });
    if (!out.ok) res.status(400);
    return out;
  }));

  router.post('/neuromorphic/infer', wrap(async (req, res) => {
    const out = await S().inferReadout({
      candles: Array.isArray(req.body?.candles) ? req.body.candles.slice(-120) : null,
      markets: Array.isArray(req.body?.markets) ? req.body.markets.slice(0, 100) : null,
      pulse: req.body?.pulse && typeof req.body.pulse === 'object' ? req.body.pulse : null
    });
    if (!out.ok) res.status(400);
    return out;
  }));

  return router;
}

const defaultRouter = createNeuromorphicRouter();
export default defaultRouter;
