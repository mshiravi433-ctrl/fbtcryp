/**
 * CPU PER AI REQUEST — the route that matters (2026-11-12)
 * ===========================================================================
 *
 * The cron harness measured the background routes. This one measures the
 * REQUEST path — the routes a user actually hits — because on a serverless
 * platform the request path is what scales, and the Fluid Active CPU
 * allowance is consumed per invocation.
 *
 * The routes measured here are the ones that reach the AI:
 *
 *   POST /api/ai/ask      — the chat path, the one the user types into;
 *   POST /api/ai/brief    — the brief;
 *   POST /api/ai/outlook  — the outlook;
 *   GET  /api/intents/v1/phase-status — the status page, which measures
 *                          the control planes on every request.
 *
 * The measurement splits the CPU into two parts, because they have
 * different fixes:
 *
 *   · COLD  — the first call in a fresh process: it pays for the whole
 *              import graph. This is what a Vercel cold invocation bills.
 *   · WARM  — every later call on the same instance: it pays for the
 *              handler only.
 *
 * A route that is expensive when COLD and cheap when WARM is a route whose
 * cost is an IMPORT problem. A route that is expensive when WARM is a route
 * whose cost is a WORK problem. They are fixed in opposite ways.
 *
 * Usage:
 *   node scripts/measure-ai-route-cpu.mjs
 *   node scripts/measure-ai-route-cpu.mjs --json
 */
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

const AS_JSON = process.argv.includes('--json');

const { default: app } = await import('../server/app.js');

const HEADERS = {
  'content-type': 'application/json',
  'x-fbt-device': 'devairoutecpu0001',
  'user-agent': 'vercel-function'
};

/** The routes a user hits, with the body each one needs. */
const ROUTES = [
  { method: 'POST', path: '/api/ai/ask', body: { message: 'کارمزد پلتفرم FBT چقدر است؟', locale: 'fa' } },
  { method: 'POST', path: '/api/ai/brief', body: { locale: 'fa' } },
  { method: 'POST', path: '/api/ai/outlook', body: { locale: 'fa' } },
  { method: 'GET', path: '/api/intents/v1/phase-status', body: null }
];

/** One request, measured. */
async function call(server, route) {
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let status = 0;
  let bytes = 0;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route.path}`, {
      method: route.method,
      headers: HEADERS,
      body: route.body ? JSON.stringify(route.body) : undefined
    });
    status = response.status;
    const text = await response.text();
    bytes = text.length;
  } catch {
    status = 0;
  }
  const wall = Math.round(performance.now() - t0);
  const cpu = process.cpuUsage(cpu0);
  return { status, wallMs: wall, cpuMs: Math.round((cpu.user + cpu.system) / 1000), bytes };
}

const server = createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const results = [];
for (const route of ROUTES) {
  const cold = await call(server, route);
  /* The warm calls: the same instance, the import graph already paid. */
  const warm = [];
  for (let i = 0; i < 3; i += 1) warm.push(await call(server, route));
  const warmCpu = Math.round(warm.reduce((s, w) => s + w.cpuMs, 0) / warm.length);
  const warmWall = Math.round(warm.reduce((s, w) => s + w.wallMs, 0) / warm.length);
  results.push({
    method: route.method,
    path: route.path,
    status: cold.status,
    coldCpuMs: cold.cpuMs,
    coldWallMs: cold.wallMs,
    warmCpuMs: warmCpu,
    warmWallMs: warmWall,
    responseBytes: cold.bytes
  });
}

await new Promise((resolve) => server.close(resolve));

/*
 * What the allowance means.
 *
 * The Fluid Active CPU allowance is 4 hours of CPU across the whole
 * account in a rolling window. So a route's share of it is:
 *
 *   share = cpuMs per call x calls per window / (4 x 3600 x 1000)
 *
 * The number that decides whether a route is expensive is not its CPU but
 * its CPU TIMES ITS TRAFFIC. A 40 ms route that 100,000 people hit is a
 * different animal from a 600 ms route nobody calls.
 */
const ALLOWANCE_MS = 4 * 3600 * 1000;

const summary = {
  schema: 'fbt.ai-route-cpu.v1',
  measuredAt: new Date().toISOString(),
  allowanceMs: ALLOWANCE_MS,
  routes: results
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('\nCPU PER AI REQUEST — cold (first call) vs warm (later calls)\n');
  console.log('route'.padEnd(36), 'status'.padStart(6), 'cold ms'.padStart(9), 'warm ms'.padStart(9), 'bytes'.padStart(9));
  console.log('-'.repeat(76));
  for (const r of results) {
    console.log(
      `${r.method} ${r.path}`.padEnd(36),
      String(r.status).padStart(6),
      String(r.coldCpuMs).padStart(9),
      String(r.warmCpuMs).padStart(9),
      String(r.responseBytes).padStart(9)
    );
  }
  console.log('');
  console.log('WHAT THAT MEANS FOR THE 4-HOUR ALLOWANCE');
  console.log('  allowance'.padEnd(34), `${(ALLOWANCE_MS / 1000 / 3600).toFixed(1)} h of CPU`);
  console.log('');
  for (const r of results) {
    const warmCallsForHalf = Math.round(ALLOWANCE_MS / 2 / Math.max(1, r.warmCpuMs));
    console.log(`  ${`${r.method} ${r.path}`.padEnd(34)} ${String(r.warmCpuMs).padStart(5)} ms warm ⇒ ${warmCallsForHalf.toLocaleString('en-US')} calls use half the window`);
  }
  console.log('');
  console.log('  A COLD call is the import graph, and it is paid on every new');
  console.log('  instance. A WARM call is the handler, and it is paid per request.');
}
