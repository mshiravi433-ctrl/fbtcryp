import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ownerIdentity } from './core.js';
import { MissionError } from './store.js';

const equal = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const ownerRe = /^mc_[a-f0-9]{64}$/;
export function createMissionRouter({ control, env = process.env }) {
  const router = Router();
  const hits = new Map();
  // Cron is machine-to-machine and does not have a browser device identity.
  router.post('/tick', async (req, res, next) => {
    try {
      const secret = String(env.MISSION_CRON_SECRET || '');
      if (secret.length < 32 || !equal(req.get('authorization'), `Bearer ${secret}`)) throw new MissionError('CRON_AUTH_REQUIRED', 403);
      if (!control?.enabled || !control.store.durable || !control.runtime.status().running) throw new MissionError('DURABLE_WORKER_REQUIRED', 503);
      await control.runtime.tick();
      const worker = control.runtime.status();
      if (worker.lastError) throw new MissionError('TICK_FAILED', 503);
      res.set('Cache-Control', 'no-store').json({ ok: true, worker });
    } catch (e) { next(e); }
  });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('x-fbt-mission-request') !== '1') return next(new MissionError('MISSION_HEADER_REQUIRED', 400));
    try {
      const workerAuth = equal(req.get('x-mission-worker-token'), env.MISSION_WORKER_TOKEN) && String(env.MISSION_WORKER_TOKEN || '').length >= 32;
      const forwarded = String(req.get('x-mission-owner') || '');
      req.missionOwner = workerAuth && ownerRe.test(forwarded) ? forwarded : ownerIdentity({ device: req.get('x-fbt-mission-device'), telegramId: req.tgUser?.id, secret: env.MISSION_CONTROL_SECRET });
      if (req.method !== 'GET') {
        const key = req.missionOwner, at = Date.now(), hit = hits.get(key);
        if (!hit || at > hit.until) hits.set(key, { n: 1, until: at + 60000 });
        else if (++hit.n > 30) return next(new MissionError('RATE_LIMITED', 429));
        if (hits.size > 5000) for (const [k, v] of hits) if (v.until < at) hits.delete(k);
      }
      next();
    } catch (e) { next(e); }
  });
  const requireWorker = () => { if (!control?.enabled) throw new MissionError('MISSION_CONTROL_DISABLED', 503); if (!control.runtime.status().running) throw new MissionError('DURABLE_WORKER_REQUIRED', 503); };
  const wrap = (fn, mutate = false) => async (req, res, next) => { try { if (mutate) requireWorker(); const out = await fn(req); if (!res.headersSent) res.json({ ok: true, ...out }); } catch (e) { next(e); } };
  router.get('/status', wrap((req) => control?.enabled ? control.status(req.missionOwner) : { enabled: false, durable: false, code: 'MISSION_CONTROL_DISABLED', worker: null }));
  router.get('/missions', wrap((req) => ({ missions: control.store.listMissions(req.missionOwner, { limit: Math.min(100, Math.max(1, Number(req.query.limit) || 50)), status: req.query.status || null }) })));
  router.post('/missions', wrap((req) => control.submit(req.missionOwner, req.body), true));
  router.get('/missions/:id', wrap((req) => control.get(req.missionOwner, req.params.id)));
  router.post('/missions/:id/:action', wrap((req) => {
    if (!['pause', 'resume', 'cancel', 'approve'].includes(req.params.action)) throw new MissionError('UNKNOWN_COMMAND', 404);
    return control.command(req.missionOwner, req.params.id, req.params.action, req.body || {});
  }, true));
  router.get('/evidence/:id', wrap((req) => { const evidence = control.store.evidenceFor(req.params.id, req.missionOwner); if (!evidence) throw new MissionError('EVIDENCE_NOT_FOUND', 404); return { evidence }; }));
  router.get('/events', wrap((req) => ({ events: control.store.events(req.missionOwner, Math.max(0, Number(req.query.after) || 0), Math.min(200, Number(req.query.limit) || 100)) })));
  router.get('/opportunities', wrap((req) => ({ opportunities: control.status(req.missionOwner).opportunities })));
  router.get('/learning', wrap((req) => control.learning.summary(req.missionOwner)));
  router.post('/learning/rollback', wrap((req) => ({ policy: control.learning.rollback(req.missionOwner, Number(req.body?.version)) }), true));
  router.post('/emergency-stop', wrap((req) => control.emergencyStop(req.missionOwner, String(req.body?.reason || 'user-stop').slice(0, 160)), true));
  router.post('/emergency-stop/release', wrap((req) => { if (req.body?.confirm !== true) throw new MissionError('CONFIRM_REQUIRED'); return control.releaseStop(req.missionOwner); }, true));
  router.post('/agents/:id/stop', wrap((req) => control.stopAgent(req.missionOwner, req.params.id), true));
  // Operator kill switch must work even when the durable worker is down.
  router.post('/admin/emergency-stop', async (req, res, next) => {
    try {
      if (!equal(req.get('x-mission-ops-token'), env.MISSION_OPS_TOKEN) || String(env.MISSION_OPS_TOKEN || '').length < 32) throw new MissionError('OPS_AUTH_REQUIRED', 403);
      if (!control?.enabled) throw new MissionError('MISSION_CONTROL_DISABLED', 503);
      const stopped = req.body?.release !== true;
      control.store.setState('emergency-stop', stopped); control.store.event('system', stopped ? 'emergency.global.stop' : 'emergency.global.release', {});
      if (stopped) {
        control.store.db.prepare("UPDATE missions SET status='Paused',error=?,updated_at=? WHERE status NOT IN ('Completed','Failed','Cancelled')").run(JSON.stringify({ code: 'EMERGENCY_STOP', reason: 'operator' }), Date.now());
        control.store.db.prepare("UPDATE tasks SET status='cancelled' WHERE mission_id IN (SELECT id FROM missions WHERE status='Paused') AND status='queued'").run();
        control.runtime.abortOwner();
      }
      res.json({ ok: true, stopped, note: stopped ? 'Paused missions require explicit resume after release' : 'Released; paused missions are not auto-resumed' });
    } catch (e) { next(e); }
  });
  router.use((error, _req, res, _next) => {
    const status = Number(error?.status) || (error?.code === 'MISSION_NOT_FOUND' ? 404 : 400);
    res.status(status).json({ ok: false, code: String(error?.code || 'MISSION_ERROR').slice(0, 100), error: String(error?.code || 'MISSION_ERROR').slice(0, 100) });
  });
  return router;
}

/** Vercel is a control plane only. A fixed HTTPS worker owns execution/storage. */
export function createMissionProxyRouter({ env = process.env, fetchImpl = globalThis.fetch }) {
  const router = Router();
  router.post('/tick', async (req, res) => {
    try {
      const secret = String(env.MISSION_CRON_SECRET || '');
      if (secret.length < 32 || !equal(req.get('authorization'), `Bearer ${secret}`)) throw new MissionError('CRON_AUTH_REQUIRED', 403);
      const url = new URL(env.MISSION_CONTROL_UPSTREAM_URL || '');
      if (url.protocol !== 'https:' || url.username || url.password) throw new MissionError('WORKER_UPSTREAM_NOT_CONFIGURED', 503);
      const response = await fetchImpl(new URL('/api/v1/missions/tick', url.origin), {
        method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000)
      });
      res.status(response.status).set('Cache-Control', 'no-store').type('application/json').send(await response.text());
    } catch (e) { res.status(Number(e?.status) || 503).set('Cache-Control', 'no-store').json({ ok: false, code: e?.code || 'WORKER_UNAVAILABLE' }); }
  });
  router.use(async (req, res) => {
    try {
      if (req.get('x-fbt-mission-request') !== '1') throw new MissionError('MISSION_HEADER_REQUIRED', 400);
      const url = new URL(env.MISSION_CONTROL_UPSTREAM_URL || '');
      const token = String(env.MISSION_WORKER_TOKEN || '');
      if (url.protocol !== 'https:' || url.username || url.password || token.length < 32) throw new MissionError('WORKER_UPSTREAM_NOT_CONFIGURED', 503);
      const owner = ownerIdentity({ device: req.get('x-fbt-mission-device'), telegramId: req.tgUser?.id, secret: env.MISSION_CONTROL_SECRET });
      const target = new URL(`/api/v1/missions${req.path}`, url.origin);
      for (const [k, v] of Object.entries(req.query)) if (typeof v === 'string') target.searchParams.set(k, v);
      const response = await fetchImpl(target, { method: req.method, headers: { accept: 'application/json', 'content-type': 'application/json', 'x-fbt-mission-request': '1', 'x-mission-worker-token': token, 'x-mission-owner': owner, ...(req.get('x-mission-ops-token') ? { 'x-mission-ops-token': req.get('x-mission-ops-token') } : {}) }, body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {}), signal: AbortSignal.timeout(15000) });
      res.status(response.status).set('Cache-Control', 'no-store').type('application/json').send(await response.text());
    } catch (e) { res.status(Number(e?.status) || 503).json({ ok: false, code: e?.code || 'WORKER_UNAVAILABLE' }); }
  });
  return router;
}
