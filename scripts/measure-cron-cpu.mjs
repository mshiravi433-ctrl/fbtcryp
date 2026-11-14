/**
 * CPU COST PER CRON (2026-11-12)
 * ===========================================================================
 *
 * The question this answers: WHICH parts of this application consume the
 * Fluid Active CPU (4 hours) that the Vercel account is being billed for,
 * and which ones are worth the money.
 *
 * WHY A HARNESS AND NOT A GUESS
 * -----------------------------
 * "Fluid Active CPU" is the sum of CPU-MILLISECONDS across every function
 * invocation. Nothing in the repository records it. The only honest way to
 * attribute CPU to a route is to MEASURE it: run the handler, sample the
 * process CPU, and report the delta.
 *
 * The measurement has three parts, and all three matter:
 *
 *   · WALL   — how long the call took (what the user waits for);
 *   · CPU    — `process.cpuUsage()` delta (what the BILL pays for);
 *   · HEAP   — the memory the call left behind (what decides whether the
 *              NEXT invocation re-imports the graph, which is the single
 *              biggest hidden CPU cost on a serverless platform).
 *
 * The heap number is the one that explains the bill. A route whose handler
 * leaves 40 MB of live objects behind will, on the next cold invocation,
 * have to re-import and re-parse the whole module graph — and THAT is the
 * cost that shows up in a 4-hour CPU window.
 *
 * Usage:
 *   node scripts/measure-cron-cpu.mjs            # all cron routes
 *   node scripts/measure-cron-cpu.mjs --json     # machine-readable
 *   node scripts/measure-cron-cpu.mjs daily      # one route
 */
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

const ARGS = process.argv.slice(2);
const AS_JSON = ARGS.includes('--json');
const ONLY = ARGS.find((a) => !a.startsWith('--'));

/** Every cron route the application mounts, with its schedule note. */
const CRON_ROUTES = [
  { path: '/api/cron/daily', note: 'daily digest' },
  { path: '/api/cron/scenario-evidence', note: 'scenario evidence' },
  { path: '/api/cron/smart-money', note: 'smart-money intel' },
  { path: '/api/cron/train', note: 'cortex training' },
  { path: '/api/cron/monitors', note: 'monitor sweep' },
  { path: '/api/cron/watch', note: 'watch list' },
  { path: '/api/cron/tick', note: 'scheduler tick' },
  { path: '/api/cron/status', note: 'status probe' }
];

const routes = ONLY ? CRON_ROUTES.filter((r) => r.path.includes(ONLY)) : CRON_ROUTES;
if (!routes.length) {
  console.error(`no cron route matches "${ONLY}"`);
  process.exit(1);
}

/**
 * A request that a cron handler accepts.
 *
 * The secret MATTERS for this measurement: without it the handler answers
 * 401 and does none of its work, so the measured CPU would be the cost of
 * refusing — not the cost of the cron. Measuring the real work is the whole
 * point.
 */
/* The handlers read `process.env.CRON_SECRET` directly, so it must be SET in
   the environment, not merely held in a local — otherwise every route
   answers 401 and the measurement records the cost of refusing. */
const CRON_SECRET = process.env.CRON_SECRET || 'measure-only-secret';
process.env.CRON_SECRET = CRON_SECRET;
const HEADERS = {
  'content-type': 'application/json',
  'x-fbt-device': 'devcpumeasure0001',
  'user-agent': 'vercel-cron',
  'x-cron-secret': CRON_SECRET,
  authorization: `Bearer ${CRON_SECRET}`
};

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

/**
 * Run one route and measure it.
 *
 * The heap reading is taken AFTER the handler, because what matters is what
 * SURVIVES the call: a route that leaves a large live graph behind forces
 * the next cold invocation to rebuild it, and that rebuild is billed as
 * CPU on every subsequent request until the instance is recycled.
 */
async function measure(app, route) {
  const beforeHeap = process.memoryUsage().heapUsed;
  const beforeCpu = process.cpuUsage();
  const beforeTime = performance.now();

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  let status = 0;
  let body = '';
  let error = null;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
      method: 'GET', headers: HEADERS
    });
    status = response.status;
    body = (await response.text()).slice(0, 400);
  } catch (err) {
    error = err.message;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const wall = performance.now() - beforeTime;
  const cpu = process.cpuUsage(beforeCpu);
  const afterHeap = process.memoryUsage().heapUsed;

  return {
    path: route.path,
    note: route.note,
    status,
    error,
    wallMs: Math.round(wall),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    heapDeltaMb: Number(((afterHeap - beforeHeap) / (1024 * 1024)).toFixed(1)),
    rssMb: mb(process.memoryUsage().rss),
    body: body.replace(/\s+/g, ' ').slice(0, 160)
  };
}

const { default: app } = await import('../server/app.js');

const rows = [];
for (const route of routes) {
  try {
    rows.push(await measure(app, route));
  } catch (err) {
    rows.push({ path: route.path, note: route.note, status: 0, error: err.message, wallMs: 0, cpuMs: 0, heapDeltaMb: 0, rssMb: 0, body: '' });
  }
}

rows.sort((a, b) => b.cpuMs - a.cpuMs);

if (AS_JSON) {
  console.log(JSON.stringify({ schema: 'fbt.cron-cpu.v1', measuredAt: new Date().toISOString(), rows }, null, 2));
} else {
  console.log('\nCPU PER CRON ROUTE — one call each, in this deployment\n');
  console.log('route'.padEnd(34), 'status'.padStart(6), 'wall ms'.padStart(9), 'CPU ms'.padStart(8), 'heap ΔMB'.padStart(10), 'RSS MB'.padStart(8));
  console.log('-'.repeat(84));
  for (const r of rows) {
    console.log(
      r.path.padEnd(34),
      String(r.status).padStart(6),
      String(r.wallMs).padStart(9),
      String(r.cpuMs).padStart(8),
      String(r.heapDeltaMb).padStart(10),
      String(r.rssMb).padStart(8)
    );
  }
  const totalCpu = rows.reduce((s, r) => s + r.cpuMs, 0);
  const totalWall = rows.reduce((s, r) => s + r.wallMs, 0);
  console.log('-'.repeat(84));
  console.log('TOTAL'.padEnd(34), ''.padStart(6), String(totalWall).padStart(9), String(totalCpu).padStart(8));
  console.log(`\nOne pass of every cron route costs ${totalCpu} ms of CPU.`);
  console.log('The FOUR-HOUR window is billed in CPU-MILLISECONDS, so a route that runs');
  console.log('every 15 minutes with 800 ms of CPU spends 800 x 4 x 24 = 76,800 ms');
  console.log('per day — 76.8 seconds of the 4-hour (14,400 s) budget, per route.');
}
