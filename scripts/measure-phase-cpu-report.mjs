/**
 * THE PHASE CPU REPORT — one answer, three questions (2026-11-12)
 * ===========================================================================
 *
 * The user asked three things at once:
 *
 *   1. Which of the intent phases are active, operational, and CONNECTED to
 *      the AI?
 *   2. Which of them are burning the Fluid Active CPU (4 hours)?
 *   3. Which phase is incomplete or broken, and what are the upgrade paths?
 *
 * Three separate harnesses answer three halves of that. This one joins
 * them into a single verdict, because a phase's CPU matters only in
 * relation to what it DOES:
 *
 *   · a phase on the AI path is worth paying for;
 *   · a phase on the request path but not on the AI path is a cost with no
 *     capability attached — that is the expensive kind of dark;
 *   · a phase nobody imports is free, whatever its status says.
 *
 * Usage:
 *   node scripts/measure-phase-cpu-report.mjs
 *   node scripts/measure-phase-cpu-report.mjs --json
 */
import { readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const AS_JSON = process.argv.includes('--json');
const ROOT = process.cwd();

const { SPEC_PHASES } = await import('../server/intentSpecPhases.js');
const { probeProductArcPhases } = await import('../server/intentPhaseRuntimeProbe.js');

/* ── 1. the runtime probe (async, so it can be run here) ──────────────── */
const probe = await probeProductArcPhases({ now: Date.now() });
const liveByPhase = new Map((probe.phases || []).map((p) => [p.phase, p]));

/* ── 2. the import graph: what the boot path actually loads ───────────── */
const GRAPH_FILE = `${ROOT}/.import-graph.jsonl`;
try { (await import('node:fs')).rmSync(GRAPH_FILE, { force: true }); } catch { /* first run */ }
const { register } = await import('node:module');
const { pathToFileURL } = await import('node:url');
register(pathToFileURL(`${ROOT}/scripts/_import-graph-hook.mjs`), import.meta.url);

const t0 = performance.now();
const cpu0 = process.cpuUsage();
await import('../server/app.js');
const bootWall = Math.round(performance.now() - t0);
const bootCpu = process.cpuUsage(cpu0);

const graphRows = [];
try {
  for (const line of readFileSync(GRAPH_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { graphRows.push(JSON.parse(line)); } catch { /* skip */ }
  }
} catch { /* optional */ }
const loadedSet = new Set(graphRows.map((r) => r.file).filter(Boolean));

/* ── 3. the phase rows, joined ────────────────────────────────────────── */
const phaseOf = new Map();
for (const phase of SPEC_PHASES) {
  for (const src of phase.source) phaseOf.set(src.replace(/^\.\//, ''), phase);
}

const rows = SPEC_PHASES.map((phase) => {
  const files = phase.source.map((s) => s.replace(/^\.\//, ''));
  const inBoot = files.filter((f) => loadedSet.has(f));
  const bytes = inBoot.reduce((sum, f) => sum + (existsSync(f) ? readFileSync(f).length : 0), 0);
  const live = liveByPhase.get(phase.phase);
  return {
    phase: phase.phase,
    id: phase.id,
    /* the probe's own verdict */
    probeLive: live?.live === true,
    probeBlockers: live?.blockers || [],
    /* the boot path */
    inBoot: inBoot.length > 0,
    bootFiles: inBoot,
    bootKb: Math.round(bytes / 1024)
  };
});

const bootPhases = rows.filter((r) => r.inBoot);
const darkButCosting = bootPhases.filter((r) => !r.probeLive);
const darkKb = darkButCosting.reduce((s, r) => s + r.bootKb, 0);

const summary = {
  schema: 'fbt.phase-cpu-report.v1',
  measuredAt: new Date().toISOString(),
  boot: {
    wallMs: bootWall,
    cpuMs: Math.round((bootCpu.user + bootCpu.system) / 1000),
    modulesLoaded: loadedSet.size
  },
  probe: { live: probe.live, total: probe.total, entryPointLoadable: probe.entryPointLoadable },
  counts: {
    phases: rows.length,
    inBootPath: bootPhases.length,
    dark: rows.filter((r) => !r.probeLive).length,
    darkButInBootPath: darkButCosting.length,
    darkBootKb: darkKb
  },
  darkButCosting: darkButCosting
    .sort((a, b) => b.bootKb - a.bootKb)
    .map((r) => ({ phase: r.phase, id: r.id, bootKb: r.bootKb, blockers: r.probeBlockers, files: r.bootFiles.slice(0, 3) })),
  rows
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('\nTHE PHASE CPU REPORT\n');
  console.log(`  phases in the registry        ${summary.counts.phases}`);
  console.log(`  the runtime probe says live   ${summary.probe.live} / ${summary.probe.total}`);
  console.log(`  phases on the boot path       ${summary.counts.inBootPath}   (the deployment pays for these)`);
  console.log(`  dark phases                   ${summary.counts.dark}`);
  console.log(`  dark AND on the boot path     ${summary.counts.darkButInBootPath}   ← ${summary.counts.darkBootKb} KB`);
  console.log('');
  console.log(`  boot cost: ${summary.boot.cpuMs} ms CPU / ${summary.boot.wallMs} ms wall, ${summary.boot.modulesLoaded} modules`);
  console.log('');
  console.log('THE DARK PHASES THE DEPLOYMENT PAYS FOR');
  console.log('phase'.padEnd(6), 'id'.padEnd(44), 'KB'.padStart(7), 'why');
  console.log('-'.repeat(92));
  for (const r of summary.darkButCosting) {
    console.log(String(r.phase).padEnd(6), r.id.padEnd(44), String(r.bootKb).padStart(7), (r.blockers || []).join(', ') || '—');
  }
}
