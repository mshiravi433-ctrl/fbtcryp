/** Standalone durable worker + owner-scoped HTTP API for a VPS. Node 24+.
 * Vercel/serverless remains a control plane and proxies here over HTTPS.
 * This process owns the SQLite volume; do not run two independent copies
 * against different disks. Multiple processes may share ONE local volume.
 */
import 'dotenv/config';
import express from 'express';
import { startMissionWorker } from './index.js';

const control = await startMissionWorker();
if (!control.enabled) throw new Error('MISSION_CONTROL_ENABLED=1 is required');
console.log(`Mission worker ${control.runtime.workerId} started; durable=${control.store.durable}`);

let httpServer = null;
if (process.env.MISSION_WORKER_HTTP !== '0') {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true, worker: control.runtime.status(), durable: control.store.durable }));
  app.use('/api/v1/missions', control.router);
  const port = Number(process.env.MISSION_WORKER_PORT || process.env.PORT || 8788);
  const host = process.env.HOST || '0.0.0.0';
  httpServer = app.listen(port, host, () => console.log(`Mission API listening on http://${host}:${port}`));
}
const keepAlive = setInterval(() => {}, 60000);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true; clearInterval(keepAlive);
  await control.runtime.stop();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  control.store.close();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
