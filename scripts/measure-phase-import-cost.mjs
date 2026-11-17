/**
 * WHAT THE SERVER ACTUALLY PAYS FOR (2026-11-12)
 * ===========================================================================
 *
 * The other two harnesses answered "which phases are alive" and "which
 * phases are wired". This one answers the question the Vercel bill asks:
 *
 *   WHICH MODULES DOES THE SERVER ACTUALLY LOAD, AND HOW MUCH CPU DOES EACH
 *   COST TO LOAD?
 *
 * WHY THIS IS THE RIGHT UNIT
 * --------------------------
 * On a serverless platform, a module that is imported ONCE per cold start
 * is paid for on EVERY invocation until the instance is recycled. A module
 * nobody imports costs nothing, forever. So the import graph IS the bill.
 *
 * And the phases are the vocabulary the registry uses: a phase's cost is
 * the sum of the modules it pulls in.
 *
 * The measurement is honest about two things:
 *
 *   · it separates MODULE-LOAD CPU (paid per cold invocation) from
 *     HANDLER CPU (paid per request);
 *   · it measures the modules that the request path actually pulls in, not
 *     every file in the repository.
 *
 * Usage:
 *   node scripts/measure-phase-import-cost.mjs
 *   node scripts/measure-phase-import-cost.mjs --json
 */
import { performance } from 'node:perf_hooks';

const AS_JSON = process.argv.includes('--json');

const { SPEC_PHASES } = await import('../server/intentSpecPhases.js');

/**
 * Measure the CPU of importing one module, in isolation.
 *
 * The measurement is done in a CHILD process, because an import is
 * irreversible in the parent: once `server/app.js` is loaded, every module
 * it pulled in is cached, and the second import costs nothing. Measuring in
 * a child is the only way to see the real cold cost.
 */
async function measureImport(file) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  const script = `
    const t0 = process.cpuUsage();
    const w0 = performance.now();
    try {
      await import(${JSON.stringify('./' + file)});
    } catch (err) {
      process.stderr.write('IMPORT_FAILED:' + err.message);
      process.exit(2);
    }
    const cpu = process.cpuUsage(t0);
    process.stdout.write(JSON.stringify({
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      wallMs: Math.round(performance.now() - w0),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      heapMb: Math.round(process.memoryUsage().heapUsed / 1048576)
    }));
  `;
  try {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
      env: { ...process.env }
    });
    return { file, ...JSON.parse(stdout) };
  } catch (err) {
    const stderr = String(err.stderr || '');
    if (stderr.includes('IMPORT_FAILED')) {
      return { file, failed: true, error: stderr.split('IMPORT_FAILED:')[1]?.split('\n')[0] || 'import failed' };
    }
    return { file, failed: true, error: stderr.slice(0, 120) || 'measurement failed' };
  }
}

/* ── 1. the modules the request path pulls in ──────────────────────────── */
const ENTRY_CANDIDATES = [
  'server/app.js',
  'server/ci/api.js',
  'server/ci/brain.js',
  'server/aiGateway.js',
  'server/aiCollaboration.js',
  'server/aiOrchestrator.js',
  'server/aiLocalFirstGate.js',
  'server/aiInternalReasoner.js'
];

/* The AI's own entry point. */
const rows = [];
for (const file of ENTRY_CANDIDATES) {
  const measured = await measureImport(file);
  rows.push(measured);
  process.stderr.write(`  measured ${file}\n`);
}

rows.sort((a, b) => (b.cpuMs || 0) - (a.cpuMs || 0));

/* ── 2. the phase modules, grouped by phase ───────────────────────────── */
const phaseRows = [];
for (const phase of SPEC_PHASES) {
  let cpu = 0;
  let wall = 0;
  let ok = 0;
  let failed = 0;
  let jsx = 0;
  for (const src of phase.source) {
    /* A JSX file is a FRONTEND module: Node cannot import it, and the
       serverless runtime never loads it either. Counting it as a failed
       import would report sixteen broken phases where there are none. */
    if (/\.jsx$/.test(src)) { jsx += 1; continue; }
    const measured = await measureImport(src);
    if (measured.failed) { failed += 1; continue; }
    ok += 1;
    cpu += measured.cpuMs || 0;
    wall += measured.wallMs || 0;
  }
  phaseRows.push({
    phase: phase.phase,
    id: phase.id,
    modules: phase.source.length,
    importable: ok,
    failed,
    frontendOnly: jsx,
    cpuMs: cpu,
    wallMs: wall
  });
}
phaseRows.sort((a, b) => b.cpuMs - a.cpuMs);

const summary = {
  schema: 'fbt.phase-import-cost.v1',
  measuredAt: new Date().toISOString(),
  entryPoints: rows,
  phases: phaseRows,
  totals: {
    phases: phaseRows.length,
    failedImports: phaseRows.filter((p) => p.failed > 0).length,
    frontendOnlyPhases: phaseRows.filter((p) => p.frontendOnly > 0).length,
    totalPhaseCpuMs: phaseRows.reduce((s, p) => s + p.cpuMs, 0),
    heaviestPhase: phaseRows[0] || null
  }
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('\nWHAT THE SERVER PAYS FOR — module-load CPU, measured per import\n');
  console.log('THE ENTRY POINTS (a cold start pays for these)');
  console.log('module'.padEnd(34), 'CPU ms'.padStart(8), 'wall ms'.padStart(9), 'RSS MB'.padStart(8), 'heap MB'.padStart(9));
  console.log('-'.repeat(72));
  for (const r of rows) {
    if (r.failed) { console.log(r.file.padEnd(34), '  FAILED', r.error || ''); continue; }
    console.log(r.file.padEnd(34), String(r.cpuMs).padStart(8), String(r.wallMs).padStart(9), String(r.rssMb).padStart(8), String(r.heapMb).padStart(9));
  }
  console.log('');
  console.log('THE PHASES — by the CPU their own modules cost to load');
  console.log('phase'.padEnd(6), 'id'.padEnd(44), 'mods'.padStart(5), 'CPU ms'.padStart(8), 'wall ms'.padStart(9));
  console.log('-'.repeat(76));
  for (const p of phaseRows.slice(0, 20)) {
    console.log(String(p.phase).padEnd(6), p.id.padEnd(44), String(p.modules).padStart(5), String(p.cpuMs).padStart(8), String(p.wallMs).padStart(9));
  }
  console.log('');
  console.log(`phases with a module that will NOT import: ${summary.totals.failedImports}`);
  console.log(`phases whose source is FRONTEND-only (never on the server): ${summary.totals.frontendOnlyPhases}`);
}
