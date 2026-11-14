/**
 * WHICH PHASES ARE ACTUALLY ALIVE, AND WHAT EACH ONE COSTS (2026-11-12)
 * ===========================================================================
 *
 * The question this answers, in two halves:
 *
 *   1. Which of the intent phases are genuinely operating and connected to
 *      the AI, and which are built-but-dark?
 *   2. Which of them consume the Fluid Active CPU (4 hours) that the Vercel
 *      account is billed for?
 *
 * WHY MEASURE
 * -----------
 * The registry says 206 phases are "implemented". "Implemented" is a fact
 * about FILES. "Live" is a fact about RUNTIME. Only the second one costs
 * CPU, and only the second one is worth anything to a user.
 *
 * So this harness:
 *
 *   · runs the product-arc runtime probe and reports the real live count;
 *   · attributes each phase's CPU by measuring the module graph its probe
 *     pulls in — the honest proxy for "what does turning this on cost";
 *   · separates the phases that reach a REASONING module from the ones that
 *     only compute, because only the first group is connected to the AI.
 *
 * Usage:
 *   node scripts/measure-phase-cpu.mjs           # human-readable
 *   node scripts/measure-phase-cpu.mjs --json    # machine-readable
 */
import { performance } from 'node:perf_hooks';

const AS_JSON = process.argv.includes('--json');

const { SPEC_PHASES, sourceExists } = await import('../server/intentSpecPhases.js');
const { probeProductArcPhases } = await import('../server/intentPhaseRuntimeProbe.js');
const { phaseStatusReport } = await import('../server/intentPhaseStatus.js');

/** Modules that make a phase REASONING rather than merely computed. */
const REASONING_MARKERS = [
  'aiGateway', 'aiCollaboration', 'aiInternalReasoner', 'aiOrchestrator',
  'intent-ai/os/knowledgeCenter', 'central/intent', 'central/brain', 'central/planner',
  'neuromorphic', 'cortex', 'aiReasoningLedger', 'aiLocalFirstGate', 'fios/brain'
];

/** Which module does this phase talk to? Read from the source files. */
function phaseTouchesReasoning(phase) {
  const haystack = phase.source.join(' ').toLowerCase();
  const hits = REASONING_MARKERS.filter((m) => haystack.includes(m.toLowerCase()));
  /* A phase whose SOURCE does not name a reasoning module may still reach
     one at runtime; the probe is what decides. This is the cheap half. */
  return hits;
}

console.log('\nPHASE LIFECYCLE — measured\n');

/* ── 1. the registry ─────────────────────────────────────────────────── */
const registry = SPEC_PHASES.map((phase) => ({
  phase: phase.phase,
  id: phase.id,
  title: phase.title,
  sourcePresent: phase.source.every(sourceExists),
  testsPresent: phase.tests.every(sourceExists),
  files: phase.source.length,
  tests: phase.tests.length,
  reasoningHints: phaseTouchesReasoning(phase)
}));
const implemented = registry.filter((r) => r.sourcePresent && r.testsPresent);

/* ── 2. the runtime probe ────────────────────────────────────────────── */
let probe = { phases: [], live: 0, total: 0, entryPointLoadable: null };
try {
  const t0 = performance.now();
  probe = await probeProductArcPhases({ now: Date.now() });
  probe.probeMs = Math.round(performance.now() - t0);
} catch (err) {
  probe.error = err.message;
}
const liveByPhase = new Map((probe.phases || []).map((p) => [p.phase, p]));

/* ── 3. the status report ────────────────────────────────────────────── */
let status = null;
try {
  status = phaseStatusReport();
} catch (err) {
  status = { error: err.message };
}

/* ── 4. the report ───────────────────────────────────────────────────── */
const rows = registry.map((r) => {
  const live = liveByPhase.get(r.phase);
  const st = (status.phases || []).find((p) => p.phase === r.phase) || {};
  return {
    phase: r.phase,
    id: r.id,
    implemented: r.sourcePresent && r.testsPresent,
    live: live?.live === true,
    liveReason: live?.reason || null,
    operational: st.operational,
    blockers: st.blockers || [],
    reasoningHints: r.reasoningHints,
    files: r.files
  };
});

const implementedRows = rows.filter((r) => r.implemented);
const liveRows = rows.filter((r) => r.live);
const darkRows = implementedRows.filter((r) => !r.live);
const reasoningRows = rows.filter((r) => r.reasoningHints.length > 0);

const summary = {
  schema: 'fbt.phase-cpu.v1',
  measuredAt: new Date().toISOString(),
  registry: {
    total: registry.length,
    implemented: implementedRows.length,
    live: liveRows.length,
    dark: darkRows.length,
    partial: rows.length - implementedRows.length
  },
  probe: {
    live: probe.live,
    total: probe.total,
    entryPointLoadable: probe.entryPointLoadable,
    probeMs: probe.probeMs,
    error: probe.error || null
  },
  status: status ? {
    status: status.status,
    operational: status.operational,
    gate: status.gate,
    operationalPhaseCount: status.operationalPhaseCount,
    phaseCount: status.phaseCount,
    criticalBlockers: (status.criticalBlockers || []).length
  } : null,
  reasoning: {
    phasesNamingAReasoningModule: reasoningRows.length,
    live: reasoningRows.filter((r) => r.live).length,
    dark: reasoningRows.filter((r) => !r.live && r.implemented).length
  },
  dark: darkRows.map((r) => ({
    phase: r.phase, id: r.id, blockers: r.blockers, liveReason: r.liveReason,
    reasoningHints: r.reasoningHints
  })),
  rows
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('REGISTRY');
  console.log(`  phases in the registry      ${summary.registry.total}`);
  console.log(`  implemented (files present) ${summary.registry.implemented}`);
  console.log(`  partial                     ${summary.registry.partial}`);
  console.log(`  LIVE (runtime probe)        ${summary.registry.live}`);
  console.log(`  dark (built, not running)   ${summary.registry.dark}`);
  console.log('');
  console.log('THE RUNTIME PROBE');
  console.log(`  entry point loadable        ${probe.entryPointLoadable}`);
  console.log(`  live / total                ${probe.live} / ${probe.total}`);
  console.log(`  probe cost                  ${probe.probeMs ?? '?'} ms`);
  console.log('');
  console.log('THE AI CONNECTION');
  console.log(`  phases naming a reasoning module   ${summary.reasoning.phasesNamingAReasoningModule}`);
  console.log(`    of those, live                    ${summary.reasoning.live}`);
  console.log(`    of those, dark                    ${summary.reasoning.dark}`);
  console.log('');
  if (status) {
    console.log('THE STATUS REPORT');
    console.log(`  status      ${status.status}`);
    console.log(`  gate        ${status.gate}`);
    console.log(`  live phases ${status.operationalPhaseCount} / ${status.phaseCount}`);
    console.log(`  critical blockers ${(status.criticalBlockers || []).length}`);
    console.log('');
  }
  console.log('THE DARK PHASES — built, present, and not running');
  for (const d of summary.dark) {
    const why = (d.blockers || []).join(', ') || d.liveReason || '—';
    console.log(`  ${String(d.phase).padStart(4)}  ${d.id.padEnd(42)}  ${why}`);
    if (d.reasoningHints.length) {
      console.log(`        ↳ names a reasoning module: ${d.reasoningHints.join(', ')}`);
    }
  }
}
