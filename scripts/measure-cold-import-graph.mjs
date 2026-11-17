/**
 * THE COLD-START IMPORT GRAPH — WHAT THE BILL ACTUALLY PAYS FOR (2026-11-12)
 * ===========================================================================
 *
 * The other harnesses measured a phase's modules in ISOLATION. That answers
 * "what would turning this on cost", but it is NOT the number on the bill,
 * because a module the server already loads costs nothing extra.
 *
 * The bill is: for every cold invocation, the CPU it takes to LOAD the
 * module graph the request path pulls in. Every later request on the same
 * warm instance is cheap; every cold one pays again.
 *
 * So this harness boots the REAL server (`server/app.js`) and then asks
 * Node what it loaded. The module list is authoritative — it is the loader's
 * own record, not a guess — and the CPU comes from the same boot.
 *
 * The phase attribution is then the join: a loaded module belongs to a
 * phase when the phase registry names it. A phase that owns a HEAVY module
 * in the boot path is a phase the deployment pays for on every cold start.
 *
 * Usage:
 *   node scripts/measure-cold-import-graph.mjs
 *   node scripts/measure-cold-import-graph.mjs --json
 */
import { performance } from 'node:perf_hooks';
import { readFileSync, existsSync } from 'node:fs';

const AS_JSON = process.argv.includes('--json');
const ROOT = process.cwd();

const { SPEC_PHASES } = await import('../server/intentSpecPhases.js');

/* Which phase owns this module? */
const phaseOf = new Map();
for (const phase of SPEC_PHASES) {
  for (const src of phase.source) {
    const key = src.replace(/^\.\//, '');
    if (!phaseOf.has(key)) phaseOf.set(key, phase);
  }
}

/*
 * The loaded-module list.
 *
 * `process.moduleLoadList` is EMPTY for an ESM graph — it records CommonJS
 * only, and this project is ESM throughout. So the list is captured by a
 * loader hook (`scripts/_import-graph-hook.mjs`), which sees every
 * `resolve` and every `load`.
 *
 * The hook is registered with `module.register()` from WITHIN this process,
 * which is what makes it able to time the boot: the hook's `load` runs on
 * the main thread's behalf for each module, so the sum of its timings IS
 * the module-load cost.
 */
const GRAPH_FILE = `${ROOT}/.import-graph.jsonl`;
try { (await import('node:fs')).rmSync(GRAPH_FILE, { force: true }); } catch { /* first run */ }

const { register } = await import('node:module');
const { pathToFileURL } = await import('node:url');
register(pathToFileURL(`${ROOT}/scripts/_import-graph-hook.mjs`), import.meta.url);

const t0 = performance.now();
const cpu0 = process.cpuUsage();
await import('../server/app.js');
/* The cost of HAVING a working server, before any warm-up. */
const cpuBoot = process.cpuUsage(cpu0);
const wallBoot = performance.now() - t0;
/*
 * The boot now WARMS the phase probe, and the warm-up is DEFERRED to the
 * idle phase, so it runs after this import resolves. The harness waits
 * for it to settle, because a cold start that leaves the probe cache
 * empty publishes 41 live phases instead of 176 — and the point of this
 * harness is to measure what the deployment really pays for.
 *
 * The wait is on a CONDITION, not on a fixed sleep, so the number is
 * not a function of how long the machine happened to be busy.
 */
const { phaseStatusReport } = await import('../server/intentPhaseStatus.js');
const deadline = Date.now() + 3000;
while (phaseStatusReport().operationalPhaseCount < 170 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const warmCpu = process.cpuUsage(cpu0);
const wall = Math.round(performance.now() - t0);
const cpu = warmCpu;
const bootCpu = cpuBoot;
const bootWall = wallBoot;

/* Read the graph the hook wrote. */
const graphLines = [];
try {
  const { readFileSync } = await import('node:fs');
  for (const line of readFileSync(GRAPH_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { graphLines.push(JSON.parse(line)); } catch { /* skip a partial line */ }
  }
} catch { /* the graph is optional */ }

/* One row per module: the slowest observation of it wins. */
const byFile = new Map();
for (const row of graphLines) {
  if (!row.file || row.file.startsWith('..')) continue;
  const prev = byFile.get(row.file);
  if (!prev || row.ms > prev.ms) byFile.set(row.file, { file: row.file, ms: row.ms });
}
const loadedFiles = [...byFile.keys()];

/* The project's own modules, from the source tree. */
const projectFiles = loadedFiles.filter((f) => f.startsWith('server/') || f.startsWith('src/'));

/* Which of them belong to a phase? */
const attributed = projectFiles.map((f) => {
  const phase = phaseOf.get(f);
  return { file: f, bytes: existsSync(f) ? readFileSync(f).length : 0, phase: phase?.phase ?? null, phaseId: phase?.id ?? null };
});

const byPhase = new Map();
for (const a of attributed) {
  if (a.phase === null) continue;
  const cur = byPhase.get(a.phase) || { phase: a.phase, id: a.phaseId, modules: 0, bytes: 0, files: [] };
  cur.modules += 1;
  cur.bytes += a.bytes;
  cur.files.push(a.file);
  byPhase.set(a.phase, cur);
}
const phaseRows = [...byPhase.values()].sort((a, b) => b.bytes - a.bytes);

const summary = {
  schema: 'fbt.cold-import-graph.v1',
  measuredAt: new Date().toISOString(),
  boot: {
    /*
     * The boot itself, and the idle warm-up that follows it, are two
     * different costs and they are reported separately.
     *
     *   bootCpuMs  — what it costs to have a working server;
     *   warmCpuMs  — what it costs to fill the phase-probe cache, once.
     *
     * The second is paid ONCE per instance, not per request, so it does
     * not multiply with traffic; but it IS part of what a cold
     * invocation spends, and it must be visible.
     */
    wallMs: wall,
    bootCpuMs: Math.round((bootCpu.user + bootCpu.system) / 1000),
    bootWallMs: Math.round(bootWall),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    warmCpuMs: Math.round((warmCpu.user + warmCpu.system) / 1000) - Math.round((bootCpu.user + bootCpu.system) / 1000),
    warmWallMs: Math.round(wall - bootWall),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    modulesLoaded: loadedFiles.length,
    projectModulesLoaded: projectFiles.length,
    moduleLoadMs: byFile.size ? [...byFile.values()].reduce((sum, r) => sum + r.ms, 0) : null
  },
  phases: phaseRows,
  unattributed: attributed.filter((a) => a.phase === null).length
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('\nTHE COLD-START IMPORT GRAPH — what one cold invocation pays for\n');
  console.log(`  modules loaded (all)         ${summary.boot.modulesLoaded}`);
  console.log(`  project modules loaded       ${summary.boot.projectModulesLoaded}`);
  console.log(`  wall                         ${summary.boot.wallMs} ms`);
  console.log(`  CPU (boot)                   ${summary.boot.bootCpuMs} ms`);
  console.log(`  CPU (+ idle warm-up)         ${summary.boot.cpuMs} ms`);
  console.log(`  the warm-up alone            ${summary.boot.warmCpuMs} ms`);
  console.log(`  RSS                          ${summary.boot.rssMb} MB`);
  console.log(`  heap                         ${summary.boot.heapMb} MB`);
  console.log('');
  console.log('THE PHASES IN THE BOOT PATH — by the size of the modules they own');
  console.log('phase'.padEnd(6), 'id'.padEnd(46), 'mods'.padStart(5), 'KB'.padStart(8));
  console.log('-'.repeat(70));
  for (const p of phaseRows) {
    console.log(String(p.phase).padEnd(6), p.id.padEnd(46), String(p.modules).padStart(5), String(Math.round(p.bytes / 1024)).padStart(8));
  }
  console.log('');
  console.log(`project modules in the boot path owned by NO phase: ${summary.unattributed}`);
}
