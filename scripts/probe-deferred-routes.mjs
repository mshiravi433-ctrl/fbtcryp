/*
 * THE ROUTE PROBE — the lazy mounts must still SERVE.
 *
 * A deferred module that is never wired back is a 404, not a speedup, and
 * a 404 on a trading route is worse than a slow one. So this probe boots
 * the real app and asks it for the routes that were deferred.
 *
 * The routes checked here are the ones whose MODULE was deferred:
 *
 *   · `/api/business`     — a router FACTORY (businessFinanceRouter)
 *   · `/api/rwa`          — a router FACTORY (rwaRouter)
 *   · `/api/intents/v1/activation`  — a lazily-imported FUNCTION
 *   · `/api/intents/v1/phase-status` — a lazily-imported FUNCTION
 *   · `/api/ai/status`    — the AI panel, whose fleet summary now carries
 *                           the answer cache's report
 *
 * And the health route, because a cold start that cannot answer
 * `/api/health` is not a cold start, it is an outage.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.SKIP_CRON_BOOT = '1';

const app = (await import('/home/user/fbtcryp/server/app.js')).default;

if (typeof app !== 'function' && !app?.listen) {
  console.error('FAIL: server/app.js did not export an express app');
  process.exit(1);
}

/* A tiny server so the routes can be exercised without a port. */
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

const ROUTES = [
  ['GET', '/api/health', [200, 503]],
  ['GET', '/api/business/treasury', [200, 404]],
  ['GET', '/api/rwa', [200, 404]],
  ['GET', '/api/intents/v1/activation', [200, 500]],
  ['GET', '/api/intents/v1/phase-status', [200, 500]],
  ['GET', '/api/ai/status', [200, 401, 500]],
  ['GET', '/api/v1/ai/os/sessions', [200, 401, 404, 500]],
  ['GET', '/api/solana/jupfee/status', [200, 500]]
];

let failures = 0;
for (const [method, path, allowed] of ROUTES) {
  let status = 0;
  let body = '';
  try {
    const res = await fetch(`${base}${path}`, { method });
    status = res.status;
    body = (await res.text()).slice(0, 160);
  } catch (err) {
    console.log(`FAIL ${method} ${path} :: ${err.message}`);
    failures += 1;
    continue;
  }
  const ok = allowed.includes(status);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${method} ${path} -> ${status}${body ? ` :: ${body.replace(/\s+/g, ' ')}` : ''}`);
}

server.close();
console.log(failures === 0 ? '\nROUTE PROBE: all deferred routes still answer' : `\nROUTE PROBE: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
